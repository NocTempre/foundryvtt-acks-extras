/* global game, ui */
/**
 * Ammunition consumption + thrown-weapon state. See docs/equipment/DECISIONS.md,
 * "Ammunition does what RAW says and no more (2026-07-24)" for the scope
 * ruling. Called as a fire-and-forget side effect once the system's attack
 * throw has resolved (the lib's post-attack hook); never blocks or fails the
 * roll.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "./constants.mjs";
import { WEAPON_CATEGORY } from "./config.mjs";
import { isSilvered } from "./silver.mjs";
import { slug } from "../lib/vocab.mjs";
import { unset } from "../lib/util.mjs";
import { stackCountOf, foldIntoRest } from "../lib/item-model.mjs";
import { quantityOf } from "../lib/storage-logic.mjs";

/**
 * Ammo-name pattern a launcher consumes, or null if it is not a launcher. A bow
 * or a crossbow is told by the category the imported lists place it in; a
 * weapon with no category is no launcher here, and a sling is told by its name.
 * The category holds both, so which ammunition it takes is read from the
 * weapon's own name and its row's key: a crossbow, and an arbalest, which is a
 * heavy crossbow (RR ch. 4, Equipment Descriptions), take bolts; any other bow
 * arrows; a launcher whose name says neither takes either.
 */
export function launcherAmmoPattern(item, profile) {
  const n = slug(item?.name ?? "");
  if (profile?.cat === WEAPON_CATEGORY.BOW_CROSSBOW) {
    const named = `${n} ${slug(profile.key ?? "")}`;
    if (/crossbow|arbalest/.test(named)) return /bolt|quarrel/i;
    return /bow/.test(named) ? /arrow/i : /arrow|bolt|quarrel/i;
  }
  if (/sling/.test(n)) return /stone|bullet|shot/i;
  return null;
}

/** The count carried by an ammo/stackable item (core quantity, else our flag). */
export function roundsOf(item) {
  const q = stackCountOf(item);
  if (q != null) return q;
  const f = item?.getFlag?.(MODULE_ID, "rounds");
  return f != null ? Number(f) : 1;
}

/** Write a new count back to whichever field the item uses. */
async function setRounds(item, n) {
  const v = Math.max(0, n);
  const q = quantityOf(item);
  if (q) return item.update({ [q.path]: v });
  return item.setFlag(MODULE_ID, "rounds", v);
}

/**
 * Consume `n` of a stackable/consumable item (a lit torch, a flask of lamp oil).
 * The shared decrement primitive other features reuse instead of hand-rolling an
 * `item.update` — formation calls this via `globalThis.acksExtras?.equipment` so the
 * torch/oil burn-down and the ammunition tracker stay one code path. Degrades to
 * a no-op count of 1 for a single non-stackable item.
 * @returns {Promise<number>} the remaining count after consumption.
 */
export async function consumeItem(item, n = 1) {
  if (!item) return 0;
  const left = Math.max(0, roundsOf(item) - n);
  await setRounds(item, left);
  // A declaration dies with the stack it named: an empty quiver must not keep
  // governing which of the REMAINING stacks the next shot comes from.
  if (left <= 0 && item.getFlag?.(MODULE_ID, ITEM_FLAGS.NOCKED)) {
    await item.unsetFlag(MODULE_ID, ITEM_FLAGS.NOCKED);
  }
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

/**
 * Recover every thrown-away weapon on the actor. Manual — RAW has no
 * auto-recover. A recovered row that was drawn from a stack folds back into it.
 */
export async function recoverThrown(actor) {
  const away = actor.items.filter(isThrownAway);
  for (const i of away) {
    await i.unsetFlag(MODULE_ID, ITEM_FLAGS.THROWN_STATE);
    await foldIntoRest(i);
  }
  return away.map((i) => i.name);
}

/**
 * Consume ammunition (or mark a thrown weapon) for one attack. Called after the
 * roll; swallows its own errors so a hiccup never breaks the attack.
 * @param {Actor} actor
 * @param {Item} item      the weapon rolled
 * @param {object} profile classifyWeapon(item)
 * @param {{type?:string}} options  options.type: "melee" | "missile" | "attack" —
 *   a thrown attack arrives as "missile"; "attack" is a caller that does not
 *   know how the weapon was used, and the weapon's own flags decide.
 */
export async function consumeForAttack(actor, item, profile, options = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AMMO_TRACKING)) return;
  // Missile only when the weapon can ONLY be used at range, so a dual-mode
  // weapon (hand axe) is not wrongly treated as thrown on a melee swing.
  const isMissile =
    options.type === "missile" ||
    (options.type === "attack" && item.system?.missile && !item.system?.melee);
  if (!isMissile) return; // only ranged/thrown attacks consume
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

  // Otherwise it is a launcher: find and decrement the matching ammunition,
  // the stack `shotStack` names (the stack whose hit `onHitOf` reads).
  if (!launcherAmmoPattern(item, profile)) return; // a pure-thrown missile (bola/oil) is handled above; unknown → skip
  const ammo = shotStack(actor, item, profile);
  if (!ammo) {
    notify("outOf", { item: item.name });
    return;
  }
  const left = roundsOf(ammo) - 1;
  await setRounds(ammo, left);
  notify(isSilvered(ammo) ? "firedSilver" : "fired", { ammo: ammo.name, left });
}

