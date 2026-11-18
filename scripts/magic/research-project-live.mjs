/* global game, foundry, fromUuidSync, ui */
/**
 * Research projects as the live world has them (`research-project.mjs` is the
 * model): the flag on the location, the characters linked to it, the imported
 * tables, the write a seat makes or asks the GM's client to make, and the API the
 * crediting, outcome and ritual slices call. Magic owns the record; the location
 * sheet hosts its tab (`research-tab.mjs`).
 */
import { MODULE_ID, LANG_PREFIX, FLAG_MAGIC, PROJECT_HANDLER } from "./constants.mjs";
import { PROJECT_KIND, PROJECT_KINDS, FACILITY, FACILITY_KEYS, PROJECT_OP, KIND_FACILITIES, UPDATE_FIELDS, projectOps, readRecord, facilityVerdicts, facilityGate, linksFor, openProjects } from "./research-project.mjs";
import { readResearchTables } from "./research-tables.mjs";
import { dayOfWorldTime } from "../lib/world-time.mjs";
import { isLocation, rosterFor } from "../lib/place.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

/** A string of the research lang group. */
export const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.research.${key}`, data ?? {});

/** The documents of a uuid that resolves, else null; a uuid into an unloaded pack throws. */
function resolve(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/**
 * The characters linked to a location: its roster, stored rows and the tokens on
 * its scene, whatever the viewer may see, resolved to the character actors still
 * in the world. The record's researchers are picked from these.
 * @returns {{uuid: string, name: string, img: string}[]}
 */
export function linkedCharacters(location) {
  const scene = resolve(location?.system?.sceneUuid);
  const out = [];
  for (const row of rosterFor(location, { scene: scene?.documentName === "Scene" ? scene : null, isGM: true })) {
    const actor = resolve(row.uuid);
    if (actor?.documentName === "Actor" && actor.type === ACTOR_TYPE.character) out.push({ uuid: actor.uuid, name: actor.name, img: actor.img ?? "" });
  }
  return out;
}

/** The dependencies of `projectOps` as this client has them. */
export const liveDeps = () => ({
  read: (location) => location?.flags?.[MODULE_ID]?.[FLAG_MAGIC],
  write: (location, patch) => location.update(Object.fromEntries(Object.entries(patch).map(([key, value]) => [`flags.${MODULE_ID}.${FLAG_MAGIC}.${key}`, value]))),
  // Whether Foundry lets this user write the location, never whether the user owns it: a GM writes every actor.
  canWrite: (location) => location?.canUserModify?.(game.user, "update") === true,
  // Undefined with no GM to ask, which `projectOps` reports as not written.
  relay: async (request) => {
    if (game.user.isGM || !game.users.activeGM) return undefined;
    const { executeAsGM } = await import("../lib/sockets.mjs");
    return executeAsGM(PROJECT_HANDLER, request);
  },
  today: () => dayOfWorldTime(game.time.worldTime),
  isJudge: () => game.user.isGM === true,
  owns: (uuid) => game.user.isGM === true || resolve(uuid)?.testUserPermission?.(game.user, "OWNER") === true,
  linked: (location) => linkedCharacters(location).map((a) => a.uuid),
  tables: () => readResearchTables(),
  newId: () => foundry.utils.randomID(),
});

const ops = () => projectOps(liveDeps());

/** The location's record, cleaned. */
export const recordOf = (location) => readRecord(liveDeps().read(location));

/**
 * The GM's client runs a request a seat could not write, after it checks who
 * sent it: the sender Foundry attested, never what the payload says. The
 * authority is the sender's, so a Player's request keeps a Player's rules there.
 */
export async function projectHandler(payload = {}) {
  const { judgeDeclares } = await import("../lib/sockets.mjs");
  const location = resolve(payload.locationUuid);
  if (!isLocation(location)) return { ok: false, reason: "noLocation" };
  if (!Object.values(PROJECT_OP).includes(payload.op)) return { ok: false, reason: "op" };
  const fromJudge = judgeDeclares(payload.requestUserId);
  const user = game.users.get(payload.requestUserId);
  const owns = (uuid) => fromJudge || resolve(uuid)?.testUserPermission?.(user, "OWNER") === true;
  return ops().apply(location, payload.op, payload.args ?? {}, { judge: fromJudge, owns });
}

let registered = false;

/** Register the record's relay handler. Once, at `init`. */
export function registerProjects() {
  if (registered) return;
  registered = true;
  void import("../lib/sockets.mjs").then(({ registerHandler }) => registerHandler(PROJECT_HANDLER, projectHandler));
}

/** Tell the user what a refused or warned write came to. */
export function announce(result) {
  if (!result) return;
  if (result.ok === false) ui.notifications?.warn(loc(`refused.${result.reason}`));
  else if (result.warn) ui.notifications?.warn(loc(`warn.${result.warn}`));
}

/** Every location in the world with the open projects it holds, for a character's links. */
function worldEntries() {
  return (game.actors ?? []).filter(isLocation).map((location) => ({ location: { uuid: location.uuid, name: location.name }, projects: recordOf(location).projects }));
}

/**
 * The research API, `acksExtras.magic.research`: what the crediting, outcome and
 * ritual slices read and write. Every write answers `{ok, ...}`; a refusal is
 * `{ok: false, reason}` and a Judge's project below its facility is
 * `{ok: true, warn: "facility"}`.
 */
export const researchApi = {
  KIND: PROJECT_KIND,
  KINDS: PROJECT_KINDS,
  FACILITY,
  FACILITY_KEYS,
  OP: PROJECT_OP,
  KIND_FACILITIES,
  UPDATE_FIELDS,
  /** The location's record, cleaned: `{facilities: {library, workshop}, projects}`. */
  read: recordOf,
  /** The open projects of a location. */
  open: (location) => openProjects(recordOf(location).projects),
  /** The characters linked to a location: `[{uuid, name, img}]`. */
  linked: linkedCharacters,
  /** What each facility a project reads says of it: share, minimum, verdict and bonus (`facilityVerdicts`). */
  verdicts(location, id) {
    const record = recordOf(location);
    const project = record.projects.find((p) => p.id === id);
    return project ? facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables: readResearchTables() }) : [];
  },
  /** Whether a project may stand at its facilities for the user asking: `{ok, warn?}` or `{ok: false, reason}`. */
  gate(location, id) {
    return facilityGate(researchApi.verdicts(location, id), { judge: game.user.isGM === true });
  },
  /** A project started: `create(location, {kind, subject, level, researcher, assistants})`; a Judge's carries `costs`, `paid` and `throw`. */
  create: (location, spec) => ops().create(location, spec),
  /** A project's fields changed: `update(location, id, patch)`, the patch's keys from `UPDATE_FIELDS`. */
  update: (location, id, patch) => ops().update(location, id, patch),
  /** A project closed; it stays on the record and counts for no facility. */
  close: (location, id) => ops().close(location, id),
  /** A facility's value in gold, null to blank it (the Judge's). */
  setFacility: (location, key, gp) => ops().setFacility(location, key, gp),
  /** The projects an actor is on, across the world's locations, as its sheet links to them. Nothing is written on the actor. */
  projectsOf: (actor) => linksFor(worldEntries(), actor?.uuid),
};
