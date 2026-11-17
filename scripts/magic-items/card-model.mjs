/**
 * What a rolled magic item's chat card shows: pure, no Foundry. `chainCard`
 * turns a `rollMagicItem` result into the arguments of lib's `renderRollCard`;
 * the localizer is passed in, so a Node test drives it with invented words.
 *
 * Nothing here holds a caption, a page or a figure. The list names, the bands,
 * the dice and the pages are the result's, read from the imported tables when
 * the roll was made; the words around them are lang keys.
 */
import { textOf } from "./chain-logic.mjs";

/** The separator between the parts of a tooltip, as the module's other provenance lines join theirs. */
const JOIN = " · ";

/** A band as written for a reader: its one number, or its two edges. */
function bandText({ min, max }) {
  return min === max ? String(min) : `${min}–${max}`;
}

/**
 * What a step shows in the Total column: `1d100 = 57`, and for a nested tail
 * the outer face and the inner roll, `4 › 2`.
 */
export function rollText(step) {
  return step.inner ? `${step.total} › ${step.inner.total}` : `${step.die} = ${step.total}`;
}

/**
 * A step's tooltip, the parts that exist joined: the die (the tail's after the
 * outer's), the band it landed in, then where the list was read from: its
 * page, or "set by hand" where a Judge overrode the list. A list with no page
 * recorded adds nothing in its place.
 *
 * @param {object} step a step of a `rollMagicItem` result
 * @param {function} loc `loc(key, data) -> string`, the feature's localizer
 * @returns {string}
 */
export function stepTooltip(step, loc) {
  const dice = [step.die, step.inner?.die].filter(Boolean).join(" › ");
  const bands = [step.band, step.inner?.band].filter(Boolean).map(bandText).join(" › ");
  const source = step.overridden ? loc("card.tip.byHand") : step.cite ?? "";
  return [
    dice && loc("card.tip.die", { die: dice }),
    bands && loc("card.tip.band", { band: bands }),
    source,
  ].filter(Boolean).join(JOIN);
}

/**
 * The footnote a flagged item or a refused walk leaves, or "". A flag keeps
 * the item the chain reached; an error keeps the steps rolled before it.
 */
function footnoteOf(result, loc) {
  const flag = result.item?.flag;
  if (flag) return loc(`card.flag.${flag}`, { list: result.item.hop ?? result.item.list });
  if (result.error) return loc(`card.error.${result.error.code}`, { list: result.error.list });
  return "";
}

/**
 * The card for a rolled item, as `renderRollCard` arguments: a row per step (the
 * list's caption, the roll, the row's text beneath the caption), then an
 * "Item" section holding the final text, and a footnote where the chain was
 * flagged or stopped. A result with no steps has no rows, and
 * `renderRollCard` answers "" for it.
 *
 * @param {object} result a `rollMagicItem` result
 * @param {object} options
 * @param {function} options.loc `loc(key, data) -> string`, the feature's localizer
 * @param {string} [options.style] "classic", "heroic" or "gritty": the banner's subtitle
 * @returns {object} the argument of `renderRollCard`
 */
export function chainCard(result, { loc, style } = {}) {
  const rows = (result.steps ?? []).map((step) => ({
    name: step.caption ?? step.list,
    total: rollText(step),
    detail: textOf(step.fields ?? {}) ?? undefined,
    tooltipText: stepTooltip(step, loc),
  }));
  const sections = [{ rows }];
  const text = result.ok ? result.item?.text : null;
  if (text) sections.push({ title: loc("card.itemTitle"), rows: [{ name: text, total: "", emphasis: "neutral" }] });
  return {
    title: loc("card.title"),
    subtitle: style ? loc(`style.${style}`) : undefined,
    sections,
    footnote: footnoteOf(result, loc) || undefined,
  };
}
