/**
 * The cards and strips an item raised draws (`item-run-card-logic.mjs`), offline:
 * the raised-item card's rows by state (open with a Save, applied with its result
 * and a Judge's Undo, waiting with the Judge's early press, muted out of reach or
 * no target), each seat's share of it, the bearer's own section, the well, the
 * card's store and the patches that change it, the whispered save card, the strip a body in reach reads, the
 * morale line, and the three tooltips (read from an import, computed, and the
 * page reference alone). Foundry-free; every name and figure is invented.
 *
 * Usage: node tools/test-item-run-cards.mjs
 */
import assert from "node:assert/strict";
import { applyPatch, blankTip, freshKey, importTip, moraleLine, newCard, patchOut, patchPrompt, patchSubject, patchUndetermined, reachCardModel, rowStateOf, safeKey, saveCardModel, saveTip, stripModel } from "../scripts/lib/item-run-card-logic.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const words = {
  roll: "Roll", undo: "Undo", saved: "Holds", failed: "Fails", out: "Out of reach", notTarget: "Not a target", waiting: "Waits", asked: "Asked", undone: "Undone", undetermined: "Could not be settled",
  save: "Save", rollSave: "Roll the save", tick: "Count in", bearer: "The bearer", well: "On a failed save", check: "Check range again", lower: "Lower", colDistance: "Distance",
  earlyTip: "early tip", saveTip: "save tip", undoTip: "undo tip", tickTip: "tick tip", bearerTip: "bearer tip", checkTip: "check tip", lowerTip: "lower tip",
};
const ids = { itemUuid: "I.1", rowKey: "reach", activationId: "act" };
const rows = [
  { key: "T.a", name: "Alpha", feet: 12, feetTip: "12 now", state: "open", entryKey: "k1", target: 11, targetTip: "ttip" },
  { key: "T.b", name: "Beta", feet: 20, state: "applied", entryKey: "k2", entry: { saved: false, total: 7, recordIds: ["E1"] }, target: 11, targetTip: "tip" },
  { key: "T.c", name: "Gamma", feet: 9, state: "applied", entryKey: "k3", entry: { saved: true, total: 15, recordIds: [] }, target: 11 },
  { key: "T.d", name: "Delta", feet: 40, state: "out" },
  { key: "T.e", name: "Epsilon", state: "notTarget" },
  { key: "T.f", name: "Zeta", feet: 5, state: "waiting" },
  { key: "T.g", name: "Eta", feet: 6, state: "undone", entryKey: "k4" },
];
const bearer = { key: "T.bear", name: "Bearer", counted: false };
const judge = { isGM: true, ownsSubject: () => true, ownsBearer: true, ownsItem: true };
const names = (card, section = 0) => card.sections[section].rows.map((r) => r.name);

t("the raised-item card by row state: a Save on an open row, a result and a Judge's Undo on an applied one, a muted word out of reach or no target, a waiting word with the Judge's early press", () => {
  const card = reachCardModel({ title: "Item", subtitle: "Bearer", note: "Reaches", noteTooltip: "n", words, rows, bearer, ids, seat: judge });
  const [open, failed, held, out, none, waiting, undone] = card.sections[0].rows;
  assert.deepEqual(open.actions.map((a) => [a.action, a.label, a.data.subject, a.data.entryKey, a.tooltip]), [["itemRun.roll", "Save", "T.a", "k1", "save tip"]]);
  assert.deepEqual([open.aside, open.asideTooltip, open.target, open.targetTooltip, open.outcome], ["12′", "12 now", 11, "ttip", "Asked"], "the distance is an aside with its tooltip, and the save's target is its own column");
  assert.equal(open.detail, undefined, "no distance under the name");
  assert.deepEqual([failed.outcome, failed.emphasis, failed.total, failed.target, failed.targetTooltip], ["Fails", "failure", 7, 11, "tip"]);
  assert.deepEqual(failed.actions.map((a) => [a.action, a.data.entryKey]), [["itemRun.undo", "k2"]]);
  assert.equal(held.outcome, "Holds");
  assert.equal(held.actions, undefined, "no ids stored, nothing to undo");
  assert.deepEqual([out.outcome, out.emphasis, out.actions, out.aside], ["Out of reach", "muted", undefined, "40′"]);
  assert.deepEqual([none.outcome, none.emphasis, none.aside], ["Not a target", "muted", undefined]);
  assert.deepEqual([waiting.outcome, waiting.emphasis, waiting.actions.map((a) => [a.action, a.data.entryKey, a.tooltip])], ["Waits", undefined, [["itemRun.roll", undefined, "early tip"]]], "a waiting row has no entry to name");
  assert.deepEqual([undone.outcome, undone.emphasis], ["Undone", "muted"]);
  assert.deepEqual(card.buttons.map((b) => [b.action, b.tooltip]), [["itemRun.recheck", "check tip"], ["itemRun.lower", "lower tip"]]);
  assert.equal(card.labels.aside, "Distance");
  assert.equal(card.bare, true);
});

