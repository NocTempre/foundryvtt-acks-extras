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

/** What was registered for a one-time hook, so a test can fire `socketlib.ready` itself. */
const onceHooks = new Map();

globalThis.acksExtras ??= {};
globalThis.Hooks = { on() {}, once: (name, fn) => onceHooks.set(name, [...(onceHooks.get(name) ?? []), fn]), call() {}, callAll() {} };
globalThis.ui = { notifications: { warn: (text) => warnings.push(text), info() {}, error() {} } };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.foundry = { utils: { setProperty, randomID: () => `r${++serial}`, deepClone: (v) => structuredClone(v) } };
globalThis.game = {
  items: worldItems,
  actors: worldActors,
  scenes: worldScenes,
  packs: [],
  user: { isGM: true, id: "gm" },
  users: { get: (id) => (id === "player" ? PLAYER : { isGM: true, id: "gm" }), filter: () => [], find: () => null, activeGM: null },
  i18n: { localize: (k) => k, format: (k) => k },
};

/** The two seats a test sits in: the Judge's, and a player's. */
const JUDGE = globalThis.game.user;
const PLAYER = { isGM: false, id: "player" };

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
  const actor = { id, name, type, documentName: "Actor", uuid: `Actor.${id}`, isToken: false, system: {}, flags: {}, items: new Coll(), writes: 0 };
  // Who may write this actor other than the Judge: the ids of its owning seats.
  // `isOwner` answers for the seat in play, as a live document's does; a test
  // that assigns it pins the answer.
  actor.owners = ["player"];
  let pinned = null;
  Object.defineProperty(actor, "isOwner", {
    get: () => pinned ?? (!!game.user?.isGM || actor.owners.includes(game.user?.id)),
    set: (value) => { pinned = value; },
  });
  actor.testUserPermission = (user) => !!user?.isGM || actor.owners.includes(user?.id);
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
  actor.setFlag = async (scope, key, value) => {
    actor.flags = { ...actor.flags, [scope]: { ...(actor.flags?.[scope] ?? {}), [key]: value } };
    return actor;
  };
  for (const data of items) add(data);
  return actor;
}

/** A place that keeps goods for owners, registered with the world. `vaultOf` makes it one character's vault. */
function makePlace({ id, name = id, type = LOCATION, items = [], vaultOf = null, market = false }) {
  const place = makeActor({ id, name, type, items });
  place.flags = { "acks-extras": { storage: { provider: true, ...(vaultOf ? { vaultOf } : {}) } } };
  if (market) place.system = { marketClass: 4 };
  worldActors.set(place.id, place);
  return place;
}

/** The flag that stamps a row as kept for `owner`. */
const keptFor = (owner, extra = {}) => ({ "acks-extras": { storage: { ownerUuid: owner.uuid, ownerName: owner.name }, ...extra } });

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

