/* global game, CONST */
/**
 * The shadow token: where the party really is, while it believes otherwise.
 *
 * The truth is a hidden token (RR p. 285): unlinked, vision-less, flagged to
 * its formation, and deleted from every scene when the episode closes or its
 * formation is dissolved. The players' token stands at the believed hex; the
 * shadow marks where the party really is. It holds no state the ledger does
 * not own, so deleting it costs only a re-place. See docs/formation/DECISIONS.md,
 * "The true position is a SHADOW TOKEN, not a coordinate".
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
 * The token is hidden and sightless: it never lights the scene, grants vision,
 * or appears in a token list a player can read. GM only; returns the token or null.
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

/**
 * Where a formation REALLY is on a scene: its shadow while `open` (a lost
 * episode is running) and one stands, else its own token. A shadow an ended
 * episode left standing is not where the party is, so a caller that knows
 * no episode is open passes `open` false and reads the token.
 */
export function truePositionToken(scene, formation, { open = true } = {}) {
  const shadow = open ? shadowFor(scene, formation?.id) : null;
  if (shadow) return shadow;
  // The record's own token, and only on its own scene: a copy of the party
  // actor's token elsewhere is not where the party stands.
  // `getPartyToken`'s read, inlined: formation-model imports this file.
  return formation?.tokenId && formation.sceneId === scene?.id ? (scene.tokens.get(formation.tokenId) ?? null) : null;
}
