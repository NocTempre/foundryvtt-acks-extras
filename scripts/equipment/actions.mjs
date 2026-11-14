/* global game, ui, CONFIG, Roll */
/**
 * Sheet-triggered equipment ACTIONS — the mutations the wear-bucket controls
 * invoke. Kept out of the render code (sheet.mjs) so each is unit-testable
 * against mock documents, and exposed on the module API for macros.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { FLAG_GEAR } from "../lib/constants.mjs";
import { setWorn, declaresSlots, isEquippable, gearOf } from "../lib/item-model.mjs";
import { LIGHT_SOURCES } from "../lib/light.mjs";
import { ITEM_TYPE, isWearSlot } from "../lib/vocab.mjs";
import { SHIELD_VARIANTS } from "./config.mjs";
import { equipmentClass, classifyWeapon, GRIPS, WEAPON_CATEGORY_VALUES, inferredGearFlag } from "./profiles.mjs";
import { consumeItem, roundsOf } from "./ammo.mjs";
import { rowsSettled } from "./weapon-rows.mjs";
import { unarmedStrikeDie } from "./attack-mods.mjs";
import {
  tableFor, importedTable, importedNeedsReroll, accumulateImported,
} from "./overlays/scavenged.mjs";
import { recomputeItemFields, withFlatDelta, damageFormulaOf, scavengedOf, itemLossAcOf } from "./properties.mjs";
import { unset } from "../lib/util.mjs";
import { isMissingRow } from "../lib/tables.mjs";
import { skipDialogFor } from "../lib/roll-dialog.mjs";

function notify(key, data) {
  const full = `ACKS-EQUIPMENT.action.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.info?.(msg);
}

/* -------------------------------------------------------------------------- */
/*  #1 Torch: ready one from the stack as a wieldable light-weapon            */
/* -------------------------------------------------------------------------- */

/**
 * The item payload a readied torch becomes — a SINGLE weapon (core weapons have
 * no quantity field), melee AND thrown (so core's range selector offers
 * both a swing and a hurl), flagged a light source. Pure, so a test can assert
 * the shape without Foundry. Its damage die and type are the weapon table's
 * row for a torch and nothing else: a table with no torch row readies none.
 * @returns {object|null} null when `item` is not a preparable light-weapon.
 */
export function readiedWeaponData(item) {
  const name = item?.name ?? "";
  const own = equipmentClass(name);
  // Core's compendium names the stack "Torches (6)", which the importer's
  // strict classifier passes over; the light model's torch pattern is what
  // this control keys on instead (DECISIONS.md, "A weapon that needs both
  // hands is held in both (2026-09-07)").
  const stackIsTorch = !own && LIGHT_SOURCES.torch.consumes.test(name);
  const klass = own ?? (stackIsTorch ? equipmentClass("torch") : null);
  if (klass?.prepareAs !== "weapon") return null;
  const torchLabel = LIGHT_SOURCES.torch.label;
  return {
    name: stackIsTorch ? (game.i18n?.has?.(torchLabel) ? game.i18n.localize(torchLabel) : "Torch") : item.name,
    type: "weapon",
    img: item.img,
    system: {
      damage: { base: { formula: klass.damage ?? "" } },
      melee: klass.melee ?? true,
      missile: klass.missile ?? true,
      bonus: { attack: 0, damage: 0 },
      equipped: false,
      cost: Number(item.system?.cost ?? 0),
      weight: Number(item.system?.weight ?? 0),
      weight6: Number(item.system?.weight6 ?? 0),
    },
    flags: {
      [MODULE_ID]: { light: true, ...(klass.damageType ? { [ITEM_FLAGS.DAMAGE_TYPE]: klass.damageType } : {}), readied: true },
    },
  };
}

/**
 * Ready one torch from a carried stack: create the wieldable weapon-torch and
 * decrement the bundle (deleting the stack when the last one is drawn). No-op
 * with a warning when the stack is empty or the item is not a preparable light
 * source — a control that answers nothing reads as a hung sheet.
 *
 * The stack itself is never in hand (see docs/equipment/DECISIONS.md, "Two
 * hands are two places, and a torch is equipped by readying it (2026-09-07)");
 * `draw` readies and draws it in one gesture.
 * @param {object} [opts]
 * @param {boolean} [opts.draw] put the readied torch in hand at once.
 * @returns {Promise<Item|null>} the created weapon, or null.
 */
