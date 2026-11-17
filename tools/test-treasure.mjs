/**
 * Pure-logic tests for the treasure pot (Foundry-free): the flag shapes, what a
 * seat is shown of a card, the guards on a flip and a claim, opening and
 * closing, and what a claim delivers. Every name, count and rate here is this
 * file's own invention.
 */
import assert from "node:assert/strict";
import { BUCKET, PHASE, POOL, REFUSAL } from "../scripts/treasure/constants.mjs";
import {
  apparentName, bandOf, buildCard, cardInPot, cardView, claimCoinCredits, claimItemData, flipUpdate, haulOf, normalizePot,
  normalizeTruth, placeAdds, planClaim, planClose, planFlip, planOpen, potCards, shownPool, stage, turnedOf, unstage, worthOf,
} from "../scripts/treasure/pot-logic.mjs";

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

const GM = { id: "gm1", isGM: true };
const ANNA = { id: "u-anna", isGM: false };
const BEN = { id: "u-ben", isGM: false };

const truth = (over = {}) => normalizeTruth({ pool: POOL.item, label: "Wooden spoon", weight6: 1, ...over });
const card = (id, over = {}, face = null, value = 0) => ({ id, face, value, truth: truth(over) });
const view = (cards, pot = {}) => ({
  id: "pot1",
  pot: normalizePot({ phase: PHASE.open, audience: [ANNA.id, BEN.id], order: cards.map((c) => c.id), ...pot }),
  cards,
});

/* --- normalizing --- */
{
  const pot = normalizePot({ phase: "nonsense", order: ["a", 5, "", "b"], buckets: { add: ["x"] }, flippers: ["u1"] });
  eq(pot.phase, PHASE.staging, "an unknown phase is staging");
  eq(pot.order, ["a", "b"], "non-ids are dropped from order");
  eq(pot.buckets, { add: ["x"], replace: [] });
  eq(normalizePot(null).flippers, null, "no flippers list means every seat in the audience");
  const t = normalizeTruth({ pool: "bogus", coin: { count: 12.7, cv: 5 }, detected: undefined });
  eq(t.pool, POOL.item, "an unknown pool is an item");
  eq(t.coin.count, 12, "a coin count is whole");
  ok(t.detected === true, "an absent detected key reads as detected");
  eq(normalizeTruth({ detected: false }).detected, false);
}

/* --- what a seat is shown --- */
{
  const magicUndetected = truth({
    pool: POOL.magic, label: "Sword of Zork", magical: true, detected: false, identified: "none",
    mask: { name: "Plain blade", img: "icons/plain.webp" }, source: { uuid: "Item.abc", data: { name: "Sword of Zork", img: "icons/real.webp" } },
  });
  eq(shownPool(magicUndetected, { isGM: false }), POOL.item, "a player is told item, not magic");
  eq(shownPool(magicUndetected, { isGM: true }), POOL.magic, "a Judge reads the truth");
  const down = cardView({ id: "c1", face: null, value: 2, truth: magicUndetected }, { isGM: false });
  const up = cardView({ id: "c1", face: 0, value: 2, truth: magicUndetected }, { isGM: false });
  for (const v of [down, up]) {
    ok(!/magic|zork/i.test(JSON.stringify(v)), `a player's view of an undetected magic card says nothing magic: ${JSON.stringify(v)}`);
  }
  eq(down.name, "", "a face-down card shows no name");
  eq(up.name, "Plain blade", "a turned card shows its mask");
  ok(up.aura === false, "no aura while undetected");
  const detected = cardView({ id: "c1", face: 0, value: 0, truth: { ...magicUndetected, detected: true } }, { isGM: false });
  ok(detected.aura === true, "a detected magic card shows an aura once turned");
  eq(detected.poolKey, POOL.item, "detected is not identified: the pool is still item");
  const identified = cardView({ id: "c1", face: 0, value: 0, truth: { ...magicUndetected, detected: true, identified: "partial" } }, { isGM: false });
  eq(identified.poolKey, POOL.magic, "identified past none, a player is told magic");
  const judge = cardView({ id: "c1", face: null, value: 0, truth: magicUndetected }, { isGM: true });
  eq(judge.name, "Sword of Zork");
  eq(judge.maskName, "Plain blade");
  ok(judge.aura && !judge.leaks, "a masked undetected card does not leak");
  ok(cardView({ id: "c2", face: null, value: 0, truth: { ...magicUndetected, mask: null } }, { isGM: true }).leaks, "an undetected card with no mask is flagged to the Judge");
  eq(cardView({ id: "c3", face: null, value: 99, truth: truth() }).band, 3, "a band is clamped");
  ok(cardView({ id: "c3", face: null, value: 0, truth: truth({ bucket: BUCKET.add }) }, { isGM: true }).seed, "a Judge sees a seed marked");
  ok(!cardView({ id: "c3", face: null, value: 0, truth: truth({ bucket: BUCKET.add }) }, { isGM: false }).seed, "a player never does");
}

