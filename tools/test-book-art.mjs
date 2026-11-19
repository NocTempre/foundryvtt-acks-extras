/**
 * The book-art reader (scripts/lib/book-art.mjs): the lookup order of each
 * side, the kind-null rule on every step that is not the kind step, band 0
 * against null, the index rebuilt on a registry change, and the row check.
 * Every path, cite, pool and kind here is invented.
 */
import assert from "node:assert/strict";
import { PRIORITY, registerTable, resetTables, unregisterTable } from "../scripts/lib/tables.mjs";
import { ART_SIDES, BOOK_ART_DOC, artRowProblems, treasureArt } from "../scripts/lib/book-art.mjs";

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

/** Register `tables` as the WORLD layer of the art document (notifies, so the index drops). */
const load = (tables, priority = PRIORITY.WORLD) => registerTable({ id: BOOK_ART_DOC, source: { pages: "ZZ p.1" }, cites: {}, tables }, { priority, source: "test" });

const row = (side, pool, band, kind, src, extra = {}) => ({ side, pool, band, kind, src, cite: "ZZ p.1", ...extra });
const back = (pool, band, src, kind = null) => row("back", pool, band, kind, src);
const face = (pool, band, kind, src) => row("face", pool, band, kind, src);
const tex = (kind, band, src, extra) => row("texture", null, band, kind, src, extra);
const srcOf = (q) => treasureArt(q)?.src ?? null;

resetTables();

ok("null when the document is absent, or the side unknown", () => {
  assert.equal(treasureArt({ side: "back", pool: "zz.p1" }), null);
  load({ zz: [back("zz.p1", null, "x/a.webp")] });
  assert.equal(treasureArt({ side: "spine", pool: "zz.p1" }), null);
  assert.equal(treasureArt(), null);
  unregisterTable(BOOK_ART_DOC);
  assert.equal(treasureArt({ side: "back", pool: "zz.p1" }), null);
});

ok("ART_SIDES names the three sides", () => {
  assert.deepEqual([...ART_SIDES], ["back", "face", "texture"]);
});

ok("back order: the band, then band null; a null band skips the first step", () => {
  // The band-null row comes first, so first-row-wins alone would pick it.
  load({ zz: [back("zz.p1", null, "x/null.webp"), back("zz.p1", 2, "x/b2.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 2 }), "x/b2.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 1 }), "x/null.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/null.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p2", band: 2 }), null);
});

ok("a back never matches on kind, and reads only back rows", () => {
  load({
    zz: [
      back("zz.p1", 1, "x/kinded.webp", "zz.item1"),
      back("zz.p1", null, "x/kinded-null.webp", "zz.item1"),
      face("zz.p1", 1, null, "x/face.webp"),
      tex("grime", 1, "x/tex.webp"),
      back("zz.p1", null, "x/plain.webp"),
    ],
  });
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 1, kind: "zz.item1" }), "x/plain.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 1 }), "x/plain.webp");
});

ok("a back with only a band-0 row: band 0 finds it, band null does not (A1)", () => {
  load({ zz: [back("zz.p1", 0, "x/b0.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 0 }), "x/b0.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), null);
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 1 }), null);
});

ok("band 0 against null on a back with both rows (A1)", () => {
  load({ zz: [back("zz.p1", null, "x/null.webp"), back("zz.p1", 0, "x/b0.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: 0 }), "x/b0.webp");
  assert.equal(srcOf({ side: "back", pool: "zz.p1", band: null }), "x/null.webp");
});

/** One face table that tells every step apart; wrong rows come first. */
const FACES = [
  face("zz.p1", 3, null, "x/f-b3.webp"),
  face("zz.p1", 1, null, "x/f-b1.webp"),
  face("zz.p1", 2, "zz.item2", "x/f-item2.webp"),
  face("zz.p9", 0, "Grimé", "x/f-grime.webp"),
  face("zz.p1", 2, null, "x/f-b2.webp"),
];

ok("face step 1: the folded kind at any pool and band", () => {
  load({ zz: FACES });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 2, kind: "zz.item2" }), "x/f-item2.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 3, kind: "GRIME" }), "x/f-grime.webp", "case and accents fold, pool and band ignored");
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 3, kind: "grimé" }), "x/f-grime.webp");
});

