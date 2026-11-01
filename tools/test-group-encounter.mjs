/**
 * Offline tests for an encounter group (scripts/lib/group-encounter-logic.mjs and
 * scripts/lib/group-encounter.mjs): what one monster's Roll writes and what it
 * leaves, the lair throw, the noun, the card, Make Encounter, and the token's
 * face. Every line in here is invented, and the dice are asserted by the formula
 * thrown, so a Roll that reads the wrong side fails however the die lands.
 *
 * Run: node tools/test-group-encounter.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

let nextId = 0;
const uid = (p) => `${p}${(++nextId).toString().padStart(4, "0")}`;

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  call(name, ...args) {
    for (const fn of hooks.get(name) ?? []) fn(...args);
  },
  callAll(name, ...args) {
    this.call(name, ...args);
  },
};

const rendered = [];
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
  applications: {
    handlebars: {
      async renderTemplate(path, view) {
        rendered.push({ path, view });
        return "<div>card</div>";
      },
    },
  },
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
globalThis.game = {
  users,
  user: users[0],
  time: { worldTime: 0 },
  scenes: Object.assign([], { viewed: null }),
  folders: [],
  dice3d: {
    shown: [],
    async showForRoll(roll, _user, _sync, viewers) {
      this.shown.push({ total: roll.total, viewers });
    },
  },
  i18n: {
    has: (key) => key in lang,
    localize: words,
    format: (key, data = {}) => words(key).replace(/\{(\w+)\}/g, (_, name) => data[name] ?? ""),
  },
};

const docs = new Map();
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const chat = [];
globalThis.ChatMessage = {
  async create(data) {
    chat.push(data);
    return data;
  },
};
globalThis.Folder = {
  async create(data) {
    const folder = { id: uid("fld"), ...data };
    game.folders.push(folder);
    return folder;
  },
};
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    if (this.formula.includes("!")) throw new Error("no such formula");
    this.total = 4;
    this.result = "4";
    return this;
  }
};

const created = [];
globalThis.Actor = {
  implementation: {
    DEFAULT_ICON: CONST.DEFAULT_TOKEN,
    async create(data) {
      created.push(data);
      const group = groupOf([], { img: data.img, reveal: data.system.reveal });
      group.prototypeToken = data.prototypeToken;
      group.name = data.name;
      return group;
    },
  },
};

const MODULE_ID = "acks-extras";

/** A creature: its lines under the module's flag, as the importer stores them. */
function creature({ name = "Knot", type = "monster", encounter = null, appearing = {}, cite = "", img = "art/knot.webp" } = {}) {
  const doc = {
    id: uid("act"),
    name,
    type,
    img,
    isToken: false,
    system: { details: { appearing } },
    prototypeToken: { texture: { src: img } },
    flags: { [MODULE_ID]: { extras: { encounter }, cookbook: { cite } } },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    toObject() {
      return { name, type, img, system: structuredClone(this.system), flags: structuredClone(this.flags) };
    },
  };
  doc.uuid = `Actor.${doc.id}`;
  docs.set(doc.uuid, doc);
  return doc;
}

const side = (noun, number, unit = "") => ({ noun, number, unit });

/** A stack of a creature. The counts stand as a Roll would find them. */
const stackOf = (source, { current = 0, initial = current, roster = [], rolled = null, formula = "" } = {}) => ({
  key: uid("stk"),
  template: { uuid: source?.uuid ?? null, type: source?.type ?? "monster", label: source?.name ?? "", snapshot: null, snapshotTime: 0 },
  size: { current, initial, formula },
  roster,
  rolled: rolled ?? { total: null, state: "", context: "", noun: "" },
});

/** A group the size of its stacks. `updates` holds what each write asked for. */
function groupOf(stacks, { noun = "", reveal = "", img = CONST.DEFAULT_TOKEN, isToken = false, category = "monster" } = {}) {
  const doc = {
    id: uid("grp"),
    name: "The muster",
    type: "acks-extras.group",
    img,
    isToken,
    prototypeToken: { name: "", actorLink: false, texture: { src: img } },
    updates: [],
    system: {
      stacks,
      noun,
      reveal,
      unit: { category },
      toObject() {
        return { stacks: structuredClone(this.stacks), noun: this.noun, reveal: this.reveal };
      },
    },
    async update(changes) {
      doc.updates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) setProperty(doc, path, value);
      Hooks.call("updateActor", doc, changes);
      return doc;
    },
  };
  doc.uuid = `Actor.${doc.id}`;
  docs.set(doc.uuid, doc);
  return doc;
}

/** Dice that hand back these totals in turn and remember what was thrown. */
function dice(...totals) {
  const thrown = [];
  return {
    thrown,
    async roll(formula) {
      thrown.push(formula);
      const total = totals.shift();
      if (total instanceof Error) throw total;
      return { total, result: String(total) };
    },
  };
}

