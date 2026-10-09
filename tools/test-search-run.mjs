/**
 * An hour of searching fed by a hex's stock (`scripts/formation/search-run.mjs`):
 * the Judge's three answers to "is there anything here", the find that marks
 * itself or asks the Judge to pick, the search credit, the automatic Land
 * Surveying attempt, the flying and canopy corrections, the Tracking line, and
 * the panel's templates rendered for a Judge and a player. Documents, dice and
 * dialogs are stand-ins; names, dice and figures are this file's inventions
 * (QQ names), so these tests prove the machinery and never the book.
 *
 * Run: node tools/test-search-run.mjs
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry stand-ins                           */
/* -------------------------------------------- */

let nextId = 0;
const uid = () => `rnd${String(++nextId).padStart(4, "0")}`;
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class ForcedDeletion {}
class ForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static create(value) {
    return new ForcedReplacement(value);
  }
}
class FieldStub {}

const hookCalls = [];
globalThis.Hooks = {
  callAll: (name, payload) => hookCalls.push([name, payload]),
  on() {},
  once() {},
};

const rendered = [];
globalThis.foundry = {
  utils: {
    randomID: uid,
    deepClone: clone,
    escapeHTML: (s) => String(s),
    hasProperty: () => false,
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    isEmpty: (v) => v == null || (typeof v === "object" && !Object.keys(v).length),
    mergeObject: (a, b) => Object.assign(a, b),
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: {
    operators: { ForcedDeletion, ForcedReplacement },
    fields: new Proxy({}, { get: () => FieldStub }),
    regionBehaviors: { RegionBehaviorType: class {} },
  },
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { wait: async () => null, confirm: async () => false, prompt: async () => null },
    },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    apps: { DocumentSheetConfig: { registerSheet() {} }, FilePicker: { implementation: class {} } },
    handlebars: {
      loadTemplates: () => [],
      renderTemplate: async (path, view) => {
        rendered.push([path, view]);
        return "<card/>";
      },
    },
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

const chat = [];
globalThis.ChatMessage = { create: async (data) => { chat.push(data); return data; } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

// A rigged d20: the queue's naturals first, then the default.
const formulas = [];
const queue = [];
let defaultNatural = 20;
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    const bonus = Number(/\+\s*(-?\d+)/.exec(this.formula)?.[1] ?? 0);
    const natural = queue.length ? queue.shift() : defaultNatural;
    this.dice = [{ total: natural }];
    this.total = natural + bonus;
    formulas.push(this.formula);
    return this;
  }
};

const settings = {
  formations: {}, travelEncounters: true, advanceWorldTime: true, dawnHour: 6, duskHour: 18, travelLogCap: 120,
};
const scenes = new Map();
const actors = new Map();
globalThis.game = {
  settings: {
    get: (_module, key) => settings[key],
    set: (_module, key, value) => { settings[key] = value; return value; },
  },
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => `${key} ${JSON.stringify(data)}`,
    has: () => false,
  },
  user: { isGM: true },
  users: [{ id: "gm1", isGM: true }, { id: "p1", isGM: false }],
  actors: { get: (id) => actors.get(id) ?? null, get contents() { return [...actors.values()]; } },
  scenes: { get: (id) => scenes.get(id) ?? null, [Symbol.iterator]: () => scenes.values() },
  tables: { get: () => null, contents: [] },
  time: {
    worldTime: 1000,
    async advance(seconds) { this.worldTime += seconds; },
  },
};

/* -------------------------------------------- */
/*  The modules under test                      */
/* -------------------------------------------- */

