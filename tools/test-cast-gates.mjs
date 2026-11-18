/**
 * Offline tests for a cast's target gates (`cast-gates.mjs` and the paths that
 * read it: `cast-spell.mjs` `rollResist` and `buildTargets`, the cast's throw
 * loop, `cast-card.mjs`, and `cast-apply.mjs`'s `checkApplyRequest` and
 * `applyOnTarget`), and the size reads that moved to lib's `actor-read.mjs`.
 * Foundry-free; every spell, creature, size and figure below is invented, so this
 * file carries no book content.
 *
 * Usage: node tools/test-cast-gates.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, user: { targets: new Set() } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "3 + 4";
    return this;
  }
};
class FakeItem {
  constructor(data, { parent } = {}) {
    this.type = data.type;
    this.parent = parent;
    this.system = { ...data.system, getDamageFormula() { return this.damage.base.formula; }, getDamageModifiers() { return []; } };
  }
}
globalThis.CONFIG = { Item: { documentClass: FakeItem } };
/** An invented size ladder, smallest first, as the monsters feature publishes its own. */
globalThis.acksExtras = { monsters: { config: { SIZES: { sml: { label: "Sml" }, man: { label: "Man" }, big: { label: "Big" }, vast: { label: "Vast" } } } } };

const { targetGate, noSaveResist, gateTip } = await import("../scripts/magic/cast-gates.mjs");
const { saveGoverns } = await import("../scripts/magic/cast-rows.mjs");
const { writesRecipientRecord } = await import("../scripts/magic/cast-spell.mjs");
const { levelNeeded } = await import("../scripts/magic/cast-level.mjs");
const { sizeRank, sizeKeyOf, rankOfSize } = await import("../scripts/lib/actor-read.mjs");
const { rollResist, buildTargets, castSpellRun, castGateExtrasOf } = await import("../scripts/magic/cast-spell.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { checkApplyRequest, applyOnTarget } = await import("../scripts/magic/cast-apply.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const flat = (v) => ({ kind: "flat", flat: v });
const perLevel = (base, per) => ({ kind: "perLevel", base, per });
/** An invented monster: `hd` as its sheet writes it, its stated size, a save of its own. */
const creature = (hd, size = "man", name = "Thing") => ({
  name,
  type: "monster",
  system: { hp: { hd }, saves: { spell: { value: 14 } } },
  effects: [],
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { size } : undefined),
});
/** An invented character of a class level. */
const person = (level) => ({ name: "Folk", type: "character", system: { details: { level }, saves: { spell: { value: 14 } } }, effects: [], getFlag: () => undefined });
const capOf = (hdCap) => ({ target: { hdCap } });
const belowOf = (exemptBelowHd) => ({ save: { exemptBelowHd } });

/* ------------------------------------------------------------------ */
/*  The comparisons                                                    */
/* ------------------------------------------------------------------ */

t("a target over the cap is unaffected on every row, and one at the cap is affected (inclusive)", () => {
  const over = targetGate({ actor: creature("5"), extras: capOf(flat(4)) });
  assert.equal(over.affected, false);
  assert.equal(over.noSave, false);
  assert.deepEqual(over.why, { key: "hd", parts: [{ key: "hd", value: 5 }, { key: "cap", value: 4 }] });
  assert.equal(targetGate({ actor: creature("4"), extras: capOf(flat(4)) }).affected, true, "at the cap");
  assert.equal(targetGate({ actor: creature("3"), extras: capOf(flat(4)) }).affected, true, "under it");
  assert.equal(targetGate({ actor: creature("5"), extras: capOf(flat(4)), row: { exemptSizeFrom: "" } }).affected, false, "whichever row asks");
  assert.equal(targetGate({ actor: creature("5"), extras: capOf(4) }).affected, false, "a bare number is a flat figure");
});

t("a monster's bonus to its Hit Dice is not counted, a half Hit Die is under a cap of one, and a character is read at its level", () => {
  assert.equal(targetGate({ actor: creature("4+1"), extras: capOf(flat(4)) }).affected, true, "4+1 reads as 4");
  assert.equal(targetGate({ actor: creature("1/2"), extras: capOf(flat(1)) }).affected, true);
  assert.equal(targetGate({ actor: creature("1/2"), extras: belowOf(flat(1)) }).noSave, true, "half a die is below one");
  assert.equal(targetGate({ actor: person(6), extras: capOf(flat(5)) }).affected, false);
  assert.equal(targetGate({ actor: person(5), extras: capOf(flat(5)) }).affected, true);
});

t("a target below the save threshold makes no save and is still affected; one at it saves; the cap wins over the threshold", () => {
  const below = targetGate({ actor: creature("2"), extras: belowOf(flat(3)) });
  assert.equal(below.affected, true);
  assert.equal(below.noSave, true);
  assert.deepEqual(below.why, { key: "noSave", parts: [{ key: "hd", value: 2 }, { key: "below", value: 3 }] });
  assert.equal(targetGate({ actor: creature("3"), extras: belowOf(flat(3)) }).noSave, false, "at the threshold it saves");
  assert.equal(targetGate({ actor: creature("4"), extras: belowOf(flat(3)) }).noSave, false);
  const both = targetGate({ actor: creature("5"), extras: { target: { hdCap: flat(4) }, save: { exemptBelowHd: flat(9) } } });
  assert.deepEqual([both.affected, both.noSave, both.why.key], [false, false, "hd"], "an unaffected target makes no save to skip");
});

t("a size exemption covers its own row only, at or above its size, and a size the ladder or the target does not know exempts nobody", () => {
  const huge = creature("3", "vast");
  const row = { exemptSizeFrom: "big" };
  const gate = targetGate({ actor: huge, row });
  assert.equal(gate.affected, false);
  assert.deepEqual(gate.why, { key: "size", parts: [{ key: "size", value: "vast" }, { key: "from", value: "big" }] });
  assert.equal(targetGate({ actor: huge, row: { exemptSizeFrom: "" } }).affected, true, "another row of the same spell");
  assert.equal(targetGate({ actor: huge }).affected, true, "no row, no size gate");
  assert.equal(targetGate({ actor: creature("3", "big"), row }).affected, false, "at the size");
  assert.equal(targetGate({ actor: creature("3", "man"), row }).affected, true, "under it");
  assert.equal(targetGate({ actor: creature("3", "vast"), row: { exemptSizeFrom: "nowhere" } }).affected, true, "a size the ladder lacks");
  assert.equal(targetGate({ actor: creature("3", "unlisted"), row }).affected, true, "a size the target has that the ladder lacks");
  assert.equal(targetGate({ actor: person(3), row: { exemptSizeFrom: "man" } }).affected, false, "a character is man-sized");
});

t("a blank threshold gates nothing, and nothing readable is gated by nothing", () => {
  const actor = creature("9", "vast");
  for (const extras of [null, undefined, {}, { target: {}, save: {} }, { target: { hdCap: null }, save: { exemptBelowHd: undefined } }, capOf({ kind: "flat" })]) {
    const gate = targetGate({ actor, extras, row: {} });
    assert.deepEqual(gate, { affected: true, noSave: false, why: { key: "", parts: [] } });
  }
  assert.equal(targetGate({ actor: null, extras: capOf(flat(1)) }).affected, true, "no actor");
  assert.equal(targetGate({ actor: creature("", "man"), extras: { target: { hdCap: flat(1) }, save: { exemptBelowHd: flat(9) } } }).affected, true, "a blank Hit Dice rating is unread, not zero");
  assert.equal(targetGate({ actor: creature("", "man"), extras: belowOf(flat(9)) }).noSave, false, "and makes no save for no reason");
  assert.equal(targetGate({ actor: creature("4"), extras: capOf(flat(4)), row: undefined, level: undefined }).affected, true);
});

