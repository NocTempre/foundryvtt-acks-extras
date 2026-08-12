/* global game, ui */
/**
 * Containers — nested inventory with a RAW weight roll-up (RR pp. 142–145, 161;
 * acks-rules/acks-equipment/RULES.md §1/§3).
 *
 * Design note (reuse first). Contents stay REAL items on the actor, flagged with
 * `containedIn`. That means core's computeEncumbrance already counts each item
 * exactly once, and a backpack's contents already weigh on the carrier — which
 * is what RAW wants. So the common case needs **no** correction at all, and
 * acks-formation keeps reading core's encumbrance unchanged.
 *
 * Only a few RAW rules genuinely disagree with a flat sum, and only those are
 * corrected:
 *
 *  1. **Adventurer's harness** (RR p. 142): the wearer "can ignore 1 stone's
 *     worth of equipment". It cannot secure heavy items, coins, or be worn over
 *     heavy armour — so the stone it forgives is drawn only from ordinary
 *     (non-heavy, non-coin) gear.
 *  2. **Bowquiver** (RR p. 142): empty it counts as 1 item; holding a bow and 20
 *     arrows the whole assembly counts as **2 items** — not bow (1 stone) plus
 *     quiver plus arrows. A flat sum is wildly heavier than RAW.
 *  3. **JJ shield variants** (JJ pp. 407–408, overlay-gated): a shield is rated
 *     by variant and carry state, not by its item weight — a buckler counts as
 *     one item rather than a stone, a kite shield rides lighter mounted, and a
 *     front-strapped crescent is heavier than a slung one.
 *
 * Capacity (backpack 4 st, rucksack 2, sack 6/2, saddlebag 3, pouch 1/2) is
 * enforced as a warning on the container, not by altering weight.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { FLAG_GEAR } from "../lib/constants.mjs";
import { shieldEncumbranceDelta6 } from "./overlays/shield-variants.mjs";
import { isHelmet, isShield } from "./profiles.mjs";
// The family's item primitives. `weight6Of` is quantity-aware and returns 0 for
// non-physical items — see the notes below on where raw PER-UNIT weight is
// wanted instead (harness heavy-check, shield baseline), which do NOT go
// through it. `isStowable` is where coin's missing cost/weight6 is reconciled:
// coin is goods without being physical, so asking `isPhysical` here loses it.
import { weight6Of, isStowable, isWorn, isClothing, gearOf, capacityOf, holdsGear, STONE } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";


/**
 * The container STATE record on an item: `flags.acks-extras.container` —
 * `{locked, opened, concealed, fragile, lockMod}`.
 *
 * Capacity is NOT here. It is a property of gear (acks-lib `capacityOf`), not
 * of a category called containers: a coat with hidden pockets and a bandolier
 * hold gear without being carrying devices, and while capacity lived in this
 * record only the items annotated as devices could have one.
 */
export function containerOf(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.CONTAINER) ?? null;
}

/**
 * Can gear go inside this?
 *
 * Either ground counts: a declared capacity (any gear at all — the coat with
 * pockets), or a container state record (a chest a Judge made by hand and gave
 * a lock but no stated size).
 */
export function isContainer(item) {
  return holdsGear(item) || !!containerOf(item);
}

/** Declared capacity in stone (0 = a container of unstated size, which never warns). */
export function capacityStone(item) {
  return capacityOf(item) ?? 0;
}

/* -------------------------------------------------------------------------- */
/*  Locks, concealment, and who may look inside                                */
/* -------------------------------------------------------------------------- */

/**
 * Is the container locked AND still shut?
 *
 * `locked` is the lock's existence; `opened` records that someone has defeated
 * it. Two fields rather than one because picking a lock does not remove it —
 * the chest can be re-locked, and the Judge should not have to re-describe the
 * lock to do it.
 */
export function isLocked(item) {
  const c = containerOf(item);
  return !!c?.locked && !c?.opened;
}

/** A display-only fold. It hides nothing from anyone; it just tidies the list. */
export const isConcealed = (item) => !!containerOf(item)?.concealed;

/** Do the contents break when the container is bashed open? */
export const isFragile = (item) => !!containerOf(item)?.fragile;

/**
 * May this user see what is inside?
 *
 * VISIBILITY IS INHERITED FROM OWNERSHIP, GATED BY THE LOCK. Picking up a
 * locked crate tells you that you are carrying a locked crate — not what is in
 * it. So: own it and it is open, and you see inside; own it and it is locked,
 * and you do not, until the lock is defeated.
 *
 * The GM always sees inside: they are the one who decided what is in there.
 *
 * This is a UI rule, not a security boundary. The contents are ordinary items
 * on the actor and Foundry replicates them to their owner regardless — a player
 * determined to look can. Treat it as "the sheet does not tell you", which is
 * what a locked chest at the table actually means, and put anything that must
 * genuinely stay secret on a GM-owned actor.
 */
