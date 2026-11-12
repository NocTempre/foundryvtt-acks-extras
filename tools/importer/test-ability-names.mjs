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
import { abilitySurfaceIndex, bindAbility, loadCookbook, preferredId, rebracket, refForPrintedName, tokenizeProfs } from "../../scripts/importer/cookbook.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";

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

/* --- a stat block's name against the world's holdings --------------------- */
const none = new Set();
const pick = (ids, present = none) => preferredId(ids, present);
check("one candidate is no choice", (() => { const g = pick(["def.prof.climbing"]); return !g.ambiguous && !g.ranked; })());
check("the one the world holds answers outright",
  (() => { const g = pick(["def.prof.acrobatics", "def.power.acrobatics"], new Set(["def.power.acrobatics"])); return g.id === "def.power.acrobatics" && !g.ambiguous && !g.ranked; })());
check("a pick across categories is ranked, not a guess",
  (() => { const g = pick(["def.power.acrobatics", "def.prof.acrobatics"]); return g.id === "def.prof.acrobatics" && g.ranked && !g.ambiguous; })());
check("a tie inside the best category is a guess",
  (() => { const g = pick(["def.power.renownA", "def.power.renownB", "def.drawback.renown"]); return g.id === "def.power.renownA" && g.ambiguous && !g.ranked; })());
check("the ranking reads only what the world holds when it holds several",
  (() => { const g = pick(["def.prof.climbing", "def.skill.climbing", "def.power.climbing"], new Set(["def.skill.climbing", "def.power.climbing"])); return g.id === "def.skill.climbing" && g.ranked; })());

/* --- a specialty whose opening bracket the printing lost ------------------ */
const knows = (name) => ["Siege Engineering", "Art/Craft", "Crafting"].some((n) => n.toLowerCase() === name.toLowerCase());
check("the lost bracket goes back after the longest known name",
  rebracket("Siege Engineering moats) 2", knows) === "Siege Engineering (moats) 2");
check("a one-word name takes the rest as its specialty", rebracket("Crafting tin and brass)", knows) === "Crafting (tin and brass)");
check("a balanced token is left alone", rebracket("Crafting (tin) 2", knows) === "Crafting (tin) 2");
check("a token with no bracket is left alone", rebracket("Crafting 2", knows) === "Crafting 2");
check("words that name nothing are left alone", rebracket("Unheard Of thing)", knows) === "Unheard Of thing)");
check("a bracket with no specialty before it is left alone", rebracket("Crafting)", knows) === "Crafting)");

/* --- a printed name read off the page names the ability ------------------- */

const power = { name: "Ability 3", kind: "kind.power", book: "rr", cite: "RR p.1", meta: {}, fields: {} };
const read = (title, caps) => ({ fields: { name: { ok: true, title, ...(caps ? { caps: true } : {}) } } });
check("a heading's read name wins over the entry's neutral label", bindAbility(power, read("Quillfen Warden:"), "def.power.ability3").name === "Quillfen Warden");
check("a name the page sets in capitals is set as a title", bindAbility(power, read("QUILLFEN WARDEN", true), "def.power.ability3").name === "Quillfen Warden");
check("no name read, the entry's own label stands", bindAbility(power, null, "def.power.ability3").name === "Ability 3");
check("a heading that failed its check names nothing", bindAbility(power, { fields: { name: { ok: false, title: null } } }, "def.power.ability3").name === "Ability 3");

/* --- a row that withholds its printed name is found by its key ------------- */

// Invented register rows: one named, one carrying only `nameKey`, and two keyed
// rows that mean different definitions under one key.
const REGISTERS = {
  tables: {
    powerSource: {
      alpha: [
        { name: "Plain Quill", ref: "def.power.plainQuill" },
        { nameKey: printKey("Fen Warden"), ref: "def.power.ability3" },
        { nameKey: printKey("Mire Hound"), ref: "def.power.ability4" },
      ],
      beta: [{ nameKey: printKey("Mire Hound"), ref: "def.power.ability5" }],
    },
  },
};
globalThis.foundry = { utils: { fetchJsonWithTimeout: async (url) => { if (url.endsWith("registers.json")) return REGISTERS; throw new Error(`404 ${url}`); } } };
const log = console.log;
console.log = () => {};
await loadCookbook();
console.log = log;
check("a named row still resolves by its fold", refForPrintedName("plain-quill") === "def.power.plainQuill");
check("a keyed row resolves by the key of the name the page prints", refForPrintedName("Fen Warden") === "def.power.ability3");
check("the key reads as the fold does: case and punctuation fall away", refForPrintedName("FEN-WARDEN") === "def.power.ability3");
check("a key two definitions answer to resolves to nothing", refForPrintedName("Mire Hound") === null);
check("a name no row holds resolves to nothing", refForPrintedName("Unheard Of") === null && refForPrintedName("") === null);

console.log(`test-ability-names: ${pass} checks passed.`);
