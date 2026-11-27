/**
 * Offline tests for a cast's instances (`cast-instances.mjs`, `cast-throw.mjs`,
 * the `tooManyInstances` and `severalTargets` verdicts in `cast-plan.mjs`, the
 * instance paths of `cast-apply.mjs`, `cast-card.mjs`, `cast-spell.mjs` and the
 * dialog). Foundry-free; every spell, figure and creature below is invented, so
 * this file carries no book content.
 *
 * Usage: node tools/test-cast-instances.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, user: { targets: new Set() } };
const made = [];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
    made.push(formula);
  }
  async evaluate() {
    this.total = 7;
    this.result = "3 + 4";
    return this;
  }
};
/** A weapon item as the carrier builds one: a document whose system answers the weapon's questions. */
class FakeItem {
  constructor(data, { parent } = {}) {
    this.type = data.type;
    this.parent = parent;
    this.system = { ...data.system, getDamageFormula() { return this.damage.base.formula; }, getDamageModifiers() { return []; } };
  }
}
globalThis.CONFIG = { Item: { documentClass: FakeItem } };

const { instanceCount, scaledRoll, instanceRow, allocate, wholeSplit, assignedOf, instancesTip } = await import("../scripts/magic/cast-instances.mjs");
const { withOnlyTarget, throwInstances, instancesState, splitFor, requestOf, pendingRequests, OFF_SCENE } = await import("../scripts/magic/cast-throw.mjs");
const { castVerdicts, blocked, VERDICT } = await import("../scripts/magic/cast-plan.mjs");
const { checkApplyRequest, applyOnTarget, undoEntry } = await import("../scripts/magic/cast-apply.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { castSpellRun, rowSpecOf } = await import("../scripts/magic/cast-spell.mjs");
const { dialogContext } = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const Tables = await import("../scripts/lib/tables.mjs");
const { DEFENSES_DOC, RESISTANCE_TABLE } = await import("../scripts/lib/defenses.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const flat = (v) => ({ kind: "flat", flat: v });
const perLevel = (base, per) => ({ kind: "perLevel", base, per });

/* ------------------------------------------------------------------ */
/*  instanceCount                                                      */
/* ------------------------------------------------------------------ */

t("a count is its figure at the caster level, held to its cap, with the parts it is made of", () => {
  const row = { value: perLevel(1, 1), max: flat(4) };
  assert.deepEqual(instanceCount(row, 2), { value: 2, parts: [{ key: "figure", value: 2 }, { key: "level", value: 2 }, { key: "cap", value: 4 }] });
  assert.deepEqual(instanceCount(row, 9), { value: 4, parts: [{ key: "figure", value: 9 }, { key: "level", value: 9 }, { key: "cap", value: 4 }] }, "the cap holds the count");
  assert.deepEqual(instanceCount({ value: flat(3) }, null), { value: 3, parts: [{ key: "figure", value: 3 }] }, "a flat figure needs no level");
  assert.equal(instanceCount({ value: 2 }, null).value, 2, "a bare number is a flat figure");
  assert.equal(instanceCount({ value: { kind: "perLevel", base: 1, per: 0.5 } }, 4).value, 2, "a fraction is dropped, never rounded up");
});

t("a count never authored is one; an unread, unresolved or empty one is blank, never one", () => {
  assert.deepEqual(instanceCount({}, 5), { value: 1, parts: [] });
  assert.deepEqual(instanceCount({ value: null }, 5), { value: 1, parts: [] });
  assert.deepEqual(instanceCount({ value: flat(null), max: flat(null) }, 5), { value: 1, parts: [] }, "the model's own empty figure is no figure");
  assert.equal(instanceCount({ value: flat(3), unread: ["value"] }, 5).value, null, "unread value");
  assert.equal(instanceCount({ value: flat(3), unread: ["max"] }, 5).value, null, "unread max");
  assert.equal(instanceCount({ unread: ["value"] }, 5).value, null, "unread, nothing authored");
  assert.equal(instanceCount({ value: perLevel(1, 1) }, null).value, null, "a per-level count with no level is not one");
  assert.equal(instanceCount({ value: perLevel(1, 1), max: flat(4) }, 0).value, null);
  assert.equal(instanceCount({ value: flat(3), max: perLevel(1, 1) }, null).value, null, "a cap that cannot be read leaves the count blank");
  assert.equal(instanceCount({ value: flat(0) }, 5).value, null, "a count below one is blank");
  assert.equal(instanceCount({ value: flat(3), max: flat(0) }, 5).value, null, "a cap below one is blank");
  assert.deepEqual(instanceCount({ value: flat(3), unread: ["roll"] }, 5).value, 3, "another unread field does not blank the count");
});

/* ------------------------------------------------------------------ */
/*  scaledRoll, allocate                                               */
/* ------------------------------------------------------------------ */

t("a single dice term multiplies its dice; any other formula repeats; one leaves it be; blank is blank", () => {
  assert.equal(scaledRoll("2d6", 3), "6d6");
  assert.equal(scaledRoll(" d8 ", 2), "2d8");
  assert.equal(scaledRoll("1d6 + 2", 2), "1d6 + 2 + 1d6 + 2");
  assert.equal(scaledRoll("2d4 - 1", 3), "2d4 - 1 + 2d4 - 1 + 2d4 - 1");
  assert.equal(scaledRoll("2d6", 1), "2d6");
  assert.equal(scaledRoll("2d6+1", 1), "2d6+1");
  for (const count of [null, 0, 1.5, undefined]) if (count !== 1) assert.equal(scaledRoll("2d6", count), "", `count ${count}`);
  assert.equal(scaledRoll("", 3), "");
  assert.equal(scaledRoll(null, 3), "");
  assert.deepEqual(instanceRow({ key: "r", roll: "1d6", value: flat(3) }, 5).roll, "3d6");
  assert.equal(instanceRow({ key: "r", roll: "1d6", value: flat(3), unread: ["value"] }, 5).roll, "", "a blank count leaves no roll");
});

t("the default split is round-robin in the order given; whole splits and sums read what a seat typed", () => {
  assert.deepEqual(allocate(5, ["a", "b", "c"]), { a: 2, b: 2, c: 1 });
  assert.deepEqual(allocate(1, ["a", "b"]), { a: 1, b: 0 });
  assert.deepEqual(allocate(3, ["a"]), { a: 3 });
  assert.deepEqual(allocate(3, []), {});
  assert.deepEqual(allocate(null, ["a"]), { a: 0 });
  assert.deepEqual(wholeSplit({ 0: "2", 1: -1, 2: "x", 3: 1.5, 4: 0 }), { 0: 2, 1: 0, 2: 0, 3: 0, 4: 0 });
  assert.equal(assignedOf({ a: 2, b: 3 }), 5);
  assert.deepEqual(splitFor(4, ["k1", "k2"], { 0: "1", 1: "3" }), { k1: 1, k2: 3 }, "a typed split is read by position where no identities are named");
  assert.deepEqual(splitFor(4, ["k1", "k2"], { tokB: "3", tokA: "1" }, ["tokA", "tokB"]), { k1: 1, k2: 3 }, "a typed split is read by the identity each target key stands for, whatever order it was typed in");
  assert.deepEqual(splitFor(4, ["k1", "k2"], { tokA: "4", gone: "2" }, ["tokA", "tokB"]), { k1: 4, k2: 0 }, "a figure typed for a creature no longer in the bucket is spent nowhere");
  assert.deepEqual(splitFor(4, ["k1", "k2"], null), { k1: 2, k2: 2 });
  assert.deepEqual(splitFor(1, ["k1", "k2"], { 0: 0, 1: 1 }), { k1: 1, k2: 0 }, "a count of one is never typed");
});

t("an instance count's tooltip names each part with the world's figures and the page; a count with no parts has none", () => {
  const loc = (key, data) => `${key}|${JSON.stringify(data)}`;
  const tip = instancesTip(instanceCount({ value: perLevel(1, 1), max: flat(4) }, 9), "p. 1", loc);
  assert.match(tip, /tip\.instances\|.*"count":4/);
  for (const part of ["figure", "level", "cap"]) assert.match(tip, new RegExp(`tip\\.instancesPart\\.${part}\\|`));
  assert.match(tip, /"cite":"p\. 1"/);
  assert.equal(instancesTip(instanceCount({}, 3), "p. 1", loc), "");
});

/* ------------------------------------------------------------------ */
/*  Verdicts                                                           */
/* ------------------------------------------------------------------ */

const bolt = (over = {}) => ({ key: "bolt", type: "damage", roll: "2d6", damage: ["fire"], delivery: "missile", extraordinary: false, ...over });

t("several targets stop a throw row of count one or blank only; a split over the count is its own verdict, blocking a Player and warning a Judge", () => {
  const base = { capacity: { verdict: "ok" }, targets: [1, 2], rows: [{ row: bolt(), key: "bolt" }] };
  const keys = (extra) => castVerdicts({ ...base, ...extra }).map((v) => v.key);
  assert.deepEqual(keys({ instances: { counts: { bolt: 3 }, assigned: { bolt: 3 } } }), [], "a count of three is split among the targets");
  assert.deepEqual(keys({ instances: { counts: { bolt: 1 }, assigned: { bolt: 1 } } }), [VERDICT.severalTargets]);
  assert.deepEqual(keys({ instances: { counts: { bolt: null }, assigned: { bolt: 0 } } }), [VERDICT.severalTargets], "a blank count");
  assert.deepEqual(keys({}), [VERDICT.severalTargets], "no count given: as before");
  assert.deepEqual(keys({ targets: [1] }), [], "one target is never several");
  const over = castVerdicts({ ...base, instances: { counts: { bolt: 3 }, assigned: { bolt: 5 } } });
  assert.deepEqual(over.map((v) => [v.key, v.severity, v.max, v.over]), [[VERDICT.tooManyInstances, "block", 3, 2]]);
  assert.equal(blocked(over), true);
  const judged = castVerdicts({ ...base, isGM: true, instances: { counts: { bolt: 3 }, assigned: { bolt: 5 } } });
  assert.deepEqual(judged.map((v) => [v.key, v.severity]), [[VERDICT.tooManyInstances, "warn"]]);
  assert.equal(blocked(judged), false);
  assert.deepEqual(castVerdicts({ ...base, instances: { counts: { bolt: 3 }, assigned: { bolt: 2 } } }).map((v) => v.key), [], "fewer throws than the count is no verdict");
});

/* ------------------------------------------------------------------ */
/*  The seat's targets around a throw                                  */
/* ------------------------------------------------------------------ */

await ta("a throw sees exactly its one token targeted, and the seat's own targets return afterwards, even when the throw throws", async () => {
  const sets = [];
  const env = (viewed = true) => ({ viewed: () => viewed, current: () => ["x", "y"], set: (ids) => sets.push([...ids]) });
  const token = { id: "tk" };
  let seen = null;
  const done = await withOnlyTarget(token, async () => (seen = sets.length), env());
  assert.deepEqual(done, { ok: true, value: 1 });
  assert.equal(seen, 1, "the target was set before the throw ran");
  assert.deepEqual(sets, [["tk"], ["x", "y"]]);
  sets.length = 0;
  await assert.rejects(withOnlyTarget(token, async () => { throw new Error("the throw failed"); }, env()), /the throw failed/);
  assert.deepEqual(sets, [["tk"], ["x", "y"]], "restored in finally");
  sets.length = 0;
  let ran = false;
  const off = await withOnlyTarget(token, async () => (ran = true), env(false));
  assert.deepEqual(off, { ok: false, reason: "offScene" });
  assert.equal(ran, false, "a token off the viewed scene is never thrown at");
  assert.deepEqual(sets, [], "and the seat's targets are not touched");
});

/* ------------------------------------------------------------------ */
/*  Throwing instances                                                 */
/* ------------------------------------------------------------------ */

const hit = (damage, { critical = false, total = 15 } = {}) => ({ attackRoll: { total }, resolution: { targetValue: 10, isHit: true, isCritical: critical }, damageRoll: { formula: "2d6", result: "3 + 4" }, damageTotal: damage });
const miss = () => ({ attackRoll: { total: 4 }, resolution: { targetValue: 10, isHit: false, isCritical: false } });

await ta("instances are thrown in turn, each one's figures kept, and a throw that does not resolve leaves it and the rest waiting", async () => {
  const waiting = [{ state: "throw" }, { state: "throw" }, { state: "throw" }];
  const order = [];
  const outcomes = [hit(5, { critical: true }), miss(), hit(6)];
  const all = await throwInstances(waiting, async (i) => (order.push(i), outcomes[i]));
  assert.deepEqual(order, [0, 1, 2], "in order, one at a time");
  assert.deepEqual(all.instances.map((i) => i.state), ["pending", "missed", "pending"]);
  assert.deepEqual(all.instances[0], { state: "pending", rolled: 5, critical: true, throw: { total: 15, target: 10, hit: true, critical: true } });
  assert.equal(all.stopped, null);
  assert.equal(instancesState(all.instances), "pending");
  assert.deepEqual(all.damage, { formula: "2d6", total: 5, detail: "3 + 4" }, "the first hit's roll");
  const cancelled = await throwInstances(waiting, async (i) => (i === 1 ? null : hit(4)));
  assert.deepEqual(cancelled.instances.map((i) => i.state), ["pending", "throw", "throw"]);
  assert.equal(cancelled.stopped, "cancelled");
  assert.equal(instancesState(cancelled.instances), "throw", "an entry waits while any instance waits");
  const off = await throwInstances(waiting, async () => OFF_SCENE);
  assert.equal(off.stopped, "offScene");
  assert.equal(off.instances.every((i) => i.state === "throw"), true);
  const resumed = await throwInstances(cancelled.instances, async () => miss());
  assert.deepEqual(resumed.instances.map((i) => i.state), ["pending", "missed", "missed"], "a press throws only the ones still waiting");
  assert.equal(instancesState([{ state: "missed" }, { state: "missed" }]), "missed");
});

t("an entry's request carries its hits only, and an entry with no instances asks as it always did", () => {
  const entry = { state: "pending", instances: [{ state: "missed" }, { state: "pending", rolled: 5, critical: true }, { state: "pending", rolled: 3 }] };
  assert.deepEqual(requestOf("bolt", entry, { rows: {} }), { rowKey: "bolt", instances: [{ rolled: 5, critical: true }, { rolled: 3, critical: false }] });
  assert.deepEqual(requestOf("bolt", { state: "pending", rolled: 4, critical: true }, { rows: {} }), { rowKey: "bolt", rolled: 4, critical: true });
  assert.deepEqual(requestOf("mend", { state: "pending" }, { rows: { mend: { total: 6 } } }), { rowKey: "mend", rolled: 6, critical: false });
  const card = { entries: { t1_bolt: entry, t1_mend: { state: "pending" }, t1_done: { state: "applied" }, t2_bolt: entry }, rows: { mend: { total: 6 } } };
  assert.deepEqual(pendingRequests(card, "t1").map((r) => r.rowKey), ["bolt", "mend"]);
});

/* ------------------------------------------------------------------ */
/*  The relay                                                          */
/* ------------------------------------------------------------------ */

const heldEntry = { state: "pending", instances: [{ state: "pending", rolled: 5, critical: false }, { state: "pending", rolled: 6, critical: false }, { state: "missed" }] };
const relayCard = (over = {}) => ({
  castId: "cast1",
  casterLevel: { value: 2, source: "class" },
  save: { category: "", effect: "" },
  targets: { t1: { uuid: "Scene.s.Token.k1", name: "Target", resist: null }, t2: { uuid: "Scene.s.Token.k2", name: "Other", resist: null } },
  rows: { bolt: { type: "damage", key: "bolt", delivery: "missile" } },
  allocation: { bolt: { t1: 3, t2: 0 } },
  entries: { t1_bolt: heldEntry },
  ...over,
});
const relayWorld = (row = bolt({ value: perLevel(1, 1) }), over = {}) => ({
  message: { authorId: "p1" },
  card: relayCard(),
  ownsCaster: true,
  spellOfCaster: true,
  rows: [{ row, key: "bolt" }],
  resist: null,
  boundsOf: (keyed, critical) => (critical ? { min: 1, max: 24 } : { min: 1, max: 12 }),
  ...over,
});
const ask = (instances) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: null, entries: [{ rowKey: "bolt", instances }] });

