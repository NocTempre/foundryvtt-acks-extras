/**
 * A hex's stock, read and written (`scripts/formation/hex-stock-run.mjs`): the
 * true hex the party stands in, the one scene-flag key every write names, the
 * dialog inputs that become a stock, the finds and search credit, the Land
 * Surveying attempt with its three outcomes, the public line that carries
 * the same shape for a true and a false count, and the place made from a point.
 * Documents, dice and dialogs are stand-ins; names, dice, shares and figures
 * are this file's inventions (QQ names), so these tests prove the machinery
 * and never the book.
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

globalThis.foundry = {
  utils: { randomID: uid, deepClone: clone, escapeHTML: (s) => String(s) },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  data: {
    operators: { ForcedDeletion, ForcedReplacement },
    fields: new Proxy({}, { get: () => class FieldStub { constructor(...args) { this.args = args; } } }),
    regionBehaviors: { RegionBehaviorType: class {} },
  },
  applications: {
    api: { DialogV2: {}, ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} },
    handlebars: { renderTemplate: async (path, ctx) => { rendered.push([path, ctx]); return "<form></form>"; } },
  },
};
globalThis.CONST = { GRID_TYPES: { SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 } };
globalThis.CONFIG = { Actor: { dataModels: {} }, Item: { dataModels: {} }, RegionBehavior: { dataModels: {}, typeIcons: {} } };

const hooks = new Map();
globalThis.Hooks = {
  on: (name, fn) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
  once() {},
};

const rendered = [];
const dialogs = { wait: [], confirm: [] };
foundry.applications.api.DialogV2.wait = async (cfg) => { dialogs.waited = cfg; return dialogs.wait.shift() ?? null; };
foundry.applications.api.DialogV2.confirm = async () => dialogs.confirm.shift() ?? false;

const chat = [];
globalThis.ChatMessage = { create: async (data) => { chat.push(data); return data; } };
const notices = [];
globalThis.ui = { notifications: { warn: (m) => notices.push(["warn", m]), info: (m) => notices.push(["info", m]) } };

// A rigged d20: the unmodified die each throw lands on.
const formulas = [];
let nextNatural = 10;
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    const bonus = Number(/\+\s*(-?\d+)/.exec(this.formula)?.[1] ?? 0);
    this.dice = [{ total: nextNatural }];
    this.total = nextNatural + bonus;
    formulas.push(this.formula);
    return this;
  }
};

const made = { actors: [], tokens: [] };
const uuidMap = new Map();
globalThis.fromUuidSync = (u) => uuidMap.get(u) ?? null;
globalThis.Actor = {
  create: async (data) => {
    const actor = {
      ...data,
      uuid: `Actor.${uid()}`,
      getTokenDocument: async (extra) => ({ toObject: () => ({ name: data.name, ...extra }) }),
    };
    made.actors.push(actor);
    uuidMap.set(actor.uuid, actor);
    return actor;
  },
};

class Coll extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

/** A scene whose flag store applies updates the way Foundry's path expansion reads them. */
function makeScene(id, { hex = true, tokens = [] } = {}) {
  const flags = {};
  const scene = {
    id, uuid: `Scene.${id}`, name: `QQ Map ${id}`, flags, updates: [], tokens, created: [],
    grid: {
      size: 100,
      type: hex ? CONST.GRID_TYPES.HEXODDR : CONST.GRID_TYPES.SQUARE,
      getOffset: (p) => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
    },
    getFlag: (ns, key) => flags[ns]?.[key],
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        const [, ns, flag, ...rest] = parts;
        assert.equal(parts[0], "flags", "only flag writes are expected");
        const store = ((flags[ns] ??= {})[flag] ??= {});
        const key = rest.join(".");
        if (value instanceof ForcedDeletion) delete store[key];
        else store[key] = clone(value instanceof ForcedReplacement ? value.value : value);
      }
      return this;
    },
    async createEmbeddedDocuments(type, docs) {
      this.created.push([type, docs]);
      return docs;
    },
  };
  return scene;
}