/** A container a holder carries, and the flag that puts a row inside one. */
const pack = (id = "pack", record = {}, over = {}) => ({
  _id: id,
  name: over.name ?? "Backpack",
  type: "item",
  system: { cost: 2, weight6: 6 },
  flags: { "acks-extras": { container: record, ...(over.inside ? { containedIn: over.inside } : {}), ...(over.storage ? { storage: over.storage } : {}) } },
});
const inside = (id) => ({ "acks-extras": { containedIn: id } });
const inPack = inside("pack");

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
  const hero = makeActor({ id: "hero", items: [pack(), gold(500, { _id: "packed", flags: inPack }), gold(20, { _id: "loose" })] });
  const count = (id) => hero.items.get(id)?.system.quantity ?? null;
  await creditCoin(hero, [{ cv: 100, count: 3 }, { source: gold(2), count: 2 }]);
  assert.deepEqual([count("loose"), count("packed")], [25, 500]);
  assert.deepEqual(planStackMerge([gold(4)], hero.items.map((i) => i.toObject())), { creates: [], targetUpdates: [{ _id: "loose", "system.quantity": 29 }] },
    "goods handed over find the same row");
  assert.equal((await sinkCoin(hero, 30)).ok, true);
  assert.deepEqual([count("loose"), count("packed")], [null, 495], "the pack is opened only for what the loose pile cannot cover, and the emptied row is gone");
  const only = makeActor({ id: "only", items: [pack(), gold(500, { _id: "packed", flags: inPack, img: "packed.webp" })] });
  await creditCoin(only, [{ cv: 100, count: 3 }]);
  assert.deepEqual(purse(only), ["Gold ×3", "Gold ×500"], "coin arrives loose: what was packed away stays as it was counted");
  assert.equal(only.items.find((i) => i.system.quantity === 3).img, "packed.webp", "and the new row is a copy of the coin the holder already keeps");
});
await test("a pointer at a container that is not there reads as coin carried loose", async () => {
  const hero = makeActor({ id: "hero", items: [gold(8, { _id: "stray", flags: inPack })] });
  await creditCoin(hero, [{ cv: 100, count: 2 }]);
  assert.deepEqual(purse(hero), ["Gold ×10"], "the row is the loose pile, so the arrival joins it");
  assert.deepEqual(money.coinStores(hero).map((s) => [s.key, s.rows.length]), [["", 1]]);
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
  assert.deepEqual(purse(bank), ["Gold ×0", "Gold ×12", "Gold, debased ×2", "Silver ×3"], "kinds stay apart, and a banked balance adds nothing");
  assert.equal(bank.items.find((i) => i.system.quantity === 0).system.quantitybank, 60, "the folded row is emptied and kept while it carries a balance");
  assert.deepEqual(await storage.consolidateMoney(bank, "Actor.hero"), { merged: 0 }, "and is not folded a second time");
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
  assert.deepEqual(purse(hero), ["Gold ×1", "Silver ×2"], "the row the payment emptied is removed, not left listed at none");
  assert.equal(cp(hero), before - 250, "exactly what was owed has left");
  assert.equal(hero.writes, 2, "one write for the takes, one for the row they emptied");
});
await test("a broken coin never costs more than was owed", async () => {
  const hero = makeActor({ id: "hero", items: [gold(1)] });
  assert.equal((await sinkCoin(hero, 0.3)).ok, true);
  assert.equal(cp(hero), 70, "the change no gold piece can represent comes back as smaller coin");
  assert.equal(row(hero, "Gold"), null);
});
await test("a row a payment empties is kept only while it carries a banked balance", async () => {
  const hero = makeActor({ id: "hero", items: [gold(2, { _id: "g", bank: 40 }), silver(5, { _id: "s" })] });
  assert.equal((await sinkCoin(hero, 2.5)).ok, true);
  assert.deepEqual(purse(hero), ["Gold ×0"]);
  assert.equal(hero.items.get("g").system.quantitybank, 40, "the balance is still there for the migration to move");
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
  assert.deepEqual(purse(payer), ["Silver ×7"]);
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
  assert.deepEqual(purse(payer), ["Copper ×5", "Silver ×2"]);
  assert.deepEqual(purse(payee), ["Gold ×1", "Silver ×1"]);
  assert.equal(cp(payee) - 5, 105, "the payee is up by exactly what was owed");
  assert.equal(cp(payer) + cp(payee), 135, "no coin is made or lost");
  assert.equal(payer.writes, 3, "the change lands, the coins paid leave, and the row they emptied is removed");
});
await test("what is paid and what comes back land before anything is taken", async () => {
  const payer = makeActor({ id: "payer", items: [gold(1)] });
  const payee = makeActor({ id: "payee", items: [silver(10)] });
  const order = [];
  for (const actor of [payer, payee]) {
    for (const call of ["createEmbeddedDocuments", "updateEmbeddedDocuments", "deleteEmbeddedDocuments"]) {
      const real = actor[call];
      actor[call] = async (...args) => {
        order.push(`${actor.id}:${call.slice(0, 6)}`);
        return real(...args);
      };
    }
  }
  await transferCoin({ from: payer, to: payee, gp: 0.3, gate: false });
  assert.deepEqual(order, ["payee:create", "payer:create", "payer:delete", "payee:update"], "a payment cut short leaves a duplicate, never a loss");
});
await test("change is the payer's own coin held back before it is anything out of the payee's purse", async () => {
  const payer = makeActor({ id: "payer", items: [silver(3), gold(1)] });
  const payee = makeActor({ id: "payee", items: [coin("Shillings", 10, 4), copper(5)] });
  assert.deepEqual(await transferCoin({ from: payer, to: payee, gp: 1.05, gate: false }), { ok: true, changeCp: 25 });
  assert.deepEqual(purse(payer), ["Copper ×5", "Silver ×2"], "no shilling changes hands for silver the payer already held");
  assert.deepEqual(purse(payee), ["Gold ×1", "Shillings ×4", "Silver ×1"]);
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
  assert.deepEqual(purse(payer), ["Electrum ×1", "Silver ×1"]);
  assert.deepEqual(purse(payee), ["Gold ×1", "Silver ×2"]);
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
/*  Where coin is kept                          */
/* -------------------------------------------- */

console.log("coin: where it is kept");
const { coinStores, setCoinOrder, gatherCoin, spendableGp } = money;
const LOCKED = { locked: true, opened: false };
const keysOf = (holder, opts) => coinStores(holder, opts).map((s) => s.key);
const listed = (rows) => rows.map((i) => `${i.name} ×${i.system.quantity}`).sort();
/** The coin a holder carries inside one container, or loose for `null`. */
const inBox = (holder, id) => listed(holder.items.filter((i) => i.type === "money" && (i.flags["acks-extras"]?.containedIn ?? null) === id));
/** The coin a place keeps for one owner. */
const keptAt = (place, owner) => listed(place.items.filter((i) => i.type === "money" && i.flags["acks-extras"]?.storage?.ownerUuid === owner.uuid));
/** Something on a map: a scene the way the reach readers see one. */
const sceneWith = (id, ...actorIds) => ({ id, uuid: `Scene.${id}`, documentName: "Scene", tokens: actorIds.map((actorId) => ({ actorId, uuid: `Scene.${id}.Token.${actorId}` })) });
/** The location feature's two answers about a place and a scene, as lib asks for them. */
const mapAnswers = (linked = {}) => ({
  scenes: { sceneOfLocation: (place) => linked[place.id] ?? null },
  here: { placeStandsOn: (scene, place) => scene.tokens.some((t) => t.actorId === place.id) },
});

await test("a holder's stores are what they carry loose, each container, then the places keeping coin for them", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), pack(), silver(8, { flags: inPack }), pack("chest", LOCKED, { name: "Chest" }), gold(90, { flags: inside("chest") })] });
  worldActors.set(hero.id, hero);
  makePlace({ id: "bank", name: "Bank", items: [gold(40, { flags: keptFor(hero) })] });
  makePlace({ id: "vault", name: "Zed's vault", vaultOf: hero.uuid });
  makePlace({ id: "other", name: "Another bank", items: [gold(99, { flags: keptFor({ uuid: "Actor.rival", name: "Rival" }) })] });
  const stores = coinStores(hero);
  assert.deepEqual(stores.map((s) => s.key), ["", "item:pack", "item:chest", "place:Actor.vault", "place:Actor.bank"], "a vault comes before the other places");
  assert.deepEqual(stores.map((s) => s.kind), ["loose", "container", "container", "place", "place"]);
  assert.deepEqual(stores.map((s) => s.shut), [false, false, true, false, false]);
  assert.deepEqual(stores.map((s) => s.takesCoin), [true, true, false, true, true]);
  assert.deepEqual(stores.map((s) => s.rows.length), [1, 1, 1, 0, 1]);
  assert.equal(purseGp(hero), 93.8, "what is carried counts the locked chest");
  assert.equal(spendableGp(hero), 43.8, "what can be paid with does not, and does count the bank");
  assert.deepEqual(keysOf(hero, { within: "hand" }), ["", "item:pack", "item:chest"]);
  assert.equal(spendableGp(hero, { within: "hand" }), 3.8);
  assert.deepEqual(keysOf(worldActors.get("bank")), [""], "nothing is kept for a house elsewhere");
  const token = makeActor({ id: "orc", items: [gold(4)] });
  token.isToken = true;
  token.uuid = "Scene.s.Token.t.Actor.orc";
  assert.deepEqual(keysOf(token), [""], "nor for a token's own actor");
});
await test("coin shut in a locked container is neither spent nor landed in, at a place as on a person", async () => {
  const hero = makeActor({ id: "hero", items: [pack("chest", LOCKED), gold(90, { flags: inside("chest") })] });
  worldActors.set(hero.id, hero);
  const bank = makePlace({ id: "bank", items: [pack("box", LOCKED, { storage: keptFor(hero)["acks-extras"].storage }), gold(40, { flags: keptFor(hero, { containedIn: "box" }) })] });
  assert.deepEqual(await sinkCoin(hero, 5), { ok: false, reason: "insufficient", shortfallCp: 500 });
  assert.equal(hero.writes + bank.writes, 0);
  assert.deepEqual(keysOf(hero), ["", "item:chest"], "a place whose only coin for the holder is locked away keeps none they can reach");
  await setCoinOrder(hero, { receiveInto: "item:chest" });
  await creditCoin(hero, [{ cv: 100, count: 2 }]);
  assert.deepEqual([inBox(hero, null), inBox(hero, "chest")], [["Gold ×2"], ["Gold ×90"]], "a store that is shut is passed over for coin carried loose");
});
await test("a payment draws on the store the holder named first, then on the rest in their standing order", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10, { _id: "loose" }), pack(), gold(10, { _id: "packed", flags: inPack })] });
  const count = (id) => hero.items.get(id)?.system.quantity ?? null;
  assert.equal((await sinkCoin(hero, 3)).ok, true);
  assert.deepEqual([count("loose"), count("packed")], [7, 10], "unstated, coin carried loose goes first");
  assert.deepEqual(await setCoinOrder(hero, { payFrom: "item:pack" }), { payFrom: "item:pack", receiveInto: "" });
  assert.equal((await sinkCoin(hero, 12)).ok, true);
  assert.deepEqual([count("loose"), count("packed")], [5, null], "the named store is emptied before the next is opened");
  await setCoinOrder(hero, { payFrom: "item:gone" });
  assert.equal((await sinkCoin(hero, 1)).ok, true);
  assert.equal(count("loose"), 4, "an order naming a store that is not there is the standing order");
});
await test("a holder's order decides which coins go, never whether the payment can be made", async () => {
  const hero = makeActor({ id: "hero", items: [silver(5), pack(), gold(1, { flags: inPack })] });
  await setCoinOrder(hero, { payFrom: "item:pack" });
  const payee = makeActor({ id: "payee" });
  assert.deepEqual(await transferCoin({ from: hero, to: payee, gp: 0.3, gate: false }), { ok: true, changeCp: 0 });
  assert.deepEqual([purse(hero), purse(payee)], [["Gold ×1", "Silver ×2"], ["Silver ×3"]], "the packed gold would have needed change nobody there could make");
  assert.equal(warnings.length, 0);
});
await test("arriving coin lands in the store the holder named, on the row of its kind there or a new one", async () => {
  const hero = makeActor({ id: "hero", items: [gold(10, { _id: "loose" }), pack(), silver(4, { flags: inPack })] });
  await setCoinOrder(hero, { receiveInto: "item:pack" });
  assert.deepEqual(await creditCoin(hero, [{ source: silver(1), count: 6 }, { cv: 100, count: 2 }]), { updates: 1, creates: 1 });
  assert.deepEqual(inBox(hero, "pack"), ["Gold ×2", "Silver ×10"]);
  assert.equal(hero.items.get("loose").system.quantity, 10, "the loose pile of the same kind is not where it lands");
  await creditCoin(hero, [{ cv: 100, count: 1 }], { into: "" });
  assert.equal(hero.items.get("loose").system.quantity, 11, "a caller that names a store overrides the holder's order");
  const payee = makeActor({ id: "payee", items: [silver(10)] });
  assert.equal((await transferCoin({ from: hero, to: payee, gp: 0.3, gate: false })).ok, true);
  assert.deepEqual([inBox(hero, null), inBox(hero, "pack")], [["Gold ×10"], ["Gold ×2", "Silver ×17"]],
    "a loose gold piece was broken before the pack was opened, and its change is an arrival: it lands where arrivals do");
  await setCoinOrder(hero, { payFrom: "item:pack" });
  const taker = makeActor({ id: "taker", items: [copper(50)] });
  assert.equal((await transferCoin({ from: hero, to: taker, gp: 0.95, gate: false })).ok, true);
  assert.deepEqual([inBox(hero, null), inBox(hero, "pack")], [["Gold ×10"], ["Copper ×5", "Gold ×2", "Silver ×7"]], "named first, the pack pays and takes its own change");
});
await test("coin handed over goes where the receiver keeps arriving coin, and coin in a container that travels stays in it", async () => {
  const giver = makeActor({ id: "giver", items: [gold(5, { _id: "pile" }), pack("sack", {}, { name: "Sack" }), silver(7, { flags: inside("sack") })] });
  const taker = makeActor({ id: "taker", items: [gold(9, { _id: "theirs" }), pack()] });
  await setCoinOrder(taker, { receiveInto: "item:pack" });
  assert.equal((await storage.handOver(giver, taker, [{ id: "pile" }])).ok, true);
  assert.deepEqual([inBox(taker, "pack"), taker.items.get("theirs").system.quantity], [["Gold ×5"], 9]);
  assert.equal((await storage.handOver(giver, taker, [{ id: "sack" }])).ok, true);
  const sack = taker.items.find((i) => i.name === "Sack");
  assert.deepEqual([purse(giver), inBox(taker, sack.id), inBox(taker, "pack")], [[], ["Silver ×7"], ["Gold ×5"]]);
  await setCoinOrder(taker, { receiveInto: "place:Actor.vault" });
  await storage.handOver(taker, giver, [{ id: "theirs" }]);
  await storage.handOver(giver, taker, [{ id: giver.items.find((i) => i.type === "money").id }]);
  assert.deepEqual(inBox(taker, null), ["Gold ×9"], "a place named there is not where a hand-over lands: coin handed to a holder is on the holder");
});
await test("coin a holder keeps at a place is paid in there and paid out from there", async () => {
  const hero = makeActor({ id: "hero", name: "Hero" });
  worldActors.set(hero.id, hero);
  const vault = makePlace({ id: "vault", vaultOf: hero.uuid });
  const boss = makeActor({ id: "boss", items: [gold(30)] });
  await setCoinOrder(hero, { receiveInto: "place:Actor.vault" });
  assert.equal((await transferCoin({ from: boss, to: hero, gp: 12, gate: false })).ok, true);
  assert.deepEqual([purse(hero), keptAt(vault, hero)], [[], ["Gold ×12"]], "the wage lands in the vault, as the hero's");
  assert.equal(vault.items.contents[0].flags["acks-extras"].storage.ownerName, "Hero");
  assert.deepEqual([purseGp(hero), spendableGp(hero), purseGp(vault)], [0, 12, 0], "carried by nobody, spendable by the hero, and not the house's");
  const shop = makeActor({ id: "shop", items: [silver(10)] });
  assert.deepEqual(await transferCoin({ from: hero, to: shop, gp: 5.5, gate: false }), { ok: true, changeCp: 50 });
  assert.deepEqual([keptAt(vault, hero), purse(hero), purse(shop)], [["Gold ×6", "Silver ×5"], [], ["Gold ×6", "Silver ×5"]],
    "what the hero cannot cover from hand is drawn from it, and the change comes back to it");
  assert.equal((await transferCoin({ from: hero, to: shop, gp: 6.5, gate: false, within: "hand" })).reason, "insufficient", "a payment that reaches no further than the hand finds none");
});
await test("a transaction states how far it reaches: on hand, one place, or a scene", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(2)] });
  worldActors.set(hero.id, hero);
  const market = makePlace({ id: "market", name: "Market", market: true, items: [gold(10, { flags: keptFor(hero) })] });
  const bank = makePlace({ id: "bank", name: "Bank", items: [gold(50, { flags: keptFor(hero) })] });
  const far = makePlace({ id: "far", name: "Far keep", items: [gold(100, { flags: keptFor(hero) })] });
  assert.deepEqual([spendableGp(hero), spendableGp(hero, { within: "all" }), spendableGp(hero, { within: "hand" }), spendableGp(hero, { within: market }), spendableGp(hero, { within: bank })], [162, 162, 2, 12, 52]);
  const refused = await transferCoin({ from: hero, to: market, gp: 20, gate: false, within: market });
  assert.deepEqual([refused.ok, refused.reason, refused.shortfallCp], [false, "insufficient", 800], "coin kept at another place does not pay at this one");
  assert.equal(hero.writes + market.writes + bank.writes, 0);
  assert.equal((await transferCoin({ from: hero, to: market, gp: 9, gate: false, within: market })).ok, true);
  assert.deepEqual([purse(hero), keptAt(market, hero), keptAt(bank, hero)], [[], ["Gold ×3"], ["Gold ×50"]], "what is on hand goes first, then what the market keeps");
  assert.equal(purseGp(market), 9, "and what was paid is the house's");
  await setCoinOrder(hero, { receiveInto: "place:Actor.bank" });
  await mintCoin(hero, 4, { within: market });
  assert.deepEqual([purse(hero), keptAt(bank, hero)], [["Gold ×4"], ["Gold ×50"]], "coin is not sent to a store outside the reach either");
  acksExtras.location = mapAnswers({ market: sceneWith("town") });
  try {
    const town = sceneWith("town", "bank");
    assert.deepEqual(keysOf(hero, { within: town }), ["", "place:Actor.bank", "place:Actor.market"], "a place linked to the scene, and one standing on it");
    assert.equal(spendableGp(hero, { within: town }), 57);
    assert.deepEqual(keysOf(hero, { within: sceneWith("wilds") }), [""]);
  } finally {
    delete acksExtras.location;
  }
  assert.equal(far.writes, 0);
});
await test("a reach refusal stops a payment, and the Judge's own is carried past it and says so", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(30, { _id: "g" })] });
  worldActors.set(hero.id, hero);
  const market = makePlace({ id: "market", name: "Market", market: true });
  acksExtras.location = { ...mapAnswers(), reach: { depositReach: () => ({ can: false, reason: "notHere", scene: { name: "Town" } }) } };
  const said = [];
  const info = ui.notifications.info;
  ui.notifications.info = (text) => said.push(text);
  game.i18n.has = () => true;
  try {
    const refused = await transferCoin({ from: hero, to: market, gp: 5, reason: "buying" });
    assert.deepEqual([refused.ok, refused.reason, refused.scene], [false, "notHere", "Town"]);
    assert.deepEqual(warnings, ["ACKS-LIB.money.reach.notHere buying"], "the refusal is a sentence about the place, never the bare code");
    assert.equal(hero.writes + market.writes, 0);
    assert.deepEqual(said, []);

    const carried = await transferCoin({ from: hero, to: market, gp: 5, reason: "buying", judge: true });
    assert.equal(carried.ok, true);
    assert.deepEqual([purse(hero), purseGp(market)], [["Gold ×25"], 5]);
    assert.deepEqual(said, ["ACKS-LIB.money.judgeOverride"], "the Judge is told what was waived");

    said.length = 0;
    assert.equal((await transferCoin({ from: hero, to: market, gp: 1, gate: false, judge: true })).ok, true);
    assert.deepEqual(said, [], "a payment that states no gate has nothing to waive");

    warnings.length = 0;
    const turned = await money.exchangeCoins({ actor: hero, place: market, itemId: "g", count: 1, toCv: 10 });
    assert.deepEqual([turned.ok, turned.reason, warnings], [false, "notHere", ["ACKS-LIB.money.reach.notHere"]], "the changer refuses under the same sentence");
    assert.equal((await money.exchangeCoins({ actor: hero, place: market, itemId: "g", count: 1, toCv: 10, judge: true })).ok, true);
    assert.deepEqual(said, ["ACKS-LIB.money.judgeOverride"]);
  } finally {
    delete acksExtras.location;
    delete game.i18n.has;
    ui.notifications.info = info;
  }
});
await test("where a transaction states nothing, the world's standing reach decides", async () => {
  const hero = makeActor({ id: "hero", items: [gold(2)] });
  worldActors.set(hero.id, hero);
  const bank = makePlace({ id: "bank", items: [gold(50, { flags: keptFor(hero) })] });
  makePlace({ id: "far", items: [gold(100, { flags: keptFor(hero) })] });
  worldScenes.push(sceneWith("wilds", "far"), sceneWith("town", "hero", "bank"));
  acksExtras.location = mapAnswers();
  let standing = "all";
  game.settings = { get: () => standing };
  try {
    assert.equal(spendableGp(hero), 152);
    standing = "scene";
    assert.equal(spendableGp(hero), 52, "coin on hand, and coin kept on the scene the payer stands on");
    standing = "hand";
    assert.equal(spendableGp(hero), 2);
    assert.equal(spendableGp(hero, { within: "all" }), 152, "a transaction that states its reach is not narrowed");
    assert.equal(spendableGp(hero, { within: bank }), 52);
    assert.equal((await sinkCoin(hero, 10)).reason, "insufficient");
    assert.equal((await sinkCoin(hero, 10, { within: bank })).ok, true);
    standing = "scene";
    worldScenes.length = 0;
    assert.equal(spendableGp(hero), 0, "a payer standing on no scene has what is on hand");
    game.settings = { get: () => { throw new Error("not registered"); } };
    assert.equal(spendableGp(hero), 142, "a world that has no such setting reaches everything");
  } finally {
    delete game.settings;
    delete acksExtras.location;
  }
});
await test("gathering folds a holder's duplicate rows store by store", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), gold(4), pack(), gold(5, { flags: inPack }), gold(6, { flags: inPack }), silver(2)] });
  worldActors.set(hero.id, hero);
  const vault = makePlace({ id: "vault", vaultOf: hero.uuid, items: [gold(10, { flags: keptFor(hero) }), gold(20, { flags: keptFor(hero) }), gold(7, { flags: keptFor({ uuid: "Actor.other", name: "Other" }) })] });
  assert.deepEqual(await gatherCoin(hero), { merged: 3 });
  assert.deepEqual([inBox(hero, null), inBox(hero, "pack"), purse(vault)], [["Gold ×7", "Silver ×2"], ["Gold ×11"], ["Gold ×30", "Gold ×7"]]);
  assert.deepEqual(await gatherCoin(hero), { merged: 0 });
});

