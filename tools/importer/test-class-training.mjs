/**
 * The combat-training parse (the paragraph every class spread states its
 * weapon, armour and fighting-style training in).
 *
 * Fixture paragraphs are INVENTED — structure-identical to the printed ones
 * (a declared run-in, the three trainings in that order, an exclusion clause
 * closing the style sentence) with made-up classes and, where a real weapon
 * name is unavoidable, the plainest possible one. A test file is a repo file
 * and ships no book text.
 */
import assert from "node:assert/strict";
import { parseCombatTraining } from "../../scripts/importer/cookbook.mjs";

let n = 0;
const check = (label, got, want) => {
  assert.deepEqual(got, want, `${label}: got ${JSON.stringify(got)}`);
  n++;
};

const RUNIN = "Combat Proficiencies:";

/* --- one sentence carrying all three, with an "(i.e. …)" aside ----------- */
let t = parseCombatTraining(
  "Grubbles are stout. Combat Proficiencies: Grubbles have weapon proficiency with all weapons, " +
    "armor proficiency with all armor, and fighting style proficiency with all three optional styles " +
    "(i.e. the dual weapon, two-handed weapon, and weapon and shield styles). Combat Progression: Grubbles advance.",
  RUNIN,
);
check("one-sentence weapons", t.weapons, ["all"]);
check("one-sentence armour", t.armour, "heavy");
check("one-sentence styles", t.styles, ["dual", "twohanded", "weaponshield"]);

/* --- the size + missile shape: sizes must not also read as weapon names --- */
t = parseCombatTraining(
  "Combat Proficiencies: Snerks have weapon proficiency with all missile weapons and with all tiny, " +
    "small, and medium melee weapons. They have armor proficiency with light and very light armor. " +
    "They have fighting style proficiency with the dual weapon and two-handed weapon styles, but not " +
    "with the weapon and shield style.",
  RUNIN,
);
check("sizes: weapons", t.weapons, ["missile:all", "melee:tiny", "melee:small", "melee:medium"]);
// "light and very light" is a LIGHT class — the deeper rung must not win.
check("sizes: armour", t.armour, "light");
// The exclusion clause names weapon-and-shield; reading it would grant it.
check("sizes: styles", t.styles, ["dual", "twohanded"]);

/* --- a plain list, with the armour sentence following it ------------------ */
t = parseCombatTraining(
  "Combat Proficiencies: Wibbles have weapon proficiency with clubs, daggers, darts, and staffs. " +
    "They have no armor proficiency. They have fighting style proficiency with the two-handed weapon " +
    "style (allowing them to use a staff with both hands), but not with the dual weapon or weapon and " +
    "shield styles.",
  RUNIN,
);
// The clause after the full stop must not arrive as a weapon called "they have no".
check("list: weapons", t.weapons, ["club", "dagger", "dart", "staff"]);
check("list: armour", t.armour, "unarmored");
check("list: styles", t.styles, ["twohanded"]);

/* --- the other phrasing of no armour ------------------------------------- */
t = parseCombatTraining(
  "Combat Proficiencies: Zibs have weapon proficiency with darts. They have no proficiency with armor. " +
    "They have fighting style proficiency with the two-handed weapon style.",
  RUNIN,
);
check("denied armour, second phrasing", t.armour, "unarmored");

/* --- a group named and then enumerated: the enumeration is what is read --- */
t = parseCombatTraining(
  "Combat Proficiencies: Florns have weapon proficiency with all axes (including battle axes, great " +
    "axes, and hand axes) and all bludgeons (including clubs and warhammers). They have armor " +
    "proficiency with medium, light, and very light armor. They have fighting style proficiency with " +
    "all fighting styles.",
  RUNIN,
);
check("enumerated groups", t.weapons, ["battle axe", "great axe", "hand axe", "club", "warhammer"]);
check("enumerated groups: armour", t.armour, "medium");
check("all fighting styles", t.styles, ["dual", "twohanded", "weaponshield"]);

/* --- an exception is not expressible, so nothing is granted --------------- */
t = parseCombatTraining(
  "Combat Proficiencies: Trundles have weapon proficiency with all weapons except long bows or " +
    "two-handed swords (due to their short stature). They have armor proficiency with all armor. " +
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
  "Combat Proficiencies: Marls have weapon proficiency with knives, a cestus, and slings. They have " +
    "armor proficiency with very light armor. They have fighting style proficiency with the weapon " +
    "and shield style, but not with the two-handed weapon or dual weapon styles.",
  RUNIN,
);
check("irregular plurals", t.weapons, ["knife", "cestus", "sling"]);
// Nothing above "very light" is named, so the bottom rung is the answer.
check("very light only", t.armour, "veryLight");
check("single positive style", t.styles, ["weaponshield"]);

