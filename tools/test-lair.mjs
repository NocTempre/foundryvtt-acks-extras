/**
 * Offline tests for a lair (scripts/lib/lair-logic.mjs and scripts/lib/lair.mjs):
 * which line a lair rolls, which monster it finds, that it rolls once and
 * serializes per place, what a deleted group costs, and what is said when there
 * is nothing to roll. Every creature and place here is invented, and the dice
 * are asserted by the formula thrown, so a roll that reads the wrong side fails
 * however the die lands.
 *
 * Run: node tools/test-lair.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

globalThis.Hooks = { on() {}, call() {}, callAll() {} };
const setProperty = (object, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), object);
  parent[last] = value;
};
globalThis.foundry = {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => class {} }) },
  utils: {
    deepClone: (v) => structuredClone(v),
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    setProperty,
    randomID: () => uid("rnd"),
  },
  applications: { handlebars: { renderTemplate: async () => "<div>card</div>" } },
};
globalThis.CONST = {
  DEFAULT_TOKEN: "icons/masked.svg",
  TOKEN_DISPOSITIONS: { HOSTILE: -1 },
  TOKEN_DISPLAY_MODES: { HOVER: 30 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 },
};

const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url)));
const words = (key) => {
  assert.ok(key in lang, `no lang key ${key}`);
  return lang[key];
};
const users = [{ id: "judge", isGM: true }, { id: "player", isGM: false }];
users.activeGM = { isSelf: true };
const docs = new Map();
globalThis.game = {
  users,
  user: users[0],
  time: { worldTime: 0 },
  scenes: Object.assign([], { viewed: null }),
  folders: [],
  actors: [],
  packs: [],
  dice3d: { async showForRoll() {} },
  i18n: {
    has: (key) => key in lang,
    localize: words,
    format: (key, data = {}) => words(key).replace(/\{(\w+)\}/g, (_, name) => data[name] ?? ""),
  },
};
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const chat = [];
globalThis.ChatMessage = { async create(data) { chat.push(data); return data; } };
globalThis.Folder = { async create(data) { const folder = { id: uid("fld"), ...data }; game.folders.push(folder); return folder; } };

/** Every formula the dice were asked for, in order. */
const thrown = [];
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    if (this.formula.includes("!")) throw new Error("no such formula");
    thrown.push(this.formula);
    this.total = 4;
    this.result = "4";
    return this;
  }
};

const MODULE_ID = "acks-extras";

/** A group the size of its stacks, as `Actor.create` hands it back. */
function groupOf(data) {
  const doc = {
    id: uid("grp"),
    name: data.name,
    type: "acks-extras.group",
    img: data.img ?? CONST.DEFAULT_TOKEN,
    isToken: false,
    prototypeToken: data.prototypeToken,
    system: {
      stacks: [],
      noun: "",
      reveal: data.system.reveal,
      unit: { category: "monster" },
      toObject() { return { stacks: structuredClone(this.stacks), noun: this.noun, reveal: this.reveal }; },
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setProperty(doc, path, value);
      return doc;
    },
    async delete() { docs.delete(doc.uuid); doc.deleted = true; },
  };
  doc.uuid = `Actor.${doc.id}`;
  docs.set(doc.uuid, doc);
  return doc;
}
const made = [];
globalThis.Actor = {
  implementation: {
    DEFAULT_ICON: CONST.DEFAULT_TOKEN,
    async create(data) {
      const group = groupOf(data);
      made.push(group);
      return group;
    },
  },
};

const side = (noun, number, unit = "") => ({ noun, number, unit });

