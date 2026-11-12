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
  rolledOf, slotOf, serviceBadge, filterRows, filterCounts, ROLLED_SCORES, hireHitPoints, signingControls,
  judgePickHitPoints, offersClassPick,
} from "../scripts/henchmen/rules/service.mjs";
import { JUDGE_PICK_CLASS, hiredClassName } from "../scripts/henchmen/rules/candidates.mjs";
import { effectiveMorale, effectiveLoyalty, clampScore, startingLoyalty } from "../scripts/henchmen/rules/loyalty.mjs";
import { henchmanWage, henchmanWageCite, importedShare, importedShareCite, resolveShare } from "../scripts/henchmen/rules/wages.mjs";
import * as tables from "../scripts/lib/tables.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

// Invented ranges, deliberately unlike any system's: the helpers hold a score
// to whatever they are handed, a monster's morale field bounded apart from a
// character's.
const CHAR_LOYALTY = { min: -3, max: 5 };
const CHAR_MORALE = { min: -2, max: 6 };
const MONSTER_MORALE = { min: -7, max: 2 };

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
  for (const [r, mods] of cases) assert.equal(loyaltyParts(r, mods, CHAR_LOYALTY).total, effectiveLoyalty(r, mods, CHAR_LOYALTY));
});
test("the total is held to the bounds it is handed, and only on the sides they name", () => {
  assert.equal(loyaltyParts({ loyalty: { start: 4 } }, { chaLoyalty: 3 }, CHAR_LOYALTY).total, 5);
  assert.equal(loyaltyParts({ loyalty: { start: -4, permanents: [{ delta: -3 }] } }, {}, CHAR_LOYALTY).total, -3);
  assert.equal(loyaltyParts({ loyalty: { start: 40 } }, {}, { max: 9 }).total, 9, "a bound with no floor leaves the floor open");
  assert.equal(loyaltyParts({ loyalty: { start: -40 } }, {}, { max: 9 }).total, -40);
  assert.equal(loyaltyParts({ loyalty: { start: 40 } }, {}).total, 40, "no bounds, no clamp: no range is assumed");
});
test("morale reads the record's base, else the sheet's, plus the permanents", () => {
  assert.deepEqual(moraleParts(record, 2), { base: 0, permanents: 1, powers: 0, total: 1 });
  assert.deepEqual(moraleParts({}, 2), { base: 2, permanents: 0, powers: 0, total: 2 });
});
test("the employer's powers are a part of morale, added after base and permanents are held to the range", () => {
  assert.deepEqual(moraleParts(record, 2, 1), { base: 0, permanents: 1, powers: 1, total: 2 });
  const high = { morale: { base: 6, permanents: [{ delta: 2 }] } };
  assert.equal(moraleParts(high, 0, -1, CHAR_MORALE).total, 5, "held at the ceiling before the power, so the power counts from there");
});
test("the parts' total is the figure the obedience throw and the roster read", () => {
  const cases = [[record, 2, 0], [record, 2, 1], [{}, -3, -2], [{ morale: { base: 6, permanents: [{ delta: 2 }] } }, 0, -1]];
  for (const bounds of [CHAR_MORALE, MONSTER_MORALE]) {
    for (const [r, sheet, powers] of cases) {
      assert.equal(moraleParts(r, sheet, powers, bounds).total, clampScore(effectiveMorale(r, sheet, bounds) + powers, bounds));
    }
  }
});
test("a monster's morale floor is its own, lower than a character's", () => {
  const low = { morale: { base: -5, permanents: [] } };
  assert.equal(moraleParts(low, 0, 0, CHAR_MORALE).total, -2, "a character's morale stops at its floor");
  assert.equal(moraleParts(low, 0, 0, MONSTER_MORALE).total, -5, "a monster's goes further down");
  assert.equal(moraleParts(low, 0, -4, MONSTER_MORALE).total, -7, "and the power cannot take it past its own floor");
  assert.equal(effectiveMorale(low, 0, MONSTER_MORALE), -5);
  assert.equal(effectiveMorale({ morale: { base: 9 } }, 0, MONSTER_MORALE), 2, "or above its own ceiling");
});
test("a starting loyalty is held to the bounds handed in", () => {
  assert.equal(startingLoyalty({ base: 9, bounds: CHAR_LOYALTY }), 5);
  assert.equal(startingLoyalty({ base: -9, elan: 3, bounds: CHAR_LOYALTY }), -3);
  assert.equal(startingLoyalty({ base: 1, elan: 3, bounds: CHAR_LOYALTY }), 4, "the élan figure handed in is added");
  assert.equal(startingLoyalty({ base: 1, elan: true, bounds: CHAR_LOYALTY }), 1, "a flag in place of a figure adds nothing");
  assert.equal(startingLoyalty({ base: 1, irrefusable: -4, bounds: CHAR_LOYALTY }), -3, "the imported figure replaces the base, then is held");
  assert.equal(startingLoyalty({ base: 99 }), 99, "no bounds, no clamp");
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
test("an imported share and its page are read from its own table, in the layer that holds it", () => {
  const saved = globalThis.acksExtras;
  globalThis.acksExtras = { lib: { tables } };
  try {
    tables.resetTables();
    assert.equal(importedShare("treasure"), null, "nothing imported: no figure");
    assert.equal(importedShareCite("treasure"), null, "and no page");
    tables.registerTable({ id: "wages", source: { pages: "W 1-9" }, cites: { treasureShare: "W 2", xpShare: "W 7" }, tables: { treasureShare: { share: 0.3 }, xpShare: { share: 0.2 } } }, { priority: tables.PRIORITY.WORLD });
    assert.equal(importedShare("treasure"), 0.3);
    assert.equal(importedShare("xp"), 0.2);
    assert.equal(importedShareCite("treasure"), "W 2", "each share names its own page");
    assert.equal(importedShareCite("xp"), "W 7");
    tables.registerTable({ id: "wages", tables: { xpShare: { share: 0.6 } } }, { priority: tables.PRIORITY.OVERRIDE });
    assert.equal(importedShare("xp"), 0.6, "a Judge's override wins");
    assert.equal(importedShareCite("xp"), null, "and holds no page");
    assert.equal(importedShare("treasure"), 0.3, "the other share still reads the import");
    for (const table of [{}, { share: null }, { share: "0.3" }, { share: Number.NaN }, { share: -0.1 }]) {
      tables.resetTables();
      tables.registerTable({ id: "wages", tables: { treasureShare: table } }, { priority: tables.PRIORITY.WORLD });
      assert.equal(importedShare("treasure"), null, `${JSON.stringify(table)}: unread, never zero`);
    }
    tables.resetTables();
    tables.registerTable({ id: "wages", tables: { treasureShare: { share: 0 } } }, { priority: tables.PRIORITY.WORLD });
    assert.equal(importedShare("treasure"), 0, "zero is a figure");
  } finally {
    tables.resetTables();
    globalThis.acksExtras = saved;
  }
});
test("resolveShare takes the record's number, else the import's, else none", () => {
  assert.deepEqual(resolveShare(0.4, 0.3), { value: 0.4, from: "record" });
  assert.deepEqual(resolveShare(0, 0.3), { value: 0, from: "record" }, "a record's zero is its own");
  assert.deepEqual(resolveShare(null, 0.3), { value: 0.3, from: "imported" });
  assert.deepEqual(resolveShare(undefined, 0.3), { value: 0.3, from: "imported" });
  assert.deepEqual(resolveShare("0.4", 0.3), { value: 0.3, from: "imported" }, "text is no figure");
  assert.deepEqual(resolveShare(null, null), { value: null, from: null });
});
test("a share is the record's own figure, else the imported one, else none", () => {
  // Invented fractions: one the record holds, one the import holds.
  const shares = { treasure: 0.3, xp: 0.2 };
  const own = termsOf({ terms: { treasureShare: 0.75, xpShare: 1 } }, { shares });
  assert.deepEqual(own.shareFrom, { treasure: "record", xp: "record" }, "the record's own term wins over the import");
  assert.deepEqual(own.treasureShare, shareKind(0.75));
  assert.deepEqual(own.xpShare, shareKind(1));
  const read = termsOf({}, { shares });
  assert.deepEqual(read.shareFrom, { treasure: "imported", xp: "imported" });
  assert.deepEqual(read.treasureShare, shareKind(0.3));
  assert.deepEqual(read.xpShare, shareKind(0.2), "each share reads its own table");
  const mixed = termsOf({ terms: { xpShare: 0.4 } }, { shares: { treasure: 0.3 } });
  assert.deepEqual(mixed.shareFrom, { treasure: "imported", xp: "record" });
});
test("with no share set and none imported a share is null, never a default", () => {
  for (const [record, given] of [[{}, {}], [{ terms: { treasureShare: null, xpShare: null } }, { shares: { treasure: null, xp: null } }], [{ terms: { xpShare: "0.4" } }, { shares: { xp: Number.NaN } }]]) {
    const t = termsOf(record, given);
    assert.equal(t.treasureShare, null);
    assert.equal(t.xpShare, null);
    assert.deepEqual(t.shareFrom, { treasure: null, xp: null });
  }
  const one = termsOf({}, { shares: { xp: 0.2 } });
  assert.equal(one.treasureShare, null, "a share is missing alone");
  assert.deepEqual(one.xpShare, shareKind(0.2));
  assert.deepEqual(termsOf({ terms: { xpShare: 0 } }, {}).xpShare, shareKind(0), "zero is a figure the record may hold");
});
test("the arrears and signing bonus read as before", () => {
  const t = termsOf({ terms: { signingBonusGp: 50, arrearsGp: 7 } });
  assert.equal(t.signingBonus, 50);
  assert.equal(t.arrears, 7);
  assert.equal(termsOf({}).arrears, 0);
});
test("a signing bonus refused at hire reads as owed, apart from the arrears", () => {
  const owed = termsOf({ terms: { signingBonusGp: 40, signingBonusOwedGp: 40, arrearsGp: 3 } });
  assert.equal(owed.signingBonus, 40, "the agreed figure stays");
  assert.equal(owed.signingOwed, 40, "and what is owed of it is read beside it");
  assert.equal(owed.arrears, 3, "the wage arrears are not touched by it");
  assert.equal(termsOf({ terms: { signingBonusGp: 40, signingBonusOwedGp: 0 } }).signingOwed, 0, "a paid bonus owes nothing");
  assert.equal(termsOf({ terms: { signingBonusGp: 40 } }).signingOwed, 0, "a record from before the field owes nothing");
});

test("an owed bonus offers Pay to whoever may edit the hireling and Forgive to a GM alone", () => {
  const owed = termsOf({ terms: { signingBonusGp: 40, signingBonusOwedGp: 40 } });
  assert.deepEqual(signingControls(owed, { isOwner: true, isGM: false }), { pay: true, forgive: false }, "an owning player pays, never forgives");
  assert.deepEqual(signingControls(owed, { isOwner: true, isGM: true }), { pay: true, forgive: true }, "a GM may do either");
  assert.deepEqual(signingControls(owed, { isOwner: false, isGM: false }), { pay: false, forgive: false }, "an onlooker gets neither");
  const paid = termsOf({ terms: { signingBonusGp: 40, signingBonusOwedGp: 0, arrearsGp: 3 } });
  assert.deepEqual(signingControls(paid, { isOwner: true, isGM: true }), { pay: false, forgive: false }, "nothing owed: no control, arrears or not");
  assert.deepEqual(signingControls(null), { pay: false, forgive: false }, "no terms: no control");
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
test("hit points at hire: rolled from the classes feature's rebuild, or nothing in place of a missing class or missing dice", () => {
  const built = { max: 11, steps: [{ level: 1, formula: "1d5", total: 4 }, { level: 2, formula: "2d5", total: 7, extra: true }] };
  const rolled = hireHitPoints(true, built);
  assert.equal(rolled.hpRoll, 11, "the rebuilt maximum is recorded");
  assert.deepEqual(rolled.hpSteps, [{ level: 1, formula: "1d5", total: 4 }, { level: 2, formula: "2d5", total: 7 }], "each level's roll, in the record's shape");
  assert.equal(rolled.hpUnrolled, "");
  assert.deepEqual(hireHitPoints(false, built), { hpRoll: null, hpSteps: [], hpUnrolled: "noClass" }, "no class: nothing rolled, even with dice in hand");
  assert.deepEqual(hireHitPoints(true, null), { hpRoll: null, hpSteps: [], hpUnrolled: "noDice" }, "a class with no hit dice: nothing rolled");
});
test("recorded rolls carry the hit points, or why there are none", () => {
  const rolled = rolledOf({ rolled: { hpRoll: 9, hpSteps: [{ level: 1, formula: "1d5", total: 9 }] } });
  assert.equal(rolled.hpRoll, 9);
  assert.equal(rolled.hpSteps.length, 1);
  assert.equal(rolled.hpUnrolled, "");
  assert.equal(rolled.any, true, "a hit point roll alone shows the block");
  const unrolled = rolledOf({ rolled: { hpRoll: null, hpUnrolled: "noDice" } });
  assert.equal(unrolled.hpRoll, null);
  assert.equal(unrolled.hpUnrolled, "noDice");
  assert.equal(unrolled.any, true, "a reason alone shows the block, so the panel can say not imported");
  assert.equal(rolledOf({ rolled: { hpRoll: 5, hpUnrolled: "noClass" } }).hpUnrolled, "", "a roll outranks a stale reason");
  assert.equal(rolledOf({ rolled: { hpRoll: null, hpSteps: [{ level: 1, formula: "1d5", total: 3 }] } }).hpSteps.length, 0, "no steps without a total");
});
test("a class roll that left the class to the Judge: no class written, nothing rolled, and Pick class offered until one is bound", () => {
  assert.equal(JUDGE_PICK_CLASS, "special", "the key the class draws give");
  assert.equal(hiredClassName({ classKey: JUDGE_PICK_CLASS, occupation: "" }), "", "the hire binds no class");
  assert.equal(hiredClassName({ classKey: JUDGE_PICK_CLASS, occupation: "Invented trade" }), "", "nor an occupation in its place");
  assert.equal(hiredClassName({ classKey: "invented-class" }), "invented-class", "a rolled class is written");
  assert.equal(hiredClassName({ classKey: "", occupation: "Invented trade" }), "Invented trade", "a 0th-level hire keeps its occupation");
  assert.deepEqual(judgePickHitPoints(), { hpRoll: null, hpSteps: [], hpUnrolled: "judgePick" });
  const fresh = rolledOf({ rolled: { classKey: JUDGE_PICK_CLASS, level: 2, ...judgePickHitPoints() } });
  assert.equal(fresh.judgePick, true);
  assert.equal(fresh.hpUnrolled, "judgePick");
  const older = rolledOf({ rolled: { classKey: JUDGE_PICK_CLASS, level: 2, hpRoll: null, hpUnrolled: "noClass" } });
  assert.equal(older.hpUnrolled, "judgePick", "a hire recorded before reads the Judge's pick, not a missing import");
  assert.equal(rolledOf({ rolled: { classKey: "invented-class", hpRoll: null, hpUnrolled: "noClass" } }).hpUnrolled, "noClass", "a real missing class still says so");
  assert.equal(offersClassPick(fresh, "", { isGM: true }), true, "unbound, on a Judge's seat: offered");
  assert.equal(offersClassPick(older, JUDGE_PICK_CLASS, { isGM: true }), true, "an older hire's written key binds nothing: offered");
  assert.equal(offersClassPick(fresh, "", { isGM: false }), false, "never on a player's seat");
  assert.equal(offersClassPick(fresh, "Invented class", { isGM: true }), false, "a class bound: not offered");
  assert.equal(offersClassPick(rolledOf({ rolled: { classKey: "invented-class" } }), "", { isGM: true }), false, "a rolled class: not offered");
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
