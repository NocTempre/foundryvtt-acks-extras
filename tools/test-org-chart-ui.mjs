/**
 * Offline tests for the organisation chart's surface logic (scripts/lib/org-chart-ui-logic.mjs):
 * the template a row's Roll reads, the fold, the empty rows Roll at random fills, the
 * subtree a joined group shows. Every name, key and count in here is invented.
 *
 * Run: node tools/test-org-chart-ui.mjs
 */
import assert from "node:assert/strict";
import { orgChartView } from "../scripts/lib/org-tree-logic.mjs";
import { planEdit, planUnlist } from "../scripts/lib/org-write-logic.mjs";
import { asksBeforeRemoving, branchKeys, byHandOf, chartCards, emptyKeys, hostLeaderState, isPartRow, officerLineShown, leaderRoleOf, nextLevelKind, officerControls, officerActorData, officerChangeOf, officerDropVerdict, officerLineRole, officerSourceOf, liftedBy, officerStateOf, removalRows, subtreeView, roleOf, templateOf, unlistedView, slotPosition, recallOffered, windowNames, withRecall, readAfterIndex, familyOfRows } from "../scripts/lib/org-chart-ui-logic.mjs";

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

t("a Delete lists the row and every row beneath it, in reading order", () => {
  assert.deepEqual(removalRows(view, "w1").map((r) => r.key), ["w1", "g1", "g2"]);
  assert.deepEqual(removalRows(view, "g1").map((r) => r.key), ["g1"]);
  assert.deepEqual(removalRows(view, "zz"), []);
});

t("a Remove moves only the rows directly beneath up to the row's parent, and asks only where rows move, and only while the setting is on", () => {
  const mid = liftedBy(view, "w1");
  assert.deepEqual([mid.row.key, mid.lifted.map((r) => r.key), mid.under.key], ["w1", ["g1", "g2"], "v"], "a middle row's children move up under its parent");
  const top = liftedBy(view, "v");
  assert.deepEqual([top.lifted.map((r) => r.key), top.under], [["w1", "w2"], null], "a top row's children move to the top");
  assert.deepEqual(liftedBy(view, "g1").lifted, [], "a leaf moves nothing");
  assert.deepEqual(liftedBy(view, "zz"), { row: null, lifted: [], under: null });
  assert.equal(asksBeforeRemoving(mid.lifted, true), true);
  assert.equal(asksBeforeRemoving(mid.lifted, false), false, "the setting off asks nothing");
  assert.equal(asksBeforeRemoving(liftedBy(view, "g1").lifted, true), false, "a row with none beneath it is removed at once");
  assert.equal(asksBeforeRemoving([], true), false);
});

