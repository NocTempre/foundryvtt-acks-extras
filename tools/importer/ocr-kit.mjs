/**
 * The authoring kit for the Judges Journal's scenario pictures (pp. 417-425):
 * what a recipe author uses to fit boxes, reading order, corrections, keyed
 * rows, a plan's crop and its key points. Never shipped.
 *
 * Every read goes through `scripts/importer/ocr.mjs` and `picture-text.mjs`, so
 * the kit reads what an import reads. The book, the wiki oracle and everything
 * a read holds are LOCAL-ONLY: reads, scores, token pairs and crops are written
 * under `<OCR_READS>\jj\`, and the console carries counts, indices and
 * geometry. Only `show` and `crop` are for the author's eyes.
 *
 * Usage:
 *   ocr-kit.mjs hashes [<first> [<last>]]   reproduce J0's hashes (27 of 27 equal)
 *   ocr-kit.mjs whole <page> [--tall f] [--fresh]             whole-picture PSM 3 read; structure summary
 *   ocr-kit.mjs propose <page> [--tall f]              box proposals, recipe shape, reading order
 *   ocr-kit.mjs score <page> [--recipe <file>] [--fresh] [--all]
 *   ocr-kit.mjs show <page> <box> [<line>] [--recipe <file>]
 *   ocr-kit.mjs crop <page> <x0> <y0> <x1> <y1> [--scale n]
 *   ocr-kit.mjs crop <page> --box <i> | --line <box> <line> | --word <box> <line> <tok> [--scale n] [--recipe <file>]
 *   ocr-kit.mjs stat <page> [--recipe <file>]
 *   ocr-kit.mjs pins <page> [<px> <py>]... | --pt <x> <y> | --rect <x0> <y0> <x1> <y1>
 *
 * Box and line numbers are 0-based, the indices `pictureRuns` uses. A recipe
 * is the page's `kind.picture` row in the register unless `--recipe` names a
 * register file, a cookbook, or a file holding one row or one `picture` block.
 * A picture's XObject name depends on which pages the document has already
 * evaluated: pdf.js shares the page frame's images between pages once a second
 * page paints them, so a page read after others is named lower than the same
 * page opened cold. `hashes` reads the pages in order, as J0's file names them;
 * every other command opens the book afresh, so the names it prints and the
 * ones `pictureNameOf` keeps are cold-open names.
 *
 * A box read is kept in `<OCR_READS>\jj\kit\p<page>-reads.json` by box and mode,
 * so a correction-only edit re-scores without reading again; `--fresh` reads
 * again.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPS } from "../../vendor/pdfjs/pdf.mjs";
import { createReader, openPinned, pagePictures, pictureSamples, scaledPicture, toPgm } from "../../scripts/importer/ocr.mjs";
import { SCALE, BOX_PAD, sampleBox, readBoxReads, pictureRuns } from "../../scripts/importer/picture-text.mjs";
import { pageArtPlacements } from "../../scripts/importer/extract.mjs";
import { sceneFrame } from "../../scripts/importer/scene-binding.mjs";
import { FILES, OCR_READS } from "./reference-lib.mjs";
import { recipeOf, boxKey } from "./ocr-author-read.mjs";
import {
  tokensOf, readTokens, findGutters, columnEdges, oracleSections, bagCosine, scoreRead, median, histogram, proposeBoxes, statKeysOf, statBlocks,
  mulMatrix, pixelToPoint, pointToPixel, turnOf, pixelRectToPage, encodePng, cropRgb,
} from "./ocr-kit-lib.mjs";

/** The book the kit serves. */
const BOOK = "jj";

/** The first scenario page: section i of the oracle is page `FIRST_PAGE + i`. */
export const FIRST_PAGE = 417;

/** Where everything the kit writes goes: LOCAL-ONLY, outside every repo. */
export const OUT = path.join(OCR_READS, BOOK);

/** The oracle: the fan wiki's text of Appendix A. A derived text; the print wins over it. */
export const ORACLE = "C:\\Proj\\acks-reference\\WIKI-SNAPSHOT\\judges\\md\\appendix-a-adventure-scenarios.md";

