/**
 * Offline tests for the five summon rows the spells register authors and for
 * `summonOptionsOf` carrying a row's `max`. The rows are read from the register
 * and from the compiled cookbook; their locators run through the importer's
 * own `materializeEffects` against invented sentences shaped to the patterns,
 * so this file carries no book content. Foundry-free.
 *
 * Usage: node tools/test-magic-summon-rows.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { materializeEffects } from "../scripts/importer/executor.mjs";
import { summonOptionsOf } from "../scripts/magic/summon-spell.mjs";
import { spellRecipeProblems } from "./importer/spell-recipe-rules.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const register = read("register/rr/p196-p262-spells.json");
const cookbook = read("cookbook/spells.json").entries;
const creatures = read("cookbook/mm.json").entries;

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const CALLING = "def.spell.callOfTheWolf";
const SUMMONING = "def.spell.summonManes";
const CONJURATION = "def.spell.conjureCacodemonSpawn";
const REMAINS = ["def.spell.faithfulCompanion", "def.spell.unlivingPuppet"];
const FIVE = [CALLING, SUMMONING, CONJURATION, ...REMAINS];

const rowsOf = (id) => register.find((e) => e.id === id)?.effects ?? [];
const only = (id) => {
  const rows = rowsOf(id);
  assert.equal(rows.length, 1, `${id} has one row`);
  return rows[0];
};
const located = (id, text) => materializeEffects(rowsOf(id), [text])[0];

t("every one of the five entries carries one keyed summon row", () => {
  for (const id of FIVE) {
    const row = only(id);
    assert.equal(row.type, "summon", id);
    assert.equal(row.key, "creature", id);
  }
});

t("the five rows pass the spell recipe rules, in the register and as compiled", () => {
  for (const id of FIVE) {
    assert.deepEqual(spellRecipeProblems({ effects: rowsOf(id) }), [], `${id} register`);
    assert.deepEqual(spellRecipeProblems({ effects: cookbook[id].fields.effects.specs }), [], `${id} cookbook`);
    assert.deepEqual(cookbook[id].fields.effects.specs, rowsOf(id), `${id}: the compiled specs are the register's`);
  }
});

t("the rules take a summon format and a control kind, and refuse any other word", () => {
  const row = { key: "creature", type: "summon" };
  assert.deepEqual(spellRecipeProblems({ effects: [{ ...row, summonFormat: "calling", control: "cooperative" }] }), []);
  assert.deepEqual(spellRecipeProblems({ effects: [row] }), [], "both are optional");
  assert.match(spellRecipeProblems({ effects: [{ ...row, summonFormat: "rite" }] }).join("\n"), /summonFormat "rite" is not a summon format/);
  assert.match(spellRecipeProblems({ effects: [{ ...row, control: "loyal" }] }).join("\n"), /control "loyal" is not a control kind/);
});

t("the formats and controls are the structure each entry's kind of spell states", () => {
  assert.deepEqual([only(CALLING).summonFormat, only(CALLING).control], ["calling", "cooperative"]);
  assert.deepEqual([only(SUMMONING).summonFormat, only(SUMMONING).control], ["summoning", "obedient"]);
  assert.deepEqual([only(CONJURATION).summonFormat, only(CONJURATION).control], ["conjuration", "obedient"]);
  for (const id of REMAINS) assert.deepEqual([only(id).summonFormat, only(id).control], [undefined, "obedient"], `${id}: no summon format`);
});

t("a row names its creature by a cookbook id the compiled monsters hold, except the conjuration's", () => {
  assert.ok(creatures[only(CALLING).ref], "the calling's creature");
  assert.ok(creatures[only(SUMMONING).ref], "the summoning's creature");
  for (const id of [CONJURATION, ...REMAINS]) assert.equal(only(id).ref, undefined, `${id} names no creature`);
});

t("no figure is written: count, Hit Dice and ceiling are located or absent", () => {
  for (const id of FIVE) for (const field of ["amount", "value", "max"]) assert.equal(only(id)[field], undefined, `${id}.${field} is never a literal`);
  assert.deepEqual(only(CALLING).from.map((l) => l.into), ["amount"]);
  assert.deepEqual(only(SUMMONING).from.map((l) => l.into), ["max"]);
  assert.deepEqual(only(CONJURATION).from.map((l) => l.into), ["amount", "value"]);
  for (const id of REMAINS) assert.equal(only(id).from, undefined, `${id}: its Hit Dice come from the remains`);
  for (const id of [CALLING, SUMMONING, CONJURATION]) assert.equal(only(id).onMiss, "blank", `${id} keeps its row when a figure is missed`);
});

t("the calling's count is read through an article as one", () => {
  const row = located(CALLING, "This spell calls a hound to the caster to serve for a day.");
  assert.equal(row.amount, 1);
  assert.equal(row.unread, undefined);
  assert.equal(row.max, undefined);
  assert.equal(only(CALLING).from[0].articles, true);
});

t("the summoning's count is a ceiling per level carried in max, and states no amount", () => {
  const row = located(SUMMONING, "This spell summons one imp per level of experience to serve the caster.");
  assert.deepEqual(row.max, { kind: "perLevel", base: 1, per: 1 });
  assert.equal(row.amount, undefined, "an amount would cap the count at one");
  const caster = located(SUMMONING, "This spell summons one imp per caster level to serve the caster.");
  assert.deepEqual(caster.max, { kind: "perLevel", base: 1, per: 1 });
});

t("the conjuration's Hit Dice and count are located and its row carries no creature", () => {
  const row = located(CONJURATION, "This spell opens a portal, allowing the caster to conjure a fiend with 3 HD and two powers.");
  assert.equal(row.amount, 1);
  assert.deepEqual(row.value, { kind: "flat", flat: 3 });
  assert.equal(row.ref, undefined);
  assert.equal(row.unread, undefined);
});

t("a page that prints none of it leaves the figures blank and the row standing, listed unread", () => {
  const calling = located(CALLING, "This spell serves the caster for a day.");
  assert.deepEqual([calling.type, calling.ref, calling.amount, calling.unread], ["summon", only(CALLING).ref, undefined, ["amount"]]);
  const summoning = located(SUMMONING, "This spell serves the caster.");
  assert.deepEqual([summoning.max, summoning.unread], [undefined, ["max"]]);
  const conjuration = located(CONJURATION, "This spell opens a portal.");
  assert.deepEqual([conjuration.amount, conjuration.value, conjuration.unread], [undefined, undefined, ["amount", "value"]]);
});

t("the undead pair's rows are the same with or without a page: nothing is located", () => {
  for (const id of REMAINS) {
    assert.deepEqual(materializeEffects(rowsOf(id), ["Any text at all."]), materializeEffects(rowsOf(id), []));
    assert.deepEqual(materializeEffects(rowsOf(id), []), [{ key: "creature", type: "summon", control: "obedient" }]);
  }
});

const rowOf = (extra) => ({ type: "summon", ref: "x.ref", amount: 2, value: { kind: "flat", flat: 3 }, summonFormat: "calling", control: "cooperative", ...extra });
const withRows = (rows) => ({ flags: { "acks-extras": { spell: { effects: rows } } } });

t("summonOptionsOf carries a row's max through unresolved, the same object", () => {
  const max = { kind: "perLevel", base: 1, per: 1 };
  const [option] = summonOptionsOf(withRows([rowOf({ max })]));
  assert.equal(option.max, max, "not resolved, not copied");
  assert.deepEqual([option.amount, option.value, option.summonFormat, option.control], [2, { kind: "flat", flat: 3 }, "calling", "cooperative"]);
});

t("summonOptionsOf answers a null max for a row with none, and reads a twin's max", () => {
  assert.equal(summonOptionsOf(withRows([rowOf()]))[0].max, null);
  const max = { kind: "perLevel", base: 1, per: 1 };
  const twin = withRows([rowOf({ max })]);
  assert.deepEqual(summonOptionsOf(withRows([]), { twin })[0].max, max);
  assert.equal(summonOptionsOf(withRows([]), { twin: null }).length, 0);
});

t("a materialized register row reaches summonOptionsOf with its located max and no amount", () => {
  const rows = materializeEffects(rowsOf(SUMMONING), ["This spell summons one imp per level of experience."]);
  const [option] = summonOptionsOf(withRows(rows));
  assert.deepEqual(option.max, { kind: "perLevel", base: 1, per: 1 });
  assert.equal(option.amount, 0, "a row stating no amount sets no limit");
  assert.equal(option.ref, only(SUMMONING).ref);
});

console.log(`\n${n} magic summon row tests passed`);
