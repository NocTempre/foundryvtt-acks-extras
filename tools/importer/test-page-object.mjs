/**
 * The page-object lookup `extract.mjs` `pageObject` and its two readers,
 * `pageArtInfo` and `ocr.mjs`'s picture lookups, against a mock page whose two
 * stores behave as pdf.js's do: each answers only the names it holds and never
 * calls back for any other. A shared image (`g_…`) lives in `commonObjs`, a
 * page's own in `objs`. No PDF.
 */
import assert from "node:assert/strict";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { pageArtInfo, pageObject } from "../../scripts/importer/extract.mjs";
import { pagePictures, pictureSamples } from "../../scripts/importer/ocr.mjs";

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/** A store holding these objects by name; a `get` for any other name never calls back. */
const store = (objects) => ({
  get(name, done) {
    if (name in objects) done(objects[name]);
  },
});

const SHARED = "g_doc_img_frame";
const OWN = "img_p7_1";
const image = (width, height) => ({ width, height, kind: 2, data: new Uint8ClampedArray(width * height * 3) });

/** A page painting one shared image and one of its own, each held only by the store pdf.js delivers it to. */
const pageOf = () => ({
  getOperatorList: async () => ({
    fnArray: [OPS.paintImageXObject, OPS.paintImageXObject],
    argsArray: [[SHARED], [OWN]],
  }),
  objs: store({ [OWN]: image(400, 300) }),
  commonObjs: store({ [SHARED]: image(1692, 1297) }),
});

await t("a shared name is answered by the document's store", async () => {
  const img = await pageObject(pageOf(), SHARED, 50);
  assert.equal(img?.width, 1692);
});

await t("a page's own name is answered by the page's store", async () => {
  const img = await pageObject(pageOf(), OWN, 50);
  assert.equal(img?.width, 400);
});

await t("a name neither store holds answers null once the wait is spent", async () => {
  const started = Date.now();
  assert.equal(await pageObject(pageOf(), "img_p7_9", 30), null);
  assert.ok(Date.now() - started >= 25);
});

await t("a store that throws answers null at once", async () => {
  const page = { objs: { get: () => { throw new Error("no such store"); } } };
  const started = Date.now();
  assert.equal(await pageObject(page, OWN, 1000), null);
  assert.ok(Date.now() - started < 500);
});

await t("pageArtInfo returns the shared image beside the page's own, without waiting", async () => {
  const page = pageOf();
  const started = Date.now();
  const infos = await pageArtInfo({ getPage: async () => page }, 7);
  assert.deepEqual(infos.map((i) => [i.name, i.width, i.height]), [[SHARED, 1692, 1297], [OWN, 400, 300]]);
  assert.ok(Date.now() - started < 1000);
});

await t("pagePictures lists both, largest first, without waiting", async () => {
  const started = Date.now();
  const pictures = await pagePictures(pageOf());
  assert.deepEqual(pictures.map((p) => p.name), [SHARED, OWN]);
  assert.ok(Date.now() - started < 1000);
});

await t("pictureSamples reads a shared picture's samples", async () => {
  const img = await pictureSamples(pageOf(), SHARED);
  assert.equal(img.data.length, 1692 * 1297 * 3);
});

console.log(`\n${n} checks passed`);
