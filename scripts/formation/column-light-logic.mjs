/**
 * Which lights the marching column sheds, and from where: one point per bearer
 * still inside the party token who sheds light, at the centre of the bearer's
 * own place in the column (the point its first body stands on).
 *
 * Pure: it reads the formation record and the light table, and takes the
 * column's points from `columnFor` and a member's effect light from the
 * caller. Radii are FEET, the stronger of the bearer's flames (`emittedLight`)
 * and their effect light (`extraOf`), with the kind that won (`mergeLight`) so
 * the drawing can pick the look. A bearer whose sources shed nothing (doused,
 * shuttered, no reach imported, no effect light) gives no point. A bearer who
 * has deployed or detached carries their light on their own token instead.
 */
import { emittedLight, mergeLight } from "../lib/light.mjs";
import { memberCells } from "./column.mjs";
import { isMemberDeployed } from "./deployment.mjs";

/**
 * @param {object} formation the record (members and lights)
 * @param {{x: number, y: number}[]} points `columnFor(...).points`: the centre of
 *   every body of the formation
 * @param {(actorId: string) => {bright: number, dim: number}|null} [extraOf]
 *   a member's effect light in feet, or nothing when the caller has none
 * @returns {{bearerId: string, x: number, y: number, bright: number, dim: number, kind: "flame"|"magic"}[]}
 */
export function columnLights(formation, points, extraOf = null) {
  const placed = memberCells(formation, points);
  const out = [];
  const seen = new Set();
  (formation?.members ?? []).forEach((member, index) => {
    const bearerId = member?.actorId;
    if (!bearerId || member.blank || seen.has(bearerId) || isMemberDeployed(member)) return;
    seen.add(bearerId);
    const own = (formation.lights ?? []).filter((l) => l?.bearerId === bearerId);
    const { bright, dim, kind } = mergeLight(emittedLight(own), extraOf?.(bearerId));
    const point = placed[index]?.[0];
    if (!point || (!(bright > 0) && !(dim > 0))) return;
    out.push({ bearerId, x: point.x, y: point.y, bright, dim, kind });
  });
  return out;
}
