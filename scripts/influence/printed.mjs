/**
 * The one reader of the printed figures the roller's printed pages run on. A
 * page's result edges, the figure beside each modifier it lists and the
 * wording of each row are the Judge's own, imported from their book into a
 * ruledata document (`morale` for the morale pages, `influence` for the
 * hiring offer); this module reads them through the registry.
 *
 * Every accessor answers `null` for anything absent — a document that is not
 * imported, a key the page did not yield, a value of the wrong kind — and
 * never a default. The roller turns a `null` figure into a field the Judge
 * types and a `null` result column into a roll that names no result, or into
 * a page that refuses to roll. See docs/influence/MODEL.md, "Printed pages".
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

/** Ruledata document holding the morale pages' printed tables. */
export const MORALE_DOC = "morale";

/** One table of a printed document as a flat object of keys, or null. */
function tableOf(tableId, docId = MORALE_DOC) {
  if (!tableId || !hasDoc(docId)) return null;
  const table = getDoc(docId)?.tables?.[tableId];
  return table && typeof table === "object" && !Array.isArray(table) ? table : null;
}

/** The figure a page prints beside one of its modifiers, or null. Zero is a figure. */
export function printedFigure(tableId, key, docId = MORALE_DOC) {
  return numOrNull(tableOf(tableId, docId)?.[key]);
}

/** The page's own wording of one modifier row, or null. */
export function printedLabel(tableId, key, docId = MORALE_DOC) {
  const label = tableOf(tableId, docId)?.[`${key}Label`];
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

/**
 * A page's declared modifier rows as the rows the roller runs. A mode declares
 * three kinds the roller does not know, because what each is worth is printed:
 *
 *  - `ladder`, mutually exclusive rungs named by `rungs`. With a figure read
 *    for any rung it becomes a `select` of those rungs in page order under a
 *    blank first option, `byIndex` so the chosen OPTION is stored and two
 *    rungs printing one figure, or a rung printing zero, stay distinct.
 *  - `printed`, one figure named by `figure`. Read, it becomes a `check` worth
 *    that figure.
 *  - `printedFactor`, a figure named by `figure` that is owed once per count
 *    of something. Read, it becomes a `factor` of that figure, keeping the
 *    row's `auto` count.
 *
 * Any of them, unread, becomes a `signed` field flagged `unread`: the Judge
 * types the figure off their own page. Every other row passes through
 * untouched, and a group keeps the keys it declared beside its rows.
 * @param {{printed?: string, printedDoc?: string, groups: Array<{group: string, mods: object[]}>}} mode
 * @returns {Array<{group: string, mods: object[]}>}
 */
export function modeRows(mode) {
  const tableId = mode?.printed;
  const docId = mode?.printedDoc ?? MORALE_DOC;
  const unread = (mod) => ({ key: mod.key, label: mod.label, type: "signed", unread: true });
  const row = (mod) => {
    if (mod.type === "ladder") {
      const rungs = (mod.rungs ?? [])
        .map((key) => ({ figure: printedFigure(tableId, key, docId), printedLabel: printedLabel(tableId, key, docId) }))
        .filter((rung) => rung.figure !== null);
      if (!rungs.length) return unread(mod);
      return {
        key: mod.key,
        label: mod.label,
        type: "select",
        byIndex: true,
        options: [{ value: 0, figure: 0, label: "ACKS-INFLUENCE.opt.dash" }, ...rungs.map((rung, i) => ({ value: i + 1, ...rung }))],
      };
    }
    if (mod.type === "printed") {
      const figure = printedFigure(tableId, mod.figure, docId);
      if (figure === null) return unread(mod);
      return { key: mod.key, label: mod.label, type: "check", value: figure, showFigure: true, printedLabel: printedLabel(tableId, mod.figure, docId) };
    }
    if (mod.type === "printedFactor") {
      const figure = printedFigure(tableId, mod.figure, docId);
      if (figure === null) return unread(mod);
      return { key: mod.key, label: mod.label, type: "factor", factor: figure, auto: mod.auto, showFigure: true };
    }
    return mod;
  };
  return (mode?.groups ?? []).map(({ mods, ...group }) => ({ ...group, mods: (mods ?? []).map(row) }));
}

/**
 * A page's result column as the roller's bands, worst first: `{min, max, key}`
 * with an open end left undefined. The page supplies the edges and `keys`
 * names the rungs in order, so a column holding any other number of rungs is
 * not this page's and reads as absent.
 * @param {string} tableId
 * @param {string[]} keys the mode's result keys, worst first
 * @param {string} [docId] the ruledata document holding the table
 * @returns {Array<{min?: number, max?: number, key: string}>|null}
 */
export function printedBands(tableId, keys, docId = MORALE_DOC) {
  const bands = tableOf(tableId, docId)?.bands;
  if (!Array.isArray(bands) || !Array.isArray(keys) || bands.length !== keys.length) return null;
  const out = bands.map((band, i) => {
    const min = numOrNull(band?.min);
    const max = numOrNull(band?.max);
    return { ...(min === null ? {} : { min }), ...(max === null ? {} : { max }), key: keys[i] };
  });
  return out.every((band) => band.min !== undefined || band.max !== undefined) ? out : null;
}
