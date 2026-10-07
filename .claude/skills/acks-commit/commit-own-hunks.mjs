/**
 * Commit one change's hunks from a working tree other sessions are writing
 * in, and nothing else. The tree that is gated is the tree that is committed:
 * it is built in a private index, checked out over a scratch clone, gated
 * there, and staged on the shared index only once its id is the gated one.
 *
 *   node commit-own-hunks.mjs <mode> --change <dir>
 *
 *   record            pick this change's zero-context hunks by pattern, printing every hunk of
 *                     every listed file as MINE or left; hash the whole, added files
 *   build             HEAD plus the recorded change in a private index; print the tree id
 *   gate              check that tree out over a scratch clone and run the gate there; record
 *                     the green tree and its base
 *   commit [--carry]  rebuild; refuse unless tree and HEAD are the gated ones; stage on the
 *                     shared index; check its tree; commit with commit-msg.txt. With --carry a
 *                     moved base is accepted when the commits that landed write none of this
 *                     change's files and no gate tooling, those files come out as gated, and
 *                     the carry stages pass on the rebuilt tree
 *   postgate <sha>    the full gate on a commit already made
 *   ship [--attempts N]  record, gate and commit, again only while the base moves under the gate;
 *                     needs a `record` already made, and holds whole and added files to it
 *   clean             remove the scratch clone and the private index
 *
 * Run from the repository root. `<dir>` lies outside the repository and holds
 * the change's inputs, `change.json` and `commit-msg.txt`, beside everything
 * this script writes: the hunk record, the private index, the clone, the gate
 * logs and the gated tree's id.
 *
 * change.json:
 *   files    { "<path>": { "own": "<regex>", "count": <n> } | { "whole": true, "own"?: "<regex>" } }
 *            `own` is tested against a hunk's removed and added lines joined by newlines.
 *            `whole` takes the working copy as it stood at `record`, and refuses any later edit.
 *   added    paths HEAD does not track, each taken whole as recorded
 *   removed  paths HEAD tracks and the working tree no longer holds
 *   gate     stages run in the clone, in order; a stage is one command line or a list of
 *            command lines run side by side. Default: `npm run build:packs`, then
 *            `npm run validate` beside `npm test`, each where package.json names the script
 *   carry    the stages a carried base runs on the rebuilt tree. Default: the gate without
 *            validate, or the whole gate where that leaves nothing
 *   expect   strings the gate's output must hold, for a check that exits 0 where it cannot run
 *   link     untracked directories joined into the clone by a link. Default: ["node_modules"]
 *   tooling  a regex over paths whose change makes a gate result stale for every file
 *   timeoutMinutes  per command line, default 30
 *
 * Exit status: 0 done, 1 refused, 2 usage, 3 the base moved (gate again), 4 the shared index
 * holds another session's staging (wait for its commit).
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXIT = { refused: 1, usage: 2, movedBase: 3, peerStaging: 4 };
const LOCK_TRIES = 8;
const LOCK_WAIT_MS = 1500;
/**
 * Paths that decide what a gate checks. A commit that writes one makes a gate
 * result stale for every file the gate read, whoever's they are, so a moved
 * base is never carried over it. The test runner is absent because the carry
 * runs it again.
 */
const GATE_TOOLING = /^(tools\/(validate[^/]*|ip-[^/]*|build-packs)\.mjs$|docs\/site\/tools\/|\.githooks\/|\.claude\/|\.gitattributes$|package(-lock)?\.json$)/;

const REPO = process.cwd();
const argv = process.argv.slice(2);
const mode = argv[0];
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const DIR = option("--change") ? path.resolve(option("--change")) : null;
const at = (name) => path.join(DIR, name);

