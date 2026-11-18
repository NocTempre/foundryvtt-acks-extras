/**
 * Obstacles (the Spelunking tables): the procedure runs on whatever the
 * `spelunking` table holds, and says so when it holds nothing. Every figure
 * here is invented; the printed ones arrive through the importer.
 */
import assert from "node:assert/strict";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";
import { FORMATION_DOC } from "../scripts/formation/constants.mjs";
import { PROGRESS_SPEED_WORDS, SPELUNKING_COLUMNS } from "../scripts/importer/formation-binding.mjs";
import {
  OBSTACLES, OBSTACLE_KEYS, OUTCOMES_TABLE, adventuringTarget, stretchFeet, throwsFor, obstaclePlan, readThrow,
  obstacleStep, attemptObstacle, obstacleOutcome, outcomeProvenance, obstacleVulnerable, botchBand,
  PROGRESS_SPEEDS, progressRate,
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
  vulnerable: {
    easyClimb: true, sheerClimb: false, rappel: true,
    crawl: false, narrowLedge: true, precariousLedge: false,
  },
  botchBand: { easyClimb: { min: 1, max: 1 }, sheerClimb: { min: 1, max: 1 } },
  progress: {
    easyClimb: { success: { share: 5 / 11, speed: "combat" } },
    rappel: { success: { share: 1, speed: "run" }, fail: { share: 2 / 9, speed: "combat" } },
  },
};

/**
 * The registered `spelunkingOutcomes` table, with invented words. The easy
 * climb's failed throw still covers ground; the sheer face's does not say so.
 */
const OUTCOMES = {
  easyClimb: { fail: { text: "Inch along", falls: false, advances: true }, botch: { text: "Slips a little", falls: false } },
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

ok("with the table not imported helplessness is null and no band is known", () => {
  resetTables();
  for (const kind of OBSTACLE_KEYS) {
    assert.equal(obstacleVulnerable(kind), null, kind);
    assert.equal(botchBand(kind), null, kind);
  }
});

ok("an obstacle carries no printed figure of its own", () => {
  for (const kind of OBSTACLE_KEYS) assert.deepEqual(Object.keys(OBSTACLES[kind]), ["label"], kind);
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
  const rope = obstaclePlan({ kind: "sheerClimb", ropeFixed: true });
  assert.equal(rope.effective, "easyClimb");
  assert.equal(rope.target, 6);
  assert.equal(obstaclePlan({ kind: "precariousLedge", ropeFixed: true }).permitted, false);
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
ok("a failed throw and a throw in the botch band each read their own imported row", () => {
  load();
  const at = (kind, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow: 10 }), natural, total });
  assert.deepEqual(at("easyClimb", 5, 5).outcome, OUTCOMES.easyClimb.fail);
  assert.equal(at("easyClimb", 5, 5).ends, false, "an outcome that names no fall does not end it by itself");
  assert.deepEqual(at("easyClimb", 1, 1).outcome, OUTCOMES.easyClimb.botch);
  assert.equal(at("easyClimb", 1, 1).botch, true);
  assert.equal(at("easyClimb", 1, 1).ends, false, "a botch whose row names no fall does not end it either");
  assert.equal(at("sheerClimb", 5, 5).ends, false);
  assert.equal(at("sheerClimb", 1, 1).ends, true, "a fall ends the attempt");
  assert.equal(at("crawl", 12, 12).outcome, "progress");
  resetTables();
});

ok("the natural result is read before the target: a total at or over it is still a botch", () => {
  load();
  const read = (kind, classThrow, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow }), natural, total });
  // A total well over the target, and one exactly on it, both inside the band.
  for (const total of [18, 10]) {
    const got = read("sheerClimb", 10, 1, total);
    assert.equal(got.success, false, `total ${total}`);
    assert.equal(got.botch, true, `total ${total}`);
    assert.deepEqual(got.outcome, OUTCOMES.sheerClimb.botch, `total ${total}`);
    assert.equal(got.ends, true, "the botch row names a fall");
  }
  // A target the botched face's total reaches on its own does not change that.
  assert.equal(read("sheerClimb", 0, 1, 1).botch, true);
  assert.equal(read("easyClimb", 0, 1, 1).success, false);
  // Any face outside the band at the same total still makes it.
  assert.equal(read("sheerClimb", 10, 2, 10).success, true);
  resetTables();
});

