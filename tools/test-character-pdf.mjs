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

section("official sheet: a class the world cannot bind");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
const { classUnbound, matchClass } = await import("../scripts/character-sheet/pdf/match.mjs");
const { CLASS_TYPE } = await import("../scripts/classes/constants.mjs");
const classDoc = (name, levels) => ({ name, type: CLASS_TYPE, system: { key: name.toLowerCase(), isStub: !levels } });
test("a name only a stub answers matches the stub, which binds nothing and is reported", () => {
  const held = globalThis.game.items;
  globalThis.game.items = [classDoc("Lampwright", 0), classDoc("Kiln Warden", 3)];
  try {
    const stub = matchClass("Lampwright");
    assert.equal(stub?.name, "Lampwright", "the key fallback returns the stub");
    assert.equal(classUnbound(stub, true), true, "a stub is unbound however the bind went");
    assert.equal(matchClass("Ashen Tinker"), null);
    assert.equal(classUnbound(null, false), true, "no class at all is unbound");
  } finally {
    globalThis.game.items = held;
  }
});
test("a class with rows is unbound only when its bind did not take", () => {
  const real = classDoc("Kiln Warden", 3);
  assert.equal(classUnbound(real, true), false);
  assert.equal(classUnbound(real, false), true);
});
test("the import reports an unbound class through that test, for the stub and the failed bind alike", async () => {
  const { readFileSync } = await import("node:fs");
  const apply = readFileSync(new URL("../scripts/character-sheet/pdf/apply.mjs", import.meta.url), "utf8");
  assert.match(apply, /if \(plan\.className && classUnbound\(cls, bound\)\) report\.unmatched\.push\(\{ kind: "className", name: plan\.className \}\);/);
  assert.match(apply, /import \{[^}]*\bclassUnbound\b[^}]*\} from "\.\/match\.mjs"/);
});

test("a character from the page is handed its class's fixed awards, after the sheet's own abilities, bound only, and never to a henchman", async () => {
  const { readFileSync } = await import("node:fs");
  const apply = readFileSync(new URL("../scripts/character-sheet/pdf/apply.mjs", import.meta.url), "utf8");
  const body = apply.slice(apply.indexOf("export async function importSheet"));
  assert.match(body, /record = true, fixedAwards = false \}/, "the option is off unless a caller passes it");
  const own = body.indexOf("await grantAbilities(target, plan.abilities, report, { unattended });");
  const fixed = body.indexOf("if (fixedAwards && bound) {");
  assert.ok(own > 0 && fixed > own && fixed < body.indexOf("await landGear("), "the call follows the sheet's grants and precedes the gear");
  assert.match(body, /grantFixedAwards\(target, cls, /);
  assert.match(body, /report\.unmatched\.push\(\{ kind: "power", name: g\.name \}\)/);
  const start = apply.indexOf("async function fillHenchman");
  const hench = apply.slice(start, apply.indexOf("\n}\n", start));
  assert.doesNotMatch(hench, /grantFixedAwards|fixedAwards/);
});

section("official sheet: the export's weapon rows");
test("a weapon's damage box holds the formula, whatever shape the item stores it in", async () => {
  const heldFoundry = globalThis.foundry;
  const heldGame = globalThis.game;
  globalThis.game = { ...heldGame, user: { isGM: false }, settings: { get: () => undefined } };
  globalThis.foundry = {
    abstract: { DataModel: class {}, TypeDataModel: class {} },
    applications: { api: { HandlebarsApplicationMixin: (base) => base, ApplicationV2: class {}, DialogV2: class {} }, sheets: {}, handlebars: {} },
    utils: { flattenObject: (o) => o },
    data: { fields: new Proxy({}, { get: () => class {} }) },
  };
  try {
    const { sheetValues } = await import("../scripts/character-sheet/pdf/export.mjs");
    const weapon = (id, name, damage) => ({ id, name, type: "weapon", system: { damage, range: {} } });
    const items = [
      weapon("w1", "Stub Pike", { base: { formula: "1d8" }, alternate: { formula: "1d10" } }),
      weapon("w2", "Stub Club", "1d4"),
    ];
    const actor = { name: "Fixture", system: {}, flags: {}, getFlag: () => undefined, items };
    const { values } = sheetValues(actor);
    const damageOf = (name) => {
      const row = [0, 1].find((i) => values[`weapon.${i}.name`] === name);
      return values[`weapon.${row}.damage`];
    };
    assert.equal(damageOf("Stub Pike"), "1d8", "the object's base formula, not [object Object]");
    assert.equal(damageOf("Stub Club"), "1d4", "a bare string passes through");
    assert.ok(!Object.values(values).some((v) => String(v).includes("[object Object]")));
  } finally {
    globalThis.foundry = heldFoundry;
    globalThis.game = heldGame;
  }
});

