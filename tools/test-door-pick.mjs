/**
 * The door pick (`lib/door-pick.mjs`), offline: which door controls a seat is
 * offered (the visible ones, a secret door to a Judge only), which door a press
 * hit, how a press past the range reads for each seat, and `pickDoor` itself on
 * a stand-in canvas and page: a press answers through the pointer catcher and
 * the door control beneath it never hears it, Enter skips, a right press and
 * Escape cancel, and the catcher, the key listener and the banner are gone
 * once it answers. The scene, tokens and walls are invented.
 *
 * What only a live canvas shows stays live: that the catcher sits above core's
 * door controls in the hit test, and what the banner looks like.
 *
 * Usage: node tools/test-door-pick.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok   ${name}`);
};

/* ------------------------------------------------------------------ */
/*  Stand-ins                                                         */
/* ------------------------------------------------------------------ */

class Node {
  handlers = {};
  children = [];
  destroyed = false;
  transform = { updateTransform() {} };
  addChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
  }
  on(name, fn) {
    this.handlers[name] = fn;
  }
  destroy() {
    this.destroyed = true;
  }
}
const catchers = [];
const rects = [];
globalThis.PIXI = {
  Container: Node,
  Graphics: class extends Node {
    lineStyle() {}
    drawRect(...r) {
      rects.push(r);
    }
  },
  Sprite: class extends Node {
    constructor() {
      super();
      catchers.push(this);
    }
  },
  Texture: { WHITE: {} },
  Transform: { IDENTITY: {} },
};

const board = { id: "board" };
const palette = { id: "palette" };
const notes = [];
globalThis.ui = { notifications: { warn: (text) => notes.push(text) } };

const hooks = new Map();
let hookId = 0;
globalThis.Hooks = {
  on: (name, fn) => (hooks.set(++hookId, { name, fn }), hookId),
  off: (_name, id) => hooks.delete(id),
};

const listeners = [];
const banners = [];
const el = () => {
  const node = {
    className: "",
    dataset: {},
    attrs: {},
    children: [],
    textContent: "",
    removed: false,
    classes: new Set(),
    classList: { toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)) },
    setAttribute: (k, v) => (node.attrs[k] = v),
    appendChild: (child) => (node.children.push(child), child),
    remove: () => (node.removed = true),
  };
  return node;
};
globalThis.document = {
  documentElement: {},
  body: { appendChild: (node) => (banners.push(node), node) },
  createElement: () => el(),
  addEventListener: (type, fn) => listeners.push({ type, fn }),
  removeEventListener: (type, fn) => {
    const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) listeners.splice(i, 1);
  },
};

const { offeredDoors, doorAt, judgeDoor, pickDoor, rangeStated, DOOR_HALF } = await import("../scripts/lib/door-pick.mjs");

const DOOR = 1;
const SECRET = 2;
const control = (id, door, c, visible = true) => ({ visible, wall: { id, document: { door, c } }, pressed: 0, _onMouseDown() { this.pressed++; } });

/** A scene whose grid measures a pixel as a tenth of a foot; one token stands at (0, 0) with a 100-pixel body. */
const makeScene = () => {
  const scene = {
    id: "s1",
    grid: { units: "ft", measurePath: ([a, b]) => ({ distance: Math.hypot(b.x - a.x, b.y - a.y) / 10 }) },
    tokens: [],
  };
  const token = { id: "t1", parent: scene, actor: { uuid: "Actor.c1" }, x: 0, y: 0, width: 1, height: 1, getCenterPoint: ({ x, y }) => ({ x: x + 50, y: y + 50 }) };
  scene.tokens = [token];
  scene.tokens.get = (id) => scene.tokens.find((t) => t.id === id);
  return { scene, token };
};

// Walls: near at (300, 50) is 25 ft off the token's centre (50, 50); far at (1050, 50) is 100 ft off.
const nearC = [300, 0, 300, 100];
const farC = [1050, 0, 1050, 100];
const secretC = [50, 400, 150, 400];
const casterActor = { uuid: "Actor.c1" };

