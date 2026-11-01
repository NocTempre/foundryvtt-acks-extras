/**
 * Every window this module opens has a drag corner. Core gives one only to a
 * window that asks, and `DialogV2.prompt` and `.confirm` do not, so the rule is
 * kept here once rather than at every place a window is declared. A window is
 * this module's by a class it declares, the declaration that also joins it to
 * a scroll contract (styles/lib.css).
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * Did this application declare a class of this module? `options.classes` is
 * read and not the root's class list, which also holds what a render added.
 */
export function isModuleWindow(app) {
  const classes = app?.options?.classes;
  if (!Array.isArray(classes)) return false;
  return classes.some((c) => c === MODULE_ID || c.startsWith(`${MODULE_ID}-`));
}

/**
 * Ask for the corner on a module window's first render. Core builds the handle
 * once, from the application's option, while it builds the frame, and the
 * frame update then reads the render options first. `preRender` runs ahead of
 * both, so it sets both. A frameless window has no corner to ask for.
 */
export function installWindowResize() {
  Hooks.on("preRenderApplicationV2", (app, _context, options) => {
    if (!options?.isFirstRender || !app.hasFrame || !isModuleWindow(app)) return;
    app.options.window.resizable = true;
    if (options.window) options.window.resizable = true;
  });
}
