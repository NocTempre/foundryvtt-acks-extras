/**
 * Pure-logic tests (Foundry-free) for the class-builder derivation engine,
 * run via `npm test`. Table values here are FIXTURES invented for the tests —
 * no book value ships in this repo; a world's real tables arrive by import.
 */
import assert from "node:assert/strict";
import {
  BUILDER_DOC_ID,
  BUILDER_TABLE_IDS,
  attackBands,
  bandify,
  baseXpCost,
  cleavesValue,
  derivePlan,
  deriveTradition,
  effectiveMagicValue,
  pointsSpent,
  powerSummary,
  racialMaxLevel,
  racialStacking,
  roundToStep,
  savesChassis,
  scaleSlots,
  valueRow,
  xpSchedule,
} from "../scripts/classes/builder-logic.mjs";
import { awardsAt, awardsThrough } from "../scripts/classes/grants.mjs";
import { ANSWERED, closesRung, grantableRefs, grantsFrom } from "../scripts/classes/picks.mjs";
import { rebuildHitPoints } from "../scripts/classes/hitpoints.mjs";
import { readFileSync } from "node:fs";

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

/* ---------------------------- fixtures ---------------------------- */

const TABLES = {
  budget: {
    basePoints: 4,
    savesPrecedence: ["arcane", "divine", "fighting", "thievery"],
    smoothing: { level: 7, nearest: 5000 },
    postEight: { crusaderThief: 100000, fighter: 120000, mage: 150000 },
    racialCaps: [
      { points: 8, maxLevel: 9 },
      { points: 7, maxLevel: 10 },
      { points: 6, maxLevel: 11 },
      { points: 5, maxLevel: 12 },
      { points: 4, maxLevel: 13 },
    ],
    tradeInXp: 250,
  },
  hd: [
    { value: 0, die: "d4", mortalWounds: 0, cost: 0 },
    { value: 1, die: "d6", mortalWounds: 2, cost: 500 },
    { value: 2, die: "d8", mortalWounds: 4, cost: 1000 },
  ],
  fighting: [
    { value: 0, sub: "", label: "Mage", cost: 0, attackAs: "mage", attack: { step: 2, every: 6 }, damage: null, cleaves: "none" },
    { value: 1, sub: "a", label: "Crusader", cost: 500, attackAs: "crusader", attack: { step: 2, every: 4 }, damage: null, cleaves: "half" },
    { value: 1, sub: "b", label: "Thief", cost: 500, attackAs: "thief", attack: { step: 2, every: 4 }, damage: null, cleaves: "half" },
    { value: 2, sub: "", label: "Fighter", cost: 1000, attackAs: "fighter", attack: { step: 2, every: 3 }, damage: { step: 1, every: 3 }, cleaves: "full" },
    { value: 4, sub: "", label: "Hero", cost: 2000, attackAs: "", attack: { step: 3, every: 2 }, damage: { step: 1, every: 3 }, cleaves: "full" },
  ],
  thievery: [
    { value: 0, skills: 0, cost: 0 },
    { value: 1, skills: 4, cost: 250 },
    { value: 2, skills: 8, cost: 500 },
  ],
  magicTypes: {
    arcane: {
      label: "Arcane",
      kind: "vancian",
      repertoire: "arcaneInt",
      savesAs: "mage",
      progenitor: "mage",
      values: [
        { value: 1, cost: 625, fraction: 0.33, slots: [{ atLevel: 1, s1: 1, casterLevel: 0 }, { atLevel: 2, s1: 1, casterLevel: 1 }], delayedSlots: [{ atLevel: 1, casterLevel: 0 }, { atLevel: 2, s1: 1, casterLevel: 1 }] },
        { value: 2, cost: 1250, fraction: 0.5 },
        { value: 4, cost: 2500, fraction: 1, slots: [{ atLevel: 1, s1: 1, casterLevel: 1 }, { atLevel: 2, s1: 2, casterLevel: 2 }] },
        { value: 7, cost: null, fraction: 1.66 },
      ],
    },
    fairie: {
      label: "Fairie",
      kind: "points",
      repertoire: "order",
      savesAs: "crusader",
      progenitor: "witch",
      values: [{ value: 2, cost: 1000, fraction: 0.5 }],
    },
  },
  tradeoffs: [
    { key: "armour.heavyMedium", label: "Armour Heavy → Medium", powersGained: 1, xpDelta: 0 },
    { key: "weapons.broadNarrow", label: "Weapons Broad → Narrow", powersGained: 2, xpDelta: 500 },
  ],
};

const FIGHTER_ATTACK = [
  { minLevel: 1, maxLevel: 3, throw: 10 },
  { minLevel: 4, maxLevel: 6, throw: 8 },
  { minLevel: 7, maxLevel: 9, throw: 6 },
  { minLevel: 10, maxLevel: 12, throw: 4 },
  { minLevel: 13, maxLevel: null, throw: 2 },
];
const CHASSIS_ATTACK = new Map([
  ["fighter", FIGHTER_ATTACK],
  ["mage", [{ minLevel: 1, maxLevel: 6, throw: 10 }, { minLevel: 7, maxLevel: 12, throw: 8 }, { minLevel: 13, maxLevel: null, throw: 6 }]],
]);

