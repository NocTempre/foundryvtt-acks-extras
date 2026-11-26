/**
 * Offline tests for the light rows the spells register authors on the two
 * illumination spells (the timed form and the perpetual form): each carries a
 * light row of its own form and a reversed twin, the row locates every band's
 * reach from the Judge's own copy and ships no figure, and a miss leaves the
 * band blank and listed. The rows are read from the register and from the
 * compiled cookbook; their locators run through the importer's own
 * `materializeEffects` against fixtures holding only the words each pattern reads, so
 * this file carries no book content. Foundry-free.
 *
 * Usage: node tools/test-magic-light-rows.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { materializeEffects } from "../scripts/importer/executor.mjs";
import { spellRecipeProblems } from "./importer/spell-recipe-rules.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const register = read("register/rr/p196-p262-spells.json");
const cookbook = read("cookbook/spells.json").entries;

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const TIMED = "def.spell.illumination";
const PERPETUAL = "def.spell.illuminationPerpetual";
const rowsOf = (id) => register.find((e) => e.id === id)?.effects ?? [];
const lightOf = (id) => rowsOf(id).find((r) => r.key === "light");
const located = (id, ...lines) => materializeEffects(rowsOf(id), lines.map((text) => ({ text })))[0];
const intoOf = (row) => (row.from ?? []).map((loc) => loc.into);

t("both light spells carry a light row of their own form and a reversed twin", () => {
  for (const id of [TIMED, PERPETUAL]) {
    const rows = rowsOf(id);
    assert.deepEqual(rows.map((r) => [r.key, r.type, r.reversed === true, r.lasts]), [["light", "light", false, "duration"], ["lightReversed", "light", true, "duration"]], id);
    assert.equal(rows[0].onMiss, "blank", `${id}: a missed band leaves the band blank and the row kept`);
    assert.equal(rows[1].from, undefined, `${id}: the reverse form's row locates nothing, so its radii never land on the darkness row`);
  }
});

t("each light row locates its bands and ships none: no figure rides in the recipe, in the register or as compiled", () => {
  assert.deepEqual(intoOf(lightOf(TIMED)), ["lightBands.bright", "lightBands.dim"], "the timed form prints no daylight band, so none is located");
  assert.deepEqual(intoOf(lightOf(PERPETUAL)), ["lightBands.daylight", "lightBands.bright", "lightBands.dim"]);
  for (const id of [TIMED, PERPETUAL]) {
    assert.ok(!rowsOf(id).some((r) => "lightBands" in r), `${id}: no row states its bands`);
    assert.deepEqual(spellRecipeProblems({ effects: rowsOf(id) }), [], `${id} register`);
    assert.deepEqual(spellRecipeProblems({ effects: cookbook[id].fields.effects.specs }), [], `${id} cookbook`);
    assert.deepEqual(cookbook[id].fields.effects.specs, rowsOf(id), `${id}: the compiled specs are the register's`);
  }
});

t("the rules refuse a light row that states a band, and a sum switch on a field that is no figure", () => {
  const row = { key: "light", type: "light", appliesTo: "area", lasts: "duration" };
  assert.match(spellRecipeProblems({ effects: [{ ...row, lightBands: { bright: 15 } }] }).join("\n"), /lightBands/);
  assert.match(spellRecipeProblems({ effects: [{ ...row, from: [{ into: "lightBands.bright", pattern: "(\\d+)", per: 5 }] }] }).join("\n"), /per is a literal figure/);
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...row, from: [{ into: "lightBands.bright", sumGroups: true, pattern: "(\\d+)\\D+(\\d+)" }] }] }), []);
  assert.match(spellRecipeProblems({ effects: [{ ...row, from: [{ into: "lightBands.bright", sumGroups: 2, pattern: "(\\d+)" }] }] }).join("\n"), /sumGroups is true or absent/);
  assert.match(spellRecipeProblems({ effects: [{ ...row, from: [{ into: "roll", sumGroups: true, pattern: "(\\d+)" }] }] }).join("\n"), /sumGroups adds figures/);
});

/** The words the two timed locators read, each after a filler word, with the curly apostrophe extraction leaves. */
const TIMED_PROSE = "Zzz sheds bright light out to a 11’ radius. Zzz dim light to a 23’ radius.";
/** The same band words in an order the locators must not read: no band is located from it. */
const TIMED_MISPLACED = "Zzz sheds dim light out to a 11’ radius. Zzz bright light to a 23’ zzz.";

