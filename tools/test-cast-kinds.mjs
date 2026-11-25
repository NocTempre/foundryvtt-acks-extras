/**
 * Offline tests for the cast's dispatch of row kinds with no amount of their own
 * (`cast-kinds.mjs` and the sites that read it: `cast-spell.mjs` `buildTargets`
 * and the card's rows, `cast-apply.mjs` `applyKind`, `checkApplyRequest` and
 * `undoEntry`, `cast-card.mjs`): a condition row that lifts, a row that slays and
 * a row that destroys a weapon, and the recurring Save a row no save governs
 * rolls none for. Foundry-free; every spell, creature, weapon and condition below
 * is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-kinds.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, user: { targets: new Set() } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "7";
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

const kinds = await import("../scripts/magic/cast-kinds.mjs");
const { placeOf, rowOpens, rowResisted, livesKind, entryOf, kindOf, pickWeapon, chosenWeapon, liftPlan, APPLY_KINDS, stepOf, takesTargets } = kinds;
const { checkApplyRequest, applyOnTarget, applyKind, undoEntry } = await import("../scripts/magic/cast-apply.mjs");
const { buildTargets, castSpellRun, applyNotice } = await import("../scripts/magic/cast-spell.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { registerManagedEffect } = await import("../scripts/lib/managed-effects.mjs");
const { HELD_CONDITION_FLAG } = await import("../scripts/lib/held-condition.mjs");
const { keyedRows } = await import("../scripts/magic/cast-rows.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { pressRecurSave } = await import("../scripts/magic/cast-recur.mjs");
const { conditionChanges } = await import("./core-conditions-fixture.mjs");

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

/* ------------------------------------------------------------------ */
/*  Invented world                                                     */
/* ------------------------------------------------------------------ */

