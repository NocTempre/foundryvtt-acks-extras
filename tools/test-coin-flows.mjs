/**
 * The coin WRITES, against documents that behave like Foundry's: every path
 * that lands coin on a holder or takes it off one — a credit, the Judge's mint
 * and sink, a transfer with its change, a deposit, a divided stack, and the
 * banked balance folded back into a purse.
 *
 * `test-money.mjs` proves the arithmetic these plans are made with; this suite
 * proves what the plans WRITE: that coin lands on the row of its own kind and
 * never makes a second, that a row which has to be made is copied from a coin
 * that already exists, and that no path reads the system's banked field.
 *
 * The collections below answer only what an EmbeddedCollection answers
 * (`get`, `find`, `filter`, `map`, `some`, iteration) — an array would accept
 * calls a live actor refuses. The rates coins are weighed at are this file's
 * own inventions.
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

class Coll extends Map {
  get contents() { return [...this.values()]; }
  find(fn) { return this.contents.find(fn); }
  filter(fn) { return this.contents.filter(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
  [Symbol.iterator]() { return this.values(); }
}

const setProperty = (obj, path, value) => {
  const parts = path.split(".");
  let node = obj;
  for (const key of parts.slice(0, -1)) node = node[key] ??= {};
  node[parts.at(-1)] = value;
  return true;
};

const warnings = [];
const worldItems = new Coll();
const worldActors = new Coll();
const worldScenes = [];

globalThis.acksExtras ??= {};
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: { warn: (text) => warnings.push(text), info() {}, error() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = { utils: { setProperty, randomID: () => `r${++serial}`, deepClone: (v) => structuredClone(v) } };
globalThis.game = {
  items: worldItems,
  actors: worldActors,
  scenes: worldScenes,
  packs: [],
  user: { isGM: true, id: "gm" },
  users: { get: () => ({ isGM: true }), filter: () => [] },
  i18n: { localize: (k) => k, format: (k) => k },
};

let serial = 0;

/** An embedded item: reads through to its source, and writes dotted keys into it. */
function makeItem(data, parent = null) {
  const src = structuredClone(data);
  src._id ??= `i${++serial}`;
  src.flags ??= {};
  const doc = {
    get id() { return src._id; },
    get _id() { return src._id; },
    get name() { return src.name; },
    get type() { return src.type; },
    get img() { return src.img; },
    get system() { return src.system; },
    get flags() { return src.flags; },
    parent,
    getFlag: (scope, key) => src.flags?.[scope]?.[key],
    toObject: () => structuredClone(src),
    update: async (changes) => {
      if (parent) parent.writes++;
      for (const [key, value] of Object.entries(changes)) setProperty(src, key, value);
      return doc;
    },
    delete: async () => {
      if (!parent) return doc;
      parent.writes++;
      parent.items.delete(src._id);
      return doc;
    },
  };
  return doc;
}

/** An actor whose items are a collection, recording how many writes it took. */
function makeActor({ id, name = id, type = "character", items = [] }) {
  const actor = { id, name, type, documentName: "Actor", uuid: `Actor.${id}`, isOwner: true, isToken: false, system: {}, flags: {}, items: new Coll(), writes: 0 };
  const add = (data) => {
    const doc = makeItem(data, actor);
    actor.items.set(doc.id, doc);
    return doc;
  };
  actor.createEmbeddedDocuments = async (_kind, datas) => {
    actor.writes++;
    return datas.map(add);
  };
  actor.updateEmbeddedDocuments = async (_kind, updates) => {
    // One write however many rows it names; the rows' own counter is put back.
    const before = actor.writes;
    for (const { _id, ...changes } of updates) await actor.items.get(_id).update(changes);
    actor.writes = before + 1;
    return updates;
  };
  actor.deleteEmbeddedDocuments = async (_kind, ids) => {
    actor.writes++;
    for (const itemId of ids) actor.items.delete(itemId);
  };
  actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];
  for (const data of items) add(data);
  return actor;
}

const LOCATION = "acks-extras.location";
const coin = (name, cv, qty, over = {}) => ({
  name,
  type: "money",
  img: over.img ?? "icons/svg/coins.svg",
  system: { coppervalue: cv, quantity: qty, quantitybank: over.bank ?? 0, description: over.description ?? "" },
  flags: over.flags ?? {},
  ...(over._id ? { _id: over._id } : {}),
});
const gold = (qty, over) => coin("Gold", 100, qty, over);
const silver = (qty, over) => coin("Silver", 10, qty, over);
const copper = (qty, over) => coin("Copper", 1, qty, over);

/** A holder's coin as `name ×count`, sorted, for one-line assertions. */
const purse = (holder) => holder.items.filter((i) => i.type === "money").map((i) => `${i.name} ×${i.system.quantity}`).sort();
const row = (holder, name) => holder.items.find((i) => i.name === name) ?? null;
const cp = (holder) => holder.items.filter((i) => i.type === "money").reduce((n, i) => n + i.system.quantity * i.system.coppervalue, 0);

const money = await import("../scripts/lib/money.mjs");
const { creditCoin, mintCoin, sinkCoin, transferCoin, ownCoin, purseGp, coinTemplate, HOUSE_OWNER } = money;
const storage = await import("../scripts/lib/storage.mjs");
const { divideStack, joinStacks } = await import("../scripts/lib/item-model.mjs");
const { goodsForDrop } = await import("../scripts/lib/bundles-logic.mjs");
const moneyLogic = await import("../scripts/lib/money-logic.mjs");
const { planStackMerge } = await import("../scripts/lib/storage-logic.mjs");

