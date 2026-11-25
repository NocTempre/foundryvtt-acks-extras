/* global game, ui, foundry, canvas, CONST, Actor, Folder, fromUuid, Hooks */
/**
 * Player summons — the Foundry half. A character's owner summons creatures
 * from the monster library onto the scene they are looking at; each one is an
 * UNLINKED token of a world copy of the creature, owned through its own delta
 * by the summoner's owners and by nobody else, and carrying the summoner's
 * uuid and a record of its cast in that delta (`summons-logic.mjs`).
 *
 * Only the GM's client creates documents. The seat picks the creature and
 * clicks the places through core's placement (`placeTokens` with
 * `create: false`, so nothing is made), then sends the positions to the GM's
 * client, which authorizes the request, finds or makes the ONE world copy of
 * that creature (in a folder a player cannot open, owned by nobody but the
 * GM), creates the tokens and answers with their uuids. A dismissal runs the
 * same way: the seat confirms, the GM deletes the tokens the module made for
 * that summoner and no others. The world copy stays.
 *
 * A summon may also ride in its summoner's party token. It is then no scene
 * token but a member record the `party-roster` service (docs/lib/API.md) hands
 * over, and lib reaches it through that service alone, with every call
 * optional: where the provider lacks a method, a summon is the scene token it
 * always was. A caster who marches inside a party token may make the creatures
 * as members of that party at once (`joinSummons`): the GM's client stashes
 * each as the token it would have been and the service stores them, so no
 * token stands on any scene. A deployed party member's token is deleted through the
 * service's `release`, which drops the member record first, so a recall has
 * nothing to restore it from.
 *
 * A summoning is tied to the spell that calls it: a request names the
 * summoner's spell item, and only a seat `bareSummonAllowed` answers true for
 * may name none. Feature rules over a spell's creature and count arrive as
 * policies (`registerSummonPolicy`); this file imports none. The GM's client
 * resolves the creature's document, and the REQUESTING user's level on it is
 * what the check tests there (`sourceReadable`): a seat summons exactly what
 * Foundry lets it observe, and a spell row naming a creature grants nothing.
 */
import { MODULE_ID, LANG_PREFIX, SUMMONS_PLACED_HOOK, TEMPLATE_TYPE } from "./constants.mjs";
import { docOf, makeLoc } from "./util.mjs";
import { centreOfToken, pointGapFeet } from "./distance-units.mjs";
import * as services from "./services.mjs";
import { libraryPacks, byCookbookId, whenReady } from "./library.mjs";
import {
  SUMMON_COPY_FLAG,
  SUMMON_RECORD_FLAG,
  MAX_SUMMONS,
  controlEndPlan,
  summonerOf,
  summonRecordOf,
  summonFlags,
  summonOwnership,
  validCastId,
  previewTokenData,
  placedPositions,
  checkPlaceRequest,
  checkDismissRequest,
  stashAfterControlEnd,
  summonEntries,
  bareSummonAllowed,
  registerSummonPolicy,
  normalizeRef,
  offerRows,
  normalizeCast,
  checkPlacementRange,
  rangeLimitOf,
  sourceReadable,
} from "./summons-logic.mjs";

export { summonerOf, registerSummonPolicy };

const libLoc = makeLoc(LANG_PREFIX);

/** The `party-roster` service, or null where no feature provides one. */
const roster = () => services.get("party-roster");

/** A string of this file's lang group, under the lib root. */
const loc = (key, data) => libLoc(`summons.${key}`, data);

/** The socket handler the GM's client answers. */
const SUMMON_HANDLER = "summonRelay";

/** The flag stamped on the Actor folder the world copies are filed in. */
const SUMMON_FOLDER_FLAG = "summonFolder";

/** The most tokens a dismissal request may name. */
const MAX_DISMISS = 200;

/** The socket transport, loaded when a call needs it so this file evaluates without a Foundry session. */
const transport = () => import("./sockets.mjs");

/** The scene the seat summons on: the one on the canvas, else the world's active one. */
const sceneNow = () => canvas?.scene ?? game.scenes?.active ?? null;

/* -------------------------------------------- */
/*  Reads                                        */
/* -------------------------------------------- */

/**
 * The tokens on a scene whose creature names this character as its summoner.
 * @param {Actor} summoner
 * @param {{scene?: Scene}} [o]  the scene to read; omitted, the one on the canvas
 * @returns {TokenDocument[]}
 */
export function summonsOf(summoner, { scene = sceneNow() } = {}) {
  if (!summoner?.uuid) return [];
  return [...(scene?.tokens ?? [])].filter((t) => summonerOf(t.actor) === summoner.uuid);
}

/**
 * @typedef {object} HeldSummon
 * A summon riding in its summoner's party token, as its roster row names it.
 * @property {string} partyId  the party holding it
 * @property {string} partyName  that party's name, as the roster lists it
 * @property {string} actorId  the member's id in that party (the roster row's `actorId`)
 * @property {string} name
 * @property {string|null} img
 * @property {object} record  the cast record (`summonRecordOf`'s shape)
 */

/**
 * The summons of this character riding stashed in a party token, across every
 * party the `party-roster` service lists. A summon deployed with its party is
 * a scene token and is read by `summonsOf`, never listed here, so no summon is
 * counted twice. Empty where there is no provider or the provider's rows carry
 * no summon fields.
 * @param {Actor} summoner
 * @returns {HeldSummon[]}
 */
export function heldSummonsOf(summoner) {
  const service = roster();
  if (!summoner?.uuid || typeof service?.list !== "function" || typeof service.members !== "function") return [];
  const out = [];
  for (const party of service.list() ?? []) {
    for (const row of service.members(party.id) ?? []) {
      if (!row?.stashed || row.summonedBy !== summoner.uuid || !row.summon?.castId) continue;
      out.push({ partyId: party.id, partyName: String(party.name ?? ""), actorId: row.actorId, name: String(row.name ?? ""), img: row.actor?.img ?? null, record: row.summon });
    }
  }
  return out;
}

/**
 * The party this caster marches inside, where their summoning may be made as
 * members of it (`party-roster` `summonerParty`): null where the caster has no
 * such party, the party is in a fight, or no provider answers.
 * @param {Actor} summoner
 * @returns {{id: string, name: string, sceneId: string, tokenId: string}|null}
 */
export function joiningParty(summoner) {
  const service = roster();
  if (!summoner?.id || typeof service?.summonerParty !== "function") return null;
  return service.summonerParty(summoner.id) ?? null;
}

