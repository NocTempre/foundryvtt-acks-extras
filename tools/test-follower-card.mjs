#!/usr/bin/env node
/**
 * The Follower Card's decisions on plain data (scripts/lib/follower-card-model.mjs):
 * how a weight prints, how Hit Dice and a damage line read, what the rank
 * says, which save targets a body has and under which keys, how prose
 * shortens, and which rows a star list picks.
 */
import assert from "node:assert";
import { stones, hdText, withMod, throwFigure, rankLine, saveTargets, savesLine, appearingSides, oneLine, starredRows, toggleStar, shownDamageBonus, STAR_FLAG } from "../scripts/lib/follower-card-model.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("follower card: the printed figures");

test("a weight in sixths prints as stones and the sixths left over", () => {
  assert.equal(stones(0), "0");
  assert.equal(stones(6), "1");
  assert.equal(stones(20), "3 2/6");
  assert.equal(stones(5.4), "0 5/6");
  assert.equal(stones(-3), "0");
});

test("Hit Dice print whole, or as the fraction glyph", () => {
  assert.equal(hdText(2), "2");
  assert.equal(hdText(0.5), "½");
  assert.equal(hdText(0.25), "¼");
  assert.equal(hdText("3"), "3");
});

test("a damage line carries a modifier only when there is one", () => {
  assert.equal(withMod("1d6", 1), "1d6+1");
  assert.equal(withMod("1d6", -2), "1d6−2");
  assert.equal(withMod("1d6", 0), "1d6");
  assert.equal(withMod("", 3), "");
});

test("an attack throw prints as its target, and as nothing where it is not a number", () => {
  assert.equal(throwFigure(9), "9+");
  assert.equal(throwFigure(0), "0+");
  for (const none of [null, undefined, "", NaN, "x"]) assert.equal(throwFigure(none), "", `${String(none)} prints no figure`);
});

console.log("follower card: the rank under the name");

test("a classed body reads class and level; a creature reads Hit Dice and its type", () => {
  assert.equal(rankLine({ klass: "Fighter", level: 2 }), "Fighter 2");
  assert.equal(rankLine({ hd: "2", hdWord: "HD", typeLabel: "Monster" }), "2 HD · Monster");
  assert.equal(rankLine({ hd: "½", hdWord: "HD" }), "½ HD");
  assert.equal(rankLine({ klass: "Fighter", level: "" }), "Fighter");
  assert.equal(rankLine({ typeLabel: "Animal" }), "Animal");
  assert.equal(rankLine({}), "");
});

console.log("follower card: the saves");

test("save targets come in the frame's order, from the new keys or the legacy ones", () => {
  const saves = { death: { value: 13 }, wand: { value: 15 }, paralysis: { value: 14 }, breath: { value: 16 }, spell: { value: 17 } };
  assert.deepEqual(saveTargets(saves), [14, 13, 16, 15, 17]);
  const fresh = { death: { value: 13 }, implements: { value: 15 }, paralysis: { value: 14 }, blast: { value: 16 }, spell: { value: 17 } };
  assert.deepEqual(saveTargets(fresh), [14, 13, 16, 15, 17]);
  assert.equal(savesLine(saveTargets(saves)), "14 · 13 · 16 · 15 · 17");
});

test("a body that stores no save has no targets", () => {
  assert.equal(saveTargets(null), null);
  assert.equal(saveTargets({}), null);
  assert.deepEqual(saveTargets({ death: { value: 13 } }), [0, 13, 0, 0, 0]);
});

test("number appearing offers a roll per side that stores a formula, dungeon first", () => {
  assert.deepEqual(appearingSides({ w: "3d10", d: " 2d6 " }), [
    { check: "dungeon", formula: "2d6" },
    { check: "wilderness", formula: "3d10" },
  ]);
  assert.deepEqual(appearingSides({ d: "", w: "1d4" }), [{ check: "wilderness", formula: "1d4" }]);
  assert.deepEqual(appearingSides(null), []);
});

console.log("follower card: the lines");

test("prose shortens to one line, tags and entities gone", () => {
  assert.equal(oneLine("<p>Keen&nbsp;nose: tracks by scent.</p>"), "Keen nose: tracks by scent.");
  assert.equal(oneLine("  spaced   out  "), "spaced out");
  assert.equal(oneLine(null), "");
});

test("a long line cuts at a sentence end past the floor, else at the ceiling on a word", () => {
  const two = "The first sentence runs on for a while here. The second sentence is never shown at all on the card.";
  assert.equal(oneLine(two), "The first sentence runs on for a while here.…");
  const words = "word ".repeat(40).trim();
  const cut = oneLine(words);
  assert.ok(cut.length <= 73 && cut.endsWith("…") && !cut.includes("  "), cut);
  assert.equal(oneLine("short enough"), "short enough");
});