let passed = 0;
const test = async (name, fn) => {
  serial = 0;
  warnings.length = 0;
  worldItems.clear();
  worldActors.clear();
  worldScenes.length = 0;
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/* -------------------------------------------- */
/*  Landing coin                                */
/* -------------------------------------------- */

console.log("coin: landing");
await test("coin that moved lands on the holder's row of the same kind, never a second", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10, { _id: "g" })] });
  const done = await creditCoin(hero, [{ source: gold(5, { img: "elsewhere.webp", bank: 900 }), count: 5 }]);
  assert.deepEqual(purse(hero), ["Gold ×15"]);
  assert.deepEqual(done, { updates: 1, creates: 0 });
  assert.equal(row(hero, "Gold").system.quantitybank, 0, "the arriving row's banked balance is not coin and does not arrive");
});
await test("coin known only by its rate joins the row of that rate the holder already keeps", async () => {
  const hero = makeActor({ id: "hero", items: [coin("Crowns", 100, 10)] });
  await creditCoin(hero, [{ cv: 100, count: 3 }]);
  assert.deepEqual(purse(hero), ["Crowns ×13"], "a re-skinned purse is not handed a second denomination");
});
await test("a named coin is its own kind at the same rate", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10)] });
  await creditCoin(hero, [{ cv: 100, name: "Gold, debased", count: 2 }]);
  assert.deepEqual(purse(hero), ["Gold ×10", "Gold, debased ×2"]);
});
await test("a row that has to be made is copied from the coin that moved", async () => {
  const hero = makeActor({ id: "hero" });
  const source = gold(4, { _id: "theirs", img: "minted.webp", description: "<p>Struck in the north.</p>", flags: { "acks-extras": { gear: { perStone: 40 }, containedIn: "pack", storage: { ownerUuid: "Actor.x" } } } });
  await creditCoin(hero, [{ source, count: 4 }]);
  const made = row(hero, "Gold");
  assert.equal(made.system.quantity, 4);
  assert.equal(made.img, "minted.webp");
  assert.equal(made.system.description, "<p>Struck in the north.</p>");
  assert.equal(made.flags["acks-extras"].gear.perStone, 40, "the weight its kind states travels with it");
  assert.notEqual(made.id, "theirs", "the copy is a row of its own");
  assert.equal(made.flags["acks-extras"].containedIn, undefined, "loose, wherever the source was kept");
  assert.equal(made.flags["acks-extras"].storage, undefined, "and nobody's but the holder's");
});
await test("two credits of one new kind in the same call make one row between them", async () => {
  const hero = makeActor({ id: "hero" });
  const done = await creditCoin(hero, [{ source: gold(1), count: 3 }, { source: gold(1), count: 4 }, { source: silver(1), count: 2 }]);
  assert.deepEqual(purse(hero), ["Gold ×7", "Silver ×2"]);
  assert.deepEqual(done, { updates: 0, creates: 2 });
  assert.equal(hero.writes, 1, "one create for the whole call");
});
await test("a credit of nothing writes nothing", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10)] });
  assert.deepEqual(await creditCoin(hero, [{ cv: 100, count: 0 }, { cv: 100, count: -3 }, null]), { updates: 0, creates: 0 });
  assert.equal(hero.writes, 0);
});
await test("coin lands on the pile carried loose before the one packed away, and is spent off it first", async () => {
  const packed = { "acks-extras": { containedIn: "pack" } };
  const hero = makeActor({ id: "hero", items: [gold(500, { _id: "packed", flags: packed }), gold(20, { _id: "loose" })] });
  const count = (id) => hero.items.get(id).system.quantity;
  await creditCoin(hero, [{ cv: 100, count: 3 }, { source: gold(2), count: 2 }]);
  assert.deepEqual([count("loose"), count("packed")], [25, 500]);
  assert.deepEqual(planStackMerge([gold(4)], hero.items.map((i) => i.toObject())), { creates: [], targetUpdates: [{ _id: "loose", "system.quantity": 29 }] },
    "goods handed over find the same row");
  assert.equal((await sinkCoin(hero, 30)).ok, true);
  assert.deepEqual([count("loose"), count("packed")], [0, 495], "the pack is opened only for what the loose pile cannot cover");
  const only = makeActor({ id: "only", items: [gold(500, { _id: "packed", flags: packed })] });
  await creditCoin(only, [{ cv: 100, count: 3 }]);
  assert.deepEqual(purse(only), ["Gold ×503"], "a packed pile that is the holder's only one is still its row of that kind");
});
await test("a coin the holder has none of is copied from one the world already has", async () => {
  const shelf = makeItem(gold(0, { img: "world-gold.webp", flags: { "acks-extras": { gear: { perStone: 40 } } } }));
  worldItems.set(shelf.id, shelf);
  assert.equal((await coinTemplate({ cv: 100 })).img, "world-gold.webp");
  assert.equal((await coinTemplate({ name: " gold " })).img, "world-gold.webp", "a coin is found by what it is called, whatever it is worth");
  assert.equal(await coinTemplate({ cv: 7 }), null);
  assert.equal(await coinTemplate(), null, "nothing wanted, nothing found");
  const hero = makeActor({ id: "hero" });
  await mintCoin(hero, 3);
  const made = row(hero, "Gold");
  assert.equal(made.img, "world-gold.webp");
  assert.equal(made.system.quantity, 3, "the world's row is a stack of none; the minted one counts what was minted");
  assert.equal(made.flags["acks-extras"].gear.perStone, 40);
});

/* -------------------------------------------- */
/*  A place keeps coin for its owners           */
/* -------------------------------------------- */

