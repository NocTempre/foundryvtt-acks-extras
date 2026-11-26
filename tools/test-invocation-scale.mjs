/**
 * The invocation level in lib: the `invocationLevel` scale a conditional keys
 * on, the `invocationFrom` / `invocationTo` range a spell row carries, the
 * reader `rowInInvocationRange`, the picker filter `valueScalesFor` and the
 * effect-row editor's two fields. Foundry-free; the editor loads under a mock.
 * The register lint's half is in `tools/importer/test-spell-recipes.mjs`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vocab from "../scripts/lib/vocab.mjs";
import { materializeEffects } from "../scripts/importer/executor.mjs";

const { resolveLevelValue: R, rowInInvocationRange: inRange, valueScalesFor, VALUE_SCALES, EFFECT_TYPES } = vocab;

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

// An invented ladder: the sigil's damage at two invocation levels.
const LADDER = { kind: "conditional", on: "invocationLevel", breakpoints: [{ atLevel: 2, value: 3 }, { atLevel: 4, value: 6 }] };

await t("a conditional on invocationLevel resolves at a rung, holds between rungs and null below the first", () => {
  const at = (level) => R(LADDER, 1, { invocationLevel: level });
  assert.equal(at(2), 3);
  assert.equal(at(3), 3, "between rungs, the lower one");
  assert.equal(at(4), 6);
  assert.equal(at(9), 6, "past the last rung, the last one");
  assert.equal(at(1), null, "below the first rung");
  assert.equal(at(0), null);
});

await t("a conditional on invocationLevel is null with no level, and the class level never stands in for it", () => {
  assert.equal(R(LADDER, 7), null, "no scales at all");
  assert.equal(R(LADDER, 7, {}), null);
  assert.equal(R(LADDER, 7, { invocationLevel: null }), null);
  assert.equal(R(LADDER, 7, { invocationLevel: undefined, level: 7 }), null, "a class level is another scale");
  assert.equal(R(LADDER, 7, { invocationLevel: "4" }), null, "a string is no level");
});

await t("the importer's paired ladder builds a conditional on the scale with no change, and it resolves", () => {
  const prose = [{ text: "At level 2 the sigil deals 3 damage, and at level 4 it deals 6 damage." }];
  const pattern = "level\\s*(\\d+)\\D+?(\\d+)\\s*damage\\D+?level\\s*(\\d+)\\D+?(\\d+)\\s*damage";
  const [row] = materializeEffects([{ type: "damage", onMiss: "blank", from: { into: "value", on: "invocationLevel", pairs: true, pattern } }], prose);
  assert.equal(row.value.kind, "conditional");
  assert.equal(row.value.on, "invocationLevel");
  assert.deepEqual(row.value.breakpoints, LADDER.breakpoints);
  assert.equal(R(row.value, 1, { invocationLevel: 4 }), 6);
  assert.equal(R(row.value, 1, { invocationLevel: 1 }), null);
});

await t("the scale is a spell-domain one: a picker for an ability's roll leaves it out, a spell's keeps it", () => {
  assert.equal(VALUE_SCALES.invocationLevel.domain, "spell");
  const ability = valueScalesFor("ability");
  assert.ok(!("invocationLevel" in ability));
  for (const key of ["level", "rank", "arcaneValue", "divineValue", "hitDice"]) assert.ok(key in ability, `${key} stays on the ability list`);
  assert.deepEqual(Object.keys(valueScalesFor("spell")), Object.keys(VALUE_SCALES), "a spell store is offered every scale");
  assert.ok(Object.values(ability).every((v) => !v.domain), "a domain-marked scale never reaches the ability list");
});

await t("rowInInvocationRange: a lower bound only", () => {
  const row = { invocationFrom: 3 };
  assert.equal(inRange(row, 2), false);
  assert.equal(inRange(row, 3), true, "inclusive");
  assert.equal(inRange(row, 9), true, "open above");
});

await t("rowInInvocationRange: an upper bound only", () => {
  const row = { invocationTo: 3 };
  assert.equal(inRange(row, 1), true, "open below");
  assert.equal(inRange(row, 3), true, "inclusive");
  assert.equal(inRange(row, 4), false);
});

await t("rowInInvocationRange: both bounds", () => {
  const row = { invocationFrom: 2, invocationTo: 4 };
  assert.deepEqual([1, 2, 3, 4, 5].map((level) => inRange(row, level)), [false, true, true, true, false]);
  assert.equal(inRange({ invocationFrom: 3, invocationTo: 3 }, 3), true, "a single level");
  assert.equal(inRange({ invocationFrom: 3, invocationTo: 3 }, 2), false);
  assert.equal(inRange({ invocationFrom: 5, invocationTo: 2 }, 3), false, "a backwards range holds no level");
});

await t("rowInInvocationRange: neither bound is in at every level, a level set or not", () => {
  for (const row of [{}, { invocationFrom: null, invocationTo: null }, { invocationFrom: "", invocationTo: undefined }, null, undefined]) {
    assert.equal(inRange(row, 1), true);
    assert.equal(inRange(row, 40), true);
    assert.equal(inRange(row), true);
    assert.equal(inRange(row, null), true);
  }
});

await t("rowInInvocationRange: with no level set a gated row is out", () => {
  for (const row of [{ invocationFrom: 1 }, { invocationTo: 6 }, { invocationFrom: 2, invocationTo: 4 }]) {
    assert.equal(inRange(row), false);
    assert.equal(inRange(row, null), false);
    assert.equal(inRange(row, undefined), false);
    assert.equal(inRange(row, NaN), false);
    assert.equal(inRange(row, "3"), false, "a string is no level");
  }
});

await t("rowInInvocationRange: a blank side is open, never 0", () => {
  assert.equal(inRange({ invocationFrom: null, invocationTo: 3 }, 1), true, "a null lower side is open, not 0");
  assert.equal(inRange({ invocationFrom: 2, invocationTo: null }, 5), true, "a null upper side is open, not 0");
  assert.equal(inRange({ invocationFrom: "", invocationTo: 3 }, 1), true, "a blank lower side is open");
  assert.equal(inRange({ invocationFrom: 2, invocationTo: "" }, 5), true, "a blank upper side is open");
  assert.equal(inRange({ invocationFrom: 0 }, 0), true, "a stored 0 is a bound");
});

// The effect-row editor declares a window class at load and reads `foundry.utils` and `game.i18n` when it prepares a row.
globalThis.foundry = {
  applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } } },
  utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj), randomID: () => "x" },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
const { fieldsForType, EffectRowEditor } = await import("../scripts/lib/apps/effect-row-editor.mjs");

await t("the editor offers both fields beside the pick fields on every spell kind, and on no ability kind", () => {
  const kinds = Object.keys(EFFECT_TYPES);
  assert.ok(kinds.length > 30);
  for (const kind of kinds) {
    const fields = fieldsForType(kind, "spell");
    for (const name of ["invocationFrom", "invocationTo"]) assert.ok(fields.includes(name), `${kind} edits ${name} in a spell`);
    assert.equal(fields.indexOf("invocationFrom"), fields.indexOf("pickOption") + 1, `${kind}: the range sits straight after the pick fields`);
    assert.equal(fields.indexOf("invocationTo"), fields.indexOf("invocationFrom") + 1);
    assert.equal(fieldsForType(kind).includes("invocationFrom"), true, "a spell is the default domain");
    const ability = fieldsForType(kind, "ability");
    for (const name of ["invocationFrom", "invocationTo"]) assert.ok(!ability.includes(name), `${kind} offers ${name} to an ability`);
  }
  assert.ok(!fieldsForType("spellcastingMod", "ability").includes("invocationFrom"), "the spellcasting row's one kept spell field is not the range");
});

await t("each field is a whole-number box with a hint, and a blank side shows blank", async () => {
  const contextOf = async (row, domain = "spell") => {
    const editor = new EffectRowEditor({ store: { key: "s", label: "S", domain, read: () => [row] }, index: 0 });
    return (await editor._prepareContext({})).fields;
  };
  const set = await contextOf({ type: "damage", invocationFrom: 2 });
  const from = set.find((f) => f.name === "invocationFrom");
  const to = set.find((f) => f.name === "invocationTo");
  assert.equal(from.kind, "number");
  assert.equal(from.step, "1", "whole levels only");
  assert.equal(from.value, 2);
  assert.equal(to.value, "", "an unset side is blank");
  assert.equal(to.label, "ACKS-LIB.effectEditor.field.invocationTo");
  assert.equal(from.tip, "ACKS-LIB.effectEditor.tip.invocationFrom");
  assert.equal(to.tip, "ACKS-LIB.effectEditor.tip.invocationTo");
  const unset = await contextOf({ type: "damage", invocationFrom: null, invocationTo: null });
  assert.deepEqual(unset.filter((f) => f.name.startsWith("invocation")).map((f) => f.value), ["", ""], "a null side is blank, not 0");
  const ability = await contextOf({ type: "modifier" }, "ability");
  assert.ok(!ability.some((f) => f.name.startsWith("invocation")), "an ability's row shows neither");
});

await t("the lang carries a label and a hint for each field, and no literal id was added", () => {
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  for (const name of ["invocationFrom", "invocationTo"]) {
    assert.ok(lang[`ACKS-LIB.effectEditor.field.${name}`], `${name} label`);
    assert.ok(lang[`ACKS-LIB.effectEditor.tip.${name}`], `${name} hint`);
  }
  const hbs = readFileSync(new URL("../templates/lib/effect-row-editor.hbs", import.meta.url), "utf8");
  assert.ok(!/\bid="(?!\{\{@root\.partId\}\})/.test(hbs), "no literal id in the editor template");
});

console.log(`\n${n} tests passed`);
