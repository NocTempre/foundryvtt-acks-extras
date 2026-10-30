/**
 * Live walk, importer-class-rows: a class whose page states its progression in
 * sentences imports with rows, and a held one is repaired in place. Walks
 * docs/importer/TESTING.md, "A community book's classes, read from their
 * sentences", steps 1–4 on the book `cat`. Machine values arrive through
 * ./_env.mjs; the book must be open on the GM seat (the shelf opens it on join).
 *
 * Fixtures: none kept. Step 1 imports the book's classes where the world lacks
 * them and tracks what it made; a class the world already holds under another
 * hand is read, never driven. Step 3 writes the run's OWN classes into the
 * stub shape a world imported before this change holds — no rows, no ladder,
 * no cleave — and repairs them through the class step's tally. Step 4 types an
 * experience figure and a title into one level, as a Judge copying the page
 * would, and repairs through the book repair's own gesture, its confirm
 * answered yes by the walk. Teardown sweeps the ledger and empties a shelf
 * this run opened. Every id printed is a cookbook id; the typed figure and
 * title are the walk's own, and no book word or number leaves the page.
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
/** What the walk types into one level; the walk's own, not the page's. */
const TYPED = { xp: 4321, title: "Walk Typed" };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The book's class ids, read off the shipped cookbook. */
function classIds() {
  const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "classes.json"), "utf8"));
  return Object.entries(cb.entries ?? {}).filter(([, e]) => e.kind === "kind.class" && e.book === BOOK).map(([id]) => id);
}

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__cr = globalThis.__cr ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.RF = await import("/modules/acks-extras/scripts/importer/refresh.mjs");
    H.REG = await import("/modules/acks-extras/scripts/classes/registry.mjs");
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
    const H = globalThis.__cr;
    const out = {};
    for (const id of ids) out[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    return out;
  },
  importClasses: async ({ only }) => {
    globalThis.__cr.notes.splice(0);
    const made = await acksExtras.importer.importClasses({ only: new Set(only) });
    return { made: (made ?? []).map((d) => d.uuid), notes: globalThis.__cr.notes.map((n) => n.text) };
  },
  /** What the class sheet and an apply read: rows, ladder, cleave, chassis, gains, and the throws the chassis lends. */
  shape: async ({ uuid }) => {
    const H = globalThis.__cr;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system;
    const fighter = H.REG.classByKey("fighter");
    const save1 = H.REG.saveBandAt(doc, 1);
    const attack1 = H.REG.attackBandAt(doc, 1);
    return {
      maximumLevel: s.maximumLevel,
      levels: s.levels.length,
      everyHd: s.levels.every((r) => /^\d+d\d+(\+\d+)?$/.test(r.hd)),
      pastCap: s.levels.filter((r) => /\+/.test(r.hd)).length,
      unreadXp: s.levels.filter((r) => r.level > 1 && r.xp == null).length,
      level2: s.levels.find((r) => r.level === 2) ?? null,
      ladder: (s.ladders ?? []).filter((l) => /damagebonus$/i.test(l.key)).map((l) => ({ key: l.key, rungs: l.values.length, rising: l.values.every((r, i, a) => i === 0 || r.value > a[i - 1].value) })),
      cleaves: s.cleaves,
      chassis: [s.saveChassis, s.attackChassis],
      gains: (s.awards ?? []).filter((a) => a.kind === "choice").length,
      stub: s.isStub,
      fighterHeld: !!fighter,
      lent: fighter ? { save: JSON.stringify(save1) === JSON.stringify(H.REG.saveBandAt(fighter, 1)), attack: attack1?.throw != null && attack1.throw === H.REG.attackBandAt(fighter, 1)?.throw } : null,
    };
  },
  /** Render the class sheet and read which notices it shows. */
  sheet: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    await doc.sheet.render({ force: true });
    for (let n = 0; n < 50 && !doc.sheet.rendered; n++) await new Promise((r) => setTimeout(r, 100));
    const text = doc.sheet.element?.textContent ?? "";
    const stub = game.i18n.localize("ACKS-CLASSES.sheet.stubNotice");
    const unread = game.i18n.format("ACKS-CLASSES.sheet.xpUnread", { cite: doc.system.source?.cite ?? "" });
    const out = { rendered: !!doc.sheet.rendered, stubShown: text.includes(stub), unreadShown: text.includes(unread) };
    await doc.sheet.close();
    return out;
  },
  /** The stub shape a class imported before this change holds. */
  stub: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ "system.levels": [], "system.ladders": [], "system.cleaves": {} });
    return doc.system.isStub;
  },
  /** Type an experience figure and a title into level 2, as a Judge copying the page would. */
  type: async ({ uuid, xp, title }) => {
    const doc = await fromUuid(uuid);
    const levels = doc.system.toObject().levels.map((r) => (r.level === 2 ? { ...r, xp, title } : r));
    await doc.update({ "system.levels": levels });
    return doc.system.levels.find((r) => r.level === 2);
  },
  repairByTally: async ({ only }) => {
    const H = globalThis.__cr;
    H.notes.splice(0);
    const tally = H.RF.repairTally();
    const n = await acksExtras.importer.cookbookUpdateClasses({ only: new Set(only), confirm: false, repair: tally });
    return { rewritten: n, tally: H.RF.repairCounts(tally) };
  },
  /** The book repair's own gesture, its confirm answered yes for the walk and the dialog restored after. */
  repairBook: async () => {
    const H = globalThis.__cr;
    H.notes.splice(0);
    const D = foundry.applications.api.DialogV2;
    const orig = D.confirm;
    let asked = 0;
    D.confirm = async () => { asked++; return true; };
    try {
      const r = await acksExtras.importer.cookbookReimportBook("cat", { mode: "repair" });
      return { result: r, asked };
    } finally {
      D.confirm = orig;
    }
  },
  restore: async () => {
    const H = globalThis.__cr;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.importClasses`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** The shape the class step gives a class read from its sentences. */
const rowsShape = (s) =>
  !!s && !s.stub && s.levels === s.maximumLevel && s.everyHd && s.pastCap === Math.max(0, s.maximumLevel - 9) &&
  s.ladder.length === 1 && s.ladder[0].rungs >= 2 && s.ladder[0].rising &&
  s.cleaves?.kind === "perLevel" && s.chassis.join() === "fighter,fighter" && s.gains >= 5;

let gm = null;
const openedPacks = [];
try {
  section("1. the seat, the book, and the classes this run makes");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  let installed = await run(gm, P.install);
  for (let n = 0; n < 20 && !installed.open; n++) { await sleep(3000); installed = await run(gm, P.install); }
  note("install (gm)", installed);
  check("the GM seat is seated, the module is live and the book is open", installed.isGM && !!installed.module && installed.open, installed.module);

  const IDS = classIds();
  const packsBefore = await run(gm, P.packs);
  const heldBefore = await run(gm, P.held, { ids: IDS });
  const theirs = Object.values(heldBefore).filter(Boolean);
  note("held before this run", { held: theirs.length, of: IDS.length });
  const absent = IDS.filter((id) => !heldBefore[id]);
  const imported = await run(gm, P.importClasses, { only: absent });
  for (const u of imported.made) gm.track(u, "Item");
  for (const c of (await run(gm, P.packs)).filter((c) => !packsBefore.includes(c))) openedPacks.push(c);
  note("class step", { made: imported.made.length, notes: imported.notes });
  note("shelves opened by this run", openedPacks);
  check("1: the step imported every class the world lacked", imported.made.length === absent.length, { made: imported.made.length, absent: absent.length });
  const heldAfter = await run(gm, P.held, { ids: IDS });
  const mine = imported.made;
  // Step 2 only reads and renders, so it reads every class the world holds;
  // a class under another hand is never written, so steps 3–4 drive this
  // run's own and stop where it has none.
  const all = Object.values(heldAfter).filter(Boolean);

  section("2. the rows, the ladder, the cleave and the throws on each class");
  const fresh = {};
  for (const u of all) fresh[u] = await run(gm, P.shape, { uuid: u });
  for (const [id, u] of Object.entries(heldAfter)) note(id, { uuid: u, ...fresh[u] });
  check("2: each class has a row per level with its hit dice, a rising damage ladder, a cleave per level, the fighter chassis and its gains", all.length === IDS.length && all.every((u) => rowsShape(fresh[u])), all.map((u) => fresh[u]));
  check("2: experience is unread on every level past the first, or a hand typed it", all.every((u) => fresh[u].unreadXp <= fresh[u].levels - 1));
  const lent = all.map((u) => fresh[u].lent);
  if (fresh[all[0]].fighterHeld) check("2: the throws at 1st level are the fighter's, lent through the chassis", lent.every((l) => l.save && l.attack), lent);
  else note("2: not reached", "the world holds no fighter class, so the chassis lends nothing — import the core classes first");
  const sheet = await run(gm, P.sheet, { uuid: all[0] });
  note("sheet", sheet);
  check("2: the class sheet renders with no stub notice, and with the unread-experience notice where a level is unread", sheet.rendered && !sheet.stubShown && sheet.unreadShown === fresh[all[0]].unreadXp > 0, sheet);
  if (!mine.length) note("3–4: not reached", "the world holds every class under another hand, and a document with no marker is read, never driven (live-testing.md step 4)");
  else await drive(mine, heldAfter, fresh);
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

/** Steps 3–4, on the run's own classes only. */
async function drive(mine, heldAfter, fresh) {

  section("3. a held stub repaired in place through the class step's tally");
  const myIds = Object.entries(heldAfter).filter(([, u]) => mine.includes(u)).map(([id]) => id);
  const stubbed = [];
  for (const u of mine) stubbed.push(await run(gm, P.stub, { uuid: u }));
  check("3: the run's own classes read as stubs", stubbed.every(Boolean), stubbed);
  const repaired = await run(gm, P.repairByTally, { only: myIds });
  note("repair by tally", repaired);
  check("3: the class step rewrote each and the tally replaced each", repaired.rewritten === myIds.length && repaired.tally.replaced === myIds.length && repaired.tally.refused === 0, repaired);
  const back = {};
  for (const u of mine) back[u] = await run(gm, P.shape, { uuid: u });
  check("3: each class is back in the shape the fresh import gave it, under the same uuid", mine.every((u) => rowsShape(back[u]) && back[u].levels === fresh[u].levels && JSON.stringify(back[u].ladder) === JSON.stringify(fresh[u].ladder)), mine.map((u) => back[u]));

  section("4. a typed level kept through the book repair");
  const typed = await run(gm, P.type, { uuid: mine[0], ...TYPED });
  check("4: level 2 holds the typed figure and title", typed?.xp === TYPED.xp && typed?.title === TYPED.title, typed);
  for (const u of mine.slice(1)) await run(gm, P.stub, { uuid: u });
  const byBook = await run(gm, P.repairBook);
  note("repair book", { asked: byBook.asked, result: byBook.result && { mode: byBook.result.mode, replaced: byBook.result.replaced, refused: byBook.result.refused, runs: Object.keys(byBook.result.refill ?? {}) } });
  check("4: the book repair asked once, ran the class step and replaced at least this run's classes", byBook.asked === 1 && byBook.result?.mode === "repair" && "importClasses" in (byBook.result.refill ?? {}) && byBook.result.replaced >= mine.length, byBook.result && { replaced: byBook.result.replaced, refill: Object.keys(byBook.result.refill ?? {}) });
  const after = {};
  for (const u of mine) after[u] = await run(gm, P.shape, { uuid: u });
  check("4: the typed figure and title survived, and the row's hit dice are the build's", after[mine[0]].level2?.xp === TYPED.xp && after[mine[0]].level2?.title === TYPED.title && after[mine[0]].level2?.hd === fresh[mine[0]].level2?.hd, after[mine[0]].level2);
  check("4: the other classes, stubbed again, are back in the fresh shape", mine.slice(1).every((u) => rowsShape(after[u])), mine.slice(1).map((u) => after[u]));
}
