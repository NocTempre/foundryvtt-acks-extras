/* global game, ui, Hooks */
/**
 * Defeating a container's lock — by picking it, or by breaking the container.
 *
 * WHAT THIS DOES NOT DO: invent a throw. The module ships no target numbers for
 * picking a lock or bashing a chest, because it has not read them off anyone's
 * page (docs: scans locate, recipes interpret — a fabricated target is worse
 * than no automation). What it does is ROLL THE CHARACTER'S OWN ABILITY: the
 * Lockpicking or Dungeon Bashing item on their sheet, whose target came from
 * their book via acks-content, rolled through acks-abilities' roller.
 *
 * So this file is plumbing between three things that already exist — the
 * character's proficiency, the roll that proficiency knows how to make, and the
 * container's lock — and it adds no rules of its own. Without acks-abilities it
 * degrades to "roll it yourself and tell me", which is honest.
 *
 * RAW constraint that IS enforced: gloves block lockpicking (RR p. 145,
 * acks-rules/acks-equipment/RULES.md §6).
 */
import { MODULE_ID, HOOKS, ITEM_FLAGS } from "./constants.mjs";
import { containerOf, isLocked, setOpened, contentsOf, isFragile } from "./containers.mjs";
import { slug } from "../lib/vocab.mjs";

/**
 * Proficiency names that defeat a lock, and the ones that break a container.
 *
 * Matched loosely because the books rename them across editions and the shipped
 * system compendium, the RR register and a hand-made item all spell them
 * differently — "Lockpicking" / "Lockpicking Expertise", "Dungeon Bashing" /
 * "Dungeonbashing Expertise". Matching on a normalised prefix covers all of
 * them without this module keeping a rename table it would have to maintain.
 */
const PICK_NAMES = ["lockpicking", "lockpick", "openlocks", "picklocks"];
const BASH_NAMES = ["dungeonbashing", "dungeonbash", "bashing"];

/** The actor's ability item whose name matches one of `names`, or null. */
function findAbility(actor, names) {
  return (
    actor?.items?.find((i) => {
      if (i.type !== "ability") return false;
      const n = slug(i.name);
      return names.some((want) => n.startsWith(want));
    }) ?? null
  );
}

/**
 * Is the character wearing gloves? RR p. 145 blocks pickpocketing, lockpicking
 * and trap-breaking while gloved. Read from the item's own layer/name rather
 * than a curated list, because gloves are ordinary gear a table may hand-make.
 */
function wearingGloves(actor) {
  return !!actor?.items?.find(
    (i) => i.system?.equipped && /\bglove|gauntlet/i.test(i.name ?? ""),
  );
}

/**
 * Roll one of an actor's abilities through acks-abilities.
 *
 * Returns `{ rolled: false }` when the roll cannot be made here — no ability,
 * no roller, or the ability carries no throw. The caller reports that rather
 * than substituting a number.
 */
async function rollProficiency(actor, item) {
  const api = globalThis.acksExtras.abilities;
  if (!api?.rollAbility) return { rolled: false, reason: "noAbilitiesModule" };
  // rollsOf is the module's single read path; an ability with no throw is a
  // real answer, not a failure to look.
  const rolls = api.rollsOf?.(item) ?? [];
  if (!rolls.length) return { rolled: false, reason: "noThrow" };

  const result = await api.rollAbility(item, rolls[0].key);
  // `success` is null when the target could not be resolved — a shared item, or
  // a ladder with no character behind it. Unknown is not failure.
  return { rolled: true, success: result?.success ?? null, total: result?.total ?? null };
}

/**
 * Attempt to pick a container's lock.
 * @returns {Promise<{ok:boolean, reason?:string, success?:boolean|null}>}
 */
