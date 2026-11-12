/**
 * Obstacles (the Spelunking tables): the procedure runs on whatever the
 * `spelunking` table holds, and says so when it holds nothing. Every figure
 * here is invented; the printed ones arrive through the importer.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import { SPELUNKING_COLUMNS } from "../scripts/importer/formation-binding.mjs";
import {
  OBSTACLES, OUTCOME, OBSTACLE_KEYS, adventuringTarget, stretchFeet, throwsFor, obstaclePlan, readThrow,
  attemptObstacle,
} from "../scripts/formation/obstacles.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };
const okAsync = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/** The registered `spelunking` table, with invented figures. */
const SPELUNKING = {
  stretchFeet: 40,
  adventuring: {
    easyClimb: 6, sheerClimb: false, rappel: false,
    crawl: 6, narrowLedge: 7, precariousLedge: false,
  },
};

const load = (spelunking = SPELUNKING) => registerTable(
  { id: FORMATION_DOC, source: "invented", tables: { spelunking } },
  { priority: PRIORITY.WORLD, source: "test" },
);

// ---- the shape the importer fills ------------------------------------------
ok("the six obstacles are the six columns the binding reads, in order", () => {
  assert.deepEqual(SPELUNKING_COLUMNS.flat(), OBSTACLE_KEYS);
});

// ---- nothing imported -------------------------------------------------------
ok("with the table not imported nothing is a target and nothing is a stretch", () => {
  resetTables();
  for (const kind of OBSTACLE_KEYS) assert.equal(adventuringTarget(kind), null, kind);
  assert.equal(stretchFeet(), null);
  assert.equal(throwsFor(100), null);
});

ok("an ordinary adventurer's attempt is reported as not imported, never refused or rolled", () => {
  resetTables();
  for (const kind of OBSTACLE_KEYS) {
    const plan = obstaclePlan({ kind });
    assert.equal(plan.permitted, false, kind);
    assert.equal(plan.target, null, kind);
    assert.equal(plan.reason, "notImported", kind);
  }
});

ok("a proficient climber needs nothing the table prints", () => {
  resetTables();
  const plan = obstaclePlan({ kind: "sheerClimb", proficient: true, classThrow: 11 });
  assert.equal(plan.permitted, true);
  assert.equal(plan.target, 11);
});

// ---- imported --------------------------------------------------------------
ok("each obstacle reads its own printed target, or none may try", () => {
  load();
  assert.equal(adventuringTarget("easyClimb"), 6);
  assert.equal(adventuringTarget("narrowLedge"), 7);
  assert.equal(adventuringTarget("sheerClimb"), false);
  assert.equal(obstaclePlan({ kind: "narrowLedge" }).target, 7);
  assert.equal(obstaclePlan({ kind: "rappel" }).reason, "notPermitted");
  resetTables();
});

ok("a stretch of the imported length is one throw, and a longer face is more", () => {
  load();
  assert.equal(stretchFeet(), 40);
  assert.equal(throwsFor(0), 1);
  assert.equal(throwsFor(40), 1);
  assert.equal(throwsFor(41), 2);
  assert.equal(throwsFor(130), 4);
  resetTables();
});

ok("a fixed rope turns a sheer face into the easy climb, and no ledge into another", () => {
  load();
  const rope = obstaclePlan({ kind: "sheerClimb", assisted: true });
  assert.equal(rope.effective, "easyClimb");
  assert.equal(rope.target, 6);
  assert.equal(obstaclePlan({ kind: "precariousLedge", assisted: true }).permitted, false);
  resetTables();
});

ok("a Judge's override that is no positive figure reads as not imported", () => {
  load({ stretchFeet: "a rope's length", adventuring: { easyClimb: "", crawl: 0, narrowLedge: "x", sheerClimb: "no" } });
  assert.equal(stretchFeet(), null);
  for (const kind of ["easyClimb", "crawl", "narrowLedge", "sheerClimb"]) assert.equal(adventuringTarget(kind), null, kind);
  resetTables();
});

