/**
 * A family template's Role axis (scripts/importer/leader-roles.mjs) and the
 * engine half it rides on (scripts/lib/template-logic.mjs): the leader,
 * caster and dependant sentences read in every printed grammar, the cells
 * built from them, the attack-throw ladder's edge rows, the cell flags
 * channel, the availability guard, the Standard default, and the "by weapon"
 * modifier lifted out of a weapon's formula by every stat-line binder. Also
 * the imported attack-throw ladder (an override over the import, nothing
 * guessed without it), the parts a derived throw and save row store and the
 * sheet names, and a refill retracting a damage modifier.
 *
 * Every creature, class word and figure here is invented; the sentences copy
 * only the printed GRAMMAR (which word sits where), never a page's words or
 * numbers. Saves are compared against `savesForLevel` itself, not against a
 * table. What a generated leader looks like on a real sheet is the live
 * recipe's (docs/monsters/TESTING.md, "Family templates: leaders").
 */
import assert from "node:assert/strict";
import {
  hdOf,
  throwStep,
  monsterThrowForHd,
  leaderThrow,
  saveLevelOf,
  leaderSaves,
  splitWeaponModifier,
  roleXp,
  readRoleSentences,
  leaderCell,
  proseLeaderRoles,
  overviewIsLore,
  STANDARD_ROLE,
  MONSTERS_DOC,
  THROW_LADDER_TABLE,
  ladderKey,
  ladderThrowAt,
  importedThrowLadder,
  ratingText,
} from "../scripts/importer/leader-roles.mjs";
import { savesForLevel } from "../scripts/importer/stats.mjs";
import { chooseAxes, optionAvailable, resolveActor, rollDice, seededRng } from "../scripts/lib/template-logic.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { REFILL_STAT_PATHS, REPAIR, refreshPlan } from "../scripts/importer/refresh.mjs";
import { derivationTips } from "../scripts/monsters/statblock.mjs";
import { bindLegacyMonster, bindNpc, templateOption } from "../scripts/importer/cookbook.mjs";

const MID = "acks-extras";

/**
 * An invented ladder, two apart per row and open-ended at 5 HD: not the book's
 * figures or step, so a result the suite expects can only come from the table.
 */
const LADDER = {
  half: { throw: 30 }, oneLess: { throw: 28 }, hd1: { throw: 26 }, hd2: { throw: 24 },
  hd3: { throw: 22 }, hd4: { throw: 20 }, hd5: { throw: 18 },
};
const CITE = "XX p.9";
let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

const savesAt = (level) =>
  Object.fromEntries(Object.entries(savesForLevel(level)).filter(([k]) => k !== "band").map(([k, v]) => [k, { value: v }]));

/** A member option the way importFamily builds one: a complete preset. */
const member = (key, { hd, count, bonus = null, thr, save, xp, mod = 0 }) => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
  merge: {
    ac: { value: 2 },
    hp: { hd, value: 5, max: 5 },
    attack: { throw: thr },
    saves: savesAt(save),
    details: { xp, morale: 1 },
    ...(mod ? { damage: { mod: { melee: mod, missile: mod } } } : {}),
  },
  items: [{ name: "Weapon", type: "weapon", system: { damage: { base: { formula: "By weapon" } } } }],
  flags: { [MID]: { extras: { hd: { count, bonus, asterisks: null, dieType: 8 }, saveAs: { class: "fighter", level: save } } } },
});

// Invented sentences, one per printed grammar.
const WOBBLER = [
  "Each wobbler gang will be led by a champion with 7 AC, 3+2 HD, 19 hp, and a +4 damage bonus.",
  "Each wobbler warband will be led by a subchieftain with 8 AC, 5 HD, and 27 hp.",
  "A wobbler lair or warren will be led by a chieftain with 9 AC, 6+1 HD, 33 hp, and a -1 damage bonus.",
  "Wobbler drudges fight as gribbles, while wobbler whelps fight as snarks.",
  "A shaman is equivalent to sub-chieftain statistically, but has Oracle abilities at level 2d3+1.",
  "A witch doctor is equivalent to a champion statistically, but has Hexer abilities at level 1d2.",
].join(" ");
const GRIBBLE = [
  "Each gribble gang will be led by one champion with 4 AC, 1-1 HD, and 3 hp.",
  "Gribble drudges and whelps have Spd 15’, AC 1, 2 hp, ML -3, and do not fight.",
].join(" ");
const SNARK = "Each snark gang will be led by a champion with AC 6, 2 HD, 11 hp.";

