/**
 * `gridRows` bounds and wrapped cells on invented page runs: optional specs,
 * `stopAt`, a y-bounded column, `wrapRows`, and an unlabelled header row with
 * its own cell pattern. No page is read; the runs are laid out the way the
 * printed tables set them (a label column, result text beside it, some
 * results over two lines with the label on either). Also the band, rate and
 * list cell patterns, on invented cells, and the shipped Range of Trade
 * recipe on a page of invented figures laid out as the book sets it.
 */
import assert from "node:assert";
import { applyCellPattern, extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { parseMiles } from "../../scripts/markets/rules/routes.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });
const BAND = "^\\d+(\\s*[-–]\\s*\\d+)?$";
const bands = (n, optional = true) => Array.from({ length: n }, (_, i) => ({
  key: `b${i}`, labelRe: BAND, labelPattern: "rollBand", ...(optional ? { optional } : {}),
}));
const recipe = (over) => ({
  shape: "gridRows",
  column: { xMin: 0, xMax: 300 },
  labelMaxX: 40,
  rowTol: 4,
  joinGap: 1,
  cellColumns: [{ key: "name", x: 44, w: 250, pattern: "raw", row: true }],
  rows: bands(8),
  ...over,
});

/* --- optional specs ---------------------------------------------------------- */
const three = [run("1", 20, 100), run("qq one", 50, 100), run("2", 20, 112), run("qq two", 50, 112), run("3", 20, 124), run("qq three", 50, 124)];
let out = extractTable(three, recipe({}));
check("optional specs past the table's end leave no placeholder", Object.keys(out).length === 3 && out.b2.name === "qq three");
out = extractTable(three, recipe({ rows: bands(4, false) }));
check("a required spec with no row still reads missing", out.b3.__missing === true);

/* --- stopAt ------------------------------------------------------------------ */
const stacked = [
  run("(1d4)", 10, 80), run("1-2", 20, 100), run("qq low", 50, 100), run("3-4", 20, 112), run("qq high", 50, 112),
  run("(1d6)", 10, 140), run("1-5", 20, 152), run("qq under", 50, 152), run("6", 20, 164), run("qq over", 50, 164),
];
out = extractTable(stacked, recipe({ startAfter: "(1d4)", stopAt: "(1d6)" }));
check("stopAt ends the upper table above the lower one's header",
  Object.keys(out).length === 2 && out.b1.name === "qq high" && out.b1.max === 4);
out = extractTable(stacked, recipe({ startAfter: "(1d6)" }));
check("the lower table starts after its own header", Object.keys(out).length === 2 && out.b0.max === 5);

/* --- a y-bounded column ------------------------------------------------------ */
out = extractTable(stacked, recipe({ column: { xMin: 0, xMax: 300, yMax: 130 } }));
check("yMax bounds the column like xMax", Object.keys(out).length === 2 && out.b0.name === "qq low");
out = extractTable(stacked, recipe({ column: { xMin: 0, xMax: 300, yMin: 130 } }));
check("yMin bounds it from above", out.b0.name === "qq under");

/* --- wrapped rows ------------------------------------------------------------ */
// Row 1 one line; row 2 two lines, label on the first; row 3 two lines, label
// between them (merging with the first); row 4 one line; then prose flush left.
const wrapped = [
  run("(1d4)", 10, 80),
  run("1", 20, 100), run("qq single line.", 50, 100),
  run("2", 20, 112), run("qq first half", 50, 112), run("and its end.", 50, 121),
  run("qq opens here", 50, 133), run("3", 20, 136), run("and closes.", 50, 142),
  run("4", 20, 154), run("qq last.", 50, 154),
  run("qq prose that follows", 5, 166), run("a stray indented line", 50, 200),
];
out = extractTable(wrapped, recipe({ startAfter: "(1d4)", wrapRows: { tol: 12 } }));
check("a one-line row reads as before", out.b0.name === "qq single line.");
check("a continuation below its label joins in reading order", out.b1.name === "qq first half and its end.");
check("a label set between its lines takes both, top to bottom", out.b2.name === "qq opens here and closes.");
check("a line past the last row's tolerance is not taken", out.b3.name === "qq last.");
out = extractTable(wrapped, recipe({ startAfter: "(1d4)" }));
check("without wrapRows a continuation is dropped", out.b1.name === "qq first half");

/* --- an unlabelled header row, and a row's own cell pattern ------------------ */
// A header of column scales printed with nothing under the label column,
// then body rows of whole numbers.
const scaled = [
  run("qq kind", 10, 80), run("2.5-qq span", 50, 92), run("9-qq span", 100, 92),
  run("qq north", 10, 104), run("7,100qq", 50, 104), run("44,000qq", 100, 104),
  run("qq south", 10, 116), run("8,200qq", 50, 116), run("51,000qq", 100, 116),
];
const scales = {
  startAfter: "qq kind",
  cellPattern: "int",
  cellColumns: [{ key: "c1", x: 50, row: true }, { key: "c2", x: 100, row: true }],
  rows: [{ key: "span", unlabelled: true, cellPattern: "num" }, { key: "north", labelRe: "^qq north" }, { key: "south", labelRe: "^qq south" }],
};
out = extractTable(scaled, recipe(scales));
check("an unlabelled spec claims the header row with its own pattern", out.span.c1 === 2.5 && out.span.c2 === 9);
check("the body under it reads the recipe's pattern", out.north.c1 === 7100 && out.south.c2 === 51000);
out = extractTable(scaled.slice(3), recipe({ ...scales, startAfter: undefined }));
check("an unlabelled spec never claims a labelled row", out.span.__missing === true && out.north.c1 === 7100);

/* --- the band, rate and list cell patterns ----------------------------------- */
const band = (t) => JSON.stringify(applyCellPattern(t, "countBand"));
check("a comma band reads both ends", band("2,300 – 7,700") === '{"min":2300,"max":7700}');
check("a hyphen band reads the same", band("12-19") === '{"min":12,"max":19}');
check("or more opens a band above", band("45 or more") === '{"min":45,"max":null}' && band("31+") === '{"min":31,"max":null}');
check("or fewer opens a band below", band("3 or fewer") === '{"min":null,"max":3}');
check("a lone figure is a band of one", band("6") === '{"min":6,"max":6}');
check("K and M scale a figure, and a + after the top opens it", band("4K – 9.5K") === '{"min":4000,"max":9500}' && band("1.5M – 3M+") === '{"min":1500000,"max":null}');
check("a word is no band", applyCellPattern("several", "countBand") === null);
const rate = (t) => JSON.stringify(applyCellPattern(t, "gpRate"));
check("a ranged rate reads both ends and its unit", rate("7 – 11gp / barrel") === '{"min":7,"max":11,"per":"barrel"}');
check("one rate is both ends, silver read as gp", rate("6sp/ cart") === '{"min":0.6,"max":0.6,"per":"cart"}');
check("a word for a rate is null", applyCellPattern("Ask", "gpRate") === null);
check("a signed list reads each figure", JSON.stringify(applyCellPattern("+2/+4", "signedList")) === "[2,4]" && JSON.stringify(applyCellPattern("−5", "signedList")) === "[-5]");
check("a list with a word in it is no list", applyCellPattern("+2/some", "signedList") === null);

/* --- the shipped Range of Trade recipe on invented runs ---------------------- */
// The page's layout with invented figures: a two-line header, then one row per
// class from the smallest market up, each label split by the small-caps face
// ("c" + "lass" + a mixed-case numeral) and two cells of miles and hexes. A
// run from the other print column shares one row's baseline.
const at = (str, x, y, w) => ({ str, x, y, w, h: 9 });
const RANGE_ROWS = [
  [[["c", 76.1, 5.3], ["lass", 81.3, 12.1], ["v", 95.3, 5.4], ["I", 100.6, 2.1]], "23 miles (4 hexes)", "71 miles (12 hexes)"],
  [[["c", 76.1, 5.3], ["lass", 81.3, 12.1], ["v", 95.3, 5.4]], "5 miles (1 hexes)", "140 miles (23 hexes)"],
  [[["c", 76.1, 5.3], ["lass I", 81.3, 16.1], ["v", 97.4, 5.4]], "88 miles (15 hexes)", "12 miles (2 hexes)"],
  [[["c", 76.1, 5.3], ["lass III", 81.3, 20.5]], "301 miles (50 hexes)", "47 miles (8 hexes)"],
  [[["c", 76.1, 5.3], ["lass II", 81.3, 18.3]], "9 miles (2 hexes)", "1,020 miles (170 hexes)"],
  [[["c", 76.1, 5.3], ["lass I", 81.3, 16.1]], "64 miles (11 hexes)", "333 miles (56 hexes)"],
];
const rangePage = [
  at("Range of Trade", 72, 160.5, 81.7),
  at("Market", 76.5, 176.3, 31.2), at("r", 132.2, 176.3, 5.3), at("ange of", 137.5, 176.3, 31.7), at("t", 171.3, 176.3, 5.4), at("rade", 176.1, 176.3, 19.3),
  at("r", 223.1, 176.3, 5.3), at("ange of", 228.5, 176.3, 31.7), at("t", 262.2, 176.3, 5.4), at("rade", 267, 176.3, 19.3),
  at("c", 76.5, 186.3, 5.8), at("lass", 82.3, 186.3, 16.7), at("(", 132.2, 186.3, 3.3), at("r", 135.4, 186.3, 5.3), at("oad)", 140.7, 186.3, 19.3), at("(Water)", 223.1, 186.3, 32.2),
  ...RANGE_ROWS.flatMap(([label, road, water], i) => {
    const y = 199.5 + i * 11.3;
    return [...label.map(([s, x, w]) => at(s, x, y, w)), at(road, 131.8, y, 66), at(water, 222.7, y, 68)];
  }),
  at("19 miles across the other column", 330, 210.8, 200),
];
const rangeOfTrade = TABLE_RECIPES.demand.tables.rangeOfTrade;
const ranges = extractTable(rangePage, rangeOfTrade).rows;
check("every class row is read, smallest market first", JSON.stringify(ranges.map((r) => r.marketClass)) === "[6,5,4,3,2,1]");
check("no class row reads missing", ranges.every((r) => !r.__missing));
check("each row holds its class and two cells, nothing more", ranges.every((r) => Object.keys(r).sort().join() === "marketClass,road,water"));
check("the road cell keeps its printed text", ranges[0].road === "23 miles (4 hexes)");
check("each cell reads as its own row's miles", JSON.stringify(ranges.map((r) => [parseMiles(r.road), parseMiles(r.water)])) ===
  JSON.stringify([[23, 71], [5, 140], [88, 12], [301, 47], [9, 1020], [64, 333]]));
check("the other print column never joins a cell", !ranges.some((r) => /across/.test(r.road + r.water)));

console.log(`test-grid-rows: all ${pass} checks passed`);
