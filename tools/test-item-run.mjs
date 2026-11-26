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
  const timed = logic.conditionRecordData({ statusData: status, ...ids, life: { dueAt: 900 } });
  assert.equal(timed.flags["acks-extras"].itemRun.dueAt, 900, "a timed condition ends on the module's clock");
  assert.equal("duration" in timed, false, "no core duration is written");
  assert.equal(logic.conditionRecordData({ statusData: status, ...ids }).flags["acks-extras"].turnLife, undefined, "no clock until the Region goes");
  const window = logic.immunityRecordData({ name: "Pass", spellKey: "kind-1", dueAt: 60, ...ids });
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
  assert.deepEqual(ask({}), { ok: true, total: 12, target: 10, saved: true, early: false });
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
  assert.deepEqual(logic.undoPlan({ recordIds: ["a", "b", "a"] }, ["b", "z"]), { ids: ["b"], gone: ["a"], hp: [] });
  assert.deepEqual(logic.undoPlan({}, ["b"]), { ids: [], gone: [], hp: [] });
  const deletes = [];
  const actor = { effects: [{ id: "a" }, { id: "b" }, { id: "other" }], deleteEmbeddedDocuments: async (...args) => deletes.push(args) };
  globalThis.fromUuidSync = () => ({ actor });
  const done = await run.undoEntry({ subject: "T.1", entry: { recordIds: ["a", "gone"] } });
  assert.deepEqual(done, { ok: true, removed: ["a"] });
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].slice(0, 2), ["ActiveEffect", ["a"]], "its own id, never the other record");
  assert.equal(deletes[0][2]["acks-extras"].managedDelete ?? Object.values(deletes[0][2]["acks-extras"])[0], true, "authorized as a managed delete");
  assert.equal(logic.mayUndoEntry({ presser: "u1" }, "u1", []), true, "the seat that applied it");
  assert.equal(logic.mayUndoEntry({ presser: "u1" }, "u2", ["u2"]), true, "an owner of the subject's token");
  assert.equal(logic.mayUndoEntry({ presser: "u1" }, "u2", ["u3"]), false, "any other seat, whatever its role");
  assert.equal(logic.mayUndoEntry({}, "u2", []), false);
  assert.equal(logic.mayUndoEntry(null, "u1", ["u1"]), false);
  assert.equal(logic.mayUndoEntry({ presser: "u1" }, undefined, [undefined]), false, "no seat is no one");
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

/* --- the pure half, pinned where a clause could be dropped unseen --- */

await t("an item's run reads its figures only as references, its rows as a copy of a list, and its flags by either hand", () => {
  const read = logic.readItemRun({ activation: { kind: "fuse", throw: { doc: "d" }, fumble: { doc: "f" }, fuseDice: "1d4", uses: { value: "3" } }, rows: "none" });
  assert.deepEqual(read.activation.throw, { doc: "d" });
  assert.deepEqual(read.activation.fumble, { doc: "f" });
  assert.equal(read.activation.fuseDice, null, "a bare string is no reference");
  assert.deepEqual(read.activation.uses, { value: "3" });
  assert.deepEqual(read.rows, [], "rows that are no list are none");
  assert.equal(logic.readItemRun({ activation: { kind: "once", state: { active: "yes", activationId: 7, regionId: 8 } } }).activation.state.active, false, "only true is active");
  assert.deepEqual(logic.readItemRun({ activation: { kind: "once", state: { activationId: 7, regionId: 8 } } }).activation.state, { active: false, activationId: "7", regionId: "8" });
  const stored = [{ key: "a" }];
  const copy = logic.itemRunRowsOf(gear({ itemRun: { rows: stored } }));
  copy.push({ key: "extra" });
  assert.equal(stored.length, 1, "an item's rows are handed over as a copy");
  const abilityStored = [{ key: "b" }];
  const abilityCopy = logic.itemRunRowsOf(gear({ extras: { effects: abilityStored } }, "ability"));
  abilityCopy.push({ key: "extra" });
  assert.equal(abilityStored.length, 1, "so are an ability's");
  assert.deepEqual(logic.itemRunRowsOf(gear({ extras: { effects: "x" } }, "ability")), []);
  assert.deepEqual(logic.itemRunRowsOf(gear({ itemRun: { rows: "x" } })), []);
  const viaGetFlag = { type: "item", flags: {}, getFlag: (scope, key) => (key === "itemRun" ? { activation: { kind: "once" }, rows: [{ key: "g" }] } : undefined) };
  assert.equal(logic.itemRunOf(viaGetFlag).activation.kind, "once", "a document's own getFlag");
  assert.equal(logic.claimsItemUse(viaGetFlag, ["once"]), true);
});

await t("a consume activation reads its swigs left, its figure and its last bearer, and nothing else does", () => {
  const read = logic.readItemRun({ activation: { kind: "consume", uses: { doc: "d", row: "r" }, left: 3, bearerUuid: " Actor.a " } }).activation;
  assert.deepEqual(read.uses, { doc: "d", row: "r" });
  assert.equal(read.left, 3);
  assert.equal(read.bearerUuid, "Actor.a");
  const bare = logic.readItemRun({ activation: { kind: "consume" } }).activation;
  assert.equal(bare.left, null, "no count is uncounted");
  assert.equal(bare.bearerUuid, "");
  assert.equal(bare.uses, null);
  assert.equal(logic.readItemRun({ activation: { kind: "consume", left: 0 } }).activation.left, 0, "a spent count is 0, not null");
  assert.equal(logic.readItemRun({ activation: { kind: "consume", left: "4" } }).activation.left, 4, "a typed numeral reads as its number");
  assert.equal(logic.readItemRun({ activation: { kind: "consume", left: "" } }).activation.left, null, "a blank count is uncounted");
  assert.equal(logic.readItemRun({ activation: { kind: "consume", left: 1.5 } }).activation.left, null, "a fraction is no count");
  assert.equal(logic.readItemRun({ activation: { kind: "consume", left: "x" } }).activation.left, null);
  assert.equal(logic.readItemRun({ activation: { kind: "consume", bearerUuid: 7 } }).activation.bearerUuid, "", "a bearer that is no string is none");
  assert.equal("left" in logic.readItemRun({ activation: { kind: "once", left: 2 } }).activation, false, "another kind answers no count");
  assert.equal("leftFrom" in logic.readItemRun({ activation: { kind: "once", leftFrom: { by: "hand" } } }).activation, false, "nor where it came from");
});

await t("a consume activation reads where its count came from: a roll with its formula and whole total, a hand, or none", () => {
  const from = (leftFrom) => logic.readItemRun({ activation: { kind: "consume", left: 3, leftFrom } }).activation.leftFrom;
  assert.deepEqual(from({ by: "roll", formula: " 1d6 ", total: 3 }), { by: "roll", formula: "1d6", total: 3 });
  assert.deepEqual(from({ by: "roll", formula: "1d6", total: "4" }), { by: "roll", formula: "1d6", total: 4 }, "a typed numeral reads as its number");
  assert.deepEqual(from({ by: "hand", total: 9, formula: "x" }), { by: "hand" }, "a hand carries nothing else");
  assert.equal(from(undefined), null, "none stored");
  assert.equal(from(null), null);
  assert.equal(from({ by: "roll", formula: "", total: 3 }), null, "a roll with no formula");
  assert.equal(from({ by: "roll", formula: "1d6" }), null, "a roll with no total");
  assert.equal(from({ by: "roll", formula: "1d6", total: 1.5 }), null, "a fraction is no total");
  assert.equal(from({ by: "roll", formula: 6, total: 3 }), null, "a formula that is no string");
  assert.equal(from({ by: "magic" }), null);
  assert.equal(from("hand"), null);
});

await t("litCountOf counts the fuse records an item lit on an actor, on either clock, and no other item's", () => {
  const rec = (source, extra) => ({ flags: { "acks-extras": { fuse: { source, activationId: `a${Math.random()}`, spot: {}, ...extra } } } });
  const effects = [rec("I.1", { dueAt: 10 }), rec("I.1", { clock: { combatId: "c", combatantId: "k", count: 3, seen: 0 } }), rec("I.2", { dueAt: 5 }), { flags: {} }, { flags: { "acks-extras": { fuse: { source: "I.1" } } } }];
  assert.equal(logic.litCountOf(effects, "I.1"), 2, "a record that reads as no fuse is not counted");
  assert.equal(logic.litCountOf(effects, "I.2"), 1);
  assert.equal(logic.litCountOf(effects, "I.3"), 0);
  assert.equal(logic.litCountOf(null, "I.1"), 0);
  assert.equal(logic.litCountOf(undefined, "I.1"), 0);
});

await t("a consume item is used up when its own count is 0 or below, whatever its quantity, and a null count never spends", () => {
  const consume = (left, system) => ({ type: "item", ...(system ? { system } : {}), flags: { "acks-extras": { itemRun: { activation: { kind: "consume", left } } } } });
  assert.equal(logic.itemRunUsedUp(consume(0)), true);
  assert.equal(logic.itemRunUsedUp(consume(-1)), true);
  assert.equal(logic.itemRunUsedUp(consume(2)), false);
  assert.equal(logic.itemRunUsedUp(consume(null)), false, "uncounted and no quantity is not used up");
  assert.equal(logic.itemRunUsedUp(consume(0, { quantity: 5 })), true, "a count spent to 0 outranks a full quantity");
  assert.equal(logic.itemRunUsedUp(consume(2, { quantity: 0 })), true, "the quantity rule stands");
  assert.equal(logic.itemRunUsedUp(consume(null, { quantity: 0 })), true);
  assert.equal(logic.itemRunUsedUp(consume(3, { quantity: 2 })), false);
  const once = { type: "item", flags: { "acks-extras": { itemRun: { activation: { kind: "once", left: 0 } } } } };
  assert.equal(logic.itemRunUsedUp(once), false, "only a consume item reads left");
});

await t("every record names its item, activation and row, and each kind carries what it is for", () => {
  const flagsOf = (rec) => rec.flags["acks-extras"];
  const wholeIds = { source: "I.1", activationId: "act", rowKey: "k" };
  const imm = logic.immunityRecordData({ name: "Pass", spellKey: "kind-1", dueAt: 60, cite: "XX p. 4", ...wholeIds });
  assert.equal(imm.origin, "I.1");
  assert.equal("duration" in imm, false, "the clock is the module's own, never core's duration");
  assert.equal(flagsOf(imm).itemRun.dueAt, 60);
  assert.equal(flagsOf(imm).rollMods.cite, "XX p. 4", "the item's page reference rides on the record");
  assert.equal(flagsOf(imm).rollMods.id, "kind-1", "the key is the kind's");
  assert.equal(flagsOf(imm).rollMods.label, "Pass");
  assert.deepEqual(flagsOf(imm).itemRun, { ...wholeIds, dueAt: 60 });
  assert.equal("dueAt" in flagsOf(logic.immunityRecordData({ name: "Pass", spellKey: "kind-1", ...wholeIds })).itemRun, false, "no clock, no dueAt");
  const cited = (rec) => flagsOf(rec).rollMods.cite;
  assert.equal(cited(logic.actionPartRecordData({ name: "Edge", parts: [], cite: "XX p. 5", ...wholeIds })), "XX p. 5");
  assert.equal(cited(logic.standingPartRecordData({ kindKey: "kind-1", name: "Aura", parts: [], cite: "XX p. 6", ...wholeIds })), "XX p. 6");
  assert.equal(cited(logic.actionPartRecordData({ name: "Edge", parts: [], ...wholeIds })), "", "no page reference read, none made up");
  const act = logic.actionPartRecordData({ name: "Edge", parts: [{ on: "damage", value: 1 }], ...wholeIds });
  assert.equal(act.origin, "I.1");
  assert.equal(flagsOf(act).rollMods.id, "k", "an action part is the row's");
  assert.deepEqual(flagsOf(act).itemRun, wholeIds);
  assert.equal(flagsOf(act).managed, true);
  const standing = logic.standingPartRecordData({ kindKey: "kind-1", name: "Aura", parts: [{ on: "damage", value: 2 }], ...wholeIds });
  assert.equal(standing.origin, "I.1");
  assert.equal(flagsOf(standing).rollMods.id, "kind-1", "a standing part is the kind's");
  assert.deepEqual(flagsOf(standing).rollMods.parts, [{ on: "damage", value: 2 }]);
  assert.deepEqual(flagsOf(standing).itemRun, wholeIds);
  assert.equal(flagsOf(standing).managed, true);
  const cond = logic.conditionRecordData({ statusData: { name: "Held", flags: { other: { keep: 1 } } }, ...wholeIds });
  assert.deepEqual(cond.flags.other, { keep: 1 }, "another scope's flags stay");
  assert.equal("duration" in cond, false);
  assert.equal(flagsOf(cond).itemRun.activationId, "act");
});

await t("an activation's records are found by its id from either flag shape, and the empty id finds only what was stamped empty", () => {
  const withGet = { id: "g", flags: {}, getFlag: (scope, key) => (key === "itemRun" ? { activationId: "x" } : undefined) };
  const noId = { flags: { "acks-extras": { itemRun: { activationId: "x" } } } };
  assert.deepEqual(logic.activationRecordIds([withGet, noId], "x"), ["g"], "a record with no id is not a record to delete");
  const stamped = { id: "e", flags: { "acks-extras": { itemRun: { activationId: "" } } } };
  assert.deepEqual(logic.activationRecordIds([stamped], ""), [], "an empty activation names nothing");
});

await t("a press without its seat's owners is refused, the card shows what was thrown, and the Judge's tick names its subject", () => {
  assert.equal(logic.checkPressRequest({ requestUserId: "u1", total: 5, target: 5 }, { item: {}, row: {}, target: 5 }).reason, "notOwner");
  const words = { roll: "R", undo: "U", undetermined: "?", tick: "T", saved: "S", failed: "F" };
  const ids = { itemUuid: "I", rowKey: "k", activationId: "a" };
  const open = logic.promptCardModel({ title: "G", words, ids, subjects: [{ key: "s1", name: "One" }], entries: { s1: { state: "open" } } });
  assert.equal(open.sections[0].rows[0].actions[0].action, "itemRun.roll", "an open entry is still to roll");
  const rolled = logic.promptCardModel({ title: "G", words, ids, isGM: true, subjects: [{ key: "s1", name: "One" }], entries: { s1: { state: "applied", saved: true, total: 14, target: 9, recordIds: [] } } });
  assert.equal(rolled.sections[0].rows[0].total, 14);
  assert.equal(rolled.sections[0].rows[0].target, 9);
  const noTarget = logic.promptCardModel({ title: "G", words, ids, subjects: [{ key: "s1", name: "One" }], entries: { s1: { state: "applied", saved: true, total: 14 } } });
  assert.equal("target" in noTarget.sections[0].rows[0], false);
  const judge = logic.promptCardModel({ title: "G", words, ids, isGM: true, subjects: [], undetermined: [{ key: "u1", name: "Odd" }] });
  assert.deepEqual(judge.sections[1].rows[0].actions[0].data, { ...ids, subject: "u1" });
  assert.equal(logic.promptCardModel({ title: "G", words, ids, isGM: true, subjects: [], undetermined: [] }).sections.length, 1, "no undetermined, no section");
  assert.equal("subtitle" in logic.promptCardModel({ title: "G", words, ids }), false);
});

await t("a fuse is read as floors, on the end edge, and only whole", () => {
  const f = flag();
  assert.equal(f.source, "I.1");
  assert.equal(f.activationId, "act");
  assert.deepEqual(f.spot, spot);
  const odd = logic.readFuse({ ...f, clock: { combatId: "c1", combatantId: "m1", edge: "start", count: 2.7, seen: -3 } });
  assert.deepEqual(odd.clock, { combatId: "c1", combatantId: "m1", edge: "end", count: 2, seen: 0 }, "a whole count, no negative seen, the end edge");
  assert.equal(logic.readFuse({ ...f, clock: { ...f.clock, seen: 1.9 } }).clock.seen, 1);
  assert.equal(logic.readFuse({ ...f, clock: { ...f.clock, count: 0.5 } }), null, "half a turn is none");
  for (const lacking of ["source", "activationId", "spot"]) assert.equal(logic.readFuse({ ...f, [lacking]: undefined }), null, `no ${lacking}`);
  for (const lacking of ["combatId", "combatantId"]) assert.equal(logic.readFuse({ ...f, clock: { ...f.clock, [lacking]: "" } }), null, `no ${lacking}`);
  assert.deepEqual(logic.readFuse({ ...f, dueAt: 40 }).dueAt, 40, "a world-clock time wins over the clock");
  assert.equal(logic.fuseDue({ ...f, dueAt: 0 }, null), false, "no reading is no due");
  assert.equal(logic.fuseDue({ ...f, dueAt: 0 }, ""), false);
  assert.equal(logic.fuseDue(f, 9999), false, "a combat-clock fuse is never due by the world's");
  assert.equal(logic.fuseToWorld({ ...f, clock: { ...f.clock, seen: 0 } }, "c1", { now: 10, roundSeconds: 2.2 }).dueAt, 15, "4.4 seconds past 10 is 15, not 14");
  const stepped = logic.fuseStep({ ...f, clock: { ...f.clock, seen: 2 } }, { kind: "ended", combatId: "c1", combatantId: "m1" });
  assert.deepEqual(stepped.record.clock, { combatId: "c1", combatantId: "m1", edge: "end", count: 2, seen: 2 }, "the burst hands on the record");
});

/* --- the Foundry half: a use, the two kinds lib runs, a press, Undo, a moment, the teardown and the fuse's wiring --- */
const AURA = "acks-extras.aura";
class Users extends Array {
  get(id) { return this.find((u) => u.id === id); }
}
const seatOf = (primaryGM, list = [{ id: "owner" }, { id: "other" }]) => {
  const users = Users.from(list);
  users.activeGM = primaryGM ? { isSelf: true } : undefined;
  gameStub.users = users;
};
const quiet = async (fn) => {
  const prior = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = prior; }
};
const asks = [];
const raisedRegion = { id: "R1", uuid: "S.R1" };
const regionDeletes = [];
const regionOf = (id, activationId, type = AURA) => ({ id, behaviors: [{ type, system: { sourceUuid: "I.1", bearerUuid: "A.1", activationId, rowKey: "t" } }], delete: async () => { regionDeletes.push(id); } });
const monster = (types, effects = []) => ({ documentName: "Actor", type: "monster", system: { details: { class: "" }, saves: { paralysis: { value: 12 } } }, effects, getFlag: () => (types ? { types } : undefined) });
const sceneOf = (tokens, dimensions = { distance: 5, distancePixels: 10 }) => ({ dimensions, tokens });
const bearerActor = { uuid: "A.1", isToken: false, testUserPermission: (user) => user?.id === "owner", effects: [], getActiveTokens: () => [bearerTok] };
const bearerTok = {
  id: "1", uuid: "T.1", name: "Bearer", hidden: false, actor: bearerActor, parent: null,
  baseActor: { uuid: "A.1", system: { hp: { value: 5, max: 9 } }, statuses: new Set() },
  testUserPermission: (user) => user?.id === "owner", attachments: { regions: new Set() },
};
let itemFlags = {};
const updates = [];
const theItem = {
  uuid: "I.1", name: "Gear", type: "item", actor: bearerActor, update: async (data) => { updates.push(data); },
  get flags() { return { "acks-extras": itemFlags }; },
};
const subjects = {};
globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : uuid === "T.1" ? bearerTok : subjects[uuid] ?? null);
const stage = () => {
  globalThis.CONST = { REGION_VISIBILITY: { GAMEMASTER: 1 } };
  globalThis.CONFIG = {
    Region: {
      documentClass: class {
        constructor(data, options) { this.data = data; this.options = options; madeRegions.push(this); }
        static schema = { fields: { attachment: { fields: { token: {} } } } };
        static createTokenEmanation = async (...args) => { asks.push(args); return raisedRegion; };
      },
    },
    specialStatusEffects: {},
    statusEffects: [{ id: "held", name: "Held Name", img: "held.svg" }],
  };
  globalThis.foundry.data = { operators: { ForcedDeletion }, EmanationShapeData: class {} };
};
const madeRegions = [];
const unstage = () => { delete globalThis.CONST; delete globalThis.CONFIG; globalThis.foundry.data = { operators: { ForcedDeletion } }; };
const rowsToggle = [
  { key: "a", reach: { pulse: "action", radius: { value: "10" } } },
  { key: "t", reach: { pulse: "turnStart+moveIn", radius: { value: "30" } } },
  { key: "s", reach: { pulse: "standing", radius: { value: "40" } } },
];
const toggleFlags = (state, rows = rowsToggle) => ({ itemRun: { activation: { kind: "toggle", state }, rows } });
const down = { active: false, activationId: "", regionId: "" };
const hooked = {};
const consts = await import("../scripts/lib/constants.mjs");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const presented = [];

await t("installing registers the two kinds, the two relays and the reach's handler and teardown, and the carrier takes a use through to the kind's runner", async () => {
  const priorOn = globalThis.Hooks.on;
  globalThis.Hooks.on = (name, fn) => { (hooked[name] ??= []).push(fn); };
  try {
    run.installItemRun();
    run.installItemRun();
  } finally {
    globalThis.Hooks.on = priorOn;
  }
  for (const name of [consts.TURN_BEGAN_HOOK, consts.TURN_ENDED_HOOK, "deleteCombat", "deleteToken", "updateWorldTime"]) assert.equal(hooked[name]?.length, 1, `${name} once`);
  run.setUsePresenter(async (result) => presented.push(result));
});

