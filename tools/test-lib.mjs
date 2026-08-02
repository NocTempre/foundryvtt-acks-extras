/**
 * Pure-logic tests (Foundry-free) for acks-lib, run via `npm test`. Covers the
 * vocab enums + the LevelValue resolver. The Foundry field-builders (fields.mjs)
 * need a Foundry runtime and are exercised by consuming modules, not here.
 */
import assert from "node:assert/strict";
import * as vocab from "../scripts/lib/vocab.mjs";
import { cleanDelta, isDerivedEffect, memberName, migrateGroupSource, nextOrdinal, platoonCapacity, sizeFromEcology } from "../scripts/lib/group-logic.mjs";
import { chooseAxes, mergePatch, resolveActor, rollDie, rollMenu, rollOption, seededRng } from "../scripts/lib/template-logic.mjs";
import { attackTerms, termTotal, resolveAttack, legacyCoreResolves } from "../scripts/lib/attack-logic.mjs";
import {
  buildTransferPayload,
  coinTotalGC,
  emptyMoneyDeletes,
  expandContainerClosure,
  groupByOwner,
  planStackMerge,
  quantityOf,
  splitSpec,
} from "../scripts/lib/storage-logic.mjs";

const { resolveLevelValue: R, choicesOf } = vocab;
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

t("choicesOf maps {key:{label}} -> {key:label}", () => {
  assert.deepEqual(choicesOf(vocab.ROLL_TYPES), { result: "=", above: "≥", below: "≤" });
});

t("enums are non-empty and label-shaped", () => {
  for (const key of ["DAMAGE_TYPES", "MOVEMENT_TYPES", "VISION_TYPES", "SENSE_TYPES", "EFFECT_TYPES", "MODIFIER_TARGETS"]) {
    const e = vocab[key];
    assert.ok(e && Object.keys(e).length > 0, `${key} present`);
    for (const v of Object.values(e)) assert.equal(typeof v.label, "string", `${key} entries have labels`);
  }
});

t("DAMAGE_TYPES mirrors the acks-monsters value set", () => {
  assert.deepEqual(Object.keys(vocab.DAMAGE_TYPES), [
    "acidic", "arcane", "bludgeoning", "cold", "electrical", "fire", "luminous",
    "necrotic", "piercing", "poisonous", "seismic", "slashing", "varies",
  ]);
});

t("relational effect vocabulary is present", () => {
  for (const k of ["requires", "grants", "modifies", "limitation", "proficiencyGrant"]) {
    assert.ok(vocab.EFFECT_TYPES[k], `EFFECT_TYPES.${k}`);
  }
  assert.deepEqual(Object.keys(vocab.EFFECT_MODES), ["add", "replace", "set"]);
  assert.deepEqual(Object.keys(vocab.PROFICIENCY_BREADTH), ["unrestricted", "broad", "narrow", "restricted"]);
});

t("resolveLevelValue: flat", () => {
  assert.equal(R(5, 9), 5);
  assert.equal(R({ kind: "flat", flat: 3 }, 20), 3);
});

t("resolveLevelValue: perLevel (18+, -1/level)", () => {
  const lv = { kind: "perLevel", base: 18, per: -1 };
  assert.equal(R(lv, 1), 18);
  assert.equal(R(lv, 5), 14);
  assert.equal(R(lv, 1), R(lv, 0)); // level floored at 1
});

t("resolveLevelValue: breakpoints (+1/+2/+3 @1/7/13)", () => {
  const lv = { breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 7, value: 2 }, { atLevel: 13, value: 3 }] };
  assert.equal(R(lv, 1), 1);
  assert.equal(R(lv, 6), 1);
  assert.equal(R(lv, 7), 2);
  assert.equal(R(lv, 13), 3);
});

t("resolveLevelValue: round up — half class level, as the page prints it", () => {
  // Lay on Hands: "a bonus to their Mortal Wounds throw of one-half his class
  // level (round up)". Unrounded this reads 2.5 at 5th level, a number the
  // rule never produces.
  const lv = { kind: "perLevel", base: 0.5, per: 0.5, round: "up" };
  assert.equal(R(lv, 1), 1);
  assert.equal(R(lv, 4), 2);
  assert.equal(R(lv, 5), 3);
  assert.equal(R(lv, 14), 7);
  assert.equal(R({ ...lv, round: "down" }, 5), 2);
  assert.equal(R({ ...lv, round: "" }, 5), 2.5, "no rounding leaves the fraction alone");
});

t("resolveLevelValue: rounding also applies to a ladder", () => {
  const lv = { breakpoints: [{ atLevel: 1, value: 1.5 }], round: "up" };
  assert.equal(R(lv, 3), 2);
});

t("ATTRIBUTES key on the core system's own score paths", () => {
  // A consumer must be able to read system.scores[key].mod straight from the
  // key; ACKS II's WIL is the system's `wis`, and the label says so.
  assert.deepEqual(Object.keys(vocab.ATTRIBUTES), ["str", "int", "wis", "dex", "con", "cha"]);
  assert.equal(vocab.ATTRIBUTES.wis.label, "WIL");
  assert.ok(vocab.EFFECT_TYPES.attributeSubstitution, "the substitution primitive is a real effect type");
});

t("resolveLevelValue: progression defers to external table", () => {
  assert.equal(R({ kind: "progression", as: "thief", atLevel: "full" }, 5), null);
});

t("resolveLevelValue: nullish is null", () => {
  assert.equal(R(null, 3), null);
  assert.equal(R(undefined, 3), null);
});

