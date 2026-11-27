/**
 * The Strength modifier a monster's natural attacks take, read from the Judge's
 * own Monstrous Manual (MM ch. 3, Attributes for Monsters) out of the
 * `monsters` registry document's `strengthAttack` table; nothing in source
 * states a band or a figure, and a table that was not imported answers null.
 * The table's rows are attribute scores and its columns are bands of a natural
 * attack's average damage; its header row is stored as a row of its own
 * (`header: true`, one `col<N>` cell per band, left to right), so the bands are
 * the page's. A Judge's override layer is read like the import. Foundry-free.
 */
import { citeOf, expectTables, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";

/** The registry document the table sits on. */
export const STRENGTH_DOC = "monsters";

// Literal, because the producers gate reads this call from source.
expectTables(STRENGTH_DOC, ["strengthAttack"]);

/** The stored table, or null where it is absent or unread. */
function tableOf() {
  if (!hasDoc(STRENGTH_DOC)) return null;
  const table = getDoc(STRENGTH_DOC)?.tables?.strengthAttack;
  return table && typeof table === "object" && !isMissingRow(table) ? table : null;
}

/** Every dash a band's two edges are printed between. */
const DASH = "[-‐-―−]";
const OR_LESS = /^(\d+(?:\.\d+)?)\s*or\s*(?:less|fewer|lower)$/i;
const OR_MORE = /^(\d+(?:\.\d+)?)\s*or\s*(?:more|higher|greater)$/i;
const SPAN = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${DASH}\\s*(\\d+(?:\\.\\d+)?)$`);

/** One header cell as `{min, max}` (a null edge is open), or null where it is no band. */
function parseBand(cell) {
  const text = String(cell ?? "").replace(/\s+/g, " ").trim();
  let m = OR_LESS.exec(text);
  if (m) return { min: null, max: Number(m[1]) };
  m = OR_MORE.exec(text);
  if (m) return { min: Number(m[1]), max: null };
  m = SPAN.exec(text);
  if (m && Number(m[1]) <= Number(m[2])) return { min: Number(m[1]), max: Number(m[2]) };
  return null;
}

/**
 * The bands of average damage the table's columns stand for, left to right, as
 * `{key, min, max}`: `key` is the column's key in every score row, an open edge
 * (a "or less" first band, an "or more" last one) is null. Null where the table
 * is absent, holds no header row, or a header cell reads as no band.
 * @returns {{key: string, min: number|null, max: number|null}[]|null}
 */
export function strengthBands() {
  const table = tableOf();
  if (!table) return null;
  const header = Object.values(table).find((row) => row && typeof row === "object" && row.header === true);
  if (!header) return null;
  const keys = Object.keys(header)
    .filter((key) => /^col\d+$/.test(key))
    .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  if (!keys.length) return null;
  const bands = [];
  for (const key of keys) {
    const band = parseBand(header[key]);
    if (!band) return null;
    bands.push({ key, ...band });
  }
  return bands;
}

/**
 * The band holding an average damage. An average between two printed bands (past
 * one band's upper edge and short of the next band's lower edge) falls in the
 * lower of the two, so a half beyond a whole-number band stays in it. An average
 * below the first band's lower edge or past the last band's upper edge is in no
 * band. Null for an average that is not a finite number, or where the table
 * gives no bands.
 * @param {number} average the natural attack's average damage
 * @returns {{key: string, min: number|null, max: number|null}|null}
 */
export function strengthBandFor(average) {
  if (!Number.isFinite(average)) return null;
  const avg = average;
  const bands = strengthBands();
  if (!bands) return null;
  let at = -1;
  bands.forEach((band, i) => {
    if (band.min == null || avg >= band.min) at = i;
  });
  if (at < 0) return null;
  const band = bands[at];
  if (band.max != null && avg > band.max && at === bands.length - 1) return null;
  return band;
}

/**
 * The attack-throw and damage modifier the table gives an attribute score for an
 * attack of the given average damage, with the band it was read from and the
 * page the table was read from (null for a Judge's override, which has none).
 * Null where the table is absent, the score has no row, the average is no
 * finite number or falls in no band, or the cell is blank or not a number.
 * @param {number} score the monster's entered attribute score
 * @param {number} average the natural attack's average damage
 * @returns {{value: number, band: {key: string, min: number|null, max: number|null}, cite: string|null}|null}
 */
export function strengthAttackBonus(score, average) {
  const table = tableOf();
  if (!table || !Number.isInteger(score)) return null;
  const band = strengthBandFor(average);
  if (!band) return null;
  const row = table[String(score)];
  if (!row || typeof row !== "object" || row.header === true || isMissingRow(row)) return null;
  const cell = row[band.key];
  if (cell == null || (typeof cell === "string" && !cell.trim())) return null;
  const value = Number(cell);
  if (!Number.isFinite(value)) return null;
  return { value, band, cite: citeOf(STRENGTH_DOC, "strengthAttack") };
}
