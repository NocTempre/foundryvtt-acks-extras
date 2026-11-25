/* global foundry */
/**
 * The Foundry-free half of what the organisation chart asks of the generating feature
 * (org-chart-service.mjs): the badges of a leader's head, the spec a troop change names and
 * the troop options with the ones off the variant's bands marked. Pure, so it imports under
 * Node and is unit-tested offline (tools/test-org-chart-service.mjs).
 */
import { makeLoc } from "../lib/util.mjs";
import { optionAvailable } from "../lib/template-logic.mjs";
import { nodesOf, rowAncestors } from "../lib/org-tree-logic.mjs";
import { GRADE_SOURCE, NO_TRAIT, NO_TROOP, GEAR_AXIS, TRAIT_AXIS, TROOP_AXIS } from "./organisation.mjs";
import { protoKey } from "./organisation-logic.mjs";

const loc = makeLoc("ACKS-MONSTERS");

/** Foundry core's own glyphs, by path: a badge draws one for each axis it shows. */
export const BADGE_ICONS = Object.freeze({ [TROOP_AXIS]: "icons/svg/shield.svg", [TRAIT_AXIS]: "icons/svg/aura.svg", [GEAR_AXIS]: "icons/svg/chest.svg" });

/** The corner each badge sits on: troop top right, trait bottom right, kit bottom left. */
export const BADGE_CORNERS = Object.freeze({ [TROOP_AXIS]: "tr", [TRAIT_AXIS]: "br", [GEAR_AXIS]: "bl" });

/**
 * The badges of a generated actor's head, from the choices its generation recorded.
 * A badge is `byHand` when its row recorded what the roll fixed (`gen.tier` is set) and the
 * actor's choice is not that.
 *
 * @param {object} args
 * @param {object} args.choices the actor's generated axis choices
 * @param {object} args.axes the template's axes (each `{key, label, options: [{key, label}]}`)
 * @param {object} [args.rowGen] the chart row's `gen`
 * @param {(key: string, data?: object) => string} [args.text] a lang reader under ACKS-MONSTERS
 * @returns {{axis: string, corner: string, icon: string, label: string, tip: string, byHand: boolean}[]}
 */
export function badgesOf({ choices = {}, axes = [], rowGen = {}, text = loc } = {}) {
  const recorded = rowGen?.tier !== undefined;
  const labelOf = (axisKey, key) => (axes.find((a) => a.key === axisKey)?.options ?? []).find((o) => o.key === key)?.label ?? key;
  const out = [];
  const add = (axis, key, extra = "", byHand = false) => {
    const axisLabel = axes.find((a) => a.key === axis)?.label ?? axis;
    const label = `${labelOf(axis, key)}${extra}`;
    out.push({ axis, corner: BADGE_CORNERS[axis], icon: BADGE_ICONS[axis], label, byHand, tip: text(byHand ? "organisation.badge.byHand" : "organisation.badge.rolled", { axis: axisLabel, label }) });
  };
  const troop = choices[TROOP_AXIS];
  if (troop && troop !== NO_TROOP) add(TROOP_AXIS, troop, "", recorded && (rowGen.troop || NO_TROOP) !== troop);
  const trait = choices[TRAIT_AXIS];
  if (trait && trait !== NO_TRAIT) add(TRAIT_AXIS, trait, "", recorded && rowGen.trait !== undefined && rowGen.trait !== trait);
  const gear = [].concat(choices[GEAR_AXIS] ?? []).filter(Boolean);
  if (gear.length) add(GEAR_AXIS, gear[0], gear.length > 1 ? ` +${gear.length - 1}` : "");
  return out;
}

/**
 * A prototype's spec with another troop, and the key it is found or made under: the
 * Roll's own key builder, so a prototype a Roll made is found again. Null where the key
 * is not a spec this generator wrote.
 * @param {string} key the prototype key a minted actor carries
 * @param {string} troop the troop option's key
 * @returns {{spec: object, key: string}|null}
 */
export function respec(key, troop) {
  let spec = null;
  try {
    spec = JSON.parse(key);
  } catch {
    return null;
  }
  if (!spec || spec.kind !== "cell") return null;
  const next = { ...spec, troop: troop || NO_TROOP };
  return { spec: next, key: protoKey(next) };
}

/**
 * What a row's Make needs to make the leader its Roll would have made: the family template and
 * variant the chart began with, and the role, troop, trait and morale part the row recorded for
 * its leader. Null where the row records no leader role or no template, and nothing is then made.
 * Gear, a mount and whether it speaks Common are the Roll's own throws and are not recorded.
 * @param {object[]} rows the host's rows
 * @param {string} key the row
 * @returns {{template: string, variant: string, role: string, troop: string, trait: string, grade: string, moraleBonus: number|null}|null}
 */
export function leaderSpecOf(rows, key) {
  const list = (rows ?? []).map((r) => r?.toObject?.() ?? r);
  const own = list.find((r) => r.key === key);
  const leader = own?.gen?.leader;
  if (!leader?.role) return null;
  const began = [key, ...rowAncestors(key, nodesOf(list))].map((k) => list.find((r) => r.key === k)).find((r) => r?.gen?.template);
  if (!began?.gen?.variant) return null;
  return {
    template: String(began.gen.template),
    variant: String(began.gen.variant),
    role: String(leader.role),
    troop: String(leader.troop ?? ""),
    trait: String(own.gen.trait ?? ""),
    grade: began.gen.leaderSource === GRADE_SOURCE ? GRADE_SOURCE : "",
    moraleBonus: Number.isInteger(leader.moraleBonus) ? leader.moraleBonus : null,
  };
}

/** The troop axis options of a template, each marked `offBands` where the variant has no band for it. */
export function troopOptions({ system, variant, bandOf }) {
  const axis = (system?.axes ?? []).find((a) => a.key === TROOP_AXIS);
  if (!axis) return [];
  return (axis.options ?? []).map((o) => ({ key: o.key, label: o.label ?? o.key, offBands: !optionAvailable(system, axis, o, { variant }, bandOf) }));
}
