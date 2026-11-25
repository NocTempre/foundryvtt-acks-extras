/**
 * Offline tests for a chart row's Delete, the Foundry-free half
 * (scripts/lib/org-delete-logic.mjs): who is offered Delete and Undo, what the warning lists and
 * names on its one tick under each gate outcome, which linked actors a one-click Delete takes, the
 * merge an Undo makes into the chart as it stands, and the one step of memory. Every name and key
 * in here is invented.
 *
 * Run: node tools/test-org-delete.mjs
 */
import assert from "node:assert/strict";
import { deleteOffered, linkedToDelete, makeUndoMemory, planUndo, undoOffered, undoView, warningModel } from "../scripts/lib/org-delete-logic.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const row = (key, parentKey = "", holderUuid = "", extra = {}) => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {}, ...extra });
const shape = (rows) => rows.map((r) => `${r.key}<${r.parentKey}`);
const GOING = [{ key: "w", label: "Warband", group: "Warband group" }, { key: "a", label: "Gang A", group: "Gang A group" }, { key: "b", label: "Gang B" }];
const person = (name, canDelete) => ({ uuid: `Actor.${name}`, name, canDelete });

t("Delete is offered only to a seat that owns the host and may delete every group the Delete takes", () => {
  assert.equal(deleteOffered({ owns: true, groups: [{ canDelete: true }, { canDelete: true }] }), true);
  assert.equal(deleteOffered({ owns: true, groups: [] }), true, "a row naming no group takes none");
  assert.equal(deleteOffered({ owns: true, groups: [{ canDelete: true }, { canDelete: false }] }), false, "one group the seat cannot delete withdraws it");
  assert.equal(deleteOffered({ owns: false, groups: [{ canDelete: true }] }), false, "the host's rows are written, so the seat must own it");
  assert.equal(deleteOffered(), false);
  assert.equal(deleteOffered({ owns: true, groups: [{ canDelete: true }], takesHost: true }), false, "a Delete that would take the host itself is not offered");
});

t("the warning's one tick names the linked actors the seat may delete, and starts at the saved choice", () => {
  const linked = [person("Chief", true), person("Captain", true)];
  const on = warningModel({ going: GOING, prototypes: 2, linked, saved: true });
  assert.deepEqual([on.top, on.rowCount, on.prototypes], ["Warband", 2, 2]);
  assert.deepEqual(on.rows, [{ label: "Warband", group: "Warband group" }, { label: "Gang A", group: "Gang A group" }, { label: "Gang B", group: "" }], "each row with the group it holds");
  assert.deepEqual(on.tick, { names: ["Chief", "Captain"], uuids: ["Actor.Chief", "Actor.Captain"], checked: true });
  assert.deepEqual(on.stays, []);
  assert.equal(warningModel({ going: GOING, linked, saved: false }).tick.checked, false, "the saved choice off starts the tick off");
});

t("a linked actor the seat may not delete is a plain stays line, and with none deletable there is no tick", () => {
  const mixed = warningModel({ going: GOING, linked: [person("Chief", true), person("Warden", false)], saved: true });
  assert.deepEqual(mixed.tick.names, ["Chief"]);
  assert.deepEqual(mixed.stays, ["Warden"]);
  const none = warningModel({ going: GOING, linked: [person("Warden", false)], saved: true });
  assert.equal(none.tick, null);
  assert.deepEqual(none.stays, ["Warden"]);
  assert.equal(warningModel({ going: GOING, linked: [], saved: true }).tick, null, "a Delete with no linked actor has nothing to tick");
});

t("a one-click Delete takes the deletable linked actors where the saved choice is on, and none where it is off", () => {
  const linked = [person("Chief", true), person("Warden", false)];
  assert.deepEqual(linkedToDelete({ linked, saved: true }), ["Actor.Chief"]);
  assert.deepEqual(linkedToDelete({ linked, saved: false }), []);
  assert.deepEqual(linkedToDelete({ linked: [], saved: true }), []);
});

t("Undo is offered only to a seat that creates actors and owns the host; otherwise the strip shows without it", () => {
  assert.equal(undoOffered({ canCreate: true, owns: true }), true);
  assert.equal(undoOffered({ canCreate: false, owns: true }), false);
  assert.equal(undoOffered({ canCreate: true, owns: false }), false);
  const step = { label: "Warband", keys: ["w", "a", "b"] };
  assert.deepEqual(undoView(step, { canCreate: true, owns: true }), { label: "Warband", n: 2, canUndo: true });
  assert.deepEqual(undoView(step, { canCreate: false, owns: true }), { label: "Warband", n: 2, canUndo: false });
  assert.equal(undoView({ label: "Gang", keys: ["g"] }, {}).n, 0, "a row on its own has none beneath it");
  assert.equal(undoView(null, { canCreate: true, owns: true }), null);
});

const BEFORE = [row("v", "", "G.v"), row("w", "v", "G.w"), row("a", "w", "G.a"), row("b", "w", "G.b"), row("s", "v", "G.s")];
const snapshot = (over = {}) => ({ keys: ["w", "a", "b"], rows: BEFORE, leaderUuid: "", ...over });

t("an Undo re-inserts the rows a Delete took where they stood, under their own parents", () => {
  const now = [row("v", "", "G.v"), row("s", "v", "G.s")];
  const plan = planUndo({ snapshot: snapshot(), rows: now });
  assert.deepEqual(shape(plan.rows), ["v<", "w<v", "a<w", "b<w", "s<v"]);
  assert.equal(plan.leader, null);
});

t("an Undo whose top row's parent has gone since puts that row at the top, and its own rows stay under it", () => {
  const now = [row("s", "", "G.s")];
  const plan = planUndo({ snapshot: snapshot(), rows: now });
  assert.deepEqual(shape(plan.rows), ["w<", "a<w", "b<w", "s<"], "v is gone, so w goes to the top");
});

t("an Undo keeps the chart's present rows as they are and leaves a row added since at the end", () => {
  const now = [row("v", "", "G.v", { label: "Edited" }), row("s", "v", "G.s"), row("n", "v", "")];
  const plan = planUndo({ snapshot: snapshot(), rows: now });
  assert.deepEqual(shape(plan.rows), ["v<", "w<v", "a<w", "b<w", "s<v", "n<v"]);
  assert.equal(plan.rows[0].label, "Edited", "a surviving row keeps its present form");
});

t("an Undo restores the faction's leader only where the field is still blank, and never replaces one set since", () => {
  const was = snapshot({ leaderUuid: "Actor.Chief" });
  assert.equal(planUndo({ snapshot: was, rows: [], leaderUuid: "" }).leader, "Actor.Chief");
  assert.equal(planUndo({ snapshot: was, rows: [], leaderUuid: "Actor.Other" }).leader, null);
  assert.equal(planUndo({ snapshot: snapshot(), rows: [], leaderUuid: "" }).leader, null, "a Delete that cleared no leader restores none");
});

t("the memory holds one step for a window: a second Delete replaces it, a drop empties it, another window never sees it", () => {
  const memory = makeUndoMemory();
  const a = {};
  const b = {};
  assert.equal(memory.peek(a), null);
  memory.hold(a, { label: "first" });
  memory.hold(a, { label: "second" });
  assert.equal(memory.peek(a).label, "second", "the second Delete replaced the first");
  assert.equal(memory.peek(b), null, "another window holds nothing");
  memory.drop(a);
  assert.equal(memory.peek(a), null);
  assert.equal(makeUndoMemory().peek(a), null, "a reload starts with a new memory");
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
console.log(`\ntest-org-delete: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
