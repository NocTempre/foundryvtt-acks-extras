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
  WEAPON_PROSE_DOC_ID, WEAPON_LISTS_DOC_ID, WEAPON_LISTS_IMPORTED_HOOK, PRODUCES, applyWeaponListsImport, assembleWeaponLists, assembleCategory,
  categoryOf, optionOf, parseDealtBy, parseFocus, parseMarkedOptions, parseNouns, parseOptions, parsePrereqs, parseSelection, parseThrowable, parseTwoHands,
} from "../scripts/importer/weapon-binding.mjs";
import {
  WEAPON_LISTS_DOC, WEAPON_LIST_TABLES, categoryOptions, listedOption, martialOption, optionListImported, optionOfCategory, optionUnits, optionVerdict, registerWeaponSource,
  resolveRows, weaponLists, weaponOptions,
} from "../scripts/lib/weapons.mjs";
import { hasSelectionProvider, matchSelectionKey, nameWithSelections, selectionOptions, selectionVocabFor } from "../scripts/lib/vocab.mjs";
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

/* ------------------------- the option lists ------------------------- */

eq(
  "markers are arabic or roman, and the text between them loses its separators",
  parseMarkedOptions("preface: (1) zork, (2) blorp, and (3) flib; more"),
  [{ marker: "1", n: 1, text: "zork" }, { marker: "2", n: 2, text: "blorp" }, { marker: "3", n: 3, text: "flib" }],
);
eq(
  "a roman run reads to ten and a stop ends the last option",
  parseMarkedOptions("x: (i) a; (ii) b; (iii) c; (iv) d; (v) e; (vi) f; (vii) g; (viii) h; (ix) i; (x) j. then stray words").slice(-3).map((o) => [o.marker, o.n, o.text]),
  [["viii", 8, "h"], ["ix", 9, "i"], ["x", 10, "j"]],
);
eq("a gap in the markers reads no list", parseMarkedOptions("(1) zork; (3) blorp"), []);
eq("markers that do not start at one read no list", parseMarkedOptions("(2) zork; (3) blorp"), []);
eq("a word in parentheses is no marker", parseMarkedOptions("(hero) zork; (monster) blorp"), []);
eq("no window, no list", parseMarkedOptions(undefined), []);

const opt = (text, o) => optionOf({ n: 1, marker: "i", text }, o);
eq("a noun list", opt("any zorks and blorps").nouns, ["zorks", "blorps"]);
eq("a restricted option names one weapon", opt("zork", { restricted: true }).weapon, "zork");
eq("a restricted option naming two is a noun list", opt("zork and blorp", { restricted: true }).nouns, ["zork", "blorp"]);
eq("a combination by its count", [opt("any combination of 3 junk 4 words").any, opt("any combination of 3 junk 4 words").label], [3, "any combination of 3"]);
eq("a combination by a number word", [opt("any four weapons").any, opt("any four weapons").prereqs], [4, []]);
eq("a predicate of sizes and melee", [opt("any tiny, small, or medium melee weapons").melee, opt("any tiny, small, or medium melee weapons").sizes], [true, ["tiny", "small", "medium"]]);
eq("a predicate of missile alone", [opt("all missile weapons").missile, "sizes" in opt("all missile weapons"), "nouns" in opt("all missile weapons")], [true, false, false]);
eq("sizes against an invented vocabulary", [opt("any wee melee weapons", { sizes: ["wee"] }).sizes, opt("any wee melee weapons").nouns], [["wee"], ["wee melee"]]);
eq("words beyond sizes and uses make a noun list", opt("any small zorks").nouns, ["small zorks"]);
eq("an option that names nothing is none", [opt("any 4 of 5"), opt("")], [null, null]);

eq(
  "a prerequisite in the proficient-in shape",
  parsePrereqs("x. the class can only be proficient in snarf or quux if also proficient in zork and the class can only be proficient in grub if also proficient in blorp or flib. y"),
  [{ weapons: ["snarf", "quux"], requires: ["zork"] }, { weapons: ["grub"], requires: ["blorp", "flib"] }],
);
eq("a prerequisite that omits the proficient-in words", parsePrereqs("the class can only be proficient in snarf if also zork. more"), [{ weapons: ["snarf"], requires: ["zork"] }]);
eq(
  "a prerequisite in the select shape",
  parsePrereqs("when selecting option 3, the character can only select snarf or quux if he already has or also selects zork; and the character can only select grub if he already has or also selects blorp. note that"),
  [{ weapons: ["snarf", "quux"], requires: ["zork"] }, { weapons: ["grub"], requires: ["blorp"] }],
);
eq("no such sentence, no prerequisite", parsePrereqs("the class can select any zork if it likes"), []);

