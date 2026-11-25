/**
 * The encounter recipe the importer reads from a creature's own Combat and
 * Ecology prose (`importer/ecology-recipe.mjs`): every part kind, each grammar
 * a sentence is printed in, a sentence no locator reads (no part, no failure),
 * the key a Role cell is filed under, a repair clearing a recipe the page no
 * longer yields, and the data model declaring every field a part stores.
 *
 * Every creature word and every figure here is invented: the sentences copy
 * only the printed GRAMMAR (which word sits where), never a page's words or
 * numbers. The locators are also run against a mutation of each sentence that
 * should no longer match, and must then write nothing for it. The real pages
 * are read by `check-ecology-recipe.mjs`, which stays on the machine that owns
 * the books.
 */
import assert from "node:assert/strict";
import {
  readEcologyRecipe,
  readEcologyRecipeWithSentences,
  attachRecipe,
  recipeReadStamp,
  memberVariant,
  partKind,
  unitsIn,
  RECIPE_BASIS,
} from "../../scripts/importer/ecology-recipe.mjs";
import { refreshPlan, REPAIR } from "../../scripts/importer/refresh.mjs";
import { RECIPE_ROLES, RECIPE_BASES, RECIPE_STATES, RECIPE_PLACES, RECIPE_ROUNDS } from "../../scripts/monsters/config.mjs";

const MODULE = "acks-extras";

/* ---- invented prose, one sentence per locator ---- */

const SPLIT = "35% of gangs or warbands encountered will be archers (round down), 65% will be warriors (round up).";
const GANG = "Each zorb gang will be led by two champions with 9 AC and 14 HD.";
const WARBAND = "Each zorb warband will be led by a sub-chieftain with 11 AC and 17 HD.";
const LAIR = "A zorb lair or village will be led by a chieftain with 13 AC and 21 HD.";
const MORALE = "As long as the chieftain is alive, the zorbs will gain a +4 bonus to morale rolls.";
const DEPENDANTS = "Zorb lairs and villages will have drudges and whelps equal to 150% and 85% of the number of warriors respectively.";
const ENCOUNTERED = "When zorbs are encountered in a village.";
const ESCORT = "The chieftain will be defended by 3d8 guards (equivalent to champions statistically).";
const GUARD = "There is a 41% chance a zorb village will be guarded by 2d12 mossy blimps and another 17% chance for 1d5+2 tall zorbles.";
const CAPTIVES = "There is an 88% chance for 2d8 bound captives per gang.";
const CASTERS = "A village has a 29% chance of a shaman being present, and a 12% chance of a witch doctor.";

const COMBAT = [SPLIT];
const ECOLOGY = [`${GANG} ${WARBAND} ${LAIR} ${MORALE}`, DEPENDANTS, `${ENCOUNTERED} ${ESCORT} ${GUARD} ${CAPTIVES} ${CASTERS}`];

/** An invented stat block's lines, parsed as `lib/encounter-line.mjs` parses them. */
const ENCOUNTER = {
  dungeon: { wandering: { noun: "pod", number: "2d7", unit: "" }, lair: { noun: "nest", number: "2d3", unit: "cells" } },
  wilderness: { wandering: { noun: "", number: "", unit: "" }, lair: { noun: "", number: "", unit: "" } },
};

const read = (over = {}) => readEcologyRecipe({ combat: COMBAT, ecology: ECOLOGY, encounter: ENCOUNTER, variant: "zorb", cite: "XX p.1", ...over });
const byKey = (recipe) => Object.fromEntries(recipe.map((p) => [p.key, p]));
/** The fields a stored part carries, in the order the reader writes them. */
const FIELDS = ["key", "origin", "label", "role", "source", "count", "chance", "when", "branch", "moraleWhileAlive", "fixedHp", "cite", "basis"];

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
};

/* ---- every part kind, in the stored shape ---- */

const recipe = read();
const parts = byKey(recipe);

