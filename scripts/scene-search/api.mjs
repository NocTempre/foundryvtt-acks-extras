/* global game, fromUuidSync */
/**
 * `acksExtras.sceneSearch`: the calls a scene screen makes. Opening and ending a
 * session are the Judge's alone; a player's call to either is refused with a
 * `scene:` reason, since the one relay that exists (the party's `plan` request)
 * carries a player's plan entry and nothing else. Assigning a member is a plan
 * lock, so a player assigns their own character through that relay and the Judge
 * is told, and a Judge's call locks the plan directly. For a player `ok: true`
 * means the request was declared to the Judge, who may still refuse it. The read calls answer
 * every seat, a player's through the projection that strips what is unfound.
 *
 * The turn plan, the party's request relay, the fight's record and a linked
 * table's draw are reached through `deps` so a suite supplies its own; the
 * module's wiring supplies the real ones.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";
import { thingsOf } from "../lib/place-things.mjs";
import { SEARCH_FLAG, normalizeRecord } from "../treasure/search-logic.mjs";
import { getFormation } from "../formation/formation-model.mjs";
import { ACTIVITY, LAYER, LAYER_OF_ACTIVITY, SCENE, SESSION_REFUSAL } from "./constants.mjs";
import { sceneOptionsFor } from "./activities.mjs";
import { dealSceneHaul } from "./haul.mjs";
import { sceneView, seatView } from "./scene-logic.mjs";
import { bodiesFromRecord, playerLog, sessionEntries } from "./session-logic.mjs";
import { readSession, readWorld, writeSession } from "./session.mjs";

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const isGM = () => !!game.user?.isGM;

/** Does this seat own the actor? A player's plan request for anyone else would be dropped by the relay without an answer, so it is refused here. */
const ownsActor = (actorId) => game.actors?.get(actorId)?.testUserPermission?.(game.user, "OWNER") ?? false;

/** The activity key a layer name is assigned through. */
const activityOf = (layer) => (layer === LAYER.METHODICAL ? ACTIVITY.METHODICAL : layer === LAYER.HASTY ? ACTIVITY.HASTY : null);

/** The place actor a uuid names, when it is a location. */
function locationOf(uuid) {
  try {
    const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    return doc?.documentName === "Actor" && doc.type === LOCATION_TYPE ? doc : null;
  } catch {
    return null;
  }
}

/**
 * The scene search api over its dependencies.
 * @param {object} deps
 * @param {{lockPlan: Function, unlockPlan: Function, planRefusal: Function, readPlan: Function}|(() => Promise<object>)} deps.plan `formation/turn-plan.mjs`, or a loader for it
 * @param {(formationId: string, type: string, payload: object) => Promise<*>} deps.request the party's `requestPartyAction`
 * @param {(messageId: string) => object|null} [deps.record] a fight's record by the search card's message id
 * @param {(partyId: string) => *} [deps.announce] tells the table's other seats the scene was shown (the module's socket)
 * @param {(draw: {messageId: string, name: string, tableUuid: string}) => Promise<object[]>} [deps.drawTable] draws a fallen creature's linked table and answers the card truths it dealt (the treasure feature's own draw)
 */
