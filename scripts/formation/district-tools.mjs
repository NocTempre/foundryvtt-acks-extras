/* global canvas, game, ui, Hooks, foundry, document */
/**
 * The two ways a Judge turns ground already on the map into a district: mark
 * regions already drawn, or trace one from a loop of walls. See
 * docs/formation/MODEL.md, "The two tools make a district out of whatever
 * the Judge is already holding".
 */
import { MODULE_ID } from "./constants.mjs";
import { DISTRICT_TYPE } from "./district-zone.mjs";
import { controlledWalls, regionFromWalls } from "../lib/wall-layers.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";

/**
 * A "Place" row on the District behaviour's sheet: the location actor the
 * quarter is. Reads and writes the link through the location feature's own
 * api, so this sheet knows nothing about how it is stored. DOM injection
 * rather than a sheet subclass; rebuilt on every render, since ApplicationV2
 * replaces its parts.
 */
export function installDistrictPlaceRow() {
  Hooks.on("renderRegionBehaviorConfig", (app, element) => {
    if (!game.user?.isGM) return;
    const behavior = app?.document;
    if (behavior?.type !== DISTRICT_TYPE) return;
    const region = behavior.parent;
    const scenes = globalThis.acksExtras?.location?.scenes;
    if (!region || typeof scenes?.locationOfRegion !== "function") return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    root.querySelectorAll(".acks-extras-district-place").forEach((n) => n.remove());
    // Under the behaviour's own fields, which core renders as the last fieldset.
    const host = root.querySelector("fieldset:last-of-type") ?? root.querySelector("form") ?? root;

    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
    const say = (key) => game.i18n.localize(`ACKS-FORMATION.DISTRICT.place.${key}`);
    const linked = scenes.locationOfRegion(region);
    const places = game.actors.filter((a) => a.type === LOCATION_TYPE).sort((a, b) => a.name.localeCompare(b.name));
    const group = document.createElement("div");
    group.className = "form-group acks-extras-district-place";
    group.innerHTML = `<label>${esc(say("label"))}</label>
      <div class="form-fields">
        <select class="acks-extras-district-place-select">
          <option value="">${esc(say("none"))}</option>
          ${places.map((a) => `<option value="${esc(a.uuid)}"${linked?.uuid === a.uuid ? " selected" : ""}>${esc(a.name)}</option>`).join("")}
        </select>
        <button type="button" class="acks-extras-district-place-new" data-tooltip="${esc(say("create"))}">
          <i class="fas fa-plus"></i>
        </button>
      </div>
      <p class="hint">${esc(say("hint"))}</p>`;
    host.append(group);
    associateLabels(group);

    // Written immediately: the sheet's own submit knows nothing of this link.
    const report = (run) =>
      Promise.resolve(run).catch((err) => console.error(`${MODULE_ID} | district place link failed`, err));
    group.querySelector(".acks-extras-district-place-select").addEventListener("change", (ev) => {
      const uuid = ev.currentTarget.value;
      const actor = uuid ? game.actors.get(uuid.split(".")[1]) : null;
      report(actor ? scenes.linkRegion(region, actor) : scenes.unlinkRegion(region));
    });
    group.querySelector(".acks-extras-district-place-new").addEventListener("click", () => {
      report(Promise.resolve(scenes.createLocationForRegion(region)).then((made) => made && app.render()));
    });
  });
}

/**
 * Has the server seen the District sub-type since the world launched? See
 * docs/formation/MODEL.md, "A behaviour sub-type is spelled twice", and
 * `.claude/rules/live-testing.md` on the relaunch requirement.
 */
const subTypeRegistered = () => !!game.documentTypes?.RegionBehavior?.includes(DISTRICT_TYPE);

/**
 * Attach a District behavior to every Region currently controlled on the
 * Regions layer, then open each one's sheet. Idempotent: a region already
 * carrying a District behavior opens its existing one. The returned count is
 * what was actually confirmed afterward, never the size of the selection.
 *
 * @returns {Promise<{marked: number}>}
 */
