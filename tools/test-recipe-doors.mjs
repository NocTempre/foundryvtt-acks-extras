/**
 * Offline tests for the recipe editor's door on the family template sheet
 * (scripts/monsters/recipe-doors.mjs): which rows get a button, from the axes'
 * data alone, and what the button says. Foundry-free; every axis, option and
 * word below is invented.
 *
 * Run: node tools/test-recipe-doors.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doorFor } from "../scripts/monsters/recipe-doors.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const ROOT = "ACKS-MONSTERS";
const say = (key, data = {}) => (LANG[`${ROOT}.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(data[n] ?? ""));

const AXES = [
  { key: "role", label: "Station", options: [{ key: "rank", label: "Rank" }, { key: "chief", label: "Chief" }] },
  { key: "variant", label: "Whatever the label says", options: [{ key: "alpha", label: "Alpha" }, { key: "beta", label: "" }] },
];

t("a row of the variant axis gets a door naming its option and carrying its keys", () => {
  const door = doorFor(AXES, { axisKey: "variant", optionKey: "alpha" }, say);
  assert.deepEqual(door, { axisKey: "variant", optionKey: "alpha", label: say("recipe.door.option"), aria: say("recipe.door.optionAria", { option: "Alpha" }) });
  assert.match(door.aria, /Alpha/);
});

t("an option with no label is named by its key", () => {
  assert.match(doorFor(AXES, { axisKey: "variant", optionKey: "beta" }, say).aria, /beta/);
});

t("a row of any other axis gets none, whatever the axis is labelled", () => {
  assert.equal(doorFor(AXES, { axisKey: "role", optionKey: "rank" }, say), null);
  const relabelled = [{ key: "other", label: "Variant", options: [{ key: "alpha" }] }];
  assert.equal(doorFor(relabelled, { axisKey: "other", optionKey: "alpha" }, say), null, "the key decides, never the label");
});

t("a row that names no listed option, or no axis, gets none", () => {
  assert.equal(doorFor(AXES, { axisKey: "variant", optionKey: "gamma" }, say), null);
  assert.equal(doorFor(AXES, { axisKey: "variant", optionKey: "" }, say), null);
  assert.equal(doorFor([], { axisKey: "variant", optionKey: "alpha" }, say), null);
  assert.equal(doorFor(undefined, { axisKey: "variant", optionKey: "alpha" }, say), null);
  assert.equal(doorFor(AXES, undefined, say), null);
});

t("the door's words exist in the language file", () => {
  for (const key of ["recipe.door.ecology", "recipe.door.ecologyAria", "recipe.door.option", "recipe.door.optionAria"]) {
    assert.ok(LANG[`${ROOT}.${key}`], key);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.message}`); }
}
console.log(`\nrecipe doors: ${tests.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