/** J0's expected hashes per page. */
export const J0_HASHES = path.join(OUT, "j0-hashes.json");

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);
const round1 = (n) => Math.round(n * 10) / 10;
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });

/* ----------------------------------------------------------------- inputs */

/** J0's rows, `{page, name, samples, scaled, text}`. */
function j0Rows() {
  return JSON.parse(fs.readFileSync(J0_HASHES, "utf8")).pages;
}

/** The recipe of a page as `{name, read, corrections}`, or null when there is none. */
function loadRecipe(page, file) {
  let block = null;
  if (file) {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(doc)) block = doc.find((r) => r.kind === "kind.picture" && r.pages?.[0] === page)?.picture ?? null;
    else block = doc.pictures?.[page] ?? doc.picture ?? (doc.read ? doc : null);
  } else block = recipeOf(BOOK, page);
  if (!block) return null;
  const bare = ({ note: _note, ...rest }) => rest;
  return { name: block.name, read: (block.read ?? []).map(bare), corrections: (block.corrections ?? []).map(bare) };
}

/** The recipe of a page, or a thrown error naming where it looked. */
function needRecipe(page, file) {
  const recipe = loadRecipe(page, file);
  if (!recipe) throw new Error(`no picture recipe for p.${page}${file ? ` in ${file}` : " in the register"}`);
  return recipe;
}

/**
 * The scenario picture on a page, by the size the proof harness chose it by (about
 * 1340 x 1034; the larger pictures are the page's frame art and masks): its
 * XObject name, or null.
 */
async function scenarioPictureOf(pdfPage) {
  return (await pagePictures(pdfPage)).find((img) => img.width >= 1300 && img.width <= 1400 && img.height >= 1000 && img.height <= 1060)?.name ?? null;
}

const namesFile = path.join(OUT, "kit", "names.json");

/**
 * The XObject a page's scenario picture goes by: the recipe's, else the kit's
 * kept answer, else the page's picture of the scenario's size (kept), named by a
 * cold document. J0's file is not consulted: it names pictures as a document
 * that has read the pages before does.
 */
async function pictureNameOf(page, file) {
  const named = loadRecipe(page, file)?.name;
  if (named) return named;
  const kept = fs.existsSync(namesFile) ? JSON.parse(fs.readFileSync(namesFile, "utf8")) : {};
  if (kept[page]) return kept[page];
  const found = await withPinned(async (pinned) => scenarioPictureOf(await pinned.getPage(page)));
  if (!found) throw new Error(`p.${page} paints no picture of the scenario's size`);
  kept[page] = found;
  ensure(path.dirname(namesFile));
  fs.writeFileSync(namesFile, JSON.stringify(kept) + "\n");
  return found;
}

/** Open the book pinned, run `fn(pinned)`, and close it. */
async function withPinned(fn) {
  const pinned = await openPinned(fs.readFileSync(FILES[BOOK]));
  try {
    return await fn(pinned);
  } finally {
    await pinned.loadingTask.destroy();
  }
}

/** A page's picture samples and its pdf.js page, inside `withPinned`. */
async function samplesOf(pinned, page, name) {
  const pdfPage = await pinned.getPage(page);
  const samples = await pictureSamples(pdfPage, name);
  if (!samples) throw new Error(`p.${page} paints no picture named ${name}`);
  return { pdfPage, samples };
}

/* --------------------------------------------------------- the box reads */

const readsFile = (page) => path.join(OUT, "kit", `p${page}-reads.json`);

/**
 * A recipe's boxes read through `readBoxReads`, each box kept on disk by box
 * and mode: `{ boxReads, fulls }`, `boxReads` exactly what `pictureRuns` takes
 * and `fulls[i]` the engine's whole answer for the box (lines and words with
 * their confidences and boxes, in the crop's pixels). The engine starts only
 * when a box is missing from the keep.
 */
