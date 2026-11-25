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
import { MAGIC_VOCAB, REGISTER_KEY, SPELL_LIKE_FREQ, printedFrequencyText, vocabChoices, vocabLabel } from "../scripts/lib/magic-vocab.mjs";
import { USAGE } from "../scripts/monsters/config.mjs";
import { effectScan, frequencyOf, frequencyTextOf, frequencyFieldsOf, FREQ } from "../scripts/importer/executor.mjs";
import { splitSpellNames, titleIndex, scanMonsterSpells, castsAsClass, castSourceOf, levelUnder } from "../scripts/magic/spell-names.mjs";
import { slotsFromCells, coreSlotsPatch, slotsOfSystem, drawRepertoire } from "../scripts/magic/repertoire.mjs";
import {
  parseRangeLine,
  parseDurationLine,
  displayRange,
  displayDuration,
  coreFieldsFrom,
  traditionLabel,
  spellTraditions,
  spellDedupeKey,
  splitList,
  parseStatBlock,
  spellFromStat,
  reversedNameFrom,
  headingCase,
  retiredWith,
} from "../scripts/magic/spell-logic.mjs";
import { describeSpellEffect, effectRowView } from "../scripts/magic/describe.mjs";
import { areaExtent } from "../scripts/magic/cast-area.mjs";
import { DISTANCE_UNITS as SCENE_UNITS } from "../scripts/lib/distance-units.mjs";
import { castDuration, NONE } from "../scripts/magic/cast-duration.mjs";
import { spellEffectData, spellEffectOf, newCastId } from "../scripts/magic/spell-effect.mjs";
import { isSummonSpell, summonOptionsOf, libraryTwin, resolveSummonRef, SUMMONING_TYPE } from "../scripts/magic/summon-spell.mjs";
import * as timeUnit from "../scripts/lib/time-unit.mjs";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import { TIME_COUNTS, TURN_SECONDS, ROUND_SECONDS } from "./time-unit-fixture.mjs";

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

/**
 * Every phrase one frequency anchor reads, spelled out from the anchor
 * itself: `\b` dropped, each `(?:a|b)` group fanned out, the top-level
 * alternatives split. The printed wordings this file feeds the scan are the
 * anchors' own, so no phrase is written here.
 */
const phrasesOf = (re) => {
  let forms = [re.source.replace(/\\b/g, "")];
  for (;;) {
    const next = forms.flatMap((f) => {
      const g = /\(\?:([^()]*)\)/.exec(f);
      return g ? g[1].split("|").map((alt) => f.slice(0, g.index) + alt + f.slice(g.index + g[0].length)) : [f];
    });
    if (next.length === forms.length && next.every((f, i) => f === forms[i])) break;
    forms = next;
  }
  return forms.flatMap((f) => f.split("|"));
};
const anchorOf = (key) => FREQ.find(([, k]) => k === key)[0];
const PRINTED = Object.keys(SPELL_LIKE_FREQ).filter((k) => SPELL_LIKE_FREQ[k].printed);
const printedPhrase = (key) => phrasesOf(anchorOf(key))[0];

t("the monsters USAGE table is the shared frequency vocabulary and carries every frequency key", () => {
  assert.equal(USAGE, SPELL_LIKE_FREQ);
  for (const k of ["atWill", "perRound", "perTurn", "perHour", "perDay", "perWeek", "perMonth", "perSeason", "perYear", "byLevel"]) {
    assert.ok(k in USAGE, `USAGE carries key ${k}`);
  }
  for (const [k, m] of Object.entries(SPELL_LIKE_FREQ)) assert.equal("factor" in m, false, `${k} carries no printed factor`);
});

t("the three printed frequencies are neutral members whose wording is the book's", () => {
  assert.deepEqual(PRINTED, ["printedFreq1", "printedFreq2", "printedFreq3"]);
  for (const k of PRINTED) {
    assert.match(SPELL_LIKE_FREQ[k].label, /^Printed frequency \d \(from the book\)$/);
    assert.equal(lang[`${ENUM_PREFIX}spellLikeFreq.${k}`], SPELL_LIKE_FREQ[k].label, `${k} lang label matches`);
  }
});

t("the importer's frequency scan emits shared keys, each anchor to the member it names", () => {
  const freqOf = (text) => effectScan([{ text }], {}).find((e) => e.type === "spellLike")?.frequency;
  const cases = {
    "It can cast glimmer (as the spell) once per season.": "perSeason",
    "It can cast glimmer (as the spell) once per day.": "perDay",
    "It can cast glimmer (as the spell) once per turn.": "perTurn",
    "It can cast glimmer (as the spell) at will.": "atWill",
  };
  for (const [text, key] of Object.entries(cases)) {
    assert.equal(freqOf(text), key, text);
    assert.ok(key in SPELL_LIKE_FREQ, `${key} is a member`);
  }
  for (const [re, key] of FREQ) {
    assert.ok(key in SPELL_LIKE_FREQ, `${key} is a member`);
    for (const phrase of phrasesOf(re)) assert.equal(freqOf(`It can cast glimmer (as the spell) ${phrase}.`), key, `${key}: ${phrase}`);
  }
  assert.equal(freqOf("It can cast glimmer (as the spell) whenever it likes."), undefined, "no phrase, no frequency");
});

