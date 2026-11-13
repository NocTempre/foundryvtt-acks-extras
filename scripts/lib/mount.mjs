/* global game, Hooks, ui, fromUuidSync */
/**
 * Mount binding — who is riding what.
 *
 * A facade over lib/attachment.mjs: mounting is the `rider` role of the one
 * attachment relationship, stored once on the rider's flag. The API and hooks
 * here keep their mounted-combat names; only the storage moved. See
 * docs/lib/MODEL.md, "Carrying: mounts, teams and everything aboard".
 *
 * A mount need not be an `acks-extras.animal` — a character can ride a
 * monster.
 */
import { resolveActorSync, handOver } from "./storage.mjs";
import { ANIMAL_TYPE } from "./constants.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";
import { isGoods, isCurrency } from "./item-model.mjs";
import { attachmentOf, attachedTo, attach, detach } from "./attachment.mjs";

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
  return at?.role === "rider" ? resolveActorSync(at.uuid) : null;
}

/** The actor riding this one, or null. */
export function riderOf(actor) {
  return attachedTo(actor, "rider")[0] ?? null;
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
  // mountable === false only warns; it is advisory, not a block.
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
  Hooks.callAll(MOUNT_HOOKS.MOUNTED, rider, mount);
  return true;
}

/**
 * `mountActor` as a sheet gesture makes it: the binding is said aloud, naming
 * both ends, because the drop that made it leaves nothing else on screen.
 * @returns {Promise<boolean>} whether the binding was made
 */
export async function ride(rider, mount) {
  const bound = await mountActor(rider, mount);
  if (bound) ui.notifications?.info(game.i18n.format("ACKS-LIB.mount.mounted", { rider: rider.name, mount: mount.name }));
  return bound;
}

/** Is `a` riding `b`? */
const rides = (a, b) => !!b && mountOf(a)?.uuid === b.uuid;

/**
 * The two drops a mount answers ahead of the sheet they land on, whichever
 * sheet the world draws the actor with. Registered by module.mjs.
 *
 * An animal dropped on a character seats the character on it; the sheet's own
 * handler, which hires what is dropped on it, never sees a mount.
 *
 * Goods dragged between a rider and the mount they ride are handed over, not
 * copied. Core's cross-actor item drop creates a copy and leaves the original
 * where it was, which between these two weighs the same kit on both: the
 * rider's own load, and again on the mount, which already bears the rider's.
 * Coin is left to the sheet it lands on, which moves it by its own rule
 * (`landCoin`).
 */
export function registerMountDrop() {
  Hooks.on("dropActorSheetData", (target, _sheet, data) => {
    if (data?.type === "Actor") {
      if (target?.type !== ACTOR_TYPE.character) return;
      const dropped = resolveActorSync(data.uuid);
      if (dropped?.type !== ANIMAL_TYPE) return;
      void ride(target, dropped);
      return false;
    }
    if (data?.type !== "Item" || !data.uuid) return;
    const item = fromUuidSync(data.uuid);
    const source = item?.parent;
    if (source?.documentName !== "Actor" || !isGoods(item) || isCurrency(item)) return;
    if (!rides(source, target) && !rides(target, source)) return;
    void handOver(source, target, [{ id: item.id }]);
    return false;
  });
}

/**
 * Take `rider` off whatever it is riding.
 * @returns {Promise<boolean>} whether anything changed
 */
export async function dismount(rider) {
  const at = attachmentOf(rider);
  if (at?.role !== "rider") return false;
  const mount = resolveActorSync(at.uuid);
  await detach(rider);
  Hooks.callAll(MOUNT_HOOKS.DISMOUNTED, rider, mount ?? null);
  return true;
}

/** Take whoever is riding `mount` off it. The mirror of dismount(). */
export async function unseat(mount) {
  const rider = attachedTo(mount, "rider")[0] ?? null;
  return rider ? dismount(rider) : false;
}

/** Localised warning; falls back to the key when unlocalised. */
function warn(key, data = {}) {
  const full = `ACKS-LIB.mount.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.warn(msg);
}