t("the relay recomputes the count and refuses a split over it, more hits than the entry holds, and a hit out of bounds", () => {
  // The count is two: a per-level figure at the card's caster level two.
  const pair = relayCard({ allocation: { bolt: { t1: 1, t2: 1 } }, entries: { t1_bolt: { state: "pending", instances: [{ state: "pending", rolled: 5 }, { state: "pending", rolled: 6 }] } } });
  assert.deepEqual(checkApplyRequest(ask([{ rolled: 5 }, { rolled: 6 }]), relayWorld(undefined, { card: pair })), { ok: true });
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }]), relayWorld(undefined, { card: pair })).ok, true, "fewer hits than the entry holds is a request for some");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }, { rolled: 6 }]), relayWorld()).refused, "tooManyInstances", "the card's split is three, the count two");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }, { rolled: 6 }, { rolled: 4 }]), relayWorld(undefined, { card: pair })).refused, "tooManyInstances", "three hits where the entry holds two");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }, { rolled: 13 }]), relayWorld(undefined, { card: pair })).refused, "badAmount", "13 is out of the one roll's bounds");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }, { rolled: 20, critical: true }]), relayWorld(undefined, { card: pair })).ok, true, "a critical hit is checked against its doubled bounds");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }, { rolled: "x" }]), relayWorld(undefined, { card: pair })).refused, "badAmount");
  assert.equal(checkApplyRequest(ask([]), relayWorld(undefined, { card: pair })).refused, "badAmount", "no hits is no request");
  assert.equal(checkApplyRequest({ ...ask([]), entries: [{ rowKey: "bolt", rolled: 5 }] }, relayWorld(undefined, { card: pair })).refused, "badAmount", "a single figure for an entry that holds instances");
  assert.equal(checkApplyRequest(ask([{ rolled: 5 }]), relayWorld(bolt({ value: flat(2), unread: ["max"] }), { card: pair })).refused, "badRow", "a count the import left blank makes no throws");
  const legacy = relayCard({ allocation: undefined, entries: { t1_bolt: { state: "pending", rolled: 5, throw: { total: 15, target: 10 } } } });
  assert.equal(checkApplyRequest({ ...ask([]), entries: [{ rowKey: "bolt", rolled: 5 }] }, relayWorld(bolt(), { card: legacy })).ok, true, "a card from before instances applies as it did");
});

