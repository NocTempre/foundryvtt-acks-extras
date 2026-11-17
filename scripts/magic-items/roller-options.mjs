/**
 * What the Judge's roller window offers, as plain data: pure, no Foundry. The
 * lists come from `starts()` (the imported tables, labelled by their captions);
 * the words come from the localizer passed in. A list the import did not read is
 * offered disabled and marked "not imported", never omitted and never
 * replaced by a name this module holds.
 */
import { STYLES } from "./constants.mjs";

/** Which of the window's pickers a style uses: the category picks classic lists, the rarity the heroic and gritty ones. */
export function appliesTo(style) {
  return { category: style === "classic", rarity: style === "heroic" || style === "gritty" };
}

/** Whether anything at all can be rolled from these starts. */
export function rollable(starts) {
  return !!(starts?.classicType || starts?.classic?.length || starts?.heroic?.length);
}

/**
 * The window's three pickers.
 *
 * @param {object} starts the result of `starts()`
 * @param {object} options
 * @param {function} options.loc `loc(key, data) -> string`, the feature's localizer
 * @param {string} [options.style] the style to open on; the first one that can be rolled by default
 * @returns {{styles: object[], categories: object[], rarities: object[], style: string,
 *   categoryOff: boolean, rarityOff: boolean}} each option is `{value, label, selected,
 *   disabled}`; a picker is off (`categoryOff`, `rarityOff`) where the open style does not use it
 */
export function rollerContext(starts, { loc, style } = {}) {
  const classicReady = !!(starts?.classicType || starts?.classic?.length);
  const heroicReady = !!starts?.heroic?.length;
  const ready = { classic: classicReady, heroic: heroicReady, gritty: heroicReady };
  const open = STYLES.includes(style) && ready[style] ? style : STYLES.find((s) => ready[s]) ?? STYLES[0];

  const absent = (name) => loc("option.absent", { name });
  const option = (value, label, available, selected = false) => ({
    value,
    label: available ? label : absent(label),
    disabled: !available,
    selected: available && selected,
  });

  const styles = STYLES.map((s) => option(s, loc(`style.${s}`), ready[s], s === open));

  const categories = [
    option("", loc("option.rollType"), !!starts?.classicType),
    ...(starts?.classic ?? []).map((c) => option(c.key, c.caption ?? c.id, true)),
  ];
  const firstCategory = categories.find((o) => !o.disabled);
  if (firstCategory) firstCategory.selected = true;

  const rarities = heroicReady
    ? starts.heroic.map((h, i) => option(h.key, h.caption ?? h.id, true, i === 0))
    : [{ value: "", label: loc("option.noneImported"), disabled: true, selected: false }];

  const uses = appliesTo(open);
  return { styles, categories, rarities, style: open, categoryOff: !uses.category, rarityOff: !uses.rarity };
}

/**
 * The arguments of `rollAndPost` from the window's picked values: the category
 * only for a classic roll (none means the type list), the rarity only for a
 * heroic or gritty one.
 *
 * @param {{style?: string, category?: string, rarity?: string}} values
 * @returns {{style: string, category?: string, rarity?: string}}
 */
export function rollArgs({ style, category, rarity } = {}) {
  const uses = appliesTo(style);
  const args = { style };
  if (uses.category && category) args.category = category;
  if (uses.rarity && rarity) args.rarity = rarity;
  return args;
}
