/* global game, canvas, Hooks, PIXI, CONFIG */
/**
 * The not-to-scale mark: a frame on a token whose size on the map is not its
 * footprint at the scene's scale, drawn as a magnifying glass (a rim along the
 * token's own shape and a short handle from its lower right). The model is in
 * docs/battlemap/MODEL.md, "Token sizing — ownership".
 *
 * **One owner, on hooks alone.** Each marked token carries one `PIXI.Graphics`
 * child named `SCALE_MARK_NAME`, deaf to pointer events and first among the
 * token's children. It rides the token, so fog and a hidden token hide it. The
 * child is found by name on each refresh and never held by document id: a drag
 * preview is a second Token with the same id, and core destroys a token's
 * children on a redraw, so a missing child is simply a mark still to draw.
 * Nothing is written to any document and no core method is wrapped; every
 * client works the mark out for itself.
 *
 * **Two readings of the size.** The verdict reads the STORED size
 * (`document._source`): the prepared width is core's animated value and would
 * flicker the verdict through a resize tween. The rim follows `token.shape`,
 * which animates, so the redraw key carries both.
 *
 * **The hover readout** is canvas text inside the mark, under the nameplate,
 * since the canvas has no tooltip manager. Every figure is read from the world
 * at render.
 */

import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { footprintOf } from "./token-scale.mjs";
import { scaleMismatch } from "./footprint.mjs";
import { SIZE_DOC, SQUARE_TABLE, sizeCite, sizeSquares, sizeSquareFeet } from "../monsters/sizes.mjs";
import { SIZES } from "../monsters/config.mjs";
import { citeOf, onTablesChanged } from "../lib/tables.mjs";

/** The name of the mark's child on a token, which is how a page script finds it. */
export const SCALE_MARK_NAME = "acks-extras-scale-mark";

/** The client setting that turns the mark off for one seat. */
export const SETTING_SCALE_MARK = "scaleMark";

/** The mark's colour: none of core's disposition, party or control colours. */
const MARK_COLOR = 0xff5caa;

/**
 * The render flags of a token refresh that can change what the mark says or
 * where it sits: a redraw, its size, its shape, its state or its visibility.
 * Position and elevation alone leave it as it is.
 */
const SCALE_FLAGS = Object.freeze(["redraw", "refreshSize", "refreshShape", "refreshState", "refreshVisibility"]);

const KEYS = Object.freeze({
  larger: `${LANG_PREFIX}.scaleMark.larger`,
  smaller: `${LANG_PREFIX}.scaleMark.smaller`,
  mixed: `${LANG_PREFIX}.scaleMark.mixed`,
  drawn: `${LANG_PREFIX}.scaleMark.drawn`,
  footprint: `${LANG_PREFIX}.scaleMark.footprint`,
  sourceToken: `${LANG_PREFIX}.scaleMark.sourceToken`,
  sourceActor: `${LANG_PREFIX}.scaleMark.sourceActor`,
  sourceSize: `${LANG_PREFIX}.scaleMark.sourceSize`,
  sourceSquare: `${LANG_PREFIX}.scaleMark.sourceSquare`,
  cite: `${LANG_PREFIX}.scaleMark.cite`,
});

/** Whether a token refresh's render flags carry one the mark answers. */
export function carriesScaleFlag(flags) {
  return !!flags && SCALE_FLAGS.some((flag) => flags[flag]);
}

/**
 * What a drawn mark was built from: the token's pixel size and shape, the
 * verdict and the interface scale. A refresh whose key is the mark's own key
 * changes nothing.
 * @param {object} input
 * @param {number} input.w  The token's pixel width, animated.
 * @param {number} input.h  The token's pixel height, animated.
 * @param {number|string} input.shape  The token's shape setting.
 * @param {{dir: string, exact: {w:number,h:number}}} input.verdict  From `scaleMismatch`.
 * @param {number} input.ui  The canvas's interface scale.
 */
