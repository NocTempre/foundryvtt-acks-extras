/* global game, Hooks */
/**
 * One actor attached to another, in a stated role.
 *
 * A rider on a horse, a passenger in a wagon, an ox in the traces, a rower at
 * the bench, a canoe lashed to a cart — the same relationship wearing five
 * hats, modelled once here rather than five times across two features.
 * Everything that follows from being attached (whose weight counts against
 * what, whose legs stop setting the party's pace, what happens when the
 * carrier is deleted) is answered in one place and cannot drift apart.
 *
 * THE BINDING IS A FLAG ON THE ATTACHED ACTOR naming its carrier, never a
 * roster on the carrier naming its passengers. One writer per fact: an actor
 * can only be attached to one thing at a time, a carrier deleted out from
 * under them leaves a dangling uuid that reads as "not attached" rather than a
 * roster pointing at a ghost, and no two lists can disagree about who is
 * aboard. One flag per actor also makes the attachments a FOREST by
 * construction — a rider on a horse harnessed to a wagon is a chain, never a
 * web — which is what lets `carrierChain` walk it and `attach` refuse a cycle.
 *
 * The flag carries `{uuid, role, station, kind}`:
 *  - `role` is the PHYSICS — which of ATTACH_ROLES applies, deciding weight
 *    and pace;
 *  - `station` is the JOB — "driver", "rowers", "captain", or a vehicle's own
 *    `crew.roles[].key` — meaningful only to the carrier that assigned it;
 *  - `kind` is the draft equivalence class for an animal in harness, kept
 *    here so unharnessing and re-harnessing does not re-guess it.
 * Older flags carry only `{uuid, role}` and read fine: absent fields are null.
 */
import { MODULE_ID } from "./constants.mjs";
import { resolveActorSync } from "./storage.mjs";
import { isPrimaryGM } from "./util.mjs";

/** The flag an attached actor carries: `{uuid, role, station, kind}`. */
export const ATTACH_FLAG = "attachedTo";

/**
 * The five ways one actor rides on, in, or ahead of another.
 *
 * `bearsWeight` says whether the attached actor's mass counts against the
 * carrier's load — a passenger in the hold does, a horse in the traces
 * obviously does not, and crew are explicitly free of a vessel's cargo (RR
 * ch. 7: "Crew do not count against a vessel's cargo capacity"). `cargo` is
 * for actor-shaped freight — a boat on a wagon, a disassembled engine — which
 * weighs like cargo because it IS cargo.
 *
 * `setsPace` says whether the carrier's speed replaces the attached actor's
 * when a party reckons its slowest member.
 */
export const ATTACH_ROLES = Object.freeze({
  rider: { label: "ACKS-LIB.attach.rider", bearsWeight: true, setsPace: true },
  passenger: { label: "ACKS-LIB.attach.passenger", bearsWeight: true, setsPace: true },
  draft: { label: "ACKS-LIB.attach.draft", bearsWeight: false, setsPace: true },
  crew: { label: "ACKS-LIB.attach.crew", bearsWeight: false, setsPace: true },
  cargo: { label: "ACKS-LIB.attach.cargo", bearsWeight: true, setsPace: true },
});

const uuidOf = (doc) => doc?.uuid ?? null;

/** The raw binding on this actor, or null. */
export function attachmentOf(actor) {
  const f = actor?.getFlag?.(MODULE_ID, ATTACH_FLAG);
  if (!f?.uuid) return null;
  return {
    uuid: f.uuid,
    role: ATTACH_ROLES[f.role] ? f.role : "passenger",
    station: typeof f.station === "string" && f.station ? f.station : null,
    kind: typeof f.kind === "string" && f.kind ? f.kind : null,
  };
}

/** The actor this one is attached to, or null. */
export function carrierOf(actor) {
  const a = attachmentOf(actor);
  if (!a) return null;
  return resolveActorSync(a.uuid);
}

/**
 * The chain of carriers above this actor, nearest first: the horse, then the
 * wagon the horse is harnessed to. Bounded and cycle-safe — a hand-edited
 * world cannot hang a render loop here.
 */
export function carrierChain(actor) {
  const chain = [];
  const seen = new Set();
  let cur = carrierOf(actor);
  while (cur && !seen.has(cur.uuid) && chain.length < 10) {
    chain.push(cur);
    seen.add(cur.uuid);
    cur = carrierOf(cur);
  }
  return chain;
}

/**
 * The carrier whose own legs, wheels or hull actually move: the top of the
 * chain. A rider whose horse is in a wagon's traces travels at the WAGON's
 * pace, and this is the one answer that says so.
 */
export function rootCarrierOf(actor) {
  const chain = carrierChain(actor);
  return chain.length ? chain[chain.length - 1] : null;
}

/** Is this actor attached at all, or in a particular role? */
export function isAttached(actor, role = null) {
  const a = attachmentOf(actor);
  return !!a && (!role || a.role === role);
}

/* -------------------------------------------------------------------- */
/*  The reverse index — a CACHE, never truth                            */
/* -------------------------------------------------------------------- */

