/**
 * Regression suite for the RECIPE ENGINE — `materializeEffects` and
 * `materializeRolls` — and for a roll table's rows end to end: the compiler's
 * grid bands and detail blocks (`gridBandParas`, `rollTableDetails`) on
 * invented page runs, read back through `executeEntry`.
 *
 * This is the piece of the pipeline where a wrong answer is most expensive: it
 * turns a chef's structure plus a locator into the mechanic a Judge reads at
 * the table, and a locator that quietly matches the wrong thing produces a
 * plausible wrong number, which is this project's worst failure mode. Every
 * case below is written against prose of the SHAPE the books use, never their
 * text — the fixtures are paraphrases, so this file carries no book content.
 *
 * Offline and Foundry-free; no reference library needed.
 *
 * Usage: node tools/test-executor.mjs
 */
import assert from "node:assert/strict";
import { executeEntry, materializeEffects, materializeRolls } from "../../scripts/importer/executor.mjs";
import { gridBandParas, rollTableDetails } from "./compile-cookbook.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const paras = (...lines) => lines.map((text) => ({ text }));

/* ------------------------------------------------------------------ */
/*  effects: the pre-existing contract                                 */
/* ------------------------------------------------------------------ */

t("a flat value materializes as a LevelValue object, not a bare number", () => {
  const [e] = materializeEffects(
    [{ type: "modifier", target: "ac", mode: "add", from: { pattern: "a\\s*\\+(\\d+)\\s*bonus\\s*to\\s*armor" } }],
    paras("The character gains a +2 bonus to armor class while unarmoured."),
  );
  assert.deepEqual(e.value, { kind: "flat", flat: 2 });
  assert.equal(e.target, "ac", "structure ships; only the number is located");
});

t("a locator that misses drops its effect rather than inventing a value", () => {
  const out = materializeEffects(
    [{ type: "modifier", target: "ac", from: { pattern: "a\\s*\\+(\\d+)\\s*bonus\\s*to\\s*armor" } }],
    paras("The character is harder to surprise."),
  );
  assert.deepEqual(out, []);
});

t("all-or-nothing: one missing locator drops the whole effect", () => {
  const out = materializeEffects(
    [
      {
        type: "economic",
        resource: "research",
        from: [
          { into: "amount", pattern: "(\\d+)\\s*%" },
          { into: "value", pattern: "a\\s*\\+(\\d+)\\s*bonus" },
        ],
      },
    ],
    paras("Research proceeds 10% faster."),
  );
  assert.deepEqual(out, [], "half a mechanic reads as complete and is not");
});

t("an `into` naming a field that is not locatable drops the effect", () => {
  const out = materializeEffects(
    [{ type: "modifier", target: "ac", from: { into: "unit", pattern: "(\\d+)" } }],
    paras("A +2 bonus."),
  );
  assert.deepEqual(out, []);
});

t("an effect with no locator at all ships its structure unchanged", () => {
  const [e] = materializeEffects([{ type: "immunity", effects: ["disease"] }], paras("Immune to disease."));
  assert.deepEqual(e, { type: "immunity", effects: ["disease"] });
});

/* ------------------------------------------------------------------ */
/*  effects: per-level, word numerals, rounding                        */
/* ------------------------------------------------------------------ */

t("`as:perLevel` makes the located number both the base and the rate", () => {
  // "restore N hit points per experience level" is N x level: N at 1st, 2N at
  // 2nd. Before this, `per` defaulted to -1 and the effect decayed with level.
  const [e] = materializeEffects(
    [{ type: "modifier", target: "hp", from: { as: "perLevel", pattern: "restore\\s*(\\d+)\\s*hit\\s*points\\s*per" } }],
    paras("He can restore 2 hit points per experience level."),
  );
  assert.deepEqual(e.value, { kind: "perLevel", base: 2, per: 2 });
});

t("`per` overrides the rate for the base-then-increment shape", () => {
  const [e] = materializeEffects(
    [{ type: "throw", target: "save", from: { as: "perLevel", per: -1, pattern: "throw\\s*of\\s*(\\d+)\\+" } }],
    paras("He succeeds on a throw of 18+, improving by one each level."),
  );
  assert.deepEqual(e.value, { kind: "perLevel", base: 18, per: -1 });
});

