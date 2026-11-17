/**
 * A class's invocation lists: the compiler pairs each title line with the
 * section heading it follows and the level tag under it, the importer reads a
 * class's lists back as `[{tradition, level, names}]`, and `bindClass` turns
 * them into the casting row's `spellList` references, a hash-located entry
 * included. Every page, class, heading and title here is invented: no PDF, no
 * book.
 */
import assert from "node:assert/strict";
import { invocationReads } from "./compile-cookbook.mjs";
import { bindClass, classInvocationsFor, classRepertoireFor, keyedTitleIndex } from "../../scripts/importer/cookbook.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";

let n = 0;
const check = (label, got, want) => {
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}`);
  n++;
};

const run = (str, x, y, h = 10) => ({ str, x, y, h, w: str.length * 4, alias: "f1" });
const COLS = [54, 324];
const SECTIONS = [
  { class: "Zephyr Piper", heading: "Tunes of the Pipers" },
  { class: "Zephyr Drummer", heading: "Beats of the Drummers" },
];

/** A page: a running head, the first heading in column 0, two titles, and the second heading mid column 1 with its own title. */
const pageOne = () => ({
  height: 700,
  items: [
    run("Tunes", 54, 30),
    run("Tunes of the Pipers and More", 54, 60, 14),
    run("Tunes of the", 54, 90, 14),
    run("Pipers", 130, 90, 18),
    run("The piper knows the Chant of the Reed, the", 54, 110),
    run("Chant of the Reed", 54, 200),
    run("Range:", 198, 200),
    run("Touch", 229, 200),
    run("Zeta", 54, 212),
    run("1", 87, 212),
    run("Duration:", 198, 212),
    run("Beats", 324, 60),
    run("Beats of the Drummers and Their Kin", 324, 80, 14),
    run("Chant of the Flute", 324, 100),
    run("Range:", 468, 100),
    run("10 feet", 499, 100),
    run("Zeta", 324, 112),
    run("1", 357, 112),
    run("Duration:", 468, 112),
    run("Beats of the", 324, 400, 14),
    run("Drummers", 400, 400, 18),
    run("Chant of the Skin", 324, 500),
    run("Range:", 468, 500),
    run("Zeta", 324, 512),
    run("2", 357, 512),
    run("Duration:", 468, 512),
  ],
});
/** The next page opens under no heading of its own, so its title belongs to the section before it. */
const pageTwo = () => ({
  height: 700,
  items: [run("Chant of the Bell", 54, 80), run("Range:", 198, 80), run("Zeta", 54, 92), run("1", 87, 92), run("Duration:", 198, 92)],
});

const one = invocationReads(pageOne(), COLS, SECTIONS, "Range:", -1);
check("titles are read in column order, each under the heading before it", one.reads.map((r) => [r.title.str, r.section]), [
  ["Chant of the Reed", 0],
  ["Chant of the Flute", 0],
  ["Chant of the Skin", 1],
]);
check("a prose mention and a running head open no section and no title", one.reads.length, 3);
check("the page leaves the last section current", one.current, 1);
check("the level tag box lies under the title and left of the stat run", one.reads[0].tag, { x0: 52, x1: 196, y0: 208, y1: 216 });
const two = invocationReads(pageTwo(), COLS, SECTIONS, "Range:", one.current);
check("a page with no heading continues the section it was handed", two.reads.map((r) => r.section), [1]);

/* --- what the executor holds, read back per class -------------------------- */
const node = {
  fields: {
    "Zephyr Piper": { title1: "Chant of the Reed", tag1: "Zeta 1", title2: "Chant of the Flute", tag2: "Zeta 1", title3: "Chant of the Bell", tag3: "Zeta 3" },
    "Zephyr Drummer": { title1: "Chant of the Skin", tag1: "Zeta 2" },
  },
};
check("a class's titles group by the tradition and level their tags print", classInvocationsFor(node, "Zephyr Piper"), [
  { tradition: "zeta", level: 1, names: ["Chant of the Reed", "Chant of the Flute"] },
  { tradition: "zeta", level: 3, names: ["Chant of the Bell"] },
]);
check("the other class reads its own", classInvocationsFor(node, "Zephyr Drummer"), [{ tradition: "zeta", level: 2, names: ["Chant of the Skin"] }]);
check("a class the pages do not print has none", classInvocationsFor(node, "Mudlark"), []);
check("a title with no tag, and no pages, give nothing", [classInvocationsFor({ fields: { "Zephyr Piper": { title1: "Chant of the Reed", tag1: "" } } }, "Zephyr Piper"), classInvocationsFor(null, "Zephyr Piper")], [[], []]);
check("the repertoire reader does not take them", classRepertoireFor(node, "Zephyr Piper"), []);

/* --- the casting row's spell list ------------------------------------------ */
const HIDDEN = "Chant of the Hidden Drum";
const titles = keyedTitleIndex(
  [
    ["def.spell.reed", "Chant of the Reed"],
    ["def.spell.flute", "Chant of the Flute"],
    ["def.spell.bell", "Chant of the Bell"],
    ["def.spell.hidden", "Invocation 9"],
  ],
  [["def.spell.hidden", printKey(HIDDEN)]],
);
check("a printed name that is no title resolves by the key of its letters", [titles.resolve(HIDDEN), titles.has(HIDDEN), titles.resolve("Chant of the Nothing")], ["def.spell.hidden", true, null]);
check("a title in the register resolves as it did", titles.resolve("chant of the reed"), "def.spell.reed");

globalThis.game ??= {};
const bound = (casting, lists) =>
  bindClass({ kind: "kind.class", name: "Zephyr Piper", book: "cat", cite: "CAT p.1", meta: { key: "zephyrPiper" }, casting }, { fields: {} }, "def.class.zephyrPiper", {
    spellTitles: titles,
    printedRepertoire: lists,
  }).system.casting ?? null;
const lists = [
  { tradition: "zeta", level: 1, names: ["Chant of the Reed", HIDDEN] },
  { tradition: "zeta", level: 3, names: ["Chant of the Bell", "Chant of the Reed"] },
];
const one_row = bound([{ key: "zeta", label: "Zeta", kind: "gnosis" }], lists);
check("a class with one casting row takes every list, each reference once", one_row?.map((row) => row.spellList), [["def.spell.reed", "def.spell.hidden", "def.spell.bell"]]);
const two_rows = bound(
  [
    { key: "arcane", label: "Arcane", kind: "vancian" },
    { key: "zeta", label: "Zeta", kind: "gnosis" },
  ],
  lists,
);
check("with two rows, the list goes to the row whose tradition it is", two_rows?.map((row) => row.spellList), [[], ["def.spell.reed", "def.spell.hidden", "def.spell.bell"]]);

console.log(`test-invocation-lists: all ${n} checks passed`);
