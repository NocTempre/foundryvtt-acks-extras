/**
 * Offline tests for the research, ritual and sacrifice readers
 * (`scripts/magic/research-tables.mjs`) and for the recipes the importer reads
 * them with (`scripts/importer/books/rr/table-recipes-research.mjs`). Foundry-free.
 * Every table, figure, label and page below is invented, in the shapes the
 * importer stores them, so this file carries no book content.
 *
 * Usage: node tools/test-research-tables.mjs
 */
import assert from "node:assert/strict";

const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");
const R = await import("../scripts/magic/research-tables.mjs");
const { TABLE_RECIPES } = await import("../scripts/importer/table-recipes.mjs");
const { researchRecipes } = await import("../scripts/importer/books/rr/table-recipes-research.mjs");
const RESEARCH = TABLE_RECIPES[R.RESEARCH_DOC_ID];

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ----------------------------- invented tables ----------------------------- */

const TABLES = {
  researchLadder: {
    r0: { label: 3, rate: "7.5gp", throw: "17+" },
    r1: { label: 4, rate: "11gp", throw: "13+" },
    r2: { label: 5, rate: "300gp", throw: "9+" },
    r3: { label: 6, rate: "4,300gp", throw: "6+" },
    r4: { label: 7, rate: "9,500gp", throw: "2+" },
  },
  researchLadderNote: { otherProjectsRate: 1200 },
  researchProse: { ancillaryFraction: "2/5 his research", autoFailBand: [2, 4], penalty: -2, penaltyMinimum: -1 },
  assistantProse: { managerLevel: 6, managerBase: 2, aidLevel: 2, spellLevel: 4, itemLevel: 8 },
  libraryProse: { minimum: 3000, step: 1500, bonusStep: 7000, bonusSize: 2, bonusCap: 5, share: 25 },
  sampleProse: { sampleBonus: 3 },
  workshopProse: {
    minimum: 3500,
    step: 1700,
    bonusStep: 6000,
    bonusSize: 1,
    bonusCap: 4,
    identifyLevel: 4,
    identifyMaterial: 900,
    identifyResearch: 800,
    identifyBonusStep: 8000,
    identifyBonusSize: 1,
    identifyBonusCap: 2,
  },
  ritualCostProse: {
    learnMaterial: "31,000gp for 5 level; 62,000gp for 6 level; th 124,000gp for 7 level th th research cost: 31,000gp for 5",
    learnResearch: "31,000gp for 5 level; 62,000gp for 6 th level; 124,000gp for 7 level magic research throw",
    castComponent: "41,000gp for 5 level; 82,000gp for th th 6 level; 164,000gp for 7 level. the special",
    castMaterial: "43,000gp for 5 level; 86,000gp for 6 level; 172,000gp for 7 level",
    castResearch: "47,000gp for 5 level; 94,000gp for 6 level; 188,000gp for 7 level",
    libraryMinimums: "13,000gp for 5 th th level spells; 14,900gp for 6 level spells; and 16,400gp for 7 level spells.",
    libraryBonusStep: 9000,
    libraryBonusSize: 1,
    libraryBonusCap: 2,
  },
  ritualWorkshopProse: { workshopMinimums: "12,000gp for 5 level spells; 13,000gp th th for 6 level spells; and 17,000gp for 7 level", bonusStep: 5000, bonusSize: 2, bonusCap: 6 },
  sacrificeTraits: {
    r0: { label: "Victim is lettered", multiplier: "+component Value" },
    r1: { label: "Victim is ringed", multiplier: "+component Value × 2" },
    r2: { label: "Victim is crowned", multiplier: "+component Value × 7" },
    r3: { label: "Victim is odd", multiplier: "see text" },
  },
  divineLifetime: { count: 3, unit: "week" },
  arcaneLifetime: { unit: "day" },
  powerOfSacrifice: { multiplier: 3 },
};

const CITES = Object.fromEntries(Object.keys(TABLES).map((id) => [id, `Invented p. ${id.length}`]));
const register = (tables = TABLES, priority = PRIORITY.WORLD) => registerTable({ id: R.RESEARCH_DOC_ID, source: { pages: "Invented 1-2" }, cites: CITES, tables }, { priority, source: "test" });

/* -------------------------------- parsers -------------------------------- */

