/**
 * Dividing adventure XP (RR ch. 6): full shares, henchman shares, and the
 * people and things that get nothing.
 */
import assert from "node:assert/strict";
import { divideXp, shareFor, SHARE_REASON, UNSHARED_BASES } from "../scripts/formation/xp-shares.mjs";
import * as tables from "../scripts/lib/tables.mjs";

/* A henchman's share is the record's own figure, else the imported table's,
 * else none. The imported figure here is invented, as are the records'. */
globalThis.acksExtras = { lib: { tables } };
const IMPORTED = 0.3;
const importShare = () => {
  tables.resetTables();
  tables.registerTable({ id: "wages", source: { pages: "T 1" }, cites: { xpShare: "T 2" }, tables: { xpShare: { share: IMPORTED } } }, { priority: tables.PRIORITY.WORLD });
};
importShare();

/* Minimal actor doubles — the module only ever asks for these fields. */
const pc = (name, share = 100, extra = {}) => ({
  name, type: "character", system: { details: { xp: { share } } },
  getFlag: () => null, ...extra,
});
const hireling = (name, terms) => ({
  name, type: "character", system: { details: { xp: { share: 100 } } },
  getFlag: (_m, k) => (k === "record" ? { terms } : null),
});
const beast = (name, type = "monster") => ({ name, type, getFlag: () => null });

/* --- who takes what ------------------------------------------------------ */
/* The system stores a full share as 100; everything here is fractions of one. */
assert.equal(shareFor(pc("Leader")).share, 1, "a sheet's 100 is one full share");
assert.equal(shareFor(pc("Halved", 50)).share, 0.5, "and 50 is half of one");
assert.equal(shareFor(pc("Leader")).reason, SHARE_REASON.full);

assert.equal(shareFor(hireling("Squire", { xpShare: 0.4, wageBasis: "level" })).share, 0.4,
  "a henchman takes the share their terms set");
assert.equal(shareFor(hireling("Squire", { xpShare: 0.4, wageBasis: "level" })).reason, SHARE_REASON.henchman);

/* a hireling's own terms win over the default */
assert.equal(shareFor(hireling("Favoured", { xpShare: 0.75, wageBasis: "level" })).share, 0.75);
/* an absent xpShare reads the imported one, and says so */
assert.deepEqual(shareFor(hireling("Vague", { wageBasis: "level" })), { share: IMPORTED, reason: SHARE_REASON.henchman, from: "imported" });
assert.deepEqual(shareFor(hireling("Vague", { xpShare: null, wageBasis: "level" })), { share: IMPORTED, reason: SHARE_REASON.henchman, from: "imported" },
  "a record holding null defers to the import");
assert.equal(shareFor(hireling("Squire", { xpShare: 0.4, wageBasis: "level" })).from, "record");
assert.equal(shareFor(hireling("Squire", { xpShare: 0.4, wageBasis: "level" })).share, 0.4, "the record's own figure wins over the import");
assert.deepEqual(shareFor(hireling("Barred", { xpShare: 0, wageBasis: "level" })), { share: 0, reason: SHARE_REASON.noShare },
  "a record's zero is its own share, not a missing one");

/* with nothing imported: a record's own figure still answers, an absent one is not imported */
tables.resetTables();
assert.equal(shareFor(hireling("Squire", { xpShare: 0.4, wageBasis: "level" })).share, 0.4);
for (const terms of [{ wageBasis: "level" }, { xpShare: null, wageBasis: "level" }, { xpShare: "x", wageBasis: "level" }]) {
  assert.deepEqual(shareFor(hireling("Vague", terms)), { share: 0, reason: SHARE_REASON.notImported },
    `${JSON.stringify(terms)}: no computed share, and it says not imported`);
}
{
  const d0 = divideXp([pc("Leader"), hireling("Vague", { wageBasis: "level" })], 1000);
  assert.deepEqual(d0.rows.map((r) => [r.name, r.xp]), [["Leader", 1000]], "the unimported henchman is paid nothing");
  assert.deepEqual(d0.excluded.map((r) => [r.name, r.reason]), [["Vague", SHARE_REASON.notImported]], "and is listed as not imported");
}
importShare();

/* --- mercenaries and specialists are paid in coin, not experience -------- */
for (const basis of UNSHARED_BASES) {
  const r = shareFor(hireling("Hired sword", { xpShare: 0.4, wageBasis: basis }));
  assert.equal(r.share, 0, `${basis} takes no share`);
  assert.equal(r.reason, SHARE_REASON.mercenary);
}

/* --- the sheet's hireling category decides while they serve -------------- */
/* A hireling enrolled on the system sheet carries a category and no record;
 * the wage engine's adoption later gives it a record with no wage basis. */
