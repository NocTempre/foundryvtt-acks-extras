/* global game */

/**
 * Writing an actor's senses and carried light onto its TOKEN.
 *
 * `senses.mjs` decides what a creature perceives and `light.mjs` decides how
 * brightly it burns; this file is the only thing that puts either on canvas.
 * It exists because the answer must be the same for a character standing alone
 * in a corridor, a monster the Judge just dragged in, and a party member who has
 * stepped out of the formation — three paths that previously had three answers,
 * two of which were "whatever the GM last typed".
 *
 * ## Not clobbering the Judge
 *
 * Both writes are guarded, because both have already gone wrong here once. The
 * light guard is the older of the two: a formation carrying no lit source used
 * to force the token to 0/0 on every sync, which silently undid a GM's manually
 * configured token light and left the party in the dark with no explanation. So
 * a light is only ever cleared if WE set it (`managedLight`), and a light we
 * set is stamped (`managedLightStamp`) and handed back, as sight is below, the
 * moment a human edits it.
 *
 * Vision cannot be that shy — the whole point of the pass is to overwrite a
 * wrong default, and the system's monster packs ship every creature at
 * `sight.range: 60`. So instead it STAMPS what it wrote (`managedVision`) and
 * compares before writing again: a token whose sight no longer matches our stamp
 * was edited by a human, and we hand it back permanently. The Judge overrides us
 * by editing the token, which is where they would look for the control anyway.
 *
 * Vision is shaped, never granted: a token with `sight.enabled` false is
 * scenery, and stays scenery.
 *
 * ## Units
 *
 * Every radius this module computes is in FEET; Foundry reads a token's
 * `light.bright`, `light.dim`, `sight.range` and detection ranges in the
 * SCENE's `grid.units`. Each radius is converted at the write
 * (`inSceneUnits`) and rounded to the step its field stores, before it is
 * compared with the stored value: a comparison against an unrounded figure
 * never matches the cleaned one, and every sync would write again.
 */

import { MODULE_ID } from "./constants.mjs";
import { isActiveGMSeat, isPrimaryGM, unset } from "./util.mjs";
import { feetPerUnit, feetToUnits } from "./distance-units.mjs";
import { hasNightVision, senseProfile } from "./senses.mjs";
import { DETECTION_MODES } from "./perception.mjs";
import { bearerLights, brightestLightReaching, emittedLight } from "./light.mjs";
import { isMarkerActor } from "./place.mjs";

/**
 * The detection modes this module manages. A token that stops having a sense
 * must lose its mode, so the set has to be known independently of what the
 * actor currently reports — otherwise a doused sense lingers forever.
 * `feelTremor` is core's own but we place it, so we clear it too.
 */
const OWNED_DETECTION_MODES = Object.freeze(Object.values(DETECTION_MODES));

/** Boolean: this token's light is ours to clear. Predates the vision stamp. */
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
 * members rather than from the (itemless) party actor. Left alone here so the
 * two writers never fight over one token.
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
 * recognises, gets the figure unchanged.
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
 * a sweep over many tokens can send one document call instead of two per token.
 * Every decision — including the two flag-only outcomes, releasing a token to a
 * human and claiming a stock one — is expressed as part of that delta, because a
 * `setFlag` taken outside it is a write that no batch can gather up.
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

  // Released for good. This has to be a POSITIVE marker, not the absence of a
  // stamp: clearing the flag on override meant the next sync saw an unclaimed
  // token and took it straight back, so a hand-edit survived exactly one sweep.
  if (stamp?.released) return null;

  if (stamp) {
    const untouched = current.range === stamp.range && current.visionMode === stamp.visionMode;
    if (!untouched) {
      return { update: { [`flags.${MODULE_ID}.${FLAG_VISION}`]: { released: true } }, claim: true };
    }
  }

  // Detection modes are a TypedObjectField keyed by mode id. We rewrite ours and
  // leave everything else — lightPerception, and anything another module added.
  const desiredDetection = {};
  for (const [id, range] of Object.entries(detection)) desiredDetection[id] = { enabled: true, range };

  // Generic darkvision has to be switched OFF wherever a real sense replaces it.
  // Core derives `basicSight` from `sight.range`, so a creature would otherwise
  // detect through plain sight at the same radius — and that generic mode
  // shadows every specific one: the hiding thief is seen anyway, the invisible
  // one is found by a bat that should be listening, not looking. Environment
  // vision is unaffected: the vision source radius reads `sight.range` itself
  // (`Token#sightRange`), never this mode.
  if (Object.keys(detection).length) desiredDetection.basicSight = { enabled: false, range: 0 };

  // Compare against STORED data, not prepared: core injects basicSight and
  // lightPerception during preparation, so diffing the live object would report
  // a change on every single sync and write forever.
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
    // Already correct — but CLAIM it anyway. An ordinary character derives
    // range 0 / basic, which is exactly Foundry's default, so without this the
    // commonest token in the world is never stamped; a GM's later hand-edit is
    // then indistinguishable from a stock token and gets overwritten on the
    // next sweep. Caught live: the edit survived one sync and vanished on the
    // next. One flag write, once per token, buys the guard for every token.
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
 * write. The radii are written in the token's scene units, rounded to the
 * stored step before the comparison so a second sync finds nothing to do. A
 * computed 0/0 on a token we never lit is someone else's light: left alone. A
 * source is lit when either radius survives the conversion — a coarse scene can
 * round the bright radius to 0 and keep the dim one.
 *
 * A lit write stamps its radii. A managed token whose stored radii no longer
 * match the stamp was edited by a human: the delta releases it, flag and
 * stamp, and the light is never written again, so the Judge's light keeps
 * core's padding (`isManagedLight`). A managed token lit before the stamp
 * existed is stamped on the first sync that finds its light already right.
 */
