/**
 * A person a page prints in full, read into the official sheet's boxes
 * (`character-binding.mjs`). Every line and name here is invented: no PDFs, no
 * Foundry. The suite reads the boxes through the sheet import's own plan
 * (`buildPlan`), so a box this binding fills is one the sheet import reads.
 */
import assert from "node:assert/strict";
import { parseStatline } from "../../scripts/importer/executor.mjs";
import { stripBookText } from "../../scripts/importer/prose.mjs";
import { buildPlan } from "../../scripts/character-sheet/pdf/plan.mjs";
import { sheetValuesFromStatline, asPrintedBlock, playerOwned, AS_PRINTED_CLASS } from "../../scripts/importer/character-binding.mjs";

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => {
  n++;
  console.log(`ok - ${name}`);
});

const LINE =
  "Lampwright 5; Str 14, Int 9, Wis 10, Dex 12, Con 13, Cha 11; MV 90’, AC 6 (scale +1 & buckler), HD 5, hp 23, #AT 1, Dmg 1d8+2 (glaive) or 1d6 (sling or glaive), Save L5, ML +3, AL L, XP 300; Proficiencies: Kiln Lore, Ropecraft 2, Steady Hand (glaive); Equipment: oilskin coat, 3 candles, 12gp, 1,200sp";

/* ---------------- the boxes ---------------- */

await t("the class, level, alignment, scores and hit points go to their boxes", () => {
  const { values } = sheetValuesFromStatline(parseStatline(LINE));
  const plan = buildPlan(values);
  assert.equal(plan.className, "Lampwright");
  assert.equal(plan.level, 5);
  assert.equal(plan.alignment, "Lawful");
  assert.deepEqual(plan.scores, { str: 14, int: 9, wis: 10, dex: 12, con: 13, cha: 11 });
  assert.equal(plan.hp.value, 23);
  assert.equal(plan.hp.max, 23);
  assert.equal(plan.ac.shield, 6, "the printed AC is the total, the box the sheet keeps it in");
  assert.equal(plan.move.exploration, 90);
});

await t("the line's XP and save code are not written", () => {
  const { values } = sheetValuesFromStatline(parseStatline(LINE));
  const plan = buildPlan(values);
  assert.equal(plan.xp, null, "the line's XP is what defeating the person is worth");
  assert.ok(Object.values(plan.saves).every((v) => v === null), "the class derives the saves");
});

await t("proficiencies keep their pick and rank", () => {
  const plan = buildPlan(sheetValuesFromStatline(parseStatline(LINE)).values);
  const abilities = plan.abilities.map(({ name, selection, rank }) => ({ name, selection, rank }));
  assert.deepEqual(abilities, [
    { name: "Kiln Lore", selection: null, rank: 1 },
    { name: "Ropecraft", selection: null, rank: 2 },
    { name: "Steady Hand", selection: "glaive", rank: 1 },
  ]);
});

await t("the armour and the equipment are worn, and the coin goes to the coin boxes", () => {
  const plan = buildPlan(sheetValuesFromStatline(parseStatline(LINE)).values);
  assert.deepEqual(plan.gear.map(({ place, qty, name }) => [place, qty, name]), [
    ["worn", 1, "scale +1"],
    ["worn", 1, "buckler"],
    ["worn", 1, "oilskin coat"],
    ["worn", 3, "candles"],
  ]);
  assert.equal(plan.coins.gp.count, 12);
  assert.equal(plan.coins.sp.count, 1200);
  assert.equal(plan.coins.cp.count, null);
});

await t("every weapon the damage brackets name goes to the weapons table, once", () => {
  const plan = buildPlan(sheetValuesFromStatline(parseStatline(LINE)).values);
  assert.deepEqual(plan.weapons.map((w) => w.name), ["glaive", "sling"]);
  assert.ok(plan.weapons.every((w) => w.damage === null), "the printed damage carries the bonuses, so it is not a weapon's dice");
});

await t("morale is handed back, not boxed", () => {
  assert.equal(sheetValuesFromStatline(parseStatline(LINE)).morale, 3);
  assert.equal(sheetValuesFromStatline(parseStatline("MV 90’, AC 4, HD 2, hp 9, #AT 1, D 1d6, ML N/A")).morale, null);
});

await t("a caster's slots and repertoire land by level", () => {
  const line = "Lampwright 4; Str 9, Int 15, Wis 11, Dex 12, Con 10, Cha 8; MV 90’, AC 0, HD 4, hp 9, #AT 1, D 1d4; Spells: 2 1st, 1 2nd; Repertoire: 1st-glimmer, brass hand, 2ndfog lamp; 3rd-ember wheel";
  const plan = buildPlan(sheetValuesFromStatline(parseStatline(line)).values);
  assert.equal(plan.spells.perDay[1], 2);
  assert.equal(plan.spells.perDay[2], 1);
  assert.deepEqual(plan.spells.known, [
    { level: 1, name: "glimmer" },
    { level: 1, name: "brass hand" },
    { level: 2, name: "fog lamp" },
    { level: 3, name: "ember wheel" },
  ]);
});

