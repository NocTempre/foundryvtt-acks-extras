/**
 * A printed name, read rather than shipped.
 *
 * An adventure's own names — a gate, a guild, a quarter — are the book's
 * expression, so a register row and the cookbook entry compiled from it carry
 * a neutral label ("POI 30") and a LOCATOR, and the words come off the Judge's
 * own page when the document is built. Two locators, because a book prints two
 * kinds of heading: a keyed place opens with its key number, which is a pointer
 * like a page number and ships as written; a name with no number beside it is
 * located by a key of its folded letters, which proves the box still holds the
 * same words without saying what they are.
 *
 * Foundry-free: the executor checks with it in the browser, the compiler
 * locates with it under Node, and the two must agree to the character.
 */

/**
 * A printed label reduced to what survives extraction: accents split off and
 * dropped, case dropped, everything but letters and digits dropped. The same
 * fold the executor's `expect` compares by, so a heading that checks under one
 * checks under the other.
 */
export const foldLabel = (s) =>
  String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** FNV-1a over a string's UTF-16 units, in base 36: a short key, not a secret. */
export function hash36(text) {
  const s = String(text ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(36);
}

/**
 * The key an unnumbered printed name is located and checked by: a hash of its
 * fold, so the row holds nothing a reader could take for the name. Empty for a
 * text with no letters or digits in it, which can locate nothing.
 */
export function printKey(text) {
  const folded = foldLabel(text);
  return folded ? hash36(folded) : "";
}

/** The first run of non-space characters: where a keyed heading prints its number. */
export const firstToken = (text) => /^\s*(\S+)/.exec(String(text ?? ""))?.[1] ?? "";

/** Whether a heading's first token IS this key number — "36." is not "36U." and "3." is not "30.". */
export const opensWithNumber = (text, number) => !!foldLabel(number) && foldLabel(firstToken(text)) === foldLabel(number);

/**
 * A keyed heading without its key number: what a body of people is called when
 * it is named after the place it keeps ("22. Hall of the Wardens" is a place,
 * "Hall of the Wardens" is who meets there). A text that opens with no key
 * number is returned as it came.
 */
export const withoutKeyNumber = (text) => String(text ?? "").replace(/^\s*[A-Z]?\d+[A-Za-z]?(?:\/[A-Z]?\d+[A-Za-z]?)?\.\s+/u, "").trim();

/** Words a title sets in lower case when they are not its first. */
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "with"]);

/** Tower and gate numerals, which stay in capitals. Only I, V and X: no English word is spelled from them. */
const ROMAN_RE = /^(?=[ivx]+$)x{0,3}(?:ix|iv|v?i{0,3})$/iu;

/**
 * A heading set in capitals, as a name: each word's first letter raised, small
 * words lowered unless they open the name or a gloss, numerals kept, and the
 * key number left exactly as printed. Presentation only — no letter is added
 * or taken away.
 */
export function titleCaseHeading(text) {
  const tokens = String(text ?? "").normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  let opening = true;
  return tokens
    .map((token, i) => {
      if (i === 0 && /\d/u.test(token)) return token;
      const lead = /^[^\p{L}\p{N}]*/u.exec(token)[0];
      const tail = /[^\p{L}\p{N}]*$/u.exec(token.slice(lead.length))[0];
      const core = token.slice(lead.length, token.length - tail.length);
      // A gloss opens its own title: the word after "(" or an opening quote is
      // raised even when it is a small one.
      if (/[(“‘"]$/u.test(lead)) opening = true;
      const cased = core
        .split(/([-‐‑/])/u)
        .map((part, j) => {
          if (j % 2) return part;
          if (!part) return part;
          if (ROMAN_RE.test(part)) return part.toUpperCase();
          const lower = part.toLocaleLowerCase();
          if (!opening && j === 0 && SMALL_WORDS.has(lower)) return lower;
          return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
        })
        .join("");
      if (core) opening = false;
      return lead + cased + tail;
    })
    .join(" ");
}

/**
 * Whether a printed line's CASE carries nothing: it is set in capitals, or in
 * small capitals, whose glyphs extract as a scatter of upper and lower case
 * ("tRibune naRmiRio"). A naturally cased line has lower-case letters, no
 * capital after a lower-case letter inside a word, and no word but a small one
 * opening in lower case. Decided where the page can be seen, by the compiler,
 * and shipped as the heading's `caps`.
 */
export function caseCarriesNothing(text) {
  const words = String(text ?? "").normalize("NFC").split(/[\s\-‐‑/]+/u).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
  if (!words.some((w) => /\p{Ll}/u.test(w))) return true;
  return words.some((w) => /\p{Ll}.*\p{Lu}/u.test(w) || (/^\p{Ll}/u.test(w) && !SMALL_WORDS.has(w.toLocaleLowerCase())));
}

/**
 * What a binder names a document built from an entry: the words the executor
 * read off the page — set as a title when the page prints them in capitals or
 * small capitals, left as printed otherwise, and without the colon a label
 * closes with — or the entry's own neutral label when the page gave none.
 * @param {{fields?: {name?: {title?: string|null, caps?: boolean}}}|null} node an executed entry
 * @param {string} fallback the entry's shipped label
 */
export function printedNameOf(node, fallback = "") {
  const read = String(node?.fields?.name?.title ?? "").trim().replace(/\s*:$/u, "");
  if (!read) return fallback;
  const named = node.fields.name.caps === true || !/\p{Ll}/u.test(read) ? titleCaseHeading(read) : read;
  // A heading that wraps after a slash reads "A/ B": the space is the line
  // break's, so the slash is given its other one. "A/B" is left as printed.
  return named.replace(/(\S)\/ (?=\S)/gu, "$1 / ").replace(/(\S) \/(?=\S)/gu, "$1 / ");
}
