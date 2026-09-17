/* global game, fromUuidSync, Hooks */
/**
 * Standing, asked of the world: which factions hold a place or a quarter,
 * what they think of a party, how they regard one another, and who is hunting
 * whom where. The pure half is `standing-logic.mjs`; this file only finds the
 * documents and reads the subjects off a formation.
 *
 * Every writer here is a Judge's: the ledger, the relations and the holdings
 * are the Judge's record, and a player's client is refused rather than left to
 * fail at the document layer.
 */
import { MODULE_ID, FACTION_TYPE, AUTHORITY_KINDS, HOOKS, RELATION_STANCES, SETTING_STANDING_STEP } from "./constants.mjs";
import {
  classStepsFor, factionRecord, huntersAmong, isWanted, regardedBy, rowsFor, subjectsOf, sumStanding,
} from "./standing-logic.mjs";
import { getFormationForActor, readFormations } from "../formation/formation-model.mjs";
import { ancestorUuids, indexPlaces } from "../lib/place-logic.mjs";
import { allPlaces, packIdOf } from "../lib/place.mjs";

/** Is this document a faction actor? */
export const isFaction = (doc) => doc?.documentName === "Actor" && doc?.type === FACTION_TYPE;

/** Every faction in the world. Compendium factions are not consulted: a rule that reads a ledger reads the world's. */
export function allFactions() {
  return (game.actors ?? []).filter((a) => a.type === FACTION_TYPE);
}

/** The factions that control a scene Region. */
export function factionsControlling(regionUuid) {
  if (!regionUuid) return [];
  return allFactions().filter((f) => f.system.controlsRegion(regionUuid));
}

/** The factions whose membership lists an actor. */
export function factionsOfMember(actorUuid) {
  if (!actorUuid) return [];
  return allFactions().filter((f) => f.system.hasMember(actorUuid));
}

/**
 * The factions that hold a PLACE: seated at it or holding it, or at a place it
 * is inside of (a guild seated in the city holds every market in it), or
 * controlling the quarter the place is — its own region, or the region its
 * scene link's quarter names. One place scan, the sheet's own.
 */
export function factionsAt(place) {
  if (!place) return [];
  const nodes = allPlaces({ pack: place.pack ?? packIdOf(place.system?.parentUuid) });
  const index = indexPlaces(nodes);
  const chain = new Set([place.uuid, ...ancestorUuids(place.uuid, index)]);
  const region = place.system?.regionUuid ?? "";
  return allFactions().filter((f) =>
    f.system.placeUuids.some((uuid) => chain.has(uuid)) || (region && f.system.controlsRegion(region)));
}

/** The factions whose seat or one of whose holdings is EXACTLY this place — no ancestor stands in. */
export function factionsHolding(placeUuid) {
  if (!placeUuid) return [];
  return allFactions().filter((f) => f.system.holdsPlace(placeUuid));
}

/**
 * The subject set of a formation: its party actor, every member, and every
 * organisation the party or a member belongs to.
 * @returns {{partyUuid: string, characterUuids: string[], factionUuids: string[]}}
 */
export function subjectsOfFormation(formation) {
  if (!formation) return subjectsOf();
  const { partyUuid, memberUuids } = peopleOf(formation);
  return subjectsOf({ partyUuid, memberUuids, factionUuids: factionsRostering([partyUuid, ...memberUuids]) });
}

/** A formation's party actor and members as uuids. No world scan — the caller's own follows. */
function peopleOf(formation) {
  return {
    partyUuid: formation?.actorId ? `Actor.${formation.actorId}` : "",
    memberUuids: (formation?.members ?? []).map((m) => (m?.actorId ? `Actor.${m.actorId}` : "")),
  };
}

/**
 * The subject set of one actor: the actor itself, and — when it is a party
 * actor or marches in a formation — that formation's party and members, plus
 * every organisation any of them belongs to and the actor's own uuid when the
 * actor IS one. A faction that favours the party favours the character who is
 * in it, and a faction that has written the guild down deals that way with
 * every guildsman.
 */
