/**
 * DEV-ONLY: compare the Lairs & Encounters stat lines that bind to no
 * Monstrous Manual row with the rows they may duplicate, and pair the ones
 * whose figures agree.
 *
 * Reads the Judge's own copies (the LOCAL-ONLY reference printings) through
 * the shipping executor: every L&E entry's stat lines over `cookbook/le.json`,
 * and every Monstrous Manual monster row over `cookbook/mm.json`. A stat line
 * is MADE when nothing binds it today: no registered replacement, no library
 * creature of that name (`creatureKeys` against the monster rows of every
 * other book, as `keyedOccupantRows` reads them), no register reference.
 *
 * - **Groups.** Labels that share a `creatureKeys` form are one group, since a
 *   pair is keyed by those forms and answers for every label that holds one.
 * - **Candidates.** A monster row is a candidate for a group when it shares a
 *   word (singular, with the demi-human adjectives read as their noun, and
 *   words that only say role, age or size set aside) with a label, or is the
 *   row a listing's `meta.of` names, or the row the conversion table renames
 *   a label to. A candidate is a lead, never a verdict.
 * - **Match.** At every occurrence of the group's labels the line's armor class,
 *   hit dice (dice and modifier), attacks with damage, save (class and level)
 *   and morale equal the row's after normalising notation: a hit-dice mark or
 *   parenthetical, a minus sign, spacing and case, a comma in a damage list
 *   read as a slash, and a morale printed as two figures read as its first.
 *   Movement, experience and alignment are reported and gate nothing. A
 *   figure unread on either side is a difference. A group with a line that
 *   prints no figures cannot match, a row that prints no single profile cannot
 *   be matched, and a group two rows both match is left made.
 *
 * The report names labels and is LOCAL-ONLY: `--out` belongs in a scratch
 * folder. `--register <file>` merges the matched groups into the creature
 * replacement register, each pair keyed by the hash of a folded form of its
 * label and carrying `books: ["le"]`; no label reaches a tracked file.
 *
 * Usage: node tools/importer/compare-lines.mjs [--out <report>]
 *          [--register <register/_refs/creatureReplacement.json>]
 *          [--sample "<label>,<label>"]   (print both lines and their figures)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { foldLabel, hash36 } from "../../scripts/importer/printed-name.mjs";
import { CREATURE_REPLACEMENTS, occupantsOf, replacementOf } from "../../scripts/importer/poi-binding.mjs";
import { creatureKeys, nameKeys } from "../../scripts/lib/vocab.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const BOOK = "le";
const MM = "mm";

/** Words that say role, age or size and no creature: they never make a row a candidate. */
const SET_ASIDE = new Set([
  "giant", "common", "greater", "lesser", "huge", "large", "medium", "small", "man", "of", "the", "and",
  "young", "baby", "child", "adolescent", "elite", "veteran", "heavy", "light",
  "warrior", "champion", "villager", "noncombatant", "whelp", "guard", "guardian", "leader", "hero",
]);
/** The adjectives and irregular plurals a demi-human or a people is written with. */
const AS_NOUN = new Map([["dwarven", "dwarf"], ["dwarves", "dwarf"], ["elven", "elf"], ["elves", "elf"], ["gnomish", "gnome"], ["men", "man"], ["lizardmen", "lizardman"], ["children", "child"]]);

/** Command-line flag value, or null. */
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
};

/** The singular of an English plural: ies, ves, es after a sibilant, and a plain s. */
function singular(word) {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/ves$/.test(word)) return word.replace(/ves$/, "f");
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) return word.replace(/es$/, "");
  return /[^s]s$/.test(word) ? word.slice(0, -1) : word;
}

/** A text's words, folded and made singular, role and size words dropped. */
function creatureWords(text) {
  return String(text ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter(Boolean)
    .map((w) => AS_NOUN.get(w) ?? singular(w))
    .filter((w) => w.length > 1 && !SET_ASIDE.has(w));
}

/** Whether a creature word of a row is one of a label's, or is the tail or head of one ("warhorse" holds "horse"). */
const sharesWord = (rowWord, labelWords) =>
  labelWords.has(rowWord) || (rowWord.length >= 4 && [...labelWords].some((w) => w.length > rowWord.length && (w.endsWith(rowWord) || w.startsWith(rowWord))));

/** The minus signs and dashes a printing sets in place of a hyphen. */
const DASHES = new RegExp("[" + String.fromCharCode(0x2212, 0x2013, 0x2014) + "]", "g");

/** Hit dice as dice and modifier: marks, spacing and a parenthetical gone, the minus sign one character, a half one figure. */
const hitDice = (text) =>
  String(text ?? "").toLowerCase().replace(/\([^)]*\)?/g, "").replace(/[\s*]/g, "").replace(DASHES, "-").replace(String.fromCharCode(0xbd), "1/2").replace(/\+0$/, "");

