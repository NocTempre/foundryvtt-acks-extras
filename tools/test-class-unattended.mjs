/**
 * An import applies a class without asking, and the election it leaves open is
 * the character sheet's to take. Mocked Foundry globals, a recording prompt
 * standing in for core's `DialogV2.prompt`; every figure is an invented
 * fixture.
 *
 * Run: node tools/test-class-unattended.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";

const prompts = [];
let promptAnswer = "melee";
globalThis.game = { items: [], i18n: { localize: (k) => k, format: (k) => k } };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.foundry = {
  utils: {
    getProperty: (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o),
    escapeHTML: (s) => String(s),
  },
  data: { operators: { ForcedReplacement: { create: (v) => v }, ForcedDeletion: class {} } },
  applications: {
    api: {
      DialogV2: {
        // Core resolves the OK button's callback value; a null answer is a dismissal.
        prompt: async (config) => {
          prompts.push(config);
          if (promptAnswer == null) throw new Error("dismissed");
          return config.ok.callback(null, { form: { elements: { applies: { value: promptAnswer } } } });
        },
        confirm: async () => true,
      },
    },
  },
};

const { applyClass, readyToApply, electDamageBonus } = await import("../scripts/classes/apply.mjs");
const { MODULE_ID, CLASS_TYPE, FLAG_CLASSES } = await import("../scripts/classes/constants.mjs");

let passed = 0;
const test = async (name, fn) => {
  prompts.length = 0;
  promptAnswer = "melee";
  try {
    await fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
};

const ladders = (key) => [{ key, values: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }] }];

/** A class document carrying one damage-bonus ladder, saves and an attack band. */
const classWith = (ladderKey, { key = "fixture", cite = "" } = {}) => ({
  name: "Fixture",
  type: CLASS_TYPE,
  uuid: `Item.${key}`,
  effects: [],
  system: {
    key,
    isStub: false,
    maximumLevel: 20,
    ladders: ladders(ladderKey),
    saves: [{ minLevel: 1, maxLevel: 20, paralysis: 12, death: 11, blast: 14, implements: 13, spells: 15 }],
    attack: [{ minLevel: 1, maxLevel: 20, throw: 10 }],
    levelRow: () => null,
    nextXp: () => null,
    cleaves: null,
    casting: [],
    requirements: [],
    source: { cite },
  },
});

/** A character whose classes flag is `flag`, recording every update. */
const actorWith = (flag = null, level = 1) => {
  const updates = [];
  return {
    updates,
    name: "Fixture Actor",
    system: { details: { level, xp: { value: 0 } } },
    effects: { filter: () => [] },
    getFlag: (scope, k) => (scope === MODULE_ID && k === FLAG_CLASSES ? flag : undefined),
    update: async (data) => {
      updates.push(data);
    },
  };
};

const damagePaths = (update) => Object.keys(update).filter((k) => k.startsWith("system.damage.mod."));
const flagKey = `flags.${MODULE_ID}.${FLAG_CLASSES}`;