console.log("coin: at a place");
await test("at a place every row is somebody's, and the house's coin is its own", async () => {
  const bank = makeActor({ id: "bank", type: LOCATION });
  await creditCoin(bank, [{ source: gold(1), count: 5 }], { ownerUuid: "Actor.hero", ownerName: "Hero" });
  await creditCoin(bank, [{ source: gold(1), count: 7 }]);
  await creditCoin(bank, [{ source: gold(1), count: 1 }], { ownerUuid: "Actor.hero", ownerName: "Hero" });
  assert.deepEqual(purse(bank), ["Gold ×6", "Gold ×7"], "a depositor's gold and the till's are two rows");
  const stamps = bank.items.map((i) => i.flags["acks-extras"].storage.ownerUuid).sort();
  assert.deepEqual(stamps, ["Actor.hero", HOUSE_OWNER]);
  assert.deepEqual(ownCoin(bank).map((i) => i.system.quantity), [7], "a till never spends a depositor's coin");
  assert.equal(purseGp(bank), 7);
});
await test("a deposit says whether any coin landed", async () => {
  const bank = makeActor({ id: "bank", type: LOCATION });
  assert.equal(await storage.depositCoin(bank, { ownerUuid: "Actor.hero", ownerName: "Hero", source: silver(1), quantity: 30 }), true);
  assert.equal(await storage.depositCoin(bank, { ownerUuid: "Actor.hero", ownerName: "Hero", coppervalue: 10, quantity: 5 }), true);
  assert.equal(await storage.depositCoin(bank, { ownerUuid: "Actor.hero", quantity: 0 }), false);
  assert.equal(await storage.depositCoin(null, { ownerUuid: "Actor.hero", quantity: 4 }), false);
  assert.deepEqual(purse(bank), ["Silver ×35"]);
});
await test("a coin dropped off the shelf onto a place is stocked under its owner, and the next one joins it", async () => {
  const bank = makeActor({ id: "bank", type: LOCATION });
  const house = { ownerUuid: HOUSE_OWNER, ownerName: "House" };
  assert.deepEqual(await storage.stockProvider(bank, goodsForDrop(gold(0, { _id: "shelf" })), house), { created: 1, merged: 0 });
  assert.deepEqual(await storage.stockProvider(bank, goodsForDrop(gold(0, { _id: "shelf" })), house), { created: 0, merged: 1 });
  assert.deepEqual(purse(bank), ["Gold ×2"]);
  assert.equal(purseGp(bank), 2, "stocked for the house, it is the house's to spend");
});
await test("an owner's duplicate rows fold together kind by kind", async () => {
  const stamp = { "acks-extras": { storage: { ownerUuid: "Actor.hero", ownerName: "Hero" } } };
  const bank = makeActor({
    id: "bank",
    type: LOCATION,
    items: [gold(5, { flags: stamp }), gold(7, { flags: stamp, bank: 60 }), coin("Gold, debased", 100, 2, { flags: stamp }), silver(3, { flags: stamp })],
  });
  bank.flags = { "acks-extras": { storage: { provider: true } } };
  assert.deepEqual(await storage.consolidateMoney(bank, "Actor.hero"), { merged: 1 });
  assert.deepEqual(purse(bank), ["Gold ×12", "Gold, debased ×2", "Silver ×3"], "kinds stay apart, and a banked balance adds nothing");
});

/* -------------------------------------------- */
/*  The Judge's mint and sink                   */
/* -------------------------------------------- */

console.log("coin: mint and sink");
await test("the mint pays in standard denominations onto the holder's own rows", async () => {
  const hero = makeActor({ id: "hero", items: [gold(1), silver(1), copper(1)] });
  await mintCoin(hero, 12.34);
  assert.deepEqual(purse(hero), ["Copper ×5", "Gold ×13", "Silver ×4"]);
  assert.deepEqual(await mintCoin(null, 5), { updates: 0, creates: 0 });
});
await test("the mint into a vault pays its owner, not the house", async () => {
  const vault = makeActor({ id: "vault", type: LOCATION });
  await mintCoin(vault, 20, { ownerUuid: "Actor.heir", ownerName: "Heir" });
  assert.equal(vault.items.contents[0].flags["acks-extras"].storage.ownerUuid, "Actor.heir");
  assert.equal(purseGp(vault), 0, "none of it is the house's");
});
await test("the sink spends smallest first and returns change in the purse's own coin", async () => {
  const hero = makeActor({ id: "hero", items: [copper(30), silver(4), gold(3)] });
  const before = cp(hero);
  assert.deepEqual(await sinkCoin(hero, 2.5), { ok: true, changeCp: 20 });
  assert.deepEqual(purse(hero), ["Copper ×0", "Gold ×1", "Silver ×2"]);
  assert.equal(cp(hero), before - 250, "exactly what was owed has left");
  assert.equal(hero.writes, 1, "the takes and the change are one write");
});
await test("a broken coin never costs more than was owed", async () => {
  const hero = makeActor({ id: "hero", items: [gold(1)] });
  assert.equal((await sinkCoin(hero, 0.3)).ok, true);
  assert.equal(cp(hero), 70, "the change no gold piece can represent comes back as smaller coin");
  assert.equal(row(hero, "Gold").system.quantity, 0);
});
await test("small coin the larger coin makes unnecessary never leaves the purse, and none comes back as another kind", async () => {
  const hero = makeActor({ id: "hero", items: [silver(6), coin("Electrum", 50, 0), gold(10)] });
  assert.deepEqual(await sinkCoin(hero, 5), { ok: true, changeCp: 60 });
  assert.deepEqual(purse(hero), ["Electrum ×0", "Gold ×5", "Silver ×6"], "five gold pay five gold; six silver are not turned into an electrum piece");
});
await test("a purse that cannot cover the amount is told so and left alone", async () => {
  const hero = makeActor({ id: "hero", items: [gold(1, { bank: 500 }), silver(2)] });
  assert.deepEqual(await sinkCoin(hero, 5), { ok: false, reason: "insufficient", shortfallCp: 380 });
  assert.equal(hero.writes, 0);
  assert.equal(purseGp(hero), 1.2, "a banked balance is not in the purse");
  assert.deepEqual(await sinkCoin(hero, 0), { ok: true, changeCp: 0 });
  assert.equal((await sinkCoin(null, 1)).ok, false);
});

