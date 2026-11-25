/**
 * The pure half of a live reach: who of the tokens inside an area counts, what
 * a moment does to a subject that does, the shape of the area a snapshot tests,
 * and the figures a row names.
 *
 * A reach is a core Region attached to its bearer's token (`aura-reach.mjs`);
 * core's containment is the membership and nothing here computes geometry or
 * keeps who is inside. This file decides only which of the tokens core says are
 * inside are the row's subjects. A row's reach is `{radius, filter, pulse}`: a
 * figure reference, the filter `{kinds, exceptKinds, side, unit}` and one of
 * `REACH_PULSES`. A clause that cannot be settled answers null, never false:
 * the caller lists such a subject for the Judge to tick. Foundry-free.
 */
import { MODULE_ID } from "./constants.mjs";
import { ACTOR_TYPE, REACH_PULSES, REACH_SIDES, REACH_UNITS } from "./vocab.mjs";
import { RACE_CATEGORIES, areEnemies, creatureKinds } from "./actor-read.mjs";
import { GROUP_FLAG } from "./group-logic.mjs";
import { getDoc, hasDoc } from "./tables.mjs";
import { numOrNull } from "./util.mjs";

/* -------------------------------------------- */
/*  Figures                                      */
/* -------------------------------------------- */

/** One figure read live off a registered table, or undefined where the document, table, row or figure is absent. */
function liveFigure(doc, table, row, figure) {
  if (!hasDoc(doc)) return undefined;
  return getDoc(doc).tables?.[table]?.[row]?.[figure];
}

/**
 * The figure a reference names (`figureRefField`): its own `value` where it
 * holds one, else the registered table's figure read now, else null. A figure
 * may be a number or text (a dice formula, a save kind); the caller parses what
 * it needs. Nothing stands in for a figure nobody imported or wrote.
 *
 * @param {{value?: *, doc?: string, table?: string, row?: string, figure?: string}|null} ref
 * @param {(doc: string, table: string, row: string, figure: string) => *} [read] the table read; the registry's by default
 * @returns {number|string|null}
 */
export function resolveFigure(ref, read = liveFigure) {
  if (!ref || typeof ref !== "object") return null;
  const own = typeof ref.value === "string" ? ref.value.trim() : ref.value;
  if (own !== undefined && own !== null && own !== "") return own;
  if (!ref.doc || !ref.table || !ref.row || !ref.figure) return null;
  const read_ = read(ref.doc, ref.table, ref.row, ref.figure);
  if (read_ === undefined || read_ === null || read_ === "") return null;
  return read_;
}

/** `resolveFigure` as a number, or null where nothing resolves or the figure is not one. */
export const figureNumber = (ref, read) => numOrNull(resolveFigure(ref, read));

/* -------------------------------------------- */
/*  Reading a reach and a behavior's config      */
/* -------------------------------------------- */

/** A stored word list as lowercase words, none blank. */
const words = (raw) => (Array.isArray(raw) || raw instanceof Set ? [...raw] : []).map((w) => String(w ?? "").trim().toLowerCase()).filter(Boolean);

/**
 * A stored filter as the one shape `reachAdmits` reads: the kinds and the kinds
 * excepted, each a list of lowercase words, `side` and `unit` one of their
 * vocabularies and `any` where absent or unknown.
 *
 * @returns {{kinds: string[], exceptKinds: string[], side: string, unit: string}}
 */
export function readFilter(raw) {
  const side = raw?.side;
  const unit = raw?.unit;
  return {
    kinds: words(raw?.kinds),
    exceptKinds: words(raw?.exceptKinds),
    side: side in REACH_SIDES ? side : "any",
    unit: unit in REACH_UNITS ? unit : "any",
  };
}

/**
 * A row's stored `reach` as `{radius, filter, pulse}`, or null for a row with
 * none or one whose pulse is no `REACH_PULSES` key (it acts on nothing).
 */
export function readReach(raw) {
  if (!raw || typeof raw !== "object" || !(raw.pulse in REACH_PULSES)) return null;
  return { radius: raw.radius ?? null, filter: readFilter(raw.filter), pulse: raw.pulse };
}

/**
 * An `aura` behavior's config as `{sourceUuid, bearerUuid, activationId,
 * rowKey}`, or null unless all four are set: a behavior a hand made through
 * core's Create Behavior list holds none and does nothing.
 */
export function readAuraConfig(raw) {
  const pick = (key) => String(raw?.[key] ?? "").trim();
  const config = { sourceUuid: pick("sourceUuid"), bearerUuid: pick("bearerUuid"), activationId: pick("activationId"), rowKey: pick("rowKey") };
  return Object.values(config).every(Boolean) ? config : null;
}

/* -------------------------------------------- */
/*  Who of those inside counts                   */
/* -------------------------------------------- */

/** The unit registration: `fn(bearerToken, subjectToken)` answers true, false or null for "the subject is the bearer's unit or one it leads". */
let unitAncestry = null;

