/* global game, ui, foundry, Actor, Hooks */
/**
 * Scene ↔ place linking.
 *
 * The link makes a scene and the location actor it IS reachable from each
 * other. It is made on demand (a scene-config picker and a directory context
 * entry), never automatically. The scene's flag is authoritative; the
 * location's `system.sceneUuid` is a mirror, repaired from the flag whenever
 * the two disagree.
 * See docs/location/DECISIONS.md, "A location is a PLACE, and a market is an option on one (2026-08-02)".
 */
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, SCENE_LINK_FLAG } from "./constants.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { elementOf, isUnset, docOf } from "../lib/util.mjs";

/* -------------------------------------------- */
/*  Reading the link                             */
/* -------------------------------------------- */

/** The place a scene is, or null. */
export function locationOfScene(scene) {
  const uuid = scene?.getFlag?.(MODULE_ID, SCENE_LINK_FLAG);
  if (!uuid) return null;
  const actor = game.actors?.get(String(uuid).split(".")[1]) ?? null;
  return actor?.type === LOCATION_TYPE ? actor : null;
}

/** The scene a place is, or null. Reads the mirror, verifies against the flag. */
export function sceneOfLocation(location) {
  const uuid = location?.system?.sceneUuid;
  if (!uuid) return null;
  const scene = docOf(uuid);
  if (scene?.documentName !== "Scene") return null;
  // A mirror that the scene no longer agrees with is stale — trust the flag.
  return scene.getFlag(MODULE_ID, SCENE_LINK_FLAG) === location.uuid ? scene : null;
}

/* -------------------------------------------- */
/*  A region's place                             */
/* -------------------------------------------- */

/**
 * The place a scene Region is, or null.
 *
 * The same flag the scene carries, at the Region's grain: the place mirrors it
 * in `system.regionUuid`. The Region's flag is authoritative; the mirror is
 * repaired from it whenever the two disagree.
 */
export function locationOfRegion(region) {
  const uuid = region?.getFlag?.(MODULE_ID, SCENE_LINK_FLAG);
  if (!uuid) return null;
  const actor = game.actors?.get(String(uuid).split(".")[1]) ?? null;
  return actor?.type === LOCATION_TYPE ? actor : null;
}

/** The Region a place is, or null. Reads the mirror, verifies against the flag. */
export function regionOfLocation(location) {
  const uuid = location?.system?.regionUuid;
  if (!uuid) return null;
  const region = docOf(uuid);
  if (region?.documentName !== "Region") return null;
  return region.getFlag(MODULE_ID, SCENE_LINK_FLAG) === location.uuid ? region : null;
}

/* -------------------------------------------- */
/*  Making and breaking it                       */
/* -------------------------------------------- */

/**
 * Link a scene to a place, writing both ends. Re-linking a scene that already
 * points elsewhere clears the old place's mirror first, so a location never
 * claims a map that has moved on.
 */
export async function linkScene(scene, location) {
  if (!scene || !location || !game.user.isGM) return false;
  const previous = locationOfScene(scene);
  if (previous && previous.uuid !== location.uuid) {
    await previous.update({ "system.sceneUuid": "" }).catch(() => null);
  }
  await scene.setFlag(MODULE_ID, SCENE_LINK_FLAG, location.uuid);
  await location.update({ "system.sceneUuid": scene.uuid });
  return true;
}

/** Break the link from either end. */
export async function unlinkScene(scene) {
  if (!scene || !game.user.isGM) return false;
  const location = locationOfScene(scene);
  await scene.unsetFlag(MODULE_ID, SCENE_LINK_FLAG).catch(() => null);
  if (location) await location.update({ "system.sceneUuid": "" }).catch(() => null);
  return true;
}

/**
 * Make a place for a scene and link the two. The new place takes the scene's
 * name and thumbnail.
 */
