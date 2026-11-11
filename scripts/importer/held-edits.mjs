/**
 * The edits a repair finds a Judge made to what the import wrote, and the
 * decision that says which of them a write may take. Pure, so it runs without
 * Foundry.
 *
 * A writer that meets a stored value differing from what the import last
 * wrote does not write it; it reports the edit (`heldEdit`) and writes the
 * rest. Only a decision the caller passes in lets the page's value through
 * (`decides`): per edit by its key, or all at once. With no decision every
 * edit is kept.
 */

/** The key an edit is decided by: the document and the field, one per stored value. */
export const editKey = (uuid, path) => `${uuid}#${path}`;

/**
 * What the caller decided for one edit: "take" writes the page's value over
 * the Judge's, "keep" leaves the Judge's standing. A decision is "keep" or
 * "take" for every edit, or `{keep?: Set<key>, take?: Set<key>, all?: "keep"|"take"}`
 * per key with `all` for the rest; none, or a key it does not name, keeps.
 * @param {"keep"|"take"|{keep?: Set<string>, take?: Set<string>, all?: "keep"|"take"}|null|undefined} decision
 * @param {string} key an `editKey`
 * @returns {"keep"|"take"}
 */
export function decides(decision, key) {
  if (decision === "take" || decision === "keep") return decision;
  if (decision?.take?.has?.(key)) return "take";
  if (decision?.keep?.has?.(key)) return "keep";
  return decision?.all === "take" ? "take" : "keep";
}

/**
 * One edit, as a repair reports it to the caller that decides it: the
 * document, the field, the value the document holds, the value the page gives
 * and the page reference. `unstamped` marks a value the import wrote before
 * it recorded what it wrote, so the difference may be the page's own change
 * as readily as the Judge's; it is present only when true.
 * @param {{uuid: string, name?: string, path: string, current: unknown, page: unknown, cite?: string, unstamped?: boolean}} edit
 * @returns {{key: string, uuid: string, name: string, path: string, current: unknown, page: unknown, cite: string,
 *   unstamped?: true}}
 */
export const heldEdit = ({ uuid, name = "", path, current, page, cite = "", unstamped = false }) =>
  ({ key: editKey(uuid, path), uuid, name, path, current, page, cite, ...(unstamped ? { unstamped: true } : {}) });

/**
 * Whether a stored figure still holds what the page gives, for a figure no
 * read stamp covers (a roster, a strength table, a market's demand): a list
 * holds as many rows as the page's, each holding the page's row; an object
 * holds every key the page's sets, as the page sets it; anything else is
 * equal. Keys the stored value carries beyond the page's (a field's defaults,
 * a Judge's extra column) do not count against it.
 * @param {unknown} stored
 * @param {unknown} page
 * @returns {boolean}
 */
export function coversFigure(stored, page) {
  if (Array.isArray(page)) return Array.isArray(stored) && stored.length === page.length && page.every((row, i) => coversFigure(stored[i], row));
  if (page && typeof page === "object") {
    return !!stored && typeof stored === "object" && Object.keys(page).every((k) => coversFigure(stored[k], page[k]));
  }
  return page === undefined || stored === page;
}

/**
 * A short checksum of a written text block (FNV-1a, 32 bits, hex): the read
 * stamp a block write records, so a later write can tell a Judge's edit inside
 * the block from the block as the import wrote it.
 * @param {string} text
 * @returns {string}
 */
export function blockSum(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
