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
 * without them runs the committed half and says how many it skipped. `--rules`
 * turns that skip into a failure: it is the working-tree run (`npm run
 * test:tree`) and refuses to pass when `tools/rules-tests/` is absent or holds
 * no suite. The commit gate runs `npm test` in a clean clone, where the rules
 * tests cannot exist, so it never passes the flag.
 *
 * ## Discovery
 *
 * A committed suite is found, never listed: `tools/test-*.mjs`,
 * `tools/importer/test-*.mjs` and `discord/test/*.test.mjs`. A new suite that
 * matches runs with no edit here. A file that matches and is not a suite goes
 * on `EXCLUDED`, each entry named in full with its reason, and an entry whose
 * file is gone throws, so the list cannot rot into names that match nothing.
 *
 * The Discord service's suites live beside the service they check and run from
 * here too, so one `npm test` covers the repo. They resolve `discord.js` from
 * the root's own devDependencies: CI installs only the root package, never
 * `discord/node_modules`, so a suite that needs the bot's dependency needs it
 * declared here too.
 *
 * The suites run side by side (`side-by-side.mjs`), each a process of its
 * own, and their output is shown in sorted order: `tools/`, then
 * `tools/importer/`, then `discord/test/`, each by file name. Every suite runs
 * to its end, and the ones that failed are named after the last.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sideBySide } from "./side-by-side.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where committed suites live, as a directory (relative to `tools/`) and the file-name test. */
const SUITE_GLOBS = [
  { dir: ".", match: /^test-.*\.mjs$/ },
  { dir: "importer", match: /^test-.*\.mjs$/ },
  { dir: "../discord/test", match: /\.test\.mjs$/ },
];

/**
 * Files a glob finds that this runner must not run, relative to `tools/`, each
 * with its reason. Every entry must exist.
 */
const EXCLUDED = new Map([
  // The OSE gates are run by `importer/validate-extra.mjs` (§5 of
  // `validate-extra.mjs`) as part of `npm run validate`; running them here too
  // would do the same work twice per gate.
  ...[
    "binding", "blocks", "convert", "lang", "location", "manual", "statline", "template",
  ].map((name) => [`importer/test-ose-${name}.mjs`, "run by importer/validate-extra.mjs"]),
]);

for (const file of EXCLUDED.keys()) {
  if (!fs.existsSync(path.join(HERE, file))) throw new Error(`run-tests: excluded suite missing — ${file}`);
}

/** Every committed suite the globs find and `EXCLUDED` does not name, as absolute paths. */
function discover() {
  const found = [];
  for (const { dir, match } of SUITE_GLOBS) {
    const abs = path.join(HERE, dir);
    if (!fs.existsSync(abs)) throw new Error(`run-tests: suite directory missing — ${dir}`);
    const names = fs.readdirSync(abs).filter((f) => match.test(f)).sort();
    for (const f of names) {
      const rel = path.posix.normalize(path.posix.join(dir.split(path.sep).join("/"), f));
      if (!EXCLUDED.has(rel)) found.push(path.join(abs, f));
    }
  }
  return found;
}

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--rules");
if (unknown.length) {
  console.error(`run-tests: unknown argument(s) ${unknown.join(" ")} — the only flag is --rules`);
  process.exit(2);
}
const requireRules = args.includes("--rules");

const RULES_DIR = path.join(HERE, "rules-tests");

const committed = discover();
if (!committed.length) throw new Error("run-tests: no committed suites found");
const rules = fs.existsSync(RULES_DIR)
  ? fs.readdirSync(RULES_DIR).sort().filter((f) => f.endsWith(".mjs")).map((f) => path.join(RULES_DIR, f))
  : [];
if (requireRules && !rules.length) {
  console.error("run-tests: --rules needs this machine's rules tests, and tools/rules-tests/ is absent or holds no .mjs suite");
  process.exit(1);
}
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
