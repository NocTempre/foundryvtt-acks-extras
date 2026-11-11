/* global game, Hooks */
/**
 * Rewrites a saved class builder's "no racial category" from 0 to -1, once.
 *
 * The racial value used to be 0 for a class with no race and for a racial class
 * that spends none of its points on the race alike; it is now -1 for the first
 * and 0 or more for the second (docs/classes/MODEL.md, "Maximum level"). A
 * class record below `CLASS_SCHEMA_VERSION` is read once: one that stores a
 * racial value of 0 and names no race document is a class with no racial
 * category and is written -1; every other record keeps its value. Each is
 * stamped current either way, so a racial value of 0 a Judge sets afterwards is
 * never rewritten, and a second run finds nothing below the stamp and writes
 * nothing. This is the only place the race document is consulted to tell the
 * two apart; the derivation reads the value alone.
 *
 * Covers the world's class items and the class items embedded on actors. Runs
 * at `ready` in the window that runs the world's automation (GM only).
 */
import { MODULE_ID, CLASS_TYPE, CLASS_SCHEMA_VERSION } from "./constants.mjs";
import { primaryGMSettled } from "../lib/util.mjs";

/**
 * The update that brings one class record's stored `system` source current, or
 * null where it already is. `corrected` says whether the racial value moved.
 *
 * @param {object} source - the record's stored `system` source
 * @returns {{update: object, corrected: boolean}|null}
 */
export function builderRaceUpdate(source) {
  if ((source?._schemaVersion ?? 0) >= CLASS_SCHEMA_VERSION) return null;
  const corrected = source?.builder?.race?.value === 0 && !source?.race;
  const update = { "system._schemaVersion": CLASS_SCHEMA_VERSION };
  if (corrected) update["system.builder.race.value"] = -1;
  return { update, corrected };
}

/** The `{ _id, ...update }` rows for the class items of one collection that need one. */
function rowsFor(items) {
  const rows = [];
  let corrected = 0;
  for (const item of items) {
    if (item.type !== CLASS_TYPE) continue;
    const found = builderRaceUpdate(item._source?.system);
    if (!found) continue;
    rows.push({ _id: item.id, ...found.update });
    if (found.corrected) corrected++;
  }
  return { rows, corrected };
}

/**
 * Sweep the world once. GM-only, since it writes class items on other people's
 * characters. Idempotent: a record is read only below the stamp.
 *
 * @returns {Promise<{world: number, actors: number, corrected: number}>} the
 *   class items stamped in the world and on actors, and how many of both had
 *   their racial value rewritten
 */
export async function migrateBuilderRace() {
  const out = { world: 0, actors: 0, corrected: 0 };
  if (!game.user?.isGM) return out;
  const world = rowsFor(game.items ?? []);
  if (world.rows.length) await game.items.documentClass.updateDocuments(world.rows);
  out.world = world.rows.length;
  out.corrected = world.corrected;
  for (const actor of game.actors ?? []) {
    const embedded = rowsFor(actor.items);
    if (!embedded.rows.length) continue;
    await actor.updateEmbeddedDocuments("Item", embedded.rows);
    out.actors += embedded.rows.length;
    out.corrected += embedded.corrected;
  }
  return out;
}

/** Run the sweep once the world is up, in the window that automates. */
export function installBuilderRaceMigration() {
  Hooks.once("ready", () => {
    Promise.resolve(primaryGMSettled())
      .then((primary) => (primary ? migrateBuilderRace() : null))
      .then((r) => {
        if (r?.corrected) {
          console.log(`${MODULE_ID} | class builders with no racial category now store -1: ${r.corrected} corrected (${r.world} in the world, ${r.actors} on characters)`);
        }
      })
      .catch((err) => console.error(`${MODULE_ID} | class builder race migration failed`, err));
  });
}
