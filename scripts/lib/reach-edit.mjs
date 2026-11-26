/**
 * The reach group of the effect-row editor, as data: what its controls read
 * off a row's stored `reach`, and the edit a submitted group makes to it.
 * Foundry-free.
 *
 * The editor submits the whole group on every change of any field, so an edit
 * is a diff: each control is compared with what the stored reach already
 * shows, and only a control that differs writes, member by member. A reach no
 * control changed comes back as the very object stored, and a row that holds
 * none stays without one unless a control is moved off its neutral position.
 *
 * The group owns six things: the item's use (`itemRun.activation.kind`, an
 * item-level setting the editor writes through the store's carrier, never the
 * row), the distance or the engaged adjacent square (`reach.engaged`, with the
 * pulse that goes with Engaged), who counts (`reach.filter.side`), the kinds
 * counted and left out (`reach.filter.kinds`, `exceptKinds`) and whether the
 * Region is drawn for every seat (`reach.showReach`). It never writes `radius`,
 * `save`, `immunity`, `lasts`, `modifier`, `on`, `saveWhen`, `filter.unit` or
 * `filter.self`: those arrive through the importer. Only Engaged has a pulse
 * the group writes; a hand-made distance reach is left with none, and
 * `readReach` reads a reach with no pulse as acting on nothing. Switching
 * Engaged back to a distance removes the engaged pulse (the runtime engages on
 * it) and leaves any other stored pulse alone.
 */
import { ITEM_RUN_ACTIVATIONS } from "./vocab.mjs";

/** The pulse an engaged reach acts on (`aura-reach.mjs` tests the engagement on it). */
export const ENGAGED_PULSE = "turnStart+enter";

/** The options of "Who counts", each mapped to the `REACH_SIDES` key it writes to `reach.filter.side`. */
export const SIDE_OPTIONS = Object.freeze({ foe: "opposing", side: "own", all: "any" });

/** The options of "How it is used", in the order shown. */
export const USE_OPTIONS = Object.freeze(["toggle", "spent", "always"]);

/** The activation kinds "Used up" stands for: every kind that is not a toggle. */
const SPENT_KINDS = Object.freeze(Object.keys(ITEM_RUN_ACTIVATIONS).filter((kind) => kind !== "toggle"));

/**
 * The "How it is used" option a stored activation kind reads as: `toggle`
 * raised and lowered, `spent` for any of `once`, `fuse` and `consume`, and
 * `always` where there is no kind the runner knows.
 */
export const useOptionOf = (kind) => (kind === "toggle" ? "toggle" : SPENT_KINDS.includes(kind) ? "spent" : "always");

/**
 * The activation kind an option writes, given the kind stored now: `toggle`;
 * for `spent` the stored kind where it is already one of the spent kinds, else
 * `once`; null for `always`, which removes the activation.
 * @returns {string|null}
 */
export function useKindFor(option, stored) {
  if (option === "toggle") return "toggle";
  if (option === "spent") return SPENT_KINDS.includes(stored) ? stored : "once";
  return null;
}

/** The "Who counts" option a stored `filter.side` reads as; any value but the two sides reads as Everyone. */
export const sideOptionOf = (side) => Object.keys(SIDE_OPTIONS).find((option) => SIDE_OPTIONS[option] === side) ?? "all";

/** A stored word list as trimmed lowercase words, none blank. */
const wordsOf = (list) => (Array.isArray(list) ? list : []).map((word) => String(word ?? "").trim().toLowerCase()).filter(Boolean);

/** A word a checkbox name can carry: the shape `kindToken` folds a key to. */
const offerable = (word) => /^[a-z0-9-]+$/.test(word);

/** Whether two word lists hold the same words. */
const sameWords = (a, b) => a.length === b.length && a.every((word) => b.includes(word));

/**
 * What the group's controls show for a stored reach (any shape, null for none):
 * the neutral position for a row with no reach.
 * @returns {{engaged: boolean, side: string, kinds: string[], exceptKinds: string[], showReach: boolean}}
 */
export function reachControls(stored) {
  const reach = stored && typeof stored === "object" ? stored : {};
  return {
    engaged: reach.engaged === true,
    side: sideOptionOf(reach.filter?.side),
    kinds: wordsOf(reach.filter?.kinds),
    exceptKinds: wordsOf(reach.filter?.exceptKinds),
    showReach: reach.showReach === true,
  };
}

/**
 * The keys a kinds pick offers: the closed keys, then any stored word outside
 * them that a checkbox can name, so a stored kind stays offered and ticked
 * instead of being dropped by the first tick.
 * @param {string[]} closed `kindKeys(types)`
 * @param {...string[]} stored the stored word lists the pick must keep offering
 */
export function kindOptions(closed, ...stored) {
  const extra = stored.flatMap(wordsOf).filter((word) => offerable(word) && !closed.includes(word));
  return [...new Set([...closed, ...extra])];
}

/**
 * The reach a submitted group leaves on a row.
 *
 * @param {object|null|undefined} stored the row's stored reach, as it is stored
 * @param {{mode?: string, side?: string, kinds?: string[], exceptKinds?: string[], showReach?: boolean}} fragment
 *   the controls as submitted; a control the window did not submit is absent and changes nothing
 * @returns {object|null|undefined} `stored` itself where no control differs from what it shows
 */
export function mergeReachEdit(stored, fragment) {
  if (!fragment || typeof fragment !== "object") return stored;
  const shown = reachControls(stored);
  let next = null;
  const edit = () => (next ??= { ...(stored && typeof stored === "object" ? stored : {}), filter: { ...(stored?.filter ?? {}) } });
  if ("mode" in fragment && (fragment.mode === "engaged") !== shown.engaged) {
    const reach = edit();
    reach.engaged = fragment.mode === "engaged";
    // Engaged writes its pulse; a distance takes the engaged pulse back off, since the runtime engages on it. Any other stored pulse stays.
    if (reach.engaged) reach.pulse = ENGAGED_PULSE;
    else if (reach.pulse === ENGAGED_PULSE) delete reach.pulse;
  }
  if (fragment.side in SIDE_OPTIONS && fragment.side !== shown.side) edit().filter.side = SIDE_OPTIONS[fragment.side];
  for (const name of ["kinds", "exceptKinds"]) {
    if (!Array.isArray(fragment[name])) continue;
    const want = [...new Set(wordsOf(fragment[name]))];
    // A stored word no checkbox can name is not the pick's to drop.
    if (sameWords(want, shown[name].filter(offerable))) continue;
    edit().filter[name] = [...want, ...shown[name].filter((word) => !offerable(word))];
  }
  if ("showReach" in fragment && (fragment.showReach === true) !== shown.showReach) edit().showReach = fragment.showReach === true;
  if (!next) return stored;
  if (stored?.filter === undefined && !Object.keys(next.filter).length) delete next.filter;
  return next;
}
