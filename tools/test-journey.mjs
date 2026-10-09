/**
 * The journey's movement engine against mocked Foundry globals: a party token's
 * drag measured in miles on hex, square and gridless scenes, the hours those
 * miles take on the world clock, the cadence units that owe a throw, the
 * Judge's pause, the delve's scale guard, the search hour, the day-end offer
 * and the jump to dawn. Invented figures throughout — cells of 7 and 28 miles,
 * a table distance of 7, an exploration speed made up for the rig — so these
 * prove the MACHINERY and never the book.
 *
 * Run: node tools/test-journey.mjs   (also wired into `npm run validate`).
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
/** Documents `fromUuid` finds, by uuid; anything else resolves null. */
const uuids = new Map();
globalThis.fromUuid = async (uuid) => uuids.get(uuid) ?? null;
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
  scenes: { get: (id) => scenes.get(id) ?? null },
  tables: { get: () => null },
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
const { cadenceMilesFor, postEncounterThrow, rollDayEncounters } = await import("../scripts/formation/encounter-card.mjs");

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
  actors.set(`a${id}`, { id: `a${id}`, name: "Walker", type: "character", system: { movementacks: { exploration: 120 } }, items: [], effects: [], getFlag: () => undefined, setFlag: async () => {}, update: async () => {}, flags: {} });
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

/** Run `fn`, returning what it advanced the world clock by and the cards thrown. */
async function observe(fn) {
  const t0 = worldClock.worldTime;
  const hooks0 = hookCalls.length;
  const cards0 = rendered.length;
  const chat0 = chat.length;
  const result = await fn();
  return {
    result,
    seconds: worldClock.worldTime - t0,
    hooks: hookCalls.slice(hooks0).filter(([n]) => n === "acksExtras.hexEntered").map(([, p]) => p),
    cards: rendered.slice(cards0),
    chat: chat.slice(chat0),
  };
}

/** Move a token and run the dispatcher the way the module's hook does. */
async function drag(token, formationId, x, y) {
  token.x = x;
  token.y = y;
  return observe(() => journey.onPartyTokenMoved(token, formationId));
}

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* -------------------------------------------- */
/*  Measuring                                   */
/* -------------------------------------------- */

{
  const hex = makeScene("S.measure.hex", { kind: "hex", miles: 7 });
  assert.equal(journey.journeyMilesBetween(hex, { x: 0, y: 0 }, { x: 0, y: 0 }), 0, "no displacement, no miles");
  assert.equal(journey.journeyMilesBetween(hex, { x: 0, y: 0 }, { x: CELL, y: 0 }), 7, "a hex grid measures steps times the cell");
  const square = makeScene("S.measure.sq", { kind: "square", miles: 7 });
  assert.equal(journey.journeyMilesBetween(square, { x: 0, y: 0 }, { x: 2 * CELL, y: 0 }), 14, "a square grid measures the line");
  const blind = makeScene("S.measure.blind", { kind: "gridless", miles: 7, measure: false });
  assert.ok(approx(journey.journeyMilesBetween(blind, { x: 0, y: 0 }, { x: CELL / 2, y: 0 }), 3.5),
    "a grid that cannot measure is the straight line in cells");
  const feet = makeScene("S.measure.ft", { kind: "square", miles: 5280, measure: false });
  feet.grid.units = "ft";
  assert.ok(approx(journey.journeyMilesBetween(feet, { x: 0, y: 0 }, { x: CELL, y: 0 }), 5280 / 5280),
    "the scene\x27s own unit is converted through feet");
  const broken = makeScene("S.measure.nan", { kind: "square", miles: 7 });
  broken.grid.measurePath = () => ({ distance: NaN });
  assert.ok(approx(journey.journeyMilesBetween(broken, { x: 0, y: 0 }, { x: CELL, y: 0 }), 7), "a non-finite measure falls back to the line");
}

/* -------------------------------------------- */
/*  A hex the size of the table's               */
/* -------------------------------------------- */

