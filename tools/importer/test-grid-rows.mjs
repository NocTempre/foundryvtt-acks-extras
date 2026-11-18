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
import { assembleBuilderTables } from "../../scripts/importer/builder-binding.mjs";

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
check("a name set in one lower-case run keeps its capital under rawCapital, and under raw it does not", applyCellPattern("qq of zz", "rawCapital") === "Qq of zz" && applyCellPattern("qq of zz", "raw") === "qq of zz");
check("rawCapital leaves a capital, a digit and an empty cell as they are", ["Qq", "9q", ""].every((t) => applyCellPattern(t, "rawCapital") === t));
check("int, num and intDash keep the sign of a glyph minus, en dash and em dash",
  ["int", "num", "intDash"].every((p) => ["−3", "–3", "—3", "-3"].every((t) => applyCellPattern(t, p) === -3)));
check("a range reads its leftmost figure whatever the dash", ["int", "num", "intDash"].every((p) => ["10–20", "10−20", "10—20", "10-20"].every((t) => applyCellPattern(t, p) === 10)));
check("a lone dash reads no figure", ["int", "num", "intDash"].every((p) => ["–", "−", "—"].every((t) => applyCellPattern(t, p) === null)));
check("a signed list reads each figure", JSON.stringify(applyCellPattern("+2/+4", "signedList")) === "[2,4]" && JSON.stringify(applyCellPattern("−5", "signedList")) === "[-5]");
check("a list with a word in it is no list", applyCellPattern("+2/some", "signedList") === null);
check("a word list drops its closing and, its quotes, its bracket of examples and the word items",
  JSON.stringify(applyCellPattern("aa, bb (e.g. cc), and “dd” items", "wordList")) === '["aa","bb","dd"]');
check("a word list cell reading none is an empty list, not an absent one", JSON.stringify(applyCellPattern("None", "wordList")) === "[]");
{
  // The item-loss materials recipe on invented runs: the margin tab sits left
  // of the column, a label splits across runs, and the electrical row's label
  // is the printed short adjective.
  const recipeOf = TABLE_RECIPES.equipment.tables.itemLossMaterials;
  const rowKeys = recipeOf.rows.map((r) => r.key);
  const runs = [run("Materials Destroyed by Damage Type", 45, 576), run("Material", 156, 591), run("c", 10, 592), run("M", 10, 610)];
  rowKeys.forEach((key, i) => {
    const y = 605 + i * 11;
    const printed = key.replace(/al$/, "");
    runs.push(run(printed[0], 49, y, 5), run(printed.slice(1), 55, y), run(i === 3 ? "None" : `zz${i}, yy${i}, and “xx${i}” items (e.g. ww)`, 156, y));
  });
  const grid = extractTable(runs, recipeOf);
  check("the materials grid reads one row per vocabulary key under that key", Object.keys(grid).join() === rowKeys.join() && !rowKeys.includes("varies") && rowKeys.includes("electrical"));
  check("each row's cell is the word list, an empty one where the page printed none",
    JSON.stringify(grid[rowKeys[0]]) === '{"materials":["zz0","yy0","xx0"]}' && JSON.stringify(grid[rowKeys[3]]) === '{"materials":[]}');
}

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

// The monster size row's unit: an invented label naming its square in feet is
// read into {feet} by the shipped recipe, on a row with no cells of its own; the
// frontage recipe claims the same row by any figure in the bracket.
{
  const unit = TABLE_RECIPES.monsters.tables.sizeSquare;
  const page = (n) => [
    run("Length/Height:", 95, 682), run("A cell", 148, 682),
    run("Frontage (ft.):", 99, 692), run("Another cell", 148, 692),
    run(`Frontage (${n}’-squares)`, 76, 703), run("A squares cell", 148, 703),
  ];
  check("the unit is read as feet from an invented label", extractTable(page(7), unit).squares?.feet === 7);
  check("the unit row holds nothing but the figure", Object.keys(extractTable(page(7), unit).squares).join() === "feet");
  check("a label with another figure reads that figure", extractTable(page(12), unit).squares?.feet === 12);
  check("a page without the row reads missing", extractTable([run("Length/Height:", 95, 682)], unit).squares?.__missing === true);
  const frontage = extractTable(page(7), TABLE_RECIPES.monsters.tables.sizeFrontage);
  check("the frontage recipe claims the row whatever figure the bracket holds", frontage.squares?.small === "A squares cell");
  check("squareFeet reads no figure from a label without one", applyCellPattern("Frontage (squares)", "squareFeet") === null);
}