/* -------------------------------------------- */
/*  The controls a sheet draws                  */
/* -------------------------------------------- */

console.log("coin: the order a sheet shows and writes");
const { coinOrderView, bindCoinOrder } = await import("../scripts/lib/coin-order.mjs");
const keysIn = (options) => options.map((o) => o.key);
const chosenIn = (options) => options.filter((o) => o.selected).map((o) => o.key);
/** One coin-order block as the listener meets it: a dataset, and the handlers it was given. */
const blockFor = (uuid) => {
  const block = { dataset: { coinOrder: uuid }, handlers: {}, bound: 0 };
  block.addEventListener = (type, fn) => {
    block.handlers[type] = fn;
    block.bound++;
  };
  return block;
};
const rootOf = (...blocks) => ({ querySelectorAll: (selector) => (selector === "[data-coin-order]" ? blocks : []) });
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

await test("the controls offer every store a holder may use, and each place their sheet lists", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), pack(), silver(8, { flags: inPack }), pack("chest", LOCKED, { name: "Chest" }), gold(90, { flags: inside("chest") })] });
  worldActors.set(hero.id, hero);
  const bank = makePlace({ id: "bank", name: "Bank", items: [gold(40, { flags: keptFor(hero) })] });
  const inn = makePlace({ id: "inn", name: "Inn" });
  const view = coinOrderView(hero, { places: [bank, inn, hero] });
  assert.deepEqual(keysIn(view.payFrom), ["", "item:pack", "place:Actor.bank", "place:Actor.inn"], "a store a lock shuts is not paid from, and a listed place is offered once");
  assert.deepEqual(keysIn(view.receiveInto), ["", "item:pack", "place:Actor.bank", "place:Actor.inn"], "nor is coin sent into one");
  assert.deepEqual(view.payFrom.map((o) => o.label), ["ACKS-LIB.money.order.loose", "Backpack", "Bank", "Inn"]);
  assert.deepEqual([chosenIn(view.payFrom), chosenIn(view.receiveInto)], [[""], [""]], "unstated, both halves read as carried loose");
  assert.deepEqual([view.uuid, view.editable, view.shown, view.choice, view.foldable], ["Actor.hero", true, true, true, 0]);
  assert.deepEqual([view.onHandGp, view.keptGp], [93.8, 40], "what is on hand counts the locked chest; what is kept is the bank's");
  await setCoinOrder(hero, { payFrom: "item:pack", receiveInto: "place:Actor.inn" });
  const stated = coinOrderView(hero, { places: [bank] });
  assert.deepEqual([chosenIn(stated.payFrom), chosenIn(stated.receiveInto)], [["item:pack"], ["place:Actor.inn"]]);
  assert.deepEqual(keysIn(stated.receiveInto), ["", "item:pack", "place:Actor.bank", "place:Actor.inn"], "a place the order names is a store whether or not the sheet lists it");
});
await test("an order naming a store that is gone stays shown as what it is", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3)] });
  worldActors.set(hero.id, hero);
  assert.deepEqual([coinOrderView(hero).shown, coinOrderView(hero).choice], [false, false], "coin carried loose and nowhere else leaves nothing to choose");
  await setCoinOrder(hero, { payFrom: "item:gone" });
  const view = coinOrderView(hero);
  assert.deepEqual(view.payFrom, [
    { key: "", label: "ACKS-LIB.money.order.loose", selected: false },
    { key: "item:gone", label: "ACKS-LIB.money.order.gone", selected: true },
  ]);
  assert.deepEqual([view.shown, view.choice], [true, true], "so the holder can set it back");
});
await test("the fold is offered for the rows a gather would take away, to a seat that may fold them", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), gold(4), silver(2)] });
  worldActors.set(hero.id, hero);
  const vault = makePlace({ id: "vault", vaultOf: hero.uuid, items: [gold(10, { flags: keptFor(hero) }), gold(20, { flags: keptFor(hero) })] });
  const view = coinOrderView(hero);
  assert.deepEqual([view.foldable, view.shown], [2, true]);
  assert.deepEqual(await gatherCoin(hero), { merged: view.foldable }, "the count on the control is the count the fold reports");
  vault.owners = [];
  hero.items.set("again", makeItem(gold(1, { _id: "again" }), hero));
  vault.items.set("more", makeItem(gold(5, { _id: "more", flags: keptFor(hero) }), vault));
  game.user = PLAYER;
  try {
    assert.equal(coinOrderView(hero).foldable, 1, "rows at a place the seat cannot write are not counted");
    hero.owners = [];
    const watched = coinOrderView(hero);
    assert.deepEqual([watched.foldable, watched.editable], [0, false], "and a seat that only reads the sheet is offered no fold");
  } finally {
    game.user = JUDGE;
  }
});
await test("a house keeps no coin elsewhere, a shelf actor shows no controls, and a narrowed reach is said", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), pack()] });
  worldActors.set(hero.id, hero);
  const bank = makePlace({ id: "bank", name: "Bank", items: [gold(9)] });
  const inn = makePlace({ id: "inn", name: "Inn" });
  assert.deepEqual(keysIn(coinOrderView(bank, { places: [inn] }).payFrom), [""], "a place is offered no place");
  assert.equal(coinOrderView(bank, { places: [inn] }).shown, false);
  assert.equal(coinOrderView(hero).reachNote, "", "the widest reach needs no note");
  let standing = "hand";
  game.settings = { get: () => standing };
  try {
    assert.equal(coinOrderView(hero).reachNote, "ACKS-LIB.money.order.reach.hand");
    assert.deepEqual(keysIn(coinOrderView(hero, { places: [inn] }).payFrom), ["", "item:pack", "place:Actor.inn"], "the choice is offered whatever the reach, which is the Judge's to widen");
    standing = "scene";
    assert.equal(coinOrderView(hero).reachNote, "ACKS-LIB.money.order.reach.scene");
  } finally {
    delete game.settings;
  }
  hero.pack = "world.shelf";
  assert.equal(coinOrderView(hero).shown, false);
});
await test("a select writes its half of the order and keeps the change from the sheet's form", async () => {
  const hero = makeActor({ id: "hero", items: [gold(3), pack()] });
  worldActors.set(hero.id, hero);
  const block = blockFor(hero.uuid);
  bindCoinOrder(rootOf(block));
  bindCoinOrder(rootOf(block));
  assert.equal(block.bound, 2, "a block is bound once however often a render reaches it");
  let stopped = 0;
  const change = (dataset, value) => block.handlers.change({ target: { dataset, value }, stopPropagation: () => stopped++ });
  change({ coinOrderHalf: "payFrom" }, "item:pack");
  await settled();
  assert.deepEqual([moneyLogic.coinOrderOf(hero), stopped], [{ payFrom: "item:pack", receiveInto: "" }, 1]);
  change({}, "anything");
  await settled();
  assert.deepEqual([moneyLogic.coinOrderOf(hero), stopped], [{ payFrom: "item:pack", receiveInto: "" }, 1], "another control's change is left to the sheet");
  hero.owners = [];
  game.user = PLAYER;
  try {
    change({ coinOrderHalf: "receiveInto" }, "item:pack");
    await settled();
    assert.deepEqual([moneyLogic.coinOrderOf(hero).receiveInto, stopped], ["", 2], "a seat that does not own the holder writes nothing");
  } finally {
    game.user = JUDGE;
  }
});
await test("the gather control folds the holder's rows and says how many went", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(3), gold(4)] });
  worldActors.set(hero.id, hero);
  const block = blockFor(hero.uuid);
  bindCoinOrder(rootOf(block));
  const said = [];
  const info = ui.notifications.info;
  ui.notifications.info = (text) => said.push(text);
  try {
    const click = (hit) => block.handlers.click({ target: { closest: (selector) => (hit && selector === "[data-coin-order-gather]" ? {} : null) }, preventDefault() {}, stopPropagation() {} });
    click(false);
    await settled();
    assert.deepEqual([purse(hero), said], [["Gold ×3", "Gold ×4"], []], "a click elsewhere in the block does nothing");
    click(true);
    await settled();
    assert.deepEqual([purse(hero), said], [["Gold ×7"], ["ACKS-LIB.money.order.gathered"]]);
    click(true);
    await settled();
    assert.deepEqual(said, ["ACKS-LIB.money.order.gathered", "ACKS-LIB.money.order.nothingToGather"]);
  } finally {
    ui.notifications.info = info;
  }
});

