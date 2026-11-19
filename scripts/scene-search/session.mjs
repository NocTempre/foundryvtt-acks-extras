/* global game, foundry, fromUuidSync */
/**
 * The scene session on the table, the Foundry side of `session-logic.mjs`: read
 * the session off the party actor, find the place and its entries, write one
 * entry's state to wherever that state lives, and measure what a check's reach
 * needs from the party's token.
 *
 * The session is `flags["acks-extras"].sceneSearch` on the party actor, written
 * whole by a GM client as a `ForcedReplacement` and unset to end it. A place's
 * thing keeps its own `state` on the place's list; a body has no thing, so its
 * state rides in the session's `bodies`. Doors and old-style traps are derived
 * from the map, not stored: `derivedInputs` is where they will be read, and
 * answers none until that derivation is built.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { tokenCentre } from "../lib/token-centre.mjs";
import { sceneFeetPerCell } from "../lib/distance-units.mjs";
import { thingsOf, updateThingOn } from "../lib/place-things.mjs";
import { unset } from "../lib/util.mjs";
import { getFormation, getPartyActor, getPartyToken } from "../formation/formation-model.mjs";
import { trapFigures } from "../formation/trap-rules.mjs";
import { SESSION_FLAG } from "./constants.mjs";
import { plateNames } from "./plate-logic.mjs";
import { appendLog, normalizeSession, sessionEntries } from "./session-logic.mjs";

const path = `flags.${MODULE_ID}.${SESSION_FLAG}`;

/** The formation as the current record, falling back to the one handed in. */
const freshOf = (formation) => (formation?.id ? (getFormation(formation.id) ?? formation) : formation);

/** The party's session in its signed shape, or null when the party has none open. */
export function readSession(formation) {
  return normalizeSession(getPartyActor(formation)?.getFlag?.(MODULE_ID, SESSION_FLAG));
}

/**
 * Write the session whole, or unset it with null. A GM client is the only
 * writer; any other seat writes nothing.
 * @returns {Promise<boolean>} whether a write was made
 */
export async function writeSession(formation, session) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user?.isGM) return false;
  await actor.update({ [path]: session ? foundry.data.operators.ForcedReplacement.create(session) : unset() });
  return true;
}

/** The place actor a session names, or null. */
export function placeOfSession(session) {
  try {
    const place = session?.placeUuid ? fromUuidSync(session.placeUuid, { strict: false }) : null;
    return place?.documentName === "Actor" ? place : null;
  } catch {
    return null;
  }
}

/**
 * The entries read from the map rather than from the place's list: its doors
 * (`{id, hidden, point, …}` per wall, a hidden exit being a door of the hidden
 * kind) and its old-style traps (`{id, known, point, …}`). Nothing derives them
 * yet, so both are empty.
 * @returns {{doors: object[], oldTraps: object[]}}
 */
export function derivedInputs(_place, _scene) {
  return { doors: [], oldTraps: [] };
}

/**
 * The session's world as one read: the session, its place and every entry, the
 * Judge's view with the dealt lots laid over. Null when the party has no
 * session open or its place is gone.
 * @returns {{session: object, place: Actor, entries: object[]}|null}
 */
export function readWorld(formation) {
  const session = readSession(formation);
  const place = placeOfSession(session);
  if (!session || !place) return null;
  const scene = session.sceneId ? game.scenes?.get(session.sceneId) : null;
  return { session, place, entries: sessionEntries({ things: thingsOf(place), session, ...derivedInputs(place, scene) }) };
}

/**
 * Write a patch to one entry's `state`, to wherever that entry keeps it: a
 * place's thing on the place's list (`updateThingOn`, re-read at the write), a
 * body in the session's `bodies` (re-read at the write). Only the keys the patch
 * names change. An entry derived from the map has nowhere to keep state and
 * writes nothing.
 * @param {object} formation
 * @param {object} entry one of `readWorld`'s entries
 * @param {object} patch the state keys to set
 * @returns {Promise<boolean>} whether a write was made
 */
export async function writeEntryState(formation, entry, patch) {
  if (!game.user?.isGM) return false;
  if (entry.source === "thing") {
    const world = readWorld(formation);
    return !!world && !!(await updateThingOn(world.place, entry.id, { state: patch }));
  }
  if (entry.source === "body") {
    const session = readSession(formation);
    if (!session?.bodies.some((b) => b.id === entry.id)) return false;
    const bodies = session.bodies.map((b) => (b.id === entry.id ? { ...b, state: { ...(b.state ?? {}), ...structuredClone(patch) } } : b));
    return writeSession(formation, { ...session, bodies });
  }
  return false;
}

/** Add one row to the session's log, re-reading the session at the write. */
export async function logCheck(formation, row) {
  const session = readSession(formation);
  if (!session) return false;
  return writeSession(formation, { ...session, log: appendLog(session.log, row) });
}

/**
 * What a check's reach needs from the table: the imported search reach, the
 * scene's feet per pixel and the party token's centre, each null where it is
 * not known (an unimported reach, a scene with no scale, a party token off the
 * session's scene), and a check whose reach cannot be measured is the Judge's
 * call.
 * @returns {{searchReachFeet: number|null, feetPerPixel: number|null, partyPoint: {x: number, y: number}|null}}
 */
export function reachContext(formation, session) {
  const token = getPartyToken(freshOf(formation));
  const scene = token?.parent ?? null;
  const onScene = !!scene && (!session?.sceneId || scene.id === session.sceneId);
  const feet = scene ? sceneFeetPerCell(scene) : 0;
  const size = Number(scene?.grid?.size);
  return {
    searchReachFeet: trapFigures().searchFeet,
    feetPerPixel: feet > 0 && size > 0 ? feet / size : null,
    partyPoint: onScene ? tokenCentre(token, scene, token._source ?? token) : null,
  };
}

/** The document an entry points at, or null where it points at none, the document is gone or the reference is no uuid. */
function refDocOf(entry) {
  try {
    return entry.ref ? (fromUuidSync(entry.ref, { strict: false }) ?? null) : null;
  } catch {
    return null;
  }
}

/** The name the document an entry points at carries, or empty. */
const refName = (entry) => refDocOf(entry)?.name ?? "";

/** The picture the document an entry points at carries (an item's or an actor's image), or null; never a made-up one. */
export function refImageOf(entry) {
  const img = refDocOf(entry)?.img;
  return typeof img === "string" && img ? img : null;
}

/**
 * The plate name of each of these entries, by key: the document an entry points
 * at, else the word for its kind, told apart by order (`plateNames`). The names
 * are those of the entries handed in, so a seat is named only what it sees.
 * @returns {Map<string, string>}
 */
export function plateNamesOf(entries) {
  return plateNames(entries, { nameOf: refName, kindWord: (kind) => game.i18n.localize(`ACKS-LOCATION.sceneSearch.kind.${kind}`) });
}

/** The uuids a member's items answer to as a tool: the item's own and the one it was made from. */
export function toolsOf(actor) {
  const tools = new Set();
  for (const item of actor?.items?.contents ?? []) {
    for (const uuid of [item.uuid, item._stats?.compendiumSource, item.flags?.core?.sourceId]) if (typeof uuid === "string" && uuid) tools.add(uuid);
  }
  return [...tools];
}