{
  const scene = makeScene("S.hex7", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.hex7");
  const id = makeFormation(scene, token);
  const mph = speedOf(id);
  assert.ok(mph > 0, "the invented party has a speed to price the miles at");

  const r = await drag(token, id, CELL, 0);
  assert.equal(r.result.units, 1, "one crossing of a hex the table\x27s size is one unit");
  assert.equal(r.result.crossed, 1);
  assert.equal(r.result.miles, 7);
  assert.ok(approx(r.result.hours, 7 / mph), "the miles spend hours at the readout\x27s speed");
  assert.equal(r.result.seconds, r.seconds, "and the clock ran by exactly those seconds");
  assert.ok(Number.isInteger(r.seconds) && Math.abs(r.seconds - (7 / mph) * 3600) < 1, "a whole number of seconds");
  assert.equal(r.hooks.length, 1, "the hook fires once per unit");
  assert.equal(r.hooks[0].cadence, "grid", "counted by the map\x27s own hex");
  assert.equal(r.hooks[0].formationId, id);
  assert.deepEqual(r.hooks[0].hex, { i: 0, j: 1, label: "B1" }, "the hex the party now stands in");
  assert.equal(r.hooks[0].throwOwed, true);
  assert.equal(r.hooks[0].night, false, "noon is day");
  assert.equal(r.cards.length, 1, "and the unit owes one throw");
  assert.equal(r.cards[0].hexLabel, "B1", "the card names the hex");
  assert.equal(r.cards[0].night, false);

  assert.equal(atHook[0].miles, 7, "the hook fires after the record holds the step");
  assert.equal(atHook[0].cards, rendered.length - 1, "and before the throw it announces");

  const f = getFormation(id);
  assert.equal(f.clock.turnsTotal, 0, "no dungeon turn passed");
  assert.deepEqual(f.clock.lastPosition, { x: CELL, y: 0 }, "the baseline follows the token");
  const day = travelOf(f).day;
  assert.equal(day.miles, 7);
  assert.ok(approx(day.hours, 7 / mph), "the day's hours are the miles over the speed");
  assert.equal(day.hexesEntered, 1, "the trace still counts the hex entered");
  assert.equal(day.secondsAdvanced, r.seconds);

  // A nudge inside the hex measures nothing on a hex grid: no time, no throw.
  const still = await drag(token, id, CELL + 10, 0);
  assert.equal(still.result.units, 0);
  assert.equal(still.seconds, 0, "a jitter inside a hex costs no clock");
  assert.equal(still.cards.length, 0);
  assert.deepEqual(getFormation(id).clock.lastPosition, { x: CELL + 10, y: 0 }, "but the baseline still follows");

  // One drag across four hexes crosses four: the trace records one change of
  // hex, the cells spanned are the crossings.
  const far = await drag(token, id, 5 * CELL, 0);
  assert.equal(far.result.miles, 28);
  assert.equal(far.result.crossed, 4, "four cells spanned are four crossings");
  assert.equal(far.result.units, 4);
  assert.equal(far.hooks.length, 4, "one hook per hex passed through");
  assert.equal(far.cards.length, 4, "and one throw each");
  assert.equal(travelOf(getFormation(id)).day.hexesEntered, 5, "the day counts every hex entered");
}

/* A party with no hex traced yet — just placed on the map — crosses as many
 * hexes as its first drag spans. */
{
  const scene = makeScene("S.hex7.fresh", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.hex7.fresh");
  const id = makeFormation(scene, token, { hex: { label: "", i: null, j: null } });
  const r = await drag(token, id, 2 * CELL, 0);
  assert.equal(r.result.crossed, 2, "with no prior hex, the cells spanned are the crossings");
  assert.equal(r.result.units, 2);
  assert.equal(r.hooks.length, 2);
  assert.equal(travelOf(getFormation(id)).day.hexesEntered, 2);
  assert.deepEqual(travelOf(getFormation(id)).hex, { note: "", label: "C1", i: 0, j: 2 }, "and the trace now names the hex");
}

/* -------------------------------------------- */
/*  A square scene counts miles                 */
/* -------------------------------------------- */

{
  const scene = makeScene("S.sq7", { kind: "square", miles: 7 });
  const token = makeToken(scene, "t.sq7");
  const id = makeFormation(scene, token);

  const r = await drag(token, id, 2 * CELL, 0);
  assert.equal(r.result.miles, 14);
  assert.equal(r.result.units, 2, "fourteen miles of a seven-mile table is two units");
  assert.equal(r.result.crossed, 0, "a square grid traces no hexes");
  assert.ok(r.hooks.every((p) => p.cadence === "miles"), "counted by miles");
  assert.equal(r.hooks.length, 2);
  assert.equal(r.cards.length, 2, "two throws");
  assert.equal(travelOf(getFormation(id)).day.cadenceCarry, 0);

  const half = await drag(token, id, 2.5 * CELL, 0);
  assert.equal(half.result.units, 0, "half a table-distance owes nothing yet");
  assert.ok(approx(travelOf(getFormation(id)).day.cadenceCarry, 3.5), "but is remembered");
  const rest = await drag(token, id, 3 * CELL, 0);
  assert.equal(rest.result.units, 1, "and the second half completes the unit");
  assert.ok(approx(travelOf(getFormation(id)).day.cadenceCarry, 0));
  assert.equal(rest.cards.length, 1);
}

/* -------------------------------------------- */
/*  A scene with no grid, and one that cannot measure */
/* -------------------------------------------- */

{
  const scene = makeScene("S.free", { kind: "gridless", miles: 5, measure: false });
  const token = makeToken(scene, "t.free");
  const id = makeFormation(scene, token);
  // 140 px at 5 miles per 100 px is 7 miles.
  const r = await drag(token, id, 140, 0);
  assert.ok(approx(r.result.miles, 7), "a gridless drag is measured as the line");
  assert.equal(r.result.units, 1, "and counted in miles");
  assert.equal(r.hooks[0].cadence, "miles");
}

/* -------------------------------------------- */
/*  A hex far bigger than the table's           */
/* -------------------------------------------- */

{
  const scene = makeScene("S.hex28", { kind: "hex", miles: 28 });
  const token = makeToken(scene, "t.hex28");
  const id = makeFormation(scene, token);
  const r = await drag(token, id, CELL, 0);
  assert.equal(r.result.miles, 28);
  assert.equal(r.result.crossed, 1, "one hex entered");
  assert.equal(r.result.units, 4, "but twenty-eight miles of a seven-mile table owes four throws");
  assert.ok(r.hooks.every((p) => p.cadence === "miles"), "counted by miles, not by the oversized hex");
  assert.equal(r.cards.length, 4);
  const interleave = atHook.slice(-4).map((h) => h.cards);
  assert.deepEqual(interleave.map((c, n) => c - interleave[0] - n), [0, 0, 0, 0], "each unit's hook fires before its own throw");
  assert.equal(travelOf(getFormation(id)).day.hexesEntered, 1, "the hex trace is identity, not the count");
}

/* -------------------------------------------- */
/*  No table imported                           */
/* -------------------------------------------- */

{
  resetTables();
  assert.equal(cadenceMilesFor("borderlands"), null, "nothing imported");

  const hexScene = makeScene("S.hex.nt", { kind: "hex", miles: 7 });
  const hexToken = makeToken(hexScene, "t.hex.nt");
  const hexId = makeFormation(hexScene, hexToken);
  const a = await drag(hexToken, hexId, CELL, 0);
  assert.equal(a.result.units, 1, "a hex map\x27s own crossing stands in for the missing table");
  assert.equal(a.hooks[0].cadence, "grid");

  const sqScene = makeScene("S.sq.nt", { kind: "square", miles: 7 });
  const sqToken = makeToken(sqScene, "t.sq.nt");
  const sqId = makeFormation(sqScene, sqToken);
  const b = await drag(sqToken, sqId, 3 * CELL, 0);
  assert.equal(b.result.units, 0, "a square map has no cadence to count without the table");
  assert.equal(b.hooks.length, 0);
  assert.equal(b.cards.length, 0);
  assert.equal(b.result.miles, 21, "though the miles and the hours still run");
  assert.ok(b.seconds > 0);

  registerFrequency();
  assert.equal(cadenceMilesFor("borderlands"), TABLE_MILES, "registered again");
  assert.equal(cadenceMilesFor("outlands"), null, "a territory with no row has no distance");
}

/* -------------------------------------------- */
/*  The Judge's pause                           */
/* -------------------------------------------- */

{
  const scene = makeScene("S.pause", { kind: "square", miles: 7 });
  const token = makeToken(scene, "t.pause");
  const id = makeFormation(scene, token, { clock: { paused: true, pausedBy: "judge" } });
  const r = await drag(token, id, 3 * CELL, 0);
  assert.equal(r.seconds, 0, "a paused journey runs no clock");
  assert.equal(r.cards.length, 0);
  assert.equal(travelOf(getFormation(id)).day.miles, 0, "and spends no miles");
  assert.deepEqual(getFormation(id).clock.lastPosition, { x: 3 * CELL, y: 0 }, "but the baseline follows the token");

  const clock = { ...getFormation(id).clock, paused: false, pausedBy: null };
  settings.formations[id].clock = clock;
  const next = await drag(token, id, 4 * CELL, 0);
  assert.equal(next.result.miles, 7, "after the pause only the new displacement is billed");

  // A legacy `paused` with nobody recorded as holding it does not stop a journey.
  settings.formations[id].clock = { ...getFormation(id).clock, paused: true, pausedBy: null };
  const legacy = await drag(token, id, 5 * CELL, 0);
  assert.equal(legacy.result.miles, 7, "a legacy paused flag reads as unpaused in journey mode");
}

/* -------------------------------------------- */
/*  A delve on a mile-scale map                 */
/* -------------------------------------------- */

{
  const scene = makeScene("S.delve", { kind: "square", miles: 7 });
  const token = makeToken(scene, "t.delve");
  const id = makeFormation(scene, token, { mode: "delve" });
  const warnings = () => chat.filter((m) => String(m.content).includes("chat.scaleGuard")).length;
  const before = warnings();

  const r = await drag(token, id, 3 * CELL, 0);
  assert.equal(r.seconds, 0, "the delve engine advances no world time here");
  assert.equal(getFormation(id).clock.turnsTotal, 0, "and bills no turns");
  assert.equal(warnings() - before, 1, "one whisper to the Judge");
  assert.ok(chat.at(-1).whisper.includes("gm1"), "whispered to the GMs");
  assert.match(chat.at(-1).content, /"miles":7/, "naming the map\x27s own miles per cell");
  assert.equal(getFormation(id).clock.scaleWarned, scene.id, "once per arrival");
  assert.deepEqual(getFormation(id).clock.lastPosition, { x: 3 * CELL, y: 0 });

  await drag(token, id, 6 * CELL, 0);
  assert.equal(warnings() - before, 1, "a second drag on the same scene does not whisper again");
  assert.equal(getFormation(id).clock.turnsTotal, 0);
}

/* -------------------------------------------- */
/*  The Judge's override: Next hex              */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null, { hex: { label: "" } });
  const mph = speedOf(id);
  const r = await observe(() => journey.nextHex(id, " K7 "));
  assert.equal(r.result.miles, TABLE_MILES, "a journey with no map spends one table-distance");
  assert.equal(r.result.units, 1);
  assert.ok(approx(r.result.hours, TABLE_MILES / mph));
  assert.equal(r.hooks.length, 1);
  assert.equal(r.hooks[0].cadence, "miles");
  assert.equal(r.hooks[0].sceneId, null);
  assert.equal(r.hooks[0].hex.label, "K7", "the Judge\x27s label names the hex");
  assert.equal(r.cards[0].hexLabel, "K7");
  const t = travelOf(getFormation(id));
  assert.equal(t.hex.label, "K7");
  assert.equal(t.day.hexesEntered, 1);

  // With a hex map under the party the crossing is the unit.
  const scene = makeScene("S.next", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.next");
  const onMap = makeFormation(scene, token);
  const g = await observe(() => journey.nextHex(onMap, "B2"));
  assert.equal(g.result.units, 1);
  assert.equal(g.hooks[0].cadence, "grid");
  assert.equal(g.hooks[0].sceneId, scene.id);

  // A camp day is priced at the march pace, so its travel slots can be walked: the click moves the clock.
  const camp = makeFormation(null, null, { day: { kind: "camp" } });
  const c = await observe(() => journey.nextHex(camp, "C3"));
  assert.ok(c.seconds > 0, "a camp day walks at the march pace, so the click moves the clock");
}

/* -------------------------------------------- */
/*  An hour spent searching                     */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null, { day: { activities: ["travel", "search", null, "search"] } });
  const r = await observe(() => journey.spendSearchHour(id));
  assert.equal(r.seconds, 3600, "an hour of the calendar");
  let day = travelOf(getFormation(id)).day;
  assert.deepEqual(day.done, [false, true, false, false], "the first unresolved search slot is marked");
  assert.equal(day.hours, 0, "the march's hours are untouched: the budget is the march's");
  assert.equal(day.secondsAdvanced, 3600);
  await journey.spendSearchHour(id);
  day = travelOf(getFormation(id)).day;
  assert.deepEqual(day.done, [false, true, false, true], "the next call marks the next one");
  await journey.spendSearchHour(id);
  day = travelOf(getFormation(id)).day;
  assert.deepEqual(day.done, [false, true, false, true], "with none left it marks nothing");
  assert.equal(day.secondsAdvanced, 10800, "though the hour still runs the clock");
  assert.equal(day.hours, 0, "and the march's hours stay untouched");
}

