/**
 * The drag corner every module window asks for (scripts/lib/window-resize.mjs).
 *
 * A stand-in hook bus and stand-in applications: what this pins is which
 * windows the hook takes and that it writes both places core reads. That a
 * real handle is built, shows and drags is the live walk's to prove
 * (tools/live/window-contract.mjs).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const handlers = new Map();
globalThis.Hooks = { on: (name, fn) => handlers.set(name, fn) };

const { isModuleWindow, installWindowResize } = await import("../scripts/lib/window-resize.mjs");
installWindowResize();

/** An application as core's preRender hands it to the hook. */
const app = (classes, { hasFrame = true } = {}) => ({ hasFrame, options: { classes, window: { resizable: false } } });
const firstRender = () => ({ isFirstRender: true, window: { resizable: false } });
const fire = (a, options) => handlers.get("preRenderApplicationV2")(a, {}, options);

ok("the hook is on the event that runs ahead of the frame", () => {
  assert.deepEqual([...handlers.keys()], ["preRenderApplicationV2"]);
});

ok("a window of this module is told by the module's class or a class it prefixes", () => {
  assert.equal(isModuleWindow(app(["acks-extras"])), true);
  assert.equal(isModuleWindow(app(["acks-ui", "acks-extras-importer-dialog"])), true);
});

ok("a window of anyone else is not, a look-alike prefix included", () => {
  assert.equal(isModuleWindow(app(["acks-ui", "acks", "acks2"])), false);
  assert.equal(isModuleWindow(app(["acks-extrasy"])), false);
  assert.equal(isModuleWindow(app(undefined)), false);
  assert.equal(isModuleWindow(null), false);
});

ok("a first render writes the application's option and the render's", () => {
  const a = app(["acks-extras-scroll"]);
  const options = firstRender();
  fire(a, options);
  assert.equal(a.options.window.resizable, true);
  assert.equal(options.window.resizable, true);
});

ok("a window declared fixed gets the corner all the same", () => {
  const a = app(["acks-extras-scroll"]);
  a.options.window.resizable = false;
  fire(a, firstRender());
  assert.equal(a.options.window.resizable, true);
});

ok("a first render with no window options still writes the application's", () => {
  const a = app(["acks-extras"]);
  fire(a, { isFirstRender: true });
  assert.equal(a.options.window.resizable, true);
});

ok("a later render, a frameless window and a foreign window are left as they are", () => {
  const later = app(["acks-extras"]);
  fire(later, { isFirstRender: false, window: { resizable: false } });
  assert.equal(later.options.window.resizable, false);

  const frameless = app(["acks-extras"], { hasFrame: false });
  fire(frameless, firstRender());
  assert.equal(frameless.options.window.resizable, false);

  const foreign = app(["acks", "acks2"]);
  const options = firstRender();
  fire(foreign, options);
  assert.equal(foreign.options.window.resizable, false);
  assert.equal(options.window.resizable, false);
});

console.log(`${passed} checks passed.`);
