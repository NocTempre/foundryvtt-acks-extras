/**
 * Starts the canonical release preflight in throwaway repositories and checks
 * its exit status and what it names. Each case is a module tagged v11.14.5
 * (and any tags the case adds) with its version bumped in the working tree,
 * the way a release is prepared, and differs in the kind it is given, the
 * CHANGELOG it holds and the shots under `docs/releases/`. Those decide the
 * snapshot check: on a major or a minor, every Added or Changed bullet of the
 * bumped version's section names a shot that was taken, or says why it has
 * none, and a shot any other bullet names was taken too. The default bump is
 * the run day's date, which the version checks accept; the cases that name
 * another version, and the tags beside it, decide the date and order checks.
 *
 * The changelog-compiled cases stage fragments and a runtime file under
 * `changelog.d/` and `lang/`; the logs-rolled cases build a fixture, run
 * `logs.mjs roll` in it, and break one thing at a time. A case may name `base`
 * files committed at the tag, `work` files written after it, `stage` paths to
 * `git add`, and a `setup` hook that edits the tree before the preflight runs.
 * The `--at` cases set `commit`, which lands the prepared tree as one commit
 * (`@sha` in `args` names it), then an `after` hook that edits the working
 * tree alone, so a run without `--at` and a run with it, listed under `also`,
 * judge the same repository from the two sources and may differ. The
 * live-walks cases give a fixture a runner and two walks, record each
 * walk's attempt through `walk-results.mjs` against the tree the case stands
 * in (in `after`, so a case can edit the tree once the result exists), and
 * break one thing: a missing, tracked or unreadable result file, a stale or
 * edited walk, a partial or unclassified one, a defect on a claimed row. The
 * tree id itself is `test-walk-results`' to check, not this file's.
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
// `roll` and `compile` prepare the fixtures the logs checks read.
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
const GREEN = `# Changelog

## Unreleased

### Added

- **An unreleased entry with no marker.** Not this release's to answer for.

## ${TODAY} — Public Beta

### Added

- **A sheet gains a tab.** The tab lists what the sheet holds.
  <!-- shot: widget-sheet-tab -->
- **A dialog asks first.** It names what it will change.
  - A nested item, still this entry's.

  A second paragraph of the same entry.
  <!-- shot: widget-confirm --> <!-- shot: widget-confirm-cancel.png -->

### Changed

- **The api returns a promise.** <!-- no-shot: API only,
  nothing on screen -->

### Fixed

- **A crash on open.** No marker, and none owed.
- **A refusal says why.** A fixed entry with a visible surface.
  <!-- shot: widget-refusal -->

## 11.14.5

### Added

- **The first entry.** Unmarked, and an earlier release's.
`;
const ALL_SHOTS = ["widget-sheet-tab.png", "widget-confirm.png", "widget-confirm-cancel.png", "widget-refusal.png"];
const lineOf = (text, needle) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
const UNMARKED = GREEN.replace(/ <!-- no-shot: API only,\n {2}nothing on screen -->/u, "");

// The logs checks. A fixture at v11.14.5 holds a CHANGELOG, two DECISIONS (one
// in a subdirectory), a ROADMAP and a guide linking the tag's shot folder; the
// working tree then opens the release's section, adds a ruling after the tag
// and runs the roll, which is what `logs-rolled` reads.
const ISO_TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}-${String(NOW.getDate()).padStart(2, "0")}`;
const LOG_BASE_CHANGELOG = "# Changelog\n\nPreamble.\n\n## 11.14.5\n\n- **Five.** Shipped at the tag.\n";
const LOG_BASE = {
  "CHANGELOG.md": LOG_BASE_CHANGELOG,
  "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — First\n\nBody.\n\n## 2026-10-02 — Second — SUPERSEDED 2026-10-09\n\nGone.\n",
  "docs/foo/DECISIONS.md": "# Foo decisions\n\n## 2026-09-01 — Only\n\nBody.\n",
  "docs/foo/ROADMAP.md": "# Foo roadmap\n\n- [ ] not built\n",
  "docs/guides/foo.md": "![shot](../releases/v11.14.5/foo.png)\n",
  "docs/releases/v11.14.5/foo.png": "not a real png\n",
};
const ARCHIVE = "docs/DECISIONS-through-v11.14.5.md";
/** Opens the release's section and a post-tag ruling, then rolls and stamps the ROADMAP unless told not to. */
function prepareRolled(ctx, { roll = true, stamp = true } = {}) {
  ctx.write("CHANGELOG.md", LOG_BASE_CHANGELOG.replace("## 11.14.5", `## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n\n## 11.14.5`));
  ctx.write("docs/DECISIONS.md", `${LOG_BASE["docs/DECISIONS.md"]}\n## 2026-11-10 — After the tag\n\nNew.\n`);
  if (roll) ctx.logs("roll");
  if (roll && stamp) ctx.write("docs/foo/ROADMAP.md", `${ctx.read("docs/foo/ROADMAP.md")}\nRe-issued ${ISO_TODAY}.\n`);
}
/** A major case on the rolled fixture, with `mutate` applied after the roll. */
const rolledCase = (name, { mutate, args = ["--kind", "major"], status = 1, ...rest }) => ({
  name,
  args,
  base: LOG_BASE,
  noShotDir: true,
  shots: [],
  status,
  setup: (ctx) => {
    prepareRolled(ctx);
    mutate?.(ctx);
  },
  ...rest,
});
const FRAGMENT = `changelog.d/${ISO_TODAY}-widget-fix.fixed.md`;
/** A hotfix case with a runtime file changed and a fragment staged, compiled or not. */
const fragmentCase = (name, { compile = false, ...rest }) => ({
  name,
  args: ["--kind", "hotfix"],
  base: { "CHANGELOG.md": LOG_BASE_CHANGELOG },
  shots: [],
  work: { "lang/en.json": "{}\n", [FRAGMENT]: "- **A fix.** Nothing owed.\n" },
  stage: [FRAGMENT],
  setup: (ctx) => {
    if (compile) ctx.logs("compile");
  },
  ...rest,
});

