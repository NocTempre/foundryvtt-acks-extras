/* global game */

/**
 * Writing an actor's senses and carried light onto its TOKEN.
 *
 * `senses.mjs` decides what a creature perceives and `light.mjs` decides how
 * brightly it burns; this file is the only thing that puts either on canvas.
 * Both writes are guarded so a Judge's hand edit is never clobbered: a light is
 * cleared only if the module set it (`managedLight`), and each write stamps what
 * it wrote (`managedLightStamp`, `managedVision`) and hands the token back for
 * good once the stored value no longer matches. A token with `sight.enabled`
 * false is scenery and stays scenery. See docs/lib/MODEL.md, "Perception:
 * senses, light, and the token".
 *
 * Every radius this module computes is in FEET; Foundry reads a token's light,
 * sight and detection ranges in the SCENE's `grid.units`. Each radius is
 * converted at the write (`inSceneUnits`) and rounded to the step its field
 * stores, before it is compared with the stored value.
 */

import { MODULE_ID } from "./constants.mjs";
import { isActiveGMSeat, isPrimaryGM, unset } from "./util.mjs";
import { feetPerUnit, feetToUnits } from "./distance-units.mjs";
import { hasNightVision, senseProfile } from "./senses.mjs";
import { DETECTION_MODES } from "./perception.mjs";
import { brightestLightReaching, shedLight } from "./light.mjs";
import { isMarkerActor } from "./place.mjs";

/**
 * The detection modes this module manages, known independently of what the
 * actor currently reports so a token that stops having a sense loses its mode.
 * Includes core's `feelTremor`, which the module places.
 */
const OWNED_DETECTION_MODES = Object.freeze(Object.values(DETECTION_MODES));

/** Boolean: this token's light is ours to clear. */
const FLAG_LIGHT = "managedLight";
/**
 * `{bright, dim}` — the last lit radii WE wrote, in scene units, for override
 * detection; `{released: true}` once a hand edit has taken the light back.
 */
const FLAG_LIGHT_STAMP = "managedLightStamp";
/** `{range, visionMode}` — the last sight WE wrote, for override detection. */
const FLAG_VISION = "managedVision";

/** World setting gating the whole pass. */
export const SETTING_MANAGE_VISION = "manageVision";

/**
 * The party token's senses belong to the formation, which derives them from its
 * members; left alone here so the two writers never fight over one token.
 */
const PARTY_ACTOR_TYPE = `${MODULE_ID}.party`;

const enabled = () => {
  try {
    return game.settings.get(MODULE_ID, SETTING_MANAGE_VISION);
  } catch {
    return false; // setting not registered yet (pre-init callers)
  }
};

/** The step Foundry stores a radius at when a field declares none readable. */
const DEFAULT_RADIUS_STEP = 0.01;

/** The `step` of a schema field, or the default when the field cannot be read. */
function stepOf(field) {
  const step = field?.step;
  return step > 0 ? step : DEFAULT_RADIUS_STEP;
}

/** The step the light radii are stored at. */
function lightStep() {
  return stepOf(globalThis.foundry?.data?.LightData?.schema?.fields?.bright);
}

/** The step the sight and detection ranges are stored at. */
function sightStep() {
  return stepOf(globalThis.CONFIG?.Token?.documentClass?.schema?.getField?.("sight.range"));
}

