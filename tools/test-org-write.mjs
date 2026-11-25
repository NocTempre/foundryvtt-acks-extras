/**
 * Offline tests for the organisation's write plans (scripts/lib/org-write-logic.mjs):
 * the Roll that fills an empty row from a rolled tree, the Add of an empty row and
 * the Edit of a filled one. Every unit word, creature, key and figure in here is
 * invented. What this pins is the procedure: a Roll writes into the row it was
 * pressed on and the rows beneath it and into nothing else, a filled row is never
 * rolled again, one level leaves the units beneath as empty rows that carry what
 * the roll fixed, all below fills them, identical creatures share one prototype
 * across the whole roll, a creature no entry answered is a labelled stack, a leader
 * is an actor named as its group's officer and never a stack, ops come in an order
 * an executor can carry out, and an Edit that touches bodies on a map warns and
 * refuses nothing.
 *
 * Run: node tools/test-org-write.mjs
 */
import assert from "node:assert/strict";
import { keySource, leaderRecord, planAddUnit, planEdit, planRoll } from "../scripts/lib/org-write-logic.mjs";
import { planReparent, wouldCycle } from "../scripts/lib/place-logic.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const row = (key, parentKey = "", holderUuid = "", extra = {}) => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {}, ...extra });

/** A rolled tree: a hold of two bands, the first of two cells, with a camp. Two cells share one creature. */
const node = (key, word, over = {}) => ({ key, word, kind: word, shareKind: "", label: "", camp: false, trait: "", troop: "", officers: [], stacks: [], children: [], ...over });
const TREE = () => {
  const cellA = node("c1", "cell", { shareKind: "archers", stacks: [{ proto: "P1", label: "", count: 4, role: "body", gen: { part: "archers", cite: "XX p. 1" } }], officers: [{ proto: "P3", role: "a", part: "leader-a", moraleBonus: null, troop: "" }] });
  const cellB = node("c2", "cell", { shareKind: "archers", stacks: [{ proto: "P1", label: "", count: 6, role: "body", gen: { part: "archers", cite: "XX p. 1" } }], officers: [{ proto: "P3", role: "a", part: "leader-a", moraleBonus: null, troop: "" }] });
  const band1 = node("b1", "band", { children: [cellA, cellB], officers: [{ proto: "P4", role: "b", part: "leader-b", moraleBonus: null, troop: "" }] });
  const band2 = node("b2", "band", { officers: [{ proto: "P4", role: "b", part: "leader-b", moraleBonus: null, troop: "" }] });
  const camp = node("camp", "", {
    camp: true,
    kind: "",
    stacks: [
      { proto: "P5", label: "zorps", count: 3, role: "guard", gen: { part: "guard-1", cite: "XX p. 2" }, fixedHp: 9 },
      { proto: "P6", label: "folk", count: 2, role: "captive", gen: { part: "captives", cite: "XX p. 2" } },
      { proto: "P7", label: "bens", count: 5, role: "guard", gen: { part: "guard-2", cite: "XX p. 2" } },
    ],
  });
  return {
    top: node("h", "hold", { children: [band1, band2, camp], officers: [{ proto: "P2", role: "c", part: "leader-c", moraleBonus: 2, troop: "", gear: ["g1"], mount: { proto: "P8" } }] }),
    prototypes: {
      P1: { key: "P1", kind: "cell", variant: "alba", role: "", partKey: "archers" },
      P2: { key: "P2", kind: "cell", variant: "alba", role: "c" },
      P3: { key: "P3", kind: "cell", variant: "alba", role: "a" },
      P4: { key: "P4", kind: "cell", variant: "alba", role: "b" },
      P5: { key: "P5", kind: "entry", uuid: "L.zorp" },
      P6: { key: "P6", kind: "label", label: "folk" },
      P7: { key: "P7", kind: "label", label: "bens" },
      P8: { key: "P8", kind: "entry", uuid: "L.mount" },
    },
    gen: { variant: "alba", context: "wilderness", state: "lair", rules: { troops: false } },
    treasure: { deal: true },
    findings: [{ what: "reference", word: "bens" }],
  };
};