/* -------------------------------------------- */
/*  A payment is a transfer                     */
/* -------------------------------------------- */

console.log("coin: transfers");
await test("the payer's coins are the ones that land, as the kind they were", async () => {
  const payer = makeActor({ id: "payer", items: [coin("Crowns", 100, 5, { img: "crown.webp", flags: { "acks-extras": { gear: { perStone: 40 } } } })] });
  const payee = makeActor({ id: "payee", items: [gold(2)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 3, gate: false }), { ok: true, changeCp: 0 });
  assert.deepEqual(purse(payer), ["Crowns ×2"]);
  assert.deepEqual(purse(payee), ["Crowns ×3", "Gold ×2"], "crowns stay crowns; they do not become the payee's gold");
  assert.equal(row(payee, "Crowns").img, "crown.webp");
  assert.equal(row(payee, "Crowns").flags["acks-extras"].gear.perStone, 40);
  assert.equal(cp(payer) + cp(payee), 700, "no coin is made or lost");
});
await test("change comes back out of the payee's purse, by the same arithmetic", async () => {
  const payer = makeActor({ id: "payer", items: [gold(1)] });
  const payee = makeActor({ id: "payee", items: [silver(10)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 0.3, gate: false }), { ok: true, changeCp: 70 });
  assert.deepEqual(purse(payer), ["Gold ×0", "Silver ×7"]);
  assert.deepEqual(purse(payee), ["Gold ×1", "Silver ×3"]);
  assert.equal(cp(payer) + cp(payee), 200);
});
await test("where nobody can make change the payment is refused and nothing moves", async () => {
  const payer = makeActor({ id: "payer", items: [gold(1)] });
  const payee = makeActor({ id: "payee" });
  const refused = await transferCoin({ from: payer, to: payee, gp: 0.3, gate: false });
  assert.deepEqual(refused, { ok: false, reason: "noChange", changeCp: 70 });
  assert.equal(payer.writes + payee.writes, 0);
  assert.equal(warnings.length, 1, "and the payer is told why");
});
await test("change is exact or it is refused: a payee is never emptied to round it up", async () => {
  const payer = makeActor({ id: "payer", items: [gold(1)] });
  const payee = makeActor({ id: "payee", items: [silver(5)] });
  const refused = await transferCoin({ from: payer, to: payee, gp: 0.3, gate: false });
  assert.deepEqual(refused, { ok: false, reason: "noChange", changeCp: 70 }, "five silver are not seven");
  assert.deepEqual([purse(payer), purse(payee)], [["Gold ×1"], ["Silver ×5"]]);
  assert.equal(payer.writes + payee.writes, 0);
});
await test("a coin that would be handed over and handed straight back never leaves the purse", async () => {
  const payer = makeActor({ id: "payer", items: [silver(3), gold(1)] });
  const payee = makeActor({ id: "payee", items: [copper(5)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 1.05, gate: false }), { ok: true, changeCp: 25 });
  assert.deepEqual(purse(payer), ["Copper ×5", "Gold ×0", "Silver ×2"]);
  assert.deepEqual(purse(payee), ["Copper ×0", "Gold ×1", "Silver ×1"]);
  assert.equal(cp(payee) - 5, 105, "the payee is up by exactly what was owed");
  assert.equal(cp(payer) + cp(payee), 135, "no coin is made or lost");
  assert.equal(payer.writes, 2, "one write for the coins paid, one for the change");
});
await test("change is the payer's own coin held back before it is anything out of the payee's purse", async () => {
  const payer = makeActor({ id: "payer", items: [silver(3), gold(1)] });
  const payee = makeActor({ id: "payee", items: [coin("Shillings", 10, 4), copper(5)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 1.05, gate: false }), { ok: true, changeCp: 25 });
  assert.deepEqual(purse(payer), ["Copper ×5", "Gold ×0", "Silver ×2"], "no shilling changes hands for silver the payer already held");
  assert.deepEqual(purse(payee), ["Copper ×0", "Gold ×1", "Shillings ×4", "Silver ×1"]);
});
await test("coins the payer could keep are kept before a larger coin of the payee's is asked for", async () => {
  const payer = makeActor({ id: "payer", items: [silver(6), gold(10)] });
  const payee = makeActor({ id: "payee", items: [coin("Electrum", 50, 2)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 5, gate: false }), { ok: true, changeCp: 60 });
  assert.deepEqual(purse(payer), ["Gold ×5", "Silver ×6"], "the silver stays; no electrum crosses for it");
  assert.deepEqual(purse(payee), ["Electrum ×2", "Gold ×5"]);
  assert.equal(payee.writes, 1, "the payee is written once, for the coins paid");
});
await test("where the kept coins and the payee's cannot make change apart, they make it together", async () => {
  const payer = makeActor({ id: "payer", items: [silver(3), gold(1)] });
  const payee = makeActor({ id: "payee", items: [coin("Electrum", 50, 1)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 0.7, gate: false }), { ok: true, changeCp: 60 });
  assert.deepEqual(purse(payer), ["Electrum ×1", "Gold ×0", "Silver ×1"]);
  assert.deepEqual(purse(payee), ["Electrum ×0", "Gold ×1", "Silver ×2"]);
  assert.equal(cp(payer), 60, "the payer is down by exactly what was owed");
  assert.equal(cp(payer) + cp(payee), 180, "no coin is made or lost");
});
await test("a short purse is refused whole", async () => {
  const payer = makeActor({ id: "payer", items: [gold(1, { bank: 50 })] });
  const payee = makeActor({ id: "payee" });
  const refused = await transferCoin({ from: payer, to: payee, gp: 3, gate: false });
  assert.equal(refused.reason, "insufficient");
  assert.equal(refused.shortfallCp, 200, "fifty banked pieces cover none of it");
  assert.equal(payer.writes + payee.writes, 0);
});
await test("a wage pays only what the purse represents exactly and books the rest", async () => {
  const employer = makeActor({ id: "boss", items: [gold(1), silver(2)] });
  const hireling = makeActor({ id: "hand" });
  assert.deepEqual(await transferCoin({ from: employer, to: hireling, gp: 1.5, gate: false, upTo: true }), { ok: true, paidCp: 120, arrearsCp: 30 });
  assert.deepEqual(purse(hireling), ["Gold ×1", "Silver ×2"], "the wage is coin in the hireling's purse");
  assert.equal(row(hireling, "Gold").system.quantitybank, 0, "and none of it is banked");
  const broke = makeActor({ id: "broke", items: [gold(5)] });
  assert.deepEqual(await transferCoin({ from: broke, to: hireling, gp: 0.5, gate: false, upTo: true }), { ok: true, paidCp: 0, arrearsCp: 50 });
  const mixed = makeActor({ id: "mixed", items: [copper(5), silver(1)] });
  const second = makeActor({ id: "second" });
  assert.deepEqual(await transferCoin({ from: mixed, to: second, gp: 0.1, gate: false, upTo: true }), { ok: true, paidCp: 10, arrearsCp: 0 },
    "five copper taken first would have left the silver unspendable");
  assert.deepEqual(purse(second), ["Silver ×1"]);
});
await test("a market's till mints what it is short, and makes any change", async () => {
  const market = makeActor({ id: "market", type: LOCATION });
  market.system = { marketClass: 4 };
  const seller = makeActor({ id: "seller" });
  assert.equal((await transferCoin({ from: market, to: seller, gp: 12, gate: false, allowMint: true })).ok, true);
  assert.equal(cp(seller), 1200);
  const buyer = makeActor({ id: "buyer", items: [gold(1)] });
  assert.equal((await transferCoin({ from: buyer, to: market, gp: 0.3, gate: false })).ok, true);
  assert.equal(cp(buyer), 70, "a market changes a gold piece where a stranger could not");
});

