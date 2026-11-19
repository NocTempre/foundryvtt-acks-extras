/**
 * Pure-logic tests for "Search the fallen" (Foundry-free): which combatants
 * count as fallen, the record built from snapshots that outlives its bodies,
 * and which goods leave the bodies once their lots are found.
 * Every creature, item and table here is this file's own invention.
 */
import assert from "node:assert/strict";
import {
  DRAW_REQUEST, cardRows, entryOf, fallenOf, heldDraw, holdsAnything, isDefeated, isHostile, isNaturalWeapon, letterOf, needsTakeOff,
  normalizeRecord, planTakeOff, recordOf, specOfResult, uuidOfLink,
} from "../scripts/treasure/search-logic.mjs";

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

const HOSTILE = -1;
const NEUTRAL = 0;
const FRIENDLY = 1;

const facts = (over = {}) => ({
  id: "c1", name: "Mossback", actorUuid: "Actor.a1", disposition: HOSTILE, flagged: false, dead: false, hp: 5, ...over,
});
const idsOf = (list) => list.map((f) => f.id);

/* --- hostility --- */
{
  ok(isHostile(HOSTILE, HOSTILE), "the hostile disposition is hostile");
  ok(!isHostile(FRIENDLY, HOSTILE), "friendly is not hostile");
  ok(!isHostile(NEUTRAL, HOSTILE), "neutral is not hostile");
  ok(!isHostile(null, HOSTILE), "no token, no disposition, not hostile");
  ok(!isHostile(HOSTILE, null), "no constant to compare with is never hostile");
}

/* --- defeat --- */
{
  ok(!isDefeated(), "no facts is not defeated");
  ok(isDefeated({ flagged: true, hp: 9 }), "the tracker's mark defeats");
  ok(isDefeated({ dead: true, hp: 9 }), "the dead status defeats");
  ok(isDefeated({ hp: 0 }), "zero hit points defeat");
  ok(isDefeated({ hp: -3 }), "below zero defeats");
  ok(!isDefeated({ hp: 1 }), "one hit point is standing");
  ok(!isDefeated({ hp: null }), "hit points that cannot be read are not defeat");
  ok(!isDefeated({ hp: Number.NaN }), "a NaN is not defeat");
  ok(!isDefeated({ hp: "0" }), "a string is not a reading");
}

/* --- who counts as fallen: the defeated x hostile matrix --- */
{
  const alive = { hp: 5 };
  const downs = { flagged: { flagged: true, hp: 5 }, dead: { dead: true, hp: 5 }, hpZero: { hp: 0 } };
  const rows = [];
  let n = 0;
  for (const [dispName, disposition] of [["hostile", HOSTILE], ["friendly", FRIENDLY], ["neutral", NEUTRAL], ["none", null]]) {
    rows.push({ key: `${dispName}/alive`, expect: false, f: facts({ id: `r${n++}`, disposition, ...alive }) });
    for (const [downName, down] of Object.entries(downs)) {
      rows.push({
        key: `${dispName}/${downName}`,
        expect: disposition === HOSTILE,
        f: facts({ id: `r${n++}`, disposition, ...down }),
      });
    }
  }
  const got = new Set(idsOf(fallenOf(rows.map((r) => r.f), { hostile: HOSTILE })));
  for (const r of rows) eq(got.has(r.f.id), r.expect, `${r.key}: ${r.expect ? "fallen" : "not fallen"}`);
  eq(got.size, 3, "exactly the three defeated hostile rows");

  eq(idsOf(fallenOf([facts({ actorUuid: null, flagged: true })], { hostile: HOSTILE })), [], "no actor, nothing to search");
  eq(idsOf(fallenOf([facts({ disposition: null, flagged: true })], { hostile: HOSTILE })), [], "no token, no disposition, left out");
  eq(fallenOf(null, { hostile: HOSTILE }), [], "no list is no fallen");
  eq(fallenOf([null, undefined, {}], { hostile: HOSTILE }), [], "junk rows are skipped");
  eq(idsOf(fallenOf([facts({ id: "z", hp: -2 }), facts({ id: "y", hp: 4 })], { hostile: HOSTILE })), ["z"], "a hostile at zero or below is fallen");
}

