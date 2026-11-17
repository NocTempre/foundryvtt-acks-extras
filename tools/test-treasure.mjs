/**
 * Pure-logic tests for the treasure pot (Foundry-free): the flag shapes, what a
 * seat is shown of a card, the guards on a flip and a claim, opening and
 * closing, and what a claim delivers. Every name, count and rate here is this
 * file's own invention.
 */
import assert from "node:assert/strict";
import { BUCKET, PHASE, POOL, REFUSAL } from "../scripts/treasure/constants.mjs";
import {
  AURA_BACK_ICON, DEAL_TOGGLE, apparentName, backIconOf, bandsOf, buildCard, cardInPot, cardView, claimCoinCredits, claimItemData, dealOf, faceLook, flipUpdate, haulOf,
  normalizePot, normalizeTruth, placeAdds, planClaim, planClose, planFlip, planOpen, potCards, rankWorth, setToggle, shownPool, stage,
  turnedOf, unstage, withBands, worthOf,
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
  const recognized = cardView({ id: "c1", face: 0, value: 0, truth: { ...magicUndetected, detected: true, identified: "partial" } }, { isGM: false });
  eq(recognized.poolKey, POOL.item, "identified in part, the pool is still item");
  const identified = cardView({ id: "c1", face: 0, value: 0, truth: { ...magicUndetected, detected: true, identified: "full" } }, { isGM: false });
  eq(identified.poolKey, POOL.magic, "identified in full, a player is told magic");
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
  const built = buildCard(t, { poolLabel: (p) => `L:${p}` });
  eq(built.suit, POOL.item, "the Card's suit is the pool a seat is shown");
  eq(built.name, "L:item");
  eq(built.faces, [], "a built card has no face");
  ok(built.face === null, "a built card is face down");
  eq(built.value, 0, "a new card is band 0 until the pot opens and ranks it");
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

/* ====== R2: bands, backs, faces and deal toggles ====== */

const snap = (cost, markets = {}) => ({ name: "Thing", type: "item", system: { cost }, flags: { "acks-extras": { markets } } });
const item = (label, cost, over = {}) => truth({ label, source: { uuid: `Item.${label}`, data: snap(cost) }, ...over });
const magicItem = (label, cost, over = {}) =>
  truth({ pool: POOL.magic, label, magical: true, source: { uuid: `Item.${label}`, data: snap(cost, { magic: true }) }, ...over });
const stagingView = (cards, pot = {}) =>
  view(cards, { phase: PHASE.staging, audience: [], order: cards.map((c) => c.id), ...pot });
const cardOf = (id, t, face = null, value = 0) => ({ id, face, value, truth: t });

/* --- bandsOf: rank within the list --- */
{
  eq(bandsOf([]), [], "an empty list ranks nothing and does not throw");
  eq(bandsOf([7]), [0], "a pot of one is band 0");
  eq(bandsOf([3, 3]), [0, 0], "two equal worths share a band");
  eq(bandsOf([1, 2]), [0, 2], "two distinct worths: the lower is band 0, the higher is 4*1/2 = 2");
  eq(bandsOf([5, 5, 5, 5, 5]), [0, 0, 0, 0, 0], "all equal is band 0");
  eq(bandsOf([1, 2, 3, 4, 5, 6, 7, 8]), [0, 0, 1, 1, 2, 2, 3, 3], "eight distinct worths spread over four bands");
  eq(bandsOf([1, 1, 5, 9]), [0, 0, 2, 3], "ties share a band: the number of strictly lower worths ranks");
  eq(bandsOf([9, 1, 5, 1]), [3, 0, 2, 0], "the order of the list does not matter");
  eq(bandsOf([null, "x", undefined, 4]), [0, 0, 0, 3], "a worth that is no number ranks as nothing");
  const many = bandsOf(Array.from({ length: 37 }, (_, i) => i * i));
  ok(many.every((b) => Number.isInteger(b) && b >= 0 && b <= 3), "every band of a larger pot is in range");
  eq([...new Set(many)].sort(), [0, 1, 2, 3], "a larger pot uses all four bands");
}

/* --- rankWorth: coin, value card, mask, snapshot, undetected magic --- */
{
  eq(rankWorth(truth({ coin: { name: "Pebble", cv: 10, count: 30 } })), 3, "coin ranks by count at its rate");
  eq(rankWorth(truth({ valueGp: 12 })), 12, "a value card ranks by its stated worth");
  eq(rankWorth(item("A", 40)), 40, "an item ranks by the snapshot's cost");
  eq(rankWorth(item("A", 40, { mask: { name: "B", cost: 6 } })), 6, "a mask's cost outranks the snapshot's");
  eq(rankWorth(item("A", 40, { mask: { name: "B", cost: 0 } })), 0, "a mask that says zero is zero");
  eq(rankWorth(item("A", 40, { mask: { name: "B" } })), 40, "a mask with no cost falls to the snapshot's");
  eq(rankWorth(truth()), 0, "an item with no cost ranks as nothing");
  eq(rankWorth(magicItem("M", 9000, { detected: false, mask: { name: "Plain", cost: 5 } })), 5, "undetected magic ranks by its mask");
  eq(rankWorth(magicItem("M", 9000, { detected: false })), 0, "undetected magic with no mask cost never ranks by its own cost");
  eq(rankWorth(magicItem("M", 9000, { detected: true })), 9000, "detected magic ranks by what it is");
}

/* --- bands frozen at open; an undetected magic item takes its mask's band --- */
{
  const plain = (id, cost) => cardOf(id, item(id, cost));
  const cards = [
    plain("c1", 1), plain("c2", 10), plain("c3", 100),
    cardOf("coin", truth({ pool: POOL.coins, coin: { name: "Pebble", cv: 1, count: 1000 } })), // 10 gp, ties c2
    cardOf("m", magicItem("Sword", 9000, { detected: false, mask: { name: "Stick", cost: 100 } })), // masked at 100, ties c3
  ];
  const v = stagingView(cards);
  const plan = planOpen(v, { audience: [ANNA.id], rng: () => 0 });
  ok(plan.ok);
  eq(plan.bands, { c1: 0, c2: 0, coin: 0, c3: 2, m: 2 }, "coin, item and masked magic rank together; ties share a band");
  eq(plan.bands.m, plan.bands.c3, "an undetected magic item takes its mask's band");

  const high = stagingView([...cards.slice(0, 3), cardOf("m", magicItem("Sword", 9000, { detected: false, mask: { name: "Stick", cost: 100 } }))]);
  eq(dealOf(high).bands.m, dealOf(high).bands.c3, "the masked band does not depend on the true cost");
  const cheap = stagingView([...cards.slice(0, 3), cardOf("m", magicItem("Sword", 1, { detected: false, mask: { name: "Stick", cost: 100 } }))]);
  eq(dealOf(cheap).bands, dealOf(high).bands, "nor on any change to it");

  const preview = withBands(v);
  eq(preview.cards.map((c) => c.value), [0, 0, 2, 0, 2], "a staging view previews the bands opening would give");
  eq(v.cards.map((c) => c.value), [0, 0, 0, 0, 0], "and the stored cards are not touched");
  const frozen = view(cards.map((c) => ({ ...c, value: plan.bands[c.id] })));
  eq(withBands(frozen), frozen, "an open pot's view is returned as it is: its bands never move");
  const moved = view(cards.map((c) => (c.id === "c1" ? { ...c, value: plan.bands[c.id], truth: item("c1", 99999) } : { ...c, value: plan.bands[c.id] })));
  eq(withBands(moved).cards.map((c) => c.value), cards.map((c) => plan.bands[c.id]), "a later change of worth moves no band");

  eq(planOpen(stagingView([plain("only", 5)]), { audience: [], rng: () => 0 }).bands, { only: 0 }, "a pot of one opens in band 0");
  eq(planOpen(stagingView([plain("a", 5), plain("b", 5)]), { audience: [], rng: () => 0 }).bands, { a: 0, b: 0 }, "a pot of equals opens in band 0");
  const seeds = stagingView([plain("a", 1), plain("s", 50), plain("r", 2)], { order: ["a"], buckets: { add: ["s"], replace: ["r"] } });
  eq(Object.keys(planOpen(seeds, { audience: [], rng: () => 0 }).bands).sort(), ["a", "r", "s"], "seeds are ranked with the rest");
}

/* --- the back: an undetected magic card wears its plain twin's --- */
{
  const plainTwin = item("Spoon", 5);
  const undetected = magicItem("Spoon of ruin", 9000, { detected: false, identified: "none", mask: { name: "Spoon", cost: 5 } });
  const down = (t, value = 2) => cardView(cardOf("x", t, null, value), { isGM: false });
  const a = down(plainTwin);
  const b = down(undetected);
  eq(b, a, "a player's view of an undetected magic card equals a plain card's of the same band");
  eq(backIconOf(undetected), backIconOf(plainTwin), "same back icon");
  const builtPlain = buildCard(plainTwin, { band: 2, poolLabel: (p) => `L:${p}` });
  const builtMagic = buildCard(undetected, { band: 2, poolLabel: (p) => `L:${p}` });
  eq({ ...builtMagic, flags: null }, { ...builtPlain, flags: null }, "and the Card document carries nothing the plain one does not");
  ok(!/magic|curs/i.test(JSON.stringify(b)), "the undetected back's view names neither magic nor curse");
  ok(b.auraBack === false, "no aura mark on an undetected back");

  const detected = magicItem("Spoon of ruin", 9000, { detected: true, identified: "none" });
  const d = down(detected);
  eq(d.backIcon, AURA_BACK_ICON, "detection changes the back's icon");
  eq({ ...d, backIcon: null, auraBack: false }, { ...a, backIcon: null, auraBack: false }, "and nothing else on the back");
  ok(d.auraBack === true && d.backKey === POOL.item, "a detected card is still labelled an item until it is identified");
  const recognized = down(magicItem("Spoon of ruin", 9000, { detected: true, identified: "partial" }));
  eq(recognized.backKey, POOL.item, "identified in part, it is still labelled an item");
  const identified = down(magicItem("Spoon of ruin", 9000, { detected: true, identified: "full" }));
  eq(identified.backIcon, AURA_BACK_ICON, "an identified magic card keeps the aura icon");
  eq(identified.backKey, POOL.magic, "and is labelled magic");
  ok(!JSON.stringify({ ...down(plainTwin) }).includes(AURA_BACK_ICON), "a plain card's back never carries the aura icon");
}

/* --- faces: magic once identified in full, cursed once shown --- */
{
  const marks = (m) => ({ uuid: "Item.z", data: snap(0, { magic: true, ...m }) });
  const face = (t, isGM = false) => faceLook(t, { isGM });
  const m = (over, markOver) => truth({ pool: POOL.magic, magical: true, source: marks(markOver), ...over });
  eq(face(truth()), "plain", "an ordinary card is plain");
  eq(face(m({ detected: true, identified: "none" })), "plain", "detected is not identified: the face stays plain");
  eq(face(m({ detected: true, identified: "partial" })), "plain", "recognized is not identified: the face stays plain");
  eq(face(m({ detected: true, identified: "full" })), "magic");
  eq(face(m({ detected: false, identified: "partial" })), "plain", "magic nobody knows of is not shown");
  eq(face(m({ detected: false, identified: "none" }), true), "magic", "the Judge always reads the truth");
  eq(face(truth(), true), "plain", "and an ordinary card is plain to the Judge");

  const cursed = (over, markOver = {}) => m(over, { cursed: true, ...markOver });
  eq(face(cursed({ detected: true, identified: "full" })), "magic", "a curse not yet known is not shown");
  eq(face(cursed({ detected: true, identified: "full" }), true), "cursed", "the Judge sees the curse at once");
  eq(face(cursed({ detected: true, identified: "full" }, { curseKnown: true })), "cursed", "a known curse turns the face cursed");
  eq(face(cursed({ detected: true, identified: "none" }, { curseKnown: true })), "cursed", "a curse the Judge has told the table of is shown");
  eq(face(truth({ source: { uuid: "Item.z", data: snap(0, { cursed: true, curseKnown: true }) } })), "plain", "a cursed mark on an ordinary item shows nothing");
  eq(face(m({ detected: true, identified: "full" }, { cursed: false, curseKnown: true })), "magic", "a known flag with no curse shows no curse");
  const variation = truth({ pool: POOL.magic, magical: true, detected: true, identified: "full", source: { uuid: "Item.v", data: snap(0, {}) } });
  eq(face(variation), "magic", "a card the deal read as magic stays magic where the snapshot declares none");
  eq(face({ ...variation, source: { uuid: "Item.v", data: snap(0, { cursed: true, curseKnown: true }) } }), "cursed", "and its curse counts");

  const turned = (t, isGM) => cardView(cardOf("x", t, 0), { isGM });
  eq(turned(m({ detected: true, identified: "full" })).look, "magic", "a turned card carries its look");
  eq(cardView(cardOf("x", m({ detected: true, identified: "full" }), null), { isGM: false }).look, "plain", "a face-down card never does");
  eq(cardView(cardOf("x", cursed({ detected: false, identified: "none" }), null), { isGM: true }).look, "cursed", "the Judge's tile of a face-down card does");
  ok(!/curs/i.test(JSON.stringify(turned(m({ detected: true, identified: "none" })))), "no word of a curse in a view that may not show one");
}

/* --- deal toggles --- */
{
  eq(normalizePot({}).deal.toggles, { noMagic: false, forceCursed: false }, "both toggles are present and off");
  eq(normalizePot({ deal: { toggles: { noMagic: 1, bogus: true, forceCursed: true } } }).deal.toggles, { noMagic: false, forceCursed: true }, "only true toggles of known keys are kept");
  const staged = normalizePot({ phase: PHASE.staging });
  eq(setToggle(staged, DEAL_TOGGLE.noMagic, true).deal.toggles.noMagic, true, "a toggle is set");
  ok(setToggle(staged, "bogus", true) === null, "an unknown toggle is refused");
  ok(setToggle(normalizePot({ phase: PHASE.open }), DEAL_TOGGLE.noMagic, true) === null, "no toggle once the pot is open");
  ok(staged.deal.toggles.noMagic === false, "the pot is not mutated");

  const cards = [
    cardOf("p1", item("Spoon", 5)),
    cardOf("m1", magicItem("Wand A", 500)),
    cardOf("m2", magicItem("Wand B", 700, { detected: false, mask: { name: "Stick", cost: 1 } })),
    cardOf("seed", magicItem("Wand C", 900)),
    cardOf("p2", item("Plate", 60)),
  ];
  const base = { order: ["p1", "m1", "m2", "p2"], buckets: { add: ["seed"], replace: [] } };
  const off = dealOf(stagingView(cards, base));
  eq(off.removed, [], "no toggle, nothing removed");
  eq(off.forced, []);
  eq(off.audit, [], "and nothing to record");
  eq(off.kept.length, 5);

  const nm = stagingView(cards, { ...base, deal: { toggles: { noMagic: true } } });
  const planNm = planOpen(nm, { audience: [], rng: () => 0 });
  ok(planNm.ok);
  eq(planNm.removed.sort(), ["m1", "m2", "seed"], "No magic removes every magic card, undetected and seeded ones included");
  eq(planNm.flag.order, ["p1", "p2"], "the pot opens without them");
  eq(Object.keys(planNm.bands).sort(), ["p1", "p2"], "bands rank the survivors only");
  eq(planNm.bands, { p1: 0, p2: 2 }, "two survivors: the lower is band 0");
  eq(planNm.audit, [{ toggle: "noMagic", names: ["Wand A", "Wand B", "Wand C"] }], "the record lists what the toggle removed, by true name");
  const preview = withBands(nm);
  eq(preview.cards.find((c) => c.id === "m1").value, 0, "a card the toggle will remove keeps its stored value in the preview");

  const allMagic = stagingView([cardOf("m1", magicItem("Wand A", 5))], { order: ["m1"], deal: { toggles: { noMagic: true } } });
  eq(planOpen(allMagic, { audience: [], rng: () => 0 }).reason, REFUSAL.dealEmpty, "a toggle that would empty the pot refuses the opening");

  const fc = stagingView(cards, { ...base, deal: { toggles: { forceCursed: true } } });
  const planFc = planOpen(fc, { audience: [], rng: () => 0 });
  eq(planFc.forced.map((f) => f.id).sort(), ["m1", "m2", "seed"], "Force cursed marks the magic cards and no others");
  for (const f of planFc.forced) {
    ok(f.flags["acks-extras"].markets.cursed === true, "the snapshot's markets flag is cursed");
    ok(f.flags["acks-extras"].markets.magic === true, "the rest of the markets flag is kept");
    ok(!("curseKnown" in f.flags["acks-extras"].markets), "the curse is not made known");
  }
  ok(!("cursed" in cards[1].truth.source.data.flags["acks-extras"].markets), "the card's own snapshot is not mutated");
  eq(planFc.audit, [{ toggle: "forceCursed", names: ["Wand A", "Wand B", "Wand C"] }], "the record lists the cards it marked");
  eq(planFc.removed, [], "and removes none");

  const both = planOpen(stagingView(cards, { ...base, deal: { toggles: { noMagic: true, forceCursed: true } } }), { audience: [], rng: () => 0 });
  eq(both.forced, [], "with both on, no magic card is left to curse");
  eq(both.audit.map((r) => r.toggle), ["noMagic", "forceCursed"]);
  eq(both.audit[1].names, [], "and the record says the second changed nothing");

  const unsnapped = cardOf("ns", truth({ pool: POOL.magic, magical: true, label: "Ghost" }));
  eq(dealOf(stagingView([unsnapped], { deal: { toggles: { forceCursed: true } } })).forced, [], "a magic card with no snapshot has nothing to mark");
}

/* --- a forced curse reaches the claimed item, masked or not --- */
{
  const { disguiseData } = await import("../scripts/equipment/disguise-logic.mjs");
  const { curseKnowledge } = await import("../scripts/lib/item-model.mjs");
  const cards = [cardOf("m1", magicItem("Wand A", 500, { mask: { name: "Stick" } })), cardOf("m2", magicItem("Wand B", 700))];
  const plan = planOpen(stagingView(cards, { deal: { toggles: { forceCursed: true } } }), { audience: [], rng: () => 0 });
  for (const f of plan.forced) {
    const src = cards.find((c) => c.id === f.id).truth;
    const forcedTruth = { ...src, source: { ...src.source, data: { ...src.source.data, flags: f.flags } } };
    const made = claimItemData(forcedTruth, disguiseData);
    ok(made.flags["acks-extras"].markets.cursed === true, `${f.id}: the claimed item is cursed (disguiseData keeps the mark)`);
    ok(made.flags["acks-extras"].markets.curseKnown !== true, `${f.id}: and the table is not told`);
    ok(curseKnowledge(made, { isGM: true }).cursed, `${f.id}: the reader agrees`);
    ok(!curseKnowledge(made, { isGM: false }).showCurse, `${f.id}: and shows a player nothing`);
  }
  eq(plan.forced.length, 2);
}

console.log(`test-treasure: ${checks} checks passed`);
