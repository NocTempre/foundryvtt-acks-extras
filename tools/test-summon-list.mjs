/**
 * The spell's creature list, the pure half (`lib/summon-list.mjs`): which rows
 * are one list, adding and removing a creature as row edits, the Number box's
 * provenance, and how a creature reads on a seat that can and cannot open it.
 * Every name here is invented. Foundry-free.
 *
 * Usage: node tools/test-summon-list.mjs
 */
import assert from "node:assert/strict";
import { REGISTER_ORIGIN } from "../scripts/lib/magic-vocab.mjs";
import { addSummonCreature, amountFromBox, amountTip, creatureByStamp, creatureView, removeSummonCreature, resolveCreature, seatNameOf, summonListOf } from "../scripts/lib/summon-list.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const summon = (extra = {}) => ({ type: "summon", summonFormat: "calling", control: "cooperative", ...extra });
const newKey = () => "_fresh";
const say = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);

t("a list is the summon rows sharing the open row's band, format and control, in store order", () => {
  const rows = [
    summon({ ref: "a" }),
    { type: "damage" },
    summon({ ref: "b" }),
    summon({ ref: "c", summonFormat: "summoning" }),
    summon({ ref: "d", control: "hostile" }),
    summon({ ref: "e", invocationFrom: 3 }),
    summon({ ref: "f", invocationFrom: 3, invocationTo: 5 }),
    summon({ ref: "g", invocationFrom: "3" }),
  ];
  assert.deepEqual(summonListOf(rows, 0), [0, 2]);
  assert.deepEqual(summonListOf(rows, 2), [0, 2], "the open row may be any member");
  assert.deepEqual(summonListOf(rows, 5), [5, 7], "a number and its text are one band edge");
  assert.deepEqual(summonListOf(rows, 6), [6]);
  assert.deepEqual(summonListOf(rows, 1), [], "a row that is no summon row has no list");
  assert.deepEqual(summonListOf(rows, 99), []);
});

t("blank, missing and null compare equal on every shared field", () => {
  const rows = [{ type: "summon", ref: "a" }, { type: "summon", ref: "b", invocationFrom: "", invocationTo: null, summonFormat: "", control: undefined }];
  assert.deepEqual(summonListOf(rows, 0), [0, 1]);
});

t("Add on a blank open row fills that row and keeps its number; the importer's mark comes off", () => {
  const rows = [summon({ key: "creature", ref: "", amount: 4, origin: REGISTER_ORIGIN })];
  const out = addSummonCreature(rows, 0, " Compendium.x.y.Actor.one ", { newKey });
  assert.equal(out.rows.length, 1);
  assert.deepEqual([out.rows[0].ref, out.rows[0].amount, out.rows[0].origin, out.rows[0].key], ["Compendium.x.y.Actor.one", 4, "", "creature"]);
  assert.equal(out.index, 0);
  assert.equal(out.added, out.rows[0]);
  assert.equal(rows[0].ref, "", "the rows handed in are not edited");
});

t("Add of a blank or repeated ref changes nothing, a `uuid:` prefix included", () => {
  const rows = [summon({ ref: "Actor.one" }), summon({ ref: "Actor.two" })];
  for (const ref of ["", "   ", null, undefined, "Actor.one", " uuid:Actor.two "]) {
    const out = addSummonCreature(rows, 0, ref, { newKey });
    assert.equal(out.rows, rows, `refused ${JSON.stringify(ref)}`);
    assert.equal(out.added, null);
  }
});

