/* global Hooks, game */
/**
 * Carries a district's reaction figure onto an influence throw, over the
 * roller's own `HOOKS.INFLUENCE_MODIFIERS` hook. See
 * docs/formation/MODEL.md, "A district prices an influence throw through
 * the roller's own hook".
 */
import { MODULE_ID } from "./constants.mjs";
import { getFormationForActor } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import { districtReaction } from "./settlement.mjs";
import { findDistrict } from "./district-zone.mjs";
import { streetUnder } from "./zones.mjs";
import { HOOKS, isReactionMode } from "../influence/constants.mjs";

/** Register the listener (called from the init hook). */
export function installDistrictInfluence() {
  Hooks.on(HOOKS.INFLUENCE_MODIFIERS, (context) => {
    try {
      pushDistrictModifier(context);
    } catch (err) {
      // A listener that throws must not stop the roller from opening.
      console.error(`${MODULE_ID} | district influence modifier failed`, err);
    }
  });
}

/**
 * Push the district's reaction figure onto `context.modifiers`, when one is
 * owed — never more than one entry. Prices the side that opened the roll
 * (`actor`); a payload naming only `targetActor` is priced by nobody here.
 * Pushes nothing outside a reaction-mode roll (`isReactionMode`), with no
 * settlement board under the actor, no district where the party stands, or
 * no figure owed for that place (`districtReaction` answers the last one).
 *
 * @param {{actor: object|null, mode: string|null, modifiers: object[]}} context
 */
function pushDistrictModifier(context) {
  const { actor, mode, modifiers } = context ?? {};
  if (!Array.isArray(modifiers)) return;
  if (!isReactionMode(mode)) return;

  const formation = getFormationForActor(actor?.id);
  if (!formation) return;

  const t = travelOf(formation);
  if (t.mode !== "settlement") return;

  const district = findDistrict(formation);
  if (!district) return;

  // Same reader the city turn and the panel use — see docs/formation/MODEL.md,
  // "One reader answers where the party is standing".
  const here = streetUnder(formation, t.settlement).here;

  const reaction = districtReaction(district.behavior.system, { where: here.where });
  if (!reaction) return;

  modifiers.push({
    label: game.i18n.format("ACKS-FORMATION.settlement.district.reactionLabel", { name: district.region.name }),
    value: reaction.modifier,
  });
}
