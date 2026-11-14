/**
 * The body forms a monster is classed under, as the Judge's own Monstrous
 * Manual prints them (Monster Body Form, MM Monster Creation p. 389): a form's
 * name and the sample monsters beside it. They are imported into the `monsters`
 * registry document's `bodyForms` table, one row per form keyed by the folded
 * name, and read here; nothing in source states one. A Judge's override layer
 * replaces the table whole and is read like any other. Foundry-free.
 *
 * With nothing imported the Body Form select has no options, and a monster's
 * stored key is untouched: the sheet renders that select disabled, and a
 * disabled field is left out of the form data, so a submit never carries a
 * value for it (see `monster-sheet.mjs` `_prepareSubmitData`).
 */
import { citeOf, expectTables, getDoc, getLayer, hasDoc, isMissingRow, PRIORITY } from "../lib/tables.mjs";

/** The registry document the body-form rows are read from. */
export const BODY_FORM_DOC = "monsters";

/** The table of `BODY_FORM_DOC` holding the rows. */
export const BODY_FORM_TABLE = "bodyForms";

// Declared where it is read, so the import names the table as outstanding
// whichever feature loads first. The id is BODY_FORM_TABLE, written as a
// literal because the producers gate reads this call from source.
expectTables(BODY_FORM_DOC, ["bodyForms"]);

/**
 * The imported rows in the table's order, `{key, label, example}`: the form's
 * stored key, its printed name, and its sample monsters (empty where the page
 * lists none). A missing-row placeholder and a row with no name are skipped.
 * Empty where nothing is imported.
 * @returns {{key: string, label: string, example: string}[]}
 */
export function bodyFormRows() {
  if (!hasDoc(BODY_FORM_DOC)) return [];
  const table = getDoc(BODY_FORM_DOC)?.tables?.[BODY_FORM_TABLE];
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  return Object.entries(table)
    .filter(([, row]) => row && typeof row === "object" && !isMissingRow(row) && typeof row.label === "string" && row.label.trim())
    .map(([key, row]) => ({ key, label: row.label.trim(), example: typeof row.example === "string" ? row.example.trim() : "" }));
}

/**
 * Where the list comes from right now: `override` when a Judge's layer holds
 * the table, `imported` with the page it was read from, `missing` when no row
 * is available. `citeOf` answers null for an override and for an absent
 * table alike, so the layer is asked first.
 * @returns {{state: "override"|"imported"|"missing", cite: string|null}}
 */
export function bodyFormOrigin() {
  if (!bodyFormRows().length) return { state: "missing", cite: null };
  if (getLayer(BODY_FORM_DOC, PRIORITY.OVERRIDE)?.tables?.[BODY_FORM_TABLE] != null) return { state: "override", cite: null };
  return { state: "imported", cite: citeOf(BODY_FORM_DOC, BODY_FORM_TABLE) };
}

/**
 * What the Body Form control and the band show for a monster's stored key.
 * `loc` is the sheet's `ACKS-MONSTERS` formatter.
 *
 *  - `imported`: whether any row is available; the select is disabled when not.
 *  - `options`: key to option text (`name — sample monsters`), in table order.
 *    A stored key the table does not hold gets its own option, showing the raw
 *    key, so a submit from another field cannot erase it.
 *  - `label`: the stored form's printed name, or "" where nothing is imported
 *    or the table holds no such row.
 *  - `tip`: the field's provenance: its name with the page it was read from,
 *    with the Judge's own table, or the page reference alone where nothing is
 *    imported.
 * @param {string} stored the monster's stored `bodyForm` key
 * @param {(key: string, data?: object) => string} loc
 * @returns {{imported: boolean, options: Object<string, string>, label: string, tip: string}}
 */
export function bodyFormView(stored, loc) {
  const key = String(stored ?? "");
  const rows = bodyFormRows();
  const { state, cite } = bodyFormOrigin();
  const field = loc("field.bodyForm");
  const options = {};
  for (const row of rows) options[row.key] = row.example ? loc("bodyForm.option", { name: row.label, example: row.example }) : row.label;
  if (rows.length && key && !Object.hasOwn(options, key)) options[key] = key;
  const tip = state === "missing" ? loc("bodyForm.page")
    : state === "override" ? loc("bodyForm.judge", { label: field })
    : cite ? loc("bodyForm.read", { label: field, cite })
    : field;
  return { imported: rows.length > 0, options, label: rows.find((row) => row.key === key)?.label ?? "", tip };
}