/* --- buildCard and flipUpdate --- */
{
  const t = truth({ pool: POOL.magic, label: "Wand", magical: true, detected: false, identified: "none" });
  const built = buildCard(t, { band: bandOf(t, null), poolLabel: (p) => `L:${p}` });
  eq(built.suit, POOL.item, "the Card's suit is the pool a seat is shown");
  eq(built.name, "L:item");
  eq(built.faces, [], "a built card has no face");
  ok(built.face === null, "a built card is face down");
  eq(built.value, 0, "every band is 0 until the bands are computed");
  ok(!JSON.stringify({ ...built, flags: undefined }).includes("magic"), "nothing but the flag names the truth");
  const update = flipUpdate("c9", truth({ label: "Spoon", mask: { name: "Ladle", img: "icons/x.webp" } }));
  eq(Object.keys(update).sort(), ["_id", "face", "faces"], "a flip is one update carrying faces and face together");
  eq(update.face, 0);
  eq(update.faces[0].name, "Ladle");
  eq(apparentName(truth({ label: "Spoon" })), "Spoon");
}

/* --- cardInPot: order is the authority --- */
{
  const v = view([card("a"), card("b")], { order: ["a"] });
  ok(cardInPot(v, "a"), "a listed card is in the pot");
  ok(cardInPot(v, "b") === null, "a Card not in order is ignored");
  ok(cardInPot(v, 7) === null);
  eq(potCards(v).map((c) => c.id), ["a"], "the window lists only order");
  eq(turnedOf(view([card("a", {}, 0), card("b")])), { turned: 1, count: 2 });
}

/* --- planFlip --- */
{
  const v = view([card("a"), card("planted")], { order: ["a"] });
  const good = planFlip(v, "a", { sender: ANNA });
  ok(good.ok && good.update.face === 0, "a seated player flips a face-down card");
  eq(planFlip(v, "planted", { sender: ANNA }).reason, REFUSAL.notInPot, "a planted card is refused");
  eq(planFlip(view([card("a")], { phase: PHASE.staging }), "a", { sender: ANNA }).reason, REFUSAL.phase, "no flip while staging");
  eq(planFlip(view([card("a")], { phase: PHASE.staging }), "a", { sender: GM }).reason, REFUSAL.phase, "not even the Judge's");
  eq(planFlip(view([card("a")], { phase: PHASE.closed }), "a", { sender: ANNA }).reason, REFUSAL.phase, "no flip once closed");
  eq(planFlip(view([card("a")], { audience: [BEN.id] }), "a", { sender: ANNA }).reason, REFUSAL.notAllowed, "a seat outside the audience");
  eq(planFlip(view([card("a")], { flippers: [BEN.id] }), "a", { sender: ANNA }).reason, REFUSAL.notAllowed, "a seat not among the flippers");
  ok(planFlip(view([card("a")], { flippers: [BEN.id] }), "a", { sender: GM }).ok, "the Judge turns regardless of the flippers list");
  eq(planFlip(view([card("a", {}, 0)]), "a", { sender: ANNA }).reason, REFUSAL.alreadyUp, "a turned card is not turned again");
  eq(planFlip(null, "a", { sender: ANNA }).reason, REFUSAL.noPot);
}

