/**
 * The `quantity` reading of a prose value: a figure with its floor and its
 * rate, in the one shape `lib/tables.mjs` `quantity` reads back.
 *
 * Every sentence below is INVENTED — no page is reproduced. What this pins is
 * the reading: a sign carried, a "+" after the figure read as a floor and one
 * before another figure read as arithmetic, "or more" read as a floor, and a
 * "per" always yielding a unit, so a rate is never counted once.
 *
 * Also the reading of a modifier list: the `signed` take, which reads only a
 * figure carrying its sign, and `label: true`, which lifts the row's own
 * wording from between the row edges either side of the anchor.
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

/* --- a modifier list: the signed figure of a row, and the row's own wording --- */

// A list that prints each figure AFTER its wording, behind a bullet. A symbol
// font's bullet arrives as a C1 control as readily as U+2022.
const after = read(
  [
    "When the kettle boils, apply these:",
    "\u008D The cook has burned 1/3 or more of the loaves -3",
    "\u008D The cook has burned 3/4 or more of the loaves -6",
    "• Guests outnumber chairs by 3:1 or more +4",
    "• The cellar is dry +0",
    "Afterwards the hall is swept.",
  ],
  [
    { key: "burn1", find: "of the loaves", occurrence: 1, take: "signed", span: 8, label: true },
    { key: "burn2", find: "of the loaves", occurrence: 2, take: "signed", span: 8, label: true },
    { key: "chairs", find: "guests outnumber chairs", take: "signed", span: 30, label: true },
    { key: "cellar", find: "the cellar is dry", take: "signed", span: 8, label: true },
  ],
);
check("a row's signed figure is read past the fraction it is worded with", after.burn1 === -3 && after.burn2 === -6);
check("a ratio in the wording is not the figure", after.chairs === 4);
check("a printed zero is a figure", after.cellar === 0);
check("a row's wording runs from its bullet to its figure, as printed", after.burn1Label === "The cook has burned 1/3 or more of the loaves");
check("the rungs of one ladder keep their own wording", after.burn2Label === "The cook has burned 3/4 or more of the loaves");
check("the wording keeps what follows the anchor", after.chairsLabel === "Guests outnumber chairs by 3:1 or more");

// A grid that prints each figure BEFORE its wording. Small caps split a row's
// first letter into its own lowercase run.
const before = read(
  ["+3 Baker alongside the apprentice at the oven", "+0 o ther bakers at the oven", "-2 t he apprentice alone at the oven"],
  [
    { key: "baker", find: "baker alongside", before: true, take: "signed", span: 10, label: true },
    { key: "others", find: "ther bakers", before: true, take: "signed", span: 10, label: true },
    { key: "alone", find: "he apprentice alone", before: true, take: "signed", span: 10, label: true },
  ],
);
check("a figure before its wording is the nearest one behind the anchor", before.baker === 3 && before.others === 0 && before.alone === -2);
check("the wording runs from its figure to the next row's", before.bakerLabel === "Baker alongside the apprentice at the oven");
check("a small-caps initial is rejoined and capitalized", before.othersLabel === "Other bakers at the oven");
check("the row that ends the page runs to the end of the text", before.aloneLabel === "The apprentice alone at the oven");

const bare = read(["The door is worth +5 to the knock."], [{ key: "door", find: "the door is worth", take: "signed", label: true }]);
check("a figure with no row edge before it keeps its value and takes no label", bare.door === 5 && !("doorLabel" in bare));

const unsigned = read(["The gate stands 7 high."], [{ key: "gate", find: "the gate stands", take: "signed" }]);
check("a bare number is not a signed figure", !("gate" in unsigned));

console.log(`test-prose-values: ${pass} checks passed.`);
