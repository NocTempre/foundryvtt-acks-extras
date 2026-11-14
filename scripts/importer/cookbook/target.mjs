/**
 * Cookbook runtime: import targets: the world or a compendium, the item shelves, the library name index.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { blockDigest, bookTextBlock, editedInBlocks } from "../prose.mjs";
import { answersFor, claimIds, rowBlockPatch } from "../place-pair.mjs";
import {
  actorPolicy, decidedPolicy, handWrittenProse, refreshImported, policyFor, countRepair, unrepaired, withBlockSums,
} from "../refresh.mjs";
import { coversFigure, decides, heldEdit } from "../held-edits.mjs";
import { isWorldCopy } from "../scene-binding.mjs";
import { libraryPackLabel, findLibraryPack } from "../../lib/library.mjs";
import { ensureLibraryPack } from "../../lib/library-target.mjs";
import { stableDocId } from "../adventure-binding.mjs";
import { nameKeys } from "../../lib/vocab.mjs";
import { TEMPLATE_PART } from "../../classes/template-packages.mjs";
import {
  FOLDER_NAME, lineOf, bookOfCookbookId, lineOfClaim, lineOfData, data, ctx, cookbookEntry, bookOf, bookLabel,
  claimedId, actorKindOf, canImportAnimals, isAnimalEntry, cookbookEquipmentIds,
} from "./state.mjs";

/* -------------------------------------------- */
/*  Import target folders (one tree per type)   */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  GM import dialog                            */
/* -------------------------------------------- */


/**
 * Every import lands in a tree, not a heap:
 *
 *   <book label>                e.g. a book's code plus its title
 *     └── <entry meta.group>    e.g. a section heading, or a heading with a sub-area suffix
 *
 * The PACK is the container; entries without a group sit in the book folder,
 * and content-type items (abilities, equipment) use their own top level
 * instead of a book. Folders are cached for the session and pre-created
 * before any concurrent import starts. Never more than two levels —
 * `ensureFolderPath` refuses a deeper path rather than creating it. See
 * docs/importer/DECISIONS.md, "The pack is the container: compendium-only,
 * two levels deep".
 */
const FOLDER_MAX_DEPTH = 2;
/** Folders by type, pack, parent and name, held as promises so concurrent callers share one create. */
export const folderCache = new Map();


/* -------------------------------------------- */
/*  Import target: world documents or compendium */
/* -------------------------------------------- */

/**
 * Imports land in WORLD COMPENDIUMS, one per document type, created on first
 * use and cached by type. `createDoc` passes `{pack}` at creation and
 * `ensureFolderPath` builds the tree inside the pack, so nothing is staged in
 * the sidebar and swept up afterwards. World packs are unlocked by default,
 * so an imported document stays editable and draggable. See
 * docs/importer/DECISIONS.md, "The pack is the container: compendium-only,
 * two levels deep".
 */
export const packCache = new Map();

/**
 * The visible name of a pack — what every "imported into…" message names, and
 * what `cookbookRemoveImports` recognises its own packs by. Every label keeps
 * the `FOLDER_NAME` prefix whatever line it holds. See
 * docs/importer/DECISIONS.md, "The prefix is load-bearing."
 */
export const packLabel = libraryPackLabel;

/**
 * Every world pack of a type this module owns, whatever line it holds. The
 * read counterpart of `packFor`: a write goes to one shelf, but a presence
 * check has to ask them all, since a batch mixes ids from several lines.
 */
export const ourPacksOfType = (type) =>
  game.packs.filter(
    (p) =>
      p.metadata.packageType === "world" &&
      p.documentName === type &&
      String(p.metadata.label ?? "").startsWith(`${FOLDER_NAME} — `),
  );

/**
 * The sidebar documents this module stamped — the other half of the library in
 * a world that holds imports outside the packs.
 * Reads world-then-pack, matching the actor side (`importedIdsOfType`,
 * `importedActor`). Recognised by the cookbook flag, same as
 * `cookbookRemoveImports`; never the class templates' skinned copies, which
 * inherit the definition's cookbook id, and never a copy of an import
 * (`isWorldCopy`), which is the Judge's and survives a rebuild. See
 * docs/importer/DECISIONS.md, "The library is the packs AND the sidebar this
 * module stamped".
 */
const sidebarImports = (type) => {
  const world = { Actor: game.actors, Item: game.items, JournalEntry: game.journal, RollTable: game.tables }[type];
  return [...(world ?? [])].filter(
    (d) => d.getFlag(MODULE_ID, "cookbook") && !d.flags?.[MODULE_ID]?.templatePart && !isWorldCopy(d),
  );
};

/**
 * The pack collection id imports of this type and line go to, or null if it
 * cannot be opened. A null line is the ACKS library's own pack. The cached
 * answer is confirmed against `game.packs` before it is handed out — a pack
 * can go away under a running session (deleted, or swept by Remove Imports on
 * another seat) — and re-resolving simply creates the pack again. Writers
 * only: a presence check reads its shelves through `ourPacksOfType` or
 * `findLibraryPack`, which open nothing.
 */
export async function packFor(type, line = null) {
  const cacheKey = `${type}|${line ?? ""}`;
  let pending = packCache.get(cacheKey);
  if (pending) {
    const id = await pending;
    if (id && !game.packs.get(id)) {
      packCache.delete(cacheKey);
      forgetImportedIndex(); // its documents went with the pack
      // And its FOLDERS. A recreated pack takes the same collection id (Foundry
      // derives it from the label), so the folder cache's keys still match and
      // would hand back folder documents that went down with the old one.
      for (const key of [...folderCache.keys()]) if (key.startsWith(`${type}|`)) folderCache.delete(key);
      pending = null;
    }
  }
  if (!pending) {
    pending = (async () => {
      // The shelf is the lib's to open (`library-target.mjs`): the class
      // templates and the rules tables write to the same shelves, and one
      // opener is what keeps three writers on one label per line.
      const pack = await ensureLibraryPack(type, line);
      if (!pack) throw new Error(`no ${packLabel(type, line)} compendium`);
      return pack.collection;
    })().catch((err) => {
      // The sidebar is the only place left to put it. Say so loudly: a silent
      // fall-back to the world is how a library ends up split across two
      // targets, which is what every dedup check then has to guess about.
      console.error(`${MODULE_ID} | could not open the ${type} compendium — those documents land in the sidebar.`, err);
      ui.notifications?.error(game.i18n.format(`${LANG_PREFIX}.ui.packFailed`, { type }));
      return null;
    });
    packCache.set(cacheKey, pending);
  }
  return pending;
}

/**
 * `{pack}` option for document creation, or `{}` if the pack could not be
 * opened. Exported because a bulk `createDocuments`/`updateDocuments`/
 * `deleteDocuments` cannot go through `createDoc` and still needs the target.
 */
export const packOptsFor = async (type, line = null) => packOpts(type, line);

/** `{pack}` option for document creation, or `{}` if the pack could not be opened. */
const packOpts = async (type, line = null) => {
  const pack = await packFor(type, line);
  return pack ? { pack } : {};
};

