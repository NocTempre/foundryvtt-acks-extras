/**
 * Open, land, park and close a topic branch kept in a worktree beside the
 * main checkout.
 *
 *   node branch.mjs open <slug>
 *   node branch.mjs land <slug> [--wait <minutes>] [--change <dir>]
 *   node branch.mjs close <slug> [--discard-unmerged]
 *   node branch.mjs park <slug> [--at <rev>] [--push]
 *
 * A worktree is a sibling folder, `<main root>.<slug>`, on `topic/<slug>`.
 * Run from any checkout of the repository; the main root is the first entry
 * of `git worktree list`.
 *
 * `open` creates the branch at `main`, the folder, and a junction to `main`'s
 * `node_modules`. `land` rebases an unpushed topic onto `main` in its worktree
 * (stopping at the first conflict), takes the landing lease, runs the full
 * gate on the tip with `commit-own-hunks.mjs postgate` from `main`'s root,
 * fast-forwards `main` to the tip and reads `HEAD` back. It never carries a
 * moved base and never pushes. `close` unlinks every top-level link in the
 * worktree before `git worktree remove`, because on Windows that command
 * deletes through a junction and empties the folder it points at, then checks
 * `main`'s `node_modules` survived. `park` makes `parked/<slug>`, a branch with
 * no worktree that is pushed once, on the owner's go-ahead, and never synced.
 *
 * `--change <dir>` is a `commit-own-hunks.mjs` change directory whose
 * `change.json` gives the gate (`gate`, `link`, `timeoutMinutes`); `land`
 * writes a `{}` one in a temporary directory where none is given.
 *
 * Exit status: 0 done, 1 refused, 2 usage, 5 the landing lease was still held
 * when the wait ran out (run it again).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquire } from "../acks-commit/lease.mjs";

/** Exit statuses, shared with `commit-own-hunks.mjs` where they overlap. */
export const EXIT = { ok: 0, refused: 1, usage: 2, leaseHeld: 5 };
/** A branch slug: lowercase words joined by hyphens. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** Minutes `land` waits for the landing lease where `--wait` gives none. */
const WAIT_MINUTES = 20;
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Git variables that point a child at a repository other than the one it was given. */
const GIT_ENV_DROP = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];

/** A stop the caller can act on by its exit status; anything else thrown is a fault. */
export class Refusal extends Error {
  constructor(message, code = EXIT.refused) {
    super(message);
    this.code = code;
  }
}
const refuse = (message, code = EXIT.refused) => {
  throw new Refusal(message, code);
};

const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_ENV_DROP.includes(key.toUpperCase()))),
  ...extra,
});

/** Runs git in `cwd`; answers its status and output without throwing. */
function run(cwd, args, extraEnv = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: cleanEnv(extraEnv), maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  return { status: r.status, raw: r.stdout ?? "", out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** Runs git in `cwd` and answers its trimmed stdout; a failure is a refusal naming git's own message. */
function gitOut(cwd, args) {
  const r = run(cwd, args);
  if (r.status !== 0) refuse(`git ${args.join(" ")} failed: ${r.err || r.out}`);
  return r.out;
}

const hasRef = (cwd, ref) => run(cwd, ["show-ref", "--verify", "--quiet", ref]).status === 0;
const rev = (cwd, name) => gitOut(cwd, ["rev-parse", "--verify", `${name}^{commit}`]);
const isAncestor = (cwd, ancestor, of) => run(cwd, ["merge-base", "--is-ancestor", ancestor, of]).status === 0;

/** Throws a usage refusal for a slug that is not a valid branch slug. */
export function checkSlug(slug) {
  if (!slug || !SLUG.test(slug)) refuse(`a slug is lowercase letters, digits and hyphens, at most 41 characters, starting with a letter or digit (${SLUG}); got ${JSON.stringify(slug ?? "")}`, EXIT.usage);
}

/**
 * Every worktree of the repository `cwd` is in, main's first.
 * @returns {{path: string, branch: string|null}[]} `branch` is the full ref, null for a detached one.
 */
export function worktrees(cwd) {
  const listing = gitOut(cwd, ["worktree", "list", "--porcelain"]);
  return listing.split(/\r?\n\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/);
    const top = lines.find((l) => l.startsWith("worktree "));
    const branch = lines.find((l) => l.startsWith("branch "));
    return { path: path.resolve(top.slice("worktree ".length)), branch: branch ? branch.slice("branch ".length) : null };
  });
}

