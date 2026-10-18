/**
 * The AX quick-stat line as the executor reads it (`parseStatline`), and the
 * count a quick-stat label carries (`countParen`). Every line here is
 * invented: no PDFs, no Foundry.
 */
import assert from "node:assert/strict";
import { executeEntry, parseStatline } from "../../scripts/importer/executor.mjs";

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => {
  n++;
  console.log(`ok - ${name}`);
});

/* ---------------- damage ---------------- */

await t("damage keyed Dmg reads as it always has", () => {
  const s = parseStatline("MV 90’, AC 4, HD 2, hp 9, #AT 1 (club), Dmg 1d6, Save F2, ML 0, AL N, XP 20");
  assert.equal(s.dmg, "1d6");
  assert.equal(s.save.class, "F");
});

await t("a bare D opening a clause is damage", () => {
  assert.equal(parseStatline("MV 90’, AC 4, HD 2, hp 9, #AT 1, D 1d8+1 (pike or axe), Save F2, ML 0").dmg, "1d8+1 (pike or axe)");
  assert.equal(parseStatline("MV 90’, AC 0, HD 1-1, hp 3, #AT 1, D by weapon, Save NM, ML 0").dmg, "by weapon");
  assert.equal(parseStatline("AC 1, SHP 2, #AT 1, Range 0’/150’, D 2d6").dmg, "2d6");
});

await t("Dmg wins over a D later in the line", () => {
  assert.equal(parseStatline("AC 4, HD 2, hp 9, #AT 1, Dmg 1d4, Save F1").dmg, "1d4");
});

await t("a D inside a word or a code is not damage", () => {
  assert.equal(parseStatline("MV 90’, AC 4, HD 2, hp 9, #AT 1, Save D2, ML 0").dmg, undefined);
});

/* ---------------- movement ---------------- */

await t("a movement clause closed by a semicolon is still movement", () => {
  const s = parseStatline("Mage 2; Str 9, Int 15, Wis 11, Dex 12, Con 10, Cha 8; MV 90; AC 7, HD 2, hp 6, #AT 1, D 1d4");
  assert.equal(s.mv, "90");
  assert.equal(s.ac, 7);
  assert.equal(s.abilities.cha, 8);
  assert.ok(!(s.extra ?? []).some((e) => /MV/.test(e)), "the clause is not left over as extra");
  assert.equal(parseStatline("MV 120’, AC 4, HD 2, hp 9; MV 30’").mv, "120’", "the core clause's MV wins over a later bare one");
});

/* ---------------- repertoire ---------------- */

await t("a repertoire runs on over the semicolons closing its levels", () => {
  const s = parseStatline("Mage 4; Str 9, Int 15, Wis 11, Dex 12, Con 10, Cha 8; MV 90’, AC 0, HD 4, hp 9, #AT 1, D 1d4; Spells: 2 1st, 1 2nd; Repertoire: 1st-glimmer, brass hand, 2ndfog lamp; 3rd-ember wheel; Equipment: wand, 5gp");
  assert.equal(s.repertoire, "1st-glimmer, brass hand, 2ndfog lamp; 3rd-ember wheel");
  assert.equal(s.spells, "Spells: 2 1st, 1 2nd");
  assert.equal(s.equipment, "wand, 5gp", "the run-on stops at the next labelled segment");
  assert.equal(s.extra, undefined);
});

await t("an ordinal segment with no repertoire before it stays extra", () => {
  assert.deepEqual(parseStatline("MV 90’, AC 4, HD 2, hp 9; 3rd-ember wheel").extra, ["3rd-ember wheel"]);
});

/* ---------------- hit points ---------------- */

await t("one hit-point figure is hp, and each is still marked", () => {
  const one = parseStatline("MV 120’, AC 0, HD 1, hp 4, #AT 1, D 1d6");
  assert.equal(one.hp, 4);
  assert.equal(one.hpList, undefined);
  const each = parseStatline("MV 120’, AC 0, HD 1, hp 4 each, #AT 1, D 1d6");
  assert.equal(each.hp, 4);
  assert.equal(each.hpEach, true);
});

await t("a hit-point figure per creature is a list, the first of it hp", () => {
  const s = parseStatline("MV 60’, AC 3, HD 1, hp 7, 5, 5, 2, #AT 1, D 1d6, Save F1, ML 0");
  assert.equal(s.hp, 7);
  assert.deepEqual(s.hpList, [7, 5, 5, 2]);
  assert.deepEqual(parseStatline("AC 3, HD 1, hp 6,4, 3, #AT 1").hpList, [6, 4, 3], "a missing space is the same list");
});

await t("a closing parenthetical is the hit points' note", () => {
  const s = parseStatline("MV 30’, AC 0, HD 1-1, hp 4 (2), #AT 1, D by weapon");
  assert.equal(s.hp, 4);
  assert.equal(s.hpNote, "2");
  assert.equal(s.hd, "1-1");
});

/* ---------------- the printed minus sign ---------------- */

await t("a printed minus sign reads as a minus", () => {
  const s = parseStatline("MV 120’, AC −1, HD 1, hp 2, #AT 1, D 1d4 − 1, Save NM, ML−2, AL N, XP 5");
  assert.equal(s.ac, -1);
  assert.equal(s.ml, -2);
  assert.equal(s.dmg, "1d4 - 1");
  assert.match(s.text, /ML−2/, "the text keeps what the page printed");
});

await t("half a hit die is a hit die", () => {
  assert.equal(parseStatline("MV 60’/180’, AC 1, HD½, hp 2, #AT 2 (claws), D 1/1, Save NM").hd, "½");
});

/* ---------------- a class segment before the stats ---------------- */

await t("a class segment ahead of the stats is still the class", () => {
  const s = parseStatline("Warden 2; MV 60’, AC 6 (mail & shield), HD 2, hp 9, #AT 1, D 1d6+1 (spear), Save F2, ML +2, AL L, XP 20");
  assert.deepEqual(s.class, { name: "Warden", level: 2 });
  assert.equal(s.ml, 2);
  assert.equal(s.dmg, "1d6+1 (spear)");
});

/* ---------------- countParen ---------------- */

const item = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 9, sp: false });
const page1 = {
  width: 612,
  height: 792,
  items: [item("Lamp Bearers (12):", 40, 100), item("Lamp Bearers (2d6):", 40, 120), item("Lamp Bearers (1d3 or 1):", 40, 140), item("Lamp Bearer:", 40, 160), item("Lamp Bearers (some):", 40, 180)],
};
const countAt = async (y) => {
  const fields = { "occupants.0.count": { op: "value", page: 1, pattern: "countParen", stripColon: true, box: { x0: 38, x1: 42, y0: y - 4, y1: y + 4 } } };
  const cb = { schema: "acks-cookbook/2", entries: { "zz.room1": { kind: "kind.location", name: "Room 1", pages: [1], fields } } };
  const node = await executeEntry(null, cb, {}, "zz.room1", { pageCache: new Map([[1, page1]]) });
  return node.fields.occupants["0.count"];
};

await t("a label's count: a whole number is a number", async () => {
  assert.equal(await countAt(100), 12);
});

await t("a label's count: dice and choices are kept as printed", async () => {
  assert.equal(await countAt(120), "2d6");
  assert.equal(await countAt(140), "1d3 or 1");
});

await t("a label with no count, or no digit in it, has none", async () => {
  assert.equal(await countAt(160), null);
  assert.equal(await countAt(180), null);
});

console.log(`\nax-statline: ${n} checks OK`);
