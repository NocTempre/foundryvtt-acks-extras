/**
 * Lib's invalid-document repair check (scripts/lib/repair-checks.mjs): what
 * `lib.strandedCoin` lists and the reason it gives. It reads `game` when it
 * scans and nothing as the module loads, so one stand-in world is the whole
 * mock.
 *
 * A collection here answers only what a scan asks of one: its loaded documents
 * by iteration, `invalidDocumentIds` and `getInvalid`. Whether core hands over
 * a real document it could not load in the shape these sources have is outside
 * what an offline suite holds.
 *
 * The wording answers with its key and what it was given. Package ids and
 * titles, names and counts are this file's inventions.
 */
import assert from "node:assert/strict";
import { fixCheck, getRepairCheck, repairChecks, scanCheck } from "../scripts/lib/repair-logic.mjs";
import { registerLibRepairChecks } from "../scripts/lib/repair-checks.mjs";

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/* -------------------------------------------------------------------- */
/*  The stand-in world                                                  */
/* -------------------------------------------------------------------- */

/** The localizer's answer: the key, and the data handed with it. */
const said = (key, data = {}) => `${key} ${JSON.stringify(data)}`;

/**
 * A world or embedded collection: `loaded` is what it iterates, and `invalid`
 * maps the id of each document it could not load to that document's source.
 * It answers nothing an array answers and a Foundry collection does not. A
 * source given as a function stands for a read that goes wrong: `getInvalid`
 * calls it in the document's place.
 */
class Coll extends Map {
  #invalid;

  constructor(invalid = {}, loaded = []) {
    super(loaded.map((doc, i) => [`d${i}`, doc]));
    this.#invalid = invalid;
    this.invalidDocumentIds = new Set(Object.keys(invalid));
  }

  [Symbol.iterator]() {
    return this.values();
  }

  getInvalid(id) {
    const src = this.#invalid[id];
    return typeof src === "function" ? src() : { toObject: () => structuredClone(src) };
  }
}

/**
 * Stand a world in for `game`. `modules` maps a package id to `{active, title}`.
 * `actors` and `items` map an id to the source of a document the world could
 * not load, and `scenes` are loaded.
 */
function world({ modules = {}, actors = {}, items = {}, scenes = [] } = {}) {
  globalThis.game = {
    system: { id: "acks" },
    modules: new Map(Object.entries(modules)),
    i18n: { format: said },
    actors: new Coll(actors),
    items: new Coll(items),
    scenes: new Coll({}, scenes),
    journal: new Coll(),
    tables: new Coll(),
    settings: { storage: { get: () => new Coll() } },
  };
}

/** Each finding `check` lists in the world standing in, as its key and one other field. */
const keyed = async (check, field) => (await check.scan()).map((f) => [f.key, f[field]]);
/** The keys `check` lists in the world standing in. */
const keys = async (check) => (await check.scan()).map((f) => f.key);

/** A `money` row as an actor's source holds one. */
const coin = (name, quantity, quantitybank) => ({ name, type: "money", system: { quantity, quantitybank } });
/** The source of an actor. */
const actor = (name, type, items) => ({ name, type, items });
/** A read that throws. */
const unreadable = () => {
  throw new Error("unreadable");
};

/** A sub-type of a package the world does not have. */
const ABSENT = "ghost-press.wanderer";
/** A sub-type of a module the world has, switched off. */
const DISABLED = "loose-leaf.courier";
/** A sub-type of a module the world has, switched on. */
const ACTIVE = "wide-margin.clerk";
/** The modules the stand-in world has installed, unless a test says otherwise. */
const MODULES = { "loose-leaf": { active: false, title: "Loose Leaf" }, "wide-margin": { active: true, title: "Wide Margin" } };
/** One money row: seven carried, none banked. */
const PURSE = [coin("Brass Bit", 7, 0)];

// The lang keys the scan answers with.
const DETAIL = "ACKS-LIB.repair.check.strandedCoin.detail";
const REPORT_ONLY = "ACKS-LIB.repair.check.strandedCoin.reportOnly";
const ENABLE = "ACKS-LIB.repair.enablePackage";

registerLibRepairChecks();
const COIN = getRepairCheck("lib.strandedCoin");

/* -------------------------------------------------------------------- */
/*  lib.strandedCoin                                                    */
/* -------------------------------------------------------------------- */

t("a world with nothing it could not load lists nothing", async () => {
  world({ modules: MODULES });
  assert.deepEqual(await COIN.scan(), []);
});

t("an actor of a package that is not installed is listed, with its coin and the report-only reason", async () => {
  world({ actors: { a1: actor("Shut Out", ABSENT, PURSE) } });
  assert.deepEqual(await COIN.scan(), [
    {
      key: "Actor.a1",
      uuid: null,
      name: "Shut Out",
      detail: said(DETAIL, { type: ABSENT, coin: "7 × Brass Bit" }),
      reason: said(REPORT_ONLY),
    },
  ]);
});

t("an actor of a disabled module is listed with the reason that names the module, by its title, to enable", async () => {
  world({ modules: MODULES, actors: { a1: actor("Shut Out", DISABLED, PURSE) } });
  assert.deepEqual(await keyed(COIN, "reason"), [["Actor.a1", said(ENABLE, { title: "Loose Leaf" })]]);
  world({ modules: { "loose-leaf": { active: false } }, actors: { a1: actor("Shut Out", DISABLED, PURSE) } });
  assert.deepEqual(await keyed(COIN, "reason"), [["Actor.a1", said(ENABLE, { title: "loose-leaf" })]], "a module with no title is named by its id");
});

