/**
 * `serviceNodes(employer)` over stand-in documents: the employer's service tree in
 * lib's organisation-node shape, set against the cards the Followers tab builds for
 * the same employer, a hired unit whose officer is its card's head and no node, a chain that loops,
 * and the nodes read through lib's own chart view with no henchmen-specific code.
 * Every name and id is invented.
 *
 * Run: node tools/test-service-nodes.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

/* -------------------------------------------- */
/*  Stand-in world                              */
/* -------------------------------------------- */

globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { fields: {} },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
  utils: {},
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.libWrapper = undefined;

/** A world collection: a Map of documents with Foundry's `contents`. */
class World extends Map {
  get contents() {
    return [...this.values()];
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
}
const actors = new World();
globalThis.game = {
  actors,
  user: { isGM: true, id: "gm" },
  users: { activeGM: { id: "gm", isGM: true, isSelf: true }, find: () => null },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: () => undefined },
  time: { worldTime: 0 },
  modules: { get: () => undefined },
};
globalThis.fromUuidSync = (uuid) => actors.get(String(uuid).replace(/^Actor\./, "")) ?? null;
globalThis.console.warn = () => {};

const MODULE = "acks-extras";
const GROUP = `${MODULE}.group`;

/**
 * An actor over plain data. `hires` is core's `henchmenList`, `monsters` this
 * module's roster flag, `category` the retainer category, `unit` a group's unit block.
 */
function makeActor({ id, type = "character", category = "", hires = [], monsters = [], unit = null }) {
  const system = { retainer: { enabled: !!category, category, managerid: "" }, henchmenList: [...hires] };
  if (unit) system.unit = unit;
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: `Name ${id}`,
    img: "",
    type,
    isOwner: true,
    system,
    getFlag: (scope, key) => (scope === MODULE && key === "monsterHenchmenList" && monsters.length ? [...monsters] : undefined),
    // Core's getHirelings hands back duplicated snapshots of a character's henchmen, bucketed by category.
    getHirelings() {
      if (type !== "character") return { henchman: [], mercenary: [], specialist: [] };
      const out = { henchman: [], mercenary: [], specialist: [] };
      for (const hid of system.henchmenList) {
        const found = actors.get(hid);
        if (!found) continue;
        const copy = { _id: found.id };
        (out[found.system.retainer.category] ?? out.henchman).push(copy);
      }
      return out;
    },
  };
  actors.set(id, actor);
  return actor;
}

const { serviceNodes, hirelingBuckets, hiredUnitsOf } = await import("../scripts/henchmen/engine/service-tree.mjs");
const { buildFollowersTab, followersSwitch, followersViewOf, hasServiceFollowers, FOLLOWERS_VIEWS } = await import("../scripts/character-sheet/tabs/followers.mjs");
const { orgChartView, rowRoots } = await import("../scripts/lib/org-tree-logic.mjs");

/**
 * The world every case reads: an employer with two henchmen, one of whom has a
 * henchman of their own, a mercenary, a specialist who leads the employer's hired unit,
 * and a monster on the roster flag.
 */
function buildWorld() {
  actors.clear();
  const under = makeActor({ id: "under", category: "henchman" });
  const lead = makeActor({ id: "lead", category: "henchman", hires: ["under"] });
  const plain = makeActor({ id: "plain", category: "henchman" });
  const sworn = makeActor({ id: "sworn", category: "mercenary" });
  const captain = makeActor({ id: "captain", category: "specialist" });
  const beast = makeActor({ id: "beast", type: "monster", category: "henchman" });
  const boss = makeActor({ id: "boss", hires: ["lead", "plain", "sworn", "captain"], monsters: ["beast"] });
  const band = makeActor({
    id: "band",
    type: GROUP,
    unit: { category: "mercenary", employerUuid: boss.uuid, officerUuid: captain.uuid },
  });
  return { boss, lead, under, plain, sworn, captain, beast, band };
}

const byKey = (nodes) => Object.fromEntries(nodes.map((n) => [n.key, n]));
const cardIds = async (employer) => (await buildFollowersTab(employer)).groups.flatMap((g) => g.cards.map((c) => c.id));

/* -------------------------------------------- */
/*  The tree                                    */
/* -------------------------------------------- */

