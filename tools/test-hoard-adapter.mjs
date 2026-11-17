/**
 * The hoard adapter over mocked Foundry globals: the registry read, the dice,
 * the world's coin and the typed answer when nothing is imported. The tables
 * are invented; the mapping itself is `test-hoard-map.mjs`.
 */
import assert from "node:assert/strict";

const coins = [
  { name: "Brass", type: "money", system: { coppervalue: 100, quantity: 1, unitweight: 1 } },
  { name: "Tin", type: "money", system: { coppervalue: 1, quantity: 1, unitweight: 1 } },
];
let shelf = coins;
globalThis.game = {
  i18n: {
    lang: "en",
    localize: (key) => ({ "ACKS-TREASURE.hoard.coin.cp": "Tin", "ACKS-TREASURE.hoard.coin.gp": "Brass" })[key] ?? key,
  },
  items: { find: (fits) => { const hit = shelf.find((c) => fits(c)); return hit ? { toObject: () => structuredClone(hit) } : undefined; } },
  packs: [],
};
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };

const { dealHoard } = await import("../scripts/treasure/hoard.mjs");
const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");

let n = 0;
const eq = (got, want, label) => { assert.deepEqual(got, want, label); n++; };
const ok = (cond, label) => { assert.ok(cond, label); n++; };

resetTables();
const none = await dealHoard({ letter: "Z" });
eq(none.truths, [], "nothing imported deals nothing");
eq(none.errors, [{ code: "not-imported", table: "treasure" }], "and says so, typed");
eq(none.cite, null, "with no cite");

registerTable({
  id: "treasure",
  cites: { typeClassic: "INV p. 1" },
  tables: {
    typeClassic: { Z: { category: "Odds", avgValue: null, cp: "2", sp: null, ep: null, gp: "3", pp: null, gems: null, jewelry: null, magic: null } },
    typeUnits: { classic: { cp: "37s", gp: "37s" } },
  },
}, { priority: PRIORITY.WORLD });

const toggles = { noMagic: false, forceCursed: true };
const got = await dealHoard({ letter: "Z", toggles });
eq(got.truths.map((t) => [t.label, t.coin.name, t.coin.cv, t.coin.count]), [["74 Tin", "Tin", 1, 74], ["111 Brass", "Brass", 100, 111]], "coins counted in the unit, named by the world's own coin");
ok(got.truths.every((t) => Number.isFinite(t.weight6)), "each coin card carries a weight");
eq(got.errors, [], "no special list is read unless asked for");
eq(got.cite, "INV p. 1", "the cite is the registry's for the type table");
eq(got.toggles, toggles, "forceCursed and noMagic are handed back as they came");

const asked = await dealHoard({ letter: "Z", special: true });
eq(asked.errors, [{ code: "special-missing" }], "special treasure asked for and not imported is named once");

shelf = [coins[0]];
const noTin = await dealHoard({ letter: "Z" });
eq(noTin.truths.map((t) => t.coin.name), ["Brass"], "a coin the world lacks is not dealt");
ok(noTin.errors.some((e) => e.code === "coin-missing" && e.key === "cp"), "and is named");

eq((await dealHoard({ letter: "Q" })).errors[0].code, "unknown-type", "a letter the table lacks");
eq((await dealHoard({ letter: "Z", style: "gritty" })).errors, [{ code: "not-imported", table: "typeGritty" }], "a style never imported");

console.log(`test-hoard-adapter: ${n} checks passed`);
