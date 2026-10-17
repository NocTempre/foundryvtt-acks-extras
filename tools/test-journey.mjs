/**
 * The journey's movement engine against mocked Foundry globals: a party token's
 * drag measured in miles on hex, square and gridless scenes, the hours those
 * miles take on the world clock, the cadence units that owe a throw, the
 * Judge's pause, the delve's scale guard, the search hour, the day-end offer
 * and the jump to dawn, the day's navigation throw at its first step off a
 * road, and the truth a drag walks while the party is lost. Invented figures
 * throughout — cells of 7 and 28 miles, a table distance of 7, a navigation
 * target of 12, an exploration speed made up for the rig — so these prove the
 * MACHINERY and never the book.
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
/** The face every die shows and the total every roll makes: the rig a test sets. */
let rollFace = 10;
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = rollFace;
    this.dice = [{ results: [{ result: rollFace }] }];
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
const { cadenceMilesFor, postEncounterThrow, postEncounterCard, rollDayEncounters } = await import("../scripts/formation/encounter-card.mjs");

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
  assert.equal(getFormation(id).travel.map?.sceneId, "S.pause", "and so does the map's reading");

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
/*  A move the active GM's client is drawing    */
/* -------------------------------------------- */

// Core animates the prepared corner from where the move began; the stored
// corner (`_source`) holds where it put the party. See docs/formation/
// DECISIONS.md, "A drawn party token is measured where its move put it".
{
  const drawn = (token, x, y) => {
    token._source = { x, y };
    return token;
  };

  const scene = makeScene("S.drawn", { kind: "hex", miles: 7 });
  const token = drawn(makeToken(scene, "t.drawn"), CELL, 0);
  const id = makeFormation(scene, token);
  const r = await observe(() => journey.onPartyTokenMoved(token, id));
  assert.equal(r.result.miles, 7, "a drawn move is measured to where it put the party");
  assert.deepEqual(r.hooks[0]?.hex, { i: 0, j: 1, label: "B1" }, "and the hex it entered is read there");
  assert.deepEqual(getFormation(id).clock.lastPosition, { x: CELL, y: 0 }, "the next move is measured from there");

  // Two moves heard at once: each is measured to its own destination, read
  // when it was heard, though the second has written over the token by the
  // time the first's turn comes.
  const first = journey.onPartyTokenMoved(drawn(token, 2 * CELL, 0), id);
  const second = journey.onPartyTokenMoved(drawn(token, 3 * CELL, 0), id);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.miles, b.miles], [7, 7], "two queued moves each spend their own hex");

  const paused = makeScene("S.drawn.pause", { kind: "hex", miles: 7 });
  const still = drawn(makeToken(paused, "t.drawn.pause"), 3 * CELL, 0);
  const pausedId = makeFormation(paused, still, { clock: { paused: true, pausedBy: "judge" } });
  await observe(() => journey.onPartyTokenMoved(still, pausedId));
  const t = getFormation(pausedId).travel;
  assert.deepEqual(getFormation(pausedId).clock.lastPosition, { x: 3 * CELL, y: 0 }, "a paused journey's baseline follows the stored corner");
  assert.deepEqual([t.hex.i, t.hex.j, t.map.i, t.map.j], [0, 3, 0, 3], "and so do its hex and reading");

  // A re-anchor reads the stored corner too. See docs/formation/DECISIONS.md,
  // "A re-anchor reads the party token's stored corner".
  const { setJourneyMode } = await import("../scripts/formation/travel.mjs");
  const { reanchorEpisode } = await import("../scripts/formation/lost-episode.mjs");

  const entering = makeScene("S.drawn.mode", { kind: "hex", miles: 7 });
  const arriving = drawn(makeToken(entering, "t.drawn.mode"), 2 * CELL, 0);
  const modeId = makeFormation(entering, arriving, { mode: "delve" });
  await setJourneyMode(modeId, "journey", { sceneId: entering.id });
  const entered = getFormation(modeId);
  assert.deepEqual(entered.clock.lastPosition, { x: 2 * CELL, y: 0 }, "a mode change re-anchors the clock where the move put the party");
  assert.deepEqual([entered.travel.map.i, entered.travel.map.j], [0, 2], "and a journey begun reads its country there");

  // The step onto the shadow changes nothing stored, so core drops it and the
  // move that brought the party there is still being drawn.
  const astray = makeScene("S.drawn.truth", { kind: "hex", miles: 7 });
  astray.deleteEmbeddedDocuments = async (_type, ids) => ids.forEach((id) => astray.tokens.delete(id));
  const walker = drawn(makeToken(astray, "t.drawn.truth"), 3 * CELL, 0);
  walker.update = async (data) => {
    if (Object.entries(data).every(([k, v]) => walker._source[k] === v)) return walker;
    walker._source = { ...walker._source, ...data };
    return Object.assign(walker, walker._source);
  };
  const truthId = makeFormation(astray, walker);
  const shadow = makeToken(astray, "t.drawn.truth.shadow", 3 * CELL, 0);
  shadow.getFlag = (_ns, key) => (key === "shadowFor" ? truthId : undefined);
  // Retiring the shadow walks every scene, as core's collection iterates.
  game.scenes[Symbol.iterator] = () => scenes.values();
  try {
    const stepped = await reanchorEpisode(getFormation(truthId));
    assert.equal(stepped?.moved, true, "the party stepped onto its shadow");
  } finally {
    delete game.scenes[Symbol.iterator];
  }
  const seated = getFormation(truthId);
  assert.deepEqual(seated.clock.lastPosition, { x: 3 * CELL, y: 0 }, "the step re-anchors the clock where the party stands");
  assert.deepEqual([seated.travel.hex.i, seated.travel.hex.j], [0, 3], "and seats the hex it stands in");
}

