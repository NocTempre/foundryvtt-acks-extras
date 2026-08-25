/* global game, canvas, ui, foundry, PIXI, CONST */
/**
 * The scene-write half of the assistant: turn a fit plus the GM's confirmed
 * scale into one Scene update, and (for skewed scans) bake a corrected
 * background image.
 *
 * These write grid.size / grid.distance / shiftX / shiftY / width / height
 * DIRECTLY on the Scene — no flags mirror them. That is the same field set
 * core's own GridConfig writes; the assistant's flag records only what core
 * has no field for (the calibration mark and the autoScale gate).
 */

import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP, CALIBRATABLE_GRIDS } from "./constants.mjs";
import { solveShift } from "./calibrate-logic.mjs";
import { backgroundSrc, backgroundTexture, setBackgroundSrc } from "./scene-image.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const mod = (a, n) => ((a % n) + n) % n;

/**
 * Apply a calibration to the scene: the background is rescaled so a drawn
 * map box spans exactly `mapCellFeet / outputFeet` Foundry squares of
 * `gridSize` px, the shift is solved so grid lines land on the drawn
 * lattice, and grid.distance becomes the output scale.
 *
 * @param {Scene} scene
 * @param {object} fit  From `fitGrid` (image px): sizeX/sizeY/phaseX/phaseY.
 * @param {object} choice  `{ gridSize, outputFeet, mapCellFeet }`.
 * @returns {Promise<boolean>} whether the update was confirmed and written.
 */
export async function applyGridCalibration(scene, fit, { gridSize, outputFeet, mapCellFeet }) {
  // GRIDLESS is the ordinary starting state of a freshly imported map, and
  // giving it a square grid is the whole point of calibrating — so it is
  // accepted and switched to SQUARE by the apply. Only a hex grid is refused:
  // the solver fits a rectangular lattice, which a hex scene is not.
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

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("apply.confirmTitle") },
    content: `<p>${loc("apply.confirmBody", { size: G, distance: outputFeet, units: scene.grid.units || "ft" })}</p><p class="hint">${loc("apply.confirmShift")}</p>`,
  });
  if (!confirmed) return false;

  await scene.update({
    width,
    height,
    shiftX,
    shiftY,
    "grid.size": G,
    "grid.type": CONST.GRID_TYPES.SQUARE,
    "grid.distance": outputFeet,
    [`flags.${MODULE_ID}.${FLAG_BATTLEMAP}`]: { calibrated: true, distance: outputFeet, autoScale: true },
  });

  // Report what the document actually holds, never what was asked for: a
  // rejected field leaves the update dropped without throwing, and a success
  // notice over an unchanged scene is worse than an error.
  if (scene.grid.size !== G || scene.grid.distance !== outputFeet) {
    ui.notifications.error(loc("warn.applyRejected"));
    return false;
  }
  ui.notifications.info(loc("apply.done", { size: G, distance: outputFeet }));
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
