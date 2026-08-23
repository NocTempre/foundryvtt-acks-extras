/* global game, CONFIG */
/**
 * Reading an Item document into the plain snapshot the view-model consumes.
 *
 * This is the only file on the sheet that touches a document's fields, flags
 * and owner. Every read goes through the feature's own accessors — the
 * container record, the named-item record, the property layers, the gear
 * model — so the sheet shows what the rest of the module computes and never a
 * second reading of the same flag.
 */
import { MODULE_ID, ITEM_FLAGS, LANG, EFFECT_DOMAINS } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { MASTERWORK, SILVER } from "../config.mjs";
import { isDisguised } from "../actions.mjs";
import { masterworkTierOf, scavengedOf, silveredFlagOf, pristineOf, layerDeltas } from "../properties.mjs";
import { variationItemsOf, itemBaseType } from "../variation-items.mjs";
import { containerOf, isContainer, isLocked, canSeeInside } from "../containers.mjs";
import { isSpellbook, spellbookSpells, pagesUsed, pagesCapacity } from "../spellbook.mjs";
import * as named from "../overlays/named.mjs";
import { materialOf } from "../overlays/item-loss.mjs";
import { classifyWeapon, inferGear, isShield, isHelmet } from "../profiles.mjs";
import { wearLabel } from "../wear.mjs";
import { collectEffectModifiers } from "../effects.mjs";
import { getLoadout } from "../loadout.mjs";
import { isSilvered } from "../silver.mjs";
import { ITEM_FLAG as MARKETS_FLAG } from "../../markets/constants.mjs";
import {
  isWearable, isWorn, wornSlotOf, capacityOf, contentsIn, weight6Of, isClothing, isAmmoItem, STONE,
} from "../../lib/item-model.mjs";
import { damageGlyphOf } from "../../lib/damage-type.mjs";
import { ITEM_TYPE, ACTOR_TYPE, WEAR_SLOTS } from "../../lib/vocab.mjs";
import { rollGroups } from "./rolls.mjs";
import { chartSnapshot, isChart } from "./chart.mjs";
import { splitFromOf } from "./stack.mjs";
import { ACCEPT_KINDS, kindsOf, cleanAccepts } from "./accept-kinds.mjs";
import { priceLedger } from "./price-ledger.mjs";
import { signed } from "./format.mjs";

const loc = makeLoc(LANG);

/** The flags this sheet owns on the item (the rest belong to their features). */
export const SHEET_FLAGS = Object.freeze({
  PINS: "pins", // roll ids pinned to the art, oldest first
  VALUE_MODE: "valueMode", // "priced" | "unknown" | "na"
  DISGUISABLE: "disguisable", // the Appearance tab's disguise drop target is offered
  DESTROYED: "destroyed", // the item is wrecked — struck through, tagged, still carried
});

/** Short slot names for the rail cells. */
const SLOT_SHORT = Object.freeze({
  head: "Head", neck: "Neck", shoulders: "Back", body: "Body", worn: "Worn", belt: "Belt", ring: "Ring", hands: "Hand",
  feet: "Feet", mainHand: "Main", offHand: "Off", bothHands: "2H", back: "Back", strapped: "Slung",
});

/**
 * What the type cell draws. A weapon shows its real damage-type glyph (the
 * Acks Symbols font); everything else an icon Foundry already ships — the
 * game-icons SVGs under `icons/svg/` or a Font Awesome glyph — so no mark on
 * the sheet is invented here.
 * @returns {{kind:"dmg"|"svg"|"fa", value:string}}
 */
