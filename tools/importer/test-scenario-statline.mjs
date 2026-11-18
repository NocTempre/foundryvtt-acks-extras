/**
 * A scenario's stat block as the executor reads it (`parseStatline`'s
 * routine-by-routine attacks, `scenarioRoutines`) and as the importer binds
 * it to an actor (`bindNpc`): one weapon a routine, hit points from hit dice
 * where none are printed, and nothing bound from a figure the read left
 * unread. Every line here is invented: no PDFs, no Foundry.
 */
import assert from "node:assert/strict";
import { parseStatline } from "../../scripts/importer/executor.mjs";
import { scenarioRoutines } from "../../scripts/importer/statline-attacks.mjs";
import { bindNpc } from "../../scripts/importer/cookbook/monster.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => {
  n++;
  console.log(`ok - ${name}`);
});

const WORDS = { piercing: "piercing", slashing: "slashing" };
const bind = (line, extra = {}) => bindNpc({ fields: { statline: { ...parseStatline(line), ...extra } } });
const weapons = (b) => b.items.map((i) => [i.name, i.system.damage.base.formula, Array.from(i.system.damage.base.types ?? [])[0] ?? null]);

/* ---------------- the routines ---------------- */

await t("a routine is its name, its throw, its roll, the damage word after the roll and what is left", () => {
  assert.deepEqual(scenarioRoutines("gnaw 6+: 1d6 piercing + rot", WORDS), [{ text: "gnaw", throw: 6, dmg: "1d6", dmgType: "piercing", rider: "rot" }]);
  assert.deepEqual(scenarioRoutines("gnaw 6+: 1d6 smelly", WORDS), [{ text: "gnaw", throw: 6, dmg: "1d6", rider: "smelly" }], "a word the table does not know is the rider");
});

await t("a list with no throw, or a throw with no roll after it, is no routine", () => {
  assert.equal(scenarioRoutines("club", WORDS), null);
  assert.equal(scenarioRoutines("2 claws, 1 bite", WORDS), null);
  assert.equal(scenarioRoutines("gnaw 6+: by weapon", WORDS), null);
});

await t("a throw may be negative, and the roll may follow a comma or nothing at all", () => {
  assert.deepEqual(scenarioRoutines("gnaw -3+: 1d4 piercing", WORDS)[0].throw, -3);
  assert.deepEqual(scenarioRoutines("gnaw: 6+, 1d4 piercing", WORDS)[0].dmg, "1d4");
  assert.deepEqual(scenarioRoutines("gnaw 6+ 1d4+1 piercing", WORDS)[0].dmg, "1d4+1");
});

await t("routines joined by or each keep their own throw", () => {
  const r = scenarioRoutines("hook 5+, 1d8 slashing or prod 7+ 1d4 piercing", WORDS);
  assert.deepEqual(r.map((x) => [x.text, x.throw, x.dmg, x.dmgType]), [["hook", 5, "1d8", "slashing"], ["prod", 7, "1d4", "piercing"]]);
});

await t("a counted name list beside as many rolls pairs one to one, a multiplier kept apart", () => {
  const r = scenarioRoutines("2 pincers, 1 tail 4+: 2 × 1d4+1 slashing, 1d6 piercing", WORDS);
  assert.deepEqual(r.map((x) => [x.text, x.count, x.dmg, x.dmgType]), [["pincers", 2, "1d4+1", "slashing"], ["tail", 1, "1d6", "piercing"]]);
});

/* ---------------- the line ---------------- */

await t("a scenario line reads its routines, and atk stays the first", () => {
  const s = parseStatline("MV 30’, AC 3, HD 2*, #AT 1 (gnaw 9+: 1d6 piercing + rot), SV F2, ML 0, AL C, XP 30");
  assert.deepEqual(s.atk, { count: "1", text: "gnaw 9+: 1d6 piercing + rot", throw: 9 });
  assert.deepEqual(s.atks, [{ text: "gnaw", throw: 9, dmg: "1d6", dmgType: "piercing", rider: "rot" }]);
  assert.deepEqual(s.save, { class: "F", level: 2 });
  assert.equal(s.xp, 30);
});

