/* global game, foundry */
/**
 * Calling a travel day done. The tracker raises the question when the hex
 * trace shows the day spent; the Judge answers it. See
 * docs/formation/DECISIONS.md, "The day's end is raised by movement and
 * answered by the Judge".
 */
import { travelOf, endDay, setDayKind, dayIsSpent } from "./travel.mjs";
import { travelReadout } from "./formation-view.mjs";
import { getFormation, partySpeed, patchFormation } from "./formation-model.mjs";
import { rollDayEncounters } from "./encounter-card.mjs";
import { makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Close the day: log what the panel was showing, then throw for whatever the
 * day's activities drew. The one closer — the button and the tracker's own
 * offer both go through it.
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
 * Ask, once, whether a spent day is over. The offered flag is written before
 * the dialog is awaited, so a multi-hex drag cannot stack one prompt per
 * crossing.
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
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
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
    // A forced march is the day-kind, not a modifier; `setDayKind` prices it.
    await setDayKind(formationId, "forced");
    return "pushed";
  }
  return "later";
}
