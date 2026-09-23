/* global game, ui, foundry */
/**
 * Containers — nested inventory with a RAW weight roll-up (RR pp. 142–145,
 * 161; acks-rules/acks-equipment/RULES.md §1/§3).
 *
 * Contents stay REAL items on the actor, flagged with `containedIn`, so
 * core's computeEncumbrance already counts each item once and the common
 * case needs no correction. Only RAW rules that genuinely disagree with a
 * flat sum are corrected, in `encumbranceDelta6`: the adventurer's harness
 * (RR p. 142), the bowquiver assembly (RR p. 142), and JJ shield variants
 * (JJ pp. 407–408, overlay-gated).
 *
 * Capacity is enforced as a warning on the container, not by altering weight.
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
import { weight6Of, coreWeight6Of, bundleSizeOf, isStowable, isWorn, isClothing, isAmmoItem, gearOf, capacityOf, holdsGear, reliefOf, STONE, containedIn, contentsOf, contentsWeight6 } from "../lib/item-model.mjs";
import { kindsOf, acceptsKinds, cleanAccepts } from "./item-sheet/accept-kinds.mjs";
import { itemBaseType } from "./variation-items.mjs";
// Containment READS live in lib now (the capacity primitive needs them);
// re-exported here so this feature's importers keep one door.
export { containedIn, contentsOf, contentsWeight6 };
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { unset } from "../lib/util.mjs";


/**
 * The container STATE record on an item: `flags.acks-extras.container` —
 * `{locked, opened, concealed, fragile, lockMod}`. Capacity is NOT here (see
 * docs/equipment/DECISIONS.md, "Capacity lives on the gear flag, not the
 * container record (2026-09-22)").
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
 * Is the container locked AND still shut? Two fields rather than one — see
 * docs/equipment/MODEL.md, "2026-07-24 — containers live on the sheet; locks
 * roll the character's own proficiency".
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
 * May this user see what is inside? Visibility is inherited from ownership,
 * gated by the lock: own it and it is open, and you see inside; own it and
 * it is locked, and you do not, until the lock is defeated. The GM always
 * sees inside.
 *
 * A UI rule, not a security boundary (see docs/equipment/MODEL.md,
 * "2026-07-24 — containers live on the sheet; locks roll the character's
 * own proficiency").
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

/**
 * Merge fields into the container record — the lock's quality, the keys that
 * open it, the kinds it accepts and the refusal it gives. One writer, so the
 * record is never replaced wholesale by a caller that knew only its own field.
 */
export async function setContainerRecord(item, patch = {}) {
  await item.setFlag(MODULE_ID, ITEM_FLAGS.CONTAINER, { ...(containerOf(item) ?? {}), ...patch });
  return true;
}

/**
 * Why a container refuses a candidate by KIND, or null when it takes it. The
 * container's own wording rides the answer so the warning quotes it.
 * @returns {{reason:"refused", message:string}|null}
 */
