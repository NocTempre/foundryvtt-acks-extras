/* global game, Hooks, ui, foundry, fromUuidSync, document */
/**
 * Paper Doll integration (theripper93's `fvtt-paper-doll-ui`), with a
 * max-per-type fallback when it is absent.
 *
 * Paper Doll is premium/signed, so this integrates purely through its public
 * surface — never a fork:
 *   - world setting `fvtt-paper-doll-ui.globalConfig` (merged over its CONSTS)
 *     carries our ACKS slot layout and `EQUIPPED_PATH`;
 *   - hooks `paper-doll-equip` / `paper-doll-swap` tell us what moved.
 *
 * `EQUIPPED_PATH` matters most: Paper Doll only writes the system's equipped
 * flag when that path is set, and its own `getEquippedPath()` returns "" for
 * anything but dnd5e. Setting it to "equipped" makes drag-and-drop write
 * `system.equipped` on ACKS weapons/armour — which flows straight into this
 * module's existing preUpdateItem/updateItem enforcement. So the doll becomes an
 * input device for the same RAW rules, not a parallel system.
 *
 * The slot layout is pushed ONCE (guarded by our `paperdollConfigured` setting)
 * so a GM's later customisation is never clobbered.
 */
import { MODULE_ID, SETTINGS, PAPERDOLL_ID, PAPERDOLL_HOOKS, ITEM_FLAGS } from "./constants.mjs";
import { WEAR } from "./config.mjs";
import { refreshLoadout } from "./enforce.mjs";
import { wearLocation } from "./wear.mjs";

/** Which hand a Paper Doll slot represents (drives dual-wield vs two-handed). */
const HAND_BY_SLOT = Object.freeze({ MAIN_RIGHT: "main", MAIN_LEFT: "off" });

/**
 * Paper Doll slot → canonical wear location (config.mjs WEAR). The doll's slot
 * ids are fixed by ITS template, so this is the seam where the two vocabularies
 * meet — the sheet buckets and the doll must describe the same place, and this
 * mapping is what keeps them from drifting apart silently.
 */
export const SLOT_WEAR = Object.freeze({
  HEAD: WEAR.HEAD,
  BODY: WEAR.BODY,
  CAPE: WEAR.WORN,
  GLOVES: WEAR.WORN,
  BOOTS: WEAR.WORN,
  MAIN_RIGHT: WEAR.MAIN_HAND,
  MAIN_LEFT: WEAR.OFF_HAND,
});

/** Filters expressed as Paper Doll expects: a JS function body over `item`. */
const F_ARMOUR_SUIT = "return item.type === 'armor' && item.system?.type !== 'shield' && !/helm/i.test(item.name ?? '');";
const F_HELMET = "return item.type === 'armor' && /helm/i.test(item.name ?? '');";
const F_HAND = "return item.type === 'weapon' || (item.type === 'armor' && item.system?.type === 'shield');";

/**
 * ACKS slot layout. Region keys are fixed by Paper Doll's template
 * (LEFT / RIGHT / BOTTOM_*_WRIST / BOTTOM_*_MAIN) — only slots within them are
 * extensible, so we map ACKS concepts onto those regions rather than inventing
 * new ones.
 */
export const ACKS_PAPERDOLL_CONFIG = {
  EQUIPPED_PATH: "equipped",
  SLOTS: {
    LEFT: {
      HEAD: [{ img: "icons/equipment/head/helm-barbute-engraved-steel.webp", filter: F_HELMET }],
      CAPE: [{ img: "icons/equipment/back/cape-layered-red.webp", simpleFilter: ["item"] }],
      BODY: [{ img: "icons/equipment/chest/breastplate-layered-steel.webp", filter: F_ARMOUR_SUIT }],
      GLOVES: [{ img: "icons/equipment/hand/glove-frayed-cloth-grey.webp", simpleFilter: ["item"] }],
      BOOTS: [{ img: "icons/equipment/feet/boots-armored-layered-steel.webp", simpleFilter: ["item"] }],
    },
    BOTTOM_RIGHT_MAIN: {
      MAIN_RIGHT: [{ img: "icons/weapons/swords/sword-guard-steel.webp", filter: F_HAND }],
    },
    BOTTOM_LEFT_MAIN: {
      MAIN_LEFT: [{ img: "icons/equipment/shield/heater-steel-worn.webp", filter: F_HAND }],
    },
  },
};

