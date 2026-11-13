/**
 * What a generated caster carries: the level a template prints as a die is
 * rolled and logged in `generateFromTemplate`, the resolved payload's slots
 * are the class document's row at that level, and the repertoire listener
 * (`fillGeneratedRepertoire`, scripts/magic/repertoire.mjs) draws spells to
 * those slots from the library. A cell that gives a rating and no hit points
 * has them rolled from the rating, logged beside the level.
 *
 * Every class, tradition, spell and figure here is invented; the grid is a
 * small one of this suite's own, so a result can only come from the code
 * reading what it is handed. The live recipe is docs/monsters/TESTING.md,
 * "A family's roles".
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

const MID = "acks-extras";
const { CLASS_TYPE } = await import("../scripts/classes/constants.mjs");
const { TEMPLATE_HOOKS } = await import("../scripts/lib/constants.mjs");

/* ---------------- a world of invented documents ---------------- */

const row = (atLevel, s1, s2, s3) => ({ atLevel, s1, s2, s3, s4: 0, s5: 0, s6: 0 });
const GRID = [row(1, 1, 0, 0), row(3, 2, 1, 0), row(5, 2, 2, 1)];

/** A class document with one tradition: `kind` and `slots` are the parts a test varies. */
const classDoc = (name, { key = "glim", kind = "vancian", slots = GRID } = {}) => ({
  type: CLASS_TYPE,
  name,
  uuid: `Item.class-${name}`,
  system: { key: name.toLowerCase(), casting: [{ key, label: key, kind, slots, spellList: [] }] },
  flags: {},
});

let serial = 0;
/** A spell document on one tradition's list, the way the importer stamps one. */
const spellDoc = (name, level, source = "glim") => {
  const uuid = `Item.spell-${++serial}`;
  const data = { _id: `id${serial}`, name, type: "spell", folder: "F1", sort: 5, ownership: { default: 3 }, system: { lvl: level, class: "" }, flags: { [MID]: { spell: { lists: [{ source, level }] } } } };
  return { uuid, name, type: "spell", system: data.system, flags: data.flags, toObject: () => structuredClone(data) };
};

const SPELLS = [
  spellDoc("Test Spell 1", 1), spellDoc("Test Spell 2", 1), spellDoc("Test Spell 3", 1),
  spellDoc("Test Spell 4", 2), spellDoc("Test Spell 5", 2),
  spellDoc("Test Spell 6", 3),
  spellDoc("Test Spell 7", 1, "other"),
];
const GLIMMERER = classDoc("Glimmerer");
const POINTS = classDoc("Pointcaster", { key: "pts", kind: "points", slots: [] });
const FLAT = classDoc("Latecomer", { slots: [row(4, 1, 0, 0)] });

globalThis.game = { items: [GLIMMERER, POINTS, FLAT, ...SPELLS], packs: [], folders: [{ type: "Actor", name: "Generated", folder: null, id: "FOLDER" }] };
const handlers = new Map();
globalThis.Hooks = { callAll: (name, ...args) => (handlers.get(name) ?? []).forEach((h) => h(...args)) };
const made = [];
globalThis.Actor = { create: async (data) => (made.push(data), data) };

const { fillGeneratedRepertoire, slotsOfSystem, slotsOfClass, classNamed } = await import("../scripts/magic/repertoire.mjs");
const { generateFromTemplate } = await import("../scripts/lib/template-generate.mjs");
// The listener magic/module.mjs registers on the resolved payload.
handlers.set(TEMPLATE_HOOKS.RESOLVED, [({ resolved }) => fillGeneratedRepertoire(resolved)]);

/** A one-variant template whose caster role prints its class word and a level die (or a level). */
const casterTemplate = (spellcasting) => ({
  uuid: "Actor.template",
  name: "Test Template",
  system: {
    axes: [
      { key: "variant", label: "Variant", roll: "", options: [{ key: "adept", label: "Adept", merge: { hp: { hd: "2d8", value: 5, max: 5 } } }] },
      { key: "role", label: "Role", default: "standard", options: [{ key: "standard", label: "Standard" }, { key: "caster", label: "Caster" }] },
    ],
    cells: [
      { by: ["variant", "role"], key: "adept|standard", merge: {} },
      { by: ["variant", "role"], key: "adept|caster", merge: {}, flags: { [MID]: { extras: { spellcasting } } } },
    ],
    output: { nameFormat: "{variant} {role}", actorType: "monster" },
  },
});

/** Generate with every die at one value of `Math.random`, restoring it after. */
const generateAt = async (template, rand, pins = { variant: "adept", role: "caster" }) => {
  const real = Math.random;
  Math.random = () => rand;
  try {
    return await generateFromTemplate(template, { pins });
  } finally {
    Math.random = real;
  }
};

const spellsOf = (data) => (data.items ?? []).filter((i) => i.type === "spell");
const levelOf = (spell) => spell.system.lvl;

/* ---------------- the pieces ---------------- */

