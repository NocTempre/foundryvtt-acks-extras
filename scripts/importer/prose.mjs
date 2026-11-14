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
import { MODULE_ID } from "./constants.mjs";
import { blockSum } from "./held-edits.mjs";

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

/**
 * Matches a stamped block, and the `@PdfText` tag form of the same text. A tag
 * captures its paragraph's opening, the entry id (with any `#section`), the
 * page reference, and its paragraph's closing.
 */
const BOOK_TEXT_BLOCK = /<div\b[^>]*\bdata-acks-entry=[^>]*>[\s\S]*?<\/div>/gi;
const PDF_TEXT_TAG = /(<p>\s*)?@PdfText\[([^\]]*)\](?:\{([^}]*)\})?(\s*<\/p>)?/gi;

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
 * shelved book there; without them it is the plain reference, which reads the
 * same words either way.
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
 * ask this before they do. `@PdfText` tags count as ours: a description that
 * holds a tag holds this module's writing exactly as one that holds the text.
 */
export const stripBookText = (html) => String(html ?? "").replace(BOOK_TEXT_BLOCK, " ").replace(PDF_TEXT_TAG, " ");

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * What a reader sees of a block, as one line: tags dropped (an image keeps its
 * source), entities decoded, runs of whitespace collapsed. Everything the
 * editor re-serializes without changing a word falls away: attribute order and
 * quoting, a cell's text wrapped in a paragraph, a reflowed line, an
 * `&nbsp;`. Tags go before entities are decoded, so escaped angle brackets stay
 * text.
 */
export function readableText(html) {
  return String(html ?? "")
    .replace(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi, " [image $2] ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : /^#/.test(code) ? Number(code.slice(1)) : null;
      if (point === null) return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The checksum a document's stamp records for a block it was written with
 * (`readableText` of the block, through `blockSum`): a stored block whose
 * digest differs has been edited since, a change the stamp alone cannot show.
 * A change that leaves the readable text as it was (bold on a word, a moved
 * line break) is not seen.
 */
export const blockDigest = (block) => blockSum(readableText(block));

const BLOCK_ID = /\bdata-acks-entry=(["'])(.*?)\1/i;

const unescapeAttr = (value) =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The stamped blocks a stored string holds, by entry id: every block of one id
 * joined in order, since one field can carry two (a character's biography has
 * the page's text and its "as printed" block under the same id).
 * @returns {Map<string, string>}
 */
export function stampedBlocks(html) {
  const out = new Map();
  for (const block of String(html ?? "").match(BOOK_TEXT_BLOCK) ?? []) {
    const id = unescapeAttr(BLOCK_ID.exec(block)?.[2] ?? "");
    out.set(id, out.has(id) ? `${out.get(id)}${block}` : block);
  }
  return out;
}

/**
 * The key a block's digest is recorded under in a document's stamp
 * (`flags.acks-extras.cookbook.sums`): the field's path and the block's entry
 * id. Every dot is written out, so the key is one name inside an update path
 * and never nests.
 * @param {string} path the field, as a held edit names it (`system.description`, `description`)
 * @param {string} id the block's entry id
 */
export const sumKey = (path, id) => `${path}#${id}`.replace(/%/g, "%25").replace(/\./g, "%2E");

/**
 * The digests (`blockDigest`) a field's text earns: one per stamped block it
 * holds, by `sumKey`. What a writer records after it writes the field, so a
 * later write can read an edit inside the block against it. Empty where the
 * text holds no block.
 * @param {string} html the field's text as written
 * @param {string} path the field's path, as `sumKey` takes it
 * @returns {Object<string, string>}
 */
export function blockSums(html, path) {
  return Object.fromEntries([...stampedBlocks(html)].map(([id, block]) => [sumKey(path, id), blockDigest(block)]));
}

/**
 * The flat update entries that record a field's digests in the document's
 * stamp (`blockSums` under `flags.<module>.cookbook.sums`), for a write that
 * sets the field itself.
 * @returns {Object<string, string>}
 */
export const sumsUpdate = (html, path) =>
  Object.fromEntries(Object.entries(blockSums(html, path)).map(([key, sum]) => [`flags.${MODULE_ID}.cookbook.sums.${key}`, sum]));

/**
 * Whether a Judge edited inside a field's blocks since the import wrote them:
 * a block the stored text still holds digests differently from the sum the
 * stamp recorded for it. A block with no recorded sum and a sum whose block is
 * gone are not edits of this kind.
 * @param {Object<string, string>|undefined} sums the document's `cookbook.sums`
 * @param {string} path the field's path, as `sumKey` takes it
 * @param {string} html the field's stored text
 */
export function editedInBlocks(sums, path, html) {
  for (const [id, block] of stampedBlocks(html)) {
    const sum = sums?.[sumKey(path, id)];
    if (sum && sum !== blockDigest(block)) return true;
  }
  return false;
}

/** Entry `id`'s stamped block in a stored string, or "" when it holds none. */
export function bookTextBlock(html, id) {
  const stamp = `data-acks-entry="${escapeAttr(id)}"`;
  return String(html ?? "").match(BOOK_TEXT_BLOCK)?.find((block) => block.includes(stamp)) ?? "";
}

/**
 * The same string with entry `id`'s stamped block replaced by `block`, every
 * other character kept; where it holds no such block, `block` leads it.
 */
export function swapBookText(html, id, block) {
  const text = String(html ?? "");
  const held = bookTextBlock(text, id);
  return held ? text.replace(held, () => block) : `${block}${text}`;
}

/**
 * The same string with `block` set straight after entry `after`'s stamped
 * block, every other character kept; where it holds no such block, `block`
 * leads it.
 */
export function insertBookTextAfter(html, after, block) {
  const text = String(html ?? "");
  const held = bookTextBlock(text, after);
  return held ? text.replace(held, () => `${held}${block}`) : `${block}${text}`;
}

/**
 * A stamped block kept to the paragraphs `ordinals` names, 1-based in the
 * order they were printed, with its citation line: what `bookText` builds from
 * those paragraphs alone. "" when there is no block.
 */
export function keepParagraphs(block, ordinals) {
  const m = /^(<div\b[^>]*>)([\s\S]*)<\/div>$/.exec(String(block ?? ""));
  if (!m) return "";
  const keep = new Set(ordinals);
  const paras = m[2].match(/<p\b[^>]*>[\s\S]*?<\/p>/g) ?? [];
  const cite = `<p class="${CITE_CLASS}">`;
  let n = 0;
  const kept = paras.filter((p) => p.startsWith(cite) || keep.has(++n));
  return `${m[1]}${kept.join("")}</div>`;
}