/** Which equip source is authoritative: "paperdoll" or "fallback". */
export function activeStrategy() {
  const pref = game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_STRATEGY);
  const present = !!game.modules.get(PAPERDOLL_ID)?.active;
  if (pref === "fallback") return "fallback";
  return present ? "paperdoll" : "fallback"; // "auto" and "paperdoll" both need it installed
}

/** Push the ACKS slot layout + EQUIPPED_PATH once, without clobbering edits. */
async function configurePaperDoll() {
  const current = game.settings.get(PAPERDOLL_ID, "globalConfig") ?? {};
  const merged = foundry.utils.mergeObject(foundry.utils.deepClone(current), ACKS_PAPERDOLL_CONFIG, { inplace: false });
  await game.settings.set(PAPERDOLL_ID, "globalConfig", merged);
  await game.settings.set(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED, true);
  console.debug(`${MODULE_ID} | pushed ACKS slot layout + EQUIPPED_PATH to Paper Doll.`);
  ui.notifications?.info(
    game.i18n.has("ACKS-EQUIPMENT.notify.paperdollConfigured")
      ? game.i18n.localize("ACKS-EQUIPMENT.notify.paperdollConfigured")
      : "Paper Doll configured for ACKS equipment slots.",
  );
}

/** Record which hand a slot represents so dual-wield/off-hand can be resolved. */
async function setHandFlag(item, slotId, equipped) {
  const hand = HAND_BY_SLOT[slotId];
  if (!hand || !item?.isOwner) return;
  await item.setFlag(MODULE_ID, ITEM_FLAGS.WORN_HAND, equipped ? hand : null);
}

async function onPaperDollEquip(actor, item, equipped, slotData) {
  if (!actor || !item) return;
  await setHandFlag(item, slotData?.slotId, equipped);
  await refreshLoadout(actor); // self-guards to the primary responder
}

/**
 * Core sheet → doll. Unequipping on the character sheet must empty the slot on
 * the doll; without this the doll keeps showing the item as worn.
 *
 * Paper Doll's own clear path (`_onContextMenu`) empties a slot by assigning
 * **null** to `slots[slotId][slotIndex]` and re-saving the whole flag — it does
 * not delete the key — so we mirror that exactly. Assigning null over an already
 * null slot is a no-op, so the doll's own equip/unequip cannot loop back here.
 * @returns {Promise<boolean>} whether anything was cleared
 */
export async function clearFromPaperDoll(actor, item) {
  const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
  let changed = false;
  for (const [slotId, entries] of Object.entries(slots)) {
    if (!entries || typeof entries !== "object") continue;
    for (const [index, uuid] of Object.entries(entries)) {
      if (uuid && uuid === item.uuid) {
        slots[slotId][index] = null;
        changed = true;
      }
    }
  }
  if (changed) await actor.setFlag(PAPERDOLL_ID, "slots", slots);
  return changed;
}

/* ---------------------------------------------------------------------- */
/*  Sheet → doll mirroring                                                 */
/*                                                                         */
/*  With the doll active it must ALWAYS match the sheet: equip or unequip  */
/*  on either side updates the other. Doll → sheet already flows through   */
/*  EQUIPPED_PATH; this half places sheet-equipped gear into slots and     */
/*  reconciles the whole doll from the actor's real equipped state.        */
/* ---------------------------------------------------------------------- */

/**
 * Which doll slot a sheet-equipped item belongs in — derived from the SAME
 * wear taxonomy the sheet buckets use (wear.mjs), so the doll and the sheet
 * cannot disagree about where a thing sits. Pure planning: no writes.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} slots       the doll's slots flag (may be stale)
 * @param {(uuid:string)=>Item|null} resolve  uuid → item (injectable for tests)
 * @returns {string|null} a slot id, or null when nothing fits (strapped
 *   shields have no doll slot; a fully occupied region is left alone rather
 *   than displacing what the player placed)
 */
