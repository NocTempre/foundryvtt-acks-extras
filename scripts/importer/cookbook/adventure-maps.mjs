/**
 * Cookbook runtime: roll tables, adventure items, scenes, zones and links, the Adventure document.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, DEFAULT_IMG } from "../constants.mjs";
import { editedInBlocks, entryText, sumsUpdate } from "../prose.mjs";
import { claimIds } from "../place-pair.mjs";
import { handWrittenProse, REPAIR, countRepair, unrepaired } from "../refresh.mjs";
import { decides, heldEdit } from "../held-edits.mjs";
import {
  isRegionSite, isRegionOverview, regionPlaceId, keySpacesOf, isKeyedPlace, keyedParentId, adventurePlaceId,
} from "../poi-binding.mjs";
import { printedNameOf } from "../printed-name.mjs";
import {
  GRID_SCENE_PADDING, zoneMovedBy, isSceneRecipe, sceneFrame, sceneData, districtRegionData, placeTokenAt,
  worldCopySource, isWorldCopy, placementMatches, afterDarkShift, bandOfSection, isZoneRow, gridScale, ringToScene,
  offsetsInside, zoneRegionData, coversCrop, wallSources, isRegionRecipe, storeyCrops, storeyLevelId, isLinkRow,
  linkBoxOnFirstStorey, linkEndKey, linkRect, linkRegionData, compassOf, spanOf, linkQuestion,
} from "../scene-binding.mjs";
import { FACTION_TYPE } from "../../factions/constants.mjs";
import { LOCATION_TYPE } from "../../location/constants.mjs";
import { DISTRICT_TYPE } from "../../formation/district-find.mjs";
import { sceneIncidents, writeSceneIncidents, hexProbe, sceneTravelSystem, writeSceneSetup } from "../../battlemap/scene-setup.mjs";
import { hexAlignment } from "../../battlemap/hex-fit.mjs";
import { gridTypeFor } from "../../battlemap/constants.mjs";
import { mirrorCreatedLinks } from "../../location/scene-link.mjs";
import { BOOKS, bookIsJudges } from "../books.mjs";
import { executeEntry } from "../executor.mjs";
import { pageArtPlacements } from "../extract.mjs";
import { progressBar } from "../progress.mjs";
import { findLibraryPack, cookbookId } from "../../lib/library.mjs";
import { ensureLibraryPack } from "../../lib/library-target.mjs";
import {
  ADVENTURE_TYPE, BOOK_ADVENTURE_KIND, adventureCookbookId, bookAdventureCookbookId, bookAdventureId, withWorldIds,
  withAdventureLinks, adventureRefs, linkFields, seatsLeft, adventureFolderSources, sourcesHashOf, bookAdventureState,
  standInsByClaim,
} from "../adventure-binding.mjs";
import { adventureItemShape } from "../adventure-item-binding.mjs";
import { ensureSceneThumb } from "../book-adventure.mjs";
import { lineOf, bookOfCookbookId, isContentId, data, ctx, cookbookEntry, bookLabel } from "./state.mjs";
import { repairFromEntry } from "./read.mjs";
import {
  packLabel, ourPacksOfType, createDoc, WRITE_CHUNK, claimImport, importedItem, targetFolder, importedIdsOfType,
} from "./target.mjs";
import { regionSiteClaim, heldMapOf, heldMapsOf, quarterPlaceIds, claimControlledQuarters } from "./adventure-places.mjs";

/**
 * Roll tables: ranges are shipped structure (r<lo> / r<lo>-<hi> sections);
 * row TEXT materializes from the seat's book at import and persists in the
 * world — the GM's hand-typed-table equivalence, like imported stat values.
 * The formula comes from the page (dice locator) or, when the rows start at
 * 1, mechanically from the shipped range structure. `repair`, a tally
 * (`repairTally`), writes each table this world already holds over in place
 * (`rewriteTable`) instead of passing it over. A row the compiler marked `open`
 * (its die printed bounded on one side) has its range widened on that side
 * AFTER the formula is read off the printed ranges, so a roll modified past the
 * bound lands on it and the die is still the printed one.
 */
export async function cookbookImportRollTables({ books = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates roll tables).`);
  const wanted = books ? new Set(books) : null;
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!wanted || wanted.has(b)));
  const present = await importedIdsOfType("RollTable", game.tables);
  let made = 0;
  let skipped = 0;
  const bar = progressBar(
    game.i18n.localize(`${LANG_PREFIX}.ui.progressRollTables`),
    openBooks.reduce((n, b) => n + Object.values(data.books.get(b).entries).filter((e) => e.kind === "kind.rolltable").length, 0),
  );
  try {
    for (const bookId of openBooks) {
      const cb = data.books.get(bookId);
      const session = ctx.sessionDocs.get(bookId);
      const tables = Object.entries(cb.entries).filter(([, e]) => e.kind === "kind.rolltable");
      if (!tables.length) continue;
      for (const [id, e] of tables) {
        // Stepped at the top, not per outcome: every branch below either creates
        // the table or explains why it could not, and all of them consumed a unit
        // of the work the bar is measuring.
        bar.step(e.name);
        // A held table is passed over, or under a repair read again and written over.
        const held = present.has(id);
        if (held && !repair) {
          skipped++;
          continue;
        }
        const node = await executeEntry(session.doc, cb, data.registers, id).catch(() => null);
        if (!node?.ok) {
          ui.notifications.warn(`${MODULE_ID} | ${e.name}: page did not match the cookbook — skipped.`);
          continue;
        }
        const folder = held ? null : await targetFolder("RollTable", bookId, e.meta?.group);
        // Rows arrive as section-labelled paragraphs; a row that wrapped columns
        // has several paras under one section, joined here in order. A detail
        // paragraph (the row's explanation printed elsewhere on the page) stands
        // under the row as a paragraph of its own: the result's text is HTML.
        const rowText = new Map();
        for (const p of node.fields.rows ?? []) {
          const key = p.section ?? "";
          const prev = rowText.get(key);
          if (p.detail) rowText.set(key, `${prev ?? ""}<p>${p.text}</p>`);
          else rowText.set(key, prev === undefined ? p.text : `${prev} ${p.text}`);
        }
        // The executor does not carry a row's `open` mark, so it is read off the
        // compiled paragraphs, by section.
        const openSide = new Map((e.fields?.rows?.paras ?? []).filter((p) => p.open).map((p) => [p.section, p.open]));
        const results = [];
        const opened = new Map();
        for (const [sec, text] of rowText) {
          const m = /^r([\d,-]+)$/.exec(sec);
          if (!m) continue;
          // A section may carry several ranges ("r6,7,16" — one printed truth
          // covering several rumor rolls); each becomes its own result row.
          for (const part of m[1].split(",")) {
            const g = /^(\d+)(?:-(\d+))?$/.exec(part);
            if (!g) continue;
            const lo = parseInt(g[1], 10);
            const hi = g[2] ? parseInt(g[2], 10) : lo;
            const result = { type: CONST.TABLE_RESULT_TYPES.TEXT, text, range: [lo, hi] };
            results.push(result);
            if (openSide.has(sec)) opened.set(result, openSide.get(sec));
          }
        }
        if (!results.length) continue;
        results.sort((a, b) => a.range[0] - b.range[0]);
        const lows = results.map((r) => r.range[0]);
        const his = results.map((r) => r.range[1]);
        const formula =
          (typeof node.fields.roll === "string" && node.fields.roll) ||
          (Math.min(...lows) === 1 ? `1d${Math.max(...his)}` : "");
        for (const [result, side] of opened) result.range = openRange(result.range, side);
        if (held) {
          skipped++;
          // The library's own table, never a copy a Judge dragged out of it.
          await rewriteTable(await importedTable(id, { copies: false }), { formula, description: entryText(node, id, e.cite), results }, repair);
          continue;
        }
        await createDoc(RollTable, {
          // A table anchored by a hash of its heading ships a neutral name and
          // takes the printed one from the page it was read off.
          name: printedNameOf(node, e.name),
          folder: folder?.id ?? null,
          formula,
          description: entryText(node, id, e.cite),
          results,
          flags: { [MODULE_ID]: { cookbook: { id, book: bookId } } },
        });
        made++;
      }
    }
  } finally {
    bar.finish();
  }
  if (!made && !skipped) {
    // Narrowed to books that print no roll table, the step has nothing to say.
    if (books) return { made, skipped };
    // Which books carry roll tables is derived, not recited: naming AX2/AX3 in
    // the message went stale the moment the Judges Journal grew a table.
    const carriers = [...data.books.keys()]
      .filter((b) => Object.values(data.books.get(b).entries).some((e) => e.kind === "kind.rolltable"))
      .map((b) => BOOKS[b]?.label ?? b.toUpperCase());
    return ui.notifications.warn(
      `${MODULE_ID} | no roll-table entries in any open book — connect ${carriers.join(" or ")} first.`,
    );
  }
  ui.notifications.info(`${MODULE_ID} | roll tables: ${made} created, ${skipped} already present, in "${packLabel("RollTable")}".`);
  return { made, skipped };
}

/** How far past a printed bound a widened result's range reaches; the sheet shows it as the open end. */
const OPEN_REACH = 999;

/**
 * A result's `[lo, hi]` widened on the side its die leaves open: `below` takes
 * the floor out to `-OPEN_REACH`, `above` the ceiling out to `OPEN_REACH`, so a
 * roll modified past the printed bound still finds the row. Any other side
 * leaves the range as it is.
 * @param {number[]} range the printed `[lo, hi]`
 * @param {"below"|"above"} side
 * @returns {number[]}
 */
export function openRange([lo, hi], side) {
  if (side === "below") return [Math.min(lo, -OPEN_REACH), hi];
  if (side === "above") return [lo, Math.max(hi, OPEN_REACH)];
  return [lo, hi];
}

/** What an imported list adds after dark, read from its own rows and die (`afterDarkShift`). */
function listAfterDark(list) {
  return afterDarkShift([...(list.results ?? [])].map((r) => r.range), list.formula);
}

/**
 * Write a fresh read of a roll table over the one this world holds: its formula,
 * its description (unless a Judge wrote one and the tally is not forced), and its
 * rows, which are replaced whole. The table's id, folder, owners and name stay.
 * A tally carrying a `decision` keeps a description a Judge wrote unless the
 * decision takes it, and lists it in `edits`. Counted into `repair`; a failed
 * write counts as refused and leaves the rows as they were where the delete had
 * not yet run.
 */
export async function rewriteTable(table, built, repair) {
  if (!table || !unrepaired(repair, table)) return;
  const edited = editedInBlocks(table.flags?.[MODULE_ID]?.cookbook?.sums, "description", table.description);
  const judged = (handWrittenProse(table.description) || edited) && table.description !== built.description;
  let keepProse = !repair.force && judged;
  if (judged && "decision" in repair) {
    const edit = heldEdit({ uuid: table.uuid, name: table.name, path: "description", current: table.description, page: built.description, cite: built.flags?.[MODULE_ID]?.cookbook?.cite ?? "" });
    keepProse = decides(repair.decision, edit.key) !== "take";
    if (keepProse) (repair.edits ??= []).push(edit);
  }
  try {
    await table.update({ formula: built.formula, ...(keepProse ? {} : { description: built.description, ...sumsUpdate(built.description, "description") }) });
    const old = [...table.results].map((r) => r.id);
    if (old.length) await table.deleteEmbeddedDocuments("TableResult", old);
    await table.createEmbeddedDocuments("TableResult", built.results);
    countRepair(repair, { keptProse: keepProse ? ["description"] : [] });
  } catch (err) {
    console.error(`${MODULE_ID} | repair of ${table.name} failed`, err);
    countRepair(repair, "error");
  }
}

/**
 * The imported roll table for a cookbook id — the world's own first, then the
 * shelves — or null. A link (a scene's incident list, a zone's table) takes
 * whichever answers; `copies: false` asks for the library's own table and
 * passes over a copy (`isWorldCopy`), which is what a write wants.
 */
async function importedTable(id, { copies = true } = {}) {
  const world = game.tables.find((t) => t.getFlag(MODULE_ID, "cookbook")?.id === id && (copies || !isWorldCopy(t)));
  if (world) return world;
  for (const collection of ourPacksOfType("RollTable")) {
    const index = await collection.getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`] }).catch(() => null);
    const row = [...(index ?? [])].find((r) => r.flags?.[MODULE_ID]?.cookbook?.id === id);
    if (row) return collection.getDocument(row._id);
  }
  return null;
}

