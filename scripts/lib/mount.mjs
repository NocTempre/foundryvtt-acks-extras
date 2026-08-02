/* global game, fromUuid, Hooks, ui */
/**
 * Mount binding — who is riding what.
 *
 * acks-equipment has carried a mounted-combat overlay it cannot switch on:
 * "blocked on there being any 'mounted' state in the system at all"
 * (its settings.mjs). Shield rules alternate between rider and mount, lances
 * only apply mounted, a kite shield's encumbrance changes on horseback — all of
 * it needs one fact nothing recorded: this character is on that animal.
 *
 * THE BINDING IS SYMMETRIC AND STORED ON BOTH ENDS. A rider knows its mount and
 * a mount knows its rider, because both questions get asked from contexts that
 * only hold one of the two — a combat hook has the rider, an encumbrance
 * calculation has the animal. Storing one side and searching for the other means
 * scanning every actor in the world on every read.
 *
 * The pair is kept consistent by writing both ends in one operation and by
 * `mountOf`/`riderOf` verifying the other end still agrees. A half-broken pair
 * (one actor deleted, a world edited by hand) reads as "not mounted" rather
 * than throwing.
 *
 * A mount is not required to be an `acks-lib.animal`. A character can ride a
 * monster, and in ACKS plenty do.
 */
import { MODULE_ID } from "./constants.mjs";

/** Flag keys. Both ends store the OTHER actor's uuid. */
export const MOUNT_FLAG = "mount";
export const RIDER_FLAG = "rider";

/** Custom hooks other modules key off. Namespaced per the family convention. */
export const MOUNT_HOOKS = Object.freeze({
  MOUNTED: "acksLibMounted",
  DISMOUNTED: "acksLibDismounted",
});

const uuidOf = (actor) => actor?.uuid ?? null;

/**
 * The actor this one is riding, or null.
 *
 * Resolves synchronously from the world collection: `fromUuid` is async and
 * this is called from render and roll paths that cannot await. World and token
 * actors both resolve; anything else (a compendium uuid left behind by an
 * import) reads as not mounted.
 */
export function mountOf(actor) {
  const uuid = actor?.getFlag?.(MODULE_ID, MOUNT_FLAG);
  if (!uuid) return null;
  const mount = resolveActorSync(uuid);
  // The far end must still point back, or this is a stale half-pair.
  if (!mount || mount.getFlag(MODULE_ID, RIDER_FLAG) !== uuidOf(actor)) return null;
  return mount;
}

/** The actor riding this one, or null. */
export function riderOf(actor) {
  const uuid = actor?.getFlag?.(MODULE_ID, RIDER_FLAG);
  if (!uuid) return null;
  const rider = resolveActorSync(uuid);
  if (!rider || rider.getFlag(MODULE_ID, MOUNT_FLAG) !== uuidOf(actor)) return null;
  return rider;
}

/** Is this actor on a mount? */
export const isMounted = (actor) => !!mountOf(actor);

/**
 * Resolve an actor uuid without awaiting. Handles "Actor.<id>" and the
 * "Scene.<id>.Token.<id>.Actor.<id>" form a token actor carries.
 */
function resolveActorSync(uuid) {
  if (typeof uuid !== "string") return null;
  const parts = uuid.split(".");
  if (parts[0] === "Actor") return game.actors?.get(parts[1]) ?? null;
  if (parts[0] === "Scene") {
    const scene = game.scenes?.get(parts[1]);
    const token = scene?.tokens?.get(parts[3]);
    return token?.actor ?? null;
  }
  return null;
}

/**
 * Put `rider` on `mount`.
 *
 * Both ends are written, and any binding either actor already had is undone
 * first — a rider has one mount and a mount carries one rider, so mounting
 * without clearing would leave two riders believing they hold the same horse.
 *
 * @returns {Promise<boolean>} whether the binding was made
 */
export async function mountActor(rider, mount) {
  if (!rider || !mount) return false;
  if (rider === mount || uuidOf(rider) === uuidOf(mount)) {
    warn("selfMount");
    return false;
  }
  if (!rider.isOwner || !mount.isOwner) {
    warn("notOwner");
    return false;
  }
  // A mount that says it cannot be ridden is advisory, not a block: the Judge
  // may well allow it, and refusing outright would make the module the referee.
  if (mount.system?.animal && mount.system.animal.mountable === false) {
    warn("notMountable", { name: mount.name });
  }

  await dismount(rider);
  await unseat(mount);

  await rider.setFlag(MODULE_ID, MOUNT_FLAG, uuidOf(mount));
  await mount.setFlag(MODULE_ID, RIDER_FLAG, uuidOf(rider));
  Hooks.callAll(MOUNT_HOOKS.MOUNTED, rider, mount);
  return true;
}

/**
 * Take `rider` off whatever it is riding. Clears BOTH ends, including a mount
 * that has gone stale, so a half-pair cannot survive a dismount.
 * @returns {Promise<boolean>} whether anything changed
 */
export async function dismount(rider) {
  const uuid = rider?.getFlag?.(MODULE_ID, MOUNT_FLAG);
  if (!uuid) return false;
  const mount = resolveActorSync(uuid);
  await rider.unsetFlag(MODULE_ID, MOUNT_FLAG);
  if (mount?.getFlag(MODULE_ID, RIDER_FLAG) === uuidOf(rider) && mount.isOwner) {
    await mount.unsetFlag(MODULE_ID, RIDER_FLAG);
  }
  Hooks.callAll(MOUNT_HOOKS.DISMOUNTED, rider, mount ?? null);
  return true;
}

/** Take whoever is riding `mount` off it. The mirror of dismount(). */
export async function unseat(mount) {
  const uuid = mount?.getFlag?.(MODULE_ID, RIDER_FLAG);
  if (!uuid) return false;
  const rider = resolveActorSync(uuid);
  if (rider) return dismount(rider);
  await mount.unsetFlag(MODULE_ID, RIDER_FLAG); // stale half-pair; clear it
  return true;
}

/**
 * Clean up when an actor is deleted, so the survivor is not left pointing at a
 * document that no longer exists. Registered by module.mjs.
 */
export function registerMountCleanup() {
  Hooks.on("deleteActor", async (actor) => {
    if (!game.user?.isGM) return; // one client does the write, not all of them
    try {
      const rider = riderOf(actor);
      if (rider) await rider.unsetFlag(MODULE_ID, MOUNT_FLAG);
      const mount = mountOf(actor);
      if (mount) await mount.unsetFlag(MODULE_ID, RIDER_FLAG);
    } catch (err) {
      console.warn(`${MODULE_ID} | mount cleanup failed for "${actor?.name}"`, err);
    }
  });
}

/** Localised warning; falls back to the key when unlocalised. */
function warn(key, data = {}) {
  const full = `ACKS-LIB.mount.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.warn(msg);
  void fromUuid;
}