t("an actor of a core type, of the system's namespace or of an active module is not listed", async () => {
  world({
    modules: MODULES,
    actors: {
      a1: actor("Core", "character", PURSE),
      a2: actor("No type", undefined, PURSE),
      a3: actor("System", "acks.clerk", PURSE),
      a4: actor("Active", ACTIVE, PURSE),
      a5: actor("Shut Out", ABSENT, PURSE),
    },
  });
  assert.deepEqual(await keys(COIN), ["Actor.a5"]);
});

t("an actor with no money rows is not listed", async () => {
  world({
    actors: {
      a1: actor("Empty", ABSENT, []),
      a2: actor("Goods only", ABSENT, [null, { name: "Rope", type: "item", system: { quantity: 3 } }]),
      a3: actor("No items", ABSENT, undefined),
      a4: actor("Shut Out", ABSENT, PURSE),
    },
  });
  assert.deepEqual(await keys(COIN), ["Actor.a4"]);
});

t("a row counts what it carries plus what it has banked, and rows are named in order", async () => {
  const rows = [coin("Brass Bit", 4, 9), { name: "Rope", type: "item", system: { quantity: 2 } }, coin("Tin Chit", "3"), { type: "money", system: { quantitybank: 2 } }];
  world({ actors: { a1: actor("Shut Out", ABSENT, rows) } });
  assert.deepEqual(await keyed(COIN, "detail"), [["Actor.a1", said(DETAIL, { type: ABSENT, coin: "13 × Brass Bit, 3 × Tin Chit, 2 × ?" })]]);
});

t("an actor whose money rows count nothing is not listed", async () => {
  world({
    actors: {
      a1: actor("Empty purse", ABSENT, [coin("Brass Bit", 0, 0)]),
      a2: actor("Bare row", ABSENT, [{ type: "money" }]),
      a3: actor("Overdrawn", ABSENT, [coin("Brass Bit", -3, 0), coin("Tin Chit", 2, -2)]),
      a4: actor("Shut Out", ABSENT, PURSE),
    },
  });
  assert.deepEqual(await keys(COIN), ["Actor.a4"]);
});

t("a row that counts nothing is left out of the coin its actor is listed with", async () => {
  world({ actors: { a1: actor("Shut Out", ABSENT, [coin("Brass Bit", 0, 0), coin("Tin Chit", 5, 0)]) } });
  assert.deepEqual(await keyed(COIN, "detail"), [["Actor.a1", said(DETAIL, { type: ABSENT, coin: "5 × Tin Chit" })]]);
});

t("an actor with no name is listed under its id", async () => {
  world({ actors: { a1: actor(undefined, ABSENT, PURSE) } });
  assert.deepEqual(await keyed(COIN, "name"), [["Actor.a1", "a1"]]);
});

t("a source the collection cannot hand over is skipped, and the scan goes on", async () => {
  world({
    actors: {
      a1: unreadable,
      a2: () => undefined,
      a3: () => ({}),
      a4: () => ({ toObject: () => null }),
      a5: actor("Shut Out", ABSENT, PURSE),
    },
  });
  assert.deepEqual(await keys(COIN), ["Actor.a5"]);
});

t("the coin check has no fix, and none of its findings is offered", async () => {
  world({ modules: MODULES, actors: { a1: actor("Shut Out", ABSENT, PURSE), a2: actor("Shut Out Too", DISABLED, PURSE) } });
  assert.equal(COIN.fix, null);
  assert.ok((await COIN.scan()).every((f) => f.uuid === null && !("fixable" in f)));
  const { findings, error } = await scanCheck(COIN);
  assert.equal(error, null);
  assert.deepEqual(findings.map((f) => [f.key, f.uuid, f.fixable]), [["Actor.a1", null, false], ["Actor.a2", null, false]]);
  await assert.rejects(() => fixCheck(COIN, findings), /report-only/);
});

/* -------------------------------------------------------------------- */
/*  formation.hexStock                                                  */
/* -------------------------------------------------------------------- */

// The formation module's checks import the party sheet and the zone classes,
// which extend core's bases as they load: bare stand-ins are all they need here.
class ForcedReplacement {
  constructor(value) {
    this.value = value;
  }