// The live-walks cases. A fixture with a runner and two walks (and a `_` helper,
// which is not one) keeps `aia-tmp/` ignored as a real module does; a case
// records a walk's attempt against the tree it stands in, through the same
// `walk-results.mjs` the runner uses, and then breaks one thing.
const WALK_BASE = {
  ".gitignore": "aia-tmp/\n",
  "lang/en.json": "{\n  \"a\": 1\n}\n",
  "docs/foo/TESTING.md": "# Foo\n\nWalked by hand.\n",
  "tools/live/run.mjs": "export {};\n",
  "tools/live/_helper.mjs": "export {};\n",
  "tools/live/alpha.mjs": "export {};\n// alpha\n",
  "tools/live/beta.mjs": "export {};\n// beta\n",
};
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
/** Records both walks passed, then runs `more`. */
const recorded = (more) => (ctx) => {
  record(ctx, "alpha");
  record(ctx, "beta");
  more?.(ctx);
};
/** A failed attempt of alpha classified as `as` on a row in `status`, beside a passed beta. */
const failedAlpha = (as, status, version = TODAY) => recorded((ctx) => {
  record(ctx, "alpha", { state: "failed", tally: { pass: 2, fail: 1, gap: 0 }, exit: 1 });
  if (as) recordClassification(ctx.root, "alpha", { row: T_ROW, as, status, version });
});
/** A major case on the rolled fixture with both walks in the tree. */
const walkMajor = (name, rest) => rolledCase(name, { base: { ...LOG_BASE, ...WALK_BASE }, ...rest });
const FIXED_LOG = `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n`;
/** A minor case whose changed surface, `gadget`, has the recipe `recipe`. */
const walkMinor = (name, recipe, rest) => ({
  name,
  args: ["--kind", "minor"],
  base: { ...WALK_BASE, "docs/gadget/TESTING.md": recipe },
  changelog: FIXED_LOG,
  shots: [],
  work: { "scripts/gadget/run.mjs": "export {};\n" },
  ...rest,
});
const ONE_BLOCKER = /release-preflight: 1 blocker\(s\)/u;
const RESULT_RE = RESULT_PATH.replaceAll(".", "\\.");

