/* global game, Hooks, foundry, document */
/**
 * The travel system a map declares, on its navigation card: one icon per
 * scene in core's Scene Navigation bar showing the system the scene's setup
 * record names — a dungeon, a wilderness map, a settlement — or that it
 * names none, and for a GM the control that declares one. A left click opens
 * a picker over the three systems and the clearing entry; a right click on
 * the icon clears the declaration outright. Players see no icon: the
 * declaration is the Judge's statement about the map, and what a party is
 * doing is read off the party sheet (docs/battlemap/DECISIONS.md, 2026-10-28).
 *
 * The icon is a control inside core's clickable card, so it carries a
 * `data-action` core has no handler for: core's click handling takes the
 * nearest `[data-action]` and, finding none registered under that name, does
 * nothing, which is what keeps a press on the icon from viewing the scene.
 * The picker is core's own ContextMenu, bound once to the navigation root
 * (which core keeps across re-renders, replacing only its children) and
 * opened by click, placed at the icon rather than the pointer so a keyboard
 * press opens it at the same place. The flag is written through
 * `writeSceneSystem`, the writer the setup panel uses too; core re-renders
 * the navigation on every scene update, so the icon follows the flag with no
 * render call of its own.
 */
import { LANG_PREFIX, MODULE_ID, FLAG_BATTLEMAP, TRAVEL_MODES } from "./constants.mjs";
import { sceneSetup, writeSceneSystem } from "./scene-setup.mjs";
import { elementOf } from "../lib/util.mjs";

/** The icon's class: the picker's selector, the stylesheet's hook, and what a walk finds it by. */
export const SCENE_SYSTEM_CLASS = "acks-extras-scene-system";

/** The `data-action` the icon carries; core finds no handler under it and leaves the click alone. */
export const SCENE_SYSTEM_ACTION = "acksExtrasSceneSystem";

/** Glyph per declared system, and the face of a map that declares none. */
export const SYSTEM_GLYPHS = Object.freeze({
  delve: "fa-dungeon",
  journey: "fa-mountain-sun",
  settlement: "fa-city",
  none: "fa-circle-question",
});

/**
 * What a scene's card shows: the declared system (null for none), the key
 * its face is drawn and worded under, its glyph, the tooltip's lang key and
 * the spoken label.
 * @returns {{system: string|null, key: string, glyph: string, tooltip: string, label: string}}
 */
export function sceneSystemFace(scene) {
  const system = sceneSetup(scene).mapSystem;
  const key = system ?? "none";
  const name = game.i18n.localize(system ? `${LANG_PREFIX}.system.${system}` : `${LANG_PREFIX}.nav.none`);
  return {
    system,
    key,
    glyph: SYSTEM_GLYPHS[key],
    tooltip: `${LANG_PREFIX}.nav.tip.${key}`,
    label: game.i18n.format(`${LANG_PREFIX}.nav.face`, { system: name }),
  };
}

/**
 * Declare a scene's travel system, or clear it with null. GM only. Resolves
 * to what the writer returned: null where nothing was written, the seat not
 * being a GM included.
 */
export function declareSceneSystem(scene, mapSystem) {
  if (!scene || !game.user?.isGM) return Promise.resolve(null);
  return writeSceneSystem(scene, mapSystem).catch((err) => {
    console.error(`${MODULE_ID} | scene system write failed`, err);
    return null;
  });
}

/** The scene whose card holds this icon. */
const sceneOf = (control) => game.scenes.get(control?.closest?.(".scene")?.dataset?.sceneId) ?? null;

/**
 * The picker's entries for one scene: the three systems, the declared one
 * marked, and the clearing entry where one is declared. Labels are lang
 * keys; core localizes them as it draws the menu.
 */
