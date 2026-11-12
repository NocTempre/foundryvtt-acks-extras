/**
 * Static structure for the ACKS II influence rolls: which rows each tone page
 * has (JJ 85-87), grouped by the Both / Either / Character / Target keys of the
 * Judges Journal GM screen, with a two-sided row as a select. No figure is
 * here: each row's figure is read from the `influence` document (`TONE_PAGES`).
 *
 * All user-facing labels are localization keys resolved via game.i18n; see
 * lang/en.json. See acks-rules/acks-influence/ACKS-Reactions-Reference.md for the rules reference.
 */

import { MODULE_ID } from "../lib/constants.mjs";
import { getDoc as getTableDoc, hasDoc as hasTableDoc } from "../lib/tables.mjs";
import { henchmanWage, henchmanWageImported } from "../henchmen/rules/wages.mjs";
export { MODULE_ID };

/** Lang root for this feature's own keys. */
const LANG_PREFIX = "ACKS-INFLUENCE";

/** Ruledata document holding this feature's printed tables, once imported. */
export const INFLUENCE_DOC = "influence";

/** camelCased module id — the namespace custom hooks fire under (TOOLCHAIN §5b). */
const NAMESPACE = "acksExtras";

/** Custom hooks fired by this feature. */
export const HOOKS = Object.freeze({
  // Fired before the roller opens: listeners push {label, value} entries onto
  // the shared `modifiers` array to inject a flat external contribution (a
  // district's reaction figure, a settlement's slander penalty). Sourced from
  // where the party stands, never from the target — see module.mjs.
  INFLUENCE_MODIFIERS: `${NAMESPACE}.influenceModifiers`,
});

/**
 * Active Effect convention: an effect on any item/actor with a change keyed
 * `flags.acks-extras.<family>` contributes a modifier equal to the change
 * value to that family of 2d6 social roll. Effect flags under
 * `flags.acks-extras` tune it:
 *   - situational {boolean} default true  → shown as a GM-toggled checkbox
 *   - tone {"all"|"diplomacy"|"intimidation"|"seduction"} default "all"
 *   - label {string} optional display label (else the effect's name)
 *
 * ONE effect may carry several changes, which is how a rule spanning several
 * roll families (Inhumanity: reactions, loyalty and morale) ships as one
 * effect rather than three items a GM has to keep in sync. Mirrors the lib
 * subsystem's `MODIFIER_TARGETS`.
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

/**
 * Does a throw opened in this mode belong to the REACTION family — the one a
 * reception prices? The gate every `HOOKS.INFLUENCE_MODIFIERS` listener that
 * carries a reception asks, kept here so listeners cannot answer it
 * differently. The bare influence roll (`mode` falsy) counts; an external
 * mode counts only when registered under `EXTERNAL_MODES` as REACTION
 * family. See docs/influence/DECISIONS.md, "An unregistered external mode is
 * excluded, not leaked".
 */
export function isReactionMode(mode) {
  if (!mode) return true;
  return EXTERNAL_MODES[mode]?.family === ROLL_FAMILY.REACTION;
}

/**
 * The rows a roller keeps of what its listeners and its opener pushed, as
 * `{label, value, note}`.
 *
 * A zero row adds nothing and says nothing, so it is dropped: a listener that
 * computed a quarter's figure as 0 has nothing to show. The exception is a
 * NOTE, a row its pusher marked `note: true` to SAY something with no figure
 * beside it (who holds legal authority here). A note never carries a value,
 * so one pushed with a figure is an ordinary row and its mark is ignored. A
 * note about one item keeps its `itemId`, so a page that draws that item as a
 * row of its own can leave the note out.
 * @param {Array<{label?: string, value?: number, note?: boolean, itemId?: string}>} modifiers
 */
export function externalRows(modifiers) {
  if (!Array.isArray(modifiers)) return [];
  return modifiers
    .map((m) => {
      const value = Number(m?.value) || 0;
      const note = m?.note === true && value === 0;
      return {
        label: String(m?.label ?? "external"),
        value,
        note,
        ...(note && m?.itemId ? { itemId: String(m.itemId) } : {}),
      };
    })
    .filter((m) => m.value !== 0 || m.note);
}

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

