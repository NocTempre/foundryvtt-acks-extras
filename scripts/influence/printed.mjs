/**
 * The one reader of the printed figures the roller's printed pages run on. A
 * page's result edges, the figure beside each modifier it lists and the
 * wording of each row are the Judge's own, imported from their book into a
 * ruledata document (`morale` for the morale pages, `influence` for the
 * hiring offer and the three tone pages); this module reads them through the
 * registry.
 *
 * Every accessor answers `null` for anything absent — a document that is not
 * imported, a key the page did not yield, a value of the wrong kind — and
 * never a default. The roller turns a `null` figure into a field the Judge
 * types and a `null` result column into a roll that names no result, or into
 * a page that refuses to roll. See docs/influence/MODEL.md, "Printed pages".
 */
import { citeOf, getDoc, getLayer, hasDoc, PRIORITY, quantity } from "../lib/tables.mjs";
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
 * A row reads the mode's table unless it names its own in `printed` and
 * `printedDoc`, as a page whose result column is not printed does for the one
 * figure that is.
 *
 * Any of them, unread, becomes a `signed` field flagged `unread`: the Judge
 * types the figure off their own page. Every other row passes through
 * untouched, and a group keeps the keys it declared beside its rows.
 * @param {{printed?: string, printedDoc?: string, groups: Array<{group: string, mods: object[]}>}} mode
 * @returns {Array<{group: string, mods: object[]}>}
 */
export function modeRows(mode) {
  const unread = (mod) => ({ key: mod.key, label: mod.label, type: "signed", unread: true });
  const row = (mod) => {
    const tableId = mod.printed ?? mode?.printed;
    const docId = mod.printedDoc ?? mode?.printedDoc ?? MORALE_DOC;
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
 * A printed quantity of one of a document's tables (a floor with its figure),
 * in the lib's `{value, atLeast, per}` shape, or null.
 */
export function printedQuantity(tableId, key, docId = MORALE_DOC) {
  return quantity(tableOf(tableId, docId)?.[key]);
}

/**
 * Where a table's figures come from right now: `override` when a Judge's
 * layer holds the table, `imported` with the page it was read from, else
 * `missing`. `citeOf` answers null for both an override and an absent table,
 * so the layer is asked first.
 * @returns {{state: "override"|"imported"|"missing", cite: string|null}}
 */
export function figureOrigin(tableId, docId = MORALE_DOC) {
  if (!tableOf(tableId, docId)) return { state: "missing", cite: null };
  if (getLayer(docId, PRIORITY.OVERRIDE)?.tables?.[tableId] != null) return { state: "override", cite: null };
  return { state: "imported", cite: citeOf(docId, tableId) };
}

/**
 * A tone page's declared rows as the rows the roller runs, against what the
 * world holds. A row names the key of its figure (`figure`) or lists rungs
 * of a ladder (`rungs`), each a key of the page's table; every other row
 * passes through untouched.
 *
 *  - `check` with a figure becomes a tick worth it, shown beside the row's name.
 *  - `factor` with a figure counts it once per unit of the row's count.
 *  - `select` with rungs becomes a choice among the rungs that were read under
 *    a blank first option, `byIndex` so the chosen option is stored. A rung
 *    keeps its `rung` name, which an `autoRung` finds it by, and the page's
 *    own wording of it where the import caught one.
 *
 * Unread, a row is disabled and flagged `unread`: it contributes nothing, and
 * a proficiency row stops claiming its item, so the item's own effect still
 * speaks. A row that carries any figure of the table, read or not, names it
 * in `figureFrom`, which the roller's tooltip reads the origin through.
 * @param {Array<{group: string, mods: object[]}>} groups the tone's declared rows
 * @param {string} tableId the page's table
 * @param {string} docId the ruledata document holding it
 * @returns {Array<{group: string, mods: object[]}>}
 */
export function toneRows(groups, tableId, docId) {
  const from = { docId, tableId };
  const row = (mod) => {
    const { figure, rungs, ...rest } = mod;
    if (figure === undefined && rungs === undefined) {
      return mod.autoFigures || mod.autoThreshold ? { ...mod, figureFrom: from } : mod;
    }
    const dash = { value: 0, label: "ACKS-INFLUENCE.opt.dash" };
    // A proficiency box that cannot be worth anything does not claim the
    // item, so the item's own effect still reaches the page.
    const unread = () => {
      const { auto, ...bare } = rest;
      const kept = auto?.startsWith("prof:") ? bare : rest;
      const base = { ...kept, unread: true, disabled: true, figureFrom: from };
      if (mod.type === "select") return { ...base, byIndex: true, options: [dash] };
      return mod.type === "factor" ? { ...base, factor: 0 } : { ...base, value: 0 };
    };
    if (rungs !== undefined) {
      const read = rungs
        .map((r) => ({ ...r, figure: printedFigure(tableId, r.figure, docId), printedLabel: printedLabel(tableId, r.figure, docId) }))
        .filter((r) => r.figure !== null);
      if (!read.length) return unread();
      const options = read.map((r, i) => ({ value: i + 1, rung: r.rung, label: r.label, n: r.n, figure: r.figure, printedLabel: r.printedLabel, showFigure: true }));
      return { ...rest, byIndex: true, figureFrom: from, options: [dash, ...options] };
    }
    const value = printedFigure(tableId, figure, docId);
    if (value === null) return unread();
    return mod.type === "factor"
      ? { ...rest, factor: value, showFigure: true, figureFrom: from }
      : { ...rest, value, showFigure: true, figureFrom: from };
  };
  return groups.map(({ mods, ...group }) => ({ ...group, mods: (mods ?? []).map(row) }));
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
