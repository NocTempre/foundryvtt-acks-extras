/* global game, foundry, Actor, fromUuid */
/**
 * The organisation chart's writes and the views over it (docs/lib/ORGANISATION.md):
 * add a row, fill one, send a row's group out to a place and recall it, join a
 * group's chart to a faction's and let a subtree leave. The decisions are
 * `org-tree-logic.mjs`'s ordered plans; this file reads the documents they name,
 * checks the seat may write each one, and carries the plan out in its order.
 *
 * Affiliation (`units`) never changes by where a group stands: a send out writes a
 * place's roster and a group's parent, and the chart does not move. A press is a
 * control, not a gate: the only refusals are a write nothing can make (a row that
 * is not there, a place with no roster, a seat that cannot write a document) and
 * each is a `reason`, never a throw.
 *
 * These operations write documents on the calling client under Foundry's own
 * permissions; a consumer needing GM-routed writes wraps them.
 */
import { GROUP_LANG_PREFIX } from "./constants.mjs";
import { bodyCount, groupAncestors, groupDescendants, groupNodes, isGroupActor } from "./group-logic.mjs";
import { setParentGroup } from "./group.mjs";
import { chartRows, orgHostOf, orgHosts, unitsOf } from "./org-host.mjs";
import {
  locationsView, nodesOf, orgChartView, planAdd, planJoin, planLeave, planRecall, planSendOut, rowAncestors, rowDescendants, twinKeys,
  withHolder,
} from "./org-tree-logic.mjs";
import { addOccupant, isLocation, removeOccupant } from "./place.mjs";
import { docOf } from "./util.mjs";

export { chartRows, moraleFromUnitsAbove, orgHostOf, orgHosts, registerOrgIndex, unitsOf } from "./org-host.mjs";
export {
  affiliationRows, isEmptyRow, nodesOf, rowAncestors, rowDescendants, rowRoots, subtreeKeys, twinKeys,
} from "./org-tree-logic.mjs";

/** A refusal: nothing was written. */
const refused = (reason) => ({ ok: false, reason });

/** Does this actor host a chart? A faction or a group, by the list it carries. */
const hostsChart = (doc) => doc?.documentName === "Actor" && Array.isArray(doc.system?.units);

/** The row of a host by key, as a plain copy, or null. */
const rowOn = (host, key) => unitsOf(host).find((r) => r.key === key) ?? null;

/** A place that carries a stored roster. */
const hasRoster = (doc) => !!doc && Array.isArray(doc.system?.roster);

/* -------------------------------------------- */
/*  Carrying a plan out                          */
/* -------------------------------------------- */

/**
 * The documents a plan writes, each resolved once, or the reason it cannot be
 * carried out. A document the seat cannot write refuses the whole plan before any
 * write is made.
 */
async function resolveOps(ops) {
  const docs = new Map();
  const need = async (uuid) => {
    if (!docs.has(uuid)) docs.set(uuid, (await fromUuid(uuid).catch(() => null)) ?? null);
    return docs.get(uuid);
  };
  for (const op of ops) {
    const writes = op.op === "update" ? op.uuid : op.op === "parent" ? op.uuid : op.place;
    const target = await need(writes);
    if (!target) return { reason: "missing" };
    if (!target.isOwner) return { reason: "notOwner", name: target.name ?? "" };
    if (op.actor && !(await need(op.actor))) return { reason: "missing" };
  }
  return { docs };
}

/**
 * Carry a plan's ops out one at a time, in order, each read against what the one
 * before it wrote. A write that fails stops the run, and what already landed
 * stands: the plans order their writes so that is a row on two hosts or a group
 * in two places, never one that is nowhere.
 * @returns {Promise<{ok: boolean, reason?: string, name?: string, done?: number}>}
 */
async function carryOut(plan) {
  if (!plan.ok) return plan;
  const { docs, reason, name } = await resolveOps(plan.ops);
  if (reason) return { ok: false, reason, ...(name ? { name } : {}) };
  let done = 0;
  for (const op of plan.ops) {
    try {
      if (op.op === "update") {
        await docs.get(op.uuid).update(op.update);
      } else if (op.op === "addOccupant") {
        const place = docs.get(op.place);
        await addOccupant(place, docs.get(op.actor));
        if (!(place.system.roster ?? []).some((r) => r.uuid === op.actor)) return { ok: false, reason: "failed", done };
      } else if (op.op === "removeOccupant") {
        await removeOccupant(docs.get(op.place), op.actor);
      } else if (op.op === "parent") {
        const result = await setParentGroup(docs.get(op.uuid), op.parentUuid);
        if (!result.ok && result.reason !== "same") return { ok: false, reason: result.reason, done };
      }
    } catch (err) {
      console.warn("acks-extras | an organisation write failed", err);
      return { ok: false, reason: "failed", done };
    }
    done++;
  }
  return { ok: true, done };
}

/* -------------------------------------------- */
/*  Rows                                         */
/* -------------------------------------------- */

