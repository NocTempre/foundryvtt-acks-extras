/**
 * Cookbook runtime: adventure journals, points of interest, keyed places, region rows, markets and factions.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { bookText, entryText, entryTable, escapeText, keepParagraphs } from "../prose.mjs";
import { bindPatch, claimIds, placePairs, rowBlockPatch, siteNamePatch, takeoverPatch } from "../place-pair.mjs";
import { unrepaired, unstampedTwins } from "../refresh.mjs";
import { coversFigure, decides, heldEdit } from "../held-edits.mjs";
import {
  isPoiEntry, poiGroupOf, districtPlaceId, districtPlaceData, poiLocationData, isRegionSite, isRegionOverview,
  regionPlaceId, regionPlaceData, keySpacesOf, isKeyedPlace, keyedParentId, occupantsOf, occupantFigures,
  adventurePlaceData, adventurePlaceId,
} from "../poi-binding.mjs";
import {
  isOrganisationRow, organisationData, organisationPlan, owedRelations, isStrengthGridRow, strengthPlan,
  strengthFromGrid, controlledRegions,
} from "../faction-binding.mjs";
import { printedNameOf, withoutKeyNumber } from "../printed-name.mjs";
import { isWorldCopy, isSceneRecipe, isRegionRecipe } from "../scene-binding.mjs";
import { FACTION_TYPE } from "../../factions/constants.mjs";
import { isPlaceRole } from "../../location/constants.mjs";
import { occupantRow } from "../../lib/place.mjs";
import { BOOKS, laterBook } from "../books.mjs";
import { executeEntry } from "../executor.mjs";
import { progressBar } from "../progress.mjs";
import { journalCookbookId } from "../adventure-binding.mjs";
import { nameKeys, creatureKeys } from "../../lib/vocab.mjs";
import {
  goodsResolver, heldErratumNotes, marketProfiles, marketProfileUpdate, marketActorData, marketEntryId, marketOrdinal,
  placeName, unprintedMarketUpdate, withErratumNote,
} from "../market-profile-binding.mjs";
import { merchandiseCatalog, primeMerchandiseCatalog } from "../../markets/engine/merchandise.mjs";
import { lineOf, bookOfCookbookId, data, ctx, bookLabel, claimedId, ACTOR_KINDS } from "./state.mjs";
import {
  packFor, rewriteScope, isRewriting, blockTarget, writeRowBlock, keepsJudgeFigure, blockDigestIn, writeJournalPage,
  wasRewritten, createDoc, claimActorImport, importedActor, ensureFolderPath, importedActorsOfType,
} from "./target.mjs";
import { bindNpc } from "./monster.mjs";

/* -------------------------------------------- */
/*  Adventure binding (AX line)                 */
/* -------------------------------------------- */

/** The kinds that bind to a journal page: a keyed room, a setting-detail table, and a passage read whole. */
const JOURNAL_KINDS = new Set(["kind.location", "kind.settingTable", "kind.prose"]);

/**
 * A page's title. A keyed room and a table are named by their row; a passage
 * is named by what it is (`meta.title`), since its page prints a title as a
 * picture.
 */
const journalPageName = (e) => (e.kind === "kind.prose" ? (e.meta?.title ?? e.name) : e.name);

/**
 * A page-bound entry. A keyed place of a settlement's quarter, a region's site
 * or overview, and an adventure's keyed area or key space, is a location ACTOR
 * or its notes (`cookbookImportPoiPlaces`) and is not a page as well.
 * `spaces` is the book's `keySpacesOf`.
 */
export const journalBound = (e, id, spaces) =>
  JOURNAL_KINDS.has(e.kind) && !isPoiEntry(e) && !isRegionSite(e) && !isRegionOverview(e) && !isKeyedPlace(e, id, spaces);

/** A book's page-bound entries, as `[id, entry]`. */
const journalEntriesOf = (entries) => {
  const spaces = keySpacesOf(entries);
  return Object.entries(entries).filter(([id, e]) => journalBound(e, id, spaces));
};

/**
 * Journals: one JournalEntry per meta.group, one page per keyed entry. A
 * location's page body is the room's own text + creature names (the
 * seat-extracted creature lookups, deferring to the ACKS II entry when the
 * register maps one); a setting table's is the printed rows laid out as a
 * table under the register's header words; a passage's is its paragraphs.
 * Pages update in place on re-import. A page whose stored text holds a Judge's
 * prose, or an edit inside its stamped block, that differs from the build
 * keeps it (`writeJournalPage`) and is counted in `preserved`: outside a
 * repair always, and inside a merged repair unless its decision takes it, where
 * a page kept is listed as a held edit.
 * `books` scopes the run to those book ids; otherwise every open book is
 * written. `created.journals` lists the uuids of the journals this run made. A
 * run with nothing to write resolves null with no notice when it is scoped or
 * `quiet` (one step of a batch).
 */
export async function cookbookImportJournals({ books = null, quiet = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates journals).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!books || books.includes(b)));
  const created = { journals: [] };
  let made = 0;
  let updated = 0;
  let preserved = 0;
  let refused = 0;
  // Counted up front so the bar can say how far through the pages it is.
  const total = openBooks.reduce((n, b) => n + journalEntriesOf(data.books.get(b).entries).length, 0);
  if (!total && (quiet || books)) return null;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressJournals`), total);
  try {
    for (const bookId of openBooks) {
      const cb = data.books.get(bookId);
      const session = ctx.sessionDocs.get(bookId);
      const locs = journalEntriesOf(cb.entries);
      if (!locs.length) continue;
      // The book is the folder, so a journal is named by its group alone.
      const folder = await ensureFolderPath("JournalEntry", [bookLabel(bookId)], lineOf(bookId));
      const groups = new Map();
      for (const [id, e] of locs) {
        const g = e.meta?.group ?? BOOKS[bookId]?.label ?? bookId;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push([id, e]);
      }
      // Journals go wherever imports go, so the presence lookup reads the same target.
      const journalPack = await packFor("JournalEntry", lineOf(bookId));
      const journals = journalPack ? await game.packs.get(journalPack).getDocuments() : [...game.journal];
      for (const [group, list] of groups) {
        // The cookbook id is what a book's Adventure carries a document by.
        const journalId = journalCookbookId(bookId, group);
        let journal = journals.find((j) => j.getFlag(MODULE_ID, "cookbook")?.group === group && j.getFlag(MODULE_ID, "cookbook")?.book === bookId);
        if (journal) {
          // Re-file, re-title and stamp a journal whose folder, name or id is not the book's current one.
          const move = {};
          if (journal.name !== group) move.name = group;
          if ((journal.folder?.id ?? null) !== folder.id) move.folder = folder.id;
          if (journal.getFlag(MODULE_ID, "cookbook")?.id !== journalId) move[`flags.${MODULE_ID}.cookbook.id`] = journalId;
          if (Object.keys(move).length) await journal.update(move);
        } else {
          journal = await createDoc(JournalEntry, {
            name: group,
            folder: folder.id,
            flags: { [MODULE_ID]: { cookbook: { id: journalId, book: bookId, group } } },
          });
          if (journal?.uuid) created.journals.push(journal.uuid);
        }
        list.sort((a, b) => (a[1].pages[0] - b[1].pages[0]) || a[0].localeCompare(b[0]));
        let sort = 0;
        for (const [id, e] of list) {
          sort += 100;
          const node = await executeEntry(session.doc, cb, data.registers, id).catch(() => null);
          // `ok` is the heading anchor: a box that no longer frames its room
          // (a printing that moved the text, or a file read into the wrong slot)
          // is refused rather than written.
          if (!node?.ok) {
            refused++;
            bar.step(e.name);
            continue;
          }
          const creatures = Object.values(node.fields?.creatures ?? {}).filter((c) => c && (c.ref || c.text));
          // The creature line is a cross-reference to the imported creatures, not prose.
          const creatureHtml = creatures.length
            ? `<p><strong>Creatures:</strong> ${creatures.map((c) => escapeText(c.text)).join(" · ")}</p>`
            : "";
          // `creatureHtml` stays what `CREATURE_LINE` matches, so an untouched page is never read as an edit.
          // A setting table's page holds the executor's label/text pairs as a table.
          const content =
            e.kind === "kind.settingTable" ? entryTable(node, id, e.cite, e.columns ?? []) : entryText(node, id, e.cite) + creatureHtml;
          const existing = journal.pages.find((p) => p.getFlag(MODULE_ID, "cookbook")?.id === id);
          if (existing) {
            if ((await writeJournalPage(existing, content, sort, e.cite ?? "")) === "kept") preserved++;
            else updated++;
          } else {
            await journal.createEmbeddedDocuments("JournalEntryPage", [
              {
                name: journalPageName(e),
                type: "text",
                sort,
                text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
                flags: { [MODULE_ID]: { cookbook: { id, book: bookId, sum: blockDigestIn(content, id) } } },
              },
            ]);
            made++;
          }
          bar.step(e.name);
        }
      }
    }
  } finally {
    bar.finish();
  }
  // A run that refused everything is a wrong file or an unread printing, not an empty book.
  if (!made && !updated && !preserved && refused)
    return ui.notifications.warn(`${MODULE_ID} | journals: ${refused} page(s) did not match the cookbook (different printing?) — none written.`);
  if (!made && !updated && !preserved) {
    if (quiet || books) return null;
    return ui.notifications.warn(`${MODULE_ID} | no journal pages in any open book — connect a book with keyed rooms, setting tables or passages.`);
  }
  ui.notifications.info(
    `${MODULE_ID} | journals: ${made} page(s) created, ${updated} refreshed${preserved ? `, ${preserved} kept (edited)` : ""}${refused ? `, ${refused} skipped (page did not match the cookbook)` : ""}, on each book's JournalEntry shelf.`,
  );
  return { made, updated, preserved, refused, created };
}

