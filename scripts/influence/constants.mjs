/**
 * Static rules data for the ACKS II influence rolls.
 * Sourced from the player rules (pp. 84-87) and the Judges Journal GM screen.
 * The modifier layout mirrors the GM screen: rows in screen order, grouped by
 * the Both / Either / Character / Target keys, with "±" rows as selects.
 *
 * All user-facing labels are localization keys resolved via game.i18n; see
 * lang/en.json. See acks-rules/acks-influence/ACKS-Reactions-Reference.md for the rules reference.
 */

export const MODULE_ID = "acks-influence";

/**
 * Active Effect convention: an effect on any item/actor with a change keyed
 * `flags.acks-influence.<family>` contributes a modifier equal to the change
 * value to that family of 2d6 social roll. Effect flags under
 * `flags.acks-influence` tune it:
 *   - situational {boolean} default true  → shown as a GM-toggled checkbox
 *   - tone {"all"|"diplomacy"|"intimidation"|"seduction"} default "all"
 *   - label {string} optional display label (else the effect's name)
 *
 * ONE effect may carry several changes, which is how a rule that spans roll
 * families is expressed. Inhumanity is the reason this exists: RAW it modifies
 * "reactions, loyalty, and morale", so it ships as three changes on one effect
 * rather than three items a GM has to keep in sync. Before this, every effect
 * was implicitly a reaction effect and the loyalty page had to include all of
 * them or none — so a Diplomacy bonus leaked onto loyalty rolls, or Inhumanity
 * silently didn't. Mirrors acks-lib `MODIFIER_TARGETS`.
 */
export const ROLL_FAMILY = Object.freeze({
  REACTION: "reaction",
  LOYALTY: "loyalty",
  MORALE: "morale",
});

export const REACTION_CHANGE_KEY = `flags.${MODULE_ID}.reaction`;
export const LOYALTY_CHANGE_KEY = `flags.${MODULE_ID}.loyalty`;
export const MORALE_CHANGE_KEY = `flags.${MODULE_ID}.morale`;

/** Change key → the roll family it feeds. */
export const CHANGE_KEY_FAMILY = Object.freeze({
  [REACTION_CHANGE_KEY]: ROLL_FAMILY.REACTION,
  [LOYALTY_CHANGE_KEY]: ROLL_FAMILY.LOYALTY,
  [MORALE_CHANGE_KEY]: ROLL_FAMILY.MORALE,
});

/** The three tones a spokesperson can adopt when attempting to influence. */
export const INFLUENCE_TONE = Object.freeze({
  DIPLOMACY: "diplomacy",
  INTIMIDATION: "intimidation",
  SEDUCTION: "seduction",
});

export const INFLUENCE_TONE_CHOICES = Object.freeze([
  { value: INFLUENCE_TONE.DIPLOMACY, label: "ACKS-INFLUENCE.tone.diplomacy" },
  { value: INFLUENCE_TONE.INTIMIDATION, label: "ACKS-INFLUENCE.tone.intimidation" },
  { value: INFLUENCE_TONE.SEDUCTION, label: "ACKS-INFLUENCE.tone.seduction" },
]);

/**
 * The attitude ladder, most negative (index 0) to most positive (index 4).
 * Labels (localization keys) differ by tone for the two upper rungs.
 */
export const INFLUENCE_ATTITUDE_LABELS = Object.freeze({
  [INFLUENCE_TONE.DIPLOMACY]: [
    "ACKS-INFLUENCE.attitude.hostile",
    "ACKS-INFLUENCE.attitude.unfriendly",
    "ACKS-INFLUENCE.attitude.neutral",
    "ACKS-INFLUENCE.attitude.indifferent",
    "ACKS-INFLUENCE.attitude.friendly",
  ],
  [INFLUENCE_TONE.INTIMIDATION]: [
    "ACKS-INFLUENCE.attitude.hostile",
    "ACKS-INFLUENCE.attitude.unfriendly",
    "ACKS-INFLUENCE.attitude.neutral",
    "ACKS-INFLUENCE.attitude.intimidated",
    "ACKS-INFLUENCE.attitude.overawed",
  ],
  [INFLUENCE_TONE.SEDUCTION]: [
    "ACKS-INFLUENCE.attitude.hostile",
    "ACKS-INFLUENCE.attitude.unfriendly",
    "ACKS-INFLUENCE.attitude.neutral",
    "ACKS-INFLUENCE.attitude.indifferent",
    "ACKS-INFLUENCE.attitude.friendly",
  ],
});