export async function prepareTorch(actor, item, { draw = false } = {}) {
  await rowsSettled();
  const data = readiedWeaponData(item);
  if (!data) {
    notify("notReadiable", { item: item?.name ?? "" });
    return null;
  }
  if (roundsOf(item) < 1) {
    notify("noStock", { item: item.name });
    return null;
  }
  const [created] = (await actor?.createEmbeddedDocuments?.("Item", [data])) ?? [];
  const left = await consumeItem(item, 1);
  if (left <= 0) await item.delete?.();
  notify("readied", { item: item.name });
  if (draw && created) await drawItem(created);
  return created ?? null;
}

/* -------------------------------------------------------------------------- */
/*  #3 Unarmed strike (RR p. 299)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The synthetic weapon an unarmed strike rolls through (RR p.299). The
 * Unarmed Fighting proficiency changes only lethality, not the die — so
 * there is one die here, the imported one (`unarmedStrikeDie`); with none
 * imported the weapon carries a blank formula and its throw rolls no damage.
 * Melee only.
 */
export function unarmedStrikeData() {
  return {
    name: game.i18n?.has?.("ACKS-EQUIPMENT.action.unarmed")
      ? game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")
      : "Unarmed Strike",
    type: "weapon",
    img: "icons/skills/melee/unarmed-punch-fist.webp",
    system: { damage: { base: { formula: unarmedStrikeDie() ?? "" } }, melee: true, missile: false, bonus: { attack: 0, damage: 0 }, equipped: false },
  };
}

/**
 * Make an unarmed attack: build an UNSAVED weapon on the actor and run it
 * through the system's own attack throw (targets, throw, damage). No document
 * is persisted — the item exists only for the roll — and because it has no
 * id, the per-weapon modifiers that read the loadout cleanly skip it.
 *
 * @param {Actor} actor
 * @param {{event?: Event, skipDialog?: boolean}} [options]
 */
export function rollUnarmed(actor, options = {}) {
  if (!actor) return null;
  const cls = CONFIG?.Item?.documentClass;
  if (!cls) return null;
  const data = unarmedStrikeData();
  const weapon = new cls(data, { parent: actor });
  return actor.makeAttackThrow({ item: weapon, attackType: "melee", skipDialog: options.skipDialog ?? skipDialogFor(options.event) });
}

/* -------------------------------------------------------------------------- */
/*  #3 Draw / sheathe — the equip toggle with a combat verb                   */
/* -------------------------------------------------------------------------- */

/**
 * Sheathe a wielded weapon (unequip it). The hand it was drawn into goes with
 * it, so the next draw places it afresh rather than into a hand it no longer
 * holds.
 */
export async function sheatheItem(item) {
  return item?.update?.({ "system.equipped": false, [`flags.${MODULE_ID}.${ITEM_FLAGS.WORN_HAND}`]: unset() });
}
/**
 * Draw a carried weapon (equip it); the wear resolver places it. The draw
 * waits for the weapon rows (`rowsSettled`): the equip limit and the hand it
 * lists in are weighed from the weapon's size, which the rows state.
 */
export async function drawItem(item) {
  await rowsSettled();
  return item?.update?.({ "system.equipped": true });
}
/**
 * Draw a weapon INTO a named hand, "main" or "off" — what a drop on that
 * place means. One write, so the equip limit weighs the draw once. The name
 * is where the sheet lists it; the hand count is the loadout's and never
 * reads it. Any other name is a plain draw. Waits for the weapon rows like
 * `drawItem`.
 */
export async function drawInto(item, hand) {
  if (hand !== "main" && hand !== "off") return drawItem(item);
  await rowsSettled();
  return item?.update?.({ "system.equipped": true, [`flags.${MODULE_ID}.${ITEM_FLAGS.WORN_HAND}`]: hand });
}

/* -------------------------------------------------------------------------- */
/*  #3b Where gear sits — the declaration, and correcting it                  */
/* -------------------------------------------------------------------------- */

/** The sentinel the slot control uses for "let the module infer it". */
export const SLOT_AUTO = "auto";
/** The sentinel for "this is carried, not worn" — a real answer, not absence. */
export const SLOT_NONE = "none";

/**
 * Declare the whole set of places a piece of gear may sit, rather than one —
 * a weapon may be held in a hand and also ride stowed elsewhere (a scabbard,
 * a strap) at once. An empty list is the `none` answer (carried, worn
 * nowhere); passing null clears the declaration back to inference.
 */
