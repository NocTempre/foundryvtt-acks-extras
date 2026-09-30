/* global game, Hooks, ui, foundry, fromUuid, console */
/**
 * The assessment day's roll, hosted by the influence feature: the Trade tab
 * opens the `marketAssessment` page against the market (see
 * `apps/trade-tab.mjs` `ventureAssess`), the page makes the Judge's secret
 * 2d6 with Charisma, a tone proficiency, a bribe and reaction effects on it,
 * and this listener turns the finished roll into the queued day — the roll
 * stored on the action for the sweep, the bribe paid to the market as the
 * day is posted. One roll posts one day.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { performVentureAction } from "./ventures.mjs";

/**
 * The pay a bribe to a market's merchants is priced against, as hit dice for
 * the influence page's wage ladder. A market has no hit dice; its merchants
 * are ordinary people, so the lowest rung is the default and the Judge
 * changes the fee on the page when the market's merchants are grander.
 */
export const assessmentBribeBasisHd = () => 1;

/** Rolls already posted (signature → ms), so a duplicate delivery of one roll posts one day. */
const seen = new Map();

/** Post the day a finished assessment roll describes; the outcome is reported like any other posting. */
async function postAssessmentDay(payload) {
  const context = payload.context;
  const sig = [context.locationUuid, context.actorUuid, payload.natural, payload.total].join(":");
  const nowMs = Date.now();
  for (const [k, t] of seen) if (nowMs - t > 15000) seen.delete(k);
  if (seen.has(sig)) return;
  seen.set(sig, nowMs);

  const doc = await fromUuid(context.locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return;
  const result = await performVentureAction(location, {
    kind: "assess",
    actorUuid: context.actorUuid,
    resolutionId: foundry.utils.randomID(),
    roll: { natural: payload.natural, total: payload.total },
    bribeGp: payload.bribe?.fee ?? 0,
  });
  if (result?.error) {
    ui.notifications.warn(game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: 0, table: "", crowd: "", ...result }));
  } else if (result?.ok) {
    ui.notifications.info(game.i18n.localize(`${LANG}.ventures.posted`));
    location.sheet?.rendered && location.sheet.render();
  } else if (!game.user.isGM) {
    ui.notifications.info(game.i18n.localize(`${LANG}.relay.sent`));
  }
}

/** Listen for the page's roll; every other roll is someone else's. */
export function registerAssessmentListener() {
  Hooks.on("acksExtras.influenceRollComplete", (payload) => {
    if (payload?.context?.module !== MODULE_ID || payload.mode !== "marketAssessment") return;
    postAssessmentDay(payload).catch((err) => console.error(`${MODULE_ID} | posting the assessment day failed`, err));
  });
}
