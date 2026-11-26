/* global Hooks */
/**
 * The recipe editor's door on the family template sheet. Lib's template sheet
 * lists each axis option as an `li.editor-option[data-axis-key][data-option-key]`
 * in its edit mode; this module adds a "Recipe…" button to the rows of the
 * variant axis, from a render hook, so lib's template and app stay as they are.
 * The press opens the editor onto that option's own encounter recipe, the copy
 * `rollOrganisation` reads (`organisation-run.mjs` `variantOptionOf`).
 *
 * The variant axis is the one `variantOptionOf` reads, named by its key. A row
 * is told by its data attributes and a node by `nodeType`/`matches`, never by
 * `instanceof`, so a sheet first rendered in a browser window of its own is
 * handled the same.
 */
import { MODULE_ID } from "./constants.mjs";
import { elementOf, makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-MONSTERS");

/** The key of the template axis whose options carry an encounter recipe: the axis `variantOptionOf` reads. */
export const VARIANT_AXIS_KEY = "variant";

/** The class a door button wears; its presence on a row is what keeps a re-render from adding a second. */
export const DOOR_CLASS = "acksm-recipe-door";

const ROW_SELECTOR = "li.editor-option[data-axis-key][data-option-key]";

/**
 * The door a row gets, or null. A row gets one only on the variant axis, and
 * only for an option that axis lists.
 * @param {object[]} axes the template's axes, as plain data
 * @param {{axisKey?: string, optionKey?: string}} row the row's data attributes
 * @param {function(string, object=): string} [say] the localizer for the button's words
 * @returns {{axisKey: string, optionKey: string, label: string, aria: string}|null}
 */
export function doorFor(axes, { axisKey = "", optionKey = "" } = {}, say = loc) {
  if (axisKey !== VARIANT_AXIS_KEY || !optionKey) return null;
  const axis = (axes ?? []).find((a) => a?.key === axisKey);
  const option = (axis?.options ?? []).find((o) => o?.key === optionKey);
  if (!option) return null;
  return { axisKey, optionKey, label: say("recipe.door.option"), aria: say("recipe.door.optionAria", { option: option.label || option.key }) };
}

/** The axes of a sheet's document, as plain data. */
const axesOf = (doc) => doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? [];

/** Put one door button on a row, once. */
function addDoor(row, door, doc) {
  if (row.querySelector(`.${DOOR_CLASS}`)) return;
  const button = row.ownerDocument.createElement("button");
  button.type = "button";
  button.className = DOOR_CLASS;
  button.textContent = door.label;
  button.setAttribute("aria-label", door.aria);
  button.setAttribute("data-tooltip", "");
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const { openRecipeEditor } = await import("./recipe-editor.mjs");
      await openRecipeEditor(doc, { axisKey: door.axisKey, optionKey: door.optionKey });
    } catch (err) {
      console.error(`${MODULE_ID} | recipe editor door failed`, err);
    }
  });
  row.insertBefore(button, row.querySelector('[data-action="deleteOption"]'));
}

/** Register the render hook that adds the doors to a template sheet's option rows. */
export function registerRecipeDoors() {
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const doc = app?.document;
      if (doc?.documentName !== "Actor") return;
      const root = elementOf(element);
      if (!root) return;
      const rows = root.querySelectorAll(ROW_SELECTOR);
      if (!rows.length) return;
      const axes = axesOf(doc);
      for (const row of rows) {
        if (row.nodeType !== 1 || !row.matches(ROW_SELECTOR)) continue;
        const door = doorFor(axes, { axisKey: row.dataset.axisKey, optionKey: row.dataset.optionKey });
        if (door) addDoor(row, door, doc);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | recipe editor doors failed`, err);
    }
  });
}