t("a printed frequency keeps the page's words beside its key; any other keeps none", () => {
  for (const key of PRINTED) {
    for (const phrase of phrasesOf(anchorOf(key))) {
      assert.deepEqual(frequencyFieldsOf(`It can cast glimmer (as the spell) ${phrase.toUpperCase()}.`), { frequency: key, frequencyText: phrase.toUpperCase() }, `${key}: ${phrase}`);
    }
    const spellLike = effectScan([{ text: `It can cast glimmer (as the spell) ${printedPhrase(key)}.` }], {}).find((e) => e.type === "spellLike");
    assert.deepEqual([spellLike.frequency, spellLike.frequencyText], [key, printedPhrase(key)]);
    const capability = effectScan([{ text: `It may be used ${printedPhrase(key)}.` }], {}).find((e) => e.type === "capability");
    assert.deepEqual([capability.frequency, capability.frequencyText], [key, printedPhrase(key)]);
  }
  assert.deepEqual(frequencyFieldsOf("It can cast glimmer at will."), { frequency: "atWill" });
  assert.deepEqual(frequencyFieldsOf("whenever it likes"), {});
  assert.equal(frequencyTextOf("once per week"), "");
  assert.equal(printedFrequencyText("perWeek", "a stray phrase"), "", "a structural member never shows a stored phrase");
  assert.equal(printedFrequencyText("printedFreq1", "  the printed words "), "the printed words");
  assert.equal(printedFrequencyText("printedFreq1", undefined), "");
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

/* ------------------------------------------------------------------ */
/*  The spell primitive's pure logic (scripts/magic/spell-logic.mjs)   */
/*  Every line below is invented; none is a printed stat line.        */
/* ------------------------------------------------------------------ */

t("a range line reads into its shape and writes back as one line", () => {
  const cases = [
    ["self", { shape: "self", value: null, unit: "", note: "" }, "self"],
    ["Touch", { shape: "touch", value: null, unit: "", note: "" }, "touch"],
    ["special", { shape: "special", value: null, unit: "", note: "" }, "special"],
    ["45'", { shape: "distance", value: 45, unit: "feet", note: "" }, "45'"],
    ["1,250 feet", { shape: "distance", value: 1250, unit: "feet", note: "" }, "1250'"],
    ["3 miles", { shape: "distance", value: 3, unit: "miles", note: "" }, "3 miles"],
    ["1 mile", { shape: "distance", value: 1, unit: "miles", note: "" }, "1 mile"],
    ["15’/level", { shape: "distancePerLevel", value: 15, unit: "feet", note: "" }, "15'/level"],
    ["2 miles per caster level", { shape: "distancePerLevel", value: 2, unit: "miles", note: "" }, "2 miles/level"],
    ["touch (75')", { shape: "touchOrDistance", value: 75, unit: "feet", note: "" }, "touch (75')"],
    ["75' (touch)", { shape: "touchOrDistance", value: 75, unit: "feet", note: "" }, "touch (75')"],
    ["Unlimited", { shape: "unlimited", value: null, unit: "", note: "" }, "unlimited"],
  ];
  for (const [line, parsed, display] of cases) {
    assert.deepEqual(parseRangeLine(line), parsed, line);
    assert.equal(displayRange(parsed), display, `display of ${line}`);
  }
  const unread = parseRangeLine("as far as the eye can see");
  assert.equal(unread.shape, "", "an unread line has no shape");
  assert.equal(unread.note, "as far as the eye can see", "and keeps its text");
  assert.equal(displayRange(unread), "as far as the eye can see", "a blank shape shows the note alone");
  assert.equal(displayRange({ shape: "", note: "" }), "", "a blank shape with no note writes nothing");
  assert.deepEqual(parseRangeLine(""), { shape: "", value: null, unit: "", note: "" });
});

t("a duration line reads into its shape and writes back as one line", () => {
  const blank = { shape: "", value: null, unit: "", dice: "", plus: { value: null, unit: "" }, concentration: "", maxPerLevel: false, note: "" };
  const cases = [
    ["Instantaneous", { ...blank, shape: "instantaneous" }, "instantaneous"],
    ["permanent", { ...blank, shape: "permanent" }, "permanent"],
    ["perpetual", { ...blank, shape: "perpetual" }, "perpetual"],
    ["indefinite", { ...blank, shape: "indefinite" }, "indefinite"],
    ["special", { ...blank, shape: "special" }, "special"],
    ["7 rounds", { ...blank, shape: "fixed", value: 7, unit: "rounds" }, "7 rounds"],
    ["1 turn", { ...blank, shape: "fixed", value: 1, unit: "turns" }, "1 turn"],
    ["2 turns (2 hours)", { ...blank, shape: "fixed", value: 2, unit: "turns", note: "(2 hours)" }, "2 turns (2 hours)"],
    ["1 day or permanent", { ...blank, shape: "fixed", value: 1, unit: "days", note: "or permanent" }, "1 day or permanent"],
    ["3 turns/level", { ...blank, shape: "perLevel", value: 3, unit: "turns" }, "3 turns/level"],
    ["1 hour per caster level", { ...blank, shape: "perLevel", value: 1, unit: "hours" }, "1 hour/level"],
    ["6 turns + 1 turn/caster level", { ...blank, shape: "basePlusPerLevel", value: 6, unit: "turns", plus: { value: 1, unit: "turns" } }, "6 turns + 1 turn/level"],
    ["2d4 rounds", { ...blank, shape: "dice", dice: "2d4", unit: "rounds" }, "2d4 rounds"],
    ["concentration", { ...blank, shape: "concentration", concentration: "mobile" }, "concentration"],
    ["stationary concentration", { ...blank, shape: "concentration", concentration: "stationary" }, "stationary concentration"],
    ["concentration + 2 rounds", { ...blank, shape: "concentrationPlus", concentration: "mobile", plus: { value: 2, unit: "rounds" } }, "concentration + 2 rounds"],
    ["concentration (1 round/level)", { ...blank, shape: "concentrationMax", concentration: "mobile", value: 1, unit: "rounds", maxPerLevel: true }, "concentration (1 round/level)"],
    ["stationary concentration (4 turns)", { ...blank, shape: "concentrationMax", concentration: "stationary", value: 4, unit: "turns" }, "stationary concentration (4 turns)"],
  ];
  for (const [line, parsed, display] of cases) {
    assert.deepEqual(parseDurationLine(line), parsed, line);
    assert.equal(displayDuration(parsed), display, `display of ${line}`);
  }
  const unread = parseDurationLine("until it happens");
  assert.equal(unread.shape, "");
  assert.equal(unread.note, "until it happens");
  assert.equal(displayDuration(unread), "until it happens", "a blank shape shows the note alone");
  assert.equal(displayDuration({ ...blank }), "", "a blank shape with no note writes nothing");
});

t("core's strings are derived only where the flag states a shape", () => {
  assert.deepEqual(coreFieldsFrom({}), {}, "an empty flag states nothing");
  assert.deepEqual(coreFieldsFrom({ range: { shape: "" }, duration: { shape: "" }, lists: [] }), {});
  const full = coreFieldsFrom({
    lists: [{ source: "arcane", level: 3, classes: [] }, { source: "divine", level: 4, classes: [] }],
    range: { shape: "distance", value: 90, unit: "feet" },
    duration: { shape: "perLevel", value: 1, unit: "turns" },
    save: { category: "spell" },
  });
  assert.deepEqual(full, { lvl: 3, class: "Arcane", range: "90'", duration: "1 turn/level", save: "spell" });
  assert.deepEqual(coreFieldsFrom({ save: { category: "none" } }), { save: "" }, "no save writes core's blank");
  assert.deepEqual(coreFieldsFrom({ lists: [{ source: "", level: 2.5 }] }), {}, "a fractional level is not a level");
  assert.equal(traditionLabel("eldritch"), "Eldritch");
});

t("a spell's traditions come from its lists, else core's class string", () => {
  assert.deepEqual(spellTraditions({ lists: [{ source: "arcane" }, { source: "Divine" }, { source: "arcane" }] }, "Divine"), ["arcane", "divine"]);
  assert.deepEqual(spellTraditions({ lists: [] }, "Arcane"), ["arcane"]);
  assert.deepEqual(spellTraditions(undefined, ""), [], "no tradition named");
  // An imported copy and a core-pack copy of one spell share the name and
  // nothing else, so the name is the key — an importer id would keep them apart.
  assert.equal(spellDedupeKey("Glimmer"), "name:glimmer");
  assert.equal(spellDedupeKey("Glim-mer "), "name:glimmer", "folded on the name");
  assert.equal(splitList(" a, b ,,c ").join("|"), "a|b|c");
  assert.deepEqual(splitList(["x", " y "]), ["x", "y"]);
});

t("a spell's subjects are relative to the cast; an ability's picker never sees them", () => {
  const ability = Object.keys(V.effectSubjectsFor("ability"));
  const spell = Object.keys(V.effectSubjectsFor("spell"));
  for (const k of ["target", "recipient", "area"]) {
    assert.ok(!ability.includes(k), `${k} hidden from abilities`);
    assert.ok(spell.includes(k), `${k} offered to spells`);
  }
  assert.ok(ability.includes("self") && spell.includes("self"));
});

{
  const { RECORD_KINDS, APPLY_KINDS } = await import("../scripts/magic/cast-kinds.mjs");
  t("every kind of the dispatch is offered to a spell, and each that can be a section of the card has its heading", () => {
    for (const type of Object.keys(APPLY_KINDS)) assert.ok(Object.hasOwn(V.effectTypesFor("spell"), type), `${type} is offered to a spell`);
    for (const type of ["afflictionDelay", "purify", "seal"]) assert.equal(V.EFFECT_TYPES[type]?.domain, "spell", `${type} is a spell kind`);
    for (const type of RECORD_KINDS) assert.ok(lang[`ACKS-MAGIC.cast.row.${type}`], `${type} has a card heading`);
  });
}

t("effect rows read as one line each, spell kinds and shared kinds alike", () => {
  const line = (e) => describeSpellEffect(e).text;
  assert.equal(line({ type: "damage", appliesTo: "area", roll: "1d6", damage: ["fire"] }), "Everything in the area: 1d6 fire");
  assert.equal(line({ type: "heal", appliesTo: "recipient", healKind: "hitPoints", roll: "2d6" }), "The recipient: Hit points: 2d6");
  assert.equal(line({ type: "summon", summonFormat: "calling", amount: 2, ref: "a beast", value: { kind: "flat", flat: 3 }, control: "obedient" }), "Calling 2× a beast 3 HD Obedient");
  assert.equal(line({ type: "modifier", appliesTo: "target", target: "ac", value: { kind: "flat", flat: -2 }, condition: "while held" }), "The target: Armor Class -2 (while held)");
  assert.equal(line({ type: "modifier", target: "ac", value: { kind: "perLevel", base: 1, per: 1 } }), "Armor Class 1/level");
  assert.equal(line({ type: "conditionRemove", appliesTo: "recipient", conditions: ["paralysis"] }), "The recipient: cures Paralysis");
  assert.equal(line({ type: "spellLike", spellRef: { name: "Glimmer" }, spell: "old", frequency: "perDay" }), "Glimmer — Once per day");
  assert.equal(line({ type: "wall", appliesTo: "area", value: { kind: "flat", flat: 10 }, note: "stone" }), "Wall: Everything in the area: 10 (stone)", "the default arm leads with its kind");
  assert.equal(line({ type: "illusion" }), "Illusion", "a row with nothing else to say is its kind");
  assert.equal(line({ type: "afflictionDelay", appliesTo: "recipient", effects: ["disease", "poison"], lasts: "duration" }), "Affliction Delay: The recipient: Disease, Poison", "the effects a row holds back are named");
  assert.equal(line({ type: "purify", value: { kind: "flat", flat: 4 } }), "Purify: 4", "a located quantity reads as its figure");
  assert.equal(line({ type: "seal", appliesTo: "area", note: "a sample way" }), "Seal: Everything in the area: (a sample way)");
  assert.equal(line({ type: "summon", summonFormat: "calling", ref: "a beast", max: { kind: "perLevel", base: 1, per: 1 }, control: "obedient" }), "Calling up to 1/level a beast Obedient", "a summon row reads its count's ceiling");
  assert.equal(line({ type: "summon", summonFormat: "calling", amount: 2, ref: "a beast", max: { kind: "flat", flat: 6 } }), "Calling 2× up to 6 a beast");
  assert.equal(describeSpellEffect({ type: "curse" }).kind, "Curse");
});

t("a row's lasting, repeat, size exemption and ignite kind read as card lines, and its option rides beside the reading", () => {
  const line = (e) => describeSpellEffect(e).text;
  assert.equal(line({ type: "damage", roll: "1d4", damage: ["fire"], recur: "laterRounds", recurAt: "bearerStart" }), "1d4 fire (Each later round, At the start of the bearer's turn)");
  assert.equal(line({ type: "damage", roll: "1d4", recur: "eachRound", recurAt: "casterTurn", recurSave: "cast", recurTarget: "pick" }), "1d4 (Each round, On the caster's turn, A pass ends the cast, A target the caster picks)");
  // No lang or system is loaded here, so a condition the system names reads as its id.
  assert.equal(line({ type: "conditionGrant", appliesTo: "area", conditions: ["blinded"], lasts: "nextTurn" }), "Everything in the area: blinded (Until the bearer's next turn ends)");
  assert.equal(line({ type: "conditionGrant", conditions: ["blinded"], lasts: "rounds", rounds: "1d3" }), "blinded (For a number of rounds 1d3)");
  assert.equal(line({ type: "conditionGrant", conditions: ["blinded"], lasts: "rounds" }), "blinded (For a number of rounds)", "a blank formula reads as the lasting alone");
  assert.equal(line({ type: "conditionGrant", conditions: ["prone"], exemptSizeFrom: "huge" }), "prone (exempt from size: huge)");
  assert.equal(line({ type: "ignite", appliesTo: "target", lasts: "rounds", rounds: "1d2" }), "The target: (For a number of rounds 1d2)");
  assert.equal(line({ type: "ignite" }), "—");
  assert.equal(describeSpellEffect({ type: "ignite" }).kind, "Ignite");
  assert.equal(describeSpellEffect({ type: "damage", pick: "mode", pickOption: "left" }).option, "left");
  assert.equal(describeSpellEffect({ type: "damage" }).option, "");
  assert.equal(line({ type: "damage", roll: "1d4", pickOption: "left" }), "1d4", "the option is not part of the reading");
});

t("the Mechanics list marks each row's origin and names its blank fields without saying they were not imported", () => {
  const say = (key, data) => (data ? `${key}:${Object.values(data).join("|")}` : key);
  const fieldLabel = (name) => ({ roll: "Dice", extraordinary: "Mark" })[name] ?? name;
  const imported = effectRowView({ type: "damage", origin: "register", roll: "1d4", unread: ["extraordinary", "roll"] }, 2, { cite: "QQ p.1", fieldLabel, say });
  assert.equal(imported.index, 2);
  assert.equal(imported.origin, "register");
  assert.equal(imported.unread, "mech.unread:Mark, Dice");
  assert.equal(imported.cite, "QQ p.1");
  const hand = effectRowView({ type: "damage", origin: "", roll: "1d4" }, 0, { cite: "QQ p.1", fieldLabel, say });
  assert.equal(hand.origin, "hand");
  assert.equal(hand.unread, "", "a row with nothing blank lists nothing");
  assert.equal(effectRowView({ type: "damage" }, 0).origin, "hand", "a row with no origin is a hand's");
  const wall = effectRowView({ type: "wall", appliesTo: "area", note: "stone" }, 0);
  assert.ok(wall.kind && !wall.text.startsWith(wall.kind + ":"), "the Mechanics list has its own kind column, so the text never repeats the kind");
  assert.ok(!/import/i.test(imported.unread), "the list names fields and never says a figure was not imported");
});

t("a summon row names its creature through the lookup it is given, and reads its ref as written where none answers", () => {
  const row = { type: "summon", amount: 2, ref: "Actor.inv1" };
  const named = (nameOf) => describeSpellEffect(row, { nameOf }).text;
  assert.equal(named((ref) => (ref === "Actor.inv1" ? "Glimmerkin" : null)), "2× Glimmerkin");
  assert.equal(named(() => null), "2× Actor.inv1", "an unresolved ref reads as written");
  assert.equal(named(() => { throw new Error("invented"); }), "2× Actor.inv1", "a lookup that throws reads as written");
  assert.equal(describeSpellEffect(row).text, "2× Actor.inv1", "no lookup reads as before");
});

t("a printed stat block parses into lists, types, range and duration, and the primitive follows it", () => {
  const stat = parseStatBlock("Arcane 4, Divine 4 Type: blast, elemental (fire) Range: 120’ Duration: 1 round");
  assert.deepEqual(stat.lists, [{ source: "Arcane", level: 4 }, { source: "Divine", level: 4 }]);
  assert.deepEqual(stat.types, ["blast", "elemental (fire)"]);
  assert.equal(stat.range, "120’");
  assert.equal(stat.duration, "1 round");
  const built = spellFromStat(stat);
  assert.deepEqual(built.lists.map((l) => `${l.source}${l.level}`), ["arcane4", "divine4"]);
  assert.equal(built.type, "blast");
  assert.deepEqual(built.schools, ["blast", "elemental"]);
  assert.deepEqual(built.elements, ["fire"]);
  assert.equal(built.ritual, false);
  assert.equal(built.range.shape, "distance");
  assert.equal(built.range.value, 120);
  assert.equal(built.duration.shape, "fixed");
  const rit = spellFromStat(parseStatBlock("Arcane 8 Type: ritual, transmogrification Range: touch Duration: permanent"));
  assert.equal(rit.ritual, true);
  assert.equal(rit.type, "transmogrification");
  assert.ok(!rit.schools.includes("ritual"), "ritual is a flag, not a school");
  const empty = spellFromStat(parseStatBlock(""));
  assert.deepEqual(empty.lists, []);
  assert.equal(empty.type, "");
  assert.equal(empty.ritual, false);
});

t("the reverse's name is read off the prose in each printed phrasing, in heading case", () => {
  assert.equal(reversedNameFrom("The reverse form of this spell, dim the lantern, does the opposite."), "Dim the Lantern");
  assert.equal(reversedNameFrom("The reverse of this spell, muddle, confuses instead."), "Muddle");
  assert.equal(reversedNameFrom("Reversed, this spell becomes tarnish, and the metal dulls."), "Tarnish");
  assert.equal(reversedNameFrom("Reversed, warm hearth becomes cold hearth, which chills the room."), "Cold Hearth");
  assert.equal(reversedNameFrom("The reverse, weakness of will, saps resolve."), "Weakness of Will");
  assert.equal(reversedNameFrom("Only the reverse spell, dull the blade, can undo it. If the edge"), "Dull the Blade");
  assert.equal(reversedNameFrom("The reverse form, thicket shrinkage, transforms a hedge into a path."), "Thicket Shrinkage");
  assert.equal(reversedNameFrom("It stays so until the reverse of this spell (mud’s hardening) restores it."), "Mud’s Hardening");
  assert.equal(reversedNameFrom("See the chapter on water. The reverse of warm hearth is called cold hearth. It fills the room"), "Cold Hearth");
  assert.equal(reversedNameFrom("It must not be old. Blight, the reverse of bounty, causes the field to wither."), "Blight");
  assert.equal(reversedNameFrom("This spell has no reverse at all."), "");
  assert.equal(headingCase("wall of the fallen"), "Wall of the Fallen");
});

// --- printed names (every title below is invented) ---

t("a printed spell list splits on its separators, except an 'and' a title owns", () => {
  const ix = titleIndex([
    ["a", "Mend Pot and Pan"],
    ["b", "Quiet Step"],
    ["c", "Cure Minor Scrape"],
  ]);
  assert.deepEqual(splitSpellNames("mend pot and pan, quiet step and cure minor scrape", ix.has), [
    "mend pot and pan",
    "quiet step",
    "cure minor scrape",
  ]);
  assert.deepEqual(splitSpellNames("quiet step; cure minor scrape & mend pot and pan", ix.has), [
    "quiet step",
    "cure minor scrape",
    "mend pot and pan",
  ]);
  // Without an index every conjunction splits — the reading a list nothing
  // can vouch for still gets.
  assert.deepEqual(splitSpellNames("mend pot and pan, quiet step"), ["mend pot", "pan", "quiet step"]);
  assert.deepEqual(splitSpellNames(""), []);
});

t("a title resolves whole, in the singular, and from a column's abbreviation", () => {
  const ix = titleIndex([
    ["a", "Cure Minor Scrape"],
    ["b", "Repair Cracked Tile and Roof"],
    ["c", "Quiet Step*"],
  ]);
  assert.equal(ix.size, 3);
  assert.equal(ix.resolve("cure minor scrapes"), "a");
  assert.equal(ix.resolve("Repair Cracked Tile & Ro.*"), "b");
  assert.equal(ix.resolve("quiet step"), "c");
  assert.equal(ix.resolve("Quiet Step*"), "c");
  assert.equal(ix.resolve("repair"), null, "a bare stem is not an abbreviation");
  assert.equal(ix.has("loud step"), false);
  assert.equal(ix.resolve(""), null);
});

t("a creature's spells are read off its prose four ways, each with the frequency beside it", () => {
  const known = titleIndex([
    ["a", "Quiet Step"],
    ["b", "Cure Minor Scrape"],
    ["c", "Mend Pot and Pan"],
    ["d", "Loud Bang"],
    ["e", "Dim Lantern"],
  ]).has;
  const P3 = printedPhrase("printedFreq3");
  const reads = { known, freqOf: frequencyOf, phraseOf: frequencyTextOf };
  const prose =
    `It can perform quiet step (as the spell) ${P3}. Once per day it may cause a loud bang (as the spell loud bang). ` +
    "It also possesses the following spell-like abilities: cure minor scrape, mend pot and pan (at will); and dim lantern (once per week). " +
    "A chieftain has the following spells in its repertoire: 1st - quiet step, mend pot and pan; 2nd – loud bang.";
  const scan = scanMonsterSpells(prose, reads);
  assert.deepEqual(scan.named, [
    { name: "loud bang", frequency: "perDay" },
    { name: "quiet step", frequency: "printedFreq3", frequencyText: P3 },
    { name: "cure minor scrape", frequency: "atWill" },
    { name: "mend pot and pan", frequency: "atWill" },
    { name: "dim lantern", frequency: "perWeek" },
  ]);
  assert.deepEqual(scan.repertoire, [
    { level: 1, names: ["quiet step", "mend pot and pan"] },
    { level: 2, names: ["loud bang"] },
  ]);
  // Without an index the words after the verb stand, and a name is listed once.
  const bare = scanMonsterSpells("It can cast quiet step (as the spell) at will, and it can cast quiet step (as the spell) again.");
  assert.deepEqual(bare.named, [{ name: "quiet step" }]);
  assert.deepEqual(scanMonsterSpells("It has no magic.").named, []);
  // A list may open on its frequency, and a creature may print several lists.
  const opened = scanMonsterSpells(
    `It has the following spell-like abilities ${P3}: quiet step, loud bang. It has the following spell-like abilities once per week: dim lantern. ` +
      `Its kin have several spell-like abilities, each of which can be used ${P3}: cure minor scrape, mend pot and pan. All function at caster level 9.`,
    reads,
  );
  const printed = { frequency: "printedFreq3", frequencyText: P3 };
  assert.deepEqual(opened.named, [
    { name: "quiet step", ...printed },
    { name: "loud bang", ...printed },
    { name: "dim lantern", frequency: "perWeek" },
    { name: "cure minor scrape", ...printed },
    { name: "mend pot and pan", ...printed },
  ]);
  // A scan given no phrase reader keeps the key alone.
  assert.deepEqual(scanMonsterSpells(`It can perform quiet step (as the spell) ${P3}.`, { known, freqOf: frequencyOf }).named, [{ name: "quiet step", frequency: "printedFreq3" }]);
});

t("what a creature casts as: the class and level, or the tradition", () => {
  assert.deepEqual(castsAsClass("It casts spells as a 13thlevel crusader."), { level: 13, className: "crusader" });
  assert.deepEqual(castsAsClass("with the spellcasting abilities of a 9th level mage"), { level: 9, className: "mage" });
  assert.deepEqual(castsAsClass("It casts spells and uses magic items as a 4th-level mage."), { level: 4, className: "mage" });
  assert.equal(castsAsClass("It casts arcane spells."), null);
  assert.equal(castSourceOf("It casts divine spells at the level of its hit dice."), "divine");
  assert.equal(castSourceOf("They cast spells as mages of a level equal to their hit dice."), "mage");
  assert.equal(castSourceOf("It casts spells as if it were a 4th-level mage."), "mage");
  assert.equal(castSourceOf("It has the spellcasting abilities of a 9th level mage."), "mage");
  assert.equal(castSourceOf("It has no magic."), "");
});

t("a spell's level under a tradition comes off its lists, else core's own", () => {
  const extras = { lists: [{ source: "divine", level: 3 }, { source: "arcane", level: 4 }] };
  assert.equal(levelUnder(extras, 2, new Set(["arcane"])), 4);
  assert.equal(levelUnder(extras, 2, new Set(["divine"])), 3);
  assert.equal(levelUnder(extras, 2, new Set(["eldritch"])), 2);
  assert.equal(levelUnder(null, "2", new Set(["arcane"])), 2);
  assert.equal(levelUnder({ lists: [] }, "", new Set(["arcane"])), null);
});

t("a slot count reads off a template's cell or a system block, and writes back", () => {
  assert.deepEqual(slotsFromCells("2 1 - - -"), { 1: 2, 2: 1 });
  assert.deepEqual(slotsFromCells("3"), { 1: 3 });
  assert.equal(slotsFromCells("- - - - -"), null);
  assert.equal(slotsFromCells(""), null);
  const patch = coreSlotsPatch({ 1: 2, 2: 1 });
  assert.equal(patch.spells.enabled, true);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((lvl) => patch.spells[lvl].max), [2, 1, 0, 0, 0, 0]);
  assert.deepEqual(slotsOfSystem(patch.spells), { 1: 2, 2: 1 });
  assert.equal(slotsOfSystem(coreSlotsPatch(null).spells), null);
  assert.equal(coreSlotsPatch(null).spells.enabled, false);
});

t("a repertoire is drawn to its slots, distinct per level, never past what exists", () => {
  const spell = (name, lvl) => ({ name, lvl });
  const pool = [spell("a", 1), spell("b", 1), spell("c", 1), spell("d", 2), spell("e", 3)];
  let seed = 0;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const levelOf = (s) => s.lvl;
  const drawn = drawRepertoire(pool, { 1: 2, 2: 1, 3: 4 }, { levelOf, random });
  assert.equal(drawn.filter((s) => s.lvl === 1).length, 2);
  assert.equal(drawn.filter((s) => s.lvl === 2).length, 1);
  assert.equal(drawn.filter((s) => s.lvl === 3).length, 1, "a level with fewer spells than slots yields what there is");
  assert.equal(new Set(drawn.map((s) => s.name)).size, drawn.length, "no spell twice");
  assert.deepEqual(drawRepertoire(pool, { 4: 2 }, { levelOf, random }), []);
  assert.deepEqual(drawRepertoire(pool, null, { levelOf }), []);
  // The draw is the random source's: one seed, one repertoire.
  seed = 0;
  const once = drawRepertoire(pool, { 1: 2 }, { levelOf, random });
  seed = 0;
  assert.deepEqual(drawRepertoire(pool, { 1: 2 }, { levelOf, random }), once);
});

t("a frequency phrase reads to its key", () => {
  for (const key of PRINTED) assert.equal(frequencyOf(`usable ${printedPhrase(key)}`), key);
  assert.equal(frequencyOf("once per week"), "perWeek");
  assert.equal(frequencyOf("at will"), "atWill");
  assert.equal(frequencyOf("whenever it likes"), "");
  assert.equal(frequencyOf(null), "");
});

/* ------------------------------------------------------------------ */
/*  Cast durations                                                     */
/* ------------------------------------------------------------------ */

t("the time unit answers a positive number from its own constants, and a registered formation document moves none of it", () => {
  const readers = () => [timeUnit.roundsPerTurn(), timeUnit.turnsPerHour(), timeUnit.turnsPerDay(), timeUnit.turnSeconds(), timeUnit.roundSeconds()];
  const bare = readers();
  assert.ok(bare.every((n) => typeof n === "number" && n > 0), "with nothing registered, every reader answers a positive number");
  assert.deepEqual(bare, [TIME_COUNTS.roundsPerTurn, TIME_COUNTS.turnsPerHour, TIME_COUNTS.turnsPerHour * timeUnit.HOURS_PER_DAY, TURN_SECONDS, ROUND_SECONDS]);
  assert.equal(timeUnit.timeUnitCite(), "RR p.263");
  registerTable({ id: "formation", tables: { roundsPerTurn: 20, turnsPerHour: 12 } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    assert.deepEqual(readers(), bare, "a formation document carrying other counts does not move the unit");
  } finally {
    unregisterTable("formation", { priority: PRIORITY.WORLD });
  }
  assert.deepEqual(castDuration({ shape: "fixed", value: 2, unit: "turns" }), { value: 2 * TURN_SECONDS, units: "seconds" }, "a duration in turns counts the unit's seconds");
});

t("every duration shape has a row in the duration table, and an untimed one answers none", () => {
  const shapes = {
    instantaneous: { duration: {}, none: NONE.untimed },
    fixed: { duration: { value: 3, unit: "hours" }, out: { value: 3, units: "hours" } },
    perLevel: { duration: { value: 2, unit: "minutes" }, out: { value: 14, units: "minutes" } },
    basePlusPerLevel: { duration: { value: 5, unit: "days", plus: { value: 1, unit: "days" } }, out: { value: 12, units: "days" } },
    dice: { duration: { dice: "1d6", unit: "hours" }, out: { value: 4, units: "hours" } },
    concentration: { duration: { concentration: "mobile" }, out: { none: NONE.untimed, held: "mobile" } },
    concentrationMax: { duration: { value: 1, unit: "hours", concentration: "mobile" }, out: { none: NONE.untimed, held: "mobile", cap: { value: 1, units: "hours" } } },
    concentrationPlus: { duration: { value: 1, unit: "turns", plus: { value: 1, unit: "turns" } }, out: { none: NONE.untimed, held: "mobile", tail: { value: TURN_SECONDS, units: "seconds" } } },
    perpetual: { duration: {}, none: NONE.untimed },
    indefinite: { duration: {}, none: NONE.untimed },
    permanent: { duration: {}, none: NONE.untimed },
    special: { duration: { note: "see the entry" }, none: NONE.untimed },
  };
  assert.deepEqual(Object.keys(shapes).sort(), Object.keys(MAGIC_VOCAB.durationShape).sort(), "one row per DURATION_SHAPES member");
  for (const [shape, c] of Object.entries(shapes)) {
    const got = castDuration({ shape, ...c.duration }, { casterLevel: 7, roll: () => 4 });
    if (c.none) assert.deepEqual(got, { none: c.none }, shape);
    else assert.deepEqual(got, c.out, shape);
  }
});

t("every time unit maps onto a Foundry duration unit: turns to seconds, weeks to days, the rest alike", () => {
  const expected = {
    rounds: { value: 3, units: "rounds" },
    turns: { value: 3 * TURN_SECONDS, units: "seconds" },
    minutes: { value: 3, units: "minutes" },
    hours: { value: 3, units: "hours" },
    days: { value: 3, units: "days" },
    weeks: { value: 21, units: "days" },
    months: { value: 3, units: "months" },
    years: { value: 3, units: "years" },
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(MAGIC_VOCAB.timeUnit).sort(), "one row per TIME_UNITS member");
  for (const [unit, out] of Object.entries(expected)) {
    assert.deepEqual(castDuration({ shape: "fixed", value: 3, unit }), out, unit);
  }
});

t("a per-level duration needs the caster's level and never defaults it", () => {
  const d = { shape: "perLevel", value: 2, unit: "turns" };
  assert.deepEqual(castDuration(d, { casterLevel: 5 }), { value: 10 * TURN_SECONDS, units: "seconds" });
  for (const casterLevel of [undefined, 0, -1, NaN, "x"]) {
    assert.deepEqual(castDuration(d, { casterLevel }), { none: NONE.noLevel }, String(casterLevel));
  }
  assert.deepEqual(castDuration(d), { none: NONE.noLevel });
  assert.deepEqual(castDuration({ shape: "fixed", value: 2, unit: "turns" }), { value: 2 * TURN_SECONDS, units: "seconds" }, "a fixed time needs no level");
});

t("a base plus a per-level time adds only in one unit", () => {
  const same = { shape: "basePlusPerLevel", value: 4, unit: "turns", plus: { value: 2, unit: "turns" } };
  assert.deepEqual(castDuration(same, { casterLevel: 3 }), { value: 10 * TURN_SECONDS, units: "seconds" });
  const mixed = { shape: "basePlusPerLevel", value: 4, unit: "hours", plus: { value: 2, unit: "turns" } };
  assert.deepEqual(castDuration(mixed, { casterLevel: 3 }), { none: NONE.unitMismatch });
  assert.deepEqual(castDuration({ shape: "basePlusPerLevel", value: 4, unit: "hours" }, { casterLevel: 3 }), { none: NONE.unitMismatch }, "no plus unit");
  assert.deepEqual(castDuration(same, {}), { none: NONE.noLevel });
});

t("a rolled duration goes through the injected roll and refuses a bad result", () => {
  const seen = [];
  const roll = (formula) => (seen.push(formula), 6);
  const d = { shape: "dice", dice: "2d4+1", unit: "weeks" };
  assert.deepEqual(castDuration(d, { roll }), { value: 42, units: "days" });
  assert.deepEqual(seen, ["2d4+1"]);
  assert.deepEqual(castDuration(d, {}), { none: NONE.noRoll });
  assert.deepEqual(castDuration(d, { roll: () => NaN }), { none: NONE.badRoll });
  assert.deepEqual(castDuration(d, { roll: () => { throw new Error("bad formula"); } }), { none: NONE.badRoll });
  assert.deepEqual(castDuration(d, { roll: () => 0 }), { none: NONE.noFigure });
  assert.deepEqual(castDuration({ shape: "dice", unit: "hours" }, { roll }), { none: NONE.noFigure }, "no formula");
});

t("an unreadable duration answers none with a reason, never a figure", () => {
  assert.deepEqual(castDuration(null), { none: NONE.noShape });
  assert.deepEqual(castDuration({}), { none: NONE.noShape });
  assert.deepEqual(castDuration({ shape: "wobbly", value: 1, unit: "hours" }), { none: NONE.noShape });
  assert.deepEqual(castDuration({ shape: "fixed", value: 0, unit: "hours" }), { none: NONE.noFigure });
  assert.deepEqual(castDuration({ shape: "fixed", unit: "hours" }), { none: NONE.noFigure });
  assert.deepEqual(castDuration({ shape: "fixed", value: 2, unit: "fortnights" }), { none: NONE.unknownUnit });
  assert.deepEqual(castDuration({ shape: "fixed", value: 2 }), { none: NONE.unknownUnit });
  assert.deepEqual(castDuration({ shape: "fixed", value: 1.5, unit: "hours" }), { none: NONE.fractional });
  assert.deepEqual(castDuration({ shape: "perLevel", value: 1.5, unit: "hours" }, { casterLevel: 3 }), { none: NONE.fractional }, "4.5 hours has no integer in Foundry's hours");
});

/* ------------------------------------------------------------------ */
/*  The cast record                                                    */
/* ------------------------------------------------------------------ */

t("the cast record carries the spell, the cast, the caster and the side, and reads back", () => {
  const spell = { uuid: "Actor.aaa.Item.bbb", name: "Moth Lantern", img: "icons/lantern.svg" };
  const caster = { uuid: "Actor.aaa" };
  const data = spellEffectData({ spell, caster, castId: "cast1", role: "recipient", duration: { value: 12, units: "hours" } });
  assert.equal(data.origin, spell.uuid);
  assert.equal(data.name, "Moth Lantern");
  assert.equal(data.img, "icons/lantern.svg");
  assert.equal(data.transfer, false);
  assert.deepEqual(data.changes, []);
  assert.deepEqual(data.duration, { value: 12, units: "hours" });
  assert.deepEqual(data.flags["acks-extras"].spellEffect, {
    spellUuid: spell.uuid,
    castId: "cast1",
    casterUuid: "Actor.aaa",
    role: "recipient",
  });
  assert.deepEqual(spellEffectOf(data), data.flags["acks-extras"].spellEffect);
  // A document answers through getFlag; plain data answers through flags.
  const doc = { getFlag: (scope, key) => data.flags[scope]?.[key] };
  assert.equal(spellEffectOf(doc).castId, "cast1");
  const named = spellEffectData({ spell, caster, castId: "c2", role: "caster", name: "Lantern glow", changes: [{ key: "k", value: "1" }], transfer: true });
  assert.equal(named.name, "Lantern glow");
  assert.equal(named.transfer, true);
  assert.deepEqual(named.changes, [{ key: "k", value: "1" }]);
});

t("the cast record leaves the duration alone when the cast has none, and rejects an unknown side", () => {
  const spell = { uuid: "Actor.a.Item.b", name: "X", img: "" };
  const caster = { uuid: "Actor.a" };
  assert.equal("duration" in spellEffectData({ spell, caster, castId: "c", role: "caster", duration: { none: NONE.untimed } }), false);
  assert.equal("duration" in spellEffectData({ spell, caster, castId: "c", role: "caster" }), false);
  assert.throws(() => spellEffectData({ spell, caster, castId: "c", role: "bystander" }), /unknown role/);
});

t("an effect no cast made reads as null", () => {
  assert.equal(spellEffectOf(null), null);
  assert.equal(spellEffectOf({}), null);
  assert.equal(spellEffectOf({ flags: { "acks-extras": { spellEffect: { castId: "c", role: "other" } } } }), null);
  assert.equal(spellEffectOf({ flags: { "acks-extras": { spellEffect: { role: "caster" } } } }), null);
  assert.equal(spellEffectOf({ flags: { "acks-extras": { fromClass: "x" } } }), null);
});

t("a cast id comes from foundry's randomID when present and from an injected or local source otherwise", () => {
  assert.equal(newCastId({ randomID: (len) => "z".repeat(len) }), "z".repeat(16));
  const saved = globalThis.foundry;
  try {
    globalThis.foundry = { utils: { randomID: () => "from-foundry" } };
    assert.equal(newCastId(), "from-foundry");
    globalThis.foundry = undefined;
    const a = newCastId();
    assert.match(a, /^[a-z0-9]{16}$/);
    assert.notEqual(a, newCastId());
  } finally {
    globalThis.foundry = saved;
  }
});

/* ------------------------------------------------------------------ */
/*  Summon spells                                                      */
/* ------------------------------------------------------------------ */

const flagged = (spell, parentType = "character", extra = {}) => ({
  type: "spell",
  name: "Test Spell",
  parent: parentType ? { type: parentType } : null,
  flags: { "acks-extras": { spell } },
  ...extra,
});
const summonRow = (over = {}) => ({
  type: "summon",
  ref: "",
  amount: 2,
  value: { kind: "flat", flat: 3 },
  summonFormat: "conjuration",
  control: "obedient",
  ...over,
});

t("the summoning type word is a spell type the vocabulary knows", () => {
  assert.ok(SUMMONING_TYPE in MAGIC_VOCAB.spellType);
});

t("a character's spell is summonable by a summon row or by the summoning type word, and by nothing else", () => {
  assert.equal(isSummonSpell(flagged({ schools: ["summoning"] })), true, "the type word alone");
  assert.equal(isSummonSpell(flagged({ schools: ["Enchantment", " Summoning "] })), true, "the word among others, any case");
  assert.equal(isSummonSpell(flagged({ type: "summoning", schools: [] })), true, "the primary type");
  assert.equal(isSummonSpell(flagged({ effects: [summonRow()] })), true, "a row alone");
  assert.equal(isSummonSpell(flagged({ effects: { 0: summonRow() } })), true, "rows arriving as a numeric-keyed object");
  assert.equal(isSummonSpell(flagged({ schools: ["enchantment"], effects: [{ type: "damage" }] })), false);
  assert.equal(isSummonSpell(flagged({})), false);
  assert.equal(isSummonSpell({ type: "spell", parent: { type: "character" }, flags: {} }), false, "no flag at all");
  assert.equal(isSummonSpell(flagged({ effects: [summonRow()] }, "character", { type: "weapon" })), false, "not a spell item");
  assert.equal(isSummonSpell(null), false);
});

t("a spell on a monster, or on no actor, is never summonable", () => {
  assert.equal(isSummonSpell(flagged({ effects: [summonRow()], schools: ["summoning"] }, "monster")), false);
  assert.equal(isSummonSpell(flagged({ effects: [summonRow()], schools: ["summoning"] }, null)), false);
  assert.equal(isSummonSpell(flagged({ effects: [summonRow()] }, "party")), false);
});

t("a summon spell's options are its rows: none for a type word alone, one per row otherwise", () => {
  assert.deepEqual(summonOptionsOf(flagged({ schools: ["summoning"] })), [], "a type word names no creature");
  const named = summonOptionsOf(flagged({ effects: [summonRow({ ref: "Actor.zzz" })] }));
  assert.deepEqual(named, [
    { ref: "Actor.zzz", name: "", amount: 2, value: { kind: "flat", flat: 3 }, max: null, summonFormat: "conjuration", control: "obedient", controlEnd: "" },
  ]);
  assert.equal(summonOptionsOf(flagged({ effects: [summonRow({ ref: "Actor.zzz", name: " Imported Name " })] }))[0].name, "Imported Name", "a row's own name is carried, trimmed");
  const open = summonOptionsOf(flagged({ effects: [summonRow({ ref: "  " })] }));
  assert.equal(open.length, 1);
  assert.equal(open[0].ref, "", "an empty ref is an open pick, not a missing row");
  const several = summonOptionsOf(
    flagged({
      effects: [
        summonRow({ ref: "def.invented.ashwren", amount: 1, control: "hostile" }),
        { type: "damage", roll: "1d6" },
        summonRow({ ref: "Actor.qqq", amount: 4, summonFormat: "calling" }),
      ],
    }),
  );
  assert.deepEqual(
    several.map((o) => [o.ref, o.amount, o.summonFormat, o.control]),
    [
      ["def.invented.ashwren", 1, "conjuration", "hostile"],
      ["Actor.qqq", 4, "calling", "obedient"],
    ],
    "rows in order, non-summon rows skipped",
  );
});

t("a spell with no rows of its own reads its library twin's, and its own rows win", () => {
  const bare = flagged({ schools: ["summoning"] });
  const twin = flagged({ effects: [summonRow({ ref: "def.invented.glimmerkin", amount: 3 })] }, null);
  assert.deepEqual(summonOptionsOf(bare, { twin }).map((o) => [o.ref, o.amount]), [["def.invented.glimmerkin", 3]]);
  assert.deepEqual(summonOptionsOf(bare, { twin: null }), []);
  assert.deepEqual(summonOptionsOf(bare, { twin: flagged({}, null) }), []);
  const own = flagged({ effects: [summonRow({ ref: "Actor.own" })] });
  assert.deepEqual(summonOptionsOf(own, { twin }).map((o) => o.ref), ["Actor.own"]);
});

t("the library twin is found by cookbook stamp, else by compendium source, never itself", () => {
  const shelf = { id: "def.spell.invented" };
  const twinDoc = { name: "twin" };
  const calls = [];
  const byCookbookId = (type, id) => (calls.push([type, id]), id === shelf.id ? twinDoc : null);
  const fromUuidSync = (uuid) => {
    if (uuid === "boom") throw new Error("not a uuid");
    return uuid === "Compendium.x.Item.src" ? { name: "source" } : null;
  };
  const stamped = { flags: { "acks-extras": { cookbook: { id: shelf.id } } }, _stats: { compendiumSource: "Compendium.x.Item.src" } };
  assert.equal(libraryTwin(stamped, { byCookbookId, fromUuidSync }), twinDoc);
  assert.deepEqual(calls, [["Item", shelf.id]]);
  const sourced = { flags: {}, _stats: { compendiumSource: "Compendium.x.Item.src" } };
  assert.equal(libraryTwin(sourced, { byCookbookId, fromUuidSync }).name, "source");
  const staleStamp = { flags: { "acks-extras": { cookbook: { id: "def.spell.gone" } } }, _stats: { compendiumSource: "Compendium.x.Item.src" } };
  assert.equal(libraryTwin(staleStamp, { byCookbookId, fromUuidSync }).name, "source", "a stamp the shelf lacks falls to the source");
  assert.equal(libraryTwin({ flags: {}, _stats: { compendiumSource: "boom" } }, { byCookbookId, fromUuidSync }), null, "a throwing lookup is a miss");
  assert.equal(libraryTwin({ flags: {} }, { byCookbookId, fromUuidSync }), null);
  const self = { flags: { "acks-extras": { cookbook: { id: "def.spell.me" } } } };
  assert.equal(libraryTwin(self, { byCookbookId: () => self, fromUuidSync }), null, "never the spell itself");
});

{
  const actors = { "Actor.abc": { name: "by uuid", documentName: "Actor" }, "Item.def": { name: "an item", documentName: "Item" } };
  const shelf = { "def.invented.glimmerkin": { name: "by cookbook" } };
  const fromUuid = async (uuid) => {
    if (uuid === "throws") throw new Error("bad uuid");
    return actors[uuid] ?? null;
  };
  const byCookbookId = (type, id) => (type === "Actor" ? (shelf[id] ?? null) : null);
  const lookups = { fromUuid, byCookbookId };

  assert.equal((await resolveSummonRef("Actor.abc", lookups)).name, "by uuid");
  n++;
  console.log("ok - a summon ref resolves by uuid first");
  assert.equal((await resolveSummonRef("uuid:Actor.abc", lookups)).name, "by uuid", "the uuid: prefix");
  assert.equal((await resolveSummonRef("def.invented.glimmerkin", lookups)).name, "by cookbook");
  n++;
  console.log("ok - a summon ref resolves by cookbook id on the Actor shelf");
  assert.equal(await resolveSummonRef("def.invented.nobody", lookups), null);
  assert.equal(await resolveSummonRef("", lookups), null);
  assert.equal(await resolveSummonRef(undefined, lookups), null);
  assert.equal(await resolveSummonRef("Item.def", lookups), null, "a uuid naming a non-Actor does not answer");
  assert.equal((await resolveSummonRef("throws", { fromUuid, byCookbookId: (t2, id) => (id === "throws" ? { name: "fell through" } : null) })).name, "fell through", "a throwing fromUuid falls to the shelf");
  n++;
  console.log("ok - an unresolved or unparseable ref is null, never a throw");
}

/* ------------------------------------------------------------------ */
/*  Casting a summoning spell (cast-summon.mjs)                        */
/* ------------------------------------------------------------------ */

const {
  registerCastSummon,
  summonRefusal,
  summonRowsOf,
} = await import("../scripts/magic/cast-summon.mjs");
const { registerSummonPolicy, checkPlaceRequest } = await import("../scripts/lib/summons-logic.mjs");

/** Run an async test body the way `t` runs a sync one. */
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const GM_SEAT = { id: "gm", isGM: true };
const PLAYER_SEAT = { id: "p1", isGM: false };
const NO_LOOKUPS = { byCookbookId: () => null, fromUuidSync: () => null };

/** A summoning spell item on a character, with its rows and an optional duration. */
const castSpell = ({ rows = [summonRow({ ref: "def.invented.glimmerkin", amount: 2 })], duration, owner = true, parentType = "character", extra = {} } = {}) => {
  const created = [];
  const caster = {
    type: parentType,
    uuid: "Actor.caster1",
    isOwner: owner,
    created,
    createEmbeddedDocuments: async (type, data) => {
      created.push([type, data]);
      return data;
    },
  };
  const spell = {
    id: "sp1",
    type: "spell",
    uuid: "Actor.caster1.Item.sp1",
    name: "Invented Calling",
    img: "icons/invented.webp",
    parent: caster,
    flags: { "acks-extras": { spell: { schools: ["summoning"], effects: rows, ...(duration ? { duration } : {}) } } },
    ...extra,
  };
  return { spell, caster };
};

/** A creature the request names, as the placement check sees one: a document every user may observe unless a test says otherwise. */
const creature = (over = {}) => ({ uuid: "Compendium.invented.Actor.abc", name: "Glimmerkin", type: "monster", flags: { "acks-extras": { cookbook: { id: "def.invented.glimmerkin" } } }, testUserPermission: () => true, ...over });

await ta("the policy refuses a creature no row names, and a count over the row's amount", () => {
  const { spell } = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 2 }), summonRow({ ref: "Compendium.invented.Actor.zzz", amount: 5 })] });
  const ask = (source, count, extra = {}) => summonRefusal({ user: PLAYER_SEAT, spell, source, count, ...extra }, NO_LOOKUPS);
  assert.equal(ask(creature(), 2), null, "a named creature at its amount");
  assert.equal(ask(creature(), 3), "badCount", "over the row's amount");
  assert.equal(ask(creature({ uuid: "Compendium.invented.Actor.zzz", flags: {} }), 5), null, "named by uuid, with its own row's amount");
  assert.equal(ask(creature({ uuid: "Compendium.invented.Actor.other", flags: {}, name: "Other" }), 1), "notNamed", "a creature no row names");
  const byName = castSpell({ rows: [summonRow({ ref: "glimmerkin", amount: 2 })] }).spell;
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell: byName, source: creature({ flags: {}, uuid: "u", name: "Glimmerkin" }), count: 2 }, NO_LOOKUPS), null, "a row may name a creature by its own name, in any case");
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell: byName, source: creature({ flags: {}, uuid: "u", name: "Other" }), count: 1 }, NO_LOOKUPS), "notNamed");
});

