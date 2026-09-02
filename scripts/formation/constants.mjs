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
 * One printed figure, or null when nothing is registered.
 *
 * The same shape `flight.mjs` and `foraging.mjs` already use. What ships is
 * that a party must rest, that a carried body weighs on whoever carries it,
 * and that only part of its kit weighs with it — the procedure. How OFTEN, and
 * HOW MUCH, are read off a page and arrive with the reader's own book.
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
 * They are now read from the GM's own book: the importer's `progression` recipe
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
 * The implement each role needs before a character can take it up, in the shape
 * `grantGear` reads — so ONE list both refuses the role to a character without
 * the gear and, for a Judge who overrides, supplies what was missing.
 *
 * RR p. 266 gives the mapper's requirement as "both hands occupied", and this is
 * what occupies them: a quill in one hand, something to draw on in the other.
 * ONE HAND PER PIECE, which is why the kit is a list rather than a count — add a
 * third piece and the mapper needs a third hand, exactly as RAW would have it.
 *
 * The RAW equipment list prices the quill and no writing surface, so parchment
 * carries a stand-in price, used only when the world has no such item to copy
 * (see docs/formation/DECISIONS.md).
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
 * Carrying a body: what the carried character weighs, and what share of their
 * kit is carried with them.
 *
 * ONE OWNER for one printed figure. The rescue path in `swimming.mjs` used to
 * keep its own copy of both, so the same number was transcribed twice inside
 * one feature — which is how a printed value survives being registered in one
 * place and not the other.
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

/* The exploration speed grid that stood here was a printed table transcribed
   whole — four encumbrance bands against three speeds — with no reader left in
   the module: the authoritative per-actor figure is
   `actor.system.movementacks.exploration`, which the acks system computes. A
   printed grid nothing consults is content with no argument for shipping it, so
   it is gone rather than registered. If a speed band is ever needed here, read
   the system's value or register the table; do not retype it. */
