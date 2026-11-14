/**
 * The combat-training parse (the paragraph every class spread states its
 * weapon, armour and fighting-style training in).
 *
 * Fixture paragraphs are INVENTED — structure-identical to the printed ones
 * (a declared run-in, the three trainings in that order, an exclusion clause
 * closing the style sentence) with made-up classes, made-up run-in labels and,
 * where a real weapon name is unavoidable, the plainest possible one. A test
 * file is a repo file and ships no book text.
 */
import assert from "node:assert/strict";
import { parseCombatTraining } from "../../scripts/importer/cookbook.mjs";

let n = 0;
const check = (label, got, want) => {
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}`);
  n++;
};

const RUNIN = "Field Training:";

/* --- one sentence carrying all three, with an "(i.e. …)" aside ----------- */
let t = parseCombatTraining(
  "Grubbles are stout. Field Training: Grubbles have weapon proficiency with all weapons, " +
    "armor proficiency with all armor, and fighting style proficiency with each style listed " +
    "(i.e. the dual weapon, two-handed weapon, and weapon and shield styles). Field Progression: Grubbles advance.",
  RUNIN,
);
check("one-sentence weapons", t.weapons, ["all"]);
check("one-sentence armour", t.armour, "heavy");
check("one-sentence styles", t.styles, ["dual", "twohanded", "weaponshield"]);

/* --- the size + missile shape: sizes must not also read as weapon names --- */
t = parseCombatTraining(
  "Field Training: Snerks have weapon proficiency with all missile weapons and with all small, " +
    "medium, and large melee weapons. They have armor proficiency with light and very light armor. " +
    "They have fighting style proficiency with the dual weapon and two-handed weapon styles, but not " +
    "with the weapon and shield style.",
  RUNIN,
);
check("sizes: weapons", t.weapons, ["missile:all", "melee:small", "melee:medium", "melee:large"]);
// Armor proficiency listing both the light and the very light rung is a LIGHT class
// (RR p26, JJ p290) — the deeper rung must not win.
check("sizes: armour", t.armour, "light");
// The exclusion clause names weapon-and-shield; reading it would grant it.
check("sizes: styles", t.styles, ["dual", "twohanded"]);

/* --- a plain list, with the armour sentence following it ------------------ */
t = parseCombatTraining(
  "Field Training: Wibbles have weapon proficiency with spears, slings, maces, and cudgels. " +
    "They have no armor proficiency. They have fighting style proficiency with the two-handed weapon " +
    "style (letting them grip a pole in two hands), but not with the dual weapon or weapon and " +
    "shield styles.",
  RUNIN,
);
// The clause after the full stop must not arrive as a weapon called "they have no".
check("list: weapons", t.weapons, ["spear", "sling", "mace", "cudgel"]);
check("list: armour", t.armour, "unarmored");
check("list: styles", t.styles, ["twohanded"]);

/* --- the other phrasing of no armour ------------------------------------- */
t = parseCombatTraining(
  "Field Training: Zibs have weapon proficiency with darts. They have no proficiency with armor. " +
    "They have fighting style proficiency with the two-handed weapon style.",
  RUNIN,
);
check("denied armour, second phrasing", t.armour, "unarmored");

/* --- a group named and then enumerated: the enumeration is what is read --- */
t = parseCombatTraining(
  "Field Training: Florns have weapon proficiency with all spears (including long spears, short " +
    "spears, and boar spears) and all flails (including rope flails and chain flails). They have armor " +
    "proficiency with medium, light, and very light armor. They have fighting style proficiency with " +
    "all fighting styles.",
  RUNIN,
);
check("enumerated groups", t.weapons, ["long spear", "short spear", "boar spear", "rope flail", "chain flail"]);
check("enumerated groups: armour", t.armour, "medium");
check("all fighting styles", t.styles, ["dual", "twohanded", "weaponshield"]);

/* --- an exception is not expressible, so nothing is granted --------------- */
t = parseCombatTraining(
  "Field Training: Trundles have weapon proficiency with all weapons except pikes or " +
    "lances (owing to their reach). They have armor proficiency with all armor. " +
    "They have fighting style proficiency with the weapon and shield, two-handed weapon, and dual " +
    "weapon styles.",
  RUNIN,
);
// Reading the unrestricted half would grant exactly the two weapons denied.
check("exception: no weapon grant", t.weapons, []);
check("exception: armour still read", t.armour, "heavy");
check("exception: styles still read", t.styles, ["dual", "twohanded", "weaponshield"]);

/* --- the irregular plural, and the singular that looks like one ----------- */
t = parseCombatTraining(
  "Field Training: Marls have weapon proficiency with knives, a gladius, and slings. They have " +
    "armor proficiency with very light armor. They have fighting style proficiency with the weapon " +
    "and shield style, but not with the two-handed weapon or dual weapon styles.",
  RUNIN,
);
check("irregular plurals", t.weapons, ["knife", "gladius", "sling"]);
// Nothing above "very light" is named, so the bottom rung is the answer.
check("very light only", t.armour, "veryLight");
check("single positive style", t.styles, ["weaponshield"]);

/* --- the label is declared, so another spread's label reads the same ------ */
t = parseCombatTraining(
  "Kit Training: Quills have weapon proficiency with staffs. They have armor proficiency with " +
    "light and very light armor. They have fighting style proficiency with the dual weapon style.",
  "Kit Training:",
);
check("declared label", t.weapons, ["staff"]);
check("declared label: styles", t.styles, ["dual"]);

/* --- the paragraph stops at the next run-in ------------------------------ */
t = parseCombatTraining(
  "Field Training: Nubs have weapon proficiency with clubs. They have armor proficiency with " +
    "all armor. They have fighting style proficiency with the dual weapon style. " +
    "Field Progression: Nubs advance in attack throws with daggers and swords and wear plate.",
  RUNIN,
);
check("stops at the next run-in", t.weapons, ["club"]);

/* --- what extraction actually hands the parser ---------------------------
   Joining lines by concatenation drops the space the page shows, anywhere:
   after the run-in, inside a phrase, before the conjunction, after the full
   stop, and in front of the next run-in. A whole run can arrive with no
   spaces at all. Every fixture below is the shape above with its spaces
   removed at those seams — the parse must be unchanged by that. */
t = parseCombatTraining(
  "Field Training:Snerks have weapon proficiency withall missile weapons and with all small, " +
    "medium, and large meleeweapons.Theyhavearmorproficiencywithlightandverylight armor. They have " +
    "fighting styleproficiency with the dualweapon and two-handed weapon styles, but notwith the " +
    "weaponand shield style.Field Progression:Snerks advance with plate and all weapons.",
  "Field Training:",
);
check("joined: weapons", t.weapons, ["missile:all", "melee:small", "melee:medium", "melee:large"]);
// The whole armour clause arrives as one word; "verylight" must not be read
// as the rung it contains.
check("joined: armour", t.armour, "light");
// "but notwith" still closes the positive clause; the next run-in still stops
// the paragraph, so the trailing "all weapons" is not read as a grant.
check("joined: styles", t.styles, ["dual", "twohanded"]);

// A table footnote can land welded into the middle of the sentence.
t = parseCombatTraining(
  "Field Training:Grubbles have weapon proficiency with*no adjustment fromall weapons, armor " +
    "proficiency with all armor, and fighting styleproficiency with each style listed " +
    "(i.e. the dual weapon, two-handed weapon, andweapon and shield styles).Field Progression:x",
  "Field Training:",
);
check("spliced footnote: weapons", t.weapons, ["all"]);
check("spliced footnote: styles", t.styles, ["dual", "twohanded", "weaponshield"]);

// The conjunction welded to the name it precedes, inside an enumeration.
t = parseCombatTraining(
  "Field Training:Florns have weapon proficiency with all spears (including long spears, short " +
    "spears, andboar spears). They have armor proficiency with all armor. They have fighting style " +
    "proficiency with the dual weapon style.",
  "Field Training:",
);
check("welded conjunction", t.weapons, ["long spear", "short spear", "boar spear"]);

// The run-in label itself can arrive with its own space missing.
t = parseCombatTraining(
  "FieldTraining:Nubs have weapon proficiency with clubs. They have armor proficiency with " +
    "all armor. They have fighting style proficiency with the dual weapon style.",
  "Field Training:",
);
check("joined run-in label", t.weapons, ["club"]);

/* --- refusals ------------------------------------------------------------ */
assert.equal(parseCombatTraining("No such paragraph here.", RUNIN), null);
n++;
assert.equal(parseCombatTraining("", RUNIN), null);
n++;
assert.equal(parseCombatTraining("Field Training: something.", ""), null);
n++;
// A class whose training is stated by a table rather than a sentence has no
// paragraph to read, and says so rather than guessing from the lead-in.
assert.equal(
  parseCombatTraining("Field Training: Yaks are limited to a range traditional to their people, as shown below.", RUNIN),
  null,
);
n++;
// A spread whose level table sits inside the text block extracts with the
// table folded through the sentence. The style clause here survives intact
// and would be granted alone; the whole paragraph is refused instead.
assert.equal(
  parseCombatTraining(
    "Field Training:Yaks Title Rank Dice have weapon proficiency with long" +
      "rank spears, boar spears, and two-0 Faint 1 1d4 ------edged blades. They have " +
      "armorproficiencywithallarmor. They have fighting style proficiency with the weapon and shield style.",
    RUNIN,
  ),
  null,
);
n++;

console.log(`test-class-training: all ${n} checks passed`);
