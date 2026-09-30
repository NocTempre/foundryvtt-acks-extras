/**
 * The demand layers and the Demand Generator's pure rules: the one reader's
 * precedence, the Step 7 A-D arithmetic (including the truncating drop of the
 * fraction), the half-point parser, the land-revenue window reader, the random
 * good draw, the schema's new fields, and the demand engine's GM-only writer.
 *
 * Every figure below is invented: the tests prove the rules read the numbers
 * they are handed and that the shape of the procedure holds, never that the
 * book says anything in particular.
 *
 * Run: npm test
 */
import assert from "node:assert";
import fs from "node:fs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const same = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  pass++;
};

const rules = await import(new URL("../scripts/markets/rules/demand.mjs", import.meta.url));
const { parseHalfPoint, trueDemand, demandSource, baseDemand, landRevenueCounts, goodAtRoll, drawLandPicks, racesOf, hasRandomBands, hasEnvironment } = rules;

/* ------------------------- the half-point parser ------------------------- */

same("a signed half", parseHalfPoint("+1/2"), 0.5);
same("a negative mixed number", parseHalfPoint("-1 1/2"), -1.5);
same("a bare zero", parseHalfPoint("0"), 0);
same("a signed whole number", parseHalfPoint("+3"), 3);
same("a decimal", parseHalfPoint("2.5"), 2.5);
same("the vulgar half", parseHalfPoint("½"), 0.5);
same("a negative vulgar half", parseHalfPoint("-½"), -0.5);
same("a typographic minus", parseHalfPoint("−2"), -2);
same("a number passes through", parseHalfPoint(-4), -4);
same("blank is unread, not zero", parseHalfPoint(""), null);
same("null is unread", parseHalfPoint(null), null);
same("prose is unreadable", parseHalfPoint("none"), null);
same("a zero denominator is unreadable", parseHalfPoint("1/0"), null);
check("a negative zero is normalised", Object.is(parseHalfPoint("-0"), 0));

/* ------------------------- the one reader ------------------------- */

const goods = {
  demand: [{ category: "aa", modifier: 2 }, { category: "bb", modifier: -1 }],
  demandDerived: [{ category: "bb", modifier: 4 }, { category: "cc", modifier: 5 }],
  demandOverrides: [{ category: "cc", modifier: -3 }],
};
same("the base answers when nothing outranks it", trueDemand(goods, "aa"), 2);
same("a derived row outranks the base", trueDemand(goods, "bb"), 4);
same("an override outranks a derived row", trueDemand(goods, "cc"), -3);
same("a category no layer holds is zero", trueDemand(goods, "zz"), 0);
same("no category is zero", trueDemand(goods, null), 0);
same("a market with no layers reads zero", trueDemand({}, "aa"), 0);
same("an override of zero still wins", trueDemand({ demand: [{ category: "aa", modifier: 3 }], demandOverrides: [{ category: "aa", modifier: 0 }] }, "aa"), 0);
same("the source names the winning layer", ["aa", "bb", "cc", "zz"].map((c) => demandSource(goods, c)), ["base", "derived", "override", null]);

/* ------------------------- Step 7 A-D ------------------------- */

const env = { age1: 1, age2: 1.5, seaCoast: 2, lakeShore: null, riverBank: 4, forest: 8, desert: 16, hills: 32, mountains: 64 };
const wide = baseDemand({ environment: env, ageBand: 1, water: ["seaCoast", "riverBank"], biome: ["forest"], elevation: "hills", a: 0 });
same("every applicable column is summed and the rest ignored", [wide.b, wide.base], [47, 47]);
same("no age band applies no age column", baseDemand({ environment: env, water: ["seaCoast"], a: 0 }).b, 2);
same("a column with no printed value adds nothing", baseDemand({ environment: env, water: ["lakeShore", "seaCoast"], a: 0 }).b, 2);
same("several biomes add", baseDemand({ environment: env, biome: ["forest", "desert"], a: 0 }).b, 24);

