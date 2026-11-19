/**
 * Offline tests for the register rows of the four spells of slice K2 (an
 * affliction's delay, a purifying, a sealing and a sensing): each entry's
 * compiled recipe (`cookbook/spells.json`, from `register/rr/p196-p262-spells.json`)
 * holds the shape the cast's new kinds read (`cast-kinds.mjs`), and the
 * importer's materializer turns a located quantity into the value a card line
 * prints. Foundry-free.
 *
 * What a page prints is not here: every figure and every page text below is
 * invented. Whether the locators match the printed page is a rules test
 * (`tools/rules-tests/`, machine-local).
 *
 * Usage: node tools/test-magic-k2-rows.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key }, system: { id: "acks" }, user: { targets: new Set() } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };

const { spellRecipeProblems } = await import("./importer/spell-recipe-rules.mjs");
const { materializeEffects } = await import("../scripts/importer/executor.mjs");
const { EFFECT_KEYS } = await import("../scripts/lib/vocab.mjs");
const { keyedRows } = await import("../scripts/magic/cast-rows.mjs");
const { placeOf, rowOpens, writesRecipientRecord, takesTargets, APPLY_KINDS } = await import("../scripts/magic/cast-kinds.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cb = JSON.parse(fs.readFileSync(path.join(REPO, "cookbook", "spells.json"), "utf8"));

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const ID = {
  delay: "def.spell.delayDisease",
  purify: "def.spell.purifyFoodAndWater",
  seal: "def.spell.sealPortal",
  locate: "def.spell.locateAnimalOrPlant",
};
const specsOf = (id) => cb.entries[id].fields.effects.specs;
/** A spec as the row a materialized import leaves: no recipe keys, plus the located fields a test names. */
const asRow = (spec, located = {}) => {
  const { from, each, onMiss, noteFrom, ...row } = spec;
  return { ...row, origin: "register", ...located };
};
const keyed = (id) => keyedRows(specsOf(id).map((s) => asRow(s)));

/* ------------------------------------------------------------------ */
/*  The compiled recipes                                               */
/* ------------------------------------------------------------------ */

t("the four entries carry recipes in the compiled cookbook, and the recipe lint finds nothing in them", () => {
  for (const id of Object.values(ID)) {
    assert.ok(specsOf(id)?.length, `${id} effects`);
    assert.deepEqual(spellRecipeProblems({ effects: specsOf(id), values: cb.entries[id].fields.values?.specs ?? [] }), [], id);
    for (const s of specsOf(id)) assert.match(s.key, /^[a-z][A-Za-z0-9]*$/);
  }
  assert.deepEqual(Object.values(ID).map((id) => specsOf(id).map((s) => [s.key, s.type])), [
    [["delay", "afflictionDelay"]],
    [["water", "purify"], ["food", "purify"]],
    [["seal", "seal"]],
    [["sense", "detect"]],
  ]);
});

t("every kind a row names is one the cast dispatches, and the effect words are lib's own", () => {
  for (const id of Object.values(ID)) {
    for (const s of specsOf(id)) {
      assert.ok(Object.hasOwn(APPLY_KINDS, s.type), `${id} ${s.key}`);
      for (const k of s.effects ?? []) assert.ok(Object.hasOwn(EFFECT_KEYS, k), `${id} ${s.key} ${k}`);
    }
  }
  assert.deepEqual(specsOf(ID.delay)[0].effects, ["disease"]);
});

t("no row carries a figure: every number rides a located field, so an unread page leaves each one blank", () => {
  for (const id of Object.values(ID)) {
    for (const s of specsOf(id)) {
      for (const field of ["value", "amount", "range", "max", "rounds", "unit"]) assert.equal(s[field], undefined, `${id} ${s.key} ${field}`);
      // A note is a neutral one-word label naming the row, which the page's own words replace at import (noteFrom).
      if (s.note !== undefined) assert.ok(/^[a-z]+$/.test(s.note) && s.noteFrom?.pattern, `${id} ${s.key} note is a label with a locator`);
    }
  }
  const located = specsOf(ID.purify).flatMap((s) => (s.from ?? []).map((l) => [s.key, l.into, s.onMiss]));
  assert.deepEqual(located, [["water", "value", "blank"], ["food", "value", "blank"]]);
});

