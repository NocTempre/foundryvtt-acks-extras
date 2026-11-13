/**
 * Runs the live walks in this directory, one after another, on the shared seats,
 * and records each walk's result for the release gate.
 *
 *   node tools/live/run.mjs             every walk, in name order
 *   node tools/live/run.mjs markets     the named walks, in the order given
 *   node tools/live/run.mjs --list      each walk's recorded state, its age, and
 *                                       whether the record is current
 *   node tools/live/run.mjs --classify <walk> <T-id> <defect|world-state|stale-walk|environment>
 *                                       puts a bug-ledger row on the walk's
 *                                       recorded attempt
 *
 * A walk is a child of this process with its environment (`_env.mjs` lists the
 * variables). Its whole output goes to a log under `logDir()`; the console gets
 * its section headings and its PASS, FAIL, GAP, SKIP, WALK END, WALK BLOCKED and
 * WALK ERROR lines with the detail cut off, because the detail can hold figures
 * a world imported from a book and a console transcript gets quoted where a log
 * does not. A walk that closes with a `== summary ==` section listing its
 * checks again has them counted and shown once, from the inline lines.
 *
 * The result file. After each walk the runner records its attempt in
 * `aia-tmp/live/walk-results.json` through `tools/walk-results.mjs`, which owns
 * the schema and decides the walk's state from its whole output (stdout and
 * stderr together) and how it ended: passed, stopped, blocked, errored or
 * failed. The entry carries the runtime tree id at the walk's start and end and
 * the walk file's blob id, so a later edit marks the result stale. The record is
 * always of the working tree, and the latest attempt replaces the earlier one.
 * A run that restricts what a walk covers records `partial` with the variables
 * that did it (`PARTIAL_VARS`), taken from the runner's own environment for every
 * walk in the run: a variable one walk ignores still marks the others, because
 * a subset taken for the whole is the error that costs more. A run that never
 * started a walk (an unknown name, busy seats) records nothing.
 *
 * Classifying. `--classify` reads the bug ledger CSV named by `ACKS_BUG_LEDGER`
 * (the machine's TEST_ENVIRONMENT.md sets it; the file lives outside the
 * repository) and takes only the row asked for, whose status must be new,
 * claimed or deferred. It prints that row's id and status and nothing else of
 * the ledger.
 *
 * Exit codes. A run exits 0 only when every walk it ran reduced to `passed`, so
 * a walk that stopped short, was blocked or errored reads red even though it
 * exited 0 and printed no FAIL; 1 when any walk did not; 2 names a walk that
 * does not exist, a usage error, or a refused `--classify`; 3 says a browser
 * already answers on a seat's port; 4 says a result could not be recorded. A GAP
 * line is a check that failed the way a ROADMAP row says it does: it is counted,
 * and it does not make the walk red. Two walks never run at once: each takes
 * both seats, and a driver started while another holds a port attaches to the
 * first walk's browser instead of its own, so the runner refuses to start a walk
 * while either port answers. `--list` exits 0.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logDir, PORTS, ROOT, version } from "./_env.mjs";
import {
  CLASSES, CLASSIFIED_STATUSES, evaluate, readResults, recordAttempt, recordClassification, reduce, runtimeTree, walkBlob,
} from "../walk-results.mjs";

/**
 * The environment variables that make a walk cover less than it holds, each
 * with the test that says the runner's environment has narrowed it. A run that
 * trips one records `partial: <names>`, which the release preflight refuses.
 */
const PARTIAL_VARS = [
  ["STAGE", (v) => Boolean(v)],
  ["WALK_PLAN", (v) => Boolean(v)],
  ["FIXTURE_OWN", (v) => Boolean(v)],
  ["ONLY_FIXES", (v) => v === "1"],
  ["ROWS", (v) => Boolean(v) && v !== "all"],
  ["TAKEOVER", (v) => Boolean(v)],
];

/** The reason a run is partial, from the runner's environment: the narrowing variables set, or false. */
function partialReason(env = process.env) {
  const set = PARTIAL_VARS.filter(([name, test]) => test(env[name])).map(([name]) => name);
  return set.length ? `restricted by ${set.join(", ")}` : false;
}

/** True when something already answers CDP on the port: another walk's browser, or a peer session's. */
const portBusy = (port) => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && f !== "run.mjs")
  .map((f) => f.slice(0, -4))
  .sort();