/**
 * A folder path in the WORLD, whatever target the library writes to. A scene
 * and the actors standing on it are world documents by construction, so their
 * folders are too; each is marked the way `ensureFolderPath` marks its own, and
 * an adopted one left unmarked, so removal takes exactly what was made here.
 * `made` collects the uuid of each folder this call had to create.
 */
async function ensureWorldFolderPath(type, names, made = []) {
  let parent = null;
  for (const name of names.map((n) => String(n ?? "").trim()).filter(Boolean)) {
    const parentId = parent?.id ?? null;
    let folder = game.folders.find((fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId);
    if (!folder) {
      folder = await Folder.create({ name, type, folder: parentId, sorting: "a", flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } } });
      if (folder) made.push(folder.uuid);
    }
    parent = folder;
  }
  return parent;
}

/**
 * What bringing a book's places and organisations into the world would take,
 * worked out WITHOUT writing anything: which of the cookbook ids the world
 * already holds, which the library holds and would be made again, and which
 * neither has. Asked before the picture is drawn, so a map that cannot be
 * built leaves no actor behind it. See docs/importer/DECISIONS.md, "A map
 * and what stands on it are world documents, owned by nobody".
 *
 * @returns {Promise<{actors: Map<string, Actor>, queued: Map<object, {id: string, _id: string}[]>,
 *   worldIds: Map<string, string>, missing: string[], known: Set<string>,
 *   shelf: Map<string, {collection: object, _id: string, faction: boolean, flag: object}>,
 *   restamp: Map<Actor, object>}>}
 *   `restamp`: world copies found by their library document's id whose stamp
 *   predates it, each with the stamp to take
 */
async function planCrossing(bookId, cookbookIds) {
  const flagOf = (row) => row?.flags?.[MODULE_ID]?.cookbook ?? {};
  const shelf = new Map();
  for (const collection of ourPacksOfType("Actor")) {
    const index = await collection
      .getIndex({ fields: ["type", ...["id", "kind", "book", "merged"].map((k) => `flags.${MODULE_ID}.cookbook.${k}`)] })
      .catch(() => null);
    for (const row of index ?? []) {
      const flag = flagOf(row);
      // A place another book took over answers for its merged ids too.
      for (const id of claimIds(flag)) {
        if (!shelf.has(id)) shelf.set(id, { collection, _id: row._id, faction: flag.kind === "kind.faction" && flag.book === bookId, flag });
      }
    }
  }
  const wanted = new Set(cookbookIds);
  for (const [id, row] of shelf) if (row.faction) wanted.add(id);

  const actors = new Map();
  for (const actor of game.actors) {
    for (const id of claimIds(actor.getFlag(MODULE_ID, "cookbook"))) if (wanted.has(id) && !actors.has(id)) actors.set(id, actor);
  }
  const worldIds = new Map();
  const queued = new Map();
  const missing = [];
  const restamp = new Map();
  for (const id of wanted) {
    const row = shelf.get(id);
    let held = actors.get(id);
    // A world copy keeps its library document's id, and its stamp from the day
    // it was copied: one made before its place joined another book's is that
    // place's copy all the same, and is restamped rather than copied twice.
    const twin = !held && row ? game.actors.get(row._id) : null;
    if (twin && isWorldCopy(twin)) {
      held = twin;
      actors.set(id, twin);
      restamp.set(twin, row.flag);
    }
    if (row) worldIds.set(row._id, held?.id ?? row._id);
    if (held) continue;
    if (!row) missing.push(id);
    else if (queued.has(row.collection)) queued.get(row.collection).push({ id, _id: row._id });
    else queued.set(row.collection, [{ id, _id: row._id }]);
  }
  const known = new Set([...wanted].filter((id) => actors.has(id) || shelf.has(id)));
  return { actors, queued, worldIds, missing: missing.filter((id) => cookbookIds.includes(id)), known, shelf, restamp };
}

/**
 * Carry out a crossing plan, and answer with the world's document for every
 * cookbook id the plan knew. What only the library holds is created again
 * from its source (`worldCopySource`), keeping its id so references between
 * the copies can be rewritten before any of them exists. See
 * docs/importer/DECISIONS.md, "A map and what stands on it are world
 * documents, owned by nobody".
 *
 * @param {{actors: string[], folders: string[]}} created collects the uuid of everything made
 * @returns {Promise<{actors: Map<string, Actor>, copied: number}>}
 */
async function bringAcross(bookId, plan, created) {
  const { actors, queued, worldIds, restamp = new Map() } = plan;
  for (const [copy, flag] of restamp) {
    await copy.update({
      [`flags.${MODULE_ID}.cookbook.id`]: flag.id,
      [`flags.${MODULE_ID}.cookbook.book`]: flag.book,
      [`flags.${MODULE_ID}.cookbook.merged`]: flag.merged ?? [],
    });
  }
  const sources = [];
  const label = bookLabel(bookId);
  const folders = new Map();
  const folderFor = async (name) => {
    if (!folders.has(name)) folders.set(name, (await ensureWorldFolderPath("Actor", [label, name], created.folders))?.id ?? null);
    return folders.get(name);
  };
  for (const [collection, rows] of queued) {
    const docs = await collection.getDocuments({ _id__in: rows.map((r) => r._id) });
    for (const doc of docs) {
      const folderId = await folderFor(doc.type === FACTION_TYPE ? "Factions" : "Places");
      // Owned by nobody — see docs/importer/DECISIONS.md, "A map and what
      // stands on it are world documents, owned by nobody".
      sources.push(game.actors.fromCompendium(
        worldCopySource(doc.toObject(), worldIds, { folderId, sourceUuid: doc.uuid }),
        { keepId: true, clearOwnership: false },
      ));
    }
  }
  let copied = 0;
  for (let i = 0; i < sources.length; i += WRITE_CHUNK) {
    const made = await Actor.createDocuments(sources.slice(i, i + WRITE_CHUNK), { keepId: true });
    for (const actor of made ?? []) {
      const ids = claimIds(actor?.getFlag(MODULE_ID, "cookbook"));
      if (!ids.length) continue;
      for (const id of ids) actors.set(id, actor);
      created.actors.push(actor.uuid);
      copied++;
    }
  }
  return { actors, copied };
}

/**
 * Items a book introduces (`kind.adventureItem`): each becomes a core item
 * whose name and description are the page's own, filed under the book's
 * folder in its line's Item pack, read beside its prose for the place it is
 * worn, its price and its magic mark (`adventureItemData`). `books` narrows
 * the run to the open books it names; without it every open book's items are
 * imported; `only` narrows it to a set of ids. An item the world holds is
 * passed as already present, and written over in place where a `repair`
 * tally is given (`REPAIR.adventureItem`: the slot, the mark and the cost are
 * rewritten, a description a Judge wrote and the quantity stay), which is
 * how a held item without that shape takes it. Quiet when no open book prints any, since the step runs in every
 * Import Everything.
 * @returns {Promise<{made: number, already: number, refused: number, created: {items: string[]}}>}
 */
