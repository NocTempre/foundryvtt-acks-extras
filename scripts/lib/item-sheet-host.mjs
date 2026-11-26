/**
 * Where a module's own group goes inside an item sheet, and the scroller that
 * holds it. Two sheets are met: the extras item sheet (equipment's
 * `AcksItemSheet`, a Details panel inside one body scroller) and the system's
 * item sheet (a `details` part that scrolls at its own root). A group goes
 * INSIDE that scroller, last in the Details tab, so it scrolls with the tab and
 * shows on no other: a block appended to `.window-content` sits outside every
 * part's scroller, keeps its full height, and takes it from the body.
 * Foundry-free: it reads a DOM subtree it is handed.
 */

/**
 * The selectors that name a Details host, first match wins: the extras item
 * sheet's Details panel (its inner stack, for the panel's own spacing), that
 * sheet's body when it has no tabs, and the system's `details` part.
 */
export const DETAILS_HOSTS = Object.freeze([
  '.acks-extras-item-sheet__panel[data-tab="details"] > .acks-extras-item-sheet__stack',
  '.acks-extras-item-sheet__panel[data-tab="details"]',
  ".acks-extras-item-sheet__scroll",
  '[data-application-part="details"]',
]);

/**
 * Every place a group may go, first match wins: the Details hosts, the
 * `description` part (the abilities sheet, whose Description tab holds the
 * properties that are not rolls) and `.window-content` for any other sheet.
 */
export const ITEM_SHEET_HOSTS = Object.freeze([...DETAILS_HOSTS, '[data-application-part="description"]', ".window-content"]);

/**
 * The element a group is appended to inside an item sheet's root.
 *
 * @param {Element} root the sheet's root element
 * @param {{detailsOnly?: boolean}} [options] `detailsOnly` limits the search to `DETAILS_HOSTS` and answers null where none is present, so a group that belongs on the Details tab is never placed outside it
 * @returns {Element|null} the host; the root itself where nothing matches and `detailsOnly` is not set
 */
export function findItemSheetHost(root, { detailsOnly = false } = {}) {
  const found = (detailsOnly ? DETAILS_HOSTS : ITEM_SHEET_HOSTS).reduce((hit, selector) => hit ?? root?.querySelector(selector), null);
  return found ?? (detailsOnly ? null : (root ?? null));
}

/**
 * The nearest element at or above `el`, within `root`, that scrolls vertically.
 * The computed style is read through the element's own window, so a sheet
 * rendered into a detached browser window answers for that window.
 *
 * @param {Element} el
 * @param {Element} root the sheet's root; the search stops at it
 * @returns {Element|null}
 */
export function scrollerOf(el, root) {
  const view = el.ownerDocument?.defaultView;
  for (let node = el; node && node !== root.parentElement; node = node.parentElement) {
    const overflowY = view?.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
