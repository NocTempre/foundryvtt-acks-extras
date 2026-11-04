/**
 * The delve encounter import: what `delve-encounter-binding.mjs` reads out of
 * its prose window, and the scalar tables formation/constants.mjs
 * `importedEncounterCadence` reads back, per layer.
 *
 * Every sentence and figure here is INVENTED, shaped like prose without being
 * any page's; no value is read off a book.
 */
import assert from "node:assert";
import {
  DELVE_ENCOUNTER_DOC_ID, PRODUCES, applyDelveEncounterImport, assembleDelveEncounterTables, parseDice, parseEvery, parseTarget,
} from "../scripts/importer/delve-encounter-binding.mjs";
import { DELVE_ENCOUNTER_DOC, importedEncounterCadence } from "../scripts/formation/constants.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";
import { PRIORITY, registerTable, unregisterTable } from "../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

/* ------------------------------ parsers ------------------------------ */

const window = "1d8 every 4 turns. an encounter throw of 7+ means trouble. when 9+ is rolled";
eq("the interval is the count after every", parseEvery(window), 4);
eq("the interval in words", parseEvery("2d4 every three turns."), 3);
eq("the interval stops at the full stop", parseEvery("2d4 at dusk. roll every 5 turns"), null);
eq("the target is the first figure with a trailing plus", parseTarget(window), 7);
eq("a die's faces are no target", parseTarget("1d6+ something"), null);
eq("welded seams still read", parseTarget("throwof3+indicates"), 3);
eq("no figures, nothing read", [parseEvery("nothing here"), parseTarget("nothing here"), parseDice("nothing here")], [null, null, null]);
eq("dice read as a formula", parseDice(window), "1d8");
eq("a factor is kept only where asked for", [parseDice("3d4 × 20 to find", { factor: true }), parseDice("3d4 × 20 to find")], ["3d4*20", "3d4"]);
eq("welded dice still read", parseDice("rolling2d10x5feet", { factor: true }), "2d10*5");
eq("a zero die is no die", parseDice("0d6"), null);

/* ------------------------------ assembly ------------------------------ */

const distance = "3d4 × 20 to find how far";
eq("every figure assembles", assembleDelveEncounterTables({ cadenceProse: { cadence: window, distance } }), { die: "1d8", every: 4, target: 7, distance: "3d4*20" });
eq("a figure that did not read costs only itself", assembleDelveEncounterTables({ cadenceProse: { cadence: "once. of 5+" } }), { target: 5 });
eq("the die is read from the throw's own sentence", assembleDelveEncounterTables({ cadenceProse: { cadence: "every 2 turns. then 1d8 of 5+" } }).die, undefined);
eq("nothing read, nothing assembled", assembleDelveEncounterTables({}), {});

/* ------------------------------ wiring ------------------------------ */

eq("the binding answers for the delve's document", DELVE_ENCOUNTER_DOC_ID, DELVE_ENCOUNTER_DOC);
check("both tables are produced from the recipe's raw table", Object.values(PRODUCES[DELVE_ENCOUNTER_DOC]).every((raw) => !!TABLE_RECIPES.delveEncounters.tables[raw]));
check("the recipe reads the windows the binding parses", ["cadence", "distance"].every((key) => TABLE_RECIPES.delveEncounters.tables.cadenceProse.values.some((v) => v.key === key)));
check("no import service, nothing assembled", (await applyDelveEncounterImport()).assembled.length === 0);

/* ------------------------------ the reader ------------------------------ */

const none = { die: null, every: null, target: null, distance: null };
eq("nothing registered, every figure null", importedEncounterCadence(), none);
registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { die: "1d8", every: 6, target: 3, distance: "3d4*20" } }, { priority: PRIORITY.WORLD });
eq("the import is read", importedEncounterCadence(), { die: "1d8", every: 6, target: 3, distance: "3d4*20" });
registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { every: 2, distance: " 2D10 x 5 " } }, { priority: PRIORITY.OVERRIDE });
eq("an override of some tables leaves the rest imported, and a Judge's spelling of dice is rebuilt",
  importedEncounterCadence(), { die: "1d8", every: 2, target: 3, distance: "2d10*5" });
unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.OVERRIDE });
registerTable({ id: DELVE_ENCOUNTER_DOC, tables: { die: "1d8; game.exit()", every: 0, target: "x", distance: "d6" } }, { priority: PRIORITY.WORLD });
eq("a figure that is not what it should be reads as absent, and nothing but dice reaches a roll", importedEncounterCadence(), none);
unregisterTable(DELVE_ENCOUNTER_DOC, { priority: PRIORITY.WORLD });

console.log(`test-delve-encounter-binding: ${pass} checks passed`);
