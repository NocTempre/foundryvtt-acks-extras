/**
 * One repair over every open book: the parts (a book's merged repair, an
 * adventure book's) asked about in one confirm. Foundry-free:
 * the parts, the confirm and the closing runs are handed in.
 *
 * Each part is first run with an `ask` that records the confirm it would show
 * and answers No, which writes nothing, since every part asks before its first
 * write. The recorded lines are shown together; a Yes runs each part that asked
 * again with its confirm answered Yes, and a part that never asked (nothing of
 * its book to touch, a book closed since) is not run.
 */

export const EVERYTHING_MODES = Object.freeze(["drop", "repair", "force"]);

/**
 * @param {object} o
 * @param {"drop"|"repair"|"force"} o.mode
 * @param {{label: string, run: (ask: Function) => Promise<unknown>}[]} o.parts
 * @param {(asked: {label: string, lines: string[], title: string}[]) => Promise<boolean>} o.confirm
 *   the one confirm, shown only when a part asked
 * @param {() => Promise<unknown>} [o.after] run once every part has: the rules
 *   tables re-read, or the whole import chain after a rebuild
 * @param {(pass: () => Promise<void>) => Promise<void>} [o.asking] runs the
 *   asking pass, every part answered No; nothing writes during it, so a caller
 *   may hold one reading of the library for its length
 * @returns {Promise<{mode: string, asked: number, parts: {label: string, result: unknown}[], after: unknown}|null>}
 *   `asked: 0` and nothing run when no part asked; null when the confirm was answered No
 */
export async function reimportEverything({ mode, parts, confirm, after = null, asking = (pass) => pass() }) {
  if (!EVERYTHING_MODES.includes(mode)) throw new Error(`reimportEverything: no mode "${mode}"`);
  const asked = [];
  await asking(async () => {
    for (const part of parts) {
      let question = null;
      await part.run(async (q) => {
        question = q;
        return false;
      });
      if (question) asked.push({ part, label: part.label, lines: (question.lines ?? []).filter(Boolean), title: question.title ?? "" });
    }
  });
  if (!asked.length) return { mode, asked: 0, parts: [], after: null };
  if (!(await confirm(asked.map(({ label, lines, title }) => ({ label, lines, title }))))) return null;
  const done = [];
  for (const { part, label } of asked) done.push({ label, result: await part.run(async () => true) });
  return { mode, asked: asked.length, parts: done, after: after ? await after() : null };
}
