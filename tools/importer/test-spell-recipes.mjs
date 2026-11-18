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
import { REPAIR, decidedPolicy, mergeRowsByOrigin, refreshPlan } from "../../scripts/importer/refresh.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { SPELL_NARROWING_WORDS, spellRecipeProblems, spellcastingModProblems } from "./spell-recipe-rules.mjs";

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
  key: "scorch",
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
  assert.equal(spell.effects[0].key, "scorch", "the authored key rides into the row");
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
/*  repair by origin and key                     */
/* -------------------------------------------- */

const register = (roll) => ({ type: "damage", roll, origin: "register" });
const reg = (key, roll) => ({ key, type: "damage", roll, origin: "register" });
const judge = { type: "heal", roll: "1d4", origin: "" };
const edited0 = { type: "damage", roll: "9d9", origin: "" };
const own = { key: "_abcd1234", type: "damage", roll: "7d7", origin: "" };
const edited = (key, roll = "9d9") => ({ key, type: "damage", roll, origin: "" });
const stored = (rows, { retired, spell = {}, read } = {}) => ({
  type: "spell",
  system: {},
  flags: { [MODULE_ID]: { spell: { ...spell, effects: rows, ...(retired ? { retired } : {}) }, ...(read ? { cookbook: { read: { spell: read } } } : {}) } },
});
const freshBuild = (rows, { spell = {}, read } = {}) => ({
  type: "spell",
  system: {},
  flags: { [MODULE_ID]: { spell: { ...spell, ...(rows ? { effects: rows } : {}) }, ...(read ? { cookbook: { read: { spell: read } } } : {}) } },
});
const rowsAfter = (plan) => plan.update.flags[MODULE_ID].spell.effects;

t("a repair replaces the register's rows from the fresh bind and keeps a Judge's, in order", () => {
  const plan = refreshPlan(stored([judge, register("1d1"), edited0]), freshBuild([register("2d2"), register("3d3")]), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [judge, register("2d2"), register("3d3"), edited0]);
});

t("a stamped row with no key is replaced, and so is one whose key the build no longer has", () => {
  const { rows, kept } = mergeRowsByOrigin([register("1d1"), judge, reg("gone", "5d5")], [reg("a", "2d2"), reg("b", "3d3")]);
  assert.deepEqual(rows, [reg("a", "2d2"), reg("b", "3d3"), judge]);
  assert.deepEqual(kept, []);
});

t("a stamped row is replaced by the fresh row of its key, in its own place", () => {
  const { rows } = mergeRowsByOrigin([judge, reg("b", "1d1"), own, reg("a", "1d1")], [reg("a", "2d2"), reg("b", "3d3")]);
  assert.deepEqual(rows, [judge, reg("b", "3d3"), own, reg("a", "2d2")]);
});

t("a register row the fresh build gained goes in straight after the row that precedes it in the build", () => {
  const { rows } = mergeRowsByOrigin([judge, reg("a", "1d1")], [reg("a", "2d2"), reg("c", "4d4")]);
  assert.deepEqual(rows, [judge, reg("a", "2d2"), reg("c", "4d4")]);
});

t("a register row missing from the middle returns to its recipe place, and one with nothing before it to the first stamped row's", () => {
  const middle = mergeRowsByOrigin([reg("a", "1d1"), reg("c", "1d1"), judge], [reg("a", "2d2"), reg("b", "3d3"), reg("c", "4d4")]);
  assert.deepEqual(middle.rows, [reg("a", "2d2"), reg("b", "3d3"), reg("c", "4d4"), judge]);
  const first = mergeRowsByOrigin([judge, reg("b", "1d1")], [reg("a", "2d2"), reg("b", "3d3")]);
  assert.deepEqual(first.rows, [judge, reg("a", "2d2"), reg("b", "3d3")]);
});

t("an edited register row stands in for the fresh one, which is not added, and is held when it no longer covers it", () => {
  const mine = edited("a");
  const { rows, kept } = mergeRowsByOrigin([judge, mine], [reg("a", "2d2")]);
  assert.deepEqual(rows, [judge, mine], "no fourth row beside the Judge's");
  assert.deepEqual(kept, [{ key: "a", current: mine, page: reg("a", "2d2") }]);
  const plan = refreshPlan(stored([judge, mine]), freshBuild([reg("a", "2d2")]), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [judge, mine]);
  assert.deepEqual(plan.keptRows, [{ key: "a", current: mine, page: reg("a", "2d2"), path: "spell.effects" }]);
});

