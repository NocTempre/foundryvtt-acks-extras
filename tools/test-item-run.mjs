/**
 * The item runner (`item-run-logic.mjs`, `item-run.mjs`), offline: what an item
 * carries and which row list its kind has, the records the carrier writes (their
 * flags, clocks and the one fixed standing-part id), a relayed press checked
 * against the item's own row, Undo by a row's own ids, the prompt card's model,
 * and the fuse: its record, its stepping from the turn hooks (deleted before the
 * burst), its move to the world clock when the fight ends, and its due reading.
 * Foundry-free with stand-ins; every name and figure below is invented.
 *
 * Usage: node tools/test-item-run.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = { utils: { randomID: () => "rid" }, data: { operators: { ForcedDeletion } } };
const gameStub = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true }, time: { worldTime: 0 } };
globalThis.game = gameStub;
const notes = [];
globalThis.ui = { notifications: { warn: (text) => notes.push(["warn", text]), error: (text) => notes.push(["error", text]) } };

const logic = await import("../scripts/lib/item-run-logic.mjs");
const run = await import("../scripts/lib/item-run.mjs");
const { conditionEffectId } = await import("../scripts/lib/status-effects.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const gear = (flag, type = "item") => ({ type, flags: { "acks-extras": flag } });

await t("an item's run reads only with a known activation, and its one row list is its kind's", () => {
  assert.equal(logic.readItemRun(undefined), null);
  assert.equal(logic.readItemRun({ rows: [{}] }), null, "rows alone are no activation");
  assert.equal(logic.readItemRun({ activation: { kind: "nonsense" } }), null);
  const read = logic.readItemRun({ activation: { kind: "toggle", state: { active: true, activationId: "a", regionId: "r" }, fuseDice: { doc: "d" } }, rows: [{ key: "k" }] });
  assert.deepEqual(read.activation.state, { active: true, activationId: "a", regionId: "r" });
  assert.deepEqual(read.activation.fuseDice, { doc: "d" });
  assert.equal(read.activation.throw, null);
  assert.deepEqual(logic.readItemRun({ activation: { kind: "once" } }).activation.state, { active: false, activationId: "", regionId: "" });
  assert.deepEqual(logic.itemRunRowsOf(gear({ itemRun: { activation: { kind: "once" }, rows: [{ key: "g" }] } })), [{ key: "g" }]);
  assert.deepEqual(logic.itemRunRowsOf(gear({ extras: { effects: [{ key: "a" }] }, itemRun: { rows: [{ key: "ignored" }] } }, "ability")), [{ key: "a" }], "an ability keeps its rows where they are");
  assert.deepEqual(logic.itemRunRowsOf(gear({})), []);
  assert.deepEqual(logic.itemRunRowsOf(null), []);
  assert.equal(logic.itemRunOf(gear({ itemRun: { activation: { kind: "once" } } }, "spell")), null, "a spell carries no run");
});

await t("the claim: a kind with a runner on an item that is no spell", () => {
  const once = gear({ itemRun: { activation: { kind: "once" } } });
  assert.equal(logic.claimsItemUse(once, ["once"]), true);
  assert.equal(logic.claimsItemUse(once, ["toggle"]), false);
  assert.equal(logic.claimsItemUse(once, []), false);
  assert.equal(logic.claimsItemUse(gear({ itemRun: { activation: { kind: "once" } } }, "spell"), ["once"]), false);
  assert.equal(logic.claimsItemUse(gear({}, "ability"), ["once"]), false);
  assert.equal(logic.claimsItemUse(null, ["once"]), false);
});

const ids = { source: "I.1", activationId: "act", rowKey: "k" };

await t("every record carries its source, activation, row and the managed mark", () => {
  const status = { name: "Held", statuses: ["held"], flags: { "acks-extras": { keep: 1 } } };
  const life = { turnLife: { combatId: "c", combatantId: "m", edge: "start", count: 1 } };
  const cond = logic.conditionRecordData({ statusData: status, ...ids, life });
  assert.deepEqual(cond.flags["acks-extras"].itemRun, { source: "I.1", activationId: "act", rowKey: "k" });
  assert.equal(cond.flags["acks-extras"].managed, true);
  assert.equal(cond.flags["acks-extras"].keep, 1, "a flag the status data held stays");
  assert.deepEqual(cond.flags["acks-extras"].turnLife, life.turnLife);
  assert.equal(cond.origin, "I.1");
  assert.deepEqual(cond.statuses, ["held"]);
  assert.deepEqual(logic.conditionRecordData({ statusData: status, ...ids, life: { duration: { rounds: 3 } } }).duration, { rounds: 3 });
  assert.equal(logic.conditionRecordData({ statusData: status, ...ids }).flags["acks-extras"].turnLife, undefined, "no clock until the Region goes");
  const window = logic.immunityRecordData({ name: "Pass", spellKey: "kind-1", duration: { seconds: 60 }, ...ids });
  assert.deepEqual(window.flags["acks-extras"].rollMods.parts, [{ on: "immune", spells: ["kind-1"] }]);
  assert.equal(window.statuses, undefined, "an immunity window carries no status");
  assert.equal(window.flags["acks-extras"].managed, true);
  const action = logic.actionPartRecordData({ name: "Edge", parts: [{ on: "damage", value: 1 }], ...ids });
  assert.deepEqual(action.flags["acks-extras"].endsOn, ["attack"]);
  assert.deepEqual(action.flags["acks-extras"].rollMods.parts, [{ on: "damage", value: 1 }]);
});

await t("a standing part lives under one fixed id per item kind, whoever the bearer", () => {
  const a = logic.standingPartRecordData({ kindKey: "kind-1", name: "N", parts: [], ...ids });
  const b = logic.standingPartRecordData({ kindKey: "kind-1", name: "N", parts: [], source: "I.2", activationId: "other", rowKey: "k" });
  const c = logic.standingPartRecordData({ kindKey: "kind-2", name: "N", parts: [], ...ids });
  assert.equal(a._id, conditionEffectId("itemRun:kind-1"));
  assert.equal(a._id, b._id, "parts from several bearers never stack");
  assert.notEqual(a._id, c._id);
  assert.equal(a._id, logic.standingPartId("kind-1"));
});

await t("an activation's records are found by its id alone", () => {
  const eff = (id, activationId) => ({ id, flags: { "acks-extras": activationId ? { itemRun: { activationId } } : {} } });
  assert.deepEqual(logic.activationRecordIds([eff("a", "x"), eff("b", "y"), eff("c"), eff("d", "x")], "x"), ["a", "d"]);
  assert.deepEqual(logic.activationRecordIds([eff("a", "x")], ""), []);
});

await t("a relayed press is checked against the item's own row, live, before it is written", () => {
  const world = { item: {}, row: {}, subjectOwnerIds: ["u1"], target: 10 };
  const ask = (req, over = {}) => logic.checkPressRequest({ total: 12, target: 10, ...req }, { ...world, ...over });
  assert.deepEqual(ask({}), { ok: true, total: 12, target: 10, saved: true });
  assert.equal(ask({ total: 10 }).saved, true, "meeting the target saves");
  assert.equal(ask({ total: 9 }).saved, false);
  assert.equal(ask({ target: 5, total: 20 }).reason, "figure", "a target the item's row does not give is refused");
  assert.equal(ask({}, { item: null }).reason, "gone");
  assert.equal(ask({}, { row: null }).reason, "noRow");
  assert.equal(ask({ requestUserId: "u2" }).reason, "notOwner");
  assert.equal(ask({ requestUserId: "u1" }).ok, true);
  assert.equal(ask({}, { entryState: "applied" }).reason, "applied");
  assert.equal(ask({}, { entryState: "open" }).ok, true);
  assert.equal(ask({}, { target: null }).reason, "noFigure", "a blank figure writes nothing");
  assert.equal(ask({ total: "x" }).reason, "noRoll");
});

await t("Undo removes only the ids its row stored that still exist, and only a Judge's seat does it", async () => {
  assert.deepEqual(logic.undoPlan({ recordIds: ["a", "b", "a"] }, ["b", "z"]), { ids: ["b"], gone: ["a"] });
  assert.deepEqual(logic.undoPlan({}, ["b"]), { ids: [], gone: [] });
  const deletes = [];
  const actor = { effects: [{ id: "a" }, { id: "b" }, { id: "other" }], deleteEmbeddedDocuments: async (...args) => deletes.push(args) };
  globalThis.fromUuidSync = () => ({ actor });
  const done = await run.undoEntry({ subject: "T.1", entry: { recordIds: ["a", "gone"] } });
  assert.deepEqual(done, { ok: true, removed: ["a"] });
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].slice(0, 2), ["ActiveEffect", ["a"]], "its own id, never the other record");
  assert.equal(deletes[0][2]["acks-extras"].managedDelete ?? Object.values(deletes[0][2]["acks-extras"])[0], true, "authorized as a managed delete");
  gameStub.user = { isGM: false };
  assert.deepEqual(await run.undoEntry({ subject: "T.1", entry: { recordIds: ["b"] } }), { ok: false, removed: [] });
  assert.equal(deletes.length, 1, "a Player's seat deletes nothing");
  gameStub.user = { isGM: true };
});

await t("the prompt card model offers Roll per admitted subject, an outcome and a GM-only Undo once rolled, and the ticks to a Judge", () => {
  const words = { roll: "R", undo: "U", undetermined: "?", tick: "T", saved: "S", failed: "F" };
  const model = (over = {}) => logic.promptCardModel({
    title: "Gear", subtitle: "Bearer", words, ids: { itemUuid: "I", rowKey: "k", activationId: "a" },
    subjects: [{ key: "s1", name: "One" }, { key: "s2", name: "Two" }], undetermined: [{ key: "u1", name: "Odd" }], ...over,
  });
  const open = model({ isGM: false });
  assert.equal(open.sections.length, 1, "a Player sees no undetermined section");
  assert.deepEqual(open.sections[0].rows[0].actions[0], { action: "itemRun.roll", label: "R", icon: "fa-solid fa-dice-d20", data: { itemUuid: "I", rowKey: "k", activationId: "a", subject: "s1" } });
  const judge = model({ isGM: true });
  assert.equal(judge.sections[1].rows[0].actions[0].action, "itemRun.tick");
  const rolled = model({ isGM: true, entries: { s1: { state: "applied", saved: false, total: 4, target: 9, recordIds: ["r1"] }, s2: { state: "applied", saved: true, total: 15, target: 9, recordIds: [] } } });
  const [one, two] = rolled.sections[0].rows;
  assert.equal(one.outcome, "F");
  assert.equal(one.emphasis, "failure");
  assert.equal(one.actions[0].action, "itemRun.undo");
  assert.equal(two.outcome, "S");
  assert.equal(two.actions, undefined, "nothing written, nothing to undo");
  const asPlayer = model({ isGM: false, entries: { s1: { state: "applied", saved: false, total: 4, target: 9, recordIds: ["r1"] } } });
  assert.equal(asPlayer.sections[0].rows[0].actions, undefined, "Undo is a Judge's");
});

/* --- the fuse --- */
const spot = { sceneId: "sc", x: 1, y: 2, elevation: 0, level: "L" };
const flag = (over = {}) => logic.fuseFlag({ source: "I.1", activationId: "act", spot, combatId: "c1", combatantId: "m1", count: 2, ...over });

