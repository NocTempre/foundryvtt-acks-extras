/* global game, fromUuidSync */
/**
 * The scene's haul, the Foundry side of `haul-logic.mjs`: the pot a scene deals
 * when it opens, the write that marks lots found (and takes their goods off the
 * bodies), and the reattach of that pot to a reopened search. The pot is the treasure
 * feature's own pile (`treasure/pot.mjs`), made, dealt and opened in one call,
 * so the scene exposes no staging step: a Judge never holds a pot between a
 * deal and its opening, and a deal that refuses or deals nothing leaves no pot.
 *
 * Every lot is dealt unfound. Hiding a lot from a player is a projection (the
 * pot's window, doorway, record and relay show and act on found lots only):
 * Foundry gates no read, so every seat can read every Card's flag, and the mark
 * is what the table is shown and may act on, not a secret.
 */
import { MODULE_ID, PHASE, POT_FLAG, REFUSAL } from "../treasure/constants.mjs";
import { magicRollerFor } from "../treasure/deal.mjs";
import { dealHoard } from "../treasure/hoard.mjs";
import { addTruths, isPot, markLotsFound, newPot, openPot, potOf, viewOf } from "../treasure/pot.mjs";
import { LAYER_NAMES } from "../lib/place-things-logic.mjs";
import { LAYER, ORIGIN } from "./constants.mjs";
import { bodiesWithFound, carriedOf, foundKeys, lotsInPot, runHaulDeal } from "./haul-logic.mjs";

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
 * @param {string} [args.armsSetting] the pot's arms column (a setting key; blank is none); left out, the pot starts with the Judge's last choice as a hand-made pot does
 * @param {{noMagic?: boolean, forceCursed?: boolean}} [args.toggles] the pot's deal toggles
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} [args.confirmLair]
 *   asked once for the whole haul while the lair warning stands
 * @param {{sceneId: string, placeUuid?: string|null}} [args.scene] what the pot is tied to
 * @param {string|null} [args.partyId] the party the pot answers to (the pot flag's `partyId`), written with the origin
 * @param {boolean} [args.doorway] post the doorway card (a scene's own tray replaces it)
 * @returns {Promise<{ok: true, potId: string, potUuid: string, lots: Array<{key: string, thing: string, layer: string, cardId: string}>, dealt: object[]}|{ok: false, reason: string, dealt?: object[]}>}
 */
export async function dealSceneHaul({ sources, name = "", style, special, metInLair = false, armsSetting, toggles, confirmLair, scene = null, partyId = null, doorway = false } = {}) {
  if (!game.user?.isGM) return { ok: false, reason: REFUSAL.notAllowed };
  // The key is left out when nothing was asked: a present key, blank or not, wins over the Judge's last column in `newPot`.
  const pile = await newPot({ name, render: false, deal: { metInLair, style, special, toggles, ...(typeof armsSetting === "string" ? { armsSetting } : {}) } });
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
      rollMagic: magicRollerFor({ pot, style: pot.deal.style }),
      stage: (truths) => addTruths(pile, truths),
    });
    if (!result.ok) {
      await discard();
      return result;
    }
    // The goods a body carried are mapped to their cards here; none leaves its body until its lot is found (`markSceneFound`), and `taken` lists the cards already settled.
    const carried = carriedOf(result.lots, viewOf(pile));
    const takesOff = Object.keys(carried).length > 0;
    if (scene?.sceneId || partyId || takesOff) {
      const tie = {};
      if (scene?.sceneId || takesOff) {
        tie[`flags.${MODULE_ID}.${POT_FLAG}.origin`] = {
          kind: ORIGIN.SCENE,
          sceneId: scene?.sceneId ?? null,
          placeUuid: scene?.placeUuid ?? null,
          ...(takesOff ? { takeOff: true, carried, taken: [] } : {}),
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
 * Mark the lots a check's outcome finds, on the scene's pot, and take the goods
 * of the lots it turned found off the bodies that carried them. Only a
 * `scene:found` answer marks anything. A lot found before is not marked again,
 * so its good is not taken again either. Judge-only.
 * @param {Cards} pile the scene's pot
 * @param {object} outcome `outcomeOf`'s answer
 * @param {object} [options]
 * @param {(pile: Cards, only: {cardIds: string[]}) => Promise<number>} [options.takeOff] treasure's `takeOffBodies`, called with the cards just found
 * @returns {Promise<{ok: boolean, reason?: string, ids?: string[], already?: string[], missing?: string[], tookOff?: number}>}
 */
export async function markSceneFound(pile, outcome, { takeOff = null } = {}) {
  const marked = await markLotsFound(pile, foundKeys(outcome));
  if (!marked.ok || !marked.ids?.length || typeof takeOff !== "function") return marked;
  try {
    return { ...marked, tookOff: await takeOff(pile, { cardIds: marked.ids }) };
  } catch (error) {
    console.error(`${MODULE_ID} | scene search could not take a found lot's goods off its body`, error);
    return marked;
  }
}

/**
 * Take a scene's pot back for a reopened search: the pot a card's first opening
 * dealt, if it still exists and is open, and the lots it still holds. Ending a
 * session never touches its pot, so the cards, their found marks and the
 * mapped goods are as the last check left them; a pot the Judge closed (which
 * deletes it) answers null. Nothing is dealt and nothing is written.
 * @param {{potUuid?: string|null, lots?: Array<{key: string, thing: string, layer: string}>}} made what the card kept of its first opening
 * @param {object[]} bodies the reopened session's bodies
 * @returns {{potUuid: string, lots: Array<{key: string, thing: string, layer: string, cardId: string}>, bodies: object[]}|null}
 */
export function reattachSceneHaul({ potUuid = null, lots = [] } = {}, bodies = []) {
  let pile = null;
  try {
    pile = potUuid ? fromUuidSync(potUuid, { strict: false }) : null;
  } catch {
    pile = null;
  }
  if (!pile || !isPot(pile)) return null;
  const view = viewOf(pile);
  if (view.pot.phase !== PHASE.open) return null;
  const held = lotsInPot(
    (Array.isArray(lots) ? lots : []).map((lot) => ({ ...lot, layer: LAYER_NAMES.includes(lot.layer) ? lot.layer : LAYER.HASTY })),
    view,
  );
  return { potUuid: pile.uuid, lots: held, bodies: bodiesWithFound(bodies, held, view) };
}
