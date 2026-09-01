/**
 * How a printed name on a class spread resolves to a definition.
 *
 * Foundry-free and book-free: every entry below is invented, because what is
 * under test is the ARBITRATION — which candidate wins a collision, how an
 * authored alias behaves, and that the list path and the cell path cannot
 * disagree. The shipped cookbook's own surfaces are checked by
 * test-cookbook-coherence.
 */
import assert from "node:assert";
import { abilitySurfaceIndex, tokenizeProfs } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const entry = (name, kind, extra = {}) => ({ name, kind, ...extra });
const ENTRIES = [
  ["def.prof.artCraft", entry("Art/Craft", "kind.proficiency", { aliases: ["Art", "Craft"] })],
  ["def.power.artificialYouth", entry("Artificial Youth", "kind.power")],
  ["def.prof.crafting", entry("Crafting", "kind.proficiency")],
  ["def.prof.climbing", entry("Climbing", "kind.proficiency")],
  ["def.skill.climbing", entry("Climbing", "kind.skill")],
  ["def.prof.acrobatics", entry("Acrobatics", "kind.proficiency")],
  ["def.power.acrobatics", entry("Acrobatics", "kind.power")],
  ["def.prof.fightingStyleSpecialization", entry("Fighting Style Specialization", "kind.proficiency", { aliases: ["Fighting Style Spec"] })],
  ["def.prof.siegeEngineering", entry("Siege Engineering", "kind.proficiency")],
  ["def.language.orc", entry("Orc", "kind.language")],
  ["def.equip.lock", entry("Lock", "kind.equipment")],
];

const { byKey, menu } = abilitySurfaceIndex(ENTRIES);
const ref = (printed) => byKey.get(String(printed).toLowerCase().replace(/[^a-z0-9]/g, ""))?.ref ?? null;

/* --- what a printed name resolves to --- */

check("an authored alias resolves to the entry that owns it", ref("Art") === "def.prof.artCraft" && ref("Craft") === "def.prof.artCraft");
check("the entry's own name still resolves", ref("Art/Craft") === "def.prof.artCraft");
check("a same-named proficiency beats a skill", ref("Climbing") === "def.prof.climbing");
check("a same-named proficiency beats a power", ref("Acrobatics") === "def.prof.acrobatics");
check("a collision is reported as one", byKey.get("climbing").ambiguous === true && byKey.get("acrobatics").ambiguous === true);
check("an uncollided name is not reported ambiguous", byKey.get("craft").ambiguous === false);
check("languages stay out of the name index", ref("Orc") === null);
check("equipment stays out of the name index", ref("Lock") === null);

/* --- one decision, two paths --- */

// The defect this file exists for: the list path and the cell path used to be
// two indexes that arbitrated differently, so a cell granted the power while
// the list granted the proficiency.
for (const [key, hit] of byKey) {
  const fromMenu = menu.find((m) => String(m.surface).toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  assert.equal(fromMenu?.ref, hit.ref, `the two paths disagree about "${key}"`);
}
pass++;

/* --- tokenizing a cell --- */

const tok = (cell) => tokenizeProfs(cell, menu);

check("a longer name outranks a short alias inside it", tok("Artificial Youth")[0]?.ref === "def.power.artificialYouth");
check("a longer name is not eaten by a short alias at its head", tok("Crafting")[0]?.ref === "def.prof.crafting");
check("a bare alias still resolves on its own", tok("Craft")[0]?.ref === "def.prof.artCraft");

// The alias carries a truncation the books print with a period, so it must
// consume the period AND refuse the longer word it abbreviates.
const style = tok("Fighting Style Spec. (weapon & shield)Siege Engineering");
check("an abbreviated name resolves through its alias", style[0]?.ref === "def.prof.fightingStyleSpecialization");
check("the selection after the abbreviation survives", style[0]?.selection === "weapon & shield");
check("the next entry in the same cell is still found", style[1]?.ref === "def.prof.siegeEngineering");
const spelled = tok("Fighting Style Specialization (two-handed)");
check("the unabbreviated form resolves and keeps its selection", spelled[0]?.ref === "def.prof.fightingStyleSpecialization" && spelled[0]?.selection === "two-handed");

check("a rank digit is read", tok("Craft (armor-making) 3")[0]?.rank === 3);
check("a cell reports the printed name, not the alias it matched", tok("Craft")[0]?.name === "Art/Craft");

console.log(`test-ability-names: ${pass} checks passed.`);