ok("one column left out leaves only that obstacle unimported", () => {
  load({ stretchFeet: 40, adventuring: { easyClimb: 6 } });
  assert.equal(obstaclePlan({ kind: "easyClimb" }).target, 6);
  assert.equal(obstaclePlan({ kind: "crawl" }).reason, "notImported");
  resetTables();
});

// ---- what a failure costs is the procedure ----------------------------------
ok("failure and a natural 1 cost what the obstacle's procedure says", () => {
  load();
  const at = (kind, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow: 10 }), natural, total });
  assert.equal(at("easyClimb", 5, 5).outcome, OUTCOME.noProgress);
  assert.equal(at("easyClimb", 1, 1).outcome, OUTCOME.fallUnlessGeared);
  assert.equal(at("sheerClimb", 5, 5).outcome, OUTCOME.fallUnlessGeared);
  assert.equal(at("sheerClimb", 1, 1).outcome, OUTCOME.fall);
  assert.equal(at("rappel", 5, 5).outcome, OUTCOME.slowDescent);
  assert.equal(at("narrowLedge", 1, 1).outcome, OUTCOME.fallUnlessBurglar);
  assert.equal(at("precariousLedge", 5, 5).outcome, OUTCOME.fallUnlessBurglar);
  assert.equal(at("crawl", 12, 12).outcome, "progress");
  resetTables();
});

ok("only the easy climb leaves the climber able to defend", () => {
  for (const kind of OBSTACLE_KEYS) assert.equal(OBSTACLES[kind].vulnerable, kind !== "easyClimb", kind);
});

ok("a plan with no target is not thrown against", () => {
  assert.deepEqual(readThrow({ plan: { permitted: true, target: null, obstacle: OBSTACLES.crawl }, natural: 20, total: 20 }),
    { ok: false, outcome: null });
});

// ---- the card --------------------------------------------------------------
/** Mocked Foundry globals, with a queue of naturals for the d20. */
function mockWorld(naturals) {
  const posted = [];
  const rolled = [];
  globalThis.game = {
    users: [{ id: "gm", isGM: true }],
    i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  };
  globalThis.ChatMessage = { create: async (m) => { posted.push(m); return m; } };
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; rolled.push(formula); }
    async evaluate() { this.total = naturals.shift(); this.dice = [{ results: [{ result: this.total }] }]; return this; }
  };
  return { posted, rolled };
}

await okAsync("a party at an obstacle with no stretch imported rolls nothing and names why", async () => {
  resetTables();
  const world = mockWorld([]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" } }, { actor: { name: "Brun" }, proficient: true, classThrow: 9 }],
    { kind: "easyClimb" });
  assert.deepEqual(world.rolled, []);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.blocked && r.plan.reason === "notImported"));
  assert.equal(world.posted.length, 1);
  assert.match(world.posted[0].content, /obstacles\.reason\.notImported/);
});

await okAsync("with the stretch imported each member throws once per stretch and a fall ends the climb", async () => {
  load();
  const world = mockWorld([4, 2, 15, 15]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" } }, { actor: { name: "Brun" } }],
    { kind: "easyClimb", feet: 80 });
  // Two stretches each. Ayla's 4 and 2 miss the target of 6, which costs a
  // round on an easy climb and not the climb; Brun's two 15s make it.
  assert.deepEqual(world.rolled, ["1d20", "1d20", "1d20", "1d20"]);
  assert.equal(results[0].attempts.length, 2);
  assert.equal(results[0].attempts.every((a) => a.success === false), true);
  assert.equal(results[1].attempts.every((a) => a.success === true), true);
  resetTables();
});

await okAsync("a fall on the first stretch stops that member's throws", async () => {
  load();
  const world = mockWorld([1]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" }, proficient: true, classThrow: 9 }],
    { kind: "sheerClimb", feet: 120 });
  assert.equal(world.rolled.length, 1);
  assert.equal(results[0].attempts[0].outcome, OUTCOME.fall);
  resetTables();
});

console.log(`test-obstacles: all ${passed} checks passed`);
