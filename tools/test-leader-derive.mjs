/**
 * The AXIOMS leader procedure (scripts/monsters/leader-derive.mjs) and the
 * family pass that offers its leaders beside the printed ones
 * (`derivedLeaderRoles` in scripts/importer/leader-roles.mjs): rungs read,
 * a warrior placed on its rung, a rank moved down, the bonus carried or
 * doubled, AC and damage added, nothing derived from part of a procedure or
 * off the ladder, the leader-source axis chosen before the role, a printed
 * leader standing under the default, and hit points rolled from the rating.
 *
 * The ladder, the steps and every figure are invented: an odd ladder and
 * step counts no page prints, so a result can only come from what is passed
 * in. The page's own procedure is the live recipe's (docs/monsters/TESTING.md).
 */
import assert from "node:assert/strict";
import {
  parseRung,
  rungIndex,
  deriveLeader,
  procedureComplete,
  importedLeaderProcedure,
  LEADER_DOC,
  LEADER_TABLES,
} from "../scripts/monsters/leader-derive.mjs";
import { derivedLeaderRoles, hdOf, proseLeaderRoles, ratingText, SOURCE_AXIS, SOURCE, STANDARD_ROLE } from "../scripts/importer/leader-roles.mjs";
import { axisOffersChoice, chooseAxes, optionAvailable, resolveActor, seededRng } from "../scripts/lib/template-logic.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { derivationTips } from "../scripts/monsters/statblock.mjs";

const MID = "acks-extras";
let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

const RUNGS = ["½", "1-1", "1", "1+", "3", "5", "7", "9", "11"];
const STEPS = {
  rowsChampion: 2, rowsSubChieftain: 3, rowsChieftain: 5, bonusMinHd: 3, bonusFactorChieftain: 3,
  acChampion: 2, acSubChieftain: 4, acChieftain: 6,
  damageChampion: 2, damageSubChieftain: 3, damageChieftain: 4,
};
const PROC = { rungs: RUNGS, steps: STEPS, cite: "YY p.7" };
const hd = (count, bonus = null) => ({ count, bonus });

ok("a rung reads as a rating: a fraction, a penalty, a bare bonus, whole dice", () => {
  assert.deepEqual(parseRung("½"), { count: 0.5, bonus: null, plus: false });
  assert.deepEqual(parseRung("1/2"), { count: 0.5, bonus: null, plus: false });
  assert.deepEqual(parseRung("1-1"), { count: 1, bonus: -1, plus: false });
  assert.deepEqual(parseRung("1+"), { count: 1, bonus: null, plus: true });
  assert.deepEqual(parseRung("4+2"), { count: 4, bonus: 2, plus: false });
  assert.deepEqual(parseRung("9"), { count: 9, bonus: null, plus: false });
  assert.equal(parseRung("leader"), null);
  assert.equal(parseRung("1-"), null);
});

ok("a warrior stands on the rung of its rating", () => {
  assert.equal(rungIndex(RUNGS, hd(0.5), 3), 0);
  assert.equal(rungIndex(RUNGS, hd(1, -1), 3), 1);
  assert.equal(rungIndex(RUNGS, hd(1), 3), 2);
  assert.equal(rungIndex(RUNGS, hd(1, 1), 3), 3, "a bonus below the carry rating takes the bare-bonus rung");
  assert.equal(rungIndex(RUNGS, hd(5, 2), 3), 5, "a bonus at or above it stands on its whole dice");
  assert.equal(rungIndex(RUNGS, hd(4), 3), -1, "a rating the ladder does not print is on no rung");
  assert.equal(rungIndex(RUNGS, null, 3), -1);
});

ok("each rank moves its own rungs and adds its own AC and damage, damage a total", () => {
  const base = { hd: hd(0.5), ac: 1, damage: -2 };
  assert.deepEqual(deriveLeader(PROC, base, "champion"), { hd: hd(1), ac: 3, damage: 0, rows: 2, acAdd: 2, damageAdd: 2, carried: "", bonusFactor: null });
  assert.deepEqual(deriveLeader(PROC, base, "subChieftain").hd, { count: 1, bonus: 1 }, "the bare-bonus rung reads as the stat line's bare plus");
  assert.equal(deriveLeader(PROC, base, "subChieftain").ac, 5);
  assert.equal(deriveLeader(PROC, base, "subChieftain").damage, 1);
  assert.deepEqual(deriveLeader(PROC, base, "chieftain").hd, hd(5));
  assert.equal(deriveLeader(PROC, base, "chieftain").damage, 2);
});

