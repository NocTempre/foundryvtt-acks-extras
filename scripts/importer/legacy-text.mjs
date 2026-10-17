/* global game, fromUuid, ui */
/**
 * The repair check for book text an earlier version never brought over.
 *
 * Before imports materialized their text, a description held a placeholder,
 * `@PdfText[<entry id>]{<page>}`, that each seat resolved as it rendered.
 * Nothing resolves it now, so every copy that carried one shows the literal
 * tag: an item on a character, a template's skinned copy of an import, a page.
 * The repairs keyed on the importer's flag cannot reach those copies — a skin
 * is stripped of the flag, and a character is not an import — but the tag
 * names its own entry. This finds tags by what they are, in every document the
 * world and its compendia hold, and writes each entry's text in place of its
 * tag from a fresh read on this seat. Only the tag is replaced; anything
 * written beside it stays.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { legacyTags, replaceLegacyTags } from "./prose.mjs";
import { entryReadable, freshEntryText } from "./cookbook.mjs";
import { fixEach, fixRepairs, registerRepairCheck, scanRepairs, worldActors } from "../lib/repair.mjs";

/** The check's id in the repair registry. */
export const LEGACY_TEXT_CHECK = "importer.legacyText";

const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.repair.legacyText.${key}`, data);

/** The document kinds a placeholder was ever written into, with what the world holds of each. */
const WORLD = {
  Actor: () => worldActors(),
  Item: () => game.items ?? [],
  JournalEntry: () => game.journal ?? [],
  RollTable: () => game.tables ?? [],
};

const TAG = /@PdfText\[/i;
const hasTag = (value) =>
  typeof value === "string" ? TAG.test(value) : !!value && typeof value === "object" && Object.values(value).some(hasTag);

/** A document's embedded collections, by field name — walked as documents of their own. */
const embeddedFields = (doc) => Object.values(doc.constructor?.metadata?.embedded ?? {});

/** The document, then every document embedded under it. */
function* withEmbedded(doc) {
  yield doc;
  for (const field of embeddedFields(doc)) for (const child of doc[field] ?? []) yield* withEmbedded(child);
}

/** Every string of a document's own data, its embedded documents left out. */
function ownStrings(doc) {
  const skip = new Set(embeddedFields(doc));
  const out = [];
  const visit = (node, top) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (top && skip.has(key)) continue;
      if (typeof value === "string") out.push(value);
      else if (value && typeof value === "object") visit(value, false);
    }
  };
  visit(doc.toObject(), true);
  return out.filter((s) => TAG.test(s));
}

/**
 * The update that writes `swap` over every tagged string of a document's own
 * data: a string at its own path, an array whole at its path, since an update
 * cannot address one element of one.
 */
function ownWrites(doc, swap) {
  const skip = new Set(embeddedFields(doc));
  const deep = (v) => {
    if (typeof v === "string") return swap(v);
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
    return v;
  };
  const writes = {};
  const visit = (node, path) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (!path && skip.has(key)) continue;
      if (!hasTag(value)) continue;
      const at = path ? `${path}.${key}` : key;
      if (typeof value === "string" || Array.isArray(value)) writes[at] = deep(value);
      else visit(value, at);
    }
  };
  visit(doc.toObject(), "");
  return writes;
}

/** Every tag a document's own data holds, as `legacyTags` lists them. */
const ownTags = (doc) => ownStrings(doc).flatMap(legacyTags);

/** One read per tag shape: the same entry, cited or not, reads the same. */
const tagKey = (tag) => `${tag.id}|${tag.cited}`;

/** The finding for one document holding tags, or null. */
function finding(doc, where, locked) {
  const tags = ownTags(doc);
  if (!tags.length) return null;
  const states = [...new Map(tags.map((t) => [t.id, entryReadable(t.id)])).values()];
  const names = [...new Set(states.map((s) => s.name))].join(", ");
  const base = { key: doc.uuid, uuid: doc.uuid, name: where, detail: loc("detail", { entries: names }) };
  const unknown = states.filter((s) => s.reason === "no-entry");
  const closed = [...new Set(states.filter((s) => s.reason === "book-closed").map((s) => s.book))];
  if (unknown.length) return { ...base, fixable: false, reason: loc("noEntry", { entries: unknown.map((s) => s.name).join(", ") }) };
  if (closed.length) return { ...base, fixable: false, reason: loc("bookClosed", { books: closed.join(", ") }) };
  if (locked) return { ...base, fixable: false, reason: loc("locked") };
  return base;
}

/** Every document holding a tag, in the world and in the world's compendia. */
async function scan() {
  const out = [];
  const walk = (top, prefix, locked) => {
    for (const doc of withEmbedded(top)) {
      const where = doc === top ? `${prefix}${doc.name}` : `${prefix}${top.name} → ${doc.name}`;
      out.push(finding(doc, where, locked));
    }
  };
  for (const kind of Object.keys(WORLD)) for (const doc of WORLD[kind]()) walk(doc, "", false);
  const packs = [...(game.packs ?? [])].filter((p) => p.metadata?.packageType === "world" && p.documentName in WORLD);
  for (const pack of packs) {
    for (const doc of await pack.getDocuments().catch(() => [])) walk(doc, `${pack.title}: `, !!pack.locked);
  }
  return out.filter(Boolean);
}

/** Write each finding's entries in place of its tags, reading each entry once. */
function fix(findings) {
  const texts = new Map();
  return fixEach(findings, async (f) => {
    const doc = await fromUuid(f.uuid);
    if (!doc) return;
    const tags = ownTags(doc);
    for (const tag of tags) {
      if (!texts.has(tagKey(tag))) texts.set(tagKey(tag), await freshEntryText(tag.id, { cited: tag.cited }));
    }
    const unread = tags.map((t) => texts.get(tagKey(t))).find((r) => !r.html);
    if (unread) throw new Error(loc("unread"));
    await doc.update(ownWrites(doc, (s) => replaceLegacyTags(s, (t) => texts.get(tagKey(t))?.html ?? null)));
    return loc("done", { count: tags.length });
  });
}

/** Registers the check. Called once, at `init`. */
export function registerLegacyTextCheck() {
  registerRepairCheck({
    id: LEGACY_TEXT_CHECK,
    label: `${LANG_PREFIX}.repair.legacyText.label`,
    hint: `${LANG_PREFIX}.repair.legacyText.hint`,
    scan,
    fix,
  });
}

/**
 * Fix every finding this seat can, as Import Everything's closing step, and
 * say how many it had to leave for a book that is not open here. GM only.
 */
export async function resolveLegacyText() {
  if (!game.user?.isGM) return null;
  const [scanned] = await scanRepairs({ only: [LEGACY_TEXT_CHECK] });
  const keys = (scanned?.findings ?? []).filter((f) => f.fixable).map((f) => f.key);
  const left = (scanned?.findings ?? []).length - keys.length;
  const outcome = keys.length ? await fixRepairs(LEGACY_TEXT_CHECK, keys) : null;
  if (left) ui.notifications.warn(loc("left", { count: left }));
  return { fixed: outcome?.fixed.length ?? 0, failed: outcome?.failed.length ?? 0, left };
}