export async function cookbookImportAdventureItems({ books = null, only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = books ? new Set(books) : null;
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!wanted || wanted.has(b)));
  const jobs = [];
  for (const bookId of openBooks) {
    for (const [id, entry] of Object.entries(data.books.get(bookId).entries ?? {})) {
      if (entry.kind === "kind.adventureItem" && (!only || only.has(id))) jobs.push({ bookId, id, entry });
    }
  }
  const counts = { made: 0, already: 0, refused: 0, created: { items: [] } };
  if (!jobs.length) return counts;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAdventureItems`), jobs.length);
  try {
    for (const { bookId, id, entry } of jobs) {
      bar.step(entry.name);
      const have = await importedItem(id);
      if (have) {
        counts.already++;
        if (unrepaired(repair, have)) {
          countRepair(repair, await repairFromEntry(have, id, (node) => adventureItemData(bookId, id, entry, node), REPAIR.adventureItem, repair));
        }
        continue;
      }
      const doc = await claimImport(id, () => importAdventureItem(bookId, id, entry)).catch((err) => {
        console.error(`${MODULE_ID} | item ${id} failed`, err);
        return null;
      });
      if (doc) {
        counts.made++;
        counts.created.items.push(doc.uuid);
      } else counts.refused++;
    }
  } finally {
    bar.finish();
  }
  ui.notifications[counts.refused ? "warn" : "info"](
    `${MODULE_ID} | items: ${counts.made} imported, ${counts.already} already present${repair ? ", repaired in place" : ""}${counts.refused ? `, ${counts.refused} refused (the page did not match the cookbook)` : ""}.`,
  );
  return counts;
}

/**
 * The creation data of one book item, from its executed page: a core item
 * carrying the printed name and the prose under it, declaring the place its
 * paragraph says it is worn (`flags.acks-extras.gear.slots`, which makes it
 * wearable on every sheet), priced from its cost line, and marked magic where
 * the paragraph states a crafting time (`adventure-item-binding.mjs`). What it
 * grants stays prose. `folder` is the created item's; a repair writes none.
 * Exported for the offline suite; Foundry-free.
 */
export function adventureItemData(bookId, id, entry, node, folder = null) {
  const shape = adventureItemShape((node.fields?.description ?? []).map((p) => p.text ?? "").join(" "));
  const flags = { cookbook: { id, book: bookId, kind: entry.kind, cite: entry.cite } };
  if (shape.slot) flags.gear = { slots: [shape.slot] };
  if (shape.magic) flags.markets = { magic: true };
  return {
    // The row ships an ordinal label; the item is named from the page.
    name: printedNameOf(node, entry.name),
    type: "item",
    img: DEFAULT_IMG.ITEM,
    folder,
    system: { description: entryText(node, id, entry.cite), subtype: "item", quantity: { value: 1, max: 0 }, cost: shape.cost ?? 0, weight: 0, weight6: 0 },
    flags: { [MODULE_ID]: flags },
  };
}

/** One book item created from its page (`adventureItemData`), or null when the page did not match. */
async function importAdventureItem(bookId, id, entry) {
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const folder = (await targetFolder("Item", bookId, "Items"))?.id ?? null;
  return createDoc(Item, adventureItemData(bookId, id, entry, node, folder));
}

/** How many times one map steps its bar: the anchor, the plan, the picture, the scene. */
const SCENE_STEPS = 4;

/**
 * Maps: a book's scene recipes, stood up as WORLD scenes. A recipe is
 * geometry over one page of the seat's own book (`scene-binding.mjs`): the
 * picture is cut from that page and turned upright, each quarter becomes a
 * District region over the quarter's place, each keyed place a token of its
 * own actor. Nothing is drawn until the page answers to the recipe's anchor.
 * A scene the world already holds under the recipe's id keeps its shape; only
 * its links are repaired (`repairHeldMap`). See docs/importer/DECISIONS.md,
 * "A printed map is a recipe of geometry over its page" and "A map and what
 * stands on it are world documents, owned by nobody". A region map (a recipe
 * with a `grid` and no quarters) is built on Foundry's lattice of its drawn
 * cells. The maps reach the library in their book's Adventure, written by the
 * adventures step (`cookbookImportAdventures`).
 *
 * Zones follow the maps (`ensureZone`): each open book's zone rows are laid
 * over whichever map they name, made this run or held from an earlier one.
 * `books` narrows the run to the open books it names; without it every open
 * book's maps are built. With no map to build, a run so narrowed or `quiet`
 * (one step of a batch) resolves null with no notice.
 */
export async function cookbookImportScenes({ books = null, quiet = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates scenes).`);
  const wanted = books ? new Set(books) : null;
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b) && (!wanted || wanted.has(b)));
  const jobs = [];
  const zoneJobs = [];
  for (const bookId of openBooks) {
    for (const [id, row] of Object.entries(data.books.get(bookId).scenes ?? {})) {
      if (isSceneRecipe(row)) jobs.push({ bookId, id, row });
      else if (isZoneRow(row)) zoneJobs.push({ bookId, id, row });
    }
  }
  if (!jobs.length && !zoneJobs.length) {
    if (quiet || books) return null;
    const carriers = [...data.books.keys()]
      .filter((b) => Object.keys(data.books.get(b).scenes ?? {}).length)
      .map((b) => BOOKS[b]?.label ?? b.toUpperCase());
    return ui.notifications.warn(`${MODULE_ID} | no map in any open book — connect ${carriers.join(" or ") || "a book that has one"} first.`);
  }
  // `created` names every world document the run made, by uuid: the counts
  // say what happened, and the uuids are what a caller can undo it by.
  const counts = {
    made: 0, already: 0, repaired: 0, refused: 0, unready: 0, copied: 0, missing: 0, regions: 0, tokens: 0, controlled: 0,
    gridRefused: 0, zones: 0, zonesHeld: 0, zonesWaiting: 0, zonesRefused: 0, walls: 0, wallsFailed: 0,
    ...linkCounts(),
    created: { scenes: [], actors: [], folders: [], regions: [] },
  };
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressScenes`), jobs.length * SCENE_STEPS + zoneJobs.length);
  try {
    for (const job of jobs) {
      let stepped = 0;
      const tick = () => {
        stepped++;
        bar.step(job.row.name);
      };
      await importScene(job, counts, tick).catch((err) => {
        counts.refused++;
        console.error(`${MODULE_ID} | map ${job.id} failed`, err);
      });
      // A map that stopped early still took its whole share of the bar.
      while (stepped < SCENE_STEPS) tick();
    }
    for (const job of zoneJobs) {
      bar.step(job.row.name);
      await ensureZone(job, counts).catch((err) => {
        counts.zonesRefused++;
        console.error(`${MODULE_ID} | zone ${job.id} failed`, err);
      });
    }
    // Every map this run could make exists now, so every link can be joined.
    await joinLinks(counts);
  } finally {
    bar.finish();
  }
  const said = (key, n) => (n ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, { n }) : "");
  const parts = [
    `${counts.made} map(s) created`,
    counts.already ? `${counts.already} already held` : "",
    said("scenesGridRefused", counts.gridRefused),
    said("scenesWalls", counts.walls),
    said("scenesWallsFailed", counts.wallsFailed),
    said("scenesZonesMade", counts.zones),
    said("scenesZonesHeld", counts.zonesHeld),
    said("scenesZonesWaiting", counts.zonesWaiting),
    said("scenesZonesRefused", counts.zonesRefused),
    ...linkParts(counts),
    counts.repaired ? game.i18n.format(`${LANG_PREFIX}.ui.scenesRepaired`, { n: counts.repaired }) : "",
    counts.made ? `${counts.regions} quarter(s), ${counts.tokens} place(s) set down hidden` : "",
    counts.copied ? `${counts.copied} place(s) and organisation(s) brought into the world` : "",
    counts.controlled ? `${counts.controlled} organisation(s) given their quarters` : "",
    counts.missing ? `${counts.missing} place(s) not yet imported` : "",
    counts.unready ? `${counts.unready} waiting on the points of interest step` : "",
    counts.refused ? `${counts.refused} refused (the page did not match the cookbook, or would not render)` : "",
  ].filter(Boolean);
  const landed = counts.made || counts.already || counts.zones || counts.zonesHeld || counts.links || counts.linksHeld;
  const say = landed && !counts.gridRefused && !counts.wallsFailed && !counts.linksRefused ? "info" : "warn";
  ui.notifications[say](`${MODULE_ID} | maps: ${parts.join(", ")}.`);
  return counts;
}

/**
 * The cookbook ids a map stands on. A settlement's: the place the map is (the
 * recipe's `place`, else the book's own), each quarter's, each keyed place's,
 * and in `all` every place a keyed one sits in, up to the book's own.
 * A region's: the region's own place, no
 * quarters, for each placed site the id its text was claimed under
 * (`regionSiteClaim`), and in `all` every place a keyed one sits in, as on a
 * settlement's. `placeIds` runs index for index with the recipe's `places`.
 * @returns {{mapPlaceId: string, districtIds: string[], placeIds: string[], all: string[], region: boolean}}
 */
function mapIds(bookId, recipe) {
  const cb = data.books.get(bookId);
  if (isRegionRecipe(recipe)) {
    const mapPlaceId = regionPlaceId(bookId);
    const placeIds = (recipe.places ?? []).map((p) => {
      const entry = cb.entries[p.id];
      return isRegionSite(entry) ? regionSiteClaim(bookId, entry, p.id, cb.entries).claimId : p.id;
    });
    const all = [...new Set([mapPlaceId, ...placeIds, ...keyedAbove(cb, bookId, placeIds)])];
    return { mapPlaceId, districtIds: [], placeIds, all, region: true };
  }
  const mapPlaceId = recipe.place ?? adventurePlaceId(bookId);
  const districtIds = quarterPlaceIds(bookId, recipe);
  const placeIds = (recipe.places ?? []).map((p) => p.id);
  const all = [...new Set([mapPlaceId, ...districtIds, ...placeIds, ...keyedAbove(cb, bookId, [mapPlaceId, ...placeIds])])];
  return { mapPlaceId, districtIds, placeIds, all, region: false };
}

/**
 * Every place a keyed one of `starts` sits in, up to the book's own, so the
 * world's copies sit in one another and none in the library.
 */
function keyedAbove(cb, bookId, starts) {
  const spaces = keySpacesOf(cb.entries);
  const above = new Set();
  for (const start of starts) {
    for (let at = start; isKeyedPlace(cb.entries[at], at, spaces) && !above.has(keyedParentId(cb.entries[at], bookId));) {
      at = keyedParentId(cb.entries[at], bookId);
      above.add(at);
    }
  }
  return above;
}

/** Whether a book prints a region's gazetteer, which its map waits on as a city's waits on its quarters. */
const hasRegionRows = (bookId) => Object.values(data.books.get(bookId)?.entries ?? {}).some((e) => isRegionSite(e) || isRegionOverview(e));

/**
 * A frame whose points land on the scene's canvas: `toScene` plus the
 * picture's origin there, which a padded or shifted scene moves off zero.
 */
const placedFrame = (frame, origin) => (origin && (origin.x || origin.y)
  ? {
    ...frame,
    toScene: (x, y) => {
      const [u, v] = frame.toScene(x, y);
      return [u + origin.x, v + origin.y];
    },
  }
  : frame);

/**
 * How a grid recipe's scene is laid: the scale, the picture's frame, the
 * lattice shift and where the picture's corner then sits on the canvas, or
 * null when Foundry's cell cannot be fitted to the drawn one or the shifted
 * picture would not lie whole on the canvas. Asked of an UNSAVED scene, cloned
 * at `GRID_SCENE_PADDING` (the padding `sceneData` writes), so nothing is
 * written to find out.
 *
 * The scale is `gridScale` over `hexProbe`'s measured cell (a square lattice
 * needs no probe; a hex probe that cannot answer refuses). The shift is
 * `hexAlignment`'s, solved for the recipe's drawn centre carried through the
 * frame and set on the clone's padded origin. The picture is then held to the
 * canvas core sizes round it, to a pixel, so a padding core rounds away
 * refuses the map rather than cutting its edge off.
 *
 * @param {object} recipe a compiled scene recipe with a `grid`
 * @param {Scene} scene an unsaved Scene document
 * @returns {{pixelsPerPoint: number, frame: object, type: number, shiftX: number, shiftY: number,
 *   origin: {x: number, y: number}, canvas: {width: number, height: number}}|null}
 *   `canvas` is the padded canvas's size
 */
export function gridScenePlan(recipe, scene) {
  const { family, even = false, centre } = recipe?.grid ?? {};
  const type = gridTypeFor(family, !!even);
  if (type === null || !Array.isArray(centre)) return null;
  const probe = family === "square" ? null : hexProbe(scene, family, !!even);
  if (family !== "square" && !probe) return null;
  const pixelsPerPoint = gridScale(recipe, probe);
  if (!(pixelsPerPoint > 0)) return null;
  const frame = sceneFrame(recipe, { pixelsPerPoint });
  const [cx, cy] = frame.toScene(centre[0], centre[1]);
  let canvas = null;
  const padded = scene.clone({ padding: GRID_SCENE_PADDING }, { keepId: true });
  const shift = hexAlignment(padded, {
    width: frame.width, height: frame.height, gridSize: frame.gridPixels, type,
    point: (dims) => {
      canvas = { x: dims.sceneX, y: dims.sceneY, width: dims.width, height: dims.height };
      return { x: dims.sceneX + cx, y: dims.sceneY + cy };
    },
  });
  if (!shift || !canvas) return null;
  // The clone's origin is the unshifted one; a shift moves the picture back by itself.
  const origin = { x: canvas.x - shift.shiftX, y: canvas.y - shift.shiftY };
  const onCanvas = origin.x >= -1 && origin.y >= -1
    && origin.x + frame.width <= canvas.width + 1 && origin.y + frame.height <= canvas.height + 1;
  return onCanvas ? { pixelsPerPoint, frame, type, ...shift, origin, canvas: { width: canvas.width, height: canvas.height } } : null;
}

/**
 * One map's creation data (`sceneData`) over whatever stands for its actors
 * and lists: the world's own documents when the map is stood up, stand-ins
 * built from an Adventure's sources when the Adventure is. Each region is
 * named for its quarter and linked to it, each keyed place's token stands
 * hidden at its point, and the city's list rides in the battlemap flag. The
 * list's after-dark shift and deferred band, and each quarter's special
 * list's own shift, are read from the imported lists here, so no figure
 * ships (docs/importer/DECISIONS.md, "A printed map is a recipe of geometry
 * over its page").
 *
 * A grid recipe is handed its `gridScenePlan`: the picture is framed at the
 * plan's scale, everything set down on it is moved to the picture's corner,
 * the lattice and shift ride into `sceneData`, and the scale is kept in the
 * cookbook flag (`pixelsPerPoint`) so a zone laid later frames the same
 * picture. Without a plan the data is exactly a settlement map's. A recipe's
 * `travel` is the travel system the map declares. Exported so the offline
 * suite can build both.
 *
 * @param {object} p
 * @param {Map<string, object>} p.actors cookbook id to an Actor-like (`name`, `uuid`, `getTokenDocument`)
 * @param {(cookbookId: string) => Promise<{uuid: string, results: object[], formula: string}|null>} p.tableOf
 * @param {{mapPlaceId: string, districtIds: string[], placeIds: string[]}} p.ids `mapIds`
 * @param {object|null} [p.grid] `gridScenePlan` of a grid recipe
 * @param {{c: number[], door: number, terrain?: true}[]|null} [p.walls] traced walls in page
 *   points (`traceWalls`), carried through the same placed frame as the rest;
 *   a plan of storeys' (`traceStoreys`) each stand on their storey's level
 * @param {string[]} [p.storeys] uploaded pictures of the storeys above the
 *   first (`storeyCrops`), bottom up; each storey is named by its number
 */
export async function mapCreateData({ bookId, id, recipe, ids, actors, tableOf, src, folderId, fallbackName, grid = null, walls = null, storeys = [] }) {
  const list = recipe.incidents?.table ? await tableOf(recipe.incidents.table) : null;
  const incidents = list
    ? {
      tableUuid: list.uuid,
      afterDark: listAfterDark(list),
      band: bandOfSection(recipe.incidents.band),
    }
    : null;
  const city = actors.get(ids.mapPlaceId) ?? null;
  const frame = placedFrame(grid ? sceneFrame(recipe, { pixelsPerPoint: grid.pixelsPerPoint }) : sceneFrame(recipe), grid?.origin);
  const regions = [];
  for (const [i, district] of (recipe.districts ?? []).entries()) {
    const place = actors.get(ids.districtIds[i]) ?? null;
    const special = district.special ? await tableOf(district.special) : null;
    regions.push(districtRegionData(district, frame, {
      name: place?.name ?? game.i18n.format(`${LANG_PREFIX}.ui.sceneQuarter`, { n: i + 1 }),
      districtType: DISTRICT_TYPE,
      specialTableUuid: special?.uuid ?? "",
      specialAfterDark: special ? listAfterDark(special) : 0,
      locationUuid: place?.uuid ?? "",
    }));
  }
  const tokens = [];
  for (const [k, spot] of (recipe.places ?? []).entries()) {
    const actor = actors.get(ids.placeIds?.[k] ?? spot.id);
    if (!actor) continue;
    tokens.push((await actor.getTokenDocument({ ...placeTokenAt(spot.at, frame), hidden: true })).toObject());
  }
  const storeyName = (n) => game.i18n.format(`${LANG_PREFIX}.ui.sceneStorey`, { n });
  const level = {
    id: Scene.metadata.defaultLevelId,
    name: storeys.length ? storeyName(1) : game.i18n.localize(foundry.documents.Level.metadata.label),
  };
  const wallData = wallSources(walls, frame, storeys.length ? [level.id, ...storeys.map((_, i) => storeyLevelId(i + 1))] : null);
  const mapSystem = recipe.travel ?? null;
  const indoorName = game.i18n.localize(`${LANG_PREFIX}.ui.sceneIndoors`);
  if (!grid) {
    return sceneData({
      id, book: bookId, name: city?.name ?? fallbackName, recipe, src, incidents, folderId,
      locationUuid: city?.uuid ?? "",
      level,
      regions, tokens, walls: wallData, mapSystem, indoorName,
    });
  }
  const made = sceneData({
    id, book: bookId, name: city?.name ?? fallbackName, recipe, src, incidents, folderId,
    locationUuid: city?.uuid ?? "",
    level,
    regions, tokens, walls: wallData, mapSystem, indoorName, canvas: grid.canvas,
    grid: recipe.grid, pixelsPerPoint: grid.pixelsPerPoint, shiftX: grid.shiftX, shiftY: grid.shiftY,
    storeys: storeys.map((path, i) => ({ src: path, name: storeyName(i + 2) })),
  });
  made.flags[MODULE_ID].cookbook.pixelsPerPoint = grid.pixelsPerPoint;
  return made;
}

/** Whether a uuid still names a document this world can reach. */
function reachable(uuid) {
  try {
    return !!uuid && !!fromUuidSync(uuid);
  } catch {
    return false;
  }
}

/**
 * A held map's LINKS brought up to the recipe, and nothing else of it: the
 * city list is named again where the map names none or names one that is
 * gone, each quarter's special list likewise, and a quarter's special
 * after-dark figure is filled where it was never stated. A rebuilt roll-table
 * shelf mints new ids, which is what leaves a map naming lists that no longer
 * exist. What the Judge drew, moved or typed is not read. See
 * docs/importer/DECISIONS.md, "A held map has its links repaired, never its
 * shape". Exported so a live check can run it on a map of its own.
 * @returns {Promise<number>} how many documents were written to
 */
export async function repairHeldMap(recipe, scene) {
  let written = 0;
  // The travel system is a link too, when the importer minted it: a map step
  // that wrote no declaration left `journey` on a gridded plan and
  // `settlement` on an ungridded one, and a party arriving on a dungeon level
  // so marked keeps the journey's clock. The value is brought to the recipe
  // only while it still reads as that default; any other value is the Judge's
  // declaration and is never read.
  const minted = recipe.grid ? "journey" : "settlement";
  if (recipe.travel && recipe.travel !== minted && sceneTravelSystem(scene) === minted) {
    await writeSceneSetup(scene, { mapSystem: recipe.travel });
    written++;
  }
  if (recipe.incidents?.table && !reachable(sceneIncidents(scene)?.tableUuid)) {
    const list = await importedTable(recipe.incidents.table);
    if (list) {
      const band = bandOfSection(recipe.incidents.band);
      await writeSceneIncidents(scene, {
        tableUuid: list.uuid, afterDark: listAfterDark(list), bandFrom: band?.from ?? "", bandTo: band?.to ?? "",
      });
      written++;
    }
  }
  for (const district of recipe.districts ?? []) {
    if (!district.special) continue;
    const region = scene.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.place === district.place);
    const behavior = region?.behaviors.find((b) => b.type === DISTRICT_TYPE);
    if (!behavior) continue;
    const held = behavior.system;
    const patch = {};
    if (!reachable(held.specialTableUuid)) {
      const special = await importedTable(district.special);
      if (!special) continue;
      patch["system.specialTableUuid"] = special.uuid;
      patch["system.specialAfterDark"] = listAfterDark(special);
    } else if (held.specialAfterDark == null) {
      const special = await fromUuid(held.specialTableUuid).catch(() => null);
      if (!special) continue;
      patch["system.specialAfterDark"] = listAfterDark(special);
    } else continue;
    await behavior.update(patch);
    written++;
  }
  for (const region of scene.regions ?? []) {
    if (await repairZoneLink(region)) written++;
  }
  return written;
}

/**
 * The encounter-zone behaviour type a zone's Region carries; formation
 * registers it as `ENCOUNTER_ZONE_TYPE` (`encounter-zone.mjs`, which needs
 * Foundry at load and so is not imported here).
 */
const ZONE_BEHAVIOR_TYPE = `${MODULE_ID}.encounterZone`;

/** The zone id a Region was laid for, or "" for any other Region. */
const zoneIdOf = (region) => String(region?.getFlag?.(MODULE_ID, "cookbook")?.zone ?? "");

/** A zone row by its cookbook id, in whichever book carries it, or null. */
function zoneRowById(zoneId, book = null) {
  const own = data.books.get(bookOfCookbookId(zoneId, book))?.scenes?.[zoneId];
  if (isZoneRow(own)) return own;
  for (const cb of data.books.values()) if (isZoneRow(cb.scenes?.[zoneId])) return cb.scenes[zoneId];
  return null;
}

/** A scene recipe by its cookbook id, in whichever book carries it, or null. */
function recipeById(sceneId) {
  const own = data.books.get(bookOfCookbookId(sceneId))?.scenes?.[sceneId];
  if (isSceneRecipe(own)) return own.scene;
  for (const cb of data.books.values()) if (isSceneRecipe(cb.scenes?.[sceneId])) return cb.scenes[sceneId].scene;
  return null;
}

/**
 * A zone Region's list named again where it names none or one that is gone,
 * as a held map's other links are (`repairHeldMap`). Any other Region, and a
 * zone whose row names no list or whose list the world does not hold yet, is
 * left alone.
 * @returns {Promise<boolean>} whether the behaviour was written to
 */
async function repairZoneLink(region) {
  const zoneId = zoneIdOf(region);
  if (!zoneId) return false;
  const behavior = region.behaviors?.find((b) => b.type === ZONE_BEHAVIOR_TYPE);
  if (!behavior || reachable(behavior.system?.tableUuid)) return false;
  const table = zoneRowById(zoneId, region.getFlag(MODULE_ID, "cookbook")?.book)?.zone?.table;
  const list = table ? await importedTable(table) : null;
  if (!list) return false;
  await behavior.update({ "system.tableUuid": list.uuid });
  return true;
}

/** One recipe, from anchor to scene. Counts into `counts`; calls `tick` once per stage it reaches. */
async function importScene({ bookId, id, row }, counts, tick) {
  const recipe = row.scene;
  const region = isRegionRecipe(recipe);
  tick();
  const held = game.scenes.find((s) => s.getFlag(MODULE_ID, "cookbook")?.id === id);
  if (held) {
    counts.already++;
    counts.repaired += await repairHeldMap(recipe, held);
    return;
  }
  const doc = ctx.sessionDocs.get(bookId).doc;
  const placements = await pageArtPlacements(doc, recipe.page).catch(() => []);
  if (!placementMatches(placements, recipe.placement)) return void counts.refused++;

  // Nothing is written until the picture exists.
  tick();
  const ids = mapIds(bookId, recipe);
  const plan = await planCrossing(bookId, ids.all);
  if (ids.districtIds.length && !ids.districtIds.some((d) => plan.known.has(d))) return void counts.unready++;
  if (region && hasRegionRows(bookId) && !plan.known.has(ids.mapPlaceId)) return void counts.unready++;
  // A grid's scale and shift are solved on an unsaved scene, before the
  // picture is cut at that scale.
  const grid = recipe.grid ? gridScenePlan(recipe, new Scene({ name: row.name })) : null;
  if (recipe.grid && !grid) return void counts.gridRefused++;

  tick();
  const up = await ctx.uploadSceneMap(doc, id, recipe, { pixelsPerPoint: grid?.pixelsPerPoint });
  if (!up) return void counts.refused++;
  const storeys = [];
  for (const crop of storeyCrops(recipe)) {
    const above = await ctx.uploadSceneMap(doc, id, { ...recipe, crop }, { pixelsPerPoint: grid?.pixelsPerPoint });
    if (!above) return void counts.refused++;
    storeys.push(above.path);
  }
  const traced = recipe.walls ? await ctx.traceSceneWalls(doc, id, recipe) : null;
  if (recipe.walls && !traced) counts.wallsFailed++;

  tick();
  const world = await bringAcross(bookId, plan, counts.created);
  counts.copied += world.copied;
  counts.missing += plan.missing.length;
  const folder = await ensureWorldFolderPath("Scene", [bookLabel(bookId)], counts.created.folders);
  // ONE create for the whole map (`sceneData` says why); the places' mirrors
  // are the only thing that has to wait for the documents they name.
  const scene = await Scene.create(await mapCreateData({
    bookId, id, recipe, ids, actors: world.actors, tableOf: importedTable, src: up.path, folderId: folder?.id ?? null,
    fallbackName: row.name, grid, walls: traced?.walls ?? null, storeys,
  }));
  if (!scene) return void counts.refused++;
  counts.made++;
  counts.created.scenes.push(scene.uuid);
  counts.regions += scene.regions.size;
  counts.tokens += scene.tokens.size;
  counts.walls += scene.walls.size;
  await mirrorCreatedLinks(scene);
  if (!region) counts.controlled += await claimControlledQuarters(bookId, scene, recipe, ids.districtIds);
  await ensureSceneThumb(scene);
}

/**
 * Where a held map's picture sits and how it is framed: the recipe's frame at
 * the scale the map was made at (the cookbook flag's `pixelsPerPoint`, else
 * measured again on the live scene for a grid recipe), carried to the
 * picture's corner on the canvas (`dimensions.sceneX/Y`, padding and shift
 * included).
 */
function liveFrame(recipe, scene) {
  let pixelsPerPoint = Number(scene.getFlag(MODULE_ID, "cookbook")?.pixelsPerPoint);
  if (!(pixelsPerPoint > 0) && recipe.grid) {
    const { family, even = false } = recipe.grid;
    pixelsPerPoint = gridScale(recipe, family === "square" ? null : hexProbe(scene, family, !!even));
  }
  const frame = pixelsPerPoint > 0 ? sceneFrame(recipe, { pixelsPerPoint }) : sceneFrame(recipe);
  const dims = scene.dimensions ?? scene.getDimensions?.() ?? {};
  return { placed: placedFrame(frame, { x: Number(dims.sceneX) || 0, y: Number(dims.sceneY) || 0 }), dims };
}

/**
 * Every cell of a live hex grid whose centre lies on the picture, with that
 * centre: core's `getOffsetRange` over the picture's rectangle, else the
 * grid's rows and columns. A square or gridless scene has none to snap to.
 * @returns {{i: number, j: number, x: number, y: number}[]}
 */
function pictureCells(scene, dims) {
  const grid = scene.grid;
  if (!grid?.isHexagonal || !grid.getCenterPoint) return [];
  const x = Number(dims.sceneX) || 0;
  const y = Number(dims.sceneY) || 0;
  const w = Number(dims.sceneWidth ?? scene.width) || 0;
  const h = Number(dims.sceneHeight ?? scene.height) || 0;
  const [i0, j0, i1, j1] = grid.getOffsetRange?.({ x, y, width: w, height: h }) ?? [0, 0, Number(dims.rows) || 0, Number(dims.columns) || 0];
  const cells = [];
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const c = grid.getCenterPoint({ i, j });
      if (c && c.x >= x && c.x <= x + w && c.y >= y && c.y <= y + h) cells.push({ i, j, x: c.x, y: c.y });
    }
  }
  return cells;
}

/**
 * A zone's printed figures, read from the ZONE's book through the executor:
 * its `zone.fields` are value instructions like any entry's, run as the one
 * entry of a view of that book's cookbook. Null when the book's cookbook is
 * not one the executor reads.
 * @returns {Promise<{target: number, every: number, dungeonLevel: number, dayThrows: number, nightThrows: number}|null>}
 */
async function zoneFigures(bookId, id, row) {
  const cb = data.books.get(bookId);
  const view = { ...cb, entries: { [id]: { kind: row.kind, name: row.name, cite: row.cite, pages: row.pages, fields: row.zone.fields ?? {} } } };
  const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, view, data.registers, id).catch(() => null);
  if (!node?.ok) return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const f = node.fields ?? {};
  return { target: num(f.target), every: num(f.every), dungeonLevel: num(f.dungeonLevel), dayThrows: num(f.dayThrows), nightThrows: num(f.nightThrows) };
}

/**
 * One zone row laid over its map as a Region carrying the encounter-zone
 * behaviour (`zoneRegionData`). Waits (counted) while the map it names is not
 * in the world; is held (counted, and its list relinked) when the map already
 * carries a Region flagged with its id. The figures are read from the zone's
 * own book; the list is the imported table, or blank until a later run
 * relinks it. On a hex map the outline is snapped to the live grid's cells
 * whose centres it holds, and a zone holding no cell is refused; on any other
 * map the outline is carried through the frame. Counts into `counts`.
 */
async function ensureZone({ bookId, id, row }, counts) {
  const zone = row.zone;
  const recipe = recipeById(zone.scene);
  const scene = recipe ? heldMapOf(zone.scene) : null;
  if (!scene) return void counts.zonesWaiting++;
  const held = (scene.regions ?? []).find((r) => zoneIdOf(r) === id);
  if (held) {
    if (await repairZoneLink(held)) counts.repaired++;
    return void counts.zonesHeld++;
  }
  const figures = await zoneFigures(bookId, id, row);
  if (!figures) return void counts.zonesRefused++;
  const list = zone.table ? await importedTable(zone.table) : null;
  const { placed, dims } = liveFrame(recipe, scene);
  const ring = ringToScene(zone.outline, placed);
  const cells = pictureCells(scene, dims);
  const hexes = cells.length ? offsetsInside(ring, cells) : [];
  if (cells.length && !hexes.length) return void counts.zonesRefused++;
  const n = Number(/(\d+)$/.exec(id)?.[1]) || 1;
  const name = game.i18n.format(`${LANG_PREFIX}.ui.sceneZone`, { n, book: BOOKS[bookId]?.short ?? bookId.toUpperCase() });
  const source = zoneRegionData(zone, placed, {
    name, tableUuid: list?.uuid ?? "", ...figures, hexes,
    cells: hexes.map((h) => scene.grid.getVertices({ i: h.i, j: h.j })), whole: coversCrop(zone.outline, recipe.crop), book: bookId, id,
  });
  const [made] = (await scene.createEmbeddedDocuments("Region", [source])) ?? [];
  if (!made) return void counts.zonesRefused++;
  counts.zones++;
  counts.created.regions.push(made.uuid);
}

/** A link Region's end key (`linkEndKey`), or "" for any other Region. */
const linkIdOf = (region) => String(region?.getFlag?.(MODULE_ID, "cookbook")?.link ?? "");

/** The link pass's counters, zeroed; `linksWaitingOn` collects the books whose maps a waiting link names. */
const linkCounts = () => ({ links: 0, linksHeld: 0, linksRepaired: 0, linksWaiting: 0, linksRefused: 0, linksWaitingOn: new Set() });

/** The link pass's phrases for a maps notification, empty ones left out. */
function linkParts(counts) {
  const said = (key, n, extra = {}) => (n ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, { n, ...extra }) : "");
  const books = [...counts.linksWaitingOn].map((b) => bookLabel(b)).join(", ");
  return [
    said("scenesLinksMade", counts.links),
    said("scenesLinksHeld", counts.linksHeld),
    said("scenesLinksRepaired", counts.linksRepaired),
    said("scenesLinksWaiting", counts.linksWaiting, { books }),
    said("scenesLinksRefused", counts.linksRefused),
  ];
}

/**
 * The level id storey `level` of a held map stands on: its levels by
 * elevation, the bottom first. Null on a map of one level, where a Region
 * naming no level is on its only one.
 */
function storeyLevelOf(scene, level) {
  const levels = [...(scene.levels ?? [])].sort((a, b) => (Number(a.elevation?.bottom) || 0) - (Number(b.elevation?.bottom) || 0));
  return levels.length > 1 ? (levels[Number(level) || 0]?.id ?? null) : null;
}

/** The level ids a link end's Region stands on: a level row's storeys, else its end's own storey. */
function linkEndLevels(slot) {
  const storeys = slot.mode === "level" ? [...slot.levels] : [slot.level];
  return storeys.map((l) => storeyLevelOf(slot.scene, l)).filter(Boolean);
}

/**
 * Every link end's Region name: the place it stands for as `placeName` names
 * it (this world's actor by default), else the first link's ordinal, and a
 * compass word, so that the ends a choice offers are told apart. Ends on one
 * map under one name are placed by thirds of the rectangle they span together,
 * since a map's places can all lie in one third of its picture; an end alone
 * under its name, by thirds of the picture.
 * @param {object[]} slots `linkSlots` ends, each with its `rect` and `dims`
 * @param {(cookbookId: string) => string|null|undefined} [placeName]
 * @returns {Map<object, string>} each slot's name
 */
function linkEndNames(slots, placeName = (id) => game.actors.find((a) => cookbookId(a) === id)?.name) {
  const nameOf = (slot) => {
    const place = slot.place ? placeName(slot.place) : null;
    const n = Number(/(\d+)$/.exec([...slot.links][0] ?? "")?.[1]) || 1;
    return place || game.i18n.format(`${LANG_PREFIX}.ui.sceneLink`, { n });
  };
  const groups = new Map();
  for (const slot of slots) {
    const key = `${slot.scene.id}|${nameOf(slot)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }
  const names = new Map();
  for (const group of groups.values()) {
    const { dims } = group[0];
    const picture = { x: Number(dims.sceneX) || 0, y: Number(dims.sceneY) || 0, width: Number(dims.sceneWidth) || 0, height: Number(dims.sceneHeight) || 0 };
    const area = group.length > 1 ? spanOf(group.map((slot) => slot.rect)) : picture;
    for (const slot of group) {
      const way = game.i18n.localize(`${LANG_PREFIX}.ui.compass.${compassOf(slot.rect, area)}`);
      names.set(slot, game.i18n.format(`${LANG_PREFIX}.ui.sceneLinkEnd`, { name: nameOf(slot), way }));
    }
  }
  return names;
}