t("removing the row that carries the chart's template passes its record to the rows lifted from it", () => {
  assert.equal(templateOf(ROWS, "w1").template, "T.fam", "read from the top row above it");
  const kept = planUnlist({ rows: ROWS, key: "v" }).kept;
  assert.equal(templateOf(kept, "w1").template, "T.fam", "w1 carries the record itself once v is gone");
  const own = planUnlist({ rows: ROWS.map((r) => (r.key === "w1" ? { ...r, gen: { template: "T.own" } } : r)), key: "v" }).kept;
  assert.equal(templateOf(own, "w1").template, "T.own", "a lifted row's own record is kept, never overwritten");
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

t("the rank a card's leader would hold is read from the unit alone, with or without a leader", () => {
  assert.equal(leaderRoleOf({ parentKey: "p", gen: { tier: 0 }, children: [] }), "champion");
  assert.equal(leaderRoleOf({ parentKey: "p", gen: { tier: 1 }, children: [] }), "sub");
  assert.equal(leaderRoleOf({ parentKey: "", gen: { tier: 2 }, children: [] }), "chief");
  assert.equal(roleOf({ empty: false, officer: null, parentKey: "p", gen: { tier: 1 }, children: [] }), "file", "a card with no leader is still the rank and file");
});

t("a link is empty where none is named, live where its actor resolves and deleted where it names one that does not", () => {
  assert.equal(officerStateOf({ officerUuid: "", resolves: false }), "empty");
  assert.equal(officerStateOf({ officerUuid: "A.1", resolves: true }), "live");
  assert.equal(officerStateOf({ officerUuid: "A.1", resolves: false }), "deleted");
  assert.equal(officerStateOf({ officerUuid: "", resolves: true }), "empty", "no link, nothing to resolve");
  assert.equal(officerStateOf(), "empty");
});

t("an officer line offers each control only to a seat that passes that control's own test, in every state", () => {
  const all = { owns: true, canOpen: true, canDelete: true, canCreate: true, canMake: true };
  assert.deepEqual(officerControls({ state: "live", ...all }), { open: true, clear: true, deleteActor: true, make: false, add: false, drop: true });
  assert.deepEqual(officerControls({ state: "empty", ...all }), { open: false, clear: false, deleteActor: false, make: true, add: false, drop: true });
  assert.deepEqual(officerControls({ state: "deleted", ...all }), { open: false, clear: true, deleteActor: false, make: true, add: false, drop: true }, "a deleted link offers Make and Clear and nothing on the actor");
  // A seat that owns the card but may not delete the actor: Clear stays, Delete actor is gone.
  assert.deepEqual(officerControls({ state: "live", ...all, canDelete: false }), { open: true, clear: true, deleteActor: false, make: false, add: false, drop: true });
  // A seat that may not create actors is shown no Make, in both states that would offer it.
  for (const state of ["empty", "deleted"]) assert.equal(officerControls({ state, ...all, canCreate: false }).make, false);
  // The generating feature cannot name a leader from the row: no Make.
  assert.equal(officerControls({ state: "empty", ...all, canMake: false }).make, false);
  assert.equal(officerControls({ state: "empty", ...all, canMake: false }).add, true, "where Make cannot be offered, + Officer is");
  // A seat that owns neither the host nor the group writes none of it; it may still look.
  assert.deepEqual(officerControls({ state: "live", ...all, owns: false }), { open: true, clear: false, deleteActor: false, make: false, add: false, drop: false });
  assert.deepEqual(officerControls({ state: "deleted", ...all, owns: false }), { open: false, clear: false, deleteActor: false, make: false, add: false, drop: false });
  // A seat that may not see the actor is not offered Open.
  assert.equal(officerControls({ state: "live", ...all, canOpen: false }).open, false);
  assert.deepEqual(officerControls({ state: "live" }), { open: false, clear: false, deleteActor: false, make: false, add: false, drop: false }, "no test passed, no control");
});

t("a deleted officer is told from an empty line by the uuid the chart keeps, and a holder that does not resolve stays an empty card", () => {
  const world = { "G.a": { name: "A", img: "", count: 3, officer: null, officerUuid: "A.gone" }, "G.b": { name: "B", img: "", count: 3, officer: null, officerUuid: "" } };
  const tree = orgChartView([row("a", "", "G.a"), row("b", "", "G.b"), row("c", "", "G.none")], (u) => world[u] ?? null);
  const byKey = Object.fromEntries(tree.rows.map((r) => [r.key, r]));
  assert.equal(byKey.a.officerUuid, "A.gone", "the dead link keeps its uuid");
  assert.equal(byKey.a.officer, null);
  assert.equal(byKey.b.officerUuid, "");
  assert.equal(byKey.c.empty, true, "an unresolved holder reads empty, as it did");
  assert.equal(byKey.c.officerUuid, "");
});

t("a window is redrawn for a deleted actor only where its leader line, a row's group or a group's officer names it", () => {
  const facts = { leaderUuid: "A.lead", rows: [{ holderUuid: "G.1", officerUuid: "A.o1" }, { holderUuid: "G.2", officerUuid: "" }] };
  for (const uuid of ["A.lead", "G.1", "A.o1", "G.2"]) assert.equal(windowNames(facts, uuid), true, uuid);
  assert.equal(windowNames(facts, "A.other"), false);
  assert.equal(windowNames(facts, ""), false);
  assert.equal(windowNames({ leaderUuid: "", rows: [{ holderUuid: "G.1", officerUuid: "" }] }, ""), false, "a blank link names nothing");
  assert.equal(windowNames(), false);
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

t("a Remove reads as the row that left, the rows that moved up and the row they stand beneath, or as nothing for a leaf", () => {
  const out = { ok: true, removed: { key: "w", label: "W" }, under: { key: "v", label: "V" }, lifted: [{ key: "a", label: "A" }, { key: "b", label: "B" }] };
  assert.deepEqual(unlistedView(out), { removed: "W", under: "V", lifted: ["A", "B"], names: "A · B" });
  assert.equal(unlistedView({ ...out, under: null }).under, null, "the top names no parent");
  assert.equal(unlistedView({ ok: true, removed: { key: "w", label: "W" }, under: null, lifted: [] }), null);
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

t("a host's own record stands in for the template and the start of the chart where no row carries one", () => {
  const hostGen = { template: "T.host", variant: "alba", context: "lair", state: "wandering", rules: { troops: true } };
  const bare = [row("w1", "", "G.w1", { gen: { tier: 1 } }), row("g1", "w1")];
  assert.deepEqual(templateOf(bare, "g1"), { template: "", variant: "" }, "no host record, no template");
  assert.deepEqual(templateOf(bare, "g1", hostGen), { template: "T.host", variant: "alba" }, "a gang under a top row reads the host's");
  assert.equal(templateOf([row("w1", "", "", { gen: { template: "T.row", variant: "brex" } })], "w1", hostGen).template, "T.row", "a row's own record is read first");
});

t("a family read of a host whose top unit is the host takes the template, the variant and the recorded choices from its record", async () => {
  const hostGen = { template: "T.host", variant: "alba", context: "lair", state: "wandering", rules: { troops: true }, choices: { a: "b" } };
  const got = await familyOfRows([row("w1", "", "G.w1")], "w1", async (u) => ({ uuid: u }), hostGen);
  assert.equal(got.family.uuid, "T.host");
  assert.deepEqual([got.defaults.variant, got.defaults.context, got.defaults.state, got.defaults.rules, got.defaults.choices], ["alba", "lair", "wandering", { troops: true }, { a: "b" }]);
});

t("where the host holds the chart's chief, a leader of a top card that holds units is a sub chief, and the card reads so", () => {
  const top = { parentKey: "", gen: { tier: 1 }, children: [], officer: { name: "L" } };
  assert.equal(leaderRoleOf(top), "chief", "a lone warband's leader stays the chief");
  assert.equal(leaderRoleOf(top, true), "sub");
  assert.equal(roleOf(top, true), "sub");
  assert.equal(leaderRoleOf({ parentKey: "", gen: { tier: 0 }, children: [] }, true), "champion", "a unit of bodies only is a champion at any level");
  const cards = chartCards(view.roots, { hostLeads: true });
  assert.deepEqual(cards.map((c) => c.leaderRoleKey), view.roots.map((r) => (r.empty ? "" : leaderRoleOf(r, true))));
  assert.equal(nextLevelKind(orgChartView([row("a", "", "G.v", { kind: "band" }), row("b", "", "", { kind: "band" }), row("p", "", "G.g1")], () => null), true), "band", "the level a hand-added row joins is the top rows' own kind");
});

t("a faction's leader line offers Make beside a deleted leader and in a blank line, by the same seat test, and not beside a live one", () => {
  const seat = { owns: true, canCreate: true, canMake: true };
  assert.deepEqual(["", "L"].map((u) => hostLeaderState({ linked: !!u, gone: false })), ["empty", "live"]);
  assert.equal(hostLeaderState({ linked: true, gone: true }), "deleted");
  for (const state of ["empty", "deleted"]) assert.equal(officerControls({ state, ...seat }).make, true, state);
  assert.equal(officerControls({ state: "live", ...seat }).make, false);
  assert.equal(officerControls({ state: "empty", ...seat, canCreate: false }).make, false, "the seat test is unchanged");
});

t("a part row whose group names an officer draws the line with Open, Clear and Delete actor and no Make; one that names none draws no line", () => {
  const seat = { owns: true, canOpen: true, canDelete: true, canCreate: true, canMake: true };
  assert.deepEqual(officerControls({ state: "live", part: true, ...seat }), { open: true, clear: true, deleteActor: true, make: false, add: false, drop: true });
  assert.equal(officerControls({ state: "deleted", part: true, ...seat }).make, false, "a deleted officer is cleared, not made again");
  assert.equal(officerControls({ state: "deleted", part: true, ...seat }).clear, true);
  assert.equal(officerControls({ state: "empty", ...seat }).make, true, "a unit row keeps its Make");
  assert.deepEqual(["live", "deleted", "empty"].map((state) => officerLineShown({ state, part: true })), [true, true, false]);
  assert.equal(officerLineShown({ state: "empty" }), true, "a unit row draws its line with none");
  assert.equal(officerLineShown({ state: "empty", part: true, offered: true }), true, "a part row draws the line for a seat that may add an officer or drop one on it");
});

t("+ Officer is offered where + Make cannot be, never beside it, never disabled, and to the seat Make needs", () => {
  const seat = { owns: true, canCreate: true };
  const offers = (state, extra) => officerControls({ state, ...seat, ...extra });
  assert.deepEqual([offers("empty", { canMake: true }).make, offers("empty", { canMake: true }).add], [true, false], "a row that makes keeps Make alone");
  assert.deepEqual([offers("empty", { part: true, canMake: true }).make, offers("empty", { part: true, canMake: true }).add], [false, true], "a part row has no role to make");
  assert.deepEqual([offers("empty", { canMake: false }).make, offers("empty", { canMake: false }).add], [false, true], "a row the service refuses is added to");
  assert.equal(offers("deleted", { part: true }).add, true, "a deleted officer's line offers it beside Clear");
  assert.equal(offers("live", { part: true }).add, false, "a live officer is replaced by a drop, not added to");
  for (const extra of [{ owns: false }, { canCreate: false }]) for (const part of [true, false]) assert.equal(offers("empty", { ...extra, part }).add, false, JSON.stringify(extra));
  for (const part of [true, false]) for (const state of ["empty", "live", "deleted"]) {
    const c = offers(state, { part, canMake: true });
    assert.equal(c.make && c.add, false, "never both");
  }
  assert.equal(officerControls({ state: "live", owns: true }).drop, true, "the drop needs ownership alone");
  assert.equal(officerControls({ state: "empty", owns: false, canCreate: true }).drop, false, "a seat that does not own the row's group gets no drop target");
});

t("a part row's officer line names no role and shows the neutral frame; a row with a role keeps it", () => {
  assert.deepEqual(officerLineRole({ leaderRoleKey: "champion" }, { part: true, derived: "champion" }), { frame: "file", key: "", bare: true });
  assert.deepEqual(officerLineRole({}, { part: false, derived: "sub" }), { frame: "sub", key: "sub", bare: false });
  assert.deepEqual(officerLineRole({ leaderRoleKey: "chief" }, { part: false, derived: "sub" }), { frame: "chief", key: "chief", bare: false }, "the row's own recorded role wins over the derived one");
});

t("the actor a + Officer press makes is a copy of the row's source creature, or a blank of the Make type, named by the row", () => {
  assert.equal(officerSourceOf([{ template: { uuid: "" } }, { template: { uuid: "Actor.src" } }, { template: { uuid: "Actor.two" } }]), "Actor.src", "the first stack that names a creature");
  assert.equal(officerSourceOf([{ template: { uuid: "" } }]), "", "a labelled stack names none");
  assert.equal(officerSourceOf(undefined), "");
  assert.deepEqual(officerActorData({ label: "QA Part young", type: "monster" }), { name: "QA Part young", type: "monster" }, "blank: a name and a type, no figure");
  assert.deepEqual(officerActorData({ label: "QA Part young" }), { name: "QA Part young", type: "monster" });
  const source = {
    _id: "x1", name: "QA Source", type: "monster", folder: "f", sort: 3, ownership: { default: 3 }, _stats: { v: 1 }, img: "i.webp",
    system: { hp: { value: 4 } }, items: [{ _id: "i1", name: "QA Item" }], prototypeToken: { name: "QA Source", texture: { src: "t.webp" } },
    flags: { core: { sourceId: "c" }, "acks-extras": { organisationPrototype: "key", generated: { templateUuid: "T.fam" } } },
  };
  const before = JSON.stringify(source);
  const copy = officerActorData({ source, label: "QA Part young", type: "monster" });
  assert.equal(JSON.stringify(source), before, "the source is read, never changed");
  assert.deepEqual([copy.name, copy.type, copy.img, copy.system.hp.value, copy.items.length, copy.prototypeToken.name, copy.prototypeToken.texture.src], ["QA Part young", "monster", "i.webp", 4, 1, "QA Part young", "t.webp"]);
  for (const k of ["_id", "folder", "sort", "ownership", "_stats"]) assert.equal(k in copy, false, k);
  assert.equal(copy.flags.core, undefined);
  assert.equal(copy.flags["acks-extras"].organisationPrototype, undefined, "never the mark of a minted prototype, so the copy is no twin of it");
  assert.equal(copy.flags["acks-extras"].generated.templateUuid, "T.fam", "the rest of the source's record is its own");
  assert.deepEqual(officerChangeOf("Actor.new"), { officer: "Actor.new", moraleBonus: null }, "no morale figure and never the faction's leader");
});

t("an actor dropped on an officer line is taken, a group, a faction, a place or a non-actor is ignored, and a seat that does not own the row's group is refused", () => {
  const owns = { isActor: true, owns: true, uuid: "Actor.n", current: "Actor.o" };
  assert.equal(officerDropVerdict(owns), "accept");
  assert.equal(officerDropVerdict({ ...owns, current: "" }), "accept", "a row with no officer takes it");
  assert.equal(officerDropVerdict({ ...owns, current: "Actor.n" }), "same", "the officer already there is no write");
  for (const kind of ["isGroup", "isFaction", "isPlace"]) assert.equal(officerDropVerdict({ ...owns, [kind]: true }), "ignore", kind);
  assert.equal(officerDropVerdict({ ...owns, isActor: false }), "ignore", "an item or a missing document");
  assert.equal(officerDropVerdict({ ...owns, owns: false }), "refuse");
  assert.equal(officerDropVerdict({ ...owns, owns: false, isGroup: true }), "ignore", "a group is ignored whoever drops it");
  assert.equal(officerDropVerdict(), "ignore");
});

t("replacing an officer by a drop or a press only relinks it: the plan writes the group's officer, deletes nothing, and leaves the faction's leader alone", () => {
  const rows = [row("u1", "", "G.u1")];
  const host = { uuid: "F.1", kind: "faction", leaderUuid: "Actor.old" };
  const plan = planEdit({ host, rows, key: "u1", officer: officerChangeOf("Actor.new"), currentOfficer: "Actor.old" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ops, [{ op: "setOfficer", group: "G.u1", officer: "Actor.new", moraleBonus: null }], "one write, to the group's officer");
  assert.equal(JSON.stringify(plan).includes("delete"), false, "the replaced actor is unlinked and never deleted");
});

t("a part row, one the Roll wrote for a part of the entry, is told by its gen and is never rollable", () => {
  const rows = [row("p1", "", "", { gen: { part: "src-a" } }), row("w1", "", "", { gen: { tier: 1 }, kind: "band" }), row("h1")];
  assert.deepEqual(rows.map((r) => isPartRow(rows, r.key)), [true, false, false]);
  assert.equal(isPartRow(rows, "gone"), false);
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
