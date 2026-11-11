/**
 * The weapon lists: what `weapon-binding.mjs` reads out of its prose windows
 * into the `weaponLists` tables, and how `lib/weapons.mjs` resolves the
 * weapons grid's rows against them.
 *
 * Every noun, die and name here is INVENTED, shaped like the prose without
 * being any page's; the category tokens are invented too, so no list of the
 * book's options is reproduced. No value is read off a book.
 */
import assert from "node:assert";
import {
  WEAPON_PROSE_DOC_ID, WEAPON_LISTS_DOC_ID, PRODUCES, applyWeaponListsImport, assembleWeaponLists, assembleCategory,
  categoryOf, parseDealtBy, parseFocus, parseNouns, parseOptions, parseThrowable, parseTwoHands,
} from "../scripts/importer/weapon-binding.mjs";
import { WEAPON_LISTS_DOC, WEAPON_LIST_TABLES, resolveRows, weaponLists } from "../scripts/lib/weapons.mjs";
import { registerTable, unregisterTable, resetTables, expectedTables, PRIORITY } from "../scripts/lib/tables.mjs";
import * as services from "../scripts/lib/services.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

// The tokens the options are placed on: invented, with the catch-all under OTHER.
const TOKENS = Object.freeze({ ZORK: "zork", BLORP_FLIB: "blorpFlib", OTHER: "other" });
// The page marks a damage type by one icon glyph in the private-use area.
const FIRE = String.fromCodePoint(0xe906);
const LIGHT = String.fromCodePoint(0xe907);

/* ------------------------------ parsers ------------------------------ */

eq("a list splits at commas, slashes, and, or", parseNouns("zorks/ blorps and flibs, or any quuxes"), ["zorks", "blorps", "flibs", "quuxes"]);
eq("a number word or a figure names no kind", [parseNouns("any four weapons"), parseNouns("any combination of 3 gizmos")], [[], []]);
eq("a trailing generic word is dropped", parseNouns("hurled weapons"), ["hurled"]);
eq("a line-wrap hyphen is closed", parseNouns("snarf- blorps"), ["snarf-blorps"]);
eq("a long run is no noun", parseNouns("one two three four five"), []);
eq("a noun is kept once", parseNouns("zorks, zorks"), ["zorks"]);

eq(
  "options are cut at their marker and at the end of the last one",
  parseOptions("preface words: (i) any zorks; (ii) any blorps and flibs; (iii) any combination of 3 gizmos fighting value table"),
  [["zorks"], ["blorps", "flibs"], []],
);
eq(
  "options may be numbered, and the rule after the last stays out",
  parseOptions("pick: (1) zorks; (2) blorps/flibs; (3) any four weapons. when selecting option 3, a quux needs a zork."),
  [["zorks"], ["blorps", "flibs"], []],
);

eq("a noun is placed on the token whose own name holds its word", [categoryOf("zorks", TOKENS), categoryOf("flib", TOKENS), categoryOf("blorps", TOKENS)], ["zork", "blorpFlib", "blorpFlib"]);
eq("a noun no token names is the catch-all", [categoryOf("quuxes", TOKENS), categoryOf("snarf-blorps", TOKENS)], ["other", "other"]);
eq(
  "the category table holds each noun once under its token",
  assembleCategory([["zorks", "quuxes"], ["flibs", "zorks", "quuxes"]], TOKENS),
  { zork: ["zorks"], other: ["quuxes"], blorpFlib: ["flibs"] },
);

eq(
  "a focus is keyed by its nouns folded together",
  parseFocus(": zorks; blorps, flibs and quuxes; hurled weapons. nothing more; zorks"),
  { zorks: ["zorks"], blorpsflibsquuxes: ["blorps", "flibs", "quuxes"], hurled: ["hurled"] },
);
eq("a window with no list reads no focus", parseFocus(""), {});

eq("the weapons a type is dealt by stop at the words that end the list", parseDealtBy("gooey force. gooey damage can be dealt by zorks, blorps, and so on, or by spells. next: more"), ["zorks", "blorps"]);
eq("the same with the other ending", parseDealtBy("sticky. sticky damage is dealt by quuxes, flibs, and similar weapons and by some spells. next"), ["quuxes", "flibs"]);
eq("no list, no weapons", parseDealtBy("sticky. nothing is said"), []);

