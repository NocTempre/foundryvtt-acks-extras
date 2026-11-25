/**
 * Offline tests for the organisation plan executor and Delete (scripts/lib/org-run.mjs,
 * org.mjs `deleteRow`, org-write-logic.mjs `planDelete`) over mocked documents and a
 * rolled tree from the monsters feature's pure planner: the order the ops write in and
 * the ref map, one prototype for every stack that names it, one actor for each leader,
 * the officer and a faction's leader, a reference no library entry answers as a
 * labelled stack, what a failed run hands back, and Delete's reach. Every name,
 * figure and unit word in here is invented.
 *
 * Run: node tools/test-org-run.mjs
 */
import assert from "node:assert/strict";

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

globalThis.Hooks = { on() {}, once() {}, call: () => true, callAll() {} };
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: (v) => structuredClone(v), getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), randomID: () => uid("id"), escapeHTML: (s) => s },
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
  filter(fn) {
    return [...this.values()].filter(fn);
  }
}
const actors = new Coll();
const chat = [];
globalThis.ChatMessage = { create: async (d) => chat.push(d) };
globalThis.game = {
  actors, scenes: new Coll(), users: new Coll([["g1", { id: "g1", isGM: true }]]), user: { isGM: true, id: "g1" },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` }, time: { worldTime: 0 },
};
globalThis.fromUuid = async (uuid) => world.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => world.get(uuid) ?? null;

const GROUP = "acks-extras.group";
const FACTION = "acks-extras.faction";
const LOCATION = "acks-extras.location";
/** The order documents were written in. */
let writes = [];

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};

/** An actor document over the system block given. */
function makeDoc(type, name, system = {}, { flags = {}, isOwner = true } = {}) {
  const id = uid("act");
  Object.defineProperty(system, "toObject", { value: () => structuredClone(system), enumerable: false });
  const doc = {
    id, uuid: `Actor.${id}`, documentName: "Actor", type, name, img: "", isOwner, isToken: false, system, flags, statuses: new Set(),
    toObject: () => ({ name, type, system: structuredClone(system), flags: structuredClone(flags) }),
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        setPath(this, path, structuredClone(value));
      }
      writes.push(`${name}:${Object.keys(changes).join(",")}`);
    },
    async delete() {
      world.delete(this.uuid);
      actors.delete(this.id);
      writes.push(`delete:${name}`);
    },
  };
  world.set(doc.uuid, doc);
  actors.set(id, doc);
  return doc;
}
const groupSystem = () => ({ stacks: [], units: [], unit: { parentGroupUuid: "", officerUuid: "", officerMoraleBonus: null } });
const group = (name) => makeDoc(GROUP, name, groupSystem());
const faction = (name, units = []) => makeDoc(FACTION, name, { units, members: [], leaderUuid: "" });
const place = (name, roster = []) => makeDoc(LOCATION, name, { roster });
const creature = (name, flags = {}) => makeDoc("monster", name, { hp: { value: 4, max: 4 }, ac: { value: 5 } }, { flags });

globalThis.Actor = { implementation: { async create(data) {
  writes.push(`create:${data.name}`);
  return makeDoc(data.type, data.name, data.type === GROUP ? groupSystem() : data.type === FACTION ? { units: [], members: [], leaderUuid: "", ...(data.system ?? {}) } : {});
} } };

const { runPlan } = await import("../scripts/lib/org-run.mjs");
const org = await import("../scripts/lib/org.mjs");
const { ORG_PROTOTYPE_FLAG, planDelete, planRoll } = await import("../scripts/lib/org-write-logic.mjs");
const { planOrganisationRoll } = await import("../scripts/monsters/organisation-logic.mjs");

/* ---- the roll's fixture: a recipe of invented units ---- */

const part = (key, role, over = {}) => ({
  key, label: key, role,
  source: { uuid: "", templateCell: "", stat: "", name: "", ...(over.source ?? {}) },
  count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...(over.count ?? {}) },
  chance: over.chance ?? null, when: { state: "", place: "", units: [], ...(over.when ?? {}) }, branch: { group: "", band: "" },
  moraleWhileAlive: over.moraleWhileAlive ?? null, cite: "XX p. 1", basis: "page",
});
const ENCOUNTER = { wilderness: { wandering: { noun: "Band", number: "2", unit: "cells" }, lair: { noun: "Hold", number: "2", unit: "bands" } }, dungeon: { wandering: { noun: "Cell", number: "3", unit: "" } } };
const RECIPE = [
  part("warriors", "body", { count: { ratioOf: "unit", percent: 100, round: "down" }, when: { units: ["cell"] } }),
  part("leader-a", "leader", { source: { templateCell: "alba|a" }, count: { literal: 1 }, when: { units: ["cell"] } }),
  part("leader-b", "leader", { source: { templateCell: "alba|b" }, count: { literal: 1 }, when: { units: ["band"] } }),
  part("leader-c", "leader", { source: { templateCell: "alba|c" }, count: { literal: 1 }, when: { units: ["hold"] }, moraleWhileAlive: 2 }),
  part("guard-1", "guard", { source: { name: "gleaves" }, count: { dice: "2d4" }, when: { units: ["hold"] } }),
  part("guard-2", "guard", { source: { name: "zorps" }, count: { dice: "1d4" }, when: { units: ["hold"] } }),
];
const rollTree = (over = {}) => planOrganisationRoll({ recipe: RECIPE, encounter: ENCOUNTER, variant: "alba", context: "wilderness", state: "lair", rng: () => 0.2, org: {}, library: [{ name: "Gleaf", uuid: "L.gleaf" }], ...over });

/** The provider the monsters feature supplies, over mocks: finds a prototype by its marker or makes it. */
function provider(log = { minted: [], leaders: [] }, { failLeaderAt = null } = {}) {
  return {
    log,
    async mint(spec, { key }) {
      const held = [...actors.values()].find((a) => a.flags?.["acks-extras"]?.[ORG_PROTOTYPE_FLAG] === key);
      if (held) return { actor: held, made: false };
      log.minted.push(key);
      return { actor: creature(`proto ${log.minted.length}`, { "acks-extras": { [ORG_PROTOTYPE_FLAG]: key } }), made: true };
    },
    async makeLeader(op, spec, mount) {
      if (failLeaderAt !== null && log.leaders.length === failLeaderAt) throw new Error("no leader");
      log.leaders.push({ role: op.role, mount });
      return creature(`leader ${log.leaders.length}`);
    },
  };
}

/** A clean world holding the one library entry the roll fixture's reference resolves to. */
const reset = () => {
  world.clear();
  actors.clear();
  writes = [];
  chat.length = 0;
  const entry = creature("Gleaf entry");
  world.delete(entry.uuid);
  entry.uuid = "L.gleaf";
  world.set("L.gleaf", entry);
};
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const stacksOf = (g) => g.system.stacks;

t("a roll's ops are carried out in order, and every ref is a uuid wherever it stood", async () => {
  reset();
  const host = faction("Holdfast");
  const tree = rollTree();
  const plan = planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree, scope: "below" });
  assert.equal(plan.ok, true);
  const run = await runPlan(plan, provider());
  assert.equal(run.ok, true, run.error);
  assert.equal(run.done, plan.ops.length);
  const created = writes.filter((w) => w.startsWith("create:"));
  assert.ok(writes.indexOf(created[0]) < writes.findIndex((w) => w === `Holdfast:system.units,${"system.leaderUuid"}` || w.startsWith("Holdfast:")), "groups exist before the host's rows name them");
  const rows = host.system.units;
  assert.ok(rows.length >= 3);
  assert.ok(rows.every((r) => !JSON.stringify(r).includes("new:")), "no ref is written");
  assert.ok(rows.every((r) => world.has(r.holderUuid)), "every row's holder is a group that exists");
  assert.equal(Object.keys(run.refs).every((k) => k.startsWith("new:")), true);
  assert.equal(run.made.groups.length, rows.length, "a group for each row, nothing more");
});

t("a unit's leader is one actor named as its group's officer, and a village's chief is the faction's leader", async () => {
  reset();
  const host = faction("Holdfast");
  const log = { minted: [], leaders: [] };
  const plan = planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" });
  const run = await runPlan(plan, provider(log));
  const top = world.get(host.system.units.find((r) => !r.parentKey).holderUuid);
  assert.equal(world.get(top.system.unit.officerUuid)?.name, "leader 1", "the first leader made is the top group's officer");
  assert.equal(top.system.unit.officerMoraleBonus, 2, "its morale part rides with it");
  assert.equal(host.system.leaderUuid, top.system.unit.officerUuid, "the chieftain is the faction's leader");
  const officers = run.made.groups.map((u) => world.get(u).system.unit.officerUuid).filter(Boolean);
  assert.equal(new Set(officers).size, officers.length, "no two groups share an officer");
  assert.equal(run.made.leaders.length, log.leaders.length, "one actor for each leader, none beside it");
  assert.ok(!log.minted.some((k) => k.includes('"partKey":"leader-')), "a prototype used only by a leader is never minted as a second actor");
});

t("a creature two stacks name is minted once, and a later run reuses it by its marker", async () => {
  reset();
  const host = faction("Holdfast");
  const log = { minted: [], leaders: [] };
  const first = await runPlan(planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" }), provider(log));
  const bodies = world.get(host.system.units.find((r) => !r.parentKey).holderUuid);
  const warriors = [...actors.values()].filter((a) => a.type === GROUP).flatMap(stacksOf).filter((s) => s.gen.part === "warriors");
  assert.ok(warriors.length >= 2, "several stacks name the same body");
  assert.equal(new Set(warriors.map((s) => s.template.uuid)).size, 1, "all of them copy one prototype");
  assert.equal(first.made.prototypes.length, new Set(log.minted).size, "one actor for each distinct key");
  assert.ok(bodies);
  const again = await runPlan(planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" }), provider(log));
  assert.equal(again.made.prototypes.length, 0, "the second roll makes no prototype it already has");
  assert.equal(again.reused.length, first.made.prototypes.length);
});

t("a reference a library entry answers is a stack of that entry; one nothing answers is a labelled stack and a finding", async () => {
  reset();
  const host = faction("Holdfast");
  const tree = rollTree();
  assert.ok(tree.findings.some((f) => f.what === "reference" && f.word === "zorps" && f.status === "none"), "the finding is listed");
  const run = await runPlan(planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree, scope: "below" }), provider());
  assert.equal(run.ok, true, run.error);
  const all = [...actors.values()].filter((a) => a.type === GROUP).flatMap(stacksOf);
  assert.ok(all.some((s) => s.template.uuid === "L.gleaf"), "the resolved word is built from the library's entry");
  const labelled = all.find((s) => s.gen.part === "guard-2");
  assert.deepEqual([labelled.template.uuid, labelled.template.label], [null, "zorps"], "the unresolved word is a labelled stack");
  assert.ok(!run.made.prototypes.includes("L.gleaf"), "a library entry is never minted");
});

t("a stack's mount, carried pieces and speakers are stored on it", async () => {
  reset();
  const host = faction("Holdfast");
  const plan = planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" });
  const body = plan.ops.find((o) => o.op === "addStack" && o.gen.part === "warriors");
  body.mount = { prototype: body.prototype, perBody: 1 };
  body.carry = { g1: 2 };
  body.speakers = 1;
  const run = await runPlan(plan, provider());
  assert.equal(run.ok, true, run.error);
  const stack = [...actors.values()].filter((a) => a.type === GROUP).flatMap(stacksOf).find((s) => s.gen.part === "warriors" && s.gen.speakers === 1);
  assert.deepEqual([stack.gen.carry, stack.gen.speakers, stack.gen.mount.perBody], [{ g1: 2 }, 1, 1]);
  assert.ok(stack.gen.mount.uuid, "the mount names its creature");
});

t("a run that fails hands back every id it made, and writes no ref it could not resolve", async () => {
  reset();
  const host = faction("Holdfast");
  const plan = planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" });
  const failed = await runPlan(plan, provider(undefined, { failLeaderAt: 1 }));
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "failed");
  assert.ok(failed.made.groups.length > 0 && failed.created.length >= failed.made.groups.length, "the groups it made are named");
  assert.deepEqual(host.system.units, [], "the host was not written");
  reset();
  const bad = { ok: true, ops: [{ op: "createGroup", ref: "new:g1", name: "G" }, { op: "update", uuid: "new:g1", update: { "system.notes": "new:zz" } }] };
  const dead = await runPlan(bad, provider());
  assert.equal(dead.ok, false);
  assert.equal(dead.made.groups.length, 1, "what was made before the refusal is returned");
  assert.ok(!JSON.stringify([...actors.values()].map((a) => a.system)).includes("new:"), "no ref string reaches a document");
});

t("a plan naming an op the executor does not know, or a document the seat cannot write, writes nothing", async () => {
  reset();
  assert.equal((await runPlan({ ok: true, ops: [{ op: "bogusOp" }] }, provider())).reason, "badOp");
  const theirs = makeDoc(FACTION, "Theirs", { units: [] }, { isOwner: false });
  const run = await runPlan({ ok: true, ops: [{ op: "createGroup", ref: "new:g1", name: "G" }, { op: "update", uuid: theirs.uuid, update: {} }] }, provider());
  assert.equal(run.reason, "notOwner");
  assert.deepEqual(writes, [], "before the first write");
});

/** A group with one stack of three bodies named by a prototype, for the setStack cases. */
const oneStack = (roster = []) => {
  const g = makeDoc(GROUP, "Gang", { ...groupSystem(), stacks: [{ key: "s1", template: { uuid: "P.old", type: "monster", label: "Old", snapshot: {}, snapshotTime: 0 }, size: { current: 3, initial: 3, formula: "" }, gen: {}, roster }] });
  return g;
};

t("setStack sets a stack's count and re-points its prototype on the row's group, and refuses a group the seat cannot write before any write", async () => {
  reset();
  const g = oneStack();
  const proto = creature("New proto");
  const run = await runPlan({ ok: true, ops: [{ op: "setStack", group: g.uuid, stack: "s1", count: 7, prototype: proto.uuid }] }, provider());
  assert.equal(run.ok, true, run.error);
  assert.equal(g.system.stacks[0].size.current, 7);
  assert.equal(g.system.stacks[0].size.initial, 7);
  assert.equal(g.system.stacks[0].template.uuid, proto.uuid);
  assert.equal(g.system.stacks[0].template.label, "New proto");
  const theirs = makeDoc(GROUP, "Theirs", groupSystem(), { isOwner: false });
  writes = [];
  const refused = await runPlan({ ok: true, ops: [{ op: "setStack", group: theirs.uuid, stack: "s1", count: 1 }] }, provider());
  assert.equal(refused.reason, "notOwner");
  assert.deepEqual(writes, []);
});

t("setStack floors a count at the bodies the stack already records and says so for a stack that is not there", async () => {
  reset();
  const g = oneStack([{ key: "m1" }, { key: "m2" }]);
  const run = await runPlan({ ok: true, ops: [{ op: "setStack", group: g.uuid, stack: "s1", count: 1 }] }, provider());
  assert.equal(run.ok, true, run.error);
  assert.equal(g.system.stacks[0].size.current, 2, "never below the recorded bodies");
  const gone = await runPlan({ ok: true, ops: [{ op: "setStack", group: g.uuid, stack: "zz", count: 4 }] }, provider());
  assert.equal(gone.reason, "noStack");
  const bad = await runPlan({ ok: true, ops: [{ op: "setStack", group: g.uuid, stack: "s1", prototype: "L.nowhere" }] }, provider());
  assert.equal(bad.reason, "noPrototype");
});

t("Edit runs through the org writer: a filled row's label and a stack's count land, and bodies on a map warn without refusing", async () => {
  reset();
  const g = oneStack();
  const host = faction("Holdfast", [{ key: "u1", parentKey: "", label: "Old", holderUuid: g.uuid, kind: "", notes: "", hidden: false, gen: {} }]);
  const done = await org.editRow(host, "u1", { fields: { label: "New" }, stacks: [{ stack: "s1", count: 5 }] });
  assert.equal(done.ok, true);
  assert.deepEqual(done.warnings, []);
  assert.equal(host.system.units[0].label, "New");
  assert.equal(g.system.stacks[0].size.current, 5);
  g.system.stacks[0].roster = [{ key: "m", tokenUuid: "Scene.x.Token.y" }];
  const warned = await org.editRow(host, "u1", { stacks: [{ stack: "s1", count: 6 }] });
  assert.equal(warned.ok, true);
  assert.deepEqual(warned.warnings, ["onMap"]);
  assert.equal(g.system.stacks[0].size.current, 6, "a warning is not a refusal");
  assert.equal((await org.editRow(host, "zz", {})).reason, "noRow");
  const empty = faction("Bare", [{ key: "e1", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: {} }]);
  assert.equal((await org.editRow(empty, "e1", { stacks: [{ stack: "s", count: 1 }] })).reason, "empty");
});

t("clearing the officer of the faction's own leader clears the faction's leader in the same press, and clearing another officer leaves it", async () => {
  reset();
  const chief = creature("Chief");
  const other = creature("Other");
  const top = group("Top");
  const low = group("Low");
  await top.update({ "system.unit": { officerUuid: chief.uuid } });
  await low.update({ "system.unit": { officerUuid: other.uuid } });
  const host = faction("Holdfast", [{ key: "t", parentKey: "", label: "T", holderUuid: top.uuid, kind: "", notes: "", hidden: false, gen: {} }, { key: "l", parentKey: "t", label: "L", holderUuid: low.uuid, kind: "", notes: "", hidden: false, gen: {} }]);
  await host.update({ "system.leaderUuid": chief.uuid });
  const quiet = await org.editRow(host, "l", { officer: { officer: "", moraleBonus: null } });
  assert.equal(quiet.ok, true);
  assert.equal(low.system.unit.officerUuid, "");
  assert.equal(host.system.leaderUuid, chief.uuid, "another unit's officer was not the faction's leader");
  const cleared = await org.editRow(host, "t", { officer: { officer: "", moraleBonus: null } });
  assert.equal(cleared.ok, true);
  assert.equal(top.system.unit.officerUuid, "");
  assert.equal(host.system.leaderUuid, "", "the faction no longer names the actor the group let go");
  assert.equal(world.has(chief.uuid), true, "the actor stays in the world");
});

t("a roll with no host hosts the chart on its top unit's group", async () => {
  reset();
  const tree = rollTree({ context: "dungeon", state: "wandering" });
  const run = await runPlan(planRoll({ host: null, rows: [], tree }), provider());
  assert.equal(run.ok, true, run.error);
  const top = world.get(run.made.groups[0]);
  assert.equal(top.system.units.length >= 1, true);
  assert.equal(top.system.units[0].holderUuid, top.uuid);
});

t("a Roll on a root group's own empty top row fills that group, so Make its own takes its officer as the card's leader and leaves no shell", async () => {
  reset();
  const root = group("Root");
  root.system.units = [{ key: "top", parentKey: "", label: "Top", holderUuid: "", kind: "", notes: "", hidden: false, gen: { template: "T.1" } }];
  const before = [...world.values()].filter((d) => d.type === GROUP).length;
  const plan = planRoll({ host: { uuid: root.uuid, kind: "group" }, rows: root.system.units, rowKey: "top", tree: rollTree(), scope: "below", topHolder: root.uuid });
  const run = await runPlan(plan, provider());
  assert.equal(run.ok, true, run.error);
  assert.ok(!run.made.groups.includes(root.uuid), "the host is no group the roll made");
  assert.equal(run.made.groups.length, [...world.values()].filter((d) => d.type === GROUP).length - before, "every other group is counted and none is a shell for the top");
  assert.equal(root.system.units.find((r) => r.key === "top").holderUuid, root.uuid, "the top row names the root group itself");
  assert.equal(world.get(root.system.unit.officerUuid)?.name, "leader 1", "the chieftain is the root group's officer");
  assert.ok(run.made.groups.every((u) => world.get(u).system.unit.parentGroupUuid), "every group the roll made is nested, in the root or in one the root holds");
  const card = await org.makeFaction(root);
  assert.equal(card.ok, true);
  assert.equal(card.faction.system.leaderUuid, root.system.unit.officerUuid, "the faction's leader is the chieftain");
  assert.deepEqual(root.system.units, [], "the rows moved to the card");
  assert.equal(card.faction.system.units.find((r) => r.key === "top").holderUuid, root.uuid, "and its top row still names the root group");
});

/* ---- Delete ---- */

t("planDelete removes a row and everything beneath it and names the groups", () => {
  const rows = [{ key: "a", parentKey: "", holderUuid: "G.a" }, { key: "b", parentKey: "a", holderUuid: "G.b" }, { key: "c", parentKey: "b", holderUuid: "" }, { key: "d", parentKey: "", holderUuid: "G.d" }];
  const plan = planDelete({ host: { uuid: "F.1" }, rows, key: "b" });
  assert.deepEqual(plan.keys.sort(), ["b", "c"]);
  assert.deepEqual(plan.holders, ["G.b"]);
  assert.deepEqual(plan.rows.map((r) => r.key), ["a", "d"]);
  assert.equal(planDelete({ host: { uuid: "F.1" }, rows, key: "zz" }).reason, "noRow");
});

t("Delete removes the row, its group, and a prototype no stack still names, and leaves one another stack names", async () => {
  reset();
  const host = faction("Holdfast");
  await runPlan(planRoll({ host: { uuid: host.uuid, kind: "faction" }, rows: [], tree: rollTree(), scope: "below" }), provider());
  const rows = host.system.units;
  const rootKey = rows.find((r) => !r.parentKey).key;
  const kid = rows.find((r) => r.parentKey === rootKey && !r.kind === false);
  const protoOf = (uuid) => stacksOf(world.get(uuid)).map((s) => s.template.uuid).filter(Boolean);
  const outside = creature("Hand-made", {});
  const stray = group("Stray");
  await stray.update({ "system.stacks": [{ key: "s", template: { uuid: outside.uuid }, gen: {}, size: { current: 1 }, roster: [] }] });
  const kidProtos = new Set(protoOf(kid.holderUuid));
  const result = await org.deleteRow(host, kid.key);
  assert.equal(result.ok, true);
  assert.ok(!host.system.units.some((r) => r.key === kid.key), "the row is gone");
  assert.equal(world.has(kid.holderUuid), false, "and its group");
  assert.ok(world.has(outside.uuid), "an actor the generator did not mint is never removed");
  for (const uuid of result.kept) assert.ok(world.has(uuid), "a prototype another group's stack still names stays");
  for (const uuid of result.prototypes) assert.equal(world.has(uuid), false);
  const named = new Set([...actors.values()].filter((x) => x.type === GROUP).flatMap(stacksOf).map((st) => st.template.uuid));
  assert.ok(result.prototypes.every((u) => !named.has(u)), "nothing remaining names a prototype that was removed");
  assert.ok(result.kept.every((u) => named.has(u)), "everything kept is named by a remaining stack");
  assert.ok([...kidProtos].every((u) => result.prototypes.includes(u) || result.kept.includes(u) || !world.get(u)?.flags?.["acks-extras"]), "each marked prototype of the deleted group was decided");
});

t("Delete of a row whose prototype only it named removes the prototype; a stack elsewhere keeps it", async () => {
  reset();
  const host = faction("Holdfast");
  const proto = creature("Only", { "acks-extras": { [ORG_PROTOTYPE_FLAG]: "k1" } });
  const g1 = group("One");
  const g2 = group("Two");
  const stack = (uuid) => [{ key: "s", template: { uuid }, gen: {}, size: { current: 1 }, roster: [] }];
  await g1.update({ "system.stacks": stack(proto.uuid) });
  await host.update({ "system.units": [{ key: "x", parentKey: "", holderUuid: g1.uuid, gen: {} }, { key: "y", parentKey: "", holderUuid: g2.uuid, gen: {} }] });
  const alone = await org.deleteRow(host, "x");
  assert.deepEqual(alone.prototypes, [proto.uuid]);
  assert.equal(world.has(proto.uuid), false);

  const keep = creature("Shared", { "acks-extras": { [ORG_PROTOTYPE_FLAG]: "k2" } });
  const g3 = group("Three");
  const g4 = group("Four");
  await g3.update({ "system.stacks": stack(keep.uuid) });
  await g4.update({ "system.stacks": stack(keep.uuid) });
  await host.update({ "system.units": [{ key: "p", parentKey: "", holderUuid: g3.uuid, gen: {} }, { key: "q", parentKey: "", holderUuid: g4.uuid, gen: {} }] });
  const shared = await org.deleteRow(host, "p");
  assert.deepEqual([shared.prototypes, shared.kept], [[], [keep.uuid]]);
  assert.equal(world.has(keep.uuid), true, "a prototype a stack still names stays");
});

t("Delete takes a group off its roster and clears the faction's leader it named; bodies on a map are a whisper, not a refusal", async () => {
  reset();
  const host = faction("Holdfast");
  const chief = creature("Chief");
  const g = group("Warband");
  await g.update({ "system.unit": { officerUuid: chief.uuid }, "system.stacks": [{ key: "s", template: { uuid: null }, gen: {}, size: { current: 1 }, roster: [{ key: "m", tokenUuid: "Scene.s.Token.t" }] }] });
  const where = place("Ford", [{ uuid: g.uuid, name: "Warband", kind: "group", quantity: 1, hidden: false }]);
  await host.update({ "system.units": [{ key: "v", parentKey: "", holderUuid: g.uuid, gen: {} }], "system.leaderUuid": chief.uuid });
  const result = await org.deleteRow(host, "v");
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, ["onMap"]);
  assert.equal(chat.length, 1, "one whisper to the Judges");
  assert.deepEqual(chat[0].whisper, ["g1"]);
  assert.equal(host.system.leaderUuid, "", "the faction's leader named a deleted group's officer");
  assert.deepEqual(where.system.roster, [], "off the roster");
  assert.deepEqual(result.leaders, [chief.uuid], "the leader stays in the world, and is named");
  assert.equal(world.has(chief.uuid), true);
});

t("a body is minted as the rank and file, never as a leader the Role axis rolls, where the axis names no default", async () => {
  const { pinsOf } = await import("../scripts/monsters/organisation-run.mjs");
  const { chooseAxes } = await import("../scripts/lib/template-logic.mjs");
  const family = (role) => ({
    system: {
      axes: [{ key: "variant", options: [{ key: "alba" }], default: "alba" }, { key: "role", ...role, options: [{ key: "standard" }, { key: "lead" }, { key: "chief" }] }],
      cells: ["standard", "lead", "chief"].map((r) => ({ by: ["variant", "role"], key: `alba|${r}` })),
    },
  });
  const body = { kind: "cell", variant: "alba", role: "", troop: "", trait: "" };
  const roleAt = (fam, pins, roll) => chooseAxes(fam.system, { pinned: pins, rng: () => roll }).choices.role;
  const rolls = [0, 0.4, 0.7, 0.99];
  const noDefault = family({});
  assert.deepEqual(rolls.map((r) => roleAt(noDefault, pinsOf(body), r)), ["standard", "lead", "chief", "chief"], "unpinned, an axis with no default rolls among every option: the leaders too");
  assert.deepEqual(rolls.map((r) => roleAt(noDefault, pinsOf(body, {}, noDefault), r)), ["standard", "standard", "standard", "standard"], "pinned to the rank and file, a body is never a leader");
  assert.equal(pinsOf({ ...body, role: "lead" }, {}, noDefault).role, "lead", "a spec that names a role keeps it");
  const named = family({ default: "lead" });
  assert.equal(pinsOf(body, {}, named).role, undefined, "an axis that names its own default is left to it");
  assert.equal(pinsOf(body, {}, { system: { axes: [] } }).role, undefined, "no Role axis, no pin");
  assert.equal(pinsOf(body, {}, null).role, undefined);
  const bare = { system: { axes: [{ key: "role", options: [{ key: "lead" }] }] } };
  assert.equal(pinsOf(body, {}, bare).role, undefined, "an axis that lists no rank and file is left alone");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.stack?.split("\n").slice(0, 3).join("\n      ") ?? err.message}`);
  }
}
console.log(`\ntest-org-run: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
