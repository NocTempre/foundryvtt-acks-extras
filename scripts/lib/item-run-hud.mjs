/* global Hooks, canvas, CONFIG, document, console */
/**
 * The item runner's presses on core's Token HUD (canvas 4): one `control-icon` in
 * the right column for each item on the token's actor that carries an
 * `itemRun.activation`, in the actor's item order. A toggle item reads Raise or
 * Lower by its state and lights core's `active` class while raised; an item of
 * any other kind reads Use. Always-on items carry no activation and draw none.
 * An item whose spending kind has nothing left draws none, so nothing dead sits
 * on the HUD.
 *
 * - `itemRunHudControls(items, deps)` is the pure choice: which items, their
 *   verb, their picture and whether each is raised.
 * - A seat sees the control for an item that passes Foundry's `isOwner`; no role
 *   is read. The press is `item.use()`, the same door as the sheet rows and the
 *   hotbar macro (`patches/item-use.mjs`), so nothing is refused here that the
 *   door would not refuse.
 * - A control's name is its `aria-label` and its tooltip is empty, which core
 *   shows as the label.
 * - The HUD redraws after a press and whenever one of the actor's items changes,
 *   so `active` follows the state the Judge's window wrote.
 */
import { LANG_PREFIX, MINTED_ITEM_IMG, MODULE_ID } from "./constants.mjs";
import { itemRunOf, itemRunUsedUp } from "./item-run-logic.mjs";
import { elementOf, makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The picture a control wears where its item carries none of its own: core's aura glyph. */
export const HUD_FALLBACK_IMG = "icons/svg/aura.svg";

/** The class every control this file draws carries, and the selector the redraw clears by. */
const CONTROL_CLASS = "acks-extras-item-hud";

/** An item's own picture, or the aura glyph where it has none or wears a default one. */
function pictureOf(item, defaultImgsOf) {
  const img = typeof item?.img === "string" ? item.img.trim() : "";
  if (!img) return HUD_FALLBACK_IMG;
  return new Set(defaultImgsOf(item)).has(img) ? HUD_FALLBACK_IMG : img;
}

/**
 * The controls the HUD draws for a list of items, in order of the items' `sort`
 * (ties keep the list's order).
 *
 * @param {Iterable<object>} items an actor's items
 * @param {object} [deps]
 * @param {(item: object) => boolean} [deps.owns] whether this seat may press the item; Foundry's own `isOwner` by default
 * @param {(item: object) => Iterable<string>} [deps.defaultImgsOf] the pictures that stand for "no picture of its own" for this item, which the fallback replaces
 * @returns {{id: string, name: string, kind: string, verb: "raise"|"lower"|"use", active: boolean, img: string}[]}
 */
export function itemRunHudControls(items, { owns = (item) => item?.isOwner === true, defaultImgsOf = () => [] } = {}) {
  const found = [];
  for (const item of Array.from(items ?? [])) {
    const run = itemRunOf(item);
    if (!run || !owns(item) || itemRunUsedUp(item)) continue;
    const { kind, state } = run.activation;
    const active = kind === "toggle" && state.active;
    const verb = kind === "toggle" ? (active ? "lower" : "raise") : "use";
    found.push({ order: Number(item.sort) || 0, control: { id: item.id, name: String(item.name ?? ""), kind, verb, active, img: pictureOf(item, defaultImgsOf) } });
  }
  // Array#sort is stable, so equal `sort` values keep the list's order.
  return found.sort((a, b) => a.order - b.order).map((entry) => entry.control);
}

/** The pictures that mean "no picture of its own" for an item: the one the importer mints gear with, the system's default for the item's type and Foundry's. */
function defaultImgsOf(item) {
  const klass = CONFIG?.Item?.documentClass;
  return [MINTED_ITEM_IMG, klass?.getDefaultArtwork?.({ type: item.type })?.img, klass?.DEFAULT_ICON].filter(Boolean);
}

/** The HUD application for the token now open, or null. */
const openHud = () => {
  const hud = canvas?.hud?.token;
  return hud?.rendered ? hud : null;
};

/** One control's button: the item's picture, its verb and name as the label, `active` while raised. */
function buildButton(hud, actor, control) {
  const label = loc(`itemRun.hud.${control.verb}`, { item: control.name });
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon ${CONTROL_CLASS}${control.active ? " active" : ""}`;
  button.dataset.tooltip = "";
  button.setAttribute("aria-label", label);
  if (control.active) button.setAttribute("aria-pressed", "true");
  const img = document.createElement("img");
  img.src = control.img;
  img.alt = "";
  button.appendChild(img);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    const item = actor.items.get(control.id);
    if (!item) return;
    button.disabled = true;
    try {
      await item.use();
    } catch (err) {
      console.error(`${MODULE_ID} | the HUD press of an item failed`, err);
    } finally {
      if (hud.rendered) hud.render();
    }
  });
  return button;
}

/** Draw the controls into a rendered HUD, replacing any an earlier render of it left. */
function draw(hud, html) {
  const actor = hud?.object?.document?.actor;
  const root = elementOf(html);
  if (!actor || !root) return;
  for (const old of root.querySelectorAll(`.${CONTROL_CLASS}`)) old.remove();
  const controls = itemRunHudControls(actor.items, { defaultImgsOf });
  if (!controls.length) return;
  const column = root.querySelector(".col.right") ?? root;
  for (const control of controls) column.appendChild(buildButton(hud, actor, control));
}

let installed = false;

/** Register the hooks: the HUD's own render, and a redraw of the open HUD when an item of its actor is made, changed or deleted. */
export function installItemRunHud() {
  if (installed) return;
  installed = true;
  Hooks.on("renderTokenHUD", draw);
  const ownItem = (item) => {
    const hud = openHud();
    const actor = hud?.object?.document?.actor;
    return hud && actor && item?.parent?.uuid === actor.uuid ? hud : null;
  };
  Hooks.on("updateItem", (item, changed) => {
    if (["flags", "system", "img", "name", "sort"].some((key) => key in (changed ?? {}))) ownItem(item)?.render();
  });
  for (const name of ["createItem", "deleteItem"]) Hooks.on(name, (item) => ownItem(item)?.render());
}
