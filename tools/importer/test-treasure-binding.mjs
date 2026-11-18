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
import { citeIsFrom, readPlainTable, recipeLocates, tableRecipeBooks } from "../../scripts/importer/tables-binding.mjs";
import { recipeCite } from "../../scripts/importer/produces.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { TREASURE_RECIPES, TYPE_LETTERS, bandGrid, typeGrid } from "../../scripts/importer/table-recipes-treasure.mjs";
import {
  LEGEND_LISTS,
  PRODUCES,
  SPECIAL_RAW_KEYS,
  TREASURE_DOC_ID,
  TYPE_RAW_KEYS,
  VALUE_RAW_KEYS,
  assembleBands,
  assembleLegend,
  assembleTreasureTables,
  assembleTypes,
  captionKinds,
  keepCandidates,
  kindFormsOf,
  legendListOf,
  numberForms,
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
  // A table of the Treasure Tome alone is optional; every other reads the Journal.
  check(`${id}: reads the Judges Journal, or is the Tome's own and optional`, recipe.book === "jj" || (recipe.book === "tt" && recipe.optional === true));
  const cited = (short) => TREASURE_RECIPES.source.pages.match(new RegExp(`${short} (\\d+)-(\\d+)`)).slice(1).map(Number);
  const [from, to] = cited(recipe.book.toUpperCase());
  check(`${id}: its folio is one the document cites`, recipe.printedPage >= from && recipe.printedPage <= to);
  if (recipe.over) {
    const over = recipe.over;
    const [tFrom, tTo] = cited("TT");
    check(`${id}: its overlay reads the Treasure Tome`, over.book === "tt");
    check(`${id}: its overlay names a page by a phrase`, !!over.locate && !/\d/.test(over.locate));
    check(`${id}: its overlay's folio is one the document cites`, over.printedPage >= tFrom && over.printedPage <= tTo);
    check(`${id}: its overlay is a whole recipe, or empty`, over.empty === true || (over.shape === "gridRows" && !!over.rows && !!over.cellColumns));
  }
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

/* --- a legend row names its special list; one band of a gem or jewelry list keeps the lot ----- */
// Invented kinds and captions throughout: a caption reads "<lead> per <kind> (<figure>)".
const capt = (kind) => ({ caption: { label: `Qq lots per ${kind} (9)` } });
const listRaw = (kind, texts) => ({ ...(kind ? capt(kind) : {}), ...Object.fromEntries(texts.map((t, i) => [`b${i}`, band(i + 1, i + 1, { text: t })])) });
const legendRaw = (kinds) => Object.fromEntries(kinds.map((k, i) => [`d${i}`, { label: `${i + 1}d9`, avg: `avg. ${i + 5}`, type: k }]));
const lotRaw = {
  specialOrnamentalRaw: listRaw("Zorb", ["9 qq boxes", "1 zorb (2 items)"]),
  specialGemRaw: listRaw("Qux", ["1d4 zorbs", "3 qux", "1 piece of qux"]),
  specialBrilliantRaw: listRaw("Plim", ["1 plim or 4d4 qux", "9 plims"]),
  specialTrinketRaw: listRaw("Frob", ["2 frobs", "1 frob"]),
  specialJewelryRaw: listRaw("Wug", ["1d8 wugs", "1 wug (a note)"]),
  specialRegaliaRaw: listRaw("Snarf", ["4d8 wugs", "1 snarf"]),
  gemDiceRaw: legendRaw(["Zorbs", "Qux", "Plims"]),
  jewelryDiceRaw: legendRaw(["Frobs", "Wug", "Snarfs"]),
};
let tagged = assembleTreasureTables(lotRaw);
eq("a legend row names its list by the caption, in either number", [tagged.gemDice.legend.map((r) => r.list), tagged.jewelryDice.legend.map((r) => r.list)], [LEGEND_LISTS.gemDice, LEGEND_LISTS.jewelryDice]);
eq("a legend row keeps its printed fields beside the list", tagged.gemDice.legend[0], { dice: "1d9", avg: "avg. 5", kind: "Zorbs", list: "ornamental" });
eq("the band that is a lot of the list's own kind is marked, in either number, with a note or words between aside",
  Object.fromEntries(Object.entries(tagged.special).map(([k, bands]) => [k, bands.filter((b) => b.keep).map((b) => b.min)])),
  { ornamental: [2], gem: [3], brilliant: [1], trinket: [2], jewelry: [2], regalia: [2] });
check("a band that is not marked carries no keep key", tagged.special.gem.slice(0, 2).every((b) => !("keep" in b)));
eq("a bare count is not a lot of one: dice, a larger count and another list's kind never mark", keepCandidates(
  [band(1, 1, { result: "1d4 zorbs" }), band(2, 2, { result: "2 zorbs" }), band(3, 3, { result: "1,000 zorbs" }), band(4, 4, { result: "1 qux" })], numberForms("Zorb")), []);
eq("a kind known to neither number marks nothing", keepCandidates([band(1, 1, { result: "1 zorb" })], []), []);

const swapped = assembleTreasureTables({ ...lotRaw, gemDiceRaw: legendRaw(["Qux", "Zorbs", "Plims"]) });
eq("a legend row whose caption is the list of another place is left untagged, never guessed", swapped.gemDice.legend.map((r) => r.list), [undefined, undefined, "brilliant"]);
eq("and a list with no tagged row has no keep", swapped.special.ornamental.some((b) => b.keep) || swapped.special.gem.some((b) => b.keep), false);
const unmatched = assembleTreasureTables({ ...lotRaw, jewelryDiceRaw: legendRaw(["Frobs", "Zig", "Snarfs"]) });
eq("a kind no caption names leaves its row untagged and its list without keep", [unmatched.jewelryDice.legend.map((r) => r.list), unmatched.special.jewelry.some((b) => b.keep)], [["trinket", undefined, "regalia"], false]);
eq("why a row is untagged is told by place and caption", [
  legendListOf("Zorbs", LEGEND_LISTS.gemDice, 0, captionKinds(lotRaw)),
  legendListOf("Zorbs", LEGEND_LISTS.gemDice, 1, captionKinds(lotRaw)),
  legendListOf("Zig", LEGEND_LISTS.gemDice, 0, captionKinds(lotRaw)),
  legendListOf("Zorbs", LEGEND_LISTS.gemDice, 0, { ornamental: "Zorb", gem: "Zorbs" }),
], [{ list: "ornamental" }, { why: "position" }, { why: "no-caption" }, { why: "ambiguous" }]);
const noCaption = assembleLegend(legendRaw(["Zorbs"]), { group: LEGEND_LISTS.gemDice, captions: {} });
eq("with no caption read a row is untagged; with no group the legend is as it was", [noCaption[0].list, assembleLegend(legendRaw(["Zorbs"]))[0]], [undefined, { dice: "1d9", avg: "avg. 5", kind: "Zorbs" }]);

const twice = assembleTreasureTables({ ...lotRaw, specialGemRaw: listRaw("Qux", ["1 qux", "1 piece of qux"]) });
eq("two bands naming the kind mark none", twice.special.gem.some((b) => b.keep), false);
eq("a list with none marks none", assembleTreasureTables({ ...lotRaw, specialRegaliaRaw: listRaw("Snarf", ["4d8 wugs", "5 snarf"]) }).special.regalia.some((b) => b.keep), false);
eq("a partial import never throws: no legend, no tag, no keep", assembleTreasureTables({ specialGemRaw: listRaw("Qux", ["1 qux"]) }).special.gem, [band(1, 1, { result: "1 qux" })]);
eq("a kind has both numbers, whichever the page prints", [numberForms("Zorb"), numberForms("Zorbs"), numberForms("Frobbery"), numberForms("Boxes").sort()], [["zorb", "zorbs"], ["zorbs", "zorb"], ["frobbery", "frobberies"], ["box", "boxes"].sort()]);
eq("a caption's kind is what follows per, less the bracketed figure", captionKinds(lotRaw), { ornamental: "Zorb", gem: "Qux", brilliant: "Plim", trinket: "Frob", jewelry: "Wug", regalia: "Snarf" });
eq("the kind forms of a list are its tagged row's and its caption's", kindFormsOf("gem", tagged.gemDice.legend, captionKinds(lotRaw)).sort(), ["qux", "quxes"].sort());

/* --- the raw keys the binding names -------------------------------------------------- */
check("every raw key the binding names has a recipe", [...Object.keys(TYPE_RAW_KEYS), ...Object.keys(VALUE_RAW_KEYS), ...Object.values(SPECIAL_RAW_KEYS).flat()].every((k) => k in tables));

/* --- a table the Treasure Tome replaces ------------------------------------------- */
eq("a bracketed average value is split off without its brackets", [splitTypeHead("Qq (1,234gp)"), splitTypeHead("qq (5 gp)")], [
  { category: "Qq", avgValue: "1,234gp" },
  { category: "Qq", avgValue: "5gp" },
]);
const gritty = assembleTreasureTables({ typeGrittyRaw: { A: { head: "Qq (5gp)", cp: "0% none" } }, typeGrittyUnitsRaw: { units: { cp: "9zz" } } });
eq("the Tome's own grid is assembled beside the other two, with its unit", [Object.keys(gritty.typeGritty), gritty.typeUnits], [["A"], { gritty: { cp: "9zz" } }]);
const grittyRecipe = tables.typeGrittyRaw;
check("the Tome-only grid is optional, reads the Tome and has no overlay", grittyRecipe.optional === true && grittyRecipe.book === "tt" && !grittyRecipe.over);
check("its siblings' shapes are unchanged: Classic and Heroic still read the Journal first", tables.typeClassicRaw.book === "jj" && tables.typeHeroicRaw.book === "jj");
check("the Tome is a book the table recipes read", tableRecipeBooks().has("tt"));
eq("a recipe with an overlay searches both pages", recipeLocates(tables.gemValueRaw).map((l) => [l.id, l.args.book]), [[null, "jj"], ["over", "tt"]]);
eq("a recipe without one searches its own", recipeLocates(grittyRecipe).map((l) => l.id), [null]);
check("a citation is told by its book", citeIsFrom("TT p.19", "tt") && citeIsFrom("JJ p.125; TT p.19-20", "tt") && !citeIsFrom("JJ p.125", "tt") && !citeIsFrom(null, "tt"));

// A fake book: pages of invented runs, found by the phrase each prints.
const fakeBook = (pages) => ({ numPages: 8, pages });
const fakeRead = (doc, p) => Promise.resolve({ items: doc.pages[p] ?? [] });
const jjPage = [run("Qq jj title", 40, 60), run("1", 20, 100), run("jj one", 46, 100), run("2-3", 20, 112), run("jj two", 46, 112)];
const ttPage = [run("Zz tt title", 40, 60), run("1-3", 20, 100), run("tt whole", 46, 100)];
const BAND_OPTS = { column: { xMin: 0, xMax: 300, yMin: 0 }, labelMaxX: 40, cells: [["text", 44, 200]] };
const jjRecipe = { ...bandGrid({ page: 1, locate: "Qq jj title", ...BAND_OPTS }), over: bandGrid({ book: "tt", page: 2, locate: "Zz tt title", ...BAND_OPTS }) };
const jjDoc = fakeBook({ 3: jjPage });
const ttDoc = fakeBook({ 4: ttPage });
const rowsOf = (t) => Object.values(t).map((r) => [r.min, r.max, r.text]);

let got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }], ["tt", { doc: ttDoc }]]), fakeRead);
eq("with the Tome open, its page replaces the Journal's whole", [rowsOf(got.table), got.used === jjRecipe.over, recipeCite(got.used)], [[[1, 3, "tt whole"]], true, "TT p.2"]);