await test("an employer's coin reaches the unit it pays, and no other", async () => {
  const boss = makeActor({ id: "boss", items: [gold(9)] });
  const unit = makeActor({ id: "unit", type: "acks-extras.group" });
  unit.system = { unit: { employerUuid: boss.uuid } };
  const stranger = makeActor({ id: "stranger", type: "acks-extras.group" });
  stranger.system = { unit: { employerUuid: "" } };
  assert.deepEqual([money.coinReach(boss, unit), money.coinReach(unit, boss)], [{ can: true, reason: null }, { can: true, reason: null }]);
  assert.deepEqual(money.coinReach(boss, stranger), { can: false, reason: "notTogether" });
  const paid = await transferCoin({ from: boss, to: unit, gp: 4, upTo: true });
  assert.deepEqual([paid.ok, paid.paidCp, purse(boss), purse(unit)], [true, 400, ["Gold ×5"], ["Gold ×4"]]);
  const refused = await transferCoin({ from: boss, to: stranger, gp: 4, upTo: true });
  assert.deepEqual([refused.ok, refused.reason, purse(boss), purse(stranger)], [false, "notTogether", ["Gold ×5"], []], "a refusal moves nothing and says so");
});

/* -------------------------------------------- */
/*  One stack, divided                          */
/* -------------------------------------------- */

console.log("coin: dividing a stack");
await test("a count taken off a stack becomes a row of its own beside it", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10, { _id: "g", bank: 30, flags: { "acks-extras": { containedIn: "pack", gear: { perStone: 40 } } } })] });
  const made = await divideStack(hero.items.get("g"), 4);
  assert.equal(made.system.quantity, 4);
  assert.equal(hero.items.get("g").system.quantity, 6);
  assert.equal(made.flags["acks-extras"].containedIn, "pack", "in the same container");
  assert.equal(made.flags["acks-extras"].gear.perStone, 40, "the same coin");
  assert.equal(made.system.quantitybank, 0, "a banked balance stays where it was");
  assert.equal(hero.items.get("g").system.quantitybank, 30);
  assert.equal(moneyLogic.coinTotalCp(hero.items.map((i) => i.toObject())), 1000, "nothing made, nothing lost");
});
await test("any stack divides, and one that was worn leaves its place behind", async () => {
  const torches = { _id: "t", name: "Torch", type: "item", system: { cost: 1, weight6: 1, quantity: { value: 6, max: 0 } }, flags: { "acks-extras": { gear: { slots: ["belt"], wornAt: "belt" } } } };
  const hero = makeActor({ id: "hero", items: [torches] });
  const made = await divideStack(hero.items.get("t"), 2.9);
  assert.equal(made.system.quantity.value, 2, "a count is whole");
  assert.equal(hero.items.get("t").system.quantity.value, 4);
  assert.equal(made.flags["acks-extras"].gear.wornAt, "", "the divided-off part is carried, not worn");
  assert.equal(hero.items.get("t").flags["acks-extras"].gear.wornAt, "belt");
});
await test("a divide that would leave either side empty is refused and writes nothing", async () => {
  const sword = { _id: "sw", name: "Sword", type: "weapon", system: { cost: 10, weight6: 6, equipped: true } };
  const hero = makeActor({ id: "hero", items: [gold(10, { _id: "g" }), sword] });
  for (const count of [0, -2, 10, 11, "many", null]) assert.equal(await divideStack(hero.items.get("g"), count), null, `dividing ${JSON.stringify(count)} off ten`);
  assert.equal(await divideStack(hero.items.get("sw"), 1), null, "what does not stack does not divide");
  assert.equal(await divideStack(makeItem(gold(10)), 4), null, "nor does a stack nobody holds");
  assert.equal(hero.writes, 0);
});