/** A collection the way an actor holds its items and effects: by id, iterable, with `get` and `has`. */
class Coll {
  constructor(list = []) {
    this.map = new Map(list.map((x) => [x.id, x]));
  }
  get(id) {
    return this.map.get(id);
  }
  has(id) {
    return this.map.has(id);
  }
  delete(id) {
    this.map.delete(id);
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
}
/** An invented weapon: equipped or not, destroyed or not. */
const blade = (id, name, { equipped = false, destroyed = false } = {}) => ({
  id,
  name,
  type: "weapon",
  system: { equipped },
  flags: {},
  getFlag: (scope, key) => (scope === "acks-extras" && key === "destroyed" ? destroyed || undefined : undefined),
});
/** An invented effect: its statuses, and the module flags it carries. */
const fx = (id, name, statuses, flags = {}) => ({
  id,
  name,
  statuses: new Set(statuses),
  getFlag: (scope, key) => (scope === "acks-extras" ? flags[key] : undefined),
  toObject: () => ({ _id: id, name, statuses: [...statuses], flags: { "acks-extras": { ...flags } } }),
});
/** An invented creature of the given Hit Dice, carrying items and effects. */
const holder = (uuid, { items = [], effects = [], hd = "3" } = {}) => ({
  uuid,
  name: uuid,
  type: "monster",
  system: { hp: { hd }, saves: { spell: { value: 14 } } },
  items: new Coll(items),
  effects: new Coll(effects),
  getFlag: () => undefined,
});
const tokenOf = (actor, i = 1) => ({ uuid: `Scene.s.Token.k${i}`, name: actor.name, id: `k${i}`, actor });

const save = { category: "spell", effect: "negates" };
const FAIL = { kind: "save", category: "spell", total: 4, target: 14, success: false, parts: [] };
const PASS = { ...FAIL, total: 16, success: true };
const LIFT = { key: "calm", type: "conditionRemove", conditions: ["dread", "daze"] };
const SLAY = { key: "fell", type: "slay", saveEffect: "negates" };
const SMASH = { key: "smash", type: "destroyItem" };
const IGNITE = { key: "lit", type: "ignite", appliesTo: "target", lasts: "rounds", rounds: "1d4" };
const keyed = (rows) => keyedRows(rows);

/* ------------------------------------------------------------------ */
/*  The table                                                          */
/* ------------------------------------------------------------------ */

t("every kind of the dispatch has its card place, its opening rule and its save rule in one table, and a type outside it has none", () => {
  assert.deepEqual(Object.keys(APPLY_KINDS), ["ignite", "conditionGrant", "conditionRemove", "slay", "destroyItem", "illusion", "detect", "light", "dispel", "createObject", "wall", "afflictionDelay", "purify", "seal", "summon"]);
  const applied = Object.keys(APPLY_KINDS).filter((type) => applyKind(type) !== null);
  assert.deepEqual(applied, Object.keys(APPLY_KINDS).filter((type) => type !== "summon"), "each has its writes, and a summoning takes a step in their place");
  assert.equal(applyKind("summon"), null);
  assert.equal(typeof APPLY_KINDS.summon.step, "function");
  assert.equal(applyKind("damage"), null);
  assert.equal(applyKind("toString"), null, "an inherited name is no kind");
  assert.equal(kindOf("heal"), null);
  assert.equal(placeOf({ type: "conditionRemove" }), "row");
  assert.equal(placeOf({ type: "slay" }), "row");
  assert.equal(placeOf({ type: "destroyItem" }), "rowAndLine", "a destroy row carries the line for the weapons no one holds");
  assert.equal(placeOf({ type: "ignite", lasts: "rounds", appliesTo: "target" }), "rowAndLine");
  assert.equal(placeOf({ type: "ignite", lasts: "instant", appliesTo: "target" }), "line");
  assert.equal(placeOf({ type: "damage" }), null);
  assert.deepEqual(["conditionGrant", "ignite"].map(livesKind), [true, true]);
  assert.deepEqual(["conditionRemove", "slay", "destroyItem", "damage"].map(livesKind), [false, false, false, false]);
});

t("a condition row opens only when it names a condition, and a slay and a destroy row open with no figure", () => {
  assert.equal(rowOpens({ type: "conditionRemove", conditions: ["dread"] }), true);
  assert.equal(rowOpens({ type: "conditionRemove", conditions: [] }), false);
  assert.equal(rowOpens({ type: "conditionGrant", conditions: [] }), false);
  assert.equal(rowOpens({ type: "slay" }), true);
  assert.equal(rowOpens({ type: "destroyItem" }), true);
  assert.equal(rowOpens({ type: "damage", total: 5 }), false, "a type outside the table is the caller's");
});

t("a lifting row, an ignite row and a holder with no weapon are resisted by no save; a slay row and a holder with a weapon are", () => {
  const armed = holder("Actor.a", { items: [blade("w1", "Sample blade")] });
  const bare = holder("Actor.b");
  assert.equal(rowResisted(LIFT, armed), false);
  assert.equal(rowResisted(IGNITE, armed), false);
  assert.equal(rowResisted(SLAY, armed), true);
  assert.equal(rowResisted(SMASH, armed), true);
  assert.equal(rowResisted(SMASH, bare), false, "no weapon, no throw");
  assert.equal(rowResisted({ type: "damage" }, bare), true);
  assert.deepEqual(entryOf(SMASH, armed), { item: { id: "w1", name: "Sample blade" } });
  assert.deepEqual(entryOf(SMASH, bare), { item: null });
  assert.deepEqual(entryOf(SLAY, armed), {});
});

t("the new kinds: an affliction's delay is a record kind on a recipient; a purify and a seal are card lines that open no entry; a summoning is a line with its own step", () => {
  const delay = { type: "afflictionDelay", appliesTo: "recipient", lasts: "duration", effects: ["disease"] };
  assert.equal(placeOf(delay), "rowAndLine");
  assert.equal(placeOf({ ...delay, appliesTo: "target" }), "line");
  assert.equal(placeOf({ ...delay, lasts: "instant" }), "line");
  assert.deepEqual([rowOpens(delay), rowResisted(delay, null), livesKind("afflictionDelay")], [true, false, true]);
  for (const type of ["purify", "seal", "summon"]) assert.deepEqual([placeOf({ type }), rowOpens({ type }), livesKind(type), kindOf(type)?.records], ["line", false, false, undefined], type);
  assert.equal(stepOf("heal"), null);
  assert.equal(stepOf("purify"), null);
  const seen = [];
  const ctx = { keyed: { key: "s" } };
  assert.equal(stepOf("summon")(ctx, { summon: (c) => (seen.push(c), "done") }), "done", "the step is run from the cast's own dependencies");
  assert.deepEqual(seen, [ctx]);
});

t("takesTargets: a row that opens an entry for a token counts; a self row, a card line, a later round's row and a summoning do not", () => {
  const take = (...rows) => takesTargets(keyed(rows));
  assert.equal(take(), false, "no rows, no entry");
  assert.equal(take({ type: "heal", roll: "1d6" }), true);
  assert.equal(take({ type: "damage", roll: "1d6", recur: "laterRounds" }), false, "a row that waits for a later round is a line");
  assert.equal(take({ type: "damage", delivery: "melee", recur: "laterRounds" }), true, "a thrown row is thrown at a target");
  assert.equal(take({ type: "heal", roll: "1d6", appliesTo: "self" }), false);
  assert.equal(take({ type: "modifier", target: "ac", appliesTo: "target" }), true);
  assert.equal(take({ type: "ward", appliesTo: "recipient" }), true);
  assert.equal(take(LIFT, SLAY, SMASH), true);
  assert.equal(take({ type: "detect", appliesTo: "area", lasts: "duration" }), false);
  assert.equal(take({ type: "detect", appliesTo: "recipient", lasts: "duration" }), true);
  assert.equal(take({ type: "detect", appliesTo: "recipient", lasts: "instant" }), false);
  assert.equal(take({ type: "purify" }, { type: "seal", lasts: "duration" }, { type: "summon" }, { type: "curse", appliesTo: "target" }), false);
  assert.equal(take(IGNITE, { type: "detect", appliesTo: "area" }), true, "one row that opens one is enough");
});

/* ------------------------------------------------------------------ */
/*  The two selections                                                 */
/* ------------------------------------------------------------------ */

t("the weapon a holder loses is its equipped one, else its first, never one already destroyed, and none for a holder with none", () => {
  const a = blade("w1", "First", {});
  const b = blade("w2", "Second", { equipped: true });
  assert.deepEqual(pickWeapon(holder("Actor.a", { items: [a, b] })), { id: "w2", name: "Second" });
  assert.deepEqual(pickWeapon(holder("Actor.a", { items: [a, blade("w3", "Third")] })), { id: "w1", name: "First" });
  assert.deepEqual(pickWeapon(holder("Actor.a", { items: [blade("w1", "Gone", { equipped: true, destroyed: true }), blade("w3", "Third")] })), { id: "w3", name: "Third" }, "a destroyed weapon is not chosen again");
  assert.equal(pickWeapon(holder("Actor.a", { items: [{ id: "x", name: "Cloak", type: "armor", system: { equipped: true }, getFlag: () => undefined }] })), null, "only a weapon");
  assert.equal(pickWeapon(holder("Actor.a")), null);
  assert.equal(pickWeapon(null), null);
});

t("a condition lifts only where every effect carrying it is plain; a two-status effect is listed beside the plain ones, a managed or held effect holds its whole status back", () => {
  registerManagedEffect("loadout", "ACKS-LIB.managedEffect.ownerLoadout");
  const plain = fx("e1", "Plain dread", ["dread"]);
  const plain2 = fx("e2", "Other dread", ["dread"]);
  const twin = fx("e3", "Twin", ["dread", "other"]);
  const managed = fx("e4", "Managed", ["daze"], { loadout: true });
  const heldFx = fx("e5", "Held", ["dread"], { [HELD_CONDITION_FLAG]: "role" });
  const plainDaze = fx("e6", "Plain daze", ["daze"]);
  const plan = liftPlan([plain, plain2, twin, plainDaze], ["dread", "daze", "absent"]);
  assert.deepEqual(plan.statuses, ["dread", "daze"]);
  assert.deepEqual(plan.lift.map((e) => e.id), ["e1", "e2", "e6"]);
  assert.deepEqual(plan.listed, [{ status: "dread", name: "Twin", reason: "twoStatus" }]);
  const blocked = liftPlan([plain, managed, plainDaze], ["dread", "daze"]);
  assert.deepEqual(blocked.statuses, ["dread"], "the id a managed effect carries is not lifted at all");
  assert.deepEqual(blocked.lift.map((e) => e.id), ["e1"]);
  assert.deepEqual(blocked.listed, [{ status: "daze", name: "Managed", reason: "managed" }]);
  const byHeld = liftPlan([plain, heldFx], ["dread"]);
  assert.deepEqual([byHeld.statuses, byHeld.lift, byHeld.listed], [[], [], [{ status: "dread", name: "Held", reason: "held" }]], "a condition another feature holds is listed, not lifted");
  assert.deepEqual(liftPlan([], ["dread"]), { lift: [], statuses: [], listed: [] });
});

t("an effect whose other statuses are the lifted id's own brought ones lifts as plain; any other two-status effect, and the brought id lifted off its bringer, are listed", () => {
  const impliedOf = (id) => (id === "rush" ? ["muddle"] : []);
  const bringer = fx("e1", "Rush", ["rush", "muddle"]);
  const lone = fx("e2", "Rush alone", ["rush"]);
  const stray = fx("e3", "Rush and more", ["rush", "muddle", "other"]);
  const plan = liftPlan([bringer, lone], ["rush"], impliedOf);
  assert.deepEqual(plan.statuses, ["rush"]);
  assert.deepEqual(plan.lift.map((e) => e.id), ["e1", "e2"]);
  assert.deepEqual(plan.listed, []);
  const mixed = liftPlan([bringer, stray], ["rush"], impliedOf);
  assert.deepEqual(mixed.lift.map((e) => e.id), ["e1"]);
  assert.deepEqual(mixed.listed, [{ status: "rush", name: "Rush and more", reason: "twoStatus" }]);
  const brought = liftPlan([bringer], ["muddle"], impliedOf);
  assert.deepEqual([brought.statuses, brought.lift, brought.listed], [[], [], [{ status: "muddle", name: "Rush", reason: "twoStatus" }]], "lifting the brought id would leave its bringer: listed");
  const unread = liftPlan([bringer], ["rush"]);
  assert.deepEqual([unread.statuses, unread.listed.map((l) => l.reason)], [[], ["twoStatus"]], "with no entry read, two statuses are two statuses");
});

/* ------------------------------------------------------------------ */
/*  The card and the entries a cast opens                              */
/* ------------------------------------------------------------------ */

const caster = { uuid: "Actor.c1", name: "Caster", getRollData: () => ({}) };
let ids = 0;
const cardRows = {
  calm: { type: "conditionRemove", key: "calm", conditions: ["dread", "daze"] },
  fell: { type: "slay", key: "fell", conditions: [] },
  smash: { type: "destroyItem", key: "smash", conditions: [] },
  lit: { type: "ignite", key: "lit", conditions: [] },
};
const build = (tokens, rows) => buildTargets({ tokens, card: { rows: cardRows, casterLevel: { value: 5 } }, rows: keyed(rows), save, situational: null, caster, randomID: () => `x${++ids}`, extras: null });

await ta("each kind opens an entry per target; a destroy entry names the weapon and rolls the target's save only where there is one; a lifting row and an ignite row roll none", async () => {
  const armed = holder("Actor.a", { items: [blade("w1", "Sample blade", { equipped: true })] });
  const bare = holder("Actor.b");
  const lifting = await build([tokenOf(armed)], [LIFT, IGNITE]);
  const [liftTarget] = Object.values(lifting.targets);
  assert.equal(liftTarget.resist, null, "a lifting row is resisted by no save");
  assert.deepEqual(Object.values(lifting.entries).map((e) => e.state), ["pending", "pending"]);
  const slain = await build([tokenOf(armed)], [SLAY]);
  assert.notEqual(Object.values(slain.targets)[0].resist, null, "a slay row is governed by the spell's save");
  const smashed = await build([tokenOf(armed, 1), tokenOf(bare, 2)], [SMASH]);
  const [withBlade, without] = Object.values(smashed.targets);
  assert.equal(typeof withBlade.resist?.total, "number", "the holder of a weapon saves");
  assert.equal(without.resist, null, "a holder with none rolls nothing");
  const [entryA, entryB] = Object.values(smashed.entries);
  assert.deepEqual(entryA, { state: "pending", item: { id: "w1", name: "Sample blade" } });
  assert.deepEqual(entryB, { state: "pending", item: null }, "and its entry says so");
});

await ta("a destroy entry names the weapon the seat picked for that holder, by token uuid; a pick the holder does not carry falls back to its default, and each holder keeps its own", async () => {
  const armed = holder("Actor.a", { items: [blade("w1", "First", { equipped: true }), blade("w2", "Second")] });
  const other = holder("Actor.b", { items: [blade("w3", "Third", { equipped: true }), blade("w4", "Fourth")] });
  const tokens = [tokenOf(armed, 1), tokenOf(other, 2)];
  const made = (items) => buildTargets({ tokens, card: { rows: cardRows, casterLevel: { value: 5 } }, rows: keyed([SMASH]), save, situational: null, caster, randomID: () => `y${++ids}`, extras: null, items }).then((r) => Object.values(r.entries).map((e) => e.item?.id));
  assert.deepEqual(await made({}), ["w1", "w3"], "no pick: each holder's equipped weapon");
  assert.deepEqual(await made({ "Scene.s.Token.k1": "w2", "Scene.s.Token.k2": "w4" }), ["w2", "w4"], "a pick for each holder");
  assert.deepEqual(await made({ "Scene.s.Token.k2": "w1" }), ["w1", "w3"], "another holder's weapon is no pick: the holder's own default stands");
  assert.deepEqual(chosenWeapon(armed, "w2"), { id: "w2", name: "Second" });
  const spent = holder("Actor.c", { items: [blade("w5", "Spent", { destroyed: true }), blade("w6", "Kept")] });
  assert.deepEqual(chosenWeapon(spent, "w5"), { id: "w6", name: "Kept" }, "a destroyed weapon is not a pick");
  assert.equal(chosenWeapon(holder("Actor.d"), "w1"), null);
});

function runDeps() {
  const calls = { posts: [] };
  return {
    calls,
    deps: {
      lookups: { byCookbookId: () => null, fromUuidSync: () => null },
      read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false } }),
      ask: async () => ({ mode: "normal", picks: {} }),
      notify: () => {},
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async () => ({ ok: true }),
      record: async () => {},
      throwRow: async () => null,
      now: () => 10,
      isGM: () => false,
    },
  };
}
const spellOf = (rows) => ({ type: "spell", name: "Testkind", uuid: "Actor.c1.Item.s1", img: "i.png", flags: { "acks-extras": { spell: { effects: rows } } }, parent: { isOwner: true, type: "character", uuid: "Actor.c1" } });

