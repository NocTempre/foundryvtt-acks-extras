/* global canvas, game, ui, Hooks */
/**
 * The two ways a Judge turns ground already on the map into a district: mark
 * regions already drawn, or trace one from a loop of walls — the same two
 * routes `trap-walls.mjs` offers for a trap area, followed here for the same
 * reason: the Judge is usually already holding one selection or the other.
 *
 * Neither tool touches a region's visibility; the reason is stated where the
 * argument is not passed, in `districtFromSelection`.
 */
import { MODULE_ID } from "./constants.mjs";
import { DISTRICT_TYPE } from "./district-zone.mjs";
import { controlledWalls, regionFromWalls } from "../lib/wall-layers.mjs";

/**
 * Has the SERVER seen the District sub-type since the world launched?
 *
 * `module.json` `documentTypes` is read at launch, so after a reload alone the
 * data model is registered in the browser while every create against the type
 * resolves to an empty array instead of throwing. Both tools ask this to tell
 * that state apart from an ordinary failure, because only one of the two is
 * fixed by shutting the world down.
 */
const subTypeRegistered = () => !!game.documentTypes?.RegionBehavior?.includes(DISTRICT_TYPE);

/**
 * Attach a District behavior to every Region currently controlled on the
 * Regions layer, then open each one's sheet so the Judge can type the
 * quarter's figures straight away.
 *
 * IDEMPOTENT: a region that already carries a District behavior is left
 * exactly as it is — its EXISTING behavior is what opens, never a second one
 * stacked beside it.
 *
 * The returned (and reported) count is what was actually confirmed to carry
 * the behavior afterward, never the size of the selection: a sub-type not yet
 * registered on the SERVER (`.claude/rules/live-testing.md` — a
 * `documentTypes` addition needs a world relaunch, not just a reload) makes
 * `createEmbeddedDocuments` resolve to an empty array instead of throwing, so
 * counting the selection would tell the Judge every region was marked when
 * none were.
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
    // Nothing was marked and the type is not on the server: every create in
    // this loop resolved to an empty array.
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.settlement.district.notRegistered"));
  } else {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.settlement.district.markFailed"));
  }
  return { marked };
}

/**
 * Build a District Region from the selected walls' outline.
 *
 * `behaviorType: DISTRICT_TYPE` passed to `regionFromWalls` is what makes a
 * second press on the same loop idempotent: the shared helper recognises a
 * region this tool already made by that type and hands it back rather than
 * stacking a duplicate over the same ground. The notification distinguishes
 * that reused case from a fresh one, which is what makes the idempotence
 * visible rather than merely true — matching the discipline
 * `trap-walls.mjs`'s `regionFromSelection` already keeps for a trap area.
 *
 * Every refusal `regionFromWalls` can hand back (`noScene`, `selectLoop`,
 * `notClosed`, `refused`) gets its own district-owned key rather than
 * borrowing the trap tool's: a later reword of trap wording for its own
 * feature would otherwise silently reword this one too.
 *
 * @returns {Promise<RegionDocument|null>}
 */
export async function districtFromSelection() {
  const walls = controlledWalls();
  const { region, created, reason } = await regionFromWalls(walls, {
    name: game.i18n.localize("ACKS-FORMATION.settlement.district.regionName"),
    // No `visibility` passed: a trap area is pinned to GAMEMASTER because a
    // trap is a surprise, but a district is not — the party already knows
    // which quarter it is standing in — so core's own default (unlocked,
    // shown to anyone who opens the Regions control) is left standing here.
    behaviorType: DISTRICT_TYPE,
    behaviors: [
      {
        type: DISTRICT_TYPE,
        name: game.i18n.localize("ACKS-FORMATION.settlement.district.behaviorName"),
      },
    ],
  });
  if (!region) {
    // `refused` is what a create returning falsy looks like from out here, and
    // before a world relaunch that is exactly what an unregistered sub-type
    // does. Naming the cause rather than the symptom, the way the Regions tool
    // does: a Judge told only that it 'could not be created' has nothing to act
    // on, and the thing to act on is a shutdown.
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
 * trace one from selected walls (Walls layer, beside the trap and road tools
 * that already build a region the same way).
 *
 * Registers on the SAME `getSceneControlButtons` hook the Walls-layer tools
 * do rather than opening a control of its own: leaving a placeables layer
 * releases everything selected on it, so a dedicated District control would
 * empty whichever selection each tool needs at the moment it opened.
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