export function markKey({ w, h, shape, verdict, ui }) {
  const n = (v) => Number(v).toFixed(4);
  return [n(w), n(h), shape, verdict.dir, n(verdict.exact.w), n(verdict.exact.h), n(ui)].join("|");
}

/** Whether this seat draws the mark. */
const enabled = () => !!game.settings.get(MODULE_ID, SETTING_SCALE_MARK);

/** The mark on a token, or null. */
export function markOf(token) {
  return token?.children?.find((child) => child?.name === SCALE_MARK_NAME && !child.destroyed) ?? null;
}

/**
 * Judge a token: its footprint against its stored size. Null where the token
 * is not judged, has no footprint, or is drawn to scale.
 */
function judge(token) {
  const doc = token?.document;
  const scene = doc?.parent;
  if (!doc || !scene) return null;
  const fp = footprintOf(doc, scene);
  if (!fp.judged || !fp.feet) return null;
  const stored = doc._source ?? doc;
  const verdict = scaleMismatch({ feet: fp.feet, feetPerCell: fp.feetPerCell, width: stored.width, height: stored.height });
  return verdict ? { verdict, fp, doc, scene, width: stored.width, height: stored.height } : null;
}

/* -------------------------------------------- */
/*  The drawing                                 */
/* -------------------------------------------- */

/**
 * The point of a token's shape furthest toward its lower right, where the
 * handle starts: the corner of a rectangle, the 45-degree point of a circle or
 * an ellipse, the vertex of a polygon with the greatest x + y. Shapes are told
 * by their fields, not their class.
 * @param {object} shape  A PIXI Rectangle, Circle, Ellipse or Polygon.
 * @returns {{x:number,y:number}}
 */
export function handleAnchor(shape) {
  const k = Math.SQRT1_2;
  if (Array.isArray(shape.points)) {
    let best = { x: shape.points[0] ?? 0, y: shape.points[1] ?? 0 };
    for (let i = 0; i + 1 < shape.points.length; i += 2) {
      const p = { x: shape.points[i], y: shape.points[i + 1] };
      if (p.x + p.y > best.x + best.y) best = p;
    }
    return best;
  }
  if (shape.radius > 0) return { x: shape.x + shape.radius * k, y: shape.y + shape.radius * k };
  // A PIXI Ellipse stores its half extents as `width` and `height`; type 3.
  if (shape.type === 3) return { x: shape.x + shape.width * k, y: shape.y + shape.height * k };
  return { x: shape.x + shape.width, y: shape.y + shape.height };
}

/**
 * Draw the rim and handle. The rim takes core's own outer alignment and is
 * wider than core's border, so the band past core's thickness stays visible
 * under a hover or a selection on a square, hex or gridless shape alike.
 */
function drawMark(mark, token, ui) {
  const thickness = (CONFIG?.Canvas?.objectBorderThickness ?? 4) * ui;
  const shape = token.shape;
  const outline = thickness * 2.4;
  const rim = thickness * 1.75;
  mark.clear();
  mark.lineStyle({ width: outline, color: 0x000000, alignment: 1 });
  mark.drawShape(shape);
  mark.lineStyle({ width: rim, color: MARK_COLOR, alignment: 1 });
  mark.drawShape(shape);
  const from = handleAnchor(shape);
  const length = Math.max(thickness * 4, Math.min(token.w, token.h) * 0.3);
  const to = { x: from.x + length * Math.SQRT1_2, y: from.y + length * Math.SQRT1_2 };
  mark.lineStyle({ width: outline, color: 0x000000, alignment: 0.5, cap: "round" });
  mark.moveTo(from.x, from.y).lineTo(to.x, to.y);
  mark.lineStyle({ width: rim, color: MARK_COLOR, alignment: 0.5, cap: "round" });
  mark.moveTo(from.x, from.y).lineTo(to.x, to.y);
}

