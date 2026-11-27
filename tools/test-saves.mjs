/**
 * A saving throw as named parts (scripts/lib/saves.mjs): the formula, the
 * target and the parts a throw is made from, and the throw made from them.
 *
 * Every figure below is INVENTED. What this pins is the composition: which
 * parts reach the roll, which lower the target, that a part of zero is not
 * listed, that the conditions' circumstance-bound rows are handed back rather
 * than applied, and that the throw never takes a state off its creature.
 */
import assert from "node:assert/strict";
import { saveSpec, saveThrow } from "../scripts/lib/saves.mjs";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

/** Invented sizes for the conditions below. */
const VALUES = { fatigued: { all: -3 }, "cover-waist-high": { blast: 3 }, blessed: { all: 3 } };

const character = ({ mod = 0, wis = 0, saves = { blast: { value: 14 } }, statuses = [] } = {}) => ({
  type: "character",
  uuid: "Actor.hero",
  statuses: new Set(statuses),
  system: { save: { mod }, scores: { wis: { mod: wis } }, saves },
});
const monster = ({ saves = { blast: { value: 14 } }, statuses = [] } = {}) => ({
  type: "monster",
  uuid: "Actor.beast",
  statuses: new Set(statuses),
  system: { saves },
});

await ok("a monster's Wisdom joins a throw against magic only where a Judge entered the score", () => {
  const had = globalThis.CONFIG;
  globalThis.CONFIG = { Actor: { dataModels: { character: { getAttributeModifier: (score) => ({ 16: 2, 5: -1 })[score] ?? 0 } } } };
  try {
    const entered = (scores) => ({ ...monster(), getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { scores } : undefined) });
    const wise = saveSpec(entered({ wis: 16 }), "blast");
    assert.deepEqual(wise.parts.map((p) => [p.key, p.value, p.side]), [["wis", 2, "roll"]]);
    assert.equal(wise.formula, "1d20 + 2");
    assert.equal(saveSpec(entered({ wis: 5 }), "blast").formula, "1d20 - 1");
    assert.deepEqual(saveSpec(entered({ wis: 16 }), "blast", { magical: false }).parts, [], "not on a throw that is not against magic");
    assert.deepEqual(saveSpec(entered({ wis: null }), "blast").parts, [], "a blank field is the default specimen and adds nothing");
    assert.deepEqual(saveSpec(monster(), "blast").parts, [], "nor does a monster with no scores at all");
  } finally {
    if (had === undefined) delete globalThis.CONFIG;
    else globalThis.CONFIG = had;
  }
});

await ok("a character's roll adds its own modifier and its Wisdom modifier against magic, as one signed term", () => {
  const spec = saveSpec(character({ mod: 2, wis: 1 }), "blast", { values: VALUES });
  assert.equal(spec.formula, "1d20 + 3");
  assert.deepEqual(spec.parts.map((p) => [p.key, p.value, p.side]), [["saveMod", 2, "roll"], ["wis", 1, "roll"]]);
  assert.equal(spec.baseTarget, 14);
  assert.equal(spec.target, 14);
  assert.equal(spec.save, "blast");
  assert.equal(saveSpec(character({ mod: -1, wis: -2 }), "blast").formula, "1d20 - 3");
  assert.equal(saveSpec(character({ mod: 0, wis: 0 }), "blast").formula, "1d20");
  const cancelled = saveSpec(character({ mod: 2, wis: -2 }), "blast");
  assert.equal(cancelled.formula, "1d20", "parts that cancel leave the bare die");
  assert.deepEqual(cancelled.parts.map((p) => p.key), ["saveMod", "wis"], "and both are still named");
});

await ok("a zero part is not listed, and the mundane throw and a monster carry no modifier", () => {
  assert.deepEqual(saveSpec(character({ mod: 0, wis: 2 }), "blast").parts.map((p) => p.key), ["wis"]);
  assert.equal(saveSpec(character({ mod: 2, wis: 1 }), "blast", { magical: false }).formula, "1d20");
  assert.deepEqual(saveSpec(character({ mod: 2, wis: 1 }), "blast", { magical: false }).parts, []);
  assert.equal(saveSpec(monster(), "blast").formula, "1d20", "a monster has neither");
});

