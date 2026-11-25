/**
 * Offline tests for the organisation chart over mocked documents (scripts/lib/org.mjs
 * and org-host.mjs): the reverse index and `orgHostOf`, including a holder or a host
 * deleted; add, send out, recall, join and leave and the order each writes in; the
 * twin a join leaves between its two writes; and the two views over a world.
 * The decisions are tools/test-org-tree.mjs's. Every name and figure in here is
 * invented.
 *
 * Run: node tools/test-org.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

/** The callbacks the lib registered on Foundry's hooks, by hook name. */
const handlers = {};
globalThis.Hooks = {
  on: (name, fn) => (handlers[name] ??= []).push(fn),
  once() {},
  call: () => true,
  callAll() {},
};
const fire = (name, ...args) => (handlers[name] ?? []).forEach((fn) => fn(...args));

globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    randomID: () => uid("row"),
  },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.ui = { notifications: {} };
globalThis.canvas = {};

const world = new Map();
class Coll extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}
const actors = new Coll();
globalThis.game = { actors, scenes: new Coll(), users: new Coll(), user: { isGM: true, id: "u1" }, i18n: { localize: (k) => k, format: (k) => k } };
globalThis.fromUuid = async (uuid) => world.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => world.get(uuid) ?? null;

/** The order documents were written in, `name:what`. */
let writes = [];

const GROUP = "acks-extras.group";
const FACTION = "acks-extras.faction";
const LOCATION = "acks-extras.location";

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
};
const expand = (changes) => {
  const out = {};
  for (const [path, value] of Object.entries(changes)) setPath(out, path, value);
  return out;
};

/** An actor document over the system block given, a seat's own unless told otherwise. */
function makeActor(type, name, system, { isOwner = true } = {}) {
  const id = uid("act");
  const doc = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type,
    name,
    img: "",
    isOwner,
    isToken: false,
    system,
    statuses: new Set(),
    refuse: false,
    getFlag: () => null,
    async update(changes) {
      if (this.refuse) throw new Error(`${name} refused the write`);
      for (const [path, value] of Object.entries(changes)) setPath(this, path, structuredClone(value));
      writes.push(`${name}:${Object.keys(changes).join(",")}`);
      fire("updateActor", this, expand(changes));
    },
  };
  world.set(doc.uuid, doc);
  actors.set(id, doc);
  fire("createActor", doc);
  return doc;
}

/** Take a document out of the world as a deletion does. */
function remove(doc, { announce = true } = {}) {
  world.delete(doc.uuid);
  actors.delete(doc.id);
  if (announce) fire("deleteActor", doc);
}

const group = (name, { bodies = 0, parent = "", units = [], officer = "" } = {}, opts) =>
  makeActor(GROUP, name, { stacks: bodies ? [{ size: { current: bodies } }] : [], unit: { parentGroupUuid: parent, officerUuid: officer }, units }, opts);
const faction = (name, units = [], opts) => makeActor(FACTION, name, { units, members: [] }, opts);
const place = (name, roster = [], opts) => makeActor(LOCATION, name, { roster }, opts);
const rosterRow = (doc) => ({ uuid: doc.uuid, name: doc.name, kind: "group", quantity: 1, hidden: false });

globalThis.Actor = {
  implementation: {
    async create(data) {
      writes.push(`create:${data.name}`);
      return group(data.name);
    },
  },
};

const row = (key, parentKey = "", holderUuid = "", extra = {}) => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {}, ...extra });

const org = await import("../scripts/lib/org.mjs");
org.registerOrgIndex();

const reset = () => {
  world.clear();
  actors.clear();
  writes = [];
  fire("deleteActor", {});
};

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* -------------------------------------------- */
/*  The reverse index                            */
/* -------------------------------------------- */

t("a holder answers with the host and the row that name it, a group's chart included", () => {
  reset();
  const gang = group("Gang", { bodies: 3 });
  const war = group("Warband", { bodies: 5 });
  const f = faction("Village", [row("w", "", war.uuid), row("g", "w", gang.uuid)]);
  const found = org.orgHostOf(gang.uuid);
  assert.equal(found.host, f);
  assert.equal(found.row.key, "g");
  assert.equal(org.orgHostOf("Actor.nobody"), null);
  assert.equal(org.orgHostOf(""), null);
  const lone = group("Lone", { units: [row("x", "", war.uuid)] });
  assert.equal(org.orgHostOf(war.uuid).host, f, "the faction answers over the group's chart for a holder both name");
  assert.equal(org.orgHostOf(lone.uuid), null, "a group that holds no row is named by no chart");
});

