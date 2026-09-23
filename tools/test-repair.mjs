/**
 * The repair registry and runner (scripts/lib/repair-logic.mjs) and the
 * crash-safe unpack of an embedded bundle (scripts/lib/bundles-logic.mjs).
 * Foundry-free: every check here is a plain object over plain data.
 */
import assert from "node:assert/strict";
import {
  FAILURE,
  danglingRefCheck,
  fixCheck,
  fixEach,
  getRepairCheck,
  registerRepairCheck,
  repairChecks,
  resetRepairChecks,
  scanCheck,
} from "../scripts/lib/repair-logic.mjs";
import { UNPACK_JOURNAL, arrivalOf, isPurchaseBundle, planEmbeddedUnpack, unpackStage } from "../scripts/lib/bundles-logic.mjs";
import { LIB_ID, UNPACKED_FROM, planStackMerge, stackSignature } from "../scripts/lib/storage-logic.mjs";

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/** A check over a mutable set of "broken" keys; the fix removes what it is handed. */
function brokenSet(keys, { fix = (k) => ({ key: k, ok: true }) } = {}) {
  const broken = new Set(keys);
  return {
    broken,
    spec: {
      scan: async () => [...broken].map((key) => ({ key, uuid: `Actor.${key}`, name: key, detail: "d" })),
      fix: async (findings) => findings.map((f) => fix(f.key, broken)),
    },
  };
}

t("a check id is <feature>.<name>, unique, and needs a scan", () => {
  resetRepairChecks();
  assert.throws(() => registerRepairCheck({ id: "nofeature", scan: () => [] }), /feature/);
  assert.throws(() => registerRepairCheck({ id: "a.b" }), /no scan/);
  const check = registerRepairCheck({ id: "lib.one", label: "L", scan: () => [] });
  assert.equal(check.feature, "lib");
  assert.equal(getRepairCheck("lib.one"), check);
  assert.throws(() => registerRepairCheck({ id: "lib.one", scan: () => [] }), /already registered/);
  assert.equal(getRepairCheck("lib.none"), null);
});

t("checks list by feature, then order, then id; `only` and `requires` filter them", () => {
  resetRepairChecks();
  registerRepairCheck({ id: "location.b", order: 5, scan: () => [] });
  registerRepairCheck({ id: "lib.z", order: 2, scan: () => [] });
  registerRepairCheck({ id: "lib.a", order: 2, scan: () => [] });
  registerRepairCheck({ id: "lib.first", order: 1, scan: () => [] });
  registerRepairCheck({ id: "lib.off", requires: () => false, scan: () => [] });
  registerRepairCheck({ id: "lib.broken", requires: () => { throw new Error("x"); }, scan: () => [] });
  assert.deepEqual(repairChecks().map((c) => c.id), ["lib.first", "lib.a", "lib.z", "location.b"]);
  assert.deepEqual(repairChecks({ only: ["location.b", "lib.a"] }).map((c) => c.id), ["lib.a", "location.b"]);
});

t("a scan's findings are normalised: string keys, first of a duplicate, none without a key", async () => {
  resetRepairChecks();
  const check = registerRepairCheck({
    id: "lib.norm",
    scan: async () => [{ key: 7, name: "a" }, { key: "7", name: "dup" }, { name: "keyless" }, { key: "b", fixable: false, reason: "why" }],
    fix: async () => [],
  });
  const { findings, error } = await scanCheck(check);
  assert.equal(error, null);
  assert.deepEqual(findings.map((f) => [f.key, f.name, f.fixable]), [["7", "a", true], ["b", "", false]]);
  assert.equal(findings[1].reason, "why");
});

t("a report-only check never offers a finding, and cannot be fixed", async () => {
  resetRepairChecks();
  const check = registerRepairCheck({ id: "lib.report", scan: async () => [{ key: "a" }] });
  const { findings } = await scanCheck(check);
  assert.equal(findings[0].fixable, false);
  await assert.rejects(() => fixCheck(check, findings), /report-only/);
});

t("a scan that throws reports its error and no findings", async () => {
  resetRepairChecks();
  const check = registerRepairCheck({ id: "lib.throws", scan: async () => { throw new Error("boom"); } });
  assert.deepEqual(await scanCheck(check), { id: "lib.throws", findings: [], error: "boom" });
});

t("the rescan decides: what it no longer finds is fixed, with the fix's summary", async () => {
  resetRepairChecks();
  const { broken, spec } = brokenSet(["a", "b"], { fix: (k, set) => (set.delete(k), { key: k, ok: true, summary: `fixed ${k}` }) });
  const check = registerRepairCheck({ id: "lib.ok", ...spec });
  const { findings } = await scanCheck(check);
  const out = await fixCheck(check, findings.filter((f) => f.key === "a"));
  assert.deepEqual(out.fixed.map((f) => [f.key, f.summary]), [["a", "fixed a"]]);
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.rescan.findings.map((f) => f.key), ["b"], "the unchosen finding is untouched");
  assert.deepEqual([...broken], ["b"]);
});

