/* global Hooks */
/**
 * The world's reading of the organisation chart (docs/lib/ORGANISATION.md): which
 * actors host a chart, the one reader `orgHostOf` that answers which host and row a
 * holder stands on, and the morale part a group takes from the units above it.
 * Reads only, and loads under the group data model, so it imports nothing that
 * writes (`org.mjs` is the writer) and nothing that imports the group's model.
 */
import { MODULE_ID } from "./constants.mjs";
import { isGroupActor } from "./group-logic.mjs";
import { isOfficerUp, moraleFromAbove, nodesOf, preferredHost } from "./org-tree-logic.mjs";
import { ORG_GEN_FLAG } from "./org-write-logic.mjs";
import { docOf } from "./util.mjs";

/** The rows an actor hosts, as plain objects: a faction's or a group's `units`. */
export function unitsOf(host) {
  const list = host?.system?.units;
  return Array.isArray(list) ? list.map((r) => structuredClone(r?.toObject?.() ?? r)) : [];
}

/**
 * The record a Roll whose top unit is the host left on it (`ORG_GEN_FLAG`): the template, variant, rules,
 * trait, tier and leader role a top unit's row would have carried. A plain copy, or null where the host
 * holds none.
 * @param {Actor|null|undefined} host
 * @returns {object|null}
 */
export function hostGenOf(host) {
  const gen = host?.flags?.[MODULE_ID]?.[ORG_GEN_FLAG];
  return gen && typeof gen === "object" ? structuredClone(gen) : null;
}

/** Every world actor holding at least one chart row, a faction or a group alike. */
export function orgHosts() {
  const actors = globalThis.game?.actors;
  return typeof actors?.[Symbol.iterator] === "function" ? [...actors].filter((a) => unitsOf(a).length > 0) : [];
}

/**
 * Every chart row on every host, flat, in the shape the locations view reads.
 * @returns {{hostUuid: string, key: string, parentKey: string, label: string, holderUuid: string, hidden: boolean}[]}
 */
export function chartRows() {
  return orgHosts().flatMap((host) => unitsOf(host).map((r) => ({
    hostUuid: host.uuid, key: r.key, parentKey: r.parentKey ?? "", label: r.label ?? "", holderUuid: r.holderUuid ?? "", hidden: !!r.hidden,
  })));
}

/* -------------------------------------------- */
/*  The reverse index                            */
/* -------------------------------------------- */

/**
 * holder uuid → the rows naming it, `{hostUuid, key}`. A CACHE, never truth: every
 * hit is read again against the host's own rows and the holder itself, so a stale
 * index costs a wasted lookup and never a wrong answer. Dropped whole whenever a
 * chart may have changed, and rebuilt on the next read.
 */
let index = null;

function buildIndex() {
  const map = new Map();
  for (const host of orgHosts()) {
    for (const row of unitsOf(host)) {
      if (!row.key || !row.holderUuid) continue;
      if (!map.has(row.holderUuid)) map.set(row.holderUuid, []);
      map.get(row.holderUuid).push({ hostUuid: host.uuid, key: row.key });
    }
  }
  return map;
}

const invalidate = () => {
  index = null;
};

/**
 * The host and row a holder stands on. Reads affiliation and never location: a
 * group on a map or inside another group answers by the chart that names it. A
 * holder the world no longer answers for reads empty, and so does a host that is
 * gone. Where a row stands on two hosts, between the two writes of a join or a
 * leave, the faction answers.
 *
 * @param {string} holderUuid a group's uuid, or a lone actor's
 * @returns {{host: Actor, row: object}|null} the host actor and a plain copy of the row, null where no chart names it
 */
export function orgHostOf(holderUuid) {
  if (!holderUuid || !docOf(holderUuid)) return null;
  index ??= buildIndex();
  const live = [];
  for (const hit of index.get(holderUuid) ?? []) {
    const host = docOf(hit.hostUuid);
    const row = host ? unitsOf(host).find((r) => r.key === hit.key && r.holderUuid === holderUuid) : null;
    if (row) live.push({ ...hit, host, row, isGroup: isGroupActor(host) });
  }
  const chosen = preferredHost(live);
  return chosen ? { host: chosen.host, row: chosen.row } : null;
}

/**
 * Keep the index honest. Registered once by lib's module.mjs: an actor created or
 * deleted, or updated in its `units`, drops the index. A holder or a host deleted
 * between two drops reads empty through the verification `orgHostOf` does.
 */
export function registerOrgIndex() {
  Hooks.on("createActor", invalidate);
  Hooks.on("deleteActor", invalidate);
  Hooks.on("updateActor", (_actor, changed) => {
    if (changed?.system && "units" in changed.system) invalidate();
  });
}

/* -------------------------------------------- */
/*  Leader and morale                            */
/* -------------------------------------------- */

/**
 * The morale part a group takes from the units above it in whichever chart holds
 * its row: each ancestor row's holder group contributes its officer's morale part
 * while that officer is up (resolved, above zero hit points, not marked dead). A
 * group no chart names, or one with nothing above it, takes none. A group's own
 * officer is `commandMorale`'s own term and is not read here.
 *
 * @param {Actor|null} group the group asking; an unlinked token's actor is read as its base actor
 * @returns {number}
 */
export function moraleFromUnitsAbove(group) {
  const owner = group?.isToken ? (group.baseActor ?? group) : group;
  const found = owner?.uuid ? orgHostOf(owner.uuid) : null;
  if (!found) return 0;
  return moraleFromAbove(found.row.key, nodesOf(unitsOf(found.host)), (holderUuid) => {
    const holder = docOf(holderUuid);
    if (!isGroupActor(holder)) return null;
    const unit = holder.system?.unit;
    return { bonus: unit?.officerMoraleBonus ?? null, up: isOfficerUp(docOf(unit?.officerUuid)) };
  });
}
