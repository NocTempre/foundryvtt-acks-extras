/**
 * The core patch that answers an empty compendium id list without the server
 * (scripts/lib/patches/compendium-empty-load.mjs). A stand-in for core's
 * collection counts the calls that reach it; the wrapper is installed over it
 * on the plain-wrap path, since libWrapper is not loaded here.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const calls = [];
class CompendiumCollection {
  async getDocuments(query = {}) {
    calls.push({ self: this, query });
    return ["server"];
  }
}
globalThis.foundry = { documents: { collections: { CompendiumCollection } } };

const { installCompendiumEmptyLoadPatch, matchesNothing } = await import("../scripts/lib/patches/compendium-empty-load.mjs");
installCompendiumEmptyLoadPatch();
const pack = new CompendiumCollection();

await ok("an empty id list resolves to no documents and never reaches the server", async () => {
  calls.length = 0;
  assert.deepEqual(await pack.getDocuments({ _id__in: [] }), []);
  assert.equal(calls.length, 0);
});

await ok("every other query reaches core once, `this` and the query intact", async () => {
  const queries = [{ _id__in: ["a"] }, {}, { _id: "a" }, { type: "x", _id__in: [] }, { _id__in: [], type: "x" }, { _id__in: "a" }, undefined];
  for (const query of queries) {
    calls.length = 0;
    assert.deepEqual(await pack.getDocuments(query), ["server"]);
    assert.equal(calls.length, 1, JSON.stringify(query));
    assert.equal(calls[0].self, pack);
    assert.deepEqual(calls[0].query, query ?? {});
  }
});

await ok("the test that tells an empty query reads nothing else as one", async () => {
  assert.equal(matchesNothing({ _id__in: [] }), true);
  for (const query of [null, undefined, "x", 3, [], {}, { _id__in: ["a"] }, { _id__in: [], type: "x" }]) assert.equal(matchesNothing(query), false, JSON.stringify(query));
});

console.log(`\n${passed} passed`);
