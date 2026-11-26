/**
 * The copy a stack makes beside itself (a divide, a split), written so two
 * seats making the same copy from the same state make one. The copy's id is a
 * pure function of the state both read (`copyIdFor`) and the create asks the
 * server to keep it (`createCopyBeside`); the server refuses a create whose id
 * the holder already has, so the second seat writes nothing and the first
 * seat's copy stands. Module-internal: not on the lib api.
 */
import { seededId } from "./util.mjs";

/**
 * The id a copy made from `item`'s current state takes: a pure function of the
 * row, the version of it the seat read (`_stats.modifiedTime`, which every
 * update of the row moves, so a copy left by an earlier divide never collides)
 * and the count the row held. What the copy is for stays out of the seed: two
 * seats that read one state make one copy, whatever count each divides off and
 * whether one splits while the other divides. Null where the row carries no
 * finite `modifiedTime`, which makes the copy take an id of the server's own.
 */
export function copyIdFor(item, held) {
  const modified = item?._stats?.modifiedTime;
  return Number.isFinite(modified) ? seededId(`${item.id}|${modified}|${held}`) : null;
}

/** The ids of the copies this client is creating at this moment. */
const inFlight = new Set();

/** Whether this client's error notices already pass through `quietRefusals`. */
let quieted = false;

/**
 * Core raises an error notice for every refused socket request on the seat that
 * sent it. A refusal that names a copy this client is creating is the other
 * seat's copy of the same write and no error of this seat's, so its notice is
 * dropped; every other notice passes untouched. Core's console line for the
 * refusal stays.
 */
function quietRefusals() {
  const notes = globalThis.ui?.notifications;
  if (quieted || typeof notes?.error !== "function") return;
  quieted = true;
  const error = notes.error;
  notes.error = function (message, options) {
    const text = String(message ?? "");
    for (const id of inFlight) if (text.includes(`[${id}]`)) return null;
    return error.call(this, message, options);
  };
}

/**
 * Create `copy` (plain item data) beside `item` under `id` with `keepId`, or
 * under an id of the server's own when `id` is null. Where the holder already
 * has a row of that id, before the create or by the server's refusal of it, the
 * row is the other seat's copy of the same write: it resolves to null with
 * nothing written and no error notice shown. Any other failure rethrows.
 * @returns {Promise<Item|null>} the new row, or null when another seat made it
 */
export async function createCopyBeside(item, copy, id) {
  const holder = item.parent;
  if (!id) return (await holder.createEmbeddedDocuments("Item", [copy]))[0] ?? null;
  if (holder.items?.has?.(id)) return null;
  quietRefusals();
  inFlight.add(id);
  try {
    return (await holder.createEmbeddedDocuments("Item", [{ ...copy, _id: id }], { keepId: true }))[0] ?? null;
  } catch (err) {
    if (holder.items?.has?.(id)) return null;
    throw err;
  } finally {
    inFlight.delete(id);
  }
}
