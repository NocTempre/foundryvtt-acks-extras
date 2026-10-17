/**
 * `gridRows` bounds and wrapped cells on invented page runs: optional specs,
 * `stopAt`, a y-bounded column, `wrapRows`, and an unlabelled header row with
 * its own cell pattern. No page is read; the runs are laid out the way the
 * printed tables set them (a label column, result text beside it, some
 * results over two lines with the label on either). Also the band, rate and
 * list cell patterns, on invented cells.
 */
import assert from "node:assert";
import { applyCellPattern, extractTable } from "../../scripts/importer/table-extract.mjs";

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

console.log(`test-grid-rows: all ${pass} checks passed`);
