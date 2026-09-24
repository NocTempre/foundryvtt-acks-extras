/**
 * Offline tests for the magic vocabulary (`scripts/lib/magic-vocab.mjs`) and
 * the seams that share it: the lang file, the monsters feature's `USAGE`, the
 * importer's frequency scan and the effect-type domains. Foundry-free; every
 * fixture sentence below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-magic.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V from "../scripts/lib/vocab.mjs";
import { MAGIC_VOCAB, SPELL_LIKE_FREQ, vocabChoices, vocabLabel } from "../scripts/lib/magic-vocab.mjs";
import { USAGE } from "../scripts/monsters/config.mjs";
import { effectScan } from "../scripts/importer/executor.mjs";

const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ENUM_PREFIX = "ACKS-LIB.enum.";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ------------------------------------------------------------------ */
/*  The vocabulary and its lang keys                                   */
/* ------------------------------------------------------------------ */

t("every magic family member has a lang string, and every enum lang key names a member", () => {
  const missing = [];
  for (const [family, members] of Object.entries(MAGIC_VOCAB)) {
    for (const key of Object.keys(members)) {
      const full = `${ENUM_PREFIX}${family}.${key}`;
      if (typeof lang[full] !== "string" || !lang[full].trim()) missing.push(full);
    }
  }
  assert.deepEqual(missing, [], "members without a lang string");
  const orphans = Object.keys(lang)
    .filter((k) => k.startsWith(ENUM_PREFIX))
    .filter((k) => {
      const [family, key, ...rest] = k.slice(ENUM_PREFIX.length).split(".");
      return rest.length > 0 || !MAGIC_VOCAB[family]?.[key];
    });
  assert.deepEqual(orphans, [], "lang keys without a member");
});

t("every family is frozen, labelled inline, and reachable through vocab.mjs", () => {
  const exported = new Set(Object.values(V));
  for (const [family, members] of Object.entries(MAGIC_VOCAB)) {
    assert.ok(Object.isFrozen(members), `${family} is frozen`);
    assert.ok(exported.has(members), `${family} is re-exported from vocab.mjs`);
    for (const [key, m] of Object.entries(members)) {
      assert.ok(typeof m.label === "string" && m.label.trim(), `${family}.${key} carries an inline label`);
    }
  }
  assert.equal(V.vocabLabel, vocabLabel);
  assert.equal(V.SPELL_LIKE_FREQ, SPELL_LIKE_FREQ);
});

t("vocabLabel falls back to the inline label under Node and to the client's string when it has one", () => {
  assert.equal(vocabLabel("spellType", "blast"), "Blast");
  assert.equal(vocabLabel("spellType", ""), "");
  assert.equal(vocabLabel("spellType", null), "");
  assert.equal(vocabLabel("spellType", "unknownKey"), "unknownKey");
  assert.equal(vocabLabel("noSuchFamily", "x"), "x");
  const saved = globalThis.game;
  globalThis.game = {
    i18n: { has: (k) => k === "ACKS-LIB.enum.spellType.blast", localize: (k) => `L:${k}` },
  };
  try {
    assert.equal(vocabLabel("spellType", "blast"), "L:ACKS-LIB.enum.spellType.blast");
    assert.equal(vocabLabel("spellType", "death"), "Death", "a key the client lacks falls back");
    const choices = vocabChoices("saveEffect");
    assert.deepEqual(Object.keys(choices), Object.keys(MAGIC_VOCAB.saveEffect));
    assert.deepEqual(vocabChoices("noSuchFamily"), {});
  } finally {
    globalThis.game = saved;
  }
});

/* ------------------------------------------------------------------ */
/*  One frequency vocabulary                                           */
/* ------------------------------------------------------------------ */

t("the monsters USAGE table is the shared frequency vocabulary and keeps every key it stored", () => {
  assert.equal(USAGE, SPELL_LIKE_FREQ);
  for (const k of ["atWill", "perTurn", "per3Turns", "perHour", "thricePerDay", "perDay", "perWeek", "perMonth", "perSeason", "perYear"]) {
    assert.ok(k in USAGE, `former USAGE key ${k}`);
  }
  for (const k of ["perRound", "per8Hours", "byLevel"]) assert.ok(k in SPELL_LIKE_FREQ, `former SPELL_LIKE_FREQ key ${k}`);
  for (const [k, m] of Object.entries(SPELL_LIKE_FREQ)) assert.equal("factor" in m, false, `${k} carries no printed factor`);
});

t("the importer's frequency scan emits shared keys, including the three the monsters table added", () => {
  const freqOf = (text) => effectScan([{ text }], {}).find((e) => e.type === "spellLike")?.frequency;
  const cases = {
    "It can cast glimmer (as the spell) once per three turns.": "per3Turns",
    "It can cast glimmer (as the spell) once every 3 turns.": "per3Turns",
    "It can cast glimmer (as the spell) three times per day.": "thricePerDay",
    "It can cast glimmer (as the spell) thrice per day.": "thricePerDay",
    "It can cast glimmer (as the spell) once per season.": "perSeason",
    "It can cast glimmer (as the spell) once per day.": "perDay",
    "It can cast glimmer (as the spell) once per turn.": "perTurn",
    "It can cast glimmer (as the spell) at will.": "atWill",
  };
  for (const [text, key] of Object.entries(cases)) {
    assert.equal(freqOf(text), key, text);
    assert.ok(key in SPELL_LIKE_FREQ, `${key} is a member`);
  }
  assert.equal(freqOf("It can cast glimmer (as the spell) whenever it likes."), undefined, "no phrase, no frequency");
});

/* ------------------------------------------------------------------ */
/*  Effect-type domains                                                */
/* ------------------------------------------------------------------ */

t("spell-only effect kinds stay out of the ability picker and inside the spell one", () => {
  const ability = Object.keys(V.effectTypesFor("ability"));
  const spell = Object.keys(V.effectTypesFor("spell"));
  const spellOnly = Object.entries(V.EFFECT_TYPES).filter(([, v]) => v.domain === "spell").map(([k]) => k);
  assert.ok(spellOnly.length >= 15, "the spell kinds are declared");
  for (const k of spellOnly) {
    assert.ok(!ability.includes(k), `${k} is hidden from abilities`);
    assert.ok(spell.includes(k), `${k} is offered to spells`);
  }
  for (const k of ["modifier", "conditionGrant", "spellLike", "resource", "immunity"]) {
    assert.ok(ability.includes(k) && spell.includes(k), `${k} is shared`);
  }
  assert.deepEqual(spell, Object.keys(V.EFFECT_TYPES), "a spell may carry every kind");
});

console.log(`\n${n} magic tests passed`);
