/**
 * Runs node scripts side by side and shows what each printed, whole, in the
 * order the scripts were listed. A script's output appears once every script
 * listed before it has ended, so a run in which every script passes prints
 * what it would print with the scripts run one after another.
 *
 * The scripts must not lean on one another's effects: each reads the
 * repository and writes, at most, to a scratch place of its own. Every
 * script runs to its end whatever the others do, so a failure never hides a
 * later one.
 */
import { spawn } from "node:child_process";
import os from "node:os";

/**
 * @param {Array<string[]>} scripts Each entry is the arguments node is started with.
 * @param {object} [options]
 * @param {string} [options.cwd] Where each runs. Default: this process's directory.
 * @param {number} [options.limit] How many run at once. Default: one per processor, 8 at most.
 * @returns {Promise<Array<{args: string[], status: number|null}>>} How each
 *   ended, in the order listed. `status` is null for a script that could not
 *   be started or was stopped by a signal.
 */
export async function sideBySide(scripts, { cwd = process.cwd(), limit = Math.min(8, os.availableParallelism()) } = {}) {
  const ended = scripts.map(() => null);
  let shown = 0;
  let next = 0;
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (text) => (output += text));
      }
      child.on("error", (err) => resolve({ status: null, output: `${output}${err.message}\n` }));
      child.on("close", (status) => resolve({ status, output }));
    });
  const worker = async () => {
    while (next < scripts.length) {
      const n = next++;
      ended[n] = await run(scripts[n]);
      for (; shown < scripts.length && ended[shown]; shown++) process.stdout.write(ended[shown].output);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, scripts.length)) }, worker));
  return scripts.map((args, n) => ({ args, status: ended[n].status }));
}
