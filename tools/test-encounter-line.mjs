/**
 * An encounter line read into `{noun, number, unit}` (scripts/lib/encounter-line.mjs)
 * and what each importer and reader makes of it.
 *
 * Every line below is invented: the nouns and the counts are shaped like a stat
 * block's, and no book's are reproduced. The coverage of real lines is a local
 * census over the reference, and that the formulas roll is the live recipe's.
 */
import assert from "node:assert/strict";
import {
  parseEncounterLine,
  appearingFormula,
  countText,
  appearingChanges,
} from "../scripts/lib/encounter-line.mjs";
import { sizeFromEcology } from "../scripts/lib/group-logic.mjs";
import { mapPairs } from "../scripts/importer/stats-map.mjs";
import { buildExtras } from "../scripts/importer/cookbook.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const side = (noun, number, unit = "") => ({ noun, number, unit });
const blank = side("", "");

ok("two sides, each with its noun and its die", () => {
  assert.deepEqual(parseEncounterLine("Knot (3d5) / Roost (2d7+1)"), {
    wandering: side("Knot", "3d5"),
    lair: side("Roost", "2d7+1"),
  });
});

ok("a literal count is a count, on either side", () => {
  assert.deepEqual(parseEncounterLine("Knot (3) / Roost (1d7)"), {
    wandering: side("Knot", "3"),
    lair: side("Roost", "1d7"),
  });
  assert.equal(parseEncounterLine("Knot (2d7) / Roost (5)").lair.number, "5");
});

ok("a multiplied die keeps its multiplier as a formula", () => {
  assert.equal(parseEncounterLine("Knot (1d7×20)").wandering.number, "1d7*20");
  assert.equal(parseEncounterLine("Knot (1d7 x 20)").wandering.number, "1d7*20");
});

ok("a sum under a multiplier stays grouped", () => {
  assert.equal(parseEncounterLine("Knot (1d7+2×20)").wandering.number, "(1d7+2)*20");
});

ok("a count of units keeps its unit apart from its number", () => {
  assert.deepEqual(parseEncounterLine("Muster (2d7 knots) / Roost (1 muster)"), {
    wandering: side("Muster", "2d7", "knots"),
    lair: side("Roost", "1", "muster"),
  });
  assert.deepEqual(parseEncounterLine("Muster (1d7×20 work-knots)").wandering, side("Muster", "1d7*20", "work-knots"));
  assert.deepEqual(parseEncounterLine("Muster (2d7+1 knots)").wandering, side("Muster", "2d7+1", "knots"));
});

ok("welded seams read like spaced ones", () => {
  assert.deepEqual(parseEncounterLine("Muster(2d7knots)/Roost(1muster)"), {
    wandering: side("Muster", "2d7", "knots"),
    lair: side("Roost", "1", "muster"),
  });
  assert.deepEqual(parseEncounterLine("Muster (1d7×20knots)").wandering, side("Muster", "1d7*20", "knots"));
});

ok("a word starting like a die or a multiplier is a unit", () => {
  assert.deepEqual(parseEncounterLine("Muster (1dozens)").wandering, side("Muster", "1", "dozens"));
  assert.deepEqual(parseEncounterLine("Muster (2d7 xebecs)").wandering, side("Muster", "2d7", "xebecs"));
});

ok("a line of one side has no lair", () => {
  assert.deepEqual(parseEncounterLine("Knot (3d5)"), { wandering: side("Knot", "3d5"), lair: blank });
});

ok("none and a blank line are nothing", () => {
  for (const value of ["", null, undefined, "none", "None", "None (see text)"]) {
    assert.equal(parseEncounterLine(value), null);
  }
});

ok("a side of none is an empty side", () => {
  assert.deepEqual(parseEncounterLine("Knot (3d5) / none").lair, blank);
});

ok("a count others stand beside is this creature's own", () => {
  assert.deepEqual(parseEncounterLine("Knot (2d7 plus 1d5 thralls)").wandering, side("Knot", "2d7"));
  assert.deepEqual(parseEncounterLine("Knot (5 + 1 Warden)").wandering, side("Knot", "5"));
});

ok("a spaced sum with nothing after it is still a sum", () => {
  assert.equal(parseEncounterLine("Knot (2d7 + 1)").wandering.number, "2d7+1");
});

ok("text that reads as no count keeps the noun and states no number", () => {
  assert.deepEqual(parseEncounterLine("Roost (by hull type)").wandering, side("Roost", ""));
  assert.deepEqual(parseEncounterLine("Roost (3 or 4 knots)").wandering, side("Roost", ""));
  assert.deepEqual(parseEncounterLine("varies by moon").wandering, side("varies by moon", ""));
});

