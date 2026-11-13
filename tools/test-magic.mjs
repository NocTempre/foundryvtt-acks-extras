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
import { MAGIC_VOCAB, SPELL_LIKE_FREQ, printedFrequencyText, vocabChoices, vocabLabel } from "../scripts/lib/magic-vocab.mjs";
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
} from "../scripts/magic/spell-logic.mjs";
import { describeSpellEffect } from "../scripts/magic/describe.mjs";
import { castDuration, NONE } from "../scripts/magic/cast-duration.mjs";
import { spellEffectData, spellEffectOf, newCastId } from "../scripts/magic/spell-effect.mjs";
import { isSummonSpell, summonOptionsOf, libraryTwin, resolveSummonRef, SUMMONING_TYPE } from "../scripts/magic/summon-spell.mjs";
import { TURN_SECONDS, ROUNDS_PER_TURN } from "../scripts/lib/constants.mjs";
import * as formationConstants from "../scripts/formation/constants.mjs";

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

t("effect rows read as one line each, spell kinds and shared kinds alike", () => {
  const line = (e) => describeSpellEffect(e).text;
  assert.equal(line({ type: "damage", appliesTo: "area", roll: "1d6", damage: ["fire"] }), "Everything in the area: 1d6 fire");
  assert.equal(line({ type: "heal", appliesTo: "recipient", healKind: "hitPoints", roll: "2d6" }), "The recipient: Hit points: 2d6");
  assert.equal(line({ type: "summon", summonFormat: "calling", amount: 2, ref: "a beast", value: { kind: "flat", flat: 3 }, control: "obedient" }), "Calling 2× a beast 3 HD Obedient");
  assert.equal(line({ type: "modifier", appliesTo: "target", target: "ac", value: { kind: "flat", flat: -2 }, condition: "while held" }), "The target: Armor Class -2 (while held)");
  assert.equal(line({ type: "modifier", target: "ac", value: { kind: "perLevel", base: 1, per: 1 } }), "Armor Class 1/level");
  assert.equal(line({ type: "conditionRemove", appliesTo: "recipient", conditions: ["paralysis"] }), "The recipient: cures Paralysis");
  assert.equal(line({ type: "spellLike", spellRef: { name: "Glimmer" }, spell: "old", frequency: "perDay" }), "Glimmer — Once per day");
  assert.equal(line({ type: "wall", appliesTo: "area", value: { kind: "flat", flat: 10 }, note: "stone" }), "Everything in the area: 10 (stone)");
  assert.equal(line({ type: "illusion" }), "—");
  assert.equal(describeSpellEffect({ type: "curse" }).kind, "Curse");
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

t("the time constants live in lib and formation re-exports the same figures", () => {
  assert.equal(formationConstants.TURN_SECONDS, TURN_SECONDS);
  assert.equal(formationConstants.ROUNDS_PER_TURN, ROUNDS_PER_TURN);
  assert.equal(typeof TURN_SECONDS, "number");
  assert.equal(typeof ROUNDS_PER_TURN, "number");
});

t("every duration shape has a row in the duration table, and an untimed one answers none", () => {
  const shapes = {
    instantaneous: { duration: {}, none: NONE.untimed },
    fixed: { duration: { value: 3, unit: "hours" }, out: { value: 3, units: "hours" } },
    perLevel: { duration: { value: 2, unit: "minutes" }, out: { value: 14, units: "minutes" } },
    basePlusPerLevel: { duration: { value: 5, unit: "days", plus: { value: 1, unit: "days" } }, out: { value: 12, units: "days" } },
    dice: { duration: { dice: "1d6", unit: "hours" }, out: { value: 4, units: "hours" } },
    concentration: { duration: { concentration: "mobile" }, none: NONE.untimed },
    concentrationMax: { duration: { value: 1, unit: "hours", concentration: "mobile" }, none: NONE.untimed },
    concentrationPlus: { duration: { value: 1, unit: "turns", plus: { value: 1, unit: "turns" } }, none: NONE.untimed },
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
    { ref: "Actor.zzz", name: "", amount: 2, value: { kind: "flat", flat: 3 }, summonFormat: "conjuration", control: "obedient" },
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
  CAST_SUMMON_KEY,
  castSummon,
  castSummonClaimant,
  castSummonSpell,
  registerCastSummon,
  spellNamesCreature,
  summonCastDuration,
  summonRefusal,
  summonRowsOf,
} = await import("../scripts/magic/cast-summon.mjs");
const { addSpellUseClaimant, installSpellUsePatch, removeSpellUseClaimant } = await import("../scripts/lib/patches/spell-use.mjs");
const { registerSummonPolicy, registerSummonNaming, checkPlaceRequest } = await import("../scripts/lib/summons-logic.mjs");

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

/** A creature the request names, as the placement check sees one. */
const creature = (over = {}) => ({ uuid: "Compendium.invented.Actor.abc", name: "Glimmerkin", type: "monster", flags: { "acks-extras": { cookbook: { id: "def.invented.glimmerkin" } } }, ...over });

await ta("claims is true only for a summoning spell on a character this seat owns", () => {
  const { claims } = castSummonClaimant({});
  assert.equal(claims(castSpell().spell), true);
  assert.equal(claims(castSpell({ owner: false }).spell), false, "a character this seat does not own is the system's cast");
  assert.equal(claims(castSpell({ parentType: "monster" }).spell), false, "a monster's spell item is never taken");
  assert.equal(claims(castSpell({ rows: [] }).spell), true, "a type word alone is a summoning spell");
  const plain = castSpell({ rows: [{ type: "damage" }] });
  plain.spell.flags["acks-extras"].spell.schools = ["blast"];
  assert.equal(claims(plain.spell), false, "an ordinary spell is the system's cast");
  assert.equal(claims({ type: "weapon", parent: { type: "character", isOwner: true } }), false);
  assert.equal(claims(null), false);
});

await ta("the policy refuses a creature no row names, and a count over the row's amount", () => {
  const { spell } = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 2 }), summonRow({ ref: "Compendium.invented.Actor.zzz", amount: 5 })] });
  const ask = (source, count, extra = {}) => summonRefusal({ user: PLAYER_SEAT, spell, source, sourceRef: "", count, ...extra }, NO_LOOKUPS);
  assert.equal(ask(creature(), 2), null, "a named creature at its amount");
  assert.equal(ask(creature(), 3), "badCount", "over the row's amount");
  assert.equal(ask(creature({ uuid: "Compendium.invented.Actor.zzz", flags: {} }), 5), null, "named by uuid, with its own row's amount");
  assert.equal(ask(creature({ uuid: "Compendium.invented.Actor.other", flags: {}, name: "Other" }), 1), "notNamed", "a creature no row names");
  assert.equal(ask(creature({ name: "Other", flags: {}, uuid: "u" }), 1, { source: null, sourceRef: "uuid:Compendium.invented.Actor.zzz" }), null, "an unresolved ref is compared as written, a uuid: prefix dropped");
  assert.equal(ask(null, 1, { sourceRef: "def.invented.nobody" }), "notNamed", "an unresolved ref no row names");
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

await ta("a spell with no rows of its own reads its library twin's, in the policy and the naming", () => {
  const twin = { flags: { "acks-extras": { spell: { effects: [summonRow({ ref: "def.invented.glimmerkin", amount: 1 })], duration: { shape: "fixed", value: 3, unit: "hours" } } } } };
  const { spell } = castSpell({ rows: [] });
  spell.flags["acks-extras"].cookbook = { id: "def.spell.invented" };
  const lookups = { byCookbookId: (type, id) => (type === "Item" && id === "def.spell.invented" ? twin : null), fromUuidSync: () => null };
  assert.deepEqual(summonRowsOf(spell, lookups).map((r) => r.ref), ["def.invented.glimmerkin"]);
  assert.equal(summonRefusal({ user: PLAYER_SEAT, spell, source: creature(), count: 2 }, lookups), "badCount");
  assert.equal(spellNamesCreature({ spell, source: creature() }, lookups), true);
  assert.equal(spellNamesCreature({ spell, source: creature({ flags: {}, uuid: "x", name: "Other" }) }, lookups), false);
  assert.deepEqual(summonCastDuration(spell, { lookups }), { value: 3, units: "hours" }, "the twin's imported duration");
});

await ta("an open row names nothing, so it keeps the shelf-readable check", () => {
  const { spell } = castSpell({ rows: [summonRow({ ref: "" })] });
  assert.equal(spellNamesCreature({ spell, source: creature() }, NO_LOOKUPS), false);
  assert.equal(spellNamesCreature({ spell: null, source: creature() }, NO_LOOKUPS) === false, true, "no spell, no naming");
});

await ta("the cast's duration is the spell's imported one, and none where nothing is imported", () => {
  const dur = (duration) => summonCastDuration(castSpell({ duration }).spell, { lookups: NO_LOOKUPS, roll: () => 4 });
  assert.deepEqual(dur({ shape: "fixed", value: 2, unit: "hours" }), { value: 2, units: "hours" });
  assert.deepEqual(dur({ shape: "dice", dice: "1d6", unit: "days" }), { value: 4, units: "days" }, "a dice duration reads the roll it is handed");
  assert.deepEqual(dur({ shape: "perLevel", value: 1, unit: "turns" }), { none: NONE.noLevel }, "no caster level is guessed");
  assert.deepEqual(dur(undefined), { none: NONE.noShape }, "nothing imported");
  assert.deepEqual(dur({ shape: "instantaneous" }), { none: NONE.untimed });
});

/** The dependencies a cast uses, with the prompt, the placement and the notices scripted. */
const fakeDeps = ({ pick = { sourceUuid: "def.invented.glimmerkin", count: 2, spellId: "sp1" }, place = { ok: true, castId: "castOK1", tokenUuids: ["a", "b"] }, roll = () => 4 } = {}) => {
  const log = { picks: [], places: [], notices: [], ready: 0 };
  return {
    log,
    ready: async () => { log.ready += 1; },
    lookups: NO_LOOKUPS,
    resolveRef: () => null,
    pick: async (caster, o) => (log.picks.push(o), typeof pick === "function" ? pick(o) : pick),
    place: async (caster, o) => (log.places.push(o), typeof place === "function" ? place(o) : place),
    announce: (result) => log.notices.push(result),
    roll,
    castId: () => "minted00",
  };
};

await ta("a placement the relay answers ok spends the cast once, before the cast returns, and writes the record", async () => {
  const { spell, caster } = castSpell({ duration: { shape: "fixed", value: 2, unit: "hours" } });
  const deps = fakeDeps();
  let spends = 0;
  let spendAt = -1;
  const out = await castSummonSpell(spell, async () => { spends += 1; spendAt = deps.log.places.length; return true; }, deps);
  assert.equal(out.ok, true);
  assert.equal(spends, 1);
  assert.equal(spendAt, 1, "spent after the placement, never before it");
  assert.deepEqual(deps.log.picks[0].options.map((r) => r.ref), ["def.invented.glimmerkin"], "the prompt is handed the spell's rows");
  assert.deepEqual(deps.log.places[0], { sourceUuid: "def.invented.glimmerkin", count: 2, spellId: "sp1" }, "the picked ref goes on untouched");
  assert.equal(deps.log.notices.length, 1, "the seat is told how it went");
  assert.equal(caster.created.length, 1);
  const [type, [data]] = caster.created[0];
  assert.equal(type, "ActiveEffect");
  assert.deepEqual(data.flags["acks-extras"].spellEffect, { spellUuid: spell.uuid, castId: "castOK1", casterUuid: caster.uuid, role: "caster" }, "the record carries the cast id the summons carry");
  assert.equal(data.origin, spell.uuid);
  assert.deepEqual(data.duration, { value: 2, units: "hours" });
  assert.equal(spellEffectOf(data).role, "caster");
});

await ta("a cast with no imported duration leaves a record with no duration, never a guess", async () => {
  const { spell, caster } = castSpell();
  await castSummonSpell(spell, async () => true, fakeDeps());
  assert.equal(caster.created[0][1][0].duration, undefined);
});

await ta("a cancelled prompt places nothing and spends nothing", async () => {
  const { spell, caster } = castSpell();
  const deps = fakeDeps({ pick: null });
  let spends = 0;
  const out = await castSummonSpell(spell, async () => { spends += 1; }, deps);
  assert.deepEqual(out, { ok: false, reason: "cancelled" });
  assert.equal(spends, 0);
  assert.equal(deps.log.places.length, 0);
  assert.equal(caster.created.length, 0);
});

await ta("a placement the user cancelled or the GM refused spends nothing and writes no record", async () => {
  for (const place of [{ ok: false, reason: "cancelled" }, { ok: false, reason: "notNamed" }, { ok: false, reason: "noGm" }, null]) {
    const { spell, caster } = castSpell();
    const deps = fakeDeps({ place });
    let spends = 0;
    const out = await castSummonSpell(spell, async () => { spends += 1; }, deps);
    assert.equal(out.ok, false, JSON.stringify(place));
    assert.equal(spends, 0, JSON.stringify(place));
    assert.equal(caster.created.length, 0);
    assert.equal(deps.log.notices.length, 1, "the refusal is announced; lib stays quiet for a cancel");
  }
});

await ta("a record that cannot be written is logged and never undoes a cast that happened", async () => {
  const { spell, caster } = castSpell();
  caster.createEmbeddedDocuments = async () => { throw new Error("no write"); };
  const logged = [];
  const prior = console.error;
  console.error = (...args) => logged.push(String(args[0]));
  let spends = 0;
  try {
    const out = await castSummonSpell(spell, async () => { spends += 1; }, fakeDeps());
    assert.equal(out.ok, true);
  } finally {
    console.error = prior;
  }
  assert.equal(spends, 1);
  assert.match(logged[0], /cast record/);
});

await ta("through the seam: castSummon awaits the placement, and the system's cast runs once, only on an ok relay", async () => {
  class FakeItem {
    cast = 0;
    async _useSpell() { this.cast += 1; }
  }
  const prior = { CONFIG: globalThis.CONFIG, libWrapper: globalThis.libWrapper };
  globalThis.CONFIG = { Item: { documentClass: FakeItem } };
  delete globalThis.libWrapper;
  try {
    installSpellUsePatch();
    for (const [place, expected] of [[{ ok: true, castId: "castSeam1", tokenUuids: ["a"] }, 1], [{ ok: false, reason: "cancelled" }, 0]]) {
      const deps = fakeDeps({ place });
      const { spell } = castSpell();
      const item = Object.assign(new FakeItem(), spell, { id: "sp1" });
      addSpellUseClaimant({ ...castSummonClaimant(deps), key: `${CAST_SUMMON_KEY}.test` });
      try {
        await castSummon(item, {});
      } finally {
        removeSpellUseClaimant(`${CAST_SUMMON_KEY}.test`);
      }
      assert.equal(item.cast, expected, `relay ${place.ok ? "ok" : "refused"}: the count rises by ${expected}`);
      assert.equal(deps.log.places.length, 1, "the placement was awaited, not left running");
    }
  } finally {
    globalThis.CONFIG = prior.CONFIG;
    if (prior.CONFIG === undefined) delete globalThis.CONFIG;
    if (prior.libWrapper) globalThis.libWrapper = prior.libWrapper;
  }
});

await ta("registerCastSummon registers all three once, replaces rather than doubles, and takes all three back", async () => {
  let off = registerCastSummon();
  const policies = [];
  const offTest = registerSummonPolicy((req) => (policies.push(req), null));
  try {
    const { spell } = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 1 })] });
    const summoner = { type: "character", items: new Map([["sp1", spell]]), testUserPermission: () => true, uuid: "Actor.caster1" };
    spell.parent = summoner;
    const verdict = (source, count) => checkPlaceRequest({ user: GM_SEAT, summoner, source, count, spellId: "sp1" });
    assert.equal(verdict(creature({ flags: {}, uuid: "x", name: "Other" }), 1).reason, "notNamed", "the registered policy refuses through lib's own check");
    assert.equal(verdict(creature(), 2).reason, "badCount");
    assert.equal(verdict(creature(), 1).ok, true);
    const stale = off;
    off = registerCastSummon();
    stale();
    assert.equal(verdict(creature(), 2).reason, "badCount", "a stale handle after a second registration takes nothing down");
    assert.equal(removeSpellUseClaimant(CAST_SUMMON_KEY), true, "the claimant is on the seam under its key");
    off();
    off();
    assert.equal(verdict(creature({ flags: {}, uuid: "x", name: "Other" }), 1).ok, true, "removed, the policy no longer refuses");
    assert.equal(removeSpellUseClaimant(CAST_SUMMON_KEY), false, "and the claimant is gone");
  } finally {
    offTest();
    removeSpellUseClaimant(CAST_SUMMON_KEY);
  }
  registerCastSummon()();
});