/* -------------------------------------------- */
/*  The clock burns light, not turns            */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null);
  settings.formations[id].lights = [{ id: "l1", type: "torch", bearerId: "x", remaining: 3, lit: true }];
  settings.formations[id].spells = [{ id: "s1", name: "Ward", casterId: "x", remaining: 2 }];
  // 25 minutes: two whole turns, 300 seconds kept.
  const r = await journey.advanceJourneyClock(id, 1500);
  assert.equal(r.seconds, 1500);
  const f = getFormation(id);
  assert.equal(f.lights[0].remaining, 1, "two turns burned off the torch");
  assert.equal(f.spells.length, 0, "the ward ran out and was dropped");
  assert.equal(f.clock.journeySeconds, 300, "the remainder waits for the next step");
  assert.equal(f.clock.turnsTotal, 0, "no turn was counted");
  assert.ok(r.notes.length >= 1, "an expiry is reported");
}

/* -------------------------------------------- */
/*  The day-end offer                           */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null);
  const budget = (await import("../scripts/formation/travel.mjs"));
  const f0 = getFormation(id);
  const mph = speedOf(id);
  const marchBudget = budget.dayBudget(travelOf(f0), mph);
  dialogAnswer = "later";

  // Daylight and hours below the budget: nothing is asked.
  setClock(12);
  assert.equal(await offerDayEnd(id), null);
  assert.equal(travelOf(getFormation(id)).day.offered, false);

  // Hours reach the budget.
  settings.formations[id].travel.day.hours = marchBudget.hours;
  settings.formations[id].travel.day.miles = marchBudget.hours * mph;
  const asked = dialogs.length;
  assert.equal(await offerDayEnd(id), "later", "a spent day asks");
  assert.equal(dialogs.length, asked + 1);
  assert.equal(travelOf(getFormation(id)).day.offered, true, "once");
  assert.ok(!dialogs.at(-1).content.includes("travel.dayEnd.dark"), "in daylight the dark line is absent");
  assert.match(dialogs.at(-1).content, new RegExp(`"hours":${Math.round(marchBudget.hours * 10) / 10}`), "the body names the hours");
  assert.equal(await offerDayEnd(id), null, "and does not ask twice");

  // Dark below the budget.
  const dark = makeFormation(null, null, { day: { hours: 1, miles: 2 } });
  setClock(22);
  assert.equal(await offerDayEnd(dark), "later", "the first step after dusk asks though the hours are short");
  assert.match(dialogs.at(-1).content, /travel\.dayEnd\.dark/, "and says it is dark");
  setClock(12);

  // A camp day with no travel slot has no hours to spend, so it never asks by hours.
  const camp = makeFormation(null, null, { day: { kind: "camp", hours: 9 } });
  assert.equal(await offerDayEnd(camp), null);
}