async function boxReadsFor(page, recipe, { fresh = false } = {}) {
  const file = readsFile(page);
  let kept = { name: recipe.name, scale: SCALE, pad: BOX_PAD, boxes: {} };
  if (!fresh && fs.existsSync(file)) {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (stored.name === recipe.name && stored.scale === SCALE && stored.pad === BOX_PAD) kept = stored;
  }
  const missing = recipe.read.filter((spec) => !kept.boxes[boxKey(spec)]);
  if (missing.length) {
    const t0 = Date.now();
    await withPinned(async (pinned) => {
      const { samples } = await samplesOf(pinned, page, recipe.name);
      const scaled = scaledPicture(samples, SCALE);
      kept.samples = { width: samples.width, height: samples.height };
      const reader = await createReader();
      try {
        const fulls = [];
        const proxy = { readBox: async (s, b, o) => (fulls.push(await reader.readBox(s, b, o)), fulls[fulls.length - 1]) };
        const reads = await readBoxReads(proxy, scaled, { read: missing });
        missing.forEach((spec, i) => {
          const { confidence, lines } = fulls[i];
          kept.boxes[boxKey(spec)] = { boxRead: reads[i], full: { confidence, lines } };
        });
      } finally {
        await reader.terminate();
      }
    });
    ensure(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(kept) + "\n");
    console.log(`read ${missing.length} box(es) of p.${page} in ${secs(t0)} s`);
  }
  const held = recipe.read.map((spec) => kept.boxes[boxKey(spec)]);
  return { boxReads: held.map((h) => h.boxRead), fulls: held.map((h) => h.full), samples: kept.samples };
}

/** A crop-pixel box of a read in the picture's source samples. */
const toSource = (read, { x0, y0, x1, y1 }) => [(read.origin[0] + x0) / read.k, (read.origin[1] + y0) / read.k, (read.origin[0] + x1) / read.k, (read.origin[1] + y1) / read.k];

/** Raw line index a corrected line keeps, as `pictureRuns` assigns it. */
const rawLineOf = (read, j) => Math.min(j, read.lines.length - 1);

/* ------------------------------------------------------------------ hashes */

/**
 * `hashes`: reproduce J0's hashes through the shipping code (samples, scaled
 * grey, whole-picture PSM 3 text), one document and one reader for every page,
 * the pages in order as J0 read them. Each page is named as J0's file names it:
 * a document that has evaluated earlier pages names a later page's pictures
 * differently from a cold one (see the header).
 */
async function cmdHashes([first, last]) {
  const keys = ["samples", "scaled", "text"];
  const rows = j0Rows().filter((r) => r.page >= (Number(first) || 0) && r.page <= (Number(last) || 9999));
  let equal = 0, total = 0;
  await withPinned(async (pinned) => {
    const reader = await createReader();
    try {
      for (const row of rows) {
        const t0 = Date.now();
        const { samples } = await samplesOf(pinned, row.page, row.name);
        const big = scaledPicture(samples, SCALE);
        const got = { samples: sha(samples.data), scaled: sha(big.grey) };
        got.text = sha(new TextEncoder().encode((await reader.read(toPgm(big.grey, big.width, big.height))).text));
        total += keys.length;
        equal += keys.filter((k) => got[k] === row[k]).length;
        const diff = keys.filter((k) => got[k] !== row[k]).map((k) => `${k} ${got[k].slice(0, 8)} want ${row[k].slice(0, 8)}`);
        console.log(`p${row.page} ${diff.length ? `DIFF ${diff.join("; ")}` : "= = ="}  ${secs(t0)} s`);
      }
    } finally {
      await reader.terminate();
    }
  });
  console.log(`${equal} of ${total} equal`);
  if (equal !== total) process.exitCode = 1;
}

/* ------------------------------------------------------------ whole, propose */

const wholeFile = (page) => path.join(OUT, `p${page}-whole.json`);

