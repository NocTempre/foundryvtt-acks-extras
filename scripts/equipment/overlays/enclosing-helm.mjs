/* global game */
/**
 * Overlay: enclosing (heavy) helmet — RR p. 140.
 * Gated by the `overlayEnclosingHelm` world setting.
 *
 * "Wearing a heavy helm imposes a −1 penalty to surprise rolls and −4 penalty to
 * Listening proficiency throws, but offers a +2 bonus on d20 rolls made on the
 * Mortal Wounds table."
 *
 * Division of labour with core (which is frozen):
 *  - **+2 Mortal Wounds is ALREADY core** — `AcksActor#hasHeavyHelm()` +
 *    CharacterMortalWoundsApp apply it, detecting a heavy helm by NAME ("heavy"
 *    and "helmet"). We do NOT re-apply it (that would double for named helms).
 *  - **−1 surprise** is a real actor field (`system.surprise.avoidsurprise`, read
 *    by the surprise matrix), so it is folded into the managed loadout effect.
 *  - **−4 Listening** is a proficiency THROW with no actor field to modify, so it
 *    is surfaced as a note/flag for the Judge (and for acks-abilities to consume).
 *
 * "Enclosing" is the same fact core keys Mortal Wounds off — a heavy helmet — so
 * the recommended way to get the full RAW effect is a helmet named with "heavy"
 * and "helmet"; the light/heavy control here also sets an explicit flag for
 * helmets core's name test would miss.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";

/** RAW modifiers a heavy helm imposes (RR p140). */
export const HELM_MODIFIERS = Object.freeze({ surprise: -1, listening: -4, mortalWounds: 2 });

/** Name patterns that read as an enclosing (face-covering) helmet. */
const ENCLOSING_NAME = /\b(heavy|great\s?helm|close\s?helm|armet|barbute|hounskull|corinthian|visor(ed)?)\b/i;

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_ENCLOSING_HELM);
}

/** Is this armour item a helmet at all? (explicit flag, else the name.) */
export function isHelmet(item) {
  if (item?.type !== "armor") return false;
  if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET)) return true;
  return /helm/i.test(item.name ?? "");
}

/**
 * A helmet's type: "heavy" (enclosing) or "light". The explicit flag wins; else
 * an enclosing name reads heavy, and any other helmet reads light. Returns null
 * for a non-helmet.
 */
export function helmetType(item) {
  if (!isHelmet(item)) return null;
  const flag = item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET);
  if (flag === "heavy" || flag === "light") return flag;
  return ENCLOSING_NAME.test(item.name ?? "") ? "heavy" : "light";
}

/** Is this an enclosing (heavy) helmet? */
export function isEnclosingHelm(item) {
  return helmetType(item) === "heavy";
}

/**
 * Does an equipped enclosing helmet apply its penalties to this actor right now?
 * (Overlay on + a heavy helmet equipped.)
 */
export function enclosingHelmActive(actor) {
  if (!overlayEnabled()) return false;
  return (actor?.items ?? []).some((i) => i.system?.equipped && isEnclosingHelm(i));
}
