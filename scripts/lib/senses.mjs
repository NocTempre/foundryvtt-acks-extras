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
import { DETECTION_MODES, VISION_MODES } from "./perception.mjs";

/** Re-exported so callers name a mode from the file that produced the profile. */
export { VISION_MODES, DETECTION_MODES };

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
 * How far Night Vision carries indoors: TWICE the range of the light it is
 * seeing by (MM §5 — "moonlight → daylight; indoors 2× light range; not total
 * dark"). It is a multiplier on someone else's torch, never a radius of its
 * own, which is what keeps the last clause true: no light reaching the creature
 * means nothing to double, and the sense goes dark with the room.
 */
const NIGHT_LIGHT_FACTOR = 2;

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
 * Can this actor operate without light? One reading of the sheet, shared with
 * token vision — a creature blind to the movement rules and sighted on canvas
 * (or the reverse) is the bug this file exists to prevent. A sense a condition
 * has switched off does not count, so a deafened thief moves at the blinded
 * ⅓ speed exactly as the canvas shows them seeing nothing.
 */
export function canSeeInDark(actor) {
  return actor ? senseProfile(actor).seesInDark : false;
}

/* -------------------------------------------- */
/*  Foundry vision                              */
/* -------------------------------------------- */

/**
 * The senses a creature can be suppressed out of, by condition.
 *
 * Shadowy senses are the conditional one (RULES §4: not at running speed, while
 * deafened, or in magical silence). Magical DARKNESS also stops them, but that
 * is a property of where the creature is standing rather than of the creature,
 * so it is enforced per-test in `perception.mjs` instead of here.
 */
const SHADOWY_SUPPRESSORS = ["deaf", "silence", `${MONSTERS_ID}.running`];

/** Status ids currently on an actor, as a Set (empty for a plain object). */
function statusesOf(actor) {
  const statuses = actor?.statuses;
  if (statuses instanceof Set) return statuses;
  return new Set(Array.isArray(statuses) ? statuses : []);
}

/**
 * Which detection mode carries each ACKS sense, and which vision mode it looks
 * like. `perception.mjs` defines what those modes actually DO.
 */
const SENSE_MODES = Object.freeze({
  lightless: { detect: DETECTION_MODES.LIGHTLESS, vision: VISION_MODES.LIGHTLESS },
  shadowy: { detect: DETECTION_MODES.SHADOWY, vision: VISION_MODES.SHADOWY },
  echolocation: { detect: DETECTION_MODES.ECHOLOCATION, vision: VISION_MODES.ECHOLOCATION },
  mechTerrestrial: { detect: DETECTION_MODES.TREMOR, vision: VISION_MODES.ECHOLOCATION },
  mechAerial: { detect: DETECTION_MODES.MECHANORECEPTION, vision: VISION_MODES.ECHOLOCATION },
  mechAquatic: { detect: DETECTION_MODES.MECHANORECEPTION, vision: VISION_MODES.ECHOLOCATION },
  mechWebbed: { detect: DETECTION_MODES.MECHANORECEPTION, vision: VISION_MODES.ECHOLOCATION },
});

/** Every sense this actor has, as `[{ key, range }]`, longest first. */
function sensesOf(actor) {
  const found = [];
  const extras = getMonsterExtras(actor);
  if (extras && hasSenseData(extras)) {
    for (const mode of Array.from(extras.vision ?? [])) {
      if (mode === "lightless") found.push({ key: "lightless", range: Number(extras.lightlessRange) || DEFAULT_LIGHTLESS_RANGE });
    }
    for (const sense of extras.otherSenses ?? []) {
      if (DARK_SENSES.has(sense?.type)) found.push({ key: sense.type, range: Number(sense.range) || DEFAULT_LIGHTLESS_RANGE });
    }
    // Blind with nothing else recorded still navigates — it simply has no
    // number on its sheet, which is not the same as being helpless.
    if (!found.length && Array.from(extras.vision ?? []).includes("blind")) {
      found.push({ key: "shadowy", range: DEFAULT_BLIND_RANGE });
    }
    return found.sort((a, b) => b.range - a.range);
  }

  // No stat block: the capability register, then names.
  //
  // SHADOWY SENSES ARE ASKED FIRST, because the capability does not settle the
  // range. Shadowy Senses `provides: kw:lightlessvision` — correctly, so that a
  // prerequisite written against lightless vision is satisfied by a thief who
  // has it — but that is a claim about what the sense COUNTS AS, not about how
  // far it reaches. Read as a lightless source it granted the monsters' 60'
  // default, so a thief saw twice what RR §4 allows, through a sense that
  // deafness, silence and running do not switch off. Both halves were wrong.
  //
  // A capability alone therefore never outranks a shadowy sense. Naming
  // lightless vision outright still does: an elf with real infravision AND
  // thief training has both senses, at their own ranges, and looks through the
  // longer one.
  const shadowy = matchesByName(actor, SHADOWY_PATTERN);
  if (shadowy) found.push({ key: "shadowy", range: SHADOWY_SENSE_RANGE });
  if (matchesByName(actor, LIGHTLESS_PATTERN) || (!shadowy && hasCapability(actor, CAP_LIGHTLESS))) {
    found.push({ key: "lightless", range: DEFAULT_LIGHTLESS_RANGE });
  }
  return found.sort((a, b) => b.range - a.range);
}

/** Is this sense switched off by a condition the creature is currently under? */
function suppressed(key, statuses) {
  if (key !== "shadowy") return false;
  return SHADOWY_SUPPRESSORS.some((s) => statuses.has(s));
}

/** Does this creature's stat block record Night Vision? */
export function hasNightVision(actor) {
  return Array.from(getMonsterExtras(actor)?.vision ?? []).includes("night");
}

/**
 * How this actor's token should perceive:
 * `{ seesInDark, sightRange, visionMode, detection, suppressed }`.
 *
 * `sightRange` is in scene units (feet) and means seeing the SURROUNDINGS in
 * darkness — 0 is the correct, common answer, leaving the token to see lit areas
 * only. `detection` is the `{modeId: range}` record of which creatures it can
 * find and how: a sense is not merely a radius, and modelling one as plain sight
 * would let invisibility beat echolocation and stop tremor at a wall.
 *
 * A creature with several senses looks through its longest, and detects with all
 * of them at their own ranges.
 *
 * @param {object} [context]
 * @param {number} [context.litBy] the bright radius, in scene units, of the
 *   strongest light reaching this creature — the number Night Vision doubles.
 *   Only that sense reads it; every other answer here is a property of the
 *   sheet alone. Omitted (0) it yields the total-dark reading, which is the
 *   right answer for any caller asking about the creature rather than a square.
 */
export function senseProfile(actor, { litBy = 0 } = {}) {
  const statuses = statusesOf(actor);
  const senses = sensesOf(actor);
  const live = senses.filter((s) => !suppressed(s.key, statuses));

  const detection = {};
  for (const { key, range } of live) {
    const mode = SENSE_MODES[key]?.detect;
    if (mode) detection[mode] = Math.max(detection[mode] ?? 0, range);
  }

  if (!live.length) {
    // Night Vision is the one LIGHT-BASED sense: it doubles the reach of
    // whatever is burning nearby and grants nothing of its own, so an unlit
    // room leaves it at 0 and the creature is as blind as anyone else. Reported
    // as seesInDark FALSE regardless — that flag asks whether the creature can
    // march without a light at all, and this one cannot.
    const night = hasNightVision(actor);
    return {
      seesInDark: false,
      sightRange: night ? NIGHT_LIGHT_FACTOR * litBy : 0,
      visionMode: night ? VISION_MODES.NIGHT : VISION_MODES.BASIC,
      detection,
      suppressed: senses.length > 0,
    };
  }

  const best = live[0];
  return {
    seesInDark: true,
    sightRange: best.range,
    visionMode: SENSE_MODES[best.key]?.vision ?? VISION_MODES.LIGHTLESS,
    detection,
    suppressed: false,
  };
}
