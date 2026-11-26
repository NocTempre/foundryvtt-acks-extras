/**
 * What an item the carrier runs draws on its row of a sheet (canvas 4, board
 * 4a), as data: its state tag, the line naming its use and its reach, the count
 * a raised one holds, the state an always-on engaged reach reads, and the
 * presses the seat is offered. The reading of the item (its figures, its card,
 * its ring) is the caller's (`item-run-row-view.mjs`); this module only decides
 * what the row says and which presses it offers. Foundry-free.
 *
 * - A toggle is `lowered` or `raised`: Raise on the first; Card and Lower on the
 *   second. No round is stored for a raise, so none is drawn.
 * - A `once`, `fuse` or `consume` item is `ready` with Use while it has stock, and
 *   `spent` with the press off and saying so once it has none. A fuse's press
 *   reads Light; while one burns the row is `lit` with the rounds it has left,
 *   and Light is offered only where the stack holds a spare.
 * - A `consume` item an owner holds also carries `left`, its swigs left: the
 *   figure, its label and a tooltip of where it came from. It is a control, not a
 *   press, so a caller that hides the presses still draws it.
 * - An item whose rows carry no activation is always on and has nothing to press;
 *   one whose reach is the engaged square also reads whether its ring stands.
 * - A press is offered only to an owner of the item (Foundry's own test, passed
 *   in as `owner`) and only for a kind some runner takes (`runnable`), since a
 *   press on any other reaches the system's own card. A seat that is not an owner
 *   reads the state tag and nothing else.
 */

/** The activation kinds whose item is used up rather than raised and lowered. */
const USED_UP_KINDS = Object.freeze(["once", "fuse", "consume"]);

/** The icon of each press, a Font Awesome class. */
const PRESS_ICONS = Object.freeze({ raise: "fa-solid fa-arrow-up", lower: "fa-solid fa-arrow-down", use: "fa-solid fa-hand-pointer", light: "fa-solid fa-fire", card: "fa-solid fa-message", spent: "fa-solid fa-ban" });

/** The button variant of each press, as the design system names them. */
const PRESS_VARIANTS = Object.freeze({ raise: "primary", lower: "secondary", use: "primary", light: "primary", card: "quiet", spent: "quiet" });

/** The action each press is bound to on a sheet; the card is opened, every other press goes through `Item#use`. */
const PRESS_ACTIONS = Object.freeze({ raise: "itemRunPress", lower: "itemRunPress", use: "itemRunPress", light: "itemRunPress", spent: "itemRunPress", card: "itemRunCard" });

/**
 * Whether an item has a row of the kind this module draws: it carries an
 * activation of a known kind, or no activation and at least one row with a
 * readable reach (always on). `run` is `itemRunOf(item)`, `reaches` the item's
 * rows that `readReach` accepts.
 *
 * @param {{run: object|null, reaches: object[]}} p
 * @returns {boolean}
 */
export const hasRunRow = ({ run, reaches }) => !!run || (reaches?.length ?? 0) > 0;

/**
 * One press (`raise`, `lower`, `use`, `light`, `card` or `spent`): its key, the
 * action and label it carries, its tooltip, icon and variant, and whether it is
 * off. `light` is a fuse's Use and takes its label from the item runner's own
 * `press.light`; every other press reads its words under `row.press.`. A caller
 * that draws a press off a sheet's item row takes its words from here.
 */
export function press(key, say, { disabled = false } = {}) {
  const label = key === "light" ? say("press.light") : say(`row.press.${key}`);
  return { key, action: PRESS_ACTIONS[key], label, tip: say(`row.press.${key}Tip`), icon: PRESS_ICONS[key], variant: PRESS_VARIANTS[key], disabled };
}

/** The state tag of a row: the key, its words and the variant it wears. A lit fuse's tag reads the strip's own words with the rounds it has left, and carries the tooltip that says so. */
function tagOf(key, say, solid = false, lit = null) {
  if (key === "lit") return { key, label: say("strip.tag.lit", { n: lit.n }), variant: "solid", tip: say("strip.tagTip.lit", { n: lit.n }) };
  return { key, label: say(`row.tag.${key}`), variant: solid ? "solid" : "ghost" };
}

/**
 * The count of swigs a drinkable item has left, as the row draws it: the figure
 * (null where none was rolled or typed), the label naming the field, and the
 * tooltip that says where the figure came from (the roll that set it, the hand
 * that typed it, or how a blank one is filled), with the item's page where it has
 * one.
 *
 * @param {{value: number|null, from: {by: string, formula?: string, total?: number}|null, cite: string}} p
 */
function leftLine({ value = null, from = null, cite = "" } = {}, say) {
  const page = String(cite ?? "");
  const fit = (text) => (page ? text : text.replace(/\s*\(\)$/, ""));
  let tip;
  if (value !== null && from?.by === "roll") tip = fit(say("row.leftTipRolled", { total: from.total, formula: from.formula, cite: page }));
  else if (value !== null && from?.by === "hand") tip = say("row.leftTipHand");
  else tip = fit(say("row.leftTipBlank", { cite: page }));
  return { value, label: say("row.left"), tip };
}

