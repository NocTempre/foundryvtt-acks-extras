/**
 * A beastman template's ORGANISATION axes: the special troop, the tribal trait
 * and the optional equipment, minted from the Judge's imported tables
 * (`monsters/organisation.mjs` `importedOrganisation`), plus the `table`
 * option of Leader figures and the natural-attack cells of a trait. Pure: the
 * tables and the labels are passed in, so no troop, trait, item or breed is
 * named here, and no figure is written to the template (every figure is read at
 * generation, `applyGeneratedOrganisation`).
 *
 * The canonical axis order is Variant, Leader figures, Role, troop, Kit,
 * trait, gear (`orderAxes`); every path that builds or merges a template
 * restores it.
 *
 * Model: docs/monsters/MODEL.md, "The organisation axes".
 */
import { MODULE_ID } from "./constants.mjs";
import { SOURCE, SOURCE_AXIS, roleAxis, roleKeyOf } from "./leader-roles.mjs";
import { KIT_AXIS } from "../monsters/kits.mjs";
import { GEAR_AXIS, GRADE_SOURCE, NO_TRAIT, NO_TROOP, ORGANISATION_AXES, ORGANISATION_DOC, ORGANISATION_TABLES, TRAIT_AXIS, TROOP_AXIS } from "../monsters/organisation.mjs";

/** The axes of a family template in the order they are chosen. */
export const AXIS_ORDER = Object.freeze(["variant", SOURCE_AXIS, "role", TROOP_AXIS, KIT_AXIS, TRAIT_AXIS, GEAR_AXIS]);

/** The leader ranks the leader table prints. */
const GRADE_ROLES = new Set(["champion", "subChieftain", "chieftain"]);

/**
 * Put the axes in `AXIS_ORDER`, in place: the known axes take each other's
 * slots in canonical order and an axis the list does not know keeps its slot.
 * Returns `axes`.
 */
export function orderAxes(axes) {
  const rank = (a) => AXIS_ORDER.indexOf(a.key);
  const slots = axes.map((a, i) => (rank(a) >= 0 ? i : -1)).filter((i) => i >= 0);
  const known = slots.map((i) => axes[i]).sort((a, b) => rank(a) - rank(b));
  slots.forEach((slot, n) => {
    axes[slot] = known[n];
  });
  return axes;
}

/** A bare option: its key, its imported label, no name piece. */
const option = (key, label, flags) => ({ key, label, nameLabel: "", ...(flags ? { flags } : {}) });

/** The marker an option carries so it has a patch of its own (a trait with cells of its own stands only where a cell matches otherwise). */
const marker = (axisKey, key) => ({ [MODULE_ID]: { extras: { organisation: { [axisKey]: key } } } });

/** Replace the axis of that key, or append it. */
function setAxis(axes, axis) {
  const at = axes.findIndex((a) => a.key === axis.key);
  if (at >= 0) axes[at] = axis;
  else axes.push(axis);
}

/** Does any variant key of the template have a cell in any row of a grid? */
const hasColumn = (grid, keys) => grid.rows.some((r) => keys.some((k) => r.cells[k]));

/**
 * Build the organisation axes and cells onto a template's `axes` and `cells`.
 * `options` are the Variant axis's options, whose keys are the tables' breed
 * columns; an axis is minted only where some variant is a column the table
 * holds a cell for, so a template of no beastman gains none. `org` is
 * `importedOrganisation()`; `labels` the axis and option labels (`troopAxis`,
 * `noTroop`, `traitAxis`, `noTrait`, `gearAxis`, `sourceAxis`, `sourcePrinted`,
 * `sourceTable`), each falling back to its key; `out` is the template's name
 * format holder, set where a Role axis is added for the table's leaders.
 * Returns the keys of the axes it minted.
 */