ok("a count with no parentheses is a count with no noun", () => {
  assert.deepEqual(parseEncounterLine("1 skein / 1 ribbon"), {
    wandering: side("", "1", "skein"),
    lair: side("", "1", "ribbon"),
  });
});

ok("the appearing formula is the first stated count, in bodies only", () => {
  assert.equal(appearingFormula(parseEncounterLine("Knot (3d5) / Roost (9)")), "3d5");
  assert.equal(appearingFormula(parseEncounterLine("Roost (by hull type) / Lair (2d7)")), "2d7");
  assert.equal(appearingFormula(parseEncounterLine("Knot (2d7 knots)")), "");
  assert.equal(appearingFormula(parseEncounterLine("Knot (2d7 knots) / Roost (9)")), "", "units never fall to the lair");
  assert.equal(appearingFormula(parseEncounterLine("Knot (3d5) / Roost (1 muster)")), "3d5");
  assert.equal(appearingFormula(null), "");
});

ok("a count reads with its unit", () => {
  assert.equal(countText(side("Muster", "2d7", "knots")), "2d7 knots");
  assert.equal(countText(side("Knot", "3d5")), "3d5");
  assert.equal(countText(blank), "");
  assert.equal(countText(undefined), "");
});

ok("an edit reaches core's field only where its formula moved", () => {
  const was = { dungeon: { wandering: side("Knot", "3d5") }, wilderness: { wandering: side("Knot", "2d7") } };
  assert.deepEqual(appearingChanges(was, was), {});
  assert.deepEqual(
    appearingChanges(was, { ...was, wilderness: { wandering: side("Knot", "4d7") } }),
    { w: "4d7" },
  );
});

ok("a count turned to units blanks core's field, and a monster with no lines leaves it", () => {
  const was = { wilderness: { wandering: side("Knot", "2d7") } };
  assert.deepEqual(appearingChanges(was, { wilderness: { wandering: side("Knot", "2d7", "knots") } }), { w: "" });
  assert.deepEqual(appearingChanges({}, {}), {});
  assert.deepEqual(appearingChanges(undefined, undefined), {});
});

ok("the group never sizes a stack from a count of units", () => {
  const source = (encounter, appearing) => ({
    getFlag: (m, k) => (m === "acks-extras" && k === "extras" ? { encounter } : undefined),
    system: { details: { appearing } },
  });
  const units = { wilderness: parseEncounterLine("Muster (2d7 knots)") };
  assert.equal(sizeFromEcology(source(units, { w: "" })), null);
  const bodies = { wilderness: parseEncounterLine("Knot (1d7×20)") };
  assert.equal(sizeFromEcology(source(bodies, { w: "" })), "1d7*20");
});

const pairs = (d, w) => [{ label: "Dungeon Enc", value: d }, { label: "Wilderness Enc", value: w }];

ok("the page importer stores a body formula and the sides beside it", () => {
  const { system, extras } = mapPairs(pairs("Knot (3) / Roost (1 muster)", "Muster (2d7 knots) / Roost (1d7×20)"));
  assert.deepEqual(system.details.appearing, { d: "3", w: "" });
  assert.deepEqual(extras.encounter.dungeon.lair, side("Roost", "1", "muster"));
  assert.deepEqual(extras.encounter.wilderness.wandering, side("Muster", "2d7", "knots"));
  assert.deepEqual(extras.encounter.wilderness.lair, side("Roost", "1d7*20"));
});

ok("the cookbook importer stores the same sides", () => {
  const extras = buildExtras({
    fields: { stats: { dungeonEnc: "Knot (3) / Roost (1 muster)", wildernessEnc: "none", lairChance: 40 } },
  });
  assert.deepEqual(extras.encounter.dungeon.wandering, side("Knot", "3"));
  assert.equal(extras.encounter.wilderness, undefined);
  assert.equal(extras.encounter.lairChance, 40);
});

ok("a lair chance a book prints as a percent arrives a number", () => {
  const chance = (lairChance) => buildExtras({ fields: { stats: { lairChance } } }).encounter?.lairChance;
  assert.equal(chance("35%"), 35);
  assert.equal(chance(0), 0);
  assert.equal(chance("None"), undefined);
  assert.equal(chance("N/A"), undefined);
  assert.equal(chance(""), undefined);
});

console.log(`\n${passed} encounter-line checks passed`);