const positive = baseDemand({ environment: env, ageBand: 2, a: 1 });
same("a positive fraction is dropped", [positive.b, positive.afterB, positive.base], [1.5, 2, 2]);
// -4 + 1.5 = -2.5: truncation toward zero gives -2, where a floor would give -3.
const negative = baseDemand({ environment: env, ageBand: 2, a: -4 });
same("a negative total with a half drops toward zero", [negative.b, negative.afterB], [1.5, -2]);
check("the floor would have differed", Math.floor(-2.5) === -3 && negative.afterB === -2);
const half = baseDemand({ environment: { age1: -1.5 }, ageBand: 1, a: -2 });
same("-3 1/2 becomes -3", [half.a, half.b, half.afterB, half.base], [-2, -1.5, -3, -3]);
check("the floor would have differed", Math.floor(-3.5) === -4 && half.afterB === -3);
check("a total that truncates to zero is a plain zero", Object.is(baseDemand({ environment: { age1: -0.5 }, ageBand: 1, a: 0 }).afterB, 0));

const late = baseDemand({ environment: { age1: 0.5 }, ageBand: 1, a: 0, landDelta: 1 });
same("the fraction is dropped before the land pick, not after", [late.afterB, late.c, late.base], [0, 1, 1]);

const racial = { alpha: 2, beta: -1, gamma: 5, delta: 0.5 };
const raced = baseDemand({ environment: { age1: 1 }, ageBand: 1, racial, races: ["alpha", "beta"], a: 3, landDelta: -2 });
same("A, B, C and D combine in order", [raced.a, raced.b, raced.afterB, raced.c, raced.d, raced.base], [3, 1, 4, -2, 1, 3]);
same("a race the good does not name adds nothing", baseDemand({ racial, races: ["nobody"], a: 0 }).d, 0);
same("racial text is parsed", baseDemand({ racial: { alpha: "+1/2", beta: "-1 1/2" }, races: ["alpha", "beta"], a: 0 }).d, -1);

const bare = baseDemand({ environment: null, ageBand: 3, a: 2, landDelta: 1, racial, races: ["gamma"] });
same("a good with no environment data has no B and still takes A, C and D", [bare.b, bare.afterB, bare.base], [null, 2, 8]);
same("an all-null environment is no environment data", baseDemand({ environment: { age1: null, seaCoast: null }, ageBand: 1, a: 1 }).b, null);
check("hasEnvironment tells data from none", hasEnvironment({ age1: null, hills: 0 }) && !hasEnvironment({ age1: null }) && !hasEnvironment(null));

/* ------------------------- the land-revenue window ------------------------- */

// A lowercased stream, small caps splitting the words; the rows are invented.
const WINDOW =
  "domain land revenue demand modifiers 1gp +2 d emand m odifier to 3 m erchandise types, -2 d emand m odifier to 1 m erchandise type " +
  "2gp -3 d emand m odifier to 4 m erchandise types, +1 d emand m odifier to 1 m erchandise type " +
  "3gp +1 d emand m odifier to 1 m erchandise type, -1 d emand m odifier to 1 m erchandise type +9 d emand m odifier to 9 m erchandise types";
same("the row's figure finds its counts", landRevenueCounts(WINDOW, 1), { plus: 3, minus: 1, plusDelta: 2, minusDelta: -2 });
same("a row may print the lowering clause first", landRevenueCounts(WINDOW, 2), { plus: 1, minus: 4, plusDelta: 1, minusDelta: -3 });
same("clauses after the row's two are the page's, not the row's", landRevenueCounts(WINDOW, 3), { plus: 1, minus: 1, plusDelta: 1, minusDelta: -1 });
same("an absent figure is null", landRevenueCounts(WINDOW, 7), null);
same("an empty window is null", landRevenueCounts("", 1), null);
same("a non-number revenue is null", landRevenueCounts(WINDOW, "many"), null);
same("a row with no readable clause is null", landRevenueCounts("4gp nothing here 5gp +1 d emand m odifier to 2 m erchandise types", 4), null);
same("capitals read the same", landRevenueCounts(WINDOW.toUpperCase(), 1)?.plus, 3);
same("a typographic minus reads as one", landRevenueCounts("6gp +1 d emand m odifier to 2 m erchandise types, −1 d emand m odifier to 1 m erchandise type", 6), { plus: 2, minus: 1, plusDelta: 1, minusDelta: -1 });