/* -------------------------------------------- */
/*  A payment the seat cannot write alone       */
/* -------------------------------------------- */

console.log("coin: relayed to the Judge");

/** Every call a seat has relayed since the Judge last connected. */
const relayed = [];

/**
 * Connect a Judge: the socket the module registers its handlers on, each call
 * run as the Judge's seat with the sender attested, as socketlib runs one.
 * The module's socket is made once; connecting again only clears the record.
 */
function connectJudge() {
  relayed.length = 0;
  game.users.activeGM = JUDGE;
  const handlers = new Map();
  globalThis.socketlib = {
    registerModule: () => ({
      register: (name, fn) => handlers.set(name, fn),
      executeAsGM: async (name, payload) => {
        const seat = game.user;
        relayed.push(name);
        game.user = JUDGE;
        try {
          return await handlers.get(name).call({ socketdata: { userId: seat.id } }, structuredClone(payload));
        } finally {
          game.user = seat;
        }
      },
    }),
  };
  for (const fn of onceHooks.get("socketlib.ready") ?? []) fn();
  onceHooks.delete("socketlib.ready");
  return relayed;
}

await test("a payment that writes a document the seat does not own is handed whole to the Judge", async () => {
  const hero = makeActor({ id: "hero", items: [gold(2)] });
  const keeper = makeActor({ id: "keeper", items: [silver(20)] });
  keeper.owners = [];
  worldActors.set(hero.id, hero);
  worldActors.set(keeper.id, keeper);
  game.user = PLAYER;
  try {
    assert.deepEqual(await transferCoin({ from: hero, to: keeper, gp: 1.5, gate: false }), { ok: false, reason: "noGm" });
    assert.equal(hero.writes + keeper.writes, 0, "with no Judge connected nothing is written by half");
    const calls = connectJudge();
    assert.deepEqual(await transferCoin({ from: hero, to: keeper, gp: 1.5, gate: false }), { ok: true, changeCp: 50 });
    assert.deepEqual([purse(hero), purse(keeper), calls], [["Silver ×5"], ["Gold ×2", "Silver ×15"], ["libMoveCoin"]]);
    const friend = makeActor({ id: "friend" });
    worldActors.set(friend.id, friend);
    assert.equal((await transferCoin({ from: hero, to: friend, gp: 0.2, gate: false })).ok, true);
    assert.equal(calls.length, 1, "a payment between two actors the seat owns is written by the seat");
  } finally {
    game.user = JUDGE;
  }
});
await test("coin kept at a place the seat does not own pays and is paid into through the Judge", async () => {
  const hero = makeActor({ id: "hero", name: "Hero" });
  const friend = makeActor({ id: "friend", items: [gold(3)] });
  worldActors.set(hero.id, hero);
  worldActors.set(friend.id, friend);
  const bank = makePlace({ id: "bank", items: [gold(40, { flags: keptFor(hero) })] });
  bank.owners = [];
  const calls = connectJudge();
  game.user = PLAYER;
  try {
    assert.deepEqual(coinStores(hero).map((s) => [s.key, s.writable]), [["", true], ["place:Actor.bank", false]]);
    assert.equal((await transferCoin({ from: hero, to: friend, gp: 15, gate: false })).ok, true);
    assert.deepEqual([keptAt(bank, hero), purse(friend), calls.length], [["Gold ×25"], ["Gold ×18"], 1]);
    await setCoinOrder(hero, { receiveInto: "place:Actor.bank" });
    assert.equal((await transferCoin({ from: friend, to: hero, gp: 8, gate: false })).ok, true);
    assert.deepEqual([keptAt(bank, hero), purse(hero), purse(friend), calls.length], [["Gold ×33"], [], ["Gold ×10"], 2], "the coin is put where its owner keeps it");
    await creditCoin(hero, [{ cv: 100, count: 1 }]);
    assert.deepEqual([keptAt(bank, hero), purse(hero)], [["Gold ×33"], ["Gold ×1"]], "a bare credit from a seat that cannot write the place is carried loose instead");
    assert.deepEqual(await gatherCoin(hero), { merged: 0 }, "and gathering leaves a place the seat cannot write alone");
  } finally {
    game.user = JUDGE;
  }
});
await test("the Judge moves coin only for the seat that owns the payer", async () => {
  const mark = makeActor({ id: "mark", items: [gold(50)] });
  const hero = makeActor({ id: "hero" });
  mark.owners = [];
  worldActors.set(mark.id, mark);
  worldActors.set(hero.id, hero);
  connectJudge();
  game.user = PLAYER;
  try {
    assert.deepEqual(await transferCoin({ from: mark, to: hero, gp: 20, gate: false }), { ok: false, reason: "notYours" });
    assert.deepEqual([purse(mark), purse(hero)], [["Gold ×50"], []]);
    const till = makePlace({ id: "till", market: true });
    till.owners = [];
    assert.equal((await transferCoin({ from: till, to: hero, gp: 20, gate: false, allowMint: true })).ok, false, "nor does a seat mint a till it does not own");
    assert.deepEqual([purse(till), purse(hero)], [[], []]);
  } finally {
    game.user = JUDGE;
  }
});