/* -------------------------------------------- */
/*  End day: the jump to dawn                   */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null, { day: { secondsAdvanced: 5000 } });
  setClock(21);
  const r = await observe(() => endDay(id, { miles: 12.5, hexes: 2 }));
  assert.equal(r.seconds, 9 * 3600, "from nine in the evening to a six o\x27clock dawn");
  assert.equal(r.result.miles, 12.5);
  assert.equal(r.result.hours, 0, "the entry records the hours beside the miles");
  assert.equal(travelOf(getFormation(id)).day.secondsAdvanced, 0, "and the board starts again");
  assert.equal(travelOf(getFormation(id)).dayCount, 1);

  setClock(3);
  const early = await observe(() => endDay(id, {}));
  assert.equal(early.seconds, 3 * 3600, "before dawn it is the same morning");

  setClock(6);
  const atDawn = await observe(() => endDay(id, {}));
  assert.equal(atDawn.seconds, 24 * 3600, "standing at dawn waits a whole day");

  // A clock that keeps no calendar advances what the day has not already.
  dropCalendar();
  settings.formations[id].travel.day.secondsAdvanced = 5000;
  const plain = await observe(() => endDay(id, {}));
  assert.equal(plain.seconds, DAY_SECONDS - 5000, "hours already run are absorbed, never charged twice");

  settings.formations[id].travel.day.secondsAdvanced = DAY_SECONDS + 10;
  const over = await observe(() => endDay(id, {}));
  assert.equal(over.seconds, 0, "a day that has already run its length advances nothing more");

  // The world-time switch governs every advance.
  setClock(21);
  settings.advanceWorldTime = false;
  const off = await observe(() => endDay(id, {}));
  assert.equal(off.seconds, 0, "with the module not driving the clock, nothing moves");
  const quiet = await observe(() => journey.advanceJourneyClock(id, 600));
  assert.equal(quiet.seconds, 0, "and a march advances nothing either");
  settings.advanceWorldTime = true;
  setClock(12);
}

