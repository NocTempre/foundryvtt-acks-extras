/* global Hooks, game */

/**
 * The one field this module adds to core's Light Source configuration window:
 * "Daylight radius", on the Basic tab beside core's bright and dim radii. It is
 * a plain control named for the flag (`flags.acks-extras.daylight`), so core's
 * own form submit and live preview carry the value and nothing of ours writes.
 * What the flag means, and how it is read, is `ambientDaylight` in `light.mjs`.
 *
 * Core re-renders a part by replacing its element, which discards the control,
 * and a render hook runs after every render, so the injection is idempotent: it
 * adds the control when the Basic tab lacks one and does nothing when it is
 * there. The value is read from the context's `source`, the preview document's
 * own data, so an unsaved entry survives a re-render.
 */

import { MODULE_ID } from "./constants.mjs";
import { AMBIENT_DAYLIGHT_FLAG, ambientDaylight } from "./light.mjs";
import { el, elementOf } from "./util.mjs";

/** The form name of the control: the path core's submit writes the flag to. */
export const DAYLIGHT_FIELD_NAME = `flags.${MODULE_ID}.${AMBIENT_DAYLIGHT_FLAG}`;

/** The class marking the group this module adds. */
const GROUP_CLASS = "acks-extras-ambient-daylight";

/** A lang string, or the key itself where no i18n stands. */
function text(key) {
  return game?.i18n?.localize ? game.i18n.localize(key) : key;
}

/**
 * Add the Daylight radius control to a light config window's root, directly
 * after the group holding core's bright and dim radii. Does nothing when the
 * window has no such group yet or already carries the control.
 *
 * @param {HTMLElement} root  the window's element
 * @param {object} [options]
 * @param {*} [options.value]  the stored daylight radius, shown as is when it is a positive figure
 * @param {string} [options.units]  the scene's distance unit, shown beside the label
 * @param {boolean} [options.editable]  false leaves the control read-only
 * @returns {HTMLElement|null}  the control, or null when nothing was added
 */
export function injectDaylightField(root, { value = null, units = "", editable = true } = {}) {
  if (!root?.querySelector) return null;
  if (root.querySelector(`[name="${DAYLIGHT_FIELD_NAME}"]`)) return null;
  const bright = root.querySelector('[data-application-part="basic"] [name="config.bright"]');
  const anchor = bright?.closest?.(".form-group");
  if (!anchor) return null;

  const group = el("div", `form-group slim ${GROUP_CLASS}`);
  group.dataset.tooltip = "ACKS-LIB.ambientDaylight.tooltip";
  const label = el("label", "", text("ACKS-LIB.ambientDaylight.label"));
  if (units) label.append(" ", el("span", "units", `(${units})`));
  const fields = el("div", "form-fields");
  const input = el("input");
  input.type = "number";
  input.name = DAYLIGHT_FIELD_NAME;
  input.min = "0";
  input.step = "any";
  input.setAttribute("aria-label", text("ACKS-LIB.ambientDaylight.label"));
  input.value = ambientDaylight({ flags: { [MODULE_ID]: { [AMBIENT_DAYLIGHT_FLAG]: value } } }) ?? "";
  input.disabled = !editable;
  fields.append(input);
  group.append(label, fields);
  anchor.after(group);
  return group;
}

/**
 * Hook the Light Source configuration window's render. The window is core's
 * `AmbientLightConfig`, an ApplicationV2 whose `basic` part holds the radii;
 * the hook fires after the first render and after any part's re-render.
 */
export function installAmbientDaylightField() {
  Hooks.on("renderAmbientLightConfig", (app, element, context) => {
    const root = elementOf(element);
    if (!root) return;
    try {
      injectDaylightField(root, {
        value: context?.source?.flags?.[MODULE_ID]?.[AMBIENT_DAYLIGHT_FLAG] ?? null,
        units: context?.gridUnits ?? "",
        editable: app?.isEditable !== false,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | adding the daylight radius to the light config failed; core's fields stand`, err);
    }
  });
}