const {
  BY_LAIR_CHANCE,
  REVEAL,
  ROLL_KIND,
  countOrigin,
  encounterFace,
  fullCaption,
  isCreatureStack,
  lairChanceOf,
  lineReading,
  nextNoun,
  offersRoll,
  planStack,
  rollsBodies,
  rollsOver,
  stackHeld,
  statesACount,
  unitSides,
} = await import("../scripts/lib/group-encounter-logic.mjs");
const { sizeFromEcology } = await import("../scripts/lib/group-logic.mjs");
const encounter = await import("../scripts/lib/group-encounter.mjs");
const { defaultRollContext, judgeCaption, makeEncounter, registerEncounterTokens, rollEncounter, rollRefusal, ROLL_CONTEXT_HOOK } = encounter;

let passed = 0;
async function ok(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const LINES = {
  lairChance: 30,
  dungeon: { wandering: side("Knot", "1d7"), lair: side("Roost", "2d7") },
  wilderness: { wandering: side("Muster", "2d7*3"), lair: side("Roost", "1d7*20") },
};
const format = (key, data) => game.i18n.format(`ACKS-LIB.group.token.${key}`, data);

/** One row's press: the first stack's unless another is named. */
const rollRow = (group, choice, stack = group.system.stacks[0]) => rollEncounter(group, stack.key, choice);

/* -------------------------------------------- */
/*  The line a Roll reads                       */
/* -------------------------------------------- */

await ok("a Roll reads the side it was told to, and never the other", () => {
  const knot = creature({ encounter: LINES });
  assert.equal(lineReading(knot, "dungeon", "wandering").formula, "1d7");
  assert.equal(lineReading(knot, "dungeon", "lair").formula, "2d7");
  assert.equal(lineReading(knot, "wilderness", "wandering").formula, "2d7*3");
  assert.equal(lineReading(knot, "wilderness", "lair").formula, "1d7*20");
  assert.equal(lineReading(knot, "wilderness", "lair").noun, "Roost");

  const lairOnly = creature({ encounter: { wilderness: { lair: side("Roost", "3") } }, appearing: { w: "2" } });
  assert.equal(sizeFromEcology(lairOnly, "wilderness", "wandering"), null, "a line that states a count never reads core's field");
  assert.equal(sizeFromEcology(lairOnly, "wilderness"), "3", "no state is the first side stated");
});

await ok("core's field stands for a wandering side only, and only with no line at all", () => {
  const bare = creature({ appearing: { w: "2d4", d: "1d4" } });
  assert.equal(sizeFromEcology(bare, "wilderness", "wandering"), "2d4");
  assert.equal(sizeFromEcology(bare, "dungeon", "wandering"), "1d4");
  assert.equal(sizeFromEcology(bare, "wilderness", "lair"), null, "core's field holds no lair count");
});

await ok("a side counted in units gives no formula and says so", () => {
  const units = creature({ encounter: { wilderness: { wandering: side("Muster", "2d7", "knots"), lair: side("Roost", "4") } } });
  const reading = lineReading(units, "wilderness", "wandering");
  assert.equal(reading.formula, "");
  assert.equal(reading.unit, "knots");
  assert.match(reading.count, /2d7/);
  assert.deepEqual(unitSides(units).map((s) => [s.context, s.state]), [["wilderness", "wandering"]]);
  assert.equal(statesACount(units), true);
  assert.equal(statesACount(creature()), false);
});

await ok("a lair chance of zero is a figure, and nothing else stands in for one", () => {
  const chance = (lairChance) => lairChanceOf(creature({ encounter: { lairChance } }));
  assert.equal(chance(0), 0);
  assert.equal(chance(35), 35);
  assert.equal(chance(""), null);
  assert.equal(chance(null), null);
  assert.equal(chance(undefined), null);
  assert.equal(chance("none"), null);
  assert.equal(lairChanceOf(null), null);
});

/* -------------------------------------------- */
/*  What a Roll may write                       */
/* -------------------------------------------- */

await ok("an empty stack and a rolled stack are written, and a hand's count is not", () => {
  const knot = creature();
  assert.equal(rollsOver(stackOf(knot)), true);
  assert.equal(rollsOver(stackOf(knot, { current: 5 })), false);
  assert.equal(rollsOver(stackOf(knot, { current: 5, rolled: { total: 5 } })), true);
  assert.equal(rollsOver(stackOf(knot, { current: 0, rolled: { total: 0 } })), true);
  assert.equal(rollsOver(stackOf(knot, { current: 7, rolled: { total: 5 } })), true, "a rolled count a hand changed stays a rolled stack");
});

await ok("a body on record or fallen holds a stack", () => {
  const knot = creature();
  assert.equal(stackHeld(stackOf(knot, { current: 3, roster: [{ key: "m" }] })), true);
  assert.equal(stackHeld(stackOf(knot, { current: 3, initial: 5 })), true);
  assert.equal(stackHeld(stackOf(knot, { current: 5, initial: 3 })), false);
});

await ok("a stack gets the kind its line and its count call for", () => {
  const knot = creature({ encounter: LINES });
  const choice = { context: "wilderness", state: "wandering" };
  assert.equal(planStack(stackOf(knot), knot, choice).kind, ROLL_KIND.roll);
  assert.equal(planStack(stackOf(knot, { current: 2 }), knot, choice).kind, ROLL_KIND.hand);
  const units = creature({ encounter: { wilderness: { wandering: side("Muster", "2d7", "knots") } } });
  assert.equal(planStack(stackOf(units), units, choice).kind, ROLL_KIND.units);
  assert.equal(planStack(stackOf(creature()), creature(), choice).kind, ROLL_KIND.none);
  assert.equal(isCreatureStack(stackOf(creature({ type: "acks-extras.animal" }))), true);
  assert.equal(isCreatureStack(stackOf(creature({ type: "character" }))), false);
});

await ok("a row offers a Roll where a press can size it", () => {
  const knot = creature({ encounter: LINES });
  assert.equal(offersRoll(stackOf(knot), knot), true);
  assert.equal(offersRoll(stackOf(knot, { current: 5, rolled: { total: 5 } }), knot), true, "again, over its own roll");
  assert.equal(offersRoll(stackOf(knot, { current: 5 }), knot), false, "a hand set this count");
  const person = creature({ type: "character", encounter: LINES });
  assert.equal(offersRoll(stackOf(person), person), false);
  const mute = creature();
  assert.equal(offersRoll(stackOf(mute), mute), false);
  const allUnits = creature({ encounter: { wilderness: { wandering: side("Muster", "2d7", "knots") } } });
  assert.equal(offersRoll(stackOf(allUnits), allUnits), false, "units are no bodies");
  const oneSide = creature({ encounter: { wilderness: { wandering: side("Muster", "2d7", "knots"), lair: side("Roost", "4") } } });
  assert.equal(offersRoll(stackOf(oneSide), oneSide), true, "one side that gives bodies is enough");
  assert.equal(rollsBodies(creature({ appearing: { d: "1d4" } })), true, "core's field counts bodies");
});

await ok("the noun: a side's replaces a roll's and fills a blank, and a typed one stands", () => {
  assert.equal(nextNoun("", "", "muster"), "muster");
  assert.equal(nextNoun("muster", "muster", "roost"), "roost");
  assert.equal(nextNoun("rabble", "muster", "roost"), "rabble");
  assert.equal(nextNoun("muster", "muster", ""), "muster");
  assert.equal(nextNoun(undefined, "", ""), "");
});

await ok("a count says where it came from", () => {
  const knot = creature();
  assert.deepEqual(countOrigin(stackOf(knot)), { kind: "empty" });
  assert.deepEqual(countOrigin(stackOf(knot, { current: 4 })), { kind: "hand" });
  assert.deepEqual(countOrigin(stackOf(knot, { current: 4, rolled: { total: 4 } })), { kind: "rolled", total: 4 });
  assert.deepEqual(countOrigin(stackOf(knot, { current: 2, initial: 4, rolled: { total: 4 } })), { kind: "rolled", total: 4 }, "casualties leave the roll standing");
  assert.deepEqual(countOrigin(stackOf(knot, { current: 6, rolled: { total: 4 } })), { kind: "edited", total: 4 });
  assert.deepEqual(countOrigin(stackOf(knot, { current: 6, initial: 4, rolled: { total: 4 } })), { kind: "edited", total: 4 }, "a living count raised past the roll");
});

/* -------------------------------------------- */
/*  The Roll                                    */
/* -------------------------------------------- */

await ok("a press sizes that monster alone from its own line, and no body gets a figure", async () => {
  const knot = creature({ encounter: LINES });
  const other = creature({ name: "Tangle", encounter: { wilderness: { wandering: side("Tangle", "3d7") } } });
  const group = groupOf([stackOf(knot), stackOf(other)]);
  const [, pressed] = group.system.stacks;
  const { roll, thrown } = dice(12);
  const result = await rollRow(group, { context: "wilderness", state: "wandering", roll }, pressed);
  assert.deepEqual(thrown, ["3d7"]);
  assert.equal(result.ok, true);
  assert.equal(result.total, 12);
  const [a, b] = group.system.stacks;
  assert.deepEqual(a.size, { current: 0, initial: 0, formula: "" }, "the stack beside it is not touched");
  assert.equal(a.rolled.total, null);
  assert.deepEqual(b.size, { current: 12, initial: 12, formula: "3d7" });
  assert.deepEqual(b.rolled, { total: 12, state: "wandering", context: "wilderness", noun: "Tangle" });
  assert.deepEqual(b.roster, [], "a roll leaves every body pristine, for materializeMembers to roll its own hit points");
  assert.equal(group.updates.length, 1, "one write, so the group never holds half a roll");
});

await ok("a re-roll replaces what that monster's roll made and nothing else", async () => {
  const knot = creature({ encounter: LINES });
  const other = creature({ name: "Tangle", encounter: { wilderness: { wandering: side("Tangle", "3d7"), lair: side("Nest", "4d7") } } });
  const group = groupOf([stackOf(knot), stackOf(other)]);
  const [first, second] = group.system.stacks;
  await rollRow(group, { roll: dice(9).roll }, first);
  await rollRow(group, { roll: dice(12).roll }, second);
  assert.equal(group.system.noun, "Muster", "the noun stays the roll's that wrote it");
  await rollRow(group, { state: "lair", roll: dice(20).roll }, second);
  assert.equal(group.system.noun, "Muster", "another monster's re-roll does not reach it");
  assert.deepEqual(group.system.stacks[0].size, { current: 9, initial: 9, formula: "2d7*3" });
  assert.equal(group.system.stacks[0].rolled.state, "wandering");
  assert.deepEqual(group.system.stacks[1].size, { current: 20, initial: 20, formula: "4d7" });
  await rollRow(group, { state: "lair", roll: dice(30).roll }, first);
  assert.equal(group.system.noun, "Roost");
  assert.equal(group.system.stacks[1].size.current, 20);
});

await ok("the side named is the side thrown, on both lines", async () => {
  const knot = creature({ encounter: LINES });
  for (const [context, state, formula] of [
    ["dungeon", "wandering", "1d7"],
    ["dungeon", "lair", "2d7"],
    ["wilderness", "lair", "1d7*20"],
  ]) {
    const { roll, thrown } = dice(5);
    await rollRow(groupOf([stackOf(knot)]), { context, state, roll });
    assert.deepEqual(thrown, [formula]);
  }
});

await ok("the Roll's defaults are core's own dice", async () => {
  const knot = creature({ encounter: LINES });
  const group = groupOf([stackOf(knot)]);
  await rollRow(group);
  assert.equal(group.system.stacks[0].size.current, 4);
  assert.equal(group.system.stacks[0].size.formula, "2d7*3");
});

await ok("the lair throw comes first and decides the side, its edge in the lair", async () => {
  const knot = creature({ encounter: LINES });
  for (const [die, found, formula] of [
    [30, "lair", "1d7*20"],
    [31, "wandering", "2d7*3"],
    [1, "lair", "1d7*20"],
  ]) {
    const group = groupOf([stackOf(knot)]);
    const { roll, thrown } = dice(die, 6);
    const result = await rollRow(group, { context: "wilderness", state: BY_LAIR_CHANCE, roll });
    assert.deepEqual(thrown, ["1d100", formula]);
    assert.equal(result.found, found);
    assert.equal(group.system.stacks[0].rolled.state, found);
  }
});

await ok("a lair chance of zero throws and never finds the lair", async () => {
  const never = creature({ encounter: { ...LINES, lairChance: 0 } });
  const group = groupOf([stackOf(never)]);
  const { roll } = dice(1, 6);
  const result = await rollRow(group, { state: BY_LAIR_CHANCE, roll });
  assert.equal(result.found, "wandering");
});

await ok("a creature with no lair chance refuses the choice and throws nothing", async () => {
  const none = creature({ encounter: { wilderness: LINES.wilderness } });
  const group = groupOf([stackOf(none)]);
  const { roll, thrown } = dice(1);
  assert.deepEqual(await rollRow(group, { state: BY_LAIR_CHANCE, roll }), { ok: false, reason: "noChance" });
  assert.deepEqual(thrown, []);
  assert.equal(group.updates.length, 0);
});

await ok("the lair chance is the pressed monster's own", async () => {
  const never = creature({ encounter: { ...LINES, lairChance: 0 } });
  const always = creature({ encounter: { ...LINES, lairChance: 100 } });
  const group = groupOf([stackOf(never), stackOf(always)]);
  const [first, second] = group.system.stacks;
  assert.equal((await rollRow(group, { state: BY_LAIR_CHANCE, roll: dice(99, 6).roll }, second)).found, "lair");
  assert.equal((await rollRow(group, { state: BY_LAIR_CHANCE, roll: dice(1, 6).roll }, first)).found, "wandering");
});

await ok("a side in units writes nothing, throws nothing and says why", async () => {
  const units = creature({ name: "Muster", encounter: { wilderness: { wandering: side("Muster", "2d7", "knots"), lair: side("Roost", "4") } } });
  const group = groupOf([stackOf(units)]);
  const posted = chat.length;
  const { roll, thrown } = dice(8);
  const result = await rollRow(group, { context: "wilderness", state: "wandering", roll });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "side");
  assert.equal(result.name, "Muster");
  assert.match(result.why, /2d7/);
  assert.match(result.why, /units/);
  assert.deepEqual(thrown, []);
  assert.equal(group.updates.length, 0);
  assert.equal(chat.length, posted);
});