/**
 * The rewrite in progress, or null: `held` maps the cookbook id of each
 * document a forced or ordinary repair writes in place to that document, and
 * `tally` counts what is written. While it stands, the create an importer
 * would make for a held id is a write over the held document instead
 * (`createDoc`, `claimActorImport`), so one importer body serves both its
 * first import and its repair, and no importer grows a second copy of its build.
 */
export let rewriteScope = null;

/**
 * Run `run` with the given documents written in place by the importers it
 * calls. The held documents not written when it ends (their page no longer
 * matched, or the build failed) are counted as left. Scopes do not nest.
 *
 * @param {{held: Map<string, foundry.abstract.Document>, tally: object, retract?: string[],
 *   blocks?: Map<string, foundry.abstract.Document>}} scope
 *   `retract` names `system` fields the build does not carry that a write
 *   returns to their initial value (a place's roster, a body's relations), so a
 *   field the import fills after the create is rebuilt rather than topped up.
 *   `blocks` maps a row's cookbook id to a place it writes text onto but does
 *   not build (a place two books print, a market or settlement a site is bound
 *   onto, a quarter or region its overview describes): the row's own block is
 *   written over in place (`writeRowBlock`) and the place is never built again.
 *   `decision`, where the scope carries the key, is the caller's word on the
 *   Judge's edits (`decides`): an edit it does not take is left standing and
 *   listed in `tally.edits`, and the tally's force is not read. A scope
 *   without it writes as the tally's force says.
 * @param {() => Promise<unknown>} run
 */
export async function withRewrite(scope, run) {
  rewriteScope = scope;
  try {
    return await run();
  } finally {
    rewriteScope = null;
    const docs = new Set([...scope.held.values(), ...(scope.blocks?.values() ?? [])]);
    for (const doc of docs) if (!scope.tally.seen.has(doc.uuid ?? doc.id)) scope.tally.refused++;
  }
}

/** Whether a rewrite holds the document for this cookbook id: the importers skip their "already imported" read and their art for it. */
export const isRewriting = (id) => !!rewriteScope?.held.has(id);

/** A rewrite scope's `decision`, taken from a tally whose caller set one, else nothing. */
export const decisionOf = (tally) => (tally && "decision" in tally ? { decision: tally.decision } : {});

/** The place a rewrite writes row `id`'s block onto (`withRewrite`'s `blocks`), or null. */
export const blockTarget = (id) => rewriteScope?.blocks?.get(id) ?? null;

/**
 * Write a row's fresh build over its own block on a place it shares
 * (`rowBlockPatch`), and count the place once in the rewrite's tally, at the
 * first row that settles it. A Judge's edit the rewrite's `decision` does not
 * take is left standing and listed in the tally's `edits`; a row whose only
 * differences are such edits writes nothing and settles nothing, so a later
 * row of the same place still counts it, and the place is reported as held
 * (`edits`), not replaced. A place that already holds the build is counted as
 * written; a write Foundry rejects is logged and counted as left.
 * @param {Actor} target the place `blockTarget` answered
 * @param {{id: string, notes?: string, name?: string, after?: string, cite?: string}} row
 * @returns {Promise<Actor>} the place
 */