/**
 * Register the reader of who leads what: the monsters feature knows a
 * leader's unit and its parent chain, lib does not import it. Until one is
 * registered `under` holds for the bearer's own unit and answers null for any
 * other. A call with a non-function clears it.
 * @param {((bearer: object, subject: object) => boolean|null)|null} fn
 */
export function registerUnitAncestry(fn) {
  unitAncestry = typeof fn === "function" ? fn : null;
}

/** A tri-state answer: true, false, or null for anything that is neither. */
const tri = (value) => (value === true ? true : value === false ? false : null);

/** The group a token belongs to (`GROUP_FLAG`), or "". */
const groupOfToken = (token) => String(token?.getFlag?.(MODULE_ID, GROUP_FLAG) ?? token?.flags?.[MODULE_ID]?.[GROUP_FLAG] ?? "");

/** Whether two token documents are one token. */
const sameToken = (a, b) => !!a && !!b && (a === b || (!!a.uuid && a.uuid === b.uuid) || (!!a.id && a.id === b.id && a.parent === b.parent));

/**
 * One kinds clause against what a creature answers to: `match` where any of
 * the names is among its kinds, `unknown` where it cannot be told (a creature
 * with no kinds at all, or a character whose class names no race meeting a
 * name that is a race category), else `none`.
 */
function kindsClause(names, have) {
  if ([...names].some((name) => have.has(name))) return "match";
  if (!have.size) return "unknown";
  const namesCategory = names.some((name) => RACE_CATEGORIES.includes(name));
  const hasCategory = RACE_CATEGORIES.some((name) => have.has(name));
  if (namesCategory && have.has("character") && !hasCategory) return "unknown";
  return "none";
}

/** The `unit` clause: `any`, `own` (the bearer's group), or `under` (own, or what the registration says). */
function unitClause(unit, bearer, subject) {
  if (unit === "any") return true;
  const mine = groupOfToken(bearer.token);
  const theirs = groupOfToken(subject.token);
  if (unit === "own") return mine ? !!theirs && theirs === mine : null;
  if (bearer.actor?.type === ACTOR_TYPE.character) return null;
  if (mine && theirs && mine === theirs) return true;
  return unitAncestry ? tri(unitAncestry(bearer.token, subject.token)) : null;
}

/**
 * Whether a subject is one of the filter's: true, false, or null where a
 * clause cannot be settled. The bearer itself and a marker token (a party or a
 * place standing on the map) are never subjects. A false from any clause wins;
 * otherwise a null from any clause is null.
 *
 * @param {{token: object, actor: object}} bearer
 * @param {{token: object, actor: object}} subject
 * @param {object} filter a stored filter (`readFilter` reads it)
 * @param {{kindsOf?: Function, enemies?: Function, isMarker?: Function}} [deps]
 *   `kindsOf(actor)` the kind set, `enemies(tokenA, tokenB)` the disposition
 *   test, `isMarker(actor)` the marker test (none is a marker by default)
 * @returns {boolean|null}
 */
export function reachAdmits(bearer, subject, filter, deps = {}) {
  const { kindsOf = creatureKinds, enemies = areEnemies, isMarker = () => false } = deps;
  if (sameToken(bearer?.token, subject?.token)) return false;
  if (isMarker(subject?.actor)) return false;
  const rule = readFilter(filter);
  const verdicts = [];
  if (rule.kinds.length || rule.exceptKinds.length) {
    const have = new Set(kindsOf(subject?.actor));
    if (rule.kinds.length) {
      const hit = kindsClause(rule.kinds, have);
      verdicts.push(hit === "match" ? true : hit === "none" ? false : null);
    }
    if (rule.exceptKinds.length) {
      const hit = kindsClause(rule.exceptKinds, have);
      verdicts.push(hit === "match" ? false : hit === "none" ? true : null);
    }
  }
  if (rule.side !== "any") {
    const apart = enemies(bearer?.token, subject?.token);
    verdicts.push(apart === null || apart === undefined ? null : rule.side === "opposing" ? apart : !apart);
  }
  verdicts.push(unitClause(rule.unit, bearer ?? {}, subject ?? {}));
  if (verdicts.includes(false)) return false;
  return verdicts.includes(null) ? null : true;
}

/* -------------------------------------------- */
/*  What a moment does                           */
/* -------------------------------------------- */

/** The moments a reach hears: a press, a subject entering or moving in or leaving, a turn start, a burst. */
export const REACH_MOMENTS = Object.freeze(["press", "enter", "moveIn", "exit", "turnStart", "burst"]);

/** The moments each pulse listens to; a moment outside its list does nothing (a subject that walks in fires both `enter` and `moveIn`, and only one prompts). */
const PULSE_MOMENTS = Object.freeze({
  action: ["press"],
  "turnStart+moveIn": ["moveIn", "turnStart"],
  standing: ["enter", "exit"],
  burst: ["burst"],
});

/**
 * What one moment does to one subject: `none` (not this pulse's moment, or the
 * subject is not the filter's), `undetermined` (the filter could not be
 * settled: list the subject for the Judge), `skip` (the subject holds an
 * immunity), `prompt` (ask the subject for its save), `on` and `off` (a
 * standing part to write or to take off). An exit takes the part off whoever
 * the filter says, since the part was written while the subject was inside.
 *
 * @param {{pulse: string, moment: string, admitted: boolean|null, immune?: boolean}} p
 * @returns {"none"|"undetermined"|"skip"|"prompt"|"on"|"off"}
 */
