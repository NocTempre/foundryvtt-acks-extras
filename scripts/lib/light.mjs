/* global globalThis, game, ui, foundry */

/**
 * Light sources, and who is carrying one — the kinds of light, the reader of
 * their imported figures, and the single answer to "how brightly does this
 * actor's token burn?".
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
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";

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

/** The registered document a light source's printed figures arrive in. */
export const LIGHT_DOC = "light";
/** Its one table: `{[kind]: {bright, dim, turns}}`, feet and turns. */
export const LIGHT_TABLE = "lightSources";

/**
 * The kinds of light this module knows how to carry: what each needs in the
 * pack and how it is put out. How far each one reaches and how long it burns
 * is printed (RR p. 265) and read through `lightFigures`, never from here.
 *   `consumes` — the FUEL item decremented when lit (and required, when
 *                enforcement is on). For a torch/candle the item IS the fuel;
 *                for a lantern it is a flask of (common) oil, NOT the lantern.
 *   `holder`   — an optional durable DEVICE that must be carried but is NOT
 *                consumed (the lantern itself). Absent → the fuel is the device.
 *   `fuelLabel`— i18n label for the fuel, when it differs from the device.
 *   `holderItem` — the device to hand over when a Judge supplies the gear
 *                (see `lightGear`), by the name the system's own equipment
 *                compendium gives it, so the granted item is core's, not a
 *                copy. The fuel carries no name: what is handed over is the
 *                largest stack `consumes` matches (equipment `grant.mjs`).
 *
 * A lantern burns COMMON oil; military oil is a thrown weapon (RR p297) and
 * must never read as lamp fuel — see docs/lib/DECISIONS.md, "The lantern
 * fuel pattern rejects on the whole name, not a lookbehind (2026-09-22)".
 */
export const LIGHT_SOURCES = Object.freeze({
  torch: {
    label: "ACKS-LIB.light.torch",
    consumes: /torch/i,
  },
  lantern: {
    label: "ACKS-LIB.light.lantern",
    holder: /lantern/i,
    holderItem: "Lantern",
    consumes: /^(?!.*\bmilitary\b).*\boil\b/i,
    fuelLabel: "ACKS-LIB.light.oil",
    // A closed lantern hides its light and burns on (RR equipment).
    shieldable: true,
  },
  candle: {
    label: "ACKS-LIB.light.candle",
    consumes: /candle/i,
  },
});

/** The light kinds, in table order. */
export const LIGHT_KINDS = Object.freeze(Object.keys(LIGHT_SOURCES));

/** Declare the light table, so an import names it as missing until it lands. */
export function declareLightTables() {
  expectTables(LIGHT_DOC, [LIGHT_TABLE]);
}

