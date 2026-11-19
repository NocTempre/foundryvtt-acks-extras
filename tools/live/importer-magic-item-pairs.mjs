/**
 * Live walk, importer-magic-item-pairs: the Judges Journal's magic items and the
 * Treasure Tome's, imported as one document where the Journal's row names the
 * Tome's (`meta.revisedBy`). Walks docs/importer/TESTING.md "Magic item
 * entries", "The Journal's entries and the pair walk", steps 7 to 13, on the GM
 * seat, with both books connected: the Journal alone (7), the Journal then the
 * Tome, a held edit through the takeover (8, 9), the Tome then the Journal (10),
 * either order ending in one document (11), the delete path both ways (12) and
 * a second import that adds nothing (13). One extra step walks the Journal's
 * import with the Tome open and no document standing (the `defer` step of
 * `pairStep`), which TESTING does not number. The step labels below carry
 * TESTING's numbers; the extra one is "14".
 *
 * The pairs are four, named by id in `PAIRS`: three Journal rows of different
 * categories (potions, swords, armour, so two core types) and one reprint, a
 * row whose cookbook name is the placeholder `Item <n>` (read from the page in
 * both books). Each partner is read from the served `cookbook/jj.json`, never
 * assumed, and the walk is blocked where a row no longer names its partner.
 * Every import passes `only`, the eight ids of the four pairs: a bare import
 * with both books open would bind every Journal row onto the world's Tome items.
 *
 * Fixtures. Setup is the subject, so each pair's standing document is deleted
 * first: found by the cookbook id it answers for (the Journal's or the Tome's,
 * a merged one included), stamped `importer/magic-pair-<n>` (<n> the Journal
 * row's number; `api.mark` refuses a compendium uuid, so the walk writes
 * `flags.world.fixture` itself and tracks the uuid, as importer-magic-items
 * does) and swept by the run's ledger. A document an import makes is stamped and
 * tracked the moment the job resolves. The teardown reopens the Tome, sweeps
 * what is still tracked and imports the Tome's four rows again by `only`
 * (with the Journal's four where the pair stood merged before), so each pair
 * ends as the walk found it: one Tome document, the Journal's id merged
 * only where it was. A world holding a pair in any other shape (two documents,
 * or the Journal's document alone) is blocked rather than reshaped.
 *
 * Step 7 and 12 close the Tome the way importer-magic-items does (its session
 * entry leaves the importer's open-books map, `ctx.sessionDocs`) and put the same
 * entry back, reconnecting by path if it was lost. The walk waits for the join's
 * shelf restore to settle first, since that pass reopens a closed book.
 *
 * Not walked: the whole-book notices (every Journal row, every Tome row) and the
 * unpaired Journal item of steps 8 and 10: all 158 Journal rows carry a
 * `revisedBy`, so an unpaired one has no subject, and the counts here are the
 * four pairs' own.
 *
 * Every line printed is a boolean, a count or an id (`jj.item<n>`, `tt.item<n>`):
 * no book word, item name or figure leaves the page, and a hand-written text
 * is the walk's own invented line. Machine values arrive through ./_env.mjs.
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

/**
 * The pairs the walk drives, by id. `edit` takes the held edit of steps 8 and
 * 9, `drop` the delete path of step 12, `defer` the extra step; `reprint` is the
 * row whose name is read from the page in both books.
 */
