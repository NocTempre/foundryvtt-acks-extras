/**
 * Offline tests for the faction line of a group's sheet (scripts/lib/group-faction.mjs):
 * the view the template reads, and the four presses (join, make its own, leave, open)
 * over mocked documents and a mocked picker. The writes they reach are
 * tools/test-org.mjs's. Every name in here is invented.
 *
 * Run: node tools/test-group-faction.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

const handlers = {};
globalThis.Hooks = { on: (name, fn) => (handlers[name] ??= []).push(fn), once() {}, call: () => true, callAll() {} };
const fire = (name, ...args) => (handlers[name] ?? []).forEach((fn) => fn(...args));

/** What the picker was asked and what it answers: `{content, preselected}`, `choice`. */
const picker = { asked: [], choice: null };
/** Notifications said, `[level, text]`. */
let said = [];

globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: { deepClone: (v) => structuredClone(v), randomID: () => uid("row") },
  applications: {
    handlebars: { renderTemplate: async (path, view) => JSON.stringify({ path, view }) },
    api: {
      DialogV2: {
        async wait(options) {
          picker.asked.push(options);
          return picker.choice;
        },
      },
    },
  },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
globalThis.CONFIG = {};
globalThis.canvas = {};
globalThis.ui = { notifications: { warn: (m) => said.push(["warn", m]), info: (m) => said.push(["info", m]) } };

const world = new Map();
class Coll extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}
const actors = new Coll();
const KNOWN = new Set(["ACKS-LIB.org.refused.notOwner", "ACKS-LIB.org.refused.noFaction", "ACKS-LIB.org.refused.failed.join", "ACKS-LIB.org.refused.failed.leave"]);
globalThis.game = {
  actors,
  scenes: new Coll(),
  users: new Coll(),
  user: { isGM: true, id: "u1" },
  i18n: { localize: (k) => k, format: (k, d = {}) => `${k} ${JSON.stringify(d)}`, has: (k) => KNOWN.has(k) },
};
globalThis.fromUuid = async (uuid) => world.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => world.get(uuid) ?? null;

const GROUP = "acks-extras.group";
const FACTION = "acks-extras.faction";

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};
const expand = (changes) => {
  const out = {};
  for (const [path, value] of Object.entries(changes)) setPath(out, path, value);
  return out;
};

function makeActor(type, name, system, { isOwner = true } = {}) {
  const id = uid("act");
  const doc = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type,
    name,
    isOwner,
    isToken: false,
    system,
    opened: 0,
    sheet: { render() { doc.opened++; } },
    async update(changes) {
      if (this.refuse) throw new Error("refused");
      for (const [path, value] of Object.entries(changes)) setPath(this, path, structuredClone(value));
      fire("updateActor", this, expand(changes));
    },
  };
  world.set(doc.uuid, doc);
  actors.set(id, doc);
  fire("createActor", doc);
  return doc;
}
const group = (name, { parent = "", units = [], officer = "" } = {}, opts) =>
  makeActor(GROUP, name, { stacks: [], unit: { parentGroupUuid: parent, officerUuid: officer }, units }, opts);
const faction = (name, units = []) => makeActor(FACTION, name, { units, members: [], leaderUuid: "" });
const row = (key, parentKey = "", holderUuid = "") => ({ key, parentKey, label: `Row ${key}`, holderUuid, kind: "", notes: "", hidden: false, gen: {} });

globalThis.Actor = {
  implementation: {
    async create(data) {
      return makeActor(FACTION, data.name, { units: [], members: [], leaderUuid: "", ...(data.system ?? {}) });
    },
  },
};

const org = await import("../scripts/lib/org.mjs");
org.registerOrgIndex();
const gesture = await import("../scripts/lib/group-faction.mjs");

const reset = () => {
  world.clear();
  actors.clear();
  said = [];
  picker.asked = [];
  picker.choice = null;
  fire("deleteActor", {});
};

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* -------------------------------------------- */
/*  The view                                     */
/* -------------------------------------------- */

t("the view names the faction and the row's label once joined, and carries the seat's edit right", async () => {
  reset();
  const war = group("Warband");
  war.system.units = [row("w", "", war.uuid)];
  const f = faction("Card");
  assert.deepEqual(gesture.factionView(war, true), { joined: false, name: "", rowLabel: "", canEdit: true });
  await org.joinFaction(war, f);
  assert.deepEqual(gesture.factionView(war, true), { joined: true, name: "Card", rowLabel: "Row w", canEdit: true });
  assert.equal(gesture.factionView(war, false).canEdit, false, "a seat that cannot edit sees the line and none of its presses");
});

