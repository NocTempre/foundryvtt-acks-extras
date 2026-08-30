/* global game, canvas, ui, foundry, PIXI */
/**
 * The scene-write half of the assistant: turn a fit plus the GM's confirmed
 * scale into one Scene update, and (for skewed scans) bake a corrected
 * background image.
 *
 * Three applies, one per grid family — a square grid fitted to drawn boxes, a
 * hex grid pitched to one drawn hex, and a scale-only write that touches no
 * geometry at all. They write grid.size / grid.distance / grid.units / shiftX /
 * shiftY / width / height DIRECTLY on the Scene — no flags mirror them. That is
 * the same field set core's own GridConfig writes; the module's flag records
 * only what core has no field for (the calibration mark, the autoScale gate,
 * and the travel system declared here).
 */

import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP, CALIBRATABLE_GRIDS, GRID_TYPE, gridTypeFor } from "./constants.mjs";
import { solveShift } from "./calibrate-logic.mjs";
import { backgroundSrc, backgroundTexture, setBackgroundSrc } from "./scene-image.mjs";
import { hexProbe } from "./scene-setup.mjs";
import { DISTANCE_UNITS } from "../lib/distance-units.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const mod = (a, n) => ((a % n) + n) % n;

/**
 * The unit string a chosen unit key writes, or nothing to leave the scene's
 * own alone. Always written WITH the scale: a distance whose unit is a guess
 * is a number nobody can read back.
 */
const unitPatch = (units) => (DISTANCE_UNITS[units] ? { "grid.units": DISTANCE_UNITS[units].abbr } : {});

/** The module's scene record, as an update payload. */
const setupPatch = (record) => ({ [`flags.${MODULE_ID}.${FLAG_BATTLEMAP}`]: record });

/**
 * What the scene actually holds, against what was asked for. A rejected field
 * leaves the update dropped without throwing, so nothing is reported applied
 * until the document itself agrees.
 */
const wroteScale = (scene, { size, distance }) =>
  scene.grid.size === size && Math.abs(scene.grid.distance - distance) < 1e-6;

/** The unit string the scene will actually be read in after this apply. */
const unitsWritten = (scene, units) => DISTANCE_UNITS[units]?.abbr ?? scene.grid.units ?? "";

/**
 * The one confirmation every apply asks. Each states its own body — a square,
 * a hex and a bare ruler are three different promises — and the moved-placeable
 * note appears only when the scene's own dimensions are changing.
 */
function confirmApply(body, { shifts }) {
  const note = shifts ? `<p class="hint">${loc("apply.confirmShift")}</p>` : "";
  return foundry.applications.api.DialogV2.confirm({
    window: { title: loc("apply.confirmTitle") },
    content: `<p>${body}</p>${note}`,
  });
}

/**
 * Apply a SQUARE calibration: the background is rescaled so a drawn map box
 * spans exactly `mapCellFeet / outputFeet` Foundry squares of `gridSize` px,
 * the shift is solved so grid lines land on the drawn lattice, and
 * grid.distance becomes the output scale.
 *
 * @param {Scene} scene
 * @param {object} fit  From `fitGrid` (image px): sizeX/sizeY/phaseX/phaseY.
 * @param {object} choice
 * @param {number} choice.gridSize  Canvas px per output square.
 * @param {number} choice.outputFeet  What one output square is worth.
 * @param {number} choice.mapCellFeet  What one DRAWN box is worth.
 * @param {string} [choice.units]  A `DISTANCE_UNITS` key; absent keeps the scene's.
 * @param {string|null} [choice.mapSystem]  The travel system declared here.
 * @returns {Promise<boolean>} whether the update was confirmed and written.
 */
