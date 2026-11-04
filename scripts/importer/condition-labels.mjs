/**
 * The neutral labels a register recipe may ship in a row's prose fields, and
 * the gate on what those fields may hold.
 *
 * A row's `condition`, a limitation's `restriction` and an outcome's
 * `consequence` are shown on the Mechanics tab, a roll's card, the henchmen
 * and influence dialogs. Whatever the page says reaches the world only through
 * the seat's own book: a `conditionFrom`, `restrictionFrom` or
 * `consequenceFrom` locator reads it at import (`executor.mjs`
 * `locateCondition`). What ships is a label naming what KIND of thing the row
 * holds, the module's own words, shown where the locator misses. The compiler
 * appends the entry's page reference to it (`citeLabel`), so a reader can open
 * the page it stands for; `lint-register.mjs` refuses any such field of more
 * than two words that is not one of these.
 *
 * A row's `note` is the module's own remark on the row. No pattern can tell a
 * remark on the module from a paraphrase of the rule, so that half needs a
 * reviewer; `noteProblem` refuses only what a machine can decide: a figure
 * outside a page reference, and an open TODO.
 *
 * Pure: the compiler, the lint and the tests import it without Foundry.
 */

/** The condition labels, each naming a kind of condition and saying nothing of what the page states. */
export const CONDITION_LABELS = Object.freeze([
  "situational",
  "while leading",
  "while present",
  "for some followers",
  "against a creature kind",
  "for an ally",
  "in some places",
  "with some weapons",
  "in some armour",
  "for some items",
  "by method",
  "by speed",
  "by rank",
  "with a prerequisite",
  "by the offer",
  "by the subject",
  "against some traps",
  "on a failed throw",
]);

/** The restriction labels: what kind of limit a limitation row holds. */
export const RESTRICTION_LABELS = Object.freeze(["a use limit", "a retry limit", "a sense limit"]);

/** The consequence labels: what kind of result an outcome row holds. */
export const CONSEQUENCE_LABELS = Object.freeze(["a mishap", "a fall"]);

/** Each labelled prose field, with the labels it may ship. */
export const LABELLED_FIELDS = Object.freeze({
  condition: new Set(CONDITION_LABELS),
  restriction: new Set(RESTRICTION_LABELS),
  consequence: new Set(CONSEQUENCE_LABELS),
});

/** A trailing page reference as `citeLabel` writes it: " (RR p.24)". */
const CITE_TAIL = /\s\([A-Z][A-Za-z0-9]{0,5} p\.\d+\)$/;

/** Any page reference inside a remark: "(RR p.24)", "p. 333", "its p.57". */
const PAGE_REF = /\b(?:[A-Z][A-Za-z0-9]{0,5}\s)?p\.\s?\d+/g;

/** The label a field carries, with any page reference `citeLabel` gave it removed. */
export const bareLabel = (value) => String(value ?? "").replace(CITE_TAIL, "");

/** True when a field's value is one of that field's neutral labels, cited or not. */
export const isLabel = (value, field = "condition") => !!LABELLED_FIELDS[field]?.has(bareLabel(value));

/** True when a condition is one of the neutral condition labels, cited or not. */
export const isConditionLabel = (condition) => isLabel(condition, "condition");

/** A value of at most two words: a scope's own name ("melee", "while enraged"), which ships as is. */
export const isShortCondition = (value) => String(value ?? "").trim().split(/\s+/).filter(Boolean).length <= 2;

/**
 * A neutral label with the entry's page reference after it, for the compiler;
 * any other value is returned unchanged.
 */
export function citeLabel(value, cite, field = "condition") {
  if (typeof value !== "string" || !LABELLED_FIELDS[field]?.has(value) || !cite) return value;
  return `${value} (${cite})`;
}

/**
 * Why a shipped labelled field is refused, or null: one longer than two words
 * that is not one of the field's neutral labels states what the page says.
 */
export function fieldProblem(field, value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return `a ${field} is a string`;
  if (isShortCondition(value) || isLabel(value, field)) return null;
  return `${field} "${value}" is neither a neutral label (scripts/importer/condition-labels.mjs) nor two words; read the page's words with ${field}From`;
}

/** Why a shipped condition is refused, or null (`fieldProblem` for `condition`). */
export const conditionProblem = (condition) => fieldProblem("condition", condition);

/**
 * Why a shipped note is refused, or null: a figure outside a page reference
 * is a page value, and a TODO is unbuilt work, which is a ROADMAP line.
 */
export function noteProblem(note) {
  if (note == null || note === "") return null;
  if (typeof note !== "string") return "a note is a string";
  if (/\b(?:TODO|FIXME)\b/.test(note)) return `note "${note}" carries a TODO; unbuilt work is a ROADMAP line`;
  if (/\d/.test(note.replace(PAGE_REF, ""))) return `note "${note}" carries a figure; a number is read off the page, never written in a note`;
  return null;
}