export function kindRefusal(container, item) {
  const rec = containerOf(container);
  const accepts = cleanAccepts(rec?.accepts);
  if (!accepts.length) return null;
  const kinds = kindsOf({
    type: item?.type,
    name: item?.name,
    baseType: itemBaseType(item),
    clothing: isClothing(item),
    ammo: isAmmoItem(item),
    chart: !!item?.getFlag?.(MODULE_ID, "chart")?.sceneUuid,
  });
  if (acceptsKinds(accepts, kinds)) return null;
  return { reason: "refused", message: rec?.refusal || "" };
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
  // A container that names what it takes refuses the rest with its own words.
  const refusal = kindRefusal(container, item);
  if (refusal) return { ok: false, ...refusal };
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
    if (check.reason !== "missing") {
      warn(`storeFailed.${check.reason}`, {
        item: item?.name,
        container: container?.name,
        message: check.message || game.i18n.localize("ACKS-EQUIPMENT.itemSheet.options.refusalDefault"),
      });
    }
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

/**
 * Gear that is put to use comes out of the container holding it — the other
 * half of `storeIn`; a thing is either in the pack or in the hand, never
 * both (see docs/equipment/DECISIONS.md, "Putting gear to use takes it out
 * of the pack (2026-08-30)").
 *
 * The seam is the UPDATE, not the control, so every caller is covered by one
 * rule: this module's Draw and Wear controls, core's own equip toggle sitting
 * on the same row, and a macro. The pending update is patched rather than
 * followed by a second write, so the gear leaves the container and enters use
 * in one document write and no render shows the halfway state.
 *
 * A lock is not consulted: whether the contents can be reached at all is
 * decided before this.
 *
 * @param {Item} item the document about to be updated
 * @param {object} changes the pending update, expanded, mutated in place
 * @returns {boolean} whether the containment was cleared
 */
export function unstowOnUse(item, changes) {
  if (!containedIn(item)) return false;
  const equipping = foundry.utils.getProperty(changes, "system.equipped") === true;
  const wornAt = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.${FLAG_GEAR}.wornAt`);
  if (!equipping && !wornAt) return false;
  foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINED_IN}`, unset());
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
    contents.map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINED_IN}`]: unset() })),
  );
  return contents.length;
}

/** Localised notification helper; falls back to the key when unlocalised. */
function warn(key, data = {}) {
  const full = `ACKS-EQUIPMENT.container.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.warn(msg);
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
        // Weight is not a secret (see docs/equipment/MODEL.md, "load is
        // never hidden").
        contents: visible ? contentsOf(actor, c.id) : [],
      };
    });
}

/**
 * Ordinary gear the harness is able to secure (RR p. 142): not the harness
 * itself (it is the securing device, not secured equipment), not clothing, not
 * heavy items, and not coins — `money` is its own item type, so it is excluded
 * by the type filter. A weapon light enough to hang from a sheath or strap
 * qualifies like any other item; a large one fails the heavy test, and armour
 * never passes it, so neither is listed. The heavy line is `STONE` — the unit
 * the books weigh everything in, and where they draw it.
 */
function harnessEligible6(actor, harnessId) {
  return actor.items
    .filter((i) => i.id !== harnessId)
    .filter((i) => (i.type === ITEM_TYPE.item || i.type === ITEM_TYPE.weapon) && !isClothing(i))
    // A thrown weapon has left the body; its weight comes off below, and the
    // harness cannot secure what it no longer holds.
    .filter((i) => !i.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE))
    // Per-UNIT heavy check stays RAW (not weight6Of): a stack of six 1/6-stone
    // torches sums to a stone but no single one is heavy, so quantity must NOT
    // enter here. The reduce below sums the bundle-aware weight of each row.
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

  // 1. Adventurer's harness: relieves the wearer of the weight its own text
  //    states (`gear.relief`, in stone); unstated relieves nothing. Tests
  //    WORN, never `system.equipped` (see docs/equipment/DECISIONS.md, "A
  //    worn-check gated on `system.equipped` never fires (2026-09-22)").
  const harness = actor.items.find((i) => i.getFlag?.(MODULE_ID, ITEM_FLAGS.HARNESS) && isWorn(i));
  const relief = harness ? reliefOf(harness) : null;
  if (harness && relief !== null && wornArmourType(actor) !== "heavy") {
    delta -= Math.min(relief * STONE, harnessEligible6(actor, harness.id));
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

  // 4. Goods whose stated weight covers a BUNDLE. Core's loop multiplies
  //    `weight6` by the whole quantity and cannot be changed, so the difference
  //    between what it counted and what the bundle actually weighs is corrected
  //    here — this is the ONLY place the two sums are reconciled, and without
  //    it the item sheet and the character sheet print different numbers for
  //    the same quiver.
  //
  //    Restricted to the shape core multiplies: a plain `item` that is not
  //    clothing. A weapon or armour has no quantity in the schema, so core
  //    counts it once whatever a bundle size says.
  for (const i of actor.items) {
    if (i.type !== ITEM_TYPE.item || isClothing(i)) continue;
    if (bundleSizeOf(i) <= 1) continue;
    delta += weight6Of(i) - coreWeight6Of(i);
  }

  return delta;
}