/* -------------------------------------------- */
/*  Every other mode keeps the turn clock       */
/* -------------------------------------------- */

{
  // A 5-foot cell: the scale of a dungeon, nowhere near a mile.
  const scene = makeScene("S.crypt", { kind: "square", miles: 5 });
  scene.grid.units = "ft";
  const token = makeToken(scene, "t.crypt");
  const id = makeFormation(scene, token, { mode: "delve" });
  // Two hundred and forty feet is two 120-foot exploration moves.
  const r = await drag(token, id, 48 * CELL, 0);
  assert.equal(r.seconds, 1200, "two dungeon turns of world time");
  assert.equal(getFormation(id).clock.turnsTotal, 2, "a delve on a small map is billed in turns");
  assert.equal(travelOf(getFormation(id)).day.miles, 0, "and spends none of the journey's day");
  assert.equal(r.cards.length, 0, "with no encounter card");
}

/* -------------------------------------------- */
/*  The party token on a mile-scale map         */
/* -------------------------------------------- */

{
  const { syncPartyTokenSize } = await import("../scripts/formation/scene-sync.mjs");
  const sizeFor = async (scene, locked) => {
    const token = makeToken(scene, `t.size.${scene.id}`);
    token.getFlag = (_ns, key) => (locked && key === "footprintLock" ? true : undefined);
    token.width = 3;
    token.height = 2;
    let resized = null;
    token.resize = async (size) => {
      resized = size;
      token.width = size.width;
      token.height = size.height;
    };
    const id = makeFormation(scene, token);
    await syncPartyTokenSize(getFormation(id));
    return resized;
  };
  const mile = makeScene("S.size.mile", { kind: "hex", miles: 7 });
  assert.deepEqual(await sizeFor(mile, false), { width: 1, height: 1 }, "on a map of miles the party is one cell");
  const lockedSize = await sizeFor(makeScene("S.size.locked", { kind: "hex", miles: 7 }), true);
  assert.notDeepEqual(lockedSize, { width: 1, height: 1 }, "the footprint lock opts out and keeps the frontage arithmetic");
  const small = makeScene("S.size.small", { kind: "square", miles: 5 });
  small.grid.units = "ft";
  const smallSize = await sizeFor(small, false);
  assert.ok(smallSize, "a map of feet keeps the frontage arithmetic");
}