await t("a fuse is a record on the bearer's clock that counts turns that began and bursts at the end of the one that reaches its count", () => {
  assert.deepEqual(flag().clock, { combatId: "c1", combatantId: "m1", edge: "end", count: 2, seen: 0 });
  const step = (raw, event) => logic.fuseStep(raw, { combatId: "c1", combatantId: "m1", ...event });
  const first = step(flag(), { kind: "began" });
  assert.equal(first.act, "count");
  assert.equal(first.seen, 1);
  assert.equal(step(flag(), { kind: "ended" }).act, "none", "a turn that began before the fuse was lit does not count");
  const lit = { ...flag(), clock: { ...flag().clock, seen: 1 } };
  assert.equal(step(lit, { kind: "ended" }).act, "none", "one turn of two is not enough");
  const due = { ...flag(), clock: { ...flag().clock, seen: 2 } };
  assert.equal(step(due, { kind: "ended" }).act, "burst");
  assert.equal(step(due, { kind: "began", combatantId: "other" }).act, "none", "another combatant's event");
  assert.equal(step({ ...due, dueAt: 100 }, { kind: "ended" }).act, "none", "a world-clock fuse is never stepped by a turn");
  assert.equal(logic.readFuse({ source: "I", activationId: "a" }), null, "a fuse with no spot is no fuse");
  assert.equal(logic.readFuse({ ...flag(), clock: { ...flag().clock, count: 0 } }), null);
});

