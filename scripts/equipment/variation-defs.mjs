import { usableSpecs } from "../lib/field-spec.mjs";

/**
 * What a BASE TYPE records, from the GM's own books by way of `acks-importer`
 * and acks-lib's ruledata registry.
 *
 * Variations themselves are documents and carry their own numbers
 * (`data/variation-data.mjs`) — they arrive as a compendium, not as a table.
 * What is left here is the other half the importer supplies: the field specs a
 * category records, which belong to no single document because they describe
 * every gem rather than one.
 *
 * **Nothing here ships a value.** The module knows that a base type records
 * fields; it does not know that a gem has a carat. That is a page value, and
 * `lib/tables.mjs` has said "no book values, no fallback samples" since the
 * extraction program.
 *
 * The honest consequence: **a world that has imported nothing records nothing
 * extra.** The same bargain the thief ladders made, said out loud rather than
 * shown as an empty list pretending to be finished.
 */

/** The ruledata document these live in. */
export const RULEDATA_DOC = "variations";

/** The table inside it. */
export const TABLES = Object.freeze({ baseTypeFields: "baseTypeFields" });

/** The registry, or null when acks-lib is not up yet. */
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
 *
 * A spec naming a field kind a later importer knows is reported rather than
 * dropped: the reader's data is still there, and saying "this version cannot
 * show `resonance`" is the only honest thing to put in its place.
 */
export function baseTypeFields(baseType) {
  return usableSpecs(table(TABLES.baseTypeFields)[baseType] ?? []);
}
