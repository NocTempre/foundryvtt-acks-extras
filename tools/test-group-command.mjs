/**
 * Offline tests for a group's command status (scripts/lib/data/group-data.mjs
 * `troopCounts` and `commandStatus`, decided in scripts/lib/group-logic.mjs): the
 * living bodies counted by arm, and the status read against rungs passed in.
 * Every level and count in here is invented.
 *
 * Run: node tools/test-group-command.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { on() {}, call: () => true, callAll() {} };
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: (v) => structuredClone(v) },
};

const { default: GroupData } = await import("../scripts/lib/data/group-data.mjs");

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