/** A stop the caller can act on by its exit status; anything else thrown is a fault. */
class Refusal extends Error {
  constructor(message, code = EXIT.refused) {
    super(message);
    this.code = code;
  }
}
const refuse = (why, code) => {
  throw new Refusal(why, code);
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run git from the repository root. A command that cannot take the shared
 * index's lock changes nothing, so it is tried again while stderr names the
 * lock: another session's git held it for a moment.
 */
function git(args, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"], ...opts });
    } catch (e) {
      if (attempt >= LOCK_TRIES || !/index\.lock/.test(String(e.stderr))) throw e;
      sleep(LOCK_WAIT_MS);
    }
  }
}
const lines = (text) => text.split("\n").filter(Boolean);
const revParse = (ref) => git(["rev-parse", ref]).trim();
const staged = () => lines(git(["diff", "--cached", "--name-only"]));
const headEntry = (file) => git(["ls-tree", "HEAD", "--", file]).trim();
/** The blob id `git add` would write for the working file, with nothing written. */
const hashOf = (file) => git(["hash-object", "--", file]).trim();
const inTree = (file) => fs.existsSync(path.join(REPO, file));

/** Parse change.json into the paths, patterns and stages the modes share. */
function readChange() {
  if (!fs.existsSync(at("change.json"))) refuse(`no change.json in ${DIR}`, EXIT.usage);
  const raw = JSON.parse(fs.readFileSync(at("change.json"), "utf8"));
  const files = raw.files ?? {};
  const added = raw.added ?? [];
  const removed = raw.removed ?? [];
  for (const [file, spec] of Object.entries(files)) {
    if (!spec.whole && !spec.own) refuse(`${file}: give "own", a pattern its hunks match, or "whole": true`, EXIT.usage);
  }
  const all = [...Object.keys(files), ...added, ...removed].sort();
  if (!all.length) refuse("change.json names no path", EXIT.usage);
  if (new Set(all).size !== all.length) refuse("change.json lists a path twice", EXIT.usage);
  if (all.some((f) => f.includes("\\") || path.isAbsolute(f))) refuse("paths are repository-relative, with forward slashes", EXIT.usage);
  return {
    files,
    added,
    removed,
    all,
    gate: raw.gate ?? null,
    carry: raw.carry ?? null,
    expect: raw.expect ?? [],
    link: raw.link ?? ["node_modules"],
    tooling: raw.tooling ? new RegExp(raw.tooling) : GATE_TOOLING,
    timeoutMs: (raw.timeoutMinutes ?? 30) * 60_000,
  };
}

/** The working tree's zero-context hunks against HEAD for one text file. */
function hunksOf(file) {
  const text = git(["diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", file]);
  const hunks = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      hunks.push({ oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), minus: [], plus: [] });
    } else if (hunks.length) {
      const h = hunks[hunks.length - 1];
      if (line.startsWith("-")) h.minus.push(line.slice(1));
      else if (line.startsWith("+")) h.plus.push(line.slice(1));
      else if (line.startsWith("\\")) refuse(`${file}: a no-newline marker; list this file whole`);
    }
  }
  return hunks;
}

const isBinary = (file) => git(["diff", "--numstat", "HEAD", "--", file]).startsWith("-\t-");

/**
 * Apply the picked hunks to HEAD's lines, bottom-up, every removed line
 * checked. A zero-context insertion is placed by its old-side line, which no
 * skipped hunk above it can shift.
 */