export async function writeRowBlock(target, row) {
  const tally = rewriteScope?.tally ?? null;
  const first = unrepaired(tally, target);
  const { update: patch, edits } = rowBlockPatch({ ...target.toObject(), uuid: target.uuid }, row, { decision: rewriteScope?.decision ?? null });
  if (tally && edits.length) (tally.edits ??= []).push(...edits);
  const written = Object.keys(patch).length > 0;
  const heldOnly = !written && edits.length > 0;
  // The places a held-only first row left uncounted, for a later row to settle.
  const unsettled = tally ? (tally.unsettled ??= new Set()) : null;
  const key = target.uuid ?? target.id;
  const counts = first || !!unsettled?.has(key);
  try {
    if (written) await target.update(patch);
    if (counts && !heldOnly) {
      unsettled.delete(key);
      tally.replaced++;
    } else if (first && heldOnly) unsettled.add(key);
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${target.name} failed`, err);
    if (counts) {
      unsettled.delete(key);
      tally.refused++;
    }
  }
  return target;
}

/** The held document a create of `data` writes over, or null. */
function rewriteTarget(cls, data) {
  const held = rewriteScope?.held.get(data?.flags?.[MODULE_ID]?.cookbook?.id);
  return held && held.documentName === cls.documentName ? held : null;
}

/**
 * Write `data`, the build an importer was about to create, over the document
 * that already holds its id, and count it. A document met twice is written
 * once; one whose write is refused stays as it was. A build of another
 * document type is made again under the held id where the tally can
 * (`tally.recreate`), and the new document is returned in the held one's place.
 */
async function rewriteHeld(held, data) {
  const tally = rewriteScope.tally;
  const policy = { ...actorPolicy(data), retract: rewriteScope.retract ?? [] };
  if (!unrepaired(tally, held)) return held;
  let plan;
  // A scope that carries a decision writes a Judge's edit only where the
  // decision takes it, and lists the rest; one without keeps the tally's force.
  if (!("decision" in rewriteScope)) plan = await refreshImported(held, data, policyFor(policy, tally));
  else {
    // A place's build stamps no cite; its row's own is the page a held edit names.
    const stamp = data?.flags?.[MODULE_ID]?.cookbook;
    const cite = stamp?.cite || (stamp?.id ? cookbookEntry(stamp.id)?.entry?.cite : "") || "";
    // A place's notes are its prose: text a Judge wrote beside the stamped block is an edit.
    const guarded = data?.system?.notes !== undefined ? { ...policy, prose: [...policy.prose, "notes"] } : policy;
    const { build, retract } = heldRoster(held, data, guarded.retract, cite);
    const decided = decidedPolicy(held.toObject(), build, { ...guarded, retract }, { decision: rewriteScope.decision, uuid: held.uuid, cite });
    if (decided.edits.length) (tally.edits ??= []).push(...decided.edits);
    plan = await refreshImported(held, build, decided.policy);
  }
  if (plan?.refused === "type" && typeof tally.recreate === "function") plan = await tally.recreate(held, data);
  countRepair(tally, plan);
  return plan?.recreated ?? held;
}

/**
 * A place's roster under a rewrite that carries a `decision`, where the scope
 * retracts it: a stored roster that no longer holds the build's
 * (`coversFigure`) is an edit, marked `unstamped`, and one the decision does
 * not take stays as it is, listed in the tally's `edits`, with the roster
 * left out of the build and of `retract`. An empty roster takes the build's.
 * @returns {{build: object, retract: string[]}}
 */
function heldRoster(held, data, retract = [], cite = "") {
  if (!retract.includes("roster")) return { build: data, retract };
  const stored = held.toObject().system?.roster ?? [];
  const page = data?.system?.roster ?? [];
  if (!stored.length || coversFigure(stored, page)) return { build: data, retract };
  const edit = heldEdit({ uuid: held.uuid ?? "", name: held.name ?? "", path: "system.roster", current: stored, page, cite, unstamped: true });
  if (decides(rewriteScope.decision, edit.key) === "take") return { build: data, retract };
  (rewriteScope.tally.edits ??= []).push(edit);
  const { roster: _roster, ...system } = data?.system ?? {};
  return { build: { ...data, system }, retract: retract.filter((f) => f !== "roster") };
}

/**
 * Whether a write an importer makes after its create keeps `current`, a
 * figure no read stamp covers (a strength table, a body's relations), instead of `page`: true
 * under a rewrite that carries a `decision`, where `current` no longer holds
 * the page's (`coversFigure`) and the decision does not take it; the edit,
 * marked `unstamped`, is then listed in the tally's `edits`. False anywhere else.
 */
export function keepsJudgeFigure(doc, path, current, page, cite = "") {
  if (!rewriteScope || !("decision" in rewriteScope) || !doc || coversFigure(current, page)) return false;
  const edit = heldEdit({ uuid: doc.uuid ?? "", name: doc.name ?? "", path, current, page, cite, unstamped: true });
  if (decides(rewriteScope.decision, edit.key) === "take") return false;
  (rewriteScope.tally.edits ??= []).push(edit);
  return true;
}

/**
 * Whether a write an importer makes after its create keeps `current`, what
 * the held `doc` stores at `path`, instead of `page`: true under a rewrite
 * that carries a `decision`, where the stored text holds hand-written prose
 * (`handWrittenProse`) or an edit inside a block the import stamped
 * (`editedInBlocks` over the document's `cookbook.sums`), differs from the page
 * and the decision does not take it; the edit is then listed in the tally's
 * `edits`. False anywhere else. A caller that writes `page` records its digests
 * with `sumsUpdate`.
 */
export function keepsJudgeProse(doc, path, current, page, cite = "") {
  if (!rewriteScope || !("decision" in rewriteScope) || !doc) return false;
  const edited = editedInBlocks(doc.flags?.[MODULE_ID]?.cookbook?.sums, path, current);
  if (current === page || !(handWrittenProse(current) || edited)) return false;
  const edit = heldEdit({ uuid: doc.uuid ?? "", name: doc.name ?? "", path, current, page, cite });
  if (decides(rewriteScope.decision, edit.key) === "take") return false;
  (rewriteScope.tally.edits ??= []).push(edit);
  return true;
}

/** The creature line a location page carries beside its stamped block: the import's own text, never a Judge's. */
const CREATURE_LINE = /<p><strong>Creatures:<\/strong>[^<]*<\/p>/g;

/**
 * Whether a journal page's stored text holds what a Judge wrote. The stamped
 * block and the creature line are the import's own, so a page of nothing else
 * is never an edit.
 */
const judgedPage = (stored) => handWrittenProse(String(stored ?? "").replace(CREATURE_LINE, " "));

/** The page's cookbook stamp: its entry id and the digest of the block the import last wrote. */
const pageStamp = (page) => page?.flags?.[MODULE_ID]?.cookbook ?? {};

/** The digest of entry `id`'s stamped block in a page's text, or "" where the text holds none. */
export const blockDigestIn = (html, id) => {
  const block = id ? bookTextBlock(html, id) : "";
  return block ? blockDigest(block) : "";
};

/**
 * Whether a Judge edited inside the page's own stamped block: the page records
 * the digest of the block the import wrote (`pageStamp`), and the stored block
 * no longer reads as it did. A page with no recorded digest, or none left of
 * the block, is not an edit of this kind.
 */
function editedInBlock(page, stored) {
  const { id, sum } = pageStamp(page);
  return !!sum && !!blockDigestIn(stored, id) && blockDigestIn(stored, id) !== sum;
}

/**
 * Whether a journal page write keeps the stored text (`current`) instead of the
 * build's (`built`): true where the page holds hand-written prose
 * (`judgedPage`) or an edit inside its stamped block (`editedInBlock`) that
 * differs from the build, and nothing takes it. Outside a
 * rewrite it is kept. Under a rewrite that carries a `decision` it is kept
 * unless the decision takes it, and a kept page is listed in the tally's
 * `edits`; a rewrite without one follows the tally's force.
 */
function keepsJudgePage(page, current, built, cite) {
  if (current === built || !(judgedPage(current) || editedInBlock(page, current))) return false;
  if (!rewriteScope) return true;
  if (!("decision" in rewriteScope)) return !rewriteScope.tally?.force;
  const edit = heldEdit({ uuid: page.uuid ?? "", name: page.name ?? "", path: "text.content", current, page: built, cite });
  if (decides(rewriteScope.decision, edit.key) === "take") return false;
  (rewriteScope.tally.edits ??= []).push(edit);
  return true;
}

/**
 * Write a journal page the import already made: `sort` always, its text
 * (`content`) unless the stored text holds a Judge's prose or an edit inside
 * the import's block that differs from it (`keepsJudgePage`). A written page
 * records the digest of its block (`blockDigest`) in its stamp, which is what
 * a later run reads an edit inside the block against.
 * @param {JournalEntryPage} page
 * @param {string} content the page text the build gives
 * @param {number} sort
 * @param {string} [cite] the page reference a held edit names
 * @returns {Promise<"written"|"kept">}
 */
export async function writeJournalPage(page, content, sort, cite = "") {
  const kept = keepsJudgePage(page, page.text?.content ?? "", content, cite);
  const patch = kept ? {} : { "text.content": content };
  const { id, sum } = pageStamp(page);
  const written = kept ? "" : blockDigestIn(content, id);
  if (written && written !== sum) patch[`flags.${MODULE_ID}.cookbook.sum`] = written;
  if (!kept || page.sort !== sort) patch.sort = sort;
  if (Object.keys(patch).length) await page.update(patch);
  return kept ? "kept" : "written";
}

/** Whether the rewrite in progress has already written this document over (its build was accepted). */
export const wasRewritten = (doc) => !!rewriteScope && !!doc && rewriteScope.tally.seen.has(doc.uuid ?? doc.id);

/**
 * Create a document in this type's compendium, on its own line's shelf. The
 * line is read off the document's OWN cookbook flag rather than passed in;
 * `opts.line` answers only for a document with no flag to read. Every import
 * path must write through here — a second creator calling `Actor.create`
 * directly puts the document in the sidebar, where the presence checks do not
 * look. See docs/importer/DECISIONS.md, "The shelf is derived from the
 * document's own cookbook flag, not passed in."
 */
export const createDoc = async (cls, data, { line = null, ...opts } = {}) => {
  const held = rewriteTarget(cls, data);
  if (held) return rewriteHeld(held, data);
  const packOptions = await packOpts(cls.documentName, lineOfData(data) ?? line);
  warnStrayFolder(cls.documentName, data, packOptions.pack ?? null);
  // A new document records the digest of each block it is written with (`withBlockSums`).
  const [row] = itemIds([withBlockSums(data)], { type: cls.documentName, pack: packOptions.pack ?? null, keepId: !!opts.keepId });
  return remembered(await cls.create(row, { ...opts, keepId: true, ...packOptions }));
};

/**
 * The id each imported document stood under, by type then cookbook id,
 * recorded as `deleteImported` removes it and taken by the create that puts
 * it back.
 */
const deletedIds = new Map();

/** The id record of one document type. */
const deletedIdsOf = (type) => {
  if (!deletedIds.has(type)) deletedIds.set(type, new Map());
  return deletedIds.get(type);
};

/** Whether the collection a write lands in already holds a document id: the pack's index, else the sidebar's. */
const holdsIn = (type, pack) => (id) =>
  pack ? !!game.packs.get(pack)?.index?.has(id) : !!game.collections?.get(type)?.has(id);

/**
 * Imported documents' creation data under the ids they are written with
 * `keepId`: first the id the entry's document stood under before a rebuild
 * deleted it, else the one its cookbook id derives (`stableDocId`), so a
 * rebuild keeps every uuid that pointed at it. An id the target already
 * holds, or that an earlier row of the same write took, is passed over, and a
 * row left with neither gets core's own: one duplicate id rejects a whole
 * write. A caller's `_id` stands only under its own `keepId`; otherwise it is
 * dropped, as a write without `keepId` drops it. Named for the Items it was
 * written for; every type `createDoc` writes goes through it. See
 * docs/importer/DECISIONS.md, "A rebuilt Item keeps its id" and "Every
 * rebuilt document keeps its id".
 *
 * @param {object[]} dataList creation data, one per document
 * @param {{type?: string, pack?: string|null, keepId?: boolean, has?: (id: string) => boolean, deleted?: Map<string, string>}} [opts]
 *   `type` is the document type (Item), `pack` names the target (null: the
 *   sidebar), `has` overrides the lookup in it, `deleted` the type's id
 *   record, `keepId` is the caller's own option.
 * @returns {object[]} new creation data, in input order
 */
export function itemIds(dataList, { type = "Item", pack = null, keepId = false, has = holdsIn(type, pack), deleted = deletedIdsOf(type) } = {}) {
  const taken = new Set();
  return dataList.map((data) => {
    if (keepId && data?._id) {
      taken.add(data._id);
      return data;
    }
    const { _id: _dropped, ...row } = data ?? {};
    const claim = row.flags?.[MODULE_ID]?.cookbook?.id;
    if (!claim) return row;
    const was = deleted.get(claim);
    deleted.delete(claim);
    const _id = [was, stableDocId(claim)].find((id) => id && !taken.has(id) && !has(id));
    if (!_id) return row;
    taken.add(_id);
    return { ...row, _id };
  });
}

/**
 * A folder handed to a write into another pack is dropped by core without a
 * word, and the document lands at the pack's root. The folder rule and the
 * shelf rule read the same claim, so this fires only when one of them was
 * given a different book than the other — which is the one way a routing
 * change breaks silently.
 */
function warnStrayFolder(type, data, pack) {
  const folderId = data?.folder;
  if (!folderId) return;
  const holder = ourPacksOfType(type).find((p) => p.folders?.get?.(folderId));
  const where = holder?.collection ?? (game.folders?.get(folderId) ? "world" : null);
  if (!where || where === (pack ?? "world")) return;
  console.warn(`${MODULE_ID} | ${data?.flags?.[MODULE_ID]?.cookbook?.id ?? data?.name}: folder is in ${where}, the write goes to ${pack ?? "world"} — the folder is dropped.`);
}

/**
 * Teach the dedup index about a document the moment it exists. Keyed off the
 * document's own cookbook flag rather than a caller-supplied id, so no
 * creator can forget. Items only: the index is an Item index. See
 * docs/importer/DECISIONS.md, "Every create teaches the dedup index".
 */
function remembered(doc) {
  if (doc?.documentName !== "Item") return doc;
  const id = doc.getFlag(MODULE_ID, "cookbook")?.id;
  if (id) rememberImported(id, doc);
  return rememberName(doc);
}

/**
 * Create MANY documents in one write, chunked rather than one giant call so a
 * rejected batch does not take everything down with it. See
 * docs/importer/DECISIONS.md, "Writes are batched, because a write costs
 * what the shelf already holds".
 */
export const WRITE_CHUNK = 50;
/** Creates documents in chunks per line and returns one slot per input, null where none was created. */
export async function createDocs(cls, dataList, opts = {}) {
  if (!dataList.length) return [];
  // One slot per input, `null` where that document was not created; paired to
  // inputs by cookbook id below, never by position. See
  // docs/importer/DECISIONS.md, "A batched write files by identity, never by
  // position".
  const out = new Array(dataList.length).fill(null);

  // Grouped by LINE: one resolved pack for a mixed list writes everything to
  // whichever shelf the first document wanted.
  const byLine = new Map();
  dataList.forEach((data, i) => {
    const line = lineOfData(data) ?? opts.line ?? null;
    const key = line ?? "";
    if (!byLine.has(key)) byLine.set(key, { line, entries: [] });
    byLine.get(key).entries.push({ data, i });
  });

  const { line: _ignored, ...callerOpts } = opts;
  const createOpts = { ...callerOpts, keepId: true };
  for (const { line, entries: given } of byLine.values()) {
    const packOptions = await packOpts(cls.documentName, line);
    // Ids are settled over the whole line at once, so no two chunks of it hand
    // out the same one.
    const rows = itemIds(given.map((e) => withBlockSums(e.data)), { type: cls.documentName, pack: packOptions.pack ?? null, keepId: !!callerOpts.keepId });
    const entries = given.map((e, n) => ({ ...e, data: rows[n] }));
    for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
      const chunk = entries.slice(i, i + WRITE_CHUNK);
      const made = await cls
        .createDocuments(chunk.map((e) => e.data), { ...createOpts, ...packOptions })
        .catch((err) => {
          // One bad chunk must not lose the rest of the run. Fall back to one
          // write per document so the offender is isolated and named, and its
          // neighbours still land.
          console.warn(`${MODULE_ID} | batched create of ${chunk.length} ${cls.documentName}(s) failed — retrying singly`, err);
          return null;
        });
      if (made) {
        // Matched by cookbook id, never by position: `createDocuments` drops an
        // invalid document rather than throwing, so `made` can be shorter than
        // `chunk`. Anything unidentifiable falls into the chunk's first free slot.
        const slotsById = new Map();
        for (const e of chunk) {
          const key = e.data?.flags?.[MODULE_ID]?.cookbook?.id;
          if (!key) continue;
          if (!slotsById.has(key)) slotsById.set(key, []);
          slotsById.get(key).push(e.i);
        }
        const spare = chunk.map((e) => e.i);
        const take = (slot) => {
          const at = spare.indexOf(slot);
          if (at >= 0) spare.splice(at, 1);
          return slot;
        };
        for (const doc of made) {
          const key = doc.getFlag(MODULE_ID, "cookbook")?.id;
          const queue = key ? slotsById.get(key) : null;
          const slot = queue?.length ? take(queue.shift()) : spare.shift();
          if (slot !== undefined) out[slot] = remembered(doc);
          else remembered(doc); // created, but nothing to pair it to — still indexed
        }
      } else {
        for (const { data, i: slot } of chunk) {
          const one = await cls
            .create(data, { ...createOpts, ...packOptions })
            .catch((e) => (console.error(`${MODULE_ID} | create "${data?.name}"`, e), null));
          if (one) out[slot] = remembered(one);
        }
      }
    }
  }
  return out;
}

/**
 * Every Item this module has imported, indexed by cookbook id — the packs a
 * write lands on, and the sidebar ones that carry the cookbook flag (see
 * `sidebarImports`). Excludes the skinned template copies, which inherit the
 * definition's cookbook id. Cached, since dedup is asked once per id across a
 * whole-corpus import; `rememberImported` keeps the cache honest as new ones
 * are created.
 */
export let importedCache = null;
/** Resolves the imported-Item index, building it on first use. */
export async function importedIndex() {
  if (importedCache) return importedCache;
  // Every Item shelf this module owns, whatever line — items are shared across
  // books, so a line that ever mints one is deduplicated rather than twinned.
  const collections = ourPacksOfType("Item");
  const docs = [
    ...(await Promise.all(collections.map((c) => c.getDocuments().catch(() => [])))).flat(),
    ...sidebarImports("Item"), // packs first: the write's own shelf wins when a world holds both
  ];
  const byId = new Map();
  for (const doc of docs) {
    // A class template's part is a copy that kept its definition's claim; it
    // never answers for the id, or a grant copies one class's specialty name
    // ("A template part is not an import", docs/importer/DECISIONS.md).
    if (doc.getFlag(MODULE_ID, TEMPLATE_PART)) continue;
    const flag = doc.getFlag(MODULE_ID, "cookbook");
    // Every id the document answers for: its own, and any it absorbed on merge
    // (see "Same name, two books: merge unless they differ beyond their
    // source", docs/importer/DECISIONS.md).
    for (const key of [flag?.id, ...(flag?.merged ?? [])]) if (key && !byId.has(key)) byId.set(key, doc);
  }
  importedCache = byId;
  return byId;
}

/** Record a freshly created import so the next dedup sees it. */
export function rememberImported(id, doc) {
  if (id && doc && importedCache && !importedCache.has(id)) importedCache.set(id, doc);
  return doc;
}

/**
 * Imports for a cookbook id that are still being built, keyed by id. The
 * claim is the PROMISE, as `ensureFolderPath` claims a folder: the second
 * caller waits for the first one's document instead of building a twin.
 * Keyed on the cookbook id alone and shared by every item importer, so the
 * class import and the ability import land on the same item. See
 * docs/importer/DECISIONS.md, "One dedup rule for every importer: ask the
 * shelf you write to, and claim before you build".
 */
const inflightImports = new Map();

/**
 * The item for a cookbook id: the one already imported, the one another caller
 * is importing right now, or a fresh one from `build`. `build` runs at most
 * once per id per session; a build that yields nothing releases the claim so
 * a later attempt can try again.
 */
export async function claimImport(id, build) {
  return claimed(id, importedItem, rememberImported, build);
}

/**
 * The ACTOR-side claim: same rule, the actor collection instead of the item
 * index. Nothing is remembered — actors are found by their flag, not by an
 * index. A world copy is the Judge's and answers no claim, as it answers no
 * item index (`isWorldCopy`).
 */
export async function claimActorImport(id, build) {
  return claimed(id, (claimId) => importedActor(claimId, { copies: false }), (_id, doc) => doc, build);
}

async function claimed(id, present, remember, build) {
  // A document held for rewriting is built again, and the create under `build` writes over it.
  if (isRewriting(id)) return remember(id, await build());
  const existing = await present(id);
  if (existing) return existing;
  const inflight = inflightImports.get(id);
  if (inflight) return inflight;
  const pending = (async () => remember(id, await build()))();
  inflightImports.set(id, pending);
  try {
    return await pending;
  } finally {
    // The claim covers the in-flight window only, never past resolution — see
    // docs/importer/DECISIONS.md, "a claim is a window, not a cache."
    inflightImports.delete(id);
  }
}

/** Drop the cache — after a bulk delete, or when the target may have changed. */
export function forgetImportedIndex() {
  importedCache = null;
  nameIndexCache = null;
  inflightImports.clear();
}

/**
 * The imported item for a cookbook id, or null — the question every binding
 * outside this file has to ask before it can point at a document.
 */
export const importedItemFor = (id) => importedItem(id);

/**
 * The imported ACTOR for a cookbook id, or null — the same question against the
 * collection an actor importer writes to. `opts` is `importedActor`'s.
 */
export const importedActorFor = (id, opts) => importedActor(id, opts);

/**
 * Every document of a type the library holds — the packs', loaded, and the
 * sidebar's (`sidebarImports`). The one way to enumerate imports; a pass that
 * walks `game.<collection>` alone or the packs alone misses part of the
 * library. See docs/importer/DECISIONS.md, "The library is the packs AND the
 * sidebar this module stamped".
 */
export async function importedDocs(type) {
  if (!heldLibrary) return readLibrary(type);
  if (!heldLibrary.has(type)) heldLibrary.set(type, readLibrary(type));
  return [...(await heldLibrary.get(type))];
}

/** The library's documents of a type, read now from every pack and the sidebar. */
async function readLibrary(type) {
  const packed = (await Promise.all(ourPacksOfType(type).map((c) => c.getDocuments().catch(() => [])))).flat();
  return [...packed, ...sidebarImports(type)];
}

/** One reading of the library per type while `holdingLibrary` runs, else null. */
let heldLibrary = null;

/**
 * Run `pass` with one reading of the library per type: every `importedDocs`
 * inside it answers from the first read of its type, copied, so a book's
 * repair asking after another's reads the packs once instead of again. Only
 * for a pass that writes nothing; Import everything's asking pass is one,
 * since every part stops at its confirm. A hold already standing is used.
 */
export async function holdingLibrary(pass) {
  if (heldLibrary) return pass();
  heldLibrary = new Map();
  try {
    return await pass();
  } finally {
    heldLibrary = null;
  }
}

/** Delete imported documents of a type from wherever the library lives. */
export async function deleteImported(type, docs) {
  if (!docs.length) return 0;
  // Grouped by the pack each document is ON, never by one resolved target —
  // the list can span lines.
  const byPack = new Map();
  for (const doc of docs) {
    const key = doc.pack ?? "";
    if (!byPack.has(key)) byPack.set(key, []);
    byPack.get(key).push(doc.id);
  }
  const cls = foundry.utils.getDocumentClass(type);
  for (const [pack, ids] of byPack) {
    const gone = await cls
      .deleteDocuments(ids, pack ? { pack } : {})
      .catch((err) => (console.warn(`${MODULE_ID} | delete ${ids.length} ${type}(s) from ${pack || "the sidebar"}`, err), null));
    // What the rebuild puts back takes the id this one stood under (`itemIds`).
    for (const doc of gone ?? []) if (claimedId(doc)) deletedIdsOf(type).set(claimedId(doc), doc.id);
  }
  return docs.length;
}

/**
 * Every imported item keyed by lower-cased NAME, for the one lookup an id
 * cannot answer: a printed list that names an ability in words.
 *
 * Built once and handed to a loop rather than asked per name — the index is a
 * compendium read, and a class's rungs ask it dozens of times.
 */
export async function importedItemsByName() {
  const byName = new Map();
  for (const doc of (await importedIndex()).values()) {
    const key = doc.name?.toLowerCase();
    if (key && !byName.has(key)) byName.set(key, doc);
  }
  return byName;
}

/**
 * Shelf re-reads in flight, keyed by pack collection id — see `liveCopy`, so
 * every concurrent worker meets an eviction in the same instant rather than
 * each ordering its own full copy of the pack.
 */
const shelfReloads = new Map();

/**
 * The live document behind a cached one, or null once it is really gone. A
 * compendium is a CACHE over the shelf, not the shelf: presence is asked of
 * its INDEX, which survives an eviction, and the document is re-read only
 * once the index says yes. A world document has no eviction and answers from
 * its own collection. See docs/importer/DECISIONS.md, "A compendium is a
 * cache; presence is asked of its index".
 */
async function liveCopy(doc) {
  if (!doc.pack) return doc.collection?.get?.(doc.id) ?? null;
  const pack = game.packs.get(doc.pack);
  if (!pack?.index?.has(doc.id)) return null;
  if (pack.has(doc.id)) return pack.get(doc.id);
  let pending = shelfReloads.get(doc.pack);
  if (!pending) {
    // The whole shelf, not the one document: the eviction dropped every id the
    // caller's loop is about to ask for.
    pending = pack.getDocuments().catch(() => []);
    shelfReloads.set(doc.pack, pending);
    pending.finally(() => shelfReloads.delete(doc.pack));
  }
  await pending;
  return pack.get(doc.id) ?? null;
}

/**
 * The already-imported item for this cookbook id, or null.
 *
 * The index is cached for a whole session, so it can hold a document the GM has
 * since deleted — and answering "already imported" for a document that is gone
 * would break the one refresh a GM has: delete the item, import again, get the
 * new derived values. So the cached hit is confirmed by `liveCopy` before it is
 * trusted, and a stale one is dropped.
 */
export const importedItem = async (id) => {
  const cached = (await importedIndex()).get(id) ?? null;
  if (!cached) return null;
  const live = await liveCopy(cached);
  // A re-read after an eviction builds NEW instances, so the index has to take
  // the one the pack now holds — the evicted object it was holding answers for
  // a document nothing else in the session will ever hand out again.
  if (live && live !== cached) importedCache?.set(id, live);
  if (live) return live;
  importedCache?.delete(id);
  return null;
};

/**
 * The already-imported ACTOR for this cookbook id, or null — the actor-side
 * counterpart of importedItem, asked of whichever target actors go to. Not
 * indexed: the actor importers already carry `importedIdSet`, and this answers
 * the one question that needs the document itself (an animal, a companion).
 * The world answers first, copies included, so a scene's places link to one
 * another; `copies: false` asks for the library's own document, which is what
 * an "already imported?" check needs (`isWorldCopy`).
 *
 * A read, never a write: the own shelf is FOUND (`findLibraryPack`), never
 * opened through `packFor`, which mints the pack it is asked for. A presence
 * check runs before any import — a census, an "already imported?" gate — and
 * a world it ran in must hold exactly the packs it held before.
 */
export async function importedActor(id, { copies = true } = {}) {
  // A place another book took over answers for the id it was made under too
  // (`merged`), so a room still finds the place it sits in.
  const world = game.actors.find((a) => answersFor(a.getFlag(MODULE_ID, "cookbook"), id) && (copies || !isWorldCopy(a)));
  if (world) return world;
  // Its OWN shelf first — that is where `createDoc` put it — then the others.
  // A creature shelved under another line is still found, which is what keeps
  // a Judge from importing a second copy of it.
  const own = findLibraryPack("Actor", lineOf(bookOfCookbookId(id)));
  const others = ourPacksOfType("Actor").filter((p) => p !== own);
  const collections = own ? [own, ...others] : others;
  for (const collection of collections) {
    // The cookbook flag is not a default index field — ask for it, exactly as
    // importedIdSet does, or the row is there and the match never fires.
    const index = await collection.getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.cookbook.merged`] }).catch(() => null);
    const row = [...(index ?? [])].find((r) => answersFor(r.flags?.[MODULE_ID]?.cookbook, id));
    if (row) return collection.getDocument(row._id);
  }
  return null;
}

