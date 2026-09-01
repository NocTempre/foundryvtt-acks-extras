/**
 * Progress bars for the jobs that take long enough to look hung.
 *
 * Every import here is a per-entry PIPELINE over the seat's own PDF — page
 * extraction, binding, one or more document writes — so a whole-book run is
 * minutes during which the only honest thing to say is "still going, N of M".
 * Foundry's progress notification is the right shape for that (one line,
 * non-modal, survives a closed dialog), but its raw API has two sharp edges:
 * a bar never taken to pct 1 stays on screen for the rest of the session, and
 * `update()` on a notification the user dismissed throws — into the middle of
 * an import, where a cosmetic failure has no business being.
 *
 * So callers get this instead:
 *   • it counts, so a caller passes the total once and then just steps;
 *   • every call is failure-tolerant — no progress bar may ever break an
 *     import, on any core version, dismissed or not;
 *   • finish() is idempotent and belongs in a `finally`, so an import that
 *     throws half way still clears its bar.
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * @param {string} label   localized job name, shown for the whole run
 * @param {number} [total] units of work; 0 means "unknown", and the bar then
 *                         reports activity without a fraction it cannot honour
 * @returns {{step: (detail?: string) => number, note: (detail?: string) => void, finish: (message?: string) => void}}
 */
export function progressBar(label, total = 0) {
  let bar = null;
  try {
    bar = ui.notifications?.info?.(label, { progress: true }) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | progress bar unavailable — the job still runs`, err);
  }
  let n = 0;

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
    },
  };
}