t("a threshold that scales by level gives no gate without a level, never a default, and names the level it was read at", () => {
  const extras = { target: { hdCap: perLevel(1, 1) }, save: { exemptBelowHd: perLevel(1, 1) } };
  assert.deepEqual(targetGate({ actor: creature("9"), extras, level: null }), { affected: true, noSave: false, why: { key: "", parts: [] } });
  assert.equal(targetGate({ actor: creature("9"), extras }).affected, true, "an absent level is no level");
  const at3 = targetGate({ actor: creature("4"), extras, level: 3 });
  assert.equal(at3.affected, false, "a cap of three at level three");
  assert.deepEqual(at3.why.parts, [{ key: "hd", value: 4 }, { key: "cap", value: 3 }, { key: "level", value: 3 }]);
  assert.equal(targetGate({ actor: creature("3"), extras, level: 3 }).affected, true, "at the cap");
  const low = targetGate({ actor: creature("2"), extras: belowOf(perLevel(1, 1)), level: 3 });
  assert.deepEqual([low.noSave, low.why.parts], [true, [{ key: "hd", value: 2 }, { key: "below", value: 3 }, { key: "level", value: 3 }]]);
});

t("the dialog asks for a caster level where a cap or the save threshold scales", () => {
  assert.equal(levelNeeded({ target: { hdCap: perLevel(1, 1) } }, []), true);
  assert.equal(levelNeeded({ save: { exemptBelowHd: perLevel(1, 1) } }, []), true);
  assert.equal(levelNeeded({ target: { hdCap: flat(4) }, save: { exemptBelowHd: flat(2) } }, []), false);
});

t("lib reads a creature's size key and its place in the ladder; a character is man-sized and an unknown size has no place", () => {
  assert.equal(sizeKeyOf(creature("1", "big")), "big");
  assert.equal(sizeKeyOf(person(2)), "man");
  assert.equal(sizeKeyOf(null), null);
  assert.equal(sizeKeyOf({ type: "monster", getFlag: () => undefined }), null, "a monster stating none");
  assert.deepEqual([rankOfSize("sml"), rankOfSize("vast"), rankOfSize("nowhere"), rankOfSize("")], [0, 3, null, null]);
  assert.equal(sizeRank(creature("1", "big")), 2);
  assert.equal(sizeRank(creature("1", "unlisted")), null);
  assert.equal(sizeRank(null), null);
  const saved = globalThis.acksExtras;
  globalThis.acksExtras = {};
  assert.equal(sizeRank(creature("1", "big")), null, "no ladder, no rank");
  globalThis.acksExtras = saved;
});

/* ------------------------------------------------------------------ */
/*  The resist and the entries                                         */
/* ------------------------------------------------------------------ */

const save = { category: "spell", effect: "negates" };
const SCORCH = { key: "burn", type: "damage", roll: "2d4", damage: ["fire"] };
const MEND = { key: "mend", type: "heal", roll: "1d4" };
const BOLT = { key: "bolt", type: "damage", roll: "1d6", damage: ["fire"], delivery: "missile" };
const keyedOf = (rows) => rows.map((row, index) => ({ row, key: row.key, index }));
const caster = { uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) };
const tokenOf = (actor, i = 1) => ({ uuid: `Scene.s.Token.k${i}`, name: actor.name, id: `k${i}`, actor });
const cardRows = {
  burn: { type: "damage", key: "burn", total: 6, delivery: "" },
  mend: { type: "heal", key: "mend", total: 3, delivery: "" },
  bolt: { type: "damage", key: "bolt", total: null, delivery: "missile", count: { value: 1, parts: [] } },
};
let ids = 0;
const build = (tokens, rows, extras, over = {}) => buildTargets({ tokens, card: { rows: cardRows, casterLevel: { value: 3 } }, rows: keyedOf(rows), save, situational: null, caster, randomID: () => `x${++ids}`, extras, ...over });

await ta("rollResist rolls nothing for a target the spell does not reach, and keeps a failed save marked as no save for one that makes none", async () => {
  const cap = targetGate({ actor: creature("5"), extras: capOf(flat(4)) });
  assert.deepEqual(await rollResist(creature("5"), save, null, { gate: cap }), { resist: null, roll: null });
  const none = targetGate({ actor: creature("1"), extras: belowOf(flat(2)) });
  const made = await rollResist(creature("1"), save, null, { gate: none });
  assert.equal(made.roll, null, "no roll");
  assert.deepEqual([made.resist.success, made.resist.total, made.resist.target], [false, null, null]);
  assert.deepEqual(made.resist.noSave, { key: "noSave", parts: [{ key: "hd", value: 1 }, { key: "below", value: 2 }] });
  assert.equal(made.resist.category, "spell");
  const rolled = await rollResist(creature("3"), save, null, { gate: targetGate({ actor: creature("3"), extras: belowOf(flat(2)) }) });
  assert.equal(typeof rolled.resist.total, "number", "a target at the threshold rolls");
  assert.equal(rolled.resist.noSave, undefined);
});

await ta("a target over the cap has an exempt entry on every row and no save; its neighbour under it has its own entries and a rolled save", async () => {
  const extras = capOf(flat(4));
  const out = await build([tokenOf(creature("6", "man", "Brute"), 1), tokenOf(creature("2", "man", "Mouse"), 2)], [SCORCH, MEND, BOLT], extras);
  const [brute, mouse] = Object.keys(out.targets);
  assert.equal(out.targets[brute].resist, null, "no save is rolled for an unaffected target");
  assert.equal(out.targets[mouse].resist.category, "spell");
  assert.equal(out.rolls.length, 1, "only the affected target rolled");
  for (const row of ["burn", "mend", "bolt"]) {
    assert.equal(out.entries[`${brute}_${row}`].state, "exempt", `${row} on the first`);
    assert.deepEqual(out.entries[`${brute}_${row}`].gate, { key: "hd", parts: [{ key: "hd", value: 6 }, { key: "cap", value: 4 }] });
  }
  assert.deepEqual(["burn", "mend"].map((row) => out.entries[`${mouse}_${row}`]), [{ state: "pending" }, { state: "pending" }]);
  assert.equal(out.entries[`${mouse}_bolt`], undefined, "a thrown row's entry opens at its throw");
});

await ta("a size exemption exempts its row alone: the target is still saved against for the rows it takes", async () => {
  const sized = { ...SCORCH, exemptSizeFrom: "big" };
  const out = await build([tokenOf(creature("3", "vast"))], [sized, MEND], null);
  const [key] = Object.keys(out.targets);
  assert.equal(out.entries[`${key}_burn`].state, "exempt");
  assert.equal(out.entries[`${key}_burn`].gate.key, "size");
  assert.deepEqual(out.entries[`${key}_mend`], { state: "pending" });
  assert.equal(out.targets[key].resist.category, "spell", "the heal row it takes is still saved against");
  const only = await build([tokenOf(creature("3", "vast"))], [sized], null);
  assert.equal(Object.values(only.targets)[0].resist, null, "every governed row exempt, no save is rolled");
  assert.deepEqual(only.rolls, []);
});