/** A damage figure as printed, spacing and case gone, a comma read as a slash: "By weapon + N" and "by weapon+N" are one. */
const damageText = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, "").replace(DASHES, "-").replace(/,/g, "/");

/**
 * Attack modes from the two halves a stat line prints: what attacks ("2 (a,
 * b 9+) or 1 (c 9+)", or "2 or 1 (a, b or c 9+)") and what they deal ("1d4/1d4
 * or by weapon"). Counts are paired with
 * damages in order. Halves that do not pair off one to one read as none.
 * @returns {string[]} one `count@throw:damage/damage` text per mode, sorted; empty when unread
 */
function attackModes(attackText, damage) {
  const counts = [];
  for (const group of String(attackText ?? "").split(/\)\s*or\s*/i)) {
    const m = /^\s*(\d+(?:\s*or\s*\d+)*)\s*\(.*?(\d+)\+\s*\)?\s*$/.exec(group);
    if (!m) return [];
    for (const n of m[1].split(/\s*or\s*/i)) counts.push(`${Number(n)}@${Number(m[2])}`);
  }
  const damages = String(damage ?? "").split(/\s+or\s+/i);
  if (counts.length !== damages.length) return [];
  return counts.map((c, i) => `${c}:${damageText(damages[i])}`).sort();
}

/** A line's attacks read from its own text: the half after "#AT" and the half after "Dmg". */
function lineAttacks(text) {
  const m = /#AT\s*(.*?),\s*Dmg\s+(.*?)(?:,|\s)\s*Save\b/i.exec(String(text ?? "").replace(/\s+/g, " "));
  return m ? attackModes(m[1], m[2]) : [];
}

/** A row's attacks read from its attack text, "what attacks, a dash, what they deal". */
function rowAttacks(text) {
  const m = new RegExp("^(.*?)\\s*[" + String.fromCharCode(0x2014, 0x2013) + "]\\s*(.*)$").exec(String(text ?? ""));
  return m ? attackModes(m[1], m[2]) : [];
}

/** A save as class letters and level: `{class, level}` or a text of the two alike. */
function saveOf(save) {
  if (save && typeof save === "object") return `${String(save.class ?? "").toUpperCase()}${save.level ?? ""}`;
  const m = /^([A-Za-z]+)\s*(\d+)$/.exec(String(save ?? "").trim());
  return m ? `${m[1].toUpperCase()}${m[2]}` : "";
}

/** The numbers of a movement text, in order. */
const numbersOf = (text) => [...String(text ?? "").replace(/,/g, "").matchAll(/\d+/g)].map((m) => Number(m[0]));

/**
 * One stat line's figures reduced to what is compared, from an L&E occupant's
 * `stats` object, its attacks read from the line's own text.
 * @returns {{ac, hd, attacks: string[], save, ml, mv, xp, al, stars}|null} null when the line printed no figures
 */
function lineFigures(stats) {
  if (!stats || stats.ac == null) return null;
  return {
    ac: Number(stats.ac),
    hd: hitDice(stats.hd),
    attacks: lineAttacks(stats.text),
    save: saveOf(stats.save),
    ml: Number(stats.ml),
    mv: numbersOf(stats.mv),
    xp: Number(stats.xp),
    al: String(stats.al ?? "").toUpperCase(),
    stars: (String(stats.hd ?? "").match(/\*/g) ?? []).length,
  };
}

/**
 * A monster row's figures in the same shape: one `attack` text per attack mode
 * (a row with alternatives has several), and a line must read the same set.
 * @returns {{ac, hd, attacks: string[], save, ml, mv, xp, al, stars}|null}
 */
function rowFigures(fields) {
  const s = fields?.stats;
  if (!s || s.armorClass == null) return null;
  return {
    ac: Number(s.armorClass),
    hd: hitDice(s.hitDice),
    attacks: rowAttacks(fields.attacks?.text),
    save: saveOf(s.save),
    ml: Number(s.morale),
    mv: numbersOf(s.speedLand),
    xp: Number(s.xp),
    al: String(s.alignment?.key ?? s.alignment?.text ?? "").charAt(0).toUpperCase(),
    stars: (String(s.hitDice ?? "").match(/\*/g) ?? []).length,
  };
}

