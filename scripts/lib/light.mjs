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
 *
 * Light that is not a carried flame comes from Active Effects instead
 * (`magicLights`), and the token burns the stronger of the two (`shedLight`).
 * An effect's light shines only while its holder lets it (`lightStateOf`): worn,
 * carried loose, or on the actor itself, and not shuttered by hand.
 */

import { MODULE_ID } from "./constants.mjs";
import { feetToUnits } from "./distance-units.mjs";
import { appliedEffects, CHANGE } from "./effect-scan.mjs";
import { canWear, containedIn, findCarried, isEquippable, isPhysical, isWorn, siblingsOf } from "./item-model.mjs";
import { isStackable, quantityOf } from "./storage-logic.mjs";
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";
import { tokenCentre } from "./token-centre.mjs";
import { locOr, positiveFigure } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

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
  return { bright: positiveFigure(row.bright), dim: positiveFigure(row.dim), turns: positiveFigure(row.turns) };
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

  // Two-way hand check (the equipment feature). ROOM, not free hands: a two-handed
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
    console.error(`${MODULE_ID} | hand count failed`, err);
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
  const missing = gear.filter((g) => !inHandIs(g) && !findCarried(actor, g.pattern)).map((g) => locOr(g.label, g.label ?? ""));
  if (missing.length) {
    warnLight("needLightItem", { bearer: actor.name, items: missing.join(", ") });
    // "require" blocks — unless the Judge overrode and the world simply had no
    // such item to hand over. "warn" falls through and lights anyway.
    if (enforcement === "require" && !override) return false;
  }

  // Only a stack of what core cannot equip decrements: a torch carried as a
  // WEAPON is drawn and burns out on its own timer, and its count is the number
  // of torches in the row, not fuel. See docs/lib/DECISIONS.md, "Fuel burn-down
  // reuses the ammunition tracker (2026-09-22)" for why the decrement itself is
  // shared with equipment.
  if (fuel && isStackable(fuel) && !isEquippable(fuel)) {
    const consume = globalThis.acksExtras?.equipment?.consumeItem;
    const held = quantityOf(fuel);
    if (typeof consume === "function") await consume(fuel, 1);
    else await fuel.update({ [held.path]: Math.max(0, held.value - 1) });
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
/*  Light an effect sheds                       */
/* -------------------------------------------- */

/**
 * The flag namespace a magic light's two changes write under:
 * `flags.<module>.magicLight.bright` and `.dim`, in feet. A light that is not a
 * carried flame — cast on a character, or worn on an item — is declared as an
 * Active Effect carrying these, so the Judge types the reach from their own
 * copy and nothing printed ships.
 */
export const MAGIC_LIGHT_KEY = "magicLight";

/**
 * The bands a magic light can state, brightest first, each a radius in feet
 * from the light itself. Daylight is a level no flame reaches: a magic light
 * may shed it nearest, bright light beyond it and dim light beyond that.
 */
export const MAGIC_LIGHT_BANDS = Object.freeze(["daylight", "bright", "dim"]);

/** The change keys of a magic light effect, by band. */
export const MAGIC_LIGHT_CHANGE_KEYS = Object.freeze(
  Object.fromEntries(MAGIC_LIGHT_BANDS.map((band) => [band, `flags.${MODULE_ID}.${MAGIC_LIGHT_KEY}.${band}`])),
);

/** The flag on an Active Effect that a hand has shuttered: its light is held back, the effect stays applied. */
export const LIGHT_SHUTTER_FLAG = "lightShutter";

/**
 * The flag on a magic-light Active Effect naming the page its reach was read
 * from: the citation string of the cast spell that wrote it. `magicLights`
 * reads it back as each entry's `cite`.
 */
export const MAGIC_LIGHT_CITE_FLAG = "magicLightCite";

/**
 * The changes of a magic-light effect, one per band in `MAGIC_LIGHT_BANDS`
 * order, each an `upgrade` on the band's key so the engine keeps the largest
 * where several lights ride one bearer. A band's value is the figure in feet
 * as text when `bands` names a positive integer for it, else blank, which
 * sheds nothing.
 *
 * @param {{daylight?: *, bright?: *, dim?: *}} [bands]  Reach in feet by band.
 * @returns {{key: string, type: string, value: string}[]}
 */
export function magicLightChanges(bands = {}) {
  return MAGIC_LIGHT_BANDS.map((band) => {
    const feet = typeof bands?.[band] === "number" ? positiveFigure(bands[band]) : null;
    return {
      key: MAGIC_LIGHT_CHANGE_KEYS[band],
      type: CHANGE.UPGRADE,
      value: Number.isInteger(feet) ? String(feet) : "",
    };
  });
}

/**
 * What a magic-light Active Effect is made of: its `changes` and the flags to
 * spread into the effect's `flags["acks-extras"]`.
 *
 * @param {object} [options]
 * @param {{daylight?: *, bright?: *, dim?: *}} [options.bands]  Reach in feet by band, as `magicLightChanges` reads it.
 * @param {string} [options.cite]  The page the reach was read from; carried as `MAGIC_LIGHT_CITE_FLAG` when non-blank.
 * @returns {{changes: object[], flags: object}}
 */
export function magicLightRecord({ bands, cite } = {}) {
  const text = typeof cite === "string" ? cite.trim() : "";
  return { changes: magicLightChanges(bands), flags: text ? { [MAGIC_LIGHT_CITE_FLAG]: cite } : {} };
}

/** The page a magic-light effect's reach was read from, or null when it names none. */
export function magicLightCite(effect) {
  const cite = effect?.getFlag?.(MODULE_ID, MAGIC_LIGHT_CITE_FLAG) ?? effect?.flags?.[MODULE_ID]?.[MAGIC_LIGHT_CITE_FLAG];
  return typeof cite === "string" && cite.trim() ? cite : null;
}

/**
 * What a magic light is doing: `shining` (it counts toward what the bearer
 * sheds), `shuttered` (held back by hand) or `stowed` (its holder is not
 * carrying it where it shines).
 */
export const LIGHT_STATE = Object.freeze({ SHINING: "shining", SHUTTERED: "shuttered", STOWED: "stowed" });

/** Whether an effect declares a magic light: it carries a change on any band's key. */
export function writesMagicLight(effect) {
  const keys = Object.values(MAGIC_LIGHT_CHANGE_KEYS);
  return [...(effect?.changes ?? [])].some((change) => keys.includes(change?.key));
}

/** Whether a hand has shuttered this effect's light. */
export function isLightShuttered(effect) {
  return (effect?.getFlag?.(MODULE_ID, LIGHT_SHUTTER_FLAG) ?? effect?.flags?.[MODULE_ID]?.[LIGHT_SHUTTER_FLAG]) === true;
}

/** The name of the container an item is stored in, or null when it names none that can be found. */
function containerNameOf(item) {
  const id = containedIn(item);
  const found = id ? siblingsOf(item)?.get?.(id) : null;
  return String(found?.name ?? "") || null;
}

/**
 * Whether an effect's light shines, and why. `null` for an effect that is never
 * a carried light (one on a spell item: a spell's light is cast onto a holder,
 * never held). Otherwise `{state, why, container}`: `why` names the rule that
 * decided, one of `actor` (the effect is on the actor itself), `item` (on an
 * item that is not goods, such as an ability), `worn`, `carried` (a thing that
 * cannot be worn, outside any container), `unworn`, `container` (stowed in
 * `container`, a name or null), or `shuttered`.
 *
 * The gate reads only the item the effect rides on, because the hooks that
 * relight a party fire for that item's own update. A wearable shines only while
 * worn; a thing that cannot be worn only while it is outside every container.
 * The shutter is read last, so a stowed light stays stowed whatever the shutter
 * says and keeps the shutter's setting for when it comes out.
 */
export function lightStateDetail(effect) {
  const holder = effect?.parent?.documentName === "Item" ? effect.parent : null;
  let why = "actor";
  let container = null;
  if (holder) {
    if (holder.type === ITEM_TYPE.spell) return null;
    if (!isPhysical(holder)) why = "item";
    else {
      const stowed = containedIn(holder);
      container = stowed ? containerNameOf(holder) : null;
      if (canWear(holder)) {
        if (!isWorn(holder)) return { state: LIGHT_STATE.STOWED, why: stowed ? "container" : "unworn", container };
        why = "worn";
      } else {
        if (stowed) return { state: LIGHT_STATE.STOWED, why: "container", container };
        why = "carried";
      }
    }
  }
  if (isLightShuttered(effect)) return { state: LIGHT_STATE.SHUTTERED, why: "shuttered", container: null };
  return { state: LIGHT_STATE.SHINING, why, container: null };
}

/** An effect's light state (`LIGHT_STATE`), or null for an effect that is never a carried light. */
export function lightStateOf(effect) {
  return lightStateDetail(effect)?.state ?? null;
}

/**
 * Hold an effect's light back, or let it shine again. Written to a flag on the
 * effect, never to `disabled`: an effect may carry other changes, and a disabled
 * effect leaves the actor's applied effects altogether. The write is the
 * seat's own, so only a user who owns the effect may make it.
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setLightShutter(effect, on) {
  if (!effect?.isOwner || isLightShuttered(effect) === !!on) return false;
  if (on) await effect.setFlag(MODULE_ID, LIGHT_SHUTTER_FLAG, true);
  else await effect.unsetFlag(MODULE_ID, LIGHT_SHUTTER_FLAG);
  return true;
}

/** A lang string from this module's light keys, or the key itself where no i18n stands. */
function lightText(key, data) {
  const full = `ACKS-LIB.light.state.${key}`;
  try {
    return game?.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  } catch {
    return full;
  }
}

/**
 * What a surface shows for one light effect: its state's badge and the tooltip
 * saying why, and the shutter control for a seat that owns the effect.
 * `{state, shining, badge, stateTip, canShutter, shuttered, actionLabel,
 * actionAria, actionTip}`; null for an effect that is never a carried light. Every name in
 * it is the item's (`name`), never the effect's, because an effect's own name
 * can be hidden until its item is identified. `bearer` is who carries it.
 * @param {ActiveEffect} effect
 * @param {{name: string, bearer?: string}} names
 */
export function lightControl(effect, { name, bearer = "" } = {}) {
  const detail = lightStateDetail(effect);
  if (!detail) return null;
  const shuttered = isLightShuttered(effect);
  const why = detail.why === "container" && !detail.container ? "containerUnnamed" : detail.why;
  const args = { name, bearer, container: detail.container ?? "" };
  return {
    state: detail.state,
    shining: detail.state === LIGHT_STATE.SHINING,
    badge: lightText(`label.${detail.state}`),
    stateTip: lightText(`why.${why}`, args),
    canShutter: !!effect?.isOwner,
    shuttered,
    actionLabel: lightText(shuttered ? "open" : "shutter"),
    actionAria: lightText(shuttered ? "openAria" : "shutterAria", args),
    actionTip: lightText(shuttered ? "openTip" : "shutterTip", args),
  };
}

/**
 * Every magic light an actor holds: one entry per applied Active Effect that
 * writes a band's key, `{id, uuid, label, itemName, itemId, daylight, bright,
 * dim, state, cite}`. `itemName` and `itemId` are the item the effect rides on, null for
 * an effect placed on the actor; each band is feet, null when
 * the effect states none; `state` is the effect's `LIGHT_STATE`; `cite` is the
 * page the reach was read from (`magicLightCite`), null when the effect names
 * none. Read from the
 * effect's own change values rather than from the prepared flag, so each
 * source stays nameable. A disabled or suppressed effect is not applied and so
 * is not listed, nor is one that is never a carried light (`lightStateOf`
 * null); a change's type is not read, the largest figure per radius standing
 * when an effect repeats a key. Only a shining entry counts toward what the
 * actor sheds (`effectLight`).
 */
export function magicLights(actor) {
  const out = [];
  for (const effect of appliedEffects(actor)) {
    if (!effect || effect.disabled || effect.isSuppressed === true) continue;
    const reach = { daylight: null, bright: null, dim: null };
    let writes = false;
    for (const change of [...(effect.changes ?? [])]) {
      const band = MAGIC_LIGHT_BANDS.find((b) => change?.key === MAGIC_LIGHT_CHANGE_KEYS[b]);
      if (!band) continue;
      writes = true;
      reach[band] = Math.max(reach[band] ?? 0, positiveFigure(change.value) ?? 0) || null;
    }
    if (!writes) continue;
    const { daylight, bright, dim } = reach;
    const state = lightStateOf(effect);
    if (!state) continue;
    const onItem = effect.parent?.documentName === "Item";
    const itemName = onItem ? String(effect.parent.name ?? "") || null : null;
    out.push({
      id: effect.id ?? null,
      uuid: effect.uuid ?? null,
      label: String(effect.name ?? "") || itemName || "",
      itemName,
      itemId: onItem ? effect.parent.id ?? null : null,
      daylight,
      bright,
      dim,
      state,
      cite: magicLightCite(effect),
    });
  }
  return out;
}

/**
 * The largest `{daylight, bright, dim}` reach, in feet, among the actor's
 * shining magic lights. Each radius is measured from the light itself, so
 * daylight is bright light as well: `bright` is never less than `daylight`,
 * and every reader of bright reach (mapping, the column, the token) counts a
 * light that states only a daylight radius.
 */
export function effectLight(actor) {
  let daylight = 0;
  let bright = 0;
  let dim = 0;
  for (const light of magicLights(actor)) {
    if (light.state !== LIGHT_STATE.SHINING) continue;
    daylight = Math.max(daylight, light.daylight ?? 0);
    bright = Math.max(bright, light.bright ?? 0, light.daylight ?? 0);
    dim = Math.max(dim, light.dim ?? 0);
  }
  return { daylight, bright, dim };
}

/**
 * The stronger of a flame's reach and a magic light's, and which kind it
 * came from, so a caller can pick the look: `{daylight, bright, dim, kind}`
 * with `kind` `"magic"` when the magic light has the larger bright radius (the
 * larger dim radius when the bright radii tie) and `"flame"` otherwise, a tie
 * included. Each radius is the larger of the two, so a short flame never dims
 * a long effect's far edge. A flame sheds no daylight, so `daylight` is the
 * magic light's alone.
 */
export function mergeLight(flame, magic) {
  const f = { bright: Number(flame?.bright) || 0, dim: Number(flame?.dim) || 0 };
  const m = { daylight: Number(magic?.daylight) || 0, bright: Number(magic?.bright) || 0, dim: Number(magic?.dim) || 0 };
  const magicWins = m.bright > f.bright || (m.bright === f.bright && m.dim > f.dim);
  return { daylight: m.daylight, bright: Math.max(f.bright, m.bright), dim: Math.max(f.dim, m.dim), kind: magicWins ? "magic" : "flame" };
}

/**
 * The light an actor's token burns: the stronger of what its carried flames
 * shed (`emittedLight`) and what its effects shed (`effectLight`), in feet,
 * with the `kind` that won (`mergeLight`). Foundry draws two radii, so the
 * token takes `bright` and `dim`; `daylight` is for a reader of that level.
 * @returns {{daylight: number, bright: number, dim: number, kind: "flame"|"magic"}}
 */
export function shedLight(actor) {
  return mergeLight(emittedLight(bearerLights(actor)), effectLight(actor));
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

/** A light's or a loose point's place in pixels: it occupies none, so its centre is itself. */
const pointOf = (point) => ({ x: point.x, y: point.y });

/** The scene's darkness level, 0 (day) to 1 (night). */
function darknessOf(scene) {
  return Number(scene?.environment?.darknessLevel ?? scene?.darkness ?? 0) || 0;
}

/**
 * Whether a stored light source shines at all, for the reader that must not
 * count a source that only looks like one: a darkness source (`negative`)
 * sheds none, and a light with an activation range shines only while the
 * scene's darkness is inside it.
 */
function shinesNow(config, darkness) {
  if (config?.negative) return false;
  const { min = 0, max = 1 } = config?.darkness ?? {};
  return darkness >= min && darkness <= max;
}

/**
 * A token's daylight radius in scene units: what the light its actor sheds
 * states as daylight, which no stored token light carries. 0 for a token with
 * no actor or one whose light cannot be read.
 */
function tokenDaylight(scene, token) {
  try {
    const feet = token.actor ? shedLight(token.actor).daylight : 0;
    return feet > 0 ? feetToUnits(feet, scene.grid?.units) : 0;
  } catch {
    return 0;
  }
}

/**
 * The flag on an AmbientLight document, under this module's namespace, holding
 * its daylight radius in the scene's distance units, beside core's own bright
 * and dim radii (`ambient-daylight.mjs` edits it in the light's config window).
 */
export const AMBIENT_DAYLIGHT_FLAG = "daylight";

/**
 * The daylight radius a placed light sheds, in scene units, or null when its
 * flag is blank, absent, zero or not a finite figure. Core's `bright` and `dim`
 * are never read or written here.
 * @param {AmbientLightDocument|object} lightDoc
 * @returns {number|null}
 */
export function ambientDaylight(lightDoc) {
  const stored = lightDoc?.getFlag?.(MODULE_ID, AMBIENT_DAYLIGHT_FLAG) ?? lightDoc?.flags?.[MODULE_ID]?.[AMBIENT_DAYLIGHT_FLAG];
  return positiveFigure(stored);
}

/** The page naming the sky's daylight, shown beside a reading the sky decided. */
const SKY_CITE = "RR ch. 6";
/** The page naming a light's daylight band, shown beside a reading a light's daylight decided. */
const DAYLIGHT_BAND_CITE = "RR p. 228";

/** A source's own name, or null when it has none. */
const sourceName = (thing) => String(thing?.name ?? "").trim() || null;

/**
 * The deciding source of one band at `me` (a pixel point), `{reach, source}`:
 * the largest radius, in scene units, among the scene's sources that reach it,
 * and which source that is (`source` is `{kind, name, cite}`, null with `reach`
 * 0 when nothing reaches). Sources are ambient lights, tokens' own lights and a
 * marching column's lights. Straight-line, ignoring walls. `band` is `"bright"`,
 * `"dim"` or `"daylight"`. An ambient light's daylight is its flag
 * (`ambientDaylight`), and its bright reach is the larger of core's `bright`
 * and that flag, since daylight is bright light as well; a token's daylight comes
 * from its actor's light (`tokenDaylight`). `strict` also leaves out a source
 * that does not shine (`shinesNow`); `extra` is more points,
 * `{x, y, name?, bright, dim?, daylight?}`, a caller holds that no document stores.
 *
 * Where two sources reach by the same radius the first considered keeps the
 * reading: ambient lights in document order, then tokens, then the column's
 * points, then `extra`.
 */
function strongestSource(scene, me, { strict = false, extra = [], band = "bright" } = {}) {
  const perUnit = pixelsPerUnit(scene);
  if (!perUnit) return { reach: 0, source: null };
  const darkness = darknessOf(scene);

  let best = { reach: 0, source: null };
  const bodyOf = (token) => tokenCentre(token, scene);
  // The page is the daylight band's, and only where a module-known source states it.
  const citeFor = (kind) => (band === "daylight" && kind !== "extra" ? DAYLIGHT_BAND_CITE : null);
  const consider = (kind, thing, radius, centreOf = pointOf) => {
    const reach = Number(radius) || 0;
    if (reach <= best.reach) return; // cannot win; skip the distance work
    const at = centreOf(thing);
    const feet = Math.hypot(at.x - me.x, at.y - me.y) / perUnit;
    if (feet <= reach) best = { reach, source: { kind, name: sourceName(thing), cite: citeFor(kind) } };
  };

  for (const light of scene.lights ?? []) {
    if (light.hidden || (strict && !shinesNow(light.config, darkness))) continue;
    const daylight = ambientDaylight(light) ?? 0;
    const radius = band === "daylight" ? daylight : band === "bright" ? Math.max(Number(light.config?.bright) || 0, daylight) : light.config?.[band];
    consider("ambient", light, radius);
  }
  for (const other of scene.tokens ?? []) {
    if (other.hidden) continue;
    if (band === "daylight") {
      consider("token", other, tokenDaylight(scene, other), bodyOf);
      continue;
    }
    if (strict && !shinesNow(other.light, darkness)) continue;
    consider("token", other, other.light?.[band], bodyOf);
  }
  // The lights a marching column sheds from its bearers' cells, which no
  // document stores. Asked through the shared namespace, as `bearerLights`
  // asks: each point is a pixel centre with radii in scene units.
  const columnPoints = globalThis.acksExtras?.formation?.carriedLightPoints;
  if (typeof columnPoints === "function") {
    for (const point of columnPoints(scene) ?? []) consider("column", point, point[band]);
  }
  for (const point of extra) consider("extra", point, point[band]);
  return best;
}

/** The largest radius of one band that reaches `me`, in scene units: `strongestSource`'s `reach`. */
function strongestReach(scene, me, options) {
  return strongestSource(scene, me, options).reach;
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
  return strongestReach(scene, tokenCentre(tokenDoc, scene));
}

/**
 * The largest bright radius, in scene units, among the lights that shine on a
 * point of the scene: what a reader asks of a square, a body's place in a
 * column or a token's centre. Reads what `brightestLightReaching` reads, but
 * counts only a source that shines now: a darkness source (`negative`) never
 * does, and a source with an activation range does only while the scene's
 * darkness sits in it. An ambient light's daylight radius (`ambientDaylight`)
 * counts here as bright reach, so a light's reach is the larger of its `bright`
 * and its daylight. Straight-line, ignoring walls, and answers for a scene
 * nobody is viewing.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} point pixel centre
 * @param {object} [opts]
 * @param {{x: number, y: number, bright: number}[]} [opts.extra] further light
 *   points the caller reads from its own record, `bright` in scene units
 * @returns {number} bright radius in scene units, 0 when nothing reaches
 */
export function brightestLightAt(scene, point, { extra = [] } = {}) {
  if (!scene || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return 0;
  return strongestReach(scene, point, { strict: true, extra });
}

/* -------------------------------------------- */
/*  How brightly a place is lit                  */
/* -------------------------------------------- */

/**
 * The levels of light a place can be in, brightest first: under the day's sky or
 * a light's daylight band, in bright light, in dim light, in none. A reader asks
 * whether a place is lit AT LEAST a level (`lightAtLeast`), and daylight
 * satisfies only daylight.
 */
export const LIGHT_LEVELS = Object.freeze(["daylight", "bright", "dim", "dark"]);

/** Whether `level` is `floor` or brighter. A level that is no level is never at least anything. */
export function lightAtLeast(level, floor) {
  const at = LIGHT_LEVELS.indexOf(level);
  const need = LIGHT_LEVELS.indexOf(floor);
  return at >= 0 && need >= 0 && at <= need;
}

/** Whether a Region is flagged as the indoors of a map: a place not under the sky. */
const isIndoors = (region) => !!(region?.getFlag?.(MODULE_ID, "cookbook")?.indoors ?? region?.flags?.[MODULE_ID]?.cookbook?.indoors);

/**
 * Whether the scene's own sky is daylight: global illumination on, the scene's
 * darkness inside the range that illumination is limited to, and darkness below
 * half. A scene with no global illumination has no sky to read.
 */
function skyIsDaylight(scene) {
  const global = scene?.environment?.globalLight;
  if (!global?.enabled) return false;
  const darkness = darknessOf(scene);
  const { min = 0, max = 1 } = global.darkness ?? {};
  return darkness >= min && darkness <= max && darkness < 0.5;
}

/** Whether the point stands in a Region flagged indoors, at `elevation`. */
function indoorsAt(scene, point, elevation) {
  for (const region of scene.regions ?? []) {
    if (!isIndoors(region)) continue;
    try {
      if (region.testPoint?.({ x: point.x, y: point.y, elevation })) return true;
    } catch {
      /* a region whose geometry cannot be tested does not roof the point */
    }
  }
  return false;
}

/**
 * How brightly a point of a scene is lit: `{level, by, source}` with `level` one
 * of `LIGHT_LEVELS` and `by` what decided it: `"sky"` (the scene's daylight, with
 * the point not inside an indoors Region), `"light"` (a source's daylight,
 * bright or dim reach, `brightestLightAt`'s reading) or `"none"` (dark).
 * Straight-line, ignoring walls, and answers for a scene nobody is viewing.
 * Daylight from a light is a placed light's flag (`ambientDaylight`), a token's
 * own actor's daylight band (`shedLight`), the marching column's lights and
 * `extra`.
 *
 * `source` names the thing that decided, `{kind, name, cite}`: `kind` is `sky`,
 * `ambient`, `token`, `column` or `extra`; `name` is that thing's own name, null
 * where it has none; `cite` is the page that names the level (the sky's, or a
 * light's daylight band), null where the module knows none. It is null for a dark
 * point. Of several sources reaching a point, the one reaching furthest in the
 * level's band is named, and a tie goes by kind (ambient, token, column, extra)
 * and then by order among its kind; the sky is read before every light.
 *
 * @param {Scene} scene
 * @param {{x: number, y: number}} point pixel centre
 * @param {object} [opts]
 * @param {{x: number, y: number, bright?: number, dim?: number, daylight?: number}[]} [opts.extra]
 *   further light points the caller reads from its own record, radii in scene units
 * @param {boolean} [opts.daylit] replaces the scene's own sky reading (a journey's
 *   clock states the hour the scene's darkness does not); an indoors Region still roofs the point
 * @param {number} [opts.elevation] the point's elevation, for a Region bounded in height
 * @returns {{level: string, by: string, source: {kind: string, name: string|null, cite: string|null}|null}|null}
 *   null with no scene or no point
 */
export function lightLevelAt(scene, point, { extra = [], daylit, elevation = 0 } = {}) {
  if (!scene || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  const sky = typeof daylit === "boolean" ? daylit : skyIsDaylight(scene);
  if (sky && !indoorsAt(scene, point, elevation)) return { level: "daylight", by: "sky", source: { kind: "sky", name: null, cite: SKY_CITE } };
  for (const band of ["daylight", "bright", "dim"]) {
    const { reach, source } = strongestSource(scene, point, { strict: true, extra, band });
    if (reach > 0) return { level: band, by: "light", source };
  }
  return { level: "dark", by: "none", source: null };
}

/** How brightly a token's centre is lit; see `lightLevelAt`. Null for a token on no scene. */
export function lightLevelOf(tokenDoc, opts = {}) {
  const scene = tokenDoc?.parent;
  const size = Number(scene?.grid?.size);
  if (!(size > 0)) return null;
  return lightLevelAt(scene, tokenCentre(tokenDoc, scene), { elevation: Number(tokenDoc.elevation) || 0, ...opts });
}
