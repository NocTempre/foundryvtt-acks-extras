/* global game, foundry, Roll, ChatMessage, Hooks */
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
 * tables a monster met while marching would be. The hour is spent on the day
 * board and the world clock (`spendSearchHour`), and `acksExtras.searchHourSpent`
 * announces it with the hex it was spent in.
 *
 * Whether there is anything to find is the hex's stock ([hex-stock-run.mjs](./hex-stock-run.mjs))
 * or the Judge's own word. A stock-fed hour credits the throws that beat the
 * target, marks a lone find, lists several for the Judge to pick from, and
 * tries a Land Surveying attempt when the order holds the proficiency.
 */
import { makeLoc, gmIds } from "../lib/util.mjs";
import { paintedTerrainAt } from "../battlemap/terrain-paint.mjs";
import { travelOf } from "./travel.mjs";
import { expeditionMiles } from "./formation-view.mjs";
import { getFormation, getPartyScene, hasAbility, realMembers } from "./formation-model.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { hexContext, spendSearchHour } from "./journey.mjs";
import { searchSpec, searchOutcome, SEARCH_SUBJECTS } from "./searching.mjs";
import { postEncounterThrow } from "./encounter-card.mjs";
import { unfoundPoints } from "./hex-stock.mjs";
import {
  creditSearchHere, hexStockView, markPointFound, readStock, surveyHex, trueHexOf,
} from "./hex-stock-run.mjs";

const loc = makeLoc("ACKS-FORMATION");
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** The three answers to "is there anything here": the stock's, or the Judge's yes or no. */
const PRESENT_MODES = Object.freeze(["stock", "yes", "no"]);

/** A legacy boolean maps `true` to `yes` and `false` to `no`; anything unrecognised reads as `no`. */
function presentMode(present) {
  if (present === true) return "yes";
  return PRESENT_MODES.includes(present) ? present : "no";
}

/** Whether any real member of the order holds Tracking. */
function trackerIn(formation) {
  return realMembers(formation).some((member) => {
    const actor = game.actors?.get(member.actorId);
    return !!actor && (hasCapability(actor, "kw:tracking") || hasAbility(actor, /tracking/i));
  });
}

/** A point as the candidate list names it: its own name, else its kind. */
const candidateOf = (point) => ({ id: point.id, name: point.name || loc(`hexStock.kinds.${point.kind}`) });

/**
 * Search a hex for one hour.
 *
 * `present` is `"stock"`, `"yes"` or `"no"` (a boolean maps to `yes` or `no`).
 * `yes` and `no` are the Judge's own answer to "is there anything here" and
 * leave the stock unread and unwritten; `stock` reads the party's true hex for
 * a point this formation has not found yet. Either way the module never tells
 * the party which an empty result was: the outcome distinguishes a miss from
 * empty ground WITHOUT saying so.
 *
 * `target` is `"anything"`, a point id, or `"elsewhere"`. Any choice but
 * `anything` makes the hunt specific; `elsewhere` also forces nothing here to
 * find, and a point id narrows a stock-fed hour to that one point.
 *
 * `aerial` follows the party's movement mode and the canopy ground is read at
 * the hex the party really stands in, so an astray party is priced where it is.
 *
 * Resolves `{ ok, found, attempts, encounter, candidates, credited, survey }`:
 * `candidates` are the unfound points a stock-fed find could be (`[{ id, name }]`),
 * `credited` is whether the stock took a search credit, and `survey` is the
 * automatic Land Surveying result or null.
 */
