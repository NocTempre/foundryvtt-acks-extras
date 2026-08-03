/**
 * Static rules data for ACKS II dungeon delves (exploration formations).
 * Sourced from the Revised Rulebook "Adventures" chapter (pp. 263–271), the
 * Judges Journal sequence of play (pp. 35–37), and the Dungeon Delves I/II
 * reference sheets. See acks-rules/acks-formation/RULES.md for the exhaustive rules summary.
 *
 * All user-facing labels are localization keys resolved via game.i18n; see
 * lang/en.json.
 */

export const MODULE_ID = "acks-extras";

/** Flag on the party TokenDocument / party Actor pointing back at a formation. */
export const FLAG_FORMATION_ID = "formationId";
/** Flag on member actors while the party is winded (marker Active Effect id). */
export const WINDED_EFFECT_NAME = "Winded";

/** One dungeon turn is 10 minutes; 10 rounds per turn; 6 turns per hour. */
export const TURN_SECONDS = 600;
export const TURNS_PER_HOUR = 6;
export const TURNS_PER_DAY = 144;

/** All adventurers must rest 1 turn per 5 turns of exploration and combat. */
export const REST_INTERVAL = 5;

/** Default wandering-monster cadence: 1d6 every 2 turns, encounter on 6+. */
export const DEFAULT_ENCOUNTER_EVERY = 2;
export const DEFAULT_ENCOUNTER_TARGET = 6;

/** Special formation roles (marching order itself is the member list order). */
export const ROLES = Object.freeze({
  MAPPER: "mapper",
  SCOUT: "scout",
  REARGUARD: "rearguard",
  POLE: "pole",
  NONCOMBATANT: "noncombatant",
  CARRIER: "carrier",
});

export const ROLE_ORDER = Object.freeze([
  ROLES.SCOUT,
  ROLES.MAPPER,
  ROLES.POLE,
  ROLES.REARGUARD,
  ROLES.NONCOMBATANT,
  ROLES.CARRIER,
]);

export const ROLE_LABELS = Object.freeze({
  [ROLES.MAPPER]: "ACKS-FORMATION.role.mapper",
  [ROLES.SCOUT]: "ACKS-FORMATION.role.scout",
  [ROLES.REARGUARD]: "ACKS-FORMATION.role.rearguard",
  [ROLES.POLE]: "ACKS-FORMATION.role.pole",
  [ROLES.NONCOMBATANT]: "ACKS-FORMATION.role.noncombatant",
  [ROLES.CARRIER]: "ACKS-FORMATION.role.carrier",
});

export const ROLE_HINTS = Object.freeze({
  [ROLES.MAPPER]: "ACKS-FORMATION.role.mapperHint",
  [ROLES.SCOUT]: "ACKS-FORMATION.role.scoutHint",
  [ROLES.REARGUARD]: "ACKS-FORMATION.role.rearguardHint",
  [ROLES.POLE]: "ACKS-FORMATION.role.poleHint",
  [ROLES.NONCOMBATANT]: "ACKS-FORMATION.role.noncombatantHint",
  [ROLES.CARRIER]: "ACKS-FORMATION.role.carrierHint",
});

/**
 * ACKS II saving throw keys (system: actor.system.saves[key].value).
 *
 * `breath` is CORRECT for the released system: acks 14.0.1 stores member saves
 * under `saves.breath` (displayed as "Blast" via ACKS.saves.breath.long).
 * Verified live — a fresh character's schema is
 * [paralysis, death, breath, implements, spell, wand] and ACKS.saves.blast.long
 * does not exist. The system's dev branch renames breath→blast; flip this key
 * when that lands in a system RELEASE, not before — the modules target the
 * released system, and the test world runs it.
 */
export const SAVE_KEYS = Object.freeze(["paralysis", "death", "breath", "implements", "spell"]);

/** Combat rounds per dungeon turn for time-keeping (RR p. 263). */
export const ROUNDS_PER_TURN = 10;

/*
 * Thief skill level ladders USED to live here as a literal RR p.31 table.
 * They are now read from the GM's own book: acks-content's `progression` recipe
 * extracts each skill's grid column at import and stores it on the ability as
 * an acks-lib `breakpoints` LevelValue, which resolves at any level. See
 * `ability-bridge.mjs` (`importedLadderFor`) for the lookup and
 * docs/ABILITIES-AUDIT.md §5 Phase 4 for why the table went.
 *
 * The `acks-formation.thiefSkill: <key>` flag survives and means what it always
 * meant — "scale as <key> does" — but now resolves through the imported
 * definition instead of a shipped array.
 */

/**
 * The ACKS light table lives in `lib/light.mjs`: a lone actor with a torch needs
 * it as much as a formation does. Re-exported so this feature's existing imports
 * keep reading it from one place.
 */
export { LIGHT_SOURCES } from "../lib/light.mjs";


/** A 10' pole needs the physical implement: a pole item or a polearm. */
export const POLE_ITEM_PATTERN = /pole|polearm|spear|pike|halberd|glaive|lance/i;

/**
 * Carrying a body: the carried character counts as 7 3/6 stone plus half of
 * their equipment encumbrance (RULES.md §12, the rescue rule — the only
 * quantified carrying figure in the references).
 */
export const BODY_STONE = 7.5;

/** Inventory name matcher for ration items (1-day preferred over 1-week). */
export const RATION_PATTERN = /ration/i;

/** Default image used for the party token / party actor. */
export const DEFAULT_PARTY_IMAGE = "icons/environment/people/group.webp";

/**
 * Exploration speed tiers by encumbrance in stone (RR / reference sheet).
 * Used only for display; the authoritative per-actor value is
 * `actor.system.movementacks.exploration`, computed by the acks system.
 */
export const SPEED_TIERS = Object.freeze([
  { maxStone: 5, exploration: 120, combat: 40, running: 120 },
  { maxStone: 7, exploration: 90, combat: 30, running: 90 },
  { maxStone: 10, exploration: 60, combat: 20, running: 60 },
  { maxStone: Infinity, exploration: 30, combat: 10, running: 30 },
]);
