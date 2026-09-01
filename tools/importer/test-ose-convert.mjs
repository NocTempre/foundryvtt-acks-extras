/**
 * OSE -> ACKS conversion tests.
 *
 * The constants are supplied BY THE TEST, never imported from the module —
 * that is the whole arrangement under test. The stat blocks are invented; only
 * their shapes come from real books.
 */
import { parseOseStatline, resolveProfile, DOLMENWOOD } from "../../scripts/importer/ose-statline.mjs";
import { convertOse, moraleOffset, LINEAGES } from "../../scripts/importer/ose-convert.mjs";
import { reconversionFor } from "../../scripts/importer/ose-binding.mjs";

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

// Stand-ins for what the reader's own guide would yield. The module must never
// contain these; a build that lets one in fails the register lint instead.
const K = { acDescending: 9, acAscending: 10, attackThrow: 11, saveThrow: 20 };
const BOUNDS = { min: -6, max: 4 };
const run = (text, constants = K, opts = {}) =>
  convertOse(parseOseStatline(text, resolveProfile(opts.profile)).fields, constants, {
    lineage: "ose",
    moraleBounds: BOUNDS,
    ...opts,
  });
const gapFor = (r, axis) => r.gaps.find((g) => g.axis === axis);

/* --- morale: the endpoints anchor the map -------------------------------- */

check("offset is derived, not chosen", moraleOffset(BOUNDS), 8);
ok("mismatched scale widths refuse a mapping", moraleOffset({ min: -3, max: 3 }) === null);
ok("absent bounds refuse a mapping", moraleOffset(undefined) === null);

for (const [ose, acks] of [
  [2, -6],
  [8, 0],
  [12, 4],
]) {
  check(`morale anchor ${ose}`, run(`AC 5 [14], ML ${ose}`).system.details.morale, acks);
}
// Middling values must land inside the band rather than at its edge — the
// signature of a clamp is that everything above the midpoint reads as the max.
check("morale mid-low", run("AC 5 [14], ML 5").system.details.morale, -3);
check("morale mid-high", run("AC 5 [14], ML 11").system.details.morale, 3);

// A score off the 2d6 scale is a mis-read, not a value to squeeze into range.
const offScale = run("AC 5 [14], ML 15");
ok("off-scale morale is not written", offScale.system.details?.morale === undefined);
check("off-scale morale gaps", gapFor(offScale, "morale").reason, "out-of-scale");

const noBounds = run("AC 5 [14], ML 7", K, { moraleBounds: null });
ok("no bounds means no morale", noBounds.system.details?.morale === undefined);
check("no bounds gaps", gapFor(noBounds, "morale").reason, "no-bounds");

/* --- armour class: two routes that must agree ---------------------------- */

check("ac from both progressions", run("AC 3 [16], HD 1").system.aac, { value: 6 });
check("ac unarmoured", run("AC 9 [10], HD 1").system.aac, { value: 0 });
check("ac negative descending", run("AC -4 [23], HD 1").system.aac, { value: 13 });
check("ac descending only", run("AC 3, HD 1").system.aac, { value: 6 });

// A sheared extraction disagrees with itself; that must produce nothing.
const shear = run("AC 3 [19], HD 1");
ok("disagreement writes no armour class", shear.system.aac === undefined);
check("disagreement gaps", gapFor(shear, "ac").reason, "progressions-disagree");

/* --- attack throw -------------------------------------------------------- */

check("attack throw from the bracket", run("AC 5 [14], THAC0 18 [+1]").system.thac0, { throw: 10 });
check("attack throw of a normal man", run("AC 9 [10], THAC0 19 [0]").system.thac0, { throw: 11 });

// Without the bracket the guide prints no rule, and OSE's own identity is not
// one this importer may apply.
const bareThac0 = run("AC 5 [14], THAC0 18");
ok("bare THAC0 writes nothing", bareThac0.system.thac0 === undefined);
check("bare THAC0 gaps", gapFor(bareThac0, "thac0").reason, "no-attack-bonus-printed");

/* --- Stage A: no guide connected ----------------------------------------- */

