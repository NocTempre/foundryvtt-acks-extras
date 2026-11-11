/**
 * Player summons — the pure half. A summon is a creature whose actor carries
 * the summoner's uuid in `flags["acks-extras"].summonedBy`; for an unlinked
 * token the flag lives in that token's own delta, so each token is one summon
 * and leaves with it. The module's own summoning stamps a second record beside
 * it (`summon`) naming what was summoned, by which cast and when, which is what
 * lets a cast be dismissed as a group. Foundry-free: documents arrive as the
 * duck-typed shapes the checks below name, so the relay's authorization is
 * testable offline.
 */
import { MODULE_ID } from "./constants.mjs";

/** The actor flag naming the character a creature was summoned by (an actor uuid). */
export const SUMMON_FLAG = "summonedBy";

/** The actor flag the module's own summoning writes: `{sourceUuid, name, spellId, spellName, castId, at}`. */
export const SUMMON_RECORD_FLAG = "summon";

/**
 * The one switch that decides whether a summoning may name no spell. A request
 * whose summoner names a spell is never held to it; a request that names none
 * is refused `spellRequired` for a seat this answers false for. Every gate that
 * depends on the answer (the relay's check, the seat's own pre-check, the
 * bare Summon… prompt) reads it here and nowhere else.
 * @param {{isGM?: boolean}|null} user
 * @returns {boolean} true for a GM seat
 */
export const bareSummonAllowed = (user) => !!user?.isGM;

/** The registered policies, in registration order. */
const policies = new Set();

/**
 * Register a refusal policy a feature adds to `checkPlaceRequest` without lib
 * importing the feature. A policy is `({user, summoner, source, sourceRef,
 * count, spellId, spell}) => string|null`: null (or anything that is not a
 * non-empty string) allows, a string is the refusal's reason id. It runs after
 * every built-in check, on the requesting seat and on the GM's client alike,
 * so it must answer from documents both can read, and synchronously: a
 * promise is not a string and allows. `source` is null on a seat that could
 * not resolve the creature the spell names, and `sourceRef` is then the ref
 * the request carries. A policy that throws is logged and counts as an allow:
 * a broken feature never locks the summoner out.
 * @param {Function} fn
 * @returns {() => boolean} unregisters it; true when it was registered
 */
export function registerSummonPolicy(fn) {
  if (typeof fn !== "function") throw new TypeError("registerSummonPolicy needs a function");
  policies.add(fn);
  return () => policies.delete(fn);
}

/** The registered namings, in registration order. */
const namings = new Set();

/**
 * Register what makes a creature SPELL-NAMED: a function `({user, summoner,
 * source, sourceRef, count, spellId, spell}) => boolean` that answers true
 * only when the spell's own rows name this creature. A creature a spell names
 * is exempt from `sourceReadable`, because the GM's client resolves it with
 * the GM's access and the seat never has to open the shelf it sits on; any
 * other creature is held to it as before. A naming that throws is logged and
 * counts as not naming. `source` is null where the seat could not resolve the
 * ref: `sourceRef` is then the ref as the request carries it.
 * @param {Function} fn
 * @returns {() => boolean} unregisters it; true when it was registered
 */
export function registerSummonNaming(fn) {
  if (typeof fn !== "function") throw new TypeError("registerSummonNaming needs a function");
  namings.add(fn);
  return () => namings.delete(fn);
}

/** Does a registered naming say the spell names this creature? A throwing naming is logged and answers no. */
function namedBySpell(req) {
  for (const fn of namings) {
    try {
      if (fn(req) === true) return true;
    } catch (err) {
      console.error(`${MODULE_ID} | a summon naming threw and was treated as not naming`, err);
    }
  }
  return false;
}