await ok("a side that states no count says so", async () => {
  const group = groupOf([stackOf(creature({ name: "Mute" }))]);
  const result = await rollRow(group, { roll: dice().roll });
  assert.equal(result.reason, "side");
  assert.equal(result.name, "Mute");
  assert.equal(result.why, words("ACKS-LIB.group.roll.kind.none"));
});

await ok("a lair throw is posted even where the side it finds cannot be rolled", async () => {
  const units = creature({ encounter: { lairChance: 50, wilderness: { wandering: side("Muster", "2d7", "knots"), lair: side("Roost", "1d7", "knots") } } });
  const group = groupOf([stackOf(units)]);
  const posted = chat.length;
  const { roll, thrown } = dice(10);
  rendered.length = 0;
  const result = await rollRow(group, { state: BY_LAIR_CHANCE, roll });
  assert.deepEqual(thrown, ["1d100"]);
  assert.equal(result.total, null);
  assert.equal(chat.length, posted + 1);
  const { stack } = rendered[0].view;
  assert.equal(stack.kind, ROLL_KIND.units);
  assert.match(stack.note, /1d7/);
  assert.equal(stack.formula, undefined);
  assert.equal(chat.at(-1).flags[MODULE_ID].groupRoll.formula, "", "the card's record holds what was thrown");
  assert.equal(group.system.stacks[0].rolled.total, null);
});