await test("a divided stack joins back into the row it came off", async () => {
  const hero = makeActor({ id: "hero", items: [gold(12, { _id: "g" })] });
  const made = await divideStack(hero.items.get("g"), 5);
  assert.deepEqual(purse(hero), ["Gold ×5", "Gold ×7"]);
  assert.equal(await joinStacks(made, hero.items.get("g")), hero.items.get("g"));
  assert.deepEqual(purse(hero), ["Gold ×12"]);
});
await test("two rows join only when they are one thing in one place", async () => {
  const torch = (id, qty, flags = {}) => ({ _id: id, name: "Torch", type: "item", img: "torch.webp", system: { cost: 1, weight6: 1, quantity: { value: qty, max: 0 } }, flags });
  const packed = { "acks-extras": { containedIn: "pack" } };
  const hero = makeActor({
    id: "hero",
    items: [
      gold(7, { _id: "g1" }), gold(5, { _id: "g2", flags: packed }), coin("Gold, debased", 100, 3, { _id: "g3" }),
      torch("t1", 4), torch("t2", 2), torch("t3", 6, packed),
      { _id: "sw", name: "Sword", type: "weapon", system: { cost: 10, weight6: 6 } },
    ],
  });
  const other = makeActor({ id: "other", items: [gold(9, { _id: "g9" })] });
  const item = (id) => hero.items.get(id);
  assert.equal(await joinStacks(item("g2"), item("g1")), null, "coin in a pack is not the coin beside it");
  assert.equal(await joinStacks(item("g3"), item("g1")), null, "two kinds at one rate stay two stacks");
  assert.equal(await joinStacks(item("g1"), item("g1")), null, "a row does not join itself");
  assert.equal(await joinStacks(other.items.get("g9"), item("g1")), null, "nor a row on another holder");
  assert.equal(await joinStacks(item("t3"), item("t1")), null, "a packed stack is not the loose one");
  assert.equal(await joinStacks(item("sw"), item("t1")), null, "what does not stack does not join");
  assert.equal(hero.writes + other.writes, 0, "a refusal writes nothing");
  assert.equal((await joinStacks(item("t2"), item("t1"))).system.quantity.value, 6, "identical stacks of anything join");
  assert.equal(hero.items.get("t2"), undefined);
});
await test("a coin row with a banked balance is emptied by a join, never removed", async () => {
  const hero = makeActor({ id: "hero", items: [gold(7, { _id: "g1" }), gold(5, { _id: "g2", bank: 30 })] });
  await joinStacks(hero.items.get("g2"), hero.items.get("g1"));
  assert.equal(hero.items.get("g1").system.quantity, 12);
  assert.equal(hero.items.get("g2").system.quantity, 0);
  assert.equal(hero.items.get("g2").system.quantitybank, 30, "the balance is still there for the migration to move");
});
await test("at a place two owners' coin never joins", async () => {
  const stamp = (uuid) => ({ "acks-extras": { storage: { ownerUuid: uuid, ownerName: uuid } } });
  const bank = makeActor({ id: "bank", type: LOCATION, items: [gold(7, { _id: "a", flags: stamp("Actor.a") }), gold(5, { _id: "b", flags: stamp("Actor.b") }), gold(2, { _id: "a2", flags: stamp("Actor.a") })] });
  assert.equal(await joinStacks(bank.items.get("b"), bank.items.get("a")), null);
  assert.equal((await joinStacks(bank.items.get("a2"), bank.items.get("a"))).system.quantity, 9);
});

/* -------------------------------------------- */
/*  The banked balance, retired                 */
/* -------------------------------------------- */

console.log("coin: the banked balance");
acksExtras.lib = { ...(acksExtras.lib ?? {}), money: { ...moneyLogic, ...money }, storage };
const sweep = await import("../scripts/location/vault-sweep.mjs");