/* ------------------------------------------------------------------ */
/*  Applying instances                                                 */
/* ------------------------------------------------------------------ */

const importResistance = () => Tables.registerTable({ id: DEFENSES_DOC, source: { pages: "ZZ p. 4" }, tables: { [RESISTANCE_TABLE]: { fraction: 0.7, saveBonus: 6 } } }, { priority: Tables.PRIORITY.WORLD });
const forgetResistance = () => Tables.unregisterTable(DEFENSES_DOC);
const band = (b = {}) => ({ damage: [], effects: [], conditions: [], mundane: false, extraordinary: false, silverFlaw: false, note: "", ...b });
const defended = (name, { immune, resist, weak } = {}) => ({
  name,
  id: "a1",
  type: "monster",
  system: { saves: { spell: { value: 14 } } },
  effects: [],
  getFlag: (s, k) => (s === "acks-extras" && k === "extras" ? { defenses: { immunities: band(immune), resistances: band(resist), susceptibilities: band(weak) } } : undefined),
});
const strikeCard = (instances) => relayCard({ allocation: { bolt: { t1: instances.length } }, entries: { t1_bolt: { state: "pending", instances } } });
async function strike(actor, instances, request) {
  const log = { hp: [], entries: {} };
  const hpTarget = { key: "Scene.s.Token.k1", hp: { value: 30, max: 30 } };
  const card = strikeCard(instances);
  const done = await applyOnTarget(card, "t1", request ?? [requestOf("bolt", card.entries.t1_bolt, card)], {
    messageId: "m1",
    rows: [{ key: "bolt", row: bolt() }],
    resolve: async () => ({ actor, hpTarget }),
    adjustHp: async (entries, { mode }) => {
      log.hp.push({ mode, amount: entries[0].amount });
      return [{ ok: true, before: 30, after: 30 - entries[0].amount }];
    },
    lose: async () => [],
    createRecords: async () => [],
    writeEntry: async (id, entry) => {
      log.entries[id] = entry;
    },
    now: () => 1,
    by: "u1",
  });
  return { entry: log.entries.t1_bolt, hp: log.hp, done };
}
const THREE = [{ state: "pending", rolled: 5, critical: false, throw: { hit: true } }, { state: "missed", throw: { hit: false } }, { state: "pending", rolled: 5, critical: false, throw: { hit: true } }];

