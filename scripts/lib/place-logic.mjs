/**
 * The Foundry-free half of PLACES — nesting, occupancy and stacking rules
 * shared by locations, storage providers and container items. Works on
 * NORMALISED NODES ({uuid, parentUuid, name, kind, count}), never on Foundry
 * documents, so it imports under Node and is unit-tested offline (the same
 * split as storage-logic.mjs vs storage.mjs). place.mjs re-exports these,
 * adds the document reads and writes, and owns the node reduction. See
 * docs/lib/PLACES.md.
 */

/** Flag scope shared with the rest of the family (one module id since the merge). */
export const LIB_ID = "acks-extras";

/** `flags.acks-extras.place` — nesting for providers that are NOT location actors. */
export const PLACE_KEY = "place";

/**
 * What sort of thing a place is. This is a DISPLAY and DROP-RULES distinction,
 * never a permission one: the kind decides which icon and which affordances a
 * row gets, not who may read it.
 */
export const PLACE_KIND = Object.freeze({
  LOCATION: "location", // an acks-extras.location actor — the full article
  CONTAINER: "container", // an acks-equipment container item — the trivial article
  PROVIDER: "provider", // any other actor flagged to hold goods (a wagon, a hireling)
});

/**
 * What sort of thing OCCUPIES a place. Items are not here: items are embedded
 * documents handled by storage.mjs, and the whole point of the roster is the
 * things Foundry cannot embed in an actor.
 */
export const OCCUPANT_KIND = Object.freeze({
  ACTOR: "actor", // a character, an NPC, an animal
  GROUP: "group", // a group-actor stack — a platoon, a rat swarm
  MONSTER: "monster",
  HENCHMAN: "henchman", // a retainer, tracked by the henchmen feature
  PLACE: "place", // a sub-place shown inline (buildings inside a town)
});

/** Walk guard. Deep enough for realm > duchy > town > inn > room > chest > sack. */
const MAX_DEPTH = 32;

/* -------------------------------------------- */
/*  Indexing                                     */
/* -------------------------------------------- */

/** uuid → node, for the walks below. Nodes without a uuid are dropped. */
export function indexPlaces(nodes) {
  const index = new Map();
  for (const node of nodes ?? []) {
    if (node?.uuid) index.set(node.uuid, node);
  }
  return index;
}

/**
 * The direct children of a place, in stable name order — sorted here, not at
 * the sheet, so every client renders the same list.
 */
