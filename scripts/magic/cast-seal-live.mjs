/* global game, Hooks, fromUuidSync, ui */
/**
 * A seal on a door as the live world has it (`cast-seal.mjs` is the model). A
 * GM's seat writes the wall directly; a Player's seat asks the GM's client
 * through `SEAL_HANDLER`, which checks the attested sender against the world's
 * own facts and never the payload's claims.
 *
 * The seal's end is the active GM's: when a caster record that names a sealed
 * wall is deleted, however it went, that seat takes the cast off the wall's
 * stamp. A GM `ready` sweep ends the casts whose record is gone, which catches
 * a record deleted while no GM was connected or with its actor.
 */
import { MODULE_ID } from "./constants.mjs";
import {
  SEAL_HANDLER,
  FLAG_SEALED_BY,
  SEAL_ROW_TYPE,
  checkSealRequest,
  readStamp,
  sealWrite,
  sealEndAll,
  orphanCasts,
  nearestOnWall,
  sealOf,
} from "./cast-seal.mjs";
import { spellEffectOf } from "./spell-effect.mjs";
import { effectRowsOf, rowsOf } from "./cast-rows.mjs";
import { worldActors } from "../lib/repair.mjs";
import { centreOfToken, pointGapFeet } from "../lib/distance-units.mjs";
import { isPrimaryGM, unset } from "../lib/util.mjs";
import { registerHandler, executeAsGM, judgeDeclares } from "../lib/sockets.mjs";

/** The wall's flag path for the stamp. */
const STAMP_PATH = `flags.${MODULE_ID}.${FLAG_SEALED_BY}`;

/** The wall a scene id and a wall id name, or null. */
const wallOf = (sceneId, wallId) => game.scenes?.get(sceneId)?.walls?.get(wallId) ?? null;

/** The tokens of an actor across the world's scenes: the scene each stands on and the token itself. */
function tokensOf(actor) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actor?.uuid === actor?.uuid) out.push({ sceneId: scene.id, token });
    }
  }
  return out;
}

/** Whether the spell carries a seal row, its own or its library twin's. */
async function spellHasSealRow(spell) {
  if (!spell) return false;
  if (effectRowsOf(spell).some((row) => row.type === SEAL_ROW_TYPE)) return true;
  const { byCookbookId } = await import("../lib/library.mjs");
  return rowsOf(spell, { byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) }).rows.some((row) => row.type === SEAL_ROW_TYPE);
}

/**
 * The GM's client seals a door: the request is checked against what this
 * client reads, then the wall's door state is set LOCKED and its stamp written.
 * The range is the cast's own, passed by the asking seat; a blank is not measured.
 *
 * @param {{requestUserId?: string|null, casterUuid: string, spellUuid: string, castId: string, sceneId: string, wallId: string, rangeFeet?: number|null}} payload
 * @returns {Promise<{ok: boolean, reason?: string, was?: number, warn?: "outOfRange"}>}
 */
export async function sealHandler(payload = {}) {
  const caster = payload.casterUuid ? fromUuidSync(payload.casterUuid) : null;
  const user = game.users.get(payload.requestUserId);
  const fromJudge = judgeDeclares(payload.requestUserId);
  const wall = wallOf(payload.sceneId, payload.wallId);
  const tokens = tokensOf(caster);
  const own = tokens.find((t) => t.sceneId === payload.sceneId);
  let gapFeet = null;
  if (wall && own) {
    const from = centreOfToken(own.token);
    const to = nearestOnWall(wall.c, from);
    gapFeet = from && to ? pointGapFeet(wall.parent, from, to) : null;
  }
  const verdict = checkSealRequest({
    fromJudge,
    owns: fromJudge || (Boolean(user) && caster?.testUserPermission?.(user, "OWNER") === true),
    hasSealRow: await spellHasSealRow(payload.spellUuid ? fromUuidSync(payload.spellUuid) : null),
    wall,
    sceneId: payload.sceneId,
    casterSceneIds: tokens.map((t) => t.sceneId),
    rangeFeet: payload.rangeFeet ?? null,
    gapFeet,
  });
  if (!verdict.ok) return verdict;
  const written = sealWrite(readStamp(wall.flags?.[MODULE_ID]?.[FLAG_SEALED_BY]), payload.castId, wall.ds);
  await wall.update({ ds: written.ds, [STAMP_PATH]: written.stamp });
  return verdict.warn ? { ok: true, was: written.stamp.was, warn: verdict.warn } : { ok: true, was: written.stamp.was };
}

