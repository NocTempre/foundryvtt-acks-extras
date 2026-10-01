/**
 * Conditions: the catalogue and the math it performs.
 *
 * Every figure below is INVENTED — the real sizes are printed and arrive
 * through the importer. What this pins is the structure: which conditions
 * exist and what each carries with it, that a creature has a condition once
 * however many effects name it, whose roll each row lands on, that a
 * defender's condition reaches its attacker's throw, and that an unimported
 * world applies nothing rather than an invented figure.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import {
  ACTS, ATTACK_KINDS, CONDITIONS, CONDITIONS_DOC, CONDITIONS_TABLE, CONDITION_IDS, CONDITION_SLOTS, STACKS_FLAG,
  acMath, attackMath, conditionSet, conditionValues, conditionsReady, endingAt, forbiddenBy, rollMath, speedMath,
  subjectOf,
} from "../scripts/lib/conditions.mjs";
import { CONDITION_KEYS } from "../scripts/lib/vocab.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/** Invented sizes, one row per priced condition. */
const VALUES = {
  berserk: { attack: 7, ac: -6 },
  blessed: { all: 3 },
  blinded: { surprise: -5, attack: -9, proficiency: -8, speedFactor: 0.4 },
  charging: { attack: 6 },
  clambering: { attack: -3, against: 5 },
  deafened: { surprise: -2, proficiency: -7 },
  disordered: { ac: -3 },
  enlarged: { attack: 4 },
  faltering: { all: -6 },
  fatigued: { all: -2 },
  flanked: { against: 4 },
  hidden: { against: -8 },
  hungry: { all: -3 },
  incapacitated: { speedFactor: 0.7 },
  infuriated: { attack: 5, ac: -4 },
  inspired: { all: 2 },
  prone: { attack: -7 },
  queasy: { all: -4 },
  restrained: { perCause: -5 },
  shaken: { all: -2 },
  shrunk: { attack: -3, damageFactor: 0.25 },
  subjacent: { against: 2 },
  vulnerable: { against: 9 },
  webbed: { perCause: -4 },
};
const DOC = { id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: VALUES } };

const who = (statuses, extra = {}) => ({ statuses, ...extra });
const attack = (attacker, target = null, kind = "melee", extra = {}) =>
  attackMath({ attacker: who(attacker), target: target && who(target), kind, values: VALUES, ...extra });
const termOf = (math, condition) => math.terms.find((t) => t.condition === condition);

/* --- the catalogue --------------------------------------------------------- */

ok("the catalogue is internally consistent", () => {
  assert.equal(CONDITION_IDS.length, 61);
  for (const [key, c] of Object.entries(CONDITIONS)) {
    for (const other of [...(c.implies ?? []), ...(c.shuts ?? []), ...(c.exposes ? [c.exposes] : [])]) {
      assert.ok(CONDITIONS[other], `${key} names ${other}`);
    }
    for (const act of c.forbids ?? []) assert.ok(ACTS.includes(act), `${key} forbids ${act}`);
    for (const kind of [...(c.shields ?? []), ...(c.autoHit ?? [])]) assert.ok(ATTACK_KINDS.includes(kind), `${key}: ${kind}`);
    for (const mod of c.mods ?? []) {
      for (const kind of mod.scope ?? []) assert.ok(ATTACK_KINDS.includes(kind), `${key}: ${kind}`);
      if (mod.unless) assert.ok(CONDITIONS[mod.unless], `${key} unless ${mod.unless}`);
    }
    if (c.ends) assert.ok(["turn", "combat"].includes(c.ends), `${key} ends ${c.ends}`);
  }
});

ok("every condition has its own icon and a name in lang, and lang names nothing else", () => {
  const icons = CONDITION_IDS.map((key) => CONDITIONS[key].img);
  assert.equal(new Set(icons).size, icons.length);
  for (const key of CONDITION_IDS) assert.equal(lang[`ACKS-LIB.condition.${key}`], CONDITIONS[key].label, key);
  const named = Object.keys(lang).filter((k) => k.startsWith("ACKS-LIB.condition.")).map((k) => k.slice("ACKS-LIB.condition.".length));
  assert.deepEqual(named.sort(), [...CONDITION_IDS].sort());
});

ok("every circumstance a row waits on, and every roll it reaches, has its words", () => {
  const whens = new Set(["source"]);
  for (const c of Object.values(CONDITIONS)) for (const mod of c.mods ?? []) if (mod.when) whens.add(mod.when);
  for (const when of whens) assert.ok(lang[`ACKS-LIB.conditionRoll.when.${when}`], when);
  for (const roll of ["attack", "damage", "save", "throw", "morale"]) {
    assert.ok(lang[`ACKS-LIB.conditionRoll.roll.${roll}`], roll);
  }
  assert.ok(lang["ACKS-LIB.conditionRoll.notice.surprise"]);
});

