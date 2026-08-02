/* global game */
/**
 * Overlay: named arms & armour (JJ p. 399; acks-rules/acks-equipment/RULES.md §13).
 * Gated by the `overlayNamed` world setting.
 *
 * The name is the MECHANISM, not flavour: "only those who confidently speak the
 * name of the item receive the full benefit of its powers."
 *
 *  - Speaking the TRUE name → all powers unlock at once.
 *  - An unsure character may GUESS ONCE, and may not guess again until reaching
 *    a higher level of experience — so guesses are tracked per character, per
 *    level.
 *  - Re-naming instead unlocks ONE point of bonus in one category, then one more
 *    per level of experience earned while wielding/wearing it.
 *  - The JUDGE sets the unlock order ("You make the determination of the order in
 *    which the item's powers unlock") — this never auto-picks it.
 *  - Progress lives on the ITEM and survives its wielder: Marcus's +2/+2 hammer
 *    is "a +2 weapon in [Peristo's] hands", and advances on Peristo's level-ups.
 *
 * NOT RAW, deliberately absent: any renown/XP track of the item's own. RAW ties
 * unlocking to levels of experience earned while wielding.
 *
 * Reuse first: unlocked points are applied to fields core already owns
 * (system.bonus, the damage string, aac.value, weight6) — same as masterwork.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";

/** Bonus categories a named item can unlock (JJ p. 399). */
export const NAMED_CATEGORIES = Object.freeze({
  hit: { label: "+1 to hit", field: "bonus" },
  damage: { label: "+1 to damage", field: "damage" },
  ac: { label: "+1 to AC", field: "ac" },
  encumbrance: { label: "−1 to encumbrance", field: "weight6" },
  power: { label: "a special power or ceremonial spell", field: null },
});

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_NAMED);
}

/**
 * Should this viewer see the named-item badge/tracker?
 *
 * - A NAMED item shows its tracker (state on the item is always visible) —
 *   EXCEPT to a non-GM while the item wears an apparent identity: a disguise
 *   must hide that the item is anything special, and a "named" badge on a
 *   rusty sword gives the game away.
 * - A GM additionally gets the badge on unnamed gear (to name it) while the
 *   overlay is enabled.
 * Pure on its inputs so the rule is testable offline.
 */
export function trackerVisible({ isNamed: namedItem, disguised, isGM, overlayOn }) {
  if (namedItem) return isGM || !disguised;
  return !!(overlayOn && isGM);
}

/** The named-item record on an item, or null. */
export function namedOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.NAMED) ?? null;
}
export function isNamed(item) {
  return !!namedOf(item);
}

/**
 * The ladder the Judge set: an ordered list of category keys, one entry per
 * point of bonus. e.g. ["damage","hit","damage","hit","damage","hit"] is the
 * Tooth-Breaker example's +3/+3.
 */
export function ladderOf(item) {
  const rec = namedOf(item);
  return Array.isArray(rec?.ladder) ? rec.ladder : [];
}

/**
 * The item's total rung count FOR DISPLAY: the ladder's length, else the legacy
 * `max` some early records carry (a bare unlocked/max pair with no ladder — the
 * Judge has not set the unlock order yet, so no bonuses can apply, but the
 * tracker must still show its progress rather than pretending 0/0).
 */
export function maxOf(item) {
  const rec = namedOf(item);
  return ladderOf(item).length || Math.max(0, Number(rec?.max ?? 0));
}

/** How many rungs are currently unlocked (mechanics: bounded by the ladder). */
export function unlockedCount(item) {
  const rec = namedOf(item);
  if (rec?.revealed) return ladderOf(item).length; // true name known → full power
  return Math.max(0, Math.min(Number(rec?.unlocked ?? 0), ladderOf(item).length));
}

/** Unlocked rungs FOR DISPLAY — falls back to the legacy record's own count. */
export function unlockedDisplay(item) {
  const rec = namedOf(item);
  if (!rec) return 0;
  if (ladderOf(item).length) return rec.revealed ? ladderOf(item).length : unlockedCount(item);
  return Math.max(0, Math.min(Number(rec.unlocked ?? 0), maxOf(item)));
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
 * May this character guess the name right now? RAW: one guess, then none until
 * "reaching a higher level of experience" — so a guess is allowed only if the
 * character has never guessed, or has gained a level since their last guess.
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
 * The item's mundane stats, captured once so unlocking can be applied
 * idempotently: every application recomputes from the BASE rather than adding to
 * the already-modified value (which would compound on each level-up).
 */
export function captureBase(item) {
  return {
    bonus: Number(item.system?.bonus ?? 0),
    damage: String(item.system?.damage ?? "1d6"),
    aac: Number(item.system?.aac?.value ?? 0),
    weight6: Number(item.system?.weight6 ?? 0),
  };
}

/** The stored base stats, falling back to the item's current values. */
export function baseOf(item) {
  return namedOf(item)?.base ?? captureBase(item);
}

/**
 * Re-name a found item. RAW: naming it grants one point immediately, and the
 * item is thereafter called by that name — so the item document is renamed.
 * Captures the mundane base stats on first naming.
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
 * RAW counts levels of experience EARNED while wielding, so this is driven by a
 * level-up rather than the wielder's absolute level.
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
 * Advance the ladder when the current wielder gains a level. RAW counts levels
 * of experience EARNED while wielding, so this is driven by a level-up event
 * rather than by the wielder's absolute level (an item does not leap forward
 * when a high-level character picks it up).
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
  if (item.type === "weapon") {
    if (b.hit) updates["system.bonus"] = Number(base.bonus ?? item.system?.bonus ?? 0) + b.hit;
    if (b.damage) updates["system.damage"] = `${base.damage ?? item.system?.damage ?? "1d6"}+${b.damage}`;
  }
  if (item.type === "armor" && b.ac) {
    updates["system.aac.value"] = Number(base.aac ?? item.system?.aac?.value ?? 0) + b.ac;
  }
  if (b.encumbrance) {
    updates["system.weight6"] = Math.max(0, Number(base.weight6 ?? item.system?.weight6 ?? 0) - b.encumbrance * 6);
  }
  return updates;
}
