/* global game, foundry, fromUuidSync, ui, Hooks */
/**
 * Research projects as the live world has them (`research-project.mjs` is the
 * model): the flag on the location, the characters linked to it, the imported
 * tables, the write a seat makes or asks the GM's client to make, the credit of the days
 * world time has passed, and the API the outcome and ritual slices call. Magic owns the
 * record; the location sheet hosts its tab (`research-tab.mjs`).
 *
 * Posted days are credited by one client: the primary GM's, on every step the world clock
 * moves forward (lib `onWorldTimeAdvanced`) and once at `ready`. `credit` is a function of
 * the record and the day the clock stands in, and it never credits a (day, participant)
 * twice (`creditDue`), so a second run, a clock dragged back and forward again, or a request
 * from another seat only ever finds nothing due.
 *
 * A project is finished by `finish` (`research-outcome-live.mjs` writes the result): where this seat may
 * write everything it touches it runs here, otherwise the GM's client runs it for the sender.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_MAGIC, PROJECT_HANDLER } from "./constants.mjs";
import { PROJECT_KIND, PROJECT_KINDS, FACILITY, FACILITY_KEYS, PROJECT_OP, PACE, PACES, KIND_FACILITIES, UPDATE_FIELDS, RANGE_MAX, THROW_DIE, COMPONENT_FIT, projectOps, readRecord, facilityVerdicts, facilityGate, linksFor, openProjects, progressOf, daysText, throwPlan, subjectRef, knowsFormula } from "./research-project.mjs";
import { outcomeDeps, canFinish, projectEntries, formulasOf, cookbookOf, subjectTypeOf } from "./research-outcome-live.mjs";
import { readResearchTables } from "./research-tables.mjs";
import { dayOfWorldTime, onWorldTimeAdvanced } from "../lib/world-time.mjs";
import { primaryGMSettled } from "../lib/util.mjs";
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

/** A participant's class level, whole and at least zero; null where the actor or the level is not there. */
export function levelOf(uuid) {
  const level = Number(resolve(uuid)?.system?.details?.level);
  return Number.isFinite(level) && level >= 0 ? Math.trunc(level) : null;
}

/**
 * A participant's Intellect bonus, null where the actor or the figure is not there: an unread bonus is never taken for
 * zero (the throw holds on it); the assistants' capacity reads it as zero (`weighParticipants`).
 */
export const intBonusOf = (uuid) => {
  const mod = resolve(uuid)?.system?.scores?.int?.mod;
  return mod === null || mod === undefined || mod === "" || !Number.isFinite(Number(mod)) ? null : Number(mod);
};

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
  levelOf,
  intBonusOf,
  tables: () => readResearchTables(),
  newId: () => foundry.utils.randomID(),
  canFinish,
  outcome: outcomeDeps(),
});

export { projectEntries, formulasOf, cookbookOf, subjectTypeOf };

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

/**
 * Credit the posted days world time has passed on every location in the world, as this
 * client (which must be the primary GM's) writes them. Answers how many days it credited;
 * a location with no day due is neither read against the tables nor written.
 */
export async function creditPassedDays() {
  const today = liveDeps().today();
  let credited = 0;
  for (const location of (game.actors ?? []).filter(isLocation)) {
    if (!recordOf(location).projects.some((p) => p.status === "open" && p.posted.some((row) => row.day < today))) continue;
    const done = await ops().credit(location);
    credited += done?.credited ?? 0;
  }
  return credited;
}

let registered = false;

/**
 * Register the record's relay handler and the credit of passed days: on the primary GM's
 * client alone (the lib watcher's own gate), at each forward step of the world clock and
 * once at `ready`. Once, at `init`.
 */
export function registerProjects() {
  if (registered) return;
  registered = true;
  void import("../lib/sockets.mjs").then(({ registerHandler }) => registerHandler(PROJECT_HANDLER, projectHandler));
  const sweep = () => creditPassedDays().catch((err) => console.error(`${MODULE_ID} | crediting research days failed`, err));
  onWorldTimeAdvanced(() => void sweep());
  Hooks.once("ready", async () => {
    if (await primaryGMSettled()) void sweep();
  });
}

