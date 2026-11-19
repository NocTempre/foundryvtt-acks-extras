/**
 * The Hazard item and what a place's hazards seed into the party's crossing
 * (`scripts/formation/hazard-keys.mjs`, `hazard-logic.mjs`, `data/hazard-data.mjs`,
 * `hazard-sheet.mjs`, and the Hazards pack `tools/pack-data/formation.mjs`
 * builds). Foundry's field classes record their options and the places' things
 * are invented, in the shape lib's `normalizeThings` returns (every key present,
 * `params` and `state` objects); no book is imported and no figure is a printed one.
 *
 * What this pins: every hazard key has a label and an icon, and the keys are the
 * crossing's own kinds and conditions; the `key` field is blank-allowed and its
 * choices never throw where no `game` stands; a seed carries a thing's figures
 * through the sheet's readers, and the union of its places' conditions where the
 * obstacle's kind reads them; a squeeze's shape and a swim's penalty pick (with its
 * larger figure) are carried only where valid and listed, and `movement` and
 * `judgeMod` never are; a blank, unknown or mismatched thing seeds nothing;
 * the per-kind key lists are the party sheet's own controls for each kind; and
 * the pack holds one hazard per key under the module's id prefix.
 *
 * Run: node tools/test-hazard.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- stand-ins -------------------------------------------------------------- */
class Stub {}
/** A field class that keeps the options it was built with. */
const field = (kind) => class { constructor(options = {}) { this.kind = kind; this.options = options; } };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class { static defineSchema() { return {}; } } },
  // crossing.mjs reaches the zone modules, whose classes extend the region behaviour base at load.
  data: {
    regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } },
    fields: { StringField: field("string"), HTMLField: field("html") },
    operators: {},
  },
  utils: { deepClone: (v) => JSON.parse(JSON.stringify(v)), randomID: () => "id" },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    sheets: { ItemSheetV2: Stub },
    handlebars: {},
  },
};
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

const crossing = await import("../scripts/formation/crossing.mjs");
const { SETUP_FIELDS, JUMP_KIND, SWIM_KIND, SQUEEZE_KIND, CROSSING_KINDS } = crossing;
const { OBSTACLES } = await import("../scripts/formation/obstacles.mjs");
const { WATER } = await import("../scripts/formation/swimming.mjs");
const { HAZARD_ITEM_TYPE } = await import("../scripts/formation/constants.mjs");
const keys = await import("../scripts/formation/hazard-keys.mjs");
const logic = await import("../scripts/formation/hazard-logic.mjs");
const { default: HazardData } = await import("../scripts/formation/data/hazard-data.mjs");
const { kindGroups } = await import("../scripts/formation/hazard-sheet.mjs");
const { buildHazards } = await import("./pack-data/formation.mjs");
const { OBSTACLE_HAZARDS, CONDITION_HAZARDS, HAZARD_KEYS, HAZARD_ICONS, hazardLabelKey, hazardGroupOf, hazardChoices } = keys;
const { crossingSeed, seedFromPlaces, setupKeysOf, penaltyPicksOf, KIND_SETUP_KEYS, CONDITION_SETUP } = logic;

const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(new URL("../module.json", import.meta.url), "utf8"));
/** A lang key's text: the file holds flat dotted keys and nested blocks. */
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};

/** A thing in the normalized shape: every key present, `params` and `state` objects. */
const thing = (id, kind, ref, params = {}) => ({ id, kind, ref, hidden: false, hint: null, point: null, params, layers: {}, state: {} });
/** A resolver over invented refs: `ref:<key>` is the hazard with that key, anything else is no hazard. */
const hazardKeyOf = (ref) => (typeof ref === "string" && ref.startsWith("ref:") ? ref.slice(4) || null : null);
const obstacle = (id, key, params) => thing(id, "obstacle", `ref:${key}`, params);
const condition = (id, key) => thing(id, "condition", `ref:${key}`);

/* --- the keys --------------------------------------------------------------- */
await ok("every hazard key has a label that exists, an icon and a group", () => {
  assert.equal(new Set(HAZARD_KEYS).size, HAZARD_KEYS.length);
  for (const key of HAZARD_KEYS) {
    assert.equal(typeof lookup(hazardLabelKey(key)), "string", key);
    assert.match(HAZARD_ICONS[key], /^icons\/svg\/[a-z-]+\.svg$/, key);
    assert.ok(["obstacle", "condition"].includes(hazardGroupOf(key)), key);
  }
  assert.equal(hazardLabelKey("nowhere"), null);
  assert.equal(hazardGroupOf("nowhere"), null);
  assert.deepEqual(Object.keys(HAZARD_ICONS).sort(), [...HAZARD_KEYS].sort());
});

