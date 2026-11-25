/**
 * Offline tests for the recipe editor's logic (scripts/monsters/recipe-editor-logic.mjs):
 * the two tables' rows for a state and what decides a Units row, the hand count and a
 * row's tooltip, the checks on a part's figures, the origin a save blanks and restores,
 * a reset, a Judge's own part, the sentences of the stored prose marked by the parts that
 * read them, a mount or beast part's link, and which stored recipe each entry point
 * writes. Foundry-free and book-free: every part, word, sentence and page reference
 * below is invented.
 *
 * Run: node tools/test-recipe-editor-logic.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LINKED_ROLES, RECIPE_TEXT, addPart, editorRows, handCount, linkChanges, mountBeastLink, parseCount, readCopyAt, readStored,
  recipeAt, recipeTarget, recipeUpdate, resetAll, resetPart, samePart, savePart, sentenceMarks, shapePart, storedParagraphs, validatePart,
} from "../scripts/monsters/recipe-editor-logic.mjs";
import { readEcologyRecipe } from "../scripts/importer/ecology-recipe.mjs";
import { bookText } from "../scripts/importer/prose.mjs";
import { REGISTER_ORIGIN } from "../scripts/lib/magic-vocab.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/** A part in the stored shape, as the import writes it. */
const part = (key, role, over = {}) => ({
  key, origin: REGISTER_ORIGIN, label: over.label ?? key, role,
  source: { uuid: "", templateCell: "", stat: "", name: "", ...(over.source ?? {}) },
  count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...(over.count ?? {}) },
  chance: over.chance ?? null,
  when: { state: "", place: "", units: [], ...(over.when ?? {}) },
  branch: { group: "", band: "" },
  moraleWhileAlive: over.moraleWhileAlive ?? null, fixedHp: over.fixedHp ?? null, cite: over.cite ?? "XX p. 1", basis: over.basis ?? "page",
});

const IMPORT = [
  part("size-wilderness-lair", "unit", { label: "hold", source: { name: "band" }, count: { dice: "1d10" }, when: { state: "lair", place: "wilderness", units: ["hold"] } }),
  part("size-wilderness-wandering", "body", { label: "band", count: { dice: "1d6" }, when: { state: "wandering", place: "wilderness", units: ["band"] } }),
  part("archers", "body", { count: { ratioOf: "unit", percent: 40, round: "up" }, when: { units: ["band"] } }),
  part("leader-chief", "leader", { label: "QA chief", count: { literal: 1 }, moraleWhileAlive: 2, when: { units: ["hold"] } }),
  part("guard-qux", "guard", { label: "qux", source: { name: "qux" }, count: { dice: "1d4" }, chance: 30, when: { units: ["hold"] } }),
  part("pen-lair", "captive", { label: "QA prisoners", count: { dice: "2d4", perUnit: "band" }, chance: 10, when: { state: "lair", units: ["band"] } }),
];
const clone = (x) => structuredClone(x);
const keysOf = (rows) => rows.map((r) => r.key);

/* -------------------------------------------- */
/*  The tables                                   */
/* -------------------------------------------- */

t("a size part of the state is a Units row; every other part is a Parts row, and one naming a state shows under that state alone", () => {
  const lair = editorRows({ recipe: IMPORT, readCopy: IMPORT, state: "lair" });
  assert.deepEqual(keysOf(lair.units), ["size-wilderness-lair"]);
  assert.deepEqual(keysOf(lair.parts), ["archers", "leader-chief", "guard-qux", "pen-lair"], "a part naming no state is listed, and a split share is a part");
  const wandering = editorRows({ recipe: IMPORT, readCopy: IMPORT, state: "wandering" });
  assert.deepEqual(keysOf(wandering.units), ["size-wilderness-wandering"]);
  assert.deepEqual(keysOf(wandering.parts), ["archers", "leader-chief", "guard-qux"], "a part of the other state is not");
  assert.deepEqual([...lair.words].sort(), ["band", "hold"]);
});

