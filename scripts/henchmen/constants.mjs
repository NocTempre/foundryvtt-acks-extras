/**
 * Shared constants. Pure module — importable from Node tooling and tests.
 */
export const MODULE_ID = "acks-extras";

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
 * `flags.acks-extras.<domain>` (for this feature's domains) contributes to
 * that modifier domain — this is how proficiency/power Items carry their
 * mechanics (data-driven, never a hardcoded name list). See docs/MODEL.md
 * for the contract.
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
export const INFLUENCE_REACTION_KEY = "flags.acks-extras.reaction";

/** camelCased module id — the namespace custom hooks fire under (TOOLCHAIN §5b). */
const NAMESPACE = MODULE_ID.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); // "acksExtras"

/** Custom hooks fired by this feature. */
export const HOOKS = Object.freeze({
  POSTING_CREATED: `${NAMESPACE}.postingCreated`,
  CANDIDATES_ARRIVED: `${NAMESPACE}.candidatesArrived`,
  CANDIDATE_ROLLED: `${NAMESPACE}.candidateRolled`,
  HIRING_OUTCOME: `${NAMESPACE}.hiringOutcome`,
  HIRED: `${NAMESPACE}.hired`,
  LOYALTY_EVENT: `${NAMESPACE}.loyaltyEvent`,
  LOYALTY_ROLLED: `${NAMESPACE}.loyaltyRolled`,
  CALAMITY: `${NAMESPACE}.calamity`,
  WAGES_PAID: `${NAMESPACE}.wagesPaid`,
  WAGES_MISSED: `${NAMESPACE}.wagesMissed`,
  ROSTER_CHANGED: `${NAMESPACE}.rosterChanged`,
  SLANDER_CHANGED: `${NAMESPACE}.slanderChanged`,
});

/** Seconds per day/week for worldTime math (month length is a setting). */
export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;