const build = () => {
  const options = [
    member("wobbler", { hd: "2d8+1", count: 2, bonus: 1, thr: 6, save: 2, xp: 13, mod: 2 }),
    member("gribble", { hd: "1d4", count: 0.5, thr: 12, save: 0, xp: 3, mod: -1 }),
    member("snark", { hd: "1d8", count: 1, thr: 10, save: 1, xp: 8 }),
  ];
  const memberText = new Map([["wobbler", WOBBLER], ["gribble", GRIBBLE], ["snark", SNARK]]);
  const memberXp = new Map([["wobbler", "13 (warrior), 41 (champion), 77 (sub- chieftain), chieftain (305)"]]);
  const axes = [{ key: "variant", label: "Variant", roll: "", options }];
  const cells = [];
  const out = { nameFormat: "{variant}" };
  proseLeaderRoles({ options, memberText, memberXp, axes, cells, out, ladder: LADDER, ladderCite: CITE });
  return { options, axes, cells, out, system: { axes, cells, output: { nameFormat: out.nameFormat } } };
};
const cellOf = (cells, key) => cells.find((c) => c.key === key);

/* ---------------- the ladder rows ---------------- */

ok("a rating's ladder row: a fraction below 1-1 below 1, a bonus rounds up", () => {
  assert.equal(throwStep("1/2"), -1);
  assert.equal(throwStep("1/2 (1d4 hp)"), -1);
  assert.equal(throwStep("1-1"), 0);
  assert.equal(throwStep("1"), 1);
  assert.equal(throwStep("1+1"), 2);
  assert.equal(throwStep("1+"), 2, "a bare plus is a bonus");
  assert.equal(throwStep("2"), 2);
  assert.equal(throwStep("3+1"), 4);
  assert.equal(throwStep("4-1"), 4, "a penalty above 1 HD stays on its row");
  assert.equal(throwStep(5), 5);
  assert.equal(throwStep(""), null);
});

ok("a rating's throw is its row of the imported ladder", () => {
  const at = (hd) => monsterThrowForHd(hd, LADDER);
  assert.equal(at("1/2"), 30);
  assert.equal(at("1-1"), 28);
  assert.equal(at("1"), 26);
  assert.equal(at("1+1"), 24, "1+1 throws as 2");
  assert.equal(at("3+1"), 20, "3+1 throws as 4");
  assert.equal(at("9"), 18, "past the last row: the open-ended last row");
  assert.equal(at(null), null);
  assert.equal(ladderKey(-1), "half");
  assert.equal(ladderKey(0), "oneLess");
  assert.equal(ladderKey(7), "hd7");
});

ok("no ladder imported: no throw, never a guess", () => {
  assert.equal(monsterThrowForHd("3"), null);
  assert.equal(monsterThrowForHd("3", {}), null);
  assert.equal(ladderThrowAt({ hd3: { __missing: true } }, 3), null, "a row the import could not read is no figure");
  assert.equal(leaderThrow(6, hdOf("2"), hdOf("3")), null);
});

ok("a leader's throw is the member's printed throw moved by what the ladder adds", () => {
  assert.deepEqual(leaderThrow(6, hdOf("2+1"), hdOf("3+2"), LADDER), { value: 4, rows: 1 });
  assert.deepEqual(leaderThrow(6, hdOf("2+1"), hdOf("6+1"), LADDER), { value: 2, rows: 4 }, "past the top the ladder adds nothing more");
  assert.deepEqual(leaderThrow(31, hdOf("1/2"), hdOf("1-1"), LADDER), { value: 29, rows: 1 }, "the member's offset from its row is kept");
  assert.deepEqual(leaderThrow(null, null, hdOf("3"), LADDER), { value: 22, rows: null }, "no printed throw: the leader's own row");
});