/**
 * Points of interest: the keyed places of a settlement's quarters, as
 * location ACTORS nested quarter → city, rather than as journal pages. Each
 * point is `poiLocationData`, named by the heading the Judge's page prints
 * under its key number (the cookbook ships only the number). Presence is
 * asked by cookbook id before the page is read. A journal page already
 * holding a point stays: nothing here deletes.
 * See docs/importer/DECISIONS.md, "A settlement's keyed places are actors,
 * nested quarter → city" and "A quarter's overview is the notes of the
 * quarter's place".
 *
 * A region's rows ride the same step (`importRegionRow`): its sites are places
 * under the region's own place, and its overview is that place's notes. So do
 * an adventure's key spaces and keyed areas (`importKeyedPlace`), each a place
 * under the one it sits inside, its stat lines its roster. A place another
 * book prints too is one place: a row whose pair already stands joins it
 * (`joinPaired`) instead of making a second. `books` scopes the run to those
 * book ids and `ids` to those rows; `created` lists the uuids of the keyed
 * and region places (the book's own place and the region's among them) and
 * stat-line creatures it made. With no place to write, a run scoped to books
 * or `quiet` (one step of a batch) resolves null with no notice.
 */
export async function cookbookImportPoiPlaces({ books = null, ids = null, quiet = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!books || books.includes(b)));
  const jobs = [];
  for (const bookId of openBooks) {
    const entries = data.books.get(bookId).entries;
    const spaces = keySpacesOf(entries);
    for (const [id, e] of Object.entries(entries)) {
      if (ids && !ids.includes(id)) continue;
      if (isPoiEntry(e)) jobs.push({ bookId, id, e, group: poiGroupOf(e.meta?.group) });
      else if (isRegionSite(e) || isRegionOverview(e)) jobs.push({ bookId, id, e, region: isRegionSite(e) ? "site" : "overview" });
      else if (isKeyedPlace(e, id, spaces)) jobs.push({ bookId, id, e, keyed: true });
    }
  }
  if (!jobs.length) {
    if (quiet || books) return null;
    return ui.notifications.warn(`${MODULE_ID} | no keyed places in any open book — connect a settlement or an adventure first.`);
  }
  let made = 0;
  let described = 0;
  let already = 0;
  let stamped = 0;
  let refused = 0;
  const tally = { made: 0, regions: 0, bound: 0, already: 0, stamped: 0, refused: 0, rostered: 0, creatures: 0, paired: 0 };
  const run = keyedRun(tally);
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressPoi`), jobs.length);
  try {
    for (const job of jobs) {
      const { bookId, id, e, group } = job;
      bar.step(e.name);
      if (job.region) {
        await importRegionRow(job, tally, run);
        continue;
      }
      if (job.keyed) {
        await run.placeFor(bookId, id);
        continue;
      }
      const overview = group.kind === "overview";
      const block = blockTarget(id);
      const held = overview || block || isRewriting(id) ? null : await importedActor(id, { copies: false });
      if (held) {
        // A role is structural, so a held place with no role is stamped without a
        // page read; a role the Judge set stands.
        if (isPlaceRole(e.meta?.role) && !held.system?.role) {
          await held.update({ "system.role": e.meta.role });
          stamped++;
        }
        already++;
        continue;
      }
      const cb = data.books.get(bookId);
      const label = bookLabel(bookId);
      const line = lineOf(bookId);
      // Two levels, which is all a pack allows: the book, then its places.
      const folder = (await ensureFolderPath("Actor", [label, "Places"], line))?.id ?? null;
      const city = await claimActorImport(adventurePlaceId(bookId), () =>
        createDoc(Actor, adventurePlaceData({ book: bookId, bookLabel: label, folderId: folder })));
      const district = await claimActorImport(districtPlaceId(bookId, group.district), () =>
        createDoc(Actor, districtPlaceData({
          book: bookId, bookLabel: label, district: group.district, parentUuid: city?.uuid ?? "", folderId: folder,
        })));
      // Notes that hold anything are the world's, asked before the page is read;
      // a repair writes the overview's own block over in place instead.
      if (overview && !block && (!district || district.system?.notes)) {
        already++;
        continue;
      }
      // The anchor proves the heading still titles this place.
      const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, cb, data.registers, id).catch(() => null);
      if (!node?.ok) {
        refused++;
        continue;
      }
      if (block) {
        await writeRowBlock(block, pairRow(run.pairs, { id, name: printedNameOf(node, e.name), notes: entryText(node, id, e.cite), cite: e.cite ?? "" }, block));
        continue;
      }
      if (overview) {
        await district.update({ "system.notes": entryText(node, id, e.cite) });
        described++;
        continue;
      }
      // The entry ships a label built from the key number; the Judge's own page names the place.
      const place = await claimActorImport(id, () =>
        createDoc(Actor, poiLocationData({
          name: printedNameOf(node, e.name), entryId: id, notes: entryText(node, id, e.cite), book: bookId, bookLabel: label,
          district: group.district, parentUuid: district?.uuid ?? "", folderId: folder, role: e.meta?.role ?? "",
        })));
      if (place && !isRewriting(id)) made++;
    }
  } finally {
    bar.finish();
  }
  made += tally.made;
  already += tally.already;
  stamped += tally.stamped;
  refused += tally.refused;
  const { regions, bound, rostered, creatures, paired } = tally;
  if (!made && !described && !regions && !bound && !paired && !already && refused) {
    return ui.notifications.warn(`${MODULE_ID} | points of interest: ${refused} page(s) did not match the cookbook (different printing?) — none written.`);
  }
  const regionParts = [
    regions ? `, ${game.i18n.format(`${LANG_PREFIX}.ui.poiRegionsDescribed`, { n: regions })}` : "",
    bound ? `, ${game.i18n.format(`${LANG_PREFIX}.ui.poiSitesBound`, { n: bound })}` : "",
    rostered ? `, ${game.i18n.format(`${LANG_PREFIX}.ui.poiOccupantsRostered`, { n: rostered })}` : "",
    creatures ? `, ${game.i18n.format(`${LANG_PREFIX}.ui.poiCreaturesMade`, { n: creatures })}` : "",
    paired ? `, ${game.i18n.format(`${LANG_PREFIX}.ui.poiPlacesPaired`, { n: paired })}` : "",
  ].join("");
  ui.notifications.info(
    `${MODULE_ID} | points of interest: ${made} place(s) created${described ? `, ${described} quarter(s) described` : ""}${regionParts}${already ? `, ${already} already held` : ""}${stamped ? `, ${stamped} given a role` : ""}${refused ? `, ${refused} skipped (page did not match the cookbook)` : ""}.`,
  );
  return { made, described, regions, bound, already, stamped, refused, rostered, creatures, paired, created: run.created };
}

/**
 * One run's keyed-place state: each place asked for once (`placeFor`, so a
 * room's parent is made before it whatever order the rows are listed in), each
 * book's own place, key spaces and occupant targets built once, the place
 * pairs every cookbook declares (`pairs`), and the uuids of the places and
 * creatures the run made (`created`).
 */
function keyedRun(tally) {
  const places = new Map();
  const bookPlaces = new Map();
  const spaces = new Map();
  const targets = new Map();
  const run = {
    tally,
    pairs: placePairs(data.books),
    created: { places: [], creatures: [] },
    spacesOf: (bookId) => {
      if (!spaces.has(bookId)) spaces.set(bookId, keySpacesOf(data.books.get(bookId)?.entries));
      return spaces.get(bookId);
    },
    targetsOf: (bookId) => {
      if (!targets.has(bookId)) targets.set(bookId, occupantTargets(bookId));
      return targets.get(bookId);
    },
    placeFor: (bookId, id) => {
      if (!places.has(id)) places.set(id, importKeyedPlace(bookId, id, run));
      return places.get(id);
    },
    bookPlaceFor: (bookId) => {
      if (!bookPlaces.has(bookId)) bookPlaces.set(bookId, bookPlaceOf(bookId, run));
      return bookPlaces.get(bookId);
    },
  };
  return run;
}

/** The book's own place, the one its key spaces sit in: held, else made. */
async function bookPlaceOf(bookId, run) {
  const id = adventurePlaceId(bookId);
  const held = await importedActor(id, { copies: false });
  if (held) return held;
  const label = bookLabel(bookId);
  const folder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
  const made = await claimActorImport(id, () => createDoc(Actor, adventurePlaceData({ book: bookId, bookLabel: label, folderId: folder })));
  if (made) run.created.places.push(made.uuid);
  return made;
}

/**
 * One key space or keyed area as a place inside the place it sits in
 * (`keyedParentId`: a keyed place, else the book's own), which is asked for
 * first. A held place, the library's own document and never a world copy, is
 * not read again; one with no parent, or one whose parent no longer exists, is
 * given it. One whose pair another book's place already stands as joins that
 * place (`joinPaired`). A new one is named by the heading its page prints,
 * takes the page's text as its notes, stat lines and all, and its roster is
 * `keyedOccupantRows`.
 * @returns {Promise<Actor|null>} the place, held, joined or made; null when its page did not match
 */
async function importKeyedPlace(bookId, id, run) {
  const { tally } = run;
  const cb = data.books.get(bookId);
  const e = cb.entries[id];
  const label = bookLabel(bookId);
  const folder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
  const parentId = keyedParentId(e, bookId);
  const parent = isKeyedPlace(cb.entries[parentId], parentId, run.spacesOf(bookId))
    ? await run.placeFor(bookId, parentId)
    : await run.bookPlaceFor(bookId);
  // A place a repair holds is built again and written over (`withRewrite`);
  // one it writes this row's block onto is read for the block alone.
  const block = blockTarget(id);
  const held = isRewriting(id) || block ? null : await importedActor(id, { copies: false });
  if (held) {
    const patch = siteBindPatch(held, { parentUuid: parent?.uuid ?? "" });
    // A parent made again is a new document: the uuid the place names is then
    // nothing's, and is replaced. One that still resolves is the Judge's move.
    const was = held.system?.parentUuid;
    if (parent && was && was !== parent.uuid && !(await fromUuid(was).catch(() => null))) patch["system.parentUuid"] = parent.uuid;
    if (Object.keys(patch).length) await held.update(patch);
    tally.already++;
    return held;
  }
  const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, cb, data.registers, id).catch(() => null);
  if (!node?.ok) {
    tally.refused++;
    return null;
  }
  const name = printedNameOf(node, e.name);
  const notes = entryText(node, id, e.cite);
  if (block) return writeRowBlock(block, pairRow(run.pairs, { id, name, notes, cite: e.cite ?? "" }, block));
  const paired = await pairedPlace(run.pairs, id);
  if (paired) {
    // Only a bind fills a roster, and only an empty one: the lines are not
    // made into creatures for a roster nothing writes.
    const fills = !paired.takesOver && !paired.place.system?.roster?.length;
    const roster = fills ? await keyedOccupantRows(bookId, id, node, run) : [];
    tally.paired++;
    return joinPaired(paired, { id, book: bookId, name, notes, parentUuid: parent?.uuid ?? "", region: label, roster });
  }
  const roster = await keyedOccupantRows(bookId, id, node, run);
  const place = await claimActorImport(id, () =>
    createDoc(Actor, poiLocationData({
      name, entryId: id, notes, book: bookId, bookLabel: label, parentUuid: parent?.uuid ?? "", folderId: folder, roster,
    })));
  if (place && !isRewriting(id)) {
    tally.made++;
    run.created.places.push(place.uuid);
  }
  return place;
}

/**
 * What a room's occupant labels can link to, by `nameKeys` of each name.
 * `core`: the library's creatures of every other book, a name two books share
 * answered by the later-published (`laterBook`). `own`: the people and
 * creatures this book's rows were imported as. World copies answer neither.
 */
async function occupantTargets(bookId) {
  const bookOf = (a) => bookOfCookbookId(a?.flags?.[MODULE_ID]?.cookbook?.id ?? "");
  const core = new Map();
  for (const actor of await importedActorsOfType("monster")) {
    const book = bookOf(actor);
    if (!book || book === bookId || isWorldCopy(actor)) continue;
    for (const k of nameKeys(actor.name)) {
      const had = core.get(k);
      if (!had || laterBook(book, bookOf(had)) === book) core.set(k, actor);
    }
  }
  const own = new Map();
  for (const [rowId, e] of Object.entries(data.books.get(bookId)?.entries ?? {})) {
    if (!ACTOR_KINDS.has(e.kind) || e.kind === "kind.pregen") continue;
    const actor = await importedActor(rowId, { copies: false });
    if (actor) for (const k of nameKeys(actor.name)) if (!own.has(k)) own.set(k, actor);
  }
  return { core, own };
}

/**
 * A keyed place's roster: a hidden row per stat line its text prints, linked
 * to the creature the label names (`occupantTargets`: the register's own
 * reference first, then `core`, then `own`), else to a creature made from
 * the line itself (`statLineCreature`). The row's quantity is the label's
 * count, and its notes the count printed as dice and the hit points. A person
 * of the book stands once, with no notes, however the room counts its line.
 */
async function keyedOccupantRows(bookId, id, node, run) {
  const { core, own } = await run.targetsOf(bookId);
  const rows = [];
  for (const occ of occupantsOf(node.fields)) {
    const keys = [...creatureKeys(occ.name.text)];
    const named = occ.name.ref ? await importedActor(occ.name.ref, { copies: false }) : null;
    const library = named ?? keys.map((k) => core.get(k)).find(Boolean) ?? null;
    const ours = library ? null : (keys.map((k) => own.get(k)).find(Boolean) ?? null);
    const actor = library ?? ours ?? (await statLineCreature(bookId, id, occ, node, run));
    if (!actor) continue;
    const person = ours?.type === "character";
    const { quantity, countText, hp } = occupantFigures(occ);
    const notes = person ? "" : [
      countText,
      hp.length ? game.i18n.format(`${LANG_PREFIX}.ui.poiOccupantHp`, { hp: hp.join(", ") }) : "",
    ].filter(Boolean).join("; ");
    rows.push(occupantRow(actor, { quantity: person ? 1 : quantity, notes, hidden: true }));
    run.tally.rostered++;
  }
  return rows;
}

/**
 * A creature made from a room's own stat line, for a label nothing else
 * answers: named as the label reads on the page, its figures bound the way a
 * person's line is (`bindNpc`), the line itself its biography. Claimed under
 * `<place id>-o<i>`, so a later run, and a rebuilt room, find it.
 */
async function statLineCreature(bookId, placeId, occ, node, run) {
  const oid = `${placeId}-o${occ.index}`;
  // A creature a repair holds is built again and written over (`withRewrite`).
  const held = isRewriting(oid) ? null : await importedActor(oid, { copies: false });
  if (held) return held;
  const folder = (await ensureFolderPath("Actor", [bookLabel(bookId), "Creatures"], lineOf(bookId)))?.id ?? null;
  const bound = bindNpc({ fields: { statline: occ.stats ?? {} } });
  // A held creature's items the build also makes and that carry no stamp are
  // stamped first, so the write below replaces them (`unstampedTwins`).
  const standing = rewriteScope?.held.get(oid);
  const twins = standing ? unstampedTwins(standing.toObject?.().items ?? [], bound.items) : [];
  if (twins.length) await standing.updateEmbeddedDocuments("Item", twins.map((_id) => ({ _id, [`flags.${MODULE_ID}.minted`]: true })));
  const line = String(occ.stats?.text ?? "").trim();
  const cite = data.books.get(bookId)?.entries?.[placeId]?.cite ?? "";
  const made = await claimActorImport(oid, () =>
    createDoc(Actor, {
      name: occ.name.text.trim(),
      type: "monster",
      folder,
      system: {
        ...bound.system,
        details: { ...(bound.system.details ?? {}), biography: line ? bookText([line], cite, { id: oid, book: bookId, page: node.page ?? null }) : "" },
      },
      items: bound.items ?? [],
      flags: { [MODULE_ID]: { cookbook: { id: oid, book: bookId, kind: "kind.npc", unaudited: true } } },
    }));
  if (made && !isRewriting(oid)) {
    run.tally.creatures++;
    run.created.creatures.push(made.uuid);
  }
  return made;
}

/**
 * Where a region's keyed site lands, as the cookbook id of the place it is
 * claimed under: the market record's place when its row names a market
 * (`meta.market`), the book's own settlement when it says `place: "adventure"`
 * or names a market whose record does, else a place of its own under its own
 * id. One answer for the place step and the map step, so a site's token stands
 * on the document its text was written to.
 *
 * @param {string} bookId
 * @param {object} entry the site's cookbook entry
 * @param {string} id the site's cookbook id
 * @param {Record<string, object>} [entries] the book's entries, to read a named market's record
 * @returns {{claimId: string, onto: "market"|"adventure"|"site"}}
 */
export function regionSiteClaim(bookId, entry, id, entries = {}) {
  const market = entry?.meta?.market;
  if (market) {
    const claimId = marketEntryId(bookId, market);
    return entries[claimId]?.meta?.place === "adventure" ? { claimId: adventurePlaceId(bookId), onto: "adventure" } : { claimId, onto: "market" };
  }
  if (entry?.meta?.place === "adventure") return { claimId: adventurePlaceId(bookId), onto: "adventure" };
  return { claimId: id, onto: "site" };
}

/**
 * The update that binds a site onto a place another row already owns: its
 * notes, its parent and its role, each written only where the place holds
 * none, so the Judge's text and the record's own writes are left standing.
 * A place is never made its own parent.
 * @returns {Record<string, string>} an update payload, empty when nothing is owed
 */
export function siteBindPatch(target, { notes = "", parentUuid = "", role = "" } = {}) {
  const sys = target?.system ?? {};
  const patch = {};
  // A market step that ran first may have left an erratum note, which is not
  // the site's text: the site's notes land ahead of it.
  const errata = heldErratumNotes(sys.notes, claimIds(target?.flags?.[MODULE_ID]?.cookbook));
  if (notes && !errata.rest.trim()) patch["system.notes"] = `${notes}${errata.blocks.join("")}`;
  if (parentUuid && !sys.parentUuid && parentUuid !== target?.uuid) patch["system.parentUuid"] = parentUuid;
  if (isPlaceRole(role) && !sys.role) patch["system.role"] = role;
  return patch;
}

/**
 * A row's build as `rowBlockPatch` writes it onto `target`: an earlier pair
 * row on the place the later row has taken over keeps its block to the
 * paragraphs only it prints, set after the later row's; any other row is
 * written as built.
 */
function pairRow(pairs, row, target) {
  const pair = pairs?.get(row.id);
  if (pair?.earlier !== row.id || claimedId(target) !== pair.later) return row;
  return { ...row, notes: keepParagraphs(row.notes, pair.unique), after: pair.later };
}

/**
 * The place a row's pair already stands as, or null: the earlier book's place
 * when `id` is the later row (`takesOver`), the later book's when it is the
 * earlier. The library's own document answers, never a world copy.
 * @returns {Promise<{pair: {earlier: string, later: string, unique: number[]}, place: Actor, takesOver: boolean}|null>}
 */
async function pairedPlace(pairs, id) {
  const pair = pairs?.get(id);
  if (!pair) return null;
  const takesOver = pair.later === id;
  const place = await importedActor(takesOver ? pair.earlier : pair.later, { copies: false });
  return place ? { pair, place, takesOver } : null;
}

/**
 * Join an arriving row to the place its pair stands as (`pairedPlace`): the
 * later row takes the place over, the earlier row binds onto it, its block
 * kept to the paragraphs its pair names. `built` is the arriving row's own
 * build — id, book, read name, materialized notes, parent, region, role and
 * roster. The earlier row's side of a takeover is what its own build wrote:
 * the parent its row names and its book's label. A market column is no row of
 * its own and wrote no parent.
 * @returns {Promise<Actor>} the place joined
 */
async function joinPaired({ pair, place, takesOver }, built) {
  const source = { ...place.toObject(), uuid: place.uuid };
  let patch;
  if (takesOver) {
    const book = bookOfCookbookId(pair.earlier);
    const entry = data.books.get(book)?.entries?.[pair.earlier];
    const parentId = !entry ? null : isRegionSite(entry) ? regionPlaceId(book) : keyedParentId(entry, book);
    const parent = parentId ? await importedActor(parentId, { copies: false }) : null;
    patch = takeoverPatch(source, built, { id: pair.earlier, parentUuid: parent?.uuid ?? "", region: bookLabel(book), unique: pair.unique });
  } else {
    patch = bindPatch(source, { ...built, notes: keepParagraphs(built.notes, pair.unique) });
  }
  if (Object.keys(patch).length) await place.update(patch);
  return place;
}

/**
 * The place a market is claimed as: the one that answers for `id` already,
 * else the place its pair stands as, joined (`joinPaired` with `built`), else
 * a fresh one from `build`. One answer for a market record's site, a book's
 * market step and an earlier book's market column, so whichever lands first,
 * the other joins it.
 * @returns {Promise<{place: Actor|null, paired: boolean, fresh: boolean}>}
 */
async function claimMarketPlace(id, pairs, built, build) {
  const held = await importedActor(id, { copies: false });
  if (held) return { place: held, paired: false, fresh: false };
  const paired = await pairedPlace(pairs, id);
  if (paired) return { place: await joinPaired(paired, built), paired: true, fresh: false };
  let fresh = false;
  const place = await claimActorImport(id, () => {
    fresh = true;
    return build();
  });
  return { place, paired: false, fresh };
}

/**
 * Whether a book carries a region's map recipe. The map stands on the
 * region's place and waits for it, so the places step makes that place for
 * such a book whether or not a row of it needs a parent.
 */
const carriesRegionMap = (bookId) =>
  Object.values(data.books.get(bookId)?.scenes ?? {}).some((row) => isSceneRecipe(row) && isRegionRecipe(row.scene));

/**
 * Whether joining a row onto the place its pair stands as can write the
 * region as that place's parent: a bind fills a parent only where the place
 * holds none, and a takeover moves the parent of the place it takes over
 * (`bindPatch`, `takeoverPatch`).
 */
const pairWritesParent = ({ place, takesOver }) => takesOver || !place.system?.parentUuid;

/**
 * One region row, as `cookbookImportPoiPlaces` takes a quarter's: the
 * region's place (`regionPlaceData`, once per book) is claimed on the first
 * need of this book's rows. Its overview is that place's notes; a site is a
 * place under it, or is bound onto the market or settlement its row names
 * (`regionSiteClaim`), or joins the place its pair already stands as
 * (`joinPaired`). A bound or paired place takes the region as parent only where
 * it holds none; a book that carries a region's map always makes the place,
 * for the map stands on it. Presence and held notes are asked of the library's
 * own document before the page is read. Counts into `tally`; a place it makes
 * is listed in `run.created`.
 */
async function importRegionRow({ bookId, id, e, region }, tally, run) {
  const cb = data.books.get(bookId);
  const label = bookLabel(bookId);
  const folder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
  let regionPlace;
  const claimRegion = async () => {
    if (regionPlace !== undefined) return regionPlace;
    const held = await importedActor(regionPlaceId(bookId), { copies: false });
    regionPlace = held ?? (await claimActorImport(regionPlaceId(bookId), () =>
      createDoc(Actor, regionPlaceData({ book: bookId, bookLabel: label, folderId: folder }))));
    if (regionPlace && !held) run.created.places.push(regionPlace.uuid);
    return regionPlace;
  };
  // The region's uuid for a place that may take it as parent, "" where it is owed none.
  const parentFor = async (owed) => (owed ? (await claimRegion())?.uuid ?? "" : "");
  if (carriesRegionMap(bookId)) await claimRegion();
  const read = () => executeEntry(ctx.sessionDocs.get(bookId).doc, cb, data.registers, id).catch(() => null);
  const role = e.meta?.role ?? "";

  // A repair writes this row's block over in place on the place it
  // shares (`blockTarget`); what a Judge changed there is held (`rowBlockPatch`).
  const block = blockTarget(id);
  if (block) {
    const node = await read();
    if (!node?.ok) return void tally.refused++;
    const siteName = printedNameOf(node, e.name);
    await writeRowBlock(block, pairRow(run.pairs, { id, name: siteName, notes: entryText(node, id, e.cite), cite: e.cite ?? "" }, block));
    await nameBoundMarket(block, regionSiteClaim(bookId, e, id, cb.entries), e, siteName);
    return;
  }

  if (region === "overview") {
    const place = await claimRegion();
    if (!place || place.system?.notes) return void tally.already++;
    const node = await read();
    if (!node?.ok) return void tally.refused++;
    await place.update({ "system.notes": entryText(node, id, e.cite) });
    return void tally.regions++;
  }

  const claim = regionSiteClaim(bookId, e, id, cb.entries);
  const held = await importedActor(claim.claimId, { copies: false });
  if (claim.onto === "site" && held && !isRewriting(claim.claimId)) {
    if (isPlaceRole(role) && !held.system?.role) {
      await held.update({ "system.role": role });
      tally.stamped++;
    }
    return void tally.already++;
  }
  // A bound place whose notes are written needs no page: only its parent and
  // role can still be owed. An erratum note alone is not its text.
  if (held && !isRewriting(claim.claimId) && heldErratumNotes(held.system?.notes, claimIds(held.getFlag?.(MODULE_ID, "cookbook"))).rest.trim()) {
    const patch = siteBindPatch(held, { parentUuid: await parentFor(!held.system?.parentUuid), role });
    if (Object.keys(patch).length) await held.update(patch);
    return void tally.already++;
  }
  const node = await read();
  if (!node?.ok) return void tally.refused++;
  const name = printedNameOf(node, e.name);
  const notes = entryText(node, id, e.cite);
  if (claim.onto === "site") {
    const paired = await pairedPlace(run.pairs, id);
    if (paired) {
      const parentUuid = await parentFor(pairWritesParent(paired));
      await joinPaired(paired, { id, book: bookId, name, notes, parentUuid, region: label, role });
      return void tally.paired++;
    }
    const parentUuid = await parentFor(true);
    const made = await claimActorImport(id, () =>
      createDoc(Actor, poiLocationData({ name, entryId: id, notes, book: bookId, bookLabel: label, parentUuid, folderId: folder, role })));
    if (made && !isRewriting(id)) {
      tally.made++;
      run.created.places.push(made.uuid);
    }
    return;
  }
  // A place made here holds no parent, so the region is claimed ahead of it; a
  // held one or a pair's place is owed the region only where it holds none.
  const pair = held || claim.onto !== "market" ? null : await pairedPlace(run.pairs, claim.claimId);
  const parentUuid = await parentFor(held ? !held.system?.parentUuid : !pair || pairWritesParent(pair));
  let target = held;
  if (!target && claim.onto === "market") {
    // A market an earlier book's grid already made is taken over, not doubled.
    const claimed = await claimMarketPlace(claim.claimId, run.pairs,
      { id: claim.claimId, book: bookId, name, notes, parentUuid, region: label, role },
      () => createDoc(Actor, marketActorData({ name, entryId: claim.claimId, book: bookId, bookLabel: label, folderId: folder })));
    if (claimed.paired) return void tally.paired++;
    target = claimed.place;
    if (target) run.created.places.push(target.uuid);
  } else if (!target) {
    target = await claimActorImport(claim.claimId, () =>
      createDoc(Actor, adventurePlaceData({ book: bookId, bookLabel: label, folderId: folder })));
    if (target) run.created.places.push(target.uuid);
  }
  if (!target) return void tally.refused++;
  const patch = siteBindPatch(target, { notes, parentUuid, role });
  if (Object.keys(patch).length) await target.update(patch);
  await nameBoundMarket(target, claim, e, name);
  tally.bound++;
}

/**
 * A region site bound onto a market's place yields the place's name to the
 * market step: it writes its heading only where the place still holds the
 * neutral label (`siteNamePatch`). A site bound anywhere else names nothing.
 * @param {Actor} place the place the site's text was written onto
 * @param {{claimId: string, onto: string}} claim `regionSiteClaim`'s answer for the site
 * @param {object} entry the site's cookbook entry
 * @param {string} name the site's read heading
 */
async function nameBoundMarket(place, claim, entry, name) {
  if (claim.onto !== "market") return;
  const patch = siteNamePatch({ ...place.toObject(), uuid: place.uuid }, { id: claim.claimId, name, placeholder: marketPlaceholder(entry.meta?.market) });
  if (Object.keys(patch).length) await place.update(patch);
}

/** The neutral label a market carries until a page names it: the market step's fallback and the one a region site yields to. */
const marketPlaceholder = (market) => game.i18n.format(`${LANG_PREFIX}.markets.label`, { n: marketOrdinal(market) });

/**
 * Write the name the market step read (`printed`: a record's heading or a
 * column's header) onto the place that is the market's own, and onto no other:
 * a place claimed under another id (a pair another book took over, the
 * settlement) is named by its own row. The name follows only while the place
 * still holds the one the import last wrote (`rowBlockPatch`); a Judge's
 * rename stands, and under a merged repair is listed in the tally's `edits`
 * until a decision takes it.
 */
async function nameMarketPlace(place, entryId, printed, cite, repair) {
  const stored = { ...place.toObject(), uuid: place.uuid };
  if (stored.flags?.[MODULE_ID]?.cookbook?.id !== entryId) return;
  const merged = !!repair && "decision" in repair;
  const { update, edits } = rowBlockPatch(stored, { id: entryId, name: printed, cite }, { decision: merged ? repair.decision : null });
  if (merged && edits.length) (repair.edits ??= []).push(...edits);
  if (!Object.keys(update).length) return;
  await place.update(update);
  if ((repair?.force || merged) && unrepaired(repair, place)) repair.replaced++;
}

/**
 * Which of a place's market figures a repair under a `decision` writes over
 * what the place holds (`marketProfileUpdate`'s per-field `force`): each of
 * the class, the family count and the base demand that only a forced write
 * would change, and that the place holds differently from the page
 * (`coversFigure`), is an edit, marked `unstamped` since no read stamp covers
 * it. One the decision takes is forced; the rest are listed in `repair.edits`.
 * @returns {{marketClass?: true, families?: true, demand?: true}}
 */
export function marketTakes(place, profile, source, { corrected = false, repair, cite = "" }) {
  const market = place.toObject?.().system?.market ?? place.system?.market ?? null;
  const plain = marketProfileUpdate(market, profile, source, { corrected });
  const forced = marketProfileUpdate(market, profile, source, { corrected, force: true });
  const take = {};
  for (const [field, path, current, page] of [
    ["marketClass", "system.market.marketClassOverride", market?.marketClassOverride, profile.marketClass],
    ["families", "system.market.urbanFamilies", market?.urbanFamilies, profile.families],
    ["demand", "system.market.goods.demand", market?.goods?.demand, profile.demand],
  ]) {
    if (!forced.wrote[field] || plain.wrote[field] || coversFigure(current, page)) continue;
    const edit = heldEdit({ uuid: place.uuid ?? "", name: place.name ?? "", path, current, page, cite, unstamped: true });
    if (decides(repair.decision, edit.key) === "take") take[field] = true;
    else (repair.edits ??= []).push(edit);
  }
  return take;
}

/**
 * Market profiles: a setting book's regional demand grid and domain records,
 * as market class, urban families and base demand on location actors
 * (`market-profile-binding.mjs` holds the translation and the write rule). A
 * market with a domain record is named by the heading the Judge's page prints,
 * one a sideways grid heads by its column's header, and the rest keep their
 * neutral label. A record marked `place: "adventure"` binds onto the book's
 * own city, the actor the POI step nests under; a grid column's
 * `meta.markets` may name that city, a place another row builds (waited for,
 * never stubbed), or a later book's market it pairs with (`claimMarketPlace`).
 * A class or family count the place already holds is left standing, and a
 * base demand unless an earlier printing wrote it (`baseIsImportable`). Goods
 * that translate to no merchandise, and a record whose class differs from its
 * grid row unless the record declares the grid's class a misprint
 * (`meta.gridClassErratum`), are reported. A record that declares its own
 * family count a misprint (`meta.familiesErratum`) writes none onto its place.
 * A place carries one erratum note, its citation on the page the misprint is
 * on. A market the grid's `meta.errata`
 * names carries a note citing the page, and one no band holds is cleared of
 * what this page wrote (`unprintedMarketUpdate`). See docs/markets/DECISIONS.md,
 * "A setting book's market profile lands as the base", "A later printing's
 * demand replaces an earlier one's" and "AX3's demand grid is corrected as
 * printing errata".
 *
 * `repair`, a forced tally (`repairTally({force: true})`), writes the class and
 * the families over what a place holds and the base demand over any base but
 * one a later printing wrote (`marketProfileUpdate`'s `force`); a tally that
 * carries a `decision` writes each of the three that way only where the
 * decision takes it (`marketTakes`); an ordinary run and an unforced tally
 * keep the write rule above.
 */
export async function cookbookImportMarketProfiles({ books: only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const books = [...data.books.keys()]
    .filter((b) => ctx.sessionDocs.has(b) && (!only || only.includes(b)))
    .map((bookId) => {
      const entries = Object.entries(data.books.get(bookId).entries);
      return {
        bookId,
        grids: entries.filter(([, e]) => e.kind === "kind.marketGrid"),
        records: entries.filter(([, e]) => e.kind === "kind.marketRecord"),
      };
    })
    .filter((b) => b.grids.length);
  // Narrowed to books that print no grid, the step has nothing to say.
  if (!books.length) return only ? { made: 0, updated: 0, kept: 0, paired: 0, waiting: 0, refused: 0 } : ui.notifications.warn(`${MODULE_ID} | no market grids in any open book.`);
  await primeMerchandiseCatalog().catch(() => null);
  const resolve = goodsResolver(merchandiseCatalog());
  const pairs = placePairs(data.books);
  const counts = { made: 0, updated: 0, kept: 0, paired: 0, waiting: 0, refused: 0 };
  const unmapped = new Map();
  const duplicates = new Map();
  const conflicts = [];
  for (const { bookId, grids, records } of books) {
    const cb = data.books.get(bookId);
    const read = (id) => executeEntry(ctx.sessionDocs.get(bookId).doc, cb, data.registers, id).catch(() => null);
    const recordOf = {};
    for (const [id, e] of records) {
      const node = await read(id);
      if (!node?.ok || !e.meta?.market) {
        counts.refused++;
        continue;
      }
      recordOf[e.meta.market] = {
        families: node.fields?.families,
        marketClass: node.fields?.marketClass,
        name: placeName(printedNameOf(node, "")),
        place: e.meta.place ?? null,
        gridClassErratum: e.meta.gridClassErratum ?? null,
        familiesErratum: e.meta.familiesErratum ?? null,
        gateToll: e.meta.gateToll ?? null,
        cite: e.cite ?? "",
        page: e.pages?.[0],
      };
    }
    const label = bookLabel(bookId);
    const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressMarkets`), grids.length);
    try {
      for (const [id, e] of grids) {
        bar.step(e.name);
        const node = await read(id);
        const grid = node?.ok ? node.fields?.grids?.markets : null;
        if (!grid) {
          counts.refused++;
          continue;
        }
        const source = { book: bookId, page: e.cite ?? "" };
        const folder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
        // A market the grid's errata names carries a note citing this page,
        // so the Judge can see what was corrected and open the printing.
        const errata = e.meta?.errata ?? {};
        // The citation opens the grid's page, or `at`'s where the misprint is
        // on a record's.
        const noteErratum = async (place, entryId, key, erratum, at = { cite: e.cite ?? "", page: e.pages?.[0] }) => {
          const text = game.i18n.format(`${LANG_PREFIX}.markets.${key}`, { id: erratum });
          const notes = withErratumNote(place.system?.notes ?? "", { entryId, text, cite: at.cite, book: bookId, page: at.page });
          if (notes !== null) await place.update({ "system.notes": notes });
        };
        for (const profile of marketProfiles({ grids: [grid], records: recordOf, resolve })) {
          const record = recordOf[profile.market] ?? null;
          for (const u of profile.unmapped) unmapped.set(u.column, u.header);
          for (const column of profile.duplicates) duplicates.set(column, String(grid.header?.[column] ?? column));
          if (profile.classConflict) conflicts.push(record?.name || profile.market);
          const entryId = marketEntryId(bookId, profile.market);
          // A grid printed sideways heads each market's column with its name,
          // as text; one printed the other way keys its rows by position.
          const printedName = record?.name || placeName(grid.header?.[profile.market]);
          const name = printedName || marketPlaceholder(profile.market);
          // A column may name the place it is (`meta.markets`): the book's own
          // settlement, a place another row builds, or another book's market.
          const column = e.meta?.markets?.[profile.market] ?? {};
          const at = column.place ?? record?.place ?? null;
          let place = null;
          let fresh = false;
          let paired = false;
          if (at === "adventure") {
            place = await claimActorImport(adventurePlaceId(bookId), () =>
              createDoc(Actor, adventurePlaceData({ book: bookId, bookLabel: label, folderId: folder })));
          } else if (at) {
            // That row's own step builds it from its page; a stub here would
            // keep its text from ever landing.
            place = await importedActor(at, { copies: false });
            if (!place) {
              counts.waiting++;
              continue;
            }
          } else {
            ({ place, fresh, paired } = await claimMarketPlace(entryId, pairs, { id: entryId, book: bookId, name, notes: "", region: label },
              () => createDoc(Actor, marketActorData({ name, entryId, book: bookId, bookLabel: label, folderId: folder }))));
            // This step owns the name it reads, on a place a region site made
            // first as on one a repair finds held.
            if (place && printedName) await nameMarketPlace(place, entryId, printedName, e.cite ?? "", repair);
          }
          if (!place) {
            counts.refused++;
            continue;
          }
          const corrected = errata[profile.market] ?? null;
          const merged = !!repair && "decision" in repair;
          const force = merged ? marketTakes(place, profile, source, { corrected: !!corrected, repair, cite: e.cite ?? "" }) : !!repair?.force;
          const { update, wrote } = marketProfileUpdate(place.system?.market ?? null, profile, source, { corrected: !!corrected, force });
          if (Object.keys(update).length) {
            await place.update(update);
            // A forced or merged repair counts each place it wrote a profile onto, once.
            if ((repair?.force || merged) && unrepaired(repair, place)) repair.replaced++;
          }
          if (corrected) await noteErratum(place, entryId, "erratumMoved", corrected);
          else if (record?.gridClassErratum) await noteErratum(place, entryId, "erratumClass", record.gridClassErratum);
          else if (record?.familiesErratum) await noteErratum(place, entryId, "erratumFamilies", record.familiesErratum, record);
          if (fresh) counts.made++;
          else if (paired) counts.paired++;
          else if (wrote.marketClass || wrote.families || wrote.demand || wrote.gateToll) counts.updated++;
          else counts.kept++;
        }
        // A corrected market no band holds: the page prints its name and no
        // figures of its own, so what an earlier import wrote from it goes.
        // Its place is found as a banded market's is, and never made.
        const banded = new Set((grid.rows ?? []).map((row) => row?.key));
        for (const [market, erratum] of Object.entries(errata)) {
          if (banded.has(market)) continue;
          const entryId = marketEntryId(bookId, market);
          const at = e.meta?.markets?.[market]?.place ?? recordOf[market]?.place ?? null;
          const place = await importedActor(at === "adventure" ? adventurePlaceId(bookId) : at ?? entryId, { copies: false });
          if (!place) continue;
          const update = unprintedMarketUpdate(place.system?.market ?? null, source);
          if (Object.keys(update).length) {
            await place.update(update);
            counts.updated++;
          }
          await noteErratum(place, entryId, "erratumUnprinted", erratum);
        }
      }
    } finally {
      bar.finish();
    }
  }
  if (unmapped.size) {
    const list = [...unmapped].map(([column, header]) => `${header} (${column})`).join("; ");
    console.warn(`${MODULE_ID} | market profiles: goods with no merchandise match — ${list}`);
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.markets.unmapped`, { n: unmapped.size, list }));
  }
  if (duplicates.size) {
    const list = [...duplicates].map(([column, header]) => `${header} (${column})`).join("; ");
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.markets.duplicates`, { n: duplicates.size, list }));
  }
  if (conflicts.length) {
    ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.markets.classConflict`, { list: conflicts.join(", ") }));
  }
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.markets.done`, counts));
  return { ...counts, unmapped: [...unmapped.keys()], duplicates: [...duplicates.keys()], conflicts };
}

