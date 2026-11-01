/**
 * An encounter line as a stat block prints it: one or two sides split on a
 * slash, the wandering group first and the lair second, each a noun with its
 * count in parentheses. A side is `{noun, number, unit}`: `number` is a formula
 * core's `Roll` accepts, and `unit` is the word it counts when that is not
 * bodies, so a unit's count is never rolled as a headcount. Foundry-free; the
 * importer, the monster sheet and the group all read lines through this file.
 */

/** A die or a figure, a sum on it, a multiplier, and whatever follows. */
const COUNT = /^(\d+(?:d\d+)?)([+-]\d+|\s+[+-]\s+\d+(?=\s*(?:[×x*]\s*\d|$)))?(?:\s*[×x*]\s*(\d+))?\s*(.*)$/i;

/** What may follow a count and leave it a count of this creature: others beside it. */
const COMPANY = /^(?:\+|plus\b)/i;

/** A unit's word. A digit means the text is not a count this grammar reads. */
const UNIT = /^[a-z][a-z' -]*$/i;

const emptySide = () => ({ noun: "", number: "", unit: "" });

/** `number` and `unit` from a count's text, or null where the grammar stops. */
function parseCount(text) {
  const m = COUNT.exec(text);
  if (!m) return null;
  const sum = `${m[1]}${(m[2] ?? "").replace(/\s+/g, "")}`.toLowerCase();
  const number = !m[3] ? sum : `${m[2] ? `(${sum})` : sum}*${m[3]}`;
  const tail = m[4].trim();
  if (!tail || COMPANY.test(tail)) return { number, unit: "" };
  return UNIT.test(tail) ? { number, unit: tail } : null;
}

/** One side. Text with no parentheses is a count where it reads as one, else a noun. */
function parseSide(text) {
  const t = String(text ?? "").trim();
  if (!t || /^none\b/i.test(t)) return emptySide();
  const paren = /^([^(]*)\(\s*(.*?)\s*\)\s*$/.exec(t);
  const count = parseCount(paren ? paren[2] : t);
  const noun = paren ? paren[1].trim() : count ? "" : t;
  return { ...emptySide(), noun, ...count };
}

/**
 * Read one encounter line. A line of one side is wandering only: the page prints
 * no lair count there and none is inferred.
 *
 * @param {string} [value] the line as extracted
 * @returns {{wandering: object, lair: object}|null} null for a blank or "none" line
 */
export function parseEncounterLine(value) {
  const text = String(value ?? "").trim();
  if (!text || /^none\b/i.test(text)) return null;
  const [wandering, lair] = text.split("/");
  return { wandering: parseSide(wandering), lair: parseSide(lair) };
}

/**
 * The formula a number-appearing roll may use: the first side that states a
 * count, blank when that count is in units.
 *
 * @param {{wandering?: object, lair?: object}} [line] one context's parsed line
 * @returns {string}
 */
export function appearingFormula(line) {
  const side = line?.wandering?.number ? line.wandering : line?.lair;
  return side?.number && !side.unit ? String(side.number).trim() : "";
}

/** A side's count as a reader sees it, its unit named. */
export function countText(side) {
  return [side?.number, side?.unit].filter(Boolean).join(" ");
}

/**
 * The core `details.appearing` fields an edit of the lines changes. A field
 * keeps its value unless its line's formula moved, so a formula typed into core
 * on a monster with no lines stays; a count that turns to units blanks it.
 *
 * @param {object} [stored] `extras.encounter` before the edit
 * @param {object} [next] `extras.encounter` after it
 * @returns {{d?: string, w?: string}}
 */
export function appearingChanges(stored, next) {
  const changes = {};
  for (const [context, key] of [["dungeon", "d"], ["wilderness", "w"]]) {
    const formula = appearingFormula(next?.[context]);
    if (formula !== appearingFormula(stored?.[context])) changes[key] = formula;
  }
  return changes;
}
