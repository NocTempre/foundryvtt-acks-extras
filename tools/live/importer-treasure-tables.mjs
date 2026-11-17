/**
 * Live walk, importer-treasure-tables: the treasure wave's two registry
 * documents read from the seat's own books. Walks docs/importer/TESTING.md
 * "The treasure tables" and "The magic-item and arms tables" on the GM seat,
 * and the registry read on the Player seat: with the Judges Journal and the
 * Treasure Tome connected, a Rules tables import of `treasure` and
 * `magicItemTables` writes every table; each band list tiles its die; the
 * Tome's version stands where it prints the same table (its cite names the
 * Tome) and the Journal's stands where the Tome's shape differs; the Gritty
 * grid, the coin units, the lot units and the dice legends are held; every
 * Random Type row hops to one classic list; the Ruledata Browser lists the
 * entries, rollable where they are lists; and an exported list's RollTable
 * holds one result per band on the die its bands reach. Machine values arrive
 * through ./_env.mjs.
 *
 * Fixtures: none built. The imported documents are the world's, read and
 * re-read. A RollTable the export makes where none stood is this run's and is
 * tracked by uuid and swept; one that already stood is updated in place, as
 * the Browser's Export does, and kept. Every figure printed is a boolean or a
 * count: no book figure and no book name leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, books, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__tt = globalThis.__tt ?? {});
    H.T = acksExtras.lib.tables;
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.TD = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    H.tiles = (bands) => {
      if (!Array.isArray(bands) || !bands.length) return false;
      const lo = (b) => Number(b?.min ?? b?.lo);
      const hi = (b) => Number(b?.max ?? b?.hi ?? b?.min ?? b?.lo);
      const s = [...bands].sort((a, b) => lo(a) - lo(b));
      return lo(s[0]) === 1 && s.every((b, i) => !i || lo(b) === hi(s[i - 1]) + 1);
    };
    H.top = (bands) => Math.max(...bands.map((b) => Number(b?.max ?? b?.hi ?? b?.min ?? 0)));
    H.fromTT = (cite) => /\bTT\b|"tt"/.test(typeof cite === "string" ? cite : JSON.stringify(cite ?? ""));
    H.fromJJ = (cite) => /\bJJ\b|"jj"/.test(typeof cite === "string" ? cite : JSON.stringify(cite ?? ""));
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__tt;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__ttBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__ttBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__ttBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const open = !!globalThis.__tt.CB.cookbookSessionDoc(id);
    return { ...(globalThis.__ttBook ?? {}), open, done: !!(globalThis.__ttBook?.done || open) };
  },
  importTables: async () => {
    globalThis.__ttImport = { done: false };
    acksExtras.importer.cookbookImportTables(["treasure", "magicItemTables"])
      .then((r) => {
        const mine = (id) => /^(treasure|magicItemTables)\b/.test(String(id?.docId ?? id));
        globalThis.__ttImport = { done: true, ok: !!r, imported: r?.imported?.length ?? null, incomplete: (r?.incomplete ?? []).filter(mine).length, unread: (r?.missingTables ?? []).filter(mine).length };
      })
      .catch((e) => { globalThis.__ttImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importJob: async () => globalThis.__ttImport ?? { done: false },

  /** The treasure document as booleans and counts. */
  treasure: async () => {
    const H = globalThis.__tt;
    if (!H.T.hasDoc("treasure")) return { doc: false };
    const t = H.T.getDoc("treasure").tables ?? {};
    const letters = (g) => Object.keys(g ?? {}).filter((k) => /^[A-R]$/.test(k)).length;
    const special = t.special ?? {};
    const kinds = Object.keys(special);
    const per = t.specialPer ?? {};
    const units = t.typeUnits ?? {};
    const cite = (id) => H.T.citeOf("treasure", id);
    return {
      doc: true,
      classic: letters(t.typeClassic), heroic: letters(t.typeHeroic), gritty: letters(t.typeGritty),
      gemTiles: H.tiles(t.gemValue?.bands), jewelryTiles: H.tiles(t.jewelryValue?.bands),
      kinds: kinds.length, kindsTile: kinds.filter((k) => H.tiles(special[k])).length,
      perKinds: Object.keys(per).length,
      unitGrids: Object.keys(units).length,
      unitCells: Object.values(units).map((u) => Object.keys(u ?? {}).length),
      gemLegend: (t.gemDice?.legend ?? t.gemDice ?? []).length ?? 0,
      jewelryLegend: (t.jewelryDice?.legend ?? t.jewelryDice ?? []).length ?? 0,
      classicFromTT: H.fromTT(cite("typeClassicRaw")), grittyFromTT: H.fromTT(cite("typeGrittyRaw")),
      gemFromTT: H.fromTT(cite("gemValueRaw")), spFromTT: H.fromTT(cite("specialSpRaw")),
    };
  },
  /** The magic-item document as booleans and counts. */
  magic: async () => {
    const H = globalThis.__tt;
    if (!H.T.hasDoc("magicItemTables")) return { doc: false };
    const t = H.T.getDoc("magicItemTables").tables ?? {};
    const classic = t.classic ?? {};
    const heroic = t.heroic ?? {};
    const hops = (t.classicType?.bands ?? []).map((b) => b.hop ?? null);
    const lists = Object.keys(classic);
    const cite = (id) => H.T.citeOf("magicItemTables", id);
    return {
      doc: true,
      typeBands: (t.classicType?.bands ?? []).length, typeTiles: H.tiles(t.classicType?.bands),
      hops: hops.length, hopsResolve: hops.filter((h) => h && lists.includes(String(h).replace(/^classic\./, ""))).length,
      hopsDistinct: new Set(hops).size,
      classicLists: lists.length, classicTile: lists.filter((k) => H.tiles(classic[k])).length,
      heroicLists: Object.keys(heroic).length, heroicTile: Object.keys(heroic).filter((k) => H.tiles(heroic[k])).length,
      creatureTiles: H.tiles(t.creatureType?.bands),
      creatureFromTT: H.fromTT(cite("creatureTypeRaw")),
      potionsFromJJ: H.fromJJ(cite("potionsRaw")) && !H.fromTT(cite("potionsRaw")),
      armsSettings: Object.keys(t.armsSettings ?? {}).length,
    };
  },
  /** The Ruledata Browser's entries for the two documents. */
  entries: async () => {
    const H = globalThis.__tt;
    const all = H.TD.listEntries().filter((e) => e.docId === "treasure" || e.docId === "magicItemTables");
    const by = (d) => all.filter((e) => e.docId === d);
    const find = (d, t, s) => all.find((e) => e.docId === d && e.tableId === t && (s == null || e.subId === s));
    const special = by("treasure").filter((e) => e.tableId === "special");
    return {
      treasure: by("treasure").length, magic: by("magicItemTables").length,
      specialRollable: special.filter((e) => e.rollable).length, special: special.length,
      gemRollable: !!find("treasure", "gemValue")?.rollable,
      typeClassicNotRollable: find("treasure", "typeClassic") ? !find("treasure", "typeClassic").rollable : null,
      typeGrittyListed: !!find("treasure", "typeGritty"),
      swordsRollable: !!find("magicItemTables", "classic", "swords")?.rollable,
      heroicRollable: by("magicItemTables").filter((e) => e.tableId === "heroic" && e.rollable).length,
    };
  },
  /** Export one list as its RollTable, the Browser's own path; report its shape against the bands. */
  exportList: async ({ docId, tableId, subId }) => {
    const H = globalThis.__tt;
    const entry = H.TD.listEntries().find((e) => e.docId === docId && e.tableId === tableId && (subId == null || e.subId === subId));
    if (!entry) return { entry: false };
    const before = new Set(game.tables.map((t) => t.uuid));
    const packsBefore = new Set();
    for (const p of game.packs.filter((p) => p.documentName === "RollTable")) for (const i of p.index) packsBefore.add(`Compendium.${p.collection}.RollTable.${i._id}`);
    const out = await H.TD.exportEntry(entry);
    const table = out?.uuid ? await fromUuid(out.uuid) : null;
    const raw = H.T.getTable(docId, tableId);
    const bands = subId != null ? raw?.[subId] : (raw?.bands ?? raw);
    const created = !!out?.uuid && !before.has(out.uuid) && !packsBefore.has(out.uuid);
    return {
      entry: true, uuid: out?.uuid ?? null, kind: out?.kind ?? null, created,
      results: table?.results?.size ?? null, bands: Array.isArray(bands) ? bands.length : null,
      formulaReachesTop: !!table && Array.isArray(bands) && table.formula === `1d${H.top(bands)}`,
      everyResultHasText: !!table && [...table.results].every((r) => String(r.description ?? r.text ?? r.name ?? "").trim().length > 0),
    };
  },
  drain: async () => ({ errors: globalThis.__tt.errors.slice() }),
  restore: async () => {
    const H = globalThis.__tt;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    H.patched = false;
    return "restored";
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

async function waitFor(api, fn, args, label, seconds = 300) {
  const t0 = Date.now();
  for (;;) {
    const state = await run(api, fn, args);
    if (state.done) return state;
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not done after ${seconds}s`);
    await sleep(2000);
  }
}

let gm = null;
let player = null;
const own = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 540_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  if (!installed.isGM) blocked("the GM seat joined is not a GM");
  check("the GM seat is a GM", installed.isGM, { role: installed.role, activeGMIsSelf: installed.activeGMIsSelf });

  section("books");
  const staged = books(["jj", "tt"]);
  if (staged.length !== 2) blocked(`ACKS_TEST_BOOKS names ${staged.length} of jj and tt`);
  for (const { id, path } of staged) {
    await run(gm, P.connectBook, { id, path });
    const state = await waitFor(gm, P.bookState, { id }, `connect ${id}`);
    check(`${id} is open on the seat`, state.open, { ok: state.ok ?? null, error: state.error ?? null });
  }

  section("treasure and magic-item tables: import");
  await run(gm, P.importTables);
  const job = await waitFor(gm, P.importJob, {}, "import the treasure tables", 420);
  check("the Rules tables import of treasure and magicItemTables ran with nothing unread or incomplete", job.ok && !job.incomplete && !job.unread, job);

  section("The treasure tables: 1-2, 7-10");
  const tr = await run(gm, P.treasure);
  note("treasure", tr);
  check("1. the treasure document is written", tr.doc);
  check("1. Classic, Heroic and Gritty each hold the eighteen letters", tr.classic === 18 && tr.heroic === 18 && tr.gritty === 18, { classic: tr.classic, heroic: tr.heroic, gritty: tr.gritty });
  check("2. eleven special lists, every one tiling its die", tr.kinds === 11 && tr.kindsTile === 11, { kinds: tr.kinds, tile: tr.kindsTile });
  check("2. gem and jewelry value lists tile their dice", tr.gemTiles && tr.jewelryTiles);
  check("7. a lot unit for each of the eleven lists, three coin-unit grids of five, a three-row legend over each value list", tr.perKinds === 11 && tr.unitGrids === 3 && tr.unitCells.every((n) => n === 5) && tr.gemLegend === 3 && tr.jewelryLegend === 3, { per: tr.perKinds, grids: tr.unitGrids, cells: tr.unitCells, legends: [tr.gemLegend, tr.jewelryLegend] });
  check("8. with the Tome open its tables stand: Classic, Gritty, gem value and a special list cite the Tome", tr.classicFromTT && tr.grittyFromTT && tr.gemFromTT && tr.spFromTT, { classic: tr.classicFromTT, gritty: tr.grittyFromTT, gem: tr.gemFromTT, sp: tr.spFromTT });

  section("The magic-item and arms tables: 1-2, 7");
  const mi = await run(gm, P.magic);
  note("magicItemTables", mi);
  check("1. the magicItemTables document is written", mi.doc);
  check("1. eight classic lists and five heroic lists, every one tiling its die", mi.classicLists === 8 && mi.classicTile === 8 && mi.heroicLists === 5 && mi.heroicTile === 5, { classic: [mi.classicLists, mi.classicTile], heroic: [mi.heroicLists, mi.heroicTile] });
  check("2. eight Random Type rows, each hopping to a different classic list", mi.typeBands === 8 && mi.typeTiles && mi.hops === 8 && mi.hopsResolve === 8 && mi.hopsDistinct === 8, { bands: mi.typeBands, resolve: mi.hopsResolve, distinct: mi.hopsDistinct });
  check("7. Creature Type tiles and cites the Tome; the potions list, a different shape in the Tome, still cites the Journal", mi.creatureTiles && mi.creatureFromTT && mi.potionsFromJJ, { creature: mi.creatureFromTT, potions: mi.potionsFromJJ });
  check("7. seven arms settings are named", mi.armsSettings === 7, { settings: mi.armsSettings });

  section("The Ruledata Browser: treasure 3, magic items 3");
  const en = await run(gm, P.entries);
  note("entries", en);
  check("the eleven special lists and gem value are rollable; the Classic grid is not; Gritty is listed", en.special === 11 && en.specialRollable === 11 && en.gemRollable && en.typeClassicNotRollable === true && en.typeGrittyListed, en);
  check("the swords list and the five heroic lists are rollable", en.swordsRollable && en.heroicRollable === 5, { swords: en.swordsRollable, heroic: en.heroicRollable });

  section("RollTables: treasure 4, magic items 4");
  for (const [label, args] of [["a special list", { docId: "treasure", tableId: "special", subId: "sp" }], ["the swords list", { docId: "magicItemTables", tableId: "classic", subId: "swords" }]]) {
    const ex = await run(gm, P.exportList, args);
    if (ex.created && ex.uuid) { own.push(ex.uuid); await gm.track(ex.uuid, "RollTable"); }
    note(`export ${label}`, { kind: ex.kind, created: ex.created, results: ex.results, bands: ex.bands });
    check(`${label} exports as a RollTable with one result per band, its formula the die its bands reach, every result carrying text`, ex.entry && ex.kind === "rolltable" && ex.results === ex.bands && ex.formulaReachesTop && ex.everyResultHasText, ex);
  }

  section("Player seat: the registry reads the same");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install);
  const ptr = await run(player, P.treasure);
  const pmi = await run(player, P.magic);
  check("the Player seat is a player and reads both documents with the GM's counts", !seated.isGM && ptr.doc && pmi.doc && ptr.kinds === tr.kinds && ptr.gritty === tr.gritty && pmi.classicLists === mi.classicLists && pmi.hopsResolve === mi.hopsResolve, { role: seated.role });

  const drained = await run(gm, P.drain);
  check("no console error on the GM seat over the walk (recorder attached after ready)", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && own.length) {
    try { note("RollTables swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const api of [gm, player]) { try { if (api) note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); } }
  console.log("imports kept: treasure, magicItemTables");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