/**
 * Every cookbook's link rows gathered into their ends, one per end key however
 * many rows name it, each on the map `mapOf` gives for its scene id. A
 * `teleport` end leads to every other end of each row naming it (from the
 * first end only where the row says `both: false`) and asks where a row says
 * `confirm`; a `level` row is one end over its storeys. A row with an end
 * `mapOf` has no map for waits, and one naming a map no cookbook carries is
 * refused, each counted into `counts` when it is given.
 * @param {(sceneId: string) => object|null} mapOf the Scene an end stands on
 * @param {object|null} [counts] `linkCounts`
 * @returns {Map<string, object>} the ends by `linkEndKey`
 */
function linkSlots(mapOf, counts = null) {
  const ends = new Map();
  const slotFor = (key, init) => {
    if (!ends.has(key)) ends.set(key, { key, dests: new Set(), links: new Set(), levels: new Set(), asks: false, ...init });
    return ends.get(key);
  };
  for (const [bookId, cb] of data.books) {
    for (const [id, row] of Object.entries(cb.scenes ?? {})) {
      if (!isLinkRow(row)) continue;
      const link = row.link;
      const resolved = link.ends.map((end) => {
        const recipe = recipeById(end.scene);
        const level = Number(end.level) || 0;
        return { end, level, recipe, scene: recipe ? mapOf(end.scene) : null, box: recipe ? linkBoxOnFirstStorey(end.box, recipe, level) : null };
      });
      if (resolved.some((r) => !r.recipe || !r.box)) {
        if (counts) counts.linksRefused++;
        continue;
      }
      if (resolved.some((r) => !r.scene)) {
        if (counts) {
          counts.linksWaiting++;
          for (const r of resolved) if (!r.scene) counts.linksWaitingOn.add(bookOfCookbookId(r.end.scene));
        }
        continue;
      }
      const at = (r, key, mode) => {
        const slot = slotFor(key, { mode, sceneId: r.end.scene, scene: r.scene, recipe: r.recipe, box: r.box, level: r.level, book: bookId });
        slot.links.add(id);
        slot.place ??= r.end.place;
        return slot;
      };
      if (link.mode === "level") {
        const slot = at(resolved[0], linkEndKey(resolved[0].end.scene, resolved[0].box), "level");
        for (const r of resolved) slot.levels.add(r.level);
        continue;
      }
      const keys = resolved.map((r) => at(r, linkEndKey(r.end.scene, r.box, r.level), "teleport").key);
      for (const from of link.both === false ? keys.slice(0, 1) : keys) {
        const slot = ends.get(from);
        for (const to of keys) if (to !== from) slot.dests.add(to);
        if (link.confirm) slot.asks = true;
      }
    }
  }
  return ends;
}