check("every part carries every field, its page reference and its basis", () => {
  for (const p of recipe) {
    assert.deepEqual(Object.keys(p), FIELDS, p.key);
    assert.equal(p.cite, "XX p.1", p.key);
    assert.equal(p.basis, "page", p.key);
    assert.ok(Object.hasOwn(RECIPE_ROLES, p.role), p.key);
  }
  assert.equal(RECIPE_BASIS, "page");
});

check("the split: each share with its own rounding, over the units the sentence names", () => {
  assert.equal(parts.archers.role, "body");
  assert.deepEqual(parts.archers.count, { dice: "", literal: null, ratioOf: "unit", percent: 35, round: "down", perUnit: "" });
  assert.deepEqual(parts.warriors.count, { dice: "", literal: null, ratioOf: "unit", percent: 65, round: "up", perUnit: "" });
  assert.deepEqual(parts.archers.when.units, ["gang", "warband"]);
  assert.equal(partKind(parts.archers), "split");
});

check("a leader per unit, naming the Role cell, with the chieftain carrying the morale bonus", () => {
  assert.equal(parts["leader-champion"].source.templateCell, "zorb|champion");
  assert.equal(parts["leader-champion"].count.literal, 2);
  assert.deepEqual(parts["leader-champion"].when.units, ["gang"]);
  assert.deepEqual(parts["leader-subChieftain"].when.units, ["warband"]);
  assert.equal(parts["leader-subChieftain"].count.literal, 1);
  assert.deepEqual(parts["leader-chieftain"].when.units, ["lair", "village"]);
  assert.equal(parts["leader-chieftain"].moraleWhileAlive, 4);
  assert.equal(parts["leader-champion"].moraleWhileAlive, null);
  assert.equal(parts["leader-subChieftain"].moraleWhileAlive, null);
});

check("dependants: a share of the warriors per word, the rounding blank where the page prints none", () => {
  assert.equal(parts["dependant-drudge"].role, "dependant");
  assert.equal(parts["dependant-drudge"].source.templateCell, "zorb|drudge");
  assert.deepEqual(parts["dependant-drudge"].count, { dice: "", literal: null, ratioOf: "warriors", percent: 150, round: "", perUnit: "" });
  assert.equal(parts["dependant-whelp"].count.percent, 85);
  assert.equal(parts["dependant-whelp"].source.templateCell, "zorb|whelp");
  assert.deepEqual(parts["dependant-whelp"].when.units, ["lair", "village"]);
});

check("village guard beasts: chance, dice, and the creature as printed, per clause", () => {
  assert.equal(parts["guard-mossy-blimps"].role, "guard");
  assert.deepEqual(parts["guard-mossy-blimps"].source, { uuid: "", templateCell: "", stat: "", name: "mossy blimps" });
  assert.equal(parts["guard-mossy-blimps"].count.dice, "2d12");
  assert.equal(parts["guard-mossy-blimps"].chance, 41);
  assert.equal(parts["guard-tall-zorbles"].count.dice, "1d5+2");
  assert.equal(parts["guard-tall-zorbles"].chance, 17);
  assert.equal(parts["guard-tall-zorbles"].source.name, "tall zorbles");
  assert.deepEqual(parts["guard-mossy-blimps"].when.units, ["village"]);
  assert.equal(parts["guard-mossy-blimps"].branch.group, "");
});

check("the chieftain's escort points at the Role cell it is equivalent to", () => {
  assert.equal(partKind(parts["chieftain-guard"]), "chieftainGuard");
  assert.equal(parts["chieftain-guard"].source.templateCell, "zorb|champion");
  assert.equal(parts["chieftain-guard"].count.dice, "3d8");
  assert.equal(parts["chieftain-guard"].chance, null);
  assert.deepEqual(parts["chieftain-guard"].when.units, ["village"]);
});

check("captives: chance, dice, and the unit the dice is rolled for", () => {
  assert.equal(parts.captives.role, "captive");
  assert.equal(parts.captives.chance, 88);
  assert.equal(parts.captives.count.dice, "2d8");
  assert.equal(parts.captives.count.perUnit, "gang");
  assert.equal(parts.captives.source.name, "bound captives");
});

