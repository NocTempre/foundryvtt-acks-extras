/**
 * Pure-logic tests for the official-sheet import and export: reading what a
 * hand-filled box says, the plan an import makes of a whole form, the form
 * read and written through a stand-in pdf.js document keyed by invented field
 * names, the notes block a re-import replaces, and the domain page read into a
 * domain record, checked against it and written back from it. No Foundry: the
 * writes onto a character and a domain are walked live
 * (docs/character-sheet/TESTING.md). Every name and figure here is invented
 * fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert";
import { hash36 } from "../scripts/importer/printed-name.mjs";
import { abilityEntry, countAndName, diceText, lastNumber, numbers, splitOutside, throwValue, wholeNumber } from "../scripts/character-sheet/pdf/parse.mjs";
import { buildPlan } from "../scripts/character-sheet/pdf/plan.mjs";
import { FINGERPRINT_SHARE, KIND, filledValues, fillForm, formWidgets, readForm } from "../scripts/character-sheet/pdf/form.mjs";
import { FORM_FIELDS } from "../scripts/character-sheet/pdf/form-keys.mjs";
import { SHEET_BOOK, blankSheet } from "../scripts/character-sheet/pdf/blank.mjs";
import { BOOKS, bookIsForm, identifyBook } from "../scripts/importer/books.mjs";
import { domainChecks, domainPagePlan, domainPageValues, domainUpdate, sheetLine } from "../scripts/character-sheet/pdf/domain-page.mjs";
import { ledgerOf, peasantFamiliesOf, urbanFamiliesOf } from "../scripts/domains/domain-logic.mjs";

globalThis.game = { i18n: { format: (key, data = {}) => `${key}${Object.keys(data).length ? JSON.stringify(data) : ""}` } };
const { notesBlock, replaceNotesBlock } = await import("../scripts/character-sheet/pdf/notes.mjs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const section = (title) => tests.push([null, title]);

section("official sheet: reading a box");
test("a running tally reads as its last figure, commas read through", () => {
  assert.deepEqual(numbers("12, 9, -3"), [12, 9, -3]);
  assert.equal(lastNumber("40 - 7 = 33"), 33);
  assert.equal(lastNumber("1,250"), 1250);
  assert.equal(lastNumber("none"), null);
});
test("a single-number box reads its sign, a throw's plus and a percentage", () => {
  assert.equal(wholeNumber("+2"), 2);
  assert.equal(wholeNumber("−1"), -1);
  assert.equal(throwValue("14+"), 14);
  assert.equal(wholeNumber("5%"), 5);
  assert.equal(wholeNumber("about 4"), null, "a sentence is never its first figure");
});
test("a dice box normalizes its formula, and says null for no dice", () => {
  assert.equal(diceText("d8"), "1d8");
  assert.equal(diceText("2 d 4 - 1"), "2d4-1");
  assert.equal(diceText("a stick"), null);
});
test("a list splits on commas, semicolons and lines, never inside brackets", () => {
  assert.deepEqual(splitOutside("Lockwork (Iron, Brass), Herb Lore; Knots\nRiddles"), ["Lockwork (Iron, Brass)", "Herb Lore", "Knots", "Riddles"]);
});
test("a gear line reads its count wherever it is written", () => {
  assert.deepEqual(countAndName("3 lanterns"), { qty: 3, name: "lanterns" });
  assert.deepEqual(countAndName("lanterns x3"), { qty: 3, name: "lanterns" });
  assert.deepEqual(countAndName("lanterns (3)"), { qty: 3, name: "lanterns" });
  assert.deepEqual(countAndName("- twine"), { qty: 1, name: "twine" });
  assert.equal(countAndName("  "), null);
});
test("a proficiency reads its pick and its rank, and drops a throw in brackets", () => {
  assert.deepEqual(abilityEntry("Lockwork (Iron)"), { name: "Lockwork", selection: "Iron", rank: 1 });
  assert.deepEqual(abilityEntry("Herb Lore x2"), { name: "Herb Lore", selection: null, rank: 2 });
  assert.deepEqual(abilityEntry("Herb Lore (2)"), { name: "Herb Lore", selection: null, rank: 2 });
  assert.deepEqual(abilityEntry("Riddles (13+)"), { name: "Riddles", selection: null, rank: 1 });
});

section("official sheet: the plan");
const filled = {
  name: "Wren Ashdown",
  class: "Lamplighter",
  level: "3",
  xp: "2,100",
  "score.str": "13",
  "score.dex": "9",
  "save.blast": "12+",
  "saveMod.paralysis": "+1",
  "saveMod.death": "+1",
  "saveMod.blast": "+1",
  "saveMod.implements": "+1",
  "saveMod.spells": "+1",
  "attack.0": "9+",
  "classProf.0.name": "Lockwork (Iron)",
  "classProf.0.throw": "14+",
  "classProf.1.name": "Lockwork (Iron)",
  "generalProf.0.name": "Herb Lore",
  features: "Kindle, Ward the Wick",
  languages: "Common; Marsh-cant",
  "coin.gp": "120",
  "coin.sp": "40 - 10 = 30",
  "gear.back.list": "Backpack",
  "gear.backpack.list": "3 lanterns\ntwine; chalk",
  "gear.belt.list": "Dagger, Pouch",
  "weapon.0.name": "Hooked Pole",
  "weapon.0.damage": "1d6",
  "weapon.0.short": "10",
  "spells.perDay.1": "2",
  "spell.1.0": "Glimmer",
  "ritual.0": "Long Night",
  "tick.torch.0.0": true,
  "tick.torch.0.1": true,
  "domain.ruler": "Wren",
  "hench.0.name": "Pip",
  "hench.0.hp": "5/8",
  "hench.0.equipment": "2 stakes, rope",
};
const plan = buildPlan(filled);
test("the identity and the numbers read as numbers", () => {
  assert.equal(plan.name, "Wren Ashdown");
  assert.equal(plan.className, "Lamplighter");
  assert.equal(plan.level, 3);
  assert.equal(plan.xp, 2100);
  assert.equal(plan.scores.str, 13);
  assert.equal(plan.scores.wis, null);
  assert.equal(plan.saves.blast, 12);
  assert.equal(plan.attack[0], 9);
});
test("a proficiency written twice is one entry at rank two, carrying its throw", () => {
  const lockwork = plan.abilities.filter((a) => a.name === "Lockwork");
  assert.equal(lockwork.length, 1);
  assert.equal(lockwork[0].rank, 2);
  assert.equal(lockwork[0].selection, "Iron");
  assert.equal(lockwork[0].kind, "class");
  assert.equal(lockwork[0].throw, 14);
  assert.equal(plan.abilities.find((a) => a.name === "Herb Lore").kind, "general");
  assert.deepEqual(plan.abilities.filter((a) => a.kind === "feature").map((a) => a.name), ["Kindle", "Ward the Wick"]);
});
test("languages, coin and gear read by place, a tally box keeping its text", () => {
  assert.deepEqual(plan.languages, ["Common", "Marsh-cant"]);
  assert.deepEqual(plan.coins.gp, { count: 120, text: "120" });
  assert.equal(plan.coins.sp.count, 30);
  assert.equal(plan.coins.sp.text, "40 - 10 = 30");
  assert.deepEqual(
    plan.gear.map((g) => `${g.place}:${g.qty}:${g.name}`),
    ["back:1:Backpack", "belt:1:Dagger", "belt:1:Pouch", "backpack:3:lanterns", "backpack:1:twine", "backpack:1:chalk"],
  );
});
test("weapons, spells, ticks, the domain and a henchman read whole", () => {
  assert.deepEqual(plan.weapons[0].range, { short: 10, medium: null, long: null });
  assert.equal(plan.weapons[0].damage, "1d6");
  assert.equal(plan.spells.perDay[1], 2);
  assert.deepEqual(plan.spells.known, [{ level: 1, name: "Glimmer" }]);
  assert.deepEqual(plan.spells.rituals, ["Long Night"]);
  assert.deepEqual(plan.ticks.torch.slice(0, 2), [2, 0]);
  assert.deepEqual(plan.domain, { "domain.ruler": "Wren" });
  assert.equal(plan.henchmen.length, 1);
  assert.equal(plan.henchmen[0].hpText, "5/8");
  assert.deepEqual(plan.henchmen[0].equipment, [{ qty: 2, name: "stakes" }, { qty: 1, name: "rope" }]);
});
test("an empty form plans nothing to write", () => {
  const empty = buildPlan({});
  assert.equal(empty.name, "");
  assert.equal(empty.abilities.length, 0);
  assert.equal(empty.gear.length, 0);
  assert.equal(empty.henchmen.length, 0);
  assert.equal(Object.keys(empty.domain).length, 0);
});

section("official sheet: the form");
// A stand-in form whose field names are invented: the suite never needs the
// real names, only the hashing that maps them.
const FIELDS = {
  [hash36("Box One")]: ["name", KIND.text],
  [hash36("Box Two")]: ["features", KIND.multiLine],
  [hash36("Pick.0")]: ["tick.torch.0.0", KIND.checkbox],
  [hash36("Choice.1")]: ["domain.region.0", KIND.radio],
};
const stored = new Map();
const fakeDoc = (annotations) => ({
  numPages: 1,
  getPage: async () => ({ getAnnotations: async () => annotations }),
  annotationStorage: { setValue: (id, v) => stored.set(id, v.value) },
  saveDocument: async () => new Uint8Array([1, 2, 3]),
});
const widgets = [
  { id: "a1", subtype: "Widget", fieldName: "Box One", fieldValue: "Wren" },
  { id: "a2", subtype: "Widget", fieldName: "Box Two", fieldValue: "Kindle\r\nWard" },
  { id: "a3", subtype: "Widget", fieldName: "Pick.0", fieldValue: "Yes", exportValue: "Yes" },
  { id: "a4", subtype: "Widget", fieldName: "Choice.1", fieldValue: "Off", buttonValue: "1" },
  { id: "a5", subtype: "Widget", fieldName: "Somebody Else", fieldValue: "x" },
  { id: "a6", subtype: "Link" },
];
test("widgets map through the hashed names; ticks read on and off; foreign fields are counted", async () => {
  const { widgets: w, unknown } = await formWidgets(fakeDoc(widgets), { fields: FIELDS });
  assert.equal(unknown, 1);
  assert.deepEqual(
    w.map((x) => [x.key, x.value]),
    [["name", "Wren"], ["features", "Kindle\nWard"], ["tick.torch.0.0", true], ["domain.region.0", false]],
  );
});
test("a file is the form only when it carries the form's share of the fields", async () => {
  const read = await readForm(fakeDoc(widgets), { fields: FIELDS });
  assert.equal(read.isForm, true);
  assert.equal(read.share, 1);
  const thin = await readForm(fakeDoc(widgets.slice(0, 1)), { fields: FIELDS });
  assert.ok(thin.share < FINGERPRINT_SHARE);
  assert.equal(thin.isForm, false);
  const none = await readForm(fakeDoc([]), { fields: FIELDS });
  assert.equal(none.isForm, false);
});
test("the shipped table's names are never in it: every entry is a hash", () => {
  for (const [hash, entry] of Object.entries(FORM_FIELDS)) {
    assert.match(hash, /^[0-9a-z]+$/);
    assert.equal(entry.length, 2);
  }
  assert.ok(Object.keys(FORM_FIELDS).length > 0);
});
test("only what was filled is recorded", () => {
  assert.deepEqual(filledValues({ a: "x", b: " ", c: true, d: false, e: "" }), { a: "x", c: true });
});
test("no key is the start of another, so a record stored expanded flattens back to the same keys", () => {
  const keys = Object.values(FORM_FIELDS).map(([key]) => key);
  assert.equal(new Set(keys).size, keys.length);
  const clashes = keys.filter((k) => keys.some((other) => other.startsWith(`${k}.`)));
  assert.deepEqual(clashes, []);
});
test("a fill writes every field, clearing the ones the values leave out", async () => {
  stored.clear();
  const bytes = await fillForm(fakeDoc(widgets), { name: "Pip", "tick.torch.0.0": false, "domain.region.0": true }, { fields: FIELDS });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(Object.fromEntries(stored), { a1: "Pip", a2: "", a3: false, a4: true });
});

section("official sheet: the notes block");
test("the block lists what has no field and lays the domain out as tables", () => {
  const block = notesBlock({
    rows: [{ label: "Birthplace", text: "Under <the> hill" }],
    domain: { "domain.ruler": "Wren", "domain.region.2": true, "domain.hex.0.number": "0412", "domain.hex.0.revenue": "9", "domain.structure.total.4": "300" },
  });
  assert.match(block, /^<h3>/);
  assert.match(block, /Under &lt;the&gt; hill/);
  assert.match(block, /pdf\.domain\.ruler/);
  assert.match(block, /ACKS-DOMAINS\.classification\.civilized/, "a region box is named for the classification it ticks");
  assert.match(block, /<td>0412<\/td>/);
  assert.match(block, /pdf\.domain\.total/);
  assert.equal(notesBlock({}), "");
});
test("a re-import replaces its own block, and appends when the reader edited it", () => {
  assert.equal(replaceNotesBlock("<p>mine</p><h3>old</h3>", "<h3>old</h3>", "<h3>new</h3>"), "<p>mine</p><h3>new</h3>");
  assert.equal(replaceNotesBlock("<p>mine</p><h3>old, edited</h3>", "<h3>old</h3>", "<h3>new</h3>"), "<p>mine</p><h3>old, edited</h3><h3>new</h3>");
  assert.equal(replaceNotesBlock("", "", "<h3>new</h3>"), "<h3>new</h3>");
  assert.equal(replaceNotesBlock("<p>mine</p><h3>old</h3>", "<h3>old</h3>", ""), "<p>mine</p>");
  assert.equal(replaceNotesBlock("a$&b", "", "<h3>$&</h3>"), "a$&b<h3>$&</h3>", "replacement text is literal");
});

section("official sheet: the domain page");
// An invented page: a borderland holding of two hexes and one town, one line
// whose families match nothing, and one vassal.
const PAGE = {
  "domain.name": "Hollowmere",
  "domain.ruler": "Wren",
  "domain.region.1": true,
  "domain.structure.0.0": "Watchtower ×2",
  "domain.structure.0.1": "7",
  "domain.structure.0.2": "40",
  "domain.structure.0.3": "20",
  "domain.structure.0.4": "1,500",
  "domain.structure.1.0": "Palisade",
  "domain.structure.1.4": "300",
  "domain.peasantFamilies": "120",
  "domain.urbanFamilies": "30",
  "domain.hexCount": "2",
  "domain.hex.0.number": "0412",
  "domain.hex.0.land": "5",
  "domain.hex.0.families": "70",
  "domain.hex.0.revenue": "11",
  "domain.hex.1.number": "0413",
  "domain.hex.1.land": "4",
  "domain.hex.1.families": "50",
  "domain.income.0.land": "2",
  "domain.income.0.families": "120",
  "domain.income.0.total": "240",
  "domain.income.1.land": "1",
  "domain.income.1.families": "150",
  "domain.income.1.total": "150",
  "domain.income.2.families": "30",
  "domain.income.2.total": "45",
  "domain.income.3.land": "3",
  "domain.income.3.families": "99",
  "domain.income.4.label": "Ferry tolls",
  "domain.income.4.total": "12",
  "domain.expense.0.perFamily": "1",
  "domain.expense.0.families": "150",
  "domain.expense.0.total": "140",
  "domain.tribute.outTotal": "20",
  "domain.totalIncome": "500",
  "domain.morale": "+1",
  "domain.baseMorale": "−1",
  "domain.favors": "Hunting rights, Bridge toll",
  "domain.duties": "Muster",
  "domain.vassal.0.name": "Pell",
  "domain.vassal.0.domain": "Lowfold",
  "domain.vassal.0.duties": "Escort",
  "domain.vassal.0.tax": "15",
  "domain.location": "North of the river",
  "domain.investments": "Mill",
};
const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};
const firstWrite = () => domainUpdate(domainPagePlan(PAGE), {}, { rulerUuid: "Actor.c1", rulerName: "Wren Ashby", makeId: counter() });
/** The sums the import hands the checks, from an unplaced record alone. */
const sumsOf = (record) => {
  const urban = urbanFamiliesOf(record.holdings);
  const families = { peasant: peasantFamiliesOf(record.territory), urban: urban.total, urbanUnknown: urban.unknown };
  return { families, ledger: ledgerOf(record, { families: { peasant: families.peasant, urban: urban.unknown ? null : urban.total } }) };
};