ok("the botch band is the imported span, not a fixed face", () => {
  load({ ...SPELUNKING, botchBand: { easyClimb: { min: 1, max: 3 }, crawl: { min: 5, max: 5 } } });
  const read = (kind, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow: 8 }), natural, total });
  for (const natural of [1, 2, 3]) {
    const got = read("easyClimb", natural, 20);
    assert.equal(got.botch, true, `natural ${natural}`);
    assert.equal(got.success, false, `natural ${natural}`);
    assert.deepEqual(got.outcome, OUTCOMES.easyClimb.botch, `natural ${natural}`);
  }
  assert.equal(read("easyClimb", 4, 4).botch, false, "a face above the band is a plain miss");
  assert.deepEqual(read("easyClimb", 4, 4).outcome, OUTCOMES.easyClimb.fail);
  assert.equal(read("easyClimb", 4, 20).success, true);
  // A face the band leaves out is an ordinary throw, whatever face it is.
  assert.equal(read("crawl", 5, 20).botch, true);
  assert.equal(read("crawl", 1, 1).botch, false);
  assert.equal(read("crawl", 1, 20).success, true);
  resetTables();
});

ok("with no band imported no natural result is a botch and the target alone decides", () => {
  load({ ...SPELUNKING, botchBand: undefined });
  const read = (natural, total) => readThrow({ plan: obstaclePlan({ kind: "easyClimb", proficient: true, classThrow: 8 }), natural, total });
  assert.equal(read(1, 20).success, true, "a face that would be in a band, with a total over the target, makes it");
  assert.equal(read(1, 1).botch, false);
  assert.deepEqual(read(1, 1).outcome, OUTCOMES.easyClimb.fail, "a miss reads the failed-throw row");
  resetTables();
});

ok("a band is a pair of whole numbers from 1 up, or it is not imported", () => {
  const band = (cell) => {
    load({ ...SPELUNKING, botchBand: { crawl: cell } });
    const got = botchBand("crawl");
    resetTables();
    return got;
  };
  assert.deepEqual(band({ min: 2, max: 4 }), { min: 2, max: 4 });
  assert.deepEqual(band({ min: "2", max: "2" }), { min: 2, max: 2 });
  for (const bad of [{ min: 4, max: 2 }, { min: 0, max: 2 }, { min: 1.5, max: 2 }, { min: "a", max: 2 }, { min: 1 }, 3, "1-3", null]) {
    assert.equal(band(bad), null, JSON.stringify(bad));
  }
});

// ---- the rate a climber moves at ---------------------------------------------
ok("the speeds a rate is a share of are the names the binding reads", () => {
  assert.deepEqual([...PROGRESS_SPEEDS].sort(), Object.keys(PROGRESS_SPEED_WORDS).sort());
});

ok("with nothing imported no rate is known, made throw or failed", () => {
  resetTables();
  for (const kind of OBSTACLE_KEYS) for (const which of ["success", "fail"]) assert.equal(progressRate(kind, which), null, `${kind} ${which}`);
  load({ ...SPELUNKING, progress: undefined });
  assert.equal(progressRate("easyClimb"), null);
  resetTables();
});

ok("a rate is the imported share of a named speed, for the success and the one slower fail", () => {
  load();
  assert.deepEqual(progressRate("easyClimb"), { share: 5 / 11, speed: "combat" });
  assert.deepEqual(progressRate("easyClimb", "success"), { share: 5 / 11, speed: "combat" });
  assert.deepEqual(progressRate("rappel", "success"), { share: 1, speed: "run" });
  assert.deepEqual(progressRate("rappel", "fail"), { share: 2 / 9, speed: "combat" });
  assert.equal(progressRate("easyClimb", "fail"), null, "an obstacle whose failed throw moves nothing has no slower rate");
  assert.equal(progressRate("crawl"), null, "an obstacle whose cell did not read has none");
  resetTables();
});

