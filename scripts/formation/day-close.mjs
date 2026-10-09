/* global game, foundry */
/**
 * Calling a travel day done. The tracker raises the question when the day's
 * hours have reached its budget, or the party marched on after dusk; the Judge
 * answers it. See docs/formation/DECISIONS.md, "The day's end is raised by
 * movement and answered by the Judge".
 */
import { travelOf, endDay, setDayKind, dayBudget, dayIsSpent } from "./travel.mjs";
import { travelReadout } from "./formation-view.mjs";
import { journeyNight } from "./journey.mjs";
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
  const day = travelOf(formation).day;
  const entry = await endDay(formation.id, {
    miles: Math.round(day.miles * 100) / 100,
    hexes: day.hexesEntered,
  });
  if (entry) await rollDayEncounters(getFormation(formation.id), entry);
  return entry;
}

const oneDecimal = (n) => Math.round((Number(n) || 0) * 10) / 10;

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

  // A camp day's budget is its travel slots alone, so with none it is never
  // spent by hours and only a step after dusk asks.
  const readout = travelReadout(formation, partySpeed(formation, { dark: false }));
  const budget = dayBudget(t, readout.milesPerHour ?? 0);
  const dark = journeyNight(t);
  if (!dayIsSpent(t.day, budget, { dark })) return null;

  await markOffered(formationId);

  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("travel.dayEnd.title") },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    content: `<p>${loc("travel.dayEnd.body", {
      miles: oneDecimal(t.day.miles), hours: oneDecimal(t.day.hours), budget: oneDecimal(budget.hours),
    })}${dark ? ` ${loc("travel.dayEnd.dark")}` : ""}</p>`,
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