/**
 * Which stack the shot comes out of: plain ammunition is spent first, silver
 * (RR ch.4) only once it is what is left. The archer can override with a
 * declaration held on the stack's own `nocked` flag, which outranks the
 * plain-first default for as long as the stack lasts. See
 * docs/equipment/DECISIONS.md, "Plain ammunition is spent before silver
 * (2026-09-22)".
 *
 * Never gate this on `system.equipped`: an ammunition stack is an `item`,
 * and only `weapon`/`armor` carry that field.
 */
function pickAmmo(items, pattern) {
  const stacks = items.filter((i) => pattern.test(i.name) && roundsOf(i) > 0);
  const declared = stacks.find((i) => flagOf(i, ITEM_FLAGS.NOCKED));
  return declared ?? stacks.find((i) => !isSilvered(i)) ?? stacks[0] ?? null;
}

/** A module flag read off a live document or a plain data object alike. */
function flagOf(item, key) {
  return item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
}

/**
 * The stack one shot from `weapon` comes out of, or null: the weapon is no
 * launcher, or the actor holds no matching stack with rounds left. The order is
 * `pickAmmo`'s (a nocked stack, else plain before silver), and it is the one
 * answer both the spend (`consumeForAttack`) and the hit's reader ask, so the
 * stack that is spent is the stack whose `onHitOf` asks the save. Pure: it
 * reads `actor.items` and writes nothing, and a plain `{items: [payload]}`
 * (a creature not yet created) answers alike.
 * @param {{items: Iterable<object>}} actor
 * @param {object} weapon   the launcher
 * @param {object} profile  classifyWeapon(weapon)
 */
export function shotStack(actor, weapon, profile) {
  const pattern = launcherAmmoPattern(weapon, profile);
  if (!pattern || !actor?.items) return null;
  return pickAmmo(actor.items, pattern);
}

/**
 * What a hit with this ammunition asks, from the stack's `onHit` flag:
 * `{saveKind, saveMod, formula, delayTurns, source, cite}`, or null where the
 * stack carries none. A flag that names no damage dice or no whole count of
 * turns is no effect and reads null; a blank save kind or modifier stays null.
 * @returns {{saveKind: string|null, saveMod: number|null, formula: string, delayTurns: number, source: string, cite: string}|null}
 */
export function onHitOf(stack) {
  const raw = flagOf(stack, ITEM_FLAGS.ON_HIT);
  if (!raw || typeof raw !== "object") return null;
  const formula = typeof raw.formula === "string" ? raw.formula.trim() : "";
  const delayTurns = Number(raw.delayTurns);
  if (!formula || !Number.isInteger(delayTurns) || delayTurns < 1) return null;
  const kind = typeof raw.saveKind === "string" ? raw.saveKind.trim() : "";
  const mod = Number(raw.saveMod);
  return {
    saveKind: kind || null,
    saveMod: raw.saveMod !== null && raw.saveMod !== undefined && raw.saveMod !== "" && Number.isFinite(mod) ? mod : null,
    formula,
    delayTurns,
    source: String(raw.source ?? "").trim(),
    cite: String(raw.cite ?? "").trim(),
  };
}

/**
 * Declare which stack to fire next. Exclusive per matching kind — nocking one
 * quiver un-nocks the others, because "fire these" is a single answer.
 */
export async function nockAmmo(actor, item) {
  if (!actor || !item) return false;
  const updates = actor.items
    .filter((i) => i.getFlag(MODULE_ID, ITEM_FLAGS.NOCKED) && i.id !== item.id)
    .map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.${ITEM_FLAGS.NOCKED}`]: unset() }));
  const on = !item.getFlag(MODULE_ID, ITEM_FLAGS.NOCKED);
  updates.push(
    on
      ? { _id: item.id, [`flags.${MODULE_ID}.${ITEM_FLAGS.NOCKED}`]: true }
      : { _id: item.id, [`flags.${MODULE_ID}.${ITEM_FLAGS.NOCKED}`]: unset() },
  );
  await actor.updateEmbeddedDocuments("Item", updates);
  return on;
}
