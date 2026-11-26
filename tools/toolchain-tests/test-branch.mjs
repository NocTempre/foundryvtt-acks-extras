/**
 * Drives `.claude/skills/acks-branch/branch.mjs` against throwaway
 * repositories under the OS temp directory (a bare remote, a clone as the main
 * checkout, topic worktrees beside it) and checks what the tool exists to
 * guarantee: a topic lands only as a fast-forward of the gated tip with `HEAD`
 * read back, every refusal leaves `main` where it was and the landing lease
 * released, and `close` never lets a worktree's removal empty `main`'s
 * `node_modules`.
 *
 * Usage:  node tools/toolchain-tests/test-branch.mjs [--branch <branch.mjs>]
 *         (defaults to the copy in this repository; pass a modified copy,
 *         with `acks-commit/` beside its folder, to confirm a case fails when
 *         the behaviour it guards is broken)
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const flag = process.argv.indexOf("--branch");
const BRANCH = path.resolve(flag >= 0 ? process.argv[flag + 1] : (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(TEMPLATE_ROOT, ".claude/skills/acks-branch/branch.mjs")));
const tool = await import(url.pathToFileURL(BRANCH).href);
const { acquire } = await import(url.pathToFileURL(path.join(TEMPLATE_ROOT, ".claude/skills/acks-commit/lease.mjs")).href);

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/i.test(k)));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "branch-test-"));
const remote = path.join(scratch, "remote.git");
const main = path.join(scratch, "family", "module");
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...ENV, GIT_EDITOR: "true" } }).trim();
const wt = (slug) => `${main}.${slug}`;
const commitIn = (dir, file, text, message = `edits ${file}`) => {
  fs.writeFileSync(path.join(dir, file), text);
  sh(dir, "add", file);
  sh(dir, "commit", "-q", "-m", message);
  return sh(dir, "rev-parse", "HEAD");
};
const head = () => sh(main, "rev-parse", "HEAD");
const hasBranch = (name) => spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd: main, env: ENV }).status === 0;
const countFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
const cli = (args, { cwd = main } = {}) => {
  const r = spawnSync(process.execPath, [BRANCH, ...args], { cwd, encoding: "utf8", env: ENV });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const gitDir = path.join(main, ".git");
/**
 * Whether the landing lease is free: no lease file stands (a holder that has
 * exited would be taken over by the next acquire, which would hide a lease
 * never given up), and one can be taken and given up again.
 */