const setCanvas = (controls, over = {}) => {
  const { scene, token } = makeScene();
  const stage = new Node();
  globalThis.canvas = { scene, stage, app: { screen: {}, view: board }, dimensions: { uiScale: 1 }, controls: { doors: { children: controls } }, ...over };
  return { scene, token, stage };
};
const at = (x, y, over = {}) => ({ nativeEvent: { target: board }, button: 0, stopped: 0, stopPropagation() { this.stopped++; }, getLocalPosition: () => ({ x, y }), ...over });
const press = (ev) => catchers.at(-1).handlers.pointerdown(ev);
const text = { banner: "pick", tip: "tip", far: "far-warning", refused: (reason) => `refused:${reason}` };
const settled = (promise) => Promise.race([promise.then((v) => ({ v })), new Promise((r) => setImmediate(() => r(null)))]);
const key = (k, target) => listeners.find((l) => l.type === "keydown").fn({ key: k, target, preventDefault() {}, stopPropagation() {} });

/* ------------------------------------------------------------------ */
/*  The pure halves                                                   */
/* ------------------------------------------------------------------ */

await ok("only the controls a seat sees are offered, and only doors", () => {
  const controls = [control("w1", DOOR, nearC), control("w2", DOOR, farC, false), control("w3", 0, nearC), control("w4", DOOR, [0, 0, "x", 0])];
  const offered = offeredDoors(controls, { isGM: false });
  assert.deepEqual(offered.map((d) => d.wallId), ["w1"]);
  assert.deepEqual(offered[0].centre, { x: 300, y: 50 });
  assert.deepEqual(offeredDoors(null, {}), []);
});

await ok("a secret door is never offered to a Player, even where core shows its control; a Judge is offered it", () => {
  const controls = [control("w1", DOOR, nearC), control("w9", SECRET, secretC)];
  assert.deepEqual(offeredDoors(controls, { isGM: false }).map((d) => d.wallId), ["w1"]);
  assert.deepEqual(offeredDoors(controls, { isGM: true }).map((d) => d.wallId), ["w1", "w9"]);
  assert.equal(offeredDoors(controls, { isGM: true }).find((d) => d.wallId === "w9").secret, true);
});

await ok("a point is on a door inside its hit square, the nearer where two overlap, and none outside", () => {
  const doors = [{ wallId: "a", centre: { x: 100, y: 100 } }, { wallId: "b", centre: { x: 110, y: 100 } }];
  assert.equal(doorAt(doors, { x: 100, y: 100 }, DOOR_HALF).wallId, "a");
  assert.equal(doorAt(doors, { x: 108, y: 100 }, DOOR_HALF).wallId, "b");
  assert.equal(doorAt(doors, { x: 100 + DOOR_HALF + 1 + 10, y: 300 }, DOOR_HALF), null);
  assert.equal(doorAt(doors, { x: Number.NaN, y: 0 }, DOOR_HALF), null);
  assert.equal(doorAt([], { x: 0, y: 0 }, DOOR_HALF), null);
});

await ok("a door in range passes; past it a Player is refused and a Judge passes with a warning and `over`", () => {
  const { scene } = setCanvas([]);
  const measure = (a, b) => scene.grid.measurePath([a, b]).distance;
  const from = { x: 50, y: 50 };
  const door = (c) => ({ c });
  assert.deepEqual(judgeDoor(door(nearC), { isGM: false, rangeFeet: 30, from, measure }), { ok: true });
  assert.deepEqual(judgeDoor(door(farC), { isGM: false, rangeFeet: 30, from, measure }), { ok: false, reason: "outOfRange" });
  assert.deepEqual(judgeDoor(door(farC), { isGM: true, rangeFeet: 30, from, measure }), { ok: true, warn: "outOfRange", over: true });
  assert.deepEqual(judgeDoor(door(nearC), { isGM: false, rangeFeet: 25, from, measure }), { ok: true }, "at the range passes");
});