/**
 * The gating figures of a line against a row's, field by field. A figure
 * unread on either side is a difference of its own, never an agreement.
 * @returns {string[]} the fields that differ or are unread (empty: a match)
 */
function gateDiffs(line, row) {
  const out = [];
  const unread = (v) => v === "" || Number.isNaN(v);
  const check = (name, a, b) => {
    if (unread(a) || unread(b)) out.push(`${name} unread`);
    else if (a !== b) out.push(name);
  };
  check("ac", line.ac, row.ac);
  check("hd", line.hd, row.hd);
  check("save", line.save, row.save);
  check("ml", line.ml, row.ml);
  if (!line.attacks.length) out.push("line attacks unread");
  else if (!row.attacks.length) out.push("row attacks unread");
  else if (line.attacks.join(" | ") !== row.attacks.join(" | ")) out.push("attack");
  return out;
}

/** The figures that gate nothing and differ: movement (the line's figure is one the row prints), experience, alignment, the asterisks. */
function noteDiffs(line, row) {
  const out = [];
  if (!line.mv.length || !line.mv.every((n) => row.mv.includes(n))) out.push("mv");
  if (line.xp !== row.xp) out.push("xp");
  if (line.al !== row.al) out.push("al");
  if (line.stars !== row.stars) out.push("stars");
  return out;
}

/** The fields of one line and one row as text, for a report. */
const showLine = (f) => `AC ${f.ac}, HD ${f.hd}, ${f.attacks.join(" | ") || "attacks unread"}, save ${f.save}, ML ${f.ml}, MV ${f.mv.join("/")}, XP ${f.xp}, AL ${f.al}`;
const showRow = (f) => !f ? "no single profile to compare" : `AC ${f.ac}, HD ${f.hd}, ${f.attacks.join(" | ")}, save ${f.save}, ML ${f.ml}, MV ${f.mv.join("/")}, XP ${f.xp}, AL ${f.al}`;

