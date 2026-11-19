/* global game, foundry, fromUuidSync, ui */
/**
 * Keying on the table: the Foundry half of `keying-logic.mjs`. It draws the one
 * keying rail (`templates/scene-search/keying-rail.hbs`) for both windows that
 * carry it, the scene screen's Judge seat and the place sheet's Things here
 * tab, and writes what a field says through lib's GM writers
 * (`reviseThingsOn`, `updateThingOn`, `removeThingFrom`). A window hands the
 * rail its place through `keyingPlace()`, and draws again on its own after a
 * write, since the write changes the place the window already watches.
 *
 * A player never reaches this: the tab is not given to a seat that is not a
 * Judge, the screen draws no rail for one, and every writer refuses any other
 * seat besides.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { definitionId } from "../lib/capabilities.mjs";
import { libraryItems } from "../lib/library.mjs";
import { spendPicks } from "../lib/picks.mjs";
import { writeOnChange } from "../lib/press-safe-change.mjs";
import { removeThingFrom, reviseThingsOn, thingsOf, updateThingOn } from "../lib/place-things.mjs";
import { ITEM_TYPE, capabilityForId } from "../lib/vocab.mjs";
import { capabilityLabel } from "../abilities/ability-sheet.mjs";
import { dropOnPlace } from "../formation/region-place-row.mjs";
import { regionOfLocation, sceneOfLocation } from "../location/scene-link.mjs";
import { ROOT, editsFor, railOf, tabOf, withoutReveals } from "./keying-logic.mjs";
import { sceneEntries } from "./scene-logic.mjs";
import { derivedInputs, plateNamesOf } from "./session.mjs";

/** The Things here tab's body and the rail it holds, both preloaded at `init`. */
export const KEYING_TAB_TEMPLATE = `modules/${MODULE_ID}/templates/scene-search/keying-tab.hbs`;
export const KEYING_RAIL_TEMPLATE = `modules/${MODULE_ID}/templates/scene-search/keying-rail.hbs`;
export const KEYING_TEMPLATES = Object.freeze([KEYING_TAB_TEMPLATE, KEYING_RAIL_TEMPLATE]);

let loading = null;

/**
 * Load the two partials once. Called at `init` and again before a draw that
 * needs them, so a window drawn before the first load settled still finds the
 * rail registered.
 * @returns {Promise<void>}
 */
export function loadKeyingTemplates() {
  loading ??= foundry.applications.handlebars.loadTemplates(KEYING_TEMPLATES).catch((err) => {
    loading = null;
    console.warn(`${MODULE_ID} | keying templates not loaded`, err);
  });
  return loading;
}

/** The tab's id on the place sheet. */
export const KEYING_TAB = "things";

/** The entry each place sheet has open in its tab, by sheet: held by the window, never written. */
const opened = new WeakMap();

/** A word, formatted where it carries data. */
const say = (key, data) => (data && Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key));

/** A document's name by uuid, or empty where it does not resolve. */
function nameOfRef(uuid) {
  try {
    return fromUuidSync(uuid, { strict: false })?.name ?? "";
  } catch {
    return "";
  }
}

