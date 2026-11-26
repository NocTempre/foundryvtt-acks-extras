/**
 * The picture-text path in `scripts/importer/ocr.mjs`: the pixel functions by
 * hand-computed cases, then a picture of invented text (a bitmap font drawn
 * into an RGB buffer, no canvas, no book) run through grey, scale, box, PGM and
 * the vendored engine in Node. No PDFs, no Foundry.
 */
import assert from "node:assert";
import fs from "node:fs";
import { KIND, toGrey, scaleUp, toPgm, scaledPicture, cropBox, createReader } from "../../scripts/importer/ocr.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const same = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

/* ---------------------------------------------------------------- toGrey */

same("RGB: white stays white, red is its luma", [...toGrey({ width: 2, height: 1, kind: KIND.RGB_24BPP, data: Uint8Array.of(255, 255, 255, 255, 0, 0) })], [255, 76]);
same("RGBA reads four bytes a pixel and ignores alpha", [...toGrey({ width: 2, height: 1, kind: KIND.RGBA_32BPP, data: Uint8Array.of(0, 255, 0, 7, 0, 0, 0, 255) })], [150, 0]);
same("1-bit rows are padded to whole bytes", [...toGrey({ width: 10, height: 1, kind: KIND.GRAYSCALE_1BPP, data: Uint8Array.of(0b10100000, 0b01000000) })], [255, 0, 255, 0, 0, 0, 0, 0, 0, 255]);
assert.throws(() => toGrey({ width: 1, height: 1, kind: 99, data: Uint8Array.of(0) }), /unsupported image kind 99/);
pass++;

/* --------------------------------------------------------------- scaleUp */

{
  // [0, 100] doubled: the end pixels clamp, the inner ones are weighted
  // quarters (0*3+100*1)/4 = 25, (0*1+100*3)/4 = 75, rounded half up.
  const out = scaleUp(Uint8Array.of(0, 100), 2, 1, 2);
  same("scaleUp size", [out.width, out.height], [4, 2]);
  same("scaleUp of [0, 100] by 2", [...out.grey], [0, 25, 75, 100, 0, 25, 75, 100]);
  same("a flat image scales flat", [...scaleUp(new Uint8Array(6).fill(200), 3, 2, 3).grey], new Array(54).fill(200));
}

/* ------------------------------------------------------------ toPgm, crop */

{
  const pgm = toPgm(Uint8Array.of(1, 2, 3, 4, 5, 6), 3, 2);
  same("PGM header and samples", [...pgm], [..."P5\n3 2\n255\n"].map((c) => c.charCodeAt(0)).concat(1, 2, 3, 4, 5, 6));

  const samples = { width: 4, height: 1, kind: KIND.RGB_24BPP, data: Uint8Array.of(0, 0, 0, 100, 100, 100, 200, 200, 200, 40, 40, 40) };
  const scaled = scaledPicture(samples, 2);
  same("scaledPicture carries the factor and the scaled size", [scaled.k, scaled.width, scaled.height], [2, 8, 2]);
  const crop = cropBox(scaled, [1, 0, 2, 1]);
  same("a box is cut at k times its coordinates", [crop.origin, crop.width, crop.height], [[2, 0], 4, 2]);
  same("the crop's samples are the scaled picture's", [...crop.pgm.subarray(crop.pgm.length - 8)], [...scaled.grey.subarray(2, 6), ...scaled.grey.subarray(10, 14)]);
  const alone = scaleUp(toGrey({ ...samples, width: 2, data: samples.data.subarray(3, 9) }), 2, 1, 2);
  check("a box's edge pixels come from its real neighbours, not from a picture scaled alone", crop.pgm[crop.pgm.length - 8] !== alone.grey[0]);
  same("a box past the picture is clamped", [cropBox(scaled, [3, 0, 9, 9]).origin, cropBox(scaled, [3, 0, 9, 9]).width], [[6, 0], 2]);
  assert.throws(() => cropBox(scaled, [5, 0, 2, 1]), /outside the picture/);
  pass++;
}

/* ------------------------------------------------ invented text, drawn */

/** A 5 x 7 bitmap font for the letters the invented words use. */
const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
};

/**
 * Invented lines drawn black on white into a 24-bit RGB image shaped like a
 * pdf.js image object. `cell` is the side of one font pixel; a glyph is five
 * cells across and one apart, a word space is three cells, and a line sits
 * eleven cells below the last.
 */
