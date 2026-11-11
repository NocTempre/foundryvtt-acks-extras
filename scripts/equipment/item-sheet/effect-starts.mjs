/**
 * The two shapes a new Active Effect on an item can start as, built as plain
 * creation data so the sheet's one Add effect control and its offline test
 * share them.
 *
 * A blank effect is transferred to the bearer and carries no change. A magic
 * light is a transferred effect carrying both radius changes with no figure in
 * them: the Judge types the feet from their own copy. The changes are
 * `upgrade`, so the engine keeps the largest where several lights ride one
 * bearer.
 */
import { MAGIC_LIGHT_CHANGE_KEYS } from "../../lib/light.mjs";
import { CHANGE } from "../../lib/effect-scan.mjs";

/** The starting points the Add effect control offers, in the order it lists them. */
export const EFFECT_STARTS = Object.freeze(["blank", "light"]);

/**
 * Creation data for a new effect on `item`, or null for an unknown start.
 *
 * @param {string} kind        One of `EFFECT_STARTS`.
 * @param {{name: string, img: string}} item
 * @param {{lightName: string}} labels  The localized name a light effect takes.
 * @returns {object|null}
 */
export function effectStartData(kind, item, { lightName }) {
  if (kind === "blank") return { name: item.name, img: item.img, transfer: true, disabled: false };
  if (kind === "light") {
    return {
      name: lightName,
      img: item.img,
      transfer: true,
      disabled: false,
      changes: [MAGIC_LIGHT_CHANGE_KEYS.bright, MAGIC_LIGHT_CHANGE_KEYS.dim].map((key) => ({ key, type: CHANGE.UPGRADE, value: "" })),
    };
  }
  return null;
}