await ta("a row with no ref is an open pick, and a row stating no amount sets no limit", () => {
  const open = castSpell({ rows: [summonRow({ ref: "", amount: 3 })] }).spell;
  const ask = (spell, count, source = creature()) => summonRefusal({ user: PLAYER_SEAT, spell, source, count }, NO_LOOKUPS);
  assert.equal(ask(open, 3), null, "any creature fits an open row");
  assert.equal(ask(open, 4), "badCount", "but its amount still bounds the count");
  const mixed = castSpell({ rows: [summonRow({ ref: "def.invented.other", amount: 1 }), summonRow({ ref: "", amount: 4 })] }).spell;
  assert.equal(ask(mixed, 4), null, "an open row beside a named one lets another creature through, up to its own amount");
  assert.equal(ask(mixed, 5), "badCount");
  const noAmount = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 0 })] }).spell;
  assert.equal(ask(noAmount, 30), null, "no stated amount, no limit");
  const oneStated = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 0 }), summonRow({ ref: "Compendium.invented.Actor.abc", amount: 1 })] }).spell;
  assert.equal(ask(oneStated, 9), null, "a fitting row with no amount lifts the limit");
  assert.equal(ask(castSpell({ rows: [] }).spell, 9), null, "a spell with no rows asks nothing");
});