/* --- a creature's own body is not carried goods --- */
{
  ok(isNaturalWeapon({ type: "weapon", flags: { "acks-extras": { naturalWeapon: "claw" } } }), "a flagged weapon is the body");
  ok(!isNaturalWeapon({ type: "weapon", flags: { "acks-extras": { naturalWeapon: "" } } }), "a blank flag is a carried weapon");
  ok(!isNaturalWeapon({ type: "weapon", flags: {} }), "an unflagged weapon is carried");
  ok(!isNaturalWeapon({ type: "item", flags: { "acks-extras": { naturalWeapon: "claw" } } }), "only a weapon is a natural weapon");
  ok(!isNaturalWeapon(null));
  ok(isNaturalWeapon({ type: "weapon", system: { cost: 0 }, flags: {} }, { ownerType: "monster" }), "a monster's weapon with no cost is its attack");
  ok(isNaturalWeapon({ type: "weapon", system: {}, flags: {} }, { ownerType: "monster" }), "a monster's weapon stating no cost is its attack");
  ok(!isNaturalWeapon({ type: "weapon", system: { cost: 7 }, flags: {} }, { ownerType: "monster" }), "a monster's priced weapon is carried");
  ok(!isNaturalWeapon({ type: "weapon", system: { cost: 0 }, flags: {} }, { ownerType: "character" }), "a character's unpriced weapon is still carried");
}

/* --- links, letters --- */
{
  eq(uuidOfLink("@UUID[RollTable.t1]{Moss hoard}"), "RollTable.t1");
  eq(uuidOfLink("RollTable.t1"), null, "a bare id is not a link");
  eq(uuidOfLink(""), null);
  eq(uuidOfLink(null), null);
  eq(letterOf(" Q "), "Q");
  eq(letterOf("none"), null);
  eq(letterOf("None"), null);
  eq(letterOf(""), null);
  eq(letterOf(undefined), null);
  eq(letterOf(7), null, "a non-string is no letter");
}

/* --- the record is built from snapshots and survives its bodies --- */
const truthA = { source: { uuid: "Actor.a1.Item.i1", data: { name: "Wooden spoon" } }, pool: "item", label: "Wooden spoon" };
const truthB = { source: { uuid: "Actor.a1.Item.i2", data: { name: "Bent ladle" } }, pool: "item", label: "Bent ladle" };
{
  const world = { actors: { a1: { name: "Mossback", items: { i1: truthA, i2: truthB } } } };
  const entry = entryOf(facts(), {
    goods: [{ itemId: "i1", truths: [truthA] }, { itemId: "i2", truths: [truthB] }],
    treasure: { type: "Q", table: "@UUID[RollTable.t1]{Moss hoard}" },
  });
  const record = recordOf({ combatId: "f1", sceneId: "s1", entries: [entry] });
  const stored = JSON.parse(JSON.stringify(record));
  delete world.actors.a1;
  eq(Object.keys(world.actors), [], "the body is removed");
  eq(stored, record, "the record read from a flag is the record that was posted");
  eq(stored.fallen[0].goods.flatMap((g) => g.truths.map((t) => t.label)), ["Wooden spoon", "Bent ladle"], "the goods are still there as truths");
  eq(stored.fallen[0].letter, "Q");
  eq(stored.fallen[0].tableUuid, "RollTable.t1");
  eq(stored.opened, false);
  eq(stored.drawnText, []);

  eq(recordOf({ combatId: "f2", entries: [entryOf(facts(), { goods: [], treasure: { type: "none", table: "" } })] }), null, "nothing carried posts no card");
  eq(recordOf({ combatId: "f2", entries: [] }), null);
  eq(recordOf({ combatId: "f2", entries: null }), null);
  const mixed = recordOf({ combatId: "f3", entries: [entryOf(facts({ id: "x" }), {}), entryOf(facts({ id: "y", name: "Gnarl" }), { treasure: { type: "B" } })] });
  eq(mixed.fallen.map((e) => e.name), ["Gnarl"], "a creature that holds nothing is not listed");
  ok(holdsAnything(mixed.fallen[0]));
  eq(entryOf(facts(), { goods: [{ itemId: "", truths: [truthA] }, { itemId: "i9", truths: [] }, null] }).goods, [], "a good with no id or no truth is dropped");
  eq(recordOf({ combatId: "f4", entries: [entryOf(facts(), { goods: [{ itemId: "i1", truths: [truthA] }] })] }).sceneId, null, "a record without a scene says so");
}

