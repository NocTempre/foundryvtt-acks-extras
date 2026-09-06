/**
 * Notices, from inside the running bot, that the module it lives in was
 * replaced. Foundry's updater swaps the whole module directory, so
 * `module.json` vanishes and comes back: with a new version after an update,
 * with the same one after a reinstall. Either means the files under this
 * process are no longer the ones it loaded and `node_modules` went with
 * them, so the bot exits cleanly and the service manager starts the new one.
 *
 * `judge` is pure; `watchModule` runs it on a timer and calls back once.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The manifest two directories above `src/`: the module root when installed, the repo root in a checkout. */
export function moduleJsonPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "module.json");
}

/** `{version}` from a manifest, or null while it is missing or half written. */
export function readManifest(file) {
  try {
    const { version } = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof version === "string" ? { version } : null;
  } catch {
    return null;
  }
}

/**
 * One tick. `state` is `{version, missing}` from the last tick; `reading` is
 * the manifest now, null while it is gone.
 * @returns {{ state: {version: string, missing: boolean}, change: null | {from: string, to: string, reason: "version" | "replaced"} }}
 */
export function judge(state, reading) {
  if (!reading) return { state: { ...state, missing: true }, change: null };
  if (reading.version !== state.version) {
    return { state: { version: reading.version, missing: false }, change: { from: state.version, to: reading.version, reason: "version" } };
  }
  if (state.missing) {
    return { state: { version: reading.version, missing: false }, change: { from: state.version, to: reading.version, reason: "replaced" } };
  }
  return { state, change: null };
}

/**
 * Poll the manifest and call `onChange` once when the module was updated or
 * replaced. Polling rather than `fs.watch`: the directory itself is deleted
 * and recreated, which a watcher on it does not survive. Returns a stop
 * function; the timer never keeps the process alive on its own.
 * @param {{ file?: string, intervalMs?: number, onChange: (change: object) => unknown, log?: object }} opts
 */
export function watchModule({ file = moduleJsonPath(), intervalMs = 30_000, onChange, log } = {}) {
  const first = readManifest(file);
  if (!first) {
    log?.warn(`update watch: no manifest at ${file}; a module update will not restart the bot`);
    return () => {};
  }
  let state = { version: first.version, missing: false };
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    const next = judge(state, readManifest(file));
    state = next.state;
    if (!next.change) return;
    fired = true;
    clearInterval(timer);
    Promise.resolve(onChange(next.change)).catch((err) => log?.error(`update watch: ${err.message}`));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