export function planDollSlot(actor, item, slots, resolve) {
  // A slot is free if empty, already ours, or holding a stale reference
  // (unequipped or deleted occupant) that reconciliation will clear anyway.
  const free = (slotId) => {
    const uuid = slots?.[slotId]?.[0];
    if (!uuid || uuid === item.uuid) return slotId;
    const occupant = resolve(uuid);
    return occupant && occupant.parent?.id === actor.id && occupant.system?.equipped ? null : slotId;
  };
  const where = wearLocation(actor, item);
  switch (where) {
    case WEAR.HEAD:
      return free("HEAD");
    case WEAR.BODY:
      return free("BODY");
    case WEAR.MAIN_HAND:
    case WEAR.BOTH_HANDS:
      return free("MAIN_RIGHT") ?? free("MAIN_LEFT");
    case WEAR.OFF_HAND:
      return free("MAIN_LEFT") ?? free("MAIN_RIGHT");
    case WEAR.WORN: {
      // Three clothing slots; route by name where the name says, else first free.
      const n = String(item.name ?? "").toLowerCase();
      if (/boot|sandal|shoe/.test(n)) return free("BOOTS") ?? free("CAPE") ?? free("GLOVES");
      if (/glove|gauntlet|mitt/.test(n)) return free("GLOVES") ?? free("CAPE") ?? free("BOOTS");
      return free("CAPE") ?? free("GLOVES") ?? free("BOOTS");
    }
    default:
      return null; // strapped / carried / stowed — not on the doll
  }
}

