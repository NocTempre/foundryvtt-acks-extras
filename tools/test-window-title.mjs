/**
 * A window title cut short, shown whole on a hover (scripts/lib/window-title.mjs).
 *
 * Stand-in elements, a stand-in tooltip manager and a hand-cranked clock: what
 * this pins is the order of the guards — which hovers reach the manager, with
 * what, and which never do. That a real header clips, that a real pointer
 * arrives and that the real manager draws are the live recipe's to prove.
 */
import assert from "node:assert/strict";
import { clippedTitle, watchWindowTitle } from "../scripts/lib/window-title.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

/** The clock: timers queue here and run only when a test says the delay has passed. */
const timers = new Map();
let serial = 0;
globalThis.setTimeout = (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
const elapse = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };

/**
 * A window: a root wearing `classes`, and a title `textW` wide in a `boxW` box
 * at `top`. `padding` is taken out of the box on each side, as the title's own
 * `scrollWidth` counts it and the width of its text does not.
 */
function win({ classes = ["application", "acks-ui"], text = "A long title", textW = 400, boxW = 300, padding = 0, top = 400, connected = true } = {}) {
  const root = {
    classes,
    matches: (sel) => sel.split(",").some((s) => root.classes.includes(s.trim().slice(1))),
    querySelector: () => title,
  };
  const title = {
    isConnected: connected,
    textContent: text,
    textW, boxW, top,
    get scrollWidth() { return Math.max(Math.round(this.boxW), Math.round(this.textW + 2 * padding)); },
    get clientWidth() { return Math.round(this.boxW); },
    getBoundingClientRect() { return { width: this.boxW, top: this.top }; },
    ownerDocument: { createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: title.textW }) }) },
    closest: () => root,
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, v); },
    removeAttribute(k) { this.attrs.delete(k); },
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    fire(type) { for (const fn of this.listeners[type] ?? []) fn(); },
  };
  return { root, title };
}

/** The manager: `activate` marks the element as core's does and pins an UP tooltip at `pinned` or above. */
class Manager {
  static TOOLTIP_ACTIVATION_MS = 500;
  static TOOLTIP_DIRECTIONS = { UP: "UP", DOWN: "DOWN" };
  element = null;
  calls = [];
  deactivated = 0;
  bottom = 0;
  tooltip = { getBoundingClientRect: () => ({ bottom: this.bottom }) };
  activate(element, options) {
    this.calls.push(options);
    this.element = element;
    element.setAttribute("aria-describedby", "tooltip");
    // Five pixels clear above, unless that leaves the viewport: then pinned at its top, 53px tall.
    this.bottom = options.direction === "UP" ? Math.max(element.top - 5, 53) : element.top + 69;
  }
  deactivate() { this.deactivated++; this.element = null; }
}
const fresh = () => {
  timers.clear();
  globalThis.game = { tooltip: new Manager() };
  globalThis.foundry = { nue: { Tour: { tourInProgress: false } } };
  return globalThis.game.tooltip;
};

ok("a title is clipped only while its text is wider than its box", () => {
  assert.equal(clippedTitle(win({ text: "  Trade goods  ", textW: 400, boxW: 300 }).title), "Trade goods", "trimmed");
  assert.equal(clippedTitle(win({ textW: 300, boxW: 300 }).title), null, "an exact fit shows whole");
  assert.equal(clippedTitle(win({ textW: 200, boxW: 300 }).title), null);
  assert.equal(clippedTitle(win({ text: "   ", textW: 400, boxW: 300 }).title), null, "nothing to show");
});

ok("an overflow under half a pixel counts, where whole-pixel widths read equal", () => {
  const { title } = win({ textW: 300.125, boxW: 300 });
  assert.equal(title.scrollWidth, title.clientWidth, "the two whole-number readings agree");
  assert.equal(clippedTitle(title), "A long title");
  assert.equal(clippedTitle(win({ textW: 299.875, boxW: 300 }).title), null, "an eighth of a pixel to spare");
});

ok("a padded title is clipped by its padding, though its text is narrower than its box", () => {
  const { title } = win({ textW: 290, boxW: 300, padding: 10 });
  assert.ok(title.textW < title.boxW && title.scrollWidth > title.clientWidth);
  assert.equal(clippedTitle(title), "A long title");
  assert.equal(clippedTitle(win({ textW: 270, boxW: 300, padding: 10 }).title), null);
});

