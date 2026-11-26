/* global game, ui */
/**
 * The ways in over the real world: the formations, the party's token and the
 * places around it, the session's record, and the notices a Judge reads. The
 * module's wiring calls `configureWaysIn` once at init.
 */
import { getFormation, getFormations, getPartyToken } from "../formation/formation-model.mjs";
import { placesAround } from "../location/places-around.mjs";
import { readSession } from "./session.mjs";
import { sceneReasonText } from "./words.mjs";
import { createWaysIn } from "./ways-in.mjs";

/**
 * The ways in over the real world. The deal's "Met in their lair" choice comes
 * from the card (or is off where none is recorded); with it off the warning is
 * shown to the Judge as a notice and the deal goes on, and with it on the
 * warning is never raised.
 * @param {object} real the parts only the module's wiring can supply
 * @param {(args: object) => Promise<object>} real.open the scene search api's `open`
 * @param {(partyId: string) => *} real.openScreen
 * @param {(messageId: string, made: object) => Promise<*>} real.stamp
 * @param {(messageId: string) => object|null} real.record
 * @returns {ReturnType<typeof createWaysIn>}
 */
export function createLiveWaysIn({ open, openScreen, stamp, record }) {
  return createWaysIn({
    isGM: () => !!game.user?.isGM,
    parties: () => Object.values(getFormations()),
    formationOf: (id) => getFormation(id),
    hasSession: (formation) => !!readSession(formation),
    tokenOf: (formation) => getPartyToken(formation),
    around: placesAround,
    record,
    open,
    openScreen,
    stamp,
    confirmLair: () => {
      ui.notifications?.warn(`${game.i18n.localize("ACKS-TREASURE.deal.warn.label")}: ${game.i18n.format("ACKS-TREASURE.deal.warn.body", { toggle: game.i18n.localize("ACKS-TREASURE.deal.lair") })}`);
      return true;
    },
    potGoneText: () => game.i18n.localize("ACKS-TREASURE.refuse.noPot"),
    reasonText: sceneReasonText,
    warn: (text) => ui.notifications?.warn(text),
  });
}

/** The ways in over the real dependencies, made once at init by `configureWaysIn`. */
let live = null;

/**
 * Make the module's ways in over the real world; the module's wiring calls it
 * once, at init, before `acksExtras.sceneSearch` is assigned.
 * @param {Parameters<typeof createLiveWaysIn>[0]} parts
 */
export function configureWaysIn(parts) {
  live = createLiveWaysIn(parts);
}

/** Open the scene search for a party at the place it stands in, or its screen where one is open (`createWaysIn`'s `searchHere`). Judge-only. */
export const searchSceneHere = (args) => live(args);
