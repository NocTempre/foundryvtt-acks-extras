/**
 * Starts the logs tool (`compile`, `preview`, `roll`) in throwaway git
 * repositories and checks its exit status, what it prints and what it writes.
 * Each case is a module whose commits, tags, working-tree edits and staged
 * paths the case names. The tool finds its repository from where it stands, so
 * each case copies it into the case's own `tools/`.
 *
 * `compile` cases cover the grouping and order of a section, its heading with
 * and without a label, the refusals (an unparseable tracked name, an existing
 * section, a non-empty `## Unreleased`, no fragment) and what it leaves alone
 * (untracked fragments, a preview's files). `roll` cases cover the archives
 * (byte-identical to the tag's blobs), the rewritten live DECISIONS and
 * CHANGELOG, the index anchors, what is flagged for a reviewer, the previous
 * tag's choice and a second run. A later roll, on a live DECISIONS an earlier
 * roll already rewrote, is checked for the carried index, the new archive's
 * rows, a row removed between the rolls, a repeat run and the preflight's
 * `logs-rolled` verdict on the result.
 *
 * Usage:  node tools/toolchain-tests/test-logs.mjs [<logs.mjs>]
 *         (defaults to tools/logs.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const LOGS = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "tools", "logs.mjs"));

// A caller's own repository variables would turn every git call toward the
// caller's repository, and a runner has no identity to commit as.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (root, args) => execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const AT = "DECISIONS-through-v11.14.5.md";

// Every heading, entry and slug below is invented.
const CHANGELOG_TAGGED = `# Changelog

Preamble line.

## 11.14.5

### Added

- **Five.** Shipped at the tag.

## 11.14.4

- **Four.** Shipped before it.
`;
const DECISIONS_TAGGED = `# Decisions

Intro line.

## 2026-10-01 — First ruling: what's "in" (v2) — IN FORCE

Body one.

## 2026-10-02 — Twin

First twin.

## 2026-10-02 — Twin

Second twin.

## 2026-10-04 — Old policy — SUPERSEDED 2026-10-09

Gone.

## 2026-10-05 — Partial — SUPERSEDED IN PART

Body.

## Undated notes

Notes.

## 2026-10-06 — Quiet

This one says it supersedes the old way and carries on.
`;
const DECISIONS_SUB_TAGGED = "# Foo decisions\n\n## 2026-09-01 — Only\n\nBody.\n";
const ROADMAP_TAGGED = "# Foo roadmap\n\n- [x] built\n- [ ] not built\n";

/** The files every roll case holds at its tag. */
const ROLL_BASE = {
  "CHANGELOG.md": CHANGELOG_TAGGED,
  "docs/DECISIONS.md": DECISIONS_TAGGED,
  "docs/foo/DECISIONS.md": DECISIONS_SUB_TAGGED,
  "docs/foo/ROADMAP.md": ROADMAP_TAGGED,
  "docs/guides/foo.md": "![shot](../releases/v11.14.5/foo.png)\n",
  "docs/releases/v11.14.5/foo.png": "not a real png\n",
  "docs/releases/v11.14.0/old.png": "not a real png\n",
};

const FRAGMENTS = {
  "changelog.d/2026-11-12-zeta.fixed.md": "- **Fix z.** Fixed it.\n",
  "changelog.d/2026-11-11-beta.added.md": "\n- **Add b.** Adds b. <!-- shot: widget-b -->\n\n",
  "changelog.d/2026-11-12-alpha.added.md": "- **Add a.** Adds a,\n  and goes on.\n",
  "changelog.d/2026-11-09-up.upgrading.md": "- **Up.** Do this first.\n",
  "changelog.d/2026-11-10-ch.changed.md": "- **Change c.** Changed.\n",
  "changelog.d/2026-11-10-rm.removed.md": "- **Remove r.** Removed.\n",
};
const FRAGMENT_PATHS = Object.keys(FRAGMENTS);
const COMPILE_BASE = { "CHANGELOG.md": CHANGELOG_TAGGED };

