/**
 * The body's day and night against mocked Foundry globals: the weather's toll
 * on a provisioned day (sunburn, the heat's armour save, the cold's mark, the
 * week's disease) and the night's rest (a restful night, an armoured sleeper's
 * throw, the fatigue ladder written to the body and the Fatigued condition).
 *
 * Every figure below is INVENTED, and the dice are rigged: an unrigged roll
 * throws, so a branch that rolls when it should not fails loudly and a rigged
 * queue left over means a branch that should have rolled did not. What this
 * pins is the machinery, never the book.
 *
 * Run: node tools/test-rest.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

class FieldStub {}
globalThis.Hooks = { callAll() {}, on() {}, once() {} };
globalThis.foundry = {
  utils: {
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    randomID: () => "rnd",
    escapeHTML: (s) => String(s),
    hasProperty: () => false,
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    isEmpty: (v) => v == null || (typeof v === "object" && !Object.keys(v).length),
    mergeObject: (a, b) => Object.assign(a, b),
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: { fields: new Proxy({}, { get: () => FieldStub }), regionBehaviors: { RegionBehaviorType: class {} } },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { wait: async () => "later" },
    },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    apps: { DocumentSheetConfig: { registerSheet() {} }, FilePicker: { implementation: class {} } },
    handlebars: { loadTemplates: () => [], renderTemplate: async () => "<card/>" },
    ux: { DragDrop: { implementation: class {} }, TextEditor: { implementation: {} } },
    instances: new Map(),
  },
  documents: { collections: { Items: { registerSheet() {} } } },
};
globalThis.CONFIG = { Actor: { dataModels: {} }, Item: { dataModels: {} }, RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.CONST = {
  GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
  DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

const chat = [];
globalThis.ChatMessage = {
  async create(data) {
    chat.push(data);
    return data;
  },
};

/** Rigged dice: a queue of totals per formula; an unrigged roll is a test failure. */
const rigs = new Map();
const rollLog = [];
const rig = (formula, ...totals) => rigs.set(formula, [...(rigs.get(formula) ?? []), ...totals]);
const rigSpent = () => [...rigs].filter(([, q]) => q.length).map(([f, q]) => `${f}: ${q.join(",")}`);
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    rollLog.push(this.formula);
    const queue = rigs.get(this.formula);
    if (!queue?.length) throw new Error(`unrigged roll ${this.formula}`);
    this.total = queue.shift();
    return this;
  }
};

const settings = { formations: {} };
const actors = new Map();
globalThis.game = {
  settings: {
    get: (_module, key) => settings[key],
    set: (_module, key, value) => {
      settings[key] = value;
      return value;
    },
  },
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => `${key} ${JSON.stringify(data)}`,
    has: () => false,
  },
  user: { isGM: true },
  users: { filter: (fn) => [{ id: "gm1", isGM: true }].filter(fn), activeGM: null },
  actors: { get: (id) => actors.get(id) ?? null, contents: [] },
  scenes: { get: () => null },
  tables: { get: () => null },
  time: { worldTime: 0 },
};

const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { getFormation } = await import("../scripts/formation/formation-model.mjs");
const { runProvisionDay, wornArmourStone, sheltered } = await import("../scripts/formation/provision-day.mjs");
const { runRestNight, FATIGUE_FLAG } = await import("../scripts/formation/rest.mjs");
const { conditionStacksOf } = await import("../scripts/lib/status-effects.mjs");
const { SURVIVAL_DOC } = await import("../scripts/lib/survival.mjs");

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  const left = rigSpent();
  assert.deepEqual(left, [], `${name}: rigged rolls left unthrown`);
  passed++;
  console.log("ok   " + name);
};

/* -------------------------------------------- */
/*  Invented tables                             */
/* -------------------------------------------- */

