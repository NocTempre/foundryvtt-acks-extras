/**
 * The reach glyph's decisions (`reach-glyph-logic.mjs`) and the strip's line
 * (`reachLineOf`), offline: which reaches a token shows to a Gamemaster, to a
 * Player and to an Observer, a visibility core adds later failing closed, the
 * collapse to the nearest engaged bearer after the visibility filter and not
 * before it, the glyph's slot and key, and the changes that rework a scene.
 * Foundry-free with stand-ins; every name and figure below is invented.
 *
 * Usage: node tools/test-reach-glyph.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.foundry = {
  utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj), randomID: () => "rid", escapeHTML: (text) => String(text) },
  applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } } },
};
globalThis.game = { i18n: { format: (key, data = {}) => `${key}${Object.keys(data).length ? JSON.stringify(data) : ""}`, localize: (key) => key }, users: [], user: { isGM: false } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
const V = { LAYER_UNLOCKED: 4, LAYER: 0, GAMEMASTER: 1, OBSERVER: 3, ALWAYS: 2 };
globalThis.CONST = { REGION_VISIBILITY: V, TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 }, TOKEN_DISPLAY_MODES: {} };

const logic = await import("../scripts/lib/reach-glyph-logic.mjs");
const strip = await import("../scripts/lib/item-run-strip.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

/** A `behaviorsUnder` pair on a Region of the given visibility. */
const pair = (id, visibility) => ({ region: { id, visibility }, behavior: { id: `b-${id}` } });
const ids = (found) => found.map((p) => p.region.id);
const everyone = pair("r-all", V.ALWAYS);
const judge = pair("r-gm", V.GAMEMASTER);
const layer = pair("r-layer", V.LAYER);
const unlocked = pair("r-unlocked", V.LAYER_UNLOCKED);
const observers = pair("r-obs", V.OBSERVER);
const all = [everyone, judge, layer, unlocked, observers];

await t("a Gamemaster seat is shown every reach, in order", () => {
  assert.deepEqual(ids(logic.shownReaches(all, { isGM: true }, V)), ["r-all", "r-gm", "r-layer", "r-unlocked", "r-obs"]);
});

await t("a Player seat is shown the Region visible to anyone and no Judge-only or layer-only one", () => {
  assert.deepEqual(ids(logic.shownReaches(all, { isGM: false }, V)), ["r-all"]);
  assert.deepEqual(ids(logic.shownReaches([judge], { isGM: false }, V)), []);
  assert.deepEqual(ids(logic.shownReaches([layer, unlocked], { isGM: false }, V)), []);
});

await t("an Observer-visible Region is shown to a seat that observes it, and to no other", () => {
  const seatSeeing = { isGM: false, observes: (region) => region.id === "r-obs" };
  assert.deepEqual(ids(logic.shownReaches([observers, everyone], seatSeeing, V)), ["r-obs", "r-all"]);
  assert.deepEqual(ids(logic.shownReaches([observers], { isGM: false, observes: () => false }, V)), []);
  assert.deepEqual(ids(logic.shownReaches([observers], { isGM: false }, V)), [], "no observes test answers no");
});

await t("a visibility core adds later, a missing one and a non-list fail closed for a Player", () => {
  assert.deepEqual(ids(logic.shownReaches([pair("r-new", 9), pair("r-none", undefined), pair("r-str", "2")], { isGM: false }, V)), []);
  assert.deepEqual(logic.shownReaches(undefined, { isGM: false }, V), []);
  assert.deepEqual(logic.shownReaches([], { isGM: true }, V), []);
  assert.deepEqual(logic.shownReaches([{ behavior: {} }], { isGM: false }, V), [], "a pair with no Region is never shown");
});

await t("the answer is a copy: a Gamemaster's list is not the caller's list", () => {
  const found = [everyone];
  assert.notEqual(logic.shownReaches(found, { isGM: true }, V), found);
});

await t("the filter runs before the collapse: a Judge-only nearest bearer neither hides a farther visible one from a Player nor leaks its row", () => {
  // The strip collapses engaged rows to the nearest bearer's. `reachRowsOn` hands its filter the pairs first.
  const near = { ...pair("r-near", V.GAMEMASTER), feet: 5 };
  const far = { ...pair("r-far", V.ALWAYS), feet: 30 };
  const nearestOf = (pairs) => pairs.reduce((best, p) => (best === null || p.feet < best.feet ? p : best), null)?.region.id ?? null;
  assert.equal(nearestOf(logic.shownReaches([near, far], { isGM: false }, V)), "r-far", "a Player's nearest is the farther, visible bearer");
  assert.equal(nearestOf(logic.shownReaches([near, far], { isGM: true }, V)), "r-near", "a Gamemaster's is the nearer");
  assert.equal(nearestOf(logic.shownReaches([near], { isGM: false }, V)), null, "with only the Judge-only reach there is nothing to collapse to, so no glyph");
});