/* --- the class builder's racial caps: the rung is the label the page prints --- */
{
  const caps = TABLE_RECIPES["acks.classBuilder"].tables.racialCaps;
  const rung = (label, cell, y) => [run(label, 200, y), run(cell, 273, y, 10)];
  const page = [...rung("31", "17", 300), ...rung("30", "15", 312), ...rung("29", "12", 324), ...rung("28", "11", 336), ...rung("27", "10", 348)];
  const got = extractTable(page, caps);
  check("racial caps keys are ordinals, not figures", Object.keys(got).join() === "r1,r2,r3,r4,r5");
  check("each row reads its rung from the label and its cap from the cell", got.r1.label === 31 && got.r1.maxLevel === 17 && got.r5.label === 27 && got.r5.maxLevel === 10);
  const asm = assembleBuilderTables({ racialCaps: got }).budget.racialCaps;
  check("assembly takes points from the read label, every row", asm.length === 5 && asm[4].points === 31 && asm[4].maxLevel === 17 && asm[0].points === 27 && asm[0].maxLevel === 10);
  const short = extractTable(page.slice(0, 8), caps);
  check("a row the page does not print reads missing and assembles to no row", short.r5.__missing === true && assembleBuilderTables({ racialCaps: short }).budget.racialCaps.length === 4);
  const unread = { ...got, r2: { ...got.r2, label: null } };
  const drop = assembleBuilderTables({ racialCaps: unread }).budget.racialCaps;
  check("a row whose rung did not read carries no points and is answered by no total", drop.length === 4 && drop.every((r) => r.points !== 30 && Number.isInteger(r.points)));
  check("labelInt reads a bare integer label and nothing else", applyCellPattern("12", "labelInt")?.label === 12 && applyCellPattern("12 pts", "labelInt") === null);
}

/* --- keyByLabel: rows keyed by what the page prints --------------------------- */
{
  // The body-form recipe on invented runs: the name column splits a small-caps
  // opening letter into a run of its own, a name repeats, a lone marker sits
  // beside a label, and a header above the grid and a footnote below it hold
  // label-shaped text.
  const forms = TABLE_RECIPES.monsters.tables.bodyForms;
  const page = [
    run("Kind", 76, 290), run("Samples", 136, 290),
    run("z", 76, 303, 5), run("orvine", 81, 303, 30), run("q", 136, 303, 5), run("uill (any)", 141, 303, 40),
    run("Brindle", 76, 314, 35), run("fen cat, wisp", 136, 314, 60),
    run("z", 76, 325, 5), run("orvine", 81, 325, 30), run("again", 136, 325, 30),
    run("7 stray", 76, 336, 30),
    run("Mirth", 76, 347, 25), run("*", 100, 347, 3), run("plain", 136, 347, 25),
    run("*", 72, 749, 3), run("footnote", 81, 749, 40),
  ];
  const got = extractTable(page, forms);
  check("each row is keyed by the slug of its printed label, in print order", Object.keys(got).join() === "zorvine,brindle,mirth");
  check("the label is the tidied print, its small-caps opening letter restored and a marker dropped",
    got.zorvine.label === "Zorvine" && got.brindle.label === "Brindle" && got.mirth.label === "Mirth");
  check("the sample cell is read with each part's opening letter restored",
    got.zorvine.example === "Quill (any)" && got.brindle.example === "Fen cat, Wisp");
  check("a repeated label is dropped and the first row stands", got.zorvine.example === "Quill (any)" && Object.keys(got).length === 3);
  check("a header above the grid and a footnote below it are no rows", !("kind" in got) && !("footnote" in got));
  check("no generic spec key and no missing row survives", Object.keys(got).every((k) => !/^form\d/.test(k)) && Object.values(got).every((r) => !r.__missing));
  check("tidyNames restores the opening letter of every comma part", applyCellPattern("aa (any), bb, cc", "tidyNames") === "Aa (any), Bb, Cc");
}