const SURVIVAL = {
  id: SURVIVAL_DOC,
  source: "invented",
  tables: {
    exposure: { hoursUnprotected: { cold: 3 }, conPerHour: 1 },
    heat: { sweltering: { waterNeed: 1.5, dehydrationDrain: 3, armourStone: 5 } },
    fatigue: {
      sleeplessDays: 2, activityDays: 4, forcedMarchDays: 1,
      enduranceDays: 1, endurancePerConPoint: 1, enduranceLaborExtra: 1,
    },
    sleep: { donRoundsPerStone: 3 },
  },
};
const WEATHER = {
  id: "weather",
  source: "invented",
  tables: {
    conditionEffects: {
      sunbaked: { sunburn: { damage: "1d3", hours: 3, type: "test" } },
      cold: {
        rest: { fire: true, clothing: true, both: false },
        disease: { days: 3, pct: 17 },
        frostbite: { die: "1d5", row: "7-9" },
      },
      rainy: { disease: { days: 2, pct: 11 } },
    },
  },
};
const load = () => {
  registerTable(SURVIVAL, { priority: PRIORITY.WORLD, source: "test" });
  registerTable(WEATHER, { priority: PRIORITY.WORLD, source: "test" });
};
load();

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const damageLog = [];
let serial = 0;

const item = (name, { type = "item", weight6 = 0, equipped } = {}) => ({
  name,
  type,
  system: { cost: 0, weight6, quantity: { value: 1 }, ...(equipped === undefined ? {} : { equipped }) },
});
const PLATE = () => item("Plate", { type: "armor", weight6: 42, equipped: true }); // 7 stone, worn
const PACK = (stone) => item("Pack", { weight6: stone * 6 });
const CLOAK = () => item("Warm Cloak");
const ability = (name) => ({ name, type: "ability", system: {} });

/** An actor stub: flags, a death save, hit points, and a palette that makes and lifts effects. */
function makeActor(name, { items = [], death = 12, con = 0 } = {}) {
  const id = `a${++serial}`;
  const flags = {};
  const effects = [];
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type: "character",
    img: "",
    items,
    effects,
    system: { hp: { value: 30, max: 30 }, saves: { death: { value: death } }, scores: { con: { mod: con } } },
    getFlag: (scope, key) => flags[`${scope}.${key}`],
    async setFlag(scope, key, value) {
      flags[`${scope}.${key}`] = value;
    },
    async update() {},
    async applyDamage(amount, multiplier = 1) {
      const dealt = Math.ceil(amount * multiplier);
      this.system.hp.value -= dealt;
      damageLog.push([name, dealt]);
    },
    async toggleStatusEffect(status, { active }) {
      const at = effects.findIndex((e) => e.statuses.has(status));
      if (active && at < 0) {
        const effect = {
          statuses: new Set([status]),
          flags: {},
          async setFlag(scope, key, value) {
            (effect.flags[scope] ??= {})[key] = value;
          },
        };
        effects.push(effect);
      } else if (!active && at >= 0) effects.splice(at, 1);
    },
    has: (status) => effects.some((e) => e.statuses.has(status)),
  };
  actors.set(id, actor);
  return actor;
}

function makeFormation(members, travel = {}) {
  const id = `f${++serial}`;
  settings.formations[id] = {
    id,
    name: "The Company",
    members: members.map((a) => ({ actorId: a.id, roles: [] })),
    travel: {
      mode: "journey", ground: "grassland", exposure: { hours: 0, atHeatSource: false, wet: false }, ...travel,
    },
  };
  return id;
}

const setSky = (id, weather, exposure = {}) => {
  const t = settings.formations[id].travel;
  t.weather = weather;
  t.exposure = { hours: 0, atHeatSource: false, wet: false, ...exposure };
};
const tollCards = () => chat.filter((m) => m.content?.includes("ACKS-FORMATION.toll.title"));
const restCards = () => chat.filter((m) => m.content?.includes("ACKS-FORMATION.rest.title"));
const memberOf = (day, actor) => day.report.find((r) => r.actorId === actor.id);

/* -------------------------------------------- */
/*  Helpers under test                          */
/* -------------------------------------------- */

await ok("worn armour is weighed in stone, and only what is worn", async () => {
  const worn = makeActor("Worn", { items: [PLATE(), item("Spare", { type: "armor", weight6: 30, equipped: false }), PACK(4)] });
  assert.equal(wornArmourStone(worn), 7, "the spare and the pack are not worn armour");
  assert.equal(wornArmourStone(makeActor("Bare")), 0);
  assert.equal(wornArmourStone(null), 0);
  assert.equal(sheltered(makeActor("Cloaked", { items: [CLOAK()] })), true);
  assert.equal(sheltered(worn), false);
});

