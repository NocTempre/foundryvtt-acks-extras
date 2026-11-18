/**
 * Offline tests for a cast's ability matcher (`scripts/magic/cast-abilities.mjs`):
 * which `spellcastingMod` rows apply to a spell, the guards, stacking, the caster
 * level they build and the dice counter. Foundry-free; every ability, spell and
 * figure below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-abilities.mjs
 */
import assert from "node:assert/strict";

const { spellFacts, matchAbilities, castAbilityLevel, perDieTotal, diceCount, abilityPartTip, appliedSum } = await import("../scripts/magic/cast-abilities.mjs");
const { casterLevel } = await import("../scripts/magic/cast-level.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const ID = (slug) => `def.ability.${slug}`;
const spell = (over = {}, flag = {}) => ({
  name: "Ember Lance",
  uuid: "Item.sp1",
  flags: { "acks-extras": { cookbook: { id: "def.spell.emberLance" }, spell: { type: "blast", schools: [], elements: ["ember"], save: { category: "blast" }, ...flag } } },
  ...over,
});
const item = (slug, name, cite = "") => ({ id: `i-${slug}`, name, flags: { "acks-extras": { cookbook: { id: ID(slug), cite } } } });
/** One gathered row, as lib's `spellcastingRows` shapes it. */
const row = (slug, spec, { value = 1, selections = [], name = slug, cite = "", index = 0, provides = [] } = {}) => ({
  item: item(slug, name, cite),
  spec: { type: "spellcastingMod", target: "casterLevel", ...spec },
  index,
  value,
  selections,
  ref: { id: ID(slug), provides },
  unverified: false,
});
const names = (parts) => parts.map((p) => p.label);
const applying = (parts) => parts.filter((p) => p.applies);

t("each narrowing field matches by itself and rejects a spell that lacks the word", () => {
  const s = spell();
  const cases = [
    [{ schools: ["blast"] }, true],
    [{ schools: ["healing"] }, false],
    [{ elements: ["ember"] }, true],
    [{ elements: ["frost"] }, false],
    [{ saveCategories: ["blast"] }, true],
    [{ saveCategories: ["death"] }, false],
    [{ school: "blast" }, true],
    [{ school: "healing" }, false],
  ];
  for (const [spec, want] of cases) {
    assert.equal(matchAbilities([row("a", spec)], s).casterLevel.length, want ? 1 : 0, JSON.stringify(spec));
  }
});

t("a spell's own school list counts beside its type, and a word matches singular or plural, any case and punctuation", () => {
  const s = spell({}, { type: "blast", schools: ["Frost-work"] });
  assert.equal(matchAbilities([row("a", { schools: ["frostwork"] })], s).casterLevel.length, 1);
  assert.equal(matchAbilities([row("a", { schools: ["frost works"] })], s).casterLevel.length, 1);
  assert.equal(matchAbilities([row("a", { elements: ["EMBERS"] })], s).casterLevel.length, 1);
  assert.equal(matchAbilities([row("a", { schools: ["Blast"] })], s).casterLevel.length, 1);
});

t("fields AND; the members of one field OR", () => {
  const s = spell();
  const both = matchAbilities([row("a", { schools: ["blast"], elements: ["ember"] })], s);
  assert.equal(both.casterLevel.length, 1);
  const half = matchAbilities([row("a", { schools: ["blast"], elements: ["frost"] })], s);
  assert.equal(half.casterLevel.length, 0, "one failing field fails the row");
  const either = matchAbilities([row("a", { elements: ["frost", "ember", "gale"] })], s);
  assert.equal(either.casterLevel.length, 1, "one member of a list is enough");
  const three = matchAbilities([row("a", { schools: ["illusion", "blast"], elements: ["ember"], saveCategories: ["blast", "death"] })], s);
  assert.equal(three.casterLevel.length, 1);
  const noSave = matchAbilities([row("a", { saveCategories: ["blast"] })], spell({}, { save: {} }));
  assert.equal(noSave.casterLevel.length, 0, "a spell with no save category meets no save narrowing");
});

t("bySelection matches the pooled picks against the spell's elements and schools", () => {
  const s = spell();
  assert.equal(matchAbilities([row("a", { bySelection: true }, { selections: ["Ember"] })], s).casterLevel.length, 1);
  assert.equal(matchAbilities([row("a", { bySelection: true }, { selections: ["frost", "ember"] })], s).casterLevel.length, 1);
  assert.equal(matchAbilities([row("a", { bySelection: true }, { selections: ["blast"] })], s).casterLevel.length, 1, "a picked school counts");
  assert.equal(matchAbilities([row("a", { bySelection: true }, { selections: ["frost"] })], s).casterLevel.length, 0);
  assert.equal(matchAbilities([row("a", { bySelection: true }, { selections: [] })], s).casterLevel.length, 0, "no picks, no match");
  assert.equal(matchAbilities([row("a", { bySelection: false }, { selections: ["ember"] })], s).casterLevel.length, 0, "false narrows on nothing");
  assert.equal(matchAbilities([row("a", { bySelection: true, schools: ["healing"] }, { selections: ["ember"] })], s).casterLevel.length, 0, "bySelection ANDs with the other fields");
});

t("a named spell matches by cookbook id, then uuid, then folded name", () => {
  const s = spell();
  const named = (spellRef, extra = {}) => matchAbilities([row("a", { spellRef, ...extra })], s).casterLevel.length;
  assert.equal(named({ cookbookId: "def.spell.emberLance" }), 1);
  assert.equal(named({ cookbookId: "def.spell.other", name: "Ember Lance" }), 0, "the id decides where both carry one, whatever the name says");
  assert.equal(named({ uuid: "Item.sp1" }), 1);
  assert.equal(named({ uuid: "Item.zzz" }), 0);
  assert.equal(named({ name: "EMBER-lance" }), 1, "the name folds");
  assert.equal(named({ name: "Frost Spear" }), 0);
  assert.equal(matchAbilities([row("a", { spell: "ember  lance" })], s).casterLevel.length, 1, "the legacy name string");
  const bare = spell({ flags: { "acks-extras": { spell: { type: "blast" } } }, uuid: "Item.sp2" });
  assert.equal(matchAbilities([row("a", { spellRef: { cookbookId: "def.spell.emberLance", name: "Ember Lance" } })], bare).casterLevel.length, 1, "a spell with no id falls through to its name");
  assert.equal(named({ name: "Ember Lance" }, { elements: ["frost"] }), 0, "a named spell ANDs with the other fields");
});

t("spellFacts reads the copy, else its library twin", () => {
  const twin = spell({ uuid: "Compendium.lib.emberLance" }, { schools: ["pyre"], elements: ["ember"] });
  const lookups = { byCookbookId: (type, id) => (type === "Item" && id === "def.spell.emberLance" ? twin : null), fromUuidSync: () => null };
  const copy = {
    name: "Ember Lance",
    uuid: "Actor.a.Item.c1",
    _stats: { compendiumSource: "Compendium.lib.emberLance" },
    flags: { "acks-extras": { cookbook: { id: "def.spell.emberLance" }, spell: { type: "blast", elements: [], save: {} } } },
  };
  const facts = spellFacts(copy, lookups);
  assert.equal(facts.type, "blast", "the copy's own type");
  assert.deepEqual(facts.schools, ["pyre"], "the twin's schools where the copy has none");
  assert.deepEqual(facts.elements, ["ember"]);
  assert.equal(facts.saveCategory, "blast");
  assert.equal(facts.id, "def.spell.emberLance");
  assert.equal(facts.uuid, "Actor.a.Item.c1");
  assert.ok(facts.uuids.includes("Compendium.lib.emberLance") && facts.uuids.includes("Actor.a.Item.c1"));
  assert.equal(facts.name, "emberlance");
  assert.equal(matchAbilities([row("a", { schools: ["pyre"] })], copy, { lookups }).casterLevel.length, 1, "a row matches through the twin's facts");
  assert.equal(matchAbilities([row("a", { schools: ["pyre"] })], copy).casterLevel.length, 0, "with no lookups the twin is not read");
  const own = spellFacts(spell({}, { schools: ["own"], elements: ["ember"] }), { byCookbookId: () => assert.fail("a complete copy reads no twin"), fromUuidSync: () => assert.fail("no") });
  assert.deepEqual(own.schools, ["own"]);
  assert.deepEqual(spellFacts({ name: "Bare" }).schools, [], "a spell with no flag has no facts");
});

t("guard: an unknown target, an unnarrowed row and a failing ifHas match nothing", () => {
  const s = spell();
  const out = matchAbilities(
    [
      row("a", { target: "duration", schools: ["blast"] }),
      row("b", { target: "casterLevel" }),
      row("c", { target: "casterLevel", schools: [], elements: [], saveCategories: [], bySelection: false, school: "", spell: "" }),
      row("d", { schools: ["blast"], ifHas: [ID("missing")] }),
      row("e", { schools: ["blast"] }),
    ],
    s,
    { has: [] },
  );
  assert.deepEqual(names(out.casterLevel), ["e"]);
  assert.deepEqual(out.save, []);
  assert.deepEqual(out.damage, []);
  const wrongType = row("f", { schools: ["blast"] });
  wrongType.spec.type = "modifier";
  assert.equal(matchAbilities([wrongType], s).casterLevel.length, 0, "only a spellcastingMod row counts");
});

t("ifHas is answered by a function, a list of held abilities, or the rows' own abilities", () => {
  const s = spell();
  const needs = row("n", { schools: ["blast"], ifHas: [ID("other")] });
  assert.equal(matchAbilities([needs], s, { has: (tokens) => tokens.includes(ID("other")) }).casterLevel.length, 1);
  assert.equal(matchAbilities([needs], s, { has: () => false }).casterLevel.length, 0);
  assert.equal(matchAbilities([needs], s, { has: [{ id: ID("other"), provides: [] }] }).casterLevel.length, 1);
  assert.equal(matchAbilities([needs], s, { has: [{ id: ID("elsewhere"), provides: [] }] }).casterLevel.length, 0);
  assert.equal(matchAbilities([needs, row("other", { schools: ["healing"] })], s).casterLevel.length, 1, "by default a row's own ability counts as held");
  const byCapability = row("k", { schools: ["blast"], ifHas: ["kw:wardcraft"] });
  assert.equal(matchAbilities([byCapability], s, { has: [{ id: ID("x"), provides: ["kw:wardcraft"] }] }).casterLevel.length, 1);
});

t("guard: a blank figure applies nothing and carries the page reference", () => {
  const s = spell();
  const out = matchAbilities([row("a", { schools: ["blast"] }, { value: null, cite: "RR 99" }), row("b", { schools: ["blast"] }, { value: 2 })], s);
  const [blank, figure] = out.casterLevel;
  assert.equal(blank.value, null);
  assert.equal(blank.applies, false);
  assert.equal(blank.blank, true);
  assert.equal(blank.cite, "RR 99");
  assert.equal(figure.applies, true);
  assert.equal(appliedSum(out.casterLevel), 2);
  const none = matchAbilities([row("a", { schools: ["blast"] }, { value: NaN })], s);
  assert.equal(none.casterLevel[0].blank, true, "a figure that is not a number is blank");
});

t("each bucket collects its own target and carries the row's identity", () => {
  const s = spell();
  const out = matchAbilities(
    [
      row("a", { target: "casterLevel", schools: ["blast"] }, { value: 1, index: 2 }),
      row("b", { target: "save", elements: ["ember"] }, { value: -2, cite: "JJ 7" }),
      row("c", { target: "damage", schools: ["blast"], perDie: true }, { value: 1 }),
    ],
    s,
  );
  assert.deepEqual(names(out.casterLevel), ["a"]);
  assert.deepEqual(names(out.save), ["b"]);
  assert.deepEqual(names(out.damage), ["c"]);
  assert.equal(out.casterLevel[0].index, 2);
  assert.equal(out.casterLevel[0].itemId, "i-a");
  assert.equal(out.save[0].value, -2);
  assert.equal(out.save[0].cite, "JJ 7");
  assert.equal(out.damage[0].perDie, true);
  assert.equal(out.casterLevel[0].caps, undefined, "the stacking machinery stays off the part");
});

t("two abilities add; a pair a row names does not", () => {
  const s = spell();
  const add = matchAbilities([row("a", { schools: ["blast"] }, { value: 1 }), row("b", { elements: ["ember"] }, { value: 2 })], s);
  assert.deepEqual(applying(add.casterLevel).map((p) => p.value), [1, 2]);
  assert.equal(appliedSum(add.casterLevel), 3);
  const named = matchAbilities([row("a", { schools: ["blast"] }, { value: 1 }), row("b", { elements: ["ember"], notStacksWith: [ID("a")] }, { value: 2 })], s);
  assert.deepEqual(names(applying(named.casterLevel)), ["b"]);
  const lost = named.casterLevel.find((p) => p.label === "a");
  assert.equal(lost.applies, false);
  assert.equal(lost.yieldsTo, "b", "the loser is kept and names who beat it");
  assert.equal(lost.sameItem, false);
  assert.equal(lost.value, 1);
  const shared = matchAbilities(
    [row("a", { schools: ["blast"] }, { value: 1, provides: ["kw:kindling"] }), row("b", { elements: ["ember"] }, { value: 3, provides: ["kw:kindling"] })],
    s,
  );
  assert.deepEqual(names(applying(shared.casterLevel)), ["b"], "two providers of one capability do not stack");
  const named2 = matchAbilities([row("a", { schools: ["blast"], stacksWith: [ID("b")] }, { value: 1, provides: ["kw:kindling"] }), row("b", { elements: ["ember"] }, { value: 3, provides: ["kw:kindling"] })], s);
  assert.equal(applying(named2.casterLevel).length, 2, "a row that names the pair in stacksWith restores the sum");
});

t("a combined row (ifHas the other, notStacksWith both ways): the largest wins and the others yield to it", () => {
  const s = spell();
  const rows = (combined) => [
    row("a", { schools: ["blast"] }, { value: 2 }),
    row("b", { elements: ["ember"] }, { value: 2 }),
    row("both", { schools: ["blast"], ifHas: [ID("a"), ID("b")], notStacksWith: [ID("a"), ID("b")] }, { value: combined }),
  ];
  const big = matchAbilities(rows(3), s, { has: [{ id: ID("a") }, { id: ID("b") }] });
  assert.deepEqual(names(applying(big.casterLevel)), ["both"]);
  assert.deepEqual(big.casterLevel.filter((p) => !p.applies).map((p) => [p.label, p.yieldsTo]), [["a", "both"], ["b", "both"]]);
  const lacking = matchAbilities(rows(3), s, { has: [{ id: ID("a") }] });
  assert.deepEqual(names(lacking.casterLevel), ["a", "b"], "without both abilities held the combined row does not match, and the two add");
  assert.equal(appliedSum(lacking.casterLevel), 4);
});

t("a save penalty is the caster's benefit: the most negative combined row wins, and the -2 rows yield to it", () => {
  const s = spell();
  const save = { target: "save" };
  const out = matchAbilities(
    [
      row("a", { ...save, schools: ["blast"] }, { value: -2 }),
      row("b", { ...save, schools: ["blast"] }, { value: -2, index: 0 }),
      row("b", { ...save, schools: ["blast"], ifHas: [ID("a")], notStacksWith: [ID("a"), ID("b")] }, { value: -3, index: 1 }),
    ],
    s,
    { has: [{ id: ID("a") }, { id: ID("b") }] },
  );
  assert.deepEqual(applying(out.save).map((p) => [p.label, p.value]), [["b", -3]]);
  assert.equal(appliedSum(out.save), -3);
  const lost = out.save.filter((p) => !p.applies);
  assert.deepEqual(lost.map((p) => [p.label, p.value, p.yieldsTo]), [["a", -2, "b"], ["b", -2, "b"]], "both -2 rows carry the winner in yieldsTo");
  assert.deepEqual(out.save.map((p) => p.value), [-2, -2, -3], "the parts keep their own signed figures");
});

t("two unnamed save penalties still add", () => {
  const s = spell();
  const out = matchAbilities([row("a", { target: "save", schools: ["blast"] }, { value: -2 }), row("b", { target: "save", elements: ["ember"] }, { value: -1 })], s);
  assert.deepEqual(applying(out.save).map((p) => p.value), [-2, -1]);
  assert.equal(appliedSum(out.save), -3);
});

t("a combined caster-level row of +3 beats the +2 base rows it names", () => {
  const s = spell();
  const out = matchAbilities(
    [
      row("a", { schools: ["blast"] }, { value: 2 }),
      row("b", { schools: ["blast"] }, { value: 2, index: 0 }),
      row("b", { schools: ["blast"], ifHas: [ID("a")], notStacksWith: [ID("a"), ID("b")] }, { value: 3, index: 1 }),
    ],
    s,
    { has: [{ id: ID("a") }, { id: ID("b") }] },
  );
  assert.deepEqual(applying(out.casterLevel).map((p) => [p.label, p.value]), [["b", 3]]);
  assert.deepEqual(out.casterLevel.filter((p) => !p.applies).map((p) => [p.label, p.yieldsTo]), [["a", "b"], ["b", "b"]]);
});

t("one ability's rows never add: the largest stands and the rest yield to their own ability", () => {
  const s = spell();
  const out = matchAbilities(
    [
      row("a", { schools: ["blast"] }, { value: 1, index: 0 }),
      row("a", { elements: ["ember"] }, { value: 3, index: 1 }),
      row("a", { saveCategories: ["blast"] }, { value: 2, index: 2 }),
      row("b", { schools: ["blast"] }, { value: 1 }),
    ],
    s,
  );
  assert.deepEqual(applying(out.casterLevel).map((p) => [p.label, p.value]), [["a", 3], ["b", 1]]);
  assert.equal(appliedSum(out.casterLevel), 4);
  const lost = out.casterLevel.filter((p) => !p.applies);
  assert.deepEqual(lost.map((p) => [p.index, p.sameItem, p.yieldsTo]), [[0, true, "a"], [2, true, "a"]]);
  const rowless = { ...row("a", { schools: ["blast"] }, { value: 1 }), ref: {} };
  const rowless2 = { ...row("a", { elements: ["ember"] }, { value: 2, index: 1 }), ref: {} };
  assert.equal(appliedSum(matchAbilities([rowless, rowless2], s).casterLevel), 2, "an ability with no cookbook id is told by its item");
  const split = matchAbilities([row("a", { target: "casterLevel", schools: ["blast"] }, { value: 1 }), row("a", { target: "save", schools: ["blast"] }, { value: 1, index: 1 })], s);
  assert.equal(applying(split.casterLevel).length + applying(split.save).length, 2, "rows to different buckets do not meet");
});

t("castAbilityLevel adds the applying figures to casterLevel()'s level and keeps its source", () => {
  const level = casterLevel({ matched: true, classLevel: 5 });
  const s = spell();
  const parts = matchAbilities([row("a", { schools: ["blast"] }, { value: 2 }), row("b", { elements: ["frost"] }, { value: 1 }), row("c", { schools: ["blast"] }, { value: null })], s).casterLevel;
  const out = castAbilityLevel(level, parts);
  assert.equal(out.value, 7);
  assert.equal(out.base, 5);
  assert.equal(out.source, "class");
  assert.deepEqual(names(out.parts), ["a"]);
  assert.deepEqual(names(out.listed), ["c"], "a blank part is listed, not added");
  const ladder = castAbilityLevel(casterLevel({ matched: true, classLevel: 4, ladder: { values: [{ atLevel: 1, value: 2 }] } }), parts);
  assert.equal(ladder.value, 4);
  assert.equal(ladder.source, "ladder");
  assert.equal(castAbilityLevel(level, []).value, 5, "no parts leaves the base");
  assert.equal(castAbilityLevel(level, undefined).value, 5);
});

t("castAbilityLevel: a null base stays null, a hand-typed level takes no delta, a level is never below one", () => {
  const parts = matchAbilities([row("a", { schools: ["blast"] }, { value: 2 })], spell()).casterLevel;
  const none = castAbilityLevel(casterLevel({}), parts);
  assert.deepEqual([none.value, none.source, none.base], [null, null, null]);
  assert.deepEqual(none.parts, []);
  assert.equal(none.listed.length, 1);
  const hand = castAbilityLevel(casterLevel({ override: 6, matched: true, classLevel: 9 }), parts);
  assert.deepEqual([hand.value, hand.source, hand.base], [6, "hand", 6]);
  assert.deepEqual(hand.parts, []);
  assert.deepEqual(names(hand.listed), ["a"]);
  const low = matchAbilities([row("a", { schools: ["blast"] }, { value: -9 })], spell()).casterLevel;
  assert.equal(castAbilityLevel(casterLevel({ matched: true, classLevel: 3 }), low).value, 1);
  assert.deepEqual([castAbilityLevel(null, parts).value, castAbilityLevel({ value: "x" }, parts).value], [null, null]);
});

t("diceCount counts the dice of a scaled formula and perDieTotal multiplies a perDie part by them", () => {
  assert.equal(diceCount("3d6"), 3);
  assert.equal(diceCount("d8"), 1);
  assert.equal(diceCount("2d6+1d4+3"), 3);
  assert.equal(diceCount("5"), 0);
  assert.equal(diceCount(""), 0);
  assert.equal(diceCount(undefined), 0);
  assert.equal(perDieTotal({ value: 2, perDie: true }, "4d6+1"), 8);
  assert.equal(perDieTotal({ value: 2, perDie: false }, "4d6"), 2, "a flat part ignores the dice");
  assert.equal(perDieTotal({ value: 2, perDie: true }, "7"), 0, "a perDie part on a formula with no die adds none");
  assert.equal(perDieTotal({ value: null, perDie: true }, "4d6"), 0);
  assert.equal(perDieTotal(undefined, "4d6"), 0);
  const out = matchAbilities([row("a", { target: "damage", schools: ["blast"], perDie: true }, { value: 1 }), row("b", { target: "damage", elements: ["ember"] }, { value: 2 })], spell()).damage;
  assert.equal(out.reduce((sum, p) => sum + perDieTotal(p, "3d6"), 0), 5, "3 per-die plus a flat 2");
});

t("abilityPartTip reads the ability, the signed figure and the page, and names who a loser yields to", () => {
  const loc = (key, data = {}) => `${key.replace("ACKS-MAGIC.cast.ability.", "")}|${Object.values(data).join("|")}`;
  assert.equal(abilityPartTip({ label: "Fire Focus", value: 2, cite: "RR 9" }, loc), "part|Fire Focus|+2|RR 9");
  assert.equal(abilityPartTip({ label: "Fire Focus", value: -1, cite: "" }, loc), "partBare|Fire Focus|-1|");
  assert.equal(abilityPartTip({ label: "Fire Focus", value: null, blank: true, cite: "RR 9" }, loc), "blank|Fire Focus|RR 9");
  assert.equal(abilityPartTip({ label: "Fire Focus", value: null, blank: true, cite: "" }, loc), "Fire Focus");
  assert.equal(abilityPartTip({ label: "Fire Focus", value: 1, cite: "RR 9", yieldsTo: "Pyre Mastery" }, loc), "part|Fire Focus|+1|RR 9 · yields|Pyre Mastery");
  const parts = matchAbilities([row("a", { schools: ["blast"] }, { value: 1, cite: "RR 9" }), row("b", { schools: ["blast"], notStacksWith: [ID("a")] }, { value: 2 })], spell()).casterLevel;
  assert.match(abilityPartTip(parts[0], loc), /yields\|b$/);
});

console.log(`\n${n} tests passed`);
