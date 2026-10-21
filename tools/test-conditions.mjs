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
  ACTS, ATTACK_KINDS, CONDITIONS, CONDITIONS_DOC, CONDITIONS_TABLE, CONDITION_IDS, CONDITION_SLOTS, LOSSES, SAVE_KINDS,
  STACKS_FLAG, acMath, attackMath, conditionSet, conditionValues, conditionsReady, endingAt, endingAtTurn, forbiddenBy,
  giverOf, lostTo, rollMath, speedMath, subjectOf,
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
  countercharging: { attack: 5 },
  covered: { against: -3, blast: 3 },
  coveredGreater: { against: -7, blast: 6 },
  deafened: { surprise: -2, proficiency: -7 },
  defending: { melee: 5 },
  defendingShield: { thrown: 3, missile: 8, blast: 4 },
  disordered: { ac: -3 },
  enlarged: { attack: 4 },
  faltering: { all: -6 },
  fatigued: { all: -2 },
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
  assert.equal(CONDITION_IDS.length, 73);
  for (const mark of ["diseased", "frostbitten"]) {
    assert.ok(CONDITIONS[mark], mark);
    assert.deepEqual([CONDITIONS[mark].mods, CONDITIONS[mark].forbids, CONDITIONS[mark].implies], [undefined, undefined, undefined], mark);
  }
  for (const [key, c] of Object.entries(CONDITIONS)) {
    for (const other of [...(c.implies ?? []), ...(c.shuts ?? []), ...(c.exposes ? [c.exposes] : [])]) {
      assert.ok(CONDITIONS[other], `${key} names ${other}`);
    }
    for (const act of c.forbids ?? []) assert.ok(ACTS.includes(act), `${key} forbids ${act}`);
    for (const kind of [...(c.shields ?? []), ...(c.autoHit ?? [])]) assert.ok(ATTACK_KINDS.includes(kind), `${key}: ${kind}`);
    for (const mod of c.mods ?? []) {
      for (const kind of mod.scope ?? []) assert.ok(ATTACK_KINDS.includes(kind), `${key}: ${kind}`);
      // Only a roll that states a kind can meet a scope, and only a save can meet `saves`.
      if (mod.scope) assert.ok(["attack", "ac"].includes(mod.on), `${key}: a scope on ${mod.on}`);
      if (mod.saves) assert.equal(mod.on, "save", `${key}: saves on ${mod.on}`);
      for (const save of mod.saves ?? []) assert.ok(SAVE_KINDS.includes(save), `${key}: ${save}`);
      if (mod.unless) assert.ok(CONDITIONS[mod.unless], `${key} unless ${mod.unless}`);
    }
    if (c.ends) assert.ok(["turn", "combat"].includes(c.ends), `${key} ends ${c.ends}`);
    for (const cause of c.lost ?? []) assert.ok(LOSSES.includes(cause), `${key} lost to ${cause}`);
    // A giver's turn is the only end a given state has.
    if (c.given) assert.equal(c.ends, "turn", `${key} is given and ends ${c.ends}`);
  }
  for (const cause of LOSSES) assert.ok(lang[`ACKS-LIB.conditionRoll.lost.${cause}`], `words for ${cause}`);
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
  const math = attack(["charging"], ["clambering", "disordered"]);
  assert.equal(math.terms.reduce((sum, t) => sum + t.value, 0), 6 + 5 + 3);
});

ok("a superseded row stands down", () => {
  assert.equal(termOf(attack([], ["covered"], "missile"), "covered").value, -3);
  const both = attack([], ["covered", "coveredGreater"], "missile");
  assert.equal(termOf(both, "covered"), undefined);
  assert.equal(termOf(both, "coveredGreater").value, -7);
});

