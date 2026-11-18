/**
 * The hoard generator's engine: a treasure type's row of cells becomes the
 * cards a pot deals (JJ ch. 4, "Treasure Type" and "Treasure Sub-types"). Pure:
 * no Foundry, no registry. Every table, every cite, every kind name, every
 * unit and every die arrives as an argument, because every one of them is
 * printed and is read from the Judge's own copy (`ip-doctrine.md`). The module
 * knows the procedure: a cell may open with a chance, then a count, then a
 * noun; a chance is a percentile throw; a count is rolled, then each unit is
 * thrown on a band list; a lot of coin, or one gem or piece of jewelry, may be
 * swapped for a special treasure.
 *
 * Nothing is guessed. A cell that does not read, a noun no kind names, a band
 * list that does not tile the die it is rolled on, a die that was not
 * supplied, a roll the die cannot make: each is a typed `{error: {code, ...}}`
 * the caller localizes, and the rest of the hoard is still dealt.
 *
 * ## Contracts
 *
 * - **Roller**: `roll(expr) -> {total, sides}`. `expr` is `NdM`, `NdM+K` or
 *   `dM-K`; `sides` is the faces of the die actually thrown, so a roller that
 *   threw the wrong die is caught here (`rollerFrom` builds one from an rng).
 * - **Kinds**: `[{key, names, pool, column?, label?, tableRef?, values?, die?}]`.
 *   `pool` is `coins|gems|jewelry|magic`; `names` are the nouns the import
 *   prints for the kind (matched whole, case and accent folded, plural forms
 *   listed by the caller); `column` is the treasure-type column the kind
 *   belongs to; a gem or jewelry kind names its band list in `values` and the
 *   dice it is thrown with in `die`; a magic kind's `tableRef` is the noun the
 *   placeholder is rolled by (`magic-deal-logic.mjs`), null for a kind that
 *   prints none.
 * - **Tables**: `{type: {rows, cite}, values: {<key>: band table},
 *   special?: {<kind key>: band table}}`; a band table is `{bands, die, cite,
 *   per?, keep?}` with bands `{min|lo, max|hi, ...}`. `per` is a coin list's
 *   lot size, `keep` the result texts that leave a lot as it was.
 * - **Units**: `{coin}`, the multiplier the coin columns are counted in, a
 *   number or a map by coin key.
 */

import { rollDice } from "../lib/template-logic.mjs";

/** Columns of a type row that are labels, not cells to roll. */
const LABEL_KEYS = new Set(["category", "avgValue"]);

/** Faces of the percentile die a cell's chance is thrown on. */
const PERCENTILE = "1d100";

const err = (code, rest = {}) => ({ error: { code, ...rest } });

/** A string folded for matching: case, accents, runs of space and edge punctuation. */
export const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "");

const DICE_SRC = "\\d*d\\d+(?:[+-]\\d+)?|\\d+";
const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/i;

/**
 * A dice expression read into `{count, sides, mod, min, max}`: the range a
 * roll of it must fall in. A bare whole number is `{sides: null}` and is not
 * thrown. Null for anything else.
 */
export function parseDice(expr) {
  const s = String(expr ?? "").replace(/\s+/g, "");
  if (/^\d+$/.test(s)) return { count: 0, sides: null, mod: Number(s), min: Number(s), max: Number(s) };
  const m = DICE_RE.exec(s);
  if (!m) return null;
  const count = m[1] === "" ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  if (!count || !sides) return null;
  return { count, sides, mod, min: count + mod, max: count * sides + mod };
}

/**
 * A roller from an rng (`() => [0, 1)`), thrown with the shared dice
 * routine; the production roller is any function of the same contract.
 */
export function rollerFrom(rng) {
  return (expr) => {
    const p = parseDice(expr);
    if (!p || p.sides == null) return null;
    return { total: rollDice(expr, rng), sides: p.sides };
  };
}

/**
 * Throw `expr` on the injected roller and hold the result to the die: the
 * faces it reports are the faces asked for, and the total lies in the
 * expression's range. A bare whole number is returned unthrown.
 *
 * @returns {{total: number, sides: number|null, min: number, max: number, expr: string}|{error: object}}
 */
export function rollChecked(roll, expr) {
  const p = parseDice(expr);
  if (!p) return err("die-unreadable", { expr });
  if (p.sides == null) return { total: p.mod, sides: null, min: p.min, max: p.max, expr: String(expr) };
  const r = roll(expr);
  if (!r || !Number.isInteger(r.total)) return err("roll-failed", { expr });
  if (r.sides !== p.sides) return err("die-mismatch", { expr, expected: p.sides, got: r.sides ?? null });
  if (r.total < p.min || r.total > p.max) return err("roll-out-of-range", { expr, total: r.total, min: p.min, max: p.max });
  return { total: r.total, sides: p.sides, min: p.min, max: p.max, expr: String(expr) };
}

