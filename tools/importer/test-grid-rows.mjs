/**
 * `gridRows` bounds and wrapped cells on invented page runs: optional specs,
 * `stopAt`, a y-bounded column, and `wrapRows`. No page is read; the runs
 * are laid out the way the printed tables set them (a label column, result
 * text beside it, some results over two lines with the label on either).
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";

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

console.log(`test-grid-rows: all ${pass} checks passed`);
