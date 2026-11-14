/**
 * The body forms a monster is classed under, as the Judge's own Monstrous Manual
 * prints them (MM Monster Creation p. 389), read from the `monsters` registry
 * document's `bodyForms` table; nothing in source states one. With nothing
 * imported the select has no options and renders disabled, so a submit leaves a
 * stored key untouched (`monster-sheet.mjs` `_prepareSubmitData`). Foundry-free.
 */
import { citeOf, expectTables, getDoc, getLayer, hasDoc, isMissingRow, PRIORITY } from "../lib/tables.mjs";

/** The registry document the body-form rows are read from. */
export const BODY_FORM_DOC = "monsters";

/** The table of `BODY_FORM_DOC` holding the rows. */
export const BODY_FORM_TABLE = "bodyForms";

// A literal, because the producers gate reads this call from source.
expectTables(BODY_FORM_DOC, ["bodyForms"]);

/**
 * The imported rows in the table's order, `{key, label, example}`; empty where
 * nothing is imported. A missing-row placeholder and a row with no name are skipped.
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
 * Where the list comes from now: `override`, `imported` with its page, or
 * `missing`. The override layer is asked first, since `citeOf` answers null for
 * both an override and an absent table.
 * @returns {{state: "override"|"imported"|"missing", cite: string|null}}
 */
export function bodyFormOrigin() {
  if (!bodyFormRows().length) return { state: "missing", cite: null };
  if (getLayer(BODY_FORM_DOC, PRIORITY.OVERRIDE)?.tables?.[BODY_FORM_TABLE] != null) return { state: "override", cite: null };
  return { state: "imported", cite: citeOf(BODY_FORM_DOC, BODY_FORM_TABLE) };
}

/**
 * What the Body Form control and band show for a stored key: `imported` (the
 * select is disabled when false), `options` (key to option text; a stored key the
 * table lacks keeps its own option, so a submit cannot erase it), `label` (the
 * printed name or ""), `tip` (name with its page, or the page reference alone).
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
