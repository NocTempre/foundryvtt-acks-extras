/**
 * The cards and strips an item raised draws (`item-run-card-logic.mjs`), offline:
 * the raised-item card's rows by state (open with a Roll, applied with its result
 * and a Judge's Undo, out of reach, not a target), the footer's two buttons for a
 * Judge alone, the whispered save card, the strip a body in reach reads, the
 * morale line, and the three tooltips (read from an import, computed, and the
 * page reference alone). Foundry-free; every name and figure is invented.
 *
 * Usage: node tools/test-item-run-cards.mjs
 */
import assert from "node:assert/strict";
import { blankTip, importTip, moraleLine, reachCardModel, saveCardModel, saveTip, stripModel } from "../scripts/lib/item-run-card-logic.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const words = { roll: "Roll", undo: "Undo", saved: "Holds", failed: "Fails", out: "Out of reach", notTarget: "Not a target" };
const ids = { itemUuid: "I.1", rowKey: "reach", activationId: "act" };
const rows = [
  { key: "T.a", name: "Alpha", feet: 12, state: "open" },
  { key: "T.b", name: "Beta", feet: 20, state: "applied", saved: false, total: 7, target: 11, targetTip: "tip", recordIds: ["E1"] },
  { key: "T.c", name: "Gamma", feet: 9, state: "applied", saved: true, total: 15, target: 11, recordIds: [] },
  { key: "T.d", name: "Delta", feet: 40, state: "out" },
  { key: "T.e", name: "Epsilon", state: "notTarget" },
];

t("the raised-item card: a Roll on an open row, the result and target on an applied one, an Undo for a Judge only where ids were stored, and a greyed word for a body out of reach or no target", () => {
  const card = reachCardModel({ title: "Item", subtitle: "Bearer", note: "Reaches", noteTooltip: "n", words, rows, ids, isGM: true, footer: { check: "Check", lower: "Lower" } });
  const [open, failed, held, out, none] = card.sections[0].rows;
  assert.deepEqual(open.actions.map((a) => [a.action, a.data.subject]), [["itemRun.roll", "T.a"]]);
  assert.equal(open.detail, "12′", "the distance, under the name");
  assert.deepEqual([failed.outcome, failed.emphasis, failed.total, failed.target, failed.targetTooltip], ["Fails", "failure", 7, 11, "tip"]);
  assert.deepEqual(failed.actions.map((a) => a.action), ["itemRun.undo"]);
  assert.equal(held.outcome, "Holds");
  assert.equal(held.actions, undefined, "no ids stored, nothing to undo");
  assert.deepEqual([out.outcome, out.emphasis, out.actions], ["Out of reach", "neutral", undefined]);
  assert.equal(none.outcome, "Not a target");
  assert.equal(none.detail, undefined);
  assert.deepEqual(card.buttons.map((b) => b.action), ["itemRun.recheck", "itemRun.lower"]);
  const player = reachCardModel({ title: "Item", words, rows, ids, isGM: false, footer: { check: "Check", lower: "Lower" } });
  assert.equal(player.buttons, undefined, "the footer is the Judge's");
  assert.equal(player.sections[0].rows[1].actions, undefined, "and so is Undo");
});

t("the whispered save card names the target and its tooltip and carries the one Roll", () => {
  const card = saveCardModel({ title: "Item", subtitle: "Body", words: { save: "Save", roll: "Roll the save" }, target: 12, targetTip: "why", ids, subject: "T.a" });
  const row = card.sections[0].rows[0];
  assert.deepEqual([row.target, row.targetTooltip], [12, "why"]);
  assert.deepEqual(row.actions[0].data, { ...ids, subject: "T.a" });
  assert.equal(saveCardModel({ title: "x", subtitle: "y", words: { save: "S", roll: "R" }, target: null, ids, subject: "s" }).sections[0].rows[0].target, undefined, "a blank target is no number");
});

t("the strip lists what meets a body and is absent when nothing does; the morale line names the item and the figure", () => {
  assert.deepEqual(stripModel([]), { count: 0, rows: [] });
  const strip = stripModel([{ name: "Item", owed: true, target: 12, feet: 15, tip: "t" }, { name: "Other", owed: false }]);
  assert.equal(strip.count, 2);
  assert.deepEqual(strip.rows.map((r) => r.tag), ["owed", "always"]);
  assert.equal(strip.rows[1].target, undefined);
  assert.deepEqual(moraleLine({ item: "Item", value: 1, cite: "XX p. 1", words: { inReachOf: "In reach of" } }), { left: "In reach of Item", right: "+1", cite: "XX p. 1" });
  assert.equal(moraleLine({ item: "Item", value: -2, words: { inReachOf: "In reach of" } }).right, "−2");
});

t("a figure's tooltip says where it came from: the import's row and page, the computed parts with the page, or the page reference alone", () => {
  assert.equal(importTip({ label: "Row", figure: "radius", cite: "XX p. 4" }), "Row: radius (XX p. 4)");
  assert.equal(importTip({ label: "Row", figure: "radius", cite: null }), null, "no page, no tooltip: a finding to register");
  assert.equal(saveTip({ save: "Alpha", target: 12, parts: [{ label: "base", value: 10 }, { label: "ring", value: -1 }], cite: "XX p. 9" }), "Alpha 12+: base +10 · ring -1 (XX p. 9)");
  assert.equal(saveTip({ save: "Alpha", target: 12 }), "Alpha 12+");
  assert.equal(blankTip({ cite: "XX p. 4" }), "XX p. 4");
  assert.equal(blankTip({}), null);
});

console.log(`\ntest-item-run-cards: ${passed} checks passed.`);