/** A stored figure as a positive number, or null for anything else. */
function figure(value) {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * How far one kind of light reaches and how long it burns, as the world's
 * table gives it (the Judge's override over the import): `{bright, dim}` in
 * feet and `turns`, each null when nothing registered says. Nothing is
 * defaulted: a world that has imported no light table carries lights that
 * shed nothing and never burn down.
 * @returns {{bright: number|null, dim: number|null, turns: number|null}}
 */
export function lightFigures(type) {
  const none = { bright: null, dim: null, turns: null };
  if (!LIGHT_SOURCES[type] || !hasDoc(LIGHT_DOC)) return none;
  const row = getDoc(LIGHT_DOC)?.tables?.[LIGHT_TABLE]?.[type];
  if (!row || typeof row !== "object") return none;
  return { bright: figure(row.bright), dim: figure(row.dim), turns: figure(row.turns) };
}

/**
 * The page the light table was read from, or null when it is the Judge's own
 * or nothing is registered (`citeOf`).
 */
export function lightCite() {
  return citeOf(LIGHT_DOC, LIGHT_TABLE);
}

/**
 * Which light source an item is, by its name — the device where the source has
 * one (a lantern), else the fuel (a torch, a candle) — or null for anything
 * else. A readied torch, a weapon under the torch's own name, answers "torch"
 * like the stack it came off.
 */
export function lightTypeOf(item) {
  const n = String(item?.name ?? "");
  for (const [type, cfg] of Object.entries(LIGHT_SOURCES)) {
    if ((cfg.holder ?? cfg.consumes).test(n)) return type;
  }
  return null;
}

/**
 * Everything a light source needs in the pack before it can burn, device first.
 *
 * ONE list answers both halves of the equipment rule: what is missing (test each
 * `pattern` against the bearer's inventory) and what to hand over when a Judge
 * supplies it (create each `name`). A torch and a candle are their own device,
 * so they yield a single entry; a lantern yields the lamp and its oil.
 *
 * `fuel` marks the piece the flame eats — the one that must have stock left, and
 * the one decremented when the light is struck. The fuel has no `name`: a
 * grant finds it by `pattern`, as the stack holding the most.
 * @returns {{pattern: RegExp, name?: string, label: string, fuel: boolean}[]}
 */
export function lightGear(type) {
  const cfg = LIGHT_SOURCES[type];
  if (!cfg) return [];
  const gear = [];
  if (cfg.holder) {
    gear.push({ pattern: cfg.holder, name: cfg.holderItem, label: cfg.label, fuel: false });
  }
  gear.push({ pattern: cfg.consumes, label: cfg.fuelLabel ?? cfg.label, fuel: true });
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
 * Everything that must be true before a flame is struck, and the fuel it
 * eats when it is — shared by the formation's turn engine and a lone
 * character's own sheet, per docs/lib/DECISIONS.md, "A character alone can
 * strike a light (2026-08-11)". Consumes the fuel as a side effect of the
 * check passing, so a refused light never spends what it warned about.
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

  // Two-way hand check (acks-equipment). ROOM, not free hands: a two-handed
  // grip widens for a spare hand and gives it back for the torch, so asking
  // what is free would wrongly refuse it. A source of this type already drawn
  // and unlit needs no hand beyond the one it is in, so `roomForLight` is
  // asked first and the spare-hand count only where it is absent. An
  // unreadable hand count skips the check rather than refusing.
  let freeHands;
  let held = "";
  let room = null;
  let inHand = null;
  try {
    const equipment = globalThis.acksExtras?.equipment;
    inHand = equipment?.unlitInHand?.(actor, type) ?? null;
    room = equipment?.roomForLight?.(actor, type) ?? null;
    freeHands = equipment?.spareHands?.(actor) ?? equipment?.freeHands?.(actor);
    // Names what the sheet already shows in hand, so the refusal is not unexplained.
    held = equipment?.heldHandsClause?.(actor) ?? "";
  } catch (err) {
    console.error(`${MODULE_ID} | acks-equipment hand count failed`, err);
  }
  const noRoom = typeof room === "boolean" ? !room : Number.isFinite(freeHands) && freeHands <= 0;
  if (noRoom) {
    warnLight(held ? "noFreeHandHeld" : "noFreeHand", { bearer: actor.name, held });
    // Hands the override could not empty are full of lit sources, which
    // sheathing cannot fix. Say so; do not stop a Judge over it.
    if (!override) return false;
  }

  // Equipment requirement (RR p265). "require" (default) blocks lighting
  // without the gear; "warn" lights anyway with a warning; "off" ignores it.
  const enforcement = lightEnforcement();
  if (enforcement === "off") return true;

  // A source already drawn is the gear it matches: a readied torch in hand is
  // the fuel, and lighting it spends nothing off the stack it was readied from.
  const gear = lightGear(type);
  const inHandIs = (g) => !!inHand && g.pattern.test(inHand.name ?? "");
  const fuelGear = gear.find((g) => g.fuel);
  const fuel = inHandIs(fuelGear) ? null : findCarried(actor, fuelGear.pattern);
  const missing = gear.filter((g) => !inHandIs(g) && !findCarried(actor, g.pattern)).map((g) => localize(g.label));
  if (missing.length) {
    warnLight("needLightItem", { bearer: actor.name, items: missing.join(", ") });
    // "require" blocks — unless the Judge overrode and the world simply had no
    // such item to hand over. "warn" falls through and lights anyway.
    if (enforcement === "require" && !override) return false;
  }

  // Only a genuine stack decrements: a torch carried as a WEAPON has no
  // `system.quantity` (core weapons don't) and simply burns out on its own
  // timer. See docs/lib/DECISIONS.md, "Fuel burn-down reuses the ammunition
  // tracker (2026-09-22)" for why the decrement itself is shared with equipment.
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

// The mutators for the record `actorFlagLights` reads: state only (lit,
// doused, shielded), never duration — see docs/lib/DECISIONS.md, "A character
// alone can strike a light (2026-08-11)". Every write goes through the
// actor's own flag, so its owner needs no GM in the loop.

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
  // With no burn time imported the light carries none and never burns down.
  const light = { id: randomId(), type, bearerId: actor.id, remaining: lightFigures(type).turns, lit: true };
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
 * The light a set of sources actually sheds, in feet: the brightest lit,
 * unshuttered one. A closed lantern sheds nothing though it keeps burning, and
 * a doused source is stowed — both read as dark here, and so does a kind whose
 * reach is not imported.
 */
export function emittedLight(lights) {
  let bright = 0;
  let dim = 0;
  for (const light of lights ?? []) {
    if (!light?.lit || light.shielded) continue;
    const figures = lightFigures(light.type);
    bright = Math.max(bright, figures.bright ?? 0);
    dim = Math.max(dim, figures.dim ?? 0);
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
 * The largest BRIGHT radius, in scene units, whose source actually reaches
 * this token — the "light range" ACKS Night Vision doubles indoors (MM §5;
 * docs/lib/MODEL.md's senses section). Straight-line, ignoring walls: this
 * has to answer for scenes nobody is looking at.
 *
 * Read off stored data — an ambient light's `config.bright` and a token's
 * `light.bright` — so it is in the SCENE's `grid.units`, the unit `sight.range`
 * is stored in too, and is feet only on a scene measured in feet. A caller that
 * works in feet converts it (`feetPerUnit`).
 *
 * @returns {number} bright radius in scene units, 0 when nothing reaches
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
  // The lights a marching column sheds from its bearers' cells, which no
  // document stores. Asked through the shared namespace, as `bearerLights`
  // asks: each point is a pixel centre with a bright radius in scene units.
  const columnPoints = globalThis.acksExtras?.formation?.carriedLightPoints;
  if (typeof columnPoints === "function") {
    for (const point of columnPoints(scene) ?? []) consider({ x: point.x, y: point.y, width: 0, height: 0 }, point.bright);
  }
  return best;
}