await ok("a situational figure and the caller's parts join the roll: numbers sum into the one term, a die is appended", () => {
  const spec = saveSpec(character({ mod: 2, wis: 1 }), "blast", {
    situational: "-2",
    parts: [{ key: "ring", label: "Ring", value: 1 }, { key: "die", label: "Die", value: "+1d4" }],
  });
  assert.equal(spec.formula, "1d20 + 2 + 1d4", "3 - 2 + 1 = 2, then the die");
  assert.deepEqual(spec.parts.map((p) => p.key), ["saveMod", "wis", "situational", "ring", "die"]);
  assert.equal(saveSpec(monster(), "blast", { situational: "1d6" }).formula, "1d20 + 1d6");
  assert.equal(saveSpec(monster(), "blast", { situational: "-1d6" }).formula, "1d20 - 1d6");
  assert.equal(saveSpec(monster(), "blast", { situational: 4 }).formula, "1d20 + 4");
  assert.equal(saveSpec(monster(), "blast", { situational: "  " }).formula, "1d20", "blank is none");
  assert.equal(saveSpec(monster(), "blast", { situational: null, parts: [{ key: "x", label: "X", value: null }] }).formula, "1d20");
});

await ok("the conditions lower the target as the system's own throw lowers it, and are left out when asked", () => {
  const spec = saveSpec(character({ statuses: ["fatigued"] }), "blast", { values: VALUES });
  assert.equal(spec.baseTarget, 14);
  assert.equal(spec.target, 17, "a penalty of 3 on the roll raises the number to roll");
  assert.deepEqual(spec.parts.filter((p) => p.side === "target").map((p) => [p.key, p.value]), [["fatigued", -3]]);
  const covered = saveSpec(monster({ statuses: ["cover-waist-high"] }), "blast", { values: VALUES });
  assert.equal(covered.target, 11, "a bonus of 3 lowers it");
  assert.equal(saveSpec(monster({ saves: { blast: { value: 14 }, death: { value: 14 } }, statuses: ["cover-waist-high"] }), "death", { values: VALUES }).target, 14, "a row that names its saves reaches only those");
  const left = saveSpec(character({ statuses: ["fatigued"] }), "blast", { values: VALUES, conditions: false });
  assert.equal(left.target, 14, "the party's throw reads the stored number alone");
  assert.deepEqual(left.parts, []);
  assert.deepEqual([left.pending, left.unpriced], [[], []]);
});

await ok("a circumstance-bound row is handed back pending, an unimported figure is named unpriced, and neither moves the target", () => {
  const blessed = saveSpec(character({ statuses: ["blessed"] }), "blast", { values: VALUES });
  assert.deepEqual(blessed.pending, [{ condition: "blessed", value: 3, when: "fear" }]);
  assert.equal(blessed.target, 14);
  const bare = saveSpec(character({ statuses: ["fatigued"] }), "blast", { values: {} });
  assert.deepEqual(bare.unpriced, ["fatigued"]);
  assert.equal(bare.target, 14, "no figure stands in for the missing one");
});

await ok("a creature with no stored target has no throw to make", async () => {
  const none = saveSpec(character({ saves: {} }), "blast");
  assert.deepEqual([none.baseTarget, none.target], [null, null]);
  assert.equal(none.formula, "1d20", "the formula is still composed");
  let rolled = false;
  const made = await saveThrow(character({ saves: {} }), "blast", { roll: async () => { rolled = true; return { total: 20 }; } });
  assert.deepEqual([made.roll, made.total, made.success, rolled], [null, null, null, false]);
  assert.equal(saveSpec(character({ saves: { blast: { value: "14" } } }), "blast").target, null, "text is no stored target");
  assert.equal(saveSpec(null, "blast").target, null);
});