/**
 * What one cast of this character left standing: its scene tokens (deployed
 * party members among them) and the summons riding stashed in a party token.
 * @param {Actor} caster
 * @param {string} castId
 * @param {{scenes?: Iterable<Scene>}} [o]  the scenes to read; omitted, every scene of the world
 * @returns {{tokens: TokenDocument[], held: HeldSummon[]}}
 */
export function castSummons(caster, castId, { scenes = game.scenes } = {}) {
  const tokens = [];
  if (caster?.uuid && castId) {
    for (const scene of scenes ?? []) {
      for (const t of scene?.tokens ?? []) if (summonerOf(t.actor) === caster.uuid && summonRecordOf(t.actor)?.castId === castId) tokens.push(t);
    }
  }
  return { tokens, held: heldSummonsOf(caster).filter((h) => h.record.castId === castId) };
}

/**
 * The creatures this seat may summon, by pack: the module's imported Actor
 * shelves and the system's Actor compendia, each as far as the seat can open
 * the pack. Read off the pack indexes, so nothing is loaded to list it.
 * @returns {{label: string, entries: {uuid: string, name: string}[]}[]}
 */
export function summonShelves() {
  const system = (game.packs ?? []).filter((p) => p.documentName === "Actor" && p.metadata?.packageType === "system");
  const seen = new Set();
  const shelves = [];
  for (const pack of [...libraryPacks("Actor"), ...system]) {
    if (seen.has(pack.collection) || !pack.visible) continue;
    seen.add(pack.collection);
    const entries = summonEntries(pack.index.values());
    if (entries.length) shelves.push({ label: pack.metadata.label, entries });
  }
  return shelves;
}

/* -------------------------------------------- */
/*  The GM's half                                */
/* -------------------------------------------- */

/** One copy per source at a time: a second request for the same creature waits for the first. */
const copying = new Map();

/** The Actor folder the world copies are filed in: found by its stamp, else made. */
async function summonFolder() {
  const stamped = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, SUMMON_FOLDER_FLAG));
  if (stamped) return stamped;
  return Folder.create({ name: loc("folder"), type: "Actor", flags: { [MODULE_ID]: { [SUMMON_FOLDER_FLAG]: true } } }).catch(() => null);
}

/**
 * Make the world actor a summoned token needs, from the library's creature:
 * its stat block and embedded items, owned by nobody but the GM, with its
 * token unlinked. It sheds the library's own marks, so removing the imports
 * never takes it, and the pack's folder, which names nothing in the world.
 */
async function createCopy(source) {
  const data = source.toObject();
  for (const key of ["_id", "folder", "sort", "_stats", "ownership"]) delete data[key];
  if (data.flags?.[MODULE_ID]) {
    delete data.flags[MODULE_ID].cookbook;
    delete data.flags[MODULE_ID].templatePart;
  }
  const folder = await summonFolder();
  return Actor.create(
    foundry.utils.mergeObject(
      data,
      {
        folder: folder?.id ?? null,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        prototypeToken: { actorLink: false },
        flags: { [MODULE_ID]: { [SUMMON_COPY_FLAG]: { sourceUuid: source.uuid } } },
      },
      { inplace: false },
    ),
  );
}

/** The world copy of a source creature: the one already made, or a new one. */
function worldCopy(source) {
  const key = source.uuid;
  const found = game.actors.find((a) => a.getFlag(MODULE_ID, SUMMON_COPY_FLAG)?.sourceUuid === key);
  if (found) return Promise.resolve(found);
  if (!copying.has(key)) copying.set(key, createCopy(source).finally(() => copying.delete(key)));
  return copying.get(key);
}

/** Refusal in the shape every answer takes. */
const refused = (reason) => ({ ok: false, reason });

/**
 * Create the tokens of one summoning, one after another so each is numbered
 * against the ones already placed.
 * @returns {Promise<string[]>} the created tokens' uuids
 */
