/**
 * The Spelunking table (RR ch. 6): who may try, and what failing costs.
 */
import assert from "node:assert/strict";
import { obstaclePlan, readThrow, throwsFor, OUTCOME, OBSTACLES } from "../scripts/formation/obstacles.mjs";

/* --- who may attempt what ----------------------------------------------- */
assert.equal(obstaclePlan({ kind: "easyClimb" }).target, 8, "any adventurer climbs a rope at 8+");
assert.equal(obstaclePlan({ kind: "crawl" }).target, 8);
assert.equal(obstaclePlan({ kind: "narrowLedge" }).target, 8);

for (const kind of ["sheerClimb", "rappel", "precariousLedge"]) {
  const p = obstaclePlan({ kind });
  assert.equal(p.permitted, false, `${kind} is not permitted on Adventuring alone`);
  assert.equal(p.reason, "notPermitted");
}

/* --- a proficient climber throws against their class value -------------- */
let p = obstaclePlan({ kind: "sheerClimb", proficient: true, classThrow: 6 });
assert.equal(p.permitted, true);
assert.equal(p.target, 6);
/* ...and without one recorded, we say so rather than invent a number */
p = obstaclePlan({ kind: "sheerClimb", proficient: true });
assert.equal(p.permitted, true);
assert.equal(p.target, null);
assert.equal(p.reason, "needsClassThrow");

/* --- a fixed rope turns a sheer face into an easy climb ------------------ */
p = obstaclePlan({ kind: "sheerClimb", assisted: true });
assert.equal(p.permitted, true, "the party sent a climber up first");
assert.equal(p.target, 8);
assert.equal(p.effective, "easyClimb");
/* but nobody can rope a ledge for you */
assert.equal(obstaclePlan({ kind: "precariousLedge", assisted: true }).permitted, false);

/* --- what failure costs, which is the point of the table ---------------- */
const at = (kind, natural, total) => readThrow({ plan: obstaclePlan({ kind, proficient: false }), natural, total });

/* the gentle obstacles cost a round */
assert.equal(at("easyClimb", 5, 5).outcome, OUTCOME.noProgress);
assert.equal(at("crawl", 5, 5).outcome, OUTCOME.noProgress);
/* the hard ones drop you */
assert.equal(readThrow({ plan: obstaclePlan({ kind: "sheerClimb", proficient: true, classThrow: 10 }), natural: 4, total: 4 }).outcome,
  OUTCOME.fallUnlessGeared, "failing a sheer climb is a fall unless geared");
assert.equal(readThrow({ plan: obstaclePlan({ kind: "precariousLedge", proficient: true, classThrow: 10 }), natural: 4, total: 4 }).outcome,
  OUTCOME.fallUnlessBurglar);

/* a natural 1 is its own row */
assert.equal(at("easyClimb", 1, 1).outcome, OUTCOME.fallUnlessGeared, "a botch on an easy climb still drops you");
assert.equal(at("narrowLedge", 1, 1).outcome, OUTCOME.fallUnlessBurglar);
assert.equal(readThrow({ plan: obstaclePlan({ kind: "sheerClimb", proficient: true, classThrow: 10 }), natural: 1, total: 1 }).outcome,
  OUTCOME.fall, "and on a sheer face it is simply a fall");

/* a rappel that fails merely slows down — the one forgiving hard obstacle */
assert.equal(readThrow({ plan: obstaclePlan({ kind: "rappel", proficient: true, classThrow: 10 }), natural: 5, total: 5 }).outcome,
  OUTCOME.slowDescent);

/* success is success */
assert.equal(at("easyClimb", 15, 15).success, true);
assert.equal(at("easyClimb", 15, 15).outcome, "progress");

/* --- vulnerability: everything but an easy climb ------------------------ */
assert.equal(OBSTACLES.easyClimb.vulnerable, false, "an easy climb is the only safe one");
for (const k of ["sheerClimb", "rappel", "crawl", "narrowLedge", "precariousLedge"]) {
  assert.equal(OBSTACLES[k].vulnerable, true, `${k} leaves you helpless`);
}

/* --- one throw per hundred feet ----------------------------------------- */
assert.equal(throwsFor(0), 1, "even a short obstacle is one throw");
assert.equal(throwsFor(100), 1);
assert.equal(throwsFor(101), 2);
assert.equal(throwsFor(250), 3);

console.log("test-obstacles: OK (permission, assistance, failure costs, botches, vulnerability, distance)");
