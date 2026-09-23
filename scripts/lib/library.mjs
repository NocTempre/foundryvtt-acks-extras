/* global game, console */
/**
 * The imported library, wherever it lives: a read is world sidebar PLUS every
 * shelf, in that order, and it is SYNCHRONOUS because its callers are sheet
 * getters and `_prepareContext` bodies that cannot await. See
 * docs/lib/MODEL.md, "The imported library". Writing goes through
 * `library-target.mjs`, which opens the shelves this file reads.
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * The definition id the importer stamped on a document, or the empty string;
 * the ONE read of that stamp.
 */
export const cookbookId = (doc) => String(doc?.flags?.[MODULE_ID]?.cookbook?.id ?? "");

/** How the importer labels its packs — the one place the prefix is spelled. */
const PACK_LABEL_PREFIX = "ACKS Cookbook — ";

/**
 * The label of the shelf holding one document type of one line: the ACKS
 * library's own shelf carries no line. Every writer that mints a pack and
 * every reader that matches one builds the label here, so the two cannot
 * drift.
 */
export const libraryPackLabel = (type, line = null) =>
  line ? `${PACK_LABEL_PREFIX}${line} — ${type}` : `${PACK_LABEL_PREFIX}${type}`;

/** The last segment of a line whose shelves are the Judge's alone. */
const JUDGE_SHELF = "Judge";

/**
 * The line a JUDGE'S book is shelved under: its own series with the Judge's
 * segment added, or that segment alone for a book of the ACKS library. An
 * adventure's keyed places, people and organisations are the Judge's page, so
 * they go to shelves no player seat can open, where one pack setting answers
 * for all of them. The marker rides in the LABEL because the label is the one
 * thing every reader of a shelf already has (`importedPacks`).
 */
export const judgeLine = (line = null) => (line ? `${line} — ${JUDGE_SHELF}` : JUDGE_SHELF);

/** Whether a line is a Judge's own (`judgeLine`). */
export const isJudgeLine = (line) => line === JUDGE_SHELF || String(line ?? "").endsWith(` — ${JUDGE_SHELF}`);

/**
 * What a Judge's shelf is created with, and what a library restore puts back:
 * no player seat, trusted or not, can see the pack or read a document in it.
 */