const token = (x, y, extra = {}) => ({ id: uid(), x, y, width: 1, height: 1, actorId: "pa1", getFlag: () => undefined, ...extra });
const shadowOf = (formationId, x, y) =>
  token(x, y, { actorId: "shadow", getFlag: (ns, key) => (key === "shadowFor" ? formationId : undefined) });

const scenes = new Coll();
const actors = new Coll();
let formations = {};
globalThis.game = {
  user: { isGM: true },
  users: [{ id: "gm1", isGM: true }, { id: "p1", isGM: false }],
  time: { worldTime: 1000 },
  scenes,
  actors,
  settings: { get: () => formations },
  i18n: {
    localize: (k) => k,
    format: (k, data = {}) => `${k} ${JSON.stringify(data)}`,
  },
};

const surveyor = { id: "a1", items: [{ type: "ability", name: "Land Surveying", flags: {}, getFlag: () => undefined }] };
const bystander = { id: "a2", items: [] };
const mapActor = (a) => actors.set(a.id, a);

/* -------------------------------------------- */
/*  The module under test                       */
/* -------------------------------------------- */

const run = await import("../scripts/formation/hex-stock-run.mjs");
const { registerTable, resetTables, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { ENCOUNTERS_DOC } = await import("../scripts/formation/encounters.mjs");
const { SEARCHING_DOC } = await import("../scripts/formation/searching.mjs");

const face = (f, n) => (f - 0.5) / n;
const rig = (...values) => {
  const q = [...values];
  return () => (q.length ? q.shift() : 0.5);
};

const ENCOUNTER_TABLES = (extra = {}) => ({
  lairsPerHex: { grassland: "1d4" },
  settledLairShare: { civilized: 0.5 },
  lairSubstitution: [{ min: 1, max: 4, kind: "lair" }, { min: 5, max: 6, kind: "valuable" }],
  rarity: { unsettled: [{ min: null, max: 10, rarity: "common" }, { min: 11, max: null, rarity: "rare" }] },
  "monsters.grasslandFarm": {
    common: [{ min: null, max: null, name: "QQ Prowler" }],
    rare: [{ min: null, max: null, name: "QQ Terror" }],
  },
  terrainEncounters: { valuable: ["QQ V1"], dangerous: ["QQ D1"], unique: ["QQ U1"] },
  ...extra,
});
function register({ encounters = ENCOUNTER_TABLES(), searching = true } = {}) {
  resetTables();
  registerTable({ id: ENCOUNTERS_DOC, tables: encounters }, { priority: PRIORITY.WORLD, source: "test" });
  if (searching) {
    registerTable(
      { id: SEARCHING_DOC, tables: { surveyTarget: 17, surveyPerSearch: 3 } },
      { priority: PRIORITY.WORLD, source: "test" },
    );
  }
}

/** The party: on a hex scene, standing at the centre of cell 2:3 (label D3). */
function world({ hex = true, label = "", lost = null, tokens = null, members = [{ actorId: "a1" }] } = {}) {
  scenes.clear();
  actors.clear();
  mapActor(surveyor);
  mapActor(bystander);
  const scene = makeScene("s1", { hex, tokens: tokens ?? [token(250, 150)] });
  scenes.set("s1", scene);
  const formation = {
    id: "f1", name: "QQ Band", sceneId: "s1", actorId: "pa1", members,
    travel: { hex: { label }, encounterTerrain: "grassland", territory: "unsettled", ...(lost ? { lost } : {}) },
  };
  formations = { f1: formation };
  chat.length = 0;
  notices.length = 0;
  formulas.length = 0;
  rendered.length = 0;
  made.actors.length = 0;
  return { scene, formation };
}

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

/** Stock the party's hex with a typed count and the neutral rng; returns the record. */
async function stocked(formation, count = 3) {
  const result = await run.stockFromInputs(formation, {
    terrain: "grassland", territory: "unsettled", judgeCount: count, rng: () => 0.5,
  });
  assert.ok(result.ok);
  return result.record;
}

register();

/* -------------------------------------------- */
/*  The true hex                                */
/* -------------------------------------------- */

await t("the hex is the cell under the party's token, keyed and labelled from its offset", () => {
  const { scene, formation } = world();
  const here = run.trueHexOf(formation);
  assert.equal(here.scene, scene);
  assert.equal(here.key, "2:3");
  assert.equal(here.label, "D3");
  assert.deepEqual(here.center, { x: 300, y: 200 });
  assert.deepEqual(here.offset, { i: 2, j: 3 });
  assert.equal(here.astray, false);
});

await t("while astray the hex is the true-position marker's, not the believed token's", () => {
  const { formation } = world({
    lost: { phase: "astray", sceneId: "s1" },
    tokens: [token(250, 150), shadowOf("f1", 650, 450)],
  });
  const here = run.trueHexOf(formation);
  assert.equal(here.key, "5:7", "the shadow stands in cell 5:7");
  assert.equal(here.astray, true);
});

await t("an episode with no marker falls back to the party's own token", () => {
  const { formation } = world({ lost: { phase: "astray", sceneId: "s1" } });
  assert.equal(run.trueHexOf(formation).key, "2:3");
});

await t("a scene without a hex grid keys on the journey's typed label, folded", () => {
  const { scene, formation } = world({ hex: false, label: "C4 (north)." });
  const here = run.trueHexOf(formation);
  assert.equal(here.scene, scene);
  assert.equal(here.key, "label:C4north");
  assert.equal(here.label, "C4 (north).");
  assert.equal(here.center, null);
  assert.equal(here.offset, null);
});

await t("no scene, or a label-only trace with no label, files no stock", () => {
  const { formation } = world({ hex: false, label: "" });
  assert.equal(run.trueHexOf(formation), null, "no label, no hex scene");
  assert.equal(run.trueHexOf({ ...formation, sceneId: "gone" }), null, "no scene");
});

/* -------------------------------------------- */
/*  The record on the scene                     */
/* -------------------------------------------- */

await t("a write is one flag key, as a forced replacement, on the path Foundry expands", async () => {
  const { scene } = world();
  await run.writeStock(scene, "2:3", { stocked: true, points: [] });
  assert.equal(scene.updates.length, 1);
  const [[path, value]] = Object.entries(scene.updates[0]);
  assert.equal(path, "flags.acks-extras.hexStock.2:3");
  assert.deepEqual(path.split("."), ["flags", "acks-extras", "hexStock", "2:3"], "the colon is not a path separator");
  assert.ok(value instanceof ForcedReplacement, "an ordinary update would merge a restocked ledger into the old one");
  assert.deepEqual(run.readStock(scene, "2:3"), { stocked: true, points: [] });
  assert.equal(run.readStock(scene, "9:9"), null);
});

await t("a clear is the forced deletion of one key and touches no other hex", async () => {
  const { scene } = world();
  await run.writeStock(scene, "2:3", { stocked: true, points: [] });
  await run.writeStock(scene, "label:C4", { stocked: true, points: [] });
  await run.clearStock(scene, "2:3");
  const last = scene.updates.at(-1);
  assert.deepEqual(Object.keys(last), ["flags.acks-extras.hexStock.2:3"]);
  assert.ok(Object.values(last)[0] instanceof ForcedDeletion);
  assert.equal(run.readStock(scene, "2:3"), null);
  assert.notEqual(run.readStock(scene, "label:C4"), null, "the other hex stands");
});

/* -------------------------------------------- */
/*  Stocking                                    */
/* -------------------------------------------- */

await t("a typed count stocks that many points and writes them under the hex's key", async () => {
  const { scene, formation } = world();
  const result = await run.stockFromInputs(formation, {
    terrain: "grassland", territory: "unsettled", judgeCount: 2, rng: () => 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.key, "2:3");
  assert.equal(result.record.count, 2);
  assert.equal(result.record.judgeCount, 2);
  assert.equal(result.record.label, "D3");
  assert.equal(result.record.stockedAt, 1000, "stamped with the world clock");
  assert.equal(result.record.points.length, 2);
  assert.ok(result.record.points.every((p) => /^rnd\d+$/.test(p.id)), "ids come from the id minter");
  assert.deepEqual(run.readStock(scene, "2:3").points.map((p) => p.name), ["QQ Terror", "QQ Terror"]);
});

await t("a terrain with no row asks for a count, writes nothing, and stocks once one is typed", async () => {
  const { scene, formation } = world();
  const refused = await run.stockFromInputs(formation, { terrain: "riverLand", territory: "unsettled" });
  assert.equal(refused.ok, false);
  assert.equal(refused.needsCount, true);
  assert.equal(refused.reason, "noRow");
  assert.equal(scene.updates.length, 0, "a refusal leaves the map alone");
  const typed = await run.stockFromInputs(formation, { terrain: "riverLand", territory: "unsettled", judgeCount: 1 });
  assert.equal(typed.ok, true);
  assert.equal(typed.record.row, null);
  assert.equal(typed.record.dice, null);
});

await t("the imported dice and share make the count, and a missing table asks the Judge", async () => {
  const { formation } = world();
  const rolled = await run.stockFromInputs(formation, {
    terrain: "grassland", territory: "unsettled", rng: rig(face(3, 4)),
  });
  assert.equal(rolled.record.count, 3);
  assert.equal(rolled.record.dice, "1d4");
  assert.equal(rolled.record.row, "grassland");

  register({ encounters: ENCOUNTER_TABLES({ lairsPerHex: undefined }) });
  const missing = await run.stockFromInputs(formation, { terrain: "grassland", territory: "unsettled" });
  assert.equal(missing.needsCount, true);
  assert.equal(missing.reason, "lairsPerHex");
  register();
});

await t("a hex with nowhere to be filed refuses without throwing", async () => {
  const { formation } = world({ hex: false, label: "" });
  const result = await run.stockFromInputs(formation, { terrain: "grassland", territory: "unsettled", judgeCount: 1 });
  assert.deepEqual(result, { ok: false, noScene: true });
});

/* -------------------------------------------- */
/*  The dialog                                  */
/* -------------------------------------------- */

await t("the dialog opens on the journey's pick and territory, and asks again for a missing count", async () => {
  const { scene, formation } = world();
  dialogs.wait.push(
    { terrain: "riverLand", territory: "unsettled", substitute: false, judgeCount: null },
    { terrain: "riverLand", territory: "unsettled", substitute: false, judgeCount: 2 },
  );
  const result = await run.openStockDialog(formation);
  assert.equal(result.ok, true);
  assert.equal(result.record.count, 2);
  assert.equal(rendered.length, 2, "asked twice");
  const [first, second] = rendered.map(([, ctx]) => ctx);
  assert.equal(first.terrains.find((x) => x.selected).key, "grassland", "the journey's own pick");
  assert.equal(first.territories.find((x) => x.selected).key, "unsettled");
  assert.equal(first.countRequired, false, "a row with dice needs no typed count");
  assert.equal(first.dice, "1d4");
  assert.equal(second.countRequired, true);
  assert.equal(second.needsCount, true);
  assert.equal(second.terrains.find((x) => x.selected).key, "riverLand", "the Judge's pick is kept");
  assert.ok(notices.some(([, m]) => m.includes("dialog.needsCount")));
  assert.equal(scene.updates.length, 1, "one write, after the count was typed");
  assert.match(rendered[0][0], /templates\/formation\/hex-stock-dialog\.hbs$/);
  assert.match(String(rendered[0][1].seed), /^rnd/, "ids are seeded per window");
});

await t("Cancel is pressed the way core presses it: a nullish callback result becomes the button's action", async () => {
  const { scene, formation } = world();
  const wait = foundry.applications.api.DialogV2.wait;
  let presses = 0;
  // Core's `DialogV2._onSubmit`: the button's callback runs and a nullish
  // result is replaced by the button's `action` string.
  foundry.applications.api.DialogV2.wait = async (cfg) => {
    if (++presses > 1) return null; // a second ask is the failure; close it
    const button = cfg.buttons.find((b) => b.action === "cancel");
    return (await button.callback()) ?? button.action;
  };
  try {
    assert.equal(await run.openStockDialog(formation), null, "cancel stocks nothing");
  } finally {
    foundry.applications.api.DialogV2.wait = wait;
  }
  assert.equal(presses, 1, "asked once");
  assert.deepEqual(notices, [], "no warning");
  assert.equal(scene.updates.length, 0);
});

await t("a cancel stocks nothing, a stocked hex asks before it is replaced, and a player is refused", async () => {
  const { scene, formation } = world();
  dialogs.wait.length = 0;
  assert.equal(await run.openStockDialog(formation), null, "cancel");
  assert.equal(scene.updates.length, 0);

  await stocked(formation, 1);
  const before = scene.updates.length;
  dialogs.confirm.push(false);
  assert.equal(await run.openStockDialog(formation), null, "declined replacement");
  assert.equal(scene.updates.length, before);

  game.user.isGM = false;
  dialogs.confirm.push(true);
  dialogs.wait.push({ terrain: "grassland", territory: "unsettled", substitute: false, judgeCount: 1 });
  assert.equal(await run.openStockDialog(formation), null);
  game.user.isGM = true;
  dialogs.confirm.length = 0;
  dialogs.wait.length = 0;
});

/* -------------------------------------------- */
/*  Points, finds, search credit                */
/* -------------------------------------------- */

await t("a find is recorded per formation at the world clock, and the unfound count follows", async () => {
  const { scene, formation } = world();
  const record = await stocked(formation, 3);
  const next = await run.markPointFound(formation, record.points[1].id);
  assert.equal(next.points[1].found.f1, 1000);
  assert.deepEqual(run.readStock(scene, "2:3").points[0].found, {});
  assert.equal(run.hexStockView(formation).unfound, 2);
  assert.equal(run.hexStockView({ ...formation, id: "f2" }).unfound, 3, "another formation has found nothing");
});

await t("search credit accumulates one per call, and an unstocked hex answers null", async () => {
  const { scene, formation } = world();
  await stocked(formation, 1);
  await run.creditSearchHere(formation);
  const next = await run.creditSearchHere(formation);
  assert.equal(next.searches.f1, 2);
  assert.equal(run.readStock(scene, "2:3").searches.f1, 2);

  const other = world({ tokens: [token(650, 450)] });
  assert.equal(await run.creditSearchHere(other.formation), null);
  assert.equal(await run.markPointFound(other.formation, "x"), null);
  assert.equal(await run.addPlacedPoint(other.formation, { name: "QQ" }), null);
  assert.equal(await run.removePoint(other.formation, "x"), null);
});

await t("a placed point joins the stock and a removed point leaves it", async () => {
  const { scene, formation } = world();
  const record = await stocked(formation, 2);
  const added = await run.addPlacedPoint(formation, { name: "QQ Cairn", note: "QQ note" });
  const point = added.points.at(-1);
  assert.equal(point.kind, "placed");
  assert.equal(point.name, "QQ Cairn");
  assert.equal(point.note, "QQ note");
  assert.deepEqual(point.found, {});
  assert.equal(added.points.length, 3);
  const removed = await run.removePoint(formation, record.points[0].id);
  assert.equal(removed.points.length, 2);
  assert.equal(run.readStock(scene, "2:3").points.some((p) => p.id === record.points[0].id), false);
});

/* -------------------------------------------- */
/*  Land surveying                              */
/* -------------------------------------------- */

const withMathRandom = async (rng, fn) => {
  const real = Math.random;
  Math.random = rng;
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
};

/** Stock three points with a dice row, so a false count has something to re-roll. */
async function diced(formation) {
  const r = await run.stockFromInputs(formation, { terrain: "grassland", territory: "unsettled", rng: rig(face(3, 4)) });
  assert.equal(r.record.points.length, 3);
  return r.record;
}

await t("a success tells the truth, records it, and the card carries the Tell button", async () => {
  const { scene, formation } = world();
  await diced(formation);
  nextNatural = 18;
  const result = await run.surveyHex(formation);
  assert.deepEqual(result, { outcome: "assessed", told: 3, trustworthy: true });
  assert.deepEqual(run.readStock(scene, "2:3").assessments.f1, { told: 3, trustworthy: true, at: 1000 });
  assert.equal(chat.length, 1);
  assert.deepEqual(chat[0].whisper, ["gm1"], "a Judge-side card");
  assert.match(chat[0].content, /class="acks-extras-hex-tell" data-formation-id="f1" data-told="3"/);
  assert.match(chat[0].content, /survey\.assessed/);
});

await t("the sky taxes the survey throw and says so on the card; a fair sky adds no line", async () => {
  registerTable({
    id: "weather",
    tables: { conditionEffects: { foggy: { throws: { landSurveying: -4 } } } },
  }, { priority: PRIORITY.WORLD, source: "test" });
  const { formation } = world();
  await diced(formation);
  formation.travel.weather = { precipitation: "foggy" };
  nextNatural = 18;
  await run.surveyHex(formation);
  assert.deepEqual(formulas, ["1d20 + -4"], "the throw carries the sky's figure");
  assert.match(chat[0].content, /hexStock\.weather \{"value":"-4"\}/);

  const fair = world();
  await diced(fair.formation);
  nextNatural = 18;
  await run.surveyHex(fair.formation);
  assert.deepEqual(formulas, ["1d20"], "with a fair sky the throw is plain");
  assert.doesNotMatch(chat[0].content, /hexStock\.weather/);
  register();
});

await t("a natural 1 tells a count that differs from the truth, after re-rolling the stored dice", async () => {
  const { scene, formation } = world();
  await diced(formation);
  nextNatural = 1;
  // The dice land on the truth (3) first, then on 2.
  const result = await withMathRandom(rig(face(3, 4), face(2, 4)), () => run.surveyHex(formation));
  assert.deepEqual(result, { outcome: "misread", told: 2, trustworthy: false });
  assert.deepEqual(run.readStock(scene, "2:3").assessments.f1, { told: 2, trustworthy: false, at: 1000 });
  assert.match(chat[0].content, /data-told="2"/);
  assert.match(chat[0].content, /survey\.truth \{"count":3\}/, "the card keeps the Judge's truth");
});

await t("a misread with no dice to re-roll asks the Judge and offers no Tell button", async () => {
  const { scene, formation } = world();
  // A terrain with no row keeps no dice, so there is nothing to re-roll.
  await run.stockFromInputs(formation, { terrain: "riverLand", territory: "unsettled", judgeCount: 3, rng: () => 0.5 });
  nextNatural = 1;
  const result = await run.surveyHex(formation);
  assert.deepEqual(result, { outcome: "misread", told: null, trustworthy: false });
  assert.equal(run.readStock(scene, "2:3").assessments.f1.trustworthy, false);
  assert.match(chat[0].content, /survey\.askJudge/);
  assert.doesNotMatch(chat[0].content, /acks-extras-hex-tell/);
});

await t("an ordinary miss tells nothing and leaves no assessment, so the next hour tries again", async () => {
  const { scene, formation } = world();
  await diced(formation);
  nextNatural = 5;
  const result = await run.surveyHex(formation);
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.told, null);
  assert.deepEqual(run.readStock(scene, "2:3").assessments, {});
  assert.doesNotMatch(chat[0].content, /acks-extras-hex-tell/);
  assert.doesNotMatch(chat[0].content, /survey\.truth/, "a miss does not leak the count");

  nextNatural = 18;
  const again = await run.surveyHex(formation, { auto: true });
  assert.equal(again.outcome, "assessed", "an automatic attempt still runs: nothing was assessed yet");
});

await t("the bonus is the formation's own search credit, and an automatic attempt waits for an assessment", async () => {
  const { formation } = world();
  await diced(formation);
  await run.creditSearchHere(formation);
  await run.creditSearchHere(formation);
  nextNatural = 18;
  await run.surveyHex(formation);
  assert.equal(formulas.at(-1), "1d20 + 6", "two searches at the invented per-search bonus");
  const rolled = formulas.length;
  chat.length = 0;
  assert.equal(await run.surveyHex(formation, { auto: true }), null);
  assert.equal(formulas.length, rolled, "no throw once assessed");
  assert.equal(chat.length, 0);
  assert.ok(await run.surveyHex(formation), "a manual attempt is always allowed");
});

await t("nobody holding the proficiency, an unstocked hex, a player, or a missing table throws nothing", async () => {
  const { formation } = world({ members: [{ actorId: "a2" }] });
  await diced(formation);
  const rolled = formulas.length;
  assert.equal(await run.surveyHex(formation), null);
  assert.equal(formulas.length, rolled);
  assert.match(chat[0].content, /hexStock\.noSurveyor/);

  const blank = world({ tokens: [token(650, 450)] });
  chat.length = 0;
  assert.equal(await run.surveyHex(blank.formation), null, "not stocked");
  assert.equal(chat.length, 0);

  const live = world();
  await diced(live.formation);
  game.user.isGM = false;
  assert.equal(await run.surveyHex(live.formation), null);
  game.user.isGM = true;

  register({ searching: false });
  chat.length = 0;
  assert.equal(await run.surveyHex(live.formation), null);
  assert.match(chat[0].content, /hexStock\.unpriced \{"what":"surveyTarget"\}/);
  register();
});

await t("the public line has one shape for a true count and a false one", async () => {
  const { formation } = world();
  chat.length = 0;
  assert.equal(await run.tellParty("f1", 3), true);
  assert.equal(await run.tellParty("f1", 2), true);
  const [truthful, wrong] = chat;
  assert.deepEqual(truthful.whisper, [], "public");
  assert.equal(truthful.speaker.alias, formation.name);
  assert.equal(truthful.content.replace(/\d/g, "#"), wrong.content.replace(/\d/g, "#"));
  assert.notEqual(truthful.content, wrong.content);
  assert.equal(await run.tellParty("gone", 3), false);
});

/* -------------------------------------------- */
/*  Make it a place                             */
/* -------------------------------------------- */

await t("a place is refused while astray and made at the hex centre otherwise, hidden until found", async () => {
  const astray = world({ lost: { phase: "astray", sceneId: "s1" } });
  const rec = await stocked(astray.formation, 2);
  assert.equal(await run.placeFromPoint(astray.formation, rec.points[0].id), null);
  assert.equal(made.actors.length, 0);
  assert.ok(notices.some(([, m]) => m.includes("hexStock.astray")));

  const { scene, formation } = world();
  const record = await stocked(formation, 2);
  const actor = await run.placeFromPoint(formation, record.points[0].id);
  assert.ok(actor);
  const [[type, [doc]]] = scene.created;
  assert.equal(type, "Token");
  assert.deepEqual([doc.x, doc.y], [250, 150], "a token's origin is its corner: the centre less half a cell");
  assert.equal(doc.hidden, true, "unfound, so hidden");
  assert.equal(run.readStock(scene, "2:3").points[0].placeUuid, actor.uuid);

  assert.equal(await run.placeFromPoint(formation, record.points[0].id), null, "already a place");
  assert.ok(notices.some(([, m]) => m.includes("hexStock.alreadyPlaced")));

  await run.markPointFound(formation, record.points[1].id);
  await run.placeFromPoint(formation, record.points[1].id);
  assert.equal(scene.created.at(-1)[1][0].hidden, false, "a found point is placed in the open");
  assert.equal(await run.placeFromPoint(formation, "nope"), null);
});

await t("the extracted placement leaves promoting an incident marker as it was", async () => {
  const { scene } = world();
  const { promoteIncident } = await import("../scripts/formation/poi.mjs");
  const { TRANSIENT_FLAG } = await import("../scripts/formation/poi-logic.mjs");
  let deleted = false;
  const note = {
    x: 300, y: 200, parent: scene, delete: async () => { deleted = true; },
    flags: { "acks-extras": { [TRANSIENT_FLAG]: { text: "QQ incident", regionUuid: null } } },
  };
  const actor = await promoteIncident(note, { name: "QQ Corner" });
  assert.equal(actor.name, "QQ Corner");
  const [doc] = scene.created.at(-1)[1];
  assert.deepEqual([doc.x, doc.y], [250, 150], "centred on the marker");
  assert.equal(doc.hidden, false);
  assert.equal(deleted, true, "the marker is gone");
});

/* -------------------------------------------- */
/*  Card buttons and the view                   */
/* -------------------------------------------- */

await t("the card buttons bind for a Judge only and drive the same writers", async () => {
  const { scene, formation } = world();
  const record = await stocked(formation, 1);
  run.installHexStockCardActions();
  const render = hooks.get("renderChatMessageHTML").at(-1);
  const button = (dataset) => ({ dataset, disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
  const tell = button({ formationId: "f1", told: "2" });
  const found = button({ formationId: "f1", pointId: record.points[0].id });
  const root = { nodeType: 1, querySelectorAll: (sel) => ({ ".acks-extras-hex-tell": [tell], ".acks-extras-hex-found": [found] })[sel] ?? [] };

  game.user.isGM = false;
  render({}, root);
  assert.deepEqual(tell.listeners, {}, "a player's card has no live buttons");
  game.user.isGM = true;
  chat.length = 0;
  render({}, root);
  tell.listeners.click({ preventDefault() {} });
  found.listeners.click({ preventDefault() {} });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(chat.length, 1);
  assert.match(chat[0].content, /survey\.public \{"count":2\}/);
  assert.equal(run.readStock(scene, "2:3").points[0].found.f1, 1000);
  assert.equal(tell.disabled, true);
});

await t("the panel view is for the Judge, and says so when there is no map hex or no stock", async () => {
  const { formation } = world();
  const empty = run.hexStockView(formation);
  assert.equal(empty.stocked, false);
  assert.equal(empty.noScene, false);
  assert.equal(empty.key, "2:3");
  assert.equal(empty.canSurvey, true);
  assert.equal(empty.assessed, null);
  assert.deepEqual(empty.points, []);

  const record = await diced(formation);
  await run.markPointFound(formation, record.points[0].id);
  nextNatural = 18;
  await run.surveyHex(formation);
  const view = run.hexStockView(formation);
  assert.equal(view.stocked, true);
  assert.equal(view.summary.upTo, true);
  assert.equal(view.summary.points, 3);
  assert.equal(view.unfound, 2);
  assert.deepEqual(view.assessed, { told: 3, trustworthy: true, at: 1000 });
  assert.deepEqual(view.points.map((p) => [p.found, p.foundByAny]), [[true, true], [false, false], [false, false]]);
  assert.equal(view.points[0].kindLabel, "ACKS-FORMATION.hexStock.kinds.lair {}");

  const nowhere = run.hexStockView({ ...formation, sceneId: "gone" });
  assert.equal(nowhere.noScene, true);
  assert.equal(nowhere.key, null);
  assert.equal(nowhere.stocked, false);

  game.user.isGM = false;
  assert.equal(run.hexStockView(formation), null);
  game.user.isGM = true;
});

console.log(`\ntest-hex-stock-run: all ${passed} checks passed`);