ok("only an ACKS surface answers, by the dress its root wears at that moment", () => {
  const a = win({ classes: ["application", "dialog"] });
  assert.equal(clippedTitle(a.title), null, "an undressed window");
  a.root.classes.push("acks-palette");
  assert.equal(clippedTitle(a.title), "A long title", "the colour half is a surface too");
  a.root.classes = ["application", "acks"];
  assert.equal(clippedTitle(a.title), null, "the dress taken off an open window");
  assert.equal(clippedTitle(win({ connected: false }).title), null, "a title out of the document");
  assert.equal(clippedTitle(null), null);
});

ok("a hover held for the manager's delay shows the whole title above it, and describes nothing", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  title.fire("pointerenter");
  assert.equal(tm.calls.length, 0, "nothing before the delay");
  assert.deepEqual([...timers.values()].map((t) => t.ms), [500], "the manager's own delay");
  elapse();
  assert.deepEqual(tm.calls, [{ text: "A long title", direction: "UP" }]);
  assert.equal(title.attrs.has("aria-describedby"), false, "the heading is not described by its own text");
});

ok("with no room above, the tooltip goes below rather than over the title", () => {
  const tm = fresh();
  const { root, title } = win({ top: 11 });
  watchWindowTitle(root);
  title.fire("pointerenter");
  elapse();
  assert.deepEqual(tm.calls.map((c) => c.direction), ["UP", "DOWN"]);
  assert.equal(title.attrs.has("aria-describedby"), false);
  const edge = win({ top: 53 });
  const tm2 = fresh();
  watchWindowTitle(edge.root);
  edge.title.fire("pointerenter");
  elapse();
  assert.deepEqual(tm2.calls.map((c) => c.direction), ["UP"], "touching the title is not over it");
});

ok("the reading is taken when the delay runs out, not when the pointer arrives", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  title.fire("pointerenter");
  title.boxW = 1000;
  elapse();
  assert.equal(tm.calls.length, 0, "widened in the meantime");
  title.fire("pointerleave");
  title.boxW = 300;
  title.fire("pointerenter");
  elapse();
  assert.equal(tm.calls.length, 1, "narrowed again, with no second watch");
});

ok("leaving, or pressing, before the delay runs out shows nothing", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  title.fire("pointerenter");
  title.fire("pointerleave");
  assert.equal(timers.size, 0);
  title.fire("pointerenter");
  title.fire("pointerdown");
  assert.equal(timers.size, 0, "a press is the start of a drag");
  elapse();
  assert.equal(tm.calls.length, 0);
});

ok("a press dismisses the title's own tooltip, and no other", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  title.fire("pointerenter");
  elapse();
  title.fire("pointerdown");
  assert.equal(tm.deactivated, 1);
  tm.element = { other: true };
  title.fire("pointerdown");
  assert.equal(tm.deactivated, 1, "a tooltip showing for something else stands");
});

ok("from a tooltip already showing, the title's follows at once", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  tm.element = { other: true };
  title.fire("pointerenter");
  assert.equal(timers.size, 0, "no second wait");
  assert.deepEqual(tm.calls, [{ text: "A long title", direction: "UP" }]);
});

ok("a running tour keeps the manager's tooltip", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  globalThis.foundry.nue.Tour.tourInProgress = true;
  title.fire("pointerenter");
  elapse();
  tm.element = { step: true };
  title.fire("pointerenter");
  assert.equal(tm.calls.length, 0);
});

ok("a window is watched once, however often it renders", () => {
  const tm = fresh();
  const { root, title } = win();
  watchWindowTitle(root);
  watchWindowTitle(root);
  assert.deepEqual(Object.fromEntries(Object.entries(title.listeners).map(([k, v]) => [k, v.length])), { pointerenter: 1, pointerleave: 1, pointerdown: 1 });
  title.fire("pointerenter");
  elapse();
  assert.equal(tm.calls.length, 1);
});

ok("a frameless application has no title to watch", () => {
  fresh();
  assert.doesNotThrow(() => watchWindowTitle({ querySelector: () => null }));
  assert.doesNotThrow(() => watchWindowTitle(null));
});

console.log("\ntest-window-title: all " + passed + " checks passed");
