/**
 * Printed spell names: a list split, a title resolved, a creature's spells
 * read off its prose. Pure — no Foundry global — so the importer's binder,
 * the class picker and the offline suite share one reading of a name.
 */
import { foldKey, toNumber } from "./spell-logic.mjs";

/**
 * A printed spell name as a lookup key: the reversible mark and a closing
 * abbreviation stop dropped, an ampersand read as the word, then folded.
 */
export const spellNameKey = (name) =>
  foldKey(
    String(name ?? "")
      .replace(/\*+\s*$/, "")
      .replace(/&/g, " and ")
      .trim(),
  );

/** The folded name with each word's plural dropped, so a printed plural meets a singular title. */
const singularKey = (name) =>
  foldKey(
    String(name ?? "")
      .replace(/\*+\s*$/, "")
      .replace(/&/g, " and ")
      .replace(/ies\b/gi, "y")
      .replace(/([a-z])s\b/gi, "$1"),
  );

/**
 * A resolver over known spell titles — the register's entries or the
 * world's documents. `pairs` is an iterable of `[key, name]`; the first key
 * for a name wins. `has(name)` answers whether a printed name is a title and
 * `resolve(name)` returns its key, or null.
 *
 * Three readings, in order: the name whole; the name with each word's plural
 * dropped, since a list prints "cure serious injuries" for a title in the
 * singular; and a name closing on a stop, an abbreviation, as the one title
 * it opens — a narrow column prints "Repair Disfigurement & Dis." for a
 * title too long for it.
 */
export function titleIndex(pairs) {
  const whole = new Map();
  const singular = new Map();
  for (const [key, name] of pairs ?? []) {
    const k = spellNameKey(name);
    if (!k) continue;
    if (!whole.has(k)) whole.set(k, key);
    const s = singularKey(name);
    if (!singular.has(s)) singular.set(s, key);
  }
  const resolve = (name) => {
    const raw = String(name ?? "").trim();
    if (!raw) return null;
    const k = spellNameKey(raw);
    if (whole.has(k)) return whole.get(k);
    const s = singularKey(raw);
    if (singular.has(s)) return singular.get(s);
    if (/\.\s*\*?\s*$/.test(raw)) {
      const stem = spellNameKey(raw.replace(/\.\s*\*?\s*$/, ""));
      const hits = stem ? [...whole.entries()].filter(([t]) => t.startsWith(stem)) : [];
      if (hits.length === 1) return hits[0][1];
    }
    return null;
  };
  return { has: (name) => resolve(name) != null, resolve, size: whole.size };
}

/**
 * The names a printed list of spells holds, split on its commas, semicolons
 * and conjunctions — except an "and" that is a title's own word. `known` is
 * a predicate on a printed name (a `titleIndex`'s `has`); two neighbouring
 * fragments are rejoined on " and " when neither is a title and the join is.
 * With no `known`, every conjunction splits.
 */
