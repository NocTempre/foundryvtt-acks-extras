/* global globalThis */

/**
 * Light sources, and who is carrying one — the ACKS light table plus the single
 * answer to "how brightly does this actor's token burn?".
 *
 * This lives in lib because two callers need it and neither owns it: a
 * formation lights the party token from the sources its members declared, and a
 * lone actor with a torch must burn just as brightly with no formation in sight.
 *
 * **One owner per actor, never two.** An actor inside a formation takes its
 * lights from that formation's record — the formation is what tracks burn-down,
 * fuel and shutters, and it is what the party sheet writes. Only an actor with
 * no formation falls back to its own flag. Reading both, or preferring the flag,
 * would let a member carry two contradictory torches.
 */

import { MODULE_ID } from "./constants.mjs";

/**
 * Light sources (RR p. 265): bright/dim radii in feet and burn duration in
 * turns.
 *   `consumes` — the FUEL item decremented when lit (and required, when
 *                enforcement is on). For a torch/candle the item IS the fuel;
 *                for a lantern it is a flask of (common) oil, NOT the lantern.
 *   `holder`   — an optional durable DEVICE that must be carried but is NOT
 *                consumed (the lantern itself). Absent → the fuel is the device.
 *   `fuelLabel`— i18n label for the fuel, when it differs from the device.
 * A lantern's oil pattern excludes "military oil" (a thrown weapon, RR: common
 * oil is for lanterns) via a negative lookbehind.
 */
export const LIGHT_SOURCES = Object.freeze({
  torch: {
    label: "ACKS-LIB.light.torch",
    turns: 6,
    bright: 15,
    dim: 30,
    consumes: /torch/i,
  },
  lantern: {
    label: "ACKS-LIB.light.lantern",
    turns: 24,
    bright: 15,
    dim: 30,
    holder: /lantern/i,
    consumes: /(?<!military\s)\boil\b/i,
    fuelLabel: "ACKS-LIB.light.oil",
    // RR (equipment): "Lanterns can be closed to conceal the light" — burns on.
    shieldable: true,
  },
  candle: {
    label: "ACKS-LIB.light.candle",
    turns: 6,
    bright: 5,
    dim: 10,
    consumes: /candle/i,
  },
});

/** Flag holding a non-formation actor's own light state, same record shape. */
export const FLAG_LIGHTS = "lights";

/**
 * The lights a lone actor carries: `[{ id, type, lit, shielded, remaining }]`,
 * the same shape a formation stores, so every consumer reads one record type.
 */
export function actorFlagLights(actor) {
  const lights = actor?.getFlag?.(MODULE_ID, FLAG_LIGHTS);
  return Array.isArray(lights) ? lights : [];
}

/**
 * Every light this actor is carrying, from whichever record owns them.
 *
 * The formation feature is asked first, through the shared namespace rather than
 * an import — lib may not depend on a feature. `lightsForBearer` returns null
 * for an actor in no formation, which is the signal to fall back to the actor's
 * own flag; a missing formation feature degrades the same way.
 */
export function bearerLights(actor) {
  if (!actor?.id) return [];
  const fromFormation = globalThis.acksExtras?.formation?.lightsForBearer;
  if (typeof fromFormation === "function") {
    const lights = fromFormation(actor.id);
    if (lights) return lights;
  }
  return actorFlagLights(actor);
}

/**
 * The light a set of sources actually sheds: the brightest lit, unshuttered one.
 * A closed lantern sheds nothing though it keeps burning, and a doused source is
 * stowed — both read as dark here.
 */
export function emittedLight(lights) {
  let bright = 0;
  let dim = 0;
  for (const light of lights ?? []) {
    if (!light?.lit || light.shielded) continue;
    const cfg = LIGHT_SOURCES[light.type];
    if (!cfg) continue;
    bright = Math.max(bright, cfg.bright);
    dim = Math.max(dim, cfg.dim);
  }
  return { bright, dim };
}
