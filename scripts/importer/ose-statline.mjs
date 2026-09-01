/**
 * OSE / B-X stat-block grammar.
 *
 * A sibling of executor.mjs's `parseStatline`, which reads the ACKS AX quick-
 * stat line, and it keeps that function's contract deliberately: labels are
 * read by KEYWORD ANYWHERE rather than in sequence, an unrecognised run is
 * preserved verbatim rather than guessed at, a missing key is simply absent,
 * and nothing here ever throws on content. A stat block is the reader's own
 * page; the grammar's job is to report what is printed, not to repair it.
 *
 * This module knows nothing about ACKS. It emits OSE's own fields in OSE's own
 * idiom — descending armour class, to-hit-AC-0, the five-letter save row — and
 * ose-convert.mjs turns those into ACKS values. Keeping the two apart is what
 * confines the printed conversion constants to a single file.
 *
 * Which spellings count as a label is the PROFILE's business, never the
 * grammar's. `ose.canonical` below covers the labels OSE itself prints; a book
 * that prints something else (one third-party title heads its hit dice "HIT
 * DICE") gets a profile row of its own, confirmed by the Judge, so that one
 * book's wording can never silently change how a different book parses.
 */

/**
 * The labels OSE prints. Matching is case-insensitive, so `Att`/`ATT` is one
 * spelling; a genuinely different WORD belongs in a per-source profile.
 *
 * A spelling earns a place here only if it is BOTH used by several unrelated
 * publishers AND unlikely to occur as ordinary prose. The second half is not
 * fastidiousness: the locator decides what is a stat block by counting how many
 * labels a cluster carries, so a label that is also an English word manufactures
 * blocks out of room descriptions. Adding "Attacks", "Morale" and "Saving
 * Throws" — all genuinely used by books in the corpus — found 9 more "blocks"
 * and cost two publishers three points of coverage apiece. Books that print
 * those words as labels get them on their own profile, where a Judge has
 * confirmed what the page actually is.
 */
export const OSE_CANONICAL = Object.freeze({
  base: "ose.canonical",
  labels: Object.freeze({
    ac: ["AC"],
    hd: ["HD", "Hit Dice"],
    hp: ["hp"],
    att: ["Att"],
    thac0: ["THAC0"],
    mv: ["MV"],
    sv: ["SV", "Saves"],
    ml: ["ML"],
    al: ["AL"],
    xp: ["XP"],
    na: ["NA"],
    tt: ["TT"],
    level: ["Level"],
  }),
  saveForm: "five",
  mvOrder: "explorationFirst",
});

/**
 * Dolmenwood's own block, which is OSE-adjacent but not OSE.
 *
 * The Monster Book prints an ASCENDING armour class with no bracket, hit points
 * as the die expression and its total ("HP 4d8 (18)"), one speed per movement
 * mode on its own label, an attack bonus inside the attack instead of a THAC0
 * line, and the words "Morale", "Enc" and "Hoard" where OSE writes ML, NA and
 * TT. Read against `ose.canonical` every one of those is either lost or — worse
 * — read as its OSE homograph: a bare "AC 14" converts as descending and lands
 * five points of armour away from what the page says.
 *
 * It is a profile rather than a widening of the canonical labels because
 * "Morale" and "Speed" are ordinary English: adding them to the labels every
 * book is read with manufactures stat blocks out of room descriptions, which is
 * the failure recorded above.
 */
export const DOLMENWOOD = Object.freeze({
  base: "ose.dolmenwood",
  labels: Object.freeze({
    ...OSE_CANONICAL.labels,
    hp: ["HP", "hp"],
    sv: ["SV", "Saves"],
    ml: ["ML", "Morale"],
    mv: ["MV", "Speed"],
    na: ["NA", "Enc"],
    tt: ["TT", "Hoard"],
    mvFly: ["Fly"],
    mvSwim: ["Swim"],
    mvBurrow: ["Burrow"],
  }),
  saveForm: "five",
  mvOrder: "singleSpeed",
});

