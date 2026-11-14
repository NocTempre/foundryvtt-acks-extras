/* global game */
/**
 * Overlay: named arms & armour (JJ p. 399; equipment RULES.md §13).
 * Gated by the `overlayNamed` world setting.
 *
 * Speaking an item's name unlocks its powers:
 *
 *  - Speaking the TRUE name unlocks all powers at once.
 *  - An unsure character may GUESS ONCE, and not again until reaching a higher
 *    level of experience, so guesses are tracked per character, per level.
 *  - Re-naming instead unlocks ONE point of bonus in one category, then one more
 *    per level of experience earned while wielding/wearing it.
 *  - The JUDGE sets the unlock order; it is never auto-picked.
 *  - Progress lives on the ITEM and survives its wielder: a new wielder inherits
 *    the points unlocked so far and advances them on their own level-ups.
 *
 * The item keeps no renown or XP track of its own.
 * Unlocked points are applied to fields core already owns (bonus.attack, the
 * base damage formula, ac.value, weight6), as masterwork does.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { attackBonusOf, damageFormulaOf } from "../properties.mjs";

/**
 * Bonus categories a named item can unlock (JJ p. 399): each with the lang key
 * of its label and the item field its points are applied to, null where the
 * points are applied to none.
 */
export const NAMED_CATEGORIES = Object.freeze({
  hit: { label: "ACKS-EQUIPMENT.itemSheet.named.cat.hit", field: "bonus" },
  damage: { label: "ACKS-EQUIPMENT.itemSheet.named.cat.damage", field: "damage" },
  ac: { label: "ACKS-EQUIPMENT.itemSheet.named.cat.ac", field: "ac" },
  encumbrance: { label: "ACKS-EQUIPMENT.itemSheet.named.cat.encumbrance", field: "weight6" },
  power: { label: "ACKS-EQUIPMENT.itemSheet.named.cat.power", field: null },
});

/** Whether the `overlayNamed` world setting is on. */
export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_NAMED);

/**
 * Should this viewer see the named-item badge/tracker? A named item shows its
 * tracker, except to a non-GM while the item wears an apparent identity; a GM
 * also gets the badge on unnamed gear (to name it) while the overlay is on.
 * Pure on its inputs.
 */
export function trackerVisible({ isNamed: namedItem, disguised, isGM, overlayOn }) {
  if (namedItem) return isGM || !disguised;
  return !!(overlayOn && isGM);
}

/** The named-item record on an item, or null. */
export function namedOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.NAMED) ?? null;
}

/** Whether the item carries a named-item record. */
export function isNamed(item) {
  return !!namedOf(item);
}

/**
 * The ladder the Judge set: an ordered list of category keys, one entry per
 * point of bonus, e.g. ["damage","hit","damage","hit"].
 */
export function ladderOf(item) {
  const rec = namedOf(item);
  return Array.isArray(rec?.ladder) ? rec.ladder : [];
}

/** The item's total rung count: the ladder's length, 0 until the Judge sets the unlock order. */
export function maxOf(item) {
  return ladderOf(item).length;
}

/** How many rungs are currently unlocked, bounded by the ladder; every rung once the true name is known. */
export function unlockedCount(item) {
  const rec = namedOf(item);
  if (rec?.revealed) return ladderOf(item).length;
  return Math.max(0, Math.min(Number(rec?.unlocked ?? 0), ladderOf(item).length));
}

/** Totals per category for the unlocked rungs. */
export function unlockedBonuses(item) {
  const ladder = ladderOf(item);
  const n = unlockedCount(item);
  const out = { hit: 0, damage: 0, ac: 0, encumbrance: 0, power: 0 };
  for (let i = 0; i < n; i++) {
    const key = ladder[i];
    if (key in out) out[key] += 1;
  }
  return out;
}

/** Does a spoken name match the item's true name? Case/space-insensitive. */
export function nameMatches(item, spoken) {
  const rec = namedOf(item);
  if (!rec?.trueName) return false;
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return norm(rec.trueName) === norm(spoken);
}

/**
 * May this character guess the name right now? One guess, then none until the
 * next level of experience (JJ p. 399): allowed only if the character has never
 * guessed, or has gained a level since their last guess.
 */
export function canGuess(item, actor) {
  const rec = namedOf(item);
  if (!rec) return false;
  if (rec.revealed) return false;
  const last = rec.guesses?.[actor.id];
  if (last == null) return true;
  return Number(actor.system?.details?.level ?? 1) > Number(last);
}

/**
 * Resolve a guess. A correct guess reveals the true name and unlocks everything;
 * a wrong one records the guesser's level and locks them out until they level.
 * @returns {{allowed:boolean, correct:boolean, updates:object}}
 */
