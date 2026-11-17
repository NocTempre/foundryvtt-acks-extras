/* global game, canvas, ui, foundry, PIXI */
/**
 * The scene-write half of the assistant: turn a fit plus the GM's confirmed
 * scale into one Scene update, and (for skewed scans) bake a corrected
 * background image.
 *
 * Three families, one per grid kind — a square grid fitted to drawn boxes, a
 * hex grid fitted to the boxes drawn around single hexes, and a scale-only
 * write that touches no geometry at all. Each is SOLVED apart from being
 * WRITTEN: a solve is side-effect free (no notification, no dialog, no update)
 * and answers `{ ok: true, solution, update }` or `{ ok: false, reason }`, so
 * the panel's rows and the write read one answer, and a refusal is a `reason`
 * the panel turns into a line, never a notification. `solution` is the plain-data
 * shape the planner takes (`setup-plan.mjs`); `update` is the exact scene
 * payload, and the two are built from the same variables. `writeSetup` is the
 * one writer: it confirms, writes `update` with the module's flag record, reads
 * the scene back and posts the done notice.
 *
 * They write grid.size / grid.distance / grid.units / shiftX / shiftY / width /
 * height DIRECTLY on the Scene — no flags mirror them. That is the same field
 * set core's own GridConfig writes; the module's flag records only what core
 * has no field for (the calibration mark and the autoScale gate). The declared
 * travel system is the panel's select's to write as it changes, never the
 * apply's.
 */

import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP, CALIBRATABLE_GRIDS, GRID_TYPE, gridTypeFor } from "./constants.mjs";
import { solveShift } from "./calibrate-logic.mjs";
import { backgroundSrc, backgroundTexture, setBackgroundSrc } from "./scene-image.mjs";
import { hexProbe } from "./scene-setup.mjs";
import { hexAlignment } from "./hex-fit.mjs";
import { captureGridCells, rekeyPaintedHexes } from "./terrain-paint.mjs";
import { DISTANCE_UNITS } from "../lib/distance-units.mjs";
import { escape as escapeHtml, makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

const mod = (a, n) => ((a % n) + n) % n;

/**
 * The unit string a chosen unit key writes, or nothing to leave the scene's
 * own alone. Always written WITH the scale: a distance whose unit is a guess
 * is a number nobody can read back.
 */
const unitPatch = (units) => (DISTANCE_UNITS[units] ? { "grid.units": DISTANCE_UNITS[units].abbr } : {});

/**
 * The module's scene record, as an update payload: one dot path per key, so a
 * key the apply does not write (the declared travel system, the country) is
 * never replaced by the write.
 */
const setupPatch = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [`flags.${MODULE_ID}.${FLAG_BATTLEMAP}.${key}`, value]));

/**
 * What the scene actually holds, against what was asked for. A rejected field
 * leaves the update dropped without throwing, so nothing is reported applied
 * until the document itself agrees.
 */
const wroteScale = (scene, { size, distance }) =>
  scene.grid.size === size && Math.abs(scene.grid.distance - distance) < 1e-6;

/** The unit string the scene will actually be read in after this apply. */
const unitsWritten = (scene, units) => DISTANCE_UNITS[units]?.abbr ?? scene.grid.units ?? "";

/** The lang key of each family's act (the button's own words, which also title the confirmation) and done notice. */
const FAMILY_TEXT = Object.freeze({
  square: { act: "apply.grid", done: "apply.done" },
  hexRows: { act: "apply.hex", done: "apply.doneHex" },
  hexCols: { act: "apply.hex", done: "apply.doneHex" },
  scale: { act: "apply.scale", done: "apply.doneScale" },
});

/** Whether the scene holds a token, tile, wall, note, drawing or region that moves with a rescaled, shifted image. */
const holdsPlaceables = (scene) => ["tokens", "tiles", "walls", "notes", "drawings", "regions"].some((key) => scene[key]?.size > 0);

/**
 * The option bag of the scene write: core moves every placed object with the
 * image (`autoReposition`), and `acksExtrasSetup` marks the write as this
 * assistant's. A scale-only write moves the image only through the grid's
 * padding, so it asks for the move only when its update changes `grid.size`.
 */
function writeOptions(scene, update, family) {
  const moves = family !== "scale" || (update["grid.size"] !== undefined && update["grid.size"] !== scene.grid.size);
  return moves ? { autoReposition: true, acksExtrasSetup: true } : { acksExtrasSetup: true };
}

/**
 * The one confirmation every apply asks. Its title names the family's act and
 * its body lists the rows the panel showed, as plain text lines, so what is
 * confirmed is what was on screen. The placeables note appears only when the
 * scene's own dimensions are changing under something placed on it.
 */
function confirmApply({ act, lines, shifts }) {
  const list = lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "";
  const note = shifts ? `<p class="hint">${escapeHtml(loc("apply.confirmShift"))}</p>` : "";
  return foundry.applications.api.DialogV2.confirm({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("apply.ask", { act: loc(act) }) },
    content: `<p>${escapeHtml(loc("apply.confirmLead"))}</p>${list}${note}`,
  });
}