await ta("each hit rounds and meets the target's defenses alone, the amounts are summed, and one hit-point write carries them", async () => {
  importResistance();
  try {
    const { entry, hp } = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), THREE);
    // 5 times 0.7 is 3.5, to the even 4, for each hit: 8. Summed first, 10 times 0.7 is 7.
    assert.deepEqual(entry.instances.map((i) => [i.state, i.applied]), [["applied", 4], ["missed", undefined], ["applied", 4]]);
    assert.equal(entry.applied, 8);
    assert.equal(entry.state, "applied");
    assert.deepEqual(hp, [{ mode: "damage", amount: 8 }], "one adjustHp for the entry");
    assert.deepEqual(entry.instances[0].steps.map((s) => s.key), ["defense", "round"], "each hit's own steps");
    assert.deepEqual([entry.before, entry.after], [30, 22]);
    const restored = [];
    const undone = await undoEntry(entry, { uuid: "Scene.s.Token.k1" }, { resolve: async () => ({ actor: {}, hpTarget: { key: "k" } }), restoreHp: async (r) => restored.push(...r), deleteRecords: async () => {} });
    assert.equal(undone.state, "undone");
    assert.deepEqual(restored.map((r) => [r.before, r.after]), [[30, 22]], "one Undo restores the whole entry");
  } finally {
    forgetResistance();
  }
});