const { registerTable, resetTables, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { ENCOUNTERS_DOC } = await import("../scripts/formation/encounters.mjs");
const { SEARCHING_DOC } = await import("../scripts/formation/searching.mjs");
const { freshDay } = await import("../scripts/formation/travel.mjs");
const { getFormation } = await import("../scripts/formation/formation-model.mjs");
const { TERRAIN_FLAG, HEXES_FLAG } = await import("../scripts/battlemap/terrain-paint.mjs");
const stockRun = await import("../scripts/formation/hex-stock-run.mjs");
const { runSearchHour } = await import("../scripts/formation/search-run.mjs");
const view = await import("../scripts/formation/formation-view.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const ENCOUNTER_TABLES = {
  lairsPerHex: { grassland: "1d4" },
  rarity: { unsettled: [{ min: null, max: 10, rarity: "common" }, { min: 11, max: null, rarity: "rare" }] },
  "monsters.grasslandFarm": {
    common: [{ min: null, max: null, name: "QQ Prowler" }],
    rare: [{ min: null, max: null, name: "QQ Terror" }],
  },
};

const SEARCH_TABLES = (extra = {}) => ({
  targets: [{ min: 0, max: null, target: 12 }],
  specificTarget: -2,
  turnsPerThrow: 6,
  aerialTurnsPerThrow: 3,
  canopyTerrains: ["forest"],
  canopyPenalty: -4,
  trackingBonus: 3,
  surveyTarget: 17,
  surveyPerSearch: 3,
  ...extra,
});

function register({ searching = SEARCH_TABLES(), milesBreak = null } = {}) {
  resetTables();
  registerTable({ id: ENCOUNTERS_DOC, tables: ENCOUNTER_TABLES }, { priority: PRIORITY.WORLD, source: "test" });
  const tables = milesBreak == null
    ? searching
    : { ...searching, targets: [{ min: 0, max: milesBreak - 1, target: 19 }, { min: milesBreak, max: null, target: 8 }] };
  registerTable({ id: SEARCHING_DOC, tables }, { priority: PRIORITY.WORLD, source: "test" });
}

const token = (x, y, extra = {}) => ({ id: uid(), x, y, width: 1, height: 1, actorId: "pa1", getFlag: () => undefined, ...extra });
const shadowOf = (formationId, x, y) =>
  token(x, y, { actorId: "shadow", getFlag: (ns, key) => (key === "shadowFor" ? formationId : undefined) });

/** A hex scene whose flag store applies updates the way Foundry's path expansion reads them. */
function makeScene(id, { tokens = [], regions = [] } = {}) {
  const flags = {};
  const list = Object.assign([...tokens], { get(tokenId) { return this.find((tk) => tk.id === tokenId) ?? null; } });
  const scene = {
    id, uuid: `Scene.${id}`, name: `QQ Map ${id}`, flags, updates: [], tokens: list, regions,
    stockReads: 0, failStockReads: false,
    grid: {
      size: 100, sizeX: 100, sizeY: 100, distance: 6, units: "mi", type: CONST.GRID_TYPES.HEXODDR,
      getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
    },
    getFlag(ns, key) {
      if (key === "hexStock") {
        if (this.failStockReads) throw new Error("the stock was read");
        this.stockReads++;
      }
      return flags[ns]?.[key];
    },
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const [, ns, flag, ...rest] = path.split(".");
        const store = ((flags[ns] ??= {})[flag] ??= {});
        const key = rest.join(".");
        if (value instanceof ForcedDeletion) delete store[key];
        else store[key] = clone(value instanceof ForcedReplacement ? value.value : value);
      }
      return this;
    },
  };
  scenes.set(id, scene);
  return scene;
}

const paintedRegion = (ground, hexes) => ({
  getFlag: (ns, key) => (key === TERRAIN_FLAG ? ground : key === HEXES_FLAG ? hexes : undefined),
});

const mkActor = (id, abilities = []) => {
  const actor = {
    id, name: `QQ ${id}`, type: "character", system: { movementacks: { exploration: 120 } },
    items: abilities.map((name) => ({ type: "ability", name, flags: {}, getFlag: () => undefined })),
    effects: [], testUserPermission: () => false, getFlag: () => undefined, setFlag: async () => {}, update: async () => {}, flags: {},
  };
  actors.set(id, actor);
  return actor;
};

/**
 * The party standing at the centre of cell 2:3 (label D3) on a hex scene, with
 * a walker, a surveyor and a tracker to put in the order as asked.
 */
