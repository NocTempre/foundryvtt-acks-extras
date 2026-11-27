/**
 * The Strength modifier table a monster's natural attacks take (`strengthAttack`
 * of the `monsters` registry document): the recipe's read of a grid whose header
 * row is a row of its own, the bands parsed from that header, the band an
 * average falls in (an average between two bands is in the lower), and the
 * modifier a score and an average give.
 *
 * Foundry-free and book-free. Every band, score and figure below is invented: no
 * page prints this grid, so nothing here reproduces a table. What this pins is
 * the procedure: the header cell is the page's, a gap between bands is the lower
 * band's, and a figure the table does not give answers null.
 * Run: node tools/test-strength-attack.mjs
 */
import assert from "node:assert/strict";
import { extractTable } from "../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";
import { strengthAttackBonus, strengthBandFor, strengthBands, STRENGTH_DOC } from "../scripts/monsters/strength-attack.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const same = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b));

const register = (tables, priority = PRIORITY.WORLD, pages = "XX 7") => registerTable({ id: STRENGTH_DOC, source: { pages }, tables }, { priority });

/* --- the recipe, on invented runs --------------------------------------------- */
{
  const recipe = TABLE_RECIPES.monsters.tables.strengthAttack;
  const run = (str, x, y, w = str.length * 5) => ({ str, x, y, w, h: 9 });
  // Two-line header cells centred on the header's own line, a score label
  // narrower than the header's, and prose below the grid's window.
  const runs = [
    run("Attribute", 77, 474), run("4 or", 132, 468), run("less", 133, 480),
    run("5 – 9", 169, 474), run("10 – 11", 204, 474), run("12 – 30", 239, 474),
    run("31 or", 280, 468), run("more", 281, 480),
    run("2", 95, 492), run("1", 137, 492), run("2", 175, 492), run("3", 212, 492), run("4", 250, 492), run("5", 288, 492),
    run("3", 95, 504), run("-1", 137, 504), run("−2", 175, 504), run("+3", 212, 504), run("-", 250, 504), run("6", 288, 504),
    run("Prose below the grid", 77, 700),
  ];
  const out = extractTable(runs, recipe);
  same("the header row is a row of its own, its two-line cells joined", { col1: out.attribute.col1, col2: out.attribute.col2, col5: out.attribute.col5 }, { col1: "4 or less", col2: "5 – 9", col5: "31 or more" });
  check("the header row is marked, no score row is", out.attribute.header === true && !("header" in out["2"]));
  same("a score row is keyed by its own label", Object.keys(out).filter((k) => k !== "attribute"), ["2", "3"]);
  same("its cells are whole figures, a typographic minus read as one", [out["3"].col1, out["3"].col2, out["3"].col3], [-1, -2, 3]);
  check("a dash cell is blank", out["3"].col4 === null);
  check("prose below the window is no row", !JSON.stringify(out).includes("Prose"));
}

/* --- nothing imported ---------------------------------------------------------- */
resetTables();
check("no document: no bands", strengthBands() === null);
check("no document: no band for an average", strengthBandFor(3) === null);
check("no document: no bonus", strengthAttackBonus(7, 3) === null);
register({ somethingElse: {} });
check("a document without the table: no bands", strengthBands() === null);
register({ strengthAttack: { __missing: true } });
check("a missing-row placeholder: no bands", strengthBands() === null);

/* --- the bands ----------------------------------------------------------------- */
const header = { col1: "4 or less", col2: "5 - 9", col3: "10–11", col4: "12 — 30", col5: "31 or more", header: true, label: "Attribute" };
const grid = {
  attribute: header,
  2: { col1: 11, col2: 12, col3: 13, col4: 14, col5: 15, label: "2" },
  3: { col1: 1, col2: "-2", col3: "+3", col4: null, col5: "", label: "3" },
  4: { col1: 5, col2: "x", col3: 7, col4: 8, col5: 9, label: "4" },
  5: { __missing: true },
};
register({ strengthAttack: grid });
same("each header cell is a band, whatever dash and spacing it is printed with", strengthBands(), [
  { key: "col1", min: null, max: 4 },
  { key: "col2", min: 5, max: 9 },
  { key: "col3", min: 10, max: 11 },
  { key: "col4", min: 12, max: 30 },
  { key: "col5", min: 31, max: null },
]);
{
  const shuffled = { ...header, col10: "40 or more", col5: "31 - 39" };
  register({ strengthAttack: { ...grid, attribute: shuffled } });
  check("columns are in print order, col10 after col5", strengthBands().map((b) => b.key).join() === "col1,col2,col3,col4,col5,col10");
}
register({ strengthAttack: { ...grid, attribute: { ...header, col3: "ten or so" } } });
check("a header cell that reads as no band leaves no bands", strengthBands() === null);
register({ strengthAttack: { ...grid, attribute: { ...header, col3: "11 - 10" } } });
check("a span whose edges run backwards is no band", strengthBands() === null);
register({ strengthAttack: { 2: grid[2] } });
check("a table with no header row has no bands", strengthBands() === null);
register({ strengthAttack: grid });