/**
 * Each link end's rectangle on the map it stands on and that map's dimensions,
 * set on the slot, then every slot's Region name (`linkEndNames`).
 * @returns {Map<object, string>}
 */
function placeLinkEnds(ends, placeName) {
  for (const slot of ends.values()) {
    const { placed, dims } = liveFrame(slot.recipe, slot.scene);
    Object.assign(slot, { rect: linkRect(slot.box, placed), dims });
  }
  return linkEndNames([...ends.values()], placeName);
}

/**
 * A new link end's Region source: it asks where a row says so, where it leads
 * to several, or where it stands on a region's map, so a journey crossing the
 * hex is not diverted.
 */
const linkEndRegion = (slot, name) => linkRegionData({
  name, rect: slot.rect, levels: linkEndLevels(slot), mode: slot.mode,
  choice: slot.asks || slot.dests.size > 1 || isRegionRecipe(slot.recipe), end: slot.key, links: [...slot.links], book: slot.book,
});

/**
 * Every cookbook's link rows joined on the maps the world holds
 * (`linkSlots`): one Region per distinct end. A row waits, counted with the
 * books it waits on, until every map it names is held. Held Regions are kept:
 * their dead destinations are dropped and missing ones added, and a teleport
 * that came to lead to several is made to ask (`linkQuestion`). A destination
 * the Judge added stays, and a behaviour the Judge removed is not put back. No
 * book has to be open: a link is ids and boxes. Counts into `counts`. A recipe
 * the world holds as more than one import (`heldMapsOf`) is joined once per
 * import, each pass on the n-th import of every map: a twin's ends lead to
 * its own Regions, and a row waits on a twin only for a map that has none.
 * Waiting and refused rows are counted by the first pass alone.
 */