/**
 * A band list's rows as `{min, max, row}`, ascending, held to the die it is
 * rolled on: contiguous (no gap, no overlap, a missing-row placeholder is a
 * gap), covering `range`, and with `exact` set ending where the range ends. A
 * list shared by several dice (each a sub-range of it) is not `exact`.
 *
 * @param {object[]} bands rows with `min|lo` and `max|hi`
 * @param {{min: number, max: number}} range what the die can throw
 * @param {{exact?: boolean}} [opts]
 * @returns {{bands: object[]}|{error: object}}
 */
export function checkBands(bands, range, { exact = false } = {}) {
  if (!Array.isArray(bands) || !bands.length) return err("bands-empty");
  const rows = [];
  for (const [i, row] of bands.entries()) {
    const min = row?.min ?? row?.lo;
    const max = row?.max ?? row?.hi;
    if (row?.__missing || !Number.isInteger(min) || !Number.isInteger(max) || min > max) return err("band-bad-edge", { index: i });
    rows.push({ min, max, row });
  }
  rows.sort((a, b) => a.min - b.min);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].min > rows[i - 1].max + 1) return err("band-gap", { after: rows[i - 1].max });
    if (rows[i].min <= rows[i - 1].max) return err("band-overlap", { at: rows[i].min });
  }
  const first = rows[0].min;
  const last = rows[rows.length - 1].max;
  if (first > range.min || (exact && first < range.min)) return err("band-start", { first, die: range });
  if (last < range.max) return err("band-short", { top: last, die: range });
  if (exact && last > range.max) return err("band-over", { top: last, die: range });
  return { bands: rows };
}

/**
 * Throw `die` and read the band it lands in. The die is the caller's: a table
 * with no die supplied is `die-unknown`, never derived from its top band.
 *
 * @param {{bands: object[], cite?: string}} table
 * @param {string} die dice expression the list is rolled on
 * @returns {{row: object, roll: object}|{error: object}}
 */
export function rollOnBands(table, die, roll, { exact = false } = {}) {
  if (!die) return err("die-unknown");
  const p = parseDice(die);
  if (!p || p.sides == null) return err("die-unreadable", { expr: die });
  const checked = checkBands(table?.bands, p, { exact });
  if (checked.error) return checked;
  const r = rollChecked(roll, die);
  if (r.error) return r;
  const hit = checked.bands.find((b) => r.total >= b.min && r.total <= b.max);
  return hit ? { row: hit.row, roll: r } : err("band-gap", { at: r.total });
}

/**
 * One clause of a cell read into `{chance, count, noun}`: an optional chance
 * (`N%`), then a count (dice or a whole number) and a noun in either order, the
 * noun optional when the column names it. A clause that puts its noun before
 * its count also carries `nounFirst: true`; a count-first clause does not. A
 * chance of zero is a clause that never fires and its remainder is not read.
 * `count` is null only for a clause that never fires.
 */
function parseClause(text) {
  let s = text.trim();
  const c = /^(\d{1,3})\s*%\s*(.*)$/.exec(s);
  let chance = null;
  if (c) {
    chance = Number(c[1]);
    s = c[2].trim();
    if (chance === 0) return { chance: 0, count: null, noun: null };
    if (chance > 100) return err("bad-chance", { text });
  }
  if (!s) return err("missing-count", { text });
  const front = new RegExp(`^(${DICE_SRC})\\s*(.*)$`, "i").exec(s);
  if (front && parseDice(front[1])) return { chance, count: front[1], noun: front[2].trim() || null };
  const back = new RegExp(`^(\\D.*?)\\s*(${DICE_SRC})$`, "i").exec(s);
  if (back && parseDice(back[2])) return { chance, count: back[2], noun: back[1].trim(), nounFirst: true };
  return err(chance == null ? "unparseable" : "missing-count", { text });
}

const NOTE_RE = /\s*\(\s*[\d,.]+\s*[^\s\d()]*\s*\)\s*$/;
const SPLIT_RE = /\s*(?:;|,(?=\s+\d)|\s\+\s)\s*/;
const EMPTY_RE = /^[-–—\s]*$/;

/**
 * Read one treasure-type cell exactly as the importer delivers it, the page's
 * own text. Clauses are separated by `;`, by a comma before a figure, or by
 * ` + `; each is `[chance%] count [noun]` or `[chance%] noun count`. A trailing
 * parenthesized figure (an average) is set aside as `note` and never rolled. An
 * empty cell, a null cell and a bare dash are a cell with nothing in it.
 *
 * @param {string|null} cell
 * @param {{column?: string}} [opts] the column key, a hint for a clause with no noun
 * @returns {{terms: object[], note: string|null}|{error: object}} each term is
 *   `{chance, count, noun, column}`, plus `nounFirst: true` where the clause
 *   printed its noun before its count
 */