/**
 * Every world map carrying a recipe id, in the world's order: the imports,
 * where the world holds any (a twin, an import beside another, follows the
 * first), else the first copy (`isWorldCopy`). Empty where the world holds no
 * map for it.
 */
export const heldMapsOf = (sceneId) => {
  const mine = game.scenes.filter((s) => s.getFlag(MODULE_ID, "cookbook")?.id === sceneId);
  const imports = mine.filter((s) => !isWorldCopy(s));
  return imports.length ? imports : mine.slice(0, 1);
};

/**
 * The world's map for a recipe id: an import before any copy of one
 * (`isWorldCopy`), or null. The first of `heldMapsOf`.
 */
export const heldMapOf = (sceneId) => heldMapsOf(sceneId)[0] ?? null;

/**
 * The quarter place ids a settlement recipe draws, one per `recipe.districts`
 * row and in its order: the quarter the row's place sits in, as that quarter's
 * place id.
 * @returns {string[]}
 */
export function quarterPlaceIds(bookId, recipe) {
  const entries = data.books.get(bookId)?.entries ?? {};
  const quarterOf = (entryId) => poiGroupOf(entries[entryId]?.meta?.group)?.district ?? "";
  return (recipe.districts ?? []).map((d) => districtPlaceId(bookId, quarterOf(d.place)));
}

