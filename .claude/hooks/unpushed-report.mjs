/**
 * Claude Code Stop hook naming, by sha, the commits a checkout holds that its
 * upstream does not.
 *
 * It reads two checkouts: the session's project, and the template beside it
 * where one stands at `../acks-module-template`, since a canon edit is
 * committed there and reaches no module until it is pushed. Each is compared
 * with the upstream ref as it stands locally; nothing is fetched, so a commit
 * a peer pushed since the last fetch still counts as local.
 *
 * The listing is the checkout's, not the session's: every session commits to
 * the one branch, and the message says so. A session standing in a topic
 * worktree reads the main checkout, so its listing is the repository's.
 *
 * It also lists, with no commit unpushed, the local branches other than `main`:
 * an unmerged `topic/*` (commits ahead, worktree path or none, age of its last
 * commit), a `topic/*` already contained in `main` and still open, a `parked/*`
 * that is not on `origin`, and any other branch. Topic branches are never
 * pushed, so none of them is compared with a remote.
 *
 * It reports and does nothing else. The output carries a `systemMessage` and
 * no decision, so the turn ends as it would have. A listing is shown once per
 * session and again only when it changes; the last one shown is kept under
 * the system temp directory, keyed by session id. Every failure is silent
 * and exits 0: a hook that cannot read a repository is not a reason to hold a
 * turn open.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Commits listed per checkout before the rest are given as a count. */
const LISTED = 10;

/** Reads all of stdin as UTF-8. Hook payloads are small and arrive at once. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Runs git in `cwd` and returns its trimmed stdout, or null where it fails. */
function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/** Whether `ref` exists in the repository at `top`. */
const hasRef = (top, ref) => git(top, ["show-ref", "--verify", "--quiet", ref]) !== null;

/** The main checkout's root and the worktrees by branch ref: `git worktree list`, main's first. */
function worktrees(top) {
  const listing = git(top, ["worktree", "list", "--porcelain"]);
  if (!listing) return [];
  return listing.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/);
    return {
      path: path.resolve(lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? ""),
      branch: lines.find((l) => l.startsWith("branch "))?.slice(7) ?? null,
    };
  });
}

/** Whole days since the commit at the tip of `ref`, as a coarse label so the listing is stable within a day. */
function age(top, ref) {
  const seconds = Number(git(top, ["log", "-1", "--format=%ct", ref]));
  if (!Number.isFinite(seconds) || !seconds) return "age unknown";
  const days = Math.floor((Date.now() / 1000 - seconds) / 86400);
  return days <= 0 ? "last commit today" : `last commit ${days}d ago`;
}

/** The local branches other than `main`, each described for the listing. */
function branchLines(top, trees) {
  if (!hasRef(top, "refs/heads/main")) return [];
  const names = (git(top, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]) ?? "").split("\n").filter((n) => n && n !== "main");
  const lines = [];
  for (const name of names) {
    const ahead = Number(git(top, ["rev-list", "--count", `main..${name}`]) ?? 0);
    const tree = trees.find((w) => w.branch === `refs/heads/${name}`)?.path ?? "none";
    if (name.startsWith("topic/")) {
      // A topic opened and not yet committed to is also contained in main; its
      // reflog holds the one entry that made it, where a landed one holds more.
      const entries = (git(top, ["reflog", "show", "--format=%H", `refs/heads/${name}`]) ?? "").split("\n").filter(Boolean).length;
      const landed = ahead === 0 && git(top, ["merge-base", "--is-ancestor", name, "main"]) !== null && entries !== 1;
      lines.push(landed
        ? `  ${name}: landed, still open: close it (worktree ${tree})`
        : `  ${name}: ${ahead} commit(s) ahead of main, worktree ${tree}, ${age(top, name)}`);
    } else if (name.startsWith("parked/")) {
      if (!hasRef(top, `refs/remotes/origin/${name}`)) lines.push(`  ${name}: not pushed`);
    } else {
      lines.push(`  ${name}: local branch, ${ahead} commit(s) ahead of main, ${age(top, name)}`);
    }
  }
  return lines;
}

/**
 * What the repository holding `dir` has that is not where it belongs: the
 * main checkout's commits its upstream lacks, and every local branch but
 * `main` that is open, unmerged or unpushed. A session in a topic worktree
 * reads the main checkout, so the listing is the repository's.
 * @returns {{ top: string, upstream: string|null, commits: string[], branches: string[] } | null}
 *   null where `dir` is in no repository or nothing is out of place.
 */
function survey(dir) {
  const here = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!here) return null;
  const trees = worktrees(here);
  const top = trees[0]?.path ?? here;
  const upstream = git(top, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    ?? (git(top, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]) ? "origin/main" : null);
  const log = upstream ? git(top, ["log", `${upstream}..HEAD`, "--format=%h %s"]) : null;
  const commits = log ? log.split("\n") : [];
  const branches = branchLines(top, trees);
  return commits.length || branches.length ? { top, upstream, commits, branches } : null;
}

let payload = {};
try {
  payload = JSON.parse(await readStdin());
} catch {
  process.exit(0);
}

const project = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const template = path.resolve(project, "..", "acks-module-template");
const seen = new Set();
const ahead = [];
for (const dir of [project, template]) {
  if (!fs.existsSync(dir)) continue;
  const found = survey(dir);
  if (!found || seen.has(found.top)) continue;
  seen.add(found.top);
  ahead.push(found);
}

const lines = [];
for (const { top, upstream, commits, branches } of ahead) {
  if (commits.length) {
    lines.push(`${path.basename(top)}: ${commits.length} commit(s) not on ${upstream}`);
    for (const commit of commits.slice(0, LISTED)) lines.push(`  ${commit}`);
    if (commits.length > LISTED) lines.push(`  and ${commits.length - LISTED} more`);
  }
  if (branches.length) lines.push(`${path.basename(top)}: branches to land, close or push`, ...branches);
}
const listing = lines.join("\n");

const session = String(payload.session_id || "no-session").replace(/[^\w-]/g, "_");
const stateDir = path.join(os.tmpdir(), "acks-unpushed-report");
const stateFile = path.join(stateDir, `${session}.txt`);
const digest = crypto.createHash("sha1").update(listing).digest("hex");
let last = null;
try {
  last = fs.readFileSync(stateFile, "utf8");
} catch {
  // No listing shown to this session yet.
}
if (last === digest) process.exit(0);
try {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, digest);
} catch {
  // An unwritable temp directory costs a repeated listing, nothing more.
}
if (!listing) process.exit(0);

process.stdout.write(JSON.stringify({
  systemMessage: `Not pushed or not landed (the repository's, every session's):\n${listing}`,
}));
process.exit(0);