const opsOf = (plan, name) => plan.ops.filter((o) => o.op === name);
const HOST = { uuid: "F.1", kind: "faction" };

t("a Roll of one empty row fills it and leaves every other row exactly as it was", () => {
  const rows = [row("v", "", "G.v"), row("w1", "v", "G.w1"), row("w2", "v", ""), row("w3", "v", "G.w3")];
  const before = JSON.stringify(rows);
  const plan = planRoll({ host: HOST, rows, rowKey: "w2", tree: TREE(), scope: "one", newKey: keySource(rows.map((r) => r.key)) });
  assert.equal(plan.ok, true);
  assert.equal(JSON.stringify(rows), before, "the caller's rows are not edited in place");
  for (const key of ["v", "w1", "w3"]) assert.deepEqual(plan.rows.find((r) => r.key === key), rows.find((r) => r.key === key), `row ${key} is identical`);
  const filled = plan.rows.find((r) => r.key === "w2");
  assert.equal(filled.parentKey, "v", "the row keeps its place under its parent");
  assert.equal(filled.label, "Row w2", "and the name the Judge gave it");
  assert.match(filled.holderUuid, /^new:g/);
  assert.deepEqual(filled.gen, { ...TREE().gen, tier: 2, leader: { role: "c", troop: "", moraleBonus: 2 } }, "the generation record rides on the row where the roll began, with the rank the unit stands at and the leader it made");
  assert.equal(plan.rows.indexOf(filled), 2, "the row stays where it stood in the list");
});

t("one level leaves each unit beneath as an empty row that keeps what the roll fixed; the camp is filled", () => {
  const plan = planRoll({ host: HOST, rows: [], rowKey: "", tree: TREE(), scope: "one" });
  const empty = plan.rows.filter((r) => !r.holderUuid);
  assert.deepEqual(empty.map((r) => r.kind), ["band", "band"], "the bands wait to be rolled; nothing of their cells is made");
  assert.equal(opsOf(plan, "createGroup").length, 2, "the hold's group and its camp's");
  assert.equal(plan.rows.length, 4);
  assert.ok(empty.every((r) => r.parentKey === plan.rows[0].key));
});

t("all below fills every unit under the row, nested as the rows nest", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "below" });
  assert.equal(plan.rows.filter((r) => !r.holderUuid).length, 0);
  assert.equal(opsOf(plan, "createGroup").length, 6);
  const parents = opsOf(plan, "parent");
  assert.equal(parents.length, 5, "every group but the top stands inside the group of its parent row");
  const byKind = Object.fromEntries(plan.rows.map((r) => [r.key, r]));
  assert.ok(plan.rows.filter((r) => r.kind === "cell").every((r) => byKind[r.parentKey].kind === "band"));
  assert.equal(plan.rows.find((r) => r.kind === "hold").gen.variant, "alba");
  assert.equal(plan.rows.filter((r) => r.kind !== "hold").every((r) => !r.gen.variant), true, "the record is on the top row only");
});

t("each row keeps its tier and what the roll fixed for it, and each stack the total the roll threw", () => {
  const tree = TREE();
  tree.top.children[0].children[0].troop = "t3";
  const plan = planRoll({ host: HOST, rows: [], tree, scope: "below" });
  const tiers = (kind) => plan.rows.filter((r) => r.kind === kind).map((r) => r.gen.tier);
  assert.deepEqual([tiers("hold"), tiers("band"), tiers("cell")], [[2], [1, 0], [0, 0]], "a unit of units of bodies stands two above them");
  assert.equal(plan.rows.filter((r) => r.kind === "cell").map((r) => r.gen.troop).join(), "t3,", "the troop the roll gave a unit rides on its row");
  const camp = plan.rows.find((r) => r.kind === "" && r.parentKey);
  assert.equal(camp.gen.tier, undefined, "the camp stands at no tier");
  const stacks = opsOf(plan, "addStack");
  assert.ok(stacks.length && stacks.every((o) => o.count === o.gen.rolled), "rolled is the count the stack was made with");
  assert.ok(opsOf(plan, "addLabelledStack").every((o) => o.gen.rolled === o.count));
  const one = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "one" });
  assert.deepEqual(one.rows.filter((r) => !r.holderUuid).map((r) => r.gen.tier), [1, 0], "an empty row keeps its tier too");
});

