/**
 * Open, land, sync, park and close a topic branch kept in a worktree beside the
 * main checkout.
 *
 *   node branch.mjs open <slug>
 *   node branch.mjs land <slug> [--wait <minutes>] [--change <dir>] [--despite-release <version>]
 *   node branch.mjs sync <slug>
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
 * moved base and never pushes. A topic stays open between landings; `sync`
 * brings what `main` gained into its worktree, as a rebase of the unpushed
 * topic onto `main` that stops at the first conflict, and a topic `main`
 * already holds is left as it is. It never takes the lease and never touches
 * `main`. `close` unlinks every top-level link in the
 * worktree before `git worktree remove`, because on Windows that command
 * deletes through a junction and empties the folder it points at, then checks
 * `main`'s `node_modules` survived. A removal that fails on a locked folder is
 * retried with a backoff; where git had already stripped the worktree the links
 * stay out and the refusal names the folder, and a `close` run again over a
 * worktree already gone unlinks and removes what it left. `park` makes `parked/<slug>`, a branch with
 * no worktree that is pushed once, on the owner's go-ahead, and never synced.
 *
 * `--change <dir>` is a `commit-own-hunks.mjs` change directory whose
 * `change.json` gives the gate (`gate`, `link`, `timeoutMinutes`); `land`
 * writes a `{}` one in a temporary directory where none is given. That
 * directory is removed when the gate passes; a refused gate keeps its
 * `branch-land.log` there, and the refusal prints the path.
 *
 * The gate runs as a child process the event loop keeps awaiting, so the
 * lease's heartbeat keeps beating through a long gate. A `main` that moved
 * while `land` waited for the lease is rebased onto once, under the lease; the
 * lease and `main`'s `HEAD` are checked again after the gate and before the
 * fast-forward.
 *
 * A release's live window is open while `main`'s `module.json` holds a version
 * with no local tag `v<version>`, in a repository that has tagged before. While
 * it is open `land` refuses a topic whose runtime tree (`tools/walk-results.mjs`
 * `runtimeTree`) differs from `main`'s, since only the release session lands a
 * change to what the zip ships then. It checks once after the pre-lease rebase
 * and again under the lease before the gate, because a release commit can land
 * while `land` waits. `--despite-release <version>` passes an abandoned
 * release's window and stands for the owner's word.
 *
 * Exit status: 0 done, 1 refused, 2 usage, 3 main moved or the lease was lost
 * during the gate (land again), 5 the landing lease was still held when the
 * wait ran out (run it again), 6 main is in a release's live window and the
 * topic changes the runtime.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquire, holds } from "../acks-commit/lease.mjs";

/** Exit statuses, shared with `commit-own-hunks.mjs` where they overlap. */
export const EXIT = { ok: 0, refused: 1, usage: 2, movedBase: 3, leaseHeld: 5, releaseWindow: 6 };
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
  say(`  it stays open after a landing: sync ${slug} brings main in before the next slice, close ${slug} once the feature is walked`);
  say(`  the worktree lacks every gitignored file (git copies none into a new worktree) — compiled packs (run build:packs there), aia-tmp/, settings.local.json, pipeline state — and the Foundry junction${linked ? "" : ", and node_modules (main has none to link)"}`);
  return EXIT.ok;
}

/** What a stopped rebase asks of the session once `land` ran it, and once `sync` did. */
const REBASE_NEXT = {
  land: (slug) => `resolve the conflict there, git add the files, git rebase --continue, then land ${slug} again (git rebase --abort drops the attempt)`,
  sync: () => "resolve the conflict there, git add the files, git rebase --continue finishes the sync (git rebase --abort drops it)",
};

/** The refusal a stopped rebase gives: what to do (`REBASE_NEXT[how]`), and that main is untouched. */
function stoppedRebase(dir, slug, output, how = "land") {
  refuse(`the rebase onto main stopped; main is untouched and the rebase is left in progress in ${dir}\n${output.split("\n").slice(-12).join("\n")}\n${REBASE_NEXT[how](slug)}`);
}

/**
 * Brings what `main` gained into `topic/<slug>`'s worktree: a rebase onto
 * `main` that stops at the first conflict, so the topic's next slice is
 * written on the current tree. A topic that already holds `main` is left as it
 * is, and a contained one fast-forwards. It takes no lease and never touches `main`.
 */