/* -------------------------------------------- */
/*  The sun and the heat                        */
/* -------------------------------------------- */

await ok("the sun burns an unsheltered body past the imported hours, and a resilient one is spared", async () => {
  const burned = makeActor("Burned");
  const cloaked = makeActor("Cloaked", { items: [CLOAK()] });
  const resilient = makeActor("Resilient", { items: [ability("Savage Resilience")] });
  const id = makeFormation([burned, cloaked, resilient]);
  setSky(id, { temperature: "warm", precipitation: "sunbaked" }, { hours: 3 });
  rig("1d3", 2);
  const day = await runProvisionDay(getFormation(id));
  assert.deepEqual(memberOf(day, burned).sunburn, { damage: 2, type: "test" });
  assert.equal(memberOf(day, cloaked).sunburn, undefined, "a cloak keeps the sun off");
  assert.equal(memberOf(day, resilient).sunburn, undefined, "the power keeps it off too");
  assert.deepEqual(damageLog.slice(-1), [["Burned", 2]], "the damage went through the hit-point tool");
  assert.equal(burned.system.hp.value, 28);
  assert.equal(tollCards().length, 1, "and the toll was told once");
  const card = tollCards().at(-1);
  assert.deepEqual(card.whisper, ["gm1"], "to the Judge alone");
  assert.match(card.content, /toll\.sunburn\.title/);
});

await ok("a day short of the imported hours burns nobody and posts nothing", async () => {
  const a = makeActor("Short");
  const id = makeFormation([a]);
  setSky(id, { temperature: "warm", precipitation: "sunbaked" }, { hours: 2 });
  const cards = chat.length;
  const day = await runProvisionDay(getFormation(id));
  assert.equal(memberOf(day, a).sunburn, undefined);
  assert.equal(chat.length, cards, "no toll, no card");
});

await ok("armour at the imported stone is a death save an hour; the first failure stops and adds a fatigue stack", async () => {
  const heavy = makeActor("Heavy", { items: [PLATE(), CLOAK()] });
  const light = makeActor("Light", { items: [item("Mail", { type: "armor", weight6: 12, equipped: true }), CLOAK()] });
  const sturdy = makeActor("Sturdy", { items: [PLATE(), CLOAK()] });
  const id = makeFormation([heavy, light, sturdy]);
  setSky(id, { temperature: "sweltering", precipitation: "clear" }, { hours: 5 });
  rig("1d20", 15, 13, 4, /* sturdy: */ 12, 14, 18, 12, 13);
  const day = await runProvisionDay(getFormation(id));
  const h = memberOf(day, heavy).heatSaves;
  assert.deepEqual([h.hours, h.failedAt, h.total, h.target], [3, 3, 4, 12], "stopped at the third hour");
  assert.equal(conditionStacksOf(heavy, "fatigued"), 1);
  assert.equal(memberOf(day, light).heatSaves, undefined, "two stone is under the count");
  const s = memberOf(day, sturdy).heatSaves;
  assert.deepEqual([s.hours, s.failedAt], [5, null], "a body that passes every hour is thrown for each of them");
  assert.equal(conditionStacksOf(sturdy, "fatigued"), 0);
  assert.equal(tollCards().length, 2, "the throws are told");
});

await ok("a failure on a body already fatigued adds to its stacks", async () => {
  const a = makeActor("Tired", { items: [PLATE(), CLOAK()] });
  await a.toggleStatusEffect("fatigued", { active: true });
  await a.effects[0].setFlag("acks-extras", "conditionStacks", 2);
  const id = makeFormation([a]);
  setSky(id, { temperature: "sweltering", precipitation: "clear" }, { hours: 1 });
  rig("1d20", 3);
  await runProvisionDay(getFormation(id));
  assert.equal(conditionStacksOf(a, "fatigued"), 3);
});