t("each row records the first leader its roll made, so a hand's Make can make the same one", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "one" });
  const top = plan.rows.find((r) => r.kind === "hold");
  assert.deepEqual(top.gen.leader, { role: "c", troop: "", moraleBonus: 2 });
  const waiting = plan.rows.filter((r) => !r.holderUuid);
  assert.deepEqual(waiting.map((r) => r.gen.leader), [{ role: "b", troop: "" }, { role: "b", troop: "" }], "an empty row records what it will make; a blank morale part is no key");
  const camp = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "below" }).rows.find((r) => r.kind === "" && r.parentKey);
  assert.equal("leader" in camp.gen, false, "a unit with no officer records none");
  assert.deepEqual(leaderRecord({ officers: [{ role: "x", troop: "t1", moraleBonus: 0 }] }), { leader: { role: "x", troop: "t1", moraleBonus: 0 } }, "a morale part of zero is a part");
  assert.deepEqual(leaderRecord({ officers: [{ role: "", troop: "t1" }] }), {}, "an officer with no role is no record");
});

t("a row with a holder is never rolled again, and a row that is not there is refused", () => {
  const rows = [row("w1", "", "G.w1")];
  assert.deepEqual(planRoll({ host: HOST, rows, rowKey: "w1", tree: TREE() }), { ok: false, reason: "filled", ops: [] });
  assert.equal(planRoll({ host: HOST, rows, rowKey: "zz", tree: TREE() }).reason, "noRow");
  assert.equal(planRoll({ host: HOST, rows, tree: null }).reason, "noTree");
});

t("identical creatures across the roll share one prototype; an entry needs none and a label has none", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "below" });
  const protos = opsOf(plan, "prototype");
  assert.deepEqual(protos.map((p) => p.key).sort(), ["P1", "P2", "P3", "P4"], "four creatures minted, for ten stacks and officers");
  const p1 = protos.find((p) => p.key === "P1").ref;
  const stacks = opsOf(plan, "addStack").filter((s) => s.prototype === p1);
  assert.equal(stacks.length, 2, "two cells' stacks name the one prototype");
  assert.deepEqual(stacks.map((s) => s.count).sort(), [4, 6]);
  const guard = opsOf(plan, "addStack").find((s) => s.gen.part === "guard-1");
  assert.equal(guard.prototype, "L.zorp", "a resolved outside reference is a stack built from that entry");
  assert.equal(guard.fixedHp, 9);
});

t("a creature no entry answered is a labelled stack carrying its word and its part", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "one" });
  const labelled = opsOf(plan, "addLabelledStack");
  assert.deepEqual(labelled.map((s) => [s.label, s.count, s.gen.part]), [["folk", 2, "captives"], ["bens", 5, "guard-2"]]);
  assert.ok(labelled.every((s) => !("prototype" in s)));
  assert.equal(plan.ops.some((o) => o.op === "prototype" && o.spec.kind === "label"), false, "nothing is minted for a word");
});

