/**
 * The landing lease: one gate-to-commit at a time in a repository several
 * sessions commit to. A gate that starts only once the commit before it has
 * landed is never lost to a base that moves under it, so a session waits for
 * its turn in place of gating twice.
 *
 * The lease is one file in the repository's git directory, which no commit
 * carries and every work tree shares:
 *
 *   <git dir>/acks-lease/landing.json   {token, pid, session, change, since}
 *   <git dir>/acks-lease/takeover/      held while a dead holder's lease is removed
 *
 * Holding it is having created it: the create fails where the file exists, so
 * two runs never both succeed. The holder touches the file as it works, and
 * that modification time is its heartbeat. A lease is taken from its holder
 * only where the holder's process is gone, or where the heartbeat has stood
 * still for `SILENT_MS` and still stands two heartbeats after it was first
 * seen so, which a machine waking from sleep does not show. Removing another
 * run's lease happens inside the `takeover` directory, whose create is the
 * same kind of exclusion, so two waiters never both remove one and a waiter
 * never removes a lease younger than the one it judged.
 *
 * A holder whose lease was taken is still running. It asks `holds` before it
 * writes the shared index and stops where the answer is no.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** How often a holder touches its lease. */
export const BEAT_MS = 10_000;
/** A heartbeat older than this, unchanged at the next look, is a holder that stopped. */
export const SILENT_MS = 120_000;
/** A takeover directory older than this was left by a run that died inside it. */
const TAKEOVER_MS = 30_000;
/** The wait before asking again for a lease that was there a moment ago and is gone. */
const GONE_MS = 50;
/** How many looks in one wait may find a lease gone that the create found there. */
const GONE_LOOKS = 20;

const dirOf = (gitDir) => path.join(gitDir, "acks-lease");
const fileOf = (gitDir) => path.join(dirOf(gitDir), "landing.json");

/** Whether a process with this id exists. One this user may not signal exists. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/**
 * The lease as it stands, or null where there is none.
 *
 * @returns {null | {token: string|null, pid: number|null, session: string|null, change: string|null, since: number|null, beat: number}}
 *   `beat` is the file's modification time. A file caught between its create
 *   and its write has every other field null, and is held all the same.
 */
export function readLease(gitDir) {
  const file = fileOf(gitDir);
  let stat;
  let text;
  try {
    stat = fs.statSync(file);
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let held = {};
  try {
    held = JSON.parse(text) ?? {};
  } catch {
    // Unwritten yet, or cut short by a run that died as it wrote.
  }
  return { token: held.token ?? null, pid: held.pid ?? null, session: held.session ?? null, change: held.change ?? null, since: held.since ?? null, beat: stat.mtimeMs };
}

/** Create the lease for `holder` and answer it, or null where one stands. */
function take(gitDir, holder, now) {
  fs.mkdirSync(dirOf(gitDir), { recursive: true });
  const lease = { token: crypto.randomUUID(), pid: process.pid, session: holder.session ?? null, change: holder.change ?? null, since: now };
  try {
    fs.writeFileSync(fileOf(gitDir), `${JSON.stringify(lease)}\n`, { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") return null;
    throw e;
  }
  return lease;
}

/** Whether the lease that stands is the one `token` names. */
export function holds(gitDir, token) {
  return readLease(gitDir)?.token === token;
}

/** Touch the lease `token` names. A lease that is another run's is left alone. */
export function beat(gitDir, token) {
  if (!holds(gitDir, token)) return;
  const now = new Date();
  try {
    fs.utimesSync(fileOf(gitDir), now, now);
  } catch {
    // Taken in the moment between the look and the touch.
  }
}

/** Give up the lease `token` names. Nothing happens where it is another run's by now. */
export function release(gitDir, token) {
  if (!holds(gitDir, token)) return;
  try {
    fs.unlinkSync(fileOf(gitDir));
  } catch {
    // Gone already.
  }
}

/**
 * Remove the lease `judged` describes, where it still stands as judged, and
 * answer whether it is gone. Every removal of another run's lease goes
 * through the takeover directory, and the lease is read again inside it: one
 * a live run created since, or one its holder has touched since, is left.
 */
export function clear(gitDir, judged, now = Date.now()) {
  const guard = path.join(dirOf(gitDir), "takeover");
  try {
    fs.mkdirSync(guard);
  } catch {
    const stat = fs.statSync(guard, { throwIfNoEntry: false });
    if (stat && now - stat.mtimeMs > TAKEOVER_MS) fs.rmSync(guard, { recursive: true, force: true });
    return false;
  }
  try {
    const stands = readLease(gitDir);
    if (stands && (stands.token !== judged.token || stands.beat !== judged.beat)) return false;
    fs.rmSync(fileOf(gitDir), { force: true });
    return true;
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}

/**
 * Take the lease, waiting for the run that holds it.
 *
 * @param {string} gitDir The repository's common git directory.
 * @param {{session?: string|null, change?: string|null}} holder Who is asking, for a waiter to read.
 * @param {object} [options]
 * @param {number} [options.waitMs] How long to wait for a held lease. 0 asks once.
 * @param {number} [options.pollMs] How often a waiter looks again.
 * @param {(held: object, waitedMs: number) => void} [options.onWait] Called at
 *   the first look that finds the lease held, and again each time its holder changes.
 * @param {number} [options.beatMs] How often the lease is touched once held, for a test to shorten.
 * @param {() => number} [options.clock] The time, for a test to move.
 * @param {(ms: number) => Promise<void>} [options.pause] The wait between looks, for a test to skip.
 * @returns {Promise<null | {token: string, pid: number, since: number, waitedMs: number, stop: () => void}>}
 *   The lease, with its heartbeat running until `stop` is called, which also
 *   gives the lease up. null where it was still held when the wait ran out.
 */
export async function acquire(gitDir, holder, { waitMs = 0, pollMs = 2000, onWait = () => {}, beatMs = BEAT_MS, clock = Date.now, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const started = clock();
  let told;
  let silent = null;
  let gone = 0;
  for (;;) {
    const now = clock();
    const lease = take(gitDir, holder, now);
    if (lease) {
      const timer = setInterval(() => beat(gitDir, lease.token), beatMs);
      timer.unref();
      const stop = () => {
        clearInterval(timer);
        release(gitDir, lease.token);
      };
      return { ...lease, waitedMs: now - started, stop };
    }
    const held = readLease(gitDir);
    // A live process id is no proof of a live holder: the id may be another
    // process's by now, and a lease cut short as it was written names none.
    // So a heartbeat that stands still counts too, once it has been seen
    // standing at two looks.
    const same = silent && held && silent.token === held.token && silent.beat === held.beat;
    if (!held || now - held.beat <= SILENT_MS) silent = null;
    else if (!same) silent = { token: held.token, beat: held.beat, seen: now };
    const stopped = held && ((held.pid !== null && !alive(held.pid)) || (same && now - silent.seen >= 2 * BEAT_MS));
    // Just removed, or gone between the create and the look: ask again at
    // once. A file that is there and cannot be read looks the same as one
    // that is gone, so the looks that find nothing are counted, and past a
    // few of them the wait is an ordinary one.
    if ((stopped && clear(gitDir, held, now)) || (!held && ++gone <= GONE_LOOKS)) {
      await pause(GONE_MS);
      continue;
    }
    if (held && told !== held.token) {
      told = held.token;
      onWait(held, now - started);
    }
    if (now - started >= waitMs) return null;
    await pause(Math.min(pollMs, Math.max(1, waitMs - (now - started))));
  }
}
