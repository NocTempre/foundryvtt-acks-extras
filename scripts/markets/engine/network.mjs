/**
 * A trader's mercantile network, as a venture reads it: the class step and the
 * impact step its two options are built from (`rules/arbitrage.mjs`
 * `networkOptions`). Both are the page's values or the Judge's, never this
 * module's: the class step is henchmen's situational `marketClass` modifiers
 * (an Active Effect, or the typed effect the importer located on the power);
 * the impact step is this feature's own `marketImpact` key, read the same two
 * ways. Every `marketImpact` modifier is the network's, so each counts only in
 * a known market whether or not it names a condition. A power held by name
 * alone (`unvaluedPowers`) has neither step, and `missing` says so.
 */
import { activeNumericChanges, abilityModifiers } from "../../lib/effect-scan.mjs";
import { collectEffectModifiers, unvaluedPowers } from "../../henchmen/effects.mjs";

const IMPACT_KEY = "flags.acks-extras.marketImpact";

/**
 * The trader's network steps.
 * @param {Actor|null} actor
 * @returns {{classStep: number, impactStep: number, missing: string[]}} `missing`
 *   names the powers held without a value
 */
export function networkSteps(actor) {
  if (!actor) return { classStep: 0, impactStep: 0, missing: [] };
  const classStep = collectEffectModifiers(actor, "marketClass")
    .filter((m) => m.situational)
    .reduce((sum, m) => sum + m.value, 0);
  const viaEffect = activeNumericChanges(actor, IMPACT_KEY);
  // An item whose own Active Effect carries the key stands aside for it.
  const effectItems = new Set(viaEffect.map(({ effect }) => (effect.parent?.documentName === "Item" ? effect.parent.id : null)).filter(Boolean));
  const impactStep =
    viaEffect.reduce((sum, { value }) => sum + value, 0) +
    abilityModifiers(actor, "marketImpact", { skipItemIds: effectItems }).reduce((sum, m) => sum + m.value, 0);
  return { classStep: Math.max(0, classStep), impactStep: Math.max(0, impactStep), missing: unvaluedPowers(actor, "marketClass") };
}