await t("two parentheses joined by or are one attack of two routines", () => {
  const s = parseStatline("MV 40’, AC 6, HD 6**, hp 40, #AT 3 (Lash 2+: 1d8 slashing) or (Spit 2+: 1d6 acidic, 60’ range), SV F6, ML +2, AL C, XP 900");
  assert.equal(s.atk.text, "Lash 2+: 1d8 slashing or Spit 2+: 1d6 acidic, 60’ range");
  assert.deepEqual(s.atks.map((r) => [r.text, r.dmgType, r.rider]), [["Lash", "slashing", undefined], ["Spit", "acidic", "60’ range"]]);
  assert.equal(s.ml, 2);
});

await t("a routine parenthesis a semicolon cut from its #AT is joined back to it", () => {
  const s = parseStatline("MV 40’, AC 5, HD 4, #AT 1; (Cleaver: 6+, 1d8 slashing or Shove: 7+, 1d4 bludgeoning + prone); SV F4, ML 0, AL N, XP 80");
  assert.deepEqual(s.atks.map((r) => [r.text, r.throw]), [["Cleaver", 6], ["Shove", 7]]);
  assert.deepEqual(s.save, { class: "F", level: 4 });
  assert.equal(s.extra, undefined);
});

await t("a segment of only save, morale, alignment and XP is the core clause", () => {
  const s = parseStatline("MV 70’, AC 1, HD 6** #AT 1 (gnaw 3+: 2d4 piercing); SV F7, ML -3, AL N, XP 777");
  assert.deepEqual(s.save, { class: "F", level: 7 });
  assert.equal(s.al, "N");
  assert.equal(s.xp, 777);
  assert.equal(s.extra, undefined);
});

await t("a morale dash reads N/A, and an alignment dash is no alignment", () => {
  const s = parseStatline("MV: 30, AC 9, HD 9*, hp: 50, #AT 2 (hook 4+, 1d10+4 arcane), SV F9, ML -, AL -, XP 900");
  assert.equal(s.ml, "N/A");
  assert.equal(s.al, undefined);
  assert.equal(s.mv, "30", "a colon after MV is read");
  assert.equal(s.hp, 50, "a colon after hp is read");
});

await t("capital scores and Wil open a core segment; Wil is wisdom", () => {
  const s = parseStatline("Mage 5; STR 8, INT 17, WIL 11, DEX 12, CON 10, CHA 9; MV 40’, AC 1, HD 5, hp: 14, #AT 1 (Rod 7+: 1d6 bludgeoning), SV M5, ML 1, AL C, XP 300");
  assert.deepEqual(s.class, { name: "Mage", level: 5 });
  assert.deepEqual(s.abilities, { str: 8, int: 17, wis: 11, dex: 12, con: 10, cha: 9 });
  assert.equal(s.hp, 14);
});

/* ---------------- the earlier lines, unchanged ---------------- */

await t("a quick-stat line with no throw in its attack reads as it always has: no routines", () => {
  const s = parseStatline("MV 90’, AC 4, HD 2, hp 9, #AT 1 (club), Dmg 1d6, Save F2, ML 0, AL N, XP 20");
  assert.equal(s.atks, undefined);
  assert.deepEqual(s.atk, { count: "1", text: "club" });
  assert.equal(s.dmg, "1d6");
  const listed = parseStatline("MV 120’, AC 5, HD 3, hp 14, #AT 2 claws/1 bite, D 1d4/1d4/1d6, Save F3, ML 0, AL C, XP 50");
  assert.equal(listed.atks, undefined);
});

await t("an alignment word, a morale figure and a semicolon-closed movement read as before", () => {
  const s = parseStatline("MV 90; AC 7, HD 2, hp 6, #AT 1, D 1d4, Save F2, ML -1, AL varies, XP 20");
  assert.equal(s.ml, -1);
  assert.equal(s.mv, "90");
  assert.notEqual(s.al, "N/A");
});

/* ---------------- the actor ---------------- */