/* --- the gnosis group: five grids on invented runs laid out as the book sets them --- */
{
  const g = TABLE_RECIPES.gnosis;
  // A cell's characters arrive as runs set flush against each other.
  const cell = (str, x, y) => [...str].map((ch, i) => run(ch, x + i * 5, y, 5));
  check("the group is optional, tied to the supplement and cites its three pages",
    Object.values(g.tables).every((t) => t.book === "bta" && t.optional === true) && g.source.pages === "BTA 120-121, 128");

  // Invocation level by invoker level: a header row of column numbers, then ordinal rows.
  const starts = [146, 191, 235, 280, 324, 369, 413, 458, 502, 546];
  const gridRow = (label, y, values) => [
    run(label.slice(0, -2), 87, y, 5), run(label.slice(-2), 92, y, 10), ...starts.flatMap((x, i) => cell(values[i], x, y)),
  ];
  const head = [run("Invocation", 58, 111, 40), run("Level", 100, 111, 25), ...starts.flatMap((x, i) => cell(String(i + 1), x, 111))];
  const body = [
    ...gridRow("1st", 125, ["7+", "3+", "9+", "4+", "1+", "8+", "2+", "0+", "-1+", "5+"]),
    ...gridRow("2nd", 138, ["6+", "11+", "2+", "8+", "13+", "0+", "9+", "4+", "1+", "12+"]),
    ...gridRow("3rd", 151, ["10+", "5+", "7+", "14+", "3+", "9+", "15+", "2+", "6+", "8+"]),
    ...gridRow("4th", 165, ["4+", "12+", "11+", "1+", "9+", "13+", "7+", "0+", "10+", "3+"]),
    ...gridRow("5th", 179, ["15+", "2+", "8+", "6+", "11+", "10+", "14+", "5+", "1+", "9+"]),
  ];
  const strayText = [run("Title", 58, 83, 60), run("Scale", 326, 97, 40), run("prose below the grid", 54, 206, 200), run("more", 324, 218, 60)];
  const perf = extractTable([...strayText, ...head, ...body], g.tables.performanceGrid);
  check("the performance grid reads the header row and five ordinal rows",
    Object.keys(perf).join() === "columns,r1,r2,r3,r4,r5" && Object.values(perf).every((r) => !r.__missing));
  check("every row holds ten cells, a sign and its digits joined", Object.values(perf).every((r) => Object.keys(r).length === 10)
    && perf.r1.c1 === "7+" && perf.r1.c9 === "-1+" && perf.r5.c1 === "15+" && perf.r3.c10 === "8+");
  check("the header row carries the column scale in print order", perf.columns.c1 === "1" && perf.columns.c10 === "10");
  check("a two-digit cell stays in its own column", perf.r4.c2 === "12+" && perf.r4.c3 === "11+" && perf.r5.c5 === "11+" && perf.r5.c6 === "10+");
  check("the page's prose below the grid is no row", !JSON.stringify(perf).includes("prose") && !JSON.stringify(perf).includes("more"));
  check("a grid whose header is missing reads it missing", extractTable(body, g.tables.performanceGrid).columns.__missing === true);

  // The pace table: rows carry no label, so each claims the next row empty at the label zone.
  const paceRow = (y, pace, time, mod, fail, degree) => [
    run(pace, 130, y, 26), ...cell(time[0], 165, y), run(time[1], 172, y, 29), run(time[2], 201, y, 10), run(time[3], 212, y, 34),
    ...cell(mod, 292, y), ...cell(fail, 381, y), run(degree, 438, y, 73),
  ];
  const paceHead = [run("Pace head", 88, 695, 40), run("Time head", 147, 695, 40), run("Degree head", 438, 695, 50)];
  const pace = extractTable([...paceHead, ...paceRow(708, "Brisk", ["3", "beats (", "30", "ticks)"], "-2", "1-2", "By tier"),
    ...paceRow(722, "Plain", ["2", "tides (", "20", "ticks)"], "0", "1", "By tier"),
    ...paceRow(735, "Slow", ["9", "tides (", "90", "ticks)"], "+3", "1", "By tier, less one")], g.tables.paceTable);
  check("the pace table reads three rows of five cells", Object.keys(pace).join() === "r1,r2,r3" && Object.values(pace).every((r) => Object.keys(r).length === 5));
  check("a pace row reads its pace, time, modifier, failure band and mishap rule",
    pace.r1.pace === "Brisk" && pace.r1.time === "3 beats (30 ticks)" && pace.r1.throwModifier === "-2" && pace.r1.automaticFailure === "1-2" && pace.r3.mishapDegree === "By tier, less one" && pace.r3.throwModifier === "+3");
  check("the header row is no pace row", Object.values(pace).every((r) => r.pace !== "Pace head"));

  // The ceremony table: the label is a band, read through rollBand.
  const band = (y, label, text) => [run(label, 155, y, 13), run(text, 174, y, 40)];
  const ceremony = extractTable([run("Level head", 102, 332, 60), run("Degree head", 174, 332, 60),
    ...band(346, "2-4", "Mild"), ...band(361, "5", "Grave"), ...band(374, "6-7", "Dire")], g.tables.ceremonyDegree);
  check("the ceremony table reads each band and its degree word",
    ceremony.r1.min === 2 && ceremony.r1.max === 4 && ceremony.r1.degree === "Mild" && ceremony.r2.min === 5 && ceremony.r2.max === 5 && ceremony.r3.max === 7 && ceremony.r3.degree === "Dire");

  // The mishap table: label centred on its row, rows of differing height, lines in three columns.
  const mishapLines = [
    { label: 144, lines: [5, 3, 1] },
    { label: 186, lines: [2, 1, 2] },
    { label: 234, lines: [6, 4, 5] },
    { label: 276, lines: [1, 1, 1] },
  ];
  const mishapRuns = [];
  const xs = [90, 247, 404];
  mishapLines.forEach(({ label, lines }, r) => {
    mishapRuns.push(run(String(r + 1), 59, label, 5));
    lines.forEach((n, c) => {
      for (let j = 0; j < n; j++) mishapRuns.push(run(`r${r + 1}c${c + 1}l${j + 1}`, xs[c], label - 6 * (n - 1) + 12 * j, 60));
    });
  });
  const noise = [run("heading", 90, 100, 40), run("note below the table", 90, 320, 90), run("*", 40, 330, 5)];
  const four = { ...g.tables.mishapTable, rows: g.tables.mishapTable.rows.slice(0, 4) };
  const mishap = extractTable([...noise, ...mishapRuns], four);
  check("the mishap table reads a row per face, each with three cells, labelled by its face",
    Object.keys(mishap).join() === "r1,r2,r3,r4" && Object.values(mishap).every((r, i) => r.label === i + 1 && !r.__missing && r.c1 && r.c2 && r.c3));
  check("a tall row's lines join it whole, the row above's last lines included",
    mishap.r1.c1 === "r1c1l1 r1c1l2 r1c1l3 r1c1l4 r1c1l5" && mishap.r2.c1 === "r2c1l1 r2c1l2" && mishap.r3.c1.split(" ").length === 6);
  check("every column keeps its own lines in order", mishap.r3.c2 === "r3c2l1 r3c2l2 r3c2l3 r3c2l4" && mishap.r3.c3 === "r3c3l1 r3c3l2 r3c3l3 r3c3l4 r3c3l5" && mishap.r2.c3 === "r2c3l1 r2c3l2");
  check("a header far above and a note below the last box are no lines of any row",
    !JSON.stringify(mishap).includes("heading") && !JSON.stringify(mishap).includes("note"));
  const nearest = extractTable(mishapRuns, { ...four, wrapRows: { tol: 30 } });
  check("nearest-label joining hands the same page's first-row line to the row below, which is why the recipe asks for boxes",
    nearest.r2.c1.includes("r1c1l5"));

  // A figure the page sets after a line's words, though the sentence's sense puts it earlier, is
  // read where the page sets it: cells follow the print's own run order, never a reading of the sense.
  const late = extractTable([
    run("1", 59, 132, 5),
    run("tide one two three", 404, 120, 114), run("said so", 404, 132, 114), run("30", 521, 132, 10), run("’", 530, 132, 2), run("Then more", 404, 144, 48),
  ], { ...g.tables.mishapTable, rows: g.tables.mishapTable.rows.slice(0, 1) });
  check("a figure set after its line's words stays where the page sets it, and the next line follows", late.r1.c3 === "tide one two three said so 30’ Then more");

  // The implement costs: the level is the label, the cost the one cell.
  const costRow = (n, y, cost) => [run(String(n), 479, y, 5), run(cost, 521, y, 24)];
  const costs = extractTable([run("Level head", 470, 245, 30), run("Cost head", 522, 245, 20),
    ...[1, 2, 3, 4, 5, 6].flatMap((n, i) => costRow(n, 259 + i * 13, `${n * 11}pp`))], g.tables.implementCosts);
  check("the implement costs read six levels as labelled ordinals", Object.keys(costs).join() === "r1,r2,r3,r4,r5,r6"
    && costs.r1.label === 1 && costs.r6.label === 6 && costs.r4.cost === "44pp");
}

console.log(`test-grid-rows: all ${pass} checks passed`);
