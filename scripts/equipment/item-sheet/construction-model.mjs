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
import { SLOT, WEAR_SLOT_ORDER, slug } from "../../lib/vocab.mjs";

/** The three states a chip can be in. */
export const CHIP = Object.freeze({ ON: "on", AUTO: "auto", OFF: "off" });

/** The three hand places a weapon is held in — its own by construction. */
export const HAND_SLOTS = Object.freeze([SLOT.mainHand, SLOT.offHand, SLOT.bothHands]);

/** The two grips a strip offers; `versatile` is both lit. */
export const GRIP_CHIPS = Object.freeze(["1h", "2h"]);

/** Core's weapon tags that mirror a boolean field of the same name. */
export const TAG_FIELDS = Object.freeze(["melee", "missile", "slow"]);

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
 * One core tag on an item, as stored (`{title, value}`), matched against a
 * registry entry by any of its three spellings — the key, the label, or the
 * raw registry string — so a tag core's own sheet wrote, one this panel wrote
 * and one typed by hand all read as the same quality.
 */
const tagMatches = (tag, entry) => {
  const spellings = new Set([entry.key, entry.label, entry.raw].map(slug).filter(Boolean));
  return [tag?.title, tag?.value].some((t) => {
    const s = slug(t);
    return !!s && spellings.has(s);
  });
};

/**
 * Core's registered weapon tags as chips. Three of them mirror a boolean
 * field and read THAT, since the field is what the attack reads; the rest are
 * on when the tag is stored.
 * @param {{key: string, label: string, raw: string}[]} registry
 * @param {{title?: string, value?: string}[]} stored `system.tags`
 * @param {object} fields the item's `system`, for the mirrored booleans
 */
export function qualityChips(registry, stored, fields = {}) {
  return registry.map((entry) => ({
    key: entry.key,
    label: entry.label,
    on: TAG_FIELDS.includes(entry.key) ? !!fields[entry.key] : stored.some((t) => tagMatches(t, entry)),
  }));
}

/**
 * The `system` update one click on a quality writes: the tag list with that
 * quality added or removed, and the boolean it mirrors where it has one. The
 * stored value is the raw registry string, which is what core's own tag icons
 * match on; the title is the label a reader sees.
 */
export function nextQuality(registry, stored, key, on) {
  const entry = registry.find((e) => e.key === key);
  if (!entry) return null;
  const tags = stored.filter((t) => !tagMatches(t, entry));
  if (on) tags.push({ title: entry.label, value: entry.raw });
  const update = { tags };
  if (TAG_FIELDS.includes(key)) update[key] = on;
  return update;
}

/** The stored tags no registry entry names — the free text, as displayed. */
export function otherTags(registry, stored) {
  return stored
    .filter((t) => !registry.some((entry) => tagMatches(t, entry)))
    .map((t) => t.title || t.value)
    .filter(Boolean);
}

/** The tag list with a free-text tag added, or null when there is nothing to add. */
export function withTag(stored, text) {
  const title = String(text ?? "").trim();
  if (!title || stored.some((t) => (t.title || t.value) === title)) return null;
  return [...stored, { title, value: title }];
}

/** The tag list without the tag displayed as `text`. */
export function withoutTag(stored, text) {
  return stored.filter((t) => (t.title || t.value) !== text);
}