t("a decision that takes the held row puts the fresh row in its place, and no other row moves", () => {
  const { rows, kept } = mergeRowsByOrigin([judge, edited("a"), own], [reg("a", "2d2")], { take: new Set(["a"]) });
  assert.deepEqual(rows, [judge, reg("a", "2d2"), own]);
  assert.deepEqual(kept, []);
});

t("a Judge's row that still covers the fresh row raises nothing, whatever it adds or clears beside it", () => {
  const fresh = { ...reg("a", "2d2"), damage: ["alpha"], unread: ["extraordinary"] };
  const mine = { ...edited("a", "2d2"), damage: ["alpha"], note: "mine", condition: "when angry", extraordinary: true };
  const { rows, kept } = mergeRowsByOrigin([mine], [fresh]);
  assert.deepEqual(rows, [mine]);
  assert.deepEqual(kept, []);
});

t("a retired key is skipped and held, and a decision that takes it writes the row and clears the key", () => {
  const kept = mergeRowsByOrigin([judge], [reg("a", "2d2"), reg("b", "3d3")], { retired: ["a"] });
  assert.deepEqual(kept.rows, [reg("b", "3d3"), judge]);
  assert.deepEqual(kept.retired, ["a"]);
  assert.deepEqual(kept.kept, [{ key: "a", page: reg("a", "2d2"), retired: true }]);
  const taken = mergeRowsByOrigin([judge], [reg("a", "2d2"), reg("b", "3d3")], { retired: ["a"], take: new Set(["a"]) });
  assert.deepEqual(taken.rows, [reg("a", "2d2"), reg("b", "3d3"), judge]);
  assert.deepEqual(taken.retired, []);
  assert.deepEqual(taken.kept, []);
  const plan = refreshPlan(stored([judge], { retired: ["a"] }), freshBuild([reg("a", "2d2")]), REPAIR.spell);
  assert.deepEqual(rowsAfter(plan), [judge], "the repair writes no row for a retired key");
  assert.deepEqual(plan.keptRows.map((r) => [r.key, r.retired]), [["a", true]]);
  assert.ok(!("retired" in plan.update.flags[MODULE_ID].spell), "and leaves the retired list as it stands");
  const restored = refreshPlan(stored([judge], { retired: ["a"] }), freshBuild([reg("a", "2d2")]), { ...REPAIR.spell, takeRows: new Set(["a"]) });
  assert.deepEqual(rowsAfter(restored), [reg("a", "2d2"), judge]);
  assert.deepEqual(restored.update.flags[MODULE_ID].spell.retired, []);
});

t("a Judge's own row, keyed with an underscore, stays through every repair, a forced one included", () => {
  const unforced = mergeRowsByOrigin([own, reg("a", "1d1")], [reg("a", "2d2")]);
  assert.deepEqual(unforced.rows, [own, reg("a", "2d2")]);
  const forced = mergeRowsByOrigin([own, edited("a")], [reg("a", "2d2")], { force: true });
  assert.deepEqual(forced.rows, [own, reg("a", "2d2")], "force puts the page over an edited register row");
  assert.deepEqual(forced.kept, []);
});

t("a forced repair writes a retired row back and clears the key", () => {
  const plan = refreshPlan(stored([judge], { retired: ["a"] }), freshBuild([reg("a", "2d2")]), { ...REPAIR.spell, force: true });
  assert.deepEqual(rowsAfter(plan), [reg("a", "2d2"), judge]);
  assert.deepEqual(plan.update.flags[MODULE_ID].spell.retired, []);
  assert.deepEqual(plan.keptRows, []);
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
  assert.deepEqual(mergeRowsByOrigin(undefined, [register("1d1")]).rows, [register("1d1")]);
  assert.deepEqual(mergeRowsByOrigin([judge], undefined).rows, [judge]);
});

/* -------------------------------------------- */
/*  the values leaves                            */
/* -------------------------------------------- */

const READ = { "save%2Ecategory": "alpha", "target%2Earea%2Esize%2Eflat": 15, "target%2Efilters": ["living"] };
const spellOf = (category) => ({ save: { category, effect: "half" }, target: { area: { size: { kind: "flat", flat: 15 } }, filters: ["living"] } });
const leafPlan = (have, { stamp = READ, page = "beta", policy = REPAIR.spell } = {}) =>
  refreshPlan(stored([], { spell: spellOf(have), ...(stamp ? { read: stamp } : {}) }), freshBuild([], { spell: spellOf(page), read: { ...READ, "save%2Ecategory": page } }), policy);