await t("a use is refused with its own line for an item or actor that is gone, a bearer with no token, a runner that says no, and an unknown reason; and it relays from a Player's seat", async () => {
  stage();
  seatOf(true);
  const notes2 = [];
  const priorUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: (text) => notes2.push(["warn", text]), error: (text) => notes2.push(["error", text]) } };
  try {
    itemFlags = toggleFlags(down);
    const refused = async (over, reason, kind) => {
      notes2.length = 0;
      presented.length = 0;
      const out = await run.runUse({ itemUuid: "I.1", ...over });
      assert.deepEqual(out, { ok: false, reason });
      assert.equal(notes2[0][0], kind);
      assert.ok(notes2[0][1].endsWith(`itemRun.refused.${reason}`), `${reason}'s line`);
      assert.deepEqual(presented, [], "a refusal is not presented");
    };
    await refused({ itemUuid: "I.none" }, "gone", "warn");
    itemFlags = {};
    await refused({}, "gone", "warn");
    itemFlags = toggleFlags(down);
    const actor = theItem.actor;
    theItem.actor = null;
    await refused({}, "gone", "warn");
    theItem.actor = actor;
    bearerActor.getActiveTokens = () => [];
    await refused({}, "noToken", "warn");
    bearerActor.getActiveTokens = () => [bearerTok];
    itemFlags = toggleFlags(down, [{ key: "a", reach: { pulse: "action", radius: { value: "10" } } }]);
    await refused({ requestUserId: "owner" }, "noRow", "error");
    await refused({ requestUserId: "other" }, "notOwner", "error");
    itemFlags = { itemRun: { activation: { kind: "consume" }, rows: [] } };
    run.registerActivationRunner("consume", null);
    await refused({}, "noRunner", "warn");
    run.registerActivationRunner("consume", async () => ({ ok: false, reason: "oddReason" }));
    notes2.length = 0;
    assert.deepEqual(await run.runUse({ itemUuid: "I.1" }), { ok: false, reason: "oddReason" });
    assert.ok(notes2[0][1].endsWith("itemRun.refused.refused"), "a reason it has no line for reads as a plain refusal");
    run.registerActivationRunner("consume", async () => ({ ok: false }));
    assert.deepEqual(await run.runUse({ itemUuid: "I.1" }), { ok: false, reason: "refused" });
    for (const reason of ["noRange", "down", "unsupported", "notCarried", "snapshot"]) {
      run.registerActivationRunner("consume", async () => ({ ok: false, reason }));
      await refused({}, reason, "warn");
    }
  } finally {
    run.registerActivationRunner("consume", null);
    globalThis.ui = priorUi;
    run.setUsePresenter(async (result) => presented.push(result));
    unstage();
  }
});

await t("a use on a Judge's window runs here; a Player's seat relays and, with no Judge seated, is told so; a Player's token is the synthetic actor's own", async () => {
  stage();
  seatOf(true);
  presented.length = 0;
  itemFlags = toggleFlags(down);
  try {
    const ran = await run.useItem({ uuid: "I.1" });
    assert.equal(ran.ok, true, "the Judge's own window");
    assert.equal(presented.length, 1);
    gameStub.user = { isGM: false };
    seatOf(false);
    presented.length = 0;
    assert.deepEqual(await run.useItem({ uuid: "I.1" }), { ok: false, reason: "relay" });
    assert.deepEqual(presented, []);
    gameStub.user = { isGM: true };
    seatOf(true);
    const synthetic = { ...bearerActor, isToken: true, token: { ...bearerTok, uuid: "T.syn" }, getActiveTokens: () => { throw new Error("a synthetic actor has its token"); } };
    const actor = theItem.actor;
    theItem.actor = synthetic;
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : uuid === "T.syn" ? synthetic.token : null);
    asks.length = 0;
    itemFlags = toggleFlags(down, [rowsToggle[2]]);
    const out = await run.runUse({ itemUuid: "I.1" });
    assert.equal(out.ok, true);
    assert.equal(asks.at(-1)[0].uuid, "T.syn", "the synthetic actor's own token, found without asking the scene");
    theItem.actor = actor;
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : uuid === "T.1" ? bearerTok : subjects[uuid] ?? null);
  } finally {
    gameStub.user = { isGM: true };
    unstage();
  }
});

await t("a use runs against the token the pressing seat resolved, however the GM's window is viewing another scene; with none named it falls back to the canvas, then to the actor's one linked token, and refuses two", async () => {
  stage();
  seatOf(true);
  const notes2 = [];
  const priorUi = globalThis.ui;
  const priorScenes = gameStub.scenes;
  const priorActors = bearerActor.getActiveTokens;
  globalThis.ui = { notifications: { warn: (text) => notes2.push(["warn", text]), error: (text) => notes2.push(["error", text]) } };
  const otherActor = { uuid: "A.9", id: "a9", effects: [], testUserPermission: () => true };
  const strangerTok = { ...bearerTok, id: "9", uuid: "T.9", actor: otherActor, baseActor: { uuid: "A.9" } };
  const linkedTok = (id) => ({ ...bearerTok, id, uuid: `T.${id}`, actorLink: true, actorId: "a1" });
  const prior = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "T.9" ? strangerTok : prior(uuid));
  const ran = async (over = {}) => {
    asks.length = 0;
    return { out: await run.runUse({ itemUuid: "I.1", ...over }), asked: asks.at(-1)?.[0] ?? null };
  };
  try {
    bearerActor.id = "a1";
    itemFlags = toggleFlags(down);
    presented.length = 0;
    // The GM's window views another scene: the actor has no token on the canvas it sees.
    bearerActor.getActiveTokens = () => [];
    const carried = await ran({ tokenUuid: "T.1" });
    assert.equal(carried.out.ok, true, "the token the seat named is the bearer's, wherever this window looks");
    assert.equal(carried.asked, bearerTok);
    // A token of another body is refused, never raised.
    const probed = [];
    run.registerActivationRunner("consume", async ({ token }) => { probed.push(token); return { ok: true, kind: "probe" }; });
    itemFlags = { itemRun: { activation: { kind: "consume" }, rows: [] } };
    assert.deepEqual((await ran({ tokenUuid: "T.9" })).out, { ok: false, reason: "notCarried" });
    assert.deepEqual(probed, [], "no runner reaches the other body's token");
    assert.equal((await ran({ tokenUuid: "T.1" })).out.ok, true);
    assert.deepEqual(probed, [bearerTok]);
    run.registerActivationRunner("consume", null);
    itemFlags = toggleFlags(down);
    // With none named and none on the canvas, the actor's one linked token on any scene.
    gameStub.scenes = [{ tokens: [{ actorLink: false, actorId: "a1", uuid: "T.u" }, linkedTok("1"), { actorLink: true, actorId: "other", uuid: "T.o" }] }, { tokens: [] }];
    const found = await ran();
    assert.equal(found.out.ok, true);
    assert.equal(found.asked.uuid, "T.1", "an unlinked token and another actor's are no candidate");
    gameStub.scenes = [{ tokens: [linkedTok("1")] }, { tokens: [linkedTok("2")] }];
    notes2.length = 0;
    assert.deepEqual((await ran()).out, { ok: false, reason: "manyTokens" }, "two linked tokens: no scene is the right one");
    assert.ok(notes2[0][1].endsWith("itemRun.refused.manyTokens"));
    gameStub.scenes = [];
    assert.deepEqual((await ran()).out, { ok: false, reason: "noToken" });
    // The canvas token wins over a linked one elsewhere, and a seat's token wins over both.
    bearerActor.getActiveTokens = () => [bearerTok];
    gameStub.scenes = [{ tokens: [linkedTok("2"), linkedTok("3")] }];
    assert.equal((await ran()).asked, bearerTok, "the viewed scene's token is read before any scan");
    // The seat's own resolution travels with the use.
    gameStub.user = { isGM: false };
    seatOf(true);
    const sent = [];
    gameStub.socket = { emit: (channel, message) => sent.push(message) };
    await run.useItem(theItem);
    assert.deepEqual(sent.map((m) => m.payload), [{ itemUuid: "I.1", tokenUuid: "T.1" }], "a relayed use names the token the seat resolved");
  } finally {
    delete gameStub.socket;
    gameStub.user = { isGM: true };
    gameStub.scenes = priorScenes;
    bearerActor.getActiveTokens = priorActors;
    delete bearerActor.id;
    globalThis.fromUuidSync = prior;
    globalThis.ui = priorUi;
    unstage();
  }
});

await t("a raise holds the standing part on a bearer the item's filter counts, a choice kept across raises, under the raise's activation, and none on a bearer it does not count or under a prompting reach", async () => {
  stage();
  seatOf(true);
  const kept = new Map();
  const prior = { effects: bearerActor.effects, create: bearerActor.createEmbeddedDocuments };
  bearerActor.effects = { get: (id) => kept.get(id), [Symbol.iterator]: () => kept.values() };
  bearerActor.createEmbeddedDocuments = async (kind, data) => { for (const d of data) kept.set(d._id, { ...d, id: d._id }); return data.map((d) => ({ id: d._id })); };
  const row = (pulse, filter) => ({ key: "s", reach: { pulse, radius: { value: "40" }, modifier: { value: "-1" }, on: ["morale"], filter } });
  presented.length = 0;
  try {
    itemFlags = toggleFlags(down, [row("standing", { self: "count" })]);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true);
    assert.deepEqual([...kept.values()].map((e) => e.flags["acks-extras"].itemRun.activationId), ["rid"], "the bearer holds its part from the raise, under the raise's activation so lowering lifts it");
    kept.clear();
    itemFlags = toggleFlags(down, [row("standing", { self: "no" })]);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true);
    assert.deepEqual([...kept.keys()], [], "a bearer the filter does not count holds nothing");
    itemFlags = toggleFlags(down, [row("turnStart+moveIn", { self: "count" })]);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true);
    assert.deepEqual([...kept.keys()], [], "a prompting reach asks the bearer at its turn start and holds no part");
  } finally {
    bearerActor.effects = prior.effects;
    if (prior.create) bearerActor.createEmbeddedDocuments = prior.create; else delete bearerActor.createEmbeddedDocuments;
    itemFlags = {};
    unstage();
  }
});

await t("one fixed key names an item kind: the importer's entry id, else the row's", () => {
  assert.equal(run.kindKeyOf({ flags: { "acks-extras": { cookbook: { id: "entry-1" } } } }, { key: "row-1" }), "entry-1");
  assert.equal(run.kindKeyOf({ flags: {} }, { key: "row-1" }), "row-1");
  assert.equal(run.kindKeyOf(null, null), "");
});

await t("a toggle raises the first row that acts while raised, writes its state, and lowers only its own activation's Regions", async () => {
  stage();
  seatOf(true);
  presented.length = 0;
  asks.length = 0;
  updates.length = 0;
  try {
    itemFlags = toggleFlags(down);
    const on = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual(on, { ok: true, kind: "toggle", active: true, activationId: "rid", itemUuid: "I.1", rowKey: "t", tokenUuid: "T.1", regionUuid: "S.R1" }, "what the presenter needs to post the raised card");
    assert.equal(asks.length, 1);
    assert.equal(asks[0][1], 30, "the first row that acts while raised, never the action row");
    assert.equal(asks[0][2].behaviors[0].system.rowKey, "t");
    assert.equal(asks[0][2].behaviors[0].system.activationId, "rid");
    assert.deepEqual(updates, [{ "flags.acks-extras.itemRun.activation.state": { active: true, activationId: "rid", regionId: "R1" } }]);
    assert.deepEqual(presented.map((p) => p.kind), ["toggle"]);
    // Only a standing row also raises; only an action row has nothing to raise.
    updates.length = 0;
    itemFlags = toggleFlags(down, [rowsToggle[0], rowsToggle[2]]);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true);
    assert.equal(asks.at(-1)[2].behaviors[0].system.rowKey, "s");
    itemFlags = toggleFlags(down, [rowsToggle[1]]);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true, "a turnStart+moveIn row alone raises");
    updates.length = 0;
    asks.length = 0;
    itemFlags = toggleFlags(down, [rowsToggle[0]]);
    assert.deepEqual(await quiet(() => run.runUse({ itemUuid: "I.1" })), { ok: false, reason: "noRow" });
    assert.deepEqual([asks.length, updates.length], [0, 0], "no row to raise: nothing asked, nothing written");
    itemFlags = toggleFlags(down, [{ key: "t", reach: { pulse: "standing", radius: { value: "" } } }]);
    assert.deepEqual(await quiet(() => run.runUse({ itemUuid: "I.1" })), { ok: false, reason: "noRange" }, "the raise's own refusal is the use's");
    assert.deepEqual([asks.length, updates.length], [0, 0], "a refused raise leaves the item down");
    // Down again: only this activation's Regions go, and the state is cleared.
    bearerTok.attachments.regions = new Set([regionOf("r1", "act1"), regionOf("r2", "act2"), regionOf("r3", "act1", "other")]);
    regionDeletes.length = 0;
    itemFlags = toggleFlags({ active: true, activationId: "act1", regionId: "r1" });
    const off = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual(off, { ok: true, kind: "toggle", active: false });
    assert.deepEqual(regionDeletes, ["r1"], "its own Region alone");
    assert.deepEqual(updates.at(-1), { "flags.acks-extras.itemRun.activation.state": { active: false, activationId: "", regionId: "" } });
  } finally {
    bearerTok.attachments.regions = new Set();
    unstage();
  }
});

await t("a once-only use takes who the action row's reach meets: the admitted to roll, the unsettled to the Judge's tick", async () => {
  stage();
  seatOf(true);
  presented.length = 0;
  try {
    const tok = (id, types, extra = {}) => ({ id, uuid: `T.${id}`, name: `Tok ${id}`, flags: { "acks-extras": {} }, disposition: -1, actor: monster(types, extra.effects), testInsideRegion: () => true });
    const s1 = tok("s1", ["alpha"]);
    const s2 = tok("s2", ["beta"]);
    const s3 = tok("s3", ["alpha"]);
    const s4 = tok("s4", undefined);
    const friend = tok("s6", ["alpha"]);
    friend.disposition = 1;
    const marker = { ...tok("s5", ["alpha"]), actor: { ...monster(["alpha"]), type: "acks-extras.faction" } };
    const area = sceneOf([bearerTok, s1, s2, s3, s4, friend, marker]);
    bearerTok.parent = area;
    bearerTok.disposition = 1;
    bearerTok.testInsideRegion = () => true;
    const row = { key: "k", reach: { pulse: "action", radius: { value: "15" }, filter: { kinds: ["alpha"], side: "opposing" } } };
    itemFlags = { cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "5" } } }, row] } };
    const judge = await run.runUse({ itemUuid: "I.1" });
    assert.equal(judge.ok, true);
    assert.equal(judge.kind, "once");
    assert.equal(judge.rowKey, "k", "the action row, not the first row");
    assert.equal(judge.activationId, "rid");
    assert.equal(madeRegions.at(-1).data.shapes[0].radius, 150, "15 units at 10 pixels each, on the bearer's own scene");
    assert.equal(madeRegions.at(-1).options.parent, area);
    assert.deepEqual(judge.subjects.map((s) => s.key), ["T.s1", "T.s3"], "the alpha creatures on the other side, never the bearer's own side");
    assert.deepEqual(judge.undetermined.map((s) => s.key), ["T.s4"], "no kinds: the Judge's tick");
    assert.equal(judge.card.title, "Gear");
    assert.equal(judge.card.subtitle, "Bearer");
    assert.deepEqual(judge.card.sections[0].rows.map((r) => r.name), ["Tok s1", "Tok s3"], "each admitted subject is asked");
    assert.deepEqual(judge.card.sections[0].rows[0].actions[0].data, { itemUuid: "I.1", rowKey: "k", activationId: "rid", subject: "T.s1" });
    assert.equal(judge.card.sections.length, 2, "a Judge sees the unsettled");
    assert.equal(judge.card.sections[1].rows[0].actions[0].data.subject, "T.s4");
    assert.deepEqual(presented.map((p) => p.kind), ["once"]);
    const player = await run.runUse({ itemUuid: "I.1", requestUserId: "owner" });
    assert.equal(player.card.sections.length, 1, "a Player sees no tick");
    // What stops it.
    const fail = async (reason) => assert.deepEqual(await quiet(() => run.runUse({ itemUuid: "I.1" })), { ok: false, reason });
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "5" } } }] } };
    await fail("noRow");
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "k", reach: { pulse: "action", radius: { value: "0" } } }] } };
    await fail("noRange");
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "k", reach: { pulse: "action", radius: { value: "" } } }] } };
    await fail("noRange");
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [row] } };
    bearerTok.parent = sceneOf([bearerTok], {});
    await fail("scale");
  } finally {
    bearerTok.parent = null;
    delete bearerTok.testInsideRegion;
    delete bearerTok.disposition;
    unstage();
  }
});

await t("a window the carrier itself wrote makes its subject immune: the once-only use and the reach's moment both skip it, and another kind's window or none prompts", async () => {
  stage();
  seatOf(true);
  presented.length = 0;
  const windowFor = (spellKey) => logic.immunityRecordData({ name: "Pass", spellKey, dueAt: 60, ...ids });
  const row = { key: "k", reach: { pulse: "action", radius: { value: "15" }, filter: { kinds: ["alpha"], side: "opposing" } } };
  const kindItem = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindX" } } } };
  const key = run.kindKeyOf(kindItem, row);
  assert.equal(key, "kindX");
  try {
    const tok = (id, effects) => ({ id, uuid: `T.${id}`, name: `Tok ${id}`, flags: { "acks-extras": {} }, disposition: -1, actor: monster(["alpha"], effects), testInsideRegion: () => true });
    const immune = tok("s1", [windowFor(key)]);
    const open = tok("s2", []);
    const other = tok("s3", [windowFor("kindY")]);
    bearerTok.parent = sceneOf([bearerTok, immune, open, other]);
    bearerTok.disposition = 1;
    bearerTok.testInsideRegion = () => true;
    itemFlags = { cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [row] } };
    const out = await run.runUse({ itemUuid: "I.1" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.subjects.map((s) => [s.key, s.immune]), [["T.s1", true], ["T.s2", false], ["T.s3", false]], "only the kind's own window marks a subject immune");
    assert.deepEqual(out.card.sections[0].rows.map((r) => r.name), ["Tok s2", "Tok s3"], "an immune subject is never asked to roll");
    // The reach's moment reads the same record through the same key.
    const seen = [];
    run.setUsePresenter(async (result) => seen.push(result));
    const moment = (subject) => run.handleReachMoment({ moment: "turnStart", config: { activationId: "act" }, item: kindItem, row, reach: { pulse: "turnStart+moveIn" }, subject, admitted: true });
    await moment({ actor: immune.actor });
    await moment({ actor: open.actor });
    await moment({ actor: other.actor });
    assert.deepEqual(seen.map((s) => s.act), ["skip", "prompt", "prompt"]);
  } finally {
    run.setUsePresenter(async (result) => presented.push(result));
    bearerTok.parent = null;
    delete bearerTok.testInsideRegion;
    delete bearerTok.disposition;
    unstage();
  }
});

