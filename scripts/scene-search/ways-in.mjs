/**
 * The ways into a scene search: the fight-over card's Search the scene and the
 * party sheet's Dungeon tab Search here are one call, `searchHere`. It opens a
 * session for a party at the place the party stands in (the place whose area
 * holds the party token, the closest first as a map drop picks it), deals the
 * haul, and opens the screen; a party whose session is already open gets its
 * screen and nothing else. A fight's record, when the press came from its card,
 * makes the fallen the scene's bodies. A card whose scene was opened once and
 * has ended reopens it on a Judge's press, at the place the first opening used
 * and with the pot it dealt reattached, and deals nothing again. The deal runs
 * on the choices the card recorded (`deal`: table style, special treasure, met
 * in their lair, arms column); a press with no card asks for none.
 *
 * Judge-only, since opening a session deals a haul. A player's press on the
 * Dungeon tab reaches this call through the party-press relay
 * (`formation/party-press.mjs`, `searchHere`), which makes it on the Judge's
 * client and announces the press to the table.
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
 * @param {(messageId: string, made: {potUuid: string|null, placeUuid: string, lots: object[]}) => Promise<*>} deps.stamp marks a card as opened and keeps what the opening made
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} deps.confirmLair the deal's lair warning, asked only where the card's choices (or none) leave "Met in their lair" off
 * @param {() => string} deps.potGoneText the notice for a reopened search whose pot is gone
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
   * @returns {Promise<{ok: true, opened: boolean, reopened?: true, potUuid?: string|null}|{ok: false, reason: string}>}
   */
  return async function searchHere({ partyId = null, recordMessageId = null } = {}) {
    if (!deps.isGM()) return refuse(SESSION_REFUSAL.NOT_ALLOWED);
    const record = recordMessageId ? normalizeRecord(deps.record(recordMessageId)) : null;
    const id = partyId ?? (record ? partyOfRecord(deps.parties(), record) : null);
    const formation = id ? deps.formationOf(id) : null;
    const plan = planPress({ partyId: formation ? id : null, hasSession: formation ? deps.hasSession(formation) : false, busy: busy.has(id), record, isGM: true });
    if (plan.action === "refuse") {
      tell(plan.reason);
      return refuse(plan.reason);
    }
    if (plan.action === "wait") return refuse(SESSION_REFUSAL.SESSION_OPEN);
    if (plan.action === "screen") {
      deps.openScreen(id);
      return { ok: true, opened: false };
    }
    const reopen = plan.action === "reopen";
    busy.add(id);
    try {
      const token = deps.tokenOf(formation);
      const scene = token?.parent ?? null;
      // A reopened search is at the place the first opening used, not wherever the party stands now.
      const stamped = reopen && record.placeUuid;
      const placeUuid = stamped ? record.placeUuid : scene ? (deps.around(token, scene)[0]?.place?.uuid ?? null) : null;
      if (!placeUuid) {
        tell(WAYS_REFUSAL.NO_PLACE_HERE);
        return refuse(WAYS_REFUSAL.NO_PLACE_HERE);
      }
      // The choices a card recorded are the deal's own; a press with no card, or a card posted without them, asks for none and the pot starts as a hand-made one does.
      const asked = !reopen && record?.deal ? { ...record.deal } : {};
      const args = { partyId: id, placeUuid, sceneId: stamped ? (record.sceneId ?? scene?.id ?? null) : (scene?.id ?? null), recordMessageId, ...asked, confirmLair: deps.confirmLair };
      let opened = await deps.open(args);
      // A deal that rolled nothing still opens the scene, with the bodies and no pot: pressing again would roll again.
      if (!reopen && !opened.ok && opened.detail === REFUSAL.empty) opened = await deps.open({ ...args, sources: [] });
      if (!opened.ok) {
        tell(opened.reason, opened.detail);
        return refuse(opened.reason, opened.detail ? { detail: opened.detail } : {});
      }
      if (reopen) {
        // The card's first opening kept its pot, and the pot is gone: the scene is open with its bodies and nothing to find.
        if (opened.potGone) deps.warn(deps.potGoneText());
      } else if (recordMessageId) {
        await deps.stamp(recordMessageId, { potUuid: opened.potUuid ?? null, placeUuid, lots: opened.session?.lots ?? [] });
      }
      deps.openScreen(id);
      return { ok: true, opened: true, ...(reopen ? { reopened: true } : {}), potUuid: opened.potUuid ?? null };
    } finally {
      busy.delete(id);
    }
  };
}