await ok("a count a hand set is refused, and stands", async () => {
  const knot = creature({ encounter: LINES });
  const group = groupOf([stackOf(knot, { current: 3 })]);
  const { roll, thrown } = dice(9);
  const result = await rollRow(group, { roll });
  assert.equal(result.reason, "side");
  assert.equal(result.why, words("ACKS-LIB.group.roll.kind.hand"));
  assert.deepEqual(thrown, []);
  assert.deepEqual(group.system.stacks[0].size, { current: 3, initial: 3, formula: "" });

  await rollRow(group, { state: BY_LAIR_CHANCE, roll: dice(10).roll });
  assert.equal(group.system.stacks[0].size.current, 3, "a lair throw over a hand's count sizes nothing");
  assert.equal(chat.at(-1).flags[MODULE_ID].groupRoll.formula, "", "the card's record holds what was thrown");
});

await ok("a line whose formula the dice refuse is reported and written nowhere", async () => {
  const bad = creature({ name: "Bad", encounter: { wilderness: { wandering: side("Bad", "2d7") } } });
  const group = groupOf([stackOf(bad)]);
  const result = await rollRow(group, { roll: dice(new Error("no such formula")).roll });
  assert.equal(result.reason, "side");
  assert.match(result.why, /2d7/);
  assert.equal(group.system.stacks[0].size.current, 0);
  assert.equal(group.updates.length, 0);
});

