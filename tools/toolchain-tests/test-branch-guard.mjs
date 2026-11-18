/**
 * Drives `.claude/hooks/branch-guard.mjs` against throwaway repositories and
 * checks what each mode exists to guarantee:
 *
 * - `pretool` refuses a hand-made branch or worktree, a worktree removal, and
 *   a switch of main's tree off `main`, in whatever chained, quoted or
 *   `-C`-aimed form it arrives, and passes everything else;
 * - the switch rule judges the tree the command acts on: main's tree is
 *   guarded, a linked worktree is free;
 * - `worktree-create` refuses the app's worktrees;
 * - `session-start` speaks in a linked worktree, in main's tree off `main`,
 *   and in `.claude/worktrees/`, and says nothing on `main` or outside a
 *   repository.
 *
 * Usage:  node tools/toolchain-tests/test-branch-guard.mjs [<branch-guard.mjs>]
 *         (defaults to the copy in this repository; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const arg = process.argv[2] === "--hook" ? process.argv[3] : process.argv[2];
const HOOK = path.resolve(arg ?? path.join(TEMPLATE_ROOT, ".claude/hooks/branch-guard.mjs"));

/** The environment with every git variable that would redirect a command removed. */
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-branch-guard-"));
const slash = (p) => p.replace(/\\/g, "/");
/** A path the way Git Bash writes it: `/c/dir/...` for a Windows drive. */
const posix = (p) => (process.platform === "win32" ? `/${p[0].toLowerCase()}${slash(p).slice(2)}` : p);

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: CLEAN_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

/** A repository with one commit on `main`, the file `a.txt`, a branch `other` and a tag `v1`. */
function repo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "test");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "branch", "other");
  git(dir, "tag", "v1");
  return dir;
}

