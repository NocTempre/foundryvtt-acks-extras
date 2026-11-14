/**
 * Monster stat-block extraction.
 *
 * MM stat tables are bold-label/regular-value pairs. `extractStatPairs`
 * collects them from a page's text stream; `parseHitDice` and `savesForLevel`
 * read the values. Nothing here ships content: the monster saves grid is the
 * `acks` system's own (`CONFIG.ACKS.monster_saves`), read when asked for and
 * never copied into this module.
 */

/** The fractions the books set as single glyphs. */
const VULGAR = { "½": 0.5, "¼": 0.25, "⅓": 1 / 3, "¾": 0.75, "⅛": 0.125 };

/**
 * A printed Hit Dice rating as `{count, bonus, asterisks}`, or null when the
 * text leads with no rating. Reads whole dice with an optional signed bonus; a
 * fraction of one die as a glyph or a slash, with or without a hit-point
 * aside; and a creature too slight to rate, which prints its hit die or hit
 * points instead, read as the fraction of a d8 that stands for, never above
 * one. Asterisks are the special-ability marks. A bonus absent is null, so a
 * consumer can tell "none printed" from zero; the same for the marks.
 */
export function parseHitDice(text) {
  const s = String(text ?? "").trim();
  // The marks may sit before OR after a hit-point aside, so both places are read.
  const MARKS = /\s*(\**)\s*(?:\([^)]*\))?\s*(\**)/;
  const tail = (m, i) => (m[i] ?? "").length + (m[i + 1] ?? "").length || null;
  let m = new RegExp(`^([½¼⅓¾⅛])${MARKS.source}`, "u").exec(s);
  if (m) return { count: VULGAR[m[1]], bonus: null, asterisks: tail(m, 2) };
  m = new RegExp(`^(\\d+)\\s*/\\s*(\\d+)${MARKS.source}`).exec(s);
  if (m) return { count: Number(m[1]) / Number(m[2]), bonus: null, asterisks: tail(m, 3) };
  m = new RegExp(`^1\\s*d\\s*(\\d+)\\s*(?:hp)?${MARKS.source}`, "i").exec(s);
  if (m) return { count: Math.min(1, Number(m[1]) / 8), bonus: null, asterisks: tail(m, 2) };
  m = new RegExp(`^(\\d+)\\s*hp\\b${MARKS.source}`, "i").exec(s);
  if (m) return { count: Math.min(1, Math.max(0.125, Number(m[1]) / 4.5)), bonus: null, asterisks: tail(m, 2) };
  m = new RegExp(`^(\\d+)(?:\\s*([+-])\\s*(\\d+))?${MARKS.source}`).exec(s);
  if (m) return { count: parseInt(m[1], 10), bonus: m[2] ? (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10) : null, asterisks: tail(m, 4) };
  return null;
}

/** The system grid's one-letter save keys → this module's save keys, in the order a row lists them. */
const SYSTEM_SAVE_KEYS = Object.freeze({ p: "paralysis", d: "death", b: "blast", w: "implements", s: "spell" });

/**
 * The monster save row for a save-as level: the system's own grid
 * (`CONFIG.ACKS.monster_saves`, keyed by the lowest level of each band) read at
 * call time, floored to the band the level falls in and returned under this
 * module's save keys as `{paralysis, death, blast, implements, spell}`. An
 * empty row where the system exposes no grid, so no figure is written in its
 * place.
 */
export function savesForLevel(level) {
  const grid = globalThis.CONFIG?.ACKS?.monster_saves;
  if (!grid || typeof grid !== "object") return {};
  let chosen = null;
  for (const band of Object.keys(grid).map(Number).sort((a, b) => a - b)) {
    if (chosen === null || level >= band) chosen = band;
  }
  const row = grid[chosen] ?? {};
  return Object.fromEntries(
    Object.entries(SYSTEM_SAVE_KEYS)
      .filter(([sys]) => Number.isFinite(row[sys]))
      .map(([sys, key]) => [key, row[sys]]),
  );
}

const LABEL_RE = /^[A-Z][A-Za-z ()'/]{0,28}:$/;
const VALUE_CAP = 140; // stat values are short; prose after the table must not bleed in

/** Bold-label/value pairs from a page's items (stream order). */
export function extractStatPairs({ items }) {
  const pairs = [];
  let cur = null;
  for (const it of items) {
    if (it.h >= 12) continue; // display headings are never stat rows
    const raw = it.str; // PUA glyphs preserved: damage-type icons live in values
    const text = raw.trim();
    if (!text) continue;
    if (LABEL_RE.test(text)) {
      if (cur) pairs.push(cur);
      cur = { label: text.slice(0, -1), value: "" };
    } else if (cur && cur.value.length < VALUE_CAP) {
      cur.value += raw;
    }
  }
  if (cur) pairs.push(cur);
  return pairs.map((p) => ({ label: p.label, value: p.value.replace(/\s+/g, " ").trim() }));
}