/** The main checkout's root: the first worktree git lists. */
export const mainRootOf = (cwd) => worktrees(cwd)[0].path;

/** The folder a topic's worktree has by convention. */
export const worktreePathFor = (root, slug) => path.join(path.dirname(root), `${path.basename(root)}.${slug}`);

/** Throws unless the main checkout has `main` checked out. */
function requireMain(root) {
  const head = run(root, ["symbolic-ref", "-q", "HEAD"]).out;
  if (head !== "refs/heads/main") refuse(`${root} has ${head || "a detached HEAD"} checked out, not refs/heads/main`);
}

/** The names of the symbolic links and junctions directly inside `dir`. */
export function linksIn(dir) {
  return fs.readdirSync(dir).filter((name) => fs.lstatSync(path.join(dir, name)).isSymbolicLink());
}

/** Removes one link without touching what it points at. */
function unlinkLink(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    fs.rmdirSync(link);
  }
}

/**
 * Removes every top-level link in `dir`.
 * @param {(link: string) => void} [unlink] The removal, for a test to replace.
 * @returns {{removed: {name: string, target: string}[], remaining: string[]}} what was
 *   unlinked, with the target each pointed at, and the links still there afterwards.
 */
export function unlinkTopLevel(dir, unlink = unlinkLink) {
  const removed = linksIn(dir).map((name) => ({ name, target: fs.readlinkSync(path.join(dir, name)) }));
  for (const { name } of removed) unlink(path.join(dir, name));
  return { removed, remaining: linksIn(dir) };
}

/** Throws a refusal naming every top-level link still in `dir`: a worktree is never removed while one stands. */
export function checkNoLinks(dir) {
  const left = linksIn(dir);
  if (left.length) refuse(`${dir} still holds ${left.length} link(s) (${left.join(", ")}); removing the worktree would delete through them into what they point at. Remove each link by hand, then close again`);
}

/** Whether a folder exists and holds anything. */
export function nodeModulesState(root) {
  const dir = path.join(root, "node_modules");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { exists: false, nonEmpty: false };
  }
  return { exists: true, nonEmpty: names.length > 0 };
}

/** The path of a git file under a worktree's own git directory. */
const gitPathOf = (cwd, name) => path.resolve(cwd, gitOut(cwd, ["rev-parse", "--git-path", name]));

/** Whether a rebase is stopped in the worktree `cwd`. */
const rebasing = (cwd) => ["rebase-merge", "rebase-apply"].some((n) => fs.existsSync(gitPathOf(cwd, n)));

/**
 * Throws where the worktree `dir` holds a change. A link at its top level is
 * this tool's own and does not count.
 */
function requireClean(dir, what) {
  const status = run(dir, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (status.status !== 0) refuse(`git status failed in ${dir}: ${status.err}`);
  const dirty = status.raw.split("\0").filter(Boolean).filter((entry) => {
    if (!entry.startsWith("?? ")) return true;
    const top = entry.slice(3).split("/")[0];
    return !fs.lstatSync(path.join(dir, top), { throwIfNoEntry: false })?.isSymbolicLink();
  });
  if (dirty.length) refuse(`${what} is not clean (${dirty.length} path(s), untracked files included): ${dirty.slice(0, 5).map((e) => e.replace(/^.. /, "")).join(", ")}${dirty.length > 5 ? ", ..." : ""}`);
}

/** The slug's topic worktree and branch, or a refusal where the branch is not there. */
function topicOf(cwd, slug) {
  checkSlug(slug);
  const root = mainRootOf(cwd);
  const branch = `topic/${slug}`;
  // A rebase stopped mid-way leaves the worktree on a detached HEAD, so the
  // branch no longer names it; the conventional folder does.
  const fold = (p) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));
  const all = worktrees(cwd);
  const entry = all.find((w) => w.branch === `refs/heads/${branch}`) ?? all.find((w) => fold(w.path) === fold(worktreePathFor(root, slug)));
  return { root, branch, dir: entry?.path ?? null, exists: hasRef(root, `refs/heads/${branch}`) };
}

