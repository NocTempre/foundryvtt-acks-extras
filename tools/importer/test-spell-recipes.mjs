/**
 * The spell recipe channel, offline: a spell register row's `effects` and
 * `values` materialize from the seat's own prose (`materializeEffects`), a
 * missed capture under `onMiss: "blank"` leaves the field unset and the row
 * kept, `bindSpell` writes rows only for a spell with authored recipes and
 * stamps them, and a repair replaces the stamped rows and keeps a Judge's.
 *
 * Every spell, sentence and number here is invented. Whatever compares the
 * recipes to the printed book is a rules test, which stays on the machine
 * that owns the books (`tools/rules-tests/`, gitignored).
 */
import assert from "node:assert/strict";
import { materializeEffects } from "../../scripts/importer/executor.mjs";
import { bindSpell } from "../../scripts/importer/cookbook/variations.mjs";
import { REPAIR, mergeRowsByOrigin, refreshPlan } from "../../scripts/importer/refresh.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { spellRecipeProblems } from "./spell-recipe-rules.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const paras = (...lines) => lines.map((text) => ({ text }));

// An invented spell. Its prose is made up, with welded words and a curly apostrophe as extraction leaves them.
const PROSE = paras(
  "This spell hurls a cone of glittering frost with a 15’ radius. Every living creature caught in the cone is allowed a Death save.",
  "A creature that fails takes 2d8 + 3 extraordinary acidic damage and is chilled. A creature that saves takes half.",
);
const DICE = "\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?";
const ROW = {
  type: "damage",
  appliesTo: "area",
  saveEffect: "half",
  delivery: "none",
  lasts: "instant",
  from: [
    { into: "roll", pattern: `takes\\s*(${DICE})` },
    { into: "damage", pattern: `takes\\s*${DICE}\\s*(?:extraordinary\\s*)?(\\w+)\\s*damage` },
    { into: "extraordinary", pattern: "extraordinary\\s*\\w+\\s*damage" },
  ],
};
const VALUES = {
  target: { model: "area", area: { shape: "cone", measure: "radius" } },
  save: { effect: "half", kind: "save", perTarget: true },
  from: [
    { into: "save.category", pattern: "allowed\\s*an?\\s*(\\w+)\\s*save" },
    { into: "target.area.size", pattern: "with\\s*an?\\s*(\\d+)\\S?\\s*radius" },
    { into: "target.filters", pattern: "every\\s*(\\w+)\\s*creature" },
  ],
};

t("a spell row materializes its dice, damage type and mark from the prose, whitespace removed", () => {
  const [row] = materializeEffects([{ ...ROW, onMiss: "blank" }], PROSE);
  assert.equal(row.roll, "2d8+3");
  assert.deepEqual(row.damage, ["acidic"]);
  assert.equal(row.extraordinary, true);
  assert.equal(row.unread, undefined, "nothing missed, nothing listed");
  assert.equal(row.onMiss, undefined, "onMiss never rides into the world");
  assert.equal(row.saveEffect, "half", "the structure ships as authored");
});

t("a values spec materializes a SpellExtras fragment, at any depth, without writing through the recipe", () => {
  const spec = { ...VALUES, onMiss: "blank" };
  const [frag] = materializeEffects([spec], PROSE);
  assert.equal(frag.save.category, "death");
  assert.deepEqual(frag.save.effect, "half", "the recipe's own structure is kept beside the located category");
  assert.deepEqual(frag.target.area.size, { kind: "flat", flat: 15 });
  assert.equal(frag.target.area.shape, "cone");
  assert.equal(frag.target.area.measure, "radius", "the authored measure rides beside the located size");
  assert.deepEqual(frag.target.filters, ["living"]);
  assert.equal(spec.target.area.size, undefined, "the shared recipe object is copied, never written through");
  assert.equal(spec.save.category, undefined);
});

t("under onMiss blank a missed locator leaves its field unset, lists it as unread, and keeps the row", () => {
  const prose = paras("A creature that fails takes 2d8 + 3 acidic damage.");
  const [row] = materializeEffects([{ ...ROW, onMiss: "blank" }], prose);
  assert.ok(row, "the row is kept");
  assert.equal(row.roll, "2d8+3", "the locators after a miss still read");
  assert.deepEqual(row.damage, ["acidic"]);
  assert.ok(!("extraordinary" in row), "the missed field is unset, not false");
  assert.deepEqual(row.unread, ["extraordinary"]);
  assert.equal(row.delivery, "none");
});

