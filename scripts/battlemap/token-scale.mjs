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
import { FLAG_EXTRAS } from "../monsters/constants.mjs";
import { sizeSquareFeet, sizeSquares } from "../monsters/sizes.mjs";
import { FLAG_FORMATION_ID, PARTY_TYPE } from "../formation/constants.mjs";
import { unset } from "../lib/util.mjs";
import { isMarkerActor } from "../lib/place.mjs";

const EPSILON = 1e-6;

/** Whether tokens placed on this scene are auto-sized to its scale. */
export function autoScaleEnabled(scene) {
  return sceneSetup(scene).autoScale;
}

/**
 * What a token's body occupies at its scene's scale, and where that figure
 * comes from. Judged is false for the tokens that have no footprint to hold
 * to: a party token (it has no body), a marker's token (it is as big as the
 * Judge drew it: a market square, a guild's banner or a barony is not a
 * creature with a size category to fit to the scene's squares), and a scene
 * without a usable grid distance. A `footprintLock` token IS judged: the lock
 * stops writes to its size, not the reading of it. Judged with `feet` null:
 * the monster book's square, or the actor's size category frontage, is not
 * imported.
 * @param {object} tokenDoc  The token document.
 * @param {object} [scene]  The scene the token is on.
 * @returns {{judged: boolean, feet: {w:number,h:number}|null, feetPerCell: number,
 *   source: "token"|"actor"|"size"|"square"|null, sizeKey: string|null}}
 *   `source` names what `footprintFeet` took the figure from: the flag on the
 *   token, the flag on the actor, the size category over the imported square,
 *   or the imported square alone; null where `feet` is. `feetPerCell` is the
 *   scene's cell in feet, since footprints are in FEET and a scene's cells are
 *   in its own units: six MILES per hex is the case that makes an unconverted
 *   distance size a man as though he were a county.
 */
export function footprintOf(tokenDoc, scene = tokenDoc?.parent) {
  const unjudged = { judged: false, feet: null, feetPerCell: 0, source: null, sizeKey: null };
  if (!tokenDoc || tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return unjudged;
  // A party actor's token carries no formation flag where it is the
  // formation's shadow on a hex scene, so the actor's type decides too.
  if (tokenDoc.actor?.type === PARTY_TYPE) return unjudged;
  if (isMarkerActor(tokenDoc.actor)) return unjudged;
  const feetPerCell = sceneFeetPerCell(scene);
  if (!(feetPerCell > 0)) return unjudged;
  const tokenFlag = tokenDoc.getFlag(MODULE_ID, FLAG_FOOTPRINT);
  const actorFlag = tokenDoc.actor?.getFlag(MODULE_ID, FLAG_FOOTPRINT);
  // The token's flag shadows the actor's even where it is unusable, and an
  // unusable override is no override: the figure then comes from the category.
  const override = tokenFlag ?? actorFlag ?? null;
  const sizeKey = tokenDoc.actor?.getFlag(MODULE_ID, FLAG_EXTRAS)?.size ?? null;
  const feet = footprintFeet({ override, sizeKey, feetPerSquare: sizeSquareFeet() });
  let source = null;
  if (feet) {
    if (override && override.w > 0 && override.h > 0) source = tokenFlag != null ? "token" : "actor";
    else source = sizeKey ? "size" : "square";
  }
  return { judged: true, feet, feetPerCell, source, sizeKey };
}

/**
 * Whether a token is ours to size, and the size it takes. Not ours: whatever
 * `footprintOf` does not judge, and locked tokens. Ours with no size: the
 * footprint is not imported, so it keeps the size it has. `sizeKey` is the
 * token's size category, which the report of what a kept token lacks reads.
 * @returns {{ours: boolean, size: {width:number, height:number}|null, sizeKey: string|null}}
 */
function resolveSize(tokenDoc, scene) {
  const notOurs = { ours: false, size: null, sizeKey: null };
  if (!tokenDoc || tokenDoc.getFlag(MODULE_ID, FLAG_FOOTPRINT_LOCK)) return notOurs;
  const { judged, feet, feetPerCell, sizeKey } = footprintOf(tokenDoc, scene);
  if (!judged) return notOurs;
  return { ours: true, size: feet ? { width: tokenSpan(feet.w, feetPerCell), height: tokenSpan(feet.h, feetPerCell) } : null, sizeKey };
}

/**
 * The size (in grid squares) this token should occupy on its scene, or null
 * when the token is not ours to size (party tokens, locked tokens, markers,
 * scenes without a usable grid distance) or the square or its actor's size
 * category frontage is not imported.
 * @returns {{width:number, height:number}|null}
 */
export function sizeForToken(tokenDoc, scene = tokenDoc?.parent) {
  return resolveSize(tokenDoc, scene).size;
}

/**
 * How many tokens on the scene are ours to size but have no footprint because
 * the square or their size category's frontage is not imported: they keep the
 * size they have.
 */
export function unsizedTokenCount(scene) {
  return unsizedTokenReport(scene).count;
}

/**
 * The tokens `unsizedTokenCount` counts, and which import each is waiting on:
 * `square` where the footprint square is not imported (every token that is ours
 * and has no override lacks it), `frontage` where a kept token's size category
 * has no frontage cell. Both can hold at once, and neither does when no token
 * is kept.
 * @returns {{count: number, square: boolean, frontage: boolean}}
 */
export function unsizedTokenReport(scene) {
  const report = { count: 0, square: false, frontage: false };
  const squareImported = sizeSquareFeet() > 0;
  for (const token of scene?.tokens ?? []) {
    const { ours, size, sizeKey } = resolveSize(token, scene);
    if (!ours || size) continue;
    report.count++;
    if (!squareImported) report.square = true;
    if (sizeKey && !sizeSquares(sizeKey)) report.frontage = true;
  }
  return report;
}

/**
 * Whether the size a token STORES differs from `size`. The prepared
 * `width`/`height` are core's animated values: a token animation merges its
 * frames into the document, and its first frame runs synchronously, so right
 * after an update (or with the ticker frozen) the prepared width is the tween's
 * start and not what was written. `_source` is the stored size, and is what
 * `updateSource` writes inside `preCreateToken`.
 */
const changed = (tokenDoc, size) => {
  const stored = tokenDoc._source ?? tokenDoc;
  return Math.abs(stored.width - size.width) > EPSILON || Math.abs(stored.height - size.height) > EPSILON;
};

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
    await token.update({ [`flags.${MODULE_ID}.${FLAG_FOOTPRINT}`]: unset(), [`flags.${MODULE_ID}.${FLAG_FOOTPRINT_LOCK}`]: unset() });
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
