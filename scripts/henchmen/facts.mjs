/* global game */
/**
 * Cross-module facts — the "has X" fallback chain (docs/henchmen/MODEL.md §7):
 *   1. owning module's API, when it exists and is active
 *   2. actor flag
 *   3. INVENTORY MARKER ITEM — a plain Item whose name declares the fact,
 *      e.g. "Stronghold: Border Fort" (cost = gp value), "Rank: 3 (Baron)"
 *   4. null → callers fall back to asking the GM
 *
 * A module that owns one of these facts supersedes the markers transparently by
 * taking over step 1; nothing else here changes.
 */
import { MODULE_ID } from "./constants.mjs";

function markerItems(actor, re) {
  return (actor?.items ?? []).filter((i) => re.test(i.name ?? ""));
}

/**
 * Does the actor own a stronghold (follower prerequisite, RR 334)?
 * @returns {{name: string, value: number|null}|null}
 */
export function getStronghold(actor) {
  // 1. Future structures module API probe (none published yet).
  for (const id of ["acks-structures", "acks-strongholds"]) {
    const api = game.modules.get(id)?.api;
    const found = api?.getStronghold?.(actor);
    if (found) return found;
  }
  // 2. Actor flag (settable by anything, incl. macros).
  const flag = actor?.getFlag?.(MODULE_ID, "stronghold");
  if (flag) return typeof flag === "object" ? flag : { name: String(flag), value: null };
  // 3. Inventory marker item.
  const item = markerItems(actor, /^stronghold\s*[:\-]/i)[0];
  if (item) {
    return {
      name: item.name.replace(/^stronghold\s*[:\-]\s*/i, ""),
      value: Number(item.system?.cost ?? 0) || null,
    };
  }
  return null;
}

/**
 * The actor's SOCIAL RANK — a rung on the ladder of titles, for the reaction
 * roller's status row and anything else that compares two people's station.
 * The same chain as the other facts: the actor flag `socialRank` (a number, or `{rank, title}`), then a marker item
 * named `Rank: 3 (Baron)` — the number is the rung, the parenthesis the
 * title — or `Rank: Baron` for a title with no rung. The ladder's rungs are
 * not printed here: what a title is worth is the Judge's, or the module
 * that owns titles.
 * @returns {{rank: number|null, title: string}|null}
 */
export function getSocialRank(actor) {
  const asRank = (value) => {
    if (value == null || value === "") return null;
    if (typeof value === "object") {
      const rank = Number(value.rank);
      return { rank: Number.isFinite(rank) ? rank : null, title: String(value.title ?? "") };
    }
    const rank = Number(value);
    return Number.isFinite(rank) ? { rank, title: "" } : { rank: null, title: String(value) };
  };
  const flag = asRank(actor?.getFlag?.(MODULE_ID, "socialRank"));
  if (flag) return flag;
  const item = markerItems(actor, /^(?:social\s+)?rank\s*[:\-]/i)[0];
  if (item) {
    const rest = item.name.replace(/^(?:social\s+)?rank\s*[:\-]\s*/i, "").trim();
    const m = rest.match(/^(\d+)\s*(?:[(\-–—]\s*([^)]*?)\s*\)?)?$/);
    return m ? { rank: Number(m[1]), title: (m[2] ?? "").trim() } : { rank: null, title: rest };
  }
  return null;
}
