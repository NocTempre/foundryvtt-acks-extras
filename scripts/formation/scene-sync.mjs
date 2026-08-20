/* global game, ChatMessage, CONST */
import { MODULE_ID, ROLES } from "./constants.mjs";
import { deployedTokens, isMemberDeployed } from "./deployment.mjs";
import { faceWidthFeet, formationHeading, getFormations, getPartyActor, getPartyToken, mapperIsProficient, partyDepth } from "./formation-model.mjs";
import { FEET_PER_RANK } from "./trap-rules.mjs";
import { tokenSpan } from "../battlemap/footprint.mjs";
import { ensureMapSession } from "./map-items.mjs";
import { MEASURE_FLAG, MEASURE_MODES } from "./measure-fuzz.mjs";
import { emittedLight } from "../lib/light.mjs";
import { VISION_MODES, senseProfile } from "../lib/senses.mjs";
import { SETTING_MANAGE_VISION, applyTokenLight, applyTokenVision, syncTokenFromActor } from "../lib/token-sync.mjs";

/**
 * Keeps the world in step with formation state (runs on the primary GM client
 * after every formation change):
 *
 * - **Fog of war ↔ the mapper.** Fog exploration (`scene.fog.mode` on v14,
 *   `scene.fog.exploration` on v13) stays on only while a formation on the
 *   scene has a member with the Mapper role (and, optionally, a lit light
 *   source — mapping requires bright light, RR p. 264). Without a mapper the
 *   fog is fully DISABLED: nothing is displayed *or recorded* — the party
 *   still sees current surroundings via the party token's vision, but no map
 *   memory accumulates while no one is drawing it. The scene's original mode
 *   is remembered in a flag and restored when no formation remains.
 *
 * - **Party token light ← lit light sources.** The party token emits the
 *   brightest lit source's light (torch/lantern 15'/30', candle 5'/10') so
 *   players can always see where they are.
 *
 * - **Party actor ownership ← member ownership.** Every player who owns a
 *   member of the formation gets owner rights on the party actor, so they see
 *   through (and may move) the party token while their character is inside it.
 */

function canMap(formation) {
  // Nobody maps mid-battle: recording and map memory pause while deployed.
  if (formation.combat?.active) return false;
  // Exploring at combat speed loses the ability to map (RR p. 263).
  if (formation.stance?.pace === "hurried") return false;
  const hasMapper = formation.members.some((m) => m.roles?.includes(ROLES.MAPPER));
  if (!hasMapper) return false;
  if (!game.settings.get(MODULE_ID, "mapperNeedsLight")) return true;
  // A closed lantern sheds no light: mapping needs an unshielded source.
  return formation.lights.some((l) => l.lit && !l.shielded);
}

/* -------------------------------------------- */
/*  Fog exploration mode (v13 boolean / v14 mode) */
/* -------------------------------------------- */

/** v14+ numeric fog modes, or null on v13 where fog.exploration is a boolean. */
const FOG_MODES = typeof CONST !== "undefined" ? (CONST.FOG_EXPLORATION_MODES ?? null) : null;

function readFogValue(scene) {
  return FOG_MODES ? scene.fog.mode : !!scene.fog.exploration;
}

function fogIsEnabled(value) {
  return FOG_MODES ? value !== FOG_MODES.DISABLED : !!value;
}

async function announceFog(sceneName, restored) {
  await ChatMessage.create({
    content: `<div class="acks-formation-card"><em>${game.i18n.format(
      restored ? "ACKS-FORMATION.chat.fogRestored" : "ACKS-FORMATION.chat.fogLost",
      { scene: sceneName },
    )}</em></div>`,
  });
}

async function syncSceneFog(scene, formationsOnScene) {
  const desired = formationsOnScene.some(canMap);
  // An active map session forces SHARED exploration: all members contribute
  // to, and see, one union that the session archives into the Map item.
  const sessionActive = formationsOnScene.some((f) => f.mapSession?.sceneId === scene.id);
  let original = scene.getFlag(MODULE_ID, "fogOriginal");
  const current = readFogValue(scene);

  // If the GM deliberately runs the scene without fog, don't force it on —
  // unless they explicitly started a map session here.
  if (original === undefined && !fogIsEnabled(current) && !sessionActive) return;

  let target;
  if (!desired) target = FOG_MODES ? FOG_MODES.DISABLED : false;
  else if (!FOG_MODES) target = true;
  else if (sessionActive) target = FOG_MODES.SHARED;
  else {
    const restore = original !== undefined ? original : current;
    target = fogIsEnabled(restore) ? restore : FOG_MODES.INDIVIDUAL;
  }
  if (current === target) return;

  // Remember the pre-management value the first time we touch the scene.
  if (original === undefined) {
    original = current;
    await scene.setFlag(MODULE_ID, "fogOriginal", current);
  }
  if (FOG_MODES) await scene.update({ "fog.mode": target });
  else await scene.update({ "fog.exploration": target });
  if (fogIsEnabled(current) !== fogIsEnabled(target)) await announceFog(scene.name, fogIsEnabled(target));
}