/** A page's whole-picture PSM 3 read in source samples, read once and kept. */
async function wholeFor(page, { fresh = false } = {}) {
  const file = wholeFile(page);
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const name = await pictureNameOf(page);
  const t0 = Date.now();
  const out = await withPinned(async (pinned) => {
    const { samples } = await samplesOf(pinned, page, name);
    const big = scaledPicture(samples, SCALE);
    const reader = await createReader();
    try {
      const read = await reader.read(toPgm(big.grey, big.width, big.height));
      const box = (b) => ({ x0: round1(b.x0 / SCALE), y0: round1(b.y0 / SCALE), x1: round1(b.x1 / SCALE), y1: round1(b.y1 / SCALE) });
      return {
        name,
        scale: SCALE,
        samples: { width: samples.width, height: samples.height, sha256: sha(samples.data) },
        confidence: read.confidence,
        lines: read.lines.map((l) => ({
          text: l.text.trim(),
          confidence: l.confidence,
          bbox: box(l.bbox),
          height: round1((l.bbox.y1 - l.bbox.y0) / SCALE),
          words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: box(w.bbox) })),
        })),
      };
    } finally {
      await reader.terminate();
    }
  });
  ensure(OUT);
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  console.log(`read p.${page} whole in ${secs(t0)} s`);
  return out;
}

/** Lines of a whole read as the geometry `proposeBoxes` takes. */
const geometryOf = (whole) => whole.lines.filter((l) => l.words.length).map((l) => ({ ...l.bbox, words: l.words.map((w) => ({ x0: w.bbox.x0, x1: w.bbox.x1 })) }));

async function cmdWhole([pageArg], flags) {
  const page = Number(pageArg);
  const whole = await wholeFor(page, { fresh: flags.fresh });
  const tallFactor = flags.tall ?? 1.2;
  const heights = whole.lines.map((l) => l.height);
  const med = median(heights);
  console.log(`p.${page} ${whole.samples.width}x${whole.samples.height} samples, mean confidence ${Math.round(whole.confidence)}, written to ${wholeFile(page)}`);
  console.log(`lines ${whole.lines.length}, median height ${med}`);
  console.log(`line heights: ${histogram(heights, 2).map((b) => `${b.from}-${b.to}:${b.count}`).join(" ")}`);
  const bodyWords = whole.lines.filter((l) => l.height <= tallFactor * med).flatMap((l) => l.words.map((w) => ({ x0: w.bbox.x0, x1: w.bbox.x1 })));
  console.log(`column left edges (peaks of the body lines' start): ${columnEdges(geometryOf(whole).filter((l) => l.y1 - l.y0 <= tallFactor * med)).map((e) => Math.round(e)).join(" ") || "none"}
  x gaps no body word crosses anywhere on the page: ${findGutters(bodyWords, 12).map((g) => `${Math.round(g.x0)}-${Math.round(g.x1)}`).join(" ") || "none"}`);
  const tall = whole.lines.map((l, i) => ({ i, l })).filter(({ l }) => l.height > tallFactor * med).sort((a, b) => a.l.bbox.y0 - b.l.bbox.y0);
  console.log(`lines taller than ${tallFactor} x median (${tall.length}), by y: line, y, height, x range`);
  for (const { i, l } of tall) console.log(`  ${i}: y ${Math.round(l.bbox.y0)}-${Math.round(l.bbox.y1)} h ${l.height} x ${Math.round(l.bbox.x0)}-${Math.round(l.bbox.x1)}`);
}

async function cmdPropose([pageArg], flags) {
  const page = Number(pageArg);
  const whole = await wholeFor(page);
  const { read, notes } = proposeBoxes(geometryOf(whole), { width: whole.samples.width, height: whole.samples.height, ...(flags.tall ? { tall: flags.tall } : {}) });
  ensure(OUT);
  fs.writeFileSync(path.join(OUT, `p${page}-propose.json`), JSON.stringify(read, null, 1) + "\n");
  console.log(`${read.length} box(es) proposed for p.${page} in reading order (psm 6 each; edit freely):`);
  console.log(JSON.stringify(read));
  for (const n of notes) console.log(`note: ${n}`);
}

/* ------------------------------------------------------------------- score */