const PAIRS = [
  { jj: "jj.item1", cat: "potions", edit: true },
  { jj: "jj.item132", cat: "swords", drop: true },
  { jj: "jj.item156", cat: "armors", defer: true },
  { jj: "jj.item113", cat: "misc", reprint: true },
];
const EDIT = PAIRS.find((p) => p.edit);
const DROP = PAIRS.find((p) => p.drop);
const DEFER = PAIRS.find((p) => p.defer);
/** What the held edit writes: a line of the walk's own, with nothing from a book. */
const HAND_NAME = "Walk hand-edited name";
const HAND_TEXT = "Walk hand-written line, not from a book.";

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mp = globalThis.__mp ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.SS = await import("/modules/acks-extras/scripts/importer/cookbook/state.mjs");
    H.IC = await import("/modules/acks-extras/scripts/importer/constants.mjs");
    let hasPair = false;
    try { hasPair = typeof (await import("/modules/acks-extras/scripts/importer/magic-item-pair.mjs")).pairStep === "function"; } catch { hasPair = false; }
    // Every open of a book on this seat during the walk: names what reopens a book the walk closed.
    H.opens = H.opens ?? [];
    if (!H.openHook) H.openHook = Hooks.on("acksExtras.bookOpened", (id) => H.opens.push({ id, t: Date.now() }));
    /** A number standing for a text, so two reads compare without the text being printed. */
    H.digest = (v) => {
      const text = String(v ?? "");
      let h = 5381;
      for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
      return h;
    };
    /** Every document the library holds that answers for one of `ids` (as its own id or a merged one), by uuid. */
    H.holders = async (ids) => {
      const want = new Set(ids);
      const fields = ["flags.acks-extras.cookbook.id", "flags.acks-extras.cookbook.merged"];
      const hit = new Set();
      const take = (uuid, flag) => { if ([flag?.id, ...(flag?.merged ?? [])].some((c) => want.has(c))) hit.add(uuid); };
      const packs = game.packs.filter((p) => p.metadata.packageType === "world" && p.documentName === "Item" && String(p.metadata.label ?? "").startsWith(`${H.SS.FOLDER_NAME} — `));
      for (const p of packs) {
        const index = await p.getIndex({ fields });
        for (const r of index) take(`Compendium.${p.collection}.Item.${r._id}`, r.flags?.["acks-extras"]?.cookbook);
      }
      for (const d of game.items) take(d.uuid, d.getFlag("acks-extras", "cookbook"));
      const live = [];
      for (const uuid of hit) { const d = await fromUuid(uuid); if (d) live.push(d); }
      return live;
    };
    /** One document as booleans, ids and digests: nothing a book printed leaves the page. */
    H.facts = (doc) => {
      const cb = doc.getFlag("acks-extras", "cookbook") ?? {};
      const mk = doc.getFlag("acks-extras", "markets") ?? {};
      const desc = String(doc.system?.description ?? "");
      const folder = doc.folder ?? null;
      const labelOf = (name) => Object.keys(acksExtras.importer.BOOKS ?? {}).find((b) => acksExtras.importer.BOOKS[b].label === name) ?? null;
      return {
        uuid: doc.uuid, pack: doc.pack ?? null, type: doc.type,
        id: cb.id ?? null, book: cb.book ?? null, merged: [...(cb.merged ?? [])],
        name: H.digest(doc.name), named: String(doc.name ?? "").trim().length > 0,
        stamps: [...new Set([...desc.matchAll(/data-acks-entry="([^"]+)"/g)].map((m) => m[1]))],
        desc: H.digest(desc), descText: H.digest(desc.replace(/<[^>]*>/g, "").trim()),
        folderId: doc._source?.folder ?? null,
        folder: folder ? { category: folder.name, parentBook: labelOf(folder.folder?.name), inPack: doc.pack ? !!doc.compendium?.folders?.get(doc._source.folder) : true } : null,
        base: typeof mk.baseCostGp === "number" ? mk.baseCostGp : null,
        apparent: typeof mk.apparentValueGp === "number" ? mk.apparentValueGp : null,
        magic: mk.magic === true,
        modified: doc._stats?.modifiedTime ?? null,
        fixture: doc.flags?.world?.fixture ?? null,
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM, role: game.user.role, hasImport: typeof acksExtras.importer?.cookbookImportMagicItems === "function", hasPair, hasHolders: !!H.SS.FOLDER_NAME };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__mp;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__mpBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__mpBook = { done: true, ok: true }; })
      .catch(() => { globalThis.__mpBook = { done: true, ok: false, error: "threw" }; });
    return { started: true };
  },
  /** Whether the join's shelf restore has settled for the walk's books (a shelved, readable book is open). */
  shelfState: async ({ ids = [] } = {}) => {
    const pending = [];
    for (const j of game.journal) {
      const book = j.getFlag("acks-extras", "shelf")?.book;
      if (!book || pending.includes(book)) continue;
      const page = j.pages.find((p) => p.type === "pdf" && p.src);
      if (page?.testUserPermission(game.user, "OBSERVER") && !acksExtras.importer.bookOpen(book)) pending.push(book);
    }
    return { pending, done: !pending.some((b) => ids.includes(b)) };
  },
  bookState: async ({ id }) => {
    const open = !!globalThis.__mp.CB.cookbookSessionDoc(id);
    return { ...(globalThis.__mpBook ?? {}), open, done: !!(globalThis.__mpBook?.done || open) };
  },
  bookOpen: async () => ({ jj: !!acksExtras.importer.bookOpen("jj"), tt: !!acksExtras.importer.bookOpen("tt") }),
  /** Each pair's two rows in the served cookbooks, and the counts J and P, as booleans and counts. */
  cookbooks: async ({ pairs }) => {
    const H = globalThis.__mp;
    const read = async (id) => {
      const res = await fetch(`/modules/acks-extras/cookbook/${id}.json`);
      return res.ok ? (await res.json()).entries ?? {} : null;
    };
    const jj = await read("jj");
    const tt = await read("tt");
    if (!jj || !tt) return { ok: false };
    H.ttRows = Object.entries(tt).filter(([, e]) => e?.kind === "kind.magicItem").map(([id, e]) => [id, e.meta?.category ?? null]);
    const jjRows = Object.entries(jj).filter(([, e]) => e?.kind === "kind.magicItem");
    return {
      ok: true, J: jjRows.length, P: jjRows.filter(([, e]) => e.meta?.revisedBy).length, T: H.ttRows.length,
      pairs: pairs.map((p) => {
        const row = jj[p.jj];
        const partner = row?.meta?.revisedBy ?? null;
        return {
          jj: p.jj, tt: partner, jjRow: row?.kind === "kind.magicItem", ttRow: !!partner && tt[partner]?.kind === "kind.magicItem",
          sameCategory: !!partner && row?.meta?.category === p.cat && tt[partner]?.meta?.category === p.cat,
          reprint: /^Item \d+$/.test(String(row?.name ?? "")),
        };
      }),
    };
  },
  /** Per pair: every document answering for either id, as facts, and what each id resolves to through the importer's lookup. */
  readPairs: async ({ pairs }) => {
    const H = globalThis.__mp;
    H.CB.forgetImportedIndex();
    const out = [];
    for (const p of pairs) {
      const docs = await H.holders([p.jj, p.tt]);
      out.push({
        jj: p.jj, tt: p.tt, holders: docs.map(H.facts),
        viaJJ: (await H.CB.importedItemFor(p.jj))?.uuid ?? null, viaTT: (await H.CB.importedItemFor(p.tt))?.uuid ?? null,
      });
    }
    return out;
  },
  /** A standing Tome item of each category outside the walk's ids, as the pack and folder an import files its kind under. */
  refFolders: async ({ cats, exclude }) => {
    const H = globalThis.__mp;
    H.CB.forgetImportedIndex();
    const out = {};
    for (const cat of cats) {
      for (const [id] of H.ttRows.filter(([id, c]) => c === cat && !exclude.includes(id)).slice(0, 60)) {
        const doc = await H.CB.importedItemFor(id);
        if (doc?.getFlag("acks-extras", "cookbook")?.id !== id) continue;
        out[cat] = { id, pack: doc.pack ?? null, folderId: doc._source?.folder ?? null };
        break;
      }
    }
    return out;
  },
  /** The cookbook id each uuid's document carries: what an import made is matched to its pair by this. */
  idsOf: async ({ uuids }) => {
    const out = {};
    for (const uuid of uuids) out[uuid] = (await fromUuid(uuid))?.getFlag("acks-extras", "cookbook")?.id ?? null;
    return out;
  },
  /** The fixture stamp the driver's `mark` cannot write on a compendium document. */
  stamp: async ({ uuid, marker }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return { ok: false };
    await doc.update({ "flags.world.fixture": marker });
    return { ok: (await fromUuid(uuid))?.flags?.world?.fixture === marker };
  },
  /** One import of the given ids, as a job the driver polls; the books open at its start ride along. */
  pairJob: async ({ ids }) => {
    globalThis.__mpJob = { done: false };
    const open = { jj: !!acksExtras.importer.bookOpen("jj"), tt: !!acksExtras.importer.bookOpen("tt") };
    acksExtras.importer.cookbookImportMagicItems({ only: new Set(ids) })
      .then((r) => {
        globalThis.__mpJob = {
          done: true, ok: !!r && typeof r === "object", open, made: r?.made ?? null, already: r?.already ?? null, refused: r?.refused ?? null,
          taken: r?.taken ?? null, createdUuids: r?.created?.items ?? [],
        };
      })
      .catch(() => { globalThis.__mpJob = { done: true, ok: false, open, error: "threw" }; });
    return { started: true };
  },
  jobState: async () => globalThis.__mpJob ?? { done: false },
  /** Steps 9: rename a pair's item, rewrite its description and move one figure by hand. */
  handEdit: async ({ uuid, name, text }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return { ok: false };
    const base = doc.getFlag("acks-extras", "markets")?.baseCostGp;
    const figured = typeof base === "number";
    const update = { name, "system.description": `<p>${text}</p>` };
    if (figured) update["flags.acks-extras.markets.baseCostGp"] = base + 7;
    await doc.update(update);
    const after = await fromUuid(uuid);
    return {
      ok: true, figured, base: figured ? base : null,
      edited: after.name === name && after.system.description === `<p>${text}</p>` && (!figured || after.getFlag("acks-extras", "markets")?.baseCostGp === base + 7),
    };
  },
  /** Step 9, after the takeover: whether the hand edit stands. */
  handRead: async ({ uuid, name, text, base }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return { found: false };
    return {
      found: true, name: doc.name === name, description: doc.system.description === `<p>${text}</p>`,
      figure: base === null ? null : doc.getFlag("acks-extras", "markets")?.baseCostGp === base + 7,
    };
  },
  /** Teardown: take the Journal's id back out of `merged` where the pair did not hold it before the walk. */
  unmerge: async ({ tt, jj }) => {
    const H = globalThis.__mp;
    H.CB.forgetImportedIndex();
    const doc = await H.CB.importedItemFor(tt);
    const merged = doc?.getFlag("acks-extras", "cookbook")?.merged ?? [];
    if (!doc || !merged.includes(jj)) return { found: !!doc, changed: false };
    const rest = merged.filter((id) => id !== jj);
    await doc.update(rest.length ? { "flags.acks-extras.cookbook.merged": rest } : { "flags.acks-extras.cookbook.-=merged": null });
    return { found: true, changed: true };
  },

  /** The Tome's session entry out of the importer's open-books map, kept to put back. */
  tomeClose: async () => {
    const H = globalThis.__mp;
    const map = H.SS.ctx?.sessionDocs;
    if (!map?.has("tt")) return { had: false, open: !!acksExtras.importer.bookOpen("tt"), jjOpen: !!acksExtras.importer.bookOpen("jj") };
    H.tomeHeld = map.get("tt");
    map.delete("tt");
    return { had: true, open: !!acksExtras.importer.bookOpen("tt"), jjOpen: !!acksExtras.importer.bookOpen("jj") };
  },
  tomeOpen: async () => {
    const H = globalThis.__mp;
    const map = H.SS.ctx?.sessionDocs;
    const held = !!H.tomeHeld;
    if (map && H.tomeHeld && !map.has("tt")) map.set("tt", H.tomeHeld);
    if (map?.has("tt")) H.tomeHeld = null;
    return { held, open: !!acksExtras.importer.bookOpen("tt") };
  },
  /** How many times the Tome was opened on this seat since the walk installed. */
  tomeOpens: async () => (globalThis.__mp.opens ?? []).filter((o) => o.id === "tt").length,
  /** The category folder's name an import files a category under. */
  categoryName: async ({ cat }) => game.i18n.localize([globalThis.__mp.IC.LANG_PREFIX, "magicItems", "category", cat].join(".")),
  drain: async () => ({ errors: globalThis.__mp.errors.slice() }),
  restore: async () => {
    const H = globalThis.__mp;
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
/** Uuids this run tracked and has not yet swept. */
const own = [];
/** Uuids stamped and tracked now, so a document is stamped once; a swept one leaves, since a re-made document is another. */
const marked = new Set();
/** Whether an import or a sweep ran, so the teardown restores what the run changed. */
let touched = false;
/** The Tome's staged path, kept so a lost session entry can be reconnected. */
let ttPath = null;
/** Whether a step took the Tome off the seat and has not yet put it back. */
let tomeClosed = false;
/** Each pair as the walk found it, once read. */
let pre = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 3_000_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const numOf = (id) => id.replace(/^\D+/, "");
const ids = (side) => PAIRS.map((p) => p[side]);
const pairOf = (id) => PAIRS.find((p) => p.jj === id || p.tt === id);
/** The recipe's marker for a pair's item, `importer/magic-pair-<n>`, tag-suffixed as the driver would. */
const markerOf = (pair) => `importer/magic-pair-${numOf(pair.jj)}${MACHINE.own ? `@${MACHINE.own}` : ""}`;

/** Mark a document and track it; the driver's mark refuses a compendium uuid, so the stamp is written here. */
async function markItem(uuid, pair) {
  if (marked.has(uuid)) return "already";
  const marker = markerOf(pair);
  let how = "marked";
  try {
    await gm.mark(uuid, marker.replace(/@.*$/, ""));
  } catch (err) {
    how = /compendium/i.test(String(err?.message ?? err)) ? "stamped" : "failed";
    if (how === "failed") throw err;
    const s = await run(gm, P.stamp, { uuid, marker });
    if (!s.ok) throw new Error(`the stamp on ${pair.jj} did not land`);
    await gm.track(uuid, "Item", marker);
  }
  if (!own.includes(uuid)) own.push(uuid);
  marked.add(uuid);
  return how;
}

/** Delete a tracked document by the ledger; resolves the sweep's counts. */
async function sweepItem(uuid) {
  touched = true;
  const out = await gm.sweepTracked({ only: [uuid] });
  const at = own.indexOf(uuid);
  if (at >= 0 && out.removed.length === 1) own.splice(at, 1);
  if (out.removed.length === 1) marked.delete(uuid);
  return out;
}

/** Stamp and track every document a job made, the moment it resolves; a crash then leaves nothing unlisted. */
async function markCreated(job) {
  const uuids = job.createdUuids ?? [];
  if (!uuids.length) return;
  const idOf = await run(gm, P.idsOf, { uuids });
  for (const uuid of uuids) {
    const pair = pairOf(idOf[uuid]);
    if (pair) await markItem(uuid, pair);
  }
}

/** One import of `only`, tracked; resolves the job's counts. */
async function importOnly(only, label, { track = true } = {}) {
  touched = true;
  await run(gm, P.pairJob, { ids: only });
  const job = await waitFor(gm, P.jobState, {}, label, 300);
  if (track) await markCreated(job);
  return job;
}

/** Delete every document answering for a pair, by the ledger; resolves how many were removed and how many failed. */
async function retire(pair) {
  const [now] = await run(gm, P.readPairs, { pairs: [{ jj: pair.jj, tt: pair.tt }] });
  let removed = 0;
  let failed = 0;
  for (const h of now.holders) {
    await markItem(h.uuid, pair);
    const out = await sweepItem(h.uuid);
    removed += out.removed.length;
    failed += out.failed.length + out.missing.length;
  }
  return { held: now.holders.length, removed, failed };
}

/** Put the Tome's held session entry back, reconnecting by path where it is gone. */
async function reopenTome() {
  let o = await run(gm, P.tomeOpen);
  if (!o.open && ttPath) {
    await run(gm, P.connectBook, { id: "tt", path: ttPath });
    await waitFor(gm, P.bookState, { id: "tt" }, "reconnect tt", 240);
    o = { ...o, reconnected: true, open: (await run(gm, P.bookState, { id: "tt" })).open };
  }
  if (o.open) tomeClosed = false;
  return o;
}

/** A pair's facts from a `readPairs` row: the document answering for each id. */
const factsOf = (row, id) => row.holders.find((h) => h.id === id) ?? null;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  if (!installed.isGM) blocked("the GM seat joined is not a GM");
  if (!installed.hasImport || !installed.hasPair || !installed.hasHolders) blocked("the served module lacks the item import, the pair step or the library's shelf name: it is not the build that pairs the Journal's items");
  check("the GM seat is a GM and the served module carries the item import and the pair step", true, { role: installed.role });

  section("books");
  const shelfSettled = await waitFor(gm, P.shelfState, { ids: ["jj", "tt"] }, "the join's shelf restore", 300).catch((err) => ({ done: false, error: err.message }));
  note("the join's shelf restore", shelfSettled);
  const staged = books(["jj", "tt"]);
  if (staged.length !== 2) blocked(`ACKS_TEST_BOOKS names ${staged.length} of jj and tt`);
  for (const { id, path } of staged) {
    if (id === "tt") ttPath = path;
    await run(gm, P.connectBook, { id, path });
    const state = await waitFor(gm, P.bookState, { id }, `connect ${id}`);
    check(`${id} is open on the seat`, state.open, { ok: state.ok ?? null, error: state.error ?? null });
  }

  section("the pairs in the served cookbooks");
  const cb = await run(gm, P.cookbooks, { pairs: PAIRS });
  if (!cb.ok) blocked("the served cookbook/jj.json or cookbook/tt.json is missing");
  cb.pairs.forEach((c, i) => { PAIRS[i].tt = c.tt; });
  note("kind.magicItem rows", { J: cb.J, P: cb.P, tt: cb.T });
  check("every Journal row's partner is named: each of the Journal's rows carries a revisedBy (so no unpaired Journal item stands for steps 8 and 10)", cb.J > 0 && cb.J === cb.P, { J: cb.J, P: cb.P });
  for (const c of cb.pairs) {
    const pair = pairOf(c.jj);
    if (!c.jjRow || !c.ttRow || !c.sameCategory) blocked(`${c.jj} no longer names a Tome row of its category in the served cookbooks`);
    check(`${c.jj} pairs with ${c.tt}: both are magic-item rows of one category${pair.reprint ? ", a reprint (placeholder name)" : ""}`, c.reprint === !!pair.reprint, { reprint: c.reprint });
  }
  if (new Set(ids("tt")).size !== PAIRS.length) blocked("two walk pairs name one Tome row");
  const JJ = ids("jj");
  const TT = ids("tt");
  const ALL = [...TT, ...JJ];

  section("the world as the walk found it");
  pre = await run(gm, P.readPairs, { pairs: PAIRS });
  for (const row of pre) {
    const d = row.holders;
    const shape = d.length === 0 ? "none" : d.length === 1 && d[0].id === row.tt ? "tome" : "other";
    note(row.jj, { holders: d.length, shape, jjMerged: d[0]?.merged.includes(row.jj) ?? false });
    if (shape === "other") blocked(`${row.jj}'s pair stands in a shape the walk cannot restore (${d.length} document(s), ids ${d.map((x) => x.id).join(", ")}): only none, or the Tome's one document, is restored`);
  }
  const refs = await run(gm, P.refFolders, { cats: [...new Set(PAIRS.map((p) => p.cat))], exclude: ALL });
  note("a standing Tome item outside the pairs, by category", Object.fromEntries(Object.entries(refs).map(([c, r]) => [c, r.id])));
  const catName = Object.fromEntries(await Promise.all(PAIRS.map(async (p) => [p.cat, await run(gm, P.categoryName, { cat: p.cat })])));

  /** A pair's document must file under its category, in the book's folder, in the item's own pack, as the Tome's kind does. */
  const folderOk = (f, pair, book) => !!f?.folder && f.folder.category === catName[pair.cat] && f.folder.parentBook === book;
  const haveRefs = PAIRS.every((p) => refs[p.cat]);
  if (!haveRefs) note("no standing Tome item outside the pairs for every category: the shelf comparison is not made", PAIRS.filter((p) => !refs[p.cat]).map((p) => p.cat));
  const sameShelf = (f, pair) => !haveRefs || (f.pack === refs[pair.cat].pack && f.folderId === refs[pair.cat].folderId);
  const folderBrief = (f, pair) => (f?.folder ? { category: f.folder.category === catName[pair.cat], parent: f.folder.parentBook, inPack: f.folder.inPack } : null);

  section("setup: the pairs' standing documents deleted by the ledger");
  for (const pair of PAIRS) {
    const out = await retire(pair);
    check(`setup: ${pair.jj}'s standing documents were deleted by the ledger, none refused`, out.failed === 0 && out.removed === out.held, out);
  }
  const none = await run(gm, P.readPairs, { pairs: PAIRS });
  check("setup: neither id of any pair is answered by a document", none.every((r) => r.holders.length === 0 && r.viaJJ === null && r.viaTT === null), none.map((r) => r.holders.length));

  /* ---------------------------------------------------------------- */
  section("7. The Journal alone");
  let closed = await run(gm, P.tomeClose);
  tomeClosed = true;
  check("7. the Tome is closed on the seat and the Journal stays open", closed.had && !closed.open && closed.jjOpen, closed);
  const j7 = await importOnly(JJ, "7. the Journal alone");
  note("7. import", j7);
  check("7. the import answered counts, the Tome closed at its start: every Journal row imported, none taken over, none refused", j7.ok && j7.open.jj && !j7.open.tt && j7.made === JJ.length && j7.already === 0 && j7.taken === 0 && j7.refused === 0, { made: j7.made, already: j7.already, taken: j7.taken, refused: j7.refused, open: j7.open, tomeOpens: await run(gm, P.tomeOpens) });
  const s7 = await run(gm, P.readPairs, { pairs: PAIRS });
  check("7. each pair, paired or not, is one item of its own: cookbook.id jj.item<n>, book jj, nothing merged", s7.every((r) => r.holders.length === 1 && r.holders[0].id === r.jj && r.holders[0].book === "jj" && r.holders[0].merged.length === 0 && r.viaJJ === r.holders[0].uuid && r.viaTT === null), s7.map((r) => ({ id: r.jj, holders: r.holders.length, own: r.holders[0]?.id === r.jj })));
  check("7. each is named, described by the Journal's own entry block, and a core item of its category's type", s7.every((r, i) => r.holders[0]?.named && r.holders[0].stamps.includes(r.jj) && !r.holders[0].stamps.includes(r.tt) && r.holders[0].type === (["swords", "weapons"].includes(PAIRS[i].cat) ? "weapon" : PAIRS[i].cat === "armors" ? "armor" : "item")));
  check("7. each stands in the Journal's folder of its category (the Judge's pack), a folder of its own compendium", s7.every((r, i) => folderOk(r.holders[0], PAIRS[i], "jj") && r.holders[0].folder.inPack), s7.map((r, i) => ({ id: r.jj, folder: folderBrief(r.holders[0], PAIRS[i]) })));
  note("7. the Journal's pack against the Tome's reference item's pack", s7.map((r, i) => ({ id: r.jj, sameAsTome: refs[PAIRS[i].cat] ? r.holders[0].pack === refs[PAIRS[i].cat].pack : null })));
  const u7 = Object.fromEntries(s7.map((r) => [r.jj, r.holders[0].uuid]));

  /* ---------------------------------------------------------------- */
  section("9. A held edit, before the takeover");
  const editRow = s7.find((r) => r.jj === EDIT.jj);
  await markItem(editRow.holders[0].uuid, EDIT);
  const ed = await run(gm, P.handEdit, { uuid: editRow.holders[0].uuid, name: HAND_NAME, text: HAND_TEXT });
  check("9. the name and the description are rewritten by hand and a figure moved on the edited pair's Journal item (figure read from the page)", ed.ok && ed.edited && ed.figured, { ok: ed.ok, edited: ed.edited, figured: ed.figured });
  const handBase = ed.base;

  /* ---------------------------------------------------------------- */
  section("8. The Journal, then the Tome");
  const op8 = await reopenTome();
  check("8. the Tome is open on the seat again", op8.open, op8);
  const j8 = await importOnly(TT, "8. the Tome after the Journal");
  note("8. import", j8);
  check("8. the notice counts every pair taken over from an earlier book, nothing made or refused", j8.ok && j8.open.jj && j8.open.tt && j8.taken === PAIRS.length && j8.made === 0 && j8.refused === 0 && j8.already === 0, { made: j8.made, already: j8.already, taken: j8.taken, refused: j8.refused, open: j8.open });
  const s8 = await run(gm, P.readPairs, { pairs: PAIRS });
  check("8. each pair is still one document, at the uuid it had before the import", s8.every((r) => r.holders.length === 1 && r.holders[0].uuid === u7[r.jj] && r.viaJJ === r.viaTT && r.viaTT === u7[r.jj]), s8.map((r) => ({ id: r.jj, holders: r.holders.length, sameUuid: r.holders[0]?.uuid === u7[r.jj] })));
  check("8. cookbook.id is the Tome's tt.item<m>, cookbook.book is tt, and cookbook.merged holds the Journal's jj.item<n>", s8.every((r) => r.holders[0]?.id === r.tt && r.holders[0].book === "tt" && sameSet(r.holders[0].merged, [r.jj])), s8.map((r) => ({ id: r.tt, book: r.holders[0]?.book, merged: r.holders[0]?.merged })));
  const unedited8 = s8.filter((r) => r.jj !== EDIT.jj);
  check("8. an untouched pair's description is the Tome's entry block alone: the Tome's stamp, none of the Journal's", unedited8.every((r) => r.holders[0].stamps.includes(r.tt) && !r.holders[0].stamps.some((s) => s.startsWith("jj."))), unedited8.map((r) => r.holders[0].stamps));
  // Owner ruling 2026-11-19 ("Stays put"): a takeover leaves the item on the shelf the earlier book filed it on, under its uuid.
  check("8. each pair stays in the Journal's folder of its category, a folder of the Judge's compendium (a takeover stays put)", s8.every((r, i) => folderOk(r.holders[0], PAIRS[i], "jj") && r.holders[0].folder.inPack), s8.map((r, i) => ({ id: r.tt, folder: folderBrief(r.holders[0], PAIRS[i]) })));
  check("8. each pair stands on the shelf it stood on before the import: the compendium and folder step 7 filed it in", s8.every((r) => { const was = s7.find((x) => x.jj === r.jj)?.holders[0]; return !!was && r.holders[0].pack === was.pack && r.holders[0].folderId === was.folderId; }), s8.map((r) => { const was = s7.find((x) => x.jj === r.jj)?.holders[0]; return { id: r.tt, pack: r.holders[0]?.pack === was?.pack, folder: r.holders[0]?.folderId === was?.folderId }; }));

  section("9. A held edit, after the takeover");
  const hand = await run(gm, P.handRead, { uuid: u7[EDIT.jj], name: HAND_NAME, text: HAND_TEXT, base: handBase });
  const edit8 = factsOf(s8.find((r) => r.jj === EDIT.jj), s8.find((r) => r.jj === EDIT.jj).tt);
  check("9. the hand-written name and description stand after the takeover", hand.found && hand.name && hand.description, hand);
  check("9. the hand-moved figure stands", hand.figure === true, { figure: hand.figure });
  check("9. the id, the book and merged are the Tome's", edit8?.id === EDIT.tt && edit8.book === "tt" && sameSet(edit8.merged, [EDIT.jj]), { id: edit8?.id, book: edit8?.book, merged: edit8?.merged });

  /* ---------------------------------------------------------------- */
  section("10. The Tome, then the Journal");
  for (const r of s8) await markItem(r.holders[0].uuid, pairOf(r.jj));
  for (const pair of PAIRS) {
    const out = await retire(pair);
    check(`10. ${pair.jj}'s item was deleted by the ledger, none refused`, out.failed === 0 && out.removed === out.held && out.held === 1, out);
  }
  const gone10 = await run(gm, P.readPairs, { pairs: PAIRS });
  check("10. no document answers for either id of any pair", gone10.every((r) => r.holders.length === 0 && r.viaJJ === null && r.viaTT === null));
  const books10 = await run(gm, P.bookOpen);
  check("10. both books are open", books10.jj && books10.tt, books10);
  const j10 = await importOnly(ALL, "10. both books open");
  note("10. import", j10);
  check("10. the Tome's rows imported, the Journal's rows joined with none built, none taken over or refused", j10.ok && j10.open.jj && j10.open.tt && j10.made === TT.length && j10.already === JJ.length && j10.taken === 0 && j10.refused === 0, { made: j10.made, already: j10.already, taken: j10.taken, refused: j10.refused, open: j10.open });
  const s10 = await run(gm, P.readPairs, { pairs: PAIRS });
  check("10. each pair is one document, answering for both ids: cookbook.id tt.item<m>, cookbook.book tt, cookbook.merged jj.item<n>", s10.every((r) => r.holders.length === 1 && r.holders[0].id === r.tt && r.holders[0].book === "tt" && sameSet(r.holders[0].merged, [r.jj]) && r.viaJJ === r.viaTT && r.viaTT === r.holders[0].uuid), s10.map((r) => ({ id: r.tt, holders: r.holders.length, merged: r.holders[0]?.merged })));
  check("10. no item is left under a Journal heading and no Journal paragraph is appended: the description carries the Tome's stamp alone", s10.every((r) => r.holders[0].stamps.includes(r.tt) && !r.holders[0].stamps.some((s) => s.startsWith("jj."))), s10.map((r) => r.holders[0].stamps));
  check("10. each pair stands in the Tome's folder of its category, a folder of its own compendium, on the Tome's shelf", s10.every((r, i) => folderOk(r.holders[0], PAIRS[i], "tt") && r.holders[0].folder.inPack && sameShelf(r.holders[0], PAIRS[i])), s10.map((r, i) => ({ id: r.tt, folder: folderBrief(r.holders[0], PAIRS[i]) })));

  /* ---------------------------------------------------------------- */
  section("11. Either order, one document");
  const compared = PAIRS.filter((p) => !p.edit).map((p) => ({ p, a: factsOf(s8.find((r) => r.jj === p.jj), p.tt), b: factsOf(s10.find((r) => r.jj === p.jj), p.tt) }));
  const same = (k) => compared.every(({ a, b }) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  check("11. the same name from either order", same("name"), compared.map(({ p, a, b }) => ({ id: p.tt, same: a.name === b.name })));
  check("11. the same cookbook.id, cookbook.book and cookbook.merged", same("id") && same("book") && same("merged"));
  check("11. the same description: the same bytes and the same text", same("desc") && same("descText"), compared.map(({ p, a, b }) => ({ id: p.tt, desc: a.desc === b.desc })));
  check("11. the shelf follows the order: the Journal first leaves the item in the Journal's folder of its category, the Tome first files it in the Tome's, each in its own book's compendium", compared.every(({ p, a, b }) => folderOk(a, p, "jj") && folderOk(b, p, "tt") && a.folder.inPack && b.folder.inPack && a.pack !== b.pack), compared.map(({ p, a, b }) => ({ id: p.tt, first: a.folder?.parentBook, second: b.folder?.parentBook, packsDiffer: a.pack !== b.pack })));
  check("11. the same core type and the same figures in the markets flag", same("type") && same("base") && same("apparent") && same("magic"));
  const e8 = factsOf(s8.find((r) => r.jj === EDIT.jj), EDIT.tt);
  const e10 = factsOf(s10.find((r) => r.jj === EDIT.jj), EDIT.tt);
  check("11. the edited pair's figures: the page's other figure is the Tome's either way, and the moved one differs from what the Tome's import wrote", e8.apparent === e10.apparent && typeof handBase === "number" && e8.base === handBase + 7 && e10.base !== e8.base, { apparentSame: e8.apparent === e10.apparent, heldAtStep8: e8.base === (handBase ?? 0) + 7, tomeWritesItAfter: e10.base !== e8.base });

  /* ---------------------------------------------------------------- */
  section("12. The delete path");
  const dropRow = s10.find((r) => r.jj === DROP.jj);
  const out12 = await retire(DROP);
  check("12. the ledger deleted the marked item, none refused", out12.held === 1 && out12.removed === 1 && out12.failed === 0, out12);
  const j12a = await importOnly(ALL, "12. both books open, the item deleted");
  note("12. import", j12a);
  check("12. one imported, the rest already present, none taken over or refused", j12a.ok && j12a.open.jj && j12a.open.tt && j12a.made === 1 && j12a.already === ALL.length - 1 && j12a.taken === 0 && j12a.refused === 0, { made: j12a.made, already: j12a.already, taken: j12a.taken, refused: j12a.refused, open: j12a.open });
  const s12a = (await run(gm, P.readPairs, { pairs: [DROP] }))[0];
  check("12. the Journal row's id answers to the new document, imported once: one document, the Tome's, with cookbook.merged holding the Journal's id", s12a.holders.length === 1 && s12a.holders[0].id === DROP.tt && sameSet(s12a.holders[0].merged, [DROP.jj]) && s12a.viaJJ === s12a.holders[0].uuid && s12a.viaTT === s12a.holders[0].uuid, { holders: s12a.holders.length, merged: s12a.holders[0]?.merged, bothIdsOneDoc: s12a.viaJJ === s12a.viaTT });
  note("12. the re-made item's uuid against the deleted one's", { sameUuid: s12a.holders[0]?.uuid === dropRow.holders[0].uuid });

  closed = await run(gm, P.tomeClose);
  tomeClosed = true;
  check("12. the Tome is closed on the seat again and the Journal stays open", closed.had && !closed.open && closed.jjOpen, closed);
  const out12b = await retire(DROP);
  check("12. the ledger deleted that item again", out12b.held === 1 && out12b.removed === 1 && out12b.failed === 0, out12b);
  const j12b = await importOnly(JJ, "12. the Journal alone, the item deleted");
  note("12. import", j12b);
  check("12. the Journal row is built as its own item: one imported, the other rows already present, none taken over or refused", j12b.ok && j12b.open.jj && !j12b.open.tt && j12b.made === 1 && j12b.already === JJ.length - 1 && j12b.taken === 0 && j12b.refused === 0, { made: j12b.made, already: j12b.already, taken: j12b.taken, refused: j12b.refused, open: j12b.open, tomeOpens: await run(gm, P.tomeOpens) });
  const s12b = (await run(gm, P.readPairs, { pairs: [DROP] }))[0];
  check("12. that item is the Journal's own: cookbook.id jj.item<n>, book jj, nothing merged, and no Tome document beside it", s12b.holders.length === 1 && s12b.holders[0].id === DROP.jj && s12b.holders[0].book === "jj" && s12b.holders[0].merged.length === 0 && s12b.viaTT === null, { holders: s12b.holders.length, id: s12b.holders[0]?.id });
  const op12 = await reopenTome();
  check("12. the Tome is open on the seat again", op12.open, op12);
  const j12c = await importOnly(ALL, "12. the Tome after the item stood as the Journal's");
  note("12. import", j12c);
  check("12. the Tome takes the item over as in step 8: one taken over, nothing made or refused", j12c.ok && j12c.open.jj && j12c.open.tt && j12c.taken === 1 && j12c.made === 0 && j12c.refused === 0 && j12c.already === ALL.length - 1, { made: j12c.made, already: j12c.already, taken: j12c.taken, refused: j12c.refused, open: j12c.open });
  const s12c = (await run(gm, P.readPairs, { pairs: [DROP] }))[0];
  check("12. the document keeps its uuid and now reads as in step 8: cookbook.id tt.item<m>, book tt, merged holding jj.item<n>, the Tome's stamp alone", s12c.holders.length === 1 && s12c.holders[0].uuid === s12b.holders[0].uuid && s12c.holders[0].id === DROP.tt && s12c.holders[0].book === "tt" && sameSet(s12c.holders[0].merged, [DROP.jj]) && s12c.holders[0].stamps.includes(DROP.tt) && !s12c.holders[0].stamps.some((s) => s.startsWith("jj.")), { holders: s12c.holders.length, sameUuid: s12c.holders[0]?.uuid === s12b.holders[0].uuid });

  /* ---------------------------------------------------------------- */
  section("13. A second import adds nothing");
  const before13 = await run(gm, P.readPairs, { pairs: PAIRS });
  const j13 = await importOnly(ALL, "13. a second import");
  note("13. import", j13);
  check("13. nothing is made, taken over or refused: every row already present", j13.ok && j13.open.jj && j13.open.tt && j13.made === 0 && j13.taken === 0 && j13.refused === 0 && j13.already === ALL.length, { made: j13.made, already: j13.already, taken: j13.taken, refused: j13.refused, open: j13.open });
  const after13 = await run(gm, P.readPairs, { pairs: PAIRS });
  check("13. each pair is still one document at the same uuid, none written (the modified time stands)", after13.every((r, i) => r.holders.length === 1 && r.holders[0].uuid === before13[i].holders[0].uuid && typeof r.holders[0].modified === "number" && r.holders[0].modified === before13[i].holders[0].modified && JSON.stringify(r.holders[0].merged) === JSON.stringify(before13[i].holders[0].merged)), after13.map((r, i) => ({ id: r.jj, holders: r.holders.length, untouched: r.holders[0]?.modified === before13[i].holders[0]?.modified })));

  /* ---------------------------------------------------------------- */
  section("14. The Journal's row with the Tome open and no document (the defer step)");
  const out14 = await retire(DEFER);
  check("14. the ledger deleted the marked item, none refused", out14.held === 1 && out14.removed === 1 && out14.failed === 0, out14);
  const j14 = await importOnly([DEFER.jj], "14. the Journal's row alone, the Tome open");
  note("14. import", j14);
  check("14. the item is built from the Tome's row and the Journal's id joins it: one imported, none taken over or refused", j14.ok && j14.open.jj && j14.open.tt && j14.made === 1 && j14.taken === 0 && j14.refused === 0, { made: j14.made, already: j14.already, taken: j14.taken, refused: j14.refused, open: j14.open });
  const s14 = (await run(gm, P.readPairs, { pairs: [DEFER] }))[0];
  check("14. one document, the Tome's, with cookbook.merged holding the Journal's id, answering for both ids", s14.holders.length === 1 && s14.holders[0].id === DEFER.tt && s14.holders[0].book === "tt" && sameSet(s14.holders[0].merged, [DEFER.jj]) && s14.viaJJ === s14.viaTT && s14.viaTT === s14.holders[0].uuid, { holders: s14.holders.length, merged: s14.holders[0]?.merged });

  const drained = await run(gm, P.drain);
  check("no console error on the GM seat over the walk (recorder attached after ready)", !drained.errors.length, { errors: drained.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && tomeClosed) {
    try {
      const o = await reopenTome();
      note("Tome reopened", { held: o.held, open: o.open, reconnected: !!o.reconnected });
      check("teardown: the Tome is open on the seat", o.open, { open: o.open });
    } catch (err) { console.error("restore Tome:", err?.message ?? err); checks.push(["teardown: the Tome is open on the seat", false]); }
  }
  if (gm && own.length) {
    try {
      const out = await gm.sweepTracked({ only: [...own] });
      note("tracked documents swept", { removed: out.removed.length, missing: out.missing.length, failed: out.failed.length });
      for (const uuid of out.removed) { const at = own.indexOf(uuid); if (at >= 0) own.splice(at, 1); }
    } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  if (gm && touched && pre) {
    try {
      // The Tome's rows by `only`, the Journal's with them where the pair stood merged: never a bare import.
      const TTs = PAIRS.map((p) => p.tt);
      const merged = PAIRS.filter((p) => pre.find((r) => r.jj === p.jj)?.holders[0]?.merged.includes(p.jj));
      const back = await importOnly([...TTs, ...merged.map((p) => p.jj)], "restore the pairs", { track: false });
      note("pairs imported again", { made: back.made, already: back.already, taken: back.taken, refused: back.refused });
      for (const p of PAIRS) if (!merged.includes(p)) await run(gm, P.unmerge, { tt: p.tt, jj: p.jj });
      const end = await run(gm, P.readPairs, { pairs: PAIRS });
      check("teardown: every pair's Tome item stands, one document each, none refused", back.ok && back.refused === 0 && end.every((r) => r.holders.length === 1 && r.holders[0].id === r.tt), { refused: back.refused, holders: end.map((r) => r.holders.length) });
      check("teardown: each pair merged the Journal's id only where it did before the walk", end.every((r) => r.holders[0]?.merged.includes(r.jj) === (pre.find((x) => x.jj === r.jj)?.holders[0]?.merged.includes(r.jj) ?? false)), end.map((r) => ({ id: r.jj, merged: r.holders[0]?.merged.includes(r.jj) })));
      note("teardown: a Tome document that stood before stands at its uuid", pre.filter((r) => r.holders[0]).map((r) => ({ id: r.jj, sameUuid: end.find((x) => x.jj === r.jj).holders[0]?.uuid === r.holders[0].uuid })));
    } catch (err) { console.error("restore import:", err?.message ?? err); checks.push(["teardown: every pair's Tome item stands again", false]); }
  }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  console.log("imports kept: the four pairs' Tome items");
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
