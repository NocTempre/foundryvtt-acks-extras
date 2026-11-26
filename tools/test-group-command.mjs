/**
 * Offline tests for a group's command status (scripts/lib/data/group-data.mjs
 * `troopCounts` and `commandStatus`, decided in scripts/lib/group-logic.mjs): the
 * living bodies counted by arm, and the status read against rungs passed in. Its
 * command morale is read through the real getter, over a chart of units
 * (scripts/lib/org-host.mjs): each unit above a group adds its officer's part while
 * that officer is up. Every level, count and figure in here is invented.
 *
 * Run: node tools/test-group-command.mjs
 */
import assert from "node:assert/strict";

/** The callbacks the lib registered on Foundry's hooks, by hook name. */
const handlers = {};
globalThis.Hooks = {
  on: (name, fn) => (handlers[name] ??= []).push(fn),
  call: () => true,
  callAll() {},
};
const fire = (name, ...args) => (handlers[name] ?? []).forEach((fn) => fn(...args));
/** A field that keeps its options and the fields it nests, so the schema's ranges can be read back. */
const keeping = class {
  constructor(first, second) {
    this.options = second ?? first;
    this.fields = first;
  }
};
globalThis.foundry = {
  abstract: { TypeDataModel: class { async _preUpdate() {} } },
  data: { fields: new Proxy({}, { get: () => keeping }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
  },
};

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const groupLogic = await import("../scripts/lib/group-logic.mjs");
const org = await import("../scripts/lib/org-host.mjs");
const { registerOrgIndex } = org;
registerOrgIndex();

const RUNGS = [
  { level: 2, infantry: 6, cavalry: 3 },
  { level: 5, infantry: 24, cavalry: 11 },
];

/** A group data model holding the stacks and the cached officer level given. */
const group = (stacks, officerLevel) =>
  Object.assign(Object.create(GroupData.prototype), {
    stacks: stacks.map(([current, mounted]) => ({ size: { current }, mounted })),
    unit: { officerLevel },
  });

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("troopCounts keeps each arm apart and counts no body twice", () => {
  assert.deepEqual(group([[10, false], [4, true], [3, false], [2, true]], 0).troopCounts, { infantry: 13, cavalry: 6 });
  assert.deepEqual(group([], 0).troopCounts, { infantry: 0, cavalry: 0 });
  assert.deepEqual(group([[0, true]], 0).troopCounts, { infantry: 0, cavalry: 0 });
});

t("commandStatus reads the officer's level against the rungs passed in", () => {
  assert.deepEqual(group([[24, false]], 5).commandStatus(RUNGS), { over: false, rung: RUNGS[1] });
  assert.equal(group([[25, false]], 5).commandStatus(RUNGS).over, true);
  assert.equal(group([[25, false]], 2).commandStatus(RUNGS).over, true, "the same unit under a lower rung");
  assert.equal(group([[12, false], [5, true]], 5).commandStatus(RUNGS).over, false, "a mixed unit whose shares sum under one");
  assert.equal(group([[12, false], [6, true]], 5).commandStatus(RUNGS).over, true, "a mixed unit whose shares sum past one");
});

t("commandStatus keeps its three states apart", () => {
  assert.equal(group([[40, false]], 5).commandStatus([]), null, "nothing imported: no status");
  assert.deepEqual(group([[1, false]], 1).commandStatus(RUNGS), { over: true, rung: null }, "an officer under the lowest rung");
  assert.deepEqual(group([[1, false]], undefined).commandStatus(RUNGS), { over: true, rung: null }, "no officer read is level zero");
  assert.deepEqual(group([[0, false]], 1).commandStatus(RUNGS), { over: false, rung: null }, "no troops is never over");
});

/* -------------------------------------------- */
/*  Morale from the units above (an organisation chart)  */
/* -------------------------------------------- */

/** The world's documents by uuid, and what `game.actors` iterates. */
const world = new Map();
globalThis.game = { actors: { [Symbol.iterator]: () => world.values() } };
globalThis.fromUuidSync = (uuid) => world.get(uuid) ?? null;

const unitRow = (key, parentKey, holderUuid) => ({ key, parentKey, label: key, holderUuid, kind: "", notes: "", hidden: false, gen: {} });

/** A group document over the real data model: `unit` and `units` as given. */
function groupDoc(id, { unit = {}, units = [] } = {}) {
  const system = Object.assign(Object.create(GroupData.prototype), { stacks: [], unit: { morale: 0, ...unit }, units });
  const doc = { id, uuid: `Actor.${id}`, type: "acks-extras.group", system };
  system.parent = doc;
  world.set(doc.uuid, doc);
  return doc;
}

/** A lone actor for an officer. */
function officerDoc(id, { hp = 6, dead = false } = {}) {
  const doc = { id, uuid: `Actor.${id}`, type: "character", system: { hp: { value: hp } }, statuses: new Set(dead ? ["dead"] : []) };
  world.set(doc.uuid, doc);
  return doc;
}

/**
 * A village, a warband and two gangs' worth of units, each its own group with an
 * officer of its own: the village's and the warband's parts reach the gang, the
 * gang's own stands for the gang alone. The chart sits on a faction or on the top group.
 */
function village({ chiefHp = 6, chiefDead = false, host = "faction" } = {}) {
  world.clear();
  const chief = officerDoc("chief", { hp: chiefHp, dead: chiefDead });
  const sub = officerDoc("sub");
  const champion = officerDoc("champion");
  const v = groupDoc("v", { unit: { officerUuid: chief.uuid, officerMoraleBonus: 3 } });
  const w = groupDoc("w", { unit: { officerUuid: sub.uuid, officerMoraleBonus: 1, morale: 1 } });
  const g = groupDoc("g", { unit: { officerUuid: champion.uuid, officerMoraleBonus: 2, morale: 0 } });
  const rows = [unitRow("v", "", v.uuid), unitRow("w", "v", w.uuid), unitRow("g", "w", g.uuid)];
  if (host === "faction") world.set("Actor.f", { id: "f", uuid: "Actor.f", type: "acks-extras.faction", system: { units: rows } });
  else v.system.units = rows;
  fire("createActor");
  return { chief, v, w, g };
}

t("a gang's morale takes the part of each unit above it while that unit's officer is up", () => {
  const { g, w, v } = village();
  assert.equal(g.system.commandMorale, 2 + 1 + 3, "its own officer's part, the warband's and the village's");
  assert.equal(w.system.commandMorale, 1 + 1 + 3, "the warband's own morale and part, and the village's");
  assert.equal(v.system.commandMorale, 3, "a top unit takes only its own officer's");
});

t("a chieftain who falls takes the part from every unit under it", () => {
  const down = village({ chiefHp: 0 });
  assert.equal(down.g.system.commandMorale, 2 + 1, "at zero hit points");
  assert.equal(down.w.system.commandMorale, 1 + 1);
  const dead = village({ chiefDead: true });
  assert.equal(dead.g.system.commandMorale, 2 + 1, "marked dead");
  const up = village();
  up.chief.system.hp.value = 1;
  assert.equal(up.g.system.commandMorale, 6, "a wounded chieftain who still stands leads");
  up.chief.system.hp.value = 0;
  assert.equal(up.g.system.commandMorale, 3, "and the part is gone the moment he falls");
});

t("a chart hosted on a group reads the same, with no faction", () => {
  const { g, w } = village({ host: "group" });
  assert.equal(g.system.commandMorale, 6);
  assert.equal(w.system.commandMorale, 5);
});

t("a group no chart names, and an officer that does not resolve, take nothing from above", () => {
  const lone = groupDoc("lone", { unit: { morale: 1, officerMoraleBonus: 1 } });
  assert.equal(lone.system.commandMorale, 1, "a bonus with no officer linked adds nothing, the group's own morale stands");
  const { g, chief } = village();
  world.delete(chief.uuid);
  assert.equal(g.system.commandMorale, 2 + 1, "the village's officer is gone");
});

t("the part reaches a single-stack gang's unit morale", () => {
  const { g } = village();
  g.system.stacks = [{ baseMorale: 1 }];
  assert.equal(g.system.unitMoraleOf(g.system.stacks[0]), 1 + 2 + 1 + 3);
});

t("a gang's unlinked token reads its base actor's chart", () => {
  const { g } = village();
  const synthetic = Object.assign(Object.create(GroupData.prototype), { stacks: [], unit: { morale: 0, officerMoraleBonus: 2 } });
  synthetic.parent = { uuid: "Scene.s.Token.t.Actor.g", isToken: true, baseActor: g };
  assert.equal(synthetic.commandMorale, 2 + 1 + 3);
  world.get("Actor.champion").system.hp.value = 0;
  assert.equal(synthetic.commandMorale, 1 + 3, "and its own officer's part is the base actor's, down with that officer");
});

t("a row on a faction and on a group answers by the faction", () => {
  const { g, v } = village();
  // The gang's row has also been written onto the village group's own chart, at the top of it.
  v.system.units = [unitRow("g", "", g.uuid)];
  fire("updateActor", v, { system: { units: [] } });
  assert.equal(g.system.commandMorale, 6, "the faction's rows, where the gang stands under the warband");
});

/* -------------------------------------------- */
/*  A group's own officer, and a negative bonus  */
/* -------------------------------------------- */

t("a group's own officer part applies only while that officer is up, as the part of a unit above it does", () => {
  const { g, v } = village();
  const champion = world.get("Actor.champion");
  const chief = world.get("Actor.chief");
  champion.system.hp.value = 0;
  assert.equal(g.system.commandMorale, 1 + 3, "its own officer is down: only the warband's and the village's parts");
  champion.system.hp.value = 6;
  assert.equal(g.system.commandMorale, 2 + 1 + 3, "up again, the part is back");
  champion.statuses.add("dead");
  assert.equal(g.system.commandMorale, 1 + 3, "marked dead");
  champion.statuses.delete("dead");
  chief.system.hp.value = 0;
  assert.equal(v.system.commandMorale, 0, "a top unit whose officer is down takes nothing");
  world.delete(chief.uuid);
  assert.equal(v.system.commandMorale, 0, "an officer that does not resolve is not up");
});

t("a negative officer bonus subtracts while its officer is up and adds nothing while down", () => {
  const { g, w } = village();
  const champion = world.get("Actor.champion");
  g.system.unit.officerMoraleBonus = -2;
  assert.equal(g.system.commandMorale, -2 + 1 + 3, "up: the group's own negative part and the units above");
  champion.system.hp.value = 0;
  assert.equal(g.system.commandMorale, 1 + 3, "down: it adds nothing, and does not lower the figure");
  w.system.unit.officerMoraleBonus = -1;
  assert.equal(g.system.commandMorale, -1 + 3, "a negative part of a unit above reads the same way");
});

t("the officer part of one unit is the one read the own term and the ancestor read share", () => {
  village();
  const held = (unit) => ({ system: { unit } });
  assert.deepEqual(org.officerPartOf(held({ officerUuid: "Actor.champion", officerMoraleBonus: -3 })), { bonus: -3, up: true });
  assert.equal(org.officerPartOf(held({ officerUuid: "", officerMoraleBonus: 2 })).up, false, "no officer is not up");
  assert.equal(org.officerPartOf(undefined).bonus, null, "no group, no figure");
  const token = { isToken: true, baseActor: held({ officerUuid: "Actor.champion", officerMoraleBonus: 1 }), system: { unit: {} } };
  assert.deepEqual(org.officerPartOf(token), { bonus: 1, up: true }, "an unlinked token's actor reads as its base actor");
  assert.equal(org.officerMoraleOf(held({ officerUuid: "Actor.champion", officerMoraleBonus: -3 })), -3);
});

t("the officer bonus field takes the full signed range", () => {
  const { OFFICER_MORALE_RANGE } = groupLogic;
  assert.deepEqual({ ...OFFICER_MORALE_RANGE }, { min: -4, max: 4 });
  const field = GroupData.defineSchema().unit.fields.officerMoraleBonus.options;
  assert.equal(field.min, OFFICER_MORALE_RANGE.min, "the schema takes a negative bonus");
  assert.equal(field.max, OFFICER_MORALE_RANGE.max);
  assert.equal(field.integer, true);
});

t("clampOfficerMoraleBonus holds a figure to the range and leaves an unread one null", () => {
  const { clampOfficerMoraleBonus } = groupLogic;
  assert.equal(clampOfficerMoraleBonus(-2), -2);
  assert.equal(clampOfficerMoraleBonus(-9), -4);
  assert.equal(clampOfficerMoraleBonus(9), 4);
  assert.equal(clampOfficerMoraleBonus(0), 0, "zero is a figure");
  assert.equal(clampOfficerMoraleBonus(null), null);
  assert.equal(clampOfficerMoraleBonus(undefined), null);
  assert.equal(clampOfficerMoraleBonus(Number.NaN), null);
});

/* -------------------------------------------- */
/*  The model refuses a loop from any writer     */
/* -------------------------------------------- */

/** Three nested groups, `c` inside `b` inside `a`, and `d` standing apart. */
function nest() {
  world.clear();
  const a = groupDoc("a");
  const b = groupDoc("b", { unit: { parentGroupUuid: a.uuid } });
  const c = groupDoc("c", { unit: { parentGroupUuid: b.uuid } });
  const d = groupDoc("d");
  return { a, b, c, d };
}

/** Run the model's `_preUpdate` as core does, with `console.warn` captured. */
async function preUpdate(group, changes) {
  const warned = [];
  const was = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    return { result: await group.system._preUpdate(changes, {}, null), warned };
  } finally {
    console.warn = was;
  }
}