const stageA = run("AC 3 [16], HD 2 (9hp), THAC0 18 [+1], MV 120 (40), SV D11 W12 P10 B14 S13 (2), ML 7, AL Lawful", null);
ok("stage A writes no armour class", stageA.system.aac === undefined);
ok("stage A writes no attack throw", stageA.system.thac0 === undefined);
check("stage A ac gap", gapFor(stageA, "ac").reason, "needs-guide");
check("stage A thac0 gap", gapFor(stageA, "thac0").reason, "needs-guide");
// Everything that needs no arithmetic still lands.
check("stage A keeps hit points", stageA.system.hp.value, 9);
check("stage A keeps saves", stageA.system.saves.death.value, 11);
check("stage A keeps morale", stageA.system.details.morale, -1);
check("stage A keeps movement", stageA.system.movement.base, 120);

/* --- movement: OSE prints exploration first ------------------------------ */

const mv = run("AC 5 [14], MV 120 (40)");
check("base is the exploration rate", mv.system.movement.base, 120);
check("speed row keeps both rates", mv.extras.speeds, [{ type: "land", combat: 40, run: 120, hover: false }]);

const flyer = run("AC 5 [14], MV 120' (40') / 180' (60') flying");
check("second mode is typed", flyer.extras.speeds.map((s) => s.type), ["land", "fly"]);
check("base comes from the land row", flyer.system.movement.base, 120);

/* --- saves --------------------------------------------------------------- */

const saves = run("AC 5 [14], SV D11 W12 P10 B14 S13 (3)").system.saves;
check("save letters map one to one", saves, {
  death: { value: 11 },
  implements: { value: 12 },
  paralysis: { value: 10 },
  blast: { value: 14 },
  spell: { value: 13 },
});
ok("legacy save keys are never written", saves.wand === undefined && saves.breath === undefined);

// One printed save is one statement; four more must not be invented.
const single = run("AC 5 [14], SV 12, ML 6", K, { profile: { base: "ose.demo", saveForm: "single" } });
ok("single save writes no save row", single.system.saves === undefined);
check("single save gaps", gapFor(single, "saves").reason, "single-save-printed");

/* --- save-as class ------------------------------------------------------- */

check("race-as-class dwarf", run("AC 5 [14], SV D9 W10 P8 B12 S11 (Dwarf 3)").extras.saveAs, {
  class: "dwarvenVaultguard",
  level: 3,
});
check("race-as-class elf", run("AC 5 [14], SV D9 W10 P8 B12 S11 (Elf 2)").extras.saveAs.class, "elvenSpellsword");
check("magic-user is a mage", run("AC 5 [14], SV D9 W10 P8 B12 S11 (Magic-user 4)").extras.saveAs.class, "mage");
check("cleric is a crusader", run("AC 5 [14], SV D9 W10 P8 B12 S11 (Cleric 4)").extras.saveAs.class, "crusader");
// A hyphen left mid-word by extraction must not lose the class.
check("hyphenated token still resolves", run("AC 5 [14], SV D9 W10 P8 B12 S11 (Mag-ic-user 4)").extras.saveAs.class, "mage");
// A class ACKS does not have is a gap, not a nearest guess.
const halfling = run("AC 5 [14], SV D9 W10 P8 B12 S11 (Halfling 2)");
ok("unknown class is not guessed", halfling.extras.saveAs?.class === undefined);
check("unknown class gaps", gapFor(halfling, "saveAsClass").reason, "no-acks-equivalent");
check("its level is still kept", halfling.extras.saveAs.level, 2);

/* --- hit dice ------------------------------------------------------------ */

check("hd rating", run("AC 5 [14], HD 3+2* (16hp)").extras.hd, { count: 3, bonus: 2, asterisks: 1 });
check("hd roll formula", run("AC 5 [14], HD 3+2* (16hp)").system.hp.hd, "3d8+2");
check("hd negative bonus", run("AC 5 [14], HD 2-1 (7hp)").system.hp.hd, "2d8-1");
// Both systems drop a sub-1 hit-die monster to a d4.
check("half hit die rolls d4", run("AC 5 [14], HD 1/2 (2hp)").system.hp.hd, "1d4");
check("half hit die rating", run("AC 5 [14], HD 1/2 (2hp)").extras.hd.count, 0.5);

/* --- axes that do not convert -------------------------------------------- */

