/**
 * Live walk, importer-research-tables: the `magicResearch` registry document
 * read from the seat's own Revised Rulebook. Walks docs/importer/TESTING.md
 * "The magic research tables" on the GM seat, and the registry read on the
 * Player seat: with the Rulebook connected, a Rules tables import of
 * `magicResearch` writes every table `RESEARCH_TABLE_IDS` names; each table's
 * cite names the Rulebook; `readResearchTables` answers `present: true` for each
 * and holds no null figure in a table read whole; the Player seat reads the
 * same tables; the Ruledata Browser lists them; and an override set through the
 * registry's override layer reads back `byHand` with no page, touches no other
 * table, and is removed so the read is what it was before. Machine values
 * arrive through ./_env.mjs.
 *
 * Fixtures: none built, and no document is created. The imported document is
 * the world's, read and re-read. The one write is a Judge's override of one
 * small table, made through the Browser's own store, recorded on the page by
 * table name and removed by that record in teardown if the walk dies first.
 * Every figure printed is a boolean or a count, and the figure the override
 * sets is an invented one: no book figure and no book name leaves the page.
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

/** Small tables the override step may take, each with a figure of its own to invent. A table another hand already overrode is left alone. */
const OVERRIDE_CANDIDATES = [
  { table: "sampleProse", key: "sampleBonus" },
  { table: "powerOfSacrifice", key: "multiplier" },
];
const INVENTED = 17;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__rt = globalThis.__rt ?? {});
    H.T = acksExtras.lib.tables;
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.TD = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    H.STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    H.R = await import("/modules/acks-extras/scripts/magic/research-tables.mjs");
    H.mine = H.mine ?? new Set();
    H.hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); };
    H.poll = async (test, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return !!test();
    };
    H.rr = (cite) => /\bRR\b|"rr"/.test(typeof cite === "string" ? cite : JSON.stringify(cite ?? ""));
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, tables: Object.values(H.R.RESEARCH_TABLE_IDS).length, distinct: new Set(Object.values(H.R.RESEARCH_TABLE_IDS)).size };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__rt;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__rtBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__rtBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__rtBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const open = !!globalThis.__rt.CB.cookbookSessionDoc(id);
    return { ...(globalThis.__rtBook ?? {}), open, done: !!(globalThis.__rtBook?.done || open) };
  },
  /** How many of the document's tables the world layer holds before the import. */
  held: async () => {
    const H = globalThis.__rt;
    const layer = H.T.getLayer(H.R.RESEARCH_DOC_ID, H.T.PRIORITY.WORLD);
    return { doc: !!layer, tables: Object.values(H.R.RESEARCH_TABLE_IDS).filter((id) => layer?.tables?.[id] != null).length };
  },
  importTables: async () => {
    globalThis.__rtImport = { done: false };
    acksExtras.importer.cookbookImportTables(["magicResearch"])
      .then((r) => {
        const mine = (id) => /^magicResearch\b/.test(String(id?.docId ?? id));
        globalThis.__rtImport = {
          done: true, ok: !!r,
          imported: (r?.imported ?? []).filter((d) => d?.docId === "magicResearch").length,
          written: (r?.imported ?? []).filter((d) => d?.docId === "magicResearch").reduce((s, d) => s + (d.tables?.length ?? 0), 0),
          incomplete: (r?.incomplete ?? []).filter(mine).length,
          unread: (r?.missingTables ?? []).filter(mine).length,
          missingBooks: (r?.missingBooks ?? []).length,
        };
      })
      .catch((e) => { globalThis.__rtImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importJob: async () => globalThis.__rtImport ?? { done: false },

  /**
   * Every table of the document as booleans and counts: stored, its cite names
   * the Rulebook, a hand did not set it, its reader answers present, and how
   * many figures the reader needs that came back null. Also a hash of the whole
   * read, for comparing two reads without printing a figure.
   */
  tables: async () => {
    const H = globalThis.__rt;
    const D = H.R.RESEARCH_DOC_ID;
    const read = H.R.readResearchTables();
    const f = read.facilities;
    const lost = (vals) => vals.filter((v) => v == null || v === false).length;
    const bonus = (b) => [b?.step, b?.size, b?.cap];
    const by = {
      researchLadder: { present: read.ladder.present, vals: [read.ladder.rungs.length > 0, ...read.ladder.rungs.flatMap((g) => [g.level, g.rate, g.throw])] },
      researchLadderNote: { present: read.ladder.otherProjectsRate != null, vals: [read.ladder.otherProjectsRate] },
      researchProse: { present: read.prose.present, vals: [read.prose.ancillary, read.prose.autoFail, read.prose.penalty, read.prose.penaltyMinimum] },
      assistantProse: { present: read.assistants.present, vals: [read.assistants.managerLevel, read.assistants.managerBase, read.assistants.aidLevel, read.assistants.spellLevel, read.assistants.itemLevel] },
      libraryProse: { present: f.library.present, vals: [f.library.minimum, f.library.step, ...bonus(f.library.bonus), f.library.share] },
      sampleProse: { present: read.sample.present, vals: [read.sample.bonus] },
      workshopProse: {
        present: f.workshop.present && f.identify.present && read.identification.present,
        vals: [f.workshop.minimum, f.workshop.step, ...bonus(f.workshop.bonus), ...bonus(f.identify.bonus), read.identification.minimumLevel, read.identification.material, read.identification.research],
      },
      ritualCostProse: {
        present: read.ritualCosts.present && f.ritualLibrary.present,
        vals: [read.ritualCosts.learn.material, read.ritualCosts.learn.research, read.ritualCosts.cast.component, read.ritualCosts.cast.material, read.ritualCosts.cast.research, f.ritualLibrary.minimums, ...bonus(f.ritualLibrary.bonus)],
      },
      ritualWorkshopProse: { present: f.ritualWorkshop.present, vals: [f.ritualWorkshop.minimums, ...bonus(f.ritualWorkshop.bonus)] },
      sacrificeTraits: { present: read.sacrifice.present, vals: [read.sacrifice.rows.length > 0, ...read.sacrifice.rows.map((r) => r.times)] },
      divineLifetime: { present: read.divineLifetime.present, vals: [read.divineLifetime.lifetime?.count, read.divineLifetime.lifetime?.unit] },
      arcaneLifetime: { present: read.arcaneLifetime.present, vals: [read.arcaneLifetime.lifetime?.unit] },
      powerOfSacrifice: { present: read.powerOfSacrifice.present, vals: [read.powerOfSacrifice.multiplier] },
    };
    const byHandOf = { researchLadder: read.ladder.byHand, sampleProse: read.sample.byHand, powerOfSacrifice: read.powerOfSacrifice.byHand };
    const out = {};
    for (const id of Object.values(H.R.RESEARCH_TABLE_IDS)) {
      let stored = false;
      try { stored = H.T.getTable(D, id) != null; } catch { stored = false; }
      const cite = H.T.citeOf(D, id);
      out[id] = {
        stored, rr: H.rr(cite), present: !!by[id]?.present, missing: by[id] ? lost(by[id].vals) : null,
        incompleteRows: H.T.incompleteRows(D, id).length, byHand: byHandOf[id] ?? false,
        hasCite: typeof cite === "string" ? cite.length > 0 : cite != null,
      };
    }
    return { tables: out, covered: Object.keys(by).length, sig: H.hash(JSON.stringify(read)) };
  },
  /** The Ruledata Browser's entries for the document, by table. */
  entries: async () => {
    const H = globalThis.__rt;
    const all = H.TD.listEntries().filter((e) => e.docId === H.R.RESEARCH_DOC_ID);
    const ids = new Set(all.map((e) => e.tableId));
    const wanted = Object.values(H.R.RESEARCH_TABLE_IDS);
    return { entries: all.length, listed: wanted.filter((id) => ids.has(id)).length, wanted: wanted.length, unlisted: wanted.filter((id) => !ids.has(id)).length };
  },

  /** An OVERRIDE of one table through the Browser's own store, never over another hand's. */
  override: async ({ candidates, value }) => {
    const H = globalThis.__rt;
    const D = H.R.RESEARCH_DOC_ID;
    const pick = candidates.find((c) => !H.STORE.hasOverride(D, c.table));
    if (!pick) return { set: false, reason: "every candidate already overridden" };
    const before = { sig: H.hash(JSON.stringify(H.R.readResearchTables())), cite: H.T.citeOf(D, pick.table) != null };
    H.mine.add(pick.table);
    await H.STORE.setOverride(D, pick.table, { [pick.key]: value }, { sourceName: "qa-research-tables" });
    const reads = () => {
      const r = H.R.readResearchTables();
      return pick.table === "sampleProse" ? { byHand: r.sample.byHand, cite: r.sample.cite, value: r.sample.bonus, present: r.sample.present } : { byHand: r.powerOfSacrifice.byHand, cite: r.powerOfSacrifice.cite, value: r.powerOfSacrifice.multiplier, present: r.powerOfSacrifice.present };
    };
    const served = await H.poll(() => reads().byHand === true);
    const now = reads();
    return {
      set: true, table: pick.table, key: pick.key, before, served,
      byHand: now.byHand, noPage: now.cite === null, valueRead: now.value === value, present: now.present,
      citeOfNull: H.T.citeOf(D, pick.table) === null, layerHolds: H.STORE.hasOverride(D, pick.table),
      sigChanged: H.hash(JSON.stringify(H.R.readResearchTables())) !== before.sig,
    };
  },
  /** Remove this run's overrides and wait for the registry to serve the imported read again. */
  clearOverrides: async ({ sig } = {}) => {
    const H = globalThis.__rt;
    const D = H.R.RESEARCH_DOC_ID;
    const cleared = [];
    for (const table of [...(H?.mine ?? [])]) {
      try { await H.STORE.clearOverride(D, table); H.mine.delete(table); cleared.push(table); } catch (e) { console.warn("clearOverride", e?.message ?? e); }
    }
    const left = Object.values(H.R.RESEARCH_TABLE_IDS).filter((t) => H.STORE.hasOverride(D, t)).length;
    let same = null;
    if (sig) same = await H.poll(() => H.hash(JSON.stringify(H.R.readResearchTables())) === sig);
    return { cleared: cleared.length, left, restored: same, layerGone: H.T.getLayer(D, H.T.PRIORITY.OVERRIDE)?.tables?.[cleared[0]] == null };
  },
  drain: async () => ({ errors: globalThis.__rt.errors.slice() }),
  restore: async () => {
    const H = globalThis.__rt;
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
let beforeSig = null;
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
  check("RESEARCH_TABLE_IDS names thirteen distinct tables", installed.tables === 13 && installed.distinct === 13, { tables: installed.tables, distinct: installed.distinct });

  section("books");
  const staged = books(["rr"]);
  if (staged.length !== 1) blocked(`ACKS_TEST_BOOKS names ${staged.length} of rr`);
  for (const { id, path } of staged) {
    await run(gm, P.connectBook, { id, path });
    const state = await waitFor(gm, P.bookState, { id }, `connect ${id}`);
    check(`${id} is open on the seat`, state.open, { ok: state.ok ?? null, error: state.error ?? null });
  }

  section("magicResearch: import");
  const held = await run(gm, P.held);
  note("held before the import", held);
  await run(gm, P.importTables);
  const job = await waitFor(gm, P.importJob, {}, "import the research tables", 420);
  check("the Rules tables import of magicResearch ran, wrote the document, and left nothing unread or incomplete", job.ok && job.imported === 1 && !job.incomplete && !job.unread && !job.missingBooks, job);
  const after = await run(gm, P.held);
  check("the world layer holds every one of the thirteen tables", after.doc && after.tables === 13, after);
  check("the report counts thirteen tables written", job.written === 13, { written: job.written });

  section("The magic research tables: each table read");
  const gt = await run(gm, P.tables);
  beforeSig = gt.sig;
  const ids = Object.keys(gt.tables);
  const everyOf = (test) => ids.filter((id) => test(gt.tables[id])).length;
  note("tables", Object.fromEntries(ids.map((id) => [id, { present: gt.tables[id].present, missing: gt.tables[id].missing, rr: gt.tables[id].rr }])));
  check("every table is stored, and every reader answers present: true", everyOf((t) => t.stored && t.present) === 13, { ok: everyOf((t) => t.stored && t.present) });
  check("every table's cite names the Rulebook", everyOf((t) => t.hasCite && t.rr) === 13, { ok: everyOf((t) => t.hasCite && t.rr) });
  check("no table is a hand's override or holds a row the import could not read", everyOf((t) => !t.byHand && t.incompleteRows === 0) === 13);
  check("no null figure in any table, every table read whole", everyOf((t) => t.missing === 0) === 13, { nullFigures: ids.map((id) => gt.tables[id].missing).reduce((a, b) => a + (b ?? 0), 0), tablesWithNull: ids.filter((id) => gt.tables[id].missing !== 0) });
  check("the walk's reads cover every table", gt.covered === 13, { covered: gt.covered });

  section("The Ruledata Browser");
  const en = await run(gm, P.entries);
  note("entries", en);
  check("the Browser lists each of the thirteen tables", en.listed === 13 && en.unlisted === 0, en);

  section("Player seat: the registry reads the same");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install);
  const pt = await run(player, P.tables);
  const pids = Object.keys(pt.tables);
  check("the Player seat is a player and reads all thirteen tables present, citing the Rulebook, with no null figure", !seated.isGM && pids.length === 13 && pids.every((id) => pt.tables[id].stored && pt.tables[id].present && pt.tables[id].rr && pt.tables[id].missing === 0), { role: seated.role });
  check("the Player seat's whole read matches the GM seat's", pt.sig === gt.sig, { same: pt.sig === gt.sig });

  section("The override layer");
  const ov = await run(gm, P.override, { candidates: OVERRIDE_CANDIDATES, value: INVENTED });
  note("override", { set: ov.set, table: ov.table, served: ov.served, byHand: ov.byHand, noPage: ov.noPage });
  check("an override is set on a small table through the store", ov.set === true && ov.served === true, { reason: ov.reason ?? null, table: ov.table });
  check("the table reads back byHand, with the figure set and no page", ov.byHand === true && ov.valueRead === true && ov.noPage === true && ov.citeOfNull === true && ov.present === true, { byHand: ov.byHand, value: ov.valueRead, noPage: ov.noPage, citeOfNull: ov.citeOfNull });
  const during = await run(gm, P.tables);
  const others = Object.entries(during.tables).filter(([id]) => id !== ov.table);
  check("the override replaces that table only: the other twelve still cite the Rulebook and read as imported", others.length === 12 && others.every(([, t]) => t.rr && !t.byHand && t.missing === 0) && ov.sigChanged === true && during.sig !== gt.sig, { others: others.length, sigChanged: ov.sigChanged });
  const cleared = await run(gm, P.clearOverrides, { sig: beforeSig });
  note("override cleared", cleared);
  check("the override is removed: none stands and the read is what it was before, hash for hash", cleared.cleared === 1 && cleared.left === 0 && cleared.restored === true && cleared.layerGone === true, cleared);
  const back = await run(gm, P.tables);
  check("every table cites the Rulebook again, none byHand", Object.values(back.tables).every((t) => t.rr && !t.byHand && t.missing === 0) && back.sig === gt.sig);

  const drained = await run(gm, P.drain);
  check("no console error on the GM seat over the walk (recorder attached after ready)", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { note("overrides swept", await run(gm, P.clearOverrides, {})); } catch (err) { console.error("clearOverrides:", err?.message ?? err); }
  }
  for (const api of [gm, player]) { try { if (api) note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); } }
  console.log("imports kept: magicResearch");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
