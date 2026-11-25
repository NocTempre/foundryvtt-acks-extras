/**
 * Who may write the override layer (scripts/location/table-store.mjs).
 *
 * What this pins: `setOverride` and `clearOverride` ask Foundry's own
 * permission for a world-setting write, `SETTINGS_MODIFY`, and never `isGM`: a
 * seat the world granted it writes, a GM whose world took it away does not.
 * The `ruledata-import` contract carries `setOverride` so another feature
 * writes through the service and not through this file. The writes themselves
 * (the world store, the registry mirror) are the live recipe's.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const store = { value: {} };
const user = { isGM: false, can: () => false };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.game = {
  user,
  settings: {
    get: () => store.value,
    set: async (_module, _key, value) => { store.value = value; },
    register() {},
  },
};
globalThis.acksExtras = { lib: { tables: { PRIORITY: { OVERRIDE: 30 }, registerTable() {}, unregisterTable() {} } } };

const { setOverride, clearOverride, hasOverride, ruledataImport } = await import("../scripts/location/table-store.mjs");

await ok("a seat granted SETTINGS_MODIFY writes and clears an override, GM or not", async () => {
  user.isGM = false;
  user.can = (p) => p === "SETTINGS_MODIFY";
  await setOverride("equipment", "unarmedStrike", { damage: "1d3" }, { sourceName: "test" });
  assert.equal(hasOverride("equipment", "unarmedStrike"), true);
  assert.deepEqual(store.value["equipment:30"].doc.tables.unarmedStrike, { damage: "1d3" });
  await clearOverride("equipment", "unarmedStrike");
  assert.equal(hasOverride("equipment", "unarmedStrike"), false);
  assert.equal("equipment:30" in store.value, false, "the layer is dropped when nothing is left");
});

await ok("a GM whose world withholds the permission does not write", async () => {
  user.isGM = true;
  user.can = () => false;
  await assert.rejects(() => setOverride("equipment", "unarmedStrike", { damage: "1d3" }), /permission to modify world settings/);
  await assert.rejects(() => clearOverride("equipment", "unarmedStrike"), /permission to modify world settings/);
  assert.deepEqual(store.value, {}, "nothing was written");
});

await ok("the contract writes an override through the same test", async () => {
  user.isGM = false;
  user.can = (p) => p === "SETTINGS_MODIFY";
  await ruledataImport.setOverride("equipment", "unarmedStrike", { damage: "1d4" }, { sourceName: "test" });
  assert.deepEqual(store.value["equipment:30"].doc.tables.unarmedStrike, { damage: "1d4" });
  user.can = () => false;
  await assert.rejects(() => ruledataImport.setOverride("equipment", "unarmedStrike", { damage: "1d6" }), /permission to modify world settings/);
});

console.log(`\n${passed} passed`);
