/**
 * Starts the canonical release preflight in throwaway repositories and checks
 * its exit status and what it names. Each case is a module tagged v11.14.5
 * (and any tags the case adds) with its version bumped in the working tree,
 * the way a release is prepared. The default bump is the run day's date, which
 * the version checks accept; the cases that name another version, and the tags
 * beside it, decide the date and order checks.
 *
 * One release path: `--kind` is refused, a changed surface with no recipe is a
 * note, and a shot or no-shot comment in a changelog is ignored.
 *
 * The changelog-compiled cases stage fragments and a runtime file under
 * `changelog.d/` and `lang/`. A case may name `base` files committed at the
 * tag, `work` files written after it, `stage` paths to `git add`, and a
 * `setup` hook that edits the tree before the preflight runs. The `--at` cases
 * set `commit`, which lands the prepared tree as one commit (`@sha` in `args`
 * names it), then an `after` hook that edits the working tree alone, so a run
 * without `--at` and a run with it, listed under `also`, judge the same
 * repository from the two sources and may differ. The live-walks cases give a
 * fixture a runner and the smoke walk, record the smoke walk's attempt through
 * `walk-results.mjs` against the tree the case stands in (in `after`, so a
 * case can edit the tree once the result exists), and break one thing: a
 * missing, tracked or unreadable result file, an older runtime tree, an edited
 * walk, a partial or unclassified result, a defect on a claimed row. The tree
 * id itself is `test-walk-results`' to check, not this file's.
 *
 * The preflight finds its repository from where it stands, so each case
 * copies it, `walk-results.mjs` (from beside the preflight under test) and
 * `logs.mjs` into the case's own `tools/` and starts it there.
 *
 * Usage:  node tools/toolchain-tests/test-release-preflight.mjs [<release-preflight.mjs>]
 *         (defaults to tools/release-preflight.mjs; pass a modified
 *         copy to confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { RESULT_PATH, recordAttempt, recordClassification, runtimeTree, walkBlob } from "../walk-results.mjs";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const PREFLIGHT = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "tools", "release-preflight.mjs"));
// `compile` prepares the fixtures the changelog-compiled cases read.
const LOGS = path.join(TEMPLATE_ROOT, "tools", "logs.mjs");
// The preflight imports it from beside itself, so a copy under test brings its own.
const WALK_RESULTS = path.join(path.dirname(PREFLIGHT), "walk-results.mjs");

// A caller's own repository variables would turn every git call toward the
// caller's repository, and a runner has no identity to commit as.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (root, args) => execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
/** Commits the whole working tree and returns the new commit's sha. */
const commitAll = (root, message) => {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
};

// The run day and its neighbours, from the local getters the preflight reads,
// so a case's expected version is the one the preflight computes.
const NOW = new Date();
const dayOf = (date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
const TODAY = dayOf(NOW);
const TOMORROW = dayOf(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1));
const LAST_YEAR = NOW.getFullYear() - 1;
const esc = (s) => s.replaceAll(".", "\\.");
const TODAY_RE = esc(TODAY);

// Every entry and slug below is invented.
/** A section whose Added bullets carry no marker of any kind. */
const NO_MARKER = `# Changelog

## ${TODAY} — Public Beta

### Added

- **A sheet gains a tab.** The tab lists what the sheet holds.

### Changed

- **The api returns a promise.** Nothing on screen.

## 11.14.5

### Added

- **The first entry.** An earlier release's.
`;
/** The same section with markers: a shot naming a file nobody took, a path, and a no-shot with no reason. */
const MARKED = NO_MARKER.replace("The tab lists what the sheet holds.", "The tab lists what the sheet holds.\n  <!-- shot: widget-sheet-tab --> <!-- shot: ../v11.14.5/old.png -->").replace("Nothing on screen.", "<!-- no-shot: -->");

