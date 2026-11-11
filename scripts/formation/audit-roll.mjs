/* global game */
import { makeLoc } from "../lib/util.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { auditLine } from "../lib/roll-dialog.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { evaluateThrow, labelOf, measures } from "../abilities/ability-rolls.mjs";
import { abilityKey } from "./ability-bridge.mjs";
import { getMemberActor, isDown, realMembers } from "./formation-model.mjs";
import { boundChecks, rollCheckFor } from "./party-rolls.mjs";

/**
 * The skill audit's whole-party roll: one ability, every member who holds it,
 * one card.
 *
 * An ability a party check takes (`boundChecks`) rolls that check's resolved
 * throw for each holder, through `rollCheckFor`: the target the Resolution table
 * shows, with the same parts. Any other ability rolls the default throw of the
 * holder's own copy through `evaluateThrow`. Neither posts, so the party's
 * results land on a single grouped card (`renderRollCard`, the shape a party
 * check posts) whispered to the Judges like every other card the exploration
 * party posts. A member who is not rolling is named in the card's footnote with
 * the reason: the ability is not on their sheet, it offers no throw or no check
 * can be made from it, they are down, or the roll failed. A rung
 * that is automatic or not yet open to the member is a row of its own, since
 * the member did answer. A party in which nobody rolls still posts, and the
 * card says so. Nothing is advanced: an audit roll is not a turn spent.
 */

const loc = makeLoc("ACKS-FORMATION");

/** What follows a target on a throw of each kind. */
const SUFFIX = Object.freeze({ above: "+", below: "-", result: "" });

/** A bonus as written: signed, with a true minus. */
const signed = (n) => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;

/**
 * Where a rolled target came from: the throw it is the ability's, the base the
 * member's own figures give it, and each standing bonus by name.
 */
function targetTip(ev, label) {
  const suffix = SUFFIX[ev.type] ?? "+";
  const parts = ev.modifiers
    .map((part) => `${part.kind === "score" ? part.label : loc(`audit.part.${part.kind}`)} ${signed(part.value)}`)
    .join(", ");
  const data = { target: `${ev.target}${suffix}`, base: `${ev.base}${suffix}`, throw: label, parts };
  return loc(parts ? "audit.targetTip" : "audit.targetTipBare", data);
}

/**
 * One member's row for a party check's throw: the row the party card prints
 * (`rollCheckFor`), with the target's tooltip naming its source and each part
 * the member's own figures give it.
 */
function checkRowFor({ roll, row }) {
  return {
    name: row.name,
    detail: row.source,
    total: row.total,
    tooltip: auditLine(roll) || roll.formula,
    target: row.target,
    targetTooltip: loc("audit.checkTip", { target: `${row.target}+`, source: row.sourceTip }),
    outcome: game.i18n.localize(`ACKS-FORMATION.rolls.${row.success ? "success" : "failure"}`),
    emphasis: row.success ? "success" : "failure",
  };
}

/** One member's row on the card, for an ability's own throw. */
function rowFor(actor, item, ev) {
  const label = [item.name, ev.roll.label].filter(Boolean).join(" — ");
  const row = { name: actor.name };

  if (ev.outcome === "auto") {
    return {
      ...row,
      detail: game.i18n.format("ACKS-ABILITIES.roll.autoDetail", { cell: ev.verdict.text || "—" }),
      total: "—",
      outcome: game.i18n.localize("ACKS-FORMATION.rolls.success"),
      emphasis: "success",
    };
  }
  if (ev.outcome === "none") {
    return {
      ...row,
      detail: game.i18n.format("ACKS-ABILITIES.roll.noneDetail", { cell: ev.verdict.text || "—" }),
      total: "—",
    };
  }

  const out = {
    ...row,
    detail: label || labelOf(ev.roll),
    total: ev.total,
    tooltip: auditLine(ev.evaluated) || ev.evaluated.formula,
  };
  if (ev.target == null) {
    // Said on the row, in place of a number: a target that did not resolve is not a failure.
    if (!measures(ev.roll)) {
      out.detail = `${out.detail} — ${game.i18n.localize(ev.actor ? "ACKS-ABILITIES.roll.noRung" : "ACKS-ABILITIES.roll.noTarget")}`;
    }
    return out;
  }
  return {
    ...out,
    target: ev.target,
    targetSuffix: SUFFIX[ev.type] ?? "+",
    targetTooltip: targetTip(ev, label),
    outcome: game.i18n.localize(`ACKS-FORMATION.rolls.${ev.success ? "success" : "failure"}`),
    emphasis: ev.success ? "success" : "failure",
  };
}

/**
 * Roll an ability for every member of the party who holds it, and whisper one
 * grouped card to the Judges.
 *
 * @param {object} formation the party
 * @param {object} ability
 * @param {string} ability.key   the ability's identity (`abilityKey`): every member's copy answers to it
 * @param {string} ability.name  the name the card is titled with
 * @returns {Promise<{rolled: number, lacking: string[], noThrow: string[], cannot: string[], down: string[], failed: string[]}>}
 *   how many members rolled, and the names of those who did not, by reason
 */
export async function rollAbilityForParty(formation, { key, name }) {
  const rows = [];
  const dice = [];
  const skipped = { lacking: [], noThrow: [], cannot: [], down: [], failed: [] };
  const checks = new Set();

  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor) continue;
    const item = actor.items.find((i) => i.type === ITEM_TYPE.ability && abilityKey(i) === key);
    if (!item) {
      skipped.lacking.push(actor.name);
      continue;
    }
    if (isDown(actor, member)) {
      skipped.down.push(actor.name);
      continue;
    }
    try {
      // An ability a party check takes rolls that check's resolved throw, the
      // one the Resolution table shows for this member; any other rolls its own.
      const bound = boundChecks(item)[0];
      if (bound) {
        const rolled = await rollCheckFor(actor, bound.cfg);
        if (!rolled) {
          skipped.cannot.push(actor.name);
          continue;
        }
        checks.add(game.i18n.localize(bound.cfg.label));
        dice.push(rolled.roll);
        rows.push(checkRowFor(rolled));
        continue;
      }
      const ev = await evaluateThrow(item);
      if (!ev) {
        skipped.noThrow.push(actor.name);
        continue;
      }
      if (ev.evaluated) dice.push(ev.evaluated);
      rows.push(rowFor(actor, item, ev));
    } catch (err) {
      console.error("acks-extras | a skill audit roll could not be made", err);
      skipped.failed.push(actor.name);
    }
  }

  const footnote = Object.entries({
    lacking: "audit.rollLacking",
    noThrow: "audit.rollNoThrow",
    cannot: "audit.rollCannot",
    down: "audit.rollDown",
    failed: "audit.rollFailed",
  })
    .filter(([reason]) => skipped[reason].length)
    .map(([reason, langKey]) => loc(langKey, { names: skipped[reason].join(", ") }))
    .join(" ");

  const html = renderRollCard({
    title: name,
    subtitle: formation.name,
    note: [loc("audit.rollNote"), checks.size ? loc("audit.rollVia", { checks: [...checks].join(", ") }) : ""].filter(Boolean).join(" "),
    sections: [{ rows }],
    footnote: footnote || undefined,
    empty: loc("audit.rollNobody", { name }),
  });
  await postToJudges({ content: html, rolls: dice, speaker: { alias: formation.name } });
  return { rolled: rows.length, ...skipped };
}