function typeIconOf(item, baseType) {
  const svg = (name) => ({ kind: "svg", value: `icons/svg/${name}.svg` });
  const fa = (name) => ({ kind: "fa", value: `fa-solid ${name}` });
  if (item.type === ITEM_TYPE.weapon) {
    const glyph = damageGlyphOf(item);
    return glyph ? { kind: "dmg", value: glyph } : svg("sword");
  }
  if (item.type === ITEM_TYPE.armor) return isShield(item) ? svg("shield") : isHelmet(item) ? fa("fa-helmet-safety") : fa("fa-vest");
  if (item.type === ITEM_TYPE.money) return svg("coins");
  if (isSpellbook(item)) return svg("book");
  if (isChart(item)) return fa("fa-map");
  if (isContainer(item)) return svg("chest");
  if (/\bring\b/i.test(item.name ?? "")) return fa("fa-ring");
  switch (baseType) {
    case "clothing":
      return fa("fa-shirt");
    case "gem":
      return fa("fa-gem");
    case "food":
      return fa("fa-drumstick-bite");
    case "tradeGood":
      return fa("fa-boxes-stacked");
    case "coin":
      return svg("coins");
    default:
      return svg("item-bag");
  }
}

/** The type cell's two-to-four letter sub-label. */
function typeShortOf(item, baseType) {
  if (item.type === ITEM_TYPE.weapon) return "WPN";
  if (item.type === ITEM_TYPE.armor) return isShield(item) ? "SHD" : isHelmet(item) ? "HLM" : "ARM";
  if (item.type === ITEM_TYPE.money) return "MON";
  if (isSpellbook(item)) return "BOK";
  if (isChart(item)) return "MAP";
  if (isContainer(item)) return "BOX";
  return (baseType ?? "gear").slice(0, 3).toUpperCase();
}

/** Human-readable tags: the variations, the qualities, the base type. */
function tagsOf(item, { gm }) {
  const out = [];
  for (const t of item.system?.tags ?? []) if (t?.title || t?.value) out.push(t.title || t.value);
  for (const v of variationItemsOf(item)) if (gm || !v.system?.hidden) out.push(v.name);
  const tier = masterworkTierOf(item);
  if (tier && tier !== "none") out.push(game.i18n.localize("ACKS-EQUIPMENT.props.masterwork"));
  if (isSilvered(item)) out.push(game.i18n.localize("ACKS-EQUIPMENT.props.silverYes"));
  if (named.isNamed(item) && gm) out.push(loc("itemSheet.tag.named"));
  return out;
}

/** The bearer's grants that touch this item: effects, bridged abilities, attributes. */
function inheritedGrants(item, actor) {
  if (!actor || actor.type !== ACTOR_TYPE.character) return [];
  const out = [];
  const domains = [];
  const melee = item.type === ITEM_TYPE.weapon && (item.system?.melee ?? true);
  const missile = item.type === ITEM_TYPE.weapon && !!item.system?.missile;
  if (melee) domains.push([EFFECT_DOMAINS.STYLE_ATTACK_MELEE, "attackMelee"], [EFFECT_DOMAINS.STYLE_DAMAGE_MELEE, "damageMelee"]);
  if (missile) domains.push([EFFECT_DOMAINS.STYLE_ATTACK_MISSILE, "attackMissile"]);
  if (item.type === ITEM_TYPE.armor) domains.push([EFFECT_DOMAINS.STYLE_AC, "ac"]);
  for (const [domain, what] of domains) {
    for (const m of collectEffectModifiers(actor, domain)) {
      out.push({
        label: m.label,
        detail: `${signed(m.value)} ${loc(`itemSheet.grant.${what}`)}${m.condition ? ` · ${m.condition}` : ""}`,
        src: loc(m.source === "abilities" ? "itemSheet.src.ability" : "itemSheet.src.proficiency"),
      });
    }
  }
  const scores = actor.system?.scores ?? {};
  const str = Number(scores.str?.mod ?? 0);
  const dex = Number(scores.dex?.mod ?? 0);
  if (melee && str) out.push({ label: loc("itemSheet.grant.strength", { n: scores.str?.value ?? "" }), detail: `${signed(str)} ${loc("itemSheet.grant.attackDamage")}`, src: loc("itemSheet.src.attribute") });
  if (missile && dex) out.push({ label: loc("itemSheet.grant.dexterity", { n: scores.dex?.value ?? "" }), detail: `${signed(dex)} ${loc("itemSheet.grant.attackMissile")}`, src: loc("itemSheet.src.attribute") });
  if (item.type === ITEM_TYPE.armor && dex) out.push({ label: loc("itemSheet.grant.dexterity", { n: scores.dex?.value ?? "" }), detail: `${signed(dex)} ${loc("itemSheet.grant.ac")}`, src: loc("itemSheet.src.attribute") });
  if (item.type === ITEM_TYPE.weapon) {
    try {
      const loadout = getLoadout(actor);
      const entry = loadout.weapons?.find((w) => w.item?.id === item.id);
      if (entry && loadout.activeStyle) {
        out.push({
          label: loc("itemSheet.grant.style", { style: loadout.activeStyle }),
          detail: loc(loadout.styleProficient ? "itemSheet.grant.styleTrained" : "itemSheet.grant.styleUntrained"),
          src: loc("itemSheet.src.class"),
        });
      }
    } catch {
      /* a loadout that cannot be computed grants nothing to list */
    }
  }
  return out;
}