/** `value` rounded to the nearest multiple of `step`, as the field's own clean does. */
function roundToStep(value, step) {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/**
 * A radius in feet as the token's scene stores it: converted by the scene's
 * `grid.units` and rounded to `step`. A scene in feet, or in a unit nobody
 * recognises, gets the figure unchanged. A radius the world has not imported
 * (null) is 0: the token then sees by no radius of that sense.
 */
function inSceneUnits(tokenDoc, feet, step) {
  const value = Number(feet) || 0;
  if (!(value > 0)) return 0;
  return roundToStep(feetToUnits(value, tokenDoc?.parent?.grid?.units), step);
}

/* -------------------------------------------- */
/*  The two guarded writes                      */
/* -------------------------------------------- */

/*
 * Each guarded write is computed as an UPDATE DELTA first and applied second, so
 * a sweep can batch one document call per scene. Every decision, the flag-only
 * outcomes included, is part of the delta.
 */

/**
 * The sight update this profile wants, or null when there is nothing to write.
 * Declines when the token has no vision, or when a human has edited the sight
 * since our last write — in which case the delta drops the stamp and the token
 * is never managed again.
 * The profile's ranges are feet; the delta, the stamp and the comparison all
 * carry them in the scene's units, which is what the token stores.
 * @returns {{update: object, claim: boolean}|null} `claim` marks a delta that
 *   only stamps ownership: nothing about the token's vision actually changes.
 */
function visionDelta(tokenDoc, profile) {
  if (!tokenDoc?.sight?.enabled) return null;
  const step = sightStep();
  const { visionMode } = profile;
  const sightRange = inSceneUnits(tokenDoc, profile.sightRange, step);
  const detection = {};
  for (const [id, feet] of Object.entries(profile.detection ?? {})) detection[id] = inSceneUnits(tokenDoc, feet, step);
  const stamp = tokenDoc.getFlag(MODULE_ID, FLAG_VISION);
  const current = { range: tokenDoc.sight.range, visionMode: tokenDoc.sight.visionMode };

  // Released for good: a positive marker, since an absent stamp reads as an unclaimed token.
  if (stamp?.released) return null;

  if (stamp) {
    const untouched = current.range === stamp.range && current.visionMode === stamp.visionMode;
    if (!untouched) {
      return { update: { [`flags.${MODULE_ID}.${FLAG_VISION}`]: { released: true } }, claim: true };
    }
  }

  // Detection modes are a TypedObjectField keyed by mode id: ours are rewritten,
  // everything else (lightPerception, another module's) is left alone.
  const desiredDetection = {};
  for (const [id, range] of Object.entries(detection)) desiredDetection[id] = { enabled: true, range };

  // `basicSight` is switched off wherever a real sense replaces it. See docs/lib/MODEL.md,
  // "Why the detection modes matter".
  if (Object.keys(detection).length) desiredDetection.basicSight = { enabled: false, range: 0 };

  // Compare against STORED data: core injects basicSight and lightPerception in preparation.
  const stored = tokenDoc.toObject().detectionModes ?? {};
  const detectionDelta = {};
  for (const id of new Set([...OWNED_DETECTION_MODES, "basicSight", ...Object.keys(detection)])) {
    const want = desiredDetection[id] ?? null;
    const have = stored[id] ?? null;
    if (!want && have) detectionDelta[id] = unset();
    else if (want && (have?.range !== want.range || have?.enabled !== want.enabled)) detectionDelta[id] = want;
  }
  const detectionDirty = Object.keys(detectionDelta).length > 0;

  if (!detectionDirty && current.range === sightRange && current.visionMode === visionMode) {
    // Already correct, but claimed anyway: an ordinary character derives Foundry's own
    // default, and an unstamped token's later hand edit would read as stock and be overwritten.
    if (stamp) return null;
    return { update: { [`flags.${MODULE_ID}.${FLAG_VISION}`]: { range: sightRange, visionMode } }, claim: true };
  }

  return {
    update: {
      sight: { range: sightRange, visionMode },
      detectionModes: detectionDelta,
      [`flags.${MODULE_ID}.${FLAG_VISION}`]: { range: sightRange, visionMode },
    },
    claim: false,
  };
}

/**
 * The light update `{bright, dim}` feet wants, or null when there is nothing to
 * write. Radii are written in the token's scene units, rounded to the stored
 * step before the comparison. A computed 0/0 on a token we never lit is someone
 * else's light: left alone. A source is lit when either radius survives the
 * conversion.
 *
 * A lit write stamps its radii. A managed token whose stored radii no longer
 * match the stamp was edited by a human: the delta releases it, flag and stamp,
 * and the light is never written again (`isManagedLight`). A managed token with
 * no stamp is stamped on the first sync that finds its light already right.
 *
 * Radii are compared against the STORED light (`storedLight`), never the
 * prepared one. `look` is how a lit write draws: the flame's unless `feet`
 * carries the `kind` of a `shedLight` answer (`lightLookFor`).
 */
function lightDelta(tokenDoc, feet, look = lightLookFor(feet?.kind)) {
  if (!tokenDoc) return null;
  const stamp = tokenDoc.getFlag(MODULE_ID, FLAG_LIGHT_STAMP);
  if (stamp?.released) return null;
  const step = lightStep();
  const bright = inSceneUnits(tokenDoc, feet?.bright, step);
  const dim = inSceneUnits(tokenDoc, feet?.dim, step);
  const lit = bright > 0 || dim > 0;
  const managed = tokenDoc.getFlag(MODULE_ID, FLAG_LIGHT) === true;
  const stampKey = `flags.${MODULE_ID}.${FLAG_LIGHT_STAMP}`;
  if (managed && stamp && !matchesStamp(tokenDoc, stamp)) {
    return { [`flags.${MODULE_ID}.${FLAG_LIGHT}`]: false, [stampKey]: { released: true } };
  }
  const stored = storedLight(tokenDoc);
  if (stored?.bright === bright && stored?.dim === dim) {
    return managed && lit && !stamp ? { [stampKey]: { bright, dim } } : null;
  }
  if (!lit && !managed) return null;

  return {
    light: {
      bright,
      dim,
      color: lit ? look.color : null,
      alpha: lit ? look.alpha : 0.5,
      animation: lit ? { ...look.animation } : { type: null },
    },
    [`flags.${MODULE_ID}.${FLAG_LIGHT}`]: lit,
    ...(lit ? { [stampKey]: { bright, dim } } : stamp ? { [stampKey]: unset() } : {}),
  };
}

/**
 * The light a token document holds as written: its source data, which
 * preparation does not touch, falling back to the live field where a document
 * exposes no source.
 */
function storedLight(tokenDoc) {
  return tokenDoc?._source?.light ?? tokenDoc?.light;
}

/** Whether a token's stored light radii are still the ones `stamp` records. */
function matchesStamp(tokenDoc, stamp) {
  const stored = storedLight(tokenDoc);
  return stored?.bright === stamp?.bright && stored?.dim === stamp?.dim;
}

/**
 * How a carried flame looks, whoever draws it: the token light this file
 * writes, and the marching column's lights (formation `column-light.mjs`), so a
 * torch reads the same in a member's hand and in the column.
 */
export const CARRIED_LIGHT_LOOK = Object.freeze({
  color: "#ff9b47",
  alpha: 0.3,
  animation: Object.freeze({ type: "torch", speed: 2, intensity: 3 }),
});

/**
 * How a magic light looks: steady, with no animation and no tint, at the
 * flame's alpha. Drawn wherever a magic light stronger than any carried flame
 * is the light shed (`shedLight`'s kind).
 */
export const MAGIC_LIGHT_LOOK = Object.freeze({
  color: null,
  alpha: CARRIED_LIGHT_LOOK.alpha,
  animation: Object.freeze({ type: null }),
});

/** The look for a `shedLight` kind: `"magic"` is steady, anything else a flame. */
export function lightLookFor(kind) {
  return kind === "magic" ? MAGIC_LIGHT_LOOK : CARRIED_LIGHT_LOOK;
}

/**
 * Whether this token's light is the module's own: `applyTokenLight` wrote it,
 * and its stored radii are still the ones it stamped. A managed light with no
 * stamp reads as managed.
 */
export function isManagedLight(tokenDoc) {
  if (tokenDoc?.getFlag?.(MODULE_ID, FLAG_LIGHT) !== true) return false;
  const stamp = tokenDoc.getFlag(MODULE_ID, FLAG_LIGHT_STAMP);
  if (stamp?.released) return false;
  return !stamp || matchesStamp(tokenDoc, stamp);
}

/** True once the vision pass has written or claimed this token's sight, or a hand edit released it. */
export function visionClaimed(tokenDoc) {
  return !!tokenDoc?.getFlag(MODULE_ID, FLAG_VISION);
}

/**
 * Point a token's sight at `{sightRange, visionMode}`. Returns true if the
 * token's vision changed (a bare ownership stamp reads as false: nothing about
 * what the token sees is different).
 */
export async function applyTokenVision(tokenDoc, profile) {
  const delta = visionDelta(tokenDoc, profile);
  if (!delta) return false;
  await tokenDoc.update(delta.update);
  return !delta.claim;
}

/**
 * Emit `{bright, dim}` feet of light from a token. A `kind` of `"magic"` on
 * `light` (a `shedLight` answer) draws it steady. Returns true if written.
 */
export async function applyTokenLight(tokenDoc, light) {
  const delta = lightDelta(tokenDoc, light);
  if (!delta) return false;
  await tokenDoc.update(delta);
  return true;
}

/* -------------------------------------------- */
/*  Driving the pass                            */
/* -------------------------------------------- */

/**
 * Everything one token needs written to match its actor's senses and carried
 * lights, as a single update — or null when it already matches. The sight and
 * light deltas share no keys, so one call carries both.
 */
function tokenSyncDelta(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type === PARTY_ACTOR_TYPE) return null;
  // A marker has no senses and carries no light: its token keeps whatever the Judge gave it.
  if (isMarkerActor(actor)) return null;
  // Only Night Vision reads the light around the token, and finding it scans the scene.
  // The light found is stored in the scene's units; the profile works in feet.
  const litBy = hasNightVision(actor) ? brightestLightReaching(tokenDoc) * feetPerUnit(tokenDoc.parent?.grid?.units) : 0;
  const vision = visionDelta(tokenDoc, senseProfile(actor, { litBy }));
  const light = lightDelta(tokenDoc, shedLight(actor));
  if (!vision && !light) return null;
  return Object.assign({}, vision?.update, light);
}