/** Profiles a shipped book may name, by id. */
export const PROFILES = Object.freeze({ "ose.canonical": OSE_CANONICAL, "ose.dolmenwood": DOLMENWOOD });

/**
 * Merge a per-source override onto a shipped profile (labels merge by key).
 *
 * `base` is the SOURCE's own dialect tag — the name recorded on everything it
 * imports — and is the source's to choose. `extends` names which of `PROFILES`
 * to start from, and defaults to canonical OSE.
 *
 * The two are separate because a whole line of books shares a dialect: the
 * corpus sweep finds "Morale" 228 times across ten books and "Speed" 202 times
 * across nine. A Judge calibrating one of them should start from that dialect
 * and correct it, rather than teach it a label at a time from OSE — while the
 * book still imports under its own name.
 */
export function resolveProfile(override) {
  if (!override) return OSE_CANONICAL;
  const from = PROFILES[override.extends] ?? OSE_CANONICAL;
  return {
    ...from,
    ...override,
    labels: { ...from.labels, ...(override.labels ?? {}) },
  };
}

// Typographic variants that carry no meaning: the multiplication sign, the
// several dashes, curly quotes, and the foot mark. Folding them is not a
// content decision — the same block prints "1 x bite" and "1 × bite".
const NORM = [
  [/[×✕✖]/g, "x"],
  [/[‐‑‒–—−]/g, "-"],
  [/[‘’′]/g, "'"],
  [/[“”″]/g, '"'],
  [/½/g, "1/2"],
  [/¼/g, "1/4"],
  [/¾/g, "3/4"],
];

/**
 * Join a block's lines into one string, closing up words the typesetter broke.
 *
 * A hyphen at the END of a line with a lower-case continuation is a broken
 * word, not punctuation — "(Mag-" over "ic-user 1)" is one word, and only the
 * line boundary says so. A hyphen anywhere else is the author's.
 *
 * This is the grammar's rule rather than the locator's, because text arrives
 * here from two directions: runs the locator gathered off a page, and text a
 * Judge pasted in. Pasted text carries the same broken words — it is the same
 * page, copied — so keeping the rule in one place is what stops the manual path
 * from being quietly worse at reading than the automatic one.
 *
 * @param input  an array of lines, or a string that may contain newlines
 */
export function joinLines(input) {
  const lines = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  let out = "";
  for (const raw of lines) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    if (!out) {
      out = t;
      continue;
    }
    if (/-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
    else out += ` ${t}`;
  }
  return out;
}

const normalize = (s) => {
  let t = joinLines(s);
  for (const [re, to] of NORM) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
};

/** Fold a token for comparison: case and punctuation carry no meaning, and a
 * line-break hyphen the extractor left behind ("Mag-ic-user") folds away with
 * the legitimate one ("Magic-user"). */
const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const int = (s) => {
  const m = /(-?\d[\d,]*)/.exec(String(s ?? ""));
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
};