await ta("a cast posts each kind as a section of the card, and the destroy row's line for unheld weapons beside it; an ignite that lasts once is a line", async () => {
  const r = runDeps();
  await castSpellRun(spellOf([LIFT, SLAY, SMASH, { ...IGNITE, lasts: "instant" }]), () => {}, r.deps);
  const card = r.calls.posts[0];
  assert.deepEqual(card.order, ["calm", "fell", "smash"]);
  assert.deepEqual(["calm", "fell", "smash"].map((k) => card.rows[k].type), ["conditionRemove", "slay", "destroyItem"]);
  assert.deepEqual(card.rows.calm.conditions, ["dread", "daze"]);
  assert.equal(card.lines.filter((l) => /line.unheldWeapons/.test(l)).length, 1, "the line says the weapons no one holds are the Judge's");
  assert.equal(card.lines.length, 2, "and the ignite that lasts once stays a line");
});

/* ------------------------------------------------------------------ */
/*  Applying                                                           */
/* ------------------------------------------------------------------ */

const cardFor = (rows, entries, over = {}) => ({
  castId: "c1",
  spellUuid: "Actor.c1.Item.s1",
  spellName: "Testkind",
  casterUuid: "Actor.c1",
  casterLevel: { value: 5 },
  cite: "p. 9",
  save,
  order: rows.map((r) => r.key),
  rows: Object.fromEntries(rows.map((r) => [r.key, { type: r.type, key: r.key, conditions: r.conditions ?? [] }])),
  targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: null } },
  entries,
  ...over,
});

