/**
 * Focus across a press that re-renders its window (scripts/lib/press-focus.mjs).
 *
 * A minimal tree stands in for the DOM: nodes with a parent, `dataset`,
 * `closest`, `contains`, `querySelectorAll("[data-action]")` and `focus`,
 * under a document holding `activeElement`. A render is simulated by building
 * a fresh tree, which detaches every old node and drops focus to the body, as
 * a part's replaced HTML does. What a mock cannot prove is that core's own
 * click dispatch, a real keyboard press and `focus()` on a live button behave
 * so; that is the live walk's (docs/character-sheet/TESTING.md).
 */
import assert from "node:assert/strict";
import { PressFocus, PRESS_FOCUS_TTL_MS } from "../scripts/lib/press-focus.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** A document of one window: its body, its root element and what holds focus. */
function makeDocument() {
  const doc = { activeElement: null, focused: [] };
  doc.body = node("BODY", {}, [], doc);
  doc.documentElement = node("HTML", {}, [], doc);
  doc.activeElement = doc.body;
  return doc;
}

/** One element: `data` becomes its dataset, `kids` its children. */
function node(tag, data = {}, kids = [], doc = null, extra = {}) {
  const el = {
    nodeType: 1, tagName: tag, dataset: { ...data }, parent: null, children: kids, ownerDocument: doc, disabled: false, ...extra,
    closest(sel) {
      for (let n = this; n; n = n.parent) if (sel === "[data-action]" && n.dataset?.action) return n;
      return null;
    },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === this) return true;
      return false;
    },
    querySelectorAll(sel) {
      assert.equal(sel, "[data-action]");
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.dataset.action) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    focus(opts) {
      if (this.disabled || !this.isConnected) return;
      this.ownerDocument.activeElement = this;
      this.ownerDocument.focused.push({ el: this, opts });
    },
  };
  for (const k of kids) { k.parent = el; }
  Object.defineProperty(el, "isConnected", { get() { return el.root === true || (el.parent ? el.parent.isConnected : false); } });
  return el;
}

/** A button of the sheet. */
const button = (doc, data, extra) => node("BUTTON", data, [], doc, extra);

/** A window: its root with `buttons` under it. */
function makeWindow(doc, buttons) {
  const root = node("FORM", {}, buttons, doc);
  root.root = true;
  return root;
}

const pill = (doc, slot, extra) => button(doc, { action: "toggleTraining", group: "weapons", slot, tooltip: "t" }, extra);
const shortcut = (doc, id, extra) => button(doc, { action: "toggleTrainingShortcut", shortcut: id }, extra);

/** The press-then-render cycle: focus a control, press it, swap in a new tree, finish the render. */
function cycle({ doc, press, rebuild, clock = 1000, finish = clock + 50, target }) {
  const state = new PressFocus();
  const root = press.root;
  const control = target ?? press.control;
  doc.activeElement = press.focus === false ? doc.body : control;
  state.note(control, root, clock);
  const next = rebuild();
  doc.activeElement = doc.body;
  return { state, root: next, restored: state.restore(next, finish) };
}

ok("a shortcut keeps keyboard focus across its re-render", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a"), shortcut(doc, "b"), shortcut(doc, "c")]);
  const { root: next, restored } = cycle({
    doc, press: { root, control: root.children[1] },
    rebuild: () => makeWindow(doc, [shortcut(doc, "a"), shortcut(doc, "b", { pressed: true }), shortcut(doc, "c")]),
  });
  assert.equal(restored, next.children[1]);
  assert.equal(doc.activeElement, next.children[1]);
  assert.equal(doc.activeElement.dataset.shortcut, "b");
});

ok("a pill is told from its siblings by its whole data set, not its action alone", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [pill(doc, "x"), pill(doc, "y"), pill(doc, "z")]);
  const { root: next, restored } = cycle({
    doc, press: { root, control: root.children[2] },
    rebuild: () => makeWindow(doc, [pill(doc, "x"), pill(doc, "y"), pill(doc, "z")]),
  });
  assert.equal(restored.dataset.slot, "z");
  assert.equal(doc.activeElement, next.children[2]);
});

ok("a changed tooltip does not change which control it is", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [button(doc, { action: "toggleBucket", bucket: "k", tooltipText: "closed" })]);
  const { root: next, restored } = cycle({
    doc, press: { root, control: root.children[0] },
    rebuild: () => makeWindow(doc, [button(doc, { action: "toggleBucket", bucket: "k", tooltipText: "open, 3 members" })]),
  });
  assert.equal(restored, next.children[0]);
});

ok("a press on a child of the control (a glyph inside the button) names the control", () => {
  const doc = makeDocument();
  const glyph = node("I", {}, [], doc);
  const chip = button(doc, { action: "trainingEdit" });
  chip.children = [glyph];
  glyph.parent = chip;
  const root = makeWindow(doc, [chip]);
  const state = new PressFocus();
  doc.activeElement = chip;
  state.note(glyph, root, 0);
  const next = makeWindow(doc, [button(doc, { action: "trainingEdit" })]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(next, 10), next.children[0]);
});

ok("repeated controls of one identity are told by their position", () => {
  const doc = makeDocument();
  const rows = () => makeWindow(doc, [button(doc, { action: "itemEdit" }), button(doc, { action: "itemEdit" }), button(doc, { action: "itemEdit" })]);
  const root = rows();
  const { root: next, restored } = cycle({ doc, press: { root, control: root.children[1] }, rebuild: rows });
  assert.equal(restored, next.children[1]);
});