function world({ members = ["walker"], lost = null, shadow = null, movement = null, regions = [], dayKind = "march" } = {}) {
  scenes.clear();
  actors.clear();
  mkActor("walker");
  mkActor("surveyor", ["Land Surveying"]);
  mkActor("tracker", ["Tracking"]);
  const tokens = [token(250, 150, { id: "tk1" })];
  if (shadow) tokens.push(shadowOf("f1", shadow.x, shadow.y));
  const scene = makeScene("s1", { tokens, regions });
  const formation = {
    id: "f1", name: "QQ Band", sceneId: "s1", tokenId: "tk1", actorId: "pa1",
    members: members.map((actorId) => ({ actorId, roles: [] })),
    lights: [], spells: [],
    clock: { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false, lastPosition: { x: 250, y: 150 } },
    travel: {
      mode: "journey", territory: "unsettled", encounterTerrain: "grassland", hex: { label: "D3", i: 2, j: 3 },
      day: { ...freshDay(dayKind), activities: ["search", "search", "search"] },
      ...(movement ? { movement } : {}),
      ...(lost ? { lost } : {}),
    },
  };
  settings.formations = { f1: formation };
  chat.length = 0;
  formulas.length = 0;
  hookCalls.length = 0;
  rendered.length = 0;
  queue.length = 0;
  defaultNatural = 20;
  game.time.worldTime = 1000;
  return { scene, formation };
}

/** Write a stocked record of `n` named points under the party's hex; returns the record. */
async function stockHere(formation, n, { found = {} } = {}) {
  const result = await stockRun.stockFromInputs(formation, {
    terrain: "grassland", territory: "unsettled", judgeCount: n, rng: () => 0.5,
  });
  assert.ok(result.ok);
  const here = stockRun.trueHexOf(formation);
  const record = {
    ...result.record,
    points: result.record.points.map((p, i) => ({ ...p, name: `QQ Point ${i + 1}`, found: found[i] ?? {} })),
  };
  await stockRun.writeStock(here.scene, here.key, record);
  return record;
}

const search = (formation, opts = {}, naturals = []) => {
  queue.length = 0;
  queue.push(...naturals);
  chat.length = 0;
  formulas.length = 0;
  hookCalls.length = 0;
  return runSearchHour(getFormation(formation.id), opts);
};
const stockOf = (scene, key = "2:3") => scene.flags["acks-extras"]?.hexStock?.[key];
const searchCard = () => chat.find((m) => String(m.content).includes("acks-extras-search-card"))?.content ?? "";
const searchHook = () => hookCalls.find(([name]) => name === "acksExtras.searchHourSpent")?.[1];

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

register();

/* -------------------------------------------- */
/*  What "something here" means                 */
/* -------------------------------------------- */

await t("yes finds on an unstocked hex and reads no stock; no finds nothing", async () => {
  const { scene, formation } = world();
  scene.failStockReads = true;
  const yes = await search(formation, { present: "yes" });
  assert.equal(yes.found, true, "the Judge's yes is present for the throw");
  assert.equal(searchHook().present, true);
  assert.deepEqual(yes.candidates, []);
  const legacy = await search(formation, { present: true });
  assert.equal(legacy.found, true, "a legacy true maps to yes");
  const no = await search(formation, { present: "no" });
  assert.equal(no.found, false);
  assert.equal(no.attempts[0].reason, "nothingHere", "beating the target on empty ground teaches nothing");
  assert.equal(searchHook().present, false);
  const legacyNo = await search(formation, { present: false });
  assert.equal(legacyNo.found, false);
  assert.equal(scene.stockReads, 0, "neither answer touched the stock");
  assert.equal(scene.updates.length, 0, "and neither wrote it");
});

await t("stock on an unstocked hex reads as no", async () => {
  const { formation } = world();
  const r = await search(formation, { present: "stock" });
  assert.equal(r.found, false);
  assert.equal(r.attempts[0].reason, "nothingHere");
  assert.equal(r.credited, false, "an unstocked hex takes no credit");
});

/* -------------------------------------------- */
/*  Finds                                       */
/* -------------------------------------------- */

await t("one unfound point is marked found for this formation and listed once", async () => {
  const { scene, formation } = world();
  await stockHere(formation, 1);
  const r = await search(formation, { present: "stock" });
  assert.equal(r.found, true);
  assert.equal(r.candidates.length, 1);
  const point = stockOf(scene).points[0];
  assert.equal(point.id, r.candidates[0].id);
  assert.equal(point.found.f1, 1000, "found is stamped with the world time");
  assert.ok(!searchCard().includes("acks-extras-hex-found"), "a lone find needs no button");
});