t("a seat sees the rows of the tokens it owns, an owner who is no Judge sees a waiting row with no press, and a Judge's buttons are the bearer's owners'", () => {
  const owner = { isGM: false, ownsSubject: (key) => key === "T.a" || key === "T.f", ownsBearer: false, ownsItem: false };
  const card = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: owner });
  assert.deepEqual(names(card), ["Alpha", "Zeta"], "only its own rows");
  assert.deepEqual(card.sections[0].rows[0].actions.map((a) => a.action), ["itemRun.roll"], "the owner of the subject saves");
  assert.deepEqual(card.sections[0].rows[1].actions, [], "a waiting row has no press for an owner who is not a Judge");
  assert.equal(card.buttons, undefined, "no footer for a seat that does not own the bearer");
  assert.equal(card.sections.length, 1, "nor the bearer's section");
  const bearerOwner = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: { isGM: false, ownsSubject: () => false, ownsBearer: true, ownsItem: false } });
  assert.deepEqual(bearerOwner.buttons.map((b) => b.action), ["itemRun.recheck", "itemRun.lower"], "Check range again and Lower: the bearer's owners, no role read");
  assert.deepEqual(bearerOwner.sections[0].rows, [], "its rows are none of its own");
  const lowered = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: judge, lowered: true });
  assert.equal(lowered.buttons, undefined, "a lowered reach has nothing to check or lower");
});

t("the bearer sits in a section of its own, undetermined and uncounted, with a tick for the item's owners alone; counted in it reads as a row", () => {
  const holder = { isGM: false, ownsSubject: () => false, ownsBearer: false, ownsItem: true };
  const card = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: holder });
  assert.equal(card.sections[1].title, "The bearer");
  assert.equal(card.sections[1].titleTooltip, "bearer tip");
  const [own] = card.sections[1].rows;
  assert.deepEqual([own.name, own.outcome, own.emphasis], ["Bearer", "Could not be settled", "muted"]);
  assert.deepEqual(own.actions.map((a) => [a.action, a.label, a.data.subject, a.tooltip]), [["itemRun.tick", "Count in", "T.bear", "tick tip"]]);
  const other = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: { isGM: true, ownsSubject: () => true, ownsBearer: true, ownsItem: false } });
  assert.deepEqual(other.sections[1].rows[0].actions, [], "no tick for a seat that does not own the item, whatever its role");
  const counted = reachCardModel({ title: "Item", words, rows: [], bearer: { ...bearer, counted: true, row: { state: "waiting", feet: null } }, ids, seat: judge });
  assert.equal(counted.sections[1].rows[0].outcome, "Waits", "counted in, the bearer is an ordinary row");
  const noOne = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: { isGM: false, ownsSubject: () => false } });
  assert.equal(noOne.sections.length, 1, "a seat with no claim on the bearer sees no row of it");
});

t("a failed save's well is a line naming what was written, with no press", () => {
  const card = reachCardModel({ title: "Item", words, rows, bearer, well: ["Beta: Held, to its next turn", ""], ids, seat: judge });
  assert.equal(card.footnote, "On a failed save: Beta: Held, to its next turn");
  assert.equal(reachCardModel({ title: "Item", words, rows, ids, seat: judge }).footnote, undefined);
});

t("the whispered save card names the target and its tooltip, carries the one Roll while its entry is open, then the result", () => {
  const base = { title: "Item", subtitle: "Body", words, target: 12, targetTip: "why", ids, subject: "T.a", entryKey: "k1", messageId: "M1", ifFails: "If it fails: Held" };
  const open = saveCardModel({ ...base, canPress: true }).sections[0].rows[0];
  assert.deepEqual([open.target, open.targetTooltip], [12, "why"]);
  assert.deepEqual(open.actions[0].data, { ...ids, subject: "T.a", entryKey: "k1", messageId: "M1" }, "it names the raised card's message and the entry");
  assert.equal(saveCardModel({ ...base, canPress: false }).sections[0].rows[0].actions, undefined, "a seat that does not own the body has no press");
  const applied = saveCardModel({ ...base, canPress: true, entry: { state: "applied", saved: false, total: 4 } });
  assert.deepEqual([applied.sections[0].rows[0].total, applied.sections[0].rows[0].outcome, applied.sections[0].rows[0].actions], [4, "Fails", undefined], "answered: the result, and no press");
  assert.equal(saveCardModel({ ...base, canPress: true, entry: { state: "undone" } }).sections[0].rows[0].outcome, "Undone");
  assert.equal(saveCardModel({ ...base, canPress: true }).footnote, "If it fails: Held");
  assert.equal(saveCardModel({ title: "x", subtitle: "y", words, target: null, ids, subject: "s", entryKey: "k", messageId: "m" }).sections[0].rows[0].target, undefined, "a blank target is no number");
});