/** Roll modifier contributed by the target's current attitude. */
export const INFLUENCE_RELATIONSHIP_MOD = Object.freeze([-2, -1, 0, 1, 2]);

/**
 * Reaction bands for a 2d6 (+ modifiers) influence roll.
 * - `initialIndex` is the resulting attitude when establishing an initial reaction.
 * - `shift` is the number of ladder steps moved in CONTINUING mode. The 6-8 band
 *   is special: it always shifts one step *towards* Neutral (index 2).
 */
export const INFLUENCE_BANDS = Object.freeze([
  { key: "2-", min: -Infinity, max: 2, initialIndex: 0, shift: -2, towardNeutral: false },
  { key: "3-5", min: 3, max: 5, initialIndex: 1, shift: -1, towardNeutral: false },
  { key: "6-8", min: 6, max: 8, initialIndex: 2, shift: 0, towardNeutral: true },
  { key: "9-11", min: 9, max: 11, initialIndex: 3, shift: 1, towardNeutral: false },
  { key: "12+", min: 12, max: Infinity, initialIndex: 4, shift: 2, towardNeutral: false },
]);

/** Per-tone descriptive text (localization keys) for each reaction band. */
export const INFLUENCE_BAND_LABELS = Object.freeze({
  [INFLUENCE_TONE.DIPLOMACY]: {
    "2-": "ACKS-INFLUENCE.band.diplomacy.2",
    "3-5": "ACKS-INFLUENCE.band.diplomacy.35",
    "6-8": "ACKS-INFLUENCE.band.diplomacy.68",
    "9-11": "ACKS-INFLUENCE.band.diplomacy.911",
    "12+": "ACKS-INFLUENCE.band.diplomacy.12",
  },
  [INFLUENCE_TONE.INTIMIDATION]: {
    "2-": "ACKS-INFLUENCE.band.intimidation.2",
    "3-5": "ACKS-INFLUENCE.band.intimidation.35",
    "6-8": "ACKS-INFLUENCE.band.intimidation.68",
    "9-11": "ACKS-INFLUENCE.band.intimidation.911",
    "12+": "ACKS-INFLUENCE.band.intimidation.12",
  },
  [INFLUENCE_TONE.SEDUCTION]: {
    "2-": "ACKS-INFLUENCE.band.seduction.2",
    "3-5": "ACKS-INFLUENCE.band.seduction.35",
    "6-8": "ACKS-INFLUENCE.band.seduction.68",
    "9-11": "ACKS-INFLUENCE.band.seduction.911",
    "12+": "ACKS-INFLUENCE.band.seduction.12",
  },
});

/**
 * Attempt levels & their time cost. Level 0 is the initial reaction (instant,
 * which sets the attitude directly); levels 1-5 are attempts to influence that
 * shift the current attitude, from the Judges Journal GM screen.
 */
export const INFLUENCE_TIME_STEPS = Object.freeze([
  { value: 0, label: "ACKS-INFLUENCE.time.0" },
  { value: 1, label: "ACKS-INFLUENCE.time.1" },
  { value: 2, label: "ACKS-INFLUENCE.time.2" },
  { value: 3, label: "ACKS-INFLUENCE.time.3" },
  { value: 4, label: "ACKS-INFLUENCE.time.4" },
  { value: 5, label: "ACKS-INFLUENCE.time.5" },
]);

/**
 * Henchman Monthly Wage by class level (index = level 0-14), in gp. Used to
 * auto-populate the bribe fee from the target's HD/level.
 */