// The changelog-compiled cases.
const ISO_TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}-${String(NOW.getDate()).padStart(2, "0")}`;
const LOG_BASE_CHANGELOG = "# Changelog\n\nPreamble.\n\n## 11.14.5\n\n- **Five.** Shipped at the tag.\n";
const FRAGMENT = `changelog.d/${ISO_TODAY}-widget-fix.fixed.md`;
/** A case with a runtime file changed and a fragment staged, compiled or not. */
const fragmentCase = (name, { compile = false, ...rest }) => ({
  name,
  args: [],
  base: { "CHANGELOG.md": LOG_BASE_CHANGELOG },
  work: { "lang/en.json": "{}\n", [FRAGMENT]: "- **A fix.** Nothing owed.\n" },
  stage: [FRAGMENT],
  setup: (ctx) => {
    if (compile) ctx.logs("compile");
  },
  ...rest,
});

// The live-walks cases. A fixture with a runner, the smoke walk and two other
// walks (and a `_` helper, which is not one) keeps `aia-tmp/` ignored as a real
// module does; a case records the smoke walk's attempt against the tree it
// stands in, through the same `walk-results.mjs` the runner uses, and then
// breaks one thing.
const SMOKE = "window-contract";
const WALK_BASE = {
  ".gitignore": "aia-tmp/\n",
  "lang/en.json": "{\n  \"a\": 1\n}\n",
  "docs/foo/TESTING.md": "# Foo\n\nWalked by hand.\n",
  "tools/live/run.mjs": "export {};\n",
  "tools/live/_helper.mjs": "export {};\n",
  "tools/live/alpha.mjs": "export {};\n// alpha\n",
  "tools/live/beta.mjs": "export {};\n// beta\n",
};
const WALKS = { ...WALK_BASE, [`tools/live/${SMOKE}.mjs`]: "export {};\n// smoke\n" };
const NONE = "0".repeat(40);
const T_ROW = "T-1234";
/** Records an attempt of walk `name` in the case's repository, passed on the tree it stands in unless `over` says otherwise. */
function record(ctx, name, over = {}) {
  const tree = runtimeTree(ctx.root).tree;
  recordAttempt(ctx.root, name, {
    state: "passed",
    tally: { pass: 3, fail: 0, gap: 0 },
    exit: 0,
    signal: null,
    treeStart: tree,
    treeEnd: tree,
    walkBlob: walkBlob(ctx.root, name),
    partial: false,
    startedAt: "2099-11-12T10:00:00.000Z",
    endedAt: "2099-11-12T10:05:00.000Z",
    ...over,
  });
}
/** Records the smoke walk passed, then runs `more`. */
const smokePassed = (more) => (ctx) => {
  record(ctx, SMOKE);
  more?.(ctx);
};
/** A failed attempt of the smoke walk classified as `as` on a row in `status`. */
const smokeFailed = (as, status, version = TODAY) => (ctx) => {
  record(ctx, SMOKE, { state: "failed", tally: { pass: 2, fail: 1, gap: 0 }, exit: 1 });
  if (as) recordClassification(ctx.root, SMOKE, { row: T_ROW, as, status, version });
};
const FIXED_LOG = `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n`;
/** A case in a fixture that has a runner and the smoke walk. */
const walkCase = (name, rest) => ({ name, args: [], base: WALKS, changelog: FIXED_LOG, status: 0, ...rest });
const ONE_BLOCKER = /release-preflight: 1 blocker\(s\)/u;
const RESULT_RE = RESULT_PATH.replaceAll(".", "\\.");
const SMOKE_PENDING = new RegExp(`walks to run in the live session:\\n {2}${SMOKE} {2}not run\\n`, "u");

const CASES = [
  // -- one release path ---------------------------------------------------------
  {
    name: "an Added bullet with no shot marker is clear",
    args: [],
    changelog: NO_MARKER,
    status: 0,
    out: [new RegExp(`release-preflight: v${TODAY_RE} clear\\.`, "u")],
    notOut: [/shot/u],
    notErr: [/shot/u],
  },
  {
    name: "shot and no-shot comments are ignored, whatever they name and whether or not a file exists",
    args: [],
    changelog: MARKED,
    status: 0,
    out: [/clear\./u],
    notOut: [/shot/u],
    notErr: [/shot/u],
  },
  {
    name: "--kind is refused in one line that says release kinds are retired",
    args: ["--kind", "minor"],
    changelog: NO_MARKER,
    status: 1,
    err: [/^release-preflight: release kinds are retired[^\n]*--kind[^\n]*\n?$/u],
    notOut: [/clear/u],
  },
  {
    name: "--kind with no value, or written --kind=major, is refused the same way",
    args: ["--kind"],
    status: 1,
    err: [/^release-preflight: release kinds are retired[^\n]*--kind[^\n]*\n?$/u],
    also: [{ args: ["--kind=major"], status: 1, err: [/^release-preflight: release kinds are retired/u] }],
  },
  {
    name: "a surface with no recipe is a note and the run is clear",
    args: [],
    changelog: FIXED_LOG,
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    status: 0,
    out: [/note: scripts\/gadget\/ changed since v11\.14\.5 and docs\/gadget\/TESTING\.md does not exist/u, /clear\./u],
    notErr: [/FAIL/u],
  },
  {
    name: "files directly under scripts/ with no docs/TESTING.md are a note too",
    args: [],
    changelog: FIXED_LOG,
    work: { "scripts/module.mjs": "export {};\n" },
    status: 0,
    out: [/note: scripts\/ changed since v11\.14\.5 and docs\/TESTING\.md does not exist/u, /clear\./u],
  },
  {
    name: "a surface with a recipe lists it to walk",
    args: [],
    changelog: FIXED_LOG,
    base: { "docs/gadget/TESTING.md": "# Gadget\n" },
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    status: 0,
    out: [/recipes to walk in the live session:\n {2}docs\/gadget\/TESTING\.md\n/u],
    notOut: [/does not exist/u],
  },
  {
    name: "the recipes are not read for walk names: a named file that is no walk, and a recipe naming none, pass without a note",
    args: [],
    changelog: FIXED_LOG,
    base: { ...WALKS, "docs/gadget/TESTING.md": "# Gadget\n\nWalk tools/live/alpha.mjs and tools/live/ghost.mjs.\n", "docs/other/TESTING.md": "# Other\n\nWalked by hand.\n" },
    work: { "scripts/gadget/run.mjs": "export {};\n", "scripts/other/run.mjs": "export {};\n" },
    after: smokePassed(),
    status: 0,
    out: [/clear\./u],
    notOut: [/names no walk/u, /ghost/u],
    notErr: [/not a walk/u],
  },
  {
    name: "the logs are not read: an unrolled CHANGELOG and DECISIONS and an unlinked release folder do not stop a release",
    args: [],
    base: {
      "CHANGELOG.md": LOG_BASE_CHANGELOG,
      "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — First\n\nBody.\n",
      "docs/guides/foo.md": "![shot](../releases/v11.14.5/foo.png)\n",
      "docs/releases/v11.14.5/foo.png": "not a real png\n",
    },
    changelog: LOG_BASE_CHANGELOG.replace("## 11.14.5", `## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n\n## 11.14.5`),
    work: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — First\n\nBody.\n\n## 2026-11-10 — After the tag\n\nNew.\n", "docs/releases/v11.14.0/old.png": "not a real png\n" },
    status: 0,
    out: [/clear\./u],
    notOut: [/logs-rolled/u, /releases\//u],
    notErr: [/logs-rolled/u],
  },
  {
    name: "a version already tagged is refused as a retag, and the version it expects is printed",
    args: [],
    version: "11.14.5",
    status: 1,
    err: [new RegExp(`tag v11\\.14\\.5 already exists locally — never retag; this release is ${TODAY_RE}`, "u")],
  },

  // -- version-date and version-order -------------------------------------------
  {
    name: "a date after today is refused by version-date, though it is newer than every tag",
    args: [],
    version: TOMORROW,
    status: 1,
    err: [new RegExp(`FAIL version-date: ${esc(TOMORROW)} is after today \\(${TODAY_RE}\\)`, "u")],
    notErr: [/version-order/u],
  },
  {
    name: "a date before today passes, with a warning that never fails",
    args: [],
    version: `${LAST_YEAR}.1.20`,
    status: 0,
    out: [new RegExp(`warn version-date: ${LAST_YEAR}\\.1\\.20 names ${LAST_YEAR}\\.1\\.20, before today`, "u"), /clear\./u],
  },
  {
    name: "a version already tagged today is refused as a retag and as not the day's next, and the version it expects is printed",
    args: [],
    version: TODAY,
    tags: [`v${TODAY}`],
    status: 1,
    err: [
      new RegExp(`tag v${TODAY_RE} already exists locally — never retag; this release is ${TODAY_RE}\\.1`, "u"),
      new RegExp(`FAIL version-order: ${TODAY_RE} is not newer than tag v${TODAY_RE} — this release is ${TODAY_RE}\\.1`, "u"),
    ],
    notErr: [/version-date/u],
  },
  {
    name: "the next release of a tagged day is its .1",
    args: [],
    version: `${TODAY}.1`,
    tags: [`v${TODAY}`],
    status: 0,
    out: [/clear\./u],
  },
  {
    name: "a release that skips the day's next .N is refused with the one it skipped",
    args: [],
    version: `${TODAY}.2`,
    tags: [`v${TODAY}`],
    status: 1,
    err: [new RegExp(`FAIL version-order: ${TODAY_RE}\\.2 is not the day's next version — this release is ${TODAY_RE}\\.1`, "u")],
    notErr: [/version-date/u, /already exists/u],
  },
  {
    name: "a day is ordered by its numbers, not its characters: 12.15 follows a tagged 12.9",
    args: [],
    version: `${LAST_YEAR}.12.15`,
    tags: [`v${LAST_YEAR}.12.9`],
    status: 0,
    out: [/warn version-date: /u, /clear\./u],
  },
  {
    name: "a version older than a tagged day is refused as not newer, and the warning still prints",
    args: [],
    version: `${LAST_YEAR}.12.9`,
    tags: [`v${LAST_YEAR}.12.15`],
    status: 1,
    out: [/warn version-date: /u],
    err: [new RegExp(`FAIL version-order: ${LAST_YEAR}\\.12\\.9 is not newer than tag v${LAST_YEAR}\\.12\\.15 — this release is ${TODAY_RE}`, "u")],
  },
  {
    name: "a date that does not exist is refused by version-date",
    args: [],
    version: `${LAST_YEAR}.2.30`,
    status: 1,
    err: [new RegExp(`FAIL version-date: ${LAST_YEAR}\\.2\\.30 names a date that does not exist`, "u")],
  },
  {
    name: "a version that is not a date is refused by version-date",
    args: [],
    version: "11.15.0",
    status: 1,
    err: [/FAIL version-date: 11\.15\.0 is not a release day/u],
  },

  // -- changelog-compiled -------------------------------------------------------
  fragmentCase("a fragment still on disk is refused, with the command that compiles it", {
    status: 1,
    err: [/FAIL changelog-compiled: changelog\.d\/[^\n]*widget-fix\.fixed\.md is still on disk — run node tools\/logs\.mjs compile/u],
  }),
  fragmentCase("a fragment whose name does not parse is refused", {
    work: { "changelog.d/notes.md": "- stray\n" },
    stage: ["changelog.d/notes.md"],
    status: 1,
    err: [/FAIL changelog-compiled: changelog\.d\/notes\.md is not named <YYYY-MM-DD>-<row id or slug>\.<upgrading\|added\|changed\|removed\|fixed>\.md/u],
    notErr: [/notes\.md is still on disk/u],
  }),
  fragmentCase("runtime changes with an empty section are refused", {
    work: { "lang/en.json": "{}\n", "CHANGELOG.md": `${LOG_BASE_CHANGELOG.replace("## 11.14.5", `## ${TODAY}\n\n### Fixed\n\n## 11.14.5`)}` },
    stage: [],
    status: 1,
    err: [new RegExp(`FAIL changelog-compiled: runtime files changed since v11\\.14\\.5 \\(lang/en\\.json\\) but CHANGELOG\\.md holds no bullet under ${TODAY_RE}`, "u")],
    notErr: [/still on disk/u],
  }),
  fragmentCase("runtime changes with no CHANGELOG section are refused", {
    work: { "lang/en.json": "{}\n" },
    stage: [],
    status: 1,
    err: [new RegExp(`FAIL changelog-compiled: runtime files changed since v11\\.14\\.5 \\(lang/en\\.json\\) but CHANGELOG\\.md has no section for ${TODAY_RE}`, "u")],
  }),
  fragmentCase("the same change passes once the fragment is compiled", {
    compile: true,
    status: 0,
    out: [/clear\./u],
    notErr: [/changelog-compiled/u],
  }),
  fragmentCase("an untracked fragment is noted and not refused", {
    work: { [FRAGMENT]: "- **A peer's fix.**\n", "CHANGELOG.md": LOG_BASE_CHANGELOG.replace("## 11.14.5", `## ${TODAY}\n\n### Fixed\n\n- **Already compiled.**\n\n## 11.14.5`) },
    stage: [],
    status: 0,
    out: [/note: changelog\.d\/[^\n]*widget-fix\.fixed\.md is untracked — not compiled/u, /clear\./u],
  }),

  // -- the flags: --live-pending lists what is owed, --at reads a commit ---------
  {
    name: "--at with --live-pending is refused: the run before the tag takes no waiver",
    args: ["--at", "@sha", "--live-pending"],
    changelog: NO_MARKER,
    commit: true,
    status: 1,
    err: [/FAIL --at takes no --live-pending/u, /a tag needs a machine with a test server/u],
  },
  {
    name: "--at with a ref that is no commit is refused with one clean message",
    args: ["--at", "no-such-ref"],
    status: 1,
    err: [/FAIL --at no-such-ref is not a commit of this repository/u],
    notErr: [/^\s+at /mu, /Error:/u, /fatal:/u],
  },
  {
    name: "--at with no value is refused with one clean message",
    args: ["--at"],
    status: 1,
    err: [/FAIL --at \(no value\) is not a commit/u],
    notErr: [/^\s+at /mu, /fatal:/u],
  },
  {
    name: "--at ignores a fragment tracked in the working tree after the commit, which the plain run refuses",
    args: [],
    changelog: NO_MARKER,
    commit: true,
    after: (ctx) => {
      ctx.write(FRAGMENT, "- **A fix.** Nothing owed.\n");
      ctx.git("add", "--", FRAGMENT);
    },
    status: 1,
    err: [/FAIL changelog-compiled: changelog\.d\/[^\n]*widget-fix\.fixed\.md is still on disk/u],
    also: [{ args: ["--at", "@sha"], status: 0, out: [/clear\./u], notErr: [/changelog-compiled/u] }],
  },
  {
    name: "--at ignores an untracked fragment, which the plain run notes",
    args: [],
    changelog: NO_MARKER,
    commit: true,
    after: (ctx) => ctx.write(FRAGMENT, "- **A peer's fix.**\n"),
    status: 0,
    out: [/note: changelog\.d\/[^\n]*widget-fix\.fixed\.md is untracked/u],
    also: [{ args: ["--at", "@sha"], status: 0, out: [/clear\./u], notOut: [/untracked/u] }],
  },
  {
    ...fragmentCase("a fragment inside the commit --at reads is refused", { status: 1 }),
    commit: true,
    args: ["--at", "@sha"],
    err: [/FAIL changelog-compiled: changelog\.d\/[^\n]*widget-fix\.fixed\.md is still in commit [0-9a-f]{12} — run node tools\/logs\.mjs compile/u],
  },
  {
    name: "--at takes the tag and version from the commit's module.json, not the working tree's",
    args: [],
    commit: true,
    after: (ctx) => ctx.write("module.json", `${JSON.stringify({ id: "widget", version: `${LAST_YEAR}.1.20` }, null, 2)}\n`),
    status: 0,
    out: [new RegExp(`release-preflight: v${LAST_YEAR}\\.1\\.20 clear\\.`, "u")],
    also: [{ args: ["--at", "@sha"], status: 0, out: [new RegExp(`release-preflight: v${TODAY_RE} clear\\.`, "u")], notOut: [new RegExp(`${LAST_YEAR}\\.1\\.20`, "u")] }],
  },
  {
    name: "--at notes a surface changed in the commit and ignores one only the working tree holds",
    args: [],
    changelog: FIXED_LOG,
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    commit: true,
    after: (ctx) => ctx.write("scripts/other/run.mjs", "export {};\n"),
    status: 0,
    out: [/note: scripts\/gadget\/ changed since v11\.14\.5/u, /note: scripts\/other\/ changed since v11\.14\.5/u],
    also: [{ args: ["--at", "@sha"], status: 0, out: [/note: scripts\/gadget\/ changed since v11\.14\.5/u], notOut: [/scripts\/other\//u] }],
  },
  {
    name: "a feature removed whole since the tag owes no recipe, not even a note, in the working tree or under --at",
    args: [],
    changelog: FIXED_LOG,
    base: { "scripts/gadget/run.mjs": "export {};\n", "docs/gadget/TESTING.md": "# Gadget\n" },
    setup: (ctx) => ctx.git("rm", "-r", "-q", "scripts/gadget", "docs/gadget"),
    commit: true,
    status: 0,
    notOut: [/scripts\/gadget\//u],
    also: [{ args: ["--at", "@sha"], status: 0, notOut: [/scripts\/gadget\//u] }],
  },
  {
    name: "--at lists a recipe the commit holds and notes the lack of one only the working tree holds",
    args: [],
    changelog: FIXED_LOG,
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    commit: true,
    after: (ctx) => ctx.write("docs/gadget/TESTING.md", "# Gadget\n"),
    status: 0,
    out: [/recipes to walk in the live session:\n {2}docs\/gadget\/TESTING\.md/u],
    notOut: [/does not exist/u],
    also: [{ args: ["--at", "@sha"], status: 0, out: [/note: scripts\/gadget\/ changed since v11\.14\.5 and docs\/gadget\/TESTING\.md does not exist/u], notOut: [/recipes to walk/u] }],
  },

  // -- live-walks: the smoke walk alone, bound to the runtime tree ---------------
  {
    name: "live-walks: a repo with no runner prints no walks and passes",
    args: [],
    base: { "tools/live/alpha.mjs": "export {};\n" },
    status: 0,
    out: [/note: live-walks: no walks/u, /clear\./u],
    notOut: [/walks \(live-walks\)/u],
  },
  walkCase("live-walks: a runner with no smoke walk file is refused, naming the file", {
    base: WALK_BASE,
    status: 1,
    err: [new RegExp(`FAIL live-walks: tools\\/live\\/${SMOKE}\\.mjs is missing — the release requires the smoke walk`, "u"), ONE_BLOCKER],
  }),
  walkCase("live-walks: no result file is refused, and --live-pending lists the smoke walk as not run", {
    status: 1,
    err: [new RegExp(`FAIL live-walks: no result file at ${RESULT_RE} — run ${SMOKE} with tools/live/run\\.mjs`, "u"), ONE_BLOCKER],
    also: [{ args: ["--live-pending"], status: 0, out: [SMOKE_PENDING, /clear\./u] }],
  }),
  walkCase("live-walks: a smoke walk absent from a result file that holds another walk is refused, and --live-pending lists it", {
    after: (ctx) => record(ctx, "alpha"),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — not run`, "u"), ONE_BLOCKER],
    notErr: [/alpha/u],
    also: [{ args: ["--live-pending"], status: 0, out: [SMOKE_PENDING] }],
  }),
  walkCase("live-walks: a smoke pass on the current tree is clear and lists the one walk", {
    after: smokePassed(),
    out: [/clear\./u, new RegExp(`walks \\(live-walks\\):\\n {2}${SMOKE} {2}passed\\n`, "u")],
    notOut: [/walks to run/u, /alpha/u, /beta/u],
  }),
  walkCase("live-walks: no other walk is required: one that failed unclassified, beside a smoke pass, does not stop it", {
    after: smokePassed((ctx) => record(ctx, "alpha", { state: "failed", tally: { pass: 2, fail: 1, gap: 0 }, exit: 1 })),
    out: [/clear\./u],
    notOut: [/alpha/u],
    notErr: [/alpha/u],
  }),
  walkCase("live-walks: a smoke pass on an older runtime tree is refused, naming the walk and the path", {
    after: smokePassed((ctx) => ctx.write("scripts/foo/run.mjs", "export {};\n")),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — stale: runtime differs — scripts\\/foo\\/run\\.mjs`, "u"), ONE_BLOCKER],
    also: [{ args: ["--live-pending"], status: 0, out: [new RegExp(`walks to run in the live session:\\n {2}${SMOKE} {2}stale: runtime differs — scripts\\/foo\\/run\\.mjs\\n`, "u"), /clear\./u] }],
  }),
  walkCase("live-walks: a smoke pass that began before the last release is clear while its tree is the current one", {
    after: (ctx) => record(ctx, SMOKE, { startedAt: "2000-01-01T00:00:00.000Z", endedAt: "2000-01-01T00:05:00.000Z" }),
    out: [/clear\./u, new RegExp(`${SMOKE} {2}passed\\n`, "u")],
  }),
  walkCase("live-walks: a tracked result file is refused, --live-pending included", {
    after: smokePassed((ctx) => ctx.git("add", "-f", "--", RESULT_PATH)),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${RESULT_RE} is tracked`, "u"), ONE_BLOCKER],
    also: [{ args: ["--live-pending"], status: 1, err: [/live-walks: [^\n]* is tracked/u] }],
  }),
  walkCase("live-walks: --at refuses a result file the commit holds, which the working tree no longer tracks", {
    commit: true,
    setup: smokePassed((ctx) => ctx.git("add", "-f", "--", RESULT_PATH)),
    after: (ctx) => ctx.git("rm", "--cached", "-q", "--", RESULT_PATH),
    out: [/walks \(live-walks\):/u],
    also: [{ args: ["--at", "@sha"], status: 1, err: [new RegExp(`FAIL live-walks: ${RESULT_RE} is tracked`, "u")] }],
  }),
  walkCase("live-walks: a result file of an unknown schema is refused, --live-pending included", {
    after: (ctx) => ctx.write(RESULT_PATH, `${JSON.stringify({ schema: 2, walks: {} })}\n`),
    status: 1,
    err: [/FAIL live-walks: [^\n]* is unreadable or of an unknown schema \(schema 2\)/u, ONE_BLOCKER],
    also: [{ args: ["--live-pending"], status: 1, err: [/unknown schema \(schema 2\)/u] }],
  }),
  walkCase("live-walks: a result file that is not JSON is refused", {
    after: (ctx) => ctx.write(RESULT_PATH, "{ not json"),
    status: 1,
    err: [/FAIL live-walks: [^\n]* is unreadable or of an unknown schema \(unreadable\)/u, ONE_BLOCKER],
  }),
  walkCase("live-walks: a smoke walk whose file was edited after a pass still stands, and says so", {
    after: smokePassed((ctx) => ctx.write(`tools/live/${SMOKE}.mjs`, `${ctx.read(`tools/live/${SMOKE}.mjs`)}// edited\n`)),
    out: [/clear\./u, new RegExp(`${SMOKE} {2}passed; the walk's file changed since`, "u")],
  }),
  walkCase("live-walks: a smoke walk whose tree changed during its run is refused, and --live-pending lists it", {
    after: (ctx) => record(ctx, SMOKE, { treeStart: NONE }),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — the runtime changed during its run`, "u"), ONE_BLOCKER],
    also: [{ args: ["--live-pending"], status: 0, out: [/walks to run/u] }],
  }),
  walkCase("live-walks: a partial smoke attempt is refused", {
    after: (ctx) => record(ctx, SMOKE, { partial: "ran 3 of 9 checks" }),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — partial: ran 3 of 9 checks`, "u"), ONE_BLOCKER],
  }),
  walkCase("live-walks: a failed smoke walk with no classification is refused", {
    after: smokeFailed(null),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — failed, not classified`, "u"), ONE_BLOCKER],
  }),
  walkCase("live-walks: a failure classified world-state on a new row for this version is clear", {
    after: smokeFailed("world-state", "new"),
    out: [/clear\./u, new RegExp(`${SMOKE} {2}classified world-state ${T_ROW} \\(new\\)`, "u")],
  }),
  walkCase("live-walks: a classification made for another version is refused", {
    after: smokeFailed("world-state", "new", "2026.1.1"),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — classified for 2026\\.1\\.1; classify again for this release`, "u"), ONE_BLOCKER],
  }),
  walkCase("live-walks: a defect on a claimed row does not ship", {
    after: smokeFailed("defect", "claimed"),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — a defect ships only when its row is deferred`, "u"), ONE_BLOCKER],
  }),
  walkCase("live-walks: a defect on a deferred row ships", {
    after: smokeFailed("defect", "deferred"),
    out: [/clear\./u, new RegExp(`${SMOKE} {2}classified defect ${T_ROW} \\(deferred\\)`, "u")],
  }),
  walkCase("live-walks: a CRLF flip of a runtime file after the walk leaves it current", {
    after: smokePassed((ctx) => ctx.write("lang/en.json", ctx.read("lang/en.json").replaceAll("\n", "\r\n"))),
    out: [/clear\./u, new RegExp(`${SMOKE} {2}passed`, "u")],
  }),
  walkCase("live-walks: the tree is the commit's under --at, though the working tree has moved on", {
    commit: true,
    after: smokePassed((ctx) => ctx.write("scripts/foo/run.mjs", "export {};\n")),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${SMOKE} — stale: runtime differs — scripts\\/foo\\/run\\.mjs`, "u")],
    also: [{ args: ["--at", "@sha"], status: 0, out: [/note: reading commit /u, /clear\./u, new RegExp(`${SMOKE} {2}passed`, "u")] }],
  }),
];