const writtenCategory = (plan) => plan.update.flags[MODULE_ID].spell.save?.category;
const stampedCategory = (plan) => plan.update.flags[MODULE_ID].cookbook.read.spell["save%2Ecategory"];

t("a leaf still as the import wrote it takes the page's new figure, and the stamp follows", () => {
  const plan = leafPlan("alpha");
  assert.equal(writtenCategory(plan), "beta");
  assert.equal(stampedCategory(plan), "beta");
  assert.deepEqual(plan.keptLeaves, []);
});

t("a leaf that already holds the page's figure raises nothing", () => {
  const plan = leafPlan("beta");
  assert.equal(writtenCategory(plan), "beta");
  assert.deepEqual(plan.keptLeaves, []);
});

t("a leaf that differs from both the stamp and the page is held, and the stamp keeps what the import wrote", () => {
  const plan = leafPlan("gamma");
  assert.equal(writtenCategory(plan), undefined, "the Judge's figure is not written over");
  assert.equal(plan.update.flags[MODULE_ID].spell.save.effect, "half", "its neighbours still are");
  assert.equal(stampedCategory(plan), "alpha", "the next repair finds the difference again");
  assert.deepEqual(plan.keptLeaves, [{ path: "spell", leaf: "save.category", current: "gamma", page: "beta" }]);
  assert.equal(leafPlan("gamma", { stamp: plan.update.flags[MODULE_ID].cookbook.read.spell }).keptLeaves.length, 1, "and holds it again");
});

t("a decision that takes the held leaf writes the page's figure and stamps it", () => {
  const plan = leafPlan("gamma", { policy: { ...REPAIR.spell, takeLeaves: new Set(["save.category"]) } });
  assert.equal(writtenCategory(plan), "beta");
  assert.equal(stampedCategory(plan), "beta");
  assert.deepEqual(plan.keptLeaves, []);
});

t("a leaf in a spell imported before the stamp existed takes the page", () => {
  const plan = leafPlan("gamma", { stamp: null });
  assert.equal(writtenCategory(plan), "beta");
  assert.deepEqual(plan.keptLeaves, []);
});

t("a forced repair writes the page's figure over a leaf a Judge changed", () => {
  const plan = leafPlan("gamma", { policy: { ...REPAIR.spell, force: true } });
  assert.equal(writtenCategory(plan), "beta");
  assert.deepEqual(plan.keptLeaves, []);
});

t("a leaf nested several levels deep, and an array leaf, are held by their dotted path", () => {
  const mine = spellOf("alpha");
  mine.target.area.size.flat = 30;
  mine.target.filters = ["dead"];
  const plan = refreshPlan(stored([], { spell: mine, read: READ }), freshBuild([], { spell: { ...spellOf("alpha"), target: { area: { size: { kind: "flat", flat: 20 } }, filters: ["living", "dead"] } }, read: { ...READ, "target%2Earea%2Esize%2Eflat": 20, "target%2Efilters": ["living", "dead"] } }), REPAIR.spell);
  assert.deepEqual(plan.keptLeaves.map((l) => l.leaf), ["target.area.size.flat", "target.filters"]);
  assert.equal(plan.update.flags[MODULE_ID].spell.target.area.size.flat, undefined);
  assert.equal(plan.update.flags[MODULE_ID].spell.target.filters, undefined);
});

t("bindSpell stamps the leaves its values fragments wrote, a nested one and an array one each as a leaf of its own", () => {
  const specs = [{ ...ROW, onMiss: "blank" }];
  const values = [{ ...VALUES, onMiss: "blank" }];
  const built = bindSpell(entryFor(specs, values), nodeFor(specs, values), "def.spell.glimmerfrost");
  const read = built.flags[MODULE_ID].cookbook.read.spell;
  assert.equal(read["save%2Ecategory"], "death");
  assert.equal(read["target%2Earea%2Esize%2Eflat"], 15);
  assert.equal(read["target%2Earea%2Esize%2Ekind"], "flat");
  assert.deepEqual(read["target%2Efilters"], ["living"]);
  assert.equal(read["target%2Earea%2Eshape"], "cone", "a structure leaf the recipe states is recorded too");
  assert.ok(!Object.keys(read).some((k) => k.includes("unread")));
  const plain = bindSpell(entryFor([{ ...ROW, onMiss: "blank" }], null), nodeFor([{ ...ROW, onMiss: "blank" }], null), "def.spell.glimmerfrost");
  assert.ok(!("read" in plain.flags[MODULE_ID].cookbook), "a spell with no values recipe records no leaves");
});

