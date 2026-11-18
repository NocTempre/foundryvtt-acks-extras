/**
 * The Crossing obstacle region behaviour (`scripts/formation/crossing-region.mjs`
 * and `crossing-region-logic.mjs`): the schema it declares, what a region seeds
 * into the party's crossing, and which fields each kind of region shows. Foundry's
 * field classes record their options and DOM nodes are stand-ins; every figure
 * and word here is invented, and no book is imported.
 *
 * What this pins: every number field starts blank; a yes/no field starts on its
 * blank option; no choices function throws where no `game` stands; a seed holds
 * only keys of the crossing's setup, only the keys the region fills for its kind,
 * each read the way the sheet's form reads it; a blank seeds nothing, yes and no
 * seed true and false; a value stored for another kind seeds nothing; and the
 * per-kind field lists are the party sheet's own fields for that kind.
 *
 * Run: node tools/test-crossing-region.mjs
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
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: {
    regionBehaviors: { RegionBehaviorType: class { static defineSchema() { return {}; } } },
    fields: { StringField: field("string"), NumberField: field("number"), FilePathField: field("filePath") },
    operators: {},
  },
  utils: { deepClone: (v) => JSON.parse(JSON.stringify(v)), randomID: () => "id" },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: {} },
};
const hooks = {};
globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; }, once() {}, off() {}, call() {}, callAll() {} };
globalThis.CONFIG = { RegionBehavior: { dataModels: {}, typeIcons: {} } };

const { SETUP_FIELDS } = await import("../scripts/formation/crossing.mjs");
const { CROSSING_OBSTACLE_TYPE } = await import("../scripts/formation/constants.mjs");
const { OBSTACLES } = await import("../scripts/formation/obstacles.mjs");
const logic = await import("../scripts/formation/crossing-region-logic.mjs");
const region = await import("../scripts/formation/crossing-region.mjs");
const { KIND_FIELDS, NUMBER_FIELDS, FLAG_FIELDS, REGION_KINDS, OBSTACLE_KEYS, regionSeed, hiddenFieldsOf } = logic;

const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};
const schema = () => region.CrossingObstacleBehavior.defineSchema();
/** A behaviour's `system` with every field blank, as a fresh one stores it, then `over` applied. */
const blank = (kind, over = {}) => {
  const system = { kind, obstacle: OBSTACLE_KEYS[0], onEntry: "offer", art: null };
  for (const key of NUMBER_FIELDS) system[key] = null;
  for (const key of FLAG_FIELDS) system[key] = "";
  return { ...system, ...over };
};

/* --- the schema ------------------------------------------------------------- */
await ok("every number field starts null and is nullable", () => {
  for (const key of NUMBER_FIELDS) {
    const f = schema()[key];
    assert.equal(f.kind, "number", key);
    assert.equal(f.options.initial, null, key);
    assert.equal(f.options.nullable, true, key);
  }
});

await ok("every yes/no field is a select with a blank option, starting blank", () => {
  for (const key of FLAG_FIELDS) {
    const f = schema()[key];
    assert.equal(f.kind, "string", key);
    assert.equal(f.options.blank, true, key);
    assert.equal(f.options.initial, "", key);
    assert.deepEqual(Object.keys(f.options.choices()), ["yes", "no"], key);
  }
});

await ok("the kind, the obstacle and the entry start on their first choice", () => {
  const s = schema();
  assert.equal(s.kind.options.initial, REGION_KINDS[0]);
  assert.equal(s.obstacle.options.initial, OBSTACLE_KEYS[0]);
  assert.equal(s.obstacle.options.blank, false);
  assert.equal(s.onEntry.options.initial, "offer");
  assert.deepEqual(Object.keys(s.onEntry.options.choices()), ["offer", "start", "nothing"]);
  assert.deepEqual(Object.keys(s.obstacle.options.choices()), Object.keys(OBSTACLES));
});

await ok("the art field takes images and may be blank", () => {
  const art = schema().art;
  assert.equal(art.kind, "filePath");
  assert.deepEqual(art.options.categories, ["IMAGE"]);
  assert.equal(art.options.blank, true);
});

await ok("no choices function throws where no game stands", () => {
  assert.equal(typeof globalThis.game, "undefined");
  const s = schema();
  for (const [key, f] of Object.entries(s)) {
    if (typeof f.options.choices !== "function") continue;
    const out = f.options.choices();
    assert.ok(Object.keys(out).length > 0, key);
    for (const label of Object.values(out)) assert.equal(typeof label, "string", key);
  }
});

await ok("choices labels localize through game when one stands", () => {
  globalThis.game = { i18n: { localize: (k) => `<${k}>` } };
  try {
    assert.equal(schema().kind.options.choices().jump, `<${region.CrossingObstacleBehavior.LOCALIZATION_PREFIXES[0]}.KIND.jump>`);
    assert.equal(schema().obstacle.options.choices()[OBSTACLE_KEYS[0]], `<${OBSTACLES[OBSTACLE_KEYS[0]].label}>`);
  } finally { delete globalThis.game; }
});