console.log("service nodes: the tree");
await test("the employer is the root, each hireling stands under who employs them, and the nodes are lib's shape", () => {
  const w = buildWorld();
  const nodes = serviceNodes(w.boss);
  assert.deepEqual(Object.keys(nodes[0]).sort(), ["holderUuid", "key", "kind", "label", "parentKey"]);
  assert.deepEqual(nodes[0], { key: w.boss.uuid, parentKey: "", label: w.boss.name, holderUuid: w.boss.uuid, kind: "" });
  const at = byKey(nodes);
  assert.equal(at[w.lead.uuid].parentKey, w.boss.uuid);
  assert.equal(at[w.under.uuid].parentKey, w.lead.uuid, "a henchman's own henchman stands under them");
  assert.equal(at[w.beast.uuid].parentKey, w.boss.uuid, "a monster on the roster flag stands under its employer");
  assert.equal(at[w.beast.uuid].kind, "henchman", "kind is the category the data carries");
  assert.equal(at[w.sworn.uuid].kind, "mercenary");
  assert.equal(at[w.band.uuid].kind, "mercenary", "a unit's kind is its unit category");
  assert.ok(nodes.every((n) => n.holderUuid === n.key), "the holder is the node's own actor or group");
  assert.equal(rowRoots(nodes).length, 1, "one root");
});

await test("the actor nodes under the employer are the tab's cards less the hired units' officers, and each unit is a node", async () => {
  const w = buildWorld();
  const nodes = serviceNodes(w.boss);
  const cards = await cardIds(w.boss);
  assert.deepEqual(cards, ["lead", "plain", "beast", "sworn", "captain"], "the tab's own order: henchmen, then the roster's monsters, mercenaries, specialists");
  const officers = new Set(hiredUnitsOf(w.boss).map((u) => u.system.unit.officerUuid));
  const expected = cards.map((id) => `Actor.${id}`).filter((uuid) => !officers.has(uuid));
  const direct = nodes.filter((n) => n.parentKey === w.boss.uuid && !hiredUnitsOf(w.boss).some((u) => u.uuid === n.key)).map((n) => n.key);
  assert.deepEqual(direct, expected, "the employer's direct hirelings are the tab's cards, in its order, less the officers");
  assert.deepEqual(
    nodes.filter((n) => hiredUnitsOf(w.boss).some((u) => u.uuid === n.key)).map((n) => n.key),
    [w.band.uuid],
    "the hired unit is a node and the tab draws no card for it",
  );
});

await test("a unit's officer has no node of its own, under the unit or beside it", async () => {
  const w = buildWorld();
  const nodes = serviceNodes(w.boss);
  assert.equal(nodes.filter((n) => n.holderUuid === w.captain.uuid).length, 0);
  assert.ok((await cardIds(w.boss)).includes(w.captain.id), "the tab still shows the officer as a specialist card");
});

await test("a unit employed by someone else is read for its own employer, with no node for its officer", () => {
  const w = buildWorld();
  const stranger = makeActor({ id: "stranger" });
  const outsider = makeActor({ id: "outsider", category: "specialist" });
  const other = makeActor({
    id: "other",
    type: GROUP,
    unit: { category: "mercenary", employerUuid: stranger.uuid, officerUuid: outsider.uuid },
  });
  assert.ok(!serviceNodes(w.boss).some((n) => n.key === other.uuid), "not under the first employer");
  const mine = byKey(serviceNodes(stranger));
  assert.equal(mine[other.uuid].parentKey, stranger.uuid);
  assert.ok(!mine[outsider.uuid], "an officer no roster holds has no node either");
});

await test("an employer with nothing is the root alone, and a missing employer answers an empty list", () => {
  buildWorld();
  const lone = makeActor({ id: "lone" });
  assert.deepEqual(serviceNodes(lone).map((n) => n.key), [lone.uuid]);
  assert.deepEqual(serviceNodes(null), []);
  assert.deepEqual(hirelingBuckets(null), { henchmen: [], mercenaries: [], specialists: [] });
});

/* -------------------------------------------- */
/*  A chain that loops                          */
/* -------------------------------------------- */

console.log("service nodes: a loop");
await test("a henchman who hires their own employer ends the walk with each holder once", () => {
  const w = buildWorld();
  w.under.system.henchmenList.push(w.boss.id, w.lead.id);
  w.band.system.unit.employerUuid = w.captain.uuid;
  w.captain.system.henchmenList.push(w.boss.id);
  const nodes = serviceNodes(w.boss);
  const keys = nodes.map((n) => n.key);
  assert.equal(new Set(keys).size, keys.length, "no holder twice");
  assert.equal(byKey(nodes)[w.under.uuid].parentKey, w.lead.uuid, "the first claim stands");
  assert.ok(keys.includes(w.band.uuid));
});