/**
 * Maintain the measurement-fuzz flag read by the wrapped rulers: exact with a
 * proficient working mapper, ~fuzzed with an unproficient one, "?" with none.
 */
async function syncMeasureFlag(scene, formationsOnScene) {
  const current = scene.getFlag(MODULE_ID, MEASURE_FLAG);
  if (!game.settings.get(MODULE_ID, "fuzzMeasurement")) {
    if (current) await scene.unsetFlag(MODULE_ID, MEASURE_FLAG);
    return;
  }
  // Combat is round-scale and tactical: measurement stays exact during it.
  const inCombat = formationsOnScene.some((f) => f.combat?.active);
  const mapping = formationsOnScene.some(canMap);
  const proficient = formationsOnScene.some((f) => canMap(f) && mapperIsProficient(f));
  const mode =
    inCombat || (mapping && proficient) ? MEASURE_MODES.OFF : mapping ? MEASURE_MODES.FUZZY : MEASURE_MODES.UNKNOWN;
  // The hidden error factor is rolled once per scene and then never changes,
  // so re-measuring always shows the same wrong number.
  const factor = current?.factor ?? Math.round((0.8 + Math.random() * 0.45) * 100) / 100;
  if (current?.mode === mode && current?.factor === factor) return;
  await scene.setFlag(MODULE_ID, MEASURE_FLAG, { mode, factor });
}

async function releaseMeasureFlag(scene) {
  if (scene.getFlag(MODULE_ID, MEASURE_FLAG)) await scene.unsetFlag(MODULE_ID, MEASURE_FLAG);
}

async function releaseSceneFog(scene) {
  const original = scene.getFlag(MODULE_ID, "fogOriginal");
  if (original === undefined) return;
  if (readFogValue(scene) !== original) {
    if (FOG_MODES) await scene.update({ "fog.mode": original });
    else await scene.update({ "fog.exploration": original });
  }
  await scene.unsetFlag(MODULE_ID, "fogOriginal");
}

/* -------------------------------------------- */
/*  Party actor ownership                       */
/* -------------------------------------------- */

/**
 * Grant owner rights on the party actor to every player who owns one of the
 * member actors: while their character rides inside the formation, they see
 * through the party token (vision needs OBSERVER+) and may move it.
 */
async function syncPartyActorOwnership(formation) {
  const partyActor = getPartyActor(formation);
  if (!partyActor) return;
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;

  const desired = {
    default: game.settings.get(MODULE_ID, "playersMoveParty") ? LEVELS.OWNER : LEVELS.NONE,
  };
  const memberActors = formation.members.map((m) => game.actors.get(m.actorId)).filter(Boolean);
  for (const user of game.users) {
    if (user.isGM) continue;
    const level = Math.max(0, ...memberActors.map((a) => a.getUserLevel(user) ?? 0));
    if (level >= LEVELS.OWNER) desired[user.id] = LEVELS.OWNER;
  }

  // Compare against current explicit ownership before writing.
  const current = partyActor.ownership ?? {};
  const keys = new Set([...Object.keys(current), ...Object.keys(desired)]);
  let dirty = false;
  for (const key of keys) {
    if ((current[key] ?? LEVELS.NONE) !== (desired[key] ?? LEVELS.NONE)) {
      dirty = true;
      break;
    }
  }
  if (dirty) await partyActor.update({ ownership: desired }, { diff: false, recursive: false });
}

/**
 * The party token burns with the brightest source ANY member has lit — the
 * whole party shares one light radius while it shares one token. A member who
 * has deployed or detached takes their own light with them: their token is
 * synced from `bearerLights`, which is why this reads the formation's whole list
 * and the individual path reads only what that bearer carries.
 */
async function syncPartyTokenLight(formation) {
  const token = getPartyToken(formation);
  if (!token) return;
  const carried = formation.lights.filter((l) => !isDeployed(formation, l.bearerId));
  await applyTokenLight(token, emittedLight(carried));
}

/**
 * The party token sees as well as its best-sighted member: a party with a
 * lightless-vision member is not blind merely because it rides in one token.
 * Members who have left the token do not lend it their eyes.
 */
async function syncPartyTokenVision(formation) {
  // The party token is written directly rather than through syncTokenFromActor
  // (the party actor has no senses of its own), so the world switch that turns
  // the vision pass off has to be honoured here too.
  if (!game.settings.get(MODULE_ID, SETTING_MANAGE_VISION)) return;
  const token = getPartyToken(formation);
  if (!token) return;
  let best = { seesInDark: false, sightRange: 0, visionMode: VISION_MODES.BASIC };
  for (const member of formation.members) {
    if (!member?.actorId || member.blank || isDeployed(formation, member.actorId)) continue;
    const actor = game.actors.get(member.actorId);
    if (!actor) continue;
    const profile = senseProfile(actor);
    if (profile.sightRange > best.sightRange) best = profile;
  }
  await applyTokenVision(token, best);
}