await t("a press writes what the throw's verdict calls for, on the item's own row: conditions on a failure, an immunity window on a success, the fight's clock where there is one", async () => {
  stage();
  seatOf(true);
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const created = [];
  const actor = monster(["alpha"]);
  actor.createEmbeddedDocuments = async (kind, records) => { created.push([kind, records]); return records.map((_, i) => ({ id: `E${i}` })); };
  const subject = { id: "s1", uuid: "T.s1", actor, testUserPermission: (user) => user?.id === "owner" };
  subjects["T.s1"] = subject;
  const target = saveSpec(actor, "paralysis").target;
  assert.equal(typeof target, "number");
  const row = { key: "k", target: "paralysis", conditions: ["held", "held"], reach: { pulse: "action", radius: { value: "5" }, immunity: { value: "2" } } };
  itemFlags = { cookbook: { id: "kindX", cite: "XX p. 9" }, itemRun: { activation: { kind: "once" }, rows: [row] } };
  const priorRandom = globalThis.foundry.utils.randomID;
  let minted = 0;
  globalThis.foundry.utils.randomID = () => `card-${++minted}`;
  const press = (over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "k", activationId: "act", subject: "T.s1", total: target - 1, target, ...over });
  try {
    gameStub.combat = { id: "c9", combatants: [{ id: "m9", tokenId: "s1" }] };
    const failed = await press();
    assert.deepEqual(failed, { ok: true, saved: false, entry: { subject: "T.s1", state: "applied", saved: false, total: target - 1, target, recordIds: ["E0", "E1"], names: ["Held Name", "Held Name"], life: "turn", presser: "" } }, "what was written and for how long rides on the entry");
    const [kind, records] = created[0];
    assert.equal(kind, "ActiveEffect");
    assert.equal(records.length, 2, "one record per condition the row names");
    const flags = records[0].flags["acks-extras"];
    assert.deepEqual(flags.itemRun, { source: "I.1", activationId: "act", rowKey: "k" });
    assert.equal(flags.managed, true);
    assert.deepEqual(flags.turnLife, { combatId: "c9", combatantId: "m9", edge: "start", count: 1 }, "ends with the subject's next turn start");
    assert.equal(records[0].origin, "I.1");
    assert.deepEqual(records[0].statuses, ["held"]);
    created.length = 0;
    gameStub.combat = { id: "c9", combatants: [{ id: "m9", tokenId: "other" }] };
    await press();
    assert.equal(created[0][1][0].flags["acks-extras"].turnLife, undefined, "a subject not in the fight has no clock");
    assert.deepEqual(created[0][1][0].flags["acks-extras"].turnMark, { edge: "start" }, "it carries the mark lib's turn start lifts at its first initiative in a fight");
    created.length = 0;
    gameStub.combat = null;
    await press();
    assert.equal(created[0][1][0].flags["acks-extras"].turnLife, undefined, "no fight, no clock");
    assert.deepEqual(created[0][1][0].flags["acks-extras"].turnMark, { edge: "start" }, "a failure outside a fight carries the mark");
    created.length = 0;
    const forged = () => ({ name: "Forged", duration: { seconds: 1 } });
    const saved = await press({ total: target, window: forged, entryState: "applied" });
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.entry.recordIds, ["E0"]);
    const immunity = created[0][1][0];
    assert.equal(immunity.origin, "I.1");
    assert.equal("duration" in immunity, false, "no core duration: the module's own clock ends the window");
    assert.equal(immunity.flags["acks-extras"].itemRun.dueAt, 2 * 600, "the window is the row's own figure read here, in turns from the clock, never the request's");
    assert.equal(immunity.flags["acks-extras"].rollMods.cite, "XX p. 9", "the item's page reference rides on the window");
    assert.equal(immunity.name, "Gear", "named by the item");
    assert.deepEqual(immunity.flags["acks-extras"].rollMods.parts, [{ on: "immune", spells: ["kindX"] }], "the kind's key, never the row's");
    assert.equal(immunity.flags["acks-extras"].itemRun.activationId, "card-1", "the window carries a card id of its own");
    assert.notEqual(immunity.flags["acks-extras"].itemRun.activationId, "act", "never the raised activation's, which lowering lifts");
    created.length = 0;
    // The window's end is read from the clock at the moment of the press.
    gameStub.time = { worldTime: 5000 };
    await press({ total: target });
    assert.equal(created[0][1][0].flags["acks-extras"].itemRun.dueAt, 5000 + 2 * 600, "counted from now");
    gameStub.time = { worldTime: 0 };
    created.length = 0;
    itemFlags = { cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [{ ...row, reach: { pulse: "action", radius: { value: "5" } } }] } };
    const bare = await press({ total: target });
    assert.deepEqual(bare.entry.recordIds, [], "no window to write: nothing is created");
    assert.deepEqual(created, []);
    // What is refused is refused before anything is written.
    for (const [over, reason] of [
      [{ target: target + 1 }, "figure"], [{ requestUserId: "other" }, "notOwner"],
      [{ itemUuid: "I.none" }, "gone"], [{ rowKey: "none" }, "noRow"], [{ total: "x" }, "noRoll"],
    ]) assert.equal((await press(over)).reason, reason, reason);
    assert.equal((await press({ requestUserId: "owner" })).reason, "noCard", "a relayed press names a card that holds the row");
    // The card is the entry state's only source: the GM reads it, writes the entry back, and a second press of the row is refused.
    const flagged = {};
    const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
    const message = {
      flags: { "acks-extras": { itemRunCard: { itemUuid: "I.1", rowKey: "k", activationId: "act", entries: {} } } },
      getFlag(scope, key) { return this.flags[scope][key]; },
      async update(data) {
        const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
        this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
        flagged.itemRunCard = this.flags["acks-extras"].itemRunCard;
      },
    };
    gameStub.messages = { get: (id) => (id === "M1" ? message : null) };
    created.length = 0;
    const first = await press({ requestUserId: "owner", messageId: "M1", total: target, target });
    assert.equal(first.ok, true, "the subject's owner, on a card");
    assert.equal(flagged.itemRunCard.entries["T~s1"].state, "applied", "the GM writes the entry onto the card, under a key free of dots");
    const second = await press({ requestUserId: "owner", messageId: "M1", total: target - 1, entryState: "open" });
    assert.equal(second.reason, "applied", "a second press is refused from the card, whatever the request says");
    const own = message.flags["acks-extras"].itemRunCard.itemUuid;
    message.flags["acks-extras"].itemRunCard.itemUuid = "I.other";
    assert.equal((await press({ requestUserId: "owner", messageId: "M1" })).reason, "noCard", "a card that holds another item is no card for this one");
    message.flags["acks-extras"].itemRunCard.itemUuid = own;
    const ids = await press({ messageId: "M1", total: target - 1, rowKey: "forged", activationId: "forged" });
    assert.equal(ids.reason, "applied", "the card's own ids and entries decide, not the request's");
    // Entries are keyed by moment: a named open entry is pressed, a struck one is refused, and a waiting row takes a Judge's early press alone.
    message.flags["acks-extras"].itemRunCard = { itemUuid: "I.1", rowKey: "k", activationId: "act", subjects: { "T~s1": { uuid: "T.s1", name: "One", state: "in", latest: "mk" } }, entries: { mk: { subject: "T.s1", momentKey: "mk", state: "open" } } };
    const entries = () => message.flags["acks-extras"].itemRunCard.entries;
    const named = await press({ requestUserId: "owner", messageId: "M1", entryKey: "mk", total: target, target });
    assert.equal(named.ok, true);
    assert.deepEqual([entries().mk.state, entries().mk.momentKey, entries().mk.subject], ["applied", "mk", "T.s1"], "the one entry the moment opened is written, keeping what it held");
    assert.equal((await press({ requestUserId: "owner", messageId: "M1", entryKey: "mk" })).reason, "applied", "a second press on an entry that is not open is refused");
    assert.equal((await press({ requestUserId: "owner", messageId: "M1", entryKey: "gone" })).reason, "struck", "an entry the card no longer holds");
    assert.equal((await press({ requestUserId: "owner", messageId: "M1" })).reason, "waiting", "an owner who is no Judge cannot press a row before its moment");
    const early = await press({ messageId: "M1", total: target - 1 });
    assert.equal(early.ok, true, "the Judge's own seat goes through");
    assert.equal(early.entry.early, true);
    const earlyKey = message.flags["acks-extras"].itemRunCard.subjects["T~s1"].latest;
    assert.notEqual(earlyKey, "mk", "the early press opens an entry of its own and makes it the subject's newest");
    assert.equal(entries()[earlyKey].state, "applied");
    assert.equal(entries().mk.state, "applied", "the earlier answer stays beside it");
    // A once-only use's card holds no entry before a press: its Roll names the subject's own key and is not struck.
    message.flags["acks-extras"].itemRunCard = { kind: "once", itemUuid: "I.1", rowKey: "k", activationId: "act", subjects: { "T~s1": { uuid: "T.s1", name: "One", state: "in", latest: "" } }, undetermined: {}, entries: {} };
    const onceEntry = await press({ requestUserId: "owner", messageId: "M1", entryKey: "T~s1", total: target, target });
    assert.equal(onceEntry.ok, true, "a once-only card's first press is written, not refused as a struck prompt");
    assert.equal(entries()["T~s1"].state, "applied");
    delete gameStub.messages;
    created.length = 0;
    created.length = 0;
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "k", conditions: ["held"] }] } };
    assert.equal((await press()).reason, "noFigure", "a row naming no save has no figure to check");
    assert.deepEqual(created, []);
  } finally {
    gameStub.combat = null;
    globalThis.foundry.utils.randomID = priorRandom;
    delete subjects["T.s1"];
    unstage();
  }
});

await t("a row that names how long a failed save lasts writes its condition and its window under fixed ids, one per item kind, carrying the card's id and the entry's key, and an earlier record under the same id is deleted first", async () => {
  stage();
  seatOf(true);
  globalThis.CONFIG.statusEffects.push({ id: "blind", name: "Blind Name", img: "blind.svg" });
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const { turnSeconds } = await import("../scripts/lib/time-unit.mjs");
  const ops = [];
  class Effects extends Array {
    get(id) { return this.find((e) => e.id === id); }
  }
  const actor = monster(["alpha"], new Effects());
  actor.createEmbeddedDocuments = async (...args) => {
    ops.push(["create", ...args]);
    return args[1].map((r, i) => { const rec = { id: r._id ?? `E${i}`, flags: r.flags }; actor.effects.push(rec); return rec; });
  };
  actor.deleteEmbeddedDocuments = async (...args) => {
    ops.push(["delete", ...args]);
    args[1].forEach((id) => actor.effects.splice(actor.effects.findIndex((e) => e.id === id), 1));
  };
  const subject = { id: "s1", uuid: "T.s1", actor, testUserPermission: (user) => user?.id === "owner" };
  subjects["T.s1"] = subject;
  const target = saveSpec(actor, "paralysis").target;
  const reach = (over = {}) => ({ pulse: "turnStart+enter", engaged: true, lasts: { value: "3" }, immunity: { value: "2" }, ...over });
  const setRow = (over = {}, rowOver = {}) => { itemFlags = { cookbook: { id: "kindX", cite: "XX p. 9" }, itemRun: { activation: { kind: "once" }, rows: [{ key: "k", target: "paralysis", conditions: ["held", "blind"], reach: reach(over), ...rowOver }] } }; };
  const press = (over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "k", activationId: "act", subject: "T.s1", total: target - 1, target, ...over });
  const priorRandom = globalThis.foundry.utils.randomID;
  let minted = 0;
  globalThis.foundry.utils.randomID = () => `card-${++minted}`;
  const priorTime = gameStub.time;
  try {
    gameStub.time = { worldTime: 100 };
    gameStub.combat = { id: "c9", combatants: [{ id: "m9", tokenId: "s1" }] };
    setRow();
    const failed = await press();
    assert.equal(failed.ok, true);
    assert.equal(failed.saved, false);
    const [, kind, records, options] = ops[0];
    assert.equal(kind, "ActiveEffect");
    assert.deepEqual(options, { keepId: true }, "the records are created under the ids they carry");
    assert.equal(records.length, 2, "one record per condition the row names");
    assert.equal(records[0]._id, logic.lastsRecordId("kindX", "held", 0));
    assert.equal(records[1]._id, logic.lastsRecordId("kindX", "blind", 1));
    assert.notEqual(records[0]._id, records[1]._id, "two conditions never share an id");
    assert.equal(records[0]._id, conditionEffectId("itemRun:kindX:lasts"), "the first condition takes the kind's own id");
    assert.deepEqual(records.map((r) => r.statuses), [["held"], ["blind"]]);
    const stamp = records[0].flags["acks-extras"];
    assert.deepEqual(stamp.itemRun, { source: "I.1", activationId: "card-1", rowKey: "k", dueAt: 100 + 3 * turnSeconds(), cardId: "card-1", entryKey: "T~s1" }, "the card's id and the entry's key ride on it, and it ends on the world clock");
    assert.equal(stamp.turnLife, undefined, "no fight clock: the row says how long");
    assert.equal(stamp.turnMark, undefined, "no turn mark either");
    assert.deepEqual(failed.entry.recordIds, records.map((r) => r._id));
    assert.equal(failed.entry.life, "timed");
    assert.equal(ops.length, 1, "nothing stood to be replaced");

    // A later failure replaces the earlier records: deleted first, managed, then created again under the same ids.
    ops.length = 0;
    const again = await press();
    assert.equal(again.ok, true);
    assert.deepEqual(ops.map((o) => o[0]), ["delete", "create"], "the earlier record goes before the new one is written");
    assert.deepEqual(ops[0].slice(1), ["ActiveEffect", records.map((r) => r._id), managedDelete()]);
    assert.deepEqual(ops[1][3], { keepId: true });
    assert.equal(actor.effects.length, 2, "one record of the kind per condition, never two");

    // A pass writes the window under the kind's immunity id, and the failure's condition stays.
    ops.length = 0;
    const passed = await press({ total: target });
    assert.equal(passed.saved, true);
    const [, , window, windowOptions] = ops[0];
    assert.deepEqual(windowOptions, { keepId: true });
    assert.equal(window.length, 1);
    assert.equal(window[0]._id, logic.immuneRecordId("kindX"));
    assert.notEqual(window[0]._id, logic.lastsRecordId("kindX"), "the window and the condition never share an id");
    assert.deepEqual(window[0].flags["acks-extras"].itemRun, { source: "I.1", activationId: "card-3", rowKey: "k", dueAt: 100 + 2 * turnSeconds(), cardId: "card-3", entryKey: "T~s1" });
    assert.deepEqual(window[0].flags["acks-extras"].rollMods.parts, [{ on: "immune", spells: ["kindX"] }]);
    assert.equal(ops.length, 1, "no earlier window stood");
    ops.length = 0;
    await press({ total: target });
    assert.deepEqual(ops.map((o) => o[0]), ["delete", "create"], "a later pass replaces the earlier window");
    assert.deepEqual(ops[0][2], [logic.immuneRecordId("kindX")]);

    // A pass with no immunity written writes nothing, and no delete is asked.
    ops.length = 0;
    setRow({ immunity: null });
    const bare = await press({ total: target });
    assert.deepEqual(bare.entry.recordIds, []);
    assert.deepEqual(ops, [], "nothing to write, nothing to replace");

    // The card that holds the entry is named on the record, never the raised activation.
    ops.length = 0;
    actor.effects.length = 0;
    setRow();
    const message = {
      flags: { "acks-extras": { itemRunCard: { kind: "once", cardId: "C1", itemUuid: "I.1", rowKey: "k", activationId: "act", subjects: { "T~s1": { uuid: "T.s1", name: "One", state: "in", latest: "" } }, undetermined: {}, entries: {} } } },
      getFlag(scope, key) { return this.flags[scope][key]; },
      async update() {},
    };
    gameStub.messages = { get: (id) => (id === "M1" ? message : null) };
    const carded = await press({ requestUserId: "owner", messageId: "M1", entryKey: "T~s1" });
    assert.equal(carded.ok, true);
    const cardedRun = ops[0][2][0].flags["acks-extras"].itemRun;
    assert.deepEqual([cardedRun.cardId, cardedRun.entryKey, cardedRun.activationId], ["C1", "T~s1", "C1"], "the card's own id, never the raised activation's, which lowering lifts");

    // A blank figure: a seat that is no Judge's is refused, the Judge's own writes the condition untimed.
    const blank = { doc: "none", table: "none", row: "none", figure: "none" };
    for (const lasts of [blank, { value: "x" }]) {
      ops.length = 0;
      actor.effects.length = 0;
      setRow({ lasts });
      message.flags["acks-extras"].itemRunCard.entries = {};
      assert.deepEqual(await press({ requestUserId: "owner", messageId: "M1", entryKey: "T~s1" }), { ok: false, reason: "noFigure" }, "a Player's press on a blank lasts is refused");
      assert.deepEqual(ops, [], "and writes nothing");
      const judged = await press();
      assert.equal(judged.ok, true, "the Judge's own seat goes through");
      assert.equal(judged.entry.life, "raised", "untimed: it stands until the reach is lowered");
      const [, , untimed, untimedOptions] = ops[0];
      assert.deepEqual(untimedOptions, { keepId: true });
      assert.equal(untimed[0]._id, logic.lastsRecordId("kindX", "held", 0), "still a record of the lasts kind");
      assert.equal("dueAt" in untimed[0].flags["acks-extras"].itemRun, false, "no end on the clock");
      assert.equal(untimed[0].flags["acks-extras"].turnLife, undefined);
      assert.equal(untimed[0].flags["acks-extras"].turnMark, undefined);
    }
    delete gameStub.messages;

    // A cleaned E4 row (an empty `lasts`) is no lasts row: the fight's clock ends its records, with no fixed id and no options.
    ops.length = 0;
    actor.effects.length = 0;
    setRow({ pulse: "action", lasts: {}, engaged: false });
    const e4 = await press();
    assert.equal(e4.entry.life, "turn", "the fight's clock, as every row had it before lasts");
    assert.equal(ops.length, 1);
    assert.equal(ops[0].length, 3, "created with no options");
    assert.equal(ops[0][2].every((r) => !("_id" in r)), true, "no fixed id");
    assert.deepEqual(ops[0][2][0].flags["acks-extras"].turnLife, { combatId: "c9", combatantId: "m9", edge: "start", count: 1 });
    assert.equal("cardId" in ops[0][2][0].flags["acks-extras"].itemRun, false);
    assert.equal("entryKey" in ops[0][2][0].flags["acks-extras"].itemRun, false);
    ops.length = 0;
    await press({ total: target });
    assert.equal(ops[0].length, 3, "a pass of such a row is created with no options either");
    assert.equal("_id" in ops[0][2][0], false);
  } finally {
    gameStub.combat = null;
    gameStub.time = priorTime;
    delete gameStub.messages;
    globalThis.foundry.utils.randomID = priorRandom;
    delete subjects["T.s1"];
    unstage();
  }
});

await t("Undo of a record kept under a fixed id deletes it only while the entry that wrote it still owns it", async () => {
  seatOf(true);
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const rec = (id, entryKey) => ({ id, flags: { "acks-extras": { itemRun: { source: "I.1", activationId: "c", rowKey: "k", ...(entryKey ? { entryKey } : {}) } } } });
  const present = new Map([["a", rec("a", "mine")], ["b", rec("b", "theirs")], ["c", rec("c")], ["d", { id: "d" }]]);
  const byId = (id) => present.get(id);
  assert.deepEqual(logic.undoGuard(["a", "b", "c", "d", "gone"], byId, "mine"), ["a", "c", "d", "gone"], "a record carrying another entry's key stays; an unkeyed one and a missing one are passed on");
  assert.deepEqual(logic.undoGuard(["a", "b"], byId, "theirs"), ["b"]);
  assert.deepEqual(logic.undoGuard(undefined, byId, "mine"), []);
  const getter = (id) => (id === "a" ? { getFlag: (scope, key) => (scope === "acks-extras" && key === "itemRun" ? { entryKey: "theirs" } : undefined) } : undefined);
  assert.deepEqual(logic.undoGuard(["a"], getter, "mine"), [], "a record that hands its flags over through getFlag is read the same");
  const deletes = [];
  const actor = { effects: [...present.values()], deleteEmbeddedDocuments: async (...args) => deletes.push(args) };
  globalThis.fromUuidSync = (uuid) => (uuid === "T.1" ? { actor } : null);
  try {
    const done = await run.undoEntry({ subject: "T.1", entry: { recordIds: ["a", "b", "c", "d"] }, entryKey: "mine" });
    assert.deepEqual(done, { ok: true, removed: ["a", "c", "d"] });
    assert.deepEqual(deletes[0], ["ActiveEffect", ["a", "c", "d"], managedDelete()]);
    deletes.length = 0;
    assert.deepEqual((await run.undoEntry({ subject: "T.1", entry: { recordIds: ["b"] }, entryKey: "mine" })).removed, [], "a record a later entry replaced is not this entry's to delete");
    assert.deepEqual(deletes, [], "and nothing is asked of the actor");
    assert.deepEqual((await run.undoEntry({ subject: "T.1", entry: { recordIds: ["b"] } })).removed, ["b"], "no entry key named, no guard");
  } finally {
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : uuid === "T.1" ? bearerTok : subjects[uuid] ?? null);
  }
});

await t("a press's throw is refused on the seat when the row names how long a failure lasts and no figure resolves, unless the Judge's own seat throws", async () => {
  stage();
  seatOf(true);
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const created = [];
  const actor = monster(["alpha"]);
  actor.createEmbeddedDocuments = async (...args) => { created.push(args); return args[1].map((_, i) => ({ id: `E${i}` })); };
  subjects["T.s1"] = { id: "s1", uuid: "T.s1", actor, testUserPermission: () => true };
  const target = saveSpec(actor, "paralysis").target;
  const blank = { doc: "none", table: "none", row: "none", figure: "none" };
  const rowsWith = (lasts) => ({ cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [{ key: "k", target: "paralysis", conditions: ["held"], reach: { pulse: "turnStart+enter", engaged: true, ...(lasts ? { lasts } : {}) } }] } });
  itemFlags = rowsWith(blank);
  const priorRoll = globalThis.Roll;
  globalThis.Roll = class { async evaluate() { return { total: target - 1 }; } };
  const base = { itemUuid: "I.1", rowKey: "k", activationId: "act", subject: "T.s1" };
  try {
    gameStub.user = { isGM: false };
    seatOf(false);
    assert.deepEqual(await run.pressRoll(base), { ok: false, reason: "noFigure" }, "refused on the seat, before anything is relayed");
    itemFlags = rowsWith({ value: "2" });
    assert.deepEqual(await run.pressRoll(base), { ok: false, reason: "relay" }, "a figure that resolves goes on to the relay");
    itemFlags = rowsWith(null);
    assert.deepEqual(await run.pressRoll(base), { ok: false, reason: "relay" }, "a row that names no lasts figure is no lasts row");
    gameStub.user = { isGM: true };
    seatOf(true);
    itemFlags = rowsWith(blank);
    const judged = await run.pressRoll(base);
    assert.equal(judged.ok, true, "the Judge's own seat throws and writes");
    assert.equal("dueAt" in created[0][1][0].flags["acks-extras"].itemRun, false, "untimed");
  } finally {
    gameStub.user = { isGM: true };
    globalThis.Roll = priorRoll;
    delete subjects["T.s1"];
    unstage();
  }
});

await t("a blank lasts refuses a press from any seat but the Judge's own, and a row that names none is not asked", () => {
  const world = { item: {}, row: {}, subjectOwnerIds: ["u1"], target: 10 };
  const ask = (over = {}, req = {}) => logic.checkPressRequest({ total: 12, target: 10, ...req }, { ...world, ...over });
  assert.equal(ask({ blankLasts: true, judge: false }).reason, "noFigure");
  assert.equal(ask({ blankLasts: true }).reason, "noFigure", "a seat the world does not say is a Judge's");
  assert.equal(ask({ blankLasts: true, judge: true }).ok, true, "the Judge's own seat goes through");
  assert.equal(ask({ blankLasts: false }).ok, true);
  assert.equal(ask({ blankLasts: true, judge: true }, { requestUserId: "u2" }).reason, "notOwner", "ownership is asked first");
  const lastsOf = (reach) => { const f = logic.reachFigures({ reach }); return [f.lasts, f.lastsNamed]; };
  // A declared press (the Judge's call on a card that names no save): no total, no target, only the Judge's seat.
  const declare = (declared, over = {}, req = {}) => logic.checkPressRequest({ declared, ...req }, { ...world, target: null, ...over });
  assert.deepEqual(declare(true, { judge: true }), { ok: true, total: null, target: null, saved: true, early: false, declared: true }, "a passed call");
  assert.deepEqual(declare(false, { judge: true }), { ok: true, total: null, target: null, saved: false, early: false, declared: true }, "a failed call is a verdict, not an absence");
  assert.equal(declare(true).reason, "judgeOnly", "a seat the world does not say is a Judge's");
  assert.equal(declare(false, { judge: false }).reason, "judgeOnly", "a player's seat cannot declare");
  assert.equal(declare(true, { judge: true, waiting: true }).early, true, "a waiting subject goes through early, as a rolled press does");
  assert.equal(declare(true, { judge: true }, { requestUserId: "u2" }).reason, "notOwner", "ownership is asked first");
  assert.equal(declare(true, { judge: true, entryState: "applied" }).reason, "applied", "an entry already written stays written");
  assert.equal(declare(true, { judge: true, struck: true }).reason, "struck");
  assert.equal(declare(true, { judge: true, item: null }).reason, "gone");
  assert.equal(declare(true, { judge: true, row: null }).reason, "noRow");
  assert.equal(logic.checkPressRequest({ total: 12, target: 10 }, { ...world, judge: true }).declared, undefined, "an ordinary rolled press is not declared");
  assert.deepEqual(lastsOf({ pulse: "turnStart+enter", lasts: { value: "3" } }), [3, true]);
  assert.deepEqual(lastsOf({ pulse: "action", lasts: {} }), [null, false], "an emptied reference names none");
  assert.deepEqual(lastsOf({ pulse: "action", lasts: { value: "x" } }), [null, true], "a figure named and unresolved is a blank");
  assert.deepEqual(lastsOf({ pulse: "action" }), [null, false], "a row with no lasts at all");
});