  static create(value) {
    return new ForcedReplacement(value);
  }
}
globalThis.foundry = {
  utils: { deepClone: (v) => structuredClone(v) },
  data: {
    operators: { ForcedReplacement, ForcedDeletion: class {} },
    fields: new Proxy({}, { get: () => class {} }),
    regionBehaviors: { RegionBehaviorType: class {} },
  },
  abstract: { TypeDataModel: class {}, DataModel: class {} },
  applications: {
    api: { ApplicationV2: class {}, DialogV2: {}, HandlebarsApplicationMixin: (Base) => class extends Base {} },
    sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
    handlebars: {},
    ux: { DragDrop: { implementation: class {} }, TextEditor: { implementation: {} } },
    apps: { DocumentSheetConfig: { registerSheet() {} }, FilePicker: { implementation: class {} } },
    instances: new Map(),
  },
};
globalThis.Hooks = { on() {}, once() {} };
globalThis.CONFIG = { Actor: { dataModels: {} }, Item: { dataModels: {} }, RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.CONST = {};
const { registerFormationRepairChecks } = await import("../scripts/formation/repair-checks.mjs");
registerFormationRepairChecks();
const HEX_STOCK = getRepairCheck("formation.hexStock");
const HEX_FLAG = "flags.acks-extras.hexStock";

/** A scene holding the given hexStock flag; its updates are kept, and applied as a forced replacement per key. */
function stockScene(id, stock) {
  const scene = {
    id, uuid: `Scene.${id}`, name: `QQ Map ${id}`, tokens: new Coll(), updates: [],
    getFlag: (ns, key) => (ns === "acks-extras" && key === "hexStock" ? stock : undefined),
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        stock[path.slice(HEX_FLAG.length + 1)] = value.value;
      }
    },
  };
  return scene;
}

/** A world of the given scenes and a formation per id. */
function stockWorld(scenes, formationIds = ["f1"]) {
  world({ scenes });
  const formations = Object.fromEntries(formationIds.map((id) => [id, { id, name: `QQ ${id}`, members: [] }]));
  globalThis.game.settings = { get: () => formations };
  globalThis.fromUuid = async (uuid) => scenes.find((s) => s.uuid === uuid) ?? null;
}

const point = (id, found = {}) => ({ id, kind: "lair", name: "QQ Prowler", found });
const sound = () => ({ stocked: true, points: [point("p1", { f1: 5 })], searches: { f1: 1 }, assessments: { f1: { told: 1 } } });
const broken = () => ({
  stocked: true,
  points: [point("p1", { f1: 5, gone: 9 }), { id: "p2", kind: "lair", name: "QQ Stalker", found: {} }],
  searches: { f1: 1, gone: 2 },
  assessments: { gone: { told: 3 } },
});

t("a scene whose hex stock is sound, or absent, is not listed", async () => {
  stockWorld([stockScene("s1", { "2:3": sound(), "label:C4": sound() }), stockScene("s2", undefined)]);
  assert.deepEqual(await HEX_STOCK.scan(), []);
});

t("a record naming a party that is gone is listed once per scene with its count", async () => {
  stockWorld([stockScene("s1", { "2:3": broken(), "4:4": sound(), "5:5": broken() }), stockScene("s2", { "1:1": sound() })]);
  assert.deepEqual(await HEX_STOCK.scan(), [
    {
      key: "Scene.s1",
      uuid: "Scene.s1",
      name: "QQ Map s1",
      detail: said("ACKS-FORMATION.repair.check.hexStock.detail", { count: 2 }),
    },
  ]);
});

t("the fix drops the dead parties' entries in one update, leaving sound hexes alone", async () => {
  const scene = stockScene("s1", { "2:3": broken(), "4:4": sound() });
  stockWorld([scene]);
  const outcome = await fixCheck(HEX_STOCK, (await scanCheck(HEX_STOCK)).findings);
  assert.equal(outcome.fixed.length, 1);
  assert.equal(outcome.failed.length, 0);
  assert.equal(scene.updates.length, 1, "one update for the scene");
  assert.deepEqual(Object.keys(scene.updates[0]), [`${HEX_FLAG}.2:3`], "only the damaged hex is written");
  assert.ok(Object.values(scene.updates[0])[0] instanceof ForcedReplacement, "a merge would keep the dead entries");
  const mended = scene.getFlag("acks-extras", "hexStock")["2:3"];
  assert.equal(mended.points[0].id, "p1");
  assert.equal(mended.points[1].id, "p2");
  assert.deepEqual(mended.points[0].found, { f1: 5 });
  assert.deepEqual(mended.searches, { f1: 1 });
  assert.deepEqual(mended.assessments, {});
  assert.equal(mended.points[1].name, "QQ Stalker", "nothing else about a point changes");
  assert.deepEqual(outcome.rescan.findings, []);
});

t("every scene with a broken stock is mended by its own update", async () => {
  const a = stockScene("s1", { "2:3": broken() });
  const b = stockScene("s2", { "0:0": broken() });
  stockWorld([a, b]);
  const found = (await scanCheck(HEX_STOCK)).findings;
  assert.deepEqual(found.map((f) => f.key), ["Scene.s1", "Scene.s2"]);
  await fixCheck(HEX_STOCK, found);
  assert.deepEqual([a.updates.length, b.updates.length], [1, 1]);
});

t("a legacy change key with no counterpart is listed unfixable, and `only` takes one id as a string", async () => {
  world();
  const fx = (name, key) => ({ uuid: `Actor.a1.ActiveEffect.${name}`, name, changes: [{ key, mode: 2, value: "1" }] });
  game.actors = new Coll({}, [{ name: "Legacy", uuid: "Actor.a1", effects: [fx("ac", "system.aac.mod"), fx("surprise", "system.surprise.mod")], items: [] }]);
  const LEGACY = getRepairCheck("lib.legacyEffectKeys");
  const found = (await scanCheck(LEGACY)).findings;
  assert.deepEqual(
    found.map((f) => [f.key, f.fixable, f.reason != null]),
    [
      ["effect:Actor.a1.ActiveEffect.ac", true, false],
      ["effect:Actor.a1.ActiveEffect.surprise", false, true],
    ],
  );
  assert.deepEqual(repairChecks({ only: "lib.legacyEffectKeys" }).map((c) => c.id), ["lib.legacyEffectKeys"]);
  assert.deepEqual(repairChecks({ only: ["lib.legacyEffectKeys"] }).map((c) => c.id), ["lib.legacyEffectKeys"]);
});