await ta("the naming exempts a named creature from the readable check; an unnamed one is still held to it", async () => {
  const off = registerSummonNaming((req) => spellNamesCreature(req, NO_LOOKUPS));
  try {
    const { spell } = castSpell({ rows: [summonRow({ ref: "def.invented.glimmerkin", amount: 2 })] });
    const summoner = { type: "character", items: new Map([["sp1", spell]]), testUserPermission: () => true, uuid: "Actor.caster1" };
    spell.parent = summoner;
    const unreadable = (over) => ({ ...creature(over), compendium: { testUserPermission: () => false } });
    const ask = (source, extra = {}) => checkPlaceRequest({ user: PLAYER_SEAT, summoner, source, count: 1, spellId: "sp1", ...extra });
    assert.equal(ask(unreadable()).ok, true, "a spell-named creature on a shelf the seat cannot open");
    assert.equal(ask(unreadable({ flags: {}, uuid: "x", name: "Other" })).reason, "unreadable", "an unnamed one stays unreadable");
    assert.equal(ask(null, { sourceRef: "def.invented.glimmerkin" }).ok, true, "the seat's own pre-check leaves a named, unresolvable ref to the GM");
    assert.equal(ask(null, { sourceRef: "def.invented.glimmerkin", positions: [{ x: 1, y: 1 }] }).reason, "badSource", "the relay never accepts an unresolved creature");
    assert.equal(ask(null, { sourceRef: "def.invented.nobody" }).reason, "badSource", "an unresolved ref no row names");
  } finally {
    off();
  }
});

/* ------------------------------------------------------------------ */
/*  A cast's end                                                       */
/* ------------------------------------------------------------------ */

const { ROUND_SECONDS, castRecordEnd, castEnded, castTokens, castEndedRecipients, announceEndedCast, sweepEndedCasts } = await import("../scripts/magic/cast-expiry.mjs");

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
t("a rounds record counts its rounds at a structural round, a turn's seconds over its rounds", () => {
  assert.equal(ROUND_SECONDS, TURN_SECONDS / ROUNDS_PER_TURN);
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

console.log(`\n${n} magic tests passed`);
