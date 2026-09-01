/**
 * Regression suite for the RECIPE ENGINE — `materializeEffects` and
 * `materializeRolls`.
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
import { materializeEffects, materializeRolls } from "../../scripts/importer/executor.mjs";

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

console.log(`\n${n} tests passed`);
