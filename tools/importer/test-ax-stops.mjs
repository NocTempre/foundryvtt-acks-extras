/**
 * Where an AX entry's flow ends (`axStopLine`, `compile-cookbook.mjs`): at the
 * next heading-size line, or, where `stopFace` is selected, only at one set in
 * the entry's own heading face or in type larger than body. Every page here is
 * built from invented runs: no PDF, no Foundry.
 *
 * Usage: node tools/importer/test-ax-stops.mjs
 */
import assert from "node:assert/strict";
import { axStopLine } from "./compile-cookbook.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const run = (str, y, alias, h = 10, x = 50) => ({ str, x, y, w: 80, h, alias });
const HEAD = "face-head";
const OTHER = "face-other";
const face = new Set([HEAD]);
const cols = [45];

/** A page: a lore line in another face, then a heading in the anchor's face, with a larger line optionally between. */
const page = ({ bands, large = false } = {}) => ({
  width: 612,
  height: 792,
  ...(bands ? { axBands: bands } : {}),
  items: [
    run("anchor", 100, HEAD),
    run("lore", 300, OTHER),
    ...(large ? [run("section", 340, OTHER, 14)] : []),
    run("sibling", 400, HEAD),
  ],
});
const BAND = { headMinH: 9.5, stopFace: "anchor" };
const ys = (l) => l?.y;
const stop = (pd, opts = {}) => axStopLine(pd, { cols, col: 0, fromY: 110, face, ...opts });

t("selected, a body-size line in another face is passed and the anchor's face stops", () => {
  assert.equal(ys(stop(page({ bands: BAND }))), 400);
});

t("selected, a line in the anchor's own face stops", () => {
  const pd = { ...page({ bands: BAND }), items: [run("anchor", 100, HEAD), run("next", 250, HEAD), run("lore", 300, OTHER)] };
  assert.equal(ys(stop(pd)), 250);
});

t("selected, a line above the body ceiling stops in any face", () => {
  assert.equal(ys(stop(page({ bands: BAND, large: true }))), 340);
});

t("with no option the other-face line stops, as it always did", () => {
  assert.equal(ys(stop(page({ bands: { headMinH: 9.5 } }))), 300);
  assert.equal(ys(stop(page({ bands: { headMinH: 9.5 } }), { face: undefined })), 300, "no face is asked of an unselected flow");
});

t("a row's own headingLines.stopFace selects it with no band", () => {
  const pd = page({ bands: { headMinH: 9.5 } });
  assert.equal(ys(stop(pd, { geom: { stopFace: "anchor" } })), 400);
  assert.equal(ys(stop(page(), { geom: { minH: 9.5, stopFace: "anchor" } })), 400);
});

t("selected with no face, it throws rather than fall back to the size stop", () => {
  assert.throws(() => stop(page({ bands: BAND }), { face: undefined }), /no anchor face/);
  assert.throws(() => stop(page({ bands: BAND }), { face: new Set() }), /no anchor face/);
  assert.throws(() => stop(page(), { geom: { minH: 9.5, stopFace: "anchor" }, face: undefined }), /no anchor face/);
});

t("an unknown value throws", () => {
  assert.throws(() => stop(page({ bands: BAND }), { geom: { stopFace: "size" } }), /unknown stopFace/);
  assert.throws(() => stop(page({ bands: { headMinH: 9.5, stopFace: "alias" } })), /unknown stopFace/);
});

t("a stop above the flow's start, or in another column, is not the flow's", () => {
  const pd = { ...page({ bands: BAND }), items: [run("early", 90, HEAD), run("beside", 250, HEAD, 10, 330), run("sibling", 400, HEAD)] };
  assert.equal(ys(stop(pd, { cols: [45, 320] })), 400);
  assert.equal(ys(stop(pd, { cols: [45, 320], col: 1 })), 250);
});

console.log(`\nax-stops: ${n} checks OK`);