await ok("reach is to the nearest point of the wall, not its midpoint", () => {
  const measure = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) / 10;
  // The wall runs 0..1000 along y = 40; its midpoint is 500 px off, the nearest point 10 px.
  assert.deepEqual(judgeDoor({ c: [0, 40, 1000, 40] }, { isGM: false, rangeFeet: 5, from: { x: 50, y: 50 }, measure }), { ok: true });
});

await ok("a blank range is not measured; a gap that cannot be measured reads as past the range", () => {
  for (const rangeFeet of [null, undefined, "", "far", -1]) {
    assert.deepEqual(judgeDoor({ c: farC }, { isGM: false, rangeFeet, from: { x: 0, y: 0 }, measure: () => 9999 }), { ok: true }, JSON.stringify(rangeFeet));
  }
  assert.equal(rangeStated(0), true);
  assert.deepEqual(judgeDoor({ c: nearC }, { isGM: false, rangeFeet: 30, from: { x: 0, y: 0 }, measure: () => null }), { ok: false, reason: "outOfRange" });
});

await ok("a caster with no token on the scene reaches no door, for a Judge too, range or none", () => {
  for (const isGM of [false, true]) for (const rangeFeet of [null, 30]) {
    assert.deepEqual(judgeDoor({ c: nearC }, { isGM, rangeFeet, from: null, measure: () => 1 }), { ok: false, reason: "noToken" });
  }
});

/* ------------------------------------------------------------------ */
/*  pickDoor                                                          */
/* ------------------------------------------------------------------ */

await ok("a press on an offered door answers it, the door control beneath never hears it, and the catcher, listener and banner are gone", async () => {
  const near = control("w1", DOOR, nearC);
  const { scene, token, stage } = setCanvas([near]);
  const before = [catchers.length, listeners.length, hooks.size, banners.length];
  const picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: 30, isGM: false, text });
  assert.deepEqual([catchers.length - before[0], listeners.length - before[1], hooks.size - before[2], banners.length - before[3]], [1, 1, 1, 1]);
  assert.equal(stage.children.length, 1, "the catcher's container is on the stage");
  const banner = banners.at(-1);
  assert.equal(banner.children[0].textContent, "pick", "the banner says what to press");
  assert.equal(banner.children[0].dataset.tooltipText, "tip");
  assert.equal(banner.attrs.role, "status");
  const ev = at(300, 50);
  press(ev);
  assert.deepEqual(await picked, { wallId: "w1", sceneId: scene.id });
  assert.ok(ev.stopped >= 1, "the press is stopped, so it goes no further");
  assert.equal(near.pressed, 0, "core's door control was never pressed");
  assert.deepEqual([stage.children.length, banner.removed, listeners.length - before[1], hooks.size - before[2]], [0, true, 0, 0], "everything the pick set up is gone");
});

await ok("a press over a window in front of the board is ignored, and a press on no door is no answer", async () => {
  const near = control("w1", DOOR, nearC);
  const { token } = setCanvas([near]);
  const picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: 30, isGM: false, text });
  press(at(300, 50, { nativeEvent: { target: palette } }));
  press(at(900, 900));
  assert.equal(await settled(picked), null, "still open");
  press(at(300, 50));
  assert.equal((await picked).wallId, "w1");
});

await ok("a Player's press on a door past the range is refused there and then, the pick stays open and the banner and a notice say so", async () => {
  const near = control("w1", DOOR, nearC);
  const far = control("w2", DOOR, farC);
  const { token } = setCanvas([near, far]);
  notes.length = 0;
  const picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: 30, isGM: false, text });
  const banner = banners.at(-1);
  press(at(1050, 50));
  assert.equal(await settled(picked), null, "refused, still open");
  assert.deepEqual(notes, ["refused:outOfRange"]);
  assert.equal(banner.children[0].textContent, "refused:outOfRange");
  assert.equal(banner.children[0].classes.has("acks-tag--danger"), true);
  assert.equal(far.pressed, 0);
  press(at(300, 50));
  assert.equal((await picked).wallId, "w1", "a door in range still answers");
});

