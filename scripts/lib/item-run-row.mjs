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
 *   `spent` with the press off and saying so once it has none.
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
const PRESS_ICONS = Object.freeze({ raise: "fa-solid fa-arrow-up", lower: "fa-solid fa-arrow-down", use: "fa-solid fa-hand-pointer", card: "fa-solid fa-message", spent: "fa-solid fa-ban" });

/** The button variant of each press, as the design system names them. */
const PRESS_VARIANTS = Object.freeze({ raise: "primary", lower: "secondary", use: "primary", card: "quiet", spent: "quiet" });

/** The action each press is bound to on a sheet; the card is opened, every other press goes through `Item#use`. */
const PRESS_ACTIONS = Object.freeze({ raise: "itemRunPress", lower: "itemRunPress", use: "itemRunPress", spent: "itemRunPress", card: "itemRunCard" });

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

/** One press (`raise`, `lower`, `use`, `card` or `spent`): its key, the action and label it carries, its tooltip, icon and variant, and whether it is off. A caller that draws a press off a sheet's item row takes its words from here. */
export function press(key, say, { disabled = false } = {}) {
  return { key, action: PRESS_ACTIONS[key], label: say(`row.press.${key}`), tip: say(`row.press.${key}Tip`), icon: PRESS_ICONS[key], variant: PRESS_VARIANTS[key], disabled };
}

/** The state tag of a row: the key, its words and the variant it wears. */
function tagOf(key, say, solid = false) {
  return { key, label: say(`row.tag.${key}`), variant: solid ? "solid" : "ghost" };
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
 * @param {(key: string, data?: object) => string} p.say the localizer, the keys under `itemRun.`
 * @returns {{kind: string, state: string, raised: boolean, tag: object, use: string, reach: object|null, count: object|null, ring: object|null, nothing: string, presses: object[]}}
 */
export function itemRunRowModel({ kind = "", active = false, stocked = true, runnable = false, owner = false, reach = null, engaged = null, card = null, use = "", say }) {
  const used = USED_UP_KINDS.includes(kind);
  const raised = kind === "toggle" && active === true;
  const state = !kind ? "always" : kind === "toggle" ? (raised ? "raised" : "lowered") : stocked ? "ready" : "spent";
  const base = { kind, state, raised, tag: tagOf(state, say, raised), use: "", reach: null, count: null, ring: null, nothing: "", presses: [] };
  if (!owner) return base;
  const presses = [];
  if (runnable && kind === "toggle") presses.push(...(raised ? [press("card", say), press("lower", say)] : [press("raise", say)]));
  else if (runnable && used) presses.push(stocked ? press("use", say) : press("spent", say, { disabled: true }));
  return {
    ...base,
    use,
    reach: reachLine(reach, say),
    count: raised ? countLine(card, reach, say) : null,
    ring: !kind && reach?.engaged ? ringLine(engaged, say) : null,
    nothing: !kind ? say("row.nothing") : "",
    presses,
  };
}