async function cmdScore([pageArg], flags) {
  const page = Number(pageArg);
  const recipe = needRecipe(page, flags.recipe);
  const { boxReads } = await boxReadsFor(page, recipe, { fresh: flags.fresh });
  const { boxText, hits, spans } = pictureRuns(boxReads, recipe);
  const sections = oracleSections(fs.readFileSync(ORACLE, "utf8"));
  const index = page - FIRST_PAGE;
  if (!sections[index]) throw new Error(`the oracle has ${sections.length} sections and none for p.${page}`);
  const oracle = tokensOf(sections[index]);
  const { tokens, joins } = readTokens(boxText);
  const cos = sections.map((s) => bagCosine(tokens.map((t) => t.t), tokensOf(s)));
  const rank = 1 + cos.filter((c, i) => i !== index && c > cos[index]).length;
  console.log(`p.${page}: oracle section ${index + 1} of ${sections.length}; the read matches it at rank ${rank} of ${sections.length} (cosine ${cos[index].toFixed(2)}, next best ${Math.max(...cos.filter((_, i) => i !== index)).toFixed(2)})`);
  const s = scoreRead(oracle, tokens);
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");
  console.log(`in order: ${s.matched}/${s.oracle} oracle tokens (${pct(s.matched, s.oracle)}%); read tokens ${s.read}, ${s.extra} not in the oracle's sequence (${pct(s.extra, s.read)}%); line-end hyphens joined ${joins}`);
  console.log(`digit tokens: oracle ${s.oracleDigits}, the read lacks ${s.lackingDigits} (superscript ordinals ${s.lackingOrdinals}, other ${s.lackingDigits - s.lackingOrdinals}); the read has ${s.extraDigits} the oracle lacks`);
  const lines = [`# p.${page} pairs: oracle tokens the read lacks, and read tokens the oracle lacks, with matched context`];
  const want = oracle, got = tokens.map((t) => t.t);
  s.gaps.forEach((g, k) => {
    const ctx = (a, lo, hi) => a.slice(Math.max(0, lo - 3), lo).join(" ") + " | " + a.slice(hi, hi + 3).join(" ");
    lines.push(
      `gap ${k} ${g.at} box ${g.box} line ${g.line}: lack ${g.want[1] - g.want[0]} (${g.wantDigits} digit), extra ${g.got[1] - g.got[0]} (${g.gotDigits} digit)`,
      `  oracle: ${want.slice(...g.want).join(" ") || "-"}   [${ctx(want, g.want[0], g.want[1])}]`,
      `  read:   ${tokens.slice(...g.got).map((t) => `${t.t}@${t.box}.${t.line}`).join(" ") || "-"}   [${ctx(got, g.got[0], g.got[1])}]`,
    );
  });
  ensure(OUT);
  const pairs = path.join(OUT, `p${page}-pairs.txt`);
  fs.writeFileSync(pairs, lines.join("\n") + "\n");
  console.log(`${s.gaps.length} gap(s), pairs in ${pairs}`);
  const shown = flags.all ? s.gaps : s.gaps.slice(0, 60);
  shown.forEach((g, k) => console.log(`  gap ${k}: ${g.at} box ${g.box} line ${g.line}: lack ${g.want[1] - g.want[0]} (${g.wantDigits} digit), extra ${g.got[1] - g.got[0]} (${g.gotDigits} digit)`));
  if (shown.length < s.gaps.length) console.log(`  ... ${s.gaps.length - shown.length} more (--all)`);
  recipe.corrections.forEach((c, j) => {
    const note = [hits[j] ? `fired ${hits[j]}` : "idle", c.hits === undefined ? "no hits expected" : hits[j] === c.hits ? "hits ok" : `HITS MISMATCH want ${c.hits}`, spans[j] ? `${spans[j]} CROSS A LINE` : null, c.box >= recipe.read.length ? "BOX NOT READ" : null];
    console.log(`  correction ${j} box ${c.box}: ${note.filter(Boolean).join(", ")}`);
  });
  console.log(`corrections: ${recipe.corrections.length}, fired ${hits.filter(Boolean).length}, idle ${hits.filter((h) => !h).length}, hits mismatched ${recipe.corrections.filter((c, j) => c.hits !== undefined && hits[j] !== c.hits).length}`);
}

