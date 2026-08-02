/**
 * The Foundry-FREE half of PLACES — the nesting, occupancy and stacking rules
 * that let "the Duchy of Aura", "the Rusty Anchor", "the cellar" and "the chest
 * in the cellar" be the same kind of thing. place.mjs re-exports these and adds
 * the document reads and writes around them; this half imports under Node and is
 * unit-tested offline (the same split as storage-logic.mjs vs storage.mjs).
 *
 * WHY A PLACE IS NOT JUST A PROVIDER. acks-lib already had one half of this:
 * a PROVIDER is any actor that holds goods (storage.mjs). That answers "where
 * are my boots" and nothing else. A place additionally answers:
 *
 *   - **what is it inside of** — a cellar is in an inn, an inn is in a town;
 *   - **what is inside it that is not an item** — the garrison, the innkeeper,
 *     the pack of rats, the sub-buildings;
 *   - **how many of it are there** — eight identical warehouse bays are one
 *     actor until one of them becomes interesting.
 *
 * A CONTAINER IS THE TRIVIAL PLACE (the owner's framing, 2026-08-02). A chest
 * is a place with no market, no occupants, and exactly one level of nesting; a
 * duchy is a place with all three. Because the degenerate case is a real
 * shipped document — acks-equipment's container item — the model is kept honest:
 * anything the location sheet does to a town, it must be able to do to a chest.
 *
 * Everything here works on NORMALISED NODES, never on Foundry documents:
 *
 *   {uuid, parentUuid, name, kind, count}
 *
 * so a location actor, a container item and a plain provider actor all reduce to
 * the same shape before any rule runs. place.mjs owns the reduction.
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
  GROUP: "group", // an acks-lib.group stack — a platoon, a rat swarm
  MONSTER: "monster",
  HENCHMAN: "henchman", // a retainer, tracked by acks-henchmen
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
 * The direct children of a place, in stable name order.
 *
 * Sorted here rather than at the sheet because the ORDER IS PART OF THE MODEL:
 * two clients rendering the same town must list its buildings identically, or a
 * GM describing "the third building down" is describing a different building to
 * every player.
 */
export function childrenOf(uuid, nodes) {
  return (nodes ?? [])
    .filter((n) => n?.parentUuid === uuid)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/**
 * Every ancestor of a place, nearest first, stopping at the root.
 *
 * Cycle-safe by construction: a uuid already seen ends the walk. A corrupt
 * parent chain therefore renders a short breadcrumb rather than hanging the
 * sheet — which is the behaviour you want, because the sheet is where a GM
 * would go to fix it.
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
 * Every place under this one, breadth-first, excluding itself.
 *
 * The visited set doubles as the cycle guard, exactly as expandContainerClosure
 * does for nested containers — a corrupt loop terminates instead of hanging.
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
 * Would making `parentUuid` the parent of `uuid` create a loop?
 *
 * THE ONE INVARIANT OF THE WHOLE NESTING MODEL. Dropping a town onto one of its
 * own cellars must not produce a cycle: the walks above survive one (they are
 * all guarded), but a cycle silently orphans everything in it from the root, so
 * it is refused at the point of the write rather than tolerated afterwards.
 *
 * Self-parenting counts. A parent that is not in the index does not — it is a
 * place this client cannot see, and refusing the drop on that basis would make
 * the rule depend on who is looking.
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
 * Sum a per-place number over a place and everything beneath it.
 *
 * Used for the two totals a nested model needs and a flat one does not: the coin
 * held in a town (its own vaults plus every cellar and chest under it) and the
 * headcount of its garrison. `counts` is uuid → number; places missing from it
 * contribute nothing.
 */
export function rollup(uuid, nodes, counts) {
  const own = Number(counts?.get?.(uuid) ?? 0) || 0;
  return descendantUuids(uuid, nodes).reduce((sum, u) => sum + (Number(counts?.get?.(u) ?? 0) || 0), own);
}

/* -------------------------------------------- */
/*  Occupancy                                    */
/* -------------------------------------------- */

/**
 * The roster a sheet actually renders: what was deliberately placed here, plus
 * whoever is standing on the linked scene.
 *
 * TWO SOURCES, ONE LIST, STORED WINS. The roster is the deliberate record — the
 * GM said the garrison is billeted here — and survives the scene being deleted,
 * renamed or never opened. Tokens on the linked scene are DERIVED: appended when
 * they are not already in the roster, marked `derived: true`, and never written
 * back. That asymmetry is the point. A derived row is a live observation and
 * disappears when the token walks away; promoting one to a stored row is an
 * explicit act (the sheet's "keep here" button), because a party crossing a map
 * should not silently take up residence in it.
 *
 * Dedup is by actor uuid, so the same actor placed by hand AND standing on the
 * map appears once — as the stored row, keeping its notes and attribution.
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
 * Which occupant rows this viewer may see.
 *
 * THE SAME RULING AS STORAGE, RESTATED FOR PEOPLE (storage.mjs header): this is
 * a UI convention, not a security boundary. A player with ownership of a shared
 * town can still enumerate its roster from the console, so a garrison that must
 * genuinely stay secret belongs on a GM-owned place — the rule here only decides
 * what the sheet puts on screen.
 *
 * A hidden row is hidden from players, FULL STOP, with exactly one exception:
 * the row you put there yourself (`ownerUuid`), so your own stabled horse does
 * not vanish because a GM hid somebody else's garrison.
 *
 * THE EXCEPTION IS DELIBERATELY NOT "you own the occupant". That was the first
 * implementation and live testing killed it: in a world that grants players
 * ownership of most actors — which is ordinary — owning the NPC meant seeing
 * every hidden row about it, and `hidden` stopped meaning anything. Owning an
 * actor is not evidence the GM meant you to know it is here; placing it is.
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
 * Eight identical warehouse bays are ONE actor until one of them becomes
 * interesting — the same laziness invariant acks-lib.group applies to bodies
 * (docs/lib/GROUPS.md), applied to places.
 *
 * A group's members can diverge in place because a member IS an ActorDelta over
 * a shared base. A place cannot borrow that: its contents are embedded items and
 * a roster, which have no delta representation, so divergence here is a SPLIT —
 * the interesting bay becomes its own actor and the stack shrinks by one. That
 * is the whole mechanism, and it is why `count` is the only stack state.
 *
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
