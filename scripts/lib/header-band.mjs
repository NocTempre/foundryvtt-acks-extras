/**
 * The band is the window header: a sheet renders its title band as a part
 * named `band`, and this moves it into Foundry's `.window-header`, before the
 * header's controls, so the header stays the drag handle and keeps its
 * buttons while the band's fields still live in the sheet's form. The
 * mechanics are docs/equipment/MODEL.md, "The band is the window header."
 *
 * Each render appends a fresh band to the window content; the copy already in
 * the header is the previous render's and is removed, because the mixin
 * cannot replace a part it no longer finds inside the content. A press on one
 * of the band's own controls stops at the band; anywhere else it falls
 * through to the header, which drags the window on a pointerdown and
 * minimizes it on a double click.
 */
import { elementOf } from "./util.mjs";

/** A control in the band keeps the header's two gestures for itself. */
const CONTROLS = "input, button, a, select, textarea, label";

/**
 * Move the band part of a rendered sheet into its window header. Called from
 * the sheet's `_onRender`; a window with no header or no band is left as it
 * is.
 * @param {Element|ArrayLike<Element>} root the application's element
 * @param {string} [part] the band's part id
 */
export function moveBandIntoHeader(root, part = "band") {
  const element = elementOf(root);
  const header = element?.querySelector(":scope > .window-header");
  const bands = [...(element?.querySelectorAll(`[data-application-part="${part}"]`) ?? [])];
  const band = bands.find((b) => b.parentElement !== header) ?? bands[0];
  if (!header || !band) return;
  for (const stale of bands) if (stale !== band) stale.remove();
  const controls = header.querySelector("button[data-action=toggleControls]");
  if (band.parentElement !== header) header.insertBefore(band, controls ?? null);
  if (band.dataset.guarded) return;
  band.dataset.guarded = "1";
  for (const type of ["pointerdown", "dblclick"]) {
    band.addEventListener(type, (ev) => {
      if (ev.target.closest(CONTROLS)) ev.stopPropagation();
    });
  }
}