t("a row written after the index was read is found", () => {
  reset();
  const gang = group("Gang");
  const f = faction("Village", []);
  assert.equal(org.orgHostOf(gang.uuid), null);
  f.update({ "system.units": [row("g", "", gang.uuid)] });
  assert.equal(org.orgHostOf(gang.uuid).row.key, "g", "the update dropped the index");
  const late = group("Late");
  group("Host", { units: [row("l", "", late.uuid)] });
  assert.equal(org.orgHostOf(late.uuid).row.key, "l", "a host created after it too");
});

t("a deleted holder or a deleted host no longer answers", () => {
  reset();
  const gang = group("Gang");
  const kept = group("Kept");
  const f = faction("Village", [row("g", "", gang.uuid), row("k", "g", kept.uuid)]);
  assert.ok(org.orgHostOf(gang.uuid) && org.orgHostOf(kept.uuid));
  remove(gang);
  assert.equal(org.orgHostOf(gang.uuid), null, "the holder is gone: its row reads empty");
  assert.equal(org.orgHostOf(kept.uuid).host, f, "its sibling still answers");
  remove(f);
  assert.equal(org.orgHostOf(kept.uuid), null, "the host is gone: nothing names the holder");
});

t("a deletion no hook announced reads empty too, since every hit is read against the world", () => {
  reset();
  const gang = group("Gang");
  const f = faction("Village", [row("g", "", gang.uuid)]);
  const kept = group("Kept", { units: [row("k", "", gang.uuid)] });
  assert.equal(org.orgHostOf(gang.uuid).host, f);
  remove(f, { announce: false });
  assert.equal(org.orgHostOf(gang.uuid).host, kept, "the stale entry for the deleted host is passed over");
  remove(gang, { announce: false });
  assert.equal(org.orgHostOf(gang.uuid), null);
});

t("a deleted faction leaves the group's own chart to answer", () => {
  reset();
  const gang = group("Gang");
  const g = group("Host", { units: [row("g", "", gang.uuid)] });
  const f = faction("Village", [row("g", "", gang.uuid)]);
  assert.equal(org.orgHostOf(gang.uuid).host, f);
  remove(f);
  assert.equal(org.orgHostOf(gang.uuid).host, g);
});

/* -------------------------------------------- */
/*  Add                                          */
/* -------------------------------------------- */

t("add makes an empty row under any row on a faction or on a group", async () => {
  reset();
  const f = faction("Village", [row("v")]);
  const added = await org.addRow(f, "v", { label: "New", kind: "word" });
  assert.equal(added.ok, true);
  const made = f.system.units.find((r) => r.key === added.key);
  assert.deepEqual([made.parentKey, made.label, made.kind, made.holderUuid], ["v", "New", "word", ""]);
  const g = group("Host");
  const top = await org.addRow(g, "", {});
  assert.equal(top.ok, true, "a group with no chart takes a top row");
  assert.equal(g.system.units.length, 1);
  assert.equal((await org.addRow(f, "gone")).reason, "noRow");
  assert.equal((await org.addRow(place("Camp"), "")).reason, "notHost");
});

t("a seat that cannot write the host adds nothing", async () => {
  reset();
  const f = faction("Village", [row("v")], { isOwner: false });
  assert.equal((await org.addRow(f, "v")).reason, "notOwner");
  assert.equal(f.system.units.length, 1);
});

/* -------------------------------------------- */
/*  Send out and recall                          */
/* -------------------------------------------- */

