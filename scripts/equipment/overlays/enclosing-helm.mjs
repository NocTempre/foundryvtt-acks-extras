/* global game */
/**
 * Overlay: enclosing (heavy) helmet — RR p. 140.
 * Gated by the `overlayEnclosingHelm` world setting.
 *
 * A heavy helm modifies surprise rolls, Listening throws and the Mortal Wounds
 * roll. Division of labour with core (which is frozen):
 *  - **Mortal Wounds is ALREADY core** — `AcksActor#hasHeavyHelm()` +
 *    CharacterMortalWoundsApp apply it, detecting a heavy helm by NAME ("heavy"
 *    and "helmet"). We do NOT re-apply it (that would double for named helms).
 *  - **Surprise** is a real actor field (`system.surprise.avoidsurprise`, read
 *    by the surprise matrix), so it is folded into the managed loadout effect.
 *  - **Listening** is a proficiency THROW with no actor field to modify, so it
 *    is surfaced as a note/flag for the Judge (and for acks-abilities to consume).
 *
 * "Enclosing" is the same fact core keys Mortal Wounds off — a heavy helmet — so
 * the recommended way to get the full RAW effect is a helmet named with "heavy"
 * and "helmet"; the light/heavy control here also sets an explicit flag for
 * helmets core's name test would miss.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
// "Is this a helmet at all" is armour classification, and profiles.mjs owns it
// for the whole feature — this overlay only decides which KIND of helmet.
import { isHelmet } from "../profiles.mjs";
import { isWorn } from "../../lib/item-model.mjs";
import { hasDoc, getDoc } from "../../lib/tables.mjs";
import { RULEDATA_DOC } from "./scavenged.mjs";

/**
 * The equipment table the heavy helmet's modifiers are imported into (RR
 * ch. 4, Armor, "Helmet, Heavy"); the Judge's override of it wins.
 */
export const HELM_TABLE = "heavyHelm";

/**
 * The heavy helmet's modifiers as the Judge's import holds them: to surprise
 * rolls, to Listening throws, and to the Mortal Wounds roll. A figure not yet
 * imported is null, and nothing applies in its place.
 * @returns {{surprise: number|null, listening: number|null, mortalWounds: number|null}}
 */
export function helmFigures() {
  const row = hasDoc(RULEDATA_DOC) ? (getDoc(RULEDATA_DOC)?.tables?.[HELM_TABLE] ?? {}) : {};
  const read = (key) => {
    const raw = row[key];
    if (raw == null || raw === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  return { surprise: read("surprise"), listening: read("listening"), mortalWounds: read("mortalWounds") };
}

/** Name patterns that read as an enclosing (face-covering) helmet. */
const ENCLOSING_NAME = /\b(heavy|great\s?helm|close\s?helm|armet|barbute|hounskull|corinthian|visor(ed)?)\b/i;

export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_ENCLOSING_HELM);

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
  return (actor?.items ?? []).some((i) => isWorn(i) && isEnclosingHelm(i));
}
