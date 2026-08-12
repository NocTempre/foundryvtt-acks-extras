/* global globalThis, game, ui, foundry */

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
import { findCarried } from "./item-model.mjs";

/**
 * World setting deciding how hard the equipment requirement bites:
 * "require" (default) | "warn" | "off". Registered by the formation feature,
 * which owns the settings UI for it; read here because the rule it gates is the
 * light source's, and both ways of lighting one must obey the same answer.
 */
export const LIGHT_ENFORCEMENT_SETTING = "lightItemEnforcement";

/** The enforcement level, defaulting to the strict reading before `init`. */
function lightEnforcement() {
  try {
    return game.settings.get(MODULE_ID, LIGHT_ENFORCEMENT_SETTING) ?? "require";
  } catch {
    return "require";
  }
}

/** Localize when the key exists; otherwise pass the text through unchanged. */
function localize(key) {
  try {
    return game?.i18n?.has?.(key) ? game.i18n.localize(key) : (key ?? "");
  } catch {
    return key ?? "";
  }
}

/** Warn the user about a light they cannot strike, when there is a UI to tell. */
function warnLight(key, data) {
  const full = `ACKS-LIB.light.${key}`;
  try {
    ui?.notifications?.warn?.(game?.i18n?.has?.(full) ? game.i18n.format(full, data) : full);
  } catch {
    /* headless (tests, a pre-init caller): the refusal itself still stands */
  }
}

/** A random document id, or a serviceable stand-in outside Foundry. */
function randomId() {
  const make = foundry?.utils?.randomID;
  if (typeof make === "function") return make();
  return `light${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

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
 * Whether a formation owns this actor's lights, and so whether the actor's own
 * flag is the record to write. Asked through the shared namespace rather than
 * an import — lib may not depend on a feature — and answered "no" when the
 * formation feature is absent, which is the degradation every other caller
 * here takes.
 */
export function formationOwnsLights(actor) {
  const lightsForBearer = globalThis.acksExtras?.formation?.lightsForBearer;
  if (typeof lightsForBearer !== "function" || !actor?.id) return false;
  return lightsForBearer(actor.id) != null;
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

/* -------------------------------------------- */
/*  Striking a light                            */
/* -------------------------------------------- */

/**
 * Everything that must be true before a flame is struck, and the fuel it eats
 * when it is.
 *
 * Lives here because BOTH ways of lighting a source ask exactly this: a party
 * member lighting through the formation's turn engine, and a character alone
 * in a corridor lighting from their own sheet. The rules — a free hand to hold
 * it, the gear it needs (RR p265), one unit of fuel off the stack — belong to
 * the light source, not to whether anyone happens to be marching in formation.
 *
 * Consumes the fuel as a side effect when the check passes, because the two are
 * one decision: a caller that asked and then declined to spend would have
 * warned about missing gear it never took.
 *
 * @param {Actor} actor
 * @param {string} type   a LIGHT_SOURCES key
 * @param {object} [opts]
 * @param {boolean} [opts.override] the Judge is GIVING them this light: warn
 *   about what is missing, then light anyway. Set from the DECLARING user's
 *   authority, never the executing client's.
 * @returns {Promise<boolean>} whether the flame may be struck.
 */
export async function prepareToLight(actor, type, { override = false } = {}) {
  if (!LIGHT_SOURCES[type] || !actor) return false;

  // Two-way hand check (acks-equipment): a light is held in hand, so lighting
  // one needs a hand to hold it. ROOM, not free hands — a lone sword widens to
  // a two-handed grip whenever a hand is going spare and gives it straight back
  // for the torch, so asking what is FREE would refuse a swordsman with an
  // empty off hand. Only the call is defended: an unreadable hand count means
  // no check, not a refusal.
  let freeHands;
  try {
    const equipment = globalThis.acksExtras?.equipment;
    freeHands = equipment?.spareHands?.(actor) ?? equipment?.freeHands?.(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | acks-equipment hand count failed`, err);
  }
  if (Number.isFinite(freeHands) && freeHands <= 0) {
    warnLight("noFreeHand", { bearer: actor.name });
    // Hands the override could not empty are full of lit sources, which
    // sheathing cannot fix. Say so; do not stop a Judge over it.
    if (!override) return false;
  }

  // Equipment requirement (RR p265). "require" (default) blocks lighting
  // without the gear; "warn" lights anyway with a warning; "off" ignores it.
  const enforcement = lightEnforcement();
  if (enforcement === "off") return true;

  const gear = lightGear(type);
  const fuel = findCarried(actor, gear.find((g) => g.fuel).pattern);
  const missing = gear.filter((g) => !findCarried(actor, g.pattern)).map((g) => localize(g.label));
  if (missing.length) {
    warnLight("needLightItem", { bearer: actor.name, items: missing.join(", ") });
    // "require" blocks — unless the Judge overrode and the world simply had no
    // such item to hand over. "warn" falls through and lights anyway.
    if (enforcement === "require" && !override) return false;
  }

  // Consume one unit of the FUEL, but only when it is a genuine STACK. A
  // stackable light item (a bundle of torches, a flask of oil, candles) has a
  // core `system.quantity` and loses one to the flame. A torch carried as a
  // WEAPON has no quantity field (core weapons don't) — it is a single wielded
  // torch that simply burns out on its own timer, so there is nothing to
  // decrement. A lantern (the reusable device) is never consumed; only its oil
  // is. Reuse acks-equipment's ammunition-tracker decrement when present so
  // fuel burn-down and ammo share one code path.
  if (fuel && fuel.system?.quantity?.value != null) {
    const consume = globalThis.acksExtras?.equipment?.consumeItem;
    if (typeof consume === "function") await consume(fuel, 1);
    else await fuel.update({ "system.quantity.value": Math.max(0, fuel.system.quantity.value - 1) });
  }
  return true;
}

