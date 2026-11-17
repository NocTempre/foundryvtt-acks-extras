/**
 * Quick grab on a pot, Foundry-free: what the pot offers the planner, who may
 * start a grab, how a coin card splits, and the relay's `grab` over a fake pot
 * and a fake party. Every name, weight and pace step here is this file's own
 * invention: `speedAt` is a step function the tests chose, never a movement
 * figure.
 *
 * Run: node tools/test-treasure-grab.mjs
 */
import assert from "node:assert/strict";
import { PHASE, REFUSAL } from "../scripts/treasure/constants.mjs";
import { grabLots, planGrabStart, resolveParty, slowestSpeed, speedOfRank, splitCoin } from "../scripts/treasure/grab-pot.mjs";
import { goodsWeights6, normalizePot, normalizeTruth } from "../scripts/treasure/pot-logic.mjs";
import { createRelay } from "../scripts/treasure/pot-relay.mjs";
import { createCardDrop } from "../scripts/treasure/sheet-drop.mjs";
import { sumWeight6 } from "../scripts/lib/item-model.mjs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (c, msg) => {
  assert.ok(c, msg);
  checks++;
};

const GM = { id: "gm", isGM: true };
const ANNA = { id: "anna", isGM: false };
const OUT = { id: "out", isGM: false };

/* --- what a bundle's documents weigh --- */
{
  const stack = { type: "item", system: { cost: 1, weight6: 12, quantity: { value: 2 } } };
  const single = { type: "item", system: { cost: 1, weight6: 6 } };
  const none = { type: "item", system: { cost: 1, weight6: 0 } };
  const weights = goodsWeights6([stack, single, none]);
  eq(weights, [24, 6, 0], "each document weighs its own data, a stack by its quantity");
  eq(weights.reduce((a, b) => a + b, 0), sumWeight6([stack, single, none]), "the weights sum to what the documents weigh together");
  eq(goodsWeights6([single]), [6], "a lone document weighs all of it");
  eq(goodsWeights6(null), [], "no goods weigh nothing");
}

/* --- the party a pot answers to --- */
{
  const parties = [{ id: "p1" }, { id: "p2" }];
  eq(resolveParty({ partyId: "p2" }, parties), "p2", "a listed party named on the flag is the pot's");
  eq(resolveParty({ partyId: "gone" }, parties), null, "a named party the roster does not list, with two to choose from, is none");
  eq(resolveParty({ partyId: null }, parties), null, "two parties and none named is none");
  eq(resolveParty({ partyId: null }, [{ id: "p1" }]), "p1", "the only party is the pot's when none is named");
  eq(resolveParty({ partyId: "gone" }, [{ id: "p1" }]), "p1", "a stale name falls back to the only party");
  eq(resolveParty({ partyId: null }, []), null, "no party is none");
  eq(resolveParty({ partyId: null }, undefined), null, "no roster is none");
}

/* --- the lots and who may start --- */
const card = (id, over = {}, face = 0) => ({ id, face, value: 0, truth: normalizeTruth({ label: id, weight6: 6, ...over }) });
const coinCard = (id, count, weight6, face = 0) => card(id, { coin: { name: "QQ coin", cv: 1, count }, weight6, pool: "coins" }, face);
const viewOf = (cards, pot = {}) => ({
  id: "pot1",
  pot: normalizePot({ phase: PHASE.open, audience: [ANNA.id], order: cards.map((c) => c.id), ...pot }),
  cards,
});
{
  const view = viewOf([card("a"), card("down", {}, null), coinCard("coin", 30, 3), card("taken", { claimedBy: { userId: "x" } }), card("planted")], { order: ["a", "down", "coin", "taken"] });
  eq(grabLots(view), [{ id: "a", weight6: 6, coin: null }, { id: "coin", weight6: 3, coin: { name: "QQ coin", cv: 1, count: 30 } }], "lots are the turned, unclaimed cards in order, none planted outside it");
  ok(planGrabStart(view, { sender: ANNA }).ok, "a seated player may start");
  ok(planGrabStart(view, { sender: GM }).ok, "the Judge may start");
  eq(planGrabStart(view, { sender: OUT }).reason, REFUSAL.notAllowed, "a seat outside the audience may not");
  eq(planGrabStart(viewOf([card("a")], { phase: PHASE.staging }), { sender: GM }).reason, REFUSAL.phase, "a pot not open is refused");
  eq(planGrabStart(viewOf([card("down", {}, null)]), { sender: ANNA }).reason, REFUSAL.nothingToGrab, "nothing turned is nothing to grab");
  eq(planGrabStart(null, { sender: GM }).reason, REFUSAL.noPot);
}

