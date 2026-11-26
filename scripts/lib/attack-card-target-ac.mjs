/* global game, Hooks */
/**
 * The attack card's line naming a condition inside a character target's Armor
 * Class. The system folds a character's condition effects into its prepared
 * `ac.value` and its card prints that one figure, so a figure the card counts
 * is named nowhere on it. This file reads the effects behind the figure when
 * the attack is rolled (`targetAcRows`, installed as the seam's reader in
 * `patches/attack-throw.mjs`), and draws one footer line from the stamp the seam
 * leaves on the card (`TARGET_AC_FLAG`). The line adds nothing to the throw.
 *
 * Two spans are drawn, one naming each condition with its signed step and one
 * naming it alone. The system's chat message removes whichever the viewer may
 * not see once the render hooks have run (`data-acks-visibility`), so this file
 * never tests the setting that hides the target's Armor Class. A monster
 * target's steps are terms on the throw itself (`status-effects.mjs`), so it
 * has a row only for a step its waiver spares, told as not counted with what
 * waived it and no figure. The line is drawn from the stamp and never
 * recomputed from the target, so an old card keeps what its throw counted.
 */
import { LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { acWaiverSources } from "./conditions.mjs";
import { TARGET_AC_FLAG, setTargetAcReader } from "./patches/attack-throw.mjs";
import { CONDITION_STEP_KEYS, acStepsCounted, conditionSteps, stepLabel } from "./roll-mods.mjs";
import { signed } from "./frame-model.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";
import { el, elementOf } from "./util.mjs";

/** The class on both spans, the mark a re-render removes them by. */
export const TARGET_AC_CLASS = "acks-extras-attack-card-target-ac";

/** The `data-acks-visibility` values the system's chat message keeps for the viewers who may, and may not, see the target's Armor Class. */
export const TARGET_AC_VISIBILITY = Object.freeze({ shown: "target-ac-shown", hidden: "target-ac-hidden" });

/** The footer of the system's attack card. */
const FOOTER_CLASS = "attack-throw-card__footer";

/** Marks a footer this file made, so a re-render removes it once it is empty again. */
const MADE_ATTRIBUTE = "data-acks-extras-footer";

/** A string of the card line's own lang branch (`targetAc`), with its `{name}` placeholders filled. */
const text = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.conditionRoll.targetAc.${key}`, data);

/**
 * The condition effects inside a target's Armor Class, as `[{name, value}]`:
 * each step the system's condition effects make to `system.ac.mod` that
 * Foundry applied (`conditionSteps`), by the effect's name and the step as it
 * stands in the effect (a bonus positive). A step the Armor Class waiver
 * spares is listed too on a character: its waiver is not applied, because the
 * system folded the step into the Armor Class shown. Any target whose
 * prepared Armor Class holds its steps (`acStepsCounted`) is read as a
 * character is.
 *
 * A monster's steps are terms on the throw, so a monster target has rows only
 * where its waiver spares a step the throw therefore does not count: those
 * rows are `{name, waived: true, by}`, with no figure, `by` the abilities that
 * waive it (`acWaiverSources`, `{name, cite}` each), and the steps the throw
 * does count come before them as they do on a character. Any other type has
 * none.
 *
 * @param {Actor|null} actor  the target's actor
 * @returns {Array<{name: string, value: number}|{name: string, waived: true, by: Array<{name: string, cite: string}>}>}
 */
export function targetAcRows(actor) {
  if (acStepsCounted(actor)) {
    const read = conditionSteps(actor, CONDITION_STEP_KEYS.ac);
    return [...read.steps, ...read.waived].map((step) => ({ name: stepLabel(step.effect, step.condition, step.type), value: step.value }));
  }
  if (actor?.type !== ACTOR_TYPE.monster) return [];
  const read = conditionSteps(actor, CONDITION_STEP_KEYS.ac);
  if (!read.waived.length) return [];
  const sources = acWaiverSources(actor);
  const byOf = (step) => {
    const ids = [step.condition, ...(step.effect?.statuses ?? [])];
    const found = ids.find((id) => sources.get(id)?.length);
    return (sources.get(found) ?? []).map((s) => ({ ...s }));
  };
  return [
    ...read.steps.map((step) => ({ name: stepLabel(step.effect, step.condition, step.type), value: step.value })),
    ...read.waived.map((step) => ({ name: stepLabel(step.effect, step.condition), waived: true, by: byOf(step) })),
  ];
}

/** Whether a stamped row is a waived step, which names no figure. */
const isWaived = (row) => row.waived === true;

/** The abilities a waived row names, each with its page where it has one, as text. */
const byText = (row) =>
  (Array.isArray(row.by) ? row.by : [])
    .filter((b) => b && typeof b.name === "string" && b.name)
    .map((b) => (b.cite ? text("waivedBy", { name: b.name, cite: b.cite }) : b.name))
    .join(", ");

/** A waived row as the line says it: its name and what waived it, or the name alone where nothing is named. */
const waivedText = (row) => {
  const by = byText(row);
  return by ? text("waivedRow", { name: row.name, by }) : row.name;
};

/**
 * The text and the tooltip of each span a stamp draws. The tooltip names the
 * effect, the target and the step, and says the step is already in the Armor
 * Class shown; the hidden span's names no step. A waived row (`waived: true`,
 * `by`) is told after the rows the Armor Class counts, in both spans and
 * without a figure, with what waived it and that ability's page. A stamp that
 * is not `{target, rows}` with at least one usable row draws nothing.
 *
 * @param {{target?: string, rows?: Array<{name: string, value?: number, waived?: boolean, by?: Array<{name: string, cite?: string}>}>}|null} stamp
 * @returns {{shown: {text: string, tip: string}, hidden: {text: string, tip: string}}|null}
 */
export function targetAcLine(stamp) {
  const rows = (Array.isArray(stamp?.rows) ? stamp.rows : []).filter((r) => r && typeof r.name === "string" && (isWaived(r) || Number.isFinite(r.value)));
  if (!rows.length) return null;
  const target = String(stamp.target ?? "");
  const counted = rows.filter((r) => !isWaived(r));
  const waived = rows.filter(isWaived);
  const names = counted.map((r) => r.name).join(", ");
  const waivedLine = waived.length ? text("waived", { rows: waived.map(waivedText).join("; ") }) : "";
  /** The two sections of one span's text: what the Armor Class counts, then what it does not. */
  const lineOf = (countedRows) => {
    if (!counted.length) return text("lineAlone", { waived: waivedLine });
    const head = text("line", { rows: countedRows });
    return waived.length ? text("lineJoin", { counted: head, waived: waivedLine }) : head;
  };
  const waivedTip = (row) => {
    const by = byText(row);
    return by ? text("tipWaivedRow", { name: row.name, target, by }) : text("tipWaivedBare", { name: row.name, target });
  };
  const shownTips = [
    ...counted.map((r) => text("tipRow", { name: r.name, target, value: signed(r.value) })),
    ...waived.map(waivedTip),
  ].join("; ");
  const hiddenTips = [
    counted.length ? text("tipHidden", { rows: names, target }) : "",
    waived.length ? text("tipHiddenWaived", { rows: waived.map(waivedText).join("; "), target }) : "",
  ].filter(Boolean).join(" ");
  return {
    shown: {
      text: lineOf(counted.map((r) => text("row", { name: r.name, value: signed(r.value) })).join(", ")),
      tip: text("tipShown", { rows: shownTips }),
    },
    hidden: {
      text: lineOf(names),
      tip: hiddenTips,
    },
  };
}

/** A span of the line: its class, its visibility mark and its tooltip. */
function span(visibility, { text: face, tip }) {
  const node = el("span", TARGET_AC_CLASS, face);
  node.dataset.acksVisibility = visibility;
  node.dataset.tooltipText = tip;
  return node;
}

/**
 * Draw the line on a rendered attack card: remove what an earlier render of
 * this element left, then append both spans to the card's footer, making the
 * footer where the card has none. A card with no stamp, or none the stamp
 * draws, is left as it is.
 */
function onRender(message, html) {
  const flag = message?.flags?.[MODULE_ID]?.[TARGET_AC_FLAG];
  const root = elementOf(html);
  const line = targetAcLine(flag);
  const card = root?.querySelector?.(".attack-throw-card");
  if (!line || !card) return;
  for (const old of card.querySelectorAll(`.${TARGET_AC_CLASS}`)) old.remove();
  for (const made of card.querySelectorAll(`[${MADE_ATTRIBUTE}]`)) if (!made.children.length) made.remove();
  let footer = card.querySelector(`.${FOOTER_CLASS}`);
  if (!footer) {
    footer = el("footer", FOOTER_CLASS);
    footer.setAttribute(MADE_ATTRIBUTE, "");
    card.append(footer);
  }
  footer.append(span(TARGET_AC_VISIBILITY.shown, line.shown), span(TARGET_AC_VISIBILITY.hidden, line.hidden));
}

let hooked = false;

/** Install the reader the attack seam calls at the roll and the render hook that draws the line, once. Called where lib registers its hooks. */
export function installAttackCardTargetAc() {
  if (hooked) return;
  hooked = true;
  setTargetAcReader(targetAcRows);
  Hooks.on("renderChatMessageHTML", onRender);
}
