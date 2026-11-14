/* global canvas, foundry */
/**
 * Core patch: a light the module manages on a token reaches exactly its
 * figure.
 *
 * Core's `Token#getLightRadius` adds the token's `externalRadius` (half its
 * smaller side) to every radius it converts. The module's own lights are
 * figures converted to the scene's units (`token-sync.mjs` `applyTokenLight`)
 * and some stand on no token, so the wrapper takes the padding off the light
 * source's `dim` and `bright` on a token whose light is managed
 * (`isManagedLight`). A light set or edited by hand keeps core's padding.
 * `_getLightSourceData` is the light's own path; `getLightRadius` is left alone
 * because sight range, detection modes and the radius getters read it too.
 * See docs/lib/MODEL.md for the managed-light model.
 */
import { MODULE_ID } from "../constants.mjs";
import { isManagedLight } from "../token-sync.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "foundry.canvas.placeables.Token.prototype._getLightSourceData";

/**
 * A radius in scene units as canvas pixels, with no padding: the sign kept,
 * zero staying zero, as `getLightRadius` treats them.
 * @param {number} units
 * @param {number} pixelsPerUnit `canvas.dimensions.distancePixels`
 */
export function unpaddedRadius(units, pixelsPerUnit) {
  const n = Number(units) || 0;
  if (n === 0) return 0;
  return Math.abs(n) * pixelsPerUnit * Math.sign(n);
}

/**
 * The light source data core built, with a managed light's padding taken off.
 * @param {object} data `_getLightSourceData`'s result
 * @param {TokenDocument} tokenDoc the token's document
 * @param {number} pixelsPerUnit `canvas.dimensions.distancePixels`
 * @returns {object} `data`, changed in place for a managed light
 */
export function unpadLightData(data, tokenDoc, pixelsPerUnit) {
  if (!data || !isManagedLight(tokenDoc) || !(pixelsPerUnit > 0)) return data;
  const light = tokenDoc.light ?? {};
  data.dim = unpaddedRadius(light.dim, pixelsPerUnit);
  data.bright = unpaddedRadius(light.bright, pixelsPerUnit);
  return data;
}

/** WRAPPER form: core builds the data, and a managed light loses its padding. */
function onLightSourceData(wrapped, ...args) {
  return unpadLightData(wrapped(...args), this.document, canvas?.dimensions?.distancePixels);
}

/**
 * Install at `init`. Unconditional and settingless: the flag it reads is the
 * module's own, set only where the module writes the light. The only owner of
 * the wrapped method.
 */
export function installTokenLightPaddingPatch() {
  const proto = foundry?.canvas?.placeables?.Token?.prototype;
  if (typeof proto?._getLightSourceData !== "function") {
    console.warn(`${MODULE_ID} | no Token#_getLightSourceData to wrap; a managed light keeps core's padding.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onLightSourceData, "WRAPPER");
  } else {
    const original = proto._getLightSourceData;
    proto._getLightSourceData = function (...args) {
      return onLightSourceData.call(this, (...a) => original.apply(this, a), ...args);
    };
  }
}
