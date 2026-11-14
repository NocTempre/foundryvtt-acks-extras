/**
 * The printed figures behind a monster's natural attacks, read from the
 * Judge's own Monstrous Manual (MM Overview p. 12, Damage): the damage type
 * each natural weapon is listed against, and the hit dice and size past which
 * a monster's natural attacks deal extraordinary rather than mundane damage.
 * They are imported into the `monsters` registry document's
 * `naturalWeaponDamage` and `extraordinaryRule` tables and read here; nothing
 * in source states one, and a figure that was not imported reads as null. A
 * Judge's override layer is read like any other. Foundry-free.
 *
 * Which weapon is which, and which monster types each extraordinary rule
 * covers, is procedure and lives in the importer (`importer/stats-map.mjs`),
 * which takes what is read here as arguments.
 */
import { expectTables, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";
import { DAMAGE_TYPES } from "../lib/vocab.mjs";

/** The registry document the figures sit on. */
export const NATURAL_DOC = "monsters";

/** The monster size categories, smallest first. */
export const SIZE_ORDER = Object.freeze(["small", "man", "large", "huge", "gigantic", "colossal"]);

// Declared where it is read, so the import names the tables as outstanding
// whichever feature loads first. The ids are the two tables below, written as
// literals because the producers gate reads this call from source.
expectTables(NATURAL_DOC, ["naturalWeaponDamage", "extraordinaryRule"]);

/** One stored table of the document, or null where it is absent or unread. */
function tableOf(id) {
  if (!hasDoc(NATURAL_DOC)) return null;
  const table = getDoc(NATURAL_DOC)?.tables?.[id];
  return table && typeof table === "object" && !isMissingRow(table) ? table : null;
}

/** A weapon word as a key: lowercase, letters and digits only. */
const fold = (word) => String(word ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The damage type each natural weapon is listed against, as a map of the
 * folded weapon word to a `DAMAGE_TYPES` key. Null where the table was not
 * imported or holds no usable row; a weapon the page does not list has no
 * entry. A word listed under two types keeps the first row's.
 * @returns {Object<string, string>|null}
 */
export function naturalWeaponDamageMap() {
  const table = tableOf("naturalWeaponDamage");
  if (!table) return null;
  const out = {};
  for (const [type, row] of Object.entries(table)) {
    if (!Object.hasOwn(DAMAGE_TYPES, type) || !Array.isArray(row?.weapons)) continue;
    for (const word of row.weapons) out[fold(word)] ??= type;
  }
  return Object.keys(out).length ? out : null;
}

/** A stored hit-dice figure as `{count, bonus}`, or null where it is not whole numbers. */
function hitDiceOf(raw) {
  const count = Number(raw?.count);
  const bonus = Number(raw?.bonus ?? 0);
  return raw && Number.isInteger(count) && count >= 0 && Number.isInteger(bonus) ? { count, bonus } : null;
}

/**
 * The extraordinary-damage rule's printed edges: `animalHd` and `otherHd`, the
 * hit dice a monster must exceed (`{count, bonus}`), and `animalSize`, the
 * size category an animal must reach (a `SIZE_ORDER` key). Each is null where
 * it was not imported or is no figure a comparison can use.
 * @returns {{animalHd: {count: number, bonus: number}|null, animalSize: string|null, otherHd: {count: number, bonus: number}|null}}
 */
export function extraordinaryEdges() {
  const table = tableOf("extraordinaryRule");
  const size = table?.animalSize;
  return {
    animalHd: hitDiceOf(table?.animalHd),
    animalSize: SIZE_ORDER.includes(size) ? size : null,
    otherHd: hitDiceOf(table?.otherHd),
  };
}
