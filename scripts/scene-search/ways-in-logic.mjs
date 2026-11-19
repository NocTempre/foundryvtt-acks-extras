/**
 * The ways into a scene search on plain data, Foundry-free: which party a
 * fight's record belongs to, and what a press of Search the scene (the
 * fight-over card) or Search here (the Dungeon tab) should do. `ways-in.mjs`
 * is the Foundry side.
 */
import { WAYS_REFUSAL } from "./constants.mjs";

/**
 * The party a fight's record is about: the one party whose token is on the
 * fight's scene, else the only party the world has, else none. Two parties on
 * the scene are not told apart, since nothing on the card says which fought.
 * @param {Array<{id: string, sceneId?: string|null}>} parties the formations
 * @param {{sceneId?: string|null}|null} record `normalizeRecord`'s answer
 * @returns {string|null} the formation's id
 */
export function partyOfRecord(parties, record) {
  const listed = (Array.isArray(parties) ? parties : []).filter((p) => typeof p?.id === "string" && p.id);
  const sceneId = typeof record?.sceneId === "string" && record.sceneId ? record.sceneId : null;
  const here = sceneId ? listed.filter((p) => p.sceneId === sceneId) : [];
  if (here.length === 1) return here[0].id;
  return !here.length && listed.length === 1 ? listed[0].id : null;
}

/**
 * What a press does. With a session already open it opens that session's
 * screen, whichever way in was pressed; a press while the first is still
 * opening one does nothing; a card whose scene was already opened once and has
 * since ended reopens it for a Judge (`reopen`: the bodies and the pot its first
 * opening dealt, and nothing dealt again) and is refused for anyone else, so one
 * card deals once; otherwise a session opens.
 * @param {object} args
 * @param {string|null} args.partyId the party, or null where none could be named
 * @param {boolean} args.hasSession whether the party has a session open
 * @param {boolean} args.busy whether a press for this party is still opening one
 * @param {{opened?: boolean}|null} [args.record] the fight's record, where the press came from a card
 * @param {boolean} [args.isGM] whether the press is a Judge's; a spent card reopens for no one else
 * @returns {{action: "screen"|"open"|"reopen"|"wait"}|{action: "refuse", reason: string}}
 */
export function planPress({ partyId, hasSession, busy, record = null, isGM = false }) {
  if (!partyId) return { action: "refuse", reason: WAYS_REFUSAL.NO_PARTY_HERE };
  if (hasSession) return { action: "screen" };
  if (busy) return { action: "wait" };
  if (record?.opened) return isGM ? { action: "reopen" } : { action: "refuse", reason: WAYS_REFUSAL.CARD_SPENT };
  return { action: "open" };
}
