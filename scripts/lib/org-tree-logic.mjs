/**
 * The Foundry-free half of the organisation chart (docs/lib/ORGANISATION.md): the
 * node a unit row reduces to, the walks over it, the write plans for add, join,
 * leave, send out and recall, the two view models, the leader's morale part read
 * from above, and the one list of who an organisation affiliates. Everything here
 * works on plain rows and plain facts passed in, so it imports under Node and is
 * unit-tested offline (tools/test-org-tree.mjs); `org.mjs` carries the plans out
 * and `org-host.mjs` reads the world.
 *
 * A plan is `{ok, reason?, ops}`: `ops` is the ordered list of writes, each
 * `{op: "update", uuid, update}`, `{op: "addOccupant", place, actor}`,
 * `{op: "removeOccupant", place, actor}` or `{op: "parent", uuid, parentUuid}`. A
 * refusal is a `reason` and no ops.
 */
import { OCCUPANT_KIND, ancestorUuids, descendantUuids, indexPlaces } from "./place-logic.mjs";

/** The system's own marker for a creature that has fallen (`CONFIG.specialStatusEffects.DEFEATED`). */
const STATUS_DEAD = "dead";

/* -------------------------------------------- */
/*  Nodes and walks                              */
/* -------------------------------------------- */

/**
 * A chart's rows reduced to the one node shape every reader walks:
 * `{key, parentKey, label, holderUuid, kind}`. A row with no key is dropped and a
 * repeated key keeps its first row, so a walk never meets two nodes of one name.
 * @param {object[]} rows stored unit rows, model-backed or plain
 * @returns {{key: string, parentKey: string, label: string, holderUuid: string, kind: string}[]}
 */
export function nodesOf(rows) {
  const seen = new Set();
  const out = [];
  for (const raw of rows ?? []) {
    const row = raw?.toObject?.() ?? raw;
    const key = String(row?.key ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      parentKey: String(row.parentKey ?? ""),
      label: String(row.label ?? ""),
      holderUuid: String(row.holderUuid ?? ""),
      kind: String(row.kind ?? ""),
    });
  }
  return out;
}

/** Nodes in place-logic's `{uuid, parentUuid}` shape, so one walker serves a chart as it serves a place. */
const asPlaces = (nodes) => (nodes ?? []).map((n) => ({ uuid: n.key, parentUuid: n.parentKey }));

/**
 * The keys of every row above `key`, nearest first. The walk ends on its own
 * where data loops, and at a parent that names no row.
 * @param {string} key
 * @param {{key: string, parentKey: string}[]} nodes
 * @returns {string[]}
 */
export function rowAncestors(key, nodes) {
  return key ? ancestorUuids(key, indexPlaces(asPlaces(nodes))) : [];
}

/**
 * The keys of every row under `key`, nearest first, however deep.
 * @param {string} key
 * @param {{key: string, parentKey: string}[]} nodes
 * @returns {string[]}
 */
export function rowDescendants(key, nodes) {
  return key ? descendantUuids(key, asPlaces(nodes)) : [];
}

/** `key` and every key under it, the row first. */
export const subtreeKeys = (key, nodes) => (key ? [key, ...rowDescendants(key, nodes)] : []);

/**
 * The rows standing at the top of a chart: a blank parent, or a parent that names
 * no row of this chart (an orphan reads as a root rather than vanishing).
 */
export function rowRoots(nodes) {
  const keys = new Set((nodes ?? []).map((n) => n.key));
  return (nodes ?? []).filter((n) => !n.parentKey || !keys.has(n.parentKey));
}

/** Is this row empty: no holder, or one that no longer resolves? A chart with empty rows is finished. */
export const isEmptyRow = (node, resolves = null) => !node?.holderUuid || (typeof resolves === "function" && !resolves(node.holderUuid));

/* -------------------------------------------- */
/*  The ordered write plans                      */
/* -------------------------------------------- */

const REFUSED = (reason) => ({ ok: false, reason, ops: [] });

/** A blank row of the unit shape, with the fields a caller names. */
export function blankRow(key, { parentKey = "", label = "", kind = "", holderUuid = "", notes = "" } = {}) {
  return { key, parentKey, label, holderUuid, kind, notes, hidden: false, gen: {} };
}

/** Plain copies of a list's rows, safe to edit. */
const copyRows = (rows) => (rows ?? []).map((r) => structuredClone(r?.toObject?.() ?? r));

