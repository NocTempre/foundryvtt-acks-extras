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
 *   `fuelItem` /
 *   `holderItem` — the RAW item to hand over when a Judge supplies the gear
 *                (see `lightGear`). Names match the system's own equipment
 *                compendium so the granted item is core's, not a copy.
 *
 * A lantern burns COMMON oil; military oil is a thrown weapon (RR p297) and
 * must never read as lamp fuel. The pattern therefore rejects the whole name
 * when it mentions military — a lookbehind cannot, because the RAW item is
 * named "Oil, Military (1 pint)" with the word `oil` FIRST.
 */
export const LIGHT_SOURCES = Object.freeze({
  torch: {
    label: "ACKS-LIB.light.torch",
    turns: 6,
    bright: 15,
    dim: 30,
    consumes: /torch/i,
    fuelItem: "Torches (6)",
  },
  lantern: {
    label: "ACKS-LIB.light.lantern",
    turns: 24,
    bright: 15,
    dim: 30,
    holder: /lantern/i,
    holderItem: "Lantern",
    consumes: /^(?!.*\bmilitary\b).*\boil\b/i,
    fuelLabel: "ACKS-LIB.light.oil",
    fuelItem: "Oil, Common (1 pint)",
    // RR (equipment): "Lanterns can be closed to conceal the light" — burns on.
    shieldable: true,
  },
  candle: {
    label: "ACKS-LIB.light.candle",
    turns: 6,
    bright: 5,
    dim: 10,
    consumes: /candle/i,
    fuelItem: "Candle (tallow, 1 lb)",
  },
});

/**
 * Everything a light source needs in the pack before it can burn, device first.
 *
 * ONE list answers both halves of the equipment rule: what is missing (test each
 * `pattern` against the bearer's inventory) and what to hand over when a Judge
 * supplies it (create each `name`). A torch and a candle are their own device,
 * so they yield a single entry; a lantern yields the lamp and its oil.
 *
 * `fuel` marks the piece the flame eats — the one that must have stock left, and
 * the one decremented when the light is struck.
 * @returns {{pattern: RegExp, name: string, label: string, fuel: boolean}[]}
 */
export function lightGear(type) {
  const cfg = LIGHT_SOURCES[type];
  if (!cfg) return [];
  const gear = [];
  if (cfg.holder) {
    gear.push({ pattern: cfg.holder, name: cfg.holderItem, label: cfg.label, fuel: false });
  }
  gear.push({ pattern: cfg.consumes, name: cfg.fuelItem, label: cfg.fuelLabel ?? cfg.label, fuel: true });
  return gear;
}

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