await ok("the obstacle keys are the crossing's own kinds and the condition keys are setup keys", () => {
  assert.deepEqual(OBSTACLE_HAZARDS, CROSSING_KINDS);
  assert.deepEqual(OBSTACLE_HAZARDS.slice(0, Object.keys(OBSTACLES).length), Object.keys(OBSTACLES));
  assert.deepEqual(OBSTACLE_HAZARDS.slice(-3), [JUMP_KIND, SWIM_KIND, SQUEEZE_KIND]);
  assert.deepEqual(CONDITION_HAZARDS, ["ropeFixed", "noRunUp", "precarious", "waterCold", "waterRough", "waterFast"]);
  assert.deepEqual(Object.keys(CONDITION_SETUP), CONDITION_HAZARDS);
  for (const setup of Object.values(CONDITION_SETUP)) for (const key of Object.keys(setup)) assert.ok(key in SETUP_FIELDS, key);
});

await ok("each condition's water and rope keys line up with the crossing's own", () => {
  for (const water of Object.keys(WATER)) assert.ok(CONDITION_HAZARDS.includes(`water${water[0].toUpperCase()}${water.slice(1)}`), water);
});

await ok("the Hazard type is declared, labelled and its dead region type is gone", () => {
  assert.equal(HAZARD_ITEM_TYPE, "acks-extras.hazard");
  assert.ok("hazard" in MANIFEST.documentTypes.Item);
  assert.ok(MANIFEST.documentTypes.Item.hazard.htmlFields.includes("description"));
  assert.equal(typeof LANG.TYPES.Item[HAZARD_ITEM_TYPE], "string");
  assert.ok(!("crossingObstacle" in MANIFEST.documentTypes.RegionBehavior));
  assert.ok(!(`acks-extras.crossingObstacle` in LANG.TYPES.RegionBehavior));
  assert.ok(!("CROSSING_OBSTACLE" in LANG["ACKS-FORMATION"]));
});

await ok("every string the sheet shows exists", () => {
  for (const key of ["sheet", "none", "imageHint", "noRunUp", "group.obstacle", "group.condition", "field.name", "field.kind", "field.description", "hint.kind", "noFigures"]) {
    assert.equal(typeof lookup(`ACKS-FORMATION.HAZARD.${key}`), "string", key);
  }
  const template = fs.readFileSync(new URL("../templates/formation/hazard-item.hbs", import.meta.url), "utf8");
  for (const [, key] of template.matchAll(/localize '(ACKS-FORMATION\.HAZARD\.[\w.]+)'/g)) assert.equal(typeof lookup(key), "string", key);
  assert.ok(!/\bid=/.test(template));
  assert.ok(/class="[^"]*acks-extras-hazard/.test(template));
});

/* --- the data model --------------------------------------------------------- */
await ok("the key field is blank-allowed, starts blank, and its choices cover every key", () => {
  const schema = HazardData.defineSchema();
  assert.equal(schema.key.options.blank, true);
  assert.equal(schema.key.options.initial, "");
  assert.deepEqual(Object.keys(schema.key.options.choices()), HAZARD_KEYS);
  assert.equal(schema.description.kind, "html");
});

await ok("the choices function does not throw where no game stands, and localizes through one", () => {
  assert.equal(typeof globalThis.game, "undefined");
  const choices = HazardData.defineSchema().key.options.choices();
  for (const key of HAZARD_KEYS) assert.equal(choices[key], hazardLabelKey(key), key);
  globalThis.game = { i18n: { localize: (k) => `<${k}>` } };
  try {
    assert.equal(HazardData.defineSchema().key.options.choices().jump, `<${hazardLabelKey("jump")}>`);
  } finally { delete globalThis.game; }
});

await ok("the Kind select groups obstacles before conditions and marks the stored key", () => {
  const groups = kindGroups("noRunUp", (k) => `<${k}>`);
  assert.deepEqual(groups.map((g) => g.options.map((o) => o.value)), [OBSTACLE_HAZARDS, CONDITION_HAZARDS]);
  assert.deepEqual(groups.flatMap((g) => g.options).filter((o) => o.selected).map((o) => o.value), ["noRunUp"]);
  assert.deepEqual(hazardChoices((k) => k), Object.fromEntries(HAZARD_KEYS.map((k) => [k, hazardLabelKey(k)])));
  assert.equal(kindGroups("", (k) => k).flatMap((g) => g.options).filter((o) => o.selected).length, 0);
});