// On a hex grid a paused drag seats the hex it lands in as well as its reading.
{
  const scene = makeScene("S.pause.hex", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.pause.hex");
  const id = makeFormation(scene, token, { clock: { paused: true, pausedBy: "judge" } });
  const r = await drag(token, id, 3 * CELL, 0);
  assert.equal(r.seconds, 0);
  const t = getFormation(id).travel;
  assert.deepEqual([t.hex.i, t.hex.j, t.map.i, t.map.j], [0, 3, 0, 3], "a paused drag seats the hex and its reading, billing nothing");
  assert.equal(t.day.hexesEntered ?? 0, 0, "and counts no crossing");
}

// A move inside the party's own hex is no step: the road its last step walked
// stays the map's answer, which a read at the token cannot see.
{
  const scene = makeScene("S.standing", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.standing");
  const held = {
    sceneId: "S.standing", i: 0, j: 0, at: 0,
    ground: null, encounterTerrain: null, territory: null, climate: null, road: "paved", following: null, water: null,
    source: { road: "map" },
  };
  const id = makeFormation(scene, token, { travel: { map: held } });
  await drag(token, id, 10, 10);
  assert.deepEqual([getFormation(id).travel.map.road, getFormation(id).travel.map.source.road], ["paved", "map"],
    "a move inside the hex keeps the road the last step walked");
  await drag(token, id, CELL, 0);
  assert.equal(getFormation(id).travel.map.road, null, "the next hex reads its own: no road is drawn here");
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

// A move the active GM's client is drawing crosses into the zone it ends in.
// See docs/formation/DECISIONS.md, "The ground under the party is read at the
// token's stored corner".
{
  const scene = makeScene("S.zone.drawn", { kind: "hex", miles: 7 });
  const token = makeToken(scene, "t.zone.drawn");
  const id = makeFormation(scene, token);
  // Inside only at the corner the move ends on: neither of its coordinates
  // alone, with the other at the start, reaches the zone.
  const moor = makeZone(scene, "Moor", { x: CELL, y: CELL, width: 8 * CELL, height: 8 * CELL }, { journeyCadence: "entry" });
  token._source = { x: CELL, y: CELL };
  const r = await observe(() => journey.onPartyTokenMoved(token, id));
  assert.equal(r.result.zoneEntered, true, "a drawn move crosses into the zone where it put the party");
  assert.deepEqual(getFormation(id).clock.zoneIds, [moor.id], "and the record keeps it");
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

/* -------------------------------------------- */
/*  Hours spent on any activity                 */
/* -------------------------------------------- */

{
  const id = makeFormation(null, null, { day: { activities: ["hunt", "search", "hunt", "forage"] } });
  const one = await observe(() => journey.spendActivityHours(id, ["hunt"]));
  assert.equal(one.seconds, 3600, "one slot's hour runs the clock");
  assert.deepEqual(travelOf(getFormation(id)).day.done, [true, false, false, false], "the first open slot of the kind is marked");

  const all = await observe(() => journey.spendActivityHours(id, ["hunt", "forage"], { all: true }));
  assert.equal(all.seconds, 2 * 3600, "every open slot of the kinds runs the clock, the already-done one excluded");
  assert.deepEqual(travelOf(getFormation(id)).day.done, [true, false, true, true]);
  assert.equal(travelOf(getFormation(id)).day.secondsAdvanced, 3 * 3600);
  assert.equal(travelOf(getFormation(id)).day.hours, 0, "the march's hours stay untouched");

  const none = await observe(() => journey.spendActivityHours(id, ["hunt", "forage"], { all: true }));
  assert.equal(none.seconds, 0, "with all, a day with none left advances nothing");
  assert.equal(travelOf(getFormation(id)).day.secondsAdvanced, 3 * 3600);
  const idle = await observe(() => journey.spendActivityHours(id, [], { all: true }));
  assert.equal(idle.seconds, 0, "and no kinds is no hours");
}

/* -------------------------------------------- */
/*  Managing traps at End Day                   */
/* -------------------------------------------- */

{
  const withTraps = (cell) => registerTable({
    id: "travel",
    tables: { encounterFrequency: { ...TABLE.tables.encounterFrequency, managingTraps: { borderlands: cell } } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const trapCards = (cards) => cards.filter((c) => keyOf(c.activity) === "ACKS-FORMATION.travel.enc.activity.traps").length;
  const carryOf = (id) => travelOf(getFormation(id)).trapsCarry;
  const roll = (id, entry) => observe(() => rollDayEncounters(getFormation(id), { dayKind: "march", activities: [], ...entry }));

  withTraps({ kind: "perAttempt", per: 3 });
  const id = makeFormation(null, null);
  let r = await roll(id, { traps: 7 });
  assert.equal(trapCards(r.cards), 2, "seven traps at three per throw owe two throws");
  assert.equal(carryOf(id), 1, "and the remainder carries");

  r = await roll(id, { traps: 5 });
  assert.equal(trapCards(r.cards), 2, "the carry joins the next day's traps: six owes two");
  assert.equal(carryOf(id), 0);

  r = await roll(id, { traps: 2 });
  assert.equal(trapCards(r.cards), 0, "a day short of a batch owes nothing");
  assert.equal(carryOf(id), 2, "and carries all of it");

  const board = makeFormation(null, null, { day: { traps: 4 } });
  r = await roll(board, {});
  assert.equal(trapCards(r.cards), 1, "an entry that states no count falls back to the board's");
  assert.equal(carryOf(board), 1);

  withTraps({ kind: "perAttempt" });
  const single = makeFormation(null, null);
  r = await roll(single, { traps: 3 });
  assert.equal(trapCards(r.cards), 3, "with no batch size each trap is a throw");
  assert.equal(carryOf(single), 0);

  withTraps(null);
  const stale = makeFormation(null, null, { travel: { trapsCarry: 2 } });
  r = await roll(stale, { traps: 9 });
  assert.equal(trapCards(r.cards), 0, "a stated none owes nothing");
  assert.equal(carryOf(stale), 0, "and clears what was carried");

  registerFrequency();
  const absent = makeFormation(null, null, { travel: { trapsCarry: 2 } });
  r = await roll(absent, { traps: 9 });
  assert.equal(trapCards(r.cards), 0, "a table that names no traps cell owes none");
  assert.equal(carryOf(absent), 2, "and leaves the carry alone");
}

/* -------------------------------------------- */
/*  The sky on the encounter card               */
/* -------------------------------------------- */

{
  registerTable({
    id: "weather",
    tables: { conditionEffects: { rainy: { throws: { missile: -3, listening: -5 }, visibilityFeet: 90 }, windy: { dust: { terrains: ["desert"], speed: 0.5 } } } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  registerTable({ id: "encounters", tables: { visibility: { daylight: 500, formationScale: [] } } },
    { priority: PRIORITY.WORLD, source: "test" });
  const id = makeFormation(null, null, { travel: { ground: "grassland", weather: { precipitation: "rainy" } } });
  const r = await observe(() => postEncounterThrow(getFormation(id), { activity: "travel" }));
  const card = r.cards.at(-1);
  assert.deepEqual(card.effects.map((e) => e.value), ["-3", "-5"], "the missile and listening penalties ride the card as chips");
  assert.equal(card.visible, 90, "and the sky's ceiling limits the sighting distance");

  const clear = makeFormation(null, null, { travel: { ground: "grassland", weather: { precipitation: "clear" } } });
  const c = (await observe(() => postEncounterThrow(getFormation(clear), { activity: "travel" }))).cards.at(-1);
  assert.deepEqual(c.effects, [], "a fair sky puts nothing on the card");
  assert.ok(c.visible > 90, "and leaves the daylight distance as it was");
  resetTables();
  registerFrequency();
}

/* -------------------------------------------- */
/*  Who saw whom, and what the message keeps    */
/* -------------------------------------------- */

{
  registerTable({
    id: "weather",
    tables: { conditionEffects: { rainy: { visibilityFeet: 90 } } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  registerTable({
    id: "encounters",
    tables: { visibility: { daylight: 500, formationScale: [] }, evasion: { grassland: [{ min: null, max: null, target: 9 }] } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const thrown = {
    outcome: "monster",
    distance: { ok: true, feet: 240, dice: "2d6", mult: 30 },
  };

  // Under a clear sky the distance stands, and the card says each side sees the other.
  const clear = makeFormation(null, null, { travel: { ground: "grassland", weather: { precipitation: "clear" } } });
  const open = await observe(() => postEncounterCard(getFormation(clear), thrown, { terrain: "grassland", activity: "travel", night: false, hex: { label: "B4" } }));
  const card = open.cards.at(-1);
  assert.equal(card.sight, true, "a terrain and a thrown distance give the card its sight lines");
  assert.equal(card.start, 240, "inside the sky's reach the encounter opens where it was thrown");
  assert.equal(card.startCapped, false);
  assert.deepEqual([card.partySees, card.monstersSee], [true, true]);
  const { when, ...kept } = open.chat.at(-1).flags["acks-extras"].encounter;
  assert.deepEqual(kept, {
    formationId: clear, hex: "B4", activity: "travel", night: false, terrain: "grassland", outcome: "monster",
    creature: null, distance: 240, start: 240, partySees: true, monstersSee: true,
    light: "daylight", evasion: 9,
  }, "the message carries every fact the card printed");
  assert.deepEqual(when.map((w) => w.key), ["mile"], "and the keys of the lines that placed it in its period");
  assert.ok(when[0].n >= 1 && when[0].n <= TABLE_MILES, "the line's die is within the cadence's miles");
  assert.equal(open.result, open.chat.at(-1), "the card hands back the message it created");

  // A rainy sky's ceiling pulls the opening in, and the card prints that distance.
  const rain = makeFormation(null, null, { travel: { ground: "grassland", weather: { precipitation: "rainy" } } });
  const wet = await observe(() => postEncounterCard(getFormation(rain), thrown, { terrain: "grassland", activity: "travel", night: true }));
  assert.equal(wet.cards.at(-1).start, 90, "the sky's ceiling is where the encounter opens");
  assert.equal(wet.cards.at(-1).startCapped, true, "and the card says it opened short of the thrown distance");
  const keptWet = wet.chat.at(-1).flags["acks-extras"].encounter;
  assert.deepEqual([keptWet.distance, keptWet.start, keptWet.night, keptWet.hex], [240, 90, true, null]);

  // With no terrain picked nothing is thrown or seen, and the message still says so.
  const bare = await observe(() => postEncounterCard(getFormation(clear), { outcome: "none" }, { terrain: "", activity: "travel", night: false }));
  assert.equal(bare.cards.at(-1).sight, false);
  const keptBare = bare.chat.at(-1).flags["acks-extras"].encounter;
  assert.deepEqual([keptBare.terrain, keptBare.distance, keptBare.start, keptBare.partySees, keptBare.evasion], [null, null, null, null, null]);

  // The throw's own chain carries the message it posted.
  const chain = await postEncounterThrow(getFormation(clear), { activity: "travel" });
  assert.equal(chain.message, chat.at(-1), "postEncounterThrow keeps its chain and exposes the posted message on it");
  resetTables();
  registerFrequency();
}

/* -------------------------------------------- */
/*  The country rides the trace as a reading    */
/* -------------------------------------------- */

/* The map's reading of the hex a party walks into is cached as `travel.map`;
 * the trace never writes the record's own country keys; the walk's cadence is
 * the territory's the party arrives in; and the active GM's refresher re-reads
 * a repainted hex once per burst. Two territory rows of invented sizes tell the
 * two cadences apart; the painted values are the module's own keys. */
{
  const { countryRefresher } = await import("../scripts/formation/travel.mjs");
  const { patchFormation } = await import("../scripts/formation/formation-model.mjs");
  const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
  resetTables();
  registerTable({
    id: "travel",
    tables: {
      encounterFrequency: {
        traveling: {
          borderlands: { kind: "perHex", mileHex: TABLE_MILES },
          outlands: { kind: "perHex", mileHex: 2 * TABLE_MILES },
        },
      },
    },
  }, { priority: PRIORITY.WORLD, source: "test" });

  /**
   * A region painting one layer's value on these hexes; `state` is repainted
   * in place. A painted region carries no behaviour, so no zone reads it.
   */
  const painted = (flag, value, hexes) => {
    const state = { value, hexes };
    return {
      state,
      behaviors: [],
      getFlag: (_ns, key) => (key === flag ? state.value : key === `${flag}Hexes` ? state.hexes : undefined),
    };
  };
  const defaults = (ns, key) =>
    (ns === MODULE_ID && key === "battlemap" ? { country: { ground: "grasslandSteppe", territory: "borderlands" } } : undefined);

  const scene = makeScene("S.country", { kind: "hex", miles: TABLE_MILES });
  const forest = painted("terrain", "forestTaiga", ["0:1"]);
  scene.regions.push(forest, painted("territory", "outlands", ["0:1"]));
  scene.getFlag = defaults;
  const token = makeToken(scene, "t.country");
  const id = makeFormation(scene, token, { travel: { ground: "desert" } });
  const before = travelOf(getFormation(id));
  assert.deepEqual([before.ground, before.provenance.ground], ["desert", "declared"],
    "with nothing read yet, the record's declaration answers");

  const r = await drag(token, id, CELL, 0);
  const stored = getFormation(id).travel;
  assert.deepEqual([stored.map.sceneId, stored.map.i, stored.map.j], ["S.country", 0, 1], "the reading names its scene and hex");
  assert.deepEqual(
    [stored.map.ground, stored.map.encounterTerrain, stored.map.territory, stored.map.climate],
    ["forest", "forestTaiga", "outlands", null], "the hex's painted country is cached");
  assert.deepEqual([stored.map.source.ground, stored.map.source.territory], ["map", "map"]);
  assert.equal(stored.ground, "desert", "the trace writes the reading only: the declaration stays as it was");
  for (const key of ["encounterTerrain", "road", "following"]) assert.ok(!(key in stored), `and it writes no ${key}`);
  assert.equal(stored.territory, "borderlands", "nor the record's own territory");
  const after = travelOf(getFormation(id));
  assert.deepEqual([after.ground, after.provenance.ground], ["forest", "map"], "the map stands over the declaration");
  assert.deepEqual([after.territory, after.provenance.territory], ["outlands", "map"]);
  assert.equal(r.result.units, 0, "seven miles into a country thrown every fourteen owes nothing yet");
  assert.equal(r.hooks.length, 0, "the cadence is the country arrived in, not the one left");
  assert.ok(approx(after.day.cadenceCarry, TABLE_MILES), "and the miles are carried toward its throw");

  const back = await drag(token, id, 0, 0);
  assert.equal(back.hooks.length, 1, "walking back into the borderlands owes the borderlands' throw");
  assert.equal(back.hooks[0].cadence, "grid", "counted by the hex, the size of that country's distance");
  const home = travelOf(getFormation(id));
  assert.deepEqual([home.ground, home.provenance.ground], ["grassland", "scene"],
    "an unpainted hex reads the scene's default, which stands over the declaration");
  assert.deepEqual([home.territory, home.provenance.territory], ["borderlands", "scene"]);

  // The Judge repaints the hex the party stands in, and the active GM's
  // refresher re-reads it once per burst.
  const timers = [];
  const changed = [];
  let primary = true;
  const refresh = countryRefresher({
    wait: 5,
    then: (ids) => changed.push(ids),
    schedule: (fn, ms) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.live = false; },
    primary: () => primary,
  });
  const runTimers = async () => {
    for (const timer of timers.splice(0)) if (timer.live) timer.fn();
    for (let n = 0; n < 5; n++) await new Promise((resolve) => setImmediate(resolve));
  };

  forest.state.hexes = ["0:1", "0:0"];
  refresh("S.country");
  refresh("S.country");
  refresh("S.country", { walls: true });
  assert.equal(timers.filter((t) => t.live).length, 1, "a burst of changes is one re-read");
  assert.equal(timers.at(-1).ms, 5, "run once the burst has been quiet for the wait");
  await runTimers();
  assert.deepEqual(changed, [[id]], "the party whose hex now reads differently is named");
  const repainted = getFormation(id).travel.map;
  assert.deepEqual([repainted.ground, repainted.source.ground], ["forest", "map"]);

  refresh("S.country");
  await runTimers();
  assert.deepEqual(changed.at(-1), [], "a re-read that finds nothing new writes nothing");

  // A road the last step walked is one a re-read at the token cannot see: a
  // burst no wall was part of keeps it, and one that touched a wall reads afresh.
  await patchFormation(id, (record) => {
    record.travel.map = { ...record.travel.map, road: "earth", source: { ...record.travel.map.source, road: "map" } };
  });
  forest.state.value = "desertSandy";
  refresh("S.country");
  await runTimers();
  let map = getFormation(id).travel.map;
  assert.deepEqual([map.ground, map.road], ["desert", "earth"], "a repaint re-reads the hex and keeps the walked road");
  refresh("S.country", { walls: true });
  await runTimers();
  map = getFormation(id).travel.map;
  assert.equal(map.road, null, "a burst that touched a wall reads the lines afresh");

  primary = false;
  refresh("S.country", { walls: true });
  assert.equal(timers.length, 0, "only the active GM's client re-reads");
  primary = true;
  refresh(null);
  refresh("");
  assert.equal(timers.length, 0, "a change on no scene reads nothing");

  // The refresh reads the parties on the scene it was given and no other, and
  // a seat by hand off a hex grid caches the reading and names no hex.
  const { seatJourneyHex, refreshCountryOn } = await import("../scripts/formation/travel.mjs");
  {
    const sq = makeScene("S.seat.sq", { kind: "square", miles: TABLE_MILES });
    sq.getFlag = defaults;
    const tk = makeToken(sq, "t.seat.sq", CELL, 0);
    const fid = makeFormation(sq, tk, { hex: { label: "B2", i: 4, j: 4 } });
    const elsewhere = makeScene("S.seat.other", { kind: "hex", miles: TABLE_MILES });
    elsewhere.getFlag = defaults;
    const fid2 = makeFormation(elsewhere, makeToken(elsewhere, "t.seat.other"));
    assert.deepEqual(await refreshCountryOn("S.seat.other"), [fid2], "only the parties on that scene are re-read");
    assert.equal(getFormation(fid).travel.map, undefined, "a party on another scene is not");
    await seatJourneyHex(tk, fid);
    const tv = getFormation(fid).travel;
    assert.deepEqual([tv.map.sceneId, tv.map.i, tv.map.j, tv.map.ground], ["S.seat.sq", null, null, "grassland"],
      "off a hex grid the seat caches the reading and names no hex");
    assert.deepEqual([tv.hex.label, tv.hex.i, tv.hex.j], ["B2", 4, 4], "and leaves the hex the record held");
  }

  // Off a hex grid the reading is cached all the same, and names no hex.
  const free = makeScene("S.country.free", { kind: "gridless", miles: TABLE_MILES, measure: false });
  free.getFlag = defaults;
  const freeToken = makeToken(free, "t.country.free");
  const freeId = makeFormation(free, freeToken);
  await drag(freeToken, freeId, 140, 0);
  const freeMap = getFormation(freeId).travel.map;
  assert.deepEqual([freeMap.sceneId, freeMap.i, freeMap.j], ["S.country.free", null, null]);
  assert.deepEqual([freeMap.territory, freeMap.source.territory], ["borderlands", "scene"]);

  resetTables();
  registerFrequency();
}

/* -------------------------------------------- */
/*  The day's navigation throw                  */
/* -------------------------------------------- */

/* Made once a calendar day, on the active GM's client, at the day's first
 * step off a road. The die is the mock's rigged face against an invented
 * target; the encounter throws are switched off so the only card a step posts
 * is the navigation card. */
const NAV_TARGET = 12;
/** The 24-hour calendar `setClock` keeps, in seconds. */
const CALENDAR_DAY = 24 * 3600;
const today = () => Math.floor(worldClock.worldTime / CALENDAR_DAY);
/** Six in the morning of the next calendar day: a step's hours stay inside it. */
const nextMorning = () => {
  worldClock.worldTime = (today() + 1) * CALENDAR_DAY + 6 * 3600;
};
const navCards = (r) => r.chat.filter((m) => String(m.content).includes("nav.title"));
const navOf = (id) => travelOf(getFormation(id)).navigation;
/** Every episode a failure asked to open: `[formationId, options]`. */
const opened = [];
const opener = async (formation, options) => {
  opened.push([formation.id, options]);
  return { began: true };
};
/** A drag as the module's hook takes it, with the episode opener stubbed. */
async function step(token, formationId, x, y, begin = opener) {
  token.x = x;
  token.y = y;
  return observe(() => journey.onJourneyTokenMoved(token, formationId, { begin }));
}
/** A journeying party on its own hex scene, on grassland, standing at A1. */
function trackless(name, travel = {}) {
  const scene = makeScene(`S.nav.${name}`, { kind: "hex", miles: TABLE_MILES });
  const token = makeToken(scene, `t.nav.${name}`);
  const id = makeFormation(scene, token, { travel: { ground: "grassland", ...travel } });
  return { scene, token, id };
}

{
  const { postNavigationThrow, beginFromCard, installNavigationCardActions } = await import("../scripts/formation/navigation-card.mjs");
  const { navigationOwed, journeyDayKey } = await import("../scripts/formation/travel.mjs");
  /** Today's key for a formation: the calendar day and its End-day count. */
  const dayKey = (id) => journeyDayKey(travelOf(getFormation(id)));
  resetTables();
  registerTable({ id: "travel", tables: { ...TABLE.tables, gettingLost: { grassland: NAV_TARGET } } },
    { priority: PRIORITY.WORLD, source: "test" });
  settings.travelEncounters = false;
  setClock(12);

  // Only the active GM's client throws.
  const { token, id } = trackless("day");
  nextMorning();
  const elsewhere = await step(token, id, CELL, 0);
  assert.ok(elsewhere.result.miles > 0, "the step spent its miles");
  assert.equal(navCards(elsewhere).length, 0, "a client that is not the active GM's throws nothing");
  assert.equal(navOf(id).thrownOn, null, "and claims no day");
  game.users.activeGM = { isSelf: true };

  // The day's first step off a road throws, once.
  rollFace = 15;
  const first = await step(token, id, 2 * CELL, 0);
  assert.equal(navCards(first).length, 1, "the day's first step off a road throws");
  const [card] = navCards(first);
  assert.deepEqual(card.whisper, ["gm1"], "whispered to the Judge");
  assert.match(card.content, /nav\.kept/, "a success keeps the way");
  const thrown = { day: dayKey(id), count: 0, hexLabel: "C1", target: NAV_TARGET, total: 15, natural: 15, success: true, by: "step" };
  assert.equal(navOf(id).thrownOn, dayKey(id), "the day thrown on is the calendar day with the End-day count");
  assert.equal(dayKey(id), `${today()}:0`, "which is the clock's day and a count of none");
  assert.deepEqual(navOf(id).history, [thrown], "the throw is kept, in the hex it was made in, on the count it was made on");
  assert.deepEqual(navOf(id).lastResult, thrown);
  assert.equal(navigationOwed(getFormation(id)).state, "thrown");
  assert.deepEqual(opened, [], "a success opens nothing");

  rollFace = 2;
  const second = await step(token, id, 3 * CELL, 0);
  assert.equal(navCards(second).length, 0, "a second step the same day throws nothing");
  assert.equal(navOf(id).history.length, 1);

  // The next calendar day's first step throws again.
  nextMorning();
  rollFace = 15;
  const next = await step(token, id, 4 * CELL, 0);
  assert.equal(navCards(next).length, 1, "the next calendar day owes its own throw");
  assert.equal(navOf(id).thrownOn, dayKey(id), "and thrownOn rolls over to it");
  assert.deepEqual(navOf(id).history.map((e) => e.day), [dayKey(id), `${today() - 1}:0`], "newest first");

  // A step that crosses midnight counts for the day it began in: the new
  // day's throw waits for the next step.
  const night = trackless("night");
  nextMorning();
  worldClock.worldTime = today() * CALENDAR_DAY + 23 * 3600 + 30 * 60;
  const beganIn = dayKey(night.id);
  rollFace = 15;
  const crossing = await step(night.token, night.id, 2 * CELL, 0);
  assert.ok(crossing.seconds > 30 * 60, "the step's hours ran past midnight");
  assert.equal(dayKey(night.id), `${today()}:0`, "the clock stands in the next day");
  assert.notEqual(dayKey(night.id), beganIn);
  assert.equal(navCards(crossing).length, 1, "the step threw");
  assert.equal(navOf(night.id).thrownOn, beganIn, "for the day it began in");
  const afterMidnight = await step(night.token, night.id, 3 * CELL, 0);
  assert.equal(navCards(afterMidnight).length, 1, "and the next step owes the new day's throw");
  assert.equal(navOf(night.id).thrownOn, dayKey(night.id));

  // A step on a road throws nothing.
  const road = trackless("road", { override: { road: "paved" } });
  nextMorning();
  const paved = await step(road.token, road.id, CELL, 0);
  assert.equal(navCards(paved).length, 0, "a step on a road throws nothing");
  assert.equal(navOf(road.id).thrownOn, null, "and claims no day");
  assert.deepEqual(navigationOwed(getFormation(road.id)), { state: "following", day: dayKey(road.id), route: "road", road: "paved" });

  // A failure opens the episode where the party stands.
  const lost = trackless("lost");
  rollFace = 5;
  const fail = await step(lost.token, lost.id, CELL, 0);
  assert.deepEqual(opened, [[lost.id, { day: 0, anchor: { i: 0, j: 1 }, trueOffset: { i: 0, j: 1 } }]],
    "a failure opens the episode, the truth and the belief in the hex the party stands in");
  const [failed] = navCards(fail);
  assert.match(failed.content, /nav\.lost/);
  assert.match(failed.content, /nav\.opened/, "the card says the episode is open");
  assert.doesNotMatch(failed.content, /acks-extras-nav-begin/, "and offers no Begin");
  assert.equal(navOf(lost.id).lastResult.success, false);
  assert.equal(navOf(lost.id).lastResult.natural, 5);

  // A refused opening leaves Begin on the card.
  const refused = trackless("refused");
  const declined = await step(refused.token, refused.id, CELL, 0, async () => null);
  const [offer] = navCards(declined);
  assert.match(offer.content, /nav\.notOpened/, "the card says the episode did not open");
  assert.match(offer.content, /acks-extras-nav-begin/, "and offers Begin");
  assert.doesNotMatch(offer.content, /nav\.noHex/);

  // A party on no traced hex: the card says so, and still offers Begin.
  const untraced = trackless("untraced");
  settings.formations[untraced.id].travel.hex = { label: "", i: null, j: null };
  const sceneWas = untraced.scene.grid.type;
  untraced.scene.grid.type = CONST.GRID_TYPES.SQUARE;
  const nowhere = await step(untraced.token, untraced.id, CELL, 0);
  untraced.scene.grid.type = sceneWas;
  assert.match(navCards(nowhere)[0].content, /nav\.noHex/, "the card names the missing hex");
  assert.match(navCards(nowhere)[0].content, /acks-extras-nav-begin/, "and offers Begin for when there is one");
  assert.equal(opened.length, 1, "nothing asked to open");

  // Begin from the card opens at the belief, exactly as the failure would
  // have: the shadow on the party's hex, no face chosen.
  const warned = [];
  const warnWas = ui.notifications.warn;
  ui.notifications.warn = (message) => warned.push(String(message));
  const begun = await beginFromCard(getFormation(refused.id), { begin: opener });
  assert.deepEqual(begun, { began: true });
  assert.deepEqual(opened.at(-1), [refused.id, { day: 0, anchor: { i: 0, j: 1 }, trueOffset: { i: 0, j: 1 } }],
    "the truth and the belief in the hex the party stands in");
  assert.deepEqual(warned, [], "nothing to warn of");
  assert.equal(await beginFromCard(getFormation(untraced.id), { begin: opener }), null, "no hex, no opening");
  assert.ok(warned.some((m) => m.includes("lost.needHex")), "and the Judge is told why");
  const sealed = trackless("sealed", { lost: { phase: "astray", sceneId: "S.nav.sealed" } });
  assert.equal(await beginFromCard(getFormation(sealed.id), { begin: opener }), null, "an episode already open: nothing");
  assert.equal(opened.length, 2, "and nothing asked to open");

  // The card's binding guards the press the same way, and routes it to the real opener.
  const onWas = Hooks.on;
  let onRender = null;
  Hooks.on = (name, fn) => {
    if (name === "renderChatMessageHTML") onRender = fn;
  };
  installNavigationCardActions();
  Hooks.on = onWas;
  assert.equal(typeof onRender, "function", "the card's buttons are bound on render");
  const press = async (formationId) => {
    const button = { dataset: { formationId }, disabled: false, addEventListener: (_event, fn) => { button.handler = fn; } };
    onRender(null, { nodeType: 1, querySelectorAll: (selector) => (selector === ".acks-extras-nav-begin" ? [button] : []) });
    button.handler({ preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return button;
  };
  warned.length = 0;
  const pressedSealed = await press(sealed.id);
  assert.equal(pressedSealed.disabled, false, "a press on a card whose episode has opened since does nothing");
  assert.deepEqual(warned, [], "and warns of nothing");
  const pressedRefused = await press(refused.id);
  assert.ok(warned.some((m) => m.includes("lost.viewScene")), "a press with no episode open reaches the opener, which wants the scene viewed");
  assert.equal(pressedRefused.disabled, false, "a refused opening leaves the button for another press");
  ui.notifications.warn = warnWas;

  // A success while astray offers the realisation, and opens nothing.
  const astray = trackless("astray", { lost: { phase: "astray", sceneId: "S.nav.astray" } });
  rollFace = 15;
  const kept = await step(astray.token, astray.id, CELL, 0);
  const [realise] = navCards(kept);
  assert.match(realise.content, /nav\.astrayKept/);
  assert.match(realise.content, /acks-extras-nav-realise/, "a success while astray offers They realise they are lost");
  assert.equal(opened.length, 2, "and asks to open nothing");
  const deeper = trackless("deeper", { lost: { phase: "astray", sceneId: "S.nav.deeper" } });
  rollFace = 5;
  const strayed = await step(deeper.token, deeper.id, CELL, 0);
  assert.match(navCards(strayed)[0].content, /nav\.astrayLost/);
  assert.doesNotMatch(navCards(strayed)[0].content, /acks-extras-nav-(begin|realise)/, "a failure while astray offers nothing");
  assert.equal(opened.length, 2, "and opens no second episode");
  rollFace = 15;

  // The Judge's Throw now is the day's throw.
  const judge = trackless("judge");
  nextMorning();
  const pressed = await observe(() => postNavigationThrow(getFormation(judge.id), { by: "judge", begin: opener }));
  assert.equal(navCards(pressed).length, 1);
  assert.equal(navOf(judge.id).lastResult.by, "judge");
  assert.equal(navOf(judge.id).thrownOn, dayKey(judge.id), "a throw by hand counts as the day's");
  const after = await step(judge.token, judge.id, CELL, 0);
  assert.equal(navCards(after).length, 0, "so the day's first step owes none");

  // A hex entered by hand is a step too.
  const byHand = trackless("hand");
  nextMorning();
  const named = await observe(() => journey.nextHex(byHand.id, "B1", { begin: opener }));
  assert.equal(navCards(named).length, 1, "the next hex by hand owes the day's throw");
  assert.equal(navOf(byHand.id).lastResult.hexLabel, "B1", "thrown in the hex named");

  rollFace = 10;
  game.users.activeGM = null;
  settings.travelEncounters = true;
  resetTables();
  registerFrequency();
}

/* -------------------------------------------- */
/*  A drag walks the truth                      */
/* -------------------------------------------- */

/* While a lost episode is open the party token is the belief: each hex a drag
 * enters moves the shadow one step from wherever it stands. The mock lattice
 * is square cells under a hex grid type; the direct path samples the line. */
/** Give a mock scene the centre points and the direct path the walk reads. */
function withLattice(scene) {
  const grid = scene.grid;
  grid.getCenterPoint = ({ i, j }) => ({ x: j * CELL + CELL / 2, y: i * CELL + CELL / 2 });
  grid.getDirectPath = ([a, b]) => {
    const s = grid.getOffset(a);
    const e = grid.getOffset(b);
    const n = Math.max(Math.abs(e.i - s.i), Math.abs(e.j - s.j)) || 1;
    return Array.from({ length: n + 1 }, (_, k) => ({ i: s.i + Math.round(((e.i - s.i) * k) / n), j: s.j + Math.round(((e.j - s.j) * k) / n) }));
  };
  return scene;
}
/**
 * A real lattice of hex rows on a mock scene: pointy-topped cells, every odd
 * row shoved half a hex right, centres and the nearest cell read off the same
 * geometry, and a direct path that walks one row at a time.
 */
function withHexLattice(scene) {
  const grid = scene.grid;
  const R = CELL / 2;
  const W = Math.sqrt(3) * R;
  const V = 1.5 * R;
  grid.getCenterPoint = ({ i, j }) => ({ x: (j + 0.5 + (i % 2 ? 0.5 : 0)) * W, y: R + i * V });
  grid.getOffset = (p) => {
    const i = Math.round((p.y - R) / V);
    return { i, j: Math.round(p.x / W - 0.5 - (i % 2 ? 0.5 : 0)) };
  };
  grid.getDirectPath = ([a, b]) => {
    const s = grid.getOffset(a);
    const e = grid.getOffset(b);
    const path = [s];
    for (let i = s.i + 1; i <= e.i; i++) path.push({ i, j: e.j });
    return path;
  };
  return scene;
}
/** A hidden shadow for `formationId` at pixel (x, y), recording every move. */
function makeShadow(scene, formationId, x, y) {
  const shadow = makeToken(scene, `${scene.id}.shadow`, x, y);
  shadow.getFlag = (_ns, key) => (key === "shadowFor" ? formationId : undefined);
  shadow.moves = [];
  shadow.update = async (data) => {
    shadow.moves.push(data);
    Object.assign(shadow, data);
    return shadow;
  };
  return shadow;
}

{
  const { trueTravelOf, journeyDayKey } = await import("../scripts/formation/travel.mjs");
  const at = (scene, i, j) => scene.grid.getCenterPoint({ i, j });

  // The path, pure.
  const path = withLattice(makeScene("S.truth.path", { kind: "hex", miles: TABLE_MILES }));
  assert.deepEqual(journey.astrayPath(path, { from: at(path, 0, 0), to: at(path, 0, 3), truth: at(path, 2, 5) }), [
    { believed: { i: 0, j: 1 }, truth: { i: 2, j: 6 } },
    { believed: { i: 0, j: 2 }, truth: { i: 2, j: 7 } },
    { believed: { i: 0, j: 3 }, truth: { i: 2, j: 8 } },
  ], "each hex entered moves the truth by that hex's own displacement");
  assert.deepEqual(journey.astrayPath(path, { from: at(path, 0, 0), to: { x: CELL - 1, y: CELL - 1 }, truth: at(path, 2, 5) }), [],
    "a drag inside one hex walks nothing");
  assert.deepEqual(journey.astrayPath(path, { from: at(path, 0, 0), to: at(path, 0, 3) }), [], "with no truth there is nothing to walk");
  delete path.grid.getDirectPath;
  assert.deepEqual(journey.astrayPath(path, { from: at(path, 0, 0), to: at(path, 0, 3), truth: at(path, 2, 5) }),
    [{ believed: { i: 0, j: 3 }, truth: { i: 2, j: 8 } }], "a grid with no direct path walks the drag as one step");

  // The same walk on a real lattice of hex rows: the truth takes the drag's
  // displacement in pixels, which on a shoved row is not the drag's offset
  // delta — two rows down from an even row lands a truth on an odd row one
  // column over, as the map does.
  const hexed = withHexLattice(makeScene("S.truth.rows", { kind: "hex", miles: TABLE_MILES }));
  const h = (i, j) => hexed.grid.getCenterPoint({ i, j });
  assert.deepEqual(journey.astrayPath(hexed, { from: h(0, 0), to: h(2, 0), truth: h(1, 5) }), [
    { believed: { i: 1, j: 0 }, truth: { i: 2, j: 6 } },
    { believed: { i: 2, j: 0 }, truth: { i: 3, j: 5 } },
  ], "on hex rows the truth follows the pixels, not the offsets");

  // An astray drag, through the module's own dispatcher and the real walk.
  game.users.activeGM = { isSelf: true };
  const scene = withLattice(makeScene("S.truth.drag", { kind: "hex", miles: TABLE_MILES }));
  const token = makeToken(scene, "t.truth.drag");
  const id = makeFormation(scene, token, { travel: { ground: "grassland", lost: { phase: "astray", sceneId: scene.id } } });
  settings.formations[id].actorId = `a${id}`;
  const shadow = makeShadow(scene, id, 5 * CELL, 2 * CELL);
  nextMorning();
  settings.formations[id].travel.navigation = { thrownOn: journeyDayKey(travelOf(getFormation(id))) };
  await drag(token, id, 3 * CELL, 0);
  assert.equal(shadow.moves.length, 3, "the truth walks once per hex the drag entered");
  assert.deepEqual([shadow.x, shadow.y], [8 * CELL, 2 * CELL], "and ends moved by the token's displacement");
  const astray = travelOf(getFormation(id));
  assert.deepEqual([astray.hex.i, astray.hex.j], [0, 3], "the token's hex is the belief");
  assert.deepEqual(astray.lost.faked, ["0:1", "0:2", "0:3"], "each hex the party believed it entered is recorded");
  assert.deepEqual(astray.lost.observations, [
    { at: "2:6", shown: "0:1" }, { at: "2:7", shown: "0:2" }, { at: "2:8", shown: "0:3" },
  ], "beside where it truly stood");
  const truth = trueTravelOf(getFormation(id)).hex;
  assert.deepEqual([truth.label, truth.i, truth.j], ["I3", 2, 8], "the encounter column reads the true hex");

  // The shadow's hex painted, and the party token placed on another scene
  // mid-episode: the truth is still read where the shadow stands.
  scene.regions.push({ behaviors: [], getFlag: (_ns, key) => (key === "terrain" ? "hills" : key === "terrainHexes" ? ["2:8"] : undefined) });
  const underShadow = trueTravelOf(getFormation(id));
  assert.deepEqual([underShadow.ground, underShadow.provenance.ground], ["hills", "map"], "the painted ground under the shadow");
  const elsewhere = makeScene("S.truth.elsewhere", { kind: "hex", miles: TABLE_MILES });
  settings.formations[id].sceneId = elsewhere.id;
  const away = trueTravelOf(getFormation(id));
  assert.deepEqual([away.ground, away.provenance.ground, away.hex.label], ["hills", "map", "I3"],
    "read on the episode's scene, whatever scene the party token was placed on");
  settings.formations[id].sceneId = scene.id;
  scene.regions.pop();

  // Two moves at once: the second waits for the first, measures from the
  // baseline the first wrote, and walks the truth from where the first left
  // the shadow — not both from the same place.
  const movesBefore = shadow.moves.length;
  token.x = 4 * CELL;
  const firstMove = journey.onPartyTokenMoved(token, id);
  token.x = 5 * CELL;
  const secondMove = journey.onPartyTokenMoved(token, id);
  await Promise.all([firstMove, secondMove]);
  assert.deepEqual([shadow.x, shadow.y], [10 * CELL, 2 * CELL], "the truth moved by the two hexes the token did, once");
  assert.equal(shadow.moves.length, movesBefore + 2, "one step per hex entered, none repeated");
  assert.deepEqual(travelOf(getFormation(id)).lost.faked, ["0:1", "0:2", "0:3", "0:4", "0:5"], "and each hex is recorded once");

  // Aware, the drag still walks the truth, and fakes nothing.
  settings.formations[id].travel.lost = { phase: "aware", sceneId: scene.id };
  await drag(token, id, 3 * CELL, CELL);
  assert.equal(shadow.moves.length, 7, "an aware party's drag walks the truth too: two hexes back and one down");
  assert.deepEqual([shadow.x, shadow.y], [8 * CELL, 3 * CELL]);

  // Only the active GM's client walks it.
  game.users.activeGM = null;
  await drag(token, id, 3 * CELL, 2 * CELL);
  assert.equal(shadow.moves.length, 7, "a client that is not the active GM's walks nothing");
  game.users.activeGM = { isSelf: true };

  // The walk itself, with the episode's writer stubbed.
  const pairs = [];
  let walks = 0;
  const walk = async (_formation, steps) => {
    walks++;
    pairs.push(...steps);
  };
  settings.formations[id].travel.lost = { phase: "astray", sceneId: scene.id };
  const walked = await journey.walkTheTruth(scene, token, getFormation(id), { from: { x: 0, y: 0 }, to: { x: 2 * CELL, y: CELL }, walk });
  assert.equal(walked, 2, "a diagonal drag of two hexes walks two");
  assert.equal(walks, 1, "in one call for the drag");
  assert.deepEqual(pairs, [
    { believedOffset: { i: 1, j: 1 }, trueOffset: { i: 4, j: 9 } },
    { believedOffset: { i: 1, j: 2 }, trueOffset: { i: 4, j: 10 } },
  ], "its steps once per hex, in order, from where the shadow stands");
  settings.formations[id].travel.lost = {};
  assert.equal(await journey.walkTheTruth(scene, token, getFormation(id), { from: { x: 0, y: 0 }, to: { x: CELL, y: 0 }, walk }), 0,
    "with no episode open the truth is the token");
  settings.formations[id].travel.lost = { phase: "astray", sceneId: scene.id };
  scene.tokens.delete(shadow.id);
  assert.equal(await journey.walkTheTruth(scene, token, getFormation(id), { from: { x: 0, y: 0 }, to: { x: CELL, y: 0 }, walk }), 0,
    "with no shadow there is nothing to move");
  assert.equal(pairs.length, 2);

  game.users.activeGM = null;
}

console.log("test-journey: OK (miles on hex/square/gridless, cadence by grid or miles, clock hours, pause, scale guard, next hex, token size, search hour, day end, dawn, zones: card, true position, entry, periods, the country's reading on the trace, the cadence arrived in, the GM's refresh, the day's navigation throw: once a day, off a road, on the active GM, a failure opens, the Judge's press, the truth a drag walks)");