/* -------------------------------------------------------------------- show */

async function cmdShow([pageArg, boxArg, lineArg], flags) {
  const page = Number(pageArg);
  const recipe = needRecipe(page, flags.recipe);
  const { boxReads } = await boxReadsFor(page, recipe, { fresh: flags.fresh });
  const { boxText } = pictureRuns(boxReads, recipe);
  const text = boxText[Number(boxArg)];
  if (text === undefined) throw new Error(`the recipe reads boxes 0-${recipe.read.length - 1}`);
  const lines = text.split("\n");
  const from = lineArg === undefined ? 0 : Number(lineArg);
  const to = lineArg === undefined ? lines.length - 1 : Number(lineArg);
  for (let j = from; j <= to; j++) console.log(`${String(j).padStart(3)}| ${lines[j]}`);
}

/* -------------------------------------------------------------------- crop */

/** Write a PNG of an upright pixel rectangle of a page's picture and print its path. */
async function writeCrop(page, name, rect, scale, tag) {
  const { rgb, width, height } = await withPinned(async (pinned) => cropRgb((await samplesOf(pinned, page, name)).samples, rect, scale));
  const file = path.join(OUT, "crops", `p${page}-${tag}.png`);
  ensure(path.dirname(file));
  fs.writeFileSync(file, encodePng(rgb, width, height));
  console.log(`${file} (${width}x${height}, source ${rect.map((v) => Math.round(v)).join(",")} at x${scale})`);
}

async function cmdCrop([pageArg, ...rest], flags) {
  const page = Number(pageArg);
  const margin = 6;
  if (flags.box !== undefined || flags.line || flags.word) {
    const recipe = needRecipe(page, flags.recipe);
    const [b, l, w] = flags.word ?? flags.line ?? [flags.box];
    const spec = recipe.read[b];
    if (!spec) throw new Error(`the recipe reads boxes 0-${recipe.read.length - 1}`);
    if (flags.line === undefined && flags.word === undefined) {
      const [x, y, ww, hh] = sampleBox(spec.box);
      return writeCrop(page, recipe.name, [x, y, x + ww, y + hh], flags.scale ?? 2, `box${b}`);
    }
    const { boxReads, fulls } = await boxReadsFor(page, recipe, { fresh: flags.fresh });
    const read = boxReads[b];
    const raw = rawLineOf(read, l);
    if (raw < 0) throw new Error(`box ${b} read no line`);
    let bbox = fulls[b].lines[raw].bbox, tag = `box${b}-line${l}`;
    if (flags.word) {
      const words = fulls[b].lines[raw].words;
      if (!words[w]) throw new Error(`line ${l} of box ${b} has ${words.length} word(s)`);
      bbox = words[w].bbox;
      tag += `-word${w}`;
    }
    const [x0, y0, x1, y1] = toSource(read, bbox);
    return writeCrop(page, recipe.name, [x0 - margin, y0 - margin, x1 + margin, y1 + margin], flags.scale ?? 4, tag);
  }
  const rect = rest.map(Number);
  if (rect.length !== 4 || rect.some((n) => !Number.isFinite(n))) throw new Error("crop <page> <x0> <y0> <x1> <y1> | --box i | --line box line | --word box line tok");
  return writeCrop(page, await pictureNameOf(page, flags.recipe), rect, flags.scale ?? 2, rect.map(Math.round).join("-"));
}

/* -------------------------------------------------------------------- stat */

