/**
 * A heading set on the same line as its stat run (`assists.statBeside`): the
 * compiler finds it by the label beside it, leaves an inset callout out of the
 * description, and the stat value reads the level tag before the labelled
 * runs, so the stat parser sees the tag where it expects it. Every page, title
 * and tag here is invented: no PDF, no book.
 */
import assert from "node:assert/strict";
import { besideHeads, calloutRuns } from "./compile-cookbook.mjs";
import { joinRuns, runsIn } from "../../scripts/importer/executor.mjs";
import { parseStatBlock } from "../../scripts/magic/spell-logic.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const run = (str, x, y, h = 10) => ({ str, x, y, h, w: str.length * 4, alias: "f1" });
const COLS = [54, 324];

/** A page: a prose line that mentions a title, then a title line with its stat run and a tag line. */
const page = () => ({
  height: 700,
  items: [
    run("Chant of the Quill", 54, 100),
    run("Range:", 198, 100),
    run("Touch", 229, 100),
    run("Zeta", 54, 112),
    run("2", 87, 112),
    run("Duration:", 198, 112),
    run("3 turns", 241, 112),
    run("As with Chant of the Quill, the scribe", 54, 130),
    run("Chant of the Lamp", 324, 300),
    run("Range:", 468, 300),
    run("10 feet", 499, 300),
  ],
});

t("a title with the stat label beside it is a heading; a mention in prose is not", () => {
  const heads = besideHeads(page(), COLS, "Range:");
  assert.deepEqual(heads.map((h) => h.str), ["Chant of the Quill", "Chant of the Lamp"]);
});

t("a label with two runs to its left names no heading", () => {
  const pd = { items: [run("Chant", 54, 100), run("of Ash", 90, 100), run("Range:", 198, 100)] };
  assert.deepEqual(besideHeads(pd, COLS, "Range:"), []);
});

t("the tag box read before the stat box gives the stat parser its tag first", () => {
  const pd = page();
  const split = 196;
  const tagFirst = {
    boxes: [
      { x0: 49, x1: split, y0: 109, y1: 115 },
      { x0: split, x1: 320, y0: 97, y1: 115 },
    ],
  };
  const read = (instr) => {
    const runs = runsIn(pd, instr);
    return joinRuns(runs, { joinSpace: runs.map((_, i) => i) });
  };
  const stat = parseStatBlock(read(tagFirst));
  assert.deepEqual(stat.lists, [{ source: "Zeta", level: 2 }]);
  assert.equal(stat.range, "Touch");
  assert.equal(stat.duration, "3 turns");
  // The natural reading order, one box, puts the tag inside the range text.
  const natural = parseStatBlock(read({ box: { x0: 49, x1: 320, y0: 97, y1: 115 } }));
  assert.deepEqual(natural.lists, [], "tag after the title line: no lists");
});

t("an inset callout is left out; prose at the column edge stays", () => {
  const items = [
    run("A line of description.", 54, 200),
    run("EXAMPLE: A worked case that", 63, 224),
    run("runs on inside the box.", 63, 236),
    run("The description resumes.", 54, 260),
    run("Level 2: more", 54, 272),
  ];
  const gone = calloutRuns(items);
  assert.deepEqual([...gone].map((it) => it.str).sort(), ["EXAMPLE: A worked case that", "runs on inside the box."]);
});

t("a column without a callout loses nothing", () => {
  assert.equal(calloutRuns([run("One line.", 54, 200), run("Two line.", 54, 212)]).size, 0);
});

console.log(`${n} passed`);