check("casters: each chance, the part pointing at the Role cell that holds the level die", () => {
  assert.equal(parts["caster-shaman"].chance, 29);
  assert.equal(parts["caster-shaman"].source.templateCell, "zorb|shaman");
  assert.equal(parts["caster-witchDoctor"].chance, 12);
  assert.equal(parts["caster-witchDoctor"].source.templateCell, "zorb|witchDoctor");
  assert.equal(parts["caster-shaman"].count.literal, 1);
  assert.deepEqual(parts["caster-shaman"].when.units, ["village"]);
});

check("the encounter lines' sizes: a body count, and the unit a side counts, each with its state and place", () => {
  assert.deepEqual(parts["size-dungeon-wandering"].role, "body");
  assert.equal(parts["size-dungeon-wandering"].count.dice, "2d7");
  assert.deepEqual(parts["size-dungeon-wandering"].when, { state: "wandering", place: "dungeon", units: ["pod"] });
  assert.equal(parts["size-dungeon-lair"].role, "unit");
  assert.equal(parts["size-dungeon-lair"].source.name, "cell");
  assert.equal(parts["size-dungeon-lair"].count.dice, "2d3");
  assert.deepEqual(parts["size-dungeon-lair"].when.units, ["nest"]);
  assert.ok(!("size-wilderness-wandering" in parts), "a side with no figure adds no part");
  assert.ok(Object.hasOwn(RECIPE_STATES, "lair") && Object.hasOwn(RECIPE_PLACES, "dungeon") && Object.hasOwn(RECIPE_ROUNDS, "up") && Object.hasOwn(RECIPE_BASES, "page"));
});

check("a single-figure count is a literal, and the bare lair side of a line counted in units reads as a unit", () => {
  const r = byKey(read({ encounter: { dungeon: { wandering: { noun: "pod", number: "4", unit: "" }, lair: { noun: "nest", number: "1", unit: "pod" } } } }));
  assert.equal(r["size-dungeon-wandering"].count.literal, 4);
  assert.equal(r["size-dungeon-wandering"].count.dice, "");
  assert.equal(r["size-dungeon-lair"].source.name, "pod");
});

check("the unit words a phrase names, singular, once each", () => {
  assert.deepEqual(unitsIn("lairs and villages, and a lair"), ["lair", "village"]);
  assert.deepEqual(unitsIn("no such word"), []);
});

/* ---- the grammars a sentence is printed in ---- */

check("'one' before a rank, an unspaced or welded rank word, and a rank in the plural", () => {
  const r = byKey(read({ ecology: ["Each zorb gang will be led by one champion with 3 AC.", "Each zorb warband will be led by a subchieftain with 4 AC.", "A zorb lair will be led by a sub- chieftain."], combat: [] }));
  assert.equal(r["leader-champion"].count.literal, 1);
  assert.deepEqual(r["leader-subChieftain"].when.units, ["warband", "lair"]);
});

check("a second guard clause worded 'and a N% chance it will be guarded by'", () => {
  const r = byKey(read({ combat: [], ecology: ["There is a 22% chance a zorb village will be guarded by 2d5+1 mossy blimps and a 31% chance it will be guarded by 2d9 lank vores."] }));
  assert.equal(r["guard-mossy-blimps"].chance, 22);
  assert.equal(r["guard-lank-vores"].chance, 31);
  assert.equal(r["guard-lank-vores"].count.dice, "2d9");
  assert.equal(r["guard-lank-vores"].source.name, "lank vores");
});

check("beasts joined by 'or' share one chance and one branch group, with no band invented", () => {
  const r = byKey(read({ combat: [], ecology: ["There is a 64% chance a zorb village will be guarded by 3d7 lank vores or 2d3 pale jugs."] }));
  assert.equal(r["guard-lank-vores"].chance, 64);
  assert.equal(r["guard-pale-jugs"].chance, 64);
  assert.equal(r["guard-lank-vores"].branch.group, "guard-or-1");
  assert.equal(r["guard-pale-jugs"].branch.group, "guard-or-1");
  assert.equal(r["guard-lank-vores"].branch.band, "");
  assert.equal(r["guard-pale-jugs"].source.name, "pale jugs");
});