t("a Units row says what it is made of; a bodies row says nothing; a Judge's part is never a Units row", () => {
  const rows = editorRows({ recipe: [...IMPORT, shapePart({ key: "_x1", when: { state: "lair" } })], readCopy: IMPORT, state: "lair" });
  assert.deepEqual([rows.units[0].madeOf, rows.units[0].count.text, rows.units[0].place ?? rows.units[0].when.place], ["band", "1d10", "wilderness"]);
  assert.equal(editorRows({ recipe: IMPORT, readCopy: IMPORT, state: "wandering" }).units[0].madeOf, "");
  assert.ok(keysOf(rows.parts).includes("_x1") && !keysOf(rows.units).includes("_x1"));
});

t("a row carries its figures as the table shows them", () => {
  const rows = editorRows({ recipe: IMPORT, readCopy: IMPORT, state: "lair" });
  const byKey = Object.fromEntries([...rows.units, ...rows.parts].map((r) => [r.key, r]));
  assert.deepEqual(byKey.archers.count, { text: "40%", share: true, of: "unit", round: "up", perUnit: "" });
  assert.deepEqual([byKey["leader-chief"].count.text, byKey["leader-chief"].morale, byKey["leader-chief"].roleLabel], ["1", 2, "Leader"]);
  assert.deepEqual([byKey["guard-qux"].chance, byKey["guard-qux"].cite, byKey["guard-qux"].from, byKey["guard-qux"].hand], [30, "XX p. 1", "page", false]);
  assert.equal(byKey["pen-lair"].count.perUnit, "band");
  assert.equal(byKey["size-wilderness-lair"].chance, null, "no chance is null, never a figure");
});

t("a hand part reads from the hand; its tooltip is the import's own part of that key with its page, or the hand alone for a Judge's part", () => {
  const edited = savePart(IMPORT, IMPORT, "guard-qux", { count: { dice: "2d4" }, cite: "XX p. 9" });
  const judge = addPart(edited, { state: "lair", newId: () => "j1" }).recipe;
  const rows = editorRows({ recipe: judge, readCopy: IMPORT, state: "lair" });
  const byKey = Object.fromEntries(rows.parts.map((r) => [r.key, r]));
  assert.equal(byKey["guard-qux"].hand, true);
  assert.equal(byKey["guard-qux"].from, "hand");
  assert.equal(byKey["guard-qux"].tip.key, RECIPE_TEXT.tipHand);
  const { data } = byKey["guard-qux"].tip;
  assert.deepEqual([data.count, data.chance, data.units, data.cite], ["1d4", 30, "hold", "XX p. 1"], "what the import read and its page, not what the hand set");
  assert.deepEqual(Object.values(data).filter((v) => typeof v === "string" && /[a-z]{4,}/i.test(v) && v !== "hold" && v !== "QA qux" && v !== "qux"), [], "figures and words from the part only, no sentence");
  assert.deepEqual(byKey._j1.tip, { key: RECIPE_TEXT.tipHandOnly, data: { label: "_j1" } });
  assert.equal(byKey.archers.tip.key, RECIPE_TEXT.tipRead);
  assert.equal(byKey.archers.tip.data.cite, "XX p. 1");
});

t("the count is the blank-origin parts out of all of them", () => {
  assert.deepEqual(handCount(IMPORT), { hand: 0, all: 6 });
  const edited = savePart(IMPORT, IMPORT, "archers", { count: { percent: 50 } });
  assert.deepEqual(handCount(addPart(edited, { newId: () => "j2" }).recipe), { hand: 2, all: 7 });
  assert.deepEqual(handCount(undefined), { hand: 0, all: 0 });
});

t("every lang key the module returns is in the lang", () => {
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  for (const key of Object.values(RECIPE_TEXT)) assert.equal(typeof lang[key], "string", key);
});

/* -------------------------------------------- */
/*  A part's figures                             */
/* -------------------------------------------- */

