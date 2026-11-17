/**
 * The treasure tables' recipes and assembler on invented pages: no book is
 * read, and every caption, word and figure here is made up. The recipe
 * builders run on runs laid out the way the printed tables are set (a letter
 * centred on a row of unequal height, a result wrapped over lines with its
 * label mid-row, a list that runs across two print columns); the binding's
 * assembler joins the segments, tiles the bands and refuses a lost row; and
 * the shipped recipes are held to the anchor rule (no printed figure in one).
 * `check-treasure-tables.mjs` reads the real page.
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { TREASURE_RECIPES, TYPE_LETTERS, bandGrid, typeGrid } from "../../scripts/importer/table-recipes-treasure.mjs";
import {
  PRODUCES,
  SPECIAL_RAW_KEYS,
  TREASURE_DOC_ID,
  TYPE_RAW_KEYS,
  VALUE_RAW_KEYS,
  assembleBands,
  assembleTreasureTables,
  assembleTypes,
  splitTypeHead,
} from "../../scripts/importer/treasure-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });

/* --- the shipped recipes ----------------------------------------------------- */
eq("the doc is joined into the recipes under its id", TABLE_RECIPES[TREASURE_DOC_ID], TREASURE_RECIPES);
const tables = TREASURE_RECIPES.tables;
for (const [id, recipe] of Object.entries(tables)) {
  const anchors = [recipe.locate, recipe.startAfter, recipe.stopAt, recipe.locateKey, recipe.locateHeadingKey].filter((a) => a != null);
  check(`${id}: names a page by a phrase`, !!recipe.locate);
  check(`${id}: no anchor holds a figure`, anchors.every((a) => !/\d/.test(a)));
  check(`${id}: reads the Judges Journal`, recipe.book === "jj");
  const [from, to = from] = TREASURE_RECIPES.source.pages.replace(/^JJ\s+/, "").split("-").map(Number);
  check(`${id}: its folio is one the document cites`, recipe.printedPage >= from && recipe.printedPage <= to);
}
const readRaw = new Set(Object.values(PRODUCES[TREASURE_DOC_ID]).flat());
eq("every raw table is read by some engine table", Object.keys(tables).sort(), [...readRaw].sort());
check("the treasure types are the letters A to R", TYPE_LETTERS.join("") === "ABCDEFGHIJKLMNOPQR");

/* --- a type grid: a letter centred on rows of unequal height ------------------ */
const GRID = { page: 1, locate: "Qq caption", yMin: 85, labelMaxX: 60, cells: [["head", 90, 40], ["magic", 200, 100]] };
const lettersAB = (g) => ({ ...g, rows: g.rows.slice(0, 2) });
const typePage = [
  // a header line above the table, within a wrap reach of A
  run("H-hdr", 92, 80),
  // A: a short row, its letter on the middle of three lines
  run("H-a", 92, 90), run("m-a1", 202, 90),
  run("a", 50, 100), run("m-a2", 202, 100),
  run("V-a", 92, 110), run("m-a3", 202, 110),
  // B: a tall row of five lines whose first sits nearer A's letter than its own
  run("m-b1", 202, 118), run("m-b2", 202, 129),
  run("b", 50, 140), run("H-b", 92, 140), run("m-b3", 202, 140),
  run("m-b4", 202, 151), run("m-b5", 202, 162),
];
let out = extractTable(typePage, lettersAB(typeGrid(GRID)));
eq("a tall row keeps its first lines when the letters are centred", [out.A.magic, out.B.magic], ["m-a1 m-a2 m-a3", "m-b1 m-b2 m-b3 m-b4 m-b5"]);
eq("the stacked first cell reads in line order", [out.A.head, out.B.head], ["H-a V-a", "H-b"]);
const nearest = typeGrid(GRID);
out = extractTable(typePage, lettersAB({ ...nearest, wrapRows: { tol: 22 } }));
check("nearest-letter joining hands the tall row's first line to the row above", out.A.magic.includes("m-b1"));
out = extractTable(typePage, lettersAB(typeGrid({ ...GRID, yMin: 0 })));
check("without the header bound, the wrap reach takes the header line for the first row", out.A.head === "H-hdr H-a V-a");

