/**
 * Live walk, importer-ax1-text: AX1's passages, roll tables, item and gear
 * land as documents holding what the page reads. Walks docs/importer/TESTING.md,
 * "An adventure's text: passages, tables, an item and gear", steps 1–8. Machine
 * values arrive through ./_env.mjs, the book through ACKS_TEST_BOOKS ("ax1").
 * Every comparison runs in the page against the executor's own read and is
 * printed as a boolean or an id; no title, row or name leaves the page.
 *
 * The four steps decide presence by cookbook id, and each id that already
 * stands is the owner's:
 *   - a journal under a passage group's id would be written over in place, so
 *     the walk stops before the journals step while one stands;
 *   - a table or item that stands is skipped by its step, never written, so
 *     it is proved by the executor's read instead of as a document;
 *   - a gear entry whose printed name an item in the library already carries
 *     joins or tags that item (`reconcileByName`), a write onto the owner's,
 *     so the gear step does not run while one does.
 * The table step reads every open book, and the GM seat reopens the books it
 * remembers after `ready`, so the walk lets the open set settle, then counts
 * every open book's tables: a table it makes for another book is the run's
 * like AX1's, found by uuid and swept, and only AX1's are held to the page.
 *
 * Fixtures and writes, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the journals the journals step makes (`created.journals`, tracked);
 *   - the tables the table step makes for any open book, read back as the
 *     uuids the library did not hold before it (the step returns counts) and
 *     tracked;
 *   - the item the item step makes (`created.items`, tracked);
 *   - the gear the equipment step makes, read back by id and tracked only
 *     where its uuid is not one the library held before the step;
 *   - every folder a step opens on a shelf or in the sidebar, and every shelf
 *     it opens, found by difference and swept or deleted when empty.
 * Every step is setup: what it makes is what the next run's first import
 * needs absent, so nothing is kept and the teardown sweeps the whole ledger.
 */
import { readdir, readFile } from "node:fs/promises";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm };
const BOOK = "ax1";
const BOOKS = books([BOOK]);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