/** A check that every archive named holds the tag's blob byte for byte. */
const archivesMatch = (tag, pairs) => (root) =>
  pairs.flatMap(([archive, source]) => {
    if (!fs.existsSync(path.join(root, archive))) return [`${archive} was not written`];
    const have = git(root, ["hash-object", "--", archive]);
    const want = git(root, ["rev-parse", `${tag}:${source}`]);
    return have === want ? [] : [`${archive} hashes ${have}, the tag's ${source} is ${want}`];
  });

const ROLL_ARCHIVES = archivesMatch("v11.14.5", [
  ["CHANGELOG-through-v11.14.5.md", "CHANGELOG.md"],
  [`docs/${AT}`, "docs/DECISIONS.md"],
  [`docs/foo/${AT}`, "docs/foo/DECISIONS.md"],
]);
/** One commit holding ROLL_BASE, tagged as the two versions the CHANGELOG's sections name. */
const ROLL_COMMITS = [{ files: ROLL_BASE, tags: ["v11.14.4", "v11.14.5"] }];

// A module rolled twice: v2026.1.1 holds Alpha, v2026.1.2 holds the live file the
// first roll left (an index row for Alpha) plus the Beta ruling made after it.
const X_ARCHIVE_1 = "docs/x/DECISIONS-through-v2026.1.1.md";
const X_ARCHIVE_2 = "docs/x/DECISIONS-through-v2026.1.2.md";
const X_V1 = "# X decisions\n\n## 2026-01-01 — Alpha — IN FORCE\n\nalpha body\n";
const X_POINTER_1 = "Rulings through v2026.1.1: [DECISIONS-through-v2026.1.1.md](DECISIONS-through-v2026.1.1.md).";
const X_POINTER_2 = "Rulings through v2026.1.2: [DECISIONS-through-v2026.1.2.md](DECISIONS-through-v2026.1.2.md).";
const X_ROW_ALPHA = "- 2026-01-01 — [Alpha — IN FORCE](DECISIONS-through-v2026.1.1.md#2026-01-01--alpha--in-force)";
const X_ROW_BETA = "- 2026-01-02 — [Beta — IN FORCE](DECISIONS-through-v2026.1.2.md#2026-01-02--beta--in-force)";
const X_BETA = "## 2026-01-02 — Beta — IN FORCE\n\nbeta body\n";
const X_GAMMA = "## 2026-01-03 — Gamma — IN FORCE\n\ngamma body\n";
const X_AFTER_FIRST = `# X decisions\n\n${X_POINTER_1}\n\n## In force\n\n${X_ROW_ALPHA}\n\n${X_BETA}`;
const X_LIVE_WITH_GAMMA = `${X_AFTER_FIRST}\n${X_GAMMA}`;
const X_LIVE_ALPHA_SUPERSEDED = `# X decisions\n\n${X_POINTER_1}\n\n## In force\n\n${X_BETA}`;
const X_ROLLED_TWICE = `# X decisions\n\n${X_POINTER_1}\n\n${X_POINTER_2}\n\n## In force\n\n${X_ROW_ALPHA}\n${X_ROW_BETA}\n\n${X_GAMMA}`;
const ROLL_TWICE_COMMITS = [
  { files: { "docs/x/DECISIONS.md": X_V1 }, tags: ["v2026.1.1"] },
  { files: { [X_ARCHIVE_1]: X_V1, "docs/x/DECISIONS.md": X_AFTER_FIRST }, tags: ["v2026.1.2"] },
];

/** A regex that matches exactly `text`. */
const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u");

/**
 * Runs the release preflight (`--kind major --live-pending`) in the
 * case's repository and returns a problem for every `logs-rolled` line it
 * prints, or for a run that printed nothing at all.
 */
