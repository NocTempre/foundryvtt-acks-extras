/**
 * Dividing adventure XP (RR ch. 6): full shares, henchman halves, and the
 * people and things that get nothing.
 */
import assert from "node:assert/strict";
import { divideXp, shareFor, SHARE_REASON, UNSHARED_BASES } from "../scripts/formation/xp-shares.mjs";

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
assert.equal(shareFor(pc("Sera")).share, 1, "a sheet's 100 is one full share");
assert.equal(shareFor(pc("Halved", 50)).share, 0.5, "and 50 is half of one");
assert.equal(shareFor(pc("Sera")).reason, SHARE_REASON.full);

assert.equal(shareFor(hireling("Jonus", { xpShare: 0.5, wageBasis: "level" })).share, 0.5,
  "a henchman takes half a share");
assert.equal(shareFor(hireling("Jonus", { xpShare: 0.5, wageBasis: "level" })).reason, SHARE_REASON.henchman);

/* a hireling's own terms win over the default */
assert.equal(shareFor(hireling("Favoured", { xpShare: 0.75, wageBasis: "level" })).share, 0.75);
/* an absent xpShare falls back to the book's half */
assert.equal(shareFor(hireling("Vague", { wageBasis: "level" })).share, 0.5);

/* --- mercenaries and specialists are paid in coin, not experience -------- */
for (const basis of UNSHARED_BASES) {
  const r = shareFor(hireling("Hired sword", { xpShare: 0.5, wageBasis: basis }));
  assert.equal(r.share, 0, `${basis} takes no share`);
  assert.equal(r.reason, SHARE_REASON.mercenary);
}

/* --- things that are not people ----------------------------------------- */
assert.equal(shareFor(beast("Wagon", "acks-extras.vehicle")).reason, SHARE_REASON.notAPerson);
assert.equal(shareFor(beast("Mule", "acks-extras.animal")).share, 0);
assert.equal(shareFor(beast("Summoned Bear")).share, 0, "a monster with no hireling record is not a member");
assert.equal(shareFor(null).share, 0);

/* a monster WITH a record is a monster henchman, and does share */
const bear = { name: "Bound Bear", type: "monster", getFlag: (_m, k) => (k === "record" ? { terms: { xpShare: 0.5, wageBasis: "hd" } } : null) };
assert.equal(shareFor(bear).share, 0.5, "a monster henchman shares like any other");

/* --- the division ------------------------------------------------------- */
const party = [
  pc("Sera"), pc("Theon"),
  hireling("Jonus", { xpShare: 0.5, wageBasis: "level" }),
  hireling("Mercs", { xpShare: 0.5, wageBasis: "mercenary" }),
  beast("Baggage Wagon", "acks-extras.vehicle"),
];
let d = divideXp(party, 5000);
assert.equal(d.shares, 2.5, "two full shares and one half");
assert.equal(d.perShare, 2000);
assert.deepEqual(d.rows.map((r) => [r.name, r.xp]), [["Sera", 2000], ["Theon", 2000], ["Jonus", 1000]]);
assert.equal(d.awarded, 5000);
assert.deepEqual(d.excluded.map((r) => r.name), ["Mercs", "Baggage Wagon"],
  "and it says who was left out");

/* --- the dead still count ------------------------------------------------ */
const fallen = pc("Vitellia");
d = divideXp([pc("Sera"), fallen], 1000);
assert.equal(d.rows.length, 2, "a character who died on the way out still returned");
assert.equal(d.rows[1].xp, 500);

/* --- a sheet's own share multiplier is respected ------------------------- */
d = divideXp([pc("Sera"), pc("Halfling", 50)], 3000);
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
d = divideXp([pc("Sera")], 0);
assert.equal(d.rows[0].xp, 0);
assert.equal(divideXp([pc("Sera")], -100).rows[0].xp, 0, "a negative award is no award");

console.log("test-xp-shares: OK (full, half, own terms, mercenaries, non-persons, dead, rounding)");