await ta("an immune target takes nothing from any hit and writes nothing; an unpriced defense makes the whole entry the Judge's", async () => {
  const immune = await strike(defended("Quillback", { immune: { damage: ["fire"] } }), THREE);
  assert.equal(immune.entry.applied, 0);
  assert.deepEqual(immune.hp, []);
  forgetResistance();
  const judged = await strike(defended("Quillback", { resist: { damage: ["fire"] } }), THREE);
  assert.equal(judged.entry.state, "judge");
  assert.deepEqual(judged.hp, [], "nothing is written for the entry the Judge applies");
  assert.equal(judged.entry.applied, undefined);
  assert.deepEqual(judged.entry.instances.map((i) => i.state), ["judge", "missed", "judge"]);
  assert.equal(judged.entry.defense.band, "judge");
});

await ta("a request's hits, not the entry's stored figures, are what applies; an entry with no instances still applies a single figure", async () => {
  const plain = await strike(defended("Quillback"), THREE, [{ rowKey: "bolt", instances: [{ rolled: 2 }, { rolled: 3 }] }]);
  assert.equal(plain.entry.applied, 5);
  assert.deepEqual(plain.entry.instances.map((i) => i.rolled ?? null), [2, null, 3]);
  const legacy = relayCard({ entries: { t1_bolt: { state: "pending", throw: { total: 15, target: 10 } } } });
  const log = { hp: [] };
  await applyOnTarget(legacy, "t1", [{ rowKey: "bolt", rolled: 6 }], {
    messageId: "m1",
    rows: [{ key: "bolt", row: bolt() }],
    resolve: async () => ({ actor: defended("Quillback"), hpTarget: { key: "k", hp: { value: 30, max: 30 } } }),
    adjustHp: async (entries) => (log.hp.push(entries[0].amount), [{ ok: true, before: 30, after: 24 }]),
    lose: async () => [],
    createRecords: async () => [],
    writeEntry: async (id, entry) => (log.entry = entry),
    now: () => 1,
  });
  assert.deepEqual(log.hp, [6]);
  assert.equal(log.entry.instances, undefined);
});

/* ------------------------------------------------------------------ */
/*  The card                                                           */
/* ------------------------------------------------------------------ */