/* --- the seed --------------------------------------------------------------- */
await ok("an obstacle seeds its kind and its figures through the sheet's readers", () => {
  const seeds = crossingSeed([obstacle("t1", "sheerClimb", { length: 40, gap: null, depth: 12.5 })], hazardKeyOf);
  assert.deepEqual(seeds, [{ thingId: "t1", kind: "sheerClimb", setup: { length: 40, depth: 12.5 } }]);
  for (const [key, value] of Object.entries(seeds[0].setup)) assert.equal(SETUP_FIELDS[key](value), value, key);
});

await ok("a blank, null or refused figure is absent", () => {
  const [seed] = crossingSeed([obstacle("t1", JUMP_KIND, { length: "", gap: 0, depth: -3 })], hazardKeyOf);
  assert.deepEqual(seed.setup, {});
  assert.deepEqual(crossingSeed([obstacle("t1", JUMP_KIND, {})], hazardKeyOf)[0].setup, {});
});

await ok("each crossing kind is what beginCrossing accepts", () => {
  for (const kind of OBSTACLE_HAZARDS) {
    const [seed] = crossingSeed([obstacle("t1", kind)], hazardKeyOf);
    assert.equal(seed.kind, kind);
    assert.ok(CROSSING_KINDS.includes(seed.kind));
  }
});

await ok("a condition lands under the key the crossing reads", () => {
  const list = (key) => crossingSeed([obstacle("t1", JUMP_KIND), condition("c1", key)], hazardKeyOf)[0].setup;
  assert.deepEqual(list("noRunUp"), { runUp: false });
  assert.deepEqual(list("precarious"), { precarious: true });
  assert.deepEqual(list("ropeFixed"), { ropeFixed: true });
  const water = (key) => crossingSeed([obstacle("t1", SWIM_KIND), condition("c1", key)], hazardKeyOf)[0].setup;
  assert.deepEqual(water("waterCold"), { waterCold: true });
  assert.deepEqual(water("waterRough"), { waterRough: true });
  assert.deepEqual(water("waterFast"), { waterFast: true });
});

await ok("conditions stack: the union of every condition on the list is seeded", () => {
  const [seed] = crossingSeed([
    condition("c1", "precarious"), obstacle("t1", JUMP_KIND, { gap: 9 }), condition("c2", "noRunUp"), condition("c3", "ropeFixed"), condition("c4", "ropeFixed"),
  ], hazardKeyOf);
  assert.deepEqual(seed.setup, { gap: 9, runUp: false, precarious: true, ropeFixed: true });
});

await ok("a condition the kind does not read is dropped", () => {
  const all = CONDITION_HAZARDS.map((key, i) => condition(`c${i}`, key));
  assert.deepEqual(crossingSeed([obstacle("t1", SWIM_KIND), ...all], hazardKeyOf)[0].setup, { waterCold: true, waterRough: true, waterFast: true });
  assert.deepEqual(crossingSeed([obstacle("t1", SQUEEZE_KIND), ...all], hazardKeyOf)[0].setup, {});
  assert.deepEqual(crossingSeed([obstacle("t1", "easyClimb"), ...all], hazardKeyOf)[0].setup, { ropeFixed: true });
  assert.deepEqual(crossingSeed([obstacle("t1", JUMP_KIND), ...all], hazardKeyOf)[0].setup, { runUp: false, precarious: true, ropeFixed: true });
});

await ok("several obstacles in one list give several entries, in list order, each with its own figures", () => {
  const seeds = crossingSeed([
    obstacle("t1", "crawl", { length: 20 }), condition("c1", "ropeFixed"), obstacle("t2", JUMP_KIND, { gap: 8 }), obstacle("t3", "crawl", { length: 5 }),
  ], hazardKeyOf);
  assert.deepEqual(seeds, [
    { thingId: "t1", kind: "crawl", setup: { length: 20, ropeFixed: true } },
    { thingId: "t2", kind: "jump", setup: { gap: 8, ropeFixed: true } },
    { thingId: "t3", kind: "crawl", setup: { length: 5, ropeFixed: true } },
  ]);
});

