/* global game */
/**
 * Where a damage die typed for a spell row that states none is kept, and which
 * copies of the spell a Judge's save reaches.
 *
 * A die is kept per row key in the copy's `flags["acks-extras"].spellDie`
 * (`cast-rows.mjs` `withKeptDice` reads it into the row, so a cast, its relay and
 * its throws all see one row). A copy keeps following its library twin for
 * everything else. A copy HAS a die for a row when its effective row states one
 * or a die is kept for it, and no save overwrites either.
 *
 * "Every copy" is the spell's source entry (the library twin, else the spell
 * itself) and each spell item in the world that is a copy of it: a world item or
 * an item on a world actor, matched to its source by the cookbook id both carry,
 * else by the copy's `_stats.compendiumSource` naming the source. An unlinked
 * token's own copy is not reached.
 */
import { MODULE_ID, SPELL_TYPE, FLAG_SPELL_DIE } from "./constants.mjs";
import { rowsOf, keyedRows, damageBlank, keptDiceOf } from "./cast-rows.mjs";
import { libraryTwin } from "./summon-spell.mjs";

const cookbookOf = (item) => item?.flags?.[MODULE_ID]?.cookbook?.id ?? "";

/** Whether `copy` is a copy of the spell `source`: the same cookbook id, else a compendium source naming it. */
export function isCopyOf(copy, source) {
  if (!copy || !source || copy === source) return false;
  const id = cookbookOf(source);
  if (id && cookbookOf(copy) === id) return true;
  return !!source.uuid && copy._stats?.compendiumSource === source.uuid;
}

/** The spell's source entry: its library twin, else itself. */
export const sourceOf = (spell, lookups) => (lookups ? libraryTwin(spell, lookups) : null) ?? spell;

/** Whether the effective row of `rowKey` on `item` is a damage row with no die. */
export function rowBlankOn(item, rowKey, lookups) {
  const found = keyedRows(rowsOf(item, lookups).rows).find((keyed) => keyed.key === rowKey);
  return !!found && damageBlank(found.row);
}

/** Every spell item the world holds outside a compendium and an unlinked token: world items, then each world actor's own. */
export function worldSpells() {
  const out = [];
  for (const item of game.items ?? []) if (item.type === SPELL_TYPE) out.push(item);
  for (const actor of game.actors ?? []) for (const item of actor.items ?? []) if (item.type === SPELL_TYPE) out.push(item);
  return out;
}

/**
 * What a Judge's save would reach for one row: the source entry and each copy
 * of it, sorted by whether the row is blank there.
 *
 * @param {object} spell  the copy the cast is of
 * @param {string} rowKey
 * @param {{lookups: object, items?: object[]}} world  `items` is the world's spells, `worldSpells()` by default
 * @returns {{source: object, entryBlank: boolean, blank: object[], kept: object[]}}
 */
export function planKeepForAll(spell, rowKey, { lookups, items = worldSpells() }) {
  const source = sourceOf(spell, lookups);
  const copies = [...new Set([spell, ...items.filter((item) => isCopyOf(item, source))])].filter((item) => item !== source);
  const blank = [];
  const kept = [];
  for (const copy of copies) (rowBlankOn(copy, rowKey, lookups) ? blank : kept).push(copy);
  return { source, entryBlank: rowBlankOn(source, rowKey, lookups), blank, kept };
}

/** Whether the source entry sits in a locked compendium, where it cannot be written. */
export const entryLocked = (source) => !!source?.pack && !!game.packs?.get?.(source.pack)?.locked;

/** How many places a Judge's save would write: the blank copies and the entry when it is blank and can be written. */
export const blankCount = (plan) => plan.blank.length + (plan.entryBlank && !entryLocked(plan.source) ? 1 : 0);

/**
 * Keep `die` for `rowKey` on one copy. Resolves whether it was written.
 * @param {object} item
 * @param {string} rowKey
 * @param {string} die
 */
export async function keepOn(item, rowKey, die) {
  try {
    await item.setFlag(MODULE_ID, FLAG_SPELL_DIE, { ...keptDiceOf(item), [rowKey]: die });
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | a spell's damage die was not kept`, err);
    return false;
  }
}

/**
 * Keep `die` for `rowKey` on the source entry and on every copy that has none.
 * A copy that has a die is left as it is. A source entry in a locked compendium
 * is not written, and the blank copies still are.
 *
 * @param {object} spell  the copy the cast is of
 * @param {string} rowKey
 * @param {string} die
 * @param {{lookups: object, items?: object[]}} world
 * @returns {Promise<{written: number, kept: number, failed: number, entry: "written"|"had"|"locked"|"failed"}>}
 */
export async function keepForAll(spell, rowKey, die, world) {
  const plan = planKeepForAll(spell, rowKey, world);
  let written = 0;
  let failed = 0;
  for (const copy of plan.blank) {
    if (await keepOn(copy, rowKey, die)) written++;
    else failed++;
  }
  let entry = "had";
  if (plan.entryBlank) {
    if (entryLocked(plan.source)) entry = "locked";
    else entry = (await keepOn(plan.source, rowKey, die)) ? "written" : "failed";
  }
  return { written, kept: plan.kept.length, failed, entry };
}
