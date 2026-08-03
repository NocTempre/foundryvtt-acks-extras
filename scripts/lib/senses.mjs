/**
 * What a creature can PERCEIVE — the one place ACKS senses are read, and the
 * one place they become Foundry token vision.
 *
 * Two questions are asked of this file. "Can this actor act in the dark?" is a
 * rules question the formation asks when it computes party speed and warns about
 * blinded members. "What should this token's sight be?" is the Foundry question
 * `token-sync.mjs` asks. Both are answered from the same reading of the sheet,
 * so a creature can never be blind to the movement rules and sighted on canvas.
 *
 * Sources, in precedence order:
 *   1. the Full Monster Sheet stat block (`flags["acks-extras"].extras`), read
 *      raw so this stays independent of feature load order;
 *   2. a `kw:lightlessvision` capability from the abilities register;
 *   3. item / active-effect NAMES, for hand-made abilities that declare nothing.
 *
 * ## Foundry mapping
 *
 * In Foundry, `sight.range` is what a token sees *in darkness* — core derives
 * `basicSight` (darkvision) at that range and `lightPerception` at infinity
 * (`client/documents/token.mjs:541-542`), so a token with range 0 still sees
 * everything the torches light and nothing they do not. That makes range 0 the
 * correct configuration for an ordinary human, and the reason this pass matters:
 * the system's own monster packs ship every creature at `sight.range: 60`, which
 * hands a peasant and a bugbear the same dark sight.
 *
 * Because core derives the detection modes from `sight`, nothing here writes
 * `detectionModes` — one less field to clobber on a GM's hand-tuned token.
 *
 * Dark senses render as `monochromatic`, never `darkvision`: core's darkvision
 * mode promotes DIM to BRIGHT, which would let a creature read a scroll in a
 * lightless corridor. Both ACKS senses explicitly see only "as dim light", and
 * dim light cannot discern colours or read (RULES §4).
 */

import { hasCapability } from "./capabilities.mjs";

/** The monsters feature's flag scope, holding the `MonsterExtras` stat block. */
const MONSTERS_ID = "acks-extras";
const FLAG_EXTRAS = "extras";

/** Sight without light, as a capability token (see `capabilities.mjs`). */
const CAP_LIGHTLESS = "kw:lightlessvision";

/**
 * Vision modes that let a creature move in TOTAL darkness (MM Overview
 * pp. 12–13):
 *   - lightless: sight in darkness to a range, counts as dim light;
 *   - blind: never relies on light (navigates by other senses).
 * Night Vision is deliberately excluded — it upgrades dim light but does NOT
 * function in total dark, so it must not be treated as dark sight.
 */
const DARK_VISION = new Set(["lightless", "blind"]);

/**
 * Non-visual senses that substitute for sight in darkness (their "sight" counts
 * as dim light, MM p. 13): echolocation and the mechanoreception family. Acute
 * hearing/olfaction only aid surprise, so they do NOT count.
 */
const DARK_SENSES = new Set(["echolocation", "mechAerial", "mechAquatic", "mechTerrestrial", "mechWebbed"]);

/**
 * Name matchers for actors with no stat block and no declared capability.
 *
 * Split by RANGE, because the two ACKS senses do not reach equally far: a
 * thief's shadowy senses read 30', while lightless vision is the monsters'
 * default at 60'. A single combined pattern cannot tell them apart and would
 * have to guess one range for both.
 */
const SHADOWY_PATTERN = /shadowy\s*sense/i;
const LIGHTLESS_PATTERN = /lightless\s*vision|infravision|darkvision|dark\s*sight/i;

/** Either dark sense, by name — the union both callers of the old pattern used. */
export const DARK_SENSE_PATTERN = new RegExp(`${SHADOWY_PATTERN.source}|${LIGHTLESS_PATTERN.source}`, "i");

/** Shadowy senses "see" as a dim-light source in a 30' radius (RULES §4). */
export const SHADOWY_SENSE_RANGE = 30;

/** The MM's own default for a creature whose stat block records no range. */
export const DEFAULT_LIGHTLESS_RANGE = 60;

/**
 * What an inherently blind creature perceives when its stat block records no
 * ranged sense at all. Such a creature navigates perfectly well — it simply has
 * no number on its sheet — so it gets the shadowy radius rather than nothing.
 */
const DEFAULT_BLIND_RANGE = SHADOWY_SENSE_RANGE;

/* -------------------------------------------- */
/*  Reading the sheet                           */
/* -------------------------------------------- */

/**
 * The monster's extended stat block, or null if it has no Full Monster Sheet.
 * Reads the flag off the document and touches nothing else global, so this file
 * stays importable by the offline tests.
 */