export async function markControlledRegions() {
  const regions = (canvas?.regions?.controlled ?? []).map((r) => r.document).filter(Boolean);
  if (!regions.length) {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.settlement.district.noRegions"));
    return { marked: 0 };
  }
  let marked = 0;
  for (const region of regions) {
    let behavior = region.behaviors.find((b) => b.type === DISTRICT_TYPE);
    if (!behavior) {
      const created = await region.createEmbeddedDocuments("RegionBehavior", [
        { type: DISTRICT_TYPE, name: game.i18n.localize("ACKS-FORMATION.settlement.district.behaviorName") },
      ]);
      behavior = created[0];
    }
    if (behavior) {
      marked++;
      behavior.sheet?.render(true);
    }
  }
  if (marked === regions.length) {
    ui.notifications?.info(game.i18n.format("ACKS-FORMATION.settlement.district.marked", { count: marked }));
  } else if (marked > 0) {
    ui.notifications?.warn(
      game.i18n.format("ACKS-FORMATION.settlement.district.markPartial", { count: marked, total: regions.length }),
    );
  } else if (!subTypeRegistered()) {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.settlement.district.notRegistered"));
  } else {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.settlement.district.markFailed"));
  }
  return { marked };
}

/**
 * Build a District Region from the selected walls' outline. Idempotent: a
 * wall loop already bounding a district hands that district back rather
 * than stacking a duplicate; the notification names which happened. Every
 * refusal `regionFromWalls` can hand back gets its own district-owned key,
 * never the trap tool's.
 *
 * @returns {Promise<RegionDocument|null>}
 */
export async function districtFromSelection() {
  const walls = controlledWalls();
  const { region, created, reason } = await regionFromWalls(walls, {
    name: game.i18n.localize("ACKS-FORMATION.settlement.district.regionName"),
    // No `visibility` passed: unlike a trap, a district is not a surprise.
    behaviorType: DISTRICT_TYPE,
    behaviors: [
      {
        type: DISTRICT_TYPE,
        name: game.i18n.localize("ACKS-FORMATION.settlement.district.behaviorName"),
      },
    ],
  });
  if (!region) {
    // `refused` before a world relaunch is what an unregistered sub-type
    // looks like from here; named as such rather than as a bare failure.
    const key = reason === "refused" && !subTypeRegistered() ? "notRegistered" : reason;
    ui.notifications?.warn(game.i18n.localize(`ACKS-FORMATION.settlement.district.${key}`));
    return null;
  }
  region.behaviors.find((b) => b.type === DISTRICT_TYPE)?.sheet?.render(true);
  ui.notifications?.info(
    game.i18n.localize(
      created ? "ACKS-FORMATION.settlement.district.regionMade" : "ACKS-FORMATION.settlement.district.regionReused",
    ),
  );
  return region;
}

/**
 * Two Judge tools: mark selected Regions as a district (Regions layer), and
 * trace one from selected walls (Walls layer). Registers on the same
 * `getSceneControlButtons` hook the Walls-layer tools use rather than a
 * control of its own — leaving a placeables layer releases its selection.
 */
export function installDistrictControls() {
  // A `button: true` tool's `onChange` is not awaited by core, so a rejected
  // promise inside it becomes an unhandled rejection with nothing shown to
  // the Judge. Every handler below is wrapped the same way trap-walls.mjs's
  // drop handlers are: log it, and say so where the Judge is looking.
  const reportFailure = (fn) => () =>
    fn().catch((err) => {
      console.error(`${MODULE_ID} | district tool failed`, err);
      ui.notifications?.error(game.i18n.localize("ACKS-FORMATION.settlement.district.toolError"));
    });

  Hooks.on("getSceneControlButtons", (controls) => {
    const add = (group, tool) => {
      // v13+ hands these over as an object keyed by name; older builds as an
      // array. Both shapes are still in the wild across the family's worlds.
      if (Array.isArray(group.tools)) group.tools.push(tool);
      else group.tools[tool.name] = tool;
    };

    const regions = controls.regions ?? controls.find?.((c) => c.name === "regions");
    if (regions) {
      add(regions, {
        name: "acksDistrictMark",
        title: game.i18n.localize("ACKS-FORMATION.settlement.district.toolMark"),
        icon: "fa-solid fa-city",
        // Ordered past core's own Regions tools; an absent `order` sorts as
        // NaN and scatters a tool away from where a Judge expects it.
        order: 20,
        button: true,
        visible: game.user.isGM,
        // ONE handler. A `button: true` tool given both `onChange` and
        // `onClick` fires both for a single press.
        onChange: reportFailure(markControlledRegions),
      });
    }

    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (walls) {
      add(walls, {
        name: "acksDistrictFromWalls",
        title: game.i18n.localize("ACKS-FORMATION.settlement.district.toolRegion"),
        icon: "fa-solid fa-draw-polygon",
        // Past the trap tools (20, 21) and the road tool (22) so the family's
        // wall-loop tools stay grouped at the end of the row.
        order: 23,
        button: true,
        visible: game.user.isGM,
        onChange: reportFailure(districtFromSelection),
      });
    }
  });
}
