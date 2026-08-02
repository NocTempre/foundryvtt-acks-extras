/**
 * Pure-data enums and fallback tables. No Foundry imports — importable from
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

/** Reasons for permanent MORALE adjustments (RR 166). */
export const MORALE_REASONS = Object.freeze({
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
 * Item-name fallbacks: when a proficiency/power Item carries NO
 * `flags.acks-henchmen.*` Active Effect, these regexes recover the classic
 * book mechanics from the item name alone (graceful degradation for worlds
 * built before this module — the AE contract is always preferred and a
 * name match is skipped when the item has any acks-henchmen effect change).
 * `condition` marks the bonus as situational (GM/player toggles it in the
 * roll dialog); absent condition means always-on.
 */
export const NAME_FALLBACKS = Object.freeze({
  hiring: [
    { pattern: "^diplomacy", value: 1, condition: "ACKS-HENCHMEN.cond.parley" },
    { pattern: "^intimidation", value: 1, condition: "ACKS-HENCHMEN.cond.threats" },
    { pattern: "^mystic aura", value: 1, condition: "ACKS-HENCHMEN.cond.impress" },
    { pattern: "^seduction", value: 1, condition: "ACKS-HENCHMEN.cond.attracted" },
    { pattern: "^command of voice|^glamorous aura", value: 1, condition: "ACKS-HENCHMEN.cond.impress" },
    { pattern: "^familiar folkways", value: 1, condition: "ACKS-HENCHMEN.cond.ownSettlement" },
  ],
  retainBonus: [
    { pattern: "^leadership", value: 1 },
    { pattern: "^blood of (ancient )?kings|^scion of kings|^soul of the dragon", value: 1 },
    { pattern: "^familial loyalty", value: 1, condition: "ACKS-HENCHMEN.cond.related" },
  ],
  baseLoyalty: [
    { pattern: "^blood of (ancient )?kings|^scion of kings|^soul of the dragon", value: 1 },
    { pattern: "^familial loyalty", value: 1, condition: "ACKS-HENCHMEN.cond.related" },
  ],
  henchmanMorale: [
    { pattern: "^command$|^command \\(", value: 2 },
    { pattern: "^battlefield prowess|^animal magnetism", value: 1, condition: "ACKS-HENCHMEN.cond.personallyLed" },
    { pattern: "^chronicles of battle", value: 1, condition: "ACKS-HENCHMEN.cond.witnessed" },
    { pattern: "^holy fervor|^unholy fanaticism", value: 1, condition: "ACKS-HENCHMEN.cond.sameReligion" },
    { pattern: "^dark charisma", value: 1, condition: "ACKS-HENCHMEN.cond.chaoticServants" },
    { pattern: "^experience and hardiness", value: 1, condition: "ACKS-HENCHMEN.cond.wilderness" },
    { pattern: "^military genius", value: 1, condition: "ACKS-HENCHMEN.cond.commanding" },
  ],
  marketClass: [{ pattern: "^mercantile network", value: 1, condition: "ACKS-HENCHMEN.cond.knownMarket" }],
  skipCalamityLoyalty: [{ pattern: "^utter domination", value: 1 }],
});

/** Build DataModel `choices` from one of the enum objects above. */
export function choicesOf(enumObj) {
  return Object.fromEntries(Object.entries(enumObj).map(([k, v]) => [k, v]));
}