export function subjectsOfActor(actor) {
  if (!actor) return subjectsOf();
  const own = actor.uuid ? [actor.uuid] : [];
  const formation = Object.values(readFormations()).find((f) => f?.actorId && f.actorId === actor.id)
    ?? getFormationForActor(actor.id);
  const { partyUuid, memberUuids } = formation ? peopleOf(formation) : { partyUuid: "", memberUuids: [] };
  const people = [...own, ...memberUuids];
  const factionUuids = [...factionsRostering([partyUuid, ...people]), ...(isFaction(actor) ? own : [])];
  return subjectsOf({ partyUuid, memberUuids: people, factionUuids });
}

/**
 * The uuids of the factions rostering any of these actors. One scan of the
 * world's factions however many actors are asked about — a subject set is
 * built on a render path and on every reaction roll.
 */
function factionsRostering(actorUuids) {
  const wanted = new Set((actorUuids ?? []).filter((u) => !!u));
  if (!wanted.size) return [];
  return allFactions().filter((f) => [...wanted].some((u) => f.system.hasMember(u))).map((f) => f.uuid);
}

/** The standing a faction holds toward a subject set. */
export function standingFor(faction, subjects, opts) {
  return sumStanding(faction?.system?.standing, subjects, opts);
}

/** The faction's rows that concern a subject set. */
export function standingRowsFor(faction, subjects, opts) {
  return rowsFor(faction?.system?.standing, subjects, opts);
}

/** Does the faction hold a `wanted` row for anyone in the subject set? */
export function isWantedBy(faction, subjects) {
  return isWanted(faction?.system?.standing, subjects);
}

/**
 * Who is hunting a subject set in a quarter: the factions controlling the
 * region that hold a `wanted` row for someone in it.
 */
export function huntersOf(regionUuid, subjects) {
  const records = allFactions().map(factionRecord);
  const uuids = new Set(huntersAmong(records, regionUuid, subjects).map((r) => r.uuid));
  return allFactions().filter((f) => uuids.has(f.uuid));
}

/**
 * The authorities an actor acts for in a quarter: watch and noble factions
 * controlling the region that list the actor as a member.
 */
export function authoritiesRostering(regionUuid, actorUuid) {
  if (!regionUuid || !actorUuid) return [];
  return factionsControlling(regionUuid).filter((f) => AUTHORITY_KINDS.has(f.system.kind) && f.system.hasMember(actorUuid));
}

/**
 * How many market-class steps the factions holding a place move it for an
 * employer, at the world's step size. Zero with the knob off (the default),
 * with no faction at the place, or with nothing on their ledgers about the
 * employer. The henchmen feature's `effectiveMarketClass` adds this to the
 * effect-borne shift; the pool a town rolls for everyone is never moved.
 */
export function marketClassShift(location, employer) {
  const step = Number(game.settings?.get?.(MODULE_ID, SETTING_STANDING_STEP)) || 0;
  if (step <= 0 || !location) return 0;
  const subjects = subjectsOfActor(employer);
  const sum = factionsAt(location).reduce((total, f) => total + standingFor(f, subjects), 0);
  return classStepsFor(sum, step);
}

/**
 * Write one row onto a faction's ledger. GM only — the ledger is the Judge's
 * record. The time is the world clock's; the subject's name is read once so
 * the row still says whom it was about after the actor is gone.
 * @param {object} row `{subject: {scope, uuid}, value, reason, source}`
 * @returns {Promise<boolean>} whether a row was written
 */
export async function addStanding(faction, row) {
  if (!isFaction(faction) || !game.user?.isGM) return false;
  const subject = {
    scope: row?.subject?.scope ?? "party",
    uuid: row?.subject?.uuid ?? "",
    name: row?.subject?.name ?? (row?.subject?.uuid ? (fromUuidSync(row.subject.uuid)?.name ?? "") : ""),
  };
  if (subject.scope === "all") subject.uuid = "";
  const next = {
    subject,
    value: Math.trunc(Number(row?.value)) || 0,
    reason: String(row?.reason ?? ""),
    time: Number(row?.time ?? game.time?.worldTime ?? 0) || 0,
    source: row?.source ?? "manual",
  };
  const rows = (faction.system.standing ?? []).map((r) => r.toObject?.() ?? r);
  await faction.update({ "system.standing": [...rows, next] });
  Hooks.callAll(HOOKS.STANDING_CHANGED, { faction: faction.uuid, row: next });
  return true;
}

