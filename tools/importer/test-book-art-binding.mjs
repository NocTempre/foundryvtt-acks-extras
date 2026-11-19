/**
 * The book-art binding (scripts/importer/book-art-binding.mjs): the recipe lint,
 * one fetch per picture, the registry rows and their cites, the WORLD document
 * with one book's table replaced, and the producer map. Every recipe, path,
 * pool, kind and entry here is invented; the cites use a registered book id
 * only so that a folio can differ from its PDF page. The last cases lint the
 * real manifest's recipes against the committed cookbooks and the treasure
 * feature's pools and band count (shapes and ids only, no PDF).
 * `placementAt` is the finder's and is tested with it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCES, booksWithArt, bookArtClaim, bookOfArtClaim, bookArtProblems, planBookArt, bookArtRows, bookArtDoc, refusedArtRows,
  CROP_LIMITS, cropProblems, isCropRow,
} from "../../scripts/importer/book-art-binding.mjs";
import { BOOK_ART_DOC, artRowProblems } from "../../scripts/lib/book-art.mjs";
import { citeFor, BOOKS } from "../../scripts/importer/books.mjs";
import { BOOK_CODE } from "../../scripts/importer/books/index.mjs";
import { POOL, BAND_COUNT } from "../../scripts/treasure/constants.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

const POOLS = ["zp", "zq"];
const COOKBOOK = { entries: { "zz.e1": { kind: "kind.magicItem" }, "zz.e2": { kind: "kind.magicItem" }, "zz.e3": { kind: "kind.monster" } } };
const LINT = { cookbook: COOKBOOK, pools: POOLS, bandCount: 4 };
const pic = (n, uses, extra = {}) => ({ n, page: 30 + n, box: { x: 10, y: 20, w: 100, h: 80 }, size: { w: 200, h: 160 }, uses, ...extra });
const crop = (n, uses, box = { x0: 10, y0: 20, x1: 300, y1: 400 }, extra = {}) => ({ n, page: 40, crop: box, uses, ...extra });
const problems = (rows) => bookArtProblems(rows, LINT);
const refuses = (rows, word) => {
  const got = problems(rows);
  assert.ok(got.some((p) => p.includes(word)), `${JSON.stringify(rows)} → "${word}" in ${JSON.stringify(got)}`);
};

/** A registered book whose printed folio differs from its PDF page, so a cite built from the raw page fails. */
const CITED = Object.keys(BOOKS).find((id) => citeFor(id, 50) !== `${BOOKS[id].short} p.50` && /^[A-Z0-9]+$/.test(BOOKS[id].short ?? ""));

/* --- the lint, on invented recipes --- */

ok("a sound recipe has no problems: backs, faces with and without an entry, textures, band 0", () => {
  assert.deepEqual(problems([
    pic(1, [{ side: "back", pool: "zp" }, { side: "back", pool: "zq", band: 0 }]),
    pic(2, [{ side: "face", pool: "zp", entry: "zz.e1" }, { side: "face", pool: "zp", band: 3 }]),
    pic(3, [{ side: "texture", kind: "zgrain" }, { side: "texture", kind: "zgrain", band: 0, licence: "Z licence" }]),
  ]), []);
});

