/**
 * Checks that the live walk runner, `tools/live/run.mjs`, holds the landing
 * lease around each walk: taken for one walk and given up after it, on a pass,
 * a failure, a throw in the walk and a refused start; held while the walk
 * runs, named for the walk and the runner's process; one lease for each walk of
 * a batch; waited for where a landing or a commit holds it, then refused with
 * exit 5 and nothing run or recorded; and not taken by `--list` or
 * `--classify`.
 *
 * Every case runs the runner copied into a throwaway git repository under the
 * OS temp directory, beside invented walks, with the seat ports moved off the
 * real ones. A signal is not tested: Windows delivers none to a child that has
 * a handler.
 *
 * Usage:  node tools/toolchain-tests/test-live-run-lease.mjs [--run <run.mjs>]
 *         (`--run` defaults to tools/live/run.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const RUN = path.resolve(option("--run", path.join(ROOT, "tools", "live", "run.mjs")));
const LEASE_FILE = path.join(ROOT, ".claude", "skills", "acks-commit", "lease.mjs");
const { acquire, readLease } = await import(url.pathToFileURL(LEASE_FILE).href);

// A caller's own repository variables would turn every git call toward the caller's repository.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (cwd, args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, ok, detail) => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      ${String(detail).split("\n").join("\n      ")}` : ""}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-live-run-lease-"));
const PORT_GM = 9591;
const PORT_PLAYER = 9592;

/**
 * Invented walks. Each prints the lease file's contents to the file its
 * environment names, so a case reads what was held while the walk ran.
 * `slow` also lets a second walk of a batch be told apart by its token.
 */
const SEEN = `import fs from "node:fs";
const seen = (tag) => {
  const where = process.env.LEASE_FILE;
  const out = process.env.SEEN_DIR;
  if (!where || !out) return;
  let text = "missing";
  try { text = fs.readFileSync(where, "utf8"); } catch {}
  fs.writeFileSync(out + "/" + tag + ".json", text);
};
`;
const WALKS = {
  "w-pass": `${SEEN}seen("w-pass");\nconsole.log("PASS the walk ran");\nconsole.log("WALK END");\n`,
  "w-pass2": `${SEEN}seen("w-pass2");\nconsole.log("PASS the second walk ran");\nconsole.log("WALK END");\n`,
  "w-fail": `${SEEN}seen("w-fail");\nconsole.log("PASS one");\nconsole.log("FAIL the other");\nconsole.log("WALK END");\nprocess.exit(1);\n`,
  "w-throw": `${SEEN}seen("w-throw");\nthrow new Error("the walk threw");\n`,
  "w-slow": `${SEEN}seen("w-slow");\nconsole.log("PASS slow start");\nawait new Promise((r) => setTimeout(r, 1500));\nconsole.log("WALK END");\n`,
};

/** A throwaway repository holding the runner, its helpers and the invented walks, committed. */
function replica(name, runFile = RUN) {
  const dir = path.join(tmp, name);
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const copy = (from, rel) => put(rel, fs.readFileSync(from));
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  copy(runFile, "tools/live/run.mjs");
  copy(path.join(ROOT, "tools", "live", "_env.mjs"), "tools/live/_env.mjs");
  copy(path.join(ROOT, "tools", "walk-results.mjs"), "tools/walk-results.mjs");
  copy(LEASE_FILE, ".claude/skills/acks-commit/lease.mjs");
  put("module.json", `${JSON.stringify({ id: "widget", title: "Widget", version: "1.0.0" })}\n`);
  put(".gitignore", "aia-tmp/\n");
  for (const [walk, source] of Object.entries(WALKS)) put(`tools/live/${walk}.mjs`, source);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "replica"]);
  fs.mkdirSync(path.join(dir, "seen"), { recursive: true });
  const gitDir = path.join(dir, ".git");
  return {
    dir,
    gitDir,
    leaseFile: path.join(gitDir, "acks-lease", "landing.json"),
    seen: path.join(dir, "seen"),
    results: path.join(dir, "aia-tmp", "live", "walk-results.json"),
  };
}

