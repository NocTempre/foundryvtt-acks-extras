/* global game, foundry */
/**
 * Calling a travel day done.
 *
 * The journey's own tracker is the hex trace: the party token's movement is
 * what counts hexes, and the day is spent when it has entered as many as the
 * march can carry it. That much is arithmetic. Ending the day is not — the
 * party may push on into a forced march, and a day that ended itself mid-drag
 * would spend the provisions, roll tomorrow's sky and advance the calendar for
 * a decision nobody made. So the tracker RAISES the question and the Judge
 * answers it.
 *
 * Asked once per day, and again if the answer bought more road: the offer flag
 * lives on the day board and no kind change carries it.
 */
import { travelOf, endDay, setDayKind, dayIsSpent } from "./travel.mjs";
import { travelReadout } from "./formation-view.mjs";
import { getFormation, partySpeed, patchFormation } from "./formation-model.mjs";
import { rollDayEncounters } from "./encounter-card.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Close the day: log what the panel was showing, then throw for whatever the
 * day's activities drew.
 *
 * The one closer, so the button and the tracker's own offer can never end a
 * day two different ways. The figures come from the readout rather than from a
 * second derivation inside the engine, so the log records what the Judge saw.
 */
export async function closeDay(formation) {
  const r = travelReadout(formation, partySpeed(formation));
  const entry = await endDay(formation.id, {
    miles: r.camp ? 0 : r.milesPerDay,
    hexes: r.camp ? 0 : r.hexesPerDay,
  });
  if (entry) await rollDayEncounters(getFormation(formation.id), entry);
  return entry;
}

/** Remember that the question has been put, so a drag does not put it again. */
function markOffered(formationId) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = { ...t, day: { ...t.day, offered: true } };
  });
}

/**
 * Ask, once, whether a spent day is over.
 *
 * The flag is written BEFORE the dialog is awaited: a party crossing several
 * hexes in one drag arrives here once per hex, and an unanswered dialog would
 * otherwise stack one prompt per crossing behind the first.
 *
 * @returns {Promise<"ended"|"pushed"|"later"|null>} null when nothing was asked.
 */
export async function offerDayEnd(formationId) {
  const formation = getFormation(formationId);
  if (!formation || !game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "journey" || t.day.offered) return null;

  const readout = travelReadout(formation, partySpeed(formation));
  if (readout.camp || !dayIsSpent(t.day, readout.hexesPerDay)) return null;

  await markOffered(formationId);

  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("travel.dayEnd.title") },
    classes: ["acks-ui", "acks-extras"],
    content: `<p>${loc("travel.dayEnd.body", {
      hexes: t.day.hexesEntered, allowance: readout.hexesPerDay,
    })}</p>`,
    buttons: [
      { action: "end", label: loc("travel.dayEnd.end"), default: true },
      { action: "push", label: loc("travel.dayEnd.push") },
      { action: "later", label: loc("travel.dayEnd.later") },
    ],
    rejectClose: false,
  });

  // The party is on the road either way; only the answer differs.
  const fresh = getFormation(formationId);
  if (!fresh) return null;
  if (answer === "end") {
    await closeDay(fresh);
    return "ended";
  }
  if (answer === "push") {
    // A forced march is the day-kind, not a modifier: it buys its distance by
    // spending every ancillary hour on the road, and `setDayKind` prices that.
    await setDayKind(formationId, "forced");
    return "pushed";
  }
  return "later";
}
