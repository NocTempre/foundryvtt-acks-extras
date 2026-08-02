/**
 * Social-roll AUTOMATION config — this module's own, NOT the book database.
 *
 * Unlike availability/wages/rarity/people (proprietary book tables that ship
 * NOWHERE and are materialized per-seat from the reader's PDF via acks-content
 * extraction), this file is henchmen's ROLL AUTOMATION: how the module presents
 * and computes its 2d6 social throws. It is expressed entirely in module
 * vocabulary — the universal ACKS 2d6 outcome ladder (2 / 3-5 / 6-8 / 9-11 /
 * 12) mapped to this module's own effect enums (`refuseSlander`, `tryAgain`,
 * `acceptElan`…), plus modifier rows that reference this module's own derive
 * keys (`chaMod`, `effectiveLoyalty`…), control types, and i18n label keys.
 * There is no book prose and no reproduced data compilation here, so it ships
 * with the module and registers at SAMPLE priority — a content catalog or a
 * world import may still override it by the `throws` doc id.
 *
 * Registered at setup via the acks-lib table registry; read by ThrowDialog and
 * the influence-hosted pages through getThrowDef/getTable("throws", …).
 */

const employerChaMod = {
  id: "employerCha", kind: "auto", control: "stepper", valuePerStep: 1,
  min: -5, max: 5, derive: "chaMod", label: "ACKS-HENCHMEN.mod.employerCha",
};

