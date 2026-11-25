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
 * wins over the import and carries no page, and the other tables stand. The
 * paragraph tables (troop kinds, equipment, traits) read as rows of plain
 * figures, a figure not read absent; the split, speech and sidebar figures read
 * as one flat map whether stored in page blocks or flat; a printed proficiency word
 * names the one library name it equals or differs from by an English inflection.
 * Run: node tools/test-organisation.mjs
 */
import assert from "node:assert/strict";
import { ORGANISATION_DOC, ORGANISATION_TABLES, bandCell, importedOrganisation, gradeCell, matchProficiency } from "../scripts/monsters/organisation.mjs";
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
const EMPTY = JSON.stringify({ village: none, leaders: none, troops: none, traits: none, troopRules: none, traitRules: none, equipment: none, organisation: { figures: {}, cite: null } });

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
check("no document: every table is empty and uncited", JSON.stringify(got) === EMPTY);
world({ sizeFrontage: { squares: { small: "1 sq" } } });
check("a document without the tables is the same state", JSON.stringify(importedOrganisation()) === EMPTY);
resetTables();
world({ beastmanVillage: {}, beastmanLeaders: "text", beastmanSpecialTroops: [], beastmanTraits: { r: { __missing: true } } });
check("an empty, non-object, array or all-missing table reads empty and uncited", Object.entries(importedOrganisation()).every(([id, t]) => (id === "organisation" ? Object.keys(t.figures).length === 0 : t.rows.length === 0) && t.cite === null));

/* --- imported ------------------------------------------------------------------ */
resetTables();
world({ beastmanVillage: village, beastmanLeaders: leaders, beastmanSpecialTroops: troops, beastmanTraits: traits });
got = importedOrganisation();
check("the tables are the eight roles, each with its rows", Object.keys(got).join() === "village,leaders,troops,traits,troopRules,traitRules,equipment,organisation");
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

/* --- the paragraph tables and the organisation figures ---------------------------- */
resetTables();
const rules = {
  wrangler: { label: "Wrangler", initiative: 3, carry: { tinBell: 17 }, mounts: { alba: "marsh herons", brex: null }, nothing: null, bad: Number.NaN, empty: "  ", none: [], figuresFrom: "elsewhere" },
  drifter: { label: "Drifter" },
  row9: { __missing: true },
  nameless: { label: " ", initiative: 1 },
};
const gear = { tinBell: { label: "Tin Bell", ranks: ["champion"], carry: [{ pct: 31 }, { pct: 9, perHitDie: true, scope: "gang" }], blast: [{ lb: 2, dice: "1d5", radius: 7 }] } };
registerTable(
  { id: ORGANISATION_DOC, cites: { beastmanTroopRules: "XX p. 4", beastmanTraitRules: "XX p. 5", beastmanEquipment: "XX p. 4-6", beastmanOrganisation: "XX p. 7; XX p. 8" },
    tables: { beastmanTroopRules: rules, beastmanTraitRules: { sleeper: { label: "Sleeper", morale: -3, outnumber: [3, 2] } }, beastmanEquipment: gear,
      beastmanOrganisation: { split: { archerShare: 44, archerRound: "down" }, speech: { commonWarrior: 12 }, elite: { battleCite: "RR p.1", gone: null, bad: Number.NaN } } } },
  { priority: PRIORITY.WORLD },
);
got = importedOrganisation();
check("a paragraph row keeps its key and label in order; a placeholder and a nameless row are skipped", got.troopRules.rows.map((r) => `${r.key}:${r.label}`).join() === "wrangler:Wrangler,drifter:Drifter");
check("a row holds the figures its paragraph printed, plain, and nothing else",
  JSON.stringify(got.troopRules.rows[0].figures) === '{"initiative":3,"carry":{"tinBell":17},"mounts":{"alba":"marsh herons"},"figuresFrom":"elsewhere"}');