async function createTokens({ copy, scene, positions, flags, ownership }) {
  const uuids = [];
  for (const p of positions) {
    const place = { x: p.x, y: p.y, actorLink: false, hidden: false, delta: { ownership, flags } };
    for (const key of ["elevation", "rotation", "level"]) if (p[key] !== undefined) place[key] = p[key];
    const doc = await copy.getTokenDocument(place, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    const [made] = await scene.createEmbeddedDocuments("Token", [data]);
    if (made) uuids.push(made.uuid);
  }
  return uuids;
}

/**
 * The flags and the ownership every token or stash of one summoning carries in
 * its delta, the one place both are decided. The spell's name is read here,
 * from the summoner's own item, never taken from the payload; the owners are
 * the summoner's own non-GM owners and the requester.
 * @returns {{flags: object, ownership: object}}
 */
function summonStamps({ summoner, source, spellId, cast, user }) {
  const spellName = spellId ? (summoner.items.get(spellId)?.name ?? "") : "";
  return {
    flags: summonFlags(summoner.uuid, { sourceUuid: source.uuid, name: source.name, spellId, spellName, castId: cast.castId, at: game.time.worldTime }),
    ownership: summonOwnership(summoner.ownership, [user.id], (id) => !!game.users.get(id)?.isGM),
  };
}

/**
 * The stash of each creature a summoning makes inside a party token: plain
 * token data, built as the token it would have been and standing where the
 * party token stands, with its id dropped. A monster of a world that rolls its
 * summoned monsters' hit points gets its own roll in its delta, as core gives
 * a token it creates.
 * @param {object} o
 * @param {Actor} o.copy  the summon's world copy
 * @param {Scene} o.scene  the party token's scene
 * @param {TokenDocument} o.at  the party token, whose place the stashes take
 * @returns {Promise<object[]>}
 */
async function stashTokens({ copy, scene, at, count, flags, ownership }) {
  const rolling = copy.type === "monster" && !!game.settings.get("acks", "autoRollMonsterHP");
  const stashes = [];
  for (let i = 0; i < count; i++) {
    const place = { x: at.x, y: at.y, actorLink: false, hidden: false, delta: { ownership, flags } };
    for (const key of ["elevation", "level"]) if (at[key] !== undefined) place[key] = at[key];
    const doc = await copy.getTokenDocument(place, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    if (rolling) {
      const roll = await copy.rollHP(false);
      data.delta ??= {};
      data.delta.system = { ...data.delta.system, hp: { ...data.delta.system?.hp, max: roll.total, value: roll.total } };
    }
    stashes.push(data);
  }
  return stashes;
}

/**
 * The creature document a request names: the document its uuid names, else,
 * for a request that names a spell, the library creature carrying that importer
 * cookbook id. A bare request names a document or nothing, so it never reaches
 * the library by an id the seat typed. A ref no lookup answers is null, never a
 * throw. The lookup runs on the seat and on the GM's client alike; who may
 * observe the document is `checkPlaceRequest`'s question, asked of the
 * requesting user. Where several documents carry the id, the one `user`
 * observes is taken, so a world actor a Judge dragged out of an open shelf
 * does not stand in front of the shelf's own for a Player.
 */
async function resolveSource(ref, spellId, user) {
  const key = normalizeRef(ref);
  if (!key) return null;
  try {
    const doc = await fromUuid(key);
    if (doc) return doc;
  } catch {
    // an id that is no uuid: the library lookup below answers for it
  }
  if (!spellId) return null;
  await whenReady();
  return byCookbookId("Actor", key, { prefer: (doc) => sourceReadable(doc, user) });
}

/**
 * The centre of the caster's token on the scene, for the range a placement is
 * measured from: the token the request names, only when it stands on this
 * scene as the summoner's own. Null otherwise.
 */
function casterCentre(scene, tokenId, summoner) {
  const token = tokenId ? scene?.tokens?.get?.(tokenId) : null;
  if (!token || !(token.actorId === summoner.id || token.actor?.uuid === summoner.uuid)) return null;
  return centreOfToken(token);
}

/**
 * Place summons: authorize, hold the places to the cast's range, find or make
 * the copy, create the tokens. The range and the cast's levels are the seat's
 * word, as the apply relay takes a level; a Judge's request is not held to the
 * range, as the seat's own gate only warns a Judge.
 */
async function placeOp({ summonerUuid, sourceUuid, sceneId, positions, count, spellId = "", castId = "", cast: stated = null, casterTokenId = "", rangeFeet = null, calling = false, user }) {
  const summoner = await fromUuid(summonerUuid);
  const source = await resolveSource(sourceUuid, spellId, user);
  const scene = game.scenes.get(sceneId);
  const cast = normalizeCast({ ...stated, castId: stated?.castId ?? castId }, foundry.utils.randomID());
  const verdict = checkPlaceRequest({ user, summoner, source, scene, count, positions, spellId, cast });
  if (!verdict.ok) return refused(verdict.reason);
  if (!user.isGM) {
    const range = checkPlacementRange({
      positions,
      from: casterCentre(scene, casterTokenId, summoner),
      rangeFeet,
      calling,
      measure: (a, b) => pointGapFeet(scene, a, b),
    });
    if (!range.ok) return refused(range.reason);
  }
  const copy = await worldCopy(source);
  if (!copy) return refused("noCopy");
  const { flags, ownership } = summonStamps({ summoner, source, spellId, cast, user });
  const tokenUuids = await createTokens({ copy, scene, positions, flags, ownership });
  if (tokenUuids.length) {
    Hooks.callAll(SUMMONS_PLACED_HOOK, { summonerUuid: summoner.uuid, sceneId: scene.id, tokenIds: tokenUuids.map((uuid) => uuid.split(".").pop()) });
  }
  return { ok: true, castId: cast.castId, tokenUuids };
}

/**
 * Make summoned creatures members of the party their caster marches inside:
 * authorize as a placement is, with no places to hold, then stash each creature
 * as the token it would have been, in the party token's own place, and hand the
 * stashes to the roster, which stores them as members. No token is made on any
 * scene and no `SUMMONS_PLACED_HOOK` fires, since a stash is no arrival to
 * gather. The range does not apply: nothing is placed on the map.
 */
async function joinOp({ summonerUuid, sourceUuid, count, spellId = "", castId = "", cast: stated = null, user }) {
  const summoner = await fromUuid(summonerUuid);
  const source = await resolveSource(sourceUuid, spellId, user);
  const cast = normalizeCast({ ...stated, castId: stated?.castId ?? castId }, foundry.utils.randomID());
  const verdict = checkPlaceRequest({ user, summoner, source, count, spellId, cast });
  if (!verdict.ok) return refused(verdict.reason);
  const party = joiningParty(summoner);
  const scene = party ? game.scenes.get(party.sceneId) : null;
  const partyToken = scene?.tokens?.get?.(party.tokenId) ?? null;
  if (!partyToken || typeof roster()?.admitSummons !== "function") return refused("noParty");
  const copy = await worldCopy(source);
  if (!copy) return refused("noCopy");
  const { flags, ownership } = summonStamps({ summoner, source, spellId, cast, user });
  const stashes = await stashTokens({ copy, scene, at: partyToken, count, flags, ownership });
  const admitted = await roster().admitSummons(party.id, summoner.uuid, stashes);
  if (!admitted?.actorIds?.length) return refused("noParty");
  return { ok: true, castId: cast.castId, joined: admitted.actorIds, party: { id: party.id, name: party.name } };
}

/**
 * The roster rows a request's held summons name, read from the `party-roster`
 * service and never from the request: an id the service does not answer for
 * comes back with no summon, which the dismissal check refuses.
 * @param {{partyId: string, actorId: string}[]} held
 * @returns {{partyId: string, actorId: string, summonedBy: string|null, summon: object|null}[]}
 */
function heldRows(held) {
  const service = roster();
  const byParty = new Map();
  const seen = new Set();
  const out = [];
  for (const h of held ?? []) {
    const key = `${h?.partyId}|${h?.actorId}`;
    if (!h?.partyId || !h?.actorId || seen.has(key)) continue;
    seen.add(key);
    if (!byParty.has(h.partyId)) byParty.set(h.partyId, typeof service?.members === "function" ? (service.members(h.partyId) ?? []) : []);
    const row = byParty.get(h.partyId).find((r) => r?.actorId === h.actorId);
    out.push({ partyId: h.partyId, actorId: h.actorId, summonedBy: row?.summonedBy ?? null, summon: row?.summon ?? null });
  }
  return out;
}

/**
 * Dismiss summons: authorize, then remove what the module made for this
 * summoner. A deployed party member's token and a held summon go through the
 * roster's `release`; any other token is deleted from its scene. Where the
 * provider has no `release`, a held summon is refused and a token is deleted
 * as it always was.
 */
async function dismissOp({ summonerUuid, tokenUuids, held, user }) {
  const summoner = await fromUuid(summonerUuid);
  const tokens = [...new Set(tokenUuids ?? [])].slice(0, MAX_DISMISS).map(docOf).filter((t) => t?.documentName === "Token");
  const rows = heldRows(Array.isArray(held) ? held.slice(0, Math.max(0, MAX_DISMISS - tokens.length)) : []);
  const verdict = checkDismissRequest({ user, summoner, tokens, held: rows });
  if (!verdict.ok) return refused(verdict.reason);
  const service = roster();
  const canRelease = typeof service?.release === "function";
  const releases = new Map();
  const queue = (partyId, actorId) => releases.set(partyId, [...new Set([...(releases.get(partyId) ?? []), actorId])]);
  let refusedCount = verdict.refused;
  const byScene = new Map();
  for (const t of verdict.tokens) {
    const member = canRelease ? service.memberOfToken?.(t) : null;
    if (member?.partyId && member.actorId) queue(member.partyId, member.actorId);
    else byScene.set(t.parent, [...(byScene.get(t.parent) ?? []), t.id]);
  }
  if (canRelease) for (const row of verdict.held) queue(row.partyId, row.actorId);
  else refusedCount += verdict.held.length;
  let deleted = 0;
  for (const [scene, ids] of byScene) deleted += (await scene.deleteEmbeddedDocuments("Token", ids)).length;
  for (const [partyId, ids] of releases) deleted += Number((await service.release(partyId, ids))?.released) || 0;
  return { ok: true, deleted, refused: refusedCount };
}

/**
 * End the control of one cast's creatures, the GM's client alone. Which
 * creatures is the cast's own record and nothing else: the tokens whose actor
 * names this summoner and carries the cast id, and the party-stashed members
 * that do (`castSummons`), never a name or a type. `outcome` is the caller's
 * reading of the spell's row (`controlEndPlan`): it is never taken from a
 * request, so the caller on the GM's client resolves it first. Every creature
 * is stamped `lost` in its record, which a non-GM's dismissal is refused on
 * once it is `hostile`; a `gone` creature is deleted as a dismissal deletes it,
 * a deployed party member and a stashed one through the roster's `release`; a
 * `hostile` token drops its owners and turns hostile. A stashed creature that
 * stays or turns hostile is amended in its party's record through the roster's
 * `amendSummons` (`stashAfterControlEnd`) and stays a member; with no such
 * method it is counted `unapplied`.
 * @param {Actor} summoner
 * @param {{castId: string, outcome: string}} o
 * @returns {Promise<{ok: false, reason: string}|{ok: true, outcome: string, stamped: number, deleted: number, released: number, hostile: number, unapplied: number}>}
 */
export async function applyControlEnd(summoner, { castId, outcome } = {}) {
  if (!game.user?.isGM) return refused("notGm");
  if (!summoner?.uuid || !castId) return refused("noCast");
  const { tokens, held } = castSummons(summoner, castId);
  const service = roster();
  const canRelease = typeof service?.release === "function";
  const canAmend = typeof service?.amendSummons === "function";
  const plan = controlEndPlan({
    outcome,
    tokens: tokens.map((t) => ({ uuid: t.uuid, ownership: t.delta?._source?.ownership ?? t.actor?.ownership ?? {}, member: canRelease ? (service.memberOfToken?.(t) ?? null) : null })),
    held,
    canRelease,
    canAmend,
  });
  const byUuid = new Map(tokens.map((t) => [t.uuid, t]));
  const stampPath = `flags.${MODULE_ID}.${SUMMON_RECORD_FLAG}.lost`;
  const done = { stamped: 0, deleted: 0, released: 0, hostile: 0, unapplied: 0 };
  const deletes = new Map();
  const releases = new Map();
  const amends = new Map();
  for (const step of plan.steps) {
    const token = step.kind === "token" ? byUuid.get(step.uuid) : null;
    if (step.op === "delete" && token) deletes.set(token.parent, [...(deletes.get(token.parent) ?? []), token.id]);
    else if (step.op === "release") releases.set(step.partyId, [...new Set([...(releases.get(step.partyId) ?? []), step.actorId])]);
    else if (step.kind === "held" && (step.op === "stamp" || step.op === "hostile")) amends.set(step.partyId, [...new Set([...(amends.get(step.partyId) ?? []), step.actorId])]);
    else if (step.op === "stamp" && token?.actor) {
      await token.actor.update({ [stampPath]: step.lost });
      done.stamped++;
    } else if (step.op === "hostile" && token?.actor) {
      // A creature's actor is synthetic, its ownership a delta over the world copy's: a forced deletion there writes nothing at all, the stamp beside it included, and could not lower the copy's level anyway. Each owner is set to NONE instead.
      await token.actor.update({ [stampPath]: step.lost, ...(step.drop.length ? { ownership: Object.fromEntries(step.drop.map((id) => [id, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE])) } : {}) });
      await token.update({ disposition: step.disposition });
      done.stamped++;
      done.hostile++;
    } else if (step.op === "unapplied") done.unapplied++;
  }
  for (const [scene, ids] of deletes) done.deleted += (await scene.deleteEmbeddedDocuments("Token", ids)).length;
  for (const [partyId, ids] of releases) done.released += Number((await service.release(partyId, ids))?.released) || 0;
  for (const [partyId, ids] of amends) {
    const amended = (await service.amendSummons(partyId, ids, (data) => stashAfterControlEnd(data, plan.outcome)))?.amended ?? [];
    done.stamped += amended.length;
    if (plan.outcome === "hostile") done.hostile += amended.length;
  }
  return { ok: true, outcome: plan.outcome, ...done };
}

/**
 * The GM's half of the relay. Authorizes on the SENDER (the transport stamps
 * `requestUserId`; none means a GM), never on what the payload claims: the
 * token data is rebuilt here from the world copy, the cast id is the sender's
 * only if it is well formed, and the time is the GM's clock.
 * @param {object} payload
 * @param {"place"|"join"|"dismiss"|"variant"} payload.op
 * @param {string} payload.summonerUuid
 * @param {{partyId: string, actorId: string}[]} [payload.held]  a dismissal's held summons, named by party and member id
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, tokenUuids?: string[], joined?: string[], party?: {id: string, name: string}, deleted?: number, refused?: number}>}  `joined` and `party` answer a `join`: the new members' ids and the party they joined
 */
export async function summonRelay({ op, requestUserId = null, ...rest } = {}) {
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!user) return refused("noUser");
  if (op === "place") return placeOp({ ...rest, user });
  if (op === "join") return joinOp({ ...rest, user });
  if (op === "dismiss") return dismissOp({ ...rest, user });
  if (op === "variant") return variantOp({ ...rest, user });
  return refused("badOp");
}

/**
 * Make one creature of a family (`acks-extras.template`) for a summoning, on
 * the client that may create actors. The sender must own the summoner and be
 * able to open the family; a Player is made an observer of what it generates,
 * so the placement's readable-source check passes for the creature it chose.
 * @returns {Promise<{ok: true, uuid: string}|{ok: false, reason: string}>}
 */
async function variantOp({ summonerUuid, templateUuid, pins = {}, spellId = "", user }) {
  const summoner = summonerUuid ? await fromUuid(summonerUuid).catch(() => null) : null;
  if (!summoner?.testUserPermission?.(user, "OWNER")) return refused("notOwner");
  // As a placement is: through one of the summoner's spells, unless the seat may summon bare.
  if (spellId ? summoner.items?.get?.(spellId)?.type !== "spell" : !bareSummonAllowed(user)) return refused(spellId ? "badSpell" : "spellRequired");
  const template = templateUuid ? await fromUuid(normalizeRef(templateUuid)).catch(() => null) : null;
  if (template?.type !== TEMPLATE_TYPE) return refused("badSource");
  if (!sourceReadable(template, user)) return refused("unreadable");
  const { generateFromTemplate } = await import("./template-generate.mjs");
  const made = await generateFromTemplate(template, { pins: pins && typeof pins === "object" ? pins : {} }).catch((err) => {
    console.error(`${MODULE_ID} | a summoned family's creature could not be made`, err);
    return null;
  });
  if (!made) return refused("noCopy");
  if (!user.isGM) await made.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
  return { ok: true, uuid: made.uuid };
}

/**
 * A creature of a family, for a summoning to place: the seat picks the
 * variant (the group sheet's dialog), and the client that may create actors
 * makes it. Null where the dialog closed or the creature was not made, with
 * the reason told to the seat.
 * @param {Actor} summoner  the character summoning
 * @param {Actor} template  an `acks-extras.template` actor
 * @param {{spellId?: string}} [o]  the summoner's spell the summoning is cast from
 * @returns {Promise<Actor|null>} the world actor made
 */
export async function summonVariant(summoner, template, { spellId = "" } = {}) {
  const { GroupSheet } = await import("./apps/group-sheet.mjs");
  const pins = await GroupSheet.askVariantPins(template, { title: loc("variantTitle", { name: template.name }) });
  if (!pins) return null;
  const made = await send({ op: "variant", summonerUuid: summoner.uuid, templateUuid: template.uuid, pins, spellId });
  if (!made?.ok) {
    warnRefusal(made?.reason ?? "noGm");
    return null;
  }
  return (await fromUuid(made.uuid).catch(() => null)) ?? null;
}

/** Register the GM's half of the relay — once, at init. */
export async function registerSummons() {
  const { registerHandler } = await transport();
  registerHandler(SUMMON_HANDLER, summonRelay);
}

/** Send a request where documents can be made: handled here for a GM, relayed otherwise. */
async function send(payload) {
  const { executeAsGM } = await transport();
  return (await executeAsGM(SUMMON_HANDLER, payload)) ?? refused("noGm");
}

/* -------------------------------------------- */
/*  The seat's half                              */
/* -------------------------------------------- */

/**
 * The preview data for each creature to place: its own look, one per creature.
 * A creature with no prototype token has no look to read, so its preview is
 * the plain one core draws for a token with no picture.
 */
async function previewsFor(source, summoner, count) {
  const proto = source?.prototypeToken?.toObject() ?? null;
  const images = proto?.randomImg ? await source.getTokenImages().catch(() => []) : [];
  return Array.from({ length: count }, () => {
    const data = previewTokenData(proto, summoner.id);
    // A token is placed on a level, and core defaults one to the scene's first
    // rather than the one the seat is looking at.
    if (canvas.level?.id) data.level = canvas.level.id;
    if (images.length) data.texture = { ...(data.texture ?? {}), src: images[Math.floor(Math.random() * images.length)] };
    return data;
  });
}

/**
 * What a placement request may say before the seat clicks: the checks the
 * GM's client will run again, the canvas and the pause, answered at once.
 * Nothing is made and nothing is announced, so a cast can hold its verdict
 * ahead of any spend.
 * @param {Actor} summoner
 * @param {object} o  the placement options (`placeSummons`' `sourceUuid`, `count`, `spellId`)
 * @returns {Promise<{ok: true, scene: Scene, source: Actor}|{ok: false, reason: string}>}
 */
export async function summonVerdict(summoner, { sourceUuid, count = 1, spellId = "" } = {}) {
  const scene = sceneNow();
  const source = await resolveSource(sourceUuid, spellId, game.user);
  const verdict = checkPlaceRequest({ user: game.user, summoner, source, scene, count, spellId });
  // A seat that is no GM cannot tell a creature that is gone from one on a shelf closed to it: a ref its spell carries that nothing here answers reads as the second.
  const closed = verdict.reason === "badSource" && !source && !!spellId && !!normalizeRef(sourceUuid) && !game.user.isGM;
  if (!verdict.ok) return refused(closed ? "unreadable" : verdict.reason);
  if (!canvas?.ready || !scene) return refused("noCanvas");
  if (game.paused && !game.user.isGM) return refused("paused");
  return { ok: true, scene, source };
}

/**
 * The `preConfirm` that holds each click to a cast's range: a place beyond
 * `rangeFeet` of the caster's token centre is refused to a Player and warned to
 * a Judge, and the caster's token missing from the scene reads the same way.
 * The measure is the one the GM's client runs again (`checkPlacementRange`).
 * Any `preConfirm` the caller passed runs first and may refuse the click itself.
 */
function rangePreConfirm({ scene, casterToken, rangeFeet, calling, preConfirm }) {
  const token = typeof casterToken === "string" ? scene?.tokens?.get?.(casterToken) : casterToken;
  return (context) => {
    if (preConfirm?.(context) === false) return false;
    const from = token ? centreOfToken(token) : null;
    const point = placedPositions([context?.document])[0];
    const verdict = checkPlacementRange({ positions: [point], from, rangeFeet, calling, measure: (a, b) => pointGapFeet(scene, a, b) });
    if (verdict.ok) return undefined;
    ui.notifications.warn(loc(`refused.${verdict.reason}`));
    return game.user.isGM ? undefined : false;
  };
}

/**
 * The click-to-place half of a summoning, shared by `pickPlacement` and
 * `placeSummons`: core's placement of one preview token per creature with
 * nothing created, the range gate on each click where the cast states a range.
 * @returns {Promise<{positions: object[]}|{reason: string}>} the places chosen (possibly none), or the
 *   reason the placement could not run
 */
async function clickPlacement(summoner, { scene, source, count, preConfirm, rangeFeet, calling, casterToken }) {
  const gate = rangeLimitOf(rangeFeet) === null || calling === true ? preConfirm : rangePreConfirm({ scene, casterToken, rangeFeet, calling, preConfirm });
  try {
    const placed = await canvas.tokens.placeTokens(await previewsFor(source, summoner, count), { create: false, preConfirm: gate });
    return { positions: placedPositions(placed) };
  } catch (err) {
    console.error(`${MODULE_ID} | summon placement failed`, err);
    return { reason: "placement" };
  }
}

/**
 * The seat's clicks for the places of a summoning: a preview token per
 * creature on the scene the canvas shows, and the positions chosen. It makes
 * nothing and sends nothing. A seat that stops a placement short gets the
 * places chosen so far. Null means nothing was chosen, whether the seat
 * cancelled outright or the request could not start (a refusal `summonVerdict`
 * would give, a game paused for a Player, a placement that threw). Every such
 * case but a cancel warns the seat in its own words, and a cast that must
 * decide before it spends holds `summonVerdict` first.
 * @param {Actor} summoner
 * @param {object} o
 * @param {string} o.sourceUuid  the creature, as `placeSummons` reads it
 * @param {number} [o.count=1]
 * @param {string} [o.spellId]
 * @param {Function} [o.preConfirm]  core's placement hook, run before the range gate; returning false refuses a click
 * @param {number|null} [o.rangeFeet]  the farthest a place may be from the centre of the caster's token, in
 *   feet; passed in by the caller, never read here. Null or absent states none and nothing is measured
 * @param {boolean} [o.calling]  the creature is called from where it stands, so no range bounds the place
 * @param {TokenDocument|string|null} [o.casterToken]  the caster's token, or its id on the scene
 * @returns {Promise<{positions: {x: number, y: number}[]}|null>}
 */
export async function pickPlacement(summoner, { sourceUuid, count = 1, spellId = "", preConfirm, rangeFeet = null, calling = false, casterToken = null } = {}) {
  const verdict = await summonVerdict(summoner, { sourceUuid, count, spellId });
  if (!verdict.ok) {
    warnRefusal(verdict.reason);
    return null;
  }
  const clicked = await clickPlacement(summoner, { scene: verdict.scene, source: verdict.source, count, preConfirm, rangeFeet, calling, casterToken });
  if (clicked.reason) {
    warnRefusal(clicked.reason);
    return null;
  }
  return clicked.positions.length ? { positions: clicked.positions } : null;
}

/**
 * Summon creatures: the seat clicks where each goes (`pickPlacement`), and the
 * GM's client makes the tokens. A placement the user cut short places the
 * creatures chosen so far; one cancelled outright places nothing. With
 * `positions` already picked no click is made and the creatures stand where
 * those say.
 * @param {Actor} summoner  the character summoning
 * @param {object} o
 * @param {string} o.sourceUuid  the library creature: a document uuid, or, for a request that names a
 *   spell, the ref a spell's row carries (an importer cookbook id). Both the seat and the GM's client
 *   resolve it, and the requesting user must be able to observe the document (`unreadable`); a Judge always can
 * @param {number} [o.count=1]
 * @param {string} [o.spellId]  the spell item of the summoner this is cast from; empty is refused
 *   `spellRequired` unless the seat is `bareSummonAllowed`
 * @param {Function} [o.preConfirm]  core's placement hook, `({event, document, index, count}) => boolean|void`:
 *   returning false refuses that click, which is where a summoning that
 *   constrains where the creature appears states its constraint
 * @param {{x: number, y: number}[]} [o.positions]  places already picked (`pickPlacement`'s answer); the
 *   creature count sent is their number. An empty list is a cancel
 * @param {string} [o.castId]  the cast's id; the GM's client replaces one that is malformed
 * @param {{castId?: string, casterLevel?: number, invocationLevel?: number}} [o.cast]  the cast the request
 *   belongs to, handed to every registered policy on the GM's client. The levels are the seat's word and
 *   the GM does not recompute them
 * @param {number|null} [o.rangeFeet]  the farthest a place may be from the centre of the caster's token,
 *   in feet. The GM's client measures every place against it again and refuses a Player's request that
 *   stands beyond it (`outOfRange`) or that names no caster token on the scene (`noCaster`); a Judge's is
 *   not refused. Null or absent: nothing is measured
 * @param {boolean} [o.calling]  the creature is called from where it stands: exempt from the range
 * @param {TokenDocument|string|null} [o.casterToken]  the caster's token, or its id on the scene
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, tokenUuids?: string[]}>}
 */
export async function placeSummons(summoner, { sourceUuid, count = 1, spellId = "", preConfirm, positions, castId, cast, rangeFeet = null, calling = false, casterToken = null } = {}) {
  const verdict = await summonVerdict(summoner, { sourceUuid, count, spellId });
  if (!verdict.ok) return refused(verdict.reason);
  let places = positions;
  if (!places) {
    const clicked = await clickPlacement(summoner, { scene: verdict.scene, source: verdict.source, count, preConfirm, rangeFeet, calling, casterToken });
    if (clicked.reason) return refused(clicked.reason);
    places = clicked.positions;
  }
  if (!places.length) return refused("cancelled");
  const payload = {
    op: "place",
    summonerUuid: summoner.uuid,
    sourceUuid,
    sceneId: verdict.scene.id,
    positions: places,
    count: places.length,
    spellId,
    castId: castId ?? cast?.castId ?? foundry.utils.randomID(),
  };
  if (cast) payload.cast = { castId: payload.castId, casterLevel: cast.casterLevel ?? null, invocationLevel: cast.invocationLevel ?? null };
  if (rangeLimitOf(rangeFeet) !== null) {
    Object.assign(payload, { rangeFeet, calling: calling === true, casterTokenId: typeof casterToken === "string" ? casterToken : (casterToken?.id ?? "") });
  }
  return send(payload);
}

/**
 * Summon creatures straight into the party the caster marches inside, the
 * seat's half: a party check (`joiningParty`), then the request to the GM's
 * client, which authorizes it as a placement is and makes the creatures
 * members of the party. No place is picked and no token is made. Refused
 * `noParty` where the caster marches inside no party token.
 * @param {Actor} summoner  the character summoning
 * @param {object} o
 * @param {string} o.sourceUuid  the creature, as `placeSummons` reads it
 * @param {number} [o.count=1]
 * @param {string} [o.spellId]
 * @param {string} [o.castId]  the cast's id; the GM's client replaces one that is malformed
 * @param {{castId?: string, casterLevel?: number, invocationLevel?: number}} [o.cast]  as `placeSummons` takes it
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, joined?: string[], party?: {id: string, name: string}}>}
 *   `joined` is the ids of the members made, in the party named
 */
export async function joinSummons(summoner, { sourceUuid, count = 1, spellId = "", castId, cast } = {}) {
  if (!joiningParty(summoner)) return refused("noParty");
  const payload = { op: "join", summonerUuid: summoner.uuid, sourceUuid, count, spellId, castId: castId ?? cast?.castId ?? foundry.utils.randomID() };
  if (cast) payload.cast = { castId: payload.castId, casterLevel: cast.casterLevel ?? null, invocationLevel: cast.invocationLevel ?? null };
  return send(payload);
}

/**
 * The token one dismissal entry names: its `tokenUuid` when it carries one,
 * else its `tokenId` on the entry's `sceneId`, else on the given scene.
 */
function entryToken(entry, scene) {
  if (entry?.tokenUuid) return docOf(entry.tokenUuid);
  if (!entry?.tokenId) return null;
  return (entry.sceneId ? game.scenes?.get(entry.sceneId) : scene)?.tokens?.get(entry.tokenId) ?? null;
}

/**
 * Dismiss summons the module made: the requesting seat confirms, and the GM's
 * client removes them. A creature bound to the summoner by hand is not
 * dismissed here. The world copy stays. What is dismissed is the union of
 * `tokens`, the tokens `entries` name, and the held summons `held` and
 * `entries` name; with none of the three given it is the summoner's tokens on
 * the scene and every summon of theirs riding in a party token.
 * @param {Actor} summoner
 * @param {object} [o]
 * @param {TokenDocument[]} [o.tokens]  the tokens to dismiss
 * @param {{tokenId?: string|null, tokenUuid?: string, sceneId?: string, held?: {partyId: string, actorId: string}|null}[]} [o.entries]
 *   one summon each: a scene token by `tokenId` (on `sceneId`, else on `scene`), a held summon by `held`
 * @param {{partyId: string, actorId: string}[]} [o.held]  held summons (`heldSummonsOf`, `castSummons`)
 * @param {Scene} [o.scene]  where an entry's bare `tokenId` is read; omitted, the scene on the canvas
 * @param {string} [o.castId]  restrict to one cast
 * @param {boolean} [o.confirm=true]  ask first; the prompt is kept unless a caller has already asked
 * @returns {Promise<{ok: boolean, reason?: string, deleted?: number, refused?: number}>}
 */
export async function dismissSummons(summoner, { tokens, entries, held, scene = sceneNow(), castId = "", confirm = true } = {}) {
  const named = !!(tokens || entries || held);
  let chosen = [...(tokens ?? [])];
  let chosenHeld = [...(held ?? [])];
  for (const entry of entries ?? []) {
    const token = entryToken(entry, scene);
    if (token) chosen.push(token);
    if (entry?.held) chosenHeld.push(entry.held);
  }
  if (!named) {
    chosen = summonsOf(summoner, { scene });
    chosenHeld = heldSummonsOf(summoner);
  }
  chosen = [...new Set(chosen)];
  let rows = heldRows(chosenHeld);
  if (castId) {
    chosen = chosen.filter((t) => summonRecordOf(t.actor)?.castId === castId);
    rows = rows.filter((r) => r.summon?.castId === castId);
  }
  const verdict = checkDismissRequest({ user: game.user, summoner, tokens: chosen, held: rows });
  if (!verdict.ok) return refused(verdict.reason);
  const total = verdict.tokens.length + verdict.held.length;
  if (!total) return refused("none");
  if (confirm) {
    const yes = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("dismissTitle") },
      content: `<p>${foundry.utils.escapeHTML(loc("dismissConfirm", { n: total, name: summoner.name }))}</p>`,
      rejectClose: false,
    });
    if (yes !== true) return refused("declined");
  }
  const payload = { op: "dismiss", summonerUuid: summoner.uuid, tokenUuids: verdict.tokens.map((t) => t.uuid) };
  if (verdict.held.length) payload.held = verdict.held.map(({ partyId, actorId }) => ({ partyId, actorId }));
  return send(payload);
}