const main = repo("proj");
const linked = path.join(tmp, "proj.x");
git(main, "worktree", "add", "-q", "-b", "topic/x", linked);
fs.mkdirSync(path.join(linked, "sub"), { recursive: true });
const appTree = path.join(main, ".claude", "worktrees", "y");
git(main, "worktree", "add", "-q", "-b", "claude/y", appTree);
const offMain = repo("off-main");
git(offMain, "switch", "-q", "other");
const detached = repo("detached");
git(detached, "checkout", "-q", "--detach");
const separate = path.join(tmp, "separate-tree");
execFileSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${path.join(tmp, "separate-store")}`, separate], { env: CLEAN_ENV, stdio: ["pipe", "pipe", "pipe"] });
const bare = path.join(tmp, "not-a-repo");
fs.mkdirSync(bare);
const sha = git(main, "rev-parse", "HEAD").trim();

const results = [];
function test(name, body) {
  const problems = [];
  const check = (what, ok, detail = "") => {
    if (!ok) problems.push(`${what}${detail ? `\n      ${String(detail).trim().split("\n").join("\n      ")}` : ""}`);
  };
  try {
    body(check);
  } catch (e) {
    problems.push(`threw: ${e.stack ?? e}`);
  }
  results.push(!problems.length);
  console.log(`${problems.length ? "FAIL" : "ok"} - ${name}`);
  for (const p of problems) console.log(`    ${p}`);
}

/** Runs the hook in a mode and answers its exit status and parsed stdout (null when none). */
function run(mode, { cwd = main, input = "" } = {}) {
  const r = spawnSync(process.execPath, [HOOK, mode], { cwd, env: CLEAN_ENV, input, encoding: "utf8" });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // Silence is a pass.
  }
  return { status: r.status, json, out: `${r.stdout}${r.stderr}` };
}

/** What `pretool` decides for one Bash command line run from `cwd`. */
function pretool(command, cwd = main) {
  const r = run("pretool", { cwd: bare, input: JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command } }) });
  const decision = r.json?.hookSpecificOutput;
  return { status: r.status, denied: decision?.permissionDecision === "deny", reason: decision?.permissionDecisionReason ?? "", out: r.out };
}

const TOOL = /acks-branch\/branch\.mjs/;
const RULES = /shared-tree\.md/;

/** One case per command: each must be refused, with the tool and the rules page named in the reason. */
function refused(label, commands, { cwd = main, also = [] } = {}) {
  for (const command of commands) {
    test(`${label}: ${command}`, (check) => {
      const r = pretool(command, cwd);
      check("exits 0", r.status === 0, r.out);
      check("denied", r.denied, r.out);
      check("points at the branch tool", TOOL.test(r.reason), r.reason);
      check("points at the rules page", RULES.test(r.reason), r.reason);
      for (const pattern of also) check(`reason matches ${pattern}`, pattern.test(r.reason), r.reason);
    });
  }
}

/** One case per command: each must pass. */
function passes(label, commands, { cwd = main } = {}) {
  for (const command of commands) {
    test(`${label}: ${command}`, (check) => {
      const r = pretool(command, cwd);
      check("exits 0", r.status === 0, r.out);
      check("not denied", !r.denied, r.out);
    });
  }
}

try {
  // --- hand-made branches and worktrees ---

  const creating = ["git worktree add ../x", "git worktree add -b topic/x ../x", "git checkout -b x", "git checkout -B x", "git switch -c x", "git switch -C x", "git switch --create x", "git branch x", "git branch x main"];
  refused("creation refused in main's tree", creating);
  refused("creation refused in a linked worktree", ["git worktree add ../x", "git checkout -b x", "git switch -c x", "git branch x"], { cwd: linked });
  passes("branch and worktree reads pass", ["git branch", "git branch -d x", "git branch -D x", "git branch -m a b", "git branch --list", "git branch -a", "git branch --show-current", "git branch -vv", "git worktree list", "git worktree list --porcelain", "git worktree prune", "git status", "git log --oneline", "ls -la"]);

  // --- worktree removal ---

  const removing = ["git worktree remove ../x", "git worktree remove --force ../x", "git worktree remove -f -f ../x", "git -C ../x worktree remove y"];
  refused("removal refused in main's tree", removing, { also: [/branch\.mjs close/, /node_modules/] });
  refused("removal refused in a linked worktree", ["git worktree remove ../proj.x", "git worktree remove --force ../proj.x"], { cwd: linked, also: [/branch\.mjs close/] });
  refused("removal refused where no repository is", ["git worktree remove x"], { cwd: bare });

  // --- the switch rule, in main's tree ---

  refused("switch off main refused", [
    "git switch other", "git switch --detach", "git switch --detach other", "git switch -d other", "git switch -", "git switch --orphan fresh",
    "git checkout other", "git checkout --detach", "git checkout -", "git checkout -f other", "git checkout v1", `git checkout ${sha}`, `git checkout ${sha.slice(0, 8)}`, "git checkout --orphan fresh",
  ], { also: [/main's tree/] });
  passes("switch to main or a path checkout passes", [
    "git switch main", "git checkout main", "git checkout -- a.txt", "git checkout other -- a.txt", "git checkout other a.txt", "git checkout a.txt",
    "git checkout nonexistent", "git checkout .", "git checkout -p other", "git checkout HEAD -- a.txt", "git switch",
  ]);
  refused("a subdirectory of main's tree is main's tree", ["git switch other"], { cwd: path.join(main, "sub") });
  refused("a `.git` file with no commondir is main's tree", ["git switch other"], { cwd: separate });
  passes("no repository, no refusal", ["git switch other", "git checkout other"], { cwd: bare });

  // --- the switch rule, in a linked worktree ---

  passes("a linked worktree may switch", ["git switch other", "git switch --detach", "git switch -", "git checkout other", "git checkout --detach", "git checkout -", `git checkout ${sha}`, "git switch main"], { cwd: linked });
  passes("a subdirectory of a linked worktree may switch", ["git switch other"], { cwd: path.join(linked, "sub") });

  // --- chained commands, git options, aim ---

  refused("chained", [
    "git status && git switch other", "git status; git checkout other", "git log | cat; git switch other", "git status\ngit switch other",
    "git switch main && git switch other", "echo hi || git switch other", "git status && git worktree remove ../x", "git status && git checkout -b x",
  ]);
  passes("chained, nothing to refuse", ["git status && git switch main", "git status; git checkout -- a.txt", "git branch -d x && git worktree list"]);
  refused("git's own options are skipped", ["git -c core.pager=cat switch other", "git --no-pager checkout other", "FOO=1 git switch other", 'git switch "other"'], { cwd: main });
  refused("-C aims at main's tree from outside any repository", [`git -C ${slash(main)} switch other`, `git -C "${slash(main)}" checkout other`, `git -C ${posix(main)} switch other`], { cwd: bare });
  refused("-C aims at main's tree from a linked worktree", [`git -C ${slash(main)} switch other`], { cwd: linked });
  passes("-C aims at a linked worktree from main's tree", [`git -C ${slash(linked)} switch other`, `git -C ${slash(linked)} checkout --detach`], { cwd: main });
  passes("-C aims at main's tree to switch to main", [`git -C ${slash(main)} switch main`], { cwd: bare });
  refused("a relative -C resolves against the payload's cwd", ["git -C proj switch other"], { cwd: tmp });
  passes("a relative -C into a linked worktree", ["git -C proj.x switch other"], { cwd: tmp });
  refused("cd moves the target", [`cd ${slash(main)} && git switch other`, `cd "${posix(main)}" && git checkout other`], { cwd: bare });
  passes("cd into a linked worktree", [`cd ${slash(linked)} && git switch other`], { cwd: main });

  test("an unparseable payload passes", (check) => {
    const r = run("pretool", { input: "not json" });
    check("exits 0 with no decision", r.status === 0 && !r.json, r.out);
  });
  test("an empty payload passes", (check) => {
    const r = run("pretool", { input: "{}" });
    check("exits 0 with no decision", r.status === 0 && !r.json, r.out);
  });
  test("a payload with no cwd judges the process's own directory", (check) => {
    const r = run("pretool", { cwd: main, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git switch other" } }) });
    check("denied", r.json?.hookSpecificOutput?.permissionDecision === "deny", r.out);
    const free = run("pretool", { cwd: linked, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git switch other" } }) });
    check("passes in a linked worktree", !free.json, free.out);
  });

  // --- worktree-create ---

  test("worktree-create refuses the app's worktree and points at the tool", (check) => {
    const r = run("worktree-create", { input: "{}" });
    check("exits 0", r.status === 0, r.out);
    check("continue is false", r.json?.continue === false, r.out);
    check("stop reason names the tool", TOOL.test(r.json?.stopReason ?? ""), r.out);
    check("a system message is shown", Boolean(r.json?.systemMessage), r.out);
  });

  // --- session-start ---

  test("session-start in main's tree on main says nothing", (check) => {
    const r = run("session-start", { cwd: main });
    check("silent and exits 0", r.status === 0 && r.out === "", r.out);
  });
  test("session-start in a subdirectory of main's tree on main says nothing", (check) => {
    const r = run("session-start", { cwd: path.join(main, "sub") });
    check("silent and exits 0", r.status === 0 && r.out === "", r.out);
  });
  test("session-start outside a repository says nothing", (check) => {
    const r = run("session-start", { cwd: bare });
    check("silent and exits 0", r.status === 0 && r.out === "", r.out);
  });
  test("session-start in a linked worktree names the branch and the way to land", (check) => {
    const r = run("session-start", { cwd: linked });
    const both = `${r.json?.systemMessage}\n${r.json?.hookSpecificOutput?.additionalContext}`;
    check("exits 0", r.status === 0, r.out);
    check("names the branch", /topic\/x/.test(r.json?.systemMessage ?? "") && /topic\/x/.test(r.json?.hookSpecificOutput?.additionalContext ?? ""), r.out);
    check("says it is not live until landed", /not live until/i.test(r.json?.hookSpecificOutput?.additionalContext ?? "") && /live until it lands/i.test(r.json?.systemMessage ?? ""), r.out);
    check("says commit by hand", /commit by hand/i.test(r.json?.systemMessage ?? ""), r.out);
    check("names land and close for the slug", /branch\.mjs land x/.test(both) && /branch\.mjs close x/.test(both), both);
    check("names sync between slices, and close once the feature is walked", /branch\.mjs sync x/.test(r.json?.hookSpecificOutput?.additionalContext ?? "") && /once its feature is walked/.test(both), both);
    check("is a SessionStart context", r.json?.hookSpecificOutput?.hookEventName === "SessionStart", r.out);
  });
  test("session-start in a subdirectory of a linked worktree speaks the same", (check) => {
    const r = run("session-start", { cwd: path.join(linked, "sub") });
    check("names the branch", /topic\/x/.test(r.json?.systemMessage ?? ""), r.out);
  });
  test("session-start in main's tree off main warns with the branch", (check) => {
    const r = run("session-start", { cwd: offMain });
    check("exits 0", r.status === 0, r.out);
    check("warns in the system message", /other/.test(r.json?.systemMessage ?? "") && /not main/.test(r.json?.systemMessage ?? ""), r.out);
    check("warns in the context", /refs\/heads\/main/.test(r.json?.hookSpecificOutput?.additionalContext ?? ""), r.out);
  });
  test("session-start in main's tree on a detached HEAD warns", (check) => {
    const r = run("session-start", { cwd: detached });
    check("warns", /detached/i.test(r.json?.systemMessage ?? "") && /not main/.test(r.json?.systemMessage ?? ""), r.out);
  });
  test("session-start inside .claude/worktrees/ warns about the app's worktree", (check) => {
    const r = run("session-start", { cwd: appTree });
    check("exits 0", r.status === 0, r.out);
    check("names the throwaway branch", /claude\/\*/.test(r.json?.systemMessage ?? ""), r.out);
    check("points at the tool", TOOL.test(`${r.json?.systemMessage}${r.json?.hookSpecificOutput?.additionalContext}`), r.out);
    check("does not give the linked-worktree guidance", !/land/.test(r.json?.systemMessage ?? ""), r.out);
  });

  test("an unknown mode is silent", (check) => {
    const r = run("bogus", { cwd: main });
    check("silent and exits 0", r.status === 0 && r.out === "", r.out);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failures = results.filter((ok) => !ok).length;
console.log(`test-branch-guard: ${results.length} cases, ${failures} failed`);
if (failures) process.exit(1);