ok("the ladder is read from the registry, the Judge's override over the import", () => {
  resetTables();
  assert.deepEqual(importedThrowLadder(), { rows: null, cite: null });
  registerTable(
    { id: MONSTERS_DOC, source: { pages: "XX 9" }, cites: { [THROW_LADDER_TABLE]: CITE }, tables: { [THROW_LADDER_TABLE]: LADDER } },
    { priority: PRIORITY.WORLD },
  );
  assert.equal(importedThrowLadder().rows.hd2.throw, 24);
  assert.equal(importedThrowLadder().cite, CITE);
  registerTable({ id: MONSTERS_DOC, tables: { [THROW_LADDER_TABLE]: { ...LADDER, hd2: { throw: 99 } } } }, { priority: PRIORITY.OVERRIDE });
  assert.equal(monsterThrowForHd("2", importedThrowLadder().rows), 99, "the override wins");
  assert.equal(importedThrowLadder().cite, null, "an override is not read off a page");
  resetTables();
});

ok("a rating prints as the page does", () => {
  assert.equal(ratingText("3+2"), "3+2");
  assert.equal(ratingText("1-1"), "1-1");
  assert.equal(ratingText("1/2"), "1/2");
  assert.equal(ratingText(hdOf("5")), "5");
  assert.equal(ratingText(null), "");
});

ok("a save level follows the whole dice, a penalty takes one, a fraction saves at none", () => {
  assert.equal(saveLevelOf("1/2"), 0);
  assert.equal(saveLevelOf("1-1"), 0);
  assert.equal(saveLevelOf("1"), 1);
  assert.equal(saveLevelOf("1+1"), 1);
  assert.equal(saveLevelOf("3+1"), 3);
  const sv = leaderSaves({ class: "fighter", level: 2 }, hdOf("2+1"), hdOf("5"));
  assert.deepEqual(sv.saveAs, { class: "fighter", level: 5 });
  assert.deepEqual(sv.saves, savesAt(5));
  // A creature that saves above its dice keeps the offset.
  assert.equal(leaderSaves({ class: "mage", level: 4 }, hdOf("2"), hdOf("3")).saveAs.level, 5);
  assert.equal(leaderSaves({ class: "mage", level: 4 }, hdOf("2"), hdOf("3")).saveAs.class, "mage");
});

/* ---------------- the modifier lift ---------------- */

ok("a 'by weapon' modifier splits off; any other damage is left alone", () => {
  assert.deepEqual(splitWeaponModifier("By weapon +2"), { formula: "By weapon", mod: 2 });
  assert.deepEqual(splitWeaponModifier("by weapon -1"), { formula: "By weapon", mod: -1 });
  assert.deepEqual(splitWeaponModifier("By weapon"), { formula: "By weapon", mod: 0 });
  assert.equal(splitWeaponModifier("1d6+1"), null);
  assert.equal(splitWeaponModifier("By weapon +1 (+2 with natural attacks)"), null);
  assert.equal(splitWeaponModifier(""), null);
});

/* ---------------- the sentences ---------------- */

ok("XP per role, either order, a broken 'sub- chieftain' healed", () => {
  assert.deepEqual(roleXp("13 (warrior), 41 (champion), 77 (sub- chieftain), chieftain (305)"), {
    standard: 13, champion: 41, subChieftain: 77, chieftain: 305,
  });
  assert.deepEqual(roleXp("1,200 (warrior), 2,400 (sub-chieftain)"), { standard: 1200, subChieftain: 2400 });
  assert.deepEqual(roleXp("40"), {});
});

ok("every leader grammar reads: article, count word, no article, label first", () => {
  const w = readRoleSentences(WOBBLER);
  assert.deepEqual(w.champion, { ac: 7, hd: "3+2", hp: 19, dmg: 4 });
  assert.deepEqual(w.subChieftain, { ac: 8, hd: "5", hp: 27, dmg: null });
  assert.deepEqual(w.chieftain, { ac: 9, hd: "6+1", hp: 33, dmg: -1 });
  assert.deepEqual(readRoleSentences(GRIBBLE).champion, { ac: 4, hd: "1-1", hp: 3, dmg: null });
  assert.deepEqual(readRoleSentences(SNARK).champion, { ac: 6, hd: "2", hp: 11, dmg: null });
});