t("the timed form's bright and dim reach are read from its own sentence, as integers", () => {
  const row = located(TIMED, TIMED_PROSE, TIMED_MISPLACED);
  assert.deepEqual(row.lightBands, { bright: 11, dim: 23 });
  assert.equal(row.unread, undefined);
  assert.equal(row.reversed, undefined, "the forward row is the one that read the bands");
});

t("band words out of the locators' order never feed a band, whichever order the paragraphs come in, and a straight apostrophe or a welded seam still reads", () => {
  assert.deepEqual(located(TIMED, TIMED_MISPLACED, TIMED_PROSE).lightBands, { bright: 11, dim: 23 });
  const [row] = materializeEffects(rowsOf(TIMED), [{ text: TIMED_MISPLACED }]);
  assert.equal(row.lightBands, undefined, "a page that prints only the darkness reads no light");
  assert.deepEqual(row.unread, ["lightBands.bright", "lightBands.dim"]);
  assert.deepEqual(located(TIMED, "Zzz sheds bright light out to a 11' radius. Zzz dim light to a 23' radius.").lightBands, { bright: 11, dim: 23 });
  assert.deepEqual(located(TIMED, "Zzzshedsbrightlightoutto a 11’radius.Zzzdimlightto a 23’radius.").lightBands, { bright: 11, dim: 23 });
});

t("a bookless import keeps the row with every timed band unread", () => {
  const [row] = materializeEffects(rowsOf(TIMED), []);
  assert.equal(row.lightBands, undefined);
  assert.deepEqual(row.unread, ["lightBands.bright", "lightBands.dim"]);
  assert.equal(row.type, "light");
});

/** The words the three perpetual locators read (an outer band as an increment over the inner one, the last with its total), with invented figures. */
const PERPETUAL_PROSE = "Zzz produces full daylight out to 10’; bright torchlight out to an additional 6’; dim light out to an additional 4’ beyond that (20’ total). Zzz.";
/** The same band words in an order the locators must not read: no band is located from it. */
const PERPETUAL_MISPLACED = "Zzz produces dim light out to 10’; full daylight out to an additional 6’; bright torchlight out to 20’ total.";

t("the perpetual form reads daylight, sums its bright increment over the daylight band, and reads the printed total for dim", () => {
  const row = located(PERPETUAL, PERPETUAL_PROSE, PERPETUAL_MISPLACED);
  assert.deepEqual(row.lightBands, { daylight: 10, bright: 16, dim: 20 });
  assert.equal(row.unread, undefined);
  assert.deepEqual(located(PERPETUAL, PERPETUAL_MISPLACED, PERPETUAL_PROSE).lightBands, { daylight: 10, bright: 16, dim: 20 });
  assert.deepEqual(located(PERPETUAL, PERPETUAL_PROSE.replace("torchlight", "torch light").replaceAll("’", "'")).lightBands, { daylight: 10, bright: 16, dim: 20 }, "a split word and straight apostrophes still read");
});

t("the perpetual form leaves a band blank and listed when its sentence is not as expected, and never writes a part sum", () => {
  const [row] = materializeEffects(rowsOf(PERPETUAL), [{ text: PERPETUAL_PROSE.replace("an additional 6’", "an additional amount") }]);
  assert.deepEqual(row.lightBands, { daylight: 10, dim: 20 });
  assert.deepEqual(row.unread, ["lightBands.bright"], "the daylight figure alone is not the bright band");
  const [none] = materializeEffects(rowsOf(PERPETUAL), [{ text: PERPETUAL_MISPLACED }]);
  assert.equal(none.lightBands, undefined);
  assert.deepEqual(none.unread, ["lightBands.daylight", "lightBands.bright", "lightBands.dim"]);
});

console.log(`\n${n} tests passed`);