/* -------------------------------------------- */
/*  A lone actor's own lights                   */
/* -------------------------------------------- */

/*
 * The mutators for the record `actorFlagLights` reads. A formation tracks fuel,
 * burn-down and shutters through its turn engine; an actor outside one has no
 * clock to burn against, so these track the STATE of a flame (lit, doused,
 * shuttered) and nothing about its duration. That is the honest half — a light
 * that shows on canvas and can be put out — and it is the half a character
 * standing alone in a corridor has ever been able to use.
 *
 * Every write goes through the actor's own flag, so a player who owns their
 * character may light their own lamp with no GM in the loop. This is the whole
 * reason the lone path is not simply a formation of one.
 */

/** Write the light list back, dropping the flag entirely when it empties. */
async function writeActorLights(actor, lights) {
  if (!lights.length) return actor.unsetFlag(MODULE_ID, FLAG_LIGHTS);
  return actor.setFlag(MODULE_ID, FLAG_LIGHTS, lights);
}

/**
 * Strike a new light the actor carries. Refused when the gear check refuses.
 * @returns {Promise<object|null>} the light record, or null if nothing was lit.
 */
export async function addActorLight(actor, type) {
  if (!(await prepareToLight(actor, type))) return null;
  const light = { id: randomId(), type, bearerId: actor.id, remaining: LIGHT_SOURCES[type].turns, lit: true };
  await writeActorLights(actor, [...actorFlagLights(actor), light]);
  return light;
}

/** Douse a lit source, or re-light a doused one. */
export async function toggleActorLight(actor, lightId) {
  const lights = actorFlagLights(actor).map((l) => (l.id === lightId ? { ...l, lit: !l.lit } : l));
  await writeActorLights(actor, lights);
}

/** Open or close a lantern's shutter. It keeps burning either way. */
export async function toggleActorShield(actor, lightId) {
  const lights = actorFlagLights(actor).map((l) =>
    l.id === lightId && LIGHT_SOURCES[l.type]?.shieldable ? { ...l, shielded: !l.shielded } : l,
  );
  await writeActorLights(actor, lights);
}

/** Forget a light entirely — the source is spent or put away for good. */
export async function removeActorLight(actor, lightId) {
  await writeActorLights(actor, actorFlagLights(actor).filter((l) => l.id !== lightId));
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

/* -------------------------------------------- */
/*  What is burning near a square                */
/* -------------------------------------------- */

/**
 * Pixels per scene distance unit, from a scene's grid. Read off the Scene
 * DOCUMENT rather than `canvas`, because a sweep runs over every scene in the
 * world and only one of them is ever the one on screen.
 */
function pixelsPerUnit(scene) {
  const size = Number(scene?.grid?.size) || 0;
  const distance = Number(scene?.grid?.distance) || 0;
  return distance > 0 ? size / distance : 0;
}

/** A placeable's centre in pixels. Tokens occupy a footprint; lights are points. */
function centreOf(doc, gridSize) {
  const w = Number(doc.width) || 0;
  const h = Number(doc.height) || 0;
  return { x: doc.x + (w * gridSize) / 2, y: doc.y + (h * gridSize) / 2 };
}

/**
 * The largest BRIGHT radius, in scene units, whose source actually reaches this
 * token — the "light range" ACKS Night Vision doubles indoors (MM §5).
 *
 * Every lit thing on the scene is a candidate: the scene's own ambient lights
 * and any token emitting light, the bearer's own torch included. A source
 * counts when the token stands inside its bright radius, so the answer is 0 in
 * an unlit corridor, which is what makes a night-vision creature blind in total
 * dark exactly as the books say.
 *
 * Distance is straight-line and ignores WALLS: a torch on the far side of a
 * door still reads as reaching. Resolving occlusion needs the live canvas, and
 * this has to answer for scenes nobody is looking at.
 *
 * @returns {number} bright radius in scene units (feet), 0 when nothing reaches
 */
export function brightestLightReaching(tokenDoc) {
  const scene = tokenDoc?.parent;
  const perUnit = pixelsPerUnit(scene);
  if (!perUnit) return 0;
  const gridSize = Number(scene.grid.size);
  const me = centreOf(tokenDoc, gridSize);

  let best = 0;
  const consider = (source, radius) => {
    const bright = Number(radius) || 0;
    if (bright <= best) return; // cannot win; skip the distance work
    const at = centreOf(source, gridSize);
    const feet = Math.hypot(at.x - me.x, at.y - me.y) / perUnit;
    if (feet <= bright) best = bright;
  };

  for (const light of scene.lights ?? []) {
    if (light.hidden) continue;
    consider(light, light.config?.bright);
  }
  for (const other of scene.tokens ?? []) {
    if (other.hidden) continue;
    consider(other, other.light?.bright);
  }
  return best;
}