ok("refuses a back with an entry", () => refuses([pic(1, [{ side: "back", pool: "zp", entry: "zz.e1" }])], "a back has no entry"));
ok("refuses a back or a face with a kind of its own", () => {
  refuses([pic(1, [{ side: "back", pool: "zp", kind: "zk" }])], "never kind");
  refuses([pic(1, [{ side: "face", pool: "zp", kind: "zk" }])], "never kind");
});
ok("refuses an unknown pool, and a back or a face with none", () => {
  refuses([pic(1, [{ side: "back", pool: "zx" }])], "unknown pool");
  refuses([pic(1, [{ side: "face", entry: "zz.e1" }])], "unknown pool");
});
ok("refuses an unknown side", () => refuses([pic(1, [{ side: "spine", pool: "zp" }])], "side must be one of"));
ok("refuses a band outside 0 to bandCount-1, and a band that is no integer", () => {
  refuses([pic(1, [{ side: "back", pool: "zp", band: 4 }])], "band");
  refuses([pic(1, [{ side: "back", pool: "zp", band: -1 }])], "band");
  refuses([pic(1, [{ side: "back", pool: "zp", band: 1.5 }])], "band");
  refuses([pic(1, [{ side: "texture", kind: "zgrain", band: 4 }])], "band");
  assert.deepEqual(bookArtProblems([pic(1, [{ side: "back", pool: "zp", band: 5 }])], { ...LINT, bandCount: 6 }), []);
});
ok("refuses two uses with the same lookup key, in one picture or across two", () => {
  refuses([pic(1, [{ side: "back", pool: "zp" }]), pic(2, [{ side: "back", pool: "zp" }])], "same lookup key as art1");
  refuses([pic(1, [{ side: "face", pool: "zp", entry: "zz.e1" }, { side: "face", pool: "zp", entry: "zz.e1" }])], "same lookup key");
  refuses([pic(1, [{ side: "texture", kind: "zgrain", band: 2 }]), pic(2, [{ side: "texture", kind: "zgrain", band: 2 }])], "same lookup key");
  // Band 0 and band null are two keys, as are two kinds, two sides and two pools.
  assert.deepEqual(problems([
    pic(1, [{ side: "back", pool: "zp", band: 0 }, { side: "back", pool: "zp" }, { side: "face", pool: "zp" }, { side: "back", pool: "zq" }]),
    pic(2, [{ side: "texture", kind: "zgrain" }, { side: "texture", kind: "zfoil" }]),
  ]), []);
});
ok("refuses a repeated ordinal", () => refuses([pic(1, [{ side: "back", pool: "zp" }]), pic(1, [{ side: "back", pool: "zq" }])], "art1: the ordinal is used twice"));
ok("refuses a face's entry missing from the cookbook, or no magic item", () => {
  refuses([pic(1, [{ side: "face", pool: "zp", entry: "zz.e9" }])], "not in the cookbook");
  refuses([pic(1, [{ side: "face", pool: "zp", entry: "zz.e3" }])], "not a magic item");
});
ok("refuses a texture with a pool, with an entry, or without a kind", () => {
  refuses([pic(1, [{ side: "texture", kind: "zgrain", pool: "zp" }])], "a texture has no pool");
  refuses([pic(1, [{ side: "texture", kind: "zgrain", entry: "zz.e1" }])], "a texture has no entry");
  refuses([pic(1, [{ side: "texture" }])], "a texture needs a kind");
  refuses([pic(1, [{ side: "texture", kind: "" }])], "a texture needs a kind");
});
ok("refuses a malformed row: ordinal, page, box, size, uses", () => {
  refuses([pic(0, [{ side: "back", pool: "zp" }])], "n must be");
  refuses([pic(1, [{ side: "back", pool: "zp" }], { page: 0 })], "page");
  refuses([pic(1, [{ side: "back", pool: "zp" }], { box: { x: 1, y: 2, w: 3 } })], "box");
  refuses([pic(1, [{ side: "back", pool: "zp" }], { size: { w: 2.5, h: 3 } })], "size");
  refuses([pic(1, [])], "uses must be");
  assert.deepEqual(bookArtProblems("zz"), ["the recipe is not an array"]);
});
ok("the lint's messages name ordinals, never a field value", () => {
  const got = problems([pic(7, [{ side: "face", pool: "zsecret", entry: "zz.hidden" }])]);
  assert.ok(got.length && got.every((p) => p.startsWith("art7: ") && !p.includes("zsecret") && !p.includes("zz.hidden")));
});

/* --- the crop shape --- */