/**
 * Add an empty row under `parentKey` (blank for the top of the chart) on a host.
 * @param {object[]} rows the host's rows
 * @param {string} parentKey
 * @param {string} newKey a key no row holds
 * @param {object} [fields] `label`, `kind`, `notes`
 * @returns {{ok: boolean, reason?: "noRow"|"noKey"|"taken", rows?: object[], key?: string}}
 */
export function planAdd(rows, parentKey, newKey, fields = {}) {
  if (!newKey) return { ok: false, reason: "noKey" };
  const list = copyRows(rows);
  if (list.some((r) => r.key === newKey)) return { ok: false, reason: "taken" };
  if (parentKey && !list.some((r) => r.key === parentKey)) return { ok: false, reason: "noRow" };
  list.push(blankRow(newKey, { ...fields, parentKey: parentKey ?? "" }));
  return { ok: true, rows: list, key: newKey };
}

/** The rows with `key`'s holder set (blank to empty it). Nothing changes for an unknown key. */
export function withHolder(rows, key, holderUuid) {
  return copyRows(rows).map((r) => (r.key === key ? { ...r, holderUuid: holderUuid ?? "" } : r));
}

/**
 * Join a group's chart to a faction's. The faction is written first, with the
 * group's rows appended under `underKey` (blank for the top), every key as it was;
 * then the group's own rows are cleared. A row the faction already holds under the
 * same key is the first write having landed, so a second press writes no row twice
 * and only completes the clearing. The faction's row wins where the two differ.
 *
 * @param {{uuid: string, rows: object[]}} group the group hosting a chart
 * @param {{uuid: string, rows: object[]}} faction the faction joined
 * @param {string} [underKey] the faction row the group's top rows go under
 * @returns {{ok: boolean, reason?: "noRows"|"noRow", ops: object[], moved?: string[], twin?: boolean}}
 */
export function planJoin(group, faction, underKey = "") {
  const mine = copyRows(group?.rows);
  if (!mine.length) return REFUSED("noRows");
  const there = copyRows(faction?.rows);
  if (underKey && !there.some((r) => r.key === underKey)) return REFUSED("noRow");
  const held = new Set(there.map((r) => r.key));
  const tops = new Set(rowRoots(nodesOf(mine)).map((n) => n.key));
  const moved = [];
  for (const row of mine) {
    if (held.has(row.key)) continue;
    moved.push(row.key);
    there.push({ ...row, parentKey: tops.has(row.key) ? (underKey ?? "") : row.parentKey });
  }
  const ops = [];
  if (moved.length) ops.push({ op: "update", uuid: faction.uuid, update: { "system.units": there } });
  ops.push({ op: "update", uuid: group.uuid, update: { "system.units": [] } });
  return { ok: true, ops, moved, twin: !moved.length };
}

/**
 * Take a subtree out of a faction onto the group holding its top row. The group
 * is written first, hosting the subtree with its top row at the top of its chart
 * and every key as it was, then the faction drops the subtree. A key the group
 * already holds is the first write having landed, so a second press only
 * completes the clearing.
 *
 * @param {{uuid: string, rows: object[]}} faction
 * @param {string} key the top row of the subtree
 * @param {{uuid: string, rows: object[]}} group the group that hosts it from now on
 * @returns {{ok: boolean, reason?: "noRow"|"noHolder", ops: object[], moved?: string[], twin?: boolean}}
 */
export function planLeave(faction, key, group) {
  const rows = copyRows(faction?.rows);
  if (!rows.some((r) => r.key === key)) return REFUSED("noRow");
  if (!group?.uuid) return REFUSED("noHolder");
  const leaving = new Set(subtreeKeys(key, nodesOf(rows)));
  const own = copyRows(group.rows);
  const held = new Set(own.map((r) => r.key));
  const moved = [];
  for (const row of rows) {
    if (!leaving.has(row.key) || held.has(row.key)) continue;
    moved.push(row.key);
    own.push(row.key === key ? { ...row, parentKey: "" } : row);
  }
  const ops = [];
  if (moved.length) ops.push({ op: "update", uuid: group.uuid, update: { "system.units": own } });
  ops.push({ op: "update", uuid: faction.uuid, update: { "system.units": rows.filter((r) => !leaving.has(r.key)) } });
  return { ok: true, ops, moved, twin: !moved.length };
}

