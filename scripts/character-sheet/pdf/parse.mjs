/**
 * Reading what a person wrote in a box of the official sheet: a number among
 * a running tally, a signed bonus, a throw written "11+", a percentage, a
 * dice formula, a list, and a line of gear with its count. Foundry-free.
 *
 * Hand-filled sheets are untidy on purpose — a player keeps a tally of hit
 * points or coin in one box — so every reader here takes what it can and
 * says null for what it cannot, and the caller keeps the whole text for notes.
 */

/** Any dash a keyboard or a word processor makes, read as a minus. */
const MINUS_RE = /[‒-―−]/g;

/** The text of a box with its line breaks made `\n` and its ends trimmed. */
export const clean = (text) => String(text ?? "").replace(/\r\n?/g, "\n").replace(MINUS_RE, "-").trim();

/** Every number written in a box, in order, signs kept and thousands commas read through. */
export function numbers(text) {
  return [...clean(text).replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** The last number in a box — where a running tally ends — or null. */
export const lastNumber = (text) => numbers(text).at(-1) ?? null;

/**
 * A box holding one number and nothing else to speak of: an optional sign, a
 * trailing `+` (a throw) or `%`, thousands commas. Null for anything else, so a
 * box someone wrote a sentence in is never read as the first figure in it.
 */
export function wholeNumber(text) {
  const t = clean(text).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const m = /^([+-]?\d+(?:\.\d+)?)\s*[+%]?$/.exec(t);
  return m ? Number(m[1]) : null;
}

/** A throw as a sheet writes it, "11+" or "11". */
export const throwValue = wholeNumber;

/** A dice formula in a box ("1d6+1", "d8", "2d4 - 1"), normalized, or null. */
export function diceText(text) {
  const m = /(\d*)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?/i.exec(clean(text));
  if (!m) return null;
  return `${m[1] || "1"}d${m[2]}${m[3] ? `${m[3]}${m[4]}` : ""}`;
}

/** A box's lines, blank ones kept: a column beside another is matched by position. */
export const rows = (text) => (clean(text) ? clean(text).split("\n").map((l) => l.trim()) : []);

/**
 * Split a list on `separators`, never inside brackets: "Weapon Focus (Swords,
 * Daggers), Alchemy" is two entries.
 */
export function splitOutside(text, separators = /[\n;,]/) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of clean(text)) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    if (depth === 0 && separators.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A list box (languages, class features): one entry per line, comma or semicolon. */
export const listEntries = (text) => splitOutside(text);

/** A count written before or after a name: "3 torches", "torches x3", "torches (3)", "3x torches". */
const COUNT_PATTERNS = [
  /^(\d+)\s*[x×]?\s+(.+)$/i,
  /^(.+?)\s*[x×]\s*(\d+)$/i,
  /^(.+?)\s*\((\d+)\)$/,
];

/**
 * One line of gear as a count and a name. A line naming no count is one of
 * the thing.
 * @returns {{qty: number, name: string}|null} null for a blank line
 */
export function countAndName(line) {
  const t = clean(line).replace(/^[-*•]\s*/, "");
  if (!t) return null;
  const [lead, trail, paren] = COUNT_PATTERNS.map((re) => re.exec(t));
  if (lead) return { qty: Number(lead[1]), name: lead[2].trim() };
  if (trail) return { qty: Number(trail[2]), name: trail[1].trim() };
  if (paren) return { qty: Number(paren[2]), name: paren[1].trim() };
  return { qty: 1, name: t };
}

/**
 * A proficiency as a sheet writes one: a name, a pick in brackets, a rank.
 * "Weapon Focus (Swords)" is a pick; "Alchemy (2)", "Alchemy x2" and
 * "Alchemy 2" are a rank; a bracket holding a throw ("Alchemy (11+)") is
 * neither, and is dropped.
 * @returns {{name: string, selection: string|null, rank: number}|null}
 */
export function abilityEntry(text) {
  let t = clean(text);
  if (!t) return null;
  let rank = 1;
  let selection = null;
  const tailRank = /\s*(?:[x×]\s*(\d+)|\((?:[x×]\s*)?(\d+)\)|\s(\d))$/i.exec(t);
  if (tailRank) {
    rank = Number(tailRank[1] ?? tailRank[2] ?? tailRank[3]);
    t = t.slice(0, tailRank.index).trim();
  }
  const pick = /\(([^()]*)\)\s*$/.exec(t);
  if (pick) {
    t = t.slice(0, pick.index).trim();
    if (!/^\s*\d+\s*\+?\s*$/.test(pick[1]) && pick[1].trim()) selection = pick[1].trim();
  }
  return t ? { name: t, selection, rank: Math.max(1, rank || 1) } : null;
}

/** Signed text for a number: "+2", "-1", "0". */
export const signedText = (n) => (Number(n) > 0 ? `+${Number(n)}` : String(Number(n) || 0));
