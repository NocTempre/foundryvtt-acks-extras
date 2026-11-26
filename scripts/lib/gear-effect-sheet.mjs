/* global foundry, Hooks */
/**
 * A carried item's effect rows on its item sheet: one group at the end of the
 * Details tab listing `itemRun.rows`, with Add row, and Edit and Delete on a
 * row. The list and its row editor are the ability sheet's Mechanics-tab list
 * put into a sheet this module does not own, the way the monster annotations
 * put a group into a monster's item sheet (`monsters/item-annotations.mjs`).
 *
 * - Every item of type `item` gets the group; it needs no `itemRun` flag, since
 *   Add row is how an item gets its first row.
 * - The group goes where `findItemSheetHost` finds a Details host and nowhere
 *   else: a sheet with none shows no group, never one on every tab.
 * - It is rebuilt on every render of the sheet. A document sheet renders when
 *   its item changes, so a row written by the editor, the importer or a macro
 *   is on the list the moment it lands.
 * - Add, Edit and Delete are offered when the user may write the item
 *   (Foundry's ownership, `gearEffectStore().editable()`). Any other seat reads
 *   the list with no controls, and an item with no rows shows it nothing.
 * - The controls carry `data-gear-rows`, not `data-action`: neither host sheet
 *   has these actions, so the group wires its own clicks and calls the editor's
 *   `effectRowActions` handlers with the item as their document.
 */
import { LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { effectRowActions } from "./apps/effect-row-editor.mjs";
import { gearEffectStore, gearRowsModel } from "./gear-effect-rows.mjs";
import { findItemSheetHost, scrollerOf } from "./item-sheet-host.mjs";
import { elementOf, makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The group's class; the template's root carries it. */
export const GEAR_ROWS_CLASS = "acks-extras-gear-rows";

const TEMPLATE = `modules/${MODULE_ID}/templates/lib/gear-effect-rows.hbs`;

/** The editor's add, edit and delete handlers over a carried item's store. */
const ACTIONS = effectRowActions(gearEffectStore);

/** The handler each control's `data-gear-rows` names. */
const HANDLERS = { add: ACTIONS.effectAdd, edit: ACTIONS.effectEdit, delete: ACTIONS.effectDelete };

/** Scroll offsets read before a render, put back once the group is in. */
const pendingScroll = new WeakMap();

/** The render each sheet last began: an older render that finishes late finds its number spent and places nothing. */
const renders = new WeakMap();

/** The sheet's item when it is an item of type `item`, else null. */
function gearItem(app) {
  const item = app?.document;
  return item?.documentName === "Item" && item.type === ITEM_TYPE.item ? item : null;
}

/** Wire a built group's controls to the editor's handlers for `item`. */
function wire(group, item) {
  for (const control of group.querySelectorAll("[data-gear-rows]")) {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const handler = HANDLERS[control.dataset.gearRows];
      Promise.resolve(handler?.call({ document: item }, event, control)).catch((err) => console.error(`${MODULE_ID} | gear effect rows press failed`, err));
    });
  }
}

/** Build the group for a sheet and place it at the end of its Details host, replacing the last one. */
async function place(app, root) {
  const item = gearItem(app);
  if (!item) return;
  const model = gearRowsModel(item, { say: loc });
  const stamp = (renders.get(app) ?? 0) + 1;
  renders.set(app, stamp);
  const html = model.editable || model.rows.length ? await foundry.applications.handlebars.renderTemplate(TEMPLATE, model) : "";
  if (renders.get(app) !== stamp || !root.isConnected) return;
  root.querySelector(`.${GEAR_ROWS_CLASS}`)?.remove();
  const host = html ? findItemSheetHost(root, { detailsOnly: true }) : null;
  if (!host) return;
  const holder = host.ownerDocument.createElement("div");
  holder.innerHTML = html;
  const group = holder.firstElementChild;
  if (!group) return;
  wire(group, item);
  host.appendChild(group);
  const saved = pendingScroll.get(app);
  pendingScroll.delete(app);
  const scroller = scrollerOf(group, root);
  if (scroller && saved > scroller.scrollTop) scroller.scrollTop = saved;
}

let installed = false;

/**
 * Register the render hooks that keep the group on every open item sheet of an
 * `item`. The group lengthens its scroller, so the offset it was read at is
 * taken before the render and put back once the group is in again.
 */
export function installGearEffectSheet() {
  if (installed) return;
  installed = true;
  Hooks.on("preRenderApplicationV2", (app) => {
    try {
      if (!gearItem(app)) return;
      const root = elementOf(app.element);
      const group = root?.querySelector(`.${GEAR_ROWS_CLASS}`);
      const scroller = group ? scrollerOf(group, root) : null;
      if (scroller) pendingScroll.set(app, scroller.scrollTop);
    } catch (err) {
      console.error(`${MODULE_ID} | gear effect rows scroll read failed`, err);
    }
  });
  Hooks.on("renderApplicationV2", (app, element) => {
    const root = elementOf(element);
    if (!root || !gearItem(app)) return;
    place(app, root).catch((err) => console.error(`${MODULE_ID} | gear effect rows injection failed`, err));
  });
}