/* --- the label is declared, so another spread's label reads the same ------ */
t = parseCombatTraining(
  "Armor and Weapons: Quills have weapon proficiency with staffs. They have armor proficiency with " +
    "light and very light armor. They have fighting style proficiency with the dual weapon style.",
  "Armor and Weapons:",
);
check("declared label", t.weapons, ["staff"]);
check("declared label: styles", t.styles, ["dual"]);

/* --- the paragraph stops at the next run-in ------------------------------ */
t = parseCombatTraining(
  "Combat Proficiencies: Nubs have weapon proficiency with clubs. They have armor proficiency with " +
    "all armor. They have fighting style proficiency with the dual weapon style. " +
    "Combat Progression: Nubs advance in attack throws with daggers and swords and wear plate.",
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
  "Combat Proficiencies:Snerks have weapon proficiency withall missile weapons and with all tiny, " +
    "small, and medium meleeweapons.Theyhavearmorproficiencywithlightandverylight armor. They have " +
    "fighting styleproficiency with the dualweapon and two-handed weapon styles, but notwith the " +
    "weaponand shield style.Combat Progression:Snerks advance with plate and all weapons.",
  "Combat Proficiencies:",
);
check("joined: weapons", t.weapons, ["missile:all", "melee:tiny", "melee:small", "melee:medium"]);
// The whole armour clause arrives as one word; "verylight" must not be read
// as the rung it contains.
check("joined: armour", t.armour, "light");
// "but notwith" still closes the positive clause; the next run-in still stops
// the paragraph, so the trailing "all weapons" is not read as a grant.
check("joined: styles", t.styles, ["dual", "twohanded"]);

// A table footnote can land welded into the middle of the sentence.
t = parseCombatTraining(
  "Combat Proficiencies:Grubbles have weapon proficiency with*no adjustment fromall weapons, armor " +
    "proficiency with all armor, and fighting styleproficiency with all three optional styles " +
    "(i.e. the dual weapon, two-handed weapon, andweapon and shield styles).Combat Progression:x",
  "Combat Proficiencies:",
);
check("spliced footnote: weapons", t.weapons, ["all"]);
check("spliced footnote: styles", t.styles, ["dual", "twohanded", "weaponshield"]);

// The conjunction welded to the name it precedes, inside an enumeration.
t = parseCombatTraining(
  "Combat Proficiencies:Florns have weapon proficiency with all axes (including battle axes, great " +
    "axes, andhand axes). They have armor proficiency with all armor. They have fighting style " +
    "proficiency with the dual weapon style.",
  "Combat Proficiencies:",
);
check("welded conjunction", t.weapons, ["battle axe", "great axe", "hand axe"]);

// The run-in label itself can arrive with its own space missing.
t = parseCombatTraining(
  "CombatProficiencies:Nubs have weapon proficiency with clubs. They have armor proficiency with " +
    "all armor. They have fighting style proficiency with the dual weapon style.",
  "Combat Proficiencies:",
);
check("joined run-in label", t.weapons, ["club"]);

/* --- refusals ------------------------------------------------------------ */
assert.equal(parseCombatTraining("No such paragraph here.", RUNIN), null);
n++;
assert.equal(parseCombatTraining("", RUNIN), null);
n++;
assert.equal(parseCombatTraining("Combat Proficiencies: something.", ""), null);
n++;
// A class whose training is stated by a table rather than a sentence has no
// paragraph to read, and says so rather than guessing from the lead-in.
assert.equal(
  parseCombatTraining("Combat Proficiencies: Yaks are limited to a range traditional to their people, as shown below.", RUNIN),
  null,
);
n++;
// A spread whose level table sits inside the text block extracts with the
// table folded through the sentence. The style clause here survives intact
// and would be granted alone; the whole paragraph is refused instead.
assert.equal(
  parseCombatTraining(
    "Combat Proficiencies:Yaks Experience title Level Hit dice have weapon proficiency with battle" +
      "level axes, great axes, and two-0 Insignificant 1 1d6 ------handed swords. They have " +
      "armorproficiencywithallarmor. They have fighting style proficiency with the weapon and shield style.",
    RUNIN,
  ),
  null,
);
n++;

console.log(`test-class-training: all ${n} checks passed`);