ok("a bonus at the carry rating is carried whole by the lower ranks and multiplied by the imported factor on a chieftain", () => {
  const base = { hd: hd(3, 2), ac: 4, damage: 1 };
  const champ = deriveLeader(PROC, base, "champion");
  assert.deepEqual(champ.hd, hd(7, 2));
  assert.equal(champ.carried, "carried");
  assert.equal(champ.bonusFactor, null, "a rank that carries the bonus whole records no factor");
  assert.deepEqual(deriveLeader(PROC, base, "subChieftain").hd, hd(9, 2));
  const chief = deriveLeader({ ...PROC, rungs: [...RUNGS, "13", "15"] }, base, "chieftain");
  assert.deepEqual(chief.hd, hd(13, 6), "the factor is the imported one, not a constant");
  assert.equal(chief.carried, "multiplied");
  assert.equal(chief.bonusFactor, 3);
  const otherFactor = deriveLeader({ rungs: [...RUNGS, "13", "15"], steps: { ...STEPS, bonusFactorChieftain: 5 } }, base, "chieftain");
  assert.deepEqual(otherFactor.hd, hd(13, 10));
  const low = deriveLeader(PROC, { hd: hd(1, 1), ac: 0, damage: 0 }, "champion");
  assert.equal(low.carried, "", "below the carry rating the bonus does not come along");
  assert.deepEqual(low.hd, hd(5));
});

ok("nothing is derived off the ladder or from part of a procedure", () => {
  assert.equal(deriveLeader(PROC, { hd: hd(3, 2), ac: 0, damage: 0 }, "chieftain"), null, "past the last rung");
  assert.equal(deriveLeader(PROC, { hd: hd(4), ac: 0, damage: 0 }, "champion"), null, "a warrior on no rung");
  assert.equal(deriveLeader(PROC, { hd: hd(1), ac: 0, damage: 0 }, "shaman"), null, "a rank the procedure does not build");
  const { acChieftain, ...partial } = STEPS;
  assert.equal(procedureComplete({ rungs: RUNGS, steps: partial }), false);
  assert.equal(deriveLeader({ rungs: RUNGS, steps: partial }, { hd: hd(1), ac: 0, damage: 0 }, "champion"), null);
  assert.equal(procedureComplete({ rungs: [], steps: STEPS }), false);
  const { bonusMinHd, ...noCarry } = STEPS;
  assert.equal(procedureComplete({ rungs: RUNGS, steps: noCarry }), false, "the carry rating is a figure the procedure needs");
  const { bonusFactorChieftain, ...noFactor } = STEPS;
  assert.equal(procedureComplete({ rungs: RUNGS, steps: noFactor }), false, "the chieftain's factor is a figure the procedure needs");
  assert.equal(deriveLeader({ rungs: RUNGS, steps: noFactor }, { hd: hd(1), ac: 0, damage: 0 }, "champion"), null, "no rank is derived without it");
});

ok("a bonus exactly at the carry rating stands on its whole dice, not the bare-bonus rung", () => {
  const rungs = ["1", "3", "3+", "5"];
  assert.equal(rungIndex(rungs, hd(3, 1), 3), 1);
  assert.equal(rungIndex(rungs, hd(3, 1), 4), 2, "below the carry rating it takes the bare-bonus rung");
});

ok("the last cell that touches hit points decides whether they are rolled", () => {
  const opt = (key) => ({ key, label: key, merge: {}, items: [], flags: {} });
  const system = (cells) => ({
    axes: [{ key: "variant", options: [opt("a")] }, { key: "role", options: [opt("r")] }],
    cells,
    output: { nameFormat: "{variant}" },
  });
  const roll = { by: ["variant"], key: "a", rollHp: true, merge: {}, items: [], flags: {} };
  const fixed = { by: ["role"], key: "r", merge: { hp: { value: 5, max: 5 } }, items: [], flags: {} };
  const pick = { variant: "a", role: "r" };
  assert.equal(resolveActor(system([roll, fixed]), pick, { templateName: "T" }).rollHp, false, "fixed hit points after the roll turn it off");
  assert.equal(resolveActor(system([fixed, roll]), pick, { templateName: "T" }).rollHp, true);
});