t("a leader is an actor named as its group's officer, with its morale part, and never a stack", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "below" });
  const made = opsOf(plan, "makeActor");
  assert.equal(made.length, 5, "the hold's, two bands' and two cells' leaders");
  const chief = made.find((m) => m.role === "c");
  assert.deepEqual(chief.gear, ["g1"]);
  assert.equal(chief.mount.prototype, "L.mount");
  const officers = opsOf(plan, "setOfficer");
  assert.equal(officers.length, 5);
  assert.equal(officers.find((o) => o.officer === chief.ref).moraleBonus, 2);
  assert.ok(opsOf(plan, "addStack").every((s) => !s.gen.part.startsWith("leader")), "no leader part is a stack");
  const leader = plan.ops.find((o) => o.op === "update" && o.update["system.leaderUuid"]);
  assert.equal(leader.uuid, "F.1", "a village's chieftain is also its faction's leader");
  assert.equal(leader.update["system.leaderUuid"], chief.ref);
});

t("a roll with no village is hosted by its top unit's group, and no faction leader is written", () => {
  const plan = planRoll({ host: null, rows: [], tree: TREE(), scope: "one" });
  const write = plan.ops.find((o) => o.op === "update");
  const top = opsOf(plan, "createGroup")[0].ref;
  assert.equal(write.uuid, top, "the top group carries the chart");
  assert.equal(plan.ops.some((o) => o.op === "update" && o.update["system.leaderUuid"]), false);
  const group = planRoll({ host: { uuid: "G.1", kind: "group" }, rows: [], tree: TREE() });
  assert.equal(group.ops.some((o) => o.update?.["system.leaderUuid"]), false);
});

t("the ops come in an order an executor can carry out: what is named exists before it is used", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE(), scope: "below", placeUuid: "PL.1" });
  const made = new Set();
  const refs = (o) => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).filter((x) => typeof x === "string") : [])).filter((v) => v.startsWith("new:"));
  for (const o of plan.ops) {
    for (const r of refs(o)) if (!(o.ref === r)) assert.ok(made.has(r), `${o.op} names ${r} before it exists`);
    if (o.ref) made.add(o.ref);
  }
  const rowsWrite = plan.ops.findIndex((o) => o.op === "update" && o.update["system.units"]);
  assert.ok(rowsWrite > plan.ops.findIndex((o) => o.op === "createGroup"), "rows are written once their groups exist");
  assert.equal(plan.ops.at(-1).op, "addOccupant");
  assert.equal(plan.ops.at(-1).place, "PL.1");
});

t("a roll under a row whose parent holds a group nests the new group inside it", () => {
  const rows = [row("v", "", "G.v"), row("w2", "v", "")];
  const plan = planRoll({ host: HOST, rows, rowKey: "w2", tree: TREE(), scope: "one" });
  const first = opsOf(plan, "parent")[0];
  assert.deepEqual([first.uuid, first.parentUuid], [opsOf(plan, "createGroup")[0].ref, "G.v"]);
});

t("the roll reports what it carries to the caller: treasure by the state, and the findings", () => {
  const plan = planRoll({ host: HOST, rows: [], tree: TREE() });
  assert.deepEqual(plan.treasure, { deal: true });
  assert.deepEqual(plan.findings, [{ what: "reference", word: "bens" }]);
});

t("Add makes an empty row under any row with the next free key, and says why it cannot", () => {
  const rows = [row("u1"), row("u3", "u1")];
  const plan = planAddUnit({ host: HOST, rows, parentKey: "u3", fields: { label: "New", kind: "band" } });
  assert.equal(plan.ok, true);
  assert.equal(plan.key, "u2", "the first key no row holds");
  const added = plan.rows.find((r) => r.key === "u2");
  assert.deepEqual([added.parentKey, added.holderUuid, added.kind, added.label], ["u3", "", "band", "New"]);
  assert.equal(plan.ops.length, 1);
  assert.equal(planAddUnit({ host: HOST, rows, parentKey: "zz" }).reason, "noRow");
  assert.equal(planAddUnit({ host: HOST, rows: [], parentKey: "" }).key, "u1", "the top of an empty chart");
});