/* -------------------------------------------- */
/*  The cold and the week's disease             */
/* -------------------------------------------- */

await ok("the cold marks a hypothermic body that fails its save, and a run of days throws for disease", async () => {
  const bare = makeActor("Bare");
  const cloaked = makeActor("Cloaked", { items: [CLOAK()] });
  const id = makeFormation([bare, cloaked]);
  const cold = { temperature: "cold", precipitation: "overcast" };

  // Day 1: the bare body is hypothermic by the fourth hour and fails.
  setSky(id, cold, { hours: 4 });
  rig("1d20", 5);
  const d1 = await runProvisionDay(getFormation(id));
  assert.deepEqual(memberOf(d1, bare).frostbite, { total: 5, target: 12, failed: true, die: "1d5", row: "7-9" });
  assert.equal(bare.has("frostbitten"), true);
  assert.equal(memberOf(d1, cloaked).frostbite, undefined, "a cloak held the cold off");
  assert.deepEqual(settings.formations[id].travel.weatherRuns, { cold: 1 }, "the run began");
  assert.equal(memberOf(d1, bare).disease, undefined);

  // Day 2: it passes this time; the run climbs.
  rig("1d20", 17);
  const d2 = await runProvisionDay(getFormation(id));
  assert.equal(memberOf(d2, bare).frostbite.failed, false);
  assert.deepEqual(settings.formations[id].travel.weatherRuns, { cold: 2 });

  // Day 3: the run reaches its count; everyone throws, once, and it resets.
  rig("1d20", 14);
  rig("1d100", 9, 88);
  const d3 = await runProvisionDay(getFormation(id));
  assert.deepEqual(memberOf(d3, bare).disease, { key: "cold", total: 9, pct: 17, caught: true });
  assert.deepEqual(memberOf(d3, cloaked).disease, { key: "cold", total: 88, pct: 17, caught: false });
  assert.equal(bare.has("diseased"), true);
  assert.equal(cloaked.has("diseased"), false);
  assert.deepEqual(settings.formations[id].travel.weatherRuns, { cold: 0 }, "the run resets after its throw");
  assert.deepEqual(d3.weatherRuns, { cold: 0 });

  // Day 4: a different sky; the cold run is dropped, the new one begins, nothing is thrown.
  setSky(id, { temperature: "brisk", precipitation: "rainy" }, { hours: 0 });
  const cards = chat.length;
  const d4 = await runProvisionDay(getFormation(id));
  assert.deepEqual(settings.formations[id].travel.weatherRuns, { rainy: 1 }, "an unbroken run is only of the same weather");
  assert.equal(memberOf(d4, bare).disease, undefined);
  assert.equal(chat.length, cards, "a quiet day posts no card");

  // Day 5: a clear day breaks every run.
  setSky(id, { temperature: "brisk", precipitation: "clear" });
  await runProvisionDay(getFormation(id));
  assert.deepEqual(settings.formations[id].travel.weatherRuns, {}, "no disease weather, no runs");
  assert.ok(tollCards().length >= 3, "and the toll cards were posted on the days that had one");
});

await ok("a body that is not hypothermic does not roll for frostbite", async () => {
  const a = makeActor("Warm", { items: [CLOAK()] });
  const id = makeFormation([a]);
  setSky(id, { temperature: "cold", precipitation: "overcast" }, { hours: 4, atHeatSource: true });
  const day = await runProvisionDay(getFormation(id));
  assert.equal(memberOf(day, a).frostbite, undefined);
  assert.equal(a.has("frostbitten"), false);
});

await ok("an unimported weather table does nothing, and does not break the day", async () => {
  unregisterTable("weather");
  const a = makeActor("Plain", { items: [PLATE()] });
  const id = makeFormation([a]);
  setSky(id, { temperature: "warm", precipitation: "sunbaked" }, { hours: 9 });
  const cards = chat.length;
  const day = await runProvisionDay(getFormation(id));
  assert.equal(memberOf(day, a).sunburn, undefined);
  assert.equal(memberOf(day, a).frostbite, undefined);
  assert.equal(chat.length, cards);
  registerTable(WEATHER, { priority: PRIORITY.WORLD, source: "test" });
});

