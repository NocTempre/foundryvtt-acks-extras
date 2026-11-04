/**
 * Leaders for an entry outside a family (`entryLeaderTemplate` in
 * scripts/importer/leader-roles.mjs): one creature as the template's only
 * variant and its default, the roles its own prose prints, the leader
 * procedure's beside them only for a type the procedure builds for, nothing
 * minted where neither adds a role, the lone variant axis left off the sheet,
 * and the template's id answering for no entry.
 *
 * Every sentence, figure, ladder and step is invented, so a result can only
 * come from what is passed in. The live recipe is docs/monsters/TESTING.md,
 * "Leaders outside a family".
 */
import assert from "node:assert/strict";
import { entryLeaderTemplate, leaderTemplateId, procedureBuildsFor, SOURCE, SOURCE_AXIS, STANDARD_ROLE } from "../scripts/importer/leader-roles.mjs";
import { deriveLeader } from "../scripts/monsters/leader-derive.mjs";
import { axisOffersChoice, chooseAxes, resolveActor, seededRng } from "../scripts/lib/template-logic.mjs";

const MID = "acks-extras";
let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

const LADDER = { half: { throw: 31 }, oneLess: { throw: 29 }, hd1: { throw: 27 }, hd2: { throw: 25 }, hd3: { throw: 23 }, hd4: { throw: 21 }, hd5: { throw: 19 } };
const PROC = {
  rungs: ["1", "2", "3", "4", "5", "6"],
  steps: {
    rowsChampion: 1, rowsSubChieftain: 2, rowsChieftain: 3, bonusMinHd: 2,
    acChampion: 1, acSubChieftain: 3, acChieftain: 5,
    damageChampion: 1, damageSubChieftain: 2, damageChieftain: 4,
  },
  cite: "QQ p.4",
};

/** A creature as a variant option, the shape `importFamily` and the standalone mint build. */
const creature = (key, { count, ac = 2, thr = 27 }) => ({
  key,
  label: key,
  nameLabel: key,
  merge: { ac: { value: ac }, hp: { hd: `${count}d8`, value: 6, max: 6 }, attack: { throw: thr }, details: { xp: 9 } },
  items: [],
  html: "",
  flags: { [MID]: { cookbook: { id: `zz.${key}`, cite: "ZZ p.11" }, extras: { hd: { count, bonus: null }, saveAs: { class: "fighter", level: count } } } },
  token: {},
});

const PRINTS = "A blorp band is led by a champion with 5 AC, 2 HD, 13 hp, and a +2 damage bonus.";

ok("an entry whose prose prints a leader gets a template of its own creature and that leader", () => {
  const built = entryLeaderTemplate({ option: creature("blorp", { count: 1 }), text: PRINTS, xp: "9 (warrior), 44 (champion)", ladder: LADDER, ladderCite: "LL p.2" });
  assert.ok(built);
  const variant = built.axes.find((a) => a.key === "variant");
  assert.deepEqual(variant.options.map((o) => o.key), ["blorp"]);
  assert.equal(variant.default, "blorp", "the creature is what an unpinned generation takes");
  const role = built.axes.find((a) => a.key === "role");
  assert.deepEqual(role.options.map((o) => o.key), [STANDARD_ROLE, "champion"]);
  assert.equal(built.out.nameFormat, "{variant} {role}");
  const system = { axes: built.axes, cells: built.cells, output: { nameFormat: built.out.nameFormat } };
  const champ = resolveActor(system, { variant: "blorp", role: "champion" }, { templateName: "T" });
  assert.equal(champ.system.ac.value, 5);
  assert.equal(champ.system.attack.throw, 25, "the member's throw moved one ladder row");
  assert.equal(champ.system.details.xp, 44);
  assert.deepEqual(champ.system.damage, { mod: { melee: 2, missile: 2 } });
  assert.equal(champ.name, "blorp Champion");
  assert.equal(champ.flags[MID].extras.derived.leader.source, "printed");
  const plain = chooseAxes(system, { rng: seededRng(5) }).choices;
  assert.deepEqual(plain, { variant: "blorp", role: STANDARD_ROLE }, "nothing pinned: the creature itself");
});