t("Add inserts a copy of the open row after the list's last row, with its own key and no name or mark", () => {
  const rows = [
    summon({ key: "creature", ref: "Actor.one", name: "Creature one", amount: 2, max: { kind: "flat", flat: 3 }, origin: REGISTER_ORIGIN, unread: ["amount"], invocationFrom: 2 }),
    { type: "damage", key: "x" },
    summon({ key: "other", ref: "Actor.z", invocationFrom: 2 }),
    summon({ key: "else", ref: "Actor.y", invocationFrom: 9 }),
  ];
  const out = addSummonCreature(rows, 0, "Actor.two", { newKey });
  assert.equal(out.rows.length, 5);
  assert.deepEqual(out.rows.map((r) => r.key), ["creature", "x", "other", "_fresh", "else"], "after the list's last row, not at the end");
  const added = out.rows[3];
  assert.deepEqual([added.ref, added.name, added.origin, added.key, added.amount, added.invocationFrom, added.summonFormat, added.control], ["Actor.two", "", "", "_fresh", 2, 2, "calling", "cooperative"]);
  assert.deepEqual(added.max, { kind: "flat", flat: 3 }, "the rest of the row is copied");
  assert.ok(!("unread" in added));
  assert.equal(out.rows[0].origin, REGISTER_ORIGIN, "the open row is not touched");
  assert.equal(out.index, 0);
  assert.equal(out.added, added);
  assert.deepEqual(summonListOf(out.rows, 0), [0, 2, 3]);
  const again = addSummonCreature(out.rows, 2, "Actor.three", { newKey: () => "_next" });
  assert.deepEqual([again.rows[4].key, again.index], ["_next", 2], "from a later member it still lands after the last");
});

t("Remove of a sibling splices it out and returns it; the open row's index follows", () => {
  const rows = [summon({ ref: "a" }), summon({ ref: "b" }), summon({ ref: "c" })];
  const before = removeSummonCreature(rows, 2, 0);
  assert.deepEqual([before.rows.map((r) => r.ref), before.index, before.removed.ref], [["b", "c"], 1, "a"]);
  const after = removeSummonCreature(rows, 0, 2);
  assert.deepEqual([after.rows.map((r) => r.ref), after.index, after.removed.ref], [["a", "b"], 0, "c"]);
  assert.equal(rows.length, 3, "the rows handed in are not edited");
});

t("Remove of the open row opens the next row of its list, or the one before when it was last", () => {
  const rows = [summon({ ref: "a" }), { type: "damage" }, summon({ ref: "b" }), summon({ ref: "c" })];
  const middle = removeSummonCreature(rows, 2, 2);
  assert.deepEqual([middle.rows.map((r) => r.ref ?? r.type), middle.index], [["a", "damage", "c"], 2]);
  assert.equal(summonListOf(middle.rows, middle.index).includes(middle.index), true);
  const first = removeSummonCreature(rows, 0, 0);
  assert.deepEqual([first.rows.map((r) => r.ref ?? r.type), first.index], [["damage", "b", "c"], 1]);
  const last = removeSummonCreature(rows, 3, 3);
  assert.deepEqual([last.rows.map((r) => r.ref ?? r.type), last.index], [["a", "damage", "b"], 2]);
});

t("Remove of the only row keeps it and blanks its creature; format, number and control stay", () => {
  const rows = [summon({ key: "creature", ref: "Actor.one", name: "Creature one", amount: 3, origin: REGISTER_ORIGIN })];
  const out = removeSummonCreature(rows, 0, 0);
  assert.equal(out.removed, null);
  assert.equal(out.rows.length, 1);
  assert.deepEqual([out.rows[0].ref, out.rows[0].name, out.rows[0].amount, out.rows[0].summonFormat, out.rows[0].control, out.rows[0].key, out.rows[0].origin], ["", "", 3, "calling", "cooperative", "creature", ""]);
  assert.equal(rows[0].ref, "Actor.one");
});

t("Remove refuses a target outside the open row's list", () => {
  const rows = [summon({ ref: "a" }), summon({ ref: "b", control: "hostile" }), { type: "damage" }];
  for (const target of [1, 2, 7, -1]) {
    const out = removeSummonCreature(rows, 0, target);
    assert.equal(out.rows, rows);
    assert.equal(out.removed, null);
  }
});

t("a Number box reads blank as no number, a figure as itself, and anything else as no edit", () => {
  assert.equal(amountFromBox(""), null);
  assert.equal(amountFromBox("  "), null);
  assert.equal(amountFromBox("0"), 0);
  assert.equal(amountFromBox("12"), 12);
  assert.equal(amountFromBox(null), null);
  for (const bad of ["x", "-1", "NaN", "1e999"]) assert.equal(amountFromBox(bad), undefined, bad);
});