export async function setGearSlotList(item, slots) {
  if (!item) return false;
  if (slots == null) {
    await item.update({ [`flags.${MODULE_ID}.${FLAG_GEAR}.slots`]: unset() });
    return true;
  }
  const list = [...new Set(slots.filter(isWearSlot))];
  await item.update({ [`flags.${MODULE_ID}.${FLAG_GEAR}.slots`]: list });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  #3c What a weapon IS — the declarations that outrank every inference       */
/* -------------------------------------------------------------------------- */

/**
 * Declare WHICH RAW weapon this is — the answer the proficiency check, the
 * Weapon Focus group, the damage type and every derived default hang off.
 * `auto` clears the declaration and hands the question back to
 * `weaponIdentity` (see docs/equipment/MODEL.md, "What makes a sword a
 * sword — `weaponIdentity`").
 */
export async function setWeaponProfile(item, key) {
  if (!item) return false;
  const path = `flags.${MODULE_ID}.${ITEM_FLAGS.PROFILE_KEY}`;
  if (key === SLOT_AUTO || !key) await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.PROFILE_KEY}`]: unset() });
  else await item.update({ [path]: key });
  return true;
}

/** Declare a weapon's size (RR p. 127); `auto` returns it to the table's own. */
export async function setWeaponSize(item, size) {
  if (!item) return false;
  if (size === SLOT_AUTO || !size) await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.SIZE}`]: unset() });
  else await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.SIZE}`]: size });
  return true;
}

/** Declare which grips a weapon offers: `1h`, `versatile`, `2h`, or `auto`. */
export async function setWeaponGrips(item, grips) {
  if (!item) return false;
  if (grips === SLOT_AUTO || !GRIPS.has(grips)) await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.GRIPS}`]: unset() });
  else await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.GRIPS}`]: grips });
  return true;
}

/**
 * Declare which proficiency class a weapon belongs to — a `WEAPON_CATEGORY`
 * value — or `auto` to take the table row's own. The class is what a class
 * training grant is matched against, so this is the declaration that lets a
 * weapon no row identifies count as trained.
 */
export async function setWeaponCategory(item, category) {
  if (!item) return false;
  if (category === SLOT_AUTO || !WEAPON_CATEGORY_VALUES.has(category)) await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.CATEGORY}`]: unset() });
  else await item.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.CATEGORY}`]: category });
  return true;
}

/** What it costs to take something out of this container (RR pp. 293-294). */
export async function setGearAccess(item, value) {
  if (!item) return false;
  await item.update({ [`flags.${MODULE_ID}.${FLAG_GEAR}.access`]: value === SLOT_AUTO ? "" : value });
  return true;
}

/**
 * The container record's keys that describe what goes in — the kinds taken,
 * the refusal, and a capacity stated on the record (`lib/storage.mjs` stamps
 * one on the container it makes). The lock, its keys and the row's fold are the
 * record's other half and are never these.
 */
export const HOLDING_KEYS = Object.freeze(["accepts", "refusal", "capacity"]);

/**
 * Declare that this takes gear, or that it does not — the field the item
 * sheet's Holds toggle shows (`holdsGear`). On leaves any stated capacity
 * alone and states none: a container with no limit, whose surface shows no
 * capacity. Off clears the declaration, the capacity, and the
 * container record's `HOLDING_KEYS`, so it holds nothing and a later Annotate
 * does not declare it again; the record goes with them only when nothing else
 * is left in it, so a lock or a key keeps the item a container.
 */
export async function setGearHolds(item, on) {
  if (!item) return false;
  const G = `flags.${MODULE_ID}.${FLAG_GEAR}`;
  if (on) {
    await item.update({ [`${G}.holds`]: true });
    return true;
  }
  const changes = { [`${G}.holds`]: false, [`${G}.capacity`]: null };
  const R = `flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINER}`;
  const record = item.getFlag?.(MODULE_ID, ITEM_FLAGS.CONTAINER);
  if (record && typeof record === "object") {
    if (Object.keys(record).every((k) => HOLDING_KEYS.includes(k))) changes[R] = unset();
    else for (const k of HOLDING_KEYS.filter((key) => key in record)) changes[`${R}.${k}`] = unset();
  }
  await item.update(changes);
  return true;
}

/**
 * Drop the container record from an item-sheet submit that none of its own
 * fields fired. Every submit carries the record's fields as last drawn, so one
 * fired by another control, the Holds toggle among them, would write back a
 * record that control had just taken away. Mutates and returns `data`, the
 * expanded form object; `firedName` is the `name` of the control that fired.
 */
export function containerFieldsOnlyWhenFired(data, firedName) {
  const flags = data?.flags?.[MODULE_ID];
  if (!flags || !(ITEM_FLAGS.CONTAINER in flags)) return data;
  if (String(firedName ?? "").startsWith(`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINER}.`)) return data;
  delete flags[ITEM_FLAGS.CONTAINER];
  return data;
}

/**
 * Declare the weight of ordinary equipment this harness secures, in stone —
 * the book's figure, read from the item's own text by the annotate pass or
 * typed here. Blank is unstated, and an unstated harness secures nothing.
 */
export async function setGearRelief(item, value) {
  if (!item) return false;
  const raw = String(value ?? "").trim();
  const relief = raw === "" ? null : Math.max(0, Number(raw));
  if (raw !== "" && !Number.isFinite(relief)) return false;
  await item.update({ [`flags.${MODULE_ID}.${FLAG_GEAR}.relief`]: relief });
  return true;
}

/**
 * Wear or remove a piece of gear that core cannot equip.
 *
 * Routed through the lib's `setWorn`, which writes whichever store the item's
 * type uses, so this never has to know that core owns `system.equipped` for
 * weapon and armour and nothing else.
 *
 * `setWorn` refuses a place the item does not declare, and gear nobody
 * annotated declares none. Such an item is declared first, with what the
 * Annotate pass would write, and in the same write put on — so long as the
 * place asked for is one of those it infers. What the item already carries
 * under the flag (a capacity a Judge typed) is kept over the inference.
 */
export async function wearItem(item, slot) {
  if (item && slot && !isEquippable(item) && !declaresSlots(item)) {
    const gear = inferredGearFlag(item);
    if (!gear?.slots.includes(slot)) return false;
    await item.update({ [`flags.${MODULE_ID}.${FLAG_GEAR}`]: { ...gear, ...gearOf(item), slots: gear.slots, wornAt: slot } });
    return true;
  }
  return setWorn(item, slot);
}
/** Take a worn item off. */
export async function removeItem(item) {
  return setWorn(item, null);
}

/* -------------------------------------------------------------------------- */
/*  #4 Masterwork (RR p159): stamp the tier onto core fields, reversibly       */
/* -------------------------------------------------------------------------- */

/** Append a flat +N/−N to a damage die string, combining any existing one. */
export const addToDamage = withFlatDelta;

/** The masterwork tiers that apply to a given item type (drives the picker). */
export function masterworkTiersFor(type) {
  if (type === ITEM_TYPE.weapon) return ["weaponToHit", "weaponToDamage", "weaponBoth"];
  if (type === ITEM_TYPE.armor) return ["armorLight", "armorAC"];
  return [];
}

/**
 * Apply (or clear) a masterwork tier on an item (RR p.159): STAMPS the
 * tier's bonuses onto fields core already reads, rather than adding a
 * roll-time overlay (see config.MASTERWORK; docs/equipment/DECISIONS.md,
 * "Masterwork stamps core fields rather than a roll-time overlay
 * (2026-09-22)").
 *
 * The fields are written by recomputeItemFields from the item's ONE pristine
 * baseline plus every active layer, so masterwork and a scavenged condition
 * coexist and either can be cleared without disturbing the other.
 * @param {Item} item
 * @param {string|null} tier a config.MASTERWORK key, or "none"/null to clear.
 */
export async function setMasterwork(item, tier) {
  if (!item) return;
  const key = tier && tier !== "none" ? tier : null;
  await recomputeItemFields(item, { masterwork: key });
  if (key) await item.setFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK, { tier: key });
  else await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK);
}

/* -------------------------------------------------------------------------- */
/*  Scavenged equipment (RR p160): roll a condition onto any weapon/armour     */
/* -------------------------------------------------------------------------- */

const rollD20 = () => 1 + Math.floor(Math.random() * 20);

/**
 * Expand a scavenged roll: a reroll row of the imported table (RR p.160) spawns
 * two more d20s, accumulated in roll order. Bounded so a cascade of rerolls
 * cannot loop. The roller is injectable so tests can drive it deterministically.
 * With no table imported no result is a reroll, so one d20 comes back.
 * @returns {number[]} every d20 rolled, in order.
 */
export function rollScavengedD20s(tableKey, roll = rollD20) {
  const rolls = [];
  const queue = [roll()];
  let guard = 0;
  while (queue.length && guard++ < 32) {
    const r = queue.shift();
    rolls.push(r);
    if (importedNeedsReroll(tableKey, r)) queue.push(roll(), roll());
  }
  return rolls;
}

/**
 * Clear a scavenged condition; the fields fall back to the remaining layers,
 * which include any armour class item loss has taken (`setItemLossAc`): this
 * is not the repair of that loss.
 */
export async function clearScavenged(item) {
  await recomputeItemFields(item, { scavenged: null });
  await item.unsetFlag?.(MODULE_ID, "scavenged");
}

/** Store a chosen (or rolled) condition and recompute the item's fields. */
export async function setScavenged(item, cond) {
  if (!item) return;
  if (!cond) return clearScavenged(item);
  await recomputeItemFields(item, { scavenged: cond });
  await item.setFlag?.(MODULE_ID, "scavenged", cond);
}

/**
 * Set the armour class an armour or shield has lost to item loss, as a count
 * (0 clears it). It is its own layer under its own flag: a scavenged roll,
 * pick or clear never touches it, and nothing but this writer removes it. The
 * item's fields are recomputed from the pristine baseline. False when the item
 * is not armour.
 */
export async function setItemLossAc(item, total) {
  if (!item || item.type !== ITEM_TYPE.armor) return false;
  const lost = Math.max(0, Number(total) || 0);
  await recomputeItemFields(item, { itemLossAc: lost });
  if (lost > 0) await item.setFlag?.(MODULE_ID, ITEM_FLAGS.ITEM_LOSS_AC, lost);
  else await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.ITEM_LOSS_AC);
  return true;
}

/**
 * Take armour class off an armour or shield: the amount adds to what item loss
 * has already cost it. False when the item is not armour or the amount is not
 * above zero.
 */
export async function loseArmourClass(item, amount) {
  if (!item || item.type !== ITEM_TYPE.armor || !(amount > 0)) return false;
  return setItemLossAc(item, itemLossAcOf(item) + amount);
}

/** Mark an item destroyed (or restore it): struck through and tagged on its sheet, still carried. */
export async function setDestroyed(item, on = true) {
  if (!item) return;
  if (on) await item.setFlag?.(MODULE_ID, ITEM_FLAGS.DESTROYED, true);
  else await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.DESTROYED);
}

/**
 * The rows a condition can be PICKED from, in d20 order: the reader's own
 * imported table, and nothing when there is none. Each option carries the band
 * max, which is all `setScavengedRow` needs to resolve it.
 * @returns {{value:number, label:string}[]}
 */
export function scavengedOptions(tableKey) {
  const imported = importedTable(tableKey);
  if (!imported) return [];
  return Object.values(imported)
    .filter((r) => !isMissingRow(r) && !/roll\s+again/i.test(String(r.category ?? "")))
    .sort((a, b) => Number(a.max) - Number(b.max))
    .map((r) => ({ value: Number(r.max), label: String(r.category ?? "").trim() }));
}

/** Set a scavenged condition from a chosen row (its d20 band max); null when no table is imported. */
export async function setScavengedRow(item, tableKey, bandMax) {
  const n = Number(bandMax);
  if (!Number.isFinite(n) || !importedTable(tableKey)) return null;
  const cond = accumulateImported(tableKey, [n]);
  if (!cond.labels.length) return null;
  await setScavenged(item, cond);
  return cond;
}

/**
 * Roll a scavenged condition (RR p.160) onto any weapon or armour.
 *
 * Reads the condition table the GM imported from their own book: its bands,
 * category names, effects and resale percentages. A reroll row spawns two more
 * rolls. With no table imported for the item the roll refuses
 * quietly, writes nothing and returns null.
 *
 * Fields are written by recomputeItemFields, so a re-roll never compounds and a
 * coexisting masterwork survives. `roll` is injectable for tests.
 * @returns {Promise<{rolls:number[], tableKey:string, cond:object}|null>}
 */
export async function scavengeItem(item, { roll } = {}) {
  if (!item || (item.type !== ITEM_TYPE.weapon && item.type !== ITEM_TYPE.armor)) return null;
  const profile = item.type === ITEM_TYPE.weapon ? classifyWeapon(item) : null;
  const tableKey = tableFor(item, profile);
  if (!importedTable(tableKey)) return null;

  const rolls = [];
  const queue = [0];
  let guard = 0;
  while (queue.length && guard++ < 32) {
    queue.shift();
    let v;
    if (roll) v = roll();
    else {
      // A real d20 through Foundry's roller, so dice-so-nice and the roll log see it.
      const r = await new Roll("1d20").evaluate();
      v = r.total;
    }
    rolls.push(v);
    if (importedNeedsReroll(tableKey, v)) queue.push(0, 0);
  }

  const cond = accumulateImported(tableKey, rolls);
  await setScavenged(item, cond);
  return { rolls, tableKey, cond };
}

/* -------------------------------------------------------------------------- */
/*  Apparent value / disguise (GM tool): show mundane, keep the truth hidden    */
/* -------------------------------------------------------------------------- */

/**
 * Give an item an APPARENT identity: overwrite what the sheet shows (name, value,
 * damage/AC, description, icon) with mundane values, keeping the TRUE identity in
 * a flag so the GM can Reveal it later. The real WEIGHT is untouched, so the
 * player can still carry it for encumbrance. Reversible; capturing the truth once
 * means re-disguising never loses it.
 *
 * NOT a security boundary — the flag rides on the item, which Foundry replicates
 * to the owning player's client (the same caveat containers.mjs documents for
 * locked chests). It hides the truth from the SHEET, with no player-visible
 * indicator; for genuinely secret loot, keep the real item on a GM actor until
 * it is handed over. GM-only in the UI.
 * @param {Item} item
 * @param {{name?,cost?,damage?,ac?,description?,img?}} apparent
 */
export async function disguiseItem(item, apparent = {}) {
  if (!item) return;
  const existing = item.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
  const truth = existing?.true ?? {
    name: item.name,
    img: item.img,
    cost: Number(item.system?.cost ?? 0),
    damage: damageFormulaOf(item),
    ac: Number(item.system?.ac?.value ?? 0),
    description: item.system?.description ?? "",
  };
  const update = { name: apparent.name ?? truth.name };
  if (apparent.img) update.img = apparent.img;
  if (apparent.cost != null && apparent.cost !== "") update["system.cost"] = Number(apparent.cost);
  if (item.type === ITEM_TYPE.weapon && apparent.damage != null && apparent.damage !== "") update["system.damage.base.formula"] = apparent.damage;
  if (item.type === ITEM_TYPE.armor && apparent.ac != null && apparent.ac !== "") update["system.ac.value"] = Number(apparent.ac);
  if (apparent.description != null) update["system.description"] = apparent.description;
  await item.update?.(update);
  await item.setFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE, { true: truth, apparent });
}

/**
 * Drop the disguise, restoring the item's true identity.
 *
 * Restores only the fields the disguise actually masked: each guard mirrors the
 * matching write in `disguiseItem` against the stored `apparent` payload. A field
 * the disguise never wrote still holds the owner's own later edits, which are the
 * newer truth and must survive the reveal. `name` is always masked, so it always
 * comes back. Keep the two sets of guards in step if either function changes.
 */
export async function revealItem(item) {
  const d = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
  if (!d?.true) return;
  const t = d.true;
  const ap = d.apparent ?? {};
  const update = { name: t.name };
  if (ap.img) update.img = t.img;
  if (ap.cost != null && ap.cost !== "") update["system.cost"] = t.cost;
  if (item.type === ITEM_TYPE.weapon && ap.damage != null && ap.damage !== "") update["system.damage.base.formula"] = t.damage;
  if (item.type === ITEM_TYPE.armor && ap.ac != null && ap.ac !== "") update["system.ac.value"] = t.ac;
  if (ap.description != null) update["system.description"] = t.description;
  await item.update?.(update);
  await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
}

/** Is this item wearing an apparent identity? (GM-facing.) */
export function isDisguised(item) {
  return !!item?.getFlag?.(MODULE_ID, ITEM_FLAGS.DISGUISE);
}

/* -------------------------------------------------------------------------- */
/*  Shield variant (JJ pp407-408): make any shield a buckler/kite/etc.        */
/* -------------------------------------------------------------------------- */

/** Every shield-variant key (standard + the six JJ variants). */
export const SHIELD_VARIANT_KEYS = Object.keys(SHIELD_VARIANTS);

/**
 * Set (or clear) a shield's variant. The AC correction, encumbrance, strap
 * validity, and Specialization rules all read this flag live through the
 * shield-variant overlay, so a plain shield becomes a buckler/kite/etc. with no
 * field stamping — clearing back to "standard" removes the flag.
 */
export async function setShieldVariant(item, key) {
  if (!item) return;
  if (!key || key === "standard") await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT);
  else await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT, key);
}
