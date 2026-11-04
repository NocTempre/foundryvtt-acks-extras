/**
 * Which lights the marching column sheds, and from where: one point per bearer
 * still inside the party token who holds a lit, open source, at the centre of
 * the bearer's own place in the column (its first body's cell).
 *
 * Pure: it reads the formation record and the light table, and takes the
 * column's cells from `columnCells`. Radii are FEET, the brightest of the
 * bearer's sources (`emittedLight`); a bearer whose sources shed nothing
 * (doused, shuttered, or no reach imported) gives no point. A bearer who has
 * deployed or detached carries their light on their own token instead.
 */
import { emittedLight } from "../lib/light.mjs";
import { cellCentre, memberCells } from "./column.mjs";
import { isMemberDeployed } from "./deployment.mjs";

/**
 * @param {object} formation the record (members and lights)
 * @param {{x: number, y: number}[]} cells `columnCells` for the whole formation
 * @param {number} gs grid size in pixels
 * @returns {{bearerId: string, x: number, y: number, bright: number, dim: number}[]}
 */
export function columnLights(formation, cells, gs) {
  const placed = memberCells(formation, cells);
  const out = [];
  const seen = new Set();
  (formation?.members ?? []).forEach((member, index) => {
    const bearerId = member?.actorId;
    if (!bearerId || member.blank || seen.has(bearerId) || isMemberDeployed(member)) return;
    seen.add(bearerId);
    const own = (formation.lights ?? []).filter((l) => l?.bearerId === bearerId);
    const { bright, dim } = emittedLight(own);
    const cell = placed[index]?.[0];
    if (!cell || (!(bright > 0) && !(dim > 0))) return;
    const { x, y } = cellCentre(cell, gs);
    out.push({ bearerId, x, y, bright, dim });
  });
  return out;
}
