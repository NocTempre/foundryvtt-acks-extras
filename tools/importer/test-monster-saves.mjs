/**
 * `savesForLevel` reads the `acks` system's monster saves grid
 * (`CONFIG.ACKS.monster_saves`) when asked and returns it under this module's
 * five save keys. The grid here is invented, in the system's own shape: a
 * label and one-letter save keys, keyed by the lowest level of each band. No
 * book figure appears.
 */
import assert from "node:assert/strict";
import { savesForLevel } from "../../scripts/importer/stats.mjs";

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

ok("with no system grid the row is empty, so no figure is written", () => {
  delete globalThis.CONFIG;
  assert.deepEqual(savesForLevel(3), {});
  globalThis.CONFIG = { ACKS: {} };
  assert.deepEqual(savesForLevel(3), {});
});

globalThis.CONFIG = {
  ACKS: {
    monster_saves: {
      0: { label: "low", d: 51, w: 52, p: 53, b: 54, s: 55 },
      3: { label: "mid", d: 41, w: 42, p: 43, b: 44, s: 45 },
      9: { label: "high", d: 31, w: 32, p: 33, b: 34, s: 35 },
    },
  },
};

ok("the one-letter keys map onto the five save keys", () => {
  assert.deepEqual(savesForLevel(0), { paralysis: 53, death: 51, blast: 54, implements: 52, spell: 55 });
});

ok("a level takes the band it falls in, and a band's own level is its row", () => {
  assert.equal(savesForLevel(2).death, 51);
  assert.equal(savesForLevel(3).death, 41);
  assert.equal(savesForLevel(8).death, 41);
  assert.equal(savesForLevel(9).death, 31);
  assert.equal(savesForLevel(40).death, 31);
});

ok("a level below the lowest band takes the lowest row", () => {
  assert.equal(savesForLevel(-1).death, 51);
});

ok("the row lists the five keys in a fixed order and carries no label", () => {
  assert.deepEqual(Object.keys(savesForLevel(4)), ["paralysis", "death", "blast", "implements", "spell"]);
});

ok("the grid is read at each call, so a changed grid answers at once", () => {
  globalThis.CONFIG.ACKS.monster_saves[3].d = 77;
  assert.equal(savesForLevel(4).death, 77);
});

ok("a band row missing a save leaves that key out rather than inventing one", () => {
  globalThis.CONFIG.ACKS.monster_saves[9] = { label: "partial", d: 31, p: 33 };
  assert.deepEqual(savesForLevel(10), { paralysis: 33, death: 31 });
});

console.log(`\n${passed} passed`);
