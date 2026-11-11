/* global game */
/**
 * Where a weapon figure on a sheet came from, as the tooltip that figure wears.
 *
 * A figure is in one of three states: the item declares it (a flag a Judge or
 * the Annotate pass set, which outranks the table), the weapon table's row for
 * the weapon states it (and the row's page, where the import recorded one), or
 * nothing states it, which is "not imported" with no number in its place.
 * `figureState` decides which and `figureTip` words it; both answer from the
 * row the weapon seam holds (`lib/weapons.mjs`), so a figure's provenance is
 * the one the proficiency and hand-cost readers used.
 */
import { weaponRow } from "../lib/weapons.mjs";
import { weaponName } from "./training-view.mjs";

/** The three states of a weapon figure. */
export const FIGURE_STATE = Object.freeze({ DECLARED: "declared", ROW: "row", MISSING: "missing" });

/**
 * The state of one figure of the weapon `key` names.
 *
 * @param {object} figure
 * @param {string|null} figure.key the weapon-table key, or null for a weapon no row places
 * @param {string|null} figure.field the row field the figure is read from, or null where the figure is the row itself (which weapon this is)
 * @param {*} [figure.declared] what the item itself declares for it; null or "" is no declaration
 * @returns {{state: string, weapon?: string, cite?: string}} `weapon` and `cite` only for a row
 */
export function figureState({ key, field, declared = null }) {
  if (declared != null && declared !== "") return { state: FIGURE_STATE.DECLARED };
  const row = key ? weaponRow(key) : null;
  const value = field ? row?.[field] : row;
  if (value == null || value === "") return { state: FIGURE_STATE.MISSING };
  return { state: FIGURE_STATE.ROW, weapon: row.name || weaponName(key), cite: String(row.cite ?? "") };
}

/**
 * The tooltip text of a figure in `state`, for `data-tooltip-text`. `label` is
 * the figure's name as the sheet prints it.
 */
export function figureTip(state, label) {
  const f = { figure: label, ...state };
  if (state.state === FIGURE_STATE.DECLARED) return game.i18n.format("ACKS-EQUIPMENT.props.figureDeclared", f);
  if (state.state === FIGURE_STATE.ROW) {
    return game.i18n.format(state.cite ? "ACKS-EQUIPMENT.props.figureFromRow" : "ACKS-EQUIPMENT.props.figureFromRowNoPage", f);
  }
  return game.i18n.format("ACKS-EQUIPMENT.props.figureMissing", f);
}
