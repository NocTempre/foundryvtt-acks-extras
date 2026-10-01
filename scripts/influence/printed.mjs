/**
 * The one reader of the printed figures the morale pages run on. A page's
 * result edges, the figure beside each modifier it lists and the wording of
 * each row are the Judge's own, imported from their book into the `morale`
 * ruledata document; this module reads them through the registry.
 *
 * Every accessor answers `null` for anything absent — a document that is not
 * imported, a key the page did not yield, a value of the wrong kind — and
 * never a default. The roller turns a `null` figure into a field the Judge
 * types and a `null` result column into a roll that names no result. See
 * docs/influence/MODEL.md, "Printed morale pages".
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

/** Ruledata document holding the morale pages' printed tables. */
export const MORALE_DOC = "morale";

/** One table of the morale document as a flat object of keys, or null. */
function tableOf(tableId) {
  if (!tableId || !hasDoc(MORALE_DOC)) return null;
  const table = getDoc(MORALE_DOC)?.tables?.[tableId];
  return table && typeof table === "object" && !Array.isArray(table) ? table : null;
}

/** The figure a page prints beside one of its modifiers, or null. Zero is a figure. */
export function printedFigure(tableId, key) {
  return numOrNull(tableOf(tableId)?.[key]);
}

/** The page's own wording of one modifier row, or null. */
export function printedLabel(tableId, key) {
  const label = tableOf(tableId)?.[`${key}Label`];
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

/**
 * A page's declared modifier rows as the rows the roller runs. A mode declares
 * two kinds the roller does not know, because what each is worth is printed:
 *
 *  - `ladder`, mutually exclusive rungs named by `rungs`. With a figure read
 *    for any rung it becomes a `select` of those rungs in page order under a
 *    blank first option, `byIndex` so the chosen OPTION is stored and two
 *    rungs printing one figure, or a rung printing zero, stay distinct.
 *  - `printed`, one figure named by `figure`. Read, it becomes a `check` worth
 *    that figure.
 *
 * Either, unread, becomes a `signed` field flagged `unread`: the Judge types
 * the figure off their own page. Every other row passes through untouched.
 * @param {{printed?: string, groups: Array<{group: string, mods: object[]}>}} mode
 * @returns {Array<{group: string, mods: object[]}>}
 */
export function modeRows(mode) {
  const tableId = mode?.printed;
  const row = (mod) => {
    if (mod.type === "ladder") {
      const rungs = (mod.rungs ?? [])
        .map((key) => ({ figure: printedFigure(tableId, key), printedLabel: printedLabel(tableId, key) }))
        .filter((rung) => rung.figure !== null);
      if (!rungs.length) return { key: mod.key, label: mod.label, type: "signed", unread: true };
      return {
        key: mod.key,
        label: mod.label,
        type: "select",
        byIndex: true,
        options: [{ value: 0, figure: 0, label: "ACKS-INFLUENCE.opt.dash" }, ...rungs.map((rung, i) => ({ value: i + 1, ...rung }))],
      };
    }
    if (mod.type === "printed") {
      const figure = printedFigure(tableId, mod.figure);
      if (figure === null) return { key: mod.key, label: mod.label, type: "signed", unread: true };
      return { key: mod.key, label: mod.label, type: "check", value: figure, showFigure: true, printedLabel: printedLabel(tableId, mod.figure) };
    }
    return mod;
  };
  return (mode?.groups ?? []).map((group) => ({ group: group.group, mods: group.mods.map(row) }));
}

/**
 * A page's result column as the roller's bands, worst first: `{min, max, key}`
 * with an open end left undefined. The page supplies the edges and `keys`
 * names the rungs in order, so a column holding any other number of rungs is
 * not this page's and reads as absent.
 * @param {string} tableId
 * @param {string[]} keys the mode's result keys, worst first
 * @returns {Array<{min?: number, max?: number, key: string}>|null}
 */
export function printedBands(tableId, keys) {
  const bands = tableOf(tableId)?.bands;
  if (!Array.isArray(bands) || !Array.isArray(keys) || bands.length !== keys.length) return null;
  const out = bands.map((band, i) => {
    const min = numOrNull(band?.min);
    const max = numOrNull(band?.max);
    return { ...(min === null ? {} : { min }), ...(max === null ? {} : { max }), key: keys[i] };
  });
  return out.every((band) => band.min !== undefined || band.max !== undefined) ? out : null;
}