export async function createLocationForScene(scene) {
  if (!scene || !game.user.isGM) return null;
  const existing = locationOfScene(scene);
  if (existing) {
    existing.sheet?.render(true);
    return existing;
  }
  const location = await Actor.create({
    name: scene.name,
    type: LOCATION_TYPE,
    img: scene.thumb || "icons/svg/village.svg",
    system: { sceneUuid: scene.uuid },
  });
  if (!location) return null;
  await scene.setFlag(MODULE_ID, SCENE_LINK_FLAG, location.uuid);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.place.sceneLinked`, { name: scene.name }));
  location.sheet?.render(true);
  return location;
}

/**
 * Link a Region to a place, writing both ends. A place that pointed at another
 * region lets it go first, and a region that pointed at another place clears
 * that place's mirror, so neither end ever claims a link the other denies.
 */
export async function linkRegion(region, location) {
  if (!region || !location || !game.user.isGM) return false;
  const previous = locationOfRegion(region);
  if (previous && previous.uuid !== location.uuid) {
    await previous.update({ "system.regionUuid": "" }).catch(() => null);
  }
  await region.setFlag(MODULE_ID, SCENE_LINK_FLAG, location.uuid);
  await location.update({ "system.regionUuid": region.uuid });
  return true;
}

/** Break a region's link from either end. */
export async function unlinkRegion(region) {
  if (!region || !game.user.isGM) return false;
  const location = locationOfRegion(region);
  await region.unsetFlag(MODULE_ID, SCENE_LINK_FLAG).catch(() => null);
  if (location) await location.update({ "system.regionUuid": "" }).catch(() => null);
  return true;
}

/**
 * Make a place for a Region and link the two. Named after the region and
 * nested inside the scene's own place when the scene has one.
 */
export async function createLocationForRegion(region) {
  if (!region || !game.user.isGM) return null;
  const existing = locationOfRegion(region);
  if (existing) {
    existing.sheet?.render(true);
    return existing;
  }
  const location = await Actor.create({
    name: region.name,
    type: LOCATION_TYPE,
    img: "icons/svg/city.svg",
    system: { regionUuid: region.uuid, parentUuid: locationOfScene(region.parent)?.uuid ?? "" },
  });
  if (!location) return null;
  await region.setFlag(MODULE_ID, SCENE_LINK_FLAG, location.uuid);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.place.regionLinked`, { name: location.name, region: region.name }));
  location.sheet?.render(true);
  return location;
}

/**
 * Write the mirrors for a scene CREATED already linked, its regions' with it.
 *
 * A scene created with its link flags is never seen by the update hooks
 * below, and the mirrors cannot ride in the same create. One batched update,
 * only for a place whose mirror does not already say so.
 * @returns {Promise<number>} how many places were written
 */
export async function mirrorCreatedLinks(scene) {
  if (!scene || !game.user.isGM) return 0;
  const updates = new Map();
  const want = (uuid, key, value) => {
    const actor = uuid ? game.actors?.get(String(uuid).split(".")[1]) : null;
    if (actor?.type !== LOCATION_TYPE || actor.system?.[key] === value) return;
    updates.set(actor.id, { ...(updates.get(actor.id) ?? { _id: actor.id }), [`system.${key}`]: value });
  };
  want(scene.getFlag(MODULE_ID, SCENE_LINK_FLAG), "sceneUuid", scene.uuid);
  for (const region of scene.regions ?? []) want(region.getFlag(MODULE_ID, SCENE_LINK_FLAG), "regionUuid", region.uuid);
  if (updates.size) await Actor.updateDocuments([...updates.values()]);
  return updates.size;
}

/* -------------------------------------------- */
/*  Keeping the mirror true                      */
/* -------------------------------------------- */

/**
 * Repair the mirror whenever the flag moves, and drop it when the scene dies.
 *
 * One client writes: every GM sees these hooks, so each acts only on its own
 * originating update.
 */
export function registerSceneLinkSync() {
  Hooks.on("updateScene", async (scene, changes, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    const flag = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${SCENE_LINK_FLAG}`);
    // Cleared as core's unsetFlag writes it, or as the `-=` deletion key spells it.
    const cleared = isUnset(flag) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=${SCENE_LINK_FLAG}`);
    if (flag === undefined && !cleared) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      const shouldPoint = flag && actor.uuid === flag;
      const doesPoint = actor.system.sceneUuid === scene.uuid;
      if (shouldPoint && !doesPoint) await actor.update({ "system.sceneUuid": scene.uuid }).catch(() => null);
      else if (!shouldPoint && doesPoint) await actor.update({ "system.sceneUuid": "" }).catch(() => null);
    }
  });

  // A deleted scene leaves mirrors dangling; the place itself is kept.
  Hooks.on("deleteScene", async (scene, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE && a.system.sceneUuid === scene.uuid)) {
      await actor.update({ "system.sceneUuid": "" }).catch(() => null);
    }
    // Its regions went with it, and every mirror pointing into it with them.
    const inside = `${scene.uuid}.Region.`;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE && String(a.system.regionUuid ?? "").startsWith(inside))) {
      await actor.update({ "system.regionUuid": "" }).catch(() => null);
    }
  });

  // The region's link, kept true the same way; the place survives its region.
  Hooks.on("updateRegion", async (region, changes, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    const flag = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${SCENE_LINK_FLAG}`);
    const cleared = isUnset(flag) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=${SCENE_LINK_FLAG}`);
    if (flag === undefined && !cleared) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      const shouldPoint = flag && actor.uuid === flag;
      const doesPoint = actor.system.regionUuid === region.uuid;
      if (shouldPoint && !doesPoint) await actor.update({ "system.regionUuid": region.uuid }).catch(() => null);
      else if (!shouldPoint && doesPoint) await actor.update({ "system.regionUuid": "" }).catch(() => null);
    }
  });

  Hooks.on("deleteRegion", async (region, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE && a.system.regionUuid === region.uuid)) {
      await actor.update({ "system.regionUuid": "" }).catch(() => null);
    }
  });
}

