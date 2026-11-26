/**
 * The treasure relay's guards, over a fake pot store: the attested sender, the
 * phase, ownership of the target, the in-flight key, one request at a time, a
 * Card planted outside `order`. Every name here is this file's own invention.
 */
import assert from "node:assert/strict";
import { PHASE, REFUSAL } from "../scripts/treasure/constants.mjs";
import { normalizePot, normalizeTruth } from "../scripts/treasure/pot-logic.mjs";
import { createRelay } from "../scripts/treasure/pot-relay.mjs";
import * as relayRules from "../scripts/treasure/pot-relay.mjs";

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
const OWNER = 3;

/** A relay over one fake pot, with a log of every write and every delivery. */
function world({ pot = {}, cards, deliver, setClaimDelay = 0, dealDelay = 0, levels = { anna: LIMITED, ben: LIMITED } } = {}) {
  const store = {
    pot: normalizePot({ phase: PHASE.open, audience: ["anna", "ben"], order: ["a", "b"], ...pot }),
    cards: cards ?? [
      { id: "a", face: null, value: 0, truth: normalizeTruth({ label: "Spoon" }) },
      { id: "b", face: 0, value: 0, truth: normalizeTruth({ label: "Ladle" }) },
      { id: "planted", face: 0, value: 0, truth: normalizeTruth({ label: "Plant" }) },
    ],
  };
  const log = { flips: [], claims: [], delivered: [], closes: [], deals: [] };
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
    ownsPot: (_id, user) => user.isGM || (levels[user.id] ?? NONE) >= OWNER,
    closePot: async (_id, placeUuid) => {
      log.closes.push(placeUuid);
      return { ok: true, filed: placeUuid ? 1 : 0 };
    },
    dealOffered: async (_id, sender, how) => {
      log.deals.push([sender.id, how]);
      if (dealDelay) await new Promise((r) => setTimeout(r, dealDelay));
      store.pot = normalizePot({ ...store.pot, phase: PHASE.open, offered: false, offeredLair: false });
      return { ok: true, hoards: 2 };
    },
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

/* --- close: the pile's owner's, and the named place's --- */
{
  const w = world({ levels: { anna: OWNER, ben: LIMITED } });
  const r = await send(w, { op: "close", placeUuid: "Actor.cleo", requestUserId: "anna" });
  ok(r.ok && r.filed === 1, "an owner of the pile who owns the place closes and files there");
  eq(w.log.closes, ["Actor.cleo"], "the place reached the close");
  const bare = world({ levels: { anna: OWNER } });
  ok((await send(bare, { op: "close", requestUserId: "anna" })).ok, "an owner closes with no place named");
  eq(bare.log.closes, [null], "no place is passed on as null");
  const blank = world({ levels: { anna: OWNER } });
  ok((await send(blank, { op: "close", placeUuid: "", requestUserId: "anna" })).ok, "an empty place is no place");
  eq(blank.log.closes, [null]);
}
{
  // A seat holding LIMITED, even one that owns the place, is not the pile's owner.
  const w = world({ levels: { anna: LIMITED, ben: OBSERVER } });
  eq((await send(w, { op: "close", placeUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "a seat with LIMITED on the pile that owns the place is refused");
  eq((await send(w, { op: "close", requestUserId: "ben" })).reason, REFUSAL.notAllowed, "and OBSERVER is not enough");
  eq((await send(w, { op: "close", requestUserId: "out" })).reason, REFUSAL.notAllowed, "a seat with no level is refused");
  eq(w.log.closes.length, 0, "no close ran");
}
{
  // The pile's owner needs the named place too: a place another seat owns, and one nobody at the table owns.
  const w = world({ levels: { anna: OWNER } });
  eq((await send(w, { op: "close", placeUuid: "Actor.dina", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "an owner of the pile is refused a place another seat owns");
  eq((await send(w, { op: "close", placeUuid: "Actor.npc", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "and a place no seat owns");
  eq(w.log.closes.length, 0, "no close ran");
  eq((await send(w, { op: "close", placeUuid: "Actor.nowhere", requestUserId: "anna" })).ok, true, "a uuid that names no actor reaches the close, which answers for it");
  eq(w.log.closes, ["Actor.nowhere"]);
}
{
  // The phase and the pot: an owner who owns everything is still refused a closed pot or an unknown one.
  const w = world({ pot: { phase: PHASE.closed }, levels: { anna: OWNER } });
  eq((await send(w, { op: "close", placeUuid: "Actor.cleo", requestUserId: "anna" })).reason, REFUSAL.phase, "a closed pot is refused by phase");
  eq((await send(w, { op: "close", placeUuid: "Actor.cleo", requestUserId: "gm" })).reason, REFUSAL.phase, "a Judge is refused the same");
  eq(w.log.closes.length, 0, "no close ran");
  const x = world({ levels: { anna: OWNER } });
  eq((await send(x, { op: "close", requestUserId: "anna", potId: "other" })).reason, REFUSAL.noPot, "an unknown pot");
  eq((await send(x, { op: "close", requestUserId: "nobody" })).reason, REFUSAL.noUser, "an unknown sender");
  eq(x.log.closes.length, 0);
  // Staging is the Judge's surface: an owner who is not a Judge is refused a staging pot, and a Judge closes it.
  const s = world({ pot: { phase: PHASE.staging }, levels: { anna: OWNER } });
  eq((await send(s, { op: "close", requestUserId: "anna" })).reason, REFUSAL.phase, "an owner who is not a Judge is refused a staging pot");
  eq(s.log.closes.length, 0, "no close ran");
  ok((await send(s, { op: "close", requestUserId: "gm" })).ok, "a Judge closes a staging pot");
}
{
  // A Judge passes on the attested id and on its own call, with no level in the table and any place.
  const g = world({ levels: {} });
  ok((await send(g, { op: "close", placeUuid: "Actor.dina", requestUserId: "gm" })).ok, "a Judge closes with a place a player owns");
  ok((await send(g, { op: "close", placeUuid: "Actor.npc" })).ok, "a Judge's own call closes at a place nobody owns");
  eq(g.log.closes, ["Actor.dina", "Actor.npc"]);
  // The level is read at each act: a seat dropped to LIMITED after being OWNER is refused its next close.
  const m = world({ levels: { anna: OWNER } });
  m.levels.anna = LIMITED;
  eq((await send(m, { op: "close", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "an owner whose level was lowered is refused");
  m.levels.anna = OWNER;
  ok((await send(m, { op: "close", requestUserId: "anna" })).ok, "and admitted again at OWNER");
}
{
  // One close at a time per pot: a second in flight is busy, and the first settles.
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = world({ levels: { anna: OWNER } });
  const slow = createRelay({
    user: (id) => users[id] ?? null,
    self: () => users.gm,
    readPot: () => ({ id: "pot1", pot: w.store.pot, cards: w.store.cards }),
    seated: () => true,
    ownsPot: () => true,
    closePot: async () => { await gate; return { ok: true, filed: 0 }; },
    owns: () => true,
    hasActor: () => true,
  });
  const first = slow.handle({ potId: "pot1", op: "close", requestUserId: "anna" });
  eq((await slow.handle({ potId: "pot1", op: "close", requestUserId: "anna" })).reason, REFUSAL.busy, "a second close while one is in flight is refused busy");
  release();
  ok((await first).ok, "the first settles");
}

/* --- deal: the table rolls an offered pot --- */
const offeredPot = (over = {}) => ({ phase: PHASE.staging, mode: "table", offered: true, order: [], deal: { hand: [{ letter: "Q", hoards: 2 }] }, ...over });
{
  const w = world({ pot: offeredPot() });
  const r = await send(w, { op: "deal", requestUserId: "anna" });
  ok(r.ok, "a seat with LIMITED on an offered pot deals it");
  eq(w.log.deals, [["anna", { lair: false, resume: false }]], "the Judge's client deals once, for the sender Foundry attested");
  const again = await send(w, { op: "deal", requestUserId: "ben" });
  eq(again.reason, REFUSAL.notYours, "the pot is no longer offered once dealt: a second press is refused");
  eq(w.log.deals.length, 1, "and deals nothing");
}
{
  const w = world({ pot: offeredPot() });
  eq((await send(w, { op: "deal", requestUserId: "out" })).reason, REFUSAL.notAllowed, "a seat with no level on the pile is refused");
  eq((await send(w, { op: "deal", requestUserId: "nobody" })).reason, REFUSAL.noUser, "an unknown sender");
  eq((await send(w, { op: "deal", requestUserId: "anna", potId: "other" })).reason, REFUSAL.noPot, "an unknown pot");
  eq(w.log.deals.length, 0, "no refusal dealt");
  w.levels.anna = NONE;
  eq((await send(w, { op: "deal", requestUserId: "anna" })).reason, REFUSAL.notAllowed, "the level is read when the act arrives");
  w.levels.anna = LIMITED;
  ok((await send(w, { op: "deal", requestUserId: "anna" })).ok, "and admitted again at LIMITED");
}
{
  for (const [what, pot] of [
    ["a pot never offered", offeredPot({ offered: false })],
    ["a pot whose mode is Judge", offeredPot({ mode: "judge" })],
    ["an open pot", offeredPot({ phase: PHASE.open, offered: false })],
    ["a closed pot", offeredPot({ phase: PHASE.closed })],
  ]) {
    const w = world({ pot });
    eq((await send(w, { op: "deal", requestUserId: "anna" })).reason, REFUSAL.notYours, `${what} is not the seat's to deal`);
    eq(w.log.deals.length, 0, `${what}: nothing dealt`);
  }
  const empty = world({ pot: offeredPot({ deal: {} }) });
  eq((await send(empty, { op: "deal", requestUserId: "anna" })).reason, REFUSAL.empty, "an offered pot with no hoard listed refuses empty");
  eq(empty.log.deals.length, 0);
}
{
  // The lair confirmation is the Judge's, stored at the offer; a player's payload never supplies it.
  const lair = world({ pot: offeredPot({ offeredLair: true }) });
  await send(lair, { op: "deal", requestUserId: "anna" });
  eq(lair.log.deals[0][1].lair, true, "a lair confirmed at the offer is carried to the deal");
  const claim = world({ pot: offeredPot() });
  await send(claim, { op: "deal", requestUserId: "anna", lair: true });
  eq(claim.log.deals[0][1].lair, false, "a player's payload cannot confirm the lair");
  const judge = world({ pot: offeredPot() });
  await send(judge, { op: "deal", requestUserId: "gm", lair: true });
  eq(judge.log.deals[0][1].lair, true, "a Judge's own confirmation is honoured");
  const own = world({ pot: offeredPot() });
  ok((await send(own, { op: "deal" })).ok, "a Judge's own call (no attested sender) deals an offered pot");
  eq(own.log.deals[0][0], "gm");
}
{
  // A deal that landed and an open that failed leaves the list dealt: the next press opens and deals nothing again.
  const w = world({ pot: offeredPot({ dealt: "QQ" }) });
  await send(w, { op: "deal", requestUserId: "anna" });
  eq(w.log.deals[0][1].resume, true, "a list already dealt is not dealt again");
  const stale = world({ pot: offeredPot({ dealt: "QR" }) });
  await send(stale, { op: "deal", requestUserId: "anna" });
  eq(stale.log.deals[0][1].resume, false, "a marker for a list since edited is stale");
}
{
  // One press at a time: the second is busy, and once the first settles the pot is no longer offered.
  const w = world({ pot: offeredPot(), dealDelay: 10 });
  const first = send(w, { op: "deal", requestUserId: "anna" });
  eq((await send(w, { op: "deal", requestUserId: "anna" })).reason, REFUSAL.busy, "a second press while one runs is refused busy");
  ok((await first).ok, "the first settles");
  eq(w.log.deals.length, 1, "one deal");
  const bank = world({ pot: offeredPot(), dealDelay: 10 });
  const [ra, rb] = await Promise.all([send(bank, { op: "deal", requestUserId: "anna" }), send(bank, { op: "deal", requestUserId: "ben" })]);
  eq([ra.ok, rb.ok, bank.log.deals.length], [true, false, 1], "two seats pressing at once make one deal; the second re-reads the pot and finds it dealt");
}
{
  const view = { id: "pot1", pot: normalizePot(offeredPot()), cards: [] };
  const plan = relayRules.planTableDeal(view, { sender: users.anna, seated: true });
  eq([plan.ok, plan.lair, plan.resume], [true, false, false], "the rule is a pure function of the pot, the sender and the seat");
  eq(relayRules.planTableDeal(view, { sender: users.anna, seated: false }).reason, REFUSAL.notAllowed);
  eq(relayRules.planTableDeal(null, { sender: users.anna, seated: true }).reason, REFUSAL.noPot);
}

console.log(`test-treasure-relay: ${checks} checks passed`);