const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
const HEADLINE = /^(PASS|FAIL|GAP|SKIP|WALK ERROR|WALK END|WALK BLOCKED|== )/u;
// The detail is everything from the first run of two spaces before a brace or bracket.
const stripDetail = (line) => line.replace(/\s{2,}[[{].*$/u, "");

// -- --list -----------------------------------------------------------------

/** "5m", "3h", "2d": how long ago an ISO time was. */
function ageOf(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** The paths that differ between two runtime tree ids. */
function diffPaths(a, b) {
  const r = spawnSync("git", ["diff-tree", "-r", "--name-only", a, b], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

function list() {
  const read = readResults(ROOT);
  const { tree } = runtimeTree(ROOT);
  const walkBlobs = Object.fromEntries(all.map((n) => [n, walkBlob(ROOT, n)]));
  const verdicts = evaluate({ data: read.data, required: all, tree, walkBlobs, version: version(), diffPaths });
  if (read.error) console.log(`result file: ${read.error}`);
  const width = Math.max(...all.map((n) => n.length), 4);
  for (const v of verdicts) {
    const e = read.data?.walks?.[v.walk];
    const age = e ? ageOf(e.endedAt) : "-";
    console.log(`${v.walk.padEnd(width)}  ${String(v.state).padEnd(8)}  ${age.padStart(4)}  ${v.ok ? "ok" : "not ok"}: ${v.why}`);
  }
  process.exit(0);
}

// -- --classify -------------------------------------------------------------

/** Splits one CSV record into fields, honouring quotes and doubled quotes; an unbalanced quote runs to the record's end. */
function csvFields(text) {
  const fields = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"" && text[i + 1] === "\"") { cur += "\""; i++; }
      else if (ch === "\"") quoted = false;
      else cur += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

/**
 * The status of ledger row `id`, read from the CSV at `file`: `{ status }`, or
 * `{ error }` naming why not. A row starts at a line whose first field is a
 * ticket id, so a malformed row elsewhere in the file cannot swallow the one
 * asked for; only that row's record is parsed, and nothing else is returned.
 */
function ledgerStatus(file, id) {
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/u, "").split(/\r?\n/u);
  const header = csvFields(lines[0] ?? "").map((h) => h.trim().toLowerCase());
  const idCol = header.indexOf("id");
  const statusCol = header.indexOf("status");
  if (idCol !== 0 || statusCol < 0) return { error: "the ledger's header has no leading id column and a status column" };
  const starts = [];
  lines.forEach((line, i) => { if (/^"?T-\d{4,}"?,/u.test(line)) starts.push(i); });
  const hits = [];
  starts.forEach((start, n) => {
    if (csvFields(lines[start])[0].trim() !== id) return;
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    hits.push(lines.slice(start, end).join("\n"));
  });
  if (!hits.length) return { error: `no ledger row ${id}` };
  if (hits.length > 1) return { error: `ledger row ${id} appears ${hits.length} times` };
  const status = (csvFields(hits[0])[statusCol] ?? "").trim().toLowerCase();
  return status ? { status } : { error: `ledger row ${id} has no readable status` };
}

function classify(args) {
  const [walk, row, as, ...rest] = args;
  const refuse = (msg) => { console.error(`classify: ${msg}`); process.exit(2); };
  if (!walk || !row || !as || rest.length) refuse(`usage: --classify <walk> <T-id> <${CLASSES.join("|")}>`);
  if (!all.includes(walk)) refuse(`no such walk: ${walk}`);
  if (!CLASSES.includes(as)) refuse(`"${as}" is not one of ${CLASSES.join(", ")}`);
  if (!/^T-\d{4,}$/u.test(row)) refuse(`"${row}" is not a ledger row id`);
  const file = process.env.ACKS_BUG_LEDGER;
  if (!file) refuse("ACKS_BUG_LEDGER is not set: the machine's TEST_ENVIRONMENT.md names the bug ledger CSV");
  if (!fs.existsSync(file)) refuse("ACKS_BUG_LEDGER names a file that does not exist");
  const found = ledgerStatus(file, row);
  if (found.error) refuse(found.error);
  if (!CLASSIFIED_STATUSES.includes(found.status)) refuse(`row ${row} is ${found.status}; only a ${CLASSIFIED_STATUSES.join(", ")} row classifies a walk`);
  try {
    recordClassification(ROOT, walk, { row, as, status: found.status, version: version() });
  } catch (e) {
    refuse(e.message);
  }
  console.log(`classified ${walk} as ${as}: row ${row} (${found.status}), v${version()}`);
  process.exit(0);
}

// -- a run ------------------------------------------------------------------

function runWalk(name, log) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(log);
    const lines = [];
    const skip = { count: 0 };
    const carry = { stdout: "", stderr: "" };
    let summary = false;
    let settled = false;
    const onLine = (line) => {
      out.write(`${line}\n`);
      lines.push(line);
      if (!HEADLINE.test(line)) return;
      // A walk's closing summary lists its checks again; the console took each one inline.
      if (/^==\s+summary\s+==/iu.test(line)) summary = true;
      else if (summary && /^(PASS|FAIL|GAP|SKIP)/u.test(line)) return;
      if (line.startsWith("SKIP")) skip.count += 1;
      console.log(stripDetail(line));
    };
    const feed = (key, chunk) => {
      carry[key] += chunk.toString("utf8");
      const parts = carry[key].split(/\r?\n/u);
      carry[key] = parts.pop();
      for (const line of parts) onLine(line);
    };
    const finish = (exit, signal) => {
      if (settled) return;
      settled = true;
      for (const key of ["stdout", "stderr"]) if (carry[key]) onLine(carry[key]);
      out.write(`exit: ${exit}${signal ? ` (signal ${signal})` : ""}\n`);
      out.end(() => resolve({ lines, skip: skip.count, exit, signal: signal ?? null }));
    };
    const child = spawn(process.execPath, [path.join(here, `${name}.mjs`)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => feed("stdout", chunk));
    child.stderr.on("data", (chunk) => feed("stderr", chunk));
    child.on("error", (e) => { onLine(`WALK ERROR: could not start: ${e.message}`); finish(null, null); });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

async function main(walks) {
  const dir = logDir();
  const results = [];
  let unrecorded = false;
  for (const name of walks) {
    const busy = [];
    for (const [seat, port] of Object.entries(PORTS)) if (await portBusy(port)) busy.push(`${seat} (port ${port})`);
    if (busy.length) {
      console.error(`seats busy: a browser already answers for ${busy.join(" and ")}; another walk, or a peer session's, holds the seats`);
      process.exit(3);
    }
    let treeStart;
    let blob;
    try {
      treeStart = runtimeTree(ROOT).tree;
      blob = walkBlob(ROOT, name);
    } catch (e) {
      console.error(`cannot take the runtime tree, so ${name} was not started: ${e.message}`);
      process.exit(4);
    }
    const partial = partialReason();
    const log = path.join(dir, `${name}-${stamp}.log`);
    console.log(`== ${name} (log: ${log}) ==`);
    const startedAt = new Date().toISOString();
    const ran = await runWalk(name, log);
    const endedAt = new Date().toISOString();
    const { state, tally } = reduce(ran.lines, { exit: ran.exit, signal: ran.signal });
    try {
      const treeEnd = runtimeTree(ROOT).tree;
      recordAttempt(ROOT, name, { state, tally, exit: ran.exit, signal: ran.signal, treeStart, treeEnd, walkBlob: blob, partial, startedAt, endedAt });
    } catch (e) {
      unrecorded = true;
      console.error(`result for ${name} not recorded: ${e.message}`);
    }
    results.push({ name, state, partial });
    const counts = `${tally.pass} pass, ${tally.fail} fail${tally.gap ? `, ${tally.gap} gap` : ""}${ran.skip ? `, ${ran.skip} skip` : ""}`;
    console.log(`== ${name}: ${state} (${counts}, exit ${ran.exit}${ran.signal ? `, signal ${ran.signal}` : ""}${partial ? `, partial: ${partial}` : ""}) ==`);
  }
  const shown = results.map((r) => `${r.name} ${r.state}${r.partial ? " (partial)" : ""}`).join(", ");
  const bad = results.filter((r) => r.state !== "passed");
  console.log(`live walks: ${shown || "none run"}${bad.length ? ` -- ${bad.length} not passed` : ""}`);
  process.exit(bad.length ? 1 : unrecorded ? 4 : 0);
}

const argv = process.argv.slice(2);
if (argv[0] === "--list") {
  if (argv.length > 1) { console.error("--list takes no arguments"); process.exit(2); }
  list();
} else if (argv[0] === "--classify") classify(argv.slice(1));
else {
  const flags = argv.filter((a) => a.startsWith("--"));
  if (flags.length) { console.error(`unknown flag: ${flags.join(", ")} (flags: --list, --classify)`); process.exit(2); }
  const unknown = argv.filter((n) => !all.includes(n));
  if (unknown.length) {
    console.error(`no such walk: ${unknown.join(", ")} (walks: ${all.join(", ")})`);
    process.exit(2);
  }
  await main(argv.length ? argv : all);
}
