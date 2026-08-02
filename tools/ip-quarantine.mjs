/**
 * IP quarantine — the pre-commit half of the leak gate. Synced from
 * acks-module-template; do not hand-edit.
 *
 * Commit time is the ONLY moment this can work. Once a flagged file is in a
 * commit, ignoring it later does not remove it from history, and the repo has
 * to be purged and force-pushed (as acks-formation was, 2026-07-17). So the
 * hook runs here, against the *staged* set, before history exists.
 *
 * On a flagged staged file:
 *   1. unstage it (the file stays on disk — nothing you wrote is lost),
 *   2. add it to .git/info/exclude, which is a local-only ignore: it is never
 *      committed, so it cannot leak the filename and cannot reach a teammate,
 *   3. let the commit proceed with everything else.
 *
 * The commit lands, the push lands, the work is saved, and the licensed
 * material never leaves the machine. No repo visibility change is needed —
 * which matters, because GITHUB_TOKEN cannot make a repo private and CI runs
 * far too late anyway: by then the content is already on the remote.
 *
 * If a flagged path is ALREADY in HEAD, quarantine cannot help — history is
 * contaminated. That is a hard stop, and it says so.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanPaths } from "./ip-scan.mjs";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
if (!staged.length) process.exit(0);

const { errors } = scanPaths(ROOT, staged);
if (!errors.length) process.exit(0);

/* An error line is "<path>: detail" or "<path> — detail"; recover the path and
 * keep only those that are genuinely staged (a directory hit maps to no file). */
const flagged = [...new Set(errors.map((e) => e.split(/:| — /u)[0].replace(/[/\\]$/u, "").replaceAll("\\", "/")))];
const stagedFlagged = staged.filter((f) => flagged.some((p) => f === p || f.startsWith(`${p}/`)));

const inHead = stagedFlagged.filter((f) => {
  try {
    // stdio: git is noisy on a root commit, where HEAD does not resolve yet.
    execFileSync("git", ["cat-file", "-e", `HEAD:${f}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

console.error("\nip-quarantine: licensed material detected in the staged changes\n");
for (const e of errors) console.error(`  LEAK  ${e}`);

if (inHead.length) {
  console.error("\n  These are ALREADY COMMITTED — quarantine cannot fix history:\n");
  for (const f of inHead) console.error(`    ${f}`);
  console.error("\n  Purge them from history before pushing. Commit blocked.\n");
  process.exit(1);
}

const excludeFile = path.join(ROOT, ".git", "info", "exclude");
fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
const additions = [];

for (const file of stagedFlagged) {
  git("rm", "--cached", "--quiet", "--", file); // unstage; the file stays on disk
  if (!existing.split("\n").some((line) => line.trim() === file)) additions.push(file);
}

if (additions.length) {
  const header = existing.includes("# ip-quarantine") ? "" : "\n# ip-quarantine — local-only, never committed. Licensed material kept off the remote.\n";
  fs.appendFileSync(excludeFile, `${existing.endsWith("\n") || !existing ? "" : "\n"}${header}${additions.join("\n")}\n`);
}

console.error(`\n  Quarantined ${stagedFlagged.length} file(s): unstaged and locally ignored.`);
console.error("  They remain on disk. Local-only ignore list: .git/info/exclude");

/* If the leak was the whole commit there is nothing left to record. Abort
 * rather than let git write an empty commit — the quarantine already did its
 * job, and a stray empty commit just muddies the log. */
const remaining = git("diff", "--cached", "--name-only").trim();
if (!remaining) {
  console.error("\n  Nothing left to commit — that was the entire staged set. Commit aborted.\n");
  process.exit(1);
}

console.error("  The rest of your commit proceeds normally.\n");
process.exit(0); // let the commit through — the leak is out of it
