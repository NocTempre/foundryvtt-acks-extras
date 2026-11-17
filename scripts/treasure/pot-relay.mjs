/**
 * The relay's rules, Foundry-free: every act a player makes on a pot (a flip, a
 * claim) reaches the Judge's client as one request to one handler, which
 * authorizes on the sender Foundry attested (`lib/sockets.mjs` `runRelayed`)
 * and never on what a payload says. `createRelay(deps)` is built over the
 * Foundry half (`pot.mjs`) and over fakes in the tests.
 *
 * One request runs at a time per pot (`exclusive`), so a flip cannot be lost
 * between a claim's read and its write. A request whose key is already in
 * flight is refused `busy`, and the key is claimed before the handler's first
 * await, which is what makes a double press one act. The pile is read fresh
 * inside the queue, so a request judges the pot as the request before it left
 * it.
 */
import { REFUSAL } from "./constants.mjs";
import { planClaim, planFlip } from "./pot-logic.mjs";

/** The request kinds a pot answers to. */
export const OPS = Object.freeze(["flip", "claim"]);

const failure = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * @param {object} deps
 * @param {(id: string) => ({id: string, isGM: boolean}|null)} deps.user  a user by id
 * @param {() => ({id: string|null, isGM: boolean}|null)} deps.self  the executing user, for a request with no attested sender
 * @param {(potId: string) => (object|null)} deps.readPot  the pot's `PotView`, read fresh
 * @param {(potId: string, update: object) => Promise<void>} deps.writeFlip  writes one card's flip update
 * @param {(user: object, actorUuid: string) => boolean} deps.owns  whether the user owns the actor
 * @param {(actorUuid: string) => boolean} deps.hasActor  whether the uuid names an actor
 * @param {(actorUuid: string) => boolean} deps.ownedByTable  whether any seat at the table owns the actor
 * @param {(truth: object, actorUuid: string) => Promise<{ok: boolean, name?: string, reason?: string}>} deps.deliver  puts a card's goods on an actor
 * @param {(potId: string, cardId: string, claim: object|null) => Promise<void>} deps.setClaim  marks a card claimed, or clears the mark
 */
export function createRelay(deps) {
  const busy = new Set();
  const tails = new Map();

  /** Run `fn` after every request queued before it on this pot has settled. */
  function exclusive(potId, fn) {
    const before = tails.get(potId) ?? Promise.resolve();
    const run = before.then(fn, fn);
    const tail = run.catch(() => {});
    tails.set(potId, tail);
    tail.then(() => {
      if (tails.get(potId) === tail) tails.delete(potId);
    });
    return run;
  }

  async function act(potId, op, sender, payload) {
    const view = deps.readPot(potId);
    if (op === "flip") {
      const plan = planFlip(view, payload.cardId, { sender });
      if (!plan.ok) return failure(plan.reason);
      await deps.writeFlip(potId, plan.update);
      return { ok: true, cardId: payload.cardId };
    }
    const actorUuid = typeof payload.actorUuid === "string" ? payload.actorUuid : "";
    const hasTarget = !!actorUuid && deps.hasActor(actorUuid);
    const plan = planClaim(view, payload.cardId, {
      sender,
      hasTarget,
      owns: hasTarget && deps.owns(sender, actorUuid),
      ownedByTable: hasTarget && deps.ownedByTable(actorUuid),
    });
    if (!plan.ok) return failure(plan.reason);
    // The card is marked before its goods move, so a second claim that slips
    // past the queue finds it taken; a delivery that fails clears the mark.
    await deps.setClaim(potId, payload.cardId, { userId: sender.id ?? "", actorUuid });
    let done;
    try {
      done = await deps.deliver(plan.card.truth, actorUuid);
    } catch {
      done = null;
    }
    if (!done?.ok) {
      await deps.setClaim(potId, payload.cardId, null);
      return failure(done?.reason ?? REFUSAL.failed);
    }
    await deps.setClaim(potId, payload.cardId, { userId: sender.id ?? "", actorUuid, actorName: done.name ?? "" });
    return { ok: true, cardId: payload.cardId, warn: plan.warn };
  }

  /**
   * The handler. `requestUserId` is the attested sender, null for a Judge's own
   * call; everything else in the payload is a claim and is checked.
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  function handle(payload = {}) {
    const { potId, op, requestUserId = null } = payload ?? {};
    const sender = requestUserId ? deps.user(requestUserId) : deps.self();
    if (!sender) return Promise.resolve(failure(REFUSAL.noUser));
    if (typeof potId !== "string" || !OPS.includes(op)) return Promise.resolve(failure(REFUSAL.bad));
    const key = `${potId}:${op}:${payload.cardId ?? ""}`;
    // Claimed before the first await: a second press of the same act is refused.
    if (busy.has(key)) return Promise.resolve(failure(REFUSAL.busy));
    busy.add(key);
    return exclusive(potId, () => act(potId, op, sender, payload))
      .catch(() => failure(REFUSAL.failed))
      .finally(() => busy.delete(key));
  }

  return { handle, exclusive, busy };
}