t("figure reads a number, a separated number and a signed one, and nothing else", () => {
  assert.equal(R.figure(12), 12);
  assert.equal(R.figure("1,234"), 1234);
  assert.equal(R.figure("-2"), -2);
  assert.equal(R.figure("−2"), -2);
  assert.equal(R.figure("2.5"), 2.5);
  assert.equal(R.figure("two"), null);
  assert.equal(R.figure(undefined), null);
  assert.equal(R.figure(NaN), null);
});

t("parseGp reads a gold cell with a decimal, separators and a mark; anything else is null", () => {
  assert.equal(R.parseGp("7.5gp"), 7.5);
  assert.equal(R.parseGp("12,500gp*"), 12500);
  assert.equal(R.parseGp("12,500 gp"), 12500);
  assert.equal(R.parseGp("gp"), null);
  assert.equal(R.parseGp("12,500"), null);
});

t("parseThrow reads a target with or without the plus", () => {
  assert.equal(R.parseThrow("14+"), 14);
  assert.equal(R.parseThrow("14"), 14);
  assert.equal(R.parseThrow("x+"), null);
});

t("parseFraction reads a slashed fraction out of a window and refuses a zero denominator", () => {
  assert.deepEqual(R.parseFraction("2/5 his research"), { numerator: 2, denominator: 5, share: 0.4 });
  assert.equal(R.parseFraction("1/0"), null);
  assert.equal(R.parseFraction("half"), null);
});

t("parseLevelCosts reads cost and level pairs past stray marks and stops at the next label", () => {
  assert.deepEqual(R.parseLevelCosts(TABLES.ritualCostProse.learnMaterial), [
    { level: 5, gp: 31000 },
    { level: 6, gp: 62000 },
    { level: 7, gp: 124000 },
  ]);
  assert.deepEqual(R.parseLevelCosts("90gp for 5 level; 91gp for 5 level"), [{ level: 5, gp: 90 }]);
  assert.equal(R.parseLevelCosts("none"), null);
  assert.equal(R.parseLevelCosts(""), null);
});

/* ------------------------------ nothing imported ------------------------------ */

t("with nothing registered every reader says so, every figure is null and nothing throws", () => {
  resetTables();
  const all = R.readResearchTables();
  assert.equal(all.ladder.present, false);
  assert.deepEqual(all.ladder.rungs, []);
  assert.equal(all.ladder.cite, null);
  assert.equal(all.prose.penalty, null);
  assert.equal(all.prose.autoFail, null);
  assert.equal(all.assistants.managerLevel, null);
  for (const f of Object.values(all.facilities)) {
    assert.equal(f.present, false);
    assert.equal(f.minimum, null);
    assert.equal(f.bonus.cap, null);
  }
  assert.equal(all.sample.bonus, null);
  assert.equal(all.ritualCosts.cast.material, null);
  assert.deepEqual(all.sacrifice.rows, []);
  assert.equal(all.divineLifetime.lifetime, null);
  assert.equal(all.powerOfSacrifice.multiplier, null);
  assert.equal(R.researchRateAt(all.ladder, 4, { full: true }), null);
  assert.equal(R.substitutionPenalty(all.prose, { level: 3, share: 0.5 }), null);
  assert.equal(R.assistantCapacity(all.assistants, { level: 9, intBonus: 1 }), null);
  assert.equal(R.facilityMinimum(all.facilities.library, 2), null);
  assert.equal(R.facilityBonus(all.facilities.library, { value: 55000, required: 3000 }), null);
  assert.equal(R.sacrificeBonus(all.sacrifice, [0], 100), null);
});

t("an unknown facility kind has no reader", () => {
  assert.equal(R.readFacility("kitchen"), null);
});

/* --------------------------------- the ladder --------------------------------- */

t("the ladder reads every rung with its page, and an unparsable rung is left out", () => {
  resetTables();
  register({ ...TABLES, researchLadder: { ...TABLES.researchLadder, r5: { label: 8, rate: "lots", throw: "1+" }, r6: { __missing: true } } });
  const ladder = R.readLadder();
  assert.equal(ladder.present, true);
  assert.deepEqual(ladder.rungs.map((r) => r.level), [3, 4, 5, 6, 7]);
  assert.equal(ladder.rungs[0].rate, 7.5);
  assert.equal(ladder.rungs[3].rate, 4300);
  assert.equal(ladder.rungs[1].throw, 13);
  assert.equal(ladder.cite, CITES.researchLadder);
  assert.equal(ladder.byHand, false);
  assert.equal(ladder.otherProjectsRate, 1200);
});