ok("a crop row with texture uses is sound beside picture rows, and is told apart by its crop", () => {
  assert.deepEqual(problems([
    pic(1, [{ side: "back", pool: "zp" }]),
    crop(1001, [{ side: "texture", kind: "zgrain" }, { side: "texture", kind: "zfoil", band: 3 }]),
  ]), []);
  assert.equal(isCropRow(crop(1001, [])), true);
  assert.equal(isCropRow(pic(1, [])), false);
});
ok("refuses a row with both shapes: a crop beside a box or a size", () => {
  refuses([crop(1001, [{ side: "texture", kind: "zgrain" }], undefined, { box: { x: 1, y: 2, w: 3, h: 4 } })], "not both");
  refuses([crop(1001, [{ side: "texture", kind: "zgrain" }], undefined, { size: { w: 3, h: 4 } })], "not both");
});
ok("refuses a row with neither shape", () => {
  const got = problems([{ n: 1, page: 3, uses: [{ side: "back", pool: "zp" }] }]);
  assert.ok(got.some((p) => p.includes("box needs")) && got.some((p) => p.includes("size needs")), JSON.stringify(got));
});
ok("refuses a crop whose uses are not all textures", () => {
  refuses([crop(1001, [{ side: "back", pool: "zp" }])], "a crop's uses are textures only");
  refuses([crop(1001, [{ side: "texture", kind: "zgrain" }, { side: "face", pool: "zp", entry: "zz.e1" }])], "textures only");
});
ok("refuses a crop outside the page, below the stamp line, inverted, or not numeric", () => {
  const tex = [{ side: "texture", kind: "zgrain" }];
  refuses([crop(1001, tex, { x0: -1, y0: 20, x1: 300, y1: 400 })], "inside the page");
  refuses([crop(1001, tex, { x0: 10, y0: 20, x1: CROP_LIMITS.pageW + 1, y1: 400 })], "inside the page");
  refuses([crop(1001, tex, { x0: 10, y0: 20, x1: 300, y1: CROP_LIMITS.stampLine + 1 })], "stamp line");
  refuses([crop(1001, tex, { x0: 300, y0: 20, x1: 10, y1: 400 })], "x1 > x0");
  refuses([crop(1001, tex, { x0: 10, y0: 20, x1: 300 })], "crop needs numbers");
  // The stamp line itself is the last row a crop may reach.
  assert.deepEqual(problems([crop(1001, tex, { x0: 0, y0: 0, x1: CROP_LIMITS.pageW, y1: CROP_LIMITS.stampLine })]), []);
});
ok("cropProblems takes the page and stamp line it is given, and names no number", () => {
  const box = { x0: 0, y0: 0, x1: 700, y1: 900 };
  assert.deepEqual(cropProblems(box, { pageW: 720, pageH: 1000, stampLine: 950 }), []);
  const got = cropProblems(box);
  assert.ok(got.length === 2 && got.every((p) => !/\d/.test(p)), JSON.stringify(got));
  assert.deepEqual(bookArtProblems([crop(1001, [{ side: "texture", kind: "zgrain" }], box)], { ...LINT, limits: { pageW: 720, pageH: 1000, stampLine: 950 } }), []);
});

/* --- one fetch per picture, rows and cites --- */

ok("planBookArt: a picture with two uses is fetched once, under its stem", () => {
  const plan = planBookArt("zz", [pic(7, [{ side: "back", pool: "zp" }, { side: "face", pool: "zp", entry: "zz.e1" }]), pic(8, [{ side: "back", pool: "zq" }])]);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((p) => [p.n, p.id, p.stem, p.uses.length]), [[7, "zz.art7", "zz-art7-200x160", 2], [8, "zz.art8", "zz-art8-200x160", 1]]);
  assert.deepEqual(plan[0].box, { x: 10, y: 20, w: 100, h: 80 });
  assert.equal(plan[0].page, 37);
  assert.deepEqual(planBookArt("zz", undefined), []);
});

ok("planBookArt: a crop is carried through with its region, no box or size, under a stem of its page and region", () => {
  const plan = planBookArt("zz", [crop(1001, [{ side: "texture", kind: "zgrain" }], { x0: 10, y0: 20.5, x1: 300, y1: 400 })]);
  assert.deepEqual(plan, [{
    n: 1001, id: "zz.art1001", page: 40, stem: "zz-art1001-p40-10-20p5-300-400",
    crop: { x0: 10, y0: 20.5, x1: 300, y1: 400 }, uses: [{ side: "texture", kind: "zgrain" }],
  }]);
  const rows = bookArtRows("zz", plan, new Map([[1001, { path: "x/zz-art1001.webp" }]]));
  assert.deepEqual(rows.map(({ cite, ...r }) => r), [{ side: "texture", pool: null, band: null, kind: "zgrain", src: "x/zz-art1001.webp" }]);
  assert.notEqual(planBookArt("zz", [crop(1001, [], { x0: 10, y0: 21, x1: 300, y1: 400 })])[0].stem, plan[0].stem, "a moved region makes a new file");
});