ok("a Judge's override counts only as a share above zero of a named speed", () => {
  const rate = (cell) => {
    load({ ...SPELUNKING, progress: { crawl: { success: cell } } });
    const got = progressRate("crawl");
    resetTables();
    return got;
  };
  assert.deepEqual(rate({ share: "0.381", speed: "run" }), { share: 0.381, speed: "run" });
  for (const bad of [{ share: 0, speed: "run" }, { share: -1, speed: "run" }, { share: "", speed: "run" }, { share: "x", speed: "run" },
    { share: 3 / 7, speed: "walk" }, { share: 3 / 7 }, { speed: "run" }, 3 / 7, "run", null]) {
    assert.equal(rate(bad), null, JSON.stringify(bad));
  }
});

ok("a fixed rope reads the easy climb's outcomes", () => {
  load();
  const read = readThrow({ plan: obstaclePlan({ kind: "sheerClimb", ropeFixed: true }), natural: 4, total: 4 });
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

ok("`advances` is read only as a boolean, and left off otherwise", () => {
  load(SPELUNKING, {
    easyClimb: { fail: { text: "Inch along", advances: true }, botch: { text: "Stay put", advances: false } },
    sheerClimb: { fail: { text: "Wait a moment", advances: "yes" }, botch: { text: "Wait a moment", advances: 1 } },
  });
  assert.deepEqual(obstacleOutcome("easyClimb", "fail"), { text: "Inch along", falls: false, advances: true });
  assert.deepEqual(obstacleOutcome("easyClimb", "botch"), { text: "Stay put", falls: false, advances: false });
  assert.equal("advances" in obstacleOutcome("sheerClimb", "fail"), false);
  assert.equal("advances" in obstacleOutcome("sheerClimb", "botch"), false);
  resetTables();
});

ok("`rounds` is passed only as a positive whole number, typed text included, and left off otherwise", () => {
  load(SPELUNKING, {
    easyClimb: { fail: { text: "Wait", rounds: 3 }, botch: { text: "Wait", advances: false, rounds: 1 } },
    sheerClimb: { fail: { text: "Wait", rounds: "3" }, botch: { text: "Wait", rounds: 2.5 } },
    rappel: { fail: { text: "Wait", rounds: 0 }, botch: { text: "Wait", rounds: -2 } },
    crawl: { fail: { text: "Wait", rounds: null }, botch: { text: "Wait", rounds: true } },
    narrowLedge: { fail: { text: "Wait", rounds: "" }, botch: { text: "Wait", rounds: "2.5" } },
    precariousLedge: { fail: { text: "Wait", rounds: "soon" }, botch: { text: "Wait", rounds: "0" } },
  });
  assert.deepEqual(obstacleOutcome("easyClimb", "fail"), { text: "Wait", falls: false, rounds: 3 });
  assert.deepEqual(obstacleOutcome("easyClimb", "botch"), { text: "Wait", falls: false, advances: false, rounds: 1 });
  assert.equal(obstacleOutcome("sheerClimb", "fail").rounds, 3, "a number typed as text is the number");
  for (const [kind, which] of [["sheerClimb", "botch"], ["rappel", "fail"], ["rappel", "botch"], ["crawl", "fail"], ["crawl", "botch"], ["narrowLedge", "fail"], ["narrowLedge", "botch"], ["precariousLedge", "fail"], ["precariousLedge", "botch"]]) {
    assert.equal("rounds" in obstacleOutcome(kind, which), false, `${kind} ${which}`);
  }
  resetTables();
});

ok("an outcome with no `rounds` carries none: nothing is read from the cell's words", () => {
  load(SPELUNKING, { easyClimb: { fail: { text: "Wait for 3 rounds", falls: false } } });
  assert.equal("rounds" in obstacleOutcome("easyClimb", "fail"), false);
  resetTables();
});

// ---- where a throw leaves a member ------------------------------------------
const made = { ok: true, success: true, outcome: "progress" };
const missed = (outcome) => ({ ok: true, success: false, outcome });
const WAIT = { text: "Wait a moment", falls: false };
const INCH = { text: "Inch along", falls: false, advances: true };
const STOP = { text: "Stay put", falls: false, advances: false };
const SLIP = { text: "Slip and fall", falls: true };

ok("a made stretch is covered, and the last one is across", () => {
  assert.deepEqual(obstacleStep({ covered: 0, stretches: 3, read: made }), { step: "covered", covered: 1 });
  assert.deepEqual(obstacleStep({ covered: 1, stretches: 3, read: made }), { step: "covered", covered: 2 });
  assert.deepEqual(obstacleStep({ covered: 2, stretches: 3, read: made }), { step: "across", covered: 3 });
  assert.deepEqual(obstacleStep({ stretches: 1, read: made }), { step: "across", covered: 1 }, "covered defaults to none");
});

ok("a miss whose outcome advances covers the stretch like a make", () => {
  assert.deepEqual(obstacleStep({ covered: 0, stretches: 2, read: missed(INCH) }), { step: "covered", covered: 1 });
  assert.deepEqual(obstacleStep({ covered: 1, stretches: 2, read: missed(INCH) }), { step: "across", covered: 2 });
});

ok("a miss that does not advance stalls, with no stretch gained", () => {
  assert.deepEqual(obstacleStep({ covered: 1, stretches: 3, read: missed(STOP) }), { step: "stalled", covered: 1 });
});

ok("a miss whose outcome has no `advances`, or none imported, stalls", () => {
  assert.deepEqual(obstacleStep({ covered: 0, stretches: 2, read: missed(WAIT) }), { step: "stalled", covered: 0 });
  assert.deepEqual(obstacleStep({ covered: 0, stretches: 2, read: missed(null) }), { step: "stalled", covered: 0 });
  assert.equal(obstacleStep({ covered: 0, stretches: 2, read: missed({ ...WAIT, advances: "true" }) }).step, "stalled",
    "only the boolean counts");
});

ok("a fall ends the attempt whatever `advances` says, and gains no stretch", () => {
  assert.deepEqual(obstacleStep({ covered: 1, stretches: 3, read: missed(SLIP) }), { step: "fell", covered: 1 });
  assert.equal(obstacleStep({ covered: 0, stretches: 2, read: missed({ ...SLIP, advances: true }) }).step, "fell");
});

ok("a plan with nothing to throw against, or a bad count, stalls rather than gaining ground", () => {
  assert.deepEqual(obstacleStep({ covered: 0, stretches: 2, read: { ok: false, outcome: null } }), { step: "stalled", covered: 0 });
  assert.deepEqual(obstacleStep({ stretches: 2 }), { step: "stalled", covered: 0 });
  assert.deepEqual(obstacleStep({ covered: -3, stretches: 2, read: made }), { step: "covered", covered: 1 });
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

ok("helplessness is the imported row, read per obstacle", () => {
  load();
  for (const kind of OBSTACLE_KEYS) assert.equal(obstacleVulnerable(kind), SPELUNKING.vulnerable[kind], kind);
  assert.equal(obstaclePlan({ kind: "crawl", proficient: true, classThrow: 5 }).obstacle.vulnerable, undefined, "the obstacle holds none");
  resetTables();
});

ok("a throw carries the obstacle's imported helplessness, and null while not imported", () => {
  load();
  const read = (kind, natural, total, ropeFixed = false) =>
    readThrow({ plan: obstaclePlan({ kind, proficient: true, classThrow: 8, ropeFixed }), natural, total });
  assert.equal(read("easyClimb", 10, 10).vulnerable, true, "a made throw");
  assert.equal(read("easyClimb", 4, 4).vulnerable, true, "a miss");
  assert.equal(read("sheerClimb", 10, 10).vulnerable, false);
  assert.equal(read("sheerClimb", 10, 10, true).vulnerable, true, "a fixed rope reads the easy climb's row");
  resetTables();
  assert.equal(read("easyClimb", 10, 10).vulnerable, null, "nothing imported");
  assert.equal(read("easyClimb", 4, 4).vulnerable, null, "nothing imported, a miss");
});

ok("a helplessness that is no boolean reads as not imported", () => {
  load({ ...SPELUNKING, vulnerable: { easyClimb: "yes", sheerClimb: 1, rappel: null, crawl: true } });
  assert.deepEqual(OBSTACLE_KEYS.map(obstacleVulnerable), [null, null, null, true, null, null]);
  resetTables();
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
  // Two stretches each. Ayla's 4 and 2 miss the target of 6, and the easy
  // climb's outcome still covers ground, so both stretches are thrown; Brun's
  // two 15s make it.
  assert.deepEqual(world.rolled, ["1d20", "1d20", "1d20", "1d20"]);
  assert.equal(results[0].attempts.length, 2);
  assert.equal(results[0].attempts.every((a) => a.success === false), true);
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["covered", "across"]);
  assert.equal(results[0].across, true);
  assert.equal(results[0].covered, 2);
  assert.equal(results[1].attempts.every((a) => a.success === true), true);
  assert.deepEqual(results[1].attempts.map((a) => a.step), ["covered", "across"]);
  resetTables();
});

await okAsync("a miss that does not advance stalls the member: the next stretch is not thrown, and a make never comes", async () => {
  load();
  const world = mockWorld([5, 15]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" }, proficient: true, classThrow: 9 }],
    { kind: "sheerClimb", feet: 80 });
  assert.equal(world.rolled.length, 1, "the sheer face's miss says nothing of ground covered");
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["stalled"]);
  assert.equal(results[0].covered, 0);
  assert.equal(results[0].across, false);
  assert.match(world.posted[0].content, /obstacles\.covered\{"covered":0,"stretches":2\}/, "the card says how far the member got");
  resetTables();
});

await okAsync("a miss whose outcome has no `advances` key ends the attempt", async () => {
  load(SPELUNKING, { crawl: { fail: { text: "Wait a moment", falls: false } } });
  const world = mockWorld([2, 15]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" } }], { kind: "crawl", feet: 80 });
  assert.equal(world.rolled.length, 1);
  assert.equal(results[0].attempts[0].step, "stalled");
  assert.equal(results[0].across, false);
  resetTables();
});

await okAsync("a stretch made before a stall stays covered, and a miss that advances covers its own", async () => {
  load();
  let world = mockWorld([15, 5, 15]);
  let results = await attemptObstacle([{ actor: { name: "Ayla" }, proficient: true, classThrow: 9 }],
    { kind: "sheerClimb", feet: 120 });
  assert.equal(world.rolled.length, 2, "made, then missed with nothing gained: stalled before the third");
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["covered", "stalled"]);
  assert.equal(results[0].covered, 1);
  world = mockWorld([4, 15]);
  results = await attemptObstacle([{ actor: { name: "Brun" } }], { kind: "easyClimb", feet: 80 });
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["covered", "across"], "a miss that advances, then a make");
  assert.equal(results[0].covered, 2);
  resetTables();
});

await okAsync("a fall ends the attempt as fell, with the stretch uncovered", async () => {
  load();
  const world = mockWorld([15, 1, 15]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" }, proficient: true, classThrow: 9 }],
    { kind: "sheerClimb", feet: 120 });
  assert.equal(world.rolled.length, 2);
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["covered", "fell"]);
  assert.equal(results[0].covered, 1);
  assert.equal(results[0].across, false);
  resetTables();
});

await okAsync("a one-stretch face made is across, and its card carries no count", async () => {
  load();
  const world = mockWorld([15]);
  const results = await attemptObstacle([{ actor: { name: "Ayla" }, proficient: true, classThrow: 9 }],
    { kind: "sheerClimb", feet: 40 });
  assert.deepEqual(results[0].attempts.map((a) => a.step), ["across"]);
  assert.equal(results[0].across, true);
  assert.doesNotMatch(world.posted[0].content, /obstacles\.covered/);
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
