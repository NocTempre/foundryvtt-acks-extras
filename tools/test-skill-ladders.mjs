/**
 * The imported skills' ladders as a borrowed throw reads them
 * (scripts/abilities/skill-ladders.mjs, through `ladderRungAt` in
 * scripts/classes/registry.mjs) and the migration that moves the party check's
 * old per-item flags onto the throw (scripts/abilities/skill-flag-migration.mjs).
 *
 * Stand-in documents; every figure is invented. What this pins: a borrowed
 * ladder that no class document publishes is read from the world's imported
 * skill of that key, a class that does publish it wins, a pack-held skill is
 * read once the cache has loaded and a cold cache answers nothing rather than a
 * wrong figure, the level reads at the fraction the throw states, and the
 * migration rewrites the default throw before it removes the flags, leaves what
 * it cannot move exactly, and is idempotent. The world's own sweep and the
 * figures a character sees are the live walk's (docs/formation/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

class Stub {}
globalThis.game = {
  user: { id: "u1", isGM: true },
  i18n: { localize: (k) => k, format: (k) => k, has: () => true },
  settings: { get: () => ({}) },
  actors: [],
  items: [],
  packs: [],
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.fromUuidSync = () => null;
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: {
    escapeHTML: (s) => String(s),
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
    getProperty: (obj, path) => String(path).split(".").reduce((at, part) => at?.[part], obj),
  },
  applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: { renderTemplate: async () => "" } },
};

const { ladderRungAt, resolveLevelOutcome } = await import("../scripts/classes/registry.mjs");
const { importedLadderFor, skillLadderRungs, refreshLadders } = await import("../scripts/abilities/skill-ladders.mjs");
const { planSkillFlagMigration, migrateItem, factorFraction, migrateSkillFlags } = await import("../scripts/abilities/skill-flag-migration.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { rollsOf } = await import("../scripts/abilities/ability-rolls.mjs");
// The schema's coercion needs Foundry's data model; what is pinned here is what
// the migration hands it, so the stand-in returns the input unchanged.
const { default: AbilityExtras } = await import("../scripts/abilities/ability-extras.mjs");
AbilityExtras.normalize = (raw) => JSON.parse(JSON.stringify(raw));

/* --- fixtures ---------------------------------------------------------------- */
let serial = 0;
/** A level ladder as the importer writes it onto a roll target. */
const ladder = (...pairs) => ({ kind: "breakpoints", breakpoints: pairs.map(([atLevel, value, extra]) => ({ atLevel, value, ...(extra ?? {}) })) });
const throwOf = (key, target) => ({ key, label: key, formula: "1d20", rollType: "above", target, scale: "level" });

/** An ability document keeping its flags, with `update` applying the dotted paths the module writes. */
function item(name, { id = "", rolls = [], flags = {}, system = {} } = {}) {
  const f = { "acks-extras": { extras: { rolls, effects: [], provides: [] }, cookbook: id ? { id } : undefined, ...flags } };
  const doc = {
    id: `i${++serial}`, type: "ability", name, system: { ...system }, flags: f,
    getFlag: (scope, key) => f[scope]?.[key],
    async setFlag(scope, key, value) { f[scope][key] = value; },
    async unsetFlag(scope, key) { delete f[scope][key]; },
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        const m = /^flags\.acks-extras\.(.+)$/.exec(path);
        if (!m) continue;
        const rest = m[1];
        if (rest.startsWith("-=")) delete f["acks-extras"][rest.slice(2)];
        else f["acks-extras"][rest] = value;
      }
    },
  };
  return doc;
}
const skill = (key, ...pairs) => item(key, { id: `def.skill.${key}`, rolls: [throwOf("throw1", ladder(...pairs))] });
const actorOf = (items, level = 7) => {
  const a = { id: `a${++serial}`, name: "Tester", system: { details: { level } }, items };
  for (const i of items) i.actor = a;
  return a;
};
const reset = () => { game.items.length = 0; game.actors.length = 0; game.packs.length = 0; };
const half = { atLevelNum: 1, atLevelDen: 2 };