await t("lowering lifts the activation's conditions and leaves the immunity window, and the world clock lifts the window once it is due", async () => {
  stage();
  seatOf(true);
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const priorRandom = globalThis.foundry.utils.randomID;
  let minted = 0;
  globalThis.foundry.utils.randomID = () => `card-${++minted}`;
  const store = [];
  const actor = monster(["alpha"], store);
  actor.createEmbeddedDocuments = async (kind, records) => records.map((r, i) => { const rec = { id: `E${store.length}`, flags: r.flags }; store.push(rec); return rec; });
  const dels = [];
  actor.deleteEmbeddedDocuments = async (kind, ids, options) => { dels.push([ids, options]); ids.forEach((id) => store.splice(store.findIndex((e) => e.id === id), 1)); };
  subjects["T.s1"] = { id: "s1", uuid: "T.s1", actor, testUserPermission: () => true };
  const target = saveSpec(actor, "paralysis").target;
  const row = { key: "k", target: "paralysis", conditions: ["held"], reach: { pulse: "action", radius: { value: "5" }, immunity: { value: "2" } } };
  itemFlags = { cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [row] } };
  const press = (total) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "k", activationId: "act", subject: "T.s1", total, target });
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  try {
    await press(target - 1);
    await press(target);
    assert.equal(store.length, 2, "a failure's condition and a pass's window");
    gameStub.actors = [actor];
    gameStub.scenes = [];
    await run.liftActivation({ config: { activationId: "act", sourceUuid: "I.none" } });
    assert.deepEqual(dels, [[["E0"], managedDelete()]], "only the condition, which carries the activation's id");
    assert.deepEqual(store.map((e) => e.id), ["E1"], "the window stays");
    dels.length = 0;
    assert.deepEqual(await run.liftDueRecords([actor], 1199), [], "not due yet");
    assert.deepEqual(await run.liftDueRecords([actor], 1200), ["E1"], "due at the moment itself");
    assert.deepEqual(dels, [[["E1"], managedDelete()]], "a managed delete");
    assert.deepEqual(store, []);
    assert.deepEqual(await run.liftDueRecords([actor, null], 99999), [], "nothing left to lift, and a missing actor is passed over");
    // The installed clock hook reaches the same lift: a window written now ends when the world clock does.
    await press(target);
    assert.equal(store.length, 1);
    hooked.updateWorldTime[0](1199, 10);
    await settle();
    assert.equal(store.length, 1, "the clock has not reached it");
    hooked.updateWorldTime[0](1200, 10);
    await settle();
    assert.equal(store.length, 0, "the world clock's advance lifts the due window");
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    globalThis.foundry.utils.randomID = priorRandom;
    delete subjects["T.s1"];
    unstage();
  }
});

await t("a press is thrown on the presser's seat: the Judge's runs here with the row's window, a Player's relays, and a row with no save or a subject with no actor throws nothing", async () => {
  stage();
  seatOf(true);
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const created = [];
  const actor = monster(["alpha"]);
  actor.createEmbeddedDocuments = async (kind, records) => { created.push(records); return records.map((_, i) => ({ id: `E${i}` })); };
  subjects["T.s1"] = { id: "s1", uuid: "T.s1", actor, testUserPermission: () => true };
  const target = saveSpec(actor, "paralysis").target;
  itemFlags = { cookbook: { id: "kindX" }, itemRun: { activation: { kind: "once" }, rows: [{ key: "k", target: "paralysis", conditions: ["held"], reach: { pulse: "action", immunity: { value: "2" } } }, { key: "bare", reach: { pulse: "action" } }] } };
  const priorRoll = globalThis.Roll;
  let thrown = 0;
  globalThis.Roll = class { async evaluate() { return { total: thrown }; } };
  const base = { itemUuid: "I.1", rowKey: "k", activationId: "act", subject: "T.s1" };
  try {
    thrown = target - 1;
    const failed = await run.pressRoll(base);
    assert.equal(failed.ok, true);
    assert.equal(failed.entry.total, target - 1, "the total thrown here");
    assert.equal(failed.entry.target, target, "against the target read here");
    assert.equal(failed.saved, false);
    thrown = target;
    created.length = 0;
    const passed2 = await run.pressRoll({ ...base, window: () => ({ name: "Forged", duration: { seconds: 5 } }) });
    assert.equal(passed2.saved, true);
    assert.equal(created[0][0].flags["acks-extras"].itemRun.dueAt, 1200, "the window is the row's own figure, never a callback of the caller's");
    assert.deepEqual(await run.pressRoll({ ...base, rowKey: "bare" }), { ok: false, reason: "noFigure" }, "a row naming no save");
    assert.deepEqual(await run.pressRoll({ ...base, subject: "T.none" }), { ok: false, reason: "noFigure" }, "a subject with no actor");
    assert.deepEqual(await run.pressRoll({ ...base, rowKey: "none" }), { ok: false, reason: "noFigure" });
    created.length = 0;
    gameStub.user = { isGM: false };
    seatOf(false);
    subjects["T.s2"] = { id: "s2", uuid: "T.s2", actor: { ...monster(["alpha"]), system: { details: { class: "" }, saves: {} } }, testUserPermission: () => true };
    assert.deepEqual(await run.pressRoll({ ...base, subject: "T.s2" }), { ok: false, reason: "noFigure" }, "a throw with no target is refused on the seat, before anything is relayed");
    assert.deepEqual(await run.pressRoll(base), { ok: false, reason: "relay" }, "a Player's seat with no Judge seated");
    assert.deepEqual(created, [], "and writes nothing");
  } finally {
    gameStub.user = { isGM: true };
    globalThis.Roll = priorRoll;
    delete subjects["T.s1"];
    delete subjects["T.s2"];
    unstage();
  }
});

await t("an Undo needs a subject with an actor and takes no delete where the row stored no ids", async () => {
  seatOf(true);
  const deletes = [];
  const actor = { effects: [{ id: "a" }], deleteEmbeddedDocuments: async (...args) => deletes.push(args) };
  globalThis.fromUuidSync = (uuid) => (uuid === "T.1" ? { actor } : null);
  try {
    assert.deepEqual(await run.undoEntry({ subject: "T.none", entry: { recordIds: ["a"] } }), { ok: false, removed: [] });
    assert.deepEqual(await run.undoEntry({ subject: "T.1", entry: { recordIds: ["gone"] } }), { ok: true, removed: [] });
    assert.deepEqual(await run.undoEntry({ subject: "T.1", entry: {} }), { ok: true, removed: [] });
    assert.equal(deletes.length, 0, "no stored id still on the subject, no delete");
    const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
    await run.undoEntry({ subject: "T.1", entry: { recordIds: ["a"] } });
    assert.deepEqual(deletes[0], ["ActiveEffect", ["a"], managedDelete()], "a managed delete");
  } finally {
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? theItem : uuid === "T.1" ? bearerTok : subjects[uuid] ?? null);
  }
});

await t("a reach's moment: a standing part comes off at an exit by the kind's key, every other act reaches the presenter, and a subject with no actor is passed over", async () => {
  seatOf(true);
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const { standingPartId } = logic;
  const item = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindX" } } } };
  const row = { key: "k" };
  const dels = [];
  const held = new Set([standingPartId("kindX")]);
  const actorOf = (effects = []) => ({ effects: Object.assign([...effects], { get: (id) => (held.has(id) ? { id } : undefined) }), deleteEmbeddedDocuments: async (...args) => dels.push(args) });
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const config = { activationId: "act" };
  const moment = (pulse, momentName, admitted, subject) => run.handleReachMoment({ moment: momentName, config, item, row, reach: { pulse }, subject, admitted });
  try {
    await moment("standing", "exit", false, { actor: actorOf() });
    assert.deepEqual(dels, [["ActiveEffect", [standingPartId("kindX")], managedDelete()]], "the kind's part, deleted as a managed delete");
    assert.deepEqual(seen, [], "an exit that takes a part off presents nothing");
    held.clear();
    dels.length = 0;
    await moment("standing", "exit", true, { actor: actorOf() });
    assert.deepEqual(dels, [], "no part, no delete");
    held.add(standingPartId("row-key-is-not-it"));
    await moment("standing", "exit", true, { actor: actorOf() });
    assert.deepEqual(dels, [], "the row's key names no part");
    const subject = { actor: actorOf() };
    await moment("standing", "enter", true, subject);
    assert.deepEqual(seen, [], "a standing part is written by the carrier itself and presents nothing (tools/test-gear-run.mjs holds the write)");
    await moment("standing", "moveIn", true, subject);
    assert.deepEqual(seen, [], "a moment its pulse does not hear");
    await moment("turnStart+moveIn", "turnStart", null, subject);
    assert.equal(seen.at(-1).act, "undetermined");
    await moment("turnStart+moveIn", "turnStart", true, subject);
    assert.equal(seen.at(-1).act, "prompt");
    seen.length = 0;
    await moment("turnStart+moveIn", "turnStart", true, { actor: null });
    await moment("standing", "enter", true, { actor: null });
    assert.deepEqual(seen, [], "a subject with no actor");
  } finally {
    run.setUsePresenter(async (result) => presented.push(result));
  }
});

await t("a turnStart+enter reach asks a body that walks in only while it is that body's own turn in a begun fight, and every other pulse ignores the turn", async () => {
  seatOf(true);
  const item = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindE" } } } };
  const row = { key: "k" };
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const actorOf = () => ({ effects: Object.assign([], { get: () => undefined }), deleteEmbeddedDocuments: async () => [] });
  const walker = (n) => ({ actor: actorOf(), token: { id: `w${n}`, uuid: `T.w${n}` } });
  const enter = (pulse, subject, admitted = true) => run.handleReachMoment({ moment: "enter", config: { activationId: "act" }, item, row, reach: { pulse }, subject, admitted });
  const priorCombat = gameStub.combat;
  try {
    gameStub.combat = { id: "cE", started: true, round: 1, turn: 0, combatant: { tokenId: "w1" } };
    assert.equal(await enter("turnStart+enter", walker(1)), "prompt", "the combatant whose turn it is, walking in");
    assert.equal(seen.at(-1).act, "prompt");
    seen.length = 0;
    assert.equal(await enter("turnStart+enter", walker(2)), null, "a body that walks in on another's turn waits for its own");
    assert.deepEqual(seen, []);
    gameStub.combat = { id: "cE", started: false, round: 1, turn: 0, combatant: { tokenId: "w3" } };
    assert.equal(await enter("turnStart+enter", walker(3)), null, "a fight not begun has no turn");
    gameStub.combat = null;
    assert.equal(await enter("turnStart+enter", walker(4)), null, "no fight, no turn");
    gameStub.combat = { id: "cE", started: true, round: 1, turn: 0, combatant: {} };
    assert.equal(await enter("turnStart+enter", { actor: actorOf(), token: { uuid: "T.w5" } }), null, "a subject whose token carries no id is no one's turn");
    gameStub.combat = { id: "cE", started: true, round: 1, turn: 0, combatant: { tokenId: "other" } };
    assert.equal(await enter("turnStart+moveIn", walker(6)), "list", "the other pulse reads no turn: another body's turn");
    gameStub.combat = null;
    assert.equal(await enter("turnStart+moveIn", walker(7)), "list", "nor a missing fight");
  } finally {
    gameStub.combat = priorCombat;
    run.setUsePresenter(async (result) => presented.push(result));
  }
});

await t("a lowered activation's records come off every actor that holds one, by the managed delete, and the item's state clears only where it is that activation's", async () => {
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const dels = [];
  const rec = (id, activationId) => ({ id, flags: { "acks-extras": activationId ? { itemRun: { activationId } } : {} } });
  const holderOf = (effects) => ({ effects, deleteEmbeddedDocuments: async (...args) => dels.push(args) });
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  gameStub.actors = [holderOf([rec("e1", "act1"), rec("e2", "act2"), rec("e3")]), holderOf([rec("e4", "act9")])];
  gameStub.scenes = [{ tokens: [{ actorLink: false, actor: holderOf([rec("e5", "act1")]) }, { actorLink: true, actor: holderOf([rec("e6", "act1")]) }] }];
  updates.length = 0;
  try {
    itemFlags = toggleFlags({ active: true, activationId: "act1", regionId: "r1" });
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
    assert.deepEqual(dels, [["ActiveEffect", ["e1"], managedDelete()], ["ActiveEffect", ["e5"], managedDelete()]], "each holder's own records, never one with no record and never a linked token's actor twice");
    assert.deepEqual(updates, [{ "flags.acks-extras.itemRun.activation.state": { active: false, activationId: "", regionId: "" } }]);
    updates.length = 0;
    itemFlags = toggleFlags({ active: true, activationId: "act2", regionId: "r2" });
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
    assert.deepEqual(updates, [], "another activation's state stands");
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.none" } });
    assert.deepEqual(updates, [], "an item that is gone");
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
  }
});

await t("an always-on item's lowered Region scans no actor, while a toggle item's records are still lifted and a deleted toggle item's too", async () => {
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const dels = [];
  const rec = (id, activationId) => ({ id, flags: { "acks-extras": { itemRun: { activationId } } } });
  const holderOf = (effects) => ({ effects, deleteEmbeddedDocuments: async (...args) => dels.push(args) });
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  gameStub.actors = [holderOf([rec("e1", "act1")])];
  gameStub.scenes = [];
  const lift = () => run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
  try {
    itemFlags = { itemRun: { rows: rowsToggle } };
    await lift();
    assert.deepEqual(dels, [], "the source resolves and has no activation: no world scan, no record touched");
    itemFlags = toggleFlags({ active: true, activationId: "act1", regionId: "r1" });
    await lift();
    assert.deepEqual(dels, [["ActiveEffect", ["e1"], managedDelete()]], "a toggle item's records go as before");
    dels.length = 0;
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.none" } });
    assert.deepEqual(dels, [["ActiveEffect", ["e1"], managedDelete()]], "a deleted toggle item does not resolve, so its records are still lifted");
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    itemFlags = {};
  }
});

await t("a lowering re-offers the subject's other reaches to every token the actor stands as, a linked token on a scene nobody views included", async () => {
  seatOf(true);
  const aura = await import("../scripts/lib/aura-reach.mjs");
  const heard = [];
  aura.setReachHandler(async (ctx) => heard.push([ctx.subject.token.uuid, ctx.moment, ctx.config.activationId]));
  const actor = { id: "A.9", uuid: "Actor.A9", isToken: false, effects: [{ id: "e1", flags: { "acks-extras": { itemRun: { activationId: "act1" } } } }], getActiveTokens: () => [], deleteEmbeddedDocuments: async () => [] };
  const bearerOnFar = { id: "B2", uuid: "Far.B2", actor: monster(["alpha"]) };
  const region = { id: "R2", hidden: false, attachment: { token: "B2" }, behaviors: [{ type: AURA, system: { sourceUuid: "I.1", bearerUuid: "A.1", activationId: "act2", rowKey: "t" } }] };
  const far = { tokens: { get: (id) => (id === "B2" ? bearerOnFar : undefined) }, regions: [region] };
  region.parent = far;
  const linked = { actorLink: true, actorId: "A.9", id: "T9", uuid: "Far.T9", actor, parent: far, regions: new Set([region]) };
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  gameStub.actors = [actor];
  gameStub.scenes = [{ tokens: [linked] }];
  itemFlags = toggleFlags(down);
  try {
    assert.deepEqual(run.tokensOfActor(actor).map((tok) => tok.uuid), ["Far.T9"], "the viewed canvas holds none; the linked token is found on its own scene");
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
    assert.deepEqual(heard, [["Far.T9", "enter", "act2"]], "the other activation's reach hears the subject enter, on a scene the window does not view");
    const sameOnCanvas = { ...linked, uuid: "Far.T9" };
    actor.getActiveTokens = () => [sameOnCanvas];
    assert.equal(run.tokensOfActor(actor).length, 1, "a token on the canvas and linked is one token");
    assert.deepEqual(run.tokensOfActor({ isToken: true, token: { uuid: "S.T" } }).map((tok) => tok.uuid), ["S.T"], "a synthetic actor is its own token");
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    aura.setReachHandler(run.handleReachMoment);
  }
});

await t("a once-only use with no save writes the row's save narrowing onto the part it hands each subject", async () => {
  stage();
  seatOf(true);
  presented.length = 0;
  const written = [];
  try {
    const subject = { id: "s1", uuid: "T.s1", name: "Tok s1", flags: { "acks-extras": {} }, disposition: -1, actor: { ...monster(["alpha"]), createEmbeddedDocuments: async (kind, data) => { written.push(...data); return data.map((_, i) => ({ id: `e${i}` })); } }, testInsideRegion: () => true };
    subjects["T.s1"] = subject;
    const area = sceneOf([bearerTok, subject]);
    bearerTok.parent = area;
    bearerTok.testInsideRegion = () => true;
    const reach = { pulse: "action", radius: { value: "15" }, on: ["save", "attack"], modifier: { value: "2" }, filter: {} };
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "k", reach: { ...reach, saveWhen: { when: "Fear", magical: true } } }] } };
    const out = await run.runUse({ itemUuid: "I.1" });
    assert.equal(out.ok, true);
    assert.deepEqual(written[0].flags["acks-extras"].rollMods.parts, [{ on: "save", value: 2, when: "fear", magical: true }, { on: "attack", value: 2 }], "the save part alone carries the narrowing, the circumstance word lowercased");
    written.length = 0;
    itemFlags = { itemRun: { activation: { kind: "once" }, rows: [{ key: "k", reach }] } };
    await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual(written[0].flags["acks-extras"].rollMods.parts, [{ on: "save", value: 2 }, { on: "attack", value: 2 }], "no narrowing, none written");
  } finally {
    delete subjects["T.s1"];
    bearerTok.parent = null;
    delete bearerTok.testInsideRegion;
    unstage();
  }
});

await t("a prompt is held under its moment key, so a subject is asked once, and a list, a refusal and an exit reach the presenter without asking", async () => {
  seatOf(true);
  const item = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindX" } } } };
  const row = { key: "k" };
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const aura = await import("../scripts/lib/aura-reach.mjs");
  const actorOf = (type = "monster") => ({ documentName: "Actor", type, effects: Object.assign([], { get: () => undefined }), deleteEmbeddedDocuments: async () => [] });
  const body = (uuid, type) => ({ token: { uuid }, actor: actorOf(type) });
  const moment = (pulse, momentName, admitted, subject) => run.handleReachMoment({ moment: momentName, config: { activationId: "act" }, item, row, reach: { pulse }, subject, admitted });
  try {
    const one = body("T.p1");
    assert.equal(await moment("turnStart+moveIn", "moveIn", true, one), "prompt");
    assert.equal(seen.at(-1).momentKey, "T.p1:kindX", "outside a fight the key is the subject and the kind");
    assert.equal(await moment("turnStart+moveIn", "turnStart", true, one), "held", "asked once for this kind");
    assert.equal(seen.length, 1);
    assert.equal(await moment("turnStart+moveIn", "turnStart", true, body("T.p2")), "prompt", "another subject");
    aura.releaseReachMoment("T.p1:kindX");
    assert.equal(await moment("turnStart+moveIn", "moveIn", true, one), "prompt", "answered, it asks again");
    gameStub.combat = { id: "c1", round: 2, turn: 3, started: true };
    assert.equal(await moment("turnStart+moveIn", "turnStart", true, body("T.p3")), "prompt");
    assert.equal(seen.at(-1).momentKey, "c1:2:3:T.p3:kindX", "inside a fight, the initiative too");
    gameStub.combat = null;
    seen.length = 0;
    assert.equal(await moment("turnStart+moveIn", "enter", true, body("T.l1")), "list");
    assert.equal(await moment("turnStart+moveIn", "enter", false, body("T.l2")), "refuse");
    assert.equal(await moment("turnStart+moveIn", "enter", false, body("T.l3", "acks-extras.faction")), null, "a marker is no row, not even a refused one");
    assert.equal(await moment("turnStart+moveIn", "exit", true, body("T.l1")), "out");
    assert.deepEqual(seen.map((r) => r.act), ["list", "refuse", "out"]);
    assert.equal(seen.some((r) => r.momentKey), false, "nothing but a prompt is keyed");
  } finally {
    for (const key of ["T.p1:kindX", "T.p2:kindX", "c1:2:3:T.p3:kindX"]) aura.releaseReachMoment(key);
    gameStub.combat = null;
    run.setUsePresenter(async (result) => presented.push(result));
  }
});

await t("a lowering hands a condition on to another raised reach of the same item kind that still holds its subject, and deletes it otherwise", async () => {
  seatOf(true);
  const aura = await import("../scripts/lib/aura-reach.mjs");
  aura.setReachHandler(async () => null);
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const deletes = [];
  const edits = [];
  const effect = { id: "e1", flags: { "acks-extras": { itemRun: { source: "I.1", activationId: "act1", rowKey: "t" } } }, update: async (data, options) => edits.push([data, options]) };
  const actor = { id: "A.8", uuid: "Actor.A8", isToken: false, effects: [effect], getActiveTokens: () => [], deleteEmbeddedDocuments: async (...args) => deletes.push(args) };
  const otherRegion = { id: "R2", hidden: false, attachment: { token: "B" }, behaviors: [{ type: AURA, system: { sourceUuid: "I.1", bearerUuid: "A.2", activationId: "act2", rowKey: "t" } }] };
  const scene = { regions: [otherRegion], tokens: { get: () => ({ id: "B", actor: monster(["alpha"]) }) } };
  otherRegion.parent = scene;
  const token = { actorLink: true, actorId: "A.8", id: "T8", uuid: "S.T8", actor, parent: scene, regions: new Set([otherRegion]) };
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  gameStub.actors = [actor];
  gameStub.scenes = [{ tokens: [token] }];
  itemFlags = { cookbook: { id: "kindX" }, ...toggleFlags(down) };
  try {
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
    assert.deepEqual(deletes, [], "still inside another reach of the kind: the condition stays");
    assert.deepEqual(edits[0][0]["flags.acks-extras.itemRun"], { source: "I.1", activationId: "act2", rowKey: "t" }, "retargeted to the reach that still holds it");
    assert.deepEqual(edits[0][1], managedDelete(), "as a managed edit");
    token.regions = new Set();
    edits.length = 0;
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.1" } });
    assert.deepEqual(deletes, [["ActiveEffect", ["e1"], managedDelete()]], "inside no other reach: deleted");
    assert.deepEqual(edits, []);
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    aura.setReachHandler(run.handleReachMoment);
  }
});

