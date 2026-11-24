/**
 * The beastman organisation tables as the Judge's world holds them: the village
 * makeup, the leader grades, the special-troop roll bands and the tribal-trait
 * roll bands (MM pp. 54-55, 57), the figures the paragraphs under them print
 * (troop kinds, optional equipment, traits: MM pp. 55-57), and the split,
 * speech and sidebar figures (MM pp. 47, 54, 55), read from the `monsters`
 * registry document and nothing else. No row, breed or figure is stated here:
 * every row key is minted from the printed label at import, every column key
 * is a Variant key of the beastman family template, and a cell is what the
 * page prints. Pure and Foundry-free; a Judge's override of a table (the
 * Ruledata Browser) is what a read returns, and a table not imported answers
 * empty with no citation.
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
  troopRules: "beastmanTroopRules",
  traitRules: "beastmanTraitRules",
  equipment: "beastmanEquipment",
  organisation: "beastmanOrganisation",
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
 * A figure the paragraphs' tables hold, as a plain value: a finite number,
 * non-empty text, a boolean, or a list or map of those; anything else (and a
 * null or empty one) is dropped, so a row holds only what was read.
 */
function plain(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return text(v) ?? undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    const list = v.map(plain).filter((x) => x !== undefined);
    return list.length ? list : undefined;
  }
  if (v && typeof v === "object") {
    const map = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]).filter(([, x]) => x !== undefined));
    return Object.keys(map).length ? map : undefined;
  }
  return undefined;
}

/**
 * The rows of a paragraph table in the order stored, each `{key, label,
 * figures}`: `figures` is every figure the row holds beside its label, as
 * `plain` reads it, so a figure the page did not print is absent and a row
 * whose paragraph was not read holds none. A missing-row placeholder and a row
 * with no printed label are skipped.
 */
function figureRows(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  const rows = [];
  for (const [key, row] of Object.entries(table)) {
    if (!row || typeof row !== "object" || isMissingRow(row)) continue;
    const label = text(row.label);
    if (!label) continue;
    const { label: _label, ...rest } = row;
    rows.push({ key, label, figures: plain(rest) ?? {} });
  }
  return rows;
}

/**
 * The organisation figures as one flat map. The import stores them in one block
 * per page it reads; a Judge's override may store them flat or in blocks, and
 * both read alike (a figure name is unique across the blocks).
 */
function flatFigures(table) {
  const out = {};
  if (!table || typeof table !== "object" || Array.isArray(table)) return out;
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) if (plain(v) !== undefined) out[k] = plain(v);
    } else if (plain(value) !== undefined) out[key] = plain(value);
  }
  return out;
}

/**
 * The organisation tables as `{village, leaders, troops, traits, troopRules,
 * traitRules, equipment, organisation}`, each `{rows, cite}` but the last.
 * `rows` of the four grids is `{key, label, cells}` in print order; `cells`
 * maps a breed key to the cell (village: the printed text; leaders:
 * `gradeCell`; troops and traits: `bandCell`), null where the page prints
 * none. `troopRules`, `traitRules` and `equipment` are `{key, label, figures}`
 * rows under the same keys as the grids' (equipment under its own): the
 * figures each paragraph prints, absent where it prints none (field names:
 * docs/monsters/MODEL.md). `organisation` is `{figures, cite}`, the flat map of
 * the split, speech and sidebar figures. `cite` is the page the rows were read
 * from, null for an empty table and for a Judge's override.
 */
export function importedOrganisation() {
  const doc = hasDoc(ORGANISATION_DOC) ? getDoc(ORGANISATION_DOC) : null;
  const read = (id, cell) => {
    const rows = rowsOf(doc?.tables?.[ORGANISATION_TABLES[id]], cell);
    return { rows, cite: rows.length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES[id]) : null };
  };
  const readFigures = (id) => {
    const rows = figureRows(doc?.tables?.[ORGANISATION_TABLES[id]]);
    return { rows, cite: rows.length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES[id]) : null };
  };
  const figures = flatFigures(doc?.tables?.[ORGANISATION_TABLES.organisation]);
  return {
    village: read("village", villageCell),
    leaders: read("leaders", gradeCell),
    troops: read("troops", bandCell),
    traits: read("traits", bandCell),
    troopRules: readFigures("troopRules"),
    traitRules: readFigures("traitRules"),
    equipment: readFigures("equipment"),
    organisation: { figures, cite: Object.keys(figures).length ? citeOf(ORGANISATION_DOC, ORGANISATION_TABLES.organisation) : null },
  };
}