await ta("a target below the threshold carries a no-save failure and keeps its pending entries; blank figures change nothing", async () => {
  const out = await build([tokenOf(creature("1")), tokenOf(creature("4"), 2)], [SCORCH], belowOf(flat(3)));
  const [weak, strong] = Object.keys(out.targets);
  assert.equal(out.targets[weak].resist.success, false);
  assert.equal(out.targets[weak].resist.noSave.key, "noSave");
  assert.deepEqual(out.entries[`${weak}_burn`], { state: "pending" });
  assert.equal(typeof out.targets[strong].resist.total, "number");
  assert.equal(out.rolls.length, 1);
  const blank = await build([tokenOf(creature("1"))], [SCORCH], { target: {}, save: {} });
  assert.equal(typeof Object.values(blank.targets)[0].resist.total, "number", "a blank threshold rolls the save");
  assert.equal(Object.keys(blank.entries).length, 1);
  const none = await build([tokenOf(creature("1"))], [SCORCH], null);
  assert.equal(typeof Object.values(none.targets)[0].resist.total, "number", "no figures at all, no gate");
});

await ta("the caster's own target is gated by nothing", async () => {
  const self = { ...MEND, key: "mend", appliesTo: "self" };
  const out = await build([tokenOf(creature("9"))], [self], capOf(flat(1)));
  const selfKey = Object.keys(out.targets).find((k) => out.targets[k].self);
  assert.deepEqual(out.entries[`${selfKey}_mend`], { state: "pending" });
});

/* ------------------------------------------------------------------ */
/*  The cast                                                           */
/* ------------------------------------------------------------------ */

const spell = (rows, extra = {}) => ({
  type: "spell",
  name: "Testgate",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, cite: "p. 1", save: { category: "spell", effect: "negates" }, ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) },
});
const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };

function runDeps(tokens, answer = { mode: "normal", picks: {} }) {
  const calls = { posts: [], throws: [], applied: [] };
  const hit = { attackRoll: { total: 15 }, resolution: { targetValue: 10, isHit: true, isCritical: false }, damageRoll: { formula: "1d6", result: "3" }, damageTotal: 4 };
  return {
    calls,
    deps: {
      lookups: NO_TWIN,
      read: async () => ({ actor: {}, tokens, casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: true, classLevel: 3 } }),
      ask: async () => answer,
      notify: () => {},
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => (calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
      apply: async (...args) => (calls.applied.push(args), { ok: true }),
      record: async () => {},
      throwRow: async (c, carrier, skip, token) => (calls.throws.push(token?.uuid ?? null), hit),
      now: () => 10,
      isGM: () => false,
    },
  };
}

