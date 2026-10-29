/**
 * Where the shop's goods may come from: the world's own items and each Item
 * compendium, one SOURCE each, keyed `world` or by the pack's collection id.
 * The Judge leaves sources out (`marketsCatalogExcluded`); every source not
 * left out stocks the shop, so a compendium installed later stocks it until it
 * is unticked. Foundry-free.
 */

/** The source key of the world's own (sidebar) items. */
export const WORLD_SOURCE = "world";

/**
 * The excluded list as stored, cleaned: non-empty strings, each once. Anything
 * that is not an array reads as nothing excluded.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeExcluded(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v) => typeof v === "string" && v.length))];
}

/**
 * The source a document uuid names: `world` for a world Item (`Item.<id>`), the
 * pack's collection id for a compendium Item (`Compendium.<pkg>.<pack>.Item.<id>`),
 * and null for anything else, an item embedded on an actor included. A shop
 * buys only from a source, so null is a refusal.
 * @param {string} uuid
 * @returns {string|null}
 */
export function sourceOfUuid(uuid) {
  const parts = String(uuid ?? "").split(".");
  if (parts.length === 2 && parts[0] === "Item" && parts[1]) return WORLD_SOURCE;
  if (parts.length === 5 && parts[0] === "Compendium" && parts[1] && parts[2] && parts[3] === "Item" && parts[4]) {
    return `${parts[1]}.${parts[2]}`;
  }
  return null;
}

/** Whether the shop may draw on a source: it is one, and the Judge has not left it out. */
export const sourceAllowed = (source, excluded = []) => !!source && !excluded.includes(source);

/**
 * The excluded list a picker's ticks write: every listed source left unticked,
 * plus every earlier exclusion the picker did not list (a pack uninstalled for
 * now stays out when it returns).
 * @param {Array<{key: string, included: boolean}>} rows  the picker's rows
 * @param {string[]} previous  the list stored before
 * @returns {string[]}
 */
export function excludedFromPicks(rows, previous = []) {
  const listed = new Set(rows.map((r) => r.key));
  return normalizeExcluded([...previous.filter((k) => !listed.has(k)), ...rows.filter((r) => !r.included).map((r) => r.key)]);
}