ok("a flank and a subjacent target carry no row: the system's attack dialog prices both", () => {
  assert.deepEqual(attack([], ["flanked"]).terms, []);
  assert.deepEqual(attack([], ["subjacent"]).terms, []);
  assert.deepEqual(attack([], ["flanked", "subjacent"]).unpriced, []);
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

/* --- the states of a round ---------------------------------------------------- */

const sumOf = (math) => math.terms.reduce((sum, t) => sum + t.value, 0);
const saveOf = (statuses, save) => rollMath("save", who(statuses), VALUES, save ? { save } : undefined);

ok("a row on Armor Class stands against only the kinds of attack it names", () => {
  assert.deepEqual(attack([], ["defending"], "melee").terms, [{ condition: "defending", value: -5, side: "target" }]);
  assert.deepEqual(attack([], ["defending"], "missile").terms, []);
  assert.deepEqual(attack([], ["defending"], "thrown").terms, []);
  assert.equal(acMath(who(["defending"]), VALUES, { kind: "melee" }).total, 5);
  // With no kind stated, a row that names its kinds is left out, and one that names none is not.
  assert.equal(acMath(who(["defending", "disordered"]), VALUES).total, -3);
  assert.equal(acMath(who(["defending", "disordered"]), VALUES, { kind: "melee" }).total, 2);
});

ok("a shield adds to what defending gives, by the kind of attack", () => {
  assert.deepEqual([...conditionSet(["defendingShield"])].sort(), ["defending", "defendingShield"]);
  assert.equal(sumOf(attack([], ["defendingShield"], "melee")), -5);
  assert.equal(sumOf(attack([], ["defendingShield"], "thrown")), -3);
  assert.equal(sumOf(attack([], ["defendingShield"], "missile")), -8);
});

ok("a declared spell gives up what defending gave", () => {
  assert.deepEqual(attack([], ["defending", "casting"], "melee").terms, []);
  assert.deepEqual(attack([], ["defendingShield", "casting"], "missile").terms, []);
  assert.equal(saveOf(["defendingShield", "casting"], "blast").total, 0);
  // Casting alone has no figure, and is not named as unpriced for having none.
  assert.deepEqual(attackMath({ attacker: who(["casting"]), kind: "melee", values: {} }).unpriced, []);
});

ok("cover is against what is shot or thrown, and the greater cover supersedes the lesser", () => {
  assert.deepEqual(attack([], ["covered"], "missile").terms, [{ condition: "covered", value: -3, side: "target" }]);
  assert.equal(termOf(attack([], ["covered"], "thrown"), "covered").value, -3);
  assert.deepEqual(attack([], ["covered"], "melee").terms, []);
  assert.deepEqual(attack([], ["covered", "coveredGreater"], "missile").terms, [
    { condition: "coveredGreater", value: -7, side: "target" },
  ]);
  // Cover is the target's: the one behind it shoots out at no cost.
  assert.deepEqual(attack(["covered"], [], "missile").terms, []);
});

ok("a row on a saving throw reaches only the saves it names", () => {
  assert.equal(saveOf(["covered"], "blast").total, 3);
  assert.equal(saveOf(["covered"], "death").total, 0);
  // A roll that names no save takes no row that names its saves.
  assert.equal(saveOf(["covered"]).total, 0);
  assert.equal(saveOf(["covered", "coveredGreater"], "blast").total, 6);
  assert.equal(saveOf(["defendingShield"], "blast").total, 4);
  assert.equal(saveOf(["defending"], "blast").total, 0);
  // A row that names no save still reaches every one.
  assert.deepEqual(saveOf(["hungry", "covered"], "blast").parts, [
    { condition: "covered", value: 3 },
    { condition: "hungry", value: -3 },
  ]);
  assert.equal(saveOf(["hungry", "covered"], "spell").total, -3);
});

ok("a countercharge and a retreat leave their maker disordered, and a withdrawal does not", () => {
  assert.deepEqual([...conditionSet(["countercharging"])].sort(), ["countercharging", "disordered"]);
  assert.deepEqual([...conditionSet(["retreating"])].sort(), ["disordered", "retreating"]);
  assert.deepEqual([...conditionSet(["withdrawing"])], ["withdrawing"]);
  assert.equal(termOf(attack(["countercharging"], null, "melee"), "countercharging").value, 5);
  assert.deepEqual(attack([], ["retreating"]).terms, [{ condition: "disordered", value: 3, side: "target" }]);
});

/* --- the tracker and the actor ----------------------------------------------- */

ok("the tracker lifts what ends, by the ids actually on the creature", () => {
  assert.deepEqual(endingAt(["charging", "prone", "disordered"], "turn"), ["charging", "disordered"]);
  assert.deepEqual(endingAt(["berserk", "charging"], "combat"), ["berserk"]);
  assert.deepEqual(endingAt(null, "turn"), []);
});

ok("what a combatant declared or took up ends at its turn; cover and a held initiative stand", () => {
  const round = ["casting", "countercharging", "defending", "defendingShield", "readied", "retreating", "withdrawing"];
  assert.deepEqual(endingAt([...round, "covered", "coveredGreater", "delayed"], "turn").sort(), round);
});

ok("a state another combatant gave ends at the giver's turn, and the rest at their bearer's", () => {
  const on = ["defending", "readied", "covered"];
  assert.deepEqual(endingAtTurn(on, { self: "ally", acting: "ally" }), ["defending", "readied"]);
  assert.deepEqual(endingAtTurn(on, { self: "ally", acting: "ally", givers: { defending: "guard" } }), ["readied"]);
  assert.deepEqual(endingAtTurn(on, { self: "ally", acting: "guard", givers: { defending: "guard" } }), ["defending"]);
  assert.deepEqual(endingAtTurn(on, { self: "ally", acting: "other", givers: { defending: "guard" } }), []);
  // Only a state the catalogue marks as given follows a giver.
  assert.deepEqual(endingAtTurn(on, { self: "ally", acting: "guard", givers: { readied: "guard" } }), []);
  assert.deepEqual(endingAtTurn(["defendingShield"], { self: "ally", acting: "guard", givers: { defendingShield: "guard" } }), ["defendingShield"]);
});

ok("damage and a failed save cost a caster its spell and a readied creature its action; a move costs only the second", () => {
  const on = ["casting", "readied", "defending", "covered"];
  assert.deepEqual(lostTo(on, "damage"), ["casting", "readied"]);
  assert.deepEqual(lostTo(on, "save"), ["casting", "readied"]);
  assert.deepEqual(lostTo(on, "moved"), ["readied"]);
  assert.deepEqual(lostTo(null, "damage"), []);
  assert.deepEqual(CONDITION_IDS.filter((key) => CONDITIONS[key].lost), ["casting", "readied"]);
});

/** A fight as an effect's `start` points into it: combatants by id, each with its actor. */
function fight(members) {
  const combatants = new Map(Object.entries(members).map(([id, actor]) => [id, { id, actor }]));
  return { combatants };
}

ok("the giver of a state is whoever was acting when it was made, when that is another creature in the fight", () => {
  const guard = { uuid: "Actor.guard", statuses: new Set() };
  const ally = { uuid: "Actor.ally", statuses: new Set(["defending"]) };
  const combat = fight({ g: guard, a: ally });
  const made = (combatant, c = combat, initiative = 7) => ({ statuses: new Set(["defending"]), start: { combat: c, combatant, initiative } });
  assert.equal(giverOf(made("g"), ally)?.id, "g");
  assert.equal(giverOf(made("a"), ally), null, "made on its own turn, it is its own");
  assert.equal(giverOf(made("gone"), ally), null, "a giver no longer in the fight gives nothing");
  assert.equal(giverOf(made("g", null), ally), null, "made outside a fight");
  assert.equal(giverOf(made("g", combat, null), ally), null, "made before the round's initiative was rolled, nobody was acting");
  assert.equal(giverOf({ statuses: new Set(["defending"]) }, ally), null, "an effect with no start");
  assert.equal(giverOf(made("g"), null), null);
});

ok("a defence another gave stands while its bearer casts, and falls when its giver does", () => {
  const guard = { uuid: "Actor.guard", statuses: new Set() };
  const ally = { uuid: "Actor.ally", statuses: new Set(["defendingShield", "casting"]) };
  const combat = fight({ g: guard, a: ally });
  ally.appliedEffects = [
    { statuses: new Set(["defendingShield"]), start: { combat, combatant: "g", initiative: 7 } },
    { statuses: new Set(["casting"]), start: { combat, combatant: "a", initiative: 4 } },
  ];
  const melee = () => attackMath({ attacker: who([]), target: subjectOf(ally), kind: "melee", values: VALUES }).terms;
  const blast = () => rollMath("save", subjectOf(ally), VALUES, { save: "blast" }).total;
  assert.deepEqual(Object.keys(subjectOf(ally).gifts).sort(), ["defending", "defendingShield"], "the shield's defence came with it");
  assert.deepEqual(melee(), [{ condition: "defending", value: -5, side: "target" }], "the bearer's own spell does not lower it");
  assert.equal(blast(), 4);
  guard.statuses.add("casting");
  assert.deepEqual(melee(), [], "the giver's spell does");
  assert.equal(blast(), 0);
  // The same two statuses with nobody else acting are the creature's own, and its spell lowers them.
  ally.appliedEffects[0].start.combatant = "a";
  guard.statuses.clear();
  assert.deepEqual(subjectOf(ally).gifts, {});
  assert.deepEqual(melee(), []);
  // A defence of its own beside a given shield keeps its own reading.
  ally.statuses = new Set(["defending", "defendingShield"]);
  ally.appliedEffects = [
    { statuses: new Set(["defending"]), start: { combat, combatant: "a", initiative: 4 } },
    { statuses: new Set(["defendingShield"]), start: { combat, combatant: "g", initiative: 7 } },
  ];
  assert.deepEqual(Object.keys(subjectOf(ally).gifts), ["defendingShield"]);
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

/* --- stacks of one condition on an actor -------------------------------------- */

const { conditionStacksOf, setConditionStacks } = await import("../scripts/lib/status-effects.mjs");

/** An actor stub whose `toggleStatusEffect` makes and removes effects the way the palette does. */
function stackActor() {
  const effects = [];
  const calls = [];
  const actor = {
    effects,
    calls,
    async toggleStatusEffect(id, { active }) {
      calls.push([id, active]);
      const at = effects.findIndex((e) => e.statuses.has(id));
      if (active && at < 0) {
        const effect = {
          statuses: new Set([id]),
          flags: {},
          async setFlag(scope, key, value) {
            calls.push(["flag", scope, key, value]);
            (effect.flags[scope] ??= {})[key] = value;
          },
        };
        effects.push(effect);
      } else if (!active && at >= 0) effects.splice(at, 1);
    },
  };
  return actor;
}

await (async () => {
  const actor = stackActor();
  assert.equal(conditionStacksOf(actor, "fatigued"), 0, "no effect, no stacks");
  assert.equal(await setConditionStacks(actor, "fatigued", 3), 3);
  assert.deepEqual(actor.calls.filter((c) => c[0] !== "flag"), [["fatigued", true]], "switched on once");
  assert.equal(conditionStacksOf(actor, "fatigued"), 3, "and the effect records the count");
  assert.equal(actor.effects[0].flags["acks-extras"][STACKS_FLAG], 3);

  assert.equal(await setConditionStacks(actor, "fatigued", 5), 5);
  assert.equal(actor.effects.length, 1, "raising the count reuses the effect");
  assert.equal(conditionStacksOf(actor, "fatigued"), 5);
  const flagWrites = actor.calls.filter((c) => c[0] === "flag").length;
  assert.equal(await setConditionStacks(actor, "fatigued", 5), 5);
  assert.equal(actor.calls.filter((c) => c[0] === "flag").length, flagWrites, "an unchanged count writes nothing");

  actor.effects.push({ statuses: new Set(["hungry"]), flags: {} });
  assert.equal(conditionStacksOf(actor, "hungry"), 1, "an effect with no count is one cause");

  assert.equal(await setConditionStacks(actor, "fatigued", 0), 0);
  assert.equal(conditionStacksOf(actor, "fatigued"), 0, "zero lifts the status");
  assert.equal(await setConditionStacks(actor, "fatigued", -4), 0, "and so does below");
  assert.equal(await setConditionStacks(null, "fatigued", 2), 0, "no actor, nothing to set");
  passed++;
  console.log("ok   a condition's stacks are read from, and written to, the effect carrying it");
})();

/* --- a saving throw as the system rolls it ------------------------------------- */

await (async () => {
  const { installConditionRolls } = await import("../scripts/lib/status-effects.mjs");
  // The released system's actor: Blast is stored, and rolled, as `breath`.
  class SystemActor {
    constructor(statuses, { uuid = "Actor.saver", die = null } = {}) {
      this.uuid = uuid;
      this.name = "Saver";
      this.statuses = new Set(statuses);
      this.appliedEffects = [];
      this.effects = [];
      this.lifted = [];
      this.die = die;
      this.system = {
        hp: { value: 10 },
        saves: { breath: { value: 15 }, blast: { value: 15 }, death: { value: 14 }, wand: { value: 16 } },
      };
    }
    /**
     * The number the roll reads, as core reads it: before it awaits anything.
     * With a die set, the roll core resolves to afterwards.
     */
    rollSave(save) {
      const target = this.system.saves[save].value;
      return this.die == null ? target : Promise.resolve({ total: this.die });
    }
    async toggleStatusEffect(id, { active }) {
      if (active) return;
      this.statuses.delete(id);
      this.lifted.push(id);
    }
    _calculateMovement() {}
  }
  const said = [];
  const hooks = {};
  const fire = (name, ...args) => (hooks[name] ?? []).forEach((fn) => fn(...args));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const was = { CONFIG: globalThis.CONFIG, Hooks: globalThis.Hooks, ui: globalThis.ui, game: globalThis.game };
  globalThis.CONFIG = { Actor: { documentClass: SystemActor } };
  globalThis.Hooks = { on: (name, fn) => void (hooks[name] ??= []).push(fn) };
  globalThis.ui = { notifications: { info: (m) => said.push(m), warn: (m) => said.push(m) } };
  globalThis.game = {
    i18n: { localize: (k) => k, format: (k, data) => `${k} ${JSON.stringify(data ?? {})}` },
    user: { id: "me" },
    users: { activeGM: { isSelf: true } },
    combat: null,
  };
  registerTable(DOC, { priority: PRIORITY.WORLD, source: "test" });
  try {
    installConditionRolls();
    const covered = new SystemActor(["covered"]);
    assert.equal(covered.rollSave("breath"), 12, "the released key for Blast takes cover's figure");
    assert.equal(covered.rollSave("blast"), 12, "and so does the key a renamed schema uses");
    assert.equal(covered.rollSave("death"), 14, "another throw takes none");
    assert.equal(covered.rollSave("wand"), 16);
    assert.deepEqual(covered.system.saves.breath, { value: 15 }, "the stored target is put back");
    assert.equal(new SystemActor(["covered", "coveredGreater"]).rollSave("breath"), 9, "greater cover supersedes");
    assert.equal(new SystemActor(["defendingShield"]).rollSave("breath"), 11);
    assert.equal(new SystemActor(["defendingShield", "casting"]).rollSave("breath"), 15, "a caster's shield is down");
    assert.equal(new SystemActor(["hungry"]).rollSave("breath"), 18, "a figure on every throw reaches this one");
    assert.equal(new SystemActor([]).rollSave("breath"), 15);
    assert.ok(said.some((line) => line.includes("notice.applied")), "what was applied is told");
    passed++;
    console.log("ok   a saving throw rolled under the system's key takes the figures that reach that throw");

    // A failed save: the die against the number the roll was made against, cover's figure included.
    const held = () => ["readied", "casting", "covered"];
    const failed = new SystemActor(held(), { die: 11 });
    await failed.rollSave("breath");
    await settle();
    assert.deepEqual(failed.lifted, ["readied", "casting"], "11 against 12 fails");
    assert.ok(said.some((line) => line.includes("notice.lost") && line.includes("lost.save")), "and the loss is told");
    const made = new SystemActor(held(), { die: 12 });
    await made.rollSave("breath");
    await settle();
    assert.deepEqual(made.lifted, [], "12 against 12 is made");
    const stored = new SystemActor(held(), { die: 14 });
    await stored.rollSave("death");
    await settle();
    assert.deepEqual(stored.lifted, [], "a throw cover does not reach is read against its stored number");
    passed++;
    console.log("ok   a failed saving throw costs a spell and a readied action, and a made one does not");

    // Damage: the pre-update marks an update that lowers hit points, and the update's own client lifts.
    const hurt = new SystemActor(held());
    const drop = {};
    fire("preUpdateActor", hurt, { system: { hp: { value: 4 } } }, drop);
    assert.deepEqual(drop, { "acks-extras": { hpFell: true } });
    fire("updateActor", hurt, {}, drop, "someone-else");
    await settle();
    assert.deepEqual(hurt.lifted, [], "another client's update is that client's to answer");
    fire("updateActor", hurt, {}, drop, "me");
    await settle();
    assert.deepEqual(hurt.lifted, ["readied", "casting"]);
    for (const [why, changed, actor] of [
      ["healing", { system: { hp: { value: 12 } } }, new SystemActor(held())],
      ["no change of hit points", { name: "Renamed" }, new SystemActor(held())],
      ["a creature with nothing to lose", { system: { hp: { value: 1 } } }, new SystemActor(["covered"])],
    ]) {
      const options = {};
      fire("preUpdateActor", actor, changed, options);
      assert.deepEqual(options, {}, why);
    }
    const token = new SystemActor(held());
    const delta = {};
    fire("preUpdateActorDelta", { syntheticActor: token }, { "system.hp.value": 3 }, delta);
    assert.deepEqual(delta, { "acks-extras": { hpFell: true } }, "an unlinked token's actor is read through its delta");
    passed++;
    console.log("ok   an update that lowers hit points costs the same two states, on the client that made it");

    // A move: only in a running fight, only out of the token's own turn, only on the mover's client.
    const mover = new SystemActor(held());
    const doc = { id: "t1", parent: { id: "s1" }, actor: mover };
    const own = { id: "c1", tokenId: "t1", sceneId: "s1", actor: mover };
    const other = { id: "c2", tokenId: "t2", sceneId: "s1", actor: new SystemActor([], { uuid: "Actor.other" }) };
    const members = [own, other];
    own.initiative = 6;
    other.initiative = 3;
    const combat = { started: true, combatant: own, combatants: Object.assign(members, { get: (id) => members.find((c) => c.id === id) }) };
    const me = { isSelf: true };
    fire("moveToken", doc, { method: "dragging" }, {}, me);
    await settle();
    assert.deepEqual(mover.lifted, [], "no fight is running");
    globalThis.game.combat = combat;
    fire("moveToken", doc, { method: "dragging" }, {}, me);
    await settle();
    assert.deepEqual(mover.lifted, [], "it moves on its own turn");
    combat.combatant = other;
    fire("moveToken", doc, { method: "dragging" }, {}, { isSelf: false });
    fire("moveToken", doc, { method: "undo" }, {}, me);
    fire("moveToken", { ...doc, id: "t9" }, { method: "dragging" }, {}, me);
    await settle();
    assert.deepEqual(mover.lifted, [], "another's move, a move undone and a token outside the fight cost nothing");
    other.initiative = null;
    fire("moveToken", doc, { method: "dragging" }, {}, me);
    await settle();
    assert.deepEqual(mover.lifted, [], "before the round's initiative is rolled nobody is acting");
    other.initiative = 3;
    fire("moveToken", doc, { method: "dragging" }, {}, me);
    await settle();
    assert.deepEqual(mover.lifted, ["readied"], "moved while another acts, it is no longer readied and still casts");
    passed++;
    console.log("ok   a token moved while another combatant acts is no longer readied");

    // The tracker: a combatant's turn lifts its own states and the ones it gave.
    const guard = new SystemActor(["readied", "covered"], { uuid: "Actor.guard" });
    const ally = new SystemActor(["defending", "readied"], { uuid: "Actor.ally" });
    const cg = { id: "g", actor: guard, initiative: 7 };
    const ca = { id: "a", actor: ally, initiative: 4 };
    const pair = [cg, ca];
    const bout = { id: "bout", combatants: Object.assign(pair, { get: (id) => pair.find((c) => c.id === id) }) };
    ally.effects = [{ statuses: new Set(["defending"]), start: { combat: bout, combatant: "g", initiative: 7, round: 1 } }, { statuses: new Set(["readied"]) }];
    guard.effects = [{ statuses: new Set(["readied"]) }, { statuses: new Set(["covered"]) }];
    fire("combatTurnChange", bout, { round: 1 }, { round: 1, combatantId: "a" });
    await settle();
    assert.deepEqual([ally.lifted, guard.lifted], [["readied"], []], "the ally's turn leaves the guard's defence on it");
    fire("combatTurnChange", bout, { round: 1 }, { round: 1, combatantId: "g" });
    await settle();
    assert.deepEqual([ally.lifted, guard.lifted], [["readied", "defending"], ["readied"]], "the guard's turn takes it");
    passed++;
    console.log("ok   a defence given to an ally comes off at the giver's turn");

    // A round that opens before its initiative is rolled: the tracker's first combatant is not acting yet.
    const opened = () => {
      const first = new SystemActor(["defending", "readied"], { uuid: "Actor.first" });
      const second = new SystemActor(["readied"], { uuid: "Actor.second" });
      const c1 = { id: "c1", actor: first, initiative: null };
      const c2 = { id: "c2", actor: second, initiative: null };
      const all = [c1, c2];
      const round = { id: `round-${Math.random()}`, round: 2, turn: 0, combatant: c1, combatants: Object.assign(all, { get: (id) => all.find((c) => c.id === id) }) };
      c1.combat = c2.combat = round;
      first.effects = [{ statuses: new Set(["defending"]), start: { round: 1 } }, { statuses: new Set(["readied"]), start: { round: 2 } }];
      second.effects = [{ statuses: new Set(["readied"]), start: { round: 1 } }];
      fire("combatTurnChange", round, { round: 1, turn: 1, combatantId: "c2" }, { round: 2, turn: 0, combatantId: "c1" });
      // The tracker put on `combatant` at index `turn`, as the system does after a roll or the Judge by hand.
      const to = (combatant, turn) => {
        const prior = { round: 2, turn: round.turn, combatantId: round.combatant.id };
        Object.assign(round, { combatant, turn });
        fire("combatTurnChange", round, prior, { round: 2, turn, combatantId: combatant.id });
      };
      // Initiative rolled for `combatant`; the tracker stays on whoever was current, at that one's new index.
      const rolls = (combatant, initiative, turn = round.turn) => {
        combatant.initiative = initiative;
        round.turn = turn;
        fire("updateCombatant", combatant, { initiative });
      };
      return { first, second, c1, c2, round, to, rolls };
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    const lifted = (r) => [r.first.lifted, r.second.lifted];

    const kept = opened();
    await tick();
    assert.deepEqual(lifted(kept), [[], []], "nothing ends as the round opens");
    kept.rolls(kept.c2, 2, 0);
    await tick();
    assert.deepEqual(lifted(kept), [[], []], "nor while one combatant has yet to roll");
    kept.rolls(kept.c1, 5, 0);
    await tick();
    assert.deepEqual(lifted(kept), [["defending", "readied"], []], "the last roll leaves the tracker on the first combatant, whose turn begins once");

    // Rolled one at a time: the system puts the tracker on whoever is first so far, and that is no turn.
    const oneByOne = opened();
    oneByOne.rolls(oneByOne.c2, 4, 1);
    oneByOne.to(oneByOne.c2, 0);
    await tick();
    assert.deepEqual(lifted(oneByOne), [[], []], "first so far, with a roll still to come");
    oneByOne.rolls(oneByOne.c1, 6, 1);
    await tick();
    assert.deepEqual(lifted(oneByOne), [[], []], "all rolled, and the tracker is not yet on the round's first");
    oneByOne.to(oneByOne.c1, 0);
    await tick();
    assert.deepEqual(lifted(oneByOne), [["defending", "readied"], []], "the tracker goes to the first, and its turn begins");
    oneByOne.to(oneByOne.c2, 1);
    await tick();
    assert.deepEqual(oneByOne.second.lifted, ["readied"], "and the turns after it are turns");

    // Never rolled: the Judge moving the tracker on begins the round.
    const byHand = opened();
    byHand.to(byHand.c2, 1);
    await tick();
    assert.deepEqual(
      lifted(byHand),
      [["defending"], ["readied"]],
      "the turn it left has passed: what was carried into the round ends, what was taken up in it stands",
    );
    fire("updateCombatant", byHand.c1, { initiative: null });
    await tick();
    assert.deepEqual(byHand.first.lifted, ["defending"], "an initiative cleared is not one rolled");

    // One combatant never rolls: the round still begins when the Judge moves on.
    const absent = opened();
    absent.rolls(absent.c1, 3, 0);
    await tick();
    assert.deepEqual(lifted(absent), [[], []]);
    absent.to(absent.c2, 1);
    await tick();
    assert.deepEqual(lifted(absent), [["defending"], ["readied"]]);
    passed++;
    console.log("ok   a round opened before its initiative is rolled ends nothing until it begins");
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
    Object.assign(globalThis, was);
  }
})();
console.log(`\n${passed} condition checks passed.`);
