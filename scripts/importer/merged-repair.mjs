/**
 * The repair's two passes, Foundry-free: a scope written in place, every
 * Judge's edit it meets held and listed, then the edits the caller takes
 * written in a second pass. The scope itself (a shelf, a book, picked
 * entries, an adventure book, every open book) is handed in as `pass`.
 *
 * Pass one runs under "keep" (`decides`): every writer writes what the page
 * gives and holds each edit it meets in `tally.edits`. The caller's `choose`
 * answers for the held edits; where it takes none, nothing more runs. Where it
 * takes any, pass two runs under that decision with a fresh tally, and only
 * the steps whose pass one held an edit (`mergedStep`): work that holds none,
 * a delete-and-reimport or a re-read of the rules tables, is never run twice.
 * A decision passed in by the caller answers before anything is held, and one
 * pass runs.
 */
import { decides } from "./held-edits.mjs";
import { mergedTally } from "./refresh.mjs";

/**
 * Run `fn` as step `key` of a merged pass. Pass two (a tally carrying
 * `steps`) runs only the steps its pass one named; pass one names each step
 * that pushed an edit to `tally.edits` in `tally.edited`. A tally of neither
 * kind runs every step.
 * @param {object|null} tally
 * @param {string} key the step's name, the same in both passes
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<unknown>} what `fn` resolved to, or null for a step pass two skips
 */
export async function mergedStep(tally, key, fn) {
  if (tally?.steps && !tally.steps.has(key)) return null;
  const before = tally?.edits?.length ?? 0;
  const out = await fn();
  if (tally && (tally.edits?.length ?? 0) > before) (tally.edited ??= new Set()).add(key);
  return out;
}

/** Whether a tally is a merged repair's second pass: work that holds no edit runs on pass one only. */
export const secondPass = (tally) => !!tally?.steps;

/** The edits, one per key, the first met. */
export function uniqueEdits(edits) {
  const seen = new Set();
  return (edits ?? []).filter((e) => !seen.has(e.key) && seen.add(e.key));
}

/**
 * Run one scope's merged repair.
 * @param {object} o
 * @param {(tally: object, at: {first: boolean}) => Promise<object|null|undefined>} o.pass runs the scope
 *   once under `tally`; on pass one it asks before its first write and resolves null or undefined
 *   when nothing is to run (answered No, refused)
 * @param {(edits: object[]) => Promise<Parameters<typeof decides>[0]>} [o.choose] answers for the
 *   edits pass one held; the default keeps every one
 * @param {Parameters<typeof decides>[0]} [o.decision] the caller's word; given, nothing is asked
 * @param {(decision: unknown) => object} [o.makeTally] a pass's tally (`mergedTally`)
 * @param {(tally: object) => Promise<unknown>} [o.finish] runs once, after the last pass, with its tally
 * @returns {Promise<object|null|undefined>} pass one's result with the merged counts (`replaced`,
 *   `keptProse`, `refused` and `recreated` from the writes, `taken` the edits pass two wrote, `held`
 *   those still standing), `edits` the edits still standing, `second` pass two's result, `after`
 *   what `finish` resolved to; pass one's null or undefined as it came
 */
export async function mergedRepair({ pass, choose = async () => "keep", decision = null, makeTally = mergedTally, finish = null }) {
  const first = makeTally(decision ?? "keep");
  const one = await pass(first, { first: true });
  if (one === null || one === undefined) return one;
  const held = uniqueEdits(first.edits);
  let second = null;
  let two = null;
  let chosen = decision ?? "keep";
  if (decision === null && held.length) {
    chosen = (await choose(held)) ?? "keep";
    if (held.some((e) => decides(chosen, e.key) === "take")) {
      // Built by `makeTally` and marked after, so a closure it holds counts into this tally.
      second = Object.assign(makeTally(chosen), { answered: true, steps: new Set(first.edited ?? []) });
      two = await pass(second, { first: false });
    }
  }
  const standing = second ? uniqueEdits(second.edits) : held;
  const still = new Set(standing.map((e) => e.key));
  const taken = second ? held.filter((e) => !still.has(e.key) && decides(chosen, e.key) === "take").length : 0;
  const after = finish ? await finish(second ?? first) : null;
  return {
    ...one,
    mode: "repair",
    replaced: first.replaced,
    keptProse: first.keptProse,
    refused: first.refused,
    recreated: (first.recreated ?? 0) + (second?.recreated ?? 0),
    taken,
    held: standing.length,
    edits: standing,
    ...(second ? { second: two ?? null } : {}),
    ...(finish ? { after } : {}),
  };
}
