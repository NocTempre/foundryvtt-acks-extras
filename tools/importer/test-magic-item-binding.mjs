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
  linkBands,
  listCitesOf,
  magicItemPlacement,
} from "../../scripts/importer/magic-item-binding.mjs";
import { itemKey, printKey } from "../../scripts/importer/printed-name.mjs";
import * as services from "../../scripts/lib/services.mjs";
import { PRIORITY, registerTable, resetTables } from "../../scripts/lib/tables.mjs";
import { assembleLegend, assembleSpecialPer, assembleTypeUnits } from "../../scripts/importer/treasure-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });

/* --- the shipped recipes ----------------------------------------------------- */
const merged = TABLE_RECIPES[MAGIC_ITEM_DOC_ID];
eq("the shared recipes are joined into the doc under its id, ahead of any book's", Object.keys(merged.tables).slice(0, Object.keys(MAGIC_ITEM_RECIPES.tables).length), Object.keys(MAGIC_ITEM_RECIPES.tables));
check("every shared table is the shared recipe", Object.entries(MAGIC_ITEM_RECIPES.tables).every(([id, t]) => merged.tables[id] === t));
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

/* --- a book's list map: placement, key sets, hops by id --------------------------- */
// Every caption, name and figure below is made up. The shared recipes stand for
// one book's printing; the invented book `zz` prints its own chain.
const seg = (label, ...rows) => ({ ...(label ? { caption: { label } } : {}), ...Object.fromEntries(rows.map((r, i) => [`b${i}`, r])) });
const one = (item, min = 1, max = 100) => ({ min, max, item });
const inner = (item, min, max, face) => ({ min, max, parent: face, sub: { min, max }, item });
const zz = (alsoKeys = {}) => ({
  zz: {
    magicItemLists: {
      lists: {
        classicType: { hops: "classic", lists: { bands: ["zzTypeRaw"] } },
        classic: { hops: "subtables", lists: { potions: ["zzPotionsRaw"], rings: ["zzRingsRaw"] } },
        subtables: { lists: { potions1: ["zzSub1Raw"], potions2: ["zzSub2Raw"] } },
        scrollSpellLevels: { whole: true, lists: { col1: ["zzLv1Raw"], col2: ["zzLv2Raw"] } },
      },
      alsoKeys,
    },
  },
});
const BLADE = { "classic.swords": [printKey("Zz Blade")] };
const sharedRaw = () => ({
  randomTypeRaw: seg("Qq Kinds", one("Zz Potions", 1, 5), one("Zz Rings", 6, 8), one("Zz Swords", 9, 10)),
  potionsRaw: seg("Zz Potions", one("Shared potion")),
  ringsRaw: seg("Zz Rings", one("Shared ring")),
  swordsRaw: seg("Zz Swords", one("Shared sword")),
});
const zzRaw = () => ({
  zzTypeRaw: seg("Qq Kinds", one("Zz Draughts", 1, 5), one("Zz Rings", 6, 8), one("Zz Blade", 9, 10)),
  zzPotionsRaw: seg("Zz Draughts", one("Zz Draughts One", 1, 9), inner("Zz Draughts Two", 1, 50, 10), inner("Zz Draughts One", 51, 100, 10)),
  zzSub1Raw: seg("Zz Draughts One", one("Item a")),
  zzSub2Raw: seg("Zz Draughts Two", one("Item b")),
});
const place = (raw, books = zz(BLADE)) => magicItemPlacement(raw, { books });