export async function applyGridCalibration(scene, fit, { gridSize, outputFeet, mapCellFeet, units, mapSystem = null }) {
  // GRIDLESS is the ordinary starting state of a freshly imported map, and
  // giving it a square grid is the whole point of calibrating — so it is
  // accepted and switched to SQUARE by the apply. A hex scene is refused THIS
  // apply because a rectangular lattice is not what it wants; the hex family
  // is how a hex map is calibrated.
  if (!CALIBRATABLE_GRIDS.has(scene.grid.type)) {
    ui.notifications.warn(loc("warn.notSquareGrid"));
    return false;
  }
  const tex = backgroundTexture(scene);
  if (!tex) {
    ui.notifications.warn(loc("warn.noBackground"));
    return false;
  }
  const G = Math.round(gridSize);
  const squaresPerBox = mapCellFeet / outputFeet;
  const fx = (G * squaresPerBox) / fit.sizeX;
  const fy = (G * squaresPerBox) / fit.sizeY;
  const width = Math.round(tex.width * fx);
  const height = Math.round(tex.height * fy);

  // Solve the shift off a preview clone whose shift is ZEROED, so its
  // `sceneX`/`sceneY` report exactly the padding-rounded origin the real
  // scene will have before its own shift applies. Asking the clone keeps
  // this correct if core's padding rounding ever changes.
  const clone = scene.clone({ width, height, shiftX: 0, shiftY: 0, "grid.size": G }, { keepId: true });
  const dims = clone.getDimensions();
  const shiftX = solveShift({ origin: dims.sceneX, phase: fit.phaseX, factor: fx, gridSize: G });
  const shiftY = solveShift({ origin: dims.sceneY, phase: fit.phaseY, factor: fy, gridSize: G });
  // Never hand Foundry a non-finite field: schema validation drops the whole
  // update without throwing, which reads as a successful no-op.
  if (shiftX === null || shiftY === null || !Number.isFinite(width) || !Number.isFinite(height) || !(G > 0)) {
    ui.notifications.error(loc("warn.badSolution"));
    return false;
  }

  const body = loc("apply.confirmBody", { size: G, distance: outputFeet, units: unitsWritten(scene, units) });
  if (!(await confirmApply(body, { shifts: true }))) return false;

  await scene.update({
    width,
    height,
    shiftX,
    shiftY,
    "grid.size": G,
    "grid.type": GRID_TYPE.SQUARE,
    "grid.distance": outputFeet,
    ...unitPatch(units),
    ...setupPatch({ calibrated: true, distance: outputFeet, autoScale: true, mapSystem }),
  });

  if (!wroteScale(scene, { size: G, distance: outputFeet })) {
    ui.notifications.error(loc("warn.applyRejected"));
    return false;
  }
  ui.notifications.info(loc("apply.done", { size: G, distance: outputFeet }));
  return true;
}

/**
 * Apply a HEX calibration: the background is rescaled so one drawn hex is one
 * Foundry hex of `gridSize` px, and the scene is shifted so that hex's centre
 * lands on a Foundry hex centre.
 *
 * Neither a hex's proportions nor its packing are restated here. The bounding
 * box of a hex at a probe size, and the centre nearest a point, are both ASKED
 * of a scene clone carrying the target grid: hex geometry is core's, and a
 * copy of it here would be a second answer to drift from.
 *
 * One drawn hex is one Foundry hex, always. Re-pitching a grid to a fraction
 * of a drawn cell is a square-grid idea — hexes do not tile hexes.
 *
 * @param {Scene} scene
 * @param {object} fit  Rect-mode fit (image px) of one hex's bounding box.
 * @param {object} choice
 * @param {number} choice.gridSize  Canvas px for the Foundry `grid.size`.
 * @param {number} choice.outputFeet  What one hex is worth.
 * @param {{x:number,y:number}} choice.hexCentre  A drawn hex's centre, image px.
 * @param {string} choice.family  `hexRows` (pointy-topped) or `hexCols` (flat).
 * @param {boolean} [choice.hexEven]  The even-offset variant of that family.
 * @returns {Promise<boolean>}
 */