async function joinLinks(counts) {
  for (let n = 0; ; n++) {
    const ends = linkSlots(n ? (id) => heldMapsOf(id)[n] ?? null : heldMapOf, n ? null : counts);
    if (n && !ends.size) return;
    await joinEnds(ends, counts);
  }
}

/** One pass of the link join (`joinLinks`) over the ends of a set of maps, each end's Region held or made, then where each teleport leads. */
async function joinEnds(ends, counts) {
  // Every end's Region first, so each destination has a uuid to be named by.
  const names = placeLinkEnds(ends);
  for (const slot of ends.values()) {
    slot.region = (slot.scene.regions ?? []).find((r) => linkIdOf(r) === slot.key) ?? null;
    if (slot.region) {
      counts.linksHeld++;
      continue;
    }
    const [made] = (await slot.scene.createEmbeddedDocuments("Region", [linkEndRegion(slot, names.get(slot))])) ?? [];
    if (!made) {
      counts.linksRefused++;
      continue;
    }
    slot.region = made;
    slot.made = true;
    counts.links++;
    counts.created.regions.push(made.uuid);
  }

  // Then where each teleport leads.
  for (const slot of ends.values()) {
    if (slot.mode !== "teleport" || !slot.region) continue;
    const behavior = slot.region.behaviors?.find((b) => b.type === "teleportToken");
    if (!behavior) continue;
    // Core stores a destination relative to the behaviour, and reads it so.
    const named = [...(behavior.system?.destinations ?? [])];
    const live = named.map((uuid) => fromUuidSync(uuid, { relative: behavior })?.uuid).filter(Boolean);
    const wanted = [...slot.dests].map((key) => ends.get(key)?.region?.uuid).filter((uuid) => uuid && !live.includes(uuid));
    const destinations = [...live, ...wanted];
    const update = {};
    if (wanted.length || live.length !== named.length) update["system.destinations"] = destinations;
    // A Region is made before it has destinations, so its question is set
    // here, from where it leads.
    const { choice, revealed } = linkQuestion(behavior.system, destinations.length);
    if (choice && !behavior.system?.choice) update["system.choice"] = true;
    if (revealed !== (behavior.system?.dialog?.revealed ?? null)) update["system.dialog.revealed"] = revealed;
    if (!Object.keys(update).length) continue;
    await behavior.update(update);
    if (!slot.made) counts.linksRepaired++;
  }
}