section("official sheet: a stack on a gear line");
test("a line counting three daggers is answered by the row in hand and the rest beside it, so a re-import reports no mismatch", async () => {
  const { stackAnswering } = await import("../scripts/character-sheet/pdf/match.mjs");
  const dagger = (id, qty, equipped, extra = {}) => ({ id, name: "Dagger", type: "weapon", system: { cost: 3, weight6: 1, equipped, quantity: qty }, flags: {}, ...extra });
  const drawn = dagger("drawn", 1, true);
  const rest = dagger("rest", 2, false);
  const answer = stackAnswering([rest, drawn]);
  assert.equal(answer.held, 3, "the sheet's count is the sum of both rows");
  assert.deepEqual(answer.rows.map((r) => r.id), ["rest", "drawn"], "both answer the line, so neither is claimed by a second dagger line");
  assert.equal(answer.item.id, "drawn", "the row already worn is the one placed, so no second dagger is drawn");
  const fresh = stackAnswering([dagger("all", 3, false)]);
  assert.deepEqual([fresh.held, fresh.item.id], [3, "all"], "an untouched row of three is the stack and the row to place");
  assert.equal(stackAnswering([]), null, "nothing carried is no stack");
  assert.equal(stackAnswering([dagger("fx", 1, false, { effects: [{ id: "e" }] })]), null, "a row with effects of its own is a copy, never counted into a stack");
});

test("every line of a name a stack answers is counted against the stack, and a re-import of the same lines owes nothing", async () => {
  const { answerGear } = await import("../scripts/character-sheet/pdf/match.mjs");
  const row = (id, name, qty, extra = {}) => ({ id, name, type: "item", system: { cost: 1, weight6: 1, quantity: qty }, flags: {}, ...extra });
  const dagger = (id, qty, equipped, extra = {}) => ({ id, name: "Dagger", type: "weapon", system: { cost: 3, weight6: 1, equipped, quantity: qty }, flags: {}, ...extra });
  const owed = (answers) => answers.map((a) => a.owed);
  const torches = [{ name: "Torch", qty: 3 }, { name: "Torch", qty: 2 }];

  assert.deepEqual(owed(answerGear(torches, [])), [3, 2], "(a) nothing carried: every line owes its count");

  const five = answerGear(torches, [row("t", "Torch", 5)]);
  assert.deepEqual(owed(five), [0, 0], "(b) a row of five answers lines of three and two");
  assert.deepEqual(five.map((a) => a.check), [null, null], "(b) and the sum matches, so nothing is reported");
  assert.deepEqual(five.map((a) => a.item.id), ["t", "t"], "(b) both lines are answered by the one item");

  const seven = answerGear(torches, [row("t", "Torch", 7)]);
  assert.deepEqual(owed(seven), [0, 0], "(c) a count the player changed is never topped up");
  assert.deepEqual(seven.map((a) => a.check), [{ label: "Torch", sheet: "5", inForce: "7" }, null], "(c) one check, against the sum of the lines, on the first");

  const daggers = [{ name: "Dagger", qty: 1 }, { name: "Dagger", qty: 1 }];
  const split = answerGear(daggers, [dagger("rest", 1, false), dagger("drawn", 1, true)]);
  assert.deepEqual(owed(split), [0, 0], "(d) the dagger in hand and the one resting are one stack of two");
  assert.deepEqual(split.map((a) => a.check), [null, null]);
  assert.equal(split[0].item.id, "drawn", "(d) the row already worn is the one placed");

  const lantern = (id, qty) => row(id, "Lantern", qty, { effects: [{ id: "e" }] });
  assert.deepEqual(owed(answerGear([{ name: "Lantern", qty: 3 }], [lantern("l", 3)])), [0], "(e) a row with effects holding three answers a line of three");
  assert.deepEqual(owed(answerGear([{ name: "Lantern", qty: 3 }], [lantern("l", 2)])), [1], "(e) and owes only what it lacks");

  const own = answerGear([{ name: "Lantern", qty: 1 }, { name: "Lantern", qty: 1 }], [lantern("l1", 1), lantern("l2", 1)]);
  assert.deepEqual(owed(own), [0, 0], "(f) two rows with effects answer two lines");
  assert.deepEqual(own.map((a) => a.rows.map((r) => r.id)), [["l1"], ["l2"]], "(f) each line claims its own row");

  assert.deepEqual(owed(answerGear([{ name: "Torch", qty: 3 }, { name: "Rope", qty: 1 }], [row("t", "Torch", 3)])), [0, 1], "a name no carried row answers still owes");
});