await ok("a saving-throw key an earlier schema used reaches the throw the conditions name it", () => {
  const spec = saveSpec(monster({ saves: { breath: { value: 15 } }, statuses: ["cover-waist-high"] }), "breath", { values: VALUES });
  assert.equal(spec.kind, "blast");
  assert.equal(spec.target, 12, "cover's row for Blast reaches the earlier key");
});

await ok("saveThrow rolls the composed formula, and a total at or above the target succeeds", async () => {
  const seen = [];
  const rollOf = (total) => async (formula) => { seen.push(formula); return { total }; };
  const hero = character({ mod: 2, wis: 1 });
  const hit = await saveThrow(hero, "blast", { roll: rollOf(14), values: VALUES });
  assert.equal(hit.success, true, "equal to the target succeeds");
  assert.equal(hit.total, 14);
  assert.equal(hit.formula, "1d20 + 3");
  const miss = await saveThrow(hero, "blast", { roll: rollOf(13), values: VALUES });
  assert.equal(miss.success, false);
  assert.deepEqual(seen, ["1d20 + 3", "1d20 + 3"], "the roll is handed exactly the spec's formula");
  const held = await saveThrow(character({ statuses: ["fatigued"] }), "blast", { roll: rollOf(16), values: VALUES });
  assert.equal(held.success, false, "16 against 17");
  assert.equal(held.target, 17);
  const mundane = await saveThrow(hero, "blast", { roll: rollOf(14), magical: false });
  assert.equal(seen.at(-1), "1d20");
  assert.equal(mundane.success, true);
});

await ok("saveThrow rolls a Foundry Roll when no roll is given", async () => {
  const prior = globalThis.Roll;
  globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = 15; return this; } };
  try {
    const made = await saveThrow(character({ mod: 1 }), "blast");
    assert.deepEqual([made.formula, made.total, made.success], ["1d20 + 1", 15, true]);
    assert.equal(made.roll.formula, "1d20 + 1");
  } finally {
    globalThis.Roll = prior;
  }
});

await ok("a failed save costs the creature nothing here: the throw never lifts a state", async () => {
  const lifted = [];
  const caster = character({ statuses: ["casting", "readied"] });
  caster.toggleStatusEffect = async (id) => { lifted.push(id); };
  const made = await saveThrow(caster, "blast", { roll: async () => ({ total: 1 }), values: VALUES });
  assert.equal(made.success, false);
  assert.deepEqual(lifted, [], "the loss is the applier's, through loseStates");
  assert.deepEqual([...caster.statuses], ["casting", "readied"]);
});

/** A creature carrying one record: an effect whose flag holds save parts. Invented spell and figures. */
const bearing = (parts, { statuses = [], kinds = [], type = "character" } = {}) => ({
  ...(type === "character" ? character({ statuses }) : monster({ statuses })),
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" && kinds.length ? { types: kinds } : undefined),
  appliedEffects: [
    { id: "fxWard", disabled: false, flags: { "acks-extras": { rollMods: { id: "def.spell.testWard", label: "Test Ward", cite: "Test cite", sourceAlignment: "lawful", parts } } } },
  ],
});
const savePart = (value, over = {}) => ({ key: `save${value}`, on: "save", value, provides: ["kw:spellrecord"], ...over });
const source = (kinds = ["undead"], alignment = "chaotic") => ({
  actor: { type: "monster", getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { types: kinds } : undefined), system: { details: { alignment } } },
});

await ok("a save part whose scope applies against the source is a target part named for its record, and lowers the number to roll", () => {
  const saver = bearing([savePart(2, { vsKinds: ["undead"] })]);
  const spec = saveSpec(saver, "blast", { values: VALUES, against: source() });
  assert.equal(spec.target, 12);
  assert.deepEqual(spec.parts.filter((p) => p.side === "target").map((p) => [p.key, p.label, p.value]), [["save2", "Test Ward", 2]]);
  assert.deepEqual(spec.pending, []);
  const outside = saveSpec(saver, "blast", { values: VALUES, against: source(["beast"]) });
  assert.deepEqual([outside.target, outside.parts, outside.pending], [14, [], []], "a scope that fails adds nothing and is not pending");
});

