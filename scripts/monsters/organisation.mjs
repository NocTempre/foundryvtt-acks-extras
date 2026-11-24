/**
 * The beastman organisation tables as the Judge's world holds them: the village
 * makeup, the leader grades, the special-troop roll bands and the tribal-trait
 * roll bands (MM pp. 54-55, 57), read from the `monsters` registry document
 * and nothing else. No row, breed or figure is stated here: every row key is
 * minted from the printed label at import, every column key is a Variant key
 * of the beastman family template, and a cell is what the page prints. Pure
 * and Foundry-free; a Judge's override of a table (the Ruledata Browser) is
 * what a read returns, and a table not imported answers empty with no
 * citation.
 */
import { citeOf, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";

/** The registry document the organisation tables are read from. */
export const ORGANISATION_DOC = "monsters";

/** The tables of `ORGANISATION_DOC` read here, by role. */
export const ORGANISATION_TABLES = Object.freeze({
  village: "beastmanVillage",
  leaders: "beastmanLeaders",
  troops: "beastmanSpecialTroops",
  traits: "beastmanTraits",
});

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const whole = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** A village cell: the printed text, or null where the page prints none. */
const villageCell = (v) => text(v);

/**
 * A roll band, `{min, max}` of whole numbers with `min <= max`, or null: a
 * dash or blank on the page (a breed the row does not apply to) and a value
 * that is not a band alike.
 */
export function bandCell(v) {
  const min = whole(v?.min);
  const max = whole(v?.max);
  return min !== null && max !== null && min <= max ? { min, max } : null;
}

/**
 * A leader cell, `{ac, armour, hd, hp, die, dmg}`: the armour class and hit
 * points whole numbers, `armour` the printed armour words, `hd` the printed
 * rating, `die` the printed damage die, `dmg` the printed modifier a weapon
 * adds (null where none is printed, never 0). Null where the armour class,
 * rating or hit points are not read.
 */
export function gradeCell(v) {
  const ac = whole(v?.ac);
  const hp = whole(v?.hp);
  const hd = text(v?.hd);
  if (ac === null || hp === null || hd === null) return null;
  return { ac, armour: text(v.armour), hd, hp, die: text(v.die), dmg: whole(v.dmg) };
}

/**
 * The rows of one table in the order stored: each a `{key, label, cells}`
 * where `cells` holds every breed column key the row carries, its cell read by
 * `read` and null where unread. A missing-row placeholder and a row with no
 * printed label are skipped.
 */
function rowsOf(table, read) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const rows = [];
  for (const [key, row] of Object.entries(table)) {
    if (!row || typeof row !== "object" || isMissingRow(row)) continue;
    const label = text(row.label);
    if (!label) continue;
    const cells = {};
    for (const [breed, cell] of Object.entries(row)) if (breed !== "label") cells[breed] = read(cell);
    rows.push({ key, label, cells });
  }
  return rows;
}

/**
 * The four tables as `{village, leaders, troops, traits}`, each `{rows, cite}`.
 * `rows` is `{key, label, cells}` in print order; `cells` maps a breed key to
 * the cell (village: the printed text; leaders: `gradeCell`; troops and
 * traits: `bandCell`), null where the page prints none. `cite` is the page
 * the rows were read from, null for an empty table and for a Judge's override.
 */
export function importedOrganisation() {
  const doc = hasDoc(ORGANISATION_DOC) ? getDoc(ORGANISATION_DOC) : null;
  const read = (id, cell) => {
    const rows = rowsOf(doc?.tables?.[ORGANISATION_TABLES[id]], cell);
    return { rows, cite: rows.length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES[id]) : null };
  };
  return {
    village: read("village", villageCell),
    leaders: read("leaders", gradeCell),
    troops: read("troops", bandCell),
    traits: read("traits", bandCell),
  };
}
