/* global fromUuid */
/**
 * Who is aboard a vehicle, assembled once.
 *
 * The attachment layer knows who is bound to the vehicle and in what role; the
 * capacity primitive knows what each of them weighs. This module is the ONE
 * place those two are joined into the occupant list every consumer reads — the
 * sheet, the buckets, boarding, the formation's train — so no surface
 * hand-rolls its own assembly and disagrees with another about who is aboard
 * or what they cost the hold.
 *
 * THE TEAM HAS TWO HALVES, on purpose. A row in `system.team.animals` with no
 * uuid is the ABSTRACT complement — "2 heavy horses" a Judge states without
 * minting two actor documents, exactly as unnamed passengers are a count. A
 * REAL animal in harness is a `draft` ATTACHMENT on the animal, no row at all.
 * `draftPullOf` sums both halves; rows that still carry a uuid (written by the
 * old drop handler) are honoured on read and converted to attachments by
 * `normalizeTeamRows` the next time the sheet renders for an owner.
 */
import { attachedTo, attachmentOf, attach } from "../lib/attachment.mjs";
import { borneBy6, borneWeight6 } from "../lib/capacity.mjs";
import { bodyCount } from "../lib/group-logic.mjs";
import { STONE } from "../lib/item-model.mjs";
import { abilityRank } from "../lib/capabilities.mjs";
import { DRAFT_EQUIVALENTS } from "./vehicle-data.mjs";
import { draftPull } from "./vehicle-speed.mjs";
import { stationKeyOf, OFFICER_STATIONS } from "./stations.mjs";

/** The attachment roles a vehicle seats, in the order a sheet shows them. */
export const OCCUPANT_ROLES = Object.freeze(["passenger", "crew", "draft", "cargo"]);

/**
 * What sort of draft animal a dropped actor is, read off its name. A guess the
 * Judge can correct — better than defaulting every ox to a heavy horse and
 * quietly overstating the team.
 */
export function guessDraftKind(doc) {
  const n = (doc?.name ?? "").toLowerCase();
  if (/\box\b|oxen|bullock/.test(n)) return "ox";
  if (/mule/.test(n)) return "mule";
  if (/donkey|ass\b|burro/.test(n)) return "donkey";
  if (/medium|light|riding/.test(n)) return "mediumHorse";
  return "heavyHorse";
}

/**
 * The draft equivalence class of an animal in harness: what its attachment
 * states (set when it was hitched or converted from a row), else the guess.
 */
export function draftKindOf(actor) {
  const stated = attachmentOf(actor)?.kind;
  if (stated && DRAFT_EQUIVALENTS[stated] != null) return stated;
  return guessDraftKind(actor);
}

/**
 * Everyone attached to this vehicle, weighed and labelled: the single feeder
 * for the sheet, `fillBuckets`, boarding and the formation's train.
 *
 * WEIGHTS ARE TRUE (owner ruling, DECISIONS 2026-08-28): a specific actor
 * costs its specific mass — body (or bodies, for a stack) plus what it
 * actually carries. The vehicle's printed per-head rate is the UNNAMED
 * abstraction only, never a floor or a surcharge on a real actor. Crew
 * bodies never charge the hold (RR p. 316), but a NON-MOTIVE role's gear
 * does — the marines rule — so those occupants carry `gearStone` with
 * `cargoGear: true` and the buckets charge it.
 *
 * @param {Actor} vehicle
 * @returns {{actor, uuid, id, name, img, role, station, kind, bodies, stone,
 *   gearStone, cargoGear, qualified}[]}
 */
export function occupantsOf(vehicle) {
  const sys = vehicle?.system;
  return OCCUPANT_ROLES.flatMap((role) =>
    attachedTo(vehicle, role).map((actor) => {
      const at = attachmentOf(actor);
      const station = at?.station ?? null;
      const cargoGear = role === "crew" && isNonMotiveStation(sys, station);
      return {
        actor,
        uuid: actor.uuid,
        id: actor.id,
        name: actor.name,
        img: actor.img,
        role,
        station,
        kind: role === "draft" ? draftKindOf(actor) : null,
        bodies: bodyCount(actor),
        stone: round2(borneBy6(actor) / STONE),
        // The marines rule: bodies on deck are free, their arms are freight.
        gearStone: cargoGear ? round2(borneWeight6(actor) / STONE) : 0,
        cargoGear,
        // true / false / null — null means the seat asks no qualification.
        qualified: seatQualification(actor, role, station, sys),
      };
    }),
  );
}

/**
 * Whether a crew station is a NON-MOTIVE seat (marines): its row says
 * `motive: false`. Officer seats and stations matching no row are motive —
 * they work the vessel, and their gear rides free with them.
 */
function isNonMotiveStation(sys, station) {
  if (sys?.kind !== "sea") return false;
  if (OFFICER_STATIONS.includes(station)) return false;
  const row = (sys?.crew?.roles ?? []).find((r, i) => stationKeyOf(r, i) === station);
  return !!row && row.motive === false;
}

/* -------------------------------------------------------------------- */
/*  Qualifications                                                      */
/* -------------------------------------------------------------------- */

/** Rank counting is the capability module's question now; re-exported so the
 *  published vehicles surface keeps its shape. */
export { abilityRank } from "../lib/capabilities.mjs";