function applyHunks(file, headLines, picked) {
  const out = headLines.slice();
  for (const h of picked.slice().sort((a, b) => b.oldStart - a.oldStart)) {
    if (h.minus.length !== h.oldCount) refuse(`${file}: the hunk at -${h.oldStart} counts ${h.oldCount} line(s) and lists ${h.minus.length}`);
    if (h.oldCount === 0) {
      out.splice(h.oldStart, 0, ...h.plus);
      continue;
    }
    h.minus.forEach((l, i) => {
      if (out[h.oldStart - 1 + i] !== l) refuse(`${file}: HEAD line ${h.oldStart + i} is not what the hunk removes`);
    });
    out.splice(h.oldStart - 1, h.oldCount, ...h.plus);
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

/** Refuse a text blob that holds a carriage return; a binary one is left alone. */
function refuseCarriageReturns(sha, file) {
  const blob = execFileSync("git", ["cat-file", "blob", sha], { cwd: REPO, maxBuffer: 1 << 28 });
  if (!blob.subarray(0, 8000).includes(0) && blob.includes(13)) refuse(`${file}: a carriage return in the content to commit`);
}

/**
 * Pick this change's hunks and hash its whole and added files.
 *
 * @param {object} [options]
 * @param {object} [options.pin] An earlier record. A whole or added file whose
 *   content differs from it stops the run, so no attempt takes in an edit
 *   made after the listing was read.
 */
function record({ pin = null } = {}) {
  const change = readChange();
  const rec = { hunks: {}, whole: {}, added: {} };
  for (const [file, spec] of Object.entries(change.files)) {
    if (!headEntry(file)) refuse(`${file}: HEAD does not track it; list it under "added"`);
    if (!inTree(file)) refuse(`${file}: the working tree does not hold it; list it under "removed"`);
    const binary = isBinary(file);
    if (binary && !spec.whole) refuse(`${file}: a binary file is taken whole or not at all`);
    const all = binary ? [] : hunksOf(file);
    const own = spec.own ? new RegExp(spec.own) : null;
    const mine = own ? all.filter((h) => own.test([...h.minus, ...h.plus].join("\n"))) : all;
    console.log(`== ${file}: ${binary ? "binary" : `${all.length} hunk(s), ${mine.length} this change's`}${spec.whole ? ", taken whole" : ""}`);
    for (const h of all) {
      const first = ([...h.plus, ...h.minus].find((l) => l.trim()) ?? "").slice(0, 96);
      console.log(`  ${mine.includes(h) ? "MINE" : "left"} -${h.oldStart},${h.oldCount} (-${h.minus.length} +${h.plus.length}) ${first}`);
    }
    if (spec.whole) {
      if (mine.length !== all.length) refuse(`${file}: listed whole, and ${all.length - mine.length} hunk(s) do not match its pattern`);
      rec.whole[file] = hashOf(file);
      if (rec.whole[file] === revParse(`HEAD:${file}`)) refuse(`${file}: the working copy is what HEAD holds`);
      if (pin && pin.whole?.[file] !== rec.whole[file]) refuse(`${file}: listed whole, and it is not what the last \`record\` hashed; run \`record\` and read its listing again`);
    } else {
      if (spec.count != null && mine.length !== spec.count) refuse(`${file}: the pattern picks ${mine.length} hunk(s) and ${spec.count} are this change's`);
      if (!mine.length) refuse(`${file}: the pattern picks nothing`);
      rec.hunks[file] = mine.map(({ minus, plus }) => ({ minus, plus }));
    }
  }
  for (const file of change.added) {
    if (headEntry(file)) refuse(`${file}: listed as added, and HEAD tracks it`);
    if (!inTree(file)) refuse(`${file}: listed as added, and the working tree does not hold it`);
    rec.added[file] = hashOf(file);
    if (pin && pin.added?.[file] !== rec.added[file]) refuse(`${file}: added, and it is not what the last \`record\` hashed; run \`record\` and read its listing again`);
    console.log(`== ${file}: added, ${rec.added[file]}`);
  }
  for (const file of change.removed) {
    if (!headEntry(file)) refuse(`${file}: listed as removed, and HEAD does not track it`);
    if (inTree(file)) refuse(`${file}: listed as removed, and the working tree still holds it`);
    console.log(`== ${file}: removed`);
  }
  fs.writeFileSync(at("record.json"), JSON.stringify(rec, null, 1));
  console.log("recorded");
  return rec;
}

/**
 * Stage HEAD plus the recorded change, and answer the tree that makes.
 *
 * A recorded hunk is found in the working tree by its exact lines, so a hunk a
 * peer has since added to the file is left where it is, and one that has run
 * into a recorded hunk stops the build. A whole or added file is taken only
 * while its content is what `record` hashed.
 *
 * @param {object} [options]
 * @param {boolean} [options.shared] Stage on the repository's own index, which
 *   must hold nothing staged, in place of a private one reset to HEAD.
 * @returns {{tree: string, head: string, leftOut: Record<string, number>}}
 */
function build({ shared = false } = {}) {
  const change = readChange();
  if (!fs.existsSync(at("record.json"))) refuse("no hunk record; run `record` first");
  const rec = JSON.parse(fs.readFileSync(at("record.json"), "utf8"));
  const env = shared ? process.env : { ...process.env, GIT_INDEX_FILE: at("private-index") };
  if (shared) {
    if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);
  } else {
    fs.rmSync(at("private-index"), { force: true });
    git(["read-tree", "HEAD"], { env });
  }

  const leftOut = {};
  for (const [file, spec] of Object.entries(change.files)) {
    const fileMode = headEntry(file).split(/\s+/)[0];
    if (!fileMode) refuse(`${file}: HEAD no longer tracks it`);
    let sha;
    if (spec.whole) {
      if (rec.whole[file] === undefined) refuse(`${file}: not on record; run \`record\` again`);
      const now = inTree(file) ? hashOf(file) : "missing";
      if (now !== rec.whole[file]) refuse(`${file}: listed whole, and its working copy is ${now} where ${rec.whole[file]} was recorded`);
      sha = git(["hash-object", "-w", "--", file]).trim();
    } else {
      if (!rec.hunks[file]) refuse(`${file}: not on record; run \`record\` again`);
      const current = hunksOf(file);
      const picked = rec.hunks[file].map((want, i) => {
        const found = current.filter((h) => same(h.minus, want.minus) && same(h.plus, want.plus));
        if (found.length !== 1) refuse(`${file}: recorded hunk ${i + 1} occurs ${found.length} time(s) in the working tree`);
        return found[0];
      });
      if (new Set(picked).size !== picked.length) refuse(`${file}: two recorded hunks matched one working-tree hunk`);
      leftOut[file] = current.length - picked.length;
      const content = applyHunks(file, git(["show", `HEAD:${file}`]).split("\n"), picked).join("\n");
      sha = git(["hash-object", "-w", "--stdin"], { input: content }).trim();
    }
    refuseCarriageReturns(sha, file);
    git(["update-index", "--cacheinfo", `${fileMode},${sha},${file}`], { env });
  }
  for (const file of change.added) {
    if (headEntry(file)) refuse(`${file}: listed as added, and HEAD tracks it`);
    const sha = inTree(file) ? git(["hash-object", "-w", "--", file]).trim() : "missing";
    if (sha !== rec.added[file]) refuse(`${file}: added, and its content is ${sha} where ${rec.added[file]} was recorded`);
    refuseCarriageReturns(sha, file);
    git(["update-index", "--add", "--cacheinfo", `100644,${sha},${file}`], { env });
  }
  for (const file of change.removed) {
    if (inTree(file)) refuse(`${file}: listed as removed, and the working tree holds it again`);
    git(["update-index", "--force-remove", "--", file], { env });
  }

  const tree = git(["write-tree"], { env }).trim();
  const changed = lines(git(["diff", "--name-only", "HEAD", tree])).sort();
  if (JSON.stringify(changed) !== JSON.stringify(change.all)) refuse(`the tree changes [${changed.join(", ")}] and change.json names [${change.all.join(", ")}]`);
  return { tree, head: revParse("HEAD"), leftOut };
}

const report = ({ tree, head, leftOut }) => {
  console.log(`base ${head}\ntree ${tree}`);
  for (const [file, n] of Object.entries(leftOut)) if (n) console.log(`left out: ${n} hunk(s) in ${file} that are not this change's`);
};

/**
 * Remove every link in the clone, each as the link itself and never through
 * it: a recursive delete that follows one empties the directory it points at.
 */
function dropLinks(change) {
  const clone = at("clone");
  if (!fs.existsSync(clone)) return;
  const candidates = new Set([...change.link, ...fs.readdirSync(clone)]);
  for (const rel of candidates) {
    const link = path.join(clone, rel);
    if (!fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    try {
      fs.unlinkSync(link);
    } catch {
      fs.rmdirSync(link);
    }
    if (fs.lstatSync(link, { throwIfNoEntry: false })) refuse(`could not remove the link ${link}; remove it by hand before anything deletes the clone`);
  }
}

function dropClone(change) {
  dropLinks(change);
  fs.rmSync(at("clone"), { recursive: true, force: true });
}

/**
 * Make the scratch clone hold one tree on one commit. A clone and not an
 * export: a check that reads git history has none to read in an export, and
 * passes there without having run.
 */
function freshClone(change, commit, tree) {
  const clone = at("clone");
  dropClone(change);
  git(["clone", "-q", "--shared", "--no-checkout", REPO, clone]);
  git(["-C", clone, "checkout", "-q", "--detach", commit]);
  if (tree) git(["-C", clone, "read-tree", "-u", "--reset", tree]);
  const want = tree ?? revParse(`${commit}^{tree}`);
  const holds = git(["-C", clone, "write-tree"]).trim();
  if (holds !== want) refuse(`the clone holds ${holds}, not ${want}`);
  for (const rel of change.link) {
    const from = path.join(REPO, rel);
    const to = path.join(clone, rel);
    if (!fs.existsSync(from) || fs.lstatSync(to, { throwIfNoEntry: false })) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(from, to, "junction");
  }
}

/** Stop a command line and everything it started: stopping the shell alone leaves its children running. */
function killTree(child) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** Run one command line in the clone, keep its output in a log beside the change, and answer how it ended. */
function start(cmd, logName, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, { cwd: at("clone"), shell: true, windowsHide: true, detached: process.platform !== "win32" });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (d) => (output += d));
    }
    child.on("close", (code) => {
      clearTimeout(timer);
      const status = timedOut ? "timeout" : code;
      const seconds = Math.round((Date.now() - started) / 1000);
      fs.writeFileSync(at(logName), `$ ${cmd}\n${output}\n--- exit ${status} in ${seconds}s ---\n`);
      console.log(`${cmd}: exit ${status} in ${seconds}s (${logName})`);
      resolve({ cmd, status, seconds, output });
    });
  });
}

