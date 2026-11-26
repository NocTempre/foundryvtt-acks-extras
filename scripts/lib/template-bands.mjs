/**
 * The registry half of a banded template axis, Foundry-free so Node tests import
 * it. `registryBands()` builds the `bandOf(axis, option, choices)` resolver that
 * template-logic.mjs `chooseAxes`, `optionAvailable` and `axisOffersChoice` take.
 *
 * The band contract, for the importer that writes the tables: in
 * `getDoc(axis.bandsFrom.doc).tables[axis.bandsFrom.table]`, the row keyed by
 * the option's `key` holds, under the key of the option chosen on the axis
 * `bandsFrom.by` names, a band `{min, max}` of whole numbers (a band printed as
 * one value has `min === max`). A column the page prints no band for holds
 * nothing (absent, null or blank) and the option is unavailable for that
 * variant. A row the import marked missing reads as no band. The layered
 * registry decides which table answers, so a Judge's override wins.
 */
import { getDoc, hasDoc, isMissingRow } from "./tables.mjs";

/** A stored band as `{min, max}`, or null when it is not two whole numbers in order. */
function readBand(cell) {
  if (!cell || typeof cell !== "object" || isMissingRow(cell)) return null;
  const { min, max } = cell;
  return Number.isInteger(min) && Number.isInteger(max) && min <= max ? { min, max } : null;
}

/** The factory a feature registered for `registryCarry`, or null. */
let carryFactory = null;

/**
 * Let a feature say which options of an axis the variant's tables give the
 * choices made so far, for an axis that takes no bands (the optional equipment
 * of a beastman family: who may carry a piece is the equipment table's). The
 * factory is called once per `registryCarry()` and returns `carryOf(axis,
 * option, choices)`, which answers `false` for an option the tables say the
 * choices cannot carry and `true` or null otherwise (null: the tables say
 * nothing). One factory is held; a later registration replaces it, and a
 * non-function clears it.
 */
export function registerTemplateCarry(factory) {
  carryFactory = typeof factory === "function" ? factory : null;
}

/**
 * The carry resolver as the registered feature reads its tables now, for
 * `optionStands`, `pinOptionRows` and `chooseAxes`. Build one per generation or
 * per render. It answers null for every absence (no feature registered, a
 * factory or a read that throws) and never throws.
 * @returns {(axis: object, option: object, choices: object) => (boolean|null)}
 */
export function registryCarry() {
  let carryOf = null;
  try {
    carryOf = carryFactory?.() ?? null;
  } catch {
    carryOf = null;
  }
  return (axis, option, choices = {}) => {
    if (typeof carryOf !== "function") return null;
    try {
      const answer = carryOf(axis, option, choices);
      return typeof answer === "boolean" ? answer : null;
    } catch {
      return null;
    }
  };
}

/**
 * Build the band resolver from the registry as it stands now. A document is read
 * once per resolver, so build one per generation or per sheet render, not once
 * for good. The resolver returns null for every absence (a blank `bandsFrom`, no
 * choice yet on the `by` axis, no document, no table, no row, no band) and
 * never throws.
 * @returns {(axis: object, option: object, choices: object) => ({min: number, max: number}|null)}
 */
export function registryBands() {
  const tables = new Map();
  const tablesOf = (docId) => {
    if (!tables.has(docId)) {
      let found = null;
      try {
        found = hasDoc(docId) ? getDoc(docId)?.tables ?? null : null;
      } catch {
        found = null;
      }
      tables.set(docId, found);
    }
    return tables.get(docId);
  };
  return (axis, option, choices = {}) => {
    const from = axis?.bandsFrom;
    if (!from?.doc || !from.table || !from.by || !option?.key) return null;
    const column = choices?.[from.by];
    if (typeof column !== "string" || !column) return null;
    const table = tablesOf(from.doc)?.[from.table];
    if (!table || typeof table !== "object" || !Object.hasOwn(table, option.key)) return null;
    const row = table[option.key];
    if (!row || typeof row !== "object" || isMissingRow(row) || !Object.hasOwn(row, column)) return null;
    return readBand(row[column]);
  };
}