t("a chance is blank or 0 to 100", () => {
  const bad = (chance) => validatePart({ chance }).map((p) => p.field);
  for (const ok of [null, undefined, "", " ", 0, 100, "50", 12.5]) assert.deepEqual(bad(ok), [], String(ok));
  for (const no of [101, -1, "abc", "101"]) assert.deepEqual(bad(no), ["chance"], String(no));
  assert.equal(validatePart({ chance: 200 })[0].key, RECIPE_TEXT.problemChance);
});

t("a count is blank, a die, a whole figure or a share, and only one of them", () => {
  const bad = (count) => validatePart({ count }).map((p) => p.field);
  for (const ok of [{}, { dice: "2d4+1" }, { dice: "2 D 4" }, { literal: 3 }, { literal: "3" }, { ratioOf: "unit", percent: 40 }, { ratioOf: "archers", percent: "50" }]) assert.deepEqual(bad(ok), [], JSON.stringify(ok));
  for (const no of [{ dice: "lots" }, { dice: "d" }, { literal: 1.5 }, { literal: -1 }, { dice: "1d4", literal: 2 }, { ratioOf: "unit" }, { percent: 40 }, { ratioOf: "unit", percent: "x" }]) assert.deepEqual(bad(no), ["count"], JSON.stringify(no));
});

t("a fixed hit-point figure is blank or a whole number from 1; a form's text is read as the figure", () => {
  const bad = (fixedHp) => validatePart({ fixedHp }).map((p) => p.field);
  for (const ok of [null, undefined, "", " ", 1, 7, "7", 120]) assert.deepEqual(bad(ok), [], String(ok));
  for (const no of [0, "0", -3, 2.5, "2.5", "abc"]) assert.deepEqual(bad(no), ["fixedHp"], String(no));
  assert.equal(validatePart({ fixedHp: 0 })[0].key, "ACKS-MONSTERS.recipe.problem.fixedHp");
  assert.equal(RECIPE_TEXT.problemFixedHp, "ACKS-MONSTERS.recipe.problem.fixedHp");
  assert.equal(shapePart({ fixedHp: "7" }).fixedHp, 7);
  for (const none of ["", " ", null, undefined]) assert.equal(shapePart({ fixedHp: none }).fixedHp, null, JSON.stringify(none));
  assert.equal(editorRows({ recipe: [part("steed", "mount", { fixedHp: 9 })], state: "lair" }).parts[0].fixedHp, 9, "a row carries the figure");
  assert.equal(editorRows({ recipe: IMPORT, state: "lair" }).parts[0].fixedHp, null, "and null where the part holds none");
});

t("a mount or beast link is an Actor uuid, a world actor's or a compendium's; another role is not checked", () => {
  const bad = (role, uuid) => validatePart({ role, source: { uuid } }).map((p) => p.field);
  assert.deepEqual(LINKED_ROLES, ["mount", "beast"]);
  for (const role of LINKED_ROLES) {
    assert.deepEqual(bad(role, ""), [], "no link is allowed");
    assert.deepEqual(bad(role, "Actor.qa1"), []);
    assert.deepEqual(bad(role, "Compendium.qa.pack.Actor.qa1"), []);
    assert.deepEqual(bad(role, "Item.qa1"), ["link"]);
    assert.deepEqual(bad(role, "qa1"), ["link"]);
  }
  assert.deepEqual(bad("guard", "Item.qa1"), []);
});

t("a count's text is a figure or a die, and blank clears every shape of a count", () => {
  assert.deepEqual(parseCount("3"), { ok: true, count: { dice: "", literal: 3, ratioOf: "", percent: null } });
  assert.deepEqual(parseCount(" 2 D 4 + 1 "), { ok: true, count: { dice: "2d4+1", literal: null, ratioOf: "", percent: null } });
  assert.deepEqual(parseCount(""), { ok: true, count: { dice: "", literal: null, ratioOf: "", percent: null } });
  assert.equal(parseCount("many").ok, false);
  const typedOver = savePart(IMPORT, IMPORT, "archers", { count: parseCount("2d4").count });
  assert.deepEqual([typedOver[2].count.dice, typedOver[2].count.ratioOf, typedOver[2].count.percent, typedOver[2].count.round], ["2d4", "", null, "up"], "a typed die replaces the share and keeps the rounding field untouched");
});