/* --- the band an average falls in ---------------------------------------------- */
check("an average inside a band is in it", strengthBandFor(7).key === "col2" && strengthBandFor(12).key === "col4");
check("a band's own edges are in it", strengthBandFor(5).key === "col2" && strengthBandFor(9).key === "col2" && strengthBandFor(4).key === "col1" && strengthBandFor(31).key === "col5");
check("an open first band takes anything below its edge", strengthBandFor(-3).key === "col1" && strengthBandFor(0.5).key === "col1");
check("an open last band takes anything above its edge", strengthBandFor(500).key === "col5");
check("an average between two bands is in the lower", strengthBandFor(4.5).key === "col1" && strengthBandFor(9.5).key === "col2" && strengthBandFor(11.99).key === "col3" && strengthBandFor(30.5).key === "col4");
check("a non-numeric average is in no band", [null, undefined, "7", NaN, Infinity, {}].every((v) => strengthBandFor(v) === null));
{
  register({ strengthAttack: { attribute: { col1: "3 - 4", col2: "6 - 8", header: true } } });
  check("below the first band's lower edge is no band", strengthBandFor(2.5) === null);
  check("above the last band's upper edge is no band", strengthBandFor(8.5) === null && strengthBandFor(20) === null);
  check("a gap between closed bands is the lower band's", strengthBandFor(5).key === "col1" && strengthBandFor(4.5).key === "col1");
  register({ strengthAttack: grid });
}

/* --- the modifier -------------------------------------------------------------- */
{
  const hit = strengthAttackBonus(2, 7);
  same("a score and an average give the cell of the band's column", { value: hit.value, band: hit.band }, { value: 12, band: { key: "col2", min: 5, max: 9 } });
  check("the page the table was read from is the cite", hit.cite === "XX 7");
  check("an average between bands reads the lower band's cell", strengthAttackBonus(2, 9.5).value === 12);
  check("a numeric string cell is its number", strengthAttackBonus(3, 7).value === -2 && strengthAttackBonus(3, 10).value === 3);
  check("a zero cell is a figure, not a blank", (() => { register({ strengthAttack: { ...grid, 6: { col1: 0, col2: "0", col3: 0, col4: 0, col5: 0 } } }); return strengthAttackBonus(6, 2).value === 0 && strengthAttackBonus(6, 7).value === 0; })());
  register({ strengthAttack: grid });
}
check("a score with no row is null", strengthAttackBonus(9, 7) === null && strengthAttackBonus(5, 7) === null);
check("a blank cell is null", strengthAttackBonus(3, 20) === null && strengthAttackBonus(3, 40) === null);
check("a cell that is not a number is null", strengthAttackBonus(4, 7) === null);
check("an average that is no number is null", strengthAttackBonus(2, NaN) === null && strengthAttackBonus(2, "7") === null && strengthAttackBonus(2, null) === null);
check("a score that is no whole number is null", strengthAttackBonus(2.5, 7) === null && strengthAttackBonus("2", 7) === null && strengthAttackBonus(null, 7) === null);
check("the header row is no score row", strengthAttackBonus("attribute", 7) === null);

/* --- a Judge's override -------------------------------------------------------- */
register({ strengthAttack: { attribute: { col1: "1 or less", col2: "2 or more", header: true }, 2: { col1: 90, col2: 91 } } }, PRIORITY.OVERRIDE);
{
  const hit = strengthAttackBonus(2, 7);
  check("the override's bands and cells are read in place of the import", hit.value === 91 && hit.band.key === "col2" && strengthBands().length === 2);
  check("an override has no page to cite", hit.cite === null);
}
resetTables();

process.stdout.write(`strength attack: ${pass} checks passed\n`);