/** The first refusal a registered policy gives, or null. A throwing policy is logged and skipped. */
function policyRefusal(req) {
  for (const fn of policies) {
    try {
      const reason = fn(req);
      if (typeof reason === "string" && reason) return reason;
    } catch (err) {
      console.error(`${MODULE_ID} | a summon policy threw and was treated as an allow`, err);
    }
  }
  return null;
}

/** The flag on the GM's world copy of a summoned creature: which source document it was copied from. */
export const SUMMON_COPY_FLAG = "summonCopy";

/**
 * The most creatures one request may place. A bound on what a relayed call
 * may ask the GM's client to create, not a figure from any rule.
 */
export const MAX_SUMMONS = 30;

/** The actor types a summon may be made from (the system's monster and the module's animal). */
export const SUMMON_SOURCE_TYPES = Object.freeze(["monster", `${MODULE_ID}.animal`]);

/** The actor type that may summon. */
export const SUMMONER_TYPE = "character";

/** The ownership level (`CONST.DOCUMENT_OWNERSHIP_LEVELS`) that is OWNER. */
const OWNER_LEVEL = 3;

/** Token display mode NONE (`CONST.TOKEN_DISPLAY_MODES.NONE`): nothing drawn beside the token. */
const DISPLAY_NONE = 0;

/** The character a creature was summoned by, as the actor uuid its flag names, or null. */
export const summonerOf = (actor) => actor?.getFlag?.(MODULE_ID, SUMMON_FLAG) ?? null;

/**
 * The record the module's own summoning stamped on a creature, or null for a
 * creature bound by hand (which has a summoner and no record).
 */
export function summonRecordOf(actor) {
  const record = actor?.getFlag?.(MODULE_ID, SUMMON_RECORD_FLAG);
  return record && typeof record === "object" && record.castId ? record : null;
}

/**
 * The flags a summoned token's delta carries: the summoner and the record.
 * @param {string} summonerUuid
 * @param {{sourceUuid: string, name?: string, spellId?: string, spellName?: string, castId: string, at: number}} record
 *   `spellName` is kept beside `spellId` so a cast reads by the spell's name
 *   after the spell item is gone
 */
export function summonFlags(summonerUuid, { sourceUuid, name = "", spellId = "", spellName = "", castId, at }) {
  const summon = { sourceUuid, name, castId, at };
  if (spellId) {
    summon.spellId = spellId;
    if (spellName) summon.spellName = spellName;
  }
  return { [MODULE_ID]: { [SUMMON_FLAG]: summonerUuid, [SUMMON_RECORD_FLAG]: summon } };
}

/** A cast id as a request may name it: short, alphanumeric. Anything else is the GM's to mint. */
export const validCastId = (id) => typeof id === "string" && /^[A-Za-z0-9]{1,32}$/.test(id);

/**
 * The token data a placement preview is drawn from: the creature's own look
 * (picture, size, shape, disposition) and nothing that acts — no light, sight,
 * flags, bars or name — so a preview shows where the creature will stand and
 * does nothing else. The preview stands on the summoner's own actor, because
 * core's placement refuses a preview the seat does not own and an unlinked
 * token is owned through its actor.
 * @param {object} prototype  the creature's prototype token, as plain data
 * @param {string} summonerActorId  the summoner's actor id
 */
export function previewTokenData(prototype, summonerActorId) {
  const proto = prototype ? JSON.parse(JSON.stringify(prototype)) : {};
  const data = {
    name: String(proto.name ?? ""),
    actorId: summonerActorId,
    actorLink: false,
    hidden: false,
    displayName: DISPLAY_NONE,
    displayBars: DISPLAY_NONE,
    x: 0,
    y: 0,
  };
  for (const key of ["texture", "width", "height", "shape", "alpha", "disposition", "ring"]) {
    if (proto[key] !== undefined) data[key] = proto[key];
  }
  return data;
}

/**
 * The positions a finished placement chose, as the plain records the relay
 * carries. A placement the user cut short yields fewer than were asked for.
 * @param {object[]} documents  the placed preview tokens
 */
