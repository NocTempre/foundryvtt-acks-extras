/**
 * The test a rebuild applies before it deletes a library document: something
 * loaded here must be able to put that document back. Pure, so it runs without
 * Foundry; `cookbook.mjs` supplies what it reads (the loaded cookbooks, the
 * books open on the seat, the books offered).
 */

/**
 * Who owns one claim: the loaded owner that re-creates it and the book that
 * owner reads it from. The owner is looked for in this order, and the first
 * answer wins.
 *
 *  1. an entry of a loaded cookbook, under the claim itself or under a
 *     dot-ancestor of it (a row filed beneath its entry as `<entry>.<row>`);
 *  2. a generator that gathers a book's per-step blocks, whose book the
 *     caller reads off its id (`groupBookOf`);
 *  3. a table row, whose rows carry no book of their own (`tableBookOf`).
 *
 * Each resolver answers `undefined` where it finds no owner, and a book id or
 * `null` (an owner that names no book) where it does.
 *
 * @param {string} id the cookbook id a document claims
 * @param {object} resolvers
 * @param {(id: string) => string|null|undefined} resolvers.entryBookOf the book of the loaded entry under `id`
 * @param {(id: string) => string|null|undefined} [resolvers.groupBookOf] the book of the loaded generator `id` names
 * @param {(id: string) => string|null|undefined} [resolvers.tableBookOf] the book whose printed table `id` is a row of
 * @returns {{owned: boolean, book: string|null}}
 */
export function ownerOfClaim(id, { entryBookOf, groupBookOf = () => undefined, tableBookOf = () => undefined }) {
  const parts = String(id ?? "").split(".");
  for (let n = parts.length; n >= 2; n--) {
    const book = entryBookOf(parts.slice(0, n).join("."));
    if (book !== undefined) return { owned: true, book };
  }
  for (const resolve of [groupBookOf, tableBookOf]) {
    const book = resolve(String(id ?? ""));
    if (book !== undefined) return { owned: true, book };
  }
  return { owned: false, book: null };
}

/**
 * Whether a rebuild may delete the document standing for a claim, and if not
 * why. Three things must hold: a loaded owner can re-create the claim
 * (`owned`), the book it is read from is open on this seat (`isOpen`), and that
 * book is one the module offers (`books`). An owner naming no book has no book
 * to be closed or withdrawn.
 *
 * @param {object} claim
 * @param {boolean} claim.owned a loaded owner exists (`ownerOfClaim`)
 * @param {string|null} [claim.book] the book the owner reads the claim from
 * @param {(book: string) => boolean} claim.isOpen whether a book is open on this seat
 * @param {Record<string, unknown>} claim.books the books offered, keyed by id (`BOOKS`)
 * @returns {"rebuild"|"unowned"|"closed"|"withdrawn"} `rebuild` is the only answer that permits the delete
 */
export function rebuildVerdict({ owned, book = null, isOpen, books }) {
  if (!owned) return "unowned";
  if (book == null) return "rebuild";
  if (!isOpen(book)) return "closed";
  if (!books?.[book]) return "withdrawn";
  return "rebuild";
}