t("a merged repair lists a held row and a held leaf as edits, and a decision that takes them writes both", () => {
  const source = { name: "Glimmerfrost", ...stored([edited("a")], { spell: spellOf("gamma"), read: READ }) };
  const built = freshBuild([reg("a", "2d2")], { spell: spellOf("beta"), read: { ...READ, "save%2Ecategory": "beta" } });
  const kept = decidedPolicy(source, built, REPAIR.spell, { uuid: "Item.x" });
  assert.deepEqual(kept.edits.map((e) => e.path), [`flags.${MODULE_ID}.spell.effects[a]`, `flags.${MODULE_ID}.spell.save.category`]);
  assert.match(kept.edits[0].current, /^Damage: .*9d9/, "a row reads as its one-line description");
  assert.match(kept.edits[0].page, /2d2/);
  assert.equal(kept.edits[1].current, "gamma");
  assert.equal(writtenCategory(refreshPlan(source, built, kept.policy)), undefined);
  const taken = decidedPolicy(source, built, REPAIR.spell, { uuid: "Item.x", decision: "take" });
  assert.deepEqual(taken.edits, []);
  const plan = refreshPlan(source, built, taken.policy);
  assert.deepEqual(rowsAfter(plan), [reg("a", "2d2")]);
  assert.equal(writtenCategory(plan), "beta");
  const one = decidedPolicy(source, built, REPAIR.spell, { uuid: "Item.x", decision: { take: new Set([kept.edits[0].key]) } });
  assert.deepEqual(one.edits.map((e) => e.path), [`flags.${MODULE_ID}.spell.save.category`], "each edit is decided by its own key");
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
  assert.deepEqual(spellRecipeProblems({ effects: [{ key: "k", type: "modifier", target: "damage", gate: { kind: "weaponMundane" }, notStacksWith: ["kw:x"] }] }), []);
  assert.ok(spellRecipeProblems({ effects: [{ key: "k", type: "modifier", target: "damage", gate: { kind: "nowhere" } }] }).some((p) => p.includes("gate.kind")));
});

