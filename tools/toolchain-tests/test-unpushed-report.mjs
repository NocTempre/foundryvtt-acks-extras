/**
 * Drives the `unpushed-report.mjs` Stop hook against a throwaway clone and
 * checks what it exists to guarantee: a commit the upstream lacks is named by
 * sha, a listing is shown once and again only when it changes, a pushed
 * checkout says nothing, local branches are listed (an unmerged topic, a topic
 * landed and open, an unpushed parked branch, any other branch) with no
 * commit unpushed, and no input makes the hook exit non-zero or ask for
 * anything but a message.
 *
 * Usage:  node tools/toolchain-tests/test-unpushed-report.mjs [--hook <unpushed-report.mjs>]
 *         (defaults to the copy in this repository; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const HOOK = path.resolve(process.argv.includes("--hook") ? process.argv[process.argv.indexOf("--hook") + 1] : path.join(TEMPLATE_ROOT, ".claude/hooks/unpushed-report.mjs"));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "unpushed-report-test-"));
const remote = path.join(scratch, "remote.git");
const work = path.join(scratch, "family", "module");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (name) => {
  fs.writeFileSync(path.join(work, name), name);
  git(work, "add", name);
  git(work, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", `adds ${name}`);
  return git(work, "rev-parse", "--short", "HEAD");
};

fs.mkdirSync(path.dirname(work), { recursive: true });
execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
execFileSync("git", ["clone", "-q", remote, work], { stdio: "ignore" });
git(work, "checkout", "-q", "-B", "main");
commit("first");
git(work, "push", "-q", "-u", "origin", "main");

const tag = `t${process.pid}-${Date.now()}`;
/** Runs the hook as Claude Code does and returns its exit status and parsed output. */
function stop(session, input) {
  const run = spawnSync(process.execPath, [HOOK], { input: input ?? JSON.stringify({ session_id: `${tag}-${session}`, cwd: work, hook_event_name: "Stop" }), encoding: "utf8" });
  let out = null;
  try {
    out = run.stdout ? JSON.parse(run.stdout) : null;
  } catch {
    out = { unparseable: run.stdout };
  }
  return { status: run.status, out };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const silent = (r) => r.status === 0 && r.out === null;

let r = stop("a");
check("a pushed checkout says nothing", silent(r), JSON.stringify(r));

const second = commit("second");
r = stop("a");
check("a local commit is named by sha", r.status === 0 && r.out?.systemMessage?.includes(second) && r.out.systemMessage.includes("module: 1 commit(s) not on origin/main"), JSON.stringify(r));
check("the output is a message and nothing else", r.out && Object.keys(r.out).join() === "systemMessage", JSON.stringify(r.out));

r = stop("a");
check("the same listing is not shown twice to one session", silent(r), JSON.stringify(r));

r = stop("b");
check("another session is shown it once", r.out?.systemMessage?.includes(second), JSON.stringify(r));

const third = commit("third");
r = stop("a");
check("a changed listing is shown again", r.out?.systemMessage?.includes(third) && r.out.systemMessage.includes(second), JSON.stringify(r));

git(work, "push", "-q", "origin", "main");
r = stop("a");
check("after the push it says nothing", silent(r), JSON.stringify(r));

const fourth = commit("fourth");
r = stop("a");
check("a commit after a push is reported", r.out?.systemMessage?.includes(fourth) && !r.out.systemMessage.includes(third), JSON.stringify(r));

for (let i = 0; i < 12; i++) commit(`bulk${i}`);
r = stop("a");
check("a long listing is cut to a count", /and 3 more/.test(r.out?.systemMessage ?? ""), JSON.stringify(r));

const template = path.join(scratch, "family", "acks-module-template");
execFileSync("git", ["clone", "-q", remote, template], { stdio: "ignore" });
fs.writeFileSync(path.join(template, "canon"), "canon");
git(template, "add", "canon");
git(template, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "adds canon");
const canon = git(template, "rev-parse", "--short", "HEAD");
r = stop("a");
check("the template beside the project is read too", r.out?.systemMessage?.includes(canon) && r.out.systemMessage.includes("acks-module-template: 1 commit(s)") && r.out.systemMessage.includes("module: 13 commit(s)"), JSON.stringify(r));

const bare = path.join(scratch, "not-a-repo");
fs.mkdirSync(bare);
r = stop("c", JSON.stringify({ session_id: `${tag}-c`, cwd: bare }));
check("a folder in no repository says nothing", silent(r), JSON.stringify(r));

r = stop("d", "not json");
check("an unparseable payload exits 0 in silence", silent(r), JSON.stringify(r));

// Branches: listed with no commit unpushed, once per change, and never pushed.
const remote2 = path.join(scratch, "remote2.git");
const proj = path.join(scratch, "fam2", "proj");
fs.mkdirSync(path.dirname(proj), { recursive: true });
execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote2]);
execFileSync("git", ["clone", "-q", remote2, proj], { stdio: "ignore" });
git(proj, "checkout", "-q", "-B", "main");
for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.invalid"]]) git(proj, "config", k, v);
fs.writeFileSync(path.join(proj, "first"), "first");
git(proj, "add", "first");
git(proj, "commit", "-q", "-m", "first");
git(proj, "push", "-q", "-u", "origin", "main");
const stopAt = (session, cwd) => stop(session, JSON.stringify({ session_id: `${tag}-${session}`, cwd, hook_event_name: "Stop" }));
const topicDir = path.join(scratch, "fam2", "proj.a");

