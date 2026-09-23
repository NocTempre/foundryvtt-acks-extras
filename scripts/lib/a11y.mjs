/**
 * Label association — binds a rendered window's `<label>`s to the controls
 * they front, and mints the ids that binding needs. Runs on every application,
 * not only this module's. See docs/lib/MODEL.md, "Label association".
 */

/**
 * What a `<label>` may name: Foundry's form-associated custom elements plus
 * native form controls. `<multi-checkbox>` takes the accessible name without
 * taking focus (it assigns no `_primaryInput`).
 */
export const LABELABLE = [
  "input:not([type=hidden])",
  "select",
  "textarea",
  "meter",
  "output",
  "progress",
  "prose-mirror",
  "multi-select",
  "multi-checkbox",
  "string-tags",
  "file-picker",
  "color-picker",
  "range-picker",
  "document-tags",
  "formula-input",
  "hue-slider",
  "autocomplete-tags",
  "code-mirror",
].join(",");

// `<button>` is labelable but is a last resort, reached only through the
// fallback below: naming it is better than naming nothing, but a field in the
// same group always wins the binding.

/**
 * An id derived from the control's own `name`, suffixed until unique.
 * `minted` tracks ids made during this pass, since a detached fragment is not
 * yet reachable from `getElementById`.
 */
function mintId(control, seed, minted) {
  const name = control.getAttribute("name");
  const stem = name ? name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") : "f";
  const taken = (id) => minted.has(id) || !!document.getElementById(id);
  let id = `${seed}-${stem}`;
  for (let n = 2; taken(id); n++) id = `${seed}-${stem}-${n}`;
  minted.add(id);
  return id;
}

/**
 * Whether a control already announces a name — bound `<label>`, wrapping
 * `<label>`, or an ARIA name the host wrote.
 */
function named(control) {
  return !!(control.labels?.length
    || control.closest("label")
    || control.getAttribute("aria-label")
    || control.getAttribute("aria-labelledby"));
}

/**
 * The control a caption fronts, or null when it fronts none. Candidates
 * follow the label inside the label's own parent, excluding a control already
 * inside another `<label>` (so a group heading never ticks its first member)
 * or inside a nested `.form-group` (which belongs to that group's own label).
 */
function controlFor(label, root) {
  const scope = label.parentElement;
  if (!scope || !root.contains(scope)) return null;
  const ownGroup = label.closest(".form-group");
  let button = null;
  for (const control of scope.querySelectorAll(`${LABELABLE},button`)) {
    const after = label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!after) continue;
    if (control.closest("label")) continue;
    if (control.closest(".form-group") !== ownGroup) continue;
    if (control.tagName === "BUTTON") { button ??= control; continue; }
    return control;
  }
  return button;
}

/**
 * Bind every unbound `<label>` under `root` to the control it fronts.
 * Idempotent, and safe to re-run on every render — ApplicationV2 replaces a
 * part's HTML wholesale, so each render needs its own pass.
 *
 * @param {HTMLElement} root      The subtree to bind — a window's whole root, or
 *                                the fragment an injector just built when it
 *                                lands after the render hook.
 * @param {object}   [options]
 * @param {string}   [options.seed] Prefix for minted ids; defaults to the
 *                                enclosing application's element id, which
 *                                Foundry already guarantees unique.
 * @returns {number} How many labels were bound.
 */
export function associateLabels(root, { seed } = {}) {
  if (!root?.querySelectorAll) return 0;
  const prefix = seed
    ?? root.closest?.(".application")?.id
    ?? root.id
    ?? foundry.utils.randomID();
  const minted = new Set();
  const exists = (id) =>
    !!id && (!!document.getElementById(id) || !!root.querySelector?.(`#${CSS.escape(id)}`));

  // Two controls sharing one id: `getElementById` resolves to the first, so
  // the later one is re-minted and its own caption carried across with it.
  const seen = new Set();
  for (const control of root.querySelectorAll(LABELABLE)) {
    const id = control.id;
    if (!id) continue;
    const holder = document.getElementById(id) ?? root.querySelector?.(`#${CSS.escape(id)}`);
    if (!seen.has(id) && !(holder && holder !== control && holder.matches(LABELABLE))) {
      seen.add(id);
      continue;
    }
    // The caption naming this control sits with it, not with the id's keeper:
    // walk out until a `for` naming the old id turns up, stopping before any
    // scope that also holds the keeper.
    let caption = null;
    for (let scope = control.parentElement; scope && root.contains(scope); scope = scope.parentElement) {
      if (holder && scope.contains(holder)) break;
      caption = scope.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (caption) break;
    }
    control.id = mintId(control, prefix, minted);
    if (caption) caption.htmlFor = control.id;
  }

  let bound = 0;
  for (const label of root.querySelectorAll("label")) {
    // A `for` naming an id no window holds is treated as absent and rebound.
    if (label.hasAttribute("for") && exists(label.htmlFor)) continue;
    if (label.querySelector(LABELABLE)) continue;
    // A caption inside something already clickable would add a second effect to
    // one gesture.
    const interactive = label.parentElement?.closest("[data-action], a, button");
    if (interactive && root.contains(interactive)) continue;

    const control = controlFor(label, root);
    if (!control) continue;
    if (!control.id) control.id = mintId(control, prefix, minted);
    label.htmlFor = control.id;
    bound++;
  }

  // `for` names a single id, so a group with more than one control leaves the
  // rest silent once the first is bound; they borrow the group's caption
  // through `aria-labelledby` (the caption keeps its `for`).
  for (const control of root.querySelectorAll(LABELABLE)) {
    if (named(control)) continue;
    const group = control.closest(".form-group");
    if (!group || !root.contains(group)) continue;
    const caption = group.querySelector("label");
    if (!caption || caption.contains(control)) continue;
    if (!caption.id) {
      // Hung off the control the caption already names, so the pair stays
      // legible in the DOM and unique by construction.
      const stem = caption.getAttribute("for") || mintId(control, prefix, minted);
      caption.id = `${stem}-caption`;
    }
    control.setAttribute("aria-labelledby", caption.id);
    bound++;
  }

  // A control read through a `data-*` selector carries no `name` on purpose,
  // so a submit-on-change form does not write an unrecognised path; it still
  // needs a handle.
  for (const control of root.querySelectorAll(LABELABLE)) {
    if (control.id || control.getAttribute("name")) continue;
    control.id = mintId(control, prefix, minted);
  }
  return bound;
}
