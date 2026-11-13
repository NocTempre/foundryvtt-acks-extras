/**
 * Live walk, equipment-printed-layers: where an imported variation's figures
 * came from. Walks docs/equipment/TESTING.md "Weapon rows, and the silver and
 * masterwork figures", step 5, on the GM seat with the rules book open: a
 * variation minted from the book reads as read from its page on the real data
 * model, a Judge's edit to one of its figures reads as edited by hand, and a
 * repair puts the page's figures and the stamp back together. Machine values
 * arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/provenance-variation`, a world
 * variation built by the importer's own binder from the first masterwork entry
 * whose page states both a delta and a cost, under the walk-only key and entry
 * id `walk.provenance`, so no reader of the library's variations ever finds it.
 * Each run repairs it to the page's shape before its first check. Every figure
 * stays in the page; what is printed is booleans and a cookbook id.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/provenance-variation";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__pl = globalThis.__pl ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.EX = await import("/modules/acks-extras/scripts/importer/executor.mjs");
    H.RF = await import("/modules/acks-extras/scripts/importer/refresh.mjs");
    H.PL = await import("/modules/acks-extras/scripts/equipment/printed-layers.mjs");
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  /** Open a staged book for this session only; nothing is remembered on the seat. */
  connectBook: async ({ id, path }) => {
    const H = globalThis.__pl;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    H.book = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { H.book = { done: true, ok: true }; })
      .catch((e) => { H.book = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const H = globalThis.__pl;
    return { ...(H.book ?? {}), open: !!H.CB.cookbookSessionDoc(id) };
  },
  /**
   * The walk's variation as the importer builds it, from the first masterwork
   * entry whose page states a delta and a cost, under the walk-only key and id.
   * Null with a reason when the book is not open or no entry reads both.
   */
  build: async () => {
    const H = globalThis.__pl;
    const key = "walk.provenance";
    let book = null;
    for (const [id, entry] of H.CB.variationEntries()) {
      if (!String(entry.meta?.key ?? "").startsWith("masterwork.")) continue;
      book = entry.book ?? "rr";
      const doc = H.CB.cookbookSessionDoc(book);
      if (!doc) continue;
      const found = H.CB.cookbookEntry(id);
      const node = await H.EX.executeEntry(doc, found.cb, H.CB.cookbookRegisters(), id).catch(() => null);
      if (!node?.ok) continue;
      const built = H.CB.bindVariation(entry, node, id);
      if (!built.system.deltas || !built.system.cost) continue;
      const stamp = built.flags["acks-extras"].cookbook;
      H.data = {
        ...built,
        name: "QA Provenance Variation",
        flags: { "acks-extras": { cookbook: { ...stamp, id: key } } },
        system: { ...built.system, key },
      };
      return { entry: id, data: H.data };
    }
    return { entry: null, reason: book && !H.CB.cookbookSessionDoc(book) ? "book-closed" : "no-entry-reads-both" };
  },
  /** What the figure's provenance reads now, as booleans against each tooltip the module can write. */
  read: async ({ uuid }) => {
    const H = globalThis.__pl;
    const doc = await fromUuid(uuid);
    const source = H.PL.sourceOf(doc);
    const tip = H.PL.provenanceTip(source);
    const fmt = (k) => game.i18n.format(`ACKS-EQUIPMENT.printed.${k}`, { name: source.name, cite: source.cite || source.name });
    const read = doc.flags?.["acks-extras"]?.cookbook?.read ?? null;
    return {
      stamped: !!read,
      byHand: source.byHand,
      edited: source.edited,
      citesPage: !!source.cite,
      fromPage: tip === fmt("fromPage"),
      editedByHand: tip === fmt("editedByHand"),
      costAdd: Number(doc.system.cost?.add ?? 0),
      builtCostAdd: Number(H.data?.system?.cost?.add ?? 0),
    };
  },
  /** The import's repair of one document: the page's figures and the stamp, written in place. */
  repair: async ({ uuid }) => {
    const H = globalThis.__pl;
    const doc = await fromUuid(uuid);
    const result = await H.RF.refreshImported(doc, H.data, H.RF.REPAIR.variation);
    return { refused: !result || typeof result === "string" || !!result.refused };
  },
  /** A Judge's edit: one figure moved by one, the way the variation sheet's field writes it. */
  edit: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ "system.cost.add": Number(doc.system.cost?.add ?? 0) + 1 });
    return true;
  },
  drain: async () => ({ errors: globalThis.__pl.errors.slice() }),
  restore: async () => {
    const H = globalThis.__pl;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 300_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed);

  section("fixture");
  for (const book of books(["rr"])) {
    note(`connect ${book.id}`, await run(gm, P.connectBook, book));
    let state = await run(gm, P.bookState, { id: book.id });
    for (let n = 0; n < 90 && !state.open && !state.done; n++) { await sleep(2000); state = await run(gm, P.bookState, { id: book.id }); }
    note(`book ${book.id}`, { open: state.open, error: state.error ?? null });
  }
  const built = await run(gm, P.build);
  if (!built.entry) throw new Error(`no variation to build: ${built.reason}`);
  note("built from entry", built.entry);
  const fixture = await gm.fixture(MARKER, "Item", built.data);
  const uuid = fixture.uuid;
  const shaped = await run(gm, P.repair, { uuid });
  check("shape: the import's repair writes the page's figures over the kept fixture", !shaped.refused, shaped);

  section("5. where a minted variation's figure came from");
  const fresh = await run(gm, P.read, { uuid });
  check("the stamp records the figures it read, and survives the data model", fresh.stamped, { stamped: fresh.stamped });
  check("a minted document holding its page's figures reads as read from its page, not edited", !fresh.byHand && !fresh.edited && fresh.citesPage && fresh.fromPage, { byHand: fresh.byHand, edited: fresh.edited, fromPage: fresh.fromPage });
  check("its figure is the one the binder read", fresh.costAdd === fresh.builtCostAdd, { matches: fresh.costAdd === fresh.builtCostAdd });
  await run(gm, P.edit, { uuid });
  const edited = await run(gm, P.read, { uuid });
  check("a Judge's edit to one figure reads as edited by hand, naming the page the import read", edited.edited && edited.editedByHand && !edited.fromPage, { edited: edited.edited, editedByHand: edited.editedByHand });
  const repaired = await run(gm, P.repair, { uuid });
  const after = await run(gm, P.read, { uuid });
  check("a repair puts the page's figure and the stamp back, and it reads from its page again", !repaired.refused && !after.edited && after.fromPage && after.costAdd === after.builtCostAdd, { refused: repaired.refused, edited: after.edited, fromPage: after.fromPage });

  const drained = await run(gm, P.drain);
  check("no console error over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  console.log(`fixture kept: ${MARKER}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