ok("casters read with or without an article, a level die with its modifier", () => {
  const w = readRoleSentences(WOBBLER);
  assert.deepEqual(w.shaman, { as: "subChieftain", cls: "Oracle", levelDie: "2d3+1" });
  assert.deepEqual(w.witchDoctor, { as: "champion", cls: "Hexer", levelDie: "1d2" });
});

ok("dependants: one line for both, or each fighting as another member", () => {
  const g = readRoleSentences(GRIBBLE);
  assert.deepEqual(g.drudge, { speed: 15, ac: 1, hp: 2, morale: -3 });
  assert.deepEqual(g.whelp, g.drudge);
  const w = readRoleSentences(WOBBLER);
  assert.deepEqual(w.drudge, { as: "gribbles" });
  assert.deepEqual(w.whelp, { as: "snarks" });
});

ok("prose that prints nothing adds no axis and no cell", () => {
  const axes = [{ key: "variant", options: [member("plain", { hd: "1d8", count: 1, thr: 10, save: 1, xp: 5 })] }];
  const cells = [];
  const out = { nameFormat: "{variant}" };
  proseLeaderRoles({ options: axes[0].options, memberText: new Map([["plain", "It lurks."]]), axes, cells, out });
  assert.equal(axes.length, 1);
  assert.equal(cells.length, 0);
  assert.equal(out.nameFormat, "{variant}");
});

/* ---------------- the cells ---------------- */

ok("a leader cell writes AC, fixed hit points, the rating's die, throw, saves, XP and the damage total", () => {
  const { cells } = build();
  const champ = cellOf(cells, "wobbler|champion");
  assert.deepEqual(champ.merge.ac, { value: 7 });
  assert.deepEqual(champ.merge.hp, { hd: "3d8+2", value: 19, max: 19 });
  assert.equal(champ.merge.attack.throw, 4);
  assert.deepEqual(champ.merge.saves, savesAt(3));
  assert.equal(champ.merge.details.xp, 41);
  assert.deepEqual(champ.merge.damage, { mod: { melee: 4, missile: 4 } }, "the printed bonus is the total");
  assert.deepEqual(champ.flags[MID].extras.hd, { count: 3, bonus: 2 });
  assert.deepEqual(champ.flags[MID].extras.saveAs, { class: "fighter", level: 3 });
});

ok("a leader sentence with no damage clause totals 0, replacing the member's modifier", () => {
  const { cells } = build();
  assert.deepEqual(cellOf(cells, "wobbler|subChieftain").merge.damage, { mod: { melee: 0, missile: 0 } });
  assert.deepEqual(cellOf(cells, "wobbler|chieftain").merge.damage, { mod: { melee: -1, missile: -1 } });
  assert.deepEqual(cellOf(cells, "gribble|champion").merge.damage, { mod: { melee: 0, missile: 0 } });
});

ok("XP is per role; a cell with no printed figure writes none", () => {
  const { cells } = build();
  assert.equal(cellOf(cells, "wobbler|subChieftain").merge.details.xp, 77);
  assert.equal(cellOf(cells, "wobbler|chieftain").merge.details.xp, 305);
  assert.equal(cellOf(cells, "snark|champion").merge.details, undefined);
});

ok("a caster is its role's block with the class it casts as and its level die", () => {
  const { cells } = build();
  const sham = cellOf(cells, "wobbler|shaman");
  const sub = cellOf(cells, "wobbler|subChieftain");
  assert.deepEqual(sham.merge, sub.merge);
  assert.deepEqual(sham.flags[MID].extras.spellcasting, { class: "Oracle", level: null, levelDie: "2d3+1" });
  assert.equal(sub.flags[MID].extras.spellcasting, undefined, "the role it copies is untouched");
  assert.equal(cellOf(cells, "wobbler|witchDoctor").flags[MID].extras.spellcasting.class, "Hexer");
});