/* --- a band list: wrapped results, a label mid-row ---------------------------- */
const LIST = { page: 1, locate: "Qq", column: { xMin: 0, xMax: 300, yMin: 0 }, labelMaxX: 40, cells: [["text", 44, 200]] };
const listPage = [
  run("1", 20, 104), run("qq one", 46, 100), run("wraps", 46, 108),
  run("2-5", 20, 120), run("qq two", 46, 120),
  run("6", 20, 140), run("qq three", 46, 136), run("wraps too", 46, 144),
];
out = extractTable(listPage, bandGrid(LIST));
eq("each band reads its own label and its wrapped lines", Object.values(out).map((r) => [r.min, r.max, r.text]), [
  [1, 1, "qq one wraps"],
  [2, 5, "qq two"],
  [6, 6, "qq three wraps too"],
]);

/* --- segments ------------------------------------------------------------------ */
const left = extractTable([run("1", 20, 100), run("qq a", 46, 100), run("2", 20, 112), run("qq b", 46, 112)], bandGrid(LIST));
const right = extractTable([run("3-4", 20, 100), run("qq c", 46, 100), run("5", 20, 112), run("qq d", 46, 112)], bandGrid(LIST));
const read = (r) => ({ text: r.text });
eq("two segments join into one tiled list", assembleBands([left, right], read)?.map((b) => [b.min, b.max, b.text]), [[1, 1, "qq a"], [2, 2, "qq b"], [3, 4, "qq c"], [5, 5, "qq d"]]);
eq("segments given out of page order still sort", assembleBands([right, left], read)?.length, 4);
eq("a lost row leaves a gap, and no table is made", assembleBands([left, { ...right, b0: undefined }], read), null);
eq("a list that does not start at one is no table", assembleBands([right], read), null);
eq("a row the reader refuses is dropped, and the gap refuses the table", assembleBands([left, right], (r) => (r.min === 3 ? null : read(r))), null);
eq("an overlap is refused", assembleBands([left, { b0: { min: 2, max: 3, text: "x" } }], read), null);

/* --- the type rows --------------------------------------------------------------- */
eq("a head splits into its category and its average value", [splitTypeHead("Qq 1,234gp"), splitTypeHead("Zz 5 gp"), splitTypeHead("Qq"), splitTypeHead("")], [
  { category: "Qq", avgValue: "1,234gp" },
  { category: "Zz", avgValue: "5gp" },
  { category: "Qq", avgValue: null },
  { category: null, avgValue: null },
]);
const types = assembleTypes({ A: { head: "Qq 5gp", cp: " 13%  1d9 ", magic: "x (3gp)" }, B: { __missing: true }, Z: { head: "ignored" } });
eq("a type row keeps its cells and a missing letter is left out, as is a name that is no letter", types, { A: { category: "Qq", avgValue: "5gp", cp: "13% 1d9", magic: "x (3gp)" } });
eq("no row at all assembles nothing", assembleTypes({ A: { __missing: true } }), null);

/* --- the whole assembly ------------------------------------------------------------ */
const band = (min, max, cells) => ({ min, max, ...cells });
const raw = {
  typeClassicRaw: { A: { head: "Qq 5gp", cp: "0% none" } },
  gemValueRaw: { b0: band(1, 5, { value: "3", type: "qq stone" }), b1: band(6, 9, { value: "8", type: "zz stone" }) },
  jewelryValueRaw: { b0: band(2, 9, { value: "3", type: "qq" }) },
  specialCpRaw: { b0: band(1, 2, { text: "qq sacks" }) },
  specialCpMoreRaw: { b0: band(3, 3, { text: "zz sacks" }) },
  specialOrnamentalRaw: { b0: band(1, 1, { text: "" }) },
};
const engine = assembleTreasureTables(raw);
eq("a type table is assembled by its letters", Object.keys(engine.typeClassic), ["A"]);
eq("a value list keeps its value and a risen type", engine.gemValue.bands, [band(1, 5, { value: "3", type: "Qq stone" }), band(6, 9, { value: "8", type: "Zz stone" })]);
check("a value list that does not start at one is not assembled", !("jewelryValue" in engine));
eq("a special list joins its segments", engine.special.cp, [band(1, 2, { result: "Qq sacks" }), band(3, 3, { result: "Zz sacks" })]);
check("a list with an empty result is not assembled", !("ornamental" in engine.special));
check("the heroic grid, never read, is not assembled", !("typeHeroic" in engine));
eq("nothing read assembles nothing", assembleTreasureTables({}), {});

/* --- the raw keys the binding names -------------------------------------------------- */
check("every raw key the binding names has a recipe", [...Object.keys(TYPE_RAW_KEYS), ...Object.keys(VALUE_RAW_KEYS), ...Object.values(SPECIAL_RAW_KEYS).flat()].every((k) => k in tables));

console.log(`test-treasure-binding: ${pass} checks passed.`);