t("the recipe rules require a key on every row, in the module's pattern, once per entry, a reversed twin's included", () => {
  const rows = (...keys) => keys.map((key) => ({ ...(key === undefined ? {} : { key }), type: "heal" }));
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  has(spellRecipeProblems({ effects: rows(undefined) }), "effects[0] carries no key");
  has(spellRecipeProblems({ effects: rows("mend", "mend") }), 'effects[1].key "mend" repeats effects[0]');
  assert.deepEqual(spellRecipeProblems({ effects: [...rows("mend"), { ...rows("mendReversed")[0], reversed: true }] }), [], "a reversed twin with a key of its own is well formed");
  for (const bad of ["Mend", "1mend", "_abcd1234", "mend-it", "mend it", ""]) has(spellRecipeProblems({ effects: rows(bad) }), "is not a key");
  has(spellRecipeProblems({ effects: [{ type: "heal", key: 5 }] }), "is not a key");
  assert.deepEqual(spellRecipeProblems({ effects: rows("a", "b2", "cD3") }), []);
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

t("a row's recurrence, pick option, rounds and size exemption materialize, bind, and pass the rules", () => {
  const prose = paras("A creature that fails takes 2d8 + 3 acidic damage, and is held for 1d4 rounds. Any being of Huge build is unmoved.");
  const specs = [
    {
      ...ROW,
      key: "pulse",
      lasts: "rounds",
      recur: "laterRounds",
      recurAt: "bearerStart",
      recurSave: "row",
      recurTarget: "pick",
      pick: "mode",
      pickOption: "held",
      onMiss: "blank",
      from: [
        ...ROW.from,
        { into: "rounds", pattern: "held\\s*for\\s*(\\d*d\\d+)\\s*rounds" },
        { into: "exemptSizeFrom", pattern: "any\\s*being\\s*of\\s*(\\w+)\\s*build" },
      ],
    },
  ];
  const [row] = materializeEffects(specs, prose);
  assert.equal(row.rounds, "1d4");
  assert.equal(row.exemptSizeFrom, "huge");
  for (const field of ["recur", "recurAt", "recurSave", "recurTarget", "pick", "pickOption", "lasts"]) assert.equal(row[field], specs[0][field], `${field} ships as authored`);
  const built = bindSpell(entryFor(specs, null), { fields: { ...nodeFor(specs, null).fields, description: prose, effects: [row] } }, "def.spell.glimmerfrost");
  const written = built.flags[MODULE_ID].spell.effects[0];
  for (const field of ["rounds", "exemptSizeFrom", "recurAt", "recurSave", "recurTarget", "pickOption"]) assert.equal(written[field], row[field], `${field} survives the binder`);
  assert.deepEqual(spellRecipeProblems({ effects: specs }), [], "and the rules accept them");
});

t("the recipe rules refuse a literal count, a loose recurrence field, a stray option and an unread rounds", () => {
  const base = { key: "k", type: "damage", from: [{ into: "roll", pattern: "(\\d+d\\d+)" }] };
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  const ladder = { into: "value", on: "level", pattern: "(\\d+)" };
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ ...ladder, count: 2 }] }] }), "from[0].count is a literal figure");
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ ...ladder, increment: 1 }] }] }), "from[0].increment is a literal figure");
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ ...ladder, steps: [1, 3] }] }] }), "from[0].steps is a literal figure");
  has(spellRecipeProblems({ effects: [{ ...base, rounds: "1d4" }] }), "effects[0].rounds is located from the page");
  has(spellRecipeProblems({ effects: [{ ...base, exemptSizeFrom: "huge" }] }), "effects[0].exemptSizeFrom is located from the page");
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ ...ladder, accumulate: 1 }] }] }), "accumulate is true or absent");
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ into: "value", accumulate: true, pattern: "(\\d+)" }] }] }), 'accumulate reads a ladder and needs "on"');
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ ...ladder, articles: "yes" }] }] }), "articles is true or absent");
  has(spellRecipeProblems({ effects: [{ ...base, recurAt: "bearerStart" }] }), "recurAt needs a recur");
  has(spellRecipeProblems({ effects: [{ ...base, recur: "eachRound", recurAt: "sometime" }] }), "is not a recurrence moment");
  has(spellRecipeProblems({ effects: [{ ...base, recur: "eachRound", recurSave: "both" }] }), "is not a recurrence save");
  has(spellRecipeProblems({ effects: [{ ...base, recur: "eachRound", recurTarget: "all" }] }), "is not a recurrence target");
  has(spellRecipeProblems({ effects: [{ ...base, pickOption: "a" }] }), "pickOption names an option of a pick group");
  has(spellRecipeProblems({ effects: [{ ...base, lasts: "rounds" }] }), "no locator reads its rounds");
  has(spellRecipeProblems({ effects: [{ ...base, from: [{ into: "rounds", pattern: "(\\d+d\\d+)" }] }] }), "its lasts is not rounds");
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...base, lasts: "nextTurn", recur: "eachRound", recurAt: "casterTurn", recurTarget: "pick" }] }), []);
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
  const row = (anyOf) => spellRecipeProblems({ effects: [{ key: "k", type: "modifier", target: "ac", anyOf }] });
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
  assert.deepEqual(spellRecipeProblems({ effects: [{ key: "k", type: "modifier", target: "ac", vsEnemy: true, vsAlignmentOf: "source", vsAlignmentMode: "except" }] }), [], "a row's own scope keys are structure");
});


/* -------------------------------------------- */
/*  a printed option list: each, conditions      */
/* -------------------------------------------- */

// An invented option list: three numbered options, the middle one naming no condition the catalogue holds.
const OPTIONS = paras(
  "The caster picks one mood for the target. First, the target is blinded and zorbed, for the length of the spell. Second, the target turns zorbed or flumped. Third, the target is deafened, Concentrating and Stationary, or berserk.",
);
const EACH_ROW = {
  key: "mood",
  type: "conditionGrant",
  appliesTo: "target",
  pick: "mood",
  each: { pattern: "(?:First|Second|Third),[^.]*\\." },
  from: [{ into: "conditions", pattern: "target\\s*(?:is|turns)\\s*([^.]*)" }],
};