await test("an unattended readyToApply leaves an owed election unmade and builds no dialog", async () => {
  const ready = await readyToApply(actorWith(), classWith("electedDamageBonus"), { unattended: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.election, null);
  assert.equal(ready.owed, true);
  assert.equal(prompts.length, 0);
});

await test("an unattended applyClass applies the class, writes no damage mod and records no election", async () => {
  const actor = actorWith();
  const result = await applyClass(actor, classWith("electedDamageBonus"), { level: 3, confirm: false, unattended: true });
  assert.equal(result.applied, true);
  assert.equal(prompts.length, 0);
  assert.equal(actor.updates.length, 1);
  const written = actor.updates[0];
  assert.equal(written["system.details.class"], "Fixture");
  assert.equal(written["system.attack.throw"], 10);
  assert.ok(Object.keys(written).some((k) => k.startsWith("system.saves.")), "the saves are written");
  assert.deepEqual(damagePaths(written), []);
  assert.equal("damageBonus" in written[flagKey], false);
  assert.equal("damageBonus" in written[flagKey].applied, false);
});

await test("the same calls without unattended ask once each and record the answer against the class", async () => {
  const ready = await readyToApply(actorWith(), classWith("electedDamageBonus"));
  assert.equal(prompts.length, 1);
  assert.deepEqual([ready.ok, ready.election, ready.owed], [true, "melee", undefined]);

  prompts.length = 0;
  promptAnswer = "missile";
  const actor = actorWith();
  const result = await applyClass(actor, classWith("electedDamageBonus"), { level: 3, confirm: false });
  assert.equal(prompts.length, 1);
  assert.equal(result.applied, true);
  assert.deepEqual(actor.updates[0][flagKey].damageBonus, { class: "fixture", applies: "missile" });
  assert.deepEqual(damagePaths(actor.updates[0]), ["system.damage.mod.missile"]);
});

await test("a dismissed prompt cancels a hand apply and an unattended one is never dismissed", async () => {
  promptAnswer = null;
  const actor = actorWith();
  assert.equal((await applyClass(actor, classWith("electedDamageBonus"), { level: 3, confirm: false })).applied, false);
  assert.equal(actor.updates.length, 0);
  prompts.length = 0;
  assert.equal((await applyClass(actor, classWith("electedDamageBonus"), { level: 3, confirm: false, unattended: true })).applied, true);
  assert.equal(prompts.length, 0);
});

await test("a class with a fixed-scope ladder applies unattended exactly as it does by hand", async () => {
  const actor = actorWith();
  await applyClass(actor, classWith("meleeDamageBonus"), { level: 3, confirm: false, unattended: true });
  assert.deepEqual(damagePaths(actor.updates[0]), ["system.damage.mod.melee"]);
  assert.equal(prompts.length, 0);
});

await test("a held election is honoured by an unattended apply, which never asks", async () => {
  const actor = actorWith({ key: "fixture", damageBonus: { class: "fixture", applies: "missile" } });
  const ready = await readyToApply(actor, classWith("electedDamageBonus"), { unattended: true });
  assert.deepEqual([ready.ok, ready.election, ready.owed], [true, "missile", undefined]);
  await applyClass(actor, classWith("electedDamageBonus"), { level: 3, confirm: false, unattended: true });
  assert.equal(prompts.length, 0);
  assert.deepEqual(damagePaths(actor.updates[0]), ["system.damage.mod.missile"]);
  assert.equal(actor.updates[0]["system.damage.mod.missile"], 2);
  assert.deepEqual(actor.updates[0][flagKey].damageBonus, { class: "fixture", applies: "missile" });
});

await test("an election held for another class is not this class's, so an unattended apply leaves it unmade", async () => {
  const actor = actorWith({ key: "other", damageBonus: { class: "other", applies: "melee" } });
  const ready = await readyToApply(actor, classWith("electedDamageBonus"), { unattended: true });
  assert.deepEqual([ready.election, ready.owed], [null, true]);
});

await test("electDamageBonus writes the flag, the ledger entry and the one side's mod at the held level, in one update", async () => {
  const actor = actorWith({ key: "fixture", appliedLevel: 3 }, 3);
  assert.equal(await electDamageBonus(actor, classWith("electedDamageBonus"), "melee"), true);
  assert.equal(actor.updates.length, 1);
  const written = actor.updates[0];
  assert.deepEqual(written[`${flagKey}.damageBonus`], { class: "fixture", applies: "melee" });
  assert.equal(written["system.damage.mod.melee"], 2);
  assert.equal(written[`${flagKey}.applied.system.damage.mod.melee`], 2);
  assert.deepEqual(damagePaths(written), ["system.damage.mod.melee"]);
  assert.equal(prompts.length, 0);
});

await test("electDamageBonus refuses a second election, a fixed-scope class, an unbound class and any other value", async () => {
  const held = actorWith({ key: "fixture", damageBonus: { class: "fixture", applies: "melee" } }, 3);
  assert.equal(await electDamageBonus(held, classWith("electedDamageBonus"), "missile"), false);

  const fixed = actorWith({ key: "fixture" }, 3);
  assert.equal(await electDamageBonus(fixed, classWith("meleeDamageBonus"), "melee"), false);

  const unbound = actorWith({ key: "other" }, 3);
  assert.equal(await electDamageBonus(unbound, classWith("electedDamageBonus"), "melee"), false);

  const open = actorWith({ key: "fixture" }, 3);
  for (const value of ["both", "", null, undefined, "MELEE"]) {
    assert.equal(await electDamageBonus(open, classWith("electedDamageBonus"), value), false);
  }
  assert.deepEqual([held.updates, fixed.updates, unbound.updates, open.updates], [[], [], [], []]);
});

await test("the import passes unattended to importSheet and the hand import never does", () => {
  const importer = readFileSync(new URL("../scripts/importer/cookbook/actor-import.mjs", import.meta.url), "utf8");
  const call = /await importSheet\(\{([^}]*)\}\)/.exec(importer);
  assert.ok(call, "importCharacter calls importSheet");
  assert.match(call[1], /\bunattended: true\b/);
  const app = readFileSync(new URL("../scripts/character-sheet/pdf/app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(app, /unattended/);
  const apply = readFileSync(new URL("../scripts/character-sheet/pdf/apply.mjs", import.meta.url), "utf8");
  assert.match(apply, /bindClass\(target, cls, plan\.level, \{ unattended \}\)/);
  assert.match(apply, /bindClass\(hench, cls, h\.level, \{ unattended \}\)/);
  assert.match(apply, /grantAbilities\(target, plan\.abilities, report, \{ unattended \}\)/);
  assert.match(apply, /grantFixedAwards\(target, cls, .*\[\], \{ unattended \}\)/);
  assert.match(apply, /verifyThrows: false, unattended \}\)/, "a henchman's powers are granted unattended too");
  assert.match(apply, /createEmbeddedDocuments\("Item", copies, unattendedOperation\(unattended\)\)/);
  const grants = readFileSync(new URL("../scripts/classes/grants.mjs", import.meta.url), "utf8");
  assert.match(grants, /createEmbeddedDocuments\("Item", [^\n]*unattendedOperation\(unattended\)\)/);
  const classApply = readFileSync(new URL("../scripts/classes/apply.mjs", import.meta.url), "utf8");
  assert.equal(classApply.match(/grantAbility\(actor, [^\n]*unattended \}\)/g)?.length, 3, "applyClass (fixed and picked) and grantFixedAwards pass unattended to each grant");
  assert.match(classApply, /grantAdventuring\(actor, grants, \{ unattended \}\)/);
});

