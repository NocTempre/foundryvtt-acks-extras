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
import { GROUP_LANG_PREFIX, LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { whisperJudges } from "./group-combat.mjs";
import { GROUP_ACTOR_TYPE, bodyCount, groupAncestors, groupDescendants, groupNodes, isGroupActor, worldGroups } from "./group-logic.mjs";
import { setParentGroup } from "./group.mjs";
import { chartRows, orgHostOf, orgHosts, unitsOf } from "./org-host.mjs";
import {
  chartToJoin, factionLine, locationsView, nodesOf, orgChartView, planAdd, planJoin, planLeave, planRecall, planRecallFollower, planSendOut, readableChartRows,
  rowAncestors, rowDescendants, twinKeys, withHolder,
} from "./org-tree-logic.mjs";
import { planUndo } from "./org-delete-logic.mjs";
import { runPlan } from "./org-run.mjs";
import { ORG_PROTOTYPE_FLAG, planDelete, planEdit, planUnlist } from "./org-write-logic.mjs";
import { addOccupant, isLocation, removeOccupant } from "./place.mjs";
import { docOf } from "./util.mjs";

export { chartRows, hostGenOf, moraleFromUnitsAbove, orgHostOf, orgHosts, registerOrgIndex, unitsOf } from "./org-host.mjs";
export { runPlan };
export { locationsView, orgChartView } from "./org-tree-logic.mjs";
export { ORG_GEN_FLAG, ORG_PROTOTYPE_FLAG, keySource, planAddUnit, planDelete, planEdit, planRoll, planUnlist } from "./org-write-logic.mjs";
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
      console.warn(`${MODULE_ID} | an organisation write failed`, err);
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
 * that needs a group never meets a refusal for an empty row. A seat that may not
 * create actors makes nothing and is answered `noCreate`, since core would throw.
 * @returns {Promise<{doc: Actor|null, made: boolean, reason?: "noCreate"}>}
 */
async function holderOf(host, row) {
  const held = row.holderUuid ? docOf(row.holderUuid) : null;
  if (held) return { doc: held, made: false };
  if (!game.user?.can?.("ACTOR_CREATE")) return { doc: null, made: false, reason: "noCreate" };
  const name = row.label || row.kind || game.i18n.localize(`${GROUP_LANG_PREFIX}.unit`);
  const doc = await Actor.implementation.create({ name, type: GROUP_ACTOR_TYPE });
  if (!doc) return { doc: null, made: false };
  await host.update({ "system.units": withHolder(unitsOf(host), row.key, doc.uuid) });
  return { doc, made: true };
}

/**
 * The group that holds a row, made and written to the row where it has none: what an
 * empty card's Edit opens on. Null where the host is no chart, the seat cannot write
 * it, or the row is not there.
 * @param {Actor} host
 * @param {string} key
 * @returns {Promise<Actor|null>}
 */
export async function ensureHolder(host, key) {
  if (!hostsChart(host) || !host.isOwner) return null;
  const row = rowOn(host, key);
  return row ? (await holderOf(host, row)).doc : null;
}

/** Does any body of this group stand on a map? */
const onMap = (group) => (group.system?.stacks ?? []).some((s) => (s.roster ?? []).some((m) => m.tokenUuid));

/** Does any group still standing name this actor as a stack's prototype or a stack's mount? */
function namedByAGroup(uuid) {
  return worldGroups().some((g) => (g.system?.stacks ?? []).some((s) => s.template?.uuid === uuid || s.gen?.mount?.uuid === uuid));
}

/** The prototypes a set of groups' stacks name, and the mounts they name, that this generator might have minted. */
const prototypeCandidates = (groups) => new Set(groups.flatMap((g) => (g.system?.stacks ?? []).flatMap((s) => [s.template?.uuid, s.gen?.mount?.uuid])).filter(Boolean));

/** Is this actor a prototype this generator minted? */
const isMinted = (doc) => !!doc?.flags?.[MODULE_ID]?.[ORG_PROTOTYPE_FLAG];

/** The officers of a set of groups, each once. */
const officersOf = (groups) => [...new Set(groups.map((g) => g.system?.unit?.officerUuid).filter(Boolean))];

/**
 * What a Delete of a row would take, read before it is made: the keys of the rows, the groups they
 * hold, the officers those groups name (which a Delete leaves in the world, and a caller may delete
 * after it), and the minted prototypes no group standing after the Delete would name. It writes
 * nothing, and `deleteRow` takes the same set.
 *
 * @param {Actor} host a faction or a group hosting a chart
 * @param {string} key the row
 * @returns {{ok: boolean, reason?: string, keys?: string[], groups?: Actor[], leaders?: string[], prototypes?: string[]}}
 */
export function deletePreview(host, key) {
  if (!hostsChart(host)) return refused("notHost");
  const plan = planDelete({ host, rows: unitsOf(host), key });
  if (!plan.ok) return refused(plan.reason);
  const groups = plan.holders.map((uuid) => docOf(uuid)).filter(isGroupActor);
  const going = new Set(groups.map((g) => g.uuid));
  const stays = (uuid) => worldGroups().some((g) => !going.has(g.uuid) && (g.system?.stacks ?? []).some((s) => s.template?.uuid === uuid || s.gen?.mount?.uuid === uuid));
  const prototypes = [...prototypeCandidates(groups)].filter((uuid) => isMinted(docOf(uuid)) && !stays(uuid));
  return { ok: true, keys: plan.keys, groups, leaders: officersOf(groups), prototypes };
}

/**
 * Copy what a Delete is about to take, for `undoDelete`: the host's rows, the faction's leader, and
 * each group, minted prototype and chosen linked actor as `toObject()` keeps it, and the roster rows
 * that hold the groups. Read before `deleteRow`, since nothing of it is readable after.
 *
 * @param {Actor} host
 * @param {{keys: string[], groups: Actor[], prototypes: string[]}} preview `deletePreview`'s answer
 * @param {string[]} [linked] the uuids of the linked actors the caller will delete after the Delete
 * @returns {{hostUuid: string, keys: string[], rows: object[], leaderUuid: string, actors: object[], groups: object[], rosters: {place: string, rows: object[]}[]}}
 */
export function deleteSnapshot(host, preview, linked = []) {
  const plain = (d) => d.toObject();
  const own = (uuid) => {
    const doc = docOf(uuid);
    return doc && doc.documentName === "Actor" && !doc.pack ? doc : null;
  };
  const rosters = new Map();
  for (const g of preview.groups) {
    for (const placeUuid of rostersHolding(g.uuid)) {
      const rows = (docOf(placeUuid)?.system?.roster ?? []).map((r) => r?.toObject?.() ?? r).filter((r) => r.uuid === g.uuid);
      rosters.set(placeUuid, [...(rosters.get(placeUuid) ?? []), ...structuredClone(rows)]);
    }
  }
  return {
    hostUuid: host.uuid,
    keys: [...preview.keys],
    rows: unitsOf(host).map((r) => structuredClone(r?.toObject?.() ?? r)),
    leaderUuid: host.system?.leaderUuid ?? "",
    actors: [...linked, ...preview.prototypes].map(own).filter(Boolean).map(plain),
    groups: preview.groups.map(plain),
    rosters: [...rosters].map(([place, rows]) => ({ place, rows })),
  };
}

/**
 * Undo a Delete from its snapshot: the actors and then the groups are re-created with their own ids
 * (the groups last, so a group's officer resolves), the host's rows are merged back (`planUndo`), the
 * faction's leader is restored where it is still blank, and the groups' roster rows are put back on
 * the places the seat owns. Refused before any write where the seat cannot create actors or write the host.
 *
 * @param {Actor} host
 * @param {object} snapshot `deleteSnapshot`'s answer
 * @returns {Promise<{ok: boolean, reason?: string, restored?: number}>}
 */
export async function undoDelete(host, snapshot) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  if (!game.user?.can?.("ACTOR_CREATE")) return refused("noCreate");
  let restored = 0;
  try {
    // An id still in the world was never deleted (a linked actor whose delete failed, a Delete that
    // stopped partway); re-creating it would collide, so only the gone ones come back.
    for (const all of [snapshot.actors, snapshot.groups]) {
      const batch = all.filter((d) => !game.actors?.has?.(d._id));
      if (!batch.length) continue;
      const made = await Actor.implementation.createDocuments(structuredClone(batch), { keepId: true });
      restored += made?.length ?? 0;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | a Delete could not be undone`, err);
    return refused("undoFailed");
  }
  const plan = planUndo({ snapshot, rows: unitsOf(host), leaderUuid: host.system?.leaderUuid ?? "" });
  await host.update({ "system.units": plan.rows, ...(plan.leader ? { "system.leaderUuid": plan.leader } : {}) });
  for (const { place: uuid, rows } of snapshot.rosters) {
    const place = docOf(uuid);
    if (!hasRoster(place) || !place.isOwner) continue;
    const held = (place.system.roster ?? []).map((r) => r?.toObject?.() ?? r);
    const missing = rows.filter((r) => !held.some((h) => h.uuid === r.uuid));
    if (missing.length) await place.update({ "system.roster": [...held, ...structuredClone(missing)] });
  }
  return { ok: true, restored };
}

/**
 * Delete a row of a chart: the row and every row beneath it, the group each holds,
 * and any prototype this generator minted that no remaining stack names. A group
 * comes off every roster that held it, and the faction's leader is cleared where it
 * was a deleted group's officer. The leaders themselves are actors of their own and
 * stay in the world; so does every actor the module did not mint. Bodies on a map
 * are a whisper to the Judges, never a refusal.
 *
 * @param {Actor} host a faction or a group hosting a chart
 * @param {string} key the row
 * @returns {Promise<{ok: boolean, reason?: string, rows?: string[], groups?: string[], prototypes?: string[], kept?: string[], leaders?: string[], warnings?: string[]}>}
 */
export async function deleteRow(host, key) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const plan = planDelete({ host, rows: unitsOf(host), key });
  if (!plan.ok) return refused(plan.reason);
  const groups = plan.holders.map((uuid) => docOf(uuid)).filter(isGroupActor);
  const foreign = groups.find((g) => !g.isOwner);
  if (foreign) return { ...refused("notOwner"), name: foreign.name ?? "" };

  const warnings = [];
  for (const g of groups) {
    if (!onMap(g)) continue;
    warnings.push("onMap");
    await whisperJudges(g, game.i18n.format(`${LANG_PREFIX}.org.delete.onMap`, { name: g.name }));
  }
  const leaders = officersOf(groups);
  const candidates = prototypeCandidates(groups);

  const update = { "system.units": plan.rows };
  if (host.system?.leaderUuid && leaders.includes(host.system.leaderUuid)) update["system.leaderUuid"] = "";
  await host.update(update);
  for (const g of groups) for (const place of rostersHolding(g.uuid)) await removeOccupant(docOf(place), g.uuid);
  for (const g of groups) await g.delete();

  const prototypes = [];
  const kept = [];
  for (const uuid of candidates) {
    const proto = docOf(uuid);
    if (!isMinted(proto)) continue;
    if (namedByAGroup(uuid)) kept.push(uuid);
    else {
      await proto.delete();
      prototypes.push(uuid);
    }
  }
  return { ok: true, rows: plan.keys, groups: groups.map((g) => g.uuid), prototypes, kept, leaders, warnings };
}

/**
 * Edit a filled row by hand: its label, note, kind and visibility go to the host's
 * row, a stack's count or prototype and the officer to the row's group. Bodies of the
 * group standing on a map keep the figures they went out with until they are recalled;
 * that is a whisper to the Judges and a `warnings` entry, never a refusal. Clearing the officer of
 * a faction host's own leader clears the host's `leaderUuid` in the same write.
 *
 * @param {Actor} host a faction or a group hosting a chart
 * @param {string} key the row
 * @param {{fields?: object, stacks?: {stack: string, count?: number, prototype?: string}[], officer?: {officer: string, moraleBonus?: number|null, leaderIfBlank?: boolean}}} [change] `leaderIfBlank` is `planEdit`'s: a faction's leader taken from a top row's new officer while the field is blank
 * @returns {Promise<{ok: boolean, reason?: string, warnings?: string[], done?: number}>}
 */
export async function editRow(host, key, { fields = {}, stacks = [], officer = null } = {}) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const row = rowOn(host, key);
  if (!row) return refused("noRow");
  const group = row.holderUuid ? docOf(row.holderUuid) : null;
  const isFaction = !isGroupActor(host);
  const plan = planEdit({
    host: { uuid: host.uuid, ...(isFaction ? { kind: "faction", leaderUuid: host.system?.leaderUuid ?? "" } : {}) }, rows: unitsOf(host), key, fields, stacks, officer,
    onMap: !!group && isGroupActor(group) && onMap(group), currentOfficer: isGroupActor(group) ? group.system?.unit?.officerUuid ?? "" : "",
  });
  if (!plan.ok) return refused(plan.reason);
  const run = await runPlan(plan);
  if (!run.ok) return { ok: false, reason: run.reason, ...(run.name ? { name: run.name } : {}), done: run.done };
  for (const warning of plan.warnings ?? []) {
    if (warning === "onMap" && group) await whisperJudges(group, game.i18n.format(`${LANG_PREFIX}.org.edit.onMap`, { name: group.name }));
  }
  return { ok: true, warnings: plan.warnings ?? [], done: run.done };
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
 * its group first, refused `noCreate` only for a seat that may not create actors.
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
  if (!place.isOwner) return refused("notOwner");
  const { doc, made, reason } = await holderOf(host, row);
  if (!doc) return refused(reason ?? "failed");
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

/**
 * Send a follower out to a place, keyed by the follower itself and not by a chart row: a
 * character's service tree has no rows to write through, so its follower (a lone actor or
 * a hired unit's group) is named by uuid and the seat's right to move it is its employer's
 * ownership. The shipped plan (`planSendOut`) and executor (`carryOut`) are `sendOut`'s,
 * so the place's roster is written first, every other roster lets the follower go, and a
 * group leaves the group it stood inside; the place's own ownership is checked before any
 * write. The employer's service does not change by where its follower stands.
 *
 * @param {Actor} employer the actor whose follower it is
 * @param {string} holderUuid the follower
 * @param {string} placeUuid a place with a stored roster
 * @returns {Promise<{ok: boolean, reason?: string, name?: string}>}
 */
export async function sendOutHolder(employer, holderUuid, placeUuid) {
  if (!employer?.isOwner) return { ...refused("notOwner"), name: employer?.name ?? "" };
  const holder = holderUuid ? docOf(holderUuid) : null;
  if (!holder) return refused("noHolder");
  const place = placeUuid ? docOf(placeUuid) : null;
  if (!hasRoster(place)) return refused("noPlace");
  return carryOut(planSendOut({
    holderUuid: holder.uuid,
    holderIsGroup: isGroupActor(holder),
    parentGroupUuid: holder.system?.unit?.parentGroupUuid ?? "",
    holdings: rostersHolding(holder.uuid),
    placeUuid: place.uuid,
  }));
}

/**
 * Recall a follower: it comes off every roster that holds it and stands with its employer
 * again (`planRecallFollower`). No group is written, since an employer is no group; a
 * follower on no roster is refused `notOut`. Keyed and gated as `sendOutHolder` is.
 *
 * @param {Actor} employer the actor whose follower it is
 * @param {string} holderUuid the follower
 * @returns {Promise<{ok: boolean, reason?: string, name?: string}>}
 */
export async function recallHolder(employer, holderUuid) {
  if (!employer?.isOwner) return { ...refused("notOwner"), name: employer?.name ?? "" };
  const holder = holderUuid ? docOf(holderUuid) : null;
  if (!holder) return refused("noHolder");
  return carryOut(planRecallFollower({ holderUuid: holder.uuid, holdings: rostersHolding(holder.uuid) }));
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

/**
 * Remove a row from a chart: it alone leaves the host's list, and no document is deleted. The
 * rows directly beneath it stay, lifted to its parent row or to the top, so the host is the only
 * document written and no group is moved or un-nested. Delete stays in this file as `deleteRow`.
 *
 * @param {Actor} host a faction or a group hosting a chart
 * @param {string} key the row to remove
 * @returns {Promise<{ok: boolean, reason?: string, removed?: {key: string, label: string}, under?: {key: string, label: string}|null, lifted?: {key: string, label: string}[]}>} `under` is the row the lifted rows now stand beneath, null for the top
 */
export async function unlistRow(host, key) {
  if (!hostsChart(host)) return refused("notHost");
  if (!host.isOwner) return refused("notOwner");
  const plan = planUnlist({ rows: unitsOf(host), key });
  if (!plan.ok) return refused(plan.reason);
  await host.update({ "system.units": plan.kept });
  return { ok: true, removed: plan.removed, under: plan.under, lifted: plan.lifted };
}

/* -------------------------------------------- */
/*  A group's own gestures                       */
/* -------------------------------------------- */

/** The faction actor sub-type, the one non-group host. */
const FACTION_TYPE = `${MODULE_ID}.faction`;

/** A group as the chart knows it: an unlinked token's actor is read as its base actor. */
const baseOf = (group) => (group?.isToken ? (group.baseActor ?? group) : group);

/**
 * The world's factions, in the order the world lists them: what a group may join.
 * @returns {Actor[]}
 */
export function worldFactions() {
  return [...(game.actors ?? [])].filter((a) => a?.documentName === "Actor" && a.type === FACTION_TYPE);
}

/**
 * What the faction line of a group's sheet shows: `state` (`joined`, `free` or
 * `hidden`, `org-tree-logic.mjs`'s `factionLine`), the faction that answers for a
 * joined group (or, for a free one, the faction a stopped join already wrote to),
 * and the group's row there. For a sheet to draw; it writes nothing.
 * @param {Actor} group
 * @returns {{state: "joined"|"free"|"hidden", faction: Actor|null, row: object|null}}
 */
export function factionLineOf(group) {
  const base = baseOf(group);
  if (!isGroupActor(base)) return { state: "hidden", faction: null, row: null };
  const found = orgHostOf(base.uuid);
  const hostIsFaction = !!found && !isGroupActor(found.host);
  const line = factionLine({
    ownRows: unitsOf(base).length > 0,
    nested: !!base.system?.unit?.parentGroupUuid,
    found: found ? { hostUuid: found.host.uuid, hostIsFaction } : null,
  });
  return { state: line.state, faction: line.hostUuid ? found.host : null, row: line.hostUuid ? found.row : null };
}

/**
 * Join a group to a faction: `join`, for a group that hosts rows or none. A group
 * with no rows joins as one row that holds itself, so a group standing alone can
 * be listed under a faction. Under Foundry's own permissions, as `join` is.
 *
 * @param {Actor} group
 * @param {Actor} faction
 * @param {string} [underKey] the faction's row the group's top row goes under, blank for the top
 * @returns {Promise<{ok: boolean, reason?: string, moved?: string[]}>}
 */
export async function joinFaction(group, faction, underKey = "") {
  const base = baseOf(group);
  if (!isGroupActor(base)) return refused("notGroup");
  if (!hostsChart(faction) || isGroupActor(faction)) return refused("notFaction");
  const rows = chartToJoin(unitsOf(base), { key: foundry.utils.randomID(), label: base.name ?? "", holderUuid: base.uuid });
  const plan = planJoin({ uuid: base.uuid, rows }, { uuid: faction.uuid, rows: unitsOf(faction) }, underKey);
  const result = await carryOut(plan);
  return plan.ok ? { ...result, moved: plan.moved } : result;
}

/**
 * Make a faction card of a group's own and join the group to it. The card is named
 * from the group and takes its picture, and its leader is the group's officer where one is set. A join
 * that refuses leaves the card made, and the result names it.
 *
 * @param {Actor} group
 * @returns {Promise<{ok: boolean, reason?: string, faction?: Actor, moved?: string[]}>}
 */
export async function makeFaction(group) {
  const base = baseOf(group);
  if (!isGroupActor(base)) return refused("notGroup");
  const leaderUuid = base.system?.unit?.officerUuid ?? "";
  let faction = null;
  try {
    faction = await Actor.implementation.create({
      name: base.name,
      type: FACTION_TYPE,
      ...(base.img ? { img: base.img } : {}),
      ...(leaderUuid ? { system: { leaderUuid } } : {}),
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | a faction card could not be made`, err);
  }
  if (!faction) return refused("notMade");
  return { ...(await joinFaction(base, faction)), faction };
}