/* ------------------------- the random good draw ------------------------- */

const catalog = [
  { key: "g1", random: { table: "common", min: 1, max: 40 } },
  { key: "g2", random: { table: "common", min: 41, max: 90 } },
  { key: "p1", random: { table: "precious", min: 1, max: 60 } },
  { key: "p2", random: { table: "precious", min: 61, max: 90 } },
  { key: "sp", random: { table: "precious", min: null, max: null, special: true } },
  { key: "none", random: { table: null, min: null, max: null } },
];
same("a roll inside a band names its good", [goodAtRoll(catalog, "common", 1), goodAtRoll(catalog, "common", 40), goodAtRoll(catalog, "common", 41)], ["g1", "g1", "g2"]);
same("a roll in no common band names nothing there", goodAtRoll(catalog, "common", 95), null);
same("the table is part of the match", goodAtRoll(catalog, "precious", 10), "p1");
same("a special row has no band to land in", goodAtRoll(catalog, "precious", 99), null);
check("bands are detected", hasRandomBands(catalog) && !hasRandomBands([{ key: "x", random: { table: "", min: null, max: null } }]) && !hasRandomBands([]));

const script = (values) => {
  const queue = [...values];
  return async () => {
    if (!queue.length) throw new Error("the script ran out of rolls");
    return queue.shift();
  };
};
const counts = { plus: 2, minus: 1, plusDelta: 1, minusDelta: -1 };
// 10 -> g1; 95 misses the common bands so the next roll (70) is read on the precious table -> p2; 50 -> g2.
const drawn = await drawLandPicks(catalog, counts, script([10, 95, 70, 50]));
same("a miss on the common table is re-rolled on the precious table", drawn.picks, [
  { category: "g1", delta: 1 },
  { category: "p2", delta: 1 },
  { category: "g2", delta: -1 },
]);
same("a full draw is not short", drawn.short, 0);
// 10 -> g1, then 10 again (already taken) is redrawn: 45 -> g2, then 95/95 misses both tables, then 5 -> g1 taken, 65 -> g2 taken.
const redrawn = await drawLandPicks(catalog, { plus: 2, minus: 0, plusDelta: 1, minusDelta: 0 }, script([10, 10, 45]));
same("a good already picked is drawn again", redrawn.picks.map((p) => p.category), ["g1", "g2"]);
const tiny = await drawLandPicks([{ key: "only", random: { table: "common", min: 1, max: 100 } }], { plus: 2, minus: 1, plusDelta: 1, minusDelta: -1 }, async () => 50, { attempts: 12 });
same("too few distinct goods leaves a reported shortfall", [tiny.picks.length, tiny.short], [1, 2]);
const barred = await drawLandPicks(catalog, { plus: 1, minus: 0, plusDelta: 1, minusDelta: 0 }, script([10, 45]), { exclude: ["g1"] });
same("an excluded good is never drawn", barred.picks.map((p) => p.category), ["g2"]);
same("races are read off the catalogue, sorted and unique", racesOf([{ racial: { zed: 1, ant: 2 } }, { racial: { ant: 3 } }, {}]), ["ant", "zed"]);

/* ------------------------- the schema ------------------------- */