/* --- planClaim --- */
{
  const up = card("a", {}, 0);
  const mine = { sender: ANNA, hasTarget: true, owns: true, ownedByTable: true };
  ok(planClaim(view([up]), "a", mine).ok, "a seated player claims a turned card onto their actor");
  eq(planClaim(view([up]), "a", { ...mine, owns: false }).reason, REFUSAL.notOwner, "an actor the sender does not own is refused");
  eq(planClaim(view([up]), "a", { ...mine, hasTarget: false, owns: false }).reason, REFUSAL.noTarget);
  eq(planClaim(view([card("a")]), "a", mine).reason, REFUSAL.faceDown, "a face-down card cannot be claimed");
  eq(planClaim(view([card("a", { claimedBy: { userId: "x" } }, 0)]), "a", mine).reason, REFUSAL.claimed, "a claimed card cannot be claimed again");
  eq(planClaim(view([up], { order: [] }), "a", mine).reason, REFUSAL.notInPot, "a card not in order is ignored");
  eq(planClaim(view([up], { phase: PHASE.staging }), "a", mine).reason, REFUSAL.phase);
  eq(planClaim(view([up], { phase: PHASE.closed }), "a", mine).reason, REFUSAL.phase);
  eq(planClaim(view([up], { audience: [] }), "a", mine).reason, REFUSAL.notAllowed);
  const judge = planClaim(view([up]), "a", { sender: GM, hasTarget: true, owns: true, ownedByTable: false });
  ok(judge.ok && judge.warn, "the Judge may give to any actor, with a warning for one no seat owns");
  ok(!planClaim(view([up]), "a", { sender: GM, hasTarget: true, owns: true, ownedByTable: true }).warn, "no warning for a table's own actor");
}

/* --- staging, open and close --- */
{
  const staging = normalizePot({ phase: PHASE.staging });
  const a = stage(staging, "c1");
  const b = stage(a, "c2", { bucket: BUCKET.add });
  const c = stage(b, "c3", { bucket: BUCKET.replace });
  eq(c.order, ["c1"]);
  eq(c.buckets, { add: ["c2"], replace: ["c3"] }, "bucket cards stay out of order");
  eq(unstage(c, "c2").buckets.add, []);
  eq(stage(normalizePot({ phase: PHASE.open }), "c9"), null, "nothing is staged once open");

  const cards = ["c1", "c2", "c3"].map((id) => card(id));
  const opened = planOpen({ id: "p", pot: c, cards }, { audience: [ANNA.id], rng: () => 0 });
  ok(opened.ok);
  eq(opened.flag.phase, PHASE.open);
  eq(opened.flag.order, ["c2", "c1", "c3"], "an add card lands at the drawn position, a replace card joins as it is");
  eq(opened.flag.buckets, { add: [], replace: [] });
  eq(opened.flag.audience, [ANNA.id]);
  eq(planOpen({ id: "p", pot: opened.flag, cards }, { audience: [], rng: () => 0 }).reason, REFUSAL.phase, "an open pot is not opened again");
  eq(planOpen({ id: "p", pot: staging, cards: [] }, { audience: [], rng: () => 0 }).reason, REFUSAL.empty);
  eq(placeAdds(["a", "b"], ["x"], () => 0.999), ["a", "b", "x"]);
  eq(placeAdds(["a", "b"], ["x", "y"], () => 0), ["y", "x", "a", "b"]);

  const closed = planClose(view([card("a", { claimedBy: { userId: "u", actorName: "Cleo" } }, 0), card("b", { label: "Secret" }, 0)]));
  ok(closed.ok && closed.flag.phase === PHASE.closed);
  eq(closed.left.map((c) => c.id), ["b"], "only the unclaimed are leftovers");
  eq(closed.record.length, 2);
  eq(planClose(view([], { phase: PHASE.closed })).reason, REFUSAL.phase);
}

