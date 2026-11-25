/**
 * Offline tests for the host a Generate on a family template makes
 * (scripts/monsters/generate-host.mjs): a template whose variants carry an
 * encounter line gets a root group with one empty top row naming it; any
 * other template is answered "not mine". Whether a Roll earns a faction card is
 * a pure decision, tested for a village on a free root group, a village on a
 * faction or joined host, and a warband. Every name in here is invented.
 *
 * Run: node tools/test-generate-host.mjs
 */
import assert from "node:assert/strict";

let n = 0;
globalThis.foundry = { utils: { randomID: () => `id${++n}` } };
const made = [];
globalThis.Actor = { implementation: { async create(data) { made.push(data); return { ...data, name: data.name, sheet: {} }; } } };
const { carriesRecipe, generateHost, isGenerateRoot, listedElsewhere, needsFactionCard, holdsUnitsOfUnits } = await import("../scripts/monsters/generate-host.mjs");

const template = (options, extra = {}) => ({ uuid: "Actor.tpl", name: "Family", img: "fam.png", flags: {}, system: { axes: [{ key: "variant", options }] }, ...extra });
const withLine = template([{ key: "a", flags: { "acks-extras": { extras: { encounter: { wilderness: {} } } } } }]);
const plain = template([{ key: "a", flags: {} }]);

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a template with an encounter line on a variant carries a recipe, and one without does not", () => {
  assert.equal(carriesRecipe(withLine), true);
  assert.equal(carriesRecipe(plain), false);
});

t("Generate on a family makes a root group with one empty top row naming the template, and no faction card", async () => {
  const before = made.length;
  const out = await generateHost(withLine);
  assert.equal(out.handled, true);
  assert.equal(made.length, before + 1, "one document");
  const data = made.at(-1);
  assert.equal(data.type, "acks-extras.group");
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

const village = { top: { children: [{ children: [{ children: [] }] }, { children: [{ children: [] }] }, { camp: true, children: [{ children: [] }] }] } };
const warband = { top: { children: [{ children: [] }, { children: [] }, { camp: true, children: [] }] } };

t("a top unit that holds units that hold units is a village; a warband, a gang and a camp are not", () => {
  assert.equal(holdsUnitsOfUnits(village), true);
  assert.equal(holdsUnitsOfUnits(warband), false);
  assert.equal(holdsUnitsOfUnits({ top: { children: [] } }), false);
  assert.equal(holdsUnitsOfUnits({ top: { children: [{ camp: true, children: [{ children: [] }] }] } }), false, "a camp is no unit");
  assert.equal(holdsUnitsOfUnits(null), false);
});

t("a village rolled at the top of a free root group earns its faction card", () => {
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: true, rowIsTop: true, hostIsFaction: false, joined: false }), true);
});

t("a village on a faction host, or on a group already listed under one, earns no second card", () => {
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: true, rowIsTop: true, hostIsFaction: true, joined: false }), false);
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: true, rowIsTop: true, hostIsFaction: false, joined: true }), false);
});

t("a warband or gang roll, or a roll below the top, earns no card", () => {
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: false, rowIsTop: true, hostIsFaction: false, joined: false }), false);
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: true, rowIsTop: false, hostIsFaction: false, joined: false }), false);
});

const fresh = { key: "k1", parentKey: "", holderUuid: "", gen: { template: "Actor.tpl" } };

t("the empty top row Generate wrote on its own root group is recognised, and nothing a Judge or a Roll touched is", () => {
  assert.equal(isGenerateRoot({ rows: [fresh], row: fresh }), true);
  assert.equal(isGenerateRoot({ rows: [fresh, { ...fresh, key: "k2", parentKey: "k1" }], row: fresh }), false, "an Add made a second row");
  assert.equal(isGenerateRoot({ rows: [{ ...fresh, holderUuid: "Actor.g" }], row: { ...fresh, holderUuid: "Actor.g" } }), false, "a filled row");
  assert.equal(isGenerateRoot({ rows: [{ ...fresh, parentKey: "k0" }], row: { ...fresh, parentKey: "k0" } }), false, "a row below the top");
  assert.equal(isGenerateRoot({ rows: [fresh], row: fresh, stacks: 2 }), false, "a group already holding stacks");
  assert.equal(isGenerateRoot({ rows: [fresh], row: fresh, officerUuid: "Actor.o" }), false, "a group with an officer");
  const picked = { ...fresh, gen: { template: "Actor.tpl", troop: "x" } };
  assert.equal(isGenerateRoot({ rows: [picked], row: picked }), false, "a row that carries a pick or a record is no fresh Generate");
  const bare = { ...fresh, gen: {} };
  assert.equal(isGenerateRoot({ rows: [bare], row: bare }), false, "a hand-added row names no template");
  assert.equal(isGenerateRoot({ rows: [fresh], row: null }), false);
  assert.equal(isGenerateRoot(), false);
});

t("a root group whose own top row names it is not listed elsewhere, so its village still earns the card; a group under another chart is", () => {
  assert.equal(listedElsewhere({ host: { uuid: "Actor.g" } }, "Actor.g"), false, "its own chart");
  assert.equal(listedElsewhere({ host: { uuid: "Actor.f" } }, "Actor.g"), true, "a faction or another group's chart");
  assert.equal(listedElsewhere(null, "Actor.g"), false, "no chart names it");
  assert.equal(needsFactionCard({ holdsUnitsOfUnits: true, rowIsTop: true, hostIsFaction: false, joined: listedElsewhere({ host: { uuid: "Actor.g" } }, "Actor.g") }), true);
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