/** Tell the user what a refused or warned write came to. */
export function announce(result) {
  if (!result) return;
  if (result.ok === false) ui.notifications?.warn(loc(`refused.${result.reason}`));
  else {
    for (const warn of result.warns ?? (result.warn ? [result.warn] : [])) ui.notifications?.warn(loc(`warn.${warn}`));
    // A range names the days it posted and the days it skipped.
    if (Array.isArray(result.posted)) {
      const skipped = result.skipped ?? [];
      const key = result.posted.length ? (skipped.length ? "postedSkipped" : "postedRange") : "postedNone";
      ui.notifications?.info(loc(key, { posted: daysText(result.posted), skipped: daysText(skipped) }));
    }
  }
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
  PACE,
  PACES,
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
  /**
   * A project's fields changed: `update(location, id, patch)`, the patch's keys from `UPDATE_FIELDS`. `common` is a Judge's boolean on a spell
   * project (a Player's write is refused `judge`, another kind's `field`); a common spell is finished with no throw.
   */
  update: (location, id, patch) => ops().update(location, id, patch),
  /** A project closed; it stays on the record and counts for no facility. */
  close: (location, id) => ops().close(location, id),
  /**
   * A day posted: `post(location, id, {pace, day})`, the pace one of `PACES` (dedicated by default) and the
   * day the calendar day the world clock stands in unless a Judge names another. A Player's day is today. A
   * facility below its minimum, or an assistant who does not count, blocks a Player and warns a Judge.
   * Answers `{ok, id, day, pace, warn?, warns?}`.
   */
  post: (location, id, options) => ops().post(location, id, options),
  /**
   * A Judge's range of days posted: `postRange(location, id, {pace, from, days})`, `days` a whole number from one to
   * `RANGE_MAX` and `from` the first calendar day (today unless named). Each day is posted once; a day already posted
   * or credited is skipped. A Player's request is refused (`judge`). The facility and assistant warnings are read once.
   * Answers `{ok, id, pace, posted: [days], skipped: [days], warn?, warns?}`; nothing is written where every day is skipped.
   */
  postRange: (location, id, options) => ops().postRange(location, id, options),
  RANGE_MAX,
  /**
   * A posted day taken back: `withdraw(location, id, day)`. A Judge withdraws any posted day, a Player a posted day of a
   * project of a character they own; a credited day is never taken back (`credited`), and a day not posted is `notPosted`.
   */
  withdraw: (location, id, day) => ops().withdraw(location, id, day),
  /**
   * The posted days world time has passed, credited (`{ok, credited}`, the number of days): one project when
   * `id` is given, else every open project the caller may act on. The primary GM's client calls it for the world
   * on each clock step; a second call finds nothing due.
   */
  credit: (location, id) => ops().credit(location, id),
  /**
   * Where a project stands: gold and days credited, days posted, what each participant adds, the due (`dueDays`,
   * `dueDay`, `dueBy` "ladder", "judge" or null) and whether the research cost is credited (`complete`, null
   * where unknown). Null for a project that is not on the location.
   */
  progress(location, id) {
    const project = recordOf(location).projects.find((p) => p.id === id);
    const deps = liveDeps();
    return project ? progressOf(project, { today: deps.today(), tables: deps.tables(), levelOf, intBonusOf }) : null;
  },
  /** The calendar day the due falls on for a project, or null where the due is not known (`progress().dueDay`). */
  dueDay: (location, id) => researchApi.progress(location, id)?.dueDay ?? null,
  /** A facility's value in gold, null to blank it (the Judge's). */
  setFacility: (location, key, gp) => ops().setFacility(location, key, gp),
  /**
   * A project finished: `finish(location, id)` throws the research throw (a natural `THROW_DIE` and the throw's modifiers
   * against the target), closes the project with the outcome stamped, and on success writes the result by kind: a known item
   * delivered to the researcher, a known spell added to their repertoire, an item marked fully identified, or a blank
   * document made and opened for the Judge where the subject names none; a spell or an item's formula is recorded on the
   * researcher. The components bucket is settled on every outcome and the result is one chat card. It is refused (`notComplete`,
   * `componentsShort`, `throwUnread`, `intUnread`, `bonusUnread`, `penaltyUnread`, `ritual`, `subject`, `bucketOwner`, `subjectOwner`) before anything is rolled or written, and a Player's
   * request keeps a Player's rules where the GM's client runs it. A project with no throw to make (an item whose formula is known and applied, or a spell the Judge marked `common` through `update`) rolls
   * nothing and succeeds. Answers `{ok, id, outcome, die, total, target, auto, modifier, formula, noThrow, written, failed, settled}`
   * (`die`, `total` and `target` null with no throw).
   */
  finish: (location, id) => ops().finish(location, id),
  /**
   * The throw as the project stands, `{target, by, levelRaise, int, intUnread, bonus, bonusRead, bonusUnread, share, substituted,
   * penalty, penaltyUnread, modifier, formula: {known, used}, noThrow, components}` (`throwPlan`); null for a project that is not on the location.
   */
  async plan(location, id) {
    const record = recordOf(location);
    const project = record.projects.find((p) => p.id === id);
    if (!project) return null;
    const tables = liveDeps().tables();
    const known = knowsFormula(formulasOf(project.researcher), project.kind, subjectRef(project.subject, cookbookOf(project.subject.uuid)));
    const verdicts = facilityVerdicts(project, { facilities: record.facilities, projects: record.projects, tables });
    return throwPlan(project, { tables, levelOf, intBonusOf, verdicts, entries: await projectEntries(project), known });
  },
  /** The formulas an actor has researched, `[{kind, key, name, uuid, cookbookId, day, project}]`. */
  formulas: (actor) => formulasOf(actor?.uuid),
  THROW_DIE,
  COMPONENT_FIT,
  /** The projects an actor is on, across the world's locations, as its sheet links to them. Nothing is written on the actor. */
  projectsOf: (actor) => linksFor(worldEntries(), actor?.uuid),
};