/* -------------------------------------------------------------------- */
/*  lib.twoHandedRow                                                    */
/* -------------------------------------------------------------------- */

const TWO_HANDED = getRepairCheck("lib.twoHandedRow");
const ROW_DETAIL = "ACKS-LIB.repair.check.twoHandedRow.detail";
const ROW_NONE = said("ACKS-LIB.repair.check.twoHandedRow.none");
const ROW_STAMPED = said("ACKS-LIB.repair.check.twoHandedRow.stampedFirst");

/** The modes an importer stamps on a weapon: a one-handed die, and a two-handed one where the row names it. */
const rowModes = (twoHanded) => [
  { key: "melee", label: "Melee", damage: "1d7", attack: "melee" },
  ...(twoHanded ? [{ key: "melee-twohanded", label: "Two-handed melee", damage: twoHanded, attack: "melee", grip: "two-handed" }] : []),
];

/** A weapon document storing `alternate`; `modes` is the imported row it carries, or none. */
function weaponDoc(id, name, { alternate, modes, type = "weapon" }) {
  const doc = {
    id,
    uuid: `Item.${id}`,
    name,
    type,
    system: { damage: { base: { formula: "1d7" }, alternate: { formula: alternate } } },
    flags: modes ? { "acks-extras": { weapon: { modes } } } : {},
    updates: [],
  };
  doc._source = { system: structuredClone(doc.system) };
  doc.update = async (patch) => {
    doc.updates.push(patch);
    doc.system.damage.alternate.formula = patch["system.damage.alternate.formula"];
  };
  return doc;
}

/** A world holding these documents: each actor's items on it, and the loose ones as world items. */
function weaponWorld({ actors = [], items = [] }) {
  world();
  const all = new Map();
  const ownedBy = actors.map(([name, held]) => ({ name, uuid: `Actor.${name}`, items: held }));
  for (const doc of [...actors.flatMap(([, held]) => held), ...items]) all.set(doc.uuid, doc);
  game.actors = new Coll({}, ownedBy);
  game.items = new Coll({}, items);
  globalThis.fromUuid = async (uuid) => all.get(uuid) ?? null;
}

t("a weapon storing a die its row does not name, or a die where the row names none, is listed with the die to write", async () => {
  weaponWorld({
    actors: [["Bearer", [weaponDoc("w1", "Long Blade", { alternate: "1d5", modes: rowModes("1d11") })]]],
    items: [weaponDoc("w2", "Net", { alternate: "1d5", modes: rowModes(null) })],
  });
  assert.deepEqual(await TWO_HANDED.scan(), [
    {
      key: "Item.w1",
      uuid: "Item.w1",
      name: "Bearer → Long Blade",
      want: "1d11",
      detail: said(ROW_DETAIL, { stored: "1d5", row: "1d11" }),
    },
    {
      key: "Item.w2",
      uuid: "Item.w2",
      name: "Net",
      want: "",
      detail: said(ROW_DETAIL, { stored: "1d5", row: ROW_NONE }),
    },
  ]);
});

t("a blank alternate where the row names a die is listed, naming none as stored", async () => {
  weaponWorld({ items: [weaponDoc("w1", "Long Blade", { alternate: "", modes: rowModes("1d11") }), weaponDoc("w2", "Pike", { modes: rowModes("2d3"), alternate: undefined })] });
  assert.deepEqual(await keyed(TWO_HANDED, "detail"), [
    ["Item.w1", said(ROW_DETAIL, { stored: ROW_NONE, row: "1d11" })],
    ["Item.w2", said(ROW_DETAIL, { stored: ROW_NONE, row: "2d3" })],
  ]);
});

t("a weapon with no imported row is never listed, whatever it stores", async () => {
  weaponWorld({
    items: [
      weaponDoc("w1", "Home Forged", { alternate: "1d5" }),
      weaponDoc("w2", "Empty Stamp", { alternate: "1d5", modes: [] }),
      weaponDoc("w3", "Bare Stamp", { alternate: "", modes: undefined }),
    ],
  });
  assert.deepEqual(await TWO_HANDED.scan(), []);
});

t("a weapon already agreeing with its row is not listed, a die compared without its spacing or case", async () => {
  weaponWorld({
    items: [
      weaponDoc("w1", "Long Blade", { alternate: "1d11", modes: rowModes("1d11") }),
      weaponDoc("w2", "Pike", { alternate: " 2D3 ", modes: rowModes("2d3") }),
      weaponDoc("w3", "Net", { alternate: "", modes: rowModes(null) }),
      weaponDoc("w4", "Sling", { alternate: "  ", modes: rowModes(null) }),
    ],
  });
  assert.deepEqual(await TWO_HANDED.scan(), []);
});

t("only weapons are read", async () => {
  weaponWorld({ items: [weaponDoc("w1", "Satchel", { alternate: "1d5", modes: rowModes("1d11"), type: "item" })] });
  assert.deepEqual(await TWO_HANDED.scan(), []);
});