await t("a bearer counted into its own standing reach keeps its part when it leaves, or its host lowers, another bearer's reach of the same kind, and a bearer counted out or a lowering of its own reach does not", async () => {
  seatOf(true);
  const aura = await import("../scripts/lib/aura-reach.mjs");
  aura.setReachHandler(async () => null);
  const partId = logic.standingPartId("kindK");
  const rowOf = (self) => ({ key: "s", reach: { pulse: "standing", radius: { value: "10" }, modifier: { value: "-1" }, on: ["morale"], filter: { self } } });
  const itemOf = (uuid, activationId, self) => ({ uuid, name: `Gear ${uuid}`, type: "item", update: async () => {}, flags: { "acks-extras": { cookbook: { id: "kindK" }, itemRun: { activation: { kind: "toggle", state: { active: true, activationId, regionId: `R.${uuid}` } }, rows: [rowOf(self)] } } } });
  const held = (actor) => actor.effects.get(partId);
  const stageBearer = (self) => {
    const own = itemOf("I.k1", "act1", self);
    const host = itemOf("I.k2", "act2", "no");
    const effects = Object.assign([], { get: (id) => effects.find((e) => e.id === id) });
    const actor = {
      id: "A.k1", uuid: "Actor.Ak1", isToken: false, items: [own], effects, getActiveTokens: () => [],
      createEmbeddedDocuments: async (kind, data) => data.map((d) => { const e = { ...d, id: d._id, update: async (u) => { if (u.flags) e.flags = u.flags; if (u["flags.acks-extras.itemRun"]) e.flags["acks-extras"].itemRun = u["flags.acks-extras.itemRun"]; } }; effects.push(e); return e; }),
      deleteEmbeddedDocuments: async (kind, ids) => { for (const id of ids) effects.splice(effects.findIndex((e) => e.id === id), 1); },
    };
    const region = { id: "R2", hidden: false, attachment: { token: "B2" }, behaviors: [{ type: AURA, system: { sourceUuid: "I.k2", bearerUuid: "A.k2", activationId: "act2", rowKey: "s" } }] };
    const scene = { regions: [region], tokens: { get: () => undefined } };
    region.parent = scene;
    const token = { actorLink: true, actorId: "A.k1", id: "Tk1", uuid: "S.Tk1", actor, parent: scene, regions: new Set([region]) };
    return { own, host, actor, region, token };
  };
  const priorFrom = globalThis.fromUuidSync;
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  let world = null;
  globalThis.fromUuidSync = (uuid) => (uuid === "I.k1" ? world.own : uuid === "I.k2" ? world.host : priorFrom(uuid));
  const enterHost = async () => { await run.holdStanding({ config: { activationId: "act2" }, item: world.host, row: world.host.flags["acks-extras"].itemRun.rows[0], subject: { token: world.token, actor: world.actor } }); };
  const leaveHost = async () => {
    world.token.regions = new Set();
    await run.releaseStanding({ item: world.host, row: world.host.flags["acks-extras"].itemRun.rows[0], subject: { token: world.token, actor: world.actor }, region: world.region });
  };
  const lift = () => run.liftActivation({ config: { activationId: "act2", sourceUuid: "I.k2" } });
  const from = (self) => {
    world = stageBearer(self);
    gameStub.actors = [world.actor];
    gameStub.scenes = [{ tokens: [world.token] }];
  };
  const activationOf = (actor) => held(actor)?.flags["acks-extras"].itemRun.activationId ?? null;
  try {
    from("count");
    await world.actor.createEmbeddedDocuments("ActiveEffect", [logic.standingPartRecordData({ kindKey: "kindK", name: world.own.name, parts: [{ on: "morale", value: -1 }], source: "I.k1", activationId: "act1", rowKey: "s" })]);
    await enterHost();
    assert.equal(activationOf(world.actor), "act2", "inside the other reach, the record is the other reach's");
    await leaveHost();
    assert.equal(activationOf(world.actor), "act1", "leaving it, the record goes back to the bearer's own counted reach");
    assert.equal(held(world.actor).flags["acks-extras"].itemRun.source, "I.k1");

    from("count");
    await world.actor.createEmbeddedDocuments("ActiveEffect", [logic.standingPartRecordData({ kindKey: "kindK", name: world.own.name, parts: [{ on: "morale", value: -1 }], source: "I.k1", activationId: "act1", rowKey: "s" })]);
    await enterHost();
    await lift();
    assert.equal(activationOf(world.actor), "act1", "the other reach lowered while the bearer is inside it, the record goes back to the bearer's own counted reach");
    assert.equal(held(world.actor).flags["acks-extras"].itemRun.source, "I.k1");

    from("no");
    await world.actor.createEmbeddedDocuments("ActiveEffect", [logic.standingPartRecordData({ kindKey: "kindK", name: world.own.name, parts: [{ on: "morale", value: -1 }], source: "I.k1", activationId: "act1", rowKey: "s" })]);
    await enterHost();
    await leaveHost();
    assert.equal(held(world.actor), undefined, "a bearer its own filter does not count has no own reach to fall back to");
    await enterHost();
    await lift();
    assert.equal(held(world.actor), undefined, "nor when the other reach lowers");

    from("count");
    await world.actor.createEmbeddedDocuments("ActiveEffect", [logic.standingPartRecordData({ kindKey: "kindK", name: world.own.name, parts: [{ on: "morale", value: -1 }], source: "I.k1", activationId: "act1", rowKey: "s" })]);
    world.token.regions = new Set();
    await run.liftActivation({ config: { activationId: "act1", sourceUuid: "I.k1" } });
    assert.equal(held(world.actor), undefined, "the bearer's own reach lowered is no candidate for the record it held");
  } finally {
    globalThis.fromUuidSync = priorFrom;
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    aura.setReachHandler(run.handleReachMoment);
  }
});

await t("a lifted activation is told to its listener, and one that throws spares the rest", async () => {
  seatOf(true);
  const heard = [];
  run.onActivationLifted((config) => heard.push(config.activationId));
  let broken = true;
  run.onActivationLifted(() => { if (broken) throw new Error("listener broke"); });
  run.onActivationLifted((config) => heard.push(`${config.activationId}!`));
  const priorActors = gameStub.actors;
  gameStub.actors = [];
  gameStub.scenes = [];
  itemFlags = toggleFlags(down);
  try {
    await quiet(() => run.liftActivation({ config: { activationId: "actL", sourceUuid: "I.1" } }));
    assert.deepEqual(heard, ["actL", "actL!"]);
  } finally {
    broken = false;
    gameStub.actors = priorActors;
  }
});

