/* global game, canvas, ui, Hooks, foundry, document, fromUuid */
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
import {
  familyOfScene, foldPaintedClimate, sceneCountry, sceneSetup, sceneTravelSystem, sceneIncidents, writeSceneIncidents,
  writeSceneSetup,
} from "./scene-setup.mjs";
import { footprintFeet, tokenSpan } from "./footprint.mjs";
import { CAPTURE_MODES, session } from "./session.mjs";
import {
  terrainPaint,
  openCountryBrush,
  openTerrainPalette,
  terrainAtPoint,
  terrainRegionsOf,
  hexLabelFromOffset,
  paintHexAt,
  isHexScene,
  layerRegionsOf,
  layerValueAt,
  paintableValues,
  registerTerrainPaintHooks,
  PAINT_LAYERS,
  TERRAIN_COLORS,
  TERRITORY_COLORS,
  climateLabelFor,
  settleRegionsOnly,
} from "./terrain-paint.mjs";
import {
  WATER_KINDS,
  armWaterPreset,
  installWaterControls,
  registerWaterHooks,
  waterFromSelection,
  waterKindLabel,
  waterUnder,
  waterWallData,
  waterWallsOf,
  wallWater,
} from "./water.mjs";
import { COUNTRY_KEYS, countryAt } from "./country.mjs";
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
import { installMapModes, mapModes, mapView, openMapModes, registerMapMode, registerMapViewSetting, setMapView } from "./map-modes.mjs";
import { convertRoutesToWalls, derivedRoutesOf, nodePoint, routesOf, stepBetweenHexes } from "./hex-routes.mjs";
import { elementOf } from "../lib/util.mjs";

const TEMPLATES = [
  `modules/${MODULE_ID}/templates/battlemap/assistant-body.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/assistant-foot.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/terrain-palette.hbs`,
  `modules/${MODULE_ID}/templates/battlemap/map-modes.hbs`,
];