await ok("a total below zero or with a fraction lands on a whole headcount", async () => {
  const knot = creature({ encounter: LINES });
  for (const [total, count] of [[-2, 0], [7.5, 7]]) {
    const group = groupOf([stackOf(knot)]);
    await rollRow(group, { roll: dice(total).roll });
    assert.equal(group.system.stacks[0].size.current, count);
    assert.equal(group.system.stacks[0].size.initial, count);
  }
});

await ok("a body out or fallen stops that monster's press before any die, and not its neighbour's", async () => {
  const knot = creature({ encounter: LINES });
  const rolled = { total: 5, state: "wandering", context: "wilderness", noun: "Muster" };
  for (const held of [stackOf(knot, { current: 5, roster: [{ key: "m" }], rolled }), stackOf(knot, { current: 3, initial: 5, rolled })]) {
    const group = groupOf([stackOf(knot), held]);
    const [free] = group.system.stacks;
    const { roll, thrown } = dice(7);
    assert.deepEqual(await rollRow(group, { roll }, held), { ok: false, reason: "held", name: "Knot" });
    assert.deepEqual(thrown, []);
    assert.equal(group.updates.length, 0);
    assert.equal((await rollRow(group, { roll }, free)).ok, true);
    assert.equal(group.system.stacks[1].size.current, held.size.current, "the stack holding bodies is not touched");
  }
});