/**
 * Hand a map's quarters to the organisations that control them: every faction
 * of the book now in the world has its flagged quarter ids turned into the
 * regions this scene drew. A Region it held that no longer exists is dropped
 * in the same write; one on some other scene is kept. The single writer of the
 * claim: the map step calls it for a map it has just made, the organisations
 * step for a map already held. A claim already in place writes nothing.
 * @returns {Promise<number>} how many factions were written to
 */
export async function claimControlledQuarters(bookId, scene, recipe, districtIds) {
  const regionOf = new Map();
  for (const [i, district] of (recipe.districts ?? []).entries()) {
    const region = scene.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.place === district.place);
    if (region) regionOf.set(districtIds[i], region.uuid);
  }
  const exists = (uuid) => {
    try {
      return !!fromUuidSync(uuid);
    } catch {
      return false;
    }
  };
  let written = 0;
  for (const faction of game.actors.filter((a) => a.type === FACTION_TYPE && a.getFlag(MODULE_ID, "cookbook")?.book === bookId)) {
    const quarterIds = faction.getFlag(MODULE_ID, "cookbook")?.controls ?? [];
    if (!quarterIds.length) continue;
    const next = controlledRegions([...(faction.system.controls ?? [])], quarterIds, regionOf, exists);
    if (!next) continue;
    await faction.update({ "system.controls": next });
    written++;
  }
  return written;
}

