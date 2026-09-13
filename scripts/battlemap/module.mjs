/* global game, canvas, ui, Hooks, foundry, document */
/**
 * acks-battlemap — map alignment and token scaling for the ACKS II module
 * family: a GM assistant that best-fits the scene grid to a battlemap image
 * from canvas samples, converts the confirmed scale into grid.distance, and
 * sizes tokens to their real footprints.
 */
import { acksExtras } from "../namespace.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP, CONTROL_GROUP, TOOL_OFF } from "./constants.mjs";
import { openAssistant } from "./assistant-app.mjs";
import {
  installTokenAutoScale,
  autoScaleEnabled,
  sizeForToken,
  rescaleSceneTokens,
  applyFootprintToSelected,
  resetSelectedFootprints,
} from "./token-scale.mjs";
import { fitGrid, feetPerSquare, hexSizeFromBox, pixelsPerUnit, roundSuggestions, outputGridSize, scaleOnlyGrid } from "./calibrate-logic.mjs";
import { familyOfScene, sceneSetup, sceneTravelSystem } from "./scene-setup.mjs";
import { footprintFeet, tokenSpan } from "./footprint.mjs";
import { CAPTURE_MODES, session } from "./session.mjs";
import {
  terrainPaint,
  openTerrainPalette,
  terrainAtPoint,
  terrainRegionsOf,
  hexLabelFromOffset,
  paintHexAt,
  isHexScene,
  registerTerrainPaintHooks,
  TERRAIN_COLORS,
} from "./terrain-paint.mjs";
import {
  ROAD_SURFACES,
  armAlleyPreset,
  armRoadPreset,
  installRoadControls,
  registerRoadHooks,
  roadDistance,
  roadFromSelection,
  roadGraph,
  roadSurfaceKeys,
  roadUnder,
  roadWallData,
  roadWallsOf,
  wallRoad,
} from "./roads.mjs";
import { installRoadMarkers } from "./road-markers.mjs";
import { convertRoutesToWalls, derivedRoutesOf, nodePoint, routesOf, stepBetweenHexes } from "./hex-routes.mjs";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/assistant-foot.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/terrain-palette.hbs`,
];

Hooks.once("init", () => {
  installSceneControls();
  installSceneConfigRow();
  installTokenAutoScale();
  registerTerrainPaintHooks();
  registerRoadHooks();
  installRoadControls();
  installRoadMarkers();
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
    pixelsPerUnit,
    scaleOnlyGrid,
    hexSizeFromBox,
    /** What a scene has been set up AS: the record, its declared travel
     *  system, and which grid family it already uses (scene-setup.mjs). */
    sceneSetup,
    sceneTravelSystem,
    familyOfScene,
    footprintFeet,
    tokenSpan,
    sizeForToken,
    autoScaleEnabled,
    rescaleSceneTokens,
    applyFootprintToSelected,
    resetSelectedFootprints,
    /** Roads as walls (roads.mjs): the layer, the network, and what a walk
     *  along it costs — plus the hex links derived from it (hex-routes.mjs). */
    roads: {
      ROAD_SURFACES,
      roadSurfaceKeys,
      roadWallData,
      roadWallsOf,
      wallRoad,
      roadGraph,
      roadUnder,
      roadDistance,
      armRoadPreset,
      armAlleyPreset,
      roadFromSelection,
      convertRoutesToWalls,
      routesOf,
      derivedRoutesOf,
      nodePoint,
      stepBetweenHexes,
    },
    /** Hex terrain painting (terrain-paint.mjs): the map-prep brush and the
     *  reads the journey hangs off — terrain by hex, labels from offsets. */
    terrain: {
      paintHexAt,
      terrainAtPoint,
      terrainRegionsOf,
      hexLabelFromOffset,
      isHexScene,
      openTerrainPalette,
      TERRAIN_COLORS,
    },
  };
});

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
 * activating the group opens it. Leaving the group disarms and NOTHING else:
 * core drops a layerless control group on every canvas redraw, and the apply
 * redraws the canvas — closing the panel here takes it away the instant its
 * own apply lands, which is when the GM is reading the result. The window is
 * dismissed by its own close control.
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
    // The terrain brush is a canvas-arming tool like the capture modes, so
    // Foundry's one-active-tool rule is the exclusivity: arming it disarms
    // calibration, and vice versa. Hex map prep, GM-only, hex grids only.
    tools.terrain = {
      name: "terrain",
      title: game.i18n.localize(`${LANG_PREFIX}.terrain.tool`),
      icon: "fa-solid fa-paintbrush",
      order: CAPTURE_MODES.length + 1,
      onChange: (_event, active) => {
        if (active) {
          terrainPaint.arm(terrainPaint.brush ?? "grassland");
          openTerrainPalette();
        } else {
          terrainPaint.disarm();
        }
      },
    };
    // Roads: drawn as WALLS with core's own wall tool, on any grid. Each of
    // these is a PRESET — it arms what the next wall is created as and hands
    // over the drawing tool — so they are buttons rather than canvas modes,
    // and the pip that says one is live belongs to the wall tool, not here.
    ROAD_SURFACES.forEach((kind, i) => {
      tools[`route-${kind}`] = {
        name: `route-${kind}`,
        title: game.i18n.localize(`${LANG_PREFIX}.routes.${kind}`),
        icon: "fa-solid fa-road",
        order: CAPTURE_MODES.length + 2 + i,
        button: true,
        // ONE handler: v13+ calls BOTH `onChange` and `onClick` on a
        // `button: true` tool, so a second arming would arrive unasked.
        onChange: () => armRoadPreset({ surface: kind }),
      };
    });
    // Alley is a modifier on whichever road is armed, not a road of its own: a
    // paved alley and an earthen one are both alleys.
    tools["route-alley"] = {
      name: "route-alley",
      title: game.i18n.localize(`${LANG_PREFIX}.routes.alley`),
      icon: "fa-solid fa-road-barrier",
      order: CAPTURE_MODES.length + 2 + ROAD_SURFACES.length,
      button: true,
      onChange: () => armAlleyPreset(),
    };
    tools["route-convert"] = {
      name: "route-convert",
      title: game.i18n.localize(`${LANG_PREFIX}.routes.convert`),
      icon: "fa-solid fa-arrow-right-arrow-left",
      order: CAPTURE_MODES.length + 3 + ROAD_SURFACES.length,
      button: true,
      onChange: () => convertRoutes(),
    };

    tools.wipe = {
      name: "wipe",
      title: game.i18n.localize(`${LANG_PREFIX}.samples.wipe`),
      icon: "fa-solid fa-trash",
      order: CAPTURE_MODES.length + 10,
      button: true,
      onChange: () => session.wipe(),
    };
    tools.assistant = {
      name: "assistant",
      title: game.i18n.localize(`${LANG_PREFIX}.controls.assistant`),
      icon: "fa-solid fa-sliders",
      order: CAPTURE_MODES.length + 11,
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
 * A second door in scene config: open the assistant, toggle the scene's
 * autoScale gate (whether tokens placed here are auto-sized to the scale), and
 * — on a city map only — say how big a block is drawn here.
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
    // A block is only a unit on a map that has been declared a city; offering
    // the field on a dungeon would invite a number nothing reads.
    const city = flag.mapSystem === "settlement";
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
        ${city ? `<label class="acks-extras-battlemap-block">
          ${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.blockFeet`)}
          <input type="number" min="0" step="1" class="acks-extras-battlemap-blockfeet"
                 value="${flag.blockFeet > 0 ? Number(flag.blockFeet) : ""}"
                 placeholder="${scene.grid?.units ?? ""}">
        </label>` : ""}
      </div>
      <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.sceneConfig.${city ? "blockHint" : "hint"}`)}</p>`;
    anchor.after(group);

    group.querySelector(".acks-extras-battlemap-open").addEventListener("click", () => openAssistant());
    // Written immediately rather than on form submit: the gate is a flag, and
    // the scene-config submit handler knows nothing about it.
    group.querySelector(".acks-extras-battlemap-autoscale").addEventListener("change", async (ev) => {
      await scene.setFlag(MODULE_ID, FLAG_BATTLEMAP, { ...flag, autoScale: ev.currentTarget.checked });
    });
    // Blank or zero clears the declaration rather than storing a block of no
    // width: silence is what the city tracker reads as "time them by their feet".
    group.querySelector(".acks-extras-battlemap-blockfeet")?.addEventListener("change", async (ev) => {
      const feet = Number(ev.currentTarget.value);
      await scene.setFlag(MODULE_ID, FLAG_BATTLEMAP, {
        ...scene.getFlag(MODULE_ID, FLAG_BATTLEMAP) ?? {},
        blockFeet: Number.isFinite(feet) && feet > 0 ? feet : null,
      });
    });
  });
}

/**
 * Retire this scene's declared hex links into road walls, and say what became
 * of them.
 *
 * A press rather than a migration on load: converting writes walls to a scene,
 * and a module that did that unasked would edit maps the Judge had not opened.
 */
async function convertRoutes() {
  const scene = canvas?.scene;
  if (!scene) return;
  const result = await convertRoutesToWalls(scene);
  if (!result) return;
  if (!result.made && !result.skipped) {
    ui.notifications?.info(game.i18n.localize(`${LANG_PREFIX}.routes.convertNone`));
    return;
  }
  ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.routes.converted`, result));
}