export function parseCell(cell, { column = null } = {}) {
  const raw = String(cell ?? "").replace(/\s+/g, " ").trim();
  if (EMPTY_RE.test(raw)) return { terms: [], note: null };
  const m = NOTE_RE.exec(raw);
  const body = m ? raw.slice(0, m.index) : raw;
  const terms = [];
  for (const part of body.split(SPLIT_RE)) {
    if (!part) continue;
    const t = parseClause(part);
    if (t.error) return { error: { ...t.error, cell: raw } };
    terms.push({ ...t, column });
  }
  return terms.length ? { terms, note: m ? m[0].trim() : null } : err("unparseable", { cell: raw });
}

/**
 * Which kind a noun names, matched whole against the names the import
 * printed, never against a word this module knows. A clause with no noun takes
 * the one kind its column holds; a noun whose kind belongs to another column
 * is a disagreement, not a choice.
 *
 * @returns {{kind: object}|{error: object}}
 */
export function resolveNoun(noun, kinds, column = null) {
  const col = column == null ? null : fold(column);
  if (noun == null) {
    const held = (kinds ?? []).filter((k) => col != null && k.column != null && fold(k.column) === col);
    if (held.length === 1) return { kind: held[0] };
    return err(held.length ? "noun-missing" : "unknown-noun", { noun: null, column });
  }
  const hits = (kinds ?? []).filter((k) => (k.names ?? []).some((n) => fold(n) === fold(noun)));
  if (!hits.length) return err("unknown-noun", { noun, column });
  if (hits.length > 1) return err("ambiguous-noun", { noun, kinds: hits.map((k) => k.key) });
  const [kind] = hits;
  if (col != null && kind.column != null && fold(kind.column) !== col) return err("column-mismatch", { noun, column, kindColumn: kind.column });
  return { kind };
}

/** A band's value text (`1,000`) as a number, or null. */
function parseFigure(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/\s+/g, "");
  return /^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, "")) : null;
}

const unitOf = (units, key) => (typeof units === "number" ? units : units?.[key]);
const labelOf = (k) => k.label ?? k.names?.[0] ?? k.key;

/**
 * A special-treasure result as a count of a coin kind ("N <coin name>", a
 * trailing parenthesized note set aside), else null.
 */
function coinResult(text, kinds) {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(.+?)(?:\s*\([^)]*\))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const hits = kinds.filter((k) => k.pool === "coins" && (k.names ?? []).some((n) => fold(n) === fold(m[2])));
  return hits.length === 1 ? { kind: hits[0], count: Number(m[1].replace(/,/g, "")) } : null;
}

/**
 * Deal one treasure type: every cell's chance and count are thrown on the
 * injected roller, each unit of gems and jewelry on its band list, magic as a
 * placeholder per unit, then (when `tables.special` is supplied and `special`
 * is not false) each lot of coin and each gem or piece of jewelry on its
 * special list. Cards are `{pool, coin|valueGp|tableRef, label, cite}`; a magic
 * card also carries `typeList: true` when its kind does.
 *
 * @param {object} args
 * @param {string} args.type the row key of `tables.type.rows`
 * @param {object} args.tables see the file header
 * @param {object[]} args.kinds see the file header
 * @param {(expr: string) => {total: number, sides: number}} args.roll
 * @param {{coin?: number|object}} [args.units]
 * @param {boolean} [args.special] false turns special substitution off
 * @returns {{cards: object[], audit: object[], errors: object[]}} `audit` lists
 *   each throw with its die, range, result and the cite of its table
 */
