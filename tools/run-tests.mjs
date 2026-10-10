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
 *
 * The importer subsystem's own suites live in `tools/importer/`; their names
 * below carry that prefix. The Discord service's suites live in
 * `discord/test/`, beside the service they check, and run from here too, so
 * one `npm test` covers the repo. They resolve `discord.js` from the root's
 * own devDependencies: CI installs only the root package, never
 * `discord/node_modules`, so a suite that needs the bot's dependency needs it
 * declared here too.
 *
 * The suites run side by side (`side-by-side.mjs`), each a process of its
 * own, and their output is shown in the order below. Every suite runs to its
 * end, and the ones that failed are named after the last.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sideBySide } from "./side-by-side.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Suites that assert only what this repo's own code does. */
const COMMITTED = [
  "test-side-by-side.mjs",
  "test-lib.mjs",
  "test-window-title.mjs",
  "test-magic.mjs",
  "test-repair.mjs",
  "test-repair-checks.mjs",
  "test-hp.mjs",
  "test-battlemap.mjs",
  "test-equipment.mjs",
  "test-item-sheet.mjs",
  "test-character-sheet.mjs",
  "test-bridge.mjs",
  "test-formation-flows.mjs",
  "test-formation-heading.mjs",
  "test-marching-templates.mjs",
  "test-trap-rules.mjs",
  "test-wall-geometry.mjs",
  "test-wall-layers.mjs",
  "test-variations.mjs",
  "test-influence.mjs",
  "test-classes.mjs",
  "test-companions.mjs",
  "test-henchmen.mjs",
  "test-markets.mjs",
  "test-merchandise.mjs",
  "test-manifest.mjs",
  "test-trade.mjs",
  "test-reports.mjs",
  "test-capacity.mjs",
  "test-mount.mjs",
  "test-money.mjs",
  "test-coin-flows.mjs",
  "test-languages.mjs",
  "test-xp-shares.mjs",
  "test-xp-bonus.mjs",
  "test-legacy.mjs",
  "test-table-docs.mjs",
  "test-judge-shelf.mjs",
  "test-vehicles.mjs",
  "test-travel.mjs",
  "test-march.mjs",
  "test-journey.mjs",
  "test-strip.mjs",
  "test-weather.mjs",
  "test-weather-effects.mjs",
  "test-encounters.mjs",
  "test-hex-stock.mjs",
  "test-hex-stock-run.mjs",
  "test-search-run.mjs",
  "test-settlement.mjs",
  "test-poi.mjs",
  "test-factions.mjs",
  "test-lost.mjs",
  "test-sky.mjs",
  "test-flight.mjs",
  "test-movement-modes.mjs",
  "test-survival.mjs",
  "test-fatigue.mjs",
  "test-rest.mjs",
  "test-conditions.mjs",
  "test-adventuring-roll.mjs",
  "test-provisions.mjs",
  "test-foraging.mjs",
  "test-searching.mjs",
  "test-hex-topology.mjs",
  "test-location-reach.mjs",
  "importer/test-prose.mjs",
  "importer/test-book-match.mjs",
  "importer/test-executor.mjs",
  "importer/test-hit-dice.mjs",
  "importer/test-equipment-binding.mjs",
  "importer/test-weapon-tables.mjs",
  "importer/test-armor-tables.mjs",
  "importer/test-gear-prices.mjs",
  "importer/test-ability-names.mjs",
  "importer/test-starting-equipment.mjs",
  "importer/test-hitpoint-tables.mjs",
  "importer/test-class-builder-tables.mjs",
  "importer/test-recipe-pages.mjs",
  "importer/test-recipe-content.mjs",
  "importer/test-class-tongues.mjs",
  "importer/test-class-training.mjs",
  "importer/test-trap-tiers.mjs",
  "importer/test-variations.mjs",
  "importer/test-vehicles.mjs",
  "importer/test-travel-tables.mjs",
  "importer/test-weather-tables.mjs",
  "importer/test-encounter-tables.mjs",
  "importer/test-grid-rows.mjs",
  "importer/test-voyage-tables.mjs",
  "importer/test-land-tables.mjs",
  "importer/test-business-binding.mjs",
  "importer/test-prose-values.mjs",
  "importer/test-produces.mjs",
  "importer/test-conditions-binding.mjs",
  "importer/test-mount-flags.mjs",
  "importer/test-item-shelves.mjs",
  "importer/test-imported-index.mjs",
  "importer/test-cookbook-coherence.mjs",
  "importer/test-printed-name.mjs",
  "importer/test-poi-binding.mjs",
  "importer/test-market-profiles.mjs",
  "importer/test-faction-binding.mjs",
  "importer/test-strength-grid.mjs",
  "importer/test-scene-binding.mjs",
  "importer/test-settlement-adventure.mjs",
  "importer/test-region-import.mjs",
  "importer/test-refresh.mjs",
  "../discord/test/config.test.mjs",
  "../discord/test/format.test.mjs",
  "../discord/test/seat.test.mjs",
  "../discord/test/update-watch.test.mjs",
  "../discord/test/register.test.mjs",
  "../discord/test/install.test.mjs",
];

const RULES_DIR = path.join(HERE, "rules-tests");

const committed = COMMITTED.map((suite) => {
  const p = path.join(HERE, suite);
  if (!fs.existsSync(p)) throw new Error(`run-tests: committed suite missing — ${suite}`);
  return p;
});
const rules = fs.existsSync(RULES_DIR)
  ? fs.readdirSync(RULES_DIR).sort().filter((f) => f.endsWith(".mjs")).map((f) => path.join(RULES_DIR, f))
  : [];
const ran = committed.length;
const local = rules.length;

const failed = (await sideBySide([...committed, ...rules].map((p) => [p]))).filter((suite) => suite.status !== 0);
if (failed.length) {
  console.error(`\nrun-tests: ${failed.length} suite(s) FAILED\n${failed.map((suite) => `  ${path.relative(HERE, suite.args[0])}`).join("\n")}`);
  process.exit(1);
}

console.log(
  `\nrun-tests: ${ran} committed suite(s)` +
    (local ? `, ${local} rules test(s) from this machine's own books` : ", no rules tests on this machine (gitignored, expected on a fresh checkout)"),
);