const ELF = {
  stacksWith: "arcane",
  stackXpDiscount: 125,
  postEight: [{ chassis: "", delta: 50000 }],
  minimumAttributes: [{ attr: "int", min: 9 }],
  values: [
    { value: 1, label: "Elf + 33% Arcane", xpCost: 750, powers: ["def.power.elfTongues"] },
    { value: 2, label: "Elf + 50% Arcane", xpCost: 1375, powers: [] },
    { value: 3, label: "Elf + 66% Arcane", xpCost: 2000, powers: [] },
  ],
};
const DWARF = {
  stacksWith: "",
  postEight: [
    { chassis: "fighter", delta: 10000 },
    { chassis: "crusaderThief", delta: 30000 },
  ],
  minimumAttributes: [{ attr: "con", min: 9 }],
  values: [{ value: 0, label: "Dwarf", xpCost: 200, powers: ["def.power.hardy", "def.power.dwarfTongues"] }],
};

/* ------------------------------ tests ----------------------------- */

test("contract names are stable", () => {
  assert.equal(BUILDER_DOC_ID, "acks.classBuilder");
  assert.ok(BUILDER_TABLE_IDS.includes("magicTypes"));
});

test("xpSchedule doubles to 8th, smooths the 7th threshold, then climbs flat", () => {
  const xp = xpSchedule(1750, 12, { smoothing: { level: 7, nearest: 5000 }, postEightIncrement: 120000 });
  // 1750 3500 7000 14000 28000 → L7 56000 smoothed 55000 → L8 110000
  assert.deepEqual(xp.slice(0, 8), [0, 1750, 3500, 7000, 14000, 28000, 55000, 110000]);
  assert.equal(xp[8], 230000);
  assert.equal(xp[9], 350000);
});

test("xpSchedule survives a base the tables never answered", () => {
  assert.deepEqual(xpSchedule(null, 3), [0]);
});

test("roundToStep leaves values alone without a step", () => {
  assert.equal(roundToStep(123, 0), 123);
  assert.equal(roundToStep(56000, 5000), 55000);
});

test("valueRow honours the fighting a/b split and falls back on value", () => {
  assert.equal(valueRow(TABLES.fighting, 1, "b").label, "Thief");
  assert.equal(valueRow(TABLES.fighting, 1, "a").label, "Crusader");
  assert.equal(valueRow(TABLES.fighting, 2, "").label, "Fighter");
  assert.equal(valueRow(TABLES.fighting, 1).sub, "a"); // first printed row
});

test("pointsSpent counts every category including the racial value", () => {
  const spent = pointsSpent({ hdValue: 1, fighting: { value: 2 }, magic: [{ type: "arcane", value: 1 }], race: { value: 3 } });
  assert.equal(spent, 7);
});

test("powerSummary balances trade-off yields against chosen costs", () => {
  const s = powerSummary(
    { tradeoffs: ["armour.heavyMedium", "weapons.broadNarrow"], powers: [{ ref: "a", cost: 1 }, { ref: "b" }] },
    TABLES,
  );
  assert.deepEqual(s, { gained: 3, spent: 2, left: 1 });
});

test("racial stacking raises the stacked category's effective value", () => {
  const stacking = racialStacking({ race: { value: 3 } }, ELF);
  assert.equal(stacking.stackValue, 3);
  assert.equal(effectiveMagicValue({ type: "arcane", value: 1 }, stacking), 4);
  assert.equal(effectiveMagicValue({ type: "divine", value: 1 }, stacking), 1);
});

test("baseXpCost sums categories, race rung, trade-offs, and the elf discount", () => {
  const issues = [];
  const base = baseXpCost(
    {
      hdValue: 1,
      fighting: { value: 2 },
      magic: [{ type: "arcane", value: 1 }],
      race: { value: 3 },
    },
    TABLES,
    ELF,
    issues,
  );
  // 500 + 1000 + 625 − 125 (stack discount) + 2000 (elf 3) = 4000 — the JJ's
  // own spellsword arithmetic, run on fixture rows.
  assert.equal(base, 4000);
  assert.deepEqual(issues, []);
});

test("baseXpCost reports what the tables cannot answer", () => {
  const issues = [];
  baseXpCost({ hdValue: 9, magic: [{ type: "gnostic", value: 1 }], race: { value: 3 } }, TABLES, DWARF, issues);
  const keys = issues.map((i) => i.key);
  assert.ok(keys.includes("missingHdRow"));
  assert.ok(keys.includes("unknownMagicType"));
  assert.ok(keys.includes("missingRaceRow"));
});

test("bandify compresses equal consecutive throws", () => {
  const bands = bandify([
    { level: 1, value: 10 },
    { level: 2, value: 10 },
    { level: 3, value: 9 },
    { level: 4, value: 9 },
  ]);
  assert.deepEqual(bands, [
    { minLevel: 1, maxLevel: 2, throw: 10 },
    { minLevel: 3, maxLevel: 4, throw: 9 },
  ]);
});

test("attackBands borrows the named chassis and caps at max level", () => {
  const issues = [];
  const bands = attackBands(valueRow(TABLES.fighting, 2), TABLES, 5, CHASSIS_ATTACK, issues);
  assert.deepEqual(bands, [
    { minLevel: 1, maxLevel: 3, throw: 10 },
    { minLevel: 4, maxLevel: 5, throw: 8 },
  ]);
  assert.deepEqual(issues, []);
});