test("the page reads figures as numbers, a count off a structure's name, and the region it ticks", () => {
  const page = domainPagePlan(PAGE);
  assert.deepEqual(page.regions, ["borderlands"]);
  assert.deepEqual(
    { name: page.structures[0].name, count: page.structures[0].count, capacity: page.structures[0].capacity, cost: page.structures[0].cost },
    { name: "Watchtower", count: 2, capacity: 20, cost: 1500 },
  );
  assert.equal(page.structures[1].count, null, "a name written without a count leaves the record's");
  assert.deepEqual(page.morale, { current: 1, base: -1 });
  assert.deepEqual(page.revenue.map((l) => l.key), ["land", "service", "tax", "trade"]);
  assert.equal(page.otherRevenue.label, "Ferry tolls");
  assert.deepEqual(page.favors, ["Hunting rights", "Bridge toll"]);
  assert.equal(domainPagePlan({}).structures.length, 0);
});
test("a line is written to the side its families match, and one matching none is not written", () => {
  const { system, unplaced } = firstWrite();
  assert.equal(system.revenue.land.peasantPer, 2, "the peasant count is the peasants' rate");
  assert.equal(system.revenue.land.urbanPer, null);
  assert.deepEqual([system.revenue.service.peasantPer, system.revenue.service.urbanPer], [1, 1], "both counts together is a rate on both");
  assert.deepEqual([system.revenue.tax.urbanGp, system.revenue.tax.urbanPer], [45, null], "a total alone on one side is that side's flat figure");
  assert.deepEqual(system.revenue.trade, { peasantPer: null, urbanPer: null, peasantGp: null, urbanGp: null, note: "" });
  assert.deepEqual(unplaced, ["income.3"]);
  assert.deepEqual([system.expenses.garrison.peasantPer, system.expenses.garrison.urbanPer], [1, 1]);
});
test("the record takes the page's rows, its ruler and the boxes it keeps a field for", () => {
  const { system, notes } = firstWrite();
  assert.equal(system.classification, "borderlands");
  assert.deepEqual([system.rulerUuid, system.rulerName], ["Actor.c1", "Wren"]);
  assert.deepEqual(system.structures.map((s) => [s.name, s.count, s.unitCapacity, s.costGp]), [["Watchtower", 2, 10, 1500], ["Palisade", 1, null, 300]]);
  assert.deepEqual(system.territory.map((r) => [r.hexLabels, r.landValue, r.families, r.revealed]), [[["0412"], 5, 70, true], [["0413"], 4, 50, true]]);
  assert.deepEqual(system.holdings.map((h) => [h.role, h.families, h.uuid]), [["settlement", 30, ""]]);
  assert.deepEqual(system.otherRevenue.map((r) => [r.label, r.gp]), [["Ferry tolls", 12]]);
  assert.deepEqual([system.tributeGp, system.morale.current, system.morale.base], [20, 1, -1]);
  assert.deepEqual([system.favors.length, system.duties.length], [2, 1]);
  assert.deepEqual(system.vassalRows.map((v) => [v.name, v.rulerName, v.tributeGp, v.duties]), [["Lowfold", "Pell", 15, "Escort"]]);
  const labels = notes.map((r) => r.label);
  for (const key of ["location", "investments", "hexRevenue", "table.income"]) assert.ok(labels.includes(key), `notes carry ${key}`);
  assert.equal(notes.find((r) => r.label === "hexRevenue").text, "0412: 11");
});
test("a second import of the same page adds nothing and changes nothing", () => {
  const first = firstWrite().system;
  const again = domainUpdate(domainPagePlan(PAGE), first, { rulerUuid: "Actor.c1", makeId: counter() }).system;
  assert.deepEqual(again, first);
});
test("a vassal the page names for a vassal domain is that domain's, never a row", () => {
  const { system } = domainUpdate(domainPagePlan(PAGE), {}, { vassalNames: ["lowfold"], makeId: counter() });
  assert.equal(system.vassalRows.length, 0);
});
test("a page listing no hex gives the land as one tract, only where the territory is empty or that tract", () => {
  const land = { "domain.hexCount": "6", "domain.peasantFamilies": "200" };
  const once = domainUpdate(domainPagePlan(land), {}, { makeId: counter() }).system;
  assert.deepEqual(once.territory.map((r) => [r.label, r.hexLabels, r.count, r.families]), [["", [], 6, 200]]);
  const twice = domainUpdate(domainPagePlan({ ...land, "domain.hexCount": "7" }), once, { makeId: counter() }).system;
  assert.deepEqual(twice.territory.map((r) => [r.count, r.families]), [[7, 200]], "the tract is updated, never doubled");
  const mapped = { territory: [{ label: "", hexLabels: ["0101"], count: 1, families: 10 }, { label: "", hexLabels: ["0102"], count: 1, families: 10 }] };
  const kept = domainUpdate(domainPagePlan(land), mapped, { makeId: counter() }).system.territory;
  assert.deepEqual(kept.map((r) => [r.hexLabels, r.count, r.families]), [[["0101"], 1, 10], [["0102"], 1, 10]], "hexes the record names are left alone");
});
test("several regions ticked are checked and classify nothing", () => {
  const page = domainPagePlan({ "domain.region.0": true, "domain.region.2": true });
  const { system } = domainUpdate(page, { classification: "borderlands" }, { makeId: counter() });
  assert.equal(system.classification, "borderlands");
  const [check] = domainChecks(page, { record: system, ...sumsOf(system) });
  assert.deepEqual(check, { label: "region", sheet: "classification.outlands, classification.civilized", inForce: "classification.borderlands" });
});
test("urban families land on the one loose settlement, and never beside a placed one", () => {
  const placed = { holdings: [{ uuid: "Actor.town", name: "", role: "settlement" }] };
  const out = domainUpdate(domainPagePlan({ "domain.urbanFamilies": "30" }), placed, { makeId: counter() }).system;
  assert.deepEqual(out.holdings.map((h) => h.uuid), ["Actor.town"]);
});
test("the checks name what the written domain works out otherwise, and why a line was not written", () => {
  const { system, unplaced } = firstWrite();
  const checks = domainChecks(domainPagePlan(PAGE), { record: system, ...sumsOf(system), unplaced });
  const by = Object.fromEntries(checks.map((c) => [c.label, c]));
  assert.deepEqual([by["line.garrison"]?.sheet, by["line.garrison"]?.inForce], ["140", "150"]);
  assert.equal(by["line.trade"]?.inForce, "check.noSide");
  assert.equal(by["tribute.outTotal"]?.inForce, "check.noLiege", "tribute paid with no liege is checked, not dropped");
  assert.match(by.totalIncome?.inForce ?? "", /^check\.known/, "a month over unset lines is the total of the lines set");
  for (const agreed of ["peasantFamilies", "urbanFamilies", "hexCount", "line.land", "line.service", "line.tax"]) assert.equal(by[agreed], undefined, `${agreed} agrees`);
});
test("the page written back from the record reads back into the same record", () => {
  const { system } = firstWrite();
  const { values, overflow } = domainPageValues(system, { name: "Hollowmere", ...sumsOf(system), recorded: PAGE });
  assert.equal(values["domain.structure.0.0"], "Watchtower ×2");
  assert.equal(values["domain.structure.0.3"], "20", "the row's capacity, all its units together");
  assert.equal(values["domain.region.1"], true);
  assert.deepEqual([values["domain.income.0.land"], values["domain.income.0.families"], values["domain.income.0.total"]], ["2", "120", "240"]);
  assert.deepEqual([values["domain.income.1.land"], values["domain.income.1.families"]], ["1", "150"]);
  assert.deepEqual([values["domain.income.2.land"], values["domain.income.2.families"], values["domain.income.2.total"]], [undefined, "30", "45"]);
  assert.equal(values["domain.hex.0.revenue"], "11", "a hex's revenue comes back from the record by its number");
  assert.deepEqual([values["domain.vassal.0.name"], values["domain.vassal.0.domain"], values["domain.vassal.0.tax"]], ["Pell", "Lowfold", "15"]);
  assert.equal(values["domain.location"], "North of the river");
  assert.equal(values["domain.totalIncome"], undefined, "a partial month is not written as a total");
  assert.equal(values["domain.tribute.outTotal"], undefined, "no liege, no tribute paid");
  assert.deepEqual(overflow, []);
  const back = domainUpdate(domainPagePlan(values), system, { makeId: counter() }).system;
  assert.deepEqual(back, system);
});
test("a vassal's tax is all it pays, and reads back with the extra tax kept apart", () => {
  const record = { vassalRows: [{ id: "v1", name: "Lowfold", tributeGp: 10, extraTaxGp: 5 }] };
  const { values } = domainPageValues(record, { name: "X", ...sumsOf(record) });
  assert.equal(values["domain.vassal.0.tax"], "15");
  const back = domainUpdate(domainPagePlan(values), record, { makeId: counter() }).system.vassalRows;
  assert.deepEqual(back.map((v) => [v.tributeGp, v.extraTaxGp]), [[10, 5]]);
});
test("a table longer than the page is cut and named, and an expense with no row is named", () => {
  const record = {
    vassalRows: Array.from({ length: 8 }, (_, i) => ({ name: `Vale ${i + 1}` })),
    otherExpenses: [{ label: "Bridge repair", gp: 5 }],
  };
  const { overflow } = domainPageValues(record, { name: "X", ...sumsOf(record) });
  assert.deepEqual(overflow, [{ table: "otherExpense", dropped: ["Bridge repair"] }, { table: "vassal", dropped: ["Vale 8"] }]);
});
test("a line with two different rates writes its total alone", () => {
  assert.deepEqual(sheetLine({ peasantPer: 2, urbanPer: 3 }, { peasant: 10, urban: 5 }), { per: null, families: null, total: 35 });
  assert.deepEqual(sheetLine({ peasantGp: 50 }, { peasant: 10, urban: 5 }), { per: null, families: 10, total: 50 });
  assert.equal(sheetLine({}, { peasant: 10, urban: 5 }), null);
});