/* -------------------------------------------- */
/*  Save and the mark                            */
/* -------------------------------------------- */

t("a save that differs from the import blanks origin; the same figures put back restore it, whatever shape a form hands them in", () => {
  const edited = savePart(IMPORT, IMPORT, "guard-qux", { chance: "45", count: { dice: "2d4" } });
  const g = edited.find((p) => p.key === "guard-qux");
  assert.deepEqual([g.origin, g.chance, g.count.dice], ["", 45, "2d4"]);
  const back = savePart(edited, IMPORT, "guard-qux", { chance: "30", count: { dice: "1 D 4" } });
  assert.equal(back.find((p) => p.key === "guard-qux").origin, REGISTER_ORIGIN, "string figures and a spaced die equal the import's");
  assert.deepEqual(back, IMPORT, "the whole recipe is as the import wrote it");
});

t("a typed fixed hit-point figure blanks origin, and clearing it restores it; a figure that is not whole saves nothing", () => {
  const typed = savePart(IMPORT, IMPORT, "guard-qux", { fixedHp: "12" });
  const g = typed.find((p) => p.key === "guard-qux");
  assert.deepEqual([g.origin, g.fixedHp], ["", 12], "the figure is the only difference, and it is a hand's");
  assert.equal(handCount(typed).hand, 1);
  const cleared = savePart(typed, IMPORT, "guard-qux", { fixedHp: "" });
  assert.deepEqual([cleared.find((p) => p.key === "guard-qux").origin, cleared.find((p) => p.key === "guard-qux").fixedHp], [REGISTER_ORIGIN, null]);
  assert.deepEqual(cleared, IMPORT);
  assert.equal(savePart(IMPORT, IMPORT, "guard-qux", { fixedHp: "0" }), null);
  assert.equal(samePart(part("a", "guard"), { ...part("a", "guard"), fixedHp: 4 }), false);
  const stored = { ...part("a", "guard") };
  delete stored.fixedHp;
  assert.equal(samePart(stored, part("a", "guard")), true, "a part stored before the field existed reads as null");
});

t("a blank form value is null, so a blank chance put on a part the import read with none is no change", () => {
  const once = savePart(IMPORT, IMPORT, "leader-chief", { label: "QA chief!" });
  assert.equal(once.find((p) => p.key === "leader-chief").origin, "");
  const same = savePart(once, IMPORT, "leader-chief", { label: "QA chief", chance: "", moraleWhileAlive: "2" });
  assert.equal(same.find((p) => p.key === "leader-chief").origin, REGISTER_ORIGIN);
  assert.equal(same.find((p) => p.key === "leader-chief").chance, null);
  assert.equal(samePart({ chance: "" }, { chance: null }), true);
  assert.equal(samePart({ chance: 0 }, { chance: null }), false, "0 is a figure");
});

t("a save touches only its part, never the input, and ignores a key or an origin in the changes", () => {
  const before = clone(IMPORT);
  const out = savePart(IMPORT, IMPORT, "archers", { key: "other", origin: "x", label: "QA archers" });
  assert.deepEqual(IMPORT, before, "the input is not edited");
  assert.deepEqual(out.map((p) => p.key), before.map((p) => p.key));
  assert.deepEqual(out.filter((p) => p.key !== "archers"), before.filter((p) => p.key !== "archers"));
  assert.deepEqual([out[2].label, out[2].origin], ["QA archers", ""]);
});