/**
 * Take a joined group out of its faction: `leave` over the row that names it, which
 * moves its subtree onto it. Refuses with `noFaction` where no faction answers for it.
 * @param {Actor} group
 * @returns {Promise<{ok: boolean, reason?: string, moved?: string[], group?: Actor}>}
 */
export async function leaveFaction(group) {
  const base = baseOf(group);
  const found = base?.uuid ? orgHostOf(base.uuid) : null;
  if (!found || isGroupActor(found.host)) return refused("noFaction");
  return leave(found.host, found.row.key);
}

/* -------------------------------------------- */
/*  The two views                                */
/* -------------------------------------------- */

/**
 * A holder as the views read it: its name, art, live count, the groups it stands
 * inside and holds, its officer and the uuid its group names as officer (kept where the actor
 * no longer resolves). Null where it does not resolve.
 * @param {string} uuid
 * @param {object[]} nodes the world's group nodes, read once for a whole view
 */
export function readHolder(uuid, nodes) {
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
    officerUuid: group ? actor.system?.unit?.officerUuid ?? "" : "",
  };
}

/**
 * The org chart of a host: its rows as a tree, each with its holder's live count,
 * its officer, whether it is empty and whether it stands on two hosts. For a
 * sheet to draw; it writes nothing.
 * @param {Actor} host a faction or a group hosting a chart
 * @param {{isGM?: boolean}} [options] a reader who is no Judge is shown no hidden row
 * @returns {{roots: object[], rows: object[], total: number, empty: number}}
 */