/** A library monster, stamped with a cookbook id and carrying its lines as the importer stores them. */
function monster({ id, name = "Knot", type = "monster", encounter = null, stamp = {}, flags = {}, stats = {} }) {
  const doc = {
    id: uid("act"),
    name,
    type,
    img: "art/knot.webp",
    isToken: false,
    system: { details: { appearing: {} } },
    prototypeToken: { texture: { src: "art/knot.webp" } },
    _stats: stats,
    flags: { [MODULE_ID]: { extras: { encounter }, cookbook: { id, cite: "Page 9", ...stamp }, ...flags } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    toObject() { return { name, type, system: structuredClone(this.system), flags: structuredClone(this.flags) }; },
  };
  doc.uuid = `Compendium.world.shelf.Actor.${doc.id}`;
  docs.set(doc.uuid, doc);
  return doc;
}

/** The shelf the importer mints: a world pack of actors. */
const shelf = { metadata: { packageType: "world", label: "ACKS Cookbook — Actor" }, documentName: "Actor", index: { size: 0 }, size: 0, contents: [] };
game.packs = [shelf];
const stock = (...actors) => { shelf.contents.push(...actors); };

/** A lair place: a location actor holding its roster and its lair flag, writes applied as Foundry applies them. */
function lairPlace({ of = "zz.beast", name = "Place 7", roster = [], pack = null } = {}) {
  const doc = {
    id: uid("loc"),
    name,
    pack,
    type: "acks-extras.location",
    system: { roster },
    flags: { [MODULE_ID]: { lair: of ? { of } : undefined } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setProperty(doc, path, value);
      return doc;
    },
  };
  doc.uuid = pack ? `Compendium.${pack}.Actor.${doc.id}` : `Actor.${doc.id}`;
  docs.set(doc.uuid, doc);
  return doc;
}

const LINES = {
  dungeon: { wandering: side("DW", "1d8"), lair: side("DL", "3d6") },
  wilderness: { wandering: side("WW", "2d4"), lair: side("WL", "2d6*10") },
};

const { lairData, lairOf, planLair, isShelved, lairForCopy, LAIR_KEY, LAIR_REASONS } = await import("../scripts/lib/lair-logic.mjs");
const { lairMonster, lairState, rollLair, lairWhy } = await import("../scripts/lib/lair.mjs");

let passed = 0;
async function ok(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
}
const lairNotes = () => chat.filter((m) => m.speaker?.alias === words("ACKS-LIB.lair.speaker"));

/* -------------------------------------------- */
/*  What a lair's monster allows                */
/* -------------------------------------------- */

await ok("a lair reads the lair side of the line it is asked for, and no other", () => {
  const beast = monster({ id: "zz.sides", encounter: LINES });
  assert.deepEqual(planLair(beast, "wilderness"), { ok: true, formula: "2d6*10", noun: "WL" });
  assert.deepEqual(planLair(beast, "dungeon"), { ok: true, formula: "3d6", noun: "DL" });
});

await ok("a lair side that counts units, states no count, or belongs to a template makes nothing, and says which", () => {
  const units = monster({ id: "zz.units", encounter: { wilderness: { lair: side("WL", "4d4", "troops") } } });
  assert.deepEqual(planLair(units, "wilderness"), { ok: false, reason: "units", count: "4d4 troops", unit: "troops" });
  const bare = monster({ id: "zz.bare", encounter: { wilderness: { wandering: side("WW", "2d4") } } });
  assert.equal(planLair(bare, "wilderness").reason, "none", "a wandering count is no lair count");
  assert.equal(planLair(monster({ id: "zz.none" }), "wilderness").reason, "none");
  assert.equal(planLair(monster({ id: "zz.tpl", type: "acks-extras.template", encounter: LINES }), "wilderness").reason, "template");
  assert.equal(planLair(null, "wilderness").reason, "notImported");
});

await ok("every reason a lair gives has its words, and the words name the unit they were given", () => {
  for (const reason of LAIR_REASONS) assert.ok(lairWhy(reason, { count: "4d4 troops", unit: "troops" }).length > 0, reason);
  assert.match(lairWhy("units", { count: "4d4 troops", unit: "troops" }), /troops/);
});

await ok("the flag is the monster's id and nothing else until a roll writes more", () => {
  assert.deepEqual(lairData("zz.beast"), { of: "zz.beast" });
  assert.equal(LAIR_KEY, "lair");
  assert.equal(lairOf(lairPlace({ of: "" })), null);
  assert.deepEqual(lairOf(lairPlace()), { of: "zz.beast", group: "", noted: "" });
});

/* -------------------------------------------- */
/*  Finding the monster                         */
/* -------------------------------------------- */

const beast = monster({ id: "zz.beast", name: "Beast", encounter: LINES });
// World documents come first in the library's order: a copy and a group's base actor carry the stamp.
const copy = monster({ id: "zz.beast", name: "Beast copy", encounter: LINES, flags: { worldCopy: true } });
const dragged = monster({ id: "zz.beast", name: "Beast dragged", encounter: LINES, stats: { compendiumSource: "Compendium.world.shelf.Actor.x" } });
const base = monster({ id: "zz.beast", name: "Beast base", encounter: LINES, flags: { templateFor: "Actor.grp" } });
game.actors = [copy, dragged, base];
stock(beast);

await ok("a lair finds the library's own actor, never a world copy or a group's base actor with the same stamp", async () => {
  assert.equal(await lairMonster(lairPlace()), beast);
  assert.equal(await lairMonster(lairPlace({ of: "zz.absent" })), null, "a monster that is not imported has no actor");
  assert.equal(await lairMonster(lairPlace({ of: "" })), null, "a place that is no lair has none");
});

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

await ok("a roll makes the group from the library's monster, throws its wilderness lair side, and links it hidden", async () => {
  const place = lairPlace();
  const result = await rollLair(place);
  assert.equal(result.ok, true);
  assert.deepEqual(thrown, ["2d6*10"]);
  const group = made.at(-1);
  assert.equal(group.system.stacks[0].template.uuid, beast.uuid, "the stack keeps the library's uuid: nothing is copied at link time");
  assert.equal(group.system.stacks[0].rolled.state, "lair");
  assert.equal(group.system.stacks[0].rolled.context, "wilderness");
  assert.equal(place.flags[MODULE_ID].lair.group, group.uuid);
  assert.equal(place.flags[MODULE_ID].lair.of, "zz.beast");
  assert.deepEqual(place.system.roster.map((r) => [r.uuid, r.hidden, r.kind]), [[group.uuid, true, "group"]]);
  assert.equal(place.system.roster[0].quantity, 4, "the row counts the bodies rolled, never one for the monster");
  assert.equal(lairNotes().length, 0, "a roll that made a group has nothing to tell the Judges");
});

await ok("a lair rolls once: the group is still there, so a second roll makes nothing", async () => {
  const place = lairPlace();
  await rollLair(place);
  const before = [made.length, thrown.length];
  const again = await rollLair(place);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "rolled");
  assert.equal(again.group, made.at(-1));
  assert.deepEqual([made.length, thrown.length], before);
});

