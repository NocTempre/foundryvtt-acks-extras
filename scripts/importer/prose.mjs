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
export const BOOK_TEXT_CLASS = "acks-extras-importer-book-text";
/** The closing line: which book and page the text above was read from. */
export const CITE_CLASS = "acks-extras-importer-cite";
/**
 * The citation as a link: `data-book` names the register book and `data-page`
 * the PDF page the text was read from, so a click can open the shelved copy at
 * that page. A real anchor with an href, so it is reachable from the keyboard.
 */
export const CITE_LINK_CLASS = "acks-extras-importer-cite-link";
/** A materialized book table — rows the page printed, headed by authored words. */
export const BOOK_TABLE_CLASS = "acks-extras-importer-table";

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
 * @param {string} [options.book] register book id the text was read from
 * @param {number} [options.page] PDF page it was read from — with `book`, the reference becomes a link
 * @returns {string} HTML for a description field, or "" when there is neither
 */
export function bookText(paragraphs, cite, { id = "", book = "", page = null } = {}) {
  const body = (paragraphs ?? [])
    .map((text) => String(text ?? "").trim())
    .filter(Boolean)
    .map((text) => `<p>${escapeText(text)}</p>`)
    .join("");
  const tail = citeLine(cite, book, page);
  if (!body && !tail) return "";
  return `<div class="${BOOK_TEXT_CLASS}" data-acks-entry="${escapeAttr(id)}">${body}${tail}</div>`;
}

/**
 * The closing line. With a book and a PDF page it is a link that opens the
 * shelved book there; without them it is the plain reference — a seat that
 * imported before the pages were recorded reads the same words either way.
 */
function citeLine(cite, book, page) {
  const reference = String(cite ?? "").trim();
  if (!reference) return "";
  const n = Number(page);
  const inner =
    book && Number.isInteger(n) && n > 0
      ? `<a class="${CITE_LINK_CLASS}" href="#" data-book="${escapeAttr(book)}" data-page="${n}">${escapeText(reference)}</a>`
      : escapeText(reference);
  return `<p class="${CITE_CLASS}">${inner}</p>`;
}

/**
 * Materialized book table: the header words the register authored, one row per
 * printed row, then the page reference — in the same stamped wrapper as
 * `bookText`, so a re-import and the ownership test treat it alike.
 *
 * @param {string[]} columns header cells: authored words, never page text
 * @param {string[][]} rows one array of cells per printed row, plain text
 * @param {string} cite page reference for the closing line
 * @param {object} [options] as `bookText`
 * @returns {string} HTML for a journal page, or "" when there is neither
 */
export function bookTable(columns, rows, cite, { id = "", book = "", page = null } = {}) {
  const cell = (tag, text) => `<${tag}>${escapeText(String(text ?? "").trim())}</${tag}>`;
  const body = (rows ?? [])
    .filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()))
    .map((r) => `<tr>${r.map((c) => cell("td", c)).join("")}</tr>`)
    .join("");
  const head = (columns ?? []).length ? `<thead><tr>${columns.map((c) => cell("th", c)).join("")}</tr></thead>` : "";
  const table = body ? `<table class="${BOOK_TABLE_CLASS}">${head}<tbody>${body}</tbody></table>` : "";
  const tail = citeLine(cite, book, page);
  if (!table && !tail) return "";
  return `<div class="${BOOK_TEXT_CLASS}" data-acks-entry="${escapeAttr(id)}">${table}${tail}</div>`;
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

/**
 * Materialized book text for one executed node — the usual import call. The
 * node knows which book and page it was read from, so the reference links.
 */
export const entryText = (node, id, cite, { section = "" } = {}) =>
  bookText(nodeParagraphs(node, section), cite, { id, book: node?.book ?? "", page: node?.page ?? null });

/**
 * The rows of an executed setting-table node as `[label, text]` pairs, in
 * printed order: the two instructions ship paired by section, and a row whose
 * label the page did not yield is still a row.
 */
export function nodeTablePairs(node) {
  const texts = new Map((node?.fields?.rows ?? []).map((p) => [p?.section ?? "", p?.text ?? ""]));
  return (node?.fields?.labels ?? []).map((l) => [l?.text ?? "", texts.get(l?.section ?? "") ?? ""]);
}

/** Materialized book table for one executed setting-table node. */
export const entryTable = (node, id, cite, columns = []) =>
  bookTable(columns, nodeTablePairs(node), cite, { id, book: node?.book ?? "", page: node?.page ?? null });

/**
 * The same description with everything this module wrote removed.
 *
 * What is left is the Judge's own work, and callers that overwrite descriptions
 * ask this before they do. Legacy `@PdfText` tags count as ours: a world
 * imported before the text was materialized holds tags where it now holds
 * text, and both are this module's writing.
 */
export const stripBookText = (html) => String(html ?? "").replace(BOOK_TEXT_BLOCK, " ").replace(LEGACY_TAG, " ");
