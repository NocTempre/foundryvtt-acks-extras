/**
 * The seam between the imported `treasure` registry document and the hoard
 * engine (`hoard-logic.mjs`), and between the engine's cards and the pot's
 * truths. Pure: no Foundry, no registry. The registry's tables, the cite of
 * each table and the world's coins arrive as arguments, so nothing here knows
 * a printed figure, and a table that was not imported is a typed error, never
 * a stand-in (`ip-doctrine.md`).
 *
 * ## What the import gives and what the engine takes
 *
 * - `typeClassic|typeHeroic|typeGritty` `{<letter>: {category, avgValue, cp,
 *   sp, ep, gp, pp, gems, jewelry, magic}}` become `tables.type.rows`; the
 *   category and average are labels the engine skips.
 * - `typeUnits[style]` `{cp..pp: text}` become `units.coin`, the first figure
 *   of each text.
 * - `gemValue` and `jewelryValue` `{bands}` become `tables.values`.
 * - `gemDice` and `jewelryDice` `{legend: [{dice, avg, kind, list?}]}` name the
 *   kinds of gem and of jewelry: one kind per legend row, thrown on the row's
 *   `dice` and matched by the row's printed `kind` in the singular or the
 *   plural, whichever the cell prints. A row's `list` is the key of its
 *   special list in `GEM_LISTS` / `JEWELRY_LISTS`; a row with no `list` takes
 *   the list at its own place in the legend. A `list` outside the column's
 *   keys, or one two rows name, skips the column.
 * - `special` `{<list>: [{min, max, result, keep?}]}` and `specialPer` become
 *   `tables.special`, and only when the caller asks for special treasure: the
 *   die is the one the list's own bands span (`bandDie`), a coin list's lot
 *   size the first figure of its `per` text. A gem or jewelry list's band
 *   marked `keep: true` leaves the lot as it was (`keep`); a list with no
 *   marked band keeps the results that say one of the list's own kind. A coin
 *   list's result that counts a coin is coin (see `coinNamesIn`).
 *
 * The nouns a coin or magic column prints are read off the type table itself
 * and become the names of that column's kinds, so no noun is written here.
 */

import { bandDie } from "../lib/tables.mjs";
import { fold, parseCell } from "./hoard-logic.mjs";
import { POOL } from "./constants.mjs";
import { normalizeTruth } from "./pot-logic.mjs";

/** The treasure-type styles and the registry table each is read from. */
export const STYLE_TABLE = Object.freeze({ classic: "typeClassic", heroic: "typeHeroic", gritty: "typeGritty" });

/** The coin columns of a type row, and the keys of their special lists. */
export const COIN_KEYS = Object.freeze(["cp", "sp", "ep", "gp", "pp"]);

/** The special lists of the gem legend's rows, in the order a row with no `list` takes them. */
export const GEM_LISTS = Object.freeze(["ornamental", "gem", "brilliant"]);

/** The special lists of the jewelry legend's rows, in the order a row with no `list` takes them. */
export const JEWELRY_LISTS = Object.freeze(["trinket", "jewelry", "regalia"]);

const GEM_VALUES = "gemValue";
const JEWELRY_VALUES = "jewelryValue";

/** A cell with nothing in it: blank or a bare dash. */
const EMPTY_CELL = /^[-–—\s]*$/;

/** A special result that is a count and a noun: `1,000 <noun>`, a trailing note set aside. */
const COUNTED = /^(?:\d{1,3}(?:,\d{3})+|\d+)\s+(.+?)(?:\s*\([^)]*\))?$/;

const err = (code, rest = {}) => ({ code, ...rest });

/** The first figure in a text (`1,000`, `250`), as a number; null when it holds none. */
export function figureOf(text) {
  const m = /\d{1,3}(?:,\d{3})+|\d+/.exec(String(text ?? ""));
  return m ? Number(m[0].replace(/,/g, "")) : null;
}

/** A list of bands from either stored shape, an array or `{bands}`; null when it holds none. */
const bandsOf = (list) => {
  const bands = Array.isArray(list) ? list : list?.bands;
  return Array.isArray(bands) && bands.length ? bands : null;
};