await t("each routine is one weapon, named, rolled and typed by its own damage word", () => {
  const b = bind("MV 20’, AC 12, HD 7*, hp 45, #AT 3 (2 talons, 1 beak -2+: 2 × 1d6+1 slashing, 1d8+1 piercing), SV F7, ML +1, AL C, XP 800");
  assert.deepEqual(weapons(b), [["Talons", "1d6+1", "slashing"], ["Beak", "1d8+1", "piercing"]]);
  assert.ok(b.items.every((i) => i.flags[MODULE_ID].minted && i.system.equipped));
  assert.equal(b.system.attack.throw, -2);
});

await t("a routine whose throw differs from the first carries the difference as its attack bonus", () => {
  const b = bind("MV 40’, AC 5, HD 4, #AT 1; (Cleaver: 6+, 1d8 slashing or Shove: 9+, 1d4 bludgeoning); SV F4, ML 0, AL N, XP 80");
  assert.equal(b.system.attack.throw, 6);
  assert.deepEqual(b.items.map((i) => i.system.bonus.attack), [0, -3]);
});

await t("an unread attack throw binds no throw, no attack text that prints it and no routine bonus", () => {
  const line = "MV 40’, AC 5, HD 4, #AT 1; (Cleaver: 6+, 1d8 slashing or Shove: 9+, 1d4 bludgeoning); SV F4, ML 0, AL N, XP 80";
  const b = bind(line, { unread: ["atk.throw"] });
  assert.equal(b.system.attack, undefined);
  assert.equal(b.system.attacks, undefined);
  assert.deepEqual(b.items.map((i) => [i.name, i.system.bonus.attack]), [["Cleaver", 0], ["Shove", 0]]);
});

await t("a line with no routines still mints its one attack the old way", () => {
  const b = bind("MV 90’, AC 4, HD 2, hp 9, #AT 1 (club), Dmg 1d6, Save F2, ML 0, AL N, XP 20");
  assert.deepEqual(b.items.map((i) => [i.name, i.system.damage.base.formula]), [["Club", "1d6"]]);
});

await t("hit dice with no hit points printed give the dice's hit points; printed ones win", () => {
  const dice = bind("MV 40’, AC 4, HD 3, #AT 1 (club 8+: 1d6 bludgeoning), SV F3, ML 0, AL C, XP 40");
  assert.ok(Number.isInteger(dice.system.hp.value) && dice.system.hp.value > 0);
  assert.equal(dice.system.hp.max, dice.system.hp.value);
  assert.equal(dice.system.hp.hd, "3d8");
  assert.equal(bind("MV 40’, AC 4, HD 3, hp 2, #AT 1 (club 8+: 1d6 bludgeoning), SV F3").system.hp.value, 2);
});

await t("a morale dash binds no morale", () => {
  assert.equal(bind("MV 40’, AC 4, HD 3, hp 9, #AT 1 (club 8+: 1d6 bludgeoning), SV F3, ML -, AL C").system.details.morale, undefined);
});

await t("an unread save binds no save row, and unread hit dice give neither dice nor hit points", () => {
  const line = "MV 30’, AC 3, HD 2*, #AT 1 (gnaw 9+: 1d6 piercing), SV F2, ML 0, AL C, XP 30";
  const b = bind(line, { unread: ["save", "hd"] });
  assert.equal(b.system.saves, undefined);
  assert.equal(b.system.hp, undefined);
  assert.equal(b.system.ac.value, 3, "a figure that was read still binds");
  assert.ok(bind(line).system.saves, "read, the save row binds");
  const printed = bind("MV 30’, AC 3, HD 2*, hp 7, #AT 1 (gnaw 9+: 1d6 piercing), SV F2", { unread: ["hd"] });
  assert.equal(printed.system.hp.value, 7);
  assert.equal(printed.system.hp.hd, undefined);
  assert.deepEqual(bind(line, { unread: ["hp"] }).system.hp, { hd: "2d8" }, "unread hit points are not worked out from the dice, and the dice that were read still bind");
});

console.log(`\n${n} checks passed`);