export function resolveGuess(item, actor, spoken) {
  if (!canGuess(item, actor)) return { allowed: false, correct: false, updates: {} };
  const rec = namedOf(item);
  const correct = nameMatches(item, spoken);
  const guesses = { ...(rec.guesses ?? {}) };
  const updates = {};
  if (correct) {
    updates[`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.revealed`] = true;
    updates[`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.givenName`] = rec.trueName;
    updates.name = rec.trueName; // the item is thereafter called by its true name
  } else {
    guesses[actor.id] = Number(actor.system?.details?.level ?? 1);
    updates[`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.guesses`] = guesses;
  }
  return { allowed: true, correct, updates };
}

/**
 * The item's mundane stats, captured once so unlocking is idempotent: every
 * application recomputes from this base, never from the modified value.
 */
export function captureBase(item) {
  return {
    bonus: attackBonusOf(item),
    damage: damageFormulaOf(item) || "1d6",
    // The stored record names the armour class `aac`.
    aac: Number(item.system?.ac?.value ?? 0),
    weight6: Number(item.system?.weight6 ?? 0),
  };
}

/** The stored base stats, falling back to the item's current values. */
export function baseOf(item) {
  return namedOf(item)?.base ?? captureBase(item);
}

/**
 * Re-name a found item: naming it grants one point immediately and renames the
 * item document. Captures the mundane base stats on first naming.
 */
export function renameUpdates(item, givenName, wielderLevel) {
  const rec = namedOf(item) ?? {};
  const updates = {
    name: givenName,
    [`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.givenName`]: givenName,
    [`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.unlocked`]: Math.max(1, Number(rec.unlocked ?? 0)),
    [`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.namedAtLevel`]: Number(wielderLevel ?? 1),
    [`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.revealed`]: false,
  };
  if (!rec.base) updates[`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.base`] = captureBase(item);
  return updates;
}

/**
 * Everything an item needs written after its unlocked count changes: the core
 * fields recomputed from the captured base. Idempotent by construction.
 */
export function applyUpdates(item) {
  return toItemUpdates(item, baseOf(item));
}

/**
 * Advance every named item the actor currently wields, then restate its bonuses.
 * Driven by a level-up, not the wielder's absolute level.
 * @returns {{item, updates:object}[]}
 */
export function advanceWieldedOnLevelUp(actor) {
  const out = [];
  for (const item of actor.items ?? []) {
    if (!isNamed(item) || !item.system?.equipped) continue;
    const advance = advanceOnLevelUp(item);
    if (!advance) continue;
    // Recompute from base using the POST-advance count.
    const rec = namedOf(item);
    const next = { ...rec, unlocked: Number(rec.unlocked ?? 0) + 1 };
    const preview = { ...item, getFlag: (_m, k) => (k === ITEM_FLAGS.NAMED ? next : item.getFlag?.(_m, k)) };
    out.push({ item, updates: { ...advance, ...toItemUpdates(preview, baseOf(item)) } });
  }
  return out;
}

/**
 * Advance the ladder when the current wielder gains a level: driven by the
 * level-up event, never by the wielder's absolute level.
 * @returns {object|null} item updates, or null when nothing advances
 */
export function advanceOnLevelUp(item) {
  const rec = namedOf(item);
  if (!rec || rec.revealed) return null;
  const ladder = ladderOf(item);
  const now = unlockedCount(item);
  if (now >= ladder.length) return null;
  return { [`flags.${MODULE_ID}.${ITEM_FLAGS.NAMED}.unlocked`]: now + 1 };
}

/**
 * Apply the unlocked bonuses to the fields core already owns.
 * Called with the item's BASE values so repeated application is idempotent.
 */
export function toItemUpdates(item, base = {}) {
  const b = unlockedBonuses(item);
  const updates = {};
  if (item.type === ITEM_TYPE.weapon) {
    if (b.hit) updates["system.bonus.attack"] = Number(base.bonus ?? attackBonusOf(item)) + b.hit;
    if (b.damage) updates["system.damage.base.formula"] = `${base.damage ?? damageFormulaOf(item) ?? "1d6"}+${b.damage}`;
  }
  if (item.type === ITEM_TYPE.armor && b.ac) {
    updates["system.ac.value"] = Number(base.aac ?? item.system?.ac?.value ?? 0) + b.ac;
  }
  if (b.encumbrance) {
    updates["system.weight6"] = Math.max(0, Number(base.weight6 ?? item.system?.weight6 ?? 0) - b.encumbrance * 6);
  }
  return updates;
}
