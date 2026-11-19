/**
 * Scene search's vocabulary: the two checks, what a layer can be, who may
 * attempt what, and the codes the model answers in. Pure data; no Foundry, no
 * lang strings, and no figure read off a page (every throw target, bonus and
 * reach is an argument to the functions in `scene-logic.mjs`).
 */
import { THING_KINDS } from "../lib/place-things-logic.mjs";

/** The prefix of every code and refusal this feature answers in. */
export const SCENE = "scene:";

/** The `kind` of a pot's `origin` when a scene dealt it (treasure's own origin is `combat`). */
export const ORIGIN = Object.freeze({ SCENE: "scene" });

/** The two checks every inspectable has: a round, and a turn. */
export const LAYER = Object.freeze({ HASTY: "hasty", METHODICAL: "methodical" });

/** What a layer's check is: nothing thrown, the searching throw, or a named capability. */
export const CHECK = Object.freeze({ INSPECT: "inspect", SEARCH: "search", SKILL: "skill" });

/** The capability whose holder makes the hasty searching throw; formation's `PARTY_CHECKS.searchHasty` names it the same way. */
export const CAPABILITY = Object.freeze({ SEARCHING: "kw:searching" });

/**
 * The proficiencies whose page prints no throw: a holder's check on a layer
 * that names one is made, not rolled (`lore-logic.mjs` `skillFigures`). Only a
 * token listed here, held by the member, with no throw read off the member's own
 * ability, is automatic; any other capability with no figure is unimported and
 * cannot be assigned. RR ch. 3, Sensing Power.
 */
export const AUTOMATIC_SKILLS = Object.freeze(["kw:sensingpower"]);

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

/** The party actor's flag, under the module's scope, holding the scene's session. */
export const SESSION_FLAG = "sceneSearch";

/** The two turn-plan activities a check is assigned through; the key says which layer it rolls. */
export const ACTIVITY = Object.freeze({ HASTY: "sceneHasty", METHODICAL: "sceneMethodical" });

/** The layer each activity key resolves. */
export const LAYER_OF_ACTIVITY = Object.freeze({ [ACTIVITY.HASTY]: LAYER.HASTY, [ACTIVITY.METHODICAL]: LAYER.METHODICAL });

/** How many rows of a session's log are kept: the oldest go first. */
export const LOG_LIMIT = 200;

/** Why the session api refuses a call, each a `scene:` code. */
export const SESSION_REFUSAL = Object.freeze({
  NOT_ALLOWED: `${SCENE}notAllowed`,
  NO_PARTY: `${SCENE}noParty`,
  NO_PLACE: `${SCENE}noPlace`,
  NO_SESSION: `${SCENE}noSession`,
  SESSION_OPEN: `${SCENE}sessionOpen`,
  UNKNOWN_ENTRY: `${SCENE}unknownEntry`,
  NOT_A_MEMBER: `${SCENE}notAMember`,
  NOT_OFFERED: `${SCENE}notOffered`,
  DEAL_FAILED: `${SCENE}dealFailed`,
});

/** Why a way into the scene (the fight-over card, the Dungeon tab's Search here) cannot open it, each a `scene:` code. */
export const WAYS_REFUSAL = Object.freeze({
  NO_PARTY_HERE: `${SCENE}noPartyHere`,
  NO_PLACE_HERE: `${SCENE}noPlaceHere`,
  CARD_SPENT: `${SCENE}cardSpent`,
});