export function canSeeInside(item, user = game.user) {
  if (!item) return false;
  if (user?.isGM) return true;
  if (!isLocked(item)) return true;
  return false;
}

/**
 * Lock or unlock a container. Locking a container that was opened shuts it
 * again — the lock is still the same lock.
 */
export async function setLocked(item, locked = true) {
  const c = { ...(containerOf(item) ?? {}) };
  c.locked = !!locked;
  if (locked) c.opened = false;
  await item.setFlag(MODULE_ID, ITEM_FLAGS.CONTAINER, c);
  return true;
}

/** Record that the lock has been defeated (picked, bashed, or a key used). */
export async function setOpened(item, opened = true) {
  const c = { ...(containerOf(item) ?? {}) };
  c.opened = !!opened;
  await item.setFlag(MODULE_ID, ITEM_FLAGS.CONTAINER, c);
  return true;
}

/** Fold or unfold the container's row. Display only. */
export async function setConcealed(item, concealed = true) {
  const c = { ...(containerOf(item) ?? {}) };
  c.concealed = !!concealed;
  await item.setFlag(MODULE_ID, ITEM_FLAGS.CONTAINER, c);
  return true;
}
/** The container item id this item is stored inside, if any. */
export function containedIn(item) {
  return item?.getFlag?.(MODULE_ID, ITEM_FLAGS.CONTAINED_IN) ?? null;
}
/** Items stored directly inside a container. */
export function contentsOf(actor, containerId) {
  return actor.items.filter((i) => containedIn(i) === containerId);
}

/** Items carried loose — not inside anything (containers themselves included). */
export function looseItems(actor) {
  return actor.items.filter((i) => isStowable(i) && !containedIn(i));
}

/**
 * The chain of containers an item sits inside, outermost last.
 * Bounded by the item count so a pre-existing cycle in data cannot hang.
 */
export function containerChain(actor, item) {
  const chain = [];
  let cursor = containedIn(item);
  for (let guard = actor.items.size; cursor && guard > 0; guard--) {
    const next = actor.items.get(cursor);
    if (!next || chain.includes(next)) break;
    chain.push(next);
    cursor = containedIn(next);
  }
  return chain;
}

/**
 * Can `item` legally go into `container`? Capacity is deliberately NOT a
 * blocker — RAW capacity is a warning (see the header), so overfilling is
 * allowed and merely flagged. Structural impossibilities are blocked.
 * @returns {{ok:boolean, reason?:string}}
 */
export function canStore(actor, item, container) {
  if (!item || !container) return { ok: false, reason: "missing" };
  if (!isContainer(container)) return { ok: false, reason: "notAContainer" };
  if (item.id === container.id) return { ok: false, reason: "selfContained" };
  if (!isStowable(item)) return { ok: false, reason: "notStowable" };
  // A shut lock is a real obstacle, unlike capacity: you cannot put the sword
  // in the chest without opening the chest. Blocked for everyone including the
  // GM, because silently succeeding would make the lock decorative.
  if (isLocked(container)) return { ok: false, reason: "locked" };
  // A container may go inside another, but never inside itself transitively.
  if (isContainer(item) && containerChain(actor, container).some((c) => c.id === item.id)) {
    return { ok: false, reason: "cycle" };
  }
  return { ok: true };
}

/**
 * Put an item into a container.
 *
 * Worn or wielded gear is not "stowed" — RAW you must take it off first — so an
 * equipped item is unequipped as part of being stored. That update flows through
 * the module's normal preUpdateItem/updateItem enforcement, so the loadout, the
 * managed effect, and any Paper Doll slot all follow on their own.
 *
 * @returns {Promise<boolean>} whether the item moved
 */
export async function storeIn(actor, item, container) {
  const check = canStore(actor, item, container);
  if (!check.ok) {
    if (check.reason !== "missing") warn(`storeFailed.${check.reason}`, { item: item?.name, container: container?.name });
    return false;
  }
  if (containedIn(item) === container.id) return false; // already there
  const updates = { [`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINED_IN}`]: container.id };
  // Both worn stores are cleared, because either can be the one holding it.
  if (item.system?.equipped) updates["system.equipped"] = false;
  if (gearOf(item).wornAt) updates[`flags.${MODULE_ID}.${FLAG_GEAR}.wornAt`] = "";
  await item.update(updates);
  if (overCapacity(actor, container)) {
    warn("overCapacity", { container: container.name, capacity: capacityStone(container) });
  }
  return true;
}

/** Take an item out of whatever container holds it. */
export async function takeOut(item) {
  if (!containedIn(item)) return false;
  await item.unsetFlag(MODULE_ID, ITEM_FLAGS.CONTAINED_IN);
  return true;
}

/**
 * Emptying a container leaves its contents loose on the actor rather than
 * deleting them — nothing is destroyed by a UI action.
 */