await ok("two arrivals at once make one group", async () => {
  const place = lairPlace();
  const before = made.length;
  const [first, second] = await Promise.all([rollLair(place), rollLair(place)]);
  assert.equal(made.length, before + 1);
  assert.deepEqual([first.ok, second.ok, second.reason], [true, false, "rolled"]);
});

await ok("a deleted group rolls again, and its stale row leaves the roster", async () => {
  const place = lairPlace();
  await rollLair(place);
  const first = made.at(-1);
  await first.delete();
  const result = await rollLair(place);
  assert.equal(result.ok, true);
  const second = made.at(-1);
  assert.notEqual(second.uuid, first.uuid);
  assert.equal(place.flags[MODULE_ID].lair.group, second.uuid);
  assert.deepEqual(place.system.roster.map((r) => r.uuid), [second.uuid]);
});

await ok("a lair whose printed lines already name its monster still rolls, beside them", async () => {
  const printed = { uuid: beast.uuid, name: "Beast", kind: "monster", hidden: true, quantity: 3 };
  const place = lairPlace({ roster: [printed] });
  const result = await rollLair(place);
  assert.equal(result.ok, true);
  assert.deepEqual(place.system.roster.map((r) => r.uuid), [beast.uuid, made.at(-1).uuid]);
});

await ok("the other line is rolled when it is named", async () => {
  const before = thrown.length;
  await rollLair(lairPlace(), { context: "dungeon" });
  assert.deepEqual(thrown.slice(before), ["3d6"]);
});

/* -------------------------------------------- */
/*  Only a world place rolls                    */
/* -------------------------------------------- */

await ok("a place in a compendium makes no group and writes nothing, and says why", async () => {
  const shelved = lairPlace({ pack: "world.shelf" });
  assert.deepEqual([isShelved(shelved), isShelved(lairPlace())], [true, false]);
  const [groups, dice, notes] = [made.length, thrown.length, lairNotes().length];
  const result = await rollLair(shelved);
  assert.deepEqual([result.ok, result.reason, result.text], [false, "shelved", lairWhy("shelved")]);
  assert.deepEqual([made.length, thrown.length, lairNotes().length], [groups, dice, notes], "no group, no die, no card");
  assert.deepEqual([shelved.flags[MODULE_ID].lair, shelved.system.roster], [{ of: "zz.beast" }, []], "the shelf place is left as it was");
  assert.equal(shelved.flags[MODULE_ID].lair.group, undefined);
});

await ok("a lair is rolled on its world copy alone: the shelf place refuses while the copy still rolls", async () => {
  const shelved = lairPlace({ pack: "world.shelf" });
  const world = lairPlace();
  assert.equal((await rollLair(shelved)).reason, "shelved");
  const result = await rollLair(world);
  assert.equal(result.ok, true);
  assert.equal((await rollLair(shelved)).reason, "shelved", "still refused once its copy holds a group");
  assert.equal(shelved.flags[MODULE_ID].lair.group, undefined);
});