await ta("the cast reads the spell's own figures: a thrown row is thrown at the targets it reaches only, the default split dealt among them", async () => {
  const brute = tokenOf(creature("7", "man", "Brute"), 1);
  const mouse = tokenOf(creature("2", "man", "Mouse"), 2);
  const rat = tokenOf(creature("1", "man", "Rat"), 3);
  const bolts = { ...BOLT, value: flat(3) };
  const r = runDeps([brute, mouse, rat]);
  const out = await castSpellRun(spell([bolts], { target: { hdCap: flat(4) } }), () => {}, r.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(r.calls.throws, ["Scene.s.Token.k2", "Scene.s.Token.k2", "Scene.s.Token.k3"], "no throw at the one over the cap");
  const card = r.calls.posts[0];
  const [first, second, third] = Object.keys(card.targets);
  assert.deepEqual(card.allocation, { bolt: { [second]: 2, [third]: 1 } });
  assert.equal(card.entries[`${first}_bolt`].state, "exempt");
  assert.deepEqual(r.calls.applied.map(([, key]) => key), [second, third], "nothing is applied for the exempt target");
});

await ta("a cast with a pickKind row stores the kind it narrowed to on the card and says so in a line: the answer's, else the first authored", async () => {
  const row = { key: "keen", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: flat(2), vsKinds: ["undead", "beast"], pickKind: true, lasts: "duration" };
  const ally = tokenOf(creature("2", "man", "Ally"), 1);
  const asked = runDeps([ally], { mode: "normal", picks: {}, pickKind: "beast" });
  await castSpellRun(spell([row]), () => {}, asked.deps);
  const named = asked.calls.posts[0];
  assert.deepEqual(named.pickKind, { key: "beast", defaulted: false });
  assert.deepEqual(named.lines, ["ACKS-MAGIC.cast.line.pickKind|{\"kind\":\"beast\"}"]);
  const left = runDeps([ally]);
  await castSpellRun(spell([row]), () => {}, left.deps);
  const first = left.calls.posts[0];
  assert.deepEqual(first.pickKind, { key: "undead", defaulted: true });
  assert.deepEqual(first.lines, ["ACKS-MAGIC.cast.line.pickKindDefault|{\"kind\":\"undead\"}"]);
  const plain = runDeps([ally]);
  await castSpellRun(spell([{ ...row, pickKind: false }]), () => {}, plain.deps);
  assert.equal(plain.calls.posts[0].pickKind, undefined, "a row that picks no kind leaves none on the card");
});

await ta("a typed split that names an exempt target spends that share, and a cap that scales is read at the cast's own level", async () => {
  const brute = tokenOf(creature("7"), 1);
  const mouse = tokenOf(creature("2"), 2);
  const bolts = { ...BOLT, value: flat(3) };
  const r = runDeps([brute, mouse], { mode: "normal", picks: {}, allocation: { bolt: { 0: "2", 1: "1" } } });
  await castSpellRun(spell([bolts], { target: { hdCap: flat(4) } }), () => {}, r.deps);
  assert.deepEqual(r.calls.throws, ["Scene.s.Token.k2"], "the one throw assigned to the reachable target");
  const scaled = runDeps([brute, mouse]);
  await castSpellRun(spell([bolts], { target: { hdCap: perLevel(2, 2) } }), () => {}, scaled.deps);
  assert.deepEqual(scaled.calls.throws, ["Scene.s.Token.k2", "Scene.s.Token.k2", "Scene.s.Token.k2"], "a cap of 6 at level 3 still leaves 7 HD out, and the first target has none thrown at it");
});

t("the spell's figures are the copy's own target figures, else its twin's, with the save the copy's own", () => {
  const twin = { flags: { "acks-extras": { spell: { target: { model: "creature", hdCap: flat(4) } } } } };
  const bare = { flags: { "acks-extras": { cookbook: { id: "def.spell.testGate" }, spell: { effects: [], save: { exemptBelowHd: flat(2) } } } } };
  const lookups = { byCookbookId: (type, id) => (id === "def.spell.testGate" ? twin : null), fromUuidSync: () => null };
  assert.deepEqual(castGateExtrasOf(bare, lookups), { target: { model: "creature", hdCap: flat(4) }, save: { exemptBelowHd: flat(2) }, spell: { id: "def.spell.testGate", provides: [] } });
  assert.deepEqual(castGateExtrasOf(bare, NO_TWIN), { target: null, save: { exemptBelowHd: flat(2) }, spell: { id: "def.spell.testGate", provides: [] } });
});


/* ------------------------------------------------------------------ */
/*  S5b: immunity a record grants, a size strictly over, own-save rows  */
/* ------------------------------------------------------------------ */

/** A creature carrying a record's immune part, as lib's reader finds it on its effects. */
const immuneCreature = (parts, base = creature("2")) => {
  const effect = { id: "fxi", disabled: false, flags: { "acks-extras": { rollMods: { id: "def.spell.testWard", label: "Testward", cite: "T 3", sourceAlignment: null, parts } } } };
  return Object.assign(base, { effects: [effect], appliedEffects: [effect] });
};
const SPELLED = { spell: { id: "def.spell.testSlick", provides: [] } };

t("a record's immunity to the spell exempts every row, named by the record, and the spell-wide gate carries it", () => {
  const actor = immuneCreature([{ key: "w", on: "immune", spells: ["def.spell.testSlick"], provides: ["kw:spellrecord"] }]);
  const row = targetGate({ actor, extras: SPELLED, row: { type: "conditionGrant", conditions: ["prone"] } });
  assert.equal(row.affected, false);
  assert.deepEqual(row.why, { key: "immune", parts: [{ key: "by", value: "Testward (T 3)" }] });
  assert.equal(targetGate({ actor, extras: SPELLED }).affected, false, "the spell's gates alone");
  assert.equal(targetGate({ actor, extras: { spell: { id: "def.spell.testOther", provides: [] } } }).affected, true, "another spell");
  assert.equal(targetGate({ actor, extras: null }).affected, true, "no spell named, nothing to be immune to");
  assert.equal(gateTip(row.why, (k, d) => `${k}|${JSON.stringify(d)}`, { name: "Thing", cite: "T 9" }), 'tip.gateImmune|{"name":"Thing","parts":"tip.gatePart.by|{\\"value\\":\\"Testward (T 3)\\"}","cite":"T 9"}');
});

t("a record's immunity to conditions exempts a row only where it covers every condition the row writes", () => {
  const actor = immuneCreature([{ key: "w", on: "immune", conditions: ["prone", "paralysis"], provides: ["kw:spellrecord"] }]);
  const gate = (conditions) => targetGate({ actor, extras: SPELLED, row: { type: "conditionGrant", conditions } });
  assert.equal(gate(["prone"]).affected, false);
  assert.equal(gate(["prone", "paralysis"]).affected, false);
  assert.equal(gate(["prone", "sleep"]).affected, true, "a row covered in part still writes the rest");
  assert.equal(gate([]).affected, true, "a row with no condition is not covered by a condition's immunity");
  assert.equal(targetGate({ actor, extras: SPELLED }).affected, true, "the spell-wide gate is not exempt by condition");
  const gated = immuneCreature([{ key: "w", on: "immune", conditions: ["prone"], gate: { kind: "status", status: "weakened" }, provides: ["kw:spellrecord"] }]);
  assert.equal(targetGate({ actor: gated, extras: SPELLED, row: { type: "conditionGrant", conditions: ["prone"] } }).affected, true, "an immune part whose gate cannot be told is not applied");
});

t("exemptSizeOver exempts a target strictly above the size, never at it, and exemptSizeFrom still exempts at it", () => {
  const over = (size) => targetGate({ actor: creature("2", size), row: { exemptSizeOver: "man" } });
  assert.equal(over("man").affected, true, "the equal size is not exempt");
  assert.equal(over("sml").affected, true);
  assert.equal(over("big").affected, false);
  assert.deepEqual(over("vast").why, { key: "size", parts: [{ key: "size", value: "vast" }, { key: "over", value: "man" }] });
  assert.equal(targetGate({ actor: creature("2", "man"), row: { exemptSizeFrom: "man" } }).affected, false);
  assert.equal(targetGate({ actor: creature("2", "unlisted"), row: { exemptSizeOver: "man" } }).affected, true, "a size that cannot be read gates nothing");
  assert.equal(targetGate({ actor: creature("2", "big"), row: { exemptSizeOver: "nowhere" } }).affected, true, "a bound that is no size gates nothing");
  assert.equal(gateTip(over("big").why, (k, d) => `${k}|${JSON.stringify(d)}`, { name: "T" }).includes("tip.gatePart.over|{\"value\":\"Big\"}") || gateTip(over("big").why, (k, d) => `${k}|${JSON.stringify(d)}`, { name: "T" }).includes("over"), true);
});

await ta("rollResist carries the spell's own save rows: a row that holds lowers the target and is among the parts, one that cannot be told is kept as pendingParts", async () => {
  const own = [
    { key: "free", label: "Testspell", cite: "T 4", value: 3, saves: [] },
    { key: "wait", label: "Testspell", cite: "T 4", value: 2, gate: { kind: "status", status: "weakened", occasion: true }, saves: [] },
    { key: "elsewhere", label: "Testspell", cite: "T 4", value: 9, saves: ["death"] },
  ];
  const plain = await rollResist(creature("3"), save, null, {});
  const made = await rollResist(creature("3"), save, null, { ownRows: own });
  assert.equal(plain.resist.target, 14);
  assert.equal(made.resist.target, 11, "only the open row, and not the death-only row, lowers a spell save");
  assert.deepEqual(made.resist.parts.map((p) => p.key), ["free"]);
  assert.deepEqual(made.resist.pendingParts, [{ label: "Testspell (T 4)", value: 2, when: "gate" }], "a creature whose statuses cannot be read leaves the gated row undecided");
  const off = creature("3");
  off.statuses = new Set();
  assert.equal((await rollResist(off, save, null, { ownRows: own })).resist.pendingParts, undefined, "a gate that is off adds nothing and is not pending");
  const weak = creature("3");
  weak.statuses = new Set(["weakened"]);
  const held = await rollResist(weak, save, null, { ownRows: own });
  assert.deepEqual(held.resist.pendingParts, [{ label: "Testspell (T 4)", value: 2, when: "gate" }]);
  assert.equal(held.resist.target, 11);
});

await ta("buildTargets passes the kept rows' own-save figures at the card's caster level, and an exempt row of an immune target opens no entry", async () => {
  const ownRow = { key: "slowed", type: "modifier", target: "save", ownSave: true, value: { kind: "perLevel", base: 1, per: 1 }, appliesTo: "recipient" };
  const rows = [SCORCH, ownRow];
  const card = { rows: cardRows, casterLevel: { value: 3 }, spellName: "Testspell", cite: "T 5" };
  const built = await buildTargets({ tokens: [tokenOf(creature("3"))], card, rows: keyedOf(rows), save, situational: null, caster, randomID: () => `y${++ids}`, extras: null });
  const [target] = Object.values(built.targets);
  assert.equal(target.resist.target, 14 - 3, "a per-level figure at the card's level 3");
  const immune = immuneCreature([{ key: "w", on: "immune", spells: ["def.spell.testSlick"], provides: ["kw:spellrecord"] }], creature("3"));
  const none = await buildTargets({ tokens: [tokenOf(immune)], card, rows: keyedOf(rows), save, situational: null, caster, randomID: () => `z${++ids}`, extras: SPELLED });
  assert.deepEqual(Object.values(none.entries).map((e) => [e.state, e.gate?.key]), [["exempt", "immune"]]);
  assert.equal(Object.values(none.targets)[0].resist, null, "no save is rolled for a creature the spell does not reach");
});

t("the cast's gate figures name the spell as a record's immunity does", () => {
  const withId = { flags: { "acks-extras": { cookbook: { id: "def.spell.testSlick" }, spell: { effects: [] } } } };
  assert.deepEqual(castGateExtrasOf(withId, NO_TWIN).spell, { id: "def.spell.testSlick", provides: [] });
  assert.equal(castGateExtrasOf({ flags: { "acks-extras": { spell: { effects: [] } } } }, NO_TWIN).spell, null, "a spell with no definition id");
});

/* ------------------------------------------------------------------ */
/*  The card                                                           */
/* ------------------------------------------------------------------ */

const loc = (key, data) => `${key}|${JSON.stringify(data)}`;
/** The data a `loc` string above was given. */
const tipData = (text) => JSON.parse(text.slice(text.indexOf("|") + 1));
const cardOfTargets = (over = {}) => ({
  castId: "cast1",
  casterLevel: { value: 3, source: "class" },
  cite: "p. 1",
  spellName: "Testgate",
  save: { category: "spell", effect: "negates" },
  order: ["burn"],
  rows: { burn: { type: "damage", key: "burn", types: ["fire"], total: 6, formula: "2d4", detail: "3 + 3", delivery: "" } },
  targets: { t1: { uuid: "Scene.s.Token.k1", name: "Brute", resist: null }, t2: { uuid: "Scene.s.Token.k2", name: "Mouse", resist: noSaveResist(save, { key: "noSave", parts: [{ key: "hd", value: 1 }, { key: "below", value: 2 }] }) } },
  entries: { t1_burn: { state: "exempt", gate: { key: "hd", parts: [{ key: "hd", value: 6 }, { key: "cap", value: 4 }] } }, t2_burn: { state: "pending" } },
  ...over,
});

t("the card says Exempt with the gate's parts and the page, and No save with its own", () => {
  const view = castCardView(cardOfTargets(), { isGM: true, canPress: true }, loc);
  const [exempt, nosave] = view.sections[0].rows;
  assert.equal(exempt.outcome, "state.exempt|undefined");
  assert.match(exempt.tooltipText, /^tip\.gateHd\|/);
  const tip = tipData(exempt.tooltipText);
  assert.equal(tip.name, "Brute");
  assert.equal(tip.cite, "p. 1");
  assert.match(tip.parts, /tip\.gatePart\.hd\|\{"value":6\} · tip\.gatePart\.cap\|\{"value":4\}/);
  assert.deepEqual(exempt.actions, [], "an exempt entry offers no Apply");
  assert.equal(exempt.target, undefined, "no save column for a row it is exempt from");
  assert.equal(nosave.target, undefined, "the word is not a number to need");
  assert.equal(nosave.targetText, "save.none|undefined");
  assert.match(nosave.targetTooltip, /^tip\.noSave\|/);
  assert.match(tipData(nosave.targetTooltip).parts, /tip\.gatePart\.hd\|\{"value":1\} · tip\.gatePart\.below\|\{"value":2\}/);
  assert.equal(tipData(nosave.targetTooltip).name, "Mouse");
  assert.match(nosave.detail, /detail\.noSave/);
  assert.deepEqual(nosave.actions.map((a) => a.action), ["magicCastApply"], "the target that makes no save still applies");
});

t("a size exemption names both sizes by their labels, and an exempt modifier row reads the same", () => {
  const entry = { state: "exempt", gate: { key: "size", parts: [{ key: "size", value: "vast" }, { key: "from", value: "big" }] } };
  const sized = tipData(gateTip(entry.gate, loc, { name: "Huge thing", cite: "p. 2" }));
  assert.deepEqual([sized.name, sized.cite], ["Huge thing", "p. 2"]);
  assert.match(sized.parts, /tip\.gatePart\.size\|\{"value":"Vast"\} · tip\.gatePart\.from\|\{"value":"Big"\}/);
  const ward = cardOfTargets({ order: ["ward"], rows: { ward: { type: "ward", key: "ward", on: "ward", blank: false, types: [], total: null } }, targets: { t1: { uuid: "x", name: "Brute", resist: null } }, entries: { t1_ward: entry } });
  const [line] = castCardView(ward, { isGM: true, canPress: true }, loc).sections[0].rows;
  assert.equal(line.outcome, "state.exempt|undefined");
  assert.match(line.tooltipText, /^tip\.gateSize\|/);
  assert.equal(gateTip({ key: "", parts: [] }, loc), "", "no gate, no tooltip");
});

/* ------------------------------------------------------------------ */
/*  The relay                                                          */
/* ------------------------------------------------------------------ */

const heavy = creature("6", "man", "Brute");
const light = creature("1", "man", "Mouse");
const relayRows = [{ row: SCORCH, key: "burn" }];
/** The GM client's recompute for one actor, as `worldFor` builds it. */
const gateOf = (actor, extras, level = 3) => (row) => targetGate({ actor, extras, row, level });
const world = (over = {}) => ({
  message: { authorId: "p1" },
  card: cardOfTargets({ targets: { t1: { uuid: "Scene.s.Token.k1", name: "Target", resist: null } }, entries: { t1_burn: { state: "pending" } } }),
  ownsCaster: true,
  spellOfCaster: true,
  rows: relayRows,
  resist: null,
  boundsOf: () => ({ min: 2, max: 8 }),
  ...over,
});
const req = (over = {}) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: null, entries: [{ rowKey: "burn", rolled: 5 }], ...over });