await ok("seeds are independent: one entry's setup is not another's object", () => {
  const seeds = crossingSeed([obstacle("t1", JUMP_KIND), obstacle("t2", JUMP_KIND), condition("c1", "precarious")], hazardKeyOf);
  seeds[0].setup.gap = 1;
  assert.ok(!("gap" in seeds[1].setup));
});

await ok("conditions union across the places the party stands in", () => {
  const here = [obstacle("t1", JUMP_KIND, { gap: 6 }), condition("c1", "precarious")];
  const there = [condition("c2", "noRunUp"), obstacle("t2", "rappel", { depth: 30 })];
  const seeds = seedFromPlaces([here, there], hazardKeyOf);
  assert.deepEqual(seeds, [
    { thingId: "t1", kind: "jump", setup: { gap: 6, runUp: false, precarious: true } },
    { thingId: "t2", kind: "rappel", setup: { depth: 30 } },
  ]);
  assert.deepEqual(seedFromPlaces([], hazardKeyOf), []);
  assert.deepEqual(seedFromPlaces([[], []], hazardKeyOf), []);
});

await ok("a blank key, an unknown ref, a mismatched kind and a malformed list seed nothing", () => {
  const unresolved = [
    thing("a", "obstacle", "ref:"), thing("b", "obstacle", "elsewhere:1"), thing("c", "obstacle", null), thing("d", "obstacle", "ref:nowhere"),
    thing("e", "condition", "ref:nowhere"), thing("f", "trap", "ref:jump"), thing("g", "obstacle", "ref:ropeFixed"), thing("h", "condition", "ref:jump"),
  ];
  assert.deepEqual(crossingSeed(unresolved, hazardKeyOf), []);
  const [seed] = crossingSeed([...unresolved.filter((t) => t.id !== "h"), obstacle("t1", JUMP_KIND), condition("c1", "ropeFixed")], hazardKeyOf);
  assert.deepEqual(seed.setup, { ropeFixed: true });
  assert.deepEqual(crossingSeed(null, hazardKeyOf), []);
  assert.deepEqual(crossingSeed(undefined, hazardKeyOf), []);
  assert.deepEqual(seedFromPlaces(null, hazardKeyOf), []);
});

/** The water-penalty picks the world holds for these checks: the structural two and two invented steps. */
const PICKS = { penaltyPicks: penaltyPicksOf([7, 12.5]) };

await ok("the picks accepted are the structural two and one string per imported step", () => {
  assert.deepEqual(penaltyPicksOf(null), ["none", "larger"]);
  assert.deepEqual(penaltyPicksOf(undefined), ["none", "larger"]);
  assert.deepEqual(penaltyPicksOf([7, 12.5]), ["none", "larger", "7", "12.5"]);
});

await ok("a squeeze's shape is carried when it names a shape the crossing knows", () => {
  const shape = (value) => crossingSeed([obstacle("t1", SQUEEZE_KIND, { shape: value })], hazardKeyOf)[0].setup;
  assert.deepEqual(shape("squeeze"), { shape: "squeeze" });
  assert.deepEqual(shape("chokepoint"), { shape: "chokepoint" });
  assert.deepEqual(shape(" squeeze "), { shape: "squeeze" });
  assert.deepEqual(crossingSeed([obstacle("t1", SQUEEZE_KIND, { length: 6, shape: "squeeze" })], hazardKeyOf)[0].setup, { length: 6, shape: "squeeze" });
});

await ok("a blank, junk or non-string shape stays absent, never coerced to a default", () => {
  for (const value of ["", null, undefined, "tight", "Squeeze", 3, true, {}, []]) {
    assert.deepEqual(crossingSeed([obstacle("t1", SQUEEZE_KIND, { shape: value })], hazardKeyOf)[0].setup, {}, JSON.stringify(value));
  }
  assert.deepEqual(crossingSeed([obstacle("t1", SQUEEZE_KIND, {})], hazardKeyOf)[0].setup, {});
});

await ok("a shape is ignored on every kind that does not read one", () => {
  for (const kind of OBSTACLE_HAZARDS.filter((k) => k !== SQUEEZE_KIND)) {
    assert.ok(!("shape" in crossingSeed([obstacle("t1", kind, { shape: "squeeze" })], hazardKeyOf)[0].setup), kind);
  }
});