const unconverted = run("AC 5 [14], HD 1 (4hp), ML 6, AL Neutral, XP 29, TT Q");
ok("experience is not written", unconverted.system.details.xp === undefined);
check("experience gaps", gapFor(unconverted, "xp").printed, 29);
check("treasure gaps", gapFor(unconverted, "treasure").printed, "Q");

/* --- alignment ----------------------------------------------------------- */

check("alignment word", run("AC 5 [14], AL Chaotic").system.details.alignment, "Chaotic");
check("alignment initial", run("AC 5 [14], AL L").system.details.alignment, "Lawful");
const anyAl = run("AC 5 [14], AL Any");
ok("a non-alignment is not written", anyAl.system.details?.alignment === undefined);
check("non-alignment gaps", gapFor(anyAl, "alignment").reason, "not-an-acks-alignment");

/* --- number appearing ---------------------------------------------------- */

const na = run("AC 5 [14], NA 1d6 (2d8)");
check("wandering is the dungeon appearance", na.system.details.appearing.d, "1d6");
check("lair count is kept", na.extras.encounter.dungeon.lair.number, "2d8");
ok("wilderness is left unset", na.system.details.appearing.w === undefined);

/* --- attacks become items ------------------------------------------------ */

const items = run("AC 5 [14], Att 2 × claw (1d4) or 1 × bite (1d8)").items;
check("one item per mode", items.map((i) => i.name), ["Claw", "Bite"]);
check("damage carries over", items.map((i) => i.system.damage), ["1d4", "1d8"]);

/* --- lineage ------------------------------------------------------------- */

ok("the B-X family is known", ["ose", "bx", "becmi", "ll", "lotfp"].every((k) => LINEAGES[k]));
const alien = run("AC 5 [14], HD 1", K, { lineage: "shadowdark" });
check("an unsupported lineage converts nothing", alien.system, {});
check("and says why", gapFor(alien, "lineage").reason, "unsupported-lineage");

/* --- nothing read is dropped --------------------------------------------- */

const full = "AC 3 [16], HD 2** (7hp), Att 1 × bite (1d6), THAC0 18 [+1], MV 150 (50), SV D11 W12 P10 B14 S13 (Magic-user 2), ML 6, AL Chaotic, XP 47, NA 1d4 (2d6), TT R";
const parsedFull = parseOseStatline(full).fields;
const converted = convertOse(parsedFull, K, { lineage: "ose", moraleBounds: BOUNDS });
const reached = new Set([...converted.conversions.map((c) => c.axis), ...converted.gaps.map((g) => g.axis)]);
const EXPECTED = ["ac", "hd", "hp", "thac0", "mv", "saves", "saveAs", "morale", "alignment", "appearing", "xp", "treasure"];
for (const axis of EXPECTED) ok(`axis "${axis}" reaches a destination`, reached.has(axis), [...reached].join(","));

// Every conversion records how it was reached, so the sheet can show it.
ok(
  "every conversion carries a route and a rule",
  converted.conversions.every((c) => c.route && c.rule),
  JSON.stringify(converted.conversions.filter((c) => !c.route || !c.rule)),
);

/* --- the second pass is a no-op ------------------------------------------ */

// Stage B fills the axes that needed the guide. Running it again must find
// nothing: a pass that keeps producing updates would overwrite whatever the
// Judge corrected by hand after the first one.
{
  const parsed = parseOseStatline("AC 3 [16], HD 2 (9hp), THAC0 18 [+1], ML 6, AL Neutral").fields;
  const stageA = convertOse(parsed, null, { lineage: "ose", moraleBounds: BOUNDS });
  const rec = { parsed, lineage: "ose", gaps: stageA.gaps, unconverted: true, constants: null };
  const actor = { flags: { "acks-extras": { ose: rec } } };

  const first = reconversionFor(actor, K, BOUNDS);
  ok("stage B fills the armour class", first?.["system.aac.value"] === 6, JSON.stringify(first));
  ok("stage B fills the attack throw", first?.["system.thac0.throw"] === 10, JSON.stringify(first));

  const done = { flags: { "acks-extras": { ose: { ...rec, unconverted: false, constants: K } } } };
  ok("a second pass does nothing", reconversionFor(done, K, BOUNDS) === null);

  // A different printing could carry different constants, and that IS worth
  // re-reading — so the guard compares values, not merely presence.
  const other = { ...K, acDescending: K.acDescending + 1 };
  ok("different constants re-convert", reconversionFor(done, other, BOUNDS) !== null);

  ok("no constants means no update", reconversionFor(actor, null, BOUNDS) === null);
  ok("a hand-built actor is untouched", reconversionFor({ flags: {} }, K, BOUNDS) === null);
}