t("a fix that says ok but leaves the finding in place has failed", async () => {
  resetRepairChecks();
  const { spec } = brokenSet(["a"]);
  const check = registerRepairCheck({ id: "lib.liar", ...spec });
  const out = await fixCheck(check, (await scanCheck(check)).findings);
  assert.deepEqual(out.fixed, []);
  assert.equal(out.failed[0].why, FAILURE.still);
});

t("a refusal carries its error; a refusal the rescan contradicts is a fix", async () => {
  resetRepairChecks();
  const { spec } = brokenSet(["a", "b"], {
    fix: (k, set) => {
      if (k === "b") set.delete(k);
      return { key: k, ok: false, error: `no ${k}` };
    },
  });
  const check = registerRepairCheck({ id: "lib.refuse", ...spec });
  const out = await fixCheck(check, (await scanCheck(check)).findings);
  assert.deepEqual(out.failed.map((f) => [f.key, f.why, f.error]), [["a", FAILURE.refused, "no a"]]);
  assert.deepEqual(out.fixed.map((f) => f.key), ["b"]);
});

t("a fix that throws fails every finding the rescan still finds", async () => {
  resetRepairChecks();
  const check = registerRepairCheck({
    id: "lib.throwfix",
    scan: async () => [{ key: "a" }, { key: "b" }],
    fix: async () => { throw new Error("mid-batch"); },
  });
  const out = await fixCheck(check, (await scanCheck(check)).findings);
  assert.deepEqual(out.failed.map((f) => [f.key, f.why, f.error]), [["a", FAILURE.threw, "mid-batch"], ["b", FAILURE.threw, "mid-batch"]]);
});

t("a rescan that throws leaves every chosen finding unverified", async () => {
  resetRepairChecks();
  let scans = 0;
  const check = registerRepairCheck({
    id: "lib.rescanfail",
    scan: async () => {
      if (scans++) throw new Error("gone dark");
      return [{ key: "a" }];
    },
    fix: async (f) => f.map((x) => ({ key: x.key, ok: true })),
  });
  const out = await fixCheck(check, (await scanCheck(check)).findings);
  assert.equal(out.failed[0].why, FAILURE.unverified);
  assert.equal(out.failed[0].error, "gone dark");
});

t("an unfixable finding is never handed to the fix", async () => {
  resetRepairChecks();
  let handed = null;
  const check = registerRepairCheck({
    id: "lib.mixed",
    scan: async () => [{ key: "a" }, { key: "b", fixable: false }],
    fix: async (f) => ((handed = f.map((x) => x.key)), []),
  });
  await fixCheck(check, (await scanCheck(check)).findings);
  assert.deepEqual(handed, ["a"]);
});

t("fixEach turns a throw into a refusal and keeps going", async () => {
  const out = await fixEach([{ key: "a" }, { key: "b" }, { key: "c" }], async (f) => {
    if (f.key === "b") throw new Error("bad b");
    return f.key === "a" ? "done a" : undefined;
  });
  assert.deepEqual(out, [
    { key: "a", ok: true, summary: "done a" },
    { key: "b", ok: false, error: "bad b" },
    { key: "c", ok: true, summary: null },
  ]);
});

t("danglingRefCheck finds the references that no longer resolve, and clears only those", async () => {
  resetRepairChecks();
  const live = new Set(["Actor.here"]);
  const cleared = [];
  const refs = [
    { key: "x", ref: "Actor.here" },
    { key: "y", ref: "Actor.gone" },
  ];
  const check = registerRepairCheck(
    danglingRefCheck({
      id: "lib.refs",
      collect: () => refs.filter((r) => !cleared.includes(r.key)),
      live: (c) => live.has(c.ref),
      clear: async (f) => cleared.push(f.key),
    })
  );
  const { findings } = await scanCheck(check);
  assert.deepEqual(findings.map((f) => f.key), ["y"]);
  const out = await fixCheck(check, findings);
  assert.deepEqual(cleared, ["y"]);
  assert.deepEqual(out.fixed.map((f) => f.key), ["y"]);
});

/* -------------------------------------------------------------------- */
/*  The embedded bundle's unpack                                        */
/* -------------------------------------------------------------------- */

const arrows = (q) => ({ _id: `arrows${q}`, name: "Arrows", type: "item", img: "a.png", system: { quantity: { value: q, max: 0 } } });
const sword = () => ({ name: "Sword", type: "weapon", img: "s.png", system: { damage: "1d8" } });
const bundle = (id, flags = {}) => ({ _id: id, name: "Sword ×2", type: "bundle", flags, system: { itemList: [{ uuid: "Item.s", name: "Sword", type: "weapon", quantity: 2 }] } });