test("attackBands generates from parameters off the fighter base when no chassis fits", () => {
  const issues = [];
  const bands = attackBands(valueRow(TABLES.fighting, 4), TABLES, 4, CHASSIS_ATTACK, issues);
  // base 10, +3 every 2: L1-2 10, L3-4 7
  assert.deepEqual(bands, [
    { minLevel: 1, maxLevel: 2, throw: 10 },
    { minLevel: 3, maxLevel: 4, throw: 7 },
  ]);
  assert.ok(issues.some((i) => i.key === "attackFromParams"));
});

test("attackBands prefers an imported grid over everything", () => {
  const tables = { ...TABLES, attackThrows: [{ level: 1, values: { 2: 9 } }, { level: 2, values: { 2: 9 } }] };
  const bands = attackBands({ value: 2, attackAs: "fighter" }, tables, 2, CHASSIS_ATTACK, []);
  assert.deepEqual(bands, [{ minLevel: 1, maxLevel: 2, throw: 9 }]);
});

test("savesChassis: largest wins, ties break by printed precedence, racial value never counts", () => {
  assert.equal(savesChassis({ fighting: { value: 2 }, magic: [{ type: "arcane", value: 1 }] }, TABLES, null), "fighter");
  // tie fighting 2 vs arcane 2 → arcane precedes fighting in the printed order
  assert.equal(savesChassis({ fighting: { value: 2 }, magic: [{ type: "arcane", value: 2 }] }, TABLES, null), "mage");
  // elf 3 stacks onto arcane 1 for CASTING, but saves ignore the racial
  // value (JJ: "not used … even when the Racial Value stacks") → fighter
  assert.equal(savesChassis({ fighting: { value: 2 }, magic: [{ type: "arcane", value: 1 }], race: { value: 3 } }, TABLES, ELF), "fighter");
});

test("scaleSlots rounds halves up and leaves unprinted cells null", () => {
  const row = scaleSlots({ atLevel: 3, s1: 2, s2: 1, s3: null, s4: null, s5: null, s6: null }, 0.5);
  assert.equal(row.s1, 1);
  assert.equal(row.s2, 1); // 0.5 rounds up
  assert.equal(row.s3, null);
});

test("deriveTradition uses the value's printed grid and lifts its caster ladder", () => {
  const issues = [];
  const d = deriveTradition({ type: "arcane", value: 1 }, TABLES.magicTypes.arcane, null, 14, issues);
  assert.equal(d.tradition.slots.length, 2);
  assert.equal(d.tradition.casterLevel, "arcaneCasterLevel");
  assert.equal(d.ladder.values[0].value, 0); // printed caster level lags
  assert.deepEqual(issues, []);
});

test("deriveTradition scales the 100% grid when the value prints none", () => {
  const d = deriveTradition({ type: "arcane", value: 2 }, TABLES.magicTypes.arcane, null, 14, []);
  assert.equal(d.tradition.slots.length, 2);
  assert.equal(d.tradition.slots[1].s1, 1); // 2 × 0.5
});

test("deriveTradition delayed uses the delayed grid; missing one is an issue", () => {
  const d = deriveTradition({ type: "arcane", value: 1, delayed: true }, TABLES.magicTypes.arcane, null, 14, []);
  assert.equal(d.tradition.slots[0].s1, null); // delayed start
  const issues = [];
  deriveTradition({ type: "arcane", value: 2, delayed: true }, TABLES.magicTypes.arcane, null, 14, issues);
  assert.ok(issues.some((i) => i.key === "missingDelayedGrid"));
});

test("deriveTradition scales a progenitor pool for pool-kind magic", () => {
  const d = deriveTradition({ type: "fairie", value: 2 }, TABLES.magicTypes.fairie, { slots: [], pool: [{ atLevel: 1, value: 4 }] }, 14, []);
  assert.equal(d.tradition.pool[0].value, 2);
});

test("cleavesValue maps table tokens to LevelValues", () => {
  assert.deepEqual(cleavesValue({ cleaves: "none" }), { kind: "flat", flat: 0 });
  assert.equal(cleavesValue({ cleaves: "full" }).per, 1);
  assert.equal(cleavesValue({ cleaves: "half" }).per, 0.5);
  assert.equal(cleavesValue({}), null);
});

test("racialMaxLevel reads the printed points→cap table", () => {
  assert.equal(racialMaxLevel(7, TABLES.budget), 10);
  assert.equal(racialMaxLevel(4, TABLES.budget), 13);
  assert.equal(racialMaxLevel(9, TABLES.budget), null);
});

test("derivePlan with no tables yields only the missing-tables issue", () => {
  const plan = derivePlan({ builder: { hdValue: 1 }, tables: null, race: null });
  assert.deepEqual(plan.update, {});
  assert.equal(plan.issues[0].key, "missingTables");
});

