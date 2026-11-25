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
import { CONTROL_ENDS } from "./magic-vocab.mjs";

/** The actor flag naming the character a creature was summoned by (an actor uuid). */
export const SUMMON_FLAG = "summonedBy";

/** The actor flag the module's own summoning writes: `{sourceUuid, name, spellId, spellName, castId, at}`. */
export const SUMMON_RECORD_FLAG = "summon";

/**
 * The one switch that decides whether a summoning may name no spell. A request
 * whose summoner names a spell is never held to it; a request that names none
 * is refused `spellRequired` for a seat this answers false for. Every gate that
 * depends on the answer (the relay's check, the seat's own pre-check, the
 * bare Summon… prompt) reads it here and nowhere else. The answer is Foundry's
 * own grant of token creation (`User#can("TOKEN_CREATE")`), which a GM holds
 * by role and a Player holds only where the world's permission table or the
 * user's own grant says so; no role is read here.
 * @param {{can?: (permission: string) => boolean}|null} user
 * @returns {boolean} true for a user Foundry grants token creation
 */
export const bareSummonAllowed = (user) => user?.can?.("TOKEN_CREATE") === true;

/** The registered policies, in registration order. */
const policies = new Set();

/**
 * Register a refusal policy a feature adds to `checkPlaceRequest` without lib
 * importing the feature. A policy is `({user, summoner, source,
 * count, spellId, spell, cast, positions, scene}) => string|null`: `cast` is
 * the request's `{castId, casterLevel, invocationLevel}` (a level the seat did
 * not state is null), `positions` the places chosen and `scene` the scene they
 * are on, the last two null wherever no place is chosen: the seat's own pre-check
 * and a join into a party, on the GM's client too. null (or anything that is not a
 * non-empty string) allows, a string is the refusal's reason id. It runs after
 * every built-in check, on the requesting seat and on the GM's client alike,
 * so it must answer from documents both can read, and synchronously: a
 * promise is not a string and allows. `source` is always the creature
 * document the request copies from. A policy that throws is logged and counts as an allow:
 * a broken feature never locks the summoner out.
 * @param {Function} fn
 * @returns {() => boolean} unregisters it; true when it was registered
 */
