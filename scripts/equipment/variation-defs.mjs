import { usableSpecs } from "../lib/field-spec.mjs";

/**
 * What a BASE TYPE records: the field specs a category carries, read from the
 * lib's ruledata registry, where the importer puts them. Variations are
 * documents and carry their own figures.
 *
 * Nothing here ships a value; a world that has imported nothing records nothing
 * extra.
 */

/** The ruledata document these live in. */
export const RULEDATA_DOC = "variations";

/** The table inside it. */
export const TABLES = Object.freeze({ baseTypeFields: "baseTypeFields" });

/** The registry, or null when the lib is not up yet. */
const registry = () => globalThis.acksExtras?.lib?.tables ?? null;

/** Has base-type metadata been imported at all? */
export function hasBaseTypeFields() {
  const reg = registry();
  return !!reg?.hasDoc?.(RULEDATA_DOC);
}

/** One table out of the document, or an empty object. */
function table(id) {
  const reg = registry();
  if (!reg?.hasDoc?.(RULEDATA_DOC)) return {};
  try {
    return reg.getTable(RULEDATA_DOC, id) ?? {};
  } catch {
    return {}; // the doc is there but not this table
  }
}

/**
 * The field specs a base type records, and the ones this version cannot render.
 * A spec naming a field kind unknown here is reported, not dropped.
 */
export function baseTypeFields(baseType) {
  return usableSpecs(table(TABLES.baseTypeFields)[baseType] ?? []);
}
