/* global game, ui */
/**
 * What carries each member of a party on a journey, and the arrangement that
 * gives each the fastest ride they have. The attachment (`lib/attachment.mjs`)
 * stays the one record of who is on what; this file only decides, and it
 * writes through `mountActor` and `attach` as a hand would. A member's own say
 * is the `conveyance` flag on their actor, `{ pinned }`: `ON_FOOT` or a
 * carrier's uuid, held against the arrangement.
 *
 * A carrier counts for a member when a player who owns the member also owns
 * the carrier, in the train or not; a vehicle already under a member counts for
 * the whole party. A member no player owns has only the second.
 *
 * Reading (`bestConveyance`, `offersFor`) is synchronous and writes nothing.
 * The group's presses (`arrangeFastest`, `setGroupMovement`, `undoArrangement`)
 * and a member's own (`chooseConveyance`) run on a GM's client. Each move goes
 * in slowest first and re-reads the holds, so a wagon's tier and free room are
 * the load already boarded.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { ATTACH_FLAG, attach, attachmentOf, carrierChain, carrierOf, detach, snapshotArrangement } from "../lib/attachment.mjs";
import { dismount, mountActor, riderOf } from "../lib/mount.mjs";
import { borneBy6, capacity6, load6 } from "../lib/capacity.mjs";
import { isGroupActor } from "../lib/group-logic.mjs";
import { resolveActorSync } from "../lib/storage.mjs";
import { VEHICLE_TYPE } from "../vehicles/constants.mjs";
import { canEnter } from "../vehicles/vehicle-speed.mjs";
import { deploymentOf } from "../vehicles/deploy.mjs";
import { holdOf } from "../vehicles/hold.mjs";
import { passengerCost } from "../vehicles/boarding.mjs";
import { ROLES } from "./constants.mjs";
import {
  carriedLoad,
  carrierSpeedFor,
  explorationSpeedOf,
  getFormation,
  getFormations,
  getMemberActor,
  isCasualty,
  isPerson,
  memberPace,
  patchFormation,
  realMembers,
  syncPartyActorSpeed,
} from "./formation-model.mjs";
import { isMemberDeployed } from "./deployment.mjs";
import { storedTravelOf, travelOf } from "./travel.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The actor flag holding a member's own say: `{ pinned }`. */
export const CONVEYANCE_FLAG = "conveyance";

/** A pin on the member's own legs, and a member's press that hands the choice back. */
export const ON_FOOT = "foot";
export const AUTOMATIC = "auto";

/** The attachments an arrangement may undo. A station or a harness is a job, and cargo is freight. */
const RIDING_ROLES = Object.freeze(["rider", "passenger"]);

const isRidingRole = (role) => RIDING_ROLES.includes(role);

/** Whether an actor update moved a seat or a pin. A deletion's key carries a prefix, so the ends are read. */
export function seatChanged(changes) {
  const keys = Object.keys(changes?.flags?.[MODULE_ID] ?? {});
  return keys.some((key) => key.endsWith(ATTACH_FLAG) || key.endsWith(CONVEYANCE_FLAG));
}

/** What a member holds to: `ON_FOOT`, a carrier's uuid, or null for the arrangement's pick. */
export function pinOf(actor) {
  const pinned = actor?.getFlag?.(MODULE_ID, CONVEYANCE_FLAG)?.pinned;
  return typeof pinned === "string" && pinned ? pinned : null;
}

/**
 * Why nothing moves this member, or null where something may. Each is a lang
 * key under `conveyance.held`. A body that is not a person walks where it is
 * led, a Carrier's load is on their own back, and a member out on the map is
 * under their own token.
 */
export function heldReason(member, actor, load) {
  if (!isPerson(actor) && !isGroupActor(actor)) return "notPerson";
  if (member.left) return "left";
  if (isMemberDeployed(member)) return "deployed";
  if (isCasualty(actor, member)) return "casualty";
  if (load.down.length && member.roles?.includes(ROLES.CARRIER)) return "hauling";
  const at = attachmentOf(actor);
  return at && !isRidingRole(at.role) ? "station" : null;
}

/** Whether the wheels of `carrier` can roll in the country `t` reads: `canEnter`'s verdict. */
export function wheelsEnter(carrier, t) {
  return canEnter(carrier.system, t.ground, {
    road: t.road,
    mud: t.weather.footing?.mud ?? "none",
    snow: !!t.weather.footing?.snow,
  });
}