await ok("a copy of a lair that had rolled starts with its monster alone", () => {
  assert.deepEqual(lairForCopy({ of: "zz.beast", group: "Actor.g1", noted: "units" }), { of: "zz.beast" });
  assert.equal(lairForCopy({ group: "Actor.g1" }), null);
  assert.equal(lairForCopy(undefined), null);
});

/* -------------------------------------------- */
/*  Nothing to roll                             */
/* -------------------------------------------- */

await ok("a lair counted in units makes no group, tells the Judges once, and remembers it did", async () => {
  stock(monster({ id: "zz.troops", name: "Troops", encounter: { wilderness: { lair: side("WL", "4d4", "troops") } } }));
  const place = lairPlace({ of: "zz.troops", name: "Place <8>" });
  const groups = made.length;
  const [dice, notes] = [thrown.length, lairNotes().length];
  const first = await rollLair(place);
  const second = await rollLair(place);
  assert.deepEqual([first.ok, first.reason, second.reason], [false, "units", "units"]);
  assert.match(first.text, /troops/);
  assert.equal(made.length, groups);
  assert.equal(thrown.length, dice);
  assert.equal(lairNotes().length, notes + 1, "told once across two presses");
  const note = lairNotes().at(-1);
  assert.deepEqual(note.whisper, ["judge"]);
  assert.match(note.content, /Place &lt;8&gt;/, "the place's name is escaped into the card");
  assert.equal(place.flags[MODULE_ID].lair.noted, "units");
});

await ok("a lair whose monster is not imported says so, and rolls once it is", async () => {
  const place = lairPlace({ of: "zz.later", name: "Place 9" });
  const notes = lairNotes().length;
  assert.equal((await rollLair(place)).reason, "notImported");
  assert.equal(lairNotes().length, notes + 1);
  stock(monster({ id: "zz.later", name: "Later", encounter: LINES }));
  const result = await rollLair(place);
  assert.equal(result.ok, true);
  assert.equal(place.flags[MODULE_ID].lair.noted, "", "a roll that made a group clears the note");
});

await ok("a count the dice cannot read leaves no group behind", async () => {
  stock(monster({ id: "zz.bad", name: "Bad", encounter: { wilderness: { lair: side("WL", "1d6!") } } }));
  const place = lairPlace({ of: "zz.bad", name: "Place 10" });
  const groups = made.length;
  const result = await rollLair(place);
  assert.deepEqual([result.ok, result.reason], [false, "invalid"]);
  assert.equal(made.length, groups + 1, "the group was made to be rolled");
  assert.equal(made.at(-1).deleted, true, "and was taken away when it could not be");
  assert.equal(place.flags[MODULE_ID].lair.group, undefined);
  assert.equal(place.flags[MODULE_ID].lair.noted, "invalid");
});

await ok("a place that is no lair is refused without a word", async () => {
  const notes = lairNotes().length;
  const result = await rollLair(lairPlace({ of: "" }));
  assert.deepEqual([result.ok, result.reason], [false, "notLair"]);
  assert.equal(lairNotes().length, notes);
});

/* -------------------------------------------- */
/*  What the sheet reads                        */
/* -------------------------------------------- */

await ok("the sheet reads the monster, the group and whether a Roll would do anything", async () => {
  const place = lairPlace();
  let state = await lairState(place);
  assert.deepEqual([state.monster.name, state.monster.cite, state.group, state.canRoll, state.why], ["Beast", "Page 9", null, true, ""]);
  await rollLair(place);
  state = await lairState(place);
  assert.equal(state.group.total, 4);
  assert.match(state.group.tip, /2d6\*10/, "the count's tooltip names the formula it was rolled on");
  assert.match(state.group.tip, /Page 9/, "and the page the monster's line was read from");
  assert.equal(state.canRoll, false);
  assert.equal(state.why, lairWhy("rolled"));
  const units = await lairState(lairPlace({ of: "zz.troops" }));
  assert.deepEqual([units.canRoll, units.why === lairWhy("units", { count: "4d4 troops", unit: "troops" })], [false, true]);
  const absent = await lairState(lairPlace({ of: "zz.absent" }));
  assert.deepEqual([absent.monster, absent.canRoll], [null, false]);
  assert.equal(await lairState(lairPlace({ of: "" })), null);
});