await ok("a body out of a hand-set stack refuses as a hand's count, since no Roll would write it", () => {
  const knot = creature();
  const stack = stackOf(knot, { current: 3, initial: 5 });
  assert.equal(rollRefusal(groupOf([stack]), stack), null);
});

await ok("a rolled stack with no bodies out rolls again, a hand's change included", async () => {
  const knot = creature({ encounter: LINES });
  const group = groupOf([stackOf(knot, { current: 8, rolled: { total: 5, state: "wandering", context: "wilderness", noun: "Muster" } })]);
  await rollRow(group, { roll: dice(11).roll });
  assert.equal(group.system.stacks[0].size.current, 11);
});

await ok("a synthetic actor's Roll is refused, since it would reach one token", async () => {
  const group = groupOf([stackOf(creature({ encounter: LINES }))], { isToken: true });
  assert.deepEqual(rollRefusal(group, group.system.stacks[0]), { reason: "unlinked" });
  const { roll, thrown } = dice(1);
  assert.deepEqual(await rollRow(group, { roll }), { ok: false, reason: "unlinked" });
  assert.deepEqual(thrown, []);
});

await ok("only a group's creature can be rolled", async () => {
  assert.deepEqual(await rollEncounter(creature(), "any", {}), { ok: false, reason: "notGroup" });
  const person = groupOf([stackOf(creature({ type: "character", encounter: LINES }))]);
  assert.deepEqual(await rollRow(person, { roll: dice(1).roll }), { ok: false, reason: "notStack" });
  assert.deepEqual(await rollEncounter(person, "no-such-key", {}), { ok: false, reason: "notStack" });
});

await ok("the first Roll makes it an encounter from that monster, and a later one changes none of that", async () => {
  const person = creature({ type: "character", img: "art/person.webp" });
  const knot = creature({ encounter: LINES, img: "art/knot.webp" });
  const group = groupOf([stackOf(person), stackOf(knot)]);
  const [, pressed] = group.system.stacks;
  await rollRow(group, { roll: dice(5).roll }, pressed);
  assert.equal(group.system.reveal, REVEAL.noun);
  assert.equal(group.img, "art/knot.webp");
  assert.equal(group.prototypeToken.actorLink, true);
  assert.equal(group.prototypeToken.disposition, CONST.TOKEN_DISPOSITIONS.HOSTILE);
  assert.equal(group.prototypeToken.displayName, CONST.TOKEN_DISPLAY_MODES.HOVER);

  group.system.reveal = REVEAL.full;
  group.prototypeToken.disposition = 0;
  await rollRow(group, { roll: dice(6).roll }, pressed);
  assert.equal(group.system.reveal, REVEAL.full);
  assert.equal(group.prototypeToken.disposition, 0);
});

await ok("a group with art of its own keeps it", async () => {
  const group = groupOf([stackOf(creature({ encounter: LINES }))], { img: "art/banner.webp" });
  await rollRow(group, { roll: dice(5).roll });
  assert.equal(group.img, "art/banner.webp");
});

await ok("the noun follows the roll, and a noun a hand typed stands through it", async () => {
  const knot = creature({ encounter: LINES });
  const group = groupOf([stackOf(knot)]);
  await rollRow(group, { context: "wilderness", state: "wandering", roll: dice(5).roll });
  assert.equal(group.system.noun, "Muster");
  await rollRow(group, { context: "wilderness", state: "lair", roll: dice(5).roll });
  assert.equal(group.system.noun, "Roost");

  const typed = groupOf([stackOf(knot)], { noun: "rabble" });
  await rollRow(typed, { roll: dice(5).roll });
  assert.equal(typed.system.noun, "rabble");
  await rollRow(typed, { state: "lair", roll: dice(5).roll });
  assert.equal(typed.system.noun, "rabble");
});

await ok("the card goes to the Judges alone with every step on it", async () => {
  const knot = creature({ encounter: LINES, cite: "invented page" });
  const group = groupOf([stackOf(knot)]);
  rendered.length = 0;
  chat.length = 0;
  game.dice3d.shown.length = 0;
  await rollRow(group, { context: "dungeon", state: BY_LAIR_CHANCE, roll: dice(10, 6).roll });
  assert.deepEqual(game.dice3d.shown, [{ total: 10, viewers: ["judge"] }, { total: 6, viewers: ["judge"] }], "both dice show, to the Judges alone");
  const { path, view } = rendered[0];
  assert.equal(path, `modules/${MODULE_ID}/templates/lib/group-roll-card.hbs`);
  assert.deepEqual(view.lair, { chance: 30, total: 10, inLair: true, name: "Knot" });
  assert.equal(view.where, "Dungeon");
  assert.equal(view.found, "In lair");
  assert.deepEqual(view.stack, { label: "Knot", kind: "roll", cite: "invented page", formula: "2d7", dice: "6", total: 6 });
  const [card] = chat;
  assert.deepEqual(card.whisper, ["judge"]);
  assert.deepEqual(card.rolls, [], "a card for the Judges attaches no rolls, which a seat would see as a placeholder");
  assert.deepEqual(card.flags[MODULE_ID].groupRoll, {
    group: group.uuid,
    stack: group.system.stacks[0].key,
    context: "dungeon",
    state: "lair",
    inLair: true,
    formula: "2d7",
    total: 6,
  });
});