ok("bookArtRows: every use of a picture that came back is a row; a picture that did not adds none", () => {
  const plan = planBookArt("zz", [
    pic(1, [{ side: "back", pool: "zp", band: 0 }, { side: "face", pool: "zq", entry: "zz.e1", band: 2 }]),
    pic(2, [{ side: "back", pool: "zq" }]),
    pic(3, [{ side: "texture", kind: "zgrain", licence: "Z licence" }, { side: "texture", kind: "zfoil", band: 1 }]),
  ]);
  const results = new Map([[1, { path: "x/zz-art1.webp", cached: false }], [2, null], [3, { path: "x/zz-art3.webp", cached: true }]]);
  const rows = bookArtRows("zz", plan, results);
  assert.deepEqual(rows.map(({ cite, ...r }) => r), [
    { side: "back", pool: "zp", band: 0, kind: null, src: "x/zz-art1.webp" },
    { side: "face", pool: "zq", band: 2, kind: "zz.e1", src: "x/zz-art1.webp" },
    { side: "texture", pool: null, band: null, kind: "zgrain", src: "x/zz-art3.webp", licence: "Z licence" },
    { side: "texture", pool: null, band: 1, kind: "zfoil", src: "x/zz-art3.webp" },
  ]);
  assert.equal(rows[0].band, 0, "band 0 stays 0, never null");
  for (const row of rows) assert.deepEqual(artRowProblems(row), [], JSON.stringify(row));
  assert.deepEqual(refusedArtRows(rows), []);
  // A plain object keyed by ordinal serves as well; a result with no path or a reason adds nothing.
  assert.equal(bookArtRows("zz", plan, { 2: { path: "x/b.webp" }, 1: { reason: "timeout" }, 3: { cached: true } }).length, 1);
});

ok("bookArtRows: a face with no entry is a kind-null row, and every row passes lib's check", () => {
  const plan = planBookArt("zz", [pic(1, [{ side: "face", pool: "zp", band: 3 }])]);
  const rows = bookArtRows("zz", plan, new Map([[1, { path: "x/a.webp" }]]));
  assert.equal(rows[0].kind, null);
  assert.deepEqual(artRowProblems(rows[0]), []);
});

ok("bookArtRows: the cite is the picture's printed folio, from its page", () => {
  assert.ok(CITED, "a registered book prints folios offset from its PDF pages");
  const plan = planBookArt(CITED, [pic(20, [{ side: "back", pool: "zp" }])]);
  const [row] = bookArtRows(CITED, plan, new Map([[20, { path: "x/a.webp" }]]));
  assert.equal(plan[0].page, 50);
  assert.equal(row.cite, citeFor(CITED, 50));
  assert.notEqual(row.cite, `${BOOKS[CITED].short} p.50`);
});

ok("refusedArtRows names a row lib's check refuses", () => {
  const got = refusedArtRows([{ side: "back", pool: "zp", band: null, kind: null, src: "x/a.webp", cite: null }, { side: "texture", pool: null, band: null, kind: null, src: "x/b.webp" }]);
  assert.deepEqual(got.map((r) => r.i), [1]);
});

/* --- the WORLD document --- */

const row = (cite, src = "x/a.webp") => ({ side: "back", pool: "zp", band: null, kind: null, src, cite });

ok("bookArtDoc: this book's table replaced, another book's table and cite kept", () => {
  const other = Object.keys(BOOKS).find((id) => id !== CITED && /^[A-Z0-9]+$/.test(BOOKS[id].short ?? ""));
  const oc = citeFor(other, 9);
  const layer = {
    id: BOOK_ART_DOC,
    source: { pages: "stale" },
    cites: { [other]: oc, [CITED]: "stale" },
    tables: { [other]: [row(oc, "x/other.webp")], [CITED]: [row("stale", "x/old.webp")] },
  };
  const frozen = structuredClone(layer);
  const mine = [row(citeFor(CITED, 50)), row(citeFor(CITED, 52))];
  const doc = bookArtDoc(layer, CITED, mine);
  assert.equal(doc.id, BOOK_ART_DOC);
  assert.deepEqual(doc.tables[other], layer.tables[other]);
  assert.equal(doc.cites[other], oc);
  assert.deepEqual(doc.tables[CITED], mine);
  assert.equal(doc.cites[CITED], `${BOOKS[CITED].short} p.${50 - (BOOKS[CITED].printedOffset ?? 0)}, ${52 - (BOOKS[CITED].printedOffset ?? 0)}`);
  assert.ok(doc.source.pages.includes(oc.split(" p.")[0]) && doc.source.pages.includes(BOOKS[CITED].short), doc.source.pages);
  assert.ok(!doc.source.pages.includes("stale"));
  assert.deepEqual(layer, frozen, "the layer read is never mutated");
});

