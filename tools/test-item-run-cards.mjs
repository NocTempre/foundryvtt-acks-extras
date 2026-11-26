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
import { admittedWithCount, applyPatch, blankTip, cardSubjectUuids, engagedCardKey, engagedCardModel, engagedEntry, freshKey, importTip, isCountedIn, moraleLine, newCard, newEngagedCard, openEngagedEntryFor, openEngagedOf, ownsEveryBearer, patchCountIn, patchEngagedClose, patchEngagedPrompt, patchEngagedReopen, patchForget, patchOut, patchPrompt, patchSubject, patchUncount, patchUndetermined, reachCardModel, rowStateOf, safeKey, saveCardModel, saveTip, shownTokenName, signedFigure, standingCardAct, standingPartTip, stripModel, turnsLeft } from "../scripts/lib/item-run-card-logic.mjs";

class ForcedDeletion {}
globalThis.foundry = { data: { operators: { ForcedDeletion } } };

let passed = 0;
const t = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const words = {
  roll: "Roll", undo: "Undo", saved: "Holds", failed: "Fails", out: "Out of reach", notTarget: "Not a target", waiting: "Waits", asked: "Asked", undone: "Undone", undetermined: "Could not be settled",
  always: "Always on", save: "Save", rollSave: "Roll the save", tick: "Count in", bearer: "The bearer", well: "On a failed save", check: "Check range again", lower: "Lower", colDistance: "Distance",
  earlyTip: "early tip", saveTip: "save tip", undoTip: "undo tip", tickTip: "tick tip", countOut: "Count out", countOutTip: "count out tip", bearerTip: "bearer tip", checkTip: "check tip", lowerTip: "lower tip",
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
const judge = { judge: true, ownsSubject: () => true, ownsBearer: true, ownsItem: true, mayUndo: () => true };
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
  const owner = { judge: false, ownsSubject: (key) => key === "T.a" || key === "T.f", ownsBearer: false, ownsItem: false };
  const card = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: owner });
  assert.deepEqual(names(card), ["Alpha", "Zeta"], "only its own rows");
  assert.deepEqual(card.sections[0].rows[0].actions.map((a) => a.action), ["itemRun.roll"], "the owner of the subject saves");
  assert.deepEqual(card.sections[0].rows[1].actions, [], "a waiting row has no press for an owner who is not a Judge");
  assert.equal(card.buttons, undefined, "no footer for a seat that does not own the bearer");
  assert.equal(card.sections.length, 1, "nor the bearer's section");
  const bearerOwner = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: { judge: false, ownsSubject: () => false, ownsBearer: true, ownsItem: false } });
  assert.deepEqual(bearerOwner.buttons.map((b) => b.action), ["itemRun.recheck", "itemRun.lower"], "Check range again and Lower: the bearer's owners, no role read");
  assert.deepEqual(bearerOwner.sections[0].rows, [], "its rows are none of its own");
  const presser = { judge: false, ownsSubject: (key) => key === "T.b", mayUndo: (entry) => entry.presser === "u1" };
  const mixed = [{ ...rows[1], entry: { ...rows[1].entry, presser: "u1" } }, { ...rows[2], entry: { saved: true, total: 15, recordIds: ["E9"], presser: "u2" } }];
  const seen = reachCardModel({ title: "Item", words, rows: mixed, ids, seat: { ...presser, ownsSubject: () => true } }).sections[0].rows;
  assert.deepEqual(seen.map((r) => r.actions?.map((a) => a.action)), [["itemRun.undo"], undefined], "Undo for the seat that applied the entry, none for a seat that did not and does not own the body");
  const byOwnership = reachCardModel({ title: "Item", words, rows: mixed, ids, seat: { ...presser, ownsSubject: () => true, mayUndo: (e, key) => key === "T.c" } }).sections[0].rows;
  assert.deepEqual(byOwnership.map((r) => r.actions?.map((a) => a.action)), [undefined, ["itemRun.undo"]], "and for an owner of the body, whoever applied it");
  const lowered = reachCardModel({ title: "Item", words, rows, bearer, ids, seat: judge, lowered: true });
  assert.equal(lowered.buttons, undefined, "a lowered reach has nothing to check or lower");
});

t("the bearer sits in a section of its own, undetermined and uncounted, with a tick for the item's owners alone; counted in it reads as a row", () => {
  const holder = { judge: false, ownsSubject: () => false, ownsBearer: false, ownsItem: true };
  const card = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: holder });
  assert.equal(card.sections[1].title, "The bearer");
  assert.equal(card.sections[1].titleTooltip, "bearer tip");
  const [own] = card.sections[1].rows;
  assert.deepEqual([own.name, own.outcome, own.emphasis], ["Bearer", "Could not be settled", "muted"]);
  assert.deepEqual(own.actions.map((a) => [a.action, a.label, a.data.subject, a.tooltip]), [["itemRun.tick", "Count in", "T.bear", "tick tip"]]);
  const other = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: { judge: true, ownsSubject: () => true, ownsBearer: true, ownsItem: false } });
  assert.deepEqual(other.sections[1].rows[0].actions, [], "no tick for a seat that does not own the item, whatever its role");
  const countedOut = reachCardModel({ title: "Item", words, rows: [], bearer: { ...bearer, counted: true, row: { state: "waiting", feet: null } }, ids, seat: { ownsBearer: true, ownsItem: true } });
  assert.deepEqual(countedOut.sections[1].rows[0].actions.map((a) => [a.action, a.label, a.tooltip]), [["itemRun.untick", "Count out", "count out tip"]], "a counted bearer's owners of the item can count it out, and are offered no Count in");
  assert.deepEqual(reachCardModel({ title: "Item", words, rows: [], bearer: { ...bearer, counted: true, row: { state: "waiting", feet: null } }, ids, seat: { ownsBearer: true, ownsItem: false } }).sections[1].rows[0].actions, [], "a seat that owns the bearer and not the item has no Count out");
  const counted = reachCardModel({ title: "Item", words, rows: [], bearer: { ...bearer, counted: true, row: { state: "waiting", feet: null } }, ids, seat: judge });
  assert.equal(counted.sections[1].rows[0].outcome, "Waits", "counted in, the bearer is an ordinary row");
  const noOne = reachCardModel({ title: "Item", words, rows: [], bearer, ids, seat: { judge: false, ownsSubject: () => false } });
  assert.equal(noOne.sections.length, 1, "a seat with no claim on the bearer sees no row of it");
});

t("the raised card's undetermined section lists each body the filter could not settle with a Count in for the owners of the item alone, none once the reach is lowered", () => {
  const w = { ...words, countSubjectRaisedTip: "raised tip", counted: "Counted in" };
  const list = [{ key: "T.u", name: "Unsure" }, { key: "T.v", name: "Vague" }];
  const model = (seat, over = {}) => reachCardModel({ title: "Item", words: w, rows, undetermined: list, ids, seat, ...over });
  const card = model(judge);
  const section = card.sections.find((s) => s.title === "Could not be settled");
  assert.deepEqual(section.rows.map((r) => r.name), ["Unsure", "Vague"]);
  assert.deepEqual(section.rows[0].actions.map((a) => [a.action, a.label, a.data.subject, a.data.activationId, a.tooltip]), [["itemRun.tickSubject", "Count in", "T.u", "act", "raised tip"]], "a Count in that names the body and says in its tooltip how long it lasts");
  assert.equal(section.rows[0].outcome, "Could not be settled");
  const bodyOnly = model({ judge: true, ownsSubject: () => true, ownsBearer: true, ownsItem: false });
  assert.equal(bodyOnly.sections.some((s) => s.title === "Could not be settled"), false, "a seat that owns the bodies and not the item sees no row and no Count in, whatever its role");
  assert.equal(model(judge, { lowered: true }).sections.some((s) => s.title === "Could not be settled"), false, "a lowered reach offers no Count in");
  assert.equal(model(judge, { undetermined: [] }).sections.some((s) => s.title === "Could not be settled"), false, "no body, no section");
  const held = reachCardModel({ title: "Item", words: w, rows: [{ key: "T.u", name: "Unsure", state: "held", counted: true }], ids, seat: judge }).sections[0].rows[0];
  assert.deepEqual([held.outcome, held.emphasis, held.actions], ["Counted in", "success", undefined], "a body counted in under a standing reach reads as counted, with no Save to press");
});