// One window holding every level, as the page prints them: a pick count and a total ahead of each
// list, an example paragraph after it whose own markers are no options, a table spliced into the
// last narrow option, and the unrestricted head last.
const LEVELS =
  "levels: a selection can be restricted, narrow, broad, or unrestricted. the rules follow. " +
  "restricted: the class can select any 2 of the following 3 specific weapons: (i) zork, (ii) blorp, (iii) flib. example: the standard thing took (i) zork and (ii) blorp. " +
  "narrow: the class can select any 1 of the following 4 narrow groups: (i) any zorks; (ii) any blorps and flibs; (iii) any quuxes; " +
  "or (iv) any combination of 3 table (hero) 4 +3 per 2 levels weapons. when selecting option iv, the class can only be proficient in snarf or quux if also proficient in zork. example: the standard foo chose (i) any zorks and (ii) any blorps. " +
  "broad: the class can select any 2 of the following 3 broad choices: (i) any tiny or small melee weapons, (ii) all missile weapons; and (iii) any combination of 2 weapons. example: the standard bar chose (i) any tiny. " +
  "unrestricted: the class has proficiency in all weapons. armor: more.";
const levels = parseSelection(LEVELS);
eq("every level with a list is read, and unrestricted holds none", Object.keys(levels), ["restricted", "narrow", "broad"]);
eq("a level keeps its pick count, its printed total and its options", [levels.restricted.pick, levels.restricted.total, levels.restricted.options.length], [2, 3, 3]);
eq("restricted options are single weapons", levels.restricted.options.map((o) => o.weapon), ["zork", "blorp", "flib"]);
eq("the example paragraph's markers are no options", [levels.narrow.options.length, levels.broad.options.length], [4, 3]);
eq("a narrow level reads nouns and a combination with its prerequisites", [levels.narrow.options.map((o) => o.nouns ?? o.any), levels.narrow.options[3].prereqs], [[["zorks"], ["blorps", "flibs"], ["quuxes"], 3], [{ weapons: ["snarf", "quux"], requires: ["zork"] }]]);
eq("a broad level reads predicates", [levels.broad.options[0].melee, levels.broad.options[0].sizes, levels.broad.options[1].missile, levels.broad.options[2].any], [true, ["tiny", "small"], true, 2]);
eq("a prerequisite sentence of one level does not reach another", levels.broad.options[2].prereqs, []);
eq("a level whose printed total is not the options read is dropped", Object.keys(parseSelection(LEVELS.replace("following 4 narrow", "following 5 narrow"))), ["restricted", "broad"]);
eq("a level with no pick sentence is dropped", Object.keys(parseSelection(LEVELS.replace("any 1 of the following 4 narrow groups", "the narrow groups"))), ["restricted", "broad"]);
eq("an option no shape reads drops its level", Object.keys(parseSelection(LEVELS.replace("(iii) any quuxes;", "(iii) 12;"))), ["restricted", "broad"]);
eq("markers with a gap drop their level", Object.keys(parseSelection(LEVELS.replace("(ii) any blorps and flibs;", "(iii) any blorps and flibs;"))), ["restricted", "broad"]);
eq("a head that is only part of unrestricted opens no level", parseSelection("unrestricted: any 1 of the following 1 things: (i) zorks."), {});
eq("no window, no levels", parseSelection(undefined), {});

/* ------------------------------ assembly ------------------------------ */