/** Writes `content` at `rel` under `root`, creating its directories. */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-preflight-"));
let failures = 0;
try {
  CASES.forEach((testCase, i) => {
    const problems = [];
    try {
      const root = path.join(tmp, `case-${i}`);
      fs.mkdirSync(path.join(root, "tools"), { recursive: true });
      fs.copyFileSync(PREFLIGHT, path.join(root, "tools", "release-preflight.mjs"));
      fs.copyFileSync(LOGS, path.join(root, "tools", "logs.mjs"));
      fs.copyFileSync(WALK_RESULTS, path.join(root, "tools", "walk-results.mjs"));
      const manifest = (version) => fs.writeFileSync(path.join(root, "module.json"), `${JSON.stringify({ id: "widget", version }, null, 2)}\n`);
      manifest("11.14.5");
      for (const [rel, content] of Object.entries(testCase.base ?? {})) put(root, rel, content);
      git(root, ["init", "-q", "-b", "main"]);
      git(root, ["config", "core.autocrlf", "false"]);
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "--no-verify", "-m", "base"]);
      git(root, ["tag", "v11.14.5"]);
      for (const extra of testCase.tags ?? []) git(root, ["tag", extra]);
      const version = testCase.version ?? TODAY;
      manifest(version);
      if (testCase.changelog !== undefined) fs.writeFileSync(path.join(root, "CHANGELOG.md"), testCase.changelog);
      for (const [rel, content] of Object.entries(testCase.work ?? {})) put(root, rel, content);
      for (const rel of testCase.stage ?? []) git(root, ["add", "--", rel]);
      const ctx = {};
      Object.assign(ctx, {
        root,
        sha: "",
        read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
        write: (rel, content) => put(root, rel, content),
        git: (...a) => git(root, a),
        logs: (...a) => {
          const l = spawnSync(process.execPath, [path.join("tools", "logs.mjs"), ...a], { cwd: root, env: GIT_ENV, encoding: "utf8" });
          if (l.status !== 0) throw new Error(`logs ${a.join(" ")} exited ${l.status}: ${l.stderr}`);
        },
      });
      testCase.setup?.(ctx);
      // `commit` lands the prepared tree as the release commit, `@sha` in an
      // argument names it, and `after` then edits the working tree alone.
      if (testCase.commit) ctx.sha = commitAll(root, "release");
      testCase.after?.(ctx);
      // The case's own run first, then each `also` run against the same tree.
      for (const [n, run] of [testCase, ...(testCase.also ?? [])].entries()) {
        const r = spawnSync(process.execPath, [path.join("tools", "release-preflight.mjs"), ...run.args.map((a) => (a === "@sha" ? ctx.sha : a))], { cwd: root, env: GIT_ENV, encoding: "utf8" });
        const own = [];
        if (r.status !== run.status) own.push(`exited ${r.status}, expected ${run.status}`);
        for (const [stream, text, expected, forbidden] of [
          ["stdout", r.stdout, run.out ?? [], run.notOut ?? []],
          ["stderr", r.stderr, run.err ?? [], run.notErr ?? []],
        ]) {
          for (const re of expected) if (!re.test(text)) own.push(`${stream} does not match ${re}`);
          for (const re of forbidden) if (re.test(text)) own.push(`${stream} matches ${re}`);
        }
        if (own.length) own.push(`stdout: ${r.stdout.trim() || "(empty)"}`, `stderr: ${r.stderr.trim() || "(empty)"}`);
        problems.push(...own.map((p) => (n ? `[${run.args.join(" ")}] ${p}` : p)));
      }
    } catch (e) {
      // A case that throws is that case's failure, and the cases after it still run.
      problems.push(`threw: ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n  ")}`);
    }
    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const shown = path.relative(TEMPLATE_ROOT, PREFLIGHT);
console.log(`test-release-preflight: ${CASES.length} cases against ${shown.startsWith("..") ? PREFLIGHT : shown}, ${failures} failed`);
if (failures) process.exit(1);
