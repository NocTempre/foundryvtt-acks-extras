/**
 * Importing an AUTHORED OSE book.
 *
 * The registered-source path asks a Judge to find the blocks; an authored book
 * already knows where they are. The cookbook carries a box per creature and an
 * anchor that proves the box still points at it, so this walks the shipped
 * entries, reads each box with the SHIPPING executor, and hands the text to the
 * same grammar and converter the manual and per-page paths use.
 *
 * Nothing about the reading is special-cased here. That is the whole reason a
 * cookbook entry carries geometry rather than a parsed creature: a rule the
 * corpus teaches `ose-statline.mjs` improves these books at the same moment it
 * improves every other, and an authored book can never quietly become a second
 * dialect maintained by hand.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { executeEntry } from "./executor.mjs";
import { parseOseStatline, PROFILES, OSE_CANONICAL } from "./ose-statline.mjs";
import { oseActorDataFromFields, moraleBoundsFromSchema } from "./ose-binding.mjs";
import { isRangedCreature, oseTemplateDataFromFields, oseTemplateFromGroup } from "./ose-template.mjs";
import { oseLocationData, oseAdventureData, oseAdventureId } from "./ose-location.mjs";
import { currentScgConstants } from "./ose-app.mjs";
import {
  createDoc,
  claimActorImport,
  importedActorFor,
  cookbookBookFile,
  cookbookRegisters,
  cookbookSessionDoc,
  cookbookArtImporter,
  importFolderFor,
} from "./cookbook.mjs";
import { BOOKS } from "./books.mjs";
import { entryText, nodeParagraphs } from "./prose.mjs";
import { progressBar } from "./progress.mjs";

const loc = (k, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${k}`, data) : game.i18n.localize(`${LANG_PREFIX}.${k}`));

/** Book ids that ship an authored OSE cookbook, and are open this session. */
export function authoredOseBooks() {
  const out = [];
  for (const id of Object.keys(BOOKS)) {
    const cb = cookbookBookFile(id);
    if (!cb?.entries) continue;
    const creatures = Object.values(cb.entries).filter((e) => e.kind === "kind.oseMonster");
    const areas = Object.values(cb.entries).filter((e) => e.kind === "kind.oseLocation");
    if (creatures.length || areas.length) {
      out.push({ id, label: BOOKS[id].label, count: creatures.length, areas: areas.length, open: !!cookbookSessionDoc(id) });
    }
  }
  return out;
}

/**
 * Import every creature an authored book ships a box for.
 *
 * @param bookId  an authored book id whose PDF this seat has connected
 * @param opts.folderId  where the actors land
 * @param opts.art       import the page illustration too (default true)
 */