/**
 * The claim for every settlement map of a book that the world already holds,
 * so the organisations step hands quarters out whichever of the two steps ran
 * first. A region's map draws no quarters and is passed over; a recipe whose
 * map is not in the world is left for the map step.
 * @returns {Promise<number>} how many faction writes were made
 */
export async function claimHeldMaps(bookId) {
  let written = 0;
  for (const [id, row] of Object.entries(data.books.get(bookId)?.scenes ?? {})) {
    if (!isSceneRecipe(row) || isRegionRecipe(row.scene)) continue;
    const scene = heldMapOf(id);
    if (!scene) continue;
    written += await claimControlledQuarters(bookId, scene, row.scene, quarterPlaceIds(bookId, row.scene));
  }
  return written;
}

/**
 * Organisations, as FACTION actors (`faction-binding.mjs` says which entries
 * are one, and of which sort): named and seated from the entry's `organisation`
 * block, at its own keyed place or its quarter's. Presence is asked by
 * cookbook id before the page is read, so a re-run tops up only what is
 * absent and never rewrites a row that is there. Relations are written
 * last, once every organisation they could name exists, and then the
 * strength grids: each read once, its columns written onto the factions they
 * belong to, and a faction already carrying figures keeps them. A settlement
 * map the world already holds hands the organisations their quarters here
 * (`claimHeldMaps`), as the map step does for one it makes. See
 * docs/importer/DECISIONS.md, "An organisation the book introduces by name
 * is an authored row", "A body becomes a faction one way: a row that was
 * read" and "A body's unnamed people are a grid the page prints".
 */