await test("an actor that keeps no vault has its banked balance folded into the coin it carries", async () => {
  const merc = makeActor({ id: "merc", type: "monster", items: [gold(4, { _id: "g", bank: 60 }), silver(9, { _id: "s" }), copper(0, { _id: "c", bank: 12 })] });
  worldActors.set(merc.id, merc);
  const plan = sweep.planVaultSweep();
  assert.equal(plan.length, 1);
  assert.equal(plan[0].carried, true);
  assert.deepEqual(plan[0].banked.map((e) => [e.name, e.quantity]), [["Gold", 60], ["Copper", 12]]);
  assert.deepEqual(await sweep.runVaultSweep({ announce: false }), { swept: 1, gp: 60.12 });
  assert.deepEqual(purse(merc), ["Copper ×12", "Gold ×64", "Silver ×9"]);
  assert.ok(merc.items.contents.every((i) => i.system.quantitybank === 0));
  assert.equal(merc.writes, 1, "one write: the count moves between two fields of the same row");
  assert.deepEqual(await sweep.runVaultSweep({ announce: false }), { swept: 0, gp: 0 }, "and a second pass finds nothing");
});
await test("a token that is its own copy of an actor is swept through the token, and only where its copy holds a balance", async () => {
  const base = makeActor({ id: "base", type: "monster", items: [gold(1, { _id: "g" })] });
  worldActors.set(base.id, base);
  const copyOf = (bank) => {
    const actor = makeActor({ id: "base", type: "monster", items: [gold(2, { _id: "g", bank })] });
    actor.isToken = true;
    actor.uuid = `Scene.s.Token.t${bank}.Actor.base`;
    return actor;
  };
  const stray = copyOf(25);
  const clean = copyOf(0);
  const built = new Set();
  const token = (actor, linked = false) => ({
    actorLink: linked,
    _source: { delta: { items: actor.items.map((i) => i.toObject()) } },
    get actor() { built.add(actor); return actor; },
  });
  worldScenes.push({ tokens: [token(stray), token(clean), token(copyOf(40), true), { actorLink: false, _source: { delta: null } }] });
  assert.deepEqual(await sweep.runVaultSweep({ announce: false }), { swept: 1, gp: 25 });
  assert.deepEqual(purse(stray), ["Gold ×27"]);
  assert.deepEqual([...built], [stray], "an actor is built only for the token whose copy holds a balance");
  assert.deepEqual(purse(base), ["Gold ×1"], "the actor it was made from is untouched");
});
await test("the sweep can be narrowed to the actors a Judge chose", async () => {
  const a = makeActor({ id: "a", type: "monster", items: [gold(0, { bank: 5 })] });
  const b = makeActor({ id: "b", type: "monster", items: [gold(0, { bank: 7 })] });
  worldActors.set(a.id, a);
  worldActors.set(b.id, b);
  assert.deepEqual(await sweep.runVaultSweep({ announce: false, only: new Set([b.uuid]) }), { swept: 1, gp: 7 });
  assert.deepEqual([purse(a), purse(b)], [["Gold ×0"], ["Gold ×7"]]);
});

/* -------------------------------------------- */
/*  Coin dropped on a sheet                     */
/* -------------------------------------------- */

console.log("coin: dropped on a sheet");

// Foundry's own answer to an item off another actor: make it again here and
// leave the giver's alone. Every sheet that states no drop handler inherits it.
class BaseSheet {
  constructor(actor) { this.actor = actor; }
  async _onDropItem(_event, item) {
    if (!this.actor.isOwner) return null;
    if (this.actor.uuid === item.parent?.uuid) {
      this.sorted = (this.sorted ?? 0) + 1;
      return item;
    }
    const [made] = await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
    return made;
  }
}
globalThis.foundry.applications = { sheets: { ActorSheetV2: BaseSheet } };
const { installGoodsDrag } = await import("../scripts/lib/patches/goods-drag.mjs");
const { landCoin } = await import("../scripts/lib/bundles.mjs");
installGoodsDrag();
class Card extends BaseSheet {}