ok("a dependant that fights as another member takes that member's combat block", () => {
  const { cells, options } = build();
  const drudge = cellOf(cells, "wobbler|drudge");
  const gribble = options.find((o) => o.key === "gribble");
  assert.deepEqual(drudge.merge.attack, gribble.merge.attack);
  assert.deepEqual(drudge.merge.hp, gribble.merge.hp);
  assert.deepEqual(drudge.merge.damage, { mod: { melee: -1, missile: -1 } });
  assert.deepEqual(drudge.flags[MID].extras.hd, gribble.flags[MID].extras.hd);
  const whelp = cellOf(cells, "wobbler|whelp");
  assert.deepEqual(whelp.merge.damage, { mod: { melee: 0, missile: 0 } }, "a member with no modifier totals 0");
});

ok("a dependant that does not fight is marked a noncombatant", () => {
  const { cells } = build();
  const c = cellOf(cells, "gribble|drudge");
  assert.deepEqual(c.merge.ac, { value: 1 });
  assert.equal(c.merge.details.morale, -3);
  assert.equal(c.merge.movement.base, 15);
  assert.equal(c.flags[MID].extras.noncombatant, true);
});

ok("the Role axis lists only roles some variant prints, Standard first and default", () => {
  const { axes, out } = build();
  const role = axes.find((a) => a.key === "role");
  assert.equal(role.default, STANDARD_ROLE);
  assert.deepEqual(role.options.map((o) => o.key), [
    "standard", "champion", "subChieftain", "chieftain", "shaman", "witchDoctor", "drudge", "whelp",
  ]);
  assert.equal(out.nameFormat, "{variant} {role}");
});

/* ---------------- the engine ---------------- */

ok("a cell's flags merge into the generated actor's flags", () => {
  const { system } = build();
  const r = resolveActor(system, { variant: "wobbler", role: "chieftain" }, { templateName: "T" });
  assert.deepEqual(r.flags[MID].extras.hd, { count: 6, bonus: 1, asterisks: null, dieType: 8 });
  assert.deepEqual(r.flags[MID].extras.saveAs, { class: "fighter", level: 6 });
  assert.equal(r.system.hp.hd, "6d8+1");
  assert.deepEqual(r.system.saves, savesAt(6));
  assert.equal(r.name, "Wobbler Chieftain");
});

ok("a noncombatant dependant generates without the member's weapons, and keeps its other items", () => {
  const { system, options } = build();
  const gribble = options.find((o) => o.key === "gribble");
  gribble.items = [{ type: "weapon", name: "Claw" }, { type: "ability", name: "Keen nose" }];
  const drudge = resolveActor(system, { variant: "gribble", role: "drudge" }, { templateName: "T" });
  assert.deepEqual(drudge.items.map((i) => i.type), ["ability"]);
  const standard = resolveActor(system, { variant: "gribble", role: STANDARD_ROLE }, { templateName: "T" });
  assert.deepEqual(standard.items.map((i) => i.type), ["weapon", "ability"], "the member itself keeps its weapon");
});

ok("an unpinned role generates the Standard rank and file, every time", () => {
  const { system } = build();
  for (let seed = 1; seed <= 200; seed++) {
    const { choices, log } = chooseAxes(system, { pinned: { variant: "wobbler" }, rng: seededRng(seed) });
    assert.equal(choices.role, STANDARD_ROLE);
    assert.equal(log.find((l) => l.axis === "role").source, "default");
  }
  const r = resolveActor(system, { variant: "wobbler", role: STANDARD_ROLE }, { templateName: "T" });
  assert.equal(r.name, "Wobbler");
  assert.equal(r.system.attack.throw, 6, "the member's own block, untouched");
});