t("a row's two-handed mode that carries no die names none", async () => {
  const modes = [{ key: "melee", damage: "1d7" }, { key: "melee-twohanded", grip: "two-handed", damage: null }];
  weaponWorld({ items: [weaponDoc("w1", "Long Blade", { alternate: "1d5", modes })] });
  assert.deepEqual(await keyed(TWO_HANDED, "detail"), [["Item.w1", said(ROW_DETAIL, { stored: "1d5", row: ROW_NONE })]]);
});

t("the fix writes the row's die, or a blank, into the alternate and nothing else, and the rescan finds none", async () => {
  const sword = weaponDoc("w1", "Long Blade", { alternate: "1d5", modes: rowModes("1d11") });
  const net = weaponDoc("w2", "Net", { alternate: "1d5", modes: rowModes(null) });
  weaponWorld({ actors: [["Bearer", [sword]]], items: [net] });
  const found = (await scanCheck(TWO_HANDED)).findings;
  assert.deepEqual(found.map((f) => f.fixable), [true, true]);
  const outcome = await fixCheck(TWO_HANDED, found);
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual(outcome.fixed.map((f) => f.key), ["Item.w1", "Item.w2"]);
  assert.deepEqual(outcome.rescan.findings, []);
  assert.deepEqual(sword.updates, [{ "system.damage.alternate.formula": "1d11" }]);
  assert.deepEqual(net.updates, [{ "system.damage.alternate.formula": "" }]);
});

t("a weapon gone before the fix is refused, and the rest are written", async () => {
  const sword = weaponDoc("w1", "Long Blade", { alternate: "1d5", modes: rowModes("1d11") });
  const net = weaponDoc("w2", "Net", { alternate: "1d5", modes: rowModes(null) });
  weaponWorld({ items: [sword, net] });
  const found = (await scanCheck(TWO_HANDED)).findings;
  const real = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === "Item.w1" ? null : real(uuid));
  const outcome = await fixCheck(TWO_HANDED, found);
  assert.deepEqual(outcome.failed.map((f) => [f.key, f.why, f.error]), [["Item.w1", "refused", said("ACKS-LIB.repair.subjectGone")]]);
  assert.deepEqual(outcome.fixed.map((f) => f.key), ["Item.w2"]);
  assert.deepEqual(sword.updates, []);
});

t("a weapon the stamped-record rescue still holds is listed and not offered, then offered once its record is written", async () => {
  const { installLegacyCombatRescue, forgetRescue } = await import("../scripts/lib/patches/legacy-source.mjs");
  const model = () => class {
    static migrateData(source) {
      return source;
    }
  };
  CONFIG.Actor.dataModels = { character: model(), monster: model() };
  CONFIG.Item.dataModels = { weapon: model(), armor: model(), item: model(), ability: model(), spell: model() };
  installLegacyCombatRescue();
  // A stamped record whose damage names no alternate loads with a blank one.
  const source = CONFIG.Item.dataModels.weapon.migrateData({ _schemaVersion: 5, damage: { base: { formula: "1d7" } } }, { partial: false });
  assert.equal(source.damage.alternate.formula, "");
  const sword = weaponDoc("w1", "Long Blade", { alternate: "", modes: rowModes("1d11") });
  sword._source = { system: source };
  weaponWorld({ items: [sword] });
  assert.deepEqual((await scanCheck(TWO_HANDED)).findings.map((f) => [f.key, f.fixable, f.reason]), [["Item.w1", false, ROW_STAMPED]]);
  forgetRescue(source);
  assert.deepEqual((await scanCheck(TWO_HANDED)).findings.map((f) => [f.key, f.fixable, f.reason]), [["Item.w1", true, null]]);
});

/* -------------------------------------------------------------------- */
/*  lib.missingImages                                                   */
/* -------------------------------------------------------------------- */

const { IMAGE_FIELDS, checkablePath, distinctPaths, imagesOf, missingPaths, planRepair } = await import("../scripts/lib/missing-images.mjs");
const IMAGES = getRepairCheck("lib.missingImages");
const IMG_DETAIL = "ACKS-LIB.repair.check.missingImages.detail";
const IMG_DONE = said("ACKS-LIB.repair.check.missingImages.done");
const IMG_NO_DEFAULT = said("ACKS-LIB.repair.check.missingImages.noDefault");

/** The default image each kind answers with in the stand-in world; invented paths. */
const DEFAULTS = { Actor: "qq/default-actor.svg", Item: "qq/default-item.svg", ActiveEffect: "qq/default-effect.svg", Macro: "qq/default-macro.svg", RollTable: "qq/default-table.svg", Token: "qq/default-token.svg" };
const GONE = "worlds/qq/gone.png";
const GONE_TOO = "worlds/qq/gone-too.png";
const HERE = "worlds/qq/here.png";

/** Set `value` at a dotted path of `obj`. */
function setAt(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  let at = obj;
  for (const part of parts) at = at[part] ??= {};
  at[last] = value;
}

/** A document with a source, collections of embedded ones, and an update that applies and records. */
function imgDoc(uuid, name, source, { effects = [], items = [], ...rest } = {}) {
  const doc = { uuid, name, _source: source, effects, items, updates: [], ...rest };
  doc.update = async (patch) => {
    doc.updates.push(patch);
    for (const [field, value] of Object.entries(patch)) setAt(doc._source, field, value);
  };
  return doc;
}