await ok("a Judge's press past the range is allowed with a warning, and the answer says it was past", async () => {
  const far = control("w2", DOOR, farC);
  const { token, scene } = setCanvas([far]);
  notes.length = 0;
  const picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: 30, isGM: true, text });
  press(at(1050, 50));
  assert.deepEqual(await picked, { wallId: "w2", sceneId: scene.id, over: true });
  assert.deepEqual(notes, ["far-warning"]);
});

await ok("a secret door is not pressable on a Player's seat, and is on a Judge's", async () => {
  const secret = control("w9", SECRET, secretC);
  let { token } = setCanvas([secret]);
  let picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: null, isGM: false, text });
  press(at(100, 400));
  assert.equal(await settled(picked), null, "the Player's press found no door");
  key("Escape");
  assert.equal(await picked, null);
  ({ token } = setCanvas([control("w9", SECRET, secretC)]));
  picked = pickDoor({ caster: casterActor, casterToken: token, rangeFeet: null, isGM: true, text });
  press(at(100, 400));
  assert.equal((await picked).wallId, "w9");
});

await ok("no caster token on the scene refuses a press for both seats, and Enter still skips", async () => {
  for (const isGM of [false, true]) {
    setCanvas([control("w1", DOOR, nearC)]);
    notes.length = 0;
    const picked = pickDoor({ caster: { uuid: "Actor.elsewhere" }, casterToken: null, rangeFeet: null, isGM, text });
    press(at(300, 50));
    assert.deepEqual(notes, ["refused:noToken"]);
    assert.equal(await settled(picked), null);
    key("Enter");
    assert.deepEqual(await picked, { skipped: true });
  }
});

await ok("the caster's token is found by id, or by its actor where no token was passed", async () => {
  for (const casterToken of ["t1", null]) {
    const { scene } = setCanvas([control("w1", DOOR, nearC)]);
    const picked = pickDoor({ caster: casterActor, casterToken, rangeFeet: 30, isGM: false, text });
    press(at(300, 50));
    assert.deepEqual(await picked, { wallId: "w1", sceneId: scene.id }, String(casterToken));
  }
});

await ok("Enter skips, Escape and a right press cancel, and typing Enter in a field is not a skip", async () => {
  const { token } = setCanvas([control("w1", DOOR, nearC)]);
  let picked = pickDoor({ caster: casterActor, casterToken: token, text });
  key("Enter", { nodeType: 1, matches: (sel) => sel.includes("input") });
  assert.equal(await settled(picked), null, "Enter in a text field is the field's");
  key("Enter", { nodeType: 1, matches: () => false });
  assert.deepEqual(await picked, { skipped: true });

  picked = pickDoor({ caster: casterActor, casterToken: token, text });
  key("Escape");
  assert.equal(await picked, null);

  picked = pickDoor({ caster: casterActor, casterToken: token, text });
  const ev = at(300, 50, { button: 2 });
  press(ev);
  assert.equal(await picked, null);
  assert.ok(ev.stopped >= 1, "a right press is swallowed too");
});

await ok("a canvas torn down under the pick cancels it, and a second pick cancels the first", async () => {
  const { token } = setCanvas([control("w1", DOOR, nearC)]);
  let picked = pickDoor({ caster: casterActor, casterToken: token, text });
  for (const { name, fn } of [...hooks.values()]) if (name === "canvasTearDown") fn();
  assert.equal(await picked, null);

  const first = pickDoor({ caster: casterActor, casterToken: token, text });
  const second = pickDoor({ caster: casterActor, casterToken: token, text });
  assert.equal(await first, null, "the first is cancelled by the second");
  key("Enter");
  assert.deepEqual(await second, { skipped: true });
  assert.equal(listeners.length, 0, "no key listener is left");
  assert.equal(hooks.size, 0, "no hook is left");
});

await ok("with no scene or stage there is nothing to pick on: the pick is skipped, not cancelled", async () => {
  globalThis.canvas = { scene: null, stage: null };
  assert.deepEqual(await pickDoor({ caster: casterActor, text }), { skipped: true });
});

console.log(`\n${passed} tests passed`);