export function registerSummonPolicy(fn) {
  if (typeof fn !== "function") throw new TypeError("registerSummonPolicy needs a function");
  policies.add(fn);
  return () => policies.delete(fn);
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
 * The summoner and the record a summoned token's plain data carries, the same
 * two facts `summonerOf` and `summonRecordOf` read off a live actor. A stash a
 * party keeps for a summon is token data (`toObject()`), so the reader has no
 * actor to ask: the flags of an unlinked token live in its `delta`. A linked
 * token, a token that matches its actor (`delta: null`) and anything that is
 * not an object read as neither, and a record with no `castId` is no record,
 * as in `summonRecordOf`.
 * @param {object|null} tokenData  a token's plain data
 * @returns {{summonedBy: string|null, summon: object|null}}
 */
export function summonOfData(tokenData) {
  const flags = tokenData && typeof tokenData === "object" && !tokenData.actorLink ? tokenData.delta?.flags?.[MODULE_ID] : null;
  const by = flags?.[SUMMON_FLAG];
  const record = flags?.[SUMMON_RECORD_FLAG];
  return {
    summonedBy: typeof by === "string" && by ? by : null,
    summon: record && typeof record === "object" && record.castId ? record : null,
  };
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
 * flags, bars or name. The preview stands on the summoner's own actor, since
 * core's placement refuses a preview the seat does not own.
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

/**
 * The inverse of `summonOwnership`: the user ids a summons' delta stops naming
 * when its control ends, every entry but the map's `default`. The caller sets
 * each to NONE: an update merges objects, so an empty map would remove
 * nothing, and a forced deletion cannot lower a level the world copy grants.
 * @param {object} ownership  a summons' token delta `ownership` map
 * @returns {string[]} user ids
 */
export const ownershipDrop = (ownership) => Object.keys(ownership ?? {}).filter((id) => id !== "default");

/** The token disposition a summons turns to when it turns hostile (`CONST.TOKEN_DISPOSITIONS.HOSTILE`). */
export const HOSTILE_DISPOSITION = -1;

/**
 * The outcome a row's `controlEnd` names: a member of `CONTROL_ENDS`, else
 * `stays`. A blank key, an unknown word and a summons with no row all read as
 * the creatures staying.
 * @param {*} value
 * @returns {"stays"|"gone"|"hostile"}
 */
export const controlEndOf = (value) => (Object.hasOwn(CONTROL_ENDS, value) ? value : "stays");

/**
 * What ending a cast's control does, creature by creature, as a list of steps
 * the GM's client carries out. Every step carries `lost`, the outcome every
 * creature is stamped with (a non-GM's dismissal is refused on a `hostile` one).
 * The creatures are the ones the caller read off the cast's own records, and
 * nothing here names a creature by anything else.
 * - `stays`: each token is stamped (`op: "stamp"`);
 * - `gone`: a token is deleted (`op: "delete"`), or released through the roster
 *   where it is a deployed party member (`op: "release"`), and a stashed
 *   creature is released; with no `release` to call, a stashed creature is
 *   `unapplied`;
 * - `hostile`: a token drops its owners (`drop`) and turns to
 *   `HOSTILE_DISPOSITION` (`op: "hostile"`); a stashed creature is amended
 *   through the roster (`stashAfterControlEnd`) and takes the same op, with
 *   nothing more on its step, since the stash is rewritten whole.
 * A stashed creature that stays takes `op: "stamp"` the same way. With no
 * `amend` to call, a stashed creature that stays or turns hostile is
 * `unapplied`.
 * @param {object} o
 * @param {string} o.outcome  a `CONTROL_ENDS` key, anything else reads `stays`
 * @param {{uuid: string, ownership?: object, member?: {partyId: string, actorId: string}|null}[]} [o.tokens]  the cast's scene tokens, `member` set where the roster answers for the token
 * @param {{partyId: string, actorId: string}[]} [o.held]  the cast's stashed creatures
 * @param {boolean} [o.canRelease]  whether the roster service has a `release`
 * @param {boolean} [o.canAmend]  whether the roster service has an `amendSummons`
 * @returns {{outcome: string, steps: object[]}}
 */
export function controlEndPlan({ outcome, tokens = [], held = [], canRelease = true, canAmend = true } = {}) {
  const end = controlEndOf(outcome);
  const steps = [];
  for (const t of tokens) {
    const step = { kind: "token", uuid: t.uuid, lost: end };
    if (end === "gone") {
      if (t.member?.partyId && t.member.actorId) steps.push({ ...step, op: "release", partyId: t.member.partyId, actorId: t.member.actorId });
      else steps.push({ ...step, op: "delete" });
    } else if (end === "hostile") steps.push({ ...step, op: "hostile", drop: ownershipDrop(t.ownership), disposition: HOSTILE_DISPOSITION });
    else steps.push({ ...step, op: "stamp" });
  }
  for (const h of held) {
    const step = { kind: "held", partyId: h.partyId, actorId: h.actorId, lost: end };
    if (end === "gone") steps.push({ ...step, op: canRelease ? "release" : "unapplied" });
    else steps.push({ ...step, op: canAmend ? (end === "hostile" ? "hostile" : "stamp") : "unapplied" });
  }
  return { outcome: end, steps };
}

/**
 * A stashed summon's token data after its control ends: a copy carrying the
 * `lost` stamp in its summon record, and, for `hostile`, every owner but the
 * map's `default` set to NONE and the disposition turned to
 * `HOSTILE_DISPOSITION`, which is what the deployed token's write does. Pure:
 * the argument is never mutated. Null for data that carries no summon record
 * (`summonOfData`) and for an outcome that is neither `stays` nor `hostile`,
 * so an edit built on it writes nothing there.
 * @param {object} data  a party stash's token data
 * @param {"stays"|"hostile"} end
 * @returns {object|null}
 */
export function stashAfterControlEnd(data, end) {
  if ((end !== "stays" && end !== "hostile") || !summonOfData(data).summon) return null;
  const out = JSON.parse(JSON.stringify(data));
  out.delta.flags[MODULE_ID][SUMMON_RECORD_FLAG].lost = end;
  if (end === "hostile") {
    for (const id of ownershipDrop(out.delta.ownership)) out.delta.ownership[id] = 0;
    out.disposition = HOSTILE_DISPOSITION;
  }
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
 * @param {object|null} req.source  the creature document to copy; none is `badSource`, and so is a document of
 *   another type. The requesting user must observe it (`unreadable`), a Judge always does; a spell naming the
 *   creature grants nothing
 * @param {object} [req.scene]  the scene to place on
 * @param {number} req.count
 * @param {{x: number, y: number}[]} [req.positions]  omitted where no place is chosen: the seat only asking whether it may, and a join into a party
 * @param {string} [req.spellId]  the summoner's spell item the cast is made from; empty is a bare
 *   summoning, which only a seat `bareSummonAllowed` answers true for may make (`spellRequired`)
 * @param {{castId?: string, casterLevel?: number, invocationLevel?: number}|null} [req.cast]  the cast the
 *   request belongs to, handed to every policy as it stands (levels not finite numbers read null)
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function checkPlaceRequest({ user, summoner, source, scene = null, count, positions = null, spellId = "", cast = null } = {}) {
  if (!user) return { ok: false, reason: "noUser" };
  if (summoner?.type !== SUMMONER_TYPE) return { ok: false, reason: "notSummoner" };
  if (!owns(user, summoner)) return { ok: false, reason: "notOwner" };
  if (!validCount(count)) return { ok: false, reason: "badCount" };
  const spell = spellId ? (summoner.items?.get?.(spellId) ?? null) : null;
  const spellOk = spell?.type === "spell";
  if (!source || !SUMMON_SOURCE_TYPES.includes(source.type)) return { ok: false, reason: "badSource" };
  if (!sourceReadable(source, user)) return { ok: false, reason: "unreadable" };
  if (spellId && !spellOk) return { ok: false, reason: "badSpell" };
  if (!spellId && !bareSummonAllowed(user)) return { ok: false, reason: "spellRequired" };
  if (positions) {
    if (!sceneViewable(scene, user)) return { ok: false, reason: "badScene" };
    const rect = scene.dimensions?.rect ?? null;
    if (!Array.isArray(positions) || positions.length !== count || !positions.every((p) => positionValid(p, rect))) {
      return { ok: false, reason: "badPositions" };
    }
  }
  const refusal = policyRefusal({
    user,
    summoner,
    source,
    count,
    spellId,
    spell,
    cast: cast ? { castId: cast.castId ?? null, casterLevel: finiteOrNull(cast.casterLevel), invocationLevel: finiteOrNull(cast.invocationLevel) } : null,
    positions: positions ?? null,
    scene: positions ? scene : null,
  });
  if (refusal) return { ok: false, reason: refusal };
  return { ok: true };
}

/** A figure as a request may carry it: a finite number, else null. */
const finiteOrNull = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/**
 * The cast a placement request belongs to, as the GM's client reads it: the
 * cast id only when well formed (else the caller's `fallbackId`), and the two
 * levels the seat stated only when finite numbers. The levels are the seat's
 * word; nothing here can recompute a level a hand set.
 * @param {{castId?: string, casterLevel?: number, invocationLevel?: number}|null} cast
 * @param {string} fallbackId  the id minted where the request names none that is well formed
 * @returns {{castId: string, casterLevel: number|null, invocationLevel: number|null}}
 */
export function normalizeCast(cast, fallbackId) {
  return {
    castId: validCastId(cast?.castId) ? cast.castId : fallbackId,
    casterLevel: finiteOrNull(cast?.casterLevel),
    invocationLevel: finiteOrNull(cast?.invocationLevel),
  };
}

/** The farthest the measure may exceed a range before a point is out: a float's slack, not a rule's figure. */
const RANGE_SLACK = 1e-6;

/**
 * The range a request states, as a limit in feet: a finite non-negative number,
 * else null. `null`, a blank, a string and a non-finite figure all state none,
 * and a range that states none is not measured.
 * @param {*} rangeFeet
 * @returns {number|null}
 */
export const rangeLimitOf = (rangeFeet) => (typeof rangeFeet === "number" && Number.isFinite(rangeFeet) && rangeFeet >= 0 ? rangeFeet : null);

/**
 * Hold a set of places to the range a cast states: each place is measured from
 * the centre of the caster's token, as it was stored and with no creature size
 * added, and one beyond `rangeFeet` refuses the placement. A `calling` (the
 * creature is called from where it already is, so the place is not the
 * caster's to bound) and a range that states none are exempt, and so is a
 * place the grid cannot measure.
 * @param {object} o
 * @param {{x: number, y: number}[]} o.positions
 * @param {{x: number, y: number}|null} o.from  the centre of the caster's token, null where none is on the scene
 * @param {number|null} o.rangeFeet
 * @param {boolean} [o.calling]
 * @param {(from: object, to: object) => number|null} o.measure  feet between two points, null where unmeasurable
 * @returns {{ok: true}|{ok: false, reason: "noCaster"|"outOfRange"}}
 */
export function checkPlacementRange({ positions, from, rangeFeet, calling = false, measure }) {
  const limit = rangeLimitOf(rangeFeet);
  if (calling === true || limit === null) return { ok: true };
  if (!from) return { ok: false, reason: "noCaster" };
  for (const point of positions ?? []) {
    const gap = measure(from, point);
    if (gap !== null && gap !== undefined && gap > limit + RANGE_SLACK) return { ok: false, reason: "outOfRange" };
  }
  return { ok: true };
}

/**
 * Does a summon named by its two facts belong to this summoner by the module's
 * own summoning? The one test both a token and a held member are held to.
 */
const madeFor = (summoner, summonedBy, record) => !!summonedBy && summonedBy === summoner.uuid && !!record;

/**
 * Authorize a request to dismiss summons: the sender must own the summoner,
 * and only a summon the module's own summoning made for THIS summoner goes. A
 * token bound by hand, or summoned by someone else, is refused and left alone.
 * A summon riding in a party token is named by its roster row (`held`:
 * `{partyId, actorId, summonedBy, summon}`, read from the `party-roster`
 * service, never from the request) and is held to the same test. A creature
 * whose control ended and left it hostile (its record carries `lost:
 * "hostile"`, `controlEndPlan`) is a Judge's to dismiss: a seat that is no GM
 * and names only such creatures is refused `controlLost`, and one that names
 * others too has those left out and counted refused. A creature that stayed
 * is dismissed like any other.
 * @param {object} req
 * @param {object} req.user
 * @param {object} req.summoner
 * @param {object[]} [req.tokens]  the token documents named
 * @param {object[]} [req.held]  the roster rows of the held summons named
 * @returns {{ok: false, reason: string}|{ok: true, tokens: object[], held: object[], refused: number}}
 */
export function checkDismissRequest({ user, summoner, tokens, held } = {}) {
  if (!user) return { ok: false, reason: "noUser" };
  if (summoner?.type !== SUMMONER_TYPE) return { ok: false, reason: "notSummoner" };
  if (!owns(user, summoner)) return { ok: false, reason: "notOwner" };
  const mine = [];
  const mineHeld = [];
  let refused = 0;
  let lost = 0;
  for (const t of tokens ?? []) {
    if (!t || !madeFor(summoner, summonerOf(t.actor), summonRecordOf(t.actor))) refused++;
    else if (summonRecordOf(t.actor).lost === "hostile" && !user.isGM) lost++;
    else mine.push(t);
  }
  for (const row of held ?? []) {
    if (!row || !madeFor(summoner, row.summonedBy, row.summon?.castId ? row.summon : null)) refused++;
    else if (row.summon.lost === "hostile" && !user.isGM) lost++;
    else mineHeld.push(row);
  }
  if (lost && !mine.length && !mineHeld.length) return { ok: false, reason: "controlLost" };
  return { ok: true, tokens: mine, held: mineHeld, refused: refused + lost };
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
 * The name of the creature a summon row's ref names, read synchronously with
 * the lookups passed in: the document (or compendium index entry) its uuid
 * names, else the library creature carrying it as an importer cookbook id.
 * Null where neither answers, or where the uuid names something that is not
 * an Actor; a lookup that throws counts as no answer.
 * @param {string} ref
 * @param {{fromUuidSync: (uuid: string) => object|null, byCookbookId: (type: string, id: string) => object|null}} lookups
 * @returns {string|null}
 */
export function summonRefName(ref, { fromUuidSync, byCookbookId }) {
  const key = normalizeRef(ref);
  if (!key) return null;
  let doc = null;
  try {
    doc = fromUuidSync?.(key) ?? null;
  } catch {
    doc = null;
  }
  if (doc && (doc.documentName ?? "Actor") !== "Actor") doc = null;
  if (!doc) {
    try {
      doc = byCookbookId?.("Actor", key) ?? null;
    } catch {
      doc = null;
    }
  }
  const name = String(doc?.name ?? "").trim();
  return name || null;
}

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
 *   through untouched, which the placement resolves and weighs against the
 *   requesting user's own level on it, labelled by the row's
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

/** The compendium id a compendium document's uuid names (`Compendium.<scope>.<pack>.…`), or null for any other uuid. */
export const packIdOfUuid = (uuid) => /^Compendium\.([^.]+\.[^.]+)\./u.exec(String(uuid ?? ""))?.[1] ?? null;

/**
 * Can this user open the creature? The test is Foundry's own and the one the
 * cast applies (`sourceReadable`): OBSERVER or better on the document, or on its
 * compendium where it is a pack document. A GM always can, whatever is handed in.
 * A compendium INDEX ENTRY carries a uuid and no permission test, so its pack is
 * read from the uuid (`packOf`, which the caller binds to the world's pack
 * registry) and the user's level on the pack answers. A missing document, or an
 * index entry with no `packOf`, opens for nobody but a GM.
 * @param {object|null} doc  a document, or an index entry `{uuid, …}`
 * @param {object} user  `{isGM, …}` with whatever Foundry's `testUserPermission` reads
 * @param {object} [o]
 * @param {(uuid: string) => object|null} [o.packOf]  the compendium a uuid is in, as a pack with `testUserPermission`
 * @returns {boolean}
 */
export function creatureOpens(doc, user, { packOf = () => null } = {}) {
  if (!user) return false;
  if (user.isGM) return true;
  if (!doc) return false;
  if (doc.compendium || typeof doc.testUserPermission === "function") return sourceReadable(doc, user);
  return !!packOf(doc.uuid)?.testUserPermission?.(user, "OBSERVER");
}

/**
 * What a seat reads for a creature: its name where the seat can open it, else
 * the neutral label.
 * @param {{name: string, opens: boolean, neutral: string}} o
 * @returns {string}
 */
export const seatLabel = ({ name, opens, neutral }) => (opens ? name : neutral);