/** An actor source with art for itself and its prototype token. */
const actorSource = (img, token) => ({ img, prototypeToken: { texture: { src: token } } });

/**
 * A world holding the given documents and a server that answers `HEAD` per
 * path: a path in `gone` is 404, in `broken` is 500, in `down` throws, and
 * anything else is there. Returns the requests made.
 */
function imageWorld({ actors = [], items = [], macros = [], tables = [], scenes = [], journal = [], gone = [GONE, GONE_TOO], broken = [], down = [], defaults = DEFAULTS } = {}) {
  world();
  Object.assign(game, { actors: new Coll({}, actors), items: new Coll({}, items), macros: new Coll({}, macros), tables: new Coll({}, tables), scenes: new Coll({}, scenes), journal: new Coll({}, journal) });
  const all = new Map();
  const index = (doc) => {
    if (doc.uuid) all.set(doc.uuid, doc);
    for (const child of [...(doc.effects ?? []), ...(doc.items ?? []), ...(doc.tokens ? [...doc.tokens] : [])]) index(child);
  };
  for (const doc of [...actors, ...items, ...macros, ...tables, ...scenes]) index(doc);
  globalThis.fromUuid = async (uuid) => all.get(uuid) ?? null;
  for (const kind of Object.keys(DEFAULTS)) CONFIG[kind] = { ...CONFIG[kind], documentClass: { DEFAULT_ICON: defaults[kind] } };
  foundry.utils.getRoute = (path) => `/${path}`;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init.method]);
    const path = url.slice(1);
    if (down.includes(path)) throw new TypeError("network");
    const status = gone.includes(path) ? 404 : broken.includes(path) ? 500 : 200;
    return { status, ok: status < 400 };
  };
  return requests;
}

t("a path is checkable only when it is a local, single file", () => {
  assert.equal(checkablePath(" worlds/qq/a.png "), "worlds/qq/a.png");
  assert.equal(checkablePath("/worlds/qq/a.png"), "/worlds/qq/a.png");
  for (const skipped of ["", "   ", null, undefined, 7, "data:image/png;base64,AAAA", "https://qq.example/a.png", "HTTP://qq.example/a.png", "//qq.example/a.png", "blob:qq", "worlds/qq/*.png"]) {
    assert.equal(checkablePath(skipped), null, String(skipped));
  }
});

t("each kind reads its own image fields, and only the checkable ones", () => {
  assert.deepEqual(imagesOf("Actor", actorSource(GONE, "https://qq.example/t.png")), [{ field: "img", path: GONE }]);
  assert.deepEqual(imagesOf("Actor", actorSource(GONE, HERE)).map((i) => i.field), ["img", "prototypeToken.texture.src"]);
  assert.deepEqual(imagesOf("Token", { texture: { src: GONE } }), [{ field: "texture.src", path: GONE }]);
  assert.deepEqual(imagesOf("Item", { img: HERE, texture: { src: GONE } }), [{ field: "img", path: HERE }]);
  assert.deepEqual(imagesOf("Nothing", { img: GONE }), []);
  assert.deepEqual(Object.keys(IMAGE_FIELDS).sort(), ["ActiveEffect", "Actor", "Item", "JournalEntryPage", "Level", "Macro", "RollTable", "Scene", "TableResult", "Token"]);
  assert.deepEqual(imagesOf("Level", { background: { src: GONE }, foreground: { src: null }, fog: { src: GONE_TOO } }).map((i) => i.field), ["background.src", "fog.src"]);
  assert.deepEqual(imagesOf("Scene", { thumb: GONE }), [{ field: "thumb", path: GONE }]);
  assert.deepEqual(imagesOf("JournalEntryPage", { src: GONE }), [{ field: "src", path: GONE }]);
  assert.deepEqual(imagesOf("TableResult", { img: GONE }), [{ field: "img", path: GONE }]);
});

t("a virtual texture path is not a file to ask for", () => {
  assert.equal(checkablePath("#qq-name"), null);
  assert.deepEqual(imagesOf("Level", { background: { src: "#qq-name" } }), []);
});

t("a path several documents name is listed once", () => {
  const entries = [
    { kind: "Item", source: { img: GONE } },
    { kind: "Actor", source: actorSource(GONE, HERE) },
    { kind: "Macro", source: { img: " worlds/qq/gone.png" } },
    { kind: "Item", source: { img: "" } },
  ];
  assert.deepEqual(distinctPaths(entries), [GONE, HERE]);
});

t("the probe runs within its width, reports only a definite not-found, and never reports an unknown", async () => {
  let live = 0;
  let widest = 0;
  const probe = async (path) => {
    live++;
    widest = Math.max(widest, live);
    await new Promise((resolve) => setImmediate(resolve));
    live--;
    if (path === "p-unknown") return null;
    if (path === "p-throws") throw new Error("boom");
    return !path.startsWith("gone-");
  };
  const paths = ["gone-1", "ok-1", "gone-2", "p-unknown", "p-throws", "ok-2", "gone-3", "ok-3"];
  assert.deepEqual([...(await missingPaths(paths, probe, { concurrency: 3 }))].sort(), ["gone-1", "gone-2", "gone-3"]);
  assert.ok(widest <= 3 && widest > 1, `widest ${widest}`);
  assert.deepEqual([...(await missingPaths([], probe))], []);
});

