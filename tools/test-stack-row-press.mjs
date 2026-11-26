/**
 * Offline tests for what a generated stack's row says of the item its bodies carry
 * and which body a press on it acts through (scripts/monsters/carry-press-logic.mjs).
 * Foundry-free: the localizers are stubs that echo their key and data.
 *
 * Run: node tools/test-stack-row-press.mjs
 */
import assert from "node:assert/strict";
import { carryControls, chooseCarrier, shareOf } from "../scripts/monsters/carry-press-logic.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const say = (key, data) => `${key}${data ? JSON.stringify(data) : ""}`;
const tr = (key, data) => `${key}${data ? JSON.stringify(data) : ""}`;
const rec = (key, state, more = {}) => ({ key, ordinal: Number(key.slice(1)), state, carries: [], tokenUuid: "", ...more });
const carrying = (key, state, more = {}) => rec(key, state, { carries: ["rowA"], ...more });
const here = (record) => (record.tokenUuid.startsWith("here") ? "here" : record.tokenUuid.startsWith("gone") ? "gone" : "elsewhere");
const choose = (roster, over = {}) => chooseCarrier({ roster, rowKey: "rowA", share: 1, pristine: 0, where: here, ...over });

t("a share is a whole number, zero where it is no figure", () => {
  assert.deepEqual([shareOf(2), shareOf("3"), shareOf(2.9), shareOf(-1), shareOf("x"), shareOf(null)], [2, 3, 2, 0, 0, 0]);
});

t("a carrier out on the viewed scene acts first, whatever else rests", () => {
  const roster = [carrying("m1", "materialized"), carrying("m2", "deployed", { tokenUuid: "here.2" })];
  const chosen = choose(roster, { share: 2 });
  assert.equal(chosen.mode, "out");
  assert.equal(chosen.record.key, "m2");
});

t("several out: the lowest ordinal acts", () => {
  const roster = [carrying("m3", "deployed", { tokenUuid: "here.3" }), carrying("m2", "deployed", { tokenUuid: "here.2" })];
  assert.equal(choose(roster, { share: 2 }).record.key, "m2");
});

t("a stamped body at rest is sent out, and so is one whose token is gone", () => {
  assert.deepEqual(choose([rec("m1", "materialized"), carrying("m2", "materialized")]).record.key, "m2");
  const freed = choose([carrying("m1", "deployed", { tokenUuid: "gone.1" })]);
  assert.equal(freed.mode, "rest");
});

t("a slot unspent with a body to take it sends one out; with no body at rest nothing is sent", () => {
  assert.equal(choose([rec("m1", "materialized")]).mode, "send");
  assert.equal(choose([], { pristine: 3 }).mode, "send");
  assert.equal(choose([], { pristine: 0 }).mode, "none", "no body left in the stack");
  assert.equal(choose([rec("m1", "deployed", { tokenUuid: "elsewhere.1" })]).mode, "none", "the only other body is out on another scene");
});

t("every slot spent on bodies not here gives no carrier, and a non-carrier is never sent for it", () => {
  const roster = [
    carrying("m1", "dead"),
    carrying("m2", "detached"),
    carrying("m3", "deployed", { tokenUuid: "elsewhere.3" }),
    rec("m4", "materialized"),
  ];
  assert.equal(choose(roster, { share: 3, pristine: 5 }).mode, "none");
});

t("a slot count above the stamped ones still sends, and a share of none sends nothing", () => {
  assert.equal(choose([carrying("m1", "dead"), rec("m2", "materialized")], { share: 2 }).mode, "send");
  assert.equal(choose([rec("m1", "materialized")], { share: 0 }).mode, "none");
});

/** A stack of one carried row over `roster`, and the row table the Foundry half would read. */
const stack = (roster, gen = {}) => ({ gen: { part: "partX", cite: "p. 1", carry: { rowA: 2 }, ...gen }, roster });
const table = { rowA: { label: "Lantern", cite: "p. 9", kind: "toggle" }, rowB: { label: "Whistle", cite: "", kind: "once" }, rowC: { label: "Fuse", cite: "p. 9", kind: "fuse" }, rowD: { label: "Cloak", cite: "p. 9", kind: null } };
const controls = (st, over = {}) => carryControls({ stack: st, pristine: 2, resolve: (k) => table[k] ?? null, where: here, runnable: (k) => k === "toggle" || k === "once", say, tr, ...over });