await ok("a deleted creature rolls from the stack's own snapshot", async () => {
  const gone = stackOf(null);
  gone.template.type = "monster";
  gone.template.label = "Gone";
  gone.template.uuid = "Actor.deleted";
  gone.template.snapshot = { type: "monster", flags: { [MODULE_ID]: { extras: { encounter: LINES } } } };
  const group = groupOf([gone]);
  const { roll, thrown } = dice(5);
  await rollRow(group, { roll });
  assert.deepEqual(thrown, ["2d7*3"]);
});

/* -------------------------------------------- */
/*  The opening line                            */
/* -------------------------------------------- */

await ok("the dialog opens on wilderness until a feature answers for the scene", () => {
  assert.equal(defaultRollContext(), "wilderness");
  const answer = (slot) => {
    assert.equal(slot.scene, game.scenes.viewed);
    slot.context = "dungeon";
  };
  Hooks.on(ROLL_CONTEXT_HOOK, answer);
  assert.equal(defaultRollContext(), "dungeon");
  hooks.get(ROLL_CONTEXT_HOOK).pop();
});

/* -------------------------------------------- */
/*  The token                                   */
/* -------------------------------------------- */

await ok("the noun alone below a full reveal, with the art masked too", () => {
  const stacks = [stackOf(creature(), { current: 9 })];
  const face = encounterFace({ reveal: REVEAL.noun, noun: "muster", stacks, img: "art/knot.webp", mask: "mask.svg" }, format);
  assert.deepEqual(face, { name: "Muster", src: "mask.svg" });
});

await ok("a full reveal gives the name, the count and the art", () => {
  const stacks = [stackOf(creature(), { current: 9 })];
  const face = encounterFace({ reveal: REVEAL.full, noun: "muster", stacks, img: "art/knot.webp", mask: "mask.svg" }, format);
  assert.deepEqual(face, { name: "Knot, muster of 9", src: "art/knot.webp" });
});

await ok("a caption reads one stack through its noun and several as a list", () => {
  const knot = stackOf(creature(), { current: 9 });
  const tangle = stackOf(creature({ name: "Tangle" }), { current: 2 });
  const gone = stackOf(creature({ name: "Gone" }));
  assert.equal(fullCaption([knot, tangle], "muster", format), "Knot 9, Tangle 2");
  assert.equal(fullCaption([knot, gone], "muster", format), "Knot, muster of 9");
  assert.equal(fullCaption([gone], "muster", format), "Gone, muster");
  assert.equal(fullCaption([], "muster", format), "Muster");
});

await ok("the Judge's caption reads the same whatever the reveal", () => {
  const group = groupOf([stackOf(creature(), { current: 9 })], { noun: "muster", reveal: REVEAL.noun });
  assert.equal(judgeCaption(group), "Knot, muster of 9");
});