ok("a role with no cell for the chosen variant is unavailable, and a pin of it falls back", () => {
  const { system, axes } = build();
  const role = axes.find((a) => a.key === "role");
  const opt = (k) => role.options.find((o) => o.key === k);
  assert.equal(optionAvailable(system, role, opt("chieftain"), { variant: "snark" }), false);
  assert.equal(optionAvailable(system, role, opt("champion"), { variant: "snark" }), true);
  assert.equal(optionAvailable(system, role, opt(STANDARD_ROLE), { variant: "snark" }), true);
  assert.equal(optionAvailable(system, role, opt("chieftain"), {}), true, "an unchosen variant matches any");
  const { choices, log } = chooseAxes(system, { pinned: { variant: "snark", role: "chieftain" }, rng: seededRng(3) });
  assert.equal(choices.role, STANDARD_ROLE);
  assert.ok(log.some((l) => l.axis === "role" && l.option === "chieftain" && l.source === "unavailable"));
});

ok("on an axis that rolls, a cell-only option with no cell is never rolled", () => {
  const { system, axes } = build();
  const rolling = { ...system, axes: axes.map((a) => (a.key === "role" ? { ...a, default: "" } : a)) };
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const { choices } = chooseAxes(rolling, { pinned: { variant: "snark" }, rng: seededRng(seed) });
    seen.add(choices.role);
  }
  // Without its default, Standard is a bare key no cell names, so it falls too.
  assert.deepEqual([...seen].sort(), ["champion"]);
});

ok("options with patches of their own are always available (grid templates unchanged)", () => {
  const grid = {
    axes: [
      { key: "age", options: [{ key: "young", merge: { ac: { value: 1 } } }, { key: "old", merge: { ac: { value: 2 } } }] },
      { key: "form", options: [{ key: "red", merge: { hp: { value: 1 } } }, { key: "blue", merge: { hp: { value: 2 } } }] },
    ],
    cells: [{ by: ["age", "form"], key: "old|red", merge: { attack: { throw: 3 } } }],
  };
  assert.equal(optionAvailable(grid, grid.axes[1], grid.axes[1].options[1], { age: "old" }), true);
});

ok("a level die rolls with its modifier", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const v = rollDice("2d3+1", seededRng(seed));
    assert.ok(v >= 3 && v <= 7, `2d3+1 in range: ${v}`);
  }
  assert.equal(rollDice("4"), 4);
  assert.equal(rollDice("not a die"), null);
});

/* ---------------- family members ---------------- */

ok("an overview reading another member's stat boxes is lore; one with its own is a variant", () => {
  const box = (page, y) => ({ op: "value", page, box: { x0: 1, x1: 2, y0: y, y1: y + 1 } });
  const entries = {
    "b.fam": { fields: { "stats.hitDice": box(9, 10), "stats.armorClass": box(9, 20), description: { page: 8 } } },
    "b.famA": { fields: { "stats.hitDice": box(9, 10), "stats.armorClass": box(9, 20) } },
    "b.famB": { fields: { "stats.hitDice": box(11, 10), "stats.armorClass": box(11, 20) } },
    "b.own": { fields: { "stats.hitDice": box(9, 40), "stats.armorClass": box(9, 50) } },
  };
  const of = (id) => entries[id];
  const members = [{ id: "b.fam", variant: "Fam" }, { id: "b.famA", variant: "A" }, { id: "b.famB", variant: "B" }];
  assert.equal(overviewIsLore(members[0], members, "Fam", of), true);
  assert.equal(overviewIsLore(members[1], members, "Fam", of), false, "only the overview");
  const mine = [{ id: "b.own", variant: "Fam" }, members[1]];
  assert.equal(overviewIsLore(mine[0], mine, "Fam", of), false, "same page, its own boxes");
  entries["b.half"] = { fields: { "stats.hitDice": box(9, 10), "stats.armorClass": box(9, 60) } };
  const half = [{ id: "b.half", variant: "Fam" }, members[1]];
  assert.equal(overviewIsLore(half[0], half, "Fam", of), false, "one shared box is not another member's block");
});

