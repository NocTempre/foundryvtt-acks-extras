/**
 * Tests for the runner the test runner and the validators hand their scripts
 * to (`side-by-side.mjs`). It carries every suite's exit status and every
 * check's output, so a status it drops turns a red gate green and no suite it
 * runs can say so.
 *
 * Each case starts a node of its own that calls the runner on throwaway
 * scripts, and reads what that node printed and returned.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "side-by-side.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-side-by-side-"));
const script = (name, text) => {
  fs.writeFileSync(path.join(dir, name), text);
  return path.join(dir, name);
};

const MARK = "\u0000statuses ";
const driver = script(
  "driver.mjs",
  `const { sideBySide } = await import(${JSON.stringify(pathToFileURL(RUNNER).href)});
const ended = await sideBySide(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));
process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(ended));
`,
);
/** What the runner printed and what it returned, for these scripts and options. */
function run(scripts, options = {}) {
  const r = spawnSync(process.execPath, [driver, JSON.stringify(scripts), JSON.stringify(options)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [printed, returned] = r.stdout.split(MARK);
  return { printed, ended: JSON.parse(returned), stderr: r.stderr };
}

try {
  const slow = script("slow.mjs", 'console.log("slow: first");\nawait new Promise((resolve) => setTimeout(resolve, 700));\nconsole.error("slow: last, on standard error");\n');
  const quick = script("quick.mjs", 'console.log("quick");\n');
  const red = script("red.mjs", 'console.log("red");\nprocess.exit(3);\n');
  const where = script("where.mjs", "console.log(process.cwd());\n");
  // Marks its start, waits until as many scripts have started as it was told
  // to expect, stays a moment longer, and marks its end. The wait is on the
  // other scripts and not on a clock, so a loaded machine changes nothing.
  const counted = script(
    "counted.mjs",
    `import fs from "node:fs";
const [log, expected] = process.argv.slice(2);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.appendFileSync(log, "+");
const givenUp = Date.now() + 10_000;
while (fs.readFileSync(log, "utf8").split("+").length - 1 < Number(expected) && Date.now() < givenUp) await pause(20);
await pause(300);
fs.appendFileSync(log, "-");
`,
  );

  /* --- order and wholeness -------------------------------------------------- */
  const mixed = run([[red], [slow], [quick]]);
  assert.equal(mixed.printed, "red\nslow: first\nslow: last, on standard error\nquick\n",
    "each script's output is whole, both streams, in the order listed, though the last listed ended first");
  assert.equal(mixed.stderr, "", "and nothing is written to the runner's own standard error");
  assert.deepEqual(mixed.ended, [{ args: [red], status: 3 }, { args: [slow], status: 0 }, { args: [quick], status: 0 }],
    "a status is its own script's, and the script that failed stopped neither of the others");
  assert.equal(run([[red], [quick]], { limit: 1 }).printed, "red\nquick\n", "nor one that had yet to start");

  const missing = run([[path.join(dir, "absent.mjs")], [quick]]);
  assert.equal(missing.ended[0].status, 1, "a script node cannot load is a failure");
  assert.match(missing.printed, /Cannot find module[^]*\nquick\n$/, "and what node said of it is shown at its place");

  assert.deepEqual(run([]), { printed: "", ended: [], stderr: "" }, "no scripts print nothing and end at once");

  /* --- where each runs ------------------------------------------------------ */
  const elsewhere = fs.mkdtempSync(path.join(dir, "elsewhere-"));
  assert.equal(fs.realpathSync(run([[where]], { cwd: elsewhere }).printed.trim()), fs.realpathSync(elsewhere), "a script runs in the directory given");

  /* --- how many at once ----------------------------------------------------- */
  const most = (limit) => {
    const log = path.join(dir, `log-${limit}`);
    fs.writeFileSync(log, "");
    const r = run(Array.from({ length: 6 }, () => [counted, log, String(limit)]), { limit });
    assert.ok(r.ended.every((e) => e.status === 0));
    let running = 0;
    let peak = 0;
    for (const mark of fs.readFileSync(log, "utf8")) peak = Math.max(peak, (running += mark === "+" ? 1 : -1));
    assert.equal(running, 0, "every script that started ended");
    return peak;
  };
  assert.equal(most(1), 1, "a limit of one runs the scripts in turn");
  assert.equal(most(3), 3, "a limit of three runs three at once and never a fourth");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("test-side-by-side: OK (order and wholeness, statuses, a script that cannot load, the directory, the limit)");