const raw = {
  martialProse: { options: "pick: (1) zorks; (2) blorps/flibs; (3) any four weapons. when selecting option 3, the character can only select snarf if he already has or also selects zork. more" },
  selectionProse: { levels: LEVELS },
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
eq("the option table holds every list read, in the books' order", Object.keys(lists.options), ["restricted", "narrow", "broad", "martial"]);
eq("a martial option list carries its prerequisites on its combination", [lists.options.martial.options.map((o) => o.nouns ?? o.any), lists.options.martial.options[2].prereqs], [[["zorks"], ["blorps", "flibs"], 4], [{ weapons: ["snarf"], requires: ["zork"] }]]);
eq("a list carries the pick and total its sentence prints", [lists.options.narrow.pick, lists.options.narrow.total, "pick" in lists.options.martial], [1, 4, false]);
eq("a list carries its own cite where the raw document gave one", Object.values(assembleWeaponLists(raw, TOKENS, { martialProse: "RR p.1", selectionProse: "JJ p.2" }).options).map((l) => l.cite), ["JJ p.2", "JJ p.2", "JJ p.2", "RR p.1"]);
check("and none where it gave none", Object.values(lists.options).every((l) => !("cite" in l)));
eq("a selection window that did not read costs its levels and the martial list stands", Object.keys(assembleWeaponLists({ ...raw, selectionProse: {} }, TOKENS).options), ["martial"]);
eq("every level failing its self-check leaves the options to the martial list", Object.keys(assembleWeaponLists({ ...raw, selectionProse: { levels: LEVELS.replace(/following \d+/g, "following 9") } }, TOKENS).options), ["martial"]);
check("no list read, no options table", !("options" in assembleWeaponLists({ focusProse: raw.focusProse }, TOKENS)));
eq("only a type the module names is read, with the weapons it is dealt by", lists.damageType, { fire: ["natural heat"] });
eq("a throwable assembles from its window", lists.throwables, { oil: { damage: "1d9", types: ["fire"] }, holyWater: { damage: "1d9", types: ["luminous"] }, torch: { damage: "1d2", types: ["fire"] } });
eq("the weapons that need both hands are read from both folios", lists.twoHands, ["grand zork", "flib", "long-reach snarf", "wide bar"]);
eq("a window that did not read costs only its list", Object.keys(assembleWeaponLists({ ...raw, focusProse: {}, twoHandsFirst: {}, twoHandsSecond: {} }, TOKENS)).sort(), ["category", "damageType", "options", "throwables"]);
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
  levels: windowKeys("selectionProse"),
  list: windowKeys("focusProse"),
  first: windowKeys("twoHandsFirst"),
  second: windowKeys("twoHandsSecond"),
  throwables: windowKeys("throwableProse"),
}, { options: [["options"], ["options"]], levels: ["levels"], list: ["list"], first: ["entries"], second: ["entries"], throwables: ["oil", "holyWater", "torch"] });
eq("the options are read from the martial and the selection windows", PRODUCES[WEAPON_LISTS_DOC].options, ["martialProse", "selectionProse"]);
check("every window is a window take", Object.values(TABLE_RECIPES[WEAPON_PROSE_DOC_ID].tables).every((t) => t.values.every((v) => v.take === "window")));
check("lib declares the tables it reads", expectedTables().some((e) => e.docId === WEAPON_LISTS_DOC && e.tableIds.join() === WEAPON_LIST_TABLES.join()));
check("no import service, nothing assembled", (await applyWeaponListsImport()).assembled.length === 0);