export function childrenOf(uuid, nodes) {
  return (nodes ?? [])
    .filter((n) => n?.parentUuid === uuid)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/**
 * Every ancestor of a place, nearest first, stopping at the root. Cycle-safe
 * by construction: a uuid already seen ends the walk. See docs/lib/PLACES.md,
 * "The one invariant".
 */
export function ancestorUuids(uuid, index) {
  const out = [];
  const seen = new Set([uuid]);
  let current = index?.get?.(uuid)?.parentUuid ?? null;
  while (current && !seen.has(current) && out.length < MAX_DEPTH) {
    seen.add(current);
    out.push(current);
    current = index.get(current)?.parentUuid ?? null;
  }
  return out;
}

/**
 * The breadcrumb: root first, this place last. `[]` for a uuid that is not in
 * the index at all, so a caller can tell "unknown place" from "root place"
 * (which returns exactly one entry — itself).
 */
export function placePath(uuid, index) {
  if (!index?.has?.(uuid)) return [];
  return [...ancestorUuids(uuid, index).reverse(), uuid].map((u) => index.get(u)).filter(Boolean);
}

/** How deep a place sits. A root is 0. */
export const depthOf = (uuid, index) => ancestorUuids(uuid, index).length;

/**
 * Every place under this one, breadth-first, excluding itself. The visited
 * set is also the cycle guard (as in `expandContainerClosure`).
 */
export function descendantUuids(uuid, nodes) {
  const byParent = new Map();
  for (const node of nodes ?? []) {
    if (!node?.parentUuid) continue;
    if (!byParent.has(node.parentUuid)) byParent.set(node.parentUuid, []);
    byParent.get(node.parentUuid).push(node.uuid);
  }
  const out = [];
  const seen = new Set([uuid]);
  const queue = [uuid];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) ?? []) {
      if (seen.has(child)) continue; // also the cycle guard
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Re-parenting                                 */
/* -------------------------------------------- */

/**
 * Would making `parentUuid` the parent of `uuid` create a loop? Self-parenting
 * counts; a parent not in the index does not, since that just means a place
 * this client cannot see. See docs/lib/PLACES.md, "The one invariant".
 */
export function wouldCycle(uuid, parentUuid, index) {
  if (!uuid || !parentUuid) return false;
  if (uuid === parentUuid) return true;
  return ancestorUuids(parentUuid, index).includes(uuid) || parentUuid === uuid;
}

/**
 * The re-parent decision, as a plan rather than a write.
 * @returns {{ok: boolean, reason?: "cycle"|"same"|"missing"}}
 */
export function planReparent(uuid, parentUuid, index) {
  if (!uuid) return { ok: false, reason: "missing" };
  const current = index?.get?.(uuid)?.parentUuid ?? null;
  const next = parentUuid || null;
  if (current === next) return { ok: false, reason: "same" };
  if (next && wouldCycle(uuid, next, index)) return { ok: false, reason: "cycle" };
  return { ok: true };
}

/* -------------------------------------------- */
/*  Roll-up                                      */
/* -------------------------------------------- */

/**
 * Sum a per-place number over a place and everything beneath it — coin held
 * in a town plus its cellars, a garrison's headcount. `counts` is uuid →
 * number; places missing from it contribute nothing.
 */
export function rollup(uuid, nodes, counts) {
  const own = Number(counts?.get?.(uuid) ?? 0) || 0;
  return descendantUuids(uuid, nodes).reduce((sum, u) => sum + (Number(counts?.get?.(u) ?? 0) || 0), own);
}

/* -------------------------------------------- */
/*  Occupancy                                    */
/* -------------------------------------------- */

/**
 * The roster a sheet renders: what was deliberately placed here, plus
 * whoever is standing on the linked scene. Dedup is by actor uuid; the
 * stored row wins. See docs/lib/PLACES.md, "Occupancy: two sources, one
 * list, stored wins".
 */
export function mergeOccupants(stored, derived) {
  const rows = [];
  const seen = new Set();
  for (const row of stored ?? []) {
    if (!row?.uuid || seen.has(row.uuid)) continue;
    seen.add(row.uuid);
    rows.push({ ...row, derived: false });
  }
  for (const row of derived ?? []) {
    if (!row?.uuid || seen.has(row.uuid)) continue;
    seen.add(row.uuid);
    rows.push({ ...row, derived: true });
  }
  return rows;
}

/**
 * Which occupant rows this viewer may see. A UI convention, not a security
 * boundary (docs/lib/PLACES.md, "Occupancy: two sources, one list, stored
 * wins"; see also storage.mjs). A hidden row is hidden from players, with
 * exactly one exception: the row the viewer placed themselves (`ownerUuid`).
 * See docs/lib/DECISIONS.md, "The hidden-row exception is who placed the
 * occupant, never who owns it".
 */
export function visibleOccupants(rows, { isGM = false, ownedUuids = [] } = {}) {
  if (isGM) return [...(rows ?? [])];
  const owned = new Set(ownedUuids ?? []);
  return (rows ?? []).filter((row) => {
    if (!row?.hidden) return true;
    return !!row.ownerUuid && owned.has(row.ownerUuid);
  });
}

/**
 * Fold a roster into display groups by kind, preserving each group's order.
 * Kinds with no rows are omitted, so a chest renders no empty "Groups" heading.
 */
export function groupOccupants(rows) {
  const buckets = new Map();
  for (const row of rows ?? []) {
    const kind = row?.kind || OCCUPANT_KIND.ACTOR;
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(row);
  }
  return buckets;
}

/**
 * Headcount of a roster. A group row counts its whole stack, not one body — a
 * platoon billeted at an inn is 30 people asleep in it, and a garrison total
 * that says "1" would be worse than no total at all.
 */
export const headcount = (rows) =>
  (rows ?? []).reduce((sum, row) => sum + (Number(row?.quantity) > 0 ? Number(row.quantity) : 1), 0);

/* -------------------------------------------- */
/*  Stacking                                     */
/* -------------------------------------------- */

/**
 * Plan splitting one instance out of a stacked place. See docs/lib/PLACES.md,
 * "Stacking, and how it differs from a group".
 * @returns {{from: number, to: number}|null} null when the split is impossible
 *   (nothing to take, or taking the lot, which would leave an empty stack).
 */
export function planSplit(count, take = 1) {
  const have = Math.max(0, Math.floor(Number(count) || 0));
  const want = Math.max(0, Math.floor(Number(take) || 0));
  if (have < 2 || want < 1 || want >= have) return null;
  return { from: have - want, to: want };
}

/** Display name for one instance of a stack: "Warehouse Bay 3". */
export function stackMemberName(name, ordinal) {
  const n = Math.max(1, Math.floor(Number(ordinal) || 1));
  return `${name ?? ""} ${n}`.trim();
}

/**
 * Is this place stacked? A count of 1 (or absent) is an ordinary single place —
 * the overwhelming case, which must therefore cost nothing to read.
 */
export const isStacked = (node) => Math.floor(Number(node?.count) || 1) > 1;