await ok("a class word names the library's class, by name, key or plural", () => {
  assert.equal(classNamed("Glimmerer"), GLIMMERER);
  assert.equal(classNamed("glimmerers"), GLIMMERER);
  assert.equal(classNamed("nobody"), null);
  assert.equal(classNamed(""), null);
});

await ok("a class's slots are its grid row at the level, none where it grants nothing yet or is not vancian", () => {
  assert.deepEqual(slotsOfClass(GLIMMERER, 1), { 1: 1 });
  assert.deepEqual(slotsOfClass(GLIMMERER, 4), { 1: 2, 2: 1 }, "the highest rung at or below the level");
  assert.deepEqual(slotsOfClass(GLIMMERER, 9), { 1: 2, 2: 2, 3: 1 });
  assert.equal(slotsOfClass(FLAT, 2), null, "no rung reached yet");
  assert.equal(slotsOfClass(POINTS, 5), null, "a points tradition has no slots to draw to");
  assert.equal(slotsOfClass(null, 5), null);
});

/* ---------------- the repertoire listener on a payload ---------------- */

const payload = (spellcasting, system = {}) => ({ system, flags: { [MID]: { extras: { spellcasting } } }, items: [] });

await ok("a caster with a class word and a level takes the class's slots at that level and a draw to them", () => {
  const p = payload({ class: "Glimmerer", level: 3 });
  const n = fillGeneratedRepertoire(p);
  assert.deepEqual(slotsOfSystem(p.system.spells), { 1: 2, 2: 1 });
  assert.equal(p.system.spells.enabled, true);
  assert.equal(n, 3);
  const spells = spellsOf(p);
  assert.equal(spells.filter((s) => levelOf(s) === 1).length, 2);
  assert.equal(spells.filter((s) => levelOf(s) === 2).length, 1);
  assert.ok(spells.every((s) => !/Test Spell 6|Test Spell 7/.test(s.name)), "a level the class does not cast yet, and another tradition's spell, are never drawn");
  assert.equal(new Set(spells.map((s) => s.name)).size, spells.length, "every spell drawn once");
});

await ok("what a draw embeds is the spell without the identity that belongs to its source", () => {
  const p = payload({ class: "Glimmerer", level: 1 });
  fillGeneratedRepertoire(p);
  const [spell] = spellsOf(p);
  for (const key of ["_id", "folder", "sort", "ownership"]) assert.equal(spell[key], undefined, key);
  assert.equal(spell.type, "spell");
});

await ok("a slot count with more places than the list holds draws what there is", () => {
  const p = payload({ class: "Glimmerer", level: 9 });
  fillGeneratedRepertoire(p);
  assert.deepEqual(slotsOfSystem(p.system.spells), { 1: 2, 2: 2, 3: 1 });
  const spells = spellsOf(p);
  assert.equal(spells.filter((s) => levelOf(s) === 2).length, 2);
  assert.equal(spells.filter((s) => levelOf(s) === 3).length, 1);
  const thin = payload({ class: "Glimmerer", level: 9 });
  const held = globalThis.game.items;
  globalThis.game.items = held.filter((i) => i.name !== "Test Spell 6" && i.name !== "Test Spell 5");
  try {
    fillGeneratedRepertoire(thin);
  } finally {
    globalThis.game.items = held;
  }
  assert.equal(spellsOf(thin).filter((s) => levelOf(s) === 3).length, 0);
  assert.equal(spellsOf(thin).filter((s) => levelOf(s) === 2).length, 1);
});

await ok("a payload whose slot block is already on keeps it and draws to it", () => {
  const p = payload({ class: "Glimmerer", level: null }, { spells: { enabled: true, 1: { max: 3 }, 2: { max: 0 } } });
  assert.equal(fillGeneratedRepertoire(p), 3);
  assert.deepEqual(slotsOfSystem(p.system.spells), { 1: 3 });
  assert.ok(spellsOf(p).every((s) => levelOf(s) === 1));
});

await ok("a tradition word with no class document draws from every spell of that tradition, uncapped", () => {
  const p = payload({ class: "glim", level: null }, { spells: { enabled: true, 1: { max: 1 }, 3: { max: 1 } } });
  assert.equal(fillGeneratedRepertoire(p), 2);
  assert.deepEqual(spellsOf(p).map(levelOf).sort(), [1, 3]);
});

await ok("nothing is drawn where nothing is stated: no class, no level, no slots, a spell already carried", () => {
  const noClass = payload({ level: 3 }, { spells: { enabled: true, 1: { max: 2 } } });
  assert.equal(fillGeneratedRepertoire(noClass), 0);
  assert.equal(spellsOf(noClass).length, 0);
  const noLevel = payload({ class: "Glimmerer", level: null });
  assert.equal(fillGeneratedRepertoire(noLevel), 0);
  assert.equal(noLevel.system.spells, undefined, "no slot block is written without a level");
  const early = payload({ class: "Latecomer", level: 2 });
  assert.equal(fillGeneratedRepertoire(early), 0);
  assert.equal(early.system.spells, undefined, "a grid that grants nothing at the level adds no block");
  const points = payload({ class: "Pointcaster", level: 5 });
  assert.equal(fillGeneratedRepertoire(points), 0);
  const carrying = payload({ class: "Glimmerer", level: 3 });
  carrying.items.push({ type: "spell", name: "Carried" });
  assert.equal(fillGeneratedRepertoire(carrying), 0);
  assert.deepEqual(spellsOf(carrying).map((s) => s.name), ["Carried"], "a creature that carries a spell keeps only that one");
  const bare = { system: {}, flags: {}, items: [] };
  assert.equal(fillGeneratedRepertoire(bare), 0);
  assert.equal(fillGeneratedRepertoire(null), 0);
});