const enrolled = (name, category, terms = null) => ({
  name, type: "character",
  system: { details: { xp: { share: 100 } }, retainer: { enabled: true, category } },
  getFlag: (_m, k) => (k === "record" && terms ? { terms } : null),
});
for (const category of ["mercenary", "specialist"]) {
  for (const terms of [null, {}, { wageBasis: "level" }]) {
    const r = shareFor(enrolled("Hand-enrolled", category, terms));
    assert.equal(r.share, 0, `a ${category} by the sheet takes no share (record ${JSON.stringify(terms)})`);
    assert.equal(r.reason, SHARE_REASON.mercenary);
  }
}
assert.deepEqual(shareFor(enrolled("Sworn", "henchman")), { share: IMPORTED, reason: SHARE_REASON.henchman, from: "imported" },
  "a henchman by the sheet with no record yet takes the imported henchman's share, not a full one");
tables.resetTables();
assert.deepEqual(shareFor(enrolled("Sworn", "henchman")), { share: 0, reason: SHARE_REASON.notImported },
  "and with nothing imported, none");
importShare();
assert.equal(shareFor(enrolled("Sworn", "henchman", { xpShare: 0.4 })).share, 0.4);

/* out of service, the record answers from how they were paid */
const dismissed = (terms) => ({
  name: "Dismissed", type: "character",
  system: { details: { xp: { share: 100 } }, retainer: { enabled: false, category: "henchman" } },
  getFlag: (_m, k) => (k === "record" ? { terms } : null),
});
assert.equal(shareFor(dismissed({ wageBasis: "mercenary" })).reason, SHARE_REASON.mercenary);
assert.equal(shareFor(dismissed({})).reason, SHARE_REASON.henchman);

/* --- an NPC's experience is not tracked --------------------------------- */
assert.deepEqual(shareFor(pc("Innkeeper", 100, { hasPlayerOwner: false })), { share: 0, reason: SHARE_REASON.npc },
  "a character no player owns and nobody hired takes no share");
assert.equal(shareFor(pc("Owned", 100, { hasPlayerOwner: true })).share, 1);

/* --- things that are not people ----------------------------------------- */
assert.equal(shareFor(beast("Wagon", "acks-extras.vehicle")).reason, SHARE_REASON.notAPerson);
assert.equal(shareFor(beast("Mule", "acks-extras.animal")).share, 0);
assert.equal(shareFor(beast("Summoned Bear")).share, 0, "a monster with no hireling record is not a member");
assert.equal(shareFor(null).share, 0);

/* a monster WITH a record is a monster henchman, and does share */
const bear = { name: "Bound Bear", type: "monster", getFlag: (_m, k) => (k === "record" ? { terms: { xpShare: 0.4, wageBasis: "hd" } } : null) };
assert.equal(shareFor(bear).share, 0.4, "a monster henchman shares like any other");

/* --- the division ------------------------------------------------------- */
const party = [
  pc("Leader"), pc("Second"),
  hireling("Squire", { xpShare: 0.4, wageBasis: "level" }),
  hireling("Mercs", { xpShare: 0.4, wageBasis: "mercenary" }),
  beast("Baggage Wagon", "acks-extras.vehicle"),
];
let d = divideXp(party, 4800);
assert.equal(d.shares, 2.4, "two full shares and one partial");
assert.equal(d.perShare, 2000);
assert.deepEqual(d.rows.map((r) => [r.name, r.xp]), [["Leader", 2000], ["Second", 2000], ["Squire", 800]]);
assert.equal(d.awarded, 4800);
assert.deepEqual(d.excluded.map((r) => r.name), ["Mercs", "Baggage Wagon"],
  "and it says who was left out");

/* a henchman with no share of their own divides on the imported one */
d = divideXp([pc("Leader"), hireling("Vague", { wageBasis: "level" })], 1300);
assert.deepEqual(d.rows.map((r) => [r.name, r.xp, r.from]), [["Leader", 1000, undefined], ["Vague", 300, "imported"]]);

/* --- the dead still count ------------------------------------------------ */
const fallen = pc("Vitellia");
d = divideXp([pc("Leader"), fallen], 1000);
assert.equal(d.rows.length, 2, "a character who died on the way out still returned");
assert.equal(d.rows[1].xp, 500);

/* --- a sheet's own share multiplier is respected ------------------------- */
d = divideXp([pc("Leader"), pc("Halfling", 50)], 3000);
assert.equal(d.shares, 1.5);
assert.equal(d.rows[0].xp, 2000);
assert.equal(d.rows[1].xp, 1000);

/* --- rounding is DOWN, per character ------------------------------------ */
d = divideXp([pc("A"), pc("B"), pc("C")], 100);
assert.deepEqual(d.rows.map((r) => r.xp), [33, 33, 33]);
assert.equal(d.awarded, 99, "the remainder is the Judge's rounding, not a debt");

/* --- nobody to pay ------------------------------------------------------- */
d = divideXp([beast("Cart", "acks-extras.vehicle")], 5000);
assert.equal(d.shares, 0);
assert.equal(d.rows.length, 0);
assert.equal(d.excluded.length, 1, "and the reason is still reported");

/* --- nothing to give ----------------------------------------------------- */
d = divideXp([pc("Leader")], 0);
assert.equal(d.rows[0].xp, 0);
assert.equal(divideXp([pc("Leader")], -100).rows[0].xp, 0, "a negative award is no award");

console.log("test-xp-shares: OK (full, own terms, imported share, not imported, mercenaries, sheet category, non-persons, dead, rounding)");