check("a clause that gives only a figure is a literal count", () => {
  const r = byKey(read({ combat: [], ecology: ["There is a 22% chance a zorb village will be guarded by 3 mossy blimps."] }));
  assert.equal(r["guard-mossy-blimps"].count.literal, 3);
  assert.equal(r["guard-mossy-blimps"].count.dice, "");
});

check("a caster worded 'a N% chance to have a shaman present'", () => {
  const r = byKey(read({ combat: [], ecology: ["A zorb village has a 23% chance to have a shaman present and a 9% chance of a witch doctor."] }));
  assert.equal(r["caster-shaman"].chance, 23);
  assert.equal(r["caster-witchDoctor"].chance, 9);
  assert.deepEqual(r["caster-shaman"].when.units, ["village"]);
});

check("dependants worded 'each', with a rounding printed, or one figure for both words", () => {
  const each = byKey(read({ combat: [], ecology: ["Zorb lairs and villages will have drudges and whelps equal to 130% and 45% of the number of warriors each."] }));
  assert.equal(each["dependant-drudge"].count.percent, 130);
  assert.equal(each["dependant-whelp"].count.percent, 45);
  const rounded = byKey(read({ combat: [], ecology: ["Zorb lairs will have drudges and whelps equal to 80% of the number of warriors (round up)."] }));
  assert.equal(rounded["dependant-drudge"].count.percent, 80);
  assert.equal(rounded["dependant-whelp"].count.percent, 80);
  assert.equal(rounded["dependant-drudge"].count.round, "up");
  assert.deepEqual(rounded["dependant-drudge"].when.units, ["lair"]);
});

check("a split whose first clause prints no rounding, and the second a rounding", () => {
  const r = byKey(read({ ecology: [], combat: ["20% of gangs encountered will be warriors, 80% will be archers (round down)."] }));
  assert.equal(r.warriors.count.percent, 20);
  assert.equal(r.warriors.count.round, "");
  assert.equal(r.archers.count.percent, 80);
  assert.equal(r.archers.count.round, "down");
  assert.deepEqual(r.warriors.when.units, ["gang"]);
});

check("a morale penalty is stored with its printed sign", () => {
  const r = byKey(read({ combat: [], ecology: ["Each zorb gang will be led by a champion.", "As long as the champion is alive, the zorbs will suffer, and have a -3 penalty to morale rolls."] }));
  assert.equal(r["leader-champion"].moraleWhileAlive, -3);
});

check("the variant key files the Role cells, and none leaves the role alone", () => {
  assert.equal(byKey(read({ variant: "other" }))["leader-champion"].source.templateCell, "other|champion");
  assert.equal(byKey(read({ variant: "" }))["leader-champion"].source.templateCell, "champion");
});

check("a sentence the locators cannot read adds no part and does not fail", () => {
  assert.deepEqual(read({ combat: ["Zorbs are formidable and fear water.", "They sleep by day."], ecology: ["Zorb villages sit on high ground and nothing more is known of them."] }), []);
  assert.deepEqual(readEcologyRecipe({}), []);
  assert.deepEqual(readEcologyRecipe({ combat: [null, 5, undefined], ecology: [""] }), []);
  const only = read({ combat: [], ecology: [GANG, "Zorb villages are loud."] });
  assert.deepEqual(only.filter((p) => partKind(p) !== "size").map((p) => p.key), ["leader-champion"]);
});

check("the encounter lines alone make no recipe", () => {
  assert.deepEqual(read({ combat: [], ecology: [] }), []);
});

check("a morale sentence with no leader part to carry it adds nothing", () => {
  assert.deepEqual(read({ combat: [], ecology: [MORALE] }), []);
});

/* ---- mutation: change each sentence so it should not match; its part must go, the others stay ---- */