/* ---------------- generation end to end ---------------- */

await ok("a caster whose level is a die rolls it, logs the roll, and carries slots and spells for that level", async () => {
  made.length = 0;
  const low = await generateAt(casterTemplate({ class: "Glimmerer", level: null, levelDie: "2d3+1" }), 0);
  const sc = low.flags[MID].extras.spellcasting;
  assert.equal(sc.class, "Glimmerer");
  assert.equal(sc.level, 3, "every die at its lowest");
  const log = low.flags[MID].generated.log.find((l) => l.axis === "casterLevel");
  assert.deepEqual({ source: log.source, roll: log.roll, die: log.die }, { source: "rolled", roll: 3, die: "2d3+1" });
  assert.deepEqual(slotsOfSystem(low.system.spells), { 1: 2, 2: 1 });
  assert.equal(spellsOf(low).length, 3);

  const high = await generateAt(casterTemplate({ class: "Glimmerer", level: null, levelDie: "2d3+1" }), 0.999);
  assert.equal(high.flags[MID].extras.spellcasting.level, 7, "every die at its highest");
  assert.deepEqual(slotsOfSystem(high.system.spells), { 1: 2, 2: 2, 3: 1 });
  assert.equal(spellsOf(high).length, 5);
  assert.equal(high.name, "Adept Caster");
});

await ok("a level the template already prints is not rolled and not logged", async () => {
  const fixed = await generateAt(casterTemplate({ class: "Glimmerer", level: 1, levelDie: "2d3+1" }), 0.999);
  assert.equal(fixed.flags[MID].extras.spellcasting.level, 1);
  assert.ok(!fixed.flags[MID].generated.log.some((l) => l.axis === "casterLevel"));
  assert.deepEqual(slotsOfSystem(fixed.system.spells), { 1: 1 });
});

await ok("the rank and file of the same template carry no slots and no spells", async () => {
  const std = await generateAt(casterTemplate({ class: "Glimmerer", level: null, levelDie: "2d3+1" }), 0.5, { variant: "adept", role: "standard" });
  assert.equal(std.flags[MID].extras?.spellcasting, undefined);
  assert.equal(std.system.spells, undefined);
  assert.equal(spellsOf(std).length, 0);
});

await ok("a caster whose class word no library document answers is generated with its level and no slots", async () => {
  const lost = await generateAt(casterTemplate({ class: "Unlisted", level: null, levelDie: "1d4" }), 0.5);
  assert.ok(Number.isInteger(lost.flags[MID].extras.spellcasting.level));
  assert.equal(lost.system.spells, undefined);
  assert.equal(spellsOf(lost).length, 0);
});

/* ---------------- a rating's hit points are rolled at generation ---------------- */

await ok("a cell that gives a rating and no hit points has them rolled from the rating and logged", async () => {
  const tpl = (cell) => ({
    uuid: "Actor.template",
    name: "Test Template",
    system: {
      axes: [{ key: "variant", label: "Variant", roll: "", options: [{ key: "adept", label: "Adept", merge: { hp: { hd: "2d8", value: 5, max: 5 } } }] }],
      cells: [{ by: ["variant"], key: "adept", ...cell }],
      output: { nameFormat: "{variant}", actorType: "monster" },
    },
  });
  const rated = tpl({ rollHp: true, merge: { hp: { hd: "3d8+1" } } });
  const low = await generateAt(rated, 0, { variant: "adept" });
  assert.equal(low.system.hp.max, 4, "every die at its lowest, plus the bonus");
  assert.equal(low.system.hp.value, low.system.hp.max);
  const logged = low.flags[MID].generated.log.find((l) => l.axis === "hitPoints");
  assert.deepEqual({ source: logged?.source, roll: logged?.roll, die: logged?.die }, { source: "rolled", roll: 4, die: "3d8+1" });
  const high = await generateAt(rated, 0.999, { variant: "adept" });
  assert.equal(high.system.hp.max, 25, "every die at its highest, plus the bonus");
  const fixed = await generateAt(tpl({ merge: { hp: { hd: "3d8+1", value: 14, max: 14 } } }), 0.999, { variant: "adept" });
  assert.equal(fixed.system.hp.max, 14, "printed hit points are never rolled over");
  assert.ok(!fixed.flags[MID].generated.log.some((l) => l.axis === "hitPoints"));
});

console.log(`\n${passed} passed`);
