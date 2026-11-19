/**
 * The battlemap's shared pointer catcher: a press and a move reach a tool only
 * over the board, a release always reaches it and says whether it was over the
 * board, and the calibration capture abandons a drag released over a window
 * instead of committing it. The stage, board and windows are stand-ins.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

class Node {
  handlers = {};
  transform = { updateTransform() {} };
  addChild(child) { return child; }
  on(name, fn) { this.handlers[name] = fn; }
  clear() {}
  destroy() {}
}
let catchers = [];
const board = { id: "board" };
const palette = { id: "palette" };
globalThis.PIXI = {
  Container: Node,
  Graphics: Node,
  Sprite: class extends Node { constructor() { super(); catchers.push(this); } },
  Texture: { WHITE: {} },
  Transform: { IDENTITY: {} },
};
globalThis.canvas = { stage: new Node(), app: { screen: {}, view: board } };
const at = (target, x = 0, y = 0) => ({ nativeEvent: { target }, button: 0, buttons: 1, getLocalPosition: () => ({ x, y }) });

const { buildPointerCatcher, onBoard } = await import("../scripts/lib/pointer-catcher.mjs");

await ok("onBoard is the native target, by identity", () => {
  assert.equal(onBoard(at(board)), true);
  assert.equal(onBoard(at(palette)), false);
  assert.equal(onBoard({}), false);
});

await ok("a press and a move reach the tool over the board only; a release always, with where", () => {
  const seen = [];
  buildPointerCatcher(new Node(), {
    down: () => seen.push("down"),
    move: () => seen.push("move"),
    up: (_ev, over) => seen.push(`up:${over}`),
  });
  const h = catchers.at(-1).handlers;
  h.pointerdown(at(palette));
  h.pointermove(at(palette));
  assert.deepEqual(seen, [], "nothing over a window reaches the tool");
  h.pointerdown(at(board));
  h.pointermove(at(board));
  h.pointerup(at(palette));
  h.pointerupoutside(at(board));
  assert.deepEqual(seen, ["down", "move", "up:false", "up:true"]);
});

await ok("a capture drag released over a window is dropped, over the board it commits", async () => {
  const { CaptureOverlay } = await import("../scripts/battlemap/capture.mjs");
  const host = { samples: { squares: [], corners: [], scale: null }, onSamplesChanged() {} };
  const overlay = new CaptureOverlay(host);
  overlay.mode = "square";
  overlay.redraw = () => {};
  overlay.drawTemp = () => {};
  overlay.container = new Node();
  globalThis.foundry = { canvas: { containers: { GridMesh: class extends Node { initialize() { return this; } } } } };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  overlay.build();
  const h = overlay.catcher.handlers;
  const drag = (releaseOn) => {
    h.pointerdown(at(board, 0, 0));
    h.pointermove(at(board, 100, 100));
    h.pointermove(at(palette, 300, 300));
    h.pointerup(at(releaseOn, 300, 300));
  };
  drag(palette);
  assert.equal(host.samples.squares.length, 0, "released over a window: nothing committed");
  assert.equal(overlay.drag, null, "and the drag is gone");
  drag(board);
  assert.equal(host.samples.squares.length, 1, "released over the board: committed");
});

console.log(`\n${passed} passed`);