export function pulseAct({ pulse, moment, admitted, immune = false } = {}) {
  if (!(PULSE_MOMENTS[pulse] ?? []).includes(moment)) return "none";
  if (pulse === "standing" && moment === "exit") return "off";
  if (admitted === null || admitted === undefined) return "undetermined";
  if (admitted !== true) return "none";
  if (pulse === "standing") return "on";
  return immune ? "skip" : "prompt";
}

/* -------------------------------------------- */
/*  The area a snapshot tests                    */
/* -------------------------------------------- */

/**
 * The unsaved Region data a snapshot tests tokens against. `centre` is
 * `{token}` (the bearer's token source: an emanation of its footprint, as
 * core's `createTokenEmanation` builds one) or `{point: {x, y, elevation,
 * level}}` (a circle). The radius is the range in grid units times
 * `dimensions.distancePixels`, since a shape's radius is in pixels; a range in
 * feet passed as the radius contains almost nothing.
 *
 * @param {{token?: object, point?: object}} centre
 * @param {number} range grid units (feet)
 * @param {{distance: number, distancePixels: number}} dimensions the scene's
 * @returns {{ok: true, data: object}|{ok: false, reason: string}}
 */
export function snapshotRegionData(centre, range, dimensions) {
  const reach = numOrNull(range);
  const pixels = numOrNull(dimensions?.distancePixels);
  if (reach === null || !(reach > 0)) return { ok: false, reason: "range" };
  if (pixels === null || !(pixels > 0)) return { ok: false, reason: "scale" };
  const radius = reach * pixels;
  if (centre?.token) {
    const { x, y, elevation = 0, width, height, depth = 0, shape, level } = centre.token;
    const top = elevation + depth * (numOrNull(dimensions?.distance) ?? 0);
    return {
      ok: true,
      data: {
        shapes: [{ type: "emanation", base: { type: "token", x, y, width, height, shape, hole: false }, radius, gridBased: true }],
        elevation: { bottom: elevation - reach, top: top + reach },
        levels: level ? [level] : [],
      },
    };
  }
  if (centre?.point && numOrNull(centre.point.x) !== null && numOrNull(centre.point.y) !== null) {
    const { x, y, elevation = 0, level } = centre.point;
    return {
      ok: true,
      data: { shapes: [{ type: "circle", x, y, radius }], elevation: { bottom: elevation - reach, top: elevation + reach }, levels: level ? [level] : [] },
    };
  }
  return { ok: false, reason: "centre" };
}

/* -------------------------------------------- */
/*  Raising a reach, and a bearer going down     */
/* -------------------------------------------- */

/**
 * Whether a request to raise a reach goes ahead, and at what radius. The
 * Judge's seat asks with no `requestUserId`; a Player's request carries the id
 * the server attested. `world` is what the executing client read live: the
 * core features' `supported`, whether the token and the source were `found`,
 * the token's `ownerIds`, whether the bearer `carries` the source, whether the
 * bearer is `down` and the radius's `rangeFeet`.
 *
 * Answers `{ok, reason?, rangeFeet?, warn?}`. A downed bearer blocks a Player
 * and warns a Judge, who goes ahead; a blank radius stops either, since the
 * Region has nothing to span, and no figure stands in for it.
 *
 * @param {{requestUserId?: string|null}} req
 * @param {{supported: boolean, found: boolean, ownerIds?: string[], carries: boolean, down?: boolean, rangeFeet?: *}} world
 * @returns {{ok: boolean, reason?: string, rangeFeet?: number, warn?: string[]}}
 */
export function checkRaise(req, world) {
  if (!world?.supported) return { ok: false, reason: "unsupported" };
  if (!world.found) return { ok: false, reason: "gone" };
  const player = !!req?.requestUserId;
  if (player && !(world.ownerIds ?? []).includes(req.requestUserId)) return { ok: false, reason: "notOwner" };
  if (!world.carries) return { ok: false, reason: "notCarried" };
  const rangeFeet = numOrNull(world.rangeFeet);
  if (rangeFeet === null || !(rangeFeet > 0)) return { ok: false, reason: "noRange" };
  if (world.down && player) return { ok: false, reason: "down" };
  return { ok: true, rangeFeet, ...(world.down ? { warn: ["down"] } : {}) };
}

/**
 * Why a bearer is down, or null: `hp` where its hit points are at or below
 * zero, else `defeated` where the defeated status is on it. Hit points come
 * first, so a bearer that is both reads `hp`.
 *
 * @param {{hp: number|null, defeated: boolean}} bearer
 * @returns {"hp"|"defeated"|null}
 */
export function downCause({ hp, defeated } = {}) {
  const points = numOrNull(hp);
  if (points !== null && points <= 0) return "hp";
  return defeated === true ? "defeated" : null;
}
