/**
 * Offline tests for the organisation chart's surface logic (scripts/lib/org-chart-ui-logic.mjs):
 * the template a row's Roll reads, the fold, the empty rows Roll at random fills, the
 * subtree a joined group shows. Every name, key and count in here is invented.
 *
 * Run: node tools/test-org-chart-ui.mjs
 */
import assert from "node:assert/strict";
import { orgChartView } from "../scripts/lib/org-tree-logic.mjs";
import { asksBeforeRemoving, branchKeys, byHandOf, chartCards, emptyKeys, nextLevelKind, removalRows, subtreeView, roleOf, templateOf, unlistedView } from "../scripts/lib/org-chart-ui-logic.mjs";

const row = (key, parentKey = "", holderUuid = "", extra = {}) => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {}, ...extra });
const ROWS = [
  row("v", "", "G.v", { gen: { template: "T.fam", variant: "alba" }, kind: "top" }),
  row("w1", "v", "G.w1", { kind: "mid" }),
  row("w2", "v", "", { kind: "mid" }),
  row("g1", "w1", "G.g1"),
  row("g2", "w1", "G.g2"),
];
const WORLD = { "G.v": { name: "V", img: "", count: 9 }, "G.w1": { name: "W1", img: "", count: 7 }, "G.g1": { name: "G1", img: "", count: 3, ancestors: ["G.w1"] }, "G.g2": { name: "G2", img: "", count: 4 } };
const view = orgChartView(ROWS, (u) => WORLD[u] ?? null);

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a row's Roll reads the template of its own gen, else the nearest row above that holds one", () => {
  assert.deepEqual(templateOf(ROWS, "w2"), { template: "T.fam", variant: "alba" });
  assert.deepEqual(templateOf(ROWS, "v"), { template: "T.fam", variant: "alba" });
  assert.deepEqual(templateOf([row("a")], "a"), { template: "", variant: "" });
});

t("Roll at random fills the empty rows in reading order and Collapse all folds each branch", () => {
  assert.deepEqual(emptyKeys(view), ["w2"]);
  assert.deepEqual(branchKeys(view), ["v", "w1"]);
});

t("a folded card keeps its count, drops its children and counts the rows and bodies beneath it", () => {
  const cards = chartCards(view.roots, { collapsed: new Set(["w1"]), canRoll: (k) => k === "w2", outAt: { "G.g1": ["Place"] } });
  const mid = cards[0].children[0];
  assert.equal(mid.folded, true);
  assert.deepEqual(mid.children, []);
  assert.deepEqual(mid.below, { rows: 2, bodies: 4 + 0 }, "the covered gang's bodies are in its warband's count already");
  assert.equal(cards[0].children[1].canRoll, true);
  assert.equal(cards[0].children[0].canRoll, false, "a filled card has no die");
  const open = chartCards(view.roots, { outAt: { "G.g1": ["Place"] } });
  assert.deepEqual(open[0].children[0].children[0].out, ["Place"]);
  assert.equal(open[0].children[0].children[0].isOut, true);
});

t("a joined group shows its row and the rows beneath it, and nothing above", () => {
  const sub = subtreeView(view, "w1");
  assert.deepEqual(sub.rows.map((r) => r.key), ["w1", "g1", "g2"]);
  assert.equal(sub.total, 11);
  assert.equal(subtreeView(view, "zz").rows.length, 0);
});

t("a hand-added row one level down takes the unit word the level already uses, or none", () => {
  assert.equal(nextLevelKind(view), "mid");
  assert.equal(nextLevelKind(orgChartView([row("a", "", "G.v"), row("b", "a", "", { kind: "x" }), row("c", "a", "", { kind: "y" })], () => null)), "");
});

t("a Remove takes the row and every row beneath it, and asks only for more than one, and only while the setting is on", () => {
  assert.deepEqual(removalRows(view, "w1").map((r) => r.key), ["w1", "g1", "g2"]);
  assert.deepEqual(removalRows(view, "g1").map((r) => r.key), ["g1"]);
  assert.deepEqual(removalRows(view, "zz"), []);
  assert.equal(asksBeforeRemoving(removalRows(view, "w1"), true), true);
  assert.equal(asksBeforeRemoving(removalRows(view, "w1"), false), false, "the setting off asks nothing");
  assert.equal(asksBeforeRemoving(removalRows(view, "g1"), true), false, "a row on its own is removed at once");
  assert.equal(asksBeforeRemoving([], true), false);
});