/**
 * The link pass alone (`joinLinks`), as the map step runs it after its last
 * map: for a world whose maps are all made already, when a later book's
 * import gave a waiting link its other end, or after an Adventure's import,
 * which makes maps without it.
 * @param {object} [options]
 * @param {boolean} [options.quiet] notify only where a Region was made,
 *   repaired or refused
 * @returns {Promise<object|undefined>} the link counts, with `created.regions`
 *   naming each Region it made
 */
export async function cookbookImportLinks({ quiet = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates regions).`);
  const counts = { ...linkCounts(), created: { regions: [] } };
  await joinLinks(counts);
  if (quiet && !counts.links && !counts.linksRepaired && !counts.linksRefused) return counts;
  const parts = linkParts(counts).filter(Boolean);
  ui.notifications[counts.linksRefused ? "warn" : "info"](`${MODULE_ID} | maps: ${parts.join(", ") || game.i18n.format(`${LANG_PREFIX}.ui.scenesLinksMade`, { n: 0 })}.`);
  return counts;
}

/**
 * Every adventure book open on this seat, written to its line's Adventure
 * shelf as ONE Adventure (`ensureBookAdventure`), after every step that makes
 * what it carries. A book not open here is skipped: its maps' pictures are
 * checked against their pages. See docs/importer/DECISIONS.md, "A book is in
 * the library as one Adventure". `books` narrows the run to the open books
 * it names.
 * @returns {Promise<object|undefined>} the counts, with `created` naming each
 *   Adventure and shelf this run made
 */
export async function cookbookImportAdventures({ books: only = null, force = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (writes the library).`);
  const wanted = only ? new Set(only) : null;
  const books = Object.keys(BOOKS).filter((b) => bookIsJudges(b) && ctx.sessionDocs.has(b) && data.books.has(b) && (!wanted || wanted.has(b)));
  const counts = {
    written: 0, rebuilt: 0, kept: 0, held: 0, empty: 0, failed: 0,
    books: {}, created: { adventures: [], packs: [] },
  };
  if (!books.length) return counts;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAdventures`), books.length);
  try {
    for (const bookId of books) {
      bar.step(bookLabel(bookId));
      counts.books[bookId] = await ensureBookAdventure(bookId, counts, { force });
    }
  } finally {
    bar.finish();
  }
  const said = (key, n, extra = {}) => (n ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, { n, ...extra }) : "");
  const parts = [
    said("adventuresWritten", counts.written),
    said("adventuresRebuilt", counts.rebuilt),
    said("adventuresKept", counts.kept),
    said("adventuresHeld", counts.held),
    said("adventuresEmpty", counts.empty),
    said("adventuresFailed", counts.failed),
  ].filter(Boolean);
  ui.notifications[counts.failed ? "warn" : "info"](`${MODULE_ID} | adventures: ${parts.join(", ")}.`);
  return counts;
}

/**
 * One book's Adventure on its line's shelf, by `bookAdventureState`: written
 * when the shelf lacks it, kept when the Judge has edited it since its write,
 * rebuilt when what it is assembled from has changed, else held. A write
 * records its own time in the stamp (`writtenAt`), read back from the stored
 * document, which is what the next run tells an edit by. `force` rebuilds a held or Judge-edited Adventure too: the Judge asked for
 * it (`cookbookReimportAdventure`).
 * @returns {Promise<string>} what became of it: written, rebuilt, kept, held, empty or failed
 */
async function ensureBookAdventure(bookId, counts, { force = false } = {}) {
  try {
    const source = await bookAdventureSource(bookId);
    if (!source) {
      counts.empty++;
      return "empty";
    }
    const line = lineOf(bookId);
    const had = findLibraryPack(ADVENTURE_TYPE, line);
    const pack = had ?? (await ensureLibraryPack(ADVENTURE_TYPE, line));
    if (!pack) throw new Error("the compendium could not be opened");
    if (!had) counts.created.packs.push(pack.collection);
    const stored = pack.index.has(source._id) ? await pack.getDocument(source._id) : null;
    const state = bookAdventureState({
      stamp: stored ? (stored.flags?.[MODULE_ID]?.cookbook ?? {}) : null,
      modifiedTime: stored?._stats?.modifiedTime ?? null,
      sourcesHash: source.flags[MODULE_ID].cookbook.sourcesHash,
      force,
    });
    let outcome = state === "edited" ? "kept" : state;
    if (state === "absent" || state === "stale") {
      const doc = await writeAdventure(pack, source);
      if (!doc) throw new Error("the compendium refused the write");
      const writtenAt = Number(doc._stats?.modifiedTime) || Date.now();
      await doc.update({ [`flags.${MODULE_ID}.cookbook.writtenAt`]: writtenAt });
      outcome = state === "stale" ? "rebuilt" : "written";
      if (state === "absent") counts.created.adventures.push(doc.uuid);
    }
    counts[outcome]++;
    return outcome;
  } catch (err) {
    counts.failed++;
    console.error(`${MODULE_ID} | adventure for ${bookId} not written`, err);
    return "failed";
  }
}

/**
 * What the library holds of one adventure book's Adventure, read off its
 * shelf's index: its contents as the stamp counts them, or null when the
 * shelf lacks it.
 * @returns {Promise<{adventure: {contents: object|null}|null}>}
 */
export async function bookCensus(bookId) {
  const out = { adventure: null };
  const pack = bookIsJudges(bookId) ? findLibraryPack(ADVENTURE_TYPE, lineOf(bookId)) : null;
  if (!pack) return out;
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.cookbook`] }).catch(() => null);
  const rows = [...(index ?? [])];
  const row = rows.find((r) => r._id === bookAdventureId(bookId));
  if (row) out.adventure = { contents: row.flags?.[MODULE_ID]?.cookbook?.contents ?? null };
  return out;
}

/** The document types a book's Adventure carries besides its maps. */
const BOOK_DOC_TYPES = ["Actor", "RollTable", "JournalEntry", "Item"];

/** A document's folder names, outermost first, or none. */
function folderNames(doc) {
  const names = [];
  for (let f = doc?.folder ?? null; f && names.length < 8; f = f.folder ?? null) names.unshift(f.name);
  return names;
}

