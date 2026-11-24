/**
 * What the monsters feature reads of the beastman organisation tables: the
 * village makeup, the leader grades, the special-troop roll bands and the
 * tribal-trait roll bands, from the `monsters` registry document. Foundry-free
 * and book-free: every row, breed, label, figure and page reference below is
 * invented. What this pins is the procedure: a table nothing imported answers
 * empty and uncited, a row keeps its key, printed label and breed columns in
 * order, a band is whole numbers with `min` no more than `max` or null, a
 * leader cell keeps a printed zero apart from nothing printed, a missing-row
 * placeholder and a nameless row are skipped, a Judge's override of one table
 * wins over the import and carries no page, and the other tables stand.
 * Run: node tools/test-organisation.mjs
 */
import assert from "node:assert/strict";
import { ORGANISATION_DOC, ORGANISATION_TABLES, bandCell, importedOrganisation, gradeCell } from "../scripts/monsters/organisation.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const world = (tables, cites = { beastmanVillage: "XX p. 1", beastmanLeaders: "XX p. 1", beastmanSpecialTroops: "XX p. 2", beastmanTraits: "XX p. 3" }) =>
  registerTable({ id: ORGANISATION_DOC, cites, tables }, { priority: PRIORITY.WORLD });
const none = { rows: [], cite: null };

const village = {
  wrangler: { label: "Wrangler", alba: "qq one", brex: "qq two", cyth: null },
  drifter: { label: "Drifter", alba: "qq three", brex: "qq four", cyth: "qq five" },
  row9: { __missing: true },
  nameless: { label: "  ", alba: "x" },
};
const leaders = {
  hostler: {
    label: "Hostler",
    alba: { ac: 13, armour: "felt & hide", hd: "9", hp: 41, die: "1d3", dmg: null },
    brex: { ac: 14, armour: "", hd: "10", hp: 44, die: "1d3", dmg: 0 },
    cyth: { ac: 14, hd: "10", die: "1d3" },
  },
};
const troops = {
  wrangler: { label: "Wrangler", alba: { min: 44, max: 58 }, brex: null, cyth: { min: 27, max: 27 } },
  drifter: { label: "Drifter", alba: { min: 60, max: 99 }, brex: { min: 55, max: 52 }, cyth: { min: "1", max: 2 } },
};
const traits = { sleeper: { label: "Sleeper", alba: { min: 61, max: 62 }, brex: { min: 61.5, max: 62 }, cyth: {} } };

/* --- nothing imported ---------------------------------------------------------- */
resetTables();
let got = importedOrganisation();
check("no document: every table is empty and uncited", JSON.stringify(got) === JSON.stringify({ village: none, leaders: none, troops: none, traits: none }));
world({ sizeSquare: { squares: { feet: 5 } } });
check("a document without the tables is the same state", JSON.stringify(importedOrganisation()) === JSON.stringify({ village: none, leaders: none, troops: none, traits: none }));
resetTables();
world({ beastmanVillage: {}, beastmanLeaders: "text", beastmanSpecialTroops: [], beastmanTraits: { r: { __missing: true } } });
check("an empty, non-object, array or all-missing table reads empty and uncited", Object.values(importedOrganisation()).every((t) => t.rows.length === 0 && t.cite === null));

/* --- imported ------------------------------------------------------------------ */
resetTables();
world({ beastmanVillage: village, beastmanLeaders: leaders, beastmanSpecialTroops: troops, beastmanTraits: traits });
got = importedOrganisation();
check("the tables are the four roles, each with its rows", Object.keys(got).join() === "village,leaders,troops,traits");
check("a row keeps its key and printed label in order; a placeholder and a nameless row are skipped",
  got.village.rows.map((r) => `${r.key}:${r.label}`).join() === "wrangler:Wrangler,drifter:Drifter");
check("a village cell is the printed text, and null where the page prints none", got.village.rows[0].cells.alba === "qq one" && got.village.rows[0].cells.cyth === null
  && Object.keys(got.village.rows[0].cells).join() === "alba,brex,cyth");
check("each table cites the page its own import recorded", got.village.cite === "XX p. 1" && got.troops.cite === "XX p. 2" && got.traits.cite === "XX p. 3");
check("a band is whole numbers, a lone figure both ends, and a dash is null",
  JSON.stringify(got.troops.rows[0].cells) === '{"alba":{"min":44,"max":58},"brex":null,"cyth":{"min":27,"max":27}}');
check("a band with min over max, or a figure that is not a whole number, is null",
  got.troops.rows[1].cells.brex === null && got.troops.rows[1].cells.cyth === null && got.traits.rows[0].cells.brex === null && got.traits.rows[0].cells.cyth === null);
check("a leader cell keeps its printed words and figures", JSON.stringify(got.leaders.rows[0].cells.alba) === '{"ac":13,"armour":"felt & hide","hd":"9","hp":41,"die":"1d3","dmg":null}');
check("a printed modifier of zero stays 0 and an empty armour word is null", got.leaders.rows[0].cells.brex.dmg === 0 && got.leaders.rows[0].cells.brex.armour === null);
check("a leader cell with no hit points is null", got.leaders.rows[0].cells.cyth === null);
check("the cell readers answer null for a non-cell", bandCell(null) === null && bandCell("qq") === null && gradeCell(undefined) === null && gradeCell({ ac: 3, hd: "1", hp: "4" }) === null);

/* --- a Judge's override -------------------------------------------------------- */
registerTable(
  { id: ORGANISATION_DOC, tables: { beastmanSpecialTroops: { alpha: { label: "Alpha", alba: { min: 71, max: 74 }, brex: { min: 75, max: 76 } } } } },
  { priority: PRIORITY.OVERRIDE },
);
got = importedOrganisation();
check("the override replaces its table, and carries no page", got.troops.rows.map((r) => r.key).join() === "alpha" && got.troops.rows[0].cells.brex.max === 76 && got.troops.cite === null);
check("the tables the override leaves alone stand, with their pages", got.village.rows.length === 2 && got.village.cite === "XX p. 1" && got.traits.cite === "XX p. 3" && got.leaders.rows.length === 1);

/* --- the ids ------------------------------------------------------------------- */
check("every table read is one the importer has a recipe for, in the same document",
  Object.values(ORGANISATION_TABLES).every((id) => TABLE_RECIPES[ORGANISATION_DOC]?.tables?.[id]));

resetTables();
console.log(`test-organisation: all ${pass} checks passed`);