/* -------------------------------------------- */
/*  The night                                   */
/* -------------------------------------------- */

const COLD = { temperature: "cold", precipitation: "overcast" };
const CLEAR = { temperature: "brisk", precipitation: "clear" };
const fatigueOfActor = (a) => a.getFlag("acks-extras", FATIGUE_FLAG);

await ok("a restful night under a quiet sky writes the ladder and posts one card", async () => {
  const a = makeActor("Sleeper");
  const id = makeFormation([a]);
  const cards = chat.length;
  const rows = await runRestNight(getFormation(id), { weather: CLEAR, ground: "grassland", day: { kind: "march" }, camp: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].restful, true);
  assert.deepEqual(fatigueOfActor(a), { activityDays: 1, sleeplessDays: 0, forcedDays: 0 });
  assert.equal(chat.length, cards + 1);
  assert.equal(restCards().length, 1);
  assert.deepEqual(chat.at(-1).whisper, ["gm1"]);
});

await ok("a cold sky is answered by a fire or by clothing, and a night unanswered is not restful", async () => {
  const bare = makeActor("Bare");
  const cloaked = makeActor("Cloaked", { items: [CLOAK()] });
  const id = makeFormation([bare, cloaked]);
  const night = await runRestNight(getFormation(id), {
    weather: COLD, ground: "grassland", exposure: { atHeatSource: false }, day: { kind: "march" }, camp: {},
  });
  const byName = Object.fromEntries(night.map((r) => [r.name, r]));
  assert.deepEqual([byName.Bare.restful, byName.Bare.nightReasons], [false, ["cold"]]);
  assert.equal(byName.Cloaked.restful, true);
  assert.equal(fatigueOfActor(bare).sleeplessDays, 1);
  assert.equal(fatigueOfActor(cloaked).sleeplessDays, 0);

  const fire = await runRestNight(getFormation(id), {
    weather: COLD, ground: "grassland", exposure: { atHeatSource: true }, day: { kind: "march" }, camp: {},
  });
  assert.equal(fire.every((r) => r.restful), true, "a fire answers it for the bare body too");
});

await ok("a Judge's unslept night is not restful for anyone", async () => {
  const a = makeActor("Awake", { items: [CLOAK()] });
  const id = makeFormation([a]);
  const [row] = await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "march", noSleep: true }, camp: {} });
  assert.deepEqual([row.restful, row.nightReasons], [false, ["noSleep"]]);
});

await ok("sleeping in armour throws a d20 against the kit's weight, and the card tells the rounds to don it", async () => {
  const heavy = makeActor("Heavy", { items: [PACK(10)] });
  const light = makeActor("Light", { items: [PACK(2)] });
  const id = makeFormation([heavy, light]);
  rig("1d20", 4, 18);
  const rows = await runRestNight(getFormation(id), {
    weather: CLEAR, ground: "grassland", day: { kind: "march" }, camp: { sleepInArmour: true },
  });
  const [h, l] = rows;
  assert.deepEqual([h.restful, h.nightReasons, h.armour.stone, h.armour.roll, h.armour.donRounds], [false, ["armour"], 10, 4, 30]);
  assert.deepEqual([l.restful, l.armour.donRounds], [true, 6]);
  const card = restCards().at(-1).content;
  assert.match(card, /rest\.donRounds/);
  assert.match(card, /rest\.armourThrow/);
});

await ok("without sleeping in armour no die is thrown", async () => {
  const a = makeActor("Unarmoured", { items: [PACK(10)] });
  const id = makeFormation([a]);
  const before = rollLog.length;
  const [row] = await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "march" }, camp: { sleepInArmour: false } });
  assert.equal(rollLog.length, before);
  assert.equal(row.armour, null);
});