const playersOf = (actor) => game.users.filter((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER"));

/** Every actor that could carry a member: a mountable beast or a vehicle, each with its players' ids. */
export function carrierPool() {
  const pool = [];
  for (const actor of game.actors.contents) {
    const vehicle = actor.type === VEHICLE_TYPE;
    if (!vehicle && !actor.system?.animal?.mountable) continue;
    if (isGroupActor(actor)) continue;
    pool.push({ actor, vehicle, owners: new Set(playersOf(actor).map((u) => u.id)) });
  }
  return pool;
}

/** The uuids of the vehicles already under a member of this party. */
function vehiclesUnder(formation) {
  const uuids = new Set();
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor) continue;
    for (const carrier of carrierChain(actor)) if (carrier.type === VEHICLE_TYPE) uuids.add(carrier.uuid);
  }
  return uuids;
}

const kindOf = (carrier) => {
  if (carrier.type !== VEHICLE_TYPE) return "animal";
  return carrier.system?.kind === "land" ? "land" : "vessel";
};

/**
 * What one carrier offers a member, or null where it cannot take them: a pick
 * `{ carrier, role, kind, speed }`, `kind` being `animal`, `land` or `vessel`.
 * A vessel's speed is null, its clock not being a march's (`carrierSpeedFor`).
 * A wagon quotes its pace with this member aboard, so taking the offer cannot
 * land them below the figure that won it.
 */
function offerOf(entry, actor, formation, t) {
  const carrier = entry.actor;
  if (carrier.uuid === actor.uuid || carrierChain(carrier).some((c) => c.uuid === actor.uuid)) return null;
  const aboard = attachmentOf(actor)?.uuid === carrier.uuid;
  if (entry.vehicle) {
    if (deploymentOf(carrier) || !wheelsEnter(carrier, t).ok) return null;
    const adding = aboard ? 0 : passengerCost(actor);
    if (holdOf(carrier).free < adding) return null;
    return { carrier, role: "passenger", kind: kindOf(carrier), speed: carrierSpeedFor(carrier, formation, { adding }) };
  }
  if (isGroupActor(actor) || attachmentOf(carrier)) return null;
  const rider = riderOf(carrier);
  if (rider && rider.uuid !== actor.uuid) return null;
  const capacity = capacity6(carrier);
  if (!rider && capacity != null && load6(carrier) + borneBy6(actor) > capacity) return null;
  return { carrier, role: "rider", kind: "animal", speed: carrierSpeedFor(carrier, formation) };
}

/** Every pick this member's carriers offer, in the pool's order. */
export function offersFor(actor, formation, { pool = carrierPool(), t = travelOf(formation) } = {}) {
  const players = new Set(playersOf(actor).map((u) => u.id));
  const train = vehiclesUnder(formation);
  return pool
    .filter((entry) => train.has(entry.actor.uuid) || [...entry.owners].some((id) => players.has(id)))
    .map((entry) => offerOf(entry, actor, formation, t))
    .filter(Boolean);
}

/** A pick in words: "on foot", "riding {name}". */
export const rideLabel = (pick) => (pick.carrier ? loc(`conveyance.how.${pick.kind}`, { name: pick.carrier.name }) : loc("conveyance.how.foot"));

const footPick = (actor) => ({ carrier: null, role: null, kind: "foot", speed: explorationSpeedOf(actor) });

/** What the member is on now, as a pick. Their pace is `memberPace`'s, so a chain answers at its root. */
export function rideOf(formation, member, actor, load = carriedLoad(formation)) {
  const at = attachmentOf(actor);
  const carrier = at ? carrierOf(actor) : null;
  const speed = memberPace(formation, member, actor, load);
  return carrier ? { carrier, role: at.role, kind: kindOf(carrier), speed } : { ...footPick(actor), speed };
}

const isMoving = (pick) => typeof pick.speed === "number" && pick.speed > 0;

/** The faster pick, the animal winning a tie: it carries one, and a wagon's room is the party's. */
const fasterOf = (a, b) => {
  if (!a || b.speed > a.speed) return b;
  return a.speed === b.speed && a.kind !== "animal" && b.kind === "animal" ? b : a;
};

/**
 * The fastest ride this actor has, ignoring any pin: a pick, the current one
 * unless something is strictly faster, so a tie never moves anyone. A member
 * aboard a vessel stays: its pace is on another clock, and leaving is a word.
 * @param {Actor} actor
 * @param {object} formation
 * @param {object} [o]
 * @param {Array} [o.pool] a `carrierPool()` read for a whole pass
 * @param {object} [o.t] the `travelOf` read for a whole pass
 */
export function bestConveyance(actor, formation, { pool = carrierPool(), t = travelOf(formation) } = {}) {
  const member = formation.members.find((m) => m?.actorId === actor.id);
  const here = rideOf(formation, member, actor);
  if (here.kind === "vessel") return here;
  const top = offersFor(actor, formation, { pool, t }).filter(isMoving).reduce(fasterOf, null);
  return top && top.speed > (Number(here.speed) || 0) ? top : here;
}

