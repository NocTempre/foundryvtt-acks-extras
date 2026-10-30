/**
 * Live walk, importer-item-repair: an item a book introduces is repaired in
 * place. Walks docs/importer/TESTING.md, "A book's items repaired in place",
 * steps 1–4 on the book `cat`. Machine values arrive through ./_env.mjs; the
 * book must be open on the GM seat (the shelf opens it on join).
 *
 * Fixtures: none kept. Step 1 imports the book's items where the world lacks
 * them and tracks what it made (the typography walk sweeps its own, so the
 * library holds none between runs); where the world already holds them under
 * another session's hand, the walk reads them and strips nothing. Step 2
 * writes the run's OWN items into the shape the step gave them before it read
 * their paragraph — no slot, no mark, cost 0 — which is what a world imported
 * before 11.12.0 holds. Step 3 repairs through the items step's tally and
 * step 4 through the book repair's own gesture, its confirm answered yes by
 * the walk. Teardown sweeps the ledger and empties a shelf this run opened.
 * Every id printed is a cookbook id; no book word leaves the page.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, ROOT } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm };
const BOOK = "cat";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The book's item ids, read off the shipped cookbook. */
function itemIds() {
  const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", `${BOOK}.json`), "utf8"));
  return Object.entries(cb.entries ?? {}).filter(([, e]) => e.kind === "kind.adventureItem").map(([id]) => id);
}

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ir = globalThis.__ir ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.RF = await import("/modules/acks-extras/scripts/importer/refresh.mjs");
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
    return { installed: true, module: game.modules.get("acks-extras")?.version ?? null, isGM: game.user.isGM, open: !!H.CB.cookbookSessionDoc("cat") };
  },
  packs: async () => game.packs.filter((p) => p.metadata.packageType === "world").map((p) => p.collection),
  held: async ({ ids }) => {
    const H = globalThis.__ir;
    const out = {};
    for (const id of ids) out[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    return out;
  },
  importItems: async () => {
    globalThis.__ir.notes.splice(0);
    const r = await acksExtras.importer.cookbookImportAdventureItems({ books: ["cat"] });
    return { result: r, notes: globalThis.__ir.notes.map((n) => n.text) };
  },
  /** The shape a sheet reads: slot, mark, cost, quantity, the description's length and whether a Judge wrote in it. */
  shape: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const x = doc.flags?.["acks-extras"] ?? {};
    const html = String(doc.system?.description ?? "");
    return {
      slots: Array.isArray(x.gear?.slots) ? x.gear.slots : null, magic: !!x.markets?.magic, cost: doc.system?.cost ?? null,
      quantity: doc.system?.quantity?.value ?? null, textLength: html.length, judged: globalThis.__ir.RF.handWrittenProse(html),
    };
  },
  /** Write the run's own item into the pre-binding shape, and give it a quantity a Judge might have set. */
  strip: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    await doc.update({ "flags.acks-extras.-=gear": null, "flags.acks-extras.-=markets": null, "system.cost": 0, "system.quantity.value": 3 });
    return true;
  },
  repairByTally: async ({ only }) => {
    const H = globalThis.__ir;
    H.notes.splice(0);
    const tally = H.RF.repairTally();
    const r = await acksExtras.importer.cookbookImportAdventureItems({ books: ["cat"], only: new Set(only), repair: tally });
    return { result: r, tally: H.RF.repairCounts(tally), notes: H.notes.map((n) => n.text) };
  },
  /** The book repair's own gesture, its confirm answered yes for the walk and the dialog restored after. */
  repairBook: async () => {
    const H = globalThis.__ir;
    H.notes.splice(0);
    const D = foundry.applications.api.DialogV2;
    const orig = D.confirm;
    let asked = 0;
    D.confirm = async () => { asked++; return true; };
    try {
      const r = await acksExtras.importer.cookbookReimportBook("cat", { mode: "repair" });
      return { result: r, asked, notes: H.notes.map((n) => n.text) };
    } finally {
      D.confirm = orig;
    }
  },
  restore: async () => {
    const H = globalThis.__ir;
    if (!H) return { notes: "never installed" };
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    return { notes: "restored" };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportAdventureItems`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
const wornShape = (s) => !!s && Array.isArray(s.slots) && s.slots.length === 1 && s.magic && s.cost > 0;
const doseShape = (s) => !!s && !s.slots?.length && !s.magic && s.cost > 0;
const strippedShape = (s) => !!s && !s.slots?.length && !s.magic && s.cost === 0;

let gm = null;
const openedPacks = [];
try {
  section("1. the seat, the book, and the items this run makes");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  // The shelf's books open after ready; the install reads the book as open only once it has.
  let installed = await run(gm, P.install);
  for (let n = 0; n < 20 && !installed.open; n++) { await sleep(3000); installed = await run(gm, P.install); }
  note("install (gm)", installed);
  check("the GM seat is seated, the module is live and the book is open", installed.isGM && !!installed.module && installed.open, installed.module);

  const IDS = itemIds();
  const packsBefore = await run(gm, P.packs);
  const heldBefore = await run(gm, P.held, { ids: IDS });
  const theirs = Object.values(heldBefore).filter(Boolean);
  note("held before this run", { held: theirs.length, of: IDS.length });
  const imported = await run(gm, P.importItems);
  note("items step", imported);
  const heldAfter = await run(gm, P.held, { ids: IDS });
  const mine = Object.entries(heldAfter).filter(([, u]) => u && !theirs.includes(u)).map(([, u]) => u);
  for (const u of mine) gm.track(u, "Item");
  for (const c of (await run(gm, P.packs)).filter((c) => !packsBefore.includes(c))) openedPacks.push(c);
  note("tracked (this run's items)", mine.length);
  note("shelves opened by this run", openedPacks);
  check("1: the step imported what the world lacked and the rest read as already present", imported.result.made === IDS.length - theirs.length && imported.result.already === theirs.length && imported.result.refused === 0, imported.result);
  if (!mine.length) throw new Error("the world already holds every item under another hand; nothing of this run's to strip — read, never drive (live-testing.md step 4)");
  const fresh = {};
  for (const u of mine) fresh[u] = await run(gm, P.shape, { uuid: u });
  const freshShapes = Object.values(fresh);
  check("1: each fresh item is worn or a dose, priced, with the binder's text and no Judge's", freshShapes.every((s) => (wornShape(s) || doseShape(s)) && s.textLength > 0 && !s.judged), freshShapes.map((s) => ({ slots: s.slots, magic: s.magic, cost: s.cost, textLength: s.textLength })));

  section("2. the run's own items written into the pre-binding shape");
  for (const u of mine) await run(gm, P.strip, { uuid: u });
  const stripped = {};
  for (const u of mine) stripped[u] = await run(gm, P.shape, { uuid: u });
  check("2: every one of them now has no slot, no mark and cost 0, and a quantity of 3", Object.values(stripped).every((s) => strippedShape(s) && s.quantity === 3), Object.values(stripped).map((s) => ({ slots: s.slots, magic: s.magic, cost: s.cost, quantity: s.quantity })));
  const plain = await run(gm, P.importItems);
  check("2: a plain items step passes them all as already present and rewrites none", plain.result.made === 0 && plain.result.already === IDS.length && plain.result.refused === 0, plain.result);
  const still = await run(gm, P.shape, { uuid: mine[0] });
  check("2: the first is still stripped after the plain step", strippedShape(still), still);

  section("3. repaired in place through the step's tally");
  const myIds = Object.entries(heldAfter).filter(([, u]) => mine.includes(u)).map(([id]) => id);
  const repaired = await run(gm, P.repairByTally, { only: myIds });
  note("repair by tally", repaired);
  check("3: the step counts them already present and repaired in place, and the tally replaced each", repaired.result.already === myIds.length && repaired.result.made === 0 && repaired.tally.replaced === myIds.length && repaired.tally.refused === 0, { result: repaired.result, tally: repaired.tally });
  check("3: the notice says repaired in place", repaired.notes.some((t) => /repaired in place/.test(t)), repaired.notes);
  const after = {};
  for (const u of mine) after[u] = await run(gm, P.shape, { uuid: u });
  check("3: each item has its slot or none, its mark and its price back, exactly as the fresh import gave them", mine.every((u) => JSON.stringify({ s: after[u].slots, m: after[u].magic, c: after[u].cost }) === JSON.stringify({ s: fresh[u].slots, m: fresh[u].magic, c: fresh[u].cost })), mine.map((u) => ({ after: after[u], fresh: fresh[u] })));
  check("3: the quantity a Judge set is kept and the description is the binder's text, the same length as the fresh import's", mine.every((u) => after[u].quantity === 3 && after[u].textLength === fresh[u].textLength && !after[u].judged), mine.map((u) => ({ quantity: after[u].quantity, textLength: after[u].textLength, fresh: fresh[u].textLength })));

  section("4. repaired through the book repair's own gesture");
  for (const u of mine) await run(gm, P.strip, { uuid: u });
  const byBook = await run(gm, P.repairBook);
  note("repair book", { asked: byBook.asked, result: byBook.result && { mode: byBook.result.mode, replaced: byBook.result.replaced, refused: byBook.result.refused, runs: Object.keys(byBook.result.refill ?? {}) } });
  check("4: the book repair asked once, ran the items step and replaced at least this run's items", byBook.asked === 1 && byBook.result?.mode === "repair" && !!byBook.result.refill?.cookbookImportAdventureItems && byBook.result.replaced >= mine.length, byBook.result && { replaced: byBook.result.replaced, refill: Object.keys(byBook.result.refill ?? {}) });
  const again = {};
  for (const u of mine) again[u] = await run(gm, P.shape, { uuid: u });
  check("4: each item is back in the shape the fresh import gave it", mine.every((u) => JSON.stringify({ s: again[u].slots, m: again[u].magic, c: again[u].cost }) === JSON.stringify({ s: fresh[u].slots, m: fresh[u].magic, c: fresh[u].cost })), mine.map((u) => again[u]));
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
  for (const collection of openedPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
