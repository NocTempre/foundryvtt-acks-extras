/**
 * Drives the landing lease and the commit tool that holds it, and checks what
 * the lease exists to guarantee: one run gates and commits at a time, a run
 * that waited gates on the commit the run before it landed, a lease is taken
 * only from a holder that is gone or has stopped, and a holder that lost its
 * lease writes nothing shared.
 *
 * Usage:  node tools/toolchain-tests/test-landing-lease.mjs [--dir <directory>]
 *         (`--dir` holds commit-own-hunks.mjs, lease.mjs and ledger.mjs, and
 *         defaults to .claude/skills/acks-commit; pass a directory of modified
 *         copies to confirm a case fails when the behaviour it guards is
 *         broken)
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const DIR = path.resolve(option("--dir", path.join(TEMPLATE_ROOT, ".claude", "skills", "acks-commit")));
const KIT = path.join(DIR, "commit-own-hunks.mjs");
const LEASE = url.pathToFileURL(path.join(DIR, "lease.mjs")).href;
const { acquire, readLease, holds, beat, release, clear, BEAT_MS, SILENT_MS } = await import(LEASE);

const A = "aaaaaaaa-1111";
const B = "bbbbbbbb-2222";
const slash = (p) => p.split(path.sep).join("/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The fixture's gate. `hold` says it started and waits to be let go, which is
 * a gate long enough for a second run to arrive under it. `steal` writes
 * another run's lease over the holder's, which is what a takeover leaves.
 */
