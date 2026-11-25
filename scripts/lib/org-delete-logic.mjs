/**
 * The Foundry-free half of a chart row's Delete (docs/lib/ORGANISATION.md, "The chart's
 * tab"): who is offered the control, what the warning lists and what its one tick
 * names, which linked actors a one-click Delete takes, how an Undo merges what a Delete took back
 * into the chart as it stands now, and the one step of memory an open chart keeps. Pure, over
 * plain rows and plain facts the sheet passes in, so it imports under Node and is unit-tested
 * offline (tools/test-org-delete.mjs).
 */

/** The client setting that turns the warning before a Delete on or off; on by default. Off means one-click. */
export const WARN_DELETE_SETTING = "warnBeforeDeletingRows";

/** The client setting holding the linked-actor choice a one-click Delete applies; saved with "Don't warn me again". */
export const DELETE_LINKED_SETTING = "deleteLinkedWithRow";

/**
 * Is a row's Delete offered to this seat? The seat must own the host, whose rows it writes, and
 * hold Foundry's delete permission on every group the Delete takes.
 * @param {{owns?: boolean, groups?: {canDelete: boolean}[]}} facts
 * @returns {boolean}
 */
export const deleteOffered = ({ owns = false, groups = [] } = {}) => !!owns && groups.every((g) => !!g.canDelete);

/**
 * What the warning before a Delete lists. The linked actors the seat may delete are named by its one
 * tick, whose initial state is the saved choice; each other linked actor is a plain "stays" line, and
 * with none deletable there is no tick.
 * @param {object} args
 * @param {{key: string, label: string, group?: string}[]} args.going the row pressed and every row beneath it, in reading order, each with the name of the group it holds
 * @param {number} args.prototypes how many minted prototypes no other group uses go with them
 * @param {{uuid: string, name: string, canDelete: boolean}[]} args.linked the actors the groups name as officer
 * @param {boolean} args.saved the saved linked-actor choice
 * @returns {{top: string, rowCount: number, rows: {label: string, group: string}[], prototypes: number, tick: {names: string[], uuids: string[], checked: boolean}|null, stays: string[]}}
 */
export function warningModel({ going = [], prototypes = 0, linked = [], saved = true } = {}) {
  const deletable = linked.filter((a) => a.canDelete);
  return {
    top: going[0]?.label ?? "",
    rowCount: Math.max(0, going.length - 1),
    rows: going.map((r) => ({ label: r.label, group: r.group ?? "" })),
    prototypes,
    tick: deletable.length ? { names: deletable.map((a) => a.name), uuids: deletable.map((a) => a.uuid), checked: !!saved } : null,
    stays: linked.filter((a) => !a.canDelete).map((a) => a.name),
  };
}

/**
 * The linked actors a one-click Delete takes: every one the seat may delete where the saved choice is
 * on, and none where it is off.
 * @param {{linked: {uuid: string, canDelete: boolean}[], saved: boolean}} args
 * @returns {string[]} uuids
 */
export function linkedToDelete({ linked = [], saved = true } = {}) {
  return saved ? linked.filter((a) => a.canDelete).map((a) => a.uuid) : [];
}

/**
 * Is Undo offered to this seat? It re-creates actors and writes the host's rows.
 * @param {{canCreate?: boolean, owns?: boolean}} facts
 * @returns {boolean}
 */
export const undoOffered = ({ canCreate = false, owns = false } = {}) => !!canCreate && !!owns;

/**
 * Put what a Delete took back into the chart as it stands now. The rows it took are re-inserted
 * where they stood, each under its own parent, or at the top where that parent has gone since; a row
 * the chart still holds keeps its present form, and a row added since stays at the end. The faction's
 * leader is restored only where the field is still blank.
 * @param {object} args
 * @param {{keys: string[], rows: object[], leaderUuid?: string}} args.snapshot what the Delete took: the keys of its rows, the host's rows before it, and the leader before it
 * @param {object[]} args.rows the host's rows now
 * @param {string} [args.leaderUuid] the host's leader now
 * @returns {{rows: object[], leader: string|null}} `leader` is the uuid to write back, null for none
 */
export function planUndo({ snapshot, rows = [], leaderUuid = "" } = {}) {
  const taken = new Set(snapshot?.keys ?? []);
  const now = rows.map((r) => structuredClone(r?.toObject?.() ?? r));
  const nowByKey = new Map(now.map((r) => [r.key, r]));
  const before = (snapshot?.rows ?? []).map((r) => structuredClone(r));
  const stands = (k) => !!k && (nowByKey.has(k) || taken.has(k));
  const merged = [];
  const placed = new Set();
  for (const r of before) {
    if (taken.has(r.key)) {
      merged.push({ ...r, parentKey: stands(r.parentKey) ? r.parentKey : "" });
      placed.add(r.key);
    } else if (nowByKey.has(r.key)) {
      merged.push(nowByKey.get(r.key));
      placed.add(r.key);
    }
  }
  for (const r of now) if (!placed.has(r.key)) merged.push(r);
  const was = snapshot?.leaderUuid ?? "";
  return { rows: merged, leader: was && !leaderUuid ? was : null };
}

/**
 * What the strip above the chart says of the Delete it holds.
 * @param {{label: string, keys: string[]}|null} step the held step
 * @param {{canCreate?: boolean, owns?: boolean}} facts the seat's tests for Undo
 * @returns {{label: string, n: number, canUndo: boolean}|null} `n` is the rows beneath the one pressed
 */
export function undoView(step, facts) {
  if (!step) return null;
  return { label: step.label ?? "", n: Math.max(0, (step.keys?.length ?? 0) - 1), canUndo: undoOffered(facts) };
}

/**
 * The one step of Undo an open chart holds, by the chart's window: a second Delete replaces it, an
 * Undo or a dismiss takes it, and nothing outlives the window or a reload. It is memory only.
 * @returns {{hold: (owner: object, step: object) => void, peek: (owner: object) => object|null, drop: (owner: object) => void}}
 */
export function makeUndoMemory() {
  const held = new WeakMap();
  return {
    hold: (owner, step) => held.set(owner, step),
    peek: (owner) => held.get(owner) ?? null,
    drop: (owner) => held.delete(owner),
  };
}