/* -------------------------------------------- */
/*  The affordances                              */
/* -------------------------------------------- */

/**
 * Right-click a scene in the directory: open its place, or make one (two
 * entries; one navigates, the other creates a world document).
 */
export function registerSceneContextMenu() {
  Hooks.on("getSceneContextOptions", (_application, options) => {
    if (game.system?.id !== "acks") return;
    const sceneFor = (li) => game.scenes.get(li?.dataset?.entryId);
    options.push(
      {
        label: `${LANG_PREFIX}.place.openLocation`,
        icon: '<i class="fa-solid fa-map-location-dot"></i>',
        visible: (li) => !!locationOfScene(sceneFor(li)),
        onClick: (_event, li) => locationOfScene(sceneFor(li))?.sheet?.render(true),
      },
      {
        label: `${LANG_PREFIX}.place.createLocation`,
        icon: '<i class="fa-solid fa-house-circle-check"></i>',
        visible: (li) => game.user.isGM && !locationOfScene(sceneFor(li)),
        onClick: (_event, li) => createLocationForScene(sceneFor(li)),
      }
    );
  });
}

/**
 * A "Place" row in the scene configuration's Basics tab: pick an existing
 * location, make a new one, or clear the link.
 *
 * DOM injection, not a sheet subclass: core declares its parts as statics.
 * Rebuilt on every render, because ApplicationV2 replaces its parts.
 */
export function registerSceneConfigRow() {
  Hooks.on("renderSceneConfig", (app, element) => {
    if (game.system?.id !== "acks" || !game.user.isGM) return;
    const root = elementOf(element);
    if (!root) return;
    root.querySelectorAll(".acks-extras-scene-place").forEach((n) => n.remove());
    // The row lands under core's `navName` group, else the tab's last group.
    const basics = root.querySelector('.tab[data-tab="basics"]') ?? root;
    const anchor =
      root.querySelector('[name="navName"]')?.closest(".form-group") ??
      basics.querySelector(".form-group:last-of-type");
    if (!anchor) {
      console.warn(`${MODULE_ID} | scene config: no anchor for the place row`);
      return;
    }

    const scene = app.document;
    const linked = locationOfScene(scene);
    const locations = game.actors.filter((a) => a.type === LOCATION_TYPE).sort((a, b) => a.name.localeCompare(b.name));

    const group = document.createElement("div");
    group.className = "form-group acks-extras-scene-place";
    const options = [`<option value="">${game.i18n.localize(`${LANG_PREFIX}.place.noLocation`)}</option>`]
      .concat(
        locations.map(
          (a) => `<option value="${a.uuid}" ${linked?.uuid === a.uuid ? "selected" : ""}>${foundry.utils.escapeHTML(a.name)}</option>`
        )
      )
      .join("");
    group.innerHTML = `
      <label>${game.i18n.localize(`${LANG_PREFIX}.place.sceneLabel`)}</label>
      <div class="form-fields">
        <select class="acks-extras-scene-place-select">${options}</select>
        <button type="button" class="acks-extras-scene-place-new" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.place.createLocation`)}">
          <i class="fas fa-plus"></i>
        </button>
      </div>
      <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.place.sceneHint`)}</p>`;
    anchor.after(group);
    // The scene config is core's window, so the binding is scoped to the group
    // this module built and reaches nothing core owns.
    associateLabels(group);

    // Written immediately, not on form submit: a submit handler could only write the scene's half.
    group.querySelector(".acks-extras-scene-place-select").addEventListener("change", async (ev) => {
      const uuid = ev.currentTarget.value;
      if (!uuid) return void (await unlinkScene(scene));
      const actor = game.actors.get(uuid.split(".")[1]);
      if (actor) await linkScene(scene, actor);
    });
    group.querySelector(".acks-extras-scene-place-new").addEventListener("click", async () => {
      const made = await createLocationForScene(scene);
      if (made) app.render();
    });
  });
}