await test("coin dropped on a sheet that takes Foundry's own drop is handed over, never copied", async () => {
  const giver = makeActor({ id: "giver", items: [gold(5, { _id: "pile" }), silver(2, { _id: "s" })] });
  const taker = makeActor({ id: "taker", items: [gold(9, { _id: "theirs" })] });
  assert.equal(await new Card(taker)._onDropItem({}, giver.items.get("pile")), null);
  assert.deepEqual([purse(giver), purse(taker)], [["Silver ×2"], ["Gold ×14"]], "the pile left the giver and joined the receiver's row");
  await new Card(taker)._onDropItem({}, giver.items.get("s"));
  assert.deepEqual([purse(giver), purse(taker)], [[], ["Gold ×14", "Silver ×2"]]);
  assert.equal(cp(giver) + cp(taker), 1420, "no coin is made or lost");
});
await test("coin with no actor behind it lands on the row of its kind, an empty shelf stack as one coin", async () => {
  const taker = makeActor({ id: "taker", items: [gold(9, { _id: "theirs" })] });
  const card = new Card(taker);
  await card._onDropItem({}, makeItem(gold(0, { _id: "shelf" })));
  await card._onDropItem({}, makeItem(gold(30, { _id: "counted" })));
  assert.deepEqual(purse(taker), ["Gold ×40"]);
  const watched = makeActor({ id: "watched", items: [gold(1)] });
  watched.isOwner = false;
  await new Card(watched)._onDropItem({}, makeItem(gold(5)));
  assert.deepEqual(purse(watched), ["Gold ×1"], "a seat that does not own the sheet lands nothing on it");
});
await test("the guard takes coin from elsewhere and nothing else", async () => {
  const hero = makeActor({ id: "hero", items: [gold(5, { _id: "g" })] });
  const other = makeActor({ id: "other", items: [{ _id: "rope", name: "Rope", type: "item", system: { quantity: { value: 1, max: 0 }, weight6: 2 } }] });
  const card = new Card(hero);
  assert.equal(await card._onDropItem({}, hero.items.get("g")), hero.items.get("g"));
  assert.deepEqual([card.sorted, purse(hero), hero.writes], [1, ["Gold ×5"], 0], "a drop within one actor is the base class's re-sort");
  await card._onDropItem({}, other.items.get("rope"));
  assert.ok(hero.items.get("rope") && other.items.get("rope"), "anything else is still Foundry's copy");
});
await test("a sheet whose actor carries nothing takes no coin: it is neither moved nor copied", async () => {
  const giver = makeActor({ id: "giver", items: [gold(5, { _id: "pile" }), { _id: "rope", name: "Rope", type: "item", system: { quantity: { value: 1, max: 0 }, weight6: 2 } }] });
  for (const type of ["acks-extras.party", "acks-extras.group", "acks-extras.faction", "acks-extras.template"]) {
    const band = makeActor({ id: "band", type });
    assert.equal(await new Card(band)._onDropItem({}, giver.items.get("pile")), null);
    await new Card(band)._onDropItem({}, makeItem(gold(3)));
    assert.deepEqual([purse(giver), purse(band), band.writes, giver.writes], [["Gold ×5"], [], 0, 0], type);
  }
  assert.equal(warnings.length, 8, "each refusal says so");
  const band = makeActor({ id: "band", type: "acks-extras.party" });
  await new Card(band)._onDropItem({}, giver.items.get("rope"));
  assert.ok(band.items.get("rope"), "what Foundry does with anything else is left alone");
  const beast = makeActor({ id: "beast", type: "acks-extras.animal" });
  await new Card(beast)._onDropItem({}, giver.items.get("pile"));
  assert.deepEqual([purse(giver), purse(beast)], [[], ["Gold ×5"]], "an animal carries");
});
await test("where libWrapper is loaded the guard is registered through it, not assigned", async () => {
  class OtherBase {
    constructor(actor) { this.actor = actor; }
    async _onDropItem() { return "base"; }
  }
  const stock = OtherBase.prototype._onDropItem;
  const calls = [];
  globalThis.foundry.applications.sheets.ActorSheetV2 = OtherBase;
  globalThis.libWrapper = { register: (...args) => calls.push(args) };
  try {
    installGoodsDrag();
  } finally {
    delete globalThis.libWrapper;
    globalThis.foundry.applications.sheets.ActorSheetV2 = BaseSheet;
  }
  assert.equal(OtherBase.prototype._onDropItem, stock, "the method is libWrapper's to wrap");
  assert.deepEqual(calls.map((c) => [c[0], c[1], typeof c[2], c[3]]), [["acks-extras", "foundry.applications.sheets.ActorSheetV2.prototype._onDropItem", "function", "MIXED"]]);
  const giver = makeActor({ id: "giver", items: [gold(5, { _id: "pile" })] });
  const taker = makeActor({ id: "taker", type: "monster" });
  const sheet = new OtherBase(taker);
  let fell = 0;
  const wrapped = async () => { fell++; return "base"; };
  assert.equal(await calls[0][2].call(sheet, wrapped, {}, giver.items.get("pile")), null);
  assert.deepEqual([purse(giver), purse(taker), fell], [[], ["Gold ×5"], 0]);
  assert.equal(await calls[0][2].call(sheet, wrapped, {}, makeItem({ name: "Rope", type: "item", system: { quantity: { value: 1 } } })), "base");
  assert.equal(fell, 1, "anything that is not coin from elsewhere reaches the wrapped method");
});
await test("a sheet with a drop handler of its own lands coin by the same statement", async () => {
  const giver = makeActor({ id: "giver", items: [gold(5, { _id: "pile" })] });
  const cart = makeActor({ id: "cart", type: "acks-extras.vehicle", items: [gold(1, { _id: "hold" })] });
  await landCoin(cart, giver.items.get("pile"));
  await landCoin(cart, makeItem(gold(0)));
  assert.deepEqual([purse(giver), purse(cart)], [[], ["Gold ×7"]]);
});
await test("a hand-over crosses to and from a token's own actor; a deposit from one is still refused", async () => {
  const token = makeActor({ id: "orc", type: "monster", items: [gold(40, { _id: "loot" })] });
  token.isToken = true;
  token.uuid = "Scene.s.Token.t.Actor.orc";
  const hero = makeActor({ id: "hero", items: [gold(2, { _id: "g" }), silver(6, { _id: "s" })] });
  await new Card(hero)._onDropItem({}, token.items.get("loot"));
  assert.deepEqual([purse(token), purse(hero)], [[], ["Gold ×42", "Silver ×6"]], "coin off a fallen monster's token is handed over like any other");
  await new Card(token)._onDropItem({}, hero.items.get("s"));
  assert.deepEqual([purse(token), purse(hero)], [["Silver ×6"], ["Gold ×42"]]);
  const bank = makeActor({ id: "bank", type: LOCATION });
  bank.flags = { "acks-extras": { storage: { provider: true } } };
  const kept = token.items.find((i) => i.name === "Silver");
  assert.deepEqual(await storage.stash(token, bank, [{ id: kept.id }]), { ok: false, reason: "token" });
  assert.deepEqual(purse(bank), [], "goods stamped with a token's uuid could never be returned to it");
});
await test("an arrival that is nobody's never joins a row kept for an owner", async () => {
  const stamp = { "acks-extras": { storage: { ownerUuid: "Actor.hero", ownerName: "Hero" } } };
  const held = [gold(50, { _id: "heros", flags: stamp }), gold(3, { _id: "loose" })];
  assert.deepEqual(planStackMerge([gold(4)], held), { creates: [], targetUpdates: [{ _id: "loose", "system.quantity": 7 }] });
  const alone = planStackMerge([gold(4)], [held[0]]);
  assert.deepEqual([alone.creates.length, alone.targetUpdates], [1, []], "it is a row of its own beside it");
  assert.deepEqual(planStackMerge([gold(4, { flags: stamp })], held, { byOwner: true }).targetUpdates, [{ _id: "heros", "system.quantity": 54 }],
    "what arrives stamped as theirs still does");
});

console.log(`test-coin-flows: ${passed} checks passed`);
