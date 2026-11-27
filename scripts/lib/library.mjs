/* global game, console */
/**
 * The imported library, wherever it lives: a read is world sidebar PLUS every
 * shelf, in that order, and it is SYNCHRONOUS because its callers are sheet
 * getters and `_prepareContext` bodies that cannot await. See
 * docs/lib/MODEL.md, "The imported library". Writing goes through
 * `library-target.mjs`, which opens the shelves this file reads.
 */
import { MODULE_ID } from "./constants.mjs";
import { perfMark } from "./util.mjs";

/**
 * The definition id the importer stamped on a document, or the empty string;
 * the ONE read of that stamp.
 */
export const cookbookId = (doc) => String(doc?.flags?.[MODULE_ID]?.cookbook?.id ?? "");

/**
 * Is this world document a copy of an imported one, rather than an import? A
 * copy keeps the cookbook flag it was copied with, so the flag alone cannot
 * tell. A scene's copy carries `worldCopy`; a drag out of a world compendium
 * carries Foundry's `compendiumSource` into one; a sidebar duplicate carries
 * `duplicateSource`. The importer writes none of these on an import.
 */
export function isWorldCopy(doc) {
  if (doc?.flags?.[MODULE_ID]?.worldCopy) return true;
  const stats = doc?._stats ?? {};
  return String(stats.compendiumSource ?? "").startsWith("Compendium.world.") || !!stats.duplicateSource;
}

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
 * they go to shelves no player seat is shown, where one pack setting answers
 * for all of them. The marker rides in the LABEL because the label is the one
 * thing every reader of a shelf already has (`importedPacks`).
 */
export const judgeLine = (line = null) => (line ? `${line} — ${JUDGE_SHELF}` : JUDGE_SHELF);

/** Whether a line is a Judge's own (`judgeLine`). */
export const isJudgeLine = (line) => line === JUDGE_SHELF || String(line ?? "").endsWith(` — ${JUDGE_SHELF}`);

/**
 * The series a line belongs to, its Judge's segment taken off: `judgeLine`
 * read backwards. Null for the ACKS library, Judge's shelf or not.
 */
export const seriesOfLine = (line) => {
  if (!line || line === JUDGE_SHELF) return null;
  const suffix = ` — ${JUDGE_SHELF}`;
  return line.endsWith(suffix) ? line.slice(0, -suffix.length) : line;
};

/** The sidebar folder a Judge's shelf sits in, under its series' folder. */
export const JUDGE_FOLDER = JUDGE_SHELF;

/**
 * What a Judge's shelf is created with, and what a library restore puts back:
 * no player seat, trusted or not, is shown the pack or can open a document in
 * it. The server answers a read of it from any seat (docs/lib/MODEL.md, "The
 * imported library"), so this module's own reads leave it out (`seatOpens`).
 */