t("a word no vocabulary member answers to, and a malformed dice capture, are misses", () => {
  const word = paras("A creature takes 2d8 vermilion damage.");
  const [a] = materializeEffects([{ ...ROW, onMiss: "blank" }], word);
  assert.equal(a.roll, "2d8");
  assert.ok(!("damage" in a));
  assert.deepEqual(a.unread, ["damage", "extraordinary"]);
  const [b] = materializeEffects(
    [{ type: "damage", onMiss: "blank", from: { into: "roll", pattern: "takes\\s*(\\w+)\\s*damage" } }],
    paras("It takes heavy damage."),
  );
  assert.deepEqual(b.unread, ["roll"], "a word is no dice formula");
});

t("a bookless import under onMiss blank keeps every row with every locator unread", () => {
  const [row] = materializeEffects([{ ...ROW, onMiss: "blank" }], []);
  assert.deepEqual(row.unread, ["roll", "damage", "extraordinary"]);
});

t("without onMiss a missed locator still drops the whole row", () => {
  const prose = paras("A creature that fails takes 2d8 + 3 acidic damage.");
  assert.deepEqual(materializeEffects([ROW], prose), []);
  assert.equal(materializeEffects([ROW], PROSE).length, 1, "the same recipe on a page that prints every part keeps it");
});

t("a field that is not locatable drops the row even under onMiss blank", () => {
  assert.deepEqual(materializeEffects([{ type: "damage", onMiss: "blank", from: { into: "saveEffect", pattern: "x" } }], PROSE), []);
});

/* -------------------------------------------- */
/*  bindSpell                                    */
/* -------------------------------------------- */

const STAT = "Arcane 3 Type: blast Range: 60’ Duration: instantaneous";
const nodeFor = (specs, valueSpecs) => ({
  fields: {
    name: { title: "Glimmerfrost" },
    stat: STAT,
    description: PROSE,
    // What `executeEntry` leaves on a node: the recipe's rows, else the scan's guesses.
    effects: specs ? materializeEffects(specs, PROSE) : [{ type: "damage", roll: "1d6", unread: undefined, guessed: true }],
    ...(valueSpecs ? { values: materializeEffects(valueSpecs, PROSE) } : {}),
  },
});
const entryFor = (specs, valueSpecs) => ({
  id: "def.spell.glimmerfrost",
  name: "Glimmerfrost",
  cite: "TT p.1",
  fields: {
    ...(specs ? { effects: { op: "effects", specs } } : {}),
    ...(valueSpecs ? { values: { op: "effects", specs: valueSpecs } } : {}),
  },
});

t("bindSpell writes the recipe's rows stamped as the register's, and merges the values into the primitive", () => {
  const specs = [{ ...ROW, onMiss: "blank" }];
  const values = [{ ...VALUES, onMiss: "blank" }];
  const built = bindSpell(entryFor(specs, values), nodeFor(specs, values), "def.spell.glimmerfrost");
  const spell = built.flags[MODULE_ID].spell;
  assert.equal(spell.effects.length, 1);
  assert.equal(spell.effects[0].origin, "register");
  assert.equal(spell.effects[0].roll, "2d8+3");
  assert.equal(spell.save.category, "death");
  assert.equal(spell.save.kind, "save");
  assert.deepEqual(spell.target.area.size, { kind: "flat", flat: 15 });
  assert.equal(spell.type, "blast", "the stat block's own fields survive the merge");
  assert.ok(!("unread" in spell), "a fragment's unread list is not a field of the primitive");
});

t("bindSpell writes no rows for a spell with no authored recipe, whatever the scan guessed", () => {
  const built = bindSpell(entryFor(null, null), nodeFor(null, null), "def.spell.glimmerfrost");
  assert.ok(!("effects" in built.flags[MODULE_ID].spell));
});

t("a spell whose recipe dropped every row still binds with no rows", () => {
  const specs = [ROW];
  const bare = nodeFor(specs, null);
  bare.fields.description = paras("Nothing printed here matches.");
  bare.fields.effects = materializeEffects(specs, bare.fields.description);
  const built = bindSpell(entryFor(specs, null), bare, "def.spell.glimmerfrost");
  assert.deepEqual(built.flags[MODULE_ID].spell.effects, []);
});

/* -------------------------------------------- */
/*  repair by origin                             */
/* -------------------------------------------- */

