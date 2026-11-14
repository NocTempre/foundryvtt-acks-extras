/**
 * Social-roll AUTOMATION config — this module's own, not an imported book
 * table: each throw's dice, controls and derive keys (`chaMod`,
 * `effectiveLoyalty`…). No result column ships here: an opener hands in the
 * imported one as `outcomes` (`rules/hiring-offer.mjs`, `rules/loyalty.mjs`
 * `hirelingLoyaltyOutcomes`, `rules/irrefusable.mjs`), and an imported
 * per-count or checkbox figure as `stepValues`. A control with no figure adds
 * nothing, and a throw with no column names no result. Ships at SAMPLE
 * priority: a content catalog or world import may still override it by the
 * `throws` doc id.
 *
 * Registered at setup via the lib subsystem's table registry; read by
 * ThrowDialog and the influence-hosted pages through getThrowDef/getTable
 * ("throws", …).
 */

const employerChaMod = {
  id: "employerCha", kind: "auto", control: "stepper", valuePerStep: 1,
  min: -5, max: 5, derive: "chaMod", label: "ACKS-HENCHMEN.mod.employerCha",
};

/** The `throws` table doc: each social throw's dice, controls and derive keys, with no result column. */
export const THROWS_DATA = {
  id: "throws",
  source: { note: "Module roll-automation config (module vocabulary; not book data)." },
  tables: {},
  throws: {
    // The result column and both per-count figures are the Judge's imported
    // `influence.hiringOffer` (rules/hiring-offer.mjs); an opener passes them
    // in as `outcomes` and `stepValues`, and refuses to open without them.
    reactionToHiring: {
      label: "ACKS-HENCHMEN.throw.reactionToHiring",
      formula: "2d6",
      secret: false,
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
          id: "previousRefusals", kind: "auto", control: "stepper",
          min: 0, max: 20, derive: "previousRefusals",
          label: "ACKS-HENCHMEN.mod.previousRefusals", hint: "ACKS-HENCHMEN.mod.previousRefusalsHint",
        },
        {
          id: "slander", kind: "auto", control: "stepper",
          min: 0, max: 20, derive: "slanderCount",
          label: "ACKS-HENCHMEN.mod.slander", hint: "ACKS-HENCHMEN.mod.slanderHint",
        },
      ],
    },
    // The result column and the opposite-alignment figure are the Judge's
    // imported `influence.irrefusableOffer` (rules/irrefusable.mjs); the
    // opener passes them in as `outcomes` and `stepValues`.
    irrefusableOffer: {
      label: "ACKS-HENCHMEN.throw.irrefusableOffer",
      formula: "2d6",
      secret: false,
      modifiers: [
        employerChaMod,
        {
          id: "oppositeAlignment", kind: "situational", control: "checkbox",
          label: "ACKS-HENCHMEN.mod.oppositeAlignment",
        },
        {
          id: "monsterMorale", kind: "auto", control: "stepper", valuePerStep: -1,
          min: -4, max: 4, derive: "monsterMorale",
          label: "ACKS-HENCHMEN.mod.monsterMorale", hint: "ACKS-HENCHMEN.mod.monsterMoraleHint",
        },
      ],
    },
    // The result column is the Judge's imported `influence.hirelingLoyalty`
    // (rules/loyalty.mjs `hirelingLoyaltyOutcomes`), passed in as `outcomes`.
    hirelingLoyalty: {
      label: "ACKS-HENCHMEN.throw.hirelingLoyalty",
      formula: "2d6",
      secret: true,
      modifiers: [
        {
          id: "effectiveLoyalty", kind: "auto", control: "stepper", valuePerStep: 1,
          min: -10, max: 10, derive: "effectiveLoyalty",
          label: "ACKS-HENCHMEN.mod.effectiveLoyalty", hint: "ACKS-HENCHMEN.mod.effectiveLoyaltyHint",
        },
        {
          // Counts levels; the opener hands in what each is worth (RR 168).
          id: "apparentLevelDiff", kind: "auto", control: "stepper",
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
    // Names no result of its own: an opener hands in a column as `outcomes`.
    liberationLoyalty: {
      label: "ACKS-HENCHMEN.throw.liberationLoyalty",
      formula: "2d6",
      secret: true,
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
