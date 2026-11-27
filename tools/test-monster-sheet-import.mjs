/**
 * monsters/monster-sheet.mjs: the module loads. The sheet is built at ready
 * from a base class the system registers, so nothing else offline reaches the
 * file; this suite imports it and its whole import graph, which fails on a
 * syntax error or an unresolved import before a world would die at load.
 *
 * Nothing is rendered: the Foundry globals the import graph reads at load are
 * stubs, and the sheet is built once from a bare base class.
 *
 * Run: node tools/test-monster-sheet-import.mjs
 */
import assert from "node:assert/strict";

globalThis.acksExtras = {};
globalThis.game = { i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
// The import graph subclasses core's data model and mixes into the application
// base at load; nothing here constructs either.
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { fields: {}, operators: { ForcedDeletion: class {} } },
  utils: {},
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {}, DialogV2: class {} } },
};

let pass = 0;
const check = (label, fn) => {
  try {
    fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${label}`);
    throw err;
  }
};

const mod = await import("../scripts/monsters/monster-sheet.mjs");

check("the module exports the sheet factory and the template list", () => {
  assert.equal(typeof mod.createFullMonsterSheet, "function");
  assert.ok(Array.isArray(mod.MONSTER_SHEET_TEMPLATES) && mod.MONSTER_SHEET_TEMPLATES.length > 0);
});

check("the factory builds a sheet class over a base class, with its tab strip and parts declared", () => {
  const Sheet = mod.createFullMonsterSheet(class Base {});
  assert.equal(typeof Sheet, "function", "a class comes back");
  const ids = Sheet.TABS.primary.tabs.map((t) => t.id);
  assert.ok(ids.includes("statblock"), "the initial tab is in the strip");
  assert.equal(Sheet.TABS.primary.initial, "statblock");
  assert.ok(Sheet.PARTS.band && Sheet.PARTS.body, "the band and the body parts are declared");
});

console.log(`monster-sheet import: ${pass} passed`);
