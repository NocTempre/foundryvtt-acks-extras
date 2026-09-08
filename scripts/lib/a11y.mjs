/**
 * Label association — a rendered window's `<label>`s bound to the controls they
 * front, and the ids that binding needs.
 *
 * Foundry's own `createFormGroup` already mints `rootId-name` ids and sets
 * `for`, but only for a group built from a DataField. Every hand-written form
 * group in this module, and every dialog whose body is a template literal,
 * ships a bare `<label>` beside its control: it names nothing, so a screen
 * reader falls back to the control's `name` or announces nothing, and a click
 * on the caption does nothing.
 *
 * The binding is made after render rather than written into the templates
 * because the id has to be unique per WINDOW, not per template. Two copies of
 * one sheet are ordinary, so a literal `id=` in a `.hbs` makes the second
 * window's label focus the first window's field. An application's root element
 * id is already unique, so it is the seed. The same reason rules out a static
 * `for=`: `templates/lib/follower-card.hbs` fronts an `<input>` or a `<span>`
 * from one caption depending on `editable`, and no static answer is right for
 * both.
 *
 * It runs on EVERY application, not only this module's. The defect is the same
 * one wherever it appears — the system's sheets and Foundry's own configuration
 * windows carry it too — and this module already repairs what it finds in the
 * layers beneath it (`patches/`). Repairing a window means adding an id where
 * there is none and a `for` where there is none, so a host that sets its own is
 * unaffected. A binding the host wrote is overruled only where it CANNOT work
 * and no reader can tell: a `for` naming an id no window holds, and the later
 * of two controls sharing one id. Both leave a field with no name at all, which
 * is the state this pass exists to end.
 *
 * What this does NOT do: it never invents a control, never rewrites a tag, and
 * never touches a `<label>` that fronts nothing. A caption that labels a
 * read-out is a template bug and is fixed in the template — a runtime tag swap
 * would silently un-style the 59 rules in `styles/` whose selectors name
 * `label`.
 */

/**
 * What a `<label>` may name. Foundry's form elements are form-associated custom
 * elements (`AbstractFormInputElement.formAssociated`), so they are labelable
 * and `for=` reaches them. `<multi-checkbox>` is the one that takes the
 * accessible name without taking focus — it assigns no `_primaryInput`, so the
 * name arrives and the click does nothing; the name is the point.
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

/**
 * A `<button>` is labelable but is a LAST resort, so it is absent from
 * `LABELABLE` and reached only through the fallback below. Label activation
 * forwards a click, so binding a caption to a button turns a stray click on the
 * text into whatever the button does. Where the group holds a field, the field
 * is what the caption names and the button is left alone; where the button is
 * all there is — core's settings menus are rows of exactly that shape — naming
 * it is better than naming nothing.
 */

/**
 * An id derived from the control's own name, so it reads like the ones core's
 * `createFormGroup` mints. A name is not unique on its own — a checkbox row
 * writes one name from several boxes — and a control may have no name at all,
 * so the stem is suffixed until nothing answers to it. `minted` carries the
 * ids made during this pass, because a detached fragment is not yet reachable
 * from `getElementById`.
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
 * Whether a control already announces a name — a `<label>` bound to it, a
 * `<label>` wrapping it, or an ARIA name written by the host. The four routes
 * are equivalent to a screen reader, so any one of them ends this pass's
 * interest in the control.
 */
function named(control) {
  return !!(control.labels?.length
    || control.closest("label")
    || control.getAttribute("aria-label")
    || control.getAttribute("aria-labelledby"));
}

/**
 * The control a caption fronts, or null when it fronts none.
 *
 * Candidates follow the label inside the label's own parent — the `.form-group`
 * in the standard shape, whatever wraps them in the flat one. Two exclusions
 * carry the whole judgement:
 *
 * - A control inside another `<label>` is already named by that label. This is
 *   what keeps a group heading off its first member: every checkbox in a
 *   `<label class="checkbox">` row is filtered out, so a heading over such a
 *   row finds nothing and is left alone rather than ticking the first box.
 * - A control inside a nested `.form-group` belongs to that group's own label.
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
 *
 * Idempotent, and re-run on every render because ApplicationV2 replaces a
 * part's HTML wholesale — the ids from the previous render leave with it.
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

  // Two controls answering to one id: `getElementById` hands every caption the
  // FIRST of them, so the later one is unreachable and its own caption names
  // its neighbour's field. Re-mint the loser and carry the caption that sits
  // with it — the one inside its group, not the one that answers to the id.
  const seen = new Set();
  for (const control of root.querySelectorAll(LABELABLE)) {
    const id = control.id;
    if (!id) continue;
    const holder = document.getElementById(id) ?? root.querySelector?.(`#${CSS.escape(id)}`);
    if (!seen.has(id) && !(holder && holder !== control && holder.matches(LABELABLE))) {
      seen.add(id);
      continue;
    }
    // The caption that names it sits WITH it, not with the control that keeps
    // the id. Walk out from the control until a `for` naming the old id turns
    // up, and stop before any scope that also holds the keeper — past that
    // point the two captions are one apiece and nothing tells them apart. The
    // group class is not a fixed name to search on: the shipped case pairs a
    // `.form-group-h` caption with a `.form-fields` child.
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
    // A `for` naming an element no window holds binds nothing — the caption is
    // as unnamed as one with no `for` at all, so it is rebound to what it
    // actually fronts. A `for` that resolves is the host's answer and stands.
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

  // A group with one caption and several controls — a width beside a height, a
  // relay toggle beside the channel it relays to — can bind the caption to only
  // one of them, because `for` names a single id. The others are left with no
  // name at all, which is the state this pass exists to end, so they borrow the
  // group's caption through `aria-labelledby`. The caption keeps its `for`: the
  // click target stays where the binding put it, and only the announced name
  // spreads. That is also why this reads a caption `for=` must refuse — one
  // inside a rollable header, say: naming forwards no click, so a caption that
  // cannot safely be made clickable can still be made to speak. A shared name
  // is imprecise where the group is a pair; nameless is worse, and the precise
  // fix is a caption per control in the template.
  for (const control of root.querySelectorAll(LABELABLE)) {
    if (named(control)) continue;
    const group = control.closest(".form-group");
    if (!group || !root.contains(group)) continue;
    const caption = group.querySelector("label");
    if (!caption || caption.contains(control)) continue;
    if (!caption.id) {
      // The caption already names one control; hanging its own id off that
      // one's keeps the pair legible in the DOM and unique by construction.
      const stem = caption.getAttribute("for") || mintId(control, prefix, minted);
      caption.id = `${stem}-caption`;
    }
    control.setAttribute("aria-labelledby", caption.id);
    bound++;
  }

  // A control read through a `data-*` selector carries no `name` on purpose —
  // a name would put its value in the submitted data, and on a sheet that
  // submits on change that writes a field nobody meant to set. It still needs
  // one handle, so it is given the id it would otherwise have no way to get.
  for (const control of root.querySelectorAll(LABELABLE)) {
    if (control.id || control.getAttribute("name")) continue;
    control.id = mintId(control, prefix, minted);
  }
  return bound;
}
