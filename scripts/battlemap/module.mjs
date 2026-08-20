/* global game, Hooks, foundry */
/**
 * acks-battlemap — map alignment and token scaling for the ACKS II module
 * family: a GM assistant that best-fits the scene grid to a battlemap image
 * from canvas samples, converts the confirmed scale into grid.distance, and
 * sizes tokens to their real footprints.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP } from "./constants.mjs";
import { openAssistant } from "./assistant-app.mjs";
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

const TEMPLATES = [`modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs`];

Hooks.once("init", () => {
  installSceneTool();
  installSceneConfigRow();
  installTokenAutoScale();

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

/** The Tokens layer gets the assistant's tool — the layer a GM sizing tokens is already on. */
function installSceneTool() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.find?.((c) => c.name === "tokens" || c.name === "token");
    if (!tokens) return;
    const tools = tokens.tools;
    const tool = {
      name: "acksBattlemap",
      title: game.i18n.localize(`${LANG_PREFIX}.tool`),
      icon: "fa-solid fa-ruler-combined",
      button: true,
      visible: game.user.isGM,
      order: Array.isArray(tools) ? tools.length : Object.keys(tools).length,
      // One handler only: v13+ calls BOTH `onChange` and `onClick` on a
      // `button: true` tool, so a second app would open over the first.
      onChange: () => openAssistant(),
    };
    // v13+ hands these over as an object keyed by name; older builds as an
    // array. Both shapes are still in the wild across the family's worlds.
    if (Array.isArray(tools)) tools.push(tool);
    else tools[tool.name] = tool;
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