export function placedPositions(documents) {
  return Array.from(documents ?? [], (d) => {
    const s = d._source ?? d;
    const out = { x: Number(s.x), y: Number(s.y) };
    if (Number.isFinite(Number(s.elevation))) out.elevation = Number(s.elevation);
    if (Number.isFinite(Number(s.rotation))) out.rotation = Number(s.rotation);
    if (typeof s.level === "string" && s.level) out.level = s.level;
    return out;
  });
}

/**
 * Who owns the summons of a character: every user with OWNER over it other
 * than a GM. Returned as the ownership map a token delta carries.
 * @param {object} ownership  the summoner's `ownership` map (user id → level)
 * @param {Iterable<string>} [also]  user ids to add (the requester)
 * @param {(id: string) => boolean} [isGM]  whether a user id is a GM seat
 */
export function summonOwnership(ownership, also = [], isGM = () => false) {
  const out = {};
  for (const [id, level] of Object.entries(ownership ?? {})) if (id !== "default" && level >= OWNER_LEVEL && !isGM(id)) out[id] = OWNER_LEVEL;
  for (const id of also) if (id && !isGM(id)) out[id] = OWNER_LEVEL;
  return out;
}

/** Is a request's count one the relay will act on? */
export const validCount = (count) => Number.isInteger(count) && count >= 1 && count <= MAX_SUMMONS;

/** Is the point finite, and inside the scene's rectangle when it states one? */
function positionValid(p, rect) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  if (!rect) return true;
  return p.x >= rect.x && p.y >= rect.y && p.x <= rect.x + rect.width && p.y <= rect.y + rect.height;
}

/** Does this user own the document? A GM does. */
const owns = (user, doc) => !!user && (user.isGM || !!doc?.testUserPermission?.(user, "OWNER"));

/** Is the scene one this user can be looking at? */
export function sceneViewable(scene, user) {
  if (!scene || !user) return false;
  return !!(user.isGM || scene.active || user.viewedScene === scene.id || scene.testUserPermission?.(user, "LIMITED"));
}

/**
 * Can this user read the document the creature is copied from? A document in
 * a compendium is read through the pack's own permission.
 */
export function sourceReadable(source, user) {
  if (!source || !user) return false;
  if (user.isGM) return true;
  return !!(source.compendium ?? source).testUserPermission?.(user, "OBSERVER");
}