t("a missing image takes the kind's default, and token art takes the actor's image when that is usable", () => {
  const dflt = (kind) => DEFAULTS[kind];
  const gone = new Set([GONE, GONE_TOO]);
  assert.equal(planRepair({ kind: "Item", source: { img: HERE } }, gone, dflt), null);
  assert.deepEqual(planRepair({ kind: "Item", source: { img: GONE } }, gone, dflt), { paths: [GONE], update: { img: DEFAULTS.Item } });
  assert.deepEqual(planRepair({ kind: "Actor", source: actorSource(HERE, GONE) }, gone, dflt).update, { "prototypeToken.texture.src": HERE });
  assert.deepEqual(planRepair({ kind: "Actor", source: actorSource(GONE, GONE_TOO) }, gone, dflt).update, { img: DEFAULTS.Actor, "prototypeToken.texture.src": DEFAULTS.Actor });
  assert.deepEqual(planRepair({ kind: "Actor", source: actorSource(GONE, HERE) }, gone, dflt).update, { img: DEFAULTS.Actor });
  assert.deepEqual(planRepair({ kind: "Token", source: { texture: { src: GONE } }, ownerImg: HERE }, gone, dflt).update, { "texture.src": HERE });
  for (const ownerImg of [GONE_TOO, "", undefined]) {
    assert.deepEqual(planRepair({ kind: "Token", source: { texture: { src: GONE } }, ownerImg }, gone, dflt).update, { "texture.src": DEFAULTS.Token });
  }
  assert.deepEqual(planRepair({ kind: "Token", source: { texture: { src: GONE } }, ownerImg: "https://qq.example/a.png" }, gone, dflt).update, { "texture.src": "https://qq.example/a.png" });
  assert.deepEqual(planRepair({ kind: "Item", source: { img: GONE } }, gone, () => null), { paths: [GONE], update: null });
});

t("a world whose images are all there lists nothing, and asks the server once per distinct local file with HEAD", async () => {
  const requests = imageWorld({
    actors: [
      imgDoc("Actor.a1", "Hero", actorSource(HERE, HERE), { items: [imgDoc("Actor.a1.Item.i1", "Blade", { img: HERE })] }),
      imgDoc("Actor.a2", "Twin", actorSource(HERE, "https://qq.example/t.png")),
    ],
    items: [imgDoc("Item.i2", "Coil", { img: "data:image/png;base64,AAAA" }), imgDoc("Item.i3", "Bare", { img: "" })],
  });
  assert.deepEqual(await IMAGES.scan(), []);
  assert.deepEqual(requests, [[`/${HERE}`, "HEAD"]]);
});

t("a dead path many documents name is asked for once, and a path no document names is never asked for", async () => {
  const requests = imageWorld({
    actors: [imgDoc("Actor.a1", "Hero", actorSource(GONE, GONE_TOO), { items: [imgDoc("Actor.a1.Item.i1", "Blade", { img: GONE })] })],
    items: [imgDoc("Item.i2", "Coil", { img: GONE }), imgDoc("Item.i3", "Rope", { img: GONE_TOO })],
  });
  assert.equal((await IMAGES.scan()).length, 4);
  assert.deepEqual(requests.map(([url, method]) => `${method} ${url}`).sort(), [`HEAD /${GONE_TOO}`, `HEAD /${GONE}`]);
});

t("every kind of document is read, and each finding names its document as the other checks print it", async () => {
  const fx = (n, img) => imgDoc(`E.${n}`, `Glow ${n}`, { img });
  const slot = imgDoc("Actor.a1.Item.i1", "Blade", { img: GONE }, { effects: [fx("i", GONE)] });
  const tok = imgDoc("Scene.s1.Token.t1", "Scout", { texture: { src: GONE } }, { baseActor: { _source: { img: HERE } } });
  imageWorld({
    actors: [imgDoc("Actor.a1", "Hero", actorSource(GONE, HERE), { items: [slot], effects: [fx("a", GONE)] })],
    items: [imgDoc("Item.i2", "Coil", { img: GONE }, { effects: [fx("w", GONE)] })],
    macros: [imgDoc("Macro.m1", "Roll It", { img: GONE })],
    tables: [imgDoc("RollTable.r1", "Omens", { img: GONE })],
    scenes: [{ name: "Yard", tokens: new Coll({}, [tok]) }],
  });
  const found = await IMAGES.scan();
  assert.deepEqual(found.map((f) => [f.key, f.name, f.detail, f.update]), [
    ["Actor.a1", "Hero", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.Actor }],
    ["E.a", "Hero → Glow a", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.ActiveEffect }],
    ["Actor.a1.Item.i1", "Hero → Blade", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.Item }],
    ["E.i", "Hero → Blade → Glow i", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.ActiveEffect }],
    ["Item.i2", "Coil", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.Item }],
    ["E.w", "Coil → Glow w", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.ActiveEffect }],
    ["Macro.m1", "Roll It", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.Macro }],
    ["RollTable.r1", "Omens", said(IMG_DETAIL, { paths: GONE }), { img: DEFAULTS.RollTable }],
    ["Scene.s1.Token.t1", "Yard → Scout", said(IMG_DETAIL, { paths: GONE }), { "texture.src": HERE }],
  ]);
});

