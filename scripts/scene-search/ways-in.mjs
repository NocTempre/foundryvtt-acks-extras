/**
 * The ways into a scene search: the fight-over card's Search the scene and the
 * party sheet's Dungeon tab Search here are one call, `searchHere`. It opens a
 * session for a party at the place the party stands in (the place whose area
 * holds the party token, the closest first as a map drop picks it), deals the
 * haul, and opens the screen; a party whose session is already open gets its
 * screen and nothing else. A fight's record, when the press came from its card,
 * makes the fallen the scene's bodies.
 *
 * Judge-only, since opening a session deals a haul. A player's press on the
 * Dungeon tab is not this call: it is a declaration the party's request relay
 * announces (`formation/player-requests.mjs`, `declareSearch`), and the Judge
 * then presses.
 *
 * The world is reached through `deps` so a suite supplies its own;
 * `ways-in-live.mjs` is the module's wiring over the real ones.
 */
import { REFUSAL } from "../treasure/constants.mjs";
import { normalizeRecord } from "../treasure/search-logic.mjs";
import { SESSION_REFUSAL, WAYS_REFUSAL } from "./constants.mjs";
import { partyOfRecord, planPress } from "./ways-in-logic.mjs";

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/** The deal answers a Judge who cancelled a warning knows about: nothing is said. */
const SILENT = new Set(["lairDeclined"]);

/**
 * The scene search's ways in over their dependencies.
 * @param {object} deps
 * @param {() => boolean} deps.isGM
 * @param {() => Array<{id: string, sceneId?: string|null}>} deps.parties the formations
 * @param {(partyId: string) => object|null} deps.formationOf
 * @param {(formation: object) => boolean} deps.hasSession
 * @param {(formation: object) => TokenDocument|null} deps.tokenOf the party's token
 * @param {(token: TokenDocument, scene: Scene) => Array<{place: Actor}>} deps.around `placesAround`
 * @param {(messageId: string) => object|null} deps.record the fight's record on a card
 * @param {(args: object) => Promise<{ok: boolean, reason?: string, detail?: string, potUuid?: string|null}>} deps.open the scene search api's `open`
 * @param {(partyId: string) => *} deps.openScreen
 * @param {(messageId: string) => Promise<*>} deps.stamp marks a card as opened
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} deps.confirmLair the deal's lair warning
 * @param {(reason: string) => string} deps.reasonText a `scene:` refusal in words
 * @param {(text: string) => *} deps.warn tells the Judge
 */
export function createWaysIn(deps) {
  const busy = new Set();
  const tell = (reason, detail) => {
    if (!SILENT.has(detail)) deps.warn(deps.reasonText(reason));
  };

  /**
   * Open the scene search for a party, or its screen where one is open.
   * @param {{partyId?: string|null, recordMessageId?: string|null}} [args] the party (named from the record's scene where a card is the way in) and the card carrying a fight's record
   * @returns {Promise<{ok: true, opened: boolean, potUuid?: string|null}|{ok: false, reason: string}>}
   */
  return async function searchHere({ partyId = null, recordMessageId = null } = {}) {
    if (!deps.isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const record = recordMessageId ? normalizeRecord(deps.record(recordMessageId)) : null;
    const id = partyId ?? (record ? partyOfRecord(deps.parties(), record) : null);
    const formation = id ? deps.formationOf(id) : null;
    const plan = planPress({ partyId: formation ? id : null, hasSession: formation ? deps.hasSession(formation) : false, busy: busy.has(id), record });
    if (plan.action === "refuse") {
      tell(plan.reason);
      return refuse(plan.reason);
    }
    if (plan.action === "wait") return refuse(SESSION_REFUSAL.SESSION_OPEN);
    if (plan.action === "screen") {
      deps.openScreen(id);
      return { ok: true, opened: false };
    }
    busy.add(id);
    try {
      const token = deps.tokenOf(formation);
      const scene = token?.parent ?? null;
      const place = scene ? (deps.around(token, scene)[0]?.place ?? null) : null;
      if (!place) {
        tell(WAYS_REFUSAL.NO_PLACE_HERE);
        return refuse(WAYS_REFUSAL.NO_PLACE_HERE);
      }
      const args = { partyId: id, placeUuid: place.uuid, sceneId: scene.id, recordMessageId, confirmLair: deps.confirmLair };
      let opened = await deps.open(args);
      // A deal that rolled nothing still opens the scene, with the bodies and no pot: pressing again would roll again.
      if (!opened.ok && opened.detail === REFUSAL.empty) opened = await deps.open({ ...args, sources: [] });
      if (!opened.ok) {
        tell(opened.reason, opened.detail);
        return refuse(opened.reason, opened.detail ? { detail: opened.detail } : {});
      }
      if (recordMessageId) await deps.stamp(recordMessageId);
      deps.openScreen(id);
      return { ok: true, opened: true, potUuid: opened.potUuid ?? null };
    } finally {
      busy.delete(id);
    }
  };
}