function lightDelta(tokenDoc, feet) {
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
  if (tokenDoc.light.bright === bright && tokenDoc.light.dim === dim) {
    return managed && lit && !stamp ? { [stampKey]: { bright, dim } } : null;
  }
  if (!lit && !managed) return null;

  return {
    light: {
      bright,
      dim,
      color: lit ? CARRIED_LIGHT_LOOK.color : null,
      alpha: lit ? CARRIED_LIGHT_LOOK.alpha : 0.5,
      animation: lit ? { ...CARRIED_LIGHT_LOOK.animation } : { type: null },
    },
    [`flags.${MODULE_ID}.${FLAG_LIGHT}`]: lit,
    ...(lit ? { [stampKey]: { bright, dim } } : stamp ? { [stampKey]: unset() } : {}),
  };
}

/** Whether a token's stored light radii are still the ones `stamp` records. */
function matchesStamp(tokenDoc, stamp) {
  return tokenDoc?.light?.bright === stamp?.bright && tokenDoc?.light?.dim === stamp?.dim;
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
 * Whether this token's light is the module's own: `applyTokenLight` wrote it,
 * and its stored radii are still the ones it stamped. A light edited by hand
 * since reads as the Judge's at once, before any sync releases it. A managed
 * light written before the stamp existed carries none and reads as managed.
 */
export function isManagedLight(tokenDoc) {
  if (tokenDoc?.getFlag?.(MODULE_ID, FLAG_LIGHT) !== true) return false;
  const stamp = tokenDoc.getFlag(MODULE_ID, FLAG_LIGHT_STAMP);
  if (stamp?.released) return false;
  return !stamp || matchesStamp(tokenDoc, stamp);
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

/** Emit `{bright, dim}` feet of light from a token. Returns true if written. */
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
 * lights, as a single update — or null when it already matches.
 *
 * Sight and light are merged rather than sent separately: two awaited writes per
 * token is what made a scene sweep visibly slow, and the two deltas share no
 * keys, so one call carries both.
 */
function tokenSyncDelta(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type === PARTY_ACTOR_TYPE) return null;
  // A marker has no senses and carries no light: its token keeps whatever the
  // Judge gave it, a lantern over a shrine included.
  if (isMarkerActor(actor)) return null;
  // Only Night Vision reads the light around the token, and finding it costs a
  // pass over every light and token on the scene. Asked for that one sense
  // rather than for all of them, so an ordinary sweep is unchanged.
  // The light found is stored in the scene's units; the profile works in feet.
  const litBy = hasNightVision(actor) ? brightestLightReaching(tokenDoc) * feetPerUnit(tokenDoc.parent?.grid?.units) : 0;
  const vision = visionDelta(tokenDoc, senseProfile(actor, { litBy }));
  const light = lightDelta(tokenDoc, emittedLight(bearerLights(actor)));
  if (!vision && !light) return null;
  return Object.assign({}, vision?.update, light);
}

/**
 * True while the canvas is in the middle of drawing THIS scene. Core builds a
 * placeable for any token document of the scene in view the moment something
 * touches it, and on a canvas that has never drawn a scene the render-flag
 * queue that placeable then enqueues into does not exist until the first draw
 * completes — a token write in that window throws inside core's own update
 * handler. The `canvasReady` sweep re-derives the whole scene as soon as the
 * draw is done, so a write here would also be a write twice.
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
 * Sync a batch of tokens on ONE scene with a single document call.
 *
 * The DERIVATION stays fault-isolated per token — a creature with an unreadable
 * stat block must not cost the rest of the scene its senses — but the write is
 * one call: a sweep that writes per token spends a round trip on every creature
 * standing on the map.
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
 * Night Vision doubles the reach of a light the creature did not light, so its
 * range changes when a torch is struck, doused, or simply carried across the
 * room — none of which touches the creature's own sheet, and so none of which
 * the sheet-driven hooks would ever notice. Narrowed to that one sense because
 * the trigger is every light and every step: sweeping the whole scene on each
 * would re-derive the entire cast to answer for a handful of it.
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
 * The per-scene passes above only ever reach the scene someone is looking at or
 * the actor someone just changed. A world that turns the setting on mid-campaign
 * — or upgrades into a corrected sense model — has scenes nobody will open for
 * months still carrying the system's stock 60' sight on every creature. This is
 * how a Judge asks for all of them at once.
 *
 * `reclaim` drops the release markers first, sight's and light's. A token a human edited is stamped
 * released and is never managed again, which is the override working as
 * intended; taking it back is a deliberate act, so it is a separate answer and
 * never the default. Reported rather than silent: a sweep that says nothing is
 * indistinguishable from one that did nothing.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.reclaim] take back tokens released to a hand edit
 * @returns {Promise<{ran: boolean, scenes: number, tokens: number,
 *   reclaimed: number, written: number, released: number}>}
 */
export async function migrateWorldVision({ reclaim = false } = {}) {
  const report = { ran: false, scenes: 0, tokens: 0, reclaimed: 0, written: 0, released: 0 };
  // The Judge's own act, in the window they asked from.
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

    // Counted AFTER the reclaim, so the number reported is what is still being
    // left alone rather than what was a moment ago.
    report.released += tokens.filter(isReleased).length;
    report.written += await syncTokenBatch(scene, tokens);
  }
  return report;
}