/**
 * Authorize a request to place summons, in the order a refusal is most
 * informative: the sender must own the summoner before anything else about the
 * request is weighed. Pure over duck-typed documents; the relay and the
 * requesting seat both run it, so a refusal reads the same on either side.
 * @param {object} req
 * @param {object} req.user  the requesting user (`isGM`, `id`, `viewedScene`)
 * @param {object} req.summoner  the character actor
 * @param {object|null} req.source  the creature document to copy; null only where the seat is asking and
 *   could not resolve `sourceRef` (see below)
 * @param {string} [req.sourceRef]  the ref the request names the creature by. Honored only when `source` is
 *   null, `positions` is omitted (the seat's own pre-check) and a registered naming says the summoner's
 *   spell names it: the seat then leaves the creature to the GM's client, which resolves it and runs the
 *   whole check again with a creature in hand
 * @param {object} [req.scene]  the scene to place on
 * @param {number} req.count
 * @param {{x: number, y: number}[]} [req.positions]  omitted when the seat is only asking whether it may
 * @param {string} [req.spellId]  the summoner's spell item the cast is made from; empty is a bare
 *   summoning, which only a seat `bareSummonAllowed` answers true for may make (`spellRequired`)
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function checkPlaceRequest({ user, summoner, source, sourceRef = "", scene = null, count, positions = null, spellId = "" } = {}) {
  if (!user) return { ok: false, reason: "noUser" };
  if (summoner?.type !== SUMMONER_TYPE) return { ok: false, reason: "notSummoner" };
  if (!owns(user, summoner)) return { ok: false, reason: "notOwner" };
  if (!validCount(count)) return { ok: false, reason: "badCount" };
  const spell = spellId ? (summoner.items?.get?.(spellId) ?? null) : null;
  const spellOk = spell?.type === "spell";
  const named = spellOk && namedBySpell({ user, summoner, source: source ?? null, sourceRef: source ? "" : String(sourceRef ?? ""), count, spellId, spell });
  if (source) {
    if (!SUMMON_SOURCE_TYPES.includes(source.type)) return { ok: false, reason: "badSource" };
    if (!named && !sourceReadable(source, user)) return { ok: false, reason: "unreadable" };
  } else if (!(named && sourceRef && !positions)) {
    return { ok: false, reason: "badSource" };
  }
  if (spellId && !spellOk) return { ok: false, reason: "badSpell" };
  if (!spellId && !bareSummonAllowed(user)) return { ok: false, reason: "spellRequired" };
  const refusal = policyRefusal({ user, summoner, source: source ?? null, sourceRef: source ? "" : String(sourceRef ?? ""), count, spellId, spell });
  if (refusal) return { ok: false, reason: refusal };
  if (positions) {
    if (!sceneViewable(scene, user)) return { ok: false, reason: "badScene" };
    const rect = scene.dimensions?.rect ?? null;
    if (!Array.isArray(positions) || positions.length !== count || !positions.every((p) => positionValid(p, rect))) {
      return { ok: false, reason: "badPositions" };
    }
  }
  return { ok: true };
}

/**
 * Authorize a request to dismiss summons: the sender must own the summoner,
 * and only a token the module's own summoning made for THIS summoner goes. A
 * token bound by hand, or summoned by someone else, is refused and left alone.
 * @param {object} req
 * @param {object} req.user
 * @param {object} req.summoner
 * @param {object[]} req.tokens  the token documents named
 * @returns {{ok: false, reason: string}|{ok: true, tokens: object[], refused: number}}
 */
export function checkDismissRequest({ user, summoner, tokens } = {}) {
  if (!user) return { ok: false, reason: "noUser" };
  if (summoner?.type !== SUMMONER_TYPE) return { ok: false, reason: "notSummoner" };
  if (!owns(user, summoner)) return { ok: false, reason: "notOwner" };
  const mine = [];
  let refused = 0;
  for (const t of tokens ?? []) {
    if (t && summonerOf(t.actor) === summoner.uuid && summonRecordOf(t.actor)) mine.push(t);
    else refused++;
  }
  return { ok: true, tokens: mine, refused };
}

/**
 * Group summons by the cast that made them. Entries the module's own
 * summoning did not make (no record) are returned apart as `loose`.
 * @param {{record: object|null}[]} entries  anything carrying a `record`
 * @returns {{casts: {castId: string, name: string, sourceUuid: string, spellId: string, spellName: string, at: number, entries: object[]}[], loose: object[]}}
 */
export function groupByCast(entries) {
  const byId = new Map();
  const loose = [];
  for (const entry of entries ?? []) {
    const r = entry?.record;
    if (!r?.castId) {
      loose.push(entry);
      continue;
    }
    if (!byId.has(r.castId)) {
      byId.set(r.castId, { castId: r.castId, name: String(r.name ?? ""), sourceUuid: String(r.sourceUuid ?? ""), spellId: String(r.spellId ?? ""), spellName: String(r.spellName ?? ""), at: Number(r.at) || 0, entries: [] });
    }
    byId.get(r.castId).entries.push(entry);
  }
  return { casts: [...byId.values()].sort((a, b) => a.at - b.at), loose };
}