export async function importOseBook(bookId, { folderId = null, art = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(`${MODULE_ID} | GM only (creates documents).`);
    return 0;
  }
  const cb = cookbookBookFile(bookId);
  const doc = cookbookSessionDoc(bookId);
  if (!cb?.entries) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.bookNoCookbook", { book: bookId })}`), 0;
  if (!doc) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.bookNotConnected", { book: BOOKS[bookId]?.label ?? bookId })}`), 0;

  // A shipped book may declare its own dialect and lineage. Both default to
  // OSE, so a book that says nothing is read exactly as before.
  const profile = PROFILES[BOOKS[bookId]?.profile] ?? OSE_CANONICAL;
  const lineage = BOOKS[bookId]?.lineage ?? "ose";

  const registers = cookbookRegisters();
  const constants = await currentScgConstants();
  const bounds = moraleBoundsFromSchema();
  const importArt = art ? cookbookArtImporter() : null;

  // Creatures on their book's shelf, generators on their own beside them — and
  // resolved only once the run is going ahead, because asking for a folder
  // creates the compendium that holds it. A caller that named a folder keeps
  // it; the default used to be no folder at all, which left three hundred and
  // forty of this book's creatures loose at the top of the library.
  // Both are asked for only when something is about to be filed in them.
  // Asking CREATES the folder and the compendium under it, so resolving them
  // up front leaves an empty shelf in the pack of every book that ships no
  // generators — which is most of them.
  const shelf = (group) => {
    let pending;
    return async () => (pending ??= folderId ?? (await importFolderFor("Actor", bookId, group))?.id ?? null);
  };
  const creatureFolder = shelf("Creatures");
  const templateFolder = shelf("Templates");

  const ids = Object.keys(cb.entries).filter((id) => cb.entries[id].kind === "kind.oseMonster");
  const bar = progressBar(loc("ose.bookImporting", { book: BOOKS[bookId]?.label ?? bookId }), ids.length);
  // One page cache for the whole book: a bestiary puts several creatures on a
  // page and re-rendering it per entry is the expensive half of the run.
  const pageCache = new Map();

  let made = 0;
  let refused = 0;
  let templates = 0;
  let already = 0;
  /** Entries that are steps of one creature, gathered by their group key. */
  const groups = {};
  // Where the entry says it came from, for the line that closes its text.
  const citeOf = (e) => e.cite || `${BOOKS[bookId]?.short ?? bookId} p.${e.pages?.[0] ?? "?"}`;
  /** Generator id for a group of steps: keys are bare words shared by books. */
  const groupId = (key) => `${bookId}.group.${key}`;
  /** Group keys whose generator this world already holds — asked once each. */
  const groupHeld = new Map();
  for (const id of ids) {
    const entry = cb.entries[id];
    bar.step(entry.name ?? id);
    // Ask the shelf BEFORE reading the page. Every entry here costs a page
    // render and a parse, and this importer now runs inside "import
    // everything" — where a Judge re-runs it over a world that already holds
    // the whole book, and a presence check taken after the read would pay for
    // three hundred creatures to decide it wanted none of them.
    const group = entry.meta?.templateGroup;
    if (group) {
      if (!groupHeld.has(group)) groupHeld.set(group, !!(await importedActorFor(groupId(group))));
      if (groupHeld.get(group)) {
        already++;
        continue;
      }
    } else if (await importedActorFor(id)) {
      already++;
      continue;
    }
    const res = await executeEntry(doc, cb, registers, id, { pageCache });
    // `ok` is the heading anchor. A printing that moved the text fails here
    // rather than importing whatever creature now occupies the box.
    if (!res?.ok || !res.fields?.block) {
      refused++;
      continue;
    }
    const parsed = parseOseStatline(res.fields.block, profile);
    // One step of a creature the book prints a block per step for. Held back,
    // and built as a single generator once every step has been read.
    if (entry.meta?.templateGroup) {
      const g = (groups[entry.meta.templateGroup] ??= {
        id: groupId(entry.meta.templateGroup),
        name: entry.meta.templateName ?? entry.name,
        axisKey: entry.meta.templateAxis ?? "level",
        members: [],
      });
      g.members.push({
        key: entry.meta.templateKey ?? String(g.members.length + 1),
        label: entry.meta.templateLabel ?? entry.name,
        fields: parsed.fields,
        raw: res.fields.block,
        page: entry.pages?.[0] ?? null,
        box: entry.fields?.block?.box ?? null,
        entryId: id,
      });
      continue;
    }
    // A block that prints a RANGE of hit dice is not one creature. It becomes a
    // generator actor whose axis carries the printed figures, rather than a
    // single monster frozen at the bottom of its own range.
    if (isRangedCreature(parsed.fields)) {
      const tpl = oseTemplateDataFromFields({
        name: entry.name,
        entryId: id,
        fields: parsed.fields,
        extra: parsed.extra,
        raw: res.fields.block,
        source: { id: bookId, label: BOOKS[bookId]?.label ?? bookId, lineage },
        page: entry.pages?.[0] ?? null,
        box: entry.fields?.block?.box ?? null,
        lineage,
        constants,
        moraleBounds: bounds,
        folderId: await templateFolder(),
        cite: entry.cite ?? "",
      });
      tpl.system.details = { biography: entryText(res, id, citeOf(entry)) };
      const generator = await claimActorImport(id, () => createDoc(Actor, tpl));
      if (generator) {
        templates++;
        if (importArt && entry.fields?.art) {
          await importArt(generator, doc, {
            id,
            page: entry.fields.art.page ?? entry.pages?.[0],
            name: entry.fields.art.name ?? null,
            box: entry.fields.art.box ?? null,
          });
        }
      }
      continue;
    }
    const data = oseActorDataFromFields({
      name: entry.name,
      entryId: id,
      fields: parsed.fields,
      extra: parsed.extra,
      dialect: parsed.dialect,
      raw: res.fields.block,
      source: { id: bookId, label: BOOKS[bookId]?.label ?? bookId, lineage },
      page: entry.pages?.[0] ?? null,
      box: entry.fields?.block?.box ?? null,
      origin: "page",
      lineage,
      constants,
      moraleBounds: bounds,
      folderId: await creatureFolder(),
    });
    // The description is written at import, exactly as the ACKS books do it —
    // read once from the Judge's own copy, page reference last.
    data.system.details = {
      ...(data.system.details ?? {}),
      biography: entryText(res, id, citeOf(entry)),
    };

    const actor = await claimActorImport(id, () => createDoc(Actor, data));
    if (!actor) continue;
    made++;
    if (importArt && entry.fields?.art) {
      await importArt(actor, doc, {
        id,
        page: entry.fields.art.page ?? entry.pages?.[0],
        name: entry.fields.art.name ?? null,
        box: entry.fields.art.box ?? null,
      });
    }
  }
  // Each gathered group is one generator. Its options are complete printed
  // blocks, so this converts nothing the single-creature path would not.
  for (const g of Object.values(groups)) {
    if (!g.members.length) continue;
    g.members.sort((a, b) => Number(a.key) - Number(b.key) || String(a.key).localeCompare(String(b.key)));
    const made2 = await claimActorImport(g.id, async () =>
      createDoc(
        Actor,
        oseTemplateFromGroup({
          name: g.name,
          groupId: g.id,
          axisKey: g.axisKey,
          axisLabel: g.axisKey === "level" ? "Level" : g.axisKey,
          members: g.members,
          source: { id: bookId, label: BOOKS[bookId]?.label ?? bookId, lineage },
          lineage,
          constants,
          moraleBounds: bounds,
          folderId: await templateFolder(),
        }),
      ),
    );
    if (made2) templates++;
  }

  bar.finish();
  ui.notifications.info(
    `${MODULE_ID} | ${loc(constants ? "ose.bookDone" : "ose.bookDoneUnconverted", {
      n: made,
      book: BOOKS[bookId]?.label ?? bookId,
    })}${templates ? ` ${loc("ose.bookTemplates", { n: templates })}` : ""}${already ? ` ${loc("ose.bookHeld", { n: already })}` : ""}${refused ? ` ${loc("ose.bookRefused", { n: refused })}` : ""}`,
  );
  return made + templates;
}