const CASES = [
  {
    name: "a minor whose every Added and Changed bullet names a taken shot or a reason is clear",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 0,
    out: [
      new RegExp(`release-preflight: v${TODAY_RE} clear \\(minor\\)\\.`, "u"),
      new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-sheet-tab\\.png ← CHANGELOG\\.md:${lineOf(GREEN, "A sheet gains")} "A sheet gains a tab\\. The tab`, "u"),
      new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-confirm\\.png ← CHANGELOG\\.md:\\d+ "A dialog asks first\\.`, "u"),
      new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-confirm-cancel\\.png ← CHANGELOG\\.md:\\d+ "A dialog asks first\\.`, "u"),
      /CHANGELOG\.md:\d+ "The api returns a promise\.": API only, nothing on screen/u,
      new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-refusal\\.png ← CHANGELOG\\.md:\\d+ "A refusal says why\\.`, "u"),
    ],
    notOut: [/unreleased entry/u, /first entry/u, /crash on open/u],
  },
  {
    name: "a shot a Fixed entry names is held to the file check, though none is owed",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS.filter((s) => s !== "widget-refusal.png"),
    status: 1,
    err: [new RegExp(`"A refusal says why\\. .*" names docs/releases/v${TODAY_RE}/widget-refusal\\.png, which does not exist`, "u")],
    notErr: [/crash on open/u],
  },
  {
    name: "the same changelog with CRLF line ends reads alike",
    args: ["--kind", "minor"],
    changelog: GREEN.replaceAll("\n", "\r\n"),
    shots: ALL_SHOTS,
    status: 0,
    out: [new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-confirm-cancel\\.png`, "u"), /API only, nothing on screen/u],
  },
  {
    name: "a Changed bullet with no marker stops a minor, by line and label",
    args: ["--kind", "minor"],
    changelog: UNMARKED,
    shots: ALL_SHOTS,
    status: 1,
    err: [new RegExp(`FAIL CHANGELOG\\.md:${lineOf(UNMARKED, "The api returns")} "The api returns a promise\\." names no shot`, "u")],
    notErr: [/sheet gains/u, /crash on open/u, /unreleased entry/u, /first entry/u],
  },
  {
    name: "a major is held to the same entries",
    args: ["--kind", "major"],
    changelog: UNMARKED,
    shots: ALL_SHOTS,
    status: 1,
    err: [/"The api returns a promise\." names no shot/u],
  },
  {
    name: "a hotfix owes no shot",
    args: ["--kind", "hotfix"],
    changelog: UNMARKED,
    shots: [],
    status: 0,
    out: [/clear \(hotfix\)/u],
    notOut: [/shots the changelog names/u],
  },
  {
    name: "a shot a bullet names and nobody took stops a minor",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ["widget-sheet-tab.png", "widget-confirm-cancel.png"],
    status: 1,
    err: [new RegExp(`"A dialog asks first\\. .*" names docs/releases/v${TODAY_RE}/widget-confirm\\.png, which does not exist`, "u")],
    notErr: [/widget-sheet-tab/u, /widget-confirm-cancel/u],
  },
  {
    name: "--live-pending lists a shot not yet taken instead of stopping",
    args: ["--kind", "minor", "--live-pending"],
    changelog: GREEN,
    shots: ["widget-sheet-tab.png"],
    status: 0,
    out: [new RegExp(`to take docs/releases/v${TODAY_RE}/widget-confirm\\.png`, "u"), new RegExp(`taken {3}docs/releases/v${TODAY_RE}/widget-sheet-tab\\.png`, "u")],
  },
  {
    name: "a shot whose file differs only in letter case is not taken",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ["Widget-Sheet-Tab.png", "widget-confirm.png", "widget-confirm-cancel.png"],
    status: 1,
    err: [new RegExp(`names docs/releases/v${TODAY_RE}/widget-sheet-tab\\.png, which does not exist`, "u")],
  },
  {
    name: "a no-shot marker with no reason stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace(/<!-- no-shot: API only,\n {2}nothing on screen -->/u, "<!-- no-shot: -->"),
    shots: ALL_SHOTS,
    status: 1,
    err: [/"The api returns a promise\." has a no-shot marker with no reason/u],
  },
  {
    name: "a shot marker naming a path or a list stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace("<!-- shot: widget-sheet-tab -->", "<!-- shot: ../v11.14.5/old.png --> <!-- shot: widget-a, widget-b -->"),
    shots: ALL_SHOTS,
    status: 1,
    err: [/shot marker naming "\.\.\/v11\.14\.5\/old\.png"/u, /shot marker naming "widget-a, widget-b"/u],
  },
  {
    name: "a minor whose section holds only Fixed entries is clear",
    args: ["--kind", "minor"],
    changelog: `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A crash on open.** No marker owed.\n`,
    shots: [],
    status: 0,
    out: [/clear \(minor\)/u],
  },
  {
    name: "a minor with no section for its version stops",
    args: ["--kind", "minor"],
    changelog: GREEN.replace(`## ${TODAY}`, "## 11.14.6"),
    shots: ALL_SHOTS,
    status: 1,
    err: [new RegExp(`CHANGELOG\\.md has no section for ${TODAY_RE}`, "u")],
  },
  {
    name: "a minor with no CHANGELOG at all stops",
    args: ["--kind", "minor"],
    shots: [],
    status: 1,
    err: [new RegExp(`there is no CHANGELOG\\.md, so no section for ${TODAY_RE}`, "u")],
  },
  {
    name: "a run with no kind stops",
    args: [],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 1,
    err: [/no release kind — pass --kind major\|minor\|hotfix/u],
  },
  {
    name: "a kind that is not one of the three stops",
    args: ["--kind", "patch"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 1,
    err: [/--kind patch is not a release kind/u],
  },
  {
    name: "a version already tagged is still refused beside the shot check",
    args: ["--kind", "minor"],
    version: "11.14.5",
    changelog: GREEN,
    shots: [],
    status: 1,
    err: [new RegExp(`tag v11\\.14\\.5 already exists locally — never retag; this release is ${TODAY_RE}`, "u")],
  },
  {
    name: "a date after today is refused by version-date, though it is newer than every tag",
    args: ["--kind", "hotfix"],
    version: TOMORROW,
    shots: [],
    status: 1,
    err: [new RegExp(`FAIL version-date: ${esc(TOMORROW)} is after today \\(${TODAY_RE}\\)`, "u")],
    notErr: [/version-order/u],
  },
  {
    name: "a date before today passes, with a warning that never fails",
    args: ["--kind", "hotfix"],
    version: `${LAST_YEAR}.1.20`,
    shots: [],
    status: 0,
    out: [new RegExp(`warn version-date: ${LAST_YEAR}\\.1\\.20 names ${LAST_YEAR}\\.1\\.20, before today`, "u"), /clear \(hotfix\)/u],
  },
  {
    name: "a version already tagged today is refused as a retag and as not the day's next, and the version it expects is printed",
    args: ["--kind", "hotfix"],
    version: TODAY,
    tags: [`v${TODAY}`],
    shots: [],
    status: 1,
    err: [
      new RegExp(`tag v${TODAY_RE} already exists locally — never retag; this release is ${TODAY_RE}\\.1`, "u"),
      new RegExp(`FAIL version-order: ${TODAY_RE} is not newer than tag v${TODAY_RE} — this release is ${TODAY_RE}\\.1`, "u"),
    ],
    notErr: [/version-date/u],
  },
  {
    name: "the next release of a tagged day is its .1",
    args: ["--kind", "hotfix"],
    version: `${TODAY}.1`,
    tags: [`v${TODAY}`],
    shots: [],
    status: 0,
    out: [/clear \(hotfix\)/u],
  },
  {
    name: "a release that skips the day's next .N is refused with the one it skipped",
    args: ["--kind", "hotfix"],
    version: `${TODAY}.2`,
    tags: [`v${TODAY}`],
    shots: [],
    status: 1,
    err: [new RegExp(`FAIL version-order: ${TODAY_RE}\\.2 is not the day's next version — this release is ${TODAY_RE}\\.1`, "u")],
    notErr: [/version-date/u, /already exists/u],
  },
  {
    name: "a day is ordered by its numbers, not its characters: 12.15 follows a tagged 12.9",
    args: ["--kind", "hotfix"],
    version: `${LAST_YEAR}.12.15`,
    tags: [`v${LAST_YEAR}.12.9`],
    shots: [],
    status: 0,
    out: [/warn version-date: /u, /clear \(hotfix\)/u],
  },
  {
    name: "a version older than a tagged day is refused as not newer, and the warning still prints",
    args: ["--kind", "hotfix"],
    version: `${LAST_YEAR}.12.9`,
    tags: [`v${LAST_YEAR}.12.15`],
    shots: [],
    status: 1,
    out: [/warn version-date: /u],
    err: [new RegExp(`FAIL version-order: ${LAST_YEAR}\\.12\\.9 is not newer than tag v${LAST_YEAR}\\.12\\.15 — this release is ${TODAY_RE}`, "u")],
  },
  {
    name: "a date that does not exist is refused by version-date",
    args: ["--kind", "hotfix"],
    version: `${LAST_YEAR}.2.30`,
    shots: [],
    status: 1,
    err: [new RegExp(`FAIL version-date: ${LAST_YEAR}\\.2\\.30 names a date that does not exist`, "u")],
  },
  {
    name: "a version that is not a date is refused by version-date",
    args: ["--kind", "hotfix"],
    version: "11.15.0",
    shots: [],
    status: 1,
    err: [/FAIL version-date: 11\.15\.0 is not a release day/u],
  },

  // -- changelog-compiled, every kind -------------------------------------------
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
    out: [/clear \(hotfix\)/u],
    notErr: [/changelog-compiled/u],
  }),
  fragmentCase("an untracked fragment is noted and not refused", {
    work: { [FRAGMENT]: "- **A peer's fix.**\n", "CHANGELOG.md": LOG_BASE_CHANGELOG.replace("## 11.14.5", `## ${TODAY}\n\n### Fixed\n\n- **Already compiled.**\n\n## 11.14.5`) },
    stage: [],
    status: 0,
    out: [/note: changelog\.d\/[^\n]*widget-fix\.fixed\.md is untracked — not compiled/u, /clear \(hotfix\)/u],
  }),

  // -- logs-rolled, major only --------------------------------------------------
  rolledCase("a major passes on a rolled fixture", {
    status: 0,
    out: [/release-preflight: v[\d.]+ clear \(major\)/u],
    notErr: [/logs-rolled/u],
  }),
  rolledCase("a major refuses an archive edited after the roll", {
    mutate: (ctx) => ctx.write(ARCHIVE, `${ctx.read(ARCHIVE)}An edit.\n`),
    err: [/FAIL logs-rolled: docs\/DECISIONS-through-v11\.14\.5\.md differs from docs\/DECISIONS\.md at v11\.14\.5/u],
  }),
  rolledCase("a major refuses a missing archive", {
    mutate: (ctx) => fs.rmSync(path.join(ctx.root, "docs/foo/DECISIONS-through-v11.14.5.md")),
    err: [/FAIL logs-rolled: docs\/foo\/DECISIONS-through-v11\.14\.5\.md is missing/u],
  }),
  rolledCase("a major asks no archive of a feature whose docs folder is gone whole", {
    mutate: (ctx) => fs.rmSync(path.join(ctx.root, "docs/foo"), { recursive: true }),
    status: 0,
    notErr: [/logs-rolled/u],
  }),
  rolledCase("a major refuses a live DECISIONS with no In force section", {
    mutate: (ctx) => ctx.write("docs/DECISIONS.md", ctx.read("docs/DECISIONS.md").replace("## In force", "## Index")),
    err: [/FAIL logs-rolled: docs\/DECISIONS\.md has no "## In force" section/u],
  }),
  rolledCase("a major refuses an index link whose anchor leads nowhere", {
    mutate: (ctx) => ctx.write("docs/DECISIONS.md", ctx.read("docs/DECISIONS.md").replace("#2026-10-01--first", "#2026-10-01--nothing")),
    err: [/FAIL logs-rolled: docs\/DECISIONS\.md index links DECISIONS-through-v11\.14\.5\.md#2026-10-01--nothing, and no heading of DECISIONS-through-v11\.14\.5\.md has that anchor/u],
  }),
  rolledCase("a major refuses an index link to a file that is not there", {
    mutate: (ctx) => ctx.write("docs/DECISIONS.md", ctx.read("docs/DECISIONS.md").replace("](DECISIONS-through-v11.14.5.md#2026-10-01--first", "](DECISIONS-through-v1.md#2026-10-01--first")),
    err: [/FAIL logs-rolled: docs\/DECISIONS\.md index links DECISIONS-through-v1\.md, which does not exist/u],
  }),
  rolledCase("a major refuses a heading that is in both the live file and its archive", {
    mutate: (ctx) => ctx.write("docs/DECISIONS.md", `${ctx.read("docs/DECISIONS.md")}\n## 2026-10-01 — First\n\nAgain.\n`),
    err: [/FAIL logs-rolled: "## 2026-10-01 — First" is in both docs\/DECISIONS\.md and DECISIONS-through-v11\.14\.5\.md/u],
  }),
  rolledCase("a major refuses a live heading of another shape", {
    mutate: (ctx) => ctx.write("docs/DECISIONS.md", `${ctx.read("docs/DECISIONS.md")}\n## Loose heading\n\nx.\n`),
    err: [/FAIL logs-rolled: docs\/DECISIONS\.md heading "## Loose heading" is not "## YYYY-MM-DD — <title>"/u],
    notErr: [/2026-11-10 — After the tag/u],
  }),
  rolledCase("a major refuses a live DECISIONS that does not link its archive", {
    mutate: (ctx) => ctx.write("docs/foo/DECISIONS.md", ctx.read("docs/foo/DECISIONS.md").replaceAll("DECISIONS-through-v11.14.5.md", "gone.md")),
    err: [/FAIL logs-rolled: docs\/foo\/DECISIONS\.md does not link DECISIONS-through-v11\.14\.5\.md/u],
  }),
  rolledCase("a major refuses a ROADMAP with no re-issue stamp", {
    mutate: (ctx) => ctx.write("docs/foo/ROADMAP.md", LOG_BASE["docs/foo/ROADMAP.md"]),
    err: [/FAIL logs-rolled: docs\/foo\/ROADMAP\.md has no "Re-issued <YYYY-MM-DD>\." stamp dated \d{4}-\d{2}-\d{2} or later/u],
  }),
  rolledCase("a major refuses a ROADMAP whose stamp predates the tag", {
    mutate: (ctx) => ctx.write("docs/foo/ROADMAP.md", `${LOG_BASE["docs/foo/ROADMAP.md"]}\nRe-issued ${LAST_YEAR}-01-20.\n`),
    err: [/FAIL logs-rolled: docs\/foo\/ROADMAP\.md has no "Re-issued/u],
  }),
  rolledCase("a major refuses a live CHANGELOG still holding the tagged version's section", {
    mutate: (ctx) => ctx.write("CHANGELOG.md", `${ctx.read("CHANGELOG.md")}\n## 11.14.5\n\n- **Back again.**\n`),
    err: [/FAIL logs-rolled: CHANGELOG\.md still holds "## 11\.14\.5", whose version has a tag/u],
  }),
  rolledCase("a major refuses a live CHANGELOG that does not link its archive", {
    mutate: (ctx) => ctx.write("CHANGELOG.md", ctx.read("CHANGELOG.md").replace(/Changes through[^\n]*\n/u, "")),
    err: [/FAIL logs-rolled: CHANGELOG\.md does not link CHANGELOG-through-v11\.14\.5\.md/u],
  }),
  rolledCase("a major refuses a shot folder no guide or gallery row links", {
    mutate: (ctx) => ctx.write("docs/releases/v11.14.0/old.png", "not a real png\n"),
    err: [/FAIL logs-rolled: docs\/releases\/v11\.14\.0\/ is linked by no guide and no GALLERY row/u],
    notErr: [/releases\/v11\.14\.5\//u],
  }),
  rolledCase("--live-pending lists the unlinked shot folder instead of refusing it", {
    args: ["--kind", "major", "--live-pending"],
    mutate: (ctx) => ctx.write("docs/releases/v11.14.0/old.png", "not a real png\n"),
    status: 0,
    out: [/note: docs\/releases\/v11\.14\.0\/ is linked by no guide or gallery row/u, /clear \(major\)/u],
  }),
  rolledCase("a path that did not exist at the tag is not asked for", {
    mutate: (ctx) => ctx.write("docs/bar/DECISIONS.md", "# Bar decisions\n\n## 2026-11-10 — New\n\nBody.\n"),
    status: 0,
    out: [/clear \(major\)/u],
  }),
  {
    ...rolledCase("a minor skips logs-rolled", {}),
    args: ["--kind", "minor"],
    setup: (ctx) => prepareRolled(ctx, { roll: false }),
    status: 0,
    out: [/clear \(minor\)/u],
    notErr: [/logs-rolled/u],
  },
  {
    ...rolledCase("a hotfix skips logs-rolled", {}),
    args: ["--kind", "hotfix"],
    setup: (ctx) => prepareRolled(ctx, { roll: false }),
    status: 0,
    out: [/clear \(hotfix\)/u],
    notErr: [/logs-rolled/u],
  },

  // -- the flags: --live-pending replaces --shots-pending, --at reads a commit ---
  {
    name: "--shots-pending is refused and names --live-pending",
    args: ["--kind", "minor", "--shots-pending"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    status: 1,
    err: [/FAIL --shots-pending is now --live-pending/u],
  },
  {
    name: "--at with --live-pending is refused: the run before the tag takes no waiver",
    args: ["--kind", "minor", "--at", "@sha", "--live-pending"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    commit: true,
    status: 1,
    err: [/FAIL --at takes no --live-pending/u, /a tag needs a machine with a test server/u],
  },
  {
    name: "--at with a ref that is no commit is refused with one clean message",
    args: ["--kind", "hotfix", "--at", "no-such-ref"],
    shots: [],
    status: 1,
    err: [/FAIL --at no-such-ref is not a commit of this repository/u],
    notErr: [/^\s+at /mu, /Error:/u, /fatal:/u],
  },
  {
    name: "--at with no value is refused with one clean message",
    args: ["--kind", "hotfix", "--at"],
    shots: [],
    status: 1,
    err: [/FAIL --at \(no value\) is not a commit/u],
    notErr: [/^\s+at /mu, /fatal:/u],
  },
  {
    name: "--at judges the commit's shots: files gone or recased in the working tree alone fail the plain run and not --at",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    commit: true,
    after: (ctx) => {
      const dir = path.join(ctx.root, "docs", "releases", `v${TODAY}`);
      fs.rmSync(path.join(dir, "widget-confirm.png"));
      fs.renameSync(path.join(dir, "widget-sheet-tab.png"), path.join(dir, "tmp.png"));
      fs.renameSync(path.join(dir, "tmp.png"), path.join(dir, "Widget-Sheet-Tab.png"));
    },
    status: 1,
    err: [/widget-confirm\.png, which does not exist/u, /widget-sheet-tab\.png, which does not exist/u],
    also: [{ args: ["--kind", "minor", "--at", "@sha"], status: 0, out: [/note: reading commit /u, /clear \(minor\)/u, /taken {3}docs\/releases\/v[\d.]+\/widget-confirm\.png/u] }],
  },
  {
    name: "--at ignores a fragment tracked in the working tree after the commit, which the plain run refuses",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    commit: true,
    after: (ctx) => {
      ctx.write(FRAGMENT, "- **A fix.** Nothing owed.\n");
      ctx.git("add", "--", FRAGMENT);
    },
    status: 1,
    err: [/FAIL changelog-compiled: changelog\.d\/[^\n]*widget-fix\.fixed\.md is still on disk/u],
    also: [{ args: ["--kind", "minor", "--at", "@sha"], status: 0, out: [/clear \(minor\)/u], notErr: [/changelog-compiled/u] }],
  },
  {
    name: "--at ignores an untracked fragment, which the plain run notes",
    args: ["--kind", "minor"],
    changelog: GREEN,
    shots: ALL_SHOTS,
    commit: true,
    after: (ctx) => ctx.write(FRAGMENT, "- **A peer's fix.**\n"),
    status: 0,
    out: [/note: changelog\.d\/[^\n]*widget-fix\.fixed\.md is untracked/u],
    also: [{ args: ["--kind", "minor", "--at", "@sha"], status: 0, out: [/clear \(minor\)/u], notOut: [/untracked/u] }],
  },
  {
    ...fragmentCase("a fragment inside the commit --at reads is refused", { status: 1 }),
    commit: true,
    args: ["--kind", "hotfix", "--at", "@sha"],
    err: [/FAIL changelog-compiled: changelog\.d\/[^\n]*widget-fix\.fixed\.md is still in commit [0-9a-f]{12} — run node tools\/logs\.mjs compile/u],
  },
  {
    name: "--at reads the commit's CHANGELOG: a marker added in the working tree alone does not pass it",
    args: ["--kind", "minor"],
    changelog: UNMARKED,
    shots: ALL_SHOTS,
    commit: true,
    after: (ctx) => ctx.write("CHANGELOG.md", GREEN),
    status: 0,
    out: [/clear \(minor\)/u],
    also: [{ args: ["--kind", "minor", "--at", "@sha"], status: 1, err: [/"The api returns a promise\." names no shot/u] }],
  },
  {
    name: "--at takes the tag and version from the commit's module.json, not the working tree's",
    args: ["--kind", "hotfix"],
    shots: [],
    commit: true,
    after: (ctx) => ctx.write("module.json", `${JSON.stringify({ id: "widget", version: `${LAST_YEAR}.1.20` }, null, 2)}\n`),
    status: 0,
    out: [new RegExp(`release-preflight: v${LAST_YEAR}\\.1\\.20 clear \\(hotfix\\)`, "u")],
    also: [{ args: ["--kind", "hotfix", "--at", "@sha"], status: 0, out: [new RegExp(`release-preflight: v${TODAY_RE} clear \\(hotfix\\)`, "u")], notOut: [new RegExp(`${LAST_YEAR}\\.1\\.20`, "u")] }],
  },
  {
    name: "--at sees a runtime change committed after the tag and ignores one only the working tree holds",
    args: ["--kind", "hotfix"],
    changelog: `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n`,
    shots: [],
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    commit: true,
    after: (ctx) => ctx.write("scripts/other/run.mjs", "export {};\n"),
    status: 1,
    err: [/scripts\/gadget\/ changed since v11\.14\.5 but docs\/gadget\/TESTING\.md does not exist/u, /scripts\/other\/ changed since v11\.14\.5/u],
    also: [{ args: ["--kind", "hotfix", "--at", "@sha"], status: 1, err: [/scripts\/gadget\/ changed since v11\.14\.5/u], notErr: [/scripts\/other\//u] }],
  },
  {
    name: "a feature removed whole since the tag owes no recipe, in the working tree or under --at",
    args: ["--kind", "hotfix"],
    changelog: `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n`,
    shots: [],
    base: { "scripts/gadget/run.mjs": "export {};\n", "docs/gadget/TESTING.md": "# Gadget\n" },
    setup: (ctx) => ctx.git("rm", "-r", "-q", "scripts/gadget", "docs/gadget"),
    commit: true,
    status: 0,
    notErr: [/scripts\/gadget\//u],
    also: [{ args: ["--kind", "hotfix", "--at", "@sha"], status: 0, notErr: [/scripts\/gadget\//u] }],
  },
  {
    name: "--at asks for a recipe the commit holds and not one only the working tree holds",
    args: ["--kind", "hotfix"],
    changelog: `# Changelog\n\n## ${TODAY}\n\n### Fixed\n\n- **A fix.** Nothing owed.\n`,
    shots: [],
    work: { "scripts/gadget/run.mjs": "export {};\n" },
    commit: true,
    after: (ctx) => ctx.write("docs/gadget/TESTING.md", "# Gadget\n"),
    status: 0,
    out: [/docs\/gadget\/TESTING\.md/u],
    also: [{ args: ["--kind", "hotfix", "--at", "@sha"], status: 1, err: [/docs\/gadget\/TESTING\.md does not exist/u] }],
  },
  {
    ...rolledCase("--at reads the archive the commit holds: an edit made in the working tree alone fails only the plain run", {}),
    commit: true,
    after: (ctx) => ctx.write(ARCHIVE, `${ctx.read(ARCHIVE)}An edit.\n`),
    status: 1,
    err: [/FAIL logs-rolled: docs\/DECISIONS-through-v11\.14\.5\.md differs from docs\/DECISIONS\.md at v11\.14\.5/u],
    also: [{ args: ["--kind", "major", "--at", "@sha"], status: 0, out: [/clear \(major\)/u], notErr: [/logs-rolled/u] }],
  },
  {
    ...rolledCase("--at reads the commit's release folders and guides: a link added in the working tree alone does not pass it", {}),
    commit: true,
    setup: (ctx) => {
      prepareRolled(ctx);
      ctx.write("docs/releases/v11.14.0/old.png", "not a real png\n");
    },
    after: (ctx) => ctx.write("docs/guides/foo.md", `${ctx.read("docs/guides/foo.md")}![old](../releases/v11.14.0/old.png)\n`),
    status: 0,
    out: [/clear \(major\)/u],
    also: [{ args: ["--kind", "major", "--at", "@sha"], status: 1, err: [/FAIL logs-rolled: docs\/releases\/v11\.14\.0\/ is linked by no guide/u] }],
  },

  // -- live-walks, every kind ---------------------------------------------------
  {
    name: "live-walks: a repo with no runner prints no walks and passes",
    args: ["--kind", "hotfix"],
    base: { "tools/live/alpha.mjs": "export {};\n" },
    shots: [],
    status: 0,
    out: [/note: live-walks: no walks/u, /clear \(hotfix\)/u],
    notOut: [/walks \(live-walks\)/u],
  },
  walkMajor("live-walks: a major with a runner and no result file is refused, and --live-pending lists every walk as not run", {
    status: 1,
    err: [new RegExp(`FAIL live-walks: no result file at ${RESULT_RE} — run alpha, beta with tools/live/run\\.mjs`, "u"), ONE_BLOCKER],
    also: [{
      args: ["--kind", "major", "--live-pending"],
      status: 0,
      out: [/walks to run in the live session:\n {2}alpha {2}not run\n {2}beta {2}not run\n/u, /clear \(major\)/u],
    }],
  }),
  walkMajor("live-walks: a tracked result file is refused, --live-pending included", {
    after: recorded((ctx) => ctx.git("add", "-f", "--", RESULT_PATH)),
    status: 1,
    err: [new RegExp(`FAIL live-walks: ${RESULT_RE} is tracked`, "u"), ONE_BLOCKER],
    also: [{ args: ["--kind", "major", "--live-pending"], status: 1, err: [/live-walks: [^\n]* is tracked/u] }],
  }),
  walkMajor("live-walks: --at refuses a result file the commit holds, which the working tree no longer tracks", {
    commit: true,
    setup: (ctx) => {
      prepareRolled(ctx);
      recorded((c) => c.git("add", "-f", "--", RESULT_PATH))(ctx);
    },
    after: (ctx) => ctx.git("rm", "--cached", "-q", "--", RESULT_PATH),
    status: 0,
    out: [/walks \(live-walks\):/u],
    also: [{ args: ["--kind", "major", "--at", "@sha"], status: 1, err: [new RegExp(`FAIL live-walks: ${RESULT_RE} is tracked`, "u")] }],
  }),
  walkMajor("live-walks: a result file of an unknown schema is refused, --live-pending included", {
    after: (ctx) => ctx.write(RESULT_PATH, `${JSON.stringify({ schema: 2, walks: {} })}\n`),
    status: 1,
    err: [/FAIL live-walks: [^\n]* is unreadable or of an unknown schema \(schema 2\)/u, ONE_BLOCKER],
    also: [{ args: ["--kind", "major", "--live-pending"], status: 1, err: [/unknown schema \(schema 2\)/u] }],
  }),
  walkMajor("live-walks: a result file that is not JSON is refused", {
    after: (ctx) => ctx.write(RESULT_PATH, "{ not json"),
    status: 1,
    err: [/FAIL live-walks: [^\n]* is unreadable or of an unknown schema \(unreadable\)/u, ONE_BLOCKER],
  }),
  walkMajor("live-walks: a major with both walks passed on the current tree is clear and lists them", {
    after: recorded(),
    status: 0,
    out: [/clear \(major\)/u, /walks \(live-walks\):\n {2}alpha {2}passed\n {2}beta {2}passed\n/u],
    notOut: [/walks to run/u],
  }),
  walkMajor("live-walks: a major requires a walk no recipe names", {
    after: (ctx) => record(ctx, "alpha"),
    status: 1,
    err: [/FAIL live-walks: beta — not run/u, ONE_BLOCKER],
    notErr: [/alpha/u],
  }),
  walkMajor("live-walks: a runtime edit after the walks names the path and refuses both", {
    after: recorded((ctx) => ctx.write("scripts/foo/run.mjs", "export {};\n")),
    status: 1,
    err: [/FAIL live-walks: alpha — stale: runtime differs — scripts\/foo\/run\.mjs/u, /FAIL live-walks: beta — stale: runtime differs — scripts\/foo\/run\.mjs/u, /2 blocker\(s\)/u],
  }),
  walkMajor("live-walks: --live-pending lists a stale walk instead of refusing it, and leaves a current one out", {
    args: ["--kind", "major", "--live-pending"],
    after: (ctx) => {
      record(ctx, "alpha");
      ctx.write("scripts/foo/run.mjs", "export {};\n");
      record(ctx, "beta");
    },
    status: 0,
    out: [/walks to run in the live session:\n {2}alpha {2}stale: runtime differs — scripts\/foo\/run\.mjs\n/u, /clear \(major\)/u],
    notOut: [/beta {2}/u],
  }),
  walkMajor("live-walks: a walk's own file edited after its run is stale", {
    after: recorded((ctx) => ctx.write("tools/live/alpha.mjs", `${ctx.read("tools/live/alpha.mjs")}// edited\n`)),
    status: 1,
    err: [/FAIL live-walks: alpha — stale: the walk changed since it ran/u, ONE_BLOCKER],
    notErr: [/beta/u],
  }),
  walkMajor("live-walks: a walk whose tree changed during its run, and a partial one, are refused", {
    after: (ctx) => {
      record(ctx, "alpha", { treeStart: NONE });
      record(ctx, "beta", { partial: "ran 3 of 9 checks" });
    },
    status: 1,
    err: [/FAIL live-walks: alpha — the runtime changed during its run/u, /FAIL live-walks: beta — partial: ran 3 of 9 checks/u, /2 blocker\(s\)/u],
  }),
  walkMajor("live-walks: a failed walk with no classification is refused", {
    after: failedAlpha(null),
    status: 1,
    err: [/FAIL live-walks: alpha — failed, not classified/u, ONE_BLOCKER],
  }),
  walkMajor("live-walks: a failure classified world-state on a new row for this version is clear", {
    after: failedAlpha("world-state", "new"),
    status: 0,
    out: [/clear \(major\)/u, new RegExp(`alpha {2}classified world-state ${T_ROW} \\(new\\)`, "u"), /beta {2}passed/u],
  }),
  walkMajor("live-walks: a classification made for another version is refused", {
    after: failedAlpha("world-state", "new", "2026.1.1"),
    status: 1,
    err: [/FAIL live-walks: alpha — classified for 2026\.1\.1; classify again for this release/u, ONE_BLOCKER],
  }),
  walkMajor("live-walks: a defect on a claimed row does not ship", {
    after: failedAlpha("defect", "claimed"),
    status: 1,
    err: [/FAIL live-walks: alpha — a defect ships only when its row is deferred/u, ONE_BLOCKER],
  }),
  walkMajor("live-walks: a defect on a deferred row ships", {
    after: failedAlpha("defect", "deferred"),
    status: 0,
    out: [/clear \(major\)/u, new RegExp(`alpha {2}classified defect ${T_ROW} \\(deferred\\)`, "u")],
  }),
  walkMajor("live-walks: a CRLF flip of a runtime file after the walks leaves them current", {
    after: recorded((ctx) => ctx.write("lang/en.json", ctx.read("lang/en.json").replaceAll("\n", "\r\n"))),
    status: 0,
    out: [/clear \(major\)/u, /alpha {2}passed/u],
  }),
  walkMajor("live-walks: the tree is the commit's under --at, though the working tree has moved on", {
    commit: true,
    after: recorded((ctx) => ctx.write("scripts/foo/run.mjs", "export {};\n")),
    status: 1,
    err: [/FAIL live-walks: alpha — stale: runtime differs — scripts\/foo\/run\.mjs/u],
    also: [{ args: ["--kind", "major", "--at", "@sha"], status: 0, out: [/note: reading commit /u, /clear \(major\)/u, /alpha {2}passed/u] }],
  }),
  walkMinor("live-walks: a minor requires only the walks its changed surface's recipe names", "# Gadget\n\nWalk tools/live/alpha.mjs.\n", {
    after: (ctx) => record(ctx, "alpha"),
    status: 0,
    out: [/clear \(minor\)/u, /walks \(live-walks\):\n {2}alpha {2}passed\n/u],
    notOut: [/beta/u],
  }),
  walkMinor("live-walks: the walk a minor's recipe names is refused when it was not run", "# Gadget\n\nWalk tools/live/alpha.mjs.\n", {
    after: (ctx) => record(ctx, "beta"),
    status: 1,
    err: [/FAIL live-walks: alpha — not run/u, ONE_BLOCKER],
    notErr: [/beta/u],
  }),
  walkMinor("live-walks: a recipe naming a file that is not a walk is refused", "# Gadget\n\nWalk tools/live/alpha.mjs and tools/live/ghost.mjs.\n", {
    after: (ctx) => record(ctx, "alpha"),
    status: 1,
    err: [/FAIL live-walks: docs\/gadget\/TESTING\.md names tools\/live\/ghost\.mjs, which is not a walk/u, ONE_BLOCKER],
  }),
  walkMinor("live-walks: a recipe naming no walk is noted, and with none required nothing is asked of the result file", "# Gadget\n\nWalked by hand.\n", {
    args: ["--kind", "hotfix"],
    status: 0,
    out: [/note: docs\/gadget\/TESTING\.md names no walk — its surface is walked by hand/u, /note: live-walks: no walk required/u, /clear \(hotfix\)/u],
    notOut: [/walks \(live-walks\)/u],
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
      if (!testCase.noShotDir) {
        const shotDir = path.join(root, "docs", "releases", `v${version}`);
        fs.mkdirSync(shotDir, { recursive: true });
        for (const name of testCase.shots) fs.writeFileSync(path.join(shotDir, name), "not a real png\n");
      }
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
