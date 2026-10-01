/* global game, foundry */
/**
 * A window title its header cuts short, shown whole on a hover. See
 * docs/lib/MODEL.md, "A window title cut short".
 */

/** The dress classes that make an application root an ACKS surface. */
const SURFACE = ".acks-ui, .acks-palette";

/** Titles already watched: a window's frame outlives its renders. */
const watched = new WeakSet();

/**
 * Whether a one-line element's text runs past its box. The second reading is
 * in fractions of a pixel: `scrollWidth` and `clientWidth` are whole numbers,
 * and read equal while the text overflows by under half a pixel, which the
 * browser already ends in an ellipsis.
 */
function overflows(el) {
  if (el.scrollWidth > el.clientWidth) return true;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > el.getBoundingClientRect().width;
}

/**
 * The text a title's header is hiding, or null when the title shows whole or
 * its window is not wearing the ACKS dress.
 *
 * @param {HTMLElement} title a window's `.window-title`
 * @returns {string|null}
 */
export function clippedTitle(title) {
  if (!title?.isConnected || !title.closest(".application")?.matches(SURFACE)) return null;
  if (!overflows(title)) return null;
  return title.textContent.trim() || null;
}

/**
 * Watch one window's title: a hover held for the tooltip manager's own delay,
 * on a title that is cut short at that moment, shows the whole text in
 * Foundry's tooltip, above the title or below it where the viewport's top
 * leaves no room. Idempotent per window. A press cancels a pending tooltip and
 * dismisses a showing one, since the title is the window's drag handle.
 *
 * @param {HTMLElement} root an application's root element
 */
export function watchWindowTitle(root) {
  const title = root?.querySelector?.(":scope > .window-header .window-title");
  if (!title || watched.has(title)) return;
  watched.add(title);

  let pending = null;
  const cancel = () => {
    clearTimeout(pending);
    pending = null;
  };
  const show = () => {
    pending = null;
    // The manager's one tooltip element carries a tour's step while one runs.
    if (foundry.nue.Tour.tourInProgress) return;
    const text = clippedTitle(title);
    if (!text) return;
    const { UP, DOWN } = game.tooltip.constructor.TOOLTIP_DIRECTIONS;
    game.tooltip.activate(title, { text, direction: UP });
    // With no room above, the manager pins the tooltip inside the viewport,
    // over the title: it goes below instead.
    if (game.tooltip.tooltip.getBoundingClientRect().bottom > title.getBoundingClientRect().top) {
      game.tooltip.activate(title, { text, direction: DOWN });
    }
    // The tooltip repeats the heading's own text, so it describes nothing.
    title.removeAttribute("aria-describedby");
  };

  title.addEventListener("pointerenter", () => {
    cancel();
    // As the manager does for its own: at once from a tooltip already showing.
    if (game.tooltip.element) show();
    else pending = setTimeout(show, game.tooltip.constructor.TOOLTIP_ACTIVATION_MS);
  });
  title.addEventListener("pointerleave", cancel);
  title.addEventListener("pointerdown", () => {
    cancel();
    if (game.tooltip.element === title) game.tooltip.deactivate();
  });
}
