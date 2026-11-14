/**
 * Progress bars for the jobs that take long enough to look hung.
 *
 * A whole-book import runs for minutes, and Foundry's progress notification
 * (one line, non-modal) is the shape for "N of M". Its raw API leaves a bar
 * never taken to pct 1 on screen for the session, and `update()` on a
 * dismissed notification throws. Callers get this wrapper instead:
 *   • it counts: pass the total once, then step;
 *   • every call is failure-tolerant, so no progress bar breaks an import;
 *   • finish() is idempotent and belongs in a `finally`, so an import that
 *     throws still clears its bar;
 *   • the bar is not echoed to the console; a run logs its start and finish at
 *     debug.
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * Starts a progress bar for one job and returns its `step`, `note` and `finish` controls.
 * @param {string} label   localized job name, shown for the whole run
 * @param {number} [total] units of work; 0 means "unknown", and the bar then
 *                         reports activity without a fraction it cannot honour
 * @returns {{step: (detail?: string) => number, note: (detail?: string) => void, finish: (message?: string) => void}}
 */
export function progressBar(label, total = 0) {
  let bar = null;
  try {
    bar = ui.notifications?.info?.(label, { progress: true, console: false }) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | progress bar unavailable — the job still runs`, err);
  }
  let n = 0;
  let finished = false;
  console.debug(`${MODULE_ID} | ${label}: started${total ? ` (${total})` : ""}`);

  const paint = (message, pct) => {
    if (!bar?.update) return;
    try {
      bar.update({ pct, message });
    } catch (err) {
      // Dismissed mid-run (or a core that dislikes the update): stop trying.
      bar = null;
      console.warn(`${MODULE_ID} | progress bar closed early — the job still runs`, err);
    }
  };
  const line = (detail) => `${label}${total ? ` ${Math.min(n, total)}/${total}` : ""}${detail ? ` — ${detail}` : ""}`;
  const fraction = () => (total ? Math.min(1, n / total) : 0);

  return {
    /** Advance one unit; `detail` names the entry it covers. */
    step(detail) {
      n++;
      paint(line(detail), fraction());
      return n;
    },
    /** Repaint without advancing — for a long stage before the count starts. */
    note(detail) {
      paint(line(detail), fraction());
    },
    /** Take the bar to 100% so it clears. Safe to call twice. */
    finish(message) {
      paint(message ?? label, 1);
      if (finished) return;
      finished = true;
      console.debug(`${MODULE_ID} | ${label}: finished${total ? ` ${Math.min(n, total)}/${total}` : ` after ${n}`}`);
    },
  };
}