t("send out writes the place first, then the group leaves its parent, and the chart does not move", async () => {
  reset();
  const war = group("Warband", { bodies: 4 });
  const gang = group("Gang", { bodies: 3, parent: war.uuid });
  const ford = place("Ford");
  const camp = place("Camp", [rosterRow(war)]);
  const f = faction("Village", [row("w", "", war.uuid), row("g", "w", gang.uuid)]);
  const before = structuredClone(f.system.units);
  writes = [];
  const sent = await org.sendOut(f, "g", ford.uuid);
  assert.equal(sent.ok, true);
  assert.deepEqual(writes, ["Ford:system.roster", "Gang:system.unit.parentGroupUuid"], "target first, then source");
  assert.deepEqual(ford.system.roster.map((r) => r.uuid), [gang.uuid]);
  assert.equal(gang.system.unit.parentGroupUuid, "");
  assert.deepEqual(camp.system.roster.map((r) => r.uuid), [war.uuid], "the warband stays where it was");
  assert.deepEqual(f.system.units, before, "affiliation never changes");
});

t("send out moves a group that stood on another roster", async () => {
  reset();
  const gang = group("Gang");
  const camp = place("Camp", [rosterRow(gang)]);
  const ford = place("Ford");
  const f = faction("Village", [row("g", "", gang.uuid)]);
  await org.sendOut(f, "g", ford.uuid);
  assert.deepEqual(ford.system.roster.map((r) => r.uuid), [gang.uuid]);
  assert.deepEqual(camp.system.roster, []);
  assert.deepEqual(org.rostersHolding(gang.uuid), [ford.uuid]);
});

t("send out of an empty row makes its group, named from the row, and no press refuses it", async () => {
  reset();
  const ford = place("Ford");
  const f = faction("Village", [row("e", "", "", { label: "Third band" })]);
  const sent = await org.sendOut(f, "e", ford.uuid);
  assert.equal(sent.ok, true);
  assert.equal(sent.made, true);
  assert.equal(sent.group.name, "Third band");
  assert.equal(f.system.units[0].holderUuid, sent.group.uuid, "the row now names it");
  assert.deepEqual(ford.system.roster.map((r) => r.uuid), [sent.group.uuid]);
  const again = await org.sendOut(f, "e", ford.uuid);
  assert.equal(again.made, false, "a second press finds the group it made");
});

t("send out is refused for a place with no roster, a row that is not there, and a seat that cannot write", async () => {
  reset();
  const gang = group("Gang");
  const f = faction("Village", [row("g", "", gang.uuid)]);
  assert.equal((await org.sendOut(f, "g", group("Not a place").uuid)).reason, "noPlace");
  assert.equal((await org.sendOut(f, "gone", place("Ford").uuid)).reason, "noRow");
  const shut = place("Shut", [], { isOwner: false });
  const refused = await org.sendOut(f, "g", shut.uuid);
  assert.equal(refused.reason, "notOwner");
  assert.deepEqual(shut.system.roster, []);
  const open = faction("Open", [row("e", "", "")]);
  writes = [];
  assert.equal((await org.sendOut(open, "e", shut.uuid)).reason, "notOwner");
  assert.deepEqual(writes, [], "an empty row's group is not made before the place is known to take it");
});

t("recall puts the group back under its parent row's group and takes it off the place", async () => {
  reset();
  const war = group("Warband", { bodies: 4 });
  const gang = group("Gang", { bodies: 3 });
  const ford = place("Ford", [rosterRow(gang)]);
  const f = faction("Village", [row("w", "", war.uuid), row("g", "w", gang.uuid)]);
  writes = [];
  const result = await org.recall(f, "g");
  assert.equal(result.ok, true);
  assert.deepEqual(writes, ["Gang:system.unit.parentGroupUuid", "Ford:system.roster"], "back under its group before it leaves the place");
  assert.equal(gang.system.unit.parentGroupUuid, war.uuid);
  assert.deepEqual(ford.system.roster, []);
});

t("recall says why it cannot: a top row, an empty parent row, a parent that is a lone actor", async () => {
  reset();
  const gang = group("Gang");
  const lone = makeActor("character", "Leader", {});
  const f = faction("Village", [row("t", "", gang.uuid), row("e", "", ""), row("c", "e", gang.uuid), row("l", "", lone.uuid), row("d", "l", gang.uuid)]);
  assert.equal((await org.recall(f, "t")).reason, "topRow");
  assert.equal((await org.recall(f, "c")).reason, "emptyParent");
  assert.equal((await org.recall(f, "d")).reason, "parentNotGroup");
  assert.equal((await org.recall(f, "gone")).reason, "noRow");
  assert.equal(gang.system.unit.parentGroupUuid, "", "nothing was written");
});