t("a rate is the ladder's own at full, and the lesser of it and the other-projects rate otherwise", () => {
  resetTables();
  register();
  const ladder = R.readLadder();
  assert.deepEqual(R.researchRateAt(ladder, 6, { full: true }), { level: 6, throw: 6, cite: CITES.researchLadder, byHand: false, rate: 4300, reduced: false });
  assert.equal(R.researchRateAt(ladder, 6).rate, 1200);
  assert.equal(R.researchRateAt(ladder, 6).reduced, true);
  assert.equal(R.researchRateAt(ladder, 5).rate, 300);
  assert.equal(R.researchRateAt(ladder, 5).reduced, false);
  assert.equal(R.researchRateAt(ladder, 2), null);
});

t("without the other-projects rate a reduced read is null and a full read still answers", () => {
  resetTables();
  register({ ...TABLES, researchLadderNote: {} });
  const ladder = R.readLadder();
  assert.equal(ladder.otherProjectsRate, null);
  assert.equal(R.researchRateAt(ladder, 5), null);
  assert.equal(R.researchRateAt(ladder, 5, { full: true }).rate, 300);
});

/* ----------------------------- the research rules ----------------------------- */

t("the prose figures read, with the ancillary share as a fraction", () => {
  resetTables();
  register();
  const p = R.readResearchProse();
  assert.deepEqual(p.ancillary, { numerator: 2, denominator: 5, share: 0.4 });
  assert.deepEqual(p.autoFail, { min: 2, max: 4 });
  assert.equal(p.penalty, -2);
  assert.equal(p.penaltyMinimum, -1);
  assert.equal(R.ancillaryRate(p, 50), 20);
  assert.equal(R.isAutoFail(p, 3), true);
  assert.equal(R.isAutoFail(p, 5), false);
  assert.equal(R.isAutoFail(p, 1), false);
  assert.equal(R.ancillaryRate(p, NaN), null);
});

t("the substitution penalty scales by share and level, rounds toward zero, and never falls under the minimum", () => {
  resetTables();
  register();
  const p = R.readResearchProse();
  assert.equal(R.substitutionPenalty(p, { level: 3, share: 1 }), -6);
  assert.equal(R.substitutionPenalty(p, { level: 3, share: 2 / 3 }), -4);
  assert.equal(R.substitutionPenalty(p, { level: 3, share: 0.4 }), -2);
  assert.equal(R.substitutionPenalty(p, { level: 1, share: 0.1 }), -1);
  assert.equal(R.substitutionPenalty(p, { level: 3, share: 0 }), 0);
  assert.equal(R.substitutionPenalty(p, { level: 3, share: 1.5 }), null);
  assert.equal(R.substitutionPenalty({ ...p, penaltyMinimum: null }, { level: 3, share: 1 }), null);
});

t("an unparsable ancillary window is null and so is every rate derived from it", () => {
  resetTables();
  register({ ...TABLES, researchProse: { ...TABLES.researchProse, ancillaryFraction: "an eighth" } });
  const p = R.readResearchProse();
  assert.equal(p.ancillary, null);
  assert.equal(R.ancillaryRate(p, 50), null);
});

/* -------------------------------- assistants -------------------------------- */

t("assistants: nothing below the manager's level, else the base plus the Intellect bonus", () => {
  resetTables();
  register();
  const a = R.readAssistants();
  assert.equal(R.assistantCapacity(a, { level: 5, intBonus: 2 }), 0);
  assert.equal(R.assistantCapacity(a, { level: 6, intBonus: 0 }), 2);
  assert.equal(R.assistantCapacity(a, { level: 9, intBonus: 3 }), 5);
  assert.equal(R.assistantCapacity(a, { level: 9, intBonus: -1 }), 2);
  assert.equal(R.assistantMinimum(a, "aid"), 2);
  assert.equal(R.assistantMinimum(a, "spell"), 4);
  assert.equal(R.assistantMinimum(a, "item"), 8);
  assert.equal(R.assistantMinimum(a, "other"), null);
});

/* -------------------------------- facilities -------------------------------- */

