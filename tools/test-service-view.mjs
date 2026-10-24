/**
 * Pure-logic regression tests for the Service panel's and the roster's
 * decisions (`scripts/henchmen/rules/service.mjs`). No Foundry: records are
 * built by hand, so these assert what the panel reads off a record — the wage
 * clock, the loyalty and morale parts, the ledger order, the share words, the
 * slot, the roster filter — rather than what a running world renders. Every
 * figure is invented fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert";
import {
  ROSTER_FILTERS, bucketOf, keepsLoyalty, wageClock, loyaltyParts, moraleParts, ledgerEntries, shareKind, termsOf,
  rolledOf, slotOf, serviceBadge, filterRows, filterCounts, ROLLED_SCORES,
} from "../scripts/henchmen/rules/service.mjs";
import { effectiveMorale, effectiveLoyalty, clampScore } from "../scripts/henchmen/rules/loyalty.mjs";
import { henchmanWage, henchmanWageCite } from "../scripts/henchmen/rules/wages.mjs";
import * as tables from "../scripts/lib/tables.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const DAY = 86400;
const MONTH = 28 * DAY;

console.log("service: the wage clock");
test("a clock never started reads unset and bills nothing", () => {
  const c = wageClock({ lastPaid: null, now: 10 * MONTH, month: MONTH, day: DAY });
  assert.equal(c.unset, true);
  assert.equal(c.behind, 0);
  assert.equal(c.pct, 0);
});
test("twelve days into a month: the fill is the fraction, the next payday is in sixteen", () => {
  const c = wageClock({ lastPaid: 100 * DAY, now: 112 * DAY, month: MONTH, day: DAY });
  assert.equal(c.unset, false);
  assert.equal(c.behind, 0);
  assert.equal(c.pct, Math.round((12 / 28) * 100));
  assert.equal(c.sinceDays, 12);
  assert.equal(c.untilDays, 16);
  assert.equal(c.tone, null);
});
test("a month and more behind: the bar is full, red, and the months owed count", () => {
  const c = wageClock({ lastPaid: 0, now: 2 * MONTH + 3 * DAY, month: MONTH, day: DAY });
  assert.equal(c.behind, 2);
  assert.equal(c.pct, 100);
  assert.equal(c.tone, "neg");
  assert.equal(c.untilDays, 0);
});
test("the last second of the month is still one day until", () => {
  const c = wageClock({ lastPaid: 0, now: MONTH - 1, month: MONTH, day: DAY });
  assert.equal(c.behind, 0);
  assert.equal(c.untilDays, 1);
});

console.log("service: standing");
const record = {
  loyalty: {
    start: 1,
    permanents: [
      { delta: -1, reason: "wound", note: "a hand", compensated: false },
      { delta: -1, reason: "calamity", note: "", compensated: true },
    ],
  },
  morale: { base: 0, permanents: [{ delta: 1, reason: "levelGain", note: "Level 2" }] },
  special: { pendingCalamity: true },
};
test("loyalty sums start, the permanents still counting, Charisma and powers, and counts the uncompensated", () => {
  const p = loyaltyParts(record, { chaLoyalty: 1, baseLoyaltyBonus: 0 });
  assert.deepEqual(p, { start: 1, permanents: -1, uncompensated: 1, cha: 1, powers: 0, total: 1 });
});
test("the loyalty parts' total is the figure the panel and the throws read", () => {
  const cases = [[record, { chaLoyalty: 1, baseLoyaltyBonus: 0 }], [{ loyalty: { start: 4 } }, { chaLoyalty: 3 }], [{}, {}], [{ loyalty: { start: -4, permanents: [{ delta: -3 }] } }, { baseLoyaltyBonus: 1 }]];
  for (const [r, mods] of cases) assert.equal(loyaltyParts(r, mods).total, effectiveLoyalty(r, mods));
});
test("the total is clamped to the score's range", () => {
  assert.equal(loyaltyParts({ loyalty: { start: 4 } }, { chaLoyalty: 3 }).total, 4);
  assert.equal(loyaltyParts({ loyalty: { start: -4, permanents: [{ delta: -3 }] } }, {}).total, -4);
});
test("morale reads the record's base, else the sheet's, plus the permanents", () => {
  assert.deepEqual(moraleParts(record, 2), { base: 0, permanents: 1, powers: 0, total: 1 });
  assert.deepEqual(moraleParts({}, 2), { base: 2, permanents: 0, powers: 0, total: 2 });
});
test("the employer's powers are a part of morale, added after base and permanents are held to the range", () => {
  assert.deepEqual(moraleParts(record, 2, 1), { base: 0, permanents: 1, powers: 1, total: 2 });
  const high = { morale: { base: 4, permanents: [{ delta: 2 }] } };
  assert.equal(moraleParts(high, 0, -1).total, 3, "held at 4 before the power, so the power counts from there");
});
test("the parts' total is the figure the obedience throw and the roster read", () => {
  const cases = [[record, 2, 0], [record, 2, 1], [{}, -3, -2], [{ morale: { base: 4, permanents: [{ delta: 2 }] } }, 0, -1]];
  for (const [r, sheet, powers] of cases) {
    assert.equal(moraleParts(r, sheet, powers).total, clampScore(effectiveMorale(r, sheet) + powers));
  }
});
test("the badge is one while a calamity's throw is owed", () => {
  assert.equal(serviceBadge(record), 1);
  assert.equal(serviceBadge({ special: { pendingCalamity: false } }), 0);
  assert.equal(serviceBadge({}), 0);
});

console.log("service: the ledger");
test("both tracks, newest first within each, carrying the toggle's coordinates and a tone", () => {
  const rows = ledgerEntries(record);
  assert.deepEqual(rows.map((r) => [r.track, r.index, r.signed, r.compensated, r.tone]), [
    ["loyalty", 1, "−1", true, "neg"],
    ["loyalty", 0, "−1", false, "neg"],
    ["morale", 0, "+1", false, "pos"],
  ]);
});
test("no ledger is an empty list, never a throw", () => {
  assert.deepEqual(ledgerEntries({}), []);
  assert.deepEqual(ledgerEntries(undefined), []);
});

console.log("service: the terms");
test("a share is said as a word for the fractions the record stores", () => {
  assert.deepEqual(shareKind(0.5), { kind: "half", pct: 50 });
  assert.deepEqual(shareKind(1), { kind: "full", pct: 100 });
  assert.deepEqual(shareKind(0), { kind: "none", pct: 0 });
  assert.deepEqual(shareKind(0.25), { kind: "pct", pct: 25 });
  assert.deepEqual(shareKind("x"), { kind: "none", pct: 0 });
});
test("the agreed wage wins, then the sheet's, then the ladder for a henchman alone", () => {
  assert.equal(termsOf({ terms: { wageGp: 30 } }, { sheetWage: "25", ladder: 12 }).wage, 30);
  assert.equal(termsOf({}, { sheetWage: "25", ladder: 12 }).wage, 25);
  assert.equal(termsOf({}, { ladder: 12 }).wage, 12);
  const merc = termsOf({}, { ladder: 12, category: "mercenary" });
  assert.equal(merc.wage, 0);
  assert.equal(merc.wageUnset, true, "a mercenary's unstated wage bills nothing");
});
test("the wage names where it came from: the record, the sheet, the ladder, or nowhere", () => {
  assert.equal(termsOf({ terms: { wageGp: 30 } }, { sheetWage: "25", ladder: 12 }).wageFrom, "agreed");
  assert.equal(termsOf({}, { sheetWage: "25", ladder: 12 }).wageFrom, "sheet");
  assert.equal(termsOf({}, { ladder: 12 }).wageFrom, "ladder");
  assert.equal(termsOf({ terms: { wageGp: 0 } }, { sheetWage: "25", ladder: 12 }).wageFrom, "ladder", "an agreed nothing falls to the ladder, as the wage does");
  assert.equal(termsOf({}, {}).wageFrom, null);
  assert.equal(termsOf({}, { ladder: 12, category: "mercenary" }).wageFrom, null);
});
test("the wage table's page is the one the import recorded for the table the wage is read from", () => {
  const saved = globalThis.acksExtras;
  globalThis.acksExtras = { lib: { tables } };
  try {
    tables.resetTables();
    assert.equal(henchmanWageCite(), null, "nothing imported: no page");
    tables.registerTable({ id: "availability", source: { pages: "AV 1-2" }, tables: { henchmanAvailability: { rows: [{ level: 1, wage: 7 }] } } }, { priority: tables.PRIORITY.WORLD });
    assert.equal(henchmanWage(1), 7);
    assert.equal(henchmanWageCite(), "AV 1-2", "the fallback table's page, from its document where no table page is recorded");
    tables.registerTable({ id: "wages", source: { pages: "W 1-9" }, cites: { henchmanWageByLevel: "W 3" }, tables: { henchmanWageByLevel: { byLevel: { 1: 9 } } } }, { priority: tables.PRIORITY.WORLD });
    assert.equal(henchmanWage(1), 9);
    assert.equal(henchmanWageCite(), "W 3", "the ladder wins, with its own page");
    tables.registerTable({ id: "wages", tables: { henchmanWageByLevel: { byLevel: { 1: 11 } } } }, { priority: tables.PRIORITY.OVERRIDE });
    assert.equal(henchmanWage(1), 11);
    assert.equal(henchmanWageCite(), null, "a Judge's override holds no page");
  } finally {
    tables.resetTables();
    globalThis.acksExtras = saved;
  }
});
test("a share the record never stated is read at the default, and says so", () => {
  assert.equal(termsOf({ terms: { treasureShare: 0.5, xpShare: 0.5 } }).sharesDefaulted, false);
  assert.equal(termsOf({ terms: { treasureShare: 1 } }).sharesDefaulted, true);
  assert.equal(termsOf({}).sharesDefaulted, true);
});
test("the shares default to the record's initial and the arrears to nothing", () => {
  const t = termsOf({ terms: { signingBonusGp: 50, arrearsGp: 7 } });
  assert.equal(t.treasureShare.kind, "half");
  assert.equal(t.xpShare.kind, "half");
  assert.equal(t.signingBonus, 50);
  assert.equal(t.arrears, 7);
  assert.equal(termsOf({}).arrears, 0);
});

console.log("service: the record's extras");
test("recorded rolls print the six scores in order, a missing one as a dash", () => {
  const r = rolledOf({ rolled: { attributes: { str: 13, int: 10, wil: 9, dex: 14, con: 12 }, classKey: "fighter", level: 1 } });
  assert.deepEqual(r.scores, ["13", "10", "9", "14", "12", "—"]);
  assert.deepEqual(ROLLED_SCORES, ["str", "int", "wil", "dex", "con", "cha"], "the order the panel's tooltip names them in");
  assert.equal(r.any, true);
  assert.equal(rolledOf({}).any, false);
  assert.equal(rolledOf({}).scores, null);
});
test("a henchman takes a slot unless the record exempts them; the other kinds never do", () => {
  assert.equal(slotOf({}, "henchman"), "counted");
  assert.equal(slotOf({ special: { noSlot: true } }, "henchman"), "noSlot");
  assert.equal(slotOf({}, "mercenary"), "none");
  assert.equal(slotOf({ special: { noSlot: true } }, "specialist"), "none");
});

console.log("roster: the filter");
const rows = [
  { id: "a", bucket: bucketOf("henchman") },
  { id: "b", bucket: bucketOf(undefined) },
  { id: "c", bucket: bucketOf("mercenary") },
  { id: "d", bucket: bucketOf("specialist") },
];
test("categories sort into three buckets, an unnamed one among the henchmen", () => {
  assert.deepEqual(rows.map((r) => r.bucket), ["henchmen", "henchmen", "mercenaries", "specialists"]);
  assert.equal(keepsLoyalty("henchman"), true);
  assert.equal(keepsLoyalty("mercenary"), false);
});
test("the filters keep their rows and count them; an unknown filter keeps all", () => {
  assert.deepEqual(ROSTER_FILTERS, ["all", "henchmen", "mercenaries", "specialists"]);
  assert.deepEqual(filterRows(rows, "henchmen").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterRows(rows, "all").map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterRows(rows, "nope").map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterCounts(rows), { all: 4, henchmen: 2, mercenaries: 1, specialists: 1 });
});

console.log(`\nservice view: ${passed} passed`);
