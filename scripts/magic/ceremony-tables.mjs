/**
 * The gnostic procedure's tables, read: one reader per imported table, each
 * turning the raw cells the importer stored into plain values (BTA pp. 120-121,
 * 128; the importer's `gnosis` group). Pure: it imports the tables registry and
 * nothing of Foundry, and `readCeremonyTables` takes its lookups as an
 * argument, so a test or another tradition kind supplies its own.
 *
 * Every value here is read off the Judge's own copy. What ships is the
 * procedure for reading them: a column is found by matching its header cell to
 * a level and never by position; a pace is found by the word in its cell; a
 * face is the mishap row's own label; a degree is the ordinal of the band row
 * in print order, which is the mishap column it reads. A cell that will not
 * parse is `null`, never a guess, and a missing table, row or cell is `null`
 * with the table's page (`cite`) beside it. A figure the Judge overrode has no
 * page to point at: it carries `byHand: true` and `cite: null`. An override
 * replaces a whole table, so `byHand` belongs to the table and not to a cell.
 *
 * The importer keeps no label on a performance-grid row, so the invocation
 * level of a row is the number in its key (`r3` is level 3).
 */
import { PRIORITY, bandDie, bracketRow, citeOf, getLayer, getTable, isMissingRow } from "../lib/tables.mjs";

/**
 * The table set of each tradition kind that has a reader: the registered
 * document, the ids of the four tables the engine reads, and `gridIncludes`, the
 * throw parts the grid already counts, which a caller therefore never adds.
 * Another kind registers its own set beside this one once it has a reader.
 */
export const CEREMONY_SETS = Object.freeze({
  gnosis: Object.freeze({
    docId: "gnosis",
    tables: Object.freeze({ grid: "performanceGrid", pace: "paceTable", degrees: "ceremonyDegree", mishap: "mishapTable" }),
    // BTA p. 120 (what every invoker is given) and p. 127 (a supplementary bonus).
    gridIncludes: Object.freeze(["invokerAbilities", "supplementBonus"]),
  }),
});

/** The pace keys, matched by the word a pace cell holds. */
export const PACE_KEYS = Object.freeze(["hasty", "regular", "methodical"]);

/** Every dash and minus form a print or an extraction produces. */
const MINUS_FORMS = /[\u2010-\u2015\u2212\uFE63\uFF0D]/g;

/** A cell's text with minus forms made hyphens, footnote marks dropped and whitespace collapsed; "" for a non-text cell. */
function clean(cell) {
  const s = typeof cell === "number" && Number.isFinite(cell) ? String(cell) : typeof cell === "string" ? cell : "";
  return s.replace(MINUS_FORMS, "-").replace(/[*\u2020\u2021]+/g, "").replace(/\s+/g, " ").trim();
}

/** `clean`'s sign and digits as a number; `-0` is 0. */
const signed = (sign, digits) => {
  const n = Number(digits);
  return sign === "-" && n !== 0 ? -n : n;
};

/** A cell's text for display: whitespace collapsed, null when empty or only dashes. */
export function cellText(cell) {
  const s = typeof cell === "string" ? cell.replace(/\s+/g, " ").trim() : "";
  return /^[-\s\u2010-\u2015\u2212\uFE63\uFF0D]*$/.test(s) ? null : s;
}

/**
 * A throw target as a grid prints it: a number with an optional sign and an
 * optional trailing plus ("N+" means N or better). Dash and minus forms read
 * as a negative; a cell holding no number is null.
 */
export function parseTarget(cell) {
  const m = clean(cell).match(/^([+-])?\s*(\d+)\s*\+?$/);
  return m ? signed(m[1], m[2]) : null;
}

/** A throw modifier: a signed integer ("+N", "-N", "N"), null for anything else (a lone dash included). */
export function parseModifier(cell) {
  const m = clean(cell).match(/^([+-])?\s*(\d+)$/);
  return m ? signed(m[1], m[2]) : null;
}

/**
 * A band of whole numbers as `{min, max}` (a bound is null when open): "a-b",
 * "n", "n+" or "n or higher", "n or lower". An ordinal suffix is ignored. Null
 * for anything else, a lone dash included.
 */
export function parseBand(cell) {
  const t = clean(cell).replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1");
  let m = t.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) return { min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) };
  m = t.match(/^(\d+)$/);
  if (m) return { min: +m[1], max: +m[1] };
  m = t.match(/^(\d+)\s*(?:\+|or\s+(?:more|higher|above))$/i);
  if (m) return { min: +m[1], max: null };
  m = t.match(/^(\d+)\s*or\s+(?:less|lower|below|fewer)$/i);
  if (m) return { min: null, max: +m[1] };
  return null;
}