/** Start the runner in a replica. Resolves with its output and exit status, and carries its process id. */
function runner(rep, args, env = {}) {
  const child = spawn(process.execPath, [path.join(rep.dir, "tools", "live", "run.mjs"), ...args], {
    cwd: rep.dir,
    env: {
      ...process.env,
      CAPTURE_PORT_GM: String(PORT_GM),
      CAPTURE_PORT_PLAYER: String(PORT_PLAYER),
      ACKS_LIVE_LOGS: path.join(rep.dir, "logs"),
      LEASE_FILE: rep.leaseFile,
      SEEN_DIR: rep.seen,
      ACKS_WALK_LEASE_WAIT_MS: "0",
      ACKS_WALK_LEASE_BEAT_MS: "200",
      ACKS_WALK_LEASE_YIELD_MS: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  const done = new Promise((resolve) => child.on("close", (status) => resolve({ status, out })));
  return { pid: child.pid, done, output: () => out };
}

const seenJson = (rep, tag) => {
  try { return JSON.parse(fs.readFileSync(path.join(rep.seen, `${tag}.json`), "utf8")); } catch { return null; }
};
const resultsFile = (rep) => (fs.existsSync(rep.results) ? JSON.parse(fs.readFileSync(rep.results, "utf8")) : null);

try {
  // A walk runs holding the lease, named for the walk and the runner's process.
  {
    const rep = replica("held");
    const r = runner(rep, ["w-pass"]);
    const done = await r.done;
    const held = seenJson(rep, "w-pass");
    check("a walk runs and passes in the replica", done.status === 0 && /== w-pass: passed/.test(done.out), `${done.status}\n${done.out}`);
    check("the lease is held while the walk runs, for walk:<name>, by the runner's process", held?.change === "walk:w-pass" && held?.pid === r.pid, JSON.stringify(held));
    check("the lease is given up after a pass", readLease(rep.gitDir) === null);
  }

  // Given up after a failure and after a throw in the walk.
  {
    const rep = replica("ends");
    const failed = await runner(rep, ["w-fail"]).done;
    check("a failing walk exits 1", failed.status === 1 && /== w-fail: failed/.test(failed.out), `${failed.status}\n${failed.out}`);
    check("the lease is given up after a failure", readLease(rep.gitDir) === null);
    const threw = await runner(rep, ["w-throw"]).done;
    check("a walk that throws is an errored walk, exit 1", threw.status === 1 && /== w-throw: errored/.test(threw.out), `${threw.status}\n${threw.out}`);
    check("the lease is given up after a throw", readLease(rep.gitDir) === null);
  }

  // Given up when the runner stops at a refused start.
  {
    const rep = replica("busy");
    const server = http.createServer((_req, res) => { res.end("{}"); });
    await new Promise((resolve) => server.listen(PORT_GM, "127.0.0.1", resolve));
    try {
      const refused = await runner(rep, ["w-pass"]).done;
      check("a busy seat stops the run with exit 3", refused.status === 3 && /seats busy/.test(refused.out), `${refused.status}\n${refused.out}`);
      check("the lease is given up after a refused start", readLease(rep.gitDir) === null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // One lease for each walk of a batch, and the batch goes on past a walk that is not a pass.
  {
    const rep = replica("batch");
    const done = await runner(rep, ["w-pass", "w-fail", "w-pass2"]).done;
    const tokens = ["w-pass", "w-fail", "w-pass2"].map((t) => seenJson(rep, t)?.token);
    check("a batch runs every walk after one that is not a pass and exits 1", done.status === 1 && /== w-pass: passed/.test(done.out) && /== w-fail: failed/.test(done.out) && /== w-pass2: passed/.test(done.out), `${done.status}\n${done.out}`);
    check("each walk of a batch ran under a lease of its own", tokens.every(Boolean) && new Set(tokens).size === 3, JSON.stringify(tokens));
    check("each walk's lease names that walk", ["w-pass", "w-fail", "w-pass2"].every((t) => seenJson(rep, t)?.change === `walk:${t}`));
    check("no lease is left after a batch", readLease(rep.gitDir) === null);
  }

  // A lease a landing or a commit holds: waited for, the holder named, then refused with nothing run or recorded.
  {
    const rep = replica("waits");
    const peer = await acquire(rep.gitDir, { session: "peerpeer-1111", change: "land change" }, { waitMs: 0 });
    try {
      const refused = await runner(rep, ["w-pass"], { ACKS_WALK_LEASE_WAIT_MS: "1200" }).done;
      check("a held lease makes the runner wait, then refuse with exit 5", refused.status === 5, `${refused.status}\n${refused.out}`);
      check("the refusal names the holder and says the walk was not started", /held by session peerpee/.test(refused.out) && /w-pass not started/.test(refused.out), refused.out);
      check("a refused run ran nothing and recorded nothing", seenJson(rep, "w-pass") === null && resultsFile(rep) === null);
      check("the holder's lease is untouched by the refusal", readLease(rep.gitDir)?.token === peer.token);
      const noWait = await runner(rep, ["w-pass"], { ACKS_WALK_LEASE_WAIT_MS: "0" }).done;
      check("no wait at all still refuses and never skips the lease", noWait.status === 5 && seenJson(rep, "w-pass") === null, `${noWait.status}\n${noWait.out}`);
    } finally {
      peer.stop();
    }
  }
  {
    const rep = replica("waits-then-runs");
    const peer = await acquire(rep.gitDir, { session: "peerpeer-1111", change: "land change" }, { waitMs: 0 });
    const r = runner(rep, ["w-pass"], { ACKS_WALK_LEASE_WAIT_MS: "20000" });
    await sleep(1500);
    peer.stop();
    const done = await r.done;
    check("a runner that waited runs once the holder lets go", done.status === 0 && /== w-pass: passed/.test(done.out), `${done.status}\n${done.out}`);
    check("the wait is announced with its holder", /held by session peerpee/.test(done.out), done.out);
    check("the run that waited held the lease while it ran", seenJson(rep, "w-pass")?.change === "walk:w-pass");
    check("no lease is left after a run that waited", readLease(rep.gitDir) === null);
  }

  // A run waiting for the lease takes it between two walks of a batch; the batch stops at the second, keeping what ran.
  {
    const rep = replica("batch-refused");
    const r = runner(rep, ["w-slow", "w-pass"], { ACKS_WALK_LEASE_WAIT_MS: "1500", ACKS_WALK_LEASE_YIELD_MS: "800" });
    const until = Date.now() + 15000;
    while (Date.now() < until && seenJson(rep, "w-slow") === null) await sleep(25);
    const peer = await acquire(rep.gitDir, { session: "peerpeer-1111", change: "land change" }, { waitMs: 20000, pollMs: 20 });
    const done = await r.done;
    peer?.stop();
    check("a landing waiting on a walk takes the lease in the gap before the next walk", peer !== null && /held by session peerpee/.test(done.out), `${done.status}
${done.out}`);
    check("the batch stops at the walk that could not start, exit 5", done.status === 5 && /w-pass not started/.test(done.out) && seenJson(rep, "w-pass") === null, `${done.status}
${done.out}`);
    check("the walk that ran before it is still recorded as passed", resultsFile(rep)?.walks?.["w-slow"]?.state === "passed" && !resultsFile(rep)?.walks?.["w-pass"]);
  }

  // --list and --classify take no lease.
  {
    const rep = replica("untaken");
    const peer = await acquire(rep.gitDir, { session: "peerpeer-1111", change: "land change" }, { waitMs: 0 });
    try {
      const listed = await runner(rep, ["--list"], { ACKS_WALK_LEASE_WAIT_MS: "0" }).done;
      check("--list runs while the lease is held, taking none", listed.status === 0 && /w-pass/.test(listed.out) && !/landing lease/.test(listed.out), `${listed.status}\n${listed.out}`);
      const classified = await runner(rep, ["--classify", "w-pass", "T-0001", "defect"], { ACKS_WALK_LEASE_WAIT_MS: "0", ACKS_BUG_LEDGER: "" }).done;
      check("--classify answers on its own terms while the lease is held", classified.status === 2 && /ACKS_BUG_LEDGER/.test(classified.out) && !/landing lease/.test(classified.out), `${classified.status}\n${classified.out}`);
      check("the holder's lease is untouched by both", readLease(rep.gitDir)?.token === peer.token);
    } finally {
      peer.stop();
    }
    check("neither leaves a lease behind", readLease(rep.gitDir) === null);
  }
} finally {
  for (let n = 0; n < 20; n++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\ntest-live-run-lease: ${results.length} cases against ${path.relative(ROOT, RUN) || RUN}, ${failed} failed`);
process.exit(failed ? 1 : 0);
