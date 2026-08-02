/* global game, ui */
/**
 * Ammunition consumption + thrown-weapon state (RAW-grounded).
 *
 * RAW (RR): a missile attack is "subject to available ammunition" (p304); a
 * bundle of 20 arrows/bolts is ONE inventory item (p144). The base rules give
 * no automatic recovery percentage — recovery is Judge's discretion and thrown
 * weapons come back by being picked up. So this module does exactly what RAW
 * specifies and no more (user decision, 2026-07-24):
 *
 *   - CONSUME on use: firing a launcher decrements its matching ammo by one;
 *     a stackable thrown weapon (a bundle of darts) decrements likewise.
 *   - THROWN STATE: a SINGLE thrown weapon (a hand axe, a lone javelin) is not
 *     destroyed — it is marked "thrown away", unequipped, and its weight is
 *     removed until recovered (encumbranceDelta6 excludes it).
 *   - NO retrieval automation: recovery is a manual action (the Recover macro
 *     clears the thrown state); fired ammo is restocked by hand, per RAW.
 *
 * Non-invasive: called as a fire-and-forget side effect AFTER the core roll in
 * the rollAttack wrap, never blocking or failing the roll.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "./constants.mjs";
import { WEAPON_CATEGORY, normalizeName } from "./config.mjs";

/** Ammo-name pattern a launcher consumes, or null if it is not a launcher. */
export function launcherAmmoPattern(item, profile) {
  const n = normalizeName(item?.name ?? "");
  if (profile?.cat === WEAPON_CATEGORY.BOW || (/bow/.test(n) && !/crossbow/.test(n))) return /arrow/i;
  if (profile?.cat === WEAPON_CATEGORY.CROSSBOW || /crossbow|arbalest/.test(n)) return /bolt|quarrel/i;
  if (/sling/.test(n)) return /stone|bullet|shot/i;
  return null;
}

/** The count carried by an ammo/stackable item (core quantity, else our flag). */
export function roundsOf(item) {
  const q = item?.system?.quantity?.value;
  if (q != null) return Number(q);
  const f = item?.getFlag?.(MODULE_ID, "rounds");
  return f != null ? Number(f) : 1;
}

/** Write a new count back to whichever field the item uses. */
async function setRounds(item, n) {
  const v = Math.max(0, n);
  if (item?.system?.quantity?.value != null) return item.update({ "system.quantity.value": v });
  return item.setFlag(MODULE_ID, "rounds", v);
}

/**
 * Consume `n` of a stackable/consumable item (a lit torch, a flask of lamp oil).
 * The shared decrement primitive other modules reuse instead of hand-rolling an
 * `item.update` — acks-formation calls this via `globalThis.acksEquipment` so the
 * torch/oil burn-down and the ammunition tracker stay one code path. Degrades to
 * a no-op count of 1 for a single non-stackable item.
 * @returns {Promise<number>} the remaining count after consumption.
 */
export async function consumeItem(item, n = 1) {
  if (!item) return 0;
  const left = Math.max(0, roundsOf(item) - n);
  await setRounds(item, left);
  return left;
}

function notify(key, data) {
  const full = `ACKS-EQUIPMENT.ammo.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.info?.(msg);
}

/** Mark a single thrown weapon as away (unequipped, weight removed) until recovered. */
export async function markThrown(item) {
  await item.update({
    "system.equipped": false,
    [`flags.${MODULE_ID}.${ITEM_FLAGS.THROWN_STATE}`]: true,
  });
}

/** Is this weapon currently thrown-away (weight excluded, awaiting recovery)? */
export function isThrownAway(item) {
  return !!item?.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE);
}

/** Recover every thrown-away weapon on the actor. Manual — RAW has no auto-recover. */
export async function recoverThrown(actor) {
  const away = actor.items.filter(isThrownAway);
  for (const i of away) await i.unsetFlag(MODULE_ID, ITEM_FLAGS.THROWN_STATE);
  return away.map((i) => i.name);
}

/**
 * Consume ammunition (or mark a thrown weapon) for one attack. Called after the
 * roll; swallows its own errors so a hiccup never breaks the attack.
 * @param {Actor} actor
 * @param {Item} item      the weapon rolled
 * @param {object} profile classifyWeapon(item)
 * @param {{type?:string}} options  "melee" | "missile"
 */
export async function consumeForAttack(actor, item, profile, options = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AMMO_TRACKING)) return;
  if (options.type !== "missile") return; // only ranged/thrown attacks consume
  if (!actor || !item) return;

  // A weapon used at range (a "missile" attack) is being THROWN — this covers a
  // melee-and-thrown weapon (hand axe, javelin), a pure-thrown missile (dart,
  // rock, bola), AND a thrown consumable (military oil, holy water). How it is
  // spent depends on the item:
  //   - a stack of more than one → decrement by one (you threw one of the pile);
  //   - a single SPLASH/consumable flask → it SHATTERS: spent, not recoverable;
  //   - a single reusable weapon (hand axe, bola) → marked thrown-away so it can
  //     be picked back up (RAW has no auto-recovery; the Recover macro clears it).
  if (profile?.thrown || profile?.melee) {
    const rounds = roundsOf(item);
    const shatters = profile?.special?.includes("splash") || profile?.special?.includes("consumable");
    if (rounds > 1) {
      await setRounds(item, rounds - 1);
      notify(shatters ? "usedStack" : "threwStack", { item: item.name, left: rounds - 1 });
    } else if (shatters) {
      await setRounds(item, 0); // shattered flask — gone, not recoverable
      notify("usedLast", { item: item.name });
    } else {
      await markThrown(item);
      notify("threwSingle", { item: item.name });
    }
    return;
  }

  // Otherwise it is a launcher: find and decrement the matching ammunition.
  const pattern = launcherAmmoPattern(item, profile);
  if (!pattern) return; // a pure-thrown missile (bola/oil) is handled above; unknown → skip
  const ammo = actor.items.find((i) => pattern.test(i.name) && roundsOf(i) > 0);
  if (!ammo) {
    notify("outOf", { item: item.name });
    return;
  }
  const left = roundsOf(ammo) - 1;
  await setRounds(ammo, left);
  notify("fired", { ammo: ammo.name, left });
}
