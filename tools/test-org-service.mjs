/**
 * Offline tests for a lord's service tree as lib's two views draw it (the Followers tab's
 * org chart and Locations rows): the pure adapters in scripts/lib/org-chart-ui-logic.mjs
 * that turn `serviceNodes`' nodes into the chart's cards and the Locations chips, run
 * over the real `orgChartView` / `chartCards` / `locationsView`. The plans and the
 * writers are tools/test-org-tree.mjs's and tools/test-org.mjs's. Every name, key and
 * count in here is invented.
 *
 * Run: node tools/test-org-service.mjs
 */
import assert from "node:assert/strict";
import { locationsView, orgChartView } from "../scripts/lib/org-tree-logic.mjs";
import { branchKeys, chartCards, serviceFlags, serviceRowFlags, serviceRows, serviceSummary, serviceTotal } from "../scripts/lib/org-chart-ui-logic.mjs";

/** A service node, as `serviceNodes` hands it over: the key is the holder's uuid. */
const node = (key, parentKey = "", extra = {}) => ({ key, parentKey, label: `Name ${key}`, holderUuid: key, kind: "", ...extra });

/**
 * A lord with two direct hirelings and a unit, one hireling with a hireling of its own and a unit:
 * the lord (L), hirelings H1 and H2, unit U1 under the lord, H3 and unit U2 under H1.
 */
const NODES = [node("L"), node("U1", "L", { kind: "company" }), node("H1", "L", { kind: "henchman" }), node("H2", "L", { kind: "mercenary" }), node("U2", "H1", { kind: "guard" }), node("H3", "H1", { kind: "henchman" })];
const GROUPS = new Set(["U1", "U2"]);
const isGroup = (uuid) => GROUPS.has(uuid);
const WORLD = {
  L: { name: "Lord", img: "lord.webp", count: 1 },
  U1: { name: "Company", img: "", count: 20, officer: { uuid: "O1", name: "Captain", img: "" } },
  H1: { name: "Retainer one", img: "", count: 1 },
  H2: { name: "Retainer two", img: "", count: 1 },
  U2: { name: "Guard", img: "", count: 6, ancestors: ["U1"] },
  H3: { name: "Retainer three", img: "", count: 1 },
};
const view = orgChartView(NODES, (u) => WORLD[u] ?? null, [], { isGM: false });
const top = view.rows.find((r) => r.key === "L");

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("the root counts its direct followers, lone actors apart from groups, from the view and not from the folded cards", () => {
  assert.deepEqual(serviceSummary(top.children, isGroup), { henchmen: 2, units: 1 });
  const folded = chartCards(view.roots, { collapsed: new Set(["L"]) });
  assert.deepEqual(folded[0].children, [], "the folded card has no children left to count");
  assert.deepEqual(serviceSummary(top.children, isGroup), { henchmen: 2, units: 1 }, "the view still does");
  assert.deepEqual(serviceSummary([], isGroup), { henchmen: 0, units: 0 });
  assert.deepEqual(serviceSummary(undefined, isGroup), { henchmen: 0, units: 0 });
});

t("the total leaves out the root, which is the sheet's own actor, and counts a card inside another's group once", () => {
  assert.equal(view.total, 1 + 20 + 1 + 1 + 0 + 1, "the chart's own total counts the lord, and U2 inside U1's group is counted once, by U1");
  assert.equal(serviceTotal(view, "L"), view.total - WORLD.L.count);
  assert.equal(serviceTotal({ rows: [] }, "L"), 0);
  assert.equal(serviceTotal(undefined, "L"), 0);
});

t("a lone actor, the root and a unit carry their own marks: no frame or edit, and a foot of Open, Send out and Recall", () => {
  const owned = serviceFlags({ isOut: false }, { isGroup: false, isRoot: false, owns: true });
  assert.deepEqual(owned, { service: true, root: false, lone: true, role: null, canEdit: false, canRoll: false, editing: false, groupGone: false, canSend: true, canRecall: false });
  assert.equal(serviceFlags({ isOut: true }, { isGroup: false, isRoot: false, owns: true }).canRecall, true, "Recall is drawn where it stands out");
  assert.equal(serviceFlags({ isOut: true }, { isGroup: true, isRoot: false, owns: true }).lone, false, "a unit draws its bodies line");
  const root = serviceFlags({ isOut: true }, { isGroup: false, isRoot: true, owns: true });
  assert.deepEqual([root.root, root.lone, root.canSend, root.canRecall], [true, true, false, false], "the root draws no bodies line and no controls");
  assert.equal(serviceFlags({}, { isGroup: true, isRoot: true, owns: true }).lone, true, "whatever kind of actor the root is, it draws no bodies line");
});