await ok("a swim's penalty pick is carried when the caller lists it: none, larger and each imported step", () => {
  const pick = (value, options = PICKS) => crossingSeed([obstacle("t1", SWIM_KIND, { penaltyPick: value })], hazardKeyOf, options)[0].setup;
  assert.deepEqual(pick("none"), { penaltyPick: "none" });
  assert.deepEqual(pick("7"), { penaltyPick: "7" });
  assert.deepEqual(pick(12.5), { penaltyPick: "12.5" }, "a number is stored as the string the sheet's select stores");
  assert.deepEqual(pick(" 7 "), { penaltyPick: "7" });
  assert.deepEqual(pick("larger", { penaltyPicks: penaltyPicksOf(null) }), { penaltyPick: "larger" }, "the structural picks need no import");
  assert.equal(SETUP_FIELDS.penaltyPick(pick("7").penaltyPick), "7", "the crossing reads it back unchanged");
});

await ok("a penalty pick the caller does not list is absent: a step not imported, junk, blank, or no list given", () => {
  const pick = (value, options = PICKS) => crossingSeed([obstacle("t1", SWIM_KIND, { penaltyPick: value })], hazardKeyOf, options)[0].setup;
  for (const value of ["9", 9, "bogus", "", null, undefined, {}, ["7"]]) assert.deepEqual(pick(value), {}, JSON.stringify(value));
  assert.deepEqual(pick("7", { penaltyPicks: penaltyPicksOf(null) }), {}, "no steps imported, so no step is valid");
  assert.deepEqual(crossingSeed([obstacle("t1", SWIM_KIND, { penaltyPick: "none" })], hazardKeyOf)[0].setup, {}, "no list given seeds no pick");
  assert.deepEqual(pick("larger", {}), {});
});

await ok("a penalty pick is ignored on every kind that does not read one", () => {
  for (const kind of OBSTACLE_HAZARDS.filter((k) => k !== SWIM_KIND)) {
    const setup = crossingSeed([obstacle("t1", kind, { penaltyPick: "larger", penaltyLarger: 15 })], hazardKeyOf, PICKS)[0].setup;
    assert.ok(!("penaltyPick" in setup) && !("penaltyLarger" in setup), kind);
  }
});

await ok("the larger figure rides only on a pick of larger, and only as a positive number", () => {
  const swim = (params) => crossingSeed([obstacle("t1", SWIM_KIND, params)], hazardKeyOf, PICKS)[0].setup;
  assert.deepEqual(swim({ penaltyPick: "larger", penaltyLarger: 15 }), { penaltyPick: "larger", penaltyLarger: 15 });
  assert.deepEqual(swim({ penaltyPick: "larger", penaltyLarger: "15" }), { penaltyPick: "larger", penaltyLarger: 15 });
  for (const value of ["", null, undefined, 0, -4, "abc"]) assert.deepEqual(swim({ penaltyPick: "larger", penaltyLarger: value }), { penaltyPick: "larger" }, JSON.stringify(value));
  assert.deepEqual(swim({ penaltyPick: "7", penaltyLarger: 15 }), { penaltyPick: "7" }, "a step pick ignores the figure");
  assert.deepEqual(swim({ penaltyPick: "none", penaltyLarger: 15 }), { penaltyPick: "none" });
  assert.deepEqual(swim({ penaltyLarger: 15 }), {}, "no pick, no figure");
  assert.deepEqual(swim({ penaltyPick: "9", penaltyLarger: 15 }), {}, "an unlisted pick takes no figure with it");
});

await ok("movement and judgeMod in a thing's params are never seeded, on any kind", () => {
  const params = { movement: "running", judgeMod: 3, penaltyPick: "larger", penaltyLarger: 15, shape: "squeeze" };
  for (const kind of OBSTACLE_HAZARDS) {
    const setup = crossingSeed([obstacle("t1", kind, params)], hazardKeyOf, PICKS)[0].setup;
    assert.ok(!("movement" in setup) && !("judgeMod" in setup), kind);
  }
});

await ok("the card's figures stay the three numerics and the swim row shows none", async () => {
  const { figureKeysOf } = await import("../scripts/formation/hazard-entry-logic.mjs");
  assert.deepEqual(logic.PARAM_KEYS, ["length", "gap", "depth"]);
  assert.deepEqual(figureKeysOf("swim"), []);
  assert.deepEqual(figureKeysOf("squeeze"), ["length"], "the squeeze shape is a pick, not a figure");
});