/** The item's own Active Effects as ledger rows. */
function ownEffects(item) {
  return [...(item.effects ?? [])].map((e) => ({
    id: e.id,
    label: e.name,
    detail: (e.changes ?? []).map((c) => `${c.key.replace(/^system\./, "")} ${c.value}`).join(" · ") || loc("itemSheet.effects.noChanges"),
    when: loc(e.disabled ? "itemSheet.effects.disabled" : e.transfer ? "itemSheet.effects.whileEquipped" : "itemSheet.effects.onItem"),
  }));
}

/** The price ledger's inputs, read from the layers. */
function priceOf(item, marketsFlag) {
  const base = Number(pristineOf(item).cost ?? item.system?.cost ?? 0);
  const tier = masterworkTierOf(item);
  const mw = tier && tier !== "none" && MASTERWORK[tier]
    ? { label: game.i18n.localize(`ACKS-EQUIPMENT.masterwork.${tier}`), add: MASTERWORK[tier].cost ?? 0 }
    : null;
  const sc = scavengedOf(item);
  const ledger = priceLedger({
    base,
    silverMul: silveredFlagOf(item) === true ? SILVER.priceMultiplier : null,
    masterwork: mw,
    variations: variationItemsOf(item).map((v) => ({
      name: v.name,
      baseMul: Number(v.system?.cost?.baseMul ?? 1),
      add: Number(v.system?.cost?.add ?? 0),
      mul: Number(v.system?.cost?.mul ?? 1),
    })),
    condition: sc && Number.isFinite(sc.valueMultiplier) && sc.valueMultiplier !== 1
      ? { label: (sc.labels ?? []).join("; ") || loc("itemSheet.ledger.condition"), mul: sc.valueMultiplier }
      : null,
  });
  // The document's own price is the truth the ledger explains; when the two
  // disagree (a hand-edited cost with no layers) the document wins and the
  // ledger says so with a correction line.
  const current = Number(item.system?.cost ?? ledger.final);
  const lines = ledger.lines.map((l) => ({
    ...l,
    label: l.key === "listed" ? loc("itemSheet.ledger.listed") : l.key === "silver" ? loc("itemSheet.ledger.silver") : l.label,
  }));
  if (Math.abs(current - ledger.final) >= 0.005) lines.push({ key: "set", label: loc("itemSheet.ledger.set"), op: "set", amount: current, running: current });
  const apparent = Number(marketsFlag?.apparentValueGp);
  return { base, lines, final: current, apparent: Number.isFinite(apparent) && apparent > 0 ? apparent : null };
}