/* --- worth and haul --- */
{
  const coin = truth({ pool: POOL.coins, label: "30 pebbles", coin: { name: "Pebble", cv: 10, count: 30 } });
  eq(worthOf(coin), 3, "a coin's worth is its count at its rate, in gp");
  eq(worthOf(truth({ valueGp: 12.5 })), 12.5);
  eq(worthOf(truth()), null, "an item states no worth");
  const views = [
    cardView({ id: "1", face: 0, value: 0, truth: coin }),
    cardView({ id: "2", face: null, value: 0, truth: truth({ pool: POOL.gems, valueGp: 8 }) }),
    cardView({ id: "3", face: 0, value: 0, truth: truth() }),
  ];
  eq(haulOf(views).totalGp, 3, "the haul counts turned cards");
  const judges = [coin, truth({ pool: POOL.gems, valueGp: 8 }), truth()].map((t, i) => cardView({ id: String(i), face: i === 0 ? 0 : null, value: 0, truth: t }, { isGM: true }));
  eq(haulOf(judges, { all: true }).totalGp, 11, "the pot's value, read by the Judge, counts them all");
  eq(haulOf(views, { all: true }).totalGp, 3, "a player is never shown a face-down card's worth");
  eq(haulOf(views).parts, [{ poolKey: POOL.coins, gp: 3 }]);
}

/* --- claim goods --- */
{
  const calls = [];
  const disguise = (data, apparent) => {
    calls.push(apparent);
    return { ...data, flags: { ...data.flags }, disguised: true };
  };
  const base = { type: "item", name: "Gadget", _id: "old", flags: { "acks-extras": { markets: { identified: "none" } } } };
  const masked = claimItemData(truth({ source: { uuid: "Item.z", data: base }, mask: { name: "Trinket" }, detected: false }), disguise);
  eq(calls, [{ name: "Trinket" }], "the mask reaches disguiseData");
  ok(masked.disguised && masked.flags["acks-extras"].markets.detected === false, "an undetected card writes detected:false");
  eq(masked.flags["acks-extras"].markets.identified, "none", "the rest of the markets flag is kept");
  ok(!("_id" in masked), "the new item takes no id");
  ok(base._id === "old" && !("detected" in base.flags["acks-extras"].markets), "the card's snapshot is never mutated");
  const plain = claimItemData(truth({ source: { uuid: "Item.z", data: base }, detected: true }), disguise);
  ok(!plain.flags["acks-extras"].markets || !("detected" in plain.flags["acks-extras"].markets), "a card that says detected writes no flag");
  eq(calls.length, 1, "no mask means no disguise");
  eq(claimItemData(truth({ source: { uuid: null, data: null } }), disguise), null, "a card holding no item delivers none");
  eq(claimItemData(truth({ coin: { name: "Pebble", cv: 1, count: 5 }, source: { data: base } }), disguise), null, "a coin card is not an item");

  const snap = { type: "money", name: "Pebble", system: { coppervalue: 10, quantity: 99 } };
  const t = truth({ pool: POOL.coins, coin: { name: "Pebble", cv: 10, count: 30 }, source: { data: snap } });
  eq(claimCoinCredits(t), [{ source: snap, count: 30 }], "a coin card credits its own kind at its own count");
  const tpl = { type: "money", name: "Pebble", system: { coppervalue: 10 } };
  eq(claimCoinCredits(truth({ coin: { name: "Pebble", cv: 10, count: 4 } }), tpl), [{ source: tpl, count: 4 }], "a named coin uses the world's template");
  eq(claimCoinCredits(truth({ coin: { name: "Pebble", cv: 10, count: 4 } }), null), null, "no template and no snapshot writes nothing");
  eq(claimCoinCredits(truth({ coin: { name: "Pebble", cv: 10, count: 0 }, source: { data: snap } })), null, "an empty lot writes nothing");
}

console.log(`test-treasure: ${checks} checks passed`);