/** The writes an apply makes, recorded against a holder whose effects and items answer them. */
function applyDeps(actor, rows, { hp = 11, over = {} } = {}) {
  const log = { hp: [], lost: [], made: [], entries: {}, lifts: [], destroyed: [], restored: [], cleared: [], deleted: [] };
  const hpTarget = { key: "Scene.s.Token.k1", hp: { value: hp, max: 20 } };
  const deps = {
    messageId: "m1",
    resolve: async () => ({ actor, hpTarget }),
    adjustHp: async (entries, opts) => (log.hp.push({ amount: entries[0].amount, ...opts }), [{ ok: true, before: hp, after: Math.max(0, hp - entries[0].amount) }]),
    lose: async (a, cause) => (log.lost.push(cause), []),
    createRecords: async (a, datas) => (log.made.push(...datas), datas.map((_, i) => `r${log.made.length + i}`)),
    writeEntry: async (id, entry) => {
      log.entries[id] = entry;
    },
    lift: async (a, statuses) => {
      log.lifts.push(statuses);
      for (const e of [...a.effects]) if (statuses.some((s) => e.statuses.has(s)) && e.statuses.size === 1) a.effects.delete(e.id);
    },
    deadStatus: "dead",
    setDestroyed: async (item, on) => log.destroyed.push([item.id, on]),
    clearDestroyed: async (a, id) => log.cleared.push(id),
    restoreRecords: async (a, datas) => log.restored.push(...datas),
    deleteRecords: async (a, rowIds) => log.deleted.push(...rowIds),
    restoreHp: async (results) => log.hp.push({ restored: results.map((r) => r.before) }),
    now: () => 500,
    by: "u1",
    rows: keyed(rows),
    duration: { value: 60, units: "seconds" },
    spell: { uuid: "Actor.c1.Item.s1", name: "Testkind", img: "i.png", id: "def.spell.testKind", cite: "p. 9" },
    ...over,
  };
  return { deps, log };
}

await ta("a lifting row takes the plain effects off through lib's lift, stores them whole, lists what it left, and an Undo puts them back under their own ids", async () => {
  const actor = holder("Actor.h1", { effects: [fx("e1", "Plain dread", ["dread"]), fx("e2", "Twin", ["dread", "other"]), fx("e3", "Plain daze", ["daze"], { rounds: 3 })] });
  const { deps, log } = applyDeps(actor, [LIFT]);
  const card = cardFor([LIFT], { t1_calm: { state: "pending" } });
  const out = await applyOnTarget(card, "t1", [{ rowKey: "calm" }], deps);
  assert.deepEqual(log.lifts, [["dread", "daze"]], "one lift through lib's, by status id");
  const entry = log.entries.t1_calm;
  assert.equal(entry.state, "applied");
  assert.deepEqual(entry.lifted.map((d) => d._id), ["e1", "e3"], "each effect that went, whole");
  assert.deepEqual(entry.lifted[1].flags["acks-extras"], { rounds: 3 }, "with its flags");
  assert.deepEqual(entry.listed, [{ status: "dread", name: "Twin", reason: "twoStatus" }]);
  assert.deepEqual([...actor.effects].map((e) => e.id), ["e2"]);
  assert.equal(out[0].entry, entry);
  assert.equal(entry.rolled, undefined, "no figure was rolled");
  const undone = await undoEntry(entry, card.targets.t1, deps);
  assert.equal(undone.state, "undone");
  assert.deepEqual(log.restored.map((d) => d._id), ["e1", "e3"], "recreated by the effects' own data");
});

