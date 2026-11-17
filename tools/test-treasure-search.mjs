/**
 * Pure-logic tests for "Search the fallen" (Foundry-free): which combatants
 * count as fallen, the record built from snapshots that outlives its bodies,
 * what staging asks for, and which goods an opened pot takes off the bodies.
 * Every creature, item and table here is this file's own invention.
 */
import assert from "node:assert/strict";
import {
  DRAW_REQUEST, ORIGIN_KIND, cardRows, carriedMap, entryOf, fallenOf, holdsAnything, isDefeated, isHostile, isNaturalWeapon, letterOf, needsTakeOff,
  normalizeRecord, openedNow, originOf, planStaging, planTakeOff, recordOf, specOfResult, uuidOfLink,
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
  eq(planStaging(stored).goods.map((g) => g.truth.label), ["Wooden spoon", "Bent ladle"], "the goods are still there as cards");
  eq(stored.fallen[0].letter, "Q");
  eq(stored.fallen[0].tableUuid, "RollTable.t1");
  eq(stored.stagedPot, null);
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
  const r = normalizeRecord({ combatId: 5, fallen: "x", stagedPot: "", drawnText: [1, "a"] });
  eq(r, { combatId: "", sceneId: null, fallen: [], stagedPot: null, drawnText: ["1", "a"] });
  eq(normalizeRecord(null).fallen, []);
  eq(normalizeRecord({ stagedPot: "Cards.p1" }).stagedPot, "Cards.p1");
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

/* --- staging: goods, the quiet draw, the letter seam --- */
{
  const record = recordOf({
    combatId: "f1",
    entries: [
      entryOf(facts({ id: "a", name: "Mossback", actorUuid: "Actor.a1" }), {
        goods: [{ itemId: "i1", truths: [truthA] }],
        treasure: { type: "Q", table: "@UUID[RollTable.t1]{x}" },
      }),
      entryOf(facts({ id: "b", name: "Gnarl", actorUuid: "Scene.s1.Token.k1" }), {
        goods: [{ itemId: "i7", truths: [truthB, truthA] }],
        treasure: { type: "none", table: "@UUID[RollTable.t2]{y}" },
      }),
    ],
  });
  const plan = planStaging(record);
  eq(plan.goods.map((g) => g.owner), [
    { actorUuid: "Actor.a1", itemId: "i1" },
    { actorUuid: "Scene.s1.Token.k1", itemId: "i7" },
    { actorUuid: "Scene.s1.Token.k1", itemId: "i7" },
  ], "each card names the body and item it came from; a bundle's cards share one");
  eq(plan.draws.map((d) => d.tableUuid), ["RollTable.t1", "RollTable.t2"], "one draw per linked table");
  for (const d of plan.draws) eq(d.request, { displayChat: false }, "a table is drawn quietly");
  eq(DRAW_REQUEST, { displayChat: false });
  ok(Object.isFrozen(DRAW_REQUEST), "the shared request cannot be changed");
  plan.draws[0].request.displayChat = true;
  eq(DRAW_REQUEST.displayChat, false, "a draw's request is its own copy");
  eq(plan.letters, [{ name: "Mossback", letter: "Q" }], "a letter is listed, and a 'none' is not");

  const letterOnly = recordOf({ combatId: "f2", entries: [entryOf(facts(), { treasure: { type: "H" } })] });
  const only = planStaging(letterOnly);
  eq(only.goods, [], "a letter alone deals no card yet");
  eq(only.draws, []);
  eq(only.letters, [{ name: "Mossback", letter: "H" }], "it is still listed for the Judge");
  eq(planStaging(null), { goods: [], draws: [], letters: [] }, "no record stages nothing");
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

/* --- origin and the card-to-body map --- */
{
  const record = recordOf({ combatId: "f1", sceneId: "s1", entries: [entryOf(facts(), { goods: [{ itemId: "i1", truths: [truthA] }] })] });
  const origin = originOf({ record, messageId: "m1" });
  eq(origin.kind, ORIGIN_KIND);
  eq(origin.kind, "combat");
  eq({ combatId: origin.combatId, sceneId: origin.sceneId, messageId: origin.messageId }, { combatId: "f1", sceneId: "s1", messageId: "m1" });
  eq(origin.fallen, [{ name: "Mossback", actorUuid: "Actor.a1" }]);
  eq(origin.carried, {});
  eq(origin.takenOff, false);

  eq(carriedMap([{ actorUuid: "A", itemId: "i" }, { actorUuid: "B", itemId: "j" }], ["c1", "c2"]), {
    c1: { actorUuid: "A", itemId: "i" },
    c2: { actorUuid: "B", itemId: "j" },
  });
  eq(carriedMap([{ actorUuid: "A", itemId: "i" }], []), {}, "fewer cards than owners maps nothing");
  eq(carriedMap([], ["c1"]), {}, "more cards than owners maps nothing");
  eq(carriedMap(null, null), {});

  ok(needsTakeOff({ kind: "combat", takenOff: false, carried: { c1: { actorUuid: "A", itemId: "i" } } }));
  ok(!needsTakeOff({ kind: "combat", takenOff: true, carried: { c1: {} } }), "taken once is taken");
  ok(!needsTakeOff({ kind: "combat", takenOff: false, carried: {} }), "nothing mapped, nothing owed");
  ok(!needsTakeOff({ kind: "stash", takenOff: false, carried: { c1: {} } }), "another origin owes nothing");
  ok(!needsTakeOff(null));
  ok(!needsTakeOff({ kind: "combat" }));
}

/* --- opening --- */
{
  ok(openedNow({ flags: { "acks-extras": { treasure: { phase: "open" } } } }), "a diff that opens the pot");
  ok(!openedNow({ flags: { "acks-extras": { treasure: { phase: "closed" } } } }), "a diff that closes it");
  ok(!openedNow({ flags: { "acks-extras": { treasure: { mode: "table" } } } }), "a diff that leaves the phase alone");
  ok(!openedNow({ flags: { other: { treasure: { phase: "open" } } } }), "another module's flag");
  ok(!openedNow(null));
}

/* --- the take-off: moved at open, from bodies that still exist --- */
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

  const noToken = new Set(["Actor.a1|i1", "Actor.a1|i2"]);
  const half = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: present(noToken) });
  eq(half.take, [{ actorUuid: "Actor.a1", itemId: "i1" }, { actorUuid: "Actor.a1", itemId: "i2" }], "a body deleted before open: nothing to take");
  eq(half.gone, ["c2", "c3"], "its cards are reported; they stay in the pot on their snapshots");

  const none = planTakeOff({ carried, order: ["c1", "c2", "c3", "c4"], exists: () => false });
  eq(none, { take: [], gone: ["c1", "c2", "c3", "c4"] }, "every body gone");

  const removed = planTakeOff({ carried, order: ["c1", "c4"], exists: present(everyone) });
  eq(removed.take.map((t) => t.itemId), ["i1", "i2"], "a card the Judge struck in staging leaves its item on the body");
  eq(planTakeOff({ carried, order: [], exists: present(everyone) }), { take: [], gone: [] }, "an empty pot takes nothing");
  eq(planTakeOff({ carried: { c9: { actorUuid: "Actor.a1" } }, order: ["c9"], exists: () => true }).take, [], "a malformed entry is skipped");
  eq(planTakeOff({ carried: null, order: null, exists: () => true }), { take: [], gone: [] });
  let asked = 0;
  planTakeOff({ carried, order: ["zz"], exists: () => (asked++, true) });
  eq(asked, 0, "a card not in the pot never asks the world");
}

console.log(`test-treasure-search: ${checks} checks passed`);