/**
 * Run the stages in order, the command lines of one stage side by side, and
 * stop after the first stage that is not green.
 *
 * @returns {Promise<{green: boolean, results: object[]}>} `green` only when
 *   every command line of every stage ran and exited 0.
 */
async function runStages(stages, label, timeoutMs) {
  const results = [];
  let n = 0;
  for (const stage of stages) {
    const cmds = Array.isArray(stage) ? stage : [stage];
    const done = await Promise.all(cmds.map((cmd) => start(cmd, `${label}-${++n}.log`, timeoutMs)));
    results.push(...done);
    if (done.some((r) => r.status !== 0)) break;
  }
  const expected = stages.flat().length;
  return { green: results.length === expected && results.every((r) => r.status === 0), results };
}

/** The gate package.json names: packs first, then validate beside the tests. */
function defaultStages({ carry = false } = {}) {
  const pkgFile = path.join(at("clone"), "package.json");
  const scripts = fs.existsSync(pkgFile) ? (JSON.parse(fs.readFileSync(pkgFile, "utf8")).scripts ?? {}) : {};
  const side = [!carry && scripts.validate && "npm run validate", scripts.test && "npm test"].filter(Boolean);
  const stages = [scripts["build:packs"] && "npm run build:packs", side.length > 1 ? side : side[0]].filter(Boolean);
  if (carry && !scripts.test) return defaultStages();
  if (!stages.length) refuse('package.json names none of build:packs, validate, test; give "gate" in change.json', EXIT.usage);
  return stages;
}

