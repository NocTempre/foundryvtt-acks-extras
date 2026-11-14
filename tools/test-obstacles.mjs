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
  OBSTACLES, OBSTACLE_KEYS, OUTCOMES_TABLE, adventuringTarget, stretchFeet, throwsFor, obstaclePlan, readThrow,
  attemptObstacle, obstacleOutcome, outcomeProvenance,
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

/** The registered `spelunkingOutcomes` table, with invented words. */
const OUTCOMES = {
  easyClimb: { fail: { text: "Waits a moment", falls: false }, botch: { text: "Slips a little", falls: false } },
  sheerClimb: { fail: { text: "Holds on", falls: false }, botch: { text: "Plummets", falls: true } },
};

const load = (spelunking = SPELUNKING, outcomes = OUTCOMES) => registerTable(
  { id: FORMATION_DOC, source: "invented", tables: { spelunking, ...(outcomes ? { [OUTCOMES_TABLE]: outcomes } : {}) } },
  { priority: PRIORITY.WORLD, source: "test" },
);

globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` } };

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

// ---- what a missed throw costs is imported ----------------------------------
ok("a failed throw and a natural 1 each read their own imported row", () => {
  load();
  const at = (kind, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow: 10 }), natural, total });
  assert.deepEqual(at("easyClimb", 5, 5).outcome, OUTCOMES.easyClimb.fail);
  assert.equal(at("easyClimb", 5, 5).ends, false, "an outcome that names no fall leaves the next stretch to throw");
  assert.deepEqual(at("easyClimb", 1, 1).outcome, OUTCOMES.easyClimb.botch);
  assert.equal(at("easyClimb", 1, 1).botch, true);
  assert.equal(at("easyClimb", 1, 1).ends, false, "a natural 1 whose row names no fall does not end it either");
  assert.equal(at("sheerClimb", 5, 5).ends, false);
  assert.equal(at("sheerClimb", 1, 1).ends, true, "a fall ends the attempt");
  assert.equal(at("crawl", 12, 12).outcome, "progress");
  resetTables();
});

ok("a fixed rope reads the easy climb's outcomes", () => {
  load();
  const read = readThrow({ plan: obstaclePlan({ kind: "sheerClimb", assisted: true }), natural: 4, total: 4 });
  assert.deepEqual(read.outcome, OUTCOMES.easyClimb.fail);
  resetTables();
});

ok("an outcome not imported is null, and a miss on it ends the attempt rather than cost nothing", () => {
  load(SPELUNKING, null);
  for (const kind of OBSTACLE_KEYS) {
    assert.equal(obstacleOutcome(kind, "fail"), null, kind);
    assert.equal(obstacleOutcome(kind, "botch"), null, kind);
  }
  const read = readThrow({ plan: obstaclePlan({ kind: "crawl" }), natural: 3, total: 3 });
  assert.equal(read.outcome, null);
  assert.equal(read.ends, true);
  load();
  assert.equal(obstacleOutcome("crawl", "fail"), null, "an obstacle the table leaves out is not imported");
  resetTables();
});

ok("a Judge's override with no words reads as not imported, and `falls` must be said", () => {
  load(SPELUNKING, { easyClimb: { fail: { text: "  " }, botch: { text: "Slides", falls: "yes" } } });
  assert.equal(obstacleOutcome("easyClimb", "fail"), null);
  assert.deepEqual(obstacleOutcome("easyClimb", "botch"), { text: "Slides", falls: false });
  resetTables();
});

ok("the outcome's tooltip names the imported page, the override, or is empty", () => {
  registerTable({ id: FORMATION_DOC, source: "invented", cites: { [OUTCOMES_TABLE]: "XX p. 9" }, tables: { [OUTCOMES_TABLE]: OUTCOMES } },
    { priority: PRIORITY.WORLD, source: "test" });
  assert.match(outcomeProvenance(obstacleOutcome("easyClimb", "fail")), /cadenceFrom\.import.*XX p\. 9/);
  registerTable({ id: FORMATION_DOC, tables: { [OUTCOMES_TABLE]: OUTCOMES } }, { priority: PRIORITY.OVERRIDE, source: "judge" });
  assert.match(outcomeProvenance(obstacleOutcome("easyClimb", "fail")), /cadenceFrom\.override/);
  assert.equal(outcomeProvenance(null), "");
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
  globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") } };
  globalThis.ChatMessage = { create: async (m) => { posted.push(m); return m; } };
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; rolled.push(formula); }
    async evaluate() { this.total = naturals.shift(); this.dice = [{ results: [{ result: this.total }] }]; return this; }
  };
  return { posted, rolled };
}

await okAsync("a party at an obstacle with no stretch imported rolls nothing and lists each name with no reason", async () => {
  resetTables();
  const world = mockWorld([]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" } }, { actor: { name: "Brun" }, proficient: true, classThrow: 9 }],
    { kind: "easyClimb" });
  assert.deepEqual(world.rolled, []);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.blocked && r.plan.reason === "notImported"));
  assert.equal(world.posted.length, 1);
  assert.doesNotMatch(world.posted[0].content, /obstacles\.reason/);
  assert.match(world.posted[0].content, /<li><strong>Ayla<\/strong><\/li>/);
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
  assert.deepEqual(results[0].attempts[0].outcome, OUTCOMES.sheerClimb.botch);
  assert.match(world.posted[0].content, /Plummets/, "the card prints the imported words");
  assert.match(world.posted[0].content, /data-tooltip-text="[^"]*cadenceFrom/, "with a tooltip saying where they came from");
  resetTables();
});

await okAsync("imported words reach the card escaped, and an unimported outcome reads as a plain miss", async () => {
  load(SPELUNKING, { crawl: { fail: { text: "<b>Stuck</b>", falls: false } } });
  let world = mockWorld([2, 2]);
  await attemptObstacle([{ actor: { name: "Ayla" } }], { kind: "crawl", feet: 80 });
  assert.match(world.posted[0].content, /&lt;b>Stuck&lt;\/b>/);
  world = mockWorld([2]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" } }], { kind: "narrowLedge", feet: 80 });
  assert.equal(world.rolled.length, 1, "a miss with no outcome imported stops that climber");
  assert.equal(results[0].attempts[0].outcome, null);
  assert.match(world.posted[0].content, /obstacles\.outcome\.missed/);
  resetTables();
});

console.log(`test-obstacles: all ${passed} checks passed`);
