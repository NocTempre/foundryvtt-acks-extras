/**
 * Static rules data for ACKS II dungeon delves (exploration formations).
 * Sourced from the Revised Rulebook "Adventures" chapter (pp. 263–271), the
 * Judges Journal sequence of play (pp. 35–37), and the Dungeon Delves I/II
 * reference sheets. See the formation RULES.md on the local rules shelf for the exhaustive rules summary.
 *
 * All user-facing labels are localization keys resolved via game.i18n; see
 * lang/en.json.
 */

import { MODULE_ID, TURN_SECONDS, ROUNDS_PER_TURN } from "../lib/constants.mjs";
import { getDoc as getTableDoc, hasDoc as hasTableDoc } from "../lib/tables.mjs";
// The turn's length and its rounds are the module's own time unit, owned by
// lib (`lib/constants.mjs`); formation reads them under the names it always did.
export { MODULE_ID, TURN_SECONDS, ROUNDS_PER_TURN };

/** Flag on the party TokenDocument / party Actor pointing back at a formation. */
export const FLAG_FORMATION_ID = "formationId";
/** The dedicated party actor sub-type (`party-actor.mjs`). */
export const PARTY_TYPE = `${MODULE_ID}.party`;
/** Flag on member actors while the party is winded (marker Active Effect id). */
export const WINDED_EFFECT_NAME = "Winded";

/** Dungeon turns in an hour of game time (a turn's length is `TURN_SECONDS`). */
export const TURNS_PER_HOUR = 6;
/** Dungeon turns in a day of game time. */
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

/** World setting: whether the delve demands rests at all. */
export const SETTING_REST_REQUIRED = "restRequired";

/**
 * Whether the delve counts turns since the last rest, warns that one is due
 * and winds the party past the interval. Off, the clock still runs and a rest
 * turn still advances it; nothing counts toward a rest, announces one or
 * penalises its absence. An unregistered setting reads as on, which is the
 * default.
 */
export function restEnforced() {
  return globalThis.game?.settings?.get(MODULE_ID, SETTING_REST_REQUIRED) !== false;
}

/**
 * What a party token is on the map. `order`: a one-cell head with the marching
 * column drawn behind it along the ground it walked. `fixed`: whatever size the
 * Judge gives it, with nothing drawn. Lights shine from the bearers' places in
 * the column in both.
 */
export const PARTY_TOKEN_SHAPES = Object.freeze(["order", "fixed"]);

/** World setting: the shape a party takes until its own sheet chooses one. */
export const SETTING_PARTY_TOKEN_SHAPE = "partyTokenShape";

/**
 * Token flag stamping the size the module last wrote, `{width, height}`. A
 * token whose size still matches it is the module's to resize; one a hand has
 * changed since is the Judge's.
 */
export const FLAG_PARTY_SIZE = "partySize";

/**
 * Token flag set the first time the environment sync reads a party token's
 * sight, after giving it sight where it had none. Sight a hand changes after
 * that is the Judge's.
 */
export const FLAG_PARTY_SIGHT = "partySight";

/**
 * Token flag holding the ground the party token walked, `{sceneId, points}`:
 * cell top-left corners from the head backward, bounded to the column's depth.
 */
export const FLAG_TRAIL = "trail";

/**
 * The registered document the delve's wandering-monster throw arrives in
 * (JJ p. 36). Four scalar tables, so an override of one leaves the rest
 * imported: `die`, the encounter throw's dice; `every`, the turns between
 * throws; `target`, the throw that meets a wandering monster; `distance`, the
 * dice of the encounter distance in feet.
 */
export const DELVE_ENCOUNTER_DOC = "delveEncounters";

/** A stored figure as a positive whole number, or null. */
const positiveWhole = (value) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * A stored dice formula (`NdM`, or `NdM*K`), rebuilt from its integers, or
 * null: a Judge's override is free text, and nothing but dice reaches a roll.
 */
export const diceFormula = (value) => {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:[*×x]\s*(\d+))?\s*$/i.exec(String(value ?? ""));
  if (!m || !(Number(m[1]) > 0) || !(Number(m[2]) > 0)) return null;
  return m[3] && Number(m[3]) > 0 ? `${Number(m[1])}d${Number(m[2])}*${Number(m[3])}` : `${Number(m[1])}d${Number(m[2])}`;
};

/**
 * The imported delve throw, `{die, every, target, distance}`, each null where
 * nothing imported it. A Judge's override layer wins over the import per table.
 */
export function importedEncounterCadence() {
  const none = { die: null, every: null, target: null, distance: null };
  if (!hasTableDoc(DELVE_ENCOUNTER_DOC)) return none;
  const tables = getTableDoc(DELVE_ENCOUNTER_DOC)?.tables ?? {};
  return {
    die: diceFormula(tables.die),
    every: positiveWhole(tables.every),
    target: positiveWhole(tables.target),
    distance: diceFormula(tables.distance),
  };
}

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
 * ACKS II saving throw keys (system: actor.system.saves[key].value), as the
 * released system spells them. See docs/formation/DECISIONS.md, "Save keys
 * track the RELEASED system, never the dev branch".
 */
export const SAVE_KEYS = Object.freeze(["paralysis", "death", "blast", "implements", "spell"]);

/*
 * Thief skill level ladders are read from the GM's own book, not shipped here.
 * See `ability-bridge.mjs` (`importedLadderFor`) for the lookup and
 * docs/formation/DECISIONS.md, "The ladders come from the GM's own book".
 */

/**
 * The ACKS light table lives in `lib/light.mjs`: a lone actor with a torch needs
 * it as much as a formation does. Re-exported so this feature's existing imports
 * keep reading it from one place.
 */
export { LIGHT_SOURCES, lightGear } from "../lib/light.mjs";


/** A pole probe needs the physical implement: a pole item or a polearm. */
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
 * long as the role is held. Only mapping does: a pole is probed with and set
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

/**
 * User flag holding, per party actor id, whether the party sheet's panel is
 * hidden under its tab row. A viewing preference lives with the viewer: an
 * observer seat can hide the panel of a sheet it cannot edit.
 */
export const PANEL_FLAG = "partyPanel";

/* Exploration speed reads `actor.system.movementacks.exploration`, which the
   acks system computes. See docs/formation/DECISIONS.md, "Three printed
   figures leave the module; the rest are inventoried". */
