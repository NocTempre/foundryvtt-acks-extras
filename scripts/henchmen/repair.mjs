/* global game, ui, Hooks, CONFIG, foundry */
/**
 * Dangling-reference repair.
 *
 * Core acks 14.0.1 `AcksActor#getTotalWages` (actor.mjs) walks
 * `system.henchmenList` and dereferences every id unguarded:
 *
 *     const henchman = game.actors.get(id);
 *     const q = henchman.system.retainer?.quantity || 1;   // throws if deleted
 *
 * So ONE deleted hireling that is still listed on an employer makes every
 * render of that character sheet throw at `_prepareContext`. The list is core
 * data (written through the system's own addHenchman/delHenchman), but this
 * module is the main thing that puts ids in it, so the repair ships here.
 *
 * Three layers, in order of when they act:
 *   1. `deleteActor` (GM) — prune references the moment an actor goes away,
 *      so the damage never happens again.
 *   2. `ready` (GM) — sweep existing worlds once; idempotent and silent when
 *      there is nothing to fix.
 *   3. a guarded wrap of `getTotalWages` — sheets still render for players
 *      (who cannot write world data) and for any id we did not catch. It
 *      never writes; repair is the GM paths above and the macro.
 */
import { MODULE_ID, FLAG_MONSTER_LIST } from "./constants.mjs";

/** Ids already reported by the render guard, so the console stays readable. */
const _warned = new Set();

const isMissing = (id) => !!id && !game.actors.get(id);

/**
 * Dangling references held by one actor.
 * @returns {{henchmen: string[], monsters: string[], manager: string|null, duplicates: string[]}}
 */
export function scanActor(actor) {
  const henchmenList = Array.isArray(actor?.system?.henchmenList) ? actor.system.henchmenList : [];
  const monsterList = actor?.getFlag?.(MODULE_ID, FLAG_MONSTER_LIST) ?? [];
  const managerid = actor?.system?.retainer?.managerid ?? "";

  const seen = new Set();
  const duplicates = [];
  for (const id of henchmenList) {
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }

  return {
    henchmen: henchmenList.filter(isMissing),
    monsters: (Array.isArray(monsterList) ? monsterList : []).filter(isMissing),
    manager: isMissing(managerid) ? managerid : null,
    duplicates,
  };
}

/** True when `scanActor` found nothing to do. */
export function isClean(found) {
  return !found.henchmen.length && !found.monsters.length && !found.manager && !found.duplicates.length;
}

/**
 * Repair one actor's dangling references (GM-only write).
 * @returns {Promise<object|null>} what was fixed, or null when already clean
 */
export async function repairActor(actor, { dryRun = false } = {}) {
  const found = scanActor(actor);
  if (isClean(found)) return null;

  const update = {};
  if (found.henchmen.length || found.duplicates.length) {
    const seen = new Set();
    update["system.henchmenList"] = actor.system.henchmenList.filter((id) => {
      if (isMissing(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  if (found.monsters.length) {
    const list = actor.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [];
    update[`flags.${MODULE_ID}.${FLAG_MONSTER_LIST}`] = list.filter((id) => !isMissing(id));
  }
  // An orphaned manager pointer leaves a hireling "retained" by nobody: clear
  // the pointer but keep `enabled`, so the GM can see it needs a new employer.
  if (found.manager) update["system.retainer.managerid"] = "";

  if (!dryRun) await actor.update(update);
  return { actor, ...found };
}

/**
 * Sweep every actor in the world.
 * @returns {Promise<{repaired: object[], scanned: number}>}
 */
export async function repairWorld({ dryRun = false, actors = null } = {}) {
  const pool = actors ?? game.actors.contents;
  const repaired = [];
  for (const actor of pool) {
    try {
      const result = await repairActor(actor, { dryRun });
      if (result) repaired.push(result);
    } catch (err) {
      console.error(`${MODULE_ID} | repair failed for ${actor?.name}`, err);
    }
  }
  return { repaired, scanned: pool.length };
}

/** One-line-per-actor summary for chat/console/dialog output. */
export function describeRepair(result) {
  const bits = [];
  if (result.henchmen.length) bits.push(`${result.henchmen.length} henchman`);
  if (result.monsters.length) bits.push(`${result.monsters.length} monster`);
  if (result.duplicates.length) bits.push(`${result.duplicates.length} duplicate`);
  if (result.manager) bits.push("manager pointer");
  return `${result.actor.name}: ${bits.join(", ")}`;
}

/**
 * Wrap core's unguarded `getTotalWages` so a dangling id cannot break sheet
 * render. The original runs untouched in the healthy case; only on a throw do
 * we recompute over the resolvable ids. Never writes.
 */
export function installWageGuard() {
  const proto = CONFIG?.Actor?.documentClass?.prototype;
  if (!proto?.getTotalWages || proto.getTotalWages[`_${MODULE_ID}Guarded`]) return false;

  const original = proto.getTotalWages;
  const guarded = function (...args) {
    try {
      return original.apply(this, args);
    } catch (err) {
      const list = Array.isArray(this.system?.henchmenList) ? this.system.henchmenList : [];
      const dangling = list.filter(isMissing);
      if (!dangling.length) throw err; // not our failure mode — let it surface

      if (!_warned.has(this.id)) {
        _warned.add(this.id);
        console.warn(
          `${MODULE_ID} | "${this.name}" lists ${dangling.length} deleted hireling(s); ` +
            `wages computed from the rest. Run the "Repair Henchmen References" macro to clean this up.`,
          dangling
        );
      }
      let total = 0;
      for (const id of list) {
        const henchman = game.actors.get(id);
        if (!henchman) continue;
        const q = Number(henchman.system?.retainer?.quantity ?? 1) || 1;
        total += Number(henchman.system?.retainer?.wage ?? 0) * q;
      }
      return total;
    }
  };
  guarded[`_${MODULE_ID}Guarded`] = true;
  proto.getTotalWages = guarded;
  return true;
}

/** Prune every reference to an actor as it is deleted (GM only). */
export function registerDeletionCleanup() {
  Hooks.on("deleteActor", async (actor) => {
    if (game.user !== game.users.activeGM) return;
    const id = actor.id;
    for (const other of game.actors.contents) {
      const inList = Array.isArray(other.system?.henchmenList) && other.system.henchmenList.includes(id);
      const monsters = other.getFlag?.(MODULE_ID, FLAG_MONSTER_LIST) ?? [];
      const inMonsters = Array.isArray(monsters) && monsters.includes(id);
      const isManager = other.system?.retainer?.managerid === id;
      if (!inList && !inMonsters && !isManager) continue;

      const update = {};
      if (inList) update["system.henchmenList"] = other.system.henchmenList.filter((x) => x !== id);
      if (inMonsters) update[`flags.${MODULE_ID}.${FLAG_MONSTER_LIST}`] = monsters.filter((x) => x !== id);
      if (isManager) update["system.retainer.managerid"] = "";
      try {
        await other.update(update);
      } catch (err) {
        console.error(`${MODULE_ID} | could not detach "${actor.name}" from "${other.name}"`, err);
      }
    }
  });
}

/** One-time world sweep at ready (GM only, opt-out via setting). */
export async function sweepAtReady() {
  if (game.user !== game.users.activeGM) return;
  const { repaired } = await repairWorld();
  if (!repaired.length) return;
  console.warn(`${MODULE_ID} | repaired dangling references on ${repaired.length} actor(s)`, repaired.map(describeRepair));
  ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.repair.swept", { count: repaired.length }));
}
