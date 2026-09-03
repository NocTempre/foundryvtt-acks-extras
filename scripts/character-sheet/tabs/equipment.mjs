/* global game, foundry */
/**
 * The Equipment tab's data: the printed sheet's body map made a list. Places
 * on the left (every wear slot, head to foot then off-body, empty ones as
 * drop targets), loose gear on the right filed by kind, containers carried
 * rather than worn under Stowed, and what is kept at a place under Kept
 * elsewhere. The Load bar is the one place encumbrance is written.
 *
 * Every fact is read through the equipment feature's own model — the loadout
 * for the hands, `wearLocation` for where a thing sits, the container report
 * for what is inside what — so this tab and the item sheet cannot disagree.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { getLoadout, heldHandsClause } from "../../equipment/loadout.mjs";
import { wearLocation, wearLabel } from "../../equipment/wear.mjs";
import { WEAR, WEAR_ICONS } from "../../equipment/config.mjs";
import { containerReport, containedIn, contentsOf, isContainer } from "../../equipment/containers.mjs";
import { canPick, canBash } from "../../equipment/locks.mjs";
import { ITEM_FLAGS } from "../../equipment/constants.mjs";
import { strapOf, overlayEnabled as shieldOverlayEnabled } from "../../equipment/overlays/shield-variants.mjs";
import { lightTypeOf } from "../../equipment/sheet.mjs";
import { bearerLights } from "../../lib/light.mjs";
import { canSplit } from "../../equipment/item-sheet/stack.mjs";
import { stoneLabel, gpLabel } from "../../equipment/item-sheet/format.mjs";
import { isEquippable, isWorn, slotsOf, weight6Of, isGoods, isClothing, STONE } from "../../lib/item-model.mjs";
import { WEAR_SLOT_ORDER, WEAR_SLOTS, slotCapacity, ITEM_TYPE } from "../../lib/vocab.mjs";
import { libStorage } from "../../lib/util.mjs";
import { depositReach, pinnedPlaces } from "../../location/reach.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The quantity a row shows: a stack's count, or nothing for a single thing. */
function quantityOf(item) {
  if (item.type === ITEM_TYPE.money) return num(item.system?.quantity);
  const q = item.system?.quantity;
  if (q && typeof q === "object") return num(q.value, 1);
  return null;
}