ok("the procedure is read from the registry, the override over the import, and refused when partial", () => {
  resetTables();
  assert.equal(importedLeaderProcedure(), null);
  const ladder = Object.fromEntries(RUNGS.map((r, i) => [`rung${i + 1}`, { hd: r }]));
  registerTable(
    { id: LEADER_DOC, cites: { [LEADER_TABLES.steps]: "YY p.7" }, tables: { [LEADER_TABLES.ladder]: ladder, [LEADER_TABLES.steps]: STEPS } },
    { priority: PRIORITY.WORLD },
  );
  const read = importedLeaderProcedure();
  assert.deepEqual(read.rungs, RUNGS);
  assert.equal(read.cite, "YY p.7");
  registerTable({ id: LEADER_DOC, tables: { [LEADER_TABLES.steps]: { ...STEPS, acChampion: 9 } } }, { priority: PRIORITY.OVERRIDE });
  assert.equal(importedLeaderProcedure().steps.acChampion, 9, "the Judge's override wins");
  registerTable({ id: LEADER_DOC, tables: { [LEADER_TABLES.steps]: { rowsChampion: 2 } } }, { priority: PRIORITY.OVERRIDE });
  assert.equal(importedLeaderProcedure(), null, "an override table missing a step refuses the procedure, never half of it");
  resetTables();
});

/* ---------------- the family pass ---------------- */

const member = (key, { count, bonus = null, ac, mod = 0, thr = 9 }) => ({
  key,
  label: key,
  merge: {
    ac: { value: ac },
    hp: { hd: "1d8", value: 4, max: 4 },
    attack: { throw: thr },
    ...(mod ? { damage: { mod: { melee: mod, missile: mod } } } : {}),
  },
  items: [],
  flags: { [MID]: { cookbook: { id: `b.${key}`, cite: "ZZ p.3" }, extras: { hd: { count, bonus }, saveAs: { class: "fighter", level: Math.floor(count) } } } },
});

const family = () => {
  const options = [member("printer", { count: 1, ac: 2, mod: 1 }), member("silent", { count: 0.5, ac: 1, mod: -2 })];
  const axes = [{ key: "variant", label: "Variant", roll: "", options }];
  const cells = [];
  const out = { nameFormat: "{variant}" };
  const memberText = new Map([["printer", "Each printer gang will be led by a champion with 6 AC, 3 HD, 14 hp."], ["silent", "It hides."]]);
  proseLeaderRoles({ options, memberText, axes, cells, out });
  derivedLeaderRoles({ options, axes, cells, out, proc: PROC, deriveLeader, memberXp: new Map([["printer", "9 (warrior), 30 (chieftain)"]]) });
  return { axes, cells, out, system: { axes, cells, output: { nameFormat: out.nameFormat } } };
};

ok("a variant that prints a leader gets the procedure's under the source axis; one that prints none gets them plain", () => {
  const { cells } = family();
  const keys = cells.map((c) => c.key).sort();
  assert.ok(keys.includes("printer|champion"), "the printed cell stands");
  assert.ok(keys.includes(`printer|champion|${SOURCE.procedure}`));
  assert.ok(keys.includes(`printer|chieftain|${SOURCE.procedure}`));
  assert.ok(keys.includes("silent|champion") && keys.includes("silent|chieftain"), "no printed leader: the procedure's are the only ones");
  assert.ok(!keys.some((k) => k.startsWith("silent|") && k.endsWith(SOURCE.procedure)));
  assert.ok(cells.filter((c) => c.flags?.[MID]?.extras?.derived?.leader?.source === SOURCE.procedure).every((c) => c.rollHp === true));
});

ok("the source axis is chosen before the role, the printed book by default", () => {
  const { axes, out } = family();
  const at = (k) => axes.findIndex((a) => a.key === k);
  assert.ok(at(SOURCE_AXIS) >= 0 && at(SOURCE_AXIS) < at("role"));
  assert.equal(axes[at(SOURCE_AXIS)].default, SOURCE.printed);
  assert.deepEqual(axes[at("role")].options.map((o) => o.key), [STANDARD_ROLE, "champion", "subChieftain", "chieftain"]);
  assert.equal(out.nameFormat, "{variant} {role}");
});

ok("under the default a role the variant's page does not print is unavailable; under the procedure it is offered", () => {
  const { system, axes } = family();
  const role = axes.find((a) => a.key === "role");
  const chief = role.options.find((o) => o.key === "chieftain");
  assert.equal(optionAvailable(system, role, chief, { variant: "printer", [SOURCE_AXIS]: SOURCE.printed }), false);
  assert.equal(optionAvailable(system, role, chief, { variant: "printer", [SOURCE_AXIS]: SOURCE.procedure }), true);
  assert.equal(optionAvailable(system, role, chief, { variant: "silent", [SOURCE_AXIS]: SOURCE.printed }), true);
  const { choices } = chooseAxes(system, { pinned: { variant: "printer", role: "chieftain" }, rng: seededRng(4) });
  assert.equal(choices[SOURCE_AXIS], SOURCE.printed);
  assert.equal(choices.role, STANDARD_ROLE, "a pin the default source cannot fill falls back");
});