export function dealHoard({ type, tables, kinds, roll, units = {}, special = true }) {
  const cards = [];
  const audit = [];
  const errors = [];
  const fail = (e, where) => errors.push({ ...e.error, where });
  const row = tables?.type?.rows?.[type];
  if (!row) return { cards, audit, errors: [{ code: "unknown-type", type }] };
  const typeCite = tables.type.cite ?? null;
  const thrown = []; // cards with the kind each came from, for the special pass

  const throwOn = (expr, where, cite, extra = {}) => {
    const r = rollChecked(roll, expr);
    if (r.error) return r;
    if (r.sides != null) audit.push({ where, expr, sides: r.sides, min: r.min, max: r.max, total: r.total, cite, ...extra });
    return r;
  };

  for (const [column, cell] of Object.entries(row)) {
    if (LABEL_KEYS.has(column)) continue;
    const where = `${type}.${column}`;
    const parsed = parseCell(cell, { column });
    if (parsed.error) { fail(parsed, where); continue; }
    for (const term of parsed.terms) {
      if (term.chance === 0) { audit.push({ where, chance: 0, hit: false, cite: typeCite }); continue; }
      const noun = resolveNoun(term.noun, kinds, column);
      if (noun.error) { fail(noun, where); continue; }
      const kind = noun.kind;
      if (term.chance != null) {
        const c = throwOn(PERCENTILE, where, typeCite, { chance: term.chance });
        if (c.error) { fail(c, where); continue; }
        const hit = c.total <= term.chance;
        audit[audit.length - 1].hit = hit;
        if (!hit) continue;
      }
      const n = throwOn(term.count, where, typeCite, { count: true });
      if (n.error) { fail(n, where); continue; }
      const count = n.total;

      if (kind.pool === "coins") {
        const unit = unitOf(units.coin, kind.key);
        if (!Number.isFinite(unit) || unit <= 0) { fail(err("unit-missing", { key: kind.key }), where); continue; }
        const card = { pool: "coins", coin: { key: kind.key, count: count * unit }, label: labelOf(kind), cite: typeCite };
        cards.push(card);
        thrown.push({ card, kind });
      } else if (kind.pool === "gems" || kind.pool === "jewelry") {
        const values = tables.values?.[kind.values];
        if (!values) { fail(err("table-missing", { table: kind.values ?? null }), where); continue; }
        for (let i = 0; i < count; i++) {
          const hit = rollOnBands(values, kind.die, roll);
          if (hit.error) { fail(hit, where); break; }
          const valueGp = parseFigure(hit.row.value ?? hit.row.valueGp);
          if (valueGp == null) { fail(err("bad-value", { value: hit.row.value ?? null }), where); continue; }
          audit.push({ where, expr: kind.die, sides: hit.roll.sides, min: hit.roll.min, max: hit.roll.max, total: hit.roll.total, cite: values.cite ?? null, valueGp });
          const card = { pool: kind.pool, valueGp, label: hit.row.type ?? labelOf(kind), cite: values.cite ?? null };
          cards.push(card);
          thrown.push({ card, kind });
        }
      } else if (kind.pool === "magic") {
        for (let i = 0; i < count; i++) cards.push({ pool: "magic", tableRef: kind.tableRef ?? null, ...(kind.typeList ? { typeList: true } : {}), label: labelOf(kind), cite: typeCite });
      } else fail(err("unknown-pool", { pool: kind.pool ?? null }), where);
    }
  }

  if (special && tables.special) dealSpecial({ cards, thrown, tables, kinds, roll, audit, fail });
  return { cards, audit, errors };
}

/**
 * Swap lots for special treasures in place: each lot of a coin card (its
 * list's `per` coins; a remainder short of a lot is not one), and each gem or
 * piece of jewelry, throws on its kind's special list. A result that counts a
 * coin kind is coin and joins that coin card; a result in the list's `keep`
 * leaves the lot as it was; any other result takes the lot's place as a
 * `special` card.
 */
function dealSpecial({ cards, thrown, tables, kinds, roll, audit, fail }) {
  const addCoin = (kind, count, cite) => {
    const have = cards.find((c) => c.pool === "coins" && c.coin.key === kind.key);
    if (have) have.coin.count += count;
    else cards.push({ pool: "coins", coin: { key: kind.key, count }, label: labelOf(kind), cite });
  };
  const swap = (list, where, replace) => {
    const hit = rollOnBands(list, list.die, roll, { exact: true });
    if (hit.error) { fail(hit, where); return; }
    audit.push({ where, expr: list.die, sides: hit.roll.sides, min: hit.roll.min, max: hit.roll.max, total: hit.roll.total, cite: list.cite ?? null, special: true });
    const text = hit.row.result ?? hit.row.text ?? null;
    if (text == null || (list.keep ?? []).some((k) => fold(k) === fold(text))) return;
    const coin = coinResult(text, kinds);
    replace();
    if (coin) addCoin(coin.kind, coin.count, list.cite ?? null);
    else cards.push({ pool: "special", label: String(text), cite: list.cite ?? null });
  };

  for (const { card, kind } of [...thrown]) {
    const list = tables.special[kind.key];
    const where = `special.${kind.key}`;
    if (!list) { fail(err("table-missing", { table: kind.key }), where); continue; }
    if (card.pool === "coins") {
      const per = list.per;
      if (!Number.isFinite(per) || per <= 0) { fail(err("lot-unit-missing", { key: kind.key }), where); continue; }
      const lots = Math.floor(card.coin.count / per);
      for (let i = 0; i < lots; i++) swap(list, where, () => { card.coin.count -= per; });
    } else {
      swap(list, where, () => { cards.splice(cards.indexOf(card), 1); });
    }
  }
  for (let i = cards.length - 1; i >= 0; i--) if (cards[i].pool === "coins" && cards[i].coin.count <= 0) cards.splice(i, 1);
}
