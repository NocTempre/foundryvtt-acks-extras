/**
 * Tests for the merchandise manifest: which stacks count as loads, how each is
 * priced, and what a draw takes and hands back. Items are invented; the
 * document writes of removeLoads run against a recording stand-in holder.
 */
import assert from "node:assert/strict";

globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.foundry ={ utils: { deepClone: (v) => structuredClone(v) } };
const { manifestRows, manifestTotals, removeLoads } = await import(new URL("../scripts/markets/engine/manifest.mjs", import.meta.url));

let checks = 0;
const check = (fn) => {
  fn();
  checks++;
};

const load = (id, category, stones, { cost = 10, owner = null, name = "Sack", type = "item", merchandise = true } = {}) => ({
  _id: id,
  name,
  type,
  system: { quantity: { value: stones, max: 0 }, cost },
  flags: {
    "acks-extras": {
      markets: merchandise ? { merchandise: true, category } : {},
      ...(owner ? { storage: { ownerUuid: owner, ownerName: "x" } } : {}),
    },
  },
});

const MONTH = 1000;
const prices = [
  { category: "alpha", monthStartTime: MONTH, priceCp: 1250 },
  { category: "beta", monthStartTime: MONTH - 500, priceCp: 9999 }, // stale month
];
const merchFor = (category) => (category === "alpha" ? { label: "Alpha Goods" } : null);
const items = [
  load("a1", "alpha", 4),
  load("b1", "beta", 3, { cost: 20, name: "Beta Sack" }),
  load("o1", "alpha", 2, { owner: "Actor.other" }),
  load("t1", "alpha", 1, { owner: "Actor.me" }),
  load("n1", "alpha", 5, { merchandise: false }),
  load("z1", "alpha", 0),
  load("w1", "alpha", 2, { type: "weapon" }),
];
const opts = { holderUuid: "Actor.me", holderName: "Me", traderUuid: "Actor.me", prices, monthStart: MONTH, merchFor };
const rows = manifestRows(items, opts);

check(() => assert.deepEqual(rows.map((r) => r.itemId), ["a1", "b1", "t1"], "loads only: other-owner, non-merchandise, empty and non-item stacks are excluded"));
check(() => {
  const a = rows[0];
  assert.equal(a.unitGp, 12.5);
  assert.equal(a.valueGp, 50);
  assert.equal(a.priced, "market", "this month's market row prices the stack");
  assert.equal(a.label, "Alpha Goods");
  assert.equal(a.holderUuid, "Actor.me");
  assert.equal(a.holderName, "Me");
  assert.equal(a.stones, 4);
});
check(() => {
  const b = rows[1];
  assert.equal(b.priced, "base", "a stale month row falls back to base cost");
  assert.equal(b.unitGp, 20);
  assert.equal(b.valueGp, 60);
  assert.equal(b.label, "Beta Sack", "no catalogue row: the item's own name labels it");
});
check(() => assert.equal(rows[2].itemId, "t1", "a stack stamped for the trader is theirs"));
check(() => assert.deepEqual(manifestRows(items, { ...opts, traderUuid: null }).map((r) => r.itemId), ["a1", "b1"], "with no trader, every stamped stack is excluded"));
check(() => assert.equal(manifestRows(items, { ...opts, monthStart: null })[0].priced, "base", "no month: base cost throughout"));
check(() => assert.equal(manifestRows([load("f1", "alpha", 3, { cost: 0.333 })], { prices: [], monthStart: MONTH })[0].valueGp, 1, "value rounds to two decimals"));
check(() => assert.deepEqual(manifestRows(null), []));
check(() => assert.deepEqual(manifestTotals(rows), { stones: 8, valueGp: 50 + 60 + 12.5 }, "totals add stones and value"));
check(() => assert.deepEqual(manifestTotals([]), { stones: 0, valueGp: 0 }));

/* --- removeLoads: a recording holder -------------------------------------- */

const holderOf = (plain) => {
  const log = { updates: [], deletes: [] };
  const docs = plain.map((p) => ({
    id: p._id,
    type: p.type,
    system: p.system,
    getFlag: (scope, key) => p.flags?.[scope]?.[key],
    flags: p.flags,
    toObject: () => structuredClone(p),
  }));
  return {
    log,
    items: docs,
    uuid: "Actor.me",
    updateEmbeddedDocuments: async (_k, u) => log.updates.push(...u),
    deleteEmbeddedDocuments: async (_k, d) => log.deletes.push(...d),
  };
};

const holder = holderOf([load("s1", "alpha", 3), load("s2", "alpha", 4), load("s3", "alpha", 2, { owner: "Actor.other" }), load("s4", "beta", 9)]);
const took = await removeLoads(holder, "alpha", 5, { traderUuid: "Actor.me" });
check(() => {
  assert.equal(took.ok, true);
  assert.equal(took.removed.length, 2, "a draw over two stacks snapshots both");
  assert.equal(took.removed[0].system.quantity.value, 3);
  assert.equal(took.removed[1].system.quantity.value, 2);
  assert.ok(took.removed.every((r) => !("_id" in r)), "snapshots carry no id");
  assert.deepEqual(took.removed[0].flags["acks-extras"].markets, { merchandise: true, category: "alpha" }, "the flag travels inside the snapshot");
  assert.deepEqual(holder.log.deletes, ["s1"], "the emptied stack is deleted");
  assert.deepEqual(holder.log.updates, [{ _id: "s2", "system.quantity.value": 2 }], "the broken stack keeps its remainder");
});
check(() => assert.equal(holder.items[0].system.quantity.value, 3, "the live stack data is not mutated by the snapshot"));

const shortHolder = holderOf([load("s1", "alpha", 3), load("s3", "alpha", 2, { owner: "Actor.other" })]);
const short = await removeLoads(shortHolder, "alpha", 4);
check(() => {
  assert.deepEqual(short, { ok: false, reason: "noLoads", held: 3 }, "another owner's goods are never counted or drawn");
  assert.deepEqual(shortHolder.log, { updates: [], deletes: [] }, "a short draw writes nothing");
});

console.log(`test-manifest: ${checks} checks passed`);
