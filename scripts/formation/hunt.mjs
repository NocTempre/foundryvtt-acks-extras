/* global fromUuidSync */
/**
 * The hunt: a faction that wants the party marks the settlement board
 * hunted in the quarters it controls. Asked once per quarter, not once
 * per turn — see docs/formation/MODEL.md, "Being hunted is a fact about
 * the board, not about the party".
 */
import { findDistrict } from "./district-find.mjs";
import { applyHunt } from "./settlement.mjs";
import { huntersOf, subjectsOfFormation } from "../factions/standing.mjs";

/**
 * Who is hunting this party where it stands: the district under the party
 * and the factions controlling it that hold a `wanted` row for the party or
 * a member. An empty region means the party stands in no quarter.
 * @returns {{regionUuid: string, hunters: Actor[]}}
 */
export function huntUnder(formation) {
  const hit = findDistrict(formation);
  if (!hit?.region) return { regionUuid: "", hunters: [] };
  return { regionUuid: hit.region.uuid, hunters: huntersOf(hit.region.uuid, subjectsOfFormation(formation)) };
}

/**
 * The board with the hunt applied for the quarter under the party — the
 * first hunter names the hunt when several want the party — or the same
 * board while the party stays in the quarter it was last asked for
 * (`applyHunt` on the board's own writer).
 */
export function withHunt(board, formation) {
  const { regionUuid, hunters } = huntUnder(formation);
  return applyHunt(board, { regionUuid, hunterUuid: hunters[0]?.uuid ?? "" });
}

/** The name of the faction a board says is hunting the party, or "". */
export function hunterName(board) {
  const uuid = board?.huntedBy;
  return uuid ? (fromUuidSync(uuid)?.name ?? "") : "";
}
