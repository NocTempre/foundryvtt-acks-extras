/**
 * `setPendingOwnership` (scripts/lib/util.mjs) against a pending document
 * shaped as core 14 makes one: with no ownership in its creation data, its
 * source holds the ownership field's own initial object, and `updateSource`
 * merges into the source's objects in place.
 */
import assert from "node:assert/strict";
import { setPendingOwnership } from "../scripts/lib/util.mjs";

/** The field's initial, one object for every pending document of the class. */
const fieldInitial = { default: 0 };

/** A pending document: `named` is the ownership its creation data named, if any. */
function pending(named) {
  const doc = {
    _source: { ownership: named ? { ...named } : fieldInitial },
    updateSource(changes) {
      for (const [key, value] of Object.entries(changes)) Object.assign(doc._source[key], value);
    },
    get ownership() {
      return doc._source.ownership;
    },
  };
  return doc;
}

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
};

ok("the mock leaks as core does: a bare updateSource changes the next document's start", () => {
  const first = pending();
  first.updateSource({ ownership: { default: 3 } });
  assert.equal(pending().ownership.default, 3, "the write this helper exists to prevent");
  fieldInitial.default = 0;
});

ok("a pending document takes the level and the next one starts where the field says", () => {
  const first = pending();
  setPendingOwnership(first, { default: 3 });
  assert.deepEqual(first._source.ownership, { default: 3 });
  assert.deepEqual(fieldInitial, { default: 0 }, "the field's initial is untouched");
  assert.equal(pending().ownership.default, 0, "the next document made with no ownership is not opened");
});

ok("levels the creation data named are kept, and the named level is merged over them", () => {
  const doc = pending({ default: 0, userA: 2 });
  setPendingOwnership(doc, { default: 3 });
  assert.deepEqual(doc._source.ownership, { default: 3, userA: 2 });
});

console.log(`test-pending-ownership: ${passed} checks passed.`);
