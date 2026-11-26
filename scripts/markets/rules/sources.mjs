/**
 * Where the shop's goods may come from: the world's own items and each Item
 * compendium, one SOURCE each, keyed `world` or by the pack's collection id.
 * The Judge leaves sources out (`marketsCatalogExcluded`); every source not
 * left out stocks the shop, so a compendium installed later stocks it until it
 * is unticked. A Judge's own library shelf is the reverse: it is out until the
 * Judge ticks it in (`marketsCatalogJudgeIncluded`), so a shelf the importer
 * makes later starts out too. Foundry-free.
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

/**
 * The list the shop reads: what the Judge left out, plus every Judge shelf the
 * Judge has not ticked in.
 * @param {string[]} excluded  the stored excluded list
 * @param {string[]} [judgeShelves]  the collection id of each Judge shelf that exists
 * @param {string[]} [judgeIncluded]  the Judge shelves ticked in
 * @returns {string[]}
 */
export function effectiveExcluded(excluded, judgeShelves = [], judgeIncluded = []) {
  const taken = new Set(normalizeExcluded(judgeIncluded));
  return normalizeExcluded([...normalizeExcluded(excluded), ...normalizeExcluded(judgeShelves).filter((k) => !taken.has(k))]);
}

/** Whether the shop may draw on a source: it is one, and the Judge has not left it out. */
export const sourceAllowed = (source, excluded = []) => !!source && !excluded.includes(source);

/**
 * The excluded list a picker's ticks write: every listed source left unticked,
 * plus every earlier exclusion the picker did not list (a pack uninstalled for
 * now stays out when it returns). A Judge shelf (`judge`) is never written
 * here: its tick is `judgeIncludedFromPicks`'s.
 * @param {Array<{key: string, included: boolean, judge?: boolean}>} rows  the picker's rows
 * @param {string[]} previous  the list stored before
 * @returns {string[]}
 */
export function excludedFromPicks(rows, previous = []) {
  const listed = new Set(rows.map((r) => r.key));
  return normalizeExcluded([...previous.filter((k) => !listed.has(k)), ...rows.filter((r) => !r.included && !r.judge).map((r) => r.key)]);
}

/**
 * Whether the picker draws a row for a compendium: any that has something to
 * list, and one with nothing to list only while it is in the state that needs
 * an unticking (a source the shop draws on) or a ticking back (a Judge shelf
 * ticked in) to change.
 * @param {{count: number, included: boolean, judge?: boolean}} row
 * @returns {boolean}
 */
export const pickerListsRow = ({ count, included, judge = false }) => count > 0 || included === judge;

/**
 * The Judge shelves ticked in that a picker's ticks write: every listed Judge
 * shelf that is ticked, plus every earlier tick the picker did not list.
 * @param {Array<{key: string, included: boolean, judge?: boolean}>} rows  the picker's rows
 * @param {string[]} previous  the list stored before
 * @returns {string[]}
 */
export function judgeIncludedFromPicks(rows, previous = []) {
  const listed = new Set(rows.map((r) => r.key));
  return normalizeExcluded([...previous.filter((k) => !listed.has(k)), ...rows.filter((r) => r.included && r.judge).map((r) => r.key)]);
}
