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
import { awardsThrough } from "../scripts/classes/grants.mjs";
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

console.log(`test-classes: ${passed} assertion groups passed.`);