await ok("Make Encounter files a masked, linked, hostile group with the creature in it", async () => {
  const knot = creature({ encounter: LINES, img: "art/knot.webp" });
  const group = await makeEncounter(knot);
  const [data] = created;
  assert.deepEqual(data.items, [], "the system replaces `system` on a create with no items");
  assert.equal(data.system.reveal, REVEAL.noun);
  assert.equal(data.name, "Knot encounter");
  assert.equal(data.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
  assert.equal(data.prototypeToken.actorLink, true);
  assert.equal(data.prototypeToken.disposition, CONST.TOKEN_DISPOSITIONS.HOSTILE);
  assert.equal(data.prototypeToken.name, "Pack");
  assert.equal(data.prototypeToken.texture.src, CONST.DEFAULT_TOKEN);
  assert.equal(data.img, "art/knot.webp");
  assert.equal(game.folders.find((f) => f.id === data.folder)?.name, "Encounters");
  assert.equal(group.system.stacks.length, 1);
  assert.equal(group.system.stacks[0].template.uuid, knot.uuid);

  await makeEncounter(knot);
  assert.equal(game.folders.filter((f) => f.name === "Encounters").length, 1, "a second encounter adopts the folder");
});

await ok("an unlinked token's creature makes the encounter from its world actor", async () => {
  const world = creature({ name: "World" });
  const synthetic = { ...creature({ name: "Delta" }), isToken: true, token: { baseActor: world } };
  const group = await makeEncounter(synthetic);
  assert.equal(group.system.stacks[0].template.uuid, world.uuid);
});

/** The token hooks, as the primary GM runs them. */
registerEncounterTokens();
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const placed = (actorId, name, src) => ({ id: uid("tok"), actorId, name, texture: { src } });

/** A scene whose embedded write lands on its tokens. */
function sceneWith(tokens) {
  return {
    tokens,
    writes: [],
    async updateEmbeddedDocuments(_kind, changes) {
      this.writes.push(changes);
      for (const change of changes) {
        const token = tokens.find((t) => t.id === change._id);
        token.name = change.name;
        token.texture.src = change["texture.src"];
      }
    },
  };
}

await ok("the primary GM keeps the prototype and every stale token on the face", async () => {
  const group = groupOf([stackOf(creature(), { current: 9 })], { noun: "muster", reveal: REVEAL.noun, img: "art/knot.webp" });
  const stale = placed(group.id, "Knot, muster of 9", "art/knot.webp");
  const current = placed(group.id, "Muster", CONST.DEFAULT_TOKEN);
  const foreign = placed("someone-else", "Knot", "art/knot.webp");
  const scene = sceneWith([stale, current, foreign]);
  game.scenes.push(scene);

  await group.update({ "system.noun": "muster" });
  await settle();
  assert.equal(group.prototypeToken.name, "Muster");
  assert.equal(group.prototypeToken.texture.src, CONST.DEFAULT_TOKEN);
  assert.equal(stale.name, "Muster");
  assert.equal(stale.texture.src, CONST.DEFAULT_TOKEN);
  assert.equal(foreign.name, "Knot", "another actor's token is not this group's");
  assert.deepEqual(scene.writes.flat().map((w) => w._id), [stale.id], "only the stale token is written");

  await group.update({ "system.reveal": REVEAL.full });
  await settle();
  assert.equal(group.prototypeToken.name, "Knot, muster of 9");
  assert.equal(stale.texture.src, "art/knot.webp");

  // A full reveal carries the count: a stack's change reaches the token.
  group.system.stacks[0].size.current = 4;
  await group.update({ "system.noun": "muster" });
  await settle();
  assert.equal(stale.name, "Knot, muster of 4");
  game.scenes.pop();
});

await ok("a group with no reveal, and a token's own copy, are left alone", async () => {
  const plain = groupOf([stackOf(creature(), { current: 9 })]);
  plain.prototypeToken.name = "Mine";
  const token = placed(plain.id, "Mine", "mine.webp");
  const scene = sceneWith([token]);
  game.scenes.push(scene);
  await plain.update({ "system.noun": "muster" });
  await settle();
  assert.equal(plain.prototypeToken.name, "Mine");
  assert.equal(scene.writes.length, 0);

  const synthetic = groupOf([stackOf(creature(), { current: 9 })], { reveal: REVEAL.noun, isToken: true });
  synthetic.prototypeToken.name = "Mine";
  await synthetic.update({ "system.noun": "muster" });
  await settle();
  assert.equal(synthetic.prototypeToken.name, "Mine");
  game.scenes.pop();
});

await ok("a seat that is not the primary GM writes nothing", async () => {
  const group = groupOf([stackOf(creature(), { current: 9 })], { reveal: REVEAL.noun });
  group.prototypeToken.name = "Mine";
  users.activeGM.isSelf = false;
  await group.update({ "system.noun": "muster" });
  await settle();
  users.activeGM.isSelf = true;
  assert.equal(group.prototypeToken.name, "Mine");
});

await ok("a Judge's nameplate reads the count, and a player's reads the document", () => {
  const group = groupOf([stackOf(creature(), { current: 9 })], { noun: "muster", reveal: REVEAL.noun });
  const refresh = () => {
    const token = { actor: group, nameplate: { text: "Muster" } };
    Hooks.call("refreshToken", token);
    return token.nameplate.text;
  };
  assert.equal(refresh(), "Knot, muster of 9");
  game.user = users[1];
  assert.equal(refresh(), "Muster");
  game.user = users[0];
  group.system.reveal = REVEAL.full;
  assert.equal(refresh(), "Muster", "a full reveal needs no help: the document holds the count");
  group.system.reveal = "";
  assert.equal(refresh(), "Muster");
  group.system.reveal = REVEAL.noun;
  Hooks.call("refreshToken", { actor: group });
});

console.log(`\n${passed} encounter group checks passed`);