eq("a throwable reads its die and the icon's type", parseThrowable(`1d9 ${FIRE} damage to the creature immediately, and another 1d9 ${FIRE} damage next round. later 2d2`), { damage: "1d9", types: ["fire"] });
eq("a sentence that points to the oil's rules takes its die", parseThrowable(`${LIGHT} damage to the lawful things following the same rules as burning oil, but harmless to others. (other ${FIRE} damage 4d4.)`, "1d9"), { damage: "1d9", types: ["luminous"] });
eq("no die and no pointer, no damage", parseThrowable(`${LIGHT} damage to the lawful things. more`, "1d9"), { types: ["luminous"] });
eq("the word extraordinary is read where the printing spells it", parseThrowable(`1d3 extraordinary ${FIRE} damage to it. more`).extraordinary, true);
eq("a printing that marks it only by colour leaves it absent", "extraordinary" in parseThrowable(`1d3 ${FIRE} damage to it. more`), false);
eq("nothing in the window, nothing read", parseThrowable("nothing"), {});

const entries =
  "all kits come in a box. zork, grand: a big zork, requiring two hands to use. old names include the zorks. blorp: usable with one or two hands. " +
  "flib: flibs are two-handed things. quux: if used mounted with two hands, a quux can reach. snarf, long-reach: these require two hands when braced.";
eq("an entry that says it needs both hands is named as the grid names it", parseTwoHands(entries), ["grand zork", "flib", "long-reach snarf"]);
eq("a grip among several, or a conditional one, is no such need", parseTwoHands("blorp: usable with one or two hands. quux: if used mounted with two hands, it reaches."), []);
eq("a page that begins on an entry keeps its head", parseTwoHands("flib: flibs are two-handed things. blorp: usable with one hand."), ["flib"]);

/* ------------------------------ assembly ------------------------------ */

const raw = {
  martialProse: { options: "pick: (1) zorks; (2) blorps/flibs; (3) any four weapons. more" },
  narrowProse: { options: ": (i) any zorks; (ii) any quuxes and flibs; (iii) any combination of 3 gizmos" },
  focusProse: { list: ": zorks; blorps and flibs. more" },
  damageTypeProse: { gooey: "x. gooey damage can be dealt by zorks, and so on. y", sticky: "x. sticky damage is dealt by quuxes, and similar weapons. y", fire: "x. fire damage can be dealt by natural heat. y" },
  throwableProse: { oil: `1d9 ${FIRE} damage. more`, holyWater: `${LIGHT} damage following the same rules as burning oil, but. more`, torch: `1d2 ${FIRE} damage. more` },
  twoHandsFirst: { entries },
  twoHandsSecond: { entries: "bar, wide: a bar requires two hands. more" },
};
const lists = assembleWeaponLists(raw, TOKENS);
eq("the category table joins both books' options", lists.category, { zork: ["zorks"], blorpFlib: ["blorps", "flibs"], other: ["quuxes"] });
eq("the focus table is read", lists.focus, { zorks: ["zorks"], blorpsflibs: ["blorps", "flibs"] });
eq("only a type the module names is read, with the weapons it is dealt by", lists.damageType, { fire: ["natural heat"] });
eq("a throwable assembles from its window", lists.throwables, { oil: { damage: "1d9", types: ["fire"] }, holyWater: { damage: "1d9", types: ["luminous"] }, torch: { damage: "1d2", types: ["fire"] } });
eq("the weapons that need both hands are read from both folios", lists.twoHands, ["grand zork", "flib", "long-reach snarf", "wide bar"]);
eq("a window that did not read costs only its list", Object.keys(assembleWeaponLists({ ...raw, focusProse: {}, twoHandsFirst: {}, twoHandsSecond: {} }, TOKENS)).sort(), ["category", "damageType", "throwables"]);
eq("nothing read, nothing assembled", assembleWeaponLists({}, TOKENS), {});

/* ------------------------------ wiring ------------------------------ */