t("a Judge's part and a part with no copy stay hand parts however they are saved; a missing key or a problem saves nothing", () => {
  const { recipe, key } = addPart(IMPORT, { state: "lair", newId: () => "j3" });
  const saved = savePart(recipe, IMPORT, key, { label: "QA extra", count: { dice: "1d4" } });
  assert.equal(saved.find((p) => p.key === key).origin, "");
  assert.equal(savePart(recipe, [], "guard-qux", { label: "x" }).find((p) => p.key === "guard-qux").origin, "", "no copy: nothing to equal");
  assert.equal(savePart(IMPORT, IMPORT, "nothing", { label: "x" }), null);
  assert.equal(savePart(IMPORT, IMPORT, "guard-qux", { chance: "250" }), null);
  assert.equal(savePart(IMPORT, IMPORT, "guard-qux", { count: { dice: "1d4", literal: 3 } }), null);
});

/* -------------------------------------------- */
/*  Reset, and a Judge's part                    */
/* -------------------------------------------- */

t("a part reset is the import's part in its place; with no copy of that key nothing is reset", () => {
  const edited = savePart(IMPORT, IMPORT, "guard-qux", { chance: 99 });
  const reset = resetPart(edited, IMPORT, "guard-qux");
  assert.deepEqual(reset, IMPORT);
  const { recipe, key } = addPart(edited, { newId: () => "j4" });
  assert.equal(resetPart(recipe, IMPORT, key), null, "a Judge's own part has nothing to go back to");
  const gone = resetPart(IMPORT.filter((p) => p.key !== "archers"), IMPORT, "archers");
  assert.deepEqual(gone.at(-1), IMPORT[2], "a part the recipe no longer holds comes back");
});

t("a reset of everything is the copy whole, a Judge's part gone; no copy is no reset", () => {
  const edited = addPart(savePart(IMPORT, IMPORT, "archers", { label: "QA" }), { newId: () => "j5" }).recipe;
  assert.deepEqual(resetAll(IMPORT), IMPORT);
  assert.equal(edited.length, IMPORT.length + 1);
  assert.equal(resetAll([]), null);
  assert.equal(resetAll(undefined), null);
  const copy = resetAll(IMPORT);
  copy[0].label = "changed";
  assert.equal(IMPORT[0].label, "hold", "the copy is returned as a clone");
});

t("a Judge's part is keyed _<id>, has a blank origin and nothing printed; one started from a sentence takes only its unit words and the page given", () => {
  const plain = addPart(IMPORT, { state: "lair", newId: () => "abc" });
  assert.equal(plain.key, "_abc");
  const p = plain.recipe.at(-1);
  assert.deepEqual([p.origin, p.label, p.role, p.chance, p.count.dice, p.when.state, p.when.units, p.cite], ["", "", "", null, "", "lair", [], ""]);
  const from = addPart(IMPORT, { state: "wandering", sentence: { text: "Each QA gang in a warband holds a QA thing.", cite: "XX p. 3" }, newId: () => "def" });
  const q = from.recipe.at(-1);
  assert.deepEqual([q.label, q.when.units, q.cite, q.origin], ["", ["gang", "warband"], "XX p. 3", ""]);
  let n = 0;
  const twice = addPart(plain.recipe, { newId: () => ["abc", "abc", "xyz"][n++] });
  assert.equal(twice.key, "_xyz", "a key the recipe holds is not reused");
  assert.match(addPart([]).key, /^_[A-Za-z0-9]{16}$/, "with no maker, a random id");
  assert.equal(IMPORT.length, 6, "the input is not edited");
});

/* -------------------------------------------- */
/*  The reading pane                             */
/* -------------------------------------------- */