/**
 * The chart a group joins with. A group hosting rows joins with them; a group
 * hosting none joins as one row that holds itself, the shape a roll with no
 * village gives its top unit, so a group standing alone can still be listed under
 * a faction. A row of the group's own is never replaced.
 *
 * @param {object[]} rows the group's own rows
 * @param {{key: string, label: string, holderUuid: string}} self the one row an empty chart becomes
 * @returns {object[]} plain rows
 */
export function chartToJoin(rows, { key, label, holderUuid }) {
  const own = copyRows(rows);
  return own.length ? own : [blankRow(key, { label, holderUuid })];
}

/**
 * What the faction line on a group's sheet shows and offers. A faction that
 * answers for the group's row, while the group hosts no rows of its own, is a
 * joined group: the line names the faction and offers Leave. A group hosting rows
 * of its own that a faction also names is a join stopped between its two writes:
 * it reads as free, with that faction offered first, so a second press completes
 * it. A group that is a row of another group's chart is listed there and shows no
 * line, and neither does a group inside another group that hosts no chart.
 *
 * @param {object} facts
 * @param {boolean} facts.ownRows the group hosts rows of its own
 * @param {boolean} facts.nested the group stands inside another group
 * @param {{hostUuid: string, hostIsFaction: boolean}|null} facts.found the host that names the group's row
 * @returns {{state: "joined"|"free"|"hidden", hostUuid?: string}}
 */
export function factionLine({ ownRows, nested, found }) {
  if (found?.hostIsFaction) return ownRows ? { state: "free", hostUuid: found.hostUuid } : { state: "joined", hostUuid: found.hostUuid };
  if (ownRows) return { state: "free" };
  return found || nested ? { state: "hidden" } : { state: "free" };
}

/**
 * Send a row's group out to a place. The place's roster is written first, then the
 * group leaves the group it stood inside, so a group caught between the two writes
 * stands in two places rather than none. Every other roster that held it lets it go.
 *
 * @param {object} facts
 * @param {string} facts.holderUuid the row's group, or the lone actor holding it
 * @param {boolean} facts.holderIsGroup only a group stands inside another
 * @param {string} facts.parentGroupUuid the group it stands inside now, blank for none
 * @param {string[]} facts.holdings the places whose roster holds it now
 * @param {string} facts.placeUuid the place it goes to
 * @returns {{ok: boolean, reason?: "noHolder"|"noPlace", ops: object[]}}
 */
export function planSendOut({ holderUuid, holderIsGroup, parentGroupUuid, holdings, placeUuid }) {
  if (!holderUuid) return REFUSED("noHolder");
  if (!placeUuid) return REFUSED("noPlace");
  const ops = [{ op: "addOccupant", place: placeUuid, actor: holderUuid }];
  for (const place of holdings ?? []) {
    if (place !== placeUuid) ops.push({ op: "removeOccupant", place, actor: holderUuid });
  }
  if (holderIsGroup && parentGroupUuid) ops.push({ op: "parent", uuid: holderUuid, parentUuid: "" });
  return { ok: true, ops };
}

/**
 * Recall a row's group: it goes back under the group its parent row holds and
 * comes off every roster. The group is put under its parent first, so it is never
 * in no place.
 *
 * @param {object} facts
 * @param {string} facts.holderUuid the row's group
 * @param {boolean} facts.holderIsGroup a lone actor stands inside no group
 * @param {string} facts.parentRowKey the row above it, blank for a top row
 * @param {string} facts.parentHolderUuid that row's holder, blank for an empty row
 * @param {boolean} facts.parentHolderIsGroup
 * @param {string[]} facts.holdings the places whose roster holds it now
 * @returns {{ok: boolean, reason?: "noHolder"|"notGroup"|"topRow"|"emptyParent"|"parentNotGroup", ops: object[]}}
 */
export function planRecall({ holderUuid, holderIsGroup, parentRowKey, parentHolderUuid, parentHolderIsGroup, holdings }) {
  if (!holderUuid) return REFUSED("noHolder");
  if (!holderIsGroup) return REFUSED("notGroup");
  if (!parentRowKey) return REFUSED("topRow");
  if (!parentHolderUuid) return REFUSED("emptyParent");
  if (!parentHolderIsGroup) return REFUSED("parentNotGroup");
  const ops = [{ op: "parent", uuid: holderUuid, parentUuid: parentHolderUuid }];
  for (const place of holdings ?? []) ops.push({ op: "removeOccupant", place, actor: holderUuid });
  return { ok: true, ops };
}

/* -------------------------------------------- */
/*  Which host answers                           */
/* -------------------------------------------- */

