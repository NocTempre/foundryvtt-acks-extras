/**
 * The `throws` document's recipe (books/rr/table-recipes-throws.mjs), run over
 * INVENTED prose: no page is reproduced and every figure below is a stand-in.
 * What this pins is the reading: each figure is located by the clause that
 * leads into it and taken as a whole number, the second sentence's anchor
 * crosses the closing parenthesis of the first, a page whose clauses differ
 * reads neither, a missing figure is absent, and no anchor holds a figure.
 * The real page is read by test-recipe-content, shape only.
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const recipe = TABLE_RECIPES.throws.tables.throwProse;
const page = (lines) => lines.map((str, i) => ({ x: 100, y: 100 + i * 12, str }));
const read = (lines) => extractTable(page(lines), { ...recipe, column: { xMin: 20, xMax: 600 } });

t("the document is a Revised Rulebook one and cites its page", () => {
  assert.equal(recipe.book, "rr");
  assert.equal(TABLE_RECIPES.throws.source.pages, "RR 10");
});

t("each figure is read from the clause before it", () => {
  const out = read([
    "Automatic Success and Failure: Unless otherwise noted, a roll of 4 on a throw",
    "automatically fails. (Some throws may have a wider range of automatic failure.) A roll",
    "of 17 on a throw automatically succeeds if the thrower is proficient in the task.",
  ]);
  assert.deepEqual(out, { autoFailMax: 4, autoSucceedMin: 17 });
});

t("the closing parenthesis and its full stop may be missing from the text layer", () => {
  const out = read(["Unless otherwise noted, a roll of 2 on a throw fails. Some throws have a wider range of automatic failure A roll of 19 on a throw succeeds."]);
  assert.deepEqual(out, { autoFailMax: 2, autoSucceedMin: 19 });
});

t("a page whose clauses differ reads neither figure, and a missing one is absent", () => {
  assert.deepEqual(read(["Dice are thrown in the hall of the mountain king."]), {});
  const one = read(["Unless otherwise noted, a roll of 3 on a throw automatically fails."]);
  assert.deepEqual(one, { autoFailMax: 3 });
});

t("the recipe's anchors name no figure", () => {
  for (const v of recipe.values) assert.ok(!/\d/.test(v.findRe ?? v.find), `${v.key}: the anchor holds a figure`);
});

console.log(`test-throws-recipe: ${passed} checks passed.`);