t("a row's each expands once per match in page order into keyed rows and options, and drops an option naming no known word", () => {
  const rows = materializeEffects([EACH_ROW], OPTIONS);
  assert.deepEqual(rows.map((r) => r.key), ["mood1", "mood3"], "the second option names no condition; its number is left unused");
  assert.deepEqual(rows.map((r) => r.pickOption), ["1", "3"], "pickOption is the match's place, as a string");
  assert.deepEqual(rows[0].conditions, ["blinded"], "a word no catalogue member answers to is skipped inside a list");
  assert.deepEqual(rows[1].conditions, ["deafened", "concentratingStationary", "berserk"], "a label of several words reads whole, in printed order");
  assert.ok(rows.every((r) => r.pick === "mood" && !("each" in r) && r.type === "conditionGrant"), "the structure ships, the template locator does not");
  assert.deepEqual(materializeEffects([{ ...EACH_ROW, onMiss: "blank" }], OPTIONS).map((r) => r.key), ["mood1", "mood3"], "onMiss blank never keeps an option with no condition");
});

t("each reads its locators inside the match, and a note locator reads inside it too", () => {
  const prose = paras("Option A: the target is mute. Option B: the target is prone, noting it falls.");
  const rows = materializeEffects(
    [{ ...EACH_ROW, key: "opt", each: { pattern: "Option\\s*[AB]:[^.]*\\." }, noteFrom: { pattern: "noting\\s*(it\\s*falls)" } }],
    prose,
  );
  assert.deepEqual(rows.map((r) => [r.key, r.pickOption, r.conditions]), [["opt1", "1", ["mute"]], ["opt2", "2", ["prone"]]]);
  assert.equal(rows[0].note, undefined, "a clause outside the match is not read");
  assert.equal(rows[1].note, "it falls");
  const grouped = materializeEffects([{ ...EACH_ROW, each: { pattern: "(First|Second|Third),\\s*([^.]*)\\.", group: 2 } }], OPTIONS);
  assert.deepEqual(grouped.map((r) => r.key), ["mood1", "mood3"], "a group narrows what each match reads");
});

t("each yields no row with no page, no match or a malformed pattern, and never throws", () => {
  assert.deepEqual(materializeEffects([EACH_ROW], []), []);
  assert.deepEqual(materializeEffects([EACH_ROW], paras("Nothing is listed here.")), []);
  assert.deepEqual(materializeEffects([{ ...EACH_ROW, each: { pattern: "(\\d" } }], OPTIONS), []);
  assert.deepEqual(materializeEffects([{ ...EACH_ROW, each: {} }], OPTIONS), []);
});

t("the conditions locator maps words onto catalogue keys, singular or plural, and a row with none known is a miss", () => {
  const one = (body, extra = {}) => materializeEffects([{ type: "conditionGrant", ...extra, from: { into: "conditions", pattern: "(\\w[\\w ,/]*)\\." } }], paras(body));
  assert.deepEqual(one("Mute, prone, and zorbed.")[0].conditions, ["mute", "prone"]);
  assert.deepEqual(one("Choking / Vomiting.")[0].conditions, ["choking"], "a label punctuated as printed maps to its key");
  assert.deepEqual(one("Mute, mute, mute.")[0].conditions, ["mute"], "each key once");
  assert.deepEqual(one("Zorbed and flumped."), [], "no known word drops the row");
  assert.deepEqual(one("Zorbed and flumped.", { onMiss: "blank" })[0].unread, ["conditions"], "or lists the field as unread under onMiss blank");
});

t("target.hdBelow is a locatable level value like hdCap", () => {
  const prose = paras("Creatures of fewer than 5 Hit Dice are affected, and creatures of 3 Hit Dice or less drop.");
  const [frag] = materializeEffects(
    [{ target: { model: "area" }, from: [{ into: "target.hdBelow", pattern: "fewer\\s*than\\s*(\\d+)\\s*Hit" }, { into: "target.hdCap", pattern: "of\\s*(\\d+)\\s*Hit\\s*Dice\\s*or" }] }],
    prose,
  );
  assert.deepEqual(frag.target.hdBelow, { kind: "flat", flat: 5 });
  assert.deepEqual(frag.target.hdCap, { kind: "flat", flat: 3 });
  assert.equal(frag.target.model, "area");
  assert.deepEqual(spellRecipeProblems({ values: [{ target: { model: "area" }, from: { into: "target.hdBelow", pattern: "(\\d+)" } }] }), []);
});