async function gate() {
  const change = readChange();
  const built = build();
  report(built);
  freshClone(change, built.head, built.tree);
  let run;
  try {
    run = await runStages(change.gate ?? defaultStages(), "gate", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  const output = run.results.map((r) => r.output).join("\n");
  const missing = change.expect.filter((text) => !output.includes(text));
  for (const text of missing) console.log(`expected in the gate's output and absent: ${text}`);
  if (!run.green || missing.length) refuse("the gate is not green; nothing recorded");
  const stages = run.results.map(({ cmd, status, seconds }) => ({ cmd, status, seconds }));
  fs.writeFileSync(at("gated.json"), JSON.stringify({ tree: built.tree, head: built.head, at: new Date().toISOString(), stages }, null, 1));
  console.log(`GREEN: recorded ${built.tree} on ${built.head}`);
}

/**
 * Decide whether a gate result holds on a base that moved under it, and
 * answer the tree and base to commit.
 *
 * It holds when the gated base is an ancestor of HEAD, the commits that
 * landed write none of this change's files and no gate tooling, the rebuilt
 * tree holds the gated blob for every file of the change, and the carry
 * stages pass on that tree. Every other case is a moved base: gate again.
 */
async function carryOver(change, gated) {
  const head = revParse("HEAD");
  try {
    git(["merge-base", "--is-ancestor", gated.head, head]);
  } catch {
    refuse(`the gated base ${gated.head} is not an ancestor of HEAD`, EXIT.movedBase);
  }
  const landed = lines(git(["diff", "--name-only", gated.head, head]));
  const mine = landed.filter((f) => change.all.includes(f));
  if (mine.length) refuse(`a commit that landed writes this change's files (${mine.join(", ")}); gate again`, EXIT.movedBase);
  const tooling = landed.filter((f) => change.tooling.test(f));
  if (tooling.length) refuse(`a commit that landed writes gate tooling (${tooling.join(", ")}); gate again`, EXIT.movedBase);

  const rebuilt = build();
  const blobs = (tree) => git(["ls-tree", "-r", tree, "--", ...change.all]);
  if (blobs(rebuilt.tree) !== blobs(gated.tree)) refuse("the rebuilt tree does not hold the gated content for this change's files; gate again", EXIT.movedBase);
  freshClone(change, rebuilt.head, rebuilt.tree);
  let run;
  try {
    run = await runStages(change.carry ?? defaultStages({ carry: true }), "carry", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  if (!run.green) refuse("the carry stages are not green on the rebuilt tree; nothing staged");
  console.log(`carrying ${landed.length} landed path(s) from ${gated.head} to ${rebuilt.head}`);
  return { tree: rebuilt.tree, base: rebuilt.head, carried: true };
}

/**
 * Ask the repository's leak scanner about the change set before staging. The
 * pre-commit hook takes a flagged file out of the commit, so asking first
 * means the commit either holds the gated tree or is not made.
 */
async function leakScan(paths) {
  const scanner = path.join(REPO, "tools", "ip-scan.mjs");
  if (!fs.existsSync(scanner)) return;
  const { scanPaths } = await import(pathToFileURL(scanner).href);
  if (typeof scanPaths !== "function") return;
  const { errors } = scanPaths(REPO, paths);
  if (errors.length) refuse(`the leak scanner flags the change set:\n${errors.join("\n")}`);
}

async function commit({ carry = false } = {}) {
  const change = readChange();
  if (!fs.existsSync(at("gated.json"))) refuse("no gated tree on record; run `gate` first");
  if (!fs.existsSync(at("commit-msg.txt"))) refuse(`no commit message at ${at("commit-msg.txt")}`);
  const gated = JSON.parse(fs.readFileSync(at("gated.json"), "utf8"));
  // Staging that is not this run's is a peer between `git add` and `git commit`:
  // its commit lands in moments and moves the base, so nothing is built over it.
  if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);

  let want = { tree: gated.tree, base: gated.head, carried: false };
  if (revParse("HEAD") !== gated.head) {
    if (!carry) refuse(`HEAD moved off the gated base ${gated.head}`, EXIT.movedBase);
    want = await carryOver(change, gated);
  } else {
    const again = build();
    if (again.tree !== gated.tree) refuse(`the tree is now ${again.tree}, and ${gated.tree} is what passed:\n${git(["diff", "--stat", gated.tree, again.tree])}`);
  }
  await leakScan([...Object.keys(change.files), ...change.added]);

  // Past the build below, whatever is staged under the change's paths is this
  // run's own, and is this run's to unstage.
  const unstage = () => {
    try {
      git(["reset", "-q", "HEAD", "--", ...change.all]);
    } catch (e) {
      console.error(`could not unstage: ${e.stderr ?? e.message}`);
    }
  };
  try {
    const onShared = build({ shared: true });
    if (onShared.tree !== want.tree) refuse(`the shared index made ${onShared.tree}, not ${want.tree}`);
    if (revParse("HEAD") !== want.base) refuse("HEAD moved while staging", EXIT.movedBase);
    let made;
    for (let attempt = 1; ; attempt++) {
      made = spawnSync("git", ["commit", "-F", at("commit-msg.txt")], { cwd: REPO, encoding: "utf8" });
      if (made.status === 0 || attempt >= LOCK_TRIES || !/index\.lock/.test(made.stderr ?? "")) break;
      sleep(LOCK_WAIT_MS);
    }
    process.stdout.write(made.stdout ?? "");
    process.stderr.write(made.stderr ?? "");
    if (made.status !== 0) refuse(`git commit exited ${made.status}`);
  } catch (e) {
    if (e instanceof Refusal && e.code === EXIT.peerStaging) throw e;
    unstage();
    if (e instanceof Refusal) refuse(`${e.message}; unstaged again`, e.code);
    throw e;
  }

  const sha = revParse("HEAD");
  const tree = revParse("HEAD^{tree}");
  const parent = revParse("HEAD~1");
  console.log(`commit ${sha}\ntree   ${tree}\nparent ${parent}`);
  if (tree !== want.tree || parent !== want.base) refuse("the commit is NOT the gated tree on its base; look at it before anything else");
  if (want.carried) console.log(`OK: the commit holds the gated files on the moved base; run \`postgate ${sha}\`, and the carry stands once that is green`);
  else console.log("OK: the commit holds the gated tree on the gated base");
}

async function postgate() {
  const sha = argv[1] && !argv[1].startsWith("--") ? revParse(`${argv[1]}^{commit}`) : refuse("postgate takes a commit", EXIT.usage);
  const change = readChange();
  freshClone(change, sha, null);
  let run;
  try {
    run = await runStages(change.gate ?? defaultStages(), "postgate", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  const output = run.results.map((r) => r.output).join("\n");
  const missing = change.expect.filter((text) => !output.includes(text));
  if (!run.green || missing.length) refuse(`the full gate is not green on ${sha}`);
  console.log(`GREEN: the full gate passes on ${sha}`);
}

async function ship() {
  const attempts = Number(option("--attempts") ?? 4);
  // The listing `record` prints is the one place a peer's hunk taken as this
  // change's can be seen, so a run starts from a record someone has read, and
  // every attempt holds whole and added files to it.
  if (!fs.existsSync(at("record.json"))) refuse("no hunk record; run `record` and read its listing first");
  let pin = JSON.parse(fs.readFileSync(at("record.json"), "utf8"));
  for (let n = 1; n <= attempts; n++) {
    console.log(`--- attempt ${n} of ${attempts} on ${revParse("HEAD")}`);
    try {
      if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);
      pin = record({ pin });
      await gate();
      await commit();
      return;
    } catch (e) {
      if (!(e instanceof Refusal) || e.code !== EXIT.movedBase || n === attempts) throw e;
      console.log(`${e.message}\nthe base moved under attempt ${n}; going again`);
    }
  }
}

const MODES = {
  record: () => void record(),
  build: () => report(build()),
  gate,
  commit: () => commit({ carry: argv.includes("--carry") }),
  postgate,
  ship,
  clean: () => {
    dropClone(readChange());
    fs.rmSync(at("private-index"), { force: true });
  },
};

try {
  if (!MODES[mode] || !DIR) refuse("usage: node commit-own-hunks.mjs record | build | gate | commit [--carry] | postgate <sha> | ship [--attempts N] | clean, each with --change <dir>", EXIT.usage);
  const real = (p) => fs.realpathSync.native(p).toLowerCase();
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  if (real(top) !== real(REPO)) refuse(`run from the repository root (${top})`, EXIT.usage);
  const inside = path.relative(REPO, DIR);
  if (!inside.startsWith("..") && !path.isAbsolute(inside)) refuse("the change directory lies outside the repository", EXIT.usage);
  await MODES[mode]();
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(`REFUSED: ${e.message}`);
  process.exit(e.code);
}