section("official sheet: the blank form");
test("the export's book is the importer's form entry, named by its count alone", () => {
  assert.equal(BOOKS[SHEET_BOOK]?.form, true);
  assert.ok(bookIsForm(SHEET_BOOK));
  assert.deepEqual(Object.keys(BOOKS).filter(bookIsForm), [SHEET_BOOK]);
  assert.equal(identifyBook(BOOKS[SHEET_BOOK].pages, null), SHEET_BOOK);
  assert.equal(identifyBook(BOOKS[SHEET_BOOK].pages, ""), SHEET_BOOK);
});
test("the blank is a fresh copy of the open sheet, and nothing when it is not open", async () => {
  const asked = [];
  const open = { BOOKS, bookBytes: async (id) => (asked.push(id), new Uint8Array([7, 8])) };
  const blank = await blankSheet(open);
  assert.deepEqual([...blank.bytes], [7, 8]);
  assert.equal(blank.label, BOOKS[SHEET_BOOK].label);
  assert.deepEqual(asked, [SHEET_BOOK]);
  assert.equal(await blankSheet({ BOOKS, bookBytes: async () => null }), null);
  assert.equal(await blankSheet({ BOOKS, bookBytes: async () => new Uint8Array() }), null);
  assert.equal(await blankSheet(null), null, "no importer on this seat");
});

for (const [name, fn] of tests) {
  if (name === null) {
    console.log(fn);
    continue;
  }
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} passed`);