Hooks.once("init", () => {
  installSceneControls();
  installSceneConfigRow();
  installTokenAutoScale();
  registerTerrainPaintHooks();
  registerRoadHooks();
  installRoadControls();
  registerWaterHooks();
  installWaterControls();
  installRoadMarkers();
  registerMapViewSetting();
  installMapModes();
  // The session owns the samples, so it is what a scene change clears — the
  // window is only a view and may not even be open.
  Hooks.on("canvasReady", () => session.onCanvasReady());
  // A map painted with climates hex by hex is folded into its one climate,
  // and its territory regions drawn for a GM are moved onto the Regions
  // control, the first time a GM opens it. The viewing GM writes both, never
  // the active GM: canvasReady fires only on the client drawing the map, so a
  // map opened by an assistant alone would otherwise never settle. Two GMs
  // opening it at once write the same answer.
  Hooks.on("canvasReady", (board) => {
    if (!game.user?.isGM || !board?.scene) return;
    foldPaintedClimate(board.scene)
      .then((climate) => {
        if (!climate) return;
        ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.setup.climateFolded`, { climate: climateLabelFor(climate) }));
      })
      .then(() => settleRegionsOnly(board.scene))
      .catch((err) => console.error(`${MODULE_ID} | settling the painted layers failed`, err));
  });

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
    /** A city map's own incident list — its table, its shift after dark and
     *  the band it hands to the district — read and written (scene-setup.mjs). */
    sceneIncidents,
    writeSceneIncidents,
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
    /** Hex painting (terrain-paint.mjs): the map-prep brush on its layers
     *  and the reads the journey hangs off — a value by hex, labels from
     *  offsets. */
    terrain: {
      paintHexAt,
      terrainAtPoint,
      terrainRegionsOf,
      layerValueAt,
      layerRegionsOf,
      paintableValues,
      hexLabelFromOffset,
      isHexScene,
      openTerrainPalette,
      openCountryBrush,
      PAINT_LAYERS,
      TERRAIN_COLORS,
      TERRITORY_COLORS,
    },
    /** What a GM's map draws over its terrain (map-modes.mjs): the modes,
     *  a feature's own registered beside Territory, and this client's view. */
    mapModes: {
      registerMapMode,
      mapModes,
      mapView,
      setMapView,
      openMapModes,
    },
    /** Rivers and coasts as walls (water.mjs): the layer and its preset. */
    water: {
      WATER_KINDS,
      waterWallData,
      waterWallsOf,
      wallWater,
      waterUnder,
      waterKindLabel,
      armWaterPreset,
      waterFromSelection,
    },
    /** The country under a point (country.mjs) and the scene's own default
     *  under the brush (scene-setup.mjs), written through the setup record. */
    country: {
      COUNTRY_KEYS,
      countryAt,
      sceneCountry,
      writeSceneSetup,
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
 * Calibration gets a control group of its own. Each capture mode IS a
 * scene-control tool (Foundry keeps one active at a time for free); the
 * group carries no `layer`, since it drives the calibration overlay, not a
 * placeables layer. Activating the group opens the window; leaving it
 * disarms and nothing else — the window is dismissed only by its own close
 * control.
 *
 * See docs/battlemap/DECISIONS.md, "The panel is a window again, dismissed
 * by the toolbar."
 */
function installSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tools = {};
    // The group's resting state — without it, every tool in the group draws
    // on the map and core's per-control memory would re-arm one on return.
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
    // The country brush is a canvas-arming tool like the capture modes, so
    // Foundry's one-active-tool rule is the exclusivity: arming it disarms
    // calibration, and vice versa. Hex map prep, GM-only, hex grids only; the
    // palette picks which of its layers it paints.
    tools.terrain = {
      name: "terrain",
      title: game.i18n.localize(`${LANG_PREFIX}.terrain.tool`),
      icon: "fa-solid fa-paintbrush",
      order: CAPTURE_MODES.length + 1,
      onChange: (_event, active) => {
        if (active) openCountryBrush({ by: "tool" });
        else terrainPaint.disarm();
      },
    };
    // Roads are drawn as WALLS with core's own wall tool. Each of these is a
    // PRESET (arms what the next wall is created as), so they are buttons, not
    // canvas modes — the "one is live" pip belongs to the wall tool, not here.
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
    // Rivers and coasts are drawn as WALLS too, armed the way a road is: a
    // preset for core's wall tool, not a canvas mode.
    WATER_KINDS.forEach((kind, i) => {
      tools[`water-${kind}`] = {
        name: `water-${kind}`,
        title: game.i18n.localize(`${LANG_PREFIX}.water.preset.${kind}`),
        icon: kind === "coast" ? "fa-solid fa-umbrella-beach" : "fa-solid fa-water",
        order: CAPTURE_MODES.length + 4 + ROAD_SURFACES.length + i,
        button: true,
        // ONE handler, as for the road presets.
        onChange: () => armWaterPreset({ kind }),
      };
    });

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
    // What the map shows over its terrain. A button, not a canvas mode: the
    // mode it picks stays on through every control, and the window is only
    // its editor.
    tools.mapModes = {
      name: "mapModes",
      title: game.i18n.localize(`${LANG_PREFIX}.controls.mapModes`),
      icon: "fa-solid fa-layer-group",
      order: CAPTURE_MODES.length + 12,
      button: true,
      onChange: () => openMapModes(),
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
 * — on a city map only — say how big a block is drawn here and which incident
 * list is the city's own (`incidentsRow`).
 */
function installSceneConfigRow() {
  Hooks.on("renderSceneConfig", (app, element) => {
    if (game.system?.id !== "acks" || !game.user.isGM) return;
    const root = elementOf(element);
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
    // Blank or zero clears the declaration — silence is what the city
    // tracker reads as "use walking speed".
    group.querySelector(".acks-extras-battlemap-blockfeet")?.addEventListener("change", async (ev) => {
      const feet = Number(ev.currentTarget.value);
      await scene.setFlag(MODULE_ID, FLAG_BATTLEMAP, {
        ...scene.getFlag(MODULE_ID, FLAG_BATTLEMAP) ?? {},
        blockFeet: Number.isFinite(feet) && feet > 0 ? feet : null,
      });
    });
    if (city) group.after(incidentsRow(scene));
  });
}

/**
 * The city's own incident list, on a city map: the table, what it adds
 * after dark, and the band it hands to the district the party is in. Each
 * control writes on change; the table field takes a UUID or a drop, and one
 * that is not a readable RollTable is refused and put back.
 */
function incidentsRow(scene) {
  const say = (key) => game.i18n.localize(`${LANG_PREFIX}.sceneConfig.${key}`);
  const esc = foundry.utils.escapeHTML;
  const held = scene.getFlag(MODULE_ID, FLAG_BATTLEMAP)?.incidents ?? {};
  const figure = (v) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Number(v) : "");
  const row = document.createElement("div");
  row.className = "form-group acks-extras-battlemap-row acks-extras-battlemap-incidents";
  row.innerHTML = `
    <label>${say("incidents")}</label>
    <div class="form-fields">
      <input type="text" class="acks-extras-battlemap-incident-table" aria-label="${esc(say("incidentTable"))}"
             value="${esc(held.tableUuid ?? "")}" placeholder="${esc(say("incidentTablePlaceholder"))}">
      <label class="acks-extras-battlemap-figure">
        ${say("incidentAfterDark")}
        <input type="number" step="1" class="acks-extras-battlemap-incident-dark" value="${figure(held.afterDark)}">
      </label>
      <label class="acks-extras-battlemap-figure">
        ${say("incidentBand")}
        <input type="number" min="1" step="1" class="acks-extras-battlemap-incident-from" value="${figure(held.bandFrom)}">
      </label>
      <input type="number" min="1" step="1" class="acks-extras-battlemap-incident-to"
             aria-label="${esc(say("incidentBandTo"))}" value="${figure(held.bandTo)}">
    </div>
    <p class="hint">${say("incidentsHint")}</p>`;

  const tableInput = row.querySelector(".acks-extras-battlemap-incident-table");
  const setTable = async (uuid) => {
    const text = String(uuid ?? "").trim();
    if (text) {
      const doc = await fromUuid(text).catch(() => null);
      if (doc?.documentName !== "RollTable") {
        ui.notifications?.warn(say("incidentTableUnknown"));
        tableInput.value = sceneIncidents(scene)?.tableUuid ?? "";
        return;
      }
    }
    tableInput.value = text;
    await writeSceneIncidents(scene, { tableUuid: text || null });
  };
  tableInput.addEventListener("change", (ev) => setTable(ev.currentTarget.value));
  tableInput.addEventListener("drop", (ev) => {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
    if (data?.type !== "RollTable" || !data.uuid) return;
    ev.preventDefault();
    ev.stopPropagation();
    setTable(data.uuid);
  });
  for (const [selector, key] of [
    [".acks-extras-battlemap-incident-dark", "afterDark"],
    [".acks-extras-battlemap-incident-from", "bandFrom"],
    [".acks-extras-battlemap-incident-to", "bandTo"],
  ]) {
    row.querySelector(selector).addEventListener("change", (ev) => writeSceneIncidents(scene, { [key]: ev.currentTarget.value }));
  }
  return row;
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