/* ------------------------------------------------------------------ */
/*  How the cast reads each row                                        */
/* ------------------------------------------------------------------ */

t("delay: a recipient record that lasts the duration, and the one row of the four that opens a target's entry", () => {
  const [{ row }] = keyed(ID.delay);
  assert.deepEqual([row.appliesTo, row.lasts], ["recipient", "duration"]);
  assert.equal(writesRecipientRecord(row), true);
  assert.deepEqual([placeOf(row), rowOpens(row)], ["rowAndLine", true]);
  assert.equal(takesTargets(keyed(ID.delay)), true);
  assert.match(describeSpellEffect(row).text, /Disease/);
});

t("purify, seal and locate are card lines that write no recipient record, so a cast of one measures no target", () => {
  for (const id of [ID.purify, ID.seal, ID.locate]) {
    for (const { row } of keyed(id)) {
      assert.deepEqual([placeOf(row), writesRecipientRecord(row)], ["line", false], `${id} ${row.key}`);
    }
    assert.equal(takesTargets(keyed(id)), false, id);
  }
  for (const id of [ID.purify, ID.seal]) assert.ok(keyed(id).every(({ row }) => rowOpens(row) === false), `${id} opens no entry`);
});

t("seal and locate last the duration, so the caster's record stands on them; purify is spent in the cast", () => {
  assert.deepEqual(keyed(ID.seal).map(({ row }) => row.lasts), ["duration"]);
  assert.deepEqual(keyed(ID.locate).map(({ row }) => row.lasts), ["duration"]);
  assert.deepEqual(keyed(ID.purify).map(({ row }) => row.lasts), ["instant", "instant"]);
});

/* ------------------------------------------------------------------ */
/*  Locating the quantity                                              */
/* ------------------------------------------------------------------ */

/** An invented page: the figures here are made up, and the shape is a quantity beside each noun. */
const paras = (...lines) => lines.map((text) => ({ text }));

t("purify: each quantity is read from the page into the row's value, and an unread page leaves both blank and listed", () => {
  const read = materializeEffects(specsOf(ID.purify), paras("The spell cleans 7 gallons of water or 9 lbs. of food for the day."));
  assert.deepEqual(read.map((r) => [r.key, r.value]), [["water", { kind: "flat", flat: 7 }], ["food", { kind: "flat", flat: 9 }]]);
  assert.equal(describeSpellEffect(read[0]).text, "Purify: Everything in the area: 7 (gallons of water)", "the page names what each quantity measures");
  assert.deepEqual(read.map((r) => r.note), ["gallons of water", "lbs. of food"]);
  const bare = materializeEffects(specsOf(ID.purify), []);
  assert.deepEqual(bare.map((r) => [r.key, r.value, r.unread]), [["water", undefined, ["value"]], ["food", undefined, ["value"]]]);
  assert.deepEqual(materializeEffects(specsOf(ID.purify), paras("Another page that names neither quantity.")).map((r) => r.unread), [["value"], ["value"]]);
});

t("delay, seal and locate need no locator, so a bookless import still writes each row whole", () => {
  for (const id of [ID.delay, ID.seal, ID.locate]) {
    const rows = materializeEffects(specsOf(id), []);
    assert.equal(rows.length, specsOf(id).length, id);
    assert.ok(rows.every((r) => !("unread" in r)), id);
  }
  assert.deepEqual(materializeEffects(specsOf(ID.delay), [])[0].effects, ["disease"]);
});

console.log(`\n${n} tests passed`);
