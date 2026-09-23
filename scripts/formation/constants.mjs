/**
 * Static rules data for ACKS II dungeon delves (exploration formations).
 * Sourced from the Revised Rulebook "Adventures" chapter (pp. 263–271), the
 * Judges Journal sequence of play (pp. 35–37), and the Dungeon Delves I/II
 * reference sheets. See acks-rules/acks-formation/RULES.md for the exhaustive rules summary.
 *
 * All user-facing labels are localization keys resolved via game.i18n; see
 * lang/en.json.
 */

import { MODULE_ID } from "../lib/constants.mjs";
import { getDoc as getTableDoc, hasDoc as hasTableDoc } from "../lib/tables.mjs";
export { MODULE_ID };

/** Flag on the party TokenDocument / party Actor pointing back at a formation. */
export const FLAG_FORMATION_ID = "formationId";
/** Flag on member actors while the party is winded (marker Active Effect id). */
export const WINDED_EFFECT_NAME = "Winded";

/** One dungeon turn is 10 minutes; 10 rounds per turn; 6 turns per hour. */
export const TURN_SECONDS = 600;
export const TURNS_PER_HOUR = 6;
export const TURNS_PER_DAY = 144;

/** The registered document this feature's printed figures arrive in. */
export const FORMATION_DOC = "formation";

/**
 * One printed figure, or null when nothing is registered — the same shape
 * `flight.mjs` and `foraging.mjs` read.
 */
export function formationValue(key) {
  if (!hasTableDoc(FORMATION_DOC)) return null;
  const value = getTableDoc(FORMATION_DOC)?.tables?.[key];
  return value == null ? null : value;
}

/**
 * Turns of exploration a party may spend before it owes a rest, or null when
 * the figure has not been imported — the clock then counts turns and asks for
 * no rest, because nothing here knows when one is due.
 */
export const restInterval = () => formationValue("restInterval");

/** World setting: feet of frontage each marching body occupies. */
export const SETTING_MARCH_FEET = "marchFeetPerBody";

/**
 * Default for `marchFeetPerBody` — marching files pack tighter than the 5-ft
 * combat rank. Derivation and reviewer flag: docs/formation/DECISIONS.md.
 */
export const MARCH_FEET_PER_BODY_DEFAULT = 3;

/** Default wandering-monster cadence (JJ p. 36). */
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
 * ACKS II saving throw keys (system: actor.system.saves[key].value). `breath`
 * is correct for the released system. See docs/formation/DECISIONS.md, "Save
 * keys track the RELEASED system, never the dev branch".
 */
export const SAVE_KEYS = Object.freeze(["paralysis", "death", "breath", "implements", "spell"]);

/** Combat rounds per dungeon turn for time-keeping (RR p. 263). */
export const ROUNDS_PER_TURN = 10;

/*
 * Thief skill level ladders are read from the GM's own book, not shipped here.
 * See `ability-bridge.mjs` (`importedLadderFor`) for the lookup and
 * docs/formation/DECISIONS.md, "The ladders come from the GM's own book".
 * The `acks-formation.thiefSkill: <key>` flag still means "scale as <key>
 * does".
 */

/**
 * The ACKS light table lives in `lib/light.mjs`: a lone actor with a torch needs
 * it as much as a formation does. Re-exported so this feature's existing imports
 * keep reading it from one place.
 */
export { LIGHT_SOURCES, lightGear } from "../lib/light.mjs";


/** A 10' pole needs the physical implement: a pole item or a polearm. */
export const POLE_ITEM_PATTERN = /\bpole\b|polearm|spear|pike|halberd|glaive|lance/i;

/**
 * The trap Item sub-type (declared in module.json `documentTypes.Item`).
 *
 * Named here rather than beside its data model because the trap CODE that is
 * Foundry-free — the wall geometry, the rules, the offline tests — needs to
 * recognise the type, and `data/trap-data.mjs` cannot be imported without
 * Foundry: its class extends a Foundry base at load time.
 */
export const TRAP_ITEM_TYPE = `${MODULE_ID}.trap`;

/** The Trap Zone RegionBehavior sub-type. Named here for the same reason. */
export const TRAP_ZONE_TYPE = `${MODULE_ID}.trapZone`;

/**
 * The implement each role needs before a character can take it up, in the
 * shape `grantGear` reads: one list both refuses the role without the gear
 * and, for a Judge who overrides, supplies what was missing. See
 * docs/formation/DECISIONS.md, "2026-08-03 — The mapper's kit is quill and
 * parchment, one hand each." (RR p. 266).
 */
export const ROLE_GEAR = Object.freeze({
  [ROLES.POLE]: Object.freeze([
    { pattern: POLE_ITEM_PATTERN, name: "Pole, Wooden", label: "ACKS-FORMATION.kit.pole" },
  ]),
  [ROLES.MAPPER]: Object.freeze([
    { pattern: /quill/i, name: "Quill, writing", label: "ACKS-FORMATION.kit.quill" },
    {
      pattern: /parchment|vellum|graph paper/i,
      name: "Parchment",
      label: "ACKS-FORMATION.kit.parchment",
      fallback: { system: { quantity: { value: 1, max: 0 }, cost: 1, weight6: 0 } },
    },
  ]),
});

/**
 * Roles whose kit is HELD rather than merely carried, and so costs hands for as
 * long as the role is held. Only mapping does: a 10' pole is probed with and set
 * down again, while the mapper's quill and parchment stay in both hands — which
 * is what makes mapping and a drawn sword mutually exclusive.
 */
export const ROLE_HAND_COST = Object.freeze({
  [ROLES.MAPPER]: ROLE_GEAR[ROLES.MAPPER].length,
});

/**
 * Carrying a body: what the carried character weighs, and what share of
 * their kit is carried with them. See docs/formation/DECISIONS.md, "Three
 * printed figures leave the module; the rest are inventoried".
 *
 * @returns {{stone: number|null, gearShare: number|null}}
 */
export const carriedBody = () => ({
  stone: formationValue("carriedBodyStone"),
  gearShare: formationValue("carriedGearShare"),
});

/** Inventory name matcher for ration items (1-day preferred over 1-week). */
export const RATION_PATTERN = /ration/i;

/** Default image used for the party token / party actor. */
export const DEFAULT_PARTY_IMAGE = "icons/environment/people/group.webp";

/* Exploration speed reads `actor.system.movementacks.exploration`, which the
   acks system computes. See docs/formation/DECISIONS.md, "Three printed
   figures leave the module; the rest are inventoried". */
