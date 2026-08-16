/* global game */
import { usableSpecs } from "../lib/field-spec.mjs";

/**
 * Where variation definitions and base-type metadata come from: the GM's own
 * books, by way of `acks-importer` and acks-lib's ruledata registry.
 *
 * **Nothing here ships a definition.** The module knows that variations exist,
 * that they belong to families, and that a base type records fields — it does
 * not know that masterwork costs 80gp or that a gem has a carat. Those are page
 * values, and `lib/tables.mjs` has said "no book values, no fallback samples"
 * since the extraction program.
 *
 * The honest consequence: **a world that has imported nothing offers no
 * variations.** That is the same bargain the thief ladders made, and the UI
 * says so rather than presenting an empty list as though it were a finished
 * one.
 */

/** The ruledata document these live in. */
export const RULEDATA_DOC = "variations";

/** The tables inside it. */
export const TABLES = Object.freeze({
  definitions: "variationDefinitions",
  baseTypeFields: "baseTypeFields",
});

/** The registry, or null when acks-lib is not up yet. */
const registry = () => globalThis.acksExtras?.lib?.tables ?? null;

/** Has anything been imported for this at all? */
export function hasDefinitions() {
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
 * Every published variation definition, keyed.
 *
 * The shape is the importer's: `{key, kind, appliesTo, deltas, cost, supersedes,
 * tab, dataFields, label, hint}`. Nothing is defaulted here — a definition that
 * arrives incomplete is the importer's to fix, and quietly filling gaps would
 * hide that.
 */
export const allDefinitions = () => table(TABLES.definitions);

/** One definition by key, or null. Suitable as the `define` every pure call takes. */
export const definitionOf = (key) => allDefinitions()[key] ?? null;

/** Every definition that may go on this base type, for a picker. */
export function definitionsFor(baseType) {
  return Object.values(allDefinitions()).filter((def) => {
    const applies = def?.appliesTo ?? [];
    return !applies.length || applies.includes(baseType);
  });
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

/** The field specs one variation's own storage records. */
export function dataFields(key) {
  return usableSpecs(definitionOf(key)?.dataFields ?? []);
}

/** Does this variation carry storage worth a tab of its own? */
export const wantsTab = (key) => !!definitionOf(key)?.tab;

/**
 * A definition's label, or its key.
 *
 * The words are imported with the definition. Falling back to the key is
 * deliberate: a bare `masterwork.weaponToHit` on the sheet is a visible sign
 * that something imported badly, which a prettified guess would hide.
 */
export function labelOf(key) {
  return definitionOf(key)?.label || key;
}

/** One line for the sheet when nothing has been imported yet. */
export const noDefinitionsNotice = () =>
  game.i18n.localize("ACKS-EQUIPMENT.variations.noneImported");