r = stopAt("e1", proj);
check("a repository with only main says nothing", silent(r), JSON.stringify(r));

git(proj, "worktree", "add", "-q", "-b", "topic/a", topicDir, "main");
r = stopAt("e2", proj);
check("a topic opened and not yet committed to is not called landed", r.out?.systemMessage?.includes("topic/a: 0 commit(s) ahead of main") && !r.out.systemMessage.includes("landed, open"), JSON.stringify(r));

fs.writeFileSync(path.join(topicDir, "a.txt"), "a");
git(topicDir, "add", "a.txt");
git(topicDir, "commit", "-q", "-m", "adds a");
r = stopAt("e3", proj);
const msg = r.out?.systemMessage ?? "";
check("an unmerged topic is listed with its commits ahead, worktree and age, though nothing is unpushed", msg.includes("topic/a: 1 commit(s) ahead of main") && msg.includes(`worktree ${path.resolve(topicDir)}`) && msg.includes("last commit today") && !msg.includes("not on origin"), JSON.stringify(r));
r = stopAt("e3", proj);
check("an unchanged branch listing is not shown twice to one session", silent(r), JSON.stringify(r));
r = stopAt("e4", topicDir);
check("a session inside the topic worktree reads the repository's listing", r.out?.systemMessage?.includes("topic/a: 1 commit(s) ahead of main") && r.out.systemMessage.startsWith("Not pushed or not landed"), JSON.stringify(r));

git(proj, "merge", "-q", "--ff-only", "topic/a");
git(proj, "push", "-q", "origin", "main");
r = stopAt("e3", proj);
check("a topic contained in main and still open is named for syncing or closing", r.out?.systemMessage?.includes("landed, open:") && r.out.systemMessage.includes(`  topic/a: landed, open: sync it before its next slice, or close it once its feature is walked (worktree ${path.resolve(topicDir)})`), JSON.stringify(r));
git(proj, "worktree", "remove", topicDir);
git(proj, "branch", "-q", "-d", "topic/a");
r = stopAt("e3", proj);
check("once the topic is closed the listing is empty", silent(r), JSON.stringify(r));

// A topic opened and never committed to, then synced onto a main that moved: a
// rebase writes reflog entries of its own, and the topic is still not landed.
const syncDir = path.join(scratch, "fam2", "proj.s");
git(proj, "worktree", "add", "-q", "-b", "topic/s", syncDir, "main");
fs.writeFileSync(path.join(proj, "moved"), "moved");
git(proj, "add", "moved");
git(proj, "commit", "-q", "-m", "main moves");
git(proj, "push", "-q", "origin", "main");
git(syncDir, "rebase", "main");
r = stopAt("e7", proj);
check("a never-committed topic synced onto a moved main is still not called landed", r.out?.systemMessage?.includes("topic/s: 0 commit(s) ahead of main") && !r.out.systemMessage.includes("landed, open"), JSON.stringify(r));
git(proj, "worktree", "remove", syncDir);
git(proj, "branch", "-q", "-d", "topic/s");

git(proj, "branch", "parked/idea");
git(proj, "branch", "wip");
r = stopAt("e5", proj);
check("an unpushed parked branch and any other local branch are listed", r.out?.systemMessage?.includes("parked/idea: not pushed") && r.out.systemMessage.includes("wip: local branch"), JSON.stringify(r));
git(proj, "push", "-q", "origin", "parked/idea");
git(proj, "branch", "-q", "-d", "wip");
r = stopAt("e6", proj);
check("a parked branch on origin is no longer listed", silent(r), JSON.stringify(r));
check("the hook pushed nothing", git(remote2, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").join(" ") === "main parked/idea", git(remote2, "for-each-ref", "--format=%(refname:short)", "refs/heads"));

fs.rmSync(scratch, { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(os.tmpdir(), "acks-unpushed-report")).filter((f) => f.startsWith(tag))) fs.rmSync(path.join(os.tmpdir(), "acks-unpushed-report", f), { force: true });

const failures = results.filter((ok) => !ok).length;
console.log(`test-unpushed-report: ${results.length} cases, ${failures} failed`);
process.exit(failures ? 1 : 0);