t("a proportion written as a WORD is located, not shipped", () => {
  // "one-half his class level (round up)" carries no digit. The alternatives
  // are shipping 0.5 or dropping the mechanic; both are wrong.
  const [e] = materializeEffects(
    [
      {
        type: "modifier",
        target: "save",
        forWhat: "Mortal Wounds",
        from: { as: "perLevel", round: "up", pattern: "throw\\s*of\\s*(one-half|half)\\s*(?:his|her)\\s*class\\s*level" },
      },
    ],
    paras("He can grant a bonus to their Mortal Wounds throw of one-half his class level (round up)."),
  );
  assert.deepEqual(e.value, { kind: "perLevel", base: 0.5, per: 0.5, round: "up" });
});

t("`round` is shape, so it ships; it is absent unless stated", () => {
  const [e] = materializeEffects(
    [{ type: "modifier", target: "hp", from: { as: "perLevel", pattern: "heal\\s*(\\d+)\\s*damage\\s*per" } }],
    paras("He can heal 2 damage per class level."),
  );
  assert.equal("round" in e.value, false);
});

/* ------------------------------------------------------------------ */
/*  effects: breakpoint ladders                                        */
/* ------------------------------------------------------------------ */

t("a PAIRED ladder reads its rungs off the page too", () => {
  // "+1 ... at 7th level +2 ... at 13th level +3": shipping steps [1,7,13]
  // would ship 7 and 13, which are the book's numbers as much as the bonuses.
  const [e] = materializeEffects(
    [
      {
        type: "modifier",
        target: "ac",
        mode: "add",
        from: {
          on: "level",
          pairs: true,
          pattern:
            "\\+(\\d+)\\s*bonus\\s*to\\s*armor\\s*class[\\s\\S]{0,120}?at\\s*(\\d+)\\w*\\s*level[\\s\\S]{0,40}?to\\s*\\+(\\d+)[\\s\\S]{0,80}?at\\s*(\\d+)\\w*\\s*level[\\s\\S]{0,60}?to\\s*\\+(\\d+)",
        },
      },
    ],
    paras(
      "She gains a +1 bonus to armor class. At 7th level, the bonus increases to +2, and at 13th level the bonus increases to +3.",
    ),
  );
  assert.deepEqual(e.value, {
    kind: "breakpoints",
    breakpoints: [
      { atLevel: 1, value: 1 },
      { atLevel: 7, value: 2 },
      { atLevel: 13, value: 3 },
    ],
  });
});

t("a ladder on a scale other than level is `conditional`, not `breakpoints`", () => {
  const [e] = materializeEffects(
    [
      {
        type: "modifier",
        target: "reaction",
        from: { on: "rank", pattern: "\\+(\\d+)[\\s\\S]{0,60}?\\+(\\d+)[\\s\\S]{0,60}?\\+(\\d+)" },
      },
    ],
    paras("The bonus is +1 at one rank, +2 at two ranks, and +3 at three ranks."),
  );
  assert.equal(e.value.kind, "conditional");
  assert.equal(e.value.on, "rank");
  assert.equal(e.value.breakpoints.length, 3);
});

t("a ladder whose groups are all unreadable drops the effect", () => {
  const out = materializeEffects(
    [{ type: "modifier", target: "ac", from: { on: "level", pattern: "(bonus)" } }],
    paras("The character gains a bonus."),
  );
  assert.deepEqual(out, []);
});

/* ------------------------------------------------------------------ */
/*  rolls: unchanged by the shared ladder builder                      */
/* ------------------------------------------------------------------ */

t("a roll materializes its label and flat target from the page", () => {
  const [r] = materializeRolls(
    [{ key: "cure", label: { pattern: "(Curing)\\s" }, target: { pattern: "proficiency\\s*throw\\s*of\\s*(\\d+)\\+" } }],
    paras("Curing a sick beast requires a proficiency throw of 18+."),
  );
  assert.equal(r.label, "Curing");
  assert.deepEqual(r.target, { kind: "flat", flat: 18 });
  assert.equal(r.formula, "1d20");
  assert.equal(r.rollType, "above");
});

