/* global game, ui, Hooks, foundry */
/**
 * Equip-limit enforcement. Core toggles `system.equipped` through `item.update`
 * (the sheet action `#itemToggleEquipped` is private), so `preUpdateItem` /
 * `updateItem` are the correct, non-invasive seam — no core patch.
 *
 * Modes (setting `enforceMode`):
 *   resolve  (default) — allow, then auto-unequip the conflicting item(s) to a
 *                         legal RAW end-state, with a warning.
 *   veto              — cancel the equip in preUpdate with an explanatory notice.
 *   advisory          — never block or change; just flag the illegal loadout.
 */
import { MODULE_ID, SETTINGS, ENFORCE, HOOKS } from "./constants.mjs";
import { getLoadout, VIOLATION } from "./loadout.mjs";
import { syncLoadoutEffect } from "./effects.mjs";

/** Is this an equip-state change on a wearable item of a character? */
function isEquipToggle(item, changes) {
  if (!item?.parent || item.parent.documentName !== "Actor") return false;
  if (!["weapon", "armor"].includes(item.type)) return false;
  return foundry.utils.hasProperty(changes, "system.equipped");
}

function mode() {
  return game.settings.get(MODULE_ID, SETTINGS.ENFORCE_MODE) ?? ENFORCE.RESOLVE;
}

/**
 * Exactly one client performs loadout WRITES (auto-unequip, effect sync) to
 * avoid duplicate effects on actors owned by both a player and the GM: the
 * active GM if one is online, else the actor's owner. (Phase 4 replaces this
 * with explicit socketlib routing to the primary GM.)
 */
export function primaryResponder(actor) {
  if (game.users.activeGM) return game.users.activeGM.isSelf;
  return !!actor?.isOwner;
}

/**
 * Loadout automation is a character-only concern. Monsters (and any other actor
 * type) never carry an Equipment Loadout effect, so we must never react to their
 * item/effect churn — doing so spawned phantom "Equipment Loadout" effects and a
 * storm of "ActiveEffect does not exist" races when another module rewrote a
 * monster's embedded items. This is the single gate every write path checks.
 */
export const managesLoadout = (actor) => actor?.type === "character";

/** Blocking (non-advisory) violations of a loadout. */
function blockingViolations(loadout) {
  return loadout.violations.filter((v) => !v.advisory);
}

function violationMessage(v) {
  const key = `ACKS-EQUIPMENT.violation.${v.type}`;
  const names = (v.items ?? []).map((i) => i.name).join(", ");
  if (game.i18n.has(key)) return game.i18n.format(key, { items: names, ...(v.detail ?? {}) });
  switch (v.type) {
    case VIOLATION.HAND_OVERFLOW:
      return `Not enough hands (${v.detail.handsUsed}/${v.detail.budget}) — free up: ${names}.`;
    case VIOLATION.MULTIPLE_ARMOR:
      return `Only one suit of armour may be worn; ${names} is already worn.`;
    case VIOLATION.TOO_MANY_SHIELDS:
      return `A combatant may wield at most two shields; ${names} exceeds that.`;
    default:
      return `Illegal loadout: ${names}.`;
  }
}

/**
 * preUpdate: in veto mode, cancel an equip that would create a blocking
 * violation. Returns false to abort the update.
 */
export function onPreUpdateItem(item, changes) {
  if (mode() !== ENFORCE.VETO) return true;
  if (!isEquipToggle(item, changes)) return true;
  const newEquipped = foundry.utils.getProperty(changes, "system.equipped");
  if (!newEquipped) return true; // unequipping never violates

  const overrides = new Map([[item.id, true]]);
  const loadout = getLoadout(item.parent, { overrides });
  const blocking = blockingViolations(loadout);
  if (!blocking.length) return true;

  const reason = blocking.map(violationMessage).join(" ");
  ui.notifications.warn(`${item.name}: ${reason}`);
  Hooks.callAll(HOOKS.EQUIP_BLOCKED, item.parent, item, { reason, resolution: "veto" });
  return false;
}

/**
 * updateItem: after an equip change lands, resolve/advise and (always) rebuild
 * the loadout Active Effect. Runs on clients that own the actor.
 */
export async function onUpdateItem(item, changes) {
  if (!item?.parent || item.parent.documentName !== "Actor") return;
  // Only react to equip toggles (and never to our own AE writes elsewhere).
  if (!isEquipToggle(item, changes)) return;
  const actor = item.parent;
  if (!managesLoadout(actor) || !primaryResponder(actor)) return;

  const loadout = getLoadout(actor);
  const blocking = blockingViolations(loadout);

  if (blocking.length && mode() === ENFORCE.RESOLVE) {
    await autoResolve(actor, loadout, blocking);
    return; // autoResolve triggers a fresh updateItem which rebuilds the effect
  }
  if (blocking.length && mode() === ENFORCE.ADVISORY) {
    ui.notifications.info(`${actor.name}: ${blocking.map(violationMessage).join(" ")}`);
  }

  await syncLoadoutEffect(actor, loadout);
  Hooks.callAll(HOOKS.LOADOUT_CHANGED, actor, loadout);
}

/**
 * Auto-unequip the minimum set of items to reach a legal loadout, newest-first.
 */
async function autoResolve(actor, loadout, blocking) {
  const toUnequip = new Map(); // itemId → item
  for (const v of blocking) {
    if (v.type === VIOLATION.MULTIPLE_ARMOR || v.type === VIOLATION.TOO_MANY_SHIELDS) {
      for (const it of v.items) toUnequip.set(it.id, it);
    } else if (v.type === VIOLATION.HAND_OVERFLOW) {
      // Drop candidates (shields first, then extra weapons) until hands fit.
      let over = loadout.handsUsed - loadout.handBudget;
      for (const it of v.items) {
        if (over <= 0) break;
        toUnequip.set(it.id, it);
        over -= 1; // each freed 1-hand item; approximation, re-checked below
      }
    }
  }
  if (!toUnequip.size) return;

  const updates = [...toUnequip.values()].map((it) => ({ _id: it.id, "system.equipped": false }));
  await actor.updateEmbeddedDocuments("Item", updates);
  const names = [...toUnequip.values()].map((i) => i.name).join(", ");
  ui.notifications.warn(
    game.i18n.has("ACKS-EQUIPMENT.notify.autoUnequipped")
      ? game.i18n.format("ACKS-EQUIPMENT.notify.autoUnequipped", { items: names })
      : `Auto-unequipped to keep a legal loadout: ${names}.`,
  );
  for (const v of blocking) Hooks.callAll(HOOKS.EQUIP_BLOCKED, actor, v.items?.[0], { reason: violationMessage(v), resolution: "resolve" });
}

/** Rebuild the loadout effect without an equip toggle (e.g. style/prof change). */
export async function refreshLoadout(actor) {
  if (!managesLoadout(actor) || !primaryResponder(actor)) return;
  const loadout = getLoadout(actor);
  await syncLoadoutEffect(actor, loadout);
  Hooks.callAll(HOOKS.LOADOUT_CHANGED, actor, loadout);
}
