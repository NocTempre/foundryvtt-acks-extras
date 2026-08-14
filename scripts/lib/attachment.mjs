/* global game */
/**
 * One actor attached to another, in a stated role.
 *
 * A rider on a horse, a passenger in a wagon, an ox in the traces, a rower at
 * the bench — these are the same relationship wearing four hats, and they are
 * modelled once here rather than four times across two features. Everything
 * that follows from being attached (whose weight counts against what, whose
 * legs stop setting the party's pace, what happens when the carrier is
 * deleted) is then answered in one place and cannot drift apart.
 *
 * THE BINDING IS A FLAG ON THE ATTACHED ACTOR naming its carrier, never a
 * roster on the carrier naming its passengers. One writer per fact: an actor
 * can only be attached to one thing at a time, a carrier deleted out from
 * under them leaves a dangling uuid that reads as "not attached" rather than a
 * roster pointing at a ghost, and no two lists can disagree about who is
 * aboard.
 */
import { MODULE_ID } from "./constants.mjs";

/** The flag an attached actor carries: `{uuid, role}`. */
export const ATTACH_FLAG = "attachedTo";

/**
 * The four ways one actor rides on, in, or ahead of another.
 *
 * `bearsWeight` says whether the attached actor's mass counts against the
 * carrier's load — a passenger in the hold does, a horse in the traces
 * obviously does not, and crew are explicitly free of a vessel's cargo (RR
 * ch. 7: "Crew do not count against a vessel's cargo capacity").
 *
 * `setsPace` says whether the carrier's speed replaces the attached actor's
 * when a party reckons its slowest member.
 */
export const ATTACH_ROLES = Object.freeze({
  rider: { label: "ACKS-LIB.attach.rider", bearsWeight: true, setsPace: true },
  passenger: { label: "ACKS-LIB.attach.passenger", bearsWeight: true, setsPace: true },
  draft: { label: "ACKS-LIB.attach.draft", bearsWeight: false, setsPace: true },
  crew: { label: "ACKS-LIB.attach.crew", bearsWeight: false, setsPace: true },
});

const uuidOf = (doc) => doc?.uuid ?? null;

/** The raw binding on this actor, or null. */
export function attachmentOf(actor) {
  const f = actor?.getFlag?.(MODULE_ID, ATTACH_FLAG);
  if (!f?.uuid) return null;
  return { uuid: f.uuid, role: ATTACH_ROLES[f.role] ? f.role : "passenger" };
}

/** The actor this one is attached to, or null. */
export function carrierOf(actor) {
  const a = attachmentOf(actor);
  if (!a) return null;
  return game.actors?.find?.((x) => x.uuid === a.uuid) ?? null;
}

/** Is this actor attached at all, or in a particular role? */
export function isAttached(actor, role = null) {
  const a = attachmentOf(actor);
  return !!a && (!role || a.role === role);
}

/**
 * Everyone attached to this carrier, optionally filtered by role. Derived by
 * asking the attached rather than reading a stored list, so the two can never
 * disagree.
 */
export function attachedTo(carrier, role = null) {
  const uuid = uuidOf(carrier);
  if (!uuid) return [];
  return (game.actors ?? []).filter((a) => {
    const at = attachmentOf(a);
    return at?.uuid === uuid && (!role || at.role === role);
  });
}

/** Attach one actor to another. Attaching again simply moves them. */
export async function attach(actor, carrier, role = "passenger") {
  const uuid = uuidOf(carrier);
  if (!actor || !uuid) return { ok: false, reason: "missing" };
  if (actor.uuid === uuid) return { ok: false, reason: "itself" };
  if (!ATTACH_ROLES[role]) return { ok: false, reason: "unknownRole" };
  // A carrier cannot be loaded into the thing it is carrying.
  if (carrierOf(carrier)?.uuid === actor.uuid) return { ok: false, reason: "circular" };
  await actor.setFlag(MODULE_ID, ATTACH_FLAG, { uuid, role });
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
 * role. Stored so it can be put back exactly (see `restoreArrangement`), which
 * is what makes unloading a wagon at a ford and reloading it afterwards a
 * two-click operation rather than twelve.
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
    const actor = (game.actors ?? []).find((a) => a.uuid === row.actor);
    const carrier = (game.actors ?? []).find((a) => a.uuid === row.uuid);
    if (!actor || !carrier) continue;
    await attach(actor, carrier, row.role);
    restored++;
  }
  return restored;
}