test("derivePlan assembles a racial build end-to-end (the spellsword shape)", () => {
  const plan = derivePlan({
    builder: {
      hdValue: 1,
      fighting: { value: 2, sub: "" },
      thievery: { value: 0, skills: [] },
      magic: [{ type: "arcane", value: 1 }],
      race: { value: 3 },
      tradeoffs: [],
      powers: [],
    },
    tables: TABLES,
    race: ELF,
    chassisAttack: CHASSIS_ATTACK,
    fighterLadders: { damageBonus: { key: "damageBonus", label: "Damage Bonus", values: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }] } },
    titles: [{ level: 1, title: "Novice" }],
  });
  const u = plan.update;
  assert.equal(u.maximumLevel, 10); // 7 total points → printed cap
  assert.equal(u.hitDie, "1d6");
  assert.equal(u.levels.length, 10);
  assert.equal(u.levels[0].title, "Novice");
  assert.equal(u.levels[1].xp, 4000); // the discounted spellsword base
  // saves ignore the racial value: fighting 2 beats arcane 1 → fighter;
  // post-8 increment = fighter 120000 + elf 50000
  assert.equal(u.saveChassis, "fighter");
  assert.equal(u.levels[9].xp - u.levels[8].xp, 170000);
  assert.ok(u.attack.length > 0);
  assert.equal(u.casting.length, 1);
  assert.equal(u.casting[0].slots.length, 2); // stacked to arcane 4 → its printed grid
  assert.ok(u.ladders.some((l) => l.key === "damageBonus"));
  assert.ok(u.ladders.some((l) => l.key === "mortalWounds"));
  assert.deepEqual(u.requirements, [{ attr: "int", min: 9 }]);
  assert.ok(u.racialTraits.some((t) => t.ref === "def.power.elfTongues"));
});

test("derivePlan copies progenitor thief-skill ladders for chosen skills", () => {
  const plan = derivePlan({
    builder: {
      hdValue: 1,
      fighting: { value: 1, sub: "b" },
      thievery: { value: 1, skills: ["def.skill.climbing", "def.skill.hiding", "def.skill.sneaking", "def.skill.lockpicking"] },
      magic: [],
      race: { value: 0 },
    },
    tables: TABLES,
    race: null,
    chassisAttack: CHASSIS_ATTACK,
    skillLadders: new Map([["def.skill.climbing", { key: "climbing", label: "Climbing", values: [{ atLevel: 1, value: 6 }] }]]),
  });
  const skills = plan.update["inventory.skills"];
  assert.equal(skills.length, 4);
  assert.equal(skills[0].ladderKey, "climbing");
  assert.equal(skills[1].ladderKey, "");
  assert.ok(plan.update.ladders.some((l) => l.key === "climbing"));
  assert.deepEqual(plan.summary.points, { spent: 3, base: 4 });
  assert.ok(plan.issues.some((i) => i.key === "pointsOff"));
});

test("derivePlan skips what a partial table set cannot answer", () => {
  const plan = derivePlan({
    builder: { hdValue: 0, fighting: { value: 2 }, magic: [] },
    tables: { budget: {}, hd: TABLES.hd, fighting: TABLES.fighting },
    race: null,
  });
  assert.equal(plan.update.hitDie, "1d4");
  assert.equal(plan.update.attack, undefined); // no chassis map, no base → absent
  assert.ok(plan.issues.some((i) => i.key === "missingAttackBase" || i.key === "missingAttackResolution"));
  assert.ok(plan.issues.some((i) => i.key === "missingPostEight"));
});

/* ------------------- awards owed for a level held ------------------- */

/* Whether an ability is already owned is partly a question about the WORLD —
 * an owned copy carries its own uuid, so a ref that resolves to nothing has to
 * fall back to the source's name. These cases supply the two lookups that
 * answer it, empty: still Foundry-free, and every ref below resolves to
 * nothing, which is what makes "not owned" the honest answer. */
globalThis.game = { items: [] };
globalThis.fromUuidSync = () => null;

/** A world ability item as `refOf` addresses it: the importer's cookbook stamp. */
const stamped = (id) => ({ flags: { "acks-importer": { cookbook: { id } } } });

/** A class whose ladder prints one fixed and one choice award per level. */
const LADDERED = {
  system: {
    inventory: ["def.prof.combatTrickery", "def.prof.berserkergang"],
    awards: [
      { atLevel: 1, kind: "fixed", ref: "def.power.ambush", name: "Ambush" },
      { atLevel: 1, kind: "choice", choice: { label: "Class proficiency", from: "classInventory", filter: "any", count: 1 } },
      { atLevel: 2, kind: "fixed", ref: "def.power.hearNoise", name: "Hear Noise" },
      { atLevel: 4, kind: "fixed", ref: "def.power.backstab", name: "Backstab" },
      { atLevel: 5, kind: "choice", choice: { label: "General proficiency", from: "generalList", filter: "any", count: 1 } },
      { atLevel: 9, kind: "fixed", ref: "def.power.stronghold", name: "Stronghold" },
    ],
  },
};

test("a level owes every rung at or below it, not only the one just reached", () => {
  const owed = awardsThrough({ items: [] }, LADDERED, 5);
  assert.deepEqual(
    owed.fixed.map((a) => a.ref),
    ["def.power.ambush", "def.power.hearNoise", "def.power.backstab"],
  );
  assert.equal(owed.choices.length, 2);
  // The rung above the held level stays unearned.
  assert.ok(!owed.fixed.some((a) => a.ref === "def.power.stronghold"));
});