const MUTATIONS = [
  ["split", SPLIT, SPLIT.replace("will be archers", "will be asleep").replace("will be warriors", "will be asleep"), ["archers", "warriors"]],
  ["gang leader", GANG, GANG.replace("will be led by", "will be followed by"), ["leader-champion"]],
  ["lair leader", LAIR, LAIR.replace("lair or village", "den or hamlet"), ["leader-chieftain"]],
  ["dependants", DEPENDANTS, DEPENDANTS.replace("of the number of warriors", "of the number of coins"), ["dependant-drudge", "dependant-whelp"]],
  ["escort", ESCORT, ESCORT.replace("will be defended by", "will be admired by"), ["chieftain-guard"]],
  ["guard beasts", GUARD, GUARD.replace("will be guarded by", "will be admired by"), ["guard-mossy-blimps", "guard-tall-zorbles"]],
  ["captives", CAPTIVES, CAPTIVES.replace("per gang", "in a row"), ["captives"]],
  ["casters", CASTERS, CASTERS.replace(/chance of a shaman/, "chance of a sunrise").replace(/chance of a witch doctor/, "chance of a rainbow"), ["caster-shaman", "caster-witchDoctor"]],
];

for (const [name, was, now, gone] of MUTATIONS) {
  check(`mutation: ${name} no longer matches once its sentence is changed`, () => {
    assert.notEqual(was, now, "the mutation must change the sentence");
    const swap = (list) => list.map((text) => text.replace(was, now));
    const mutated = byKey(read({ combat: swap(COMBAT), ecology: swap(ECOLOGY) }));
    for (const key of gone) assert.ok(!(key in mutated), `${key} should be gone`);
    for (const key of Object.keys(parts).filter((k) => !gone.includes(k))) assert.ok(key in mutated, `${key} should stay`);
  });
}

check("mutation: with the chieftain's leader sentence gone, the morale sentence is carried by nothing", () => {
  const mutated = byKey(read({ ecology: [`${GANG} ${WARBAND} ${LAIR.replace("lair or village", "den or hamlet")} ${MORALE}`, DEPENDANTS, ECOLOGY[2]] }));
  assert.ok(!("leader-chieftain" in mutated));
  assert.ok(Object.values(mutated).every((p) => p.moraleWhileAlive == null));
});

check("mutation: morale is not read from a sentence that is not about a living chieftain", () => {
  const mutated = byKey(read({ ecology: [`${GANG} ${WARBAND} ${LAIR} ${MORALE.replace("is alive", "is asleep")}`] }));
  assert.equal(mutated["leader-chieftain"].moraleWhileAlive, null);
});

/* ---- a repair clears a recipe the page no longer yields ---- */

const heldExtras = { encounter: { lairChance: 10, recipe: recipe } };

check("attachRecipe leaves a creature with no parts as it is, and sets the list under encounter otherwise", () => {
  const extras = { encounter: { lairChance: 10 }, description: {} };
  assert.equal(attachRecipe(extras, []), extras);
  assert.deepEqual(attachRecipe(extras, recipe).encounter.lairChance, 10);
  assert.equal(attachRecipe({}, recipe).encounter.recipe, recipe);
});

check("a repair whose build reads no recipe clears the parts the import wrote and keeps a part a hand changed", () => {
  const source = { type: "monster", system: {}, flags: { [MODULE]: { extras: heldExtras } } };
  const build = (extras) => ({ type: "monster", system: {}, flags: { [MODULE]: { extras } } });
  const cleared = refreshPlan(source, build({ encounter: { lairChance: 10 } }), REPAIR.monster);
  assert.deepEqual(cleared.update.flags[MODULE].extras.encounter.recipe, [], "no list in the build, an empty one in the update");
  assert.equal(cleared.update.flags[MODULE].extras.encounter.lairChance, 10);
  const hand = { ...recipe[1], key: "_qa1", origin: "" };
  const kept = refreshPlan({ ...source, flags: { [MODULE]: { extras: { encounter: { recipe: [...recipe, hand] } } } } }, build({ encounter: { lairChance: 10 } }), REPAIR.monster);
  assert.deepEqual(kept.update.flags[MODULE].extras.encounter.recipe, [hand]);
  const bare = refreshPlan({ ...source, flags: { [MODULE]: { extras: { encounter: {} } } } }, build({ encounter: { lairChance: 10 } }), REPAIR.monster);
  assert.equal(bare.update.flags[MODULE].extras.encounter.recipe, undefined, "a document holding none gets no list written");
});