t("a direct write that would nest a group inside its own descendant is refused", async () => {
  const { a, c } = nest();
  const expanded = await preUpdate(a, { system: { unit: { parentGroupUuid: c.uuid } } });
  assert.equal(expanded.result, false, "the expanded shape core hands over");
  assert.ok(expanded.warned.some((m) => m.startsWith("acks-extras |")), "and says so on the console");
  const flat = await preUpdate(a, { "system.unit.parentGroupUuid": c.uuid });
  assert.equal(flat.result, false, "a flat dotted key is caught the same way");
  assert.equal((await preUpdate(a, { system: { unit: { parentGroupUuid: a.uuid } } })).result, false, "a group inside itself");
});

t("a direct write that closes no loop is let through", async () => {
  const { a, c, d } = nest();
  assert.notEqual((await preUpdate(c, { system: { unit: { parentGroupUuid: a.uuid } } })).result, false, "a deeper group moves up");
  assert.notEqual((await preUpdate(d, { system: { unit: { parentGroupUuid: c.uuid } } })).result, false, "an outside group goes inside");
  assert.notEqual((await preUpdate(a, { system: { unit: { parentGroupUuid: "" } } })).result, false, "a blank parent is a group inside none");
  assert.notEqual((await preUpdate(a, { system: { unit: { parentGroupUuid: "Actor.unseen" } } })).result, false, "a parent this client cannot see closes nothing");
  assert.notEqual((await preUpdate(a, { system: { unit: { morale: 1 } } })).result, false, "an update that leaves the parent alone");
  assert.notEqual((await preUpdate(a, { name: "A" })).result, false, "and one that touches no system data");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-group-command: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