test("first level owes its own rung — the case a bound character got nothing for", () => {
  const owed = awardsThrough({ items: [] }, LADDERED, 1);
  assert.deepEqual(
    owed.fixed.map((a) => a.ref),
    ["def.power.ambush"],
  );
  assert.equal(owed.choices.length, 1);
});

test("a fixed award the character already carries is not offered again", () => {
  const actor = { items: [stamped("def.power.ambush"), stamped("def.power.backstab")] };
  const owed = awardsThrough(actor, LADDERED, 5);
  assert.deepEqual(
    owed.fixed.map((a) => a.ref),
    ["def.power.hearNoise"],
  );
});

test("an award with no printed level is a first-level award", () => {
  const cls = { system: { awards: [{ kind: "fixed", ref: "def.power.unlevelled" }] } };
  assert.equal(awardsThrough({ items: [] }, cls, 1).fixed.length, 1);
});

test("a class with an empty ladder owes nothing at any level", () => {
  const owed = awardsThrough({ items: [] }, { system: {} }, 14);
  assert.deepEqual(owed.fixed, []);
  assert.deepEqual(owed.choices, []);
});

test("a choice rung already answered is not asked again on re-apply", () => {
  const first = awardsThrough({ items: [] }, LADDERED, 5);
  assert.equal(first.choices.length, 2);
  // Answering both records their keys; the next apply offers neither.
  const taken = first.choices.map((c) => c.key);
  const again = awardsThrough({ items: [] }, LADDERED, 5, taken);
  assert.deepEqual(again.choices, []);
  // A rung answered at 5th does not suppress one that first appears later.
  const higher = awardsThrough({ items: [] }, { system: { awards: [
    ...LADDERED.system.awards,
    { atLevel: 7, kind: "choice", choice: { label: "Later", from: "generalList", count: 1 } },
  ] } }, 7, taken);
  assert.equal(higher.choices.length, 1);
  assert.equal(higher.choices[0].choice.label, "Later");
});

test("answering only one of two rungs leaves the other still owed", () => {
  const owed = awardsThrough({ items: [] }, LADDERED, 5);
  const again = awardsThrough({ items: [] }, LADDERED, 5, [owed.choices[0].key]);
  assert.equal(again.choices.length, 1);
  assert.equal(again.choices[0].key, owed.choices[1].key);
});

test("a hand-made ability is matched by uuid, so its award is not re-granted", () => {
  const actor = { items: [{ uuid: "Item.abc123", flags: {} }] };
  const cls = { system: { awards: [{ atLevel: 1, kind: "fixed", ref: "uuid:Item.abc123" }] } };
  assert.deepEqual(awardsThrough(actor, cls, 3).fixed, []);
});

test("a copy this module granted is recognised by its stamp, not by its own uuid", () => {
  // The trap that doubled abilities live: an OWNED copy has its own uuid, so
  // matching a `uuid:` ref against it never succeeds. The grant stamp does.
  const owned = { uuid: "Actor.a1.Item.copy9", flags: { "acks-extras": { grantedFrom: "uuid:Item.world7" } } };
  const cls = { system: { awards: [{ atLevel: 1, kind: "fixed", ref: "uuid:Item.world7" }] } };
  assert.deepEqual(awardsThrough({ items: [owned] }, cls, 1).fixed, []);
  // Without the stamp the ref no longer matches, and the world lookup is what
  // has to answer — empty here, so the award stands.
  const bare = { uuid: "Actor.a1.Item.copy9", flags: {} };
  assert.equal(awardsThrough({ items: [bare] }, cls, 1).fixed.length, 1);
});

/* --------------------- first-level hit points --------------------- */

// hitpoints.mjs reads no Foundry global but `Roll`, so the shipped path runs
// offline against a scripted die.
const scriptDie = (faces) => {
  let next = 0;
  return class {
    constructor(formula) {
      this.formula = formula;
    }
    async evaluate() {
      const count = parseInt(/^(\d+)d/.exec(this.formula)?.[1] ?? "1", 10);
      const rolled = Array.from({ length: count }, () => faces[next++ % faces.length]);
      this.dice = [{ results: rolled.map((result) => ({ result, active: true })) }];
      this.total = rolled.reduce((sum, face) => sum + face, 0);
      return this;
    }
  };
};

const atLevelOne = async (conMod, faces) => {
  globalThis.Roll = scriptDie(faces);
  const cls = { system: { maximumLevel: 14, hitDie: "1d8", levelRow: (n) => (n === 1 ? { hd: "1d8" } : null) } };
  return (await rebuildHitPoints({ system: { scores: { con: { mod: conMod } } } }, cls, 1)).max;
};

const atest = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

await atest("first level applies Constitution to the die it rolls", async () => {
  assert.equal(await atLevelOne(2, [1]), 3);
  assert.equal(await atLevelOne(2, [8]), 10);
});

await atest("a Constitution penalty cannot take the first die below one", async () => {
  assert.equal(await atLevelOne(-3, [1]), 1);
  assert.equal(await atLevelOne(-3, [2]), 1);
  assert.equal(await atLevelOne(-3, [8]), 5);
});

