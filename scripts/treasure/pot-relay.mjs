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
 *
 * A `grab` plans Quick grab on the Judge's client from the party the roster
 * answers for and the cards the pot holds; nothing a payload says about who
 * takes what is read. It carries each assignment out through the same claim
 * (`claimCard`) a Take uses, inside the one queued request, so no flip or claim
 * lands between its read and its writes.
 */
import { REFUSAL } from "./constants.mjs";
import { planGrab } from "./grab-logic.mjs";
import { grabLots, planGrabStart, speedOfRank } from "./grab-pot.mjs";
import { apparentName, cardInPot, planClaim, planFlip } from "./pot-logic.mjs";

/** The request kinds a pot answers to. */
export const OPS = Object.freeze(["flip", "claim", "grab"]);

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
 * @param {(potId: string) => ({members: {id: string, uuid: string|null, name: string, capacity6: number|null, load6: number|null, casualty: boolean, hasDocument: boolean}[], paceWith: (memberId: string, adding6: number) => number|null}|null)} deps.party
 *   the party the pot answers to, read on this client: each member's actor uuid and figures, and the rank they would pace at bearing `adding6` more
 * @param {(potId: string, cardId: string, count: number) => Promise<string|null>} deps.splitCard  moves `count` coins of a coin card onto a new turned card in the pot and answers its id, or null
 * @param {(potId: string, grab: {leftover: {cardId: string, count: number|null, code: string}[]}) => Promise<void>} deps.setGrab  stores what the last grab left
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

  /**
   * Put one card on one actor. `anyTarget` is a grab's: its targets come from
   * the roster read on this client, so the sender need not own them.
   */
  async function claimCard(potId, cardId, sender, actorUuid, { anyTarget = false } = {}) {
    const hasTarget = !!actorUuid && deps.hasActor(actorUuid);
    const plan = planClaim(deps.readPot(potId), cardId, {
      sender,
      hasTarget,
      owns: hasTarget && (anyTarget || deps.owns(sender, actorUuid)),
      ownedByTable: hasTarget && (anyTarget || deps.ownedByTable(actorUuid)),
    });
    if (!plan.ok) return failure(plan.reason);
    // The card is marked before its goods move, so a second claim that slips
    // past the queue finds it taken; a delivery that fails clears the mark.
    await deps.setClaim(potId, cardId, { userId: sender.id ?? "", actorUuid });
    let done;
    try {
      done = await deps.deliver(plan.card.truth, actorUuid);
    } catch {
      done = null;
    }
    if (!done?.ok) {
      await deps.setClaim(potId, cardId, null);
      return failure(done?.reason ?? REFUSAL.failed);
    }
    await deps.setClaim(potId, cardId, { userId: sender.id ?? "", actorUuid, actorName: done.name ?? "" });
    return { ok: true, cardId, warn: plan.warn };
  }

  /**
   * Plan Quick grab over the party and the pot's turned, unclaimed cards, then
   * carry the plan out. A coin share smaller than its card's stack is split
   * off onto a card of its own first; whatever is still turned and unclaimed
   * afterwards is the leftover, whether the plan left it or its delivery
   * failed, and is stored for the window.
   */
  async function grab(potId, sender) {
    const start = planGrabStart(deps.readPot(potId), { sender });
    if (!start.ok) return failure(start.reason);
    const party = deps.party(potId);
    const members = party?.members ?? [];
    if (!members.length) return failure(REFUSAL.noParty);
    const byId = new Map(members.map((m) => [m.id, m]));
    const plan = planGrab({
      members: members.map(({ id, capacity6, load6, casualty, hasDocument }) => ({ id, capacity6, load6, casualty, hasDocument })),
      lots: start.lots,
      paceWith: party.paceWith,
    });
    let placed = 0;
    for (const a of plan.assignments) {
      // One assignment failing leaves its card in the pot as leftover and the rest go on.
      try {
        const member = byId.get(a.memberId);
        let cardId = a.lotId;
        if (a.count != null) {
          const have = cardInPot(deps.readPot(potId), a.lotId)?.truth.coin?.count ?? 0;
          if (a.count < have) cardId = await deps.splitCard(potId, a.lotId, a.count);
        }
        if (cardId && (await claimCard(potId, cardId, sender, member.uuid, { anyTarget: true })).ok) placed++;
      } catch {
        // the card stays unclaimed and is read back as leftover below
      }
    }
    const noted = new Map(plan.notes.filter((n) => n.lotId).map((n) => [n.lotId, n.code]));
    const view = deps.readPot(potId);
    const leftover = grabLots(view).map((lot) => ({
      cardId: lot.id,
      count: lot.coin?.count ?? null,
      code: noted.get(lot.id) ?? REFUSAL.failed,
    }));
    await deps.setGrab(potId, { leftover });
    return {
      ok: true,
      placed,
      speed: speedOfRank(plan.pace),
      leftover: leftover.map((l) => ({ ...l, name: apparentName(cardInPot(view, l.cardId).truth) })),
      excluded: plan.notes.filter((n) => n.memberId).map((n) => ({ memberId: n.memberId, name: byId.get(n.memberId)?.name ?? "", why: n.why })),
    };
  }

  async function act(potId, op, sender, payload) {
    if (op === "grab") return grab(potId, sender);
    if (op === "flip") {
      const plan = planFlip(deps.readPot(potId), payload.cardId, { sender });
      if (!plan.ok) return failure(plan.reason);
      await deps.writeFlip(potId, plan.update);
      return { ok: true, cardId: payload.cardId };
    }
    const actorUuid = typeof payload.actorUuid === "string" ? payload.actorUuid : "";
    return claimCard(potId, payload.cardId, sender, actorUuid);
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
