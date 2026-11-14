/* global game */
/**
 * The shown text of an engine refusal and of an availability status. The
 * engine's codes are API and stay; a code whose only content is that a table
 * is not imported has no string, so the text is "" and the caller shows
 * nothing: no toast, no line.
 */
import { LANG } from "../constants.mjs";

/** Refusal codes that only say a table is not imported. */
const BLANK_REFUSALS = new Set(["tablesMissing", "noRates", "noCharacteristics", "printedMissing"]);

/**
 * The localized message for a refusal code, or "" for a code that only says a
 * table is not imported.
 * @param {string} code - the engine's `error`
 * @param {object} [data] - the result, spread into the string's placeholders
 * @param {string} [scope] - `trade.error` or `identify.error`
 */
export function refusalText(code, data = {}, scope = "trade.error") {
  if (BLANK_REFUSALS.has(code)) return "";
  return game.i18n.format(`${LANG}.${scope}.${code}`, { remaining: 0, table: "", crowd: "", hold: "", ability: "", ...data });
}

/** The label of an availability answer, or "" where its tables are not imported. */
export function availabilityText(avail) {
  return avail.status === "tablesMissing" ? "" : game.i18n.format(`${LANG}.availability.${avail.status}`, avail);
}