t("a body in reach of a standing reach reads as held, not as waiting: the filter's own bodies read Always on and a counted one Counted in, both with the part in the Result's tooltip, and no seat is offered a Save or an early Save", () => {
  const w = { ...words, counted: "Counted in", always: "Always on" };
  const held = [
    { key: "T.a", name: "Alpha", state: "held", counted: false, heldTip: "part tip" },
    { key: "T.b", name: "Beta", state: "held", counted: true, heldTip: "part tip" },
    { key: "T.c", name: "Gamma", state: "held", counted: false },
  ];
  const seats = { judge, owner: { ownsSubject: () => true, ownsBearer: true, ownsItem: false }, 'a Judge owning no body': { judge: true, ownsSubject: () => false, ownsBearer: false, ownsItem: false } };
  for (const [seatName, seat] of Object.entries(seats)) {
    const shown = reachCardModel({ title: "Item", words: w, rows: held, ids, seat }).sections[0].rows;
    assert.deepEqual(shown.map((r) => [r.outcome, r.emphasis, r.actions]), seat.ownsSubject() ? [["Always on", "success", undefined], ["Counted in", "success", undefined], ["Always on", "success", undefined]] : [], `${seatName}: no Save and no early Save on a held row`);
    for (const r of shown) assert.ok(!JSON.stringify(r).includes("itemRun.roll"), `${seatName}: nothing on the row names the save press`);
  }
  const rowsOut = reachCardModel({ title: "Item", words: w, rows: held, ids, seat: judge }).sections[0].rows;
  assert.deepEqual(rowsOut.map((r) => r.outcomeTooltip), ["part tip", "part tip", undefined], "the tooltip is the Result's, and a row with no tip carries none");
  const waiting = reachCardModel({ title: "Item", words: w, rows: [{ key: "T.f", name: "Zeta", state: "waiting" }], ids, seat: judge }).sections[0].rows[0];
  assert.equal(waiting.actions?.[0]?.action, "itemRun.roll", "a prompting reach's waiting row keeps the Judge's early Save");
  const gone = reachCardModel({ title: "Item", words: w, rows: [{ key: "T.d", name: "Delta", state: "out" }], ids, seat: judge }).sections[0].rows[0];
  assert.deepEqual([gone.outcome, gone.emphasis, gone.outcomeTooltip], ["Out of reach", "muted", undefined], "a body that left reads muted, with no part tip");
});

t("a standing reach's entry and exit read the card: a listed or counted body comes back or goes out, a body held only undetermined is dropped at its exit, and a body the card keeps nothing of stays off it", () => {
  const card = (over = {}) => ({ ...newCard({ itemUuid: "I.1", rowKey: "s", activationId: "act", bearer: { uuid: "T.bear", name: "Bearer" } }), ...over });
  const listed = applyPatch(card(), patchSubject(card(), { uuid: "T.a", name: "Alpha" }));
  const unsure = applyPatch(card(), patchUndetermined(card(), { uuid: "T.u", name: "Unsure" }));
  assert.equal(standingCardAct(listed, "T.a", { act: "off", counted: false }), "out", "a body listed by Check range again is muted at its exit");
  assert.equal(standingCardAct(listed, "T.a", { act: "on", counted: false }), "list", "and comes back in reach at its entry");
  assert.equal(standingCardAct(card(), "T.c", { act: "off", counted: true }), "out", "a counted body is muted at its exit whatever the card lists");
  assert.equal(standingCardAct(card(), "T.c", { act: "on", counted: true }), "list");
  assert.equal(standingCardAct(unsure, "T.u", { act: "off", counted: false }), "forget", "a body held undetermined is dropped at its exit");
  assert.equal(standingCardAct(unsure, "T.u", { act: "on", counted: false }), null, "an entry lists nobody");
  assert.equal(standingCardAct(card(), "T.z", { act: "off", counted: false }), null, "a body the card keeps nothing of stays off it");
  assert.equal(standingCardAct(card(), "T.z", { act: "on", counted: false }), null);
  assert.equal(standingCardAct(null, "T.z", { act: "off" }), null, "no card, nothing to keep");
  const forgot = patchForget(unsure, { uuid: "T.u" });
  assert.deepEqual(Object.keys(forgot), ["undetermined.T~u"]);
  assert.ok(forgot["undetermined.T~u"] instanceof ForcedDeletion);
  assert.deepEqual(patchForget(card(), { uuid: "T.u" }), {}, "a body not held undetermined has nothing to drop");
  assert.deepEqual(applyPatch(unsure, patchForget(unsure, { uuid: "T.u" })).undetermined, {});
});

t("an exit leaves a body in one list of the card: it drops the body from undetermined where it is held there and writes nothing about that where it is not, and a re-entry the filter cannot settle lists it undetermined again with its muted row gone", () => {
  const base = () => newCard({ itemUuid: "I.1", rowKey: "t", activationId: "act", bearer: { uuid: "T.bear", name: "Bearer" } });
  // A body held in both lists (a row listed, and held undetermined): its exit leaves it in the muted row alone.
  const both = applyPatch(applyPatch(base(), { "undetermined.T~u": { uuid: "T.u", name: "Unsure" } }), { "subjects.T~u": { uuid: "T.u", name: "Unsure", state: "in", latest: "" } });
  const out = patchOut(both, { uuid: "T.u", name: "Unsure" });
  assert.ok(out.patch["undetermined.T~u"] instanceof ForcedDeletion, "the exit drops it from undetermined");
  const after = applyPatch(both, out.patch);
  assert.deepEqual([after.undetermined, after.subjects["T~u"].state], [{}, "out"], "it is in the muted row and in no other list");
  // A body not held undetermined: the exit writes its row alone, and so does the lowering that follows a count.
  const listed = applyPatch(base(), patchSubject(base(), { uuid: "T.a", name: "Alpha" }));
  assert.deepEqual(Object.keys(patchOut(listed, { uuid: "T.a", name: "Alpha" }).patch), ["subjects.T~a"], "nothing to drop, nothing written");
  const counted = applyPatch(applyPatch(base(), { "undetermined.T~u": { uuid: "T.u", name: "Unsure" } }), patchCountIn(base(), { uuid: "T.u", name: "Unsure" }));
  const lowered = applyPatch(counted, { ...patchUncount(counted), ...patchOut(counted, { uuid: "T.u", name: "Unsure" }).patch });
  assert.deepEqual([lowered.undetermined["T~u"]?.name, lowered.subjects["T~u"].state, lowered.counted], ["Unsure", "out", {}], "lowering still returns a counted body to undetermined, its exit not taking the listing back");
  // Re-entry: a muted row gives way to the undetermined listing, a row in reach or as no target is kept as it is.
  const reentry = patchUndetermined(after, { uuid: "T.u", name: "Unsure" });
  const back = applyPatch(after, reentry);
  assert.deepEqual([back.undetermined["T~u"]?.name, back.subjects["T~u"]], ["Unsure", undefined], "the body is listed undetermined and its muted row is gone");
  assert.equal(rowStateOf(back, "T.u"), "waiting");
  const again = applyPatch(back, patchOut(back, { uuid: "T.u", name: "Unsure" }).patch);
  assert.deepEqual([again.undetermined, again.subjects["T~u"].state], [{}, "out"], "and a second exit mutes it and drops it again");
  assert.deepEqual(patchUndetermined(listed, { uuid: "T.a", name: "Alpha" }), {}, "a body listed in reach is not listed undetermined as well");
  const refused = applyPatch(base(), patchSubject(base(), { uuid: "T.n", name: "Nu", state: "notTarget" }));
  assert.deepEqual(patchUndetermined(refused, { uuid: "T.n", name: "Nu" }), {}, "nor is one the filter refused");
});

t("a held body's tooltip names the part and the page, the page alone where no figure was imported, and nothing where there is neither", () => {
  assert.equal(standingPartTip({ line: "Item holds morale throws −1", cite: "XX p. 6" }), "Item holds morale throws −1 (XX p. 6)");
  assert.equal(standingPartTip({ line: "", cite: "XX p. 6" }), "XX p. 6", "no figure: the reference alone");
  assert.equal(standingPartTip({ line: "Item holds morale throws −1", cite: "" }), "Item holds morale throws −1");
  assert.equal(standingPartTip({}), null);
  assert.deepEqual([signedFigure(-1), signedFigure(2), signedFigure(0)], ["−1", "+2", "+0"]);
});