/* --- reading a record back --- */
{
  const r = normalizeRecord({ combatId: 5, fallen: "x", opened: "yes", drawnText: [1, "a"] });
  eq(r, { combatId: "", sceneId: null, fallen: [], opened: false, drawnText: ["1", "a"], potUuid: null, placeUuid: null, lots: [] }, "only a real true is opened");
  eq(normalizeRecord(null).fallen, []);
  eq(normalizeRecord({ opened: true }).opened, true, "a card whose scene was opened says so");
  const kept = normalizeRecord({
    opened: true,
    potUuid: " Cards.p1 ",
    placeUuid: "Actor.pl1",
    lots: [{ key: "body:c1/1", thing: "body:c1", layer: "hasty" }, { key: "", thing: "x" }, { key: "k" }, null, "s", { key: "body:c1/2", thing: "body:c1" }],
  });
  eq([kept.potUuid, kept.placeUuid], ["Cards.p1", "Actor.pl1"], "the pot and the place the first opening used are kept");
  eq(kept.lots, [{ key: "body:c1/1", thing: "body:c1", layer: "hasty" }, { key: "body:c1/2", thing: "body:c1", layer: null }], "each dealt lot is kept by key, entry and layer, and a row with no key or entry is dropped");
  eq([normalizeRecord({ potUuid: 7, placeUuid: "", lots: "x" }).potUuid, normalizeRecord({ placeUuid: "" }).placeUuid, normalizeRecord({ lots: "x" }).lots], [null, null, []], "anything else reads as nothing kept");
}

/* --- what the card shows --- */
{
  const record = recordOf({
    combatId: "f1",
    entries: [
      entryOf(facts({ id: "a", name: "Mossback" }), { goods: [{ itemId: "i1", truths: [truthA] }, { itemId: "i2", truths: [truthB] }] }),
      entryOf(facts({ id: "b", name: "Gnarl" }), { treasure: { type: "B", table: "@UUID[RollTable.t9]{x}" } }),
    ],
  });
  eq(cardRows(record), [
    { name: "Mossback", items: 2, letter: null, hasTable: false },
    { name: "Gnarl", items: 0, letter: "B", hasTable: true },
  ]);
  eq(cardRows(null), []);
}

/* --- the quiet draw's request --- */
{
  eq(DRAW_REQUEST, { displayChat: false });
  ok(Object.isFrozen(DRAW_REQUEST), "the shared request cannot be changed");
}

/* --- drawn results --- */
{
  eq(specOfResult({ type: "document", documentUuid: "Item.x1", name: "Cracked bowl" }), { kind: "item", uuid: "Item.x1", label: "Cracked bowl" });
  eq(specOfResult({ type: "text", name: "A heap of rags" }), { kind: "text", label: "A heap of rags" });
  eq(specOfResult({ type: "text", description: "<p>Loose <b>buttons</b></p>" }), { kind: "text", label: "Loose buttons" });
  eq(specOfResult({ text: "old form" }), { kind: "text", label: "old form" });
  eq(specOfResult({ type: "text" }), null, "an empty result is nothing");
  eq(specOfResult(null), null);
  eq(specOfResult({ documentUuid: "Item.x2" }), { kind: "item", uuid: "Item.x2", label: "" });
}

/* --- who owes a take-off --- */
{
  const own = { actorUuid: "A", itemId: "i" };
  ok(needsTakeOff({ takeOff: true, carried: { c1: own } }));
  ok(needsTakeOff({ takeOff: true, taken: [], carried: { c1: own } }), "nothing settled yet");
  ok(!needsTakeOff({ takeOff: true, taken: ["c1"], carried: { c1: own } }), "a settled card is owed nothing");
  ok(needsTakeOff({ takeOff: true, taken: ["c1"], carried: { c1: own, c2: own } }), "one card settled leaves the other owed");
  ok(needsTakeOff({ takeOff: true, carried: { c1: own, c2: own } }, ["c2"]), "asked of the card that is owed");
  ok(!needsTakeOff({ takeOff: true, taken: ["c2"], carried: { c1: own, c2: own } }, ["c2"]), "asked of a card that is settled");
  ok(!needsTakeOff({ takeOff: true, carried: { c1: own } }, ["c9"]), "asked of a card that maps nothing");
  ok(!needsTakeOff({ takeOff: true, carried: { c1: own } }, []), "asked of no card");
  ok(!needsTakeOff({ takeOff: true, carried: {} }), "nothing mapped, nothing owed");
  ok(!needsTakeOff({ kind: "stash", carried: { c1: {} } }), "an origin that does not ask owes nothing, whatever kind it is");
  ok(!needsTakeOff({ takeOff: "yes", carried: { c1: {} } }), "only a real true asks");
  ok(!needsTakeOff(null));
  ok(!needsTakeOff({ takeOff: true }));
}