export function orgChart(host, { isGM = !!game.user?.isGM } = {}) {
  const nodes = groupNodes();
  const twins = [...twinKeys(orgHosts().map((h) => ({ uuid: h.uuid, rows: unitsOf(h) })))]
    .filter(([, hosts]) => hosts.includes(host?.uuid))
    .map(([key]) => key);
  return orgChartView(unitsOf(host), (uuid) => readHolder(uuid, nodes), twins, { isGM });
}

/**
 * The places a Locations view reads: the world's locations that hold a roster, each with
 * the roster rows this reader may see (a row the roster marks hidden is a Judge's alone).
 * One reader for every view of the places, so none re-implements the hidden filter.
 * @param {{isGM?: boolean}} [options]
 * @returns {{uuid: string, name: string, roster: object[]}[]}
 */
export function placesOf({ isGM = !!game.user?.isGM } = {}) {
  return [...(game.actors ?? [])]
    .filter(isLocation)
    .map((place) => ({
      uuid: place.uuid,
      name: place.name ?? "",
      roster: (place.system?.roster ?? []).map((r) => r?.toObject?.() ?? r).filter((r) => isGM || !r.hidden),
    }))
    .filter((place) => place.roster.length);
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
  return locationsView({ places: placesOf({ isGM }), rows: readableChartRows(chartRows(), isGM), read: (uuid) => readHolder(uuid, nodes) });
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