await t("several unfound points mark nothing and the card lists them with their buttons", async () => {
  const { scene, formation } = world();
  const record = await stockHere(formation, 2);
  const r = await search(formation, { present: "stock" });
  assert.equal(r.found, true);
  assert.equal(r.candidates.length, 2);
  assert.ok(stockOf(scene).points.every((p) => !Object.keys(p.found).length), "the Judge picks, not the module");
  const html = searchCard();
  assert.equal((html.match(/acks-extras-hex-found/g) ?? []).length, 2);
  for (const p of record.points) {
    assert.ok(html.includes(`data-point-id="${p.id}"`), `the button for ${p.name}`);
    assert.ok(html.includes(p.name), "and its name");
  }
  assert.ok(html.includes('data-formation-id="f1"'));
});

await t("a point already found by this formation is not a candidate; another formation's find is", async () => {
  const { scene, formation } = world();
  await stockHere(formation, 2, { found: { 0: { f1: 5 }, 1: { other: 5 } } });
  const r = await search(formation, { present: "stock" });
  assert.deepEqual(r.candidates.map((c) => c.name), ["QQ Point 2"]);
  assert.equal(stockOf(scene).points[1].found.f1, 1000);
  assert.deepEqual(stockOf(scene).points[0].found, { f1: 5 }, "the earlier find stays as it was");
});

await t("a named target narrows the hour to that point and makes the hunt specific", async () => {
  const { scene, formation } = world();
  const record = await stockHere(formation, 2);
  const r = await search(formation, { present: "stock", target: record.points[1].id });
  assert.equal(r.found, true);
  assert.deepEqual(r.candidates.map((c) => c.id), [record.points[1].id]);
  assert.deepEqual(stockOf(scene).points.map((p) => Object.keys(p.found).length), [0, 1], "only the targeted point");
  assert.equal(searchHook().specific, true);
  assert.deepEqual(formulas, ["1d20 + -2"], "the specific penalty is on the throw");
  const again = await search(formation, { present: "stock", target: record.points[1].id });
  assert.equal(again.found, false, "the targeted point is found already: nothing to find");
});

await t("elsewhere forces nothing here and a specific hunt, whatever the stock holds", async () => {
  const { scene, formation } = world();
  await stockHere(formation, 2);
  const r = await search(formation, { present: "stock", target: "elsewhere" });
  assert.equal(r.found, false);
  assert.equal(r.attempts[0].reason, "nothingHere");
  assert.deepEqual(r.candidates, []);
  const hook = searchHook();
  assert.equal(hook.present, false);
  assert.equal(hook.specific, true);
  assert.ok(stockOf(scene).points.every((p) => !Object.keys(p.found).length));
  const yes = await search(formation, { present: "yes", target: "elsewhere" });
  assert.equal(yes.found, false, "elsewhere outranks the Judge's yes");
});

/* -------------------------------------------- */
/*  Search credit                               */
/* -------------------------------------------- */

await t("credit is written on a throw that beats the target and not on a miss", async () => {
  const { scene, formation } = world();
  await stockHere(formation, 1);
  const miss = await search(formation, { present: "stock" }, [1]);
  assert.equal(miss.credited, false);
  assert.equal(stockOf(scene).searches.f1, undefined, "a miss earns nothing");
  assert.equal(miss.found, false);
  const hit = await search(formation, { present: "stock" }, [20]);
  assert.equal(hit.credited, true);
  assert.equal(stockOf(scene).searches.f1, 1);
});

await t("an empty hex still credits the throw that beat the target, once per throw", async () => {
  const { scene, formation } = world({ movement: { mode: "flying", hoursAloft: 8 } });
  await stockHere(formation, 1, { found: { 0: { f1: 5 } } });
  const r = await search(formation, { present: "stock" });
  assert.equal(r.attempts.length, 2, "an open-ground flight buys two throws");
  assert.equal(r.found, false);
  assert.equal(stockOf(scene).searches.f1, 2, "one credit for each throw that beat the target");
});

await t("a hit under yes or no writes nothing to the scene", async () => {
  const { scene, formation } = world();
  await stockHere(formation, 1);
  const before = scene.updates.length;
  const yes = await search(formation, { present: "yes" });
  assert.equal(yes.found, true);
  await search(formation, { present: "no" });
  assert.equal(scene.updates.length, before);
  assert.equal(yes.credited, false);
  assert.deepEqual(stockOf(scene).searches, {});
  assert.ok(!Object.keys(stockOf(scene).points[0].found).length);
});

/* -------------------------------------------- */
/*  The automatic survey                        */
/* -------------------------------------------- */

