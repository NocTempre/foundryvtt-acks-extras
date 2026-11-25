/**
 * Live walk, importer-typography: a community book read through its declared
 * typography. Walks docs/importer/TESTING.md, "A community book, read through
 * its declared typography", steps 1–8 on the book `cat`; step 1's Books-window
 * line and its boot check are not driven here. Machine values arrive
 * through ./_env.mjs, the book through ACKS_TEST_BOOKS ("cat"). Nothing is
 * invented: every document is the import's own, found by the cookbook id the
 * run imported and tracked, and swept by uuid. A check prints ids, counts and
 * booleans, never a book's words.
 *
 * Steps 3–6 open nothing: each reads the created document's data, which is what
 * its sheet renders, and the sheet templates are the core system's. Step 7
 * joins as the Player seat and reads which shelves that seat can see.
 *
 * With SHOTS=1 the run takes three release plates into docs/releases/v<version>/:
 * a journal's page list (never a page) and the keeper's sheet on Stats once
 * the Judge's imports are done, and the Player seat's compendium tab, popped
 * out, opened to the series' open Item shelf.
 *
 * The imports are scoped to the book (`importClasses({only})`,
 * `cookbookImportAbilities({only})`, `cookbookImportIds`,
 * `cookbookImportAdventureItems({books})`, `cookbookImportScenes({books})`,
 * `cookbookImportAdventures({books})`): the
 * seat reopens the world's shelved books after ready, and a step with no scope
 * would write every one of them.
 *
 * Every step is setup (`.claude/rules/live-testing.md` step 4): the line's
 * first import, which opens its shelves, and reads of what that import made.
 * Nothing the run makes is kept, since a standing import is what the next
 * run's first import needs absent (docs/importer/DECISIONS.md, 2026-10-28);
 * step 8's sweep takes it by the run's own ids.
 *
 * The first import needs the book's shelves and ids absent, so section 0 is
 * a setup that clears a standing import by the ids it reads back: every world
 * document under one of the book's cookbook ids and every document the book's
 * line shelves hold under its stamp is tracked in the driver's ledger and swept
 * through `sweepTracked({ only })`, never by name, folder, type or time; a line
 * shelf that is then empty is deleted by its collection id, and one that still
 * holds a document that is not the book's stops the walk. Setup that clears a
 * test world's own content is the 2026-11-11 ruling. The seated users are
 * logged first. The checks that follow (shelves absent before the census,
 * nothing under the book's ids, the GM census opens no pack) then run against
 * a world the clear has emptied, and pass or fail on what it holds.
 *
 * Writes outside the fixture ledger, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the GM seat's notification methods, patched to read what a run says
 *     (put back at teardown);
 *   - the line's shelves a standing import left empty, deleted by section 0;
 *   - the shelves the line's first import opens (packs) and the folders filed
 *     in them: a pack this run opened is deleted at teardown once empty, and a
 *     folder this run added to a pack it found is tracked and swept;
 *   - each map's picture, which the scenes step uploads under the world's
 *     data directory and the sweep does not reach; its path is logged.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, ROOT, shotDir } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = "cat";
const BOOKS = books([BOOK]);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
/** A name whose line turn was welded reads lower-case straight into upper-case ("FightingStyle"). */
const welded = (name) => /[a-z][A-Z]/.test(String(name ?? ""));
const SHOTS = process.env.SHOTS === "1";
/** One release plate: `frame.keep` is the window `compose` leaves open, `frame.sel` what is shot (the window when absent). */
const plate = async (seat, slug, frame) => {
  if (!SHOTS || !frame?.keep) return null;
  try {
    await seat.compose(frame.keep);
    await sleep(500);
    const r = await seat.shot(`${shotDir()}/${slug}.png`, frame.sel ?? frame.keep);
    note(`shot ${slug}`, r);
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__bt = globalThis.__bt ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.BK = await import("/modules/acks-extras/scripts/importer/books.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    return { installed: true };
  },
  /** The seat, the book's registration and what the world already holds under the book's ids. */
  census: async ({ book, ids }) => {
    const H = globalThis.__bt;
    const row = H.BK.BOOKS[book] ?? null;
    const held = {};
    for (const id of ids.items) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    for (const id of ids.actors) held[id] = (await H.CB.importedActorFor(id))?.uuid ?? null;
    for (const id of ids.scenes ?? []) held[id] = game.scenes.find((s) => s.getFlag("acks-extras", "cookbook")?.id === id)?.uuid ?? null;
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      registered: !!row,
      judge: !!row?.judge,
      typography: !!row?.typography,
      bodyPt: row?.typography?.bodyPt ?? null,
      label: row?.label ?? null,
      api: ["importClasses", "cookbookImportAbilities", "cookbookImportIds", "cookbookImportScenes", "cookbookImportAdventures"].every((k) => typeof acksExtras.importer?.[k] === "function"),
      open: !!H.CB.cookbookSessionDoc(book),
      openBooks: Object.keys(H.BK.BOOKS).filter((b) => H.CB.cookbookSessionDoc(b)),
      held,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__bt;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    H.notes.splice(0);
    globalThis.__btBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__btBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__btBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const H = globalThis.__bt;
    return { ...globalThis.__btBook, open: !!H.CB.cookbookSessionDoc(id), notes: H.notes.slice() };
  },
  line: async ({ book }) => globalThis.__bt.CB.lineOf(book),
  /** The line the book's CONTENT rows file on — its series' open shelf, read by the rule the writes use. */
  openLine: async ({ book }) => globalThis.__bt.CB.lineOfClaim("def.class.probe", book),
  /** The users seated now, by name: the log's record of who shared the world when a setup cleared it. */
  seated: async () => game.users.filter((u) => u.active).map((u) => u.name),
  /**
   * What stands under the book, read back without a presence check: the world's
   * Scenes, Actors, Items and Journals whose cookbook id is one of the book's
   * (`ids`), and each line shelf's documents carrying the book's stamp (its
   * `cookbook.book`, or a cookbook id of the book's). A shelf reports its whole
   * size beside the uuids it holds for the book, so a document of anything else
   * shows as the difference.
   */
  standing: async ({ book, ids, line, open }) => {
    const H = globalThis.__bt;
    const want = new Set(ids);
    const world = [];
    for (const [kind, collection] of [["Scene", game.scenes], ["Actor", game.actors], ["Item", game.items], ["JournalEntry", game.journal]]) {
      for (const doc of collection) {
        const stamp = doc.getFlag("acks-extras", "cookbook");
        if (want.has(stamp?.id) || want.has(stamp?.leadersOf)) world.push({ uuid: doc.uuid, kind });
      }
    }
    const shelves = [];
    // A monster's leaders template is the book's too: its stamp names the monster it leads.
    const read = async (type, pack) => {
      if (!pack || shelves.some((s) => s.collection === pack.collection)) return;
      const index = await pack.getIndex({ fields: ["flags.acks-extras.cookbook.id", "flags.acks-extras.cookbook.book", "flags.acks-extras.cookbook.leadersOf"] });
      const mine = [...index.values()].filter((row) => {
        const stamp = row.flags?.["acks-extras"]?.cookbook;
        return !!stamp && (stamp.book === book || want.has(stamp.id) || want.has(stamp.leadersOf));
      });
      shelves.push({ collection: pack.collection, type, size: index.size, uuids: mine.map((row) => `Compendium.${pack.collection}.${type}.${row._id}`) });
    };
    for (const type of ["Item", "Actor", "RollTable", "JournalEntry", "Adventure"]) await read(type, H.LIB.findLibraryPack(type, line));
    await read("Item", H.LIB.findLibraryPack("Item", open));
    return { world, shelves };
  },
  /** The module's wear-slot names, from the vocabulary the item model declares them in. */
  wearSlots: async () => Object.keys((await import("/modules/acks-extras/scripts/lib/vocab.mjs")).WEAR_SLOTS),
  /** The world's shelves, the line's own by type and the open line's Item shelf, with the folders on each, before and after. */
  shelves: async ({ line, open }) => {
    const H = globalThis.__bt;
    const packs = game.packs.filter((p) => p.metadata.packageType === "world").map((p) => p.collection);
    const folders = {};
    const lined = {};
    for (const type of ["Item", "Actor", "RollTable", "JournalEntry", "Adventure"]) {
      const pack = H.LIB.findLibraryPack(type, line);
      lined[type] = pack?.collection ?? null;
      if (pack) folders[pack.collection] = pack.folders.map((f) => f.uuid);
    }
    const openItems = H.LIB.findLibraryPack("Item", open);
    if (openItems) folders[openItems.collection] = openItems.folders.map((f) => f.uuid);
    return { packs, lined, open: { Item: openItems?.collection ?? null }, folders };
  },
  /** A document's folder and the pack that folder is in — a folder from another pack is dropped by core, and the document lands at the root. */
  folderOf: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const folder = doc.folder ?? null;
    return { pack: doc.pack ?? null, folder: folder?.name ?? null, folderPack: folder?.pack ?? null, parent: folder?.folder?.name ?? null };
  },
  /** Where a document stands: its pack's line, and whether that line is the Judge's. */
  shelfOf: async ({ uuid }) => {
    const H = globalThis.__bt;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const line = doc.pack ? H.LIB.lineOfPack(doc.pack) : undefined;
    return { pack: doc.pack ?? null, line: line ?? null, judge: !!doc.pack && H.LIB.isJudgeLine(line) };
  },
  /**
   * A journal the journals step made: its name, its shelf, and each page's title,
   * cookbook id, paragraph count and page reference. Each printed paragraph
   * (a bare `<p>`) is also read for its shape alone: whether it closes on
   * terminal punctuation, whether it opens lower-case, and whether it opens
   * on a list marker (a first glyph that is neither a letter, a digit nor an
   * opening quote or bracket), a run-in label or a run of labels and values;
   * no text leaves the page.
   */
  journal: async ({ uuid }) => {
    const H = globalThis.__bt;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const line = doc.pack ? H.LIB.lineOfPack(doc.pack) : null;
    const pages = doc.pages.contents.map((p) => {
      const html = String(p.text?.content ?? "");
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const shape = [...holder.querySelectorAll("p:not([class])")].map((el) => {
        const text = (el.textContent ?? "").trim();
        const first = [...text.matchAll(/\p{L}/gu)][0]?.[0] ?? "";
        const last = text.slice(-1);
        const words = text.split(/\s+/);
        return {
          // A run of labels and their values (a stat line): no sentence break inside,
          // two capitalised words to open, and capitals on a third of its words or more.
          labelRun: !/[.!?]["”’)]*\s/u.test(text) && /^\p{Lu}\p{Ll}*\s+\p{Lu}/u.test(text)
            && words.filter((w) => /^\p{Lu}/u.test(w)).length / words.length >= 0.3,
          // The closing glyph's class and whether the line is short, never the glyph or the words.
          end: !last ? "none" : /\p{L}/u.test(last) ? "letter" : /\p{N}/u.test(last) ? "digit" : /[.!?:;…]/u.test(last) ? "terminal" : /[)\]"”’']/u.test(last) ? "close" : "other",
          short: words.length <= 8,
          terminal: /[.!?:;…]["”’')\]]*$/u.test(text),
          lowerOpen: !!first && first === first.toLowerCase() && first !== first.toUpperCase() && text.indexOf(first) < 3,
          marker: /^[^\p{L}\p{N}"“‘'(\[]/u.test(text),
          // A line opened by a run-in label ("Label: …") is a labelled list line.
          labelled: /^[A-Z][\p{L}' ]{1,40}:/u.test(text),
        };
      });
      return {
        name: p.name, id: p.flags?.["acks-extras"]?.cookbook?.id ?? null,
        paragraphs: (html.match(/<p>/g) ?? []).length, cite: /<p class=/.test(html), chars: html.replace(/<[^>]*>/g, "").length, shape,
      };
    });
    return { name: doc.name, pack: doc.pack ?? null, line, judge: !!doc.pack && H.LIB.isJudgeLine(line), folder: doc.folder?.name ?? null, pages };
  },
  /** A journal's sheet opened at the corner, for a plate: its window's `#id`, and its page list as what is shot. */
  journalToc: async ({ uuid }) => {
    const app = (await fromUuid(uuid)).sheet;
    await app.render({ force: true });
    for (let i = 0; i < 50 && !app.element?.querySelector(".journal-sidebar"); i++) await new Promise((r) => setTimeout(r, 100));
    app.setPosition({ left: 16, top: 16 });
    await new Promise((r) => setTimeout(r, 400));
    return { keep: `#${app.id}`, sel: `#${app.id} .journal-sidebar`, toc: !!app.element.querySelector(".journal-sidebar") };
  },
  /** A character's sheet opened on its Stats tab at the corner, for a plate: its window's `#id` and its sheet class. */
  sheetOnStats: async ({ uuid }) => {
    const app = (await fromUuid(uuid)).sheet;
    await app.render({ force: true });
    for (let i = 0; i < 50 && !app.element?.querySelector(".window-content"); i++) await new Promise((r) => setTimeout(r, 100));
    if (app.element.querySelector('[data-group="primary"][data-tab="stats"]')) app.changeTab("stats", "primary");
    app.setPosition({ left: 16, top: 16 });
    await new Promise((r) => setTimeout(r, 400));
    return { keep: `#${app.id}`, sheet: app.constructor.name };
  },
  /** The compendium tab popped out at the corner, every folder around one pack opened, for a plate: the popout's `#id`. */
  shelfPopout: async ({ collection }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const app = await ui.compendium.renderPopout();
    const row = () => app.element?.querySelector(`[data-pack="${collection}"]`);
    for (let i = 0; i < 50 && !row(); i++) await wait(100);
    const ids = [];
    for (let li = row()?.parentElement?.closest("li.folder"); li; li = li.parentElement?.closest("li.folder")) ids.unshift(li.dataset.folderId);
    for (const id of ids) {
      const li = app.element.querySelector(`li.folder[data-folder-id="${id}"]`);
      if (li && !li.classList.contains("expanded")) { li.querySelector(":scope > .folder-header")?.click(); await wait(200); }
    }
    // A world pack's footer names the world; a plate never carries it.
    let unnamed = 0;
    for (const li of app.element.querySelectorAll("li.compendium[data-pack]")) {
      if (game.packs.get(li.dataset.pack)?.metadata.packageType !== "world") continue;
      const footer = li.querySelector(".compendium-footer");
      if (footer) { footer.style.visibility = "hidden"; unnamed++; }
    }
    app.setPosition({ left: 16, top: 16, height: 640 });
    await wait(400);
    return { keep: `#${app.id}`, shown: !!row()?.checkVisibility?.(), folders: ids.length, unnamed };
  },
  /** A map the scenes step made: its picture, its lattice, its navigation flag and its walls. */
  scene: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const src = doc.background?.src ?? "";
    return {
      picture: !!src, pictureDir: src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : null,
      width: doc.width ?? null, height: doc.height ?? null, gridless: doc.grid?.type === 0,
      navigation: !!doc.navigation, walls: doc.walls.size, tokens: doc.tokens.size, regions: doc.regions.size,
      folder: !!doc.folder, book: doc.getFlag("acks-extras", "cookbook")?.book ?? null,
    };
  },
  /** The book's Adventure: what it carries, by count, and the stamp it is written under. */
  adventure: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const stamp = doc.getFlag("acks-extras", "cookbook") ?? {};
    return {
      scenes: doc.scenes.size, actors: doc.actors.size, items: doc.items.size, journal: doc.journal.size, tables: doc.tables.size, folders: doc.folders.size,
      book: stamp.book ?? null, kind: stamp.kind ?? null, contents: stamp.contents ?? null,
    };
  },
  /** What THIS seat can see of the line's Judge shelves and of the open Item shelf the book's content files on. */
  seatView: async ({ line, open, ids }) => {
    const H = globalThis.__bt;
    const level = (pack) => pack.getUserLevel(game.user);
    const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const lined = game.packs
      .filter((p) => p.metadata.packageType === "world" && H.LIB.isLibraryPack?.(p.collection) !== false && H.LIB.lineOfPack(p.collection) === line)
      .map((p) => ({ collection: p.collection, type: p.documentName, visible: p.visible, level: level(p) }));
    const items = H.LIB.findLibraryPack("Item", open);
    let classesSeen = 0;
    if (items && items.visible) {
      const index = await items.getIndex({ fields: ["flags.acks-extras.cookbook.id"] });
      const want = new Set(ids.items);
      for (const row of index) if (want.has(row.flags?.["acks-extras"]?.cookbook?.id)) classesSeen++;
    }
    return {
      isGM: game.user.isGM, role: game.user.role,
      lined, anyLinedVisible: lined.some((p) => p.visible || p.level >= observer),
      openItems: items ? { collection: items.collection, line: H.LIB.lineOfPack(items.collection), visible: items.visible, level: level(items) } : null,
      classesSeen, classesWanted: ids.items.length,
      scenesSeen: (ids.scenes ?? []).filter((id) => game.scenes.find((s) => s.getFlag("acks-extras", "cookbook")?.id === id)).length,
    };
  },
  /** One import step, started; `stepState` reads its outcome. `fn` names the api method, `args` its call. */
  step: async ({ fn, args }) => {
    const H = globalThis.__bt;
    H.notes.splice(0);
    globalThis.__btStep = { done: false };
    const call = args?.only ? { only: new Set(args.only) } : args ?? undefined;
    (call === undefined ? acksExtras.importer[fn]() : acksExtras.importer[fn](call))
      .then((r) => {
        // What a step hands back: created documents (classes), counts
        // (abilities, monsters) or the scenes' counts with `created` uuids.
        const out = Array.isArray(r) ? { docs: r.map((d) => d.uuid) } : r && typeof r === "object" ? r : { value: r ?? null };
        globalThis.__btStep = { done: true, result: out };
      })
      .catch((e) => { globalThis.__btStep = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  stepState: async () => ({ ...globalThis.__btStep, notes: globalThis.__bt.notes.slice() }),
  /** The uuid the world now holds under each id — the import's own documents, read back by the ids it was given. */
  heldNow: async ({ ids }) => {
    const H = globalThis.__bt;
    const held = {};
    for (const id of ids.items ?? []) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    for (const id of ids.actors ?? []) held[id] = (await H.CB.importedActorFor(id))?.uuid ?? null;
    return held;
  },
  /** The leaders templates the monster step minted on the line's Actor shelf for the given monster ids, as uuids. */
  leaders: async ({ ids, line }) => {
    const pack = globalThis.__bt.LIB.findLibraryPack("Actor", line);
    if (!pack) return [];
    const want = new Set(ids);
    const index = await pack.getIndex({ fields: ["flags.acks-extras.cookbook.leadersOf"] });
    return [...index.values()].filter((row) => want.has(row.flags?.["acks-extras"]?.cookbook?.leadersOf)).map((row) => `Compendium.${pack.collection}.Actor.${row._id}`);
  },
  /** A class-power or book item: its type, cookbook id, how many paragraphs its description holds, and — for an item — its declared slots, its cost and its magic mark. */
  power: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const html = String(doc.system?.description ?? "");
    const x = doc.flags?.["acks-extras"] ?? {};
    // Bare `<p>` is a printed paragraph; the page reference closes the text as a classed one.
    return {
      type: doc.type, id: x.cookbook?.id ?? null, paragraphs: (html.match(/<p>/g) ?? []).length, cite: /<p class=/.test(html), chars: html.replace(/<[^>]*>/g, "").length,
      slots: Array.isArray(x.gear?.slots) ? x.gear.slots : null, cost: doc.system?.cost ?? null, magic: !!x.markets?.magic,
    };
  },
  /**
   * A copy of an imported item embedded on the character, then worn and put
   * away through her Follower Card's own toggle — the card's gesture, not the
   * store — and removed again. Reports whether the card offered the toggle,
   * where the item was worn after the first press and whether the second
   * press put it away.
   */
  wearOnCard: async ({ actorUuid, itemUuid }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const actor = await fromUuid(actorUuid);
    const src = await fromUuid(itemUuid);
    if (!actor || !src) return null;
    const data = src.toObject();
    delete data._id;
    delete data.folder;
    const [embedded] = await actor.createEmbeddedDocuments("Item", [data]);
    const wornAt = () => actor.items.get(embedded.id)?.getFlag("acks-extras", "gear")?.wornAt ?? "";
    const app = new acksExtras.lib.followerCard.Sheet({ document: actor });
    await app.render({ force: true });
    const root = () => (app.element?.nodeType === 1 ? app.element : app.element?.[0]) ?? null;
    const button = () => root()?.querySelector(`[data-action="fcToggleEquip"][data-item-id="${embedded.id}"]`);
    for (let i = 0; i < 50 && !button(); i++) await wait(100);
    const out = { embedded: embedded.id, slots: embedded.flags?.["acks-extras"]?.gear?.slots ?? null, offered: !!button(), wornBefore: wornAt() };
    if (out.offered) {
      button().click();
      for (let i = 0; i < 50 && !wornAt(); i++) await wait(100);
      out.wornAt = wornAt();
      // The card re-renders on the item's update; its pressed state follows the store.
      for (let i = 0; i < 30 && button()?.getAttribute("aria-pressed") !== "true"; i++) await wait(100);
      out.pressed = button()?.getAttribute("aria-pressed") ?? null;
      button()?.click();
      for (let i = 0; i < 50 && wornAt(); i++) await wait(100);
      out.wornAfter = wornAt();
    }
    await app.close({ force: true });
    await actor.deleteEmbeddedDocuments("Item", [embedded.id]);
    out.removed = !actor.items.get(embedded.id);
    return out;
  },
  /** The monster actor: which stats landed, its attack modes, spoils and the order and wholeness of its prose sections. */
  monster: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system ?? {};
    const x = doc.flags?.["acks-extras"]?.extras ?? {};
    const items = doc.items.contents;
    const weapons = items.filter((i) => i.type === "weapon");
    const modes = [];
    for (const w of weapons) {
      const m = w.flags?.["acks-extras"]?.attackMode ?? 0;
      modes[m] = (modes[m] ?? 0) + 1;
    }
    const spoils = items.filter((i) => i.flags?.["acks-extras"]?.spoil);
    const sections = Object.entries(x.description ?? {}).map(([field, html]) => {
      const paras = [...String(html).matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
      const last = paras[paras.length - 1] ?? "";
      return { field, paragraphs: paras.length, lastEndsSentence: /[.!?)"”]$/.test(last) };
    });
    return {
      ac: s.ac?.value ?? null, hd: s.hp?.hd ?? null, movement: s.movement?.base ?? null,
      morale: s.details?.morale ?? null, xp: s.details?.xp ?? null, alignment: !!s.details?.alignment, treasure: !!s.details?.treasure?.type,
      saves: Object.keys(s.saves ?? {}).length, vision: (x.vision ?? []).length, types: (x.types ?? []).length,
      weapons: weapons.length, modes,
      abilities: items.filter((i) => i.type === "ability").length,
      spoils: spoils.map((i) => ({ cost: i.system?.cost ?? null, weight6: i.system?.weight6 ?? null, effects: (i.flags?.["acks-extras"]?.researchEffects ?? []).length })),
      sections,
    };
  },
  /** The cookbook ids of every ability definition the library holds now — the census a later read of the same ids is compared against. */
  libraryAbilityIds: async () => {
    const H = globalThis.__bt;
    if (H.LIB.whenReady) await H.LIB.whenReady();
    return H.LIB.libraryItems().filter((i) => i.type === "ability").map((i) => i.flags?.["acks-extras"]?.cookbook?.id).filter(Boolean);
  },
  /** A person the page prints in full, as a character: the class binding, the written boxes, the proficiencies, the gear and coin, and the biography's two parts. */
  character: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system ?? {};
    const M = await import("/modules/acks-extras/scripts/character-sheet/pdf/match.mjs");
    const bio = String(s.details?.biography ?? "");
    return {
      type: doc.type, namedFromPage: !/^NPC \d+$/.test(doc.name), ownership: doc.ownership?.default ?? null,
      className: s.details?.class ?? "", classBound: !!M.matchClass(s.details?.class), level: s.details?.level ?? null,
      scores: Object.values(s.scores ?? {}).filter((v) => Number(v?.value) > 0).length, hp: [s.hp?.value ?? null, s.hp?.max ?? null],
      abilities: doc.items.filter((i) => i.type === "ability").length,
      abilityIds: doc.items.filter((i) => i.type === "ability").map((i) => i.flags?.["acks-extras"]?.cookbook?.id).filter(Boolean),
      gear: doc.items.filter((i) => ["item", "armor", "weapon"].includes(i.type)).length, gp: M.coinsHeld(doc, "gp"),
      // Bare `<p>` is a printed paragraph; the page reference and the as-printed block are classed.
      prose: (bio.match(/<p>/g) ?? []).length, cite: /<p class=/.test(bio), asPrinted: bio.includes("acks-extras-importer-as-printed"),
      printed: doc.flags?.["acks-extras"]?.printed ?? null,
    };
  },
  /** A class item: its header fields, its list's resolution and its description's run-in labels. */
  classItem: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system ?? {};
    const html = String(s.description ?? "");
    const paras = [...html.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    return {
      type: doc.type, id: doc.flags?.["acks-extras"]?.cookbook?.id ?? null, hitDie: !!s.hitDie, maximumLevel: s.maximumLevel ?? null,
      // A set field reads back as a Set, an array field as an array; both count the same way.
      keyAttributes: Array.from(s.keyAttributes ?? []).length, requirements: Array.from(s.requirements ?? []).length,
      resolved: (s.inventory?.classProfs ?? []).length, unresolved: s.unresolvedProfs ?? [],
      paragraphs: paras.length, runIn: paras.filter((p) => /^[A-Z][A-Za-z' ]{1,40}:/.test(p)).length,
      chassis: [s.saveChassis, s.attackChassis],
    };
  },
  closeAll: async () => {
    const open = [...foundry.applications.instances.values()];
    for (const app of open) { try { await app.close(); } catch {} }
    return { closed: open.length };
  },
  restore: async () => {
    const H = globalThis.__bt ?? {};
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; return { notes: "restored" }; }
    return {};
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
    // Its folders go with it: an emptied shelf holds only the folders an import filed.
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportIds`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function poll(api, fn, args, { tries = 300, every = 2000, until = (s) => s?.done } = {}) {
  let state = null;
  for (let n = 0; n < tries; n++) {
    state = await run(api, fn, args);
    if (until(state)) return state;
    await sleep(every);
  }
  return state;
}
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

/** The book's ids, read off the shipped cookbook so the walk follows a recompile. */
function bookIds(book) {
  // `items` is what the Player seat is owed on the series' open Item shelf;
  // the book's own items (`adventureItems`) stand on its Judge shelf instead.
  // `prose` maps each passage's id to the title its page takes.
  // `characters` are the people the book prints in full (an npc row bound as a character).
  // `paras` is each power's and item's description box count and `proseParas` each
  // passage's (the executor joins boxes cut at a column or a page, never splits
  // one); `chassis` is each class's declared saves and attack row; `groups` is the
  // sorted distinct group the passages are filed under, one journal each.
  const ids = { items: [], actors: [], characters: [], classes: [], powers: [], scenes: [], adventureItems: [], prose: {}, paras: {}, proseParas: {}, chassis: {}, groups: [] };
  const groups = new Set();
  const dir = path.join(ROOT, "cookbook");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "registers.json") continue;
    const cb = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (cb.book?.id === book) for (const [id, row] of Object.entries(cb.scenes ?? {})) if (row?.kind === "kind.scene") ids.scenes.push(id);
    for (const [id, e] of Object.entries(cb.entries ?? {})) {
      if ((e.book ?? cb.book?.id) !== book) continue;
      const boxes = e.fields?.description?.paras?.length ?? 0;
      if (e.kind === "kind.class") { ids.classes.push(id); ids.items.push(id); ids.chassis[id] = { saves: e.meta?.chassis?.saves ?? null, attack: e.meta?.chassis?.attack ?? null }; }
      else if (e.kind === "kind.power") { ids.powers.push(id); ids.items.push(id); ids.paras[id] = boxes; }
      else if (e.kind === "kind.monster") ids.actors.push(id);
      else if (e.kind === "kind.npc" && e.meta?.actor === "character") ids.characters.push(id);
      else if (e.kind === "kind.adventureItem") { ids.adventureItems.push(id); ids.paras[id] = boxes; }
      else if (e.kind === "kind.prose") {
        ids.prose[id] = e.meta?.title ?? e.name;
        ids.proseParas[id] = boxes;
        if (e.meta?.group) groups.add(e.meta.group);
      }
    }
  }
  ids.groups = [...groups].sort();
  return ids;
}

let gm = null;
const openedPacks = [];
/** One import step: started on the seat, polled to its end, its notes and result returned. */
async function runStep(label, fn, args) {
  await run(gm, P.step, { fn, args });
  const st = await poll(gm, P.stepState, undefined, { tries: 150 });
  if (!st?.done) throw new Error(`${label}: the step did not finish`);
  if (st.error) throw new Error(`${label}: the step threw: ${st.error}`);
  note(label, { result: st.result, notes: st.notes });
  return st;
}

try {
  const IDS = bookIds(BOOK);
  note("ids from the cookbook", { classes: IDS.classes.length, powers: IDS.powers.length, monsters: IDS.actors.length, characters: IDS.characters.length, items: IDS.adventureItems.length });

  section("seats and the book");
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  const line = await run(gm, P.line, { book: BOOK });
  const open = await run(gm, P.openLine, { book: BOOK });
  // A null line names the ACKS library's own shelves, which no clear may touch.
  if (!line || !open || open === line) throw new Error(`the book's lines are not its own: ${JSON.stringify({ line, open })}`);

  section("0. setup: clear a standing import by the ids it reads back");
  // The reads use the library's pack lookup and the world's collections only:
  // a presence check (`importedActorFor`) can mint the shelf it reads.
  note("seated on the world", await run(gm, P.seated));
  const everyId = [...IDS.classes, ...IDS.powers, ...IDS.actors, ...IDS.characters, ...IDS.adventureItems, ...Object.keys(IDS.prose), ...IDS.scenes];
  const standing = await run(gm, P.standing, { book: BOOK, ids: everyId, line, open });
  const standingDocs = [...standing.world, ...standing.shelves.flatMap((s) => s.uuids.map((uuid) => ({ uuid, kind: s.type })))];
  note("standing under the book", { world: standing.world.length, shelves: standing.shelves.map((s) => ({ collection: s.collection, size: s.size, book: s.uuids.length })) });
  for (const d of standingDocs) gm.track(d.uuid, d.kind);
  const swept = await gm.sweepTracked({ only: standingDocs.map((d) => d.uuid) });
  note("setup sweep (gm)", { removed: swept.removed.map((e) => e.uuid), missing: swept.missing.map((e) => e.uuid), failed: swept.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  if (swept.failed.length) throw new Error(`the standing import could not be cleared: ${swept.failed.map((e) => e.uuid).join(", ")}`);
  // A shelf the sweep emptied is the book's and goes; one that still holds a document is another's and stops the walk.
  const foreign = [];
  for (const s of standing.shelves) {
    const r = await run(gm, P.packEmpty, { collection: s.collection });
    note(`line shelf ${s.collection}`, r);
    if (r.kept) foreign.push(`${s.collection} holds ${r.kept}`);
  }
  if (foreign.length) throw new Error(`a line shelf holds documents that are not the book's, so it is left standing: ${foreign.join("; ")}`);

  // The shelf census brackets the GM census: a presence check (`importedActorFor`)
  // reads, and the world's packs before and after it are the proof. The line's
  // Actor shelf has to be absent beforehand for the proof to say anything — it
  // is the pack a presence check once minted on its way to reading it.
  const before = await run(gm, P.shelves, { line, open });
  note("shelves before", { packs: before.packs.length, line, open, lined: before.lined, openItems: before.open.Item, folders: Object.fromEntries(Object.entries(before.folders).map(([c, f]) => [c, f.length])) });
  check("the book's content files on its series' open line, apart from its Judge line", !!open && open !== line && !open.endsWith("Judge"), { line, open });
  check("the open line's Item shelf is not in the world before the run", before.open.Item === null, { open: before.open });
  let census = await run(gm, P.census, { book: BOOK, ids: IDS });
  note("gm census", census);
  const afterCensus = await run(gm, P.shelves, { line });
  const minted = afterCensus.packs.filter((c) => !before.packs.includes(c));
  check("the line's Actor shelf is not in the world before the census", before.lined.Actor === null, { lined: before.lined });
  check("the GM census opens no pack", !minted.length && afterCensus.packs.length === before.packs.length, { minted, packs: afterCensus.packs.length });
  check("the GM seat is a GM, the book is registered with a typography and the scoped import api is present", census.isGM && census.registered && census.typography && census.api, { bodyPt: census.bodyPt });
  const heldBefore = Object.entries(census.held).filter(([, u]) => u).map(([id]) => id);
  check("the world holds nothing under the book's ids before the run", !heldBefore.length, heldBefore);
  if (!census.isGM || !census.registered || !census.api || heldBefore.length) throw new Error("preconditions not met");

  section("1. connect the book");
  let connectNotes = [];
  // The world's shelf may open the book on the seat after ready; the open's
  // announcement is then not this run's to observe.
  const openedHere = !census.open;
  if (!census.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    const bs = await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open });
    connectNotes = bs.notes ?? [];
    note("book", { done: bs.done, ok: bs.ok, error: bs.error ?? null, open: bs.open, notes: connectNotes.length });
    census = await run(gm, P.census, { book: BOOK, ids: IDS });
  }
  check("1: the book is open this session", census.open);
  // The log keeps what the connect said; the console gets the verdict alone.
  note("connect notes", connectNotes);
  const opened = connectNotes.find((n) => n.kind === "info" && n.text.includes(census.label) && /\bopen\b/.test(n.text));
  if (openedHere) check("1: the open is announced by the book's label", !!opened, { count: opened ? (/(\d+) entr/.exec(opened.text)?.[1] ?? null) : null, notes: connectNotes.map((n) => n.kind) });
  else note("1: not checked", "the open's announcement: the seat had the book open before the run");
  if (!census.open) throw new Error("stopped before the imports");

  section("2. import the book");
  const powers = await runStep("2: abilities (powers)", "cookbookImportAbilities", { only: IDS.powers });
  const classes = await runStep("2: classes", "importClasses", { only: IDS.classes });
  // The person binds her class at import, so she follows the classes. Her
  // proficiencies are definitions the import supplies on demand from the
  // library's books, so the ids the library holds are read before the step:
  // a definition she carries afterwards under an id absent beforehand is this
  // run's, and is swept with the rest (step 3).
  const abilityIdsBefore = new Set(await run(gm, P.libraryAbilityIds));
  const keeper = await runStep("2: character", "cookbookImportIds", IDS.characters);
  const monsters = await runStep("2: monsters", "cookbookImportIds", IDS.actors);
  const items = await runStep("2: items", "cookbookImportAdventureItems", { books: [BOOK] });
  const journals = await runStep("2: journals", "cookbookImportJournals", { books: [BOOK] });
  // Track everything the run made: the classes, the items and the journals
  // from their own results, the rest read back by the ids this run imported,
  // which the census proved absent beforehand.
  for (const uuid of classes.result?.docs ?? []) if (uuid) gm.track(uuid, "Item");
  for (const uuid of items.result?.created?.items ?? []) if (uuid) gm.track(uuid, "Item");
  for (const uuid of journals.result?.created?.journals ?? []) if (uuid) gm.track(uuid, "JournalEntry");
  const held = await run(gm, P.heldNow, { ids: { items: [...IDS.powers, ...IDS.classes], actors: [...IDS.actors, ...IDS.characters] } });
  // The classes are tracked from the step's own result above.
  for (const [id, uuid] of Object.entries(held)) if (uuid && !IDS.classes.includes(id)) gm.track(uuid, IDS.actors.includes(id) || IDS.characters.includes(id) ? "Actor" : "Item");
  // The monster step may also mint the monster's leaders template; it is this run's, read back by the monster ids.
  const leaderUuids = await run(gm, P.leaders, { ids: IDS.actors, line });
  for (const uuid of leaderUuids) gm.track(uuid, "Actor");
  const classUuids = IDS.classes.map((id) => held[id]).filter(Boolean);
  const after = await run(gm, P.shelves, { line, open });
  for (const c of after.packs.filter((c) => !before.packs.includes(c))) openedPacks.push(c);
  for (const [collection, uuids] of Object.entries(after.folders)) {
    if (openedPacks.includes(collection)) continue; // goes with the pack
    for (const uuid of uuids.filter((u) => !(before.folders[collection] ?? []).includes(u))) gm.track(uuid, "Folder");
  }
  note("shelves opened by this run", openedPacks);
  check("2: the import, not the census, opened the line's Actor shelf", !!after.lined.Actor && openedPacks.includes(after.lined.Actor), { actor: after.lined.Actor, opened: openedPacks });

  check("2: as many powers imported as the cookbook lists, none already held", IDS.powers.length > 0 && powers.result?.made === IDS.powers.length && powers.result?.reused === 0, powers.result);
  check("2: as many classes imported as the cookbook lists, and each stands", IDS.classes.length > 0 && (classes.result?.docs ?? []).length === IDS.classes.length && classUuids.length === IDS.classes.length, { made: (classes.result?.docs ?? []).length, stand: classUuids.length });
  check("2: as many monsters imported as the cookbook lists", IDS.actors.length > 0 && monsters.result?.value === IDS.actors.length, monsters.result);
  check("2: as many people the page prints in full imported as the cookbook lists", IDS.characters.length > 0 && keeper.result?.value === IDS.characters.length, keeper.result);
  const it = items.result ?? {};
  check("2: every item the cookbook lists imported, none already present, none refused", IDS.adventureItems.length > 0 && it.made === IDS.adventureItems.length && it.already === 0 && it.refused === 0, it);
  check("2: the import, not the census, opened the line's Item shelf", !!after.lined.Item && openedPacks.includes(after.lined.Item), { item: after.lined.Item });
  check("2: the classes and powers stand on the series' open Item shelf, opened by the import, apart from the Judge's",
    !!after.open.Item && openedPacks.includes(after.open.Item) && after.open.Item !== after.lined.Item,
    { open: after.open.Item, judge: after.lined.Item, opened: openedPacks.includes(after.open.Item) });
  const itemShapes = [];
  for (const uuid of it.created?.items ?? []) itemShapes.push(await run(gm, P.power, { uuid }));
  check("2: each cookbook item stands once, as a core item with the paragraphs its entry lists and a page reference",
    itemShapes.length === IDS.adventureItems.length && new Set(itemShapes.map((p) => p?.id)).size === IDS.adventureItems.length
      && itemShapes.every((p) => p && p.type === "item" && IDS.paras[p.id] > 0 && p.paragraphs === IDS.paras[p.id] && p.cite),
    itemShapes.map((p) => p && { type: p.type, paragraphs: p.paragraphs, boxes: IDS.paras[p.id], chars: p.chars }));
  check("2: each item is priced from its cost line", itemShapes.length === IDS.adventureItems.length && itemShapes.every((p) => p && p.cost > 0), itemShapes.map((p) => p?.cost));
  const slotNames = await run(gm, P.wearSlots);
  const slotted = itemShapes.filter((p) => p?.slots?.length);
  const unslotted = itemShapes.filter((p) => p && !p.slots?.length);
  check("2: an item declares at most one slot, every slotted item is marked magic and every unslotted one is not, both kinds occur, and each slot is one of the module's",
    itemShapes.every((p) => p && (p.slots?.length ?? 0) <= 1) && slotted.length > 0 && unslotted.length > 0
      && slotted.every((p) => p.magic && slotNames.includes(p.slots[0])) && unslotted.every((p) => !p.magic),
    itemShapes.map((p) => p && { slots: p.slots, magic: p.magic }));
  const jr = journals.result ?? {};
  const proseIds = Object.keys(IDS.prose);
  check("2: every passage the cookbook lists written as a page, none refused, one journal made per group",
    proseIds.length > 0 && IDS.groups.length > 0 && jr.made === proseIds.length && jr.refused === 0 && (jr.created?.journals ?? []).length === IDS.groups.length, jr);
  const journalShapes = [];
  for (const uuid of jr.created?.journals ?? []) journalShapes.push(await run(gm, P.journal, { uuid }));
  note("journals", journalShapes.map((j) => j && { ...j, pages: j.pages.map(({ shape, ...rest }) => ({ ...rest, shape: shape.length })) }));
  const pages = journalShapes.flatMap((j) => j?.pages ?? []);
  check("2: the journals are named by the cookbook's groups and stand on the line's Judge JournalEntry shelf",
    journalShapes.length === IDS.groups.length && journalShapes.every((j) => j && j.judge && j.line === line) && journalShapes.map((j) => j.name).sort().join("|") === IDS.groups.join("|"),
    journalShapes.map((j) => j && { name: j.name, line: j.line }));
  check("2: each page is titled by what its passage is, holds its paragraphs and closes with a page reference",
    pages.length === proseIds.length && pages.every((p) => p.paragraphs >= 1 && p.cite && IDS.prose[p.id] === p.name),
    pages.map((p) => ({ name: p.name, paragraphs: p.paragraphs, cite: p.cite })));
  // A page joins boxes the PDF cut at a column or a page and never splits one, so
  // its paragraphs number at most its entry's boxes; a paragraph closes on terminal
  // punctuation unless it is a list or stat line, and the next never opens in lower case
  // after one that did not close.
  const pageReads = pages.map((p) => {
    const sh = (p.shape ?? []).map((s) => ({ ...s, list: s.marker || s.labelled || s.labelRun }));
    return {
      paragraphs: p.paragraphs, boxes: IDS.proseParas[p.id] ?? null,
      unclosed: sh.filter((s) => !s.terminal && !s.list).length,
      cut: sh.filter((s, i) => i > 0 && !sh[i - 1].terminal && !sh[i - 1].list && s.lowerOpen && !s.list).length,
      listLines: sh.filter((s) => s.list).length,
      unclosedAt: sh.map((s, i) => (!s.terminal && !s.list ? { i, of: sh.length, end: s.end, short: s.short, nextLower: !!sh[i + 1]?.lowerOpen } : null)).filter(Boolean),
    };
  });
  check("2: the passages read whole — a page holds no more paragraphs than its entry has boxes, none closes short, none is cut mid-sentence",
    pages.length === proseIds.length && pageReads.every((r) => r.paragraphs >= 1 && r.boxes > 0 && r.paragraphs <= r.boxes && r.unclosed === 0 && r.cut === 0), pageReads);
  // A class stated in sentences imports with its levels, so binding the
  // keeper's class finds rows and the character step raises no warning.
  const keeperNoise = keeper.notes.filter((n) => n.kind === "error" || n.kind === "warn");
  check("2: the character step warns of nothing", !keeperNoise.length, keeperNoise.map((n) => n.kind));
  const stepErrors = [powers, classes, monsters, items, journals].flatMap((s) => s.notes.filter((n) => n.kind === "error" || n.kind === "warn"));
  check("2: no other step warned or erred", !stepErrors.length, stepErrors.map((n) => n.kind));
  const powerShapes = [];
  for (const id of IDS.powers) powerShapes.push(held[id] ? await run(gm, P.power, { uuid: held[id] }) : null);
  check("2: each power holds the paragraphs its cookbook entry lists and a page reference",
    IDS.powers.length > 0 && powerShapes.every((p, i) => p && IDS.paras[IDS.powers[i]] > 0 && p.paragraphs === IDS.paras[IDS.powers[i]] && p.cite),
    powerShapes.map((p, i) => p && { type: p.type, paragraphs: p.paragraphs, boxes: IDS.paras[IDS.powers[i]], chars: p.chars }));

  section("3. the monster");
  const monsterId = IDS.actors[0];
  const m = held[monsterId] ? await run(gm, P.monster, { uuid: held[monsterId] }) : null;
  note("monster", m);
  check("3: AC, HD, movement, morale, XP, alignment, treasure, saves, vision and type landed", !!m && m.ac != null && !!m.hd && m.movement > 0 && m.morale != null && m.xp != null && m.alignment && m.treasure && m.saves > 0 && m.vision > 0 && m.types > 0);
  check("3: at least two attack modes, each with at least one attack", !!m && m.modes.length >= 2 && m.modes.every((n) => n > 0), m && { weapons: m.weapons, modes: m.modes });
  check("3: a proficiency list rides as embedded abilities", !!m && m.abilities > 0, m && { abilities: m.abilities });
  check("3: spoils, each with a value, a weight and effects", !!m && m.spoils.length >= 1 && m.spoils.every((s) => s.cost > 0 && s.weight6 != null && s.effects > 0), m && m.spoils);
  const combat = m?.sections.find((s) => s.field === "combat");
  check("3: the prose is sectioned, and the Combat section's last paragraph is whole across the page turn", !!m && m.sections.length >= 3 && !!combat && combat.lastEndsSentence, m && m.sections);

  const keeperId = IDS.characters[0];
  const k = held[keeperId] ? await run(gm, P.character, { uuid: held[keeperId] }) : null;
  note("character", k);
  const onDemand = (k?.abilityIds ?? []).filter((id) => !abilityIdsBefore.has(id));
  const onDemandHeld = onDemand.length ? await run(gm, P.heldNow, { ids: { items: onDemand } }) : {};
  for (const uuid of Object.values(onDemandHeld)) if (uuid) gm.track(uuid, "Item");
  note("definitions the character step imported on demand (tracked)", onDemandHeld);
  check("3: the person the page prints in full is a character, named from the page, owned by the Judges alone", !!k && k.type === "character" && k.namedFromPage && k.ownership === 0, k && { type: k.type, namedFromPage: k.namedFromPage, ownership: k.ownership });
  check("3: her class is a class the library answers, bound at the printed level, with the scores and hit points written", !!k && k.classBound && k.level > 0 && k.scores === 6 && k.hp[1] > 0 && k.hp[0] === k.hp[1], k && { className: k.className, classBound: k.classBound, level: k.level, scores: k.scores, hp: k.hp });
  check("3: the proficiencies the library answers ride as embedded abilities, and the rest are counted as printed", !!k && k.abilities >= 1 && Number.isInteger(k.printed?.missing), k && { abilities: k.abilities, printed: k.printed });
  check("3: the inventory is worn and the coin is counted", !!k && k.gear >= 1 && k.gp > 0, k && { gear: k.gear, gp: k.gp > 0 });
  check("3: the biography is the page's paragraph about her house with its page reference, then the as-printed block", !!k && k.prose >= 1 && k.cite && k.asPrinted, k && { prose: k.prose, cite: k.cite, asPrinted: k.asPrinted });
  // The Follower Card's wear toggle, pressed for real on a copy of a hand-worn
  // item embedded on her: the card offers a slotted plain item and wears it at
  // its declared slot, which core's `equipped` field never could. "hands" is the
  // module's slot name.
  const handWornUuid = (it.created?.items ?? [])[itemShapes.findIndex((p) => p?.slots?.[0] === "hands")] ?? null;
  const wear = held[keeperId] && handWornUuid ? await run(gm, P.wearOnCard, { actorUuid: held[keeperId], itemUuid: handWornUuid }) : null;
  note("a hand-worn item on her Follower Card", wear);
  check("3: a copy of a hand-worn item embedded on her is offered on her Follower Card, worn at the hands by its toggle, put away by the next press, and removed", !!wear && wear.offered && wear.wornBefore === "" && wear.wornAt === "hands" && wear.pressed === "true" && wear.wornAfter === "" && wear.removed, wear);

  section("4. the classes");
  const classShapes = [];
  for (const uuid of classUuids) classShapes.push(await run(gm, P.classItem, { uuid }));
  note("classes", classShapes);
  check("4: each class carries its hit die, maximum level, prime requisite and requirements", classShapes.length === IDS.classes.length && IDS.classes.length > 0 && classShapes.every((c) => c && c.hitDie && c.maximumLevel > 0 && c.keyAttributes > 0 && c.requirements > 0));
  check("4: the list resolves names the register knows and keeps the rest as text, none welded at a line turn", classShapes.every((c) => c && c.resolved > 0 && !c.unresolved.some(welded)), classShapes.map((c) => c && { resolved: c.resolved, unresolved: c.unresolved.length, welded: c.unresolved.filter(welded).length }));
  check("4: each description runs the whole spread, with passages opened by run-in labels", classShapes.every((c) => c && c.paragraphs >= 2 && c.runIn >= 1), classShapes.map((c) => c && { paragraphs: c.paragraphs, runIn: c.runIn }));
  // The chassis a class declares is its cookbook entry's, read back by the class's id.
  check("4: each class declares the saves and attack chassis its cookbook entry names",
    classShapes.length === IDS.classes.length && classShapes.every((c) => { const want = IDS.chassis[c?.id]; return !!want?.saves && !!want?.attack && c.chassis[0] === want.saves && c.chassis[1] === want.attack; }),
    classShapes.map((c) => c && { saves: c.chassis[0] === IDS.chassis[c.id]?.saves, attack: c.chassis[1] === IDS.chassis[c.id]?.attack }));

  section("5. the book's plans");
  const scenesStep = await runStep("5: scenes", "cookbookImportScenes", { books: [BOOK] });
  const made = scenesStep.result?.created ?? {};
  for (const uuid of made.scenes ?? []) gm.track(uuid, "Scene");
  for (const uuid of made.actors ?? []) gm.track(uuid, "Actor");
  for (const uuid of made.folders ?? []) gm.track(uuid, "Folder");
  const sc = scenesStep.result ?? {};
  check("5: as many maps created as the cookbook lists, none refused, none already held", IDS.scenes.length > 0 && sc.made === IDS.scenes.length && sc.refused === 0 && sc.already === 0 && sc.gridRefused === 0, { made: sc.made, refused: sc.refused, already: sc.already, gridRefused: sc.gridRefused, created: (made.scenes ?? []).length });
  const sceneShapes = [];
  for (const uuid of made.scenes ?? []) sceneShapes.push(await run(gm, P.scene, { uuid }));
  note("scenes", sceneShapes);
  check("5: each map is a gridless world scene with its picture, off the navigation bar, in the book's folder, with no token and no wall", sceneShapes.length === IDS.scenes.length && sceneShapes.every((s) => s && s.picture && s.gridless && !s.navigation && s.folder && s.width > 0 && s.height > 0 && s.tokens === 0 && s.walls === 0 && s.book === BOOK));
  note("map pictures left under (outside the ledger)", [...new Set(sceneShapes.map((s) => s?.pictureDir))]);

  section("6. the book's Adventure");
  const adv = await runStep("6: adventures", "cookbookImportAdventures", { books: [BOOK] });
  for (const uuid of adv.result?.created?.adventures ?? []) gm.track(uuid, "Adventure");
  const later = await run(gm, P.shelves, { line, open });
  for (const c of later.packs.filter((c) => !before.packs.includes(c) && !openedPacks.includes(c))) openedPacks.push(c);
  note("shelves opened by the adventure step", adv.result?.created?.packs ?? []);
  const ad = adv.result ?? {};
  check("6: one Adventure written, for this book alone, nothing failed", ad.written === 1 && ad.failed === 0 && Object.keys(ad.books ?? {}).length === 1 && (ad.created?.adventures ?? []).length === 1, { written: ad.written, kept: ad.kept, empty: ad.empty, failed: ad.failed, books: Object.keys(ad.books ?? {}) });
  const advUuid = ad.created?.adventures?.[0] ?? null;
  const a = advUuid ? await run(gm, P.adventure, { uuid: advUuid }) : null;
  note("adventure", a);
  // A monster's leaders template rides with it, so the actors are the monsters, the people and those templates.
  check("6: it carries every map, monster, person and item the cookbook lists under the book's stamp, and each monster's leaders template", !!a && a.scenes === IDS.scenes.length && a.actors === IDS.actors.length + IDS.characters.length + leaderUuids.length && a.items === IDS.adventureItems.length && IDS.scenes.length > 0 && IDS.adventureItems.length > 0 && a.book === BOOK, a && { scenes: a.scenes, actors: a.actors, items: a.items });
  const advShelf = advUuid ? await run(gm, P.shelfOf, { uuid: advUuid }) : null;
  const monsterShelf = held[monsterId] ? await run(gm, P.shelfOf, { uuid: held[monsterId] }) : null;
  const keeperShelf = held[keeperId] ? await run(gm, P.shelfOf, { uuid: held[keeperId] }) : null;
  const classShelf = classUuids[0] ? await run(gm, P.shelfOf, { uuid: classUuids[0] }) : null;
  const itemShelf = it.created?.items?.[0] ? await run(gm, P.shelfOf, { uuid: it.created.items[0] }) : null;
  note("where they stand", { adventure: advShelf, monster: monsterShelf, keeper: keeperShelf, item: itemShelf, class: classShelf });
  check("6: the Adventure, the monster, the keeper and the items stand on the line's Judge shelves, the class on the series' open Item shelf", !!advShelf?.judge && !!monsterShelf?.judge && !!keeperShelf?.judge && !!itemShelf?.judge && !!classShelf?.pack && classShelf.line === open && !classShelf.judge);
  const classFolder = classUuids[0] ? await run(gm, P.folderOf, { uuid: classUuids[0] }) : null;
  note("the class's folder", classFolder);
  check("6: the class is filed in its shelf folder inside the same pack, not dropped at the root", !!classFolder?.folder && classFolder.folderPack === classFolder.pack, classFolder);
  if (SHOTS && journalShapes.length) {
    const most = journalShapes.reduce((m, j, i) => ((j?.pages?.length ?? 0) > (journalShapes[m]?.pages?.length ?? 0) ? i : m), 0);
    const frame = await run(gm, P.journalToc, { uuid: jr.created.journals[most] });
    note("plate journal", frame);
    await plate(gm, "importer-journals", frame);
  }
  if (SHOTS && held[IDS.characters[0]]) {
    const frame = await run(gm, P.sheetOnStats, { uuid: held[IDS.characters[0]] });
    note("plate character", frame);
    await plate(gm, "importer-character-writeup", frame);
  }

  section("7. the Player seat");
  const player = await seat("player");
  note("install (player)", await run(player, P.install));
  const view = await run(player, P.seatView, { line, open, ids: IDS });
  note("player view", view);
  check("7: the seat is a player", view.isGM === false);
  check("7: no shelf of the Judge line is open to it", !view.anyLinedVisible, { linedPacksSeen: view.lined.length, gmSaw: Object.keys(later.folders).length });
  check("7: the series' open Item shelf is, with the book's classes and powers in it", !!view.openItems?.visible && view.openItems.line === open && view.classesSeen === view.classesWanted && view.classesWanted === IDS.items.length && IDS.items.length > 0, { seen: view.classesSeen, wanted: view.classesWanted, shelf: view.openItems });
  if (SHOTS && view.openItems?.collection) {
    const frame = await run(player, P.shelfPopout, { collection: view.openItems.collection });
    note("plate shelf", frame);
    await plate(player, "importer-open-shelf", frame);
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("8. teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  // Every step is setup, and the import is what the next run's first import needs absent: all of it goes.
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of openedPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