export const THROWS_DATA = {
  id: "throws",
  source: { note: "Module roll-automation config (module vocabulary; not book data)." },
  tables: {
    reactionToHiringOutcomes: {
      outcomes: [
        { max: 2, effect: "refuseSlander" },
        { min: 3, max: 5, effect: "refuse" },
        { min: 6, max: 8, effect: "tryAgain" },
        { min: 9, max: 11, effect: "accept" },
        { min: 12, effect: "acceptElan" },
      ],
    },
    irrefusableOfferOutcomes: {
      outcomes: [
        { max: 2, effect: "betrayal" },
        { min: 3, max: 5, effect: "escape" },
        { min: 6, max: 8, effect: "hesitate" },
        { min: 9, max: 11, effect: "accept" },
        { min: 12, effect: "acceptElan" },
      ],
      loyaltyOnHire: { betrayal: null, escape: null, hesitate: -2, accept: 0, acceptElan: 1 },
    },
    hirelingLoyaltyOutcomes: {
      outcomes: [
        { max: 2, effect: "hostility" },
        { min: 3, max: 5, effect: "resignation" },
        { min: 6, max: 8, effect: "grudging", loyaltyDelta: -1 },
        { min: 9, max: 11, effect: "loyal" },
        { min: 12, effect: "fanatic", loyaltyDelta: 1 },
      ],
      naturalClamps: {
        natural2: { noBetterThan: "resignation" },
        natural12: { noWorseThan: "loyal" },
      },
    },
    hirelingObedienceOutcomes: {
      outcomes: [
        { max: 2, effect: "refuses" },
        { min: 3, max: 5, effect: "begrudging" },
        { min: 6, effect: "compliant" },
      ],
    },
    liberationLoyaltyOutcomes: {
      gatedBy: "enableSlavery",
      outcomes: [
        { max: 2, effect: "hostility" },
        { min: 3, max: 5, effect: "resignation" },
        { min: 6, max: 8, effect: "grudging" },
        { min: 9, max: 11, effect: "loyal" },
        { min: 12, effect: "fanaticLiberation" },
      ],
    },
  },
  throws: {
    reactionToHiring: {
      label: "ACKS-HENCHMEN.throw.reactionToHiring",
      formula: "2d6",
      secret: false,
      outcomeTable: "reactionToHiringOutcomes",
      modifiers: [
        employerChaMod,
        {
          id: "signingBonus", kind: "situational", control: "select",
          label: "ACKS-HENCHMEN.mod.signingBonus", hint: "ACKS-HENCHMEN.mod.signingBonusHint",
          options: [
            { id: "none", label: "ACKS-HENCHMEN.mod.signingBonusNone", value: 0 },
            { id: "tier1", label: "ACKS-HENCHMEN.mod.signingBonusTier1", value: 1 },
            { id: "tier2", label: "ACKS-HENCHMEN.mod.signingBonusTier2", value: 2 },
            { id: "tier3", label: "ACKS-HENCHMEN.mod.signingBonusTier3", value: 3 },
          ],
        },
        {
          id: "previousRefusals", kind: "auto", control: "stepper", valuePerStep: -1,
          min: 0, max: 20, derive: "previousRefusals",
          label: "ACKS-HENCHMEN.mod.previousRefusals", hint: "ACKS-HENCHMEN.mod.previousRefusalsHint",
        },
        {
          id: "slander", kind: "auto", control: "stepper", valuePerStep: -1,
          min: 0, max: 20, derive: "slanderCount",
          label: "ACKS-HENCHMEN.mod.slander", hint: "ACKS-HENCHMEN.mod.slanderHint",
        },
      ],
    },
    irrefusableOffer: {
      label: "ACKS-HENCHMEN.throw.irrefusableOffer",
      formula: "2d6",
      secret: false,
      outcomeTable: "irrefusableOfferOutcomes",
      modifiers: [
        employerChaMod,
        {
          id: "oppositeAlignment", kind: "situational", control: "checkbox", value: -2,
          label: "ACKS-HENCHMEN.mod.oppositeAlignment",
        },
        {
          id: "monsterMorale", kind: "auto", control: "stepper", valuePerStep: -1,
          min: -4, max: 4, derive: "monsterMorale",
          label: "ACKS-HENCHMEN.mod.monsterMorale", hint: "ACKS-HENCHMEN.mod.monsterMoraleHint",
        },
      ],
    },
    hirelingLoyalty: {
      label: "ACKS-HENCHMEN.throw.hirelingLoyalty",
      formula: "2d6",
      secret: true,
      outcomeTable: "hirelingLoyaltyOutcomes",
      modifiers: [
        {
          id: "effectiveLoyalty", kind: "auto", control: "stepper", valuePerStep: 1,
          min: -10, max: 10, derive: "effectiveLoyalty",
          label: "ACKS-HENCHMEN.mod.effectiveLoyalty", hint: "ACKS-HENCHMEN.mod.effectiveLoyaltyHint",
        },
        {
          id: "apparentLevelDiff", kind: "auto", control: "stepper", valuePerStep: -1,
          min: 0, max: 13, derive: "apparentLevelDiff",
          label: "ACKS-HENCHMEN.mod.apparentLevelDiff", hint: "ACKS-HENCHMEN.mod.apparentLevelDiffHint",
        },
        {
          id: "judgeAdj", kind: "situational", control: "stepper", valuePerStep: 1,
          min: -2, max: 2, label: "ACKS-HENCHMEN.mod.judgeAdj", hint: "ACKS-HENCHMEN.mod.judgeAdjHint",
        },
      ],
    },
    hirelingObedience: {
      label: "ACKS-HENCHMEN.throw.hirelingObedience",
      formula: "2d6",
      secret: true,
      outcomeTable: "hirelingObedienceOutcomes",
      modifiers: [
        {
          id: "morale", kind: "auto", control: "stepper", valuePerStep: 1,
          min: -10, max: 10, derive: "moraleScore", label: "ACKS-HENCHMEN.mod.morale",
        },
        {
          id: "company", kind: "situational", control: "select", label: "ACKS-HENCHMEN.mod.company",
          options: [
            { id: "employer", label: "ACKS-HENCHMEN.mod.companyEmployer", value: 2 },
            { id: "adventurer", label: "ACKS-HENCHMEN.mod.companyAdventurer", value: 1 },
            { id: "hirelings", label: "ACKS-HENCHMEN.mod.companyHirelings", value: 0 },
            { id: "alone", label: "ACKS-HENCHMEN.mod.companyAlone", value: -1 },
          ],
        },
        {
          id: "customaryTask", kind: "situational", control: "checkbox", value: 2,
          label: "ACKS-HENCHMEN.mod.customaryTask",
        },
        {
          id: "recentCasualties", kind: "situational", control: "checkbox", value: -1,
          label: "ACKS-HENCHMEN.mod.recentCasualties",
        },
        {
          id: "risk", kind: "situational", control: "select", label: "ACKS-HENCHMEN.mod.risk",
          options: [
            { id: "shared", label: "ACKS-HENCHMEN.mod.riskShared", value: 0 },
            { id: "more", label: "ACKS-HENCHMEN.mod.riskMore", value: -1 },
            { id: "great", label: "ACKS-HENCHMEN.mod.riskGreat", value: -2 },
            { id: "extraordinary", label: "ACKS-HENCHMEN.mod.riskExtraordinary", value: -5 },
          ],
        },
        {
          id: "mercenaryAdventuring", kind: "situational", control: "checkbox", value: -5,
          label: "ACKS-HENCHMEN.mod.mercenaryAdventuring",
        },
      ],
    },
    liberationLoyalty: {
      label: "ACKS-HENCHMEN.throw.liberationLoyalty",
      formula: "2d6",
      secret: true,
      outcomeTable: "liberationLoyaltyOutcomes",
      modifiers: [
        {
          id: "liberatorCha", kind: "auto", control: "stepper", valuePerStep: 1,
          min: -5, max: 5, derive: "chaMod", label: "ACKS-HENCHMEN.mod.liberatorCha",
        },
      ],
    },
  },
};

/**
 * Alignment-openness AUTOMATION (module inference, not a printed table):
 * recruiting a class openly where its alignment is unwelcome shifts the
 * directed-search rarity one step (chaotic warlocks in a lawful town). The
 * step is this module's own judgment call layered under any world import
 * (partial doc at SAMPLE priority; per-table registry layering keeps the
 * imported rarity tables above it).
 */
export const RARITY_AUTOMATION = {
  id: "rarity",
  source: { note: "Module automation config (alignment-openness inference; not book data)." },
  tables: {
    alignmentRecruitment: {
      shifts: {
        lawful: { chaotic: 1 },
        neutral: {},
        chaotic: { lawful: 1 },
      },
    },
  },
};