await ta("only what is gone from the actor after the lift is stored, so a lift that failed for one effect leaves it out of Undo", async () => {
  const actor = holder("Actor.h1", { effects: [fx("e1", "Goes", ["dread"]), fx("e2", "Stays", ["dread"])] });
  const { deps, log } = applyDeps(actor, [LIFT], { over: { lift: async (a) => void a.effects.delete("e1") } });
  await applyOnTarget(cardFor([LIFT], { t1_calm: { state: "pending" } }), "t1", [{ rowKey: "calm" }], deps);
  assert.deepEqual(log.entries.t1_calm.lifted.map((d) => d._id), ["e1"]);
});

await ta("a lifting row with nothing to lift writes an applied entry that says so and calls no lift", async () => {
  const actor = holder("Actor.h1", { effects: [fx("e9", "Other", ["rest"])] });
  const { deps, log } = applyDeps(actor, [LIFT]);
  await applyOnTarget(cardFor([LIFT], { t1_calm: { state: "pending" } }), "t1", [{ rowKey: "calm" }], deps);
  assert.deepEqual(log.lifts, []);
  assert.deepEqual([log.entries.t1_calm.state, log.entries.t1_calm.lifted, log.entries.t1_calm.listed], ["applied", [], []]);
});

await ta("a slay row takes the hit points to zero in one write with no defense stage, leaves a dead record the row keyed, and an Undo restores both", async () => {
  const actor = holder("Actor.h1");
  const { deps, log } = applyDeps(actor, [SLAY], { over: { defenses: () => ({ sources: [{ band: "immune", types: ["fire"] }], figures: {} }) } });
  const card = cardFor([SLAY], { t1_fell: { state: "pending" } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: FAIL } } });
  await applyOnTarget(card, "t1", [{ rowKey: "fell" }], deps);
  assert.deepEqual(log.hp, [{ amount: 11, mode: "damage", floorAtZero: true }], "the hit points it had, and no defense moved that");
  assert.deepEqual(log.lost, ["save"], "the loss path of a failed save runs first");
  assert.equal(log.made.length, 1);
  assert.deepEqual(log.made[0].statuses, ["dead"]);
  assert.equal(spellEffectOf(log.made[0]).rowKey, "fell");
  assert.equal(log.made[0].flags["acks-extras"].spellEffect.startTime, undefined, "untimed: it ends only by Undo or by hand");
  const entry = log.entries.t1_fell;
  assert.deepEqual([entry.state, entry.saved, entry.applied, entry.before, entry.after, entry.recordIds], ["applied", false, 11, 11, 0, ["r1"]]);
  const undone = await undoEntry(entry, card.targets.t1, deps);
  assert.equal(undone.state, "undone");
  assert.deepEqual(log.hp.at(-1), { restored: [11] });
  assert.deepEqual(log.deleted, ["r1"]);
});

await ta("a slay row's dead record is the effect the builder returns for the dead status, and a lifting row reads which statuses an entry brings from its dependency", async () => {
  const built = { name: "core.dead", statuses: ["dead"], system: { changes: conditionChanges("blessed") } };
  const { deps, log } = applyDeps(holder("Actor.h1"), [SLAY], { over: { conditionData: async (id) => (assert.equal(id, "dead"), built) } });
  await applyOnTarget(cardFor([SLAY], { t1_fell: { state: "pending" } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: FAIL } } }), "t1", [{ rowKey: "fell" }], deps);
  assert.deepEqual(log.made[0].statuses, ["dead"]);
  assert.deepEqual(log.made[0].system.changes, conditionChanges("blessed"));
  assert.equal(Object.hasOwn(log.made[0], "_id"), false);
  const rush = { ...LIFT, conditions: ["rush"] };
  const standing = () => holder("Actor.h1", { effects: [fx("e1", "Rush", ["rush", "muddle"])] });
  const reads = applyDeps(standing(), [rush], { over: { impliedStatuses: (id) => (id === "rush" ? ["muddle"] : []) } });
  await applyOnTarget(cardFor([rush], { t1_calm: { state: "pending" } }), "t1", [{ rowKey: "calm" }], reads.deps);
  assert.deepEqual([reads.log.lifts, reads.log.entries.t1_calm.listed], [[["rush"]], []], "the bringer is plain to the id it brings");
  const blind = applyDeps(standing(), [rush]);
  await applyOnTarget(cardFor([rush], { t1_calm: { state: "pending" } }), "t1", [{ rowKey: "calm" }], blind.deps);
  assert.deepEqual([blind.log.lifts, blind.log.entries.t1_calm.listed], [[], [{ status: "rush", name: "Rush", reason: "twoStatus" }]]);
});