t("a card's role is read from its leader and the unit that leader leads: file, champion, sub-chief, chief", () => {
  const officer = { uuid: "A.1" };
  const kid = { officer, empty: false, parentKey: "p", children: [], gen: {} };
  assert.equal(roleOf({ empty: true }), "", "an empty card has no head");
  assert.equal(roleOf({ empty: false, officer: null, children: [] }), "file", "a filled card with no leader is the rank and file");
  assert.equal(roleOf(kid), "champion", "the officer of a unit of bodies only");
  assert.equal(roleOf({ ...kid, gen: { tier: 0 } }), "champion");
  assert.equal(roleOf({ officer, parentKey: "p", gen: { tier: 1 }, children: [] }), "sub", "a unit of units below the top: recorded tier");
  assert.equal(roleOf({ officer, parentKey: "p", gen: {}, children: [kid] }), "sub", "and read from the rows beneath where none was recorded");
  assert.equal(roleOf({ officer, parentKey: "", gen: { tier: 2 }, children: [] }), "chief", "the top of the chart over units");
  assert.equal(roleOf({ officer, parentKey: "", gen: {}, children: [{ gen: {}, children: [kid] }] }), "chief");
  assert.equal(roleOf({ officer, parentKey: "", gen: {}, children: [] }), "champion", "a lone unit of bodies at the top leads bodies only");
  assert.equal(roleOf({ officer, parentKey: "p", gen: { tier: 5 }, children: [] }), "sub", "never a chief below the top, however many levels it leads");
});

t("a folded card keeps its rank: the role is read before the fold empties its children", () => {
  const boss = { uuid: "A.boss", name: "Boss", img: "" };
  const lead = { uuid: "A.lead", name: "Lead", img: "" };
  const world = { "G.top": { name: "Top", img: "", count: 6, officer: boss }, "G.mid": { name: "Mid", img: "", count: 6, officer: lead }, "G.low": { name: "Low", img: "", count: 6 } };
  const rows = [row("top", "", "G.top"), row("mid", "top", "G.mid"), row("low", "mid", "G.low")];
  const tree = orgChartView(rows, (u) => world[u] ?? null);
  const rankOf = (cards, key) => {
    const find = (list) => list.flatMap((c) => (c.key === key ? [c] : find(c.children)));
    return find(cards)[0]?.roleKey;
  };
  const open = chartCards(tree.roots);
  const shut = chartCards(tree.roots, { collapsed: new Set(["top", "mid"]) });
  for (const key of ["top"]) assert.equal(rankOf(shut, key), rankOf(open, key), `${key} reads the same folded and unfolded`);
  assert.equal(rankOf(open, "top"), "chief");
  assert.equal(rankOf(shut, "top"), "chief", "a folded top is no champion");
  const midShut = chartCards(tree.roots, { collapsed: new Set(["mid"]) });
  assert.equal(rankOf(open, "mid"), "sub");
  assert.equal(rankOf(midShut, "mid"), "sub", "a folded mid-level card is no champion");
});

t("a count is set by hand when it differs from the total its Roll threw, and a stack with no record never is", () => {
  const stack = (initial, rolled, label = "Body") => ({ size: { initial, current: 0 }, gen: { rolled }, template: { label } });
  assert.equal(byHandOf([stack(5, 5)]), null, "casualties move current, never the initial the roll set");
  assert.deepEqual(byHandOf([stack(5, 5), stack(7, 4, "Kind")]), { byHand: true, rolled: 4, now: 7, label: "Kind" });
  assert.equal(byHandOf([{ size: { initial: 3 }, gen: { rolled: null } }, { size: { initial: 3 }, gen: {} }]), null);
  assert.equal(byHandOf([]), null);
});

t("an unlist reads as the groups now hosting what came off and the rows dropped, or as nothing", () => {
  assert.deepEqual(unlistedView({ ok: true, units: [{ uuid: "G.a", name: "A", key: "k" }], dropped: ["x", "y"] }), { groups: [{ uuid: "G.a", name: "A" }], dropped: 2 });
  assert.equal(unlistedView({ ok: true, units: [], dropped: [] }), null);
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
console.log(`\ntest-org-chart-ui: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