/**
 * The host that answers for a holder where several rows name it. A faction card
 * is affiliation and a group's own chart is the chart waiting to join one, so
 * between the two writes of a join or a leave the faction answers.
 * @param {{hostUuid: string, key: string, isGroup: boolean}[]} entries the rows naming the holder
 * @returns {{hostUuid: string, key: string, isGroup: boolean}|null}
 */
export function preferredHost(entries) {
  const list = entries ?? [];
  return list.find((e) => !e.isGroup) ?? list[0] ?? null;
}

/**
 * The rows that stand on more than one host, each key with the hosts holding it:
 * the twins a join or leave leaves between its two writes.
 * @param {{uuid: string, rows: object[]}[]} hosts
 * @returns {Map<string, string[]>}
 */
export function twinKeys(hosts) {
  const seen = new Map();
  for (const host of hosts ?? []) {
    for (const node of nodesOf(host.rows)) {
      if (!seen.has(node.key)) seen.set(node.key, []);
      seen.get(node.key).push(host.uuid);
    }
  }
  return new Map([...seen].filter(([, uuids]) => uuids.length > 1));
}

/* -------------------------------------------- */
/*  Leader and morale                            */
/* -------------------------------------------- */

/**
 * Is this officer up? Resolved, not marked dead and not at zero hit points. A
 * missing figure is no evidence of a fall, so only a read one counts against.
 * @param {object|null} actor the officer's actor, null where it does not resolve
 */
export function isOfficerUp(actor) {
  if (!actor) return false;
  const hp = actor.system?.hp?.value;
  if (typeof hp === "number" && hp <= 0) return false;
  return actor.statuses?.has?.(STATUS_DEAD) !== true;
}

/**
 * The morale part a unit takes from the units above it: the bonus of each
 * ancestor row's holder whose officer is up, summed. Walks the chart's own rows
 * whichever host holds them, so a chieftain's part reaches every gang under it
 * and is gone from all of them when the chieftain falls.
 *
 * @param {string} key the row whose group asks
 * @param {{key: string, parentKey: string, holderUuid: string}[]} nodes the chart
 * @param {(holderUuid: string) => {bonus: number|null, up: boolean}|null} read an ancestor holder's officer part and whether its officer is up
 * @returns {number}
 */
export function moraleFromAbove(key, nodes, read) {
  const byKey = new Map((nodes ?? []).map((n) => [n.key, n]));
  let sum = 0;
  for (const above of rowAncestors(key, nodes)) {
    const holder = byKey.get(above)?.holderUuid;
    const part = holder ? read(holder) : null;
    if (part?.up && Number.isFinite(part.bonus)) sum += part.bonus;
  }
  return sum;
}

/* -------------------------------------------- */
/*  Who a faction affiliates                     */
/* -------------------------------------------- */

/**
 * Everyone a faction affiliates, as one list of roster rows: its `members`, then
 * the holder of each chart row that no member row names. A stored member row wins
 * over a chart row for the same actor, so a hidden mark the Judge set on the
 * roster stands. A chart row's own `hidden` rides on the row it makes, and an
 * empty row affiliates nobody.
 *
 * @param {object[]} members stored roster rows
 * @param {object[]} units stored chart rows
 * @param {(uuid: string) => object|null} [resolve] a holder's actor, to drop one that no longer resolves
 * @returns {object[]} plain roster rows, `{uuid, name, kind, quantity, hidden, ...}`
 */
export function affiliationRows(members, units, resolve = null) {
  const out = (members ?? []).map((r) => structuredClone(r?.toObject?.() ?? r));
  const seen = new Set(out.map((r) => r.uuid));
  for (const raw of units ?? []) {
    const row = raw?.toObject?.() ?? raw;
    const uuid = row?.holderUuid;
    if (!uuid || seen.has(uuid)) continue;
    const actor = typeof resolve === "function" ? resolve(uuid) : null;
    if (typeof resolve === "function" && !actor) continue;
    seen.add(uuid);
    out.push({
      uuid,
      name: actor?.name ?? row.label ?? "",
      img: actor?.img ?? "",
      kind: OCCUPANT_KIND.ACTOR,
      quantity: 1,
      ownerUuid: "",
      notes: row.notes ?? "",
      hidden: !!row.hidden,
      derived: true,
    });
  }
  return out;
}

/* -------------------------------------------- */
/*  The two view models                          */
/* -------------------------------------------- */