t("recall under a group that would close a loop is refused by the group's own guard", async () => {
  reset();
  const war = group("Warband");
  const gang = group("Gang");
  war.system.unit.parentGroupUuid = gang.uuid;
  const f = faction("Village", [row("w", "", war.uuid), row("g", "w", gang.uuid)]);
  const result = await org.recall(f, "g");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cycle");
});

/* -------------------------------------------- */
/*  Join and leave                               */
/* -------------------------------------------- */

/** A group hosting its own chart: a warband over two gangs. */
function warbandWorld() {
  reset();
  const war = group("Warband", { bodies: 4 });
  const g1 = group("Gang one", { bodies: 3, parent: war.uuid });
  const g2 = group("Gang two", { bodies: 2 });
  war.system.units = [row("w", "", war.uuid), row("g1", "w", g1.uuid), row("g2", "w", g2.uuid)];
  const vil = group("Village group", { bodies: 1 });
  const f = faction("Village", [row("v", "", vil.uuid)]);
  return { war, g1, g2, vil, f };
}

t("join writes the faction first and clears the group, and the faction then answers for every row", async () => {
  const { war, g1, f } = warbandWorld();
  writes = [];
  const result = await org.join(war, f, "v");
  assert.equal(result.ok, true);
  assert.deepEqual(writes, ["Village:system.units", "Warband:system.units"]);
  assert.deepEqual(f.system.units.map((r) => [r.key, r.parentKey]), [["v", ""], ["w", "v"], ["g1", "w"], ["g2", "w"]], "keys kept, the top row under the chosen row");
  assert.deepEqual(war.system.units, []);
  assert.equal(org.orgHostOf(g1.uuid).host, f);
  const chart = org.chartOf(war);
  assert.deepEqual([chart.above, chart.below], [["v"], ["g1", "g2"]], "the group's sheet draws its subtree from the faction's rows");
});

t("a join stopped between its two writes leaves a twin the faction answers for, and a second press completes it", async () => {
  const { war, g1, f } = warbandWorld();
  war.refuse = true;
  const warn = console.warn;
  console.warn = () => {};
  const stopped = await org.join(war, f, "v");
  console.warn = warn;
  assert.equal(stopped.ok, false);
  assert.equal(stopped.reason, "failed");
  assert.equal(f.system.units.length, 4, "the faction took the rows");
  assert.equal(war.system.units.length, 3, "the group still holds its own");
  assert.equal(org.orgHostOf(g1.uuid).host, f, "the faction answers over the group");
  const view = org.orgChart(war);
  assert.deepEqual(view.rows.filter((r) => r.twin).map((r) => r.key), ["w", "g1", "g2"], "the view marks the twin");
  war.refuse = false;
  writes = [];
  const done = await org.join(war, f, "v");
  assert.equal(done.ok, true);
  assert.deepEqual(done.moved, []);
  assert.deepEqual(writes, ["Warband:system.units"], "a second press only clears the group");
  assert.equal(f.system.units.length, 4, "no row twice");
  assert.deepEqual(war.system.units, []);
});

t("join refuses a group with no chart, a group as the faction, and a seat that cannot write", async () => {
  const { war, vil, f } = warbandWorld();
  assert.equal((await org.join(vil, f)).reason, "noRows");
  assert.equal((await org.join(war, group("Other"))).reason, "notFaction");
  assert.equal((await org.join(place("P"), f)).reason, "notGroup");
  f.isOwner = false;
  const shut = await org.join(war, f, "v");
  assert.equal(shut.reason, "notOwner");
  assert.equal(war.system.units.length, 3, "nothing was written");
});

t("a subtree leaves a faction onto the group holding its top row, the group written first", async () => {
  const { war, g1, f } = warbandWorld();
  await org.join(war, f, "v");
  writes = [];
  const left = await org.leave(f, "w");
  assert.equal(left.ok, true);
  assert.deepEqual(writes, ["Warband:system.units", "Village:system.units"]);
  assert.deepEqual(war.system.units.map((r) => [r.key, r.parentKey]), [["w", ""], ["g1", "w"], ["g2", "w"]]);
  assert.deepEqual(f.system.units.map((r) => r.key), ["v"]);
  assert.equal(org.orgHostOf(g1.uuid).host, war, "the group's own chart answers once the faction lets go");
});

