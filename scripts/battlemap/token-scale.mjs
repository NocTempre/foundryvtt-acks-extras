/* global game, canvas, Hooks */
/**
 * The one writer of width/height for GENERIC tokens. Formation party tokens
 * are the one exception and belong to formation's scene-sync (identified by
 * their formation flag) — each side skips the other's tokens, so a token
 * never has two size owners.
 */

import { MODULE_ID, FLAG_FOOTPRINT, FLAG_FOOTPRINT_LOCK } from "./constants.mjs";
import { sceneSetup } from "./scene-setup.mjs";
import { footprintFeet, tokenSpan } from "./footprint.mjs";
import { sceneFeetPerCell } from "../lib/distance-units.mjs";
import { SIZES } from "../monsters/config.mjs";
import { FLAG_EXTRAS } from "../monsters/constants.mjs";
import { FLAG_FORMATION_ID } from "../formation/constants.mjs";

const EPSILON = 1e-6;

/** Whether tokens placed on this scene are auto-sized to its scale. */
export function autoScaleEnabled(scene) {
  return sceneSetup(scene).autoScale;
}

/**
 * The size (in grid squares) this token should occupy on its scene, or null
 * when the token is not ours to size: party tokens (formation-owned), locked
 * tokens, and scenes without a usable grid distance.
 * @returns {{width:number, height:number}|null}
 */
export function sizeForToken(tokenDoc, scene = tokenDoc.parent) {
  if (!tokenDoc || tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return null;
  if (tokenDoc.getFlag(MODULE_ID, FLAG_FOOTPRINT_LOCK)) return null;
  // Footprints are in FEET and a scene's squares are in its own units, so
  // the conversion goes through them: six MILES per hex is the case that
  // makes an unconverted distance size a man as though he were a county.
  const distance = sceneFeetPerCell(scene);
  if (!(distance > 0)) return null;
  const override = tokenDoc.getFlag(MODULE_ID, FLAG_FOOTPRINT) ?? tokenDoc.actor?.getFlag(MODULE_ID, FLAG_FOOTPRINT) ?? null;
  const sizeKey = tokenDoc.actor?.getFlag(MODULE_ID, FLAG_EXTRAS)?.size ?? null;
  const feet = footprintFeet({ override, sizeKey, sizes: SIZES });
  return { width: tokenSpan(feet.w, distance), height: tokenSpan(feet.h, distance) };
}

const changed = (tokenDoc, size) =>
  Math.abs(tokenDoc.width - size.width) > EPSILON || Math.abs(tokenDoc.height - size.height) > EPSILON;

/**
 * Resize every token on the scene to its footprint at the scene's scale.
 * Cheap when nothing changed: only differing tokens are written.
 * @returns {Promise<number>} how many tokens were resized.
 */
export async function rescaleSceneTokens(scene) {
  if (!scene) return 0;
  const updates = [];
  for (const token of scene.tokens) {
    const size = sizeForToken(token, scene);
    if (size && changed(token, size)) updates.push({ _id: token.id, ...size });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}

/**
 * Stamp a footprint override (feet) on the selected tokens and resize them —
 * the size hotbar's handler. Party tokens are skipped: their size is the
 * formation's face, not a chip.
 * @returns {Promise<number>} how many tokens were stamped.
 */
export async function applyFootprintToSelected({ w, h }) {
  if (!(w > 0) || !(h > 0)) return 0;
  let count = 0;
  for (const placeable of canvas?.tokens?.controlled ?? []) {
    const token = placeable.document;
    if (token.getFlag(MODULE_ID, FLAG_FORMATION_ID)) continue;
    const distance = sceneFeetPerCell(token.parent);
    const size = distance > 0 ? { width: tokenSpan(w, distance), height: tokenSpan(h, distance) } : {};
    await token.update({ [`flags.${MODULE_ID}.${FLAG_FOOTPRINT}`]: { w, h }, ...size });
    count++;
  }
  return count;
}

/**
 * Clear the footprint override from the selected tokens and re-derive their
 * size from size category / default.
 * @returns {Promise<number>} how many tokens were reset.
 */
export async function resetSelectedFootprints() {
  let count = 0;
  for (const placeable of canvas?.tokens?.controlled ?? []) {
    const token = placeable.document;
    if (token.getFlag(MODULE_ID, FLAG_FORMATION_ID)) continue;
    await token.update({ [`flags.${MODULE_ID}.-=${FLAG_FOOTPRINT}`]: null, [`flags.${MODULE_ID}.-=${FLAG_FOOTPRINT_LOCK}`]: null });
    const size = sizeForToken(token);
    if (size && changed(token, size)) await token.update(size);
    count++;
  }
  return count;
}

/**
 * Auto-size tokens as they are placed on scenes that opted in (the assistant
 * sets the scene's autoScale flag on apply; the scene-config row toggles it).
 * preCreateToken runs on the initiating client, so the mutation lands before
 * the document is created — redeploys and drags both flow through here.
 */
export function installTokenAutoScale() {
  Hooks.on("preCreateToken", (doc, _createData, _options, userId) => {
    if (userId !== game.userId) return;
    const scene = doc.parent;
    if (!autoScaleEnabled(scene)) return;
    const size = sizeForToken(doc, scene);
    if (size && changed(doc, size)) doc.updateSource(size);
  });
}
