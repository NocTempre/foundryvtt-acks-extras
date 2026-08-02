/* global game, canvas, CONFIG, libWrapper */
import { MODULE_ID } from "./constants.mjs";

/**
 * Fuzzed measurement: without a *proficient* mapper the Judge gives only vague
 * measurements (RR p. 264), but the VTT ruler is pixel-perfect. So for
 * non-GM users, on scenes flagged by scene-sync:
 *
 * - mode "fuzzy"   (mapper present but unproficient): distances shown ~×factor,
 *   a deterministic hidden per-scene multiplier, rounded to the grid step —
 *   re-measuring gives the same wrong number, so it can't be averaged away;
 * - mode "unknown" (no working mapper): distances show as "?".
 *
 * GMs always see true values. Both the ruler tool (CONFIG.Canvas.rulerClass)
 * and token drag measurement (CONFIG.Token.rulerClass) have their documented
 * protected `_getWaypointLabelContext` wrapped via **libWrapper** (WRAPPER
 * type), so other ruler modules that touch the same method still compose.
 *
 * Honest limits: the canvas geometry itself stays exact — players can still
 * count grid squares. This is a deterrent and a mood-setter.
 */

export const MEASURE_FLAG = "measure";
export const MEASURE_MODES = Object.freeze({ OFF: "off", FUZZY: "fuzzy", UNKNOWN: "unknown" });

/** The fuzz state applying to the current user on the viewed scene, or null. */
function fuzzState() {
  if (game.user.isGM) return null;
  if (!game.settings.get(MODULE_ID, "fuzzMeasurement")) return null;
  const flag = canvas?.scene?.getFlag(MODULE_ID, MEASURE_FLAG);
  if (!flag || flag.mode === MEASURE_MODES.OFF) return null;
  return flag;
}

function fuzzNumber(value, factor) {
  const step = Math.max(canvas.scene.grid.distance || 5, 1);
  return Math.max(step, Math.round((value * factor) / step) * step);
}

/** Rewrite the distance/cost fields of a waypoint label context in place. */
function applyFuzz(context, waypoint) {
  if (!context) return context;
  const state = fuzzState();
  if (!state) return context;

  if (state.mode === MEASURE_MODES.UNKNOWN) {
    if (context.distance) context.distance = { total: "?" };
    if (context.cost) context.cost = { total: "?", units: context.cost.units };
    return context;
  }

  const factor = Number(state.factor) || 1;
  const lang = game.i18n.lang;
  const measurement = waypoint.measurement;

  if (context.distance && measurement) {
    context.distance = { total: `~${fuzzNumber(measurement.distance, factor).toLocaleString(lang)}` };
    const backward = measurement.backward?.distance;
    if (waypoint.index >= 2 && typeof backward === "number") {
      context.distance.delta = `+${fuzzNumber(backward, factor).toLocaleString(lang)}`;
    }
  }

  if (context.cost && measurement) {
    const cost = measurement.cost;
    context.cost = {
      total: Number.isFinite(cost) ? `~${fuzzNumber(cost, factor).toLocaleString(lang)}` : "∞",
      units: context.cost.units,
    };
    const deltaCost = waypoint.cost;
    if (waypoint.index >= 2 && Number.isFinite(deltaCost)) {
      context.cost.delta = `+${fuzzNumber(deltaCost, factor).toLocaleString(lang)}`;
    }
  }

  return context;
}

/**
 * Wrap the configured ruler classes' label builder. Called once at "setup" so
 * other modules' init-time class replacements are already in place — libWrapper
 * targets the live prototype method, letting every wrapper in the chain run.
 */
export function registerFuzzyRulers() {
  const wrap = function (wrapped, waypoint, state) {
    return applyFuzz(wrapped(waypoint, state), waypoint);
  };
  // CONFIG paths are resolved by libWrapper from global scope, so we wrap
  // whatever ruler class is live at setup without needing its name to be a
  // global (v14 ruler classes live under foundry.canvas.*).
  const targets = [
    "CONFIG.Canvas.rulerClass.prototype._getWaypointLabelContext",
    "CONFIG.Token.rulerClass.prototype._getWaypointLabelContext",
  ];
  for (const target of targets) {
    try {
      libWrapper.register(MODULE_ID, target, wrap, "WRAPPER");
    } catch (err) {
      console.error(`${MODULE_ID} | could not wrap ${target}`, err);
    }
  }
}