/**
 * Group a character's summons by the spell that called them, then by cast.
 * Three destinations, each a different command in the party cell:
 * - `casts`: a record whose `spellId` still resolves to a spell, one entry per
 *   cast (oldest first), carrying the spell's CURRENT name (the record's
 *   `spellName` when the lookup gives none);
 * - `loose`: a record with no spell that resolves (a bare GM summoning, or a
 *   spell since deleted), left as plain entries so a caller can still group
 *   them with `groupByCast` and dismiss them;
 * - `bound`: an entry with no record at all (bound by hand), which only
 *   Release acts on.
 * @param {{record: object|null}[]} entries  anything carrying a `record`
 * @param {Map<string, {name?: string}>|Record<string, {name?: string}>} spellsById  the summoner's spells by item id
 * @returns {{casts: {spellId: string, spellName: string, castId: string, tokens: object[]}[], loose: object[], bound: object[]}}
 */
export function groupBySpell(entries, spellsById) {
  const spellOf = (id) => (typeof spellsById?.get === "function" ? spellsById.get(id) : spellsById?.[id]) ?? null;
  const grouped = groupByCast(entries);
  const out = { casts: [], loose: [], bound: grouped.loose.filter(Boolean) };
  const { casts } = grouped;
  for (const cast of casts) {
    const spell = cast.spellId ? spellOf(cast.spellId) : null;
    if (!spell) {
      out.loose.push(...cast.entries);
      continue;
    }
    out.casts.push({ spellId: cast.spellId, spellName: String(spell.name ?? cast.spellName ?? ""), castId: cast.castId, tokens: cast.entries });
  }
  return out;
}

/** A creature ref as the request carries it: trimmed, a leading `uuid:` dropped. */
export const normalizeRef = (ref) => String(ref ?? "").trim().replace(/^uuid:/u, "");

/**
 * Does a ref read as an id the GM's client can resolve (a document uuid or an
 * importer cookbook id, both dotted and with no space) rather than a printed
 * name? Only an id is worth passing through unresolved.
 */
export const refLooksLikeId = (ref) => /^[^\s.]+(?:\.[^\s.]+)+$/u.test(normalizeRef(ref));

/**
 * The choices a spell's rows put in the creature prompt. Pure: `resolved` is
 * the seat's own answer for each row's ref, parallel to `rows`, a `{uuid,
 * name}` or null where the seat could not resolve it.
 * - a resolved row is offered by its creature's uuid and name;
 * - an unresolved row whose ref reads as an id is offered with the ref passed
 *   through untouched, which the GM's client resolves, labelled by the row's
 *   own imported `name` (blank when it carries none, for the caller to label);
 * - an unresolved row whose ref is neither is dropped.
 * A creature offered twice is offered once.
 * @param {{ref?: string, name?: string, amount?: number}[]} rows
 * @param {({uuid: string, name: string}|null)[]} resolved
 * @returns {{value: string, name: string, amount: number, passed: boolean}[]}
 */
export function offerRows(rows, resolved) {
  const out = [];
  (rows ?? []).forEach((row, i) => {
    const ref = String(row?.ref ?? "").trim();
    if (!ref) return;
    const doc = resolved?.[i] ?? null;
    const amount = Number(row.amount) || 0;
    let offer = null;
    if (doc?.uuid) offer = { value: doc.uuid, name: String(doc.name ?? ""), amount, passed: false };
    else if (refLooksLikeId(ref)) offer = { value: ref, name: String(row.name ?? "").trim(), amount, passed: true };
    if (offer && !out.some((o) => o.value === offer.value)) out.push(offer);
  });
  return out;
}

/**
 * The creatures a pack's index offers as a summon, by name. An index row is
 * `{uuid, name, type}`; a row of another type is not a creature to summon.
 * @param {Iterable<{uuid: string, name: string, type: string}>} index
 * @returns {{uuid: string, name: string}[]}
 */
export function summonEntries(index) {
  return [...(index ?? [])]
    .filter((row) => row?.uuid && SUMMON_SOURCE_TYPES.includes(row.type))
    .map((row) => ({ uuid: row.uuid, name: String(row.name ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