t("the card's store keys are free of dots, entries are keyed by moment, and a prompt strikes the older open entry of its subject", () => {
  assert.equal(safeKey("Scene.a.Token.b"), "Scene~a~Token~b");
  assert.equal(freshKey({ k: 1 }, "k"), "k#2");
  assert.equal(freshKey({ k: 1, "k#2": 1 }, "k"), "k#3");
  assert.equal(freshKey(undefined, "k"), "k");
  let card = newCard({ itemUuid: "I.1", rowKey: "r", activationId: "act", bearer: { uuid: "T.bear", name: "Bearer" } });
  assert.deepEqual([card.selfCount, card.lowered], [false, false], "the bearer is not counted by default");
  card = applyPatch(card, patchSubject(card, { uuid: "S.s1", name: "One" }));
  assert.equal(rowStateOf(card, "S.s1"), "waiting", "listed, no entry: waiting");
  assert.equal(rowStateOf(card, "S.unlisted"), "waiting");
  const first = patchPrompt(card, { uuid: "S.s1", name: "One", moment: "turnStart", momentKey: "c1:1:0:S.s1:kind" });
  assert.equal(first.key, "c1:1:0:S~s1:kind", "the moment key, dots made safe");
  card = applyPatch(card, first.patch);
  assert.equal(rowStateOf(card, "S.s1"), "open");
  assert.equal(card.entries[first.key].state, "open");
  const second = patchPrompt(card, { uuid: "S.s1", name: "One", moment: "turnStart", momentKey: "c1:2:0:S.s1:kind" });
  assert.deepEqual(second.struck.map((e) => e.momentKey), ["c1:1:0:S.s1:kind"], "the older open entry is struck, its held key handed back");
  card = applyPatch(card, second.patch);
  assert.deepEqual(Object.keys(card.entries), ["c1:2:0:S~s1:kind"]);
  card = applyPatch(card, { [`entries.${second.key}.state`]: "applied", [`entries.${second.key}.saved`]: true });
  assert.equal(rowStateOf(card, "S.s1"), "applied");
  const again = patchPrompt(card, { uuid: "S.s1", name: "One", moment: "moveIn", momentKey: "c1:2:0:S.s1:kind" });
  assert.equal(again.key, "c1:2:0:S~s1:kind#2", "a repeated key is a new entry, and an answered one is kept");
  assert.deepEqual(again.struck, [], "an applied entry is not struck");
  const out = patchOut(applyPatch(card, again.patch), { uuid: "S.s1", name: "One" });
  assert.equal(out.struck.length, 1, "leaving strikes the open entry");
  card = applyPatch(applyPatch(card, again.patch), out.patch);
  assert.equal(rowStateOf(card, "S.s1"), "out");
  assert.deepEqual(Object.keys(card.entries), ["c1:2:0:S~s1:kind"], "the answered entry and its Undo stay");
  card = applyPatch(card, patchSubject(card, { uuid: "S.s1", name: "One" }));
  assert.equal(rowStateOf(card, "S.s1"), "applied", "back in reach, its newest entry reads again");
  assert.deepEqual(patchUndetermined(card, { uuid: "S.s1", name: "One" }), {}, "a listed subject is not undetermined");
  assert.deepEqual(Object.keys(patchUndetermined(card, { uuid: "S.s9", name: "Nine" })), ["undetermined.S~s9"]);
  card = applyPatch(card, patchUndetermined(card, { uuid: "S.s9", name: "Nine" }));
  card = applyPatch(card, patchSubject(card, { uuid: "S.s9", name: "Nine", state: "notTarget" }));
  assert.equal(card.undetermined["S~s9"], undefined, "listing a subject settles it");
  assert.equal(rowStateOf(card, "S.s9"), "notTarget");
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