/* --- never throws -------------------------------------------------------- */

for (const bad of [null, undefined, {}, { ac: {} }, { hd: {} }, { sv: {} }, { att: {} }, { mv: [] }]) {
  try {
    convertOse(bad, K, { lineage: "ose", moraleBounds: BOUNDS });
  } catch (e) {
    console.error(`FAIL convertOse threw on ${JSON.stringify(bad)} — ${e.message}`);
    failed++;
  }
}
try {
  convertOse(parsedFull, null, {});
} catch (e) {
  console.error(`FAIL convertOse threw with no options — ${e.message}`);
  failed++;
}

/* --- rules the corpus asked for ------------------------------------------ */

// An incomplete save row must not become some saving throws and some defaults.
{
  const partial = run("AC 5 [14], SV D12 B15 S16, ML 8");
  ok("no save row is written", partial.system.saves === undefined, JSON.stringify(partial.system.saves));
  check("and it says why", gapFor(partial, "saves").reason, "incomplete-save-row");
}

// The alternate letters convert exactly like the usual ones — they are the same
// five categories under other names, so the ACKS values must be identical.
{
  const alt = run("AC 5 [14], SV D11 R12 H10 B14 S13 (3)").system.saves;
  const std = run("AC 5 [14], SV D11 W12 P10 B14 S13 (3)").system.saves;
  check("both letter sets give the same saves", alt, std);
}

// A level printed as its own field fills the same slot as one inside the save
// clause — but never overrides it, since that one is the more specific.
{
  const own = run("AC 5 [14], HD 3, Level 2, ML 8");
  check("a printed level reaches saves-as", own.extras.saveAs.level, 2);
  const both = run("AC 5 [14], SV D11 W12 P10 B14 S13 (5), Level 2");
  check("the save clause wins where both print", both.extras.saveAs.level, 5);
}

/* --- Dolmenwood: the same printed number, the opposite meaning ------------ */

// A lone "AC 12" is descending in OSE and ascending in Dolmenwood. Reading it
// with the wrong lineage is silent — both produce a plausible armour class —
// so the two routes are asserted against each other rather than in isolation.
{
  const line = "Level 2 AC 12 HP 2d8 (9) Saves D12 R13 H14 B15 S16 Att 2 hooves (+1, 1d4) Speed 80 Morale 7 XP 35";
  const dw = convertOse(parseOseStatline(line, DOLMENWOOD).fields, K, { lineage: "dolmenwood", moraleBounds: BOUNDS });
  const os = convertOse(parseOseStatline(line, DOLMENWOOD).fields, K, { lineage: "ose", moraleBounds: BOUNDS });
  check("a bare ac converts by the ASCENDING route under Dolmenwood", dw.system.aac, { value: 12 - K.acAscending });
  check("and by the descending route under OSE", os.system.aac, { value: K.acDescending - 12 });
  ok("which are not the same answer", dw.system.aac.value !== os.system.aac.value);

  check("the attack bonus printed inside the attack reaches the throw", dw.system.thac0, { throw: K.attackThrow - 1 });
  check("morale still maps through the endpoints", dw.system.details.morale, 7 - 8);
  check("the speed label lands on the base movement", dw.system.movement.base, 80);
  // The die is transcribed, never assumed: "HP 1d4" must not be rolled on a d8
  // because the derived formula says one hit die means d8.
  {
    const small = convertOse(parseOseStatline("Level 1 AC 12 HP 1d4 (2) Saves D12 R13 H14 B15 S16 Morale 7", DOLMENWOOD).fields, K, { lineage: "dolmenwood", moraleBounds: BOUNDS });
    check("the printed hit die beats the derived one", small.system.hp.hd, "1d4");
    check("and the printed hit points come with it", small.system.hp.value, 2);
  }

  ok("an unsupported lineage still refuses outright", convertOse({}, K, { lineage: "nonesuch" }).gaps.some((g) => g.axis === "lineage"));
}

if (failed) {
  console.error(`\nose-convert: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-convert: OK");