/**
 * carrier uuid → Set of attached actor ids. The flag on the attached actor
 * remains the only truth: every index hit is re-verified against it before it
 * is returned, so a stale index costs a wasted lookup, never a wrong answer.
 * Invalidated whole on any actor create/delete or any update touching the
 * flag; rebuilt lazily on the next read. Without it, `riderOf` inside a
 * per-actor loop (capacity sums, follower cards) is a full world scan per
 * call.
 */
let index = null;

function buildIndex() {
  const map = new Map();
  for (const a of game.actors ?? []) {
    const at = attachmentOf(a);
    if (!at) continue;
    if (!map.has(at.uuid)) map.set(at.uuid, new Set());
    map.get(at.uuid).add(a.id);
  }
  return map;
}

const invalidateIndex = () => {
  index = null;
};

/**
 * Everyone attached to this carrier, optionally filtered by role. Derived by
 * asking the attached rather than reading a stored list, so the two can never
 * disagree; the index only says where to look.
 */
export function attachedTo(carrier, role = null) {
  const uuid = uuidOf(carrier);
  if (!uuid || !game?.actors) return [];
  index ??= buildIndex();
  const ids = index.get(uuid);
  if (!ids?.size) return [];
  const out = [];
  for (const id of ids) {
    const a = game.actors.get(id);
    const at = a ? attachmentOf(a) : null; // verify: the flag is the truth
    if (at?.uuid === uuid && (!role || at.role === role)) out.push(a);
  }
  return out;
}

/**
 * Keeps the index honest and the world tidy. Registered once by lib's
 * module.mjs:
 *  - any actor create/delete, or an update touching the flag, drops the index;
 *  - when a CARRIER is deleted, the primary GM's client detaches everyone who
 *    was attached to it — a dangling uuid already reads as unattached, but
 *    left in place it would rebind if the id were ever reused, and it dirties
 *    every scan until then.
 */
export function registerAttachmentIndex() {
  const touchesFlag = (changed) => {
    const f = changed?.flags?.[MODULE_ID];
    return !!f && (ATTACH_FLAG in f || `-=${ATTACH_FLAG}` in f);
  };
  Hooks.on("createActor", invalidateIndex);
  Hooks.on("updateActor", (_actor, changed) => {
    if (touchesFlag(changed)) invalidateIndex();
  });
  Hooks.on("deleteActor", async (actor) => {
    invalidateIndex();
    if (!isPrimaryGM()) return;
    try {
      for (const a of attachedTo(actor)) await a.unsetFlag(MODULE_ID, ATTACH_FLAG);
    } catch (err) {
      console.warn(`${MODULE_ID} | attachment cleanup failed for "${actor?.name}"`, err);
    }
  });
}

/* -------------------------------------------------------------------- */
/*  Writes                                                              */
/* -------------------------------------------------------------------- */

/**
 * Attach one actor to another. Attaching again simply moves them.
 *
 * The cycle guard walks the WHOLE chain: a carrier cannot be loaded into
 * anything it is carrying, however many levels down — a wagon does not ride
 * in the canoe it carries, even via a horse.
 *
 * @param {object} [extra]
 * @param {string} [extra.station] the job at the carrier ("driver", "rowers", …)
 * @param {string} [extra.kind] draft equivalence class for an animal in harness
 */
export async function attach(actor, carrier, role = "passenger", { station = null, kind = null } = {}) {
  const uuid = uuidOf(carrier);
  if (!actor || !uuid) return { ok: false, reason: "missing" };
  if (actor.uuid === uuid) return { ok: false, reason: "itself" };
  if (!ATTACH_ROLES[role]) return { ok: false, reason: "unknownRole" };
  if (carrierChain(carrier).some((c) => c.uuid === actor.uuid)) return { ok: false, reason: "circular" };
  await actor.setFlag(MODULE_ID, ATTACH_FLAG, { uuid, role, station, kind });
  return { ok: true, role };
}

/** Detach one actor. */
export async function detach(actor) {
  if (!isAttached(actor)) return { ok: false, reason: "notAttached" };
  await actor.unsetFlag(MODULE_ID, ATTACH_FLAG);
  return { ok: true };
}

/** Detach everyone from a carrier — the whole cart empties at once. */
export async function detachAll(carrier, role = null) {
  const people = attachedTo(carrier, role);
  for (const p of people) await detach(p);
  return people.length;
}

/**
 * The arrangement, as a plain record — who was attached to what, in which
 * role, at which station. Stored so it can be put back exactly (see
 * `restoreArrangement`), which is what makes unloading a wagon at a ford and
 * reloading it afterwards a two-click operation rather than twelve.
 */
export function snapshotArrangement(actors = null) {
  const pool = actors ?? game.actors ?? [];
  return [...pool]
    .map((a) => ({ actor: a.uuid, ...attachmentOf(a) }))
    .filter((r) => r.uuid);
}

/** Put a snapshot back. Actors that have since vanished are skipped. */
export async function restoreArrangement(snapshot = []) {
  let restored = 0;
  for (const row of snapshot) {
    const actor = resolveActorSync(row.actor);
    const carrier = resolveActorSync(row.uuid);
    if (!actor || !carrier) continue;
    await attach(actor, carrier, row.role, { station: row.station ?? null, kind: row.kind ?? null });
    restored++;
  }
  return restored;
}
