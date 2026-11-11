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
 * What a repair may do with a pregenerated character it left on its first
 * pass: `restore` keeps the character in hand under a new id, as a document of
 * its own, and imports the book's again under the cookbook id; `rewrite`
 * writes the book over it in place under the decision; `leave` does nothing.
 */
export const PREGEN_ANSWERS = Object.freeze(["restore", "leave", "rewrite"]);

/**
 * The answer a decision gives for the pregenerated character `uuid`: the one
 * its `pregens` map names, else `leave`. A decision given as a word ("keep",
 * "take") names none, so it leaves every one.
 * @param {unknown} decision as `decides` takes it, optionally carrying `pregens: Map<uuid, answer>`
 * @param {string} uuid
 * @returns {"restore"|"leave"|"rewrite"}
 */
export function pregenAnswer(decision, uuid) {
  const answer = decision?.pregens?.get?.(uuid);
  return PREGEN_ANSWERS.includes(answer) ? answer : "leave";
}

/** JSON with every object's keys in sorted order and undefined members dropped, so equal data writes equal text. */
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

/**
 * The play stamp of a pregenerated character: a checksum (`blockSum`) over
 * what play can change on it — its name, its `system` (the biography included)
 * and each embedded item's name, type and `system`, the items in name-then-type
 * order. Ids, `_stats`, ownership, sort, folder, flags and effects are left
 * out, so the stamp moves only when one of those fields does. The import
 * records it after its last write; a stamp that differs on a repair means the
 * character was played or edited since.
 * @param {{name?: string, system?: object, items?: {name?: string, type?: string, system?: object}[]}} data
 *   the actor's stored data (`toObject()`)
 * @returns {string}
 */
export function playStamp(data) {
  const items = (data?.items ?? [])
    .map((i) => ({ name: i?.name ?? "", type: i?.type ?? "", system: i?.system ?? {} }))
    .map((i) => ({ ...i, order: `${i.name}\u0001${i.type}\u0001${stableJson(i.system)}` }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map(({ order: _order, ...i }) => i);
  return blockSum(stableJson({ name: data?.name ?? "", system: data?.system ?? {}, items }));
}

/**
 * What a repair offers by default for a pregenerated character (`PREGEN_ANSWERS`),
 * and why: `restore` when its play stamp (`playStamp`) moved since the import
 * recorded it, or when the import recorded none; `leave` when it still matches.
 * @param {{changed: boolean, unstamped?: boolean}} pregen as a repair lists it
 * @returns {"restore"|"leave"}
 */
export const pregenDefault = (pregen) => (pregen?.changed === false ? "leave" : "restore");

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