t("the card says how many throws hit, tells each in the tooltip, and names a count's parts on the row; a blank count has no Throw press", () => {
  const loc = (key, data) => `${key}|${JSON.stringify(data)}`;
  const count = instanceCount({ value: perLevel(1, 1), max: flat(4) }, 3);
  const applied = { state: "applied", applied: 8, fraction: 1, instances: [{ state: "applied", rolled: 5, applied: 4, steps: [], throw: { total: 15, target: 10, hit: true } }, { state: "missed", throw: { total: 4, target: 10, hit: false } }, { state: "applied", rolled: 5, applied: 4, steps: [], throw: { total: 16, target: 10, hit: true } }] };
  const card = { ...relayCard({ rows: { bolt: { type: "damage", key: "bolt", delivery: "missile", total: null, count, types: [] } }, entries: { t1_bolt: applied } }), order: ["bolt"], cite: "p. 1", spellName: "Testbolt" };
  const view = castCardView(card, { isGM: true, canPress: true }, loc);
  const [line] = view.sections[0].rows;
  assert.match(line.detail, /detail\.instances\|\{"hits":2,"count":3\}/);
  assert.match(line.tooltipText, /detail\.throw\|\{"total":4,"target":10\}/);
  assert.match(line.tooltipText, /tip\.appliedTotal\|\{"applied":8\}/);
  assert.match(view.sections[0].titleTooltip, /tip\.instances\|.*"count":3/);
  const waiting = castCardView({ ...card, entries: { t1_bolt: { state: "throw", instances: [{ state: "throw" }] } } }, { isGM: false, canPress: true, ownsCaster: true }, loc);
  assert.deepEqual(waiting.sections[0].rows[0].actions.map((a) => a.action), ["magicCastThrow"]);
  const blank = castCardView({ ...card, targets: {}, entries: {}, rows: { bolt: { type: "damage", key: "bolt", delivery: "missile", total: null, blank: true, count: instanceCount({ unread: ["value"] }, 3), types: [] } } }, { isGM: false, canPress: true }, loc);
  assert.deepEqual(blank.sections[0].rows[0].actions, [], "no count, no throw to press");
  assert.equal(blank.sections[0].titleTooltip, "tip.cite|{\"cite\":\"p. 1\"}", "the page reference alone");
});

/* ------------------------------------------------------------------ */
/*  The cast                                                           */
/* ------------------------------------------------------------------ */

const spell = (rows, extra = {}) => ({
  type: "spell",
  name: "Testbolt",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, cite: "p. 1", ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) },
});
const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const folk = (n) => Array.from({ length: n }, (_, i) => ({ uuid: `Scene.s.Token.k${i + 1}`, name: `Folk ${i + 1}`, id: `k${i + 1}`, actor: { name: `Folk ${i + 1}` } }));

function runDeps({ answer, tokens = folk(2), isGM = false, outcomes = [], level = { matched: true, classLevel: 3 } } = {}) {
  const calls = { notices: [], posts: [], spends: 0, applied: [], throws: [] };
  let thrown = 0;
  return {
    calls,
    deps: {
      lookups: NO_TWIN,
      read: async () => ({ actor: {}, tokens, casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level }),
      ask: async () => answer,
      notify: (lvl, key) => calls.notices.push([lvl, key]),
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => (calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
      apply: async (...args) => (calls.applied.push(args), { ok: true }),
      record: async () => {},
      throwRow: async (caster, carrier, skip, token) => {
        calls.throws.push(token?.uuid ?? null);
        const outcome = outcomes[thrown++];
        return outcome === undefined ? miss() : outcome;
      },
      now: () => 10,
      isGM: () => isGM,
    },
  };
}
const THREE_BOLTS = bolt({ value: flat(3) });

await ta("a throw row's count is split round-robin among the targets, each throw is made in turn at its own token, and each target's hits apply as one entry", async () => {
  const r = runDeps({ answer: { mode: "normal", picks: {} }, outcomes: [hit(5), miss(), hit(6)] });
  const out = await castSpellRun(spell([THREE_BOLTS]), () => {}, r.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.throws, ["Scene.s.Token.k1", "Scene.s.Token.k1", "Scene.s.Token.k2"], "two at the first token, then one at the second");
  const card = r.calls.posts[0];
  const [first, second] = Object.keys(card.targets);
  assert.deepEqual(card.allocation, { bolt: { [first]: 2, [second]: 1 } });
  assert.deepEqual(card.entries[`${first}_bolt`].instances.map((i) => i.state), ["pending", "missed"]);
  assert.deepEqual(card.entries[`${second}_bolt`].instances.map((i) => i.state), ["pending"]);
  assert.equal(card.entries[`${first}_bolt`].state, "pending");
  assert.equal(card.rows.bolt.count.value, 3);
  assert.deepEqual(card.rows.bolt.count.parts, [{ key: "figure", value: 3 }]);
  assert.deepEqual(card.rows.bolt.formula, "2d6", "the row shows the formula of one throw; there is no single total");
  assert.equal(card.rows.bolt.total, null);
  assert.deepEqual(r.calls.applied.map(([, key, requests]) => [key, requests]), [[first, [{ rowKey: "bolt", instances: [{ rolled: 5, critical: false }] }]], [second, [{ rowKey: "bolt", instances: [{ rolled: 6, critical: false }] }]]]);
});

await ta("the seat's typed split is read by the token it was typed for; a split over the count blocks a Player before the spend and warns a Judge, who casts the split as typed", async () => {
  let r = runDeps({ answer: { mode: "normal", picks: {}, allocation: { bolt: { "Scene.s.Token.k1": "1", "Scene.s.Token.k2": "2" } } } });
  await castSpellRun(spell([THREE_BOLTS]), () => {}, r.deps);
  const card = r.calls.posts[0];
  const [first, second] = Object.keys(card.targets);
  assert.deepEqual(card.allocation.bolt, { [first]: 1, [second]: 2 });
  assert.deepEqual(r.calls.throws.length, 3);
  let spends = 0;
  r = runDeps({ answer: { mode: "normal", picks: {}, allocation: { bolt: { "Scene.s.Token.k1": "3", "Scene.s.Token.k2": "1" } } } });
  const refused = await castSpellRun(spell([THREE_BOLTS]), () => spends++, r.deps);
  assert.deepEqual([refused.ok, refused.reason], [false, VERDICT.tooManyInstances]);
  assert.equal(spends, 0, "refused before the spend");
  assert.deepEqual(r.calls.throws, []);
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {}, allocation: { bolt: { "Scene.s.Token.k1": "3", "Scene.s.Token.k2": "1" } } } });
  const warned = await castSpellRun(spell([THREE_BOLTS]), () => spends++, r.deps);
  assert.equal(warned.ok, true);
  assert.equal(spends, 1);
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.tooManyInstances"));
  assert.equal(r.calls.throws.length, 4, "the Judge's split of four is thrown as typed");
});

