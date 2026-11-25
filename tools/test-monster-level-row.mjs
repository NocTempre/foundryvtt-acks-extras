/**
 * The RollTable sheet's "Monster level" row follows the sheet's own editability
 * (`app.isEditable`, which is Foundry's OWNER test for a table), never a role:
 * an editable sheet gets the row once, whoever the user is, and a read-only
 * sheet gets none.
 */
import assert from "node:assert/strict";

const hooks = {};
globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
globalThis.game = { user: { isGM: false }, i18n: { localize: (key) => key } };
globalThis.foundry = { utils: { escapeHTML: (text) => text } };
globalThis.document = { createElement: () => ({}) };

const { installMonsterLevelRow } = await import("../scripts/formation/monster-level-row.mjs");
installMonsterLevelRow();
assert.equal(typeof hooks.renderRollTableSheet, "function", "the row installs on the RollTable sheet's render");

/** A sheet's root with a Summary tab that records what is appended to it. */
const sheetRoot = () => {
  const appended = [];
  const summary = {
    appended,
    querySelector: (selector) => (selector === ".acks-extras-monster-level" ? appended[0] ?? null : null),
    append: (node) => appended.push(node),
  };
  return { nodeType: 1, summary, querySelector: (selector) => (selector === '.tab[data-tab="summary"]' ? summary : null) };
};
const sheet = (isEditable, level = null) => ({
  isEditable,
  document: { getFlag: () => level, flags: {} },
});

const owned = sheetRoot();
hooks.renderRollTableSheet(sheet(true, 4), owned);
assert.equal(owned.summary.appended.length, 1, "a non-GM seat that owns the table is given the row");
assert.match(owned.summary.appended[0].innerHTML, /value="4"/, "carrying the table's level");
hooks.renderRollTableSheet(sheet(true, 4), owned);
assert.equal(owned.summary.appended.length, 1, "and a second render adds no second row");

const readOnly = sheetRoot();
hooks.renderRollTableSheet(sheet(false), readOnly);
assert.equal(readOnly.summary.appended.length, 0, "a sheet that is not editable for the seat has no row");

globalThis.game.user.isGM = true;
const judged = sheetRoot();
hooks.renderRollTableSheet(sheet(false), judged);
assert.equal(judged.summary.appended.length, 0, "the sheet's editability decides, a Judge's role does not");
hooks.renderRollTableSheet(sheet(true), judged);
assert.equal(judged.summary.appended.length, 1, "and the Judge's editable sheet has it");

console.log("test-monster-level-row: OK (the row follows the sheet's editability, once per sheet)");