/**
 * What a row's quantity box reads as a stored swig count: "" or only whitespace
 * is no count (`left: null`), a whole number of none or more is that count, and
 * anything else (a fraction, a negative, words) is refused.
 *
 * @param {unknown} raw the box's text
 * @returns {{ok: true, left: number|null}|{ok: false}}
 */
export function parseRunLeft(raw) {
  if (raw === null || raw === undefined) return { ok: true, left: null };
  if (typeof raw === "number") return Number.isInteger(raw) && raw >= 0 ? { ok: true, left: raw } : { ok: false };
  const text = String(raw).trim();
  if (text === "") return { ok: true, left: null };
  return /^\d+$/.test(text) ? { ok: true, left: Number(text) } : { ok: false };
}

/**
 * The reach a row names: the engaged square (the page reference and tooltip the
 * module already ships for it), or a distance with the tooltip of where it came
 * from, which is the page alone where no figure was imported (`blank`).
 */
function reachLine(reach, say) {
  if (!reach) return null;
  if (reach.engaged) return { engaged: true, label: say("card.engagedNote"), tip: say("card.engagedNoteTip") };
  return { engaged: false, label: say("row.reaches"), feet: reach.feet ?? null, blank: reach.feet === null || reach.feet === undefined, tip: reach.tip ?? "", cite: reach.cite ?? "" };
}

/** What a raised row says of its card: the bodies it lists for this seat, with the parts that make the count. Null where the card is not readable. */
function countLine(card, reach, say) {
  if (!card || !Number.isFinite(card.inRange)) return null;
  const feet = reach?.feet;
  const tip = Number.isFinite(feet) ? say("row.inRangeTipOf", { n: card.inRange, feet }) : say("row.inRangeTip", { n: card.inRange });
  return { n: card.inRange, label: say("row.inRange", { n: card.inRange }), tip };
}

/** What an always-on engaged reach says of its ring: standing with the bodies it engages, or not made until the body is in a fight. */
function ringLine(engaged, say) {
  if (!engaged) return null;
  if (!engaged.stands) return { stands: false, label: say("row.ringNone"), tip: say("row.ringNoneTip") };
  return { stands: true, n: engaged.count, label: say("row.ringStands", { n: engaged.count }), tip: say("row.ringStandsTip", { n: engaged.count }) };
}

/**
 * The row of an item for a seat.
 *
 * @param {object} p
 * @param {string} [p.kind] the activation kind, "" for an item that is always on
 * @param {boolean} [p.active] a toggle's stored state
 * @param {boolean} [p.stocked] whether a used-up kind has anything left to use
 * @param {boolean} [p.runnable] whether a runner takes the kind, so the press reaches it
 * @param {boolean} [p.owner] whether the seat owns the item, by Foundry's own test
 * @param {{engaged: boolean, feet: number|null, tip: string, cite: string}|null} [p.reach] the row's reach as the caller read it; `feet` null where no figure was imported
 * @param {{stands: boolean, count: number}|null} [p.engaged] an always-on engaged reach's ring, read now
 * @param {{inRange: number|null}|null} [p.card] what a raised item's card lists for this seat
 * @param {string} [p.use] the activation's own words
 * @param {{n: number}|null} [p.lit] a fuse item's lit state: the rounds its soonest fuse has left; null where none is lit
 * @param {boolean} [p.spare] whether the stack holds one more than it has lit, so Light is offered while one burns
 * @param {{value: number|null, from: {by: string, formula?: string, total?: number}|null, cite: string}|null} [p.left] a `consume` item's swigs left, where they came from and the item's page
 * @param {(key: string, data?: object) => string} p.say the localizer, the keys under `itemRun.`
 * @returns {{kind: string, state: string, raised: boolean, tag: object, use: string, reach: object|null, count: object|null, ring: object|null, nothing: string, left: {value: number|null, label: string, tip: string}|null, presses: object[]}}
 */
export function itemRunRowModel({ kind = "", active = false, stocked = true, runnable = false, owner = false, reach = null, engaged = null, card = null, use = "", lit = null, spare = true, left = null, say }) {
  const used = USED_UP_KINDS.includes(kind);
  const raised = kind === "toggle" && active === true;
  const burning = kind === "fuse" && !!lit;
  const state = !kind ? "always" : kind === "toggle" ? (raised ? "raised" : "lowered") : burning ? "lit" : stocked ? "ready" : "spent";
  const base = { kind, state, raised, tag: tagOf(state, say, raised, lit), use: "", reach: null, count: null, ring: null, nothing: "", left: null, presses: [] };
  if (!owner) return base;
  const presses = [];
  if (runnable && kind === "toggle") presses.push(...(raised ? [press("card", say), press("lower", say)] : [press("raise", say)]));
  else if (runnable && kind === "fuse") {
    if (burning) {
      if (spare) presses.push(press("light", say));
    } else presses.push(stocked ? press("light", say) : press("spent", say, { disabled: true }));
  } else if (runnable && used) presses.push(stocked ? press("use", say) : press("spent", say, { disabled: true }));
  return {
    ...base,
    left: kind === "consume" ? leftLine(left ?? {}, say) : null,
    use,
    reach: reachLine(reach, say),
    count: raised ? countLine(card, reach, say) : null,
    ring: !kind && reach?.engaged ? ringLine(engaged, say) : null,
    nothing: !kind ? say("row.nothing") : "",
    presses,
  };
}