ok("repeated controls that changed in number are ambiguous, so focus goes nowhere", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [button(doc, { action: "itemEdit" }), button(doc, { action: "itemEdit" })]);
  const { root: next, restored } = cycle({
    doc, press: { root, control: root.children[1] },
    rebuild: () => makeWindow(doc, [button(doc, { action: "itemEdit" })]),
  });
  assert.equal(restored, null);
  assert.equal(doc.activeElement, doc.body);
  assert.equal(next.children.length, 1);
});

ok("a control the render removed gets no focus, and nothing else is focused in its place", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a"), shortcut(doc, "b")]);
  const { restored } = cycle({
    doc, press: { root, control: root.children[1] },
    rebuild: () => makeWindow(doc, [shortcut(doc, "a")]),
  });
  assert.equal(restored, null);
  assert.equal(doc.activeElement, doc.body);
  assert.equal(doc.focused.length, 0);
});

ok("a control that came back disabled is not focused", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [pill(doc, "x")]);
  const { restored } = cycle({
    doc, press: { root, control: root.children[0] },
    rebuild: () => makeWindow(doc, [pill(doc, "x", { disabled: true })]),
  });
  assert.equal(restored, null);
  assert.equal(doc.focused.length, 0);
});

ok("focus outside the sheet at the press means nothing is remembered", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const other = button(doc, { action: "elsewhere" });
  const state = new PressFocus();
  doc.activeElement = other;
  state.note(root.children[0], root, 0);
  doc.activeElement = doc.body;
  assert.equal(state.restore(makeWindow(doc, [shortcut(doc, "a")]), 10), null);
});

ok("a press on something with no action remembers nothing", () => {
  const doc = makeDocument();
  const field = node("INPUT", {}, [], doc);
  const root = makeWindow(doc, [field]);
  const state = new PressFocus();
  doc.activeElement = field;
  state.note(field, root, 0);
  assert.equal(state.restore(makeWindow(doc, [node("INPUT", {}, [], doc)]), 10), null);
});

ok("focus that went to another window or field since the press is left where it is", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const next = makeWindow(doc, [shortcut(doc, "a")]);
  const dialogButton = button(doc, { action: "confirm" }, { root: true });
  doc.activeElement = dialogButton;
  assert.equal(state.restore(next, 10), null);
  assert.equal(doc.activeElement, dialogButton);
});

ok("a render nobody's press caused focuses nothing", () => {
  const doc = makeDocument();
  const state = new PressFocus();
  const next = makeWindow(doc, [shortcut(doc, "a")]);
  assert.equal(state.restore(next, 10), null);
  assert.equal(doc.focused.length, 0);
});

ok("a render later than the window after a press is nobody's press", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const next = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(next, PRESS_FOCUS_TTL_MS + 1), null);
  assert.equal(doc.focused.length, 0);
});

ok("a press that writes twice is restored by each of its renders", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const first = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(first, 10), first.children[0]);
  const second = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(second, 20), second.children[0]);
  assert.equal(doc.activeElement, second.children[0]);
});

ok("a render that finds the control missing leaves the press for the next render", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const middle = makeWindow(doc, []);
  doc.activeElement = doc.body;
  assert.equal(state.restore(middle, 10), null);
  const last = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(last, 20), last.children[0]);
});

ok("a render that finds focus held ends the press, so a later render does not take it back", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const first = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = button(doc, { action: "elsewhere" }, { root: true });
  assert.equal(state.restore(first, 10), null);
  const second = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(second, 20), null);
  assert.equal(doc.focused.length, 0);
});

ok("a press ends at the window after it, however many renders come", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const first = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(first, PRESS_FOCUS_TTL_MS), first.children[0]);
  const late = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(late, PRESS_FOCUS_TTL_MS + 1), null);
  const later = makeWindow(doc, [shortcut(doc, "a")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(later, PRESS_FOCUS_TTL_MS + 2), null);
});

ok("a later press replaces an earlier one", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a"), shortcut(doc, "b")]);
  const state = new PressFocus();
  doc.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  doc.activeElement = root.children[1];
  state.note(root.children[1], root, 5);
  const next = makeWindow(doc, [shortcut(doc, "a"), shortcut(doc, "b")]);
  doc.activeElement = doc.body;
  assert.equal(state.restore(next, 10), next.children[1]);
});

ok("focus is restored without scrolling the window", () => {
  const doc = makeDocument();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  const { restored } = cycle({ doc, press: { root, control: root.children[0] }, rebuild: () => makeWindow(doc, [shortcut(doc, "a")]) });
  assert.ok(restored);
  assert.deepEqual(doc.focused[0].opts, { preventScroll: true });
});

ok("a window of another document is read through its own document", () => {
  const main = makeDocument();
  const popped = makeDocument();
  const root = makeWindow(popped, [shortcut(popped, "a")]);
  const state = new PressFocus();
  // The main window holds focus; the sheet's own document does not.
  main.activeElement = button(main, { action: "x" });
  popped.activeElement = root.children[0];
  state.note(root.children[0], root, 0);
  const next = makeWindow(popped, [shortcut(popped, "a")]);
  popped.activeElement = popped.body;
  assert.equal(state.restore(next, 10), next.children[0]);
  assert.equal(popped.activeElement, next.children[0]);
  assert.equal(main.focused.length, 0);
});

ok("a missing or non-element argument is refused quietly", () => {
  const doc = makeDocument();
  const state = new PressFocus();
  const root = makeWindow(doc, [shortcut(doc, "a")]);
  state.note(null, root, 0);
  state.note({ nodeType: 3 }, root, 0);
  state.note(root.children[0], null, 0);
  assert.equal(state.restore(root, 1), null);
  assert.equal(state.restore(null, 1), null);
});

console.log(`\n${passed} passed`);