await ok("an undetermined scope, and a scoped part with nothing to resist, go to pending and leave the target alone", () => {
  const saver = bearing([savePart(2, { vsKinds: ["undead"] })]);
  const blank = saveSpec(saver, "blast", { values: VALUES, against: source([]) });
  assert.deepEqual([blank.target, blank.pending], [14, [{ label: "Test Ward", value: 2, when: "source" }]]);
  const none = saveSpec(saver, "blast", { values: VALUES });
  assert.deepEqual([none.target, none.pending], [14, [{ label: "Test Ward", value: 2, when: "source" }]]);
});

await ok("an unscoped save part applies with or without a source, beside the conditions and the same way", () => {
  const saver = bearing([savePart(2)], { statuses: ["fatigued"] });
  assert.equal(saveSpec(saver, "blast", { values: VALUES }).target, 15, "14 + 3 for the penalty, - 2 for the record");
  assert.deepEqual(saveSpec(saver, "blast", { values: VALUES }).parts.filter((p) => p.side === "target").map((p) => p.key), ["fatigued", "save2"]);
  assert.equal(saveSpec(saver, "blast", { values: VALUES, against: source() }).target, 15);
});

await ok("rollMods: false adds none, and conditions: false implies none (the party's throw)", () => {
  const saver = bearing([savePart(2), savePart(3, { key: "scoped", vsKinds: ["undead"], provides: ["kw:other"] })]);
  const off = saveSpec(saver, "blast", { values: VALUES, rollMods: false, against: source() });
  assert.deepEqual([off.target, off.parts, off.pending], [14, [], []]);
  const party = saveSpec(saver, "blast", { values: VALUES, conditions: false, against: source() });
  assert.deepEqual([party.target, party.parts, party.pending], [14, [], []], "formation's call reads the stored number alone");
  const forced = saveSpec(saver, "blast", { values: VALUES, conditions: false, rollMods: true, against: source() });
  assert.equal(forced.target, 11, "asking for the records without the conditions is possible; one record's two parts share its capability, so 14 - 3");
});

await ok("two records' save parts give one figure, and a monster bearer's record reaches its throw", () => {
  const twice = bearing([savePart(2), savePart(4, { key: "bigger" })]);
  assert.equal(saveSpec(twice, "blast", { values: VALUES }).target, 10, "parts of one spell share its capability: the larger");
  const beast = bearing([savePart(3, { vsKinds: ["undead"] })], { type: "monster" });
  assert.equal(saveSpec(beast, "blast", { against: source() }).target, 11);
  assert.equal(saveSpec(character(), "blast", { against: source() }).target, 14, "a creature with no records adds nothing");
});

await ok("saveSpec names the save to the records: a part for another save adds nothing, and a larger one for it never displaces a smaller one for this save", () => {
  const saver = bearing([savePart(5, { saves: ["death"] }), savePart(2, { key: "blastOnly", saves: ["blast"] })]);
  const blast = saveSpec(saver, "blast", { values: VALUES });
  assert.equal(blast.target, 12, "14 - 2: the death-only 5 was narrowed out before the two could compete");
  assert.deepEqual(blast.parts.map((p) => [p.key, p.value]), [["blastOnly", 2]]);
  assert.equal(saveSpec(saver, "death", { values: VALUES }).baseTarget, null, "a creature with no stored target has none to lower");
});

await ok("a gated save part under an occasion is pending until the roll names it; once named and held it lowers the target", () => {
  const gate = { kind: "status", status: "wasted", occasion: true };
  const saver = bearing([savePart(3, { saves: ["death"], gate })], { statuses: ["wasted"] });
  saver.system.saves.death = { value: 12 };
  const waiting = saveSpec(saver, "death", { values: VALUES });
  assert.equal(waiting.target, 12);
  assert.deepEqual(waiting.pending, [{ label: "Test Ward", value: 3, when: "gate" }]);
  const named = saveSpec(saver, "death", { values: VALUES, occasion: "wasted" });
  assert.equal(named.target, 9);
  assert.deepEqual(named.pending, []);
  const other = saveSpec(saver, "blast", { values: VALUES, occasion: "wasted" });
  assert.deepEqual([other.target, other.pending], [14, []], "another save is not this part's");
  const well = bearing([savePart(3, { saves: ["death"], gate })]);
  well.system.saves.death = { value: 12 };
  assert.equal(saveSpec(well, "death", { values: VALUES, occasion: "wasted" }).target, 12, "no status, so the gate is off and adds nothing");
});