/**
 * What the arrangement gives a member: their pin where it can be honoured,
 * otherwise the fastest. A pin on a carrier that cannot take them leaves them
 * where they are rather than handing them the fastest they refused.
 */
function arrangedPick(actor, formation, o) {
  const pinned = pinOf(actor);
  if (!pinned) return bestConveyance(actor, formation, o);
  if (pinned === ON_FOOT) return footPick(actor);
  return offersFor(actor, formation, o).find((pick) => pick.carrier.uuid === pinned) ?? null;
}

const sameRide = (actor, pick) => (attachmentOf(actor)?.uuid ?? null) === (pick.carrier?.uuid ?? null);

/** Move one member onto a pick, through the same writers a hand uses. */
async function seat(actor, pick) {
  if (pick.role === "rider") {
    await mountActor(actor, pick.carrier);
    return;
  }
  if (attachmentOf(actor)?.role === "rider") await dismount(actor);
  if (pick.carrier) await attach(actor, pick.carrier, pick.role);
  else await detach(actor);
}

/**
 * Run a pass over the party. `decide(actor)` answers a pick or null to leave
 * them be; the members go slowest first, since that member is the one holding
 * the party back, and every move re-reads the holds. The arrangement is
 * snapshotted before the first move and not at all when nobody moves, so a
 * dawn that changes nothing keeps the snapshot a Judge may still want.
 *
 * `only` narrows the pass to one actor id.
 * @returns {Promise<string[]>} the names of the members who moved
 */
async function runPass(formationId, decide, { only = null } = {}) {
  const record = getFormation(formationId);
  if (!record) return [];
  const load = carriedLoad(record);
  const everyone = realMembers(record)
    .map((member) => ({ member, actor: getMemberActor(member) }))
    .filter((e) => e.actor);
  const going = everyone
    .filter((e) => !heldReason(e.member, e.actor, load) && (!only || e.actor.id === only))
    .map((e) => ({ ...e, pace: Number(memberPace(record, e.member, e.actor, load)) || 0 }))
    .sort((a, b) => a.pace - b.pace);

  const moved = [];
  let snapped = false;
  for (const { actor } of going) {
    const pick = decide(actor);
    if (!pick || sameRide(actor, pick)) continue;
    if (!snapped) {
      snapped = true;
      const members = everyone.map((e) => e.actor.uuid);
      const rows = snapshotArrangement(everyone.map((e) => e.actor));
      await patchFormation(formationId, (rec) => {
        const cur = storedTravelOf(rec);
        rec.travel = { ...cur, lastArrangement: { members, rows, set: cur.movement.set } };
      });
    }
    await seat(actor, pick);
    moved.push(actor.name);
  }
  return moved;
}

/** Write the Judge's word for the group, leaving the rest of the record as it stands. */
function writeSet(formationId, set) {
  return patchFormation(formationId, (rec) => {
    const cur = storedTravelOf(rec);
    rec.travel = { ...cur, movement: { ...cur.movement, set } };
  });
}

/** After a pass: the party actor's pace follows, and the speed sync writes what the sheets read. */
async function settlePass(formationId) {
  const record = getFormation(formationId);
  if (record) await syncPartyActorSpeed(record);
}

/**
 * Fastest for all, and the way back to automatic: every member takes their pin
 * or the fastest they have, and the Judge's word for the group clears.
 */
export async function arrangeFastest(formationId) {
  const record = getFormation(formationId);
  if (!record) return [];
  const o = { pool: carrierPool(), t: travelOf(record) };
  const moved = await runPass(formationId, (actor) => arrangedPick(actor, getFormation(formationId), o));
  await writeSet(formationId, null);
  await settlePass(formationId);
  return moved;
}

/** The kinds of carrier a group tile puts the party on, keyed by the mode it sets. */
const TILE_KINDS = Object.freeze({ mounted: "animal", vehicle: "land", vessel: "vessel" });

/**
 * A group tile: the Judge's word for the whole party, which outranks a pin for
 * as long as it stands. On foot takes everyone off everything, and the
 * carrying tiles put each member on the fastest of that kind they have, or
 * leave them as they are. Flying moves nobody: hours aloft are declared. A
 * press with no boat to board stands as the word alone.
 * @param {string} formationId
 * @param {string} mode a key of `MOVEMENT_MODES`
 * @returns {Promise<string[]>} the names of the members who moved
 */
