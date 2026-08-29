/* global game, Roll, ChatMessage */
/**
 * An hour spent looking, resolved.
 *
 * [searching.mjs](./searching.mjs) prices the throw and owns no dice. This
 * rolls it, and — the half that matters at the table — makes the party PAY for
 * looking: RAW gives a searching party one wandering-monster throw per hour,
 * which is what turns "search until you find it" from a free action into a
 * decision.
 *
 * The encounter is thrown through the journey's own chain rather than a second
 * one of ours, so a monster found while searching is drawn from exactly the
 * tables a monster met while marching would be.
 */
import { makeLoc, gmIds } from "../lib/util.mjs";
import { travelOf } from "./travel.mjs";
import { searchSpec, searchOutcome, SEARCH_SUBJECTS } from "./searching.mjs";
import { postEncounterThrow } from "./encounter-card.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Search a hex for one hour.
 *
 * `present` is the Judge's own answer to "is there anything here" — the module
 * never invents one, because whether a lair sits in this hex is the Judge's
 * map, not a table. It is passed in so the outcome can distinguish a miss from
 * empty ground WITHOUT telling the party which it was.
 *
 * `aerial` and `terrain` decide the cadence: from the air over open country the
 * hour buys more than one throw.
 */
export async function runSearchHour(formation, {
  subject = "pointOfInterest", specific = false, present = false,
  aerial = false, movingQuarry = false,
} = {}) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const spec = searchSpec({
    milesPerDay: Number(t.readoutMiles) || 0,
    subject, specific, movingQuarry,
    mode: aerial ? "aerial" : "onFoot",
    terrain: t.ground,
  });
  if (!spec.ok) {
    await whisperSearch({ unpriced: spec.missing ?? spec.reason });
    return { ok: false, missing: spec.missing };
  }

  // An hour is six turns; a faster cadence buys proportionally more throws.
  const throws = Math.max(1, Math.round(6 / (spec.turnsPerThrow || 6)));
  const attempts = [];
  let found = false;
  for (let n = 0; n < throws && !found; n++) {
    const roll = await new Roll(spec.modifier ? `1d20 + ${spec.modifier}` : "1d20").evaluate();
    const outcome = searchOutcome({ rolled: roll.total, target: spec.target, present });
    attempts.push({ total: roll.total, ...outcome });
    if (outcome.found) found = true;
  }

  // The cost of looking: one encounter throw for the hour, whatever was found.
  // A party that searches all day is a party that meets things all day.
  let encounter = null;
  try {
    encounter = await postEncounterThrow(formation, { activity: "search" });
  } catch (err) {
    console.error("acks-extras | the search's encounter throw failed", err);
  }

  await whisperSearch({ spec, attempts, found, subject, throws });
  return { ok: true, found, attempts, encounter };
}

/** The hour as one Judge-side card. */
async function whisperSearch({ spec = null, attempts = [], found = false, subject = "", throws = 1, unpriced = null }) {
  const lines = [];
  if (unpriced) {
    lines.push(loc("searchRun.unpriced", { what: String(unpriced) }));
  } else {
    lines.push(loc("searchRun.looking", {
      quarry: game.i18n.localize(SEARCH_SUBJECTS[subject]?.label ?? "ACKS-FORMATION.search.poi"),
      target: spec.target,
      modifier: spec.modifier,
      throws,
    }));
    for (const a of attempts) {
      lines.push(a.found
        ? loc("searchRun.found", { total: a.total })
        : loc(a.reason === "nothingHere" ? "searchRun.nothingHere" : "searchRun.missed", { total: a.total }));
    }
    if (!found) lines.push(loc("searchRun.silence"));
  }
  lines.push(loc("searchRun.watched"));

  await ChatMessage.create({
    speaker: { alias: loc("searchRun.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-search-card"><h3>${loc("searchRun.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
  });
}