export const HENCHMAN_MONTHLY_WAGE = Object.freeze([
  12, 25, 50, 100, 200, 400, 800, 1600, 3000, 7250, 12000, 32000, 50000, 135000, 350000,
]);

/**
 * Modifier field types:
 * - `check`  : boolean; contributes `value` when checked, else 0.
 * - `select` : mutually-exclusive options; contributes the chosen value.
 * - `signed` : free number input; contributes the value as typed (may be negative).
 * - `factor` : magnitude input; contributes `factor * value`.
 * - `gold`   : a gp amount that does NOT modify the roll (e.g. the bribe fee).
 *
 * `auto` pre-fills a field from the actor/target. Sources resolved in
 * actor-data.mjs: "cha", "targetWill", "alignment", "prof:<name>", "bribeFee".
 * All `label`/`group`/option `label` values are localization keys.
 *
 * `exclusive: "<name>"` marks a set of `check` mods of which at most ONE may be
 * active. The three tone proficiencies are mutually exclusive in RAW (each
 * stacks with Mystic Aura and with nothing else), which on the per-tone pages
 * falls out of the layout — each tone renders only its own. A page that
 * flattens the tones, like the hiring offer, has no such protection, so the
 * rule is modelled here rather than implied by which rows happen to be on
 * screen. Enforced in computeDefaults (auto-population) and in the form
 * handler (manual ticking).
 */