/** The cookbooks by book id, and the registers. */
function loadCookbooks() {
  const books = new Map();
  for (const f of fs.readdirSync(COOKBOOK)) {
    if (!f.endsWith(".json") || f === "registers.json") continue;
    const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
    if (cb.book?.id) books.set(cb.book.id, cb);
  }
  return { books, registers: JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8")) };
}

/** Executes every entry of `ids` over the book's reference copy. */
async function executeAll(book, cb, registers, ids) {
  if (!FILES[book] || !fs.existsSync(FILES[book])) {
    console.error(`no local PDF for book "${book}" (expected ${FILES[book]})`);
    process.exit(2);
  }
  const { doc } = await openBook(fs.readFileSync(FILES[book]), { book });
  const pageCache = new Map();
  const out = new Map();
  for (const id of ids) {
    const node = await executeEntry(doc, cb, registers, id, { pageCache, skipOps: ["art"] }).catch(() => null);
    if (node?.ok) out.set(id, node);
  }
  return out;
}

/** Groups of occupants whose labels share a `creatureKeys` form (union by shared key). */
function groupByKeys(occs) {
  const parent = occs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map();
  occs.forEach((o, i) => {
    for (const k of creatureKeys(o.label)) {
      if (owner.has(k)) parent[find(i)] = find(owner.get(k));
      else owner.set(k, i);
    }
  });
  const groups = new Map();
  occs.forEach((o, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(o);
  });
  return [...groups.values()];
}

const { books, registers } = loadCookbooks();
const le = books.get(BOOK);
const mm = books.get(MM);
const pairs = registers.tables?.[CREATURE_REPLACEMENTS] ?? {};

// The library's monsters by name key: the monster rows of every book but L&E.
const core = new Map();
for (const [id, cb] of books) {
  if (id === BOOK) continue;
  for (const e of Object.values(cb.entries ?? {})) {
    if (e.kind !== "kind.monster") continue;
    for (const k of nameKeys(e.name)) core.set(k, e);
  }
}

const leNodes = await executeAll(BOOK, le, registers, Object.keys(le.entries));
const mmIds = Object.entries(mm.entries).filter(([, e]) => e.kind === "kind.monster").map(([id]) => id);
const mmNodes = await executeAll(MM, mm, registers, mmIds);
// The rows the Compatibility Guide's conversion table renames first-edition creatures to, by folded name.
const rowByFold = new Map(mmIds.map((id) => [foldLabel(mm.entries[id].name), id]));
const renamedTo = new Map();
for (const [from, c] of Object.entries(registers.tables?.conversion ?? {})) {
  if (c.category === "monster" && c.status === "renamed" && rowByFold.has(foldLabel(c.to))) renamedTo.set(foldLabel(from), rowByFold.get(foldLabel(c.to)));
}
const rows = new Map();
for (const [id, node] of mmNodes) {
  const figures = rowFigures(node.fields);
  rows.set(id, { id, name: mm.entries[id].name, figures, modes: node.fields.attacks?.modes?.length ?? 0 });
}

// Every stat line, bound or made.
const made = [];
let total = 0;
let paired = 0;
let byName = 0;
for (const [entryId, node] of leNodes) {
  for (const occ of occupantsOf(node.fields)) {
    total++;
    const label = occ.name.text.trim();
    if (replacementOf(label, pairs, BOOK)) paired++;
    else if (occ.name.ref || [...creatureKeys(label)].some((k) => core.has(k))) byName++;
    else made.push({ entryId, label, line: occ.stats?.text ?? "", figures: lineFigures(occ.stats), of: le.entries[entryId]?.meta?.of ?? null });
  }
}

const results = [];
for (const group of groupByKeys(made)) {
  const words = new Set(group.flatMap((o) => creatureWords(o.label)));
  const ofIds = new Set(group.map((o) => o.of).filter((id) => rows.has(id)));
  const renamedIds = new Set(group.flatMap((o) => [...creatureKeys(o.label)].map((k) => renamedTo.get(k)).filter(Boolean)));
  const candidates = [...rows.values()].filter((r) => ofIds.has(r.id) || renamedIds.has(r.id) || creatureWords(r.name).some((w) => sharesWord(w, words)));
  const labels = [...new Set(group.map((o) => o.label))];
  const result = { labels, lairs: [...new Set(group.map((o) => o.entryId))], group, candidates: [], matches: [] };
  if (group.some((o) => !o.figures)) result.noFigures = true;
  for (const row of candidates) {
    const diffs = new Set();
    const notes = new Set();
    let agreeing = 0;
    for (const o of group) {
      if (!o.figures) continue;
      if (!row.figures) {
        diffs.add("row prints no single profile");
        continue;
      }
      const own = gateDiffs(o.figures, row.figures);
      if (!own.length) agreeing++;
      own.forEach((d) => diffs.add(d));
      noteDiffs(o.figures, row.figures).forEach((d) => notes.add(d));
    }
    const readable = [...diffs].filter((d) => !/attacks unread$/.test(d));
    result.candidates.push({
      row, diffs: [...diffs], notes: [...notes], viaOf: ofIds.has(row.id), agreeing,
      attackUnreadOnly: diffs.size > 0 && !readable.length,
    });
    if (!diffs.size && !result.noFigures) result.matches.push(row);
  }
  results.push(result);
}

const matched = results.filter((r) => r.matches.length === 1);
const ambiguous = results.filter((r) => r.matches.length > 1);
const mismatched = results.filter((r) => !r.matches.length && r.candidates.length);
const lead = results.filter((r) => !r.candidates.length);
const unreadOnly = mismatched.filter((r) => r.candidates.some((c) => c.attackUnreadOnly));
const partial = mismatched.filter((r) => r.group.length > 1 && r.candidates.some((c) => c.agreeing > 0));
const countOcc = (list) => list.reduce((n, r) => n + r.group.length, 0);

const lines = [];
lines.push("# L&E stat lines compared with the Monstrous Manual rows (LOCAL-ONLY; holds printed names)", "");
lines.push(`Stat lines read: ${total}. Bound by a registered pair: ${paired}. Bound by name: ${byName}. Made: ${made.length} in ${results.length} groups of labels.`);
lines.push(`Groups with a candidate row (compared): ${results.length - lead.length}. Matched and paired: ${matched.length} groups, ${countOcc(matched)} stat lines. Matched two rows (left made): ${ambiguous.length}. Compared, no match (left made): ${mismatched.length} groups, ${countOcc(mismatched)} stat lines. No candidate row: ${lead.length} groups, ${countOcc(lead)} stat lines.`);
lines.push(`Near misses left made: ${unreadOnly.length} groups whose only difference from a candidate is an attack line one side's text did not read; ${partial.length} groups of several lines where a candidate agrees at some occurrences and not all.`, "");
lines.push("Match: AC, HD dice and modifier, attacks with damage, save and ML equal at every occurrence. MV, XP, AL and the asterisks are noted and gate nothing.", "");
lines.push("## Matched", "");
for (const r of matched) {
  const row = r.matches[0];
  const cand = r.candidates.find((c) => c.row === row);
  lines.push(`- ${r.labels.join(" / ")} (lairs ${r.lairs.map((l) => l.replace(`${BOOK}.lair`, "")).join(", ")}; ${r.group.length} lines) = ${row.id} ${row.name}${row.modes > 1 ? " [row has alternative attack modes]" : ""}${cand.notes.length ? `; not gating, differ: ${cand.notes.join(", ")}` : ""}`);
  lines.push(`  - line: ${showLine(r.group.find((o) => o.figures).figures)}`);
  lines.push(`  - row:  ${showRow(row.figures)}`);
}
lines.push("", "## Matched two rows", "");
for (const r of ambiguous) lines.push(`- ${r.labels.join(" / ")}: ${r.matches.map((m) => m.id).join(", ")}`);
lines.push("", "## Compared, no match", "");
for (const r of mismatched) {
  lines.push(`- ${r.labels.join(" / ")} (lairs ${r.lairs.map((l) => l.replace(`${BOOK}.lair`, "")).join(", ")}${r.noFigures ? "; a line prints no figures" : ""})`);
  const first = r.group.find((o) => o.figures);
  if (first) lines.push(`  - line: ${showLine(first.figures)}`);
  for (const c of r.candidates) lines.push(`  - vs ${c.row.id} ${c.row.name}${c.viaOf ? " (meta.of)" : ""}: differs in ${c.diffs.join(", ") || "none"}; ${showRow(c.row.figures)}`);
}
lines.push("", "## Near misses: the only difference is an attack read from neither side", "");
for (const r of unreadOnly) lines.push(`- ${r.labels.join(" / ")}: ${r.candidates.filter((c) => c.attackUnreadOnly).map((c) => `${c.row.id} (${c.diffs.join(", ")})`).join("; ")}`);
lines.push("", "## Near misses: a candidate agrees at some occurrences of the label and not all", "");
for (const r of partial) lines.push(`- ${r.labels.join(" / ")}: ${r.candidates.filter((c) => c.agreeing > 0).map((c) => `${c.row.id} (${c.agreeing} of ${r.group.length})`).join("; ")}`);
lines.push("", "## No candidate row", "");
for (const r of lead) lines.push(`- ${r.labels.join(" / ")}`);

const outFile = flag("--out");
if (outFile) fs.writeFileSync(outFile, lines.join("\n") + "\n");
console.log(lines.slice(2, 5).join("\n"));
if (outFile) console.log(`wrote ${outFile}`);

const sample = flag("--sample");
if (sample) {
  for (const want of sample.split(",").map((s) => s.trim().toLowerCase())) {
    for (const r of results.filter((x) => x.labels.some((l) => l.toLowerCase() === want))) {
      console.log(`\n== ${r.labels.join(" / ")}: ${r.matches.length ? `MATCH ${r.matches.map((m) => m.id).join(", ")}` : "no match"}`);
      for (const o of r.group) console.log(`  ${o.entryId}: ${o.line}\n    -> ${o.figures ? showLine(o.figures) : "no figures"}`);
      for (const c of r.candidates) console.log(`  ${c.row.id} ${c.row.name}: ${showRow(c.row.figures)}; gate differs: ${c.diffs.join(", ") || "none"}`);
    }
  }
}

const registerFile = flag("--register");
if (registerFile) {
  const file = path.resolve(registerFile);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  let added = 0;
  for (const r of matched) {
    for (const o of r.group) {
      for (const form of creatureKeys(o.label)) {
        const key = hash36(form);
        const had = doc.table[key];
        if (had && had.ref !== r.matches[0].id) throw new Error(`compare-lines: key ${key} is registered to ${had.ref}, and this group matches ${r.matches[0].id}`);
        if (!had) {
          doc.table[key] = { ref: r.matches[0].id, books: [BOOK] };
          added++;
        }
      }
    }
  }
  doc.table = Object.fromEntries(Object.entries(doc.table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  console.log(`register: ${added} keys added to ${file}`);
}