ok("bookArtDoc: a run that resolved nothing returns the layer unchanged; none and nothing stays none", () => {
  const layer = { id: BOOK_ART_DOC, source: { pages: "ZZ p.1" }, cites: {}, tables: { zz: [row("ZZ p.1")] } };
  assert.equal(bookArtDoc(layer, "zz", []), layer);
  assert.equal(bookArtDoc(layer, "zz", undefined), layer);
  assert.equal(bookArtDoc(null, "zz", []), null);
  assert.equal(bookArtDoc(undefined, "zz", []), null);
});

ok("bookArtDoc: the first table makes the document", () => {
  const doc = bookArtDoc(null, CITED, [row(citeFor(CITED, 50))]);
  assert.deepEqual(Object.keys(doc.tables), [CITED]);
  assert.equal(doc.cites[CITED], citeFor(CITED, 50));
  assert.equal(doc.source.pages, citeFor(CITED, 50));
});

/* --- which books have art, and the producer map --- */

ok("booksWithArt reads the manifest: a book declares art with a bookArt array, empty or not", () => {
  const manifest = { za: { bookArt: [] }, zb: { tableRecipes: {} }, zc: { bookArt: [pic(1, [])] }, zd: { bookArt: "no" } };
  assert.deepEqual(booksWithArt(manifest), ["za", "zc"]);
  assert.equal(bookArtClaim("za"), "za.bookArt");
  assert.equal(bookOfArtClaim("zc.bookArt", manifest), "zc");
  assert.equal(bookOfArtClaim("zb.bookArt", manifest), null);
  assert.equal(bookOfArtClaim("za.art1", manifest), null);
  assert.deepEqual(booksWithArt(null), []);
  assert.deepEqual(booksWithArt(undefined), booksWithArt(BOOK_CODE), "no manifest given reads the real one");
});

ok("PRODUCES lists bookArt, one key per manifest book that declares art, naming its recipe file", () => {
  assert.ok(Object.hasOwn(PRODUCES, BOOK_ART_DOC));
  const map = PRODUCES[BOOK_ART_DOC];
  assert.deepEqual(Object.keys(map), booksWithArt(BOOK_CODE));
  for (const [id, file] of Object.entries(map)) {
    assert.equal(file, `books/${id}/book-art.mjs`);
    assert.ok(fs.existsSync(path.join(ROOT, "scripts", "importer", file)), file);
  }
});

/* --- the real manifest, against the committed cookbooks and the treasure feature --- */

ok("the real manifest's recipes pass the lint against the committed cookbook and the treasure pools and bands", () => {
  const pools = Object.values(POOL);
  let linted = 0;
  for (const id of booksWithArt(BOOK_CODE)) {
    const file = path.join(ROOT, "cookbook", `${id}.json`);
    const cookbook = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { entries: {} };
    assert.deepEqual(bookArtProblems(BOOK_CODE[id].bookArt, { cookbook, pools, bandCount: BAND_COUNT }), [], id);
    linted++;
  }
  assert.equal(linted, booksWithArt(BOOK_CODE).length);
  console.log(`     (${linted} manifest book(s) declare art, ${booksWithArt(BOOK_CODE).reduce((n, id) => n + BOOK_CODE[id].bookArt.length, 0)} row(s))`);
});

ok("the lint the real-manifest case runs refuses with the treasure pools and bands it is given", () => {
  // Guards the case above against passing because it never ran the lint: the same call refuses a bad band and a bad pool.
  const pools = Object.values(POOL);
  const bad = [pic(1, [{ side: "back", pool: pools[0], band: BAND_COUNT }]), pic(2, [{ side: "back", pool: "zz-not-a-pool" }])];
  const got = bookArtProblems(bad, { cookbook: { entries: {} }, pools, bandCount: BAND_COUNT });
  assert.ok(got.some((p) => p.startsWith("art1: band")) && got.some((p) => p.startsWith("art2: unknown pool")), JSON.stringify(got));
  assert.deepEqual(bookArtProblems([pic(1, [{ side: "back", pool: pools[0], band: 0 }])], { cookbook: { entries: {} }, pools, bandCount: BAND_COUNT }), []);
});

console.log(`\ntest-book-art-binding: all ${passed} checks passed`);