/** Say why a request was refused, in the seat's own words. */
function warnRefusal(reason) {
  if (reason === "cancelled" || reason === "declined" || reason === "noGm") return;
  ui.notifications.warn(loc(`refused.${reason}`));
}

/**
 * A refusal reason in the seat's own words, for a caller that tells it in a
 * place of its own (a cast's verdict). Imported directly; it is not on the API.
 * @param {string} reason  one of `placeSummons`' refusal reasons
 * @returns {string}
 */
export const refusalText = (reason) => loc(`refused.${reason}`);

/**
 * Tell the seat how a placement went: the count placed, or the reason it was
 * refused in the seat's own words (nothing for a cancel). For a caller that
 * runs `placeSummons` itself, as a spell's cast does.
 * @param {{ok: boolean, reason?: string, tokenUuids?: string[]}|null} result  `placeSummons`' answer
 */
export function announceSummon(result) {
  if (result?.ok) ui.notifications.info(loc("placed", { n: result.tokenUuids?.length ?? 0 }));
  else warnRefusal(result?.reason ?? "noGm");
}

/**
 * Tell the seat how a join went: the count that joined and the party's name, or
 * the reason it was refused in the seat's own words. For a caller that runs
 * `joinSummons` itself, as `announceSummon` is for `placeSummons`.
 * @param {{ok: boolean, reason?: string, joined?: string[], party?: {name: string}}|null} result  `joinSummons`' answer
 */
