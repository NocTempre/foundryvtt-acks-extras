/**
 * Chat content as plain text, for a client that renders no HTML.
 *
 * In a page the browser's own parser reads it; under Node a tag strip stands
 * in, which is enough for the tests and for nothing else — a card's layout is
 * lost either way, and a client wanting the card asks for the message id.
 */
const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** The text a message's HTML shows, whitespace collapsed. */
export function textOf(html) {
  const s = String(html ?? "");
  if (typeof globalThis.DOMParser === "function") {
    try {
      const body = new globalThis.DOMParser().parseFromString(s, "text/html").body;
      return (body?.textContent ?? "").replace(/\s+/g, " ").trim();
    } catch {
      /* fall through to the strip */
    }
  }
  return s
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