/** An actor holding fuse effects, recording its deletes into a shared log. */
const log = [];
const holder = (raw, id = "e1") => {
  const effect = { id, uuid: `E.${id}`, flags: { "acks-extras": { fuse: raw } }, setFlag: async (scope, key, value) => log.push(["set", id, value.clock?.seen]), update: async (data) => log.push(["update", id, data]) };
  return { name: "Bearer", effects: [effect], deleteEmbeddedDocuments: async (kind, list) => log.push(["delete", ...list]) };
};
const combatOf = (actors) => ({ id: "c1", combatants: actors.map((actor, i) => ({ id: `m${i + 1}`, actor })) });

await t("a due fuse is deleted before its burst runs; one that is not due is counted; no burst registered steps nothing", async () => {
  log.length = 0;
  const raw = { ...flag(), clock: { ...flag().clock, seen: 2 } };
  const combat = combatOf([holder(raw)]);
  const burst = async ({ record }) => log.push(["burst", record.activationId]);
  assert.deepEqual(await run.liftFuses(combat, "m1", "ended", { burst: null }), []);
  assert.deepEqual(log, [], "with no burst the record is left alone");
  const done = await run.liftFuses(combat, "m1", "ended", { burst });
  assert.equal(done.length, 1);
  assert.deepEqual(log, [["delete", "e1"], ["burst", "act"]], "deleted first, then the burst");
  log.length = 0;
  await run.liftFuses(combatOf([holder(flag())]), "m1", "began", { burst });
  assert.deepEqual(log, [["set", "e1", 1]]);
  log.length = 0;
  const failing = holder(raw);
  failing.deleteEmbeddedDocuments = async () => { throw new Error("another client has it"); };
  const swallowed = console.error;
  console.error = () => {};
  await run.liftFuses(combatOf([failing]), "m1", "ended", { burst });
  console.error = swallowed;
  assert.deepEqual(log, [], "a client whose delete fails bursts nothing");
});

