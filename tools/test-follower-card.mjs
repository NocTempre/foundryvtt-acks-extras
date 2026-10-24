#!/usr/bin/env node
/**
 * The Follower Card's decisions on plain data (scripts/lib/follower-card-model.mjs):
 * how a weight prints, how Hit Dice and a damage line read, what the rank
 * says, which save targets a body has and under which keys, how prose
 * shortens, and which rows a star list picks.
 */
import assert from "node:assert";
import { stones, hdText, withMod, rankLine, saveTargets, savesLine, oneLine, starredRows, toggleStar, STAR_FLAG } from "../scripts/lib/follower-card-model.mjs";

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

console.log(`follower card: ${passed} passed`);
