/* global game */
/**
 * What scene search says: a refusal in words, and the Judges' card a rolled check
 * posts. The card carries the die, the target and the source, which are the
 * Judges' alone; the table's log (`session-logic.mjs` `logRowOf`) holds none of
 * them. The card also carries the throw's figures in a flag, for the Judge's
 * screen to read.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { autoCardRow } from "../formation/party-rolls.mjs";

const ROOT = "ACKS-LOCATION.sceneSearch.";

/** The flag under the module's scope on the Judges' card that holds the throw's figures (`{total, target, success}`), read by the Judge's screen. */
export const ROLL_FLAG = "sceneRoll";

/** A refusal's `scene:` code as a sentence; a code with no words reads as the generic line. A refusal for a figure nobody imported has no words and answers an empty string. */
export function sceneReasonText(reason, name = "") {
  if (reason === "scene:notImported") return "";
  const code = typeof reason === "string" && reason.startsWith("scene:") ? reason.slice(6) : "";
  const key = `${ROOT}reason.${code}`;
  return code && game.i18n.has(key) ? game.i18n.format(key, { name }) : game.i18n.localize(`${ROOT}reason.other`);
}

/**
 * Post the Judges' card for one rolled check: one row with the total, the
 * target and the source, and the answer the check gave. A check that threw
 * nothing posts nothing.
 */
export function postRollCard({ formation, actor, rolled, outcome }) {
  if (!rolled) return null;
  const row = rolled.row;
  const html = renderRollCard({
    title: game.i18n.localize(`${ROOT}card.title`),
    subtitle: formation.name,
    note: game.i18n.localize(`${ROOT}outcome.${String(outcome.code).replace("scene:", "")}`),
    sections: [
      {
        rows: [
          row.auto
            ? autoCardRow(row)
            : {
                name: actor.name,
                detail: row.source,
                total: row.total,
                target: row.target,
                targetTooltip: game.i18n.format("ACKS-FORMATION.audit.checkTip", { target: `${row.target}+`, source: row.sourceTip }),
                outcome: game.i18n.localize(`ACKS-FORMATION.rolls.${row.success ? "success" : "failure"}`),
                emphasis: row.success ? "success" : "failure",
              },
        ],
      },
    ],
  });
  const throwFigures = row.auto ? {} : { total: row.total, target: row.target, success: row.success === true };
  return postToJudges({ content: html, rolls: rolled.roll ? [rolled.roll] : [], speaker: { alias: formation.name }, flags: { [MODULE_ID]: { [ROLL_FLAG]: throwFigures } } });
}
