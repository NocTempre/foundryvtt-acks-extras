/* global document, foundry */
/**
 * The marks a page of this client carries, on every page the client draws in:
 * its look, theme and type size, and core's own mark on a detached page. See
 * docs/lib/MODEL.md's client-settings section.
 */

/** The detached browser windows core lists, less any that has closed. */
function detachedWindows() {
  const open = [];
  for (const { window: win } of foundry.applications.detached?.windows.values() ?? []) {
    if (!win.closed) open.push(win);
  }
  return open;
}

/**
 * Every page this client draws in: the main document, then the document of
 * each detached browser window core lists, less any that has closed.
 *
 * @returns {Document[]}
 */
export function clientPages() {
  return [document, ...detachedWindows().map((win) => win.document)];
}

/**
 * Mark every page as drawn in the `core` look, or release the mark: the
 * `data-acks-look` attribute on `<html>`, and the `acks-lib-sheet-theme`
 * class on `<body>`, which holds while the attribute does not.
 */
export function pinLook(core) {
  for (const page of clientPages()) {
    if (core) page.documentElement.setAttribute("data-acks-look", "core");
    else page.documentElement.removeAttribute("data-acks-look");
    page.body?.classList.toggle("acks-lib-sheet-theme", !core);
  }
}

/**
 * Pin the ACKS palette to `mode`, `light` or `dark`, on every page's `<html>`,
 * or release it with null.
 */
export function pinTheme(mode) {
  for (const page of clientPages()) {
    if (mode) page.documentElement.setAttribute("data-acks-theme", mode);
    else page.documentElement.removeAttribute("data-acks-theme");
  }
}

/**
 * Set the type knob `--acks-fs-base` to `px` pixels on every page's `<html>`,
 * or release it with null so the stylesheet's value governs.
 */
export function pinFontScale(px) {
  for (const page of clientPages()) {
    if (px == null) page.documentElement.style.removeProperty("--acks-fs-base");
    else page.documentElement.style.setProperty("--acks-fs-base", `${px}px`);
  }
}

/** Each detached `<body>` already under watch for core's mark. */
const watched = new WeakSet();

/**
 * Keep core's own `detached` class on the `<body>` of every detached page.
 * Core puts it there as the page opens and writes the main page's whole
 * `class` over it at each interface pass, which takes it off, and core's
 * rules for a detached page with it. Each `<body>` is watched once, by an
 * observer of its own window, and the class goes back when a write leaves it
 * out. The class is tested for before it is written: a write to `class`
 * queues a record whether or not it changed the value, so an unconditional
 * one would answer its own record without end.
 */
export function keepDetachedMarks() {
  for (const win of detachedWindows()) {
    const { body } = win.document;
    if (!body || watched.has(body)) continue;
    watched.add(body);
    const mark = () => {
      if (!body.classList.contains("detached")) body.classList.add("detached");
    };
    mark();
    new win.MutationObserver(mark).observe(body, { attributes: true, attributeFilter: ["class"] });
  }
}