const register = (roll) => ({ type: "damage", roll, origin: "register" });
const judge = { type: "heal", roll: "1d4", origin: "" };
const edited = { type: "damage", roll: "9d9", origin: "" };
const stored = (rows) => ({ type: "spell", system: {}, flags: { [MODULE_ID]: { spell: { effects: rows } } } });
const freshBuild = (rows) => ({ type: "spell", system: {}, flags: { [MODULE_ID]: { spell: rows ? { effects: rows } : {} } } });
const rowsAfter = (plan) => plan.update.flags[MODULE_ID].spell.effects;

t("a repair replaces the register's rows from the fresh bind and keeps a Judge's, in order", () => {
  const plan = refreshPlan(stored([judge, register("1d1"), edited]), freshBuild([register("2d2"), register("3d3")]), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [judge, register("2d2"), register("3d3"), edited]);
});

t("a register row a Judge edited has lost its stamp, so a repair keeps it and the fresh row joins it", () => {
  const plan = refreshPlan(stored([edited]), freshBuild([register("2d2")]), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [register("2d2"), edited]);
});

t("a repair whose build carries no rows removes the register's and keeps the Judge's", () => {
  const plan = refreshPlan(stored([register("1d1"), judge]), freshBuild(null), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [judge]);
});

t("a repair with nothing stored and nothing built writes no rows", () => {
  const plan = refreshPlan({ type: "spell", system: {}, flags: { [MODULE_ID]: { spell: {} } } }, freshBuild(null), REPAIR.spell);
  assert.ok(!("effects" in plan.update.flags[MODULE_ID].spell));
});

t("mergeRowsByOrigin tolerates a missing side", () => {
  assert.deepEqual(mergeRowsByOrigin(undefined, [register("1d1")]), [register("1d1")]);
  assert.deepEqual(mergeRowsByOrigin([judge], undefined), [judge]);
});

/* -------------------------------------------- */
/*  the recipe rules                             */
/* -------------------------------------------- */