await ta("a Player seat is refused a spell that is no summoning spell; a GM seat is not", () => {
  const { spell } = castSpell({ rows: [] });
  spell.flags["acks-extras"].spell.schools = ["blast"];
  const req = (user) => ({ user, spell, source: creature(), count: 1 });
  assert.equal(summonRefusal(req(PLAYER_SEAT), NO_LOOKUPS), "badSpell");
  assert.equal(summonRefusal(req(GM_SEAT), NO_LOOKUPS), null);
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell: null, source: creature(), count: 1 }, NO_LOOKUPS), null, "no spell is lib's own spellRequired to refuse");
});

await ta("a spell with no rows of its own reads its library twin's, in the policy", () => {
  const twin = { flags: { "acks-extras": { spell: { effects: [summonRow({ ref: "def.invented.glimmerkin", amount: 1 })], duration: { shape: "fixed", value: 3, unit: "hours" } } } } };
  const { spell } = castSpell({ rows: [] });
  spell.flags["acks-extras"].cookbook = { id: "def.spell.invented" };
  const lookups = { byCookbookId: (type, id) => (type === "Item" && id === "def.spell.invented" ? twin : null), fromUuidSync: () => null };
  assert.deepEqual(summonRowsOf(spell, lookups).map((r) => r.ref), ["def.invented.glimmerkin"]);
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell, source: creature(), count: 2 }, lookups), "badCount");
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell, source: creature({ flags: {}, uuid: "x", name: "Other" }), count: 1 }, lookups), "notNamed");
});