/* --- the take-off: moved when the lot is found, from bodies that still exist --- */
{
  const carried = {
    c1: { actorUuid: "Actor.a1", itemId: "i1" },
    c2: { actorUuid: "Scene.s1.Token.k1", itemId: "i7" },
    c3: { actorUuid: "Scene.s1.Token.k1", itemId: "i7" },
    c4: { actorUuid: "Actor.a1", itemId: "i2" },
  };
  const present = (set) => (actorUuid, itemId) => set.has(`${actorUuid}|${itemId}`);
  const everyone = new Set(["Actor.a1|i1", "Scene.s1.Token.k1|i7", "Actor.a1|i2"]);

  const all = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(everyone) });
  eq(all.take, [
    { actorUuid: "Actor.a1", itemId: "i1" },
    { actorUuid: "Scene.s1.Token.k1", itemId: "i7" },
    { actorUuid: "Actor.a1", itemId: "i2" },
  ], "every body present: its items come off, a bundle's item once");
  eq(all.gone, []);
  eq(all.settled, ["c1", "c2", "c3", "c4"], "every card the plan answers for is reported settled, the bundle's second card included");

  const noToken = new Set(["Actor.a1|i1", "Actor.a1|i2"]);
  const half = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(noToken) });
  eq(half.take, [{ actorUuid: "Actor.a1", itemId: "i1" }, { actorUuid: "Actor.a1", itemId: "i2" }], "a body deleted before its lot was found: nothing to take");
  eq(half.gone, ["c2", "c3"], "its cards are reported; they stay in the pot on their snapshots");

  const none = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: () => false });
  eq(none, { take: [], gone: ["c1", "c2", "c3", "c4"], settled: ["c1", "c2", "c3", "c4"] }, "every body gone");

  const removed = planTakeOff({ carried, order: ["c1", "c4"], exists: present(everyone) });
  eq(removed.take.map((t) => t.itemId), ["i1", "i2"], "a card the Judge struck in staging leaves its item on the body");
  eq(removed.settled, ["c1", "c4"], "and is not settled: nothing was owed for it");
  eq(planTakeOff({ carried, order: [], exists: present(everyone) }), { take: [], gone: [], settled: [] }, "an empty pot takes nothing");
  eq(planTakeOff({ carried: { c9: { actorUuid: "Actor.a1" } }, order: ["c9"], exists: () => true }).take, [], "a malformed entry is skipped");
  eq(planTakeOff({ carried: null, order: null, exists: () => true }), { take: [], gone: [], settled: [] });
  let asked = 0;
  planTakeOff({ carried, order: ["zz"], exists: () => (asked++, true) });
  eq(asked, 0, "a card not in the pot never asks the world");

  // Per card, as lots are found: only the cards just found are planned, and a settled card is never planned again.
  const first = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(everyone), only: ["c1"] });
  eq([first.take, first.gone, first.settled], [[{ actorUuid: "Actor.a1", itemId: "i1" }], [], ["c1"]], "a find takes its own card's item and nothing else");
  const bundle = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(everyone), only: ["c2", "c3"] });
  eq([bundle.take.length, bundle.settled], [1, ["c2", "c3"]], "two cards of one item found together take it once");
  const later = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(everyone), taken: ["c1", "c2"] });
  eq(later.settled, ["c3", "c4"], "cards already settled are skipped");
  const again = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: () => true, taken: ["c1"], only: ["c1"] });
  eq([again.take, again.gone, again.settled], [[], [], []], "a card found again, or a search reopened, takes nothing a second time even where its body still reports the item");
  const gone = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(noToken), only: ["c2"] });
  eq([gone.take, gone.gone, gone.settled], [[], ["c2"], ["c2"]], "a find whose body is gone settles its card and takes nothing");
  eq(planTakeOff({ carried, order: ["c1"], exists: present(everyone), only: [] }).settled, [], "no cards asked, none planned");
}

{
  // A body's linked table is rolled once per card: a later press reuses what the first drew.
  const cup = { kind: "item", name: "Tin cup" };
  eq(heldDraw(null, "c1"), null, "a card with no record has drawn nothing");
  eq(heldDraw({}, "c1"), null, "a record with no draws has drawn nothing");
  eq(heldDraw({ drawnBy: { c2: [cup] } }, "c1"), null, "another body's draw is not this body's");
  eq(heldDraw({ drawnBy: { c1: [cup] } }, "c1"), [cup], "the body's own draw is reused");
  eq(heldDraw({ drawnBy: { c1: [] } }, "c1"), [], "a draw that dealt no item is still a draw: it is not rolled again");
  eq(heldDraw({ drawnBy: { c1: [cup, null, "x", [1]] } }, "c1"), [cup], "only card truths are reused");
  eq(heldDraw({ drawnBy: { c1: "x" } }, "c1"), null, "a malformed entry is no draw");
}

console.log(`test-treasure-search: ${checks} checks passed`);