/**
 * Add an empty row under any row of any chart, or at the top of one. An empty row
 * is an open slot: it waits to be rolled or filled by hand, and a chart with
 * empty rows is finished.
 *
 * @param {Actor} host a faction or a group hosting a chart
 * @param {string} parentKey the row it goes under, blank for the top
 * @param {{label?: string, kind?: string, notes?: string}} [fields]
 * @returns {Promise<{ok: boolean, key?: string, reason?: string}>}
 */
export async function addRow(host, parentKey, fields = {}) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const plan = planAdd(unitsOf(host), parentKey ?? "", foundry.utils.randomID(), fields);
  if (!plan.ok) return refused(plan.reason);
  await host.update({ "system.units": plan.rows });
  return { ok: true, key: plan.key };
}

/**
 * Name the actor that holds a row's bodies, or empty the row with a blank uuid.
 * @param {Actor} host
 * @param {string} key
 * @param {string} holderUuid a group's uuid, or a lone actor's
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function setHolder(host, key, holderUuid) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  if (!rowOn(host, key)) return refused("noRow");
  if (holderUuid && !docOf(holderUuid)) return refused("missing");
  await host.update({ "system.units": withHolder(unitsOf(host), key, holderUuid) });
  return { ok: true };
}

/**
 * The group that holds a row: its holder where one resolves, else a new empty
 * group named from the row and written to the row as its holder, so the press
 * that needs a group never meets a refusal for an empty row.
 * @returns {Promise<{doc: Actor|null, made: boolean}>}
 */
async function holderOf(host, row) {
  const held = row.holderUuid ? docOf(row.holderUuid) : null;
  if (held) return { doc: held, made: false };
  const name = row.label || row.kind || game.i18n.localize(`${GROUP_LANG_PREFIX}.unit`);
  const doc = await Actor.implementation.create({ name, type: "acks-extras.group" });
  if (!doc) return { doc: null, made: false };
  await host.update({ "system.units": withHolder(unitsOf(host), row.key, doc.uuid) });
  return { doc, made: true };
}

/* -------------------------------------------- */
/*  Where things are                             */
/* -------------------------------------------- */

/** Every location whose stored roster holds this actor, by uuid. */
export function rostersHolding(uuid) {
  const actors = game.actors;
  if (!uuid || typeof actors?.[Symbol.iterator] !== "function") return [];
  return [...actors].filter((a) => isLocation(a) && (a.system?.roster ?? []).some((r) => r.uuid === uuid)).map((a) => a.uuid);
}

/**
 * Send a row's group out to a place. The place's roster is written first, then the
 * group leaves the group it stood inside, and any other roster that held it lets it
 * go. The row's own place in the chart does not change. An empty row's press makes
 * its group first, and nothing refuses it.
 *
 * @param {Actor} host the faction or group hosting the row
 * @param {string} key the row
 * @param {string} placeUuid a place with a stored roster
 * @returns {Promise<{ok: boolean, reason?: string, group?: Actor, made?: boolean}>} `made` is true where the press made the row's group
 */
export async function sendOut(host, key, placeUuid) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const row = rowOn(host, key);
  if (!row) return refused("noRow");
  const place = placeUuid ? docOf(placeUuid) : null;
  if (!hasRoster(place)) return refused("noPlace");
  const { doc, made } = await holderOf(host, row);
  if (!doc) return refused("failed");
  const plan = planSendOut({
    holderUuid: doc.uuid,
    holderIsGroup: isGroupActor(doc),
    parentGroupUuid: doc.system?.unit?.parentGroupUuid ?? "",
    holdings: rostersHolding(doc.uuid),
    placeUuid: place.uuid,
  });
  const result = await carryOut(plan);
  return { ...result, group: doc, made };
}

/**
 * Recall a row's group: it goes back under the group its parent row holds and comes
 * off every roster that held it. A top row, an empty parent row and a holder that is
 * no group have no group to go back under, and the press says so.
 *
 * @param {Actor} host
 * @param {string} key
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function recall(host, key) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const row = rowOn(host, key);
  if (!row) return refused("noRow");
  const holder = row.holderUuid ? docOf(row.holderUuid) : null;
  const parent = row.parentKey ? rowOn(host, row.parentKey) : null;
  const parentHolder = parent?.holderUuid ? docOf(parent.holderUuid) : null;
  const plan = planRecall({
    holderUuid: holder?.uuid ?? "",
    holderIsGroup: isGroupActor(holder),
    parentRowKey: parent?.key ?? "",
    parentHolderUuid: parentHolder?.uuid ?? "",
    parentHolderIsGroup: isGroupActor(parentHolder),
    holdings: holder ? rostersHolding(holder.uuid) : [],
  });
  return carryOut(plan);
}

/* -------------------------------------------- */
/*  Join and leave                               */
/* -------------------------------------------- */

/**
 * Join a group's chart to a faction's, under a row of it or at its top. The
 * faction is written first and the group's rows are cleared after, every key as it
 * was. Between the two writes a row stands on both hosts and the faction answers; a
 * second press completes the move and writes no row twice. After it the group's
 * chart is the faction's rows beneath the group's row, with no copy.
 *
 * @param {Actor} group the group hosting a chart
 * @param {Actor} faction the faction joined
 * @param {string} [underKey] the faction's row the group's top row goes under
 * @returns {Promise<{ok: boolean, reason?: string, moved?: string[]}>}
 */
