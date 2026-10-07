/* global document, foundry */
/**
 * The marks this client's look, theme and type size are written as, on every
 * page the client draws in. See docs/lib/MODEL.md's client-settings section.
 */

/**
 * Every page this client draws in: the main document, then the document of
 * each detached browser window core lists, less any that has closed.
 *
 * @returns {Document[]}
 */
export function clientPages() {
  const pages = [document];
  for (const { window: win } of foundry.applications.detached?.windows.values() ?? []) {
    if (!win.closed) pages.push(win.document);
  }
  return pages;
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
