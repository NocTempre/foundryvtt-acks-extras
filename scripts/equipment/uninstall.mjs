/* global game, ui */
/**
 * Leave-no-trace cleanup: strip everything this module wrote from the world so
 * it can be disabled or uninstalled without leftovers.
 *
 * What the module persists, and what happens to each here:
 *
 *   • The managed "Equipment Loadout" Active Effect on characters — DELETED.
 *     With the module off it would keep applying stale AC/initiative/attack/
 *     damage modifiers forever, invisibly; this is the one piece of leftover
 *     data that actively corrupts play.
 *   • Disguised items (the GM apparent-value mask) — ALWAYS revealed. The mask
 *     writes fake name/cost/damage/AC into core fields with the truth kept only
 *     in our flag; stripping the flag without revealing first would make the
 *     fake identity permanent.
 *   • Masterwork / scavenged stat layers — OPTIONALLY reverted to the pristine
 *     snapshot (`revertLayers`). Off by default: a masterwork blade genuinely
 *     is +1 and most tables want to keep what the fiction earned. Named-item
 *     rungs already unlocked stay in core fields either way (they are earned
 *     state, not machinery).
 *   • Every `flags.acks-equipment.*` on actors and items — REMOVED. This is
 *     container structure, grips, ammo state, proficiency profiles, named-item
 *     trackers: all meaningless without the module.
 *
 * Scope: world actors (with their items), world items, and the synthetic
 * actors of unlinked scene tokens. World compendiums are not touched.
 *
 * Order matters per item: reveal/revert first (those functions read and write
 * our flags), THEN strip the flag namespace in one batched update per actor.
 */
import { MODULE_ID, LOADOUT_EFFECT_FLAG, ITEM_FLAGS } from "./constants.mjs";
import { revealItem } from "./actions.mjs";
import { recomputeItemFields } from "./properties.mjs";

/** All actors the cleanup must visit: world actors + unlinked token actors. */
function* allActors() {
  for (const actor of game.actors) yield actor;
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) yield token.actor;
    }
  }
}

async function cleanItems(parent, items, counts, { revertLayers }) {
  const strips = [];
  for (const item of items) {
    const flags = item.flags?.[MODULE_ID];
    if (!flags) continue;
    if (flags[ITEM_FLAGS.DISGUISE]) {
      await revealItem(item);
      counts.revealed++;
    }
    if (revertLayers && (flags[ITEM_FLAGS.MASTERWORK] || flags.scavenged || flags.pristine)) {
      await recomputeItemFields(item, { masterwork: null, scavenged: null });
      counts.reverted++;
    }
    strips.push({ _id: item.id, [`flags.-=${MODULE_ID}`]: null });
  }
  if (!strips.length) return;
  if (parent) await parent.updateEmbeddedDocuments("Item", strips);
  else for (const strip of strips) await game.items.get(strip._id)?.update({ [`flags.-=${MODULE_ID}`]: null });
  counts.items += strips.length;
}

/**
 * Strip this module's data from the world. GM only.
 * @param {object} [options]
 * @param {boolean} [options.revertLayers=false] also restore masterwork/scavenged
 *   items to their pristine stats (named-item rungs and hand edits stay).
 * @returns {Promise<object>} counts of what was removed, for the caller to report
 */
export async function stripModuleData({ revertLayers = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | only a GM can strip module data.`);
    return null;
  }
  const counts = { actors: 0, items: 0, effects: 0, revealed: 0, reverted: 0 };
  for (const actor of allActors()) {
    const loadouts = actor.effects
      .filter((e) => e.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG) === true)
      .map((e) => e.id);
    if (loadouts.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", loadouts);
      counts.effects += loadouts.length;
    }
    await cleanItems(actor, actor.items, counts, { revertLayers });
    if (actor.flags?.[MODULE_ID]) {
      await actor.update({ [`flags.-=${MODULE_ID}`]: null });
      counts.actors++;
    }
  }
  await cleanItems(null, game.items, counts, { revertLayers });
  console.log(`${MODULE_ID} | strip complete`, counts);
  return counts;
}