t("resolveLevelValue: conditional keys on a scale, not level", () => {
  // "counts as 1 power at Arcane Value 1-2, 2 at Arcane Value 3-4"
  const lv = { on: "arcaneValue", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }] };
  assert.equal(R(lv, 14, { arcaneValue: 1 }), 1);
  assert.equal(R(lv, 1, { arcaneValue: 4 }), 2);
  assert.equal(R(lv, 9), null); // scale not supplied — caller's to provide
  assert.equal(R(lv, 9, { arcaneValue: 0 }), null); // below the first rung
});

t("conversionTip fills {name}; renamed is marked, not silent", () => {
  assert.equal(vocab.conversionTip("renamed", "Detect Traps"), "Detect Traps has been renamed for ACKS II.");
  assert.equal(vocab.conversionTip("renamed"), "This content has been renamed for ACKS II.");
  assert.ok(vocab.CONVERSION_STATUS.renamed.icon, "renamed carries an icon");
  for (const s of Object.values(vocab.CONVERSION_STATUS)) {
    assert.ok(s.icon && s.severity && s.tip, "every status has icon+severity+tip");
  }
  assert.equal(vocab.conversionTip("nonesuch", "X"), "");
});

t("resolveReroll: better/worse follow the throw's direction", () => {
  const RR = vocab.resolveReroll;
  // roll-high (attack / proficiency throw): better is the maximum
  assert.equal(RR([7, 15], "better", "above"), 15);
  assert.equal(RR([7, 15], "worse", "above"), 7);
  // roll-low (measured against a ceiling): better is the minimum
  assert.equal(RR([7, 15], "better", "below"), 7);
  assert.equal(RR([7, 15], "worse", "below"), 15);
  assert.equal(RR([7, 15, 3], "latest"), 3); // no choice — the reroll stands
  assert.equal(RR([], "better"), null);
  assert.equal(RR([4, NaN, 12], "better", "above"), 12); // junk ignored
});

t("rerollTotal: times counts EXTRA rolls and defaults to one", () => {
  assert.equal(vocab.rerollTotal({}), 2); // "roll twice" needs no field
  assert.equal(vocab.rerollTotal({ times: 2 }), 3);
  assert.equal(vocab.rerollTotal({ times: 0 }), 1);
  assert.equal(vocab.rerollTotal({ times: -5 }), 1);
});

t("capabilities: a kw: gate catches every ability providing it", () => {
  const { satisfies, satisfiesAll, capabilityForId } = vocab;
  assert.equal(capabilityForId("def.prof.sensingEvil"), "kw:sensingevil");
  // The thief SKILL, not the proficiency — a gate naming the proficiency id
  // would miss it, a capability gate does not.
  const held = [{ id: "def.skill.searching", provides: [] }, { id: "def.power.alertness", provides: [] }];
  assert.equal(satisfies(held, "kw:searching"), true, "own id implies its capability");
  assert.equal(satisfies(held, "def.prof.searching"), false, "exact id is still exact");
  assert.equal(satisfies(held, "def.skill.searching"), true);
  // An alias declares the capability it shares with its target.
  const viaAlias = [{ id: "def.power.discernevil", provides: ["kw:sensingevil"] }];
  assert.equal(satisfies(viaAlias, "kw:sensingevil"), true);
  assert.equal(satisfiesAll(held, ["kw:searching", "kw:alertness"]), true);
  assert.equal(satisfiesAll(held, ["kw:searching", "kw:nosuch"]), false);
  assert.equal(satisfies(held, ""), true, "no gate is satisfied trivially");
});

t("capabilities: same capability twice does not stack", () => {
  const groups = vocab.nonStackingGroups([
    { id: "def.power.ageless", provides: ["kw:longeval"] },
    { id: "def.power.longeval", provides: [] },
    { id: "def.prof.alertness", provides: [] },
  ]);
  assert.deepEqual(groups, { "kw:longeval": ["def.power.ageless", "def.power.longeval"] });
  assert.deepEqual(vocab.nonStackingGroups([{ id: "def.prof.alertness", provides: [] }]), {}, "one of a kind stacks fine");
});

t("a rank ladder resolves like a level ladder, on its own scale", () => {
  // Animal Husbandry: diagnose on 11+ at one rank, 7+ at two, 3+ at three.
  const target = { kind: "conditional", on: "rank", breakpoints: [
    { atLevel: 1, value: 11 }, { atLevel: 2, value: 7 }, { atLevel: 3, value: 3 },
  ] };
  assert.equal(R(target, 1, { rank: 1 }), 11);
  assert.equal(R(target, 20, { rank: 2 }), 7, "class level is irrelevant to a rank ladder");
  assert.equal(R(target, 1, { rank: 3 }), 3);
  assert.equal(R(target, 1, {}), null, "no rank supplied — the caller must say");
  assert.ok(vocab.VALUE_SCALES.rank, "rank is a scale");
});

t("reroll + companion primitives are in the effect vocabulary", () => {
  for (const k of ["reroll", "companion"]) assert.ok(vocab.EFFECT_TYPES[k], `EFFECT_TYPES.${k}`);
  assert.deepEqual(Object.keys(vocab.REROLL_KEEP), ["better", "worse", "latest"]);
  assert.ok(vocab.VALUE_SCALES.arcaneValue, "VALUE_SCALES.arcaneValue (magic TODO)");
});

// --- tables registry (layered) + services --------------------------------
const T = await import("../scripts/lib/tables.mjs");
const S = await import("../scripts/lib/services.mjs");

