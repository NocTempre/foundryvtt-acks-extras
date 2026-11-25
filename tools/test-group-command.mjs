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
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: (v) => structuredClone(v) },
};

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");
const { registerOrgIndex } = await import("../scripts/lib/org-host.mjs");
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
  const v = groupDoc("v", { unit: { officerUuid: chief.uuid, officerMoraleBonus: 2 } });
  const w = groupDoc("w", { unit: { officerUuid: sub.uuid, officerMoraleBonus: 1, morale: 1 } });
  const g = groupDoc("g", { unit: { officerUuid: champion.uuid, officerMoraleBonus: 3, morale: 0 } });
  const rows = [unitRow("v", "", v.uuid), unitRow("w", "v", w.uuid), unitRow("g", "w", g.uuid)];
  if (host === "faction") world.set("Actor.f", { id: "f", uuid: "Actor.f", type: "acks-extras.faction", system: { units: rows } });
  else v.system.units = rows;
  fire("createActor");
  return { chief, v, w, g };
}

t("a gang's morale takes the part of each unit above it while that unit's officer is up", () => {
  const { g, w, v } = village();
  assert.equal(g.system.commandMorale, 3 + 1 + 2, "its own officer's part, the warband's and the village's");
  assert.equal(w.system.commandMorale, 1 + 1 + 2, "the warband's own morale and part, and the village's");
  assert.equal(v.system.commandMorale, 2, "a top unit takes only its own officer's");
});

t("a chieftain who falls takes the part from every unit under it", () => {
  const down = village({ chiefHp: 0 });
  assert.equal(down.g.system.commandMorale, 3 + 1, "at zero hit points");
  assert.equal(down.w.system.commandMorale, 1 + 1);
  const dead = village({ chiefDead: true });
  assert.equal(dead.g.system.commandMorale, 3 + 1, "marked dead");
  const up = village();
  up.chief.system.hp.value = 1;
  assert.equal(up.g.system.commandMorale, 6, "a wounded chieftain who still stands leads");
  up.chief.system.hp.value = 0;
  assert.equal(up.g.system.commandMorale, 4, "and the part is gone the moment he falls");
});

t("a chart hosted on a group reads the same, with no faction", () => {
  const { g, w } = village({ host: "group" });
  assert.equal(g.system.commandMorale, 6);
  assert.equal(w.system.commandMorale, 4);
});

t("a group no chart names, and an officer that does not resolve, take nothing from above", () => {
  const lone = groupDoc("lone", { unit: { officerMoraleBonus: 1 } });
  assert.equal(lone.system.commandMorale, 1);
  const { g, chief } = village();
  world.delete(chief.uuid);
  assert.equal(g.system.commandMorale, 3 + 1, "the village's officer is gone");
});

t("the part reaches a single-stack gang's unit morale", () => {
  const { g } = village();
  g.system.stacks = [{ baseMorale: 1 }];
  assert.equal(g.system.unitMoraleOf(g.system.stacks[0]), 1 + 3 + 1 + 2);
});

t("a gang's unlinked token reads its base actor's chart", () => {
  const { g } = village();
  const synthetic = Object.assign(Object.create(GroupData.prototype), { stacks: [], unit: { morale: 0, officerMoraleBonus: 3 } });
  synthetic.parent = { uuid: "Scene.s.Token.t.Actor.g", isToken: true, baseActor: g };
  assert.equal(synthetic.commandMorale, 3 + 1 + 2);
});

t("a row on a faction and on a group answers by the faction", () => {
  const { g, v } = village();
  // The gang's row has also been written onto the village group's own chart, at the top of it.
  v.system.units = [unitRow("g", "", g.uuid)];
  fire("updateActor", v, { system: { units: [] } });
  assert.equal(g.system.commandMorale, 6, "the faction's rows, where the gang stands under the warband");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-group-command: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