await ok("ownRows join the target per saver: a row that holds lowers it, an undecided one is pending, and rollMods: false does not switch them off", () => {
  const rows = [{ label: "Own", cite: "Test cite", value: 2, key: "own" }, { label: "Unknown", value: 1, gate: { kind: "nothingRegistered" } }, { label: "Penalty", value: -1, key: "pen" }];
  const spec = saveSpec(character(), "blast", { values: VALUES, ownRows: rows, rollMods: false });
  assert.equal(spec.target, 13, "14 - 2 + 1");
  assert.deepEqual(spec.parts.map((p) => [p.key, p.label, p.value, p.side]), [["own", "Own (Test cite)", 2, "target"], ["pen", "Penalty", -1, "target"]]);
  assert.deepEqual(spec.pending, [{ label: "Unknown", value: 1, when: "gate" }]);
  assert.equal(saveSpec(character(), "blast", { values: VALUES, ownRows: [] }).target, 14);
});

/** A stored defense band; invented figures throughout. */
const defBand = (b = {}) => ({ damage: [], effects: [], conditions: [], mundane: false, extraordinary: false, silverFlaw: false, note: "", ...b });
const bearsDefenses = (name, bands, base = monster()) => ({
  ...base,
  name,
  getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { defenses: { immunities: defBand(), resistances: defBand(), susceptibilities: defBand(), ...bands } } : undefined),
  items: [],
});
const READ = { fraction: 0.7, saveBonus: 6, cite: null };

await ok("without damage a spec carries no defense: the output is what it was, and has no auto key", () => {
  const warded = bearsDefenses("Zorp", { immunities: defBand({ damage: ["fire"] }) });
  const spec = saveSpec(warded, "blast");
  assert.equal("auto" in spec, false);
  assert.deepEqual(Object.keys(spec), ["save", "kind", "formula", "baseTarget", "target", "parts", "pending", "unpriced"]);
  assert.equal(spec.target, 14);
  assert.deepEqual(spec.parts, []);
});

await ok("damage an immune saver resists is an automatic success, and saveThrow rolls nothing for it", async () => {
  const warded = bearsDefenses("Zorp", { immunities: defBand({ damage: ["fire"] }) });
  const spec = saveSpec(warded, "blast", { damage: { types: ["fire"] }, defenses: { figures: READ } });
  assert.equal(spec.auto.source, "Zorp");
  assert.deepEqual(spec.auto.types, ["fire"]);
  assert.equal(spec.target, 14, "the number stays what it was");
  let rolled = false;
  const throwOne = await saveThrow(warded, "blast", { damage: { types: ["fire"] }, defenses: { figures: READ }, roll: async () => { rolled = true; return { total: 1 }; } });
  assert.deepEqual([throwOne.success, throwOne.total, throwOne.roll, rolled], [true, null, null, false]);
  const noTarget = bearsDefenses("Zorp", { immunities: defBand({ damage: ["fire"] }) }, monster({ saves: {} }));
  assert.equal((await saveThrow(noTarget, "blast", { damage: { types: ["fire"] }, defenses: { figures: READ } })).success, true, "no number to roll against is still a pass for an immunity");
  const other = await saveThrow(warded, "blast", { damage: { types: ["cold"] }, roll: async () => ({ total: 20 }) });
  assert.equal(other.auto, null);
  assert.equal(other.success, true, "damage it is not immune to is rolled as ever");
  assert.equal(other.total, 20);
});

