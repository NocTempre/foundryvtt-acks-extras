/**
 * The printed Hit Dice rating, read into a count, a bonus and the marks —
 * every SHAPE the stat blocks use, with no creature's value among them: a
 * whole rating with a bonus either side, a fraction as a glyph or a slash, a
 * hit-point aside before or after the marks, and the slight creatures that
 * print a hit die or a hit-point total instead of a rating. What the executor
 * hands the binder is the string after "Hit Dice:"; this is what the binder
 * makes of it.
 *
 * Usage: node tools/importer/test-hit-dice.mjs
 */
import assert from "node:assert/strict";
import { parseHitDice } from "../../scripts/importer/stats.mjs";
import { hdFormula } from "../../scripts/lib/actor-read.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

t("a whole rating, with or without a bonus, either way it is spaced", () => {
  assert.deepEqual(parseHitDice("3"), { count: 3, bonus: null, asterisks: null });
  assert.deepEqual(parseHitDice("2+1"), { count: 2, bonus: 1, asterisks: null });
  assert.deepEqual(parseHitDice("2 + 1"), { count: 2, bonus: 1, asterisks: null });
  assert.deepEqual(parseHitDice("1-1"), { count: 1, bonus: -1, asterisks: null });
  assert.deepEqual(parseHitDice("12"), { count: 12, bonus: null, asterisks: null }, "two digits are one number");
});

t("the special-ability marks are counted, before or after a hit-point aside", () => {
  assert.deepEqual(parseHitDice("4**"), { count: 4, bonus: null, asterisks: 2 });
  assert.deepEqual(parseHitDice("2+1 ***"), { count: 2, bonus: 1, asterisks: 3 });
  assert.deepEqual(parseHitDice("1/2* (1d4 hp)"), { count: 0.5, bonus: null, asterisks: 1 });
  assert.deepEqual(parseHitDice("1/2 (2 hp)*"), { count: 0.5, bonus: null, asterisks: 1 });
  assert.deepEqual(parseHitDice("3 (2d8 hp, as thief)"), { count: 3, bonus: null, asterisks: null }, "an aside on a whole rating is ignored");
});

t("a fraction of a die, as a glyph or a slash", () => {
  assert.deepEqual(parseHitDice("1/2"), { count: 0.5, bonus: null, asterisks: null });
  assert.deepEqual(parseHitDice("1/4"), { count: 0.25, bonus: null, asterisks: null });
  assert.deepEqual(parseHitDice("½"), { count: 0.5, bonus: null, asterisks: null });
  assert.deepEqual(parseHitDice("¼**"), { count: 0.25, bonus: null, asterisks: 2 });
});

t("a creature too slight to rate prints its hit die or its hit points; both read as a fraction of a d8", () => {
  assert.deepEqual(parseHitDice("1d4 hp"), { count: 0.5, bonus: null, asterisks: null });
  assert.deepEqual(parseHitDice("1d4 hp*"), { count: 0.5, bonus: null, asterisks: 1 });
  assert.deepEqual(parseHitDice("1d2 hp"), { count: 0.25, bonus: null, asterisks: null });
  const one = parseHitDice("1 hp");
  assert.ok(one.count > 0 && one.count < 1, "a hit-point total is a small fraction");
  assert.equal(parseHitDice("9 hp").count, 1, "never above one die");
});

t("a range or a rating that varies leads with its first number, and no rating is null", () => {
  assert.equal(parseHitDice("3* to 5*").count, 3);
  assert.equal(parseHitDice("varies by rank"), null);
  assert.equal(parseHitDice(""), null);
  assert.equal(parseHitDice(null), null);
  assert.equal(parseHitDice("d8"), null, "no leading rating");
});

t("the binder's formula round-trips the fraction: a half rating rolls a d4", () => {
  const half = parseHitDice("1/2");
  assert.equal(hdFormula({ count: half.count, dieType: 8, bonus: half.bonus ?? 0 }), "1d4");
  const whole = parseHitDice("2+1");
  assert.equal(hdFormula({ count: whole.count, dieType: 8, bonus: whole.bonus ?? 0 }), "2d8+1");
  const penalty = parseHitDice("1-1");
  assert.equal(hdFormula({ count: penalty.count, dieType: 8, bonus: penalty.bonus ?? 0 }), "1d8-1");
});

console.log(`\ntest-hit-dice: ${n} tests passed`);