await atest("chargen asks for the rebuild, so a generated character's hit points are rolled", () => {
  // `rebuildVitals` defaults to false, so a chargen call that omits it rolls no
  // hit dice at all and the character keeps whatever the bare actor was made
  // with — no die, no Constitution and no per-die floor.
  const src = readFileSync(new URL("../scripts/classes/chargen.mjs", import.meta.url), "utf8");
  const call = /applyClass\(actor, cls, \{([^}]*)\}\)/.exec(src);
  assert.ok(call, "applyChargen still calls applyClass");
  assert.match(call[1], /rebuildVitals:\s*true/);
});

/* ------------------ answering a rung of the ladder ------------------ */

await atest("a level-up climbs exactly one rung, keyed as the picker remembers it", () => {
  // The wizard used to index its own filtered slice, which produced keys the
  // picker's `awardsThrough` had never heard of — so nothing the wizard asked
  // was ever recognised as answered.
  const at5 = awardsAt({ items: [] }, LADDERED, 5);
  assert.equal(at5.choices.length, 1);
  assert.equal(at5.fixed.length, 0);
  const through5 = awardsThrough({ items: [] }, LADDERED, 5);
  const matching = through5.choices.find((c) => c.atLevel === 5);
  assert.equal(at5.choices[0].key, matching.key, "the two surfaces key the same rung alike");
  // And with that key recorded, the picker does not ask it again.
  assert.ok(!awardsThrough({ items: [] }, LADDERED, 5, [at5.choices[0].key]).choices.some((c) => c.atLevel === 5));
});

await atest("a rung answered anywhere closes it; only a ref grants from it", () => {
  // "Already on the sheet" is an ANSWER — it closes the question — but it is
  // not a pick, so nothing materializes. Conflating the two is what forced a
  // player to choose a proficiency they did not want and delete it afterwards.
  assert.equal(closesRung(ANSWERED), true);
  assert.equal(grantsFrom(ANSWERED), false);
  assert.equal(closesRung("def.prof.berserkergang"), true);
  assert.equal(grantsFrom("def.prof.berserkergang"), true);
  // A rung left open is the one answer that closes nothing.
  assert.equal(closesRung(""), false);
  assert.equal(grantsFrom(""), false);
  assert.deepEqual(grantableRefs(["def.prof.a", ANSWERED, "", "def.prof.a", "def.prof.b"]), [
    "def.prof.a",
    "def.prof.b",
  ]);
});