/** What a row says under its name: damage for a weapon, AC for armour, weight and value for goods. */
function lineOf(item) {
  const parts = [];
  if (item.type === ITEM_TYPE.weapon) parts.push(item.system?.damage ?? "");
  if (item.type === ITEM_TYPE.armor) parts.push(`AC ${num(item.system?.aac?.value)}`);
  if (item.type === ITEM_TYPE.money) {
    const qty = num(item.system?.quantity);
    const gp = (qty * num(item.system?.coppervalue)) / 100;
    parts.push(gpLabel(gp));
  } else {
    // `weight6Of` already weighs the whole stack (it reads the bundle size).
    const w6 = weight6Of(item);
    if (w6 > 0 && !isClothing(item)) parts.push(`${stoneLabel(w6)} st`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** `{lightId: "x"}` → `data-light-id="x"`: the attributes the sheet's action reads back off `dataset`. */
const attrsOf = (data) =>
  Object.entries(data)
    .map(([k, v]) => `data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${foundry.utils.escapeHTML(String(v))}"`)
    .join(" ");

/** One control on a row. `data` becomes `data-*` attributes the sheet's action reads. */
const ctl = (action, icon, title, data = {}, cls = "") => ({ action, icon, title, cls, attrs: attrsOf(data) });

/**
 * The controls a row offers its owner, in three groups: the roll, the state
 * toggles, and the housekeeping.
 */
function rowControls(actor, item, loadout, lights) {
  const roll = item.type === ITEM_TYPE.weapon ? `wpn:${item.id}:${item.system?.melee || !item.system?.missile ? "atk:melee" : "atk:missile"}` : null;
  const state = [];
  const keep = [];
  if (!actor.isOwner) return { roll, state, keep };

  const stowed = !!containedIn(item);
  if (stowed) state.push(ctl("takeOut", "fa-solid fa-arrow-up-from-bracket", game.i18n.localize("ACKS-EQUIPMENT.container.takeOut")));

  if (item.type === ITEM_TYPE.weapon && !item.getFlag(MODULE_ID, ITEM_FLAGS.THROWN_STATE)) {
    const equipped = !!item.system?.equipped;
    state.push(ctl("toggleEquip", equipped ? "fa-solid fa-box-archive" : "fa-solid fa-hand-fist", game.i18n.localize(`ACKS-EQUIPMENT.action.${equipped ? "sheathe" : "draw"}`)));
    const entry = loadout.weapons.find((w) => w.item.id === item.id);
    if (entry?.canTwoHand) {
      const gripState = entry.gripBlocked ? "blocked" : entry.wieldTwoHanded ? "twoHand" : "oneHand";
      state.push(
        ctl("cycleGrip", "fa-solid fa-hands", game.i18n.format(entry.gripBlocked ? "ACKS-EQUIPMENT.grip.blocked" : "ACKS-EQUIPMENT.grip.cycle", {
          grip: game.i18n.localize(`ACKS-EQUIPMENT.grip.${entry.grip}`),
        }), {}, `is-${gripState}`),
      );
    }
  } else if (item.type === ITEM_TYPE.armor) {
    const equipped = !!item.system?.equipped;
    state.push(ctl("toggleEquip", equipped ? "fa-solid fa-shirt" : "fa-regular fa-shirt", game.i18n.localize(equipped ? "ACKS.items.Unequip" : "ACKS.items.Equip")));
    if (item.system?.type === "shield" && shieldOverlayEnabled() && !stowed) {
      const strap = strapOf(item);
      state.push(ctl("cycleStrap", strap === "hand" ? "fa-solid fa-hand" : "fa-solid fa-shield-halved", game.i18n.localize("ACKS-EQUIPMENT.strap.cycle"), {}, `is-${strap}`));
    }
  } else if (!isEquippable(item) && slotsOf(item).length) {
    const worn = isWorn(item);
    const slot = slotsOf(item)[0];
    state.push(ctl("toggleWear", worn ? "fa-solid fa-circle-minus" : "fa-solid fa-circle-plus", game.i18n.format(`ACKS-EQUIPMENT.action.${worn ? "remove" : "wear"}`, { slot: wearLabel(slot) }), { slot }));
  }

  // Light controls: the source itself, never a stowed one; a torch STACK
  // readies a torch instead.
  const lightType = lightTypeOf(item);
  if (lightType && !stowed) {
    if (lightType === "torch" && item.type === ITEM_TYPE.item) {
      state.push(ctl("readyTorch", "fa-solid fa-fire-flame-simple", game.i18n.localize("ACKS-EQUIPMENT.action.readyHint")));
    } else {
      const lit = lights.find((l) => l.type === lightType && l.lit);
      const held = lit || lights.find((l) => l.type === lightType && l.shielded);
      if (held) {
        state.push(ctl("lightAction", "fa-solid fa-fire", game.i18n.localize("ACKS-EQUIPMENT.light.douse"), { light: "lightToggle", lightId: held.id }));
        if (lightType === "lantern") state.push(ctl("lightAction", "fa-solid fa-lightbulb", game.i18n.localize("ACKS-EQUIPMENT.light.shutter"), { light: "lightShield", lightId: held.id }));
      } else {
        state.push(ctl("lightAction", "fa-solid fa-fire-flame-curved", game.i18n.localize("ACKS-EQUIPMENT.light.light"), { light: "light", lightType }));
      }
    }
  }

  if (canSplit(item)) state.push(ctl("splitStack", "fa-solid fa-scissors", loc("equipment.split")));
  if ("favorite" in (item.system ?? {})) {
    state.push(ctl("itemFavorite", item.system.favorite ? "fa-solid fa-star" : "fa-regular fa-star", game.i18n.localize(item.system.favorite ? "ACKS.items.RemoveFromFavorites" : "ACKS.items.AddToFavorites"), {}, item.system.favorite ? "is-on" : ""));
  }
  keep.push(ctl("itemEdit", "fa-solid fa-pen-to-square", game.i18n.localize("ACKS.Edit")));
  keep.push(ctl("itemDelete", "fa-solid fa-trash", game.i18n.localize("ACKS.Delete")));
  return { roll, state, keep };
}

/** The container header's own controls: fold, the lock, pick and bash, empty. */
function containerControls(actor, report) {
  const out = [];
  const mayBypass = !report.locked || game.user.isGM;
  // Folding a container writes its record, so it is the owner's like the rest.
  if (!actor.isOwner) return out;
  if (report.visible) {
    out.push(ctl("containerToggle", report.concealed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-down", game.i18n.localize(report.concealed ? "ACKS-EQUIPMENT.container.expand" : "ACKS-EQUIPMENT.container.collapse")));
  }
  if (mayBypass) out.push(ctl("containerLock", report.locked ? "fa-solid fa-unlock" : "fa-solid fa-lock", game.i18n.localize(report.locked ? "ACKS-EQUIPMENT.container.unlock" : "ACKS-EQUIPMENT.container.lock")));
  if (report.locked) {
    if (canPick(actor)) out.push(ctl("containerPick", "fa-solid fa-key", game.i18n.localize("ACKS-EQUIPMENT.container.pick")));
    if (canBash(actor)) out.push(ctl("containerBash", "fa-solid fa-hammer", game.i18n.localize("ACKS-EQUIPMENT.container.bash")));
  }
  if (mayBypass) out.push(ctl("containerEmpty", "fa-solid fa-box-open", game.i18n.localize("ACKS-EQUIPMENT.container.empty")));
  return out;
}

/** One gear row. A container row carries its contents and its capacity bar. */
function rowOf(actor, item, ctx, depth = 0) {
  const { loadout, lights, reports, wieldedIds } = ctx;
  const row = {
    id: item.id,
    name: item.name,
    img: item.img,
    line: lineOf(item),
    qty: quantityOf(item),
    stack: (quantityOf(item) ?? 1) > 1,
    wielded: wieldedIds.has(item.id),
    controls: rowControls(actor, item, loadout, lights),
    isMoney: item.type === ITEM_TYPE.money,
    container: null,
  };
  const report = reports.get(item.id);
  if (report && depth < 3) {
    const cap6 = report.capacityStone * STONE;
    const rows = report.visible && !report.concealed ? report.contents.map((c) => rowOf(actor, c, ctx, depth + 1)) : [];
    row.container = {
      pct: cap6 > 0 ? Math.min(100, Math.round((report.load6 / cap6) * 100)) : 0,
      ticks: cap6 > 0 ? [25, 50, 75] : [],
      load: `${stoneLabel(report.load6)}${report.capacityStone ? ` / ${report.capacityStone}` : ""} st`,
      over: report.over,
      locked: report.locked,
      concealed: report.concealed,
      visible: report.visible,
      rows,
      count: report.contents.length,
      hint: !report.visible ? game.i18n.localize("ACKS-EQUIPMENT.container.lockedHint") : !report.concealed && !rows.length ? game.i18n.localize("ACKS-EQUIPMENT.container.emptyHint") : "",
      controls: containerControls(actor, report),
    };
  }
  return row;
}

/** A place kept off-person, as the Kept elsewhere rule lists it. */
function placeRow(actor, provider, items, coinGC, pinned) {
  const api = libStorage();
  const reach = depositReach(actor, provider);
  return {
    uuid: provider.uuid,
    name: provider.name,
    img: provider.img,
    isVault: !!api.vaultOwnerUuid(provider),
    count: items.length,
    coinGC,
    canReach: reach.can,
    reachReason: reach.can ? "" : game.i18n.format(`ACKS-LOCATION.storage.reach.${reach.reason}`, { scene: reach.scene?.name ?? "" }),
    pinned,
    canRetrieve: items.length > 0,
  };
}

/** Build the tab's data. */
export function buildEquipmentTab(actor) {
  const sys = actor.system ?? {};
  const loadout = getLoadout(actor);
  const lights = bearerLights(actor);
  const reports = new Map(containerReport(actor).map((r) => [r.item.id, r]));
  const wieldedIds = new Set(loadout.weapons.map((w) => w.item.id));
  const ctx = { loadout, lights, reports, wieldedIds };

  // Where everything sits, decided once by the feature's own resolver.
  const where = new Map();
  for (const item of actor.items) {
    if (!isGoods(item)) continue;
    where.set(item.id, wearLocation(actor, item, loadout));
  }

  const places = WEAR_SLOT_ORDER.map((key) => {
    const items = actor.items.filter((i) => where.get(i.id) === key);
    const cap = slotCapacity(key);
    return {
      key,
      label: wearLabel(key),
      icon: `fa-solid ${WEAR_ICONS[key] ?? WEAR_SLOTS[key]?.icon ?? "fa-circle"}`,
      rows: items.map((i) => rowOf(actor, i, ctx)),
      empty: !items.length,
      hint: loc(`equipment.slotHint.${key}`),
      capacity: cap === Infinity ? null : `${items.length} / ${cap}`,
      over: cap !== Infinity && items.length > cap,
    };
  });

  const loose = actor.items.filter((i) => where.get(i.id) === WEAR.carried);
  const stowedContainers = loose.filter(isContainer);
  const carriedItems = loose.filter((i) => !isContainer(i));
  const kinds = [
    { key: "weapons", label: game.i18n.localize("ACKS.items.Weapons"), test: (i) => i.type === ITEM_TYPE.weapon },
    { key: "armour", label: game.i18n.localize("ACKS.items.Armors"), test: (i) => i.type === ITEM_TYPE.armor },
    { key: "coin", label: loc("equipment.coin"), test: (i) => i.type === ITEM_TYPE.money || !!i.system?.treasure },
    { key: "gear", label: loc("equipment.gear"), test: () => true },
  ];
  const carried = [];
  const taken = new Set();
  for (const kind of kinds) {
    const rows = carriedItems.filter((i) => !taken.has(i.id) && kind.test(i)).map((i) => {
      taken.add(i.id);
      return rowOf(actor, i, ctx);
    });
    if (rows.length) carried.push({ key: kind.key, label: kind.label, rows, note: kind.key === "coin" ? loc("equipment.coinNote") : "" });
  }

  const storage = libStorage();
  const held = storage?.providersFor?.(actor) ?? [];
  const pinned = pinnedPlaces(actor);
  const elsewhere = held.map(({ provider, items, coinGC }) => placeRow(actor, provider, items, coinGC, pinned.has(provider.uuid)));
  for (const p of storage?.providers?.() ?? []) {
    if (elsewhere.some((e) => e.uuid === p.uuid)) continue;
    if (p.isOwner || pinned.has(p.uuid) || depositReach(actor, p).can) elsewhere.push(placeRow(actor, p, [], 0, pinned.has(p.uuid)));
  }

  const enc = sys.encumbrance ?? {};
  const pct = num(enc.pct);
  const bp = enc.breakpoints ?? {};
  // The system's own bands: past the maximum is overburdened; each breakpoint
  // below it slows the character a step further.
  const state = enc.encumbered
    ? "overburdened"
    : pct > num(bp.high, 100) ? "heavy" : pct > num(bp.mid, 100) ? "loaded" : pct > num(bp.low, 0) ? "light" : "unencumbered";
  return {
    load: {
      pct: Math.min(100, Math.round(pct)),
      ticks: [bp.low, bp.mid, bp.high].map((n) => num(n)).filter((n) => n > 0 && n < 100),
      label: loc("equipment.loadLabel", { load: stoneLabel(num(enc.value6)), max: stoneLabel(num(enc.max6)) }),
      state: loc(`equipment.loadState.${state}`),
      tone: state === "overburdened" || state === "heavy" ? "bad" : state === "unencumbered" ? null : "warn",
    },
    hands: {
      used: loadout.handsUsed,
      budget: loadout.handBudget,
      style: wearLabel(`style.${loadout.activeStyle}`),
      clause: heldHandsClause(loadout),
      untrained: !loadout.styleProficient,
    },
    places,
    carried,
    carriedCount: carriedItems.length,
    stowed: stowedContainers.map((i) => rowOf(actor, i, ctx)),
    elsewhere,
    hasContainers: reports.size > 0,
    unarmed: !loadout.weapons.length,
    editable: actor.isOwner,
  };
}

/** The container an item is in, or the loose zone — what a drop on a row resolves to. */
export const containerOfItem = (actor, item) => (containedIn(item) ? actor.items.get(containedIn(item)) ?? null : null);

export { contentsOf };