await test("the Class tab row is shown only for an elected ladder, open until one is held, with the class's citation as its tooltip", () => {
  const src = readFileSync(new URL("../templates/character-sheet/class.hbs", import.meta.url), "utf8");
  const block = /\{\{#if c\.damageBonus\}\}[\s\S]*?\n      \{\{\/if\}\}/.exec(src)?.[0];
  assert.ok(block, "the template carries the row");
  assert.doesNotMatch(block, /\btitle=|\bid=/);
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => key);
  hb.registerHelper("concat", (...parts) => parts.slice(0, -1).join(""));
  hb.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
  hb.registerHelper("not", (v) => !v);
  hb.registerHelper("disabled", (v) => (v ? "disabled" : ""));
  const render = hb.compile(block);
  const open = render({ c: { damageBonus: { held: false, cite: "CITE 1", options: [{ key: "melee", on: false }, { key: "missile", on: false }] } }, editable: true }, { allowProtoPropertiesByDefault: true });
  assert.match(open, /data-tooltip-text="CITE 1"/);
  assert.doesNotMatch(open, /disabled|selected/);
  const given = render({ c: { damageBonus: { held: true, cite: null, options: [{ key: "melee", on: false }, { key: "missile", on: true }] } }, editable: true });
  assert.match(given, /<select[^>]*disabled/);
  assert.match(given, /value="missile" selected/);
  assert.doesNotMatch(given, /data-tooltip-text/);
  assert.equal(render({ c: { damageBonus: null }, editable: true }).trim(), "");
  assert.match(render({ c: { damageBonus: { held: false, options: [] } }, editable: false }), /<select[^>]*disabled/);
});

console.log(`\n${passed} passed`);