/**
 * Whether this actor is qualified for the seat it occupies, or null when the
 * seat asks nothing (passengers, the team, cargo, non-motive crew such as
 * marines). RR ch. 3/7: Driving holds the reins; Seafaring 1 rows or sails
 * (an unproficient body counts as HALF a hand — the badge's meaning);
 * Seafaring 2 captains; a navigator needs Seafaring plus Navigation or
 * Pathfinding.
 */
export function seatQualification(actor, role, station, sys) {
  if (role !== "crew") return null;
  if (sys?.kind !== "sea") {
    return abilityRank(actor, "Driving", "kw:driving") > 0;
  }
  if (station === "captain") return abilityRank(actor, "Seafaring", "kw:seafaring") >= 2;
  if (station === "navigator") {
    const seafaring = abilityRank(actor, "Seafaring", "kw:seafaring") >= 1;
    const charts = abilityRank(actor, "Navigation", "kw:navigation") > 0 || abilityRank(actor, "Pathfinding", "kw:pathfinding") > 0;
    return seafaring && charts;
  }
  // A named hand at a NON-motive row (marines) is not asked for Seafaring.
  const row = (sys?.crew?.roles ?? []).find((r, i) => stationKeyOf(r, i) === station);
  if (row && row.motive === false) return null;
  return abilityRank(actor, "Seafaring", "kw:seafaring") >= 1;
}

/**
 * What the NAMED crew supply of the vehicle's typed skill statements, with
 * provenance — so the sheet can show "Seafaring 3, from Aella" beside the
 * typed rank. The typed fields remain the ABSTRACT crew's statement and stay
 * authoritative for the derivations; this names what the real people aboard
 * would justify.
 */
export function derivedSkills(vehicle) {
  const crew = attachedTo(vehicle, "crew");
  let seafaring = { rank: 0, from: null };
  let driving = { has: false, from: null };
  let charts = { has: false, from: null };
  for (const actor of crew) {
    const s = abilityRank(actor, "Seafaring", "kw:seafaring");
    if (s > seafaring.rank) seafaring = { rank: Math.min(3, s), from: actor.name };
    if (!driving.has && abilityRank(actor, "Driving", "kw:driving") > 0) driving = { has: true, from: actor.name };
    if (!charts.has && (abilityRank(actor, "Navigation", "kw:navigation") > 0 || abilityRank(actor, "Pathfinding", "kw:pathfinding") > 0)) {
      charts = { has: true, from: actor.name };
    }
  }
  return { seafaring, driving, charts };
}

/** Officer stations, re-exported where the sheet builds its drop routing. */
export { OFFICER_STATIONS };

/** Heavy-horse equivalents contributed by REAL animals in harness. A stack
 *  of four oxen pulls as four — every living body counts. */
export function attachedDraftPull(vehicle) {
  return attachedTo(vehicle, "draft").reduce(
    (sum, a) => sum + (DRAFT_EQUIVALENTS[draftKindOf(a)] ?? 0) * bodyCount(a),
    0,
  );
}

/**
 * The whole team's pull: the abstract rows plus every real animal in harness.
 * This is the figure `landSpeed` wants (pass it as `{pull}`) — the pure
 * arithmetic cannot see attachments, and must not learn to.
 */
export function draftPullOf(vehicle) {
  return draftPull(vehicle?.system) + attachedDraftPull(vehicle);
}

/**
 * Convert team rows that point at a real actor into draft attachments.
 *
 * Lazy, per vehicle, idempotent: called on sheet render, it moves each
 * uuid-bearing row onto the animal itself (keeping the row's corrected kind)
 * and drops the row. A row standing for more than one animal leaves the
 * remainder behind as an abstract row. Rows it cannot convert — the actor is
 * gone, unowned, or the attach is refused — stay rows and read as they always
 * did. Rows marked not-pulling stay rows too: an attachment has no idle state
 * yet, and a lame horse must not silently resume pulling by being converted.
 *
 * @returns {Promise<boolean>} whether anything changed
 */
export async function normalizeTeamRows(vehicle) {
  if (!vehicle?.isOwner) return false;
  const rows = vehicle?.system?.team?.animals ?? [];
  if (!rows.some((r) => r.uuid && r.pulling !== false)) return false;
  const keep = [];
  let changed = false;
  for (const row of rows) {
    if (!row.uuid || row.pulling === false) {
      keep.push(row);
      continue;
    }
    const actor = await fromUuid(row.uuid).catch(() => null);
    if (!actor || actor.documentName !== "Actor" || !actor.isOwner) {
      keep.push(row);
      continue;
    }
    const kind = DRAFT_EQUIVALENTS[row.kind] != null ? row.kind : null;
    const res = await attach(actor, vehicle, "draft", { kind });
    if (!res.ok) {
      keep.push(row);
      continue;
    }
    changed = true;
    const count = Math.max(1, Number(row.count) || 1);
    // The actor stands for ONE animal; a row that said three leaves two
    // abstract ones behind rather than quietly shrinking the team.
    if (count > 1) keep.push({ ...row, uuid: "", name: "", count: count - 1 });
  }
  if (changed) await vehicle.update({ "system.team.animals": keep });
  return changed;
}

const round2 = (n) => Math.round(n * 100) / 100;
