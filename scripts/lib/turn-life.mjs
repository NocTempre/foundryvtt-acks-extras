/**
 * The pure half of a record that lasts turns: which edges of a turn a change of
 * the tracker crosses, and what one such edge does to a record's `turnLife`
 * flag. The tracker's half (`status-effects.mjs`) reads the flag off each
 * combatant's effects, applies the answer and fires the turn hooks.
 *
 * A `turnLife` flag is `{combatId, combatantId, edge, count, seen}`: it counts
 * `combatantId`'s turns in the fight `combatId`. Each of that combatant's turn
 * starts adds one to `seen`. `edge` is the moment the record ends once `seen`
 * has reached `count`: `start`, at the turn start that reaches it, or `end`, at
 * the end of a turn that began after the record was written and so counted.
 * Foundry-free.
 */
import { numOrNull } from "./util.mjs";

/** The two moments of a turn a record can end at. */
export const TURN_LIFE_EDGES = Object.freeze(["start", "end"]);

/**
 * A stored `turnLife` flag as a well-formed record, or null when it is not one:
 * a fight and a combatant named, an edge, and a whole count of one or more.
 * `seen` is a whole number of turns begun, none when never written.
 *
 * @param {object} [raw]
 * @returns {{combatId: string, combatantId: string, edge: "start"|"end", count: number, seen: number}|null}
 */
export function readTurnLife(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { combatId, combatantId, edge } = raw;
  if (typeof combatId !== "string" || !combatId || typeof combatantId !== "string" || !combatantId) return null;
  if (!TURN_LIFE_EDGES.includes(edge)) return null;
  const count = Math.floor(numOrNull(raw.count) ?? 0);
  if (count < 1) return null;
  const seen = Math.max(0, Math.floor(numOrNull(raw.seen) ?? 0));
  return { combatId, combatantId, edge, count, seen };
}

/**
 * What one turn event does to a record: the `seen` it holds afterwards and
 * whether it ends there. The record's own combatant and fight only: another's
 * event, and a flag that is not a record, leave `seen` as it was and lift
 * nothing. A turn that begins adds one to `seen`, and a `start` record is lifted
 * when that reaches `count`, so no write to `seen` accompanies it. An `end`
 * record is lifted when its combatant's turn ends with `seen` at `count` or
 * more: a turn that was already running when the record was written never began
 * after it, so it does not count. Pure.
 *
 * @param {object} life  the stored flag
 * @param {{kind: "began"|"ended", combatId: string, combatantId: string}} event
 * @returns {{seen: number, lift: boolean}}
 */
export function turnLifeStep(life, event) {
  const record = readTurnLife(life);
  if (!record) return { seen: Math.max(0, Math.floor(numOrNull(life?.seen) ?? 0)), lift: false };
  if (event?.combatId !== record.combatId || event?.combatantId !== record.combatantId) return { seen: record.seen, lift: false };
  if (event.kind === "began") {
    const seen = record.seen + 1;
    return { seen, lift: record.edge === "start" && seen >= record.count };
  }
  if (event.kind === "ended") return { seen: record.seen, lift: record.edge === "end" && record.seen >= record.count };
  return { seen: record.seen, lift: false };
}

/**
 * The turn edges a change of the tracker crosses: `ended`, the id of the
 * combatant whose turn it left, or null, and `began`, whether the tracker is on
 * a turn that begins. A round advance and a turn moving forward to another
 * combatant cross both. The same combatant's place in the order moving, a
 * combatant ahead of the current turn taking it over, and a move backward are
 * the tracker re-sorting after an initiative roll or the Judge stepping back,
 * and cross neither. A position in a round that opened before its initiative
 * was rolled (`unrolled`, that round's number) never began, so leaving it ends
 * no turn. Pure.
 *
 * @param {{round: number, turn: number, combatantId?: string}} prior
 * @param {{round: number, turn: number, combatantId?: string}} current
 * @param {{unrolled?: number|null}} [state]  the round, if any, that is open and unrolled
 * @returns {{ended: string|null, began: boolean}}
 */
export function turnEdges(prior, current, { unrolled = null } = {}) {
  if (!prior || !current) return { ended: null, began: false };
  const priorRound = numOrNull(prior.round) ?? 0;
  const advancedRound = current.round > priorRound;
  const advancedTurn = current.round === priorRound && current.turn > prior.turn && current.combatantId !== prior.combatantId;
  if (!advancedRound && !advancedTurn) return { ended: null, began: false };
  const leaves = prior.combatantId && !(unrolled != null && unrolled === priorRound) ? prior.combatantId : null;
  return { ended: leaves, began: true };
}

/**
 * Whether a record carrying a turn mark (a condition written outside a fight)
 * is lifted by a turn event: its subject's own turn beginning, the first in any
 * fight. A mark that is not `{edge: "start"}`, another combatant's turn and an
 * end lift nothing. Pure.
 *
 * @param {object} [mark]  the stored flag
 * @param {{kind: "began"|"ended"}} event
 * @param {boolean} ownTurn  whether the turn is the record's subject's own
 */
export function markLifts(mark, event, ownTurn) {
  return mark?.edge === "start" && event?.kind === "began" && ownTurn === true;
}