await atest("an option the character already holds is offered, never removed", () => {
  // The reported defect: the picker filtered owned options OUT, so a character
  // who had already taken their 1st-level proficiency could not say so — the
  // rung offered only things they did not want. Held options are MARKED now,
  // and `grantAbility` is what declines to double them.
  const src = readFileSync(new URL("../scripts/classes/apply.mjs", import.meta.url), "utf8");
  assert.ok(
    !/filter\(\(o\) => !ownsRef\(/.test(src),
    "apply.mjs must not filter owned options out of a rung's list",
  );
  const picks = readFileSync(new URL("../scripts/classes/picks.mjs", import.meta.url), "utf8");
  assert.match(picks, /owned:\s*!!actor && ownsRef\(actor, o\.ref\)/, "picks.mjs marks them instead");
});

await atest("every surface asks a rung through the one control", () => {
  // Three copies of this question is three places to answer it differently,
  // which is exactly how only one of them came to consider what the character
  // already owned. `optionsForChoice` has one caller now, and it is picks.mjs.
  const callers = ["apply.mjs", "levelup.mjs", "stat-page.mjs", "assign-app.mjs"].filter((f) =>
    /optionsForChoice/.test(readFileSync(new URL(`../scripts/classes/${f}`, import.meta.url), "utf8")),
  );
  assert.deepEqual(callers, [], "no surface may build a rung's options for itself");
  for (const file of ["apply.mjs", "levelup.mjs", "stat-page.mjs", "assign-app.mjs"]) {
    const src = readFileSync(new URL(`../scripts/classes/${file}`, import.meta.url), "utf8");
    assert.match(src, /from "\.\/picks\.mjs"/, `${file} asks through picks.mjs`);
  }
});

await atest("the level-up wizard records the rung it closed", () => {
  // Without this a character levelled to 5th met every pick from 1st to 5th
  // again the moment their class was re-applied — the reported symptom.
  const src = readFileSync(new URL("../scripts/classes/levelup.mjs", import.meta.url), "utf8");
  assert.match(src, /answered:\s*choices\s*\n?\s*\.filter/s, "the wizard hands its answered keys to applyClass");
});

await atest("the class picker never wipes what a character already owns", () => {
  // Generating a character REPLACES the last run of the page; binding a class
  // to a played character is the opposite act. The picker therefore uses the
  // merging half of chargen and never `applyChargen`, whose default is a wipe.
  const src = readFileSync(new URL("../scripts/classes/assign-app.mjs", import.meta.url), "utf8");
  assert.ok(!/applyChargen/.test(src), "assign-app must not route through the wiping path");
  assert.match(src, /applyTemplate\(/, "it applies a package by merging it");
});

/* ---------------------- template packages ------------------------- */

const { bestBaseMatch, parseEmbellishment, applyShortfall, templateItemName, buildPlaceholderAbility, stripRepresented, usableAsSource } =
  await import("../scripts/classes/template-packages.mjs");

test("a short base name resolves by exact match", () => {
  // "Staff"(5 folded) could never resolve under the old ≥6-substring rule, so
  // every template staff landed as a bare unwieldable `item` — the reported
  // bug. Exact folded equality wins at any length.
  const world = [{ name: "Staff" }, { name: "Quarterstaff" }];
  assert.equal(bestBaseMatch("staff", world), world[0]);
});

test("a 4–5 letter base needs a word boundary, never a bare substring", () => {
  const world = [{ name: "Mace" }];
  assert.equal(bestBaseMatch("Iron-shod mace", world), world[0]);
  assert.equal(bestBaseMatch("Grimace mask", world), null);
});

test("a ≥6 base still resolves by containment, longest match winning", () => {
  const world = [{ name: "Short Bow" }, { name: "Spellbook (blank)" }];
  assert.equal(bestBaseMatch("Crudely-crafted shortbow", world), world[0]);
  // The paren-stripped candidate name is what an embellished instance holds.
  assert.equal(bestBaseMatch("Iron-shod spellbook with brass clasps", world), world[1]);
});

test("descriptor within a base descriptor resolves the staff skin", () => {
  const world = [{ name: "Staff" }];
  assert.equal(bestBaseMatch("Staff tipped with glass gemstone", world), world[0]);
});

test("a plural cell names the singular base", () => {
  // A cell prints what the character carries, not what the catalogue calls it:
  // "torches" and "darts" are the Torch and the Dart the world holds. Read as
  // unknown gear they arrived as trinkets with no damage on them.
  const world = [{ name: "Torch" }, { name: "Dart" }, { name: "Sword" }];
  assert.equal(bestBaseMatch("Torches", world), world[0]);
  assert.equal(bestBaseMatch("Feathered darts", world), world[1]);
  assert.equal(bestBaseMatch("Pair of gracefully curved swords", world), world[2]);
  // The whole-word rule still holds either side of the plural.
  assert.equal(bestBaseMatch("Swordfish steaks", world), null);
});

test("the embellishment is the descriptor minus the base", () => {
  assert.equal(parseEmbellishment("Crudely-crafted shortbow", "Short Bow"), "Crudely-crafted");
  assert.equal(parseEmbellishment("Staff tipped with glass gemstone", "Staff"), "tipped with glass gemstone");
});

test("the Intellect shortfall drops the LAST ability and the SECOND spell", () => {
  // RR Ch. 2 §II.1 names the entries to remove; on a bundle the positions are
  // read off the itemList's own order, per type.
  const rows = [
    { type: "ability", name: "A" },
    { type: "ability", name: "B" },
    { type: "weapon", name: "Sword" },
    { type: "spell", name: "S1" },
    { type: "spell", name: "S2" },
  ];
  const { kept, dropped } = applyShortfall(rows, { profs: 1, spells: 1 });
  assert.deepEqual(dropped, ["B", "S2"]);
  assert.deepEqual(kept.map((r) => r.name), ["A", "Sword", "S1"]);
  // The first (and only) spell is the one every character begins with — a
  // single spell is never dropped.
  const single = applyShortfall([{ type: "spell", name: "Only" }], { profs: 0, spells: 1 });
  assert.deepEqual(single.dropped, []);
});

test("a printed count lives on quantity, never in the name", () => {
  assert.equal(templateItemName({ name: "2 flasks of holy water", qty: 2 }), "Flasks of holy water");
  assert.equal(templateItemName({ name: "staff", qty: 1 }), "Staff");
});

test("an unresolvable proficiency is still a document to repair", () => {
  // The package is a CONTAINER: a proficiency nothing defines yet must be a
  // real item a Judge can retype or replace, not invisible text on the class
  // row. It carries the printed name and nothing else — no rules prose.
  const ph = buildPlaceholderAbility({ name: "Manual of Arms", ref: "def.prof.manualOfArms", rank: 2 });
  assert.equal(ph.type, "ability");
  assert.equal(ph.name, "Manual of Arms");
  assert.deepEqual(ph.system, {});
  assert.equal(ph.flags["acks-extras"].grantedFrom, "def.prof.manualOfArms");
});

test("resolution reaches the compendia, not only game.items", () => {
  // The importer can be configured to import into a PACK. Resolving only
  // against the world is why a compendium-mode world materialized packages
  // with no proficiencies at all and every base item unresolved.
  const src = readFileSync(new URL("../scripts/classes/template-packages.mjs", import.meta.url), "utf8");
  assert.match(src, /getIndex\(\{ fields: INDEX_FIELDS \}\)/, "pack indexes are read for resolution");
  assert.match(src, /export async function findSource/, "one resolver: world first, then packs");
  assert.match(src, /export async function resolveBaseDoc/, "gear bases resolve through the packs too");
});

test("a row entry the bundle represents is stripped, by ref or by name", () => {
  // One owner. Without this an importer Update — which rewrites the whole
  // `system` and restores the printed arrays — would grant the package twice.
  const bundle = {
    system: {
      itemList: [
        { type: "ability", name: "Adventuring", uuid: "Item.aaa" },
        { type: "weapon", name: "Staff tipped with glass gemstone", uuid: "Item.bbb" },
      ],
    },
  };
  const row = {
    abilities: [{ ref: "", name: "Adventuring" }, { ref: "", name: "Alertness" }],
    items: [{ name: "staff tipped with glass gemstone", qty: 1 }],
    spells: [],
  };
  assert.equal(stripRepresented(row, bundle), true);
  assert.deepEqual(row.abilities.map((a) => a.name), ["Alertness"]);
  assert.deepEqual(row.items, []);
});

test("stripping is evidence-based: what the bundle lacks stays printed", () => {
  // The safety property that makes single ownership non-destructive — a
  // partial package can never silently shorten a starting kit, because only
  // entries the bundle demonstrably carries are removed.
  const row = {
    abilities: [{ ref: "def.prof.alertness", name: "Alertness" }],
    items: [{ name: "smooth-worn staff", qty: 1 }],
    spells: [{ name: "Beguile Humanoid" }],
  };
  assert.equal(stripRepresented(row, { system: { itemList: [] } }), false);
  assert.equal(row.abilities.length + row.items.length + row.spells.length, 3);
});

test("a placeholder can never resolve itself", () => {
  // Found live: a placeholder is a document carrying the printed NAME and
  // nothing else, so a search by name matched it, cloned its emptiness as
  // the "resolution", and cleared the unresolved flag — the Judge's signal
  // that a real definition is still missing went quiet on the next routine
  // re-run, with nothing repaired. An unresolved part is never a source.
  const placeholder = { flags: { "acks-extras": { templatePart: { kind: "ability", unresolved: true } } } };
  const resolvedCopy = { flags: { "acks-extras": { templatePart: { kind: "ability", unresolved: false } } } };
  const anImport = { flags: { "acks-importer": { cookbook: { id: "def.prof.alertness" } } } };
  assert.equal(usableAsSource(placeholder), false);
  // A part that DID resolve stays usable, so an earlier copy is relinked
  // rather than doubled on the next pass.
  assert.equal(usableAsSource(resolvedCopy), true);
  assert.equal(usableAsSource(anImport), true);

  const src = readFileSync(new URL("../scripts/classes/template-packages.mjs", import.meta.url), "utf8");
  assert.match(src, /const exclude = \[doc\.uuid\];/, "and the document being upgraded excludes itself by uuid");
  // A standing gap is reported on EVERY pass, not only the one that minted
  // the placeholder — a later run that says nothing reads as a clean run.
  assert.match(src, /report\.unresolved\.push\(doc\.name\);/, "an unfilled gap is re-reported each run");
  // An upgrade to a world definition LINKS it, matching the create path, so
  // the world never ends up holding a redundant twin of its own ability.
  assert.match(src, /replacement\.world && part\.kind === "ability"/, "a world source is linked, not copied");
  // Gear bases exclude every part this feature minted, so a bare item cannot
  // exact-match its own descriptor and a skin cannot become a second skin's base.
  assert.match(src, /GEAR_TYPES\.includes\(i\.type\) && !partOf\(i\)/, "a base is an import, never our own output");
});

test("a package never consumes the imports it points at", () => {
  // A template naming a sword must leave the imported Sword alone: the item
  // library is a SOURCE, not a package's private contents. Every deletion is
  // therefore gated on this module's own templatePart stamp (its bundles,
  // skins, copies and placeholders), which a linked import never carries.
  const src = readFileSync(new URL("../scripts/classes/template-packages.mjs", import.meta.url), "utf8");
  const deletions = [...src.matchAll(/await (\w+)\.delete\(\)/g)];
  assert.equal(deletions.length, 3, "three deletion sites: detach's items and tables, and a replaced placeholder");
  // Detach deletes only what `mine` (partOf → templatePart) admits.
  assert.match(src, /const mine = \(doc\) => \{\s*const part = partOf\(doc\);/, "detach filters by this module's stamp");
  assert.match(src, /game\.items\.filter\(mine\)/, "and never by a bare type or name scan");
  // The replacement path only ever deletes a placeholder it itself minted.
  assert.match(src, /if \(!part\?\.unresolved\) continue;/, "upgrades touch only unresolved parts");
  // Gear is SKINNED FROM a base by copying it — the base is read, never moved.
  assert.match(src, /const data = base\.toObject\(\)/, "a base item is copied, not consumed");
});

test("a template's package and its leftovers are both applied, once each", () => {
  const chargen = readFileSync(new URL("../scripts/classes/chargen.mjs", import.meta.url), "utf8");
  const start = chargen.indexOf("if (expanded.bundle");
  assert.ok(start > 0, "applyTemplate still has a bundle branch");
  const bundleBranch = chargen.slice(start, start + 1400);
  assert.match(bundleBranch, /grantBundleRows\(actor, kept, report\)/, "the bundle's own contents");
  assert.match(bundleBranch, /grantRowEntries\(actor, template, report\)/, "plus what it could not carry");
});

test("applyTemplate is bundle-first with the row path as fallback", () => {
  const src = readFileSync(new URL("../scripts/classes/chargen.mjs", import.meta.url), "utf8");
  assert.match(src, /expandTemplate\(template\)/, "the bundle is expanded before any row entry is read");
  assert.match(src, /grantRowEntries\(actor, \{ abilities, items: template\.items \?\? \[\], spells \}, report\)/,
    "the legacy row path survives for un-upgraded worlds");
});

console.log(`test-classes: ${passed} assertion groups passed.`);
