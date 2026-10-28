/**
 * Live walk, importer-ax1-markets: AX1's demand grid, printed sideways, lands
 * as markets. Walks docs/markets/TESTING.md, "Setting-book market profiles
 * walk (AX1: a sideways grid)", steps 1–5. Machine values arrive through
 * ./_env.mjs, the book through ACKS_TEST_BOOKS ("ax1"). Every figure is
 * compared in the page and printed as a boolean; ids and counts are the only
 * things printed, never a header, a good's label or a modifier.
 *
 * The step imports every open book that prints a market grid, and a column
 * that names a place writes onto whatever answers for that place, so two
 * columns are steered in memory onto this run's own documents
 * (`cookbookEntry(...).entry.meta.markets`, restored in the `finally`), as the
 * AX3 walk steered its city:
 *   - a column paired with a later book's place (`sameAs`) joins that place
 *     where the library holds it, a write onto the owner's document: the
 *     column's id in its `merged`, and the column's base where it held none.
 *     Unless MARKET_BIND_OK=1, the owner's go-ahead, the pair is dropped
 *     when its later place stands, and the column lands as a market of its
 *     own like the unpaired ones. A join stays, so a later run takes a column
 *     an earlier bind joined only under MARKET_BIND_OK=1, and stops without;
 *   - a column that names a place (`place`) lands on the owner's place where
 *     it stands, so it is pointed at an id of the walk's instead: absent on
 *     the first run, which counts it waiting, then a world place the walk
 *     builds carrying that id, which the second run lands on.
 * The walk stops before the step while another book with a market grid is
 * open on the GM seat, or while anything stands under a market id the step
 * would claim, since neither is this run's.
 *
 * Fixtures and writes, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - every market the step makes, read back under its cookbook id (the step
 *     returns counts, not ids) and tracked, and any folder or shelf it opens;
 *   - the place the redirected column lands on, kept and found by its marker
 *     `markets/ax1-place-<column>`: steps 2 and 3 are its absence and its
 *     arrival, so the walk retires the last run's before step 2 and builds it
 *     again (`api.fixture`) in step 3;
 *   - a Judge's base demand on one made market, or on the placed column's
 *     place where every column joins, written through the demand engine's own
 *     base write (`writeDemand`, which the Trade tab's Set calls).
 * A create hook observes the first run, never sweeps it: it proves a column
 * waiting for its place stubs nothing. The made markets are a library's,
 * which carry no marker, and the step's first run is the subject, which a
 * market standing under the book's id stops: the teardown sweeps them, with
 * the folders and shelf the step opened, by the run's own ids, and leaves
 * the place standing.
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
const MARKET_BIND_OK = process.env.MARKET_BIND_OK === "1";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

// The book's market grid and every other book that prints one, from the
// cookbooks themselves: the step reads every open book's grids.
const cookbookDir = new URL("../../cookbook/", import.meta.url);
const GRID_BOOKS = [];
let GRID = null;
let COLUMNS = {};
let GOODS = 0;
for (const file of (await readdir(cookbookDir)).filter((f) => f.endsWith(".json"))) {
  const cb = JSON.parse(await readFile(new URL(file, cookbookDir), "utf8"));
  const grids = Object.entries(cb.entries ?? {}).filter(([, e]) => e?.kind === "kind.marketGrid");
  if (!grids.length) continue;
  const book = file.slice(0, -5);
  GRID_BOOKS.push(book);
  if (book !== BOOK) continue;
  const [id, entry] = grids[0];
  const op = entry.fields?.["grids.markets"] ?? {};
  GRID = id;
  GOODS = op.rowBands?.length ?? 0;
  COLUMNS = Object.fromEntries((op.cols ?? []).map((c) => [c.key, entry.meta?.markets?.[c.key] ?? {}]));
}
const MARKETS = Object.keys(COLUMNS);
const PAIRED = MARKETS.filter((k) => COLUMNS[k].sameAs);
const PLACED = MARKETS.filter((k) => COLUMNS[k].place);
const OWN = MARKETS.filter((k) => !COLUMNS[k].place);
const idOf = (k) => `${BOOK}.${k}`;
// A placed column's place: its marker, and the id the column is steered onto,
// each under the run's own tag where it builds beside a peer's.
const PLACE_MARKER = (k) => `markets/${BOOK}-place-${k}`;
const REDIRECT = Object.fromEntries(PLACED.map((k) => [k, `${BOOK}.qa-${k}${MACHINE.own ? `-${MACHINE.own}` : ""}`]));

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__am = globalThis.__am ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.EX = await import("/modules/acks-extras/scripts/importer/executor.mjs");
    H.MB = await import("/modules/acks-extras/scripts/importer/market-profile-binding.mjs");
    H.PP = await import("/modules/acks-extras/scripts/importer/place-pair.mjs");
    H.ME = await import("/modules/acks-extras/scripts/markets/engine/merchandise.mjs");
    H.DE = await import("/modules/acks-extras/scripts/markets/engine/demand.mjs");
    H.LC = await import("/modules/acks-extras/scripts/location/constants.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.LIB.whenReady?.();
    /** Every Actor answering for `id`: the world's originals, then each world shelf's. */
    H.held = async (id) => {
      const out = [];
      for (const a of game.actors) if (H.PP.answersFor(a.getFlag("acks-extras", "cookbook"), id)) out.push(a.uuid);
      for (const p of game.packs.filter((x) => x.documentName === "Actor" && x.metadata.packageType === "world")) {
        const index = await p.getIndex({ fields: ["flags.acks-extras.cookbook.id", "flags.acks-extras.cookbook.merged"] });
        for (const r of index) if (H.PP.answersFor(r.flags?.["acks-extras"]?.cookbook, id)) out.push(`Compendium.${p.collection}.Actor.${r._id}`);
      }
      return out;
    };
    /** The grid as the page reads now, and each market's profile through the world's merchandise. */
    H.read = async (book, gridId) => {
      const found = H.CB.cookbookEntry(gridId);
      const node = await H.EX.executeEntry(H.CB.cookbookSessionDoc(book), found.cb, H.CB.cookbookRegisters(), gridId);
      const grid = node?.ok ? node.fields?.grids?.markets : null;
      if (!grid) return { entry: found.entry, grid: null, profiles: [] };
      await H.ME.primeMerchandiseCatalog().catch(() => null);
      const resolve = H.MB.goodsResolver(H.ME.merchandiseCatalog());
      return { entry: found.entry, grid, profiles: H.MB.marketProfiles({ grids: [grid], records: {}, resolve }) };
    };
    return { installed: true };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__am;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__amBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__amBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__amBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__amBook, open: !!globalThis.__am.CB.cookbookSessionDoc(id) }),
  /** What the grid reads as, in counts and booleans, and which books are open. */
  census: async ({ book, gridId, gridBooks, markets }) => {
    const H = globalThis.__am;
    const { grid, profiles } = await H.read(book, gridId);
    const rows = grid?.rows ?? [];
    const cells = rows.map((r) => Object.entries(r.cells ?? {}));
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      open: gridBooks.filter((b) => !!H.CB.cookbookSessionDoc(b)),
      read: !!grid,
      rows: rows.length,
      keys: markets.every((k) => rows.some((r) => r.key === k)) && rows.length === markets.length,
      goods: [...new Set(cells.map((c) => c.length))],
      everyCellParses: cells.every((c) => c.every(([, v]) => H.MB.parseDm(v) !== null)),
      everyColumnHeaded: rows.every((r) => !!H.MB.placeName(grid.header?.[r.key])),
      catalog: H.ME.merchandiseCatalog().length,
      demand: profiles.map((p) => ({ market: p.market, demand: p.demand.length, unmapped: p.unmapped.length, duplicates: p.duplicates.length })),
    };
  },
  /** The documents standing under each id now. */
  standing: async ({ ids }) => {
    const H = globalThis.__am;
    const out = {};
    for (const id of ids) out[id] = await H.held(id);
    return out;
  },
  /** What a join may touch on each place, held in the driver and compared there, never printed. */
  snapshot: async ({ uuids }) => {
    const out = {};
    for (const uuid of uuids) {
      const d = await fromUuid(uuid);
      const goods = d?.system?.market?.goods ?? {};
      let notes = 0;
      for (const c of String(d?.system?.notes ?? "")) notes = (notes * 31 + c.codePointAt(0)) >>> 0;
      out[uuid] = {
        found: !!d, name: d?.name ?? null, notes, parent: d?.system?.parentUuid ?? "", region: d?.system?.region ?? "",
        cls: d?.system?.market?.marketClassOverride ?? null, merged: d?.getFlag("acks-extras", "cookbook")?.merged ?? [],
        base: (goods.demand ?? []).map((x) => `${x.category}:${x.modifier}`).sort(), source: goods.dmProfile?.source ?? null,
      };
    }
    return out;
  },
  /** Point the grid's columns at this run's documents: drop the pairs named, move each placed column to its id. */
  steer: async ({ gridId, drop, places }) => {
    const H = globalThis.__am;
    const entry = H.CB.cookbookEntry(gridId).entry;
    H.saved = H.saved ?? structuredClone(entry.meta.markets);
    for (const k of drop) delete entry.meta.markets[k];
    for (const [k, id] of Object.entries(places)) entry.meta.markets[k] = { place: id };
    return { steered: Object.keys(entry.meta.markets) };
  },
  unsteer: async ({ gridId }) => {
    const H = globalThis.__am;
    if (!H.saved) return { restored: false };
    H.CB.cookbookEntry(gridId).entry.meta.markets = H.saved;
    H.saved = null;
    return { restored: true };
  },
  observe: async () => {
    const H = globalThis.__am;
    H.seen = [];
    H.observer = Hooks.on("createActor", (d) => H.seen.push(d.uuid));
    return { observing: true };
  },
  unobserve: async () => {
    const H = globalThis.__am;
    if (H.observer != null) Hooks.off("createActor", H.observer);
    H.observer = null;
    return H.seen ?? [];
  },
  shelves: async () => Object.fromEntries(game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world")
    .map((p) => [p.collection, p.folders.map((f) => f.id)])),
  fire: async () => {
    globalThis.__amStep = { done: false };
    acksExtras.importer.cookbookImportMarketProfiles()
      .then((r) => { globalThis.__amStep = { done: true, result: r ?? null }; })
      .catch((e) => { globalThis.__amStep = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  stepState: async () => globalThis.__amStep,
  /**
   * One market against the grid as the page reads it now, as booleans:
   * `fresh` adds what a market the step made carries (its stamp, its name
   * from the column's header, its shelf).
   */
  market: async ({ uuid, book, gridId, key, fresh }) => {
    const H = globalThis.__am;
    const doc = await fromUuid(uuid);
    if (!doc) return { found: false };
    const { entry, grid, profiles } = await H.read(book, gridId);
    const profile = profiles.find((p) => p.market === key);
    const flag = doc.getFlag("acks-extras", "cookbook") ?? {};
    const goods = doc.system?.market?.goods ?? {};
    const stored = (goods.demand ?? []).map((d) => `${d.category}:${d.modifier}`).sort();
    const read = (profile?.demand ?? []).map((d) => `${d.category}:${d.modifier}`).sort();
    const header = H.MB.placeName(grid?.header?.[key]);
    const fallback = game.i18n.format("ACKS-IMPORTER.markets.label", { n: H.MB.marketOrdinal(key) });
    const out = {
      found: true,
      location: doc.type === H.LC.LOCATION_TYPE,
      hasMarket: doc.system?.market != null,
      demand: stored.length,
      demandIsTheGrid: stored.length > 0 && JSON.stringify(stored) === JSON.stringify(read),
      sourceIsThePage: goods.dmProfile?.source?.book === book && goods.dmProfile?.source?.page === (entry.cite ?? ""),
    };
    if (fresh) {
      Object.assign(out, {
        stamp: flag.id === H.MB.marketEntryId(book, key) && flag.book === book && flag.kind === "kind.marketRecord",
        namedFromHeader: !!header && doc.name === header && doc.name !== fallback,
        printed: flag.printed === doc.name,
        inLibrary: uuid.startsWith("Compendium."),
      });
    }
    return out;
  },
  /** A Judge's hand on one market's base: one good moved a step through the demand engine. */
  judgeBase: async ({ uuid }) => {
    const H = globalThis.__am;
    const doc = await fromUuid(uuid);
    const row = doc.system.market.goods.demand[0];
    const r = await H.DE.writeDemand(doc, { layer: "base", category: row.category, modifier: Number(row.modifier) + 1 });
    const after = await fromUuid(uuid);
    return {
      ok: !!r?.ok,
      sourceCleared: after.system.market.goods.dmProfile?.source == null,
      base: after.system.market.goods.demand.map((d) => `${d.category}:${d.modifier}`).sort(),
    };
  },
  baseOf: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    return {
      base: (doc?.system?.market?.goods?.demand ?? []).map((d) => `${d.category}:${d.modifier}`).sort(),
      sourceCleared: doc?.system?.market?.goods?.dmProfile?.source == null,
    };
  },
  /** The market's sheet on its Trade tab: one chip per stored good, each showing its modifier. */
  tradeTab: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const app = doc.sheet;
    await app.render({ force: true });
    const root = () => app.element?.querySelector?.(".window-content") ? app.element : null;
    for (let i = 0; i < 60 && !root(); i++) await new Promise((r) => setTimeout(r, 200));
    if (!root()) return { opened: false };
    app.element.querySelector('nav.tabs a[data-tab="trade"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    const sec = app.element.querySelector('section[data-tab="trade"]');
    const chips = [...(sec?.querySelector(".acks-extras-markets-demand")?.querySelectorAll(".acks-extras-markets-demand-chip") ?? [])];
    const signed = (n) => (n > 0 ? `+${n}` : String(n));
    const want = (doc.system.market.goods.demand ?? []).map((d) => signed(Number(d.modifier)));
    const shown = chips.map((c) => (/([+-]?\d+)/u.exec(c.textContent.replace(/\s+/gu, " ").trim().split(" ").pop())?.[1] ?? null));
    await app.close({ force: true });
    return {
      opened: true,
      tab: !!sec,
      chips: chips.length,
      stored: want.length,
      modifiersShown: chips.length === want.length && JSON.stringify([...shown].sort()) === JSON.stringify([...want].sort()),
    };
  },
  actorPacks: async () => game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world").map((p) => p.collection),
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportMarketProfiles`); } catch { ok = false; }
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
/** One run of the market step, to its counts. */
async function step(api) {
  await run(api, P.fire);
  const s = await poll(api, P.stepState, undefined, { tries: 450 });
  if (!s?.done) throw new Error("the market step did not finish");
  if (s.error) throw new Error(`the market step threw: ${s.error}`);
  return s.result;
}
const counts = (r) => r && { made: r.made, updated: r.updated, kept: r.kept, paired: r.paired, waiting: r.waiting, refused: r.refused, unmapped: r.unmapped?.length ?? null, duplicates: r.duplicates?.length ?? null };
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
let steered = false;
const createdPacks = [];

try {
  section("seats and the book");
  if (!GRID) throw new Error(`cookbook/${BOOK}.json holds no market grid`);
  note("columns", { markets: MARKETS.length, paired: PAIRED, placed: PLACED, gridBooks: GRID_BOOKS });
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  const opened = await run(gm, P.bookState, { id: BOOK });
  if (!opened.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    note("book", await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open }));
  }
  const census = await run(gm, P.census, { book: BOOK, gridId: GRID, gridBooks: GRID_BOOKS, markets: MARKETS });
  note("census", census);
  check("the GM seat is a GM and the book is open", census.isGM && census.open.includes(BOOK));
  const others = census.open.filter((b) => b !== BOOK);
  check("no other book with a market grid is open on the GM seat", !others.length, { open: others });
  if (!census.isGM || !census.open.includes(BOOK) || others.length) throw new Error("stopped before the step: the step would import a book this run did not open");

  section("1. the grid reads, a market a column");
  check("1: the grid reads one row per printed market, each keyed as its column", census.read && census.keys, { rows: census.rows });
  check("1: every market reads one cell per good the grid bands, and every cell is a modifier",
    census.goods.length === 1 && census.goods[0] === GOODS && census.everyCellParses, { goods: census.goods, banded: GOODS });
  check("1: every column's header names its market", census.everyColumnHeaded);
  const mapped = census.demand.every((d) => d.demand > 0);
  check("1: the world's merchandise answers each market's goods (the precondition for a base to land)", census.catalog > 0 && mapped,
    { catalog: census.catalog, demand: census.demand });
  if (!mapped) throw new Error("stopped before the step: no merchandise answers the grid's goods, so no base would land (import merchandise first)");

  section("what stands under the ids the step claims");
  // Setup: step 2 needs each placed column's place absent.
  for (const k of PLACED) note(`retired ${PLACE_MARKER(k)}`, await gm.retire(PLACE_MARKER(k), "Actor"));
  const later = PAIRED.map((k) => COLUMNS[k].sameAs);
  const before = await run(gm, P.standing, { ids: [...MARKETS.map(idOf), ...later, ...Object.values(REDIRECT)] });
  const sameDocs = (a, b) => a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
  const laterHeld = PAIRED.filter((k) => before[COLUMNS[k].sameAs].length);
  // A column an earlier bind joined answers from its later place alone (the
  // library's document; a world copy of it does not carry the join).
  const alreadyJoined = laterHeld.filter((k) => before[idOf(k)].length > 0 && before[idOf(k)].every((u) => before[COLUMNS[k].sameAs].includes(u)));
  note("paired columns whose later place the library holds", laterHeld.map((k) => ({ column: k, later: COLUMNS[k].sameAs, joined: alreadyJoined.includes(k) })));
  const ours = MARKETS.filter((k) => before[idOf(k)].length && !(MARKET_BIND_OK && alreadyJoined.includes(k))).map(idOf);
  check("nothing stands under any of the book's market ids, but a later place an earlier bind joined", !ours.length, ours);
  if (ours.length) {
    throw new Error(alreadyJoined.length && !MARKET_BIND_OK
      ? "stopped before the step: an earlier bind joined a column to the owner's place (MARKET_BIND_OK=1 walks that state)"
      : "stopped before the step: a market this run did not make stands under one of the book's ids");
  }
  const drop = MARKET_BIND_OK ? [] : laterHeld;
  if (drop.length) note("pairs dropped in memory (the later place is the owner's; MARKET_BIND_OK=1 is the go-ahead to join it)", drop);
  const bound = laterHeld.filter((k) => !drop.includes(k));
  const joining = bound.filter((k) => !alreadyJoined.includes(k));
  const fresh = OWN.filter((k) => !bound.includes(k));
  // The join writes the library's own document, never a world copy.
  const owners = Object.fromEntries(bound.map((k) => {
    const held = before[COLUMNS[k].sameAs];
    return [k, held.find((u) => u.startsWith("Compendium.")) ?? held[0]];
  }));
  const ownersBefore = bound.length ? await run(gm, P.snapshot, { uuids: Object.values(owners) }) : {};
  note("steer", await run(gm, P.steer, { gridId: GRID, drop, places: REDIRECT }));
  steered = true;

  section("2. a column with no place of its own is a market; a column naming a place waits for it");
  const packsBefore = await run(gm, P.actorPacks);
  const shelvesBefore = await run(gm, P.shelves);
  await run(gm, P.observe);
  const r1 = await step(gm);
  const seen1 = await run(gm, P.unobserve);
  note("2: first run", counts(r1));
  for (const c of (await run(gm, P.actorPacks)).filter((c) => !packsBefore.includes(c))) createdPacks.push(c);
  const made = await run(gm, P.standing, { ids: fresh.map(idOf) });
  for (const id of fresh.map(idOf)) for (const uuid of made[id]) gm.track(uuid, "Actor");
  const shelvesAfter = await run(gm, P.shelves);
  for (const [collection, folders] of Object.entries(shelvesAfter)) {
    for (const f of folders.filter((x) => !(shelvesBefore[collection] ?? []).includes(x))) gm.track(`Compendium.${collection}.Folder.${f}`, "Folder");
  }
  note("2: made (tracked)", made);
  check("2: the run makes a market for each column with no place, joins each pair the library holds, and counts each placed column waiting",
    r1.made === fresh.length && r1.paired === joining.length && r1.waiting === PLACED.length && r1.updated + r1.kept === alreadyJoined.length && !r1.refused, counts(r1));
  // A join writes the column's id into the later place's `merged`, and the
  // column's base only where the place held none; nothing else of it moves.
  const ownBase = [];
  if (bound.length) {
    const joinedNow = await run(gm, P.standing, { ids: bound.map(idOf) });
    // A world copy of the later place is restamped by the maps step, not here.
    check("2: each joined column's id answers from the library's later place alone",
      bound.every((k) => sameDocs(joinedNow[idOf(k)], [owners[k]])),
      Object.fromEntries(bound.map((k) => [k, { answering: joinedNow[idOf(k)].length, laterCopies: before[COLUMNS[k].sameAs].length - 1 }])));
    const ownersAfter = await run(gm, P.snapshot, { uuids: Object.values(owners) });
    const joins = {};
    for (const k of bound) {
      const b = ownersBefore[owners[k]];
      const a = ownersAfter[owners[k]];
      const same = (f) => JSON.stringify(a?.[f]) === JSON.stringify(b?.[f]);
      const mine = await run(gm, P.market, { uuid: owners[k], book: BOOK, gridId: GRID, key: k, fresh: false });
      if (mine.sourceIsThePage) ownBase.push(k);
      joins[k] = {
        merged: !!a?.merged.includes(idOf(k)),
        untouched: ["name", "notes", "parent", "region", "cls"].every(same),
        base: b?.base.length ? (same("base") && same("source") ? "kept" : "moved") : (mine.demandIsTheGrid && mine.sourceIsThePage ? "landed" : "missing"),
        columnFigures: mine.demandIsTheGrid,
      };
    }
    note("2: the joined places (columnFigures: the place's base equals the column's read)", joins);
    check("2: each joined place answers for its column and keeps its name, notes, parent, region and class",
      bound.every((k) => joins[k].merged && joins[k].untouched), bound.filter((k) => !joins[k].merged || !joins[k].untouched));
    check("2: a joined place's base stands, and one that held none takes the column's",
      bound.every((k) => ["kept", "landed"].includes(joins[k].base)), bound.filter((k) => !["kept", "landed"].includes(joins[k].base)));
  }
  check("2: each made market stands once, under its column's id", fresh.every((k) => made[idOf(k)].length === 1), Object.fromEntries(fresh.map((k) => [k, made[idOf(k)].length])));
  const rows1 = {};
  for (const k of fresh) rows1[k] = made[idOf(k)][0] ? await run(gm, P.market, { uuid: made[idOf(k)][0], book: BOOK, gridId: GRID, key: k, fresh: true }) : { found: false };
  note("2: the made markets", rows1);
  const every = (key) => fresh.every((k) => rows1[k]?.[key]);
  const failing = (key) => fresh.filter((k) => !rows1[k]?.[key]);
  check("2: each is a library place stamped as its column's market", every("location") && every("inLibrary") && every("stamp"), { location: failing("location"), inLibrary: failing("inLibrary"), stamp: failing("stamp") });
  check("2: each is named for its column's header, and stamped with the name it was built under", every("namedFromHeader") && every("printed"), { named: failing("namedFromHeader"), printed: failing("printed") });
  check("2: each carries its column's base demand, sourced to the page", every("demandIsTheGrid") && every("sourceIsThePage"), { demand: failing("demandIsTheGrid"), source: failing("sourceIsThePage") });
  const stubs = seen1.filter((u) => !Object.values(made).flat().includes(u));
  check("2: a column waiting for its place makes no actor (observed, not swept)", !stubs.length, { stray: stubs.length });
  const redirected = await run(gm, P.standing, { ids: Object.values(REDIRECT) });
  check("2: nothing stands under a waiting column's place", Object.values(redirected).every((u) => !u.length));

  section("3. the place a column names, once it stands, carries that column's market");
  const fixtures = {};
  for (const k of PLACED) {
    fixtures[k] = await gm.fixture(PLACE_MARKER(k), "Actor", {
      name: `QA market place ${k}`,
      type: "acks-extras.location",
      flags: { "acks-extras": { cookbook: { id: REDIRECT[k], book: BOOK, kind: "kind.location" } } },
    });
  }
  note("3: places (kept)", Object.fromEntries(PLACED.map((k) => [k, fixtures[k].uuid])));
  check("3: each place is built this run, its last one retired", PLACED.every((k) => fixtures[k].built));
  const r2 = await step(gm);
  note("3: second run", counts(r2));
  // A base from the same page is written again and counts updated; a joined
  // place's base from a later book is never replaced by this book's.
  check("3: the second run lands each placed column on its place, writes this page's bases again, and keeps each joined place's own",
    r2.updated === fresh.length + PLACED.length + ownBase.length && r2.kept === bound.length - ownBase.length && !r2.made && !r2.paired && !r2.waiting && !r2.refused, counts(r2));
  const placed = {};
  for (const k of PLACED) placed[k] = await run(gm, P.market, { uuid: fixtures[k].uuid, book: BOOK, gridId: GRID, key: k, fresh: false });
  note("3: the places", placed);
  check("3: each place carries its column's base demand, sourced to the page",
    PLACED.every((k) => placed[k].hasMarket && placed[k].demandIsTheGrid && placed[k].sourceIsThePage), PLACED.filter((k) => !placed[k].demandIsTheGrid || !placed[k].sourceIsThePage));
  const afterPlaced = await run(gm, P.standing, { ids: PLACED.map(idOf) });
  check("3: no market stands under a placed column's own id", PLACED.every((k) => !afterPlaced[idOf(k)].length));

  // Where every column joins, the placed column's place is the walk's own
  // market to drive.
  const ownMarket = (i) => (fresh[i] ? made[idOf(fresh[i])][0] : PLACED[0] ? fixtures[PLACED[0]].uuid : null);
  section("4. a base the Judge set stands through a third run");
  const judged = ownMarket(0);
  note("4: the Judge's market", fresh[0] ? "a made market" : "the placed column's place");
  const hand = judged ? await run(gm, P.judgeBase, { uuid: judged }) : null;
  check("4: the demand engine's base write lands and makes the base the Judge's", !!hand?.ok && hand.sourceCleared, hand && { ok: hand.ok, sourceCleared: hand.sourceCleared });
  const r3 = await step(gm);
  note("4: third run", counts(r3));
  check("4: the third run makes, joins and waits for nothing, and keeps the Judge's market beside each joined place's own",
    !r3.made && !r3.paired && !r3.waiting && !r3.refused && r3.kept === bound.length - ownBase.length + 1 && r3.updated === fresh.length + ownBase.length + PLACED.length - 1, counts(r3));
  const kept = judged ? await run(gm, P.baseOf, { uuid: judged }) : null;
  check("4: the Judge's base is unchanged and still the Judge's", !!kept && JSON.stringify(kept.base) === JSON.stringify(hand?.base) && kept.sourceCleared);

  section("5. a market of the walk's own shows its base on its Trade tab");
  const shownUuid = ownMarket(1);
  const shown = shownUuid ? await run(gm, P.tradeTab, { uuid: shownUuid }) : null;
  check("5: the sheet opens on its Trade tab with one chip per stored good, each showing its modifier",
    !!shown?.opened && shown.tab && shown.chips === shown.stored && shown.chips > 0 && shown.modifiersShown, shown);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm && steered) note("unsteer", await run(gm, P.unsteer, { gridId: GRID })); } catch (err) { console.error("unsteer:", err?.message ?? err); }
  // A market left standing answers the next run's presence check, so the step's
  // own output goes; the places carry their markers and stay.
  try {
    const only = gm ? gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) : [];
    const sw = only.length ? await gm.sweepTracked({ only }) : null;
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