/** The core fields the sheet edits directly — what the type IS. */
function recordOf(item) {
  const sys = item.system ?? {};
  const opt = (choices) => Object.entries(choices ?? {}).map(([value, label]) => ({ value, label: game.i18n.localize(label) }));
  switch (item.type) {
    case ITEM_TYPE.weapon:
      return [
        { name: "system.damage", label: loc("itemSheet.field.damage"), type: "text", value: sys.damage ?? "", width: "sm" },
        { name: "system.bonus", label: loc("itemSheet.field.bonus"), type: "number", value: sys.bonus ?? 0, width: "xs" },
        { name: "system.melee", label: loc("itemSheet.field.melee"), type: "checkbox", value: !!sys.melee },
        { name: "system.missile", label: loc("itemSheet.field.missile"), type: "checkbox", value: !!sys.missile },
        { name: "system.range.short", label: loc("itemSheet.field.rangeShort"), type: "number", value: sys.range?.short ?? 0, width: "xs" },
        { name: "system.range.medium", label: loc("itemSheet.field.rangeMedium"), type: "number", value: sys.range?.medium ?? 0, width: "xs" },
        { name: "system.range.long", label: loc("itemSheet.field.rangeLong"), type: "number", value: sys.range?.long ?? 0, width: "xs" },
        { name: "system.save", label: loc("itemSheet.field.save"), type: "select", value: sys.save ?? "", choices: [{ value: "", label: "—" }, ...opt(CONFIG.ACKS?.saves_short)] },
        { name: "system.slow", label: loc("itemSheet.field.slow"), type: "checkbox", value: !!sys.slow },
      ];
    case ITEM_TYPE.armor:
      return [
        { name: "system.aac.value", label: loc("itemSheet.field.ac"), type: "number", value: sys.aac?.value ?? 0, width: "xs" },
        { name: "system.type", label: loc("itemSheet.field.armorType"), type: "select", value: sys.type ?? "", choices: opt(CONFIG.ACKS?.armor) },
      ];
    case ITEM_TYPE.item:
      return [
        { name: "system.subtype", label: loc("itemSheet.field.subtype"), type: "select", value: sys.subtype ?? "item", choices: [{ value: "item", label: loc("itemSheet.field.subtypeItem") }, { value: "clothing", label: loc("itemSheet.field.subtypeClothing") }] },
        { name: "system.quantity.value", label: loc("itemSheet.field.quantity"), type: "number", value: sys.quantity?.value ?? 1, width: "xs" },
        { name: "system.quantity.max", label: loc("itemSheet.field.quantityMax"), type: "number", value: sys.quantity?.max ?? 0, width: "xs" },
      ];
    case ITEM_TYPE.money:
      return [
        { name: "system.coppervalue", label: loc("itemSheet.field.copperValue"), type: "number", value: sys.coppervalue ?? 1, width: "xs" },
        { name: "system.quantity", label: loc("itemSheet.field.carried"), type: "number", value: sys.quantity ?? 0, width: "xs" },
        { name: "system.quantitybank", label: loc("itemSheet.field.banked"), type: "number", value: sys.quantitybank ?? 0, width: "xs" },
      ];
    default:
      return [];
  }
}

/** Condition, armour class now-of-full, material: the Durability tab's facts. */
function conditionOf(item, container) {
  const physical = item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor;
  const sc = scavengedOf(item);
  const material = item.getFlag(MODULE_ID, ITEM_FLAGS.MATERIAL) ?? null;
  const destroyed = !!item.getFlag(MODULE_ID, SHEET_FLAGS.DESTROYED);
  const lockish = !!(container?.holds || container?.locked || container?.lockMod);
  if (!physical && !sc && !material && !destroyed && !lockish) return null;
  const deltas = layerDeltas(item, { scavenged: null });
  const base = pristineOf(item);
  const acNow = item.type === ITEM_TYPE.armor ? Number(item.system?.aac?.value ?? 0) : null;
  const acFull = item.type === ITEM_TYPE.armor ? Math.max(0, Number(base.ac ?? 0) + deltas.ac) : null;
  const qty = item.system?.quantity;
  return {
    labels: sc?.labels ?? [],
    damaged: !!sc && ((sc.damage ?? 0) < 0 || (sc.attack ?? 0) < 0 || (sc.ac ?? 0) < 0 || (sc.encumbrance ?? 0) > 0 || !!sc.breaks),
    destroyed,
    material: materialOf(item),
    materialDeclared: !!material,
    acNow,
    acFull,
    uses: Number.isFinite(qty?.value) && Number(qty?.max) > 0 ? { now: qty.value, max: qty.max } : null,
    breaks: !!sc?.breaks,
    notes: [...(sc?.notes ?? []), ...(sc?.cannotSneak ? [loc("itemSheet.condition.cannotSneak")] : [])],
  };
}