t("Edit changes a filled row by hand, and a change under bodies on a map warns and refuses nothing", () => {
  const rows = [row("u1", "", "G.1"), row("u2", "u1", "")];
  const plan = planEdit({ host: HOST, rows, key: "u1", fields: { label: "Renamed", notes: "n" }, stacks: [{ stack: "s1", count: 7.9, prototype: "P.x" }], officer: { officer: "A.1", moraleBonus: 3 }, onMap: true });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.warnings, ["onMap"]);
  assert.deepEqual(plan.ops.map((o) => o.op), ["update", "setStack", "setOfficer"]);
  assert.deepEqual(plan.ops[1], { op: "setStack", group: "G.1", stack: "s1", count: 7, prototype: "P.x" });
  assert.equal(plan.ops[0].update["system.units"].find((r) => r.key === "u1").label, "Renamed");
  const quiet = planEdit({ host: HOST, rows, key: "u1", stacks: [{ stack: "s1", count: 1 }], onMap: false });
  assert.deepEqual(quiet.warnings, []);
  assert.equal(planEdit({ host: HOST, rows, key: "u1", fields: { label: "Row u1" }, onMap: true }).ops.length, 0, "a label a row already has writes nothing, and a label change warns of nothing");
  assert.equal(planEdit({ host: HOST, rows, key: "u2", stacks: [{ stack: "s", count: 1 }] }).reason, "empty");
  assert.equal(planEdit({ host: HOST, rows, key: "zz" }).reason, "noRow");
});

t("clearing the officer that is the faction's leader clears the faction's leader in the same plan, and clearing any other officer leaves it", () => {
  const rows = [row("u1", "", "G.1"), row("u2", "u1", "G.2")];
  const faction = { uuid: "F.1", kind: "faction", leaderUuid: "A.1" };
  const own = planEdit({ host: faction, rows, key: "u1", officer: { officer: "", moraleBonus: null }, currentOfficer: "A.1" });
  assert.deepEqual(own.ops.map((o) => o.op), ["update", "setOfficer"]);
  assert.deepEqual(own.ops[0], { op: "update", uuid: "F.1", update: { "system.leaderUuid": "" } });
  const both = planEdit({ host: faction, rows, key: "u1", fields: { label: "Renamed" }, officer: { officer: "", moraleBonus: null }, currentOfficer: "A.1" });
  assert.deepEqual(both.ops.map((o) => o.op), ["update", "setOfficer"], "the rows and the leader are one write to the host");
  assert.deepEqual(Object.keys(both.ops[0].update), ["system.units", "system.leaderUuid"]);
  const other = planEdit({ host: faction, rows, key: "u2", officer: { officer: "", moraleBonus: null }, currentOfficer: "A.9" });
  assert.deepEqual(other.ops.map((o) => o.op), ["setOfficer"], "an officer that is not the faction's leader");
  const set = planEdit({ host: faction, rows, key: "u1", officer: { officer: "A.2", moraleBonus: null }, currentOfficer: "A.1" });
  assert.deepEqual(set.ops.map((o) => o.op), ["setOfficer"], "naming another officer is no clear");
  const group = planEdit({ host: { uuid: "G.0", kind: "group", leaderUuid: "A.1" }, rows, key: "u1", officer: { officer: "", moraleBonus: null }, currentOfficer: "A.1" });
  assert.deepEqual(group.ops.map((o) => o.op), ["setOfficer"], "only a faction has a leader to clear");
});

