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

console.log("battlemap controls: ok");