/** The id of the world folder of a type, name and parent, or null. */
const worldFolderOf = (type, name, parentId) =>
  game.folders.find((fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId)?.id ?? null;

/**
 * Every document one book's stamp names, by type: the library's where it holds
 * one, under the id of the world's twin (the first world document of the same
 * type and cookbook id) where the world has one, else the world's own, the
 * only source there is. A class template's part, and a second document of one
 * cookbook id, are never taken. Sorted by the id each is carried under. A
 * document is `filed` where the world files it: under its twin's folders when
 * there is one.
 * @returns {Promise<{type: string, doc: object, filed: object, id: string, uuids: string[], worldOnly: boolean}[]>}
 */
export async function bookDocuments(bookId) {
  // A content row stamped with the book is the library's, not the book's
  // bundle: a series' classes stand on its open shelf for a player to pick,
  // and the Adventure carries the Judge's half alone.
  // A place another book took over is this book's too while it answers for one
  // of its ids (`merged`), so either book's Adventure carries the place its
  // own rooms sit in.
  const ofBook = (flags, type) => {
    const flag = flags?.[MODULE_ID]?.cookbook;
    if (!flag?.id || isContentId(flag.id) || flags[MODULE_ID].templatePart) return false;
    if (bookOfCookbookId(flag.id, flag.book) === bookId) return true;
    return type === "Actor" && (flag.merged ?? []).some((id) => bookOfCookbookId(id) === bookId);
  };
  const out = [];
  for (const type of BOOK_DOC_TYPES) {
    const keyOf = (doc) => `${doc.type ?? ""}|${cookbookId(doc)}`;
    const world = new Map();
    for (const doc of game.collections.get(type) ?? []) {
      if (ofBook(doc.flags, type) && !world.has(keyOf(doc))) world.set(keyOf(doc), doc);
    }
    const shelved = [];
    for (const pack of ourPacksOfType(type)) {
      const fields = ["type", ...["id", "book", "merged"].map((k) => `flags.${MODULE_ID}.cookbook.${k}`), `flags.${MODULE_ID}.templatePart`];
      const index = await pack.getIndex({ fields }).catch(() => null);
      const ids = [...(index ?? [])].filter((r) => ofBook(r.flags, type)).map((r) => r._id);
      if (ids.length) shelved.push(...(await pack.getDocuments({ _id__in: ids })));
    }
    const taken = new Set();
    const list = [];
    for (const doc of shelved) {
      if (taken.has(keyOf(doc))) continue;
      taken.add(keyOf(doc));
      const twin = world.get(keyOf(doc)) ?? null;
      list.push({
        type, doc, filed: twin ?? doc, id: twin?.id ?? doc.id, uuids: [doc.uuid, ...(twin ? [twin.uuid] : [])], worldOnly: false,
      });
    }
    for (const [key, doc] of world) {
      if (taken.has(key)) continue;
      taken.add(key);
      list.push({ type, doc, filed: doc, id: doc.id, uuids: [doc.uuid], worldOnly: true });
    }
    out.push(...list.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return out;
}

/**
 * One carried document's source under the id it is carried as, owned by
 * nobody, as every world copy the importer makes is; a list's rows undrawn;
 * an actor marked a world copy (`worldCopySource`). A library document says
 * what it is a copy of.
 */
function carriedSource(type, doc, id) {
  const from = doc.pack ? doc.uuid : "";
  const source = type === "Actor" ? worldCopySource(doc.toObject(), new Map(), { sourceUuid: from }) : doc.toObject();
  source._id = id;
  source.ownership = { default: 0 };
  if (type === "RollTable") source.results = (source.results ?? []).map((r) => ({ ...r, drawn: false }));
  if (from) source._stats = { ...(source._stats ?? {}), compendiumSource: from };
  return source;
}

/**
 * One book's Adventure, or null when nothing of the book has been imported:
 * every document its stamp names (`bookDocuments`), every map of the book
 * rebuilt from its recipe over stand-ins for those documents under the
 * world's ids, the zones another book laid over one of its maps as the world
 * scene holds them, the lists the maps and zones roll on, and the folders all
 * of it is filed in, mirroring where each document is filed now. Every
 * reference an actor, a map, a list's result, a journal page's link or an
 * item's link makes to a carried document is in world form (`adventureRefs`);
 * one to anything else stays as the library wrote it. The stamp records the
 * `sourcesHash` of the rest. See docs/importer/DECISIONS.md, "A book is in the library as one
 * Adventure" and "How a book's Adventure is assembled and kept current".
 */
async function bookAdventureSource(bookId) {
  const seed = bookAdventureCookbookId(bookId);
  const label = bookLabel(bookId);
  const uuidMap = new Map();
  const carried = [];
  let worldOnly = 0;
  const carry = (type, doc, id, uuids, filed = doc) => {
    for (const uuid of uuids) uuidMap.set(uuid, `${type}.${id}`);
    const entry = { type, cbId: cookbookId(doc), names: folderNames(filed), source: carriedSource(type, doc, id) };
    carried.push(entry);
    return entry;
  };
  for (const { type, doc, filed, id, uuids, worldOnly: only } of await bookDocuments(bookId)) {
    carry(type, doc, id, uuids, filed);
    if (only) worldOnly++;
  }

  // A list a map or zone rolls on that the book does not print is carried too.
  const tableOf = async (cbId) => {
    let entry = carried.find((e) => e.type === "RollTable" && e.cbId === cbId);
    if (!entry) {
      const doc = await importedTable(cbId);
      if (!doc) return null;
      entry = carry("RollTable", doc, doc.id, [doc.uuid]);
    }
    return { uuid: `RollTable.${entry.source._id}`, results: entry.source.results, formula: entry.source.formula };
  };
  const tableAt = async (uuid) => {
    if (!uuid || uuidMap.has(uuid)) return;
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.documentName === "RollTable") carry("RollTable", doc, doc.id, [doc.uuid]);
  };

  // The maps, by page, over stand-ins: a temporary document answers for a
  // world one's name, uuid and token.
  const actorsNow = () => carried.filter((e) => e.type === "Actor").map((e) => adventureRefs("Actor", e.source, uuidMap));
  const standIns = standInsByClaim(actorsNow(), (a) => new Actor.implementation(a));
  const recipes = Object.entries(data.books.get(bookId)?.scenes ?? {})
    .filter(([, row]) => isSceneRecipe(row))
    .sort(([, a], [, b]) => (Number(a.scene.page) || 0) - (Number(b.scene.page) || 0));
  const scenes = [];
  const sceneOf = new Map();
  let cover = null;
  for (const [id, row] of recipes) {
    const recipe = row.scene;
    // The map step's own plan, solved the same way on an unsaved scene.
    const grid = recipe.grid ? gridScenePlan(recipe, new Scene({ name: row.name })) : null;
    if (recipe.grid && !grid) throw new Error(`map ${id}: its grid could not be fitted`);
    const picture = await sceneMapPath(bookId, id, recipe, grid?.pixelsPerPoint);
    cover ??= picture;
    const storeys = [];
    for (const crop of storeyCrops(recipe)) storeys.push(await sceneMapPath(bookId, id, { ...recipe, crop }, grid?.pixelsPerPoint));
    const held = heldMapOf(id);
    const traced = recipe.walls ? await ctx.traceSceneWalls(ctx.sessionDocs.get(bookId).doc, id, recipe) : null;
    const built = await mapCreateData({
      bookId, id, recipe, ids: mapIds(bookId, recipe), actors: standIns, tableOf, src: picture, folderId: null,
      fallbackName: row.name, grid, walls: traced?.walls ?? null, storeys,
    });
    const scene = withWorldIds(built, held?.toObject() ?? null, adventureCookbookId(id));
    scene.thumb = null;
    // A zone or a link end is no recipe's: it is a row, maybe another book's,
    // laid over this map. It was laid on the world map's picture, whose corner
    // a grid map made with another padding holds elsewhere on its canvas. A
    // held link end keeps the Judge's shape; the ends the world lacks are laid
    // below.
    const heldDims = held ? held.dimensions ?? held.getDimensions?.() ?? {} : {};
    const moved = grid && held
      ? { x: grid.origin.x - (Number(heldDims.sceneX) || 0), y: grid.origin.y - (Number(heldDims.sceneY) || 0) }
      : null;
    const lattice = moved ? new Scene({ name: row.name, grid: built.grid }).grid : null;
    for (const region of held?.regions ?? []) {
      if (!zoneIdOf(region) && !linkIdOf(region)) continue;
      const zone = zoneMovedBy(region.toObject(), moved, lattice ? (p) => lattice.getOffset(p) : null);
      for (const behavior of zone.behaviors ?? []) await tableAt(behavior.system?.tableUuid);
      scene.regions = [...(scene.regions ?? []), zone];
    }
    scenes.push(scene);
    sceneOf.set(id, scene);
  }
  if (!carried.length && !scenes.length) return null;

  // Every way between the book's maps, on the Adventure's own scenes, however
  // few of them the world holds: an end is placed on a scene built like the
  // Adventure's, a held one's stored destinations are read from the world's
  // behaviour, and a destination is written as core stores it.
  const framed = new Map([...sceneOf].map(([id, s]) => [id, new Scene(foundry.utils.deepClone({ ...s, walls: [], tokens: [], regions: [] }))]));
  const ends = linkSlots((id) => framed.get(id) ?? null);
  const names = placeLinkEnds(ends, (id) => carried.find((e) => e.type === "Actor" && e.cbId === id)?.source.name);
  withAdventureLinks({
    scenes: sceneOf,
    ends,
    lay: (slot) => linkEndRegion(slot, names.get(slot)),
    keep: (uuid, region, behavior, id) => {
      const live = heldMapOf(id)?.regions?.get(region._id)?.behaviors?.get(behavior._id);
      try {
        return (live && fromUuidSync(uuid, { relative: live })?.uuid) || null;
      } catch {
        return null;
      }
    },
    relative: foundry.utils.buildRelativeUuid,
    question: linkQuestion,
  });

  let actors = actorsNow();
  for (let i = 0; i < scenes.length; i++) {
    scenes[i] = adventureRefs("Scene", scenes[i], uuidMap);
    actors = linkFields(scenes[i], actors, bookId);
  }
  const folders = adventureFolderSources(
    [["Scene", [label]], ...carried.map((e) => [e.type, e.names.length ? e.names : [label]])],
    worldFolderOf, seed,
  );
  const fileIn = (type, names) => folders.idOf(type, names.length ? names : [label]);
  for (const scene of scenes) scene.folder = fileIn("Scene", []);
  const actorFolder = new Map(carried.filter((e) => e.type === "Actor").map((e) => [e.source._id, fileIn("Actor", e.names)]));
  for (const actor of actors) actor.folder = actorFolder.get(actor._id) ?? null;
  const ofType = (type) => carried.filter((e) => e.type === type)
    .map((e) => ({ ...adventureRefs(type, e.source, uuidMap), folder: fileIn(type, e.names) }));
  const tables = ofType("RollTable");
  const journal = ofType("JournalEntry");
  const items = ofType("Item");

  const places = actors.filter((a) => a.type === LOCATION_TYPE).length;
  const factions = actors.filter((a) => a.type === FACTION_TYPE).length;
  const contents = {
    scenes: scenes.length, places, factions, actors: actors.length - places - factions,
    tables: tables.length, journals: journal.length, items: items.length,
  };
  const say = (key, extra = {}) => game.i18n.format(`${LANG_PREFIX}.adventure.${key}`, { book: label, ...extra });
  const left = seatsLeft(actors);
  const description = [
    `<p>${say("intro")}</p>`,
    `<p>${say("contents", contents)}</p>`,
    `<p>${say("fillRule")}</p>`,
    `<p>${say("resetRule")}</p>`,
    ...(left ? [`<p>${say("seatsLeft", { n: left })}</p>`] : []),
  ].join("");
  if (worldOnly) console.log(`${MODULE_ID} | adventure for ${bookId}: ${worldOnly} document(s) carried from the world, the library having no copy.`);
  const source = {
    _id: bookAdventureId(bookId),
    name: label,
    img: cover,
    caption: say("caption"),
    description,
    actors,
    scenes,
    tables,
    journal,
    items,
    folders: folders.sources,
    combats: [], macros: [], cards: [], playlists: [],
    folder: null,
    sort: 0,
    flags: { [MODULE_ID]: { cookbook: { id: seed, book: bookId, kind: BOOK_ADVENTURE_KIND, contents } } },
  };
  source.flags[MODULE_ID].cookbook.sourcesHash = sourcesHashOf(source);
  return source;
}

/**
 * A map's picture for its book's Adventure: the page is checked against the
 * recipe's anchor first, exactly as a made map is, then the picture the world
 * already holds answers from the art cache without a render. A grid recipe's
 * picture is cut at its plan's scale, as the map step cuts it.
 */
async function sceneMapPath(bookId, id, recipe, pixelsPerPoint) {
  const doc = ctx.sessionDocs.get(bookId).doc;
  const placements = await pageArtPlacements(doc, recipe.page).catch(() => []);
  if (!placementMatches(placements, recipe.placement)) throw new Error(`map ${id}: the page does not match its recipe`);
  const up = await ctx.uploadSceneMap(doc, id, recipe, { pixelsPerPoint });
  if (!up) throw new Error(`map ${id}: its picture could not be made`);
  return up.path;
}

/**
 * Write one Adventure to its shelf: replaced whole when the shelf holds its
 * id (`diff: false, recursive: false`, as core's exporter writes), created
 * under its own id otherwise.
 */
async function writeAdventure(pack, source) {
  const Adventure = foundry.utils.getDocumentClass(ADVENTURE_TYPE);
  if (pack.index.has(source._id)) {
    const written = await Adventure.updateDocuments([source], { pack: pack.collection, diff: false, recursive: false });
    return written?.[0] ?? null;
  }
  return Adventure.create(source, { pack: pack.collection, keepId: true, keepEmbeddedIds: true });
}