// The book's rows, from the cookbooks the build ships.
const cookbookDir = new URL("../../cookbook/", import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, cookbookDir), "utf8"));
const CB = await read(`${BOOK}.json`);
// Every book a cookbook ships, to ask the seat which it holds open, and each one's tables.
const ALL_BOOKS = (await readdir(cookbookDir)).filter((f) => f.endsWith(".json") && !["equipment.json", "registers.json"].includes(f)).map((f) => f.slice(0, -5));
const TABLES_OF = {};
for (const b of ALL_BOOKS) TABLES_OF[b] = Object.entries((await read(`${b}.json`)).entries ?? {}).filter(([, e]) => e?.kind === "kind.rolltable").map(([id]) => id);
const EQ = await read("equipment.json");
const entries = Object.entries(CB.entries ?? {});
const PROSE = entries.filter(([, e]) => e.kind === "kind.prose");
// A journal's pages in the order the step writes them: first page, then id.
const GROUPS = {};
for (const [id, e] of [...PROSE].sort((a, b) => (a[1].pages[0] - b[1].pages[0]) || a[0].localeCompare(b[0]))) (GROUPS[e.meta?.group ?? BOOK] ??= []).push(id);
const TABLES = entries.filter(([, e]) => e.kind === "kind.rolltable").map(([id]) => id);
// A table whose header is proved by a key keeps its row's own name.
const ROW_NAMED = entries.filter(([, e]) => e.kind === "kind.rolltable" && e.fields?.name?.names === false).map(([id]) => id);
const DESCRIBED = entries.filter(([, e]) => e.kind === "kind.rolltable" && e.fields?.description).map(([id]) => id);
const ITEMS = entries.filter(([, e]) => e.kind === "kind.adventureItem").map(([id]) => id);
const GEAR = Object.entries(EQ.entries ?? {}).filter(([, e]) => e.book === BOOK && e.kind === "kind.equipment").map(([id]) => id);

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__at = globalThis.__at ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.EX = await import("/modules/acks-extras/scripts/importer/executor.mjs");
    H.PR = await import("/modules/acks-extras/scripts/importer/prose.mjs");
    H.PN = await import("/modules/acks-extras/scripts/importer/printed-name.mjs");
    H.AB = await import("/modules/acks-extras/scripts/importer/adventure-binding.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.LIB.whenReady?.();
    H.MID = "acks-extras";
    /** The executor's read of one row, or null. */
    H.node = async (book, id) => {
      const found = H.CB.cookbookEntry(id);
      if (!found) return null;
      const node = await H.EX.executeEntry(H.CB.cookbookSessionDoc(book), found.cb, H.CB.cookbookRegisters(), id).catch(() => null);
      return node?.ok ? node : null;
    };
    /** The results a table's read makes, built as the table step builds them. */
    H.results = (node) => {
      const rowText = new Map();
      for (const p of node?.fields?.rows ?? []) {
        const key = p.section ?? "";
        const prev = rowText.get(key);
        if (p.detail) rowText.set(key, `${prev ?? ""}<p>${p.text}</p>`);
        else rowText.set(key, prev === undefined ? p.text : `${prev} ${p.text}`);
      }
      const out = [];
      for (const [sec, text] of rowText) {
        const m = /^r([\d,-]+)$/.exec(sec);
        if (!m) continue;
        for (const part of m[1].split(",")) {
          const g = /^(\d+)(?:-(\d+))?$/.exec(part);
          if (g) out.push({ range: [Number(g[1]), Number(g[2] ?? g[1])], text });
        }
      }
      return out.sort((a, b) => a.range[0] - b.range[0]);
    };
    /** Every imported document of a type, with its cookbook id. */
    H.byId = async (type) => (await H.CB.importedDocs(type)).map((d) => ({ uuid: d.uuid, id: d.getFlag(H.MID, "cookbook")?.id ?? null, book: d.getFlag(H.MID, "cookbook")?.book ?? null }));
    return { installed: true };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__at;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__atBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__atBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__atBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__atBook, open: !!globalThis.__at.CB.cookbookSessionDoc(id) }),
  /** Who the seat is, and which books it holds open. */
  seatState: async ({ books }) => {
    const H = globalThis.__at;
    return { isGM: game.user.isGM, module: game.modules.get(H.MID)?.version ?? null, open: books.filter((b) => { try { return !!H.CB.cookbookSessionDoc(b); } catch { return false; } }) };
  },
  /** What stands under the ids the steps claim: uuids and ids only. */
  standing: async ({ book, groups, tables, items, gear }) => {
    const H = globalThis.__at;
    const journals = await H.byId("JournalEntry");
    const groupIds = Object.keys(groups).map((g) => H.AB.journalCookbookId(book, g));
    const held = [];
    for (const j of journals.filter((x) => x.book === book && !groupIds.includes(x.id))) {
      const d = await fromUuid(j.uuid);
      held.push({ uuid: j.uuid, pages: d?.pages?.size ?? null, modified: d?._stats?.modifiedTime ?? null });
    }
    const tdocs = await H.byId("RollTable");
    const idocs = await H.byId("Item");
    // A gear entry joins an item that carries its printed name; compared here, never printed.
    const names = new Set((await H.CB.importedDocs("Item")).filter((d) => !gear.includes(d.getFlag(H.MID, "cookbook")?.id)).map((d) => d.name?.toLowerCase()));
    return {
      journals: Object.fromEntries(groupIds.map((id) => [id, journals.filter((x) => x.id === id).map((x) => x.uuid)])),
      held,
      tables: Object.fromEntries(tables.map((id) => [id, tdocs.filter((x) => x.id === id).map((x) => x.uuid)])),
      items: Object.fromEntries([...items, ...gear].map((id) => [id, idocs.filter((x) => x.id === id).map((x) => x.uuid)])),
      gearNameHeld: gear.filter((id) => names.has(String(H.CB.cookbookEntry(id)?.entry?.name ?? "").toLowerCase())),
      tableUuids: tdocs.map((x) => x.uuid),
      itemUuids: idocs.map((x) => x.uuid),
    };
  },
  /** Every world shelf of the step's types and the folders on it, and the sidebar's folders. */
  shelves: async () => {
    const types = ["JournalEntry", "RollTable", "Item"];
    return {
      packs: Object.fromEntries(game.packs.filter((p) => p.metadata.packageType === "world" && types.includes(p.documentName)).map((p) => [p.collection, p.folders.map((f) => f.id)])),
      folders: game.folders.filter((f) => types.includes(f.type)).map((f) => f.id),
    };
  },
  fire: async ({ step, args }) => {
    const H = globalThis.__at;
    globalThis.__atStep = { done: false };
    const call = step === "importAllEquipment" ? H.CB.importAllEquipment({ only: new Set(args[0]) }) : acksExtras.importer[step](...args);
    Promise.resolve(call)
      .then((v) => { globalThis.__atStep = { done: true, value: v ?? null }; })
      .catch((e) => { globalThis.__atStep = { done: true, error: String(e?.message ?? e) }; });
    return { fired: step };
  },
  stepState: async () => {
    const s = globalThis.__atStep;
    if (!s?.done) return { done: false };
    if (s.error) return { done: true, error: s.error };
    const v = s.value && typeof s.value === "object" ? s.value : {};
    const counts = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number"));
    return { done: true, ...counts, created: v.created ?? null };
  },
  /** Each passage group's journal against the executor's read of each of its pages, as booleans and ids. */
  journals: async ({ book, groups }) => {
    const H = globalThis.__at;
    const docs = await H.byId("JournalEntry");
    const out = {};
    for (const [group, ids] of Object.entries(groups)) {
      const jid = H.AB.journalCookbookId(book, group);
      const found = docs.filter((x) => x.id === jid);
      const j = found[0] ? await fromUuid(found[0].uuid) : null;
      if (!j) { out[group] = { found: found.length }; continue; }
      const pages = [...j.pages].sort((a, b) => a.sort - b.sort);
      const pageIds = pages.map((p) => p.getFlag(H.MID, "cookbook")?.id ?? null);
      const bad = { title: [], text: [], empty: [], cite: [] };
      for (const p of pages) {
        const id = p.getFlag(H.MID, "cookbook")?.id;
        const e = H.CB.cookbookEntry(id)?.entry;
        const node = await H.node(book, id);
        if (!e || p.name !== (e.meta?.title ?? e.name)) bad.title.push(id);
        if (!node || p.text?.content !== H.PR.entryText(node, id, e?.cite)) bad.text.push(id);
        if (!H.PR.nodeParagraphs(node).length) bad.empty.push(id);
        const wrap = new DOMParser().parseFromString(p.text?.content ?? "", "text/html").body.firstElementChild;
        const last = wrap?.lastElementChild;
        if (!last?.classList.contains(H.PR.CITE_CLASS) || last.textContent.trim() !== String(e?.cite ?? "").trim()) bad.cite.push(id);
      }
      out[group] = {
        found: found.length, uuid: j.uuid, named: j.name === group, inLibrary: !!j.pack,
        pages: pages.length, order: JSON.stringify(pageIds) === JSON.stringify(ids), modified: j._stats?.modifiedTime ?? null, ...bad,
      };
    }
    return out;
  },
  /** The journals the library held of the book before the run, as it holds them now. */
  heldNow: async ({ uuids }) => {
    const out = {};
    for (const u of uuids) {
      const d = await fromUuid(u);
      out[u] = d ? { pages: d.pages.size, modified: d._stats?.modifiedTime ?? null } : null;
    }
    return out;
  },
  /**
   * Each table against the executor's read, as booleans and counts: `doc`
   * adds what a table the run made carries, and rolls it once.
   */
  tables: async ({ book, ids, doc }) => {
    const H = globalThis.__at;
    const docs = await H.byId("RollTable");
    const out = {};
    for (const id of ids) {
      const e = H.CB.cookbookEntry(id)?.entry;
      const node = await H.node(book, id);
      const want = H.results(node);
      const contiguous = want.length > 0 && want.every((r, i) => !i || r.range[0] === want[i - 1].range[1] + 1);
      const r = { read: !!node, results: want.length, contiguous, from: want[0]?.range[0] ?? null, to: want.at(-1)?.range[1] ?? null, described: H.PR.nodeParagraphs(node).length };
      const standing = docs.filter((x) => x.id === id);
      r.standing = standing.length;
      if (doc && standing.length === 1) {
        const t = await fromUuid(standing[0].uuid);
        const got = [...t.results].map((x) => ({ range: [...x.range], text: x.description ?? x.text ?? "" })).sort((a, b) => a.range[0] - b.range[0]);
        let spans = null;
        try {
          const lo = await new Roll(t.formula).evaluate({ minimize: true });
          const hi = await new Roll(t.formula).evaluate({ maximize: true });
          spans = lo.total === r.from && hi.total === r.to;
        } catch { spans = false; }
        let rolled = false;
        try {
          const draw = await t.roll();
          rolled = draw.results.length >= 1 && draw.results.every((x) => x.range[0] <= draw.roll.total && draw.roll.total <= x.range[1]);
        } catch { rolled = false; }
        Object.assign(r, {
          inLibrary: !!t.pack,
          resultsAreTheRead: JSON.stringify(got) === JSON.stringify(want),
          formula: !!t.formula,
          dieSpansTheRows: spans,
          descriptionIsTheRead: !!node && t.description === H.PR.entryText(node, id, e?.cite),
          namedAsPrinted: !!node && t.name === H.PN.printedNameOf(node, e?.name ?? ""),
          namedAsRow: t.name === e?.name,
          rolled,
        });
      }
      out[id] = r;
    }
    return out;
  },
  /** One item the run made against the executor's read. */
  item: async ({ book, id }) => {
    const H = globalThis.__at;
    const e = H.CB.cookbookEntry(id)?.entry;
    const node = await H.node(book, id);
    const d = await H.CB.importedItemFor(id);
    if (!d) return { found: false };
    const c = d.getFlag(H.MID, "cookbook") ?? {};
    return {
      found: true, uuid: d.uuid, inLibrary: !!d.pack, type: d.type,
      stamp: c.id === id && c.book === book,
      namedFromPage: !!node && d.name === H.PN.printedNameOf(node, e?.name ?? "") && d.name !== e?.name,
      descriptionIsTheRead: !!node && d.system?.description === H.PR.entryText(node, id, e?.cite),
      described: H.PR.nodeParagraphs(node).length,
      folder: d.folder?.name === "Items",
    };
  },
  /** One gear entry the run made: stamped, named, priced where the page prices it, wearing its row's icon. */
  gear: async ({ id }) => {
    const H = globalThis.__at;
    const e = H.CB.cookbookEntry(id)?.entry;
    const d = await H.CB.importedItemFor(id);
    if (!d) return { found: false };
    const c = d.getFlag(H.MID, "cookbook") ?? {};
    return {
      found: true, uuid: d.uuid, inLibrary: !!d.pack, type: d.type,
      stamp: c.id === id && c.book === e?.book, named: !!d.name, icon: !e?.icon || d.img === e.icon,
      folder: !!d.folder,
    };
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportJournals`); } catch { ok = false; }
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
async function step(api, name, args, tries = 450) {
  await run(api, P.fire, { step: name, args });
  const st = await poll(api, P.stepState, undefined, { tries });
  if (st?.error) throw new Error(`${name} threw: ${st.error}`);
  if (!st?.done) throw new Error(`${name} did not finish`);
  return st;
}
const counts = (s) => s && Object.fromEntries(Object.entries(s).filter(([k, v]) => typeof v === "number" && k !== "done"));
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}
/** Track every folder and note every shelf a step opened since `before`. */
async function trackOpened(api, before, createdPacks) {
  const now = await run(api, P.shelves);
  for (const [collection, folders] of Object.entries(now.packs)) {
    if (!(collection in before.packs)) createdPacks.push(collection);
    for (const f of folders.filter((x) => !(before.packs[collection] ?? []).includes(x))) api.track(`Compendium.${collection}.Folder.${f}`, "Folder");
  }
  for (const f of now.folders.filter((x) => !before.folders.includes(x))) api.track(`Folder.${f}`, "Folder");
}
/** The keys whose row fails `test`. */
const failing = (rows, test) => Object.keys(rows).filter((k) => !test(rows[k]));

let gm = null;
const createdPacks = [];

try {
  section("seats and the book");
  note("rows", { passages: PROSE.length, groups: Object.fromEntries(Object.entries(GROUPS).map(([g, ids]) => [g, ids.length])), tables: TABLES.length, items: ITEMS.length, gear: GEAR.length });
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  const opened = await run(gm, P.bookState, { id: BOOK });
  if (!opened.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    note("book", await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open }));
  }
  // The seat reopens its remembered books one at a time after `ready`: read
  // the open set until two reads ten seconds apart agree.
  let seatNow = await run(gm, P.seatState, { books: ALL_BOOKS });
  for (let n = 0; n < 12; n++) {
    await sleep(10000);
    const again = await run(gm, P.seatState, { books: ALL_BOOKS });
    const same = JSON.stringify(again.open) === JSON.stringify(seatNow.open);
    seatNow = again;
    if (same) break;
  }
  note("seat", seatNow);
  check("the GM seat is a GM and the book is open", seatNow.isGM && seatNow.open.includes(BOOK));
  if (!seatNow.isGM || !seatNow.open.includes(BOOK)) throw new Error("stopped before the steps: the book is not open on a GM seat");
  const OTHER_TABLES = seatNow.open.filter((b) => b !== BOOK).flatMap((b) => TABLES_OF[b] ?? []);

  section("what stands under the ids the steps claim");
  const before = await run(gm, P.standing, { book: BOOK, groups: GROUPS, tables: [...TABLES, ...OTHER_TABLES], items: ITEMS, gear: GEAR });
  const journalsHeld = Object.entries(before.journals).filter(([, u]) => u.length).map(([id]) => id);
  note("journals the library held of the book, not a passage group's", before.held.map((h) => ({ uuid: h.uuid, pages: h.pages })));
  check("no journal stands under a passage group's id", !journalsHeld.length, journalsHeld);
  if (journalsHeld.length) throw new Error("stopped before the journals step: it would write over a journal this run did not make");
  const tablesHeld = TABLES.filter((id) => before.tables[id].length);
  const tablesMade = TABLES.filter((id) => !before.tables[id].length);
  note("tables the library holds (the owner's, proved by the read)", tablesHeld);
  note("tables the run makes", tablesMade);
  const otherLacked = OTHER_TABLES.filter((id) => !before.tables[id].length);
  note("other open books' tables the library lacks (the table step makes them too)", { held: OTHER_TABLES.length - otherLacked.length, lacked: otherLacked });
  const itemsHeld = ITEMS.filter((id) => before.items[id].length);
  const gearHeld = GEAR.filter((id) => before.items[id].length);
  note("items and gear the library holds (the owner's)", [...itemsHeld, ...gearHeld]);
  note("gear whose printed name an item in the library carries", before.gearNameHeld);

  section("1. the journals step writes each passage as a page of its group's journal");
  let shelves = await run(gm, P.shelves);
  const j1 = await step(gm, "cookbookImportJournals", [{ books: [BOOK] }], 900);
  for (const uuid of j1.created?.journals ?? []) gm.track(uuid, "JournalEntry");
  await trackOpened(gm, shelves, createdPacks);
  note("1: first run", counts(j1));
  check("1: one page made for each passage, none refused, a journal made for each group",
    j1.made === PROSE.length && !j1.updated && !j1.refused && j1.created?.journals?.length === Object.keys(GROUPS).length,
    { ...counts(j1), journals: j1.created?.journals?.length ?? 0 });
  const js1 = await run(gm, P.journals, { book: BOOK, groups: GROUPS });
  note("1: journals", Object.fromEntries(Object.entries(js1).map(([g, r]) => [g, { found: r.found, pages: r.pages }])));
  const groups = Object.keys(GROUPS);
  check("1: each group's journal stands once under its id, named for its group, in the library",
    groups.every((g) => js1[g].found === 1 && js1[g].named && js1[g].inLibrary), failing(js1, (r) => r.found === 1 && r.named && r.inLibrary));
  check("1: each journal holds its group's passages, in page order", groups.every((g) => js1[g].pages === GROUPS[g].length && js1[g].order),
    Object.fromEntries(groups.map((g) => [g, { pages: js1[g].pages, want: GROUPS[g].length, order: js1[g].order }])));
  check("1: each page is titled by what its passage is", groups.every((g) => !js1[g].title?.length), groups.flatMap((g) => js1[g].title ?? []));
  check("1: each page holds exactly the executor's read of its passage, and no page is empty",
    groups.every((g) => !js1[g].text?.length && !js1[g].empty?.length), { text: groups.flatMap((g) => js1[g].text ?? []), empty: groups.flatMap((g) => js1[g].empty ?? []) });
  check("1: each page closes on its reference", groups.every((g) => !js1[g].cite?.length), groups.flatMap((g) => js1[g].cite ?? []));
  const heldAfter = await run(gm, P.heldNow, { uuids: before.held.map((h) => h.uuid) });
  check("1: the journals the library held are untouched",
    before.held.every((h) => heldAfter[h.uuid]?.pages === h.pages && heldAfter[h.uuid]?.modified === h.modified), before.held.length);

  section("2. a second journals run refreshes every page in place");
  const j2 = await step(gm, "cookbookImportJournals", [{ books: [BOOK] }], 900);
  for (const uuid of j2.created?.journals ?? []) gm.track(uuid, "JournalEntry");
  note("2: second run", counts(j2));
  const js2 = await run(gm, P.journals, { book: BOOK, groups: GROUPS });
  check("2: the second run makes nothing and refreshes every page",
    !j2.made && j2.updated === PROSE.length && !j2.refused && !j2.created?.journals?.length, counts(j2));
  check("2: no journal or page doubles, and every page still holds its read",
    groups.every((g) => js2[g].found === 1 && js2[g].pages === GROUPS[g].length && !js2[g].text?.length), Object.fromEntries(groups.map((g) => [g, { found: js2[g].found, pages: js2[g].pages }])));

  section("3. the table step makes each table the library lacks from its page");
  shelves = await run(gm, P.shelves);
  const t1 = await step(gm, "cookbookImportRollTables", [], 900);
  const afterTables = await run(gm, P.standing, { book: BOOK, groups: GROUPS, tables: [...TABLES, ...OTHER_TABLES], items: ITEMS, gear: GEAR });
  const newTables = afterTables.tableUuids.filter((u) => !before.tableUuids.includes(u));
  for (const uuid of newTables) gm.track(uuid, "RollTable");
  await trackOpened(gm, shelves, createdPacks);
  note("3: first run", counts(t1));
  const heldAll = TABLES.length + OTHER_TABLES.length - tablesMade.length - otherLacked.length;
  check("3: the run skips every table the library holds, and every table it counts made is a new document, tracked",
    t1.skipped === heldAll && t1.made === newTables.length, { ...counts(t1), held: heldAll, tracked: newTables.length });
  check("3: each AX1 table the library lacked stands once under its id", tablesMade.every((id) => afterTables.tables[id].length === 1),
    tablesMade.filter((id) => afterTables.tables[id].length !== 1));
  note("3: other books' tables made", otherLacked.filter((id) => afterTables.tables[id].length));
  const made = await run(gm, P.tables, { book: BOOK, ids: tablesMade, doc: true });
  note("3: made tables", Object.fromEntries(tablesMade.map((id) => [id, { results: made[id].results, from: made[id].from, to: made[id].to }])));
  const allMade = (key) => tablesMade.every((id) => made[id][key]);
  const whichNot = (key) => tablesMade.filter((id) => !made[id][key]);
  check("3: each made table is in the library, its results the read's rows, one per die band", allMade("inLibrary") && allMade("resultsAreTheRead"),
    { inLibrary: whichNot("inLibrary"), results: whichNot("resultsAreTheRead") });
  check("3: each made table's rows run without a gap, and its die spans them", allMade("contiguous") && allMade("formula") && allMade("dieSpansTheRows"),
    { contiguous: whichNot("contiguous"), formula: whichNot("formula"), spans: whichNot("dieSpansTheRows") });
  check("3: each made table's description is the read, its page reference closing it", allMade("descriptionIsTheRead"), whichNot("descriptionIsTheRead"));
  check("3: each made table is named as its page prints it, and a table whose header is proved by a key keeps its row's name",
    allMade("namedAsPrinted") && tablesMade.filter((id) => ROW_NAMED.includes(id)).every((id) => made[id].namedAsRow), { printed: whichNot("namedAsPrinted"), row: ROW_NAMED.filter((id) => tablesMade.includes(id) && !made[id].namedAsRow) });
  check("3: each made table rolls one result whose band holds the roll", allMade("rolled"), whichNot("rolled"));
  if (tablesHeld.length) {
    const readHeld = await run(gm, P.tables, { book: BOOK, ids: tablesHeld, doc: false });
    note("3: held tables, by the read", Object.fromEntries(tablesHeld.map((id) => [id, { results: readHeld[id].results, described: readHeld[id].described }])));
    check("3: each table the library holds reads off its page, its rows without a gap",
      tablesHeld.every((id) => readHeld[id].read && readHeld[id].results > 0 && readHeld[id].contiguous), tablesHeld.filter((id) => !readHeld[id].read || !readHeld[id].contiguous));
    const describedHeld = DESCRIBED.filter((id) => tablesHeld.includes(id));
    check("3: each held table opened by a section head reads a paragraph above its grid", describedHeld.every((id) => readHeld[id].described > 0), describedHeld.filter((id) => !readHeld[id].described));
  }
  const t2 = await step(gm, "cookbookImportRollTables", [], 900);
  note("3: second run", counts(t2));
  check("3: a second run makes nothing and skips every table the first run left standing", !t2.made && t2.skipped === heldAll + newTables.length, counts(t2));

  section("4. the item step makes the book's item from its page");
  shelves = await run(gm, P.shelves);
  const i1 = await step(gm, "cookbookImportAdventureItems", [{ books: [BOOK] }]);
  for (const uuid of i1.created?.items ?? []) gm.track(uuid, "Item");
  await trackOpened(gm, shelves, createdPacks);
  note("4: first run", counts(i1));
  const itemsMade = ITEMS.filter((id) => !itemsHeld.includes(id));
  check("4: the run makes each item the library lacks, refuses none", i1.made === itemsMade.length && i1.already === itemsHeld.length && !i1.refused, counts(i1));
  const it = {};
  for (const id of itemsMade) it[id] = await run(gm, P.item, { book: BOOK, id });
  note("4: items", Object.fromEntries(itemsMade.map((id) => [id, { found: it[id].found, type: it[id].type, described: it[id].described }])));
  check("4: each is a library item stamped with its row, named from its page, in the book's Items folder",
    itemsMade.every((id) => it[id].found && it[id].inLibrary && it[id].stamp && it[id].namedFromPage && it[id].folder), failing(it, (r) => r.found && r.inLibrary && r.stamp && r.namedFromPage && r.folder));
  check("4: each item's description is the read, and not empty", itemsMade.every((id) => it[id].descriptionIsTheRead && it[id].described > 0), failing(it, (r) => r.descriptionIsTheRead && r.described > 0));
  const i2 = await step(gm, "cookbookImportAdventureItems", [{ books: [BOOK] }]);
  for (const uuid of i2.created?.items ?? []) gm.track(uuid, "Item");
  check("4: a second run finds each item already there", !i2.made && i2.already === ITEMS.length && !i2.refused, counts(i2));

  section("5. the equipment step makes the book's gear");
  const gearMade = GEAR.filter((id) => !gearHeld.includes(id));
  if (before.gearNameHeld.length) {
    check("5: no item in the library carries a gear entry's printed name (the step would join it)", false, before.gearNameHeld);
  } else {
    shelves = await run(gm, P.shelves);
    const g1 = await step(gm, "importAllEquipment", [GEAR], 900);
    const afterGear = await run(gm, P.standing, { book: BOOK, groups: GROUPS, tables: TABLES, items: ITEMS, gear: GEAR });
    for (const uuid of afterGear.itemUuids.filter((u) => !before.itemUuids.includes(u) && !(i1.created?.items ?? []).includes(u))) gm.track(uuid, "Item");
    await trackOpened(gm, shelves, createdPacks);
    note("5: first run", counts(g1));
    check("5: the run makes each gear entry the library lacks", g1.total === GEAR.length && g1.created === gearMade.length, counts(g1));
    const gr = {};
    for (const id of gearMade) gr[id] = await run(gm, P.gear, { id });
    note("5: gear", Object.fromEntries(gearMade.map((id) => [id, { found: gr[id].found, type: gr[id].type }])));
    check("5: each stands once, a library item stamped with its row, named, wearing its row's icon, in a folder",
      gearMade.every((id) => afterGear.items[id].length === 1 && gr[id].found && gr[id].inLibrary && gr[id].stamp && gr[id].named && gr[id].icon && gr[id].folder),
      failing(gr, (r) => r.found && r.inLibrary && r.stamp && r.named && r.icon && r.folder));
    const g2 = await step(gm, "importAllEquipment", [GEAR], 900);
    check("5: a second run makes nothing", !g2.created && g2.total === GEAR.length, counts(g2));
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  // Every step is setup and nothing is kept: the whole ledger goes.
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of createdPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