export async function applyHexCalibration(scene, fit, { gridSize, outputFeet, hexCentre, family, hexEven = false, units, mapSystem = null }) {
  const type = gridTypeFor(family, hexEven);
  const tex = backgroundTexture(scene);
  if (!tex) {
    ui.notifications.warn(loc("warn.noBackground"));
    return false;
  }
  if (type === null || !hexCentre) {
    ui.notifications.error(loc("warn.badSolution"));
    return false;
  }
  const G = Math.round(gridSize);

  // A hex at the probe size, MEASURED rather than derived: its bounding box is
  // not square and the two edges differ, which is the whole reason a hex map
  // cannot reuse the square path.
  const probe = hexProbe(scene, family, hexEven);
  const hexW = probe ? (probe.refW / probe.refSize) * G : 0;
  const hexH = probe ? (probe.refH / probe.refSize) * G : 0;
  if (!(hexW > 0) || !(hexH > 0) || !(fit.sizeX > 0) || !(fit.sizeY > 0)) {
    ui.notifications.error(loc("warn.badSolution"));
    return false;
  }
  const fx = hexW / fit.sizeX;
  const fy = hexH / fit.sizeY;
  const width = Math.round(tex.width * fx);
  const height = Math.round(tex.height * fy);

  // The shift is solved the way the square path solves it — off a zero-shift
  // clone — but by asking that clone's own grid which hex centre is nearest.
  // A phase cannot express hex packing: every other row starts half a cell over.
  const clone = scene.clone({ width, height, shiftX: 0, shiftY: 0, "grid.size": G, "grid.type": type }, { keepId: true });
  const dims = clone.getDimensions();
  const point = { x: dims.sceneX + hexCentre.x * fx, y: dims.sceneY + hexCentre.y * fy };
  const centre = clone.grid?.getCenterPoint?.(point);
  const shiftX = Number.isFinite(centre?.x) ? Math.round(point.x - centre.x) : null;
  const shiftY = Number.isFinite(centre?.y) ? Math.round(point.y - centre.y) : null;
  if (shiftX === null || shiftY === null || !Number.isFinite(width) || !Number.isFinite(height) || !(G > 0)) {
    ui.notifications.error(loc("warn.badSolution"));
    return false;
  }

  const body = loc("apply.confirmHex", { size: G, distance: outputFeet, units: unitsWritten(scene, units) });
  if (!(await confirmApply(body, { shifts: true }))) return false;

  await scene.update({
    width,
    height,
    shiftX,
    shiftY,
    "grid.size": G,
    "grid.type": type,
    "grid.distance": outputFeet,
    ...unitPatch(units),
    ...setupPatch({ calibrated: true, distance: outputFeet, autoScale: true, mapSystem }),
  });

  if (!wroteScale(scene, { size: G, distance: outputFeet }) || scene.grid.type !== type) {
    ui.notifications.error(loc("warn.applyRejected"));
    return false;
  }
  ui.notifications.info(loc("apply.done", { size: G, distance: outputFeet }));
  return true;
}

/**
 * Apply a SCALE ONLY calibration: what the map's distances are worth, and
 * nothing else. The image is not rescaled, the scene is not shifted, and the
 * grid type is left exactly as it was — a gridless map stays gridless.
 *
 * This is the apply for a map with no drawn grid to fit. A scale bar is the
 * only measurement such a map offers, and a ruler that reads true is the only
 * thing a fitted grid would have bought. `size` and `distance` are one ratio
 * and the caller has already solved which pair of them to write
 * (`scaleOnlyGrid`).
 *
 * @param {Scene} scene
 * @param {object} choice  `{ size, distance, units, mapSystem }`.
 * @returns {Promise<boolean>}
 */
export async function applyScaleOnly(scene, { size, distance, units, mapSystem = null }) {
  const G = Math.round(size);
  if (!(G > 0) || !(distance > 0) || !Number.isFinite(distance)) {
    ui.notifications.error(loc("warn.badSolution"));
    return false;
  }
  const body = loc("apply.confirmScale", { size: G, distance: Number(distance.toFixed(3)), units: unitsWritten(scene, units) });
  if (!(await confirmApply(body, { shifts: false }))) return false;

  await scene.update({
    "grid.size": G,
    "grid.distance": distance,
    ...unitPatch(units),
    ...setupPatch({ calibrated: true, distance, autoScale: true, mapSystem }),
  });

  if (!wroteScale(scene, { size: G, distance })) {
    ui.notifications.error(loc("warn.applyRejected"));
    return false;
  }
  ui.notifications.info(loc("apply.doneScale", { size: G, distance }));
  return true;
}