// Invented sentences: they copy the printed grammar of each locator (which word sits where), never a page's words or numbers.
const SPLIT = "35% of gangs or warbands encountered will be archers (round down), 65% will be warriors (round up).";
const GANG = "Each zorb gang will be led by two champions with 9 AC and 14 HD.";
const WARBAND = "Each zorb warband will be led by a sub-chieftain with 11 AC and 17 HD.";
const LAIR = "A zorb lair or village will be led by a chieftain with 13 AC and 21 HD.";
const MORALE = "As long as the chieftain is alive, the zorbs will gain a +4 bonus to morale rolls.";
const ENCOUNTERED = "When zorbs are encountered in a village.";
const ESCORT = "The chieftain will be defended by 3d8 guards (equivalent to champions statistically).";
const GUARD = "There is a 41% chance a zorb village will be guarded by 2d12 mossy blimps and another 17% chance for 1d5+2 tall zorbles.";
const CAPTIVES = "There is an 88% chance for 2d8 bound captives per gang.";
const CASTERS = "A village has a 29% chance of a shaman being present, and a 12% chance of a witch doctor.";
const COMBAT = [SPLIT, "A QA flag & <b> sentence no locator reads."];
const ECOLOGY = [`${GANG} ${WARBAND} ${LAIR} ${MORALE}`, `${ENCOUNTERED} ${ESCORT} ${GUARD} ${CAPTIVES} ${CASTERS}`];
const ENCOUNTER = { dungeon: { wandering: { noun: "pod", number: "2d7", unit: "" }, lair: { noun: "nest", number: "2d3", unit: "cells" } } };
const stored = (paras, id = "qa-1") => bookText(paras, "XX p. 2", { id }) + "<p>A Judge's own note, outside the block.</p>";

t("the stored paragraphs are those of the stamped block, the page line left out and entities undone", () => {
  assert.deepEqual(storedParagraphs(stored(COMBAT)), COMBAT);
  assert.deepEqual(storedParagraphs(stored(ECOLOGY)), ECOLOGY);
  assert.deepEqual(storedParagraphs(""), []);
  assert.deepEqual(storedParagraphs("<p>no block</p>"), []);
});

t("the reader re-run over the stored prose gives the parts the import wrote, with the sentence report", () => {
  const wrote = readEcologyRecipe({ combat: COMBAT, ecology: ECOLOGY, encounter: ENCOUNTER, variant: "qa", cite: "XX p. 2" });
  const again = readStored({ combat: stored(COMBAT), ecology: stored(ECOLOGY), encounter: ENCOUNTER, variant: "qa", cite: "XX p. 2" });
  assert.ok(wrote.length >= 12, "every part kind");
  assert.deepEqual(again.parts, wrote);
  assert.deepEqual(again.sentences["leader-chieftain"].map((r) => [r.paragraph, r.sentence]), [[0, 2], [0, 3]]);
});

t("every part the reader writes passes the checks, so a label edit is never refused for a figure the import wrote", () => {
  const wrote = readEcologyRecipe({ combat: COMBAT, ecology: ECOLOGY, encounter: ENCOUNTER, variant: "zorb", cite: "XX p. 2" });
  assert.ok(wrote.some((p) => p.key.startsWith("size-")) && wrote.some((p) => p.count.ratioOf) && wrote.some((p) => p.chance !== null));
  for (const p of wrote) {
    assert.deepEqual(validatePart(p), [], p.key);
    assert.ok(savePart(wrote, wrote, p.key, { label: "QA relabel" }), p.key);
    assert.deepEqual(validatePart(shapePart(p)), [], `${p.key} as shaped`);
  }
});

