/**
 * The `quantity` reading of a prose value: a figure with its floor and its
 * rate, in the one shape `lib/tables.mjs` `quantity` reads back.
 *
 * Every sentence below is INVENTED — no page is reproduced. What this pins is
 * the reading: a sign carried, a "+" after the figure read as a floor and one
 * before another figure read as arithmetic, "or more" read as a floor, and a
 * "per" always yielding a unit, so a rate is never counted once.
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { quantity, scaleQuantity } from "../../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

/** One line per item, stacked down a single column. */
const page = (lines) => lines.map((str, i) => ({ x: 100, y: 100 + i * 12, str }));
const read = (lines, values) => extractTable(page(lines), { shape: "proseValues", column: { xMin: 20, xMax: 600 }, values });

const got = read(
  [
    "The raider gains +2 per banner, and more besides.",
    "A hold of 4+ towers is counted a fortress.",
    "If 7 or more packs gather, the valley empties.",
    "A lame mule suffers -3 to every march.",
    "The ferryman rolls 2 + 1 dice for the crossing.",
    "A guide asks 5 silver per long winding day of travel.",
  ],
  [
    { key: "banner", find: "gains", take: "quantity" },
    { key: "towers", find: "a hold of", take: "quantity" },
    { key: "packs", find: "if", take: "quantity" },
    { key: "lame", find: "suffers", take: "quantity" },
    { key: "ferry", find: "rolls", take: "quantity" },
    { key: "guide", find: "asks", take: "quantity" },
  ],
);

check("a rate carries its figure and its unit", got.banner?.value === 2 && got.banner.per === "banner" && !got.banner.atLeast);
check("a trailing + is a floor", got.towers?.value === 4 && got.towers.atLeast === true && !got.towers.per);
check("or more is a floor", got.packs?.value === 7 && got.packs.atLeast === true);
check("a minus sign is carried", got.lame?.value === -3 && !got.lame.atLeast && !got.lame.per);
check("a + before another figure is arithmetic, not a floor", got.ferry?.value === 2 && !got.ferry.atLeast);
check("a long unit is cut at three words, never dropped", got.guide?.value === 5 && got.guide.per === "long winding day");

// What the extractor writes is what the lib reads back.
check("the lib reads the stored shape back", quantity(got.towers)?.atLeast === true && quantity(got.lame)?.value === -3);
check("a rate scales by its count", scaleQuantity(got.banner, 3) === 6 && scaleQuantity(got.lame, 3) === -3);

const none = read(["Nothing here is counted."], [{ key: "x", find: "nothing", take: "quantity" }]);
check("a window with no figure yields no value", !("x" in none));

console.log(`test-prose-values: ${pass} checks passed.`);