/**
 * Seal a door from this seat: a GM's seat writes it here, a Player's asks the
 * GM's client. A request nobody answered is `{ok: false, reason: "noGm"}`.
 *
 * @param {object} request  `sealHandler`'s payload
 * @returns {Promise<{ok: boolean, reason?: string, was?: number, warn?: "outOfRange"}>}
 */
export async function writeSeal(request) {
  if (game.user.isGM) {
    const result = await sealHandler(request);
    if (result.warn === "outOfRange") ui.notifications.warn(game.i18n.localize("ACKS-MAGIC.castSeal.pick.far"));
    return result;
  }
  if (!game.users.activeGM) return { ok: false, reason: "noGm" };
  return (await executeAsGM(SEAL_HANDLER, request)) ?? { ok: false, reason: "noGm" };
}

/**
 * Take a cast's seal off its wall, from the GM's seat: the cast leaves the
 * stamp, and the door goes back only where the plan says (`sealEndPlan`). A wall
 * that no longer exists writes nothing and nothing throws.
 *
 * @param {{castId: string, seal: {sceneId: string, wallId: string}}} record  the cast and the wall its caster record named
 * @returns {Promise<boolean>} whether the wall was written
 */
export async function endSeal(record) {
  const wall = wallOf(record?.seal?.sceneId, record?.seal?.wallId);
  if (!wall) return false;
  const plan = sealEndAll(wall.flags?.[MODULE_ID]?.[FLAG_SEALED_BY], [record.castId], wall.ds);
  return writePlan(wall, plan);
}

/** Write what an end plan says to a wall. */
async function writePlan(wall, plan) {
  if (plan.noop) return false;
  const update = { [STAMP_PATH]: plan.stamp ?? unset() };
  if (plan.ds !== null) update.ds = plan.ds;
  await wall.update(update);
  return true;
}

/** A deleted caster record that names a seal ends it. */
function onDeleteEffect(effect) {
  if (!isPrimaryGM()) return;
  const seal = sealOf(effect);
  const record = spellEffectOf(effect);
  if (!seal || !record) return;
  endSeal({ castId: record.castId, seal }).catch((err) => console.error(`${MODULE_ID} | a seal's end could not be carried out`, err));
}

/**
 * Every stamp whose cast has no caster record left is ended. The live casts are
 * the caster records naming a seal on every actor and unlinked token.
 *
 * @returns {Promise<number>} the walls written
 */
export async function sweepSeals() {
  if (!isPrimaryGM()) return 0;
  const live = new Set();
  for (const actor of worldActors()) {
    for (const effect of actor.effects ?? []) {
      if (sealOf(effect)) live.add(spellEffectOf(effect)?.castId);
    }
  }
  let written = 0;
  for (const scene of game.scenes ?? []) {
    for (const wall of scene.walls ?? []) {
      const stamp = wall.flags?.[MODULE_ID]?.[FLAG_SEALED_BY];
      const orphans = orphanCasts(stamp, live);
      if (!orphans.length) continue;
      if (await writePlan(wall, sealEndAll(stamp, orphans, wall.ds))) written++;
    }
  }
  return written;
}

let registered = false;

/** Register the seal's handler, the end on a deleted record and the GM's `ready` sweep. Once, at `init`. */
export function registerCastSeal() {
  if (registered) return;
  registered = true;
  registerHandler(SEAL_HANDLER, sealHandler);
  Hooks.on("deleteActiveEffect", onDeleteEffect);
  Hooks.once("ready", () => {
    sweepSeals().catch((err) => console.error(`${MODULE_ID} | the seal sweep failed`, err));
  });
}
