/**
 * The test runner, in two halves.
 *
 * **Committed suites** check this module's own logic: that a share is divided
 * the way the code says, that a guard refuses what it claims to refuse, that a
 * derivation applies its factor once rather than twice. They assert behaviour
 * the repo owns, so they ship.
 *
 * **Rules tests** live in `tools/rules-tests/`, which is GITIGNORED, because
 * asserting a printed table reproduces it. A test reading
 * `assert.equal(dexBonus(13), 1)` twelve times is the attribute table with
 * different punctuation, and the family's rule is that no value read off a page
 * ships in any repo — a test file is not an exemption from that, it is the
 * easiest place to forget it.
 *
 * They are still worth writing and worth running: checking a derivation against
 * the book's own worked example is how a rule gets read correctly rather than
 * guessed at. They just stay on the machine that owns the books. A checkout
 * without them runs the committed half and says how many it skipped.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Suites that assert only what this repo's own code does. */
const COMMITTED = [
  "test-lib.mjs",
  "test-battlemap.mjs",
  "test-equipment.mjs",
  "test-item-sheet.mjs",
  "test-formation-flows.mjs",
  "test-formation-heading.mjs",
  "test-marching-templates.mjs",
  "test-trap-rules.mjs",
  "test-variations.mjs",
  "test-influence.mjs",
  "test-classes.mjs",
  "test-henchmen.mjs",
  "test-markets.mjs",
  "test-capacity.mjs",
  "test-money.mjs",
  "test-languages.mjs",
  "test-xp-shares.mjs",
  "test-table-docs.mjs",
  "test-vehicles.mjs",
  "test-travel.mjs",
];

const RULES_DIR = path.join(HERE, "rules-tests");

let ran = 0;
for (const suite of COMMITTED) {
  const p = path.join(HERE, suite);
  if (!fs.existsSync(p)) throw new Error(`run-tests: committed suite missing — ${suite}`);
  execFileSync(process.execPath, [p], { stdio: "inherit" });
  ran++;
}

let local = 0;
if (fs.existsSync(RULES_DIR)) {
  for (const f of fs.readdirSync(RULES_DIR).sort()) {
    if (!f.endsWith(".mjs")) continue;
    execFileSync(process.execPath, [path.join(RULES_DIR, f)], { stdio: "inherit" });
    local++;
  }
}

console.log(
  `\nrun-tests: ${ran} committed suite(s)` +
    (local ? `, ${local} rules test(s) from this machine's own books` : ", no rules tests on this machine (gitignored, expected on a fresh checkout)"),
);
