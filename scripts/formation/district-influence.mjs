/* global Hooks, game */
/**
 * Carries a district's reaction figure onto an influence throw: a quarter
 * that meets strangers coldly (or warmly) prices the roll the same way a
 * district's own cadence prices the street's encounter chance.
 *
 * Registered on the influence roller’s own modifier hook
 * (`HOOKS.INFLUENCE_MODIFIERS`) rather than called by the roller directly: the
 * roller is another module and knows nothing about districts, and this listener
 * knows nothing about how the roll it modifies is built or shown.
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
 * owed — never more than one entry, and never onto the wrong side of the roll.
 *
 * A district charges a throw made BY a party standing in it, so the figure is
 * about the side that OPENED the roll: `actor`, and the formation lookup asks
 * only that side. A payload carrying a `targetActor` and no `actor` is priced
 * by nobody here, which is the right answer — the quarter receives the party,
 * not the party's mark.
 *
 * Pushes nothing when the throw's own family is not one a district's
 * reception bears on (a district's figure is a REACTION figure — how a quarter
 * takes to a stranger — and `isReactionMode` is the one gate that says which
 * throws those are), when there is no settlement board under the actor, no
 * district drawn where the party is standing, or the district owes no figure
 * for the place the party is actually in (`districtReaction` itself answers
 * that last question).
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

  // Where the party actually IS, by the same reading the city turn and the
  // panel take: the street drawn under their token answers over the picker,
  // because it was drawn while the picker was typed. A stationary answer is
  // the exception no road overrules — a party holed up is not out on the
  // street its walls happen to sit on (`effectiveWhere`).
  const here = streetUnder(formation, t.settlement).here;

  const reaction = districtReaction(district.behavior.system, { where: here.where });
  if (!reaction) return;

  modifiers.push({
    label: game.i18n.format("ACKS-FORMATION.settlement.district.reactionLabel", { name: district.region.name }),
    value: reaction.modifier,
  });
}
