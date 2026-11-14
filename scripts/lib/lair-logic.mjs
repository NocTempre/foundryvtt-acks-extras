/**
 * The Foundry-FREE half of a lair: the flag a lair place carries and what its
 * monster's in-lair line allows. lair.mjs finds the monster and writes the
 * documents around these decisions, the same split as group-encounter-logic.mjs
 * and group-encounter.mjs.
 */
import { MODULE_ID } from "./constants.mjs";
import { ROLL_KIND, isCreatureStack, planStack } from "./group-encounter-logic.mjs";

/** The key under `flags["acks-extras"]` that marks a place as a monster's lair. The importer writes `of` at creation; lair.mjs writes the rest. */
export const LAIR_KEY = "lair";

/** Every reason a lair gives for making no group; each has words under `ACKS-LIB.lair.why`. `noted` holds the last one told to the Judges. */
export const LAIR_REASONS = Object.freeze(["notImported", "template", "units", "none", "invalid", "failed", "rolled"]);

/**
 * The lair flag the importer writes on a place at import: the cookbook id of
 * the monster the place is the lair of. The group and the note are written by a
 * roll, never at import.
 * @param {string} of the monster's cookbook id
 * @returns {{of: string}}
 */
export const lairData = (of) => ({ of: String(of) });

/**
 * A place's lair flag, or null where it is no lair.
 * @param {object} [place]
 * @returns {{of: string, group: string, noted: string}|null}
 */
export function lairOf(place) {
  const flag = place?.getFlag?.(MODULE_ID, LAIR_KEY) ?? place?.flags?.[MODULE_ID]?.[LAIR_KEY] ?? null;
  if (!flag?.of) return null;
  return { of: String(flag.of), group: String(flag.group ?? ""), noted: String(flag.noted ?? "") };
}

/**
 * What a lair's monster allows on one encounter line. A lair rolls only where
 * the monster's imported in-lair side gives a number of bodies; a side counted
 * in units, a side with no count, a template (which has no ecology of its own)
 * and a monster that is not imported make nothing.
 * @param {object|null} monster the library actor, or null where it is not imported
 * @param {"dungeon"|"wilderness"} context
 * @returns {{ok: true, formula: string, noun: string}|{ok: false, reason: string, count?: string, unit?: string}}
 */
export function planLair(monster, context) {
  if (!monster) return { ok: false, reason: "notImported" };
  if (!isCreatureStack({ template: { type: monster.type } })) return { ok: false, reason: "template" };
  const plan = planStack({ size: { current: 0 } }, monster, { context, state: "lair" });
  if (plan.kind === ROLL_KIND.roll) return { ok: true, formula: plan.formula, noun: plan.noun };
  return { ok: false, reason: plan.kind === ROLL_KIND.units ? "units" : "none", count: plan.count, unit: plan.unit };
}
