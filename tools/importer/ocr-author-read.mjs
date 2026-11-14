/**
 * The author's read of a page's picture: what the compiler checks a `pictures`
 * recipe against. Never shipped, and never printed whole.
 *
 * Reads each box of the page's `kind.picture` row through the same code the
 * import runs (`picture-text.mjs`: the same scale, crop padding and reader), and
 * writes the words per box, keyed by box and page segmentation mode, with the
 * samples' size and SHA-256, to `<OCR_READS>\<book>\p<page>.json`. That folder
 * is LOCAL-ONLY, outside every repo: a read is the book's text, so it is never
 * copied into a test, a fixture, a comment or a report. This tool prints only
 * line numbers, boxes, character counts and `printKey`s.
 *
 * Usage: node tools/importer/ocr-author-read.mjs <book> <page>
 *        node tools/importer/ocr-author-read.mjs <book> <page> --probe
 * `--probe` lists the page's pictures (name, size) and reads nothing.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReader, openPinned, pagePictures } from "../../scripts/importer/ocr.mjs";
import { SCALE, BOX_PAD, pictureScaled, readBoxReads, pictureRuns } from "../../scripts/importer/picture-text.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";
import { FILES, OCR_READS } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");

/** Where an author's read of a book's page lives. */
export const readPath = (book, page) => path.join(OCR_READS, book, `p${page}.json`);

/** The key a box read is stored under: its edges and its mode. */
export const boxKey = ({ box, psm }) => `${box.x0},${box.x1},${box.y0},${box.y1}@${psm}`;

/** The page's `kind.picture` row's recipe from the register, or null. */
export function recipeOf(book, page) {
  const dir = path.join(REGISTER, book);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    for (const row of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
      if (row.kind === "kind.picture" && row.pages?.[0] === page) return row.picture;
    }
  }
  return null;
}

/**
 * An author's read from disk as the box reads `pictureRuns` takes, in the
 * recipe's order, or null when it is absent or was made over another recipe's
 * boxes. `stale` names why a read that exists does not match.
 */
export function loadRead(book, page, picture) {
  const file = readPath(book, page);
  if (!fs.existsSync(file)) return { reads: null, file };
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  if (stored.name !== picture.name || stored.scale !== SCALE || stored.pad !== BOX_PAD) return { reads: null, file, stale: "made at another picture, scale or padding" };
  const reads = picture.read.map((spec) => stored.boxes?.[boxKey(spec)]);
  if (reads.some((r) => !r)) return { reads: null, file, stale: "holds no read for one of the recipe's boxes" };
  return { reads, file, samples: stored.samples };
}

async function main() {
  const [book, pageArg, flag] = process.argv.slice(2);
  const page = parseInt(pageArg, 10);
  if (!FILES[book] || !(page > 0)) {
    console.error("usage: ocr-author-read.mjs <book> <page> [--probe]");
    process.exit(2);
  }
  const pinned = await openPinned(fs.readFileSync(FILES[book]));
  let reader = null;
  try {
    if (flag === "--probe") {
      for (const p of await pagePictures(await pinned.getPage(page))) console.log(`${p.name} ${p.width}x${p.height} kind ${p.kind}`);
      return;
    }
    const picture = recipeOf(book, page);
    if (!picture) throw new Error(`no kind.picture row on p.${page} of ${book}`);
    const { samples, scaled } = await pictureScaled(pinned, page, picture.name);
    reader = await createReader();
    const reads = await readBoxReads(reader, scaled, picture);
    const boxes = {};
    picture.read.forEach((spec, i) => (boxes[boxKey(spec)] = reads[i]));
    const out = {
      name: picture.name,
      scale: SCALE,
      pad: BOX_PAD,
      samples: { width: samples.width, height: samples.height, sha256: crypto.createHash("sha256").update(samples.data).digest("hex") },
      boxes,
    };
    fs.mkdirSync(path.dirname(readPath(book, page)), { recursive: true });
    fs.writeFileSync(readPath(book, page), JSON.stringify(out) + "\n");
    // Only shapes leave this process: no word of the read is printed.
    console.log(`p.${page} ${samples.width}x${samples.height} samples, sha256 ${out.samples.sha256.slice(0, 12)}…, written to the local reads folder`);
    const { runs } = pictureRuns(reads, { corrections: [] });
    const per = reads.map((r) => r.lines.length);
    console.log(`  boxes ${reads.length}, lines per box [${per.join(" ")}], runs ${runs.length}`);
    runs.forEach((r, i) => console.log(`  run ${i}: x ${r.x} y ${r.y} w ${r.w} h ${r.h} chars ${r.str.trim().length} key ${printKey(r.str)}`));
  } finally {
    await reader?.terminate();
    await pinned.loadingTask.destroy();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
