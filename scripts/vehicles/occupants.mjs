/**
 * Who is aboard a vehicle, assembled once. The attachment layer knows who
 * is bound and in what role; the capacity primitive knows what each
 * weighs. This module is the ONE place those join into the occupant list
 * every consumer reads (sheet, buckets, boarding, the formation's train).
 *
 * The team has two halves — abstract rows and real `draft` attachments;
 * `draftPullOf` sums both. See docs/vehicles/DECISIONS.md, "The team has two
 * halves: abstract rows, real attachments."
 */
import { attachedTo, attachmentOf } from "../lib/attachment.mjs";
import { borneBy6, borneWeight6 } from "../lib/capacity.mjs";
import { bodyCount } from "../lib/group-logic.mjs";
import { STONE } from "../lib/item-model.mjs";
import { abilityRank } from "../lib/capabilities.mjs";
import { DRAFT_KINDS } from "./vehicle-data.mjs";
import { draftPull, draftEquivalent } from "./vehicle-speed.mjs";
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
  if (stated && DRAFT_KINDS[stated]) return stated;
  return guessDraftKind(actor);
}

/**
 * Everyone attached to this vehicle, weighed and labelled: the single feeder
 * for the sheet, the hold, boarding and the formation's train. A
 * specific actor costs its true mass; the vehicle's printed per-head rate
 * is the UNNAMED abstraction only. Crew bodies never charge the hold (RR p.
 * 316), but a non-motive role's gear does (`gearStone`, `cargoGear: true`).
 * See docs/vehicles/DECISIONS.md, "Weights are true; the printed rate
 * prices the unnamed head."
 *
 * @param {Actor} vehicle
 * @returns {{actor, uuid, id, name, img, role, station, kind, bodies, stone,
 *   gearStone, cargoGear, qualified, proficient}[]}
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
        // Whether this body is a full hand at a motive bench; null where no
        // bench weighs it.
        proficient: handProficiency(actor, role, station, sys),
      };
    }),
  );
}

/**
 * Whether a vessel's crew member is a PROFICIENT hand — Seafaring at all
 * (RR ch. 7) — the question the speed derivation weighs a body by. It is not
 * the seat's qualification: an officer short of the rank their seat asks is
 * still a proficient sailor. Null off a vessel and at a non-motive row
 * (marines), where no bench weighs the body.
 */
export function handProficiency(actor, role, station, sys) {
  if (role !== "crew" || sys?.kind !== "sea") return null;
  if (!OFFICER_STATIONS.includes(station)) {
    const row = (sys?.crew?.roles ?? []).find((r, i) => stationKeyOf(r, i) === station);
    if (row && row.motive === false) return null;
  }
  return abilityRank(actor, "Seafaring", "kw:seafaring") >= 1;
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

/**
 * Whether this actor is qualified for the seat it occupies, or null when the
 * seat asks nothing (passengers, the team, cargo, non-motive crew such as
 * marines). RR ch. 3/7: Driving holds the reins; Seafaring rows or sails (an
 * unproficient body is weighed by the imported rate, stations.mjs
 * `unproficientHand`, and the chip's badge flags it); a captain's seat asks a
 * higher rank; a navigator needs Seafaring plus Navigation or Pathfinding.
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
    (sum, a) => sum + (draftEquivalent(draftKindOf(a)) ?? 0) * bodyCount(a),
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

const round2 = (n) => Math.round(n * 100) / 100;