await ta("a slay row on a creature already at zero writes no hit points but still marks it dead; a passed save that negates writes nothing; a half effect, or a target with no hit points, is the Judge's", async () => {
  const dying = applyDeps(holder("Actor.h1"), [SLAY], { hp: 0 });
  await applyOnTarget(cardFor([SLAY], { t1_fell: { state: "pending" } }), "t1", [{ rowKey: "fell" }], dying.deps);
  assert.deepEqual(dying.log.hp, [], "a set to zero would raise a creature already below it");
  assert.deepEqual([dying.log.made.length, dying.log.entries.t1_fell.applied], [1, 0]);
  const passed = applyDeps(holder("Actor.h1"), [SLAY]);
  await applyOnTarget(cardFor([SLAY], { t1_fell: { state: "pending" } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: PASS } } }), "t1", [{ rowKey: "fell" }], passed.deps);
  assert.deepEqual([passed.log.hp, passed.log.made, passed.log.entries.t1_fell.saved, passed.log.entries.t1_fell.applied], [[], [], true, 0]);
  const half = applyDeps(holder("Actor.h1"), [{ ...SLAY, saveEffect: "half" }]);
  await applyOnTarget(cardFor([SLAY], { t1_fell: { state: "pending" } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: PASS } } }), "t1", [{ rowKey: "fell" }], half.deps);
  assert.equal(half.log.entries.t1_fell.state, "judge");
  const none = applyDeps(holder("Actor.h1"), [SLAY], { over: { resolve: async () => ({ actor: holder("Actor.h1"), hpTarget: null }) } });
  await applyOnTarget(cardFor([SLAY], { t1_fell: { state: "pending" } }), "t1", [{ rowKey: "fell" }], none.deps);
  assert.equal(none.log.entries.t1_fell.state, "judge");
});

const armedCard = (entries, extra = {}) => cardFor([SMASH], entries, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: FAIL }, t2: { uuid: "Actor.h2", name: "Second", resist: FAIL } }, ...extra });
const named = { id: "w1", name: "Sample blade" };

await ta("a failed save marks the weapon the entry names destroyed and Undo clears it; a passed save leaves it; a holder with none, or a weapon gone since, writes an entry that destroyed nothing", async () => {
  const actor = holder("Actor.h1", { items: [blade("w1", "Sample blade", { equipped: true })] });
  const failed = applyDeps(actor, [SMASH]);
  await applyOnTarget(armedCard({ t1_smash: { state: "pending", item: named } }), "t1", [{ rowKey: "smash" }], failed.deps);
  assert.deepEqual(failed.log.destroyed, [["w1", true]]);
  assert.deepEqual(failed.log.entries.t1_smash.destroyed, named);
  const undone = await undoEntry(failed.log.entries.t1_smash, { uuid: "Actor.h1" }, failed.deps);
  assert.equal(undone.state, "undone");
  assert.deepEqual(failed.log.cleared, ["w1"]);
  const passedCard = armedCard({ t1_smash: { state: "pending", item: named } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: PASS } } });
  const passed = applyDeps(actor, [SMASH]);
  await applyOnTarget(passedCard, "t1", [{ rowKey: "smash" }], passed.deps);
  assert.deepEqual([passed.log.destroyed, passed.log.entries.t1_smash.saved, passed.log.entries.t1_smash.destroyed], [[], true, undefined]);
  const bare = applyDeps(holder("Actor.h1"), [SMASH]);
  await applyOnTarget(armedCard({ t1_smash: { state: "pending", item: null } }), "t1", [{ rowKey: "smash" }], bare.deps);
  assert.deepEqual([bare.log.destroyed, bare.log.entries.t1_smash.state, bare.log.entries.t1_smash.item], [[], "applied", null]);
  const gone = applyDeps(holder("Actor.h1", { items: [blade("w1", "Sample blade", { destroyed: true })] }), [SMASH]);
  await applyOnTarget(armedCard({ t1_smash: { state: "pending", item: named } }), "t1", [{ rowKey: "smash" }], gone.deps);
  assert.deepEqual([gone.log.destroyed, gone.log.entries.t1_smash.state, gone.log.entries.t1_smash.why], [[], "refused", "badItem"], "a mark the cast did not make is never cleared by its Undo");
  const halved = applyDeps(actor, [{ ...SMASH, saveEffect: "half" }]);
  await applyOnTarget(armedCard({ t1_smash: { state: "pending", item: named } }, { targets: { t1: { uuid: "Actor.h1", name: "Holder", resist: PASS } } }), "t1", [{ rowKey: "smash" }], halved.deps);
  assert.equal(halved.log.entries.t1_smash.state, "judge");
});

await ta("a destroy row takes no more weapons than the spell's count across the whole cast, and a blank count caps nothing", async () => {
  const actor = holder("Actor.h2", { items: [blade("w2", "Second blade")] });
  const spent = { t1_smash: { state: "applied", item: named, destroyed: named }, t2_smash: { state: "pending", item: { id: "w2", name: "Second blade" } } };
  const capped = applyDeps(actor, [SMASH], { over: { itemCap: 1 } });
  await applyOnTarget(armedCard(spent), "t2", [{ rowKey: "smash" }], capped.deps);
  assert.deepEqual([capped.log.destroyed, capped.log.entries.t2_smash.state, capped.log.entries.t2_smash.why], [[], "refused", "overCount"]);
  const room = applyDeps(actor, [SMASH], { over: { itemCap: 2 } });
  await applyOnTarget(armedCard(spent), "t2", [{ rowKey: "smash" }], room.deps);
  assert.deepEqual(room.log.destroyed, [["w2", true]]);
  const blank = applyDeps(actor, [SMASH], { over: { itemCap: null } });
  await applyOnTarget(armedCard(spent), "t2", [{ rowKey: "smash" }], blank.deps);
  assert.deepEqual(blank.log.destroyed, [["w2", true]], "no figure read, no cap");
});

/* ------------------------------------------------------------------ */
/*  The relay                                                          */
/* ------------------------------------------------------------------ */

const relayWorld = (rows, card, over = {}) => ({ message: { authorId: "p1" }, card, ownsCaster: true, spellOfCaster: true, rows: keyed(rows), resist: null, boundsOf: () => null, ...over });
const ask = (rowKey) => ({ requestUserId: "p1", messageId: "m", targetKey: "t1", resist: null, entries: [{ rowKey }] });

