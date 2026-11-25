/**
 * Offline tests for the organisation chart's pure half (scripts/lib/org-tree-logic.mjs):
 * the node a row reduces to, the walks, the ordered write plans for add, join, leave,
 * send out and recall, the host that answers between a join's two writes, the morale
 * part read from above, the faction's one list of who it affiliates, and the two view
 * models. Every name, key and count in here is invented.
 *
 * Run: node tools/test-org-tree.mjs
 */
import assert from "node:assert/strict";
import {
  affiliationRows, blankRow, isEmptyRow, isOfficerUp, locationsView, moraleFromAbove, nodesOf, orgChartView, planAdd,
  planJoin, planLeave, planRecall, planSendOut, preferredHost, rowAncestors, rowDescendants, rowRoots, subtreeKeys, twinKeys,
  withHolder, chartToJoin, factionLine, readableChartRows, readableUnits,
} from "../scripts/lib/org-tree-logic.mjs";

/** A stored row, as a model would hand it over. */
const row = (key, parentKey = "", holderUuid = "", extra = {}) => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {}, ...extra });

/** A chart: a village over two warbands, the first over two gangs. */
const CHART = [row("v", "", "G.v"), row("w1", "v", "G.w1"), row("w2", "v", ""), row("g1", "w1", "G.g1"), row("g2", "w1", "G.g2")];

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* -------------------------------------------- */
/*  Nodes and walks                              */
/* -------------------------------------------- */

t("a row reduces to the one node shape, dropping a row with no key and a repeated key", () => {
  const nodes = nodesOf([row("a", "", "H"), { ...row("b"), toObject() { return row("b", "a", "", { kind: "word" }); } }, { label: "no key" }, row("a", "", "other")]);
  assert.deepEqual(nodes.map((n) => n.key), ["a", "b"]);
  assert.deepEqual(nodes[1], { key: "b", parentKey: "a", label: "Row b", holderUuid: "", kind: "word" });
  assert.equal(nodes[0].holderUuid, "H", "the first row of a key stands");
});

t("ancestors and descendants walk the chart, nearest first", () => {
  const nodes = nodesOf(CHART);
  assert.deepEqual(rowAncestors("g1", nodes), ["w1", "v"]);
  assert.deepEqual(rowDescendants("v", nodes), ["w1", "w2", "g1", "g2"]);
  assert.deepEqual(subtreeKeys("w1", nodes), ["w1", "g1", "g2"]);
  assert.deepEqual(rowAncestors("v", nodes), []);
  assert.deepEqual(rowAncestors("", nodes), []);
});

t("a chart that loops is read safely and an orphan reads as a top row", () => {
  const looped = nodesOf([row("a", "b"), row("b", "a"), row("c", "gone")]);
  assert.deepEqual(rowAncestors("a", looped).sort(), ["b"], "the walk ends where it began");
  assert.deepEqual(rowDescendants("a", looped), ["b"]);
  assert.deepEqual(rowRoots(looped).map((n) => n.key), ["c"], "a row whose parent names no row is a top row");
});

t("a row is empty with no holder, or with one that no longer resolves", () => {
  const nodes = nodesOf(CHART);
  assert.equal(isEmptyRow(nodes.find((n) => n.key === "w2")), true);
  assert.equal(isEmptyRow(nodes.find((n) => n.key === "w1")), false);
  assert.equal(isEmptyRow(nodes.find((n) => n.key === "w1"), () => false), true, "a holder the world no longer answers for");
});

/* -------------------------------------------- */
/*  Add                                          */
/* -------------------------------------------- */

t("add makes an empty row under any row, or at the top, and refuses what cannot stand", () => {
  const under = planAdd(CHART, "g2", "n1", { label: "New", kind: "word" });
  assert.equal(under.ok, true);
  const made = under.rows.find((r) => r.key === "n1");
  assert.deepEqual(made, blankRow("n1", { parentKey: "g2", label: "New", kind: "word" }));
  assert.equal(made.holderUuid, "", "an empty row waits to be decided");
  assert.equal(under.rows.length, CHART.length + 1);
  assert.equal(planAdd([], "", "n1").ok, true, "a host with no rows takes a top row");
  assert.equal(planAdd(CHART, "missing", "n1").reason, "noRow");
  assert.equal(planAdd(CHART, "v", "w1").reason, "taken");
  assert.equal(planAdd(CHART, "v", "").reason, "noKey");
  assert.equal(CHART.length, 5, "the stored list is not edited");
});