/** "1/2" -> 0.5, "2 1/2" -> 2.5, "3" -> 3. Hit dice print as fractions below 1. */
function count(tok) {
  const t = String(tok ?? "").trim();
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return +frac[1] / +frac[2];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A field whose value is words rather than figures.
 *
 * "Varies", "By species", "usually Lawful" — a book saying the value depends on
 * something it declines to fix. That is an ANSWER, and reporting the field as
 * unread instead loses it: the converter can gap what it cannot use, but only
 * if the reader hands it something.
 */
function wordOr(v, parsed) {
  if (parsed !== null && parsed !== undefined) return parsed;
  const note = String(v ?? "").trim();
  return note && /[A-Za-z]/.test(note) ? { note } : null;
}

/* -------------------------------------------- */
/*  Field readers                               */
/* -------------------------------------------- */

/**
 * `9 [10]`, `-3 [22]`, `7 [12]`, or a bare `9`.
 *
 * OSE prints both progressions, which is what lets the converter check its own
 * arithmetic. `bare` marks a block that printed only one number: the grammar
 * does not decide which progression that is, because the answer depends on the
 * lineage and this module has no opinion about lineages.
 */
function readAc(v) {
  const m = /(-?\d+)\s*(?:\[\s*([+-]?\d+)\s*\])?/.exec(v);
  // Not every armour class is a number. A creature that cannot be attacked
  // prints a sentence where the figure goes, and that sentence is the answer —
  // keeping it as a note beats reporting the field as unread, which is what
  // returning null would do.
  if (!m) {
    const note = String(v ?? "").trim();
    return note ? { note } : null;
  }
  const out = { descending: parseInt(m[1], 10) };
  if (m[2] != null) out.ascending = parseInt(m[2], 10);
  else out.bare = true;
  return out;
}

/** `1**`, `4*`, `1+1*`, `1-1`, `1/2`, `40*`. Asterisks mark XP-bearing specials. */
function readHd(v) {
  const m = /^\s*(\d+(?:\s*\/\s*\d+)?)\s*([+-]\s*\d+)?\s*(\*+)?/.exec(v);
  if (!m) {
    // Some creatures are too slight to rate in hit dice at all and print a hit
    // die instead — "HD (1d3)". That is a statement about hit points, not a
    // missing hit-dice rating, so it is recorded as one.
    const die = /\(\s*(\d+d\d+(?:[+-]\d+)?)\s*\)/i.exec(v);
    return die ? { hpDie: die[1] } : null;
  }
  const out = { count: count(m[1].replace(/\s+/g, "")) };
  if (m[2]) out.bonus = parseInt(m[2].replace(/\s+/g, ""), 10);
  if (m[3]) out.asterisks = m[3].length;

  // "HD 3** to 8**" — one creature the book stats across a RANGE of hit dice.
  // Read as a single figure it becomes the weakest member of its own kind and
  // the rest of the range is silently gone; recorded as a range, the binder can
  // build the generator the entry actually describes.
  const to = /\bto\s+(\d+(?:\s*\/\s*\d+)?)/i.exec(v);
  if (to) {
    const hi = count(to[1].replace(/\s+/g, ""));
    if (Number.isFinite(hi) && hi > out.count) out.countMax = hi;
  }
  // How the range's hit points are printed: a figure per step
  // ("(13/18/22/27/31 /36hp)") or a rate ("(8hp per HD)"). Both are the book's
  // own values, transcribed, never a roll this importer invents.
  const per = /\(\s*(\d+)\s*hp\s+per\s+HD\s*\)/i.exec(v);
  if (per) out.hpPerHd = parseInt(per[1], 10);
  else {
    const steps = /\(([\d\s/]+?)\s*hp\s*\)/i.exec(v);
    const list = steps ? steps[1].split("/").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite) : [];
    if (list.length > 1) out.hpSteps = list;
  }
  return out;
}

/**
 * Hit points, printed inside the hit-dice clause.
 *
 * `(4hp)` and `(hp 4)` are the same statement written two ways, and a group
 * prints one figure per creature — `(hp 4, 6, 7)`. The first is the creature's
 * own; the rest belong to its fellows, and are kept rather than dropped so a
 * Judge placing three of them can see what the page allotted each.
 */
function readHp(v) {
  const m = /\(\s*(?:hp\s*)?(\d+(?:\s*,\s*\d+)*)\s*(?:hp)?\s*\)/i.exec(v);
  if (!m) return null;
  const all = m[1].split(",").map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite);
  return all.length ? all[0] : null;
}

/**
 * Hit points under their own label, where a group prints one figure per
 * creature and no brackets — "hp 3, 3, 4". The first is this creature’s.
 */
