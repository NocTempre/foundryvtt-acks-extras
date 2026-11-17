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
  assert.deepEqual(castGateExtrasOf(bare, lookups), { target: { model: "creature", hdCap: flat(4) }, save: { exemptBelowHd: flat(2) } });
  assert.deepEqual(castGateExtrasOf(bare, NO_TWIN), { target: null, save: { exemptBelowHd: flat(2) } });
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

console.log(`${n} checks passed`);