t("the view is null for a group another group lists", () => {
  reset();
  const war = group("Warband");
  const gang = group("Gang", { parent: war.uuid });
  war.system.units = [row("w", "", war.uuid), row("g", "w", gang.uuid)];
  assert.equal(gesture.factionView(gang, true), null);
});

/* -------------------------------------------- */
/*  The presses                                  */
/* -------------------------------------------- */

t("join opens the picker with every world faction and writes nothing when it is closed", async () => {
  reset();
  const lone = group("Lone");
  faction("Card one");
  faction("Card two");
  picker.choice = null;
  const result = await gesture.pressJoin(lone);
  assert.equal(result, null);
  const view = JSON.parse(picker.asked[0].content).view;
  assert.deepEqual(view.factions.map((f) => f.name), ["Card one", "Card two"]);
  assert.deepEqual(picker.asked[0].classes.includes("acks-extras-scroll"), true, "the picker is in the scroll contract");
  assert.equal(picker.asked[0].rejectClose, false);
  assert.deepEqual(lone.system.units, []);
  assert.deepEqual(said, []);
});

t("join's Cancel and its close each write nothing, and the dialog offers Join then Cancel", async () => {
  reset();
  const lone = group("Lone");
  const f = faction("Card");
  for (const choice of [{ cancelled: true }, "cancel", "join", null, undefined, { faction: "" }]) {
    picker.choice = choice;
    assert.equal(await gesture.pressJoin(lone), null, `resolved ${JSON.stringify(choice)} joins nothing`);
  }
  assert.deepEqual(f.system.units, []);
  assert.deepEqual(lone.system.units, []);
  assert.deepEqual(said, []);
  const { buttons } = picker.asked.at(-1);
  assert.deepEqual(buttons.map((b) => b.action), ["join", "cancel"]);
  assert.equal(buttons[0].default, true);
  assert.deepEqual(buttons[1].callback(), { cancelled: true }, "Cancel returns a value tested for, never nothing");
  assert.equal(gesture.joinChoiceOf({ faction: "Actor.f", under: "k" }).under, "k");
});

t("join writes the faction chosen, says so, and a world with no faction opens nothing", async () => {
  reset();
  const lone = group("Lone");
  await gesture.pressJoin(lone);
  assert.equal(picker.asked.length, 0, "no picker where there is nothing to pick");
  assert.deepEqual(said.map(([level]) => level), ["warn"]);

  said = [];
  const f = faction("Card");
  picker.choice = { faction: f.uuid, under: "" };
  const result = await gesture.pressJoin(lone);
  assert.equal(result.ok, true);
  assert.equal(f.system.units.length, 1);
  assert.deepEqual(said.map(([level]) => level), ["info"]);
});

/** A form the picker's render hook binds: two selects by name, the faction's change listener, and a document that makes options. */
function fakeDialog(factionValue) {
  const options = [];
  const listeners = [];
  const faction = { value: factionValue, addEventListener: (type, fn) => listeners.push([type, fn]) };
  const under = {
    ownerDocument: { createElement: () => ({}) },
    replaceChildren: (...kids) => options.splice(0, options.length, ...kids),
  };
  const form = { elements: { namedItem: (n) => ({ faction, under })[n] } };
  return { dialog: { element: { querySelector: () => form } }, faction, options, change: () => listeners.filter(([t]) => t === "change").forEach(([, fn]) => fn()) };
}

t("the picker offers Under: the top, then the chosen faction's rows indented, refilled when the faction changes", async () => {
  reset();
  const lone = group("Lone");
  const war = group("Warband");
  const gang = group("Gang", { parent: war.uuid });
  const one = faction("Card one", [row("w", "", war.uuid), row("g", "w", gang.uuid)]);
  const two = faction("Card two", [row("x", "")]);
  picker.choice = null;
  await gesture.pressJoin(lone);
  const asked = picker.asked[0];
  const view = JSON.parse(asked.content).view;
  assert.deepEqual(view.under.map((o) => [o.key, o.text]), [["", "ACKS-LIB.org.faction.underTop {}"], ["w", "Row w"], ["g", "\u00a0\u00a0Row g"]], "the first faction's rows, a nested row indented");
  assert.match(view.underTip, /underTip/);
  const live = fakeDialog(one.uuid);
  asked.render(null, live.dialog);
  live.faction.value = two.uuid;
  live.change();
  assert.deepEqual(live.options.map((o) => [o.value, o.textContent]), [["", "ACKS-LIB.org.faction.underTop {}"], ["x", "Row x"]], "a change of faction refills Under with that faction's rows");
});

t("Under names a row as its card does, with the kind word before the label", async () => {
  reset();
  const lone = group("Lone");
  faction("Card", [{ ...row("a", ""), kind: "QA band" }]);
  picker.choice = null;
  await gesture.pressJoin(lone);
  assert.deepEqual(JSON.parse(picker.asked[0].content).view.under.map((o) => o.text).slice(1), ["QA band · Row a"]);
});

