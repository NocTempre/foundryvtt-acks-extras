/**
 * The Battlemap scene-control group, EXECUTED: `installSceneControls` is run
 * against a stand-in `Hooks`, and the tools its `getSceneControlButtons`
 * handler registers are called as core calls them. Core re-activates a
 * control's last tool when the group's own button is pressed again; a
 * canvas-arming tool must answer that press by resting the group at `off`,
 * and a tool picked on purpose must still arm.
 *
 * What the stand-ins cannot reach (core's private tool memory, a real press)
 * stays with the live walk.
 */
import assert from "node:assert/strict";

const root = (p) => new URL(`../${p}`, import.meta.url);

const hooks = {};
const activated = [];
const palettes = [];
globalThis.Hooks = { once() {}, on: (name, fn) => (hooks[name] = fn) };
globalThis.CONST = { GRID_MIN_SIZE: 50, GRID_TYPES: { SQUARE: 1 } };
globalThis.game = {
  i18n: { format: (k) => k, localize: (k) => k },
  user: { isGM: true },
  settings: { register() {}, get: () => null },
};
globalThis.ui = {
  notifications: { info() {}, warn() {}, error() {} },
  controls: { control: { name: "acksBattlemap" }, activate: (arg) => activated.push(arg) },
};
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        render() { return this; }
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: async () => true },
    },
    handlebars: { loadTemplates: async () => {} },
  },
  utils: { expandObject: (o) => o, hasProperty: () => false, getProperty: () => undefined },
};
globalThis.canvas = { scene: null, stage: { scale: { x: 1 } } };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.PIXI = new Proxy({}, { get: () => class {} });

const { installSceneControls } = await import(root("scripts/battlemap/module.mjs").href);
const { session, CAPTURE_MODES } = await import(root("scripts/battlemap/session.mjs").href);
const { terrainPaint, TerrainPaletteApp } = await import(root("scripts/battlemap/terrain-paint.mjs").href);
const { CONTROL_GROUP, TOOL_OFF } = await import(root("scripts/battlemap/constants.mjs").href);

installSceneControls();
const controls = {};
hooks.getSceneControlButtons(controls);
const group = controls[CONTROL_GROUP];
assert.ok(group, "the hook registers the group");
assert.equal(group.activeTool, TOOL_OFF, "the group's first entry lands on off");

// What arming leaves behind, recorded where the real objects would act.
const calls = [];
session.arm = (mode) => calls.push(["session.arm", mode]);
session.disarm = () => calls.push(["session.disarm"]);
terrainPaint.arm = (...args) => calls.push(["terrainPaint.arm", args[1]?.by]);
terrainPaint.disarm = () => calls.push(["terrainPaint.disarm"]);
TerrainPaletteApp.prototype.render = function render() { palettes.push(this); return this; };

