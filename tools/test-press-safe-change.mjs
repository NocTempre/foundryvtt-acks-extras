/**
 * `writeOnChange` (scripts/lib/press-safe-change.mjs): a change made during a
 * press on one of the window's controls is written after the press ends, and
 * after the click; any other change is written at once.
 */
import assert from "node:assert/strict";
import { writeOnChange } from "../scripts/lib/press-safe-change.mjs";

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
};

/** An EventTarget standing in for a DOM node, matched by a fixed answer to `closest`. */
class Node extends EventTarget {
  constructor({ control = false, value = "" } = {}) {
    super();
    this.control = control;
    this.value = value;
  }
  closest() {
    return this.control ? this : null;
  }
}

/** Dispatch `type` so its target is `node`, through `root`'s listeners as the DOM would bubble it. */
const fire = (root, node, type) => {
  const event = new Event(type);
  Object.defineProperty(event, "target", { value: node });
  root.dispatchEvent(event);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const setup = () => {
  const doc = new EventTarget();
  const root = new EventTarget();
  root.ownerDocument = doc;
  const writes = [];
  writeOnChange(root, (field) => writes.push(field.value));
  return { doc, root, writes };
};

await check("a change with no press is written at once", async () => {
  const { root, writes } = setup();
  fire(root, new Node({ value: "a" }), "change");
  assert.deepEqual(writes, ["a"]);
});

await check("a change during a press on a control waits for the release and the click", async () => {
  const { doc, root, writes } = setup();
  const button = new Node({ control: true });
  const field = new Node({ value: "b" });
  const order = [];
  fire(root, button, "pointerdown");
  fire(root, field, "change");
  assert.deepEqual(writes, [], "held during the press");
  doc.dispatchEvent(new Event("pointerup"));
  order.push(`click, writes ${writes.length}`);
  assert.deepEqual(writes, [], "still held when the click is dispatched");
  await tick();
  assert.deepEqual(writes, ["b"]);
  assert.deepEqual(order, ["click, writes 0"]);
});

await check("a pointercancel releases the held change too", async () => {
  const { doc, root, writes } = setup();
  fire(root, new Node({ control: true }), "pointerdown");
  fire(root, new Node({ value: "c" }), "change");
  doc.dispatchEvent(new Event("pointercancel"));
  await tick();
  assert.deepEqual(writes, ["c"]);
});

await check("a press on something that is not a control holds nothing", async () => {
  const { root, writes } = setup();
  fire(root, new Node(), "pointerdown");
  fire(root, new Node({ value: "d" }), "change");
  assert.deepEqual(writes, ["d"]);
});

await check("after a release, the next change is written at once and only once", async () => {
  const { doc, root, writes } = setup();
  fire(root, new Node({ control: true }), "pointerdown");
  doc.dispatchEvent(new Event("pointerup"));
  await tick();
  assert.deepEqual(writes, [], "a press with no change writes nothing");
  fire(root, new Node({ value: "e" }), "change");
  assert.deepEqual(writes, ["e"]);
  doc.dispatchEvent(new Event("pointercancel"));
  await tick();
  assert.deepEqual(writes, ["e"], "a stray pointercancel after the press writes nothing more");
});

console.log(`test-press-safe-change: ${passed} passed`);