/**
 * Solve a SQUARE calibration: the background is rescaled so a drawn map box
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
 * @returns {{ok: true, solution: object, update: object}|{ok: false, reason: string}}
 */
export function solveGridCalibration(scene, fit, { gridSize, outputFeet, mapCellFeet, units }) {
  // GRIDLESS is accepted and switched to SQUARE; a hex scene is refused this
  // apply — the hex family calibrates it instead.
  if (!CALIBRATABLE_GRIDS.has(scene.grid.type)) return { ok: false, reason: "notSquareGrid" };
  const tex = backgroundTexture(scene);
  if (!tex) return { ok: false, reason: "noBackground" };
  const G = Math.round(gridSize);
  const squaresPerBox = mapCellFeet / outputFeet;
  const fx = (G * squaresPerBox) / fit.sizeX;
  const fy = (G * squaresPerBox) / fit.sizeY;
  const width = Math.round(tex.width * fx);
  const height = Math.round(tex.height * fy);

  // Solved off a clone with shift zeroed, so sceneX/sceneY report the
  // pre-shift padding-rounded origin.
  const clone = scene.clone({ width, height, shiftX: 0, shiftY: 0, "grid.size": G }, { keepId: true });
  const dims = clone.getDimensions();
  const shiftX = solveShift({ origin: dims.sceneX, phase: fit.phaseX, factor: fx, gridSize: G });
  const shiftY = solveShift({ origin: dims.sceneY, phase: fit.phaseY, factor: fy, gridSize: G });
  // Never hand Foundry a non-finite field: schema validation drops the whole
  // update without throwing, which reads as a successful no-op.
  if (shiftX === null || shiftY === null || !Number.isFinite(width) || !Number.isFinite(height) || !(G > 0) || !(outputFeet > 0) || !(mapCellFeet > 0)) {
    return { ok: false, reason: "badSolution" };
  }
  return geometrySolve({ type: GRID_TYPE.SQUARE, G, distance: outputFeet, units, width, height, shiftX, shiftY });
}

/**
 * Solve a HEX calibration: the background is rescaled so one drawn hex is one
 * Foundry hex of `gridSize` px, and the scene is shifted so the fitted hex
 * centre lands on a Foundry hex centre. A hex's bounding box and centre are
 * asked of a scene clone carrying the target grid, never rederived here.
 *
 * @param {Scene} scene
 * @param {object} fit  `fitHexLattice`'s answer (image px): `sizeX`/`sizeY` one
 *   hex's bounding box and `centre` the fitted hex centre.
 * @param {object} choice
 * @param {number} choice.gridSize  Canvas px for the Foundry `grid.size`.
 * @param {number} choice.outputFeet  What one hex is worth.
 * @param {string} choice.family  `hexRows` (pointy-topped) or `hexCols` (flat).
 * @param {boolean} [choice.hexEven]  The even-offset variant of that family.
 * @param {object|null} [choice.probe]  `hexProbe`'s answer for the family, where
 *   the caller already holds it; asked of the scene otherwise.
 * @returns {{ok: true, solution: object, update: object}|{ok: false, reason: string}}
 */
export function solveHexCalibration(scene, fit, { gridSize, outputFeet, family, hexEven = false, units, probe = undefined }) {
  const type = gridTypeFor(family, hexEven);
  const tex = backgroundTexture(scene);
  if (!tex) return { ok: false, reason: "noBackground" };
  const hexCentre = fit?.centre;
  if (type === null || !Number.isFinite(hexCentre?.x) || !Number.isFinite(hexCentre?.y)) return { ok: false, reason: "badSolution" };
  const G = Math.round(gridSize);

  // Measured, not derived: a hex's bounding box is not square.
  const ref = probe === undefined ? hexProbe(scene, family, hexEven) : probe;
  const hexW = ref ? (ref.refW / ref.refSize) * G : 0;
  const hexH = ref ? (ref.refH / ref.refSize) * G : 0;
  if (!(hexW > 0) || !(hexH > 0) || !(fit.sizeX > 0) || !(fit.sizeY > 0)) return { ok: false, reason: "badSolution" };
  const fx = hexW / fit.sizeX;
  const fy = hexH / fit.sizeY;
  const width = Math.round(tex.width * fx);
  const height = Math.round(tex.height * fy);

  // The fitted centre, rescaled into the picture and offset by the clone's
  // padded origin; `hexAlignment` owns the lattice question.
  const shift = hexAlignment(scene, {
    width, height, gridSize: G, type,
    point: (dims) => ({ x: dims.sceneX + hexCentre.x * fx, y: dims.sceneY + hexCentre.y * fy }),
  });
  if (!shift || !Number.isFinite(width) || !Number.isFinite(height) || !(G > 0) || !(outputFeet > 0)) return { ok: false, reason: "badSolution" };
  return geometrySolve({ type, G, distance: outputFeet, units, width, height, shiftX: shift.shiftX, shiftY: shift.shiftY });
}