t("the relay takes a lifting row and a slay row with no amount at all, where an unhandled type would meet the amount's bounds", () => {
  const card = cardFor([LIFT, SLAY], { t1_calm: { state: "pending" }, t1_fell: { state: "pending" } });
  assert.deepEqual(checkApplyRequest(ask("calm"), relayWorld([LIFT, SLAY], card)), { ok: true });
  assert.deepEqual(checkApplyRequest(ask("fell"), relayWorld([LIFT, SLAY], card)), { ok: true });
  assert.equal(checkApplyRequest(ask("calm"), relayWorld([LIFT], cardFor([LIFT], { t1_calm: { state: "applied" } }))).refused, "applied", "an entry written once is not written twice");
});

t("the relay holds a destroy entry to the weapon the card names for the holder: a picked weapon the holder still carries stands, one it lost is refused, and a card that names none is refused where the holder now carries one", () => {
  const armed = holder("Actor.h1", { items: [blade("w1", "Sample blade", { equipped: true }), blade("w2", "Second")] });
  const second = { id: "w2", name: "Second" };
  const card = cardFor([SMASH], { t1_smash: { state: "pending", item: second } });
  const world = (actor) => relayWorld([SMASH], card, { weaponOf: (id) => chosenWeapon(actor, id) });
  assert.deepEqual(checkApplyRequest(ask("smash"), world(armed)), { ok: true }, "the seat's pick is not the default, and still stands");
  const lost = holder("Actor.h1", { items: [blade("w1", "Sample blade", { equipped: true })] });
  assert.equal(checkApplyRequest(ask("smash"), world(lost)).refused, "badItem", "the picked weapon left the holder, so the default (another weapon) is not the one named");
  const bare = cardFor([SMASH], { t1_smash: { state: "pending", item: null } });
  assert.equal(checkApplyRequest(ask("smash"), relayWorld([SMASH], bare, { weaponOf: (id) => chosenWeapon(armed, id) })).refused, "badItem", "a weapon taken up since the cast");
});

t("the relay refuses a destroy entry as badItem when the weapon the target would now lose is not the one the card names, and takes it when it is or when it cannot read the target", () => {
  const card = cardFor([SMASH], { t1_smash: { state: "pending", item: named } });
  const at = (pick) => relayWorld([SMASH], card, { weaponOf: () => pick });
  assert.deepEqual(checkApplyRequest(ask("smash"), at(named)), { ok: true });
  assert.equal(checkApplyRequest(ask("smash"), at({ id: "w9", name: "Other" })).refused, "badItem", "a weapon changed hands since the cast");
  assert.equal(checkApplyRequest(ask("smash"), at(null)).refused, "badItem", "the weapon is gone");
  assert.deepEqual(checkApplyRequest(ask("smash"), relayWorld([SMASH], card)), { ok: true }, "no way to read the target is no refusal");
  const bare = cardFor([SMASH], { t1_smash: { state: "pending", item: null } });
  assert.deepEqual(checkApplyRequest(ask("smash"), relayWorld([SMASH], bare, { weaponOf: () => null })), { ok: true });
  assert.equal(checkApplyRequest(ask("smash"), relayWorld([SMASH], bare, { weaponOf: () => named })).refused, "badItem", "a weapon taken up since the cast, with no save rolled for it");
});

/* ------------------------------------------------------------------ */
/*  The card's lines                                                   */
/* ------------------------------------------------------------------ */

const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);
const rowOf = (view, i = 0) => view.sections[0].rows[i];

t("the card names the weapon before a destroy entry is applied, what it destroyed or kept after, and offers a GM Undo only where a mark was made", () => {
  const view = (entry) => castCardView(cardFor([SMASH], { t1_smash: entry }), { isGM: true, canPress: true, ownsTarget: () => true }, loc);
  assert.match(rowOf(view({ state: "pending", item: named })).detail, /detail\.weapon\|\{"name":"Sample blade"\}/);
  const done = rowOf(view({ state: "applied", saved: false, item: named, destroyed: named, recordIds: [] }));
  assert.match(done.detail, /detail\.destroyed\|\{"name":"Sample blade"\}/);
  assert.deepEqual(done.actions.map((a) => a.action), ["magicCastUndo"]);
  assert.equal(done.actions[0].tooltip, "tip.undoDestroyed");
  const kept = rowOf(view({ state: "applied", saved: true, item: named, recordIds: [] }));
  assert.match(kept.detail, /detail\.weaponKept/);
  assert.deepEqual(kept.actions, [], "nothing was written to undo");
  assert.match(rowOf(view({ state: "applied", saved: null, item: null, recordIds: [] })).detail, /detail\.noWeapon/);
  const refused = rowOf(view({ state: "refused", item: named, why: "overCount" }));
  assert.match(refused.detail, /detail\.why\.overCount/);
  assert.equal(refused.outcome, "state.refused");
});

t("the card tells what a lifting row lifted and left, with the reasons, and a slay's hit points and death; a GM may Undo each", () => {
  const lift = castCardView(cardFor([LIFT], { t1_calm: { state: "applied", saved: null, lifted: [{ _id: "e1", name: "Plain dread" }], listed: [{ status: "dread", name: "Twin", reason: "twoStatus" }], recordIds: [] } }), { isGM: true, canPress: true, ownsTarget: () => true }, loc);
  const line = rowOf(lift);
  assert.match(line.detail, /detail\.lifted\|\{"names":"Plain dread"\}/);
  assert.match(line.detail, /detail\.listed\|\{"names":"Twin \(detail\.reason\.twoStatus\)"\}/);
  assert.deepEqual(line.actions.map((a) => [a.action, a.tooltip]), [["magicCastUndo", "tip.undoLifted"]]);
  const none = rowOf(castCardView(cardFor([LIFT], { t1_calm: { state: "applied", saved: null, lifted: [], listed: [], recordIds: [] } }), { isGM: true, canPress: true, ownsTarget: () => true }, loc));
  assert.match(none.detail, /detail\.nothingToLift/);
  assert.deepEqual(none.actions, []);
  const slain = rowOf(castCardView(cardFor([SLAY], { t1_fell: { state: "applied", saved: false, applied: 11, before: 11, after: 0, recordIds: ["r1"] } }), { isGM: true, canPress: true, ownsTarget: () => true }, loc));
  assert.match(slain.detail, /detail\.slain/);
  assert.match(slain.tooltipText, /tip\.slayHp\|\{"before":11,"after":0\}/);
  assert.match(slain.tooltipText, /tip\.cite\|\{"cite":"p\. 9"\}/, "with the page");
  assert.deepEqual(slain.actions.map((a) => a.action), ["magicCastUndo"]);
});

