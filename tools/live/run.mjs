/**
 * Runs the live walks in this directory, one after another, on the shared seats.
 *
 *   node tools/live/run.mjs             every walk, in name order
 *   node tools/live/run.mjs markets     the named walks, in the order given
 *
 * A walk is a child of this process with its environment (`_env.mjs` lists the
 * variables). Its whole output goes to a log under `logDir()`; the console gets
 * its section headings and its PASS, FAIL and WALK ERROR lines with the detail
 * cut off, because the detail can hold figures a world imported from a book and
 * a console transcript gets quoted where a log does not. A walk that closes with
 * a `== summary ==` section listing its checks again has them counted and shown
 * once, from the inline lines. The exit code is 0 when
 * every walk exited 0 with no FAIL line, and 1 otherwise; 2 names a walk that
 * does not exist; 3 says a browser already answers on a seat's port. Two walks
 * never run at once: each takes both seats, and a driver started while another
 * holds a port attaches to the first walk's browser instead of its own, so the
 * runner refuses to start a walk while either port answers.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logDir, PORTS } from "./_env.mjs";

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
const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !all.includes(n));
if (unknown.length) {
  console.error(`no such walk: ${unknown.join(", ")} (walks: ${all.join(", ")})`);
  process.exit(2);
}
const walks = asked.length ? asked : all;

const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
const dir = logDir();
const HEADLINE = /^(PASS|FAIL|WALK ERROR|== )/u;
// The detail is everything from the first run of two spaces before a brace or bracket.
const stripDetail = (line) => line.replace(/\s{2,}[[{].*$/u, "");

function runWalk(name, log) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(log);
    const tally = { pass: 0, fail: 0, error: false, exit: null };
    const carry = { stdout: "", stderr: "" };
    let summary = false;
    const onLine = (line) => {
      out.write(`${line}\n`);
      if (!HEADLINE.test(line)) return;
      // A walk's closing summary lists its checks again; the tally and the console took each one inline.
      if (/^== summary ==/u.test(line)) summary = true;
      else if (summary && /^(PASS|FAIL)/u.test(line)) return;
      if (line.startsWith("PASS")) tally.pass += 1;
      else if (line.startsWith("FAIL")) tally.fail += 1;
      else if (line.startsWith("WALK ERROR")) tally.error = true;
      console.log(stripDetail(line));
    };
    const feed = (key, chunk) => {
      carry[key] += chunk.toString("utf8");
      const lines = carry[key].split(/\r?\n/u);
      carry[key] = lines.pop();
      for (const line of lines) onLine(line);
    };
    const child = spawn(process.execPath, [path.join(here, `${name}.mjs`)], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => feed("stdout", chunk));
    child.stderr.on("data", (chunk) => feed("stderr", chunk));
    child.on("close", (code) => {
      for (const key of ["stdout", "stderr"]) if (carry[key]) onLine(carry[key]);
      tally.exit = code;
      out.write(`exit: ${code}\n`);
      out.end(() => resolve(tally));
    });
  });
}

const results = [];
for (const name of walks) {
  const busy = [];
  for (const [seat, port] of Object.entries(PORTS)) if (await portBusy(port)) busy.push(`${seat} (port ${port})`);
  if (busy.length) {
    console.error(`seats busy: a browser already answers for ${busy.join(" and ")}; another walk, or a peer session's, holds the seats`);
    process.exit(3);
  }
  const log = path.join(dir, `${name}-${stamp}.log`);
  console.log(`== ${name} (log: ${log}) ==`);
  const tally = await runWalk(name, log);
  results.push({ name, ...tally, log });
  console.log(`== ${name}: ${tally.pass} pass, ${tally.fail} fail${tally.error ? ", walk error" : ""}, exit ${tally.exit} ==`);
}

const red = results.filter((r) => r.fail || r.error || r.exit !== 0);
console.log(red.length ? `live walks: ${red.map((r) => r.name).join(", ")} red` : `live walks: ${results.length} green`);
process.exit(red.length ? 1 : 0);