await ok("a resistant saver's imported modifier lowers the target as a labelled part; with none imported the Judge is told", () => {
  const mantled = bearsDefenses("Zorp", { resistances: defBand({ damage: ["fire"] }) });
  const spec = saveSpec(mantled, "blast", { damage: { types: ["fire"] }, defenses: { figures: READ } });
  assert.equal(spec.target, 8, "14 - 6");
  assert.deepEqual(spec.parts.map((p) => [p.key, p.label, p.value, p.side]), [["defense", "Resistant", 6, "target"]]);
  assert.equal(spec.auto, null);
  const unread = saveSpec(mantled, "blast", { damage: { types: ["fire"] }, defenses: { figures: { ...READ, saveBonus: null } } });
  assert.equal(unread.target, 14);
  assert.deepEqual(unread.pending, [{ label: "Resistant", value: null, when: "defense", why: "figure" }]);
  const world = saveSpec(mantled, "blast", { damage: { types: ["fire"] } });
  assert.equal(world.target, 14, "nothing imported in this world: no figure stands in");
  assert.equal(world.pending[0].when, "defense");
});

await ok("a susceptible saver takes its own figure, a mixed case goes to pending, and the defense joins the conditions' parts", () => {
  const frail = bearsDefenses("Zorp", { susceptibilities: defBand({ damage: ["cold"], factor: 2.5, save: -9 }) });
  const spec = saveSpec(frail, "blast", { damage: { types: ["cold"] }, defenses: { figures: READ } });
  assert.equal(spec.target, 23, "14 + 9");
  assert.deepEqual(spec.parts.map((p) => [p.key, p.value]), [["defense", -9]]);
  const mixed = bearsDefenses("Zorp", { susceptibilities: defBand({ damage: ["cold"], factor: 2.5, save: -9 }), resistances: defBand({ damage: ["cold"] }) });
  const held = saveSpec(mixed, "blast", { damage: { types: ["cold"] }, defenses: { figures: READ } });
  assert.deepEqual([held.target, held.pending.map((p) => p.why)], [14, ["mixed"]]);
  const fatigued = bearsDefenses("Zorp", { resistances: defBand({ damage: ["fire"] }) }, monster({ statuses: ["fatigued"] }));
  const both = saveSpec(fatigued, "blast", { values: VALUES, damage: { types: ["fire"] }, defenses: { figures: READ } });
  assert.equal(both.target, 14 + 3 - 6, "the condition's penalty and the defense's bonus");
  assert.deepEqual(both.parts.filter((p) => p.side === "target").map((p) => p.key), ["fatigued", "defense"]);
});

/* --- the steps a condition's effect makes to the save modifier --------------------- */

const { CONDITION_ORDER, CONDITION_KEYS, actorOf, conditionValue, coreConditions, effectOf, implyingEffect } = await import("./core-conditions-fixture.mjs");
const SAVE_MOD = "system.save.mod";
const stepOf = (id) => (CONDITION_KEYS[id].includes(SAVE_MOD) ? conditionValue(id, SAVE_MOD) : 0);
const rollSum = (spec) => spec.parts.filter((p) => p.side === "roll").reduce((sum, p) => sum + p.value, 0);

