/* global foundry, ui */
/**
 * What bars a forced march. A body whose survival rungs take `forceMarch` away
 * (`forbidden` in lib/survival.mjs) cannot be marched hard, so a party with one
 * such member among its marchers cannot be set to the forced day-kind unless
 * the Judge overrides. Every route that writes the forced kind asks here:
 * `setDayKind`, the sheet's day-kind form (`applyTravelForm`), and the dusk
 * offer's push answer. See docs/formation/DECISIONS.md, "A forced march is
 * barred by a marcher's survival state".
 */
import { getMemberActor, realMembers } from "./formation-model.mjs";
import { survivalStateOf } from "./provision-day.mjs";
import { announce } from "./announce.mjs";
import { forbidden } from "../lib/survival.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** The act a rung forbids that this bar enforces. */
const FORCE_MARCH = "forceMarch";

/**
 * The marching members a forced march is barred for, in roster order. A
 * marcher is a member holding an actor who is neither blank nor left behind.
 *
 * @param {object} formation  a formation record
 * @returns {{actorId: string, name: string}[]}
 */
export function forcedMarchBar(formation) {
  const barred = [];
  for (const member of realMembers(formation)) {
    if (member.left) continue;
    const actor = getMemberActor(member);
    if (!actor) continue;
    if (forbidden(survivalStateOf(actor)).includes(FORCE_MARCH)) {
      barred.push({ actorId: actor.id, name: actor.name });
    }
  }
  return barred;
}

/** The barred members' names as one readable list. */
export const barredNames = (barred) => barred.map((b) => b.name).join(", ");

/** Tell the pressing seat the forced march was refused, naming who bars it. */
export function warnForcedMarchBarred(barred) {
  ui.notifications?.warn(loc("warn.forcedMarchBarred", { names: barredNames(barred) }));
}

/**
 * Whisper the Judges that a barred forced march was set anyway. Only the
 * Judge's seat reaches it: an override is never honoured for a player.
 */
export function announceBarOverridden(formation, barred) {
  return announce(formation, loc("travel.forcedBar.note", { names: barredNames(barred) }), { whisper: true });
}

/**
 * Ask the Judge whether to set a barred forced march anyway. A Cancel, a
 * closed window and a rejected dialog all answer `false`.
 *
 * @param {{name: string}[]} barred  from `forcedMarchBar`
 * @returns {Promise<boolean>}
 */
export async function confirmBarOverride(barred) {
  const answer = await foundry.applications.api.DialogV2.confirm({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("travel.forcedBar.title") },
    content: `<p>${foundry.utils.escapeHTML(loc("travel.forcedBar.body", { names: barredNames(barred) }))}</p>`,
    yes: { label: loc("travel.forcedBar.override") },
    no: { label: loc("travel.forcedBar.cancel"), default: true },
    rejectClose: false,
  }).catch(() => false);
  return answer === true;
}
