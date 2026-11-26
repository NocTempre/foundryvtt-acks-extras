/* global game */
/**
 * The pin prompt's half of marking an option the variant's tables do not give
 * (the template sheet builds the same rows through `pinOptionRows`): the context
 * a pin control labels its options with, and the listener that relabels a
 * prompt's selects as the Judge's other picks change. Holds no state; the
 * prompt owns the form.
 */
import { pinOptionRows } from "./template-logic.mjs";
import { registryBands, registryCarry } from "./template-bands.mjs";

/**
 * The resolvers and the marking words a pin control labels its options with,
 * read from the registry as it stands now: build one per prompt.
 * @returns {{bandOf: Function, carryOf: Function, mark: (label: string) => string}}
 */
export function pinContext() {
  return {
    bandOf: registryBands(),
    carryOf: registryCarry(),
    mark: (label) => game.i18n.format("ACKS-LIB.template.unavailable", { option: label }),
  };
}

/**
 * Keep the options of a form's pin selects labelled for the picks beside them.
 * Each axis's select is a field named by the axis key; on every change the
 * options are relabelled by `pinOptionRows` against the other selects' values,
 * so a banded axis follows the variant picked in the same form. The option
 * values and the selection are never touched: a marked option stays pickable.
 * @param {HTMLElement|null} root the element holding the form
 * @param {object} system the template's system data
 * @param {object[]} axes the axes the form has a select for
 * @param {{bandOf?: Function, carryOf?: Function, mark?: Function}} context as `pinContext` returns
 */
export function bindPinLabels(root, system, axes, context) {
  const form = root?.querySelector?.("form");
  if (!form) return;
  const relabel = () => {
    const picked = {};
    for (const axis of axes) {
      const value = form.elements.namedItem(axis.key)?.value;
      if (value) picked[axis.key] = value;
    }
    for (const axis of axes) {
      const select = form.elements.namedItem(axis.key);
      if (!select?.options) continue;
      const others = { ...picked };
      delete others[axis.key];
      const rows = pinOptionRows(system, axis, others, context);
      for (const option of select.options) {
        const row = rows.find((r) => r.key === option.value);
        if (row) option.textContent = row.label;
      }
    }
  };
  form.addEventListener("change", relabel);
}
