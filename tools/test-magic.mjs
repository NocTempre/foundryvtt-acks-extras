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
import { effectScan, frequencyOf } from "../scripts/importer/executor.mjs";
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
  const prose =
    "It can perform quiet step (as the spell) three times per day. Once per day it may cause a loud bang (as the spell loud bang). " +
    "It also possesses the following spell-like abilities: cure minor scrape, mend pot and pan (at will); and dim lantern (once per week). " +
    "A chieftain has the following spells in its repertoire: 1st - quiet step, mend pot and pan; 2nd – loud bang.";
  const scan = scanMonsterSpells(prose, { known, freqOf: frequencyOf });
  assert.deepEqual(scan.named, [
    { name: "loud bang", frequency: "perDay" },
    { name: "quiet step", frequency: "thricePerDay" },
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
    "It has the following spell-like abilities thrice per day: quiet step, loud bang. It has the following spell-like abilities once per week: dim lantern. " +
      "Its kin have several spell-like abilities, each of which can be used thrice per day: cure minor scrape, mend pot and pan. All function at caster level 9.",
    { known, freqOf: frequencyOf },
  );
  assert.deepEqual(opened.named, [
    { name: "quiet step", frequency: "thricePerDay" },
    { name: "loud bang", frequency: "thricePerDay" },
    { name: "dim lantern", frequency: "perWeek" },
    { name: "cure minor scrape", frequency: "thricePerDay" },
    { name: "mend pot and pan", frequency: "thricePerDay" },
  ]);
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
  assert.equal(frequencyOf("usable thrice a day"), "thricePerDay");
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
    { ref: "Actor.zzz", amount: 2, value: { kind: "flat", flat: 3 }, summonFormat: "conjuration", control: "obedient" },
  ]);
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

console.log(`\n${n} magic tests passed`);