const GATE = `import fs from "node:fs";
const [what, a, b] = process.argv.slice(2);
if (what === "hold") {
  fs.writeFileSync(a, "started\\n");
  for (let n = 0; n < 1200 && !fs.existsSync(b); n++) await new Promise((r) => setTimeout(r, 25));
}
if (what === "steal") fs.writeFileSync(a, JSON.stringify({ token: "another-run", pid: Number(b), session: "cccccccc-3333", change: null, since: Date.now() }) + "\\n");
if (what === "red") process.exit(1);
console.log("ok - gate " + what);
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-lease-"));
const results = [];

/** A process id no process has: one that ran and ended. */
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/** A bare git directory to lease in, for the cases that need no repository. */
function gitDirOf(name) {
  const dir = path.join(tmp, name, ".git");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const leaseFile = (gitDir) => path.join(gitDir, "acks-lease", "landing.json");
/** Write a lease as some run left it, with its heartbeat `agoMs` in the past. */
function plant(gitDir, fields, agoMs = 0) {
  fs.mkdirSync(path.dirname(leaseFile(gitDir)), { recursive: true });
  fs.writeFileSync(leaseFile(gitDir), typeof fields === "string" ? fields : `${JSON.stringify({ token: "planted", session: B, change: null, since: Date.now(), ...fields })}\n`);
  const when = new Date(Date.now() - agoMs);
  fs.utimesSync(leaseFile(gitDir), when, when);
}

/**
 * A committed repository and the two things a case does with it: describe a
 * change in a directory of its own, and run the tool on one, to its end or
 * alongside another run.
 */
function fixture(name) {
  const root = path.join(tmp, name);
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);
  write(".gitattributes", "* text=auto eol=lf\n");
  write("gate.mjs", GATE);
  write("a.txt", "a\n");
  write("b.txt", "b\n");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const gitDir = path.join(repo, ".git");
  /** A change that rewrites `file` whole, gated by `gate`. */
  const change = (label, file, gate = "node gate.mjs ok") => {
    const dir = path.join(root, label);
    fs.mkdirSync(dir, { recursive: true });
    write(file, `${label}\n`);
    fs.writeFileSync(path.join(dir, "commit-msg.txt"), `${label}\n`);
    fs.writeFileSync(path.join(dir, "change.json"), JSON.stringify({ files: { [file]: { whole: true } }, gate: [gate], link: [] }));
    return dir;
  };
  const envOf = (session) => {
    const env = { ...process.env, CLAUDE_CODE_SESSION_ID: session };
    return env;
  };
  const kit = (session, dir, ...args) => {
    const r = spawnSync(process.execPath, [KIT, ...args, "--change", dir], { cwd: repo, encoding: "utf8", env: envOf(session) });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** The tool running beside the test, with its output so far. */
  const start = (session, dir, ...args) => {
    const child = spawn(process.execPath, [KIT, ...args, "--change", dir], { cwd: repo, env: envOf(session) });
    let out = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (d) => (out += d));
    const done = new Promise((resolve) => child.on("close", (status) => resolve({ status, out })));
    return { child, done, out: () => out };
  };
  const head = () => git("rev-parse", "HEAD").trim();
  const subject = (ref = "HEAD") => git("log", "-1", "--format=%s", ref).trim();
  const staged = () => git("diff", "--cached", "--name-only").trim();
  return { root, repo, gitDir, git, change, kit, start, head, subject, staged };
}

async function until(what, ok, ms = 30_000) {
  const started = Date.now();
  while (!ok()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

async function test(name, body) {
  const problems = [];
  const check = (what, ok, detail = "") => {
    if (!ok) problems.push(`${what}${detail ? `\n      ${String(detail).trim().split("\n").join("\n      ")}` : ""}`);
  };
  try {
    await body(check);
  } catch (e) {
    problems.push(`threw: ${e.stack ?? e}`);
  }
  results.push(problems.length === 0);
  console.log(problems.length ? `FAIL ${name}\n  ${problems.join("\n  ")}` : `ok   ${name}`);
}

/**
 * A clock a test moves, and a pause that moves it and counts the looks. A wait
 * that never ends throws here, where a real one would hang the suite.
 */
function fakeTime(startMs, each = () => {}) {
  const time = { now: startMs, looks: 0 };
  const pause = async (ms) => {
    if (++time.looks > 5000) throw new Error("the wait did not end");
    each(time.looks);
    time.now += ms;
  };
  return { time, clock: () => time.now, pause };
}

/**
 * Run `body` with `stand` in place of one of `fs`'s functions, which the lease
 * calls through the same object. `stand` is handed the real one ahead of the
 * call's own arguments. It is how a case makes the filesystem answer at a
 * chosen moment as it otherwise does only under load.
 */
async function withFs(name, stand, body) {
  const real = fs[name];
  fs[name] = (...args) => stand(real, ...args);
  try {
    return await body();
  } finally {
    fs[name] = real;
  }
}

try {
  // --- the lease alone ---

  await test("a free lease is taken, names its holder, and is gone once given up", async (check) => {
    const gitDir = gitDirOf("free");
    const lease = await acquire(gitDir, { session: A, change: "the/change" });
    const stands = readLease(gitDir);
    check("the lease names this process, its session and its change", stands?.pid === process.pid && stands.session === A && stands.change === "the/change" && stands.token === lease.token, JSON.stringify(stands));
    check("the holder holds it, and no other token does", holds(gitDir, lease.token) && !holds(gitDir, "another-run"));
    lease.stop();
    check("giving it up removes it", readLease(gitDir) === null);
  });

  await test("a held lease is not taken, and the one who asked is told who holds it", async (check) => {
    const gitDir = gitDirOf("held");
    const first = await acquire(gitDir, { session: A });
    const told = [];
    const second = await acquire(gitDir, { session: B }, { waitMs: 0, onWait: (held) => told.push(held) });
    check("the second asker gets nothing", second === null);
    check("and is told the holder once", told.length === 1 && told[0].session === A && told[0].pid === process.pid, JSON.stringify(told));
    check("the first still holds it", holds(gitDir, first.token));
    first.stop();
  });

  await test("a waiter takes the lease once its holder gives it up", async (check) => {
    const gitDir = gitDirOf("waited");
    const first = await acquire(gitDir, { session: A });
    setTimeout(() => first.stop(), 150);
    const second = await acquire(gitDir, { session: B }, { waitMs: 10_000, pollMs: 20 });
    check("the waiter holds it", second !== null && holds(gitDir, second.token));
    check("and waited for it", second?.waitedMs >= 100, second?.waitedMs);
    second?.stop();
  });

  await test("a lease whose holder's process is gone is taken at once", async (check) => {
    const gitDir = gitDirOf("dead");
    plant(gitDir, { pid: deadPid() });
    const told = [];
    const lease = await acquire(gitDir, { session: A }, { waitMs: 0, onWait: (held) => told.push(held) });
    check("the asker holds it", lease !== null && readLease(gitDir)?.token === lease.token);
    check("and was never told to wait", told.length === 0);
    lease?.stop();
  });

  await test("a live holder whose heartbeat stands still is taken from only at a second look", async (check) => {
    const gitDir = gitDirOf("silent");
    plant(gitDir, { pid: process.pid }, SILENT_MS + 5_000);
    const { time, clock, pause } = fakeTime(Date.now());
    const once = await acquire(gitDir, { session: A }, { waitMs: 0, clock, pause });
    check("one look does not take it", once === null && readLease(gitDir)?.token === "planted");
    const lease = await acquire(gitDir, { session: A }, { waitMs: 10 * BEAT_MS, pollMs: 1000, clock, pause });
    check("it is taken", lease !== null && readLease(gitDir)?.token === lease?.token);
    check("no sooner than two heartbeats after it was first seen standing", lease?.waitedMs >= 2 * BEAT_MS && time.looks >= 2, `${lease?.waitedMs}ms, ${time.looks} look(s)`);
    lease?.stop();
  });

  await test("a holder that is late and still beating keeps its lease", async (check) => {
    const gitDir = gitDirOf("late");
    plant(gitDir, { pid: process.pid }, SILENT_MS + 600_000);
    // Each look finds the heartbeat a second younger: old by the clock, and moving.
    const touch = (look) => {
      const when = new Date(Date.now() - SILENT_MS - 600_000 + look * 1000);
      fs.utimesSync(leaseFile(gitDir), when, when);
    };
    const { clock, pause } = fakeTime(Date.now(), touch);
    const lease = await acquire(gitDir, { session: A }, { waitMs: 10 * BEAT_MS, pollMs: 1000, clock, pause });
    check("the asker gets nothing", lease === null);
    check("and the holder's lease stands", readLease(gitDir)?.token === "planted");
    lease?.stop();
  });

  await test("a lease cut short as it was written is held, and taken once it has stood still", async (check) => {
    const gitDir = gitDirOf("cut");
    plant(gitDir, "{\"token\": \"cu");
    const told = [];
    const fresh = await acquire(gitDir, { session: A }, { waitMs: 0, onWait: (held) => told.push(held) });
    check("fresh, it is held, and the asker is told so", fresh === null && told.length === 1, JSON.stringify(told));
    plant(gitDir, "{\"token\": \"cu", SILENT_MS + 5_000);
    const { clock, pause } = fakeTime(Date.now());
    const lease = await acquire(gitDir, { session: A }, { waitMs: 10 * BEAT_MS, pollMs: 1000, clock, pause });
    check("standing still, it is taken", lease !== null && holds(gitDir, lease.token));
    lease?.stop();
  });

  await test("a lease that is there and cannot be read is waited for, and the wait ends", async (check) => {
    const gitDir = gitDirOf("unreadable");
    fs.mkdirSync(leaseFile(gitDir), { recursive: true });
    const told = [];
    const { time, clock, pause } = fakeTime(Date.now());
    const once = await acquire(gitDir, { session: A }, { waitMs: 0, onWait: (held) => told.push(held), clock, pause });
    check("an asker that does not wait gets nothing, after a few looks", once === null && time.looks > 1 && time.looks < 100, time.looks);
    const waited = await acquire(gitDir, { session: A }, { waitMs: 30_000, pollMs: 1000, clock, pause });
    check("an asker that waits gets nothing when its wait runs out", waited === null && time.looks < 200, time.looks);
    check("and neither is told of a holder there is nothing to say about", told.length === 0);
  });

  await test("a create the system refuses for a moment is asked again, and one it goes on refusing is thrown", async (check) => {
    const gitDir = gitDirOf("refused");
    // What Windows was seen to answer, under load, for a create over a lease given up a moment before.
    const refusing = (times) => {
      let left = times;
      return (real, file, ...rest) => {
        if (file === leaseFile(gitDir) && left-- > 0) throw Object.assign(new Error("EPERM: operation not permitted, open"), { code: "EPERM" });
        return real(file, ...rest);
      };
    };
    const { time, clock, pause } = fakeTime(Date.now());
    const lease = await withFs("writeFileSync", refusing(3), () => acquire(gitDir, { session: A }, { clock, pause }));
    check("refused three times and then let through, the lease is taken", lease !== null && holds(gitDir, lease.token) && time.looks === 3, `${time.looks} look(s)`);
    lease?.stop();
    const thrown = await withFs("writeFileSync", refusing(Infinity), () => acquire(gitDir, { session: A }, { waitMs: 60_000, clock, pause }).then(() => null, (e) => e));
    check("refused at every look, the refusal is thrown and the wait is not sat out", thrown?.code === "EPERM" && time.looks < 100, `${thrown?.code ?? thrown}, ${time.looks} look(s)`);
  });

  await test("giving up or touching a lease that is another run's leaves it alone", async (check) => {
    const gitDir = gitDirOf("foreign");
    plant(gitDir, { pid: process.pid }, 60_000);
    const before = readLease(gitDir).beat;
    beat(gitDir, "mine");
    check("a touch with another token moves no heartbeat", readLease(gitDir).beat === before);
    release(gitDir, "mine");
    check("a release with another token removes nothing", readLease(gitDir)?.token === "planted");
    beat(gitDir, "planted");
    check("the holder's own touch moves it", readLease(gitDir).beat > before);
    release(gitDir, "planted");
    check("and its own release removes it", readLease(gitDir) === null);
  });

  await test("a holder's lease is touched as it works, until it is given up", async (check) => {
    const gitDir = gitDirOf("beating");
    const lease = await acquire(gitDir, { session: A }, { beatMs: 20 });
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(leaseFile(gitDir), old, old);
    await until("the heartbeat to move", () => readLease(gitDir).beat > old.getTime(), 5_000);
    lease.stop();
    plant(gitDir, { pid: process.pid }, 60_000);
    const stood = readLease(gitDir).beat;
    await sleep(120);
    check("once given up, the next holder's lease is not touched", readLease(gitDir).beat === stood);
  });

  await test("a lease is removed only as it was judged, and by one remover at a time", async (check) => {
    const gitDir = gitDirOf("clear");
    const guard = path.join(gitDir, "acks-lease", "takeover");
    plant(gitDir, { pid: deadPid(), token: "gone" });
    const judged = readLease(gitDir);
    plant(gitDir, { pid: process.pid, token: "younger" });
    check("a lease created since is left", clear(gitDir, judged) === false && readLease(gitDir)?.token === "younger");
    plant(gitDir, { pid: deadPid(), token: "gone" }, 30_000);
    const before = readLease(gitDir);
    beat(gitDir, "gone");
    check("a lease touched since is left", clear(gitDir, before) === false && readLease(gitDir)?.token === "gone");
    const now = readLease(gitDir);
    fs.mkdirSync(guard);
    check("a remover that finds another at work removes nothing", clear(gitDir, now) === false && readLease(gitDir)?.token === "gone" && fs.existsSync(guard));
    const stale = new Date(Date.now() - 120_000);
    fs.utimesSync(guard, stale, stale);
    check("a remover that died at work is cleared away, and nothing else is", clear(gitDir, now) === false && !fs.existsSync(guard) && readLease(gitDir)?.token === "gone");
    check("the lease as judged is removed", clear(gitDir, now) === true && readLease(gitDir) === null && !fs.existsSync(guard));
  });

  await test("a remover whose look finds no lease removes none, one made the moment after included", async (check) => {
    const gitDir = gitDirOf("late-remover");
    plant(gitDir, { pid: deadPid(), token: "gone" });
    const judged = readLease(gitDir);
    // Its holder gave it up after it was judged, and the next run's lease lands between this remover's look and its removal.
    fs.rmSync(leaseFile(gitDir));
    let landed = false;
    const lookThenLand = (real, file, ...rest) => {
      try {
        return real(file, ...rest);
      } catch (e) {
        if (file === leaseFile(gitDir) && !landed) {
          landed = true;
          plant(gitDir, { pid: process.pid, token: "live" });
        }
        throw e;
      }
    };
    const answer = await withFs("statSync", lookThenLand, () => clear(gitDir, judged));
    check("it answers that the lease it judged is gone", answer === true && landed);
    check("and the lease that landed after its look stands", readLease(gitDir)?.token === "live", JSON.stringify(readLease(gitDir)));
  });

  await test("six runs asking at once, over a dead holder's lease, hold it one at a time", async (check) => {
    const gitDir = gitDirOf("crowd");
    plant(gitDir, { pid: deadPid() });
    const log = path.join(tmp, "crowd", "log.txt");
    const script = path.join(tmp, "crowd", "hold.mjs");
    fs.writeFileSync(script, `import fs from "node:fs";
