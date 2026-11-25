/**
 * References from a beastman organisation to creatures that are not beastmen: a
 * village's guard beasts, a chieftain's escort, the mount a rider is given. A
 * printed word names such a creature, and its library entry exists only once
 * the Judge has imported it, so the match is made at generation and nothing
 * here states a creature's name. Pure and Foundry-free.
 *
 * Two halves. The resolver (`resolveOutside`) folds a printed word and the
 * library's entry names to token sets (case, punctuation, word order and a
 * plural all fold away: "X, Y" meets "Y Xs") and answers an entry only on
 * equality with exactly one. Two entries of one fold, or an entry that carries
 * more words than the page prints (a qualifier or a category word the page
 * leaves out), are never picked between: they come back as candidates on a
 * finding the Judge links by hand. The cell readers (`readBeastCell`,
 * `readMountCell`) read the village table's and the mount row's printed text
 * into the recipe's part shape, at generation, over the imported cells, so a
 * Judge's override of a table counts without a repair.
 *
 * Rulings: docs/monsters/MODEL.md, "Outside references".
 */
import { roleKeyOf } from "../importer/leader-roles.mjs";

/** Words a page puts before a creature to say what is done with it, not what it is: dropped before the fold. */
export const QUALIFIERS = Object.freeze(["trained"]);

/** What a reference came to. */
export const REFERENCE = Object.freeze({
  resolved: "resolved", // exactly one entry folds to the word
  ambiguous: "ambiguous", // two or more entries fold to it
  partial: "partial", // no entry equals it; some carry more words than the page prints
  none: "none", // nothing in the library answers
});

/** A token's singular: ves, ies and the sibilant plurals, then a bare s. Applied to both sides of a match, so an over-reach folds alike. */
export const singular = (w) => w.replace(/ves$/, "f").replace(/(ch|sh|x|ss)es$/, "$1").replace(/ies$/, "y").replace(/([^s])s$/, "$1");

/**
 * The sorted singular tokens of a printed word or an entry's name, qualifiers
 * dropped. Order, case and punctuation do not reach the result.
 * @param {string} text
 * @param {string[]} [qualifiers]
 * @returns {string[]}
 */
export function foldTokens(text, qualifiers = QUALIFIERS) {
  const drop = new Set((qualifiers ?? []).map((q) => String(q).toLowerCase()));
  return String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !drop.has(w))
    .map(singular)
    .sort();
}

const sameTokens = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
const containsAll = (big, small) => small.every((t) => big.includes(t)) && big.length > small.length;

/**
 * Match a printed word to the library. An entry answers only when its folded
 * tokens equal the word's and no other entry's do; a word with no equal entry
 * lists, as `candidates`, the entries that carry every one of its tokens and
 * more, and is never resolved by them.
 *
 * @param {string} word the creature as the page prints it
 * @param {{name: string, uuid?: string}[]} entries the library's index
 * @param {{qualifiers?: string[]}} [options]
 * @returns {{status: string, entry: object|null, candidates: object[]}}
 */
export function resolveOutside(word, entries, { qualifiers = QUALIFIERS } = {}) {
  const wanted = foldTokens(word, qualifiers);
  if (!wanted.length) return { status: REFERENCE.none, entry: null, candidates: [] };
  const folded = (entries ?? []).filter((e) => e?.name).map((entry) => ({ entry, tokens: foldTokens(entry.name, []) }));
  const equal = folded.filter((f) => sameTokens(f.tokens, wanted)).map((f) => f.entry);
  if (equal.length === 1) return { status: REFERENCE.resolved, entry: equal[0], candidates: [] };
  if (equal.length > 1) return { status: REFERENCE.ambiguous, entry: null, candidates: equal };
  const wider = folded.filter((f) => containsAll(f.tokens, wanted)).map((f) => f.entry);
  return { status: wider.length ? REFERENCE.partial : REFERENCE.none, entry: null, candidates: wider };
}

/* -------------------------------------------- */
/*  The table cells                              */
/* -------------------------------------------- */

const DICE = String.raw`\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?|\d+`;
/** A beast cell: an optional chance, a count, then what is counted. */
const BEAST_CELL = new RegExp(String.raw`^(?:(\d+)\s*%\s*chance\s*(?:for|of)?\s*)?(${DICE})\s+(?:(extra)\s+)?(.*?)\s*(?:per\s+([\p{L}-]+))?\s*$`, "iu");