/**
 * The rungs of a tone page's reaction table, worst first: the structure of the
 * result column and nothing the page prints. The page supplies each rung's
 * roll edges and how many attitudes it shifts (`toneBands` in printed.mjs);
 * what is fixed here is which way a rung moves the ladder.
 * - `initialIndex` is the attitude an initial reaction sets.
 * - `direction` is the way a CONTINUING roll moves the attitude, -1 toward the
 *   hostile end and +1 toward the other. The middle rung moves toward the
 *   ladder's middle (`towardNeutral`) instead.
 */
export const INFLUENCE_RESULTS = Object.freeze([
  { key: "result1", initialIndex: 0, direction: -1, towardNeutral: false },
  { key: "result2", initialIndex: 1, direction: -1, towardNeutral: false },
  { key: "result3", initialIndex: 2, direction: 0, towardNeutral: true },
  { key: "result4", initialIndex: 3, direction: 1, towardNeutral: false },
  { key: "result5", initialIndex: 4, direction: 1, towardNeutral: false },
]);

/** The ladder rung a "toward Neutral" shift settles on. */
export const INFLUENCE_NEUTRAL_INDEX = 2;

/** Per-tone descriptive text (localization keys) for each reaction result. */
export const INFLUENCE_BAND_LABELS = Object.freeze({
  [INFLUENCE_TONE.DIPLOMACY]: {
    result1: "ACKS-INFLUENCE.band.diplomacy.result1",
    result2: "ACKS-INFLUENCE.band.diplomacy.result2",
    result3: "ACKS-INFLUENCE.band.diplomacy.result3",
    result4: "ACKS-INFLUENCE.band.diplomacy.result4",
    result5: "ACKS-INFLUENCE.band.diplomacy.result5",
  },
  [INFLUENCE_TONE.INTIMIDATION]: {
    result1: "ACKS-INFLUENCE.band.intimidation.result1",
    result2: "ACKS-INFLUENCE.band.intimidation.result2",
    result3: "ACKS-INFLUENCE.band.intimidation.result3",
    result4: "ACKS-INFLUENCE.band.intimidation.result4",
    result5: "ACKS-INFLUENCE.band.intimidation.result5",
  },
  [INFLUENCE_TONE.SEDUCTION]: {
    result1: "ACKS-INFLUENCE.band.seduction.result1",
    result2: "ACKS-INFLUENCE.band.seduction.result2",
    result3: "ACKS-INFLUENCE.band.seduction.result3",
    result4: "ACKS-INFLUENCE.band.seduction.result4",
    result5: "ACKS-INFLUENCE.band.seduction.result5",
  },
});

/**
 * The attempt ladder: which attempt this is, and what it costs in time. The
 * rung count and its costs are imported, never shipped (`lib/tables.mjs`,
 * doc `influence`, table `attemptTime`) — see docs/influence/DECISIONS.md,
 * "both were IP leaks and are gone from the shipped artifact". With nothing
 * registered a rung is named by its own ordinal and `maxAttempt` is null.
 *
 * @param {number} attempt which rung the tracker is on now — only consulted
 *   when nothing is registered, to decide how far the ladder can be shown
 * @returns {{steps: Array<{value: number, label: string, time: string}>, maxAttempt: number|null}}
 */
export function influenceTimeLadder(attempt = 0) {
  const rows = hasTableDoc(INFLUENCE_DOC) ? getTableDoc(INFLUENCE_DOC)?.tables?.attemptTime : null;
  const times = Array.isArray(rows) ? rows : null;
  // One rung per printed row when they are known. Otherwise the rungs this
  // tracker can actually be on — the initial reaction, every attempt already
  // made, and the next one — which is read off its own state, never off a page.
  const count = times?.length ?? Math.max(0, Number(attempt) || 0) + 2;
  const steps = Array.from({ length: count }, (_, value) => ({
    value,
    label: value === 0 ? `${LANG_PREFIX}.time.initial` : `${LANG_PREFIX}.time.attempt`,
    time: String(times?.[value]?.time ?? times?.[value] ?? ""),
  }));
  return { steps, maxAttempt: times ? count - 1 : null };
}