{
  class Field {
    constructor(options) {
      this.options = options ?? {};
    }
  }
  class SchemaField extends Field {
    constructor(fields, options) {
      super(options);
      this.fields = fields;
    }
  }
  class ArrayField extends Field {
    constructor(element, options) {
      super(options);
      this.element = element;
    }
  }
  globalThis.foundry = {
    data: { fields: { StringField: Field, NumberField: Field, BooleanField: Field, SchemaField, ArrayField } },
  };
  const { goodsSchema } = await import(new URL("../scripts/markets/data/goods-schema.mjs", import.meta.url));
  const { fields } = goodsSchema();
  for (const layer of ["demand", "demandOverrides", "demandDerived"]) {
    check(`${layer} is a modifier per category`, fields[layer] instanceof ArrayField && ["category", "modifier"].every((k) => k in fields[layer].element.fields));
  }
  check("the reserved derived fields exist", ["demandDerivedTime", "demandInputsKey"].every((k) => k in fields));
  const profile = fields.dmProfile.fields;
  check("the profile keeps the generator's inputs", ["ageBand", "water", "biome", "elevation", "landRevenueGp", "races", "rolls", "landPicks", "source", "time"].every((k) => k in profile));
  check("the stored rolls and picks are per category", "a" in profile.rolls.element.fields && "delta" in profile.landPicks.element.fields);
  check("an unset profile source is null", profile.source.options.nullable === true && profile.source.options.initial === null);
  check("water and biome take only their columns", profile.water.element.options.choices.length === 3 && profile.biome.element.options.choices.length === 9);
  delete globalThis.foundry;
}

/* ------------------------- the demand engine ------------------------- */

const { writeDemand, applyGenerated } = await import(new URL("../scripts/markets/engine/demand.mjs", import.meta.url));

/** A market location holding `goods`; `update` applies dotted paths to it like a document would. */
function market(seed) {
  const goodsData = structuredClone({ demand: [], demandOverrides: [], demandDerived: [], dmProfile: { source: { book: "bk", page: "9" } }, ...seed });
  const location = {
    system: { market: { goods: goodsData } },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".").slice(3);
        let node = goodsData;
        for (const part of parts.slice(0, -1)) node = node[part];
        node[parts.at(-1)] = value;
      }
    },
  };
  return location;
}

globalThis.game = { user: { isGM: false }, time: { worldTime: 1234.9 } };

const refused = market({});
same("a player's write is refused", await writeDemand(refused, { layer: "base", category: "aa", modifier: 2 }), { error: "gmOnly" });
same("a player's generated write is refused", await applyGenerated(refused, { profile: {}, results: [{ category: "aa", base: 1 }] }), { error: "gmOnly" });
check("a refused write touches nothing", refused.updates.length === 0);

globalThis.game.user.isGM = true;

// A book-supplied base is marked by `dmProfile.source`; a book import refreshes
// only a base still carrying its own mark, so a hand write must clear it.
const sourced = market({ demand: [{ category: "aa", modifier: 1 }] });
const mark = { book: "bk", page: "9" };
await writeDemand(sourced, { layer: "override", category: "aa", modifier: 4 });
same("a pin leaves the base's book source alone", sourced.system.market.goods.dmProfile.source, mark);
await writeDemand(sourced, { layer: "override", category: "aa", modifier: null });
same("unpinning leaves the base's book source alone", sourced.system.market.goods.dmProfile.source, mark);
await writeDemand(sourced, { layer: "base", category: "aa", modifier: 2 });
same("a hand write to the base clears its book source", sourced.system.market.goods.dmProfile.source, null);
const resourced = market({ demand: [{ category: "aa", modifier: 1 }] });
await writeDemand(resourced, { layer: "base", category: "aa", modifier: null });
same("deleting a base row clears its book source", resourced.system.market.goods.dmProfile.source, null);
const untouched = market({});
await writeDemand(untouched, { layer: "base", category: "nope", modifier: null });
same("a delete that finds no row writes nothing", untouched.updates.length, 0);