/**
 * Import an authored adventure's KEYED AREAS as places.
 *
 * The adventure becomes a location of its own and the rooms nest inside it, so
 * a keyed dungeon arrives as a dungeon rather than as seventeen unrelated
 * actors sharing a numbering convention. Each room's text is read from the
 * Judge's own copy at import and written into the room — the same contract the
 * creatures and the ACKS books use.
 *
 * @param bookId  an authored book id whose PDF this seat has connected
 * @param opts.folderId  where the places land
 */
export async function importOseAreas(bookId, { folderId = null } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(`${MODULE_ID} | GM only (creates documents).`);
    return 0;
  }
  const cb = cookbookBookFile(bookId);
  if (!cb?.entries) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.bookNoCookbook", { book: bookId })}`), 0;

  const label = BOOKS[bookId]?.label ?? bookId;
  const short = BOOKS[bookId]?.short ?? bookId;
  const ids = Object.keys(cb.entries).filter((id) => cb.entries[id].kind === "kind.oseLocation");
  // Asked BEFORE the book is required. An adventure that ships no keyed areas
  // needs no PDF to say so, and answering "connect your book first" to a
  // question the cookbook already settles sends a Judge to find a file that
  // would not have changed the answer.
  if (!ids.length) return ui.notifications.info(`${MODULE_ID} | ${loc("ose.areasNone", { book: label })}`), 0;

  const doc = cookbookSessionDoc(bookId);
  if (!doc) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.bookNotConnected", { book: label })}`), 0;
  const registers = cookbookRegisters();

  // The adventure sits at the top of its book's shelf and its rooms nest under
  // "Areas" beside the creatures — two levels, which is all a pack allows.
  // Resolved here rather than at the top: asking for a folder creates the
  // compendium that holds it, and a book with no keyed areas returns above.
  const adventureFolder = folderId ?? (await importFolderFor("Actor", bookId))?.id ?? null;
  const areaFolder = folderId ?? (await importFolderFor("Actor", bookId, "Areas"))?.id ?? null;

  // The adventure first, so every room has something to sit inside — and only
  // once: a second run nests its rooms under the adventure already there
  // rather than building a second dungeon beside the first.
  const adventureId = oseAdventureId(bookId);
  const adventure = await claimActorImport(adventureId, () =>
    createDoc(Actor, oseAdventureData({ book: bookId, bookLabel: label, folderId: adventureFolder })),
  );
  const bar = progressBar(loc("ose.areasImporting", { book: label }), ids.length);
  const pageCache = new Map();

  let made = 0;
  let refused = 0;
  let already = 0;
  for (const id of ids) {
    const entry = cb.entries[id];
    bar.step(entry.name ?? id);
    // Asked before the page is read, not only before the write: reading a room
    // this world already holds is the cost a re-run exists to avoid.
    if (await importedActorFor(id)) {
      already++;
      continue;
    }
    // The anchor proves the heading still titles this room. A printing that
    // moved the text fails here rather than importing whatever now occupies
    // those coordinates.
    const res = await executeEntry(doc, cb, registers, id, { pageCache });
    if (!res?.ok) {
      refused++;
      continue;
    }
    const place = await claimActorImport(id, () =>
      createDoc(
        Actor,
        oseLocationData({
          name: entry.name,
          entryId: id,
          paragraphs: nodeParagraphs(res),
          cite: entry.cite || `${short} p.${entry.pages?.[0] ?? "?"}`,
          page: entry.pages?.[0] ?? null,
          book: bookId,
          bookLabel: label,
          areaKey: entry.meta?.areaKey ?? "",
          parentUuid: adventure?.uuid ?? "",
          folderId: areaFolder,
        }),
      ),
    );
    if (place) made++;
  }
  bar.finish();
  ui.notifications.info(
    `${MODULE_ID} | ${loc("ose.areasDone", { n: made, book: label })}${already ? ` ${loc("ose.areasHeld", { n: already })}` : ""}${refused ? ` ${loc("ose.bookRefused", { n: refused })}` : ""}`,
  );
  return made;
}

