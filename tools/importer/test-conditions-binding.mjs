/**
 * The conditions binding: raw prose windows → the signed figures
 * `lib/conditions.mjs` reads.
 *
 * Every sentence and every figure below is INVENTED — nothing here is the
 * book's wording or the book's numbers (RR 507-515). What this pins is the
 * reading: a mark before a number decides its sign, a number with no mark takes
 * its direction from the window's own wording and is dropped when the window
 * gives none, shares become fractions strictly inside (0, 1), the one printed
 * heading serves both conditions it names, an unread window leaves its slot
 * absent rather than zero, and the assembler can emit nothing outside the
 * contract `CONDITION_SLOTS` declares.
 */
import assert from "node:assert";
import {
  assembleConditionTables, parseFigure, parseFactor, rawKey, PRODUCES, CONDITIONS_DOC_ID,
  SHARED_HEADING, FACTOR_SLOTS,
} from "../../scripts/importer/conditions-binding.mjs";
import { CONDITION_SLOTS, CONDITIONS_DOC, CONDITIONS_TABLE } from "../../scripts/lib/conditions.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};
const near = (label, got, want) => check(label, typeof got === "number" && Math.abs(got - want) < 1e-9);

/** The assembled rows for one raw table of invented windows. */
const rows = (windows) => assembleConditionTables({ invented: windows }).modifiers ?? {};

/* --------------------------------- signs ---------------------------------- */

eq("a plus mark is a bonus", parseFigure("+9 bonus to the throw"), 9);
eq("a minus mark is a penalty", parseFigure("-7 penalty to the throw"), -7);
eq("a typographic minus is a minus", parseFigure("−6 penalty to the throw"), -6);
eq("an en dash before the figure is a minus", parseFigure("–5 penalty to the throw"), -5);
eq("a mark decides the sign over the wording", parseFigure("-4 bonus, strangely"), -4);
eq("an unmarked figure under a reduction is negative", parseFigure("reduced by 5."), -5);
eq("an unmarked figure under a penalty is negative", parseFigure("a penalty of 8 applies"), -8);
eq("an unmarked figure under a bonus is positive", parseFigure("a bonus of 6 applies"), 6);
eq("an unmarked figure under no wording is unread", parseFigure("the figure is 3 here"), null);
eq("the first figure in the window is the one read", parseFigure("+2 bonus, or a +9 bonus when it flanks"), 2);
eq("no figure is unread", parseFigure("a penalty applies"), null);
eq("an empty or missing window is unread", [parseFigure(""), parseFigure(null), parseFigure(undefined)], [null, null, null]);
eq("a fraction is not read as a figure", parseFigure("1/4 of the usual bonus"), null);

/* -------------------------------- fractions -------------------------------- */

near("a written fraction is its quotient", parseFactor("1/4 the usual rate"), 0.25);
near("a spaced fraction is its quotient", parseFactor("2 / 5 its rate"), 0.4);
near("half is a half", parseFactor("half the usual rate"), 0.5);
near("one-half is a half", parseFactor("one-half the usual rate"), 0.5);
near("one third is a third", parseFactor("one third the usual rate"), 1 / 3);
near("two-thirds is two thirds", parseFactor("two-thirds of the usual rate"), 2 / 3);
eq("halves is not half", parseFactor("it halves its rate"), null);
eq("a share of one or more is refused", [parseFactor("3/2 the rate"), parseFactor("2/2 the rate")], [null, null]);
eq("a share of nothing is refused", parseFactor("0/5 the rate"), null);
eq("no share is unread", [parseFactor("the usual rate"), parseFactor(""), parseFactor(null)], [null, null, null]);

/* ------------------------------- assembly -------------------------------- */

const some = Object.keys(CONDITION_SLOTS)[0];
const [firstSlot] = CONDITION_SLOTS[some];

eq("nothing raw assembles nothing", assembleConditionTables({}), {});
eq("an absent argument assembles nothing", assembleConditionTables(), {});
eq("non-table raw entries are ignored", assembleConditionTables({ a: null, b: 5, c: "text" }), {});

const one = rows({ [rawKey(some, firstSlot)]: FACTOR_SLOTS.has(firstSlot) ? "1/7 of it" : "+3 bonus" });
eq("one window assembles one condition and one slot", Object.keys(one), [some]);
eq("and only that slot", Object.keys(one[some]), [firstSlot]);

// Every slot of the contract, each fed an invented window of the kind it reads.
const everything = {};
for (const [condition, slots] of Object.entries(CONDITION_SLOTS)) {
  if (SHARED_HEADING[condition]) continue;
  for (const slot of slots) everything[rawKey(condition, slot)] = FACTOR_SLOTS.has(slot) ? "1/6 its rate" : "-3 penalty";
}
const full = rows(everything);
eq("every condition the contract names assembles", Object.keys(full).sort(), Object.keys(CONDITION_SLOTS).sort());
for (const [condition, slots] of Object.entries(CONDITION_SLOTS)) {
  eq(`${condition}: exactly the contract's slots`, Object.keys(full[condition]).sort(), [...slots].sort());
}
for (const [condition, row] of Object.entries(full)) {
  for (const [slot, figure] of Object.entries(row)) {
    check(`${condition}.${slot}: a finite number`, Number.isFinite(figure));
    if (FACTOR_SLOTS.has(slot)) check(`${condition}.${slot}: a share inside (0, 1)`, figure > 0 && figure < 1);
  }
}