t("a holder is set on one row alone", () => {
  const next = withHolder(CHART, "w2", "G.w2");
  assert.equal(next.find((r) => r.key === "w2").holderUuid, "G.w2");
  assert.deepEqual(next.filter((r) => r.key !== "w2"), CHART.filter((r) => r.key !== "w2"));
});

/* -------------------------------------------- */
/*  Join and leave                               */
/* -------------------------------------------- */

const FACTION = { uuid: "F.1", rows: [row("fv", "", "G.fv"), row("fw", "fv", "G.fw")] };

t("join writes the faction first, appends the group's rows under the chosen row, keeps every key, then clears the group", () => {
  const plan = planJoin({ uuid: "G.w1", rows: [row("w1", "", "G.w1"), row("g1", "w1", "G.g1"), row("g2", "w1", "G.g2")] }, FACTION, "fw");
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ops.map((o) => o.uuid), ["F.1", "G.w1"], "the faction is written before the group is cleared");
  const rows = plan.ops[0].update["system.units"];
  assert.deepEqual(rows.map((r) => r.key), ["fv", "fw", "w1", "g1", "g2"], "appended, never re-keyed");
  assert.equal(rows.find((r) => r.key === "w1").parentKey, "fw", "the group's top row goes under the chosen row");
  assert.equal(rows.find((r) => r.key === "g1").parentKey, "w1", "the rows beneath keep their own parents");
  assert.deepEqual(plan.ops[1].update, { "system.units": [] });
  assert.deepEqual(plan.moved, ["w1", "g1", "g2"]);
  assert.equal(plan.twin, false);
});

t("join with no chosen row puts the group's top row at the top of the faction's chart", () => {
  const plan = planJoin({ uuid: "G.x", rows: [row("x", "", "G.x")] }, FACTION, "");
  assert.equal(plan.ops[0].update["system.units"].find((r) => r.key === "x").parentKey, "");
});

t("a second press of a join completes the move and appends nothing twice", () => {
  const group = { uuid: "G.w1", rows: [row("w1", "", "G.w1"), row("g1", "w1", "G.g1")] };
  const first = planJoin(group, FACTION, "fw");
  const landed = { uuid: FACTION.uuid, rows: first.ops[0].update["system.units"] };
  const second = planJoin(group, landed, "fw");
  assert.equal(second.twin, true);
  assert.deepEqual(second.moved, []);
  assert.deepEqual(second.ops.map((o) => o.uuid), ["G.w1"], "only the clearing remains");
  assert.deepEqual(second.ops[0].update, { "system.units": [] });
});

t("join refuses a group with no chart and a row the faction does not hold", () => {
  assert.equal(planJoin({ uuid: "G.e", rows: [] }, FACTION, "fw").reason, "noRows");
  assert.equal(planJoin({ uuid: "G.x", rows: [row("x")] }, FACTION, "missing").reason, "noRow");
});

