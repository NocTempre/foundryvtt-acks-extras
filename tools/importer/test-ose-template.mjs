/**
 * Creatures the book stats across a range become generators.
 *
 * The failure this guards is silent by construction: read as a single block, a
 * "HD 3 to 8" creature imports as a valid-looking three-hit-dice monster and
 * the other five steps leave no trace. Nothing downstream can notice, so the
 * checks are here.
 *
 * Numbers are invented; only the SHAPES come from real books.
 */
import { parseOseStatline } from "../../scripts/importer/ose-statline.mjs";
import { isRangedCreature, bonusSteps, oseTemplateDataFromFields, oseTemplateFromGroup, TEMPLATE_TYPE } from "../../scripts/importer/ose-template.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

const K = { acDescending: 9, acAscending: 10, attackThrow: 11, saveThrow: 20 };
const BOUNDS = { min: -6, max: 4 };
const RANGED =
  "AC 2 [17], HD 3** to 8** (13/18/22/27/31 /36hp), Att 1 x bite (3d6), THAC0 By HD (17 [+2] to 12 [+7]), MV 120 (40), SV D12 W13 P14 B15 S16, ML 9, AL Neutral";
const SINGLE = "AC 6 [13], HD 4 (18hp), Att 1 x fist (1d6), THAC0 16 [+3], MV 120 (40), SV D10 W11 P12 B13 S14, ML 8, AL Neutral";

/* --- what counts as a range ---------------------------------------------- */

ok("a printed range is a range", isRangedCreature(parseOseStatline(RANGED).fields));
ok("one creature is not", !isRangedCreature(parseOseStatline(SINGLE).fields));
ok("and neither is an empty parse", !isRangedCreature({}));

/* --- the arithmetic refuses when it cannot prove itself ------------------- */

check("an evenly divided range fills in", bonusSteps({ ascendingBonus: 2, ascendingBonusMax: 7 }, 3, 8), [2, 3, 4, 5, 6, 7]);
ok("an uneven one refuses", bonusSteps({ ascendingBonus: 2, ascendingBonusMax: 6 }, 3, 8) === null);
ok("and so does a range with only one end printed", bonusSteps({ ascendingBonus: 2 }, 3, 8) === null);

/* --- the generator itself ------------------------------------------------- */

{
  const t = oseTemplateDataFromFields({
    name: "Testbeast",
    fields: parseOseStatline(RANGED).fields,
    constants: K,
    moraleBounds: BOUNDS,
  });
  check("it is a generator, not a creature", t.type, TEMPLATE_TYPE);
  check("one option per printed step", t.system.axes[0].options.length, 6);
  check("the axis is the thing that varies", t.system.axes[0].key, "hd");

  const [first, last] = [t.system.axes[0].options[0], t.system.axes[0].options[5]];
  check("each step takes the hit points printed for it", first.merge.hp.value, 13);
  check("including the last", last.merge.hp.value, 36);
  check("and rolls the dice its own step names", last.merge.hp.hd, "8d8");
  check("the throw at the bottom of the range", first.merge.thac0.throw, K.attackThrow - 2);
  check("and at the top", last.merge.thac0.throw, K.attackThrow - 7);

  // The base must not carry the weakest step's figures, or every generated
  // creature inherits them underneath its own.
  ok("hit points are not on the fixed base", t.system.base.merge.hp === undefined);
  ok("nor is the attack throw", t.system.base.merge.thac0 === undefined);
  ok("but what does not vary is", t.system.base.merge.aac !== undefined, JSON.stringify(t.system.base.merge));
  check("morale still maps through the endpoints", t.system.base.merge.details.morale, 9 - 8);
}

{
  // Without the guide the throw is a gap, exactly as for a single creature —
  // the range must not become a reason to invent one.
  const t = oseTemplateDataFromFields({ name: "T", fields: parseOseStatline(RANGED).fields, constants: null, moraleBounds: BOUNDS });
  ok("no guide, no throws", t.system.axes[0].options.every((o) => o.merge.thac0 === undefined));
  ok("but the hit points still arrive", t.system.axes[0].options[0].merge.hp.value === 13);
  ok("and the actor says it is unconverted", t.flags["acks-extras"].ose.unconverted === true);
}

{
  // A rate rather than a list: "HD 5 to 12 (8hp per HD)".
  const t = oseTemplateDataFromFields({
    name: "T",
    fields: parseOseStatline("AC 5 [14], HD 5 to 12 (8hp per HD), Att 1 x bite (1d10), THAC0 By HD (15 [+4] to 10 [+9]), ML 9").fields,
    constants: K,
    moraleBounds: BOUNDS,
  });
  check("a per-die rate gives every step its own total", t.system.axes[0].options.map((o) => o.merge.hp.value), [40, 48, 56, 64, 72, 80, 88, 96]);
}

{
  // An uneven range keeps its hit points and reports the throw as a gap rather
  // than drawing a straight line through figures the book did not print.
  const t = oseTemplateDataFromFields({
    name: "T",
    fields: parseOseStatline("AC 5 [14], HD 3 to 8 (13/18/22/27/31/36hp), Att 1 x bite (1d6), THAC0 By HD (17 [+2] to 12 [+6]), ML 9").fields,
    constants: K,
    moraleBounds: BOUNDS,
  });
  ok("an uneven range grants no throws", t.system.axes[0].options.every((o) => o.merge.thac0 === undefined));
  ok("and says why", t.flags["acks-extras"].ose.gaps.some((g) => g.reason === "range-does-not-divide-evenly"));
}

/* --- several entries, one creature ---------------------------------------- */

{
  const step = (n, label, ac, hp) => ({
    key: String(n),
    label,
    fields: parseOseStatline(`Level ${n} AC ${ac} HP ${n}d6 (${hp}) Saves D12 R13 H14 B15 S16 Att Weapon (+${n}) ML 8`).fields,
    raw: "",
    page: 1,
    entryId: `x.level${n}`,
  });
  const t = oseTemplateFromGroup({
    name: "Testclass",
    members: [step(1, "Level 1 (Novice)", 12, 3), step(3, "Level 3 (Adept)", 14, 10), step(5, "Level 5 (Master)", 15, 17)],
    constants: K,
    moraleBounds: BOUNDS,
    lineage: "ose",
  });
  check("three printed blocks make one generator", t.system.axes[0].options.length, 3);
  check("named for what varies", t.system.axes[0].key, "level");
  check("each option is a complete creature", t.system.axes[0].options[2].merge.hp.value, 17);
  ok("and nothing sits on the base to leak between them", Object.keys(t.system.base.merge).length === 0);
  ok("the members are recorded for audit", t.flags["acks-extras"].ose.group.members.length === 3);
}

if (failed) {
  console.error(`\nose-template: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-template: OK");