{
  const p = place({ ...sharedRaw(), ...zzRaw() });
  eq("a placed book list replaces the shared list under its id, a tail's inner bands carrying their own hop", p.engine.classic.potions, [
    { min: 1, max: 9, item: "Zz Draughts One", hop: "subtables.potions1" },
    { min: 10, max: 10, hop: null, sub: [{ min: 1, max: 50, item: "Zz Draughts Two", hop: "subtables.potions2" }, { min: 51, max: 100, item: "Zz Draughts One", hop: "subtables.potions1" }] },
  ]);
  eq("the book's subtables are an engine table of their own", Object.keys(p.engine.subtables).sort(), ["potions1", "potions2"]);
  eq("a shared list the book's list does not replace stands, with no hop on it", [p.engine.classic.swords, p.engine.classic.rings], [[{ min: 1, max: 100, item: "Shared sword" }], [{ min: 1, max: 100, item: "Shared ring" }]]);
  eq("a book list whose pages were not read is not reported", p.unplaced, []);
  eq("the book's type list places once its hops resolve, into a book's list and a shared one", p.engine.classicType.bands.map((b) => b.hop), ["classic.potions", "classic.rings", "classic.swords"]);
  eq("the placed type list is the book's", p.engine.classicType.bands.map((b) => b.item), ["Zz Draughts", "Zz Rings", "Zz Blade"]);
  eq("a caption and a cite follow the list that stands", [p.engine.captions["classic.potions"], p.engine.captions["classic.rings"], p.keysOf["classic.potions"], p.keysOf["classic.rings"]], ["Zz Draughts", "Zz Rings", ["zzPotionsRaw"], ["ringsRaw"]]);
  eq("listCites read the standing lists' own raw segments", listCitesOf({ zzPotionsRaw: "ZZ p.5", potionsRaw: "XX p.9", ringsRaw: "XX p.8" }, p.keysOf)["classic.potions"], "ZZ p.5");
}
{
  // A hop names an id by every caption either book prints for it, so the shared
  // type list still reaches the id the book's potions list replaced.
  const raw = { ...sharedRaw(), ...zzRaw() };
  delete raw.zzTypeRaw;
  const p = place(raw);
  eq("a shared type list keeps its hop into an id whose list the book replaced", p.engine.classicType.bands.map((b) => b.hop), ["classic.potions", "classic.rings", "classic.swords"]);
  check("and that id holds the book's list", Array.isArray(p.engine.classic.potions[1].sub));
  eq("a book's type list reaches the id a shared list still stands under", place({ ...sharedRaw(), ...zzRaw() }).engine.classicType.bands[1].hop, "classic.rings");
}
{
  const p = place({ ...sharedRaw(), ...zzRaw() }, zz());
  eq("a spelling no caption or hashed key names has no hop, so the book's type list waits", [p.unplaced, p.engine.classicType.bands.map((b) => b.item)], [["classicType.bands"], ["Zz Potions", "Zz Rings", "Zz Swords"]]);
}
{
  // A hop never leaves its declared table: a row naming a classic caption is no subtable.
  const p = place({ ...sharedRaw(), zzRingsRaw: seg("Zz Rings", one("Zz Rings")), zzSub1Raw: seg("Zz Draughts One", one("Item a")) });
  eq("a row naming a caption of another tier does not resolve, and its list is not placed", [p.unplaced, p.engine.classic.rings[0].item], [["classic.rings"], "Shared ring"]);
}
{
  // A key two ids share is no hop, so the list that names it waits.
  const p = place({ ...sharedRaw(), ...zzRaw(), zzSub2Raw: seg("Zz Draughts One", one("Item b")) });
  eq("a key shared by two ids is no hop and the list is not placed", [p.unplaced, p.engine.classic.potions[0].item], [["classic.potions"], "Shared potion"]);
}
{
  const p = place({ ...sharedRaw(), zzPotionsRaw: zzRaw().zzPotionsRaw });
  eq("a list waits for the subtables it names, and the shared list stands", [p.unplaced, p.engine.classic.potions], [["classic.potions"], [{ min: 1, max: 100, item: "Shared potion" }]]);
}
{
  const lv = (n) => seg(null, one(n, 1, 100));
  const shared = { ...sharedRaw(), spellLevel1Raw: lv("1"), spellLevel2Raw: lv("2"), spellLevel3Raw: lv("3") };
  const whole = place({ ...shared, zzLv1Raw: lv("4"), zzLv2Raw: lv("5") });
  eq("a whole grid replaces every column of the shared table", Object.keys(whole.engine.scrollSpellLevels).sort(), ["col1", "col2"]);
  const part = place({ ...shared, zzLv1Raw: lv("4"), zzLv2Raw: seg(null, one("5", 1, 100), one("6", 102, 110)) });
  eq("a grid with a list that does not tile replaces none", [Object.keys(part.engine.scrollSpellLevels).sort(), part.unplaced], [["col1", "col2", "col3"], ["scrollSpellLevels.col1", "scrollSpellLevels.col2"]]);
}
/* --- ref: a row linked to its own book's entry ---------------------------------------- */
{
  const raw = { ...sharedRaw(), ...zzRaw() };
  const idx = { zz: { [itemKey("Item a")]: "zz.item1", [itemKey("Item b")]: null }, jj: { [itemKey("Shared ring")]: "jj.item4", [itemKey("Item a")]: "jj.item9" } };
  const cites = { ringsRaw: "JJ p.8", potionsRaw: "JJ p.9", swordsRaw: "JJ p.10", zzSub1Raw: "ZZ p.1" };
  const p = magicItemPlacement(raw, { books: zz(BLADE), keys: idx, cites });
  eq("a placed book's subtable row links to that book's entry", p.engine.subtables.potions1, [{ min: 1, max: 100, item: "Item a", ref: "zz.item1" }]);
  eq("a key the book's entries share (null) gives a null ref", p.engine.subtables.potions2, [{ min: 1, max: 100, item: "Item b", ref: null }]);
  eq("a shared list's row links within the book its cite names, not another book that holds the key", [p.engine.classic.rings[0].ref, p.engine.classic.swords[0].ref], ["jj.item4", null]);
  check("a hopping list's rows, the type list's and a tail's outer face carry no ref", p.engine.classic.potions.every((b) => !("ref" in b)) && p.engine.classicType.bands.every((b) => !("ref" in b)));
  check("a tail's inner bands of a hopping list carry no ref", p.engine.classic.potions[1].sub.every((s) => !("ref" in s)));
  check("a row's own book decides: the same words in the other book's index do not link a placed list", p.engine.subtables.potions1[0].ref !== "jj.item9");
  const none = magicItemPlacement(raw, { books: zz(BLADE) });
  check("with no keys passed no row is linked at all", JSON.stringify(none.engine).indexOf("\"ref\"") === -1);
}
{
  const bands = [{ min: 1, max: 3, item: "Zz Alpha [ab]" }, { min: 4, max: 4, sub: [{ min: 1, max: 5, item: "Zz Beta" }, { min: 6, max: 9 }] }];
  const linked = linkBands(bands, { [itemKey("Zz Alpha")]: "zz.item3", [itemKey("Zz Beta")]: "zz.item4" });
  eq("a row's bracketed marker is dropped from its key; inner bands are linked; a tail's outer band is not", linked, [
    { min: 1, max: 3, item: "Zz Alpha [ab]", ref: "zz.item3" },
    { min: 4, max: 4, sub: [{ min: 1, max: 5, item: "Zz Beta", ref: "zz.item4" }, { min: 6, max: 9, ref: null }] },
  ]);
  eq("an index with no entry for a row gives null, and a key such as 'constructor' is never inherited", linkBands([{ min: 1, max: 1, item: "constructor" }], {}), [{ min: 1, max: 1, item: "constructor", ref: null }]);
}
{
  // applyMagicItemImport links through the keys it is handed.
  resetTables();
  const imported = [];
  services.register("ruledata-import", { importDoc: async (d) => imported.push(d) });
  registerTable({ id: MAGIC_ITEM_DOC_ID, cites: { ringsRaw: "JJ p.8" }, tables: sharedRaw() }, { priority: PRIORITY.WORLD });
  await applyMagicItemImport({ keys: { jj: { [itemKey("Shared ring")]: "jj.item4" } } });
  eq("the import writes the linked ref into the assembled tables", imported.at(-1).tables.classic.rings[0].ref, "jj.item4");
  await applyMagicItemImport();
  eq("an import with no keys links nothing", imported.at(-1).tables.classic.rings[0].ref, undefined);
  services.resetServices();
  resetTables();
}
eq("no book's map: no list is unplaced and no subtables table", [place(sharedRaw(), {}).unplaced, "subtables" in place(sharedRaw(), {}).engine], [[], false]);
check("PRODUCES carries the engine tables the Journal's lists make", Object.keys(PRODUCES[MAGIC_ITEM_DOC_ID]).includes("classicType"));

console.log(`test-magic-item-binding: ${pass} checks passed.`);