t("a Roll that names the host's own group as the top holder makes no group for the top, and the host stands on its own top row without nesting itself", () => {
  const GROUP = { uuid: "G.host", kind: "group" };
  const rows = [row("top", "", "", { gen: { template: "T.1" } })];
  const plan = planRoll({ host: GROUP, rows, rowKey: "top", tree: TREE(), scope: "below", topHolder: "G.host", newKey: keySource(["top"]) });
  assert.equal(plan.ok, true);
  const made = opsOf(plan, "createGroup");
  assert.equal(made.length, 5, "the two bands, their two cells and the camp: every unit but the top");
  assert.equal(plan.rows.find((r) => r.key === "top").holderUuid, "G.host", "the top row names the host group itself");
  assert.ok(opsOf(plan, "parent").every((o) => o.uuid !== o.parentUuid), "no group is put inside itself");
  assert.ok(opsOf(plan, "parent").every((o) => o.uuid !== "G.host"), "the host group is put inside nothing");
  assert.ok(opsOf(plan, "parent").some((o) => o.parentUuid === "G.host"), "the units under the top nest in it");
  const officer = opsOf(plan, "setOfficer").find((o) => o.group === "G.host");
  assert.ok(officer, "the top unit's leader is the host group's officer");
  assert.equal(officer.moraleBonus, 2);
  assert.ok(opsOf(plan, "makeActor").some((o) => o.group === "G.host"), "the leader is made for the host group");
  assert.equal(plan.groups.top, "G.host");
  assert.equal(opsOf(plan, "update").at(-1).uuid, "G.host", "the rows are written to the host");
});

t("a nest of a group under itself is still refused, with or without the host's own top row", () => {
  assert.equal(wouldCycle("G.host", "G.host", new Map()), true);
  assert.deepEqual(planReparent("G.host", "G.host", new Map([["G.host", { parentUuid: null }]])), { ok: false, reason: "cycle" });
  assert.equal(wouldCycle("G.host", "G.inner", new Map([["G.inner", { parentUuid: "G.host" }], ["G.host", { parentUuid: null }]])), true, "nor under what it holds");
});

t("a topHolder is ignored for a row below the top, and a host that is a faction or a row with no topHolder is planned as before", () => {
  const rows = [row("v", "", "G.v"), row("w2", "v", "")];
  const below = planRoll({ host: { uuid: "G.v", kind: "group" }, rows, rowKey: "w2", tree: TREE(), scope: "one", topHolder: "G.v", newKey: keySource(["v", "w2"]) });
  assert.equal(opsOf(below, "createGroup").length, 2, "the top of the roll under a row below the top still gets a group of its own");
  assert.equal(below.rows.find((r) => r.key === "w2").holderUuid.startsWith("new:"), true);
  const plain = planRoll({ host: HOST, rows: [row("top", "", "")], rowKey: "top", tree: TREE(), scope: "one", newKey: keySource(["top"]) });
  assert.equal(opsOf(plain, "createGroup").length, 2, "the top and its camp, no topHolder: a group for each unit filled");
  assert.ok(plain.rows.find((r) => r.key === "top").holderUuid.startsWith("new:"));
});

t("Edit writes a patch of an empty row's own record: a share and a troop are kept, a blank clears the key, and an unchanged patch writes nothing", () => {
  const rows = [row("u1", "", "G.1"), row("u2", "u1", "", { gen: { shareKind: "a", tier: 0 } })];
  const set = planEdit({ host: HOST, rows, key: "u2", fields: { gen: { shareKind: "b", troop: "t1" } } });
  assert.equal(set.ok, true);
  assert.deepEqual(set.ops[0].update["system.units"].find((r) => r.key === "u2").gen, { shareKind: "b", tier: 0, troop: "t1" });
  const cleared = planEdit({ host: HOST, rows, key: "u2", fields: { gen: { shareKind: "", troop: "" } } });
  assert.deepEqual(cleared.ops[0].update["system.units"].find((r) => r.key === "u2").gen, { tier: 0 }, "a blank pick is no pick");
  assert.equal(planEdit({ host: HOST, rows, key: "u2", fields: { gen: { shareKind: "a" } } }).ops.length, 0, "the same pick writes nothing");
  assert.equal(planEdit({ host: HOST, rows, key: "u1", fields: { gen: { troop: "t" } } }).ok, true, "a filled row's record is a field like its label");
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
console.log(`\ntest-org-write: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