await ta("a Player whose press the relay refuses as badItem is told the weapon changed and that the Judge applies it; any other refusal keeps the pending notice", async () => {
  assert.deepEqual(["badItem", "noGm", "badAmount", undefined].map(applyNotice), ["badItem", "noGm", "pendingApply", "pendingApply"]);
  const { readFileSync } = await import("node:fs");
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  for (const key of ["notice.badItem", "line.unheldWeapons", "row.conditionRemove", "row.slay", "row.destroyItem", "tip.slayHp", "tip.undoLifted", "tip.undoDestroyed", "detail.weapon", "detail.destroyed", "detail.weaponKept", "detail.noWeapon", "detail.lifted", "detail.listed", "detail.nothingToLift", "detail.slain", "detail.reason.twoStatus", "detail.reason.managed", "detail.reason.held", "detail.why.badItem", "detail.why.overCount", "detail.why.failed"]) assert.ok(lang[`ACKS-MAGIC.cast.${key}`], key);
});

/* ------------------------------------------------------------------ */
/*  The recurring Save of a row no save governs                         */
/* ------------------------------------------------------------------ */

await ta("a recurring Save press rolls no save for a row no save governs and sends none, and the relay holds that to the stored resist", async () => {
  const sent = [];
  globalThis.game.socket = { emit: (_c, message) => sent.push(message) };
  globalThis.game.users = { get: () => ({ id: "p1", isGM: true }), activeGM: { id: "gm" } };
  globalThis.game.user = { id: "p1", isGM: false, targets: new Set() };
  const free = { key: "choke", type: "conditionGrant", conditions: ["dread"], recur: "eachRound", recurAt: "casterTurn", recurSave: "cast", saveEffect: "none", lasts: "duration" };
  const target = { uuid: "Scene.s.Token.k1", name: "Held", id: "k1", documentName: "Token", actor: holder("Actor.h1") };
  globalThis.fromUuid = async (u) => (u === target.uuid ? target : null);
  globalThis.fromUuidSync = (u) => (u === "Actor.c1.Item.s1" ? spell : u === "Actor.c1" ? casterDoc : u === target.uuid ? target : null);
  const casterDoc = { uuid: "Actor.c1", name: "Caster", type: "character", items: new Coll([]), effects: new Coll([]), getRollData: () => ({}), getFlag: () => undefined, system: {} };
  const spell = { ...spellOf([free]), parent: casterDoc };
  const card = cardFor([free], { t1_choke: { state: "pending" } }, { spellUuid: spell.uuid, targets: { t1: { uuid: target.uuid, name: "Held", resist: null } }, picks: {}, mode: "normal", casterTokenUuid: null, situational: null, duration: { none: "noDuration" } });
  Object.assign(spell, { flags: { "acks-extras": { spell: { effects: [free], duration: { shape: "fixed", value: 1, unit: "minutes" } } } } });
  const message = { id: "m2", flags: { "acks-extras": { castCard: card } } };
  await pressRecurSave(message, { target: "t1", row: "choke" });
  assert.equal(sent.length, 1, "the press goes to the GM's client");
  assert.equal(sent[0].payload.resist, null, "no save was rolled");
  assert.deepEqual(sent[0].payload.entries, [{ rowKey: "choke" }]);
  const world = relayWorld([free], card, { ownsTarget: true, boundsOf: () => ({ min: 1, max: 6 }) });
  assert.deepEqual(checkApplyRequest({ ...ask("choke"), resist: sent[0].payload.resist, entries: [{ rowKey: "choke" }] }, world), { ok: true }, "the relay's stored resist is blank too");
});

await ta("a purify, a seal and a recipient-aimed delay apply through the dispatch: the first two write nothing, the delay writes the recipient's record by its lasting", async () => {
  const rows = [
    { key: "clean", type: "purify" },
    { key: "shut", type: "seal", lasts: "duration" },
    { key: "hold", type: "afflictionDelay", appliesTo: "recipient", effects: ["disease"], lasts: "duration" },
  ];
  const actor = holder("Actor.h1");
  const { deps, log } = applyDeps(actor, rows);
  const entries = Object.fromEntries(rows.map((r) => [`t1_${r.key}`, { state: "pending" }]));
  await applyOnTarget(cardFor(rows, entries), "t1", rows.map((r) => ({ rowKey: r.key })), deps);
  assert.deepEqual(["clean", "shut", "hold"].map((k) => log.entries[`t1_${k}`]?.state), ["applied", "applied", "applied"]);
  assert.deepEqual(log.entries.t1_clean.recordIds, []);
  assert.deepEqual(log.entries.t1_shut.recordIds, []);
  assert.equal(log.made.length, 1, "only the delay writes a record");
  const record = spellEffectOf(log.made[0]);
  assert.deepEqual([record.role, record.rowKey, record.duration], ["recipient", "hold", { value: 60, units: "seconds" }]);
  assert.deepEqual(log.hp, [], "no hit points move");
});

console.log(`\n${n} cast-kinds tests passed`);