export function getMonsterExtras(actor) {
  const extras = actor?.getFlag?.(MONSTERS_ID, FLAG_EXTRAS);
  if (!extras || typeof extras !== "object") return null;
  return Object.keys(extras).length ? extras : null;
}

/** True if the actor carries any structured senses/vision data. */
function hasSenseData(extras) {
  return Array.from(extras?.vision ?? []).length > 0 || (extras?.otherSenses ?? []).length > 0;
}

/**
 * Whether a monster can operate in total darkness, read from its vision modes
 * and special senses. Returns:
 *   - true / false when the stat block records vision or senses (authoritative);
 *   - null when there is nothing to read, so the caller keeps its own heuristic.
 */
export function monsterSeesInDark(actor) {
  const extras = getMonsterExtras(actor);
  if (!extras || !hasSenseData(extras)) return null;
  for (const mode of Array.from(extras.vision ?? [])) {
    if (DARK_VISION.has(mode)) return true;
  }
  for (const sense of extras.otherSenses ?? []) {
    if (DARK_SENSES.has(sense?.type)) return true;
  }
  return false;
}

/** Does any item or enabled effect on this actor match `pattern` by name? */
function matchesByName(actor, pattern) {
  if (actor?.items?.some?.((i) => pattern.test(i.name))) return true;
  const effects = typeof actor?.allApplicableEffects === "function" ? actor.allApplicableEffects() : actor?.effects;
  for (const effect of effects ?? []) {
    if (!effect.disabled && pattern.test(effect.name)) return true;
  }
  return false;
}

/**
 * Can this actor operate without light (shadowy senses, lightless vision,
 * spell)? Monsters with a Full Monster Sheet answer from their recorded vision
 * modes and senses; other actors fall back to capability then name matching.
 */
export function canSeeInDark(actor) {
  if (!actor) return false;
  const monster = monsterSeesInDark(actor);
  if (monster !== null) return monster;
  if (hasCapability(actor, CAP_LIGHTLESS)) return true;
  return matchesByName(actor, DARK_SENSE_PATTERN);
}

/* -------------------------------------------- */
/*  Foundry vision                              */
/* -------------------------------------------- */

/** Foundry vision modes this module assigns (`CONFIG.Canvas.visionModes`). */
export const VISION_MODES = Object.freeze({
  /** Ordinary eyes: sees what is lit, and nothing else. */
  BASIC: "basic",
  /** Sight in darkness that reads as dim light — colourless, no fine detail. */
  DIM: "monochromatic",
  /** Night Vision: dim reads as bright, but total dark stays dark. */
  AMPLIFIED: "lightAmplification",
});

/** Every dark-sense range this actor's stat block records, in feet. */
function statBlockRanges(extras) {
  const ranges = [];
  for (const mode of Array.from(extras.vision ?? [])) {
    if (mode === "lightless") ranges.push(Number(extras.lightlessRange) || DEFAULT_LIGHTLESS_RANGE);
  }
  for (const sense of extras.otherSenses ?? []) {
    if (DARK_SENSES.has(sense?.type)) ranges.push(Number(sense.range) || DEFAULT_LIGHTLESS_RANGE);
  }
  return ranges;
}

/**
 * How this actor's token should see: `{ seesInDark, sightRange, visionMode }`.
 *
 * `sightRange` is in scene distance units (feet) and means sight in DARKNESS —
 * 0 is the correct, common answer, and leaves the token seeing lit areas only.
 * A creature with several dark senses uses its longest; one that is blind with
 * no recorded range still navigates, at {@link DEFAULT_BLIND_RANGE}.
 */
export function senseProfile(actor) {
  const dim = (sightRange) => ({ seesInDark: true, sightRange, visionMode: VISION_MODES.DIM });

  const extras = getMonsterExtras(actor);
  if (extras && hasSenseData(extras)) {
    const vision = Array.from(extras.vision ?? []);
    const ranges = statBlockRanges(extras);
    if (ranges.length) return dim(Math.max(...ranges));
    if (vision.includes("blind")) return dim(DEFAULT_BLIND_RANGE);
    if (vision.includes("night")) {
      return { seesInDark: false, sightRange: 0, visionMode: VISION_MODES.AMPLIFIED };
    }
    return { seesInDark: false, sightRange: 0, visionMode: VISION_MODES.BASIC };
  }

  // No stat block: the capability register, then names. Lightless vision
  // outranges shadowy senses, so an actor with both uses the longer.
  if (hasCapability(actor, CAP_LIGHTLESS) || matchesByName(actor, LIGHTLESS_PATTERN)) {
    return dim(DEFAULT_LIGHTLESS_RANGE);
  }
  if (matchesByName(actor, SHADOWY_PATTERN)) return dim(SHADOWY_SENSE_RANGE);
  return { seesInDark: false, sightRange: 0, visionMode: VISION_MODES.BASIC };
}
