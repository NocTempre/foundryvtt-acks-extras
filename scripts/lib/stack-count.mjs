/* global game */
/**
 * What a list row prints for its count: whether the `×N` shows, and the
 * tooltip that names where the figure is read from. A count shows above one,
 * and always for coin (an empty purse reads as empty); it is shown on any row
 * that has one, whether or not the surface offers a count control there
 * (`offersCount`, which is a different question).
 */
import { isCurrency, stackCountOf } from "./item-model.mjs";

/**
 * The count view of one row, plain item data or a document.
 * @returns {{qty: number|null, stack: boolean, countTip: string}} `qty` is the
 *   item's own Quantity (null where it carries none), `stack` whether the
 *   count is drawn, and `countTip` its provenance, built at render and
 *   empty where nothing is drawn.
 */
export function countView(item) {
  const qty = stackCountOf(item);
  const stack = isCurrency(item) || (qty ?? 1) > 1;
  return { qty, stack, countTip: stack ? game.i18n.format("ACKS-LIB.stack.countTip", { n: qty ?? 0 }) : "" };
}