t("a rank ladder still becomes conditional steps 1..N in order", () => {
  const [r] = materializeRolls(
    [{ key: "diagnose", target: { on: "rank", pattern: "(\\d+)\\+[\\s\\S]{0,60}?(\\d+)\\+[\\s\\S]{0,60}?(\\d+)\\+" } }],
    paras("The throw is 11+ at one rank. At two ranks it is 7+. At three ranks it is 3+."),
  );
  assert.equal(r.scale, "rank");
  assert.deepEqual(r.target, {
    kind: "conditional",
    on: "rank",
    breakpoints: [
      { atLevel: 1, value: 11 },
      { atLevel: 2, value: 7 },
      { atLevel: 3, value: 3 },
    ],
  });
});

t("`steps` still overrides rungs for a ladder that does not start at 1", () => {
  const [r] = materializeRolls(
    [{ key: "x", target: { on: "level", steps: [1, 5, 9], pattern: "(\\d+)\\+[\\s\\S]{0,40}?(\\d+)\\+[\\s\\S]{0,40}?(\\d+)\\+" } }],
    paras("14+ at first, 11+ at fifth, 8+ at ninth."),
  );
  assert.deepEqual(
    r.target.breakpoints.map((b) => b.atLevel),
    [1, 5, 9],
  );
});

t("a roll whose target locator misses is dropped, never guessed", () => {
  assert.deepEqual(materializeRolls([{ key: "x", target: { pattern: "throw of (\\d+)\\+" } }], paras("No throw here.")), []);
});

t("a roll whose recipe expects a label it cannot find is dropped", () => {
  const out = materializeRolls(
    [{ key: "x", label: { pattern: "(Diagnosis)" }, target: { pattern: "of\\s*(\\d+)\\+" } }],
    paras("A throw of 11+ is needed."),
  );
  assert.deepEqual(out, []);
});

t("a malformed pattern never throws at the table", () => {
  assert.deepEqual(materializeRolls([{ key: "x", target: { pattern: "([" } }], paras("anything")), []);
  assert.deepEqual(materializeEffects([{ type: "modifier", from: { pattern: "([" } }], paras("anything")), []);
});

/* ------------------------------------------------------------------ */
/*  rolls from the entry's own progression ladder                      */
/* ------------------------------------------------------------------ */

const LADDER = {
  kind: "breakpoints",
  breakpoints: [
    { atLevel: 1, value: 18 },
    { atLevel: 2, value: 17 },
  ],
};

t("target.fromProgression binds the entry's ladder as the roll's target", () => {
  const [r] = materializeRolls(
    [{ key: "hasty", label: { pattern: "(hastily)" }, target: { fromProgression: true } }],
    paras("The thief may work hastily or methodically."),
    { progression: LADDER },
  );
  assert.equal(r.label, "hastily");
  assert.equal(r.scale, "level");
  assert.deepEqual(r.target, LADDER);
});

t("a fromProgression roll with no materialized ladder is dropped, never guessed", () => {
  assert.deepEqual(
    materializeRolls([{ key: "hasty", target: { fromProgression: true } }], paras("anything"), {}),
    [],
  );
  assert.deepEqual(materializeRolls([{ key: "hasty", target: { fromProgression: true } }], paras("anything")), []);
});

/* ------------------------------------------------------------------ */
/*  outcome locators: band edge and fraction come off the page         */
/* ------------------------------------------------------------------ */

t("a botch band's edge locates into naturalMax", () => {
  const [e] = materializeEffects(
    [{ type: "outcome", trigger: "naturalBand", consequence: "the lock jams", from: { into: "naturalMax", pattern: "unmodified\\s*(?:roll\\s*of\\s*)?1\\s*[-–]\\s*(\\d+)" } }],
    paras("On an unmodified roll of 1-3 the lock jams."),
  );
  assert.equal(e.naturalMax, 3);
  assert.equal(e.trigger, "naturalBand");
});

t("a word fraction locates into belowFraction", () => {
  const [e] = materializeEffects(
    [{ type: "outcome", trigger: "belowFraction", consequence: "the victim notices", from: { into: "belowFraction", pattern: "below\\s*(half)\\s*the\\s*target" } }],
    paras("On a roll below half the target value, the victim notices."),
  );
  assert.equal(e.belowFraction, 0.5);
});