t("a seat that owns nothing is drawn no Send out and no Recall", () => {
  const flags = serviceFlags({ isOut: true }, { isGroup: true, isRoot: false, owns: false });
  assert.deepEqual([flags.canSend, flags.canRecall], [false, false]);
  assert.deepEqual([serviceRowFlags({ inside: false }, false).canSend, serviceRowFlags({ inside: false }, false).canRecall], [false, false]);
});

t("the cards carry no role, officer line or edit, however the chart reads a row", () => {
  const cards = chartCards(view.roots, { canEdit: false, canRoll: () => false });
  const flagged = (c) => ({ ...c, ...serviceFlags(c, { isGroup: isGroup(c.holderUuid), isRoot: c.key === "L", owns: true }) });
  const walk = (c) => [flagged(c), ...c.children.flatMap(walk)];
  const all = cards.flatMap(walk);
  assert.equal(all.length, NODES.length);
  assert.ok(all.every((c) => c.role === null && c.canEdit === false && c.canRoll === false && c.service === true));
  assert.deepEqual(all.filter((c) => c.lone).map((c) => c.key), ["L", "H1", "H3", "H2"], "the root and every lone actor draw no bodies line, in the tree's reading order");
});

t("Collapse all folds every card with followers beneath it, the root included, and the view keeps them after a fold", () => {
  assert.deepEqual(branchKeys(view), ["L", "H1"]);
  const folded = chartCards(view.roots, { collapsed: new Set(branchKeys(view)) });
  assert.deepEqual(folded[0].children, []);
  assert.equal(folded[0].hasKids, true);
  assert.deepEqual(branchKeys(view), ["L", "H1"], "read from the view, not from the cards a fold has emptied");
});

t("the Locations rows are the nodes without the root, each naming the employer as its host", () => {
  const rows = serviceRows(NODES, "L", "Actor.lord");
  assert.deepEqual(rows.map((r) => r.key), ["U1", "H1", "H2", "U2", "H3"]);
  assert.ok(rows.every((r) => r.hostUuid === "Actor.lord"));
  assert.ok(rows.every((r) => r.holderUuid && r.label), "the shape locationsView reads");
  assert.deepEqual(serviceRows(undefined, "L", "x"), []);
});

t("a follower standing on no place is unplaced, standing with its employer, and one on a roster is under its place", () => {
  const read = (u) => (WORLD[u] ? { ...WORLD[u], descendants: u === "U1" ? ["U2"] : [] } : null);
  const places = [{ uuid: "P.hall", name: "Hall", roster: [{ uuid: "U1" }, { uuid: "H2" }] }, { uuid: "P.keep", name: "Keep", roster: [{ uuid: "Someone else" }] }];
  const out = locationsView({ places, rows: serviceRows(NODES, "L", "Actor.lord"), read });
  assert.deepEqual(out.unplaced.map((r) => r.key), ["H1", "H3"], "the lord is never listed and the followers on no roster stand with it");
  const hall = out.places.find((p) => p.uuid === "P.hall");
  assert.deepEqual(hall.groups.map((g) => [g.uuid, g.rows.map((r) => [r.key, r.inside])]), [["U1", [["U1", false], ["U2", true]]], ["H2", [["H2", false]]]]);
  const rows = hall.groups[0].rows.map((r) => serviceRowFlags(r, true));
  assert.deepEqual(rows.map((r) => [r.key, r.canRecall, r.canSend]), [["U1", true, true], ["U2", false, true]], "Recall only for the one standing directly on the roster");
  assert.ok(rows.every((r) => r.service === true), "a chip carries its own flag, as a template's loop leaves the root's behind");
  assert.deepEqual(out.places.find((p) => p.uuid === "P.keep").groups, [], "a place of nobody's of ours holds none of our rows");
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
console.log(`\ntest-org-service: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