/** An event whose target sits under the control button named `control`. */
const pressOn = (control) => ({ target: { closest: (selector) => (selector === "[data-control]" ? { dataset: { control } } : null) } });
/** A tick for the zero-delay timer the tool schedules. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const reset = () => { calls.length = 0; activated.length = 0; palettes.length = 0; };

const armingTools = [...CAPTURE_MODES, "terrain"];
const armedBy = { terrain: ["terrainPaint.arm", "tool"] };

for (const name of armingTools) {
  const tool = group.tools[name];
  assert.equal(typeof tool?.onChange, "function", `${name} is a tool of the group`);
  assert.ok(!tool.button, `${name} is a canvas mode, not a button`);

  // A press on the group's own button re-activates the remembered tool: it arms nothing.
  reset();
  tool.onChange(pressOn(CONTROL_GROUP), true);
  assert.deepEqual(calls, [], `${name}: a press on the group's button arms nothing`);
  assert.equal(palettes.length, 0, `${name}: and opens no palette`);
  assert.deepEqual(activated, [], `${name}: the rest is deferred past the press`);
  await tick();
  assert.deepEqual(activated, [{ tool: TOOL_OFF }], `${name}: the group is put back on off`);

  // A press on another control's button arms: a pick made from elsewhere.
  reset();
  tool.onChange(pressOn("walls"), true);
  await tick();
  assert.deepEqual(activated, [], `${name}: a press outside the group does not rest it`);
  assert.deepEqual(calls[0], name === "terrain" ? armedBy.terrain : ["session.arm", name], `${name}: a pick arms`);

  // A scripted activation hands no event and arms.
  reset();
  tool.onChange(undefined, true);
  await tick();
  assert.deepEqual(activated, [], `${name}: a scripted activation does not rest the group`);
  assert.deepEqual(calls[0], name === "terrain" ? armedBy.terrain : ["session.arm", name], `${name}: a scripted activation arms`);
  assert.equal(palettes.length, name === "terrain" ? 1 : 0, `${name}: the palette opens for the brush alone`);

  // A press on a tool button sits under no control button, and arms too.
  reset();
  tool.onChange({ target: { closest: () => null } }, true);
  await tick();
  assert.deepEqual(activated, [], `${name}: a tool button does not rest the group`);
  assert.equal(calls.length, 1, `${name}: and arms`);

  // Leaving the tool disarms, as before.
  reset();
  session.mode = name;
  tool.onChange(pressOn(CONTROL_GROUP), false);
  assert.deepEqual(calls, [name === "terrain" ? ["terrainPaint.disarm"] : ["session.disarm"]], `${name}: deactivation disarms`);
  session.mode = null;
}

// The resting tool still disarms the session.
reset();
group.tools[TOOL_OFF].onChange(undefined, true);
assert.deepEqual(calls, [["session.disarm"]], "off disarms the session");

// Closing the palette disarms the brush whatever armed it; one the toolbar's
// tool armed also puts the group back on off, but only while the group is the
// current control with the brush its active tool.
const closePalette = (armedBy, { control = CONTROL_GROUP, tool = "terrain" } = {}) => {
  reset();
  terrainPaint.armedBy = armedBy;
  ui.controls.control = control ? { name: control } : null;
  ui.controls.tool = tool ? { name: tool } : null;
  new TerrainPaletteApp()._onClose({});
};

closePalette("tool");
assert.deepEqual(calls, [["terrainPaint.disarm"]], "a palette closed over the tool's brush disarms it");
assert.deepEqual(activated, [{ tool: TOOL_OFF }], "and the group rests on off");

closePalette("tool", { control: "walls", tool: "terrain" });
assert.deepEqual(calls, [["terrainPaint.disarm"]], "another control current: the brush is still disarmed");
assert.deepEqual(activated, [], "another control current: the GM's control is left alone");

closePalette("tool", { tool: "off" });
assert.deepEqual(activated, [], "the brush no longer the group's active tool: nothing is activated");

closePalette("tool", { control: null, tool: null });
assert.deepEqual(activated, [], "no control current: nothing is activated");

for (const by of ["sheet", "palette"]) {
  closePalette(by);
  assert.deepEqual(calls, [["terrainPaint.disarm"]], `${by}: a palette closed over its brush disarms it`);
  assert.deepEqual(activated, [], `${by}: and does not touch the toolbar`);
}

// The Country brush's button is drawn off, with its reason, on a scene that is
// not a hex grid; the first-click refusal reads the same condition.
{
  const paint = await import(root("scripts/battlemap/terrain-paint.mjs").href);
  assert.equal(typeof paint.brushRefusalKey, "function", "one predicate names the refusal");
  assert.equal(typeof paint.markBrushControl, "function", "the control is marked from it");
  Object.assign(CONST.GRID_TYPES, { GRIDLESS: 0, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 });
  const square = { grid: { type: CONST.GRID_TYPES.SQUARE } };
  const hex = { grid: { type: CONST.GRID_TYPES.HEXODDQ } };
  const gridless = { grid: { type: CONST.GRID_TYPES.GRIDLESS } };
  assert.equal(paint.brushRefusalKey(hex), null, "a hex grid refuses nothing");
  for (const scene of [square, gridless, null]) {
    assert.equal(paint.brushRefusalKey(scene), "ACKS-BATTLEMAP.terrain.hexOnly", "any other grid refuses with the key the click speaks");
  }

  /** A stand-in for core's tool button and the list item around it. */
  const element = (extra = {}) => {
    const attrs = new Map();
    const classes = new Set();
    return {
      attrs,
      classes,
      disabled: false,
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      ...extra,
    };
  };
  const item = element();
  const button = element({ parentElement: item });
  const html = { nodeType: 1, querySelector: (s) => (s === 'button.tool[data-tool="terrain"]' ? button : null) };

  paint.markBrushControl(html, square);
  assert.equal(button.disabled, true, "the brush's button is off on a square scene");
  assert.equal(button.attrs.get("aria-disabled"), "true", "and says so to assistive technology");
  assert.ok(button.classes.has("acks-extras-brush-off"), "and is drawn off");
  assert.equal(item.attrs.get("data-tooltip-text"), "ACKS-BATTLEMAP.terrain.hexOnly", "the reason is its tooltip, through the manager");
  assert.equal(button.attrs.get("aria-description"), "ACKS-BATTLEMAP.terrain.hexOnly", "and its description");

  paint.markBrushControl(html, hex);
  assert.equal(button.disabled, false, "a hex scene turns it back on");
  assert.ok(!button.attrs.has("aria-disabled") && !item.attrs.has("data-tooltip-text") && !button.attrs.has("aria-description"), "and clears the reason");
  assert.ok(!button.classes.has("acks-extras-brush-off"), "and the cue");

  assert.doesNotThrow(() => paint.markBrushControl({ querySelector: () => null }, square), "a toolbar with no brush button is left alone");

  // The hook marks every render of the toolbar, and a grid change on the scene in view redraws it.
  assert.equal(typeof hooks.renderSceneControls, "function", "the toolbar's render is hooked");
  canvas.scene = square;
  hooks.renderSceneControls({}, html);
  assert.equal(button.disabled, true, "a render of the toolbar on a square scene marks the brush");
  const rendered = [];
  ui.controls.render = (arg) => rendered.push(arg);
  hooks.updateScene(square, { grid: { type: CONST.GRID_TYPES.HEXODDQ } });
  assert.deepEqual(rendered, [{ parts: ["tools"] }], "a grid change on the scene in view redraws the tools");
  hooks.updateScene(square, { name: "x" });
  hooks.updateScene({ grid: {} }, { grid: { type: 1 } });
  assert.equal(rendered.length, 1, "another change, or another scene, does not");
  canvas.scene = null;
}

console.log("battlemap controls: ok");