await ok("a condition's step on the save modifier reaches every save: a character's is named and taken out of the magical modifier, a monster's lowers the target", () => {
  globalThis.CONFIG = { ACKS: { conditions: coreConditions() } };
  try {
    const step = stepOf("hungry");
    const hero = actorOf("character", [effectOf("hungry")], { saveMod: 2 });
    // core folded the step into the modifier the sheet holds
    assert.equal(hero.system.save.mod, 2 + step);
    const magic = saveSpec(hero, "blast");
    assert.deepEqual(magic.parts.map((p) => [p.key, p.value, p.side]), [["saveMod", 2, "roll"], ["hungry", step, "roll"]]);
    assert.equal(rollSum(magic), hero.system.save.mod, "the throw adds the modifier core's roll adds, once");
    const mundane = saveSpec(hero, "blast", { magical: false });
    assert.deepEqual(mundane.parts.map((p) => [p.key, p.value, p.side]), [["hungry", step, "roll"]], "the rest of the modifier is the magical throw's alone");
    assert.equal(mundane.target, 15, "a character's step is a bonus on the roll and leaves the target");
    const beast = actorOf("monster", [effectOf("hungry")]);
    const spec = saveSpec(beast, "death");
    assert.deepEqual(spec.parts.map((p) => [p.key, p.value, p.side]), [["hungry", step, "target"]]);
    assert.deepEqual(spec.parts.map((p) => p.label), ["effect.hungry (hungry)"], "the part is named by its effect, with the condition where the two differ");
    assert.deepEqual(magic.parts.map((p) => p.label).slice(1), ["effect.hungry (hungry)"], "a character's roll part takes the same name");
    assert.deepEqual(saveSpec(actorOf("monster", [effectOf("hungry", { name: "hungry" })]), "death").parts.map((p) => p.label), ["hungry"], "an effect named as its condition is named once");
    assert.equal(spec.target, 14 - step, "a monster's step lowers the number to roll");
    assert.equal(saveSpec(beast, "death", { magical: false }).target, 14 - step, "on a throw that is not against magic too");
    assert.equal(saveSpec(beast, "death", { conditions: false }).target, 14, "the party's throw reads none of it");
    assert.deepEqual(saveSpec(actorOf("monster", [effectOf("hungry", { disabled: true })]), "death").parts, []);
  } finally {
    delete globalThis.CONFIG;
  }
});

