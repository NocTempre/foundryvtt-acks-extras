/* global game, Hooks, ui */
/**
 * Mount binding — who is riding what.
 *
 * acks-equipment has carried a mounted-combat overlay it cannot switch on:
 * "blocked on there being any 'mounted' state in the system at all"
 * (its settings.mjs). Shield rules alternate between rider and mount, lances
 * only apply mounted, a kite shield's encumbrance changes on horseback — all of
 * it needs one fact nothing recorded: this character is on that animal.
 *
 * THIS IS A FACADE OVER lib/attachment.mjs, and a permanent one. Mounting is
 * the `rider` role of the one attachment relationship — the same binding that
 * seats a passenger in a wagon and an ox in the traces — so the fact is stored
 * ONCE, as the rider's attachment flag, and every consumer of "who is aboard
 * what" agrees with every consumer of "who is riding what". The API and hooks
 * here keep their names because they are the mounted-combat vocabulary other
 * features were promised; only the storage moved.
 *
 * LEGACY PAIRS ARE STILL READ. This module used to store a symmetric
 * MOUNT_FLAG/RIDER_FLAG pair on both ends; worlds written under that scheme
 * read correctly (both ends must still agree, as before), and any write —
 * mounting or dismounting — replaces the pair with the attachment flag and
 * clears it. Worlds converge lazily; no migration sweep.
 *
 * A mount is not required to be an `acks-lib.animal`. A character can ride a
 * monster, and in ACKS plenty do.
 */
import { resolveActorSync } from "./storage.mjs";
import { MODULE_ID } from "./constants.mjs";
import { attachmentOf, attachedTo, attach, detach } from "./attachment.mjs";

/** Legacy flag keys. Both ends stored the OTHER actor's uuid; read-only now. */
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
 * this is called from render and roll paths that cannot await.
 */
export function mountOf(actor) {
  const at = attachmentOf(actor);
  if (at) return at.role === "rider" ? resolveActorSync(at.uuid) : null;
  // Legacy pair: the far end must still point back, or this is a stale half.
  const uuid = actor?.getFlag?.(MODULE_ID, MOUNT_FLAG);
  if (!uuid) return null;
  const mount = resolveActorSync(uuid);
  if (!mount || mount.getFlag(MODULE_ID, RIDER_FLAG) !== uuidOf(actor)) return null;
  return mount;
}

/** The actor riding this one, or null. */
export function riderOf(actor) {
  const viaAttachment = attachedTo(actor, "rider")[0] ?? null;
  if (viaAttachment) return viaAttachment;
  const uuid = actor?.getFlag?.(MODULE_ID, RIDER_FLAG);
  if (!uuid) return null;
  const rider = resolveActorSync(uuid);
  if (!rider || rider.getFlag(MODULE_ID, MOUNT_FLAG) !== uuidOf(actor)) return null;
  // A rider whose attachment says something else (boarded a wagon since) is
  // not on this horse, whatever the stale pair claims.
  if (attachmentOf(rider)) return null;
  return rider;
}

/** Is this actor on a mount? */
export const isMounted = (actor) => !!mountOf(actor);

/**
 * Put `rider` on `mount`.
 *
 * Any binding either actor already had is undone first — a rider has one
 * mount and a mount carries one rider, so mounting without clearing would
 * leave two riders believing they hold the same horse.
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

  const res = await attach(rider, mount, "rider");
  if (!res.ok) {
    warn(res.reason === "circular" ? "circular" : "selfMount");
    return false;
  }
  // Converge: the pair is replaced by the attachment, never kept beside it.
  if (rider.getFlag(MODULE_ID, MOUNT_FLAG)) await rider.unsetFlag(MODULE_ID, MOUNT_FLAG);
  if (mount.getFlag(MODULE_ID, RIDER_FLAG)) await mount.unsetFlag(MODULE_ID, RIDER_FLAG);
  Hooks.callAll(MOUNT_HOOKS.MOUNTED, rider, mount);
  return true;
}

/**
 * Take `rider` off whatever it is riding. Clears the attachment or the legacy
 * pair, whichever holds the binding, so neither survives a dismount.
 * @returns {Promise<boolean>} whether anything changed
 */
export async function dismount(rider) {
  const at = attachmentOf(rider);
  if (at?.role === "rider") {
    const mount = resolveActorSync(at.uuid);
    await detach(rider);
    if (rider.getFlag(MODULE_ID, MOUNT_FLAG)) await rider.unsetFlag(MODULE_ID, MOUNT_FLAG);
    Hooks.callAll(MOUNT_HOOKS.DISMOUNTED, rider, mount ?? null);
    return true;
  }
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
  const rider = attachedTo(mount, "rider")[0] ?? null;
  if (rider) return dismount(rider);
  const uuid = mount?.getFlag?.(MODULE_ID, RIDER_FLAG);
  if (!uuid) return false;
  const legacyRider = resolveActorSync(uuid);
  if (legacyRider) return dismount(legacyRider);
  await mount.unsetFlag(MODULE_ID, RIDER_FLAG); // stale half-pair; clear it
  return true;
}

/**
 * Clean up LEGACY pairs when an actor is deleted, so the survivor is not left
 * pointing at a document that no longer exists. The attachment store has its
 * own cleanup (attachment.mjs); this one only tends the old flags. Registered
 * by module.mjs.
 */
export function registerMountCleanup() {
  Hooks.on("deleteActor", async (actor) => {
    if (!game.user?.isGM) return; // one client does the write, not all of them
    try {
      const riderUuid = actor?.getFlag?.(MODULE_ID, RIDER_FLAG);
      const rider = resolveActorSync(riderUuid);
      if (rider?.getFlag(MODULE_ID, MOUNT_FLAG) === uuidOf(actor)) await rider.unsetFlag(MODULE_ID, MOUNT_FLAG);
      const mountUuid = actor?.getFlag?.(MODULE_ID, MOUNT_FLAG);
      const mount = resolveActorSync(mountUuid);
      if (mount?.getFlag(MODULE_ID, RIDER_FLAG) === uuidOf(actor)) await mount.unsetFlag(MODULE_ID, RIDER_FLAG);
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
}
