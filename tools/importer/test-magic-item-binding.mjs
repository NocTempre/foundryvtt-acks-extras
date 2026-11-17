/**
 * The magic-item tables' recipes and assembler on invented pages: no book is
 * read, and every caption, name and figure here is made up. The list builder
 * runs on runs laid out the way the printed lists are set (a small-capital
 * initial as a lone lower-case run, an outer face beside the middle of a tail's
 * inner bands, alone on a row between them, or repeated beside every one); the
 * binding joins segments, nests the tails, tiles the bands, matches a row's
 * words to a caption and refuses a lost row; and the shipped recipes are held
 * to the anchor rule (no printed figure in one). `check-magic-item-tables.mjs`
 * reads the real pages.
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { MAGIC_ITEM_RECIPES, list, settingGrid } from "../../scripts/importer/table-recipes-magic-items.mjs";
import {
  ARMS_RAW_KEYS,
  LISTS,
  MAGIC_ITEM_DOC_ID,
  PRODUCES,
  assembleArms,
  assembleMagicItemTables,
  assembleNested,
  assembleSettings,
  bandOf,
  captionKeys,
  applyMagicItemImport,
  hopOf,
  listCitesOf,
} from "../../scripts/importer/magic-item-binding.mjs";
import * as services from "../../scripts/lib/services.mjs";
import { PRIORITY, registerTable, resetTables } from "../../scripts/lib/tables.mjs";
import { assembleLegend, assembleSpecialPer, assembleTypeUnits } from "../../scripts/importer/treasure-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });

/* --- the shipped recipes ----------------------------------------------------- */
eq("the doc is joined into the recipes under its id", TABLE_RECIPES[MAGIC_ITEM_DOC_ID], MAGIC_ITEM_RECIPES);
const tables = MAGIC_ITEM_RECIPES.tables;
for (const [id, recipe] of Object.entries(tables)) {
  const anchors = [recipe.locate, recipe.startAfter, recipe.stopAt, recipe.locateKey, recipe.locateHeadingKey].filter((a) => a != null);
  check(`${id}: names a page by a phrase`, !!recipe.locate);
  check(`${id}: no anchor holds a figure`, anchors.every((a) => !/\d/.test(a)));
  check(`${id}: reads the Judges Journal`, recipe.book === "jj");
  if (recipe.over) {
    const over = recipe.over;
    check(`${id}: its overlay reads the Treasure Tome`, over.book === "tt");
    check(`${id}: its overlay names a page by a phrase with no figure in it`, !!over.locate && !/\d/.test(over.locate));
    check(`${id}: its overlay is a whole recipe`, over.shape === "gridRows" && !!over.rows && !!over.cellColumns && Number.isFinite(over.printedPage));
  }
}
check("every raw key the binding names has a recipe", [...Object.values(LISTS).flatMap((c) => Object.values(c).flat()), ...Object.values(ARMS_RAW_KEYS)].every((k) => k in tables));
check("a table's raw keys are all produced", Object.keys(PRODUCES[MAGIC_ITEM_DOC_ID]).includes("classicType"));

/* --- a list laid out as printed ---------------------------------------------- */
const grid = list({ page: 1, locate: "Qq", column: { xMin: 0, xMax: 600, yMin: 0 }, labelMaxX: 95, cells: [["item", 100, 200], ["cues", 320, 200]], caption: true });
const page = (rows) => rows.flat();
const base = [
  run("Qqq Caption", 40, 80, 60),
  run("roll d9", 60, 92),
  run("1-50", 62, 100, 20), run("a", 100, 100, 5), run("lpha one", 105, 100, 40), run("sweet, odd", 320, 100),
  run("51-99", 62, 112, 20), run("Beta two", 100, 112, 40),
];
const rowsOf = (extra) => Object.values(extractTable(page([base, extra]), grid));
const fieldsOf = (rows) => rows.filter((r) => r.min != null).map(({ min, max, item, cues, parent, sub }) => ({ min, max, item, ...(cues ? { cues } : {}), ...(parent ? { parent, sub } : {}) }));

eq("a caption is read as data and a small capital rises", rowsOf([]).slice(0, 3).map((r) => r.label ?? r.item), ["Qqq Caption", "Alpha one", "Beta two"]);
eq("the header above the first row is not a wrapped line of it", rowsOf([])[1].item, "Alpha one");

