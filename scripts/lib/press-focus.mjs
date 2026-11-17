/**
 * Keyboard focus across a press that re-renders its window. ApplicationV2
 * replaces a part's HTML wholesale, so the control a user just pressed is
 * detached and `document.activeElement` falls to `<body>`: a keyboard user
 * loses their place after every press. `PressFocus` remembers which
 * `[data-action]` control was pressed and puts focus back on its successor.
 *
 * One window owns one instance: `note` at the press (a capture-phase click on
 * the window's root, so it runs before the action's handler), `restore` once
 * the render has finished. A press whose control does not survive the render
 * (a button that is only drawn while its row can act) lands on its row's home
 * instead: the nearest ancestor marked `data-press-home="<row key>"`, which
 * carries `tabindex="-1"` so it can hold focus. Foundry-free, and it never tests a node with
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

/** A row that takes focus when the control pressed inside it is gone: keyed by its `data-press-home` value. */
const HOME = "[data-press-home]";

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
    const home = control.closest(HOME);
    this.#pending = {
      id, index: same.indexOf(control), count: same.length, at: now,
      home: home && root.contains(home) ? (home.dataset?.pressHome ?? null) : null,
    };
  }

  /**
   * Put focus back on the control the remembered press names, if the press
   * is recent, focus was lost to the render, and that control exists exactly
   * once as before. Where the control is gone, ambiguous or disabled, the row
   * it sat in (`data-press-home`) takes focus; with no such row nothing is
   * focused. A press stays remembered across renders until the window
   * after it lapses, a new press replaces it, or a render finds focus held
   * (by another window, or a field the user has since entered): one press can
   * write more than once, and each write's render detaches the control again.
   *
   * @param {HTMLElement} root The window's root element, after the render.
   * @param {number} [now]     The clock, in ms.
   * @returns {HTMLElement|null} The control, or its row, focused; null if neither.
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
    const control = same.length === pending.count ? same[pending.index] : null;
    if (control && !control.disabled) {
      control.focus({ preventScroll: true });
      return control;
    }
    // The control did not survive: the row it sat in takes focus, if it has a home.
    const home = pending.home === null ? null : [...root.querySelectorAll(HOME)].find((el) => el.dataset?.pressHome === pending.home);
    if (!home || typeof home.focus !== "function") return null;
    home.focus({ preventScroll: true });
    return home;
  }
}