function readHpList(v) {
  const s = String(v ?? "");
  // "4d8 (18)" prints the hit-die expression and the total rolled from it. The
  // hit points are the total; a plain integer read takes the DIE COUNT instead
  // and gives a four-hit-dice monster four hit points.
  const dice = /^\s*\d+\s*d\s*\d+[^()]*\(\s*(\d+)\s*\)/i.exec(s);
  if (dice) return parseInt(dice[1], 10);
  const all = s
    .split(",")
    .map((n) => parseInt(String(n).trim(), 10))
    .filter(Number.isFinite);
  return all.length ? all[0] : null;
}

/** The die expression a hit-point clause may lead with — "4d8" of "4d8 (18)". */
function readHpDice(v) {
  const m = /^\s*(\d+)\s*d\s*(\d+)/i.exec(String(v ?? ""));
  return m ? { count: parseInt(m[1], 10), die: `${m[1]}d${m[2]}` } : null;
}

/** Every hit-point figure printed under a bare hp label, when more than one. */
function readHpListEach(v) {
  const all = String(v ?? "")
    .split(",")
    .map((n) => parseInt(String(n).trim(), 10))
    .filter(Number.isFinite);
  return all.length > 1 ? all : null;
}

/** Every hit-point figure in a group's clause, when it printed more than one. */
function readHpEach(v) {
  const m = /\(\s*(?:hp\s*)?(\d+(?:\s*,\s*\d+)*)\s*(?:hp)?\s*\)/i.exec(v);
  if (!m) return null;
  const all = m[1].split(",").map((n) => parseInt(n.trim(), 10)).filter(Number.isFinite);
  return all.length > 1 ? all : null;
}

/** `19 [0]`, `16 [+3]`, `18 [1]`, a bare `19`, or a value stated in words. */
function readThac0(v) {
  const m = /(\d+)\s*(?:\[\s*([+-]?\d+)\s*\])?/.exec(v);
  // "By weapon" is an answer, not an absence: the figure depends on something
  // the block declines to fix. Kept as a note so the field reads as stated
  // rather than as unread.
  if (!m) {
    const note = String(v ?? "").trim();
    return note ? { note } : null;
  }
  const out = { toHitAc0: parseInt(m[1], 10) };
  if (m[2] != null) out.ascendingBonus = parseInt(m[2], 10);
  else out.bare = true;
  // "By HD (17 [+2] to 12 [+7])" — the throw at each end of a hit-dice range.
  // Both ends are printed; what happens between them is not, and stays unsaid.
  const hi = /\bto\s+(\d+)\s*\[\s*([+-]?\d+)\s*\]/i.exec(v);
  if (hi) {
    out.toHitAc0Max = parseInt(hi[1], 10);
    out.ascendingBonusMax = parseInt(hi[2], 10);
  }
  return out;
}

/**
 * `120 (40)`, `120' (40')`, `120' (40') / 180' (60') flying`.
 *
 * OSE prints exploration first with the combat rate parenthesised — the
 * opposite order from the ACKS Monstrous Manual. The grammar records the two
 * under their OSE names so the converter cannot mistake one for the other.
 */
function readMv(v) {
  const out = [];
  // The mode may be two words — books write "in water" as often as "swimming".
  const re = /(\d+)\s*'?\s*(?:\(\s*(\d+)\s*'?\s*\))?\s*((?:in|when)\s+[A-Za-z]+|[A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(v)) !== null) {
    if (!m[1]) continue;
    const mode = m[3] ? m[3].toLowerCase() : null;
    out.push({
      mode: mode && mode !== "hp" ? mode : "land",
      exploration: parseInt(m[1], 10),
      ...(m[2] != null ? { combat: parseInt(m[2], 10) } : {}),
    });
  }
  return out.length ? out : null;
}

/**
 * The letter sets books print the five saving throws under.
 *
 * Both name the same five categories. B/X and several of its descendants write
 * Rays where Old-School Essentials writes Wands, and Hold where it writes
 * Paralysis; `as` maps the alternates onto the first set's letters so everything
 * downstream sees one vocabulary. Found in the corpus, not guessed: a sweep of
 * the third-party library turned up `Saves D# R# H# B# S#` across several
 * publishers.
 */