t("the relay refuses an entry the recomputed gate exempts, whatever the card calls it", () => {
  const extras = capOf(flat(4));
  assert.deepEqual(checkApplyRequest(req(), world()), { ok: true }, "without gates the request stands");
  assert.equal(checkApplyRequest(req(), world({ gateOf: gateOf(heavy, extras) })).refused, "exempt", "a pending entry on a target the recompute says is over the cap");
  assert.equal(checkApplyRequest(req(), world({ gateOf: gateOf(light, extras) })).ok, true, "a target under it");
  const stored = world({ card: cardOfTargets({ targets: { t1: { uuid: "x", name: "T", resist: null } }, entries: { t1_burn: { state: "exempt", gate: { key: "hd", parts: [] } } } }) });
  assert.equal(checkApplyRequest(req(), stored).refused, "exempt", "an entry stored exempt is refused with no recompute at all");
  const sized = { ...SCORCH, exemptSizeFrom: "big" };
  const vast = creature("2", "vast");
  assert.equal(checkApplyRequest(req(), world({ rows: [{ row: sized, key: "burn" }], gateOf: gateOf(vast, null) })).refused, "exempt", "the row's own size gate");
  assert.equal(checkApplyRequest(req(), world({ rows: relayRows, gateOf: gateOf(vast, null) })).ok, true, "another row of the same spell has none");
  assert.equal(checkApplyRequest(req(), world({ gateOf: gateOf(heavy, extras), card: cardOfTargets({ targets: { t1: { uuid: "x", name: "T", resist: null } }, entries: { t1_burn: { state: "applied" } } }) })).refused, "exempt");
});

t("a no-save target's failure stands only where the recompute says it makes no save, and a rolled save never stands for one that makes none", () => {
  const extras = belowOf(flat(3));
  const failure = noSaveResist(save, { key: "noSave", parts: [{ key: "hd", value: 1 }, { key: "below", value: 3 }] });
  const noSaveCard = cardOfTargets({ targets: { t1: { uuid: "x", name: "T", resist: failure } }, entries: { t1_burn: { state: "pending" } } });
  const asNoSave = (over = {}) => world({ card: noSaveCard, gateOf: gateOf(light, extras), ...over });
  assert.deepEqual(checkApplyRequest(req({ resist: failure }), asNoSave()), { ok: true });
  assert.equal(checkApplyRequest(req({ resist: failure }), asNoSave({ gateOf: gateOf(creature("5"), extras) })).refused, "badResist", "the card claims a failure the recompute does not");
  assert.equal(checkApplyRequest(req({ resist: failure }), asNoSave({ gateOf: null })).refused, "badResist", "and with no gate to recompute");
  const rolled = { kind: "save", category: "spell", formula: "1d20", total: 15, target: 14, success: true, parts: [] };
  const rolledCard = cardOfTargets({ targets: { t1: { uuid: "x", name: "T", resist: rolled } }, entries: { t1_burn: { state: "pending" } } });
  assert.equal(checkApplyRequest(req({ resist: rolled }), world({ card: rolledCard, gateOf: gateOf(light, extras), resist: { target: 14, min: 1, max: 20 } })).refused, "badResist", "a passed save forged for a target that makes none");
  assert.equal(checkApplyRequest(req({ resist: rolled }), world({ card: rolledCard, gateOf: gateOf(creature("5"), extras), resist: { target: 14, min: 1, max: 20 } })).ok, true, "a target that saves keeps its roll");
  assert.equal(checkApplyRequest(req({ resist: { ...failure, total: 3 } }), asNoSave()).refused, "badResist", "a failure that carries a total is no failure of this kind");
});

