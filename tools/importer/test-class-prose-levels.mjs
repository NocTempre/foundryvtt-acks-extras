/**
 * A class whose page states its progression in sentences imports with rows.
 *
 * A spread that prints no text table for its levels still says, in prose,
 * what its hit dice are up to a cap and past it, what its damage bonus is and
 * where it steps, how often it cleaves, and when it gains proficiencies. The
 * binder reads each from the reader's own body text through the register
 * row's patterns (`proseHitDiceLevels`, `proseDamageLadder`, the cleave
 * phrase, `proseGainSchedule`), leaving the title unread. The experience is
 * priced from the row's class-creation build against the world's builder
 * tables (`buildXp`), and stays unread where they or the race's cost are
 * absent; the class repair keeps what a Judge typed into an unread cell
 * (`REPAIR.class` `fillUnread`).
 *
 * Every paragraph and number here is invented; the patterns are the shipped
 * register row's, read from `register/cat/`.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindClass, buildXp, proseHitDiceLevels, proseDamageLadder, proseGainSchedule } from "../../scripts/importer/cookbook.mjs";
import { REPAIR, refreshPlan } from "../../scripts/importer/refresh.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "register", "cat", "p13-p23-classes.json"), "utf8"));
const spec = rows[0].class;

/* --- the hit-dice sentence --------------------------------------------------------------- */

// Welded the way extraction welds a run-in: label, value and the next label touch.
const BODY =
  "Hit Dice:1d10 until 7th level, then +3 hp per levelafterMaximum Level:9Lore:invented. " +
  "She may make a cleave once perround per level. She receives a+2 bonus to damage on her melee attacks at 2ndlevel, " +
  "and an additional +2 at 5th, 8th, and 4thlevels. Proficiencies:She starts withthe Wayfaring proficiency, one general" +
  "proficiency, and one class proficiency. She gains ageneral proficiency at 4th and 8th levels; and a classproficiency at 2nd and 7th levels.";

const levels = proseHitDiceLevels(BODY, spec.proseLevels.hitDice, 9);
ok("one row per level to the maximum", levels.length === 9 && levels[0].level === 1 && levels[8].level === 9, JSON.stringify(levels));
ok("a die per level up to the cap", levels[6].hd === "7d10" && levels[0].hd === "1d10");
ok("the flat step past the cap, counted from it", levels[7].hd === "7d10+3" && levels[8].hd === "7d10+6", levels[8].hd);
ok("experience and title are left unread", levels.every((r) => r.xp === null && r.title === ""));
ok("no match, no rows", proseHitDiceLevels("Hit Dice: see the table", spec.proseLevels.hitDice, 9).length === 0);
ok("no maximum level, no rows", proseHitDiceLevels(BODY, spec.proseLevels.hitDice, undefined).length === 0);

/* --- the damage-bonus sentence ----------------------------------------------------------- */

const ladder = proseDamageLadder(BODY, spec.damageBonus);
ok("the ladder takes the register's key", ladder?.key === spec.damageBonus.key, JSON.stringify(ladder));
ok(
  "the first bonus at its level, then one step at each listed level in order",
  JSON.stringify(ladder.values.map((r) => [r.atLevel, r.value])) === JSON.stringify([[2, 2], [4, 4], [5, 6], [8, 8]]),
  JSON.stringify(ladder.values),
);
ok("each rung carries its signed text", ladder.values.every((r) => r.text === `+${r.value}`));
ok("no key, no ladder", proseDamageLadder(BODY, { pattern: spec.damageBonus.pattern }) === null);

/* --- the gain schedule ------------------------------------------------------------------- */

const gains = proseGainSchedule(BODY);
ok("the starting picks from a 'starts with' sentence", gains?.l1 === "C+G", JSON.stringify(gains));
ok("'a general proficiency at' reads as a gain", gains.l4 === "G" && gains.l8 === "G", JSON.stringify(gains));
ok("'and a class proficiency at' reads as one", gains.l2 === "C" && gains.l7 === "C", JSON.stringify(gains));
const welded = proseGainSchedule("She gains an additionalgeneral proficiency at 3rd level, and anadditional class proficiency at 6th level.");
ok("an 'additional' welded to its article still reads", welded?.l3 === "G" && welded?.l6 === "C", JSON.stringify(welded));
ok("a 'starts with' naming one proficiency outright adds no pick", proseGainSchedule("She starts with the Wayfaring proficiency.") === null);

/* --- the whole class --------------------------------------------------------------------- */

const entry = {
  kind: "kind.class",
  name: "Invented Warden",
  book: "cat",
  cite: "CAT p.1",
  meta: { key: "inventedWarden", chassis: { saves: "fighter", attack: "fighter" } },
  cleaves: spec.cleaves,
  proseLevels: spec.proseLevels,
  damageBonus: spec.damageBonus,
};
// Two columns, split where a sentence turns the column as a page's does.
const cut = BODY.indexOf("round per level");
const node = { fields: { hitDie: "1d10", maximumLevel: 9, body1c0: BODY.slice(0, cut), body1c1: BODY.slice(cut) } };
const built = bindClass(entry, node, "def.class.inventedWarden").system;
ok("the class is no stub", built.levels.length === 9, String(built.levels.length));
ok("it cleaves once per level", built.cleaves?.kind === "perLevel" && built.cleaves.base === 1 && built.cleaves.per === 1, JSON.stringify(built.cleaves));
ok("its damage ladder is on the class", built.ladders.some((l) => l.key === spec.damageBonus.key && l.values.length === 4));
ok("attack and saves are the chassis's, not rows of its own", built.saveChassis === "fighter" && built.attackChassis === "fighter" && !built.saves.length && !built.attack.length);
ok("its proficiency gains are awards", built.awards.filter((a) => a.kind === "choice").length === 6, String(built.awards.length));

