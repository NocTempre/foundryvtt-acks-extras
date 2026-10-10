/**
 * IP quarantine — the pre-commit half of the leak gate. Synced from
 * acks-module-template; do not hand-edit.
 *
 * Commit time is the ONLY moment this can work. Once a flagged file is in a
 * commit, ignoring it later does not remove it from history, and the repo has
 * to be purged and force-pushed. So the hook runs here, before history
 * exists, on what the commit would hold: the index git is making it from,
 * never the work tree. A file edited, deleted or left half-written after it
 * was staged is judged as it was staged.
 *
 * A flagged file HEAD does not hold is quarantined:
 *   1. it leaves the index (nothing on disk is touched, so no work is lost),
 *   2. it is listed in info/exclude, which is a local-only ignore: it is never
 *      committed, so it cannot leak the filename and cannot reach a teammate,
 *   3. the commit proceeds with everything else.
 *
 * The commit lands, the push lands, the work is saved, and the licensed
 * material never leaves the machine. No repo visibility change is needed —
 * which matters, because GITHUB_TOKEN cannot make a repo private and CI runs
 * far too late anyway: by then the content is already on the remote.
 *
 * A flagged file HEAD already holds cannot be quarantined: git does not
 * ignore a tracked file, and taking one out of the index commits its removal.
 * That is a hard stop. Where HEAD's own copy is flagged, history is
 * contaminated and the stop says so; where HEAD's copy is clean, the staged
 * change is what brings the material in, and the stop says that instead.
 *
 * The commit proceeds only where what is still staged scans clean. A leak the
 * scanner names no staged path for, or a flagged file that is still staged
 * after the quarantine, stops it.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanPaths } from "./ip-scan.mjs";

/* The most git may print in one call: every path a commit stages, or every path HEAD holds. */
const GIT_OUTPUT_BYTES = 2 ** 30;

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (args, input) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", input, maxBuffer: GIT_OUTPUT_BYTES, stdio: ["pipe", "pipe", "pipe"] });
const nulList = (text) => text.split("\0").filter(Boolean);

/**
 * Every staged path this commit would add or change. A rename is listed as
 * its new path, and a file that changes type is listed; a removal is not,
 * since it brings nothing in.
 */
const stagedPaths = () => nulList(git(["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=d", "-z"]));

/** The paths HEAD holds as files: none on a repository's first commit, where HEAD does not resolve. */
function headPaths() {
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  } catch (e) {
    if (e.status === 1) return new Set();
    throw e;
  }
  return new Set(nulList(git(["ls-tree", "-r", "-z", "--name-only", "HEAD"])));
}

/** An exclude list is read line by line, so a name that holds a line break cannot be put in one. */
const listable = (file) => !/[\n\r]/u.test(file);

/**
 * The exclude-list line that matches this path and no other: anchored at the
 * top of the work tree, with the characters a pattern reads as wildcards, and
 * the trailing spaces it would drop, escaped.
 */
const ignoreLine = (file) => `/${file.replace(/[\\*?[]/gu, "\\$&").replace(/ +$/u, (spaces) => "\\ ".repeat(spaces.length))}`;

/** Refuse the commit: a hook that exits non-zero stops it. */
function stop(...lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const staged = stagedPaths();
if (!staged.length) process.exit(0);

const { errors, flagged } = scanPaths(ROOT, staged, { from: "index" });
if (!errors.length) process.exit(0);

console.error("\nip-quarantine: licensed material detected in the staged changes\n");
for (const e of errors) console.error(`  LEAK  ${e}`);

// The scanner says which paths it flagged; no path is read back out of an
// error's text, which a file's own name can break in two.
const named = new Set(Array.isArray(flagged) ? flagged : []);
const leaking = staged.filter((f) => named.has(f));
if (!leaking.length) stop("\n  The scanner names no staged path for this, so nothing can be taken out. Commit blocked.\n");

const inHead = headPaths();
const tracked = leaking.filter((f) => inHead.has(f));
if (tracked.length) {
  const contaminated = new Set(scanPaths(ROOT, tracked, { from: "HEAD" }).flagged);
  const committed = tracked.filter((f) => contaminated.has(f));
  const arriving = tracked.filter((f) => !contaminated.has(f));
  if (committed.length) {
    console.error("\n  These are ALREADY COMMITTED — quarantine cannot fix history:\n");
    for (const f of committed) console.error(`    ${f}`);
    console.error("\n  Purge them from history before pushing.");
  }
  if (arriving.length) {
    console.error("\n  These are tracked files that HEAD holds clean — the staged change brings the material in:\n");
    for (const f of arriving) console.error(`    ${f}`);
    console.error("\n  A tracked file cannot be quarantined. Take the material out and stage the file again,");
    console.error("  or unstage the change: git restore --staged <path>");
  }
  stop("\n  Commit blocked.\n");
}

// Out of the index whatever the work tree holds: git rm --cached refuses a
// file that was edited after it was staged.
git(["update-index", "--force-remove", "-z", "--stdin"], leaking.map((f) => `${f}\0`).join(""));

// Where git reads the list from, which is not under the work tree when .git is a file.
const listFile = path.resolve(ROOT, git(["rev-parse", "--git-path", "info/exclude"]).trim());
fs.mkdirSync(path.dirname(listFile), { recursive: true });
const existing = fs.existsSync(listFile) ? fs.readFileSync(listFile, "utf8") : "";
const listed = new Set(existing.split(/\r?\n/u));
const additions = leaking.filter(listable).map(ignoreLine).filter((line) => !listed.has(line));

if (additions.length) {
  const header = existing.includes("# ip-quarantine") ? "" : "\n# ip-quarantine — local-only, never committed. Licensed material kept off the remote.\n";
  fs.appendFileSync(listFile, `${existing.endsWith("\n") || !existing ? "" : "\n"}${header}${additions.join("\n")}\n`);
}

const remaining = stagedPaths();
const again = remaining.length ? scanPaths(ROOT, remaining, { from: "index" }).errors : [];
if (again.length) {
  console.error("\n  Still staged, and still flagged:\n");
  for (const e of again) console.error(`    ${e}`);
  stop("\n  The quarantine could not take them out. Commit blocked.\n");
}

console.error(`\n  Quarantined ${leaking.length} file(s): unstaged and locally ignored.`);
console.error(`  Nothing on disk is touched. Local-only ignore list: ${path.relative(ROOT, listFile).replaceAll("\\", "/")}`);

/* If the leak was the whole commit there is nothing left to record. Abort
 * rather than let git write an empty commit — the quarantine already did its
 * job, and a stray empty commit just muddies the log. */
if (!git(["diff", "--cached", "--name-only"]).trim()) {
  stop("\n  Nothing left to commit — that was the entire staged set. Commit aborted.\n");
}

console.error("  The rest of your commit proceeds normally.\n");
process.exit(0); // let the commit through — the leak is out of it
