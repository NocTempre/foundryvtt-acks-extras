/* global game */
/**
 * The scene's haul, the Foundry side of `haul-logic.mjs`: the pot a scene deals
 * when it opens, and the write that marks lots found. The pot is the treasure
 * feature's own pile (`treasure/pot.mjs`), made, dealt and opened in one call,
 * so the scene exposes no staging step: a Judge never holds a pot between a
 * deal and its opening, and a deal that refuses or deals nothing leaves no pot.
 *
 * Every lot is dealt unfound. Hiding a lot from a player is a projection (the
 * pot's window, doorway, record and relay show and act on found lots only):
 * Foundry gates no read, so every seat can read every Card's flag, and the mark
 * is what the table is shown and may act on, not a secret.
 */
import { MODULE_ID, POT_FLAG, REFUSAL } from "../treasure/constants.mjs";
import { dealHoard } from "../treasure/hoard.mjs";
import { addTruths, markLotsFound, newPot, openPot, potOf, viewOf } from "../treasure/pot.mjs";
import { ORIGIN } from "./constants.mjs";
import { carriedOf, foundKeys, lotsInPot, runHaulDeal } from "./haul-logic.mjs";

/**
 * Deal a scene's haul: make a pot, deal each source's letters into it unfound,
 * open it with no doorway card, and answer the pot and where each lot sits.
 * Judge-only. The Judge's roll happens here, before anyone acts, so every
 * lot's band is set now. A refusal, a declined lair warning, a deal that makes
 * nothing or an opening that leaves nothing deletes the pot it made.
 * @param {object} args
 * @param {Array<{thing: string, layer?: string, letters?: string[], truths?: object[]}>} args.sources
 *   the entries that hide the haul, each with what it hides (see `normalizeSources`)
 * @param {string} [args.name] the pot's name
 * @param {"classic"|"heroic"|"gritty"} [args.style]
 * @param {boolean} [args.special]
 * @param {boolean} [args.metInLair] true where the Judge says the creatures were met in their lair
 * @param {{noMagic?: boolean, forceCursed?: boolean}} [args.toggles] the pot's deal toggles
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} [args.confirmLair]
 *   asked once for the whole haul while the lair warning stands
 * @param {{sceneId: string, placeUuid?: string|null}} [args.scene] what the pot is tied to
 * @param {string|null} [args.partyId] the party the pot answers to (the pot flag's `partyId`), written with the origin
 * @param {boolean} [args.doorway] post the doorway card (a scene's own tray replaces it)
 * @returns {Promise<{ok: true, potId: string, potUuid: string, lots: Array<{key: string, thing: string, layer: string, cardId: string}>, dealt: object[]}|{ok: false, reason: string, dealt?: object[]}>}
 */
export async function dealSceneHaul({ sources, name = "", style, special, metInLair = false, toggles, confirmLair, scene = null, partyId = null, doorway = false } = {}) {
  if (!game.user?.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  const pile = await newPot({ name, render: false, deal: { metInLair, style, special, toggles } });
  if (!pile) return { ok: false, reason: REFUSAL.failed };
  const discard = () => pile.delete({ chatNotification: false }).catch(() => null);
  try {
    const pot = potOf(pile);
    const result = await runHaulDeal({
      isGM: true,
      pot,
      sources,
      confirmLair,
      deal: ({ letter, toggles: held }) => dealHoard({ letter, style: pot.deal.style, toggles: held, special: pot.deal.special }),
      stage: (truths) => addTruths(pile, truths),
    });
    if (!result.ok) {
      await discard();
      return result;
    }
    // The goods a body carried are written before the pot opens: the pot's opening is what takes them off the bodies.
    const carried = carriedOf(result.lots, viewOf(pile));
    const takesOff = Object.keys(carried).length > 0;
    if (scene?.sceneId || partyId || takesOff) {
      const tie = {};
      if (scene?.sceneId || takesOff) {
        tie[`flags.${MODULE_ID}.${POT_FLAG}.origin`] = {
          kind: ORIGIN.SCENE,
          sceneId: scene?.sceneId ?? null,
          placeUuid: scene?.placeUuid ?? null,
          ...(takesOff ? { takeOff: true, carried, takenOff: false } : {}),
        };
      }
      if (partyId) tie[`flags.${MODULE_ID}.${POT_FLAG}.partyId`] = partyId;
      await pile.update(tie);
    }
    const opened = await openPot(pile, { doorway });
    if (!opened.ok) {
      await discard();
      return { ok: false, reason: opened.reason ?? REFUSAL.failed, dealt: result.dealt };
    }
    return { ok: true, potId: pile.id, potUuid: pile.uuid, lots: lotsInPot(result.lots, viewOf(pile)), dealt: result.dealt };
  } catch (error) {
    await discard();
    throw error;
  }
}

/**
 * Mark the lots a check's outcome finds, on the scene's pot. Only a
 * `scene:found` answer marks anything. Judge-only.
 * @param {Cards} pile the scene's pot
 * @param {object} outcome `outcomeOf`'s answer
 * @returns {Promise<{ok: boolean, reason?: string, ids?: string[], already?: string[], missing?: string[]}>}
 */
export function markSceneFound(pile, outcome) {
  return markLotsFound(pile, foundKeys(outcome));
}