export function organisationAxes({ options, axes, cells, org, labels = {}, out = {} }) {
  const keys = options.map((o) => o.key);
  const minted = [];
  const label = (k, fallback) => labels[k] ?? fallback;
  const banded = (table, label_, def, noneLabel) => ({
    label: label_,
    roll: "",
    default: def,
    derive: { from: "", max: null },
    bandsFrom: { doc: ORGANISATION_DOC, table, by: "variant" },
    options: [option(def, noneLabel)],
  });

  const troops = org?.troops?.rows ?? [];
  if (troops.length && hasColumn(org.troops, keys)) {
    const axis = { key: TROOP_AXIS, ...banded(ORGANISATION_TABLES.troops, label("troopAxis", TROOP_AXIS), NO_TROOP, label("noTroop", NO_TROOP)) };
    for (const row of troops) axis.options.push(option(row.key, row.label, marker("troop", row.key)));
    setAxis(axes, axis);
    minted.push(TROOP_AXIS);
  }
  const traits = org?.traits?.rows ?? [];
  if (traits.length && hasColumn(org.traits, keys)) {
    const axis = { key: TRAIT_AXIS, ...banded(ORGANISATION_TABLES.traits, label("traitAxis", TRAIT_AXIS), NO_TRAIT, label("noTrait", NO_TRAIT)) };
    for (const row of traits) axis.options.push(option(row.key, row.label, marker("trait", row.key)));
    setAxis(axes, axis);
    minted.push(TRAIT_AXIS);
    naturalAttackCells({ keys, cells, org });
  }
  const gear = org?.equipment?.rows ?? [];
  if (gear.length && minted.length) {
    setAxis(axes, {
      key: GEAR_AXIS,
      label: label("gearAxis", GEAR_AXIS),
      roll: "",
      default: "",
      multi: true,
      derive: { from: "", max: null },
      options: gear.map((row) => option(row.key, row.label)),
    });
    minted.push(GEAR_AXIS);
  }
  if (leaderGradeCells({ keys, axes, cells, org, labels, out })) minted.push(SOURCE_AXIS);
  orderAxes(axes);
  return minted;
}

/**
 * The cells of a trait whose table row lists natural attacks per breed (its
 * `damage` figure a map of breed to dice): one `variant|trait` cell for each
 * breed the map holds a non-empty list for. The cell marks variant and trait;
 * the dice are read at generation.
 */
function naturalAttackCells({ keys, cells, org }) {
  for (const row of org.traitRules?.rows ?? []) {
    const dice = row.figures?.damage;
    if (!dice || typeof dice !== "object" || Array.isArray(dice)) continue;
    for (const key of keys) {
      if (!Array.isArray(dice[key]) || !dice[key].length) continue;
      cells.push({
        by: ["variant", TRAIT_AXIS],
        key: `${key}|${row.key}`,
        merge: {},
        items: [],
        flags: { [MODULE_ID]: { extras: { organisation: { naturalAttacks: { variant: key, trait: row.key } } } } },
      });
    }
  }
}

/**
 * The `table` option of Leader figures and its cells: one `variant|role|table`
 * cell for each leader rank and breed the leader table holds a cell for. The
 * cell marks variant and role only; the figures are read at generation. Adds
 * the Leader figures axis (As printed the default) where the template has none
 * and the Role axis where it has none or lacks a rank. True where a cell was
 * made.
 */
function leaderGradeCells({ keys, axes, cells, org, labels, out }) {
  const found = new Set();
  for (const row of org?.leaders?.rows ?? []) {
    const role = roleKeyOf(row.label);
    if (!GRADE_ROLES.has(role)) continue;
    for (const key of keys) {
      if (!row.cells[key]) continue;
      cells.push({ by: ["variant", "role", SOURCE_AXIS], key: `${key}|${role}|${GRADE_SOURCE}`, merge: {}, items: [], flags: { [MODULE_ID]: { extras: { organisation: { grade: { variant: key, role } } } } } });
      found.add(role);
    }
  }
  if (!found.size) return false;
  roleAxis(axes, found, out);
  let axis = axes.find((a) => a.key === SOURCE_AXIS);
  if (!axis) {
    axis = { key: SOURCE_AXIS, label: labels.sourceAxis ?? SOURCE_AXIS, roll: "", default: SOURCE.printed, derive: { from: "", max: null }, options: [option(SOURCE.printed, labels.sourcePrinted ?? SOURCE.printed)] };
    axes.push(axis);
  }
  if (!axis.options.some((o) => o.key === GRADE_SOURCE)) axis.options.push(option(GRADE_SOURCE, labels.sourceTable ?? GRADE_SOURCE));
  return true;
}

/**
 * Carry organisation axes from `from` (a held or incoming template's axes)
 * onto `to`, then restore the canonical order. Only the axes in `keys` move:
 * one `to` lacks is copied whole; one it has is widened by `from`'s options
 * where `widen` is set, which a merge asks for and a repair does not (the
 * rebuilt table is the repair's list). The Leader figures axis always gains the
 * options `from` names. A template may name any of the axes in `keys`.
 */
export function unionOrganisationAxes(to, from, { keys = [SOURCE_AXIS, ...ORGANISATION_AXES], widen = false } = {}) {
  for (const key of keys) {
    const src = (from ?? []).find((a) => a.key === key);
    if (!src) continue;
    const dst = to.find((a) => a.key === key);
    if (!dst) {
      to.push(structuredClone(src));
      continue;
    }
    if (!widen && key !== SOURCE_AXIS) continue;
    const have = new Set(dst.options.map((o) => o.key));
    for (const o of src.options ?? []) if (!have.has(o.key)) dst.options.push(structuredClone(o));
  }
  return orderAxes(to);
}