/** A count as the part's `count` object: a plain figure is a literal, anything else dice. */
const countOf = (s) => {
  const t = String(s).replace(/\s+/g, "").toLowerCase();
  return /^\d+$/.test(t) ? { literal: parseInt(t, 10) } : { dice: t };
};

/**
 * One village-table cell that counts something, read to its parts of speech:
 * `{kind, chance, count, word, perUnit}`. `kind` is `beast` (a creature word),
 * `extra` (more of a leader rank, the word naming the rank) or `perUnit` (a
 * count per unit, no creature word). A cell that is blank, "none", or reads
 * as anything else (a level die, a share that fights as another kind) is null.
 * @param {string|null} text the cell as printed
 * @returns {{kind: string, chance: number|null, count: object, word: string, perUnit: string}|null}
 */
export function readBeastCell(text) {
  const t = String(text ?? "").trim();
  if (!t || /^(?:none|[-—–])$/i.test(t) || /[()]/.test(t)) return null;
  const m = BEAST_CELL.exec(t);
  if (!m) return null;
  const [, chance, dice, extra, word, perUnit] = m;
  const kind = extra ? "extra" : perUnit && !word ? "perUnit" : word ? "beast" : null;
  if (!kind) return null;
  return { kind, chance: chance ? parseInt(chance, 10) : null, count: countOf(dice), word: word.trim(), perUnit: (perUnit ?? "").toLowerCase() };
}

/** The key a Role cell of the family template carries: `variant|role`. */
const cellOf = (variant, role) => (variant ? `${variant}|${role}` : role);

/**
 * A village-table cell as a recipe part of the table's own (`basis: "table"`),
 * or null where the cell is no beast, escort or per-unit count. A creature word
 * keeps `source.name` and an empty `source.uuid`; an extra leader rank names its
 * Role cell of the breed's template.
 *
 * @param {object} args
 * @param {string} args.key the part's key
 * @param {string|null} args.text the cell as printed
 * @param {string} args.variant the breed's variant key
 * @param {string[]} args.units the unit words the village row applies to
 * @param {string} [args.cite] the table's page
 * @returns {object|null}
 */
export function beastCellPart({ key, text, variant, units, cite = "" }) {
  const cell = readBeastCell(text);
  if (!cell || cell.kind === "perUnit") return null;
  const role = cell.kind === "extra" ? roleKeyOf(cell.word) : null;
  if (cell.kind === "extra" && !role) return null;
  return {
    key,
    label: cell.word,
    role: "guard",
    source: { uuid: "", templateCell: role ? cellOf(variant, role) : "", stat: "", name: role ? "" : cell.word },
    count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...cell.count },
    chance: cell.chance,
    when: { state: "", place: "", units: [...units] },
    branch: { group: "", band: "" },
    moraleWhileAlive: null,
    cite,
    basis: "table",
  };
}

/**
 * The creature word a mount row prints for a breed, or null where the breed
 * rides none. `mounts` and `alongside` are the row's `{breedKey: text}` maps.
 * `alongside` names beasts that fight beside the riders and carry none.
 * @param {{mounts?: object, alongside?: object}} row
 * @param {string} variant
 * @returns {{word: string, rides: boolean}|null}
 */
export function readMountCell(row, variant) {
  const mount = String(row?.mounts?.[variant] ?? "").trim();
  if (mount) return { word: mount, rides: true };
  const beside = String(row?.alongside?.[variant] ?? "").trim();
  return beside ? { word: beside, rides: false } : null;
}

/**
 * Every outside reference of a list of parts, resolved against the library:
 * a part with a creature word (`source.name`, no Role cell, no uuid) comes back
 * with the match, and one a Judge already linked (`source.uuid`) answers that
 * link. A part with no word, and a captive part (a count of no named kind), is
 * not a reference and is left out.
 *
 * @param {object[]} parts recipe parts
 * @param {{name: string, uuid?: string}[]} entries the library's index
 * @returns {{part: object, uuid: string, status: string, entry: object|null, candidates: object[]}[]}
 */
export function resolveParts(parts, entries) {
  const out = [];
  for (const part of parts ?? []) {
    if (part?.role === "captive") continue;
    const linked = String(part?.source?.uuid ?? "");
    const word = String(part?.source?.name ?? "").trim();
    if (linked) out.push({ part, uuid: linked, status: REFERENCE.resolved, entry: { name: word, uuid: linked }, candidates: [] });
    else if (word && !part?.source?.templateCell) out.push({ part, uuid: "", ...resolveOutside(word, entries) });
  }
  return out.map((r) => ({ ...r, uuid: r.uuid || String(r.entry?.uuid ?? "") }));
}
