/**
 * Offline tests for the host a Generate on a family template makes
 * (scripts/monsters/generate-host.mjs): a template whose variants carry an
 * encounter line gets a faction card with one empty top row naming it; any
 * other template is answered "not mine". Every name in here is invented.
 *
 * Run: node tools/test-generate-host.mjs
 */
import assert from "node:assert/strict";

let n = 0;
globalThis.foundry = { utils: { randomID: () => `id${++n}` } };
const made = [];
globalThis.Actor = { implementation: { async create(data) { made.push(data); return { ...data, name: data.name, sheet: {} }; } } };
const { carriesRecipe, generateHost, HOST_TAB } = await import("../scripts/monsters/generate-host.mjs");

const template = (options, extra = {}) => ({ uuid: "Actor.tpl", name: "Family", img: "fam.png", flags: {}, system: { axes: [{ key: "variant", options }] }, ...extra });
const withLine = template([{ key: "a", flags: { "acks-extras": { extras: { encounter: { wilderness: {} } } } } }]);
const plain = template([{ key: "a", flags: {} }]);

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a template with an encounter line on a variant carries a recipe, and one without does not", () => {
  assert.equal(carriesRecipe(withLine), true);
  assert.equal(carriesRecipe(plain), false);
});

t("Generate on a family makes a faction card with one empty top row naming the template, and opens it on the chart tab", async () => {
  const out = await generateHost(withLine);
  assert.equal(out.handled, true);
  assert.equal(out.tab, HOST_TAB);
  const data = made.at(-1);
  assert.equal(data.type, "acks-extras.faction");
  assert.equal(data.system.units.length, 1);
  assert.equal(data.system.units[0].holderUuid, "");
  assert.equal(data.system.units[0].parentKey, "");
  assert.deepEqual(data.system.units[0].gen, { template: "Actor.tpl" });
  assert.equal(data.img, "fam.png");
});

t("a family's plate, where one was imported, is the card's picture", async () => {
  await generateHost({ ...withLine, flags: { "acks-extras": { plate: "plate.webp" } } });
  assert.equal(made.at(-1).img, "plate.webp");
});

t("a template with no recipe is answered not mine and nothing is made", async () => {
  const before = made.length;
  assert.deepEqual(await generateHost(plain), { handled: false });
  assert.equal(made.length, before);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-generate-host: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