await t("counting the bearer in writes the item's self filter for an owner of the item, once, and an Undo marks exactly its entry undone for a Judge", async () => {
  stage();
  seatOf(true);
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const message = {
    flags: { "acks-extras": { itemRunCard: { itemUuid: "I.1", rowKey: "t", activationId: "act", bearer: { uuid: "T.1", name: "Bearer" }, selfCount: false, subjects: {}, entries: { k1: { subject: "T.s1", state: "applied", recordIds: ["E1"] }, k2: { subject: "T.s1", state: "open" } } } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) {
      const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
      this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
    },
  };
  const card = () => message.flags["acks-extras"].itemRunCard;
  gameStub.messages = { get: (id) => (id === "M9" ? message : null) };
  const heard = [];
  run.setPressListener((e) => heard.push([e.key, e.counted === true, e.undone === true]));
  const owned = new Set(["owner"]);
  const priorPerm = theItem.testUserPermission;
  theItem.testUserPermission = (user) => owned.has(user?.id);
  seatOf(true, [{ id: "owner" }, { id: "other" }, { id: "presser" }, { id: "bodyOwner" }]);
  itemFlags = toggleFlags(down);
  updates.length = 0;
  try {
    const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
    const tick = (over = {}) => executeAsGM("acks-extras.itemRun.tick", { itemUuid: "I.1", rowKey: "t", messageId: "M9", ...over });
    assert.equal((await tick({ requestUserId: "other" })).reason, "notOwner", "a seat that does not own the item is refused, whatever its role");
    assert.deepEqual(updates, []);
    assert.equal((await tick({ requestUserId: "owner", rowKey: "none" })).reason, "noRow");
    assert.equal((await tick({ requestUserId: "owner" })).ok, true);
    assert.equal(updates[0]["flags.acks-extras.itemRun.rows"].find((r) => r.key === "t").reach.filter.self, "count", "the item's own row carries the choice");
    assert.equal(updates[0]["flags.acks-extras.itemRun.rows"].find((r) => r.key === "a").reach.filter, undefined, "no other row is touched");
    assert.equal(card().selfCount, true);
    assert.equal(card().subjects["T~1"].state, "in", "the bearer is listed, waiting for its own turn start");
    itemFlags = toggleFlags(down, updates[0]["flags.acks-extras.itemRun.rows"]);
    assert.equal((await tick({ requestUserId: "owner" })).reason, "applied", "a second press is refused, read from the item's own filter");
    assert.deepEqual(heard.at(-1), ["", true, false]);
    // Count out: the same owners, the filter written back to `no`, the bearer's open entry struck and its row gone; lowering never resets it.
    const untick = (over = {}) => executeAsGM("acks-extras.itemRun.untick", { itemUuid: "I.1", rowKey: "t", messageId: "M9", ...over });
    card().entries.kb = { subject: "T.1", momentKey: "mk-b", state: "open" };
    card().subjects["T~1"].latest = "kb";
    updates.length = 0;
    assert.equal((await untick({ requestUserId: "other" })).reason, "notOwner", "a seat that does not own the item cannot count the bearer out, whatever its role");
    assert.deepEqual(updates, []);
    assert.equal((await untick({ requestUserId: "owner" })).ok, true);
    assert.equal(updates[0]["flags.acks-extras.itemRun.rows"].find((r) => r.key === "t").reach.filter.self, "no", "the item's own row takes the choice back");
    assert.deepEqual([card().selfCount, card().subjects["T~1"], card().entries.kb], [false, undefined, undefined], "the bearer's row and its open prompt are gone");
    assert.deepEqual(heard.at(-1), ["", false, false]);
    itemFlags = toggleFlags(down, updates[0]["flags.acks-extras.itemRun.rows"]);
    assert.equal((await untick({ requestUserId: "owner" })).reason, "applied", "counted out twice is refused");
    itemFlags = toggleFlags(down, rowsToggle);
    updates.length = 0;
    assert.equal((await tick({ requestUserId: "owner" })).ok, true, "and the tick still works after it");
    // Undo: the Judge's seat, an applied entry, exactly its records.
    const dels = [];
    const holder = { effects: [{ id: "E1" }, { id: "E2" }], deleteEmbeddedDocuments: async (...args) => dels.push(args) };
    subjects["T.s1"] = { actor: holder, testUserPermission: () => false };
    subjects["T.s1"] = { actor: holder, testUserPermission: (user) => user?.id === "bodyOwner" };
    card().entries.k1.presser = "presser";
    const undo = (over = {}) => executeAsGM("acks-extras.itemRun.undo", { messageId: "M9", entryKey: "k1", ...over });
    assert.equal((await undo({ requestUserId: "other" })).reason, "notOwner", "a forged Undo from a seat that neither applied the entry nor owns the body is refused");
    assert.deepEqual(dels, [], "and writes nothing");
    card().entries.k2.presser = "presser"; assert.equal((await undo({ entryKey: "k2", requestUserId: "presser" })).reason, "applied", "an entry that is not applied has nothing to undo");
    assert.equal((await undo({ entryKey: "nope", requestUserId: "presser" })).reason, "gone");
    const undone = await undo({ requestUserId: "presser" });
    assert.deepEqual([undone.ok, undone.removed], [true, ["E1"]], "the seat that applied it undoes it, a Player included, through the GM's window");
    assert.deepEqual(dels[0].slice(0, 2), ["ActiveEffect", ["E1"]], "its own ids and nothing else");
    assert.deepEqual([card().entries.k1.state, card().entries.k1.recordIds], ["undone", []]);
    assert.equal(card().entries.k2.state, "open", "another entry is untouched");
    assert.equal((await undo({ requestUserId: "presser" })).reason, "applied", "a second Undo is refused");
    card().entries.k1 = { subject: "T.s1", state: "applied", recordIds: ["E2"], presser: "presser" };
    assert.equal((await undo({ requestUserId: "bodyOwner" })).ok, true, "an owner of the body, who did not apply it, may");
    assert.deepEqual(heard.at(-1), ["k1", false, true]);
  } finally {
    theItem.testUserPermission = priorPerm;
    delete gameStub.messages;
    delete subjects["T.s1"];
    run.setPressListener(null);
    gameStub.user = { isGM: true };
    unstage();
  }
});

await t("counting the bearer in under a standing reach holds its part on it under the card's activation and counting it out releases exactly that part, a prompting reach holds none, a blank figure refuses the count, and lowering lifts the part", async () => {
  stage();
  seatOf(true);
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const { managedDelete } = await import("../scripts/lib/managed-effects.mjs");
  const kept = new Map();
  const dels = [];
  const holderOf = () => ({
    effects: { get: (id) => kept.get(id), [Symbol.iterator]: () => kept.values() },
    createEmbeddedDocuments: async (kind, data) => { for (const d of data) kept.set(d._id, { ...d, id: d._id }); return data.map((d) => ({ id: d._id })); },
    deleteEmbeddedDocuments: async (kind, ids, options) => { dels.push([kind, ids, options]); for (const id of ids) kept.delete(id); },
  });
  const holder = holderOf();
  subjects["T.9"] = { uuid: "T.9", id: "9", name: "Carrier", actor: holder, testUserPermission: () => false };
  // Another body's part and an unrelated effect on the bearer: neither is the bearer's part.
  kept.set("other-part", { id: "other-part", flags: { "acks-extras": { itemRun: { activationId: "act9" } } } });
  kept.set("unrelated", { id: "unrelated", flags: {} });
  const message = {
    id: "M9",
    flags: { "acks-extras": { itemRunCard: { kind: "toggle", itemUuid: "I.1", rowKey: "s", activationId: "act9", regionUuid: "", bearer: { uuid: "T.9", name: "Carrier" }, selfCount: false, lowered: false, subjects: {}, undetermined: {}, counted: {}, entries: {} } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) {
      const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
      this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
    },
  };
  const card = () => message.flags["acks-extras"].itemRunCard;
  gameStub.messages = [message];
  gameStub.messages.get = (id) => (id === "M9" ? message : null);
  const priorPerm = theItem.testUserPermission;
  theItem.testUserPermission = (user) => user?.id === "owner";
  seatOf(true, [{ id: "owner" }, { id: "other" }]);
  const standing = (over = {}) => ({ key: "s", reach: { pulse: "standing", radius: { value: "10" }, modifier: { value: "-1" }, on: ["morale"], filter: {}, ...over } });
  const prompting = { key: "t", reach: { pulse: "turnStart+moveIn", radius: { value: "10" }, filter: {} } };
  itemFlags = toggleFlags(down, [standing(), prompting]);
  updates.length = 0;
  const priorActors = gameStub.actors;
  const priorScenes = gameStub.scenes;
  try {
    const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
    const press = (name, over = {}) => executeAsGM(`acks-extras.itemRun.${name}`, { itemUuid: "I.1", rowKey: "s", messageId: "M9", requestUserId: "owner", ...over });
    const partId = logic.standingPartId(logic.kindKeyOf(theItem, { key: "s" }));
    // A standing reach with no figure imported has no part to hold: nothing is counted and nothing is written.
    itemFlags = toggleFlags(down, [standing({ modifier: undefined })]);
    assert.equal((await press("tick")).reason, "noFigure", "a blank figure refuses the count");
    assert.deepEqual([updates, [...kept.keys()], card().selfCount, card().subjects], [[], ["other-part", "unrelated"], false, {}], "and writes nothing, to the item, the body or the card");
    // A lowered card holds nothing: the choice is kept for the next raise and no part is written for a reach that is down.
    itemFlags = toggleFlags(down, [standing(), prompting]);
    card().lowered = true;
    assert.equal((await press("tick")).ok, true);
    assert.deepEqual([updates.length, [...kept.keys()]], [1, ["other-part", "unrelated"]], "the item keeps the choice and the actor holds no part");
    card().lowered = false;
    card().selfCount = false;
    card().subjects = {};
    updates.length = 0;
    // Counted in: the part is held on the bearer under the card's activation, once.
    assert.equal((await press("tick")).ok, true);
    assert.deepEqual([...kept.keys()], ["other-part", "unrelated", partId], "the bearer's part is written beside what the actor already holds");
    assert.equal(kept.get(partId).flags["acks-extras"].itemRun.activationId, "act9", "under the raise's own activation, so lowering lifts it");
    assert.deepEqual([card().selfCount, card().subjects["T~9"].state], [true, "in"], "and the card lists the bearer");
    itemFlags = toggleFlags(down, updates[0]["flags.acks-extras.itemRun.rows"]);
    assert.equal((await press("tick")).reason, "applied", "a second press is refused");
    assert.deepEqual([...kept.keys()].filter((k) => k === partId).length, 1, "and holds no second part");
    // Counted out: exactly the bearer's part goes, by the managed delete; another body's part and an unrelated effect stay.
    assert.equal((await press("untick", { requestUserId: "other" })).reason, "notOwner");
    assert.deepEqual(dels, [], "a refused count out releases nothing");
    assert.equal((await press("untick")).ok, true);
    assert.deepEqual(dels, [["ActiveEffect", [partId], managedDelete()]], "the bearer's own part and nothing else");
    assert.deepEqual([...kept.keys()], ["other-part", "unrelated"]);
    assert.deepEqual([card().selfCount, card().subjects["T~9"]], [false, undefined]);
    // Counted in again, then the item is lowered: lowering lifts the part with the activation's other records and leaves the rest.
    itemFlags = toggleFlags(down, [standing(), prompting]);
    assert.equal((await press("tick")).ok, true);
    assert.ok(kept.has(partId), "held again");
    gameStub.actors = [holder];
    gameStub.scenes = [];
    dels.length = 0;
    await run.liftActivation({ config: { activationId: "act9", sourceUuid: "I.1" } });
    assert.deepEqual(dels, [["ActiveEffect", ["other-part", partId], managedDelete()]], "every record of the activation goes, the bearer's part among them");
    assert.deepEqual([...kept.keys()], ["unrelated"], "and an effect of no activation stays");
    gameStub.actors = priorActors;
    // A prompting reach keeps the bearer for its own turn start and holds no part.
    kept.clear();
    card().rowKey = "t";
    card().selfCount = false;
    card().subjects = {};
    itemFlags = toggleFlags(down, [standing(), prompting]);
    const promptPart = logic.standingPartId(logic.kindKeyOf(theItem, { key: "t" }));
    assert.equal((await press("tick", { rowKey: "t" })).ok, true);
    assert.deepEqual([[...kept.keys()], card().subjects["T~9"].state], [[], "in"], "a prompting reach is asked at its turn start and writes no part now");
    kept.set(promptPart, { id: promptPart, flags: { "acks-extras": { itemRun: { activationId: "act9" } } } });
    itemFlags = toggleFlags(down, updates.at(-1)["flags.acks-extras.itemRun.rows"]);
    assert.equal((await press("untick", { rowKey: "t" })).ok, true);
    assert.deepEqual([dels.slice(1), [...kept.keys()]], [[], [promptPart]], "and counting it out releases nothing, a record of that kind on the bearer staying");
  } finally {
    gameStub.actors = priorActors;
    gameStub.scenes = priorScenes;
    theItem.testUserPermission = priorPerm;
    delete subjects["T.9"];
    delete gameStub.messages;
    itemFlags = {};
    unstage();
  }
});

await t("counting an undetermined body in for a once-only use is an item owner's press: a use with no save writes its part under an applied entry, a use with a save leaves the Save open, and nothing is written to the item", async () => {
  stage();
  seatOf(true);
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const made = [];
  const holder = { effects: [], createEmbeddedDocuments: async (...args) => { made.push(args); return [{ id: "NEW1" }]; } };
  subjects["T.u1"] = { uuid: "T.u1", actor: holder, testUserPermission: (user) => user?.id === "bodyOwner" };
  const message = {
    flags: { "acks-extras": { itemRunCard: { kind: "once", direct: true, itemUuid: "I.1", rowKey: "d", activationId: "o1", bearer: { uuid: "", name: "" }, subjects: {}, undetermined: { "T~u1": { uuid: "T.u1", name: "Unsure" } }, entries: {} } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) {
      const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
      this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
    },
  };
  const card = () => message.flags["acks-extras"].itemRunCard;
  gameStub.messages = { get: (id) => (id === "M8" ? message : null) };
  const priorPerm = theItem.testUserPermission;
  theItem.testUserPermission = (user) => user?.id === "owner";
  seatOf(true, [{ id: "owner" }, { id: "other" }, { id: "bodyOwner" }]);
  itemFlags = toggleFlags(down, [{ key: "d", reach: { pulse: "action", radius: { value: "10" }, modifier: { value: "-1" }, on: ["morale"], filter: {} } }]);
  updates.length = 0;
  try {
    const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
    const tick = (over = {}) => executeAsGM("acks-extras.itemRun.tickSubject", { messageId: "M8", subject: "T.u1", ...over });
    assert.equal((await tick({ requestUserId: "bodyOwner" })).reason, "notOwner", "the owner of the body is not the owner of the item");
    assert.equal((await tick({ requestUserId: "other" })).reason, "notOwner");
    assert.deepEqual([made.length, Object.keys(card().undetermined)], [0, ["T~u1"]], "a refused press writes nothing");
    assert.equal((await tick({ requestUserId: "owner", subject: "T.zz" })).reason, "applied", "a body the card does not hold undetermined");
    assert.equal((await tick({ requestUserId: "owner" })).ok, true);
    assert.equal(made.length, 1, "the part's record is written on the body");
    assert.deepEqual([card().subjects["T~u1"].state, card().undetermined["T~u1"], card().entries["T~u1"].state, card().entries["T~u1"].recordIds], ["in", undefined, "applied", ["NEW1"]], "the body is a subject now, with an applied entry its Undo reads");
    assert.deepEqual(updates, [], "nothing is written to the item");
    assert.equal((await tick({ requestUserId: "owner" })).reason, "applied", "a second press is refused");
    // A use with a save: the body joins the subjects with its Save press open, and nothing is written.
    card().direct = false;
    card().undetermined = { "T~u2": { uuid: "T.u2", name: "Other" } };
    subjects["T.u2"] = { uuid: "T.u2", actor: holder, testUserPermission: () => false };
    made.length = 0;
    assert.equal((await tick({ requestUserId: "owner", subject: "T.u2" })).ok, true);
    assert.deepEqual([made.length, card().subjects["T~u2"].state, card().entries["T~u2"]], [0, "in", undefined], "no record is written and no entry opened: the press the card draws is the body's own Save");
    // A body holding the item's immunity is not counted in.
    card().direct = true;
    card().undetermined = { "T~u3": { uuid: "T.u3", name: "Immune" } };
    subjects["T.u3"] = { uuid: "T.u3", actor: { effects: [{ id: "I1", disabled: false, flags: { "acks-extras": { rollMods: { id: "t", label: "Gear", parts: [{ on: "immune", spells: ["d"] }] } } } }], appliedEffects: [{ id: "I1", disabled: false, flags: { "acks-extras": { rollMods: { id: "t", label: "Gear", parts: [{ on: "immune", spells: ["d"] }] } } } }], createEmbeddedDocuments: holder.createEmbeddedDocuments }, testUserPermission: () => false };
    assert.equal((await tick({ requestUserId: "owner", subject: "T.u3" })).reason, "immune", "a body holding the item's immunity is refused with its reason");
  } finally {
    theItem.testUserPermission = priorPerm;
    delete subjects["T.u1"]; delete subjects["T.u2"]; delete subjects["T.u3"];
    itemFlags = {};
    unstage();
  }
});

await t("counting an undetermined body in on a raised card is an item owner's press that outlasts no raise: the relay refuses a seat that does not own the item, a body the card does not hold, a body outside the Region and a lowered card, a standing reach writes its part once and a prompting reach keeps the body for its moments", async () => {
  stage();
  seatOf(true);
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const made = [];
  const holder = { effects: [], createEmbeddedDocuments: async (...args) => { made.push(args); return [{ id: "NEW1" }]; } };
  subjects["T.u1"] = { uuid: "T.u1", actor: holder, testUserPermission: (user) => user?.id === "bodyOwner" };
  subjects["S.R9"] = { tokens: [{ uuid: "T.u1" }] };
  const message = {
    id: "M9",
    flags: { "acks-extras": { itemRunCard: { kind: "toggle", itemUuid: "I.1", rowKey: "s", activationId: "act9", regionUuid: "S.R9", bearer: { uuid: "T.1", name: "Bearer" }, lowered: false, subjects: {}, undetermined: { "T~u1": { uuid: "T.u1", name: "Unsure" } }, counted: {}, entries: {} } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) {
      const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
      this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
    },
  };
  const card = () => message.flags["acks-extras"].itemRunCard;
  gameStub.messages = [message];
  gameStub.messages.get = (id) => (id === "M9" ? message : null);
  const priorPerm = theItem.testUserPermission;
  theItem.testUserPermission = (user) => user?.id === "owner";
  seatOf(true, [{ id: "owner" }, { id: "other" }, { id: "bodyOwner" }]);
  const standingRow = { key: "s", reach: { pulse: "standing", radius: { value: "10" }, modifier: { value: "-1" }, on: ["morale"], filter: {} } };
  itemFlags = toggleFlags(down, [standingRow, { key: "t", reach: { pulse: "turnStart+moveIn", radius: { value: "10" }, filter: {} } }]);
  updates.length = 0;
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  try {
    const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
    const tick = (over = {}) => executeAsGM("acks-extras.itemRun.tickSubject", { messageId: "M9", subject: "T.u1", ...over });
    assert.equal((await tick({ requestUserId: "bodyOwner" })).reason, "notOwner", "the owner of the body is not the owner of the item");
    assert.equal((await tick({ requestUserId: "other" })).reason, "notOwner", "a relayed press from a seat that owns neither is refused on the GM's window");
    assert.deepEqual([made.length, Object.keys(card().undetermined), card().counted], [0, ["T~u1"], {}], "a refused press writes nothing and counts nobody");
    assert.equal((await tick({ requestUserId: "owner", subject: "T.zz" })).reason, "applied", "a body the card does not hold undetermined, a not-target one included");
    // A body that left the Region is dropped from the list and refused.
    subjects["S.R9"].tokens = [];
    assert.equal((await tick({ requestUserId: "owner" })).reason, "gone", "a body outside the Region now is refused");
    assert.deepEqual([Object.keys(card().undetermined), made.length], [[], 0], "and it leaves the undetermined list with nothing written");
    subjects["S.R9"].tokens = [{ uuid: "T.u1" }];
    card().undetermined = { "T~u1": { uuid: "T.u1", name: "Unsure" } };
    // A lowered card counts nobody.
    card().lowered = true;
    assert.equal((await tick({ requestUserId: "owner" })).reason, "gone", "a lowered card is refused");
    card().lowered = false;
    // A standing reach with no figure imported has no part to hold: the body is not counted and nothing is written.
    const blank = itemFlags;
    itemFlags = toggleFlags(down, [{ key: "s", reach: { pulse: "standing", radius: { value: "10" }, on: ["morale"], filter: {} } }]);
    assert.equal((await tick({ requestUserId: "owner" })).reason, "noFigure", "a standing reach whose figure is blank refuses the count");
    assert.deepEqual([made.length, Object.keys(card().undetermined), card().counted], [0, ["T~u1"], {}], "with the body left undetermined");
    itemFlags = blank;
    // The standing reach writes its part on the body once, under the card's activation.
    assert.equal((await tick({ requestUserId: "owner" })).ok, true);
    assert.equal(made.length, 1, "the standing part is held on the body");
    assert.equal(made[0][1][0].flags["acks-extras"].itemRun.activationId, "act9", "under the raise's own activation, so lowering lifts it");
    assert.deepEqual([card().subjects["T~u1"].state, card().undetermined["T~u1"], card().counted["T~u1"].name], ["in", undefined, "Unsure"], "the body is listed in reach and recorded as counted");
    assert.deepEqual(updates, [], "nothing is written to the item");
    assert.equal((await tick({ requestUserId: "owner" })).reason, "applied", "a second press is refused");
    assert.equal(made.length, 1, "and writes no second record");
    // A prompting reach keeps the body for its moments and writes no part.
    card().rowKey = "t";
    card().undetermined = { "T~u1": { uuid: "T.u1", name: "Unsure" } };
    card().counted = {};
    card().subjects = {};
    made.length = 0;
    assert.equal((await tick({ requestUserId: "owner" })).ok, true);
    assert.deepEqual([made.length, card().subjects["T~u1"].state, card().entries["T~u1"]], [0, "in", undefined], "no record is written and nobody is asked now: the body is asked at its moment");
  } finally {
    theItem.testUserPermission = priorPerm;
    run.setUsePresenter(null);
    delete subjects["T.u1"]; delete subjects["S.R9"];
    delete gameStub.messages;
    itemFlags = {};
    unstage();
  }
});

await t("a body counted in is read as admitted at every later moment of its raise and by no other: a turn start prompts it, a standing entry holds its part and an exit lists it out, while a lowered card, another raise and a filter that settles the body leave it as the filter says", async () => {
  seatOf(true);
  const held = [];
  const holder = { effects: [], createEmbeddedDocuments: async (...args) => { held.push(args); return [{ id: "NEW1" }]; }, deleteEmbeddedDocuments: async () => {} };
  const token = { uuid: "T.u1", actor: holder };
  const subject = { token, actor: holder };
  const cardOf = (over = {}) => ({ kind: "toggle", activationId: "actC", lowered: false, counted: { "T~u1": { uuid: "T.u1", name: "Unsure" } }, ...over });
  const post = (card) => {
    const list = [{ id: "M5", flags: { "acks-extras": { itemRunCard: card } }, getFlag(scope, key) { return this.flags[scope][key]; } }];
    list.get = (id) => list.find((m) => m.id === id) ?? null;
    gameStub.messages = list;
  };
  const item = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindC" } } } };
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const moment = (pulse, momentName, admitted, activationId = "actC", row = { key: "r", reach: { pulse, on: ["morale"], modifier: { value: "-1" } } }) => run.handleReachMoment({ moment: momentName, config: { activationId }, item, row, reach: { pulse }, subject, admitted });
  try {
    post(cardOf());
    assert.equal(await moment("turnStart+moveIn", "turnStart", null), "prompt", "a turn start asks the counted body, as it asks one the filter admits");
    assert.equal(seen.at(-1).act, "prompt");
    assert.equal(await moment("turnStart+moveIn", "enter", null), "list", "its entry lists it");
    assert.equal(await moment("turnStart+moveIn", "turnStart", false), null, "a filter that settles the body as no target stands");
    post(cardOf({ lowered: true }));
    assert.equal(await moment("turnStart+moveIn", "turnStart", null), "undetermined", "a lowered raise counts nobody");
    post(cardOf());
    assert.equal(await moment("turnStart+moveIn", "turnStart", null, "actOther"), "undetermined", "another raise's moments do not read this raise's count");
    post(cardOf({ counted: {} }));
    assert.equal(await moment("turnStart+moveIn", "turnStart", null), "undetermined", "a body not counted stays undetermined");
    post(cardOf());
    seen.length = 0;
    assert.equal(await moment("standing", "enter", null), "on", "a standing entry holds the counted body's part");
    assert.equal(held.length, 1, "one record written");
    assert.deepEqual(seen.map((r) => r.act), ["list"], "and the card lists the body as in reach");
    assert.equal(await moment("standing", "exit", null), "off", "an exit takes it off");
    assert.equal(seen.at(-1).act, "out", "and mutes its row");
    seen.length = 0;
    post(cardOf({ counted: {} }));
    assert.equal(await moment("standing", "enter", null), "undetermined", "an uncounted body keeps going to the card's undetermined section");
    assert.equal(await moment("standing", "enter", true), "on");
    assert.deepEqual(seen.map((r) => r.act), ["undetermined"], "a body the filter admits is held without a card row, as before");
    // A standing exit and entry read the card: a row it already holds follows the body, an undetermined body is dropped, and a body the card keeps nothing of is not listed.
    const listed = { "T~u1": { uuid: "T.u1", name: "Unsure", state: "in", latest: "" } };
    seen.length = 0;
    post(cardOf({ counted: {}, subjects: listed }));
    assert.equal(await moment("standing", "exit", true), "off");
    assert.deepEqual(seen.map((r) => r.act), ["out"], "a body Check range again listed is muted at its exit, though no one counted it");
    assert.equal(await moment("standing", "enter", true), "on");
    assert.deepEqual(seen.map((r) => r.act), ["out", "list"], "and is held again at its entry");
    seen.length = 0;
    post(cardOf({ counted: {}, undetermined: { "T~u1": { uuid: "T.u1", name: "Unsure" } } }));
    assert.equal(await moment("standing", "exit", null), "off");
    assert.deepEqual(seen.map((r) => r.act), ["forget"], "an uncounted undetermined body is dropped from the list at its exit");
    assert.equal(await moment("standing", "enter", null), "undetermined");
    assert.deepEqual(seen.map((r) => r.act), ["forget", "undetermined"], "and listed again at its entry");
    seen.length = 0;
    post(cardOf({ counted: {} }));
    assert.equal(await moment("standing", "exit", true), "off");
    assert.equal(await moment("standing", "exit", null), "off");
    assert.deepEqual(seen, [], "a body the card keeps nothing of presents nothing at its exit");
  } finally {
    run.setUsePresenter(null);
    delete gameStub.messages;
  }
});

await t("the bearer's row is changed to count only where the item has the row, an ability's rows in their own place", async () => {
  const rows = [{ key: "a", reach: { pulse: "turnStart+moveIn", filter: { kinds: ["x"] } } }, { key: "b" }];
  const item = { type: "item", flags: { "acks-extras": { itemRun: { rows } } } };
  const out = logic.selfCountUpdate(item, "a");
  assert.equal(out.path, "flags.acks-extras.itemRun.rows");
  assert.deepEqual(out.value[0].reach.filter, { kinds: ["x"], self: "count" }, "the filter keeps what it held");
  assert.deepEqual(out.value[1], { key: "b" });
  assert.equal(logic.selfCountUpdate(item, "a", false).value[0].reach.filter.self, "no", "counted out writes the filter back to no, keeping the rest");
  assert.equal(logic.selfCountUpdate(item, "b"), null, "a row with no reach");
  assert.equal(logic.selfCountUpdate(item, "zz"), null);
  const ability = { type: "ability", flags: { "acks-extras": { extras: { effects: rows } } } };
  assert.equal(logic.selfCountUpdate(ability, "a").path, "flags.acks-extras.extras.effects");
  assert.deepEqual(logic.checkPressRequest({ total: 1, target: 1, requestUserId: "u" }, { item: {}, row: {}, subjectOwnerIds: ["u"], target: 1, waiting: true }), { ok: false, reason: "waiting" });
  assert.equal(logic.checkPressRequest({ total: 1, target: 1 }, { item: {}, row: {}, target: 1, waiting: true, judge: true }).early, true, "a Judge's own seat on a waiting row is early");
  assert.equal(logic.checkPressRequest({ total: 1, target: 1 }, { item: {}, row: {}, target: 1, struck: true }).reason, "struck");
  assert.equal(logic.checkPressRequest({ total: 1, target: 1 }, { item: {}, row: {}, target: 1, waiting: true }).reason, "waiting", "a world that does not declare the Judge refuses a press before the moment, with no relayed id as well");
});

await t("the fuse is stepped from the turn hooks on the primary GM's window alone, a fight's end moves it to the world clock, and the clock reaching it bursts it", async () => {
  const burst = [];
  run.setFuseBurst(async ({ record }) => { burst.push(record.activationId); });
  const fuseOf = (seen, over = {}) => ({ ...flag(), clock: { ...flag().clock, seen }, ...over });
  try {
    seatOf(true);
    log.length = 0;
    await hooked[consts.TURN_BEGAN_HOOK][0](combatOf([holder(fuseOf(0))]), "m1");
    await settle();
    assert.deepEqual(log, [["set", "e1", 1]], "a turn that began is counted");
    log.length = 0;
    await hooked[consts.TURN_ENDED_HOOK][0](combatOf([holder(fuseOf(0))]), "m1");
    await settle();
    assert.deepEqual(log, [], "an end that no start preceded is not a turn");
    await hooked[consts.TURN_ENDED_HOOK][0](combatOf([holder(fuseOf(2))]), "m1");
    await settle();
    assert.deepEqual(log, [["delete", "e1"]]);
    assert.deepEqual(burst, ["act"]);
    seatOf(false);
    log.length = 0;
    burst.length = 0;
    await hooked[consts.TURN_ENDED_HOOK][0](combatOf([holder(fuseOf(2))]), "m1");
    await settle();
    await hooked[consts.TURN_BEGAN_HOOK][0](combatOf([holder(fuseOf(0))]), "m1");
    await settle();
    assert.deepEqual([log, burst], [[], []], "not the primary GM's window");
    // The fight ends.
    seatOf(true);
    gameStub.time = { worldTime: 1000 };
    const priorActors = gameStub.actors;
    const world = holder(fuseOf(0, { clock: undefined, dueAt: 900 }), "w1");
    gameStub.actors = [world];
    log.length = 0;
    const ending = holder(fuseOf(1), "e1");
    await hooked.deleteCombat[0]({ id: "c1", combatants: [{ id: "m1", actor: ending }] });
    const update = log.find((entry) => entry[0] === "update");
    assert.equal(update[2]["flags.acks-extras.fuse"].dueAt, 1000 + 1 * (await import("../scripts/lib/time-unit.mjs")).roundSeconds(), "one round left at the world's round");
    assert.ok(log.some((entry) => entry[0] === "delete" && entry[1] === "w1"), "a fuse already due on the world clock goes at once");
    assert.deepEqual(burst, ["act"]);
    gameStub.actors = priorActors;
    log.length = 0;
    burst.length = 0;
    seatOf(false);
    await hooked.deleteCombat[0]({ id: "c1", combatants: [{ id: "m1", actor: holder(fuseOf(1)) }] });
    assert.deepEqual(log, [], "not the primary GM's window");
    // The world clock moves.
    seatOf(true);
    gameStub.actors = [holder(fuseOf(0, { clock: undefined, dueAt: 1500 }), "w2")];
    await hooked.updateWorldTime[0](1400, 100);
    await settle();
    assert.deepEqual(burst, [], "not yet due");
    await hooked.updateWorldTime[0](1500, 100);
    await settle();
    assert.deepEqual(burst, ["act"], "due now");
    gameStub.actors = priorActors;
  } finally {
    run.setFuseBurst(null);
    seatOf(true);
    gameStub.time = { worldTime: 0 };
  }
});

await t("fuses of one effect are counted once, a fight's end leaves another fight's fuse, a burst hands on the record it read, and no burst steps nothing on either clock", async () => {
  const burst = [];
  const shared = holder(flag());
  const twin = { name: "Twin", effects: shared.effects, deleteEmbeddedDocuments: shared.deleteEmbeddedDocuments };
  log.length = 0;
  const due = { ...flag(), clock: { ...flag().clock, seen: 2 } };
  const loose = { ...flag(), clock: { combatId: "c1", combatantId: "m1", edge: "start", count: 2.9, seen: 2 } };
  const result = await run.liftFuses({ id: "c1", combatants: [{ id: "m1", actor: holder(loose) }] }, "m1", "ended", { burst: async ({ record }) => burst.push(record) });
  assert.deepEqual(result[0].clock, { combatId: "c1", combatantId: "m1", edge: "end", count: 2, seen: 2 }, "the record read, as it was read");
  log.length = 0;
  await run.liftFuses({ id: "c1", combatants: [{ id: "m1", actor: shared }, { id: "m2", actor: twin }] }, "m1", "began", { burst: async () => {} });
  assert.deepEqual(log, [["set", "e1", 1]], "one effect on two actors is one fuse");
  log.length = 0;
  const other = await run.convertFuses({ id: "c-other" }, [holder(flag())], { now: 5, roundSeconds: 6 });
  assert.deepEqual([other, log], [[], []], "another fight's fuse stays on its clock");
  log.length = 0;
  const worldFuse = { ...flag(), clock: undefined, dueAt: 10 };
  assert.deepEqual(await run.liftWorldFuses([holder(worldFuse)], 99, { burst: null }), []);
  assert.deepEqual(log, [], "with no burst a due fuse stays");
  const counted = await run.liftFuses({ id: "c1", combatants: [{ id: "m1", actor: holder(flag()) }] }, "m1", "began", { burst: async () => {} });
  assert.deepEqual(counted, [], "counting is not bursting");
  log.length = 0;
  const failed = holder(due);
  failed.deleteEmbeddedDocuments = async () => { throw new Error("gone"); };
  const lines = [];
  const priorError = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    assert.deepEqual(await run.liftFuses({ id: "c1", combatants: [{ id: "m1", actor: failed }] }, "m1", "ended", { burst: async () => { throw new Error("burst failed"); } }), []);
  } finally {
    console.error = priorError;
  }
  assert.ok(lines.some((line) => line.includes("could not be run")), "a fuse that cannot run is logged and the rest go on");
  assert.deepEqual(await run.liftFuses({ id: "c1", combatants: [] }, "m1", "ended", { burst: null }), []);
});

await t("the installed carrier answers a Player's relayed use as that seat, hears the reach's moments and lifts a deleted Region's records, and ignores a presenter or burst that is no function", async () => {
  stage();
  seatOf(true);
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const auraReach = await import("../scripts/lib/aura-reach.mjs");
  try {
    itemFlags = toggleFlags(down);
    assert.deepEqual(await executeAsGM("acks-extras.itemRun.use", { itemUuid: "I.1", requestUserId: "other" }), { ok: false, reason: "notOwner" }, "the relayed seat is checked, not taken for the Judge");
    // The reach's moment reaches the carrier's own handler.
    const seen = [];
    run.setUsePresenter(async (result) => seen.push(result));
    const region = { parent: { tokens: { get: () => bearerTok } }, attachment: { token: "1" } };
    const walker = { id: "w", uuid: "T.w", flags: { "acks-extras": {} }, disposition: -1, actor: monster(["alpha"]) };
    itemFlags = { itemRun: { activation: { kind: "toggle" }, rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "5" }, filter: { kinds: ["alpha"] } } }] } };
    await auraReach.dispatchReachMoment({ sourceUuid: "I.1", bearerUuid: "A.1", activationId: "act1", rowKey: "s", region }, "enter", walker);
    assert.deepEqual(seen, [], "the moment reached the carrier's own handler, which writes a standing part itself and presents nothing (a row with no modifier writes none)");
    // A Region's deletion lifts its activation's records through the carrier's teardown.
    const removed = [];
    const priorActors = gameStub.actors;
    gameStub.actors = [{ effects: [{ id: "e1", flags: { "acks-extras": { itemRun: { activationId: "act1" } } } }], deleteEmbeddedDocuments: async (...args) => removed.push(args[1]) }];
    const priorOn = globalThis.Hooks.on;
    const regionHooks = {};
    globalThis.Hooks.on = (name, fn) => { (regionHooks[name] ??= []).push(fn); };
    try {
      auraReach.installAuraReach();
    } finally {
      globalThis.Hooks.on = priorOn;
    }
    await regionHooks.deleteRegion[0]({ behaviors: [{ type: AURA, system: { sourceUuid: "I.1", bearerUuid: "A.1", activationId: "act1", rowKey: "s" } }] });
    assert.deepEqual(removed, [["e1"]], "the records of the deleted Region's activation");
    gameStub.actors = priorActors;
    // A presenter or a burst that is no function is no presenter and no burst.
    run.setUsePresenter("not a function");
    itemFlags = toggleFlags(down);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).ok, true, "a use with no presenter still runs");
    run.setFuseBurst("not a function");
    log.length = 0;
    const due = { ...flag(), clock: { ...flag().clock, seen: 2 } };
    assert.deepEqual(await run.liftFuses(combatOf([holder(due)]), "m1", "ended"), []);
    assert.deepEqual(log, [], "no burst is registered, so the fuse is left alone");
  } finally {
    run.setFuseBurst(null);
    run.setUsePresenter(async (result) => presented.push(result));
    unstage();
  }
});