ok("no leader printed and no procedure: nothing is minted", () => {
  assert.equal(entryLeaderTemplate({ option: creature("quiet", { count: 2 }), text: "It sleeps." }), null);
  assert.equal(entryLeaderTemplate({ option: creature("quiet", { count: 2 }), text: "It sleeps.", proc: PROC, deriveLeader, procedure: false }), null,
    "a type the procedure does not build for gets none of its leaders");
});

ok("a type the procedure builds for gets its leaders, plain where the page prints none", () => {
  const built = entryLeaderTemplate({ option: creature("hulk", { count: 2, ac: 3 }), text: "It sleeps.", proc: PROC, deriveLeader, procedure: true, ladder: LADDER });
  assert.ok(built);
  assert.deepEqual(built.cells.map((c) => c.key).sort(), ["hulk|champion", "hulk|chieftain", "hulk|subChieftain"]);
  assert.ok(!built.axes.some((a) => a.key === SOURCE_AXIS), "one source: no source axis");
  const system = { axes: built.axes, cells: built.cells, output: { nameFormat: built.out.nameFormat } };
  const chief = resolveActor(system, { variant: "hulk", role: "chieftain" }, { templateName: "T" });
  assert.equal(chief.system.ac.value, 8);
  assert.equal(chief.system.hp.hd, "5d8");
  assert.equal(chief.rollHp, true);
  assert.equal(chief.flags[MID].extras.derived.leader.source, SOURCE.procedure);
});

ok("a printed leader and the procedure: the source axis, the printed book by default", () => {
  const built = entryLeaderTemplate({ option: creature("blorp", { count: 1 }), text: PRINTS, proc: PROC, deriveLeader, procedure: true, ladder: LADDER });
  const source = built.axes.find((a) => a.key === SOURCE_AXIS);
  assert.equal(source.default, SOURCE.printed);
  const system = { axes: built.axes, cells: built.cells, output: { nameFormat: built.out.nameFormat } };
  assert.equal(resolveActor(system, { variant: "blorp", [SOURCE_AXIS]: SOURCE.printed, role: "champion" }).system.ac.value, 5);
  assert.equal(resolveActor(system, { variant: "blorp", [SOURCE_AXIS]: SOURCE.procedure, role: "champion" }).system.ac.value, 3, "the member's 2 plus the champion's 1");
  assert.equal(axisOffersChoice(system, source, { variant: "blorp" }), true);
});

ok("the template's lone variant is no choice on the sheet", () => {
  const built = entryLeaderTemplate({ option: creature("blorp", { count: 1 }), text: PRINTS });
  const system = { axes: built.axes, cells: built.cells };
  assert.equal(axisOffersChoice(system, built.axes.find((a) => a.key === "variant"), {}), false);
  assert.equal(axisOffersChoice(system, built.axes.find((a) => a.key === "role"), { variant: "blorp" }), true);
  const pair = { key: "variant", label: "Variant", roll: "", options: [creature("blorp", { count: 1 }), creature("hulk", { count: 2 })] };
  assert.equal(axisOffersChoice({ axes: [pair], cells: built.cells }, pair, {}), true, "a family's variants, complete presets, are always a choice");
});

ok("the template answers for no entry, on the entry's own book", () => {
  assert.equal(leaderTemplateId("zz.blorp"), "zz.blorp.leaders");
  assert.equal(leaderTemplateId("zz.blorp").split(".")[0], "zz");
  assert.ok(!leaderTemplateId("zz.blorp").includes("#"), "never a section id");
});

ok("the procedure builds for the type that names it, in any case, among others", () => {
  assert.equal(procedureBuildsFor(["humanoid", "Beastman"]), true);
  assert.equal(procedureBuildsFor(["giant"]), false);
  assert.equal(procedureBuildsFor(null), false);
});

console.log(`\n${passed} passed`);