await ok("the sheet reads a shelf place as one that cannot roll, and says where it rolls", async () => {
  const state = await lairState(lairPlace({ pack: "world.shelf" }));
  assert.deepEqual([state.shelved, state.canRoll, state.why], [true, false, lairWhy("shelved")]);
  assert.equal(state.monster.name, "Beast", "the monster is still read, so the section shows it");
  const world = await lairState(lairPlace());
  assert.deepEqual([world.shelved, world.canRoll], [false, true]);
});

/* -------------------------------------------- */
/*  Wiring the mocks do not reach               */
/* -------------------------------------------- */

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

await ok("the arrival path rolls the lair from every exit of the party token's creation", () => {
  const formation = src("scripts/formation/module.mjs");
  const hook = formation.slice(formation.indexOf('Hooks.on("createToken"'), formation.indexOf("function adoptSceneSystem"));
  assert.match(hook, /const arrived = \(\) => \{\s+requestCountryRefresh\(tokenDoc\.parent\?\.id\);\s+enterLair\(tokenDoc\.parent\);/);
  assert.equal(hook.split(".then(arrived)").length - 1, 2, "both adoption paths end in the arrival");
  const enter = formation.slice(formation.indexOf("function enterLair"), formation.indexOf('Hooks.on("createToken"'));
  assert.ok(enter.includes("acksExtras.location?.scenes?.locationOfScene?.(scene)"), "the place is read through the location api, never imported");
  assert.ok(enter.includes('rollLair(place, { context: "wilderness" }).catch('));
});

const { default: Handlebars } = await import("handlebars");
await ok("the sheet's Lair section is the Judge's alone, names its button, and holds no control in a summary", () => {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => String(key));
  const template = src("templates/location/location-sheet.hbs");
  const from = template.indexOf("The monster this place is the lair of");
  const to = template.indexOf("The domain this place answers to");
  assert.ok(from > 0 && to > from, "the lair section was found");
  const section = template.slice(template.lastIndexOf("{{!--", from), template.lastIndexOf("{{!--", to));
  assert.doesNotMatch(section, /\sid=/, "a window may be open twice: no literal id");
  assert.doesNotMatch(section, /<summary>[^]*<(button|a)\b[^]*<\/summary>/, "no control inside the disclosure toggle");
  const render = hb.compile(section);
  assert.equal(render({ lair: null }).trim(), "", "a place that is no lair, or a seat that is not the Judge's, draws nothing");
  const rolled = render({ lair: { monster: { uuid: "M", name: "Beast", tip: "Read from Page 9" }, group: { uuid: "G", name: "Beast encounter", countLabel: "×4", tip: "Rolled" }, why: "", canRoll: false } });
  assert.match(rolled, /data-action="rollLair"[^>]*disabled/);
  assert.ok(rolled.includes('aria-label="ACKS-LOCATION.place.lair.rollLabel"'));
  assert.match(rolled, /data-tooltip-text="Read from Page 9"/, "the monster's page is a tooltip taken at render");
  assert.match(rolled, /data-tooltip-text="Rolled"[^>]*>×4/, "the rolled count carries where it came from");
  const shelf = render({ lair: { monster: null, group: null, why: "Rolls from its world copy", canRoll: false, shelved: true } });
  assert.match(shelf, /data-action="rollLair"[^>]*disabled/);
  assert.match(shelf, /<span class="acks-extras-place-hint">Rolls from its world copy<\/span>/, "the reason is text on the surface, beside the button");
  assert.doesNotMatch(render({ lair: { monster: null, group: null, why: "x", canRoll: true, shelved: false } }), /Rolls from/);
  const open = render({ lair: { monster: null, group: null, why: "Nothing to roll", canRoll: false } });
  assert.ok(open.includes("ACKS-LOCATION.place.lair.notImported"));
  assert.match(open, /Nothing to roll/, "why there is no group is on the surface, not only in a tooltip");
  assert.doesNotMatch(render({ lair: { monster: { uuid: "M", name: "Beast", tip: "" }, group: null, why: "", canRoll: true } }), /rollLair"[^>]*disabled/);
});

await ok("the lair flag has one writer: nothing outside lair.mjs and the importer's creation names the key", () => {
  const lib = src("scripts/lib/lair.mjs");
  assert.ok(lib.includes("LAIR_KEY}.group"));
  const sheet = src("scripts/location/apps/location-sheet.mjs");
  assert.ok(!sheet.includes("MODULE_ID}.lair") && !sheet.includes('"lair")') && !sheet.includes("LAIR_KEY"), "the sheet reads a lair through lairState and writes none");
});

console.log(`lair: ${passed} cases passed`);
