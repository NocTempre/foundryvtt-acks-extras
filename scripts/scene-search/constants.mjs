/**
 * Scene search's vocabulary: the two checks, what a layer can be, who may
 * attempt what, and the codes the model answers in. Pure data; no Foundry, no
 * lang strings, and no figure read off a page (every throw target, bonus and
 * reach is an argument to the functions in `scene-logic.mjs`).
 */
import { THING_KINDS } from "../lib/place-things-logic.mjs";

/** The prefix of every code and refusal this feature answers in. */
export const SCENE = "scene:";

/** The two checks every inspectable has: a round, and a turn. */
export const LAYER = Object.freeze({ HASTY: "hasty", METHODICAL: "methodical" });

/** What a layer's check is: nothing thrown, the searching throw, or a named capability. */
export const CHECK = Object.freeze({ INSPECT: "inspect", SEARCH: "search", SKILL: "skill" });

/** The capability whose holder makes the hasty searching throw. */
export const CAPABILITY = Object.freeze({ SEARCHING: "searching" });

/** What a reveal names: another thing in the list, or a wall (a hidden exit). */
export const REVEAL_PREFIXES = Object.freeze(["thing:", "wall:"]);

/** The kinds of unfound thing a hint names, never the thing itself. */
export const MORE = Object.freeze({ LOTS: "lots", CLUE: "clue", REVEAL: "reveal" });

/** What a check answers. */
export const CODE = Object.freeze({
  FOUND: `${SCENE}found`,
  FOUND_NOTHING: `${SCENE}foundNothing`,
  VAGUE: `${SCENE}vague`,
  NEEDS_ROLL: `${SCENE}needsRoll`,
});

/** Why a check cannot be assigned. */
export const REFUSAL = Object.freeze({
  HASTY_LOCKED: `${SCENE}hastyLocked`,
  OUT_OF_REACH: `${SCENE}outOfReach`,
  TOOL_MISSING: `${SCENE}toolMissing`,
  CAPABILITY_MISSING: `${SCENE}capabilityMissing`,
  SKILL_UNNAMED: `${SCENE}skillUnnamed`,
  NOT_IMPORTED: `${SCENE}notImported`,
  ALREADY_FOUND: `${SCENE}alreadyFound`,
});

/**
 * The layer a kind carries when the Judge authored none: a body's hasty check
 * turns out its pockets and the open loot (a floor, a lot) takes the hasty
 * searching throw; every other kind's hasty check is an inspection. Every
 * kind's methodical check is the party's methodical search.
 */
export const KIND_DEFAULTS = Object.freeze({
  [THING_KINDS.BODY]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.CONTAINER]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.FIXTURE]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.EXIT]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.TRAP]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.OBSTACLE]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.CONDITION]: { hasty: CHECK.INSPECT, methodical: CHECK.SEARCH },
  [THING_KINDS.LOT]: { hasty: CHECK.SEARCH, methodical: CHECK.SEARCH },
  [THING_KINDS.FLOOR]: { hasty: CHECK.SEARCH, methodical: CHECK.SEARCH },
});

/** The default authored layer of a kind at one of the two checks: yields nothing, asks nothing. */
export function defaultLayer(kind, name) {
  const check = KIND_DEFAULTS[kind]?.[name] ?? (name === LAYER.HASTY ? CHECK.INSPECT : CHECK.SEARCH);
  return { check, capability: null, anyone: false, tools: [], turns: null, yields: { lots: [], clue: null, reveal: [] } };
}