/* ---- origin, the sentence report, the guard keys and the read copy ---- */

check("every part the reader writes carries the register origin", () => {
  assert.ok(recipe.length > 0 && recipe.every((p) => p.origin === "register"));
});

check("the guard parts are keyed by the creature word as read, in whatever order the clauses come", () => {
  const A = "There is a 41% chance a zorb village will be guarded by 2d12 mossy blimps.";
  const B = "There is a 17% chance a zorb village will be guarded by 1d5+2 tall zorbles.";
  const one = readEcologyRecipe({ combat: [], ecology: [`${A} ${B}`] }).filter((p) => p.role === "guard");
  const two = readEcologyRecipe({ combat: [], ecology: [`${B} ${A}`] }).filter((p) => p.role === "guard");
  assert.deepEqual(one.map((p) => p.key).sort(), ["guard-mossy-blimps", "guard-tall-zorbles"]);
  assert.deepEqual(two.map((p) => p.key).sort(), ["guard-mossy-blimps", "guard-tall-zorbles"]);
  const byWord = (list) => Object.fromEntries(list.map((p) => [p.source.name, p.key]));
  assert.deepEqual(byWord(one), byWord(two), "a creature word keeps its key across the two reads");
  assert.ok(!one.some((p) => p.key.startsWith("_")), "no key is the shape of a Judge's own row");
});

check("a creature word named twice keeps both parts, the second under a numbered suffix", () => {
  const r = readEcologyRecipe({ combat: [], ecology: ["There is a 22% chance a zorb village will be guarded by 2d5 mossy blimps and a 31% chance it will be guarded by 1d3 mossy blimps."] }).filter((p) => p.role === "guard");
  assert.deepEqual(r.map((p) => [p.key, p.chance]), [["guard-mossy-blimps", 22], ["guard-mossy-blimps-2", 31]]);
});

check("the sentence report names, for each part, the field, paragraph and sentence that stated it", () => {
  const { parts, sentences } = readEcologyRecipeWithSentences({ combat: [SPLIT], ecology: ECOLOGY, encounter: ENCOUNTER, variant: "zorb", cite: "XX p.1" });
  assert.deepEqual(parts, recipe, "the parts are the ones readEcologyRecipe returns");
  assert.deepEqual(sentences.archers, [{ field: "combat", paragraph: 0, sentence: 0 }]);
  assert.deepEqual(sentences["guard-mossy-blimps"], [{ field: "ecology", paragraph: 2, sentence: 2 }]);
  assert.deepEqual(sentences["dependant-drudge"], [{ field: "ecology", paragraph: 1, sentence: 0 }]);
  assert.equal(sentences["size-dungeon-lair"], undefined, "a part the encounter lines made names no sentence");
  assert.deepEqual(sentences["leader-chieftain"], [{ field: "ecology", paragraph: 0, sentence: 2 }, { field: "ecology", paragraph: 0, sentence: 3 }],
    "the sentence that made it, then the one that gave it its morale bonus");
});

check("a leader gaining a unit from a later sentence reports that sentence too", () => {
  const { sentences } = readEcologyRecipeWithSentences({ combat: [], ecology: ["Each zorb gang will be led by one champion. Each zorb warband will be led by one champion."] });
  assert.deepEqual(sentences["leader-champion"], [{ field: "ecology", paragraph: 0, sentence: 0 }, { field: "ecology", paragraph: 0, sentence: 1 }]);
});

check("no prose, no sentences", () => {
  assert.deepEqual(readEcologyRecipeWithSentences({ combat: ["Nothing here is read."], ecology: [] }), { parts: [], sentences: {} });
});