/**
 * The spellings one printed kind goes by: itself, with a plural added, and
 * with a plural taken off. A legend names a kind in one number and a cell or
 * a result may use the other.
 */
export function formsOf(kind) {
  const k = String(kind ?? "").trim();
  if (!k) return [];
  const plural = (w) => (/(?:s|x|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  const forms = [k, /s$/i.test(k) ? k.slice(0, -1) : plural(k)];
  return [...new Set(forms.map(fold))];
}

/**
 * The nouns one column of a type table prints, in first-seen order, one per
 * distinct folded spelling, each with whether any clause printed it before its
 * count (`nounFirst`). A cell that does not read contributes none; the engine
 * reports it when that cell is dealt.
 *
 * @returns {Array<{noun: string, nounFirst: boolean}>}
 */
function nounsOf(rows, column) {
  const seen = new Map();
  for (const row of Object.values(rows ?? {})) {
    const parsed = parseCell(row?.[column], { column });
    for (const term of parsed.terms ?? []) {
      if (term.noun == null) continue;
      const key = fold(term.noun);
      const have = seen.get(key);
      if (!have) seen.set(key, { noun: term.noun, nounFirst: term.nounFirst === true });
      else if (term.nounFirst) have.nounFirst = true;
    }
  }
  return [...seen.values()];
}

/**
 * What the coin lists call each coin: the noun of a coin list's result that is
 * a count of a coin by its world name and one more word (`N <name> <word>`).
 * The engine reads such a result as coin; a list that names no coin this way
 * names none.
 *
 * @param {object} special the registry's `special` lists
 * @param {{[key: string]: string}} coinNames the world's name of each coin column
 * @returns {{[key: string]: string[]}} the nouns found, by coin column
 */
export function coinNamesIn(special, coinNames) {
  const out = {};
  for (const key of COIN_KEYS) {
    const name = coinNames?.[key] ? fold(coinNames[key]) : null;
    if (!name) continue;
    const found = new Set();
    for (const list of COIN_KEYS) {
      for (const band of bandsOf(special?.[list]) ?? []) {
        const noun = COUNTED.exec(String(band.result ?? "").trim())?.[1];
        const words = noun ? fold(noun).split(" ") : [];
        if (words.length === 2 && words[0] === name) found.add(noun);
      }
    }
    if (found.size) out[key] = [...found];
  }
  return out;
}

/**
 * The engine's kinds for one style, and the columns that could not be built.
 * A column whose legend is missing or does not give a die and a kind for each
 * list, names a list the column does not have, or names one list twice, has no
 * kinds and is listed in `skipped` with its reason (`legend-missing`,
 * `legend-shape`, `legend-list-unknown`, `legend-list-duplicate`).
 *
 * @param {object} src
 * @param {object} src.rows the style's type table
 * @param {object[]} [src.gemLegend]
 * @param {object[]} [src.jewelryLegend]
 * @param {{[key: string]: string[]}} [src.coinNouns] more names a coin kind goes by (`coinNamesIn`)
 * @returns {{kinds: object[], skipped: Array<{column: string, reason: string}>}}
 */
export function buildKinds({ rows, gemLegend, jewelryLegend, coinNouns = {} }) {
  const kinds = [];
  const skipped = [];
  for (const key of COIN_KEYS) kinds.push({ key, pool: "coins", column: key, names: [key, ...nounsOf(rows, key).map((n) => n.noun), ...(coinNouns[key] ?? [])] });

  const legendKinds = (column, legend, lists, values) => {
    const usable = Array.isArray(legend) && legend.length === lists.length && legend.every((r) => r && r.dice && r.kind);
    if (!usable) {
      skipped.push({ column, reason: legend ? "legend-shape" : "legend-missing" });
      return;
    }
    const keys = legend.map((r, i) => (r.list == null ? lists[i] : r.list));
    if (keys.some((key) => !lists.includes(key))) {
      skipped.push({ column, reason: "legend-list-unknown" });
      return;
    }
    if (new Set(keys).size !== keys.length) {
      skipped.push({ column, reason: "legend-list-duplicate" });
      return;
    }
    legend.forEach((r, i) => kinds.push({ key: keys[i], pool: column === "gems" ? "gems" : "jewelry", column, names: formsOf(r.kind), label: r.kind, values, die: r.dice }));
  };
  legendKinds("gems", gemLegend, GEM_LISTS, GEM_VALUES);
  legendKinds("jewelry", jewelryLegend, JEWELRY_LISTS, JEWELRY_VALUES);

  const magic = nounsOf(rows, "magic");
  if (!magic.length) kinds.push({ key: "magic", pool: "magic", column: "magic", names: [] });
  magic.forEach(({ noun, nounFirst }, i) => kinds.push({ key: `magic.${i}`, pool: "magic", column: "magic", names: [noun], label: noun, tableRef: noun, ...(nounFirst ? { typeList: true } : {}) }));
  return { kinds, skipped };
}

/** The type table's own key for a letter, matched without regard to case; the letter as given where none matches. */
function typeKeyOf(typeTable, letter) {
  if (typeof letter !== "string" || typeTable[letter]) return letter;
  const folded = letter.trim().toLowerCase();
  return Object.keys(typeTable).find((key) => key.toLowerCase() === folded) ?? letter;
}

/**
 * The treasure types one style's imported type table holds, in the table's own
 * order; none where that table is not imported. Read from the registry document's
 * `tables`, so a world with nothing imported offers no type.
 * @param {object|null|undefined} tables the registry document's `tables`
 * @param {"classic"|"heroic"|"gritty"} style
 * @returns {string[]}
 */
export function typeKeysOf(tables, style) {
  const table = tables?.[STYLE_TABLE[style]];
  return table && typeof table === "object" ? Object.keys(table) : [];
}

/**
 * The engine's arguments for dealing one treasure type, from the imported
 * `treasure` tables (`doc.tables`). `cite(tableId)` answers a table's page
 * reference. A style whose type table, or whose letter, was not imported is an
 * `error`; every other gap (a missing value list, special list or unit) is
 * left to the engine's own typed errors or to `column-skipped`, so what was
 * imported is still dealt. `noMagic` leaves the type row's magic column out.
 * `special` asks for special treasure; without it no special list is read.
 *
 * @param {object} args
 * @param {object} args.tables the registry document's `tables`
 * @param {string} args.letter the treasure type
 * @param {"classic"|"heroic"|"gritty"} args.style
 * @param {{noMagic?: boolean}} [args.toggles]
 * @param {boolean} [args.special] whether lots are thrown on the special lists
 * @param {{[key: string]: string}} [args.coinNames] the world's name of each coin column
 * @param {(tableId: string) => string|null} [args.cite]
 * @returns {{args: object, errors: object[], cite: string|null}|{error: object}}
 */
export function mapHoardArgs({ tables, letter, style, toggles = {}, special = false, coinNames = {}, cite = () => null }) {
  const tableId = STYLE_TABLE[style];
  if (!tableId) return { error: err("unknown-style", { style: style ?? null }) };
  const typeTable = tables?.[tableId];
  if (!typeTable || typeof typeTable !== "object") return { error: err("not-imported", { table: tableId }) };
  letter = typeKeyOf(typeTable, letter);
  if (!typeTable[letter]) return { error: err("unknown-type", { type: letter ?? null, table: tableId }) };

  const coinNouns = special ? coinNamesIn(tables.special, coinNames) : {};
  const { kinds, skipped } = buildKinds({ rows: typeTable, gemLegend: tables.gemDice?.legend, jewelryLegend: tables.jewelryDice?.legend, coinNouns });
  const row = { ...typeTable[letter] };
  const errors = [];
  for (const { column, reason } of skipped) {
    if (!EMPTY_CELL.test(String(row[column] ?? ""))) errors.push(err("column-skipped", { column, reason }));
    delete row[column];
  }
  if (toggles.noMagic) delete row.magic;

  const values = {};
  for (const id of [GEM_VALUES, JEWELRY_VALUES]) {
    const bands = bandsOf(tables[id]);
    if (bands) values[id] = { bands, cite: cite(id) };
  }

  const args = {
    type: letter,
    tables: { type: { rows: { [letter]: row }, cite: cite(tableId) }, values },
    kinds,
    units: { coin: coinUnits(tables.typeUnits?.[style]) },
    special,
  };
  if (special) {
    const lists = specialLists(tables, kinds, cite);
    if (lists) args.tables.special = lists;
    else errors.push(err("special-missing"));
  }
  return { args, errors, cite: cite(tableId) };
}

/** `units.coin` from a style's unit line: the first figure of each coin column's text, a column with none left out. */
function coinUnits(line) {
  const out = {};
  for (const key of COIN_KEYS) {
    const n = figureOf(line?.[key]);
    if (n) out[key] = n;
  }
  return out;
}

/**
 * The engine's special lists from the registry's, or null when none was
 * imported. A gem or jewelry list's `keep` is the result text of each band the
 * import marks `keep: true`, which leaves the lot as it was; a list none of
 * whose bands carries the mark reads `keep` as the results that say one of the
 * list's kind (`1 <kind>`). The engine matches a kept band by its result text,
 * so two bands printing one text are kept together.
 */
function specialLists(tables, kinds, cite) {
  const lists = tables.special;
  if (!lists || typeof lists !== "object") return null;
  const out = {};
  for (const [key, list] of Object.entries(lists)) {
    const bands = bandsOf(list);
    if (!bands) continue;
    const kind = kinds.find((k) => k.key === key && k.pool !== "coins");
    const own = new Set((kind?.names ?? []).map((n) => `1 ${n}`));
    const marked = kind ? bands.filter((b) => b.keep === true) : [];
    const per = figureOf(tables.specialPer?.[key]);
    out[key] = {
      bands,
      die: bandDie(bands),
      cite: cite("special"),
      ...(COIN_KEYS.includes(key) && per ? { per } : {}),
      keep: (marked.length ? marked.map((b) => b.result) : bands.map((b) => b.result).filter((t) => own.has(fold(String(t))))).filter((t) => typeof t === "string"),
    };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The engine's cards as the pot's truths. A coin card names the world's coin
 * through `coinOf(key) -> {name, cv, weight6?: (count) => number}|null`; a key
 * the world has no coin for is a `coin-missing` error and the card is left out,
 * never valued at a stand-in. A magic card is a placeholder carrying the
 * `tableRef` the magic-item roll resolves, undetected and unidentified, and
 * `typeList: true` where the noun was printed before its count; neither is
 * part of a stored truth, and both are dropped when the truth is normalized
 * again.
 *
 * @param {object[]} cards the engine's `cards`
 * @param {{coinOf: (key: string) => object|null, format?: (n: number) => string}} deps
 * @returns {{truths: object[], errors: object[]}}
 */
export function truthsFromCards(cards, { coinOf, format = String }) {
  const truths = [];
  const errors = [];
  for (const card of cards ?? []) {
    if (card.pool === "coins") {
      const coin = coinOf(card.coin.key);
      if (!coin?.name || !Number.isFinite(coin.cv) || coin.cv <= 0) { errors.push(err("coin-missing", { key: card.coin.key })); continue; }
      const count = card.coin.count;
      truths.push(normalizeTruth({
        pool: POOL.coins,
        label: `${format(count)} ${coin.name}`,
        coin: { name: coin.name, cv: coin.cv, count },
        weight6: coin.weight6 ? coin.weight6(count) : 0,
      }));
    } else if (card.pool === "gems" || card.pool === "jewelry") {
      truths.push(normalizeTruth({ pool: card.pool === "gems" ? POOL.gems : POOL.jewelry, label: card.label, valueGp: card.valueGp }));
    } else if (card.pool === "special") {
      truths.push(normalizeTruth({ pool: POOL.special, label: card.label }));
    } else if (card.pool === "magic") {
      truths.push({ ...normalizeTruth({ pool: POOL.magic, label: card.label, magical: true, detected: false }), tableRef: card.tableRef, ...(card.typeList ? { typeList: true } : {}) });
    } else errors.push(err("unknown-pool", { pool: card.pool ?? null }));
  }
  return { truths, errors };
}