/** The writes an apply makes, recorded. */
function fakeDeps(actor, extras, over = {}) {
  const log = { hp: [], lost: [], made: [], entries: {} };
  const deps = {
    messageId: "m1",
    resolve: async () => ({ actor, hpTarget: { key: "Scene.s.Token.k1", hp: { value: 20, max: 20 } } }),
    adjustHp: async (entries, { mode }) => (log.hp.push({ mode, amount: entries[0].amount }), [{ ok: true, before: 20, after: 20 - entries[0].amount }]),
    lose: async (a, cause) => (log.lost.push(cause), []),
    createRecords: async (a, datas) => (log.made.push(...datas), datas.map((_, i) => `r${i}`)),
    writeEntry: async (id, entry) => {
      log.entries[id] = entry;
    },
    now: () => 500,
    by: "u1",
    rows: [{ key: "burn", row: { ...SCORCH, roll: "2d4" } }, { key: "dread", row: { key: "dread", type: "conditionGrant", conditions: ["afraid"] } }],
    duration: { value: 60, units: "seconds" },
    spell: { uuid: "Actor.c1.Item.s1", name: "Testgate", img: "i.png", id: "def.spell.testGate", cite: "p. 1" },
    gate: (a, row) => targetGate({ actor: a, extras, row, level: 3 }),
    ...over,
  };
  return { deps, log };
}
const halfCard = (resist, entries = { t1_burn: { state: "pending" } }) =>
  cardOfTargets({ save: { category: "spell", effect: "half" }, targets: { t1: { uuid: "Scene.s.Token.k1", name: "Target", resist } }, entries, rows: { burn: { type: "damage", key: "burn", types: ["fire"], total: 8, delivery: "" } } });

await ta("a no-save target takes the whole amount as on a failed save, the loss of a failed save runs, and a rolled pass the card carries is recomputed as a failure", async () => {
  const extras = belowOf(flat(3));
  const failure = noSaveResist({ category: "spell" }, { key: "noSave", parts: [] });
  const honest = fakeDeps(light, extras);
  await applyOnTarget(halfCard(failure), "t1", [{ rowKey: "burn", rolled: 8 }], honest.deps);
  assert.deepEqual(honest.log.hp, [{ mode: "damage", amount: 8 }], "half would have been 4");
  assert.deepEqual(honest.log.lost, ["save"]);
  assert.equal(honest.log.entries.t1_burn.saved, false);
  assert.equal(honest.log.entries.t1_burn.applied, 8);
  const passed = { kind: "save", category: "spell", total: 15, target: 14, success: true, parts: [] };
  const forged = fakeDeps(light, extras);
  await applyOnTarget(halfCard(passed), "t1", [{ rowKey: "burn", rolled: 8 }], forged.deps);
  assert.deepEqual(forged.log.hp, [{ mode: "damage", amount: 8 }], "the recompute wins over the card's pass");
  assert.deepEqual(forged.log.lost, ["save"]);
  const strong = fakeDeps(creature("5"), extras);
  await applyOnTarget(halfCard(passed), "t1", [{ rowKey: "burn", rolled: 8 }], strong.deps);
  assert.deepEqual(strong.log.hp, [{ mode: "damage", amount: 4 }], "a target that saves keeps its pass");
  assert.deepEqual(strong.log.lost, []);
});

await ta("an exempt entry writes nothing: no hit points, no record, no loss, no entry", async () => {
  const extras = capOf(flat(4));
  const stored = fakeDeps(heavy, extras);
  const exempt = halfCard(null, { t1_burn: { state: "exempt", gate: { key: "hd", parts: [] } }, t1_dread: { state: "exempt", gate: { key: "hd", parts: [] } } });
  const out = await applyOnTarget(exempt, "t1", [{ rowKey: "burn", rolled: 5 }, { rowKey: "dread" }], stored.deps);
  assert.deepEqual(out.map((o) => o.skipped), ["exempt", "exempt"]);
  assert.deepEqual([stored.log.hp, stored.log.lost, stored.log.made, stored.log.entries], [[], [], [], {}]);
  const forgedPending = fakeDeps(heavy, extras);
  const pending = halfCard(null, { t1_burn: { state: "pending" }, t1_dread: { state: "pending" } });
  const again = await applyOnTarget(pending, "t1", [{ rowKey: "burn", rolled: 5 }, { rowKey: "dread" }], forgedPending.deps);
  assert.deepEqual(again.map((o) => o.skipped), ["exempt", "exempt"], "a pending entry the recompute exempts is skipped as well");
  assert.deepEqual([forgedPending.log.hp, forgedPending.log.made], [[], []]);
  const under = fakeDeps(light, extras);
  await applyOnTarget(halfCard(null), "t1", [{ rowKey: "burn", rolled: 5 }], under.deps);
  assert.deepEqual(under.log.hp, [{ mode: "damage", amount: 5 }], "a target under the cap is written as it was");
});

/* ------------------------------------------------------------------ */
/*  The strict bound, the kinds and a row no save governs (S4c)        */
/* ------------------------------------------------------------------ */

const belowBound = (hdBelow) => ({ target: { hdBelow } });
/** An invented monster of the given types (its kinds are read off its flag). */
const typed = (types, hd = "3") => ({ ...creature(hd), getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { size: "man", types } : undefined) });
const filtered = (...filters) => ({ target: { filters } });

t("a strict bound exempts a target at it and spares one a die under, while the inclusive cap spares one at it", () => {
  const at = targetGate({ actor: creature("4"), extras: belowBound(flat(4)) });
  assert.equal(at.affected, false, "at the bound is exempt");
  assert.deepEqual(at.why, { key: "hd", parts: [{ key: "hd", value: 4 }, { key: "bound", value: 4 }] });
  assert.equal(targetGate({ actor: creature("5"), extras: belowBound(flat(4)) }).affected, false, "over it");
  assert.equal(targetGate({ actor: creature("3"), extras: belowBound(flat(4)) }).affected, true, "one under it");
  assert.equal(targetGate({ actor: creature("4"), extras: capOf(flat(4)) }).affected, true, "the cap stays inclusive");
  assert.equal(targetGate({ actor: creature("4"), extras: { target: { hdCap: flat(4), hdBelow: flat(4) } } }).affected, false, "both read");
  const scaledBound = targetGate({ actor: creature("6"), extras: belowBound(perLevel(2, 2)), level: 3 });
  assert.deepEqual(scaledBound.why.parts, [{ key: "hd", value: 6 }, { key: "bound", value: 6 }, { key: "level", value: 3 }]);
  assert.equal(targetGate({ actor: creature("6"), extras: belowBound(perLevel(2, 2)) }).affected, true, "a scaled bound with no level gates nothing");
  assert.equal(targetGate({ actor: creature("", "man"), extras: belowBound(flat(1)) }).affected, true, "a blank rating is unread");
  assert.equal(levelNeeded({ target: { hdBelow: perLevel(1, 1) } }, []), true);
  assert.equal(levelNeeded({ target: { hdBelow: flat(4) } }, []), false);
  assert.equal(levelNeeded({ reversedDuration: { shape: "perLevel" } }, []), true, "a per-level reverse duration needs a level");
  assert.match(gateTip(at.why, (key) => key, { name: "Thing" }), /tip\.gateHd/);
});

