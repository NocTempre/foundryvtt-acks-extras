/**
 * The pure half of the reach glyph (`reach-glyph.mjs`): which reaches a token
 * shows to one seat, where the glyph sits on the token, and what a drawn glyph
 * was built from. Foundry-free; every figure and document is passed in.
 *
 * The seat's view of a reach is the Region document's own `visibility`, as core
 * states it: a Region visible to anyone shows its glyph to anyone, one visible to
 * Observers to a seat that observes the Region, and a Gamemaster-only or
 * layer-only Region to the Gamemaster alone. No role or ownership rule is made
 * up here.
 */

/** The core icon the glyph is drawn from, a texture loaded by path. */
export const GLYPH_ICON = "icons/svg/aura.svg";

/** The name of the glyph's child on a token, which is how a page script finds it. */
export const REACH_GLYPH_NAME = "acks-extras-reach-glyph";

/** The edge of core's status-effect icon, in canvas pixels at the interface scale 1. */
const EFFECT_ICON_EDGE = 20;

/**
 * Which of the reaches a token stands in a seat is shown a glyph for. A
 * Gamemaster seat is shown every one; any other seat only those whose Region
 * core shows it (`ALWAYS`, or `OBSERVER` where the seat observes that Region).
 * A visibility this function does not know is not shown, so a value core adds
 * later fails closed.
 *
 * @param {Array<{region: {visibility: number}, behavior: object}>} found  What
 *   `behaviorsUnder` answered for the token.
 * @param {object} seat
 * @param {boolean} seat.isGM  Whether this seat is a Gamemaster.
 * @param {(region: object) => boolean} [seat.observes]  Whether this seat holds
 *   Observer permission on a Region document.
 * @param {Record<string, number>} [V]  Core's `REGION_VISIBILITY`.
 * @returns {Array<{region: object, behavior: object}>} The pairs shown, in order.
 */
export function shownReaches(found, { isGM = false, observes = () => false } = {}, V = globalThis.CONST?.REGION_VISIBILITY ?? {}) {
  const list = Array.isArray(found) ? found : [];
  if (isGM) return [...list];
  return list.filter(({ region }) => {
    const visibility = region?.visibility;
    if (!Number.isInteger(visibility)) return false;
    if (visibility === V.ALWAYS) return true;
    if (visibility === V.OBSERVER) return observes(region) === true;
    return false;
  });
}

/**
 * Where the glyph sits on a token: the middle of the token's right edge, at the
 * size of core's own effect icons. Core lays those from the token's top left,
 * down and then rightward, so the right edge is reached only by a token carrying
 * more icons than its width holds, and the two bars sit along the top and bottom.
 *
 * @param {{w: number, h: number, ui: number}} token  The token's pixel size and
 *   the canvas's interface scale.
 * @returns {{x: number, y: number, size: number}}
 */
export function glyphSlot({ w, h, ui }) {
  const size = EFFECT_ICON_EDGE * (Number(ui) || 1);
  return { x: Number(w) - size, y: (Number(h) - size) / 2, size };
}

/**
 * What a drawn glyph was built from: the token's pixel size, the interface
 * scale and the keys of the reaches shown. A refresh whose key is the glyph's own key
 * changes nothing.
 *
 * @param {{w: number, h: number, ui: number, reachKeys: string[]}} input
 * @returns {string}
 */
export function glyphKey({ w, h, ui, reachKeys }) {
  const n = (v) => Number(v).toFixed(2);
  return [n(w), n(h), n(ui), [...reachKeys].sort().join(",")].join("|");
}

/**
 * Whether a world change can alter which reaches a token stands in: a move, a
 * resize, a hidden flag or a change of the Regions the token holds (core's
 * `_regions`).
 *
 * @param {object} change  An `updateToken` change.
 * @returns {boolean}
 */
export function changesMembership(change) {
  return ["x", "y", "width", "height", "elevation", "hidden", "_regions"].some((key) => key in (change ?? {}));
}