await t("a surveyor in the order surveys a stocked hex once, after the first hour that earned credit", async () => {
  const { scene, formation } = world({ members: ["walker", "surveyor"] });
  await stockHere(formation, 2);
  const first = await search(formation, { present: "stock" }, [20, 18]);
  assert.ok(first.survey, "the attempt was made");
  assert.equal(first.survey.outcome, "assessed", "18 plus one credit's bonus beats the survey target");
  assert.equal(stockOf(scene).assessments.f1.told, 2);
  assert.equal(formulas.length, 2, "the search throw and the survey throw");
  assert.equal(formulas[1], "1d20 + 3", "the survey carries this hour's credit");
  const second = await search(formation, { present: "stock" }, [20, 18]);
  assert.equal(second.survey, null, "an assessment already stands");
  assert.equal(formulas.length, 1, "no second survey throw");
});

await t("an inconclusive survey leaves no assessment and the next hour tries again", async () => {
  const { scene, formation } = world({ members: ["surveyor"] });
  await stockHere(formation, 1);
  const first = await search(formation, { present: "stock" }, [20, 5]);
  assert.equal(first.survey.outcome, "inconclusive");
  assert.equal(stockOf(scene).assessments.f1, undefined);
  const second = await search(formation, { present: "stock" }, [20, 5]);
  assert.ok(second.survey, "tried again");
});

await t("no survey without a surveyor, a stock, the stock's answer, or while an assessment stands", async () => {
  const noSurveyor = world({ members: ["walker"] });
  await stockHere(noSurveyor.formation, 1);
  const a = await search(noSurveyor.formation, { present: "stock" });
  assert.equal(a.survey, null);
  assert.ok(!chat.some((m) => String(m.content).includes("hexStock.noSurveyor")), "and no card complains of it");

  const unstocked = world({ members: ["surveyor"] });
  const b = await search(unstocked.formation, { present: "stock" });
  assert.equal(b.survey, null);
  assert.equal(formulas.length, 1);

  const judgeWord = world({ members: ["surveyor"] });
  await stockHere(judgeWord.formation, 1);
  const c = await search(judgeWord.formation, { present: "yes" });
  assert.equal(c.survey, null, "the Judge's word leaves the stock alone");
  assert.equal(formulas.length, 1);

  const assessed = world({ members: ["surveyor"] });
  const rec = await stockHere(assessed.formation, 1);
  const here = stockRun.trueHexOf(assessed.formation);
  await stockRun.writeStock(here.scene, here.key, { ...rec, assessments: { f1: { told: 1, trustworthy: true, at: 1 } } });
  const d = await search(assessed.formation, { present: "stock" });
  assert.equal(d.survey, null);
});

/* -------------------------------------------- */
/*  Flying, canopy, tracking, miles             */
/* -------------------------------------------- */

await t("the flight mode alone makes the search aerial", async () => {
  const foot = world();
  assert.equal((await search(foot.formation, { present: "no" })).attempts.length, 1);
  const flying = world({ movement: { mode: "flying", hoursAloft: 8 } });
  assert.equal((await search(flying.formation, { present: "no" })).attempts.length, 2, "open ground over a flier");
});

await t("a hex painted at the book's grain reads as its ground for the canopy", async () => {
  // The marker (cell 5:7) is painted taiga — a forest kind; the believed hex is not painted.
  const regions = [paintedRegion("forestTaiga", ["5:7"])];
  const astray = world({
    movement: { mode: "flying", hoursAloft: 8 },
    lost: { phase: "astray", sceneId: "s1" },
    shadow: { x: 650, y: 450 },
    regions,
  });
  const a = await search(astray.formation, { present: "no" });
  assert.equal(a.attempts.length, 1, "taiga stands on forest: closed canopy keeps the ground pace");
  assert.deepEqual(formulas, ["1d20 + -4"], "and costs the canopy penalty");
});

await t("the canopy is read at the hex the party really stands in while astray", async () => {
  // The marker (cell 5:7) is painted forest; the believed hex (2:3) is not painted.
  const regions = [paintedRegion("forest", ["5:7"])];
  const astray = world({
    movement: { mode: "flying", hoursAloft: 8 },
    lost: { phase: "astray", sceneId: "s1" },
    shadow: { x: 650, y: 450 },
    regions,
  });
  const a = await search(astray.formation, { present: "no" });
  assert.equal(a.attempts.length, 1, "closed canopy keeps the ground pace");
  assert.deepEqual(formulas, ["1d20 + -4"], "and costs the canopy penalty");

  const home = world({ movement: { mode: "flying", hoursAloft: 8 }, regions });
  const h = await search(home.formation, { present: "no" });
  assert.equal(h.attempts.length, 2, "standing where it believes, the same flier sees open ground");
});