export function createSceneSearchApi({ plan, request, record = defaultRecord, announce = null, drawTable = null }) {
  const planOf = async () => (typeof plan === "function" ? plan() : plan);

  async function open({ partyId, placeUuid, sceneId = null, recordMessageId = null, sources = null, ...deal } = {}) {
    if (!isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    const place = locationOf(placeUuid);
    if (!place) return refuse(SESSION_REFUSAL.NO_PLACE);
    if (readSession(formation)) return refuse(SESSION_REFUSAL.SESSION_OPEN);

    const fight = recordMessageId ? normalizeRecord(record(recordMessageId)) : null;
    // A linked table is a roll, so it is drawn once the cheap refusals are past and only when the deal is the record's own.
    const drawn = {};
    if (fight && !Array.isArray(sources) && drawTable) {
      for (const body of fight.fallen) {
        if (body.combatantId && body.tableUuid) drawn[body.combatantId] = await drawTable({ messageId: recordMessageId, combatantId: body.combatantId, name: String(body.name ?? ""), tableUuid: body.tableUuid });
      }
    }
    const found = fight ? bodiesFromRecord(fight, { drawn }) : { bodies: [], sources: [] };
    const asked = Array.isArray(sources) ? sources : found.sources;
    const keys = new Set(sessionEntries({ things: thingsOf(place), session: { bodies: found.bodies, lots: [] } }).map((e) => e.key));
    const unknown = asked.find((s) => !keys.has(String(s?.thing ?? "").trim()));
    if (unknown) return refuse(SESSION_REFUSAL.UNKNOWN_ENTRY, { entry: unknown.thing });

    let potUuid = null;
    let lots = [];
    if (asked.length) {
      const dealt = await dealSceneHaul({ ...deal, sources: asked, scene: { sceneId, placeUuid }, partyId });
      if (!dealt.ok) return refuse(SESSION_REFUSAL.DEAL_FAILED, { detail: dealt.reason });
      potUuid = dealt.potUuid;
      lots = dealt.lots.map(({ key, thing, layer, cardId }) => ({ key, thing, layer, cardId }));
    }
    const session = { sceneId, placeUuid, recordMessageId, potUuid, shown: false, bodies: found.bodies, lots, log: [] };
    await writeSession(formation, session);
    return { ok: true, session: readSession(formation), potUuid };
  }

  async function end(partyId) {
    if (!isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    if (!readSession(formation)) return refuse(SESSION_REFUSAL.NO_SESSION);
    await writeSession(formation, null);
    return { ok: true };
  }

  /** Show the scene to the table: sets the session's `shown` flag and tells the other seats. Judge-only; pressing it again tells them again. */
  async function show(partyId) {
    if (!isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    const session = readSession(formation);
    if (!session) return refuse(SESSION_REFUSAL.NO_SESSION);
    await writeSession(formation, { ...session, shown: true });
    await announce?.(partyId);
    return { ok: true };
  }

  async function assign({ partyId, actorId, layer, entryKey } = {}) {
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    const key = activityOf(layer);
    if (!key) return refuse(SESSION_REFUSAL.NOT_OFFERED);
    const world = readWorld(formation);
    if (!world) return refuse(SESSION_REFUSAL.NO_SESSION);
    if (!seatView(world.entries, { isGM: isGM() }).some((e) => e.key === entryKey)) return refuse(SESSION_REFUSAL.UNKNOWN_ENTRY);
    if (!formation.members?.some((m) => m.actorId === actorId)) return refuse(SESSION_REFUSAL.NOT_A_MEMBER);
    if (!isGM() && !ownsActor(actorId)) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const turnPlan = await planOf();
    const asked = { actorId, key, option: entryKey, by: game.user.id };
    if (isGM()) {
      const locked = await turnPlan.lockPlan(formation, asked);
      return locked.ok ? { ok: true, entry: locked.entry } : refuse(locked.reason, { missing: locked.missing });
    }
    const refused = turnPlan.planRefusal(formation, asked);
    if (refused) return refuse(refused.reason, { missing: refused.missing });
    const answer = await request(formation.id, "plan", { actorId, key, option: entryKey });
    return answer?.ok === false ? refuse(answer.refused ?? `${SCENE}notOffered`) : { ok: true };
  }

  async function unassign({ partyId, actorId } = {}) {
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    if (!readSession(formation)) return refuse(SESSION_REFUSAL.NO_SESSION);
    if (!isGM() && !ownsActor(actorId)) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const turnPlan = await planOf();
    if (isGM()) return { ok: true, unlocked: await turnPlan.unlockPlan(formation, actorId) };
    await request(formation.id, "plan", { actorId, unlock: true });
    return { ok: true };
  }

  /** The session, its entries as this seat reads them, and the log; null with no session open. */
  function read(partyId) {
    const formation = getFormation(partyId);
    const world = formation ? readWorld(formation) : null;
    if (!world) return null;
    const { session, place, entries } = world;
    const { bodies: _bodies, lots, ...rest } = session;
    const seen = sceneView(entries, { isGM: isGM() });
    return {
      session: isGM() ? { ...rest, lots } : rest,
      place: { uuid: place.uuid, name: place.name },
      entries: seen,
      log: isGM() ? session.log : playerLog(session.log, seen.map((e) => e.key)),
    };
  }

  /**
   * A player's press of Round (`press: "round"`) or Spend a turn (`"turn"`): asks
   * the Judge through the party's relay, which announces it and moves no clock.
   * A Judge presses for themself, so their call is refused.
   */
  async function ask({ partyId, press } = {}) {
    if (isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const formation = getFormation(partyId);
    if (!formation) return refuse(SESSION_REFUSAL.NO_PARTY);
    if (!readSession(formation)) return refuse(SESSION_REFUSAL.NO_SESSION);
    if (press !== "round" && press !== "turn") return refuse(SESSION_REFUSAL.NOT_OFFERED);
    await request(formation.id, "askPress", { press });
    return { ok: true };
  }

  /** Who is assigned to which entry and layer: the plan's scene entries, `[{actorId, layer, entryKey, remaining, resolved}]`. */
  async function assignments(partyId) {
    const formation = getFormation(partyId);
    const turnPlan = await planOf();
    const world = formation ? readWorld(formation) : null;
    const seen = world ? new Set(sceneView(world.entries, { isGM: isGM() }).map((e) => e.key)) : null;
    return Object.entries(formation ? turnPlan.readPlan(formation) : {})
      .filter(([, entry]) => entry?.key in LAYER_OF_ACTIVITY && (isGM() || seen?.has(entry.option)))
      .map(([actorId, entry]) => ({ actorId, layer: LAYER_OF_ACTIVITY[entry.key], entryKey: entry.option, remaining: entry.remaining, resolved: entry.resolvedTurn != null }));
  }

  /** What one member may attempt at every entry this seat can see (`layerOptions`' rows). */
  function options({ partyId, actorId } = {}) {
    const formation = getFormation(partyId);
    const actor = game.actors?.get(actorId);
    return formation && actor ? sceneOptionsFor(formation, actor) : [];
  }

  return { open, end, show, assign, unassign, ask, read, assignments, options };
}

/** The api over the real dependencies, made once at init by `configureSceneSearchApi`. */
let live = null;

/**
 * Make the module's api over its real dependencies; the module's wiring calls
 * it once, at init, before `acksExtras.sceneSearch` is assigned.
 * @param {object} deps as `createSceneSearchApi` takes them
 */
export function configureSceneSearchApi(deps) {
  live = createSceneSearchApi(deps);
}

/** Open a session at a place for a party and deal its haul (`createSceneSearchApi`'s `open`). Judge-only. */
export const openSceneSearch = (args) => live.open(args);

/** Show the scene to the table (`createSceneSearchApi`'s `show`). Judge-only. */
export const showSceneSearch = (partyId) => live.show(partyId);

/** End the party's session (`createSceneSearchApi`'s `end`). Judge-only. */
export const endSceneSearch = (partyId) => live.end(partyId);

/** Assign a member to an entry's layer: a plan lock, or a player's declaration through the relay. */
export const assignSceneCheck = (args) => live.assign(args);

/** Take a member's scene assignment off the plan. */
export const unassignSceneCheck = (args) => live.unassign(args);

/** A player's Round or Spend a turn press, asked of the Judge through the party's relay. */
export const askScenePress = (args) => live.ask(args);

/** The session, its entries as this seat reads them, and the log; null with no session open. */
export const readSceneSearch = (partyId) => live.read(partyId);

/** Who is assigned to which entry and layer, `[{actorId, layer, entryKey, remaining, resolved}]`. */
export const sceneAssignments = (partyId) => live.assignments(partyId);

/** What one member may attempt at every entry this seat can see. */
export const sceneOptions = (args) => live.options(args);

/** A fight's record from the search card's message. */
function defaultRecord(messageId) {
  return game.messages?.get(messageId)?.flags?.[MODULE_ID]?.[SEARCH_FLAG] ?? null;
}