/** Take a row off a faction's ledger by index. GM only. */
export async function removeStanding(faction, index) {
  if (!isFaction(faction) || !game.user?.isGM) return false;
  const rows = (faction.system.standing ?? []).map((r) => r.toObject?.() ?? r);
  if (!(index >= 0 && index < rows.length)) return false;
  const [removed] = rows.splice(index, 1);
  await faction.update({ "system.standing": rows });
  Hooks.callAll(HOOKS.STANDING_CHANGED, { faction: faction.uuid, removed });
  return true;
}

/* -------------------------------------------- */
/*  Relations                                    */
/* -------------------------------------------- */

/** How `a` regards `b`: a's own row about b, or null. Directed — b's view is b's row. */
export function relationBetween(a, b) {
  if (!isFaction(a)) return null;
  return a.system.relationTo(b?.uuid ?? b ?? "");
}

/** The reverse view: every other world faction that holds a row about this one. */
export function regardedByFactions(faction) {
  if (!faction?.uuid) return [];
  return regardedBy(allFactions().map(factionRecord), faction.uuid);
}

/**
 * Write or replace one faction's row about another. GM only — a relation is
 * the Judge's record like the ledger. An organisation cannot hold a row about
 * itself; a stance off the list falls back to `neutral`.
 * @param {object} opts `{stance, note, hidden}` — each kept from the existing row where omitted
 * @returns {Promise<boolean>} whether a row was written
 */
export async function setRelation(faction, other, { stance, note, hidden } = {}) {
  if (!isFaction(faction) || !isFaction(other) || !game.user?.isGM) return false;
  if (faction.uuid === other.uuid) return false;
  const rows = (faction.system.relations ?? []).map((r) => r.toObject?.() ?? r);
  const current = rows.find((r) => r.uuid === other.uuid) ?? null;
  const next = {
    uuid: other.uuid,
    name: other.name ?? "",
    stance: RELATION_STANCES.includes(stance) ? stance : (current?.stance ?? "neutral"),
    note: note === undefined ? (current?.note ?? "") : String(note ?? ""),
    hidden: hidden === undefined ? !!current?.hidden : !!hidden,
  };
  await faction.update({
    "system.relations": current ? rows.map((r) => (r.uuid === other.uuid ? next : r)) : [...rows, next],
  });
  Hooks.callAll(HOOKS.RELATIONS_CHANGED, { faction: faction.uuid });
  return true;
}

/** Drop a faction's row about another. GM only. */
export async function removeRelation(faction, otherUuid) {
  if (!isFaction(faction) || !otherUuid || !game.user?.isGM) return false;
  const rows = (faction.system.relations ?? []).map((r) => r.toObject?.() ?? r);
  const kept = rows.filter((r) => r.uuid !== otherUuid);
  if (kept.length === rows.length) return false;
  await faction.update({ "system.relations": kept });
  Hooks.callAll(HOOKS.RELATIONS_CHANGED, { faction: faction.uuid });
  return true;
}

/* -------------------------------------------- */
/*  Holdings                                     */
/* -------------------------------------------- */

/**
 * Add a place to a faction's holdings. GM only. A place already held — the
 * seat included — is refused rather than listed twice, so the seat and a
 * holding are never the same roof counted as two.
 * @param {object} opts `{note, hidden}`
 * @returns {Promise<boolean>} whether a holding was added
 */
export async function addHolding(faction, place, { note = "", hidden = false } = {}) {
  if (!isFaction(faction) || !place?.uuid || !game.user?.isGM) return false;
  if (faction.system.holdsPlace(place.uuid)) return false;
  const rows = (faction.system.holdings ?? []).map((r) => r.toObject?.() ?? r);
  await faction.update({
    "system.holdings": [...rows, { uuid: place.uuid, name: place.name ?? "", note: String(note ?? ""), hidden: !!hidden }],
  });
  return true;
}

/** Drop a place from a faction's holdings. The seat is not one, and is not touched. GM only. */
export async function removeHolding(faction, placeUuid) {
  if (!isFaction(faction) || !placeUuid || !game.user?.isGM) return false;
  const rows = (faction.system.holdings ?? []).map((r) => r.toObject?.() ?? r);
  const kept = rows.filter((r) => r.uuid !== placeUuid);
  if (kept.length === rows.length) return false;
  await faction.update({ "system.holdings": kept });
  return true;
}