export function sync(slug, { cwd, say = console.log }) {
  const { root, branch, dir, exists } = topicOf(cwd, slug);
  requireMain(root);
  if (!exists) refuse(`${branch} does not exist`);
  if (!dir) refuse(`${branch} has no worktree, and a topic is synced in its own; ask the owner what to do with it`);
  if (hasRef(root, `refs/remotes/origin/${branch}`)) refuse(`${branch} is on origin; a pushed branch is never rebased. Ask the owner`);
  if (rebasing(dir)) refuse(`a rebase is in progress in ${dir}; finish it (git rebase --continue) or abort it, then sync again`);
  const checkedOut = run(dir, ["symbolic-ref", "-q", "HEAD"]).out;
  if (checkedOut !== `refs/heads/${branch}`) refuse(`${dir} has ${checkedOut || "a detached HEAD"} checked out, not refs/heads/${branch}`);
  requireClean(dir, `the worktree ${dir}`);
  const mainSha = rev(root, "main").slice(0, 10);
  if (isAncestor(root, "main", `refs/heads/${branch}`)) {
    say(`${branch} already holds main ${mainSha}; nothing to bring in`);
    return EXIT.ok;
  }
  const rebased = run(dir, ["rebase", "main"], { GIT_EDITOR: "true" });
  if (rebased.status !== 0) stoppedRebase(dir, slug, `${rebased.out}\n${rebased.err}`.trim(), "sync");
  say(`synced ${branch} onto main ${mainSha}: tip ${rev(dir, "HEAD").slice(0, 10)}`);
  return EXIT.ok;
}

/** The words that name a lease's holder to a waiter. */
const holderName = (held) => `${held?.session ? `session ${String(held.session).slice(0, 8)}` : "another run"}${held?.since ? `, since ${new Date(held.since).toTimeString().slice(0, 8)}` : ""}${held?.change ? `, for ${held.change}` : ""}`;

/**
 * Whether `main` is inside a release's live window: its `module.json` names a
 * version, the repository has tagged a release before, and that version has no
 * local tag `v<version>` yet. A repository with no `module.json` on `main`, a
 * module never tagged and a tagged version are all closed.
 * @param {string} root The main checkout's root.
 * @returns {{version: string}|null} the open window's version, or null where it is closed.
 */
export function releaseWindow(root) {
  const manifest = run(root, ["show", "main:module.json"]);
  if (manifest.status !== 0) return null;
  let version;
  try {
    version = JSON.parse(manifest.raw.charCodeAt(0) === 0xfeff ? manifest.raw.slice(1) : manifest.raw).version;
  } catch {
    return null;
  }
  if (typeof version !== "string" || !version) return null;
  if (!run(root, ["tag", "--list", "v*"]).out) return null;
  if (hasRef(root, `refs/tags/v${version}`)) return null;
  return { version };
}

/**
 * Applies the release-window rule to landing `tip`: where the window is open, a
 * topic that changes the runtime tree is refused, and `despiteRelease` (the
 * owner's word for an abandoned release) passes it. Says once what it let through.
 */
async function checkReleaseWindow(root, { tip, branch, despiteRelease, say, told }) {
  const open = releaseWindow(root);
  const tell = (message) => {
    if (!told.has(message)) say(message);
    told.add(message);
  };
  if (despiteRelease !== null) {
    if (!open) refuse(`--despite-release ${despiteRelease} given, but main is in no release's live window`);
    if (open.version !== despiteRelease) refuse(`--despite-release ${despiteRelease} given, but the window is release ${open.version}'s`);
    tell(`main is in release ${open.version}'s live window (no tag v${open.version} yet); passed on the owner's word (--despite-release ${open.version})`);
    return;
  }
  if (!open) return;
  const walkResults = path.join(root, "tools", "walk-results.mjs");
  let walk = null;
  if (fs.existsSync(walkResults)) {
    walk = await import(pathToFileURL(walkResults).href);
    if (walk.runtimeTree(root, { at: "main" }).tree === walk.runtimeTree(root, { at: tip }).tree) {
      tell(`main is in release ${open.version}'s live window; ${branch} changes nothing the zip ships, so it lands`);
      return;
    }
  }
  const changed = gitOut(root, ["diff", "--name-only", "main", tip]).split("\n").filter(Boolean).filter((p) => !walk || walk.isRuntimePath(p));
  const shown = `${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""}`;
  refuse(`main is in release ${open.version}'s live window (no tag v${open.version} yet); ${branch} changes the runtime (${shown}) and would make its walks stale. Land after v${open.version} is tagged. An abandoned release is passed with --despite-release ${open.version}, which stands for the owner's word and is never a session's own call`, EXIT.releaseWindow);
}