await ta("registerCastSummon registers the policy only, once, replaces rather than doubles, and takes it back", async () => {
  let off = registerCastSummon();
  const policies = [];
  const offTest = registerSummonPolicy((req) => (policies.push(req), null));
  try {
    const { spell } = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 1 })] });
    const summoner = { type: "character", items: new Map([["sp1", spell]]), testUserPermission: () => true, uuid: "Actor.caster1" };
    spell.parent = summoner;
    const verdict = (source, count, user = PLAYER_SEAT) => checkPlaceRequest({ user, summoner, source, count, spellId: "sp1" });
    assert.equal(verdict(creature({ flags: {}, uuid: "x", name: "Other" }), 1, GM_SEAT).reason, "notNamed", "the registered policy refuses through lib's own check, a Judge too");
    assert.equal(verdict(creature(), 2).reason, "badCount");
    assert.equal(verdict(creature(), 2, GM_SEAT).ok, true, "a Judge's count is warned by the cast's verdict and never refused here");
    assert.equal(verdict(creature(), 1).ok, true);
    const stale = off;
    off = registerCastSummon();
    stale();
    assert.equal(verdict(creature(), 2).reason, "badCount", "a stale handle after a second registration takes nothing down");
    off();
    off();
    assert.equal(verdict(creature({ flags: {}, uuid: "x", name: "Other" }), 1, GM_SEAT).ok, true, "removed, the policy no longer refuses");
  } finally {
    offTest();
  }
  registerCastSummon()();
});

await ta("a row naming a creature grants nothing: a named creature the asking seat cannot observe is unreadable, by uuid and by name, and a Judge is never refused", async () => {
  const logicModule = await import("../scripts/lib/summons-logic.mjs");
  assert.equal("registerSummonNaming" in logicModule, false, "no naming registry is left to grant an exemption");
  const off = registerCastSummon();
  try {
    const rows = [summonRow({ ref: "Compendium.invented.Actor.abc", amount: 2 }), summonRow({ ref: "glimmerkin", amount: 2 })];
    const { spell } = castSpell({ rows });
    const summoner = { type: "character", items: new Map([["sp1", spell]]), testUserPermission: () => true, uuid: "Actor.caster1" };
    spell.parent = summoner;
    const shelf = (observes, over) => ({ ...creature(over), compendium: { testUserPermission: (user, lvl) => observes && lvl === "OBSERVER" } });
    const ask = (source, user = PLAYER_SEAT) => checkPlaceRequest({ user, summoner, source, count: 1, spellId: "sp1" });
    assert.equal(ask(shelf(false)).reason, "unreadable", "named by its uuid");
    assert.equal(ask(shelf(false, { uuid: "Compendium.invented.Actor.other", flags: {} })).reason, "unreadable", "named by its own name");
    assert.equal(ask(shelf(true)).ok, true, "the same creature on a shelf the seat can open");
    assert.equal(ask(shelf(false), GM_SEAT).ok, true, "a Judge is never refused");
    assert.equal(ask(shelf(false, { uuid: "x", name: "Other", flags: {} }), GM_SEAT).reason, "notNamed", "the rows' own policy still holds a Judge to the names");
    assert.equal(ask(null).reason, "badSource", "an unresolved creature is no creature");
  } finally {
    off();
  }
});

/* ------------------------------------------------------------------ */
/*  A cast's end                                                       */
/* ------------------------------------------------------------------ */

const { castRecordEnd, castEnded, castTokens, castEndedRecipients, announceEndedCast, sweepEndedCasts } = await import("../scripts/magic/cast-expiry.mjs");

/** An invented calendar: a minute of 50 seconds, an hour of 40 minutes; any other unit is unknown. */
const SECS = { seconds: 1, minutes: 50, hours: 2000 };
const secondsOf = (value, units) => (units in SECS ? value * SECS[units] : null);

/** A caster's record as a document gives it: source start and duration, the cast mark. */
const castRecordDoc = ({ start = 1000, value = 3, units = "minutes", role = "caster", ended, castId = "cast7", uuid = "Actor.c1.ActiveEffect.e1" } = {}) => {
  const mark = { spellUuid: "Actor.c1.Item.sp1", castId, casterUuid: "Actor.c1", role };
  if (ended != null) mark.ended = ended;
  return { uuid, _source: { start: { time: start }, duration: { value, units } }, flags: { "acks-extras": { spellEffect: mark } } };
};

t("a record ends at its start plus its duration on the world clock, by the calendar it is given", () => {
  assert.equal(castRecordEnd(castRecordDoc(), secondsOf), 1150);
  assert.equal(castRecordEnd(castRecordDoc({ units: "hours", value: 1 }), secondsOf), 3000);
});
t("a rounds record counts its rounds at the unit's round, a turn's seconds over its rounds", () => {
  assert.equal(ROUND_SECONDS, TURN_SECONDS / TIME_COUNTS.roundsPerTurn);
  assert.equal(castRecordEnd(castRecordDoc({ units: "rounds", value: 4 }), () => null), 1000 + 4 * ROUND_SECONDS);
});
t("a record with no duration, no start, a combat turn or a unit the calendar does not answer never ends on the clock", () => {
  assert.equal(castRecordEnd(castRecordDoc({ value: null }), secondsOf), null);
  assert.equal(castRecordEnd({ ...castRecordDoc(), _source: { duration: { value: 3, units: "minutes" } } }, secondsOf), null);
  assert.equal(castRecordEnd({ ...castRecordDoc(), _source: { start: { time: null }, duration: { value: 3, units: "minutes" } } }, secondsOf), null);
  assert.equal(castRecordEnd(castRecordDoc({ units: "turns" }), secondsOf), null);
  assert.equal(castRecordEnd(castRecordDoc({ units: "weeks" }), secondsOf), null);
});
t("only an open caster record whose end the clock has reached has ended", () => {
  const at = (worldTime, over) => castEnded(castRecordDoc(over), { worldTime, secondsOf });
  assert.equal(at(1149), false, "a second short");
  assert.equal(at(1150), true, "at its end");
  assert.equal(at(5000, { role: "recipient" }), false, "a recipient's record carries the same cast and is not announced");
  assert.equal(at(5000, { ended: 1200 }), false, "a stamped record is closed");
  assert.equal(castEnded({ _source: { start: { time: 0 }, duration: { value: 1, units: "seconds" } } }, { worldTime: 9, secondsOf }), false, "an effect no cast made");
});
t("a cast's tokens are found on every scene, by the caster and the cast id, and no other", () => {
  const tok = (summoner, castId) => ({ actor: { getFlag: (_s, key) => (key === "summonedBy" ? summoner : castId ? { castId } : null) } });
  const scenes = [{ tokens: [tok("Actor.c1", "cast7"), tok("Actor.c1", "cast8"), tok("Actor.c2", "cast7")] }, { tokens: [tok("Actor.c1", "cast7"), tok("Actor.c1", null)] }];
  assert.equal(castTokens(scenes, "Actor.c1", "cast7").length, 2);
});
t("the card goes to every GM and every other owner of the caster", () => {
  const isGM = (id) => id === "gm1";
  assert.deepEqual(castEndedRecipients({ default: 0, gm1: 3, p1: 3, p2: 2, p3: 3 }, ["gm1"], isGM).sort(), ["gm1", "p1", "p3"]);
});
await ta("an ended cast is stamped before its card, and a second call finds it closed", async () => {
  const doc = castRecordDoc();
  const order = [];
  const deps = {
    worldTime: 1200,
    secondsOf,
    stamp: async (effect, time) => {
      order.push(["stamp", time]);
      effect.flags["acks-extras"].spellEffect.ended = time;
    },
    standing: () => [{ id: "t1" }, { id: "t2" }],
    post: async ({ tokens, record }) => order.push(["post", tokens.length, record.castId]),
  };
  assert.deepEqual(await announceEndedCast(doc, deps), { posted: true, n: 2 });
  assert.deepEqual(order, [["stamp", 1200], ["post", 2, "cast7"]]);
  assert.deepEqual(await announceEndedCast(doc, deps), { posted: false, reason: "closed" });
  assert.equal(order.length, 2, "nothing is stamped or posted twice");
});
await ta("an ended cast with nothing left standing is stamped and posts no card", async () => {
  const posts = [];
  const doc = castRecordDoc();
  const r = await announceEndedCast(doc, { worldTime: 1200, stamp: async (e, time) => { e.flags["acks-extras"].spellEffect.ended = time; }, standing: () => [], post: async () => posts.push(1) });
  assert.deepEqual(r, { posted: false, reason: "noneStanding" });
  assert.equal(posts.length, 0);
  assert.equal(spellEffectOf(doc).ended, 1200);
});
await ta("two steps of the clock before the stamp lands announce once", async () => {
  const doc = castRecordDoc();
  let release;
  const gate = new Promise((r) => { release = r; });
  const posts = [];
  const deps = { worldTime: 1200, secondsOf, stamp: async (e, time) => { await gate; e.flags["acks-extras"].spellEffect.ended = time; }, standing: () => [{}], post: async () => posts.push(1) };
  const first = announceEndedCast(doc, deps);
  const second = await announceEndedCast(doc, deps);
  release();
  await first;
  assert.deepEqual(second, { posted: false, reason: "closed" });
  assert.equal(posts.length, 1);
});
await ta("a sweep announces only the ended, open caster records, and one that throws leaves the rest", async () => {
  const actors = [
    { effects: [castRecordDoc({ uuid: "a" }), castRecordDoc({ uuid: "b", start: 1190 }), castRecordDoc({ uuid: "c", ended: 1100 })] },
    { effects: [castRecordDoc({ uuid: "d", castId: "boom" }), castRecordDoc({ uuid: "e", castId: "cast9" })] },
  ];
  const posted = [];
  const errors = [];
  const quiet = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const out = await sweepEndedCasts(actors, {
      worldTime: 1200,
      secondsOf,
      stamp: async (e, time) => { e.flags["acks-extras"].spellEffect.ended = time; },
      standing: (record) => {
        if (record.castId === "boom") throw new Error("invented failure");
        return [{}];
      },
      post: async ({ record }) => posted.push(record.castId),
    });
    assert.equal(out.length, 2, "a and e; b has time left, c was stamped, d threw");
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(posted, ["cast7", "cast9"]);
  assert.equal(errors.length, 1, "the throw is logged");
});
t("the cast-end card's strings exist, and the record's stamp is read back", () => {
  for (const key of ["ACKS-MAGIC.castEnded.text", "ACKS-MAGIC.castEnded.dismiss"]) assert.equal(typeof lang[key], "string", key);
  assert.equal(spellEffectOf(castRecordDoc({ ended: 77 })).ended, 77);
  assert.equal("ended" in spellEffectOf(castRecordDoc()), false, "an open record carries no stamp");
});