export function announceJoin(result) {
  if (result?.ok) ui.notifications.info(loc("joined", { n: result.joined?.length ?? 0, party: result.party?.name ?? "" }));
  else warnRefusal(result?.reason ?? "noGm");
}

/** The window classes every prompt here carries: the module's own and its scroll contract. */
const PROMPT_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

/** The `<option>` markup of the seat's creature shelves, grouped by pack. */
function shelfOptionsHtml(shelves) {
  const esc = foundry.utils.escapeHTML;
  return shelves
    .map((s) => `<optgroup label="${esc(s.label)}">${s.entries.map((e) => `<option value="${esc(e.uuid)}">${esc(e.name)}</option>`).join("")}</optgroup>`)
    .join("");
}

/** Tell the seat there is no creature it can open, and offer nothing. */
async function promptNoMonsters(title) {
  await foundry.applications.api.DialogV2.prompt({
    classes: PROMPT_CLASSES,
    window: { title },
    content: `<p class="notes">${foundry.utils.escapeHTML(loc("noMonsters"))}</p>`,
    ok: { label: loc("close"), callback: () => false },
    rejectClose: false,
  });
}

/**
 * The creature and count prompt of a summoning cast from a spell. The spell's
 * own `options` (`summonOptionsOf` rows: `{ref, amount, ...}`) decide the
 * choices: each row whose `ref` the caller's `resolveRef` turns into a creature
 * is offered, the first one preselected, and its `amount` is the count the
 * field opens on. A row the seat cannot resolve is still offered when its ref
 * reads as an id: the ref goes on untouched as the answer's `sourceUuid`,
 * labelled by the row's `name`; the placement then refuses a creature the seat
 * cannot observe. With no offerable row the seat picks from the
 * shelves it can open. `resolveRef` is passed in because lib imports no
 * feature. The prompt only asks: nothing is placed, and the answer goes to
 * `placeSummons`.
 *
 * @param {Actor} summoner
 * @param {object} [o]
 * @param {{id: string, name: string}} [o.spell]  the summoner's spell item the cast is made from
 * @param {{ref?: string, name?: string, amount?: number}[]} [o.options]
 * @param {(ref: string) => Promise<{uuid: string, name: string}|null>} [o.resolveRef]
 * @returns {Promise<{sourceUuid: string, count: number, spellId: string}|null>} null when the prompt was closed
 *   or there was no creature to choose
 */
