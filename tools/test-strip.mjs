/**
 * The mode tab's strip against mocked Foundry globals: the strip's context in
 * each mode (`buildStripView`), the readout a camp day still prices, the
 * journey's warnings, and the party sheet's parts rendered with plain
 * Handlebars for a Judge and for a player in each mode — where every control
 * the old folds held now lives, once. Invented figures throughout — cells
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
  const { MODE_TEMPLATES, framePartIds, frameTabs, buildFrameView } = await import("../scripts/formation/frame-view.mjs");
  const { COUNTRY_KEYS } = await import("../scripts/battlemap/country.mjs");
  const hb = Handlebars.create();
  const read = (path) => fs.readFileSync(`templates/${path}`, "utf8");
  hb.registerHelper("localize", (key, options) =>
    String(key) + (options?.hash && Object.keys(options.hash).length ? JSON.stringify(options.hash) : ""));
  hb.registerHelper("checked", (v) => (v ? "checked" : ""));
  hb.registerHelper("eq", (a, b) => a === b);
  for (const path of ["formation/formation-strip.hbs", "formation/formation-player-actions.hbs", "formation/formation-cell.hbs", "formation/formation-country-card.hbs", "lib/station-chip.hbs"]) {
    hb.registerPartial(`modules/acks-extras/templates/${path}`, hb.compile(read(path)));
  }

  // Each part's template, read from the sheet's own PARTS; the mode part's
  // follows the travel mode (MODE_TEMPLATES), as `_configureRenderParts` sets it.
  const sheet = fs.readFileSync("scripts/formation/party-actor.mjs", "utf8");
  const partsBlock = sheet.slice(sheet.indexOf("static PARTS = {"));
  const PART_FILES = Object.fromEntries(
    [...partsBlock.slice(0, partsBlock.indexOf("\n  };")).matchAll(/^ {4}(\w+): \{\s*template: `\$\{T\}\/([\w.-]+)`/gm)].map((m) => [m[1], m[2]]),
  );
  for (const part of ["band", "frame", "tabs", "order", "kit", "sightings", "judge"]) {
    assert.ok(PART_FILES[part], `the sheet's ${part} part was read`);
  }
  const compiled = new Map();
  const templateOf = (file) => {
    if (!compiled.has(file)) compiled.set(file, hb.compile(read(`formation/${file}`)));
    return compiled.get(file);
  };

  // The handlers a template may name: SHARED_ACTIONS' own keys and the sheet's,
  // read from source, and core's `tab`.
  const source = fs.readFileSync("scripts/formation/formation-actions.mjs", "utf8");
  const block = source.slice(source.indexOf("export const SHARED_ACTIONS = {"));
  const handlers = new Set([
    ...[...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}(?:async )?(\w+)\(/gm)].map((m) => m[1]),
    ...[...sheet.matchAll(/^ {6}(\w+): PartySheet\.#/gm)].map((m) => m[1]),
    "tab",
  ]);
  assert.ok(handlers.has("travelEndDay") && handlers.has("togglePause") && handlers.has("goTab"), "the handler list was read");

  const scene = makeScene("S.strip.tpl", { kind: "hex", miles: TABLE_MILES });
  const token = makeToken(scene, "t.strip.tpl");
  /**
   * The sheet's render for a seat, part by part, from the context the sheet
   * builds (party-actor.mjs `_prepareContext`), the mode tab active:
   * `{partId: html}` for every part the seat is configured with.
   */
  const render = (id, { gm }) => {
    const f = getFormation(id);
    const was = game.user;
    game.user = { isGM: gm, id: gm ? "gm1" : "pl1" };
    try {
      const mode = travelOf(f).mode;
      const tabs = Object.fromEntries(frameTabs({ mode, isGM: gm }).map((tab) => {
        const active = tab.id === "mode";
        return [tab.id, { ...tab, group: "primary", active, cssClass: [tab.cssClass, active ? "active" : ""].filter(Boolean).join(" ") }];
      }));
      const context = {
        tabs,
        isGM: gm,
        formation: f,
        partyName: "The Company",
        panelHidden: false,
        ...buildFormationView(f),
        ...(gm ? buildGMExtras(f) : buildPlayerPanel(f)),
        headcount: 1,
        description: { source: "", html: "", editing: false },
        document: { uuid: "Actor.party" },
      };
      context.frame = buildFrameView({ view: context, isGM: gm, headcount: 1, hitPoints: [], clockTime: "" });
      const out = {};
      for (const part of framePartIds({ isGM: gm, hasFormation: true })) {
        out[part] = templateOf(part === "mode" ? MODE_TEMPLATES[mode] : PART_FILES[part])(context);
      }
      return out;
    } finally {
      game.user = was;
    }
  };
  const whole = (parts) => Object.values(parts).join("\n");
  const actionsIn = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
  const count = (html, needle) => html.split(needle).length - 1;
  /** The markup of one titled section of a part, up to the next section or the part's end. */
  const sectionOf = (html, key) => {
    const from = html.indexOf(`data-section="${key}"`);
    if (from < 0) return "";
    const next = html.indexOf("data-section=", from + 1);
    return html.slice(from, next < 0 ? undefined : next);
  };

  const journey = makeFormation(scene, token);
  const delve = makeFormation(scene, token, { mode: "delve" });
  const city = makeFormation(scene, token, { mode: "settlement" });

  for (const [mode, id] of [["journey", journey], ["delve", delve], ["settlement", city]]) {
    for (const gm of [true, false]) {
      const seat = `${mode}/${gm ? "GM" : "player"}`;
      const parts = render(id, { gm });
      const html = whole(parts);
      assert.ok(!/\sid="/.test(html), `${seat}: no literal id`);
      for (const action of actionsIn(html)) {
        assert.ok(handlers.has(action), `${seat}: data-action "${action}" has a handler`);
      }
      assert.ok(!/<(details|summary)\b/.test(html), `${seat}: no fold is left; every group is a titled section`);
      assert.equal("judge" in parts, gm, `${seat}: the Judge's part on a GM seat only`);
      for (const part of ["mode", "order", "kit", "sightings", "judge"]) {
        if (!(part in parts)) continue;
        const root = parts[part].match(/<div class="tab acks-extras-party-sheet__panel( active)?" data-group="primary" data-tab="(\w+)">/);
        assert.ok(root, `${seat}: the ${part} part's root is a panel of the primary group`);
        assert.equal(root[2], part, `${seat}: the ${part} panel answers to its own tab`);
        assert.equal(!!root[1], part === "mode", `${seat}: only the active tab's panel is active`);
      }
    }
  }

  // The Judge on a journey: every control the folds and the old header held has
  // one home, on one part.
  const gmJourney = render(journey, { gm: true });
  const HOMES = {
    band: ['name="travel.mode"', 'name="name"'],
    mode: [
      'name="travel.hexLabel"', 'data-action="travelEnterHex"', 'data-action="forageDay"', 'data-action="travelEndDay"',
      'data-action="hexStock"', 'name="camp.present"', 'name="camp.target"',
      'name="travel.movement.mode"',
      'name="travel.weather.season"', 'data-action="travelWeatherRoll"',
      'name="travel.day.kind"', 'name="travel.hour"', 'name="travel.day.traps"', 'name="travel.day.noSleep"',
      'name="travel.exposure.hours"', 'name="travel.camp.steal"', 'name="travel.camp.water"', 'name="travel.camp.sleepInArmour"',
    ],
    judge: [
      'name="travel.lostNote"', 'data-action="lostBegin"',
      ...COUNTRY_KEYS.map((key) => `name="travel.override.${key}"`),
    ],
    frame: [
      'data-action="partySave"', 'data-action="toggleMagical"', 'data-action="adjustHp"', 'data-action="consumeRations"',
      'data-action="travelEncounterThrow"', 'data-action="partyChecks"', 'data-action="searchHour"', 'data-action="togglePause"',
      'data-action="dealXp"', 'data-action="editDescription"', 'data-action="editPartyImage"', 'data-action="ownership"',
      'data-action="tweaks"', 'data-action="toggleKey"',
    ],
    tabs: ['data-action="togglePanel"', 'data-action="tab"'],
    order: [
      'data-action="autoArrange"', 'name="frontage"', 'data-action="saveMarchingOrder"', 'data-action="loadMarchingOrder"',
      'data-action="addBlank"', 'data-action="openTrapbreak"', 'data-action="openSkillAudit"', 'data-action="disband"',
    ],
  };
  for (const [home, needles] of Object.entries(HOMES)) {
    for (const needle of needles) {
      assert.ok(gmJourney[home].includes(needle), `${needle} lives on the ${home} part`);
      for (const [part, html] of Object.entries(gmJourney)) {
        if (part !== home) assert.ok(!html.includes(needle), `${needle} is not drawn a second time on the ${part} part`);
      }
    }
  }
  assert.equal(count(whole(gmJourney), 'data-action="travelEndDay"'), 1, "End day is pressed in one place");
  const head = gmJourney.mode.slice(0, gmJourney.mode.indexOf("</header>"));
  for (const needle of ['name="travel.hexLabel"', 'data-action="travelEnterHex"', 'data-action="forageDay"', 'data-action="travelEndDay"']) {
    assert.ok(head.includes(needle), `${needle} sits at the Wilderness tab's head`);
  }
  assert.ok(!whole(gmJourney).includes('data-action="advanceTurn"'), "a march does not tick dungeon turns");
  const order = ["country", "poi", "movement", "sky", "day", "camp"].map((key) => gmJourney.mode.indexOf(`data-section="${key}"`));
  assert.ok(order.every((at) => at > 0), "the Judge sees every section of the Wilderness tab");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Country, Points of interest, Movement, Sky, Day, then Camp");
  for (const needle of ['name="camp.present"', 'name="camp.target"', 'data-action="hexStock"']) {
    assert.ok(sectionOf(gmJourney.mode, "poi").includes(needle), `${needle} sits in Points of interest`);
  }
  assert.ok(sectionOf(gmJourney.mode, "day").includes('name="travel.hour"'), "the hour select sits in the Day section");
  assert.ok(sectionOf(gmJourney.mode, "camp").includes('name="travel.exposure.hours"'), "the exposure fields sit in the Camp section");
  assert.ok(!gmJourney.mode.includes('data-section="city"'), "no city section on a journey");
  assert.ok(sectionOf(gmJourney.judge, "episode").includes('data-action="lostBegin"'), "the lost episode is the Judge tab's");

  // The country: the map's reading as cards, and the Judge's word in the hand.
  const country = sectionOf(gmJourney.mode, "country");
  for (const key of ["ground", "road", "following", "territory"]) {
    assert.ok(country.includes(`data-key="${key}"`), `the ${key} card sits in Country`);
  }
  assert.ok(country.includes("ACKS-FORMATION.country.drawOn"), "Country names the table the encounters draw on");
  assert.ok(sectionOf(gmJourney.mode, "sky").includes('data-key="climate"'), "the climate is read in the Sky");
  const hand = sectionOf(gmJourney.judge, "hand");
  for (const key of COUNTRY_KEYS) assert.ok(hand.includes(`name="travel.override.${key}"`), `The Judge's hand holds ${key}`);
  assert.ok(!hand.includes('data-action="clearOverride"'), "with no word given, the hand has nothing to clear");

  // The Judge in the delve: the turn clock at the tab's head, no sections.
  const gmDelve = render(delve, { gm: true });
  const delveHead = gmDelve.mode.slice(0, gmDelve.mode.indexOf("</header>"));
  for (const action of ["advanceTurn", "advanceRound", "restTurn", "undoTurn", "togglePace"]) {
    assert.ok(delveHead.includes(`data-action="${action}"`), `the Dungeon tab's head offers ${action}`);
  }
  assert.ok(!gmDelve.mode.includes("data-section="), "no declaration sections in the delve");
  assert.ok(!whole(gmDelve).includes('data-action="travelEndDay"'), "the delve ends no day");
  assert.ok(gmDelve.judge.includes("ACKS-FORMATION.frame.judge.offJourney"), "the Judge's tab says it waits for a journey");
  assert.ok(gmDelve.sightings.includes("ACKS-FORMATION.frame.sightings.offJourney"), "and so does Sightings");

  // The Judge in a city: The city section, and the Hunted pill at the head.
  const gmCity = render(city, { gm: true });
  assert.ok(gmCity.mode.includes('data-section="city"') && !gmCity.mode.includes('data-section="country"'), "the city has its own section only");
  assert.ok(sectionOf(gmCity.mode, "city").includes('name="travel.settlement.pace"'));
  const cityHead = gmCity.mode.slice(0, gmCity.mode.indexOf("</header>"));
  assert.ok(cityHead.includes('name="travel.settlement.wanted"'), "the Hunted toggle sits at the City tab's head");
  assert.equal(count(whole(gmCity), 'name="travel.settlement.wanted"'), 1, "and is not drawn a second time");
  for (const action of ["advanceTurn", "advanceRound", "restTurn", "undoTurn"]) {
    assert.ok(cityHead.includes(`data-action="${action}"`), `the City tab's head offers ${action}`);
  }

  // A player: the strip and the camp's forecast, none of the declarations.
  const playerJourney = render(journey, { gm: false });
  const playerHtml = whole(playerJourney);
  assert.ok(playerJourney.mode.includes("ACKS-FORMATION.strip.milesPerHour"), "a player sees the journey strip");
  assert.ok(!playerHtml.includes('name="travel.mode"'), "but not the mode picker");
  assert.ok(!playerHtml.includes('name="name"'), "nor the name field");
  assert.ok(!playerHtml.includes('data-action="travelEndDay"'), "nor the Judge's buttons");
  for (const key of ["poi", "movement", "day"]) {
    assert.ok(!playerHtml.includes(`data-section="${key}"`), `no ${key} section for a player`);
  }
  const playerCountry = sectionOf(playerJourney.mode, "country");
  assert.ok(playerCountry.includes('data-key="territory"'), "the Country cards reach a player");
  assert.ok(!playerCountry.includes("data-action="), "with nothing to press");
  assert.ok(!playerCountry.includes("acks-extras-country-source") && !playerCountry.includes("acks-extras-country-chip"),
    "and no word on where a reading came from, nor any chip");
  assert.ok(sectionOf(playerJourney.mode, "camp").includes("ACKS-FORMATION.camp.food"), "the Camp section reaches a player, with the forecast in it");
  assert.ok(!playerHtml.includes("travel.exposure"), "and none of the Judge's exposure fields");
  assert.ok(!playerHtml.includes('name="camp.present"') && !playerHtml.includes('name="camp.target"'), "nor the search's selects");
  assert.ok(!/name="travel\./.test(playerHtml), "no declared field reaches a player");
  assert.ok(!playerHtml.includes('data-tab="judge"'), "and nothing names the Judge's tab");

  // Each source earns its chip. The map reads a forest of the register's grain
  // under the scene's default territory; the Judge's word overrides the ground,
  // repeats the territory and names a road the map has none of; the sheet
  // declared a route before the map was read. Every value is a module key.
  const land = makeScene("S.strip.country", { kind: "hex", miles: TABLE_MILES });
  const walker = makeToken(land, "t.strip.country");
  const reading = {
    sceneId: land.id, i: 0, j: 0, at: null,
    ground: "forest", encounterTerrain: "forestTaiga", territory: "outlands", climate: null, road: null, following: null,
    source: { ground: "map", encounterTerrain: "map", territory: "scene", climate: null, road: null, following: null },
    water: null,
  };
  const told = makeFormation(land, walker, {
    travel: { map: reading, following: "knownRoute", override: { ground: "desert", territory: "outlands", road: "paved" } },
  });
  const plain = makeFormation(land, walker, { travel: { map: reading } });
  const cardsOf = (id, gm) => {
    const was = game.user;
    game.user = { isGM: gm, id: gm ? "gm1" : "pl1" };
    try {
      return Object.fromEntries(buildFormationView(getFormation(id)).travel.country.cards.map((c) => [c.key, c]));
    } finally {
      game.user = was;
    }
  };
  const chips = (cards) => Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, [c.provenance, c.chip]]));

  assert.deepEqual(chips(cardsOf(told, true)), {
    ground: ["override", "override"],
    road: ["override", "declared"],
    following: ["declared", "declared"],
    territory: ["override", null],
  }, "the Judge's word over a different map, a word or a declaration with no map under it, and a word the map agrees with");
  assert.deepEqual(chips(cardsOf(plain, true)), {
    ground: ["map", null], road: ["default", null], following: ["default", null], territory: ["scene", null],
  }, "the map's and the scene's answers earn no chip, and nor does the default");
  const toldCards = cardsOf(told, true);
  assert.deepEqual([toldCards.ground.value, toldCards.ground.mapValue], ["desert", "forest"], "the card shows the word and keeps the map's");
  assert.deepEqual(
    Object.values(toldCards).filter((c) => c.paintable).map((c) => [c.key, c.paintLayer, c.paintBrush]),
    [["ground", "terrain", "desertSandy"], ["territory", "territory", "outlands"]],
    "an unpainted hex offers the brush for each painted layer, armed with the card's own value: the Judge's ground's own table, not the map's");
  assert.ok(Object.values(cardsOf(told, false)).every((c) => !c.paintable), "a player is offered no brush");
  assert.equal(buildFormationView(getFormation(told)).travel.country.encountersDrawOn, "ACKS-FORMATION.travel.enc.terrain.desertSandy",
    "the encounters draw on the overridden ground's own table, not the one the map read with another ground");

  const toldGM = render(told, { gm: true });
  const toldCountry = sectionOf(toldGM.mode, "country");
  assert.equal(count(toldCountry, "is-override"), 1, "one override chip: the ground");
  assert.ok(toldCountry.includes('data-action="clearOverride" data-key="ground"'), "and it clears the ground");
  assert.equal(count(toldCountry, "is-declared"), 2, "two pen marks: the road and the route");
  assert.equal(count(toldCountry, 'data-action="paintThisHex"'), 2, "two brushes: the terrain and the territory");
  assert.ok(toldCountry.includes('data-layer="territory" data-brush="outlands"'));
  const toldHand = sectionOf(toldGM.judge, "hand");
  assert.equal(count(toldHand, 'data-action="clearOverride"'), 3, "each word the Judge gave has its clear in the hand");
  assert.ok(/<option value="desert" selected>/.test(toldHand), "and its select shows the word");
  assert.ok(toldHand.includes("ACKS-FORMATION.country.hand.mapSilent"), "a key the map says nothing of is said to be silent");

  const toldPlayer = sectionOf(render(told, { gm: false }).mode, "country");
  assert.ok(toldPlayer.includes("ACKS-VEHICLES.terrain.desert"), "a player reads the country the Judge's word made");
  assert.ok(!/is-override|is-declared|is-paint|data-provenance/.test(toldPlayer), "without the Judge's marks");

  // Painted, the hex offers no brush for that layer.
  land.regions.push({
    behaviors: [],
    getFlag: (_ns, key) => (key === "territory" ? "unsettled" : key === "territoryHexes" ? ["0:0"] : undefined),
  });
  assert.deepEqual(
    Object.values(cardsOf(told, true)).filter((c) => c.paintable).map((c) => c.key), ["ground"],
    "a layer the map has painted under the token is not offered again");
}