/**
 * The monthly wage a henchman of a given level is owed, used to price a bribe
 * from the target's HD. It is the henchmen feature's imported wage ladder
 * (`henchmen/rules/wages.mjs` `henchmanWage`), read whole rather than kept a
 * second time here — see docs/influence/DECISIONS.md, "A bribe is priced off
 * the imported wage and pay-period ladders".
 *
 * @returns {number|null} null when no wage is imported — the fee is then left
 *   for the Judge to name
 */
export function henchmanMonthlyWage(hd) {
  return henchmanWageImported() ? henchmanWage(Math.floor(Number(hd) || 0)) : null;
}

/**
 * Modifier field types:
 * - `check`  : boolean; contributes `value` when checked, else 0.
 * - `select` : mutually-exclusive options; contributes the chosen value.
 * - `signed` : free number input; contributes the value as typed (may be negative).
 * - `factor` : magnitude input; contributes `factor * value`.
 * - `gold`   : a gp amount that does NOT modify the roll (e.g. the bribe fee).
 *
 * A row's figure is the page's, never this file's. A `check` or `factor` row
 * names its figure in `figure`, and a `select` row lists `rungs` (`figure`
 * plus the rung's own `label`, with `rung` naming it for an `autoRung`); each
 * is a key of the tone's table (`TONE_PAGES`), and `toneRows` (printed.mjs)
 * turns them into the rows the roller runs: the figure read, or a disabled
 * row that says it is not imported. A `select` with literal `options` is a
 * tier ladder whose value is the tier's own ordinal.
 *
 * `auto` pre-fills a field from the actor/target. Sources resolved in
 * actor-data.mjs: "cha", "targetWill", "alignment", "levelGap", "age",
 * "socialRank", "targetMorale", "prof:<name>", "bribeFee". `alignment` and
 * `levelGap` answer a direction (1, -1 or 0): a `select` maps it to a rung
 * through `autoRung`, a `signed` row to a figure through `autoFigures`, and
 * `autoThreshold` names the table key holding the gap a level difference
 * must meet. All `label`/`group`/option `label` values are localization keys.
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

/**
 * The lair row's two rungs, one per side of the lair. Each tone page prints
 * both under the same two keys of its own table.
 */
const LAIR_RUNGS = [
  { rung: "lairChar", figure: "lairChar", label: "ACKS-INFLUENCE.opt.lairChar" },
  { rung: "lairTarget", figure: "lairTarget", label: "ACKS-INFLUENCE.opt.lairTarget" },
];

/**
 * The bribe row's three tiers, each worth the bonus the page prints for it
 * (`bribeTiers` of the `influence` document, RR 287). What is stored is the
 * tier's own ordinal, which the henchmen feature prices (`#bribeTiers` in
 * influence-app.mjs), so the row reads whole or not at all (`ordinal`,
 * `complete`) and no label states a bonus.
 */
const BRIBE_RUNGS = [
  { rung: "bribeTier1", figure: "tier1", label: "ACKS-INFLUENCE.opt.bribeTier1" },
  { rung: "bribeTier2", figure: "tier2", label: "ACKS-INFLUENCE.opt.bribeTier2" },
  { rung: "bribeTier3", figure: "tier3", label: "ACKS-INFLUENCE.opt.bribeTier3" },
];

/** The table and page the bribe tiers' bonuses are read from. */
const BRIBE_TABLE = Object.freeze({ table: "bribeTiers", cite: "RR 287" });

/** `autoRung` / `autoFigures` direction keys: the character ahead, the target ahead. */
const DIRECTION = { ahead: "1", behind: "-1" };

/**
 * Where each tone page's printed figures are read from: the `influence`
 * document's tables and the page they cite. `table` holds the page's
 * modifier rows, which the rows below name keys of; `reaction` its result
 * column and how far each result shifts the ladder; `attitude` the modifier
 * for a target already at a rung of the ladder.
 */
export const TONE_PAGES = Object.freeze({
  [INFLUENCE_TONE.DIPLOMACY]: { table: "diplomacyModifiers", reaction: "diplomacyReaction", attitude: "diplomacyAttitude", cite: "JJ 85" },
  [INFLUENCE_TONE.INTIMIDATION]: { table: "intimidationModifiers", reaction: "intimidationReaction", attitude: "intimidationAttitude", cite: "JJ 86" },
  [INFLUENCE_TONE.SEDUCTION]: { table: "seductionModifiers", reaction: "seductionReaction", attitude: "seductionAttitude", cite: "JJ 87" },
});