ok("a leaderCell on a member with no rating keeps only what the sentence prints", () => {
  const bare = { key: "x", merge: {}, flags: {} };
  const c = leaderCell(bare, { ac: 3, hd: "2", hp: 9, dmg: 1 }, { ladder: LADDER, ladderCite: CITE });
  assert.deepEqual(c.merge.ac, { value: 3 });
  assert.equal(c.merge.attack.throw, 24, "the leader's own ladder row");
  assert.equal(c.merge.saves, undefined, "no member save class to move from");
  assert.deepEqual(c.flags[MID].extras.derived.throw, { value: 24, base: null, baseHd: "", hd: "2", rows: null, cite: CITE });
});

/* ---------------- provenance ---------------- */

ok("a leader cell stores the parts its throw and saves were worked out from", () => {
  const { cells } = build();
  const d = cellOf(cells, "wobbler|champion").flags[MID].extras.derived;
  assert.deepEqual(d.throw, { value: 4, base: 6, baseHd: "2+1", hd: "3+2", rows: 1, cite: CITE });
  assert.deepEqual(d.saves, { level: 3, baseLevel: 2, baseHd: "2+1", hd: "3+2" });
  const r = resolveActor(build().system, { variant: "wobbler", role: "champion" }, { templateName: "T" });
  assert.deepEqual(r.flags[MID].extras.derived.throw, d.throw, "the parts reach the generated actor");
});

ok("with no ladder imported a leader writes no throw and records why", () => {
  const options = [member("plain", { hd: "1d8", count: 1, thr: 10, save: 1, xp: 5 })];
  const axes = [{ key: "variant", options }];
  const cells = [];
  proseLeaderRoles({ options, memberText: new Map([["plain", "led by a champion with 4 AC, 2 HD, 9 hp"]]), axes, cells, out: {} });
  const c = cellOf(cells, "plain|champion");
  assert.equal(c.merge.attack, undefined, "the member's own throw is not overwritten by a guess");
  assert.deepEqual(c.flags[MID].extras.derived.throw, { missing: true });
  assert.ok(c.merge.saves, "the saves still follow the rating");
});

const tipLoc = (key, data = {}) => `${key}|${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(",")}`;

ok("the sheet names a derived figure's parts only while the actor carries it", () => {
  const derived = {
    throw: { value: 4, base: 6, baseHd: "2+1", hd: "3+2", rows: 1, cite: CITE },
    saves: { level: 3, baseLevel: 2, baseHd: "2+1", hd: "3+2" },
  };
  const snap = { derived, attackThrow: 4, saveLevel: 3, savesAs: { cls: "Fighter", level: "3" } };
  const t = derivationTips(snap, tipLoc);
  assert.equal(t.throwTip, `statblock.tip.throwMoved|value=4,base=6,baseHd=2+1,rows=1,hd=3+2,cite=${CITE}`);
  assert.equal(t.savesTip, "statblock.tip.savesMoved|cls=Fighter,level=3,baseLevel=2,baseHd=2+1,hd=3+2");
  const edited = derivationTips({ ...snap, attackThrow: 7, saveLevel: 5 }, tipLoc);
  assert.equal(edited.throwTip, "", "a throw typed since is not explained by the old parts");
  assert.equal(edited.savesTip, "");
  const own = derivationTips({ ...snap, derived: { throw: { value: 24, base: null, hd: "2", rows: null, cite: "" } }, attackThrow: 24 }, tipLoc);
  assert.match(own.throwTip, /^statblock\.tip\.throwLadder\|value=24,hd=2,cite=statblock\.tip\.ladderOverride/, "no cite: the Judge's own ladder");
  assert.equal(derivationTips({ derived: { throw: { missing: true } } }, tipLoc).throwTip, "statblock.tip.throwMissing|");
  assert.deepEqual(derivationTips({}, tipLoc), { throwTip: "", savesTip: "", leaderTip: "", acTip: "", moraleTip: "", damageTip: "" });
});

/* ---------------- the refill ---------------- */

