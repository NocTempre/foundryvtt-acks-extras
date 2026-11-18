/**
 * Offline tests for the ceremonial invocation engine
 * (`scripts/magic/ceremony-tables.mjs`, `scripts/magic/ceremony.mjs`): the
 * readers over raw table cells and the three-outcome throw. Foundry-free. Every
 * table, number, label and word below is invented, in the shapes the importer
 * stores them, so this file carries no book content.
 *
 * Usage: node tools/test-ceremony.mjs
 */
import assert from "node:assert/strict";

const { PRIORITY, registerTable, resetTables, unregisterTable } = await import("../scripts/lib/tables.mjs");
const T = await import("../scripts/magic/ceremony-tables.mjs");
const { resolveCeremony } = await import("../scripts/magic/ceremony.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ----------------------------- invented tables ----------------------------- */

// Header cells are shuffled so a column picked by position finds the wrong one.
const GRID = {
  columns: { c1: "5", c2: "1-2", c3: "3", c4: "4", c5: "6+", c6: "2" },
  r1: { c1: "9+", c2: "14+", c3: "12+", c4: "10+", c5: "6+", c6: "13+" },
  r2: { c1: "\u22123+", c2: "17+", c3: "8+", c4: "11+", c5: "2+", c6: "15+" },
  r3: { c1: "7+", c2: "\u2014", c3: "x+", c4: "5+", c5: "\u20132+" },
  r4: { c1: "4+", c2: "9+", c3: "9+", c4: "3+", c5: "1+", c6: "7+" },
  r5: { c1: "1+", c2: "2+", c3: "6+", c4: "8+", c5: "3+", c6: "4+" },
  r6: { __missing: true },
};
const PACE = {
  r1: { pace: "Hasty", time: "2 beats (20 ticks)", throwModifier: "\u22123", automaticFailure: "1-3", mishapDegree: "By tier, less one" },
  r2: { pace: "the REGULAR pace*", time: "1 tide", throwModifier: "0", automaticFailure: "1", mishapDegree: "By tier" },
  r3: { pace: "Meth odical", time: "\u2014", throwModifier: "+2", automaticFailure: "1\u20132", mishapDegree: "As the level, plus 1" },
};
const DEGREES = {
  r1: { min: 1, max: 2, degree: "Alpha" },
  r2: { min: 3, max: 4, degree: "Beta" },
  r3: { min: 5, max: 6, degree: "Gamma" },
};
const MISHAP = {
  r1: { label: 1, c1: "R1 D1", c2: "R1 D2", c3: "R1 D3" },
  r2: { label: 2, c1: "R2 D1", c2: "R2 D2", c3: "\u2014" },
  r3: { label: 3, c1: "R3 D1", c2: "R3 D2", c3: "R3 D3" },
  r4: { label: "4", c1: "R4 D1", c2: "R4 D2", c3: "R4 D3" },
  r5: { label: 5, c1: "R5 D1", c2: "R5 D2", c3: "R5 D3" },
  r6: { __missing: true },
};

const register = (tables, priority = PRIORITY.WORLD, extra = {}) => registerTable({ id: "gnosis", tables, ...extra }, { priority });
const registerAll = () => {
  resetTables();
  register({ performanceGrid: GRID, paceTable: PACE, ceremonyDegree: DEGREES, mishapTable: MISHAP }, PRIORITY.WORLD, {
    source: { pages: "Invented p. 1" },
    cites: { paceTable: "Invented p. 2", mishapTable: "Invented p. 3" },
  });
};
registerAll();
const tables = () => T.readCeremonyTables("gnosis");

/** A baseline throw: level 2, invoker level 3 (target 8), regular pace, Wisdom +1. */
const base = (over = {}) => ({
  invocationLevel: 2,
  invokerLevel: 3,
  pace: "regular",
  wisdomMod: 1,
  set: { effectiveLevel: 5 },
  natural: 10,
  marks: { stigmaOnFailure: 2, damageOnBotch: 3 },
  ...over,
});
const run = (over, tbl = tables()) => resolveCeremony(base(over), tbl);
const keys = (r) => r.blocks.map((b) => b.key);

/* ------------------------------ cell parsers ------------------------------ */

t("a target reads sign forms, a trailing plus, and dash and minus characters as negative", () => {
  const cases = [["11+", 11], ["-1+", -1], ["\u22121+", -1], ["\u20132", -2], ["\u2014 3+", -3], ["- 4", -4], ["+5", 5], ["7", 7], ["0+", 0], ["-0", 0], [12, 12], ["8+*", 8]];
  for (const [cell, want] of cases) assert.equal(T.parseTarget(cell), want, String(cell));
  for (const cell of ["\u2014", "-", "", null, undefined, "x+", "1.5", "3 4", {}]) assert.equal(T.parseTarget(cell), null, String(cell));
});

t("a modifier reads plus, minus and dash forms and refuses a bare dash", () => {
  assert.deepEqual(["+3", "\u22122", "\u20132", "-1", "0", " + 4 ", 5].map(T.parseModifier), [3, -2, -2, -1, 0, 4, 5]);
  for (const cell of ["\u2014", "-", "", "3+", "two", null]) assert.equal(T.parseModifier(cell), null, String(cell));
});

t("a band reads a range with either dash, a single face, open ends, and an ordinal suffix", () => {
  assert.deepEqual(T.parseBand("1-3"), { min: 1, max: 3 });
  assert.deepEqual(T.parseBand("1\u20133"), { min: 1, max: 3 });
  assert.deepEqual(T.parseBand("3 \u2212 1"), { min: 1, max: 3 });
  assert.deepEqual(T.parseBand("2"), { min: 2, max: 2 });
  assert.deepEqual(T.parseBand("6+"), { min: 6, max: null });
  assert.deepEqual(T.parseBand("6 or higher"), { min: 6, max: null });
  assert.deepEqual(T.parseBand("2 or lower"), { min: null, max: 2 });
  assert.deepEqual(T.parseBand("3rd"), { min: 3, max: 3 });
  for (const cell of ["\u2014", "", "most", null]) assert.equal(T.parseBand(cell), null, String(cell));
});

t("a pace cell is matched by its word, in three wordings, with split letters and decoration", () => {
  assert.equal(T.parsePaceKey("Hasty"), "hasty");
  assert.equal(T.parsePaceKey("the REGULAR pace*"), "regular");
  assert.equal(T.parsePaceKey("Meth odical (slow)"), "methodical");
  assert.equal(T.parsePaceKey("irregular"), null);
  assert.equal(T.parsePaceKey("hasty or regular"), null);
  assert.equal(T.parsePaceKey("Brisk"), null);
});

t("a degree rule reads a signed number, a worded shift, or no shift; anything else is null", () => {
  assert.equal(T.parseShift("By tier"), 0);
  assert.equal(T.parseShift("By tier, less one"), -1);
  assert.equal(T.parseShift("As the level, plus 1"), 1);
  assert.equal(T.parseShift("By level \u22122"), -2);
  assert.equal(T.parseShift("tier, 2 higher"), 2);
  for (const cell of ["Special", "less", "level 3", "", "\u2014", null]) assert.equal(T.parseShift(cell), null, String(cell));
});

/* ------------------------------ the grid reader ------------------------------ */

t("the column comes from the header cell that holds the invoker level, never from position", () => {
  const g = tables().grid;
  assert.equal(T.gridTarget(g, 1, 5).target, 9, "level 5 is c1; by position it would be c5");
  assert.equal(T.gridTarget(g, 1, 5).column, "c1");
  assert.equal(T.gridTarget(g, 1, 3).target, 12);
  assert.equal(T.gridTarget(g, 1, 1).target, 14, "a band header");
  assert.equal(T.gridTarget(g, 1, 9).target, 6, "an open-ended header");
});

t("a single-level header beats a band that also holds the level", () => {
  assert.equal(T.gridTarget(tables().grid, 1, 2).column, "c6");
  assert.equal(T.gridTarget(tables().grid, 1, 2).target, 13);
});

t("a negative target reads from every minus form", () => {
  assert.equal(T.gridTarget(tables().grid, 2, 5).target, -3);
  assert.equal(T.gridTarget(tables().grid, 3, 7).target, -2);
});

t("a level with no column, an absent cell, a dash, an unparsable cell, a missing row and no row are null", () => {
  const g = tables().grid;
  for (const [level, invoker] of [[1, 0], [3, 2], [3, 1], [3, 3], [6, 3], [9, 3]]) {
    assert.equal(T.gridTarget(g, level, invoker).target, null, `${level}/${invoker}`);
  }
  assert.equal(T.gridTarget(g, 1.5, 3).target, null);
  assert.equal(T.gridTarget(g, 1, undefined).target, null);
});

t("a blank cell is null and carries its table's page", () => {
  const blank = T.gridTarget(tables().grid, 3, 1);
  assert.equal(blank.target, null);
  assert.equal(blank.cite, "Invented p. 1");
  assert.equal(blank.byHand, false);
});

t("a grid whose header row is missing or unparsable has no column to match", () => {
  const noHeader = T.readGrid({ ...GRID, columns: { __missing: true } });
  assert.equal(T.gridTarget(noHeader, 1, 3).target, null);
  assert.equal(T.gridTarget(T.readGrid({ ...GRID, columns: { c1: "most" } }), 1, 3).target, null);
});

t("a table nothing registered reads as absent, without throwing", () => {
  resetTables();
  const absent = T.readCeremonyTables("gnosis");
  assert.equal(absent.grid.present, false);
  assert.equal(absent.pace.present, false);
  assert.equal(absent.mishap.die, null);
  assert.equal(T.gridTarget(absent.grid, 1, 3).target, null);
  assert.equal(T.gridTarget(absent.grid, 1, 3).cite, null);
  registerAll();
});

t("a kind with no set reads as null and resolves to blocks, not a throw", () => {
  assert.equal(T.readCeremonyTables("ceremonial"), null);
  assert.equal(T.readCeremonyTables("toString"), null);
  const r = resolveCeremony(base(), null);
  assert.equal(r.outcome, null);
  assert.equal(r.proceed, false);
  assert.deepEqual(keys(r).sort(), ["paceNotImported", "targetBlank"]);
});

t("the set names its document, its four tables and the parts the grid already counts", () => {
  const set = T.CEREMONY_SETS.gnosis;
  assert.equal(set.docId, "gnosis");
  assert.deepEqual(Object.keys(set.tables), ["grid", "pace", "degrees", "mishap"]);
  assert.deepEqual(tables().gridIncludes, [...set.gridIncludes]);
  assert.ok(set.gridIncludes.length > 0);
});

/* ------------------------------ other readers ------------------------------ */

t("the pace table reads each pace by its word with time, modifier, band and degree rule", () => {
  const p = tables().pace;
  assert.deepEqual(Object.keys(p.paces), ["hasty", "regular", "methodical"]);
  assert.deepEqual(
    { ...p.paces.hasty },
    { key: "hasty", time: "2 beats (20 ticks)", modifier: -3, band: { min: 1, max: 3 }, degreeShift: -1, cite: "Invented p. 2", byHand: false },
  );
  assert.deepEqual([p.paces.regular.modifier, p.paces.regular.band, p.paces.regular.degreeShift], [0, { min: 1, max: 1 }, 0]);
  assert.deepEqual([p.paces.methodical.modifier, p.paces.methodical.band, p.paces.methodical.degreeShift], [2, { min: 1, max: 2 }, 1]);
  assert.equal(p.paces.methodical.time, null, "a dash is no time");
});

t("a pace two rows name is ambiguous and a pace no row names is absent; a bad cell is null, not 0", () => {
  const p = T.readPace({ r1: { ...PACE.r1 }, r2: { ...PACE.r1 }, r3: { ...PACE.r2, throwModifier: "\u2014", automaticFailure: "n/a" } });
  assert.equal(p.paces.hasty, null);
  assert.equal(p.paces.methodical, null);
  assert.equal(p.paces.regular.modifier, null);
  assert.equal(p.paces.regular.band, null);
});

t("the degree rows keep print order as the ordinal, and a level reads its band", () => {
  const d = tables().degrees;
  assert.deepEqual(d.rows.map((r) => [r.ordinal, r.min, r.max, r.word]), [[1, 1, 2, "Alpha"], [2, 3, 4, "Beta"], [3, 5, 6, "Gamma"]]);
  assert.equal(T.degreeAt(d, 4).ordinal, 2);
  assert.equal(T.degreeAt(d, 5).word, "Gamma");
});

t("a level under the lowest band loses the set; one above the highest, or in a gap, only has no degree", () => {
  const d = tables().degrees;
  assert.deepEqual([T.degreeAt(d, 0).setLost, T.degreeAt(d, 0).ordinal], [true, null]);
  assert.deepEqual([T.degreeAt(d, 7).setLost, T.degreeAt(d, 7).ordinal], [false, null]);
  const gap = T.readDegrees({ r1: { min: 1, max: 2, degree: "A" }, r2: { min: 5, max: 6, degree: "B" } });
  assert.deepEqual([T.degreeAt(gap, 3).setLost, T.degreeAt(gap, 3).ordinal], [false, null]);
  assert.equal(T.degreeAt(T.readDegrees({ r1: { max: 3, degree: "A" } }), -4).setLost, false, "a band open below has nothing under it");
});

t("a mishap row's face is its label, the die fits the faces, and a row with no label is left out", () => {
  const m = tables().mishap;
  assert.equal(m.die, "1d5");
  assert.equal(m.rows.length, 5);
  assert.equal(T.mishapAt(m, 4, 2).cell, "R4 D2", "a label stored as text still reads");
  assert.equal(T.mishapAt(m, 3, 1).cell, "R3 D1");
  const unlabeled = T.readMishap({ r1: { c1: "a", c2: "b" }, r2: { label: 2, c1: "c", c2: "d" } });
  assert.deepEqual(unlabeled.rows.map((r) => [r.min, r.max]), [[2, 2]]);
});

t("a mishap column is its number: a row with no first cell hands the second degree the second cell", () => {
  const m = T.readMishap({ r1: { label: 1, c2: "only second", c3: "only third" }, r2: { label: 2, c1: "first" } });
  assert.equal(T.mishapAt(m, 1, 1).cell, null);
  assert.equal(T.mishapAt(m, 1, 2).cell, "only second");
  assert.equal(T.mishapAt(m, 1, 3).cell, "only third");
  assert.equal(T.mishapAt(m, 2, 1).cell, "first");
  assert.equal(T.mishapAt(m, 2, 2).cell, null);
});

t("a mishap cell that is a dash, a face with no row, or a degree with no column answers null with the page", () => {
  const m = tables().mishap;
  for (const [face, degree] of [[2, 3], [6, 1], [9, 1], [1, 4], [1, 0]]) {
    const r = T.mishapAt(m, face, degree);
    assert.equal(r.cell, null, `${face}/${degree}`);
    assert.equal(r.cite, "Invented p. 3");
  }
});

/* ------------------------------ provenance ------------------------------ */

t("an overridden table is the Judge's figure: byHand, with no page", () => {
  register({ paceTable: { r1: { pace: "Hasty", time: "1 beat", throwModifier: "-9", automaticFailure: "1", mishapDegree: "By tier" } } }, PRIORITY.OVERRIDE);
  const read = tables();
  assert.equal(read.pace.byHand, true);
  assert.equal(read.pace.cite, null);
  assert.equal(read.pace.paces.hasty.byHand, true);
  assert.equal(read.pace.paces.hasty.cite, null);
  assert.equal(read.pace.paces.regular, null, "an override replaces the whole table");
  assert.equal(read.grid.byHand, false);
  assert.equal(read.grid.cite, "Invented p. 1");
  const r = resolveCeremony(base({ pace: "hasty" }), read);
  assert.deepEqual(r.parts[0], { key: "pace", value: -9, byHand: true });
  unregisterTable("gnosis", { priority: PRIORITY.OVERRIDE });
});

t("a lookup passed in replaces the registry", () => {
  const read = T.readCeremonyTables("gnosis", { table: (doc, id) => (id === "performanceGrid" ? GRID : null), citeOf: () => "Stub p. 9", isOverridden: () => false });
  assert.equal(read.grid.present, true);
  assert.equal(read.grid.cite, "Stub p. 9");
  assert.equal(read.pace.present, false);
});

/* ------------------------------ the throw ------------------------------ */

t("success: the total meets the target outside the failure band; the parts name themselves", () => {
  const r = run();
  assert.equal(r.target, 8);
  assert.deepEqual(r.parts, [{ key: "pace", value: 0, cite: "Invented p. 2" }, { key: "wisdom", value: 1 }]);
  assert.equal(r.total, 11);
  assert.equal(r.outcome, "success");
  assert.equal(r.proceed, true);
  assert.deepEqual([r.stigmaMarks, r.damageMarks, r.mishap], [0, 0, null]);
  assert.equal(r.targetSource.cite, "Invented p. 1");
  assert.deepEqual(r.pace, { key: "regular", time: "1 tide", band: { min: 1, max: 1 }, degreeShift: 0, cite: "Invented p. 2", byHand: false });
});

t("a total equal to the target succeeds", () => {
  assert.equal(run({ natural: 7 }).outcome, "success");
  assert.equal(run({ natural: 6 }).outcome, "failure");
});

t("failure: no proceed, the failure's stigma, no damage, no mishap", () => {
  const r = run({ natural: 5 });
  assert.equal(r.outcome, "failure");
  assert.equal(r.proceed, false);
  assert.deepEqual([r.stigmaMarks, r.damageMarks, r.mishap], [2, 0, null]);
});

t("a situational part is added and marked as set by hand", () => {
  const r = run({ natural: 5, situational: 2 });
  assert.deepEqual(r.parts.find((p) => p.key === "situational"), { key: "situational", value: 2, byHand: true });
  assert.equal(r.total, 8);
  assert.equal(r.outcome, "success");
});

t("botch by band: a natural roll in the band botches even when the total meets the target", () => {
  const r = run({ natural: 1, wisdomMod: 9 });
  assert.equal(r.total, 10);
  assert.equal(r.outcome, "botch");
  assert.equal(r.proceed, false);
  assert.deepEqual([r.stigmaMarks, r.damageMarks], [2, 3]);
});

t("the band's edge: the last natural roll in it botches and the next one does not", () => {
  const edge = { pace: "hasty", wisdomMod: 9 };
  assert.equal(run({ ...edge, natural: 3 }).outcome, "botch");
  assert.equal(run({ ...edge, natural: 4 }).outcome, "success");
  assert.equal(run({ pace: "methodical", wisdomMod: 9, natural: 2 }).outcome, "botch");
  assert.equal(run({ pace: "methodical", wisdomMod: 9, natural: 3 }).outcome, "success");
});

t("botch by hurt: the invoker's wound botches a roll that would succeed, and needs no roll at all", () => {
  const r = run({ hurt: true, natural: 18 });
  assert.equal(r.outcome, "botch");
  assert.equal(r.total, 19);
  const lost = run({ hurt: true, natural: undefined });
  assert.equal(lost.outcome, "botch");
  assert.equal(lost.total, null);
  assert.equal(lost.damageMarks, 3);
  assert.equal(lost.mishap.pending, "mishapNatural");
});

t("a missing natural roll without a wound is no outcome", () => {
  const r = run({ natural: undefined });
  assert.equal(r.outcome, null);
  assert.equal(r.proceed, false);
  assert.deepEqual(keys(r), ["noRoll"]);
});

t("a negative target is met by a negative total", () => {
  const at = (natural, wisdomMod) => run({ invokerLevel: 5, natural, wisdomMod });
  assert.equal(at(4, -5).target, -3);
  assert.equal(at(4, -5).total, -1);
  assert.equal(at(4, -5).outcome, "success");
  assert.equal(at(2, -5).outcome, "success", "total -3 equals the target");
  assert.equal(at(2, -6).outcome, "failure");
});

t("mishap passed: the same parts against the same target; nothing is read", () => {
  const r = run({ natural: 1, mishapNatural: 19 });
  assert.equal(r.mishap.throw.total, 20);
  assert.equal(r.mishap.passed, true);
  assert.deepEqual([r.mishap.degree, r.mishap.setLost, r.mishap.cell, r.mishap.pending], [null, false, null, null]);
  assert.equal(run({ natural: 1, mishapNatural: 7 }).mishap.passed, true, "total equals the target");
});

t("mishap failed: the degree is read at the invocation level, then the face reads the imported cell", () => {
  const first = run({ natural: 1, mishapNatural: 2 });
  assert.equal(first.mishap.passed, false);
  assert.deepEqual([first.mishap.degree, first.mishap.degreeWord, first.mishap.shiftedLevel], [1, "Alpha", 2]);
  assert.equal(first.mishap.pending, "mishapFace");
  assert.equal(first.mishap.die, "1d5");
  const read = run({ natural: 1, mishapNatural: 2, mishapFace: 3 });
  assert.equal(read.mishap.face, 3);
  assert.equal(read.mishap.cell, "R3 D1");
  assert.equal(read.mishap.cite, "Invented p. 3");
  assert.equal(read.mishap.pending, null);
});

t("the pace's degree rule moves the level before the band is read, not the degree after it", () => {
  // Level 4 calls for the second band; one less is level 3, still the second band. Moving the
  // degree instead would give the first.
  const r = run({ invocationLevel: 4, pace: "hasty", natural: 1, mishapNatural: 1, mishapFace: 1 });
  assert.equal(r.mishap.shiftedLevel, 3);
  assert.equal(r.mishap.degree, 2);
  assert.equal(r.mishap.cell, "R1 D2");
  const up = run({ invocationLevel: 5, pace: "methodical", natural: 1, wisdomMod: 0, mishapNatural: 1, mishapFace: 2 });
  assert.equal(up.mishap.shiftedLevel, 6);
  assert.equal(up.mishap.degree, 3);
  assert.equal(up.mishap.cell, null, "the third degree of this row is blank");
  assert.equal(up.mishap.cite, "Invented p. 3");
});

t("a degree below the lowest loses the set and rolls nothing", () => {
  const r = run({ invocationLevel: 1, pace: "hasty", natural: 2, mishapNatural: 2, mishapFace: 4 });
  assert.equal(r.outcome, "botch");
  assert.equal(r.mishap.passed, false);
  assert.equal(r.mishap.shiftedLevel, 0);
  assert.equal(r.mishap.setLost, true);
  assert.deepEqual([r.mishap.degree, r.mishap.cell, r.mishap.pending], [null, null, null]);
  assert.equal(r.mishap.cite, "Invented p. 1");
  assert.equal(run({ invocationLevel: 1, pace: "hasty", natural: 2, mishapNatural: 2 }).mishap.pending, null);
});

t("a level no band holds, or a degree rule that will not read, blocks the reading and guesses nothing", () => {
  const fewer = T.readCeremonyTables("gnosis", { table: (doc, id) => ({ performanceGrid: GRID, paceTable: PACE, ceremonyDegree: { r1: DEGREES.r1, r2: DEGREES.r2 }, mishapTable: MISHAP }[id]) });
  const r = resolveCeremony(base({ invocationLevel: 5, pace: "methodical", natural: 1, mishapNatural: 1, mishapFace: 1 }), fewer);
  assert.equal(r.mishap.degree, null);
  assert.equal(r.mishap.cell, null);
  assert.deepEqual(r.blocks.filter((b) => b.key === "degreeUnreadable").map((b) => b.why), ["noBand"]);
  const rule = { ...PACE, r1: { ...PACE.r1, mishapDegree: "Special" } };
  const odd = T.readCeremonyTables("gnosis", { table: (doc, id) => ({ performanceGrid: GRID, paceTable: rule, ceremonyDegree: DEGREES, mishapTable: MISHAP }[id]) });
  const r2 = resolveCeremony(base({ pace: "hasty", natural: 1, mishapNatural: 1 }), odd);
  assert.deepEqual(r2.blocks.filter((b) => b.key === "degreeUnreadable").map((b) => b.why), ["degreeRule"]);
  assert.equal(r2.mishap.degree, null);
});

t("a missing mark count is 0 marks and a noFigure note, never a literal", () => {
  const r = run({ natural: 1, marks: {} });
  assert.equal(r.outcome, "botch");
  assert.deepEqual([r.stigmaMarks, r.damageMarks], [0, 0]);
  assert.deepEqual(r.notes, [{ key: "noFigure", figure: "stigmaOnFailure" }, { key: "noFigure", figure: "damageOnBotch" }]);
  const partial = run({ natural: 5, marks: { stigmaOnFailure: 0, damageOnBotch: 3 } });
  assert.deepEqual([partial.stigmaMarks, partial.damageMarks], [0, 0]);
  assert.deepEqual(partial.notes, [{ key: "noFigure", figure: "stigmaOnFailure" }]);
  assert.deepEqual(run({ natural: 5, marks: undefined }).notes, [{ key: "noFigure", figure: "stigmaOnFailure" }]);
  assert.deepEqual(run({ natural: 1, marks: { stigmaOnFailure: 1.5, damageOnBotch: "2" } }).notes.length, 2);
  assert.deepEqual(run().notes, [], "a success needs no figure");
});

t("a blank target proceeds nowhere and says so, with its page", () => {
  const r = run({ invocationLevel: 3, invokerLevel: 1 });
  assert.equal(r.target, null);
  assert.equal(r.outcome, null);
  assert.equal(r.proceed, false);
  assert.deepEqual([r.stigmaMarks, r.damageMarks, r.mishap], [0, 0, null]);
  assert.deepEqual(r.blocks.find((b) => b.key === "targetBlank"), { key: "targetBlank", cite: "Invented p. 1", byHand: false });
  assert.equal(run({ invocationLevel: 3, invokerLevel: 1, hurt: true }).outcome, null, "a wound does not make a blank target a botch");
});

t("a pace that is not imported blocks, and so does one whose modifier or band will not read", () => {
  const r = run({ pace: "slow" });
  assert.equal(r.outcome, null);
  assert.deepEqual(r.blocks.find((b) => b.key === "paceNotImported").missing, ["row"]);
  const bad = { ...PACE, r2: { ...PACE.r2, throwModifier: "\u2014", automaticFailure: "?" } };
  const read = T.readCeremonyTables("gnosis", { table: (doc, id) => ({ performanceGrid: GRID, paceTable: bad, ceremonyDegree: DEGREES, mishapTable: MISHAP }[id]) });
  const r2 = resolveCeremony(base(), read);
  assert.equal(r2.outcome, null);
  assert.equal(r2.proceed, false);
  assert.deepEqual(r2.blocks.find((b) => b.key === "paceNotImported").missing, ["modifier", "band"]);
  assert.equal(r2.parts.some((p) => p.key === "pace"), false, "no 0 stands in for the modifier");
});

t("a set too low, or none held, is a block; the throw still resolves", () => {
  assert.deepEqual(keys(run({ set: { effectiveLevel: 1 } })), ["noSetHighEnough"]);
  assert.deepEqual(keys(run({ set: null })), ["noSetHighEnough"]);
  assert.deepEqual(keys(run({ set: undefined })), ["noSetHighEnough"]);
  assert.deepEqual(keys(run({ set: { effectiveLevel: 2 } })), []);
  assert.equal(run({ set: null }).outcome, "success");
});

t("stigma at the threshold blocks only when both figures are carried", () => {
  assert.deepEqual(keys(run({ stigma: 4, threshold: 4 })), ["stigmaAtThreshold"]);
  assert.deepEqual(keys(run({ stigma: 5, threshold: 4 })), ["stigmaAtThreshold"]);
  assert.deepEqual(keys(run({ stigma: 3, threshold: 4 })), []);
  assert.deepEqual(keys(run({ stigma: 9, threshold: null })), [], "no ceiling imported: no lockout");
  assert.deepEqual(keys(run({ stigma: 9 })), []);
});

t("a pace other than hasty in a fight blocks", () => {
  assert.deepEqual(keys(run({ inCombat: true })), ["nonHastyInCombat"]);
  assert.deepEqual(keys(run({ inCombat: true, pace: "methodical" })), ["nonHastyInCombat"]);
  assert.deepEqual(keys(run({ inCombat: true, pace: "hasty" })), []);
  assert.deepEqual(keys(run({ inCombat: false })), []);
});

t("a part the grid already counts is never added; another extra part is", () => {
  const set = T.CEREMONY_SETS.gnosis.gridIncludes;
  const r = run({ extraParts: [{ key: set[0], value: 5 }, { key: set[1], value: 5 }, { key: "extraBonus", value: 2, cite: "Invented p. 4" }, { key: "noValue" }] });
  assert.deepEqual(r.parts.map((p) => p.key), ["pace", "wisdom", "extraBonus"]);
  assert.equal(r.total, 13);
  assert.deepEqual(r.gridIncludes, [...set]);
});

t("a throw from frozen inputs answers the same twice and alters nothing it was given", () => {
  const input = Object.freeze(base({ natural: 1, mishapNatural: 2, mishapFace: 1, marks: Object.freeze({ stigmaOnFailure: 1, damageOnBotch: 1 }) }));
  const read = tables();
  const before = JSON.stringify(read);
  const a = resolveCeremony(input, read);
  const b = resolveCeremony(input, read);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(read), before);
});

console.log(`test-ceremony: ${n} checks passed`);