await t("an engaged card's entry names its own item: a Save press writes under the entry's ids and the card's own id and never the Region's, a forged item is no card, and Not engaged is refused by the handler for any seat that does not own every bearer, a Judge's role included, writes no record and closes the row a Save then refuses, and Undo reopens it", async () => {
  stage();
  seatOf(true, [{ id: "owner" }, { id: "other" }, { id: "both" }, { id: "half" }]);
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const { holdReachMoment, releaseReachMoment } = await import("../scripts/lib/aura-reach.mjs");
  const made = [];
  const actor = monster(["alpha"]);
  actor.createEmbeddedDocuments = async (kind, records, options) => { made.push([records, options]); return records.map((r, i) => ({ id: `E${made.length}-${i}`, flags: r.flags })); };
  subjects["T.s1"] = { id: "s1", uuid: "T.s1", actor, testUserPermission: (user) => user?.id === "owner" };
  subjects["T.b1"] = { id: "b1", uuid: "T.b1", name: "B1", actor: {}, testUserPermission: (user) => ["both", "half"].includes(user?.id) };
  subjects["T.b2"] = { id: "b2", uuid: "T.b2", name: "B2", actor: {}, testUserPermission: (user) => user?.id === "both" };
  const target = saveSpec(actor, "paralysis").target;
  itemFlags = { cookbook: { id: "kindT" }, itemRun: { activation: { kind: "once" }, rows: [{ key: "k", target: "paralysis", conditions: ["held"], reach: { pulse: "turnStart+enter", engaged: true, immunity: { value: "2" }, lasts: { value: "3" } } }] } };
  const entry = (over = {}) => ({ subject: "T.s1", moment: "turnStart", momentKey: "mk", state: "open", kindKey: "kindT", itemUuid: "I.1", rowKey: "k", activationId: "engaged:x", bearers: [{ uuid: "T.b1", name: "B1" }, { uuid: "T.b2", name: "B2" }], ...over });
  const message = {
    flags: { "acks-extras": { itemRunCard: { kind: "engaged", cardId: "cardX", itemUuid: "", rowKey: "", activationId: "", stamp: "c1:1:0", subject: { uuid: "T.s1", name: "One" }, subjects: {}, undetermined: {}, counted: {}, entries: { a: entry(), b: entry({ momentKey: "mb" }), c: entry({ momentKey: "mc" }) } } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) {
      const patch = Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]));
      this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, patch);
    },
  };
  const entries = () => message.flags["acks-extras"].itemRunCard.entries;
  gameStub.messages = { get: (id) => (id === "M5" ? message : null) };
  const press = (over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "forged", activationId: "forged", subject: "T.s1", messageId: "M5", entryKey: "a", total: target - 1, target, requestUserId: "owner", ...over });
  const close = (over = {}) => executeAsGM("acks-extras.itemRun.notEngaged", { messageId: "M5", entryKey: "c", ...over });
  const undo = (over = {}) => executeAsGM("acks-extras.itemRun.undo", { messageId: "M5", entryKey: "c", ...over });
  try {
    const failed = await press();
    assert.equal(failed.ok, true, "the subject's owner presses a row of a card that names no item of its own");
    assert.deepEqual([entries().a.state, entries().a.saved, entries().a.life, entries().a.names], ["applied", false, "timed", ["Held Name"]], "a timed failure");
    const [[records, options]] = made;
    assert.deepEqual([records[0].flags["acks-extras"].itemRun.source, records[0].flags["acks-extras"].itemRun.rowKey, records[0].flags["acks-extras"].itemRun.activationId, records[0].flags["acks-extras"].itemRun.dueAt, options], ["I.1", "k", "cardX", 1800, { keepId: true }], "the entry's own item and row, the card's id and never the Region's, on the module's clock");
    made.length = 0;
    const held = await press({ entryKey: "b", total: target });
    assert.deepEqual([held.ok, held.saved, entries().b.immune], [true, true, 2], "a pass writes the window and the entry keeps the figure it read");
    assert.equal(made[0][0][0].flags["acks-extras"].itemRun.activationId, "cardX", "under the card's id too");
    await message.update({ "flags.acks-extras.itemRunCard.entries.c.itemUuid": "I.other" });
    assert.equal((await press({ entryKey: "c" })).reason, "noCard", "an entry that names another item is no card for this press");
    await message.update({ "flags.acks-extras.itemRunCard.entries.c.itemUuid": "I.1" });
    made.length = 0;
    // Not engaged: the handler reads ownership of every bearer from the relayed seat, and a Judge owning none is refused.
    holdReachMoment("mc", "c1:1:0");
    assert.equal((await close({ requestUserId: "half" })).reason, "notBearer", "one of two bearers");
    assert.equal((await close({ requestUserId: "owner" })).reason, "notBearer", "the subject's owner");
    assert.equal((await close({ requestUserId: "other" })).reason, "notBearer", "a seat that owns nothing");
    assert.equal((await close()).reason, "notBearer", "a Judge's own seat: no role is read");
    assert.equal((await close({ entryKey: "none", requestUserId: "both" })).reason, "struck");
    assert.equal(entries().c.state, "open");
    assert.equal(holdReachMoment("mc", "c1:1:0"), false, "a refused press releases no key");
    assert.equal((await close({ entryKey: "a", requestUserId: "both" })).reason, "applied", "an answered row is not closed");
    const kind = message.flags["acks-extras"].itemRunCard.kind;
    message.flags["acks-extras"].itemRunCard.kind = "toggle";
    assert.equal((await close({ requestUserId: "both" })).reason, "struck", "a raised card's entry is no engaged row");
    message.flags["acks-extras"].itemRunCard.kind = kind;
    const closed = await close({ requestUserId: "both" });
    assert.equal(closed.ok, true, "the seat that owns every bearer");
    assert.deepEqual([entries().c.state, entries().c.closedBy.id, entries().c.presser], ["closed", "both", "both"]);
    assert.deepEqual(made, [], "no record is written");
    assert.equal(holdReachMoment("mc", "c1:1:0"), true, "the moment key was released");
    releaseReachMoment("mc");
    assert.equal((await press({ entryKey: "c" })).reason, "applied", "a closed row refuses a Save");
    assert.equal((await close({ requestUserId: "both" })).reason, "applied", "and a second close");
    assert.equal((await undo({ requestUserId: "other" })).reason, "notOwner", "Undo is the closer's or the subject's owners'");
    const reopened = await undo({ requestUserId: "both" });
    assert.deepEqual([reopened.ok, reopened.removed, entries().c.state, "closedBy" in entries().c], [true, [], "open", false], "Undo reopens it and deletes nothing");
    assert.equal(holdReachMoment("mc", "c1:1:0"), false, "its key is held again");
    releaseReachMoment("mc");
    assert.equal((await press({ entryKey: "c" })).ok, true, "and the Save works again");
    assert.deepEqual(await executeAsGM("acks-extras.itemRun.notEngaged", { messageId: "M9", entryKey: "c", requestUserId: "both" }), { ok: false, reason: "struck" }, "a card that is gone");
  } finally {
    delete gameStub.messages;
    delete subjects["T.s1"];
    delete subjects["T.b1"];
    delete subjects["T.b2"];
    unstage();
  }
});


await t("an engaged reach's prompt names its bearers: a step-in on the subject's own turn names the reach it came through, a turn start's group dispatch names every bearer it states, and a raised reach names none", async () => {
  seatOf(true);
  const { releaseReachMoment } = await import("../scripts/lib/aura-reach.mjs");
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  gameStub.combat = { id: "c1", started: true, round: 1, turn: 0, combatant: { tokenId: "s1" } };
  const item = { uuid: "I.1", flags: { "acks-extras": { cookbook: { id: "kindE" } } } };
  const row = { key: "k", reach: { pulse: "turnStart+enter" } };
  const subject = { token: { id: "s1", uuid: "T.s1" }, actor: monster(["alpha"]) };
  const key = "c1:1:0:T.s1:kindE";
  const hear = (over) => run.handleReachMoment({ config: { activationId: "engaged:x" }, item, row, reach: { pulse: "turnStart+enter" }, subject, admitted: true, bearer: { token: { uuid: "T.b1" } }, ...over });
  try {
    assert.equal(await hear({ moment: "enter" }), "prompt");
    assert.deepEqual([seen.at(-1).act, seen.at(-1).engagedBy, seen.at(-1).momentKey], ["prompt", ["T.b1"], key], "a step-in names the bearer of the reach it came through");
    releaseReachMoment(key);
    await hear({ moment: "turnStart", engagedBy: ["T.b1", "T.b2"] });
    assert.deepEqual(seen.at(-1).engagedBy, ["T.b1", "T.b2"], "the group dispatch states its own bearers and they are kept");
    releaseReachMoment(key);
    await hear({ moment: "turnStart", config: { activationId: "act" }, engagedBy: null });
    assert.equal("engagedBy" in seen.at(-1), false, "a reach that is not an engaged one names no bearers");
    releaseReachMoment(key);
    await hear({ moment: "enter", admitted: null });
    assert.deepEqual([seen.at(-1).act, "engagedBy" in seen.at(-1)], ["undetermined", false], "a body the filter could not settle is no engaged prompt");
  } finally {
    releaseReachMoment(key);
    gameStub.combat = null;
    run.setUsePresenter(async (result) => presented.push(result));
  }
});

/* --- the fuse's light, its burst, an Apply and its Undo, a lit fuse's controls, and a hand-on --- */
class RollStub {
  static queue = [];
  static posted = [];
  static validate(formula) { return /^\d+d\d+$/.test(String(formula)); }
  constructor(formula) { this.formula = formula; }
  async evaluate() { this.total = RollStub.queue.shift(); return this; }
  async toMessage() { RollStub.posted.push(this.formula); }
}
const figs = { throw: { value: "12" }, fumble: { value: "2" }, fuseDice: { value: "1d4" }, proficiency: { value: "Skill A" }, sizes: { value: { kindA: 7 } }, blast: { value: [{ lb: 7, dice: "3d5", radius: 15, types: ["typeA"] }] } };
const fuseFlags = (over = {}, reach = {}) => ({ itemRun: { activation: { kind: "fuse", ...figs, variant: "kindA", ...over }, rows: [{ key: "burst", reach: { pulse: "burst", save: { value: "paralysis" }, fraction: { value: "0.5" }, ...reach } }] } });
const hpActor = (id, owner, value = 20, type = "monster") => {
  const actor = {
    ...monster(["alpha"]), id, uuid: `A.${id}`, name: `Body ${id}`, img: "", type, items: [], system: { hp: { value, max: 20 }, saves: { paralysis: { value: 12 } } },
    testUserPermission: (user) => user?.id === owner || user?.isGM === true,
    async applyDamage(amount, multiplier) { actor.system.hp.value = Math.min(actor.system.hp.value - Math.ceil(amount * multiplier), actor.system.hp.max); },
    async update() {},
  };
  return actor;
};
const bodyTok = (id, actor) => ({ id, uuid: `T.${id}`, name: `Tok ${id}`, actor, flags: { "acks-extras": {} }, testInsideRegion: () => true, testUserPermission: (user) => actor?.testUserPermission(user) ?? false });
const spotOne = { sceneId: "S1", x: 150, y: 250, elevation: 0, level: "L1" };

/** The world a fuse is lit and bursts in: the bearer's token on scene S1, a Roll that answers from a queue, and the item's quantity. */
function stageFuseWorld(tokens = []) {
  const prior = { Roll: globalThis.Roll, ChatMessage: globalThis.ChatMessage, scenes: gameStub.scenes, actors: gameStub.actors, user: gameStub.user, perm: bearerActor.testUserPermission, itemSystem: theItem.system, itemDelete: theItem.delete, itemUpdate: theItem.update };
  globalThis.Roll = RollStub;
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  RollStub.queue.length = 0;
  RollStub.posted.length = 0;
  const scene = { id: "S1", grid: { size: 100 }, dimensions: { distance: 5, distancePixels: 10 }, tokens };
  gameStub.scenes = Object.assign([scene], { get: (id) => (id === "S1" ? scene : null) });
  gameStub.user = { id: "gm", isGM: true };
  bearerActor.testUserPermission = (user) => user?.id === "owner" || user?.isGM === true;
  bearerActor.name = "Bearer";
  bearerActor.uuid = "A.1";
  bearerActor.items = [];
  Object.assign(bearerTok, { x: 100, y: 200, width: 1, height: 1, elevation: 0, level: "L1", parent: scene });
  const ops = { updates: [], deleted: [] };
  theItem.system = { quantity: 3 };
  theItem.update = async (data) => { ops.updates.push(data); };
  theItem.delete = async () => { ops.deleted.push("I.1"); };
  stage();
  seatOf(true);
  return {
    scene, ops,
    restore() {
      Object.assign(globalThis, { Roll: prior.Roll, ChatMessage: prior.ChatMessage });
      Object.assign(gameStub, { scenes: prior.scenes, actors: prior.actors, user: prior.user, combat: null });
      bearerActor.testUserPermission = prior.perm;
      Object.assign(theItem, { system: prior.itemSystem, delete: prior.itemDelete, update: prior.itemUpdate });
      for (const key of ["x", "y", "width", "height", "elevation", "level"]) delete bearerTok[key];
      delete bearerTok.testInsideRegion;
      bearerTok.parent = null;
      delete bearerActor.createEmbeddedDocuments;
      delete bearerActor.deleteEmbeddedDocuments;
      bearerActor.effects = [];
      run.setProficiencyReader(null);
      run.setUsePresenter(async (result) => presented.push(result));
      unstage();
    },
  };
}

await t("the fuse's light writes nothing for a blank figure, an unlit throw or a fumble's burst, and writes the fuse on the fight's clock in a fight and the world's out of one", async () => {
  const world = stageFuseWorld([bearerTok]);
  bearerTok.testInsideRegion = () => true;
  const written = [];
  bearerActor.createEmbeddedDocuments = async (kind, data) => { written.push(...data); return data.map((_, i) => ({ id: `fx${written.length - data.length + i}` })); };
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  run.setProficiencyReader(async () => ({ proficient: true, bonus: 2, parts: [{ label: "Skill A", value: 2, cite: "ZZ p. 1" }] }));
  try {
    itemFlags = fuseFlags({ fumble: { value: "" } });
    const blank = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([blank.ok, blank.kind, blank.outcome, blank.roll, blank.fuse, blank.blank], [true, "fuse", null, null, null, ["fumble"]], "a blank fumble figure is the Judge's: nothing rolled");
    assert.deepEqual(RollStub.posted, []);
    RollStub.queue.push(9);
    itemFlags = fuseFlags({ throw: { value: "" } });
    const noTarget = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([noTarget.outcome, noTarget.light, noTarget.blank], [null, null, ["throw"]], "a die the target is needed for, with no target");
    assert.equal(noTarget.roll.natural, 9, "the die is rolled and shown for the Judge");
    itemFlags = fuseFlags();
    RollStub.queue.push(9);
    const unlit = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([unlit.outcome, unlit.fuse], ["unlit", null]);
    assert.deepEqual(unlit.roll, { natural: 9, total: 9, formula: "1d20", target: 10, base: 12, modifiers: [{ label: "Skill A", value: 2, cite: "ZZ p. 1" }], proficient: true, proficiencyRead: true, proficiency: "Skill A" }, "the target is the item's figure less the proficiency's standing modifiers");
    assert.deepEqual(written, [], "an unlit fuse writes nothing");
    // In a fight the record counts the bearer's turns.
    gameStub.combat = { id: "c9", started: true, combatants: [{ id: "m9", tokenId: "1" }] };
    RollStub.queue.push(10, 3);
    const lit = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([lit.outcome, lit.fuse], ["lit", { count: 3, combat: true, spot: spotOne }], "a die on the lowered target");
    assert.deepEqual(written[0].flags["acks-extras"].fuse, logic.fuseFlag({ source: "I.1", activationId: "rid", spot: spotOne, combatId: "c9", combatantId: "m9", count: 3 }), "the spot is the token's centre");
    assert.equal(written[0].origin, "I.1");
    assert.equal(lit.recordId, "fx0");
    // Outside one it is due on the world clock.
    gameStub.combat = null;
    gameStub.time = { worldTime: 1000 };
    RollStub.queue.push(12, 2);
    const world2 = await run.runUse({ itemUuid: "I.1" });
    const { roundSeconds } = await import("../scripts/lib/time-unit.mjs");
    assert.deepEqual([world2.outcome, world2.fuse.combat, world2.fuse.dueAt], ["lit", false, Math.ceil(1000 + 2 * roundSeconds())]);
    assert.deepEqual(written[1].flags["acks-extras"].fuse, logic.fuseWorldFlag({ source: "I.1", activationId: "rid", spot: spotOne, rounds: 2, now: 1000, roundSeconds: roundSeconds() }));
    // A fuse the dice cannot make is the Judge's, and nothing is written.
    written.length = 0;
    itemFlags = fuseFlags({ fuseDice: { value: "words" } });
    RollStub.queue.push(15);
    const badDice = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([badDice.outcome, badDice.light, badDice.blank, written.length], [null, "lit", ["fuseDice"], 0]);
    itemFlags = fuseFlags();
    RollStub.queue.push(15, 0);
    assert.deepEqual([(await run.runUse({ itemUuid: "I.1" })).outcome, written.length], [null, 0], "a count under one");
    // A fumble bursts at once at the bearer's token centre and writes no fuse; the presenter hears the fuse result, then the burst.
    seen.length = 0;
    RollStub.queue.push(2, 11);
    const fumbled = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual([fumbled.outcome, fumbled.fuse, fumbled.presented, written.length], ["fumble", null, true, 0]);
    assert.deepEqual(seen.map((r) => r.kind + (r.outcome ?? "")), ["fusefumble", "burst"]);
    assert.deepEqual(fumbled.burst.spot, spotOne, "at the bearer's token centre");
    assert.deepEqual([fumbled.burst.rolled, fumbled.burst.dice, fumbled.burst.subjects.map((s) => s.key)], [11, "3d5", ["T.1"]], "the bearer's own token is in its blast");
    assert.deepEqual(world.ops.updates.at(-1), { "system.quantity": 2 }, "one off the stack");
  } finally {
    world.restore();
  }
});

await t("a burst rolls once over the spot's area, sends vehicles to their own rows, consumes one of the item, and says nothing rolled where a figure is blank, its scene gone or the item gone", async () => {
  const one = hpActor("one", "owner");
  const veh = hpActor("veh", "owner", 20, "acks-extras.vehicle");
  const world = stageFuseWorld([bodyTok("one", one), bodyTok("veh", veh), bodyTok("none", null)]);
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const record = { source: "I.1", activationId: "act", spot: spotOne };
  try {
    itemFlags = fuseFlags();
    RollStub.queue.push(11);
    const done = await run.burstFuse({ actor: bearerActor, record });
    assert.deepEqual(RollStub.posted, ["3d5"], "the dice are rolled once and shown");
    assert.deepEqual([done.ok, done.kind, done.blank, done.rolled, done.dice, done.types, done.radius, done.saveName, done.reduction], [true, "burst", false, 11, "3d5", ["typeA"], 15, "paralysis", 0.5]);
    assert.deepEqual(done.subjects, [{ key: "T.one", name: "Tok one" }], "bodies with hit points; a token with no actor is no subject");
    assert.deepEqual(done.vehicles, [{ uuid: "T.veh", name: "Tok veh" }], "a vehicle is handed on, never rolled for");
    assert.equal(madeRegions.at(-1).data.shapes[0].radius, 150, "the blast's radius at the scene's scale, centred on the spot");
    assert.deepEqual([madeRegions.at(-1).data.shapes[0].x, madeRegions.at(-1).data.shapes[0].y], [150, 250]);
    assert.deepEqual([done.card.kind, done.card.rolled, done.card.spot, done.card.reduction, done.card.saveName, done.card.title, done.card.subtitle], ["burst", 11, spotOne, 0.5, "paralysis", "Gear", "Bearer"]);
    assert.deepEqual(done.card.sections[0].rows[0].actions[0].data, { itemUuid: "I.1", rowKey: "burst", activationId: "act", subject: "T.one" });
    assert.deepEqual(seen, [done], "handed to the presenter");
    assert.deepEqual(world.ops.updates, [{ "system.quantity": 2 }]);
    theItem.system = { quantity: 1 };
    RollStub.queue.push(4);
    await run.burstFuse({ actor: bearerActor, record });
    assert.deepEqual(world.ops.deleted, ["I.1"], "the last of a stack is deleted");
    // Where the Judge decides nothing is rolled or consumed.
    RollStub.posted.length = 0;
    world.ops.deleted.length = 0;
    const blankOf = async (over, why, record2 = record) => {
      itemFlags = fuseFlags(over);
      const out = await run.burstFuse({ actor: bearerActor, record: record2 });
      assert.deepEqual([out.ok, out.blank, out.why, out.card], [true, true, why, null], why);
    };
    await blankOf({ variant: "unknown" }, "figure");
    await blankOf({ blast: { value: [{ lb: 7, dice: "words", radius: 15 }] } }, "dice");
    itemFlags = {};
    const gone = await run.burstFuse({ actor: bearerActor, record });
    assert.deepEqual([gone.blank, gone.why], [true, "gone"], "an item whose activation is no more");
    assert.deepEqual([RollStub.posted, world.ops.deleted], [[], []]);
    itemFlags = fuseFlags();
    const none = await run.burstFuse({ actor: bearerActor, record: { ...record, spot: { ...spotOne, sceneId: "S9" } } });
    assert.deepEqual([none.ok, none.reason, none.itemName, none.actorName, none.activationId], [false, "noScene", "Gear", "Bearer", "act"], "nothing bursts where the spot's scene is gone, and the presenter is told which fuse");
    assert.equal(seen.at(-1), none);
    assert.deepEqual([RollStub.posted, world.ops.deleted], [[], []]);
  } finally {
    world.restore();
  }
});

await t("with no proficiency reader registered the light reads nothing: no modifiers, not proficient, and the roll says its proficiency was not read", async () => {
  const world = stageFuseWorld([bearerTok]);
  bearerTok.testInsideRegion = () => true;
  try {
    itemFlags = fuseFlags();
    RollStub.queue.push(9);
    const out = await run.runUse({ itemUuid: "I.1" });
    assert.deepEqual(out.roll, { natural: 9, total: 9, formula: "1d20", target: 12, base: 12, modifiers: [], proficient: false, proficiencyRead: false, proficiency: "Skill A" }, "the item's own target, with nothing taken off it");
    assert.equal(out.outcome, "unlit");
    run.setProficiencyReader(async () => null);
    RollStub.queue.push(9);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).roll.proficiencyRead, false, "a reader that answers nothing has read nothing");
    run.setProficiencyReader(async () => ({ proficient: false, bonus: 0, parts: [] }));
    RollStub.queue.push(9);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).roll.proficiencyRead, true, "a reader's answer is read, a bearer without the proficiency included");
    run.setProficiencyReader(async () => ({ proficient: false, bonus: 0, parts: [], read: false }));
    RollStub.queue.push(9);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).roll.proficiencyRead, false, "unless it says it did not");
    run.setProficiencyReader(null);
    RollStub.queue.push(9);
    assert.equal((await run.runUse({ itemUuid: "I.1" })).roll.proficiencyRead, false, "clearing the reader restores the default");
  } finally {
    world.restore();
  }
});