export function pickerEntries(scene) {
  if (!scene) return [];
  const current = sceneSetup(scene).mapSystem;
  const entries = TRAVEL_MODES.map((mode) => ({
    label: `${LANG_PREFIX}.system.${mode}`,
    icon: `fa-solid ${SYSTEM_GLYPHS[mode]}`,
    classes: mode === current ? `${SCENE_SYSTEM_CLASS}-current` : "",
    onClick: () => declareSceneSystem(scene, mode),
  }));
  entries.push({
    label: `${LANG_PREFIX}.setup.systemNone`,
    icon: "fa-solid fa-circle-xmark",
    visible: current !== null,
    onClick: () => declareSceneSystem(scene, null),
  });
  return entries;
}

/**
 * Draw the icon on every scene card under the navigation root, for a GM
 * seat; a player's root is left as core drew it. A card drawn before is
 * drawn again, so a re-render never doubles the icon. A level row carries
 * its scene's id beside its own and gets none: the declaration is the
 * scene's, shown once on the scene's card.
 * @returns {number} how many icons were drawn.
 */
export function decorateSceneNavigation(root) {
  if (!game.user?.isGM) return 0;
  let drawn = 0;
  for (const card of root.querySelectorAll(".scene[data-scene-id]")) {
    if (card.dataset.levelId) continue;
    const scene = game.scenes.get(card.dataset.sceneId);
    if (!scene) continue;
    for (const old of card.querySelectorAll(`.${SCENE_SYSTEM_CLASS}`)) old.remove();
    const face = sceneSystemFace(scene);
    const control = document.createElement("button");
    control.type = "button";
    control.className = `icon ${SCENE_SYSTEM_CLASS}`;
    control.dataset.action = SCENE_SYSTEM_ACTION;
    control.dataset.system = face.key;
    control.dataset.tooltip = face.tooltip;
    control.setAttribute("aria-label", face.label);
    control.setAttribute("aria-haspopup", "menu");
    const glyph = document.createElement("i");
    glyph.className = `fa-solid ${face.glyph}`;
    glyph.setAttribute("inert", "");
    control.append(glyph);
    // The right click is taken on the icon alone, so the rest of the card
    // keeps core's own scene menu.
    control.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      declareSceneSystem(scene, null);
    });
    card.append(control);
    drawn += 1;
  }
  return drawn;
}

/** The navigation roots a picker is bound to; core keeps the root across renders, so once is enough. */
const bound = new WeakSet();

/** Bind the picker to a navigation root, once: a click on any icon under it opens the entries for that icon's scene. */
export function bindScenePicker(root) {
  if (bound.has(root)) return false;
  bound.add(root);
  const Menu = foundry.applications.ux.ContextMenu.implementation;
  const picker = new Menu(root, `.${SCENE_SYSTEM_CLASS}`, [], {
    eventName: "click",
    fixed: true,
    relative: "target",
    jQuery: false,
    onOpen: (target) => {
      picker.menuItems = pickerEntries(sceneOf(target));
    },
  });
  return true;
}

/**
 * The setup panel's session mirrors the viewed scene's declared system once
 * a navigation card writes it, so an open panel's select does not show the
 * value the card just replaced. Nothing moves where the change is another
 * scene's, another part of the record, or the value the session holds.
 * @returns {boolean} whether the session was moved.
 */
export function sessionFollowsScene(session, scene, changes) {
  if (!session || scene?.id !== session.sceneId) return false;
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_BATTLEMAP}`)) return false;
  const { mapSystem } = sceneSetup(scene);
  if (session.mapSystem === mapSystem) return false;
  session.setSetup({ mapSystem });
  return true;
}

/** Draw the icons on every render of the navigation, and bind the picker the first time a GM's root is drawn. */
export function installSceneNavigation() {
  Hooks.on("renderSceneNavigation", (_app, element) => {
    const root = elementOf(element);
    if (!root) return;
    try {
      if (decorateSceneNavigation(root) > 0) bindScenePicker(root);
    } catch (err) {
      console.error(`${MODULE_ID} | scene navigation icons failed`, err);
    }
  });
}
