/**
 * Offline tests for the organisation chart's surface logic (scripts/lib/org-chart-ui-logic.mjs):
 * the template a row's Roll reads, the fold, the empty rows Roll at random fills, the
 * subtree a joined group shows. Every name, key and count in here is invented.
 *
 * Run: node tools/test-org-chart-ui.mjs
 */
import assert from "node:assert/strict";
import { orgChartView } from "../scripts/lib/org-tree-logic.mjs";
import { asksBeforeRemoving, branchKeys, byHandOf, chartCards, emptyKeys, nextLevelKind, removalRows, subtreeView, roleOf, templateOf, unlistedView, slotPosition, recallOffered, withRecall, readAfterIndex, familyOfRows } from "../scripts/lib/org-chart-ui-logic.mjs";

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

t("a slot's position is its depth below the chart's top and the word the top row holds", () => {
  const rows = [row("t", "", "", { kind: "top-word" }), row("m", "t"), row("l", "m")];
  assert.deepEqual(slotPosition(rows, "m"), { depth: 1, topKind: "top-word" });
  assert.deepEqual(slotPosition(rows, "l"), { depth: 2, topKind: "top-word" });
  assert.deepEqual(slotPosition(rows, "t"), { depth: 0, topKind: "top-word" });
  assert.deepEqual(slotPosition(rows, "zz"), { depth: 0, topKind: "" });
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

t("a card's Recall is drawn only where it can succeed: out on a place, under a row that holds a group", () => {
  const tree = orgChartView([row("top", "", "G.top"), row("mid", "top", "G.mid"), row("low", "mid", "G.low"), row("hole", "top", "")], (u) => ({ "G.top": { name: "T", img: "", count: 1 }, "G.mid": { name: "M", img: "", count: 1 }, "G.low": { name: "L", img: "", count: 1 } })[u] ?? null);
  const at = (outAt) => {
    const flat = (cs) => cs.flatMap((c) => [c, ...flat(c.children)]);
    return Object.fromEntries(flat(chartCards(tree.roots, { outAt })).map((c) => [c.key, c.canRecall]));
  };
  const everywhere = { "G.top": ["P"], "G.mid": ["P"], "G.low": ["P"] };
  assert.deepEqual(at(everywhere), { top: false, mid: true, low: true, hole: false }, "a top row has nothing to return to; an empty row is not out");
  assert.deepEqual(at({}), { top: false, mid: false, low: false, hole: false }, "a card standing nowhere has no Recall");
  const cut = chartCards(subtreeView(tree, "mid").roots, { outAt: everywhere });
  assert.equal(cut[0].canRecall, true, "a group's own chart, cut below its row, keeps the Recall: the row above is in the faction");
  const orphan = orgChartView([row("a", "", "G.a"), row("b", "a", "G.b")], (u) => ({ "G.a": { name: "A", img: "", count: 1 }, "G.b": { name: "B", img: "", count: 1 } })[u] ?? null);
  assert.equal(chartCards(orphan.roots, { outAt: { "G.b": ["P"] } })[0].children[0].canRecall, true);
});

t("recallOffered refuses a top row, a parent no group holds and a parent the host does not hold", () => {
  assert.equal(recallOffered({ parentKey: "" }, undefined), false);
  assert.equal(recallOffered({ parentKey: "p" }, { holderUuid: "G.p" }), true);
  assert.equal(recallOffered({ parentKey: "p" }, { holderUuid: "" }), false);
  assert.equal(recallOffered({ parentKey: "p" }, null), false);
  assert.equal(recallOffered({ parentKey: "p" }, undefined), true);
});

t("the Locations rows draw Recall by the same test, and only for a seat that writes the host", () => {
  const hostRows = [{ toObject: () => row("top", "", "G.top") }, row("mid", "top", "G.mid"), row("hole", "top", ""), row("under", "hole", "G.under"), row("lost", "gone", "G.lost")];
  const standing = [row("top", "", "G.top"), row("mid", "top", "G.mid"), row("under", "hole", "G.under"), row("lost", "gone", "G.lost")];
  const marks = (editable) => Object.fromEntries(withRecall(standing, hostRows, editable).map((r) => [r.key, r.canRecall]));
  assert.deepEqual(marks(true), { top: false, mid: true, under: false, lost: false });
  assert.deepEqual(marks(false), { top: false, mid: false, under: false, lost: false }, "a seat that cannot write sees none");
  assert.equal(withRecall(standing, hostRows, true)[1].label, "Row mid", "the row's own fields pass through");
});

t("the chart reads a pack template's plate after its pack has built its index, and not before", async () => {
  const entry = { name: "Fam", uuid: "Compendium.m.p.Actor.A" };
  const full = { ...entry, flags: { m: { plate: "plate.webp" } } };
  const index = { current: entry };
  const calls = [];
  const pack = { getIndex: async () => { calls.push("getIndex"); index.current = full; } };
  const read = (u) => { calls.push("read"); return u === entry.uuid ? index.current : null; };
  assert.equal(read(entry.uuid).flags, undefined, "the startup index entry carries no flags");
  calls.length = 0;
  const got = await readAfterIndex(entry.uuid, { pack, read });
  assert.deepEqual(calls, ["getIndex", "read"], "the index is awaited, then the entry read");
  assert.equal(got.flags.m.plate, "plate.webp");
  assert.equal(await readAfterIndex("World.x", { pack: undefined, read: () => ({ name: "w" }) }).then((d) => d.name), "w", "a uuid held in no pack is read as it is");
  assert.equal(await readAfterIndex("", { pack, read }), null);
});

t("a Roll's family is the template loaded whole, so its variants are there when the sync read gave an index entry", async () => {
  const entry = { name: "Fam", uuid: "T.fam" };
  const whole = { name: "Fam", uuid: "T.fam", system: { axes: [{ key: "variant", options: ["a", "b", "c"] }] } };
  const syncRead = (u) => (u === "T.fam" ? entry : null);
  assert.equal(syncRead("T.fam").system, undefined, "the sync read of an unloaded pack template has no system");
  const asked = [];
  const load = async (u) => { asked.push(u); return u === "T.fam" ? whole : null; };
  const rows = [row("v", "", "G.v", { gen: { template: "T.fam", variant: "alba", context: "lair" } }), row("w", "v")];
  const got = await familyOfRows(rows, "w", load);
  assert.equal(got.family.system.axes[0].options.length, 3);
  assert.deepEqual(asked, ["T.fam"]);
  assert.deepEqual([got.defaults.variant, got.defaults.context], ["alba", "lair"]);
  assert.equal((await familyOfRows([row("a")], "a", load)).family, null, "a chart with no template has no family");
  assert.equal((await familyOfRows(rows, "w", async () => { throw new Error("gone"); })).family, null, "a template that will not load is no family");
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
console.log(`\ntest-org-chart-ui: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
