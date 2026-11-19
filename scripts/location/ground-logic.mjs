/**
 * The ground pile's rules, pure: what may be set down, where, what a pile
 * remembers about the slot a container came from, and what its arrival back on
 * its owner restores. No Foundry globals; `ground.mjs` reads the documents,
 * hands these functions plain facts and writes what they answer.
 *
 * A pile is a location holding one container and everything inside it, kept at
 * the spot its owner stood on. See docs/location/MODEL.md, "On the ground".
 */
import { containerStoreKey } from "../lib/money-logic.mjs";

/**
 * The refusals a set-down answers with, by `reason`. `noGm` is the transport's
 * (`lib/sockets.mjs`) and is never answered here.
 */
export const SET_DOWN_REFUSALS = Object.freeze({
  permission: "permission",
  token: "token",
  notContainer: "notContainer",
  notOnMap: "notOnMap",
});

/**
 * Which spot the pile goes at: the character's spot on the asked scene, else
 * the only spot there is, else none.
 * @param {Array<{scene: {id: string}}>} spots as `standingSpots` returns them
 * @param {string|null} sceneId the scene the asking seat is viewing
 * @returns {object|null}
 */
export function pickSpot(spots, sceneId) {
  const all = spots ?? [];
  if (sceneId) {
    const here = all.find((s) => s?.scene?.id === sceneId);
    if (here) return here;
  }
  return all.length === 1 ? all[0] : null;
}

/**
 * The record a container carries while it lies in a pile: whose it is, whether
 * it was worn, in which slot, and the id it had on its owner (a coin order
 * names a container by that id).
 */
function recordOf({ actor, item }) {
  return { ownerUuid: actor.uuid, worn: !!item.worn, slot: item.slot ?? null, fromId: item.id };
}

/**
 * Whether a set-down may go ahead, and the two flags it writes.
 *
 * Order of refusal: the asking user must own the character (a Judge always
 * does), a token's own actor is refused for every seat, and the item must be a
 * container the character carries directly. With no spot a Player is blocked
 * and a Judge goes ahead with a pile that has no token.
 *
 * @param {object} facts
 * @param {{judge: boolean, ownsCharacter: boolean}} facts.seat the asking USER, never the seat the handler runs on
 * @param {{uuid: string, name: string, isToken: boolean}} facts.actor
 * @param {{id: string, name: string, isContainer: boolean, nested: boolean, worn: boolean, slot: string|null}|null} facts.item
 * @param {boolean} facts.hasSpot
 * @returns {{ok: false, reason: string}|{ok: true, tokenless: boolean, record: object, flag: object}}
 */
export function planSetDown({ seat, actor, item, hasSpot }) {
  if (!seat?.judge && !seat?.ownsCharacter) return { ok: false, reason: SET_DOWN_REFUSALS.permission };
  // An unlinked token's actor stops existing with its token, and so would the
  // owner stamp on everything set down from it.
  if (!actor || actor.isToken) return { ok: false, reason: SET_DOWN_REFUSALS.token };
  // Any carried container goes down, a sack included (RR ch. 4, "Sack, Large").
  // One nested inside another container is not set down alone: it goes with
  // the container it is in.
  if (!item || !item.isContainer || item.nested) return { ok: false, reason: SET_DOWN_REFUSALS.notContainer };
  if (!hasSpot && !seat.judge) return { ok: false, reason: SET_DOWN_REFUSALS.notOnMap };
  return {
    ok: true,
    tokenless: !hasSpot,
    record: recordOf({ actor, item }),
    flag: { ownerUuid: actor.uuid, ownerName: actor.name ?? "", containerName: item.name ?? "", building: true },
  };
}

/**
 * Can the pile be deleted? It holds nothing and is not still being built (the
 * transfer's own compensation deletes what it created on the pile, and that
 * must not take the pile with it).
 * @param {{count: number, building?: boolean}} pile
 */
export const pileIsEmpty = ({ count, building = false } = {}) => !building && !(count > 0);

/**
 * What a container's landing restores. Fires for a container carrying a
 * set-down record, wherever it lands:
 *
 * - at a place (a pile, a shelf): nothing, the record stays with the container;
 * - nested in another container (stowed, as a Judge's deleted pile hands it
 *   back): the record is cleared and the container is taken off (`unwear`);
 * - on another character: the record is cleared and the container is taken off
 *   (`unwear`), since the worn mark rides a transfer and would put it on them;
 * - on its owner: the worn slot is restored (`wear.slot`, or `wear.equip` for an
 *   equippable item with no slot), a coin order naming the id the container had
 *   on its owner is rewritten to the id it has now, and the record is cleared.
 *
 * @param {object} facts
 * @param {{ownerUuid: string, worn: boolean, slot: string|null, fromId: string}|null} facts.record
 * @param {{uuid: string, isProvider: boolean}|null} facts.parent the document the container landed on
 * @param {string} facts.itemId the container's id where it landed
 * @param {boolean} facts.equippable the item carries core's `equipped` field
 * @param {boolean} [facts.nested] the container landed inside another container
 * @param {{payFrom?: string, receiveInto?: string}} [facts.coinOrder] the owner's coin order
 * @returns {{clear: boolean, wear: {slot?: string, equip?: boolean}|null, unwear: boolean, coinOrder: object|null}}
 */
export function planArrival({ record, parent, itemId, equippable, nested = false, coinOrder = {} }) {
  const none = { clear: false, wear: null, unwear: false, coinOrder: null };
  if (!record?.ownerUuid || !parent?.uuid || parent.isProvider) return none;
  if (nested || parent.uuid !== record.ownerUuid) return { ...none, clear: true, unwear: true };

  let wear = null;
  if (record.worn) wear = record.slot ? { slot: record.slot } : equippable ? { equip: true } : null;

  const was = containerStoreKey(record.fromId);
  const now = containerStoreKey(itemId);
  const rewrite = {};
  for (const key of ["payFrom", "receiveInto"]) if (coinOrder?.[key] === was) rewrite[key] = now;
  return { clear: true, wear, unwear: false, coinOrder: Object.keys(rewrite).length ? rewrite : null };
}

/**
 * What a pile's row on its owner's list shows, as facts the sheet words.
 *
 * @param {object} facts
 * @param {{ownerUuid: string, containerName: string}} facts.flag the pile's ground flag
 * @param {Array<{name: string, quantity?: number, ownerUuid: string|null, setDown?: object|null}>} facts.items what lies in the pile
 * @param {string} facts.viewerUuid whose row this is
 * @returns {{container: string, slot: string|null, worn: boolean, lines: Array<{name: string, quantity: number}>, count: number, atRisk: boolean}}
 *   `container` is the name the container carries now, else the one it had when set down; `slot` and `worn` are where
 *   it goes back to; `lines` are the viewer's goods and `atRisk` is true while there are any
 */
export function pileRowFacts({ flag, items, viewerUuid }) {
  const mine = (items ?? []).filter((i) => i.ownerUuid === viewerUuid);
  const carrier = mine.find((i) => i.setDown);
  const lines = mine.map((i) => ({ name: i.name, quantity: Number(i.quantity ?? 1) || 1 }));
  return {
    container: carrier?.name || flag?.containerName || "",
    slot: carrier?.setDown?.slot ?? null,
    worn: !!carrier?.setDown?.worn,
    lines,
    count: lines.length,
    atRisk: lines.length > 0,
  };
}
