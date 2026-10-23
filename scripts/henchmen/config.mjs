/**
 * Pure-data enums and name-presence patterns. No Foundry imports — importable from
 * Node tooling (tools/build-packs.mjs) and tests, same pattern as
 * acks-monsters scripts/config.mjs.
 */

/** Hireling categories — mirrors core `ACKS.hireling_categories`. */
export const HIRELING_CATEGORIES = Object.freeze({
  henchman: "ACKS-HENCHMEN.category.henchman",
  mercenary: "ACKS-HENCHMEN.category.mercenary",
  specialist: "ACKS-HENCHMEN.category.specialist",
});

/** What a posting searches for. */
export const POSTING_KINDS = Object.freeze({
  henchman: "ACKS-HENCHMEN.posting.kind.henchman",
  henchmanByClass: "ACKS-HENCHMEN.posting.kind.henchmanByClass",
  henchmanByProficiency: "ACKS-HENCHMEN.posting.kind.henchmanByProficiency",
  mercenary: "ACKS-HENCHMEN.posting.kind.mercenary",
  specialist: "ACKS-HENCHMEN.posting.kind.specialist",
});

export const POSTING_STATUS = Object.freeze({
  active: "ACKS-HENCHMEN.posting.status.active",
  closed: "ACKS-HENCHMEN.posting.status.closed",
  exhausted: "ACKS-HENCHMEN.posting.status.exhausted",
});

export const CANDIDATE_STATUS = Object.freeze({
  pending: "ACKS-HENCHMEN.candidate.status.pending",
  available: "ACKS-HENCHMEN.candidate.status.available",
  hired: "ACKS-HENCHMEN.candidate.status.hired",
  refused: "ACKS-HENCHMEN.candidate.status.refused",
  slandered: "ACKS-HENCHMEN.candidate.status.slandered",
  withdrawn: "ACKS-HENCHMEN.candidate.status.withdrawn",
});

/** How a hireling entered service (drives which rules apply). */
export const ORIGINS = Object.freeze({
  market: "ACKS-HENCHMEN.origin.market",
  follower: "ACKS-HENCHMEN.origin.follower",
  adventure: "ACKS-HENCHMEN.origin.adventure",
  purchase: "ACKS-HENCHMEN.origin.purchase",
  manual: "ACKS-HENCHMEN.origin.manual",
});

/** Basis used to compute a hireling's wage. */
export const WAGE_BASES = Object.freeze({
  level: "ACKS-HENCHMEN.wageBasis.level",
  hd: "ACKS-HENCHMEN.wageBasis.hd",
  mercenary: "ACKS-HENCHMEN.wageBasis.mercenary",
  specialist: "ACKS-HENCHMEN.wageBasis.specialist",
  upkeep: "ACKS-HENCHMEN.wageBasis.upkeep",
});

/** Reasons for permanent loyalty adjustments (RR 166). */
export const LOYALTY_REASONS = Object.freeze({
  fanatic: "ACKS-HENCHMEN.loyaltyReason.fanatic",
  grudging: "ACKS-HENCHMEN.loyaltyReason.grudging",
  levelGain: "ACKS-HENCHMEN.loyaltyReason.levelGain",
  calamity: "ACKS-HENCHMEN.loyaltyReason.calamity",
  wound: "ACKS-HENCHMEN.loyaltyReason.wound",
  tampering: "ACKS-HENCHMEN.loyaltyReason.tampering",
  comrade: "ACKS-HENCHMEN.loyaltyReason.comrade",
  elan: "ACKS-HENCHMEN.loyaltyReason.elan",
  insistence: "ACKS-HENCHMEN.loyaltyReason.insistence",
  other: "ACKS-HENCHMEN.loyaltyReason.other",
});

/**
 * Reasons for permanent MORALE adjustments (RR 166). A level-gain entry's note
 * names the level; `firstLevel` and `fifthLevel` are read only, from entries
 * recorded before the levels were imported.
 */
export const MORALE_REASONS = Object.freeze({
  levelGain: "ACKS-HENCHMEN.moraleReason.levelGain",
  firstLevel: "ACKS-HENCHMEN.moraleReason.firstLevel",
  fifthLevel: "ACKS-HENCHMEN.moraleReason.fifthLevel",
  other: "ACKS-HENCHMEN.moraleReason.other",
});

/** Event types in a hireling's record log. */
export const EVENT_TYPES = Object.freeze({
  hired: "ACKS-HENCHMEN.event.hired",
  calamity: "ACKS-HENCHMEN.event.calamity",
  loyaltyRoll: "ACKS-HENCHMEN.event.loyaltyRoll",
  obedienceRoll: "ACKS-HENCHMEN.event.obedienceRoll",
  moraleRoll: "ACKS-HENCHMEN.event.moraleRoll",
  wagePaid: "ACKS-HENCHMEN.event.wagePaid",
  wageMissed: "ACKS-HENCHMEN.event.wageMissed",
  wound: "ACKS-HENCHMEN.event.wound",
  transfer: "ACKS-HENCHMEN.event.transfer",
  apparentLevel: "ACKS-HENCHMEN.event.apparentLevel",
  dismissed: "ACKS-HENCHMEN.event.dismissed",
  adjustment: "ACKS-HENCHMEN.event.adjustment",
});

/** Class rarity tiers (JJ 118), best → worst availability. */
export const RARITY_TIERS = Object.freeze([
  "ubiquitous",
  "common",
  "uncommon",
  "rare",
  "veryRare",
  "extremelyRare",
  "legendary",
]);

/**
 * Item-name regexes that prove a domain's power is PRESENT and nothing more:
 * the power's size is read from the page by the importer (a typed effect on
 * the ability) or set by a Judge's Active Effect, never supplied here. An
 * item matched only by its name makes `hasEffectFlag` true and contributes no
 * modifier, and `unvaluedPowers` names it so a surface can say its value is
 * missing. For a domain with no value (`skipCalamityLoyalty`), presence is the
 * whole of the power.
 */
export const NAME_PRESENCE = Object.freeze({
  hiring: "^diplomacy|^intimidation|^mystic aura|^seduction|^command of voice|^glamorous aura",
  retainBonus: "^leadership|^blood of (ancient )?kings|^scion of kings|^soul of the dragon|^familial loyalty",
  baseLoyalty: "^blood of (ancient )?kings|^scion of kings|^soul of the dragon|^familial loyalty",
  henchmanMorale:
    "^command$|^command \\(|^battlefield prowess|^animal magnetism|^chronicles of battle|^holy fervor|^unholy fanaticism|^dark charisma|^experience and hardiness",
  marketClass: "^mercantile network",
  skipCalamityLoyalty: "^utter domination",
});

/** Build DataModel `choices` from one of the enum objects above. */
export function choicesOf(enumObj) {
  return Object.fromEntries(Object.entries(enumObj).map(([k, v]) => [k, v]));
}