// Nothing is emitted that the contract does not declare, even when the raw
// reads carry keys of their own.
const stray = rows({ ...everything, strayAll: "+4 bonus", [rawKey(some, "notASlot")]: "+4 bonus", beholdingAll: "+4 bonus" });
eq("a key outside the contract emits nothing", Object.keys(stray).sort(), Object.keys(CONDITION_SLOTS).sort());
for (const [condition, row] of Object.entries(stray)) {
  for (const slot of Object.keys(row)) check(`${condition}.${slot} is in CONDITION_SLOTS`, CONDITION_SLOTS[condition]?.includes(slot));
}

/* ------------------------- the shared heading ------------------------- */

const [shared, source] = Object.entries(SHARED_HEADING)[0];
const both = rows({ [rawKey(source, "all")]: "+5 bonus to the roll" });
eq("the shared row is emitted under both keys", [both[source], both[shared]], [{ all: 5 }, { all: 5 }]);
check("the two rows are separate objects", both[source] !== both[shared]);
eq("the borrower's own windows are never read", rows({ [rawKey(shared, "all")]: "+5 bonus" })[shared], undefined);

/* -------------------------- absent is not zero -------------------------- */

const partial = rows({
  [rawKey("blinded", "surprise")]: "-2 penalty",
  [rawKey("blinded", "attack")]: "the figure is simply 9 here",
  [rawKey("blinded", "proficiency")]: "",
  [rawKey("blinded", "speedFactor")]: "no share is printed",
});
eq("a window that yields nothing leaves its slot absent", partial.blinded, { surprise: -2 });
check("an absent slot is not a zero", !("attack" in partial.blinded) && !("proficiency" in partial.blinded) && !("speedFactor" in partial.blinded));
eq("a condition with no readable window is omitted", rows({ [rawKey("hungry", "all")]: "nothing numeric" }).hungry, undefined);
eq("only unreadable windows assemble nothing at all", assembleConditionTables({ t: { [rawKey("hungry", "all")]: "nothing numeric" } }), {});
eq("a non-string window is skipped", rows({ [rawKey("hungry", "all")]: 4 }).hungry, undefined);

/* ----------- AC and the attacker's side keep the figure's sign ----------- */

const signs = rows({
  [rawKey("disordered", "ac")]: "reduced by 6.",
  [rawKey("berserk", "ac")]: "-2 penalty to AC",
  [rawKey("flanked", "against")]: "gain a +8 bonus",
  [rawKey("hidden", "against")]: "-5 penalty",
  [rawKey("restrained", "perCause")]: "-3 penalty for each",
});
eq("an AC reduced by a figure is that figure negated", signs.disordered.ac, -6);
eq("a penalty to AC is signed as written", signs.berserk.ac, -2);
eq("a bonus to attackers is positive", signs.flanked.against, 8);
eq("a penalty on attackers is negative", signs.hidden.against, -5);
eq("a per-cause penalty is negative", signs.restrained.perCause, -3);

/* ----------------------- the recipes and the map ----------------------- */

check("the document id is the lib's", CONDITIONS_DOC_ID === CONDITIONS_DOC);
const recipe = TABLE_RECIPES[CONDITIONS_DOC_ID];
check("a recipe document exists", !!recipe);
const produced = PRODUCES[CONDITIONS_DOC_ID][CONDITIONS_TABLE];
eq("the producer map names the one engine table", Object.keys(PRODUCES[CONDITIONS_DOC_ID]), [CONDITIONS_TABLE]);
eq("every raw table named is a recipe", produced.filter((id) => !(id in recipe.tables)), []);
eq("every recipe table is named by the map", Object.keys(recipe.tables).filter((id) => !produced.includes(id)), []);

const windowKeys = new Set(Object.values(recipe.tables).flatMap((t) => t.values.map((v) => v.key)));
const wanted = Object.entries(CONDITION_SLOTS).flatMap(([c, slots]) => slots.map((s) => rawKey(SHARED_HEADING[c] ?? c, s)));
eq("every slot the assembler reads has a window in a recipe", [...new Set(wanted)].filter((k) => !windowKeys.has(k)), []);
eq("every window a recipe takes is read by the assembler", [...windowKeys].filter((k) => !wanted.includes(k)), []);

for (const [id, table] of Object.entries(recipe.tables)) {
  check(`${id}: a prose-values table on a cited page`, table.shape === "proseValues" && table.printedPage > 0 && !!table.locate);
  for (const v of table.values) {
    check(`${id}.${v.key}: takes a window`, v.take === "window");
    check(`${id}.${v.key}: anchor is a short label`, v.find.length > 0 && v.find.length < 60);
    check(`${id}.${v.key}: anchor carries no figure`, !/\d/.test(v.find));
  }
}

console.log(`test-conditions-binding: ${pass} checks passed.`);