await t("a line with no class leaves the class boxes empty", () => {
  const { values } = sheetValuesFromStatline(parseStatline("MV 120’, AC 0, HD 1-1, hp 3, #AT 1, Dmg 1d4 (knife), Save NM, ML -1, AL N, XP 5"));
  assert.equal(values.class, undefined);
  assert.equal(values.level, undefined);
  assert.equal(values["weapon.0.name"], "knife");
});

/* ---------------- renaming ---------------- */

await t("every class, proficiency and spell name passes through rename, by kind", () => {
  const seen = [];
  const rename = (kind, name) => {
    seen.push(kind);
    return `${kind}:${name}`;
  };
  const line = "Lampwright 4; MV 90’, AC 0, HD 4, hp 9, #AT 1, D 1d4; Repertoire: 1st-glimmer; Proficiencies: Ropecraft 2, Steady Hand (glaive)";
  const plan = buildPlan(sheetValuesFromStatline(parseStatline(line), { rename }).values);
  assert.equal(plan.className, "class:Lampwright");
  assert.deepEqual(plan.abilities.map(({ name, selection, rank }) => [name, selection, rank]), [
    ["proficiency:Ropecraft", null, 2],
    ["proficiency:Steady Hand", "glaive", 1],
  ]);
  assert.deepEqual(plan.spells.known, [{ level: 1, name: "spell:glimmer" }]);
  assert.deepEqual([...new Set(seen)].sort(), ["class", "proficiency", "spell"]);
});

/* ---------------- what the sheet has no row for ---------------- */

await t("names past the sheet's last row are handed back, never dropped", () => {
  const profs = Array.from({ length: 22 }, (_, i) => `Craft ${String.fromCharCode(65 + i)}`).join(", ");
  const { values, unplaced } = sheetValuesFromStatline(parseStatline(`MV 90’, AC 0, HD 4, hp 9, #AT 1, D 1d4; Proficiencies: ${profs}`));
  assert.equal(Object.keys(values).filter((k) => /Prof\.\d+\.name$/.test(k)).length, 20);
  assert.deepEqual(unplaced.map((u) => u.kind), ["proficiency", "proficiency"]);
});

/* ---------------- the block ---------------- */

const WORDS = { heading: "As printed", differs: (d) => `${d.sheet} / ${d.inForce}` };

await t("the block carries the line, the differences and the rows", () => {
  const html = asPrintedBlock(
    { id: "zz.npc1", statline: "AC 6 <scale>", differences: [{ label: "Attack throw", sheet: "9+", inForce: "8+" }], rows: [{ label: "Spell", text: "ember wheel" }] },
    WORDS,
  );
  assert.ok(html.startsWith(`<div class="${AS_PRINTED_CLASS}" data-acks-entry="zz.npc1">`));
  assert.ok(html.includes("<p>AC 6 &lt;scale&gt;</p>"), "the line is text, never markup");
  assert.ok(html.includes("<p><strong>Attack throw:</strong> 9+ / 8+</p>"));
  assert.ok(html.includes("<p><strong>Spell:</strong> ember wheel</p>"));
});

await t("the block is the import's own writing, which a rebuild strips", () => {
  const html = `<p>The Judge's note.</p>${asPrintedBlock({ id: "zz.npc1", statline: "AC 6" }, WORDS)}`;
  assert.equal(stripBookText(html).trim(), "<p>The Judge's note.</p>");
});

await t("nothing to say is no block", () => {
  assert.equal(asPrintedBlock({ id: "zz.npc1" }, WORDS), "");
});

/* ---------------- who owns it ---------------- */

await t("a player's ownership is what protects a character; a Judge's is not", () => {
  const OWNER = 3;
  const isPlayer = (id) => id === "player1";
  assert.equal(playerOwned({ default: 0, judge1: 3 }, { isPlayer, owner: OWNER }), false);
  assert.equal(playerOwned({ default: 0, judge1: 3, player1: 3 }, { isPlayer, owner: OWNER }), true);
  assert.equal(playerOwned({ default: 0, player1: 2 }, { isPlayer, owner: OWNER }), false, "observer or limited is not ownership");
  assert.equal(playerOwned({ default: 3 }, { isPlayer, owner: OWNER }), true, "everyone owning it includes every player");
  assert.equal(playerOwned(undefined, { isPlayer, owner: OWNER }), false);
});

console.log(`\ncharacter-binding: ${n} checks OK`);