check("a row whose paragraph was not read holds no figure, and is still a row", JSON.stringify(got.troopRules.rows[1].figures) === "{}");
check("structure survives: lists of keys, lists of chances, lists of blast rows", JSON.stringify(got.equipment.rows[0].figures) === JSON.stringify({ ranks: ["champion"], carry: [{ pct: 31 }, { pct: 9, perHitDie: true, scope: "gang" }], blast: [{ lb: 2, dice: "1d5", radius: 7 }] }));
check("a signed figure and a ratio keep their sign and order", got.traitRules.rows[0].figures.morale === -3 && JSON.stringify(got.traitRules.rows[0].figures.outnumber) === "[3,2]");
check("each paragraph table cites the page its own import recorded", got.troopRules.cite === "XX p. 4" && got.traitRules.cite === "XX p. 5" && got.equipment.cite === "XX p. 4-6");
check("the organisation figures are one flat map across the page blocks, citing every page", JSON.stringify(got.organisation.figures) === '{"archerShare":44,"archerRound":"down","commonWarrior":12,"battleCite":"RR p.1"}' && got.organisation.cite === "XX p. 7; XX p. 8");
check("the four grids stand empty beside them", got.village.rows.length === 0 && got.troops.rows.length === 0);
registerTable({ id: ORGANISATION_DOC, tables: { beastmanOrganisation: { archerShare: 50, wageExtra: 2 }, beastmanEquipment: { alpha: { label: "Alpha", radius: 9 } } } }, { priority: PRIORITY.OVERRIDE });
got = importedOrganisation();
check("an override stored flat reads alike, replaces its table and carries no page", JSON.stringify(got.organisation.figures) === '{"archerShare":50,"wageExtra":2}' && got.organisation.cite === null);
check("an overridden equipment table replaces the import's and carries no page; the other paragraph tables stand",
  got.equipment.rows.map((r) => r.key).join() === "alpha" && got.equipment.cite === null && got.troopRules.rows.length === 2 && got.troopRules.cite === "XX p. 4");

/* --- the ids ------------------------------------------------------------------- */
check("every table read is one the importer has a recipe for, in the same document",
  Object.values(ORGANISATION_TABLES).every((id) => TABLE_RECIPES[ORGANISATION_DOC]?.tables?.[id]));

/* --- the proficiency a printed word names ------------------------------------------ */
const abilities = (...names) => names.map((name) => ({ name }));
const pick = (word, ...names) => matchProficiency(word, abilities(...names))?.name ?? null;
check("an exact fold answers, case, spaces and punctuation aside", pick("Quill-work", "Zed", "quill work") === "quill work");
check("an exact fold beats a longer inflected name", pick("Plorb", "Plorbing", "Plorb") === "Plorb");
check("a word that is a stem of one name answers that name", pick("Plorb", "Zed", "Plorbing") === "Plorbing");
check("a name that is a stem of the word answers (the other direction)", pick("Plorbing", "Zed", "Plorb") === "Plorb");
check("every ending in the set answers", ["s", "es", "ed", "er", "ers", "ing", "ings", "ion", "ions", "ation", "ment", "ance", "ence", "ist"].every((end) => pick("Plorb", `Plorb${end}`) === `Plorb${end}`));
check("two candidates that qualify answer none", pick("Plorb", "Plorbing", "Plorbion") === null);
check("duplicates of one name are not an ambiguity", abilities("Plorbing", "plorbing").length === 2 && pick("Plorb", "Plorbing", "plorbing") === "Plorbing");
check("a short stem answers none even with an ending in the set", pick("Cat", "Cating") === null && pick("Catting", "Cat") === null);
check("a remainder outside the set answers none", pick("Plorb", "Plorbxyz") === null && pick("Plorb", "Plorbingx") === null);
check("a shared beginning that is not a stem answers none", pick("Plorbo", "Plorbing") === null);
check("a true miss answers none", pick("Plorb", "Zed", "Quill work") === null);
check("an empty word or no candidates answers none", pick("") === null && pick("   ", "Zed") === null && matchProficiency("Plorb", null) === null);

resetTables();
console.log(`test-organisation: all ${pass} checks passed`);