console.log("goods: a place the seat does not own");
await storage.registerStorageRelay();
const { getSocket } = await import("../scripts/lib/sockets.mjs");
const rope = (over = {}) => ({ _id: over._id ?? "rope", name: "Rope", type: "item", system: { quantity: { value: 1, max: 0 }, weight6: 6 }, flags: over.flags ?? {} });
/** A place no player's seat may write, holding `items`. */
const judgesPlace = (id, items = []) => {
  const place = makePlace({ id, items });
  place.owners = [];
  return place;
};

await test("a deposit at a place the seat does not own is made by the Judge, for the character's own seat", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(3500, { _id: "g" }), rope()] });
  worldActors.set(hero.id, hero);
  const abbey = judgesPlace("abbey");
  game.user = PLAYER;
  game.users.activeGM = null;
  try {
    assert.deepEqual(await storage.stash(hero, abbey, [{ id: "g", quantity: 3000 }]), { ok: false, reason: "noGm" });
    assert.equal(hero.writes + abbey.writes, 0, "with no Judge connected nothing is written by half");
    const calls = connectJudge();
    const done = await storage.stash(hero, abbey, [{ id: "g", quantity: 3000 }, { id: "rope" }]);
    assert.equal(done.ok, true);
    assert.deepEqual([purse(hero), keptAt(abbey, hero), calls], [["Gold ×500"], ["Gold ×3000"], ["libMoveGoods"]]);
    assert.deepEqual(abbey.items.filter((i) => i.type === "item").map((i) => [i.name, i.flags["acks-extras"].storage.ownerName]), [["Rope", "Hero"]]);
    assert.equal(hero.items.some((i) => i.name === "Rope"), false, "the goods leave the character");
    assert.deepEqual(warnings, ["ACKS-LIB.socket.noGm"], "the Judge's seat is told nothing of a move it made for another");
  } finally {
    game.user = JUDGE;
  }
});
await test("a character's rows come back through the Judge; another's, and the place's own, do not", async () => {
  const hero = makeActor({ id: "hero", name: "Hero" });
  const rival = makeActor({ id: "rival", name: "Rival" });
  rival.owners = [];
  worldActors.set(hero.id, hero);
  worldActors.set(rival.id, rival);
  const house = { "acks-extras": { storage: { ownerUuid: HOUSE_OWNER, ownerName: "House" } } };
  const offered = { "acks-extras": { storage: { ownerUuid: HOUSE_OWNER, ownerName: "House", retrievable: true } } };
  const abbey = judgesPlace("abbey", [
    gold(3000, { _id: "mine", flags: keptFor(hero) }),
    gold(900, { _id: "theirs", flags: keptFor(rival) }),
    gold(70, { _id: "till", flags: house }),
    rope({ _id: "gift", flags: offered }),
  ]);
  const calls = connectJudge();
  game.user = PLAYER;
  try {
    assert.deepEqual(await storage.retrieve(abbey, hero, [{ id: "theirs" }]), { ok: false, reason: "permission" });
    assert.deepEqual(await storage.retrieve(abbey, hero, [{ id: "mine" }, { id: "till" }]), { ok: false, reason: "permission" }, "one row that is not theirs refuses the whole move");
    assert.deepEqual([purse(hero), abbey.items.size, warnings], [[], 4, ["ACKS-LIB.storage.notOwner", "ACKS-LIB.storage.notOwner"]]);
    assert.equal((await storage.retrieve(abbey, hero, [{ id: "mine", quantity: 1000 }, { id: "gift" }])).ok, true);
    assert.deepEqual([purse(hero), keptAt(abbey, hero), hero.items.some((i) => i.name === "Rope"), calls.length], [["Gold ×1000"], ["Gold ×2000"], true, 3]);
    assert.equal(hero.items.find((i) => i.name === "Rope").flags["acks-extras"]?.storage, undefined, "what is carried is nobody's but the carrier's");
  } finally {
    game.user = JUDGE;
  }
});
await test("the Judge moves goods only for the seat that owns the character, and only within its reach", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(40, { _id: "g" })] });
  const mark = makeActor({ id: "mark", items: [gold(50, { _id: "loot" })] });
  mark.owners = [];
  worldActors.set(hero.id, hero);
  worldActors.set(mark.id, mark);
  const abbey = judgesPlace("abbey", [gold(10, { _id: "kept", flags: keptFor(mark) })]);
  connectJudge();
  const { location } = acksExtras;
  game.user = PLAYER;
  try {
    const ask = (payload) => getSocket().executeAsGM("libMoveGoods", payload);
    assert.deepEqual(await storage.stash(mark, abbey, [{ id: "loot" }]), { ok: false, reason: "permission" }, "a seat that owns neither end asks nobody");
    assert.equal(relayed.length, 0);
    assert.deepEqual(await ask({ kind: "stash", sourceUuid: mark.uuid, targetUuid: abbey.uuid, spec: [{ id: "loot" }], requestUserId: null }), { ok: false, reason: "permission" },
      "a call naming no sender is still the sender's");
    assert.deepEqual(await ask({ kind: "retrieve", sourceUuid: abbey.uuid, targetUuid: mark.uuid, spec: [{ id: "kept" }] }), { ok: false, reason: "permission" });
    assert.deepEqual(await ask({ kind: "retrieve", sourceUuid: mark.uuid, targetUuid: hero.uuid, spec: [{ id: "loot" }] }), { ok: false, reason: "permission" }, "nor is another character's pack a place");
    assert.deepEqual(await ask({ kind: "handOver", sourceUuid: mark.uuid, targetUuid: hero.uuid, spec: [{ id: "loot" }] }), { ok: false, reason: "permission" });
    assert.deepEqual([purse(mark), purse(hero), abbey.items.size], [["Gold ×50"], ["Gold ×40"], 1]);

    acksExtras.location = { reach: { depositReach: () => ({ can: false, reason: "notHere", scene: { name: "The Road" } }) } };
    warnings.length = 0;
    assert.deepEqual(await storage.stash(hero, abbey, [{ id: "g" }]), { ok: false, reason: "outOfReach", why: "notHere", scene: "The Road" });
    assert.deepEqual([purse(hero), abbey.items.size, warnings], [["Gold ×40"], 1, ["ACKS-LIB.money.reach.notHere"]], "the refusal is said on the asking seat");
    acksExtras.location = { reach: { depositReach: () => ({ can: true, reason: null, scene: null }) } };
    assert.equal((await storage.stash(hero, abbey, [{ id: "g" }])).ok, true);
    assert.deepEqual([purse(hero), keptAt(abbey, hero)], [[], ["Gold ×40"]]);
  } finally {
    acksExtras.location = location;
    game.user = JUDGE;
  }
});
await test("a seat that owns the place writes its own move", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(12, { _id: "g" })] });
  worldActors.set(hero.id, hero);
  const cellar = makePlace({ id: "cellar" });
  const calls = connectJudge();
  game.user = PLAYER;
  try {
    assert.equal((await storage.stash(hero, cellar, [{ id: "g" }])).ok, true);
    assert.deepEqual([keptAt(cellar, hero), calls.length], [["Gold ×12"], 0]);
  } finally {
    game.user = JUDGE;
  }
});
await test("a refusal the Judge's seat reaches is said once, and a hand-over is never asked for", async () => {
  const hero = makeActor({ id: "hero", name: "Hero", items: [gold(0, { _id: "none" }), rope()] });
  const friend = makeActor({ id: "friend" });
  friend.owners = [];
  worldActors.set(hero.id, hero);
  worldActors.set(friend.id, friend);
  const abbey = judgesPlace("abbey");
  const calls = connectJudge();
  game.user = PLAYER;
  try {
    assert.deepEqual(await storage.stash(hero, abbey, [{ id: "none" }]), { ok: false, reason: "empty" });
    assert.deepEqual([calls.length, warnings], [1, ["ACKS-LIB.storage.nothingToMove"]], "the seat that made the move for another says nothing of it");
    warnings.length = 0;
    assert.deepEqual(await storage.handOver(hero, abbey, [{ id: "rope" }]), { ok: false, reason: "permission" }, "a hand-over is the seat's own to write, at a place as anywhere");
    assert.deepEqual(await storage.handOver(hero, friend, [{ id: "rope" }]), { ok: false, reason: "permission" });
    assert.deepEqual([calls.length, hero.items.some((i) => i.name === "Rope"), abbey.items.size, friend.items.size], [1, true, 0, 0]);
  } finally {
    game.user = JUDGE;
  }
});