t("a leaf may leave, and an empty top row's press makes its group", async () => {
  const { war, g2, f } = warbandWorld();
  await org.join(war, f, "v");
  const leaf = await org.leave(f, "g2");
  assert.equal(leaf.ok, true);
  assert.equal(leaf.group, g2);
  assert.deepEqual(g2.system.units.map((r) => r.key), ["g2"]);
  await org.addRow(f, "v", { label: "Open slot" });
  const open = f.system.units.find((r) => r.label === "Open slot");
  const made = await org.leave(f, open.key);
  assert.equal(made.ok, true);
  assert.equal(made.group.name, "Open slot");
  assert.equal(f.system.units.some((r) => r.key === open.key), false, "the faction dropped it");
  assert.deepEqual(made.group.system.units.map((r) => r.key), [open.key]);
});

t("leave refuses a row that is not there, a lone actor, and a group as the faction", async () => {
  const { war, f } = warbandWorld();
  assert.equal((await org.leave(f, "gone")).reason, "noRow");
  const lone = makeActor("character", "Leader", {});
  f.system.units.push(row("lone", "v", lone.uuid));
  assert.equal((await org.leave(f, "lone")).reason, "holderNotGroup");
  assert.equal((await org.leave(war, "w")).reason, "notFaction");
});

/* -------------------------------------------- */
/*  The views                                    */
/* -------------------------------------------- */

t("the org chart reads each holder's count live, nested groups included, its officer and its empty rows", () => {
  reset();
  const champion = makeActor("character", "Champion", { hp: { value: 5 } });
  const war = group("Warband", { bodies: 4, officer: champion.uuid });
  const g1 = group("Gang one", { bodies: 3, parent: war.uuid });
  const g2 = group("Gang two", { bodies: 2 });
  const f = faction("Village", [row("w", "", war.uuid), row("g1", "w", g1.uuid), row("g2", "w", g2.uuid), row("e", "w", "")]);
  const view = org.orgChart(f);
  const by = Object.fromEntries(view.rows.map((r) => [r.key, r]));
  assert.equal(by.w.count, 7, "the warband's own four and the gang inside it");
  assert.equal(by.g1.covered, true);
  assert.equal(by.g2.covered, false);
  assert.equal(by.w.officer.name, "Champion");
  assert.equal(by.e.empty, true);
  assert.equal(view.total, 7 + 2, "the gang inside the warband is counted once");
  g1.system.unit.parentGroupUuid = "";
  const out = org.orgChart(f);
  assert.equal(out.rows.find((r) => r.key === "w").count, 4, "a gang sent out is no longer in its warband's count");
  assert.equal(out.total, 4 + 3 + 2);
});

t("the locations view lists each place's outermost groups with the rows they hold, and a deleted holder's row reads empty", () => {
  reset();
  const war = group("Warband", { bodies: 4 });
  const g1 = group("Gang one", { bodies: 3, parent: war.uuid });
  const g2 = group("Gang two", { bodies: 2 });
  const camp = place("Camp", [rosterRow(war)]);
  const ford = place("Ford", [rosterRow(g2)]);
  const f = faction("Village", [row("w", "", war.uuid), row("g1", "w", g1.uuid), row("g2", "w", g2.uuid)]);
  const view = org.locations();
  const atCamp = view.places.find((p) => p.uuid === camp.uuid);
  assert.deepEqual(atCamp.groups.map((g) => [g.name, g.count]), [["Warband", 7]]);
  assert.deepEqual(atCamp.groups[0].rows.map((r) => [r.key, r.inside]), [["w", false], ["g1", true]]);
  assert.deepEqual(view.places.find((p) => p.uuid === ford.uuid).groups.map((g) => g.name), ["Gang two"]);
  assert.deepEqual(view.unplaced, []);
  remove(g2);
  assert.equal(org.orgChart(f).rows.find((r) => r.key === "g2").empty, true, "a holder that no longer resolves reads empty");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.stack?.split("\n").slice(0, 4).join("\n      ") ?? err.message}`);
  }
}
console.log(`\ntest-org: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