t("each sentence is marked with the part keys that read it, or none, and only parts of the recipe are named", () => {
  const read = readStored({ combat: stored(COMBAT), ecology: stored(ECOLOGY), encounter: ENCOUNTER, variant: "qa", cite: "XX p. 2" });
  const marks = sentenceMarks(read.paragraphs, read.parts, read.sentences);
  assert.deepEqual(marks.map((m) => [m.field, m.paragraph, m.sentence]), [
    ["combat", 0, 0], ["combat", 1, 0], ["ecology", 0, 0], ["ecology", 0, 1], ["ecology", 0, 2], ["ecology", 0, 3],
    ["ecology", 1, 0], ["ecology", 1, 1], ["ecology", 1, 2], ["ecology", 1, 3], ["ecology", 1, 4],
  ]);
  assert.deepEqual(marks.map((m) => m.keys), [
    ["archers", "warriors"], [], ["leader-champion"], ["leader-subChieftain"], ["leader-chieftain"], ["leader-chieftain"],
    [], ["chieftain-guard"], ["guard-mossy-blimps", "guard-tall-zorbles"], ["captives"], ["caster-shaman", "caster-witchDoctor"],
  ]);
  assert.equal(marks[1].text, COMBAT[1], "the sentence is the caller's own paragraph text, entities undone");
  const without = sentenceMarks(read.paragraphs, read.parts.filter((p) => p.key !== "leader-chieftain" && p.key !== "caster-shaman"), read.sentences);
  assert.deepEqual([without[4].keys, without[5].keys, without[10].keys], [[], [], ["caster-witchDoctor"]], "a part no longer in the recipe marks nothing");
  assert.deepEqual(sentenceMarks({}, [], {}), []);
});

/* -------------------------------------------- */
/*  Mount and beast links                        */
/* -------------------------------------------- */

const LIB = [
  { name: "QA Quux", uuid: "Actor.q1" },
  { name: "QA Zorp, Blue", uuid: "Actor.z1" },
  { name: "QA Zorp, Red", uuid: "Actor.z2" },
  { name: "QA Mog", uuid: "Actor.m1" },
  { name: "QA Mog, Giant", uuid: "Actor.m2" },
];

t("a stored link is the link, named from the library or the printed word; the word is looked up only where none is stored", () => {
  const a = mountBeastLink({ role: "mount", source: { uuid: "Actor.q1", name: "printed" } }, LIB);
  assert.deepEqual(a, { linked: { uuid: "Actor.q1", name: "QA Quux", stored: true }, candidates: [], status: "resolved" });
  assert.deepEqual(mountBeastLink({ role: "beast", source: { uuid: "Actor.gone", name: "printed" } }, LIB).linked, { uuid: "Actor.gone", name: "printed", stored: true });
});

t("a word one entry answers is a link the window must still write; two of one fold or a wider name are candidates, never picked", () => {
  const one = mountBeastLink({ role: "beast", label: "x", source: { name: "qa quuxes" } }, LIB);
  assert.deepEqual(one.linked, { uuid: "Actor.q1", name: "QA Quux", stored: false });
  assert.deepEqual(linkChanges(one.linked), { source: { uuid: "Actor.q1", name: "QA Quux", templateCell: "", stat: "" } });
  const twins = mountBeastLink({ role: "beast", source: { name: "QA Zorp" } }, [...LIB, { name: "QA Zorp", uuid: "Actor.z3" }, { name: "zorp qa", uuid: "Actor.z4" }]);
  assert.equal(twins.linked, null);
  assert.deepEqual(twins.candidates.map((c) => c.uuid).sort(), ["Actor.z3", "Actor.z4"]);
  assert.equal(twins.status, "ambiguous");
  const wider = mountBeastLink({ role: "mount", source: { name: "QA Mog" } }, LIB.filter((e) => e.uuid !== "Actor.m1"));
  assert.deepEqual([wider.linked, wider.status, wider.candidates.map((c) => c.uuid)], [null, "partial", ["Actor.m2"]]);
});

t("a part with no printed word looks up its label, and nothing answering is no link", () => {
  assert.equal(mountBeastLink({ role: "mount", label: "QA Mog", source: {} }, LIB).linked.uuid, "Actor.m1");
  const none = mountBeastLink({ role: "mount", label: "QA nothing", source: {} }, LIB);
  assert.deepEqual([none.linked, none.candidates, none.status], [null, [], "none"]);
  assert.equal(mountBeastLink({ role: "mount", label: "", source: {} }, LIB).linked, null);
});

/* -------------------------------------------- */
/*  Which document each door writes              */
/* -------------------------------------------- */

