/**
 * Shared constants. Pure module — importable from Node tooling and tests.
 */
export const MODULE_ID = "acks-henchmen";

/** Actor sub-type id for settlements/markets (namespaced by Foundry). */
export const LOCATION_TYPE = `${MODULE_ID}.location`;

/** Flag key on hireling actors holding the HenchmanRecord DataModel data. */
export const FLAG_RECORD = "record";
/** Flag key on employer actors: array of monster-henchman actor ids. */
export const FLAG_MONSTER_LIST = "monsterHenchmenList";
/** Flag key on employer actors: extra henchman slots granted manually. */
export const FLAG_RETAIN_BONUS = "retainBonus";

/** Socket channel (native game.socket; socketlib used instead when active). */
export const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/**
 * Book-table document ids expected from per-world import (acks-content
 * extraction). `throws` is NOT here — it is this module's own roll-automation
 * config, shipped in scripts/data/throws-data.mjs and registered at setup.
 */
export const RULEDATA = Object.freeze([
  "availability",
  "rarity",
  "wages",
  "followers",
  "settlement",
  "monsters",
  "slavery",
  "people",
]);

/** Current location-actor schema version (see migrations in module.mjs). */
export const SCHEMA_VERSION = 2;

/**
 * Active Effect change-key prefix. Any effect change whose key is
 * `flags.acks-henchmen.<domain>` contributes to that modifier domain —
 * this is how proficiency/power Items carry their mechanics (data-driven,
 * never a hardcoded name list). See docs/MODEL.md for the contract.
 */
export const EFFECT_PREFIX = `flags.${MODULE_ID}.`;

/** Modifier domains recognized on Active Effect changes. */
export const EFFECT_DOMAINS = Object.freeze({
  HIRING: "hiring", // Reaction to Hiring Offer roll bonus
  LOYALTY_ROLL: "loyaltyRoll", // Hireling Loyalty roll bonus
  MORALE_ROLL: "moraleRoll", // morale roll bonus
  OBEDIENCE_ROLL: "obedienceRoll", // Hireling Obedience roll bonus
  RETAIN_BONUS: "retainBonus", // extra henchman slots (Leadership, Blood of Kings…)
  BASE_LOYALTY: "baseLoyalty", // starting loyalty of new hires (Blood of Kings…)
  HENCHMAN_MORALE: "henchmanMorale", // morale-score bonus to hirelings when led/present
  MARKET_CLASS: "marketClass", // availability market-class shift (Mercantile Network)
  MORALE_BASE: "moraleBase", // base-morale override for hirelings (Utter Domination +4)
  SKIP_CALAMITY_LOYALTY: "skipCalamityLoyalty", // bool: no loyalty rolls on calamity
  RECRUIT_KINDS: "recruitKinds", // CSV: unlock henchman kinds (animal, fungal…)
  REACTION_TWICE: "reactionRollTwice", // "better" | "worse" (White Luck Presence)
});

/** acks-influence Active Effect reaction key, honored on hiring rolls. */
export const INFLUENCE_REACTION_KEY = "flags.acks-influence.reaction";

/** Custom hooks fired by this module. */
export const HOOKS = Object.freeze({
  POSTING_CREATED: `${MODULE_ID}.postingCreated`,
  CANDIDATES_ARRIVED: `${MODULE_ID}.candidatesArrived`,
  CANDIDATE_ROLLED: `${MODULE_ID}.candidateRolled`,
  HIRING_OUTCOME: `${MODULE_ID}.hiringOutcome`,
  HIRED: `${MODULE_ID}.hired`,
  LOYALTY_EVENT: `${MODULE_ID}.loyaltyEvent`,
  LOYALTY_ROLLED: `${MODULE_ID}.loyaltyRolled`,
  CALAMITY: `${MODULE_ID}.calamity`,
  WAGES_PAID: `${MODULE_ID}.wagesPaid`,
  WAGES_MISSED: `${MODULE_ID}.wagesMissed`,
  ROSTER_CHANGED: `${MODULE_ID}.rosterChanged`,
  SLANDER_CHANGED: `${MODULE_ID}.slanderChanged`,
});

/** Seconds per day/week for worldTime math (month length is a setting). */
export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