/** The Character Aging table of the `influence` document, and the page it is read from. */
export const AGING_PAGE = Object.freeze({ table: "characterAging", cite: "RR 19" });

/**
 * The Mystic Aura rider's table: `at` is the roll total that bewitches the
 * subject (RR 115).
 */
export const BEWITCH_PAGE = Object.freeze({ table: "mysticAura", cite: "RR 115" });

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
          autoRung: { [DIRECTION.ahead]: "alignMatch", [DIRECTION.behind]: "alignMismatch" },
          rungs: [
            { rung: "alignMatch", figure: "alignMatch", label: "ACKS-INFLUENCE.opt.alignMatch" },
            { rung: "alignMismatch", figure: "alignMismatch", label: "ACKS-INFLUENCE.opt.alignMismatch" },
          ],
        },
        { key: "lair", type: "select", label: "ACKS-INFLUENCE.mod.diplomacy.lair", rungs: LAIR_RUNGS },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.either",
      mods: [
        { key: "authority", type: "signed", label: "ACKS-INFLUENCE.mod.diplomacy.authority" },
        { key: "favors", type: "signed", label: "ACKS-INFLUENCE.mod.diplomacy.favors" },
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        { key: "bribe", type: "select", label: "ACKS-INFLUENCE.mod.diplomacy.bribe", ...BRIBE_TABLE, complete: true, rungs: BRIBE_RUNGS },
        { key: "bribeFee", type: "gold", label: "ACKS-INFLUENCE.mod.diplomacy.bribeFee", auto: "bribeFee", profModifier: "bribery" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        { key: "diplomacyProf", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.prof", figure: "diplomacyProf", auto: "prof:diplomacy" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", figure: "mysticAura", auto: "prof:mysticAura" },
        { key: "brandishing", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.brandishing", figure: "brandishing" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "believesHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.believesHarmed", figure: "believesHarmed" },
        { key: "evidenceHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.evidenceHarmed", figure: "evidenceHarmed" },
        { key: "personallyHarmed", type: "check", label: "ACKS-INFLUENCE.mod.diplomacy.personallyHarmed", figure: "personallyHarmed" },
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
          // Each rung is worded by the page when the import caught its row
          // (the ratio it names is the page's), else by its own ordinal.
          rungs: [
            { rung: "outnumberYou1", figure: "outnumberYou1", label: "ACKS-INFLUENCE.opt.outYou", n: 1 },
            { rung: "outnumberYou2", figure: "outnumberYou2", label: "ACKS-INFLUENCE.opt.outYou", n: 2 },
            { rung: "outnumberYou3", figure: "outnumberYou3", label: "ACKS-INFLUENCE.opt.outYou", n: 3 },
            { rung: "outnumberTarget1", figure: "outnumberTarget1", label: "ACKS-INFLUENCE.opt.outTgt", n: 1 },
            { rung: "outnumberTarget2", figure: "outnumberTarget2", label: "ACKS-INFLUENCE.opt.outTgt", n: 2 },
            { rung: "outnumberTarget3", figure: "outnumberTarget3", label: "ACKS-INFLUENCE.opt.outTgt", n: 3 },
          ],
        },
        { key: "lair", type: "select", label: "ACKS-INFLUENCE.mod.intimidation.lair", rungs: LAIR_RUNGS },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.either",
      mods: [
        {
          key: "brandishing",
          type: "select",
          label: "ACKS-INFLUENCE.mod.intimidation.weapons",
          rungs: [
            { rung: "weaponChar", figure: "weaponChar", label: "ACKS-INFLUENCE.opt.weaponChar" },
            { rung: "weaponTarget", figure: "weaponTarget", label: "ACKS-INFLUENCE.opt.weaponTarget" },
          ],
        },
        {
          key: "magicItems",
          type: "select",
          label: "ACKS-INFLUENCE.mod.intimidation.magic",
          rungs: [
            { rung: "magicChar", figure: "magicChar", label: "ACKS-INFLUENCE.opt.magicChar" },
            { rung: "magicTarget", figure: "magicTarget", label: "ACKS-INFLUENCE.opt.magicTarget" },
          ],
        },
        { key: "advantage", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.advantage" },
        { key: "authority", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.authority" },
        {
          key: "levelGap",
          type: "signed",
          label: "ACKS-INFLUENCE.mod.intimidation.levelGap",
          auto: "levelGap",
          autoThreshold: "levelGapMin",
          autoFigures: { [DIRECTION.ahead]: "levelGapChar", [DIRECTION.behind]: "levelGapTarget" },
        },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        { key: "intimidationProf", type: "check", label: "ACKS-INFLUENCE.mod.intimidation.prof", figure: "intimidationProf", auto: "prof:intimidation" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", figure: "mysticAura", auto: "prof:mysticAura" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetMorale", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.intimidation.morale", auto: "targetMorale" },
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "sawFriendsHurt", type: "check", label: "ACKS-INFLUENCE.mod.intimidation.sawFriendsHurt", figure: "sawFriendsHurt" },
        { key: "lossOfFace", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.lossOfFace" },
        { key: "fearsBoss", type: "signed", label: "ACKS-INFLUENCE.mod.intimidation.fearsBoss" },
      ],
    },
  ],
  [INFLUENCE_TONE.SEDUCTION]: [
    {
      group: "ACKS-INFLUENCE.group.both",
      mods: [
        { key: "alone", type: "check", label: "ACKS-INFLUENCE.mod.seduction.alone", figure: "alone" },
        { key: "friendsPresent", type: "check", label: "ACKS-INFLUENCE.mod.seduction.friendsPresent", figure: "friendsPresent" },
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
          autoThreshold: "levelGapMin",
          autoRung: { [DIRECTION.ahead]: "levelGapHigh", [DIRECTION.behind]: "levelGapLow" },
          rungs: [
            { rung: "levelGapHigh", figure: "levelGapHigh", label: "ACKS-INFLUENCE.opt.charHigher" },
            { rung: "levelGapLow", figure: "levelGapLow", label: "ACKS-INFLUENCE.opt.charLower" },
          ],
        },
        // Auto-filled with the age categories between the two (race inferred
        // from class), counted as for a target who prefers youthful mates: the
        // GM flips the sign for a mature preference. Each category is worth
        // the page's figure.
        { key: "age", type: "factor", figure: "agePerCategory", label: "ACKS-INFLUENCE.mod.seduction.age", auto: "age" },
        { key: "appeal", type: "signed", label: "ACKS-INFLUENCE.mod.seduction.appeal" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.character",
      mods: [
        // Auto-filled with the rungs the character stands above the target
        // when both ranks are known (henchmen `facts.getSocialRank`), each
        // worth the page's figure.
        { key: "socialStatus", type: "factor", figure: "socialPerRank", label: "ACKS-INFLUENCE.mod.seduction.socialStatus", auto: "socialRank" },
        { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
        { key: "seductionProf", type: "check", label: "ACKS-INFLUENCE.mod.seduction.prof", figure: "seductionProf", auto: "prof:seduction" },
        { key: "mysticAura", type: "check", label: "ACKS-INFLUENCE.mod.mysticAura", figure: "mysticAura", auto: "prof:mysticAura" },
        { key: "performanceArt", type: "check", label: "ACKS-INFLUENCE.mod.seduction.performanceArt", figure: "performanceArt", auto: "prof:performanceArt" },
      ],
    },
    {
      group: "ACKS-INFLUENCE.group.target",
      mods: [
        { key: "targetWill", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mod.targetWill", auto: "targetWill" },
        { key: "tookAdvantageFriends", type: "check", label: "ACKS-INFLUENCE.mod.seduction.tookAdvantageFriends", figure: "tookAdvantageFriends" },
        { key: "tookAdvantageTarget", type: "check", label: "ACKS-INFLUENCE.mod.seduction.tookAdvantageTarget", figure: "tookAdvantageTarget" },
        { key: "personalRisk", type: "signed", label: "ACKS-INFLUENCE.mod.seduction.personalRisk" },
      ],
    },
  ],
});

/**
 * The tone proficiencies a page lets the roller bring to one throw, each worth
 * what the roller's own item for it carries (`held`). The three tones are
 * mutually exclusive: at most one applies, and it stacks only with Mystic
 * Aura. `exclusive` keeps a character who holds all three from opening a page
 * with every one of them ticked.
 */
const TONE_PROFICIENCY_ROWS = Object.freeze([
  { key: "diplomacyProf", type: "held", label: "ACKS-INFLUENCE.mod.held.diplomacy", auto: "prof:diplomacy", exclusive: "toneProf" },
  { key: "intimidationProf", type: "held", label: "ACKS-INFLUENCE.mod.held.intimidation", auto: "prof:intimidation", exclusive: "toneProf" },
  { key: "seductionProf", type: "held", label: "ACKS-INFLUENCE.mod.held.seduction", auto: "prof:seduction", exclusive: "toneProf" },
  { key: "mysticAura", type: "held", label: "ACKS-INFLUENCE.mod.held.mysticAura", auto: "prof:mysticAura" },
]);

/**
 * EXTERNAL MODES — additional roller pages hosted by the influence app for
 * consumer features (the henchmen feature): the Reaction to Hiring Offer (RR 162)
 * and the secret Hireling Loyalty roll (RR 166). An external mode replaces
 * the three core tones (the tone selector, attitude ladder, and attempt
 * tracker hide); modifiers reuse the same engine — `auto` sources support
 * "cha", "prof:<name>", and "ctx:<name>" (a value supplied by the caller via
 * api.open(actor, { mode, ctx })). `ctxOptions` selects get their options
 * from the ctx bag. Bands resolve worst→best; naturalClamps pin natural
 * 2 / 12 to a band key (never better / never worse).
 *
 * A mode naming a `printed` table ships no figure of its own: `bandKeys` names
 * its result rungs worst first and the page supplies their edges, and its
 * `ladder` / `printed` / `printedFactor` rows take their figures from the same
 * table (`modeRows` in printed.mjs), read from the `printedDoc` document
 * (`morale` when unnamed). A row naming its own `printed` / `printedDoc`
 * reads that table instead, on a mode that names none or another. `cite` is
 * the page a notice points at.
 * `postsWithoutBands` lets such a page roll with no result column read; any
 * other page refuses.
 *
 * A `held` row is a proficiency box worth the figure the roller's own item for
 * it carries (`resolveHeldRows` in actor-data.mjs): it appears only for a
 * roller who holds the proficiency, or a power standing in for it.
 *
 * An opener may hand the page effect rows of its own in `ctx.offeredModifiers`
 * (`offeredEffectRows` in actor-data.mjs), for effects this feature's change
 * keys do not carry; they join the page's own effect rows.
 *
 * `conditions` names the roll the page is in the lib's conditions model
 * (`rollMath` in lib/conditions.mjs); the subject's conditions then reach the
 * page as rows (condition-rows.mjs).
 */
export const EXTERNAL_MODES = Object.freeze({
  hiring: {
    label: "ACKS-INFLUENCE.mode.hiring.title",
    secret: false,
    // RR 162's hiring offer IS a reaction roll, so reaction-family effects apply.
    family: ROLL_FAMILY.REACTION,
    // Structure only: the result edges and both penalties are the page's, and
    // a page whose column is not imported cannot roll, since a hire needs a
    // result to apply.
    printed: "hiringOffer",
    printedDoc: INFLUENCE_DOC,
    cite: "RR 162",
    bandKeys: ["refuseSlander", "refuse", "tryAgain", "accept", "acceptElan"],
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
          ...TONE_PROFICIENCY_ROWS,
        ],
      },
      {
        group: "ACKS-INFLUENCE.mode.hiring.terms",
        mods: [
          { key: "signingBonus", type: "select", label: "ACKS-INFLUENCE.mode.hiring.signingBonus", ctxOptions: "signingBonusOptions", default: 0 },
          { key: "previousRefusals", type: "printedFactor", figure: "refusalPenalty", label: "ACKS-INFLUENCE.mode.hiring.previousRefusals", auto: "ctx:previousRefusals" },
          { key: "slander", type: "printedFactor", figure: "slanderPenalty", label: "ACKS-INFLUENCE.mode.hiring.slander", auto: "ctx:slanderCount" },
        ],
      },
    ],
  },
  loyalty: {
    label: "ACKS-INFLUENCE.mode.loyalty.title",
    secret: true,
    // Loyalty-family effects only. A Diplomacy bonus is not a loyalty modifier;
    // Inhumanity is, and reaches this page through its own loyalty change.
    family: ROLL_FAMILY.LOYALTY,
    // Structure only: the result edges are the page's (RR 166). Unread, the
    // roll posts its total and names no result; the consumer then applies none.
    printed: "hirelingLoyalty",
    printedDoc: INFLUENCE_DOC,
    cite: "RR 166",
    postsWithoutBands: true,
    bandKeys: ["hostility", "resignation", "grudging", "loyal", "fanatic"],
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
          // The page's one printed figure (RR 168), owed per level counted.
          {
            key: "apparentLevelDiff", type: "printedFactor", printed: "apparentLevel", printedDoc: INFLUENCE_DOC, figure: "perLevel",
            label: "ACKS-INFLUENCE.mode.loyalty.apparentLevel", auto: "ctx:apparentLevelDiff",
          },
          { key: "judgeAdj", type: "signed", label: "ACKS-INFLUENCE.mode.loyalty.judgeAdj" },
        ],
      },
    ],
  },

  /**
   * Combat morale — the Monster Morale table (RR 307): the roll for whether
   * monsters, NPCs, hirelings and hired units fight on. Not the Unit Morale
   * table (RR 468) — see docs/influence/DECISIONS.md, "Three morale
   * subsystems, never conflated".
   *
   * `subject: "target"`: the creature checking morale is the target of the
   * app, not its actor. PCs never roll this — they choose.
   *
   * Structure only. The result edges and every modifier's figure are the
   * page's (`printed`, read through printed.mjs); a page not imported leaves
   * typed fields and a roll that names no result (`postsWithoutBands`).
   */
  morale: {
    label: "ACKS-INFLUENCE.mode.morale.title",
    secret: false,
    family: ROLL_FAMILY.MORALE,
    subject: "target",
    printed: "monsterMorale",
    cite: "RR 307",
    postsWithoutBands: true,
    conditions: "morale",
    // RR 307 states no natural-2/12 clamp for this roll, unlike Hireling
    // Loyalty (RR 166). Deliberately absent rather than forgotten.
    bandKeys: ["frightenedRetreat", "faltering", "fightOn", "advancePursue", "victoryOrDeath"],
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
        // Three of the page's rows come in pairs that are LADDERS, not sums:
        // the greater rung supersedes the lesser, so each is one choice.
        group: "ACKS-INFLUENCE.mode.morale.circumstances",
        mods: [
          { key: "creatureHp", type: "ladder", label: "ACKS-INFLUENCE.mode.morale.creatureHp", rungs: ["hpLost1", "hpLost2"] },
          { key: "outnumber", type: "ladder", label: "ACKS-INFLUENCE.mode.morale.outnumber", rungs: ["outnumber1", "outnumber2"] },
          { key: "groupLosses", type: "ladder", label: "ACKS-INFLUENCE.mode.morale.groupLosses", rungs: ["groupLost1", "groupLost2"] },
          { key: "cornered", type: "printed", label: "ACKS-INFLUENCE.mode.morale.cornered", figure: "noRetreat" },
          { key: "judgeAdj", type: "signed", label: "ACKS-INFLUENCE.mode.morale.judgeAdj" },
        ],
      },
    ],
  },

  /**
   * Assessment of Supply and Demand (RR §VIII.6, "Assessing Supply and
   * Demand") — the markets feature's page: the Judge's secret 2d6 + Charisma
   * for a trader's dedicated day in a market, taken as a reaction throw so a
   * tone proficiency, Mystic Aura, a bribe (RR 287, "Offering Bribes") and
   * reaction-family effects apply. The five bands are a printed table the
   * opener hands over in `ctx.bands` (`{min, max, key}`, worst first), never a
   * table of this file; a page opened without one cannot roll. The bribe fee is
   * priced by `ctx.bribeBasisHd` when the target actor (a market location) has
   * no hit dice of its own; the opener moves the gold, this page only prices it.
   */
  marketAssessment: {
    label: "ACKS-INFLUENCE.mode.assessment.title",
    secret: true,
    family: ROLL_FAMILY.REACTION,
    bands: "ctx",
    bandLabels: {
      false: "ACKS-INFLUENCE.mode.assessment.false",
      failed: "ACKS-INFLUENCE.mode.assessment.failed",
      expertise: "ACKS-INFLUENCE.mode.assessment.expertise",
      partial: "ACKS-INFLUENCE.mode.assessment.partial",
      success: "ACKS-INFLUENCE.mode.assessment.success",
    },
    groups: [
      {
        group: "ACKS-INFLUENCE.group.character",
        mods: [
          { key: "charisma", type: "signed", label: "ACKS-INFLUENCE.mod.charisma", auto: "cha" },
          ...TONE_PROFICIENCY_ROWS,
        ],
      },
      {
        group: "ACKS-INFLUENCE.mode.assessment.bribe",
        mods: [
          {
            key: "bribe", type: "ladder", ordinal: true, label: "ACKS-INFLUENCE.mod.diplomacy.bribe",
            printed: BRIBE_TABLE.table, printedDoc: INFLUENCE_DOC, cite: BRIBE_TABLE.cite, rungs: BRIBE_RUNGS,
          },
          { key: "bribeFee", type: "gold", label: "ACKS-INFLUENCE.mod.diplomacy.bribeFee", auto: "bribeFee", profModifier: "bribery" },
        ],
      },
    ],
  },

  /**
   * Hireling Obedience (RR 167) — the secret 2d6 + morale check on an order a
   * hireling may balk at. Three result rungs, and explicitly NO auto-failure
   * on a natural 2. Structure only, as the `morale` page: edges and figures
   * are the page's, and unread the roll posts its total with no result named,
   * which leaves the refusal's consequence to the Judge.
   */
  obedience: {
    label: "ACKS-INFLUENCE.mode.obedience.title",
    secret: true,
    family: ROLL_FAMILY.MORALE,
    subject: "target",
    printed: "hirelingObedience",
    cite: "RR 167",
    postsWithoutBands: true,
    bandKeys: ["refuses", "begrudging", "compliant"],
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
          // (the henchmen feature's base + permanents); falls back to the sheet.
          { key: "moraleScore", type: "signed", label: "ACKS-INFLUENCE.mode.obedience.morale", auto: "ctx:effectiveMorale" },
        ],
      },
      {
        group: "ACKS-INFLUENCE.mode.obedience.circumstances",
        mods: [
          // Who shares the task and how much risk it carries are each one
          // choice among the page's rungs; the rest apply or do not.
          {
            key: "company",
            type: "ladder",
            label: "ACKS-INFLUENCE.mode.obedience.company",
            rungs: ["company1", "company2", "company3", "company4"],
          },
          { key: "customary", type: "printed", label: "ACKS-INFLUENCE.mode.obedience.customary", figure: "customary" },
          { key: "casualties", type: "printed", label: "ACKS-INFLUENCE.mode.obedience.casualties", figure: "casualties" },
          {
            key: "excessRisk",
            type: "ladder",
            label: "ACKS-INFLUENCE.mode.obedience.excessRisk",
            rungs: ["risk1", "risk2", "risk3", "risk4"],
          },
          { key: "mercenaryAdventure", type: "printed", label: "ACKS-INFLUENCE.mode.obedience.mercenaryAdventure", figure: "mercenary" },
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
    // Structure only: the result edges and the opposite-alignment figure are
    // the page's (MM 351). Unread, the roll posts its total and names no result.
    printed: "irrefusableOffer",
    printedDoc: INFLUENCE_DOC,
    cite: "MM 351",
    postsWithoutBands: true,
    bandKeys: ["betrayal", "escape", "hesitate", "accept", "elan"],
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
          { key: "oppositeAlignment", type: "printed", label: "ACKS-INFLUENCE.mode.irrefusable.oppositeAlignment", figure: "oppositeAlignment" },
          // The monster's own morale mod works AGAINST the offer.
          { key: "monsterMorale", type: "factor", factor: -1, label: "ACKS-INFLUENCE.mode.irrefusable.monsterMorale", auto: "targetMorale" },
        ],
      },
    ],
  },
});