/* ------------------------------------------------------------------ */
/*  Area measure and extent, and the scope a row carries               */
/* ------------------------------------------------------------------ */

t("areaExtent normalizes a radius, a diameter and a length to feet, and says nothing for a size with no known measure", () => {
  assert.deepEqual(areaExtent({ measure: "radius", size: 4 }), { measure: "radius", radius: 4, diameter: 8, length: null, width: null, height: null });
  assert.deepEqual(areaExtent({ measure: "diameter", size: 6, height: 3 }), { measure: "diameter", radius: 3, diameter: 6, length: null, width: null, height: 3 });
  assert.deepEqual(areaExtent({ measure: "length", size: 30, width: 5 }), { measure: "length", radius: null, diameter: null, length: 30, width: 5, height: null });
  assert.equal(areaExtent({ measure: "length", size: 30 }).width, null, "a length with no width has none");
  const bare = areaExtent({ size: 12, height: 2 });
  assert.deepEqual([bare.measure, bare.radius, bare.diameter, bare.length, bare.height], ["", null, null, null, 2], "a size alone is not an extent; a height needs no measure");
  assert.equal(areaExtent({ measure: "breadth", size: 12 }).radius, null, "an unknown measure is none");
  for (const size of [null, undefined, NaN, "x", -1]) assert.equal(areaExtent({ measure: "radius", size }).radius, null, `size ${size}`);
  assert.equal(areaExtent({ measure: "radius", size: 0 }).diameter, 0, "zero is a figure");
  assert.deepEqual(areaExtent(), { measure: "", radius: null, diameter: null, length: null, width: null, height: null });
});

t("areaExtent converts the spell's unit to feet through the shared unit table", () => {
  assert.equal(areaExtent({ measure: "radius", size: 2, unit: "feet" }).radius, 2);
  assert.equal(areaExtent({ measure: "radius", size: 2, unit: "" }).radius, 2, "no unit is feet");
  assert.equal(areaExtent({ measure: "diameter", size: 1, unit: "miles" }).diameter, SCENE_UNITS.mi.feet);
  assert.equal(areaExtent({ measure: "length", size: 1, width: 2, height: 3, unit: "miles" }).width, 2 * SCENE_UNITS.mi.feet, "every length is converted");
  assert.equal(areaExtent({ measure: "radius", size: 3, unit: "unheard-of" }).radius, 3, "an unknown unit counts as feet");
});

// The spell primitive's schema needs the data-field classes at import; these record what each was built from.
const schemaProbe = await (async () => {
  const prior = globalThis.foundry;
  class Field {
    constructor(a, b) {
      this.a = a;
      this.b = b;
    }
  }
  class Schema extends Field {
    get fields() {
      return this.a;
    }
  }
  class List extends Field {
    get element() {
      return this.a;
    }
  }
  globalThis.foundry = {
    abstract: { DataModel: class {} },
    data: { fields: { SchemaField: Schema, ArrayField: List, StringField: Field, NumberField: Field, BooleanField: Field, SetField: Field, HTMLField: Field } },
  };
  try {
    const { default: SpellExtras } = await import("../scripts/magic/spell-extras.mjs");
    return SpellExtras.defineSchema();
  } finally {
    globalThis.foundry = prior;
  }
})();

t("the area measures are a closed set, and the spell schema carries the new area fields", () => {
  assert.deepEqual(Object.keys(MAGIC_VOCAB.areaMeasure), ["radius", "diameter", "length"]);
  assert.deepEqual(Object.keys(schemaProbe.target.fields.area.fields), ["shape", "measure", "size", "width", "unit", "height"], "an Overview submit normalizes through these keys");
});

t("a normalized effect row keeps a nested scope: the schema holds exactly the branch keys, one level deep, with no sign", () => {
  const row = schemaProbe.effects.element.fields;
  const branch = row.anyOf.element.fields;
  assert.deepEqual(Object.keys(branch).sort(), [...V.SCOPE_BRANCH_FIELDS].sort());
  assert.ok(!("anyOf" in branch) && !("sign" in branch));
  for (const key of V.SCOPE_BRANCH_FIELDS) assert.ok(key in row, `the row itself holds ${key}`);
});

