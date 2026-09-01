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