/* ---------------------------------------------------------------------------- */

await ok("a ladder no class publishes is read from the world's imported skill, at the stated fraction", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7], [8, 5]));
  assert.equal(ladderRungAt("thief", "climbing", half, 7, "up").value, 7, "level 7 at half, rounded up, is 4: the 4th-level rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 6, "up").value, 9, "level 6 at half is 3, still below the 4th-level rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 6, "down").value, 9);
  assert.equal(ladderRungAt("thief", "climbing", half, 7, "down").value, 9, "rounded down, level 7 at half is 3");
  assert.equal(ladderRungAt("thief", "climbing", "full", 8, "up").value, 5, "a whole level reads its own rung");
  assert.equal(ladderRungAt("thief", "climbing", half, 1, "up").value, 9, "the floor is level 1");
  assert.equal(ladderRungAt("thief", "unknownskill", half, 7, "up"), null, "a skill not imported gives nothing, not a guess");
});

await ok("the rung read whole keeps its text and outcome, so a borrowed throw reaches a non-number the way a skill's does", async () => {
  reset();
  game.items.push(skill("hiding", [1, 11], [6, null, { text: "auto", outcome: "auto" }]));
  const out = resolveLevelOutcome({ kind: "progression", as: "thief", table: "hiding", ...half, round: "up" }, 12, {});
  assert.equal(out.outcome, "auto");
  assert.equal(resolveLevelOutcome({ kind: "progression", as: "thief", table: "hiding", ...half, round: "up" }, 4, {}).target, 11);
});

await ok("a class that publishes the ladder wins over the imported skill", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7]));
  registerTable({ id: "acks.class.sneakthief", tables: { "ladder.climbing": [{ atLevel: 1, value: 3, text: "3", outcome: "throw" }] } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    assert.equal(ladderRungAt("sneakthief", "climbing", "full", 8, "up").value, 3);
    assert.equal(ladderRungAt("thief", "climbing", "full", 8, "up").value, 7, "another class falls through to the skill");
  } finally {
    unregisterTable("acks.class.sneakthief", "test");
  }
});

await ok("a skill held in a world pack answers after the cache loads, and a cold cache answers nothing", async () => {
  reset();
  const packed = skill("sneaking", [1, 10], [5, 6]);
  game.packs.push({ documentName: "Item", collection: "world.skills", metadata: { packageType: "world" }, getDocuments: async () => [packed] });
  assert.equal(importedLadderFor("sneaking", null), null, "nothing is loaded yet");
  assert.deepEqual(skillLadderRungs("sneaking"), []);
  await refreshLadders();
  assert.equal(ladderRungAt("thief", "sneaking", "full", 5, "up").value, 6);
  assert.deepEqual(skillLadderRungs("sneaking").map((r) => [r.atLevel, r.value]), [[1, 10], [5, 6]]);
});

await ok("the owner's own copy of a skill is read before the world's", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9]));
  const mine = skill("climbing", [1, 4]);
  const a = actorOf([mine]);
  assert.equal(importedLadderFor("climbing", a).breakpoints[0].value, 4);
  assert.equal(importedLadderFor("climbing", null).breakpoints[0].value, 9);
});

/* --- the migration ----------------------------------------------------------- */

await ok("a level factor states itself as the smallest exact fraction, or nothing", async () => {
  assert.deepEqual(factorFraction(0.5), { num: 1, den: 2 });
  assert.deepEqual(factorFraction(1), { num: 1, den: 1 });
  assert.deepEqual(factorFraction(0.75), { num: 3, den: 4 });
  assert.equal(factorFraction(0), null);
  assert.equal(factorFraction(0.333), null, "a figure no small fraction states exactly is not guessed at");
});

await ok("an item with no legacy flag is left alone, and one whose flags change nothing is cleared", async () => {
  reset();
  assert.equal(planSkillFlagMigration(item("Plain")).action, "none");
  assert.equal(planSkillFlagMigration(item("Whole", { flags: { levelFactor: 1 } })).action, "clear");
});