{
  // ---- The hours in the weather are offered on any day they cost something ----
  const scene = makeScene("S.strip.sky", { kind: "hex", miles: TABLE_MILES });
  const token = makeToken(scene, "t.strip.sky");
  const bites = (weather) => {
    const id = makeFormation(scene, token, {
      travel: { weather: { auto: false, temperature: "", precipitation: "", wind: "", ...weather } },
    });
    const view = buildFormationView(getFormation(id));
    return view.travel.camp.exposure.bites;
  };
  resetTables();
  registerFrequency();
  assert.equal(bites({ temperature: "cold" }), false, "nothing imported: no day costs hours");
  registerTable({ id: "survival", tables: {
    exposure: { hoursUnprotected: { cold: 3 } },
    heat: { sweltering: { armourStone: 4 } },
  } }, { priority: PRIORITY.WORLD, source: "test" });
  registerTable({ id: "weather", tables: { conditionEffects: { sunbaked: { sunburn: { damage: 1, hours: 2 } } } } },
    { priority: PRIORITY.WORLD, source: "test" });
  assert.equal(bites({ temperature: "cold" }), true, "a band with a cold clock");
  assert.equal(bites({ temperature: "sweltering" }), true, "a band whose heat asks an armour save by the hour");
  assert.equal(bites({ precipitation: "sunbaked" }), true, "a sky that burns by the hour");
  assert.equal(bites({ temperature: "balmy" }), false, "a mild day stays greyed");
  unregisterTable("survival");
  unregisterTable("weather");
}

console.log("test-strip: OK (strip by mode, journey tally and clock, cadence next, pause, camp readout, warnings, the sheet's parts by mode and seat, the country's cards, chips and hand)");
