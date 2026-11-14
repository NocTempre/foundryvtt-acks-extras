/**
 * The pure half of the OCR authoring kit (`ocr-kit-lib.mjs`): the in-order
 * scorer read both ways, the gutter and box finders, stat-line detection, the
 * pixel to page-point map of a placed picture checked against the scene
 * frame's own turn, and the PNG writer. Every read, line and word here is
 * invented: no PDF, no engine.
 */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { sceneFrame } from "../../scripts/importer/scene-binding.mjs";
import {
  tokensOf, alignTokens, gapsOf, readTokens, scoreRead, bagCosine, oracleSections, median, histogram, findGutters, proposeBoxes,
  statKeysOf, statBlocks, pixelToPoint, pointToPixel, turnOf, pixelRectToPage, crc32, encodePng, cropRgb, PNG_SIGNATURE,
} from "./ocr-kit-lib.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ------------------------------------------------------------------ scoring */

t("the tokeniser lowercases, drops apostrophes, splits on punctuation and keeps lone digits", () => {
  assert.deepEqual(tokensOf("Alpha's beta-gamma, 7 x 12+ q"), ["alphas", "beta", "gamma", "7", "12+"]);
});

t("the aligner finds what each side lacks, in order", () => {
  const want = ["a1", "bb", "cc", "dd", "ee"], got = ["a1", "cc", "xx", "dd", "ee", "yy"];
  const a = alignTokens(want, got);
  assert.equal(a.length, 4);
  assert.deepEqual(a.wantOn, [true, false, true, true, true]);
  assert.deepEqual(a.gotOn, [true, true, false, true, true, false]);
  assert.deepEqual(a.wantPartner, [0, -1, 1, 3, 4]);
});

t("a sequence out of order scores only its longest in-order part", () => {
  assert.equal(alignTokens(["aa", "bb", "cc", "dd"], ["cc", "dd", "aa", "bb"]).length, 2);
  assert.equal(alignTokens([], ["aa"]).length, 0);
});

t("gaps name each disagreement with both sides' index ranges", () => {
  const want = ["aa", "bb", "cc", "dd", "ee"], got = ["aa", "cc", "xx", "dd", "ee", "yy"];
  const a = alignTokens(want, got);
  const gaps = gapsOf(want.length, got.length, a);
  assert.deepEqual(gaps, [
    { want: [1, 2], got: [1, 1] },
    { want: [3, 3], got: [2, 3] },
    { want: [5, 5], got: [5, 6] },
  ]);
  assert.equal(gaps.reduce((s, g) => s + g.want[1] - g.want[0], 0), want.length - a.length);
  assert.equal(gaps.reduce((s, g) => s + g.got[1] - g.got[0], 0), got.length - a.length);
});

t("both directions: a misread digit is one lack and one extra, counted apart from words", () => {
  const oracle = tokensOf("alpha beta 12 gamma 3rd delta");
  const read = [{ t: "alpha", box: 0, line: 0 }, { t: "beta", box: 0, line: 0 }, { t: "17", box: 0, line: 1 }, { t: "gamma", box: 1, line: 0 }, { t: "delta", box: 1, line: 0 }, { t: "extra", box: 1, line: 1 }];
  const s = scoreRead(oracle, read);
  assert.equal(s.oracle, 6);
  assert.equal(s.matched, 4);
  assert.equal(s.lacking, 2);
  assert.equal(s.lackingDigits, 2);
  assert.equal(s.lackingOrdinals, 1);
  assert.equal(s.extra, 2);
  assert.equal(s.extraDigits, 1);
  const digitGap = s.gaps.find((g) => g.wantDigits === 1 && g.gotDigits === 1);
  assert.deepEqual([digitGap.at, digitGap.box, digitGap.line], ["at", 0, 1]);
  const lackOnly = s.gaps.find((g) => g.want[1] - g.want[0] === 1 && g.got[0] === g.got[1]);
  assert.deepEqual([lackOnly.at, lackOnly.box, lackOnly.line], ["before", 1, 0]);
});

t("a read that matches scores no gaps", () => {
  const tokens = tokensOf("one two three").map((x) => ({ t: x, box: 0, line: 0 }));
  const s = scoreRead(["one", "two", "three"], tokens);
  assert.deepEqual([s.lacking, s.extra, s.gaps.length], [0, 0, 0]);
});

t("a line-end hyphen joins the next line's first word when it is lower case", () => {
  const { tokens, joins } = readTokens(["alpha be-\ntagam delta\nQuux-\nRoot"]);
  assert.equal(joins, 1);
  assert.deepEqual(tokens.map((x) => x.t), ["alpha", "betagam", "delta", "quux", "root"]);
  assert.deepEqual(tokens.map((x) => [x.box, x.line]).slice(0, 2), [[0, 0], [0, 0]]);
});