/**
 * Import every authored book this seat has open — creatures, then the keyed
 * areas that reference them.
 *
 * This is the OSE step of "import everything", and it exists because a shipped
 * cookbook nobody can reach is a cookbook that does not ship: `importOseBook`
 * and `importOseAreas` were on the api and on nothing else, so the Judge's one
 * import control walked past seven hundred authored entries in the books it
 * had just read.
 *
 * A book the seat has NOT connected is skipped in silence rather than warned
 * about. In a chain the Judge did not aim at any particular book, "connect
 * Dolmenwood first" is not an error report — it is a list of books they do not
 * own, once per run.
 */
export async function importAuthoredOse({ folderId = null, art = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(`${MODULE_ID} | GM only (creates documents).`);
    return 0;
  }
  const open = authoredOseBooks().filter((b) => b.open);
  if (!open.length) {
    ui.notifications.info(`${MODULE_ID} | ${loc("ose.allNone")}`);
    return 0;
  }
  let made = 0;
  // One book at a time: each opens its own pages, and two books read at once
  // is two rendered PDFs in memory for no gain.
  for (const book of open) {
    made += (await importOseBook(book.id, { folderId, art })) ?? 0;
    if (book.areas) made += (await importOseAreas(book.id, { folderId })) ?? 0;
  }
  ui.notifications.info(
    `${MODULE_ID} | ${loc("ose.allDone", { n: made, books: open.map((b) => b.label).join(", ") })}`,
  );
  return made;
}