const OTHER = [part("archers", "body", { count: { dice: "9d9" } })];
const actor = () => ({ flags: { "acks-extras": { extras: { encounter: { recipe: clone(IMPORT) } }, cookbook: { read: { recipe: clone(IMPORT) } } } } });
const template = () => ({
  system: {
    axes: [
      { key: "role", options: [{ key: "file", flags: {} }] },
      { key: "variant", options: [
        { key: "alba", flags: { "acks-extras": { extras: { encounter: { recipe: clone(IMPORT) } }, cookbook: { read: { recipe: clone(IMPORT) } } } } },
        { key: "nigra", flags: { "acks-extras": { extras: { encounter: { recipe: clone(OTHER) } }, cookbook: { read: { recipe: clone(OTHER) } } } } },
      ] },
    ],
  },
});

t("the monster's Ecology tab writes the actor's own recipe, read against the actor's own copy", () => {
  const target = recipeTarget(actor());
  assert.deepEqual(target, { kind: "actor", path: "flags.acks-extras.extras.encounter.recipe", readCopyPath: "flags.acks-extras.cookbook.read.recipe" });
  assert.deepEqual(recipeAt(actor(), target), IMPORT);
  assert.deepEqual(readCopyAt(actor(), target), IMPORT);
  assert.deepEqual(recipeUpdate(actor(), target, OTHER), { "flags.acks-extras.extras.encounter.recipe": OTHER });
  assert.deepEqual(recipeAt({}, target), []);
});

t("a template's variant row and the chart's Roll write the option's recipe, the one a roll reads, through the axes whole", () => {
  const doc = template();
  const target = recipeTarget(doc, { optionKey: "nigra" });
  assert.deepEqual([target.kind, target.root, target.optionKey], ["option", "system.axes", "nigra"]);
  assert.equal(target.path, "system.axes[variant].options[nigra].flags.acks-extras.extras.encounter.recipe");
  assert.deepEqual(recipeAt(doc, target), OTHER, "the option's own recipe, not the sibling's");
  assert.deepEqual(readCopyAt(doc, target), OTHER);
  const edited = savePart(recipeAt(doc, target), readCopyAt(doc, target), "archers", { count: { dice: "3d3" } });
  const update = recipeUpdate(doc, target, edited);
  assert.deepEqual(Object.keys(update), ["system.axes"]);
  const axes = update["system.axes"];
  assert.equal(axes[1].options[1].flags["acks-extras"].extras.encounter.recipe[0].count.dice, "3d3");
  assert.deepEqual(axes[1].options[0], doc.system.axes[1].options[0], "the sibling option is as it was");
  assert.deepEqual(axes[0], doc.system.axes[0]);
  assert.deepEqual(axes[1].options[1].flags["acks-extras"].cookbook, doc.system.axes[1].options[1].flags["acks-extras"].cookbook, "the copy is not rewritten");
  assert.equal(doc.system.axes[1].options[1].flags["acks-extras"].extras.encounter.recipe[0].count.dice, "9d9", "the document is not edited");
});

t("an option the template lacks has no target, and an option with nothing stored writes where none was", () => {
  assert.equal(recipeTarget(template(), { optionKey: "rubra" }), null);
  assert.equal(recipeTarget(template(), { optionKey: "alba", axisKey: "role" }), null);
  const doc = template();
  const bare = recipeTarget(doc, { optionKey: "file", axisKey: "role" });
  assert.deepEqual(recipeAt(doc, bare), []);
  assert.deepEqual(recipeUpdate(doc, bare, OTHER)["system.axes"][0].options[0].flags["acks-extras"].extras.encounter.recipe, OTHER);
  const withToObject = { system: { toObject: () => ({ axes: template().system.axes }) } };
  assert.deepEqual(recipeAt(withToObject, recipeTarget(withToObject, { optionKey: "alba" })), IMPORT, "a system data model is read through toObject");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-recipe-editor-logic: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