const LAIR_OPTIONS = [
  { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
  { label: "ACKS-INFLUENCE.opt.lairChar", value: 1 },
  { label: "ACKS-INFLUENCE.opt.lairTarget", value: -1 },
];

export const INFLUENCE_MODIFIERS = Object.freeze({
  [INFLUENCE_TONE.DIPLOMACY]: [
    {
      group: "ACKS-INFLUENCE.group.both",
      mods: [
        {
          key: "alignment",
          type: "select",
          label: "ACKS-INFLUENCE.mod.diplomacy.alignment",
          auto: "alignment",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.alignMatch", value: 1 },
            { label: "ACKS-INFLUENCE.opt.alignMismatch", value: -1 },
          ],
        },
        { key: "lair", type: "select", label: "ACKS-INFLUENCE.mod.diplomacy.lair", options: LAIR_OPTIONS },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.either",
      mods: [
        { key: "authority", type: "signed", label: "ACKS-INFLUENCE.mod.diplomacy.authority" },
        { key: "favors", type: "signed", label: "ACKS-INFLUENCE.mod.diplomacy.favors" },
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        {
          key: "bribe",
          type: "select",
          label: "ACKS-INFLUENCE.mod.diplomacy.bribe",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.plus1", value: 1 },
            { label: "ACKS-INFLUENCE.opt.plus2", value: 2 },
            { label: "ACKS-INFLUENCE.opt.plus3", value: 3 },
          ],
        },
        { key: "bribeFee", type: "gold", label: "ACKS-INFLUENCE.mod.diplomacy.bribeFee", auto: "bribeFee", profModifier: "bribery" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        { key: "diplomacyProf", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.prof", value: 1, auto: "prof:diplomacy" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", value: 1, auto: "prof:mysticAura" },
        { key: "brandishing", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.brandishing", value: -1 },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "believesHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.believesHarmed", value: -1 },
        { key: "evidenceHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.evidenceHarmed", value: -2 },
        { key: "personallyHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.personallyHarmed", value: -5 },
      ],
    },
  ],
  [INFLUENCE_TONE.INTIMIDATION]: [
    {
      group: "ACKS-INFLUENCE.group.both",
      mods: [
        {
          key: "outnumber",
          type: "select",
          label: "ACKS-INFLUENCE.mod.intimidation.outnumber",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.outYou1", value: 1 },
            { label: "ACKS-INFLUENCE.opt.outYou2", value: 2 },
            { label: "ACKS-INFLUENCE.opt.outYou3", value: 5 },
            { label: "ACKS-INFLUENCE.opt.outTgt1", value: -1 },
            { label: "ACKS-INFLUENCE.opt.outTgt2", value: -2 },
            { label: "ACKS-INFLUENCE.opt.outTgt3", value: -5 },
          ],
        },
        { key: "lair", type: "select", label: "ACKS-INFLUENCE.mod.intimidation.lair", options: LAIR_OPTIONS },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.either",
      mods: [
        {
          key: "brandishing",
          type: "select",
          label: "ACKS-INFLUENCE.mod.intimidation.weapons",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.weaponChar", value: 1 },
            { label: "ACKS-INFLUENCE.opt.weaponTarget", value: -1 },
          ],
        },
        {
          key: "magicItems",
          type: "select",
          label: "ACKS-INFLUENCE.mod.intimidation.magic",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.magicChar", value: 1 },
            { label: "ACKS-INFLUENCE.opt.magicTarget", value: -1 },
          ],
        },
        { key: "advantage", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.advantage" },
        { key: "authority", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.authority" },
        { key: "levelGap", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.levelGap", auto: "levelGap" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        { key: "intimidationProf", type: "check", label: "ACKS-INFLUENCE.mod.intimidation.prof", value: 1, auto: "prof:intimidation" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", value: 1, auto: "prof:mysticAura" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetMorale", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.intimidation.morale", auto: "targetMorale" },
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "sawFriendsHurt", type: "check", label: "ACKS-INFLUENCE.mod.intimidation.sawFriendsHurt", value: 1 },
        { key: "lossOfFace", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.lossOfFace" },
        { key: "fearsBoss", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.fearsBoss" },
      ],
    },
  ],
  [INFLUENCE_TONE.SEDUCTION]: [
    {
      group: "ACKS-INFLUENCE.group.both",
      mods: [
        { key: "alone", type: "check", label: "ACKS-INFLUENCE.mod.seduction.alone", value: 1 },
        { key: "friendsPresent", type: "check", label: "ACKS-INFLUENCE.mod.seduction.friendsPresent", value: -1 },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.either",
      mods: [
        {
          key: "levelGap",
          type: "select",
          label: "ACKS-INFLUENCE.mod.seduction.levelGap",
          auto: "levelGap",
          options: [
            { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
            { label: "ACKS-INFLUENCE.opt.charHigher", value: 1 },
            { label: "ACKS-INFLUENCE.opt.charLower", value: -1 },
          ],
        },
        // Auto-filled from the Character Aging table (race inferred from class);
        // assumes youthful-mate preference — the GM flips the sign for mature.
        { key: "age", type: "signed", label: "ACKS-INFLUENCE.mod.seduction.age", auto: "age" },
        { key: "appeal", type: "signed", label: "ACKS-INFLUENCE.mod.seduction.appeal" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        { key: "socialStatus", type: "factor", factor: 1, label: "ACKS-INFLUENCE.mod.seduction.socialStatus" },
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        { key: "seductionProf", type: "check", label: "ACKS-INFLUENCE.mod.seduction.prof", value: 1, auto: "prof:seduction" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", value: 1, auto: "prof:mysticAura" },
        { key: "performanceArt", type: "check", label: "ACKS-INFLUENCE.mod.seduction.performanceArt", value: 1, auto: "prof:performanceArt" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "tookAdvantageFriends", type: "check", label: "ACKS-INFLUENCE.mod.seduction.tookAdvantageFriends", value: -1 },
        { key: "tookAdvantageTarget", type: "check", label: "ACKS-INFLUENCE.mod.seduction.tookAdvantageTarget", value: -2 },
        { key: "personalRisk", type: "signed", label: "ACKS-INFLUENCE.mod.seduction.personalRisk" },
      ],
    },
  ],
});

/**
 * EXTERNAL MODES — additional roller pages hosted by the influence app for
 * consumer modules (acks-henchmen): the Reaction to Hiring Offer (RR 162)
 * and the secret Hireling Loyalty roll (RR 166). An external mode replaces
 * the three core tones (the tone selector, attitude ladder, and attempt
 * tracker hide); modifiers reuse the same engine — `auto` sources support
 * "cha", "prof:<name>", and "ctx:<name>" (a value supplied by the caller via
 * api.open(actor, { mode, ctx })). `ctxOptions` selects get their options
 * from the ctx bag. Bands resolve worst→best; naturalClamps pin natural
 * 2 / 12 to a band key (never better / never worse).
 */
export const EXTERNAL_MODES = Object.freeze({
  hiring: {
    label: "ACKS-INFLUENCE.mode.hiring.title",
    secret: false,
    // RR 162's hiring offer IS a reaction roll, so reaction-family effects apply.
    family: ROLL_FAMILY.REACTION,
    bands: [
      { max: 2, key: "refuseSlander" },
      { min: 3, max: 5, key: "refuse" },
      { min: 6, max: 8, key: "tryAgain" },
      { min: 9, max: 11, key: "accept" },
      { min: 12, key: "acceptElan" },
    ],
    bandLabels: {
      refuseSlander: "ACKS-INFLUENCE.mode.hiring.refuseSlander",
      refuse: "ACKS-INFLUENCE.mode.hiring.refuse",
      tryAgain: "ACKS-INFLUENCE.mode.hiring.tryAgain",
      accept: "ACKS-INFLUENCE.mode.hiring.accept",
      acceptElan: "ACKS-INFLUENCE.mode.hiring.acceptElan",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.group.character",
        mods: [
          { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
          // The three tone proficiencies are mutually exclusive (RR): at most
          // one applies, and it stacks only with Mystic Aura. `exclusive` keeps
          // a character who holds all three from opening this page at +4.
          { key: "diplomacyProf", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.prof", value: 1, auto: "prof:diplomacy", exclusive: "toneProf" },
          { key: "intimidationProf", type: "check", label: "ACKS-INFLUENCE.mod.intimidation.prof", value: 1, auto: "prof:intimidation", exclusive: "toneProf" },
          { key: "seductionProf", type: "check", label: "ACKS-INFLUENCE.mod.seduction.prof", value: 1, auto: "prof:seduction", exclusive: "toneProf" },
          { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", value: 1, auto: "prof:mysticAura" },
        ],
      },
      {
        group: "ACKS-INFLUENCE.mode.hiring.terms",
        mods: [
          { key: "signingBonus", type: "select", label: "ACKS-INFLUENCE.mode.hiring.signingBonus", ctxOptions: "signingBonusOptions", default: 0 },
          { key: "previousRefusals", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mode.hiring.previousRefusals", auto: "ctx:previousRefusals" },
          { key: "slander", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mode.hiring.slander", auto: "ctx:slanderCount" },
        ],
      },
    ],
  },
  loyalty: {
    label: "ACKS-INFLUENCE.mode.loyalty.title",
    secret: true,
    // Loyalty-family effects only. A Diplomacy bonus is not a loyalty modifier;
    // Inhumanity is (RAW: "reactions, loyalty, and morale") and reaches this
    // page through its own loyalty change.
    family: ROLL_FAMILY.LOYALTY,
    bands: [
      { max: 2, key: "hostility" },
      { min: 3, max: 5, key: "resignation" },
      { min: 6, max: 8, key: "grudging" },
      { min: 9, max: 11, key: "loyal" },
      { min: 12, key: "fanatic" },
    ],
    naturalClamps: { natural2: "resignation", natural12: "loyal" },
    bandLabels: {
      hostility: "ACKS-INFLUENCE.mode.loyalty.hostility",
      resignation: "ACKS-INFLUENCE.mode.loyalty.resignation",
      grudging: "ACKS-INFLUENCE.mode.loyalty.grudging",
      loyal: "ACKS-INFLUENCE.mode.loyalty.loyal",
      fanatic: "ACKS-INFLUENCE.mode.loyalty.fanatic",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.mode.loyalty.scores",
        mods: [
          { key: "effectiveLoyalty", type: "signed", label: "ACKS-INFLUENCE.mode.loyalty.effective", auto: "ctx:effectiveLoyalty" },
          { key: "apparentLevelDiff", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mode.loyalty.apparentLevel", auto: "ctx:apparentLevelDiff" },
          { key: "judgeAdj", type: "signed", label: "ACKS-INFLUENCE.mode.loyalty.judgeAdj" },
        ],
      },
    ],
  },

  /**
   * Combat morale — the Monster Morale table (RR 307). The Judge's roll for
   * whether monsters and NPCs fight on, at the end of a round in which a third
   * of a group has fallen (and each casualty after), when a solitary creature
   * has lost a third of its hp (and each wound after), or on the first round
   * the party flees.
   *
   * NOT the Unit Morale table (RR 468) — that is the mass-combat scale, it has
   * different outcomes, and it is the one a commander's morale modifier
   * (RR 436: CHA + Command + battlefield prowess) applies to. None of that
   * belongs here; adding it would inflate every encounter morale roll.
   *
   * `subject: "target"` because the creature checking morale is the target of
   * the app, not its actor. PCs never roll this — they always choose.
   */
  morale: {
    label: "ACKS-INFLUENCE.mode.morale.title",
    secret: false,
    family: ROLL_FAMILY.MORALE,
    subject: "target",
    bands: [
      { max: 2, key: "frightenedRetreat" },
      { min: 3, max: 5, key: "faltering" },
      { min: 6, max: 8, key: "fightOn" },
      { min: 9, max: 11, key: "advancePursue" },
      { min: 12, key: "victoryOrDeath" },
    ],
    // RR 307 states no natural-2/12 clamp for this roll, unlike Hireling
    // Loyalty (RR 166). Deliberately absent rather than forgotten.
    bandLabels: {
      frightenedRetreat: "ACKS-INFLUENCE.mode.morale.frightenedRetreat",
      faltering: "ACKS-INFLUENCE.mode.morale.faltering",
      fightOn: "ACKS-INFLUENCE.mode.morale.fightOn",
      advancePursue: "ACKS-INFLUENCE.mode.morale.advancePursue",
      victoryOrDeath: "ACKS-INFLUENCE.mode.morale.victoryOrDeath",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.mode.morale.score",
        mods: [
          { key: "moraleScore", type: "factor", factor: 1, label: "ACKS-INFLUENCE.mode.morale.rating", auto: "targetMorale" },
        ],
      },
      {
        // The book calls these "suggested" modifiers, and each pair is a
        // LADDER, not a sum: two-thirds supersedes one-half, 2:1 supersedes
        // plain outnumbering. Selects rather than checkboxes so they cannot
        // both be ticked.
        group: "ACKS-INFLUENCE.mode.morale.circumstances",
        mods: [
          {
            key: "creatureHp",
            type: "select",
            label: "ACKS-INFLUENCE.mode.morale.creatureHp",
            options: [
              { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
              { label: "ACKS-INFLUENCE.mode.morale.lostHalf", value: -2 },
              { label: "ACKS-INFLUENCE.mode.morale.lostTwoThirds", value: -5 },
            ],
          },
          {
            key: "outnumber",
            type: "select",
            label: "ACKS-INFLUENCE.mode.morale.outnumber",
            options: [
              { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
              { label: "ACKS-INFLUENCE.mode.morale.outnumbers", value: 2 },
              { label: "ACKS-INFLUENCE.mode.morale.outnumbersTwoToOne", value: 5 },
            ],
          },
          {
            key: "groupLosses",
            type: "select",
            label: "ACKS-INFLUENCE.mode.morale.groupLosses",
            options: [
              { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
              { label: "ACKS-INFLUENCE.mode.morale.lostHalf", value: -2 },
              { label: "ACKS-INFLUENCE.mode.morale.lostTwoThirds", value: -5 },
            ],
          },
          { key: "cornered", type: "check", label: "ACKS-INFLUENCE.mode.morale.cornered", value: 5 },
          { key: "judgeAdj", type: "signed", label: "ACKS-INFLUENCE.mode.morale.judgeAdj" },
        ],
      },
    ],
  },

  /**
   * Hireling Obedience (RR 167) — the secret 2d6 + morale check when a hireling
   * is ordered into unexplored wilderness, a new dungeon, notable danger, or
   * overtime. Three bands only, and explicitly NO auto-failure on a natural 2.
   */
  obedience: {
    label: "ACKS-INFLUENCE.mode.obedience.title",
    secret: true,
    family: ROLL_FAMILY.MORALE,
    subject: "target",
    bands: [
      { max: 2, key: "refuses" },
      { min: 3, max: 5, key: "begrudging" },
      { min: 6, key: "compliant" },
    ],
    bandLabels: {
      refuses: "ACKS-INFLUENCE.mode.obedience.refuses",
      begrudging: "ACKS-INFLUENCE.mode.obedience.begrudging",
      compliant: "ACKS-INFLUENCE.mode.obedience.compliant",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.mode.obedience.score",
        mods: [
          // Supplied by the consumer when it tracks a fuller morale record
          // (acks-henchmen's base + permanents); falls back to the sheet.
          { key: "moraleScore", type: "signed", label: "ACKS-INFLUENCE.mode.obedience.morale", auto: "ctx:effectiveMorale" },
        ],
      },
      {
        group: "ACKS-INFLUENCE.mode.obedience.circumstances",
        mods: [
          {
            key: "company",
            type: "select",
            label: "ACKS-INFLUENCE.mode.obedience.company",
            options: [
              { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
              { label: "ACKS-INFLUENCE.mode.obedience.withEmployer", value: 2 },
              { label: "ACKS-INFLUENCE.mode.obedience.withAdventurer", value: 1 },
              { label: "ACKS-INFLUENCE.mode.obedience.alone", value: -1 },
            ],
          },
          { key: "customary", type: "check", label: "ACKS-INFLUENCE.mode.obedience.customary", value: 2 },
          { key: "casualties", type: "check", label: "ACKS-INFLUENCE.mode.obedience.casualties", value: -1 },
          {
            key: "excessRisk",
            type: "select",
            label: "ACKS-INFLUENCE.mode.obedience.excessRisk",
            options: [
              { label: "ACKS-INFLUENCE.opt.dash", value: 0 },
              { label: "ACKS-INFLUENCE.mode.obedience.risk1", value: -1 },
              { label: "ACKS-INFLUENCE.mode.obedience.risk2", value: -2 },
              { label: "ACKS-INFLUENCE.mode.obedience.risk3", value: -5 },
            ],
          },
          { key: "mercenaryAdventure", type: "check", label: "ACKS-INFLUENCE.mode.obedience.mercenaryAdventure", value: -5 },
          { key: "judgeAdj", type: "signed", label: "ACKS-INFLUENCE.mode.obedience.judgeAdj" },
        ],
      },
    ],
  },

  /**
   * The Irrefusable Offer (MM 351-352) — recruiting a monster that has been
   * defeated and captured. A reaction-family roll made by the would-be
   * employer, so the subject is the actor.
   */
  irrefusableOffer: {
    label: "ACKS-INFLUENCE.mode.irrefusable.title",
    secret: false,
    family: ROLL_FAMILY.REACTION,
    subject: "actor",
    bands: [
      { max: 2, key: "betrayal" },
      { min: 3, max: 5, key: "escape" },
      { min: 6, max: 8, key: "hesitate" },
      { min: 9, max: 11, key: "accept" },
      { min: 12, key: "elan" },
    ],
    bandLabels: {
      betrayal: "ACKS-INFLUENCE.mode.irrefusable.betrayal",
      escape: "ACKS-INFLUENCE.mode.irrefusable.escape",
      hesitate: "ACKS-INFLUENCE.mode.irrefusable.hesitate",
      accept: "ACKS-INFLUENCE.mode.irrefusable.accept",
      elan: "ACKS-INFLUENCE.mode.irrefusable.elan",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.group.character",
        mods: [
          { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
          { key: "oppositeAlignment", type: "check", label: "ACKS-INFLUENCE.mode.irrefusable.oppositeAlignment", value: -2 },
          // The monster's own morale mod works AGAINST the offer.
          { key: "monsterMorale", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mode.irrefusable.monsterMorale", auto: "targetMorale" },
        ],
      },
    ],
  },
});
