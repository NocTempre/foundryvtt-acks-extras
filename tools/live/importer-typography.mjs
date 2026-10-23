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
 * The run expects a world that holds nothing under the book's ids. With
 * HELD_OK=1, the library owner's go-ahead, a document already standing under
 * one of them is the owner's: a held class or power is first rebuilt from the
 * open book through the entry picker, under its id, so the shapes read are
 * the book's and not whatever the owner's import could make without it; the
 * steps then skip or reuse it as they do for any world, and it is never
 * tracked, so the sweep leaves it where it stood.
 *
 * Writes outside the fixture ledger, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the GM seat's notification methods, patched to read what a run says
 *     (put back at teardown);
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

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = "cat";
// Each passage's page title with the paragraphs its page prints, as the seat
// materializes them (read against the page by hand on 2026-10-23): a short
// count is a passage cut at a column or a page, a long one a list read as
// lines.
const PROSE_PARAS = "Conversion notes:5 Cultures:20 Design notes:7 Generic class:4 Introduction:7 Race:5 Tavern:6";
const BOOKS = books([BOOK]);
const HELD_OK = process.env.HELD_OK === "1";

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
  /** A journal the journals step made: its name, its shelf, and each page's title, paragraph count and page reference. */
  journal: async ({ uuid }) => {
    const H = globalThis.__bt;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const line = doc.pack ? H.LIB.lineOfPack(doc.pack) : null;
    const pages = doc.pages.contents.map((p) => {
      const html = String(p.text?.content ?? "");
      return { name: p.name, paragraphs: (html.match(/<p>/g) ?? []).length, cite: /<p class=/.test(html), chars: html.replace(/<[^>]*>/g, "").length };
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
  /** Run the entry picker over `picks` (`[key, id]` pairs), answer its confirm, and resolve when its refill is done. */
  rebuild: async ({ picks }) => {
    const find = (pred) => [...foundry.applications.instances.values()].find((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered && pred(a));
    const wait = async (pred, tries = 120) => {
      for (let n = 0; n < tries; n++) {
        const a = find(pred);
        if (a) return a;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    };
    globalThis.__btRebuild = { done: false };
    acksExtras.importer.cookbookReimportEntries()
      .then((r) => { globalThis.__btRebuild = { done: true, result: r ?? null }; })
      .catch((e) => { globalThis.__btRebuild = { done: true, error: String(e?.message ?? e) }; });
    const picker = await wait((a) => !!a.element?.querySelector(".acks-extras-importer-mon-list"));
    if (!picker) return { picker: false };
    const boxes = picks.map(([key, id]) => picker.element.querySelector(`input[name="sel"][value="${key}|${id}"]`));
    const absent = picks.filter((_, i) => !boxes[i]).map(([key, id]) => `${key}|${id}`);
    if (absent.length) return { picker: true, row: false, absent };
    for (const box of boxes) box.checked = true;
    picker.element.querySelector('button[data-action="ok"]')?.click();
    const confirm = await wait((a) => a !== picker && !!a.element?.querySelector('button[data-action="yes"]'));
    if (!confirm) return { picker: true, row: true, confirm: false };
    confirm.element.querySelector('button[data-action="yes"]').click();
    return { picker: true, row: true, confirm: true };
  },
  rebuildState: async () => globalThis.__btRebuild,
  /** Each document's creation time, by uuid. */
  created: async ({ uuids }) => {
    const out = {};
    for (const u of uuids) out[u] = (await fromUuid(u))?._stats?.createdTime ?? null;
    return out;
  },
  /** The uuid the world now holds under each id — the import's own documents, read back by the ids it was given. */
  heldNow: async ({ ids }) => {
    const H = globalThis.__bt;
    const held = {};
    for (const id of ids.items ?? []) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    for (const id of ids.actors ?? []) held[id] = (await H.CB.importedActorFor(id))?.uuid ?? null;
    return held;
  },
  /** A class-power item: its type and how many paragraphs its description holds. */
  power: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const html = String(doc.system?.description ?? "");
    // Bare `<p>` is a printed paragraph; the page reference closes the text as a classed one.
    return { type: doc.type, paragraphs: (html.match(/<p>/g) ?? []).length, cite: /<p class=/.test(html), chars: html.replace(/<[^>]*>/g, "").length };
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
      type: doc.type, hitDie: !!s.hitDie, maximumLevel: s.maximumLevel ?? null,
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
    // Its folders go with it: a pack this run opened holds only the folders its imports filed.
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
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
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
  const ids = { items: [], actors: [], characters: [], classes: [], powers: [], scenes: [], adventureItems: [], prose: {} };
  const dir = path.join(ROOT, "cookbook");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "registers.json") continue;
    const cb = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (cb.book?.id === book) for (const [id, row] of Object.entries(cb.scenes ?? {})) if (row?.kind === "kind.scene") ids.scenes.push(id);
    for (const [id, e] of Object.entries(cb.entries ?? {})) {
      if ((e.book ?? cb.book?.id) !== book) continue;
      if (e.kind === "kind.class") { ids.classes.push(id); ids.items.push(id); }
      else if (e.kind === "kind.power") { ids.powers.push(id); ids.items.push(id); }
      else if (e.kind === "kind.monster") ids.actors.push(id);
      else if (e.kind === "kind.npc" && e.meta?.actor === "character") ids.characters.push(id);
      else if (e.kind === "kind.adventureItem") ids.adventureItems.push(id);
      else if (e.kind === "kind.prose") ids.prose[id] = e.meta?.title ?? e.name;
    }
  }
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
  // The shelf census brackets the GM census: a presence check (`importedActorFor`)
  // reads, and the world's packs before and after it are the proof. The line's
  // Actor shelf has to be absent beforehand for the proof to say anything — it
  // is the pack a presence check once minted on its way to reading it.
  const line = await run(gm, P.line, { book: BOOK });
  const open = await run(gm, P.openLine, { book: BOOK });
  const before = await run(gm, P.shelves, { line, open });
  note("shelves before", { packs: before.packs.length, line, open, lined: before.lined, openItems: before.open.Item, folders: Object.fromEntries(Object.entries(before.folders).map(([c, f]) => [c, f.length])) });
  check("the book's content files on its series' open line, apart from its Judge line", !!open && open !== line && !open.endsWith("Judge"), { line, open });
  check(HELD_OK ? "the open line's Item shelf is read as it stands (HELD_OK=1: the owner's)" : "the open line's Item shelf is not in the world before the run", HELD_OK || before.open.Item === null, { open: before.open });
  let census = await run(gm, P.census, { book: BOOK, ids: IDS });
  note("gm census", census);
  const afterCensus = await run(gm, P.shelves, { line });
  const minted = afterCensus.packs.filter((c) => !before.packs.includes(c));
  check("the line's Actor shelf is not in the world before the census", before.lined.Actor === null, { lined: before.lined });
  check("the GM census opens no pack", !minted.length && afterCensus.packs.length === before.packs.length, { minted, packs: afterCensus.packs.length });
  check("the GM seat is a GM, the book is registered with a typography and the scoped import api is present", census.isGM && census.registered && census.typography && census.api, { bodyPt: census.bodyPt });
  const heldBefore = Object.entries(census.held).filter(([, u]) => u).map(([id]) => id);
  // A document standing before the run is never this run's to track.
  const theirs = new Set(Object.values(census.held).filter(Boolean));
  const mine = (uuid) => !!uuid && !theirs.has(uuid);
  const heldOf = (ids) => ids.filter((id) => census.held[id]).length;
  check(HELD_OK ? "what the world holds under the book's ids is the owner's (HELD_OK=1: never tracked)" : "the world holds nothing under the book's ids before the run", HELD_OK || !heldBefore.length, heldBefore);
  if (!census.isGM || !census.registered || !census.api || (heldBefore.length && !HELD_OK)) throw new Error("preconditions not met");

  section("1. connect the book");
  let connectNotes = [];
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
  check("1: the open is announced by the book's label", !!opened, { count: opened ? (/(\d+) entr/.exec(opened.text)?.[1] ?? null) : null, notes: connectNotes.map((n) => n.kind) });
  if (!census.open) throw new Error("stopped before the imports");

  const heldItems = [...IDS.powers, ...IDS.classes].filter((id) => census.held[id]);
  if (HELD_OK && heldItems.length) {
    section("1a. the owner's classes and powers, rebuilt from the open book");
    const was = heldItems.map((id) => census.held[id]);
    const t0 = await run(gm, P.created, { uuids: was });
    await sleep(1100); // a rebuilt document's creation time must be able to differ
    const picks = heldItems.map((id) => [IDS.classes.includes(id) ? "Classes" : "Abilities", id]);
    const drove = await run(gm, P.rebuild, { picks });
    check("1a: the entry picker lists every held class and power, and its confirm is answered", drove.picker && drove.row && drove.confirm, drove);
    const rb = await poll(gm, P.rebuildState, undefined, { tries: 150 });
    if (rb?.error) throw new Error(`the rebuild threw: ${rb.error}`);
    const now = await run(gm, P.heldNow, { ids: { items: heldItems } });
    // Whatever stands under a held id now is still the owner's.
    for (const id of heldItems) if (now[id]) theirs.add(now[id]);
    const t1 = await run(gm, P.created, { uuids: heldItems.map((id) => now[id]).filter(Boolean) });
    // A rebuild deletes and creates, so the document id is new; the pack is the shelf.
    const packOf = (uuid) => uuid?.split(".").slice(0, -2).join(".") ?? null;
    const kept = heldItems.filter((id) => now[id] && packOf(now[id]) === packOf(census.held[id]));
    const rebuilt = kept.filter((id) => t1[now[id]] > t0[census.held[id]]);
    check("1a: each is rebuilt on the shelf it stood on (the owner's, never tracked)", kept.length === heldItems.length && rebuilt.length === heldItems.length,
      { held: heldItems.length, kept: kept.length, rebuilt: rebuilt.length });
  }

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
  for (const uuid of classes.result?.docs ?? []) if (mine(uuid)) gm.track(uuid, "Item");
  for (const uuid of items.result?.created?.items ?? []) if (mine(uuid)) gm.track(uuid, "Item");
  for (const uuid of journals.result?.created?.journals ?? []) if (mine(uuid)) gm.track(uuid, "JournalEntry");
  const held = await run(gm, P.heldNow, { ids: { items: [...IDS.powers, ...IDS.classes], actors: [...IDS.actors, ...IDS.characters] } });
  // The classes are tracked from the step's own result above.
  for (const [id, uuid] of Object.entries(held)) if (mine(uuid) && !IDS.classes.includes(id)) gm.track(uuid, IDS.actors.includes(id) || IDS.characters.includes(id) ? "Actor" : "Item");
  const classUuids = IDS.classes.map((id) => held[id]).filter(Boolean);
  const after = await run(gm, P.shelves, { line, open });
  for (const c of after.packs.filter((c) => !before.packs.includes(c))) openedPacks.push(c);
  for (const [collection, uuids] of Object.entries(after.folders)) {
    if (openedPacks.includes(collection)) continue; // goes with the pack
    for (const uuid of uuids.filter((u) => !(before.folders[collection] ?? []).includes(u))) gm.track(uuid, "Folder");
  }
  note("shelves opened by this run", openedPacks);
  check("2: the import, not the census, opened the line's Actor shelf", !!after.lined.Actor && openedPacks.includes(after.lined.Actor), { actor: after.lined.Actor, opened: openedPacks });

  check("2: five class powers imported, any already held reused", powers.result?.made === IDS.powers.length - heldOf(IDS.powers) && powers.result?.reused === heldOf(IDS.powers) && IDS.powers.length === 5, { ...powers.result, held: heldOf(IDS.powers) });
  check("2: three classes imported, any already held skipped, and all three stand", (classes.result?.docs ?? []).length === IDS.classes.length - heldOf(IDS.classes) && classUuids.length === 3 && IDS.classes.length === 3, { made: (classes.result?.docs ?? []).length, held: heldOf(IDS.classes), stand: classUuids.length });
  check("2: one monster imported", monsters.result?.value === 1 && IDS.actors.length === 1, monsters.result);
  check("2: the person the page prints in full imported, one", keeper.result?.value === 1 && IDS.characters.length === 1, keeper.result);
  const it = items.result ?? {};
  check("2: ten items imported, none already present, none refused", it.made === IDS.adventureItems.length && IDS.adventureItems.length === 10 && it.already === 0 && it.refused === 0, it);
  check("2: the import, not the census, opened the line's Item shelf", !!after.lined.Item && openedPacks.includes(after.lined.Item), { item: after.lined.Item });
  check("2: the classes and powers stand on the series' open Item shelf, opened by the import or the owner's own, apart from the Judge's",
    !!after.open.Item && (openedPacks.includes(after.open.Item) || (HELD_OK && after.open.Item === before.open.Item)) && after.open.Item !== after.lined.Item,
    { open: after.open.Item, judge: after.lined.Item, opened: openedPacks.includes(after.open.Item) });
  const itemShapes = [];
  for (const uuid of it.created?.items ?? []) itemShapes.push(await run(gm, P.power, { uuid }));
  check("2: each item is a core item of one paragraph with a page reference", itemShapes.length === 10 && itemShapes.every((p) => p && p.type === "item" && p.paragraphs === 1 && p.cite), itemShapes.map((p) => p && { type: p.type, paragraphs: p.paragraphs, chars: p.chars }));
  const jr = journals.result ?? {};
  const proseIds = Object.keys(IDS.prose);
  check("2: seven passages written as pages, none refused, two journals made", jr.made === proseIds.length && proseIds.length === 7 && jr.refused === 0 && (jr.created?.journals ?? []).length === 2, jr);
  const journalShapes = [];
  for (const uuid of jr.created?.journals ?? []) journalShapes.push(await run(gm, P.journal, { uuid }));
  note("journals", journalShapes);
  const pages = journalShapes.flatMap((j) => j?.pages ?? []);
  check("2: the journals are named by group and stand on the line's Judge JournalEntry shelf", journalShapes.length === 2 && journalShapes.every((j) => j && j.judge && j.line === line) && journalShapes.map((j) => j.name).sort().join("|") === "Essays|Tavern", journalShapes.map((j) => j && { name: j.name, line: j.line }));
  check("2: each page is titled by what the passage is, holds its paragraphs and closes with a page reference", pages.length === 7 && pages.every((p) => p.paragraphs >= 1 && p.cite && Object.values(IDS.prose).includes(p.name)), pages.map((p) => ({ name: p.name, paragraphs: p.paragraphs, cite: p.cite })));
  check("2: the passages read whole — their paragraph counts are the page's", pages.map((p) => `${p.name}:${p.paragraphs}`).sort().join(" ") === PROSE_PARAS, pages.map((p) => `${p.name}:${p.paragraphs}`).sort().join(" "));
  // The book prints its classes' progression tables as pictures, so binding
  // the keeper's class warns that it has no rows yet; that one warning is the
  // page's, and the only one the character step may raise.
  const progressionWarn = (n) => n.kind === "warn" && /no progression rows/.test(n.text);
  const keeperNoise = keeper.notes.filter((n) => n.kind === "error" || n.kind === "warn");
  check("2: the character step warns of the class's missing progression (its tables are pictures) and of nothing else", keeperNoise.length === 1 && progressionWarn(keeperNoise[0]), keeperNoise.map((n) => n.kind));
  const stepErrors = [powers, classes, monsters, items, journals].flatMap((s) => s.notes.filter((n) => n.kind === "error" || n.kind === "warn"));
  check("2: no other step warned or erred", !stepErrors.length, stepErrors.map((n) => n.kind));
  const powerShapes = [];
  for (const id of IDS.powers) powerShapes.push(held[id] ? await run(gm, P.power, { uuid: held[id] }) : null);
  check("2: each power is one paragraph with a page reference", powerShapes.every((p) => p && p.paragraphs === 1 && p.cite), powerShapes.map((p) => p && { type: p.type, paragraphs: p.paragraphs, chars: p.chars }));

  section("3. the monster");
  const monsterId = IDS.actors[0];
  const m = held[monsterId] ? await run(gm, P.monster, { uuid: held[monsterId] }) : null;
  note("monster", m);
  check("3: AC, HD, movement, morale, XP, alignment, treasure, saves, vision and type landed", !!m && m.ac != null && !!m.hd && m.movement > 0 && m.morale != null && m.xp != null && m.alignment && m.treasure && m.saves > 0 && m.vision > 0 && m.types > 0);
  check("3: three natural attacks in the first mode and the weapon alternative as a second", !!m && m.modes.length === 2 && m.modes[0] === 3 && m.modes[1] === 1, m && { weapons: m.weapons, modes: m.modes });
  check("3: a proficiency list rides as embedded abilities", !!m && m.abilities > 0, m && { abilities: m.abilities });
  check("3: two spoils, each with a value, a weight and effects", !!m && m.spoils.length === 2 && m.spoils.every((s) => s.cost > 0 && s.weight6 != null && s.effects > 0), m && m.spoils);
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

  section("4. the classes");
  const classShapes = [];
  for (const uuid of classUuids) classShapes.push(await run(gm, P.classItem, { uuid }));
  note("classes", classShapes);
  check("4: each class carries its hit die, maximum level, prime requisite and requirements", classShapes.length === 3 && classShapes.every((c) => c && c.hitDie && c.maximumLevel > 0 && c.keyAttributes > 0 && c.requirements > 0));
  check("4: the list resolves names the register knows and keeps the rest as text, none welded at a line turn", classShapes.every((c) => c && c.resolved > 0 && !c.unresolved.some(welded)), classShapes.map((c) => c && { resolved: c.resolved, unresolved: c.unresolved.length, welded: c.unresolved.filter(welded).length }));
  check("4: each description runs the whole spread, with passages opened by run-in labels", classShapes.every((c) => c && c.paragraphs >= 9 && c.runIn >= 1), classShapes.map((c) => c && { paragraphs: c.paragraphs, runIn: c.runIn }));
  check("4: the declared chassis is fighter/fighter", classShapes.every((c) => c && c.chassis[0] === "fighter" && c.chassis[1] === "fighter"));

  section("5. the tavern's plans");
  const scenesStep = await runStep("5: scenes", "cookbookImportScenes", { books: [BOOK] });
  const made = scenesStep.result?.created ?? {};
  for (const uuid of made.scenes ?? []) gm.track(uuid, "Scene");
  for (const uuid of made.actors ?? []) gm.track(uuid, "Actor");
  for (const uuid of made.folders ?? []) gm.track(uuid, "Folder");
  const sc = scenesStep.result ?? {};
  check("5: two maps created, none refused, none already held", sc.made === IDS.scenes.length && IDS.scenes.length === 2 && sc.refused === 0 && sc.already === 0 && sc.gridRefused === 0, { made: sc.made, refused: sc.refused, already: sc.already, gridRefused: sc.gridRefused, created: (made.scenes ?? []).length });
  const sceneShapes = [];
  for (const uuid of made.scenes ?? []) sceneShapes.push(await run(gm, P.scene, { uuid }));
  note("scenes", sceneShapes);
  check("5: each map is a gridless world scene with its picture, off the navigation bar, in the book's folder, with no token and no wall", sceneShapes.length === 2 && sceneShapes.every((s) => s && s.picture && s.gridless && !s.navigation && s.folder && s.width > 0 && s.height > 0 && s.tokens === 0 && s.walls === 0 && s.book === BOOK));
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
  check("6: it carries the two maps, the monster, the keeper and the ten items under the book's stamp", !!a && a.scenes === 2 && a.actors === 2 && a.items === 10 && a.book === BOOK, a && { scenes: a.scenes, actors: a.actors, items: a.items });
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
  check("7: the series' open Item shelf is, with the book's classes and powers in it", !!view.openItems?.visible && view.openItems.line === open && view.classesSeen === view.classesWanted && view.classesWanted === 8, { seen: view.classesSeen, wanted: view.classesWanted, shelf: view.openItems });
  if (SHOTS && view.openItems?.collection) {
    const frame = await run(player, P.shelfPopout, { collection: view.openItems.collection });
    note("plate shelf", frame);
    await plate(player, "importer-open-shelf", frame);
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("8. teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
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