/** Creates `topic/<slug>` at `main` in a sibling worktree and links `main`'s `node_modules` in. */
export function open(slug, { cwd, say = console.log }) {
  checkSlug(slug);
  const root = mainRootOf(cwd);
  requireMain(root);
  const branch = `topic/${slug}`;
  if (hasRef(root, `refs/heads/${branch}`)) refuse(`${branch} already exists`);
  const dir = worktreePathFor(root, slug);
  if (fs.existsSync(dir)) refuse(`${dir} already exists`);
  gitOut(root, ["worktree", "add", "-b", branch, dir, "main"]);
  const modules = path.join(root, "node_modules");
  const link = path.join(dir, "node_modules");
  let linked = false;
  if (fs.existsSync(modules) && !fs.lstatSync(link, { throwIfNoEntry: false })) {
    fs.symlinkSync(modules, link, "junction");
    linked = true;
  }
  say(`opened ${branch} at ${dir}`);
  say(`  nothing on this branch is walked live until it lands: the Foundry junction points at ${root}`);
  say(`  start the session in ${dir} and commit there by hand (git add, git commit)`);
  say(`  land it with: node .claude/skills/acks-branch/branch.mjs land ${slug}   (rebases, gates the tip, fast-forwards main, never pushes)`);
  say(`  the worktree lacks: compiled packs (run build:packs there), aia-tmp/, settings.local.json, the Foundry junction${linked ? "" : ", and node_modules (main has none to link)"}`);
  return EXIT.ok;
}

/** The refusal a stopped rebase gives: what to do, and that main is untouched. */
function stoppedRebase(dir, slug, output) {
  refuse(`the rebase onto main stopped; main is untouched and the rebase is left in progress in ${dir}\n${output.split("\n").slice(-12).join("\n")}\nresolve the conflict there, git add the files, git rebase --continue, then land ${slug} again (git rebase --abort drops the attempt)`);
}

/** The words that name a lease's holder to a waiter. */
const holderName = (held) => `${held?.session ? `session ${String(held.session).slice(0, 8)}` : "another run"}${held?.since ? `, since ${new Date(held.since).toTimeString().slice(0, 8)}` : ""}${held?.change ? `, for ${held.change}` : ""}`;

/**
 * Lands `topic/<slug>` on `main`: rebase when `main` moved, then under the
 * landing lease gate the tip and fast-forward.
 * @param {string} slug
 * @param {{cwd: string, waitMinutes?: number, change?: string|null, say?: Function, session?: string|null, merge?: (root: string, tip: string) => {status: number|null, out: string, err: string}}} options
 *   `merge` is the fast-forward, for a test to replace.
 */