// The payday's own module defines a data model and a dialog as it loads.
foundry.abstract = { DataModel: class {} };
foundry.data = { fields: {} };
foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } };
const { payWagesFor, wageBill } = await import("../scripts/henchmen/engine/events.mjs");
const { secondsPerMonth } = await import("../scripts/henchmen/time.mjs");
const wording = JSON.parse((await import("node:fs")).readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/** A monster on `employer`'s payroll list whose wage clock starts at the epoch, managed by `managerid`. */
function onPayroll(employer, { id, name, wageGp, managerid = employer.id }) {
  const hireling = makeActor({ id, name, type: "monster" });
  hireling.system = { retainer: { enabled: true, managerid, wage: String(wageGp), quantity: 1 } };
  hireling.flags = { "acks-extras": { record: { hiredTime: 0, terms: { wageGp, lastPaidTime: 0 } } } };
  employer.flags = { "acks-extras": { monsterHenchmenList: [...(employer.flags["acks-extras"]?.monsterHenchmenList ?? []), id] } };
  worldActors.set(hireling.id, hireling);
  return hireling;
}

/**
 * Run `press` a month after the epoch and answer what each seat was told, as
 * `[seat, level, text]`. The wording answers with its key and what it was
 * given, and knows the keys the module's own language file holds.
 */
async function toldBy(press) {
  const told = [];
  const { notifications } = ui;
  const { format } = game.i18n;
  const { lib } = acksExtras;
  ui.notifications = Object.fromEntries(["info", "warn", "error"].map((level) => [level, (text) => told.push([game.user.id, level, text])]));
  game.i18n.format = (key, data = {}) => `${key} ${JSON.stringify(data)}`;
  game.i18n.has ??= (key) => key in wording;
  game.settings = { get: () => undefined };
  game.time = { worldTime: secondsPerMonth() + 60 };
  acksExtras.lib = { ...(lib ?? {}), money };
  try {
    await press();
  } finally {
    ui.notifications = notifications;
    game.i18n.format = format;
    delete game.i18n.has;
    delete game.settings;
    delete game.time;
    if (lib) acksExtras.lib = lib;
    else delete acksExtras.lib;
    game.user = JUDGE;
  }
  return told;
}

await test("a payday handed to the Judge and refused whole is told once, on the seat that asked", async () => {
  const boss = makeActor({ id: "boss", name: "Boss", items: [gold(9)] });
  worldActors.set(boss.id, boss);
  const hand = onPayroll(boss, { id: "hand", name: "Hand", wageGp: 4, managerid: "another" });
  const mate = onPayroll(boss, { id: "mate", name: "Mate", wageGp: 2, managerid: "another" });
  hand.owners = [];
  const calls = connectJudge();
  const told = await toldBy(async () => {
    game.user = PLAYER;
    await payWagesFor(boss);
  });
  assert.deepEqual(calls, ["henchmenPayWages"], "a seat that does not own every hireling hands the payday over");
  assert.deepEqual(told.filter(([seat]) => seat === "player"), [
    ["player", "warn", `ACKS-HENCHMEN.wage.refusedBecause.notTogether ${JSON.stringify({ name: "Boss", who: "Hand, Mate" })}`],
  ], "one notification, naming the refusal and who went unpaid");
  assert.deepEqual(told.filter(([seat]) => seat === "gm").map(([, level]) => level), ["warn", "warn"], "each refused transfer said why on the seat that ran it");
  assert.deepEqual([purse(boss), purse(hand), purse(mate)], [["Gold ×9"], [], []], "nothing moved");
  assert.deepEqual([hand, mate].map((a) => a.flags["acks-extras"].record.terms.lastPaidTime), [0, 0], "and the month is still due");
});
await test("a refusal the wording has no sentence for is told as a payday that paid nothing", async () => {
  const boss = makeActor({ id: "boss", name: "Boss", items: [gold(9)] });
  worldActors.set(boss.id, boss);
  onPayroll(boss, { id: "hand", name: "Hand", wageGp: 4, managerid: "another" }).owners = [];
  connectJudge();
  game.i18n.has = () => false;
  const told = await toldBy(async () => {
    game.user = PLAYER;
    await payWagesFor(boss);
  });
  assert.deepEqual(told.filter(([seat]) => seat === "player"), [["player", "warn", `ACKS-HENCHMEN.wage.refused ${JSON.stringify({ name: "Boss" })}`]]);
});
await test("a payday refused whole on the seat that ran it adds nothing to what its transfers said", async () => {
  const boss = makeActor({ id: "boss", name: "Boss", items: [gold(9)] });
  worldActors.set(boss.id, boss);
  onPayroll(boss, { id: "hand", name: "Hand", wageGp: 4, managerid: "another" });
  const calls = connectJudge();
  const judge = await toldBy(() => payWagesFor(boss));
  assert.deepEqual(judge.map(([seat, level]) => [seat, level]), [["gm", "warn"]], "the Judge's own payday");
  const owner = await toldBy(async () => {
    game.user = PLAYER;
    await payWagesFor(boss);
  });
  assert.deepEqual([owner.map(([seat, level]) => [seat, level]), calls], [[["player", "warn"]], []], "a seat that owns every hireling runs its own, and is told by the transfer");
  game.actors.get("hand").owners = [];
  game.users.activeGM = null;
  try {
    const alone = await toldBy(async () => {
      game.user = PLAYER;
      await payWagesFor(boss);
    });
    assert.deepEqual(alone, [["player", "warn", "ACKS-LIB.socket.noGm"]], "with no Judge connected the transport's own warning is the one notification");
  } finally {
    game.users.activeGM = JUDGE;
  }
});
await test("the wage bill names when a payday would next bill more than it does now", async () => {
  const boss = makeActor({ id: "boss", name: "Boss" });
  worldActors.set(boss.id, boss);
  const day = 86400;
  let month;
  let bills;
  await toldBy(async () => {
    month = secondsPerMonth();
    const nobody = wageBill(boss, 5 * day);
    onPayroll(boss, { id: "hand", name: "Hand", wageGp: 4 });
    onPayroll(boss, { id: "mate", name: "Mate", wageGp: 2 }).flags["acks-extras"].record.terms.lastPaidTime = 10 * day;
    bills = [nobody, wageBill(boss, 5 * day), wageBill(boss, month - 1), wageBill(boss, month), wageBill(boss, month + 10 * day)];
  });
  assert.deepEqual(bills, [
    { due: 0, count: 0, monthly: 0, nextDue: null },
    { due: 0, count: 0, monthly: 6, nextDue: month },
    { due: 0, count: 0, monthly: 6, nextDue: month },
    { due: 4, count: 1, monthly: 6, nextDue: month + 10 * day },
    { due: 6, count: 2, monthly: 6, nextDue: 2 * month },
  ], "no clock, none due, the last second before, one due with the other's month ahead, both due with the first one's second month ahead");
});
await test("a payday with nothing due says how many days until something is, while a wage clock runs", async () => {
  const boss = makeActor({ id: "boss", name: "Boss", items: [gold(9)] });
  worldActors.set(boss.id, boss);
  const nobody = await toldBy(() => payWagesFor(boss));
  assert.deepEqual(nobody, [["gm", "info", `ACKS-HENCHMEN.wage.nothingDue ${JSON.stringify({ name: "Boss" })}`]], "an employer who pays nobody is told only that");
  const hand = onPayroll(boss, { id: "hand", name: "Hand", wageGp: 4 });
  const told = await toldBy(async () => {
    // The press is a month and a minute after the epoch: paid three days before the month turned.
    hand.flags["acks-extras"].record.terms.lastPaidTime = secondsPerMonth() - 3 * 86400;
    await payWagesFor(boss);
  });
  assert.deepEqual(told, [["gm", "info", `ACKS-HENCHMEN.wage.nothingDueUntil ${JSON.stringify({ name: "Boss", days: 25 })}`]], "a part day counts as a whole one");
  assert.deepEqual(purse(boss), ["Gold ×9"], "and no coin moved");
  assert.ok("ACKS-HENCHMEN.wage.nothingDueUntil" in wording && "ACKS-CHARACTER.followers.monthlyNext" in wording, "the language file holds both sentences");
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