await t("reachRowsOn hands the seat's filter the pairs the token stands in before any row is read", async () => {
  const constants = await import("../scripts/lib/constants.mjs");
  const region = { id: "r1", hidden: false, visibility: V.GAMEMASTER, behaviors: [{ type: constants.AURA_BEHAVIOR_TYPE, disabled: false, system: {} }, { type: "other", disabled: false }] };
  const token = { id: "t1", regions: new Set([region]), parent: { regions: [region] } };
  let seen = null;
  const rows = strip.reachRowsOn(token, { id: "a" }, (found) => {
    seen = found;
    return logic.shownReaches(found, { isGM: false }, V);
  });
  assert.deepEqual(seen.map((p) => p.region.id), ["r1"], "only the aura behavior of the Region the token stands in");
  assert.deepEqual(rows, [], "a Judge-only reach is never read for a Player seat");
});

await t("the glyph sits mid-height on the right edge, at the size of core's effect icons, scaled by the interface", () => {
  assert.deepEqual(logic.glyphSlot({ w: 100, h: 100, ui: 1 }), { x: 80, y: 40, size: 20 });
  assert.deepEqual(logic.glyphSlot({ w: 200, h: 100, ui: 2 }), { x: 160, y: 30, size: 40 });
  assert.equal(logic.glyphSlot({ w: 100, h: 100, ui: 0 }).size, 20, "an unset scale reads as 1");
});

await t("the key changes with the size, the scale and the reaches, and not with their order", () => {
  const base = { w: 100, h: 100, ui: 1, reachKeys: ["a:1", "b:2"] };
  assert.equal(logic.glyphKey(base), logic.glyphKey({ ...base, reachKeys: ["b:2", "a:1"] }));
  assert.notEqual(logic.glyphKey(base), logic.glyphKey({ ...base, w: 200 }));
  assert.notEqual(logic.glyphKey(base), logic.glyphKey({ ...base, ui: 2 }));
  assert.notEqual(logic.glyphKey(base), logic.glyphKey({ ...base, reachKeys: ["a:1"] }));
});

await t("a token write reworks the scene for a move, a resize, hiding, elevation and a change of Regions, and for nothing else", () => {
  for (const key of ["x", "y", "width", "height", "elevation", "hidden", "_regions"]) assert.equal(logic.changesMembership({ [key]: 1 }), true, key);
  assert.equal(logic.changesMembership({ name: "x" }), false);
  assert.equal(logic.changesMembership({ flags: {} }), false);
  assert.equal(logic.changesMembership(undefined), false);
});

await t("the glyph's name and icon are the named child and core's own path", () => {
  assert.equal(logic.REACH_GLYPH_NAME, "acks-extras-reach-glyph");
  assert.equal(logic.GLYPH_ICON, "icons/svg/aura.svg");
});

await t("a reach's line names the item, the source with its distance, the reach and the page, and drops a blank radius but keeps the page", () => {
  const row = { name: "Item", tag: "always", left: null, source: "Source", feet: 10, radius: 30, cite: "Cite 1", part: { rolls: "rolls", value: "+1" } };
  assert.equal(strip.reachLineOf(row), "Item · Source, 10′ ACKS-LIB.itemRun.strip.away · ACKS-LIB.itemRun.strip.reach 30′ · Cite 1 · rolls +1");
  assert.equal(strip.reachLineOf({ ...row, radius: null, feet: null, part: null }), "Item · Source · Cite 1");
});

await t("a line carries the state and the turns left only where the seat is shown them", () => {
  const row = { name: "Item", tag: "immune", left: 3, source: "Source", feet: null, radius: null, cite: "", part: null };
  assert.equal(strip.reachLineOf(row), "Item · Source");
  assert.equal(strip.reachLineOf(row, { withTag: true }), 'Item (ACKS-LIB.itemRun.strip.tag.immune · ACKS-LIB.itemRun.strip.left{"turns":3}) · Source');
  assert.equal(strip.reachLineOf({ ...row, tag: "waiting", left: undefined }, { withTag: true }), "Item (ACKS-LIB.itemRun.strip.tag.waiting) · Source");
});

console.log(`\n${passed} passed`);