await t("a fight that ends moves its fuses to the world clock at the round's length; a due reading then bursts it", async () => {
  const raw = { ...flag(), clock: { ...flag().clock, seen: 1 } };
  assert.deepEqual(logic.fuseToWorld(raw, "c1", { now: 1000, roundSeconds: 6 }), { source: "I.1", activationId: "act", spot, dueAt: 1006 }, "one round left at six seconds");
  assert.equal(logic.fuseToWorld(raw, "other", { now: 1000, roundSeconds: 6 }), null, "another fight's fuse");
  assert.equal(logic.fuseToWorld({ ...raw, dueAt: 5 }, "c1", { now: 1000, roundSeconds: 6 }), null, "already on the world clock");
  assert.equal(logic.fuseToWorld({ ...raw, clock: { ...raw.clock, seen: 5 } }, "c1", { now: 1000, roundSeconds: 6.5 }).dueAt, 1000, "nothing left is due at once");
  assert.equal(logic.fuseToWorld(flag({ count: 3 }), "c1", { now: 10, roundSeconds: 2.5 }).dueAt, 18, "the figure rounds up");
  log.length = 0;
  const actor = holder(raw);
  const moved = await run.convertFuses({ id: "c1" }, [actor], { now: 1000, roundSeconds: 6 });
  assert.equal(moved.length, 1);
  const [, , data] = log[0];
  const written = data["flags.acks-extras.fuse"];
  assert.equal(written.dueAt, 1006);
  assert.ok(written.clock instanceof ForcedDeletion, "the combat clock is unset in the same write");
  const world = { ...moved[0] };
  assert.equal(logic.fuseDue(world, 1005), false);
  assert.equal(logic.fuseDue(world, 1006), true);
  log.length = 0;
  const burst = async ({ record }) => log.push(["burst", record.activationId]);
  assert.equal((await run.liftWorldFuses([holder(world)], 1005, { burst })).length, 0);
  assert.equal((await run.liftWorldFuses([holder(world)], 1006, { burst })).length, 1);
  assert.deepEqual(log, [["delete", "e1"], ["burst", "act"]]);
});

await t("a use is refused for a seat that does not own the item's actor and for a kind nobody runs; an owner's runs and is presented", async () => {
  const item = { uuid: "I.1", name: "Gear", type: "item", flags: { "acks-extras": { itemRun: { activation: { kind: "once" }, rows: [] } } }, actor: { testUserPermission: (user) => user.id === "owner", getActiveTokens: () => [{ uuid: "T.1" }] } };
  globalThis.fromUuidSync = () => item;
  gameStub.users = new Map([["owner", { id: "owner" }], ["other", { id: "other" }]]);
  const ran = [];
  const shown = [];
  run.registerActivationRunner("once", async (ctx) => (ran.push(ctx.judge), { ok: true, kind: "once" }));
  run.setUsePresenter(async (result) => shown.push(result.kind));
  try {
    notes.length = 0;
    assert.deepEqual(await run.runUse({ itemUuid: "I.1", requestUserId: "other" }), { ok: false, reason: "notOwner" });
    assert.deepEqual(ran, []);
    assert.equal(notes[0][0], "error", "a Player is blocked");
    assert.deepEqual(await run.runUse({ itemUuid: "I.1", requestUserId: "owner" }), { ok: true, kind: "once" });
    assert.deepEqual(ran, [false]);
    assert.deepEqual(shown, ["once"]);
    await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual(ran, [false, true], "a Judge's own press carries no request user");
    run.registerActivationRunner("once", null);
    notes.length = 0;
    assert.equal((await run.runUse({ itemUuid: "I.1" })).reason, "noRunner");
    assert.equal(notes[0][0], "warn", "a Judge is warned");
  } finally {
    run.registerActivationRunner("once", null);
    run.setUsePresenter(null);
  }
});

console.log(`\ntest-item-run: ${passed} checks passed.`);