ok("the slots are derived from the rows, so the importer is asked for exactly what is read", () => {
  for (const [key, slots] of Object.entries(CONDITION_SLOTS)) {
    assert.deepEqual([...slots], [...new Set(CONDITIONS[key].mods.map((m) => m.slot))]);
  }
  assert.deepEqual(Object.keys(CONDITION_SLOTS).sort(), Object.keys(VALUES).sort());
  for (const key of Object.keys(VALUES)) assert.deepEqual(Object.keys(VALUES[key]).sort(), [...CONDITION_SLOTS[key]].sort(), key);
});

ok("an ability's condition choices are the catalogue, with the stored legacy keys kept", () => {
  for (const key of CONDITION_IDS) assert.equal(CONDITION_KEYS[key].label, CONDITIONS[key].label);
  for (const key of ["fear", "sleep", "paralysis"]) assert.ok(CONDITION_KEYS[key], key);
});

/* --- what a creature has --------------------------------------------------- */

ok("a condition brings what it implies, and ids that name no condition are dropped", () => {
  assert.deepEqual([...conditionSet(["paralyzed", "bogus"])].sort(), ["helpless", "mute", "paralyzed", "vulnerable"]);
  assert.deepEqual([...conditionSet(["slumbering"])].sort(), ["blinded", "deafened", "helpless", "mute", "slumbering", "vulnerable"]);
  assert.deepEqual([...conditionSet(null)], []);
});

ok("a condition shuts another out, and takes what that one implied with it", () => {
  const set = conditionSet(["berserk", "cowering", "frightened"]);
  assert.deepEqual([...set], ["berserk"]);
  // Cowering alone is what made it vulnerable; with cowering shut out it is not.
  assert.equal(set.has("vulnerable"), false);
  assert.equal(conditionSet(["cowering"]).has("vulnerable"), true);
});

ok("what a condition takes away is read off the closed set", () => {
  assert.deepEqual(forbiddenBy(conditionSet(["paralyzed"]), "attack").sort(), ["helpless"]);
  assert.deepEqual(forbiddenBy(conditionSet(["mute"]), "cast"), ["mute"]);
  assert.deepEqual(forbiddenBy(conditionSet(["mute"]), "attack"), []);
});

/* --- an unimported world ---------------------------------------------------- */

ok("with nothing imported no figure is applied, and the condition is named as unpriced", () => {
  assert.equal(conditionsReady(), false);
  assert.deepEqual(conditionValues(), {});
  const math = attackMath({ attacker: who(["blinded"]), target: who(["prone"]), kind: "melee" });
  assert.deepEqual(math.terms, []);
  assert.deepEqual(math.unpriced.sort(), ["blinded", "vulnerable"]);
  // What a condition forbids is structure, and holds unimported.
  assert.deepEqual(attackMath({ attacker: who(["blinded"]), kind: "missile" }).forbidden, ["blinded"]);
  assert.equal(rollMath("save", who(["hungry"])).total, 0);
  assert.equal(speedMath(who(["blinded"])).factor, 1);
});

