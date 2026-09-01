/**
 * The shape imported book text takes in a world document.
 *
 * An import materializes the entry's own paragraphs into the document it
 * creates, with the page reference as the closing line, and the world holds
 * them from then on. Nothing is resolved again at render time and no seat but
 * the importing GM's ever needs the book.
 *
 * Two properties are load-bearing:
 *
 *  - **The text is escaped, never parsed.** Extracted PDF text is plain text
 *    that happens to be about to live in an HTML field; an angle bracket in a
 *    printed formula is a character, not a tag.
 *  - **The wrapper is stamped** (`data-acks-entry`). That is what lets a later
 *    pass tell text this module wrote from text a Judge wrote over it, so a
 *    re-import replaces its own work and never someone else's.
 */

/** The wrapper an import stamps around materialized book text. */
const BOOK_TEXT_CLASS = "acks-extras-importer-book-text";
/** The closing line: which book and page the text above was read from. */
const CITE_CLASS = "acks-extras-importer-cite";

/** Matches a stamped block, and the legacy `@PdfText` tag it replaced. */
const BOOK_TEXT_BLOCK = /<div\b[^>]*\bdata-acks-entry=[^>]*>[\s\S]*?<\/div>/gi;
const LEGACY_TAG = /(?:<p>\s*)?@PdfText\[[^\]]*\](?:\{[^}]*\})?(?:\s*<\/p>)?/gi;

/** Extracted text is never markup. */
export const escapeText = (value) =>
  String(value ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/**
 * The same, plus the quote that would end an attribute early.
 *
 * Separate from `escapeText` because the two land in different places: prose is
 * full of quotation marks and escaping them all would litter every stored
 * description, while one unescaped quote in an attribute ends it.
 */
const escapeAttr = (value) => escapeText(value).replace(/"/g, "&quot;");

/**
 * Materialized book text: the paragraphs, then the page reference.
 *
 * A page that yielded no prose still produces the reference alone — attribution
 * without reproduction, and the same stamped shape, so a re-import recognises
 * it as its own.
 *
 * @param {string[]} paragraphs one printed paragraph each, plain text
 * @param {string} cite page reference for the closing line
 * @param {object} [options]
 * @param {string} [options.id] entry id stamped on the wrapper
 * @returns {string} HTML for a description field, or "" when there is neither
 */
export function bookText(paragraphs, cite, { id = "" } = {}) {
  const body = (paragraphs ?? [])
    .map((text) => String(text ?? "").trim())
    .filter(Boolean)
    .map((text) => `<p>${escapeText(text)}</p>`)
    .join("");
  const reference = String(cite ?? "").trim();
  if (!body && !reference) return "";
  const tail = reference ? `<p class="${CITE_CLASS}">${escapeText(reference)}</p>` : "";
  return `<div class="${BOOK_TEXT_CLASS}" data-acks-entry="${escapeAttr(id)}">${body}${tail}</div>`;
}

/**
 * The paragraphs one executed node holds, as plain text.
 *
 * The executor tags each paragraph with the section it was printed under;
 * passing a section filters to it, and unsectioned paragraphs count as
 * `appearance` — the same default the section routing uses.
 */
export function nodeParagraphs(node, section = "") {
  const paras = node?.fields?.description ?? [];
  const picked = section ? paras.filter((p) => (p?.section ?? "appearance") === section) : paras;
  return picked.map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).filter(Boolean);
}

/** One node's section as a single plain string, for text that lands inline. */
export const nodeText = (node, section = "") => nodeParagraphs(node, section).join(" ");

/** Materialized book text for one executed node — the usual import call. */
export const entryText = (node, id, cite, { section = "" } = {}) =>
  bookText(nodeParagraphs(node, section), cite, { id });

/**
 * The same description with everything this module wrote removed.
 *
 * What is left is the Judge's own work, and callers that overwrite descriptions
 * ask this before they do. Legacy `@PdfText` tags count as ours: a world
 * imported before the text was materialized holds tags where it now holds
 * text, and both are this module's writing.
 */
export const stripBookText = (html) => String(html ?? "").replace(BOOK_TEXT_BLOCK, " ").replace(LEGACY_TAG, " ");