/**
 * Bake a corrected copy of the scene background: render the image through the
 * inverse of the fitted lattice so its cells come out SQUARE and upright,
 * upload it beside the original as `<name>-aligned.webp`, and point the scene
 * at it. The original file is never touched.
 *
 * This corrects every way a scan can be wrong at once — skew, rotation and
 * unequal X/Y — because they are one transform. `A = s·M⁻¹` sends the fitted
 * basis to `(s,0)` and `(0,s)`, so a stretched map is fixed in the IMAGE
 * rather than by leaving the scene at an odd width-to-height ratio.
 *
 * @param {Scene} scene
 * @param {object} fit  Any fit; `u`/`v` when affine, else the axis sizes.
 * @returns {Promise<{fit: object, path: string}|null>} the corrected image's
 *   exact square fit (image px of the NEW file), or null on refusal.
 */
export async function bakeCorrectedBackground(scene, fit) {
  if (!fit?.ok) return null;
  if (!game.user.can("FILES_UPLOAD")) {
    ui.notifications.warn(loc("warn.noUpload"));
    return null;
  }
  const src = backgroundSrc(scene);
  const tex = backgroundTexture(scene);
  if (!src || !tex) {
    ui.notifications.warn(loc("warn.noBackground"));
    return null;
  }

  // An orthogonal fit has no basis vectors of its own; its axes ARE the basis.
  const u = fit.u ?? { x: fit.sizeX, y: 0 };
  const v = fit.v ?? { x: 0, y: fit.sizeY };
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) < 1e-9) return null;
  // The larger edge is the target, so the correction only ever stretches the
  // short axis — resampling up loses less than squeezing down.
  const s = Math.max(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y));
  const a = (s * v.y) / det;
  const c = (-s * v.x) / det;
  const b = (-s * u.y) / det;
  const d = (s * u.x) / det;
  const xs = [0, tex.width].flatMap((x) => [0, tex.height].map((y) => a * x + c * y));
  const ys = [0, tex.width].flatMap((x) => [0, tex.height].map((y) => b * x + d * y));
  const tx = -Math.min(...xs);
  const ty = -Math.min(...ys);
  const outW = Math.ceil(Math.max(...xs) + tx);
  const outH = Math.ceil(Math.max(...ys) + ty);

  const sprite = new PIXI.Sprite(new PIXI.Texture(tex.baseTexture ?? tex));
  const holder = new PIXI.Container();
  holder.addChild(sprite);
  holder.transform.setFromMatrix(new PIXI.Matrix(a, b, c, d, tx, ty));
  const rt = PIXI.RenderTexture.create({ width: outW, height: outH });
  let base64;
  try {
    canvas.app.renderer.render(holder, { renderTexture: rt });
    base64 = await canvas.app.renderer.extract.base64(rt, "image/webp", 0.92);
  } finally {
    rt.destroy(true);
    holder.destroy({ children: true });
  }

  const blob = await (await fetch(base64)).blob();
  const parts = src.split("/");
  const name = parts.pop().replace(/\.[^.]+$/, "");
  const dir = parts.join("/");
  const file = new File([blob], `${name}-aligned.webp`, { type: "image/webp" });
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
  const response = await FilePickerImpl.upload("data", dir, file, {}, { notify: false });
  if (!response?.path) {
    ui.notifications.error(loc("warn.uploadFailed"));
    return null;
  }
  await setBackgroundSrc(scene, response.path);
  if (backgroundSrc(scene) !== response.path) {
    ui.notifications.error(loc("warn.repointFailed", { path: response.path }));
    return null;
  }
  ui.notifications.info(loc("bake.done", { path: response.path }));

  // The corrected image's lattice is exact by construction: square cells of
  // edge `s`, with the origin carried through the same transform. An
  // orthogonal fit has no `origin`, so its phases stand in for one.
  const O = fit.origin ?? { x: fit.phaseX, y: fit.phaseY };
  return {
    path: response.path,
    fit: {
      ok: true,
      mode: "square",
      sizeX: s,
      sizeY: s,
      phaseX: mod(a * O.x + c * O.y + tx, s),
      phaseY: mod(b * O.x + d * O.y + ty, s),
      rmsPx: fit.rmsPx,
      rmsPct: fit.rmsPct,
      confidence: fit.confidence,
      samples: fit.samples,
    },
  };
}