// Shape A: the outer face beside the middle inner band.
const shapeA = [
  run("1-33", 66, 124, 20), run("Gamma", 100, 124),
  run("100", 40, 136, 15), run("34-66", 62, 136, 25), run("Delta", 100, 136),
  run("67-100", 60, 148, 28), run("Epsilon", 100, 148),
];
eq("an outer face beside the middle inner band reads as one nested band", assembleNested([extractTable(page([base, shapeA]), grid)]).at(-1), { min: 100, max: 100, sub: [{ min: 1, max: 33, item: "Gamma" }, { min: 34, max: 66, item: "Delta" }, { min: 67, max: 100, item: "Epsilon" }] });
check("the main bands before the tail tile from 1", assembleNested([extractTable(page([base, shapeA]), grid)]).slice(0, 2).every((b) => b.sub === undefined));
check("a label read gap-aware keeps the face and the band two numbers", fieldsOf(rowsOf(shapeA)).some((r) => r.parent === 100 && r.sub.min === 34 && r.sub.max === 66));

// Shape B: the outer face alone on a row between two inner bands.
const shapeB = [
  run("1-50", 66, 124, 20), run("Gamma", 100, 124),
  run("100", 40, 131, 15),
  run("51-100", 60, 138, 28), run("Delta", 100, 138),
];
eq("an outer face on a row of its own joins the group around it", assembleNested([extractTable(page([base, shapeB]), grid)]).at(-1), { min: 100, max: 100, sub: [{ min: 1, max: 50, item: "Gamma" }, { min: 51, max: 100, item: "Delta" }] });

// Shape C: the outer face repeated beside every inner band, and two faces.
const shapeC = [
  run("100", 40, 124, 15), run("1-50", 66, 124, 20), run("Gamma", 100, 124),
  run("100", 40, 136, 15), run("51-100", 60, 136, 28), run("Delta", 100, 136),
];
eq("a face beside every inner band is one group", assembleNested([extractTable(page([base, shapeC]), grid)]).at(-1).sub.length, 2);
eq("a printed face that is not the one the order gives refuses the table", assembleNested([{
  b0: { min: 1, max: 9, item: "Aa" },
  b1: { min: 10, max: 10, parent: 11, sub: { min: 1, max: 100 }, item: "Bb" },
}]), null);
eq("bands that leave a gap are refused", assembleNested([{ b0: { min: 1, max: 4, item: "Aa" }, b1: { min: 6, max: 9, item: "Bb" } }]), null);
eq("nothing read assembles nothing", assembleNested([{}]), null);
check("a single face with inner bands that do not restart is refused", assembleNested([{ b0: { min: 1, max: 9, item: "Aa" }, b1: { min: 1, max: 40, item: "Bb" }, b2: { min: 42, max: 100, item: "Cc" } }]) === null);
eq("the cells of the first row read in their windows", fieldsOf(rowsOf([]))[0], { min: 1, max: 50, item: "Alpha one", cues: "sweet, odd" });

/* --- hops -------------------------------------------------------------------- */
const raw = {
  randomTypeRaw: { caption: { label: "Qq Kinds" }, b0: { min: 1, max: 6, item: "Zz Potions" }, b1: { min: 7, max: 9, item: "Zz Rings" }, b2: { min: 10, max: 10, item: "Zz Sundries" } },
  potionsRaw: { caption: { label: "Zz Potions" }, b0: { min: 1, max: 100, item: "Aa" } },
  ringsRaw: { caption: { label: "ZZ  rings" }, b0: { min: 1, max: 100, item: "Bb" } },
  scrollsRaw: { caption: { label: "Zz Rings" }, b0: { min: 1, max: 100, item: "Cc" } },
  heroicCommonRaw: { caption: { label: "Common Zz" }, b0: { min: 1, max: 20, item: "Dd" } },
};
const made = assembleMagicItemTables(raw);
eq("a row naming one caption hops to that list", made.classicType.bands[0].hop, "classic.potions");
eq("a row naming two captions has no hop", made.classicType.bands[1].hop, null);
eq("a row naming no caption has no hop", made.classicType.bands[2].hop, null);
eq("the captions are kept as printed, by list", made.captions["classic.potions"], "Zz Potions");
eq("hopOf folds case, spacing and punctuation", hopOf("zz-POTIONS", captionKeys(raw)), "classic.potions");
eq("the lists a page held assemble and the rest are left out", Object.keys(made).sort(), ["captions", "classic", "classicType", "heroic"]);