await t("a tracker in the order adds the figure; a missing figure says so", async () => {
  const { formation } = world({ members: ["walker", "tracker"] });
  await search(formation, { present: "no" });
  assert.deepEqual(formulas, ["1d20 + 3"]);
  assert.ok(searchCard().includes("<li>ACKS-FORMATION.searchRun.tracking {}</li>"), searchCard());
  assert.ok(!searchCard().includes("trackingUnpriced"));

  register({ searching: SEARCH_TABLES({ trackingBonus: undefined }) });
  const r = await search(formation, { present: "no" });
  assert.equal(r.ok, true, "the throw never refuses for the missing figure");
  assert.deepEqual(formulas, ["1d20"]);
  assert.ok(searchCard().includes("searchRun.trackingUnpriced"));

  const walker = world();
  await search(walker.formation, { present: "no" });
  assert.ok(!searchCard().includes("searchRun.tracking"), "no tracker, no line");
  register();
});

await t("the target is priced on the march miles, and a camp day does not lower them", async () => {
  const march = world();
  const miles = view.expeditionMiles(getFormation("f1"));
  assert.ok(miles > 1, "the invented party covers ground");
  assert.equal(view.expeditionMiles({ ...getFormation("f1"), travel: { ...getFormation("f1").travel, day: { ...getFormation("f1").travel.day, kind: "camp" } } }), miles);
  register({ milesBreak: Math.floor(miles) });
  const r = await search(march.formation, { present: "no" });
  assert.ok(searchCard().includes('"target":8'), "the target is the open bracket's, not the zero bracket's");
  assert.equal(r.ok, true);
  const camp = world({ dayKind: "camp" });
  await search(camp.formation, { present: "no" });
  assert.ok(searchCard().includes('"target":8'), "a camp day searches at the march pace");
  register();
});

await t("the hour is spent and the encounter is thrown whatever was found", async () => {
  const { formation } = world();
  const before = game.time.worldTime;
  const r = await search(formation, { present: "no" });
  assert.ok(game.time.worldTime > before, "the world clock ran");
  assert.ok(getFormation("f1").travel.day.done[0], "the first search slot is marked done");
  assert.ok(r.encounter, "the encounter chain ran");
  assert.equal(hookCalls.filter(([n]) => n === "acksExtras.searchHourSpent").length, 1);
});

/* -------------------------------------------- */
/*  The panel                                   */
/* -------------------------------------------- */

const { default: Handlebars } = await import("handlebars");
const fs = await import("node:fs");
const hb = Handlebars.create();
const PREFIX = "modules/acks-extras/templates/formation/";
hb.registerHelper("localize", (key, options) =>
  String(key) + (options?.hash && Object.keys(options.hash).length ? JSON.stringify(options.hash) : ""));
hb.registerHelper("checked", (v) => (v ? "checked" : ""));
for (const name of ["formation-strip", "formation-declarations"]) {
  hb.registerPartial(`${PREFIX}${name}.hbs`, hb.compile(fs.readFileSync(`templates/formation/${name}.hbs`, "utf8")));
}
const party = hb.compile(fs.readFileSync("templates/formation/formation-tab-party.hbs", "utf8"));
const source = fs.readFileSync("scripts/formation/formation-actions.mjs", "utf8");
const block = source.slice(source.indexOf("export const SHARED_ACTIONS = {"));
const handlers = new Set([...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}(?:async )?(\w+)\(/gm)].map((m) => m[1]));

const renderParty = (formation, { gm }) => {
  const was = game.user;
  game.user = { isGM: gm, id: gm ? "gm1" : "p1" };
  try {
    const f = getFormation(formation.id);
    const v = view.buildFormationView(f);
    return party({ isGM: gm, formation: f, ...v, ...(gm ? view.buildGMExtras(f) : view.buildPlayerPanel(f)), headcount: 1 });
  } finally {
    game.user = was;
  }
};