export async function land(slug, { cwd, waitMinutes = WAIT_MINUTES, change = null, say = console.log, session = process.env.CLAUDE_CODE_SESSION_ID ?? null, merge = (root, sha) => run(root, ["merge", "--ff-only", sha]) }) {
  const { root, branch, dir, exists } = topicOf(cwd, slug);
  requireMain(root);
  if (!exists) refuse(`${branch} does not exist`);
  if (!dir) refuse(`${branch} has no worktree, and a topic is landed from its own; ask the owner what to do with it`);
  if (hasRef(root, `refs/remotes/origin/${branch}`)) refuse(`${branch} is on origin; a pushed branch is never rebased. Ask the owner`);
  if (rebasing(dir)) refuse(`a rebase is in progress in ${dir}; finish it (git rebase --continue) or abort it, then land again`);
  requireClean(dir, `the worktree ${dir}`);
  let tip = rev(root, branch);
  if (isAncestor(root, tip, "main")) refuse(`${branch} holds nothing main does not: already landed or empty; close it with close ${slug}`);
  if (!isAncestor(root, "main", tip)) {
    const rebased = run(dir, ["rebase", "main"], { GIT_EDITOR: "true" });
    if (rebased.status !== 0) stoppedRebase(dir, slug, `${rebased.out}\n${rebased.err}`.trim());
    tip = rev(dir, "HEAD");
    say(`rebased ${branch} onto main: tip ${tip}`);
  }
  const gitDir = path.resolve(root, gitOut(root, ["rev-parse", "--git-common-dir"]));
  let last = null;
  const lease = await acquire(gitDir, { session, change: `branch land ${branch}` }, {
    waitMs: waitMinutes * 60_000,
    onWait: (held) => {
      last = held;
      say(`the landing lease is held by ${holderName(held)}; waiting ${waitMinutes} minute(s) at most`);
    },
  });
  if (!lease) refuse(`the landing lease is still held by ${holderName(last)}; nothing gated, main unmoved`, EXIT.leaseHeld);
  try {
    const staged = gitOut(root, ["diff", "--cached", "--name-only"]);
    if (staged) refuse(`main's index holds staged changes (${staged.split("\n").join(", ")}); wait for that commit, then land again`);
    if (!isAncestor(root, "main", tip)) refuse("main moved; land again");
    const old = rev(root, "HEAD");
    gate(root, tip, change, say);
    const merged = merge(root, tip);
    if (merged.status !== 0) {
      const after = rev(root, "HEAD");
      refuse(`git merge --ff-only ${tip} refused: ${merged.err || merged.out}\nmain's HEAD ${after === old ? "did not move" : `MOVED to ${after}; look at it before anything else`}`);
    }
    const head = rev(root, "HEAD");
    if (head !== tip) refuse(`main's HEAD is ${head} after the fast-forward, not the tip ${tip}; look at it before anything else`);
    say(`landed ${branch} ${tip}; main fast-forwarded from ${old}; not pushed`);
    return EXIT.ok;
  } finally {
    lease.stop();
  }
}

/** Runs the full gate on `tip` through `postgate` from `root`; throws a refusal with the log's tail where it is not green. */
function gate(root, tip, change, say) {
  const given = change ? path.resolve(change) : null;
  const dir = given ?? fs.mkdtempSync(path.join(os.tmpdir(), "acks-branch-land-"));
  if (!given) fs.writeFileSync(path.join(dir, "change.json"), "{}\n");
  const log = path.join(dir, "branch-land.log");
  try {
    const r = spawnSync(process.execPath, [path.join(HERE, "..", "acks-commit", "commit-own-hunks.mjs"), "postgate", tip, "--change", dir], { cwd: root, encoding: "utf8", env: cleanEnv(), maxBuffer: 1 << 28 });
    const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    fs.writeFileSync(log, text);
    if (r.status !== 0) refuse(`the full gate is not green on ${tip} (exit ${r.status}); main unmoved; ${log} holds the run, ending:\n${text.trim().split("\n").slice(-15).join("\n")}`);
    say(`gate green on ${tip}`);
  } finally {
    if (!given) {
      try {
        const clone = path.join(dir, "clone");
        if (fs.existsSync(clone)) unlinkTopLevel(clone);
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // A scratch directory that will not go costs disk, nothing more.
      }
    }
  }
}

/**
 * Removes a topic's worktree and its branch, keeping `main`'s `node_modules`.
 * @param {string} slug
 * @param {{cwd: string, discard?: boolean, say?: Function, remove?: (root: string, dir: string) => void}} options
 *   `remove` is the worktree removal, for a test to replace.
 */
export function close(slug, { cwd, discard = false, say = console.log, remove = (root, dir) => void gitOut(root, ["worktree", "remove", dir]) }) {
  const { root, branch, dir, exists } = topicOf(cwd, slug);
  requireMain(root);
  if (!exists) refuse(`${branch} does not exist`);
  const folder = dir && fs.existsSync(dir) ? dir : null;
  if (folder) requireClean(folder, `the worktree ${folder}`);
  const merged = isAncestor(root, `refs/heads/${branch}`, "main");
  if (!merged && !discard) refuse(`${branch} is not merged into main; landing it is land ${slug}. Dropping it unmerged is --discard-unmerged, which stands for the owner's word and is never a session's own call`);
  const before = nodeModulesState(root);
  if (folder) {
    const { removed, remaining } = unlinkTopLevel(folder);
    const relink = () => {
      for (const { name, target } of removed) if (!fs.lstatSync(path.join(folder, name), { throwIfNoEntry: false })) fs.symlinkSync(target, path.join(folder, name), "junction");
    };
    if (remaining.length) {
      relink();
      checkNoLinks(folder);
    }
    try {
      remove(root, folder);
    } catch (e) {
      relink();
      throw e;
    }
  } else {
    run(root, ["worktree", "prune"]);
  }
  gitOut(root, ["branch", discard && !merged ? "-D" : "-d", branch]);
  say(`closed ${branch}: worktree ${folder ?? "(already gone)"} removed, branch deleted`);
  const after = nodeModulesState(root);
  if (before.nonEmpty && !after.nonEmpty) {
    refuse(`main's node_modules is ${after.exists ? "empty" : "gone"} after the worktree was removed; the worktree and branch are closed. Run \`npm install\` in ${root} to restore it`);
  }
  return EXIT.ok;
}