await ta("a declared cast restores its typed split at the turn: thrown as declared on the declared targets with no dialog, whatever the user's targets are", async () => {
  const [k1, k2, k3] = folk(3);
  const live = [k3];
  const r = runDeps({ answer: null, tokens: live });
  const read = r.deps.read;
  const turn = { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: "cb1" } };
  const pending = { spellUuid: "Actor.c1.Item.s1", mode: "normal", picks: {}, items: {}, visibility: "gm", combatId: "k1", round: 1, at: 3, targets: [k1.uuid, k2.uuid], allocation: { bolt: { [k1.uuid]: "1", [k2.uuid]: "2" } } };
  r.deps.read = async (s) => ({ ...(await read(s)), combat: turn, combatant: { id: "cb1", initiative: 9 }, declarations: [{ castId: "d1", role: "caster", pending }] });
  r.deps.declaredTargets = async (uuids) => ({ tokens: [k1, k2].filter((t) => uuids.includes(t.uuid)), gaps: {}, gone: [] });
  r.deps.retarget = (tokens) => live.splice(0, live.length, ...tokens);
  r.deps.endHeld = async () => {};
  r.deps.declare = { finish: async () => {} };
  const out = await castSpellRun(spell([THREE_BOLTS]), () => {}, r.deps);
  assert.equal(out.ok, true);
  const card = r.calls.posts[0];
  const [first, second] = Object.keys(card.targets);
  assert.deepEqual(card.allocation.bolt, { [first]: 1, [second]: 2 }, "the declared split, not the round-robin one");
  assert.deepEqual(r.calls.throws, [k1.uuid, k2.uuid, k2.uuid], "thrown at the declared tokens as split");
});

await ta("a count of one with several targets still blocks a Player and throws once at the first for a Judge; a blank count throws nothing and posts the page reference", async () => {
  let r = runDeps({ answer: { mode: "normal", picks: {} } });
  const refused = await castSpellRun(spell([bolt()]), () => {}, r.deps);
  assert.equal(refused.reason, VERDICT.severalTargets);
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {} } });
  await castSpellRun(spell([bolt()]), () => {}, r.deps);
  assert.deepEqual(r.calls.throws, ["Scene.s.Token.k1"]);
  made.length = 0;
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {} } });
  const blankBolt = bolt({ value: flat(3), unread: ["value"] });
  const blankMend = { key: "mend", type: "heal", roll: "1d6", value: flat(2), unread: ["value"] };
  await castSpellRun(spell([blankBolt, blankMend]), () => {}, r.deps);
  const card = r.calls.posts[0];
  assert.deepEqual(r.calls.throws, [], "nothing is thrown");
  assert.deepEqual(made, [], "nothing is rolled");
  assert.equal(card.rows.bolt.blank, true);
  assert.equal(card.rows.bolt.count.value, null);
  assert.equal(card.rows.mend.total, null);
  assert.equal(card.rows.mend.formula, "");
  assert.deepEqual(card.entries, {}, "no entry, no apply");
  assert.deepEqual(r.calls.applied, []);
});

