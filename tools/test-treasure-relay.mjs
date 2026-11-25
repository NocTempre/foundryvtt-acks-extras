/**
 * The treasure relay's guards, over a fake pot store: the attested sender, the
 * phase, ownership of the target, the in-flight key, one request at a time, a
 * Card planted outside `order`. Every name here is this file's own invention.
 */
import assert from "node:assert/strict";
import { PHASE, REFUSAL } from "../scripts/treasure/constants.mjs";
import { normalizePot, normalizeTruth } from "../scripts/treasure/pot-logic.mjs";
import { createRelay } from "../scripts/treasure/pot-relay.mjs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (c, msg) => {
  assert.ok(c, msg);
  checks++;
};

const users = { gm: { id: "gm", isGM: true }, anna: { id: "anna", isGM: false }, ben: { id: "ben", isGM: false }, out: { id: "out", isGM: false } };
const owners = { "Actor.cleo": ["anna"], "Actor.dina": ["ben"], "Actor.npc": [] };

/**
 * Foundry's ownership levels as the fake pile answers them: a seat is seated
 * at LIMITED or better, and a Judge always. The table is read at each act, so a
 * test changes a seat's level between two requests.
 */
const NONE = 0;
const LIMITED = 1;
const OBSERVER = 2;

/** A relay over one fake pot, with a log of every write and every delivery. */
function world({ pot = {}, cards, deliver, setClaimDelay = 0, levels = { anna: LIMITED, ben: LIMITED } } = {}) {
  const store = {
    pot: normalizePot({ phase: PHASE.open, audience: ["anna", "ben"], order: ["a", "b"], ...pot }),
    cards: cards ?? [
      { id: "a", face: null, value: 0, truth: normalizeTruth({ label: "Spoon" }) },
      { id: "b", face: 0, value: 0, truth: normalizeTruth({ label: "Ladle" }) },
      { id: "planted", face: 0, value: 0, truth: normalizeTruth({ label: "Plant" }) },
    ],
  };
  const log = { flips: [], claims: [], delivered: [] };
  const relay = createRelay({
    user: (id) => users[id] ?? null,
    self: () => users.gm,
    readPot: (id) => (id === "pot1" ? { id, pot: store.pot, cards: store.cards } : null),
    writeFlip: async (_id, update) => {
      log.flips.push(update);
      const c = store.cards.find((x) => x.id === update._id);
      c.face = update.face;
    },
    seated: (_id, user) => user.isGM || (levels[user.id] ?? NONE) >= LIMITED,
    party: () => ({ members: [{ id: "m1", uuid: "Actor.cleo", name: "Cleo", capacity6: null, load6: null, casualty: false, hasDocument: true }], paceWith: () => 0 }),
    owns: (user, uuid) => user.isGM || (owners[uuid] ?? []).includes(user.id),
    hasActor: (uuid) => uuid in owners,
    ownedByTable: (uuid) => (owners[uuid] ?? []).length > 0,
    deliver: deliver ?? (async (truth, uuid) => {
      log.delivered.push([truth.label, uuid]);
      return { ok: true, name: "Name of " + uuid };
    }),
    setClaim: async (_id, cardId, claim) => {
      if (setClaimDelay) await new Promise((r) => setTimeout(r, setClaimDelay));
      log.claims.push([cardId, claim]);
      store.cards.find((x) => x.id === cardId).truth.claimedBy = claim;
    },
  });
  return { relay, store, log, levels };
}
const send = (w, payload) => w.relay.handle({ potId: "pot1", ...payload });

