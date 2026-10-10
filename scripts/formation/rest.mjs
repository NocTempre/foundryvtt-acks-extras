/* global game, Roll */
/**
 * A night's rest, applied: whether each body slept well, and where that leaves
 * its fatigue (RR 277-279).
 *
 * [lib/fatigue.mjs](../lib/fatigue.mjs) holds the ladder and is pure; this is
 * the impure half that reads each member, throws the armoured sleeper's die,
 * writes the body's fatigue state and the Fatigued condition, and tells the
 * Judge on one whispered card. It runs after the day closes, on the day's own
 * sky: `closeDay` captures the weather, camp and exposure BEFORE the end of the
 * day advances them, and passes them in.
 *
 * A body's fatigue belongs to the body, not to the marching order: the state is
 * a flag on the actor, like its hunger.
 */
import { MODULE_ID } from "./constants.mjs";
import { getMemberActor, hasAbility, realMembers } from "./formation-model.mjs";
import { sheltered } from "./provision-day.mjs";
import { conditionsOf } from "./weather.mjs";
import { weatherEffects } from "./weather-effects.mjs";
import {
  armourSleepThrow, donRounds, enduranceAllowance, fatigueOf, fatigueStep, restfulNight,
} from "../lib/fatigue.mjs";
import { borneWeight6 } from "../lib/capacity.mjs";
import { hasCapability } from "../lib/capabilities.mjs";
import { STONE } from "../lib/item-model.mjs";
import { conditionStacksOf, setConditionStacks } from "../lib/status-effects.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { makeLoc, numOrNull } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** Where a body's fatigue ladder lives. On the ACTOR, because it is the body's. */
export const FATIGUE_FLAG = "fatigue";

const LABOR = /\blabou?r\b/i;
const ENDURANCE = /\bendurance\b/i;

const oneDecimal = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** The lang key naming one reason a night was not restful. */
const nightReason = (key) => loc(`rest.reason.${key}`);

/** The lang key naming one reason fatigue moved. */
const fatigueReason = (key) => loc(`rest.fatigue.${key}`);

/**
 * One card row for one body's night.
 *
 * Detail lines are joined into the one cell: the armour throw when made, why
 * the night was not restful, and why the fatigue stacks moved.
 */
function rowOf(result) {
  const detail = [];
  if (result.armour) {
    detail.push(loc("rest.armourThrow", { roll: result.armour.roll, stone: oneDecimal(result.armour.stone) }));
  }
  if (!result.restful) detail.push(result.nightReasons.map(nightReason).join(", "));
  if (result.reasons.length) detail.push(result.reasons.map(fatigueReason).join(", "));
  return {
    name: result.name,
    total: result.stacks,
    detail: detail.join(" - "),
    outcome: loc(result.restful ? "rest.restful" : "rest.restless"),
    emphasis: result.restful ? "success" : "failure",
  };
}

/**
 * Walk every member through the night and post the result.
 *
 * Inputs are the closing day's, captured before the end of the day moved the
 * sky on. GM only; nothing happens for a formation with no members.
 *
 * @param {object} formation
 * @param {object} today
 * @param {object} today.weather   the day's weather (`travelOf(...).weather`)
 * @param {string} today.ground    the terrain the camp stood on
 * @param {{atHeatSource?: boolean}} today.exposure
 * @param {{kind?: string, noSleep?: boolean}} today.day  the day's kind and whether the night went unslept
 * @param {{sleepInArmour?: boolean}} today.camp
 * @returns {Promise<Array<object>|null>} one result per body, or null when nothing ran
 */
export async function runRestNight(formation, { weather = {}, ground = "", exposure = {}, day = {}, camp = {} } = {}) {
  if (!game.user?.isGM) return null;
  const actors = realMembers(formation ?? {}).map(getMemberActor).filter(Boolean);
  if (!actors.length) return null;

  const fx = weatherEffects(conditionsOf(weather ?? {}), { terrain: ground });
  const results = [];
  for (const actor of actors) {
    const warm = sheltered(actor);
    let armour = null;
    if (camp?.sleepInArmour) {
      const roll = (await new Roll("1d20").evaluate()).total;
      armour = { stone: borneWeight6(actor) / STONE, roll };
    }
    const night = restfulNight({
      noSleep: !!day?.noSleep, rest: fx.rest, atHeatSource: !!exposure?.atHeatSource, sheltered: warm, armour,
    });

    const labor = hasCapability(actor, "kw:labor") || hasAbility(actor, LABOR);
    const endurance = hasCapability(actor, "kw:endurance") || hasAbility(actor, ENDURANCE);
    const allowance = enduranceAllowance({
      endurance, labor, conBonus: numOrNull(actor.system?.scores?.con?.mod) ?? 0,
    }) ?? 0;

    const before = conditionStacksOf(actor, "fatigued");
    const step = fatigueStep(fatigueOf(actor.getFlag(MODULE_ID, FATIGUE_FLAG)), {
      dayKind: day?.kind ?? "march",
      restful: night.restful,
      forcedMarch: day?.kind === "forced",
      labor,
      allowance,
      stacks: before,
    });
    await actor.setFlag(MODULE_ID, FATIGUE_FLAG, step.state);
    await setConditionStacks(actor, "fatigued", step.stacks);

    results.push({
      actorId: actor.id,
      name: actor.name,
      restful: night.restful,
      nightReasons: night.reasons,
      armour: armour ? { ...armourSleepThrow(armour), donRounds: donRounds(armour.stone) } : null,
      sheltered: warm,
      before,
      stacks: step.stacks,
      reasons: step.reasons,
      unpriced: step.unpriced,
    });
  }

  const armoured = results.filter((r) => r.armour);
  const footnote = armoured
    .filter((r) => r.armour.donRounds != null)
    .map((r) => loc("rest.donRounds", { name: r.name, rounds: r.armour.donRounds }))
    .join("; ");
  await postToJudges({
    speaker: { alias: loc("rest.speaker") },
    content: renderRollCard({
      title: loc("rest.title"),
      subtitle: formation?.name ?? "",
      note: results.some((r) => r.unpriced) ? loc("rest.unpriced") : undefined,
      sections: [{ rows: results.map(rowOf) }],
      footnote: footnote || undefined,
      labels: { total: loc("rest.colFatigue"), result: loc("rest.colNight") },
    }),
  });
  return results;
}