async function cmdStat([pageArg], flags) {
  const page = Number(pageArg);
  const recipe = needRecipe(page, flags.recipe);
  const { boxReads, fulls } = await boxReadsFor(page, recipe, { fresh: flags.fresh });
  const { boxText } = pictureRuns(boxReads, recipe);
  const out = [`# p.${page} stat blocks of the corrected read: box line tok figure bbox(source samples)`];
  let blocks = 0, figures = 0;
  boxText.forEach((text, b) => {
    const lines = text.split("\n");
    for (const span of statBlocks(lines)) {
      blocks++;
      const head = `block ${blocks}: box ${b} lines ${span.from}-${span.to}`;
      console.log(head);
      out.push(head);
      for (let j = span.from; j <= span.to; j++) {
        const words = lines[j].split(/\s+/).filter(Boolean);
        const read = boxReads[b];
        const raw = rawLineOf(read, j);
        const rawWords = raw >= 0 ? fulls[b].lines[raw].words : [];
        const exact = rawWords.length === words.length;
        const lineBox = raw >= 0 ? toSource(read, fulls[b].lines[raw].bbox) : null;
        const figs = words.map((w, k) => ({ w, k })).filter((x) => /\d/.test(x.w));
        console.log(`  line ${j}: keys ${statKeysOf(lines[j]).size}, figures ${figs.length}${exact ? "" : ", word boxes unmatched (the line's box stands in)"}`);
        for (const { w, k } of figs) {
          const bb = (exact ? toSource(read, rawWords[k].bbox) : lineBox)?.map((v) => round1(v));
          figures++;
          console.log(`    fig box ${b} line ${j} tok ${k}: bbox ${bb?.join(",")}${exact ? "" : " (line)"}`);
          out.push(`${b} ${j} ${k} ${w} ${bb?.join(",")}${exact ? "" : " (line)"}`);
        }
      }
    }
  });
  ensure(OUT);
  const file = path.join(OUT, `p${page}-stat.txt`);
  fs.writeFileSync(file, out.join("\n") + "\n");
  console.log(`${blocks} stat block(s), ${figures} figure token(s); figures and bboxes in ${file}`);
}

/* -------------------------------------------------------------------- pins */

/**
 * The placement of a named picture on a page, walked from the operator list:
 * the painting matrix carried into the page's top-left-origin points, the
 * picture's size, and how many times the page paints that name. Form XObjects
 * apply their own matrix as the canvas does.
 */