/** Take the mark away from a token. */
function removeMark(mark) {
  if (mark && !mark.destroyed) mark.destroy({ children: true });
}

/**
 * Bring a token's mark into line with the world: drawn, redrawn, or removed.
 * Cheap where nothing changed, since a mark is redrawn only when its key does.
 * @param {Token} token  The placeable.
 */
export function refreshMark(token) {
  if (!token || token.destroyed || !token.shape) return;
  const existing = markOf(token);
  const here = !!canvas?.ready && !token.isPreview && token.document?.parent?.id === canvas.scene?.id;
  const found = here && enabled() ? judge(token) : null;
  if (!found) return removeMark(existing);
  const ui = canvas.dimensions?.uiScale ?? 1;
  const key = markKey({ w: token.w, h: token.h, shape: token.document.shape, verdict: found.verdict, ui });
  const mark = existing ?? addMark(token);
  if (mark.acksKey === key) return;
  drawMark(mark, token, ui);
  mark.acksKey = key;
  if (mark.readout) showReadout(mark, token, found);
}

/** A new mark, first among the token's children. */
function addMark(token) {
  const mark = new PIXI.Graphics();
  mark.name = SCALE_MARK_NAME;
  mark.eventMode = "none";
  token.addChildAt(mark, 0);
  return mark;
}

/** Re-judge every token on the viewed scene. */
export function refreshAllMarks() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) guarded(() => refreshMark(token));
}

let reported = false;

/** Run a refresh, logging a failure once rather than on every frame it recurs. */
function guarded(work) {
  try {
    work();
  } catch (err) {
    if (reported) return;
    reported = true;
    console.error(`${MODULE_ID} | scale mark failed`, err);
  }
}

/* -------------------------------------------- */
/*  The hover readout                           */
/* -------------------------------------------- */

/** A figure for display: at most two decimals, none when whole. */
const fmt = (n) => String(Number(Number(n).toFixed(2)));

/**
 * The page reference of the figures behind a footprint, where the world holds
 * one: the frontage's and the square's, once each. Empty where the world holds
 * none, so a value set by hand reads without a page.
 */
export function citeText(sizeKey) {
  const cites = [sizeKey ? sizeCite() : null, citeOf(SIZE_DOC, SQUARE_TABLE)].filter(Boolean);
  const unique = [...new Set(cites)];
  return unique.length ? ` ${game.i18n.format(KEYS.cite, { cite: unique.join(", ") })}` : "";
}

/**
 * The line saying where a footprint comes from, shared by the hover readout and
 * the setup panel's size chips.
 * @param {{source: string|null, sizeKey: string|null}} fp  A `footprintOf`
 *   answer, or the same two fields for a size category alone.
 */
export function sourceLine(fp) {
  const { source, sizeKey } = fp;
  if (source === "token") return game.i18n.localize(KEYS.sourceToken);
  if (source === "actor") return game.i18n.localize(KEYS.sourceActor);
  const feet = sizeSquareFeet();
  if (source === "size") {
    const squares = sizeSquares(sizeKey);
    const size = game.i18n.localize(SIZES[sizeKey]?.label ?? sizeKey);
    return game.i18n.format(KEYS.sourceSize, { size, w: fmt(squares?.w), h: fmt(squares?.h), feet: fmt(feet) }) + citeText(sizeKey);
  }
  return game.i18n.format(KEYS.sourceSquare, { feet: fmt(feet) }) + citeText(null);
}

/**
 * What the hover says about a marked token: which way it is off and the size
 * it is drawn at in the scene's units, and for the Judge or the token's owner
 * also its footprint in feet and where that comes from. A seat that is neither
 * sees the first two lines only.
 * @param {object} found  What `judge` answered.
 * @param {boolean} detailed  Whether this seat is shown the footprint.
 * @returns {string[]}
 */