t("a document with two missing images names both in one finding", async () => {
  imageWorld({ actors: [imgDoc("Actor.a1", "Hero", actorSource(GONE, GONE_TOO))] });
  const found = await IMAGES.scan();
  assert.equal(found.length, 1);
  assert.equal(found[0].detail, said(IMG_DETAIL, { paths: `${GONE}, ${GONE_TOO}` }));
  assert.deepEqual(found[0].update, { img: DEFAULTS.Actor, "prototypeToken.texture.src": DEFAULTS.Actor });
});

t("a server error or an unreachable server never reports an image missing", async () => {
  imageWorld({
    items: [imgDoc("Item.i1", "Flaky", { img: "qq/five-hundred.png" }), imgDoc("Item.i2", "Cut Off", { img: "qq/cut-off.png" }), imgDoc("Item.i3", "Gone", { img: GONE })],
    broken: ["qq/five-hundred.png"],
    down: ["qq/cut-off.png"],
  });
  assert.deepEqual(await keys(IMAGES), ["Item.i3"]);
});

t("the fix writes the update once per document, and the rescan finds none", async () => {
  const hero = imgDoc("Actor.a1", "Hero", actorSource(GONE, GONE_TOO));
  const coil = imgDoc("Item.i2", "Coil", { img: GONE });
  imageWorld({ actors: [hero], items: [coil] });
  const found = (await scanCheck(IMAGES)).findings;
  assert.deepEqual(found.map((f) => f.fixable), [true, true]);
  const outcome = await fixCheck(IMAGES, found);
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual(outcome.fixed.map((f) => [f.key, f.summary]), [["Actor.a1", IMG_DONE], ["Item.i2", IMG_DONE]]);
  assert.deepEqual(outcome.rescan.findings, []);
  assert.deepEqual(hero.updates, [{ img: DEFAULTS.Actor, "prototypeToken.texture.src": DEFAULTS.Actor }]);
  assert.deepEqual(coil.updates, [{ img: DEFAULTS.Item }]);
});

t("a document gone before the fix is refused, and the rest are written", async () => {
  const a = imgDoc("Item.i1", "Gone Soon", { img: GONE });
  const b = imgDoc("Item.i2", "Stays", { img: GONE });
  imageWorld({ items: [a, b] });
  const found = (await scanCheck(IMAGES)).findings;
  const real = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === "Item.i1" ? null : real(uuid));
  const outcome = await fixCheck(IMAGES, found);
  assert.deepEqual(outcome.failed.map((f) => [f.key, f.why, f.error]), [["Item.i1", "refused", said("ACKS-LIB.repair.subjectGone")]]);
  assert.deepEqual(outcome.fixed.map((f) => f.key), ["Item.i2"]);
  assert.deepEqual(a.updates, []);
});

t("a scene's images, a journal page's file and a table result's image are listed and never offered", async () => {
  const level = imgDoc("Scene.s1.Level.l1", "Ground", { background: { src: GONE }, foreground: { src: HERE }, fog: { src: GONE_TOO } });
  const scene = imgDoc("Scene.s1", "Yard", { thumb: GONE }, { levels: new Coll({}, [level]), tokens: new Coll() });
  const page = imgDoc("JournalEntry.j1.JournalEntryPage.p1", "Map Page", { src: GONE });
  const entry = imgDoc("JournalEntry.j1", "Notes", {}, { pages: new Coll({}, [page]) });
  const result = imgDoc("RollTable.r1.TableResult.t1", "", { img: GONE });
  const table = imgDoc("RollTable.r1", "Omens", { img: HERE }, { results: new Coll({}, [result]) });
  result.id = "t1";
  imageWorld({ scenes: [scene], journal: [entry], tables: [table] });
  const { findings } = await scanCheck(IMAGES);
  assert.deepEqual(findings.map((f) => [f.key, f.name, f.fixable, f.reason, f.update]), [
    ["RollTable.r1.TableResult.t1", "Omens → t1", false, IMG_NO_DEFAULT, null],
    ["JournalEntry.j1.JournalEntryPage.p1", "Notes → Map Page", false, IMG_NO_DEFAULT, null],
    ["Scene.s1", "Yard", false, IMG_NO_DEFAULT, null],
    ["Scene.s1.Level.l1", "Yard → Ground", false, IMG_NO_DEFAULT, null],
  ]);
  assert.equal(findings[3].detail, said(IMG_DETAIL, { paths: `${GONE}, ${GONE_TOO}` }));
  const outcome = await fixCheck(IMAGES, findings);
  assert.deepEqual([outcome.fixed, outcome.failed], [[], []], "none is fixable, so nothing is handed to the fix");
});

t("a kind with no default image is listed and not offered", async () => {
  imageWorld({ items: [imgDoc("Item.i1", "Coil", { img: GONE })], defaults: { ...DEFAULTS, Item: undefined } });
  const { findings } = await scanCheck(IMAGES);
  assert.deepEqual(findings.map((f) => [f.key, f.fixable, f.reason]), [["Item.i1", false, IMG_NO_DEFAULT]]);
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log(`ok - ${name}`);
}
console.log(`\n${n} tests passed`);