/** What a Proficiency check may name: each imported library ability that stands for a capability, once. */
export function proficiencyChoices() {
  const byToken = new Map();
  try {
    for (const item of libraryItems()) {
      const id = item.type === ITEM_TYPE.ability ? definitionId(item) : null;
      if (!id) continue;
      const token = capabilityForId(id);
      if (!byToken.has(token)) byToken.set(token, { token, label: capabilityLabel(token) });
    }
  } catch {
    return [];
  }
  return [...byToken.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The scene a place's map is: its linked map, else the scene its Region sits on. */
const sceneOfPlace = (place) => sceneOfLocation(place) ?? regionOfLocation(place)?.parent ?? null;

/**
 * The rail of one entry of a place, ready to draw, or null where there is no
 * entry of that key.
 *
 * @param {object[]} entries every entry of the scene, the Judge's view
 * @param {string|null} key the entry's key
 * @returns {object|null}
 */
export function railFor(entries, key) {
  const entry = key ? entries.find((e) => e.key === key) : null;
  return entry ? railOf(entry, entries, { names: plateNamesOf(entries), proficiencies: proficiencyChoices(), nameOfRef, t: say }) : null;
}

/* -------------------------------------------- */
/*  The tab                                      */
/* -------------------------------------------- */

/**
 * Give the place sheet's context its Things here tab: the place's things and
 * what the map says, and the rail of the one opened. A seat that is not a Judge
 * gets none.
 * @param {ActorSheet} sheet the place's sheet
 * @param {object} context the sheet's render context
 */
export async function prepareKeyingTab(sheet, context) {
  context.keying = null;
  if (!game.user?.isGM) return;
  await loadKeyingTemplates();
  const place = sheet.actor;
  const entries = sceneEntries({ things: thingsOf(place), ...derivedInputs(place, sceneOfPlace(place)) });
  const names = plateNamesOf(entries);
  const tab = tabOf(entries, names, say, capabilityLabel);
  const key = tab.things.some((row) => row.key === opened.get(sheet)) ? opened.get(sheet) : null;
  context.keying = {
    ...tab,
    things: tab.things.map((row) => ({ ...row, open: row.key === key })),
    rail: railFor(entries, key),
    count: tab.things.length,
  };
}

/** Wire the tab's rail after a render. A seat that is not a Judge has none. */
export function bindKeyingTab(sheet) {
  if (game.user?.isGM) bindKeyingRail(sheet);
}

/** Open a thing's rail in the tab, or close it where it is already open. @this {ActorSheet} */
function onOpenThing(_event, target) {
  const key = target.dataset.key;
  opened.set(this, opened.get(this) === key ? null : key);
  this.render();
}

/** The rail's own actions, which every window that draws it spreads into its `actions`. */
export const KEYING_RAIL_ACTIONS = {
  keyShow: onShow,
  keyRemove: onRemove,
  keyToolRemove: onToolRemove,
};

/** The Things here tab's actions: the rail's and the row that opens it. */
export const KEYING_ACTIONS = { keyingOpen: onOpenThing, ...KEYING_RAIL_ACTIONS };

/**
 * Take a drop on the Things here tab: an Item some kind of thing accepts
 * becomes that thing at this place, through the same kind table the map's
 * drops use. Anything else is the sheet's own (goods go to the place's goods).
 * @param {ActorSheet} sheet the place's sheet
 * @param {DragEvent} event
 * @param {Item} item the dropped Item
 * @returns {Promise<boolean>} whether this took the drop
 */
export async function takeThingDrop(sheet, event, item) {
  if (!game.user?.isGM || !item?.uuid) return false;
  const tab = event?.target?.closest?.(".tab")?.dataset?.tab ?? sheet.tabGroups?.primary;
  if (tab !== KEYING_TAB) return false;
  const took = await dropOnPlace({ place: sheet.actor, data: { type: "Item", uuid: item.uuid } });
  if (took) sheet.render();
  return took;
}

/* -------------------------------------------- */
/*  The rail                                     */
/* -------------------------------------------- */

/** The window's place, from its own `keyingPlace()`. */
const placeOf = (app) => app.keyingPlace?.() ?? null;

/** The thing id the rail a control sits in is for. */
const idOf = (control) => control.closest?.("[data-thing-id]")?.dataset?.thingId ?? "";

/** Tell the Judge why a change wrote nothing. */
function refused(refusal) {
  ui.notifications?.warn(say(`${ROOT}refusal.${refusal}`));
}

/** Apply one change to the thing, from the list as the place holds it now; true where it wrote. */
async function change(app, id, what) {
  const place = placeOf(app);
  if (!place || !id) return false;
  let refusal = null;
  const written = await reviseThingsOn(place, (list) => {
    const out = editsFor(list, id, what);
    refusal = out.refusal;
    return out.edits;
  });
  if (refusal) refused(refusal);
  return !!written;
}

/** The change a control's value stands for, or null for a control the rail does not own. */
function changeOf(control) {
  const field = control.dataset?.keyField;
  if (!field) return null;
  const value = control.type === "checkbox" ? control.checked : control.value;
  return { field, layer: control.dataset.layer, value };
}

/**
 * Wire the rail a window drew: a field writes on its change, and an item dropped
 * on the tools field joins the layer's tools. A write the place's own update
 * answers with a draw; a refusal draws too, so the field does not keep the
 * value that was turned down.
 * @param {object} app the window, with `keyingPlace()` and `render()`
 */
export function bindKeyingRail(app) {
  const rail = app.element?.querySelector?.(".acks-extras-keying");
  if (!rail) return;
  writeOnChange(rail, async (control) => {
    const what = changeOf(control);
    if (!what) return;
    const id = idOf(control);
    const wrote = await change(app, id, what);
    spendPicks(rail, [control.dataset.pick]);
    if (!wrote) app.render();
  });
  for (const zone of rail.querySelectorAll("[data-key-drop]")) {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
    });
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item" || !data.uuid) return;
      await change(app, idOf(zone), { field: "toolAdd", layer: zone.dataset.layer, value: data.uuid });
    });
  }
}

/** Show the entry to the table now: its `state.shown`, which a Reset of the place clears. @this {object} */
async function onShow(_event, target) {
  const place = placeOf(this);
  const id = idOf(target);
  if (place && id) await updateThingOn(place, id, { state: { shown: true } });
}

/** Take the thing off the place, and every reveal that named it. @this {object} */
async function onRemove(_event, target) {
  const place = placeOf(this);
  const id = idOf(target);
  if (!place || !id) return;
  if (!(await removeThingFrom(place, id))) return;
  await reviseThingsOn(place, (list) => withoutReveals(list, `thing:${id}`));
  this.render();
}

/** Take one tool off a layer. @this {object} */
async function onToolRemove(_event, target) {
  await change(this, idOf(target), { field: "toolRemove", layer: target.dataset.layer, value: target.dataset.uuid });
}