await test("an employer who is their own henchman stands once as the root", () => {
  const w = buildWorld();
  w.boss.system.henchmenList.push(w.boss.id);
  const nodes = serviceNodes(w.boss);
  assert.equal(nodes.filter((n) => n.key === w.boss.uuid).length, 1);
  assert.equal(nodes[0].parentKey, "");
});

/* -------------------------------------------- */
/*  Through lib's chart view                    */
/* -------------------------------------------- */

console.log("service nodes: lib's views");
/** A holder as lib's `readHolder` answers it: a unit's `officerUuid` is read into its `officer` field. */
const readLikeLib = (uuid) => {
  const doc = actors.get(uuid.replace(/^Actor\./, ""));
  if (!doc) return null;
  const lead = doc.type === GROUP ? actors.get(String(doc.system.unit.officerUuid ?? "").replace(/^Actor\./, "")) : null;
  return {
    name: doc.name,
    img: "",
    count: 1,
    ancestors: [],
    officer: lead ? { uuid: lead.uuid, name: lead.name, img: "" } : null,
  };
};

await test("lib's org chart view draws the nodes as a tree with no henchmen-specific code", () => {
  const w = buildWorld();
  const nodes = serviceNodes(w.boss);
  const view = orgChartView(nodes, readLikeLib);
  assert.equal(view.roots.length, 1);
  assert.equal(view.roots[0].holderUuid, w.boss.uuid);
  assert.equal(view.rows.length, nodes.length, "every node is a row");
  const row = Object.fromEntries(view.rows.map((r) => [r.key, r]));
  assert.equal(row[w.under.uuid].depth, 2);
  assert.equal(row[w.band.uuid].depth, 1);
  assert.equal(view.empty, 0);
});

await test("each unit's officer is drawn exactly once, as the head of its unit's row", () => {
  const w = buildWorld();
  const view = orgChartView(serviceNodes(w.boss), readLikeLib);
  const drawn = view.rows.filter((r) => r.holderUuid === w.captain.uuid || r.officer?.uuid === w.captain.uuid);
  assert.equal(drawn.length, 1, "once, not as a row and again as a head");
  assert.equal(drawn[0].key, w.band.uuid);
  assert.equal(drawn[0].officer.uuid, w.captain.uuid);
});

await test("a loop reads through the view and ends", () => {
  const w = buildWorld();
  w.under.system.henchmenList.push(w.boss.id);
  const view = orgChartView(serviceNodes(w.boss), () => ({ name: "n", img: "", count: 1 }));
  assert.equal(view.rows.length, new Set(view.rows.map((r) => r.key)).size);
});

console.log("service nodes: the Followers tab's view choice");
await test("the switch is for a lord with a follower besides itself, and the choice falls back to the cards otherwise", () => {
  const w = buildWorld();
  const nodes = serviceNodes(w.boss);
  assert.ok(hasServiceFollowers(nodes));
  assert.ok(!hasServiceFollowers(serviceNodes(w.under)), "a lone follower is only the root");
  assert.ok(!hasServiceFollowers([]) && !hasServiceFollowers(undefined));
  assert.deepEqual(FOLLOWERS_VIEWS, ["cards", "chart", "locations"]);
  assert.equal(followersViewOf(undefined, nodes), "cards", "the default is the cards");
  for (const v of FOLLOWERS_VIEWS) assert.equal(followersViewOf(v, nodes), v);
  assert.equal(followersViewOf("tree", nodes), "cards", "an unknown choice is the cards");
  assert.equal(followersViewOf("chart", serviceNodes(w.under)), "cards", "a choice kept while followers stood is the cards once none is left");
});

await test("the tab's data carries the view in use, the switch with the current view pressed, and no switch for a lone character", async () => {
  const w = buildWorld();
  const chart = await buildFollowersTab(w.boss, { view: "chart" });
  assert.deepEqual([chart.view, chart.showCards, chart.showChart, chart.showLocations], ["chart", false, true, false]);
  assert.deepEqual(chart.switch.buttons.map((b) => [b.key, b.on]), [["cards", false], ["chart", true], ["locations", false]]);
  assert.ok(chart.switch.buttons.every((b) => b.label && b.tip), "every button has a name and a tooltip");
  const plain = await buildFollowersTab(w.boss);
  assert.deepEqual([plain.view, plain.showCards], ["cards", true], "the default view is the cards");
  assert.equal(plain.groups.length, 3, "the cards are today's, whatever the view");
  const lone = await buildFollowersTab(w.under, { view: "locations" });
  assert.equal(lone.switch, null);
  assert.deepEqual([lone.view, lone.showCards], ["cards", true]);
  assert.equal(followersSwitch("cards", []), null);
});

console.log(`\n${passed} passed`);