t("tokens carry the box and line they came from", () => {
  const { tokens } = readTokens(["aa bb\ncc", "dd"]);
  assert.deepEqual(tokens.map((x) => [x.t, x.box, x.line]), [["aa", 0, 0], ["bb", 0, 0], ["cc", 0, 1], ["dd", 1, 0]]);
});

t("sections split on the second-level heading and a cosine ranks the right one first", () => {
  const sections = oracleSections("# Title\n\n## One\nalpha beta gamma alpha\n\n## Two\ndelta epsilon zeta\n");
  assert.equal(sections.length, 2);
  const read = tokensOf("alpha beta gamma");
  assert.ok(bagCosine(read, tokensOf(sections[0])) > bagCosine(read, tokensOf(sections[1])));
  assert.equal(bagCosine([], ["aa"]), 0);
});

/* ---------------------------------------------------------------- geometry */

t("median and histogram", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
  assert.deepEqual(histogram([10, 11, 11, 15], 2), [{ from: 10, to: 11, count: 3 }, { from: 14, to: 15, count: 1 }]);
});

t("gutters are the gaps no span crosses, margins excluded, narrow gaps ignored", () => {
  const spans = [{ x0: 5, x1: 100 }, { x0: 50, x1: 120 }, { x0: 140, x1: 200 }, { x0: 204, x1: 300 }, { x0: 10, x1: 30 }];
  assert.deepEqual(findGutters(spans, 12), [{ x0: 120, x1: 140 }]);
  assert.deepEqual(findGutters(spans, 3), [{ x0: 120, x1: 140 }, { x0: 200, x1: 204 }]);
  assert.deepEqual(findGutters([], 12), []);
});

/** An invented column of lines: `n` lines of height 10 from `top`, in x range [x0, x1]. */
const column = (x0, x1, top, count) => Array.from({ length: count }, (_, i) => ({ x0, x1, y0: top + i * 14, y1: top + i * 14 + 10, words: [{ x0, x1: (x0 + x1) / 2 }, { x0: (x0 + x1) / 2 + 4, x1 }] }));

t("two columns split at a tall run, in reading order, with a banner first", () => {
  const left = column(10, 190, 60, 8);
  const right = column(230, 410, 60, 8);
  const heading = { x0: 230, x1: 330, y0: 120, y1: 140, words: [{ x0: 230, x1: 330 }] };
  const rightLines = [...right.slice(0, 4), heading, ...right.slice(4).map((l) => ({ ...l, y0: l.y0 + 30, y1: l.y1 + 30 }))];
  const banner = { x0: 10, x1: 410, y0: 10, y1: 34, words: [{ x0: 10, x1: 410 }] };
  const { read, notes } = proposeBoxes([banner, ...left, ...rightLines], { width: 420, height: 300 });
  assert.deepEqual(notes, []);
  assert.equal(read.length, 4);
  assert.ok(read.every((r) => r.psm === 6));
  assert.ok(read[0].box.x1 - read[0].box.x0 > 380, "the banner is full width and first");
  assert.ok(read[1].box.x1 < 230, "the left column comes next");
  assert.ok(read[2].box.x0 > 190 && read[3].box.x0 > 190, "then the right column, split at the heading");
  assert.ok(read[2].box.y1 < heading.y0 + 2 && read[3].box.y0 <= heading.y0, "the split falls at the heading");
});

t("a banner below the column text is a note, not a box", () => {
  const { read, notes } = proposeBoxes([...column(10, 190, 10, 5), ...column(230, 410, 10, 5), { x0: 10, x1: 410, y0: 150, y1: 172, words: [{ x0: 10, x1: 410 }] }], { width: 420, height: 200 });
  assert.equal(read.length, 2);
  assert.equal(notes.length, 1);
});

/* --------------------------------------------------------------- stat lines */

t("a line with two or more stat keys is a stat line, and a single-key line beside one joins it", () => {
  assert.deepEqual([...statKeysOf("Quux 2; AC 4, HD 3, hp 12, #AT 1")].sort(), ["#AT", "AC", "HD", "HP"]);
  assert.equal(statKeysOf("the AC of a wall").size, 1);
  assert.equal(statKeysOf("plain words").size, 0);
  const lines = ["words", "AC 5, HD 2", "SV F2", "words again", "words", "ML +1, XP 20", "words"];
  assert.deepEqual(statBlocks(lines), [{ from: 1, to: 2 }, { from: 5, to: 5 }]);
});

/* ------------------------------------------------------------- pixel maps */