/**
 * Lands `topic/<slug>` on `main`: rebase when `main` moved, then under the
 * landing lease gate the tip and fast-forward. An open release window refuses a
 * topic that changes the runtime (see the file header).
 * @param {string} slug
 * @param {{cwd: string, waitMinutes?: number, change?: string|null, despiteRelease?: string|null, say?: Function, session?: string|null, beatMs?: number, merge?: (root: string, tip: string) => {status: number|null, out: string, err: string}}} options
 *   `merge` is the fast-forward and `beatMs` the lease's heartbeat interval, both for a test to replace.
 */
export async function land(slug, { cwd, waitMinutes = WAIT_MINUTES, change = null, despiteRelease = null, say = console.log, session = process.env.CLAUDE_CODE_SESSION_ID ?? null, beatMs, merge = (root, sha) => run(root, ["merge", "--ff-only", sha]) }) {
  const { root, branch, dir, exists } = topicOf(cwd, slug);
  requireMain(root);
  if (!exists) refuse(`${branch} does not exist`);
  if (!dir) refuse(`${branch} has no worktree, and a topic is landed from its own; ask the owner what to do with it`);
  if (hasRef(root, `refs/remotes/origin/${branch}`)) refuse(`${branch} is on origin; a pushed branch is never rebased. Ask the owner`);
  if (rebasing(dir)) refuse(`a rebase is in progress in ${dir}; finish it (git rebase --continue) or abort it, then land again`);
  requireClean(dir, `the worktree ${dir}`);
  let tip = rev(root, branch);
  if (isAncestor(root, tip, "main")) refuse(`${branch} holds nothing main does not (landed, or not committed to): sync ${slug} before its next slice, or close ${slug} once its feature is walked`);
  if (!isAncestor(root, "main", tip)) {
    const rebased = run(dir, ["rebase", "main"], { GIT_EDITOR: "true" });
    if (rebased.status !== 0) stoppedRebase(dir, slug, `${rebased.out}\n${rebased.err}`.trim());
    tip = rev(dir, "HEAD");
    say(`rebased ${branch} onto main: tip ${tip}`);
  }
  const windowArgs = { tip, branch, despiteRelease, say, told: new Set() };
  await checkReleaseWindow(root, windowArgs);
  const gitDir = path.resolve(root, gitOut(root, ["rev-parse", "--git-common-dir"]));
  let last = null;
  const lease = await acquire(gitDir, { session, change: `branch land ${branch}` }, {
    waitMs: waitMinutes * 60_000,
    beatMs,
    onWait: (held) => {
      last = held;
      say(`the landing lease is held by ${holderName(held)}; waiting ${waitMinutes} minute(s) at most`);
    },
  });
  if (!lease) refuse(`the landing lease is still held by ${holderName(last)}; nothing gated, main unmoved`, EXIT.leaseHeld);
  try {
    const staged = gitOut(root, ["diff", "--cached", "--name-only"]);
    if (staged) refuse(`main's index holds staged changes (${staged.split("\n").join(", ")}); wait for that commit, then land again`);
    if (!isAncestor(root, "main", tip)) {
      requireClean(dir, `the worktree ${dir}`);
      const rebased = run(dir, ["rebase", "main"], { GIT_EDITOR: "true" });
      if (rebased.status !== 0) stoppedRebase(dir, slug, `${rebased.out}\n${rebased.err}`.trim());
      tip = rev(dir, "HEAD");
      say(`main moved while this run waited; rebased ${branch} onto main: tip ${tip}`);
      if (!isAncestor(root, "main", tip)) refuse("main moved again during the rebase, by a commit made around the tool; nothing landed; land again", EXIT.movedBase);
    }
    await checkReleaseWindow(root, { ...windowArgs, tip });
    const old = rev(root, "HEAD");
    await gate(root, tip, change, say);
    if (!holds(gitDir, lease.token)) refuse("the landing lease was taken during the gate; main unmoved; land again", EXIT.movedBase);
    if (rev(root, "HEAD") !== old) refuse("main moved during the gate, by a commit made around the tool; nothing landed; land again", EXIT.movedBase);
    const merged = merge(root, tip);
    if (merged.status !== 0) {
      const after = rev(root, "HEAD");
      refuse(`git merge --ff-only ${tip} refused: ${merged.err || merged.out}\nmain's HEAD ${after === old ? "did not move" : `MOVED to ${after}; look at it before anything else`}`);
    }
    const head = rev(root, "HEAD");
    if (head !== tip) refuse(`main's HEAD is ${head} after the fast-forward, not the tip ${tip}; look at it before anything else`);
    say(`landed ${branch} ${tip}; main fast-forwarded from ${old}; not pushed`);
    say(`  ${branch} stays open: sync ${slug} before its next slice; close ${slug} once its feature is walked`);
    return EXIT.ok;
  } finally {
    lease.stop();
  }
}