t("the Number box's tooltip says whose figure it is for this row alone, and a blank one carries the page alone", () => {
  assert.equal(amountTip({ amount: 2, origin: REGISTER_ORIGIN }, { cite: "Book p. 9", say }), 'tip.amountRead · tip.cite {"cite":"Book p. 9"}', "an imported row names the page it was read from");
  assert.equal(amountTip({ amount: 2, origin: REGISTER_ORIGIN }, { say }), "tip.amountRead", "and no page where the store cites none");
  assert.equal(amountTip({ amount: 2, origin: "" }, { cite: "Book p. 9", say }), "tip.amountHand");
  assert.equal(amountTip({ amount: 0 }, { say }), "tip.amountHand", "a zero is a figure");
  assert.equal(amountTip({ amount: null }, { cite: "Book p. 9", say }), 'tip.cite {"cite":"Book p. 9"}');
  assert.equal(amountTip({ amount: "" }, { cite: "", say }), "", "no page, no words");
  assert.equal(amountTip({}, { say }), "");
  assert.ok(!/Book p/.test(amountTip({ amount: 2, origin: "" }, { cite: "Book p. 9", say })), "a row set by hand claims no page");
});

/* ------------------------------------------------------------------ */
/*  The seat                                                           */
/* ------------------------------------------------------------------ */

const NEUTRAL = "A creature this seat cannot open";
const docs = {
  "Actor.one": { uuid: "Actor.one", documentName: "Actor", name: "Creature one", testUserPermission: (user, level) => user.sees?.includes("Actor.one") && level === "OBSERVER" },
  "Compendium.mod.pack.Actor.two": { uuid: "Compendium.mod.pack.Actor.two", name: "Creature two" },
  "Item.zz": { uuid: "Item.zz", documentName: "Item", name: "Not a creature" },
};
const packs = { "mod.pack": { testUserPermission: (user) => user.packs === true } };
const lookups = { fromUuidSync: (uuid) => docs[uuid] ?? null, byCookbookId: (type, id) => (id === "cook.id" ? docs["Actor.one"] : null) };
const resolve = (ref) => resolveCreature(ref, lookups);
const deps = (user) => ({ resolve, user, packOf: (uuid) => packs[uuid.split(".").slice(1, 3).join(".")] ?? null, neutral: NEUTRAL });
const judge = { isGM: true };
const player = (extra = {}) => ({ isGM: false, ...extra });

t("a creature resolves by uuid, then by cookbook id; a document that is no Actor, a throw and a blank are none", () => {
  assert.equal(resolve("Actor.one").name, "Creature one");
  assert.equal(resolve("uuid:Actor.one").name, "Creature one");
  assert.equal(resolve("cook.id").name, "Creature one");
  assert.equal(resolve("Item.zz"), null);
  assert.equal(resolve(""), null);
  assert.equal(resolveCreature("x", { fromUuidSync: () => { throw new Error("unloaded"); }, byCookbookId: () => { throw new Error("no"); } }), null);
});

t("a Judge reads the name, and for a ref nothing resolves the row's name, else the ref", () => {
  assert.deepEqual(creatureView({ ref: "Actor.one" }, deps(judge)), { blank: false, label: "Creature one", opens: true, source: { kind: "world" } });
  assert.equal(creatureView({ ref: "Compendium.mod.pack.Actor.two" }, deps(judge)).source.pack, "mod.pack");
  assert.deepEqual(creatureView({ ref: "cook.gone", name: "Creature three" }, deps(judge)), { blank: false, label: "Creature three", opens: true, source: { kind: "unknown" } });
  assert.equal(creatureView({ ref: "cook.gone" }, deps(judge)).label, "cook.gone");
});

t("a Player reads the name of a creature the seat can open, the world's or a compendium's, and the neutral label for the rest", () => {
  assert.equal(creatureView({ ref: "Actor.one" }, deps(player({ sees: ["Actor.one"] }))).label, "Creature one");
  assert.equal(creatureView({ ref: "Compendium.mod.pack.Actor.two" }, deps(player({ packs: true }))).label, "Creature two");
  for (const [row, user] of [
    [{ ref: "Actor.one", name: "Creature one" }, player()],
    [{ ref: "Compendium.mod.pack.Actor.two", name: "Creature two" }, player()],
    [{ ref: "cook.gone", name: "Creature three" }, player({ sees: ["Actor.one"] })],
  ]) {
    const view = creatureView(row, deps(user));
    assert.deepEqual([view.label, view.opens, view.source], [NEUTRAL, false, null]);
    assert.ok(!JSON.stringify(view).includes(row.ref) && !JSON.stringify(view).includes("Creature"), "neither the ref nor a name rides the view");
  }
});