ok("the registered document is where the figures are read from", () => {
  registerTable(DOC, { priority: PRIORITY.WORLD, source: "test" });
  try {
    assert.equal(conditionsReady(), true);
    assert.equal(attackMath({ attacker: who(["prone"]), kind: "melee" }).terms[0].value, -7);
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
  assert.equal(conditionsReady(), false);
});

/* --- the attack throw: the one making it ------------------------------------ */

ok("the attacker's own conditions are terms on its throw, each named", () => {
  const math = attack(["prone", "hungry"]);
  // Catalogue order, whatever order the statuses arrived in.
  assert.deepEqual(math.terms, [
    { condition: "hungry", value: -3, side: "own" },
    { condition: "prone", value: -7, side: "own" },
  ]);
});

ok("a row reaches only the kinds of attack it names", () => {
  assert.equal(termOf(attack(["berserk"], null, "melee"), "berserk").value, 7);
  assert.equal(termOf(attack(["berserk"], null, "thrown"), "berserk").value, 7);
  assert.equal(termOf(attack(["berserk"], null, "missile"), "berserk"), undefined);
  assert.equal(termOf(attack(["blinded"], null, "melee"), "blinded").value, -9);
  const shot = attack(["blinded"], null, "missile");
  assert.equal(termOf(shot, "blinded"), undefined);
  assert.deepEqual(shot.forbidden, ["blinded"]);
});

ok("two effects naming one condition count once; a counted condition counts its causes", () => {
  assert.equal(attack(["prone", "prone"]).terms.length, 1);
  const tired = (n) => attackMath({ attacker: who(["fatigued"], { counts: { fatigued: n } }), kind: "melee", values: VALUES });
  assert.equal(termOf(tired(1), "fatigued").value, -2);
  assert.equal(termOf(tired(3), "fatigued").value, -6);
  assert.deepEqual(tired(3).damage, [{ condition: "fatigued", value: -6 }]);
  // The first cause of a restraint costs the throw nothing; each further one does.
  const bound = (n) => attackMath({ attacker: who(["restrained"], { counts: { restrained: n } }), kind: "melee", values: VALUES });
  assert.equal(termOf(bound(1), "restrained"), undefined);
  assert.equal(termOf(bound(3), "restrained").value, -10);
});

ok("damage rows and the damage factor ride beside the throw", () => {
  assert.deepEqual(attack(["queasy"]).damage, [{ condition: "queasy", value: -4 }]);
  const small = attack(["shrunk"]);
  assert.equal(small.damageFactor, 0.25);
  assert.deepEqual(small.damageFactorBy, ["shrunk"]);
  assert.equal(attack(["prone"]).damageFactor, 1);
});

/* --- the attack throw: the one it is made against ---------------------------- */

ok("the target's condition is a term on the attacker's throw, marked as the target's", () => {
  const math = attack([], ["vulnerable"]);
  assert.deepEqual(math.terms, [{ condition: "vulnerable", value: 9, side: "target" }]);
});

ok("a condition the target has by implication reaches the attacker the same way", () => {
  const math = attack([], ["prone"]);
  assert.deepEqual(math.terms, [{ condition: "vulnerable", value: 9, side: "target" }]);
  // Prone's own attack row is the prone creature's, never its attacker's.
  assert.equal(termOf(math, "prone"), undefined);
});

ok("the target's own Armor Class row arrives sign-reversed on the attacker's throw", () => {
  assert.deepEqual(attack([], ["disordered"]).terms, [{ condition: "disordered", value: 3, side: "target" }]);
  assert.equal(acMath(who(["disordered"]), VALUES).total, -3);
  // A blessing raises the target's AC, so the attacker's throw falls by it.
  assert.equal(termOf(attack([], ["blessed"]), "blessed").value, -3);
});

ok("both sides stack on one throw", () => {
  const math = attack(["charging"], ["flanked", "disordered"]);
  assert.equal(math.terms.reduce((sum, t) => sum + t.value, 0), 6 + 4 + 3);
});

ok("a superseded row stands down", () => {
  assert.equal(termOf(attack([], ["flanked"]), "flanked").value, 4);
  const both = attack([], ["flanked", "prone"]);
  assert.equal(termOf(both, "flanked"), undefined);
  assert.equal(termOf(both, "vulnerable").value, 9);
});

ok("a hidden target shrugs off what cannot be aimed, and is harder to strike", () => {
  assert.deepEqual(attack([], ["hidden"], "missile").shielded, ["hidden"]);
  assert.deepEqual(attack([], ["hidden"], "thrown").shielded, ["hidden"]);
  const blow = attack([], ["hidden"], "melee");
  assert.deepEqual(blow.shielded, []);
  assert.equal(termOf(blow, "hidden").value, -8);
});

ok("a helpless target needs no throw from an attacker its size or larger, in melee", () => {
  assert.equal(attack([], ["paralyzed"], "melee", { attackerSize: 2, targetSize: 2 }).autoHit, "helpless");
  assert.equal(attack([], ["paralyzed"], "melee", { attackerSize: 1, targetSize: 2 }).autoHit, null);
  assert.equal(attack([], ["paralyzed"], "missile", { attackerSize: 2, targetSize: 2 }).autoHit, null);
  // Sizes unknown: the throw is made.
  assert.equal(attack([], ["paralyzed"], "melee").autoHit, null);
});

ok("a condition the attacker carries can expose its target", () => {
  const math = attack(["clambering"], []);
  assert.equal(termOf(math, "vulnerable").value, 9);
  assert.equal(termOf(math, "clambering").value, -3);
});

ok("a row bound to what imposed the condition reaches that opponent and no other", () => {
  const climber = who(["clambering"], { sources: { clambering: ["Actor.giant"] }, id: "Actor.climber" });
  const vs = (id) => attackMath({ attacker: climber, target: who([], { id }), kind: "melee", values: VALUES });
  assert.equal(termOf(vs("Actor.giant"), "clambering").value, -3);
  assert.equal(termOf(vs("Actor.giant"), "vulnerable").value, 9);
  assert.equal(termOf(vs("Actor.other"), "clambering"), undefined);
  assert.equal(termOf(vs("Actor.other"), "vulnerable"), undefined);
  // A document the opponent holds is the opponent.
  const held = who(["clambering"], { sources: { clambering: ["Actor.giant.Item.grip"] }, id: "Actor.climber" });
  assert.equal(termOf(attackMath({ attacker: held, target: who([], { id: "Actor.giant" }), kind: "melee", values: VALUES }), "clambering").value, -3);
  // A condition toggled by hand names nobody, and applies.
  assert.equal(termOf(attack(["clambering"], []), "clambering").value, -3);
});

/* --- the creature's own rolls ------------------------------------------------ */

ok("a save takes the rows that reach every save, and holds back the ones that wait on a circumstance", () => {
  const math = rollMath("save", who(["hungry", "blessed"]), VALUES);
  assert.equal(math.total, -3);
  assert.deepEqual(math.parts, [{ condition: "hungry", value: -3 }]);
  assert.deepEqual(math.pending, [{ condition: "blessed", value: 3, when: "fear" }]);
});

ok("a throw, a morale roll and a surprise roll each read their own rows", () => {
  assert.equal(rollMath("throw", who(["queasy", "hungry"]), VALUES).total, -7);
  assert.equal(rollMath("morale", who(["inspired", "shaken"]), VALUES).total, 0);
  assert.equal(rollMath("surprise", who(["blinded", "deafened"]), VALUES).total, -7);
  assert.equal(rollMath("surprise", who(["slumbering"]), VALUES).total, -7);
  assert.deepEqual(rollMath("throw", who(["deafened"]), VALUES).pending, [{ condition: "deafened", value: -7, when: "voice" }]);
});

ok("a creature that never checks morale is named as exempt", () => {
  assert.deepEqual(rollMath("morale", who(["berserk"]), VALUES).exempt, ["berserk"]);
  assert.deepEqual(rollMath("morale", who(["prone"]), VALUES).exempt, []);
  assert.deepEqual(rollMath("save", who(["berserk"]), VALUES).exempt, []);
});

ok("a row bound to its source waits when the roll names no opponent", () => {
  const math = rollMath("save", who(["faltering"]), VALUES);
  assert.equal(math.total, 0);
  assert.deepEqual(math.pending, [{ condition: "faltering", value: -6, when: "source" }]);
});

ok("several slowing conditions do not compound: the slowest governs", () => {
  assert.equal(speedMath(who(["incapacitated"]), VALUES).factor, 0.7);
  assert.equal(speedMath(who(["incapacitated", "blinded"]), VALUES).factor, 0.4);
  assert.equal(speedMath(who(["prone"]), VALUES).factor, 1);
});

/* --- the tracker and the actor ----------------------------------------------- */

ok("the tracker lifts what ends, by the ids actually on the creature", () => {
  assert.deepEqual(endingAt(["charging", "prone", "disordered"], "turn"), ["charging", "disordered"]);
  assert.deepEqual(endingAt(["berserk", "charging"], "combat"), ["berserk"]);
  assert.deepEqual(endingAt(null, "turn"), []);
});

ok("an actor is read as its statuses, its causes and their sources", () => {
  const effect = (statuses, extra = {}) => ({ statuses: new Set(statuses), ...extra });
  const actor = {
    uuid: "Actor.a",
    statuses: new Set(["fatigued", "webbed", "prone"]),
    appliedEffects: [
      effect(["fatigued"]),
      effect(["fatigued"], { flags: { "acks-extras": { [STACKS_FLAG]: 2 } } }),
      effect(["webbed"], { origin: "Actor.spider" }),
      effect(["prone"], { disabled: true }),
      effect(["some-other-status"]),
    ],
  };
  const subject = subjectOf(actor);
  assert.deepEqual(subject.counts, { fatigued: 3, webbed: 1 });
  assert.deepEqual(subject.sources, { webbed: ["Actor.spider"] });
  assert.equal(subject.id, "Actor.a");
  assert.equal(subjectOf(null), null);
  assert.equal(termOf(attackMath({ attacker: subject, kind: "melee", values: VALUES }), "fatigued").value, -6);
});

console.log(`\n${passed} condition checks passed.`);