/** An invented picture of 100 x 50 samples placed on a 100 x 50 rectangle at (10, 20), as each quarter turn prints it. */
const W = 100, H = 50;
const PLACEMENTS = [
  { turn: 0, top: [100, 0, 0, -50, 10, 70], rect: { x: 10, y: 20, w: 100, h: 50 } },
  { turn: 1, top: [0, 100, 50, 0, 10, 20], rect: { x: 10, y: 20, w: 50, h: 100 } },
  { turn: 2, top: [-100, 0, 0, 50, 110, 20], rect: { x: 10, y: 20, w: 100, h: 50 } },
  { turn: 3, top: [0, -100, -50, 0, 60, 120], rect: { x: 10, y: 20, w: 50, h: 100 } },
];

t("each quarter turn is told from its matrix, and a mirrored one is refused", () => {
  for (const { turn, top } of PLACEMENTS) assert.equal(turnOf(top, W, H), turn);
  assert.equal(turnOf([-100, 0, 0, -50, 110, 70], W, H), null);
  assert.equal(turnOf([100, 20, 0, -50, 10, 70], W, H), null);
});

t("pixel to point and back round-trips, and the corners land on the placement's rectangle", () => {
  for (const { top, rect } of PLACEMENTS) {
    for (const [x, y] of [[0, 0], [W, H], [37.5, 12.25], [W, 0], [0, H]]) {
      const [px, py] = pointToPixel(top, W, H, ...pixelToPoint(top, W, H, x, y));
      assert.ok(Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9);
    }
    const r = pixelRectToPage(top, W, H, [0, 0, W, H]);
    assert.deepEqual([r.x, r.y, r.w, r.h], [rect.x, rect.y, rect.w, rect.h]);
  }
  assert.throws(() => pointToPixel([0, 0, 0, 0, 0, 0], W, H, 1, 1), /singular/);
});

t("the scene frame's own turn puts a point back on its upright pixel", () => {
  for (const { turn, top, rect } of PLACEMENTS) {
    const frame = sceneFrame({ crop: rect, turn }, { pixelsPerPoint: W / (turn % 2 ? rect.h : rect.w) });
    assert.deepEqual([frame.width, frame.height], [W, H]);
    for (const [x, y] of [[0, 0], [W, H], [20, 40], [90, 5]]) {
      const s = frame.toScene(...pixelToPoint(top, W, H, x, y));
      assert.ok(Math.abs(s[0] - x) < 1e-6 && Math.abs(s[1] - y) < 1e-6, `turn ${turn} at ${x},${y} gave ${s}`);
    }
  }
});

/* --------------------------------------------------------------------- PNG */

t("crc32 matches the standard check value and zlib's", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const bytes = Buffer.from([0, 1, 2, 250, 251, 255]);
  if (zlib.crc32) assert.equal(crc32(bytes), zlib.crc32(bytes));
});

t("a PNG has the signature, an IHDR of the size, a valid CRC on every chunk and pixels that inflate back", () => {
  const rgb = Uint8Array.from({ length: 3 * 2 * 3 }, (_, i) => i * 7 % 256);
  const png = encodePng(rgb, 3, 2);
  assert.deepEqual([...png.subarray(0, 8)], [...PNG_SIGNATURE]);
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at), type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)), `${type} crc`);
    chunks.push({ type, data });
    at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual([chunks[0].data.readUInt32BE(0), chunks[0].data.readUInt32BE(4), chunks[0].data[8], chunks[0].data[9]], [3, 2, 8, 2]);
  const raw = zlib.inflateSync(chunks[1].data);
  assert.equal(raw.length, 2 * (9 + 1));
  assert.deepEqual([...raw.subarray(1, 10)], [...rgb.subarray(0, 9)]);
  assert.deepEqual([...raw.subarray(11, 20)], [...rgb.subarray(9, 18)]);
  assert.throws(() => encodePng(rgb, 4, 2), /does not match/);
});

t("a crop repeats each source pixel, clamps to the picture and reads a 1-bit picture", () => {
  const data = Uint8Array.from([10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42]);
  const c = cropRgb({ width: 2, height: 2, kind: 2, data }, [1, 0, 5, 9], 2);
  assert.deepEqual([c.width, c.height], [2, 4]);
  assert.deepEqual([...c.rgb.subarray(0, 6)], [20, 21, 22, 20, 21, 22]);
  assert.deepEqual([...c.rgb.subarray(2 * 3 * 2, 2 * 3 * 2 + 3)], [40, 41, 42]);
  assert.throws(() => cropRgb({ width: 2, height: 2, kind: 2, data }, [5, 5, 9, 9]), /outside/);
  const bits = cropRgb({ width: 2, height: 1, kind: 1, data: Uint8Array.from([0b01000000]) }, [0, 0, 2, 1], 1);
  assert.deepEqual([...bits.rgb], [0, 0, 0, 255, 255, 255]);
});

console.log(`${n} passed`);