const { acquire } = await import(process.argv[2]);
const lease = await acquire(process.argv[3], { session: String(process.pid) }, { waitMs: 60_000, pollMs: 15 });
if (!lease) {
  console.error("the wait ran out with the lease still held");
  process.exit(1);
}
fs.appendFileSync(process.argv[4], "in " + process.pid + "\\n");
await new Promise((r) => setTimeout(r, 40));
fs.appendFileSync(process.argv[4], "out " + process.pid + "\\n");
lease.stop();
`);
    // Each run's exit status, and for one that failed what it wrote as it did.
    const run = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [script, LEASE, gitDir, log]);
        let said = "";
        child.stderr.on("data", (chunk) => (said += chunk));
        child.on("close", (code) => resolve(code === 0 ? "0" : `${code}: ${said.trim() || "nothing on stderr"}`));
      });
    const exits = await Promise.all(Array.from({ length: 6 }, run));
    check("every run got its turn", exits.every((exit) => exit === "0"), exits.join("\n"));
    const turns = fs.readFileSync(log, "utf8").trim().split("\n");
    const paired = turns.length === 12 && turns.every((line, n) => (n % 2 ? line === turns[n - 1].replace("in", "out") : line.startsWith("in ")));
    check("no run entered while another was inside", paired, turns.join(" | "));
    check("the last one out left no lease", readLease(gitDir) === null);
  });

  // --- the commit tool holding it ---

  await test("a run that arrives under another's gate waits, then gates on the commit that run landed", async (check) => {
    const f = fixture("two-ships");
    const started = slash(path.join(f.root, "a.started"));
    const go = slash(path.join(f.root, "a.go"));
    const first = f.change("change-a", "a.txt", `node gate.mjs hold "${started}" "${go}"`);
    const second = f.change("change-b", "b.txt");
    check("both changes record", f.kit(A, first, "record").status === 0 && f.kit(B, second, "record").status === 0);
    const base = f.head();
    const a = f.start(A, first, "ship");
    await until("the first gate to start", () => fs.existsSync(started));
    check("the first run holds the lease while it gates", readLease(f.gitDir)?.session === A, JSON.stringify(readLease(f.gitDir)));
    const b = f.start(B, second, "ship");
    await until("the second run to find the lease held", () => /the landing lease is held by/.test(b.out()));
    check("the second run names the holder and has gated nothing", /held by session aaaaaaaa/.test(b.out()) && !/attempt 1/.test(b.out()), b.out());
    fs.writeFileSync(go, "go\n");
    const [ra, rb] = await Promise.all([a.done, b.done]);
    check("both land", ra.status === 0 && rb.status === 0, `${ra.out}\n${rb.out}`);
    check("the first on the base, the second on the first", f.subject("HEAD~1") === "change-a" && f.subject() === "change-b" && f.git("rev-parse", "HEAD~2").trim() === base, f.git("log", "--format=%s"));
    check("the second run's one attempt started on the first run's commit", rb.out.includes(`--- attempt 1 of 4 on ${f.git("rev-parse", "HEAD~1").trim()}`) && !/the base moved/.test(rb.out) && !/attempt 2/.test(rb.out), rb.out);
    check("it says how long it waited", /took the landing lease after \d+s/.test(rb.out), rb.out);
    check("and named the holder once", rb.out.split("the landing lease is held by").length === 2, rb.out);
    check("no lease is left", readLease(f.gitDir) === null);
  });

  await test("a run told not to wait stops at a held lease with a status of its own", async (check) => {
    const f = fixture("no-wait");
    const dir = f.change("change-a", "a.txt");
    check("the change records while the lease is held", (await acquire(f.gitDir, { session: B, change: "elsewhere" })) !== null && f.kit(A, dir, "record").status === 0);
    const base = f.head();
    for (const mode of ["ship", "gate", "commit"]) {
      const r = f.kit(A, dir, mode, "--wait", "0");
      check(`${mode} exits 5 and names the holder`, r.status === 5 && /REFUSED: the landing lease is still held by session bbbbbbbb, since \d\d:\d\d:\d\d, for elsewhere/.test(r.out), `${r.status}\n${r.out}`);
    }
    check("nothing is committed and nothing staged", f.head() === base && f.staged() === "");
    check("the holder's lease stands", readLease(f.gitDir)?.session === B);
    release(f.gitDir, readLease(f.gitDir).token);
    const r = f.kit(A, dir, "ship", "--wait", "0");
    check("with the lease free the same run lands", r.status === 0 && f.subject() === "change-a", r.out);
  });

  await test("a run whose lease was taken under its gate commits nothing", async (check) => {
    const f = fixture("taken");
    const dir = f.change("change-a", "a.txt", `node gate.mjs steal "${slash(leaseFile(f.gitDir))}" ${process.pid}`);
    check("the change records", f.kit(A, dir, "record").status === 0);
    const base = f.head();
    const r = f.kit(A, dir, "ship");
    check("ship exits 1 and says whose the lease is", r.status === 1 && /GREEN: recorded/.test(r.out) && /REFUSED: the landing lease is no longer this run's; nothing staged/.test(r.out), `${r.status}\n${r.out}`);
    check("nothing is committed and nothing staged", f.head() === base && f.staged() === "");
    check("the lease that took its place still stands", readLease(f.gitDir)?.token === "another-run");
  });

  await test("a red gate gives the lease up, and so does each mode run alone", async (check) => {
    const f = fixture("given-up");
    const red = f.change("change-a", "a.txt", "node gate.mjs red");
    check("the change records", f.kit(A, red, "record").status === 0);
    const r = f.kit(A, red, "ship");
    check("a red ship exits 1", r.status === 1 && /the gate is not green/.test(r.out), r.out);
    check("and leaves no lease", readLease(f.gitDir) === null);
    const green = f.change("change-b", "b.txt");
    check("record, then gate alone", f.kit(B, green, "record").status === 0 && f.kit(B, green, "gate").status === 0);
    check("gate alone leaves no lease", readLease(f.gitDir) === null);
    const landed = f.kit(B, green, "commit");
    check("commit alone lands and leaves no lease", landed.status === 0 && f.subject() === "change-b" && readLease(f.gitDir) === null, landed.out);
  });

  await test("a run killed under its gate leaves a lease the next run takes at once", async (check) => {
    const f = fixture("killed");
    const started = slash(path.join(f.root, "a.started"));
    const go = slash(path.join(f.root, "a.go"));
    const first = f.change("change-a", "a.txt", `node gate.mjs hold "${started}" "${go}"`);
    const second = f.change("change-b", "b.txt");
    check("both changes record", f.kit(A, first, "record").status === 0 && f.kit(B, second, "record").status === 0);
    const a = f.start(A, first, "ship");
    await until("the first gate to start", () => fs.existsSync(started));
    a.child.kill("SIGKILL");
    await a.done;
    fs.writeFileSync(go, "go\n");
    check("the killed run's lease is still there", readLease(f.gitDir)?.session === A);
    const r = f.kit(B, second, "ship", "--wait", "0");
    check("the next run lands without waiting", r.status === 0 && f.subject() === "change-b" && !/the landing lease is held/.test(r.out), `${r.status}\n${r.out}`);
    check("no lease is left", readLease(f.gitDir) === null);
  });
} finally {
  // A killed run's gate may still hold its clone for a moment.
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
console.log(`\ntest-landing-lease: ${results.length} cases against ${path.relative(TEMPLATE_ROOT, DIR) || DIR}, ${failed} failed`);
process.exit(failed ? 1 : 0);