{
  // The row editor declares a window class at load, so it needs the two application bases.
  const priorFoundry = globalThis.foundry;
  const priorGame = globalThis.game;
  globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } } }, utils: {} };
  globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
  const { mergeRowEdit, anyOfText, fieldsForType, effectRowActions, EffectRowEditor } = await import("../scripts/lib/apps/effect-row-editor.mjs");
  globalThis.foundry = priorFoundry;
  globalThis.game = priorGame;

  const stored = {
    type: "modifier",
    target: "ac",
    origin: "register",
    vsKinds: ["alpha"],
    anyOf: [{ vsEnemy: true, vsAlignmentOf: "source", vsAlignmentMode: "except" }, { vsKinds: ["beta"], vsAlignment: "chaotic" }],
  };

  t("a row-editor submit keeps a nested anyOf as stored, edits the flat scope beside it, and hands the row to the Judge", () => {
    const next = mergeRowEdit(stored, { vsKinds: ["gamma"], vsEnemy: true, note: "x" });
    assert.deepEqual(next.anyOf, stored.anyOf, "the branches are carried over untouched");
    assert.deepEqual(next.vsKinds, ["gamma"], "the flat scope takes the edit");
    assert.equal(next.origin, "", "any edit clears the importer's stamp");
    assert.equal(stored.origin, "register", "the stored row is not written through");
    assert.deepEqual(mergeRowEdit(stored, { anyOf: [] }).anyOf, stored.anyOf, "even a stray field named anyOf cannot replace it");
    assert.equal(mergeRowEdit({ type: "modifier" }, { note: "x" }).anyOf, undefined, "a row with none gains none");
    assert.deepEqual(mergeRowEdit({ value: { kind: "flat", flat: 1 } }, { value: { flat: 2 } }).value, { kind: "flat", flat: 2 }, "a value fragment merges into the stored value");
  });

  t("a light level chosen on a modifier row sets its light gate, a change replaces it, and blank clears it", () => {
    const plain = { type: "modifier", target: "attackThrow" };
    const set = mergeRowEdit(plain, { gate: { light: "daylight" } });
    assert.deepEqual(set.gate, { kind: "light", light: "daylight" }, "a level makes the gate");
    assert.equal(plain.gate, undefined, "the stored row is not written through");
    const changed = mergeRowEdit(set, { gate: { light: "dim" } });
    assert.deepEqual(changed.gate, { kind: "light", light: "dim" }, "another level replaces the first");
    assert.equal(mergeRowEdit(changed, { gate: { light: "" } }).gate, undefined, "blank removes the gate");
    assert.equal("gate" in mergeRowEdit(plain, { gate: { light: "" } }), false, "blank on a row with no gate gives it none");
    assert.deepEqual(mergeRowEdit({ ...set, gate: { ...set.gate, armourMax: "light" } }, { gate: { light: "" } }).gate, { armourMax: "light" }, "clearing keeps what else the gate holds, minus the kind");
    assert.deepEqual(mergeRowEdit(set, { note: "x" }).gate, set.gate, "an edit that does not name the level leaves the gate");
  });

  t("a spell row's cast fields are edited per kind, each with a label and a tooltip in the lang file", async () => {
    const { readFileSync } = await import("node:fs");
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    const kinds = {
      damage: ["saveEffect", "delivery", "extraordinary", "recur", "recurAt", "recurSave", "recurTarget", "exemptSizeFrom", "max", "pick", "pickOption", "reversed"],
      heal: ["saveEffect", "max", "pick", "pickOption", "reversed"],
      conditionGrant: ["saveEffect", "lasts", "rounds", "recur", "recurAt", "recurSave", "recurTarget", "exemptSizeFrom", "pick", "pickOption", "reversed"],
      conditionRemove: ["pick", "pickOption"],
      modifier: ["stacksWith", "notStacksWith", "pick", "pickOption"],
      ignite: ["lasts", "rounds", "reversed", "pick", "pickOption"],
      summon: ["pick", "pickOption"],
    };
    for (const [kind, names] of Object.entries(kinds)) {
      for (const name of names) {
        assert.ok(fieldsForType(kind).includes(name), `${kind} edits ${name}`);
        assert.ok(lang[`ACKS-LIB.effectEditor.field.${name}`], `a label for ${name}`);
        assert.ok(lang[`ACKS-LIB.effectEditor.tip.${name}`], `a tooltip for ${name}`);
      }
    }
    for (const word of ["Yes", "No"]) assert.ok(Object.values(lang).includes(word));
    assert.ok(lang["ACKS-LIB.effectEditor.field.key"] && lang["ACKS-LIB.effectEditor.tip.key"], "the read-only key has its words");
    assert.ok(!fieldsForType("damage").includes("key"), "the key is shown from the row, not offered as a kind's field");
    assert.ok(fieldsForType("ignite").includes("appliesTo") && !fieldsForType("ignite").includes("value"), "an ignite row names whom it lights and carries no figure");
  });

  t("the extraordinary select is three-state: unset stores null, yes and no store the booleans, and a form without it leaves it", () => {
    const row = { type: "damage", key: "scorch", extraordinary: null };
    assert.equal(mergeRowEdit(row, { extraordinary: "true" }).extraordinary, true);
    assert.equal(mergeRowEdit(row, { extraordinary: "false" }).extraordinary, false, "a no is a value, not an unset");
    assert.equal(mergeRowEdit({ ...row, extraordinary: true }, { extraordinary: "" }).extraordinary, null, "unset returns to null");
    assert.equal(mergeRowEdit({ ...row, extraordinary: false }, { note: "x" }).extraordinary, false, "a form that does not carry it leaves it");
    assert.equal(mergeRowEdit(row, { extraordinary: true }).extraordinary, true, "a real boolean passes");
  });

  t("a row's key is never an edit, and an edit still hands a register row to the Judge", () => {
    const row = { type: "damage", key: "scorch", origin: "register", pick: "a" };
    const next = mergeRowEdit(row, { key: "other", pick: "b", reversed: true, saveEffect: "half" });
    assert.equal(next.key, "scorch", "a key in the form changes nothing");
    assert.deepEqual([next.pick, next.reversed, next.saveEffect, next.origin], ["b", true, "half", ""]);
    assert.equal("key" in mergeRowEdit({ type: "damage" }, { pick: "a" }), false, "a row with no key gains none");
  });

  t("a light level never replaces a gate of another kind, and the armour limit fields are unchanged", () => {
    const status = { type: "modifier", gate: { kind: "status", status: "poisoned" } };
    assert.deepEqual(mergeRowEdit(status, { gate: { light: "daylight" } }).gate, status.gate, "a status gate stays as stored");
    assert.deepEqual(mergeRowEdit(status, { gate: { light: "" } }).gate, status.gate, "blank leaves it too");
    const limit = { type: "limitation", gate: { kind: "armourCeiling", armourMax: "light", noShield: false } };
    assert.deepEqual(mergeRowEdit(limit, { gate: { armourMax: "medium", noShield: true } }).gate, { kind: "armourCeiling", armourMax: "medium", noShield: true }, "an armour edit merges as before");
    assert.deepEqual(mergeRowEdit({ type: "limitation" }, { gate: { armourMax: "light" } }).gate, { armourMax: "light", kind: "armourCeiling" }, "a first armour field takes the armour kind");
    assert.deepEqual(mergeRowEdit(limit, { gate: { light: "dim" } }).gate, limit.gate, "a stray light value cannot touch an armour gate");
  });

  t("the fields a spell's rows gained are edited per kind, each with a label and a tooltip in the lang file", async () => {
    const { readFileSync } = await import("node:fs");
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    const said = (part) => lang[`ACKS-LIB.effectEditor.${part}`];
    const kinds = {
      modifier: ["ownSave", "ifHas", "pickKind", "attackKinds", "gate.status", "gate.occasion", "endsOn"],
      ward: ["saveEffect", "endsOn"],
      grants: ["appliesTo", "mode", "value", "atLevelNum", "atLevelDen"],
      modifies: ["appliesTo", "appliesToRoll", "ifHas"],
      conditionGrant: ["untimed", "endsOn", "exemptSizeOver"],
      ignite: ["endsOn"],
      damage: ["exemptSizeOver"],
      slay: ["appliesTo", "saveEffect", "reversed"],
      destroyItem: ["appliesTo", "saveEffect", "reversed"],
      spellcastingMod: ["target", "value", "schools", "elements", "bySelection", "saveCategories", "perDie", "stacksWith", "notStacksWith", "ifHas"],
    };
    const mine = ["ownSave", "pickKind", "attackKinds", "endsOn", "untimed", "exemptSizeOver", "ifHas", "appliesToRoll", "schools", "elements", "bySelection", "saveCategories", "perDie", "gate.status", "gate.occasion"];
    for (const [kind, names] of Object.entries(kinds)) {
      for (const name of names) {
        assert.ok(fieldsForType(kind).includes(name), `${kind} edits ${name}`);
        assert.ok(said(`field.${name}`), `a label for ${name}`);
      }
    }
    for (const name of mine.filter((n) => n !== "gate.status")) assert.ok(said(`tip.${name}`), `a tooltip for ${name}`);
    for (const key of ["statusTip", "statusLocked", "tip.cite", "attackKind.melee", "attackKind.missile", "attackKind.thrown", "endsOn.damage", "endsOn.attack", "bucket.casterLevel", "bucket.save", "bucket.damage"]) assert.ok(said(key), key);
    assert.ok(!fieldsForType("slay").includes("value") && !fieldsForType("destroyItem").includes("range"), "neither kind offers a figure it never reads");
  });

  t("a cast's own fields are left off an ability's row; the narrowing ones stay, and a spellcasting row still stacks", () => {
    for (const name of ["ownSave", "pickKind", "endsOn", "untimed", "exemptSizeOver"]) {
      assert.ok(!fieldsForType("modifier", "ability").includes(name), `a modifier offers ${name} to an ability`);
      assert.ok(!fieldsForType("conditionGrant", "ability").includes(name), `a condition row offers ${name} to an ability`);
    }
    for (const name of ["attackKinds", "ifHas", "gate.status", "gate.occasion"]) assert.ok(fieldsForType("modifier", "ability").includes(name), `an ability's modifier edits ${name}`);
    const cast = fieldsForType("spellcastingMod", "ability");
    for (const name of ["schools", "elements", "bySelection", "saveCategories", "perDie", "stacksWith", "notStacksWith", "ifHas"]) assert.ok(cast.includes(name), `a spellcasting row edits ${name}`);
    assert.ok(!fieldsForType("modifier", "ability").includes("stacksWith"), "the exemption is the spellcasting row's alone");
  });

  t("a status named on a modifier makes its gate, a blank one clears it, and it never replaces another kind", () => {
    const plain = { type: "modifier", target: "save" };
    const set = mergeRowEdit(plain, { gate: { light: "", status: "alpha", occasion: false } });
    assert.deepEqual(set.gate, { kind: "status", status: "alpha" }, "a status on a gateless row makes a status gate, with no occasion mark");
    const marked = mergeRowEdit(set, { gate: { status: "alpha", occasion: true } });
    assert.deepEqual(marked.gate, { kind: "status", status: "alpha", occasion: true });
    assert.deepEqual(mergeRowEdit(marked, { gate: { status: "beta", occasion: false } }).gate, { kind: "status", status: "beta" }, "the mark goes when it is cleared");
    assert.equal(mergeRowEdit(marked, { gate: { status: "", occasion: true } }).gate, undefined, "a blank status removes the gate");
    assert.equal("gate" in mergeRowEdit(plain, { gate: { status: "", occasion: false } }), false, "blank on a gateless row gives it none");
    const light = { type: "modifier", gate: { kind: "light", light: "dim" } };
    assert.deepEqual(mergeRowEdit(light, { gate: { status: "alpha", occasion: true } }).gate, light.gate, "a light gate stays as stored");
    assert.deepEqual(mergeRowEdit(marked, { note: "x" }).gate, marked.gate, "an edit that does not name the status leaves the gate");
    assert.deepEqual(mergeRowEdit({ ...marked, gate: { ...marked.gate, loadMax: 3 } }, { gate: { status: "" } }).gate, { loadMax: 3 }, "clearing keeps what else the gate holds, minus the kind");
    assert.ok(!("status" in mergeRowEdit(light, { gate: { light: "dim", status: "alpha" } }).gate), "a status never rides into a light gate");
  });

  t("the set and list fields a row gained are replaced as the window holds them", () => {
    const row = { type: "conditionGrant", conditions: ["alpha"], untimed: ["alpha"], endsOn: ["damage"], attackKinds: ["melee"], ifHas: ["x"], schools: ["one"] };
    const next = mergeRowEdit(row, { endsOn: ["damage", "attack"], untimed: [], attackKinds: ["missile"], ifHas: ["y", "z"], schools: [] });
    assert.deepEqual([next.endsOn, next.untimed, next.attackKinds, next.ifHas, next.schools], [["damage", "attack"], [], ["missile"], ["y", "z"], []]);
  });

  // A window's context is read after an await, so the test is awaited and the globals it set are still its own.
  const awaited = async (name, fn) => {
    await fn();
    n++;
    console.log(`ok - ${name}`);
  };
  await awaited("the window offers an untimed pick from the row's own conditions, locks a status under another gate, and names the page on a blank located figure", async () => {
    const prior = { foundry: globalThis.foundry, game: globalThis.game };
    globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class {} } }, utils: { randomID: () => "x", getProperty: (o, path) => path.split(".").reduce((v, k) => v?.[k], o) } };
    globalThis.game = { i18n: { format: (key, data) => key + (data?.cite ? ` ${data.cite}` : ""), localize: (key) => key } };
    try {
      const open = async (row, store = {}) => {
        const editor = new EffectRowEditor({ store: { key: "k", label: "L", domain: "spell", read: () => [row], write: async () => {}, ...store }, index: 0 });
        return (await editor._prepareContext({})).fields;
      };
      const none = await open({ type: "conditionGrant" });
      assert.ok(!none.some((f) => f.name === "untimed"), "a row that lists no condition offers no clock pick");
      const some = (await open({ type: "conditionGrant", conditions: ["alpha"], untimed: ["beta"] })).find((f) => f.name === "untimed");
      assert.deepEqual(some.options.map((o) => [o.key, o.checked]), [["alpha", false], ["beta", true]], "the row's conditions and what it already stores");
      const kinds = (await open({ type: "modifier", attackKinds: ["melee"] })).find((f) => f.name === "attackKinds");
      assert.deepEqual(kinds.options.filter((o) => o.checked).map((o) => o.key), ["melee"]);
      const locked = await open({ type: "modifier", gate: { kind: "light", light: "dim" } });
      assert.ok(locked.find((f) => f.name === "gate.status").disabled && locked.find((f) => f.name === "gate.occasion").disabled, "a light gate locks the status fields");
      assert.ok(!locked.find((f) => f.name === "gate.light").disabled, "and not its own");
      const free = await open({ type: "modifier", gate: { kind: "status", status: "alpha" } });
      assert.ok(!free.find((f) => f.name === "gate.status").disabled && free.find((f) => f.name === "gate.light").disabled, "a status gate locks the light level instead");
      const named = await open({ type: "conditionGrant", exemptSizeFrom: "alpha" }, { cite: "p. 9" });
      assert.ok(!named.find((f) => f.name === "exemptSizeFrom").tip.includes("p. 9"), "a figure that is set carries no reference");
      assert.ok(named.find((f) => f.name === "exemptSizeOver").tip.includes("p. 9"), "a blank located figure carries the page");
      const bare = await open({ type: "conditionGrant" });
      assert.ok(!bare.find((f) => f.name === "exemptSizeOver").tip.includes("tip.cite"), "a store that names no page adds none");
      const own = (await open({ type: "spellcastingMod" })).find((f) => f.name === "target");
      assert.deepEqual(own.list.map((o) => o.key), ["casterLevel", "save", "damage"], "a spellcasting row's target offers its three figures");
    } finally {
      globalThis.foundry = prior.foundry;
      globalThis.game = prior.game;
    }
  });

  t("an ability's row is offered none of a cast's fields", () => {
    for (const type of ["modifier", "conditionGrant", "conditionRemove", "damage"]) {
      const fields = fieldsForType(type, "ability");
      for (const name of [
        "saveEffect", "delivery", "extraordinary", "lasts", "recur", "pick", "reversed",
        "max", "pickOption", "recurAt", "recurSave", "recurTarget", "rounds", "exemptSizeFrom", "stacksWith",
      ]) assert.ok(!fields.includes(name), `${type} offers ${name} to an ability`);
    }
    assert.ok(fieldsForType("conditionGrant", "spell").includes("saveEffect"));
  });

  t("an edit keeps every field the window does not carry, a ladder in a count ceiling and the new cast fields included", () => {
    const row = {
      type: "damage", key: "arc", origin: "register", roll: "1d4",
      value: { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }] },
      max: { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 2 }] },
      pick: "mode", pickOption: "left", recur: "laterRounds", recurAt: "bearerEnd", recurSave: "cast", recurTarget: "pick",
      rounds: "1d3", exemptSizeFrom: "large", stacksWith: ["kw:a"], unread: ["max"],
    };
    const next = mergeRowEdit(row, { note: "x", max: { kind: "breakpoints" }, value: { kind: "breakpoints" } });
    for (const [name, value] of Object.entries(row)) {
      if (name === "origin") assert.equal(next.origin, "", "an edit hands the row to the Judge");
      else assert.deepEqual(next[name], value, `${name} survives an edit that does not touch it`);
    }
    assert.deepEqual(mergeRowEdit(row, { max: { kind: "flat", flat: 3 } }).max, { kind: "flat", flat: 3, breakpoints: row.max.breakpoints }, "a count ceiling fragment merges into the stored one as a value does");
    const edited = mergeRowEdit(row, { pickOption: "right", recurAt: "casterTurn", recurSave: "", recurTarget: "", rounds: "2d3", exemptSizeFrom: "huge" });
    assert.deepEqual([edited.pickOption, edited.recurAt, edited.recurSave, edited.recurTarget, edited.rounds, edited.exemptSizeFrom], ["right", "casterTurn", "", "", "2d3", "huge"]);
  });

  t("the new recurrence and lasting members, and the ignite kind, have their words and are spell-only", async () => {
    const { readFileSync } = await import("node:fs");
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    for (const family of ["effectRecurMoment", "effectRecurSave", "effectRecurTarget"]) assert.ok(MAGIC_VOCAB[family], `${family} is registered`);
    for (const key of ["nextTurn", "rounds"]) assert.ok(V.EFFECT_LASTS[key] && lang[`ACKS-LIB.enum.effectLasts.${key}`], `lasts ${key}`);
    assert.ok(V.EFFECT_RECURRENCES.laterRounds && lang["ACKS-LIB.enum.effectRecur.laterRounds"]);
    assert.equal(V.EFFECT_TYPES.ignite.domain, "spell");
    assert.ok(!Object.hasOwn(V.effectTypesFor("ability"), "ignite"), "an ability's picker does not offer a spell kind");
    assert.ok(Object.hasOwn(V.effectTypesFor("spell"), "ignite"));
  });

  t("the save, lasting and kind vocabulary of the saves-and-conditions entries has its words, and the row and target carry the new fields", async () => {
    const { readFileSync } = await import("node:fs");
    const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
    assert.ok(V.SAVE_EFFECTS.none && lang["ACKS-LIB.enum.saveEffect.none"], "a row no save governs");
    assert.ok(V.EFFECT_LASTS.followingTurn && lang["ACKS-LIB.enum.effectLasts.followingTurn"], "the bearer's following turn");
    for (const kind of ["slay", "destroyItem"]) {
      assert.equal(V.EFFECT_TYPES[kind].domain, "spell", `${kind} is a spell kind`);
      assert.ok(Object.hasOwn(V.effectTypesFor("spell"), kind) && !Object.hasOwn(V.effectTypesFor("ability"), kind), `${kind} is offered to a spell and not to an ability`);
    }
    const row = schemaProbe.effects.element.fields;
    assert.ok("endsOn" in row && "untimed" in row, "a row names what ends its record and what it writes untimed");
    assert.ok("hdBelow" in schemaProbe.target.fields && "hdCap" in schemaProbe.target.fields, "a strict bound beside the inclusive cap");
    assert.deepEqual(Object.keys(schemaProbe.reversedDuration.fields), Object.keys(schemaProbe.duration.fields), "the reverse form's duration has the plain duration's shape");
  });

  t("only a modifier row edits a light level", () => {
    assert.ok(fieldsForType("modifier").includes("gate.light"));
    for (const type of ["ward", "limitation", "damage"]) assert.ok(!fieldsForType(type).includes("gate.light"), type);
  });

  t("a modifier and a ward row edit their scope, and no other kind does", () => {
    for (const type of ["modifier", "ward"]) {
      const fields = fieldsForType(type);
      for (const name of ["vsKinds", "vsAlignment", "vsAlignmentOf", "vsAlignmentMode", "vsEnemy", "anyOf"]) assert.ok(fields.includes(name), `${type} edits ${name}`);
    }
    assert.ok(!fieldsForType("damage").includes("vsKinds"));
  });

  t("anyOfText names each branch's clauses through the lang and joins the branches with or", () => {
    const say = (key, data = {}) => `${key}${Object.keys(data).length ? JSON.stringify(data) : ""}`;
    assert.equal(
      anyOfText(stored.anyOf, say),
      'scope.enemy · scope.sourceExcept scope.or scope.kinds{"kinds":"beta"} · scope.alignment{"alignment":"Chaotic"}',
    );
    assert.equal(anyOfText([{ vsAlignment: "lawful", vsAlignmentMode: "except" }], say), 'scope.alignmentExcept{"alignment":"Lawful"}');
    assert.equal(anyOfText(undefined, say), "");
  });

  // The sheet actions run against a fake store, with the globals they read held for the call.
  const fakeStore = (rows, domain = "spell") => {
    const writes = [];
    return { key: "fake", label: "Fake", domain, read: () => structuredClone(rows), write: async (next, options) => (writes.push({ next, options }), next), writes };
  };
  const drive = async (fn, { confirm = true } = {}) => {
    const prior = { foundry: globalThis.foundry, game: globalThis.game };
    globalThis.foundry = { utils: { randomID: (length) => "r".repeat(length), escapeHTML: (text) => text }, applications: { instances: new Map(), api: { DialogV2: { confirm: async () => confirm } } } };
    globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
    try {
      return await fn();
    } finally {
      globalThis.foundry = prior.foundry;
      globalThis.game = prior.game;
    }
  };
  const ta = async (name, fn) => {
    await fn();
    n++;
    console.log(`ok - ${name}`);
  };
  const at = (index) => ({ dataset: { index: String(index) } });

  await ta("a row a Judge adds to a spell is keyed with an underscore and a random id, which no register key matches", async () => {
    const store = fakeStore([{ key: "heal", type: "heal" }]);
    await drive(() => effectRowActions(() => store).effectAdd.call({ document: {} }));
    assert.equal(store.writes.length, 1);
    assert.deepEqual(store.writes[0].next, [{ key: "heal", type: "heal" }, { key: "_rrrrrrrr", type: "damage" }]);
    assert.equal(store.writes[0].options, undefined, "an add retires nothing");
    assert.ok(!REGISTER_KEY.test(store.writes[0].next[1].key));
  });

  await ta("a row added to another kind of list carries no key", async () => {
    const store = fakeStore([], "ability");
    await drive(() => effectRowActions(() => store).effectAdd.call({ document: {} }));
    assert.deepEqual(store.writes[0].next, [{ type: "modifier" }]);
  });

  await ta("a delete tells the store which row it took out, once it is confirmed", async () => {
    const rows = [{ key: "heal", type: "heal" }, { key: "wound", type: "damage" }];
    const store = fakeStore(rows);
    await drive(() => effectRowActions(() => store).effectDelete.call({ document: {} }, null, at(0)));
    assert.deepEqual(store.writes, [{ next: [rows[1]], options: { removed: rows[0] } }]);
    const declined = fakeStore(rows);
    await drive(() => effectRowActions(() => declined).effectDelete.call({ document: {} }, null, at(0)), { confirm: false });
    assert.deepEqual(declined.writes, [], "a cancelled delete writes nothing");
  });

  await ta("a move writes the rows and names no removed row", async () => {
    const store = fakeStore([{ key: "a" }, { key: "b" }]);
    await drive(() => effectRowActions(() => store).effectMoveDown.call({ document: {} }, null, at(0)));
    assert.deepEqual(store.writes, [{ next: [{ key: "b" }, { key: "a" }], options: undefined }]);
  });
}

