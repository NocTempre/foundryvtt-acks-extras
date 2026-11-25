/* global Actor, foundry */
/**
 * The host a Generate on a family template makes (docs/monsters/MODEL.md, "The
 * organisation roll"): a faction card holding one empty top row that carries the
 * template's uuid in its `gen`, so the chart's Roll and Roll at random know which
 * family they roll. Nothing is rolled here and no window opens; the Judge rolls
 * from the card's Org chart tab, which lib's template sheet opens on. Registered
 * with lib's service registry as `template-generate`, so lib never learns what a
 * recipe is: a template whose variants carry no encounter line is answered "not
 * mine" and lib generates a creature as before.
 */
import { MODULE_ID } from "./constants.mjs";
import { blankRow } from "../lib/org-tree-logic.mjs";

/** The tab of the faction sheet the new host opens on. */
export const HOST_TAB = "orgChart";

/** Does this template's variant axis carry an encounter line on any option? */
export function carriesRecipe(template) {
  const axes = template?.system?.toObject?.().axes ?? template?.system?.axes ?? [];
  const variants = axes.find((a) => a.key === "variant")?.options ?? [];
  return variants.some((o) => o.flags?.[MODULE_ID]?.extras?.encounter);
}

/**
 * Make the host for a family template.
 * @param {Actor} template the family template
 * @returns {Promise<{handled: boolean, actor?: Actor, tab?: string}>}
 */
export async function generateHost(template) {
  if (!carriesRecipe(template)) return { handled: false };
  const top = blankRow(foundry.utils.randomID());
  top.gen = { template: template.uuid };
  const actor = await Actor.implementation.create({
    name: template.name,
    type: `${MODULE_ID}.faction`,
    img: template.flags?.[MODULE_ID]?.plate || template.img,
    system: { units: [top] },
  });
  return actor ? { handled: true, actor, tab: HOST_TAB } : { handled: false };
}