export function readoutLines(found, detailed) {
  const { verdict, fp, scene, width, height } = found;
  const distance = Number(scene.grid?.distance) || 0;
  const lines = [
    game.i18n.localize(KEYS[verdict.dir]),
    game.i18n.format(KEYS.drawn, { w: fmt(width * distance), h: fmt(height * distance), units: scene.grid?.units ?? "" }).trim(),
  ];
  if (detailed) {
    lines.push(game.i18n.format(KEYS.footprint, { w: fmt(fp.feet.w), h: fmt(fp.feet.h) }));
    lines.push(sourceLine(fp));
  }
  return lines;
}

/** Put the readout under the token's nameplate, building its text on first use. */
function showReadout(mark, token, found) {
  const ui = canvas.dimensions?.uiScale ?? 1;
  let text = mark.readout;
  if (!text || text.destroyed) {
    // Rasterized at a fixed size and doubled resolution, then scaled by the
    // canvas's uiScale, as core draws a nameplate: text rasterized at the
    // scaled size is a few pixels tall on a small grid and smears when zoomed.
    const Text = globalThis.foundry?.canvas?.containers?.PreciseText ?? PIXI.Text;
    text = mark.addChild(
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
    text.anchor.set(0.5, 0);
    text.eventMode = "none";
    mark.readout = text;
  }
  text.text = readoutLines(found, !!game.user?.isGM || !!found.doc.isOwner).join("\n");
  const plate = token.nameplate;
  const top = plate?.visible ? plate.y + plate.height : token.h;
  text.position.set(token.w / 2, top + 2 * ui);
}

/** Take the readout away. */
function hideReadout(mark) {
  if (mark.readout && !mark.readout.destroyed) mark.readout.destroy();
  mark.readout = null;
}

/** A token hovered or left: the readout follows the pointer. */
export function onHover(token, hovered) {
  const mark = markOf(token);
  if (!mark) return;
  if (!hovered) return hideReadout(mark);
  const found = judge(token);
  if (found) showReadout(mark, token, found);
}

/* -------------------------------------------- */
/*  The wiring                                  */
/* -------------------------------------------- */

/**
 * The refresh listener: it returns at once unless the refresh carries a flag
 * the mark answers, since a token refreshes on every frame of a move.
 */
export function onRefreshToken(token, flags) {
  if (!carriesScaleFlag(flags)) return;
  guarded(() => refreshMark(token));
}

/**
 * Register the client setting that turns the mark off for this seat. Turning
 * it on or off re-judges every token on the viewed scene.
 */
export function registerScaleMarkSetting() {
  game.settings.register(MODULE_ID, SETTING_SCALE_MARK, {
    name: `${LANG_PREFIX}.scaleMark.setting.name`,
    hint: `${LANG_PREFIX}.scaleMark.setting.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllMarks(),
  });
}

/**
 * Register the setting and the hooks. Called once, at `init`. The mark is
 * re-judged when a token's or an actor's flags change (a footprint set or
 * cleared), when the scene's grid changes (what a cell is worth), when the
 * monsters tables change (the imported square and frontage) and when the
 * setting changes.
 */
export function installScaleMark() {
  registerScaleMarkSetting();
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("hoverToken", (token, hovered) => guarded(() => onHover(token, hovered)));
  Hooks.on("canvasReady", () => refreshAllMarks());
  Hooks.on("updateToken", (doc, changes) => {
    if (changes?.flags?.[MODULE_ID] && doc?.object) guarded(() => refreshMark(doc.object));
  });
  Hooks.on("updateActor", (_actor, changes) => {
    if (changes?.flags?.[MODULE_ID]) refreshAllMarks();
  });
  Hooks.on("updateScene", (scene, changes) => {
    if (changes?.grid !== undefined && scene?.id === canvas?.scene?.id) refreshAllMarks();
  });
  onTablesChanged((docId) => {
    if (docId === SIZE_DOC) refreshAllMarks();
  });
}