/**
 * True while the canvas is in the middle of drawing THIS scene. A token write in
 * that window throws inside core's own update handler, and the `canvasReady`
 * sweep re-derives the scene once the draw is done.
 */
export function sceneIsDrawing(scene) {
  const c = globalThis.canvas;
  return !!(c && scene && !c.ready && c.scene?.id === scene.id);
}

/** Sync one token from its own actor's senses and carried lights. */
export async function syncTokenFromActor(tokenDoc) {
  if (!enabled() || sceneIsDrawing(tokenDoc?.parent)) return;
  const update = tokenSyncDelta(tokenDoc);
  if (update) await tokenDoc.update(update);
}

/**
 * Sync a batch of tokens on ONE scene with a single document call. The
 * derivation is fault-isolated per token; the write is one call.
 */
async function syncTokenBatch(scene, tokenDocs) {
  if (sceneIsDrawing(scene)) return 0;
  const updates = [];
  for (const tokenDoc of tokenDocs) {
    try {
      const update = tokenSyncDelta(tokenDoc);
      if (update) updates.push({ _id: tokenDoc.id, ...update });
    } catch (err) {
      console.error(`${MODULE_ID} | token sense sync failed for ${tokenDoc.name}`, err);
    }
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}

/** Every token of this actor, across every scene (unlinked copies included). */
function tokensOf(actor) {
  const byScene = new Map();
  for (const scene of game.scenes ?? []) {
    const tokens = scene.tokens.filter((t) => t.actor?.id === actor.id);
    if (tokens.length) byScene.set(scene, tokens);
  }
  return byScene;
}

/** Re-sync everything this actor stands on, one write per scene it stands in. */
export async function syncActorTokens(actor) {
  if (!actor || !isPrimaryGM() || !enabled()) return;
  for (const [scene, tokens] of tokensOf(actor)) await syncTokenBatch(scene, tokens);
}

/** Re-sync every token on a scene — used at canvas ready and after a sweep. */
export async function syncSceneTokens(scene) {
  if (!scene || !isPrimaryGM() || !enabled()) return;
  await syncTokenBatch(scene, [...scene.tokens]);
}

/**
 * Re-sync only the creatures whose sight depends on the light AROUND them.
 *
 * Night Vision reads a light the creature did not light, so its range changes
 * without its own sheet being touched; the trigger is every light and every
 * step, hence the narrowing to that one sense.
 */
export async function syncNightVisionTokens(scene) {
  if (!scene || !isPrimaryGM() || !enabled()) return;
  const watchers = [...scene.tokens].filter((t) => hasNightVision(t.actor));
  if (watchers.length) await syncTokenBatch(scene, watchers);
}

/* -------------------------------------------- */
/*  The world sweep                             */
/* -------------------------------------------- */

/**
 * Derive vision for every token in the WORLD, and report what that came to.
 *
 * The per-scene passes reach only the scene someone is looking at or the actor
 * just changed; this reaches every scene at once.
 *
 * `reclaim` drops the release markers first, sight's and light's; it is never
 * the default, since a released token is a Judge's override. See docs/lib/MODEL.md,
 * "Asking for the whole world at once".
 *
 * @param {object} [opts]
 * @param {boolean} [opts.reclaim] take back tokens released to a hand edit
 * @returns {Promise<{ran: boolean, scenes: number, tokens: number,
 *   reclaimed: number, written: number, released: number}>}
 */
export async function migrateWorldVision({ reclaim = false } = {}) {
  const report = { ran: false, scenes: 0, tokens: 0, reclaimed: 0, written: 0, released: 0 };
  if (!isActiveGMSeat() || !enabled()) return report;
  report.ran = true;

  // A token counts once, whether its sight, its light or both were released.
  const releasedFlags = (t) => [FLAG_VISION, FLAG_LIGHT_STAMP].filter((flag) => !!t.getFlag(MODULE_ID, flag)?.released);
  const isReleased = (t) => releasedFlags(t).length > 0;

  for (const scene of game.scenes ?? []) {
    const tokens = [...scene.tokens];
    if (!tokens.length) continue;
    report.scenes++;
    report.tokens += tokens.length;

    if (reclaim) {
      const drops = tokens.filter(isReleased).map((t) => ({
        _id: t.id,
        ...Object.fromEntries(releasedFlags(t).map((flag) => [`flags.${MODULE_ID}.${flag}`, unset()])),
      }));
      if (drops.length) {
        await scene.updateEmbeddedDocuments("Token", drops);
        report.reclaimed += drops.length;
      }
    }

    // Counted after the reclaim: the figure is what is still left alone.
    report.released += tokens.filter(isReleased).length;
    report.written += await syncTokenBatch(scene, tokens);
  }
  return report;
}
