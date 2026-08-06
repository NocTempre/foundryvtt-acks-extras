/* global game, ui, foundry, Actor, Hooks, fromUuidSync */
/**
 * Scene ↔ place linking.
 *
 * A map and a place are the same thing seen two ways: the scene is what the
 * party walks around in, the location actor is what the place *is* — its
 * contents, its occupants, what it sits inside, and (sometimes) its market. The
 * link makes each reachable from the other.
 *
 * THE LINK IS MADE ON DEMAND, NEVER AUTOMATICALLY. The affordances are a
 * scene-config picker and a directory context entry; nothing exists until
 * somebody asks for it.
 *
 * THE SCENE'S FLAG IS AUTHORITATIVE; the location's `system.sceneUuid` is a
 * MIRROR. One direction has to win or the two drift, and the scene's wins
 * because a scene can be duplicated, imported and deleted by hands that never
 * touch the actor directory. The mirror exists so the place sheet can offer
 * "open the map" without scanning every scene on every render, and it is
 * repaired from the flag whenever the two are seen to disagree.
 */
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, SCENE_LINK_FLAG } from "./constants.mjs";

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
  let scene = null;
  try {
    scene = fromUuidSync(uuid);
  } catch {
    return null;
  }
  if (scene?.documentName !== "Scene") return null;
  // A mirror that the scene no longer agrees with is stale — trust the flag.
  return scene.getFlag(MODULE_ID, SCENE_LINK_FLAG) === location.uuid ? scene : null;
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
 * Make a place for a scene and link the two.
 *
 * The new place takes the scene's name and its navigation image, so the actor
 * directory reads like the map list rather than like a list of "New Actor".
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

/* -------------------------------------------- */
/*  Keeping the mirror true                      */
/* -------------------------------------------- */

/**
 * Repair the mirror whenever the flag moves, and drop it when the scene dies.
 *
 * ONE CLIENT WRITES. Every GM sees these hooks and they all write the same
 * actor; the originating-user check is the same discipline the follower-card
 * sweep uses, and unlike a create it is idempotent, so a missed run is repaired
 * by the next one rather than lost.
 */
export function registerSceneLinkSync() {
  Hooks.on("updateScene", async (scene, changes, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    const flag = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${SCENE_LINK_FLAG}`);
    const cleared = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.-=${SCENE_LINK_FLAG}`);
    if (flag === undefined && !cleared) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
      const shouldPoint = flag && actor.uuid === flag;
      const doesPoint = actor.system.sceneUuid === scene.uuid;
      if (shouldPoint && !doesPoint) await actor.update({ "system.sceneUuid": scene.uuid }).catch(() => null);
      else if (!shouldPoint && doesPoint) await actor.update({ "system.sceneUuid": "" }).catch(() => null);
    }
  });

  // A deleted scene leaves every mirror pointing at it dangling. The place
  // itself is NOT deleted: the inn survives the map of the inn being thrown
  // away, and its stored goods and roster are exactly why.
  Hooks.on("deleteScene", async (scene, _options, userId) => {
    if (userId !== game.userId || !game.user.isGM) return;
    for (const actor of game.actors.filter((a) => a.type === LOCATION_TYPE && a.system.sceneUuid === scene.uuid)) {
      await actor.update({ "system.sceneUuid": "" }).catch(() => null);
    }
  });
}

/* -------------------------------------------- */
/*  The affordances                              */
/* -------------------------------------------- */

/**
 * Right-click a scene in the directory: open its place, or make one.
 *
 * Two entries rather than one toggle, because they are different acts with
 * different costs — one navigates, the other creates a world document.
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
 * DOM injection rather than a sheet subclass, for the reason the character
 * sheet's Storage tab documents: core declares its parts as statics and a
 * subclass would fight every other module that wants a row. Rebuilt on every
 * render rather than latched, because ApplicationV2 replaces its parts.
 */
export function registerSceneConfigRow() {
  Hooks.on("renderSceneConfig", (app, element) => {
    if (game.system?.id !== "acks" || !game.user.isGM) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    root.querySelectorAll(".acks-extras-scene-place").forEach((n) => n.remove());
    // Core's Basics tab renders `navName` through `formGroup`, so the row lands
    // under the navigation name. If core ever renames that field, fall back to
    // the tab's last group rather than vanishing without trace — an oddly
    // placed control is recoverable, a missing one looks like a broken module.
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

    // Written immediately rather than on form submit: the link is a flag on
    // the scene plus a field on an actor, and a submit handler could only ever
    // write the first half.
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