export const JUDGE_SHELF_OWNERSHIP = Object.freeze({ GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" });

/**
 * Whether this seat can open a pack: core's `visible`, the test its sidebar
 * lists a pack by. Never read as whether the seat can READ the pack, which the
 * server answers for every seat.
 */
export const seatOpens = (pack) => pack?.visible !== false;

/**
 * Every pack of a document type this seat can open, in `game.packs` order. A
 * scan of the packs for content goes through here, so a seat is never handed
 * a document from a pack it is not shown.
 */
export const openPacks = (type) => (game.packs ?? []).filter((p) => p.documentName === type && seatOpens(p));

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
 * Every shelf the importer has minted for a document type that this seat can
 * open (`seatOpens`) — every LINE of it. Matched on the label PREFIX, never on
 * a whole label (see docs/lib/MODEL.md, "The imported library"), and found by
 * label rather than by collection id, because the id differs between worlds.
 * The unlined shelf sorts FIRST.
 */
export function libraryPacks(type) {
  const own = `${PACK_LABEL_PREFIX}${type}`;
  return openPacks(type)
    .filter((p) => p.metadata.packageType === "world" && String(p.metadata.label ?? "").startsWith(PACK_LABEL_PREFIX))
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
 * Whether any shelf holds rows not yet instantiated, so that a synchronous
 * read below would answer with less than the library holds.
 */
export const libraryCold = () => LIBRARY_TYPES.some((type) => libraryPacks(type).some(isCold));

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
 * from. With `original`, it also skips a world copy (`isWorldCopy`) and a
 * group's base actor (`templateFor`), which carry the stamp of the document
 * they were made from and answer for no import of their own. Several documents
 * may carry one id (a world actor dragged out of its shelf keeps the stamp, and
 * the world's are read first): `prefer(doc)` picks the first of them it answers
 * true for, and the first of all where it answers for none.
 * @param {string} type
 * @param {string} id
 * @param {{original?: boolean, prefer?: ((doc: object) => boolean)|null}} [options]
 */
export function byCookbookId(type, id, { original = false, prefer = null } = {}) {
  if (!id) return null;
  const carries = (d) =>
    cookbookId(d) === id &&
    !d.flags?.[MODULE_ID]?.templatePart &&
    !(original && (isWorldCopy(d) || d.flags?.[MODULE_ID]?.templateFor));
  const docs = libraryDocs(type);
  if (typeof prefer !== "function") return docs.find(carries) ?? null;
  let first = null;
  for (const d of docs) {
    if (!carries(d)) continue;
    if (prefer(d)) return d;
    first ??= d;
  }
  return first;
}

/**
 * The index fields the library's readers rely on, by document type, beyond the
 * core ones. An index row carries a flag only once its path is declared in
 * `CONFIG.<Type>.compendiumIndexFields` and a client `getIndex()` has been
 * built with it, so a reader that matches on a stamp declares it here.
 */
export const LIBRARY_INDEX_FIELDS = Object.freeze({
  Item: Object.freeze([`flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.cookbook.merged`, `flags.${MODULE_ID}.templatePart`]),
});

/**
 * Add `LIBRARY_INDEX_FIELDS` to Foundry's per-type index fields, once each. Run
 * at `init`: a pack's `getIndex()` reads the list when it is called, and every
 * index row written after it (a create, an update, a re-import) carries the
 * declared fields too. The field is declared and never passed to `getIndex`,
 * since a field passed by one caller is dropped from the entries another
 * caller's `getIndex` builds. Core keeps the declared field on an index row only
 * after that pack instance's first `getIndex()` has run (its indexed-field set
 * starts at the core fields), so a reader that needs the field awaits one.
 */
export function declareLibraryIndexFields() {
  for (const [type, fields] of Object.entries(LIBRARY_INDEX_FIELDS)) {
    const declared = globalThis.CONFIG?.[type]?.compendiumIndexFields;
    if (!Array.isArray(declared)) continue;
    for (const field of fields) if (!declared.includes(field)) declared.push(field);
  }
}

/** What a `libraryDocsWhere` test is handed: the one shape a world document and an index row share. */
const rowOf = (source) => ({
  _id: source._id ?? source.id,
  id: source._id ?? source.id,
  uuid: source.uuid,
  name: source.name,
  type: source.type,
  flags: source.flags,
});

/**
 * Every library document of a type that passes `match`, read WITHOUT loading a
 * whole shelf: the sidebar's documents first, then each shelf's, unlined shelf
 * first (`libraryPacks`). Per shelf it awaits one `pack.getIndex()`, tests each
 * index row, answers the documents the shelf already holds as they are, and
 * loads the rest in one `getDocuments({_id__in})`; the matches of a shelf come
 * back in its index order. It never kicks `loadPack`, so `libraryCold()` and the
 * synchronous readers' own load are as they were.
 *
 * `match` is handed `{_id, id, uuid, name, type, flags}` and nothing else, for a
 * world document and an index row alike: an index row is stored source the
 * system has not migrated, so a test never reads `system`. A flag is read only
 * where its path is declared (`LIBRARY_INDEX_FIELDS`); an undeclared one is
 * absent from a shelf's rows and matches nothing.
 *
 * A shelf that cannot be read, its index or its load, is reported and left out
 * whole; the others answer. The answer is an array that also carries `failed`,
 * the collection ids of the shelves left out (a non-enumerable property, so the
 * list is a plain array to a caller that never looks): an empty `failed` means
 * the list is what the library holds, and a non-empty one means it may be short,
 * which a caller that republishes from the answer must not publish as whole. A
 * document is left out when its id is in `except`, which a caller uses for a
 * delete whose hook fires before the collection drops the document.
 *
 * The shelves' half is `packDocsWhere` over `libraryPacks(type)`, so the read is
 * tracked while it runs and the warm (`registerLibraryWarm`) starts behind the
 * narrow reads under way rather than beside them.
 *
 * @param {string} type a document type the importer keeps a shelf for
 * @param {(row: {_id: string, id: string, uuid?: string, name: string, type: string, flags: object}) => boolean} match
 * @param {object} [options]
 * @param {Iterable<string>} [options.except] document ids to leave out
 * @returns {Promise<object[] & {failed: string[]}>}
 */
export async function libraryDocsWhere(type, match, options = {}) {
  const except = options.except instanceof Set ? options.except : new Set(options.except ?? []);
  const docs = [...(worldCollection(type) ?? [])].filter(wantedOf(match, { except }));
  const shelves = await packDocsWhere(libraryPacks(type), match, { except });
  docs.push(...shelves);
  return answerOf(docs, shelves.failed);
}

/**
 * The shelves' half of `libraryDocsWhere`, over a pack list the caller gives (a
 * caller reading for this seat hands over `openPacks(type)` or `libraryPacks`,
 * so no shelf the seat is not shown is read here). Per pack it awaits
 * `shelfIndex(pack)`, tests each index row with the same `{_id, id, uuid, name,
 * type, flags}` projection `libraryDocsWhere` hands its test, and loads the
 * documents it does not hold through `loadIds`; a pack's matches come back in
 * its index order and the packs in the order given. The answer carries the same
 * non-enumerable `failed` (the collection ids of the packs that could not be
 * read), and `except` drops document ids as it does there. The read is tracked
 * as a narrow read while it runs, so the warm starts behind it.
 *
 * @param {object[]} packs compendium collections
 * @param {(row: {_id: string, id: string, uuid?: string, name: string, type: string, flags: object}) => boolean} match
 * @param {object} [options]
 * @param {Iterable<string>} [options.except] document ids to leave out
 * @returns {Promise<object[] & {failed: string[]}>}
 */
export function packDocsWhere(packs, match, options = {}) {
  const read = readPacks(packs, match, options);
  narrowReads.add(read);
  const done = () => narrowReads.delete(read);
  read.then(done, done);
  return read;
}

/** The narrow reads (`libraryDocsWhere`) in flight, which the warm waits behind. */
const narrowReads = new Set();

/** The index reads in flight, by pack: one server pass is shared by every reader that arrives while it runs. */
const indexReads = new Map();

/**
 * One shelf's index, from one `getIndex()` shared by every caller that asks
 * while it is pending. Core answers each concurrent call with a server query of
 * its own, so two readers of a shelf at startup would scan it twice. The shared
 * read is dropped when it settles, a rejection included, and the next caller
 * asks again. The call carries no argument: the declared index fields are the
 * ones a row carries (`declareLibraryIndexFields`).
 *
 * @param {object} pack a compendium collection
 * @returns {Promise<Map<string, object>>}
 */
export function shelfIndex(pack) {
  let read = indexReads.get(pack);
  if (!read) {
    read = (async () => pack.getIndex())();
    indexReads.set(pack, read);
    const drop = () => indexReads.delete(pack);
    read.then(drop, drop);
  }
  return read;
}

/** The test a source (a world document or an index row) must pass: not excluded, and `match` over its projection. */
function wantedOf(match, { except = null } = {}) {
  const skip = except instanceof Set ? except : new Set(except ?? []);
  return (source) => !skip.has(source._id ?? source.id) && match(rowOf(source));
}

/** A document list with the non-enumerable `failed` array that `libraryDocsWhere` and `packDocsWhere` answer with. */
function answerOf(docs, failed) {
  Object.defineProperty(docs, "failed", { value: failed, enumerable: false });
  return docs;
}

/** `packDocsWhere`'s read: every pack's matching documents, a pack that cannot be read left out and named. */
async function readPacks(packs, match, options = {}) {
  const wanted = wantedOf(match, options);
  const perShelf = await Promise.all(
    packs.map(async (pack) => {
      try {
        const index = await shelfIndex(pack);
        const hits = [...index.values()].filter(wanted).map((row) => row._id);
        return await loadIds(pack, hits);
      } catch (err) {
        console.warn(`${MODULE_ID} | could not read the imported ${pack.documentName} library from ${pack.collection}`, err);
        return null;
      }
    }),
  );
  const docs = perShelf.flatMap((list) => list ?? []);
  return answerOf(
    docs,
    packs.filter((_, n) => !perShelf[n]).map((pack) => pack.collection),
  );
}

/** The loads in flight, by pack and then by document id: each id maps to the one load that is fetching it. */
const idLoads = new WeakMap();

/**
 * Documents of one pack by id, each id fetched once however many callers ask.
 * An id the pack already holds asks for nothing; an id another caller's load is
 * fetching waits on that load; the rest go out now in ONE `getDocuments({_id__in})`
 * of this call's own. There is no pause to gather callers and no merging across
 * calls, so a caller's query leaves the moment it asks. A load that rejects
 * releases its ids, so the next call asks again, and the rejection reaches every
 * caller that waited on it.
 *
 * @param {object} pack a compendium collection
 * @param {Iterable<string>} ids document ids
 * @returns {Promise<object[]>} the documents of `ids` the pack holds once the loads settle, in the order of `ids`, a repeated id once and an id the pack does not hold left out
 */
export async function loadIds(pack, ids) {
  const wanted = [...new Set(ids)];
  let inFlight = idLoads.get(pack);
  if (!inFlight) idLoads.set(pack, (inFlight = new Map()));
  const absent = wanted.filter((id) => !pack.get(id));
  const fresh = absent.filter((id) => !inFlight.has(id));
  const waits = new Set(absent.filter((id) => inFlight.has(id)).map((id) => inFlight.get(id)));
  if (fresh.length) {
    const load = (async () => pack.getDocuments({ _id__in: fresh }))();
    for (const id of fresh) inFlight.set(id, load);
    const release = () => {
      for (const id of fresh) if (inFlight.get(id) === load) inFlight.delete(id);
    };
    load.then(release, release);
    waits.add(load);
  }
  await Promise.all(waits);
  return wanted.map((id) => pack.get(id)).filter(Boolean);
}

/** The `performance.mark` set when the warm begins loading whole shelves, read by a timing script. */
export const WARM_MARK_STARTED = "acks-extras:libraryWarm:started";

/** The `performance.mark` set once every type's warm load has settled, read by a timing script. */
export const WARM_MARK_ENDED = "acks-extras:libraryWarm:ended";

/** The `performance.mark` set when one document type's warm load settles, read by a timing script. */
export const warmMarkEnded = (type) => `acks-extras:libraryWarm:${type}:ended`;

/**
 * Warm the library at ready, so a synchronous read is complete once it has run.
 * It starts a macrotask after it is registered, which lets every `ready` hook
 * begin its narrow read (`libraryDocsWhere`) first, and then waits until no
 * narrow read is in flight, so the whole-shelf loads queue behind the reads the
 * module's own startup needs rather than beside them. A narrow read that never
 * settles holds the warm back, and a synchronous reader still loads its own
 * shelf on demand. Registered from the lib module's own ready hook rather than
 * at module scope: this file is imported by pure logic the offline suite
 * exercises with no Foundry global in sight, and a top-level `Hooks` call there
 * is a ReferenceError before any test body runs.
 *
 * It sets a mark as each type's load settles (`warmMarkEnded`) and one when all
 * have (`WARM_MARK_ENDED`); `whenReady` and `warmLibrary` set none.
 *
 * @returns {Promise<unknown>} resolves once the whole-shelf loads have settled
 */
export async function registerLibraryWarm() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (narrowReads.size) await Promise.allSettled([...narrowReads]);
  perfMark(WARM_MARK_STARTED);
  const loaded = await Promise.all(LIBRARY_TYPES.map((type) => loadPack(type).finally(() => perfMark(warmMarkEnded(type)))));
  perfMark(WARM_MARK_ENDED);
  return loaded;
}
