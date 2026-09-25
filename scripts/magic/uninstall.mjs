/* global game, ui */
/**
 * Leave-no-trace cleanup for the magic feature: strip the spell primitive
 * (`flags.acks-extras.spell`) from every spell item in the world, so the
 * module can be disabled or uninstalled with no magic data left behind.
 *
 * Only this feature's flag goes. Core's own fields — name, description,
 * `lvl`, `class`, `range`, `duration`, `save`, the cast counter — are the
 * system's and were written as strings a plain spell sheet reads, so a spell
 * keeps its stat line after the strip. The importer's provenance stamp
 * (`flags.acks-extras.cookbook`) is the importer's to strip.
 *
 * Scope: world items, world actors' items, and the synthetic actors of
 * unlinked scene tokens. World compendiums are not touched.
 */
import { MODULE_ID, FLAG_SPELL, SPELL_TYPE } from "./constants.mjs";
import { unset } from "../lib/util.mjs";

/** All actors the cleanup must visit: world actors + unlinked token actors. */
function* allActors() {
  for (const actor of game.actors) yield actor;
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) yield token.actor;
    }
  }
}

const FLAG_PATH = `flags.${MODULE_ID}.${FLAG_SPELL}`;

const carries = (item) => item.type === SPELL_TYPE && item.flags?.[MODULE_ID]?.[FLAG_SPELL] !== undefined;

async function stripItems(parent, items, counts) {
  const strips = [...items].filter(carries).map((item) => ({ _id: item.id, [FLAG_PATH]: unset() }));
  if (!strips.length) return;
  if (parent) await parent.updateEmbeddedDocuments("Item", strips);
  else for (const strip of strips) await game.items.get(strip._id)?.update({ [FLAG_PATH]: unset() });
  counts.items += strips.length;
  if (parent) counts.actors++;
}

/**
 * Strip the spell primitive from the world. GM only.
 * @returns {Promise<{actors: number, items: number}|null>} what was stripped, for the caller to report
 */
export async function stripModuleData() {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | only a GM can strip module data.`);
    return null;
  }
  const counts = { actors: 0, items: 0 };
  for (const actor of allActors()) await stripItems(actor, actor.items, counts);
  await stripItems(null, game.items, counts);
  console.log(`${MODULE_ID} | magic strip complete`, counts);
  return counts;
}
