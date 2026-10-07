/**
 * Lib's two report-only repair checks (scripts/lib/repair-checks.mjs): what
 * `lib.strandedCoin` lists and the reason it gives, and the documents that
 * cannot load which `lib.mergeResidue` lists. Both read `game` when they scan
 * and nothing as the module loads, so one stand-in world is the whole mock.
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
import { fixCheck, getRepairCheck, scanCheck } from "../scripts/lib/repair-logic.mjs";
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
/** A sub-type of one of the retired acks-* modules. */
const RETIRED = "acks-henchmen.former";
/** The modules the stand-in world has installed, unless a test says otherwise. */
const MODULES = { "loose-leaf": { active: false, title: "Loose Leaf" }, "wide-margin": { active: true, title: "Wide Margin" } };
/** One money row: seven carried, none banked. */
const PURSE = [coin("Brass Bit", 7, 0)];

// The lang keys the two scans answer with.
const DETAIL = "ACKS-LIB.repair.check.strandedCoin.detail";
const REPORT_ONLY = "ACKS-LIB.repair.check.strandedCoin.reportOnly";
const ENABLE = "ACKS-LIB.repair.enablePackage";
const INVALID = "ACKS-LIB.repair.check.mergeResidue.invalid";
const VIA_MACRO = "ACKS-LIB.repair.check.mergeResidue.viaMacro";
const HOLDS_COIN = "ACKS-LIB.repair.check.mergeResidue.holdsCoin";
const REGION_REPORT = "ACKS-LIB.repair.check.mergeResidue.regionReport";

registerLibRepairChecks();
const COIN = getRepairCheck("lib.strandedCoin");
const RESIDUE = getRepairCheck("lib.mergeResidue");

/* -------------------------------------------------------------------- */
/*  lib.strandedCoin                                                    */
/* -------------------------------------------------------------------- */