const grid = bindClass(entry, { fields: { ...node.fields, progression: { rows: [{ label: "1", cells: { xp: "0", title: "Tyro", hd: "1d6" } }] } } }, "def.class.inventedWarden").system;
ok("a printed grid wins over the sentence", grid.levels.length === 1 && grid.levels[0].hd === "1d6", JSON.stringify(grid.levels));
const bookless = bindClass(entry, null, "def.class.inventedWarden").system;
ok("bookless, the class stays a stub", bookless.levels.length === 0 && !bookless.ladders.length);

/* --- the experience priced from the class's build ---------------------------------------- */

// Invented tables in the shape `assembleBuilderTables` emits, and an invented
// race page; the allocation and its race pattern are the shipped row's.
const TABLES = {
  budget: { smoothing: { level: 7, nearest: 1000 }, postEight: { fighter: 7000, crusaderThief: 5000, mage: 9000 } },
  hd: [{ value: 0, cost: 10 }, { value: 1, cost: 20 }],
  fighting: [{ value: 2, sub: "", cost: 200 }],
  thievery: [{ value: 0, cost: 0 }],
  magicTypes: { arcane: { values: [{ value: 1, cost: 30 }] }, divine: { values: [{ value: 1, cost: 40 }] } },
  tradeoffs: ["weapons.unrestrictedBroad", "weapons.broadNarrow", "weapons.narrowRestricted"].map((key) => ({ key, xpDelta: 5, xpDeltaMinFighting: 2 })),
};
const RACE_PAGE = "Catgirl 1: invented.Cost: 99 XP. Catgirl 2:invented features over two lines. Cost:1,111 XP.Catgirl 3: invented. Cost: 7 XP.";
const priced = { ...entry, build: spec.build };
const pricedNode = { fields: { ...node.fields, race8c0: RACE_PAGE.slice(0, 40), race8c1: RACE_PAGE.slice(40) } };
const pricedClass = bindClass(priced, pricedNode, "def.class.inventedWarden", { builderTables: TABLES });
const EXPECTED = [0, 1406, 2812, 5624, 11248, 22496, 45000, 90000, 97000];
ok(
  "every level is priced: the allocation's costs and its rung's printed cost at 2nd, doubling, the smoothed 7th, then the chassis's flat step",
  JSON.stringify(pricedClass.system.levels.map((r) => r.xp)) === JSON.stringify(EXPECTED),
  JSON.stringify(pricedClass.system.levels.map((r) => r.xp)),
);
ok("the dice still come from the sentence", pricedClass.system.levels[8].hd === "7d10+6");
const prov = pricedClass.flags["acks-extras"].xpBuild;
ok("the flag records what priced it", prov?.base === 1406 && prov.raceCost === 1111 && prov.race === 2 && prov.magic === "arcane 1, divine 1" && prov.tradeoffs === 7, JSON.stringify(prov));
ok("no tables in the world, no price and no flag", bindClass(priced, pricedNode, "def.class.inventedWarden").system.levels.every((r) => r.xp === null));
const noRace = bindClass(priced, node, "def.class.inventedWarden", { builderTables: TABLES });
ok("a race page that prints no cost prices nothing", noRace.system.levels.every((r) => r.xp === null) && !noRace.flags["acks-extras"].xpBuild);
const noDivine = { ...TABLES, magicTypes: { arcane: TABLES.magicTypes.arcane } };
ok("a category the tables cannot price leaves every level unread", bindClass(priced, pricedNode, "def.class.inventedWarden", { builderTables: noDivine }).system.levels.every((r) => r.xp === null));
ok("a thief or crusader chassis takes their shared step", buildXp(spec.build, RACE_PAGE, TABLES, 9, "thief").xp[8] === 95000);
ok("a level a grid read keeps its own figure", bindClass(priced, { fields: { ...pricedNode.fields, progression: { rows: [{ label: "1", cells: { xp: "0", title: "Tyro", hd: "1d6" } }, { label: "2", cells: { xp: "5", title: "B", hd: "2d6" } }] } } }, "def.class.inventedWarden", { builderTables: TABLES }).system.levels[1].xp === 5);

/* --- the repair keeps what a Judge typed into an unread cell ----------------------------- */

const held = {
  type: "acks-extras.class",
  system: {
    levels: [
      { level: 1, xp: 0, title: "Typed One", hd: "1d4" },
      { level: 2, xp: 1234, title: "", hd: "2d4" },
    ],
  },
};
const fresh = { type: "acks-extras.class", system: { levels: proseHitDiceLevels(BODY, spec.proseLevels.hitDice, 9) } };
const plan = refreshPlan(held, fresh, REPAIR.class);
const out = plan.update.system.levels;
ok("the repair writes the build's dice", out[0].hd === "1d10" && out[1].hd === "2d10" && out.length === 9);
ok("a typed experience and title stay where the build read none", out[0].xp === 0 && out[0].title === "Typed One" && out[1].xp === 1234, JSON.stringify(out.slice(0, 2)));
ok("a level the Judge never typed stays unread", out[2].xp === null && out[2].title === "");
const read = refreshPlan(held, { type: "acks-extras.class", system: { levels: [{ level: 2, xp: 99, title: "Read", hd: "2d4" }] } }, REPAIR.class);
ok("a figure the build does read replaces the typed one", read.update.system.levels[0].xp === 99 && read.update.system.levels[0].title === "Read");
ok("planning leaves the stored rows as they were", held.system.levels[1].xp === 1234 && held.system.levels.length === 2);

console.log(`test-class-prose-levels: ${pass} checks passed.`);
