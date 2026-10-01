/**
 * Social-roll AUTOMATION config — this module's own, not an imported book
 * table. Maps the universal ACKS 2d6 outcome ladder onto this module's own
 * effect enums (`refuseSlander`, `tryAgain`, `acceptElan`…) and derive keys
 * (`chaMod`, `effectiveLoyalty`…), so hiring/loyalty/obedience rolls work with
 * no import. Ships at SAMPLE priority: a content catalog or world import may
 * still override it by the `throws` doc id.
 *
 * Registered at setup via the lib subsystem's table registry; read by
 * ThrowDialog and the influence-hosted pages through getThrowDef/getTable
 * ("throws", …).
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
    // The page that names this throw's modifiers and result is the influence
    // roller's (RR 167), reading the Judge's imported table. This is what is
    // left when that page cannot open: the morale score and whatever the
    // caller adds, a total, and no result named.
    hirelingObedience: {
      label: "ACKS-HENCHMEN.throw.hirelingObedience",
      formula: "2d6",
      secret: true,
      modifiers: [
        {
          id: "morale", kind: "auto", control: "stepper", valuePerStep: 1,
          min: -10, max: 10, derive: "moraleScore", label: "ACKS-HENCHMEN.mod.morale",
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
 * directed-search rarity one step. Partial doc at SAMPLE priority; per-table
 * registry layering keeps any imported rarity tables above it.
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

/**
 * The tables these two documents register, for `tools/validate-producers.mjs`;
 * each is read from no page, so none names a raw source.
 */
export const PRODUCES = Object.freeze(
  Object.fromEntries(
    [THROWS_DATA, RARITY_AUTOMATION].map((doc) => [doc.id, Object.fromEntries(Object.keys(doc.tables).map((k) => [k, null]))]),
  ),
);