ok("the printed leader generates under the default; the procedure's under its pick, with its parts", () => {
  const { system } = family();
  const printed = resolveActor(system, { variant: "printer", [SOURCE_AXIS]: SOURCE.printed, role: "champion" }, { templateName: "T" });
  assert.equal(printed.system.ac.value, 6);
  assert.equal(printed.flags[MID].extras.derived.leader.source, "printed");
  assert.equal(printed.flags[MID].extras.derived.leader.cite, "ZZ p.3");
  assert.equal(printed.rollHp, false, "a printed leader keeps its printed hit points");
  const derived = resolveActor(system, { variant: "printer", [SOURCE_AXIS]: SOURCE.procedure, role: "champion" }, { templateName: "T" });
  assert.equal(derived.system.ac.value, 4, "the member's AC plus the champion's addition");
  assert.deepEqual(derived.system.damage, { mod: { melee: 3, missile: 3 } }, "a total, replacing the member's");
  assert.equal(derived.system.hp.hd, "3d8", "the rung two down from the member's");
  assert.equal(derived.rollHp, true);
  const leader = derived.flags[MID].extras.derived.leader;
  assert.equal(leader.source, SOURCE.procedure);
  assert.equal(leader.cite, "YY p.7");
  assert.equal(leader.rows, 2);
  assert.equal(derived.name, "printer Champion");
  const chief = resolveActor(system, { variant: "printer", [SOURCE_AXIS]: SOURCE.procedure, role: "chieftain" }, { templateName: "T" });
  assert.equal(chief.system.details.xp, 30, "the role's printed XP rides the procedure's leader");
});

ok("a bare bonus rung is the stat line's bare plus: one, whichever rank lands on it and from wherever", () => {
  const rungs = ["½", "1", "2+", "4", "6"];
  const steps = { ...STEPS, rowsChampion: 1, rowsSubChieftain: 2, rowsChieftain: 3 };
  const proc = { rungs, steps };
  assert.deepEqual(deriveLeader(proc, { hd: hd(1), ac: 0, damage: 0 }, "champion").hd, hd(2, 1));
  assert.deepEqual(deriveLeader(proc, { hd: hd(0.5), ac: 0, damage: 0 }, "subChieftain").hd, hd(2, 1));
  assert.equal(ratingText(hd(2, 1)), "2+1", "the reading `hdOf` gives a bare \"2+\"");
  assert.deepEqual({ count: hdOf("2+").count, bonus: hdOf("2+").bonus }, hd(2, 1));
});

ok("the leader-source axis is left off the sheet for a variant with no printed leaders", () => {
  const { system, axes } = family();
  const source = axes.find((a) => a.key === SOURCE_AXIS);
  assert.equal(axisOffersChoice(system, source, { variant: "printer" }), true, "a printed variant offers both sources");
  assert.equal(axisOffersChoice(system, source, { variant: "silent" }), false, "the procedure is its only source");
  assert.equal(axisOffersChoice(system, source, {}), true, "an unchosen variant may be either");
  const { choices } = chooseAxes(system, { pinned: { variant: "silent", role: "chieftain" }, rng: seededRng(2) });
  assert.equal(choices.role, "chieftain", "its derived leader still generates");
  const role = axes.find((a) => a.key === "role");
  assert.equal(axisOffersChoice(system, role, { variant: "silent", [SOURCE_AXIS]: SOURCE.printed }), true);
  assert.equal(axisOffersChoice({ ...system, cells: [] }, role, { variant: "silent" }), true, "an axis no cell refines keeps every option");
  assert.equal(axisOffersChoice(system, role, { variant: "nobody" }), false, "a variant with no roles: Standard is all it can take");
  const lone = { key: "variant", default: "x", options: [{ key: "x", merge: { ac: { value: 1 } } }] };
  assert.equal(axisOffersChoice(system, lone, {}), false, "a lone option is no choice, whatever it carries");
  assert.equal(axisOffersChoice(system, { ...lone, options: [...lone.options, { key: "y", merge: { ac: { value: 2 } } }] }, {}), true);
  assert.equal(axisOffersChoice(system, { ...source, multi: true }, { variant: "silent" }), true);
  assert.equal(axisOffersChoice(system, { ...lone, derive: { from: "hd" } }, {}), true, "an axis read off a base is shown");
});

