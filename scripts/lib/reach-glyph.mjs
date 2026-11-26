/* global game, canvas, Hooks, PIXI, foundry, CONST */
/**
 * The glyph on a body inside a reach (canvas 4, board 4c, "on the map"): one
 * small ring on the token, drawn per client, with core's `icons/svg/aura.svg`,
 * and a readout over the token while it is hovered that carries the line the
 * "In reach of" strip carries for each reach.
 *
 * **One owner, on hooks alone.** The glyph is a named child of the token
 * (`REACH_GLYPH_NAME`) holding a backing, the icon sprite and the readout. It
 * rides the token, so fog and a hidden token hide it, and it is never a child
 * of core's `token.effects` (core clears that container on its own redraws) and
 * never an ActiveEffect's `showIcon` (core draws that for every seat). It is
 * found by name on each refresh and never held by document id: a drag preview
 * is a second Token with the same id, and core destroys a token's children on a
 * redraw. Nothing is written to any document and no core method is wrapped.
 *
 * **Who is shown it** is `shownReaches` over the Regions the token stands in:
 * the Region document's own `visibility`. A reach with `showReach` ticked is
 * made visible to everyone (`aura-reach.mjs`), so a Player seat sees its glyph;
 * any other reach's glyph is the Gamemaster's. The rows are read for the seat
 * after that filter, so a nearest engaged bearer the seat is not shown never
 * hides a farther one it is.
 *
 * **Where it sits.** The middle of the token's right edge at the size of core's
 * effect icons (`glyphSlot`): core lays its own icons from the top left, down
 * and then rightward, and the bars run along the top and bottom. The readout
 * stands above the token, since the not-to-scale mark's readout takes the strip
 * under the nameplate.
 *
 * **When it is worked out.** Membership changes on document writes, so a
 * debounced pass over the viewed scene answers a token's move, resize, hidden
 * flag or `_regions` change, a Region's or a Region behavior's making, change
 * or removal, an actor's or an effect's change (a reach's filter reads them),
 * and `canvasReady`. A token refresh only re-adds a glyph after a redraw and
 * moves it with the size. A scene with no aura Region costs one scan of its
 * Regions and draws nothing.
 */

import { AURA_BEHAVIOR_TYPE, MODULE_ID } from "./constants.mjs";
import { reachLineOf, reachRowsOn } from "./item-run-strip.mjs";
import { GLYPH_ICON, REACH_GLYPH_NAME, changesMembership, glyphKey, glyphSlot, shownReaches } from "./reach-glyph-logic.mjs";

export { REACH_GLYPH_NAME };

/** The milliseconds a burst of document writes is gathered for before the scene is re-worked. */
const SETTLE_MS = 120;

let texture = null;
let loading = false;
let reported = false;

/** Run a pass, logging a failure once rather than on every refresh it recurs. */
function guarded(work) {
  try {
    work();
  } catch (err) {
    if (reported) return;
    reported = true;
    console.error(`${MODULE_ID} | reach glyph failed`, err);
  }
}

/** The glyph on a token, or null. */
export function glyphOf(token) {
  return token?.children?.find((child) => child?.name === REACH_GLYPH_NAME && !child.destroyed) ?? null;
}

/** Whether this seat is a Gamemaster, and whether it holds Observer permission on a Region. */
function seat() {
  const user = game.user;
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  return { isGM: !!user?.isGM, observes: (region) => region?.testUserPermission?.(user, observer) === true };
}

/** Whether a scene holds any Region carrying the aura behavior. */
export function sceneHasReach(scene) {
  for (const region of scene?.regions ?? []) {
    for (const behavior of region.behaviors ?? []) if (behavior.type === AURA_BEHAVIOR_TYPE) return true;
  }
  return false;
}

/**
 * The rows of the reaches a token's body is shown by this seat: the strip's
 * rows, read after the visibility filter.
 * @param {TokenDocument} doc
 * @returns {object[]}
 */
function rowsFor(doc) {
  return doc?.actor ? reachRowsOn(doc, doc.actor, (found) => shownReaches(found, seat())) : [];
}

/** The texture, loaded once; a pass that finds it missing starts the load and runs again when it lands. */
function textureReady() {
  if (texture) return true;
  if (loading) return false;
  loading = true;
  const known = foundry.canvas.getTexture?.(GLYPH_ICON);
  if (known) {
    texture = known;
    loading = false;
    return true;
  }
  foundry.canvas
    .loadTexture(GLYPH_ICON)
    .then((tex) => {
      texture = tex ?? null;
      if (texture) refreshAllGlyphs();
    })
    .catch(() => null)
    .finally(() => {
      loading = false;
    });
  return false;
}

/** Lay the backing and the icon in the token's slot. */
function layGlyph(glyph, token, ui) {
  const slot = glyphSlot({ w: token.w, h: token.h, ui });
  glyph.bg.clear().beginFill(0x000000, 0.4).lineStyle(ui, 0x000000).drawRoundedRect(slot.x + ui, slot.y + ui, slot.size - 2 * ui, slot.size - 2 * ui, 2 * ui);
  glyph.icon.position.set(slot.x, slot.y);
  glyph.icon.width = glyph.icon.height = slot.size;
}