export const JUDGE_SHELF_OWNERSHIP = Object.freeze({ GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" });

/** The shelf for one type and line, or null when this world has none yet. */
export function findLibraryPack(type, line = null) {
  const label = libraryPackLabel(type, line);
  return (
    (game.packs ?? []).find(
      (p) => p.metadata.packageType === "world" && p.documentName === type && p.metadata.label === label,
    ) ?? null
  );
}

/** Is this pack collection id one of the library's own shelves? */
export const isLibraryPack = (collection) =>
  !!collection && importedPacks().some(({ pack }) => pack.collection === collection);

/**
 * The line a library shelf holds, read off its label; null for the ACKS
 * shelf, and null for a collection that is not a library shelf at all — a
 * document in a foreign compendium belongs to no line.
 */
export const lineOfPack = (collection) =>
  importedPacks().find(({ pack }) => pack.collection === collection)?.line ?? null;

/** Document types the importer keeps a pack for. */
const LIBRARY_TYPES = ["Item", "Actor", "JournalEntry", "RollTable"];

/** The world collection a type's sidebar documents live in. */
const worldCollection = (type) =>
  ({ Item: game.items, Actor: game.actors, JournalEntry: game.journal, RollTable: game.tables })[type] ?? null;

/**
 * Every shelf the importer has minted for a document type — every LINE of it.
 * Matched on the label PREFIX, never on a whole label (see docs/lib/MODEL.md,
 * "The imported library"), and found by label rather than by collection id,
 * because the id differs between worlds. The unlined shelf sorts FIRST.
 */
export function libraryPacks(type) {
  const own = `${PACK_LABEL_PREFIX}${type}`;
  return (game.packs ?? [])
    .filter(
      (p) =>
        p.metadata.packageType === "world" &&
        p.documentName === type &&
        String(p.metadata.label ?? "").startsWith(PACK_LABEL_PREFIX),
    )
    .sort((a, b) =>
      a.metadata.label === own
        ? -1
        : b.metadata.label === own
          ? 1
          : String(a.metadata.label).localeCompare(String(b.metadata.label)),
    );
}

/**
 * Every pack the importer has minted in this world, with the LINE each holds
 * (the segment between the prefix and the document type; the ACKS library has
 * none). Read by the sidebar organizer (`compendium-folders.mjs`), which files
 * each pack under the line it holds.
 *
 * @returns {{pack: object, line: string|null, type: string}[]}
 */
export function importedPacks() {
  const out = [];
  for (const pack of game.packs ?? []) {
    if (pack.metadata.packageType !== "world") continue;
    const label = String(pack.metadata.label ?? "");
    if (!label.startsWith(PACK_LABEL_PREFIX)) continue;
    const rest = label.slice(PACK_LABEL_PREFIX.length);
    const cut = rest.lastIndexOf(" — ");
    out.push({ pack, line: cut < 0 ? null : rest.slice(0, cut), type: pack.documentName });
  }
  return out;
}

/** Per-type load promise, so a pack is instantiated once and not per read. */
const loading = new Map();

/** Has this pack rows the collection has not instantiated yet? */
const isCold = (pack) => pack.index.size > pack.size;

function loadPack(type) {
  const cold = libraryPacks(type).filter(isCold);
  if (!cold.length) return loading.get(type) ?? Promise.resolve();
  if (!loading.has(type)) {
    loading.set(
      type,
      Promise.all(
        cold.map((pack) =>
          pack
            .getDocuments()
            .catch((err) => console.warn(`${MODULE_ID} | could not load the imported ${type} library`, err)),
        ),
      )
        // Cleared on settle: a shelf may go cold again when the importer creates
        // it fresh, grow rows a later import added, or arrive whole when a world
        // imports its first book of a line that had no shelf at all.
        .finally(() => loading.delete(type)),
    );
  }
  return loading.get(type);
}

/**
 * Instantiate every library pack, so the synchronous reads below are complete.
 *
 * A pack that fails to load is reported and skipped — a partial library reads
 * as a smaller one, never as a broken sheet.
 */
export const warmLibrary = () => Promise.all(LIBRARY_TYPES.map(loadPack));

/** Resolves once the library is loaded — for callers that can await. */
export const whenReady = () => warmLibrary();

/**
 * Every library document of a type — the sidebar's, then every shelf's.
 * Synchronous by design (see the file header): a cold shelf starts loading in
 * the background and answers with what is in hand. A caller that CANNOT
 * re-render must await `whenReady()` first — see docs/lib/MODEL.md, "The
 * imported library".
 */
export function libraryDocs(type) {
  const docs = [...(worldCollection(type) ?? [])];
  const packs = libraryPacks(type);
  if (!packs.length) return docs;
  if (packs.some(isCold)) loadPack(type);
  for (const pack of packs) docs.push(...pack.contents);
  return docs;
}

/** Every library Item — the read that replaced `game.items` across this module. */
export const libraryItems = () => libraryDocs("Item");

/** Every library Actor. */
export const libraryActors = () => libraryDocs("Actor");

/**
 * The library document carrying this importer cookbook id, or null. Skips the
 * class-template parts, which inherit the id of the definition they were made
 * from.
 */
export function byCookbookId(type, id) {
  if (!id) return null;
  return (
    libraryDocs(type).find((d) => cookbookId(d) === id && !d.flags?.[MODULE_ID]?.templatePart) ?? null
  );
}

/**
 * Warm at ready, so the first sheet render is already complete. Registered
 * from the lib module's own ready hook rather than at module scope: this file
 * is imported by pure logic the offline suite exercises with no Foundry
 * global in sight, and a top-level `Hooks` call there is a ReferenceError
 * before any test body runs.
 */
export function registerLibraryWarm() {
  warmLibrary();
}
