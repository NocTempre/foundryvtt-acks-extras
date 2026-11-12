/**
 * The armour limits on abilities: the phrase parsing, the gate, the rows the
 * importer stamps and the actor-side read.
 *
 * Every skill name, rung combination and sentence here is INVENTED, shaped like
 * a table without being the printed one; no value is read off a book.
 */
import assert from "node:assert";
import {
  ARMOUR_LIMIT_KIND, THIEF_LIMITS_TABLE, armourLimitSource, armourLimitedAbilities, ceilingBelow, ceilingOf, importedLimitRow,
  isArmourLimitRow, limitRowsFor, limitsSkill, parseArmourLimits, resolveArmourGate, withImportedLimit,
} from "../scripts/equipment/armour-limits.mjs";
import { armourCeiling } from "../scripts/equipment/proficiency.mjs";
import { gateVerdict } from "../scripts/lib/typed-modifiers.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { BUILDER_DOC_ID } from "../scripts/classes/builder-logic.mjs";

let pass = 0;
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

/** The class-builder document holding an invented `thiefLimits` table at one layer. */
const register = (table, priority = PRIORITY.WORLD, cites = { [THIEF_LIMITS_TABLE]: "XX p.1" }) =>
  registerTable({ id: BUILDER_DOC_ID, source: { pages: "XX 1-2" }, cites, tables: { [THIEF_LIMITS_TABLE]: table } }, { priority });

// An invented page: three skills, a suit of heavy or medium weight refused, a shield refused.
const INVENTED = { skills: "Gliding, Perching and Swooping", forbidden: "heavy or medium armour and not carry a shield", noShield: "a shield. the" };

/* ------------------------------ ceilingBelow ------------------------------ */

eq("the rung below the lowest word named", ceilingBelow("heavy armour"), "medium");
eq("the lowest of several words decides", ceilingBelow("medium or heavy"), "light");
eq("a two-word rung is not also its one-word suffix", ceilingBelow("very light or heavier"), "unarmored");
eq("the same rung under the other spelling", ceilingBelow("unarmoured"), null);
eq("nothing is below the lowest rung", ceilingBelow("unarmored or more"), null);
eq("a phrase naming no ladder word has no rung", ceilingBelow("any armour at all"), null);
eq("an empty phrase has no rung", ceilingBelow(""), null);

/* -------------------------------- ceilingOf -------------------------------- */

// The allowance reading: the heaviest word a clause names, from invented clauses.
eq("the heaviest word named is the rung allowed", ceilingOf("medium armour, very light armour or no armour"), "medium");
eq("the order the words are printed in does not matter", ceilingOf("no armour, or very light, or medium"), "medium");
eq("a two-word rung is not also its one-word suffix", ceilingOf("very light armour"), "veryLight");
eq("no armour alone is the lowest rung", ceilingOf("no armour"), "unarmored");
eq("the same rung under the other spelling", ceilingOf("no armor at all"), "unarmored");
eq("a comparative is no ladder word", ceilingOf("anything lighter"), null);
eq("a phrase naming no ladder word has no rung", ceilingOf("any armour at all"), null);
eq("an empty phrase has no rung", ceilingOf(""), null);

/* ---------------------------- parseArmourLimits ---------------------------- */

eq("every part is read", parseArmourLimits(INVENTED), { names: ["Gliding", "Perching", "Swooping"], armourMax: "light", noShield: true });
eq("a shield window with no shield in it reads false", parseArmourLimits({ ...INVENTED, noShield: "a wand. the" }).noShield, false);
eq("a part that did not read leaves only itself unknown", parseArmourLimits({ skills: "Gliding" }), { names: ["Gliding"], armourMax: null, noShield: null });
eq("a placeholder reads nothing", parseArmourLimits({}), null);
eq("no table reads nothing", parseArmourLimits(null), null);

/* ------------------------------ armourCeiling ------------------------------ */

const suit = (type) => ({ system: { type } });
const gate = { armourMax: "light", noShield: true };
eq("a suit over the rung breaks the limit", armourCeiling({ armor: suit("heavy") }, gate), true);
eq("a suit at the rung does not", armourCeiling({ armor: suit("light") }, gate), false);
eq("no suit does not", armourCeiling({ armor: null }, gate), false);
eq("a shield breaks a limit that refuses it", armourCeiling({ armor: suit("light"), shield: suit("shield") }, gate), true);
eq("a shield is allowed where the limit does not refuse it", armourCeiling({ armor: suit("light"), shield: suit("shield") }, { armourMax: "light", noShield: false }), false);
eq("a shield is allowed where the limit says nothing of it", armourCeiling({ armor: suit("light"), shield: suit("shield") }, { armourMax: "light" }), false);
eq("no rung answers null", armourCeiling({ armor: suit("heavy") }, { noShield: true }), null);
eq("an unknown rung answers null", armourCeiling({ armor: suit("heavy") }, { armourMax: "nonsense" }), null);

/* ----------------------- the table, an override, the source ----------------------- */

