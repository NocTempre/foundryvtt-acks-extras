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
 * the one branch, and the message says so.
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

/**
 * The commits of the checkout holding `dir` that its upstream lacks.
 * @returns {{ top: string, upstream: string, commits: string[] } | null} null
 *   where `dir` is in no repository, the branch has no upstream and there is
 *   no `origin/main`, or nothing is ahead.
 */
function unpushed(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  const upstream = git(top, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    ?? (git(top, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]) ? "origin/main" : null);
  if (!upstream) return null;
  const log = git(top, ["log", `${upstream}..HEAD`, "--format=%h %s"]);
  return log ? { top, upstream, commits: log.split("\n") } : null;
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
  const found = unpushed(dir);
  if (!found || seen.has(found.top)) continue;
  seen.add(found.top);
  ahead.push(found);
}

const lines = [];
for (const { top, upstream, commits } of ahead) {
  lines.push(`${path.basename(top)}: ${commits.length} commit(s) not on ${upstream}`);
  for (const commit of commits.slice(0, LISTED)) lines.push(`  ${commit}`);
  if (commits.length > LISTED) lines.push(`  and ${commits.length - LISTED} more`);
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
  systemMessage: `Not pushed (the checkout's commits, every session's):\n${listing}`,
}));
process.exit(0);
