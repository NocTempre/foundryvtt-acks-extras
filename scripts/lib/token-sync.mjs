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
 * a light is only ever cleared if WE set it (`managedLight`).
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
 */

import { MODULE_ID } from "./constants.mjs";
import { isPrimaryGM } from "./util.mjs";
import { senseProfile } from "./senses.mjs";
import { DETECTION_MODES } from "./perception.mjs";
import { bearerLights, emittedLight } from "./light.mjs";

/**
 * The detection modes this module manages. A token that stops having a sense
 * must lose its mode, so the set has to be known independently of what the
 * actor currently reports — otherwise a doused sense lingers forever.
 * `feelTremor` is core's own but we place it, so we clear it too.
 */
const OWNED_DETECTION_MODES = Object.freeze(Object.values(DETECTION_MODES));

/** Boolean: this token's light is ours to clear. Predates the vision stamp. */
const FLAG_LIGHT = "managedLight";
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

/* -------------------------------------------- */
/*  The two guarded writes                      */
/* -------------------------------------------- */

/**
 * Point a token's sight at `{sightRange, visionMode}`. Returns true if written.
 * Declines when the token has no vision, or when a human has edited the sight
 * since our last write — in which case the stamp is dropped and the token is
 * never managed again.
 */
export async function applyTokenVision(tokenDoc, { sightRange, visionMode, detection = {} }) {
  if (!tokenDoc?.sight?.enabled) return false;
  const stamp = tokenDoc.getFlag(MODULE_ID, FLAG_VISION);
  const current = { range: tokenDoc.sight.range, visionMode: tokenDoc.sight.visionMode };

  // Released for good. This has to be a POSITIVE marker, not the absence of a
  // stamp: clearing the flag on override meant the next sync saw an unclaimed
  // token and took it straight back, so a hand-edit survived exactly one sweep.
  if (stamp?.released) return false;

  if (stamp) {
    const untouched = current.range === stamp.range && current.visionMode === stamp.visionMode;
    if (!untouched) {
      await tokenDoc.setFlag(MODULE_ID, FLAG_VISION, { released: true });
      return false;
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
    if (!want && have) detectionDelta[`-=${id}`] = null;
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
    if (!stamp) await tokenDoc.setFlag(MODULE_ID, FLAG_VISION, { range: sightRange, visionMode });
    return false;
  }

  await tokenDoc.update({
    sight: { range: sightRange, visionMode },
    detectionModes: detectionDelta,
    [`flags.${MODULE_ID}.${FLAG_VISION}`]: { range: sightRange, visionMode },
  });
  return true;
}

/**
 * Emit `{bright, dim}` feet of light from a token. Returns true if written.
 * A computed 0/0 on a token we never lit is someone else's light: left alone.
 */
export async function applyTokenLight(tokenDoc, { bright, dim }) {
  if (!tokenDoc) return false;
  if (tokenDoc.light.bright === bright && tokenDoc.light.dim === dim) return false;
  const managed = tokenDoc.getFlag(MODULE_ID, FLAG_LIGHT) ?? false;
  if (bright === 0 && dim === 0 && !managed) return false;

  await tokenDoc.update({
    light: {
      bright,
      dim,
      color: bright > 0 ? "#ff9b47" : null,
      alpha: bright > 0 ? 0.3 : 0.5,
      animation: bright > 0 ? { type: "torch", speed: 2, intensity: 3 } : { type: null },
    },
    [`flags.${MODULE_ID}.${FLAG_LIGHT}`]: bright > 0 || dim > 0,
  });
  return true;
}

/* -------------------------------------------- */
/*  Driving the pass                            */
/* -------------------------------------------- */

/** Sync one token from its own actor's senses and carried lights. */
export async function syncTokenFromActor(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type === PARTY_ACTOR_TYPE) return;
  if (!enabled()) return;
  await applyTokenVision(tokenDoc, senseProfile(actor));
  await applyTokenLight(tokenDoc, emittedLight(bearerLights(actor)));
}

/** Every token of this actor, across every scene (unlinked copies included). */
function tokensOf(actor) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens) {
      if (token.actor?.id === actor.id) out.push(token);
    }
  }
  return out;
}

/**
 * Re-sync everything this actor stands on. Fault-isolated per token: one
 * token failing to update must not strand the rest of the scene unsynced.
 */
export async function syncActorTokens(actor) {
  if (!actor || !isPrimaryGM()) return;
  for (const tokenDoc of tokensOf(actor)) {
    try {
      await syncTokenFromActor(tokenDoc);
    } catch (err) {
      console.error(`${MODULE_ID} | token sense sync failed for ${tokenDoc.name}`, err);
    }
  }
}

/** Re-sync every token on a scene — used at canvas ready and after a sweep. */
export async function syncSceneTokens(scene) {
  if (!scene || !isPrimaryGM()) return;
  for (const tokenDoc of scene.tokens) {
    try {
      await syncTokenFromActor(tokenDoc);
    } catch (err) {
      console.error(`${MODULE_ID} | token sense sync failed for ${tokenDoc.name}`, err);
    }
  }
}