export async function setGroupMovement(formationId, mode) {
  const record = getFormation(formationId);
  if (!record) return [];
  const o = { pool: carrierPool(), t: travelOf(record) };
  const kind = TILE_KINDS[mode];
  const decide = (actor) => {
    if (mode === "foot") return footPick(actor);
    if (!kind) return null;
    const live = getFormation(formationId);
    const here = attachmentOf(actor);
    const offers = offersFor(actor, live, o).filter((pick) => pick.kind === kind);
    if (here && offers.some((pick) => pick.carrier.uuid === here.uuid)) return null;
    if (kind === "vessel") return offers[0] ?? null;
    return offers.filter(isMoving).reduce(fasterOf, null);
  };
  const moved = await runPass(formationId, decide);
  await writeSet(formationId, mode);
  await settlePass(formationId);
  return moved;
}

/**
 * Put the arrangement back as the last group pass found it, the word for the
 * group with it. A snapshot holds only those who were attached, so a member
 * absent from its rows was on foot and comes off what the pass gave them. Only
 * riders and passengers are touched: no pass moves anyone else.
 * @returns {Promise<number|null>} the members moved back, null with nothing to undo
 */
export async function undoArrangement(formationId) {
  const record = getFormation(formationId);
  const last = record ? travelOf(record).lastArrangement : null;
  if (!last) return null;
  const rows = new Map((last.rows ?? []).map((row) => [row.actor, row]));
  let restored = 0;
  for (const uuid of last.members ?? []) {
    const actor = resolveActorSync(uuid);
    if (!actor) continue;
    const row = rows.get(uuid) ?? null;
    const at = attachmentOf(actor);
    if ((at && !isRidingRole(at.role)) || (row && !isRidingRole(row.role))) continue;
    if (!row) {
      if (!at) continue;
      await seat(actor, footPick(actor));
      restored++;
      continue;
    }
    if (at?.uuid === row.uuid && at?.role === row.role) continue;
    const carrier = resolveActorSync(row.uuid);
    if (!carrier) continue;
    await seat(actor, { carrier, role: row.role });
    restored++;
  }
  await patchFormation(formationId, (rec) => {
    const cur = storedTravelOf(rec);
    rec.travel = { ...cur, lastArrangement: null, movement: { ...cur.movement, set: last.set ?? null } };
  });
  await settlePass(formationId);
  return restored;
}

/**
 * A member's own press: `AUTOMATIC` hands the choice back and takes the
 * fastest, `ON_FOOT` or a carrier's uuid moves them there and holds it. A uuid
 * that is not on the member's offers, a member held by `heldReason`, or a party
 * in a fight changes nothing.
 * @returns {Promise<{pick: object, pinned: string|null}|null>} what landed, null for a refusal
 */
export async function chooseConveyance(formationId, actorId, choice) {
  const record = getFormation(formationId);
  const member = record?.members.find((m) => m?.actorId === actorId);
  const actor = member ? getMemberActor(member) : null;
  if (!actor || record.combat?.active || heldReason(member, actor, carriedLoad(record))) return null;
  const o = { pool: carrierPool(), t: travelOf(record) };
  let pick;
  if (choice === AUTOMATIC) pick = bestConveyance(actor, record, o);
  else if (choice === ON_FOOT) pick = footPick(actor);
  else pick = offersFor(actor, record, o).find((offer) => offer.carrier.uuid === choice) ?? null;
  if (!pick) return null;
  const pinned = choice === AUTOMATIC ? null : choice;
  await actor.setFlag(MODULE_ID, CONVEYANCE_FLAG, { pinned });
  if (!sameRide(actor, pick)) await runPass(formationId, () => pick, { only: actor.id });
  await settlePass(formationId);
  return { pick, pinned };
}

/** Whether this party's arrangement applies itself at all just now. */
function selfArranging(record) {
  const t = travelOf(record);
  return t.mode === "journey" && !t.movement.set && !record.combat?.active;
}

/** The arrangement's pass over a party that is applying it itself: at a dawn, or to one who joined. */
async function arrangeItself(formationId, { only = null } = {}) {
  const record = getFormation(formationId);
  if (!record || !selfArranging(record)) return [];
  const o = { pool: carrierPool(), t: travelOf(record) };
  const moved = await runPass(formationId, (actor) => arrangedPick(actor, getFormation(formationId), o), { only });
  if (moved.length) {
    await settlePass(formationId);
    ui.notifications?.info(loc("conveyance.arranged", { names: moved.join(", ") }));
  }
  return moved;
}

/** A member joined: they take the fastest they have, or their pin. */
export const arrangeJoined = (formationId, actorId) => arrangeItself(formationId, { only: actorId });

/** One party's dawn. */
export const arrangeAtDawn = (formationId) => arrangeItself(formationId);

/** Every party's dawn, one at a time and each in its own guard. */
export async function arrangeAllAtDawn() {
  for (const formation of Object.values(getFormations())) {
    try {
      await arrangeAtDawn(formation.id);
    } catch (err) {
      console.error(`${MODULE_ID} | the dawn could not arrange ${formation.id}`, err);
    }
  }
}