section("official sheet: one name on two lines places two units");
/**
 * A stand-in actor and the writes `landGear` makes. `placeItem` models the equip divert
 * (a stack of two or more put in a hand leaves the placed row holding one and a resting
 * row beside it for the rest), since the real path is core's and the live walk's.
 */
function gearBench(rows) {
  const actor = { items: rows };
  const calls = { placed: [], stored: [], delivered: 0 };
  const holder = (row) => row.flags?.["acks-extras"]?.containedIn ?? null;
  const deps = {
    wearLocation: (_actor, row) => (holder(row) ? "stowed" : (row.slot ?? "carried")),
    placeItem: async (_actor, row, slot) => {
      calls.placed.push({ id: row.id, slot });
      const count = row.system.quantity;
      if (count > 1) {
        row.system.quantity = 1;
        rows.push({ ...row, id: `${row.id}-rest`, system: { ...row.system, quantity: count - 1, equipped: false }, slot: undefined });
      }
      row.system.equipped = true;
      row.slot = slot;
      return true;
    },
    storeIn: async (_actor, row, box) => {
      calls.stored.push({ id: row.id, box: box.id });
      row.flags = { "acks-extras": { containedIn: box.id } };
    },
    buildGearData: async ({ name }) => ({ data: { name, type: "weapon", system: { cost: 3, weight6: 1, quantity: 1 }, flags: {} } }),
    // A delivery folds into the row the actor already holds under the name, as a stack does.
    deliverItems: async (_actor, goods) => {
      calls.delivered++;
      const count = goods.reduce((sum, g) => sum + (g.qty ?? g.quantity ?? 1), 0);
      const held = rows.find((r) => r.name === "Dagger");
      if (held) {
        held.system.quantity += count;
        return { created: [], updated: [held] };
      }
      const row = { id: "fresh", name: "Dagger", type: "weapon", system: { cost: 3, weight6: 1, equipped: false, quantity: count }, flags: {} };
      rows.push(row);
      return { created: [row], updated: [] };
    },
  };
  const report = { checks: [], notes: [], granted: [], unmatched: [], written: [] };
  return { actor, calls, deps, report, land: (gear) => landGear(actor, gear, report, deps) };
}
const daggerRow = (id, quantity, extra = {}) => ({ id, name: "Dagger", type: "weapon", system: { cost: 3, weight6: 1, equipped: false, quantity }, flags: {}, ...extra });
const backpack = { id: "pack", name: "Backpack", type: "item", system: { cost: 1, weight6: 1, quantity: 1 }, flags: { "acks-extras": { container: {} } } };
const mainLine = { name: "Dagger", qty: 1, place: "mainHand" };
const offLine = { name: "Dagger", qty: 1, place: "offHand" };
let landGear;
test("two hand lines naming a stack of two place two different rows, and the second moves nothing the first placed", async () => {
  // The module graph under apply.mjs reads these at load; nothing here calls them.
  class Stub {}
  Object.assign(globalThis, {
    ui: { notifications: {} },
    Hooks: { on() {}, once() {}, off() {}, call() {}, callAll() {} },
    foundry: {
      abstract: { DataModel: Stub, TypeDataModel: Stub },
      data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
      utils: { escapeHTML: (v) => v, deepClone: (v) => v, flattenObject: (o) => o },
      applications: { api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub }, handlebars: {} },
    },
  });
  ({ landGear } = await import("../scripts/character-sheet/pdf/apply.mjs"));
  const bench = gearBench([daggerRow("d", 2)]);
  await bench.land([mainLine, offLine]);
  assert.equal(bench.calls.placed.length, 2);
  assert.notEqual(bench.calls.placed[0].id, bench.calls.placed[1].id, "the off hand takes the resting row, not the one in the main hand");
  assert.deepEqual(bench.calls.placed.map((c) => c.slot), ["mainHand", "offHand"]);
  assert.deepEqual(bench.report.checks, [], "two lines of one against two carried is no mismatch");
});
test("a hand line and a backpack line naming one stack store a row other than the one drawn", async () => {
  const bench = gearBench([daggerRow("d", 2), backpack]);
  await bench.land([mainLine, { name: "Dagger", qty: 1, place: "backpack" }]);
  assert.deepEqual(bench.calls.placed.map((c) => c.id), ["d"]);
  assert.equal(bench.calls.stored.length, 1);
  assert.notEqual(bench.calls.stored[0].id, "d", "the pack takes the resting row, the drawn one stays in hand");
  assert.equal(bench.calls.stored[0].box, "pack");
  assert.deepEqual(bench.report.checks, []);
});
test("a second import over the placed rows moves nothing and lands nothing", async () => {
  const bench = gearBench([daggerRow("d", 2)]);
  await bench.land([mainLine, offLine]);
  const first = bench.calls.placed.length;
  await bench.land([mainLine, offLine]);
  assert.equal(bench.calls.placed.length, first, "every row already stands where its line puts it");
  assert.equal(bench.calls.delivered, 0);
  assert.deepEqual([bench.report.checks, bench.report.granted], [[], []]);
});
test("a divide the equip hook queues after its write returns has landed before the next line reads the rows", async () => {
  // Core's equip write resolves before the divert's divide lands (enforce.mjs
  // queues `takeOneToEquip` through `oneAtATime` and returns), so the stand-in
  // queues its divide the same way and returns at once.
  const { oneAtATime } = await import("../scripts/lib/item-model.mjs");
  const bench = gearBench([daggerRow("d", 2)]);
  const divide = bench.deps.placeItem;
  bench.deps.placeItem = async (actor, row, slot) => {
    oneAtATime(actor, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await divide(actor, row, slot);
    });
    return true;
  };
  await bench.land([mainLine, offLine]);
  await oneAtATime(bench.actor, async () => null);
  assert.deepEqual(bench.calls.placed.map((c) => c.id), ["d", "d-rest"], "the off hand waits for the main hand's divide and takes its resting row");
  assert.deepEqual(bench.report.checks, []);
});
test("a stack of one on two body lines is placed once, and the second line is reported", async () => {
  const bench = gearBench([daggerRow("d", 1)]);
  await bench.land([mainLine, offLine]);
  assert.deepEqual(bench.calls.placed, [{ id: "d", slot: "mainHand" }], "the second line does not move the row the first placed");
  assert.ok(bench.report.checks.some((c) => String(c.inForce).includes("notWorn")), "the line with no unit left is reported");
});
test("a stack of one on a hand line and a pack line stores nothing and reports the pack line", async () => {
  const bench = gearBench([daggerRow("d", 1), backpack]);
  await bench.land([mainLine, { name: "Dagger", qty: 1, place: "backpack" }]);
  assert.deepEqual(bench.calls.stored, []);
  assert.ok(bench.report.checks.some((c) => String(c.inForce).includes("loose")));
});
test("a fresh import of two lines of one name lands both into one row, then places two units of it", async () => {
  const bench = gearBench([]);
  await bench.land([mainLine, offLine]);
  assert.equal(bench.calls.delivered, 2);
  assert.equal(bench.actor.items.length, 2, "one row of two, divided by the first placement");
  assert.equal(bench.calls.placed.length, 2);
  assert.notEqual(bench.calls.placed[0].id, bench.calls.placed[1].id);
});
test("a name carried as separate copies places each line's own copy", async () => {
  const bench = gearBench([daggerRow("a", 1, { effects: [{ id: "e" }] }), daggerRow("b", 1, { effects: [{ id: "e" }] })]);
  await bench.land([mainLine, offLine]);
  assert.deepEqual(bench.calls.placed, [{ id: "a", slot: "mainHand" }, { id: "b", slot: "offHand" }]);
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