t("a Join under a row nests the group's top row there, and the top leaves it a top row", async () => {
  reset();
  const war = group("Warband");
  war.system.units = [row("a", "", war.uuid)];
  const lone = group("Lone");
  const f = faction("Card", [row("r", "")]);
  picker.choice = { faction: f.uuid, under: "r" };
  assert.equal((await gesture.pressJoin(lone)).ok, true);
  assert.equal(f.system.units.find((r) => r.holderUuid === lone.uuid).parentKey, "r", "the group's row stands under the row picked");
  picker.choice = { faction: f.uuid, under: "" };
  assert.equal((await gesture.pressJoin(war)).ok, true);
  assert.equal(f.system.units.find((r) => r.key === "a").parentKey, "", "At the top passes none");
});

t("a reader who is no Judge is offered no hidden row", async () => {
  reset();
  const lone = group("Lone");
  faction("Card", [row("a", ""), { ...row("h", "a"), hidden: true }, row("c", "h")]);
  game.user.isGM = false;
  picker.choice = null;
  try {
    await gesture.pressJoin(lone);
  } finally {
    game.user.isGM = true;
  }
  assert.deepEqual(JSON.parse(picker.asked[0].content).view.under.map((o) => o.key), ["", "a"], "the hidden row and the row beneath it are absent");
});

t("join says why a seat cannot write, in the reason's own words", async () => {
  reset();
  const lone = group("Lone", {}, { isOwner: false });
  const f = faction("Card");
  picker.choice = { faction: f.uuid, under: "" };
  const result = await gesture.pressJoin(lone);
  assert.equal(result.reason, "notOwner");
  assert.deepEqual(said, [["warn", 'ACKS-LIB.org.refused.notOwner {"name":"Lone"}']], "it names the group the seat cannot write");
  said = [];
  assert.equal((await gesture.pressLeave(lone)).reason, "noFaction");
  assert.equal(said[0][1], 'ACKS-LIB.org.refused.noFaction {"name":""}');
});

t("a leave a seat cannot write names the faction", async () => {
  reset();
  const war = group("Warband");
  war.system.units = [row("w", "", war.uuid)];
  const f = faction("Card");
  await org.joinFaction(war, f);
  f.isOwner = false;
  said = [];
  const result = await gesture.pressLeave(war);
  assert.equal(result.reason, "notOwner");
  assert.deepEqual(said, [["warn", 'ACKS-LIB.org.refused.notOwner {"name":"Card"}']]);
  assert.equal(f.system.units.length, 1, "nothing was written");
});

t("a join that stops partway says a join stopped, and a leave that stops says a leave stopped", async () => {
  reset();
  const war = group("Warband");
  war.system.units = [row("w", "", war.uuid)];
  const f = faction("Card");
  const warn = console.warn;
  console.warn = () => {};
  war.refuse = true;
  picker.choice = { faction: f.uuid, under: "" };
  const join = await gesture.pressJoin(war);
  assert.equal(join.reason, "failed");
  assert.match(said.at(-1)[1], /refused.failed.join/);
  war.refuse = false;
  await gesture.pressJoin(war);
  f.refuse = true;
  const leave = await gesture.pressLeave(war);
  console.warn = warn;
  assert.equal(leave.reason, "failed");
  assert.match(said.at(-1)[1], /refused.failed.leave/);
  assert.doesNotMatch(said.at(-1)[1], /failed.join/);
});

t("a reason with no words of its own falls to the general line", async () => {
  reset();
  const war = group("Warband");
  const create = Actor.implementation.create;
  Actor.implementation.create = async () => null;
  const result = await gesture.pressMakeOwn(war);
  Actor.implementation.create = create;
  assert.equal(result.reason, "notMade");
  assert.equal(said[0][1].startsWith("ACKS-LIB.org.refused.other"), true);
});

t("make its own makes the card and says so; leave undoes it and says so; open opens the card", async () => {
  reset();
  const war = group("Warband");
  war.system.units = [row("w", "", war.uuid)];
  const made = await gesture.pressMakeOwn(war);
  assert.equal(made.ok, true);
  assert.equal(said.at(-1)[0], "info");
  assert.equal(gesture.pressOpen(war), true);
  assert.equal(made.faction.opened, 1, "the card's sheet was rendered");
  const left = await gesture.pressLeave(war);
  assert.equal(left.ok, true);
  assert.equal(said.at(-1)[0], "info");
  assert.deepEqual(war.system.units.map((r) => r.key), ["w"]);
  assert.equal(gesture.pressOpen(war), false, "no card lists it now");
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
console.log(`\ntest-group-faction: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