t("a values spec's reversedDurationFromNote parses duration.note into reversedDuration, same shape as duration", () => {
  const values = [{ ...VALUES, onMiss: "blank", reversedDurationFromNote: true }];
  const bind = (duration, specs = values) => {
    const node = { fields: { ...nodeFor(null, null).fields, stat: `Arcane 3 Type: blast Range: 60’ Duration: ${duration}` } };
    node.fields.values = materializeEffects(specs, PROSE);
    return bindSpell(entryFor(null, specs), node, "def.spell.glimmerfrost").flags[MODULE_ID];
  };
  const made = bind("3 turns (2 rounds)");
  const spell = made.spell;
  assert.equal(spell.duration.shape, "fixed");
  assert.deepEqual(Object.keys(spell.reversedDuration), Object.keys(spell.duration), "the same shape as duration");
  assert.equal(spell.reversedDuration.value, 2);
  assert.equal(spell.reversedDuration.unit, "rounds");
  assert.ok(!("reversedDurationFromNote" in spell), "the switch never reaches the world");
  assert.equal(made.cookbook.read.spell["reversedDuration%2Evalue"], 2, "a repair can tell the Judge's edit from the import's");
  assert.ok(!("reversedDuration" in bind("3 turns (2 rounds)", [{ ...VALUES, onMiss: "blank" }]).spell), "a spec that does not ask writes none");
  assert.ok(!("reversedDuration" in bind("3 turns").spell), "no parenthetical, no reversed duration");
  assert.ok(!("reversedDuration" in bind("3 turns (zorbed)").spell), "a note that reads as no duration writes none");
  assert.deepEqual(spellRecipeProblems({ values: [{ ...VALUES, reversedDurationFromNote: true }] }), []);
  assert.ok(spellRecipeProblems({ values: [{ ...VALUES, reversedDurationFromNote: "yes" }] }).some((p) => p.includes("reversedDurationFromNote is true or absent")));
});

t("the recipe rules hold an each row to a pick and a key, refuse its pickOption, and keep authored condition keys structure", () => {
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  assert.deepEqual(spellRecipeProblems({ effects: [EACH_ROW] }), [], "a well-formed template row");
  const { pick, ...noPick } = EACH_ROW;
  const { key, ...noKey } = EACH_ROW;
  has(spellRecipeProblems({ effects: [noPick] }), "each expands into the options of a pick group");
  has(spellRecipeProblems({ effects: [noKey] }), "each numbers its rows from the row's key");
  has(spellRecipeProblems({ effects: [{ ...EACH_ROW, pickOption: "a" }] }), "each writes each row's pickOption");
  has(spellRecipeProblems({ effects: [{ ...EACH_ROW, each: { pattern: "(\\d" } }] }), "each.pattern does not compile");
  has(spellRecipeProblems({ effects: [{ ...EACH_ROW, each: { pattern: "x", group: "2" } }] }), "each.group is a capture group number");
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...EACH_ROW, each: { pattern: "x", group: 2 } }] }), [], "a group number is not a printed figure");
  assert.deepEqual(spellRecipeProblems({ effects: [{ key: "k", type: "conditionGrant", conditions: ["berserk"] }] }), [], "a row may still author its condition keys");
  has(spellRecipeProblems({ effects: [{ key: "k", type: "conditionGrant", conditions: ["berserk"], from: EACH_ROW.from }] }), "conditions is located from the page and also written");
});


// Invented ability prose for the spellcastingMod recipes: every word and figure is made up.
const ABILITY = paras(
  "The bearer is a master of frost magic. When casting rime spells, the spell effects are calculated as if he were two class levels higher. Targets of his rime spells suffer a -3 penalty on their saves. He rebukes ghosts as a priest of one half his class level.",
);
const CL = { type: "spellcastingMod", target: "casterLevel", schools: ["protection"], onMiss: "blank", from: { pattern: "calculated\\s*as\\s*if\\s*he\\s*were\\s*(\\w+)\\s*(?:class|caster)\\s*levels?" } };
const SV = { type: "spellcastingMod", target: "save", saveCategories: ["paralysis"], onMiss: "blank", from: { pattern: "suffer\\s*a\\s*(-\\d+)\\s*penalty" } };