t("a library and a workshop read their own minimum, step and bonus, and a bonus cap is not borrowed across kinds", () => {
  resetTables();
  register({ ...TABLES, workshopProse: { ...TABLES.workshopProse, bonusCap: undefined } });
  const lib = R.readFacility("library");
  const shop = R.readFacility("workshop");
  assert.deepEqual([lib.minimum, lib.step, lib.bonus], [3000, 1500, { step: 7000, size: 2, cap: 5 }]);
  assert.equal(lib.share, 0.25);
  assert.deepEqual([shop.minimum, shop.step, shop.bonus.cap], [3500, 1700, null]);
  assert.equal(shop.share, null);
  assert.equal(R.facilityBonus(shop, { value: 90000, required: 3500 }), null);
  assert.equal(lib.cite, CITES.libraryProse);
});

t("a facility's minimum climbs by the step for each level after the first", () => {
  resetTables();
  register();
  const lib = R.readFacility("library");
  assert.equal(R.facilityMinimum(lib, 1), 3000);
  assert.equal(R.facilityMinimum(lib, 3), 6000);
  assert.equal(R.facilityMinimum(lib, 0), null);
  assert.equal(R.facilityMinimum(lib, 2.5), null);
});

t("a ritual facility lists its minimums by level and answers null for a level it does not list", () => {
  resetTables();
  register();
  const rl = R.readFacility("ritualLibrary");
  const rw = R.readFacility("ritualWorkshop");
  assert.equal(R.facilityMinimum(rl, 5), 13000);
  assert.equal(R.facilityMinimum(rl, 7), 16400);
  assert.equal(R.facilityMinimum(rl, 4), null);
  assert.equal(R.facilityMinimum(rw, 6), 13000);
  assert.deepEqual(rw.bonus, { step: 5000, size: 2, cap: 6 });
  assert.deepEqual(rl.bonus, { step: 9000, size: 1, cap: 2 });
});

t("the bonus is the size for each whole step above the minimum, capped, divided among sharers, zero under the minimum", () => {
  resetTables();
  register();
  const lib = R.readFacility("library");
  assert.equal(R.facilityBonus(lib, { value: 3000, required: 3000 }), 0);
  assert.equal(R.facilityBonus(lib, { value: 9999, required: 3000 }), 0);
  assert.equal(R.facilityBonus(lib, { value: 10000, required: 3000 }), 2);
  assert.equal(R.facilityBonus(lib, { value: 24000, required: 3000 }), 5);
  assert.equal(R.facilityBonus(lib, { value: 100000, required: 3000 }), 5);
  assert.equal(R.facilityBonus(lib, { value: 2000, required: 3000 }), 0);
  assert.equal(R.facilityBonus(lib, { value: 20000, required: 3000, sharers: 2 }), 2);
  assert.equal(R.facilityBonus(lib, { value: 20000, required: 3000, sharers: 0 }), null);
});

t("a library keeps its printed share of a research's spend", () => {
  resetTables();
  register();
  const lib = R.readFacility("library");
  assert.equal(R.librarySpendShare(lib, 2000), 500);
  assert.equal(R.librarySpendShare(R.readFacility("workshop"), 2000), null);
});

t("identification reads its level, its costs and its own library bonus, and the sample its bonus", () => {
  resetTables();
  register();
  const id = R.readIdentification();
  assert.deepEqual([id.minimumLevel, id.material, id.research], [4, 900, 800]);
  assert.deepEqual(id.library.bonus, { step: 8000, size: 1, cap: 2 });
  assert.equal(id.library.minimum, null);
  assert.equal(R.facilityBonus(id.library, { value: 30000, required: 5000 }), 2);
  assert.equal(R.readSample().bonus, 3);
});

/* ------------------------------ ritual costs ------------------------------ */

t("ritual costs read by level for learning and casting, and a level not listed is null", () => {
  resetTables();
  register();
  const c = R.readRitualCosts();
  assert.equal(R.ritualCostAt(c.learn.material, 6), 62000);
  assert.equal(R.ritualCostAt(c.learn.research, 7), 124000);
  assert.equal(R.ritualCostAt(c.cast.component, 5), 41000);
  assert.equal(R.ritualCostAt(c.cast.material, 7), 172000);
  assert.equal(R.ritualCostAt(c.cast.research, 6), 94000);
  assert.equal(R.ritualCostAt(c.cast.research, 9), null);
  assert.equal(R.ritualCostAt(null, 5), null);
});

/* ------------------------- sacrifice and divine power ------------------------- */