/** The container record as the sheet shows it, or null. */
function containerSnapshot(item) {
  const rec = containerOf(item);
  const holds = isContainer(item);
  if (!holds && !rec) return null;
  const cap = capacityOf(item);
  const contents = contentsIn(item).filter((i) => !variationItemsOf(item).includes(i));
  const load6 = contents.reduce((n, i) => n + weight6Of(i), 0);
  return {
    holds,
    capacityStone: cap,
    cap6: cap ? cap * STONE : 0,
    load6,
    locked: isLocked(item),
    lockOn: !!rec?.locked,
    lockMod: Number(rec?.lockMod ?? 0) || 0,
    quality: rec?.quality ?? "",
    keys: Array.isArray(rec?.keys) ? rec.keys : [],
    fragile: !!rec?.fragile,
    accepts: cleanAccepts(rec?.accepts),
    refusal: rec?.refusal ?? "",
    canSee: canSeeInside(item),
    contents: canSeeInside(item)
      ? contents.map((c) => ({ id: c.id, name: c.name, img: c.img, qty: c.system?.quantity?.value ?? c.system?.quantity ?? null, weight6: weight6Of(c) }))
      : [],
  };
}

/** The spell book half of Contents, or null. */
function spellbookSnapshot(item) {
  if (!isSpellbook(item)) return null;
  const spells = spellbookSpells(item);
  return { count: spells.length, pagesUsed: pagesUsed(item), pagesCap: pagesCapacity(item), spells };
}

/** The named-item record as the Effects tab's "The Name" section wants it. */
function namedSnapshot(item, gm) {
  const rec = named.namedOf(item);
  if (!rec) return null;
  const bonuses = named.unlockedBonuses(item);
  const total = named.maxOf(item);
  const ladder = named.ladderOf(item);
  const full = { hit: 0, damage: 0, ac: 0, encumbrance: 0, power: 0 };
  for (const k of ladder) if (k in full) full[k] += 1;
  const cats = Object.entries(named.NAMED_CATEGORIES)
    .filter(([k]) => full[k] || bonuses[k])
    .map(([k, def]) => ({ key: k, label: def.label, now: bonuses[k], full: full[k] }));
  return {
    given: rec.givenName ?? item.name,
    trueName: gm ? rec.trueName ?? "" : null,
    revealed: !!rec.revealed,
    unlocked: named.unlockedDisplay(item),
    unlockedRaw: Number(rec.unlocked ?? 0),
    ladderText: ladder.join(","),
    total,
    cats,
    ladderSet: ladder.length > 0,
    automationOn: named.overlayEnabled(),
  };
}

/**
 * Read the item.
 * @param {Item} item
 * @param {{gm:boolean, descriptionHTML?:string, trueDescriptionHTML?:string}} opts
 */