export async function pickLock(actor, container) {
  if (!isLocked(container)) return { ok: false, reason: "notLocked" };

  if (wearingGloves(actor)) {
    notify("warn", "gloved");
    return { ok: false, reason: "gloved" };
  }

  const ability = findAbility(actor, PICK_NAMES);
  if (!ability) {
    notify("warn", "noPickProficiency", { name: actor?.name });
    return { ok: false, reason: "noProficiency" };
  }

  const { rolled, reason, success } = await rollProficiency(actor, ability);
  if (!rolled) {
    notify("info", `manual.${reason}`, { ability: ability.name });
    return { ok: false, reason };
  }

  // An unresolved target leaves the outcome to the table: the roll is in chat,
  // and the Judge opens the lock (or does not) with the manual control.
  if (success === null) {
    notify("info", "manual.unresolved", { name: container.name });
    return { ok: true, success: null };
  }

  if (success) {
    await setOpened(container, true);
    notify("info", "picked", { name: container.name });
    Hooks.callAll(HOOKS?.LOCK_PICKED ?? "acksEquipmentLockPicked", actor, container);
  } else {
    notify("warn", "pickFailed", { name: container.name });
  }
  return { ok: true, success };
}

/**
 * Attempt to break a container open.
 *
 * On success the container is DESTROYED, not merely opened — that is what
 * bashing a chest does. Its contents spill onto the actor, except that a
 * container marked `fragile` takes its contents with it: bashing a crate of
 * potions is how you end up with no potions.
 *
 * Contents are only ever destroyed for a `fragile` container, and the caller is
 * expected to have confirmed — see the sheet control, which asks first.
 */
export async function bashOpen(actor, container) {
  if (!container) return { ok: false, reason: "missing" };

  const ability = findAbility(actor, BASH_NAMES);
  if (!ability) {
    notify("warn", "noBashProficiency", { name: actor?.name });
    return { ok: false, reason: "noProficiency" };
  }

  const { rolled, reason, success } = await rollProficiency(actor, ability);
  if (!rolled) {
    notify("info", `manual.${reason}`, { ability: ability.name });
    return { ok: false, reason };
  }
  if (success === null) {
    notify("info", "manual.unresolved", { name: container.name });
    return { ok: true, success: null };
  }
  if (!success) {
    notify("warn", "bashFailed", { name: container.name });
    return { ok: true, success: false };
  }

  await destroyContainer(actor, container);
  return { ok: true, success: true };
}

/**
 * Break the container: contents spill (or break, if fragile), then it is gone.
 * Separate from bashOpen so a Judge can apply the outcome without a roll.
 */
export async function destroyContainer(actor, container) {
  const contents = contentsOf(actor, container.id);
  const fragile = isFragile(container);

  if (contents.length) {
    if (fragile) {
      await actor.deleteEmbeddedDocuments("Item", contents.map((i) => i.id));
      notify("warn", "bashedFragile", { name: container.name, n: contents.length });
    } else {
      // Spilled, not destroyed: nothing is deleted by a UI action unless the
      // rule says it breaks.
      await actor.updateEmbeddedDocuments(
        "Item",
        contents.map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.-=${ITEM_FLAGS.CONTAINED_IN}`]: null })),
      );
      notify("info", "bashedSpilled", { name: container.name, n: contents.length });
    }
  } else {
    notify("info", "bashed", { name: container.name });
  }

  Hooks.callAll(HOOKS?.CONTAINER_BASHED ?? "acksEquipmentContainerBashed", actor, container, { fragile });
  await actor.deleteEmbeddedDocuments("Item", [container.id]);
  return true;
}

/** Is a lock-defeating action available to this actor at all? */
export const canPick = (actor) => !!findAbility(actor, PICK_NAMES);
export const canBash = (actor) => !!findAbility(actor, BASH_NAMES);

/** Localised notification; falls back to the key when unlocalised. */
function notify(level, key, data = {}) {
  const full = `ACKS-EQUIPMENT.lock.${key}`;
  const msg = game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
  ui.notifications?.[level]?.(msg);
  void containerOf;
}