console.log("follower card: the stars");

test("starred rows are the rows the star list names, in the rows' order", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(starredRows(rows, ["c", "a"]), [{ id: "a" }, { id: "c" }]);
  assert.deepEqual(starredRows(rows, []), []);
  assert.deepEqual(starredRows(rows, null), []);
});

test("a star toggles on and off and the flag has a name", () => {
  assert.deepEqual(toggleStar([], "a"), ["a"]);
  assert.deepEqual(toggleStar(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggleStar(null, "x"), ["x"]);
  assert.equal(STAR_FLAG, "fcStarred");
});

console.log("follower card: Commit on attack rows");

// The sheet module subclasses core's sheet classes at load; nothing here constructs one.
class ForcedDeletion {}
globalThis.acksExtras = {};
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k } };
globalThis.Hooks = { once() {}, on() {}, callAll() {}, call() {} };
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { fields: {}, operators: { ForcedDeletion } },
  utils: {},
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {}, DialogV2: class {} }, sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} } },
};
const { planAttackCommit } = await import("../scripts/lib/apps/follower-card-sheet.mjs");
const has = (...ids) => (id) => ids.includes(id);

test("a baked field is cleared by its own key and a throw override stands", () => {
  const { itemUpdates, cleared } = planAttackCommit({ "w1:0": { label: "Blade", damage: "1d8", bonus: 2, target: 8 } }, has("w1"));
  assert.deepEqual(itemUpdates, [{ _id: "w1", name: "Blade", "system.damage.base.formula": "1d8", "system.bonus.attack": 2 }]);
  assert.deepEqual(Object.keys(cleared).sort(), ["attacks.w1:0.bonus", "attacks.w1:0.damage", "attacks.w1:0.label"]);
  assert.ok(Object.values(cleared).every((v) => v instanceof ForcedDeletion));
});

test("a damage-bonus override stands beside a baked damage formula", () => {
  const { cleared } = planAttackCommit({ "w1:0": { damage: "1d6", damageBonus: 3 } }, has("w1"));
  assert.deepEqual(Object.keys(cleared), ["attacks.w1:0.damage"]);
});

test("a row with nothing left standing is removed whole", () => {
  const { cleared } = planAttackCommit({ "w1:0": { label: "Blade", bonus: 1 } }, has("w1"));
  assert.deepEqual(Object.keys(cleared), ["attacks.w1:0"]);
});

test("a row with only an unbakeable field, or no item, writes and clears nothing", () => {
  assert.deepEqual(planAttackCommit({ "w1:0": { target: 8 }, "gone:0": { label: "X" } }, has("w1")), { itemUpdates: [], cleared: {} });
  assert.deepEqual(planAttackCommit(undefined, has()), { itemUpdates: [], cleared: {} });
});

console.log("follower card: the damage figure a row shows");

const body = { system: { damage: { mod: { melee: 1, missile: 3 } } } };
const arm = (damage) => ({ system: { bonus: { attack: 0, damage } } });

test("the shown damage bonus is the actor's adjustment for the side, as before, with no weapon", () => {
  assert.equal(shownDamageBonus(body, "melee"), 1);
  assert.equal(shownDamageBonus(body, "missile"), 3);
  assert.equal(shownDamageBonus(body, "thrown"), 1, "any other kind reads the melee side");
  assert.equal(shownDamageBonus({ system: {} }, "melee"), 0);
});

test("the weapon's own damage bonus is part of the figure shown, so a take-back leaves the die alone", () => {
  assert.equal(shownDamageBonus(body, "melee", arm(-1)), 0);
  assert.equal(shownDamageBonus(body, "missile", arm(2)), 5);
  assert.equal(shownDamageBonus(body, "melee", { system: { bonus: 0 } }), 1, "a bare-number bonus holds no damage figure");
  assert.equal(shownDamageBonus(body, "melee", null), 1);
});

test("an override's delta is measured against the figure shown, the weapon's bonus included", () => {
  const typed = 2;
  assert.equal(typed - shownDamageBonus(body, "melee"), 1);
  assert.equal(typed - shownDamageBonus(body, "melee", arm(-1)), 2, "the system adds the weapon's bonus itself, so the delta is what the typed figure lacks of it");
  assert.equal(shownDamageBonus(body, "melee", arm(-1)) + (typed - shownDamageBonus(body, "melee", arm(-1))), typed, "the roll carries the figure typed");
});

console.log(`follower card: ${passed} passed`);