const loc = market({ demand: [{ category: "aa", modifier: 1 }], demandOverrides: [{ category: "aa", modifier: 7 }] });
same("a base write adds a row", await writeDemand(loc, { layer: "base", category: "bb", modifier: -2 }), { ok: true });
same("the base layer holds both rows", loc.system.market.goods.demand, [{ category: "aa", modifier: 1 }, { category: "bb", modifier: -2 }]);
check("the base write left the pins alone", loc.system.market.goods.demandOverrides.length === 1 && loc.system.market.goods.demandOverrides[0].modifier === 7);
await writeDemand(loc, { layer: "base", category: "aa", modifier: 5 });
same("a base write replaces a row's value", loc.system.market.goods.demand[0], { category: "aa", modifier: 5 });
await writeDemand(loc, { layer: "override", category: "bb", modifier: 3 });
same("an override write lands in the override layer", loc.system.market.goods.demandOverrides.map((r) => [r.category, r.modifier]), [["aa", 7], ["bb", 3]]);
same("the pin outranks the base for the reader", trueDemand(loc.system.market.goods, "bb"), 3);
await writeDemand(loc, { layer: "override", category: "bb", modifier: null });
same("clearing a pin removes only that layer's row", [loc.system.market.goods.demandOverrides.length, trueDemand(loc.system.market.goods, "bb")], [1, -2]);
same("clearing a row that is not there is a no-op", await writeDemand(loc, { layer: "base", category: "nope", modifier: null }), { ok: true });
same("the derived layer has no hand writer", await writeDemand(loc, { layer: "derived", category: "aa", modifier: 1 }), { error: "badLayer" });
same("a write needs a category", await writeDemand(loc, { layer: "base", category: "", modifier: 1 }), { error: "noCategory" });
await writeDemand(loc, { layer: "base", category: "cc", modifier: 2.9 });
same("a fractional modifier is truncated", loc.system.market.goods.demand.at(-1), { category: "cc", modifier: 2 });

const gen = market({ demand: [{ category: "old", modifier: 9 }], demandOverrides: [{ category: "aa", modifier: 7 }] });
const applied = await applyGenerated(gen, {
  profile: { ageBand: 2, water: ["seaCoast"], biome: ["forest"], elevation: "hills", landRevenueGp: 5, races: ["alpha"], rolls: [{ category: "aa", a: -1 }], landPicks: [{ category: "aa", delta: 1 }] },
  results: [{ category: "aa", base: 2 }, { category: "bb", base: -1 }],
});
same("the generated base is written", [applied.ok, applied.written], [true, 2]);
same("the base layer is replaced whole", gen.system.market.goods.demand, [{ category: "aa", modifier: 2 }, { category: "bb", modifier: -1 }]);
same("the overrides are never touched", gen.system.market.goods.demandOverrides, [{ category: "aa", modifier: 7 }]);
const stored = gen.system.market.goods.dmProfile;
same("the profile and its rolls are stored", [stored.ageBand, stored.water, stored.elevation, stored.rolls, stored.landPicks], [2, ["seaCoast"], "hills", [{ category: "aa", a: -1 }], [{ category: "aa", delta: 1 }]]);
same("a generated base is no longer a book's", stored.source, null);
same("the write is stamped with the world time", stored.time, 1234);
same("an empty result is refused", await applyGenerated(gen, { profile: {}, results: [] }), { error: "noResults" });
delete globalThis.game;

/* ------------------------- one reader ------------------------- */

// No markets code reads a demand layer by hand: every read goes through `trueDemand`.
const dir = new URL("../scripts/markets/", import.meta.url);
const walk = (url) =>
  fs.readdirSync(url, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, url)) : e.name.endsWith(".mjs") ? [new URL(e.name, url)] : []));
const strays = walk(dir).filter((f) => /\.demand(Overrides|Derived)?\??\.(find|filter|some|map)\b/.test(fs.readFileSync(f, "utf8")));
same("no markets file reads a demand layer directly", strays.map((f) => f.pathname.split("/").pop()), []);

console.log(`test-trade: OK (${pass} checks)`);