t("a spellcastingMod recipe locates its figure with the sign the page prints, and the narrowing words ride unchanged", () => {
  const [cl, sv] = materializeEffects([CL, SV], ABILITY);
  assert.deepEqual(cl.value, { kind: "flat", flat: 2 });
  assert.deepEqual(cl.schools, ["protection"]);
  assert.equal(cl.casterLevelDelta, undefined);
  assert.deepEqual(sv.value, { kind: "flat", flat: -3 });
  assert.deepEqual(sv.saveCategories, ["paralysis"]);
});

t("a spellcastingMod row whose figure the page does not print stays, blank and listed, with its narrowing", () => {
  const [row] = materializeEffects([CL], paras("Nothing here."));
  assert.equal(row.value, undefined);
  assert.deepEqual(row.unread, ["value"]);
  assert.deepEqual(row.schools, ["protection"]);
  assert.deepEqual(materializeEffects([{ ...CL, onMiss: undefined }], paras("Nothing here.")), [], "without onMiss a miss drops the row");
});

t("an atLevel locator writes a progressionAs row's fraction pair, and nothing at a whole level", () => {
  const spec = (word) => ({ type: "progressionAs", as: "priest", from: { into: "atLevel", pattern: `priest\\s*of\\s*(${word})\\s*his\\s*class\\s*level` } });
  const [half] = materializeEffects([spec("one\\s*half")], ABILITY);
  assert.deepEqual([half.as, half.atLevelNum, half.atLevelDen], ["priest", 1, 2]);
  const [third] = materializeEffects([spec("two-thirds")], paras("as a priest of two-thirds his class level"));
  assert.deepEqual([third.atLevelNum, third.atLevelDen], [2, 3]);
  const [whole] = materializeEffects([spec("one")], paras("as a priest of one his class level"));
  assert.equal(whole.atLevelNum, undefined);
  assert.deepEqual(materializeEffects([spec("zzz")], ABILITY), [], "a word that is no proportion drops the row");
});

t("the spellcastingMod lint holds rule 104's guards, the word lists, literal figures and stacking tokens", () => {
  const has = (problems, s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem naming: ${s}\n${problems.join("\n")}`);
  assert.deepEqual(spellcastingModProblems([CL, SV, { type: "modifier", target: "research" }]), [], "well-formed rows, and a row of another type is not this lint's");
  has(spellcastingModProblems([{ ...CL, target: "range" }]), "is not one of casterLevel, save, damage");
  has(spellcastingModProblems([{ ...CL, schools: undefined }]), "narrows on no spell");
  has(spellcastingModProblems([{ ...CL, schools: ["glitter"] }]), 'names "glitter"');
  has(spellcastingModProblems([{ ...CL, schools: [] }]), "non-empty list of words");
  assert.deepEqual(spellcastingModProblems([{ ...CL, schools: [...SPELL_NARROWING_WORDS] }]), [], "an allowlisted word passes");
  has(spellcastingModProblems([{ ...SV, saveCategories: ["none"] }]), "no save category");
  has(spellcastingModProblems([{ ...CL, value: { kind: "flat", flat: 2 } }]), "value is a literal figure");
  has(spellcastingModProblems([{ ...CL, casterLevelDelta: 2 }]), "casterLevelDelta is a literal figure");
  has(spellcastingModProblems([{ ...CL, from: undefined }]), "locates no value");
  has(spellcastingModProblems([{ ...CL, from: { into: "roll", pattern: "x" } }]), "locates no value");
  has(spellcastingModProblems([{ ...CL, perDie: true }]), "perDie is true on a damage row");
  assert.deepEqual(spellcastingModProblems([{ ...CL, target: "damage", perDie: true, bySelection: true, schools: undefined }]), []);
  has(spellcastingModProblems([{ ...CL, bySelection: "yes" }]), "bySelection is true or absent");
  const known = (token) => ["kw:alpha", "def.prof.alpha"].includes(token);
  assert.deepEqual(spellcastingModProblems([{ ...CL, ifHas: ["kw:alpha"], notStacksWith: ["def.prof.alpha"] }], { tokenKnown: known }), []);
  has(spellcastingModProblems([{ ...CL, ifHas: ["kw:alpah"] }], { tokenKnown: known }), 'names "kw:alpah"');
  has(spellcastingModProblems([{ ...CL, notStacksWith: ["def.prof.me"] }], { selfId: "def.prof.me" }), "names the ability the row is on");
  has(spellcastingModProblems([{ type: "progressionAs", as: "priest", atLevelNum: 1, atLevelDen: 2 }]), "atLevelNum is a literal fraction");
});

console.log(`\n${n} tests passed`);
