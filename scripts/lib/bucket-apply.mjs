/**
 * The writes a bucket's settlement plan makes (`settlementPlan` in
 * `bucket.mjs` decides, this does). An item row is spent through
 * `divideStack` and a delete: a stack larger than the quantity spent is
 * divided first and the divided row deleted, so a write cut short leaves a
 * stack and never a loss. A creature row (an actor or a token) is MARKED with
 * core's dead status and never deleted. Two kinds of row are handed back
 * unapplied because another feature owns what they mean: a power row (magic's
 * ledger) and an item marked rather than spent (an implement a botch
 * damages).
 *
 * A document the world no longer holds is reported in `gone` and is not an
 * error. Permission is not decided here: a seat that cannot write a row's
 * document is relayed by the caller, which owns the seat.
 */
import { divideStack, stackCountOf } from "./item-model.mjs";
import { isStackable } from "./storage-logic.mjs";
import { STATUS_DEAD } from "./status-effects.mjs";
import { ENTRY_KIND, SETTLE } from "./bucket.mjs";

/**
 * Apply a plan.
 * @param {Array<{uuid: string, kind: string, qty: number, action: string}>} plan `settlementPlan`'s answer
 * @param {(uuid: string) => *} [resolve] a document or a promise of one; `fromUuid` by default
 * @returns {Promise<{spent: string[], marked: string[], gone: string[], handed: object[], failed: Array<{uuid: string, error: string}>}>}
 */
export async function applySettlement(plan, resolve = (uuid) => globalThis.fromUuid(uuid)) {
  const out = { spent: [], marked: [], gone: [], handed: [], failed: [] };
  for (const step of plan ?? []) {
    if (step.action === SETTLE.keep) continue;
    if (step.kind === ENTRY_KIND.power || (step.kind === ENTRY_KIND.item && step.action === SETTLE.mark)) {
      out.handed.push(step);
      continue;
    }
    try {
      const doc = await resolve(step.uuid);
      if (!doc) {
        out.gone.push(step.uuid);
        continue;
      }
      if (step.kind === ENTRY_KIND.item) await spend(doc, step.qty, out, step.uuid);
      else await markDead(doc, out, step.uuid);
    } catch (err) {
      out.failed.push({ uuid: step.uuid, error: String(err?.message ?? err) });
    }
  }
  return out;
}

/** Spend `qty` of an item: the whole row when the quantity reaches the stack, else the divided-off part. */
async function spend(item, qty, out, uuid) {
  const stack = stackCountOf(item);
  if (!isStackable(item) || qty >= stack) await item.delete();
  else {
    const part = await divideStack(item, qty);
    if (!part) throw new Error("the stack could not be divided");
    await part.delete();
  }
  out.spent.push(uuid);
}

/** Mark a creature dead: the actor of a token (the synthetic one for an unlinked token), as an overlay. Never a delete. */
async function markDead(doc, out, uuid) {
  const actor = doc.documentName === "Token" ? doc.actor : doc;
  if (!actor?.toggleStatusEffect) throw new Error("no creature to mark");
  if (!actor.statuses?.has?.(STATUS_DEAD)) await actor.toggleStatusEffect(STATUS_DEAD, { active: true, overlay: true });
  out.marked.push(uuid);
}