/**
 * The org chart: the tree of a host's rows, each with its holder's live count, its
 * officer, whether it is empty and whether it is a twin. A holder that does not
 * resolve reads empty. A holder standing inside another row's group keeps its own
 * count and is marked `covered`, so the chart's total counts those bodies once.
 *
 * @param {object[]} rows the host's rows
 * @param {(holderUuid: string) => ({name: string, img: string, count: number, ancestors?: string[], officer?: {uuid: string, name: string, img: string}|null}|null)} read the holder as the world has it, null where it does not resolve
 * @param {Iterable<string>} [twins] keys standing on two hosts
 * @returns {{roots: object[], rows: object[], total: number, empty: number}} `rows` is the tree flattened in reading order
 */
export function orgChartView(rows, read, twins = []) {
  const nodes = nodesOf(rows);
  const stored = new Map(copyRows(rows).map((r) => [r.key, r]));
  const twin = new Set(twins);
  const heldBy = new Map();
  const info = new Map();
  for (const n of nodes) {
    const held = n.holderUuid ? read(n.holderUuid) : null;
    info.set(n.key, held);
    if (held) heldBy.set(n.holderUuid, n.key);
  }
  const children = new Map();
  for (const n of nodes) {
    if (!n.parentKey) continue;
    if (!children.has(n.parentKey)) children.set(n.parentKey, []);
    children.get(n.parentKey).push(n);
  }
  const flat = [];
  const visited = new Set();
  const build = (n, depth) => {
    visited.add(n.key);
    const held = info.get(n.key);
    const view = {
      key: n.key,
      parentKey: n.parentKey,
      label: n.label,
      kind: n.kind,
      holderUuid: n.holderUuid,
      notes: stored.get(n.key)?.notes ?? "",
      hidden: !!stored.get(n.key)?.hidden,
      depth,
      empty: !held,
      name: held?.name ?? n.label,
      img: held?.img ?? "",
      count: held ? Math.max(0, held.count ?? 0) : 0,
      covered: !!held && (held.ancestors ?? []).some((u) => heldBy.has(u)),
      officer: held?.officer ?? null,
      twin: twin.has(n.key),
      children: [],
    };
    flat.push(view);
    for (const child of children.get(n.key) ?? []) {
      if (!visited.has(child.key)) view.children.push(build(child, depth + 1));
    }
    return view;
  };
  const roots = rowRoots(nodes).map((n) => build(n, 0));
  return {
    roots,
    rows: flat,
    total: flat.reduce((sum, v) => sum + (v.covered ? 0 : v.count), 0),
    empty: flat.filter((v) => v.empty).length,
  };
}

/**
 * The locations view: for each place, the outermost groups on its roster, each with
 * the chart rows it holds or holds through a group inside it. A group whose
 * container is also on that roster keeps its row and is marked `covered`. A chart
 * row whose holder stands on no place is listed apart, since the chart records who
 * belongs and says nothing of where.
 *
 * @param {object} input
 * @param {{uuid: string, name: string, roster: {uuid: string}[]}[]} input.places each place with the actors on its roster
 * @param {{hostUuid: string, key: string, label: string, holderUuid: string}[]} input.rows every chart row, from every host
 * @param {(uuid: string) => ({name: string, img: string, count: number, ancestors?: string[], descendants?: string[]}|null)} input.read a rostered actor as the world has it, null where it does not resolve
 * @returns {{places: object[], unplaced: object[]}}
 */
export function locationsView({ places, rows, read }) {
  const chart = (rows ?? []).filter((r) => r?.holderUuid);
  const placed = new Set();
  const out = [];
  for (const place of places ?? []) {
    const onRoster = new Set((place.roster ?? []).map((r) => r.uuid));
    const groups = [];
    for (const entry of place.roster ?? []) {
      const held = read(entry.uuid);
      if (!held) continue;
      const within = new Set([entry.uuid, ...(held.descendants ?? [])]);
      for (const u of within) placed.add(u);
      groups.push({
        uuid: entry.uuid,
        name: held.name,
        img: held.img ?? "",
        count: Math.max(0, held.count ?? 0),
        covered: (held.ancestors ?? []).some((u) => onRoster.has(u)),
        rows: chart.filter((r) => within.has(r.holderUuid)).map((r) => ({ ...r, inside: r.holderUuid !== entry.uuid })),
      });
    }
    out.push({ uuid: place.uuid, name: place.name, groups, total: groups.reduce((n, g) => n + (g.covered ? 0 : g.count), 0) });
  }
  return { places: out, unplaced: chart.filter((r) => !placed.has(r.holderUuid)) };
}
