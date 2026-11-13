/**
 * Live walk, henchmen-cultures: the cultures a Judge's book names. Walks
 * docs/henchmen/TESTING.md step 24 on the GM seat: the staged rulebook is
 * opened, Rules tables is run for the `people` document, and what the import
 * wrote is read back; the Location sheet's Demographics block (GM Settings
 * tab) lists those labels and its Add row writes the first imported culture;
 * and a generated candidate carries the label of the culture it drew, with a
 * name from that culture's list. Machine values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `henchmen/cultures-place`, a location
 * with a market. The step that needs a shape writes it at its start (the
 * demographics emptied). The `people` tables the import writes stay in the
 * world, as every import's do; nothing else is made, so there is nothing to
 * sweep. Every figure printed is a count or a boolean: no culture label, name
 * or palette leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEAT = MACHINE.gm;
const RR = books(["rr"])[0] ?? null;
const BTA = books(["bta"])[0] ?? null;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__hcBoot = { phase: "load", phases: [], errors: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__hc = globalThis.__hc ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.ID = await import("/modules/acks-extras/scripts/henchmen/rules/identity.mjs");
    H.RECIPES = (await import("/modules/acks-extras/scripts/importer/table-recipes.mjs")).TABLE_RECIPES;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => {
      const el = app?.element;
      return el?.nodeType === 1 ? el : (el?.[0] ?? null);
    };
    return {
      user: game.user.name, isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      boot: globalThis.__hcBoot ?? null,
    };
  },
  /** The place brought to the shape the sheet step starts from: no demographics rows. */
  shape: async ({ placeId }) => {
    const place = game.actors.get(placeId);
    await place.update({ "system.market.demographics": [] });
    return { market: !!place.system.hasMarket, rows: (place.system.market?.demographics ?? []).length };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__hc;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__hcBook = { id, done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__hcBook = { id, done: true, ok: true }; })
      .catch((e) => { globalThis.__hcBook = { id, done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__hcBook, session: !!globalThis.__hc.CB.cookbookSessionDoc(id) }),
  /** Rules tables for one ruledata document, run as the Manage imports dialog runs it. */
  importDoc: async ({ id }) => {
    globalThis.__hcImport = { done: false };
    acksExtras.importer.cookbookImportTables([id])
      .then((r) => { globalThis.__hcImport = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId), missingBooks: r?.missingBooks ?? [] }; })
      .catch((e) => { globalThis.__hcImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async () => ({ ...globalThis.__hcImport }),
  /** What the import wrote, as booleans and counts: the labels themselves never leave the page. */
  read: async () => {
    const H = globalThis.__hc;
    const T = acksExtras.lib.tables;
    if (!T.hasDoc("people")) return { doc: false };
    const list = T.getTable("people", "cultures")?.list ?? {};
    const ids = Object.keys(list);
    const recipe = H.RECIPES.people.tables;
    const open = (b) => !!H.CB.cookbookSessionDoc(b.book ?? recipe.cultures.book);
    const expected = recipe.cultures.blocks.filter(open);
    const palettes = T.getTable("people", "cultureAppearance")?.cultures ?? {};
    return {
      doc: true,
      cultures: ids.length,
      expected: expected.length,
      allExpectedWritten: expected.every((b) => b.cultureId in list),
      idsAreOrdinal: ids.every((id) => /^(culture\d+|dwarven|elven|lizardman|people2)$/.test(id)),
      humanOrdinals: Array.from({ length: 12 }, (_, i) => `culture${i + 1}`).every((id) => id in list),
      labelsRead: expected.every((b) => typeof list[b.cultureId]?.label === "string" && list[b.cultureId].label.trim() !== "" && list[b.cultureId].label !== b.meta.label),
      neutralLabels: expected.filter((b) => list[b.cultureId]?.label === b.meta.label).length,
      palettes: Object.keys(palettes).length,
      palettesExpected: recipe.cultureAppearance.valueBlocks.filter((b) => b.id in list).length,
      namesRead: ids.every((id) => (list[id].male ?? []).length > 0 && (list[id].female ?? []).length > 0),
      firstId: ids[0] ?? null,
    };
  },
  /** The place sheet on GM Settings, the Demographics add pressed, the select and the stored row read back. */
  sheet: async ({ placeId }) => {
    const H = globalThis.__hc;
    const list = acksExtras.lib.tables.getTable("people", "cultures").list;
    const ids = Object.keys(list);
    const place = game.actors.get(placeId);
    const app = place.sheet;
    await app.render(true);
    await H.poll(() => app.rendered && H.root(app)?.querySelector("[data-tab='gmSettings']"));
    app.changeTab("gmSettings", "primary");
    await H.sleep(300);
    const add = H.root(app).querySelector("[data-action='addDemographic']");
    const before = (place.system.market?.demographics ?? []).length;
    add?.click();
    await H.poll(() => (place.system.market?.demographics ?? []).length === before + 1 && H.root(app)?.querySelector(".demographic-row select"));
    await H.sleep(300);
    const select = H.root(app).querySelector(".demographic-row select");
    const options = [...(select?.options ?? [])];
    const stored = (place.system.market?.demographics ?? [])[0];
    const out = {
      add: !!add,
      rows: (place.system.market?.demographics ?? []).length,
      options: options.length,
      optionsAreTheImported: options.length === ids.length && options.every((o, i) => o.value === ids[i] && o.textContent.trim() === list[ids[i]].label),
      storedFirst: stored?.culture === ids[0],
      shownFirst: select?.value === ids[0],
    };
    await app.close({ animate: false });
    return out;
  },
  /** A generated candidate whose demographics hold one culture; the race-to-culture lookups the identity rules make. */
  candidate: async () => {
    const H = globalThis.__hc;
    const list = acksExtras.lib.tables.getTable("people", "cultures").list;
    const human = Object.keys(list).find((id) => /^culture\d+$/.test(id) && (list[id].race ?? "human") === "human" && !list[id].alsoRaces);
    const identity = H.ID.generateIdentity({ rand: () => 0, demographics: [{ culture: human, weight: 1 }], level: 1 });
    const lender = Object.keys(list).find((id) => list[id].alsoRaces?.includes("people1"));
    return {
      drewThatCulture: identity.culture === human,
      labelIsTheImported: identity.cultureLabel === list[human].label && identity.cultureLabel !== `Culture ${human.slice("culture".length)}`,
      nameFromItsList: (list[human].male ?? []).includes(String(identity.name).split(" ")[0]),
      people1Lender: !!lender && H.ID.pickCulture(() => 0, [], "people1") === lender,
      lizardmanRace: !("lizardman" in list) || H.ID.raceOfCulture("lizardman") === "lizardman",
    };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}
/** Opens one staged book on the seat and waits for its session. */
async function openBook(api, book) {
  note(`book ${book.id}`, await run(api, P.connectBook, book));
  let state = null;
  for (let n = 0; n < 150; n++) { state = await run(api, P.bookState, { id: book.id }); if (state.done || state.session) break; await sleep(2000); }
  return !!state?.session;
}

let gm = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: SEAT, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  const installed = await run(gm, P.install);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, { role: installed.role });
  if (!installed.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  const phases = installed.boot?.phases ?? [];
  check("init, setup and ready ran with no error recorded from before the first script", ["init", "setup", "ready"].every((p) => phases.includes(p)) && (installed.boot?.errors ?? []).length === 0, { phases, errors: (installed.boot?.errors ?? []).length });

  section("fixture");
  const market = await gm.eval(`(async () => JSON.stringify(await (await import("/modules/acks-extras/scripts/location/data/location-data.mjs")).emptyMarket()))()`).then(JSON.parse);
  const place = await gm.fixture("henchmen/cultures-place", "Actor", { name: "QA Cultures Place", type: "acks-extras.location", system: { market } });
  const shaped = await run(gm, P.shape, { placeId: place.id });
  check("24: the place has a market and no demographics rows", shaped.market && shaped.rows === 0, shaped);

  section("24: Rules tables for the people document, read from the staged books (the real trigger)");
  if (!RR) blocked("ACKS_TEST_BOOKS names no rr book");
  check("24: the staged rulebook opens on the GM seat", await openBook(gm, RR), { id: RR.id });
  const supplement = BTA ? await openBook(gm, BTA) : false;
  note("supplement staged and open", { staged: !!BTA, open: supplement });
  await run(gm, P.importDoc, { id: "people" });
  let imported = null;
  for (let n = 0; n < 120; n++) { imported = await run(gm, P.importState); if (imported.done) break; await sleep(2000); }
  check("24: Rules tables for the people document runs and imports it", imported?.ok && imported.imported.includes("people"), { ok: imported?.ok, imported: imported?.imported, missingBooks: (imported?.missingBooks ?? []).length });
  const read = await run(gm, P.read);
  note("read", read);
  check("24: every culture whose book is open was written, under an ordinal id or a race word", read.doc && read.allExpectedWritten && read.cultures === read.expected && read.idsAreOrdinal && read.humanOrdinals, read);
  check("24: every written culture carries the label its heading prints, none the neutral fallback", read.labelsRead && read.neutralLabels === 0, { labelsRead: read.labelsRead, neutralLabels: read.neutralLabels });
  check("24: every culture has name lists, and every palette the recipe declares was read", read.namesRead && read.palettes === read.palettesExpected && read.palettes > 0, { namesRead: read.namesRead, palettes: read.palettes, expected: read.palettesExpected });

  section("24: the Location sheet's Demographics block lists those labels");
  const sheet = await run(gm, P.sheet, { placeId: place.id });
  note("sheet", sheet);
  check("24: Add makes one row whose select lists the imported cultures by label, and the row starts on the first", sheet.add && sheet.rows === 1 && sheet.optionsAreTheImported && sheet.storedFirst && sheet.shownFirst, sheet);
  await run(gm, P.shape, { placeId: place.id });

  section("24: a generated candidate");
  const candidate = await run(gm, P.candidate);
  note("candidate", candidate);
  check("24: a candidate drawn from one culture carries that culture's imported label and a name from its list", candidate.drewThatCulture && candidate.labelIsTheImported && candidate.nameFromItsList, candidate);
  check("24: the people-1 race draws from the culture that lists it, and the lizard people's culture has their race", candidate.people1Lender && candidate.lizardmanRace, candidate);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  console.log("fixtures kept: henchmen/cultures-place");
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