t("tables: priority layering — highest wins, unregister falls back", () => {
  T.resetTables();
  T.registerTable({ id: "wages", tables: { ladder: { v: "sample" } } });
  T.registerTable({ id: "wages", tables: { ladder: { v: "world" } } }, { priority: T.PRIORITY.WORLD, source: "import" });
  assert.equal(T.getTable("wages", "ladder").v, "world");
  assert.deepEqual(T.docInfo(), [
    { id: "wages", priority: 0, source: null },
    { id: "wages", priority: 20, source: "import" },
  ]);
  T.unregisterTable("wages", { priority: T.PRIORITY.WORLD });
  assert.equal(T.getTable("wages", "ladder").v, "sample");
  T.unregisterTable("wages");
  assert.equal(T.hasDoc("wages"), false);
  assert.throws(() => T.getDoc("wages"), /not registered/);
});

t("tables: same-layer re-registration replaces (idempotent re-import)", () => {
  T.resetTables();
  T.registerTable({ id: "people", tables: { a: 1 } }, { priority: 20 });
  T.registerTable({ id: "people", tables: { a: 2 } }, { priority: 20 });
  assert.equal(T.getDoc("people").tables.a, 2);
  assert.equal(T.docInfo().length, 1);
});

t("tables: partial OVERRIDE layers per table, never hides the world doc", () => {
  T.resetTables();
  T.registerTable({ id: "people", source: { book: "JJ" }, tables: { ages: { a: 1 }, castes: { h: 5 } } }, { priority: T.PRIORITY.WORLD });
  T.registerTable({ id: "people", tables: { castes: { h: 10 } } }, { priority: T.PRIORITY.OVERRIDE });
  assert.equal(T.getTable("people", "castes").h, 10); // override wins its table
  assert.equal(T.getTable("people", "ages").a, 1); // world tables show through
  assert.equal(T.getDoc("people").source.book, "JJ"); // scalars from the layer that has them
  T.unregisterTable("people", { priority: T.PRIORITY.OVERRIDE });
  assert.equal(T.getTable("people", "castes").h, 5); // revert falls back
});

t("tables: initTables alias + getThrowDef + bracketRow open bound", () => {
  T.resetTables();
  T.initTables({ id: "throws", throws: { loyalty: { target: 9 } } });
  assert.equal(T.getThrowDef("throws", "loyalty").target, 9);
  assert.throws(() => T.getTable("throws", "nope"), /no table/);
  const rows = [{ min: 0, max: 4, r: "low" }, { min: 5, max: null, r: "open" }];
  assert.equal(T.bracketRow(rows, 99).r, "open");
  assert.equal(T.bracketRow(rows, 4).r, "low");
  T.resetTables();
});

t("services: register/get/names; absent contract is null, never a throw", () => {
  S.resetServices();
  assert.equal(S.get("ruledata-import"), null);
  const impl = { importDoc: async () => {} };
  S.register("ruledata-import", impl);
  assert.equal(S.get("ruledata-import"), impl);
  assert.deepEqual(S.names(), ["ruledata-import"]);
  S.resetServices();
});

/* -------------------------------------------- */
/*  group.mjs — the Foundry-free lifecycle logic */
/* -------------------------------------------- */

t("nextOrdinal: one past the highest, never reused", () => {
  assert.equal(nextOrdinal({ roster: [] }), 1);
  assert.equal(nextOrdinal({ roster: [{ ordinal: 1 }, { ordinal: 2 }] }), 3);
  // #2 died and its record was pruned; the next body is still #3, not #2.
  assert.equal(nextOrdinal({ roster: [{ ordinal: 1 }, { ordinal: 3 }] }), 4);
});

t("memberName: own name wins, else stack template label + ordinal", () => {
  const stack = { template: { label: "Kobold" } };
  assert.equal(memberName(stack, { name: "Meepo", ordinal: 4 }), "Meepo");
  assert.equal(memberName(stack, { name: "", ordinal: 7 }), "Kobold #7");
  assert.equal(memberName({ template: {} }, { ordinal: 2 }), "Member #2");
});

t("nextOrdinal + memberName address ONE stack's roster (per-stack numbering)", () => {
  const swords = { template: { label: "Swordsman" }, roster: [{ ordinal: 1 }, { ordinal: 2 }] };
  const spears = { template: { label: "Spearman" }, roster: [{ ordinal: 1 }] };
  assert.equal(nextOrdinal(swords), 3);
  assert.equal(nextOrdinal(spears), 2, "each stack numbers its own bodies");
  assert.equal(memberName(swords, { ordinal: 3 }), "Swordsman #3");
  assert.equal(memberName(spears, { ordinal: 2 }), "Spearman #2");
});

t("platoonCapacity: RR 169 personally-led limit by commander level", () => {
  assert.equal(platoonCapacity(4), 30, "a lieutenant (4th) leads a platoon");
  assert.equal(platoonCapacity(3), 30, "3rd+ = a platoon");
  assert.equal(platoonCapacity(2), 15, "2nd = a half-platoon");
  assert.equal(platoonCapacity(1), 7, "1st = a squad (interpretation)");
  assert.equal(platoonCapacity(0), 0, "0th cannot lead mercenaries into danger");
});

t("migrateGroupSource: v0 single-stack folds into stacks[0], v1 is left alone", () => {
  // v0: template/size/roster at the top level → stacks[0] with a stable key.
  const v0 = { template: { label: "Kobold", uuid: "Actor.x" }, size: { current: 30 }, roster: [{ key: "m1", ordinal: 1 }] };
  const out = migrateGroupSource(v0);
  assert.equal(out.stacks.length, 1);
  assert.equal(out.stacks[0].key, "primary");
  assert.equal(out.stacks[0].template.label, "Kobold");
  assert.equal(out.stacks[0].size.current, 30);
  assert.equal(out.stacks[0].roster[0].key, "m1");
  // Idempotent: a doc that already has stacks is untouched (no double-wrap).
  const v1 = { stacks: [{ key: "a" }, { key: "b" }] };
  assert.equal(migrateGroupSource(v1).stacks.length, 2);
  // A bare/new source with no legacy fields gets no stacks injected.
  assert.equal("stacks" in migrateGroupSource({}), false);
});