/** Runs a child to its close without blocking the event loop; answers its exit status and its stdout and stderr together. */
function runAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let text = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, text }));
  });
}

/**
 * Runs the full gate on `tip` through `postgate` from `root`, with the event loop free for the lease's heartbeat; throws a refusal with the log's tail where it is not green.
 * A scratch directory the tool made is removed when the gate passes; where the gate refuses, its log is kept (the refusal names the path) and the rest of the directory goes.
 */
async function gate(root, tip, change, say) {
  const given = change ? path.resolve(change) : null;
  const dir = given ?? fs.mkdtempSync(path.join(os.tmpdir(), "acks-branch-land-"));
  if (!given) fs.writeFileSync(path.join(dir, "change.json"), "{}\n");
  const log = path.join(dir, "branch-land.log");
  let passed = false;
  try {
    const r = await runAsync(process.execPath, [path.join(HERE, "..", "acks-commit", "commit-own-hunks.mjs"), "postgate", tip, "--change", dir], { cwd: root, env: cleanEnv() });
    const text = r.text;
    fs.writeFileSync(log, text);
    if (r.status !== 0) refuse(`the full gate is not green on ${tip} (exit ${r.status}); main unmoved; ${log} holds the run, ending:\n${text.trim().split("\n").slice(-15).join("\n")}`);
    passed = true;
    say(`gate green on ${tip}`);
  } finally {
    if (!given) {
      try {
        const clone = path.join(dir, "clone");
        if (fs.existsSync(clone)) unlinkTopLevel(clone);
        if (passed || !fs.existsSync(log)) fs.rmSync(dir, { recursive: true, force: true });
        else fs.rmSync(clone, { recursive: true, force: true });
      } catch {
        // A scratch directory that will not go costs disk, nothing more.
      }
    }
  }
}

/** Milliseconds `close` waits before each further try at a locked folder: three retries. */
const LOCK_BACKOFF_MS = [300, 900, 2000];

/** Blocks the thread for `ms`; the tool's steps are synchronous. */
const sleepSync = (ms) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Whether git still lists `dir` as a worktree and the folder still holds its `.git` file; a failed removal that deregistered it, or stripped it, leaves neither. */
const worktreeIntact = (root, dir) => {
  const fold = (p) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));
  return fs.existsSync(path.join(dir, ".git")) && worktrees(root).some((w) => fold(w.path) === fold(dir));
};

/**
 * Takes the links out of a folder that is no longer a worktree and removes the
 * folder when nothing else is in it, trying again where it is locked. Never
 * recursive, so nothing a link points at is reached.
 * @param {string} folder
 * @param {{sleep: (ms: number) => void, backoff: number[]}} timing
 * @returns {{links: string[], gone: boolean, error: string|null}} the links unlinked, whether
 *   the folder is gone, and the last removal error where it is not.
 */
function clearLeftover(folder, { sleep, backoff }) {
  const { removed, remaining } = unlinkTopLevel(folder);
  if (remaining.length) refuse(`${folder} still holds ${remaining.length} link(s) (${remaining.join(", ")}) after the unlink; do not delete the folder, it would delete through them. Remove each link by hand`);
  let error = null;
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt) sleep(backoff[attempt - 1]);
    try {
      fs.rmdirSync(folder);
      return { links: removed.map((l) => l.name), gone: true, error: null };
    } catch (e) {
      if (e.code === "ENOENT") return { links: removed.map((l) => l.name), gone: true, error: null };
      error = e.code ? `${e.code}: ${e.message}` : String(e.message);
    }
  }
  return { links: removed.map((l) => l.name), gone: false, error };
}

/**
 * Removes a topic's worktree and its branch, keeping `main`'s `node_modules`.
 * The worktree's links come out first and stay out once git has started
 * stripping the folder, so a folder left locked holds no link and a re-run of
 * `close` finishes it.
 * @param {string} slug
 * @param {{cwd: string, discard?: boolean, say?: Function, remove?: (root: string, dir: string) => void,
 *   sleep?: (ms: number) => void, backoff?: number[]}} options
 *   `remove` is the worktree removal, `sleep` the wait between tries and `backoff`
 *   the waits themselves, for a test to replace.
 */