/**
 * The solve of a geometry family, in both shapes at once: the plain-data
 * `solution` the planner reads and the scene `update` the writer sends, built
 * from the same values so they cannot disagree.
 */
function geometrySolve({ type, G, distance, units, width, height, shiftX, shiftY }) {
  return {
    ok: true,
    solution: { gridType: type, gridSize: G, distance, units: units ?? null, width, height, shiftX, shiftY },
    update: {
      width,
      height,
      shiftX,
      shiftY,
      "grid.size": G,
      "grid.type": type,
      "grid.distance": distance,
      ...unitPatch(units),
    },
  };
}

/**
 * Solve a SCALE ONLY calibration: what the map's distances are worth, and
 * nothing else. The image is not rescaled, the scene is not shifted, and the
 * grid type is left exactly as it was — a gridless map stays gridless.
 * `size` and `distance` are one ratio; the caller has already solved which
 * pair of them to write (`scaleOnlyGrid`). The solution carries no type, width,
 * height or shift: an absent field is unchanged.
 *
 * @param {object} choice  `{ size, distance, units }`.
 * @returns {{ok: true, solution: object, update: object}|{ok: false, reason: string}}
 */
export function solveScaleOnly({ size, distance, units }) {
  const G = Math.round(size);
  if (!(G > 0) || !(distance > 0) || !Number.isFinite(distance)) return { ok: false, reason: "badSolution" };
  return {
    ok: true,
    solution: { gridSize: G, distance, units: units ?? null },
    update: { "grid.size": G, "grid.distance": distance, ...unitPatch(units) },
  };
}

/**
 * The one writer: confirm a solved answer, write its `update` with the module's
 * flag record, read the scene back, and say what was applied. The write moves
 * every placed object with the image (`autoReposition`), and every grid-shape
 * cell on the scene (the painted hexes and the zones an import drew) is then
 * re-keyed to the grid as written (`rekeyPaintedHexes`): core leaves a grid
 * shape's offsets as they were, so the cell's place on the map is read before
 * the write and looked up on the new grid after it. `autoScale` is
 * the planner's answer (`plan.autoScale`), written as given — never carried over
 * from the scene's own flag, so a mile-scale apply leaves token auto-sizing off
 * where it was on.
 *
 * @param {Scene} scene
 * @param {{solution: object, update: object}} solved  A solve's answer.
 * @param {object} choice
 * @param {"square"|"hexRows"|"hexCols"|"scale"} choice.family
 * @param {boolean} choice.autoScale  Whether tokens placed here are auto-sized.
 * @param {string[]} [choice.lines]  The panel's rows as plain text, one per change; the
 *   confirmation lists them as given, so it never re-derives a figure.
 * @returns {Promise<boolean>} whether the update was confirmed, written and read back.
 */
export async function writeSetup(scene, { solution, update }, { family, autoScale, lines = [] }) {
  const text = FAMILY_TEXT[family];
  const units = unitsWritten(scene, solution.units);
  const figures = { size: solution.gridSize, distance: Number(solution.distance.toFixed(3)), units };
  if (!(await confirmApply({ act: text.act, lines, shifts: family !== "scale" && holdsPlaceables(scene) }))) return false;

  const options = writeOptions(scene, update, family);
  const gridCells = options.autoReposition ? captureGridCells(scene) : null;
  await scene.update({
    ...update,
    ...setupPatch({ calibrated: true, distance: solution.distance, autoScale: !!autoScale }),
  }, options);

  const typeKept = solution.gridType == null || scene.grid.type === solution.gridType;
  if (!wroteScale(scene, { size: solution.gridSize, distance: solution.distance }) || !typeKept) {
    ui.notifications.error(loc("warn.applyRejected"));
    return false;
  }
  // Grid-shape cells are keyed by the grid, and the grid just moved under them.
  if (gridCells) await rekeyPaintedHexes(scene, gridCells);
  ui.notifications.info(loc(text.done, figures));
  return true;
}

/**
 * Bake a corrected copy of the scene background: render the image through the
 * inverse of the fitted lattice (`A = s·M⁻¹`, correcting skew, rotation and
 * unequal X/Y in one transform) so its cells come out SQUARE and upright,
 * upload it beside the original as `<name>-aligned.webp`, and point the scene
 * at it. The original file is never touched.
 *
 * @param {Scene} scene
 * @param {object} fit  Any fit; `u`/`v` when affine, else the axis sizes.
 * @returns {Promise<{fit: object, path: string}|null>} the corrected image's
 *   exact square fit (image px of the NEW file), or null on refusal. Every
 *   refusal raises a notice that says why.
 */
export async function bakeCorrectedBackground(scene, fit) {
  if (!fit?.ok) {
    ui.notifications.warn(loc("bake.noFit"));
    return null;
  }
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
  if (!(Math.abs(det) >= 1e-9)) {
    ui.notifications.warn(loc("bake.degenerate"));
    return null;
  }
  // The larger edge is the target, so only the short axis stretches.
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

  // Exact by construction: square cells of edge `s`, origin carried through
  // the same transform. An orthogonal fit has no `origin`; its phases stand in.
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