t("isDerivedEffect: a module-managed effect is derived, an authored one is not", () => {
  assert.equal(isDerivedEffect({ flags: { "acks-extras": { managed: true } } }), true);
  assert.equal(isDerivedEffect({ name: "Curse", flags: {} }), false);
  assert.equal(isDerivedEffect({ flags: { "acks-extras": { loadout: true } } }), false, "only the 'managed' marker counts");
  assert.equal(isDerivedEffect({}), false);
});

t("cleanDelta: strips derived effects, keeps authored, leaves the rest intact", () => {
  // cleanDelta uses foundry.utils.deepClone — provide the one call it needs.
  globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
  const delta = {
    system: { hp: { value: 3 } },
    effects: [
      { name: "Loadout", flags: { "acks-extras": { managed: true } } },
      { name: "Judge's Curse", flags: {} },
    ],
  };
  const out = cleanDelta(delta);
  assert.equal(out.effects.length, 1);
  assert.equal(out.effects[0].name, "Judge's Curse");
  assert.deepEqual(out.system, { hp: { value: 3 } }, "non-effect delta is untouched");
  // An all-derived effects array is dropped entirely, not left empty.
  const allDerived = cleanDelta({ effects: [{ flags: { x: { managed: true } } }] });
  assert.equal("effects" in allDerived, false);
  delete globalThis.foundry;
});

t("sizeFromEcology: reads the rich block, falls back to core, else null", () => {
  const rich = {
    getFlag: (m, k) => (m === "acks-extras" && k === "extras"
      ? { encounter: { wilderness: { wandering: { number: "4d6" } }, dungeon: { lair: { number: "2d4" } } } }
      : undefined),
    system: {},
  };
  assert.equal(sizeFromEcology(rich, "wilderness"), "4d6");
  assert.equal(sizeFromEcology(rich, "dungeon"), "2d4", "lair number when no wandering");
  // No extras: fall back to the core details.appearing mirror.
  const core = { getFlag: () => undefined, system: { details: { appearing: { w: "1d8", d: "1" } } } };
  assert.equal(sizeFromEcology(core, "wilderness"), "1d8");
  assert.equal(sizeFromEcology(core, "dungeon"), "1");
  // Nothing stated at all → null, so the Judge types the size.
  assert.equal(sizeFromEcology({ getFlag: () => undefined, system: {} }), null);
  assert.equal(sizeFromEcology(null), null);
});

/* --- template-logic (the acks-lib.template generator) --- */

// A miniature elemental-shaped template: two axes, one 2-axis cell, a menu.
const TEMPLATE_SYS = {
  output: { actorType: "monster", nameFormat: "{tier} {element} Elemental" },
  axes: [
    {
      key: "tier", label: "Tier", roll: "1d4",
      derive: { from: "", max: null },
      options: [
        { key: "petty", label: "Petty", rollMin: 1, rollMax: 2, menuBudget: 1, merge: { aac: { value: 5 }, "details.xp": 135 }, items: [], html: "<p>petty</p>" },
        { key: "major", label: "Major", rollMin: 3, rollMax: 4, menuBudget: 2, merge: { aac: { value: 9 } }, items: [{ name: "Slam", type: "weapon" }], html: "" },
      ],
    },
    {
      key: "element", label: "Element", roll: "",
      derive: { from: "", max: null },
      options: [
        { key: "fire", label: "Fire", merge: { details: { alignment: "Neutral" } }, items: [], art: "fire.webp", html: "" },
        { key: "water", label: "Water", merge: {}, items: [], art: "water.webp", html: "" },
      ],
    },
  ],
  cells: [
    { by: ["tier", "element"], key: "major|fire", merge: { attacks: "special" }, items: [] },
  ],
  menu: {
    die: "1d100", budgetAxis: "tier",
    rows: [
      { min: 1, max: 50, label: "Poison", cost: null, html: "<p>poison</p>" },
      { min: 51, max: 100, label: "Regeneration", cost: 1, html: "" },
    ],
  },
};

t("rollDie parses NdM and stays in range; garbage is null", () => {
  const rng = seededRng(7);
  for (let i = 0; i < 50; i++) {
    const v = rollDie("1d100", rng);
    assert.ok(v >= 1 && v <= 100, "1d100 in range");
  }
  assert.equal(rollDie("2d6", () => 0), 2, "two dice floor");
  assert.equal(rollDie("varies", rng), null);
});

t("rollOption honors printed bands; uniform when the axis has no die", () => {
  const axis = TEMPLATE_SYS.axes[0];
  assert.equal(rollOption(axis, () => 0.1).option.key, "petty", "low roll lands the low band");
  assert.equal(rollOption(axis, () => 0.9).option.key, "major", "high roll lands the high band");
  const uniform = rollOption(TEMPLATE_SYS.axes[1], () => 0.99);
  assert.equal(uniform.option.key, "water");
  assert.equal(uniform.roll, null, "uniform picks report no roll");
});