/* --- splitting a coin card --- */
{
  const t = normalizeTruth({ label: "100 QQ coin", coin: { name: "QQ coin", cv: 2, count: 100 }, weight6: 20, pool: "coins" });
  const { taken, rest } = splitCoin(t, 30, { text: (n) => `<${n}>` });
  eq([taken.coin.count, rest.coin.count], [30, 70], "a share and what is left are whole coins");
  eq(taken.coin.count + rest.coin.count, t.coin.count, "the counts add back to the stack");
  ok(Math.abs(taken.weight6 + rest.weight6 - t.weight6) < 1e-9, "the weights add back to the stack's");
  ok(Math.abs(taken.weight6 - 6) < 1e-9, "a share weighs its coins' part");
  eq([taken.label, rest.label], ["<30> QQ coin", "<70> QQ coin"], "each half is labelled with its own count");
  eq(taken.coin.cv, 2, "the rate carries to both halves");
  eq(splitCoin(t, 100), null, "the whole stack is not a split");
  eq(splitCoin(t, 0), null, "no coins is not a split");
  eq(splitCoin(t, 250), null, "more than the stack is not a split");
  eq(splitCoin(normalizeTruth({ label: "x" }), 1), null, "a card that is no coin does not split");
  eq(splitCoin(t, 30.9).taken.coin.count, 30, "a share is whole coins");
}

/* --- the pace figures --- */
{
  eq(speedOfRank(-90), 90, "a rank is the speed's negative");
  eq(speedOfRank(null), null);
  eq(speedOfRank(Infinity), null, "no figure is no speed");
  eq(slowestSpeed([120, null, 90, 150]), 90, "the party moves at its slowest counted member");
  eq(slowestSpeed([null, null]), null, "nobody counted is no pace");
  eq(slowestSpeed(undefined), null);
}

/* --- the relay's grab, over a fake pot and a fake party --- */
const SIZE = 12;
/** Feet per turn at a load: a step down for every SIZE of weight, a number this file chose. */
const speedAt = (load) => Math.max(10, 120 - 30 * Math.floor(load / SIZE));

function world({ members, cards, pot = {}, deliver, failSplit = false } = {}) {
  const store = {
    pot: normalizePot({ phase: PHASE.open, audience: [ANNA.id], order: cards.map((c) => c.id), ...pot }),
    cards,
    loads: Object.fromEntries(members.map((m) => [m.id, m.load6 ?? 0])),
  };
  const log = { delivered: [], splits: [], grabs: [] };
  const relay = createRelay({
    user: (id) => ({ gm: GM, anna: ANNA, out: OUT })[id] ?? null,
    self: () => GM,
    readPot: (id) => (id === "pot1" ? { id, pot: store.pot, cards: store.cards } : null),
    writeFlip: async () => {},
    owns: () => false,
    hasActor: (uuid) => members.some((m) => m.uuid === uuid),
    ownedByTable: () => false,
    deliver: deliver ?? (async (truth, uuid) => {
      const m = members.find((x) => x.uuid === uuid);
      log.delivered.push({ label: truth.label, uuid, weight6: truth.weight6, count: truth.coin?.count ?? null });
      store.loads[m.id] += truth.weight6;
      return { ok: true, name: m.name };
    }),
    setClaim: async (_id, cardId, claim) => {
      store.cards.find((c) => c.id === cardId).truth.claimedBy = claim;
    },
    party: (id) => (id === "pot1" && members.length ? { members, paceWith: (mid, add) => 0 - speedAt(store.loads[mid] + add) } : null),
    splitCard: async (_id, cardId, count) => {
      if (failSplit) return null;
      const original = store.cards.find((c) => c.id === cardId);
      const split = splitCoin(original.truth, count);
      if (!split) return null;
      const child = { id: `${cardId}-s${log.splits.length + 1}`, face: 0, value: original.value, truth: split.taken };
      store.cards.push(child);
      original.truth = split.rest;
      store.pot.order.splice(store.pot.order.indexOf(cardId) + 1, 0, child.id);
      log.splits.push([cardId, count, child.id]);
      return child.id;
    },
    setGrab: async (_id, grab) => {
      store.pot.grab = grab;
      log.grabs.push(grab);
    },
  });
  return { relay, store, log };
}
const member = (id, cap, load = 0, over = {}) => ({ id, uuid: `Actor.${id}`, name: `Name ${id}`, capacity6: cap, load6: load, casualty: false, hasDocument: true, ...over });
const send = (w, payload) => w.relay.handle({ potId: "pot1", op: "grab", ...payload });
const stack = () => [
  card("c1", { weight6: 10 }),
  card("c2", { weight6: 7 }),
  card("c3", { weight6: 3 }),
  coinCard("coin", 100, 20),
  card("gem", { weight6: 0, pool: "gems", valueGp: 50 }),
  card("huge", { weight6: 900 }),
  card("down", { weight6: 5 }, null),
];