export async function pickSummon(summoner, { spell, options = [], resolveRef } = {}) {
  const esc = foundry.utils.escapeHTML;
  const title = spell?.name || loc("title");
  const resolved = [];
  for (const row of options) {
    const ref = String(row?.ref ?? "").trim();
    resolved.push(ref && resolveRef ? await Promise.resolve(resolveRef(ref)).catch(() => null) : null);
  }
  const named = offerRows(options, resolved);
  let choices;
  if (named.length) {
    // A row this seat could not open is offered by the name its row carries, else a plain count, and its ref goes on untouched.
    choices = named
      .map((n, i) => `<option value="${esc(n.value)}" data-amount="${n.amount || ""}">${esc(n.name || loc("creatureN", { n: i + 1 }))}</option>`)
      .join("");
  } else {
    const shelves = summonShelves();
    if (!shelves.length) {
      await promptNoMonsters(title);
      return null;
    }
    choices = shelfOptionsHtml(shelves);
  }
  const opening = Math.min(MAX_SUMMONS, Math.max(1, named[0]?.amount || 1));
  const form = await foundry.applications.api.DialogV2.prompt({
    classes: PROMPT_CLASSES,
    window: { title },
    content:
      `<div class="form-group"><label>${esc(loc("creature"))}</label><select name="source">${choices}</select></div>` +
      `<div class="form-group"><label>${esc(loc("count"))}</label><input type="number" name="count" value="${opening}" min="1" max="${MAX_SUMMONS}" step="1"></div>`,
    render: (_event, dialog) => {
      const root = dialog.element;
      const select = root?.querySelector?.('select[name="source"]');
      const count = root?.querySelector?.('input[name="count"]');
      select?.addEventListener("change", () => {
        const amount = Number(select.selectedOptions?.[0]?.dataset?.amount) || 0;
        if (amount && count) count.value = String(Math.min(MAX_SUMMONS, amount));
      });
    },
    ok: {
      label: loc("place"),
      callback: (_event, button) => ({
        sourceUuid: button.form.elements.source.value,
        count: Number(button.form.elements.count.value),
        spellId: spell?.id ?? "",
      }),
    },
    rejectClose: false,
  });
  return form && typeof form === "object" ? form : null;
}