const SAVE_LETTER_SETS = [
  { id: "dwpbs", letters: ["D", "W", "P", "B", "S"] },
  { id: "drhbs", letters: ["D", "R", "H", "B", "S"], as: { R: "W", H: "P" } },
];

/**
 * `D13 W14 P13 B16 S15 (Magic-user 1)`, `D12 W13 P14 B15 S16`, `14`, `14 (3)`.
 *
 * The five-letter row and the single number are DIFFERENT printings, not one
 * with pieces missing: a book that prints one number has said one thing, and
 * fanning it out to five would be the grammar inventing four values. The
 * single form is reported as `single` and the converter decides what, if
 * anything, it may fill.
 */
function readSv(v) {
  const out = {};

  // The five saves, and the two letter sets books print them under. B/X and its
  // descendants name the same categories differently — Rays for Wands, Hold for
  // Paralysis — and a reader that knows only one set does not fail on the other,
  // it succeeds PARTLY: three letters match, two are invisible, and the creature
  // silently gets three saving throws. So the row is only accepted when the
  // letters actually make up a complete known set.
  const printed = {};
  for (const m of v.matchAll(/\b([DWPBSRH])\s*(\d+)/g)) printed[m[1]] = parseInt(m[2], 10);
  const seen = Object.keys(printed);
  if (seen.length) {
    const set = SAVE_LETTER_SETS.find((s) => s.letters.every((l) => printed[l] !== undefined));
    if (set) {
      out.row = {};
      for (const letter of set.letters) out.row[(set.as ?? {})[letter] ?? letter] = printed[letter];
      if (set.id !== "dwpbs") out.letterSet = set.id;
    } else {
      // Letters that belong to no complete set: report them rather than build a
      // row out of whichever ones happened to be recognised.
      out.partial = printed;
    }
  }

  // The parenthetical names the class and level the creature saves as.
  const paren = /\(([^)]*)\)/.exec(v);
  if (paren) {
    const inner = paren[1].trim();
    const named = /^(.*?)\s*(\d+)\s*$/.exec(inner);
    // A class token is a word. "SV By HD (3 to 8)" states a RANGE of hit dice,
    // and reading its tail as a class gives a creature that saves as a "3 to"
    // of level 8 — a token no lookup can resolve, so it becomes a gap that
    // reads like missing data rather than the range it actually is.
    const isClassWord = named && /[A-Za-z]/.test(named[1]) && !/\d/.test(named[1]);
    if (isClassWord) out.saveAs = { token: named[1].trim(), level: parseInt(named[2], 10) };
    else if (/^\d+$/.test(inner)) out.saveAs = { level: parseInt(inner, 10) };
    else if (inner) out.saveAs = { token: inner };
  }

  // "Saves as a vampire" is a whole save row, stated by reference to a creature
  // this grammar has never heard of. It is a real answer and it is not one this
  // module can resolve, so it is recorded for the converter to report rather
  // than left to look like an unreadable clause.
  const asCreature = /^\s*as\s+(?:a\s+|an\s+)?([A-Za-z][A-Za-z' -]{1,30}?)\s*\.?\s*$/i.exec(v);
  if (!out.row && asCreature) out.asCreature = asCreature[1].trim();

  // A save row stated in words — "By class" — same as the armour class and the
  // attack throw above.
  if (!out.row && !out.asCreature && !seen.length && /[A-Za-z]/.test(v) && !/^s*d/.test(v)) {
    const note = String(v).trim();
    if (note) out.note = note;
  }

  // A lone number is a DIFFERENT printing, not a fallback for a row that would
  // not assemble: where save letters were present but made up no complete set,
  // reading the first figure as "the" saving throw would turn a broken row into
  // a confident single value.
  if (!out.row && !out.asCreature && !out.note && !seen.length) {
    const bare = int(v.replace(/\([^)]*\)/g, ""));
    if (bare != null) out.single = bare;
  }
  return Object.keys(out).length ? out : null;
}

