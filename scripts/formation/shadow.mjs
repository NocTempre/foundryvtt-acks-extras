/* global game, canvas, CONST */
/**
 * The shadow token: where the party really is, while it believes otherwise.
 *
 * A lost party is an object in space, not a coordinate. The book says so — a
 * searching group finds a lost one "as if it were a point of interest", and
 * every lost group shares the same last known landmark so they can rendezvous
 * there. Both of those are distance questions, and Foundry already answers
 * distance questions about TOKENS.
 *
 * So the truth is a hidden token: unlinked, vision-less, flagged to its
 * formation, deleted when the episode ends. The players' token stands at the
 * believed hex and is the one they drag; the shadow is what every derivation
 * that asks "where is this party" actually reads.
 *
 * The shadow holds no state the ledger does not already own, so losing it
 * costs nothing but a re-place — which is exactly why it can be deleted
 * without ceremony.
 */
import { MODULE_ID } from "../lib/constants.mjs";

/** The flag naming which formation a shadow belongs to. */
export const SHADOW_FLAG = "shadowFor";

/** Every shadow on a scene, newest last. */
export function shadowsOn(scene) {
  return (scene?.tokens ?? []).filter((t) => t.getFlag(MODULE_ID, SHADOW_FLAG));
}

/** This formation's shadow on a scene, or null. */
export function shadowFor(scene, formationId) {
  return shadowsOn(scene).find((t) => t.getFlag(MODULE_ID, SHADOW_FLAG) === formationId) ?? null;
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

/** Remove a formation's shadow. Total, and safe to call when there is none. */
export async function clearShadow(scene, formationId) {
  if (!game.user?.isGM) return false;
  const token = shadowFor(scene, formationId);
  if (!token) return false;
  await token.delete();
  return true;
}

/**
 * Where a formation REALLY is: its shadow if one stands, else its own token.
 *
 * The one accessor every derivation asks. Routing terrain, encounters and the
 * weather's climate through here is what lets an episode run without any of
 * them knowing one is running.
 */
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