export function splitSpellNames(text, known = null) {
  const frags = String(text ?? "")
    .split(/\s*(?:[,;]|\band\b|&)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (typeof known !== "function") return frags;
  const out = [];
  for (let i = 0; i < frags.length; i++) {
    let cur = frags[i];
    while (i + 1 < frags.length && !known(cur) && known(`${cur} and ${frags[i + 1]}`)) {
      cur = `${cur} and ${frags[i + 1]}`;
      i++;
    }
    out.push(cur);
  }
  return out;
}

/** The sentence around an offset, for a frequency read beside a name. */
const sentenceAround = (text, at) => {
  const start = text.lastIndexOf(". ", at) + 1;
  const end = text.indexOf(". ", at);
  return text.slice(start, end < 0 ? text.length : end + 1);
};

/**
 * The spells a creature's prose names, read four ways: "X (as the spell)",
 * "(as the spell X)", a "spell-like abilities:" list whose groups close on a
 * frequency in parentheses, and a printed repertoire "1st - a, b; 2nd - c".
 * `known` trims a paraphrase to the title it closes on — "… objects within
 * 60' (as the spell)" names the title its last words are — and without it
 * the words after "can cast" stand; `freqOf` reads a frequency phrase to its
 * key. Returns `{named: [{name, frequency?}], repertoire: [{level, names}]}`,
 * names as printed, each once.
 */
export function scanMonsterSpells(text, { known = null, freqOf = null } = {}) {
  const prose = String(text ?? "").replace(/\s+/g, " ");
  const named = [];
  const seen = new Set();
  const add = (name, frequency = "") => {
    const n = String(name ?? "")
      .trim()
      .replace(/^(?:the|an?)\s+/i, "");
    const k = spellNameKey(n);
    if (!k || seen.has(k)) return;
    seen.add(k);
    named.push({ name: n, ...(frequency ? { frequency } : {}) });
  };
  const freq = (s) => (typeof freqOf === "function" ? freqOf(s) || "" : "");
  for (const m of prose.matchAll(/\(as the spell ([a-z][a-z'’ -]+?)\)/gi)) add(m[1], freq(sentenceAround(prose, m.index)));
  const AS_THE_SPELL = /((?:[a-z][a-z'’-]*\s+){0,7}[a-z][a-z'’-]*)\s+\(as the (?:\d+(?:st|nd|rd|th)?[- ]?level )?(?:divine |arcane )?spell\)/gi;
  for (const m of prose.matchAll(AS_THE_SPELL)) {
    const words = m[1].split(/\s+/);
    let title = null;
    if (typeof known === "function") {
      for (let i = 0; i < words.length && !title; i++) {
        const cand = words.slice(i).join(" ");
        if (known(cand)) title = cand;
      }
    } else {
      const v = /\b(?:casts?|uses?|bestows?|performs?)\s+(.+)$/i.exec(m[1]);
      title = v ? v[1] : null;
    }
    if (title) add(title, freq(sentenceAround(prose, m.index)));
  }
  // A list may open on its frequency — "spell-like abilities thrice per
  // day:", "spell-like abilities, each of which can be used thrice per
  // day:" — or close each group on one in parentheses; a group's own
  // frequency outranks the one the list opened on. A creature may print
  // several such lists.
  for (const list of prose.matchAll(/spell-like abilities([^:.]{0,80}):\s*([^.]+)\./gi)) {
    const opening = freq(list[1] ?? "");
    for (const group of list[2].split(/;\s*(?:and\s+)?/i)) {
      const g = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(group.trim());
      if (!g?.[1]) continue;
      const frequency = freq(g[2] ?? "") || opening;
      for (const name of splitSpellNames(g[1], known)) add(name, frequency);
    }
  }
  const repertoire = [];
  const rep = /spells in (?:its|their|his|her) repertoire[:]\s*([^.]+)\./i.exec(prose);
  if (rep) {
    for (const group of rep[1].split(/;\s*/)) {
      const g = /^(\d+)(?:st|nd|rd|th)?\s*[-–—:]\s*(.+)$/.exec(group.trim());
      if (!g) continue;
      const names = splitSpellNames(g[2], known);
      if (names.length) repertoire.push({ level: parseInt(g[1], 10), names });
    }
  }
  return { named, repertoire };
}

/**
 * "casts spells as a 13th-level crusader", "the spellcasting abilities of a
 * 9th level mage": the class word and the level, or null. The level's
 * ordinal may run straight into "level" — extraction drops the hyphen — and
 * the class may be printed in the plural.
 */
export function castsAsClass(text) {
  const m =
    /(?:casts? spells(?: and uses magic items)? as|spellcasting abilities of) (?:an? )?(\d+)(?:st|nd|rd|th)?[- ]?level ([a-z]+)/i.exec(
      String(text ?? "").replace(/\s+/g, " "),
    );
  return m ? { level: parseInt(m[1], 10), className: m[2] } : null;
}

/**
 * What a creature's prose says it casts as: a tradition key (`arcane`,
 * `divine`) where it casts that magic outright, else the class word it casts
 * as, in the singular and lower case; "" when the prose says neither.
 */
export function castSourceOf(text) {
  const prose = String(text ?? "").replace(/\s+/g, " ");
  const tradition = /\bcasts? (arcane|divine) spells\b/i.exec(prose);
  if (tradition) return tradition[1].toLowerCase();
  const CLASS_WORD =
    /\b(?:casts? spells(?: and uses magic items)? as (?:if (?:it|they) were )?|spellcasting abilities of )(?:an? |the )?(?:\d+(?:st|nd|rd|th)?[- ]?level )?([a-z]+)/i;
  const cls = CLASS_WORD.exec(prose);
  return cls ? cls[1].toLowerCase().replace(/s$/, "") : "";
}

/**
 * The level a spell holds under one of `keys` (folded tradition keys), read
 * off its lists; core's own level when the lists say nothing; null when
 * neither states one.
 */
export function levelUnder(extras, systemLevel, keys) {
  const row = (extras?.lists ?? []).find((l) => keys.has(foldKey(l?.source)));
  const raw = row?.level ?? systemLevel;
  if (raw == null || String(raw).trim() === "") return null;
  const level = toNumber(raw);
  return Number.isFinite(level) ? level : null;
}