ok("a refill clears a damage modifier the re-read no longer finds, and keeps one it does", () => {
  assert.ok(REFILL_STAT_PATHS.includes("damage.mod.melee") && REFILL_STAT_PATHS.includes("damage.mod.missile"));
  const stored = { type: "monster", system: { damage: { mod: { melee: 2, missile: 2 } }, attack: { throw: 6 } }, flags: {} };
  const gone = refreshPlan(stored, { type: "monster", system: { attack: { throw: 6 } }, flags: {} }, REPAIR.monster);
  assert.ok(gone.retract.includes("damage.mod.melee") && gone.retract.includes("damage.mod.missile"));
  const kept = refreshPlan(stored, { type: "monster", system: { damage: { mod: { melee: 1, missile: 1 } } }, flags: {} }, REPAIR.monster);
  assert.ok(!kept.retract.includes("damage.mod.melee"));
  assert.equal(kept.update.system.damage.mod.melee, 1);
});

/* ---------------- the other stat-line binders ---------------- */

const gridOpts = { id: "t.probe", cite: "", sectionText: new Map() };
const gridAx = { key: "age", keyIsHd: false, budgetCol: null };

ok("a grid row with no printed throw takes its ladder row, and says so", () => {
  const o = templateOption(gridAx, { key: "adult", label: "Adult" }, { hitDice: "3+1" }, { ...gridOpts, ladder: { rows: LADDER, cite: CITE } });
  assert.equal(o.merge.attack.throw, 20);
  assert.deepEqual(o.flags[MID].extras.derived.throw, { value: 20, base: null, baseHd: "", hd: "3+1", rows: null, cite: CITE });
  const printed = templateOption(gridAx, { key: "adult", label: "Adult" }, { hitDice: "3", attacks: "1 weapon 7+" }, { ...gridOpts, ladder: { rows: LADDER, cite: CITE } });
  assert.equal(printed.merge.attack.throw, 7, "a printed throw outranks the ladder");
  assert.equal(printed.flags[MID]?.extras?.derived, undefined);
  const none = templateOption(gridAx, { key: "adult", label: "Adult" }, { hitDice: "3" }, gridOpts);
  assert.equal(none.merge.attack, undefined, "no ladder: the actor's default, not a guess");
  assert.deepEqual(none.flags[MID].extras.derived.throw, { missing: true });
});

ok("a grid row's by-weapon modifier moves to damage.mod", () => {
  const o = templateOption(gridAx, { key: "adult", label: "Adult" }, { hitDice: "2", damage: "By weapon +3" }, gridOpts);
  assert.deepEqual(o.merge.damage, { mod: { melee: 3, missile: 3 } });
  assert.equal(o.items[0].system.damage.base.formula, "By weapon");
  const die = templateOption(gridAx, { key: "adult", label: "Adult" }, { hitDice: "2", damage: "1d6+1" }, gridOpts);
  assert.equal(die.merge.damage, undefined, "a natural die keeps its own modifier");
  assert.equal(die.items[0].system.damage.base.formula, "1d6+1");
});

ok("a legacy stat line's by-weapon damage makes a weapon and moves its modifier", () => {
  const b = bindLegacyMonster({ fields: { stats: { attacks: "1 (weapon)", damage: "by weapon -2" } } });
  assert.deepEqual(b.system.damage, { mod: { melee: -2, missile: -2 } });
  const w = b.items.find((i) => i.name === "Weapon");
  assert.equal(w.system.damage.base.formula, "By weapon");
  const plain = bindLegacyMonster({ fields: { stats: { attacks: "1 (claw)", damage: "1d4" } } });
  assert.equal(plain.system.damage, undefined);
  assert.equal(plain.items.find((i) => i.name === "Claw").system.damage.base.formula, "1d4");
});

ok("a person's by-weapon damage moves its modifier; a die keeps its own", () => {
  const p = bindNpc({ fields: { statline: { atk: { text: "spear", throw: 9 }, dmg: "By weapon +1" } } });
  assert.deepEqual(p.system.damage, { mod: { melee: 1, missile: 1 } });
  assert.equal(p.items[0].system.damage.base.formula, "By weapon");
  const q = bindNpc({ fields: { statline: { atk: { text: "spear", throw: 9 }, dmg: "1d6+1" } } });
  assert.equal(q.system.damage, undefined);
  assert.equal(q.items[0].system.damage.base.formula, "1d6+1");
});

console.log(`\n${passed} passed`);