{
  const members = [member("m1", 30, 0), member("m2", 30, 6), member("m3", 30, 0, { casualty: true })];
  const w = world({ members, cards: stack() });
  const base = { ...w.store.loads };
  const r = await send(w, { requestUserId: "anna", assignments: [{ lotId: "c1", memberId: "m3" }], actorUuid: "Actor.m3" });
  ok(r.ok, "a seated player who owns no member starts a grab");
  ok(!w.log.delivered.some((d) => d.uuid === "Actor.m3"), "a casualty takes nothing, and a plan sent in the payload is never read");
  eq(r.excluded.map((e) => [e.memberId, e.why]), [["m3", "casualty"]], "the casualty is named as excluded");

  const claimed = w.store.cards.filter((c) => c.truth.claimedBy);
  ok(claimed.length >= 3, "turned cards are claimed");
  ok(w.store.cards.find((c) => c.id === "down").truth.claimedBy === null, "a face-down card is never taken");
  eq(r.leftover.find((l) => l.cardId === "huge")?.code, "tooHeavy", "a card heavier than any member's room is left, with its reason");
  eq(w.store.pot.grab.leftover.map((l) => l.cardId), r.leftover.map((l) => l.cardId), "the leftover is stored on the pot");

  const room = { m1: 30 - base.m1, m2: 30 - base.m2 };
  for (const id of ["m1", "m2"]) ok(w.store.loads[id] - base[id] <= room[id] + 1e-9, `${id} is given no more than it has room for`);

  const coinTaken = w.log.delivered.filter((d) => d.count !== null).reduce((n, d) => n + d.count, 0);
  const coinLeft = r.leftover.filter((l) => l.cardId === "coin" || l.cardId.startsWith("coin-")).reduce((n, l) => n + l.count, 0);
  eq(coinTaken + coinLeft, 100, "every coin is delivered or left, none lost or doubled");
  ok(w.log.splits.length > 0, "the stack was shared, so at least one share split off its card");
  for (const [orig, count, childId] of w.log.splits) {
    eq(orig, "coin");
    const child = w.store.cards.find((c) => c.id === childId);
    eq(child.truth.coin.count, count, "a split card carries the share it was split for");
    ok(w.store.pot.order.includes(childId), "a split card is in the pot's order");
  }
  eq(w.store.cards.filter((c) => c.truth.coin).reduce((n, c) => n + c.truth.coin.count, 0), 100, "the pot's coin cards still hold the whole stack");

  const actual = slowestSpeed(["m1", "m2"].map((id) => speedAt(w.store.loads[id])));
  eq(r.speed, actual, "the predicted pace is the pace the members hold once the goods have landed");
  ok(r.speed >= speedAt(30 + 6), "the plan leaves the party no slower than loading the first member to the brim");
}

/* --- the best pace is kept: a pile that fits under the first step is not spread past it --- */
{
  const members = [member("m1", 60, 0), member("m2", 60, 0)];
  const w = world({ members, cards: [card("a", { weight6: 11 }), card("b", { weight6: 11 })] });
  const r = await send(w, { requestUserId: "anna" });
  eq(r.speed, 120, "two loads that each fit under a step both go where the party stays at its fastest");
  eq(new Set(w.log.delivered.map((d) => d.uuid)).size, 2, "one to each member");
  eq(r.leftover, [], "nothing is left");
}

