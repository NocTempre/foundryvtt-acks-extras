/* global foundry, fromUuid, fromUuidSync */
/**
 * What the organisation chart asks of the generating feature, registered with lib's
 * service registry as `org-chart` so lib never learns what a troop, a trait or a kit is:
 * the badges a leader's head carries, the troop options of a stack (with the ones off
 * the variant's bands marked), and the prototype a troop change names. A prototype is
 * found or made through the same key and the same mint as the Roll's (`mintPrototype`),
 * so an Edit never makes a second path to a creature.
 */
import { MODULE_ID } from "./constants.mjs";
import { ORG_PROTOTYPE_FLAG } from "../lib/org.mjs";
import { registryBands } from "../lib/template-bands.mjs";
import { NO_TROOP } from "./organisation.mjs";
import { badgesOf, leaderSpecOf, respec, troopOptions } from "./org-chart-logic.mjs";
import { makeLeaderActor, mintPrototype } from "./organisation-run.mjs";

/** The minted prototype a stack names, with its recorded key and generating template, or null. */
async function prototypeOf(stack) {
  const actor = stack?.template?.uuid ? await fromUuid(stack.template.uuid).catch(() => null) : null;
  const key = actor?.flags?.[MODULE_ID]?.[ORG_PROTOTYPE_FLAG];
  const templateUuid = actor?.flags?.[MODULE_ID]?.generated?.templateUuid;
  if (!key || !templateUuid) return null;
  const family = await fromUuid(templateUuid).catch(() => null);
  return family ? { actor, key, family } : null;
}

/** The service lib's chart draws through. */
export const orgChartService = {
  /** Badges for a leader's head: `{actor, row}` → the list `badgesOf` answers. */
  badges({ actor, row }) {
    const generated = actor?.flags?.[MODULE_ID]?.generated;
    const family = generated?.templateUuid ? fromUuidSync(generated.templateUuid) : null;
    const axes = family?.system?.toObject?.().axes ?? family?.system?.axes ?? [];
    return badgesOf({ choices: generated?.choices ?? {}, axes, rowGen: row?.gen ?? {} });
  },
  /** A stack's troop choice and the options it may take, or null where the stack is no generated body. */
  async troopOf(stack) {
    const held = await prototypeOf(stack);
    const spec = held ? respec(held.key, "") : null;
    if (!held || !spec) return null;
    const variant = spec.spec.variant;
    const options = troopOptions({ system: held.family.system, variant, bandOf: registryBands() });
    const current = JSON.parse(held.key).troop || NO_TROOP;
    return options.length ? { current, options } : null;
  },
  /** The uuid of the prototype for a stack with another troop, made or found as the Roll does; null where it cannot be. */
  async prototypeFor(stack, troop) {
    const held = await prototypeOf(stack);
    const next = held ? respec(held.key, troop) : null;
    if (!next) return null;
    const hit = await mintPrototype(held.family, next.spec, next.key);
    return hit?.actor?.uuid ?? null;
  },
  /**
   * Whether a Make can name this row's leader: its record holds a leader role and the chart a template.
   * A blank `key` asks for the host's own leader, which `hostGen` (the host's record) names. Sync, for a render.
   */
  canMakeLeader(rows, key, hostGen = null) {
    return !!leaderSpecOf(rows, key, hostGen);
  },
  /**
   * Make a new leader actor for a row, by the maker the Roll's provider uses and from what the row
   * recorded. Always a new actor, never a prototype found by key, so no two rows share a leader.
   * Null where nothing can be made; the caller sets the uuid as the row group's officer.
   */
  async makeLeader(rows, key, hostGen = null) {
    const spec = leaderSpecOf(rows, key, hostGen);
    const family = spec ? await fromUuid(spec.template).catch(() => null) : null;
    if (!family) return null;
    const actor = await makeLeaderActor(family, { variant: spec.variant, grade: spec.grade }, { role: spec.role, troop: spec.troop, trait: spec.trait });
    return actor?.uuid ?? null;
  },
};