export function snapshotItem(item, { gm = false, descriptionHTML = "", trueDescriptionHTML = "" } = {}) {
  const actor = item.parent ?? null;
  const baseType = itemBaseType(item);
  const gear = inferGear(item);
  const wornSlot = wornSlotOf(item);
  const declared = isWearable(item);
  const slotGuess = gear.slots[0] ?? null;
  const slotKey = wornSlot ?? slotGuess;
  const container = containerSnapshot(item);
  const markets = item.getFlag(MODULE_ID, MARKETS_FLAG) ?? {};
  const disguise = item.getFlag(MODULE_ID, ITEM_FLAGS.DISGUISE) ?? null;
  const weaponProfile = item.type === ITEM_TYPE.weapon ? classifyWeapon(item) : null;
  const stackable = item.type === ITEM_TYPE.item || item.type === ITEM_TYPE.money;
  const qty = item.type === ITEM_TYPE.money ? Number(item.system?.quantity) : Number(item.system?.quantity?.value);

  return {
    id: item.id,
    uuid: item.uuid,
    embedded: !!actor,
    name: item.name,
    img: item.img,
    type: item.type,
    baseType,
    description: descriptionHTML,
    descriptionSource: item.system?.description ?? "",
    tags: tagsOf(item, { gm }),
    qty: Number.isFinite(qty) ? qty : null,
    stackable,
    weight6: Number(item.system?.weight6 ?? 0),
    hasWeight: "weight6" in (item.system ?? {}),
    cost: Number(item.system?.cost ?? 0),
    valueMode: item.getFlag(MODULE_ID, SHEET_FLAGS.VALUE_MODE) ?? "priced",
    wearable: declared || gear.slots.length > 0 || item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor,
    worn: isWorn(item),
    wornSlot,
    slotGuess,
    slotShort: slotKey ? SLOT_SHORT[slotKey] ?? wearLabel(slotKey) : null,
    slotTitle: slotKey ? loc(isWorn(item) ? "itemSheet.slot.wornAt" : "itemSheet.slot.wouldWear", { slot: wearLabel(slotKey) }) : loc("itemSheet.slot.carried"),
    favorite: "favorite" in (item.system ?? {}) ? !!item.system.favorite : null,
    split: !!splitFromOf(item),
    typeIcon: typeIconOf(item, baseType),
    slotIcon: slotKey ? `fa-solid ${WEAR_SLOTS[slotKey]?.icon ?? "fa-circle"}` : "fa-solid fa-hand-holding",
    typeShort: typeShortOf(item, baseType),
    typeTitle: loc("itemSheet.type.title", { type: game.i18n.localize(`TYPES.Item.${item.type}`), base: baseType ? game.i18n.localize(`ACKS-EQUIPMENT.baseType.${baseType}`) : DASH_LABEL(weaponProfile) }),
    magic: {
      is: !!markets.magic,
      aura: markets.aura ?? null,
      identified: markets.identified ?? "none",
    },
    disguise: {
      enabled: !!item.getFlag(MODULE_ID, SHEET_FLAGS.DISGUISABLE),
      active: isDisguised(item),
      trueName: disguise?.true?.name ?? item.name,
      trueDescription: trueDescriptionHTML,
      trueDescriptionSource: disguise?.true?.description ?? "",
      trueCost: disguise?.true?.cost ?? null,
      apparentName: item.name,
      apparentDescription: descriptionHTML,
      apparentImg: item.img,
    },
    named: namedSnapshot(item, gm),
    namedOffered: named.trackerVisible({ isNamed: false, disguised: isDisguised(item), isGM: gm, overlayOn: named.overlayEnabled() })
      && (item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor),
    container,
    spellbook: spellbookSnapshot(item),
    chart: chartSnapshot(item),
    condition: conditionOf(item, container),
    rolls: rollGroups(item),
    effects: { own: ownEffects(item), inherited: inheritedGrants(item, actor) },
    price: priceOf(item, markets),
    variations: variationItemsOf(item).map((v) => ({ id: v.id, name: v.name, key: v.system?.key ?? "", hidden: !!v.system?.hidden })),
    acceptKinds: [...ACCEPT_KINDS],
    kinds: [...kindsOf({ type: item.type, name: item.name, baseType, clothing: isClothing(item), ammo: isAmmoItem(item), chart: isChart(item) })],
    pins: item.getFlag(MODULE_ID, SHEET_FLAGS.PINS) ?? [],
    record: recordOf(item),
  };
}

/** A weapon's profile key stands in for a base type it has no flag for. */
const DASH_LABEL = (profile) => (profile?.key ? profile.key : "—");