function drawLines(lines, cell, margin) {
  const rowWidth = (line) => [...line].reduce((w, ch) => w + (ch === " " ? 3 : 6), 0) * cell;
  const width = Math.max(...lines.map(rowWidth)) + 2 * margin;
  const height = lines.length * 11 * cell + 2 * margin;
  const data = new Uint8Array(width * height * 3).fill(255);
  lines.forEach((line, li) => {
    let x = margin;
    const top = margin + li * 11 * cell;
    for (const ch of line) {
      if (ch === " ") { x += 3 * cell; continue; }
      FONT[ch].forEach((row, gy) => [...row].forEach((on, gx) => {
        if (on !== "#") return;
        for (let y = 0; y < cell; y++) for (let xx = 0; xx < cell; xx++) data.fill(0, ((top + gy * cell + y) * width + x + gx * cell + xx) * 3, ((top + gy * cell + y) * width + x + gx * cell + xx) * 3 + 3);
      }));
      x += 6 * cell;
    }
  });
  return softened({ width, height, kind: KIND.RGB_24BPP, data }, 2);
}

/** The image with every sample averaged over its neighbours, `radius` times over, so glyph edges are not stair steps. */
function softened(img, radius) {
  const { width, height, data } = img;
  let src = data;
  for (let pass = 0; pass < radius; pass++) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        sum += src[(yy * width + xx) * 3 + c];
        n++;
      }
      out[(y * width + x) * 3 + c] = Math.round(sum / n);
    }
    src = out;
  }
  return { ...img, data: src };
}

const LINES = ["TULIP MARKET", "WOMBAT NOTES"];
const picture = drawLines(LINES, 3, 60);
const scaled = scaledPicture(picture, 2);

const pgmOf = (p) => toPgm(p.grey, p.width, p.height);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

const reader = await createReader();
try {
  const whole = await reader.read(pgmOf(scaled));
  same("a whole picture reads as drawn", whole.text, "TULIP MARKET\nWOMBAT NOTES\n");
  check("the mean confidence is the engine's, high on clean type", whole.confidence >= 85);
  same("lines are grouped in reading order", whole.lines.map((l) => l.text), ["TULIP MARKET\n", "WOMBAT NOTES\n"]);
  same("each line holds its words", whole.lines.map((l) => l.words.map((w) => w.text)), [["TULIP", "MARKET"], ["WOMBAT", "NOTES"]]);
  same("a whole picture's origin is its corner", whole.origin, [0, 0]);
  const [l1, l2] = whole.lines;
  check("words run left to right inside a line", l1.words[0].bbox.x1 < l1.words[1].bbox.x0 && l2.words[0].bbox.x1 < l2.words[1].bbox.x0);
  check("the second line sits below the first", l2.bbox.y0 > l1.bbox.y1);
  check("a word's box sits where it was drawn, in scaled pixels", near(l1.words[0].bbox.x0, 60 * 2) && near(l1.words[0].bbox.y0, 60 * 2) && near(l1.words[0].bbox.y1 - l1.words[0].bbox.y0, 7 * 3 * 2));
  check("every word carries a confidence", whole.lines.every((l) => l.words.every((w) => Number.isFinite(w.confidence))));

  const line2 = await reader.readBox(scaled, [0, 85, picture.width, 41], { psm: 7 });
  same("a box reads its own line", line2.text, "WOMBAT NOTES\n");
  same("a box's origin is its corner in the scaled picture", line2.origin, [0, 170]);
  check("a box's word positions plus its origin land on the whole read's", near(line2.lines[0].words[0].bbox.y0 + line2.origin[1], l2.words[0].bbox.y0) && near(line2.lines[0].words[1].bbox.x1 + line2.origin[0], l2.words[1].bbox.x1));

  const word = await reader.readBox(scaled, [50, 85, 125, 41], { psm: 8 });
  same("a single-word mode reads one word", word.text, "WOMBAT\n");
  same("and its origin follows the box", word.origin, [100, 170]);

  same("a read after another mode is back in the default mode and unchanged", await reader.read(pgmOf(scaled)), whole);
  await assert.rejects(() => reader.readBox(scaled, [999, 0, 5, 5]), /outside the picture/);
  pass++;
} finally {
  await reader.terminate();
}

/* ------------------------------------------------------ no network path */

{
  // The library defaults three paths to a CDN; the browser reader sets each,
  // and nothing in the module names a host.
  const source = fs.readFileSync(new URL("../../scripts/importer/ocr.mjs", import.meta.url), "utf8");
  check("ocr.mjs names no host", !source.includes("://"));
  for (const file of ["tesseract.esm.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "lang/eng.traineddata.gz"]) check(`the vendored ${file} is present`, fs.existsSync(new URL(`../../vendor/tesseract/${file}`, import.meta.url)));
}

console.log(`\ntest-ocr: all ${pass} checks passed`);