t("a row that names no creature is blank on every seat", () => {
  assert.deepEqual(creatureView({ ref: "  " }, deps(player())), { blank: true, label: "", opens: true, source: null });
});

t("the Mechanics line names a creature as the seat reads it", () => {
  assert.equal(seatNameOf("Actor.one", deps(judge)), "Creature one");
  assert.equal(seatNameOf("cook.gone", deps(judge)), null, "a Judge's unresolved ref reads as written");
  assert.equal(seatNameOf("Actor.one", deps(player())), NEUTRAL);
  assert.equal(seatNameOf("cook.gone", deps(player())), NEUTRAL, "a seat that cannot resolve it never prints the ref");
  assert.equal(seatNameOf("Actor.one", deps(player({ sees: ["Actor.one"] }))), "Creature one");
});

t("the stamp lookup answers a shelf's index row as the row and a world actor as its document, and asks no document of a shelf", () => {
  const asked = [];
  const rows = { "cook.shelf": { _id: "a1", name: "Creature one", uuid: "Compendium.mod.pack.Actor.a1", pack: "mod.pack" }, "cook.world": { _id: "w1", name: "Creature w", uuid: "Actor.w1", pack: null } };
  const doc = { id: "w1", name: "Creature w", uuid: "Actor.w1", testUserPermission: () => true };
  const lookup = creatureByStamp((type, id) => (asked.push([type, id]), rows[id] ?? null), (id) => (id === "w1" ? doc : null));
  assert.equal(lookup("Actor", "cook.shelf"), rows["cook.shelf"]);
  assert.equal(lookup("Actor", "cook.world"), doc);
  assert.equal(lookup("Actor", "cook.none"), null);
  assert.deepEqual(asked.map(([type]) => type), ["Actor", "Actor", "Actor"]);
  const orphan = creatureByStamp(() => rows["cook.world"], () => null);
  assert.equal(orphan("Actor", "x"), rows["cook.world"], "a world row with no document stays the row");
  const byStamp = { fromUuidSync: () => null, byCookbookId: lookup };
  assert.equal(resolveCreature("cook.shelf", byStamp).name, "Creature one");
  assert.equal(seatNameOf("cook.shelf", { resolve: (ref) => resolveCreature(ref, byStamp), user: player({ sees: [] }), packOf: () => ({ testUserPermission: () => true }), neutral: NEUTRAL }), "Creature one", "a row in a shelf is tested against the shelf");
  assert.equal(seatNameOf("cook.shelf", { resolve: (ref) => resolveCreature(ref, byStamp), user: player(), packOf: () => ({ testUserPermission: () => false }), neutral: NEUTRAL }), NEUTRAL);
});

t("of a world copy the seat cannot observe and a shelf copy it can open, the stamp lookup names the shelf copy", () => {
  const worldRow = { _id: "w1", name: "Creature w", uuid: "Actor.w1", pack: null };
  const shelfRow = { _id: "a1", name: "Creature one", uuid: "Compendium.mod.pack.Actor.a1", pack: "mod.pack" };
  const hidden = { id: "w1", name: "Creature w", uuid: "Actor.w1", testUserPermission: () => false };
  // The carriers in the library's order, world first, picked as pickCarrier picks them.
  const rowOf = (type, id, prefer) => [worldRow, shelfRow].find((r) => prefer?.(r)) ?? worldRow;
  const worldActor = (id) => (id === "w1" ? hidden : null);
  const packOf = () => ({ testUserPermission: () => true });
  const seat = (user, opens) => {
    const byStamp = { fromUuidSync: () => null, byCookbookId: creatureByStamp(rowOf, worldActor, opens) };
    return { resolve: (ref) => resolveCreature(ref, byStamp), user, packOf, neutral: NEUTRAL };
  };
  const opens = (creature) => creature === shelfRow || creature.testUserPermission?.() === true;
  assert.equal(seatNameOf("cook.x", seat(player(), opens)), "Creature one");
  assert.equal(seatNameOf("cook.x", seat(player(), null)), NEUTRAL, "with no test the world's copy is taken, as before");
  assert.equal(creatureByStamp(rowOf, worldActor, () => false)("Actor", "cook.x"), hidden, "no copy opens: the first carrier");
});

console.log(`\n${n} passed`);