t("a delete retires a register row's key and nothing else", () => {
  assert.deepEqual(retiredWith([], { key: "heal" }), ["heal"]);
  assert.deepEqual(retiredWith(["wound"], { key: "heal" }), ["wound", "heal"]);
  assert.deepEqual(retiredWith(["heal"], { key: "heal" }), ["heal"], "a key already listed is listed once");
  assert.deepEqual(retiredWith(["wound"], { key: "_abcd1234" }), ["wound"], "a Judge's own row leaves no trace");
  assert.deepEqual(retiredWith(["wound"], { type: "damage" }), ["wound"], "a keyless row leaves none either");
  assert.deepEqual(retiredWith(undefined, undefined), []);
});

/* ------------------------------------------------------------------ */
/*  The spell sheet's Overview: the target and reversal figures        */
/* ------------------------------------------------------------------ */

{
  // The sheet module reads Foundry globals at import and at its context; this fake supplies what they touch.
  const prior = { foundry: globalThis.foundry, game: globalThis.game };
  const { default: SpellExtras } = await import("../scripts/magic/spell-extras.mjs");
  const fromSource = Object.getOwnPropertyDescriptor(SpellExtras, "fromSource");
  const getProperty = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
  globalThis.foundry = { applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class {} } }, utils: { deepClone: (o) => structuredClone(o), getProperty, randomID: () => "x" } };
  globalThis.game = { i18n: { format: (key, data) => key + (data?.cite ? ` ${data.cite}` : ""), localize: (key) => key } };
  SpellExtras.fromSource = (data) => ({ toObject: () => data });
  const sheet = await import("../scripts/magic/spell-sheet.mjs");
  const spell = (flag) => ({ uuid: "Item.invented", name: "Invented Spell", flags: { "acks-extras": { spell: flag } } });
  const contextOf = async (flag) => {
    const Sheet = sheet.createSpellSheet(class { static PARTS = {}; async _prepareContext() { return {}; } });
    const view = Object.create(Sheet.prototype);
    view.item = spell(flag);
    return view._prepareContext({});
  };
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const overview = read("templates/magic/tab-overview.hbs");
  const durationPartial = read("templates/magic/duration-fields.hbs");
  const awaitedHere = async (name, fn) => {
    await fn();
    n++;
    console.log(`ok - ${name}`);
  };
  try {
    t("the editor's words are the library's own: no key of the old magic editor root remains, and the editor reads one root", () => {
      assert.deepEqual(Object.keys(lang).filter((key) => key.startsWith(["ACKS-MAGIC", "editor", ""].join("."))), []);
      assert.ok(!/ACKS-MAGIC/.test(read("scripts/lib/apps/effect-row-editor.mjs")), "the library names no feature's lang root");
      for (const key of ["field.ownSave", "field.gate.status", "attackKind.melee", "endsOn.damage", "bucket.save", "tip.ownSave", "tip.cite", "statusTip", "statusLocked"]) {
        assert.ok(lang[`ACKS-LIB.effectEditor.${key}`], `ACKS-LIB.effectEditor.${key}`);
      }
    });

    t("the spell store names the spell's page, read when asked, so a blank located figure carries it", () => {
      assert.equal(sheet.spellEffectStore(spell({ cite: "p. 12" })).cite(), "p. 12");
      assert.equal(sheet.spellEffectStore(spell({})).cite(), undefined, "a spell that names no page gives none");
    });

    await awaitedHere("the page a spell's store names reaches the tooltip of a blank located figure in the row window", async () => {
      const { EffectRowEditor } = await import("../scripts/lib/apps/effect-row-editor.mjs");
      const row = { type: "conditionGrant", lasts: "rounds", exemptSizeFrom: "alpha" };
      const fields = async (flag) => {
        const base = sheet.spellEffectStore(spell({ ...flag, effects: [row] }));
        const editor = new EffectRowEditor({ store: { ...base, read: () => [row] }, index: 0 });
        return (await editor._prepareContext({})).fields;
      };
      const cited = await fields({ cite: "p. 12" });
      for (const name of ["rounds", "exemptSizeOver"]) assert.ok(cited.find((f) => f.name === name).tip.includes("p. 12"), `${name} carries the page`);
      assert.ok(!cited.find((f) => f.name === "exemptSizeFrom").tip.includes("p. 12"), "a figure that is set carries none");
      const bare = await fields({});
      assert.ok(!bare.find((f) => f.name === "rounds").tip.includes("tip.cite"), "a spell that names no page adds none");
    });

    await awaitedHere("the Hit Dice below which a target is exempt is edited on the Overview like the cap, and a blank one carries the page alone", async () => {
      const set = await contextOf({ cite: "p. 5", target: { hdBelow: { kind: "flat", flat: 7 } } });
      assert.equal(set.levelValues.hdBelow.name, "flags.acks-extras.spell.target.hdBelow");
      assert.equal(set.levelValues.hdBelow.value.flat, 7);
      assert.ok(set.figureTips.hdBelow.includes("ACKS-MAGIC.overview.figureTip.value") && set.figureTips.hdBelow.includes("p. 5"), "a set figure and its page");
      const blank = await contextOf({ cite: "p. 5" });
      assert.equal(blank.figureTips.hdBelow, "ACKS-MAGIC.overview.figureTip.cite p. 5", "blank: the reference alone, no figure and no words");
      assert.equal((await contextOf({})).figureTips.hdBelow, "", "no page, no tooltip");
      assert.match(overview, /levelValues\.hdBelow/);
      assert.match(overview, /figureTips\.hdBelow/);
      for (const key of ["hdBelow", "hdBelowHint"]) assert.ok(lang[`ACKS-MAGIC.overview.${key}`], key);
    });

    await awaitedHere("a reversed duration has the duration's own controls, submitted under its own path, and shows only on a reversible spell", async () => {
      const ctx = await contextOf({ reversible: true, duration: { shape: "fixed", value: 3, unit: "turns" }, reversedDuration: { shape: "dice", dice: "1d4", unit: "rounds" } });
      assert.equal(ctx.durations.main.name, "flags.acks-extras.spell.duration");
      assert.equal(ctx.durations.reversed.name, "flags.acks-extras.spell.reversedDuration");
      assert.equal(ctx.durations.main.show.time, true);
      assert.equal(ctx.durations.reversed.show.dice, true, "the reversed form's shape picks its own controls");
      assert.equal(ctx.durations.reversed.show.time, false);
      assert.equal(ctx.durations.reversed.text, displayDuration({ shape: "dice", dice: "1d4", unit: "rounds" }));
      assert.equal((await contextOf({})).durations.reversed.show.dice, false, "a spell with no reversed duration shows none of its controls");
      const uses = [...overview.matchAll(/duration-fields\.hbs" durations\.(\w+)/g)].map((m) => m[1]);
      assert.deepEqual(uses, ["main", "reversed"], "one partial serves both");
      assert.match(overview, /\{\{#if extras\.reversible\}\}\s*<fieldset>\s*<legend>\{\{localize "ACKS-MAGIC\.overview\.reversedDuration"\}\}<\/legend>\s*\{\{> "[^"]*duration-fields\.hbs" durations\.reversed\}\}/, "the reversed block sits inside the reversible gate");
      assert.ok(lang["ACKS-MAGIC.overview.reversedDuration"]);
      for (const name of ["shape", "concentration", "value", "unit", "maxPerLevel", "dice", "plus.value", "plus.unit", "note"]) assert.ok(durationPartial.includes(`name="{{name}}.${name}"`), `the partial submits ${name}`);
      assert.ok(!/\bid=/.test(durationPartial) && !/\bid="(?!\{\{@root\.partId\}\})/.test(overview), "no literal id");
      assert.ok(!/\{\{x\}\}\.duration/.test(overview), "the main duration's inputs moved into the partial whole");
    });
  } finally {
    globalThis.foundry = prior.foundry;
    globalThis.game = prior.game;
    if (fromSource) Object.defineProperty(SpellExtras, "fromSource", fromSource);
    else delete SpellExtras.fromSource;
  }
}

console.log(`\n${n} magic tests passed`);