ok("face step 2 before 3 and 4: the pool at the band, kind-null only", () => {
  load({ zz: FACES });
  // The kind-keyed row at the same pool and band comes before the generic one.
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 2, kind: "zz.item7" }), "x/f-b2.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 2 }), "x/f-b2.webp");
});

ok("face step 4: the pool at its lowest band, kind-null only", () => {
  load({ zz: FACES });
  // No band-0 or band-null generic row in zz.p1; the band-0 row of zz.p9 is kind-keyed.
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 0 }), "x/f-b1.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p1" }), "x/f-b1.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p9" }), null, "a kind-keyed row never answers the pool step");
});

ok("face step 3 before 4: band null wins over a lower integer band", () => {
  load({ zz: [face("zz.p1", 1, null, "x/f-b1.webp"), face("zz.p1", null, null, "x/f-null.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 3 }), "x/f-null.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p1" }), "x/f-null.webp");
});

ok("face band 0 against null (A1)", () => {
  load({ zz: [face("zz.p1", null, null, "x/f-null.webp"), face("zz.p1", 0, null, "x/f-b0.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 0 }), "x/f-b0.webp");
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: null }), "x/f-null.webp");
});

ok("a face kind miss never returns another kind's row (A2)", () => {
  load({ zz: [face("zz.p1", 1, "zz.item1", "x/f-item1.webp"), face("zz.p1", null, "zz.item1", "x/f-item1n.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1, kind: "zz.item2" }), null);
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1 }), null);
});

ok("a masked face passes no kind and never reaches a kind-keyed row (A4)", () => {
  load({ zz: [face("zz.p1", 1, "zz.item1", "x/true-face.webp"), face("zz.p1", null, null, "x/generic.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1 }), "x/generic.webp");
  load({ zz: [face("zz.p1", 1, "zz.item1", "x/true-face.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1 }), null);
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1, kind: "" }), null, "an empty kind is no kind");
});

ok("a face reads only face rows", () => {
  load({ zz: [back("zz.p1", 1, "x/back.webp"), tex("zz.item1", 1, "x/tex.webp")] });
  assert.equal(srcOf({ side: "face", pool: "zz.p1", band: 1, kind: "zz.item1" }), null);
});

ok("texture order: the folded kind at the band, then at band null", () => {
  load({ zz: [tex("grime", null, "x/t-null.webp"), tex("grime", 2, "x/t-b2.webp"), tex("grime", 0, "x/t-b0.webp")] });
  assert.equal(srcOf({ side: "texture", kind: "grime", band: 2 }), "x/t-b2.webp");
  assert.equal(srcOf({ side: "texture", kind: "Grimé", band: 2 }), "x/t-b2.webp");
  assert.equal(srcOf({ side: "texture", kind: "grime", band: 0 }), "x/t-b0.webp", "band 0 is a band");
  assert.equal(srcOf({ side: "texture", kind: "grime", band: 3 }), "x/t-null.webp");
  assert.equal(srcOf({ side: "texture", kind: "grime" }), "x/t-null.webp");
});

ok("a texture with only a band-0 row: band null does not find it", () => {
  load({ zz: [tex("grime", 0, "x/t-b0.webp")] });
  assert.equal(srcOf({ side: "texture", kind: "grime" }), null);
  assert.equal(srcOf({ side: "texture", kind: "grime", band: 1 }), null);
});

ok("a texture never answers with another kind's row, nor a back or face row", () => {
  load({
    zz: [
      tex("foil", 1, "x/t-foil.webp"),
      tex("foil", null, "x/t-foiln.webp"),
      back("grime", 1, "x/back.webp"),
      face("grime", 1, "grime", "x/face.webp"),
      face("grime", null, null, "x/face-generic.webp"),
    ],
  });
  assert.equal(srcOf({ side: "texture", kind: "grime", band: 1 }), null);
  assert.equal(srcOf({ side: "texture", kind: "grime" }), null);
  assert.equal(srcOf({ side: "texture", band: 1 }), null, "no kind, no texture");
  assert.equal(srcOf({ side: "texture", kind: "foil", band: 1 }), "x/t-foil.webp");
});

ok("the answer is {src, cite}, with licence passed through when the row has one", () => {
  load({ zz: [tex("vignette", null, "x/t-v.webp", { licence: "ZZ-OPEN-1" }), back("zz.p1", null, "x/a.webp")] });
  assert.deepEqual(treasureArt({ side: "texture", kind: "vignette" }), { src: "x/t-v.webp", cite: "ZZ p.1", licence: "ZZ-OPEN-1" });
  assert.deepEqual(treasureArt({ side: "back", pool: "zz.p1" }), { src: "x/a.webp", cite: "ZZ p.1" });
});

ok("books in sorted key order, rows in order, the first row wins", () => {
  load({ zz: [back("zz.p1", null, "x/zz.webp")], aa: [back("zz.p1", null, "x/aa1.webp"), back("zz.p1", null, "x/aa2.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/aa1.webp");
});

ok("the index rebuilds after registerTable or unregisterTable with no other call", () => {
  load({ zz: [back("zz.p1", null, "x/world.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/world.webp");
  load({ zz: [back("zz.p1", null, "x/override.webp")] }, PRIORITY.OVERRIDE);
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/override.webp");
  unregisterTable(BOOK_ART_DOC, { priority: PRIORITY.OVERRIDE });
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/world.webp");
  load({ zz: [back("zz.p1", null, "x/reimport.webp")] });
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), "x/reimport.webp");
  unregisterTable(BOOK_ART_DOC);
  assert.equal(srcOf({ side: "back", pool: "zz.p1" }), null);
});

ok("artRowProblems: sound rows of each side", () => {
  assert.deepEqual(artRowProblems(back("zz.p1", 0, "x/a.webp")), []);
  assert.deepEqual(artRowProblems(face("zz.p1", null, "zz.item1", "x/a.webp")), []);
  assert.deepEqual(artRowProblems(tex("grime", 3, "x/a.webp", { licence: "ZZ-OPEN-1" })), []);
  assert.deepEqual(artRowProblems({ ...back("zz.p1", null, "x/a.webp"), cite: null }), []);
});

ok("artRowProblems: back and face rules", () => {
  const has = (r, word) => assert.ok(artRowProblems(r).some((p) => p.includes(word)), `${JSON.stringify(r)} → ${word}`);
  has(null, "object");
  has(row("spine", "zz.p1", null, null, "x/a.webp"), "side");
  has(back("", null, "x/a.webp"), "pool");
  has(face(null, null, "zz.item1", "x/a.webp"), "pool");
  has(back("zz.p1", -1, "x/a.webp"), "band");
  has(back("zz.p1", 1.5, "x/a.webp"), "band");
  has(back("zz.p1", "1", "x/a.webp"), "band");
  has(face("zz.p1", null, "", "x/a.webp"), "kind");
  has(back("zz.p1", null, "x/a.webp", "zz.item1"), "a back has kind null");
  has(back("zz.p1", null, ""), "src");
  has({ ...back("zz.p1", null, "x/a.webp"), cite: 7 }, "cite");
  has({ ...back("zz.p1", null, "x/a.webp"), licence: 7 }, "licence");
});

ok("artRowProblems: a texture needs a kind and has pool null", () => {
  const has = (r, word) => assert.ok(artRowProblems(r).some((p) => p.includes(word)), `${JSON.stringify(r)} → ${word}`);
  has(tex(null, null, "x/a.webp"), "a texture needs a kind");
  has(tex("", null, "x/a.webp"), "a texture needs a kind");
  has({ ...tex("grime", null, "x/a.webp"), pool: "zz.p1" }, "a texture has pool null");
  has(tex("grime", -1, "x/a.webp"), "band");
});

resetTables();
console.log(`\ntest-book-art: all ${passed} checks passed`);