await ok("the sub-type registers with a model and an icon", () => {
  region.registerCrossingObstacle();
  assert.equal(CONFIG.RegionBehavior.dataModels[CROSSING_OBSTACLE_TYPE], region.CrossingObstacleBehavior);
  assert.match(CONFIG.RegionBehavior.typeIcons[CROSSING_OBSTACLE_TYPE], /^fa-solid fa-/);
  assert.equal(CROSSING_OBSTACLE_TYPE, "acks-extras.crossingObstacle");
});

await ok("the type is declared in module.json and labelled in en.json", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.ok("crossingObstacle" in manifest.documentTypes.RegionBehavior);
  assert.equal(typeof LANG.TYPES.RegionBehavior[CROSSING_OBSTACLE_TYPE], "string");
});

await ok("every field and choice carries its string", () => {
  const prefix = region.CrossingObstacleBehavior.LOCALIZATION_PREFIXES[0];
  for (const key of Object.keys(schema())) {
    for (const part of ["label", "hint"]) assert.equal(typeof lookup(`${prefix}.FIELDS.${key}.${part}`), "string", `${key}.${part}`);
  }
  for (const kind of REGION_KINDS) assert.equal(typeof lookup(`${prefix}.KIND.${kind}`), "string", kind);
  for (const mode of logic.ENTRY_MODES) assert.equal(typeof lookup(`${prefix}.ENTRY.${mode}`), "string", mode);
  for (const yn of ["yes", "no"]) assert.equal(typeof lookup(`${prefix}.YES_NO.${yn}`), "string", yn);
  for (const key of OBSTACLE_KEYS) assert.equal(typeof lookup(OBSTACLES[key].label), "string", key);
});

/* --- the seed --------------------------------------------------------------- */
await ok("a blank region seeds no setup key", () => {
  for (const kind of REGION_KINDS) {
    const seed = regionSeed(blank(kind));
    assert.deepEqual(seed.setup, {}, kind);
  }
});

await ok("a climb seeds its obstacle as the crossing's kind and its own keys", () => {
  const seed = regionSeed(blank("climb", { obstacle: OBSTACLE_KEYS[1], length: 25, ropeFixed: "yes" }));
  assert.equal(seed.kind, OBSTACLE_KEYS[1]);
  assert.deepEqual(seed.setup, { length: 25, ropeFixed: true });
});

await ok("a jump seeds the jump kind and its own keys", () => {
  const seed = regionSeed(blank("jump", { gap: 12, runUp: "no", precarious: "yes", charging: "no" }));
  assert.equal(seed.kind, "jump");
  assert.deepEqual(seed.setup, { gap: 12, runUp: false, precarious: true, charging: false });
});

await ok("yes and no map to true and false, and blank to absent", () => {
  assert.equal(regionSeed(blank("jump", { runUp: "yes" })).setup.runUp, true);
  assert.equal(regionSeed(blank("jump", { runUp: "no" })).setup.runUp, false);
  assert.ok(!("runUp" in regionSeed(blank("jump", { runUp: "" })).setup));
  assert.ok(!("runUp" in regionSeed(blank("jump", { runUp: undefined })).setup));
});

await ok("a number the sheet would refuse is absent", () => {
  const seed = regionSeed(blank("jump", { gap: 0, depth: -3 }));
  assert.ok(!("gap" in seed.setup) && !("depth" in seed.setup));
});

await ok("every seeded value equals what the sheet's reader stores", () => {
  const seed = regionSeed(blank("jump", { gap: 7.5, depth: 30, runUp: "yes", precarious: "no", charging: "yes", ropeFixed: "no" }));
  for (const [key, value] of Object.entries(seed.setup)) assert.equal(SETUP_FIELDS[key](value), value, key);
  assert.deepEqual(seed.setup, { gap: 7.5, depth: 30, runUp: true, precarious: false, charging: true, ropeFixed: false });
});

await ok("a value stored for another kind seeds nothing", () => {
  const stale = { gap: 9, runUp: "yes", precarious: "yes", charging: "yes", length: 14 };
  assert.deepEqual(regionSeed(blank("climb", stale)).setup, { length: 14 });
  assert.deepEqual(regionSeed(blank("jump", stale)).setup, { gap: 9, runUp: true, precarious: true, charging: true });
});

await ok("a region of no kind, or a climb naming no obstacle, seeds nothing", () => {
  assert.equal(regionSeed(blank("swim")), null);
  assert.equal(regionSeed(blank("climb", { obstacle: "nowhere" })), null);
  assert.equal(regionSeed(null), null);
});