const leaseFree = async () => {
  if (fs.existsSync(path.join(gitDir, "acks-lease", "landing.json"))) return false;
  const lease = await acquire(gitDir, { session: "probe" }, { waitMs: 0 });
  lease?.stop();
  return Boolean(lease);
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const brief = (r) => JSON.stringify({ status: r.status, out: r.out.slice(-300), err: r.err.slice(-500) });

// --- fixtures: a bare remote, a main checkout with the canon copied in and a real node_modules.
fs.mkdirSync(path.dirname(main), { recursive: true });
execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { env: ENV });
execFileSync("git", ["clone", "-q", remote, main], { stdio: "ignore", env: ENV });
sh(main, "checkout", "-q", "-B", "main");
for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.invalid"], ["core.autocrlf", "false"]]) sh(main, "config", k, v);
for (const skill of ["acks-commit", "acks-branch"]) fs.cpSync(path.join(TEMPLATE_ROOT, ".claude/skills", skill), path.join(main, ".claude/skills", skill), { recursive: true });
fs.writeFileSync(path.join(main, ".gitignore"), "node_modules\n");
for (const f of ["a.txt", "shared.txt", "peer.txt"]) fs.writeFileSync(path.join(main, f), "base\n");
sh(main, "add", "-A");
sh(main, "commit", "-q", "-m", "base");
sh(main, "push", "-q", "-u", "origin", "main");
const originMain = () => sh(remote, "rev-parse", "refs/heads/main");
const originAtStart = originMain();
const modules = path.join(main, "node_modules");
const seedModules = () => {
  fs.mkdirSync(path.join(modules, "pkg", "lib"), { recursive: true });
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(modules, "pkg", i % 2 ? "lib" : ".", `f${i}.js`), `// ${i}\n`);
};
seedModules();
const modulesCount = countFiles(modules);
const gate = (name, command) => {
  const dir = path.join(scratch, `gate-${name}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "change.json"), JSON.stringify({ gate: [command] }));
  return dir;
};
const green = gate("green", 'node -e "process.exit(0)"');
const red = gate("red", 'node -e "console.log(\'gate says no\'); process.exit(1)"');

// --- open
let r = cli(["open", "ff"]);
check("open creates the branch, the sibling folder and the node_modules link", r.status === 0 && hasBranch("topic/ff") && fs.existsSync(wt("ff")) && fs.lstatSync(path.join(wt("ff"), "node_modules")).isSymbolicLink() && countFiles(path.join(wt("ff"), "node_modules")) === modulesCount, brief(r));
check("open says what a session does next", /walked live/.test(r.out) && /by hand/.test(r.out) && /land ff/.test(r.out) && /build:packs/.test(r.out), brief(r));
check("open names sync between slices and every gitignored file the worktree lacks", /sync ff/.test(r.out) && /every gitignored file/.test(r.out), brief(r));
check("the branch starts at main", sh(main, "rev-parse", "topic/ff") === head());
r = cli(["open", "Bad_Slug"]);
check("a bad slug is a usage error", r.status === 2 && !fs.existsSync(`${main}.Bad_Slug`), brief(r));
r = cli(["open", "ff"]);
check("open refuses an existing branch", r.status === 1 && /already exists/.test(r.err), brief(r));
fs.mkdirSync(wt("taken"));
r = cli(["open", "taken"]);
check("open refuses an existing folder and makes no branch", r.status === 1 && /already exists/.test(r.err) && !hasBranch("topic/taken"), brief(r));
fs.rmdirSync(wt("taken"));
sh(main, "checkout", "-q", "--detach");
r = cli(["open", "detached"]);
check("open refuses while main's checkout is not on main", r.status === 1 && !hasBranch("topic/detached"), brief(r));
sh(main, "checkout", "-q", "main");
r = cli(["open", "ff"], { cwd: wt("ff") });
check("a command run from inside a worktree finds the same main root", r.status === 1 && /already exists/.test(r.err), brief(r));
check("usage with no mode exits 2", cli([]).status === 2);

// --- land: fast-forward
const tipFf = commitIn(wt("ff"), "ff.txt", "ff\n");
const before = head();
r = cli(["land", "ff", "--change", green]);
check("land fast-forwards main to the tip and reads HEAD back", r.status === 0 && head() === tipFf && r.out.includes(`landed topic/ff ${tipFf}; main fast-forwarded from ${before}; not pushed`), brief(r));
check("the gate ran on the tip, from main", (fs.existsSync(path.join(green, "branch-land.log")) ? fs.readFileSync(path.join(green, "branch-land.log"), "utf8") : "").includes(`GREEN: the full gate passes on ${tipFf}`));
check("land says the topic stays open, to sync before the next slice and close once walked", /topic\/ff stays open: sync ff before its next slice; close ff once its feature is walked/.test(r.out), brief(r));
check("land never pushes", originMain() === originAtStart && sh(remote, "branch", "--list", "topic/*") === "");
check("the landed files are in main's tree", fs.existsSync(path.join(main, "ff.txt")));
check("the lease is free after a landing", await leaseFree());
r = cli(["land", "ff", "--change", green]);
check("land refuses a topic that holds nothing new, and says to sync or close it", r.status === 1 && /holds nothing main does not/.test(r.err) && /sync ff/.test(r.err) && /close ff/.test(r.err), brief(r));

// --- land twice: a topic stays open between landings and lands its next slice
cli(["open", "twice"]);
commitIn(wt("twice"), "twice1.txt", "slice 1\n");
r = cli(["land", "twice", "--change", green]);
check("a topic's first slice lands", r.status === 0 && head() === sh(main, "rev-parse", "topic/twice"), brief(r));
const slice2 = commitIn(wt("twice"), "twice2.txt", "slice 2\n");
r = cli(["land", "twice", "--change", green]);
check("its second slice, committed after the first landed, lands as a fast-forward", r.status === 0 && head() === slice2 && !/rebased/.test(r.out) && fs.existsSync(path.join(main, "twice2.txt")), brief(r));
const walkFix = commitIn(main, "walkfix.txt", "fixed on main\n");
const slice3 = commitIn(wt("twice"), "twice3.txt", "slice 3\n");
r = cli(["land", "twice", "--change", green]);
const tip3 = sh(main, "rev-parse", "topic/twice");
check("a third slice lands over a commit main gained since the second", r.status === 0 && head() === tip3 && tip3 !== slice3 && sh(main, "rev-parse", "HEAD~1") === walkFix && fs.existsSync(path.join(wt("twice"), "walkfix.txt")) && /rebased topic\/twice/.test(r.out), brief(r));
check("the lease is free after the third landing", await leaseFree());

// --- land: rebase onto a moved main
cli(["open", "rb"]);
const oldTip = commitIn(wt("rb"), "rb.txt", "rb\n");
const peerCommit = commitIn(main, "m1.txt", "m1\n");
r = cli(["land", "rb", "--change", green]);
const newTip = sh(main, "rev-parse", "topic/rb");
check("land rebases onto a moved main and fast-forwards", r.status === 0 && head() === newTip && newTip !== oldTip && sh(main, "merge-base", "--is-ancestor", peerCommit, "HEAD") === "" && fs.existsSync(path.join(main, "rb.txt")) && /rebased topic\/rb/.test(r.out), brief(r));
check("the rebased history is linear: main's old head is the tip's parent", sh(main, "rev-parse", "HEAD~1") === peerCommit);

// --- land: a conflict stops the rebase
cli(["open", "cf"]);
commitIn(wt("cf"), "shared.txt", "topic\n");
commitIn(main, "shared.txt", "main\n");
const beforeConflict = head();
r = cli(["land", "cf", "--change", green]);
const inProgress = fs.existsSync(path.resolve(wt("cf"), sh(wt("cf"), "rev-parse", "--git-path", "rebase-merge")));
check("a conflict refuses, leaves main untouched and the rebase in progress", r.status === 1 && head() === beforeConflict && inProgress && /rebase --continue/.test(r.err) && /land cf again/.test(r.err), brief(r));
check("a conflict leaves the lease free", await leaseFree());
r = cli(["land", "cf", "--change", green]);
check("land refuses while a rebase is stopped", r.status === 1 && /rebase is in progress/.test(r.err), brief(r));
fs.writeFileSync(path.join(wt("cf"), "shared.txt"), "both\n");
sh(wt("cf"), "add", "shared.txt");
sh(wt("cf"), "rebase", "--continue");
r = cli(["land", "cf", "--change", green]);
check("after the conflict is resolved a second land succeeds", r.status === 0 && head() === sh(main, "rev-parse", "topic/cf"), brief(r));

// --- land: refusals
cli(["open", "dirty"]);
commitIn(wt("dirty"), "dirty.txt", "d\n");
fs.writeFileSync(path.join(wt("dirty"), "junk.txt"), "untracked\n");
let h = head();
r = cli(["land", "dirty", "--change", green]);
check("land refuses a worktree holding an untracked file", r.status === 1 && /not clean/.test(r.err) && head() === h, brief(r));
fs.rmSync(path.join(wt("dirty"), "junk.txt"));
fs.writeFileSync(path.join(wt("dirty"), "a.txt"), "edited\n");
r = cli(["land", "dirty", "--change", green]);
check("land refuses a worktree holding a tracked edit", r.status === 1 && /not clean/.test(r.err) && head() === h, brief(r));
sh(wt("dirty"), "checkout", "--", "a.txt");

cli(["open", "stg"]);
commitIn(wt("stg"), "stg.txt", "s\n");
fs.writeFileSync(path.join(main, "stage.txt"), "peer\n");
sh(main, "add", "stage.txt");
h = head();
r = cli(["land", "stg", "--change", green]);
check("land refuses while main's index holds a staged change", r.status === 1 && /staged/.test(r.err) && head() === h, brief(r));
check("a refusal under the lease releases it", await leaseFree());
sh(main, "reset", "-q");
fs.rmSync(path.join(main, "stage.txt"));
r = cli(["land", "stg", "--change", green]);
check("the refusal was not sticky: land succeeds once the index is clear", r.status === 0, brief(r));

cli(["open", "pushed"]);
commitIn(wt("pushed"), "pushed.txt", "p\n");
sh(main, "push", "-q", "origin", "topic/pushed");
h = head();
r = cli(["land", "pushed", "--change", green]);
check("land refuses a topic that exists on origin", r.status === 1 && /on origin/.test(r.err) && head() === h, brief(r));

cli(["open", "peer"]);
commitIn(wt("peer"), "peer.txt", "topic\n");
fs.writeFileSync(path.join(main, "peer.txt"), "peer edit\n");
h = head();
r = cli(["land", "peer", "--change", green]);
check("a peer's unstaged edit to a file the topic changes: refused, nothing moved, the edit kept", r.status === 1 && /ff-only/.test(r.err) && /did not move/.test(r.err) && head() === h && fs.readFileSync(path.join(main, "peer.txt"), "utf8") === "peer edit\n", brief(r));
check("that refusal releases the lease", await leaseFree());
sh(main, "checkout", "--", "peer.txt");
r = cli(["land", "peer", "--change", green]);
check("with the edit gone the same topic lands", r.status === 0, brief(r));

cli(["open", "red"]);
commitIn(wt("red"), "red.txt", "r\n");
h = head();
r = cli(["land", "red", "--change", red]);
check("a red gate refuses, main unmoved, the log's tail shown", r.status === 1 && /not green/.test(r.err) && /gate says no/.test(r.err) && head() === h && !fs.existsSync(path.join(main, "red.txt")), brief(r));
check("a red gate releases the lease", await leaseFree());
check("the refused topic stays open", hasBranch("topic/red") && fs.existsSync(wt("red")));

// No --change: the tool makes its own scratch directory, and a refused gate keeps the log there. The fixture holds no package.json, so the default gate refuses.
cli(["open", "nolog"]);
commitIn(wt("nolog"), "nolog.txt", "n\n");
h = head();
r = cli(["land", "nolog"]);
const keptLog = /; ([^;]+?branch-land\.log) holds the run/.exec(r.err)?.[1];
check("a refused gate with no change directory prints its log's path", r.status === 1 && /not green/.test(r.err) && Boolean(keptLog) && head() === h, brief(r));
check("that log is kept and holds the gate's output", Boolean(keptLog) && fs.existsSync(keptLog) && fs.readFileSync(keptLog, "utf8").trim().length > 0, String(keptLog));
check("the kept directory holds no clone", Boolean(keptLog) && !fs.existsSync(path.join(path.dirname(keptLog), "clone")), String(keptLog));
if (keptLog) fs.rmSync(path.dirname(keptLog), { recursive: true, force: true });

cli(["open", "held"]);
commitIn(wt("held"), "held.txt", "h\n");
const other = await acquire(gitDir, { session: "someone-else", change: "other" }, { waitMs: 0 });
h = head();
r = cli(["land", "held", "--wait", "0", "--change", green]);
check("a lease held by another run, with --wait 0, exits 5 and moves nothing", r.status === 5 && /still held/.test(r.err) && head() === h, brief(r));
other.stop();
r = cli(["land", "held", "--change", green]);
check("once the lease is given up the same land succeeds", r.status === 0, brief(r));

// the readback, in process: a merge that reports success and leaves HEAD elsewhere
cli(["open", "rb2"]);
commitIn(wt("rb2"), "rb2.txt", "r\n");
let caught = null;
try {
  await tool.land("rb2", {
    cwd: main,
    say: () => {},
    change: green,
    waitMinutes: 0,
    merge: (root, sha) => {
      sh(root, "merge", "-q", "--ff-only", sha);
      sh(root, "commit", "-q", "--allow-empty", "-m", "something else");
      return { status: 0, out: "", err: "" };
    },
  });
} catch (e) {
  caught = e;
}
check("land refuses unless HEAD reads back as the tip", caught instanceof tool.Refusal && /not the tip/.test(caught.message), String(caught?.message));
check("that refusal releases the lease", await leaseFree());
sh(main, "reset", "-q", "--hard", "HEAD~1");

// --- land: what happens under the lease, in process
const leaseFile = path.join(gitDir, "acks-lease", "landing.json");
const scriptGate = (name, source) => {
  const file = path.join(scratch, `gate-${name}.mjs`);
  fs.writeFileSync(file, source);
  return gate(name, `node "${file}"`);
};
const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
/**
 * Lands `slug` in process while another run holds the lease; `whileWaiting`
 * runs once land has said it is waiting, and the held lease is given up after it.
 */
const landWhileHeld = async (slug, whileWaiting) => {
  const holder = await acquire(gitDir, { session: "someone-else", change: "other" }, { waitMs: 0 });
  const said = [];
  let waiting;
  const told = new Promise((resolve) => (waiting = resolve));
  const landing = settle(tool.land(slug, { cwd: main, change: green, waitMinutes: 1, say: (m) => { said.push(m); if (/landing lease is held by/.test(m)) waiting(); } }));
  await Promise.race([told, landing, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  try {
    await whileWaiting();
  } finally {
    holder.stop();
  }
  return { ...(await landing), said: said.join("\n") };
};

cli(["open", "wait"]);
commitIn(wt("wait"), "wait.txt", "w\n");
let peerMoved;
let waited = await landWhileHeld("wait", () => { peerMoved = commitIn(main, "waitpeer.txt", "p\n"); });
check("main moves while land waits for the lease: it rebases once under the lease and lands", waited.value === 0 && head() === sh(main, "rev-parse", "topic/wait") && sh(main, "rev-parse", "HEAD~1") === peerMoved && fs.existsSync(path.join(main, "wait.txt")), JSON.stringify({ value: waited.value, error: waited.error?.message, said: waited.said }));
check("it says main moved while it waited", /main moved while this run waited; rebased topic\/wait onto main/.test(waited.said), waited.said);
check("the lease is free after that landing", await leaseFree());

cli(["open", "waitcf"]);
commitIn(wt("waitcf"), "shared.txt", "topic under the lease\n");
waited = await landWhileHeld("waitcf", () => { peerMoved = commitIn(main, "shared.txt", "main under the lease\n"); });
check("main moves while land waits, onto a conflict: refused with exit 1 and main unmoved", waited.error?.code === 1 && /rebase --continue/.test(waited.error.message) && head() === peerMoved, JSON.stringify({ value: waited.value, error: waited.error?.message, said: waited.said }));
check("the stopped rebase is left in progress in the worktree", fs.existsSync(path.resolve(wt("waitcf"), sh(wt("waitcf"), "rev-parse", "--git-path", "rebase-merge"))));
check("that refusal releases the lease", await leaseFree());
try {
  sh(wt("waitcf"), "rebase", "--abort");
} catch {
  // No rebase stands: the case above has already failed.
}

cli(["open", "mdg"]);
const tipMdg = commitIn(wt("mdg"), "mdg.txt", "m\n");
const moving = scriptGate("moving", `import { execFileSync } from "node:child_process";\nexecFileSync("git", ["-C", ${JSON.stringify(main)}, "commit", "-q", "--allow-empty", "-m", "x"], { stdio: "ignore" });\n`);
h = head();
r = cli(["land", "mdg", "--change", moving]);
check("a commit made to main during the gate: exit 3, nothing landed", r.status === 3 && /main moved during the gate/.test(r.err) && head() !== h && head() !== tipMdg && !fs.existsSync(path.join(main, "mdg.txt")), brief(r));
check("that refusal releases the lease", await leaseFree());

cli(["open", "stolen"]);
commitIn(wt("stolen"), "stolen.txt", "s\n");
const stealing = scriptGate("stealing", `import fs from "node:fs";\nconst file = ${JSON.stringify(leaseFile)};\nconst held = JSON.parse(fs.readFileSync(file, "utf8"));\nheld.token = "taken-by-another-run";\nfs.writeFileSync(file, JSON.stringify(held) + "\\n");\n`);
h = head();
r = cli(["land", "stolen", "--change", stealing]);
check("a lease taken during the gate: exit 3, main unmoved", r.status === 3 && /lease was taken/.test(r.err) && head() === h && !fs.existsSync(path.join(main, "stolen.txt")), brief(r));
fs.rmSync(leaseFile, { force: true });
check("the lease is free once the taker's file is removed", await leaseFree());

cli(["open", "beat"]);
commitIn(wt("beat"), "beat.txt", "b\n");
const beatLog = path.join(scratch, "heartbeat.json");
const sleeping = scriptGate("sleeping", `import fs from "node:fs";\nconst file = ${JSON.stringify(leaseFile)};\nconst first = fs.statSync(file).mtimeMs;\nawait new Promise((resolve) => setTimeout(resolve, 1200));\nfs.writeFileSync(${JSON.stringify(beatLog)}, JSON.stringify({ first, last: fs.statSync(file).mtimeMs }));\n`);
let beaten = null;
try {
  beaten = await tool.land("beat", { cwd: main, say: () => {}, change: sleeping, waitMinutes: 0, beatMs: 100 });
} catch (e) {
  beaten = e;
}
const beats = fs.existsSync(beatLog) ? JSON.parse(fs.readFileSync(beatLog, "utf8")) : null;
check("the lease's heartbeat beats while the gate runs", beats && beats.last - beats.first >= 300, JSON.stringify({ beats, beaten: String(beaten?.message ?? beaten) }));
check("and the slice lands", beaten === 0 && head() === sh(main, "rev-parse", "topic/beat"), String(beaten?.message ?? beaten));
check("the lease is free after that landing", await leaseFree());

// --- sync: main is brought into a topic's worktree between landings
r = cli(["sync"]);
check("sync with no slug is a usage error", r.status === 2, brief(r));
r = cli(["sync", "nope"]);
check("sync refuses a branch that does not exist", r.status === 1 && /does not exist/.test(r.err), brief(r));

cli(["open", "sy"]);
const tipSy0 = sh(main, "rev-parse", "topic/sy");
h = head();
r = cli(["sync", "sy"]);
check("sync of a topic that already holds main: exit 0, nothing to bring in, tip unchanged", r.status === 0 && r.out.includes(`topic/sy already holds main ${h.slice(0, 10)}; nothing to bring in`) && sh(main, "rev-parse", "topic/sy") === tipSy0 && head() === h, brief(r));
commitIn(wt("sy"), "sy1.txt", "slice 1\n");
r = cli(["land", "sy", "--change", green]);
check("the topic's first slice lands", r.status === 0 && head() === sh(main, "rev-parse", "topic/sy"), brief(r));
const syPeer = commitIn(main, "sypeer.txt", "main moved\n");
r = cli(["sync", "sy"]);
check("sync fast-forwards a landed topic to main", r.status === 0 && sh(main, "rev-parse", "topic/sy") === syPeer && head() === syPeer && /synced topic\/sy onto main/.test(r.out) && fs.existsSync(path.join(wt("sy"), "sypeer.txt")), brief(r));
const sy2 = commitIn(wt("sy"), "sy2.txt", "slice 2\n");
r = cli(["land", "sy", "--change", green]);
check("the next slice, written after the sync, lands as a fast-forward with no rebase", r.status === 0 && head() === sy2 && !/rebased/.test(r.out), brief(r));
check("sync never takes the landing lease", await leaseFree());

cli(["open", "sd"]);
const sdOld = commitIn(wt("sd"), "sd.txt", "sd\n");
const sdPeer = commitIn(main, "sdpeer.txt", "peer\n");
r = cli(["sync", "sd"]);
const sdTip = sh(main, "rev-parse", "topic/sd");
check("sync rebases a diverged topic onto main and leaves main where it was", r.status === 0 && sdTip !== sdOld && head() === sdPeer && sh(main, "rev-parse", "HEAD") === sdPeer && sh(main, "rev-parse", `${sdTip}~1`) === sdPeer && /synced topic\/sd onto main/.test(r.out) && fs.existsSync(path.join(wt("sd"), "sdpeer.txt")), brief(r));
check("the synced topic then lands as a fast-forward", cli(["land", "sd", "--change", green]).status === 0 && head() === sdTip);

cli(["open", "sc"]);
commitIn(wt("sc"), "shared.txt", "topic sc\n");
const scPeer = commitIn(main, "shared.txt", "main sc\n");
r = cli(["sync", "sc"]);
const scStopped = fs.existsSync(path.resolve(wt("sc"), sh(wt("sc"), "rev-parse", "--git-path", "rebase-merge")));
check("a conflicting sync refuses, leaves the rebase in progress, main untouched, and says how it ends", r.status === 1 && scStopped && head() === scPeer && /finishes the sync/.test(r.err) && /rebase --abort/.test(r.err) && !/land sc again/.test(r.err), brief(r));
r = cli(["sync", "sc"]);
check("sync refuses while a rebase is stopped", r.status === 1 && /rebase is in progress/.test(r.err), brief(r));
check("a conflicting sync leaves the lease free", await leaseFree());
sh(wt("sc"), "rebase", "--abort");

cli(["open", "sdirty"]);
fs.writeFileSync(path.join(wt("sdirty"), "junk.txt"), "untracked\n");
r = cli(["sync", "sdirty"]);
check("sync refuses a dirty worktree", r.status === 1 && /not clean/.test(r.err), brief(r));
fs.rmSync(path.join(wt("sdirty"), "junk.txt"));

cli(["open", "sdt"]);
sh(wt("sdt"), "checkout", "-q", "--detach");
r = cli(["sync", "sdt"]);
check("sync refuses a worktree that is not on its topic branch", r.status === 1 && /not refs\/heads\/topic\/sdt/.test(r.err), brief(r));
sh(wt("sdt"), "checkout", "-q", "topic/sdt");

h = head();
r = cli(["sync", "pushed"]);
check("sync refuses a topic that exists on origin, and never rebases it", r.status === 1 && /on origin/.test(r.err) && /never rebased/.test(r.err) && head() === h, brief(r));

// --- close
const modulesBefore = countFiles(modules);
r = cli(["close", "ff"]);
check("close removes the worktree and branch of a landed topic", r.status === 0 && !fs.existsSync(wt("ff")) && !hasBranch("topic/ff"), brief(r));
check("close keeps main's node_modules intact", countFiles(modules) === modulesBefore && modulesBefore === modulesCount, `${countFiles(modules)} files, was ${modulesCount}`);

cli(["open", "unmerged"]);
commitIn(wt("unmerged"), "u.txt", "u\n");
r = cli(["close", "unmerged"]);
check("close refuses an unmerged topic and names the owner's word", r.status === 1 && /--discard-unmerged/.test(r.err) && /owner/.test(r.err) && hasBranch("topic/unmerged") && fs.existsSync(wt("unmerged")), brief(r));
fs.writeFileSync(path.join(wt("unmerged"), "junk.txt"), "x\n");
r = cli(["close", "unmerged", "--discard-unmerged"]);
check("close refuses a dirty worktree even with the flag", r.status === 1 && /not clean/.test(r.err) && fs.existsSync(wt("unmerged")), brief(r));
fs.rmSync(path.join(wt("unmerged"), "junk.txt"));
r = cli(["close", "unmerged", "--discard-unmerged"]);
check("--discard-unmerged drops an unmerged topic", r.status === 0 && !fs.existsSync(wt("unmerged")) && !hasBranch("topic/unmerged") && countFiles(modules) === modulesCount, brief(r));

// the link check, in process
const lk = path.join(scratch, "lk");
fs.mkdirSync(lk);
fs.symlinkSync(modules, path.join(lk, "node_modules"), "junction");
let refused = null;
try {
  tool.checkNoLinks(lk);
} catch (e) {
  refused = e;
}
check("the link check refuses while a link remains", refused instanceof tool.Refusal && /node_modules/.test(refused.message), String(refused));
const kept = tool.unlinkTopLevel(lk, () => {});
check("an unlink that does nothing leaves the link reported", kept.remaining.length === 1 && kept.removed.length === 1);
const gone = tool.unlinkTopLevel(lk);
check("unlinking removes the link and not its target", gone.remaining.length === 0 && countFiles(modules) === modulesCount);
tool.checkNoLinks(lk);
check("the link check is silent once none remain", true);

// the node_modules check, in process
cli(["open", "nm"]);
caught = null;
try {
  tool.close("nm", {
    cwd: main,
    say: () => {},
    remove: (root, dir) => {
      sh(root, "worktree", "remove", dir);
      fs.rmSync(modules, { recursive: true, force: true });
      fs.mkdirSync(modules);
    },
  });
} catch (e) {
  caught = e;
}
check("close reports an emptied main node_modules and the npm install line", caught instanceof tool.Refusal && caught.code === 1 && /npm install/.test(caught.message) && caught.message.includes(main) && /empty/.test(caught.message), String(caught?.message));
check("the topic was closed all the same", !hasBranch("topic/nm") && !fs.existsSync(wt("nm")));
seedModules();

cli(["open", "failrm"]);
caught = null;
try {
  tool.close("failrm", { cwd: main, say: () => {}, sleep: () => {}, remove: () => { throw new tool.Refusal("removal failed"); } });
} catch (e) {
  caught = e;
}
check("a failed removal of an intact worktree puts the link back and says the folder could not be removed", /^removal failed/.test(caught?.message ?? "") && /could not be removed/.test(caught.message) && /put back/.test(caught.message) && tool.linksIn(wt("failrm")).includes("node_modules") && countFiles(modules) === modulesCount, String(caught?.message));
r = cli(["close", "failrm"]);
check("and the next close removes it", r.status === 0 && !fs.existsSync(wt("failrm")) && countFiles(modules) === modulesCount, brief(r));

// a locked folder: retried with the backoff, and a link that is out stays out
cli(["open", "retry"]);
const sleeps = [];
let tries = 0;
const says = [];
const linksAtRemove = [];
caught = null;
try {
  tool.close("retry", {
    cwd: main,
    say: (line) => says.push(line),
    backoff: [5, 6, 7],
    sleep: (ms) => sleeps.push(ms),
    remove: (root, dir) => {
      linksAtRemove.push(tool.linksIn(dir).length);
      if (++tries < 3) throw new tool.Refusal("Permission denied");
      sh(root, "worktree", "remove", dir);
    },
  });
} catch (e) {
  caught = e;
}
check("the worktree holds no link at any call of the removal", linksAtRemove.length === 3 && linksAtRemove.every((n) => n === 0), linksAtRemove.join());
check("close retries a locked removal with its backoff until it goes", !caught && tries === 3 && sleeps.join() === "5,6" && !fs.existsSync(wt("retry")) && !hasBranch("topic/retry") && countFiles(modules) === modulesCount, `${tries} tries, sleeps ${sleeps}`);

cli(["open", "locked"]);
const lockedDir = wt("locked");
const lockedSleeps = [];
// git strips the worktree, deregisters it and stops at the folder: what a held-open folder leaves
const gitStrips = (root, dir) => {
  sh(root, "worktree", "remove", dir);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "held.txt"), "a process holds this\n");
  throw new tool.Refusal("failed to delete: Permission denied");
};
let lockedTries = 0;
caught = null;
try {
  tool.close("locked", { cwd: main, say: () => {}, backoff: [1, 2, 3], sleep: (ms) => lockedSleeps.push(ms), remove: (root, dir) => { lockedTries++; gitStrips(root, dir); } });
} catch (e) {
  caught = e;
}
check("a removal that failed after git stripped the worktree is not retried through git", lockedTries === 1, `${lockedTries} tries`);
check("a locked leftover folder is named, with the link already removed and safe to delete", caught instanceof tool.Refusal && caught.message.includes(lockedDir) && /already removed/.test(caught.message) && /safe to delete/.test(caught.message), String(caught?.message));
check("the locked folder holds no link, main's node_modules is intact, and the branch waits for the re-run", tool.linksIn(lockedDir).length === 0 && countFiles(modules) === modulesCount && hasBranch("topic/locked"), `${tool.linksIn(lockedDir)}`);
check("the leftover folder was retried with the backoff", lockedSleeps.join() === "1,2,3", `${lockedSleeps}`);

// the re-run over a worktree already gone, as seen twice: the junction is back in the folder
fs.rmSync(path.join(lockedDir, "held.txt"));
fs.symlinkSync(modules, path.join(lockedDir, "node_modules"), "junction");
r = cli(["close", "locked"]);
check("a re-run over a gone worktree unlinks the leftover junction, removes the folder and deletes the branch", r.status === 0 && !fs.existsSync(lockedDir) && !hasBranch("topic/locked") && /already gone/.test(r.out) && /leftover folder/.test(r.out) && /removed/.test(r.out), brief(r));
check("and main's node_modules is untouched", countFiles(modules) === modulesCount, `${countFiles(modules)} files, was ${modulesCount}`);

// a re-run whose leftover folder is still locked: reported, link out, branch closed
cli(["open", "stuck"]);
try {
  tool.close("stuck", { cwd: main, say: () => {}, backoff: [], sleep: () => {}, remove: gitStrips });
} catch {
  // the first close leaves the folder behind, which is the state under test
}
fs.symlinkSync(modules, path.join(wt("stuck"), "node_modules"), "junction");
r = cli(["close", "stuck"]);
check("a re-run reports a leftover folder it cannot remove, with its link unlinked", r.status === 0 && fs.existsSync(wt("stuck")) && tool.linksIn(wt("stuck")).length === 0 && /still there/.test(r.out) && /safe to delete/.test(r.out) && !hasBranch("topic/stuck") && countFiles(modules) === modulesCount, brief(r));
fs.rmSync(wt("stuck"), { recursive: true });

// a folder really held open (Windows refuses to delete a directory that is a process's cwd), real git
if (process.platform === "win32") {
  cli(["open", "held"]);
  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: wt("held"), stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  caught = null;
  try {
    tool.close("held", { cwd: main, say: () => {}, backoff: [] });
  } catch (e) {
    caught = e;
  }
  const heldLinks = fs.existsSync(wt("held")) ? tool.linksIn(wt("held")).length : 0;
  const heldWhole = fs.existsSync(path.join(wt("held"), ".git"));
  check("a folder really held open is refused, naming it", caught instanceof tool.Refusal && caught.message.includes(wt("held")), String(caught?.message));
  check("and main's node_modules is intact, the branch waits, and a stripped folder holds no link", countFiles(modules) === modulesCount && hasBranch("topic/held") && (heldWhole ? heldLinks === 1 : heldLinks === 0), `${countFiles(modules)} files, ${heldLinks} link(s), whole ${heldWhole}`);
  const exited = new Promise((resolve) => holder.once("exit", resolve));
  holder.kill();
  await exited;
  r = cli(["close", "held"]);
  check("once the holder is gone, close finishes the folder and the branch", r.status === 0 && !fs.existsSync(wt("held")) && !hasBranch("topic/held") && countFiles(modules) === modulesCount, brief(r));
}

// --- park
r = cli(["park", "idea"]);
check("park creates parked/<slug> at main, with no worktree", r.status === 0 && hasBranch("parked/idea") && sh(main, "rev-parse", "parked/idea") === head() && /--push/.test(r.out), brief(r));
check("park without --push pushes nothing", spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/parked/idea"], { cwd: remote, env: ENV }).status !== 0);
r = cli(["park", "idea"]);
check("park refuses an existing branch", r.status === 1 && /already exists/.test(r.err), brief(r));
r = cli(["park", "badrev", "--at", "no-such-rev"]);
check("park refuses a revision that does not exist and makes no branch", r.status === 1 && !hasBranch("parked/badrev"), brief(r));
r = cli(["park", "idea", "--push"]);
check("park --push reaches the bare remote", r.status === 0 && sh(remote, "rev-parse", "refs/heads/parked/idea") === head(), brief(r));
r = cli(["park", "idea", "--push"]);
check("park --push refuses a branch already on origin", r.status === 1 && /already on origin/.test(r.err), brief(r));
r = cli(["park", "never", "--push"]);
check("park --push refuses a branch that was not parked", r.status === 1, brief(r));

// --- a release's live window: a module whose main's module.json names a version with or without its tag.
// Each fixture is a repository of its own, so the cases above are not disturbed.
const makeModule = (name, { tagged }) => {
  const base = path.join(scratch, name);
  const bare = path.join(base, "remote.git");
  const root = path.join(base, "family", "module");
  fs.mkdirSync(path.dirname(root), { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { env: ENV });
  execFileSync("git", ["clone", "-q", bare, root], { stdio: "ignore", env: ENV });
  const g = (...args) => sh(root, ...args);
  g("checkout", "-q", "-B", "main");
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@example.invalid"], ["core.autocrlf", "false"]]) g("config", k, v);
  for (const skill of ["acks-commit", "acks-branch"]) fs.cpSync(path.join(TEMPLATE_ROOT, ".claude/skills", skill), path.join(root, ".claude/skills", skill), { recursive: true });
  fs.mkdirSync(path.join(root, "tools"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.copyFileSync(path.join(TEMPLATE_ROOT, "tools/walk-results.mjs"), path.join(root, "tools/walk-results.mjs"));
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  fs.writeFileSync(path.join(root, "module.json"), '{"id":"x","version":"2026.1.1"}\n');
  for (const f of ["scripts/a.mjs", "docs/x.md", "CHANGELOG.md"]) fs.writeFileSync(path.join(root, f), "base\n");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  if (tagged) g("tag", "v2026.1.1");
  g("push", "-q", "-u", "origin", "main");
  const gdir = path.join(root, ".git");
  const mod = {
    root,
    g,
    head: () => g("rev-parse", "HEAD"),
    wt: (slug) => `${root}.${slug}`,
    cli: (args) => cli(args, { cwd: root }),
    gdir,
    leaseFree: async () => {
      if (fs.existsSync(path.join(gdir, "acks-lease", "landing.json"))) return false;
      const lease = await acquire(gdir, { session: "probe" }, { waitMs: 0 });
      lease?.stop();
      return Boolean(lease);
    },
    /** A topic with one commit writing `file`. */
    topic: (slug, file, text = "topic\n") => {
      mod.cli(["open", slug]);
      return commitIn(mod.wt(slug), file, text);
    },
    bump: (version) => commitIn(root, "module.json", `{"id":"x","version":"${version}"}\n`, `release ${version}`),
    /** The window as the tool reads it; "missing" for a tool that has no `releaseWindow`. */
    window: () => (tool.releaseWindow ? tool.releaseWindow(root) : "missing"),
  };
  return mod;
};
const showWindow = (w) => JSON.stringify(w);

const rel = makeModule("rel", { tagged: true });
check("releaseWindow is null where main has no module.json (the template's own shape)", showWindow(tool.releaseWindow?.(main)) === "null", showWindow(tool.releaseWindow?.(main)));
check("releaseWindow is null for a tagged version", showWindow(rel.window()) === "null", showWindow(rel.window()));
rel.topic("rt1", "scripts/a.mjs", "runtime 1\n");
r = rel.cli(["land", "rt1", "--change", green]);
check("window closed (version tagged): a runtime topic lands", r.status === 0 && rel.head() === rel.g("rev-parse", "topic/rt1"), brief(r));

const bump = rel.bump("2026.1.2");
check("releaseWindow is open for a version with no tag in a repository that has tagged", showWindow(rel.window()) === '{"version":"2026.1.2"}', showWindow(rel.window()));
rel.topic("rt2", "scripts/a.mjs", "runtime 2\n");
r = rel.cli(["land", "rt2", "--change", green]);
check("window open: a runtime topic is refused with exit 6, naming the version, the path and the owner's flag", r.status === 6 && /2026\.1\.2/.test(r.err) && /scripts\/a\.mjs/.test(r.err) && /--despite-release 2026\.1\.2/.test(r.err) && /live window/.test(r.err), brief(r));
check("that refusal leaves main where the release commit put it", rel.head() === bump);
check("that refusal leaves the lease free", await rel.leaseFree());

rel.topic("dc", "docs/x.md", "docs only\n");
r = rel.cli(["land", "dc", "--change", green]);
check("window open: a topic touching only docs/ lands, and says why", r.status === 0 && rel.head() === rel.g("rev-parse", "topic/dc") && /changes nothing the zip ships, so it lands/.test(r.out) && /release 2026\.1\.2's live window/.test(r.out), brief(r));
rel.topic("cl", "CHANGELOG.md", "changelog only\n");
r = rel.cli(["land", "cl", "--change", green]);
check("window open: a topic touching only CHANGELOG.md lands", r.status === 0 && rel.head() === rel.g("rev-parse", "topic/cl"), brief(r));

let before2 = rel.head();
r = rel.cli(["land", "rt2", "--despite-release", "2026.1.1", "--change", green]);
check("--despite-release naming another version: exit 1 naming the window's version, main unmoved", r.status === 1 && /2026\.1\.2/.test(r.err) && rel.head() === before2, brief(r));
check("that refusal leaves the lease free", await rel.leaseFree());
r = rel.cli(["land", "rt2", "--despite-release", "2026.1.2", "--change", green]);
check("--despite-release naming the window's version lands the runtime topic, saying it passed on the owner's word", r.status === 0 && rel.head() === rel.g("rev-parse", "topic/rt2") && /owner's word/.test(r.out), brief(r));

rel.g("tag", "v2026.1.2");
check("releaseWindow closes once the tag exists", showWindow(rel.window()) === "null", showWindow(rel.window()));
rel.topic("rt3", "scripts/b.mjs", "runtime 3\n");
before2 = rel.head();
r = rel.cli(["land", "rt3", "--despite-release", "2026.1.2", "--change", green]);
check("--despite-release while no window is open: exit 1 saying main is in no release's window, main unmoved", r.status === 1 && /no release's live window/.test(r.err) && rel.head() === before2, brief(r));
r = rel.cli(["land", "rt3", "--change", green]);
check("window closed by the tag: a runtime topic lands", r.status === 0 && rel.head() === rel.g("rev-parse", "topic/rt3"), brief(r));

// a release commit that lands while land waits for the lease
rel.topic("rt4", "scripts/c.mjs", "runtime 4\n");
{
  const holder = await acquire(rel.gdir, { session: "someone-else", change: "other" }, { waitMs: 0 });
  const said = [];
  let waiting;
  const told = new Promise((resolve) => (waiting = resolve));
  const landing = settle(tool.land("rt4", { cwd: rel.root, change: green, waitMinutes: 1, say: (m) => { said.push(m); if (/landing lease is held by/.test(m)) waiting(); } }));
  await Promise.race([told, landing, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  let bumped;
  try {
    bumped = rel.bump("2026.1.3");
  } finally {
    holder.stop();
  }
  const out = await landing;
  check("a release commit lands while land waits: refused under the lease with code 6, main at the release commit", out.error?.code === 6 && /2026\.1\.3/.test(out.error.message) && rel.head() === bumped, JSON.stringify({ value: out.value, error: out.error?.message, said }));
  check("that refusal releases the lease", await rel.leaseFree());
}

const untagged = makeModule("untagged", { tagged: false });
check("releaseWindow is null for a module never tagged", showWindow(untagged.window()) === "null", showWindow(untagged.window()));
untagged.topic("rt5", "scripts/a.mjs", "runtime 5\n");
r = untagged.cli(["land", "rt5", "--change", green]);
check("a module never tagged: a runtime topic lands", r.status === 0 && untagged.head() === untagged.g("rev-parse", "topic/rt5"), brief(r));

// --- teardown: unlink before anything deletes a tree that holds a link
for (const name of fs.readdirSync(path.dirname(main))) {
  const dir = path.join(path.dirname(main), name);
  if (name.startsWith("module.")) tool.unlinkTopLevel(dir);
}
tool.unlinkTopLevel(lk);
fs.rmSync(scratch, { recursive: true, force: true });

const failures = results.filter((ok) => !ok).length;
console.log(`test-branch: ${results.length} cases, ${failures} failed`);
process.exit(failures ? 1 : 0);