/** Is the member holding this actor currently out of the party token? */
function isDeployed(formation, actorId) {
  if (!actorId) return false;
  return formation.members.some((m) => m?.actorId === actorId && isMemberDeployed(m));
}

/**
 * A member out of the party token carries their own torch and sees with their
 * own eyes. Their token is synced from the actor exactly like any standalone
 * creature's — the only difference being that `bearerLights` finds their light
 * in the formation's record rather than on the actor.
 *
 * This is what makes a detach worth doing: the scout walks into the dark with
 * whatever their character can actually see by.
 *
 * A member out as a STACK is synced body by body: each body stands on its own
 * token over its own actor, so the one that took a wound or lit a lamp is not
 * made to see and burn like the rest of the crowd.
 */
async function syncDeployedMemberTokens(formation) {
  const scene = getPartyToken(formation)?.parent ?? game.scenes.get(formation.sceneId);
  if (!scene) return;
  for (const member of formation.members) {
    if (!isMemberDeployed(member)) continue;
    for (const token of await deployedTokens(member, scene)) await syncTokenFromActor(token);
  }
}

/**
 * The party token wears the formation's face: as wide across the line of
 * march as its frontage in feet at this scene's scale, and as deep as its
 * ranks. Token width/height are axis-aligned and never rotate, so an
 * east/west heading swaps the two. Generic tokens are sized by
 * battlemap/token-scale.mjs; the party token is its one exemption and is
 * sized here only.
 */
export async function syncPartyTokenSize(formation) {
  const token = getPartyToken(formation);
  if (!token) return;
  const distance = token.parent?.grid?.distance;
  if (!(distance > 0)) return;
  const across = tokenSpan(faceWidthFeet(formation), distance);
  const deep = tokenSpan(partyDepth(formation) * FEET_PER_RANK, distance);
  const heading = formationHeading(formation);
  const sideways = heading === "east" || heading === "west";
  const width = sideways ? deep : across;
  const height = sideways ? across : deep;
  if (Math.abs(token.width - width) < 1e-6 && Math.abs(token.height - height) < 1e-6) return;
  await token.update({ width, height });
}

/**
 * Reconcile fog and token light everywhere. Cheap when nothing changed (every
 * write is compared first), so it is safe to call after each formation update.
 */
export async function syncEnvironments() {
  if (!game.user.isGM) return;
  const formations = Object.values(getFormations());

  /**
   * Every step is fault-isolated, and must stay that way. These run in
   * sequence, so an unguarded throw in the FIRST step (token light) leaves
   * ownership, token size, fog, measurement and map sessions unsynced — and the
   * caller only logs, so the table just sees the map go dark with no error
   * surfaced. A failing step must cost only itself.
   */
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} | environment sync step "${label}" failed`, err);
    }
  };

  if (game.settings.get(MODULE_ID, "syncTokenLight")) {
    for (const formation of formations) {
      await step("token light", () => syncPartyTokenLight(formation));
    }
  }

  for (const formation of formations) {
    await step("party ownership", () => syncPartyActorOwnership(formation));
    await step("token size", () => syncPartyTokenSize(formation));
    await step("party vision", () => syncPartyTokenVision(formation));
    await step("member tokens", () => syncDeployedMemberTokens(formation));
  }

  if (!game.settings.get(MODULE_ID, "manageFog")) return;
  const byScene = new Map();
  for (const formation of formations) {
    if (!formation.sceneId || !formation.members.length) continue;
    if (!byScene.has(formation.sceneId)) byScene.set(formation.sceneId, []);
    byScene.get(formation.sceneId).push(formation);
  }

  for (const [sceneId, group] of byScene) {
    const scene = game.scenes.get(sceneId);
    if (!scene) continue;
    await step("scene fog", () => syncSceneFog(scene, group));
    await step("measurement", () => syncMeasureFlag(scene, group));
    // Assigning a Mapper IS "start mapping": open a session automatically.
    if (game.settings.get(MODULE_ID, "manageFog")) {
      for (const formation of group) {
        if (canMap(formation) && !formation.mapSession) {
          try {
            await ensureMapSession(formation);
          } catch (err) {
            console.error(`${MODULE_ID} | auto map session failed`, err);
          }
        }
      }
    }
  }

  // Scenes we managed previously but that no longer host a formation.
  for (const scene of game.scenes) {
    if (byScene.has(scene.id)) continue;
    if (scene.getFlag(MODULE_ID, "fogOriginal") !== undefined) {
      await step("release fog", () => releaseSceneFog(scene));
    }
    await step("release measurement", () => releaseMeasureFlag(scene));
  }
}