export async function emptyContainer(actor, container) {
  const contents = contentsOf(actor, container.id);
  if (!contents.length) return 0;
  await actor.updateEmbeddedDocuments(
    "Item",
    contents.map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.-=${ITEM_FLAGS.CONTAINED_IN}`]: null })),
  );
  return contents.length;
}

/** Localised notification helper; falls back to the key when unlocalised. */
function warn(key, data = {}) {
  const full = `ACKS-EQUIPMENT.container.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.warn(msg);
}

/** Total weight6 of a container's contents (one level; nesting recurses). */
export function contentsWeight6(actor, containerId, seen = new Set()) {
  if (seen.has(containerId)) return 0; // guard against a container inside itself
  seen.add(containerId);
  return contentsOf(actor, containerId).reduce(
    (sum, i) => sum + weight6Of(i) + (isContainer(i) ? contentsWeight6(actor, i.id, seen) : 0),
    0,
  );
}

/** Is a container carrying more than its RAW capacity? */
export function overCapacity(actor, container) {
  const cap = capacityStone(container);
  if (!cap) return false;
  return contentsWeight6(actor, container.id) > cap * STONE;
}

/** Every container on the actor, with its load — for the popout UI. */
export function containerReport(actor) {
  return actor.items
    .filter(isContainer)
    .map((c) => {
      const load6 = contentsWeight6(actor, c.id);
      const cap = capacityStone(c);
      const visible = canSeeInside(c);
      return {
        item: c,
        capacityStone: cap,
        load6,
        loadStone: load6 / STONE,
        over: cap > 0 && load6 > cap * STONE,
        locked: isLocked(c),
        concealed: isConcealed(c),
        fragile: isFragile(c),
        visible,
        // WEIGHT IS NOT A SECRET. A locked chest still drags on your
        // encumbrance, and hiding its load would make the number on the sheet
        // unexplainable. You cannot see what is inside; you can feel that it
        // is heavy — which is exactly right.
        contents: visible ? contentsOf(actor, c.id) : [],
      };
    });
}

/**
 * Ordinary gear the harness is able to secure (RR p. 142): not the harness
 * itself (it is the securing device, not secured equipment), not clothing, not
 * heavy items (>= 1 stone), and not coins — `money` is its own item type, so it
 * is excluded by the type filter.
 */
function harnessEligible6(actor, harnessId) {
  return actor.items
    .filter((i) => i.id !== harnessId)
    .filter((i) => i.type === ITEM_TYPE.item && !isClothing(i))
    // Per-UNIT heavy check stays RAW (not weight6Of): a stack of six 1/6-stone
    // torches sums to a stone but no single one is heavy, so quantity must NOT
    // enter here. The reduce below is over type==="item" rows only, where
    // weight6Of === the old itemWeight6.
    .filter((i) => Number(i.system?.weight6 ?? 0) < STONE)
    .reduce((sum, i) => sum + weight6Of(i), 0);
}

/** Worn armour category, for the harness's "not over heavy armour" clause. */
function wornArmourType(actor) {
  const worn = actor.items.find((i) => i.type === ITEM_TYPE.armor && isWorn(i) && !isShield(i) && !isHelmet(i));
  return worn?.system?.type ?? "unarmored";
}

/**
 * Correction (in weight6) to core's flat encumbrance sum. Negative = lighter.
 * Returns 0 when nothing RAW-specific applies — the common case.
 */
export function encumbranceDelta6(actor) {
  let delta = 0;

  // 0. JJ shield variants rate a shield by type and carry state rather than by
  //    the item's own weight (a kite shield rides lighter mounted; a buckler
  //    counts as one item, not one stone). Off unless that overlay is enabled.
  delta += shieldEncumbranceDelta6(actor);

  // 1. Adventurer's harness: ignore up to 1 stone of ordinary equipment.
  //    WORN, not `system.equipped` — a harness is a plain `item`, which core
  //    gives no `equipped` field, so gating on that field made this rule
  //    permanently inert. Never re-narrow a worn test to one store.
  const harness = actor.items.find((i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.HARNESS) && isWorn(i));
  if (harness && wornArmourType(actor) !== "heavy") {
    delta -= Math.min(STONE, harnessEligible6(actor, harness.id));
  }

  // 2. Bowquiver: the assembly counts as 2 items when holding anything, 1 when
  //    empty — rather than quiver + bow + arrows summed.
  for (const q of actor.items.filter((i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.BOWQUIVER))) {
    const contents = contentsOf(actor, q.id);
    const flat = weight6Of(q) + contentsWeight6(actor, q.id);
    const raw = contents.length ? 2 : 1; // items, i.e. 2/6 or 1/6 stone
    delta += raw - flat;
  }

  // 3. Thrown-away weapons: a weapon that has been thrown has left the
  //    wielder's hands and no longer weighs on them until it is recovered
  //    (ammo.mjs marks it; the Recover action clears it).
  for (const w of actor.items.filter((i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE))) {
    delta -= weight6Of(w);
  }

  return delta;
}