await ok("every seeded key is a key of the crossing's setup", () => {
  for (const kind of REGION_KINDS) {
    const every = Object.fromEntries([...NUMBER_FIELDS.map((k) => [k, 5]), ...FLAG_FIELDS.map((k) => [k, "yes"])]);
    for (const key of Object.keys(regionSeed(blank(kind, every)).setup)) assert.ok(key in SETUP_FIELDS, `${kind}: ${key}`);
  }
  for (const key of [...NUMBER_FIELDS, ...FLAG_FIELDS]) assert.ok(key in SETUP_FIELDS, key);
});

/* --- the per-kind fields ---------------------------------------------------- */
/** The setup names the party sheet's crossing partial offers for a jump and for any other kind. */
const templateFields = () => {
  const text = fs.readFileSync(new URL("../templates/formation/formation-crossing.hbs", import.meta.url), "utf8");
  const setup = text.slice(text.indexOf('class="acks-extras-crossing-setup"'), text.indexOf("{{#if crossing.rows.length}}"));
  const [jump, climb] = setup.split("{{else}}");
  const names = (part) => [...part.matchAll(/name="crossing\.(\w+)"/g)].map((m) => m[1]);
  return { jump: names(jump), climb: names(climb) };
};

await ok("each kind's fields are the party sheet's own for that kind", () => {
  const sheet = templateFields();
  // The Judge's own modifier is per crossing, not a feature of the ground, so no region states it.
  const notRegional = ["judgeMod"];
  for (const kind of REGION_KINDS) {
    const used = KIND_FIELDS[kind].filter((key) => key !== "obstacle");
    const expected = sheet[kind].filter((key) => !notRegional.includes(key));
    assert.deepEqual([...used].sort(), [...expected].sort(), kind);
  }
  assert.ok(KIND_FIELDS.climb.includes("obstacle") && !KIND_FIELDS.jump.includes("obstacle"));
});

await ok("every kind-bound field is a schema field and hides on the kinds that do not use it", () => {
  const s = schema();
  for (const key of logic.KIND_BOUND_FIELDS) assert.ok(key in s, key);
  assert.deepEqual(hiddenFieldsOf("jump").sort(), ["length", "obstacle"]);
  assert.deepEqual(hiddenFieldsOf("climb").sort(), ["charging", "gap", "precarious", "runUp"]);
  assert.deepEqual(hiddenFieldsOf("nothing").length, logic.KIND_BOUND_FIELDS.length);
});

/* --- the window ------------------------------------------------------------- */
/** A form group and its control, as the window's markup holds them. */
const makeRoot = (kind) => {
  const groups = {};
  const controls = {};
  for (const key of ["kind", "art", "onEntry", ...logic.KIND_BOUND_FIELDS]) {
    groups[key] = { hidden: false, style: { display: "" } };
    controls[`[name="system.${key}"]`] = { closest: (sel) => (sel === ".form-group" ? groups[key] : null) };
  }
  const listeners = [];
  controls['[name="system.kind"]'].value = kind;
  controls['[name="system.kind"]'].addEventListener = (name, fn) => listeners.push([name, fn]);
  return { nodeType: 1, groups, listeners, kindControl: controls['[name="system.kind"]'], querySelector: (sel) => controls[sel] ?? null };
};
const shown = (root) => Object.keys(root.groups).filter((key) => !root.groups[key].hidden && root.groups[key].style.display !== "none").sort();

await ok("the window shows only the chosen kind's fields and re-applies on a change", () => {
  region.installCrossingObstacleConfig();
  const render = hooks.renderRegionBehaviorConfig;
  const root = makeRoot("jump");
  render({ document: { type: CROSSING_OBSTACLE_TYPE, system: { kind: "jump" } } }, root);
  assert.deepEqual(shown(root), ["art", "charging", "depth", "gap", "kind", "onEntry", "precarious", "ropeFixed", "runUp"]);
  root.kindControl.value = "climb";
  const [name, fn] = root.listeners[0];
  assert.equal(name, "change");
  fn();
  assert.deepEqual(shown(root), ["art", "depth", "kind", "length", "obstacle", "onEntry", "ropeFixed"]);
});

await ok("the window hook leaves another behaviour's window and a rootless render alone", () => {
  const render = hooks.renderRegionBehaviorConfig;
  const root = makeRoot("jump");
  render({ document: { type: "acks-extras.trapZone" } }, root);
  assert.equal(root.listeners.length, 0);
  assert.deepEqual(shown(root).length, Object.keys(root.groups).length);
  render({ document: { type: CROSSING_OBSTACLE_TYPE } }, null);
});

await ok("a window missing a field is skipped without throwing", () => {
  region.applyKindVisibility({ querySelector: () => null }, "jump");
});

console.log(`${passed} passed`);