/* -------------------------------------------- */
/*  A search hour                               */
/* -------------------------------------------- */

{
  const { runSearchHour } = await import("../scripts/formation/search-run.mjs");
  const { SEARCHING_DOC } = await import("../scripts/formation/searching.mjs");
  const { bracketRow } = await import("../scripts/lib/tables.mjs");
  const targets = [
    { min: 0, max: 15, target: 19 },
    { min: 16, max: 40, target: 15 },
    { min: 41, max: null, target: 8 },
  ];
  registerTable({ id: SEARCHING_DOC, tables: { targets, turnsPerThrow: 6 } }, { priority: PRIORITY.WORLD, source: "test" });

  const scene = makeScene("S.search", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.search");
  // A camp day on the board: searching is still priced on the march speed.
  const id = makeFormation(scene, token, { day: { kind: "camp", activities: ["search", null, null, null] } });
  const f = getFormation(id);
  const marchMiles = travelReadout(
    { ...f, travel: { ...f.travel, day: { ...f.travel.day, kind: "march" } } },
    partySpeed(f, { dark: false }),
  ).milesPerDay;
  assert.ok(marchMiles > 0);

  const t0 = worldClock.worldTime;
  const hooks0 = hookCalls.length;
  const cards0 = rendered.length;
  const out = await runSearchHour(f, { subject: "pointOfInterest", specific: false, present: true });
  assert.equal(out.ok, true);
  const whisper = chat.find((m) => String(m.content).includes("acks-extras-search-card"));
  assert.match(whisper.content, new RegExp(`"target":${bracketRow(targets, marchMiles).target}`),
    "the throw is priced on the march day's miles, not the camp board's zero");
  assert.equal(worldClock.worldTime - t0, 3600, "the hour is an hour of world time");
  const day = travelOf(getFormation(id)).day;
  assert.deepEqual(day.done, [true, false, false, false], "the search slot is resolved");
  assert.equal(day.hours, 0, "the march's hours are untouched");
  assert.equal(rendered.length - cards0, 1, "and owes its one encounter throw");
  const spentHooks = hookCalls.slice(hooks0).filter(([n]) => n === "acksExtras.searchHourSpent");
  assert.equal(spentHooks.length, 1, "the hour announces itself");
  const p = spentHooks[0][1];
  assert.equal(p.formationId, id);
  assert.equal(p.sceneId, scene.id);
  assert.equal(p.subject, "pointOfInterest");
  assert.equal(p.specific, false);
  assert.equal(p.attempts, 1);
  assert.equal(p.found, false);
  assert.equal(p.present, true, "present comes from the Judge's own answer");
  assert.equal(p.hex.label, "A1");
  assert.equal(p.lost, false);

  // Unpriced: nothing is spent.
  const { unregisterTable } = await import("../scripts/lib/tables.mjs");
  unregisterTable(SEARCHING_DOC);
  const t1 = worldClock.worldTime;
  const none = await runSearchHour(getFormation(id), { present: true });
  assert.equal(none.ok, false);
  assert.equal(worldClock.worldTime, t1, "an unpriced search spends no hour");
}

/* -------------------------------------------- */
/*  Encounter zones on a journey                */
/* -------------------------------------------- */

/** A lang key out of the mock's formatted string, which appends its data. */
const keyOf = (text) => String(text).split(" ")[0];

/**
 * An encounter zone over a rectangle of a scene, named and keyed by `id`: the
 * behaviour's fields as given, every other one at the value that states nothing.
 */
function makeZone(scene, id, { x, y, width, height }, fields = {}) {
  const region = {
    id,
    name: id,
    elevation: {},
    shapes: [{ type: "rectangle", x, y, width, height }],
    behaviors: [{
      type: "acks-extras.encounterZone",
      disabled: false,
      system: { tableUuid: "", encounterEvery: 0, encounterTarget: 0, dungeonLevel: 0, journeyCadence: "", dayThrows: 0, nightThrows: 0, ...fields },
    }],
  };
  scene.regions.push(region);
  return region;
}

// A zone's own throw and its table land on the one card the throw posts.
{
  const scene = makeScene("S.zone.card", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.zone.card");
  const id = makeFormation(scene, token);
  const draws = [];
  uuids.set("RollTable.wood", {
    name: "Wood list",
    draw: async (options) => {
      draws.push(options);
      return { roll: { total: 4 }, results: [{ name: "QQ Pack", documentUuid: "Actor.qqpack" }, { name: "", description: "" }] };
    },
  });
  makeZone(scene, "Wood", { x: -CELL, y: -CELL, width: 10 * CELL, height: 10 * CELL }, { tableUuid: "RollTable.wood" });
  makeZone(scene, "Hollow", { x: 0, y: 0, width: CELL, height: CELL }, { encounterTarget: 1 });

  const r = await observe(() => postEncounterThrow(getFormation(id), { activity: "travel" }));
  assert.equal(r.chat.length, 1, "the zone's table draws onto the throw's own card: one message");
  assert.deepEqual(draws, [{ displayChat: false }], "drawn without core's own card");
  const view = r.cards[0];
  assert.equal(view.zone, "Wood, Hollow", "the card names every zone that supplied a field");
  assert.equal(view.zoneThrow.target, 1, "the smaller zone's target is the throw");
  assert.ok(view.zoneThrow.roll >= 1 && view.zoneThrow.roll <= 6, "on a d6");
  assert.deepEqual(view.rolls, [], "no territory throw was made");
  assert.equal(view.zoneDraw.total, 4);
  assert.deepEqual(view.zoneDraw.rows[0], { text: "QQ Pack", link: "@UUID[Actor.qqpack]{QQ Pack}" }, "a row naming a document links it");
  assert.equal(keyOf(view.zoneDraw.rows[1].text), "ACKS-FORMATION.travel.enc.zoneRowBlank", "a blank row says the Judge fills it");
  assert.equal(view.zoneDraw.rows[1].link, null);
  assert.equal(view.creature, null, "the creature step was the table's");

  uuids.delete("RollTable.wood");
  const gone = await observe(() => postEncounterThrow(getFormation(id), { activity: "travel" }));
  assert.equal(gone.cards[0].zoneMissing, "Wood", "a table that no longer resolves names its zone");
  assert.equal(gone.cards[0].zoneDraw, null);
}

// The zones are read where the party really is: its shadow while astray.
{
  const scene = makeScene("S.zone.true", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.zone.true");
  const id = makeFormation(scene, token);
  const shadow = makeToken(scene, "t.zone.shadow", 5 * CELL, 0);
  shadow.getFlag = (_ns, key) => (key === "shadowFor" ? id : undefined);
  makeZone(scene, "Fen", { x: 5 * CELL, y: 0, width: CELL, height: CELL }, { encounterTarget: 1 });

  const astray = await observe(() => postEncounterThrow(getFormation(id)));
  assert.equal(astray.cards[0].zone, "Fen", "an astray party meets the zone its shadow stands in");
  scene.tokens.delete(shadow.id);
  const found = await observe(() => postEncounterThrow(getFormation(id)));
  assert.equal(found.cards[0].zone, null, "with no shadow the marker's own ground answers");
}

// An entry cadence throws once on crossing in, and nothing per unit inside.
{
  const scene = makeScene("S.zone.entry", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.zone.entry");
  const id = makeFormation(scene, token);
  const marsh = makeZone(scene, "Marsh", { x: 2 * CELL, y: -CELL, width: 8 * CELL, height: 3 * CELL }, { journeyCadence: "entry" });

  const outside = await drag(token, id, CELL, 0);
  assert.equal(outside.cards.length, 1, "outside the zone every unit throws");
  assert.equal(outside.result.zoneEntered, false);
  assert.equal(getFormation(id).clock.zoneIds, undefined, "a party that never stood in a zone records none");

  const into = await drag(token, id, 3 * CELL, 0);
  assert.equal(into.result.units, 2);
  assert.equal(into.hooks.length, 2, "the hook still fires per unit");
  assert.ok(into.hooks.every((h) => h.throwOwed === false), "owing no throw");
  assert.equal(into.cards.length, 1, "crossing in throws once");
  assert.equal(keyOf(into.cards[0].activity), "ACKS-FORMATION.travel.enc.activity.entry", "and the card says why");
  assert.equal(into.result.zoneEntered, true);
  assert.deepEqual(getFormation(id).clock.zoneIds, [marsh.id], "the record keeps the zones it stands in");

  const within = await drag(token, id, 5 * CELL, 0);
  assert.equal(within.hooks.length, 2);
  assert.equal(within.cards.length, 0, "walking on inside throws nothing");

  const out = await drag(token, id, CELL, 0);
  assert.equal(out.cards.length, 4, "outside again, the inherited cadence throws per unit");
  assert.deepEqual(getFormation(id).clock.zoneIds, []);
  const back = await drag(token, id, 2 * CELL, 0);
  assert.equal(back.cards.length, 1, "a second crossing in throws again");
}

// A periods cadence throws nothing per unit; End Day throws the zone's counts.
{
  const scene = makeScene("S.zone.periods", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.zone.periods");
  const id = makeFormation(scene, token);
  const steppe = makeZone(scene, "Steppe", { x: -CELL, y: -CELL, width: 10 * CELL, height: 3 * CELL }, { journeyCadence: "periods", dayThrows: 2 });

  const walk = await drag(token, id, 2 * CELL, 0);
  assert.equal(walk.hooks.length, 2);
  assert.ok(walk.hooks.every((h) => h.throwOwed === false), "the hook owes no throw");
  assert.equal(walk.cards.length, 0, "a walk inside throws nothing");

  registerTable({
    id: "travel",
    tables: {
      encounterFrequency: {
        ...TABLE.tables.encounterFrequency,
        hunting: { borderlands: { kind: "perAttempt" } },
        restingDay: { borderlands: { kind: "perPeriod" } },
        restingNight: { borderlands: { kind: "perPeriod", nights: 1 } },
      },
    },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const said = (cards) => cards.map((c) => [keyOf(c.activity), c.night]);
  const march = await observe(() => rollDayEncounters(getFormation(id), { dayKind: "march", activities: ["hunt"] }));
  assert.deepEqual(said(march.cards), [
    ["ACKS-FORMATION.travel.enc.activity.travel", false],
    ["ACKS-FORMATION.travel.enc.activity.travel", false],
    ["ACKS-FORMATION.travel.enc.activity.rest", true],
  ], "the zone's day throws replace the hunt slot; a night count of 0 leaves the imported night");

  steppe.behaviors[0].system.nightThrows = 3;
  const camp = await observe(() => rollDayEncounters(getFormation(id), { dayKind: "camp", activities: [] }));
  assert.deepEqual(said(camp.cards), [
    ...Array(2).fill(["ACKS-FORMATION.travel.enc.activity.rest", false]),
    ...Array(3).fill(["ACKS-FORMATION.travel.enc.activity.rest", true]),
  ], "a day that did not travel throws its day count as rest, and the night count replaces the imported night");

  steppe.behaviors[0].system.journeyCadence = "";
  const inherit = await observe(() => rollDayEncounters(getFormation(id), { dayKind: "march", activities: ["hunt"] }));
  assert.deepEqual(said(inherit.cards), [
    ["ACKS-FORMATION.travel.enc.activity.hunt", false],
    ["ACKS-FORMATION.travel.enc.activity.rest", true],
  ], "with no periods cadence the counts are not read");
  registerFrequency();
}

console.log("test-journey: OK (miles on hex/square/gridless, cadence by grid or miles, clock hours, pause, scale guard, next hex, token size, search hour, day end, dawn, zones: card, true position, entry, periods)");