export async function cookbookImportFactions({ books = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!books || books.includes(b)));
  const authored = [];
  const grids = [];
  for (const bookId of openBooks) {
    const entries = data.books.get(bookId).entries;
    for (const [id, e] of Object.entries(entries)) {
      if (isOrganisationRow(e)) authored.push({ bookId, id, e, plan: organisationPlan(bookId, e, entries) });
      else if (isStrengthGridRow(e)) grids.push({ bookId, id, e, plan: strengthPlan(e) });
    }
  }
  const counts = { made: 0, already: 0, rostered: 0, missing: 0, refused: 0, related: 0, relationsKept: 0, counted: 0, figuresKept: 0, rewritten: 0, controlled: 0 };
  // Narrowed to books that print no organisation, the step has nothing to say.
  if (!authored.length) return books ? counts : ui.notifications.warn(`${MODULE_ID} | no organisations in any open book — connect AX3 first.`);

  // The quarter's own place, made the way the POI step makes it.
  const seatsOf = async (bookId, district) => {
    const label = bookLabel(bookId);
    const placeFolder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
    const city = await claimActorImport(adventurePlaceId(bookId), () =>
      createDoc(Actor, adventurePlaceData({ book: bookId, bookLabel: label, folderId: placeFolder })));
    if (!district) return city;
    return claimActorImport(districtPlaceId(bookId, district), () =>
      createDoc(Actor, districtPlaceData({ book: bookId, bookLabel: label, district, parentUuid: city?.uuid ?? "", folderId: placeFolder })));
  };
  const rosterOnto = async (faction, members) => {
    const rows = (faction.system.members ?? []).map((m) => m.toObject?.() ?? m);
    const held = new Set(rows.map((m) => m.uuid));
    let added = 0;
    for (const { id, hidden } of members) {
      const found = await importedActor(id);
      // The lookup may answer with an index row; the roster row wants the document.
      const person = found?.system ? found : found?.uuid ? await fromUuid(found.uuid) : null;
      if (!person) {
        counts.missing++;
        continue;
      }
      if (held.has(person.uuid)) continue;
      rows.push(occupantRow(person, { hidden }));
      held.add(person.uuid);
      added++;
    }
    if (added) await faction.update({ "system.members": rows });
    counts.rostered += added;
  };

  const built = [];
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressFactions`), authored.length);
  try {
    for (const { bookId, id, e, plan } of authored) {
      bar.step(e.name);
      const label = bookLabel(bookId);
      const folder = (await ensureFolderPath("Actor", [label, "Factions"], lineOf(bookId)))?.id ?? null;
      const quarter = await seatsOf(bookId, plan.seatQuarter);
      const keyed = plan.seat ? await importedActor(plan.seat) : null;
      const leader = plan.leader ? await importedActor(plan.leader) : null;
      const holdings = [];
      for (const placeId of plan.holdings) {
        const place = await importedActor(placeId);
        if (place && !holdings.some((h) => h.uuid === place.uuid)) holdings.push({ uuid: place.uuid, name: place.name });
      }
      // A body a repair holds is built again and written over (`withRewrite`).
      // Presence and every write below ask the library's own document: a copy a
      // map brought across answers the links above, never this.
      let faction = isRewriting(id) ? null : await importedActor(id, { copies: false });
      if (faction) {
        counts.already++;
        const patch = {};
        if (keyed && faction.system.seatUuid === (quarter?.uuid ?? "")) patch["system.seatUuid"] = keyed.uuid;
        if (leader && !faction.system.leaderUuid) patch["system.leaderUuid"] = leader.uuid;
        const held = (faction.system.holdings ?? []).map((h) => h.toObject?.() ?? h);
        const owed = holdings.filter((h) => !held.some((row) => row.uuid === h.uuid));
        if (owed.length) patch["system.holdings"] = [...held, ...owed.map((h) => ({ ...h, note: "", hidden: false }))];
        if (Object.keys(patch).length) await faction.update(patch);
      } else {
        // The hash proves the box still holds the name this row was cut for.
        const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, data.books.get(bookId), data.registers, id).catch(() => null);
        if (!node?.ok || node.fields?.anchor?.ok === false) {
          counts.refused++;
          continue;
        }
        const printed = printedNameOf(node, e.name);
        faction = await claimActorImport(id, () =>
          createDoc(Actor, organisationData({
            entryId: id, book: bookId, bookLabel: label, name: plan.namedAfterSeat ? withoutKeyNumber(printed) : printed, kind: plan.kind,
            gmNotes: entryText(node, id, e.cite), seatUuid: (keyed ?? quarter)?.uuid ?? "", leaderUuid: leader?.uuid ?? "",
            holdings, controls: plan.controls, folderId: folder,
          })));
        if (!faction) continue;
        if (isRewriting(id)) counts.rewritten++;
        else counts.made++;
      }
      await rosterOnto(faction, plan.members);
      built.push({ id, faction, plan, cite: e.cite });
    }

    for (const { id, faction, plan, cite } of built) {
      if (!plan.relations.length) continue;
      const others = new Map();
      for (const r of plan.relations) {
        const other = others.has(r.to) ? null : await importedActor(r.to);
        if (other) others.set(r.to, { uuid: other.uuid, name: other.name });
      }
      const held = (faction.system.relations ?? []).map((r) => r.toObject?.() ?? r);
      const owed = owedRelations(held, plan.relations, others, cite);
      if (!owed.length) continue;
      // Under a decision, a held body that lacks relations the page gives holds the Judge's deletion: listed, not put back.
      if (isRewriting(id) && keepsJudgeFigure(faction, "system.relations", held, [...held, ...owed], cite ?? "")) {
        counts.relationsKept++;
        continue;
      }
      await faction.update({ "system.relations": [...held, ...owed] });
      counts.related += owed.length;
    }

    // The bodies' unnamed people. A grid is read once and its columns land on
    // the factions its block names; a faction that already carries figures keeps
    // them. A column disagreeing with the page's total row is warned on the console.
    for (const { bookId, id, e, plan } of grids) {
      if (!plan.owners.size) continue;
      const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, data.books.get(bookId), data.registers, id).catch(() => null);
      const grid = node?.ok ? node.fields?.grids?.strength : null;
      if (!grid?.rows?.length) {
        counts.refused++;
        continue;
      }
      for (const [orgId, keys] of plan.owners) {
        const found = await importedActor(orgId, { copies: false });
        const faction = found?.system ? found : found?.uuid ? await fromUuid(found.uuid) : null;
        if (!faction) continue;
        if (faction.system.strength?.rows?.length && !wasRewritten(faction)) {
          counts.figuresKept++;
          continue;
        }
        const built = strengthFromGrid(grid, keys, { revenue: plan.revenue, note: e.cite ?? "" });
        if (!built) continue;
        for (const problem of built.problems) console.warn(`${MODULE_ID} | ${id}: ${problem}`);
        // Under a decision, figures a rewrite meets that no longer hold the grid's are an edit.
        const stored = faction.toObject?.().system?.strength ?? faction.system.strength;
        if (stored?.rows?.length && keepsJudgeFigure(faction, "system.strength", stored, built.strength, e.cite ?? "")) {
          counts.figuresKept++;
          continue;
        }
        await faction.update({ "system.strength": built.strength });
        counts.counted++;
      }
    }

    // Every faction of a book exists by now, so a map held from an earlier run
    // can hand them their quarters.
    for (const bookId of new Set(authored.map((a) => a.bookId))) counts.controlled += await claimHeldMaps(bookId);
  } finally {
    bar.finish();
  }
  if (!counts.made && !counts.already && counts.refused) {
    return ui.notifications.warn(`${MODULE_ID} | ${game.i18n.format(`${LANG_PREFIX}.ui.repairMergedOrgsNoneWritten`, { n: counts.refused })}`);
  }
  const part = (key, n, always = false) => (n || always ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, { n }) : "");
  const parts = [
    part("repairMergedOrgsCreated", counts.made, true),
    part("repairMergedOrgsRewritten", counts.rewritten),
    part("repairMergedOrgsAlready", counts.already),
    part("repairMergedOrgsRostered", counts.rostered),
    part("repairMergedOrgsRelated", counts.related),
    part("repairMergedOrgsRelationsKept", counts.relationsKept),
    part("repairMergedOrgsCounted", counts.counted),
    part("repairMergedOrgsFiguresKept", counts.figuresKept),
    part("repairMergedOrgsMissing", counts.missing),
    part("repairMergedOrgsRefused", counts.refused),
  ].filter(Boolean);
  ui.notifications.info(`${MODULE_ID} | ${game.i18n.format(`${LANG_PREFIX}.ui.repairMergedOrgsDone`, { parts: parts.join(", ") })}`);
  return counts;
}
