/**
 * Roster links a register row declares: `meta.roster`, the cookbook ids of
 * creatures a keyed place holds that no stat line in its own text gives.
 */
import { occupantRow } from "../../lib/place.mjs";
import { importedActor } from "./target.mjs";

/**
 * A hidden roster row for each id in `entry.meta.roster` the library holds
 * (its own document, never a world copy), in the list's order. A row carries
 * the default quantity and no notes: it says who is there, and nothing about
 * how many. An actor `rows` already holds, or an earlier id gave, is not
 * added twice. Each row counts on `tally.rostered`; an id nothing answers
 * gives no row and counts on `tally.rosterWaiting`, and the place takes it at
 * the next build that finds the creature.
 *
 * @param {{meta?: {roster?: string[]}}|undefined} entry the place's register row
 * @param {{uuid: string}[]} rows the roster rows the place already has
 * @param {{rostered?: number, rosterWaiting?: number}} tally the run's counts
 * @returns {Promise<object[]>} the rows to add
 */
export async function rosterLinkRows(entry, rows, tally) {
  const seen = new Set(rows.map((row) => row.uuid));
  const out = [];
  for (const id of entry?.meta?.roster ?? []) {
    const actor = await importedActor(id, { copies: false });
    if (!actor) {
      tally.rosterWaiting = (tally.rosterWaiting ?? 0) + 1;
      continue;
    }
    if (seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    out.push(occupantRow(actor, { hidden: true }));
    tally.rostered = (tally.rostered ?? 0) + 1;
  }
  return out;
}