/** Resolves the folder at the end of a path of at most two names in the type's pack for a line, creating each missing level. */
export async function ensureFolderPath(type, names, line = null) {
  const pack = await packFor(type, line);
  const collection = pack ? game.packs.get(pack)?.folders : game.folders;
  const path = names.filter(Boolean).map((n) => String(n).trim()).filter(Boolean);
  // The gate, not a warning: a third level is dropped rather than created, so
  // the document lands one folder up instead of somewhere a pack would refuse
  // to make and an ownership dialog would never reach.
  if (path.length > FOLDER_MAX_DEPTH) {
    console.warn(`${MODULE_ID} | folder path "${path.join(" / ")}" is deeper than ${FOLDER_MAX_DEPTH} — truncated.`);
    path.length = FOLDER_MAX_DEPTH;
  }
  let parent = null;
  for (const name of path) {
    const key = `${type}|${pack ?? "world"}|${parent?.id ?? "root"}|${name}`;
    // Cache the PROMISE, not the resolved folder: the second concurrent caller
    // then awaits the first one's folder instead of creating a duplicate.
    let pending = folderCache.get(key);
    if (!pending) {
      const parentId = parent?.id ?? null;
      pending = (async () =>
        (collection ?? game.folders).find(
          (fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId,
        ) ??
        // Marked like every document this module makes, so removal can find it;
        // an adopted folder (one already there under this name) stays unmarked.
        (await Folder.create(
          { name, type, folder: parentId, sorting: "a", flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } } },
          pack ? { pack } : {},
        )))();
      folderCache.set(key, pending);
    }
    parent = await pending;
  }
  return parent;
}
/**
 * The folder an entry of this kind belongs in, creating the path as needed —
 * inside its book's LINE pack, so the tree and the pack always agree.
 */