await t("every action the strip and the declarations name has a handler, stocked or not", async () => {
  assert.ok(handlers.has("hexStock") && handlers.has("searchHour"), "the handler list was read");
  const { formation } = world({ members: ["surveyor"] });
  const bare = renderParty(formation, { gm: true });
  await stockHere(formation, 2);
  const stocked = renderParty(formation, { gm: true });
  for (const [label, html] of [["unstocked", bare], ["stocked", stocked]]) {
    for (const [, action] of html.matchAll(/data-action="([^"]+)"/g)) {
      assert.ok(handlers.has(action), `${label}: data-action "${action}" has a handler`);
    }
    assert.ok(!/[\s<]id="/.test(html), `${label}: no literal id`);
    for (const [, inner] of html.matchAll(/<summary[^>]*>([^]*?)<\/summary>/g)) {
      assert.ok(!/<(button|input|select|textarea|a)\b/.test(inner), `${label}: no control inside a summary`);
    }
  }
  for (const action of ["hexStock", "hexSurvey", "hexFound", "hexPlace", "hexRemovePoint", "hexAddPoint", "hexClear"]) {
    assert.ok(handlers.has(action), `the handler ${action} exists`);
    assert.ok(stocked.includes(`data-action="${action}"`), `the stocked panel offers ${action}`);
  }
  assert.ok(bare.includes('data-action="hexStock"') && !bare.includes('data-action="hexClear"'), "an unstocked hex offers only the stocking");
});

await t("the strip carries the two selects, the stock the default, and the unfound points by id", async () => {
  const { formation } = world();
  const bare = renderParty(formation, { gm: true });
  assert.ok(!bare.includes('<option value="stock"'), "the stock is offered only where there is one");
  assert.match(bare, /<option value="no" selected>/);
  assert.ok(!/type="checkbox" name="camp\.present"/.test(bare), "the checkbox is gone");

  const record = await stockHere(formation, 2);
  const html = renderParty(formation, { gm: true });
  assert.match(html, /<select name="camp\.present">/);
  assert.match(html, /<option value="stock" selected>/);
  assert.match(html, /<select name="camp\.target">/);
  assert.match(html, /<option value="anything" selected>/);
  assert.match(html, /<option value="elsewhere" >/);
  for (const p of record.points) assert.ok(html.includes(`<option value="${p.id}"`), `${p.name} can be looked for`);
  assert.ok(html.includes('data-fold="hex"'), "the This hex group");
  assert.ok(html.includes("QQ Point 1"), "the Judge reads the point names");
  assert.ok(!html.includes("ACKS-FORMATION.hexStock.upTo"), "a count the Judge typed is not a ceiling");
  const rolled = await stockRun.stockFromInputs(formation, { terrain: "grassland", territory: "unsettled", rng: () => 0.5 });
  assert.ok(rolled.ok);
  assert.ok(renderParty(formation, { gm: true }).includes("ACKS-FORMATION.hexStock.upTo"), "a rolled count reads up to N");
});

await t("a placed point shows its place, a found point its tick, and an unfound one the button", async () => {
  const { formation } = world();
  const record = await stockHere(formation, 2);
  const here = stockRun.trueHexOf(formation);
  const points = record.points.map((p, i) => (i === 0 ? { ...p, found: { f1: 1 }, placeUuid: "Actor.qq" } : p));
  await stockRun.writeStock(here.scene, here.key, { ...record, points });
  const html = renderParty(formation, { gm: true });
  assert.ok(html.includes('data-uuid="Actor.qq"'), "the placed point opens its place");
  assert.equal((html.match(/data-action="hexPlace"/g) ?? []).length, 1, "only the unplaced point offers the placing");
  assert.equal((html.match(/data-action="hexFound"/g) ?? []).length, 1, "only the unfound point offers the mark");
  assert.ok(!html.includes('<option value="' + record.points[0].id), "a found point is no longer looked for");
});

await t("a player's panel carries no stock, no point name, and neither select", async () => {
  const { formation } = world();
  await stockHere(formation, 2);
  const html = renderParty(formation, { gm: false });
  assert.ok(!html.includes("QQ Point"), "no point name reaches a player");
  assert.ok(!html.includes('data-fold="hex"'));
  assert.ok(!html.includes("camp.present") && !html.includes("camp.target"));
  assert.ok(!/data-action="hex/.test(html), "none of the hex actions");
});

console.log(`\ntest-search-run: all ${passed} checks passed`);