t("a count lasts for one raise: the count is recorded beside the body's listing, only a card still raised reads it, a filter that settled the body stands, and lowering returns each counted body to undetermined", () => {
  const raised = applyPatch(newCard({ itemUuid: "I.1", rowKey: "t", activationId: "act", bearer: { uuid: "T.bear", name: "Bearer" } }), { "undetermined.T~u": { uuid: "T.u", name: "Unsure" } });
  assert.deepEqual(raised.counted, {}, "a new card counts nobody");
  const counted = applyPatch(raised, patchCountIn(raised, { uuid: "T.u", name: "Unsure" }));
  assert.deepEqual([counted.undetermined["T~u"], counted.subjects["T~u"].state, counted.counted["T~u"].name], [undefined, "in", "Unsure"], "the body leaves undetermined, is listed as in reach and is recorded as counted");
  assert.equal(isCountedIn(counted, "T.u"), true);
  assert.equal(isCountedIn({ ...counted, lowered: true }, "T.u"), false, "a lowered card counts nobody");
  assert.equal(isCountedIn(counted, "T.zz"), false);
  assert.deepEqual([admittedWithCount(null, counted, "T.u"), admittedWithCount(undefined, counted, "T.u"), admittedWithCount(null, counted, "T.zz")], [true, true, null], "an undetermined body is admitted when counted");
  assert.deepEqual([admittedWithCount(false, counted, "T.u"), admittedWithCount(true, counted, "T.zz")], [false, true], "a verdict the filter settled stands, whatever the count");
  const wake = applyPatch(counted, patchUncount(counted));
  assert.deepEqual([wake.counted, wake.undetermined["T~u"]], [{}, { uuid: "T.u", name: "Unsure" }], "lowering holds the body undetermined again and counts nobody");
  assert.deepEqual(patchUncount(raised), {}, "a card that counted nobody writes nothing on lowering");
});

t("a failed save's well is a line naming what was written, with no press", () => {
  const card = reachCardModel({ title: "Item", words, rows, bearer, well: ["Beta: Held, to its next turn", ""], ids, seat: judge });
  assert.equal(card.footnote, "On a failed save: Beta: Held, to its next turn");
  assert.equal(reachCardModel({ title: "Item", words, rows, ids, seat: judge }).footnote, undefined);
});

