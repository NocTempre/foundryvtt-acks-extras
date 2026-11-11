/**
 * Keyboard focus across a press that re-renders its window. ApplicationV2
 * replaces a part's HTML wholesale, so the control a user just pressed is
 * detached and `document.activeElement` falls to `<body>`: a keyboard user
 * loses their place after every press. `PressFocus` remembers which
 * `[data-action]` control was pressed and puts focus back on its successor.
 *
 * One window owns one instance: `note` at the press (a capture-phase click on
 * the window's root, so it runs before the action's handler), `restore` once
 * the render has finished. Foundry-free, and it never tests a node with
 * `instanceof` or builds nodes: a window first rendered in a detached browser
 * window is made by that window's document, so its nodes are no instance of
 * the main window's classes. Nodes are told by `nodeType === 1`, and every
 * document read goes through the root's own `ownerDocument`.
 */

/**
 * How long after a press a render still counts as the press's own. The render
 * a press causes follows its document write, so it arrives within one round
 * trip; a render later than this is nobody's press and gets no focus.
 */
export const PRESS_FOCUS_TTL_MS = 3000;

/** Every control an action can sit on. */
const ACTIONABLE = "[data-action]";

/** An element node, whichever window's document built it. */
const isElement = (node) => !!node && node.nodeType === 1;

/**
 * The attributes that name a control among its siblings: its `data-*` set,
 * less the tooltip pair, whose text is assembled at render and so differs
 * between the press and its re-render. Sorted into one string so two controls
 * compare by `===`.
 */
function identity(el) {
  return Object.entries(el.dataset ?? {})
    .filter(([key]) => !key.startsWith("tooltip"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

/** The action controls under `root` that share `id` as their identity, in document order. */
const matching = (root, id) => [...root.querySelectorAll(ACTIONABLE)].filter((el) => identity(el) === id);

/** Focus sits nowhere: nothing holds it, or the document's body does (what a detached control leaves). */
function focusIsLost(doc) {
  const active = doc?.activeElement;
  return !active || active === doc.body || active === doc.documentElement;
}

/**
 * The remembered press of one window. At most one press is pending: a new
 * press replaces the last.
 */
export class PressFocus {
  #pending = null;

  /**
   * Remember a press, when focus was inside `root` at the press. The control
   * is the nearest `[data-action]` element at or above `target`; it is named
   * by its whole `data-*` identity, plus its position among the controls
   * sharing that identity, since a row's buttons repeat theirs.
   *
   * @param {Node} target     The click's event target.
   * @param {HTMLElement} root The window's root element.
   * @param {number} [now]    The clock, in ms; a parameter so a test can drive it.
   */
  note(target, root, now = Date.now()) {
    this.#pending = null;
    if (!isElement(root) || !isElement(target) || typeof target.closest !== "function") return;
    const control = target.closest(ACTIONABLE);
    if (!control || !root.contains(control)) return;
    const active = root.ownerDocument?.activeElement;
    if (!isElement(active) || !root.contains(active)) return;
    const id = identity(control);
    const same = matching(root, id);
    this.#pending = { id, index: same.indexOf(control), count: same.length, at: now };
  }

  /**
   * Put focus back on the control the remembered press names, if the press
   * is recent, focus was lost to the render, and that control exists exactly
   * once as before. Where the control is gone, ambiguous or disabled, nothing
   * is focused. A press stays remembered across renders until the window
   * after it lapses, a new press replaces it, or a render finds focus held
   * (by another window, or a field the user has since entered): one press can
   * write more than once, and each write's render detaches the control again.
   *
   * @param {HTMLElement} root The window's root element, after the render.
   * @param {number} [now]     The clock, in ms.
   * @returns {HTMLElement|null} The control focused, or null.
   */
  restore(root, now = Date.now()) {
    const pending = this.#pending;
    if (!pending) return null;
    if (now - pending.at > PRESS_FOCUS_TTL_MS || !isElement(root)) {
      this.#pending = null;
      return null;
    }
    // Focus held anywhere means the press is over: the user, another window or
    // a field has it now, and a later render must not take it back.
    if (!focusIsLost(root.ownerDocument)) {
      this.#pending = null;
      return null;
    }
    const same = matching(root, pending.id);
    if (same.length !== pending.count) return null;
    const control = same[pending.index];
    if (!control || control.disabled) return null;
    control.focus({ preventScroll: true });
    return control;
  }
}