export const targetFolder = (type, bookId, group) =>
  ensureFolderPath(type, [bookLabel(bookId), group], lineOf(bookId));

/**
 * Every cookbook id already held for one document type, in WHICHEVER target is
 * configured — the sidebar collection plus, in compendium mode, the pack INDEX
 * (read with the cookbook flag as an index field, so no document is loaded).
 * Every "have I imported this already?" question routes through here. See
 * docs/importer/DECISIONS.md, "One dedup rule for every importer: ask the
 * shelf you write to, and claim before you build".
 */
export async function importedIdsOfType(type, worldCollection) {
  // Never a class template's part: a skinned copy inherits the definition's
  // id, and counting it would let it answer for the shared definition. Never a
  // copy of an import either (`isWorldCopy`): counting it would stop a rebuild
  // putting the library's own document back.
  const part = (flags) => !!flags?.[MODULE_ID]?.[TEMPLATE_PART];
  // Every id a document answers for, a merged one included (`claimIds`).
  const ids = new Set(
    [...worldCollection]
      .filter((d) => !part(d.flags) && !isWorldCopy(d))
      .flatMap((d) => claimIds(d.getFlag(MODULE_ID, "cookbook"))),
  );
  // Every shelf: a batch mixes lines, so asking one pack answers "not
  // imported" for every book shelved elsewhere.
  for (const collection of ourPacksOfType(type)) {
    // A failed index read must be LOUD — an empty set here reads as "nothing
    // imported yet" and a bulk run re-creates everything as twins.
    const index = await collection
      .getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.cookbook.merged`, `flags.${MODULE_ID}.${TEMPLATE_PART}`] })
      .catch((err) => {
        console.warn(
          `${MODULE_ID} | importedIdsOfType: index of ${collection.collection} unreadable — imported ${type}s may be recreated`,
          err,
        );
        return null;
      });
    for (const row of index ?? []) {
      if (part(row.flags)) continue;
      for (const id of claimIds(row.flags?.[MODULE_ID]?.cookbook)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Cookbook ids already held as ACTORS, wherever imports go. A monster import
 * always CREATES — `importOne` has no reuse to fall back on — so every actor
 * import path filters through this, which is what makes "import all" safe to
 * press twice.
 */
export const importedIdSet = () => importedIdsOfType("Actor", game.actors);

/**
 * Actors of one type, wherever imports live (sidebar + configured pack). Never
 * a copy dragged out of the library (`isWorldCopy`): it is the Judge's, and a
 * family or leader template found there would take the import's write, or
 * stand in for the library's document a rebuild puts back.
 */
export async function importedActorsOfType(type) {
  const world = game.actors.filter((a) => a.type === type && !isWorldCopy(a));
  const collections = ourPacksOfType("Actor");
  if (!collections.length) return world;
  const docs = (await Promise.all(collections.map((c) => c.getDocuments({ type }).catch(() => [])))).flat();
  return [...world, ...docs];
}

/**
 * Monster TYPE → folder name: the stat block's own taxonomy (Animal, Undead,
 * Beastman, …), which is what a Judge actually browses by.
 */
const TYPE_FOLDER = {
  animal: "Animals",
  beastman: "Beastmen",
  construct: "Constructs",
  enchanted: "Enchanted",
  giant: "Giants",
  humanoid: "Humanoids",
  incarnation: "Incarnations",
  monstrosity: "Monstrosities",
  ooze: "Oozes",
  plant: "Plants",
  undead: "Undead",
  vermin: "Vermin",
};

/**
 * The type a block leads with, preferring the SPECIFIC one when it prints
 * several ("Humanoid, Beastman" files under Beastmen — the useful bucket).
 */
const TYPE_PRIORITY = ["beastman", "incarnation", "undead", "construct", "ooze", "plant", "giant", "vermin", "monstrosity", "animal", "humanoid", "enchanted"];
/** The one type key a node files under: the first in priority order among its type keys, else its first. */
export function primaryTypeOf(node) {
  const t = node?.fields?.stats?.type;
  const keys = (t?.keys ?? (t?.key ? [t.key] : [])).map((k) => String(k).toLowerCase());
  if (!keys.length) return null;
  for (const p of TYPE_PRIORITY) if (keys.includes(p)) return p;
  return keys[0];
}

/** Folder for a type key ("undead" → "Undead"), or null. */
const typeFolderOf = (key) => (key ? TYPE_FOLDER[String(key).toLowerCase()] ?? null : null);

/**
 * The display group an actor-kind entry files under: the book's authored
 * section group, else its stat-block TYPE, else a bucket for the kinds that
 * have no type at all (generator templates, NPCs, vehicles).
 */
function actorGroupOf(found, id, { type = null } = {}) {
  const authored = found?.entry?.meta?.group;
  if (authored) return authored;
  const kind = found?.entry?.kind;
  // A family/monster TEMPLATE is a generator, not a creature — it has no stat
  // block to type, and mixing generators in with monsters hides both.
  if (kind === "kind.monsterFamily" || kind === "kind.monsterTemplate") return "Templates";
  // A vehicle is one row of a printed table, not a creature; it has no type
  // either, and its own shelf is what keeps a book folder browsable.
  if (kind === "kind.vehicle") return "Vehicles";
  const byType = typeFolderOf(type);
  if (byType) return byType;
  if (kind === "kind.npc") return "NPCs";
  if (kind === "kind.pregen") return "Pregenerated";
  return null;
}

/**
 * THE one destination rule for a cookbook ACTOR — every actor importer asks
 * it, so no two of them can disagree about where a creature belongs.
 */
export function actorFolderFor(id, found = cookbookEntry(id), opts = {}) {
  // The Animals shelf is cross-book, but not cross-LINE: it is built in
  // whichever pack this entry's own book writes to, because the folder and the
  // document have to end up in the same compendium.
  if (isAnimalEntry(found?.entry)) return ensureFolderPath("Actor", ["Animals"], lineOfClaim(id, bookOf(found)));
  return targetFolder("Actor", bookOf(found), actorGroupOf(found, id, opts));
}

/** Pre-create every folder a batch will need, before the workers fan out. */
export async function prepareFolders(type, ids) {
  const seen = new Set();
  for (const id of ids) {
    const found = cookbookEntry(id);
    const group = type === "Actor" ? actorGroupOf(found, id) : (found?.entry?.meta?.group ?? null);
    const key = `${bookOf(found)}|${isAnimalEntry(found?.entry) ? "@animal" : (group ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === "Actor") await actorFolderFor(id, found);
    else await targetFolder(type, bookOf(found), group);
  }
}

/** How many entries a bulk import works on at once. */
export const IMPORT_CONCURRENCY = 4;

/**
 * Actor-kind entry ids across EVERY connected book, in book then page order.
 * The single-book `openBooks[0]` this replaced meant a seat with three books
 * open could only ever import from the first one.
 */
export function actorEntriesAcrossBooks() {
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const rows = [];
  for (const bookId of openBooks) {
    const cb = data.books.get(bookId);
    for (const [id, e] of Object.entries(cb.entries)) {
      if (actorKindOf(e)) rows.push({ id, entry: e, bookId });
    }
    // Families ride the same list as synthesized rows (one generator template
    // per family); their members stay listed too, for direct import.
    for (const id of Object.keys(cb.families ?? {})) {
      rows.push({ id, entry: cookbookEntry(id).entry, bookId });
    }
  }
  rows.sort((a, b) => a.bookId.localeCompare(b.bookId) || a.entry.pages[0] - b.entry.pages[0] || a.id.localeCompare(b.id));
  return { openBooks, rows };
}

/** Every entry id that is a MEMBER of some family in the given cookbook set. */
export function familyMemberIds() {
  const members = new Set();
  for (const cb of data.books.values()) {
    for (const fam of Object.values(cb.families ?? {})) for (const m of fam.members) members.add(m.id);
  }
  return members;
}

/** A plain copy of a document's system data. */
export const sysObject = (doc) =>
  typeof doc?.system?.toObject === "function" ? doc.system.toObject() : foundry.utils.deepClone(doc?.system ?? {});

/**
 * Items are filed by CONTENT TYPE, not by book: a proficiency spans every book
 * that prints it, and the whole point of the shared ability item is that one
 * copy serves every actor. `id` picks the shelf ("def.prof.x" -> Proficiencies).
 */
export const ITEM_SHELF = {
  "def.prof": "Proficiencies",
  "def.power": "Class Powers",
  // Beastman drawbacks are `kind.power` items but carry their own id namespace
  // (reclassified off `def.power` in the content audit). Without this line they
  // fall through itemShelfFor to the pack's top level, unsorted — so give them
  // their own shelf beside Class Powers.
  "def.drawback": "Drawbacks",
  "def.skill": "Skills",
  "def.language": "Languages",
  "def.class": "Classes",
  "def.equip": "Equipment",
  "def.weapon": "Weapons",
  "def.armor": "Armor",
  "def.trap": "Traps",
  "def.spell": "Spells",
  "def.variation": "Variations",
  "def.merchandise": "Merchandise",
  // The price list's own rows — see importPriceList for why they cannot join
  // the described entries' group shelves.
  "def.priced": "Equipment",
  // Races are `acks-extras.race` items the class builder binds, not abilities.
  "def.race": "Races",
};

/**
 * Sub-shelf a whole NAMESPACE takes, where the shelf alone would be the wrong
 * bucket. Read before the entry's own group, because a priced row has no entry
 * to ask.
 */
const SHELF_SUB = { "def.priced": "Price List" };

/** The first two segments of a cookbook id, which pick its Item shelf. */
export const shelfKeyOf = (id) => String(id ?? "").split(".").slice(0, 2).join(".");
const itemShelfFor = (id) => {
  const key = shelfKeyOf(id);
  const shelf = ITEM_SHELF[key] ?? null;
  // An unmapped namespace would land silently at the top level, loose above the
  // shelves. It is a missing ITEM_SHELF row every time, so say which one.
  if (!shelf && key) console.warn(`${MODULE_ID} | no item shelf for id namespace "${key}" — filing at the top level.`);
  return shelf;
};

/**
 * Sub-shelves under a top shelf, from the entry's own `meta.group`.
 *
 * The equipment chapter is not one list: 147 entries span carried gear,
 * clothing, animals, structures and vehicles, and a single "Equipment" folder
 * reproduces the flat pile one level down. The register already records which
 * group each entry belongs to, so the shelf just reads it — no new data, and a
 * group nobody declared simply lands on the top shelf.
 *
 * Titles are display strings for a folder, not book values.
 */
const GROUP_SHELF = {
  gear: "Adventuring Gear",
  shield: "Shields",
  clothing: "Clothing",
  animal: "Animals",
  provisions: "Provisions",
  lodging: "Lodging",
  structure: "Structures",
  vehicle: "Vehicles",
};

/**
 * Alphabet bands for a shelf whose SOURCE is a flat alphabetical dictionary —
 * the JJ class-powers list declares no taxonomy at all, and 316 entries in one
 * folder is unbrowsable. Bands mirror how the book itself is read (a dictionary
 * is looked up by letter), inventing nothing.
 */
const LETTER_BANDS = [["A", "D"], ["E", "H"], ["I", "L"], ["M", "P"], ["Q", "T"], ["U", "Z"]];
const letterBand = (name) => {
  const c = String(name ?? "").trim().charAt(0).toUpperCase();
  const band = LETTER_BANDS.find(([a, z]) => c >= a && c <= z);
  return band ? `${band[0]}–${band[1]}` : null;
};

/** THE one destination rule for a cookbook ITEM: shelf → sub-shelf. */
function itemShelfPath(id) {
  const shelf = itemShelfFor(id);
  if (!shelf) return [];
  // A namespace that takes a fixed sub-shelf is answered before the entry,
  // because the rows that need it (the price list) have no entry to ask.
  const fixed = SHELF_SUB[shelfKeyOf(id)];
  if (fixed) return [shelf, fixed];
  const entry = cookbookEntry(id)?.entry;
  // Proficiencies: the RR's OWN split — every proficiency is printed on the
  // General list, the Class lists, or is one of the combat picks (weapon/
  // armour/fighting-style). Authored data (`meta.general` + the kind), not
  // a guess.
  if (shelf === "Proficiencies") {
    const sub =
      entry?.kind === "kind.combatProficiency" ? "Combat"
      : entry?.meta?.general === true ? "General"
      : entry?.meta?.general === false ? "Class"
      : null;
    return [shelf, sub];
  }
  // Class powers: no authored grouping exists (see letterBand) — file by letter.
  if (shelf === "Class Powers") return [shelf, letterBand(entry?.name ?? "")];
  return [shelf, GROUP_SHELF[entry?.meta?.group] ?? null];
}

/**
 * The folder a definition id's item files under, created on demand. Every
 * item importer asks this and none builds its own path. The shelf comes from
 * the id's first two segments alone, so callers whose ids have no register
 * entry (languages, read from the seat's own book) still land on their shelf.
 * The PACK the shelf is built in is the claim's line (`lineOfClaim`): the
 * book the entry names, or the one given, so a series' "Classes" folder is
 * made in the series' Item pack, where the class is written.
 * See docs/importer/DECISIONS.md, "Organize is deleted, because destination
 * has one author".
 */
export async function ensureItemFolder(id = null, book = bookOf(cookbookEntry(id))) {
  return ensureFolderPath("Item", itemShelfPath(id), lineOfClaim(id, book));
}

/** Create every item shelf (and equipment sub-shelf) before parallel imports. */
export async function prepareItemShelves() {
  for (const shelf of new Set(Object.values(ITEM_SHELF))) await ensureFolderPath("Item", [shelf]);
  // Only groups the shipped cookbook actually uses — never the whole table, so
  // an empty folder is never created for content this world does not have.
  const groups = new Set();
  for (const id of cookbookEquipmentIds()) {
    const entry = cookbookEntry(id)?.entry;
    // Animals file under Actors when the world can hold them (`canImportAnimals`), so their item shelf
    // would stand empty — the one thing this loop exists to avoid.
    if (isAnimalEntry(entry) && canImportAnimals()) continue;
    const g = entry?.meta?.group;
    if (GROUP_SHELF[g]) groups.add(GROUP_SHELF[g]);
  }
  for (const g of groups) await ensureFolderPath("Item", [ITEM_SHELF["def.equip"], g]);
}


/* -------------------------------------------- */
/*  Same name, two books                        */
/* -------------------------------------------- */

/**
 * Library documents keyed by every printed form of their name.
 *
 * Cached for the session beside `importedIndex`, and dropped by the same
 * `forgetImportedIndex`, because it answers the same kind of question about the
 * same shelf. Rebuilt lazily; `rememberName` keeps it true as documents arrive
 * so a run that imports two books never has to rebuild it mid-way.
 */
let nameIndexCache = null;
/** The imported Items grouped by name key, built once and shared by the run. */
export async function libraryNameIndex() {
  if (nameIndexCache) return nameIndexCache;
  const map = new Map();
  for (const doc of await importedDocs("Item")) {
    if (doc.flags?.[MODULE_ID]?.templatePart) continue; // a class's copy, not a definition
    for (const k of nameKeys(printedName(doc))) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(doc);
    }
  }
  nameIndexCache = map;
  return map;
}

/** Teach the name index about a document, so the next import sees it. */
function rememberName(doc) {
  if (!nameIndexCache || !doc?.name) return doc;
  if (doc.flags?.[MODULE_ID]?.templatePart) return doc;
  for (const k of nameKeys(printedName(doc))) {
    if (!nameIndexCache.has(k)) nameIndexCache.set(k, []);
    if (!nameIndexCache.get(k).includes(doc)) nameIndexCache.get(k).push(doc);
  }
  return doc;
}

/**
 * The name a document was PRINTED under, before any book tag was added. Kept
 * on the flag and used to judge collisions, so a rewritten (tagged) name
 * cannot escape being reconsidered. See docs/importer/DECISIONS.md, "Same
 * name, two books: merge unless they differ beyond their source".
 */
export const printedName = (doc) => doc.getFlag(MODULE_ID, "cookbook")?.printed ?? doc.name;
