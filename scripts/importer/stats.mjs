/**
 * Monster stat-block extraction + mapping (PoC).
 *
 * MM stat tables are bold-label/regular-value pairs ("Armor Class:" → "4").
 * extractStatPairs() collects them from a page's text stream; mapPairs()
 * converts the labels we understand into the acks monster schema. Unknown
 * labels are returned untouched (and stashed on the actor under this
 * module's own flag namespace) — per the recipe philosophy, odd entries get
 * one-off recipe directions later rather than a cleverer parser.
 *
 * IP posture: parsed NUMBERS from the seat's own PDF are persisted into the
 * WORLD actor (actor data must be shared and playable — equivalent to typing
 * the stat block in by hand at your own table). Nothing here ships content:
 * the save LUT below is derived game math, identical to the one acks-monsters
 * publishes (scripts/config.mjs MONSTER_SAVES_LUT).
 */

/** The fractions the books set as single glyphs. */
const VULGAR = { "½": 0.5, "¼": 0.25, "⅓": 1 / 3, "¾": 0.75, "⅛": 0.125 };

/**
 * A printed Hit Dice rating as `{count, bonus, asterisks}`, or null when the
 * text leads with no rating. Whole dice with a bonus ("3", "2+1", "1-1"); a
 * fraction of one die as a glyph or a slash ("½", "1/2", with or without a
 * hit-point aside); and a creature too slight to rate, which prints its hit
 * die or hit points instead ("1d4 hp", "1 hp") — read as the fraction of a d8
 * that die stands for, never above one. Asterisks are the special-ability
 * marks. A bonus absent is null, so a consumer can tell "none printed" from
 * zero; the same for the marks.
 */
export function parseHitDice(text) {
  const s = String(text ?? "").trim();
  // The marks may sit before OR after a hit-point aside ("½* (1d4 hp)",
  // "½ (2 hp)*"), so both places are read.
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

const SAVES_LUT = {
  0: { paralysis: 14, death: 15, blast: 16, implements: 17, spell: 18 },
  1: { paralysis: 13, death: 14, blast: 15, implements: 16, spell: 17 },
  2: { paralysis: 12, death: 13, blast: 14, implements: 15, spell: 16 },
  4: { paralysis: 11, death: 12, blast: 13, implements: 14, spell: 15 },
  5: { paralysis: 10, death: 11, blast: 12, implements: 13, spell: 14 },
  7: { paralysis: 9, death: 10, blast: 11, implements: 12, spell: 13 },
  8: { paralysis: 8, death: 9, blast: 10, implements: 11, spell: 12 },
  10: { paralysis: 7, death: 8, blast: 9, implements: 10, spell: 11 },
  11: { paralysis: 6, death: 7, blast: 8, implements: 9, spell: 10 },
  13: { paralysis: 5, death: 6, blast: 7, implements: 8, spell: 9 },
  14: { paralysis: 4, death: 5, blast: 6, implements: 7, spell: 8 },
};

export function savesForLevel(level) {
  let chosen = 0;
  for (const band of Object.keys(SAVES_LUT).map(Number).sort((a, b) => a - b)) {
    if (level >= band) chosen = band;
  }
  return SAVES_LUT[chosen];
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

