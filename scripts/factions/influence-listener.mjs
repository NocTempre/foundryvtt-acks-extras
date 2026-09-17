/* global Hooks, game */
/**
 * Carries a faction's standing onto an influence throw — the second listener
 * on the influence roller's own modifier hook, in the shape the district's
 * reception set (`formation/district-influence.mjs`).
 *
 * Three rows can arrive, each named after the faction it comes from:
 *
 *  - **the other side's own standing** — when the target IS a faction, or is
 *    listed on one's membership, that faction's standing toward the party
 *    is on the table;
 *  - **the quarter's holders** — every faction controlling the district the
 *    party stands in prices the roll with its standing toward them, whoever
 *    the target is: a syndicate's quarter is a cold place for a party that
 *    crossed it;
 *  - **legal authority** — a NOTE (a row with no figure, which the roller
 *    keeps because it is marked one) when a watch or noble faction controlling
 *    that quarter lists the INFLUENCER as a member. The authority modifier
 *    itself is the Judge's tick on the dialog; this row says only that the
 *    law is on this side of the table here.
 *
 * A faction is counted once however many of these it qualifies through.
 *
 * A fourth row is a note too: **what the other side's organisation thinks of
 * the speaker's**. A relation is a label, never a figure, so it is said and
 * not added — the Judge prices a standing rivalry with a `faction` ledger row,
 * which arrives on the numeric side above because the subject set carries the
 * organisations each side answers for. A hidden relation is a Judge's own and
 * is drawn only on a Judge's dialog.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import {
  authoritiesRostering, factionsControlling, factionsOfMember, isFaction, relationBetween, standingFor, subjectsOfActor,
} from "./standing.mjs";
import { getFormationForActor } from "../formation/formation-model.mjs";
import { travelOf } from "../formation/travel.mjs";
import { findDistrict } from "../formation/district-zone.mjs";
import { HOOKS, isReactionMode } from "../influence/constants.mjs";

/** Register the listener (called from the init hook). */
export function installFactionInfluence() {
  Hooks.on(HOOKS.INFLUENCE_MODIFIERS, (context) => {
    try {
      pushFactionModifiers(context);
    } catch (err) {
      // A listener that throws must not stop the roller from opening.
      console.error(`${MODULE_ID} | faction influence modifier failed`, err);
    }
  });
}

/**
 * The district the party of an actor is standing in, or null: outside
 * settlement mode, outside every district, or with no formation at all.
 */
function districtUnder(actor) {
  const formation = getFormationForActor(actor?.id);
  if (!formation) return null;
  if (travelOf(formation).mode !== "settlement") return null;
  return findDistrict(formation)?.region ?? null;
}

/**
 * Push the faction rows onto `context.modifiers`. Exported for the tests,
 * which hand it the finders it would otherwise read from the world.
 * @param {{actor, targetActor, mode, modifiers: object[]}} context
 */
export function pushFactionModifiers(context, finders = {}) {
  const { actor, targetActor, mode, modifiers } = context ?? {};
  if (!Array.isArray(modifiers)) return;
  if (!isReactionMode(mode)) return;
  const f = {
    subjectsOfActor, isFaction, factionsOfMember, factionsControlling, authoritiesRostering, standingFor, districtUnder,
    relationBetween, isGM: () => !!game.user?.isGM,
    ...finders,
  };

  const subjects = f.subjectsOfActor(actor);
  const seen = new Set();
  const push = (faction) => {
    if (!faction?.uuid || seen.has(faction.uuid)) return;
    seen.add(faction.uuid);
    const value = f.standingFor(faction, subjects);
    if (!value) return;
    modifiers.push({ label: game.i18n.format(`${LANG_PREFIX}.influence.standing`, { name: faction.name }), value });
  };

  // The other side of the table: the target itself when it is an organisation,
  // and every organisation it belongs to.
  const across = unique([...(f.isFaction(targetActor) ? [targetActor] : []), ...f.factionsOfMember(targetActor?.uuid)]);
  for (const faction of across) push(faction);
  pushRelationNotes(f, across, unique(f.factionsOfMember(actor?.uuid)), modifiers);

  const region = f.districtUnder(actor);
  if (!region) return;
  for (const faction of f.factionsControlling(region.uuid)) push(faction);
  for (const faction of f.authoritiesRostering(region.uuid, actor?.uuid)) {
    modifiers.push({ label: game.i18n.format(`${LANG_PREFIX}.influence.authority`, { name: faction.name }), value: 0, note: true });
  }
}

/** The documents of a list, each once, in the order they first appear. */
function unique(list) {
  const seen = new Set();
  return (list ?? []).filter((doc) => {
    if (!doc?.uuid || seen.has(doc.uuid)) return false;
    seen.add(doc.uuid);
    return true;
  });
}

/**
 * One note per standing opinion across the table: for each organisation on the
 * other side that holds a row about one the speaker belongs to, and whose
 * stance is something other than neutral, a row with no figure saying so. A
 * hidden row is the Judge's alone.
 */
function pushRelationNotes(f, across, own, modifiers) {
  const gm = f.isGM();
  for (const other of across) {
    for (const mine of own) {
      if (other.uuid === mine.uuid) continue;
      const row = f.relationBetween(other, mine);
      if (!row || row.stance === "neutral") continue;
      if (row.hidden && !gm) continue;
      modifiers.push({
        label: game.i18n.format(`${LANG_PREFIX}.influence.relation`, {
          other: other.name,
          own: mine.name,
          stance: game.i18n.localize(`${LANG_PREFIX}.stance.${row.stance}`),
        }),
        value: 0,
        note: true,
      });
    }
  }
}
