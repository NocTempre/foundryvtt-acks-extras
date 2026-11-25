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
  for (const name of [consts.TURN_BEGAN_HOOK, consts.TURN_ENDED_HOOK, "deleteCombat", "updateWorldTime"]) assert.equal(hooked[name]?.length, 1, `${name} once`);
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
    itemFlags = { itemRun: { activation: { kind: "fuse" }, rows: [] } };
    await refused({}, "noRunner", "warn");
    run.registerActivationRunner("fuse", async () => ({ ok: false, reason: "oddReason" }));
    notes2.length = 0;
    assert.deepEqual(await run.runUse({ itemUuid: "I.1" }), { ok: false, reason: "oddReason" });
    assert.ok(notes2[0][1].endsWith("itemRun.refused.refused"), "a reason it has no line for reads as a plain refusal");
    run.registerActivationRunner("fuse", async () => ({ ok: false }));
    assert.deepEqual(await run.runUse({ itemUuid: "I.1" }), { ok: false, reason: "refused" });
    for (const reason of ["noRange", "down", "unsupported", "notCarried", "snapshot"]) {
      run.registerActivationRunner("fuse", async () => ({ ok: false, reason }));
      await refused({}, reason, "warn");
    }
  } finally {
    run.registerActivationRunner("fuse", null);
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

console.log(`\ntest-item-run: ${passed} checks passed.`);
