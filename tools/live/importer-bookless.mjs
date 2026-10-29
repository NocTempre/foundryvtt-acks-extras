/**
 * Live walk, importer-bookless: an import with a book closed creates nothing.
 * Walks docs/importer/TESTING.md, "An import with a book closed", steps 1–4.
 * Machine values arrive through ./_env.mjs. The walk needs a content book that
 * is NOT open on the GM seat: it reads which off the seat, and where the shelf
 * has opened every one it closes them on its own seat (`forgetBooks` drops
 * this browser's copies and leaves the shelf) and reopens one shelf book, with
 * `{remember: false}`, as the control. The seat is a throwaway profile, so
 * nothing durable is forgotten; a join restores the shelf. It picks entries of
 * the closed books the world does not hold. Every id it prints is a cookbook
 * id; no book word leaves the page. An entry is held where either side of the
 * library holds it: items, or actors for an animal.
 *
 * Fixtures: none kept. The closed-book steps create nothing by design, and a
 * `createItem` observer armed around each step proves it — an observer, never
 * a delete list. The control (step 4), an open book's ability the world does
 * not hold, runs only where one exists; its document is tracked and swept.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, ROOT } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const gaps = [];
/** A step the world cannot offer: printed as GAP with what was found, never as FAIL. */
const gap = (label, detail) => {
  gaps.push(label);
  console.log(`GAP   ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Each importer under test: the content files its entries come from, the kinds it takes, the api step and the shape its result has. */
const IMPORTERS = [
  { key: "abilities", files: ["proficiencies", "powers", "skills"], kinds: null, fn: "cookbookImportAbilities", made: (r) => r.made ?? 0, closed: (r) => r.closed ?? 0 },
  { key: "equipment", files: ["equipment"], kinds: ["kind.equipment"], fn: "importAllEquipment", made: (r) => r.created ?? 0, closed: (r) => r.passed?.closed ?? 0 },
  { key: "classes", files: ["classes"], kinds: ["kind.class"], fn: "importClasses", made: (r) => r.docs?.length ?? 0, closed: null },
  { key: "spells", files: ["spells"], kinds: ["kind.spell"], fn: "importSpells", made: (r) => r.docs?.length ?? 0, closed: null },
  { key: "traps", files: ["traps"], kinds: ["kind.trap"], fn: "importTraps", made: (r) => r.docs?.length ?? 0, closed: null },
  { key: "variations", files: ["variations"], kinds: ["kind.variation"], fn: "importVariations", made: (r) => r.docs?.length ?? 0, closed: null },
];
const CLOSED_NOTICE = /passed over — their book is not open on this seat/;

/** Every content entry the build ships, by importer: `[id, book]` rows. */
function entriesByImporter() {
  const dir = path.join(ROOT, "cookbook");
  const out = {};
  for (const imp of IMPORTERS) {
    out[imp.key] = [];
    for (const file of imp.files) {
      const p = path.join(dir, `${file}.json`);
      if (!fs.existsSync(p)) continue;
      const cb = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const [id, e] of Object.entries(cb.entries ?? {})) {
        if (imp.kinds && !imp.kinds.includes(e.kind)) continue;
        if (!imp.kinds && e.kind === "kind.classMeta") continue;
        if (e.book) out[imp.key].push([id, e.book]);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__bl = globalThis.__bl ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.BK = await import("/modules/acks-extras/scripts/importer/books.mjs");
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
    // An OBSERVER of what the world creates while a step runs: it proves a
    // run created nothing and is never swept from.
    if (!H.hook) {
      H.created = [];
      H.hook = Hooks.on("createItem", (doc) => H.created.push({ uuid: doc.uuid, id: doc.getFlag("acks-extras", "cookbook")?.id ?? null }));
    }
    return { installed: true, module: game.modules.get("acks-extras")?.version ?? null, isGM: game.user.isGM };
  },
  /** Which books are open on this seat, and which of `ids` the library holds. */
  census: async ({ books, ids }) => {
    const H = globalThis.__bl;
    const held = {};
    // An animal entry lands in the ACTOR collection, so an id the item side
    // does not hold is asked of the actor side before it reads as unheld.
    for (const id of ids) {
      held[id] = (await H.CB.importedItemFor(id))?.uuid ?? (await H.CB.importedActorFor(id, { copies: false }))?.uuid ?? null;
    }
    return { open: books.filter((b) => !!H.CB.cookbookSessionDoc(b)), held };
  },
  /** Run one import step narrowed to `only`, with the observer and the notices cleared first. */
  step: async ({ fn, only }) => {
    const H = globalThis.__bl;
    H.notes.splice(0);
    H.created.splice(0);
    globalThis.__blStep = { done: false };
    acksExtras.importer[fn]({ only: new Set(only) })
      .then((r) => {
        const out = Array.isArray(r) ? { docs: r.map((d) => d?.uuid ?? null) } : r && typeof r === "object" ? r : { value: r ?? null };
        globalThis.__blStep = { done: true, result: out };
      })
      .catch((e) => { globalThis.__blStep = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  stepState: async () => ({ ...globalThis.__blStep, notes: globalThis.__bl.notes.slice(), created: globalThis.__bl.created.slice() }),
  /**
   * Close every book on this seat and reopen `keep` from the shelf. The forget
   * is this browser's (remembered locations, bridged bytes, in-memory prose);
   * the shelf is world data and is not touched. The reopen remembers nothing.
   */
  closeAllBut: async ({ keep }) => {
    const api = acksExtras.importer;
    const journal = game.journal.find((j) => j.getFlag("acks-extras", "shelf")?.book === keep);
    const src = journal?.pages.find((p) => p.type === "pdf")?.src ?? null;
    await api.forgetBooks();
    if (src) await api.connectBookUrl(keep, src, { remember: false, bridge: false });
    return { forgot: true, keep, reopened: !!src && api.bookOpen(keep) };
  },
  restore: async () => {
    const H = globalThis.__bl;
    if (!H) return { notes: "never installed" };
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    if (H.hook) { Hooks.off("createItem", H.hook); H.hook = null; }
    return { notes: "restored", observer: "off" };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportAbilities`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function poll(api, fn, args, { tries = 150, every = 2000, until = (s) => s?.done } = {}) {
  let state = null;
  for (let n = 0; n < tries; n++) {
    state = await run(api, fn, args);
    if (until(state)) return state;
    await sleep(every);
  }
  return state;
}
let gm = null;
async function runStep(label, fn, only) {
  await run(gm, P.step, { fn, only });
  const st = await poll(gm, P.stepState);
  if (!st?.done) throw new Error(`${label}: the step did not finish`);
  if (st.error) throw new Error(`${label}: the step threw: ${st.error}`);
  note(label, { result: st.result, notes: st.notes.map((n) => n.text), created: st.created.length });
  return st;
}

try {
  section("1. the seat, and a book it does not hold open");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  note("install (gm)", installed);
  check("the GM seat is seated and the module is live", installed.isGM && !!installed.module, installed.module);

  const BY = entriesByImporter();
  const books = [...new Set(Object.values(BY).flat().map(([, b]) => b))].sort();
  const allIds = [...new Set(Object.values(BY).flat().map(([id]) => id))];
  // The seat's open set settles as the shelf's books reopen after ready; a book
  // still opening would read as closed and the step would not pass it over.
  await sleep(15000);
  let census = await run(gm, P.census, { books, ids: allIds });
  let closedBooks = books.filter((b) => !census.open.includes(b));
  note("content books", { all: books, open: census.open, closed: closedBooks });
  if (!closedBooks.length) {
    // The shelf opened every content book here. Close them on this seat alone
    // and keep one open — the one with an unheld ability, so the control runs.
    const keep = BY.abilities.find(([id, b]) => census.open.includes(b) && !census.held[id])?.[1] ?? books[0];
    note("closed on this seat, shelf untouched", await run(gm, P.closeAllBut, { keep }));
    census = await run(gm, P.census, { books, ids: allIds });
    closedBooks = books.filter((b) => !census.open.includes(b));
    note("content books after", { open: census.open, closed: closedBooks });
  }
  check("at least one content book is not open on this seat", closedBooks.length > 0, closedBooks);

  // Up to four unheld entries of a closed book per importer.
  const picks = {};
  for (const imp of IMPORTERS) {
    picks[imp.key] = BY[imp.key].filter(([id, b]) => closedBooks.includes(b) && !census.held[id]).slice(0, 4).map(([id]) => id);
  }
  note("picks per importer (closed book, not held)", picks);
  const reachable = IMPORTERS.filter((imp) => picks[imp.key].length);
  // A library that holds every entry of every closed book leaves the create
  // path nothing to pass over; a library document is nobody's fixture and is
  // never deleted to make one, so steps 2–3 are then the offline suite's.
  if (reachable.length) check("at least one importer has a closed-book entry the world does not hold", true, reachable.map((i) => i.key));
  else gap("steps 2–3: the library holds every entry of every closed book; the create path is pinned offline (tools/importer/test-bookless-import.mjs)", { closedBooks, entries: Object.fromEntries(Object.entries(BY).map(([k, v]) => [k, v.filter(([, b]) => closedBooks.includes(b)).length])) });

  section("2. each importer passes the closed book's entries over");
  for (const imp of reachable) {
    const only = picks[imp.key];
    const st = await runStep(`${imp.key} (closed)`, imp.fn, only);
    const made = imp.made(st.result);
    check(`${imp.key}: the step imported nothing`, made === 0, { made });
    if (imp.closed) check(`${imp.key}: the step counts them as passed over for a closed book`, imp.closed(st.result) === only.length, { closed: imp.closed(st.result), asked: only.length });
    const notice = st.notes.find((n) => CLOSED_NOTICE.test(n.text));
    check(`${imp.key}: a notice says how many were passed over with their book not open`, !!notice && notice.text.includes(`${only.length} passed over`), notice?.text ?? null);
    const stray = st.created.filter((c) => only.includes(c.id));
    check(`${imp.key}: the observer saw no document created under those ids`, stray.length === 0, stray);
  }

  section("3. the world still holds nothing under them");
  if (reachable.length) {
    const after = await run(gm, P.census, { books, ids: reachable.flatMap((imp) => picks[imp.key]) });
    check("no picked id is held after the steps", Object.values(after.held).every((v) => v === null), Object.entries(after.held).filter(([, v]) => v).map(([id]) => id));
  } else {
    note("step 3", "nothing was picked, so there is nothing to ask after");
  }

  section("4. control: an open book's entry imports as before");
  const control = BY.abilities.find(([id, b]) => census.open.includes(b) && !census.held[id])?.[0] ?? null;
  if (!control) {
    note("control", "every open book's ability is already held; the open path is pinned offline (tools/importer/test-bookless-import.mjs)");
  } else {
    const st = await runStep("abilities (open)", "cookbookImportAbilities", [control]);
    const held = (await run(gm, P.census, { books: [], ids: [control] })).held[control];
    if (held) await gm.track(held, "Item");
    check("an open book's ability the world lacked is imported", (st.result.made ?? 0) === 1 && !!held, { made: st.result.made, held: !!held });
    check("and nothing is counted as passed over", (st.result.closed ?? 0) === 0 && !st.notes.some((n) => CLOSED_NOTICE.test(n.text)));
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const label of gaps) console.log(`GAP   ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed${gaps.length ? `, ${gaps.length} gap(s)` : ""}`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