export async function join(group, faction, underKey = "") {
  if (!isGroupActor(group)) return refused("notGroup");
  if (!hostsChart(faction) || isGroupActor(faction)) return refused("notFaction");
  const plan = planJoin({ uuid: group.uuid, rows: unitsOf(group) }, { uuid: faction.uuid, rows: unitsOf(faction) }, underKey);
  const result = await carryOut(plan);
  return plan.ok ? { ...result, moved: plan.moved } : result;
}

/**
 * Take a subtree out of a faction's chart onto the group holding its top row, which
 * hosts it from then on. The group is written first and the faction drops the
 * subtree after, every key as it was; a second press completes the move. An empty
 * top row's press makes its group first.
 *
 * @param {Actor} faction
 * @param {string} key the subtree's top row
 * @returns {Promise<{ok: boolean, reason?: string, moved?: string[], group?: Actor}>}
 */
export async function leave(faction, key) {
  if (!hostsChart(faction) || isGroupActor(faction)) return refused("notFaction");
  if (!faction.isOwner) return refused("notOwner");
  const row = rowOn(faction, key);
  if (!row) return refused("noRow");
  const { doc } = await holderOf(faction, row);
  if (!isGroupActor(doc)) return refused("holderNotGroup");
  const plan = planLeave({ uuid: faction.uuid, rows: unitsOf(faction) }, key, { uuid: doc.uuid, rows: unitsOf(doc) });
  const result = await carryOut(plan);
  return plan.ok ? { ...result, moved: plan.moved, group: doc } : result;
}

/* -------------------------------------------- */
/*  The two views                                */
/* -------------------------------------------- */

/**
 * A holder as the views read it: its name, art, live count, the groups it stands
 * inside and holds, and its officer. Null where it does not resolve.
 * @param {string} uuid
 * @param {object[]} nodes the world's group nodes, read once for a whole view
 */
function readHolder(uuid, nodes) {
  const actor = docOf(uuid);
  if (!actor) return null;
  const group = isGroupActor(actor);
  const officer = group ? docOf(actor.system?.unit?.officerUuid) : null;
  return {
    name: actor.name ?? "",
    img: actor.img ?? "",
    count: bodyCount(actor, group ? nodes : null),
    ancestors: group ? groupAncestors(actor, nodes) : [],
    descendants: group ? groupDescendants(actor, nodes) : [],
    officer: officer ? { uuid: officer.uuid, name: officer.name ?? "", img: officer.img ?? "" } : null,
  };
}

/**
 * The org chart of a host: its rows as a tree, each with its holder's live count,
 * its officer, whether it is empty and whether it stands on two hosts. For a
 * sheet to draw; it writes nothing.
 * @param {Actor} host a faction or a group hosting a chart
 * @returns {{roots: object[], rows: object[], total: number, empty: number}}
 */
export function orgChart(host) {
  const nodes = groupNodes();
  const twins = [...twinKeys(orgHosts().map((h) => ({ uuid: h.uuid, rows: unitsOf(h) })))]
    .filter(([, hosts]) => hosts.includes(host?.uuid))
    .map(([key]) => key);
  return orgChartView(unitsOf(host), (uuid) => readHolder(uuid, nodes), twins);
}

/**
 * The locations view: every place's outermost groups with the chart rows they hold,
 * and the rows whose holder stands on no place. Places are the world's locations and
 * their stored rosters; a row the roster marks hidden is a Judge's alone.
 * @param {{isGM?: boolean}} [options]
 * @returns {{places: object[], unplaced: object[]}}
 */
export function locations({ isGM = !!game.user?.isGM } = {}) {
  const nodes = groupNodes();
  const places = [...(game.actors ?? [])]
    .filter(isLocation)
    .map((place) => ({
      uuid: place.uuid,
      name: place.name ?? "",
      roster: (place.system?.roster ?? []).map((r) => r?.toObject?.() ?? r).filter((r) => isGM || !r.hidden),
    }))
    .filter((place) => place.roster.length);
  return locationsView({ places, rows: chartRows(), read: (uuid) => readHolder(uuid, nodes) });
}

/**
 * The host and row a holder stands on, with the rows above it nearest first and the
 * rows beneath it: what a group's own sheet draws as its chart once it has joined a
 * faction, read from the faction's rows with no copy.
 * @param {Actor} holder
 * @returns {{host: Actor, row: object, above: string[], below: string[]}|null}
 */
export function chartOf(holder) {
  const found = holder?.uuid ? orgHostOf(holder.uuid) : null;
  if (!found) return null;
  const nodes = nodesOf(unitsOf(found.host));
  const keys = new Set(nodes.map((n) => n.key));
  return {
    host: found.host,
    row: found.row,
    above: rowAncestors(found.row.key, nodes).filter((k) => keys.has(k)),
    below: rowDescendants(found.row.key, nodes),
  };
}
