/**
 * DEV-ONLY (chef-side): author the SCG conversion-constant recipes.
 *
 * The System Compatibility Guide prints the arithmetic that turns a foreign
 * OSR stat block into ACKS II values. The RULE is structural and ships in
 * scripts/ose-convert.mjs — which lineage inverts about a constant, which
 * bonus subtracts from which throw. The CONSTANTS are printed values, so they
 * are read from the reader's own copy at run time, exactly as
 * formation/jumping.mjs takes its printed numbers as arguments.
 *
 * This tool therefore emits GEOMETRY and ANCHORS, never numbers. It prints the
 * value each box currently reads so a chef can confirm the box is aimed at the
 * right clause; that readout is console-only and is never written to disk.
 *
 * Anchors are chosen to carry no digit: the AC pair anchors on the list of
 * game systems the rule applies to, the throw pair on the clause that names
 * the conversion. A printing that moves the text fails the anchor and the
 * entry degrades to a stub instead of reading a wrong integer out of a
 * neighbouring sentence.
 *
 * Requires the LOCAL-ONLY reference PDF. Usage:
 *   node tools/harvest-scg-constants.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { runsIn, joinRuns } from "../../scripts/importer/executor.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "..", "register", "scg", "p6-conversion.json");
const PAGE = 6; // printed page 2

/**
 * One row per constant: the clause that names the conversion (anchor) and the
 * clause that carries the number (value). Boxes are half-open on x so the
 * facing column never bleeds in — page 6 sets two columns at x≈45 and x≈301.
 */
const CONSTANTS = [
  {
    id: "def.constant.acDescending",
    name: "Descending AC baseline",
    anchor: { x0: 60, x1: 178, y0: 402, y1: 410 },
    value: { x0: 178, x1: 265, y0: 402, y1: 410 },
  },
  {
    id: "def.constant.acAscending",
    name: "Ascending AC offset",
    anchor: { x0: 60, x1: 169, y0: 412, y1: 420 },
    value: { x0: 169, x1: 265, y0: 412, y1: 420 },
  },
  {
    id: "def.constant.attackThrow",
    name: "Attack throw baseline",
    anchor: { x0: 315, x1: 432, y0: 662, y1: 670 },
    value: { x0: 456, x1: 530, y0: 662, y1: 670 },
  },
  {
    id: "def.constant.saveThrow",
    name: "Saving throw baseline",
    anchor: { x0: 315, x1: 421, y0: 682, y1: 690 },
    value: { x0: 315, x1: 400, y0: 692, y1: 700 },
  },
];

const joined = (pageData, box) => joinRuns(runsIn(pageData, { box }));
const firstInt = (s) => {
  const m = /(-?[\d,]+)/.exec(s);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
};

const { doc } = await openBook(fs.readFileSync(FILES.scg));
const pageData = await pageItems(doc, PAGE);

const entries = [];
for (const c of CONSTANTS) {
  const anchorText = joined(pageData, c.anchor);
  const valueText = joined(pageData, c.value);
  // Console-only confirmation that the box is aimed at the right clause.
  console.error(`${c.id}\n  anchor: ${JSON.stringify(anchorText)}\n  value:  ${JSON.stringify(valueText)} -> ${firstInt(valueText)}`);
  if (!anchorText) {
    console.error(`  !! empty anchor — box misses the page; not emitting`);
    continue;
  }
  if (firstInt(valueText) === null) {
    console.error(`  !! value box reads no integer; not emitting`);
    continue;
  }
  entries.push({
    id: c.id,
    kind: "kind.constant",
    book: "scg",
    name: c.name,
    pages: [PAGE],
    meta: { category: "constant" },
    assists: {
      // The anchor is an `expect`; the value is an `int` read of the clause.
      expect: { page: PAGE, box: c.anchor, text: anchorText },
      value: { page: PAGE, box: c.value },
    },
  });
}

if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");
  console.error(`wrote ${OUT} (${entries.length} entries)`);
} else {
  console.error(`\n(dry run — pass --write to emit ${entries.length} entries)`);
}