/* --- flip --- */
{
  const w = world();
  const r = await send(w, { op: "flip", cardId: "a", requestUserId: "anna" });
  ok(r.ok, "a seated player flips");
  eq(w.log.flips.length, 1);
  eq(Object.keys(w.log.flips[0]).sort(), ["_id", "face", "faces"], "faces and face are written in one update");
  eq((await send(w, { op: "flip", cardId: "a", requestUserId: "anna" })).reason, REFUSAL.alreadyUp, "no second turn");
  eq(w.log.flips.length, 1);
}
{
  const w = world();
  eq((await send(w, { op: "flip", cardId: "planted", requestUserId: "anna" })).reason, REFUSAL.notInPot, "a planted Card is ignored");
  eq((await send(w, { op: "flip", cardId: "a", requestUserId: "out" })).reason, REFUSAL.notAllowed, "a seat with no level on the pile");
  eq((await send(world({ pot: { flippers: ["ben"] } }), { op: "flip", cardId: "a", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "a seat not in flippers");
  eq((await send(w, { op: "flip", cardId: "a", requestUserId: "nobody" })).reason, REFUSAL.noUser, "an unknown sender");
  eq((await send(w, { op: "flip", cardId: "a", requestUserId: "anna", potId: "other" })).reason, REFUSAL.noPot, "an unknown pot");
  eq((await send(w, { op: "burn", cardId: "a", requestUserId: "anna" })).reason, REFUSAL.bad, "an unknown op");
  eq(w.log.flips.length, 0, "nothing was written by any refusal");
  for (const phase of [PHASE.staging, PHASE.closed]) {
    const x = world({ pot: { phase } });
    eq((await send(x, { op: "flip", cardId: "a", requestUserId: "anna" })).reason, REFUSAL.phase, `no flip while ${phase}`);
    eq((await send(x, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.phase, `no claim while ${phase}`);
    eq(x.log.flips.length + x.log.claims.length, 0);
  }
}

/* --- claim --- */
{
  const w = world();
  const r = await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" });
  ok(r.ok && !r.warn, "a player claims onto an actor they own");
  eq(w.log.delivered, [["Ladle", "Actor.cleo"]]);
  eq(w.store.cards[1].truth.claimedBy, { userId: "anna", actorUuid: "Actor.cleo", actorName: "Name of Actor.cleo" }, "the card is marked with who took it");
  eq((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.claimed, "an already-claimed card");
  eq(w.log.delivered.length, 1, "no second delivery");
}
{
  const w = world();
  eq((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.dina", requestUserId: "anna" })).reason, REFUSAL.notOwner, "an actor the sender does not own");
  eq((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.nowhere", requestUserId: "anna" })).reason, REFUSAL.noTarget);
  eq((await send(w, { op: "claim", cardId: "b", requestUserId: "anna" })).reason, REFUSAL.noTarget, "a payload with no actor");
  eq((await send(w, { op: "claim", cardId: "a", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.faceDown, "a face-down card");
  eq((await send(w, { op: "claim", cardId: "planted", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.notInPot, "a planted Card");
  eq(w.log.delivered.length + w.log.claims.length, 0, "nothing was delivered or marked by any refusal");
  const judge = await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.npc" });
  ok(judge.ok && judge.warn, "a Judge's own call (no attested sender) gives to any actor, with a warning");
}
{
  const w = world({ deliver: async () => ({ ok: false, reason: REFUSAL.keepsNoGoods }) });
  eq((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.keepsNoGoods);
  eq(w.store.cards[1].truth.claimedBy, null, "a delivery that fails leaves the card unclaimed");
  const t = world({ deliver: async () => { throw new Error("boom"); } });
  eq((await send(t, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.failed, "a throwing delivery is a refusal");
  eq(t.store.cards[1].truth.claimedBy, null);
}

/* --- in flight: one at a time --- */
{
  const w = world({ setClaimDelay: 5 });
  const first = send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" });
  const second = send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" });
  eq((await second).reason, REFUSAL.busy, "a duplicate request is refused while the first is in flight");
  ok((await first).ok);
  eq(w.log.delivered.length, 1, "one delivery");
  ok(w.relay.busy.size === 0, "the key is released");
  eq((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.claimed, "after the first settles the card is simply claimed");
}
{
  // Two seats claim the same card at once: the key is the pot, the act and the
  // card, so the second is refused whoever sent it.
  const w = world({ setClaimDelay: 5 });
  const a = send(w, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" });
  const b = send(w, { op: "claim", cardId: "b", actorUuid: "Actor.dina", requestUserId: "ben" });
  const results = [await a, await b];
  eq(results.filter((r) => r.ok).length, 1, "only one of two simultaneous claims lands");
  eq(w.log.delivered.length, 1);
}

/* --- a seat is its level on the pile, read when it acts --- */
{
  // LIMITED on the pile admits a seat the audience copy never named, on flip and claim.
  const w = world({ levels: { anna: LIMITED, ben: LIMITED, out: LIMITED } });
  ok((await send(w, { op: "flip", cardId: "a", requestUserId: "out" })).ok, "a seat holding LIMITED that is not in the audience copy flips");
  ok((await send(w, { op: "claim", cardId: "b", actorUuid: "Actor.npc", requestUserId: "out" })).reason === REFUSAL.notOwner, "and reaches the next guard on a claim");

  // NONE on the pile refuses a seat the audience copy still names, on every op.
  const n = world({ levels: { anna: NONE, ben: LIMITED } });
  eq((await send(n, { op: "flip", cardId: "a", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "a seat in the audience copy whose level is NONE is refused a flip");
  eq((await send(n, { op: "claim", cardId: "b", actorUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "and a claim");
  eq((await send(n, { op: "grab", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "and a Quick grab");
  eq(n.log.flips.length + n.log.claims.length + n.log.delivered.length, 0, "nothing was written");

  // The level is read at each act: a seat set to None after one turn is refused the next.
  const m = world();
  ok((await send(m, { op: "flip", cardId: "a", requestUserId: "ben" })).ok, "a seated seat flips");
  m.levels.ben = NONE;
  eq((await send(m, { op: "claim", cardId: "b", actorUuid: "Actor.dina", requestUserId: "ben" })).reason, REFUSAL.notAllowed, "the same seat set to None afterwards is refused");
  m.levels.ben = OBSERVER;
  ok((await send(m, { op: "claim", cardId: "b", actorUuid: "Actor.dina", requestUserId: "ben" })).ok, "and admitted again at a higher level");

  // A Judge is seated on every pile, and a Judge's own call (no attested sender) too.
  const g = world({ levels: {} });
  ok((await send(g, { op: "flip", cardId: "a", requestUserId: "gm" })).ok, "a Judge flips with no level in the table");
  ok((await send(g, { op: "claim", cardId: "b", actorUuid: "Actor.npc" })).ok, "a Judge's own call claims");
}

console.log(`test-treasure-relay: ${checks} checks passed`);