/** The pace key a pace cell names by its word (letters may be split by spaces), else null. */
export function parsePaceKey(cell) {
  const t = typeof cell === "string" ? cell : "";
  const found = PACE_KEYS.filter((key) => new RegExp(`(?<![a-z])${[...key].join("\\s*")}(?![a-z])`, "i").test(t));
  return found.length === 1 ? found[0] : null;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * The shift a pace's degree rule puts on the invocation level: a signed number
 * ("-1", "plus 2", "less one"), or 0 for a cell that names the level and no
 * shift. Anything else is null: an amount without a direction, a direction
 * without an amount, a cell naming neither the level nor a shift.
 */
export function parseShift(cell) {
  const t = clean(cell).toLowerCase();
  if (!t) return null;
  const sign = t.match(/(?<![\d])([+-])\s*(\d+)/);
  if (sign) return signed(sign[1], sign[2]);
  const digits = t.match(/\d+/);
  const word = t.match(/\b(one|two|three|four|five)\b/);
  const amount = digits ? Number(digits[0]) : word ? NUMBER_WORDS[word[1]] : null;
  const down = /\b(less|minus|lower|fewer|reduced?|below)\b/.test(t);
  const up = /\b(more|plus|higher|greater|additional|above)\b/.test(t);
  if (amount !== null) return down && !up ? -amount : up && !down ? amount : null;
  if (down || up) return null;
  return /\b(level|tier|ceremony|invocation)\b/.test(t) ? 0 : null;
}

/** The numeric tail of a row key (`r3` is 3), else null. */
const ordinalOf = (key) => {
  const m = /^r(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
};

/** The `c<n>` keys of a stored row, in column order. */
const cellKeys = (row) =>
  Object.keys(row ?? {})
    .filter((k) => /^c\d+$/.test(k))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

/** The stored rows of a table that are rows: not a missing-row placeholder, not a non-object. */
const realRows = (raw) =>
  Object.entries(raw ?? {}).filter(([, row]) => row != null && typeof row === "object" && !isMissingRow(row));

/**
 * The performance grid: `{present, columns: [{key, min, max}], rows: {level:
 * {cellKey: number|null}}, cite, byHand}`. A column is listed only when its
 * header cell parses as a level band.
 */
export function readGrid(raw, prov = {}) {
  const out = { present: raw != null, columns: [], rows: {}, cite: prov.cite ?? null, byHand: prov.byHand === true };
  const header = raw?.columns;
  if (header && typeof header === "object" && !isMissingRow(header)) {
    for (const key of cellKeys(header)) {
      const band = parseBand(header[key]);
      if (band) out.columns.push({ key, ...band });
    }
  }
  for (const [key, row] of realRows(raw)) {
    const level = ordinalOf(key);
    if (level === null) continue;
    out.rows[level] = Object.fromEntries(cellKeys(row).map((k) => [k, parseTarget(row[k])]));
  }
  return out;
}

/**
 * The target at an invocation level for an invoker level: the column whose
 * header holds the invoker level (a single-level header beats a band that also
 * holds it), never a column picked by position. `{target, column, cite,
 * byHand}`, the target null when the table, header, row or cell is absent or
 * unparsable.
 */
export function gridTarget(grid, invocationLevel, invokerLevel) {
  const base = { target: null, column: null, cite: grid?.cite ?? null, byHand: grid?.byHand === true };
  if (!grid?.present || !Number.isInteger(invocationLevel) || !Number.isInteger(invokerLevel)) return base;
  const hits = grid.columns.filter((c) => (c.min ?? -Infinity) <= invokerLevel && invokerLevel <= (c.max ?? Infinity));
  const column = hits.find((c) => c.min === c.max) ?? hits[0] ?? null;
  if (!column) return base;
  const target = grid.rows[invocationLevel]?.[column.key];
  return { ...base, column: column.key, target: Number.isFinite(target) ? target : null };
}

/**
 * The pace table: `{present, paces: {hasty, regular, methodical}, cite,
 * byHand}`. A pace's entry is `{key, time, modifier, band, degreeShift, cite,
 * byHand}` (`time` the cell's text, `band` the automatic-failure band as
 * `{min, max}`, `degreeShift` from `parseShift`; each null when its cell will
 * not parse), or null when no row names it, or two rows do.
 */
export function readPace(raw, prov = {}) {
  const cite = prov.cite ?? null;
  const byHand = prov.byHand === true;
  const paces = Object.fromEntries(PACE_KEYS.map((k) => [k, null]));
  const seen = new Set();
  for (const [, row] of realRows(raw)) {
    const key = parsePaceKey(row.pace);
    if (!key) continue;
    if (seen.has(key)) {
      paces[key] = null;
      continue;
    }
    seen.add(key);
    paces[key] = {
      key,
      time: cellText(row.time),
      modifier: parseModifier(row.throwModifier),
      band: parseBand(row.automaticFailure),
      degreeShift: parseShift(row.mishapDegree),
      cite,
      byHand,
    };
  }
  return { present: raw != null, paces, cite, byHand };
}

/**
 * The level-to-degree table: `{present, rows: [{ordinal, min, max, word}],
 * cite, byHand}`. The ordinal is the row's place in print order, which is the
 * mishap column it reads; `word` is the cell's text for the card. A row with
 * neither bound is not a band and is left out.
 */
export function readDegrees(raw, prov = {}) {
  const rows = [];
  for (const [key, row] of realRows(raw)) {
    const ordinal = ordinalOf(key);
    if (ordinal === null) continue;
    const min = Number.isFinite(row.min) ? row.min : null;
    const max = Number.isFinite(row.max) ? row.max : null;
    if (min === null && max === null) continue;
    rows.push({ ordinal, min, max, word: cellText(row.degree) });
  }
  rows.sort((a, b) => a.ordinal - b.ordinal);
  return { present: raw != null, rows, cite: prov.cite ?? null, byHand: prov.byHand === true };
}

/**
 * The degree a level calls for: `{ordinal, word, setLost}`. A level under the
 * lowest band loses the set and has no degree; a level no band holds (above the
 * highest, or in a gap) has no degree and loses nothing; both are for the
 * caller to word. Carries the table's `cite` and `byHand`.
 */
export function degreeAt(degrees, level) {
  const out = { ordinal: null, word: null, setLost: false, cite: degrees?.cite ?? null, byHand: degrees?.byHand === true };
  if (!degrees?.rows?.length || !Number.isFinite(level)) return out;
  const row = bracketRow(degrees.rows, level);
  if (row) return { ...out, ordinal: row.ordinal, word: row.word };
  const lowest = Math.min(...degrees.rows.map((r) => r.min ?? -Infinity));
  return { ...out, setLost: level < lowest };
}

/**
 * The mishap table: `{present, die, rows: [{min, max, cells}], cite, byHand}`.
 * A row's face is its own label, so `min` and `max` are that one number; a
 * row with no integer label cannot be placed and is left out. `cells` are the
 * degree columns in print order, each the cell's text or null. `die` is the
 * die the faces fit (`bandDie`), null with no rows.
 */
export function readMishap(raw, prov = {}) {
  const rows = [];
  for (const [, row] of realRows(raw)) {
    const label = typeof row.label === "string" && /^\d+$/.test(row.label.trim()) ? Number(row.label) : row.label;
    if (!Number.isInteger(label)) continue;
    rows.push({ min: label, max: label, cells: cellKeys(row).map((k) => cellText(row[k])) });
  }
  return { present: raw != null, die: bandDie(rows), rows, cite: prov.cite ?? null, byHand: prov.byHand === true };
}

/**
 * The imported result for a face at a degree: `{cell, cite, byHand}`, the cell
 * null when no row holds the face, the degree has no column, or the cell is
 * blank. The text is shown and never run.
 */
export function mishapAt(mishap, face, degreeOrdinal) {
  const base = { cell: null, cite: mishap?.cite ?? null, byHand: mishap?.byHand === true };
  if (!mishap?.present || !Number.isInteger(face) || !Number.isInteger(degreeOrdinal) || degreeOrdinal < 1) return base;
  const row = bracketRow(mishap.rows, face);
  return { ...base, cell: row?.cells[degreeOrdinal - 1] ?? null };
}

/** The lookups `readCeremonyTables` reads through by default: the tables registry, whole. */
const REGISTRY_LOOKUP = Object.freeze({
  table(docId, tableId) {
    try {
      return getTable(docId, tableId);
    } catch {
      return null;
    }
  },
  citeOf,
  isOverridden: (docId, tableId) => getLayer(docId, PRIORITY.OVERRIDE)?.tables?.[tableId] != null,
});

/**
 * Read a tradition kind's tables into the shape `resolveCeremony` takes:
 * `{set, docId, gridIncludes, grid, pace, degrees, mishap}`. `lookup` is
 * `{table(docId, tableId), citeOf(docId, tableId), isOverridden(docId,
 * tableId)}` and defaults to the registry; `table` answers null for a table
 * nothing registered. Null for a kind with no set.
 */
export function readCeremonyTables(setKey = "gnosis", lookup = {}) {
  const set = Object.hasOwn(CEREMONY_SETS, setKey) ? CEREMONY_SETS[setKey] : null;
  if (!set) return null;
  const via = { ...REGISTRY_LOOKUP, ...lookup };
  const read = (reader, tableId) => {
    const byHand = via.isOverridden(set.docId, tableId) === true;
    return reader(via.table(set.docId, tableId) ?? null, { cite: byHand ? null : via.citeOf(set.docId, tableId) ?? null, byHand });
  };
  return {
    set: setKey,
    docId: set.docId,
    gridIncludes: [...set.gridIncludes],
    grid: read(readGrid, set.tables.grid),
    pace: read(readPace, set.tables.pace),
    degrees: read(readDegrees, set.tables.degrees),
    mishap: read(readMishap, set.tables.mishap),
  };
}
