/**
 * Where an export's blank form comes from: the official fillable sheet the
 * importer holds open on this seat, registered there as a book so it is put
 * on the server or connected the way every book is (Your Books).
 */

/** The importer's book id for the official fillable sheet. */
export const SHEET_BOOK = "sheet";

/**
 * The official sheet an export writes into: a fresh copy of the file the
 * importer holds open on this seat, from the server or connected here.
 * @param {object|null} importer `acksExtras.importer`
 * @returns {Promise<{bytes: Uint8Array, label: string}|null>} null when it is not open
 */
export async function blankSheet(importer) {
  const bytes = await importer?.bookBytes?.(SHEET_BOOK);
  return bytes?.length ? { bytes, label: importer.BOOKS?.[SHEET_BOOK]?.label ?? SHEET_BOOK } : null;
}