eq("the binding answers for lib's lists document", WEAPON_LISTS_DOC_ID, WEAPON_LISTS_DOC);
eq("every list table lib declares is produced, from a raw table the recipes read", Object.keys(PRODUCES[WEAPON_LISTS_DOC]).sort(), [...WEAPON_LIST_TABLES].sort());
check(
  "each raw table a list is read from is a recipe of the prose document",
  Object.values(PRODUCES[WEAPON_LISTS_DOC]).flat().every((id) => !!TABLE_RECIPES[WEAPON_PROSE_DOC_ID].tables[id]),
);
const windowKeys = (id) => TABLE_RECIPES[WEAPON_PROSE_DOC_ID].tables[id].values.map((v) => v.key);
eq("the recipes read the windows the binding parses", {
  options: [windowKeys("martialProse"), windowKeys("narrowProse")],
  list: windowKeys("focusProse"),
  first: windowKeys("twoHandsFirst"),
  second: windowKeys("twoHandsSecond"),
  throwables: windowKeys("throwableProse"),
}, { options: [["options"], ["options"]], list: ["list"], first: ["entries"], second: ["entries"], throwables: ["oil", "holyWater", "torch"] });
check("every window is a window take", Object.values(TABLE_RECIPES[WEAPON_PROSE_DOC_ID].tables).every((t) => t.values.every((v) => v.take === "window")));
check("lib declares the tables it reads", expectedTables().some((e) => e.docId === WEAPON_LISTS_DOC && e.tableIds.join() === WEAPON_LIST_TABLES.join()));
check("no import service, nothing assembled", (await applyWeaponListsImport()).assembled.length === 0);

{
  const imported = [];
  services.register("ruledata-import", { importDoc: async (doc, opts) => imported.push({ doc, opts }) });
  eq("no raw document, nothing assembled", (await applyWeaponListsImport()).assembled, []);
  registerTable(
    { id: WEAPON_PROSE_DOC_ID, source: { book: "x" }, cites: { martialProse: "RR p.9", narrowProse: "JJ p.3", focusProse: "RR p.12", twoHandsFirst: "RR p.30", twoHandsSecond: "RR p.31" }, tables: { ...raw } },
    { priority: PRIORITY.WORLD },
  );
  const got = await applyWeaponListsImport();
  check("the lists are registered as their own document", imported.length === 1 && imported[0].doc.id === WEAPON_LISTS_DOC && imported[0].opts.priority === PRIORITY.WORLD);
  eq("the document holds the lists and nothing raw", Object.keys(imported[0].doc.tables).sort(), got.assembled.sort());
  eq("a list cites the pages of the raw tables it was read from", [imported[0].doc.cites.category, imported[0].doc.cites.twoHands, imported[0].doc.cites.focus], ["RR p.9; JJ p.3", "RR p.30-31", "RR p.12"]);
  check("no raw table's cite is carried over", !("martialProse" in imported[0].doc.cites));
  services.resetServices();
  unregisterTable(WEAPON_PROSE_DOC_ID);
}

/* ------------------------------ the resolver ------------------------------ */

const L = {
  category: { zork: ["zorks"], blorpFlib: ["blorps", "flibs"], other: ["quuxes"] },
  focus: { zorksblorps: ["zorks", "blorps"], flibs: ["flibs"] },
  damageType: { gooey: ["zorks"], sticky: ["quuxes"] },
  throwables: { oil: { damage: "1d9", types: ["fire"] }, holyWater: { damage: "1d9", types: ["luminous"] }, torch: { damage: "1d2", types: ["fire"] } },
  twoHands: ["grand zork"],
};
const grid = {
  zork: { name: "Zork", block: "Gizmos", cite: "p.1" },
  grandzork: { name: "Grand Zork", block: "Gizmos" },
  flib: { name: "Flib", block: "Whatnots" },
  blorp: { name: "Blorp", block: null },
  snarf: { name: "Snarf", block: "Zorks/blorps" },
  thing: { name: "Thing", block: "Quuxes" },
  orphan: { name: "Orphan", block: null },
  both: { name: "Zork Flib", block: "Quuxes" },
  oil: { name: "Burning Oil", block: "Gizmos" },
};
const out = resolveRows(grid, L);
const of = (k) => [out[k].category, out[k].focus, out[k].damageType, out[k].twoHands];
eq("a name places a row, plural or singular", of("zork"), ["zork", "zorksblorps", "gooey", null]);
eq("a run of the name's words places it", of("grandzork"), ["zork", "zorksblorps", "gooey", true]);
eq("each facet is placed on its own", of("flib"), ["blorpFlib", "flibs", null, null]);
eq("a name with no block is placed by the name", of("blorp"), ["blorpFlib", "zorksblorps", null, null]);
eq("a block that names two kinds places nothing for that facet, and one kind where it names one", of("snarf"), [null, "zorksblorps", "gooey", null]);
eq("a block places a row whose name places nothing", of("thing"), ["other", null, "sticky", null]);
eq("a row nothing places stays unplaced", of("orphan"), [null, null, null, null]);
eq("a name naming two kinds places nothing, and the block is not asked", [out.both.category, out.both.placedBy.category], [null, null]);
eq("while a facet the name places once is placed", [out.both.damageType, out.both.placedBy.damageType], ["gooey", "name"]);
eq("the placements say what placed them", [out.zork.placedBy, out.snarf.placedBy, out.orphan.placedBy], [
  { category: "name", focus: "name", damageType: "name" },
  { category: null, focus: "block", damageType: "block" },
  { category: null, focus: null, damageType: null },
]);
eq("the row's own figures ride through", [out.zork.name, out.zork.block, out.zork.cite], ["Zork", "Gizmos", "p.1"]);
check("the grid is not changed", !("category" in grid.zork));

