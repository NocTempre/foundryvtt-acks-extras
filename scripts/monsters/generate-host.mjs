/* global Actor, foundry */
/**
 * The host a Generate on a family template makes (docs/monsters/MODEL.md, "The
 * organisation roll"): a root group holding one empty top row that carries the
 * template's uuid in its `gen`, so the chart's Roll and Roll at random know which
 * family they roll. Nothing is rolled here and no window opens; the Judge rolls
 * from the group's Organisation section. Whether the roll then earns a faction card
 * is decided at the Roll (`needsFactionCard`). Registered with lib's service
 * registry as `template-generate`, so lib never learns what a recipe is: a template
 * whose variants carry no encounter line is answered "not mine" and lib generates a
 * creature as before.
 */
import { MODULE_ID } from "./constants.mjs";
import { blankRow } from "../lib/org-tree-logic.mjs";
import { GROUP_ACTOR_TYPE } from "../lib/group-logic.mjs";

/** Does this template's variant axis carry an encounter line on any option? */
export function carriesRecipe(template) {
  const axes = template?.system?.toObject?.().axes ?? template?.system?.axes ?? [];
  const variants = axes.find((a) => a.key === "variant")?.options ?? [];
  return variants.some((o) => o.flags?.[MODULE_ID]?.extras?.encounter);
}

/**
 * Does a Roll earn a faction card of its own? Only a roll that makes a village, a unit
 * holding units that hold units, at the top of a chart whose host is a group no faction
 * lists yet. A gang or a warband (a wandering or lair roll) is a group's alone, and a
 * chart already on a faction, or under one, is never given a second card.
 *
 * @param {object} facts
 * @param {boolean} facts.holdsUnitsOfUnits the rolled top unit holds units that hold units
 * @param {boolean} facts.rowIsTop the row rolled is the top of its chart
 * @param {boolean} facts.hostIsFaction the chart's host is a faction card
 * @param {boolean} facts.joined the host group is already listed under a faction
 * @returns {boolean}
 */
export function needsFactionCard({ holdsUnitsOfUnits: village, rowIsTop, hostIsFaction, joined }) {
  return !!village && !!rowIsTop && !hostIsFaction && !joined;
}

/**
 * Is a group listed under a chart that is not its own? `orgHostOf`'s answer for the group,
 * read against the group: a group whose own top row names it is its own chart's host and is
 * listed nowhere else.
 * @param {{host: {uuid: string}}|null} found `orgHostOf(group.uuid)`
 * @param {string} groupUuid
 */
export const listedElsewhere = (found, groupUuid) => !!found && found.host?.uuid !== groupUuid;

/**
 * Does the rolled tree's top unit hold units that hold units: the shape of a village,
 * read from the evaluated line and not from any unit word. A camp and a part row (`whole`) are no unit.
 * @param {{top?: {children?: object[]}}} tree `planOrganisationRoll`'s answer
 */
export function holdsUnitsOfUnits(tree) {
  const units = (node) => (node?.children ?? []).filter((c) => !c.camp && !c.whole);
  return units(tree?.top).some((c) => units(c).length > 0);
}

/**
 * Is this row the empty top row Generate wrote on a root group it made? Read from what
 * Generate wrote and from nothing else: the group hosts that one row and no other, the row
 * is the top of its chart and holds nothing, it names the template and carries no pick or
 * record (`gen` is the template's uuid alone), and the group holds no stack and no officer.
 * A group Add or Roll has touched, a faction, a row below the top and a group already
 * holding stacks all answer false, so only the first Roll of a fresh Generate fills the
 * group itself.
 *
 * @param {object} facts
 * @param {object[]} facts.rows every row the group hosts
 * @param {object|null} facts.row the row being rolled
 * @param {number} [facts.stacks] how many stacks the group holds
 * @param {string} [facts.officerUuid] the group's officer, blank for none
 * @returns {boolean}
 */
export function isGenerateRoot({ rows = [], row = null, stacks = 0, officerUuid = "" } = {}) {
  if (!row || rows.length !== 1 || rows[0]?.key !== row.key) return false;
  if (row.holderUuid || row.parentKey) return false;
  const keys = Object.keys(row.gen ?? {});
  if (keys.length !== 1 || keys[0] !== "template" || !row.gen.template) return false;
  return !stacks && !officerUuid;
}

/**
 * Make the host for a family template: a root group, never a faction card.
 * @param {Actor} template the family template
 * @returns {Promise<{handled: boolean, actor?: Actor}>}
 */
export async function generateHost(template) {
  if (!carriesRecipe(template)) return { handled: false };
  const top = blankRow(foundry.utils.randomID());
  top.gen = { template: template.uuid };
  const actor = await Actor.implementation.create({
    name: template.name,
    type: GROUP_ACTOR_TYPE,
    img: template.flags?.[MODULE_ID]?.plate || template.img,
    system: { units: [top] },
  });
  return actor ? { handled: true, actor } : { handled: false };
}
