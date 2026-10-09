/**
 * The party tab's mode-aware strip against mocked Foundry globals: the strip's
 * context in each mode (`buildStripView`), the readout a camp day still prices,
 * the journey's warnings, and the two partial templates rendered with plain
 * Handlebars for a Judge and for a player. Invented figures throughout — cells
 * of 7 and 28 miles, a table distance of 7, an exploration speed made up for the
 * rig — so these prove the MACHINERY and never the book.
 *
 * Run: node tools/test-strip.mjs   (also wired into `npm run validate`).
 */
import assert from "node:assert/strict";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

const hookCalls = [];
/** What the record and the card count held at the moment a hook fired. */
const atHook = [];
globalThis.Hooks = {
  callAll(name, payload) {
    hookCalls.push([name, payload]);
    atHook.push({ cards: rendered.length, miles: travelOf(getFormation(payload.formationId) ?? {}).day.miles });
  },
  on() {},
  once() {},
};

const rendered = [];
const dialogs = [];
let dialogAnswer = "later";
class FieldStub {}
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
      DialogV2: {
        wait: async (options) => {
          dialogs.push(options);
          return dialogAnswer;
        },
      },
    },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    apps: { DocumentSheetConfig: { registerSheet() {} }, FilePicker: { implementation: class {} } },
    handlebars: {
      loadTemplates: () => [],
      renderTemplate: async (_path, view) => {
        rendered.push(view);
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
globalThis.ChatMessage = {
  async create(data) {
    chat.push(data);
    return data;
  },
};
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 10;
    this.dice = [{ results: [{ result: 10 }] }];
    return this;
  }
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;
globalThis.fromUuidSync = () => null;
globalThis.canvas = { scene: null, tokens: { controlled: [] } };

/** The world: settings, the clock, actors, scenes, users. */
const settings = {
  formations: {},
  travelEncounters: true,
  advanceWorldTime: true,
  dawnHour: 6,
  duskHour: 18,
  travelLogCap: 120,
};
const worldClock = { worldTime: 0, advances: [] };
/** A calendar of 24 one-hour hours; `hour` is what the world clock reads. */
const setClock = (hour) => {
  game.time.components = { hour, minute: 0, second: 0 };
  game.time.calendar = { days: { hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 } };
};
const dropCalendar = () => {
  game.time.components = undefined;
  game.time.calendar = undefined;
};
const actors = new Map();
const scenes = new Map();

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
  actors: { get: (id) => actors.get(id) ?? null, contents: [...actors.values()] },
  scenes: { get: (id) => scenes.get(id) ?? null, [Symbol.iterator]: () => scenes.values() },
  tables: { get: () => null, contents: [] },
  time: {
    get worldTime() {
      return worldClock.worldTime;
    },
    async advance(seconds) {
      worldClock.worldTime += seconds;
      worldClock.advances.push(seconds);
    },
  },
};
setClock(12);

