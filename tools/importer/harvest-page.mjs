/**
 * DEV-ONLY harvest harness: given a book id and page range, emit a STRUCTURAL
 * report per page using the SHIPPING extraction engine (scripts/extract.mjs).
 * This is the read-side of the Opus/Sonnet recipe-authoring pipeline: a fleet
 * worker runs this over its assigned pages, then authors recipe pointers +
 * overrides from the report (never re-implementing pdf.js).
 *
 * IP posture (identical to tools/dev-extract-check.mjs): the report is a
 * DIAGNOSTIC for the authoring agent, never shipped. It contains headings
 * (labels), coordinates, fonts, resolve booleans, word counts, <=40-char
 * opening snippets, short stat label/value pairs, art dimensions and spoils
 * presence. It NEVER dumps passages. Recipes authored from it store pointers
 * and overrides only — no prose.
 *
 * Requires the LOCAL-ONLY reference PDFs at C:\Proj\acks-reference — never CI.
 *
 * Usage:
 *   node tools/harvest-page.mjs <book> <pageStart> [pageEnd]
 *   node tools/harvest-page.mjs mm 170 179
 *   node tools/harvest-page.mjs mm 171            # single page
 * Output: JSON array of page reports to stdout (parseable by an agent).
 */
import fs from "node:fs";
import {
  openBook,
  pageItems,
  listHeadings,
  extractDisplay,
  extractRunin,
  extractSpoils,
  pageArtInfo,
  pickArt,
} from "../../scripts/importer/extract.mjs";
import { extractStatPairs } from "../../scripts/importer/stats.mjs";
import { BOOKS, fingerprintWarning } from "../../scripts/importer/books.mjs";

import { FILES } from "./reference-lib.mjs";

// Monster stat-block labels that reliably mark an MM stat page (a page with
// several of these is a monster entry; body-only pages have ~none).
const MONSTER_LABELS = [
  "Armor Class", "Hit Dice", "Save", "Morale", "XP", "Alignment",
  "Treasure Type", "Attacks", "Damage", "Type", "Size",
];

const snippet = (s) => (s ? JSON.stringify(s.slice(0, 40)) : null);
const words = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

async function reportPage(doc, page) {
  const pd = await pageItems(doc, page);
  const anchors = listHeadings(pd);

  // Resolve-check each anchor through the shipping extractor so the agent knows
  // which entries already work and which need an override.
  const displays = [];
  const runins = [];
  for (const a of anchors) {
    const prose =
      a.mode === "display" ? extractDisplay(pd, a.text) : extractRunin(pd, a.text.replace(/:\s*$/, ":"));
    const rec = {
      heading: a.text,
      mode: a.mode,
      col: a.col,
      y: Math.round(a.y),
      resolves: !!prose,
      words: words(prose),
      snippet: snippet(prose),
    };
    (a.mode === "display" ? displays : runins).push(rec);
  }

  // Monster classification (numbers/labels only — safe to surface).
  const statPairs = extractStatPairs(pd);
  const known = statPairs.filter((p) => MONSTER_LABELS.some((l) => l.toLowerCase() === p.label.toLowerCase()));
  const isMonsterPage = known.length >= 4;

  const spoils = extractSpoils(pd);
  // Art extraction is the slow step (Node's fake worker can stall ~3s/image);
  // HARVEST_NO_ART=1 skips it for fast structural scans over wide ranges.
  const art = process.env.HARVEST_NO_ART ? null : pickArt(await pageArtInfo(doc, page).catch(() => []));

  return {
    book: doc._acksBookId,
    page,
    isMonsterPage,
    displays,
    runins,
    statLabels: isMonsterPage ? statPairs.map((p) => p.label) : [],
    spoilsCount: spoils.length,
    spoilsNames: spoils.map((s) => s.name),
    art: art ? { name: art.name, w: art.width, h: art.height, kind: art.kind } : null,
  };
}

async function main() {
  const [book, startArg, endArg] = process.argv.slice(2);
  if (!book || !startArg) {
    console.error("usage: node tools/harvest-page.mjs <book> <pageStart> [pageEnd]");
    process.exit(2);
  }
  const file = FILES[book];
  if (!file || !fs.existsSync(file)) {
    console.error(`no local PDF for book "${book}" (expected ${file})`);
    process.exit(2);
  }
  const start = parseInt(startArg, 10);
  const end = endArg ? parseInt(endArg, 10) : start;

  const { doc, numPages, title } = await openBook(fs.readFileSync(file));
  doc._acksBookId = book;
  const warn = fingerprintWarning(book, numPages, title);
  if (warn) console.error(`WARN ${warn}`);

  const reports = [];
  for (let p = start; p <= Math.min(end, numPages); p++) {
    reports.push(await reportPage(doc, p));
  }
  process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