await ok("a named skill moves onto the default throw as a progression, and the flags are removed", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7]));
  const borrowed = item("Wall Scrambling", { id: "def.power.wallscrambling", rolls: [throwOf("primary", { kind: "flat", flat: 12 })], flags: { thiefSkill: "climbing", levelFactor: 0.5 } });
  assert.equal(await migrateItem(borrowed, null), "moved");
  const [roll] = rollsOf(borrowed);
  assert.deepEqual(roll.target, { kind: "progression", as: "thief", table: "climbing", atLevelNum: 1, atLevelDen: 2, round: "up" });
  assert.equal(borrowed.getFlag("acks-extras", "thiefSkill"), undefined);
  assert.equal(borrowed.getFlag("acks-extras", "levelFactor"), undefined);
  assert.equal(borrowed.getFlag("acks-extras", "isSkill"), true, "a flag that made it a skill keeps it one");
  assert.equal(await migrateItem(borrowed, null), "none", "a second run finds nothing");
});

await ok("a fraction with no table named reads the item's own imported skill key", async () => {
  reset();
  game.items.push(skill("hiding", [1, 11], [4, 8]));
  const own = item("Hiding", { id: "def.skill.hiding", rolls: [throwOf("throw1", ladder([1, 11], [4, 8]))], flags: { levelFactor: 0.5 } });
  assert.equal(planSkillFlagMigration(own, null).table, "hiding");
  const lonely = item("Anything", { flags: { levelFactor: 0.5 } });
  assert.deepEqual([planSkillFlagMigration(lonely, null).action, planSkillFlagMigration(lonely, null).reason], ["keep", "noTable"]);
});

await ok("what cannot be moved exactly keeps its flags and says why", async () => {
  reset();
  const unimported = item("Wall Scrambling", { flags: { thiefSkill: "climbing" } });
  assert.deepEqual([planSkillFlagMigration(unimported, null).action, planSkillFlagMigration(unimported, null).reason], ["keep", "notImported"]);
  assert.equal(await migrateItem(unimported, null), "keep");
  assert.equal(unimported.getFlag("acks-extras", "thiefSkill"), "climbing", "the flag stays for the party check to be re-run once the skill is imported");
  game.items.push(skill("climbing", [1, 9]));
  const odd = item("Odd", { flags: { thiefSkill: "climbing", levelFactor: 0.333 } });
  assert.deepEqual([planSkillFlagMigration(odd, null).action, planSkillFlagMigration(odd, null).reason], ["keep", "fraction"]);
});

await ok("the world sweep counts what it moved, cleared and left, over world and character items", async () => {
  reset();
  game.items.push(skill("climbing", [1, 9], [4, 7]));
  const moves = item("Wall Scrambling", { rolls: [throwOf("primary", { kind: "flat", flat: 12 })], flags: { thiefSkill: "climbing", levelFactor: 0.5 } });
  const clears = item("Whole", { flags: { levelFactor: 1 } });
  const keeps = item("Orphan", { flags: { thiefSkill: "notimported" } });
  game.items.push(moves);
  game.actors.push(actorOf([clears, keeps]));
  const out = await migrateSkillFlags();
  assert.deepEqual([out.moved, out.cleared, out.kept, out.keptReasons], [1, 1, 1, { notImported: 1 }]);
  const again = await migrateSkillFlags();
  assert.deepEqual([again.moved, again.cleared, again.kept], [0, 0, 1], "only the one it cannot move is met again");
});

await ok("a player's client does not sweep", async () => {
  reset();
  game.user = { id: "p1", isGM: false };
  try {
    const kept = item("Wall Scrambling", { flags: { thiefSkill: "climbing" } });
    game.items.push(kept);
    assert.deepEqual(await migrateSkillFlags(), { moved: 0, cleared: 0, kept: 0, keptReasons: {} });
  } finally {
    game.user = { id: "u1", isGM: true };
  }
});

console.log(`\n${passed} passed`);