await ok("a condition's target part is named by the system's key for an id it ships and by the module's for any other", () => {
  const was = { CONFIG: globalThis.CONFIG, game: globalThis.game };
  globalThis.CONFIG = { ACKS: { conditions: [{ id: "fatigued", name: "qa.name.fatigued" }] } };
  globalThis.game = { i18n: { has: () => true, localize: (key) => `<${key}>` } };
  try {
    const labels = (statuses) => saveSpec(monster({ statuses }), "blast", { values: VALUES }).parts.filter((p) => p.side === "target").map((p) => [p.key, p.label]);
    assert.deepEqual(labels(["fatigued"]), [["fatigued", "<qa.name.fatigued>"]], "a shipped id takes the system's key");
    assert.deepEqual(labels(["cover-waist-high"]), [["cover-waist-high", `<ACKS-LIB.condition.${"cover-waist-high"}>`]], "an id the system does not ship takes the module's");
  } finally {
    for (const [key, value] of Object.entries(was)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});

await ok("a part names the change's type in Foundry's word where the effect sets or multiplies the modifier, and a plain add keeps its name", () => {
  globalThis.CONFIG = { ACKS: { conditions: coreConditions() } };
  // Invented words, so the label proves it is read from Foundry's strings; the condition keeps its id as its name (the mock system's key without its prefix).
  const words = { "EFFECT.CHANGES.TYPES.override": "Replacer", "EFFECT.CHANGES.TYPES.multiply": "Scaler" };
  globalThis.game = { i18n: { localize: (k) => words[k] ?? k.replace("core.", "") } };
  try {
    const set = effectOf("hungry", { name: "Test Ring", changes: [{ key: SAVE_MOD, type: "override", value: 4 }] });
    const add = effectOf("hungry", { name: "Test Band", changes: [{ key: SAVE_MOD, type: "add", value: 2 }] });
    const hero = actorOf("character", [set], { saveMod: 0 });
    assert.deepEqual(saveSpec(hero, "blast", { magical: false }).parts.map((p) => [p.label, p.value, p.side]), [["Test Ring (hungry), Replacer", 4, "roll"]], "a character's roll part");
    const beast = actorOf("monster", [set]);
    assert.deepEqual(saveSpec(beast, "death").parts.map((p) => [p.label, p.value, p.side]), [["Test Ring (hungry), Replacer", 4, "target"]], "a monster's target part");
    assert.deepEqual(saveSpec(actorOf("monster", [add]), "death").parts.map((p) => p.label), ["Test Band (hungry)"], "an adding effect reads as before");
  } finally {
    delete globalThis.CONFIG;
    delete globalThis.game;
  }
});

await ok("each of the eleven's figure is on a saving throw from one place: the sheet's modifier for a character, the step for a monster", () => {
  globalThis.CONFIG = { ACKS: { conditions: coreConditions() } };
  try {
    for (const id of CONDITION_ORDER) {
      const step = stepOf(id);
      const hero = actorOf("character", [effectOf(id)], { saveMod: 2 });
      assert.equal(rollSum(saveSpec(hero, "blast")), hero.system.save.mod, `${id}: magical, the modifier alone`);
      assert.equal(rollSum(saveSpec(hero, "blast", { magical: false })), step, `${id}: mundane, the step alone`);
      assert.equal(saveSpec(hero, "blast").target, 15, `${id}: a character's target`);
      const beast = actorOf("monster", [effectOf(id)]);
      assert.equal(saveSpec(beast, "blast").target, 15 - step, `${id}: a monster's target`);
      assert.equal(rollSum(saveSpec(beast, "blast")), 0, `${id}: a monster's roll`);
    }
  } finally {
    delete globalThis.CONFIG;
  }
});

await ok("a state that brings a condition gives its save step once, alone or beside a hand copy of the condition, in either order", () => {
  globalThis.CONFIG = { ACKS: { conditions: coreConditions() } };
  try {
    const step = stepOf("hungry");
    const beastOf = (...effects) => actorOf("monster", effects);
    assert.equal(saveSpec(beastOf(implyingEffect("starving")), "death").target, 14 - step, "the state alone");
    for (const effects of [[implyingEffect("starving"), effectOf("hungry")], [effectOf("hungry"), implyingEffect("starving")], [implyingEffect("starving"), implyingEffect("underfed")]]) {
      const spec = saveSpec(beastOf(...effects), "death");
      assert.deepEqual(spec.parts.map((p) => [p.key, p.value, p.side]), [["hungry", step, "target"]], "one part, Hungry's");
      assert.equal(spec.target, 14 - step);
    }
    const hero = actorOf("character", [implyingEffect("starving")], { saveMod: 2 });
    assert.deepEqual(saveSpec(hero, "blast", { magical: false }).parts.map((p) => [p.key, p.value, p.side]), [["hungry", step, "roll"]]);
  } finally {
    delete globalThis.CONFIG;
  }
});

await ok("a quality-only immunity needs the damage's quality: mundane damage passes automatically, extraordinary damage is rolled", () => {
  const hollow = bearsDefenses("Zorp", { immunities: defBand({ mundane: true }) });
  assert.ok(saveSpec(hollow, "blast", { damage: { types: ["fire"], extraordinary: false }, defenses: { figures: READ } }).auto);
  assert.equal(saveSpec(hollow, "blast", { damage: { types: ["fire"], extraordinary: true }, defenses: { figures: READ } }).auto, null);
  assert.ok(saveSpec(hollow, "blast", { damage: { types: [], extraordinary: false }, defenses: { figures: READ } }).auto, "untyped mundane damage is covered by a band that lists no type");
  const typedOnly = bearsDefenses("Zorp", { immunities: defBand({ damage: ["fire"] }) });
  assert.equal(saveSpec(typedOnly, "blast", { damage: { types: [] }, defenses: { figures: READ } }).auto, null, "an empty type list is not every type");
});

await ok("a damage whose quality is unstated is pending for a band that waits on it, and normal for one that does not", () => {
  const hollow = bearsDefenses("Zorp", { immunities: defBand({ mundane: true }) });
  const held = saveSpec(hollow, "blast", { damage: { types: ["fire"], extraordinary: null }, defenses: { figures: READ } });
  assert.equal(held.auto, null);
  assert.deepEqual(held.pending.map((p) => [p.when, p.why]), [["defense", "quality"]]);
  assert.equal(held.target, 14);
  const typed = bearsDefenses("Zorp", { immunities: defBand({ damage: ["fire"] }) });
  assert.ok(saveSpec(typed, "blast", { damage: { types: ["fire"] }, defenses: { figures: READ } }).auto, "no quality flag: both qualities");
});

console.log(`\n${passed} passed`);
