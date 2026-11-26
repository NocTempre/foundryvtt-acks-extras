/**
 * The location pack's macros (tools/pack-data/location.mjs): each command's
 * guard passes on a build that carries what the command calls, and stops with
 * the newer-build notice on one that does not.
 */
import assert from "node:assert/strict";
import { buildMacros } from "./pack-data/location.mjs";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Run a macro's command against `api`, with nothing selected and no character, and return the notices it raised. */
async function runWith(command, api) {
  const notices = [];
  const note = (level) => (message) => void notices.push([level, String(message)]);
  const game = { modules: { get: () => ({ api }) }, user: { character: null } };
  const ui = { notifications: { error: note("error"), warn: note("warn"), info: note("info") } };
  const canvas = { tokens: { controlled: [] } };
  await new AsyncFunction("game", "ui", "canvas", command)(game, ui, canvas);
  return notices;
}

/** The lib's storage as the module api holds it: a namespace of functions, never a function itself. */
const storage = Object.freeze({ setProvider: async () => {}, isProvider: () => false, storedItems: () => [], providersFor: () => [] });
const api = { lib: { storage }, location: { openStorageManager: () => {} } };
const NEWER = /needs a newer build/;

let passed = 0;
for (const macro of buildMacros()) {
  const ready = await runWith(macro.command, api);
  assert.ok(!ready.some(([, text]) => NEWER.test(text)), `${macro.name}: the guard passes on this build (${JSON.stringify(ready)})`);
  assert.ok(!ready.some(([level]) => level === "error"), `${macro.name}: no error with the module active`);
  const old = await runWith(macro.command, { lib: { storage: {} }, location: {} });
  assert.ok(old.some(([, text]) => NEWER.test(text)), `${macro.name}: a build without the function gets the newer-build notice`);
  const off = await runWith(macro.command, undefined);
  assert.deepEqual(off.map(([level]) => level), ["error"], `${macro.name}: an inactive module is named`);
  passed++;
}
assert.equal(passed, 4, "the pack's four macros");

console.log(`test-location-macros: ${passed} macros passed.`);