ok("no procedure imported: nothing is added", () => {
  const options = [member("silent", { count: 0.5, ac: 1 })];
  const axes = [{ key: "variant", options }];
  const cells = [];
  derivedLeaderRoles({ options, axes, cells, out: {}, proc: null, deriveLeader });
  assert.equal(cells.length, 0);
  assert.equal(axes.length, 1);
});

ok("the sheet names the leader's source, and the procedure's parts while they hold", () => {
  const loc = (k, d = {}) => `${k}|${Object.entries(d).map(([a, b]) => `${a}=${b}`).join(",")}`;
  const leader = { source: SOURCE.procedure, cite: "YY p.7", rows: 2, baseHd: "4+1", baseAc: 2, acAdd: 2, baseDamage: 1, damageAdd: 2, carried: "multiplied", bonusFactor: 3, hd: "7+3", ac: 4, damage: 3 };
  const tip = derivationTips({ derived: { leader }, ac: 4, damageMod: 3 }, loc).leaderTip;
  assert.match(tip, /^statblock\.tip\.leaderDerived\|cite=YY p\.7,hd=7\+3,rows=2,baseHd=4\+1,carried=statblock\.tip\.leaderMultiplied\|factor=3,ac=4,baseAc=2,acAdd=\+2,damage=\+3,baseDamage=\+1,damageAdd=\+2$/);
  const carriedOf = (l) => derivationTips({ derived: { leader: { ...leader, ...l } }, ac: 4, damageMod: 3 }, loc).leaderTip.match(/carried=(.*?),ac=/)[1];
  assert.equal(carriedOf({ carried: "carried", bonusFactor: null }), "statblock.tip.leaderCarried|");
  assert.equal(carriedOf({ carried: "doubled", bonusFactor: undefined, baseHd: "4+1", hd: "9+5" }), "statblock.tip.leaderMultiplied|factor=5", "a record from before the factor was kept names the factor its ratings imply");
  assert.equal(carriedOf({ carried: "doubled", bonusFactor: undefined, baseHd: "4", hd: "9+5" }), "statblock.tip.leaderMultipliedBare|", "and none where they imply none");
  assert.equal(carriedOf({ carried: "" }), "");
  assert.equal(derivationTips({ derived: { leader }, ac: 7, damageMod: 3 }, loc).leaderTip, "statblock.tip.leaderDerivedEdited|cite=YY p.7");
  assert.equal(derivationTips({ derived: { leader: { source: "printed", cite: "ZZ p.3" } } }, loc).leaderTip, "statblock.tip.leaderPrinted|cite=ZZ p.3");
  assert.equal(derivationTips({}, loc).leaderTip, "");
});

ok("the armour class names its own source on the rail, only while the actor carries it", () => {
  const loc = (k, d = {}) => `${k}|${Object.entries(d).map(([a, b]) => `${a}=${b}`).join(",")}`;
  const leader = { source: SOURCE.procedure, cite: "YY p.7", baseAc: 2, acAdd: 3, ac: 5, damage: 1 };
  assert.equal(derivationTips({ derived: { leader }, ac: 5 }, loc).acTip, "statblock.tip.acDerived|ac=5,baseAc=2,acAdd=+3,cite=YY p.7");
  assert.equal(derivationTips({ derived: { leader }, ac: 6 }, loc).acTip, "", "an edited armour class is not explained by parts it no longer comes from");
  const printed = { source: "printed", cite: "ZZ p.3", ac: 4 };
  assert.equal(derivationTips({ derived: { leader: printed }, ac: 4 }, loc).acTip, "statblock.tip.acPrinted|ac=4,cite=ZZ p.3");
  assert.equal(derivationTips({ derived: { leader: printed }, ac: 1 }, loc).acTip, "");
  assert.equal(derivationTips({ ac: 4 }, loc).acTip, "");
  const { system } = family();
  const champ = resolveActor(system, { variant: "printer", [SOURCE_AXIS]: SOURCE.printed, role: "champion" }, { templateName: "T" });
  assert.equal(champ.flags[MID].extras.derived.leader.ac, 6, "a printed leader records the armour class its sentence prints");
});

console.log(`\n${passed} passed`);