resetTables();
eq("nothing imported: no figure", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND }), { armourMax: "", noShield: null });
eq("nothing imported: no source", armourLimitSource(), null);
register(INVENTED);
eq("a row naming no figure takes the imported table's", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND }), { armourMax: "light", noShield: true });
eq("a row stating its own rung ignores the table", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND, armourMax: "heavy" }), { armourMax: "heavy", noShield: null });
eq("a row stating its own rung states its own shield rule", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND, armourMax: "heavy", noShield: true }), { armourMax: "heavy", noShield: true });
eq("a shield rule alone is no figure, so the table answers", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND, noShield: false }), { armourMax: "light", noShield: true });
eq("the import's page is the source", armourLimitSource(), { cite: "XX p.1" });
register({ skills: "Gliding", forbidden: "medium armour", noShield: "a cloak. the" }, PRIORITY.OVERRIDE, {});
eq("an override wins", resolveArmourGate({ kind: ARMOUR_LIMIT_KIND }), { armourMax: "light", noShield: false });
eq("an override is the Judge's, not a page's", armourLimitSource(), { judge: true });
eq("an override's skills are the limited ones", [limitsSkill("Gliding"), limitsSkill("Perching")], [true, false]);
resetTables();
register(INVENTED);

/* ------------------------------ stamped rows ------------------------------ */

eq("the imported row names no figure", importedLimitRow().gate, { kind: ARMOUR_LIMIT_KIND });
eq("it is an armour limit row", isArmourLimitRow(importedLimitRow()), true);
eq("a restricted skill is stamped on build", limitRowsFor("Gliding", "def.skill.gliding"), [importedLimitRow()]);
eq("a skill the table does not name is not", limitRowsFor("Digging", "def.skill.digging"), []);
eq("a pick suffix does not change the name", limitRowsFor("Gliding (north)", "def.skill.gliding"), [importedLimitRow()]);
eq("only a skill's id is stamped", limitRowsFor("Gliding", "def.power.gliding"), []);
const own = { type: "limitation", gate: { kind: ARMOUR_LIMIT_KIND, armourMax: "medium" } };
const other = { type: "modifier", target: "ac" };
eq("upserting adds the row once", withImportedLimit([other], true), [other, importedLimitRow()]);
eq("upserting twice is the same list", withImportedLimit(withImportedLimit([other], true), true), [other, importedLimitRow()]);
eq("a skill no longer named loses the imported row", withImportedLimit([other, importedLimitRow()], false), [other]);
eq("a Judge's own row is kept either way", [withImportedLimit([own], false), withImportedLimit([own], true)], [[own], [own, importedLimitRow()]]);
resetTables();
eq("no table, no stamp", limitRowsFor("Gliding", "def.skill.gliding"), []);
register(INVENTED);

/* ---------------------- the actor's abilities under a loadout ---------------------- */

const ability = (name, effects) => ({ type: "ability", name, flags: { "acks-extras": { extras: { effects } } } });
const actor = (...items) => ({ items });
const gliding = ability("Gliding", [importedLimitRow()]);
const perching = ability("Perching", [importedLimitRow()]);
const plain = ability("Digging", [other]);
const handmade = ability("Hovering", [{ type: "limitation", gate: { kind: ARMOUR_LIMIT_KIND, armourMax: "unarmored" } }]);
const none = { blocked: [], undecided: [] };

eq("within the limit: nothing blocked", armourLimitedAbilities(actor(gliding, plain), { armor: suit("light") }), none);
eq("over it: the limited abilities are named", armourLimitedAbilities(actor(gliding, perching, plain), { armor: suit("heavy") }), { blocked: ["Gliding", "Perching"], undecided: [] });
eq("a shield blocks where the table refuses one", armourLimitedAbilities(actor(gliding), { armor: suit("light"), shield: suit("shield") }), { blocked: ["Gliding"], undecided: [] });
eq("a Judge's own ability is judged by its own row", armourLimitedAbilities(actor(handmade, gliding), { armor: suit("veryLight") }), { blocked: ["Hovering"], undecided: [] });
eq("two copies of one ability are named once", armourLimitedAbilities(actor(gliding, gliding), { armor: suit("heavy") }), { blocked: ["Gliding"], undecided: [] });
resetTables();
eq("rows with no imported table are undecided, not blocked", armourLimitedAbilities(actor(gliding, handmade), { armor: suit("heavy") }), { blocked: ["Hovering"], undecided: ["Gliding"] });
register({ skills: "Gliding", forbidden: "any armour at all", noShield: "a shield. the" });
eq("a table naming no rung leaves its rows undecided", armourLimitedAbilities(actor(gliding), { armor: suit("heavy") }), { blocked: [], undecided: ["Gliding"] });
eq("an actor with no abilities has no limits", armourLimitedAbilities(actor(), { armor: suit("heavy") }), none);

/* ------------------------------ the registered gate ------------------------------ */

register(INVENTED);
const row = { kind: ARMOUR_LIMIT_KIND };
eq("the gate says the limit stands over the rung", gateVerdict({}, row, { loadout: { armor: suit("heavy") } }), true);
eq("the gate says it does not within the rung", gateVerdict({}, row, { loadout: { armor: suit("light") } }), false);
eq("the gate cannot say without a loadout", gateVerdict({}, row, {}), null);
resetTables();
eq("the gate cannot say without a rung", gateVerdict({}, row, { loadout: { armor: suit("heavy") } }), null);

console.log(`test-armour-limits: ${pass} checks passed.`);