export async function runSearchHour(formation, {
  subject = "pointOfInterest", specific = false, present = "no", target = "anything", movingQuarry = false,
} = {}) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const mode = presentMode(present);
  const elsewhere = target === "elsewhere";
  const pointTarget = target && target !== "anything" && !elsewhere ? String(target) : null;
  const isSpecific = !!specific || elsewhere || !!pointTarget;

  const here = trueHexOf(formation);
  const ground = here?.astray && here.center ? (paintedTerrainAt(here.scene, here.center).ground ?? t.ground) : t.ground;
  const spec = searchSpec({
    milesPerDay: expeditionMiles(formation),
    subject,
    specific: isSpecific,
    movingQuarry,
    mode: t.movement?.mode === "flying" ? "aerial" : "onFoot",
    terrain: ground,
    tracking: trackerIn(formation),
  });
  if (!spec.ok) {
    await whisperSearch({ unpriced: spec.missing ?? spec.reason });
    return { ok: false, missing: spec.missing, candidates: [], credited: false, survey: null };
  }

  // The stock answers only when asked, and only for a hex that holds one. A
  // hunt for something elsewhere finds nothing here whatever the stock holds.
  let record = null;
  let pool = [];
  if (mode === "stock" && here) {
    record = readStock(here.scene, here.key);
    if (record?.stocked && !elsewhere) {
      pool = unfoundPoints(record, formation.id);
      if (pointTarget) pool = pool.filter((p) => p.id === pointTarget);
    }
  }
  const hasStock = mode === "stock" && !!record?.stocked;
  const thereIsOne = !elsewhere && (mode === "yes" || pool.length > 0);

  // An hour is six turns; a faster cadence buys proportionally more throws.
  const throws = Math.max(1, Math.round(6 / (spec.turnsPerThrow || 6)));
  const attempts = [];
  let found = false;
  for (let n = 0; n < throws && !found; n++) {
    const roll = await new Roll(spec.modifier ? `1d20 + ${spec.modifier}` : "1d20").evaluate();
    const outcome = searchOutcome({ rolled: roll.total, target: spec.target, present: thereIsOne });
    attempts.push({ total: roll.total, beat: outcome.found || outcome.reason === "nothingHere", ...outcome });
    if (outcome.found) found = true;
  }

  // The stock takes its credit per throw that beat the target, empty hex or
  // not, and a lone candidate is marked found at once.
  let credited = false;
  let candidates = [];
  if (hasStock) {
    for (const a of attempts) {
      if (!a.beat) continue;
      await creditSearchHere(formation);
      credited = true;
    }
    if (found) {
      candidates = pool.map(candidateOf);
      if (candidates.length === 1) await markPointFound(formation, candidates[0].id);
    }
  }

  await spendSearchHour(formation.id);

  // The cost of looking: one encounter throw for the hour, whatever was found.
  // A party that searches all day is a party that meets things all day.
  let encounter = null;
  try {
    encounter = await postEncounterThrow(formation, { activity: "search" });
  } catch (err) {
    console.error("acks-extras | the search's encounter throw failed", err);
  }

  await whisperSearch({
    spec, attempts, found, subject, throws, formationId: formation.id,
    choices: candidates.length > 1 ? candidates : [],
  });

  // Land Surveying rides the hour when the order has the proficiency, the hex
  // is stocked and this order holds no reading of it yet.
  let survey = null;
  if (hasStock && hexStockView(formation)?.canSurvey) {
    const fresh = readStock(here.scene, here.key);
    if (fresh?.stocked && !fresh.assessments?.[formation.id]) survey = await surveyHex(formation, { auto: true });
  }

  const fresh = getFormation(formation.id) ?? formation;
  Hooks.callAll("acksExtras.searchHourSpent", {
    formationId: formation.id,
    ...hexContext(fresh, getPartyScene(fresh)),
    subject,
    specific: isSpecific,
    attempts: attempts.length,
    found,
    present: thereIsOne,
  });
  return { ok: true, found, attempts, encounter, candidates, credited, survey };
}

/**
 * The hour as one Judge-side card. `choices` are the several unfound points a
 * find could be: each carries a button the chat-card binding
 * (`installHexStockCardActions`) turns into "this one was found".
 */
async function whisperSearch({
  spec = null, attempts = [], found = false, subject = "", throws = 1, unpriced = null, formationId = "", choices = [],
}) {
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
    if (spec.notes?.includes("tracking")) lines.push(loc("searchRun.tracking"));
    if (spec.notes?.includes("trackingUnpriced")) lines.push(loc("searchRun.trackingUnpriced"));
    for (const a of attempts) {
      lines.push(a.found
        ? loc("searchRun.found", { total: a.total })
        : loc(a.reason === "nothingHere" ? "searchRun.nothingHere" : "searchRun.missed", { total: a.total }));
    }
    if (!found) lines.push(loc("searchRun.silence"));
  }
  lines.push(loc("searchRun.watched"));

  const candidates = choices.length
    ? `<div class="candidates"><p>${esc(loc("searchRun.candidates"))}</p><ul>`
      + choices.map((c) => `<li><span>${esc(c.name)}</span> `
        + `<button type="button" class="acks-extras-hex-found" data-formation-id="${esc(formationId)}" data-point-id="${esc(c.id)}">`
        + `${esc(loc("searchRun.markFound"))}</button></li>`).join("")
      + "</ul></div>"
    : "";

  await ChatMessage.create({
    speaker: { alias: loc("searchRun.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-search-card"><h3>${loc("searchRun.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>${candidates}</div>`,
  });
}