t("an unpack's stage is read off the bundle and the items beside it", () => {
  assert.equal(unpackStage(bundle("B1"), [arrows(5)]), "fresh");
  assert.equal(unpackStage(bundle("B1", { [LIB_ID]: { [UNPACK_JOURNAL]: { merged: true, creates: [] } } }), []), "create");
  const copy = { name: "Sword", type: "weapon", flags: { [LIB_ID]: { [UNPACKED_FROM]: "B1" } } };
  assert.equal(unpackStage(bundle("B1", { [LIB_ID]: { [UNPACK_JOURNAL]: { merged: true } } }), [copy]), "delete");
  assert.equal(unpackStage(bundle("B1"), [copy]), "delete", "copies alone prove the goods arrived");
  assert.equal(unpackStage(bundle("B2"), [copy]), "fresh", "another bundle's copies prove nothing");
});

t("the plan merges stackables and writes the journal in one call, and stamps every copy", () => {
  const goods = [arrows(10), sword(), sword()].map(arrivalOf);
  const { updates, creates } = planEmbeddedUnpack("B1", goods, [arrows(5)]);
  assert.deepEqual(updates[0], { _id: "arrows5", "system.quantity.value": 15 });
  const journal = updates.at(-1);
  assert.equal(journal._id, "B1");
  assert.equal(journal[`flags.${LIB_ID}.${UNPACK_JOURNAL}`].merged, true);
  assert.equal(creates.length, 2);
  assert.ok(creates.every((c) => c.flags[LIB_ID][UNPACKED_FROM] === "B1"));
  assert.deepEqual(journal[`flags.${LIB_ID}.${UNPACK_JOURNAL}`].creates, creates, "the journal holds exactly what is still owed");
});

/**
 * Drives the three writes against an in-memory actor, stopping after `stopAfter`
 * of them, then resumes the way the repair check does. Returns the items left.
 */
function unpackWithCrash(stopAfter) {
  let items = [arrows(5), bundle("B1")];
  let nextId = 0;
  const apply = (updates) => {
    for (const u of updates) {
      const doc = items.find((i) => i._id === u._id);
      for (const [path, value] of Object.entries(u)) {
        if (path === "_id") continue;
        const keys = path.split(".");
        let at = doc;
        for (const k of keys.slice(0, -1)) at = at[k] ??= {};
        at[keys.at(-1)] = structuredClone(value);
      }
    }
  };
  const create = (list) => (items = [...items, ...list.map((c) => ({ ...structuredClone(c), _id: `new${nextId++}` }))]);
  const remove = (id) => (items = items.filter((i) => i._id !== id));
  const goods = [arrows(10), sword(), sword()].map(arrivalOf);

  const run = (limit) => {
    let writes = 0;
    const b = items.find((i) => i._id === "B1");
    if (!b) return;
    const stage = unpackStage(b, items);
    if (stage === "fresh") {
      const plan = planEmbeddedUnpack("B1", goods, items);
      apply(plan.updates);
      if (++writes >= limit) return;
      create(plan.creates);
      if (++writes >= limit) return;
    } else if (stage === "create") {
      create(b.flags[LIB_ID][UNPACK_JOURNAL].creates);
      if (++writes >= limit) return;
    }
    remove("B1");
  };
  run(stopAfter);
  run(Infinity);
  return items;
}

t("an unpack stopped after any write is finished by the next run, and nothing arrives twice", () => {
  for (const stopAfter of [1, 2, 3]) {
    const items = unpackWithCrash(stopAfter);
    assert.equal(items.find((i) => i.type === "bundle"), undefined, `stop after ${stopAfter}: the bundle is gone`);
    assert.equal(items.filter((i) => i.name === "Sword").length, 2, `stop after ${stopAfter}: two swords, not four`);
    const quiver = items.filter((i) => i.name === "Arrows");
    assert.equal(quiver.length, 1);
    assert.equal(quiver[0].system.quantity.value, 15, `stop after ${stopAfter}: the arrows merged once`);
  }
});

t("the provenance stamp never splits a stack, and does not travel with the goods", () => {
  const stamped = { ...arrows(3), flags: { [LIB_ID]: { [UNPACKED_FROM]: "B1" } } };
  assert.equal(stackSignature(stamped), stackSignature(arrows(3)));
  const { creates, targetUpdates } = planStackMerge([arrivalOf(arrows(2))], [stamped]);
  assert.deepEqual(creates, []);
  assert.deepEqual(targetUpdates, [{ _id: "arrows3", "system.quantity.value": 5 }]);
  assert.equal(arrivalOf(stamped).flags[LIB_ID][UNPACKED_FROM], undefined);
});

t("a market purchase's bundle is recognised by its one row and its count", () => {
  assert.equal(isPurchaseBundle(bundle("B1")), true);
  assert.equal(isPurchaseBundle({ ...bundle("B1"), name: "Kit" }), false);
  assert.equal(isPurchaseBundle({ name: "Two ×2", system: { itemList: [{ name: "Two", quantity: 2 }, { name: "More", quantity: 1 }] } }), false);
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log(`ok - ${name}`);
}
console.log(`\n${n} tests passed`);