/** Creates `parked/<slug>` at `rev` with no worktree, and pushes it once where `push` is set. */
export function park(slug, { cwd, at = "main", push = false, say = console.log }) {
  checkSlug(slug);
  const root = mainRootOf(cwd);
  const branch = `parked/${slug}`;
  if (push) {
    if (!hasRef(root, `refs/heads/${branch}`)) refuse(`${branch} does not exist; park it first`);
    if (hasRef(root, `refs/remotes/origin/${branch}`) || run(root, ["ls-remote", "--exit-code", "--heads", "origin", branch]).status === 0) refuse(`${branch} is already on origin; a parked branch is pushed once`);
    gitOut(root, ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
    say(`pushed ${branch} to origin once; it is never synced after this`);
    return EXIT.ok;
  }
  if (hasRef(root, `refs/heads/${branch}`)) refuse(`${branch} already exists`);
  gitOut(root, ["branch", branch, rev(root, at)]);
  say(`parked ${branch} at ${rev(root, branch).slice(0, 10)}; no worktree, never built by CI`);
  say(`  the owner's go-ahead pushes it, once: node .claude/skills/acks-branch/branch.mjs park ${slug} --push`);
  return EXIT.ok;
}

const FLAGS = {
  open: { value: [], bool: [] },
  land: { value: ["--wait", "--change"], bool: [] },
  close: { value: [], bool: ["--discard-unmerged"] },
  park: { value: ["--at"], bool: ["--push"] },
};
const USAGE = "usage: node branch.mjs open <slug> | land <slug> [--wait <minutes>] [--change <dir>] | close <slug> [--discard-unmerged] | park <slug> [--at <rev>] [--push]";

/**
 * Runs one command line and answers its exit status.
 * @param {string[]} argv The arguments after the script name.
 * @param {{cwd?: string, say?: Function}} [options]
 */
export async function main(argv, { cwd = process.cwd(), say = console.log } = {}) {
  try {
    const [mode, slug, ...rest] = argv;
    const spec = FLAGS[mode];
    if (!spec || !slug || slug.startsWith("--")) refuse(USAGE, EXIT.usage);
    const given = {};
    for (let i = 0; i < rest.length; i++) {
      if (spec.bool.includes(rest[i])) given[rest[i]] = true;
      else if (spec.value.includes(rest[i]) && rest[i + 1] !== undefined) given[rest[i]] = rest[++i];
      else refuse(`${USAGE}\nunknown or incomplete option ${rest[i]}`, EXIT.usage);
    }
    if (mode === "open") return open(slug, { cwd, say });
    if (mode === "close") return close(slug, { cwd, say, discard: given["--discard-unmerged"] === true });
    if (mode === "park") return park(slug, { cwd, say, at: given["--at"] ?? "main", push: given["--push"] === true });
    const minutes = Number(given["--wait"] ?? WAIT_MINUTES);
    if (!(minutes >= 0)) refuse("--wait takes a number of minutes", EXIT.usage);
    return await land(slug, { cwd, say, waitMinutes: minutes, change: given["--change"] ?? null });
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`REFUSED: ${e.message}`);
    return e.code;
  }
}

const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : null;
if (entry && pathToFileURL(entry).href === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href) {
  process.exitCode = await main(process.argv.slice(2));
}