t("the recipe rules accept a well-formed spell recipe and refuse a printed figure, a located field and an unknown key", () => {
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...ROW, onMiss: "blank" }], values: [{ ...VALUES, onMiss: "blank" }] }), []);
  const bad = spellRecipeProblems({
    effects: [
      { type: "damage", roll: "1d6", from: [] },
      { type: "damage", damage: ["fire"], from: [] },
      { type: "modifier", target: "ac", value: 2 },
      { type: "damage", onMiss: "keep", conditions: ["nope"], from: [{ into: "roll", pattern: "(\\d", per: 2 }] },
      { type: "damage", origin: "register", from: [{ into: "gate.loadMax", pattern: "x" }] },
    ],
    values: [{ save: { category: "death" }, target: { hdCap: 3 } }, { from: { into: "roll", pattern: "x" } }],
  });
  const has = (s) => assert.ok(bad.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${bad.join("\n")}`);
  has("effects[0].roll is located");
  has("effects[1].damage is located");
  has("effects[2].value is located");
  has("effects[3].onMiss");
  has('"nope"');
  has("does not compile");
  has("effects[3].from[0].per is a literal figure");
  has('effects[4] carries "origin"');
  has("values[0].save.category");
  has("values[0].target.hdCap");
  has("values[1].from[0].into");
  assert.deepEqual(spellRecipeProblems({ effects: [{ type: "modifier", target: "damage", gate: { kind: "weaponMundane" }, notStacksWith: ["kw:x"] }] }), []);
  assert.ok(spellRecipeProblems({ effects: [{ type: "modifier", target: "damage", gate: { kind: "nowhere" } }] }).some((p) => p.includes("gate.kind")));
});

t("a row's scope rides through materialize and bind untouched, a nested anyOf included", () => {
  const scope = {
    vsKinds: ["alpha"],
    anyOf: [
      { vsEnemy: true, vsAlignmentOf: "source", vsAlignmentMode: "except" },
      { vsKinds: ["beta", "gamma"], vsAlignment: "chaotic" },
    ],
  };
  const specs = [{ ...ROW, ...scope, onMiss: "blank" }];
  const [row] = materializeEffects(specs, PROSE);
  assert.deepEqual(row.anyOf, scope.anyOf);
  assert.deepEqual(row.vsKinds, ["alpha"]);
  const built = bindSpell(entryFor(specs, null), nodeFor(specs, null), "def.spell.glimmerfrost");
  assert.deepEqual(built.flags[MODULE_ID].spell.effects[0].anyOf, scope.anyOf, "the binder writes the branches as authored");
  assert.deepEqual(spellRecipeProblems({ effects: [specs[0]] }), [], "and the rules accept them");
});

t("a values spec carries the area's measure and unit, and locates its size and its width", () => {
  const prose = paras("The spell fills a strip of mist, 20’ in length and 6’ wide.");
  const spec = {
    target: { model: "area", area: { shape: "line", measure: "length", unit: "feet" } },
    onMiss: "blank",
    from: [
      { into: "target.area.size", pattern: "(\\d+)\\S?\\s*in\\s*length" },
      { into: "target.area.width", pattern: "length\\s*and\\s*(\\d+)\\S?\\s*wide" },
    ],
  };
  const [frag] = materializeEffects([spec], prose);
  assert.deepEqual(frag.target.area.size, { kind: "flat", flat: 20 });
  assert.deepEqual(frag.target.area.width, { kind: "flat", flat: 6 }, "the width is a located level value");
  assert.equal(frag.unread, undefined);
  assert.equal(frag.target.area.measure, "length");
  assert.equal(frag.target.area.unit, "feet");
  assert.deepEqual(spellRecipeProblems({ values: [spec] }), [], "a length with its width locator is well formed");
});

t("the recipe rules refuse an area size with no measure, a pattern that never names it, a length with no width, and a stray width", () => {
  const sizeLoc = (pattern) => ({ into: "target.area.size", pattern });
  const area = (areaSpec, from) => spellRecipeProblems({ values: [{ target: { model: "area", area: areaSpec }, from }] });
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  has(area({ shape: "sphere" }, [sizeLoc("an (\\d+) radius")]), "states no target.area.measure");
  has(area({ shape: "sphere", measure: "radius" }, [sizeLoc("an (\\d+) diameter")]), 'never says "radius"');
  assert.deepEqual(area({ shape: "sphere", measure: "radius" }, [sizeLoc("a (\\d+)\\S? RADIUS")]), [], "the word is found whatever its case");
  has(area({ shape: "line", measure: "length" }, [sizeLoc("is (\\d+) length")]), "locates no target.area.width");
  assert.deepEqual(area({ shape: "line", measure: "length" }, [sizeLoc("is (\\d+) length"), { into: "target.area.width", pattern: "by (\\d+)" }]), []);
  has(area({ shape: "sphere", measure: "radius" }, [sizeLoc("a (\\d+) radius"), { into: "target.area.width", pattern: "(\\d+)" }]), "only a length measure reads");
  has(area({ shape: "sphere", measure: "breadth" }, []), "is not an area measure");
  has(area({ shape: "sphere", measure: "radius", unit: "leagues" }, []), "is not a distance unit");
  has(area({ shape: "sphere", size: { kind: "flat", flat: 5 } }, []), "target.area.size is not structure");
  assert.deepEqual(area({ shape: "sphere", measure: "diameter", unit: "miles" }, []), [], "a measure and a unit with no located size are well formed");
});

t("the recipe rules check an anyOf branch: its keys, its values, a clause, and never a sign", () => {
  const row = (anyOf) => spellRecipeProblems({ effects: [{ type: "modifier", target: "ac", anyOf }] });
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  assert.deepEqual(row([{ vsEnemy: true }, { vsKinds: ["alpha"], vsAlignment: "lawful" }]), []);
  has(row([]), "non-empty list");
  has(row("alpha"), "non-empty list");
  has(row(["alpha"]), "is not an object");
  has(row([{ vsEnemy: true, sign: -1 }]), 'carries "sign"');
  has(row([{ vsAlignment: "lawful", vsAlignmentMode: "sign" }]), "never takes sign");
  has(row([{ anyOf: [{ vsEnemy: true }] }]), 'carries "anyOf"');
  has(row([{ tones: ["alpha"] }]), 'carries "tones"');
  has(row([{}]), "declares no clause");
  has(row([{ vsEnemy: false }]), "declares no clause");
  has(row([{ vsEnemy: "yes" }]), "vsEnemy is true or false");
  has(row([{ vsAlignment: "sideways" }]), "is not an alignment");
  has(row([{ vsAlignmentOf: "target" }]), "is not an alignment reference");
  has(row([{ vsKinds: "alpha" }]), "list of kind tokens");
  has(spellRecipeProblems({ effects: [{ type: "modifier", target: "ac", vsAlignmentOf: "elsewhere" }] }), "is not an alignment reference");
  assert.deepEqual(spellRecipeProblems({ effects: [{ type: "modifier", target: "ac", vsEnemy: true, vsAlignmentOf: "source", vsAlignmentMode: "except" }] }), [], "a row's own scope keys are structure");
});


console.log(`\n${n} tests passed`);