{
  const imported = [];
  const fired = [];
  services.register("ruledata-import", { importDoc: async (doc, opts) => imported.push({ doc, opts }) });
  eq("no raw document, nothing assembled", (await applyWeaponListsImport()).assembled, []);
  registerTable(
    { id: WEAPON_PROSE_DOC_ID, source: { book: "x" }, cites: { martialProse: "RR p.9", narrowProse: "JJ p.3", selectionProse: "JJ p.4", focusProse: "RR p.12", twoHandsFirst: "RR p.30", twoHandsSecond: "RR p.31" }, tables: { ...raw } },
    { priority: PRIORITY.WORLD },
  );
  const got = await applyWeaponListsImport();
  eq("with no Hooks global the import still completes", got.assembled.includes("options"), true);
  imported.length = 0;
  globalThis.Hooks = { callAll: (name, payload) => fired.push({ name, payload, importedFirst: imported.length }) };
  const again = await applyWeaponListsImport();
  delete globalThis.Hooks;
  eq("the hook fires once, after the document is imported, with what was assembled", fired, [{ name: WEAPON_LISTS_IMPORTED_HOOK, payload: { assembled: again.assembled }, importedFirst: 1 }]);
  eq("and the hook is the module's own", WEAPON_LISTS_IMPORTED_HOOK, "acksExtras.weaponListsImported");
  check("the lists are registered as their own document", imported.length === 1 && imported[0].doc.id === WEAPON_LISTS_DOC && imported[0].opts.priority === PRIORITY.WORLD);
  eq("the document holds the lists and nothing raw", Object.keys(imported[0].doc.tables).sort(), got.assembled.sort());
  eq("a list cites the pages of the raw tables it was read from", [imported[0].doc.cites.category, imported[0].doc.cites.twoHands, imported[0].doc.cites.focus], ["RR p.9; JJ p.3", "RR p.30-31", "RR p.12"]);
  eq("the options table cites both windows it was read from", imported[0].doc.cites.options, "RR p.9; JJ p.4");
  eq("and each option list carries the cite of its own window", Object.fromEntries(Object.entries(imported[0].doc.tables.options).map(([k, v]) => [k, v.cite])), { restricted: "JJ p.4", narrow: "JJ p.4", broad: "JJ p.4", martial: "RR p.9" });
  check("no raw table's cite is carried over", !("martialProse" in imported[0].doc.cites) && !("selectionProse" in imported[0].doc.cites));
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
  options: {
    restricted: { cite: "JJ p.1", pick: 1, total: 2, options: [{ n: 1, marker: "i", label: "zork", weapon: "zork" }, { n: 2, marker: "ii", label: "flib", weapon: "flib" }] },
    narrow: {
      cite: "JJ p.1", pick: 1, total: 4,
      options: [
        { n: 1, marker: "i", label: "any zorks", nouns: ["zorks"] },
        { n: 2, marker: "ii", label: "any blorps and flibs", nouns: ["blorps", "flibs"] },
        { n: 3, marker: "iii", label: "any small melee weapons", melee: true, sizes: ["small"] },
        { n: 4, marker: "iv", label: "any combination of 3", any: 3, prereqs: [{ weapons: ["snarf"], requires: ["zork"] }] },
      ],
    },
    martial: { cite: "RR p.2", options: [{ n: 1, marker: "1", label: "quuxes", nouns: ["quuxes"] }] },
  },
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
check("the grid is not changed", !("category" in grid.zork) && !("options" in grid.zork));

{
  const byBlock = resolveRows({ gizmo: { name: "Gizmo", block: "Zorks" }, zork: grid.zork }, L);
  eq("a row whose sub-header names a weapon's noun stays off that single-weapon option and joins the noun option", [byBlock.gizmo.options, byBlock.zork.options], [["narrow.1"], ["restricted.1", "narrow.1"]]);
  eq(
    "the other tables still place by the sub-header",
    [byBlock.gizmo.category, byBlock.gizmo.focus, byBlock.gizmo.damageType, byBlock.gizmo.placedBy],
    ["zork", "zorksblorps", "gooey", { category: "block", focus: "block", damageType: "block" }],
  );
  const mixed = { options: { restricted: { options: [{ n: 1, label: "zork", weapon: "zork" }] }, narrow: { options: [{ n: 1, label: "any zorks", nouns: ["zorks"] }] } } };
  eq("a block naming a weapon option and a noun option counts only the noun option", resolveRows({ gizmo: { name: "Gizmo", block: "Zorks" } }, mixed).gizmo.options, ["narrow.1"]);
  const twice = { options: { restricted: { options: [{ n: 1, label: "zork", weapon: "zork" }, { n: 2, label: "gizmo", weapon: "gizmo" }] } } };
  eq("a name naming two single-weapon options places neither", resolveRows({ both: { name: "Zork Gizmo", block: null } }, twice).both.options, []);
}

const optsOf = (k) => out[k].options;
eq("a name places a row on the noun option of each list that holds it", optsOf("zork"), ["restricted.1", "narrow.1"]);
eq("a run of the name's words places it", optsOf("grandzork"), ["restricted.1", "narrow.1"]);
eq("a single-weapon option and a noun option place the same row apart", optsOf("flib"), ["restricted.2", "narrow.2"]);
eq("a plural noun places a singular name", optsOf("blorp"), ["narrow.2"]);
eq("a block that names two noun options of one list places nothing in it, and a single-weapon option is not placed by a block", optsOf("snarf"), []);
eq("a block places a row whose name places nothing", optsOf("thing"), ["martial.1"]);
eq("a row nothing places holds no option", optsOf("orphan"), []);
eq("a name naming two options of one list places nothing in it, and the block is not asked", optsOf("both"), ["martial.1"]);
check("a predicate and a combination place no row", Object.values(out).every((r) => !r.options.includes("narrow.3") && !r.options.includes("narrow.4")));
check("a throwable's kind row holds no option", out.holywater.options.length === 0 && out.torch.options.length === 0);
check("no lists, no options", Object.values(resolveRows(grid, null)).every((r) => Array.isArray(r.options) && r.options.length === 0));

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

/* ------------------------------ the option readers ------------------------------ */

eq("no lists, no options and no list imported", [weaponOptions(), optionListImported("narrow")], [[], false]);
eq("no lists, no phrase names an option", listedOption("narrow", "zorks"), null);
eq("no lists, no option holds a weapon", optionUnits("narrow.1"), []);
registerTable({ id: WEAPON_LISTS_DOC, tables: { options: L.options } }, { priority: PRIORITY.WORLD });
const flat = weaponOptions();
const by = (id) => flat.find((o) => o.id === id);
eq("the options are flat, in list order then printed order", flat.map((o) => o.id), ["restricted.1", "restricted.2", "narrow.1", "narrow.2", "narrow.3", "narrow.4", "martial.1"]);
eq("each says what it is", flat.map((o) => o.kind), ["weapon", "weapon", "nouns", "nouns", "predicate", "combination", "nouns"]);
eq("each carries its list's cite, its marker and its label", [flat[0].cite, flat[6].cite, flat[5].marker, flat[3].label], ["JJ p.1", "RR p.2", "iv", "any blorps and flibs"]);
eq("a kind carries its own fields", [flat[0].weapon, flat[2].nouns, flat[4].melee, flat[4].sizes, "missile" in flat[4], flat[5].any, flat[5].prereqs], ["zork", ["zorks"], true, ["small"], false, 3, [{ weapons: ["snarf"], requires: ["zork"] }]]);
check("the same array comes back until the lists change", weaponOptions() === flat);
eq("a list is imported where it holds an option", ["restricted", "narrow", "broad", "martial"].map(optionListImported), [true, true, false, true]);
eq(
  "a phrase names the one option whose nouns it holds, in the list asked",
  [listedOption("narrow", "a blorp"), listedOption("narrow", "zorks and blorps"), listedOption("narrow", "quux"), listedOption("broad", "zorks"), listedOption("restricted", "the zork"), listedOption("martial", "quux")],
  ["narrow.2", null, null, null, "restricted.1", "martial.1"],
);

eq(
  "each category maps to the options that hold its rows, in option order",
  categoryOptions(out),
  { zork: ["restricted.1", "narrow.1"], blorpFlib: ["restricted.2", "narrow.2"], other: ["martial.1"] },
);
eq("a category no option holds maps to nothing", categoryOptions({ x: { category: "zork", options: [] }, y: { category: null, options: ["narrow.1"] } }), { zork: [] });
eq("the registered source's rows answer when none is passed", [categoryOptions({}), (registerWeaponSource({ rows: { z: { cat: "zork", options: ["narrow.2", "narrow.1"] } } }), categoryOptions())], [{}, { zork: ["narrow.1", "narrow.2"] }]);
const rowsSeen = registerWeaponSource({ rows: out });
eq(
  "a noun or single-weapon option covers the rows placed on it",
  [optionVerdict(by("narrow.1"), { key: "zork" }), optionVerdict(by("narrow.1"), { key: "blorp" }), optionVerdict(by("restricted.1"), { key: "zork" }), optionVerdict(by("restricted.1"), { key: "snarf" }), optionVerdict(by("martial.1"), { key: "thing" })],
  [true, false, true, false, true],
);
eq("a single-weapon option holds the rows its name places and no block's", [optionUnits("restricted.1"), optionUnits("restricted.2")], [["zork", "grandzork"], ["flib"]]);
eq("a noun option holds the rows its nouns place by name or by block, in grid order", [optionUnits("narrow.1"), optionUnits("narrow.2"), optionUnits("martial.1")], [["zork", "grandzork"], ["flib", "blorp"], ["thing", "both"]]);
eq("a predicate, a combination, an unknown id and no id hold no weapon", [optionUnits("narrow.3"), optionUnits("narrow.4"), optionUnits("nope.1"), optionUnits(undefined)], [[], [], [], []]);
eq("no weapon identity, no such row or no profile is no answer", [optionVerdict(by("narrow.1"), {}), optionVerdict(by("narrow.1"), { key: "nope" }), optionVerdict(by("narrow.1"), null)], [null, null, null]);
eq("a combination covers nothing by itself", optionVerdict(by("narrow.4"), { key: "zork", melee: true, size: "small" }), false);
eq("a predicate reads the size and the use", [
  optionVerdict(by("narrow.3"), { melee: true, size: "small" }),
  optionVerdict(by("narrow.3"), { melee: true, size: "Small" }),
  optionVerdict(by("narrow.3"), { melee: true, size: "large" }),
  optionVerdict(by("narrow.3"), { melee: false, missile: true, size: "small" }),
], [true, true, false, false]);
eq("a size against a weapon of none stated is no answer", optionVerdict(by("narrow.3"), { melee: true, size: null }), null);
const missile = { id: "x.1", kind: "predicate", missile: true, sizes: [] };
eq("a missile predicate asks the use alone", [optionVerdict(missile, { missile: true, size: null }), optionVerdict(missile, { missile: false })], [true, false]);
const either = { id: "x.2", kind: "predicate", melee: true, missile: true, sizes: ["small"] };
eq(
  "a predicate of both uses is covered by either, and unknown while one use could cover it",
  [optionVerdict(either, { melee: true, size: "small" }), optionVerdict(either, { melee: true, size: "large" }), optionVerdict(either, { melee: false, missile: true, size: null })],
  [true, false, null],
);
eq("an object that is no option is no answer", [optionVerdict({}, { key: "zork" }), optionVerdict(null, { key: "zork" })], [null, null]);
registerWeaponSource({ rows: { zork: { name: "Zork" } } });
eq("a row the lists never resolved is no answer", optionVerdict(by("narrow.1"), { key: "zork" }), null);
registerWeaponSource(rowsSeen);

registerTable(
  { id: WEAPON_LISTS_DOC, tables: { options: { narrow: { options: [null, { n: "x", nouns: ["a"] }, { n: 1, nouns: "zorks" }, { n: 2, nouns: ["blorps"] }, { n: 2, nouns: ["flibs"] }] }, martial: "bad", broad: { options: "bad" } } } },
  { priority: PRIORITY.OVERRIDE },
);
eq("a malformed override keeps the options that read and drops the rest", weaponOptions().map((o) => [o.id, o.nouns]), [["narrow.2", ["blorps"]]]);
check("and answers from a new array", weaponOptions() !== flat);
eq("the resolver reads it the same way", resolveRows({ blorp: grid.blorp }, weaponLists()).blorp.options, ["narrow.2"]);
unregisterTable(WEAPON_LISTS_DOC, { priority: PRIORITY.OVERRIDE });
eq("withdrawing the override restores the import's options", weaponOptions().length, 7);
unregisterTable(WEAPON_LISTS_DOC);
eq("withdrawing the import leaves none", weaponOptions(), []);

/* ------------------------------ the martial pick ------------------------------ */

{
  const martialItem = { name: "Martial Training", flags: { "acks-extras": { cookbook: { id: "def.prof.martialTraining" } } } };
  const vocabOf = () => selectionVocabFor(martialItem, "proficiency");
  const entries = () => selectionOptions(vocabOf());
  check("the martial provider is registered by the lib", hasSelectionProvider(martialItem));
  eq("nothing imported, no entry and no option to tick", [entries(), martialOption("martial.1"), martialOption("zorks")], [[], null, null]);

  registerTable(
    {
      id: WEAPON_LISTS_DOC,
      tables: {
        category: { zork: ["zorks"], blorpFlib: ["blorps", "flibs"], other: ["dorbs"] },
        options: {
          martial: {
            cite: "RR p.2",
            options: [
              { n: 1, marker: "1", label: "zorks", nouns: ["zorks"] },
              { n: 2, marker: "2", label: "blorps, flibs", nouns: ["blorps", "flibs"] },
              { n: 3, marker: "3", label: "any combination of 2", any: 2 },
              { n: 4, marker: "4", label: "dorbs, quuxes", nouns: ["dorbs", "quuxes"] },
            ],
          },
        },
      },
    },
    { priority: PRIORITY.WORLD },
  );
  const rows = {
    z1: { cat: "zork", options: ["martial.1"] },
    z2: { cat: "zork", options: ["martial.1"] },
    b1: { cat: "blorpFlib", options: ["martial.2"] },
    f1: { cat: "blorpFlib", options: ["martial.2"] },
    d1: { cat: "other", options: ["martial.4"] },
    q1: { cat: "other", options: ["martial.4"] },
    lone: { cat: "other", options: [] },
  };
  const before = registerWeaponSource({ rows });

  eq("a pick is an option's id, in any case", [martialOption("martial.2"), martialOption("Martial.3")], ["martial.2", "martial.3"]);
  eq("a pick naming one option's noun is that option, plural or not", [martialOption("zork"), martialOption("flibs"), martialOption("Quux")], ["martial.1", "martial.2", "martial.4"]);
  eq("a category key no option's nouns name resolves to the one option whose weapons all carry it", [martialOption("other"), martialOption("blorpFlib"), martialOption("blorpflib")], ["martial.4", "martial.2", "martial.2"]);
  eq("an empty pick and an unnamed pick are no option", [martialOption(""), martialOption(undefined), martialOption("grub")], [null, null, null]);
  eq("a category the weapons of one option all carry is that option; one nothing carries, and an empty one, is none",[optionOfCategory("martial", "zork"), optionOfCategory("martial", "nothing"), optionOfCategory("martial", "")], ["martial.1", null, null]);
  registerWeaponSource({ rows: { ...rows, b1: { cat: "zork", options: ["martial.2"] }, f1: { cat: "zork", options: ["martial.2"] } } });
  eq("a category held by two options is no option", optionOfCategory("martial", "zork"), null);
  registerWeaponSource({ rows });

  eq("the vocabulary is one entry per martial option, labelled with its printed words", entries().map(([key, def]) => [key, def.label]), [
    ["martial.1", "zorks"],
    ["martial.2", "blorps, flibs"],
    ["martial.3", "any combination of 2"],
    ["martial.4", "dorbs, quuxes"],
  ]);
  eq("each answers to its nouns and to the category keys that resolve to it", entries().map(([, def]) => def.aliases), [["zorks", "zork"], ["blorps", "flibs", "blorpFlib"], [], ["dorbs", "quuxes", "other"]]);
  check("the entries are exact, so a pick that names no option stays as typed", vocabOf().exact === true && matchSelectionKey(vocabOf(), "sword") === null);
  const same = (pick) => matchSelectionKey(vocabOf(), pick) === martialOption(pick);
  check("every legacy category key and noun ticks the box of the option the resolver reaches", ["zork", "blorpFlib", "other", "zorks", "flibs", "quuxes", "martial.3"].every(same));

  const named = nameWithSelections("Martial Training", ["martial.2"], vocabOf());
  eq("the name carries the label", named, "Martial Training (blorps, flibs)");
  const fragments = /\(([^)]+)\)\s*$/.exec(named)[1].split(",").map((s) => s.trim()).filter(Boolean);
  eq("and the comma-split fragments each resolve to the same option", fragments.map(martialOption), ["martial.2", "martial.2"]);

  registerTable({ id: WEAPON_LISTS_DOC, tables: { options: { martial: { options: [{ n: 1, label: "zorks", nouns: ["zorks"] }] } } } }, { priority: PRIORITY.OVERRIDE });
  eq("a Judge's override of the lists reaches the vocabulary at once", entries().map(([key]) => key), ["martial.1"]);
  unregisterTable(WEAPON_LISTS_DOC, { priority: PRIORITY.OVERRIDE });
  unregisterTable(WEAPON_LISTS_DOC);
  registerWeaponSource(before);
  eq("withdrawn, the vocabulary is empty again and is still the provider's", [entries(), hasSelectionProvider(martialItem)], [[], true]);
}

console.log(`test-weapon-lists: ${pass} checks passed`);