t("a toggle row reads its share and the item, with Raise; a once row offers Use", () => {
  const [raise] = controls(stack([]));
  assert.equal(raise.key, "rowA");
  assert.equal(raise.line, 'line{"n":2,"item":"Lantern"}');
  assert.equal(raise.label, "row.press.raise");
  assert.equal(raise.tip, "row.press.raiseTip");
  assert.equal(raise.disabled, false);
  assert.equal(raise.mode, "send");
  const [use] = controls(stack([], { carry: { rowB: 1 } }));
  assert.equal(use.label, "row.press.use");
});

t("a row with no share, no table row, no pressable item or no runner for its kind draws nothing", () => {
  assert.deepEqual(controls(stack([], { carry: { rowA: 0 } })), []);
  assert.deepEqual(controls(stack([], { carry: { rowZ: 2 } })), []);
  assert.deepEqual(controls(stack([], { carry: { rowD: 2 } })), [], "an item with no activation");
  assert.deepEqual(controls(stack([], { carry: { rowC: 2 } })), [], "a fuse has no runner");
  assert.deepEqual(controls(stack([]), { runnable: () => false }), []);
});

t("an out carrier's own item decides the press: raised reads Lower, used up reads the spent press, held off", () => {
  const roster = [carrying("m1", "deployed", { tokenUuid: "here.1" })];
  const [lower] = controls(stack(roster), { live: () => ({ active: true, usedUp: false }) });
  assert.equal(lower.label, "row.press.lower");
  const [lowered] = controls(stack(roster), { live: () => ({ active: false, usedUp: false }) });
  assert.equal(lowered.label, "row.press.raise");
  const used = stack([{ ...roster[0], carries: ["rowB"] }], { carry: { rowB: 1 } });
  const [spent] = controls(used, { live: () => ({ active: false, usedUp: true }) });
  assert.equal([spent.label, spent.disabled].join(), "row.press.spent,true");
  const [unread] = controls(stack(roster), { live: () => null });
  assert.equal(unread.label, "row.press.raise", "an item not read leaves the default press");
});

t("with every slot spent on bodies that are not here the line stays and no press is drawn", () => {
  const roster = [carrying("m1", "dead"), carrying("m2", "dead")];
  const [only] = controls(stack(roster), { pristine: 4 });
  assert.equal(only.mode, "none");
  assert.equal(only.line, 'line{"n":2,"item":"Lantern"}');
  assert.equal(only.label, "");
});

t("the line's tooltip is the imported row and its page for a generated stack, the Judge's choice otherwise", () => {
  const [generated] = controls(stack([]));
  assert.equal(generated.lineTip, 'generated{"item":"Lantern"} (p. 9)');
  const [fallback] = controls(stack([], { carry: { rowB: 1 } }));
  assert.equal(fallback.lineTip, 'generated{"item":"Whistle"} (p. 1)', "the row has no page of its own, the part's stands");
  const [chosen] = controls(stack([], { part: "" }));
  assert.equal(chosen.lineTip, "chosen");
});

t("a press is drawn only where the seat would own the body that acts; otherwise the line stays alone", () => {
  const asked = [];
  const owning = (answers) => (chosen) => {
    asked.push(chosen.mode);
    return answers[chosen.mode] ?? false;
  };
  const [owned] = controls(stack([]), { owns: owning({ send: true }) });
  assert.equal(owned.label, "row.press.raise", "an owned base actor: the press is drawn");
  const [unowned] = controls(stack([]), { owns: owning({ send: false }) });
  assert.equal([unowned.label, unowned.tip, unowned.line].join("|"), '||line{"n":2,"item":"Lantern"}', "an unowned base actor: the line only");
  const out = stack([carrying("m1", "deployed", { tokenUuid: "here.1" })]);
  const [mine] = controls(out, { owns: owning({ out: true }) });
  assert.equal(mine.label, "row.press.raise", "a carrier out whose actor the seat owns");
  const [theirs] = controls(out, { owns: owning({ out: false }) });
  assert.equal([theirs.mode, theirs.label].join("|"), "out|", "a carrier out the seat does not own: the line only");
  const [resting] = controls(stack([carrying("m1", "materialized")]), { owns: owning({ rest: false, send: true }) });
  assert.equal(resting.label, "", "the mode, not a guess, is what the seat is asked about");
  assert.deepEqual(asked, ["send", "send", "out", "out", "rest"]);
});

t("nothing is asked of ownership where no carrier could act", () => {
  let asked = 0;
  controls(stack([carrying("m1", "dead"), carrying("m2", "dead")]), { owns: () => (asked++, true) });
  assert.equal(asked, 0);
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
console.log(`\ntest-stack-row-press: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