t("chooseAxes precedence: pinned > derived > rolled", () => {
  const rng = seededRng(3);
  const pinnedRun = chooseAxes(TEMPLATE_SYS, { pinned: { tier: "major", element: "fire" }, rng });
  assert.deepEqual(pinnedRun.choices, { tier: "major", element: "fire" });
  assert.ok(pinnedRun.log.every((l) => l.source === "pinned"));
  // A derive axis reads the base value, clamped by its cap, matching numeric keys.
  const thrall = {
    axes: [{
      key: "hd", label: "HD", roll: "", derive: { from: "hd", max: 8 },
      options: [1, 2, 3, 8].map((num) => ({ key: String(num), label: `${num} HD`, merge: {}, items: [] })),
    }],
  };
  assert.equal(chooseAxes(thrall, { baseValues: { hd: 11 }, rng }).choices.hd, "8", "capped at 8");
  assert.equal(chooseAxes(thrall, { baseValues: { hd: 5 }, rng }).choices.hd, "3", "closest row not exceeding");
  // A stale pin falls through to a roll rather than failing.
  const stale = chooseAxes(TEMPLATE_SYS, { pinned: { tier: "gone" }, rng });
  assert.ok(["petty", "major"].includes(stale.choices.tier));
});

t("sub-rolls resolve on pick: die, outcomes, twice; graceful without", () => {
  const menu = {
    die: "1d100", budgetAxis: "x",
    rows: [{
      min: 1, max: 100, label: "Aura", cost: 1, html: "<p>aura</p>",
      sub: { die: "1d8", outcomes: [
        { min: 1, max: 4, text: "arcane" },
        { min: 5, max: 8, text: "fire" },
      ]},
    }],
  };
  const low = rollMenu(menu, 1, () => 0.1);
  assert.equal(low.picks[0].subResult.texts[0], "arcane", "low roll → low band");
  const high = rollMenu(menu, 1, () => 0.9);
  assert.equal(high.picks[0].subResult.texts[0], "fire");
  const twice = { ...menu, rows: [{ ...menu.rows[0], sub: { ...menu.rows[0].sub, twice: true } }] };
  const t2 = rollMenu(twice, 1, seededRng(9));
  assert.equal(t2.picks[0].subResult.rolls.length, 2, "twice rolls twice");
  const bare = rollMenu({ ...menu, rows: [{ ...menu.rows[0], sub: {} }] }, 1, seededRng(9));
  assert.equal(bare.picks[0].subResult, undefined, "no sub data → no subResult");
});

t("rollMenu spends the budget over printed bands, no duplicates", () => {
  const rng = seededRng(11);
  const one = rollMenu(TEMPLATE_SYS.menu, 1, rng);
  assert.equal(one.picks.length, 1);
  const two = rollMenu(TEMPLATE_SYS.menu, 2, rng);
  assert.equal(two.picks.length, 2, "budget 2 buys both rows");
  assert.notEqual(two.picks[0].label, two.picks[1].label, "distinct rows");
  assert.deepEqual(rollMenu(TEMPLATE_SYS.menu, 0, rng).picks, [], "no budget, no picks");
});

t("mergePatch: dotted keys expand, objects merge deep, scalars replace", () => {
  const out = mergePatch({ aac: { value: 1, mod: 2 } }, { "details.morale": 3, aac: { value: 9 } });
  assert.deepEqual(out, { aac: { value: 9, mod: 2 }, details: { morale: 3 } });
});

t("mergePatch: {$add} leaves adjust instead of replacing (modifier templates)", () => {
  const out = mergePatch(
    { scores: { str: { value: 13 } }, hp: { value: 20 } },
    { "scores.str.value": { $add: -1 }, hp: { value: { $add: 5 } }, "scores.con.value": { $add: -2 } }
  );
  assert.equal(out.scores.str.value, 12, "dotted relative");
  assert.equal(out.hp.value, 25, "nested relative");
  assert.equal(out.scores.con.value, -2, "missing base counts from 0");
  // A literal object that is NOT an $add leaf still replaces.
  const rep = mergePatch({ x: { $add: 1, note: "n" } }, { x: { $add: 2, note: "m" } });
  assert.deepEqual(rep.x, { $add: 2, note: "m" }, "only exact {$add:number} leaves are relative");
});

t("base foundation applies first; option tint rides out", () => {
  const sys = {
    base: { merge: { details: { alignment: "Chaotic" }, aac: { value: 1 } }, flags: { "acks-extras": { extras: { types: ["monstrosity"] } } } },
    axes: [{
      key: "age", label: "Age", roll: "", derive: { from: "", max: null },
      options: [{ key: "adult", label: "Adult", merge: { aac: { value: 7 } }, items: [], tint: "" }],
    }, {
      key: "type", label: "Type", roll: "", derive: { from: "", max: null },
      options: [{ key: "red", label: "Red", merge: {}, items: [], tint: "#b22222" }],
    }],
  };
  const r = resolveActor(sys, { age: "adult", type: "red" }, { templateName: "Dragon" });
  assert.equal(r.system.details.alignment, "Chaotic", "base merge present");
  assert.equal(r.system.aac.value, 7, "axis overrides base");
  assert.deepEqual(r.flags["acks-extras"].extras.types, ["monstrosity"], "base flags ride");
  assert.equal(r.tint, "#b22222");
});

