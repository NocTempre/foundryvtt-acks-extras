/**
 * A card dragged out of an open pot onto an actor's sheet: the `dropActorSheetData`
 * hook's half, Foundry-free. The hook must decide before the sheet's own drop
 * handler goes on, so it answers synchronously: a Card of a pot's `order` is
 * taken over (`false`) and its claim is sent to the relay, which is the one
 * place that refuses a target the sender does not own; any other drop is left
 * to the sheet.
 */
import { REFUSAL } from "./constants.mjs";

/**
 * @param {object} deps
 * @param {(uuid: string) => (object|null)} deps.resolveCard  the Card a uuid names, found without waiting
 * @param {(pile: object) => ({order: string[]}|null)} deps.potOf  the pile's pot flag, or null where it is no pot
 * @param {(request: object) => Promise<object|undefined>} deps.send  puts a request to the pot's relay
 * @param {(result: object|undefined) => void} deps.report  says the relay's answer to the user
 * @returns {(target: object, sheet: object, data: object) => (false|undefined)} the hook
 */
export function createCardDrop({ resolveCard, potOf, send, report }) {
  return function onDropActorSheetData(target, _sheet, data) {
    if (data?.type !== "Card" || typeof data.uuid !== "string") return undefined;
    const card = resolveCard(data.uuid);
    const pot = card?.parent ? potOf(card.parent) : null;
    if (!pot?.order.includes(card.id) || !target?.uuid) return undefined;
    send({ potId: card.parent.id, op: "claim", cardId: card.id, actorUuid: target.uuid }).then(report, () => report({ ok: false, reason: REFUSAL.failed }));
    return false;
  };
}