t("filters gate through the creature's kinds: a missing kind is exempt with the key kind, a character is humanoid and living, and living fails only on undead", () => {
  const miss = targetGate({ actor: typed(["animal"]), extras: filtered("humanoid") });
  assert.equal(miss.affected, false);
  assert.deepEqual(miss.why, { key: "kind", parts: [{ key: "filter", value: "humanoid" }, { key: "kinds", value: "animal" }] });
  assert.equal(targetGate({ actor: typed(["humanoid"]), extras: filtered("humanoid") }).affected, true);
  assert.equal(targetGate({ actor: person(3), extras: filtered("humanoid") }).affected, true, "a character is humanoid");
  assert.equal(targetGate({ actor: typed(["beastman"]), extras: filtered("humanoid") }).affected, true, "a beastman is a humanoid by the defined term");
  assert.equal(targetGate({ actor: typed(["monstrosity"]), extras: filtered("humanoid") }).affected, false);
  assert.equal(targetGate({ actor: person(3), extras: filtered("living") }).affected, true, "and living");
  assert.equal(targetGate({ actor: person(3), extras: filtered("undead") }).affected, false, "and not undead");
  assert.equal(targetGate({ actor: typed(["undead"]), extras: filtered("living") }).affected, false, "undead is not living");
  for (const type of ["construct", "plant", "animal", "humanoid"]) assert.equal(targetGate({ actor: typed([type]), extras: filtered("living") }).affected, true, `${type} is living`);
  assert.equal(targetGate({ actor: typed(["undead"]), extras: filtered("undead") }).affected, true);
  assert.equal(targetGate({ actor: typed(["construct"]), extras: filtered("enchanted") }).affected, true, "a construct is enchanted by definition");
  assert.equal(targetGate({ actor: typed(["plant"]), extras: filtered("animal", "plant") }).affected, true, "type words are alternatives");
  assert.equal(targetGate({ actor: typed(["undead"]), extras: filtered("living", "humanoid") }).affected, false, "living is a condition of its own");
  assert.equal(targetGate({ actor: typed(["animal"]), extras: filtered("living", "humanoid") }).affected, false, "and the type must still match");
  assert.equal(targetGate({ actor: typed(["humanoid"]), extras: filtered("living", "humanoid") }).affected, true);
});

t("an empty kind set, an empty filter list and a filter no kind decides gate nothing", () => {
  assert.equal(targetGate({ actor: creature("3"), extras: filtered("humanoid") }).affected, true, "an untyped monster is not gated");
  assert.equal(targetGate({ actor: typed(["animal"]), extras: filtered() }).affected, true);
  assert.equal(targetGate({ actor: typed(["animal"]), extras: { target: {} } }).affected, true);
  for (const word of ["ally", "enemy", "object", "structure", "sapient", "dead"]) assert.equal(targetGate({ actor: typed(["animal"]), extras: filtered(word) }).affected, true, `${word} is shown, not enforced`);
  assert.equal(targetGate({ actor: typed(["animal"]), extras: filtered("humanoid", "ally") }).affected, true, "an alternative no kind decides keeps the target in");
  assert.equal(targetGate({ actor: typed(["undead"]), extras: filtered("living", "ally") }).affected, false, "a condition still gates");
  assert.equal(targetGate({ actor: typed(["animal"]), extras: { target: { filters: new Set(["humanoid"]) } } }).affected, false, "a set reads as a list");
  assert.equal(targetGate({ actor: null, extras: filtered("humanoid") }).affected, true);
});

t("the kind gate's tooltip names the filters and what the target is, the cap wins before the kinds, and the kinds before the size", () => {
  const why = targetGate({ actor: typed(["animal"]), extras: filtered("humanoid", "plant") }).why;
  const tip = gateTip(why, (key, data) => (data ? `${key}:${data.value ?? ""}:${data.parts ?? ""}` : key), { name: "Thing", cite: "p. 1" });
  assert.match(tip, /^tip\.gateKind:/);
  assert.match(tip, /tip\.gatePart\.filter:/);
  assert.match(tip, /tip\.gatePart\.kinds:/);
  const capped = targetGate({ actor: typed(["animal"], "9"), extras: { target: { hdCap: flat(4), filters: ["humanoid"] } } });
  assert.equal(capped.why.key, "hd");
  const sized = targetGate({ actor: typed(["animal"]), extras: filtered("humanoid"), row: { exemptSizeFrom: "man" } });
  assert.equal(sized.why.key, "kind");
});

await ta("a kind the filters leave out has an exempt entry on every row and no save, as a target over the cap does", async () => {
  const extras = filtered("humanoid");
  const out = await build([tokenOf(typed(["animal"], "2"), 1), tokenOf(typed(["humanoid"], "2"), 2)], [SCORCH, MEND], extras);
  const [beast, folk] = Object.keys(out.targets);
  assert.equal(out.targets[beast].resist, null, "no save for a target the spell does not reach");
  assert.equal(out.targets[folk].resist.category, "spell");
  for (const row of ["burn", "mend"]) {
    assert.equal(out.entries[`${beast}_${row}`].state, "exempt");
    assert.equal(out.entries[`${beast}_${row}`].gate.key, "kind");
    assert.equal(out.entries[`${folk}_${row}`].state, "pending");
  }
  const sheet = castGateExtrasOf({ flags: { "acks-extras": { spell: { target: { model: "creature", filters: ["humanoid"], hdBelow: flat(4) } } } } }, { byCookbookId: () => null });
  assert.deepEqual([sheet.target.filters, sheet.target.hdBelow], [["humanoid"], flat(4)], "the cast reads the bound and the filters from the spell");
});

await ta("a row no saving throw governs rolls no save and takes the whole amount; a spell with such a row beside a governed one still rolls for the governed", async () => {
  const FREE = { ...SCORCH, key: "freeburn", saveEffect: "none" };
  const freeCard = { type: "damage", key: "freeburn", total: 6, delivery: "" };
  const only = await build([tokenOf(creature("3"))], [FREE], null, { card: { rows: { freeburn: freeCard }, casterLevel: { value: 3 } } });
  const [key] = Object.keys(only.targets);
  assert.equal(only.targets[key].resist, null, "no save is rolled");
  assert.equal(only.rolls.length, 0);
  assert.deepEqual(only.entries[`${key}_freeburn`], { state: "pending" });
  const mixed = await build([tokenOf(creature("3"))], [FREE, SCORCH], null, { card: { rows: { ...cardRows, freeburn: freeCard }, casterLevel: { value: 3 } } });
  assert.equal(Object.values(mixed.targets)[0].resist.category, "spell", "the governed row still has its save");
  const spellWide = await build([tokenOf(creature("3"))], [SCORCH], null, { save: { category: "spell", effect: "none" } });
  assert.equal(Object.values(spellWide.targets)[0].resist, null, "a spell whose own effect is none rolls no save either");
  assert.deepEqual([saveGoverns(FREE, save), saveGoverns(SCORCH, save), saveGoverns({}, { effect: "none" }), saveGoverns({ saveEffect: "half" }, { effect: "none" })], [false, true, false, true]);
});

await ta("the cast's card takes the reverse's own duration in the reversed mode and the plain one in the normal mode, and a following-turn row writes a record to the recipient", async () => {
  const durations = { duration: { shape: "fixed", value: 3, unit: "turns" }, reversedDuration: { shape: "fixed", value: 2, unit: "rounds" } };
  const rows = [SCORCH, { ...MEND, reversed: true }];
  const folk = tokenOf(creature("2"), 1);
  const cardOf = async (mode) => {
    const r = runDeps([folk], { mode, picks: {} });
    const out = await castSpellRun(spell(rows, durations), () => {}, r.deps);
    assert.equal(out.ok, true);
    return r.calls.posts[0];
  };
  assert.deepEqual((await cardOf("normal")).duration, { value: 1800, units: "seconds" });
  assert.deepEqual((await cardOf("reversed")).duration, { value: 2, units: "rounds" });
  assert.equal(writesRecipientRecord({ type: "ignite", lasts: "followingTurn", appliesTo: "target" }), true);
  assert.equal(writesRecipientRecord({ type: "ignite", lasts: "instant", appliesTo: "target" }), false);
});

