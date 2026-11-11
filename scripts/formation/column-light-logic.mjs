/**
 * Which lights the marching column sheds, and from where: one point per bearer
 * still inside the party token who sheds light, at the centre of the bearer's
 * own place in the column (its first body's cell).
 *
 * Pure: it reads the formation record and the light table, and takes the
 * column's cells from `columnCells` and a member's effect light from the
 * caller. Radii are FEET, the stronger of the bearer's flames (`emittedLight`)
 * and their effect light (`extraOf`), with the kind that won (`mergeLight`) so
 * the drawing can pick the look. A bearer whose sources shed nothing (doused,
 * shuttered, no reach imported, no effect light) gives no point. A bearer who
 * has deployed or detached carries their light on their own token instead.
 */
import { emittedLight, mergeLight } from "../lib/light.mjs";
import { cellCentre, memberCells } from "./column.mjs";
import { isMemberDeployed } from "./deployment.mjs";

/**
 * @param {object} formation the record (members and lights)
 * @param {{x: number, y: number}[]} cells `columnCells` for the whole formation
 * @param {number} gs grid size in pixels
 * @param {(actorId: string) => {bright: number, dim: number}|null} [extraOf]
 *   a member's effect light in feet, or nothing when the caller has none
 * @returns {{bearerId: string, x: number, y: number, bright: number, dim: number, kind: "flame"|"magic"}[]}
 */
export function columnLights(formation, cells, gs, extraOf = null) {
  const placed = memberCells(formation, cells);
  const out = [];
  const seen = new Set();
  (formation?.members ?? []).forEach((member, index) => {
    const bearerId = member?.actorId;
    if (!bearerId || member.blank || seen.has(bearerId) || isMemberDeployed(member)) return;
    seen.add(bearerId);
    const own = (formation.lights ?? []).filter((l) => l?.bearerId === bearerId);
    const { bright, dim, kind } = mergeLight(emittedLight(own), extraOf?.(bearerId));
    const cell = placed[index]?.[0];
    if (!cell || (!(bright > 0) && !(dim > 0))) return;
    const { x, y } = cellCentre(cell, gs);
    out.push({ bearerId, x, y, bright, dim, kind });
  });
  return out;
}
