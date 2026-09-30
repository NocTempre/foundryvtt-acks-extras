/**
 * A strength grid through the executor's grid op, on invented page runs.
 *
 * Two mechanics this pins. `dashZero`: a count grid prints a dash for none,
 * so a dash is a ZERO and a row of dashes is still a row — `minCells` cannot
 * keep it, because a null cell does not count as parsed. And the header band
 * is joined by LINE whatever the rows are: a column's words wrap onto a second
 * line, and a blind join of the band's runs in reading order interleaves the
 * columns' words. No page is read; the runs are laid out the way the printed
 * tables set them.
 */
import assert from "node:assert/strict";
import { applyCellPattern } from "../../scripts/importer/table-extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

// --- the cell pattern ------------------------------------------------------------
assert.equal(applyCellPattern("-", "dashZero"), 0, "a hyphen is zero");
assert.equal(applyCellPattern("—", "dashZero"), 0, "an em dash is zero");
assert.equal(applyCellPattern("–", "dashZero"), 0, "an en dash is zero");
assert.equal(applyCellPattern("21*", "dashZero"), 21, "a footnote mark is not part of the number");
assert.equal(applyCellPattern("1,500", "dashZero"), 1500, "a thousands comma is not either");
assert.equal(applyCellPattern("", "dashZero"), null, "a blank is not a count");
assert.equal(applyCellPattern("N/A", "dashZero"), null, "nor is a word");
pass += 7;

// --- the grid op on a page --------------------------------------------------------
const run = (str, x, y, w = str.length * 4) => ({ str, x, y, w, h: 8, alias: "f", sp: false });
const items = [
  // A two-line header: the first column's heading wraps; the second is one word.
  run("Sworn", 62, 40), run("Watch", 102, 40),
  run("Blades", 60, 48), run("Revenue", 140, 48),
  // Rows: label, two counts, a revenue. One row is all dashes.
  run("3rd", 20, 62), run("2", 66, 62), run("-", 106, 62), run("1,500gp", 142, 62),
  run("2nd", 20, 74), run("-", 66, 74), run("-", 106, 74), run("N/A", 142, 74),
  run("1st", 20, 86), run("21*", 66, 86), run("4", 106, 86), run("300gp", 142, 86),
  run("Total", 18, 100), run("23", 66, 100), run("4", 106, 100), run("1,800gp", 142, 100),
];
const cookbook = {
  schema: "acks-cookbook/2",
  entries: {
    "bk.strength1": {
      kind: "kind.strengthGrid",
      name: "Strength grid 1",
      pages: [1],
      fields: {
        "grids.strength": {
          op: "grid", page: 1,
          box: { x0: 10, x1: 190, y0: 56, y1: 106 },
          label: { x0: 10, x1: 50 },
          headerBand: { y0: 36, y1: 52 },
          cols: [
            { key: "c1", x0: 58, x1: 96, pattern: "dashZero" },
            { key: "c2", x0: 100, x1: 130, pattern: "dashZero" },
            { key: "revenue", x0: 136, x1: 190, pattern: "int" },
          ],
        },
      },
    },
  },
};
const pageCache = new Map([[1, { items, width: 200, height: 120 }]]);
const node = await executeEntry(null, cookbook, { tables: {} }, "bk.strength1", { pageCache });
const grid = node.fields.grids.strength;
check("the entry executes", node.ok === true);
check("a wrapped heading is joined by line, not interleaved with its neighbour",
  grid.header.c1 === "Sworn Blades" && grid.header.c2 === "Watch" && grid.header.revenue === "Revenue");
check("every level row survives, the all-dash row included",
  grid.rows.map((r) => r.label).join("|") === "3rd|2nd|1st|Total");
const cells = Object.fromEntries(grid.rows.map((r) => [r.label, r.cells]));
check("a dash is a zero and a footnote mark is dropped",
  cells["3rd"].c1 === 2 && cells["3rd"].c2 === 0 && cells["2nd"].c1 === 0 && cells["2nd"].c2 === 0 && cells["1st"].c1 === 21);
check("revenue reads the number and leaves a word no cell at all",
  cells["3rd"].revenue === 1500 && !("revenue" in cells["2nd"]) && cells["1st"].revenue === 300);
check("the total row is read like any other, for the binder to check",
  cells.Total.c1 === 23 && cells.Total.c2 === 4 && cells.Total.revenue === 1800);

console.log(`importer/test-strength-grid: ${pass} checks passed`);