export function close(slug, { cwd, discard = false, say = console.log, remove = (root, dir) => void gitOut(root, ["worktree", "remove", dir]), sleep = sleepSync, backoff = LOCK_BACKOFF_MS }) {
  const { root, branch, dir, exists } = topicOf(cwd, slug);
  requireMain(root);
  if (!exists) refuse(`${branch} does not exist`);
  const folder = dir && fs.existsSync(dir) ? dir : null;
  if (folder) requireClean(folder, `the worktree ${folder}`);
  const merged = isAncestor(root, `refs/heads/${branch}`, "main");
  if (!merged && !discard) refuse(`${branch} is not merged into main; landing it is land ${slug}. Dropping it unmerged is --discard-unmerged, which stands for the owner's word and is never a session's own call`);
  const before = nodeModulesState(root);
  const notes = [];
  if (folder) {
    const { removed, remaining } = unlinkTopLevel(folder);
    const relink = () => {
      for (const { name, target } of removed) if (!fs.lstatSync(path.join(folder, name), { throwIfNoEntry: false })) fs.symlinkSync(target, path.join(folder, name), "junction");
    };
    if (remaining.length) {
      relink();
      checkNoLinks(folder);
    }
    let failure = null;
    for (let attempt = 0; attempt <= backoff.length; attempt++) {
      if (attempt) sleep(backoff[attempt - 1]);
      try {
        remove(root, folder);
        failure = null;
        break;
      } catch (e) {
        failure = e;
        if (!worktreeIntact(root, folder)) break;
      }
    }
    if (failure) {
      if (worktreeIntact(root, folder)) {
        relink();
        throw new Refusal(`${failure.message}\n${folder} could not be removed (a locked folder, or git refused); the worktree is still registered and whole, with its node_modules link put back. Free the folder if a session or process has it open, then close ${slug} again`);
      }
      // git stripped the worktree and stopped at the folder itself: it is no worktree any more.
      run(root, ["worktree", "prune"]);
      const left = fs.existsSync(folder) ? clearLeftover(folder, { sleep, backoff }) : { gone: true, links: [], error: null };
      if (!left.gone) refuse(`${failure.message}\n${folder} is locked (${left.error}); a session or process has it open. The node_modules link was already removed, so the leftover folder is safe to delete once it is free; close ${slug} again finishes the branch`);
    }
  } else {
    run(root, ["worktree", "prune"]);
    const leftover = dir ?? worktreePathFor(root, slug);
    const stat = fs.lstatSync(leftover, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      const left = clearLeftover(leftover, { sleep, backoff });
      notes.push(left.gone ? `leftover folder ${leftover} removed${left.links.length ? ` (its ${left.links.join(", ")} link unlinked first)` : ""}` : `leftover folder ${leftover} is still there (${left.error}); it holds no link now, so it is safe to delete once a session or process lets go of it`);
    }
  }
  gitOut(root, ["branch", discard && !merged ? "-D" : "-d", branch]);
  say(`closed ${branch}: worktree ${folder ?? "(already gone)"} removed, branch deleted`);
  for (const note of notes) say(`  ${note}`);
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
  land: { value: ["--wait", "--change", "--despite-release"], bool: [] },
  sync: { value: [], bool: [] },
  close: { value: [], bool: ["--discard-unmerged"] },
  park: { value: ["--at"], bool: ["--push"] },
};
const USAGE = "usage: node branch.mjs open <slug> | land <slug> [--wait <minutes>] [--change <dir>] [--despite-release <version>] | sync <slug> | close <slug> [--discard-unmerged] | park <slug> [--at <rev>] [--push]";

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
    if (mode === "sync") return sync(slug, { cwd, say });
    if (mode === "close") return close(slug, { cwd, say, discard: given["--discard-unmerged"] === true });
    if (mode === "park") return park(slug, { cwd, say, at: given["--at"] ?? "main", push: given["--push"] === true });
    const minutes = Number(given["--wait"] ?? WAIT_MINUTES);
    if (!(minutes >= 0)) refuse("--wait takes a number of minutes", EXIT.usage);
    return await land(slug, { cwd, say, waitMinutes: minutes, change: given["--change"] ?? null, despiteRelease: given["--despite-release"] ?? null });
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