await ok("sleepless nights tire a body on the imported count and Endurance buys more nights", async () => {
  const plain = makeActor("Plain");
  const hardy = makeActor("Hardy", { items: [ability("Endurance")] });
  const id = makeFormation([plain, hardy]);
  const sleepless = { weather: CLEAR, ground: "grassland", day: { kind: "camp", noSleep: true }, camp: {} };

  await runRestNight(getFormation(id), sleepless);
  assert.equal(conditionStacksOf(plain, "fatigued"), 0, "one night is under the count");
  await runRestNight(getFormation(id), sleepless);
  assert.equal(conditionStacksOf(plain, "fatigued"), 1, "the second reaches it");
  assert.equal(conditionStacksOf(hardy, "fatigued"), 0, "Endurance buys a night");
  const third = await runRestNight(getFormation(id), sleepless);
  assert.equal(conditionStacksOf(plain, "fatigued"), 2, "and it keeps climbing while fatigued");
  assert.equal(conditionStacksOf(hardy, "fatigued"), 1);
  assert.deepEqual(third.find((r) => r.name === "Hardy").reasons, ["sleepless"]);
  assert.deepEqual(fatigueOfActor(plain).sleeplessDays, 3);
});

await ok("an Endurance body gains a night per point of Constitution bonus, and a labourer one more", async () => {
  const strong = makeActor("Strong", { items: [ability("Endurance")], con: 2 });
  const labourer = makeActor("Labourer", { items: [ability("Endurance"), ability("Labor")], con: 2 });
  const id = makeFormation([strong, labourer]);
  const night = { weather: CLEAR, ground: "grassland", day: { kind: "camp", noSleep: true }, camp: {} };
  // The count is 2 nights; Endurance with a bonus of 2 adds 3, a labourer's extra makes it 4.
  for (let i = 0; i < 4; i++) await runRestNight(getFormation(id), night);
  assert.equal(conditionStacksOf(strong, "fatigued"), 0, "four nights are inside the count of five");
  await runRestNight(getFormation(id), night);
  assert.equal(conditionStacksOf(strong, "fatigued"), 1, "the fifth reaches it");
  assert.equal(conditionStacksOf(labourer, "fatigued"), 0, "a labourer's extra night holds it off");
  await runRestNight(getFormation(id), night);
  assert.equal(conditionStacksOf(labourer, "fatigued"), 1, "and the sixth reaches it");
});

await ok("a forced march tires everyone, a labourer included, and a rest day with a restful night cures it", async () => {
  const worker = makeActor("Worker", { items: [ability("Labor")] });
  const id = makeFormation([worker]);
  await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "forced" }, camp: {} });
  assert.equal(conditionStacksOf(worker, "fatigued"), 1);

  const march = await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "march" }, camp: {} });
  assert.equal(conditionStacksOf(worker, "fatigued"), 2);
  assert.deepEqual(march[0].reasons, ["lingers"]);

  const camp = await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "camp" }, camp: {} });
  assert.equal(conditionStacksOf(worker, "fatigued"), 0, "ended");
  assert.deepEqual(camp[0].reasons, ["rested"]);
  assert.equal(worker.has("fatigued"), false, "and the condition is lifted from the token");
  assert.deepEqual(fatigueOfActor(worker), { activityDays: 0, sleeplessDays: 0, forcedDays: 0 });
});

await ok("an unimported fatigue table tires nobody and the card says so", async () => {
  unregisterTable(SURVIVAL_DOC);
  const a = makeActor("Untimed");
  const id = makeFormation([a]);
  await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "forced", noSleep: true }, camp: {} });
  assert.equal(conditionStacksOf(a, "fatigued"), 0);
  assert.match(restCards().at(-1).content, /rest\.unpriced/);
  registerTable(SURVIVAL, { priority: PRIORITY.WORLD, source: "test" });
});

await ok("only a Judge runs the night, and an empty order has none", async () => {
  const a = makeActor("Guarded");
  const id = makeFormation([a]);
  const cards = chat.length;
  game.user.isGM = false;
  assert.equal(await runRestNight(getFormation(id), { weather: CLEAR, day: { kind: "march" }, camp: {} }), null);
  game.user.isGM = true;
  assert.equal(await runRestNight(getFormation(makeFormation([])), { weather: CLEAR, day: { kind: "march" }, camp: {} }), null);
  assert.equal(chat.length, cards);
  assert.equal(fatigueOfActor(a), undefined);
});

console.log("\ntest-rest: all " + passed + " checks passed");