/** A new glyph on the token: backing, icon, deaf to pointer events. */
function addGlyph(token) {
  const glyph = new PIXI.Container();
  glyph.name = REACH_GLYPH_NAME;
  glyph.eventMode = "none";
  glyph.bg = glyph.addChild(new PIXI.Graphics());
  glyph.icon = glyph.addChild(new PIXI.Sprite(texture));
  token.addChild(glyph);
  return glyph;
}

/** Take the glyph, readout included, away from a token. */
function removeGlyph(glyph) {
  if (glyph && !glyph.destroyed) glyph.destroy({ children: true });
}

/**
 * Bring a token's glyph into line with the world: drawn, redrawn or removed.
 * Cheap where nothing changed, since a glyph is redrawn only when its key does.
 * @param {Token} token  The placeable.
 * @param {boolean} [reach]  Whether the token's scene holds a reach, where the caller has already scanned it; read here when omitted.
 */
export function refreshGlyph(token, reach) {
  if (!token || token.destroyed || token.isPreview) return;
  const existing = glyphOf(token);
  const doc = token.document;
  const here = !!canvas?.ready && doc?.parent?.id === canvas.scene?.id;
  if (!here || !(reach ?? sceneHasReach(doc.parent))) return removeGlyph(existing);
  if (!textureReady()) return;
  const rows = rowsFor(doc);
  if (!rows.length) return removeGlyph(existing);
  const ui = canvas.dimensions?.uiScale ?? 1;
  const key = glyphKey({ w: token.w, h: token.h, ui, reachKeys: rows.map((r) => r.key) });
  if (existing?.acksKey === key) return;
  removeGlyph(existing);
  const glyph = addGlyph(token);
  layGlyph(glyph, token, ui);
  glyph.acksKey = key;
  glyph.acksReaches = rows.map((r) => r.key);
  if (token.hover) showReadout(glyph, token);
}

/** Re-work every token on the viewed scene, scanning the scene's Regions once for the pass. */
export function refreshAllGlyphs() {
  if (!canvas?.ready) return;
  const reach = sceneHasReach(canvas.scene);
  for (const token of canvas.tokens?.placeables ?? []) guarded(() => refreshGlyph(token, reach));
}

/* -------------------------------------------- */
/*  The hover readout                           */
/* -------------------------------------------- */

/** The readout's lines for a token: one per row, the state added for the Gamemaster and the body's owner. */
function readoutLines(token) {
  const rows = rowsFor(token.document);
  const withTag = !!game.user?.isGM || token.document.isOwner === true;
  return rows.map((row) => reachLineOf(row, { withTag }));
}

/** Put the readout over the token, building its text on first use. */
function showReadout(glyph, token) {
  const ui = canvas.dimensions?.uiScale ?? 1;
  let text = glyph.readout;
  if (!text || text.destroyed) {
    // Rasterized at a fixed size and doubled resolution, then scaled by the
    // canvas's uiScale, as core draws a nameplate.
    const Text = globalThis.foundry?.canvas?.containers?.PreciseText ?? PIXI.Text;
    text = glyph.addChild(
      new Text("", {
        fontFamily: "Signika, sans-serif",
        fontSize: 14,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 4,
        align: "center",
        wordWrap: true,
        wordWrapWidth: Math.max((token.w * 3) / ui, 240),
      }),
    );
    text.scale?.set(ui, ui);
    text.anchor.set(0.5, 1);
    text.eventMode = "none";
    glyph.readout = text;
  }
  const lines = readoutLines(token);
  if (!lines.length) return hideReadout(glyph);
  text.text = lines.join("\n");
  text.position.set(token.w / 2, -2 * ui);
}

/** Take the readout away. */
function hideReadout(glyph) {
  if (glyph.readout && !glyph.readout.destroyed) glyph.readout.destroy();
  glyph.readout = null;
}

/** A token hovered or left: the readout follows the pointer. */
export function onHover(token, hovered) {
  const glyph = glyphOf(token);
  if (!glyph) return;
  if (hovered) showReadout(glyph, token);
  else hideReadout(glyph);
}

/* -------------------------------------------- */
/*  The wiring                                  */
/* -------------------------------------------- */

/**
 * The refresh listener. A redraw re-adds the glyph core destroyed with the
 * token's children; a size change moves it. Position and state alone leave it
 * as it is, since a token refreshes on every frame of a move.
 */
export function onRefreshToken(token, flags) {
  if (!flags) return;
  if (flags.redraw) return guarded(() => refreshGlyph(token));
  if (!flags.refreshSize) return;
  const glyph = glyphOf(token);
  if (!glyph) return;
  guarded(() => {
    const ui = canvas.dimensions?.uiScale ?? 1;
    layGlyph(glyph, token, ui);
    glyph.acksKey = glyphKey({ w: token.w, h: token.h, ui, reachKeys: glyph.acksReaches });
  });
}

/**
 * Register the hooks. Called once, at `init`.
 */
export function installReachGlyph() {
  const settle = foundry.utils.debounce(() => guarded(refreshAllGlyphs), SETTLE_MS);
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("hoverToken", (token, hovered) => guarded(() => onHover(token, hovered)));
  Hooks.on("canvasReady", () => guarded(refreshAllGlyphs));
  Hooks.on("updateToken", (_doc, change) => {
    if (changesMembership(change)) settle();
  });
  for (const name of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(name, settle);
  }
}