t("multi axes: opt-in pins only, options stack in list order", () => {
  const sys = {
    axes: [{
      key: "addons", label: "Add-ons", roll: "", multi: true,
      derive: { from: "", max: null },
      options: [
        { key: "a", label: "A", merge: { x: 1, order: "a" }, items: [{ name: "A" }] },
        { key: "b", label: "B", merge: { y: 2, order: "b" }, items: [{ name: "B" }] },
      ],
    }],
  };
  const rng = seededRng(5);
  // Unpinned multi axes contribute nothing — never rolled.
  assert.deepEqual(chooseAxes(sys, { rng }).choices, {});
  const both = chooseAxes(sys, { pinned: { addons: ["b", "a", "ghost"] }, rng });
  assert.deepEqual(both.choices, { addons: ["b", "a"] }, "validated against options");
  const r = resolveActor(sys, both.choices, { templateName: "T" });
  assert.equal(r.system.x, 1);
  assert.equal(r.system.y, 2);
  assert.equal(r.system.order, "b", "applied in option-list order, later wins");
  assert.deepEqual(r.items.map((i) => i.name), ["A", "B"]);
});

t("resolveActor carries preset flags and token fragments", () => {
  const fam = {
    output: { nameFormat: "{variant}" },
    axes: [{
      key: "variant", label: "Variant", roll: "",
      derive: { from: "", max: null },
      options: [{
        key: "lion", label: "Lion", nameLabel: "Cat, Lion",
        merge: { aac: { value: 4 } }, items: [],
        flags: { "acks-extras": { extras: { classification: "Animal" } }, "acks-content": { cookbook: { id: "mm.catLion" } } },
        token: { width: 2, height: 1 },
      }],
    }],
  };
  const r = resolveActor(fam, { variant: "lion" }, { templateName: "Cat" });
  assert.equal(r.name, "Cat, Lion");
  assert.equal(r.flags["acks-extras"].extras.classification, "Animal");
  assert.equal(r.flags["acks-content"].cookbook.id, "mm.catLion");
  assert.deepEqual(r.token, { width: 2, height: 1 });
});

t("resolveActor merges axis rows then N-D cells, composes the name", () => {
  const r = resolveActor(TEMPLATE_SYS, { tier: "major", element: "fire" }, { templateName: "Elemental" });
  assert.equal(r.name, "Major Fire Elemental");
  assert.equal(r.system.aac.value, 9);
  assert.equal(r.system.attacks, "special", "2-axis cell applied after axis rows");
  assert.equal(r.items.length, 1);
  assert.equal(r.art, "fire.webp", "per-option art rides along");
  // The petty row's dotted merge lands as nested structure.
  const p = resolveActor(TEMPLATE_SYS, { tier: "petty", element: "water" }, { templateName: "Elemental" });
  assert.equal(p.system.details.xp, 135);
  assert.equal(p.name, "Petty Water Elemental");
  assert.deepEqual(p.htmlParts, ["<p>petty</p>"]);
  // {base} in a nameFormat resolves to the dropped actor's name.
  const mod = { output: { nameFormat: "{base}, Vampire Thrall" }, axes: [] };
  assert.equal(resolveActor(mod, {}, { baseName: "Bob the Fighter" }).name, "Bob the Fighter, Vampire Thrall");
});

t("attackTerms: stable keys, zero terms dropped, monster gets weapon only", () => {
  assert.deepEqual(attackTerms({ type: "melee", abilityMod: 2, attackMod: 0, itemBonus: 1 }), [
    { key: "ability", value: 2 },
    { key: "weapon", value: 1 },
  ]);
  assert.deepEqual(attackTerms({ type: "attack", abilityMod: 3, attackMod: 2, itemBonus: 1 }), [
    { key: "weapon", value: 1 },
  ]);
  assert.equal(termTotal(attackTerms({ type: "missile", abilityMod: -1, attackMod: 2 })), 1);
});

t("resolveAttack: throw is the target, bonuses add to the die (acHit math)", () => {
  // Throw 8+, die 11, +4 bonuses → total 15, hits AC 7; vs AC 4 that's a hit.
  const r = resolveAttack({ die: 11, bonus: 4, throwTarget: 8, targetAc: 4 });
  assert.equal(r.acHit, 7);
  assert.equal(r.effectiveTarget, 12);
  assert.ok(r.isSuccess);
  // Same roll vs AC 8 misses — the target moved, the roll didn't.
  assert.ok(resolveAttack({ die: 11, bonus: 4, throwTarget: 8, targetAc: 8 }).isFailure);
  // Moving the THROW (class/level) moves the target: throw 4+ now hits AC 8.
  assert.ok(resolveAttack({ die: 11, bonus: 4, throwTarget: 4, targetAc: 8 }).isSuccess);
});

t("resolveAttack: die specials — nat 1 misses, nat 20 hits, unless exploding", () => {
  assert.ok(resolveAttack({ die: 1, bonus: 20, throwTarget: 10, targetAc: 0 }).isFumble);
  assert.ok(resolveAttack({ die: 20, bonus: -20, throwTarget: 10, targetAc: 9 }).isCritical);
  // Exploding 20s: no auto-results — the raw math decides.
  assert.ok(resolveAttack({ die: 1, bonus: 20, throwTarget: 10, targetAc: 0, exploding: true }).isSuccess);
  assert.ok(resolveAttack({ die: 20, bonus: -20, throwTarget: 10, targetAc: 9, exploding: true }).isFailure);
});