await ok("seedFromPlaces passes the options through to the seed", () => {
  const lists = [[obstacle("t1", SWIM_KIND, { penaltyPick: "7" })], [condition("c1", "waterCold")]];
  assert.deepEqual(seedFromPlaces(lists, hazardKeyOf, PICKS)[0].setup, { penaltyPick: "7", waterCold: true });
  assert.deepEqual(seedFromPlaces(lists, hazardKeyOf)[0].setup, { waterCold: true });
});

await ok("every seeded key is a key of the crossing's setup that its kind reads", () => {
  const all = CONDITION_HAZARDS.map((key, i) => condition(`c${i}`, key));
  for (const kind of OBSTACLE_HAZARDS) {
    const [seed] = crossingSeed([obstacle("t1", kind, { length: 3, gap: 4, depth: 5 }), ...all], hazardKeyOf);
    for (const key of Object.keys(seed.setup)) {
      assert.ok(key in SETUP_FIELDS, `${kind}: ${key}`);
      if (!logic.PARAM_KEYS.includes(key)) assert.ok(setupKeysOf(kind).includes(key), `${kind}: ${key}`);
    }
  }
  assert.deepEqual(setupKeysOf("nowhere"), []);
});

/* --- the per-kind keys ------------------------------------------------------ */
/** The setup names the party sheet's crossing partial offers for each kind, read off the template. */
const templateKeys = () => {
  const text = fs.readFileSync(new URL("../templates/formation/formation-crossing.hbs", import.meta.url), "utf8");
  const setup = text.slice(text.indexOf('class="acks-extras-crossing-setup"'), text.indexOf("{{#if crossing.rows.length}}"));
  const [swim, rest1] = setup.split("{{else if crossing.squeeze}}");
  const [squeeze, rest2] = rest1.split("{{else if crossing.jump}}");
  const [jump, climb] = rest2.split("{{else}}");
  const names = (part) => [...part.matchAll(/name="crossing\.(\w+)"/g)].map((m) => m[1]);
  // The swim partial's conditions are one loop over the crossing's own water list.
  const loop = swim.includes("crossing.{{this.field}}") ? Object.keys(WATER).map((w) => `water${w[0].toUpperCase()}${w.slice(1)}`) : [];
  return { swim: [...loop, ...names(swim)], squeeze: names(squeeze), jump: names(jump), climb: names(climb) };
};

await ok("each kind's setup keys are the party sheet's own controls for that kind", () => {
  const sheet = templateKeys();
  for (const kind of [JUMP_KIND, SWIM_KIND, SQUEEZE_KIND]) assert.deepEqual([...KIND_SETUP_KEYS[kind]].sort(), [...new Set(sheet[kind])].sort(), kind);
  for (const kind of Object.keys(OBSTACLES)) assert.deepEqual([...setupKeysOf(kind)].sort(), [...new Set(sheet.climb)].sort(), kind);
  for (const keysOfKind of Object.values(sheet)) for (const key of keysOfKind) assert.ok(key in SETUP_FIELDS, key);
});

/* --- the pack --------------------------------------------------------------- */
await ok("the pack holds one hazard per key under the module's id prefix", () => {
  const docs = buildHazards();
  const prefix = MANIFEST.flags["acks-extras"].idPrefix;
  assert.deepEqual(docs.map((d) => d.system.key), HAZARD_KEYS);
  assert.equal(new Set(docs.map((d) => d._id)).size, docs.length);
  assert.equal(new Set(docs.map((d) => d.name)).size, docs.length);
  for (const doc of docs) {
    assert.ok(doc._id.startsWith(prefix) && doc._id.length === 16, doc._id);
    assert.equal(doc._key, `!items!${doc._id}`);
    assert.equal(doc.type, HAZARD_ITEM_TYPE);
    assert.equal(doc.name, lookup(hazardLabelKey(doc.system.key)));
    assert.equal(doc.img, HAZARD_ICONS[doc.system.key]);
    assert.deepEqual(Object.keys(doc.system).sort(), ["description", "key"]);
  }
});

await ok("the pack is declared and filed under the module's folder", () => {
  const pack = MANIFEST.packs.find((p) => p.name === "hazards");
  assert.equal(pack.type, "Item");
  assert.equal(pack.path, "packs/hazards");
  const filed = MANIFEST.packFolders.flatMap((f) => f.folders ?? []).flatMap((f) => f.packs);
  assert.ok(filed.includes("hazards"));
});

console.log(`${passed} passed`);