/** `0 (1)`, `1d6 (2d6)`, `1 (1d4)` — wandering, then the lair number. */
function readNa(v) {
  const m = /^\s*([^()]+?)\s*(?:\(\s*([^)]*?)\s*\))?\s*$/.exec(v);
  if (!m) return null;
  const out = {};
  if (m[1]) out.wandering = m[1].trim();
  if (m[2]) out.lair = m[2].trim();
  return Object.keys(out).length ? out : null;
}

/**
 * Split on a separator only where it is NOT inside brackets. An attack clause
 * puts alternatives inside its damage parenthetical as often as between them
 * ("1 x weapon (1d4 or by weapon)"), so a flat split cuts a mode in half.
 */
function splitTopLevel(s, re) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && m.index === i) {
        parts.push(s.slice(start, i));
        i = start = i + m[0].length;
        i--;
      }
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Split an attack clause into its alternatives, keeping each verbatim. */
function readAtt(v) {
  const modes = splitTopLevel(v, /\s+or\s+/giy)
    .map((s) => s.replace(/^[,;]\s*/, "").trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+)\s*x\s*(.+)$/i.exec(s);
      const body = m ? m[2].trim() : s;
      const dmg = /\(([^)]*\d+d\d+[^)]*)\)/i.exec(body);
      // Some dialects print the attack bonus inside the attack — "2 hooves
      // (+1, 1d4)" — instead of on a THAC0 line. It is the same figure under a
      // different typography, so it is read here and the converter decides what
      // it is worth.
      const bon = /\(\s*([+-]\s*\d+)\s*(?:,|\))/.exec(body);
      return {
        ...(m ? { count: parseInt(m[1], 10) } : {}),
        name: body.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        ...(dmg ? { damage: dmg[1].trim() } : {}),
        ...(bon ? { bonus: parseInt(bon[1].replace(/\s+/g, ""), 10) } : {}),
        text: s,
      };
    });
  return modes.length ? { text: v, modes } : null;
}

/**
 * A field whose reader does NOT keep the clause it was given verbatim.
 *
 * In this idiom a comma separates fields, so a comma inside one field's segment
 * means text that belongs to no label the profile knows — a label spelled some
 * other way, most often. Every reader here takes what it recognises off the
 * front and would otherwise drop the rest without trace: a block reading
 * "AC 7 [12], HIT DICE 1 (4hp)" under a profile that has never heard of
 * "HIT DICE" would report an armour class and simply lose the hit dice, with no
 * gap and nothing in `extra` to show for it.
 *
 * `att` is excluded because its reader stores the whole clause in `.text`, so
 * nothing is lost there — and a comma legitimately separates attack modes.
 */
const RESIDUE_FIELDS = new Set(["ac", "hd", "thac0", "mv", "sv", "ml", "al", "xp", "na", "level"]);

/**
 * Where a clause really ends: the first comma OUTSIDE any bracket, or -1.
 *
 * A parenthetical routinely holds commas of its own — a group of creatures
 * prints its hit points as "(hp 4, 6, 7)" — and cutting at the first comma
 * found anywhere severs that list, keeping the head and reporting the tail as
 * unread. The corpus sweep found this as four separate mystery shapes (`#)`,
 * `#, #)`, `#, #, #)`) before it was one bug.
 */
function topLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      // A comma between digits is a thousands separator, not a boundary
      // between clauses. Cutting there turns an experience award of 1,250 into
      // a 1 and a loose 250 — which is what the corpus sweep found, 141 times
      // across 22 books, as an unexplained bare number.
      if (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "")) continue;
      return i;
    }
  }
  return -1;
}