async function placementOf(pdfPage, name) {
  const vp = pdfPage.getViewport({ scale: 1 });
  const ops = await pdfPage.getOperatorList();
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let found = null, paints = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mulMatrix(ctm, ops.argsArray[i]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (ops.argsArray[i][0]) ctm = mulMatrix(ctm, ops.argsArray[i][0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject && ops.argsArray[i][0] === name) {
      paints++;
      found ??= mulMatrix(vp.transform, ctm);
    }
  }
  return { top: found, paints, view: pdfPage.view, rotate: pdfPage.rotate };
}

async function cmdPins([pageArg, ...rest], flags) {
  const page = Number(pageArg);
  const name = await pictureNameOf(page, flags.recipe);
  await withPinned(async (pinned) => {
    const { pdfPage, samples } = await samplesOf(pinned, page, name);
    const { top, paints, view, rotate } = await placementOf(pdfPage, name);
    if (!top) throw new Error(`p.${page} paints no picture named ${name}`);
    const { width: W, height: H } = samples;
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => pixelToPoint(top, W, H, x, y));
    const rect = { x: Math.min(...corners.map((c) => c[0])), y: Math.min(...corners.map((c) => c[1])), w: 0, h: 0 };
    rect.w = Math.max(...corners.map((c) => c[0])) - rect.x;
    rect.h = Math.max(...corners.map((c) => c[1])) - rect.y;
    const turn = turnOf(top, W, H);
    console.log(`p.${page} ${name} ${W}x${H} samples; page view [${view.join(" ")}], rotate ${rotate}, painted ${paints}x`);
    console.log(`placement (page points, top-left origin): x ${rect.x.toFixed(2)} y ${rect.y.toFixed(2)} w ${rect.w.toFixed(2)} h ${rect.h.toFixed(2)}; matrix [${top.map((v) => +v.toFixed(5)).join(" ")}]`);
    console.log(`turn to stand the picture upright (kind.scene recipe "turn", counter-clockwise quarter turns): ${turn ?? "none (mirrored or skewed)"}`);
    // The placement against the module's own: a walk that disagrees names the page.
    const art = (await pageArtPlacements(pinned, page)).find((p) => p.name === name);
    const agree = art && [art.x - rect.x, art.y - rect.y, art.w - rect.w, art.h - rect.h].every((d) => Math.abs(d) < 0.01);
    console.log(`bounds against pageArtPlacements: ${agree ? "agree" : "DISAGREE"}`);
    // Round trip, and the scene frame's own turn over the same points.
    const grid = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) grid.push([(W * i) / 8, (H * j) / 8]);
    const trip = Math.max(...grid.map(([x, y]) => Math.hypot(...pointToPixel(top, W, H, ...pixelToPoint(top, W, H, x, y)).map((v, k) => v - [x, y][k]))));
    console.log(`round trip pixel -> point -> pixel over ${grid.length} points: max error ${trip.toExponential(1)} px`);
    if (turn !== null) {
      const sideways = turn % 2 === 1;
      const frame = sceneFrame({ crop: rect, turn }, { pixelsPerPoint: W / (sideways ? rect.h : rect.w) });
      const err = Math.max(...grid.map(([x, y]) => {
        const s = frame.toScene(...pixelToPoint(top, W, H, x, y));
        return Math.hypot(s[0] - x, s[1] - y);
      }));
      console.log(`sceneFrame (crop = the placement, turn ${turn}) against the pixel: max error ${err.toFixed(2)} px over ${grid.length} points; frame ${frame.width}x${frame.height}`);
    }
    if (flags.pt) {
      const [x, y] = pointToPixel(top, W, H, ...flags.pt);
      console.log(`point ${flags.pt.join(",")} -> pixel ${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (flags.rect) {
      const r = pixelRectToPage(top, W, H, flags.rect);
      console.log(`pixel rect ${flags.rect.join(",")} -> crop {"x": ${r.x.toFixed(2)}, "y": ${r.y.toFixed(2)}, "w": ${r.w.toFixed(2)}, "h": ${r.h.toFixed(2)}}, "turn": ${turn}`);
    }
    const pairs = rest.map(Number);
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const [x, y] = pixelToPoint(top, W, H, pairs[i], pairs[i + 1]);
      console.log(`pixel ${pairs[i]},${pairs[i + 1]} -> point [${x.toFixed(2)}, ${y.toFixed(2)}]`);
    }
  });
}

/* -------------------------------------------------------------------- main */

/** Flags that take values, by the number of words they take. */
const FLAG_ARITY = { recipe: 1, scale: 1, box: 1, line: 2, word: 3, pt: 2, rect: 4, fresh: 0, all: 0, tall: 1 };

/** Split an argument list into positionals and flags (`--box 2`, `--line 2 5`, …). */
export function parseArgs(argv) {
  const positional = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      positional.push(argv[i]);
      continue;
    }
    const key = argv[i].slice(2);
    if (!(key in FLAG_ARITY)) throw new Error(`unknown flag ${argv[i]}`);
    const n = FLAG_ARITY[key];
    const vals = argv.slice(i + 1, i + 1 + n);
    if (vals.length < n) throw new Error(`--${key} takes ${n} value(s)`);
    i += n;
    flags[key] = n === 0 ? true : key === "recipe" ? vals[0] : n === 1 ? Number(vals[0]) : vals.map(Number);
  }
  return { positional, flags };
}

const COMMANDS = {
  hashes: cmdHashes,
  whole: cmdWhole,
  propose: cmdPropose,
  score: cmdScore,
  show: cmdShow,
  crop: cmdCrop,
  stat: cmdStat,
  pins: cmdPins,
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = COMMANDS[cmd];
  if (!run) {
    console.error(`usage: ocr-kit.mjs <${Object.keys(COMMANDS).join("|")}> … (see the file header)`);
    process.exit(2);
  }
  const { positional, flags } = parseArgs(rest);
  if (cmd !== "hashes" && !(Number(positional[0]) >= FIRST_PAGE)) throw new Error(`${cmd} takes a page number (${FIRST_PAGE}-${FIRST_PAGE + 8}) first`);
  await run(positional, flags);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