eq("a throwable enriches the row of its name and types it", [out.oil.throwable, out.oil.damageType, out.oil.placedBy.damageType], [{ kind: "oil", damage: "1d9", types: ["fire"] }, "fire", "throwable"]);
eq("a throwable no row names is a kind row of its own", [out.holywater.kind, out.holywater.name, out.holywater.damage, out.holywater.types, out.holywater.damageType], ["holyWater", "", "1d9", ["luminous"], "luminous"]);
check("and the torch likewise", out.torch.kind === "torch" && out.torch.damage === "1d2");
eq("the kind rows are the only additions", Object.keys(out).sort(), [...Object.keys(grid), "holywater", "torch"].sort());

const named = resolveRows({ ...grid, holy: { name: "Holy Water", block: null } }, L);
check("a row named for a throwable is enriched, and no kind row is added beside it", named.holy.throwable.kind === "holyWater" && !("holywater" in named));

check("the same grid and lists answer once", resolveRows(grid, L) === out);
check("another lists object answers afresh", resolveRows(grid, { ...L }) !== out);
const bare = resolveRows(grid, null);
check("no lists, nothing placed and no kind rows", Object.keys(bare).length === Object.keys(grid).length && Object.values(bare).every((r) => r.category === null && r.focus === null && r.damageType === null && r.twoHands === null));
check("and the same answer again", resolveRows(grid, null) === bare && resolveRows(grid, undefined) === bare);
eq("no grid, no rows", [resolveRows(null, L), resolveRows(undefined, L)], [{}, {}]);
{
  const odd = resolveRows({ zork: grid.zork }, { category: ["zorks"], focus: "zorks", damageType: 3, throwables: { oil: null }, twoHands: "grand zork" }).zork;
  eq("a malformed list is read as no list", [odd.category, odd.focus, odd.damageType, odd.twoHands], [null, null, null, null]);
}

/* ------------------------------ the registry read ------------------------------ */

resetTables();
eq("nothing registered, no lists", weaponLists(), null);
registerTable({ id: WEAPON_LISTS_DOC, tables: { category: L.category, focus: L.focus } }, { priority: PRIORITY.WORLD });
const first = weaponLists();
eq("the imported lists are read", Object.keys(first).sort(), ["category", "focus"]);
check("the same object comes back until a layer changes", weaponLists() === first);
registerTable({ id: WEAPON_LISTS_DOC, tables: { focus: { only: ["zorks"] } } }, { priority: PRIORITY.OVERRIDE });
const overridden = weaponLists();
eq("a Judge's override of one list wins over the import's, and the rest stands", [overridden.focus, overridden.category], [{ only: ["zorks"] }, L.category]);
check("and answers from a new object", overridden !== first && weaponLists() === overridden);
unregisterTable(WEAPON_LISTS_DOC, { priority: PRIORITY.OVERRIDE });
eq("withdrawing the override restores the import's", weaponLists().focus, L.focus);
unregisterTable(WEAPON_LISTS_DOC);
eq("withdrawing the import leaves none", weaponLists(), null);

console.log(`test-weapon-lists: ${pass} checks passed`);