t("a Save is offered by ownership of the body saving and no role is read; the early Save on a waiting row is the Judge's alone, and a Player's waiting row says in words that it waits", () => {
  const modelFor = (seat, list) => reachCardModel({ title: "Item", words, rows: list, ids, seat });
  const open = rows[0];
  const waiting = rows[5];
  assert.deepEqual(modelFor({ judge: true, ownsSubject: () => false }, [open, waiting]).sections[0].rows, [], "a seat that owns no body sees none of its rows, the Judge's declaration giving it none");
  const owner = { judge: false, ownsSubject: (key) => key === "T.a" || key === "T.f" };
  const seen = modelFor(owner, [open, waiting]).sections[0].rows;
  assert.deepEqual(seen[0].actions.map((a) => a.action), ["itemRun.roll"], "a due Save follows ownership of the body");
  assert.equal(seen[1].outcome, "Waits", "the waiting row's visible Result says the save waits for the body's moment");
  assert.deepEqual(seen[1].actions, [], "a Player's waiting row carries no press");
  const early = modelFor({ judge: true, ownsSubject: () => true }, [waiting]).sections[0].rows[0];
  assert.deepEqual([early.outcome, early.actions.map((a) => a.tooltip)], ["Waits", ["early tip"]], "the Judge's seat has the same word and the early press, its warning in the tooltip");
  assert.deepEqual(modelFor({ ownsSubject: () => true }, [waiting]).sections[0].rows[0].actions, [], "a seat that does not declare as the Judge is offered no early press, whatever else it owns");
  assert.equal(modelFor({ judge: true, ownsSubject: (k) => k === "T.a" }, [open]).sections[0].rows[0].actions.length, 1, "an open row's Save is the owner's");
  const counted = { ...bearer, counted: true, row: { state: "open", entryKey: "kb", target: 11 } };
  const holder = reachCardModel({ title: "Item", words, rows: [], bearer: counted, ids, seat: { judge: true, ownsSubject: () => false, ownsBearer: false, ownsItem: true } });
  assert.deepEqual(holder.sections[1].rows[0].actions.filter((a) => a.action === "itemRun.roll"), [], "the bearer's own due Save is its owners', not the declaring Judge's and not the item owner's");
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

t("the strip lists what meets a body, the save owed first and what asks nothing last, and is absent when nothing does", () => {
  assert.deepEqual(stripModel([]), { count: 0, rows: [] });
  assert.deepEqual(stripModel(null), { count: 0, rows: [] });
  const strip = stripModel([
    { key: "a", name: "Aura", tag: "always", source: "Alpha", part: { value: -1, tip: "p" } },
    { key: "b", name: "Bane", tag: "immune", source: "Alpha", left: 4, leftTip: "l" },
    { key: "c", name: "Curse", tag: "owed", source: "Alpha", feet: 15, radius: 30, target: 12, targetTip: "t", press: { messageId: "M" } },
    { key: "d", name: "Dread", tag: "waiting", source: "Alpha", feet: 0 },
    { key: "e", name: "Eerie", tag: "nonsense" },
  ]);
  assert.equal(strip.count, 4, "a tag nobody knows is not listed");
  assert.deepEqual(strip.rows.map((r) => r.tag), ["owed", "waiting", "always", "immune"]);
  assert.deepEqual([strip.rows[0].feet, strip.rows[0].radius, strip.rows[0].target, strip.rows[0].press.messageId], [15, 30, 12, "M"]);
  assert.equal(strip.rows[1].feet, 0, "a body touching the bearer's token is 0′ away, a figure and not a blank");
  assert.deepEqual([strip.rows[2].feet, strip.rows[2].target, strip.rows[2].press], [null, null, null], "a figure not given is null");
});

t("a token's name is shown as core shows it to the viewer, and the morale line carries the item and the record's page", () => {
  const modes = { NONE: 0, OWNER_HOVER: 20, OWNER: 40 };
  const named = (over) => shownTokenName({ name: "Tok", displayName: 50, isOwner: false, ...over }, modes);
  assert.equal(named({}), "Tok", "an always-shown name is shown");
  assert.equal(named({ displayName: 30 }), "Tok", "so is a hover name");
  assert.equal(named({ displayName: 0, isOwner: true }), null, "a name core never shows is not shown to its owner either");
  assert.equal(named({ displayName: 40 }), null, "an owner-only name is withheld from a seat that does not own the token");
  assert.equal(named({ displayName: 20 }), null);
  assert.equal(named({ displayName: 40, isOwner: true }), "Tok");
  assert.equal(named({ isSecret: true, isOwner: true }), null, "a secret token has no name");
  assert.deepEqual(moraleLine({ item: "Item", cite: "XX p. 1", words: { inReachOf: "In reach of" } }), { label: "In reach of Item", cite: "XX p. 1" });
  assert.equal(moraleLine({ item: "Item", words: { inReachOf: "In reach of" } }).cite, "", "no page, no citation");
  assert.deepEqual([turnsLeft(100, 0, 600), turnsLeft(100, 99, 600), turnsLeft(1300, 100, 600), turnsLeft(100, 100, 600), turnsLeft(null, 0, 600), turnsLeft(100, null, 600)], [1, 1, 2, null, null, null], "turns left on the module's clock round up, and an ended or unread window has none");
});

t("a figure's tooltip says where it came from: the import's row and page, the computed parts with the page, or the page reference alone", () => {
  assert.equal(importTip({ label: "Row", figure: "radius", cite: "XX p. 4" }), "Row: radius (XX p. 4)");
  assert.equal(importTip({ label: "Row", figure: "radius", cite: null }), null, "no page, no tooltip: a finding to register");
  assert.equal(saveTip({ save: "Alpha", target: 12, parts: [{ label: "base", value: 10 }, { label: "ring", value: -1 }], cite: "XX p. 9" }), "Alpha 12+: base +10 · ring -1 (XX p. 9)");
  assert.equal(saveTip({ save: "Alpha", target: 12 }), "Alpha 12+");
  assert.equal(blankTip({ cite: "XX p. 4" }), "XX p. 4");
  assert.equal(blankTip({}), null);
});


/* --- T10: the engaged card (board 5b) --- */
const engagedWords = { ...words, engagedBy: "Engaged by", notEngaged: "Not engaged", notEngagedTip: "not engaged tip", engagedRead: "read line", asked: "Asked", saved: "Saved", failed: "Failed" };
const bearerList = [{ uuid: "B.1", name: "Champion 1" }, { uuid: "B.2", name: "Champion 2" }];
const engagedRow = (over = {}) => ({
  entryKey: "k1", state: "open", bearerNames: "Champion 1, Champion 2", bearersTip: "by tip", target: 11, targetTip: "ttip", ids: { itemUuid: "I.t", rowKey: "engaged", activationId: "engaged:x" }, closedWord: "Not engaged · Judge", notEngagedAria: "aria",
  ...over, entry: { subject: "T.s", state: over.state ?? "open", bearers: bearerList, ...(over.entry ?? {}) },
});
const ownerOf = (...keys) => (key) => keys.includes(key);
const seatOf = ({ subject = [], bearers = [], undo = false } = {}) => ({ ownsSubject: ownerOf(...subject), ownsBearers: (entry) => ownsEveryBearer(entry, ownerOf(...bearers)), mayUndo: () => undo });
const cardFor = (rowsIn, seat, over = {}) => engagedCardModel({ title: "T10 · engaged", subtitle: "Subject", note: "note", noteTooltip: "ntip", words: engagedWords, rows: rowsIn, seat, ...over });
const actionsOf = (card) => card.sections[0].rows.flatMap((r) => (r.actions ?? []).map((a) => a.action));

t("the engaged card's store: one card per subject per initiative, one entry per kind under its moment key, the card names no item of its own, and a row is closed and reopened by patches that touch only its state", () => {
  assert.equal(engagedCardKey({ stamp: "c1:2:1", subjectUuid: "T.s" }), "c1:2:1|T.s");
  assert.equal(engagedCardKey({ stamp: null, subjectUuid: "T.s" }), null, "outside a fight nothing is reused");
  assert.equal(engagedCardKey({ stamp: "c1:2:1", subjectUuid: "" }), null);
  const card = newEngagedCard({ cardKey: "c1:2:1|T.s", stamp: "c1:2:1", round: 2, moment: "turnStart", subject: { uuid: "T.s", name: "Subject" }, title: "T10", cardId: "cid" });
  assert.deepEqual([card.kind, card.itemUuid, card.activationId, card.cardId, card.subject.name, card.round, card.lowered], ["engaged", "", "", "cid", "Subject", 2, false]);
  const entry = engagedEntry({ subject: "T.s", moment: "turnStart", momentKey: "c1:2:1:T.s:kindT", kindKey: "kindT", itemUuid: "I.t", rowKey: "engaged", activationId: "engaged:x", bearers: bearerList });
  const first = patchEngagedPrompt(card, { momentKey: "c1:2:1:T.s:kindT", entry });
  assert.equal(first.key, "c1:2:1:T~s:kindT", "keyed by the moment key, free of dots");
  let next = applyPatch(card, first.patch);
  assert.deepEqual([next.entries[first.key].state, next.entries[first.key].bearers.length], ["open", 2]);
  assert.equal(patchEngagedPrompt(next, { momentKey: "c1:2:1:T.s:kindT", entry }).key, "c1:2:1:T~s:kindT#2", "a key held is not overwritten");
  next = applyPatch(next, patchEngagedClose(first.key, { id: "u1", name: "Judge" }));
  assert.deepEqual([next.entries[first.key].state, next.entries[first.key].closedBy, next.entries[first.key].presser, next.entries[first.key].bearers.length], ["closed", { id: "u1", name: "Judge" }, "u1", 2], "closed by whom, keeping its bearers");
  next = applyPatch(next, patchEngagedReopen(first.key));
  assert.deepEqual([next.entries[first.key].state, "closedBy" in next.entries[first.key], "presser" in next.entries[first.key]], ["open", false, false], "reopened, its closer forgotten");
  assert.equal(openEngagedOf(next, { subjectUuid: "T.s", kindKey: "kindT" }).length, 1);
  assert.equal(openEngagedOf(next, { subjectUuid: "T.s", kindKey: "kindU" }).length, 0, "by kind");
  assert.equal(openEngagedOf(applyPatch(next, patchEngagedClose(first.key, { id: "u1", name: "J" })), { subjectUuid: "T.s", kindKey: "kindT" }).length, 0, "a closed row is no longer open");
  assert.deepEqual([ownsEveryBearer(entry, ownerOf("B.1", "B.2")), ownsEveryBearer(entry, ownerOf("B.1")), ownsEveryBearer({ bearers: [] }, () => true), ownsEveryBearer(null, () => true)], [true, false, false, false], "every bearer, and nobody where none is named");
});

t("the engaged card by seat: the row shows to the subject's owners and to a seat owning every bearer, the Save to the subject's owners, Not engaged and the read line to a seat owning every bearer, and a seat owning one of two sees neither", () => {
  const rowsIn = [engagedRow()];
  const kinds = (seat) => ({ shown: cardFor(rowsIn, seat).sections[0].rows.length, actions: actionsOf(cardFor(rowsIn, seat)), line: cardFor(rowsIn, seat).lines ?? [] });
  assert.deepEqual(kinds(seatOf({ subject: ["T.s"], bearers: ["B.1", "B.2"] })), { shown: 1, actions: ["itemRun.roll", "itemRun.notEngaged"], line: ["read line"] }, "a seat owning all of it");
  assert.deepEqual(kinds(seatOf({ subject: ["T.s"], bearers: ["B.1"] })), { shown: 1, actions: ["itemRun.roll"], line: [] }, "one of two bearers: neither the control nor the line");
  assert.deepEqual(kinds(seatOf({ subject: ["T.s"] })), { shown: 1, actions: ["itemRun.roll"], line: [] }, "the subject's owner alone");
  assert.deepEqual(kinds(seatOf({ bearers: ["B.1", "B.2"] })), { shown: 1, actions: ["itemRun.notEngaged"], line: ["read line"] }, "the bearers' owners alone: the row, no Save");
  assert.deepEqual(kinds(seatOf()), { shown: 0, actions: [], line: [] }, "a seat owning neither is shown no row");
  const card = cardFor(rowsIn, seatOf({ subject: ["T.s"], bearers: ["B.1", "B.2"] }));
  const [row] = card.sections[0].rows;
  assert.deepEqual([card.labels, card.title, card.subtitle, card.note, card.noteTooltip, card.bare], [{ name: "Engaged by", target: "Save" }, "T10 · engaged", "Subject", "note", "ntip", true], "Engaged by and Save head the columns, and the banner is 4b's");
  assert.deepEqual([row.name, row.nameTooltip, row.target, row.targetTooltip, row.outcome], ["Champion 1, Champion 2", "by tip", 11, "ttip", "Asked"], "the bearers are one comma-joined name with a computed tooltip, the target has its own");
  const notEngaged = row.actions.find((a) => a.action === "itemRun.notEngaged");
  assert.deepEqual([notEngaged.label, notEngaged.tooltip, notEngaged.ariaLabel, notEngaged.data.entryKey, notEngaged.data.itemUuid, notEngaged.data.subject], ["Not engaged", "not engaged tip", "aria", "k1", "I.t", "T.s"]);
  assert.ok(!("buttons" in card) && !JSON.stringify(card).includes("itemRun.lower") && !JSON.stringify(card).includes("itemRun.recheck"), "no Lower and no Check range again");
  assert.equal(JSON.stringify(card).includes("aside"), false, "and no distance column");
  const judge = { ownsSubject: () => true, ownsBearers: () => false, mayUndo: () => true, judge: true };
  assert.deepEqual(kinds(judge).actions, ["itemRun.roll"], "a Judge's role adds nothing: ownership alone offers Not engaged");
});

t("the engaged card's row states: a closed row keeps its bearers, reads who closed it in the muted look with no Save and no Not engaged and 4b's Undo, an answered one reads its result, a blank save is a blank cell with the page alone, and a pass reads its immunity", () => {
  const seat = seatOf({ subject: ["T.s"], bearers: ["B.1", "B.2"], undo: true });
  const closed = cardFor([engagedRow({ state: "closed", target: 11 })], seat).sections[0].rows[0];
  assert.deepEqual([closed.name, closed.outcome, closed.emphasis, closed.actions.map((a) => a.action), closed.target, closed.targetText], ["Champion 1, Champion 2", "Not engaged · Judge", "muted", ["itemRun.undo"], undefined, undefined], "no Save figure either");
  assert.equal(cardFor([engagedRow({ state: "closed" })], seatOf({ subject: ["T.s"], bearers: ["B.1", "B.2"] })).sections[0].rows[0].actions, undefined, "the Undo is offered to whoever may undo it");
  const failed = cardFor([engagedRow({ state: "applied", entry: { saved: false, total: 7, recordIds: ["E1"] } })], seat).sections[0].rows[0];
  assert.deepEqual([failed.outcome, failed.emphasis, failed.total, failed.target, failed.actions.map((a) => a.action)], ["Failed", "failure", 7, 11, ["itemRun.undo"]]);
  const held = cardFor([engagedRow({ state: "applied", entry: { saved: true, total: 15, recordIds: [] }, holds: { text: "Saved · immune 2 turns", tip: "immune tip" } })], seat).sections[0].rows[0];
  assert.deepEqual([held.outcome, held.outcomeTooltip, held.emphasis, held.actions], ["Saved · immune 2 turns", "immune tip", "success", undefined], "a pass that wrote nothing has no Undo");
  const bare = cardFor([engagedRow({ state: "applied", entry: { saved: true, total: 15, recordIds: [] } })], seat).sections[0].rows[0];
  assert.equal(bare.outcome, "Saved");
  const blank = cardFor([engagedRow({ target: null, targetTip: "MM p. 57" })], seat).sections[0].rows[0];
  assert.deepEqual([blank.target, blank.targetText, blank.targetTooltip], [undefined, "\u00a0", "MM p. 57"], "a blank cell whose tooltip is the page reference alone");
  const undone = cardFor([engagedRow({ state: "undone" })], seat).sections[0].rows[0];
  assert.deepEqual([undone.outcome, undone.emphasis], ["Undone", "muted"]);
  const unnamed = cardFor([engagedRow({ bearersTip: "" })], seat).sections[0].rows[0];
  assert.equal("nameTooltip" in unnamed, false);
  const well = cardFor([engagedRow({ state: "applied", entry: { saved: false, total: 7, recordIds: ["E1"] } })], seat, { well: ["Subject: Held, until its timed interval runs out"] });
  assert.equal(well.footnote, "On a failed save: Subject: Held, until its timed interval runs out");
});

t("the whispered save card of a closed engaged row reads who closed it and offers no roll, and an open row keeps its roll", () => {
  const closed = saveCardModel({ title: "T10 · engaged", subtitle: "Subject", words, target: 11, ids, subject: "T.s", entryKey: "k", messageId: "M1", entry: { state: "closed" }, closedWord: "Not engaged · Judge" });
  assert.deepEqual([closed.sections[0].rows[0].outcome, closed.sections[0].rows[0].emphasis, closed.sections[0].rows[0].actions], ["Not engaged · Judge", "muted", undefined], "no roll once the row is closed");
  const open = saveCardModel({ title: "x", subtitle: "y", words, target: 11, ids, subject: "T.s", entryKey: "k", messageId: "M1", entry: { state: "open" }, canPress: true });
  assert.equal(open.sections[0].rows[0].actions[0].action, "itemRun.roll", "an open row's roll is as it was");
});

t("the strip finds the open engaged entry of a subject and kind across the chat's messages, and the token uuids a card concerns", () => {
  const entryOf = (state, over = {}) => ({ subject: "T.s", kindKey: "kindT", state, ...over });
  const message = (id, kind, extra) => ({ id, flags: { "acks-extras": { itemRunCard: { kind, ...extra } } } });
  const messages = [
    message("M1", "engaged", { subject: { uuid: "T.s" }, entries: { a: entryOf("applied") } }),
    message("M2", "engaged", { subject: { uuid: "T.s" }, entries: { b: entryOf("open"), c: entryOf("open", { kindKey: "kindU" }), d: entryOf("open", { subject: "T.o" }) } }),
    message("M3", "raised", { entries: { e: entryOf("open") } }),
    { id: "M4", flags: {} },
  ];
  const found = openEngagedEntryFor(messages, { subjectUuid: "T.s", kindKey: "kindT" });
  assert.deepEqual([found.messageId, found.entryKey, found.entry.state], ["M2", "b", "open"], "this subject's open row of this kind, on the engaged card that holds it");
  assert.equal(openEngagedEntryFor(messages.slice(0, 1), { subjectUuid: "T.s", kindKey: "kindT" }), null, "an answered entry is not open");
  assert.equal(openEngagedEntryFor(messages, { subjectUuid: "T.s", kindKey: "kindX" }), null, "another kind's row is not this one");
  assert.equal(openEngagedEntryFor(messages.slice(2), { subjectUuid: "T.s", kindKey: "kindT" }), null, "a raised card's entries are not engaged rows");
  assert.equal(openEngagedEntryFor(null, { subjectUuid: "T.s", kindKey: "kindT" }), null);
  assert.deepEqual(cardSubjectUuids({ kind: "engaged", subject: { uuid: "T.s" }, entries: { b: entryOf("open"), d: entryOf("open", { subject: "T.o" }) } }), ["T.s", "T.o"], "an engaged card concerns its subject and its entries' subjects, once each");
  assert.deepEqual(cardSubjectUuids({ subjects: { a: { uuid: "T.a" }, b: { uuid: "T.b" } } }), ["T.a", "T.b"], "a raised card concerns the subjects it lists");
  assert.deepEqual([cardSubjectUuids(null), cardSubjectUuids({})], [[], []]);
  assert.equal(stripModel([{ key: "k", name: "n", tag: "failed", timed: true }]).rows[0].timed, true, "a timed failure is marked for its own tooltip");
  assert.equal("timed" in stripModel([{ key: "k", name: "n", tag: "failed" }]).rows[0], false, "and every other row is as it was");
});

/* -------------------------------------------- */
/*  The fuse card and the burst card             */
/* -------------------------------------------- */

const { blankBurstModel, burstCardModel, burstDamageOf, damageTip, fuseCardModel, throwTip } = await import("../scripts/lib/item-run-card-logic.mjs");
const fuseWords = { ...words, throw: "Throw", base: "Base", light: "Light", lit: "Lit", unlit: "Not lit", fumble: "Fumble", judgeDecides: "Judge", blankRow: { throw: "Light throw", fumble: "Fumble range", fuseDice: "Fuse dice" }, blankLine: { round: "no rounds", spot: "no spot" }, unlitLine: "unlit line", fumbleLine: "fumble line", judgeLine: "judge line", fuseHint: "hint", moveSpot: "Move the spot", moveSpotTip: "ms tip", moveSpotAria: "ms aria", setOff: "Set it off now", setOffTip: "so tip", setOffAria: "so aria" };
const fuseIds = { activationId: "act", itemUuid: "I.1" };
const pressesOf = (model) => [...(model.buttons ?? []), ...model.sections.flatMap((s) => s.rows.flatMap((r) => r.actions ?? []))].map((a) => a.action);

t("the light throw's tooltip names its parts so they produce the target: the item's figure less each standing modifier, the proficiency note and the page", () => {
  assert.equal(throwTip({ target: 9, base: 11, modifiers: [{ label: "Ability", value: 2 }], notes: ["Ability: the bearer has it"], cite: "MM p. 55", words: fuseWords }), "Throw 9+: Base 11 · Ability −2 (Ability: the bearer has it) (MM p. 55)");
  assert.equal(throwTip({ target: 12, base: 11, modifiers: [{ label: "Penalty", value: -1 }], words: fuseWords }), "Throw 12+: Base 11 · Penalty +1", "a penalty raises the target");
  assert.equal(throwTip({ target: null, base: null, cite: "MM p. 55", words: fuseWords }), "MM p. 55", "a blank throw is the page alone");
  assert.equal(throwTip({ target: null, base: null, words: fuseWords }), null, "and null where the module ships no page");
});

t("a lit fuse's card reads the roll and the steps, and offers Move the spot and Set it off now to a seat that owns the bearer alone", () => {
  const roll = { natural: 12, total: 12, formula: "1d20", target: 9, base: 11 };
  const lit = fuseCardModel({ title: "Gear lit", subtitle: "Bearer", words: fuseWords, roll, outcome: "lit", steps: { text: "Goes off in 3 rounds", tip: "steps tip" }, targetTip: "ttip", totalTip: "1d20: 12", cite: "MM p. 55", ids: fuseIds, seat: { ownsBearer: true } });
  const [row] = lit.sections[0].rows;
  assert.deepEqual([row.name, row.total, row.target, row.targetTooltip, row.tooltipText, row.outcome, row.emphasis], ["Light", 12, 9, "ttip", "1d20: 12", "Lit", "success"]);
  assert.deepEqual([lit.note, lit.noteTooltip], ["Goes off in 3 rounds", "steps tip"]);
  assert.deepEqual(lit.lines, ["hint"], "the hint says the table comes when the fuse burns down");
  assert.deepEqual(lit.buttons.map((b) => [b.action, b.data.activationId, !!b.ariaLabel, !!b.tooltip]), [["itemRun.moveSpot", "act", true, true], ["itemRun.setOff", "act", true, true]]);
  const other = fuseCardModel({ title: "Gear lit", words: fuseWords, roll, outcome: "lit", steps: { text: "x" }, ids: fuseIds, seat: { ownsBearer: false } });
  assert.equal(other.buttons, undefined, "a seat that does not own the bearer is offered no press");
  const burned = fuseCardModel({ title: "Gear lit", words: fuseWords, roll, outcome: "lit", steps: { text: "x" }, ids: fuseIds, seat: { ownsBearer: true }, burned: true });
  assert.equal(burned.buttons, undefined, "and once the fuse is gone nobody is");
});

t("an unlit light, a fumble and a Judge's one say so in a plain line and offer no press; a blank figure is a blank cell with the page alone and a throw with no target keeps its roll", () => {
  const roll = { natural: 3, total: 3, formula: "1d20", target: 9, base: 11 };
  const unlit = fuseCardModel({ title: "t", words: fuseWords, roll, outcome: "unlit", ids: fuseIds, seat: { ownsBearer: true } });
  assert.deepEqual([unlit.sections[0].rows[0].outcome, unlit.sections[0].rows[0].emphasis, unlit.lines, unlit.note, unlit.buttons], ["Not lit", "failure", ["unlit line"], undefined, undefined]);
  const fumble = fuseCardModel({ title: "t", words: fuseWords, roll: { ...roll, natural: 1, total: 1 }, outcome: "fumble", ids: fuseIds, seat: { ownsBearer: true } });
  assert.deepEqual([fumble.sections[0].rows[0].outcome, fumble.lines, fumble.buttons], ["Fumble", ["fumble line"], undefined]);
  const blank = fuseCardModel({ title: "t", words: fuseWords, roll: null, outcome: null, blank: ["throw", "fumble"], cite: "MM p. 55", ids: fuseIds, seat: { ownsBearer: true } });
  assert.deepEqual(blank.sections[0].rows.map((r) => [r.name, r.total, r.target, r.targetText, r.targetTooltip]), [["Light throw", "", undefined, " ", "MM p. 55"], ["Fumble range", "", undefined, " ", "MM p. 55"]], "no roll and no number, the page alone");
  assert.deepEqual([blank.lines, blank.buttons], [["judge line"], undefined]);
  const held = fuseCardModel({ title: "t", words: fuseWords, roll: { natural: 14, total: 14, formula: "1d20", target: null, base: null }, outcome: null, blank: ["throw", "fuseDice", "round", "spot"], targetTip: throwTip({ target: null, base: null, cite: "MM p. 55", words: fuseWords }), cite: "MM p. 55", ids: fuseIds });
  const [rollRow, diceRow] = held.sections[0].rows;
  assert.deepEqual([rollRow.total, rollRow.targetText, rollRow.targetTooltip, rollRow.outcome, diceRow.name], [14, " ", "MM p. 55", "Judge", "Fuse dice"], "the roll is kept where a later figure was blank, its blank target the page alone, and the throw's own row is not repeated");
  assert.deepEqual(held.lines, ["judge line", "no rounds", "no spot"]);
});

const burstWords = { ...words, inArea: "In the area", damage: "Damage", apply: "Apply", applyTip: "apply tip", applyAria: "Apply to {name}", applyAll: "Apply all", applyAllTip: "all tip", applyAllAria: "all aria", undoApplyTip: "undo tip", undoAria: "Undo {name}", saveAria: "Save {name}", handOn: "Hand on", handOnTip: "hand tip", handOnAria: "Hand on {name}", handed: "handed", structure: "structure", blastRow: "Blast", burstGoneLine: "gone line", burstJudgeLine: "judge line", declarePass: "Passed", declareFail: "Failed", declareTip: "declare tip", declarePassAria: "Declare {name} passed", declareFailAria: "Declare {name} failed", declared: "the Judge's call" };
const burstIds = { itemUuid: "I.1", rowKey: "burst", activationId: "act" };
const burstRows = [
  { key: "T.a", name: "Alpha", state: "open", entryKey: "T~a", target: 11, targetTip: "ttip" },
  { key: "T.b", name: "Beta", state: "rolled", entryKey: "T~b", entry: { saved: true, total: 14, target: 11 }, target: 11, targetTip: "ttip", damage: { amount: 5, judge: false }, damageTip: "dtip" },
  { key: "T.c", name: "Gamma", state: "applied", entryKey: "T~c", entry: { saved: false, total: 6, target: 11, amount: 11, presser: "pa" }, target: 11, targetTip: "ttip", damage: { amount: 11, judge: false }, damageTip: "dtip2" },
  { key: "T.d", name: "Delta", state: "judge", entryKey: "T~d", entry: { saved: true, total: 12, target: 11, why: "figure" }, whyText: "Judge settles" },
  { key: "T.e", name: "Epsilon", state: "undone", entryKey: "T~e", entry: { saved: false, total: 4, target: 11 } },
];
const burstSeat = (over) => ({ judge: true, ownsSubject: () => true, ownsVehicle: () => true, mayUndo: (entry) => entry.presser === "pa", ...over });
const burstModel = (seat, over = {}) => burstCardModel({ title: "Gear goes off", subtitle: "Bearer", words: burstWords, note: "Area 20′ about the spot (MM p. 55)", noteTooltip: "area tip", rolledLine: "Rolled once for the area: 3d6 = 11", rows: burstRows, vehicles: [{ uuid: "V.1", name: "Cart", state: "open", tip: "vtip" }, { uuid: "V.2", name: "Wagon", state: "handed" }], buildingsLine: "Buildings line (MM p. 55)", ids: burstIds, messageId: "M1", seat, ...over });

t("the burst card's table: each row's Save, damage and press by the entry's state, with Apply for the subject's owner, Undo on an applied row by lib's undo rule, and a Judge row's reason under its name", () => {
  const model = burstModel(burstSeat());
  const rows = model.sections[0].rows;
  assert.deepEqual(model.labels, { name: "In the area", aside: "Save", total: "Damage", actions: "" });
  const [a, b, c, d, e, v1, v2] = rows;
  assert.deepEqual([a.aside, a.asideTooltip, a.actions.map((x) => x.action), a.actions[0].data.entryKey, a.actions[0].data.messageId], ["11+", "ttip", ["itemRun.roll"], "T~a", "M1"], "an open row's Save press names the card and the entry");
  assert.deepEqual([b.aside, b.total, b.tooltipText, b.actions.map((x) => [x.action, x.data.entryKey, x.data.messageId])], ["11+ · 14 Holds", 5, "dtip", [["itemRun.apply", "T~b", "M1"]]]);
  assert.deepEqual([c.aside, c.total, c.actions.map((x) => x.action)], ["11+ · 6 Fails", 11, ["itemRun.undo"]]);
  assert.deepEqual([d.detail, d.total, d.actions], ["Judge settles", "", undefined], "a Judge row shows its reason and offers nothing");
  assert.deepEqual([e.detail, e.total, e.actions], ["Undone", "", undefined]);
  assert.deepEqual([v1.total, v1.tooltipText, v1.actions.map((x) => [x.action, x.data.vehicleUuid, x.data.messageId, !!x.ariaLabel])], ["structure", "vtip", [["itemRun.handOn", "V.1", "M1", true]]]);
  assert.deepEqual([v2.detail, v2.actions], ["handed", undefined], "a handed vehicle reads handed and offers nothing");
  assert.deepEqual([model.note, model.noteTooltip, model.footnote, model.lines, model.buttons.map((x) => x.action)], ["Area 20′ about the spot (MM p. 55)", "area tip", "Rolled once for the area: 3d6 = 11", ["Buildings line (MM p. 55)"], ["itemRun.applyAll"]]);
  for (const action of rows.flatMap((r) => r.actions ?? []).concat(model.buttons)) assert.ok(action.ariaLabel && action.tooltip, `${action.action} carries an accessible name and a tooltip`);
});

t("a seat sees the rows of the bodies it owns: no Apply or Undo on another's, no Apply all with nothing of its own to apply, no buildings line for a seat that is not a Judge's", () => {
  const mine = burstModel(burstSeat({ judge: false, ownsSubject: (key) => key === "T.b", ownsVehicle: () => false }));
  assert.deepEqual(mine.sections[0].rows.map((r) => r.name), ["Beta"]);
  assert.equal(mine.lines, undefined, "the buildings line is the Judge's alone");
  assert.deepEqual(mine.buttons.map((x) => x.action), ["itemRun.applyAll"]);
  const none = burstModel(burstSeat({ judge: false, ownsSubject: (key) => key === "T.a", ownsVehicle: () => false }));
  assert.equal(none.buttons, undefined, "a row still open holds no verdict to apply");
  const undoOnly = burstModel(burstSeat({ judge: false, ownsSubject: (key) => key === "T.c", mayUndo: () => false, ownsVehicle: () => false }));
  assert.equal(undoOnly.sections[0].rows[0].actions, undefined, "an applied row's Undo is the presser's or the subject's owners'");
  const vehicleSeat = burstModel(burstSeat({ judge: false, ownsSubject: () => false, ownsVehicle: (uuid) => uuid === "V.1" }));
  assert.deepEqual(vehicleSeat.sections[0].rows.map((r) => r.name), ["Cart"], "a vehicle's owner is shown its row alone");
});

t("a burst whose save is blank has no Save press and a blank cell with the page alone, and offers the Judge's seat alone Passed and Failed on an open row", () => {
  const blankRows = [{ key: "T.a", name: "Alpha", state: "open", entryKey: "T~a", target: null, targetTip: "MM p. 55" }, { key: "T.b", name: "Beta", state: "rolled", entryKey: "T~b", entry: { saved: true, declared: true }, target: null, damage: { amount: 5, judge: false } }];
  const blank = (seat) => burstModel(seat, { canSave: false, rows: blankRows, vehicles: [] }).sections[0].rows;
  const [row, rolled] = blank(burstSeat());
  assert.deepEqual([row.aside, row.asideTooltip, row.actions.map((a) => [a.action, a.label, a.data.declared, a.data.entryKey, a.data.messageId, a.tooltip, a.ariaLabel])], [" ", "MM p. 55", [["itemRun.declare", "Passed", true, "T~a", "M1", "declare tip", "Declare Alpha passed"], ["itemRun.declare", "Failed", false, "T~a", "M1", "declare tip", "Declare Alpha failed"]]], "Passed and Failed carry the verdict and the warning; no Save press");
  assert.deepEqual([rolled.aside, rolled.actions.map((a) => a.action)], ["Holds (the Judge's call)", ["itemRun.apply"]], "a declared verdict is marked as the Judge's call, and only the open row offers a declared press");
  assert.deepEqual(blank(burstSeat({ judge: false }))[0].actions, [], "a seat that is not the Judge's is offered none");
  assert.deepEqual(blank(burstSeat({ ownsSubject: () => false })), [], "nor a seat that owns no subject");
  const named = burstModel(burstSeat()).sections[0].rows[0];
  assert.deepEqual(named.actions.map((a) => a.action), ["itemRun.roll"], "a card that names a save keeps its Save press and no declared one");
});

t("a figure's damage is the share a passed save takes off, then the body's defense stage; the tooltip names the dice, what they rolled, the share and the page", () => {
  assert.deepEqual(burstDamageOf({ rolled: 11, saved: false, reduction: 0.5, stage: null }), { amount: 11, judge: false, defended: false });
  const saved = burstDamageOf({ rolled: 10, saved: true, reduction: 0.5, stage: null });
  assert.deepEqual([saved.amount, saved.judge], [5, false]);
  assert.equal(burstDamageOf({ rolled: 10, saved: true, reduction: null, stage: null }).judge, true, "a passed save with no share imported is the Judge's");
  const damageWords = { rolled: "rolled", takesOff: "the share a passed save takes off", noShare: "the failed save takes none off", defenses: "then defenses" };
  assert.equal(damageTip({ amount: 5, dice: "3d6", rolled: 10, saved: true, reduction: 0.5, cite: "MM p. 55", words: damageWords }), "5: 3d6 rolled 10, the share a passed save takes off (0.5) (MM p. 55)");
  assert.equal(damageTip({ amount: 11, dice: "3d6", rolled: 11, saved: false, reduction: 0.5, defended: true, words: damageWords }), "11: 3d6 rolled 11, the failed save takes none off, then defenses");
});

t("a burst that rolled nothing is a plain line, with the blast's blank cell and the page where a figure was blank, and no row where the item is gone", () => {
  const figure = blankBurstModel({ title: "t", words: burstWords, why: "figure", cite: "MM p. 55" });
  assert.deepEqual([figure.sections[0].rows[0].name, figure.sections[0].rows[0].targetText, figure.sections[0].rows[0].targetTooltip, figure.lines], ["Blast", " ", "MM p. 55", ["judge line"]]);
  const gone = blankBurstModel({ title: "t", words: burstWords, why: "gone", cite: "MM p. 55" });
  assert.deepEqual([gone.sections[0].rows, gone.lines], [[], ["gone line"]]);
  assert.deepEqual(pressesOf(figure), []);
});

/* -------------------------------------------- */
/*  The swig and the on-hit save                 */
/* -------------------------------------------- */

const { healTip, outcomeCardModel, resultCardModel, swigUnknownModel } = await import("../scripts/lib/item-run-card-logic.mjs");
const swigWords = { ...words, save: "Save", saveTip: "Roll this body's save", saveAria: "Roll the save for {name}", undo: "Undo", undone: "Undone", undoOutcomeTip: "Take back", undoOutcomeAria: "Undo the result for {name}", heal: "Heal", healPressTip: "Heal tip", healAria: "Heal the drinker", askSave: "Ask the save", askSaveTip: "Ask tip", askSaveAria: "Ask the drinker", declarePass: "Passed", declareFail: "Failed", declareTip: "Declare tip", declarePassAria: "Declare {name} passed", declareFailAria: "Declare {name} failed" };
const swigIds = { itemUuid: "I.1", rowKey: "swig", activationId: "act" };
const swigSeat = (owned, presser = "") => ({ ownsSubject: (key) => owned.includes(key), mayUndo: (entry, key) => entry?.presser === presser || owned.includes(key) });
const swigRow = (over = {}) => ({ key: "S.d", name: "Drinker", state: "open", entryKey: "S~d", entry: null, target: 12, targetTip: "death 12+ (Book p. 7)", ...over });
const outcomeModel = (rows, over = {}) => outcomeCardModel({ title: "Jug", subtitle: "Drinker", words: swigWords, rows, ids: swigIds, messageId: "M1", seat: swigSeat(["S.d"]), ...over });

t("a heal's tooltip names the amount the write healed, the dice, what they rolled and the page, so a heal the hit points capped reads both figures", () => {
  assert.equal(healTip({ amount: 5, dice: "2d4", rolled: 7, cite: "Book p. 7", words: { rolled: "rolled" } }), "5: 2d4 rolled 7 (Book p. 7)");
  assert.equal(healTip({ amount: 7, dice: "2d4", rolled: 7, words: { rolled: "rolled" } }), "7: 2d4 rolled 7", "no page, none named");
});

t("a result card is a short table of lines, each with the tooltip of where its figure came from, and a line with none draws none", () => {
  const model = resultCardModel({ title: "Jug · a swig", subtitle: "Drinker", head: "Swig", rows: [{ text: "Healed 5", tip: "5: 2d4 rolled 7 (Book p. 7)", emphasis: "success" }, { text: "2 swigs left" }], lines: ["small print"] });
  assert.deepEqual(model.sections[0].rows, [{ name: "Healed 5", total: "", nameTooltip: "5: 2d4 rolled 7 (Book p. 7)", emphasis: "success" }, { name: "2 swigs left", total: "" }]);
  assert.deepEqual([model.labels, model.lines, model.subtitle, model.bare], [{ name: "Swig", total: "" }, ["small print"], "Drinker", true]);
  assert.deepEqual(pressesOf(model), []);
  assert.equal("lines" in resultCardModel({ title: "t", rows: [] }), false);
});

t("the unknown drinker's card: the note and, for a seat that owns the drinker's actor, Heal and Ask the save in their own rows, each pressing the card by its message id; any other seat reads the note alone", () => {
  const rows = { healRow: { text: "As a beastman: heals 2d4", tip: "Jug · heals: 2d4 (Book p. 7)" }, askRow: { text: "As a human or demi-human: a death save" } };
  const base = { title: "Jug · a swig", subtitle: "Drinker", words: swigWords, note: "Choose how the swig acts (Book p. 7)", messageId: "M7", ...rows };
  const owner = swigUnknownModel({ ...base, canPress: true });
  assert.deepEqual(pressesOf(owner), ["itemRun.swigHeal", "itemRun.swigAskSave"]);
  const [heal, ask] = owner.sections[0].rows;
  assert.deepEqual([heal.name, heal.nameTooltip, heal.actions[0].data, heal.actions[0].ariaLabel, heal.actions[0].tooltip], ["As a beastman: heals 2d4", "Jug · heals: 2d4 (Book p. 7)", { messageId: "M7" }, "Heal the drinker", "Heal tip"]);
  assert.deepEqual([ask.name, "nameTooltip" in ask, ask.actions[0].data, ask.actions[0].label], ["As a human or demi-human: a death save", false, { messageId: "M7" }, "Ask the save"], "a figure with no tooltip draws none");
  assert.equal(owner.note, "Choose how the swig acts (Book p. 7)");
  const other = swigUnknownModel({ ...base, canPress: false });
  assert.deepEqual([pressesOf(other), other.sections[0].rows, other.note], [[], [], "Choose how the swig acts (Book p. 7)"]);
});

t("a save card's open row: the Save press for a seat that owns the subject names the entry's key, the card and the ids; a seat that owns it not has none; a blank target is a blank cell with the tooltip alone", () => {
  const model = outcomeModel([swigRow()]);
  const [row] = model.sections[0].rows;
  assert.deepEqual([row.name, row.target, row.targetTooltip, row.total], ["Drinker", 12, "death 12+ (Book p. 7)", ""]);
  assert.deepEqual(row.actions, [{ action: "itemRun.roll", label: "Save", icon: "fa-solid fa-shield-halved", data: { ...swigIds, subject: "S.d", entryKey: "S~d", messageId: "M1" }, tooltip: "Roll this body's save", ariaLabel: "Roll the save for Drinker" }]);
  assert.deepEqual(pressesOf(outcomeModel([swigRow()], { seat: swigSeat([]) })), [], "a seat that owns nothing here has no press");
  const blank = outcomeModel([swigRow({ target: null, targetTip: "Book p. 7" })], { canSave: false, lines: ["No save is named"] });
  const [cell] = blank.sections[0].rows;
  assert.deepEqual([cell.targetText, cell.targetTooltip, "target" in cell, cell.actions, blank.lines], [" ", "Book p. 7", false, [], ["No save is named"]]);
  // The Judge's seat settles a blank-save card by declaring the verdict; the card's line stays.
  const judge = { ...swigSeat(["S.d"]), judge: true };
  const declared = outcomeModel([swigRow({ target: null, targetTip: "Book p. 7" })], { canSave: false, lines: ["No save is named"], seat: judge });
  assert.deepEqual(declared.sections[0].rows[0].actions.map((a) => [a.action, a.label, a.data, a.tooltip, a.ariaLabel]), [
    ["itemRun.declare", "Passed", { ...swigIds, subject: "S.d", entryKey: "S~d", messageId: "M1", declared: true }, "Declare tip", "Declare Drinker passed"],
    ["itemRun.declare", "Failed", { ...swigIds, subject: "S.d", entryKey: "S~d", messageId: "M1", declared: false }, "Declare tip", "Declare Drinker failed"],
  ]);
  assert.deepEqual(declared.lines, ["No save is named"], "the no-save line stays");
  assert.deepEqual(pressesOf(outcomeModel([swigRow()], { seat: judge })), ["itemRun.roll"], "a card that names a save offers the Judge no declared press");
  assert.deepEqual(pressesOf(outcomeModel([swigRow({ target: null })], { canSave: false, seat: { ...swigSeat([]), judge: true } })), [], "nor a seat that owns no subject");
  assert.deepEqual(pressesOf(outcomeModel([swigRow({ target: null, state: "applied", entry: { state: "applied", saved: true, declared: true, recordIds: ["e1"], presser: "pa" }, result: { text: "Saved (the Judge's call)" } })], { canSave: false, seat: judge })), ["itemRun.undo"], "an applied declared row offers the Undo as any other");
  const detailed = outcomeModel([swigRow({ detail: "blast +2", nameTooltip: "Save modifier read from the Barb row: +2 (Book p. 12)" })]).sections[0].rows[0];
  assert.deepEqual([detailed.detail, detailed.nameTooltip], ["blast +2", "Save modifier read from the Barb row: +2 (Book p. 12)"]);
});

t("a save card's verdict rows: applied reads the total, the entry's target and the caller's result line with its tooltip and an Undo while something is written, judge reads the reason, undone says so and offers nothing", () => {
  const entry = { state: "applied", saved: true, total: 14, target: 11, amount: 4, hp: [{ uuid: "A.d", amount: -4 }], presser: "pa" };
  const result = { text: "Saved · healed 4", tip: "Dice healed on a passed save: 1d6 (Book p. 7)" };
  const [applied] = outcomeModel([swigRow({ state: "applied", entry, result })]).sections[0].rows;
  assert.deepEqual([applied.total, applied.target, applied.outcome, applied.outcomeTooltip, applied.emphasis, applied.actions.map((a) => a.action)], [14, 11, "Saved · healed 4", "Dice healed on a passed save: 1d6 (Book p. 7)", "success", ["itemRun.undo"]]);
  assert.deepEqual(applied.actions[0].data, { ...swigIds, subject: "S.d", entryKey: "S~d", messageId: "M1" });
  assert.equal(applied.tooltipText, "death 12+ (Book p. 7)", "the total's tooltip is the save's");
  assert.deepEqual(pressesOf(outcomeModel([swigRow({ state: "applied", entry, result })], { seat: swigSeat([], "pa") })), ["itemRun.undo"], "the seat that pressed may undo");
  assert.deepEqual(pressesOf(outcomeModel([swigRow({ state: "applied", entry, result })], { seat: swigSeat([], "pb") })), [], "a seat that did neither may not");
  assert.deepEqual(pressesOf(outcomeModel([swigRow({ state: "applied", entry: { ...entry, hp: [], recordIds: [] }, result })])), [], "a pass that wrote nothing has nothing to undo");
  const failed = outcomeModel([swigRow({ state: "applied", entry: { state: "applied", saved: false, total: 5, target: 11, recordIds: ["e1"], presser: "pa" }, result: { text: "Failed · Held" } })]).sections[0].rows[0];
  assert.deepEqual([failed.emphasis, failed.outcome, "outcomeTooltip" in failed, failed.actions.length], ["failure", "Failed · Held", false, 1]);
  const judge = outcomeModel([swigRow({ state: "judge", entry: { state: "judge", saved: true, total: 14, target: 11, why: "figure" }, result: { text: "The Judge settles this one", tip: "Book p. 7" } })]).sections[0].rows[0];
  assert.deepEqual([judge.emphasis, judge.outcome, judge.outcomeTooltip, judge.actions], ["muted", "The Judge settles this one", "Book p. 7", undefined]);
  const undone = outcomeModel([swigRow({ state: "undone", entry: { state: "undone" } })]).sections[0].rows[0];
  assert.deepEqual([undone.outcome, undone.emphasis, undone.actions], ["Undone", "muted", undefined]);
});

console.log(`\ntest-item-run-cards: ${passed} checks passed.`);