check("the read copy is the recipe whole, kept apart from the parts, and an empty copy is written only on request", () => {
  const stamp = recipeReadStamp(recipe);
  assert.deepEqual(stamp, { read: { recipe } });
  assert.notEqual(stamp.read.recipe, recipe, "a copy, so a later edit of the parts leaves it as read");
  assert.notEqual(stamp.read.recipe[0], recipe[0]);
  assert.deepEqual(recipeReadStamp([]), {});
  assert.deepEqual(recipeReadStamp([], { replace: true }), { read: { recipe: [] } });
});

/* ---- the key the Role cells are filed under, on every path ---- */

check("a member's variant is found in the cookbooks it is declared in, and an entry in no family has none", () => {
  const books = [{ families: { "x.famA": { members: [{ id: "x.a1", variant: "Alpha" }, { id: "x.a2", variant: "Beta Two" }] } } }, {}];
  assert.equal(memberVariant("x.a2", books), "Beta Two");
  assert.equal(memberVariant("x.zzz", books), null);
  assert.equal(memberVariant("x.a1", undefined), null);
});

/* ---- the data model declares every field a part stores ---- */

{
  // The data model is built against a stand-in for Foundry's field classes: each keeps its constructor arguments, so the declared shape can be read back.
  class Field {
    constructor(options, extra) {
      this.options = options;
      this.extra = extra;
    }
  }
  class SchemaField extends Field {}
  class ArrayField extends Field {}
  globalThis.foundry = {
    abstract: { DataModel: class {} },
    data: { fields: new Proxy({ SchemaField, ArrayField }, { get: (t, k) => t[k] ?? (t[k] = class extends Field {}) }) },
    utils: new Proxy({}, { get: () => () => ({}) }),
  };
  const { default: MonsterExtras } = await import("../../scripts/monsters/monster-extras.mjs");
  const schema = MonsterExtras.defineSchema();
  delete globalThis.foundry;
  const recipeField = schema.encounter.options.recipe;
  assert.ok(recipeField instanceof ArrayField, "the recipe is a list");
  assert.ok(recipeField.options instanceof SchemaField, "of parts");
  const f = recipeField.options.options;
  const sample = recipe.find((p) => p.key === "size-dungeon-lair");
  assert.deepEqual(Object.keys(f), FIELDS);
  for (const field of ["source", "count", "when", "branch"]) {
    assert.deepEqual(Object.keys(f[field].options), Object.keys(sample[field]), field);
  }
  assert.ok(f.when.options.units instanceof ArrayField, "the units are a list of words");
  assert.deepEqual(Object.keys(f.role.options.choices), Object.keys(RECIPE_ROLES));
  assert.deepEqual(Object.keys(f.role.options.choices).slice(-2), ["mount", "beast"], "a mount and a beast are roles a part may take");
  assert.deepEqual(f.role.options.choices.mount, "Mount");
  assert.ok(Object.values(f.role.options.choices).every((label) => typeof label === "string" && label), "every role carries a label");
  assert.ok(f.origin.options && "origin" in f, "a part declares its origin");
  assert.deepEqual(Object.keys(f.basis.options.choices), Object.keys(RECIPE_BASES));
  assert.deepEqual(Object.keys(f.count.options.round.options.choices), Object.keys(RECIPE_ROUNDS));
  assert.deepEqual(Object.keys(f.when.options.state.options.choices), Object.keys(RECIPE_STATES));
  assert.deepEqual(Object.keys(f.when.options.place.options.choices), Object.keys(RECIPE_PLACES));
  for (const p of recipe) {
    assert.ok(p.role in RECIPE_ROLES && p.basis in RECIPE_BASES, p.key);
    assert.ok(p.count.round === "" || p.count.round in RECIPE_ROUNDS, p.key);
    assert.ok(p.when.state === "" || p.when.state in RECIPE_STATES, p.key);
    assert.ok(p.when.place === "" || p.when.place in RECIPE_PLACES, p.key);
  }
  passed++;
}

console.log(`ecology recipe: ${passed} checks passed`);