const { registerTable, resetTables, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { getFormation } = await import("../scripts/formation/formation-model.mjs");
const { travelOf, freshDay, endDay, DAY_SECONDS } = await import("../scripts/formation/travel.mjs");
const journey = await import("../scripts/formation/journey.mjs");
const { travelReadout } = await import("../scripts/formation/formation-view.mjs");
const { partySpeed } = await import("../scripts/formation/formation-model.mjs");
const { offerDayEnd } = await import("../scripts/formation/day-close.mjs");
const { cadenceMilesFor } = await import("../scripts/formation/encounter-card.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

const CELL = 100; // pixels per cell
const TABLE_MILES = 7; // the invented imported distance
const TABLE = {
  id: "travel",
  tables: { encounterFrequency: { traveling: { borderlands: { kind: "perHex", mileHex: TABLE_MILES } } } },
};
const registerFrequency = () => registerTable(TABLE, { priority: PRIORITY.WORLD, source: "test" });
registerFrequency();

/**
 * A scene. `kind` is hex, square or gridless; `measure` says whether the grid
 * can measure a path (a hex counts cells along a row, the others the straight
 * line), and `miles` is what one cell is worth.
 */
function makeScene(id, { kind = "hex", miles = TABLE_MILES, measure = true } = {}) {
  const grid = {
    type: { hex: CONST.GRID_TYPES.HEXODDR, square: CONST.GRID_TYPES.SQUARE, gridless: CONST.GRID_TYPES.GRIDLESS }[kind],
    size: CELL,
    sizeX: CELL,
    sizeY: CELL,
    distance: miles,
    units: "mi",
    getOffset: (p) => ({ i: Math.floor(p.y / CELL), j: Math.floor(p.x / CELL) }),
  };
  if (measure) {
    grid.measurePath = ([a, b]) => {
      const cells = kind === "hex"
        ? Math.abs(Math.floor((b.x + CELL / 2) / CELL) - Math.floor((a.x + CELL / 2) / CELL))
          + Math.abs(Math.floor((b.y + CELL / 2) / CELL) - Math.floor((a.y + CELL / 2) / CELL))
        : Math.hypot(b.x - a.x, b.y - a.y) / CELL;
      return { distance: cells * miles, spaces: cells };
    };
  }
  const scene = { id, grid, regions: [], getFlag: () => undefined, tokens: Object.assign(new Map(), { filter(fn) { return [...this.values()].filter(fn); }, find(fn) { return [...this.values()].find(fn); } }) };
  scenes.set(id, scene);
  return scene;
}

/** A party token on a scene, standing at pixel (x, y). */
function makeToken(scene, id, x = 0, y = 0) {
  const token = { id, x, y, width: 1, height: 1, parent: scene, getFlag: () => undefined };
  scene.tokens.set(id, token);
  return token;
}

let serial = 0;
/**
 * A journeying formation of one walker, standing on `scene` with its baseline
 * at the token. The hex trace is seeded so the first drag is a crossing and not
 * a first arrival.
 */
function makeFormation(scene, token, { mode = "journey", hex = { label: "A1", i: 0, j: 0 }, day = {}, clock = {}, travel = {} } = {}) {
  const id = `f${++serial}`;
  actors.set(`a${id}`, { id: `a${id}`, name: "Walker", type: "character", system: { movementacks: { exploration: 120 } }, items: [], effects: [], testUserPermission: () => false, getFlag: () => undefined, setFlag: async () => {}, update: async () => {}, flags: {} });
  settings.formations[id] = {
    id,
    name: "The Company",
    sceneId: scene?.id ?? null,
    tokenId: token?.id ?? null,
    members: [{ actorId: `a${id}`, roles: [] }],
    lights: [],
    spells: [],
    clock: {
      turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false,
      lastPosition: token ? { x: token.x, y: token.y } : null,
      ...clock,
    },
    travel: { mode, territory: "borderlands", hex: { note: "", ...hex }, day: { ...freshDay(), ...day }, ...travel },
  };
  return id;
}

/** The readout's speed for a formation: what the clock is priced at. */
const speedOf = (id) => {
  const f = getFormation(id);
  return travelReadout(f, partySpeed(f, { dark: false })).milesPerHour;
};

/* -------------------------------------------- */
/*  The strip's context                         */
/* -------------------------------------------- */

const { buildStripView, buildWarnings, buildFormationView, buildGMExtras, buildPlayerPanel } =
  await import("../scripts/formation/formation-view.mjs");
const { dayBudget } = await import("../scripts/formation/travel.mjs");
const { unregisterTable } = await import("../scripts/lib/tables.mjs");

const tenths = (n) => Math.round(n * 10) / 10;
const stripOf = (id) => {
  const f = getFormation(id);
  return buildStripView(f, partySpeed(f, { dark: false }));
};

{
  // ---- A journey on a hex scene whose cell is the table's distance ----
  const scene = makeScene("S.strip.hex", { kind: "hex", miles: TABLE_MILES });
  const token = makeToken(scene, "t.strip.hex");
  setClock(14);
  const id = makeFormation(scene, token, { day: { miles: 12.34, hours: 3.26, hexesEntered: 2 } });
  const mph = speedOf(id);
  assert.ok(mph > 0, "the invented party has a speed");
  const strip = stripOf(id);

  assert.equal(strip.mode, "journey");
  assert.deepEqual(strip.modeOptions.map((o) => o.value), ["delve", "journey", "settlement"]);
  assert.deepEqual(strip.modeOptions.filter((o) => o.selected).map((o) => o.value), ["journey"]);
  assert.equal(strip.delve, undefined, "a journey carries no turn tracker stats");
  assert.equal(strip.speed.milesPerHour, mph);
  assert.ok(strip.speed.milesPerDay > mph, "a day is more than an hour");
  assert.deepEqual(strip.walked, { miles: 12.3, hours: 3.3 }, "the tally is shown to one decimal");
  const budget = dayBudget(travelOf(getFormation(id)), mph);
  assert.deepEqual(strip.budget, { hours: tenths(budget.hours), miles: tenths(budget.miles) });
  assert.ok(strip.budget.hours > 0);
  assert.equal(strip.spent, false, "3.3 h of a full day is not spent");
  assert.deepEqual(strip.hex, { label: "A1", entered: 2 });
  assert.equal(strip.cadence.by, "grid");
  assert.equal(strip.cadence.miles, TABLE_MILES);
  assert.equal(strip.cadence.next, "ACKS-FORMATION.strip.onEnteringHex", "a grid cadence is counted on entering a hex");
  assert.equal(strip.supplies.known, true);
  assert.equal(typeof strip.supplies.short, "boolean");

  // The clock reading: 14:00 with dusk at 18 is four hours of light.
  assert.deepEqual(
    { time: strip.clock.time, dark: strip.clock.dark, dusk: strip.clock.hoursToDusk, dawn: strip.clock.hoursToDawn, mode: strip.clock.hourMode },
    { time: "14:00", dark: false, dusk: 4, dawn: null, mode: "clock" },
  );
  setClock(20);
  const night = stripOf(id).clock;
  assert.equal(night.dark, true);
  assert.equal(night.hoursToDawn, 10, "20:00 to a 06:00 dawn");
  assert.equal(night.hoursToDusk, null);
  setClock(12);
  settings.formations[id].travel.hour = "night";
  const word = stripOf(id).clock;
  assert.equal(word.dark, true, "the Judge's word on the hour outranks the clock");
  assert.equal(word.overridden, true);
  assert.equal(word.hourMode, "night");
  settings.formations[id].travel.hour = "clock";
  dropCalendar();
  const blind = stripOf(id).clock;
  assert.equal(blind.time, "", "no calendar, no time");
  assert.equal(blind.hoursToDusk, null);
  setClock(12);

  // Spent: the hours reach the budget.
  settings.formations[id].travel.day.hours = budget.hours;
  assert.equal(stripOf(id).spent, true, "hours at the budget are a spent day");
  settings.formations[id].travel.day.hours = 3.26;

  // Pause: a journey keys on who paused it; the legacy flag alone is not a pause.
  settings.formations[id].clock.paused = true;
  assert.equal(stripOf(id).paused, false, "a journey ignores a bare paused flag");
  settings.formations[id].clock.pausedBy = "judge";
  assert.equal(stripOf(id).paused, true, "the Judge's pause holds a journey");
  settings.formations[id].clock.pausedBy = null;
  settings.formations[id].clock.paused = false;

  // The next throw by miles: the scene's cell is no unit of the table's.
  const wide = makeScene("S.strip.wide", { kind: "square", miles: 28 });
  const wideToken = makeToken(wide, "t.strip.wide");
  const byMiles = makeFormation(wide, wideToken, { day: { cadenceCarry: 2.5 } });
  const m = stripOf(byMiles).cadence;
  assert.equal(m.by, "miles");
  assert.equal(m.nextMiles, TABLE_MILES - 2.5, "the miles left to the next unit");
  assert.equal(m.next, `${TABLE_MILES - 2.5} ACKS-FORMATION.travel.milesShort`);

  // And with no table: a hex scene keeps its own cell, a mapless journey is unpriced.
  unregisterTable("travel");
  const noTable = stripOf(id).cadence;
  assert.equal(noTable.by, "grid");
  assert.equal(noTable.missing, "encounterFrequency", "the missing table is named");
  const mapless = makeFormation(null, null);
  const none = stripOf(mapless).cadence;
  assert.equal(none.by, "none");
  assert.equal(none.next, "ACKS-FORMATION.strip.unpricedCadence");
  assert.equal(none.nextMiles, null);
  registerFrequency();
}

{
  // ---- The delve and the city: the turn tracker's stats, and the pause flag ----
  const delve = makeFormation(null, null, { mode: "delve", clock: { paused: true, turnsTotal: 12, turnsSinceRest: 3, carryFeet: 40 } });
  const strip = stripOf(delve);
  assert.equal(strip.mode, "delve");
  assert.equal(strip.paused, true, "the delve reads the turn clock's flag");
  assert.equal(strip.delve.turns, 12);
  assert.equal(strip.delve.sinceRest, 3);
  assert.equal(strip.delve.carryFeet, 40);
  assert.ok(strip.delve.speed > 0 && strip.delve.combatSpeed > 0);
  assert.equal(strip.speed, undefined);
  assert.equal(strip.settlement, undefined);
  settings.formations[delve].clock.pausedBy = "judge";
  settings.formations[delve].clock.paused = false;
  assert.equal(stripOf(delve).paused, false, "and not the journey's pausedBy");

  const city = makeFormation(null, null, { mode: "settlement" });
  const c = stripOf(city);
  assert.equal(c.mode, "settlement");
  assert.ok(c.delve && c.settlement, "a city keeps the turn clock and adds the board's lines");
  for (const key of ["clockLine", "rateBlocks", "blocksUnpriced", "straggling", "blocks", "turns", "cadenceLine", "cadenceMissing", "unpricedIntent"]) {
    assert.ok(key in c.settlement, `the city strip carries ${key}`);
  }
}

/* -------------------------------------------- */
/*  The readout of a camp day                   */
/* -------------------------------------------- */

{
  const scene = makeScene("S.strip.camp", { kind: "hex", miles: 7 });
  const id = makeFormation(scene, makeToken(scene, "t.strip.camp"), { day: { ...freshDay("camp") } });
  const f = getFormation(id);
  const readout = travelReadout(f, partySpeed(f, { dark: false }));
  assert.equal(readout.camp, true, "a camp day still says so");
  assert.ok(readout.milesPerHour > 0, "and prices its travel slots at the dedicated pace");
  assert.ok(readout.milesPerDay > 0);
  assert.ok(Array.isArray(readout.parts) && Number.isFinite(readout.multiplier));
  assert.ok(readout.hexesPerDay > 0, "a mile-scale scene states the day in hexes");
  const small = makeScene("S.strip.feet", { kind: "square", miles: 0.01 });
  small.grid.units = "ft";
  small.grid.distance = 5;
  const smallId = makeFormation(small, makeToken(small, "t.strip.feet"));
  const sf = getFormation(smallId);
  assert.equal(travelReadout(sf, partySpeed(sf, { dark: false })).hexesPerDay, null, "a feet-scale scene states no hexes");
}

/* -------------------------------------------- */
/*  Warnings                                    */
/* -------------------------------------------- */

{
  const scene = makeScene("S.strip.warn", { kind: "hex", miles: 7 });
  scene.environment = { darknessLevel: 1 };
  const token = makeToken(scene, "t.strip.warn");
  const exhausted = { winded: true, turnsSinceRest: 99 };
  const journey = makeFormation(scene, token, { clock: exhausted });
  const turns = makeFormation(scene, token, { mode: "delve", clock: exhausted });
  const lit = (id) => buildWarnings(getFormation(id), 120).join("\n");

  setClock(12);
  assert.match(lit(turns), /warnings\.winded/, "the delve warns of the winded party");
  assert.doesNotMatch(lit(journey), /warnings\.(winded|restDue)/, "a march keeps no rest interval");
  assert.doesNotMatch(lit(journey), /darkBlinded|darkSighted/, "a dark scene is not a journey's night at noon");
  assert.doesNotMatch(lit(journey), /warnings.noLight/, "and a journey by day wants no lantern");
  assert.match(lit(turns), /darkBlinded|darkSighted/, "the delve keys its dark on the scene");

  setClock(22);
  scene.environment = { darknessLevel: 0 };
  assert.match(lit(journey), /darkBlinded|darkSighted/, "a journey keys its dark on the clock");
  assert.doesNotMatch(lit(turns), /darkBlinded|darkSighted/, "and the delve still reads a bright scene");
  assert.match(lit(turns), /warnings.noLight/, "where no lantern is lit, the delve says so by scene light");
  setClock(12);
}

/* -------------------------------------------- */
/*  The templates                               */
/* -------------------------------------------- */

{
  const { default: Handlebars } = await import("handlebars");
  const fs = await import("node:fs");
  const hb = Handlebars.create();
  const T = (name) => `templates/formation/${name}.hbs`;
  const PREFIX = "modules/acks-extras/templates/formation/";
  hb.registerHelper("localize", (key, options) =>
    String(key) + (options?.hash && Object.keys(options.hash).length ? JSON.stringify(options.hash) : ""));
  hb.registerHelper("checked", (v) => (v ? "checked" : ""));
  for (const name of ["formation-strip", "formation-declarations"]) {
    hb.registerPartial(`${PREFIX}${name}.hbs`, hb.compile(fs.readFileSync(T(name), "utf8")));
  }
  const party = hb.compile(fs.readFileSync(T("formation-tab-party"), "utf8"));

  // The handlers the templates may name: SHARED_ACTIONS' own keys, read from source.
  const source = fs.readFileSync("scripts/formation/formation-actions.mjs", "utf8");
  const block = source.slice(source.indexOf("export const SHARED_ACTIONS = {"));
  const handlers = new Set([...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}(?:async )?(\w+)\(/gm)].map((m) => m[1]));
  assert.ok(handlers.has("travelEndDay") && handlers.has("togglePause"), "the handler list was read");

  const scene = makeScene("S.strip.tpl", { kind: "hex", miles: TABLE_MILES });
  const token = makeToken(scene, "t.strip.tpl");
  const render = (id, { gm }) => {
    const f = getFormation(id);
    const was = game.user;
    game.user = { isGM: gm, id: gm ? "gm1" : "pl1" };
    try {
      const view = buildFormationView(f);
      return party({
        isGM: gm,
        formation: f,
        ...view,
        ...(gm ? buildGMExtras(f) : buildPlayerPanel(f)),
        headcount: 1,
      });
    } finally {
      game.user = was;
    }
  };
  const actionsIn = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

  const journey = makeFormation(scene, token);
  const delve = makeFormation(scene, token, { mode: "delve" });
  const city = makeFormation(scene, token, { mode: "settlement" });

  for (const [mode, id] of [["journey", journey], ["delve", delve], ["settlement", city]]) {
    for (const gm of [true, false]) {
      const html = render(id, { gm });
      assert.ok(!/\bid="/.test(html), `${mode}/${gm ? "GM" : "player"}: no literal id`);
      for (const action of actionsIn(html)) {
        assert.ok(handlers.has(action), `${mode}: data-action "${action}" has a handler`);
      }
      for (const [, inner] of html.matchAll(/<summary[^>]*>([^]*?)<\/summary>/g)) {
        assert.ok(!/<(button|input|select|textarea|a)\b/.test(inner), `${mode}: no control inside a summary`);
      }
      assert.ok(!/<details[^>]*\bopen\b/.test(html), `${mode}: every group is closed by default`);
    }
  }

  // The Judge: the mode picker, the journey's buttons, the groups by mode.
  const gmJourney = render(journey, { gm: true });
  assert.match(gmJourney, /<select name="travel\.mode">/);
  for (const action of ["travelEndDay", "travelEnterHex", "travelEncounterThrow", "forageDay", "searchHour", "togglePause", "dealXp", "adjustHp", "consumeRations", "disband"]) {
    assert.ok(gmJourney.includes(`data-action="${action}"`), `the journey strip offers ${action}`);
  }
  assert.ok(!gmJourney.includes('data-action="advanceTurn"'), "a march does not tick dungeon turns");
  assert.ok(gmJourney.includes('name="travel.hexLabel"'));
  for (const fold of ["country", "movement", "sky", "day", "camp", "lost"]) {
    assert.ok(gmJourney.includes(`data-fold="${fold}"`), `the Judge sees the ${fold} group`);
  }
  assert.ok(!gmJourney.includes('data-fold="city"'), "no city group on a journey");
  assert.ok(gmJourney.includes('name="travel.hour"'), "the hour select sits in the Day group");
  assert.ok(gmJourney.includes('name="travel.ground"') && gmJourney.includes('name="travel.road"'), "an unpainted map leaves the ground and road pickers");

  const gmDelve = render(delve, { gm: true });
  assert.ok(gmDelve.includes('data-action="advanceTurn"'), "the delve keeps its turn buttons");
  assert.ok(!gmDelve.includes("data-fold="), "no declaration groups in the delve");

  const gmCity = render(city, { gm: true });
  assert.ok(gmCity.includes('data-fold="city"') && !gmCity.includes('data-fold="country"'), "the city has its own group only");
  assert.ok(gmCity.includes('name="travel.settlement.pace"'));

  // A player: the strip and the camp's forecast, none of the declarations.
  const playerJourney = render(journey, { gm: false });
  assert.ok(playerJourney.includes("ACKS-FORMATION.strip.milesPerHour"), "a player sees the journey strip");
  assert.ok(!playerJourney.includes('name="travel.mode"'), "but not the mode picker");
  assert.ok(!playerJourney.includes('data-action="travelEndDay"'), "nor the Judge's buttons");
  for (const fold of ["country", "movement", "day", "lost"]) {
    assert.ok(!playerJourney.includes(`data-fold="${fold}"`), `no ${fold} group for a player`);
  }
  assert.ok(playerJourney.includes('data-fold="camp"'), "the camp group reaches a player");
  assert.ok(playerJourney.includes("ACKS-FORMATION.camp.food"), "with the forecast in it");
  assert.ok(!playerJourney.includes("travel.exposure"), "and none of the Judge's exposure fields");
  assert.ok(!/name="travel\./.test(playerJourney), "no declared field reaches a player");
}

console.log("test-strip: OK (strip by mode, journey tally and clock, cadence next, pause, camp readout, warnings, templates)");