const READERS = {
  ac: readAc,
  hd: readHd,
  hp: (v) => wordOr(v, readHpList(v)),
  att: readAtt,
  thac0: readThac0,
  mv: readMv,
  sv: readSv,
  ml: (v) => wordOr(v, int(v)),
  al: (v) => {
    const t = String(v ?? "").replace(/[.,;]+$/, "").trim();
    return t || null;
  },
  xp: (v) => wordOr(v, int(v)),
  na: readNa,
  tt: (v) => v.replace(/[.,;]+$/, "").trim() || null,
  level: (v) => wordOr(v, int(v)),
};

/* -------------------------------------------- */
/*  The grammar                                 */
/* -------------------------------------------- */

/** Build one alternation over every label spelling, longest first so a
 * multi-word label is never shadowed by a shorter one that starts it. */
function labelPattern(labels) {
  const rows = [];
  for (const [key, spellings] of Object.entries(labels)) {
    for (const s of spellings) rows.push({ key, s });
  }
  rows.sort((a, b) => b.s.length - a.s.length);
  const alt = rows.map((r) => r.s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
  // The value may follow with no space ("ML5"), so the closing boundary
  // rejects a letter rather than requiring a word break, which a digit is not.
  return { re: new RegExp(`\\b(${alt})(?![A-Za-z])`, "gi"), rows };
}

/**
 * Read one OSE stat block.
 *
 * Segments are cut at label boundaries rather than at commas, because the
 * values themselves contain commas and a book may print the fields in any
 * order or leave any of them out. Text before the first label, and any segment
 * whose reader declines it, is kept verbatim in `extra` — visible to the Judge
 * in review, never guessed at and never dropped.
 *
 * `segments` returns each label's clause as it was written, which is what lets
 * a reading be handed back to a person for correction: an editor that offered
 * the PARSED shape would be asking them to work in this module's data structure
 * instead of in their own game's idiom, and a corrected clause re-read through
 * this same function inherits every rule the grammar will ever learn.
 *
 * @param text     the block as extracted, already joined by the locator
 * @param profile  a resolved profile (see `resolveProfile`)
 * @returns `{fields, segments, extra, dialect, labelsSeen, text}` — never throws
 */
export function parseOseStatline(text, profile = OSE_CANONICAL) {
  const prof = profile ?? OSE_CANONICAL;
  const src = normalize(text);
  const out = { text: src, dialect: prof.base ?? "ose.canonical", fields: {}, segments: {}, extra: [], labelsSeen: [], unknown: [] };
  if (!src) return out;

  const { re, rows } = labelPattern(prof.labels ?? OSE_CANONICAL.labels);
  const byFolded = new Map(rows.map((r) => [fold(r.s), r.key]));

  // Bracket depth at every position. A label word inside a parenthetical is
  // not a label — a hit-point list prints as "(hp 4, 6, 7)" and the "hp" in it
  // belongs to the hit-dice clause, not to a field of its own. Reading it as a
  // label splits one clause into two and strands the rest of the list.
  const depth = new Array(src.length).fill(0);
  let d = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") d++;
    depth[i] = d;
    if (c === ")" || c === "]") d = Math.max(0, d - 1);
  }

  const hits = [];
  for (const m of src.matchAll(re)) {
    if (depth[m.index] > 0) continue;
    // "THAC0 By HD (17 [+2] to 12 [+7])" — a variable-hit-dice creature says its
    // attack throw follows its hit dice. The "HD" there NAMES the other field
    // rather than opening it, so reading it as a label cuts the range away from
    // the throw it belongs to and reports it as a repeated hit-dice clause.
    if (/\bby\s+$/i.test(src.slice(0, m.index))) continue;
    const key = byFolded.get(fold(m[1]));
    if (key) hits.push({ key, at: m.index, end: m.index + m[0].length });
  }

  // A label this profile does not know still ENDS the clause before it. Without
  // this, an unfamiliar dialect is not reported as unfamiliar — it is absorbed:
  // Dolmenwood's "Att 2 hooves (+1, 1d4) Speed 80 Morale 7" read as an attack
  // whose text happens to run on, leaving `extra` empty and every coverage
  // measurement calling the block perfectly understood while its speed and
  // morale were inside the attack string. Silence is the one failure a
  // corpus-driven grammar cannot learn from, so an unknown label is cut out and
  // named, and the reader who adds a profile row sees exactly what to add.
  //
  // Label shape here is deliberately narrow: a capitalised word followed by a
  // number, at bracket depth zero. Attack text names its weapons in lower case
  // and puts its dice in brackets, so it does not collide.
  const covered = (i) => hits.some((h) => i >= h.at && i < h.end);
  for (const m of src.matchAll(/(?:^|[\s,;])([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]{2,})?)\s+(?=[-+–]?\d)/g)) {
    const at = m.index + m[0].indexOf(m[1]);
    if (depth[at] > 0 || covered(at)) continue;
    hits.push({ key: null, word: m[1], at, end: at + m[1].length });
  }
  hits.sort((a, b) => a.at - b.at);

  if (!hits.length) {
    out.extra.push(src);
    return out;
  }
  if (hits[0].at > 0) {
    const lead = src.slice(0, hits[0].at).replace(/[,;]\s*$/, "").trim();
    // Text before the first label, ending in a colon, is the creature naming
    // itself — "Brood-Mother Nightworm:". That is the one thing a stat block
    // does not label and the one thing every import needs, so it is read as a
    // name rather than reported as something nobody could place. Prose that
    // merely runs up to the block still goes to `extra`, where it belongs.
    const named = /^(.{1,60}?)\s*:$/.exec(lead);
    if (named) out.name = named[1].trim();
    else if (lead) out.extra.push(lead);
  }

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    let raw = src.slice(h.end, hits[i + 1]?.at ?? src.length).replace(/^[:\s]+/, "").replace(/[,;]\s*$/, "").trim();
    if (h.key === null) {
      // Reported under the label the page actually printed, so the profile row
      // that would read it can be written straight off the report.
      out.unknown.push(h.word);
      out.extra.push(`${h.word} ${raw}`.trim());
      continue;
    }
    out.labelsSeen.push(h.key);
    if (RESIDUE_FIELDS.has(h.key)) {
      const comma = topLevelComma(raw);
      if (comma >= 0) {
        const residue = raw.slice(comma + 1).trim();
        if (residue) out.extra.push(residue);
        raw = raw.slice(0, comma).trim();
      }
    }
    // A label printed twice is a real signal (two movement rows, say), so the
    // first reading is kept and the repeat is surfaced rather than overwriting.
    if (out.fields[h.key] !== undefined) {
      out.extra.push(`${h.key}: ${raw}`);
      continue;
    }
    // The clause as written, kept whether or not its reader made sense of it —
    // an editor needs the words a person can correct, not only what was
    // understood.
    if (raw) out.segments[h.key] = raw;
    let value = null;
    try {
      value = READERS[h.key] ? READERS[h.key](raw) : raw;
    } catch {
      value = null; // a reader must never take the block down with it
    }
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      if (raw) out.extra.push(`${h.key}: ${raw}`);
      continue;
    }
    out.fields[h.key] = value;
    if (h.key === "hp" && out.fields.hpEach === undefined) {
      const each = readHpListEach(raw);
      if (each) out.fields.hpEach = each;
    }
    // A block that prints its hit points as dice has stated its hit dice too —
    // "HP 4d8" says four of them — so a dialect with no HD line of its own is
    // not left without one. Reading it here rather than in the converter keeps
    // it a report of what is printed instead of a rule about what HD means.
    if (h.key === "hp" && out.fields.hd === undefined) {
      const dice = readHpDice(raw);
      if (dice) {
        out.fields.hd = { count: dice.count };
        out.fields.hpDie = dice.die;
      }
    }
    // Hit points print inside the hit-dice clause rather than under a label.
    if (h.key === "hd" && out.fields.hp === undefined) {
      const hp = readHp(raw);
      if (hp != null) out.fields.hp = hp;
      const each = readHpEach(raw);
      if (each) out.fields.hpEach = each;
    }
  }
  return out;
}