/* --- refusals, one at a time, a failed delivery, a failed split --- */
{
  const w = world({ members: [], cards: [card("a")] });
  eq((await send(w, { requestUserId: "anna" })).reason, REFUSAL.noParty, "no party is refused");

  const x = world({ members: [member("m1", 30)], cards: [card("a")] });
  eq((await send(x, { requestUserId: "out" })).reason, REFUSAL.notAllowed, "a seat outside the audience is refused");
  const closed = world({ members: [member("m1", 30)], cards: [card("a")], pot: { phase: PHASE.staging } });
  eq((await send(closed, { requestUserId: "gm" })).reason, REFUSAL.phase, "a pot not open is refused");
  const empty = world({ members: [member("m1", 30)], cards: [card("d", {}, null)] });
  eq((await send(empty, { requestUserId: "anna" })).reason, REFUSAL.nothingToGrab);

  const y = world({ members: [member("m1", 30), member("m2", 30)], cards: [card("a", { weight6: 6 }), card("b", { weight6: 5 })] });
  const slow = y.relay.handle({ potId: "pot1", op: "grab", requestUserId: "anna" });
  eq((await y.relay.handle({ potId: "pot1", op: "grab", requestUserId: "gm" })).reason, REFUSAL.busy, "a second grab while one runs is refused");
  ok((await slow).ok, "the first still lands");
  ok((await send(y, { requestUserId: "anna" })).reason === REFUSAL.nothingToGrab, "a grab on a pot already shared has nothing left");
}
{
  const members = [member("m1", 30), member("m2", 30)];
  let calls = 0;
  const w = world({
    members,
    cards: [card("a", { weight6: 6 }), card("b", { weight6: 5 })],
    deliver: async (truth, uuid) => {
      calls++;
      if (truth.label === "a") return { ok: false, reason: REFUSAL.keepsNoGoods };
      if (truth.label === "b" && calls > 0) throw new Error("boom");
      return { ok: true, name: uuid };
    },
  });
  const r = await send(w, { requestUserId: "anna" });
  ok(r.ok, "a delivery that fails does not fail the grab");
  eq(r.leftover.map((l) => [l.cardId, l.code]).sort(), [["a", "failed"], ["b", "failed"]], "a card whose delivery failed or threw is leftover, its claim cleared");
  ok(w.store.cards.every((c) => !c.truth.claimedBy), "a failed delivery leaves no claim mark");
}
{
  const members = [member("m1", 6), member("m2", 6)];
  const w = world({ members, cards: [coinCard("coin", 100, 10)], failSplit: true });
  const r = await send(w, { requestUserId: "anna" });
  ok(r.ok, "a split that fails does not fail the grab");
  eq(w.store.cards.length, 1, "no card is made for a split that failed");
  eq(r.leftover[0].count, 100, "the coin is still whole in the pot");
}

/* --- a card dragged onto an actor's sheet --- */
{
  const pile = { id: "pot1" };
  const cards = { "Cards.pot1.Card.in": { id: "in", parent: pile }, "Cards.pot1.Card.out": { id: "out", parent: pile }, "Cards.other.Card.x": { id: "x", parent: { id: "other" } } };
  const sent = [];
  const said = [];
  const hook = createCardDrop({
    resolveCard: (uuid) => cards[uuid] ?? null,
    potOf: (p) => (p === pile ? { order: ["in"] } : null),
    send: async (request) => {
      sent.push(request);
      return { ok: false, reason: REFUSAL.notOwner };
    },
    report: (result) => said.push(result),
  });
  const actor = { uuid: "Actor.cleo" };
  eq(hook(actor, {}, { type: "Card", uuid: "Cards.pot1.Card.in" }), false, "a pot's card is taken over before the sheet's own drop goes on");
  eq(sent, [{ potId: "pot1", op: "claim", cardId: "in", actorUuid: "Actor.cleo" }], "its claim goes to the relay for the sheet's actor");
  await new Promise((r) => setTimeout(r, 0));
  eq(said, [{ ok: false, reason: REFUSAL.notOwner }], "the relay's refusal is said to the user");
  eq(hook(actor, {}, { type: "Card", uuid: "Cards.pot1.Card.out" }), undefined, "a Card the pot's order does not list is left to the sheet");
  eq(hook(actor, {}, { type: "Card", uuid: "Cards.other.Card.x" }), undefined, "a Card of a pile that is no pot is left alone");
  eq(hook(actor, {}, { type: "Card", uuid: "Cards.none" }), undefined, "a Card that resolves to nothing is left alone");
  eq(hook(actor, {}, { type: "Item", uuid: "Item.a" }), undefined, "an Item is left alone");
  eq(hook({}, {}, { type: "Card", uuid: "Cards.pot1.Card.in" }), undefined, "a target with no uuid is left alone");
  eq(sent.length, 1, "nothing but the one pot card sent a request");
}

console.log(`test-treasure-grab: ${checks} checks passed`);