/* --- per-list cites ---------------------------------------------------------- */
const segCites = { randomTypeRaw: "ZZ p.5", potionsRaw: "ZZ p.7", potionsMoreRaw: "ZZ p.8", ringsRaw: "ZZ p.8", scrollsRaw: "ZZ p.6; TT p.40", scrollsMoreRaw: "TT p.41" };
const listCites = listCitesOf(segCites);
eq("a list's cite is its segments' pages joined", listCites["classic.potions"], "ZZ p.7-8");
eq("a list's cite is its own, not its table's", [listCites["classic.rings"], listCites["classicType.bands"]], ["ZZ p.8", "ZZ p.5"]);
eq("each book's pages merge once", listCites["classic.scrolls"], "ZZ p.6; TT p.40-41");
eq("a list whose segments carry no cite is left out", "classic.misc" in listCites, false);
eq("no cites, no list cites", listCitesOf(), {});
check("PRODUCES names the per-list cites beside the captions", PRODUCES[MAGIC_ITEM_DOC_ID].listCites.includes("potionsMoreRaw") && "captions" in PRODUCES[MAGIC_ITEM_DOC_ID]);

{
  // The import writes the per-list cites into the document beside the assembled tables.
  let written = null;
  services.register("ruledata-import", { importDoc: async (doc) => { written = doc; } });
  resetTables();
  registerTable({ id: MAGIC_ITEM_DOC_ID, source: { book: "test" }, cites: { potionsRaw: "ZZ p.7", ringsRaw: "ZZ p.8" }, tables: raw }, { priority: PRIORITY.WORLD });
  await applyMagicItemImport();
  eq("the import writes listCites beside the assembled tables", written.tables.listCites, { "classic.potions": "ZZ p.7", "classic.rings": "ZZ p.8" });
  check("the raw tables stay beside them", written.tables.potionsRaw != null && written.tables.classic != null);
  resetTables();
}

/* --- arms grids -------------------------------------------------------------- */
const armsRaw = {
  head1: Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((s, i) => [s, `Qq${i}`])),
  head2: Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((s, i) => [s, `Zz${i}`])),
  r0: { label: "Aa", ...Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((s) => [s, "1-12"])) },
  r1: { label: "Bb", ...Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((s) => [s, "13-20"])) },
};
eq("an arms grid is one band list per setting column", assembleArms(armsRaw).s1, [{ min: 1, max: 12, type: "Aa" }, { min: 13, max: 20, type: "Bb" }]);
eq("a dash is no band, so a column that loses its last band ends early", assembleArms({ ...armsRaw, r1: { ...armsRaw.r1, s3: "-" } }).s3, [{ min: 1, max: 12, type: "Aa" }]);
eq("a column that does not start at 1 is refused", assembleArms({ ...armsRaw, r0: { ...armsRaw.r0, s2: "-" } }), null);
eq("the two header lines read as one setting name per column", assembleSettings({ armorTypeRaw: armsRaw }).s4, "Qq3 Zz3");
eq("a single number is a band of one", bandOf("7"), { min: 7, max: 7 });
eq("a dash is no band cell", bandOf("-"), null);

/* --- the treasure doc's additions -------------------------------------------- */
eq("a special list's lot unit is what follows its caption's 'per'", assembleSpecialPer({ specialCpRaw: { caption: { label: "Special Treasure per Qq (9zz)" } } }), { cp: "Qq (9zz)" });
eq("no caption read leaves no unit", assembleSpecialPer({ specialCpRaw: {} }), null);
eq("the unit under each coin column is kept as printed", assembleTypeUnits({ typeClassicUnitsRaw: { units: { cp: "9zz", sp: "9zz" } } }), { classic: { cp: "9zz", sp: "9zz" } });
eq("a legend row is its dice, its average and its kind", assembleLegend({ d0: { label: "9d9", avg: "avg. 5", type: "Qq" }, d1: { __missing: true } }), [{ dice: "9d9", avg: "avg. 5", kind: "Qq" }]);

console.log(`test-magic-item-binding: ${pass} checks passed.`);