/* ------------------------------------------------------------------ */
/*  S5b-2: a row covered in part by a record's immunity                */
/* ------------------------------------------------------------------ */

const WARDED = [{ key: "w", on: "immune", conditions: ["prone", "paralysis"], provides: ["kw:spellrecord"] }];
const warded = () => immuneCreature(WARDED, creature("3", "man", "Warded"));
const MIXED = { key: "dread", type: "conditionGrant", conditions: ["prone", "afraid"] };
const WHOLE = { key: "dread", type: "conditionGrant", conditions: ["prone", "paralysis"] };

t("a row a record covers in part is affected and lists the covered conditions; a row covered whole is exempt and lists none; a plain target lists none", () => {
  const gate = (row, actor = warded()) => targetGate({ actor, extras: SPELLED, row });
  const mixed = gate(MIXED);
  assert.equal(mixed.affected, true);
  assert.deepEqual(mixed.immune, [{ condition: "prone", label: "Testward (T 3)" }]);
  assert.deepEqual(gate(WHOLE).immune, undefined, "exempt: nothing is written, so nothing is left off");
  assert.equal(gate(WHOLE).affected, false);
  assert.equal("immune" in gate(MIXED, creature("3")), false, "a target no record covers");
  const noSave = targetGate({ actor: immuneCreature(WARDED, creature("1")), extras: { ...SPELLED, ...belowOf(flat(3)) }, row: MIXED });
  assert.deepEqual([noSave.affected, noSave.noSave, noSave.immune?.length], [true, true, 1], "the list rides the no-save verdict too");
  assert.deepEqual(gate({ ...MIXED, conditions: ["afraid"] }), { affected: true, noSave: false, why: { key: "", parts: [] } }, "no covered condition, the gate is the plain one");
});

const MIXED_CARD = (entries = { t1_dread: { state: "pending" } }) =>
  cardOfTargets({
    order: ["dread"],
    rows: { dread: { type: "conditionGrant", key: "dread", types: [], conditions: ["prone", "afraid"], lasts: "instant" } },
    targets: { t1: { uuid: "Scene.s.Token.k1", name: "Warded", resist: null } },
    entries,
  });
const mixedDeps = (actor, row = MIXED) => fakeDeps(actor, SPELLED, { rows: [{ key: "dread", row }] });

await ta("the casting seat's apply writes only the uncovered conditions and names the covered ones on the entry; a row covered whole writes nothing", async () => {
  const { deps, log } = mixedDeps(warded());
  const out = await applyOnTarget(MIXED_CARD(), "t1", [{ rowKey: "dread" }], deps);
  assert.deepEqual(log.made.map((d) => d.statuses), [["afraid"]], "prone is left off");
  assert.deepEqual(out[0].entry.immune, [{ condition: "prone", label: "Testward (T 3)" }]);
  assert.equal(out[0].entry.recordIds.length, 1);
  const whole = mixedDeps(warded(), WHOLE);
  const none = await applyOnTarget(MIXED_CARD(), "t1", [{ rowKey: "dread" }], whole.deps);
  assert.deepEqual([none[0].skipped, whole.log.made], ["exempt", []]);
  const plain = mixedDeps(creature("3"));
  await applyOnTarget(MIXED_CARD(), "t1", [{ rowKey: "dread" }], plain.deps);
  assert.deepEqual(plain.log.made.map((d) => d.statuses), [["prone"], ["afraid"]], "no record, both are written");
  assert.equal(plain.log.entries.t1_dread.immune, undefined);
});

await ta("the relay checks a partly covered row as open and writes the same entry from the GM's recompute", async () => {
  const actor = warded();
  const open = checkApplyRequest(req({ entries: [{ rowKey: "dread" }] }), world({ rows: [{ row: MIXED, key: "dread" }], card: MIXED_CARD(), gateOf: gateOf(actor, SPELLED) }));
  assert.deepEqual(open, { ok: true });
  const whole = checkApplyRequest(req({ entries: [{ rowKey: "dread" }] }), world({ rows: [{ row: WHOLE, key: "dread" }], card: MIXED_CARD(), gateOf: gateOf(actor, SPELLED) }));
  assert.equal(whole.refused, "exempt");
  // The relay writes through `applyOnTarget` with the gate `castDeps` hands it (`inputs.gate`), recomputed on the writing client from the actor it resolves.
  const { deps, log } = mixedDeps(actor);
  await applyOnTarget(MIXED_CARD(), "t1", [{ rowKey: "dread" }], { ...deps, gate: (a, row) => targetGate({ actor: a, extras: SPELLED, row, level: 3 }) });
  assert.deepEqual(log.made.map((d) => d.statuses), [["afraid"]]);
  assert.equal(log.entries.t1_dread.immune[0].condition, "prone");
});

t("the card line names the conditions left off as immune and the record that grants it", () => {
  const entry = { state: "applied", saved: null, recordIds: ["r0"], immune: [{ condition: "prone", label: "Testward (T 3)" }] };
  const [line] = castCardView(MIXED_CARD({ t1_dread: entry }), { isGM: true, canPress: true }, loc).sections[0].rows;
  assert.match(line.detail, /detail\.immune\|\{"names":"[^"]*","by":"Testward \(T 3\)"\}/);
  const [plain] = castCardView(MIXED_CARD({ t1_dread: { ...entry, immune: undefined } }), { isGM: true, canPress: true }, loc).sections[0].rows;
  assert.doesNotMatch(plain.detail, /detail\.immune/);
});

/* ------------------------------------------------------------------ */
/*  S5b-2: no cast save for a row that waits for a failed save         */
/* ------------------------------------------------------------------ */

const FLOOR = { key: "floor", type: "conditionGrant", conditions: ["prone"], recur: "laterRounds", recurAt: "bearerStart", recurSave: "fail", saveEffect: "negates", lasts: "rounds", rounds: "1d4" };
const floorCard = { rows: { floor: { type: "conditionGrant", key: "floor", conditions: ["prone"], lasts: "rounds" }, burn: { type: "damage", key: "burn", total: 5, delivery: "" } }, casterLevel: { value: 3 } };

await ta("a spell whose only save-governed row waits for a failed save rolls no cast save and rolls no rounds for it; its row twin still rolls both, and a damage row beside it still draws the save", async () => {
  const draw = (rows, tag) => buildTargets({ tokens: [tokenOf(creature("3"))], card: floorCard, rows: keyedOf(rows), save, situational: null, caster, randomID: () => `${tag}${++ids}` });
  const only = await draw([FLOOR], "f");
  const [t1] = Object.keys(only.targets);
  assert.equal(only.targets[t1].resist, null, "no cast save");
  assert.deepEqual(only.rolls, []);
  assert.deepEqual(only.entries[`${t1}_floor`], { state: "pending" }, "an entry opens for the anchor, with no count rolled");
  const twin = await draw([{ ...FLOOR, recurSave: "row" }], "g");
  const [t2] = Object.keys(twin.targets);
  assert.equal(twin.targets[t2].resist?.category, "spell", "the row twin keeps its cast save");
  assert.equal(twin.entries[`${t2}_floor`].life.kind, "rounds", "and its count");
  const both = await draw([FLOOR, SCORCH], "h");
  assert.equal(Object.values(both.targets)[0].resist?.category, "spell", "a row that is saved against still draws it");
  const each = await draw([{ ...FLOOR, recur: "eachRound" }], "i");
  assert.equal(Object.values(each.targets)[0].resist?.category, "spell", "an eachRound twin resolves at the cast as any condition row does");
});

console.log(`${n} checks passed`);
