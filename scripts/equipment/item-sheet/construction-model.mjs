/**
 * The Construction panel's decisions, on plain data — which chips a toggle
 * strip shows, in what state, and what one click on a chip writes. No Foundry
 * in reach: `construction.mjs` reads the item and binds the writes, and this
 * is what `tools/test-item-sheet.mjs` asserts.
 *
 * A strip shows EVERY option, always, and colours the ones that apply. Three
 * states, because a declaration outranks an inference and the sheet has to
 * show which of the two it is looking at:
 *
 *   on    — declared: the flag says so
 *   auto  — inferred: nothing is declared and inference answers this
 *   off   — neither
 *
 * A locked chip is lit by construction (a weapon's hands) and is not offered
 * for change. The first click on any option chip declares the INFERRED set
 * with that one change, so a Judge edits from what the module already
 * believes rather than from nothing; the strip's Auto chip is the one control
 * that clears a declaration.
 */
import { SLOT, WEAR_SLOT_ORDER } from "../../lib/vocab.mjs";

/** The three states a chip can be in. */
export const CHIP = Object.freeze({ ON: "on", AUTO: "auto", OFF: "off" });

/** The three hand places a weapon is held in — its own by construction. */
export const HAND_SLOTS = Object.freeze([SLOT.mainHand, SLOT.offHand, SLOT.bothHands]);

/** The two grips a strip offers; `versatile` is both lit. */
export const GRIP_CHIPS = Object.freeze(["1h", "2h"]);

/** The weapon's uses that are a boolean field of the system's own, beside its `special` properties. */
export const FIELD_QUALITIES = Object.freeze(["melee", "missile"]);

/**
 * The chips of one strip.
 * @param {string[]} options every option, in display order
 * @param {{declared: string[]|null, inferred: string[], locked?: string[]}} state
 *   `declared` null means nothing is declared and `inferred` stands
 * @returns {{key: string, state: string, locked: boolean}[]}
 */
export function stripChips(options, { declared, inferred, locked = [] }) {
  const effective = declared ?? inferred;
  const lit = declared ? CHIP.ON : CHIP.AUTO;
  return options.map((key) => ({
    key,
    state: effective.includes(key) ? lit : CHIP.OFF,
    locked: locked.includes(key),
  }));
}

/**
 * The set one click on `key` declares: the effective set with that key
 * flipped, in the order it already had. A locked key is never flipped.
 */
export function toggledSet({ declared, inferred, locked = [] }, key) {
  const effective = declared ?? inferred;
  if (locked.includes(key)) return [...effective];
  return effective.includes(key) ? effective.filter((k) => k !== key) : [...effective, key];
}

/** Where an item may sit, as chips: every slot, the hands locked on a weapon. */
export function placeChips({ declared, inferred, weapon }) {
  return stripChips(WEAR_SLOT_ORDER, { declared, inferred, locked: weapon ? HAND_SLOTS : [] });
}

/**
 * What one click on a place declares. A weapon keeps its hands, first, whatever
 * else is lit; an empty list is the "carried, worn nowhere" answer.
 */
export function nextPlaces({ declared, inferred, weapon }, key) {
  const next = toggledSet({ declared, inferred, locked: weapon ? HAND_SLOTS : [] }, key);
  return weapon ? [...HAND_SLOTS, ...next.filter((k) => !HAND_SLOTS.includes(k))] : next;
}

const gripSet = (grips) => (grips === "versatile" ? ["1h", "2h"] : grips ? [grips] : []);
const gripOf = (set) => {
  const one = set.includes("1h");
  const two = set.includes("2h");
  return one && two ? "versatile" : one ? "1h" : two ? "2h" : null;
};

/** The grips a weapon offers, as chips. */
export function gripChips({ declared, inferred }) {
  return stripChips(GRIP_CHIPS, { declared: declared ? gripSet(declared) : null, inferred: gripSet(inferred) });
}

/**
 * What one click on a grip declares — `1h`, `versatile` or `2h` — or null
 * when both would be off: a weapon nobody can hold is not an answer, so that
 * click hands the question back to the size table.
 */
export function nextGrips({ declared, inferred }, key) {
  return gripOf(toggledSet({ declared: declared ? gripSet(declared) : null, inferred: gripSet(inferred) }, key));
}

/**
 * A weapon's qualities as chips: its two uses, which are boolean fields of
 * the system's, and its special properties, which live under `special`. Each
 * is on when the item's field says so.
 * @param {{key: string, label: string}[]} registry the qualities offered, uses first
 * @param {object} fields the item's `system`
 */
export function qualityChips(registry, fields = {}) {
  return registry.map((entry) => ({
    key: entry.key,
    label: entry.label,
    on: FIELD_QUALITIES.includes(entry.key) ? !!fields[entry.key] : !!fields.special?.[entry.key],
  }));
}

/**
 * The `system` update one click on a quality writes: the use's own field, or
 * the special property's. Null for a key the registry does not offer.
 */
export function nextQuality(registry, key, on) {
  if (!registry.some((e) => e.key === key)) return null;
  return FIELD_QUALITIES.includes(key) ? { [key]: on } : { special: { [key]: on } };
}

/** The item's custom tags as displayed: the system's own set, in its order. */
export function otherTags(customTags) {
  return [...(customTags ?? [])].map((t) => String(t ?? "").trim()).filter(Boolean);
}

/** The custom tags with one added, or null when there is nothing to add. */
export function withTag(customTags, text) {
  const title = String(text ?? "").trim();
  const stored = otherTags(customTags);
  if (!title || stored.includes(title)) return null;
  return [...stored, title];
}

/** The custom tags without the one displayed as `text`. */
export function withoutTag(customTags, text) {
  return otherTags(customTags).filter((t) => t !== text);
}
