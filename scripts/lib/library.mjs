/* global game, console */
/**
 * The imported library, wherever it lives.
 *
 * The importer subsystem materializes a world's books into WORLD COMPENDIUMS
 * — one pack per document type, labelled "ACKS Cookbook — <Type>". Everything
 * in this module that used to read `game.items` for a class, a race, a
 * proficiency or a language was reading the sidebar, which is now empty of
 * all of them: the class list rendered blank, `findByRef` answered null for
 * every imported ref, and chargen offered no proficiencies at all.
 *
 * THE SIDEBAR STILL COUNTS. A Judge's own homebrew class lives there, and so
 * do the class-template packages — bundles and their skinned gear, deliberately
 * world documents so a Judge can repair one and have every character built from
 * that template inherit the repair. So a library read is world PLUS pack, in
 * that order: what this seat made itself wins over what it imported.
 *
 * SYNCHRONOUS, because its callers are sheet getters and `_prepareContext`
 * bodies that cannot await. That is paid for by warming the packs once at
 * `ready`: `getDocuments()` instantiates them into the collection, Foundry
 * keeps that collection current as documents are created and deleted, and
 * every read afterwards is a plain filter over memory — the same cost the
 * `game.items` reads had. `whenReady()` is there for the callers that CAN
 * await and must not race a cold start.
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * The definition id the importer stamped on a document, or the empty string;
 * the ONE read of that stamp.
 */
export const cookbookId = (doc) => String(doc?.flags?.[MODULE_ID]?.cookbook?.id ?? "");

/** How the importer labels its packs. Matching its `packLabel`. */
const PACK_LABEL_PREFIX = "ACKS Cookbook — ";

/** Document types the importer keeps a pack for. */
const LIBRARY_TYPES = ["Item", "Actor", "JournalEntry", "RollTable"];

/** The world collection a type's sidebar documents live in. */
const worldCollection = (type) =>
  ({ Item: game.items, Actor: game.actors, JournalEntry: game.journal, RollTable: game.tables })[type] ?? null;

/**
 * Every shelf the importer has minted for a document type — every LINE of it.
 *
 * Matched on the label PREFIX, never on a whole label: a lined book is shelved
 * on its own pack (`ACKS Cookbook — Dolmenwood — Item`), so a reader that
 * demanded the unlined label answered for the ACKS books and reported every
 * other one absent. This reads back the writer's own shape — the importer keeps
 * the prefix on every shelf precisely so that one prefix finds them all.
 *
 * Found by label rather than by collection id, because the id is minted by
 * Foundry when the pack is created and differs between worlds.
 *
 * The unlined shelf sorts FIRST, so a lookup that has to choose between two
 * shelves holding the same name answers with the ACKS document rather than
 * with whichever pack Foundry happened to register first.
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
 * Every pack the importer has minted in this world, with the LINE each holds.
 *
 * The inverse of the importer's `packLabel`, and it lives here because the
 * label prefix does: a pack's line is the segment between the prefix and the
 * document type, and the ACKS library has none — its label carries no line and
 * neither does its shelf. Read by the sidebar organizer
 * (`compendium-folders.mjs`), which files each pack under the line it holds
 * and cannot ask the importer, whose own `lineOf` answers for a book id rather
 * than for a pack that already exists.
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
 *
 * Synchronous by design (see the file header). A shelf that is still cold — the
 * importer created it after `ready`, or this is the first read of the session —
 * starts loading in the background and answers with what is in hand; sheets
 * re-render on the document creates that follow, so the next read is complete.
 * Anything that must not miss an imported document awaits `whenReady()` first —
 * and a caller that CANNOT re-render must, because for it "what is in hand"
 * never becomes complete.
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
 * The library document carrying this importer cookbook id, or null.
 *
 * Skips the class-template parts: a skinned copy inherits the id of the
 * definition it was made from, so a plain id search finds one class's engraved
 * silver waterskin where the shared Waterskin was meant.
 */
export function byCookbookId(type, id) {
  if (!id) return null;
  return (
    libraryDocs(type).find((d) => cookbookId(d) === id && !d.flags?.[MODULE_ID]?.templatePart) ?? null
  );
}

/**
 * Warm at ready, so the first sheet render is already complete.
 *
 * Registered from the lib module's own ready hook rather than at module scope:
 * this file is imported by pure logic the offline suite exercises without a
 * Foundry global in sight, and a top-level `Hooks` call there is a ReferenceError
 * before any test body runs.
 *
 * Core emits no hook when a compendium is created, so a pack the importer makes
 * later in the session is picked up by `libraryDocs`' own cold check instead.
 */
export function registerLibraryWarm() {
  warmLibrary();
}
