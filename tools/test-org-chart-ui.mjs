/**
 * Offline tests for the organisation chart's surface logic (scripts/lib/org-chart-ui-logic.mjs):
 * the template a row's Roll reads, the fold, the empty rows Roll at random fills, the
 * subtree a joined group shows. Every name, key and count in here is invented.
 *
 * Run: node tools/test-org-chart-ui.mjs
 */
import assert from "node:assert/strict";
import { orgChartView } from "../scripts/lib/org-tree-logic.mjs";
import { branchKeys, chartCards, emptyKeys, nextLevelKind, subtreeView, templateOf } from "../scripts/lib/org-chart-ui-logic.mjs";

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