t("leave writes the group first, hosting the subtree with its top row at the top, then the faction drops it", () => {
  const faction = { uuid: "F.1", rows: [...FACTION.rows, row("w1", "fw", "G.w1"), row("g1", "w1", "G.g1"), row("other", "fv", "G.o")] };
  const plan = planLeave(faction, "w1", { uuid: "G.w1", rows: [] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ops.map((o) => o.uuid), ["G.w1", "F.1"]);
  const own = plan.ops[0].update["system.units"];
  assert.deepEqual(own.map((r) => r.key), ["w1", "g1"]);
  assert.equal(own.find((r) => r.key === "w1").parentKey, "", "the leaving row stands at the top of its own chart");
  assert.equal(own.find((r) => r.key === "g1").parentKey, "w1");
  assert.deepEqual(plan.ops[1].update["system.units"].map((r) => r.key), ["fv", "fw", "other"]);
});

t("any subtree may leave, a leaf included, and a second press completes the move", () => {
  const faction = { uuid: "F.1", rows: [row("v", "", "G.v"), row("a", "v", "G.a")] };
  const leaf = planLeave(faction, "a", { uuid: "G.a", rows: [] });
  assert.deepEqual(leaf.ops[0].update["system.units"].map((r) => r.key), ["a"]);
  const again = planLeave(faction, "a", { uuid: "G.a", rows: leaf.ops[0].update["system.units"] });
  assert.equal(again.twin, true);
  assert.deepEqual(again.ops.map((o) => o.uuid), ["F.1"]);
  assert.equal(planLeave(faction, "missing", { uuid: "G.a", rows: [] }).reason, "noRow");
  assert.equal(planLeave(faction, "a", { uuid: "", rows: [] }).reason, "noHolder");
});

t("a group with no chart joins as one row that holds itself, and a chart of its own is never replaced", () => {
  const self = { key: "k1", label: "Alone", holderUuid: "G.a" };
  const alone = chartToJoin([], self);
  assert.deepEqual(alone.map((r) => [r.key, r.parentKey, r.label, r.holderUuid]), [["k1", "", "Alone", "G.a"]]);
  const plan = planJoin({ uuid: "G.a", rows: alone }, { uuid: "F.1", rows: [row("v", "", "G.v")] }, "v");
  assert.equal(plan.ok, true, "the one row is a chart planJoin accepts");
  assert.equal(plan.ops[0].update["system.units"].find((r) => r.key === "k1").parentKey, "v");
  const own = [row("w1", "", "G.w1"), row("g1", "w1", "G.g1")];
  assert.deepEqual(chartToJoin(own, self).map((r) => r.key), ["w1", "g1"]);
  const copy = chartToJoin(own, self);
  copy[0].label = "changed";
  assert.equal(own[0].label, "Row w1", "a copy, so the group's rows are not edited in place");
});

t("the faction line: joined, free, free for a stopped join, and hidden where another group lists it", () => {
  const faction = { hostUuid: "F.1", hostIsFaction: true };
  const group = { hostUuid: "G.w", hostIsFaction: false };
  assert.deepEqual(factionLine({ ownRows: false, nested: false, found: faction }), { state: "joined", hostUuid: "F.1" });
  assert.deepEqual(factionLine({ ownRows: false, nested: true, found: faction }), { state: "joined", hostUuid: "F.1" }, "a nested gang on a faction's chart shows the card");
  assert.deepEqual(factionLine({ ownRows: true, nested: false, found: faction }), { state: "free", hostUuid: "F.1" }, "a stopped join offers its faction and no Leave");
  assert.deepEqual(factionLine({ ownRows: true, nested: false, found: null }), { state: "free" });
  assert.deepEqual(factionLine({ ownRows: true, nested: true, found: group }), { state: "free" }, "a chart of its own is a root's");
  assert.deepEqual(factionLine({ ownRows: false, nested: false, found: null }), { state: "free" }, "a group inside no group, with no chart");
  assert.deepEqual(factionLine({ ownRows: false, nested: false, found: group }), { state: "hidden" }, "listed on a group's chart");
  assert.deepEqual(factionLine({ ownRows: false, nested: true, found: null }), { state: "hidden" }, "inside a group that hosts none");
});

/* -------------------------------------------- */
/*  Send out and recall                          */
/* -------------------------------------------- */

t("send out writes the target place first, lets other rosters go, then takes the group out of its parent", () => {
  const plan = planSendOut({ holderUuid: "G.g1", holderIsGroup: true, parentGroupUuid: "G.w1", holdings: ["P.old", "P.ford"], placeUuid: "P.ford" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ops, [
    { op: "addOccupant", place: "P.ford", actor: "G.g1" },
    { op: "removeOccupant", place: "P.old", actor: "G.g1" },
    { op: "parent", uuid: "G.g1", parentUuid: "" },
  ]);
});

t("send out of a group inside none, or of a lone actor, writes no parent", () => {
  assert.deepEqual(planSendOut({ holderUuid: "G.a", holderIsGroup: true, parentGroupUuid: "", holdings: [], placeUuid: "P.1" }).ops.map((o) => o.op), ["addOccupant"]);
  assert.deepEqual(planSendOut({ holderUuid: "A.1", holderIsGroup: false, parentGroupUuid: "G.x", holdings: [], placeUuid: "P.1" }).ops.map((o) => o.op), ["addOccupant"]);
  assert.equal(planSendOut({ holderUuid: "", placeUuid: "P.1" }).reason, "noHolder");
  assert.equal(planSendOut({ holderUuid: "G.a", placeUuid: "" }).reason, "noPlace");
});

t("recall puts the group under the group its parent row holds first, then takes it off every roster", () => {
  const plan = planRecall({ holderUuid: "G.g1", holderIsGroup: true, parentRowKey: "w1", parentHolderUuid: "G.w1", parentHolderIsGroup: true, holdings: ["P.ford"] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ops, [
    { op: "parent", uuid: "G.g1", parentUuid: "G.w1" },
    { op: "removeOccupant", place: "P.ford", actor: "G.g1" },
  ]);
});

t("recall says why it cannot: a top row, an empty parent, a parent that is no group, a lone actor", () => {
  const base = { holderUuid: "G.g1", holderIsGroup: true, parentRowKey: "w1", parentHolderUuid: "G.w1", parentHolderIsGroup: true, holdings: [] };
  assert.equal(planRecall({ ...base, parentRowKey: "" }).reason, "topRow");
  assert.equal(planRecall({ ...base, parentHolderUuid: "" }).reason, "emptyParent");
  assert.equal(planRecall({ ...base, parentHolderIsGroup: false }).reason, "parentNotGroup");
  assert.equal(planRecall({ ...base, holderIsGroup: false }).reason, "notGroup");
  assert.equal(planRecall({ ...base, holderUuid: "" }).reason, "noHolder");
  assert.deepEqual(planRecall({ ...base, parentRowKey: "" }).ops, [], "a refusal writes nothing");
});

/* -------------------------------------------- */
/*  The host that answers                        */
/* -------------------------------------------- */

t("a faction answers over a group where a row stands on both", () => {
  const entries = [{ hostUuid: "G.1", key: "a", isGroup: true }, { hostUuid: "F.1", key: "a", isGroup: false }];
  assert.equal(preferredHost(entries).hostUuid, "F.1");
  assert.equal(preferredHost([entries[0]]).hostUuid, "G.1");
  assert.equal(preferredHost([]), null);
});

t("a row standing on two hosts is a twin, and a row on one is not", () => {
  const twins = twinKeys([{ uuid: "F.1", rows: [row("a"), row("b")] }, { uuid: "G.1", rows: [row("b"), row("c")] }]);
  assert.deepEqual([...twins], [["b", ["F.1", "G.1"]]]);
});

/* -------------------------------------------- */
/*  Morale from above                            */
/* -------------------------------------------- */

t("a unit takes the part of each ancestor row whose officer is up, and none from itself", () => {
  const nodes = nodesOf(CHART);
  const parts = { "G.v": { bonus: 3, up: true }, "G.w1": { bonus: 1, up: true }, "G.g1": { bonus: 4, up: true } };
  const read = (uuid) => parts[uuid] ?? null;
  assert.equal(moraleFromAbove("g1", nodes, read), 4, "the village's and the warband's, not the gang's own");
  assert.equal(moraleFromAbove("w1", nodes, read), 3);
  assert.equal(moraleFromAbove("v", nodes, read), 0, "a top row has nothing above");
});

t("a fallen officer's part is gone, and a part read as null adds nothing", () => {
  const nodes = nodesOf(CHART);
  const read = (uuid) => ({ "G.v": { bonus: 3, up: false }, "G.w1": { bonus: null, up: true } })[uuid] ?? null;
  assert.equal(moraleFromAbove("g1", nodes, read), 0);
});

t("an empty ancestor row adds nothing and the walk goes on past it", () => {
  const nodes = nodesOf([row("v", "", "G.v"), row("w", "v", ""), row("g", "w", "G.g")]);
  assert.equal(moraleFromAbove("g", nodes, (u) => (u === "G.v" ? { bonus: 3, up: true } : null)), 3);
});

t("an officer is up unless resolved and fallen", () => {
  assert.equal(isOfficerUp(null), false, "an officer that does not resolve gives no part");
  assert.equal(isOfficerUp({ system: { hp: { value: 5 } }, statuses: new Set() }), true);
  assert.equal(isOfficerUp({ system: { hp: { value: 0 } }, statuses: new Set() }), false);
  assert.equal(isOfficerUp({ system: { hp: { value: 5 } }, statuses: new Set(["dead"]) }), false);
  assert.equal(isOfficerUp({ system: {} }), true, "no figure read is no evidence of a fall");
});

/* -------------------------------------------- */
/*  Who a faction affiliates                     */
/* -------------------------------------------- */

t("a faction affiliates its members and each chart holder once, the member row winning", () => {
  const members = [{ uuid: "A.1", name: "Kept", kind: "actor", quantity: 1, hidden: true }];
  const units = [row("a", "", "A.1", { hidden: false }), row("b", "a", "G.2", { label: "Second", hidden: true }), row("c", "a", "")];
  const out = affiliationRows(members, units);
  assert.deepEqual(out.map((r) => r.uuid), ["A.1", "G.2"], "an empty row affiliates nobody and a holder is listed once");
  assert.equal(out[0].hidden, true, "the stored row's hidden mark stands");
  assert.equal(out[1].hidden, true, "a chart row's hidden mark rides on the row it makes");
  assert.equal(out[1].name, "Second");
  assert.equal(members.length, 1, "the stored list is not edited");
});

t("a holder the world no longer resolves affiliates nobody", () => {
  const world = { "G.live": { name: "Live", img: "i.png" } };
  const out = affiliationRows([], [row("a", "", "G.live"), row("b", "a", "G.gone")], (u) => world[u] ?? null);
  assert.deepEqual(out.map((r) => [r.uuid, r.name, r.img]), [["G.live", "Live", "i.png"]]);
});

/* -------------------------------------------- */
/*  The org chart view                           */
/* -------------------------------------------- */

const WORLD = {
  "G.v": { name: "Village group", img: "v.png", count: 9, ancestors: [], officer: { uuid: "A.chief", name: "Chief", img: "c.png" } },
  "G.w1": { name: "Warband group", img: "", count: 7, ancestors: [], officer: null },
  "G.g1": { name: "Gang one", img: "", count: 3, ancestors: ["G.w1"], officer: null },
  "G.g2": { name: "Gang two", img: "", count: 4, ancestors: [], officer: null },
};
const read = (uuid) => WORLD[uuid] ?? null;

t("the chart is the tree of rows, each with its holder's count, officer and emptiness", () => {
  const view = orgChartView(CHART, read);
  assert.deepEqual(view.rows.map((r) => [r.key, r.depth]), [["v", 0], ["w1", 1], ["g1", 2], ["g2", 2], ["w2", 1]]);
  assert.equal(view.roots.length, 1);
  assert.equal(view.roots[0].children.length, 2);
  const v = view.rows.find((r) => r.key === "v");
  assert.equal(v.count, 9);
  assert.equal(v.name, "Village group");
  assert.equal(v.officer.name, "Chief");
  const empty = view.rows.find((r) => r.key === "w2");
  assert.equal(empty.empty, true);
  assert.equal(empty.name, "Row w2", "an empty row is named by its label");
  assert.equal(empty.count, 0);
  assert.equal(view.empty, 1);
});

t("a holder the world cannot resolve reads empty", () => {
  const view = orgChartView([row("a", "", "G.gone")], read);
  assert.equal(view.rows[0].empty, true);
  assert.equal(view.rows[0].count, 0);
});

t("a gang inside its warband's group keeps its count and is marked covered, and the total counts the bodies once", () => {
  const view = orgChartView(CHART, read);
  assert.equal(view.rows.find((r) => r.key === "g1").covered, true);
  assert.equal(view.rows.find((r) => r.key === "g2").covered, false, "a gang away from its warband stands on its own");
  assert.equal(view.rows.find((r) => r.key === "g1").count, 3);
  assert.equal(view.total, 9 + 7 + 4, "the village, the warband and the gang away; the gang inside the warband is already in 7");
});

t("a row on two hosts is marked a twin", () => {
  const view = orgChartView(CHART, read, ["g2"]);
  assert.deepEqual(view.rows.filter((r) => r.twin).map((r) => r.key), ["g2"]);
});

t("a chart that loops still ends", () => {
  const view = orgChartView([row("a", "b", "G.v"), row("b", "a", "G.w1"), row("c", "", "G.g2")], read);
  assert.deepEqual(view.rows.map((r) => r.key), ["c"], "rows with no way up to the top are left out");
});

/* -------------------------------------------- */
/*  The locations view                           */
/* -------------------------------------------- */

t("each place lists its outermost groups with the chart rows they hold, those inside included", () => {
  const rows = [
    { hostUuid: "F.1", key: "w1", label: "W1", holderUuid: "G.w1" },
    { hostUuid: "F.1", key: "g1", label: "G1", holderUuid: "G.g1" },
    { hostUuid: "F.1", key: "g2", label: "G2", holderUuid: "G.g2" },
    { hostUuid: "F.1", key: "w2", label: "W2", holderUuid: "" },
  ];
  const known = {
    "G.w1": { name: "Warband", count: 7, ancestors: [], descendants: ["G.g1"] },
    "G.g2": { name: "Gang two", count: 4, ancestors: [], descendants: [] },
    "G.g1": { name: "Gang one", count: 3, ancestors: ["G.w1"], descendants: [] },
  };
  const view = locationsView({
    places: [
      { uuid: "P.camp", name: "Camp", roster: [{ uuid: "G.w1" }] },
      { uuid: "P.ford", name: "Ford", roster: [{ uuid: "G.g2" }, { uuid: "A.gone" }] },
      { uuid: "P.empty", name: "Empty", roster: [] },
    ],
    rows,
    read: (u) => known[u] ?? null,
  });
  const camp = view.places.find((p) => p.uuid === "P.camp");
  assert.deepEqual(camp.groups.map((g) => g.uuid), ["G.w1"]);
  assert.deepEqual(camp.groups[0].rows.map((r) => [r.key, r.inside]), [["w1", false], ["g1", true]], "a row held through a group inside it is marked");
  assert.equal(camp.total, 7);
  const ford = view.places.find((p) => p.uuid === "P.ford");
  assert.deepEqual(ford.groups.map((g) => g.uuid), ["G.g2"], "an actor that does not resolve is not listed");
  assert.equal(view.places.find((p) => p.uuid === "P.empty").groups.length, 0);
  assert.deepEqual(view.unplaced, [], "every holder stands somewhere; an empty row has none to place");
});

t("a holder on no roster is listed apart, and a group whose container is on the same roster is covered", () => {
  const rows = [
    { hostUuid: "F.1", key: "a", label: "A", holderUuid: "G.a" },
    { hostUuid: "F.1", key: "b", label: "B", holderUuid: "G.b" },
    { hostUuid: "F.1", key: "c", label: "C", holderUuid: "G.c" },
  ];
  const known = {
    "G.a": { name: "A", count: 5, ancestors: [], descendants: ["G.b"] },
    "G.b": { name: "B", count: 2, ancestors: ["G.a"], descendants: [] },
  };
  const view = locationsView({ places: [{ uuid: "P", name: "P", roster: [{ uuid: "G.a" }, { uuid: "G.b" }] }], rows, read: (u) => known[u] ?? null });
  assert.deepEqual(view.places[0].groups.map((g) => [g.uuid, g.covered]), [["G.a", false], ["G.b", true]]);
  assert.equal(view.places[0].total, 5, "the container's count already holds the covered group's bodies");
  assert.deepEqual(view.unplaced.map((r) => r.key), ["c"]);
});

t("a hidden row is the Judge's alone, and so is everything beneath it: no child of it reads as a top row", () => {
  const rows = [row("v", "", "G.v"), row("w1", "v", "G.w1", { hidden: true }), row("g1", "w1", "G.g1"), row("w2", "v", "")];
  assert.deepEqual(readableUnits(rows, true).map((r) => r.key), ["v", "w1", "g1", "w2"]);
  assert.deepEqual(readableUnits(rows, false).map((r) => r.key), ["v", "w2"]);
  const seen = orgChartView(rows, read, [], { isGM: false });
  assert.deepEqual(seen.rows.map((r) => r.key), ["v", "w2"]);
  assert.equal(seen.roots.length, 1, "the hidden row's child does not surface as a root");
  assert.equal(seen.total, 9, "the hidden bodies are not counted for a reader");
  assert.equal(orgChartView(rows, read).rows.length, 4, "a Judge, and a call that names no reader, see every row");
});

t("the locations view's chart rows drop a hidden row and its subtree per host, never across two hosts holding one key", () => {
  const flat = [
    { hostUuid: "H.a", key: "x", parentKey: "", holderUuid: "G.v", hidden: true },
    { hostUuid: "H.a", key: "y", parentKey: "x", holderUuid: "G.w1", hidden: false },
    { hostUuid: "H.b", key: "x", parentKey: "", holderUuid: "G.g2", hidden: false },
  ];
  assert.deepEqual(readableChartRows(flat, false).map((r) => `${r.hostUuid}:${r.key}`), ["H.b:x"]);
  assert.equal(readableChartRows(flat, true).length, 3);
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
console.log(`\ntest-org-tree: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