/**
 * The bare Summon… prompt: the creature from the library this seat can read,
 * how many, and optionally the spell it is cast from, then the placement. It
 * is the spell-less path, so it answers `spellRequired` at once for a seat
 * `bareSummonAllowed` does not allow it. With no creature the seat can read,
 * the prompt says so and offers nothing.
 * @param {Actor} summoner
 * @returns {Promise<{ok: boolean, reason?: string}|null>} null when the prompt was closed
 */
export async function promptSummon(summoner) {
  const esc = foundry.utils.escapeHTML;
  const DialogV2 = foundry.applications.api.DialogV2;
  const classes = PROMPT_CLASSES;
  if (!bareSummonAllowed(game.user)) {
    warnRefusal("spellRequired");
    return refused("spellRequired");
  }
  const shelves = summonShelves();
  if (!shelves.length) {
    await promptNoMonsters(loc("title"));
    return null;
  }
  const options = shelfOptionsHtml(shelves);
  const spells = [...summoner.items].filter((i) => i.type === "spell").sort((a, b) => a.name.localeCompare(b.name));
  const spellField = spells.length
    ? `<div class="form-group"><label>${esc(loc("spell"))}</label><select name="spell"><option value="">—</option>${spells
        .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`)
        .join("")}</select></div>`
    : "";
  const form = await DialogV2.prompt({
    classes,
    window: { title: loc("title") },
    content:
      `<div class="form-group"><label>${esc(loc("creature"))}</label><select name="source">${options}</select></div>` +
      `<div class="form-group"><label>${esc(loc("count"))}</label><input type="number" name="count" value="1" min="1" max="${MAX_SUMMONS}" step="1"></div>` +
      spellField,
    ok: {
      label: loc("place"),
      callback: (_event, button) => ({
        sourceUuid: button.form.elements.source.value,
        count: Number(button.form.elements.count.value),
        spellId: button.form.elements.spell?.value ?? "",
      }),
    },
    rejectClose: false,
  });
  if (!form || typeof form !== "object") return null;
  const result = await placeSummons(summoner, form);
  announceSummon(result);
  return result;
}

/** Confirm and dismiss, then say how it went. */
export async function promptDismiss(summoner, options = {}) {
  const result = await dismissSummons(summoner, options);
  if (result.ok) ui.notifications.info(loc("dismissed", { n: result.deleted ?? 0 }));
  else warnRefusal(result.reason);
  return result;
}
