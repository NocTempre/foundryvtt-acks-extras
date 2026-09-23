/* global game, canvas, CONST */
/**
 * The shadow token: where the party really is, while it believes otherwise.
 *
 * A lost party is an object in space, not a coordinate. The book says so
 * (RR p. 285) — a searching group finds a lost one the way it finds a point of
 * interest, and every lost group shares the same last known landmark so they
 * can rendezvous there. Both of those are distance questions, and Foundry
 * already answers distance questions about TOKENS.
 *
 * So the truth is a hidden token: unlinked, vision-less, flagged to its
 * formation, and deleted from every scene when the episode closes or its
 * formation is dissolved. The players' token stands at the believed hex and is
 * the one they drag; the shadow marks where the party really is.
 *
 * The shadow holds no state the ledger does not already own, so losing it
 * costs nothing but a re-place — which is exactly why it can be deleted
 * without ceremony.
 */
import { MODULE_ID } from "../lib/constants.mjs";

/** The flag naming which formation a shadow belongs to. */
export const SHADOW_FLAG = "shadowFor";

/**
 * The update option on a party token moved onto its shadow: the party was
 * always there, so the move is not a walk and the movement hook skips it.
 */
export const TRUTH_MOVE_OPTION = `${MODULE_ID}.lostTruth`;

/** Every shadow on a scene, newest last. */
export function shadowsOn(scene) {
  return (scene?.tokens ?? []).filter((t) => t.getFlag(MODULE_ID, SHADOW_FLAG));
}

/** This formation's shadow on a scene, or null. */
export function shadowFor(scene, formationId) {
  return shadowsOn(scene).find((t) => t.getFlag(MODULE_ID, SHADOW_FLAG) === formationId) ?? null;
}

/** Every shadow of one formation, on every scene. */
export function shadowsOf(formationId) {
  if (!formationId) return [];
  return [...(game.scenes ?? [])].flatMap((scene) => shadowsOn(scene).filter((t) => t.getFlag(MODULE_ID, SHADOW_FLAG) === formationId));
}

/**
 * Place or move a formation's shadow to a hex.
 *
 * Hidden and sightless on purpose: it must never light the scene, never grant
 * a player vision, and never appear in a token list a player can read. It is a
 * Judge's pin that happens to be a token so that distance works.
 */
export async function placeShadow(scene, formation, offset) {
  if (!game.user?.isGM || !scene || !formation) return null;
  const actor = game.actors.get(formation.actorId);
  if (!actor) return null;
  const point = scene.grid.getCenterPoint(offset);
  const existing = shadowFor(scene, formation.id);
  if (existing) {
    // `animate: false` — a scripted read straight after an animated update
    // returns a mid-tween position, which reads as a drift bug in the feature.
    await existing.update({ x: point.x - (scene.grid.sizeX / 2), y: point.y - (scene.grid.sizeY / 2) },
      { animate: false });
    return existing;
  }
  const [made] = await scene.createEmbeddedDocuments("Token", [{
    name: `${actor.name} (true)`,
    actorId: actor.id,
    actorLink: false,
    hidden: true,
    x: point.x - (scene.grid.sizeX / 2),
    y: point.y - (scene.grid.sizeY / 2),
    sight: { enabled: false },
    displayName: CONST.TOKEN_DISPLAY_MODES?.NONE ?? 0,
    displayBars: CONST.TOKEN_DISPLAY_MODES?.NONE ?? 0,
    flags: { [MODULE_ID]: { [SHADOW_FLAG]: formation.id } },
  }]);
  return made ?? null;
}

/** Delete shadow tokens, one call per scene. Returns how many went. */
async function deleteShadows(tokens) {
  const byScene = new Map();
  for (const t of tokens) {
    if (!t.parent) continue;
    byScene.set(t.parent, [...(byScene.get(t.parent) ?? []), t.id]);
  }
  let count = 0;
  for (const [scene, ids] of byScene) {
    await scene.deleteEmbeddedDocuments("Token", ids);
    count += ids.length;
  }
  return count;
}

/**
 * Remove a formation's shadows from every scene. Total, and safe to call when
 * there are none. Returns how many were deleted.
 */
export async function clearShadows(formationId) {
  if (!game.user?.isGM) return 0;
  return deleteShadows(shadowsOf(formationId));
}

/**
 * Remove every shadow whose formation is not in `liveIds`: a formation that no
 * longer exists has no episode for its shadow to stand in.
 */
export async function clearOrphanShadows(liveIds) {
  if (!game.user?.isGM) return 0;
  const orphans = [...(game.scenes ?? [])].flatMap((scene) =>
    shadowsOn(scene).filter((t) => !liveIds.has(t.getFlag(MODULE_ID, SHADOW_FLAG))));
  return deleteShadows(orphans);
}

/** Where a formation REALLY is on a scene: its shadow if one stands, else its own token. */
export function truePositionToken(scene, formation) {
  return shadowFor(scene, formation?.id) ?? (scene?.tokens ?? []).find((t) => t.actorId === formation?.actorId) ?? null;
}

/**
 * Which other lost parties are close enough to stumble into this one.
 *
 * Measured between SHADOWS, because two lost parties are both somewhere real
 * and neither knows it. Distance is the grid's own — a hex count on a hex
 * scene — so the answer is in the units the wilderness rules already speak.
 */
export function nearbyLost(scene, formationId, { within = 1 } = {}) {
  const mine = shadowFor(scene, formationId);
  if (!mine) return [];
  const out = [];
  for (const other of shadowsOn(scene)) {
    const id = other.getFlag(MODULE_ID, SHADOW_FLAG);
    if (id === formationId) continue;
    const path = canvas?.grid?.measurePath?.([
      { x: mine.x, y: mine.y },
      { x: other.x, y: other.y },
    ]);
    const distance = path?.distance ?? null;
    const spaces = path?.spaces ?? null;
    const gap = spaces ?? distance;
    if (gap != null && gap <= within) out.push({ formationId: id, token: other, distance, spaces });
  }
  return out;
}
