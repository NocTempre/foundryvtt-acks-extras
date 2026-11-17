/**
 * `lib/dotted-path.mjs`: a write creates what the path crosses and replaces an
 * intermediate that is not a plain object, so it never throws on one. Every
 * object and key is invented.
 */
import assert from "node:assert/strict";
import { setPath } from "../scripts/lib/dotted-path.mjs";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

ok("creates the objects along a missing path", () => {
  assert.deepEqual(setPath({}, "a.b.c", 1), { a: { b: { c: 1 } } });
});

ok("keeps siblings and existing objects", () => {
  const o = { a: { keep: true } };
  setPath(o, "a.b", 2);
  assert.deepEqual(o, { a: { keep: true, b: 2 } });
});

ok("takes segments as well as a dotted string", () => {
  assert.deepEqual(setPath({}, ["a", "b"], 3), { a: { b: 3 } });
});

ok("replaces a primitive, null or array intermediate rather than throwing", () => {
  for (const bad of [5, "text", null, [1, 2]]) {
    const o = { a: bad };
    assert.doesNotThrow(() => setPath(o, "a.b", 1));
    assert.deepEqual(o, { a: { b: 1 } });
  }
});

ok("a one-segment path writes the key", () => {
  assert.deepEqual(setPath({ x: 1 }, "x", 2), { x: 2 });
});

console.log(`\n${passed} passed`);