t("an outcome whose band locator misses is dropped whole", () => {
  assert.deepEqual(
    materializeEffects(
      [{ type: "outcome", trigger: "naturalBand", consequence: "x", from: { into: "naturalMax", pattern: "unmodified\\s*1\\s*[-–]\\s*(\\d+)" } }],
      paras("No band stated here."),
    ),
    [],
  );
});

/* ------------------------------------------------------------------ */
/*  roll-table rows: grid bands, empty rows, detail blocks             */
/* ------------------------------------------------------------------ */

// Invented runs; every word is made up. One run per string, 5pt a character.
const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });
const page = (...items) => ({ items, width: 612, height: 792 });
const GRID = { y0: 90, y1: 200, dieX0: 30, dieX1: 50, cellX0: 60, cellX1: 200 };
const where = { entryId: "qq.table", gpage: 1, page: 1 };
/** Compiled row paragraphs read back the way a seat reads them. */
const readRows = async (pages, paras) => {
  const cookbook = { schema: "acks-cookbook/3", entries: { "qq.table": { kind: "kind.rolltable", fields: { rows: { op: "text", page: 1, paras } } } } };
  const node = await executeEntry(null, cookbook, {}, "qq.table", { pageCache: new Map(Object.entries(pages).map(([p, pd]) => [Number(p), pd])) });
  return node.fields.rows;
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const rowsPage = (...extra) =>
  page(
    run("2", 32, 100), run("QQ wolves", 62, 100),
    run("3-4", 32, 112), run("QQ bandits", 62, 112),
    run("5", 32, 124), run("QQ quiet", 62, 124),
    run("6", 32, 136), run("QQ ghosts", 62, 136),
    ...extra,
  );
// A details column beside the grid: three keyed blocks and a row with none.
const numberColumn = [
  run("(2)", 305, 100), run("QQ wolves prowl the", 325, 100),
  run("edge of the wood and", 305, 112),
  run("howl at night.", 305, 124),
  run("(3-4):", 305, 148), run("QQ bandits demand a", 340, 148),
  run("toll of QQ coins.", 305, 160),
  run("»", 315, 172), run("a sub-bullet line.", 325, 172),
  run("Their camp lies north.", 305, 196),
  run("(6) QQ ghosts wail", 305, 220),
  run("at the old mill.", 305, 232),
];
const NUMBER_REGION = { page: 1, x0: 300, x1: 560, y0: 90, y1: 300 };

await ta("number-keyed details join their rows, in row order, with the pure key dropped", async () => {
  const pd = rowsPage(...numberColumn);
  const rows = gridBandParas(pd, GRID, where);
  const { paras, unmatched, skipped } = rollTableDetails(new Map([[1, pd]]), { by: "number", regions: [NUMBER_REGION] }, rows, 1, "qq.table");
  assert.deepEqual([unmatched, skipped], [0, 0]);
  assert.deepEqual(paras.map((p) => `${p.section}${p.detail ? "+" : ""}`), ["r2", "r2+", "r3-4", "r3-4+", "r3-4+", "r5", "r6", "r6+"]);
  const out = await readRows({ 1: pd }, paras);
  assert.deepEqual(out.map((p) => [p.section, !!p.detail, p.text]), [
    ["r2", false, "QQ wolves"],
    ["r2", true, "QQ wolves prowl the edge of the wood and howl at night."],
    ["r3-4", false, "QQ bandits"],
    ["r3-4", true, "QQ bandits demand a toll of QQ coins. » a sub-bullet line."],
    ["r3-4", true, "Their camp lies north."],
    ["r5", false, "QQ quiet"],
    ["r6", false, "QQ ghosts"],
    ["r6", true, "QQ ghosts wail at the old mill."],
  ], "a fused key strips by count; a row with no details keeps none");
});

await ta("heading-keyed details keep their heading and continue into a second region overleaf", async () => {
  const pd1 = page(
    run("1-2", 32, 100), run("QQ first", 62, 100),
    run("3", 32, 112), run("QQ second", 62, 112),
    run("4", 32, 124), run("QQ third", 62, 124),
    run("QQ ENCOUNTERS", 305, 100), run("1-2.", 380, 100),
    run("The party meets QQ.", 305, 112),
    run("They are friendly.", 305, 124),
    run("They number 2.", 305, 148),
    run("QQ ENCOUNTER 3. QQ", 305, 172),
    run("A lone QQ waits by the", 305, 184),
  );
  const pd2 = page(
    run("old well, silent.", 40, 80),
    run("It flees if hurt.", 40, 92),
    run("QQ ENCOUNTER 4.", 40, 116),
    run("Nothing happens.", 40, 128),
  );
  const details = { by: "number", regions: [{ page: 1, x0: 300, x1: 560, y0: 90, y1: 200 }, { page: 2, x0: 36, x1: 300, y0: 60, y1: 200 }] };
  const { paras, unmatched } = rollTableDetails(new Map([[1, pd1], [2, pd2]]), details, gridBandParas(pd1, GRID, where), 1, "qq.table");
  assert.equal(unmatched, 0, "a body line ending on a number is no key at all");
  assert.deepEqual(paras.map((p) => `${p.section}${p.detail ? "+" : ""}${p.page ? `@${p.page}` : ""}`),
    ["r1-2", "r1-2+", "r1-2+", "r3", "r3+", "r3+@2", "r4", "r4+@2"],
    "a body line ending on a number opens nothing; the overleaf region's head continues the open block");
  const out = await readRows({ 1: pd1, 2: pd2 }, paras);
  assert.deepEqual(out.filter((p) => p.detail).map((p) => p.text), [
    "QQ ENCOUNTERS 1-2. The party meets QQ. They are friendly.",
    "They number 2.",
    "QQ ENCOUNTER 3. QQ A lone QQ waits by the old well, silent. It flees if hurt.",
    "QQ ENCOUNTER 4. Nothing happens.",
  ], "a block turning the page mid-sentence reads as one paragraph");
});

await ta("name-keyed details find their row by its folded cell text", async () => {
  const pd = page(
    run("1", 32, 100), run("QQ Raiders", 62, 100),
    run("2", 32, 112), run("QQ Pilgrims", 62, 112),
    run("3", 32, 124), run("QQ Fog", 62, 124),
    run("QQ pilgrims:", 305, 100), run("They sing QQ hymns.", 370, 100),
    run("They pray at dusk.", 305, 112),
    run("QQ RAIDERS:", 305, 136), run("They strike at dawn.", 370, 136),
    run("Nobody is spared.", 305, 148),
  );
  const { paras } = rollTableDetails(new Map([[1, pd]]), { by: "name", regions: [{ page: 1, x0: 300, x1: 560, y0: 90, y1: 200 }] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  const out = await readRows({ 1: pd }, paras);
  assert.deepEqual(out.map((p) => [p.section, p.text]), [
    ["r1", "QQ Raiders"],
    ["r1", "QQ RAIDERS: They strike at dawn. Nobody is spared."],
    ["r2", "QQ Pilgrims"],
    ["r2", "QQ pilgrims: They sing QQ hymns. They pray at dusk."],
    ["r3", "QQ Fog"],
  ], "rows keep row order whatever order the details print in; the label stays");
});

t("a name label that begins with a row's cell text is that row's; the longest cell wins; never the reverse", () => {
  const rows = [run("1", 32, 100), run("QQ Ambush", 62, 100), run("2", 32, 112), run("QQ Ambush Camp", 62, 112), run("3", 32, 124), run("QQ Fog", 62, 124)];
  const REGION = { page: 1, x0: 300, x1: 560, y0: 90, y1: 200 };
  const pd = page(
    ...rows,
    run("QQ Ambush Site:", 305, 100), run("QQ text one.", 390, 100),
    run("QQ more text.", 305, 112),
    run("QQ Ambush Camp Fire:", 305, 136), run("QQ text two.", 410, 136),
    run("QQ more text.", 305, 148),
  );
  const { paras } = rollTableDetails(new Map([[1, pd]]), { by: "name", regions: [REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  assert.deepEqual(paras.filter((p) => p.detail).map((p) => p.section), ["r1", "r2"]);
  const short = page(...rows, run("QQ Fo:", 305, 100), run("QQ text.", 340, 100));
  const read = rollTableDetails(new Map([[1, short]]), { by: "name", regions: [REGION] }, gridBandParas(short, GRID, where), 1, "qq.table");
  assert.deepEqual([read.unmatched, read.skipped, read.paras.filter((p) => p.detail).length], [1, 1, 0], "a label shorter than the cell opens nothing");
});

await ta("a key or label that opens nothing stays in the open block as text and is counted", async () => {
  // Row 3-4's block holds a sub-table numbered from 1 and a key no row has;
  // neither opens a block, and row 6 still opens after them.
  const pd = rowsPage(
    run("(3-4)", 305, 100), run("QQ bandits wait.", 340, 100),
    run("QQ more of them.", 305, 112),
    run("(2)", 305, 136), run("QQ sub-table line.", 325, 136),
    run("QQ its second line.", 305, 148),
    run("(9)", 305, 172), run("QQ another sub line.", 325, 172),
    run("QQ its second line.", 305, 184),
    run("(6)", 305, 208), run("QQ ghosts.", 325, 208),
    run("QQ more ghosts.", 305, 220),
  );
  const read = rollTableDetails(new Map([[1, pd]]), { by: "number", regions: [NUMBER_REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  assert.deepEqual([read.unmatched, read.skipped], [2, 0]);
  const out = await readRows({ 1: pd }, read.paras);
  assert.deepEqual(out.filter((p) => p.detail).map((p) => [p.section, p.text]), [
    ["r3-4", "QQ bandits wait. QQ more of them."],
    ["r3-4", "(2) QQ sub-table line. QQ its second line."],
    ["r3-4", "(9) QQ another sub line. QQ its second line."],
    ["r6", "QQ ghosts. QQ more ghosts."],
  ], "a key that opens nothing keeps its own text");
  const named = rowsPage(
    run("QQ wolves:", 305, 100), run("QQ a pack.", 360, 100),
    run("QQ more wolves.", 305, 112),
    run("QQ sentry:", 305, 136), run("QQ invented figures.", 360, 136),
    run("QQ more figures.", 305, 148),
  );
  const byName = rollTableDetails(new Map([[1, named]]), { by: "name", regions: [NUMBER_REGION] }, gridBandParas(named, GRID, where), 1, "qq.table");
  assert.equal(byName.unmatched, 1);
  assert.deepEqual(byName.paras.filter((p) => p.detail).map((p) => p.section), ["r2", "r2"], "a run-in label matching no row stays in the open block");
});

t("paragraphs before the first opener are skipped; a region overlapping the rows is a compile error", () => {
  const pd = rowsPage(run("QQ loose text.", 305, 100), run("QQ loose more.", 305, 112), run("(2)", 305, 136), run("QQ text.", 325, 136), run("QQ more.", 305, 148));
  const read = rollTableDetails(new Map([[1, pd]]), { by: "number", regions: [NUMBER_REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  assert.deepEqual([read.skipped, read.unmatched, read.paras.filter((p) => p.detail).map((p) => p.section)], [1, 0, ["r2"]]);
  const clean = rowsPage(...numberColumn);
  assert.throws(
    () => rollTableDetails(new Map([[1, clean]]), { by: "number", regions: [{ page: 1, x0: 20, x1: 560, y0: 90, y1: 300 }] }, gridBandParas(clean, GRID, where), 1, "qq.table"),
    /overlaps the table's rows/,
  );
});

await ta("number openers inside one gap-less paragraph each start a paragraph of their own", async () => {
  // Every line 12pt apart: the paragraph builder sees one paragraph.
  const pd = rowsPage(
    run("(2)", 305, 100), run("QQ wolves prowl.", 325, 100),
    run("QQ more wolves.", 305, 112),
    run("(3-4)", 305, 124), run("QQ bandits wait.", 340, 124),
    run("QQ more bandits.", 305, 136),
    run("(6)", 305, 148), run("QQ ghosts wail.", 325, 148),
    run("QQ more ghosts.", 305, 160),
  );
  const read = rollTableDetails(new Map([[1, pd]]), { by: "number", regions: [NUMBER_REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  assert.deepEqual([read.unmatched, read.skipped], [0, 0]);
  const out = await readRows({ 1: pd }, read.paras);
  assert.deepEqual(out.filter((p) => p.detail).map((p) => [p.section, p.text]), [
    ["r2", "QQ wolves prowl. QQ more wolves."],
    ["r3-4", "QQ bandits wait. QQ more bandits."],
    ["r6", "QQ ghosts wail. QQ more ghosts."],
  ]);
});

await ta("name labels inside one gap-less paragraph each start a paragraph of their own", async () => {
  const pd = rowsPage(
    run("QQ wolves:", 305, 100), run("QQ a pack.", 360, 100),
    run("QQ more of them.", 305, 112),
    run("QQ bandits:", 305, 124), run("QQ a gang.", 365, 124),
    run("QQ more of them.", 305, 136),
    run("QQ ghosts:", 305, 148), run("QQ a haunt.", 360, 148),
    run("QQ more of them.", 305, 160),
  );
  const read = rollTableDetails(new Map([[1, pd]]), { by: "name", regions: [NUMBER_REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  const out = await readRows({ 1: pd }, read.paras);
  assert.deepEqual(out.filter((p) => p.detail).map((p) => [p.section, p.text]), [
    ["r2", "QQ wolves: QQ a pack. QQ more of them."],
    ["r3-4", "QQ bandits: QQ a gang. QQ more of them."],
    ["r6", "QQ ghosts: QQ a haunt. QQ more of them."],
  ]);
});

await ta("a number key printed before the open row inside a paragraph does not split it", async () => {
  const pd = rowsPage(
    run("(5)", 305, 100), run("QQ quiet times.", 325, 100),
    run("QQ more quiet.", 305, 112),
    run("(2)", 305, 124), run("QQ sub line.", 325, 124),
    run("QQ the end.", 305, 136),
  );
  const read = rollTableDetails(new Map([[1, pd]]), { by: "number", regions: [NUMBER_REGION] }, gridBandParas(pd, GRID, where), 1, "qq.table");
  assert.deepEqual([read.unmatched, read.skipped], [0, 0], "a key inside a paragraph that opens nothing is not counted");
  const out = await readRows({ 1: pd }, read.paras);
  assert.deepEqual(out.filter((p) => p.detail).map((p) => [p.section, p.text]), [
    ["r5", "QQ quiet times. QQ more quiet. (2) QQ sub line. QQ the end."],
  ]);
});

await ta("a die with no cell text is an error naming the die, unless the band keeps it empty", async () => {
  const pd = rowsPage(run("7", 32, 148));
  assert.throws(() => gridBandParas(pd, GRID, where), /grid row "7" on p\.1 has no cell text/);
  const rows = gridBandParas(pd, { ...GRID, keepEmpty: true }, where);
  const last = rows[rows.length - 1];
  assert.equal(last.section, "r7");
  assert.equal(last.empty, true);
  assert.ok(rows.slice(0, -1).every((p) => !p.empty), "only the empty row is marked");
  const out = await readRows({ 1: pd }, rows);
  assert.deepEqual(out[out.length - 1], { type: "paragraph", section: "r7", empty: true, text: "" });
  const claimed = gridBandParas(pd, { ...GRID, keepEmpty: true, claimDie: true }, where);
  assert.equal(claimed[claimed.length - 1].empty, true, "a claimed die is not the row's text");
});

t("a centred die mirrors its cell's top line onto its bottom, whatever the cells' heights", () => {
  // Row 1's cell runs four lines with its die centred between the second and
  // third; row 2 is one line. A midpoint cut between the two dies would hand
  // row 1's last line to row 2; the mirror of row 1's top line about its die
  // is its fourth line. Authored bands say the same by hand.
  const pd = page(
    run("QQ one", 62, 100), run("QQ two", 62, 112), run("1", 32, 118), run("QQ three", 62, 124), run("QQ four", 62, 136),
    run("2", 32, 150), run("QQ five", 62, 150),
  );
  const text = (paras) => paras.map((p) => pd.items.filter((it) => it.x >= p.box.x0 && it.x <= p.box.x1 && it.y >= p.box.y0 && it.y <= p.box.y1 && it.x >= 60).map((it) => it.str).join(" "));
  const mirrored = gridBandParas(pd, { ...GRID, centerDies: true }, where);
  assert.deepEqual(mirrored.map((p) => p.section), ["r1", "r2"]);
  assert.deepEqual(text(mirrored), ["QQ one QQ two QQ three QQ four", "QQ five"]);
  const banded = gridBandParas(pd, { ...GRID, bands: [[95, 140], [145, 155]] }, where);
  assert.deepEqual(banded.map((p) => p.section), ["r1", "r2"]);
  assert.deepEqual(text(banded), ["QQ one QQ two QQ three QQ four", "QQ five"]);
  assert.throws(() => gridBandParas(pd, { ...GRID, bands: [[95, 155]] }, where), /band 1 \[95, 155\] on p\.1 holds 2 dice/);
  assert.throws(() => gridBandParas(pd, { ...GRID, bands: [[95, 140], [160, 170]] }, where), /band 2 .* holds 0 dice/);
});

await ta("centred dies cut an uneven column in order, read a fused die off its run, and err on a line left over", async () => {
  // Row 1-2 is three lines with its die on the middle one; row 3 is one line
  // whose die the printer fused with its text; row 4 is two lines with its
  // die between them.
  const column = [
    run("QQ a1", 62, 100), run("1-2", 32, 111), run("QQ a2", 62, 111), run("QQ a3", 62, 122),
    run("3 QQ b1", 32, 138),
    run("QQ c1", 62, 154), run("4", 32, 159.5), run("QQ c2", 62, 165),
  ];
  const pd = page(...column);
  const rows = gridBandParas(pd, { ...GRID, centerDies: true }, where);
  const out = await readRows({ 1: pd }, rows);
  assert.deepEqual(out.map((p) => [p.section, p.text]), [["r1-2", "QQ a1 QQ a2 QQ a3"], ["r3", "QQ b1"], ["r4", "QQ c1 QQ c2"]]);
  const lineMode = await readRows({ 1: pd }, gridBandParas(pd, GRID, where));
  assert.equal(lineMode[0].text, "QQ a2 QQ a3", "the die-line mode loses the line above the die");
  assert.equal(lineMode[1].text, "QQ b1 QQ c1", "and a fused die is a die in every mode");
  const stray = page(...column, run("QQ stray", 62, 190));
  assert.throws(() => gridBandParas(stray, { ...GRID, centerDies: true }, where), /a line at y190 on p\.1 follows the last row of the band ending at y200/);
  const unmirrored = page(run("QQ a1", 62, 100), run("1", 32, 111), run("QQ a2", 62, 111));
  assert.throws(() => gridBandParas(unmirrored, { ...GRID, centerDies: true }, where), /die "1" at y111 on p\.1 mirrors its top line y100 onto y122, where no line prints/);
});

await ta("the throw pattern reads the first <n>+, never a die's faces or a modifier", async () => {
  const pd = page(
    run("1d6+2 QQ, throw 11+ to QQ", 20, 100),
    run("QQ +2 bonus, 14+ QQ", 20, 200),
    run("QQ no target here", 20, 300),
  );
  const box = (y) => ({ x0: 0, x1: 400, y0: y - 3, y1: y + 3 });
  const cookbook = {
    schema: "acks-cookbook/3",
    entries: { "qq.throws": { kind: "kind.rolltable", fields: {
      a: { op: "value", page: 1, box: box(100), pattern: "throw" },
      b: { op: "value", page: 1, box: box(200), pattern: "throw" },
      c: { op: "value", page: 1, box: box(300), pattern: "throw" },
      d: { op: "value", page: 1, box: box(100), pattern: "int" },
    } } },
  };
  const node = await executeEntry(null, cookbook, {}, "qq.throws", { pageCache: new Map([[1, pd]]) });
  assert.deepEqual([node.fields.a, node.fields.b, node.fields.c], [11, 14, null]);
  assert.equal(node.fields.d, 1, "int reads the die count, which is why throw exists");
});

console.log(`\n${n} tests passed`);