got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }]]), fakeRead);
eq("without the Tome, the Journal is read and the Tome is reported as not open", [rowsOf(got.table), got.used === jjRecipe, got.absent, recipeCite(got.used)], [[[1, 1, "jj one"], [2, 3, "jj two"]], true, "tt", "JJ p.1"]);

got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }]]), fakeRead, "TT p.2");
eq("without the Tome, a table stored under the Tome's citation is kept, not downgraded", [got.kept, got.table, got.absent], [true, undefined, "tt"]);

got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }]]), fakeRead, "JJ p.1");
check("a table stored under the Journal's citation is read again", !!got.table && !got.kept);

got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }], ["tt", { doc: fakeBook({}) }]]), fakeRead, "TT p.2");
eq("with the Tome open but its page not found, a stored Tome table stands", [got.kept, got.table, got.missing], [true, undefined, "page not found"]);

got = await readPlainTable(jjRecipe, new Map([["jj", { doc: jjDoc }], ["tt", { doc: fakeBook({}) }]]), fakeRead);
check("with the Tome open but its page not found and nothing stored, the Journal is read", got.used === jjRecipe && rowsOf(got.table).length === 2);

const tail = { ...jjRecipe, over: { book: "tt", printedPage: 2, locate: "Zz tt title", empty: true } };
got = await readPlainTable(tail, new Map([["jj", { doc: jjDoc }], ["tt", { doc: ttDoc }]]), fakeRead);
eq("a segment the Tome prints in one piece with its neighbour is stored empty, under the Tome's citation", [got.table, recipeCite(got.used)], [{}, "TT p.2"]);
got = await readPlainTable(tail, new Map([["jj", { doc: jjDoc }]]), fakeRead, "TT p.2");
check("and stays stored empty on a seat without the Tome", got.kept === true);

got = await readPlainTable({ ...jjRecipe, over: undefined }, new Map([["tt", { doc: ttDoc }]]), fakeRead);
eq("a recipe with no overlay and no book of its own reports the missing book", [got.noBook, got.table], ["jj", undefined]);

const whole = extractTable(ttPage, jjRecipe.over);
const jjTail = extractTable([run("Qq jj title", 40, 60), run("3", 20, 100), run("jj tail", 46, 100)], jjRecipe);
check("the Tome's whole list beside a Journal tail overlaps, and the binding refuses it", assembleBands([whole, jjTail], read) === null);
check("beside an emptied tail it assembles", assembleBands([whole, {}], read)?.length === 1);

console.log(`test-treasure-binding: ${pass} checks passed.`);
