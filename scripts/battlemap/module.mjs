/* global game, Hooks, foundry, CONFIG, document */
/**
 * acks-battlemap — map alignment and token scaling for the ACKS II module
 * family: a GM assistant that best-fits the scene grid to a battlemap image
 * from canvas samples, converts the confirmed scale into grid.distance, and
 * sizes tokens to their real footprints.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP, CONTROL_GROUP, TOOL_OFF } from "./constants.mjs";
import BattlemapAssistant, { openAssistant, TAB_NAME } from "./assistant-app.mjs";
import {
  installTokenAutoScale,
  autoScaleEnabled,
  sizeForToken,
  rescaleSceneTokens,
  applyFootprintToSelected,
  resetSelectedFootprints,
} from "./token-scale.mjs";
import { fitGrid, feetPerSquare, roundSuggestions, outputGridSize } from "./calibrate-logic.mjs";
import { footprintFeet, tokenSpan } from "./footprint.mjs";
import { CAPTURE_MODES, session } from "./session.mjs";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/assistant-foot.hbs`,
];

Hooks.once("init", () => {
  installSidebarTab();
  installSceneControls();
  installSceneConfigRow();
  installTokenAutoScale();
  // The session owns the samples, so it is what a scene change clears — the
  // window is only a view and may not even be open.
  Hooks.on("canvasReady", () => session.onCanvasReady());

  foundry.applications.handlebars
    .loadTemplates(TEMPLATES)
    .catch((err) => console.warn(`${MODULE_ID} | template preload skipped`, err));
});

Hooks.once("ready", () => {
  acksExtras.battlemap = {
    openAssistant,
    fitGrid,
    feetPerSquare,
    roundSuggestions,
    outputGridSize,
    footprintFeet,
    tokenSpan,
    sizeForToken,
    autoScaleEnabled,
    rescaleSceneTokens,
    applyFootprintToSelected,
    resetSelectedFootprints,
  };
});

/**
 * The panel is a sidebar tab, so it never covers the map it is aligning.
 *
 * Two registrations, both required and both at init: the descriptor in
 * `Sidebar.TABS` is what draws the tab button, and the class in `CONFIG.ui` is
 * what `ui[name]` is built from at startup — the sidebar renders `ui[id]`, so
 * a descriptor without a class is a button over nothing. `gmOnly` is the
 * descriptor's own field; there is no need to gate it by hand.
 */
function installSidebarTab() {
  CONFIG.ui[TAB_NAME] = BattlemapAssistant;
  foundry.applications.sidebar.Sidebar.TABS[TAB_NAME] = {
    tooltip: `${LANG_PREFIX}.controls.group`,
    icon: "fa-solid fa-ruler-combined",
    gmOnly: true,
  };
}

/** Icon per capture mode, in the order `CAPTURE_MODES` lists them. */
const MODE_ICONS = {
  square: "fa-solid fa-vector-square",
  corners: "fa-solid fa-crosshairs",
  scale: "fa-solid fa-ruler-horizontal",
  eraser: "fa-solid fa-eraser",
};

/**
 * Calibration gets a control group of its own, not a button hidden at the end
 * of somebody else's.
 *
 * Each capture mode IS a scene-control tool — it arms a canvas interaction,
 * which is the thing a tool models — so Foundry keeps exactly one of them
 * active for free and the armed mode is visible in the toolbar rather than
 * buried in a window. The group carries no `layer`: it drives the calibration
 * overlay, not a placeables layer, and a SceneControl has never required one.
 *
 * The window is still where the numbers and the apply actions live, so
 * activating the group opens it.
 */
function installSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tools = {};
    // The way out, and the group's resting state. Without a tool that arms
    // NOTHING, every tool in the group draws on the map and the only exit is
    // to leave the group entirely — and core remembers the last tool per
    // control, so coming back re-arms it. This is the tool that remembering
    // should land on.
    tools[TOOL_OFF] = {
      name: TOOL_OFF,
      title: game.i18n.localize(`${LANG_PREFIX}.mode.off`),
      icon: "fa-solid fa-arrow-pointer",
      order: 0,
      onChange: (_event, active) => {
        if (active) session.disarm();
      },
    };
    CAPTURE_MODES.forEach((mode, i) => {
      tools[mode] = {
        name: mode,
        title: game.i18n.localize(`${LANG_PREFIX}.mode.${mode}`),
        icon: MODE_ICONS[mode],
        order: i + 1,
        // A mode tool is the ACTIVE tool while armed, so Foundry's own
        // one-at-a-time handling is the arming logic; `active` is what it
        // hands back when the group is re-entered.
        onChange: (_event, active) => {
          if (active) session.arm(mode);
          else if (session.mode === mode) session.disarm();
        },
      };
    });
    tools.wipe = {
      name: "wipe",
      title: game.i18n.localize(`${LANG_PREFIX}.samples.wipe`),
      icon: "fa-solid fa-trash",
      order: CAPTURE_MODES.length + 1,
      button: true,
      // One handler only: v13+ calls BOTH `onChange` and `onClick` on a
      // `button: true` tool, so a second press would arrive unasked.
      onChange: () => session.wipe(),
    };
    tools.assistant = {
      name: "assistant",
      title: game.i18n.localize(`${LANG_PREFIX}.controls.assistant`),
      icon: "fa-solid fa-sliders",
      order: CAPTURE_MODES.length + 2,
      button: true,
      onChange: () => openAssistant(),
    };

    controls[CONTROL_GROUP] = {
      name: CONTROL_GROUP,
      title: game.i18n.localize(`${LANG_PREFIX}.controls.group`),
      icon: "fa-solid fa-ruler-combined",
      order: Object.keys(controls).length,
      visible: game.user.isGM,
      // Entering the group arms NOTHING. Opening a toolbar must not start
      // drawing on the map, and the panel is readable without a mode armed.
      activeTool: TOOL_OFF,
      tools,
      onChange: (_event, active) => {
        if (active) openAssistant();
        else session.disarm();
      },
    };
  });
}

/**
 * A second door in scene config: open the assistant, and toggle the scene's
 * autoScale gate (whether tokens placed here are auto-sized to the scale).
 */
function installSceneConfigRow() {
  Hooks.on("renderSceneConfig", (app, element) => {
    if (game.system?.id !== "acks" || !game.user.isGM) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    root.querySelectorAll(".acks-extras-battlemap-row").forEach((n) => n.remove());
    // Anchored like the location row: under the Basics tab's navName group,
    // falling back to the tab's last group so the control never vanishes.
    const basics = root.querySelector('.tab[data-tab="basics"]') ?? root;
    const anchor =
      root.querySelector('[name="navName"]')?.closest(".form-group") ??
      basics.querySelector(".form-group:last-of-type");
    if (!anchor) {
      console.warn(`${MODULE_ID} | scene config: no anchor for the battlemap row`);
      return;
    }

    const scene = app.document;
    const flag = scene.getFlag(MODULE_ID, FLAG_BATTLEMAP) ?? {};
    const group = document.createElement("div");
    group.className = "form-group acks-extras-battlemap-row";
    group.innerHTML = `
      <label>${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.label`)}</label>
      <div class="form-fields">
        <button type="button" class="acks-extras-battlemap-open">
          <i class="fa-solid fa-ruler-combined"></i> ${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.open`)}
        </button>
        <label class="acks-extras-battlemap-auto">
          <input type="checkbox" class="acks-extras-battlemap-autoscale" ${flag.autoScale ? "checked" : ""}>
          ${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.autoScale`)}
        </label>
      </div>
      <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.hint`)}</p>`;
    anchor.after(group);

    group.querySelector(".acks-extras-battlemap-open").addEventListener("click", () => openAssistant());
    // Written immediately rather than on form submit: the gate is a flag, and
    // the scene-config submit handler knows nothing about it.
    group.querySelector(".acks-extras-battlemap-autoscale").addEventListener("change", async (ev) => {
      await scene.setFlag(MODULE_ID, FLAG_BATTLEMAP, { ...flag, autoScale: ev.currentTarget.checked });
    });
  });
}
