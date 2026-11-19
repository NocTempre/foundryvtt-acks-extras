/**
 * The natural die of a throw (scripts/lib/throws.mjs): the one reader of the
 * general automatic-failure and automatic-success rule.
 *
 * Every figure below is INVENTED for the test and registered the way an import
 * registers it; none is a page's. A figure left in source fails the "nothing
 * imported" cases, which must answer null everywhere.
 *
 * What this pins is the procedure: the natural die is compared against the
 * imported edges and never against a default, success needs a stated
 * proficiency, the die floor is one past the failing edge, a Judge's override
 * answers with no page, and figures that contradict or are no whole number
 * read as nothing.
 */
import assert from "node:assert/strict";
import * as T from "../scripts/lib/tables.mjs";
import { THROWS_DOC, THROW_TABLE, declareThrowTables, dieFloor, isAutoFail, isAutoSucceed, throwFigures, throwsCite } from "../scripts/lib/throws.mjs";

let passed = 0;
const t = (name, fn) => {
  T.unregisterTable(THROWS_DOC);
  fn();
  T.unregisterTable(THROWS_DOC);
  passed++;
  console.log(`ok - ${name}`);
};

/** Invented edges, registered the way an import registers them. */
const importThrows = (cells = { autoFailMax: 3, autoSucceedMin: 18 }, priority = T.PRIORITY.WORLD, pages = "ZZ p. 4") =>
  T.registerTable({ id: THROWS_DOC, source: { pages }, tables: { [THROW_TABLE]: cells } }, { priority });

t("nothing imported: every answer is null and no figure stands in", () => {
  assert.deepEqual(throwFigures(), { failMax: null, succeedMin: null, cite: null });
  assert.equal(throwsCite(), null);
  assert.equal(dieFloor(), null);
  for (const n of [1, 2, 10, 19, 20]) {
    assert.equal(isAutoFail(n), null, `fail ${n}`);
    assert.equal(isAutoSucceed(n, { proficient: true }), null, `succeed ${n}`);
  }
});

t("a declared table with no import answers null", () => {
  declareThrowTables();
  assert.equal(isAutoFail(1), null);
  assert.equal(dieFloor(), null);
});

t("an empty placeholder table answers null everywhere", () => {
  importThrows({});
  assert.deepEqual(throwFigures(), { failMax: null, succeedMin: null, cite: "ZZ p. 4" });
  assert.equal(isAutoFail(1), null);
  assert.equal(isAutoSucceed(20, { proficient: true }), null);
  assert.equal(dieFloor(), null);
});

t("the failing edge decides each natural result, edges included", () => {
  importThrows();
  assert.equal(isAutoFail(1), true);
  assert.equal(isAutoFail(3), true, "the edge itself fails");
  assert.equal(isAutoFail(4), false, "one past it does not");
  assert.equal(isAutoFail(20), false);
  assert.equal(dieFloor(), 4);
});

t("the succeeding edge needs a stated proficiency", () => {
  importThrows();
  assert.equal(isAutoSucceed(18, { proficient: true }), true, "the edge itself succeeds");
  assert.equal(isAutoSucceed(20, { proficient: true }), true);
  assert.equal(isAutoSucceed(17, { proficient: true }), false);
  assert.equal(isAutoSucceed(20, { proficient: false }), false, "an unproficient thrower never does");
  assert.equal(isAutoSucceed(20), null, "no stated proficiency is not assumed");
  assert.equal(isAutoSucceed(20, { proficient: "yes" }), null);
  assert.equal(isAutoSucceed(20, { proficient: undefined }), null);
});

t("one edge imported leaves the other null", () => {
  importThrows({ autoFailMax: 2 });
  assert.equal(isAutoFail(2), true);
  assert.equal(isAutoSucceed(20, { proficient: true }), null);
  T.unregisterTable(THROWS_DOC);
  importThrows({ autoSucceedMin: 19 });
  assert.equal(isAutoFail(1), null);
  assert.equal(dieFloor(), null);
  assert.equal(isAutoSucceed(19, { proficient: true }), true);
});

t("an edge that is no whole number reads as nothing", () => {
  for (const bad of [null, "", "x", 2.5, -1, NaN, Infinity]) {
    T.unregisterTable(THROWS_DOC);
    importThrows({ autoFailMax: bad, autoSucceedMin: bad });
    assert.equal(isAutoFail(1), null, `fail ${String(bad)}`);
    assert.equal(isAutoSucceed(20, { proficient: true }), null, `succeed ${String(bad)}`);
    assert.equal(dieFloor(), null, `floor ${String(bad)}`);
  }
  T.unregisterTable(THROWS_DOC);
  importThrows({ autoFailMax: "4", autoSucceedMin: "17" });
  assert.equal(isAutoFail(4), true, "numeric text");
  assert.equal(dieFloor(), 5);
});

t("a zero failing edge fails nothing and leaves the whole die open", () => {
  importThrows({ autoFailMax: 0, autoSucceedMin: 19 });
  assert.equal(isAutoFail(1), false);
  assert.equal(dieFloor(), 1);
});

t("edges that contradict each other read as neither", () => {
  importThrows({ autoFailMax: 5, autoSucceedMin: 5 });
  assert.deepEqual(throwFigures(), { failMax: null, succeedMin: null, cite: "ZZ p. 4" });
  assert.equal(isAutoFail(1), null);
  assert.equal(isAutoSucceed(20, { proficient: true }), null);
});

t("a natural result that is no whole number answers null", () => {
  importThrows();
  for (const n of [null, undefined, "", "x", 1.5, NaN]) {
    assert.equal(isAutoFail(n), null, `fail ${String(n)}`);
    assert.equal(isAutoSucceed(n, { proficient: true }), null, `succeed ${String(n)}`);
  }
});

t("the cite is the page the import read, and null for a Judge's own edges", () => {
  importThrows();
  assert.equal(throwsCite(), "ZZ p. 4");
  assert.equal(throwFigures().cite, "ZZ p. 4");
  T.unregisterTable(THROWS_DOC);
  T.registerTable({ id: THROWS_DOC, tables: { [THROW_TABLE]: { autoFailMax: 2, autoSucceedMin: 19 } } }, { priority: T.PRIORITY.OVERRIDE });
  assert.equal(isAutoFail(2), true, "an override answers the figures");
  assert.equal(throwsCite(), null, "and holds no page");
});

console.log(`test-throws: ${passed} checks passed.`);