await ta("a cancelled throw leaves its instance and those after it at Throw, and a token off the scene says so", async () => {
  let r = runDeps({ tokens: folk(1), answer: { mode: "normal", picks: {} }, outcomes: [hit(5), null] });
  await castSpellRun(spell([THREE_BOLTS]), () => {}, r.deps);
  const entry = Object.values(r.calls.posts[0].entries)[0];
  assert.equal(entry.state, "throw");
  assert.deepEqual(entry.instances.map((i) => i.state), ["pending", "throw", "throw"]);
  assert.deepEqual(r.calls.applied, [], "an entry that still waits is not applied");
  r = runDeps({ tokens: folk(1), answer: { mode: "normal", picks: {} } });
  r.deps.throwRow = async () => OFF_SCENE;
  await castSpellRun(spell([THREE_BOLTS]), () => {}, r.deps);
  assert.equal(Object.values(r.calls.posts[0].entries)[0].state, "throw");
  assert.ok(r.calls.notices.some(([, key]) => key === "offScene"));
});

await ta("a no-throw row rolls once for its count: the scaled formula, here and in the relay's bounds; a count needing a level none gave is blank", async () => {
  made.length = 0;
  const mend = { key: "mend", type: "heal", roll: "1d6", value: perLevel(1, 1), max: flat(4) };
  let r = runDeps({ tokens: [], answer: { mode: "normal", picks: {} }, level: { matched: true, classLevel: 3 } });
  await castSpellRun(spell([mend]), () => {}, r.deps);
  assert.deepEqual(made, ["3d6"], "one roll of the count's dice");
  assert.equal(r.calls.posts[0].rows.mend.count.value, 3);
  const caster = { getRollData: () => ({}) };
  assert.equal((await rowSpecOf(caster, {}, { casterLevel: { value: 9 } }, { row: mend, key: "mend" })).formula, "4d6", "the relay's spec holds the cap");
  assert.equal(await rowSpecOf(caster, {}, { casterLevel: { value: null } }, { row: mend, key: "mend" }), null, "no level, no roll");
  const fire = { key: "burn", type: "damage", roll: "1d4", damage: ["fire"], value: flat(2) };
  assert.equal((await rowSpecOf(caster, {}, { casterLevel: { value: 3 } }, { row: fire, key: "burn" })).formula, "2d4", "a damage row's roll is scaled too");
  assert.equal((await rowSpecOf(caster, {}, { casterLevel: { value: 3 } }, { row: { ...fire, delivery: "missile" }, key: "burn" })).formula, "1d4", "a thrown row's spec is that of one throw");
});

/* ------------------------------------------------------------------ */
/*  The dialog                                                         */
/* ------------------------------------------------------------------ */

t("the dialog offers a split for a thrown row of more than one throw among several targets, defaulting to round-robin, with the verdict worded for the seat", () => {
  const item = { key: "bolt", row: THREE_BOLTS, count: instanceCount(THREE_BOLTS, 3), pick: "", option: "bolt", split: allocate(3, ["Scene.s.Token.k1", "Scene.s.Token.k2"]) };
  const ctx = { modes: ["normal"], targets: [{ uuid: "Scene.s.Token.k1", name: "Folk 1" }, { uuid: "Scene.s.Token.k2", name: "Folk 2" }], instances: { normal: [item] }, caster: { name: "Caster" }, cite: "p. 1", isGM: false, verdicts: { normal: [] } };
  const out = dialogContext(ctx, {});
  assert.deepEqual(out.bucket.rows.map((r) => r.splits.map((s) => [r.uuid, s.key, s.value])), [[["Scene.s.Token.k1", "bolt", 2]], [["Scene.s.Token.k2", "bolt", 1]]], "one figure per target, by uuid, defaulting to round-robin");
  assert.match(out.bucket.rows[0].splits[0].tip, /tip\.instances\|/);
  const typed = dialogContext(ctx, { allocation: { bolt: { "Scene.s.Token.k1": "0", "Scene.s.Token.k2": "3" } } });
  assert.deepEqual(typed.bucket.rows.map((r) => r.splits[0].value), ["0", "3"], "what the seat typed stands through a re-render");
  const over = { key: "tooManyInstances", severity: "block", max: 3, over: 1 };
  assert.match(dialogContext({ ...ctx, verdictsAt: () => [over] }, {}).footer.verdicts[0].text, /notice\.blocked\.tooManyInstances/);
  assert.equal(dialogContext({ ...ctx, verdictsAt: () => [over] }, {}).footer.blocked, true, "a split over the count blocks a Player");
  assert.deepEqual(dialogContext({ ...ctx, instances: {} }, {}).bucket.rows.map((r) => r.splits), [[], []]);
  const picked = { ...item, pick: "form", option: "bolt" };
  assert.deepEqual(dialogContext({ ...ctx, instances: { normal: [picked] } }, { picks: { form: "other" } }).bucket.rows.map((r) => r.splits), [[], []], "a split of an option not chosen is not shown");
});

console.log(`\n${n} cast instance tests passed`);