t("sacrifice traits read their labels and factors, a bare row counts once and a cell with neither is null", () => {
  resetTables();
  register();
  const s = R.readSacrificeTraits();
  assert.deepEqual(s.rows.map((r) => r.times), [1, 2, 7, null]);
  assert.equal(s.rows[1].label, "Victim is ringed");
  assert.equal(s.cite, CITES.sacrificeTraits);
});

t("the sacrifice bonus sums the applying rows' factors times the component value, and is null on an unread factor", () => {
  resetTables();
  register();
  const s = R.readSacrificeTraits();
  assert.equal(R.sacrificeBonus(s, [], 100), 0);
  assert.equal(R.sacrificeBonus(s, [0, 2], 100), 800);
  assert.equal(R.sacrificeBonus(s, [3], 100), null);
  assert.equal(R.sacrificeBonus(s, [9], 100), null);
  assert.equal(R.sacrificeBonus(s, [0], NaN), null);
});

t("the lifetimes and the power's multiplier read; an arcane lifetime has a unit and no count", () => {
  resetTables();
  register();
  assert.deepEqual(R.readDivineLifetime().lifetime, { count: 3, unit: "week" });
  assert.deepEqual(R.readArcaneLifetime().lifetime, { count: null, unit: "day" });
  assert.equal(R.readPowerOfSacrifice().multiplier, 3);
});

/* ---------------------------- override and layers ---------------------------- */

t("a Judge's override replaces the table, carries byHand and no page", () => {
  resetTables();
  register();
  register({ researchProse: { ancillaryFraction: "1/9", autoFailBand: [1, 1], penalty: -5, penaltyMinimum: -2 } }, PRIORITY.OVERRIDE);
  const p = R.readResearchProse();
  assert.equal(p.penalty, -5);
  assert.equal(p.byHand, true);
  assert.equal(p.cite, null);
  assert.equal(R.readAssistants().byHand, false);
  assert.equal(R.readAssistants().cite, CITES.assistantProse);
});

t("a lookup passed in stands in for the registry", () => {
  resetTables();
  const seen = [];
  const lookup = { table: (doc, id) => (seen.push([doc, id]), id === "sampleProse" ? { sampleBonus: 5 } : null), citeOf: () => "Elsewhere p. 1", isOverridden: () => false };
  const s = R.readSample(lookup);
  assert.equal(s.bonus, 5);
  assert.equal(s.cite, "Elsewhere p. 1");
  assert.deepEqual(seen, [[R.RESEARCH_DOC_ID, "sampleProse"]]);
  assert.equal(R.readResearchProse(lookup).present, false);
});

/* --------------------------------- recipes --------------------------------- */

t("every table of the document is a recipe, and the Rulebook folder's document is merged into TABLE_RECIPES under its own id", () => {
  assert.ok(RESEARCH, "the document is merged");
  assert.deepEqual(Object.keys(RESEARCH.tables), Object.keys(researchRecipes.magicResearch.tables));
  assert.equal(RESEARCH.source.pages, researchRecipes.magicResearch.pages);
  for (const id of Object.values(R.RESEARCH_TABLE_IDS)) assert.ok(RESEARCH.tables[id], `recipe ${id}`);
  for (const [id, recipe] of Object.entries(RESEARCH.tables)) {
    assert.equal(recipe.book, "rr", id);
    assert.ok(Number.isInteger(recipe.printedPage), id);
    assert.ok(recipe.locate, id);
    assert.ok(["gridRows", "proseValues"].includes(recipe.shape), id);
  }
});

t("the recipes hold no figure of their own: no anchor or locate carries a digit, and no row key carries one but its position", () => {
  for (const [id, recipe] of Object.entries(RESEARCH.tables)) {
    assert.doesNotMatch(recipe.locate, /\d/, `${id} locate`);
    for (const v of recipe.values ?? []) assert.doesNotMatch(v.find, /\d/, `${id}.${v.key} find`);
    for (const row of recipe.rows ?? []) assert.match(row.key, /^r\d+$/, `${id} row key`);
  }
});

t("every folio the recipes read is named in the document's source pages", () => {
  const named = new Set();
  for (const [, a, b] of RESEARCH.source.pages.matchAll(/(\d+)(?:-(\d+))?/g)) for (let p = Number(a); p <= Number(b ?? a); p++) named.add(p);
  for (const [id, recipe] of Object.entries(RESEARCH.tables)) assert.ok(named.has(recipe.printedPage), `${id} p${recipe.printedPage}`);
});

resetTables();
console.log(`\n${n} tests passed`);