/** Default occupant resolver (split out so the planner is testable). */
function resolveUuid(uuid) {
  try {
    return typeof fromUuidSync === "function" ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Place a sheet-equipped item into the doll. Deferred one beat: when the
 * EQUIP came from the doll itself, its own slots write lands first and this
 * becomes a no-op (the uuid is already placed), so the two writers cannot
 * fight over slot choice.
 */
async function placeInPaperDoll(actor, item) {
  await new Promise((r) => setTimeout(r, 150));
  if (!item.system?.equipped) return false; // changed again while we waited
  const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
  if (isPlaced(slots, item.uuid)) return false;
  const target = planDollSlot(actor, item, slots, resolveUuid);
  if (!target) return false;
  slots[target] = { ...(slots[target] ?? {}), 0: item.uuid };
  await actor.setFlag(PAPERDOLL_ID, "slots", slots);
  // The same hand bookkeeping the doll's own drop performs.
  await setHandFlag(item, target, true);
  return true;
}

/** Is this uuid already sitting in some slot? */
function isPlaced(slots, uuid) {
  return Object.values(slots).some((e) => e && typeof e === "object" && Object.values(e).includes(uuid));
}

/** One reconciliation at a time per actor — see syncActorToDoll. */
const RECONCILING = new Set();

/**
 * Reconcile one actor's doll to the sheet's truth: stale slot entries
 * (unequipped, deleted, foreign) are cleared, every equipped wearable is
 * placed. Converges: a second run makes no writes.
 *
 * ONE write for the whole reconciliation, and one pass at a time. Both matter
 * because writing the slots flag fires `updateActor`, which the doll listens on
 * and answers with a re-render — which calls this back. A write per item turned
 * opening a doll into a write→render→reconcile storm that re-walked every item
 * each time round; a single write settles it in one extra no-op pass.
 */
export async function syncActorToDoll(actor) {
  if (actor?.type !== "character" || !actor.isOwner) return;
  if (RECONCILING.has(actor.id)) return;
  RECONCILING.add(actor.id);
  try {
    // One beat, once — not once per item. When the change came from the doll
    // itself, its own slots write lands first and we see it already placed, so
    // the two writers never fight over slot choice.
    await new Promise((r) => setTimeout(r, 150));
    const slots = foundry.utils.deepClone(actor.getFlag(PAPERDOLL_ID, "slots") ?? {});
    let changed = false;
    for (const [slotId, entries] of Object.entries(slots)) {
      if (!entries || typeof entries !== "object") continue;
      for (const [index, uuid] of Object.entries(entries)) {
        if (!uuid) continue;
        const occupant = resolveUuid(uuid);
        if (!occupant || occupant.parent?.id !== actor.id || !occupant.system?.equipped) {
          slots[slotId][index] = null; // the doll's own clear convention
          changed = true;
        }
      }
    }
    // Plan every placement against the SAME in-memory slots object, so two
    // items cannot be planned into one slot and the whole lot costs one write.
    const placed = [];
    for (const item of actor.items) {
      if (!item.system?.equipped) continue;
      if (item.type !== "weapon" && item.type !== "armor" && item.type !== "item") continue;
      if (isPlaced(slots, item.uuid)) continue;
      const target = planDollSlot(actor, item, slots, resolveUuid);
      if (!target) continue;
      slots[target] = { ...(slots[target] ?? {}), 0: item.uuid };
      placed.push([item, target]);
      changed = true;
    }
    if (changed) await actor.setFlag(PAPERDOLL_ID, "slots", slots);
    for (const [item, target] of placed) await setHandFlag(item, target, true);
  } finally {
    RECONCILING.delete(actor.id);
  }
}

/** Sheet equip/unequip — mirror it onto the doll, whichever way it went. */
async function onItemEquippedChanged(item, changes) {
  if (!foundry.utils.hasProperty(changes, "system.equipped")) return;
  const actor = item?.parent;
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  if (foundry.utils.getProperty(changes, "system.equipped")) await placeInPaperDoll(actor, item);
  else await clearFromPaperDoll(actor, item);
}

async function onPaperDollSwap(actor, a, b) {
  if (!actor) return;
  for (const side of [a, b]) {
    if (side?.item) await setHandFlag(side.item, side.slotId, true);
  }
  await refreshLoadout(actor);
}

/** The doll's own `playerOwnedOnly` gate, so our button appears exactly where its control does. */
function dollAllowsActor(actor) {
  try {
    return !game.settings.get(PAPERDOLL_ID, "playerOwnedOnly") || !!actor.hasPlayerOwner;
  } catch {
    return true; // the setting's shape is the doll's own business
  }
}

/**
 * Toggle the doll for an actor exactly as its own header control does: an open
 * window closes, otherwise a fresh one renders.
 *
 * Reuse, not reimplementation — `ui.paperDoll` is the doll's OWN class, which
 * it publishes on `init`. So this is its constructor and its close, and the
 * existing-window check is what keeps a SECOND instance off one actor: each
 * `new PaperDoll()` monkey-patches `sheet.close`/`setPosition`, and a second
 * one wraps the first's wrapper — after which closing them out of order leaves
 * the sheet permanently patched by a dead window.
 */
function toggleDoll(actor) {
  const open = dollWindowsFor(actor.id);
  if (open.length) {
    for (const w of open) w.close?.()?.catch?.(() => {});
    return;
  }
  const DollApp = ui.paperDoll;
  if (typeof DollApp !== "function") return;
  new DollApp(actor).render(true);
}

/**
 * A DIRECT header button for the doll on character sheets.
 *
 * Paper Doll 3.x registers its opener as an ApplicationV2 header CONTROL, and
 * v14 collapses those into the ⋮ dropdown — so the doll silently moved from a
 * visible header button (its 2.x placement) into a menu nobody looks in, which
 * reads as "the integration broke". This restores a visible button beside the
 * other modules' header buttons.
 *
 * It does NOT re-fire core's `getHeaderControlsActorSheetV2` to harvest the
 * doll's entry. That hook is core's to fire: every module listening on it runs
 * again on each re-fire, side effects and all — one schedules an auto-open,
 * another dereferences `app.document` unguarded — so borrowing one entry meant
 * running everyone else's listener too. We build the button ourselves and drive
 * the doll's own class instead; core still fires the hook once per render, so
 * the doll's ⋮ entry is untouched.
 */
export function injectDollHeaderButton(app, element) {
  if (activeStrategy() !== "paperdoll") return;
  // An actor's SHEET — not merely "a window that has an actor". We are offered
  // every ApplicationV2 render, and other modules' windows carry an `.actor`
  // and draw a `.window-header` too (the doll's own window is one), so the gate
  // has to be the document, or the button lands inside foreign windows.
  if (app?.document?.documentName !== "Actor") return;
  const actor = app.document;
  if (actor.type !== "character" || !dollAllowsActor(actor)) return;
  if (typeof ui.paperDoll !== "function") return; // no class to open: no button
  const header = element?.querySelector?.(".window-header");
  if (!header || header.querySelector(".acks-equipment-doll-button")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control icon fa-solid fa-person acks-equipment-doll-button";
  btn.dataset.tooltip = game.i18n.has("ACKS-EQUIPMENT.notify.openDoll")
    ? game.i18n.localize("ACKS-EQUIPMENT.notify.openDoll")
    : "Paper Doll";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleDoll(actor);
  });
  header.insertBefore(btn, header.querySelector("[data-action='close']"));
}

/**
 * Every open Paper Doll window for an actor, wherever it registered.
 *
 * The doll has shipped as both AppV1 (`ui.windows`) and AppV2
 * (`foundry.applications.instances`) across its versions, and its class name
 * is its own business — so match loosely on the name and precisely on the
 * actor, and treat "nothing found" as the normal case.
 */
function dollWindowsFor(actorId) {
  const found = [];
  const matches = (w) => {
    if (!/paper.?doll/i.test(w?.constructor?.name ?? "")) return false;
    const actor = w.actor ?? w.object ?? w.document;
    return actor?.id === actorId;
  };
  for (const w of Object.values(ui.windows ?? {})) if (matches(w)) found.push(w);
  for (const w of globalThis.foundry?.applications?.instances?.values?.() ?? []) if (matches(w)) found.push(w);
  return found;
}

/**
 * Close the doll with its sheet. A safety net, not the mechanism: Paper Doll
 * 3.x patches `sheet.close` to take itself down, so normally it is already
 * gone by the time this runs and there is nothing to find. It stays for the
 * case where that patch was lost — a second doll instance on one actor wraps
 * the first's wrapper, and closing those out of order leaves the sheet holding
 * a dead window's close, after which the doll outlives its sheet.
 */
function closeDollWithSheet(app) {
  const actorId = app?.document?.id ?? app?.actor?.id;
  if (!actorId) return;
  for (const doll of dollWindowsFor(actorId)) {
    doll.close?.()?.catch?.(() => {});
  }
}

export function registerPaperDoll() {
  const strategy = activeStrategy();
  if (strategy !== "paperdoll") {
    console.debug(`${MODULE_ID} | Paper Doll not in use; max-per-type enforcement on the core inventory applies.`);
    return;
  }

  Hooks.on(PAPERDOLL_HOOKS.EQUIP, (actor, item, equipped, slotData) =>
    onPaperDollEquip(actor, item, equipped, slotData).catch((err) => console.error(`${MODULE_ID} | paper-doll-equip failed`, err)),
  );
  Hooks.on(PAPERDOLL_HOOKS.SWAP, (actor, a, b) =>
    onPaperDollSwap(actor, a, b).catch((err) => console.error(`${MODULE_ID} | paper-doll-swap failed`, err)),
  );
  // Sheet ↔ doll mirror: any equipped change on either side updates the other.
  Hooks.on("updateItem", (item, changes) =>
    onItemEquippedChanged(item, changes).catch((err) => console.error(`${MODULE_ID} | paper-doll sync failed`, err)),
  );
  // An item created already-equipped (compendium import, duplication) lands on
  // the doll too; a deleted one leaves no stale slot behind.
  Hooks.on("createItem", (item) => {
    if (!item?.system?.equipped || item.parent?.documentName !== "Actor" || !item.parent.isOwner) return;
    placeInPaperDoll(item.parent, item).catch((err) => console.error(`${MODULE_ID} | paper-doll create sync failed`, err));
  });
  Hooks.on("deleteItem", (item) => {
    const actor = item?.parent;
    if (actor?.documentName !== "Actor" || !actor.isOwner) return;
    clearFromPaperDoll(actor, item).catch((err) => console.error(`${MODULE_ID} | paper-doll delete sync failed`, err));
  });
  // Opening the doll reconciles it to the sheet's truth, so it can never show
  // a stale picture no matter what happened while it was closed. Converges:
  // the second pass writes nothing, so render → sync → render terminates.
  Hooks.on("renderPaperDoll", (app) => {
    const actor = app?.actor;
    if (actor) syncActorToDoll(actor).catch((err) => console.error(`${MODULE_ID} | paper-doll reconcile failed`, err));
  });
  // The doll follows its sheet out. Fires for every ActorSheetV2 subclass —
  // core's sheets and the follower card alike.
  Hooks.on("closeActorSheetV2", (app) => closeDollWithSheet(app));

  if (game.user.isGM && !game.settings.get(MODULE_ID, SETTINGS.PAPERDOLL_CONFIGURED)) {
    configurePaperDoll().catch((err) => console.error(`${MODULE_ID} | Paper Doll configuration failed`, err));
  }
  // One reconciliation pass over owned characters at startup: gear equipped
  // while the doll was absent (or before this version) appears on it.
  for (const actor of game.actors?.filter?.((a) => a.type === "character" && a.isOwner) ?? []) {
    syncActorToDoll(actor).catch((err) => console.error(`${MODULE_ID} | initial doll sync failed for ${actor.name}`, err));
  }
  console.debug(`${MODULE_ID} | Paper Doll integration active (sheet ↔ doll mirror).`);
}