function preflightLogsRolled(root) {
  for (const file of ["release-preflight.mjs", "walk-results.mjs"]) put(root, `tools/${file}`, fs.readFileSync(path.join(TEMPLATE_ROOT, "tools", file), "utf8"));
  const r = spawnSync(process.execPath, [path.join("tools", "release-preflight.mjs"), "--kind", "major", "--live-pending"], { cwd: root, env: GIT_ENV, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  if (!text.trim()) return ["release-preflight printed nothing"];
  return text.split("\n").filter((l) => /logs-rolled/u.test(l)).map((l) => `preflight: ${l.trim()}`);
}

const CASES = [
  // -- compile -----------------------------------------------------------------
  {
    name: "compile groups by category, orders by file name, keeps a shot marker and deletes the fragments",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: FRAGMENTS,
    stage: FRAGMENT_PATHS,
    args: ["compile", "--label", "Public Beta"],
    status: 0,
    out: [/CHANGELOG\.md gains ## 2026\.11\.12 from 6 fragment\(s\)/u],
    files: {
      "CHANGELOG.md": [
        /^## 2026\.11\.12 — Public Beta$/mu,
        /Preamble line\.\n\n## 2026\.11\.12 — Public Beta\n\n### Upgrading\n\n- \*\*Up\.\*\*[\s\S]*### Added\n\n- \*\*Add b\.\*\*[\s\S]*- \*\*Add a\.\*\* Adds a,\n {2}and goes on\.\n\n### Changed[\s\S]*### Removed[\s\S]*### Fixed\n\n- \*\*Fix z\.\*\*[^#]*\n\n## 11\.14\.5/u,
        /<!-- shot: widget-b -->/u,
      ],
    },
    absent: FRAGMENT_PATHS,
  },
  {
    name: "compile with no label writes a bare version heading",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: FRAGMENTS,
    stage: FRAGMENT_PATHS,
    args: ["compile"],
    status: 0,
    files: { "CHANGELOG.md": [/^## 2026\.11\.12$/mu] },
    filesNot: { "CHANGELOG.md": [/2026\.11\.12 —/u] },
  },
  {
    name: "compile refuses a tracked name that does not parse and writes nothing",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { ...FRAGMENTS, "changelog.d/notes.md": "- stray\n" },
    stage: [...FRAGMENT_PATHS, "changelog.d/notes.md"],
    args: ["compile"],
    status: 1,
    err: [/whose name is not <YYYY-MM-DD>-<row id or slug>\.<upgrading\|added\|changed\|removed\|fixed>\.md[\s\S]*changelog\.d\/notes\.md/u],
    filesNot: { "CHANGELOG.md": [/2026\.11\.12/u] },
    present: FRAGMENT_PATHS,
  },
  {
    name: "compile refuses a version that already has a section",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { ...FRAGMENTS, "CHANGELOG.md": CHANGELOG_TAGGED.replace("## 11.14.5", "## 2026.11.12 — Public Beta\n\n- **Mine.**\n\n## 11.14.5") },
    stage: FRAGMENT_PATHS,
    args: ["compile"],
    status: 1,
    err: [/CHANGELOG\.md already has a section for 2026\.11\.12/u],
    present: FRAGMENT_PATHS,
  },
  {
    name: "compile refuses a non-empty ## Unreleased",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { ...FRAGMENTS, "CHANGELOG.md": CHANGELOG_TAGGED.replace("## 11.14.5", "## Unreleased\n\n### Added\n\n- **Loose bullet.**\n\n## 11.14.5") },
    stage: FRAGMENT_PATHS,
    args: ["compile"],
    status: 1,
    err: [/non-empty ## Unreleased — turn each of its bullets into a changelog\.d\/ fragment/u],
    present: FRAGMENT_PATHS,
  },
  {
    name: "compile drops an empty ## Unreleased",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { ...FRAGMENTS, "CHANGELOG.md": CHANGELOG_TAGGED.replace("## 11.14.5", "## Unreleased\n\n### Added\n\n## 11.14.5") },
    stage: FRAGMENT_PATHS,
    args: ["compile"],
    status: 0,
    files: { "CHANGELOG.md": [/^## 2026\.11\.12$/mu, /^## 11\.14\.5$/mu] },
    filesNot: { "CHANGELOG.md": [/Unreleased/u] },
  },
  {
    name: "compile leaves an untracked fragment alone and says so",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { ...FRAGMENTS, "changelog.d/2026-11-12-gamma.added.md": "- **Peer's.**\n" },
    stage: FRAGMENT_PATHS,
    args: ["compile"],
    status: 0,
    out: [/not compiled \(untracked\): changelog\.d\/2026-11-12-gamma\.added\.md/u],
    filesNot: { "CHANGELOG.md": [/Peer's/u] },
    present: ["changelog.d/2026-11-12-gamma.added.md"],
    absent: FRAGMENT_PATHS,
  },
  {
    name: "compile with no tracked fragment says there is nothing to compile",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: { "changelog.d/2026-11-12-gamma.added.md": "- **Untracked.**\n" },
    args: ["compile"],
    status: 1,
    err: [/nothing to compile/u],
  },
  {
    name: "preview prints the section and changes nothing",
    commits: [{ files: COMPILE_BASE, tags: ["v11.14.5"] }],
    work: FRAGMENTS,
    stage: FRAGMENT_PATHS,
    args: ["preview", "--label", "Public Beta"],
    status: 0,
    out: [/^## 2026\.11\.12 — Public Beta$/mu, /### Added\n\n- \*\*Add b\.\*\*/u, /<!-- shot: widget-b -->/u],
    notOut: [/## 11\.14\.5/u],
    filesNot: { "CHANGELOG.md": [/2026\.11\.12/u] },
    present: FRAGMENT_PATHS,
  },

  // -- roll --------------------------------------------------------------------
  {
    name: "roll archives each log byte for byte and rewrites the live DECISIONS with an index",
    commits: ROLL_COMMITS,
    work: {
      "docs/DECISIONS.md": `${DECISIONS_TAGGED.replace("First twin.", "First twin, amended.")}\n## 2026-11-10 — After the tag\n\nNew.\n`,
      "CHANGELOG.md": `${CHANGELOG_TAGGED.replace("## 11.14.5", "## 2026.11.12 — Public Beta\n\n- **New.**\n\n## 11.14.5")}`,
    },
    args: ["roll"],
    status: 0,
    out: [/logs: rolling from v11\.14\.5/u],
    check: ROLL_ARCHIVES,
    files: {
      "docs/DECISIONS.md": [
        new RegExp(`^# Decisions\\n\\nRulings through v11\\.14\\.5: \\[${AT.replaceAll(".", "\\.")}\\]\\(${AT.replaceAll(".", "\\.")}\\)\\.\\n\\n## In force\\n\\n- 2026-10-01`, "u"),
        new RegExp(`^- 2026-10-01 — \\[First ruling: what's "in" \\(v2\\) — IN FORCE\\]\\(${AT.replaceAll(".", "\\.")}#2026-10-01--first-ruling-whats-in-v2--in-force\\)$`, "mu"),
        new RegExp(`^- 2026-10-02 — \\[Twin\\]\\(${AT.replaceAll(".", "\\.")}#2026-10-02--twin\\)$`, "mu"),
        new RegExp(`^- 2026-10-02 — \\[Twin\\]\\(${AT.replaceAll(".", "\\.")}#2026-10-02--twin-1\\)$`, "mu"),
        new RegExp(`^- 2026-10-05 — \\[Partial — SUPERSEDED IN PART\\]\\(${AT.replaceAll(".", "\\.")}#2026-10-05--partial--superseded-in-part\\)$`, "mu"),
        new RegExp(`^- undated — \\[Undated notes\\]\\(${AT.replaceAll(".", "\\.")}#undated-notes\\)$`, "mu"),
        new RegExp(`^- 2026-10-06 — \\[Quiet\\]\\(${AT.replaceAll(".", "\\.")}#2026-10-06--quiet\\)$`, "mu"),
        /\n\n## 2026-11-10 — After the tag\n\nNew\.\n$/u,
      ],
      "docs/foo/DECISIONS.md": [new RegExp(`^- 2026-09-01 — \\[Only\\]\\(${AT.replaceAll(".", "\\.")}#2026-09-01--only\\)$`, "mu")],
      "CHANGELOG.md": [
        /^# Changelog\n\nPreamble line\.\n\nChanges through v11\.14\.5: \[CHANGELOG-through-v11\.14\.5\.md\]\(CHANGELOG-through-v11\.14\.5\.md\)\.\n\n## 2026\.11\.12 — Public Beta\n\n- \*\*New\.\*\*\n$/u,
      ],
    },
    filesNot: {
      "docs/DECISIONS.md": [/Old policy/u, /First twin/u, /Intro line/u],
      "CHANGELOG.md": [/## 11\.14\.5/u, /## 11\.14\.4/u],
    },
  },
  {
    name: "roll flags an IN PART, an undated and a superseding body, and drafts no row for a whole supersession",
    commits: ROLL_COMMITS,
    args: ["roll"],
    status: 0,
    out: [
      /review: IN PART: "2026-10-05 — Partial — SUPERSEDED IN PART"/u,
      /review: undated heading: "Undated notes"/u,
      /review: body mentions superseding: "2026-10-06 — Quiet"/u,
      /docs\/DECISIONS\.md: 6 index row\(s\) drafted from 7 archived entries; 0 entries after v11\.14\.5 kept/u,
    ],
    notOut: [/review: [^\n]*Old policy/u],
    filesNot: { "docs/DECISIONS.md": [/Old policy/u] },
  },
  {
    name: "roll lists an edit made after the tag inside an old entry, with its changed lines",
    commits: ROLL_COMMITS,
    work: { "docs/DECISIONS.md": DECISIONS_TAGGED.replace("First twin.", "First twin, amended.") },
    args: ["roll"],
    status: 0,
    out: [/edited after v11\.14\.5, inside an entry the archive holds[^\n]*: "2026-10-02 — Twin"\n {4}\+ First twin, amended\.\n {4}- First twin\./u],
    notOut: [/edited after[^\n]*Quiet/u],
  },
  {
    name: "roll lists the ROADMAP to re-issue and the orphaned shot folder, deleting and writing neither",
    commits: ROLL_COMMITS,
    args: ["roll"],
    status: 0,
    out: [/re-issue [^\n]*Re-issued \d{4}-\d{2}-\d{2}\.[^\n]*: docs\/foo\/ROADMAP\.md/u, /unlinked shot folder [^\n]*: docs\/releases\/v11\.14\.0\//u],
    notOut: [/unlinked shot folder [^\n]*v11\.14\.5/u],
    files: { "docs/foo/ROADMAP.md": [/- \[x\] built/u] },
    filesNot: { "docs/foo/ROADMAP.md": [/Re-issued/u] },
    present: ["docs/releases/v11.14.0/old.png"],
  },
  {
    name: "roll cuts at the highest tag by Foundry's compare, not the string-sorted or the nearest",
    commits: [
      { files: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — A\n\nOldest.\n" }, tags: ["v11.14.5"] },
      { files: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — B\n\nTwelve-fifteen.\n" }, tags: ["v2026.12.15"] },
      { files: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — C\n\nTwelve-nine, the nearest.\n" }, tags: ["v2026.12.9"] },
    ],
    version: "2027.1.1",
    args: ["roll"],
    status: 0,
    out: [/logs: rolling from v2026\.12\.15/u],
    check: archivesMatch("v2026.12.15", [["docs/DECISIONS-through-v2026.12.15.md", "docs/DECISIONS.md"]]),
    absent: ["docs/DECISIONS-through-v2026.12.9.md", "docs/DECISIONS-through-v11.14.5.md"],
  },
  {
    name: "roll --prev cuts at the tag it names",
    commits: [
      { files: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — A\n\nOldest.\n" }, tags: ["v11.14.5"] },
      { files: { "docs/DECISIONS.md": "# Decisions\n\n## 2026-10-01 — B\n\nNewer.\n" }, tags: ["v2026.12.15"] },
    ],
    version: "2027.1.1",
    args: ["roll", "--prev", "v11.14.5"],
    status: 0,
    out: [/logs: rolling from v11\.14\.5/u],
    check: archivesMatch("v11.14.5", [["docs/DECISIONS-through-v11.14.5.md", "docs/DECISIONS.md"]]),
    absent: ["docs/DECISIONS-through-v2026.12.15.md"],
  },
  {
    name: "roll with no tag at all exits 1 and says so",
    commits: [{ files: ROLL_BASE, tags: [] }],
    args: ["roll"],
    status: 1,
    err: [/no v\* tag to roll from/u],
    absent: ["docs/" + AT],
  },
  {
    name: "roll refuses an archive that exists with other bytes and writes nothing",
    commits: ROLL_COMMITS,
    work: { "docs/foo/DECISIONS-through-v11.14.5.md": "edited\n" },
    args: ["roll"],
    status: 1,
    err: [/archive exists with bytes that differ from v11\.14\.5's[\s\S]*docs\/foo\/DECISIONS-through-v11\.14\.5\.md/u],
    absent: ["docs/" + AT, "CHANGELOG-through-v11.14.5.md"],
  },
  {
    name: "a second roll finds the logs rolled and leaves them as they are",
    commits: ROLL_COMMITS,
    again: true,
    args: ["roll"],
    status: 0,
    out: [/archive already in place: docs\/DECISIONS-through-v11\.14\.5\.md\ndocs\/DECISIONS\.md: already links DECISIONS-through-v11\.14\.5\.md/u, /CHANGELOG\.md: already links CHANGELOG-through-v11\.14\.5\.md/u],
    check: ROLL_ARCHIVES,
    files: { "docs/DECISIONS.md": [/^- 2026-10-06 — \[Quiet\]/mu] },
  },

  // -- a later roll, on a live DECISIONS an earlier roll already rewrote -------
  {
    name: "a later roll carries the live index forward, adds the new archive's rows and keeps what landed after the tag",
    commits: ROLL_TWICE_COMMITS,
    version: "2026.1.3",
    work: { "docs/x/DECISIONS.md": X_LIVE_WITH_GAMMA },
    args: ["roll"],
    status: 0,
    out: [/logs: rolling from v2026\.1\.2/u, /docs\/x\/DECISIONS\.md: 1 index row\(s\) drafted from 1 archived entry, 1 carried from the live index; 1 entry after v2026\.1\.2 kept/u],
    check: (root) => [...archivesMatch("v2026.1.2", [[X_ARCHIVE_2, "docs/x/DECISIONS.md"]])(root), ...preflightLogsRolled(root)],
    files: {
      "docs/x/DECISIONS.md": [exact(X_ROLLED_TWICE), /^- 2026-01-02 — \[Beta — IN FORCE\]\(DECISIONS-through-v2026\.1\.2\.md#2026-01-02--beta--in-force\)$/mu],
    },
    filesNot: { "docs/x/DECISIONS.md": [/beta body/u, /^## 2026-01-02/mu] },
  },
  {
    name: "a later roll leaves a row removed from the live index removed",
    commits: [
      { files: { "docs/x/DECISIONS.md": X_V1 }, tags: ["v2026.1.1"] },
      { files: { [X_ARCHIVE_1]: X_V1, "docs/x/DECISIONS.md": X_LIVE_ALPHA_SUPERSEDED }, tags: ["v2026.1.2"] },
    ],
    version: "2026.1.3",
    args: ["roll"],
    status: 0,
    files: { "docs/x/DECISIONS.md": [/^- 2026-01-02 — \[Beta — IN FORCE\]\(DECISIONS-through-v2026\.1\.2\.md#/mu, /Rulings through v2026\.1\.1:/u, /Rulings through v2026\.1\.2:/u] },
    filesNot: { "docs/x/DECISIONS.md": [/^- 2026-01-01/mu] },
  },
  {
    name: "a later roll run twice leaves the live file as the first run wrote it",
    commits: ROLL_TWICE_COMMITS,
    version: "2026.1.3",
    work: { "docs/x/DECISIONS.md": X_LIVE_WITH_GAMMA },
    again: true,
    args: ["roll"],
    status: 0,
    out: [/archive already in place: docs\/x\/DECISIONS-through-v2026\.1\.2\.md\ndocs\/x\/DECISIONS\.md: already links DECISIONS-through-v2026\.1\.2\.md/u],
    files: { "docs/x/DECISIONS.md": [exact(X_ROLLED_TWICE)] },
  },
];

/** Writes `content` at `rel` under `root`, creating its directories. */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-logs-"));
let failures = 0;
try {
  CASES.forEach((testCase, i) => {
    const problems = [];
    try {
      const root = path.join(tmp, `case-${i}`);
      fs.mkdirSync(path.join(root, "tools"), { recursive: true });
      git(root, ["init", "-q", "-b", "main"]);
      git(root, ["config", "core.autocrlf", "false"]);
      for (const commit of testCase.commits) {
        put(root, "module.json", `${JSON.stringify({ id: "widget", version: "11.14.5" }, null, 2)}\n`);
        put(root, "tools/logs.mjs", fs.readFileSync(LOGS, "utf8"));
        for (const [rel, content] of Object.entries(commit.files)) put(root, rel, content);
        git(root, ["add", "-A"]);
        git(root, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "commit"]);
        for (const t of commit.tags) git(root, ["tag", t]);
      }
      put(root, "module.json", `${JSON.stringify({ id: "widget", version: testCase.version ?? "2026.11.12" }, null, 2)}\n`);
      for (const [rel, content] of Object.entries(testCase.work ?? {})) put(root, rel, content);
      for (const rel of testCase.stage ?? []) git(root, ["add", "--", rel]);
      const run = () => spawnSync(process.execPath, [path.join("tools", "logs.mjs"), ...testCase.args], { cwd: root, env: GIT_ENV, encoding: "utf8" });
      let r = run();
      if (testCase.again) {
        if (r.status !== 0) problems.push(`the first run exited ${r.status}: ${r.stderr.trim()}`);
        r = run();
      }
      if (r.status !== testCase.status) problems.push(`exited ${r.status}, expected ${testCase.status}`);
      for (const [stream, text, expected, forbidden] of [
        ["stdout", r.stdout, testCase.out ?? [], testCase.notOut ?? []],
        ["stderr", r.stderr, testCase.err ?? [], testCase.notErr ?? []],
      ]) {
        for (const re of expected) if (!re.test(text)) problems.push(`${stream} does not match ${re}`);
        for (const re of forbidden) if (re.test(text)) problems.push(`${stream} matches ${re}`);
      }
      const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : null);
      for (const [rel, res] of Object.entries(testCase.files ?? {})) {
        const text = read(rel);
        if (text === null) problems.push(`${rel} is missing`);
        else for (const re of res) if (!re.test(text)) problems.push(`${rel} does not match ${re}`);
      }
      for (const [rel, res] of Object.entries(testCase.filesNot ?? {})) {
        const text = read(rel) ?? "";
        for (const re of res) if (re.test(text)) problems.push(`${rel} matches ${re}`);
      }
      for (const rel of testCase.absent ?? []) if (fs.existsSync(path.join(root, rel))) problems.push(`${rel} exists`);
      for (const rel of testCase.present ?? []) if (!fs.existsSync(path.join(root, rel))) problems.push(`${rel} is missing`);
      problems.push(...(testCase.check?.(root) ?? []));
      if (problems.length) problems.push(`stdout: ${r.stdout.trim() || "(empty)"}`, `stderr: ${r.stderr.trim() || "(empty)"}`);
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
const shown = path.relative(TEMPLATE_ROOT, LOGS);
console.log(`test-logs: ${CASES.length} cases against ${shown.startsWith("..") ? LOGS : shown}, ${failures} failed`);
if (failures) process.exit(1);