t("a world with nothing it could not load lists nothing", async () => {
  world({ modules: MODULES });
  assert.deepEqual(await COIN.scan(), []);
  assert.deepEqual(await RESIDUE.scan(), []);
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

t("a retired acks-* module is never named, installed or not", async () => {
  const actors = { a1: actor("Shut Out", RETIRED, PURSE) };
  for (const modules of [{}, { "acks-henchmen": { active: false, title: "Old Henchmen" } }]) {
    world({ modules, actors });
    assert.deepEqual(await keyed(COIN, "reason"), [["Actor.a1", said(REPORT_ONLY)]]);
  }
});

t("an actor of a core type, of the system's namespace or of an active module is not listed", async () => {
  world({
    modules: { ...MODULES, "acks-henchmen": { active: true, title: "Old Henchmen" } },
    actors: {
      a1: actor("Core", "character", PURSE),
      a2: actor("No type", undefined, PURSE),
      a3: actor("System", "acks.clerk", PURSE),
      a4: actor("Active", ACTIVE, PURSE),
      a5: actor("Retired and active", RETIRED, PURSE),
      a6: actor("Shut Out", ABSENT, PURSE),
    },
  });
  assert.deepEqual(await keys(COIN), ["Actor.a6"]);
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
  const rows = [coin("Brass Bit", 4, 9), { name: "Rope", type: "item", system: { quantity: 2 } }, coin("Tin Chit", "3"), { type: "money" }];
  world({ actors: { a1: actor("Shut Out", ABSENT, rows) } });
  assert.deepEqual(await keyed(COIN, "detail"), [["Actor.a1", said(DETAIL, { type: ABSENT, coin: "13 × Brass Bit, 3 × Tin Chit, 0 × ?" })]]);
});

t("a money row that counts nothing still lists its actor", async () => {
  world({ actors: { a1: actor("Shut Out", ABSENT, [coin("Brass Bit", 0, 0)]) } });
  assert.deepEqual(await keyed(COIN, "detail"), [["Actor.a1", said(DETAIL, { type: ABSENT, coin: "0 × Brass Bit" })]]);
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

t("neither check has a fix, and no finding of the coin check is offered", async () => {
  world({ modules: MODULES, actors: { a1: actor("Shut Out", ABSENT, PURSE), a2: actor("Shut Out Too", DISABLED, PURSE) } });
  assert.equal(COIN.fix, null);
  assert.equal(RESIDUE.fix, null);
  assert.ok((await COIN.scan()).every((f) => f.uuid === null && !("fixable" in f)));
  const { findings, error } = await scanCheck(COIN);
  assert.equal(error, null);
  assert.deepEqual(findings.map((f) => [f.key, f.uuid, f.fixable]), [["Actor.a1", null, false], ["Actor.a2", null, false]]);
  await assert.rejects(() => fixCheck(COIN, findings), /report-only/);
});

/* -------------------------------------------------------------------- */
/*  lib.mergeResidue: the documents that cannot load                    */
/* -------------------------------------------------------------------- */

t("an Actor or Item of a retired module's sub-type is residue the cleaner macro removes", async () => {
  world({ actors: { a1: actor("Old Hand", RETIRED, []) }, items: { i1: { name: "Old Ledger", type: "acks-equipment.former" } } });
  assert.deepEqual(await RESIDUE.scan(), [
    { key: "invalid:Actor:a1", uuid: null, name: "Old Hand", detail: said(INVALID, { doc: "Actor", type: RETIRED }), reason: said(VIA_MACRO) },
    { key: "invalid:Item:i1", uuid: null, name: "Old Ledger", detail: said(INVALID, { doc: "Item", type: "acks-equipment.former" }), reason: said(VIA_MACRO) },
  ]);
});

t("a residue actor that holds coin names the coin in place of the macro", async () => {
  world({ actors: { a1: actor("Old Hand", RETIRED, [coin("Brass Bit", 4, 9)]) } });
  assert.deepEqual(await keyed(RESIDUE, "reason"), [["invalid:Actor:a1", said(HOLDS_COIN, { coin: "13 × Brass Bit" })]]);
});

t("a residue document with no name is listed under its id", async () => {
  world({ items: { i1: { type: "acks-equipment.former" } } });
  assert.deepEqual(await keyed(RESIDUE, "name"), [["invalid:Item:i1", "i1"]]);
});

t("a region behaviour of a retired sub-type is residue no tool removes", async () => {
  const behaviors = new Coll({ b1: { name: "Old Trigger", type: "acks-location.former" }, b2: { name: "Stray Trigger", type: "ghost-press.trigger" } });
  const yard = { name: "Yard", tokens: new Coll(), regions: new Coll({}, [{ uuid: "Scene.s1.Region.r1", behaviors }]) };
  world({ scenes: [yard, { name: "Lane", tokens: new Coll() }] });
  assert.deepEqual(await RESIDUE.scan(), [
    {
      key: "invalid:Scene.s1.Region.r1:b1",
      uuid: null,
      name: "Old Trigger",
      detail: said(INVALID, { doc: "RegionBehavior", type: "acks-location.former" }),
      reason: said(REGION_REPORT),
    },
  ]);
});

t("a document of any other sub-type is not residue", async () => {
  world({
    modules: MODULES,
    actors: {
      a1: actor("Shut Out", ABSENT, PURSE),
      a2: actor("Shut Out Too", DISABLED, PURSE),
      a3: actor("Core", "character", PURSE),
      a4: actor("Old Hand", RETIRED, []),
    },
    items: { i1: { name: "Stray", type: "ghost-press.trinket" } },
  });
  assert.deepEqual(await keys(RESIDUE), ["invalid:Actor:a4"]);
});

t("the residue scan skips a source the collection cannot hand over", async () => {
  world({ actors: { a1: unreadable, a2: actor("Old Hand", RETIRED, []) }, items: { i1: () => undefined } });
  assert.deepEqual(await keys(RESIDUE), ["invalid:Actor:a2"]);
});

t("a retired module's actor that holds coin is on both lists, and both name the same coin", async () => {
  world({ actors: { a1: actor("Old Hand", RETIRED, [coin("Brass Bit", 4, 9), coin("Tin Chit", 2, 0)]) } });
  const held = "13 × Brass Bit, 2 × Tin Chit";
  assert.deepEqual(await keyed(COIN, "detail"), [["Actor.a1", said(DETAIL, { type: RETIRED, coin: held })]]);
  assert.deepEqual(await keyed(RESIDUE, "reason"), [["invalid:Actor:a1", said(HOLDS_COIN, { coin: held })]]);
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log(`ok - ${name}`);
}
console.log(`\n${n} tests passed`);