await t("a deleted token's fuse: the primary GM's window drops a linked bearer's record and a lost unlinked one, tells the Judge which fuse, bursts nothing, and a linked actor's other token on any scene keeps it", async () => {
  const priorScenes = gameStub.scenes;
  const told = [];
  run.setUsePresenter(async (result) => told.push(result));
  const dels = [];
  const raw = { source: "I.1", activationId: "act9", spot: spotOne, dueAt: 5 };
  const fuseEffect = { id: "fe", uuid: "E.fe", name: "Gear", flags: { "acks-extras": { fuse: raw } } };
  const plain = { id: "pe", uuid: "E.pe", name: "Other", flags: {} };
  const expected = (over = {}) => ({ ok: false, kind: "burst", activationId: "act9", itemUuid: "I.1", itemName: "Gear", actorName: "Bearer", actorUuid: "A.1", reason: "noBearer", ...over });
  const drop = async (token) => {
    await hooked.deleteToken[0](token);
    await settle();
  };
  const reset = () => { told.length = 0; dels.length = 0; };
  const linkedActor = (token) => ({ id: "a1", uuid: "A.1", name: "Bearer", isToken: false, effects: [plain, fuseEffect], getActiveTokens: () => [token], deleteEmbeddedDocuments: async (kind, ids) => dels.push([kind, ...ids]) });
  const linkedToken = () => { const token = { id: "t1", uuid: "T.t1", actorLink: true }; token.actor = linkedActor(token); return token; };
  try {
    seatOf(true);
    // A linked actor with no token left: the record goes, the Judge is told, nothing bursts.
    gameStub.scenes = [{ tokens: [{ actorLink: true, actorId: "a1", uuid: "T.t1" }, { actorLink: true, actorId: "zz", uuid: "T.zz" }, { actorLink: false, actorId: "a1", uuid: "T.syn" }] }];
    reset();
    await drop(linkedToken());
    assert.deepEqual(dels, [["ActiveEffect", "fe"]], "the fuse record only; the deleted token is not its own other token, and an unlinked token of the base actor is another body");
    assert.deepEqual(told, [expected()]);
    // Another linked token on a scene nobody views: the fuse stays.
    gameStub.scenes = [{ tokens: [] }, { tokens: [{ actorLink: true, actorId: "a1", uuid: "T.far" }] }];
    reset();
    await drop(linkedToken());
    assert.deepEqual([dels, told], [[], []], "the actor still stands as another token");
    // The canvas still lists a sibling.
    const withSibling = linkedToken();
    withSibling.actor.getActiveTokens = () => [withSibling, { uuid: "T.t2", id: "t2" }];
    gameStub.scenes = [];
    await drop(withSibling);
    assert.deepEqual([dels, told], [[], []], "a sibling on the viewed scene");
    // An unlinked token: its actor and its fuse go with it, so nothing is deleted and the Judge is told.
    const synthetic = { isToken: true, uuid: "A.syn", name: "Bearer", effects: [fuseEffect], deleteEmbeddedDocuments: async () => { throw new Error("an unlinked actor's record goes with the token"); } };
    const unlinked = { id: "t3", uuid: "T.t3", actorLink: false, actor: synthetic };
    synthetic.token = unlinked;
    await drop(unlinked);
    assert.deepEqual([dels, told], [[], [expected({ actorUuid: "A.syn" })]]);
    // An unlinked token whose actor is no longer built is read from its own delta.
    reset();
    await drop({ id: "t4", uuid: "T.t4", name: "Delta", actorLink: false, actor: null, delta: { effects: [fuseEffect] } });
    assert.deepEqual([dels, told], [[], [expected({ actorName: "Delta", actorUuid: "T.t4" })]]);
    // A deleted token whose actor carries no fuse tells nobody; a record that is no fuse is none.
    reset();
    const quiet2 = linkedToken();
    quiet2.actor.effects = [plain, { id: "bad", flags: { "acks-extras": { fuse: { source: "I.1" } } } }];
    gameStub.scenes = [];
    await drop(quiet2);
    await drop({ id: "t5", uuid: "T.t5", actorLink: false, actor: null });
    assert.deepEqual([dels, told], [[], []]);
    // Not the primary GM's window: nothing.
    seatOf(false);
    await drop(linkedToken());
    assert.deepEqual([dels, told], [[], []], "not the primary GM's window");
  } finally {
    seatOf(true);
    gameStub.scenes = priorScenes;
    run.setUsePresenter(async (result) => presented.push(result));
  }
});

await t("a burst whose bearer has no token on any scene bursts nothing and says so, on a fumble or the world clock alike; a linked token on another scene is a bearer", async () => {
  const world = stageFuseWorld([bodyTok("one", hpActor("one", "owner"))]);
  const seen = [];
  run.setUsePresenter(async (result) => seen.push(result));
  const record = { source: "I.1", activationId: "act", spot: spotOne };
  try {
    itemFlags = fuseFlags();
    bearerActor.getActiveTokens = () => [];
    RollStub.queue.push(11);
    const lost = await run.burstFuse({ actor: bearerActor, record });
    assert.deepEqual(lost, { ok: false, kind: "burst", activationId: "act", itemUuid: "I.1", itemName: "Gear", actorName: "Bearer", actorUuid: "A.1", reason: "noBearer" });
    assert.equal(seen.at(-1), lost, "the presenter is told which fuse");
    assert.deepEqual([RollStub.posted, world.ops.updates, world.ops.deleted], [[], [], []], "nothing rolled, nothing consumed");
    // The world clock's leg: the record goes, then the burst says so.
    const order = [];
    bearerActor.effects = [{ id: "fe", uuid: "E.fe", flags: { "acks-extras": { fuse: { ...record, dueAt: 5 } } } }];
    bearerActor.deleteEmbeddedDocuments = async (kind, ids) => { order.push(["delete", ...ids]); };
    seen.length = 0;
    await run.liftWorldFuses([bearerActor], 6, { burst: run.burstFuse });
    assert.deepEqual([order, seen.map((r) => [r.kind, r.ok, r.reason])], [[["delete", "fe"]], [["burst", false, "noBearer"]]]);
    // A linked token on a scene nobody views is the bearer: the burst goes on to its own checks.
    bearerActor.id = "a1";
    gameStub.scenes = Object.assign([{ tokens: [{ actorLink: true, actorId: "a1", uuid: "T.far" }] }], { get: () => null });
    assert.equal((await run.burstFuse({ actor: bearerActor, record })).reason, "noScene");
  } finally {
    delete bearerActor.id;
    bearerActor.getActiveTokens = () => [bearerTok];
    world.restore();
  }
});

await t("a burst card's Save writes no damage; an Apply, by an owner of the subject, writes it through the card's own figures, Undo gives the hit points back, and a judge case writes nothing", async () => {
  const one = hpActor("one", "owner");
  const two = hpActor("two", "other");
  const world = stageFuseWorld([bodyTok("one", one), bodyTok("two", two)]);
  gameStub.actors = Users.from([one, two]);
  subjects["T.one"] = bodyTok("one", one);
  subjects["T.two"] = bodyTok("two", two);
  subjects["A.one"] = one;
  subjects["A.two"] = two;
  const { newCard } = await import("../scripts/lib/item-run-card-logic.mjs");
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const { applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const target = 12;
  const stored = (over = {}) => ({ ...newCard({ itemUuid: "I.1", rowKey: "burst", activationId: "act", kind: "burst", bearer: { uuid: "", name: "Bearer" }, cardId: "c" }), title: "Gear", rolled: 11, dice: "3d5", types: ["typeA"], reduction: 0.5, saveName: "paralysis", subjects: { "T~one": { uuid: "T.one", name: "Tok one", state: "in", latest: "" }, "T~two": { uuid: "T.two", name: "Tok two", state: "in", latest: "" } }, ...over });
  const message = { flags: { "acks-extras": { itemRunCard: stored() } }, getFlag(scope, key) { return this.flags[scope][key]; }, async update(data) { this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]))); } };
  gameStub.messages = { get: (id) => (id === "MB" ? message : null) };
  const entries = () => message.flags["acks-extras"].itemRunCard.entries;
  const press = (subject, total, over = {}) => executeAsGM("acks-extras.itemRun.press", { itemUuid: "I.1", rowKey: "burst", activationId: "act", subject: `T.${subject}`, messageId: "MB", entryKey: `T~${subject}`, total, target, requestUserId: subject === "one" ? "owner" : "other", ...over });
  const act = (name, payload) => executeAsGM(`acks-extras.itemRun.${name}`, { messageId: "MB", ...payload });
  const priorLookup = globalThis.fromUuidSync;
  try {
    itemFlags = {};
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? null : priorLookup(uuid));
    assert.equal((await press("one", 5, { target: target + 1 })).reason, "figure", "the card's save is recomputed here, not taken from the request");
    const failed = await press("one", 5);
    assert.deepEqual([failed.ok, failed.saved, failed.entry.state, failed.entry.recordIds, failed.entry.hp], [true, false, "rolled", [], undefined], "the item is gone and the card's own save stands; the verdict is the entry's, nothing is written");
    assert.equal(one.system.hp.value, 20, "a Save writes no damage");
    assert.equal((await press("one", 5)).reason, "applied", "a second Save is refused");
    assert.equal((await press("two", 15)).entry.saved, true);
    assert.equal((await act("apply", { entryKey: "T~one", requestUserId: "other" })).reason, "notOwner", "a seat that does not own the subject");
    assert.equal((await act("apply", { entryKey: "T~gone" })).reason, "gone");
    const some = await act("applyAll", { requestUserId: "owner" });
    assert.deepEqual([some.applied, some.refused], [["T~one"], [{ key: "T~two", reason: "notOwner" }]], "Apply all applies the rows the seat owns and names the rest");
    assert.deepEqual([one.system.hp.value, entries()["T~one"].state, entries()["T~one"].hp, entries()["T~one"].amount], [9, "applied", [{ uuid: "A.one", amount: 11 }], 11], "a failed save takes the whole roll, and the hit points actually taken are stored");
    assert.equal((await act("apply", { entryKey: "T~one" })).reason, "applied", "a second Apply is refused");
    // Undo gives them back, by the stored amount.
    assert.equal((await act("undo", { entryKey: "T~one", requestUserId: "other" })).reason, "notOwner");
    const undone = await act("undo", { entryKey: "T~one", requestUserId: "owner" });
    assert.equal(undone.ok, true);
    assert.deepEqual([one.system.hp.value, entries()["T~one"].state, entries()["T~one"].hp], [20, "undone", []]);
    assert.equal((await act("undo", { entryKey: "T~one", requestUserId: "owner" })).reason, "applied", "an undone entry is not undone twice");
    assert.equal((await act("apply", { entryKey: "T~one" })).reason, "applied", "nor applied again");
    // The Judge's Apply all takes the rest: a saved subject keeps the share the save leaves.
    const rest = await act("applyAll", {});
    assert.deepEqual([rest.applied, rest.refused], [["T~two"], []]);
    assert.deepEqual([two.system.hp.value, entries()["T~two"].amount], [14, 6], "11 less half, one rounding at the end");
    // A saved subject with no reduction imported is the Judge's: nothing is written.
    message.flags["acks-extras"].itemRunCard = stored({ reduction: null });
    two.system.hp.value = 20;
    assert.equal((await press("two", 15)).entry.state, "rolled");
    const judged = await act("apply", { entryKey: "T~two" });
    assert.deepEqual([judged.ok, judged.state, entries()["T~two"].why, two.system.hp.value, "hp" in entries()["T~two"]], [true, "judge", "figure", 20, false]);
    assert.equal((await act("undo", { entryKey: "T~two", requestUserId: "other" })).reason, "applied", "a judge entry wrote nothing to undo");
    // A body the card lists that is gone is the Judge's too.
    message.flags["acks-extras"].itemRunCard = stored();
    assert.equal((await press("one", 5)).entry.state, "rolled");
    delete subjects["T.one"];
    assert.deepEqual([(await act("apply", { entryKey: "T~one" })).state, entries()["T~one"].why], ["judge", "gone"]);
  } finally {
    globalThis.fromUuidSync = priorLookup;
    delete gameStub.messages;
    delete subjects["T.one"];
    delete subjects["T.two"];
    delete subjects["A.one"];
    delete subjects["A.two"];
    world.restore();
  }
});

await t("a burst card that names no save is settled by the Judge's declared verdict: no throw, no total or target on the entry, a player's seat and a card that names a save refused", async () => {
  const one = hpActor("one", "owner");
  const world = stageFuseWorld([bodyTok("one", one)]);
  gameStub.actors = Users.from([one]);
  subjects["T.one"] = bodyTok("one", one);
  subjects["A.one"] = one;
  const { newCard, applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const stored = (over = {}) => ({ ...newCard({ itemUuid: "I.1", rowKey: "burst", activationId: "act", kind: "burst", bearer: { uuid: "", name: "Bearer" }, cardId: "c" }), title: "Gear", rolled: 11, dice: "3d5", types: ["typeA"], reduction: 0.5, saveName: "", subjects: { "T~one": { uuid: "T.one", name: "Tok one", state: "in", latest: "" } }, ...over });
  const message = { id: "MB", flags: { "acks-extras": { itemRunCard: stored() } }, getFlag(scope, key) { return this.flags[scope][key]; }, async update(data) { this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]))); } };
  gameStub.messages = { get: (id) => (id === "MB" ? message : null) };
  const entry = () => message.flags["acks-extras"].itemRunCard.entries?.["T~one"];
  const base = { itemUuid: "I.1", rowKey: "burst", activationId: "act", subject: "T.one", messageId: "MB", entryKey: "T~one" };
  const relayed = (declared, requestUserId) => executeAsGM("acks-extras.itemRun.press", { ...base, declared, requestUserId });
  const priorLookup = globalThis.fromUuidSync;
  const priorUser = gameStub.user;
  try {
    itemFlags = {};
    globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? null : priorLookup(uuid));
    assert.deepEqual(await relayed(true, "owner"), { ok: false, reason: "judgeOnly" }, "the subject's owner relaying the call is not the Judge");
    assert.equal(entry(), undefined, "nothing written for a refusal");
    assert.deepEqual(await executeAsGM("acks-extras.itemRun.press", { ...base, total: 5, target: 12, requestUserId: "owner" }), { ok: false, reason: "noFigure" }, "an ordinary press on a blank save is still refused");
    // The Judge's own seat declares; a failed call is a verdict like a passed one.
    gameStub.user = { id: "gm", isGM: true };
    RollStub.posted.length = 0;
    const passed = await run.pressRoll({ ...base, declared: true });
    assert.deepEqual([passed.ok, passed.saved, passed.entry.state, passed.entry.saved, passed.entry.declared, "total" in passed.entry, "target" in passed.entry, RollStub.posted], [true, true, "rolled", true, true, false, false, []], "the entry holds the verdict and the call, and nothing was rolled");
    assert.equal((await run.pressRoll({ ...base, declared: false })).reason, "applied", "the entry is settled once");
    message.flags["acks-extras"].itemRunCard = stored();
    const failed = await run.pressRoll({ ...base, declared: false });
    assert.deepEqual([failed.ok, failed.saved, entry().saved, entry().declared], [true, false, false, true]);
    assert.equal((await executeAsGM("acks-extras.itemRun.apply", { messageId: "MB", entryKey: "T~one" })).ok, true, "the verdict is applied as a rolled one is: a failed call takes the whole roll");
    assert.equal(one.system.hp.value, 9);
    const undone = await executeAsGM("acks-extras.itemRun.undo", { messageId: "MB", entryKey: "T~one" });
    assert.deepEqual([undone.ok, one.system.hp.value, entry().state], [true, 20, "undone"], "the Undo works on a declared entry unchanged");
    // A player's seat is refused before anything is relayed.
    message.flags["acks-extras"].itemRunCard = stored();
    gameStub.user = { id: "owner", isGM: false };
    assert.deepEqual(await run.pressRoll({ ...base, declared: true }), { ok: false, reason: "judgeOnly" });
    // A card that names a save takes no declared verdict, from the Judge's seat or by relay.
    gameStub.user = { id: "gm", isGM: true };
    message.flags["acks-extras"].itemRunCard = stored({ saveName: "paralysis" });
    assert.deepEqual(await run.pressRoll({ ...base, declared: true }), { ok: false, reason: "figure" });
    assert.equal(entry(), undefined);
  } finally {
    gameStub.user = priorUser;
    globalThis.fromUuidSync = priorLookup;
    delete gameStub.messages;
    delete subjects["T.one"];
    delete subjects["A.one"];
    world.restore();
  }
});

await t("a fuse's owner moves its spot and sets it off, a seat that does not own the bearer is refused by ownership, the record goes before the burst, and a gone scene bursts nothing", async () => {
  const world = stageFuseWorld([bearerTok]);
  bearerTok.testInsideRegion = () => true;
  const order = [];
  const effect = { id: "fe", uuid: "E.fe", flags: { "acks-extras": { fuse: { source: "I.1", activationId: "act9", spot: spotOne, dueAt: 5 } } }, update: async (data) => { order.push(["update", data]); } };
  bearerActor.effects = [effect];
  bearerActor.deleteEmbeddedDocuments = async (kind, ids) => { order.push(["delete", ...ids]); bearerActor.effects = []; };
  gameStub.actors = Users.from([bearerActor]);
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const seen = [];
  run.setUsePresenter(async (result) => { order.push(["present", result.kind, result.ok]); seen.push(result); });
  const as = (name, payload, requestUserId) => executeAsGM(`acks-extras.itemRun.${name}`, { activationId: "act9", ...payload, requestUserId });
  try {
    itemFlags = fuseFlags();
    const to = { sceneId: "S1", x: 5, y: 6 };
    assert.equal((await as("moveSpot", { spot: to }, "other")).reason, "notOwner", "ownership of the bearer's actor, by Foundry's test");
    assert.equal((await as("moveSpot", { spot: { x: 1, y: 2 } }, "owner")).reason, "noSpot");
    assert.equal((await as("moveSpot", { spot: { sceneId: "S9", x: 1, y: 2 } }, "owner")).reason, "noScene");
    assert.equal((await as("moveSpot", { spot: to, activationId: "none" }, "owner")).reason, "gone");
    assert.deepEqual(order, [], "nothing written by a refusal");
    const moved = await as("moveSpot", { spot: to }, "owner");
    assert.deepEqual([moved.ok, moved.spot], [true, { sceneId: "S1", x: 5, y: 6, elevation: 0, level: "" }], "every key is written, so a stale level never survives");
    assert.deepEqual(order, [["update", { "flags.acks-extras.fuse.spot": moved.spot }]]);
    assert.deepEqual((await run.moveFuseSpot({ activationId: "act9", spot: spotOne })).spot, spotOne, "the Judge's own seat, through the exported control");
    order.length = 0;
    assert.equal((await as("setOff", {}, "other")).reason, "notOwner");
    assert.deepEqual(order, [], "the record is still there");
    RollStub.queue.push(8);
    const off = await as("setOff", {}, "owner");
    assert.deepEqual([off.ok, off.burst.kind, off.burst.blank], [true, "burst", false]);
    assert.deepEqual(order, [["delete", "fe"], ["present", "burst", true]], "the record is deleted first, then it bursts");
    assert.equal((await as("setOff", {}, "owner")).reason, "gone", "a fuse set off is no fuse");
    // A spot whose scene is gone: the record goes, nothing bursts, and the Judge is told.
    bearerActor.effects = [{ ...effect, flags: { "acks-extras": { fuse: { source: "I.1", activationId: "act9", spot: { ...spotOne, sceneId: "S9" }, dueAt: 5 } } } }];
    order.length = 0;
    RollStub.posted.length = 0;
    const lost = await run.setFuseOffNow({ activationId: "act9" });
    assert.deepEqual([lost.ok, lost.burst.ok, lost.burst.reason, RollStub.posted], [true, false, "noScene", []]);
    assert.deepEqual(order, [["delete", "fe"], ["present", "burst", false]]);
    // A world-clock fuse that comes due over a gone scene is the same.
    bearerActor.effects = [{ ...effect, flags: { "acks-extras": { fuse: { source: "I.1", activationId: "act8", spot: { ...spotOne, sceneId: "S9" }, dueAt: 5 } } } }];
    order.length = 0;
    await run.liftWorldFuses([bearerActor], 6, { burst: run.burstFuse });
    assert.deepEqual(order, [["delete", "fe"], ["present", "burst", false]], "the stepper's own burst says so too");
  } finally {
    world.restore();
  }
});

await t("a burst's vehicle row is handed on by an owner of the vehicle to the one registered structure writer, once, with the burst's rolled total, and is refused where nothing is registered or the writer refuses", async () => {
  const veh = hpActor("veh", "owner", 20, "acks-extras.vehicle");
  const veh2 = hpActor("veh2", "owner", 20, "acks-extras.vehicle");
  const world = stageFuseWorld([]);
  subjects["T.veh"] = bodyTok("veh", veh);
  subjects["T.veh2"] = bodyTok("veh2", veh2);
  const { newCard, applyPatch } = await import("../scripts/lib/item-run-card-logic.mjs");
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  const message = {
    flags: { "acks-extras": { itemRunCard: { ...newCard({ itemUuid: "I.1", rowKey: "burst", activationId: "act", kind: "burst", bearer: { uuid: "", name: "Bearer" }, cardId: "c" }), rolled: 11, vehicles: { "T~veh": { uuid: "T.veh", name: "Tok veh", state: "open" }, "T~veh2": { uuid: "T.veh2", name: "Tok veh2", state: "open" } } } } },
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(data) { this.flags["acks-extras"].itemRunCard = applyPatch(this.flags["acks-extras"].itemRunCard, Object.fromEntries(Object.entries(data).map(([path, value]) => [path.replace("flags.acks-extras.itemRunCard.", ""), value]))); },
  };
  gameStub.messages = { get: (id) => (id === "MV" ? message : null) };
  const hand = (vehicleUuid, requestUserId) => executeAsGM("acks-extras.itemRun.handOn", { messageId: "MV", vehicleUuid, requestUserId });
  const rows = () => message.flags["acks-extras"].itemRunCard.vehicles;
  const calls = [];
  try {
    assert.equal((await hand("T.veh", "owner")).reason, "noStructure", "nothing registered: refused");
    run.registerStructureDamage(async (call) => { calls.push(call); return call.vehicleUuid === "T.veh2" ? { ok: false, reason: "hull" } : undefined; });
    assert.equal((await hand("T.veh", "other")).reason, "notOwner", "ownership of the vehicle, never a role");
    assert.equal((await hand("T.none", "owner")).reason, "gone", "a vehicle the card does not list");
    assert.deepEqual(calls, []);
    assert.deepEqual(await hand("T.veh", "owner"), { ok: true, state: "handed" });
    assert.deepEqual(calls, [{ vehicleUuid: "T.veh", total: 11, userId: "owner" }], "the burst's own rolled total, and who handed it on");
    assert.deepEqual([rows()["T~veh"].state, rows()["T~veh"].handedBy], ["handed", "owner"]);
    assert.equal((await hand("T.veh", "owner")).reason, "applied", "handed once");
    assert.equal((await run.handOn({ messageId: "MV", vehicleUuid: "T.veh" })).reason, "applied", "the Judge's seat is told the same");
    assert.equal((await hand("T.veh2", "owner")).reason, "hull", "the writer's own refusal");
    assert.equal(rows()["T~veh2"].state, "open", "a refused row stays open");
    run.registerStructureDamage(null);
    assert.equal((await hand("T.veh2", "owner")).reason, "noStructure", "clearing it unregisters");
  } finally {
    run.registerStructureDamage(null);
    delete gameStub.messages;
    delete subjects["T.veh"];
    delete subjects["T.veh2"];
    world.restore();
  }
});

console.log(`\ntest-item-run: ${passed} checks passed.`);