t("resolveAttack: full parity with core's folded resolution (both rules)", () => {
  let checked = 0;
  for (const exploding of [false, true]) {
    for (let die = 1; die <= 20; die++) {
      for (let bonus = -3; bonus <= 5; bonus++) {
        for (let throwTarget = 3; throwTarget <= 11; throwTarget++) {
          for (let targetAc = 0; targetAc <= 9; targetAc += 3) {
            const ours = resolveAttack({ die, bonus, throwTarget, targetAc, exploding }).isSuccess;
            const core = legacyCoreResolves({ die, bonus, throwTarget, targetAc, exploding });
            assert.equal(ours, core, `die ${die} bonus ${bonus} throw ${throwTarget} AC ${targetAc} hfh ${exploding}`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 12000, `swept ${checked} cases`);
});

/* -------------------------------------------- */
/*  storage-logic: transfers between actors      */
/* -------------------------------------------- */

// The system stores stack size three different ways; these fixtures carry all of them.
const gold = (id, qty, bank = 0) => ({ _id: id, name: "Gold", type: "money", system: { coppervalue: 100, quantity: qty, quantitybank: bank, totalvalue: 999 } });
const silver = (id, qty) => ({ _id: id, name: "Silver", type: "money", system: { coppervalue: 10, quantity: qty, quantitybank: 0 } });
const gear = (id, name, qty) => ({ _id: id, name, type: "item", system: { cost: 1, weight6: 1, quantity: { value: qty, max: 0 } } });
const sword = (id) => ({ _id: id, name: "Sword", type: "weapon", system: { cost: 10, weight6: 6, equipped: true } });
const inside = (item, containerId) => ({ ...item, flags: { "acks-extras": { containedIn: containerId } } });
const ids = () => {
  let i = 0;
  return () => `new${++i}`;
};

t("quantityOf reads the shape, not the type name", () => {
  assert.deepEqual(quantityOf(gold("g", 5)), { value: 5, path: "system.quantity" });
  assert.deepEqual(quantityOf(gear("i", "Torch", 3)), { value: 3, path: "system.quantity.value" });
  assert.equal(quantityOf(sword("w")), null); // unstackable — always whole
});

t("splitSpec: clamps, defaults to everything, flags whole moves", () => {
  assert.deepEqual(splitSpec(gear("i", "Torch", 10), 4), { move: 4, remain: 6, whole: false, path: "system.quantity.value" });
  assert.equal(splitSpec(gear("i", "Torch", 10), 99).move, 10); // clamped, not refused
  assert.equal(splitSpec(gear("i", "Torch", 10)).whole, true); // null = all of it
  assert.deepEqual(splitSpec(sword("w"), 3), { move: 1, remain: 0, whole: true, path: null });
  assert.equal(splitSpec(gold("g", 0)).move, 0); // empty stack moves nothing
});

t("expandContainerClosure: contents follow, transitively, cycles terminate", () => {
  const items = [gear("pack", "Backpack", 1), inside(gear("box", "Box", 1), "pack"), inside(gear("gem", "Gem", 1), "box"), gear("loose", "Rope", 1)];
  assert.deepEqual([...expandContainerClosure(items, ["pack"])].sort(), ["box", "gem", "pack"]);
  assert.deepEqual([...expandContainerClosure(items, ["loose"])], ["loose"]);
  const cycle = [inside(gear("a", "A", 1), "b"), inside(gear("b", "B", 1), "a")];
  assert.deepEqual([...expandContainerClosure(cycle, ["a"])].sort(), ["a", "b"]);
});

t("buildTransferPayload: whole move deletes the source, split updates it", () => {
  const items = [gear("torch", "Torch", 10), sword("sw")];
  const p = buildTransferPayload(items, [{ id: "torch", quantity: 4 }, { id: "sw" }], { newId: ids() });
  assert.equal(p.creates.length, 2);
  assert.deepEqual(p.sourceUpdates, [{ _id: "torch", "system.quantity.value": 6 }]);
  assert.deepEqual(p.sourceDeletes, ["sw"]);
  assert.equal(p.creates.find((c) => c.name === "Torch").system.quantity.value, 4);
});

t("buildTransferPayload: arrivals are normalised (unequipped, bank zeroed)", () => {
  const p = buildTransferPayload([sword("sw"), gold("g", 5, 120)], [{ id: "sw" }, { id: "g" }], { newId: ids() });
  assert.equal(p.creates.find((c) => c.type === "weapon").system.equipped, false);
  const coin = p.creates.find((c) => c.type === "money");
  assert.equal(coin.system.quantitybank, 0); // the retired bank field never travels
  assert.equal(coin.system.totalvalue, 0); // recomputed by the sheet, never carried
});

t("buildTransferPayload: containedIn is remapped when the container comes too, stripped when it does not", () => {
  const items = [gear("pack", "Backpack", 1), inside(gear("gem", "Gem", 1), "pack")];
  const together = buildTransferPayload(items, [{ id: "pack" }], { newId: ids() });
  const packId = together.idMap.get("pack");
  assert.equal(together.creates.find((c) => c.name === "Gem").flags["acks-extras"].containedIn, packId);
  const alone = buildTransferPayload(items, [{ id: "gem" }], { newId: ids() });
  assert.equal(alone.creates[0].flags["acks-extras"].containedIn, undefined); // would dangle
});

t("buildTransferPayload: attribution is stamped, preserved, or stripped", () => {
  const stashed = buildTransferPayload([sword("sw")], [{ id: "sw" }], { stampOwner: true, ownerUuid: "Actor.hero", ownerName: "Hero", newId: ids() });
  assert.deepEqual(stashed.creates[0].flags["acks-extras"].storage, { ownerUuid: "Actor.hero", ownerName: "Hero" });

  const owned = { ...sword("sw"), flags: { "acks-extras": { storage: { ownerUuid: "Actor.hero", ownerName: "Hero" } } } };
  const consolidated = buildTransferPayload([owned], [{ id: "sw" }], { stampOwner: true, preserveOwner: true, ownerUuid: null, ownerName: "", newId: ids() });
  assert.equal(consolidated.creates[0].flags["acks-extras"].storage.ownerUuid, "Actor.hero"); // merging vaults must not launder ownership

  const back = buildTransferPayload([owned], [{ id: "sw" }], { stampOwner: false, newId: ids() });
  assert.equal(back.creates[0].flags["acks-extras"].storage, undefined); // you own what you carry
});

t("buildTransferPayload: unknown ids and zero requests move nothing", () => {
  assert.equal(buildTransferPayload([sword("sw")], [{ id: "nope" }], { newId: ids() }).creates.length, 0);
  assert.equal(buildTransferPayload([gear("t", "Torch", 5)], [{ id: "t", quantity: 0 }], { newId: ids() }).creates.length, 0);
});

t("planStackMerge: folds into an existing row rather than adding a second Gold", () => {
  const { creates, targetUpdates } = planStackMerge([gold("new", 20)], [gold("have", 50)]);
  assert.equal(creates.length, 0);
  assert.deepEqual(targetUpdates, [{ _id: "have", "system.quantity": 70 }]);
});

t("planStackMerge: ordinary stackables merge too — split a stack, put it back, get one row", () => {
  const { creates, targetUpdates } = planStackMerge([gear("moved", "Torch", 4)], [gear("kept", "Torch", 6)]);
  assert.equal(creates.length, 0);
  assert.deepEqual(targetUpdates, [{ _id: "kept", "system.quantity.value": 10 }]);
});

t("planStackMerge: only things that are genuinely the same merge", () => {
  // Different name, different art, different system data, or living inside a
  // container — each keeps its own row. Over-merging destroys data silently.
  const kept = [gear("kept", "Torch", 6)];
  const differs = (make) => planStackMerge([make], kept).creates.length;
  assert.equal(differs(gear("m", "Lantern", 4)), 1, "different name");
  assert.equal(differs({ ...gear("m", "Torch", 4), img: "other.webp" }), 1, "different art");
  assert.equal(differs({ ...gear("m", "Torch", 4), system: { cost: 99, weight6: 1, quantity: { value: 4, max: 0 } } }), 1, "different cost");
  assert.equal(differs(inside(gear("m", "Torch", 4), "pack")), 1, "inside a container");
  assert.equal(differs({ ...gear("m", "Torch", 4), effects: [{ name: "Blessed" }] }), 1, "carries its own effects");
  assert.equal(differs(sword("s")), 1, "unstackable never merges");
  assert.equal(differs(gear("m", "Torch", 4)), 0, "identical apart from quantity");
});

t("planStackMerge: a transferred item merges with one that never travelled", () => {
  // The regression this guards: an arrival has had keys DELETED from its flags
  // (attribution, a container pointer that would dangle), leaving an empty
  // scope where a plain row has none. Same item — it must still merge.
  const arrival = { ...gear("moved", "Torch", 4), flags: { "acks-extras": {}, "acks-extras": {} } };
  const { creates, targetUpdates } = planStackMerge([arrival], [gear("kept", "Torch", 6)]);
  assert.equal(creates.length, 0);
  assert.deepEqual(targetUpdates, [{ _id: "kept", "system.quantity.value": 10 }]);
});

t("planStackMerge: at a provider the key carries the owner, so two people's gold stays two rows", () => {
  const stamp = (m, uuid) => ({ ...m, flags: { "acks-extras": { storage: { ownerUuid: uuid, ownerName: uuid } } } });
  const target = [stamp(gold("theirs", 10), "Actor.ally")];
  const byOwner = planStackMerge([stamp(gold("mine", 5), "Actor.hero")], target, { byOwner: true });
  assert.equal(byOwner.creates.length, 1); // a new row for the hero
  assert.equal(byOwner.targetUpdates.length, 0);
  const pooled = planStackMerge([stamp(gold("mine", 5), "Actor.ally")], target, { byOwner: true });
  assert.deepEqual(pooled.targetUpdates, [{ _id: "theirs", "system.quantity": 15 }]);
});

t("planStackMerge: two arriving stacks of one denomination land as one row", () => {
  const { creates } = planStackMerge([gold("a", 5), gold("b", 7), silver("c", 3)], []);
  assert.equal(creates.length, 2);
  assert.equal(creates.find((c) => c.name === "Gold").system.quantity, 12);
});

t("emptyMoneyDeletes: a coin row emptied by the move is deleted, unless coin remains in the bank", () => {
  const items = [gold("g", 50), gold("b", 50, 20)];
  const emptied = emptyMoneyDeletes([{ _id: "g", "system.quantity": 0 }], items);
  assert.deepEqual(emptied, { sourceUpdates: [], sourceDeletes: ["g"] });
  const banked = emptyMoneyDeletes([{ _id: "b", "system.quantity": 0 }], items);
  assert.deepEqual(banked.sourceDeletes, []); // left for the vault sweep to find
});

t("coinTotalGC counts the way the system does (100cp = 1gp)", () => {
  assert.equal(coinTotalGC([gold("g", 12), silver("s", 30)]), 15);
  assert.equal(coinTotalGC([sword("w")]), 0);
});

t("groupByOwner buckets stored goods, unattributed included", () => {
  const stamp = (m, uuid, name) => ({ ...m, flags: { "acks-extras": { storage: { ownerUuid: uuid, ownerName: name } } } });
  const buckets = groupByOwner([stamp(gold("a", 1), "Actor.hero", "Hero"), stamp(sword("b"), "Actor.hero", "Hero"), silver("orphan", 1)]);
  assert.equal(buckets.get("Actor.hero").items.length, 2);
  assert.equal(buckets.get("Actor.hero").ownerName, "Hero");
  assert.equal(buckets.get("").items.length, 1); // never silently dropped
});

console.log(`\n${n} tests passed`);
