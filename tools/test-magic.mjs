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

console.log(`\n${n} magic tests passed`);
