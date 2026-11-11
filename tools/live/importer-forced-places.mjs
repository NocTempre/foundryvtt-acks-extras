/**
 * Live walk, importer-forced-places: a forced adventure repair writes places
 * in place and holds a Judge's edits. Walks docs/importer/TESTING.md, "A
 * forced adventure repair writes places in place, and holds a Judge's edits",
 * on the books ax1 and ax3 (the pair of books whose places two printings
 * share, ax3's sites bound onto its markets and its overviews, ax1's
 * pregenerated characters), and the confirm's census of "An adventure book's
 * Force repair", step 1. Machine values arrive through ./_env.mjs; both books
 * are connected from the staged copies the machine lists.
 *
 * Fixtures: the library documents the corpus import made for the two books,
 * found by their cookbook claims. A marker cannot name them: a fixture is a
 * world document and the library is a compendium. They are the world's corpus,
 * so the census (the confirm, answered No under an observer that must hold
 * nothing) is all this walk does to them unless FORCED_REPAIR_OK=1, which is
 * the owner's go-ahead to run the forced repairs over them. With it, steps 1–4
 * run: step 2's edits are this run's own, made only on blocks step 1 left
 * stamped, and step 4 takes exactly this run's edit keys, which returns those
 * documents to the page's text; an edit step 1 found held (an unstamped block,
 * a Judge's line) is listed and never taken. Nothing is created, so the ledger
 * stays empty and nothing is swept. Every id printed is a cookbook id or a
 * uuid; no book word leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOKS = ["ax1", "ax3"];
const NOTE = "<p>QA forced-places note.</p>";
const WRITE = process.env.FORCED_REPAIR_OK === "1";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__fpBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side: each function is stringified and run in the GM's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__fp = globalThis.__fp ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.PP = await import("/modules/acks-extras/scripts/importer/place-pair.mjs");
    H.PR = await import("/modules/acks-extras/scripts/importer/prose.mjs");
    if (!H.observer) {
      H.writes = [];
      H.observer = true;
      for (const doc of ["Actor", "Item", "RollTable", "JournalEntry", "Scene", "Adventure"]) {
        for (const verb of ["create", "update", "delete"]) Hooks.on(`${verb}${doc}`, (d) => { if (H.observing) H.writes.push({ hook: `${verb}${doc}`, uuid: d?.uuid ?? null }); });
      }
    }
    return {
      user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null, boot: globalThis.__fpBoot ?? null,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__fp;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__fpBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__fpBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__fpBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__fpBook, open: !!globalThis.__fp.CB.cookbookSessionDoc(id) }),
  /** Every place a book's rows write onto, resolved as a forced repair resolves it, with the book that holds it. */
  targets: async ({ ids }) => {
    const H = globalThis.__fp;
    const MID = "acks-extras";
    const cbs = new Map();
    for (const id of ids) cbs.set(id, await fetch(`/modules/acks-extras/cookbook/${id}.json`).then((r) => r.json()));
    const pairs = H.PP.placePairs(cbs);
    const out = {};
    for (const book of ids) {
      const rows = [];
      for (const { id, place } of H.CB.placeBlockRows(book, cbs.get(book).entries ?? {}, pairs)) {
        const doc = await H.CB.importedActorFor(place, { copies: false });
        const flag = doc?.getFlag(MID, "cookbook") ?? null;
        if (!doc || !H.PP.answersFor(flag, place)) { rows.push({ id, place, uuid: null }); continue; }
        rows.push({
          id, place, uuid: doc.uuid, heldBy: flag.book ?? String(flag.id).split(".")[0], claim: flag.id,
          hasBlock: !!H.PR.bookTextBlock(doc.system?.notes ?? "", id), stamped: (flag.blocks ?? []).some((b) => b?.id === id),
        });
      }
      const pregens = [];
      for (const [id, e] of Object.entries(cbs.get(book).entries ?? {})) {
        if (e.kind !== "kind.pregen") continue;
        const doc = await H.CB.importedActorFor(id, { copies: false });
        if (doc && doc.getFlag(MID, "cookbook")?.id === id) pregens.push({ id, uuid: doc.uuid });
      }
      out[book] = { rows, pregens };
    }
    return out;
  },
  /** The forced repair's confirm, read and answered No, under an observer that must catch no write. */
  census: async ({ book }) => {
    const H = globalThis.__fp;
    H.writes = [];
    H.observing = true;
    let asked = null;
    await acksExtras.importer.cookbookReimportAdventure(book, { mode: "force", ask: async (q) => { asked = q; return false; } });
    await new Promise((r) => setTimeout(r, 1000));
    H.observing = false;
    const lines = asked?.lines ?? [];
    const count = (key) => {
      const shape = game.i18n.format(`ACKS-IMPORTER.ui.${key}`, { n: "__N__" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("__N__", "(\\d+)");
      for (const line of lines) {
        const m = new RegExp(shape).exec(line);
        if (m) return Number(m[1]);
      }
      return 0;
    };
    return { asked: !!asked, places: count("forceCensusPlaces"), left: count("reimportAdventureForceLeft"), writes: H.writes.length };
  },
  /** A document's notes, biography, name, blocks stamp, modified time and uuid. */
  read: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const flag = doc.getFlag("acks-extras", "cookbook") ?? {};
    return {
      uuid: doc.uuid, name: doc.name, notes: doc.system?.notes ?? null, bio: doc.system?.details?.biography ?? null,
      blocks: flag.blocks ?? [], printed: flag.printed ?? null, merged: flag.merged ?? [], id: flag.id ?? null,
      modified: doc._stats?.modifiedTime ?? null, created: doc._stats?.createdTime ?? null,
    };
  },
  blockOf: async ({ uuid, id }) => {
    const doc = await fromUuid(uuid);
    return globalThis.__fp.PR.bookTextBlock(doc?.system?.notes ?? "", id) ?? null;
  },
  countBlock: async ({ uuid, id }) => {
    const doc = await fromUuid(uuid);
    return String(doc?.system?.notes ?? "").split(`data-acks-entry="${id}"`).length - 1;
  },
  update: async ({ uuid, patch }) => {
    const doc = await fromUuid(uuid);
    await doc.update(patch);
    return true;
  },
  /** A forced repair fired into a global: the hidden page's timers make a long await outlast one call. */
  force: async ({ book, decision }) => {
    const want = decision?.take ? { take: new Set(decision.take) } : decision;
    globalThis.__fpRun = { done: false };
    acksExtras.importer.cookbookReimportAdventure(book, { mode: "force", ask: async () => true, decision: want })
      .then((r) => { globalThis.__fpRun = { done: true, edits: r?.edits ?? null, mode: r?.mode ?? null, errors: (r?.errors ?? []).length }; })
      .catch((e) => { globalThis.__fpRun = { done: true, error: String(e?.message ?? e) }; });
    return true;
  },
  forceState: async () => {
    const r = globalThis.__fpRun ?? { done: false };
    if (!r.done || !r.edits) return r;
    return { ...r, edits: r.edits.map((e) => ({ key: e.key, uuid: e.uuid, path: e.path, unstamped: !!e.unstamped, cite: !!e.cite, hasCurrent: e.current !== undefined, hasPage: e.page !== undefined })) };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookReimportAdventure`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function record(port, api) {
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
  const seconds = await ready(api);
  ws.close();
  return seconds;
}
async function force(book, decision = null, minutes = 6) {
  await run(gm, P.force, { book, decision });
  const t0 = Date.now();
  for (;;) {
    const s = await run(gm, P.forceState);
    if (s.done) return s;
    if (Date.now() - t0 > minutes * 60_000) throw new Error(`forced repair of ${book} did not finish in ${minutes} min`);
    await sleep(3000);
  }
}

let gm = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, gm));
  const installed = await run(gm, P.install);
  note("installed", { user: installed.user, module: installed.module });
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf);
  if (!installed.activeGMIsSelf) throw new Error("another client is the active GM; the repair would run there");
  check("gm seat: no error from load through ready", installed.boot?.phases.length === 3 && !installed.boot.errors.length, installed.boot);
  const staged = books(BOOKS);
  if (staged.length !== BOOKS.length) throw new Error(`ACKS_TEST_BOOKS lists ${staged.map((b) => b.id).join(",") || "none"} of ${BOOKS.join(",")}`);
  for (const b of staged) {
    note(`connect ${b.id}`, await run(gm, P.connectBook, b));
    let s = await run(gm, P.bookState, { id: b.id });
    for (let n = 0; n < 120 && !s.open && !(s.done && !s.ok); n++) { await sleep(2000); s = await run(gm, P.bookState, { id: b.id }); }
    check(`${b.id} is open on the GM seat`, s.open, s);
    if (!s.open) throw new Error(`${b.id} did not open`);
  }

  section("Fixtures (read)");
  const T = await run(gm, P.targets, { ids: BOOKS });
  for (const book of BOOKS) {
    const held = T[book].rows.filter((r) => r.uuid);
    note(`${book} rows writing onto a place`, {
      rows: T[book].rows.length, resolved: held.length, otherBook: held.filter((r) => r.heldBy !== book).length,
      withBlock: held.filter((r) => r.hasBlock).length, stamped: held.filter((r) => r.stamped).length, pregens: T[book].pregens.length,
    });
  }
  check("the world holds places both books' rows write onto", BOOKS.every((b) => T[b].rows.some((r) => r.uuid)), BOOKS.map((b) => T[b].rows.filter((r) => r.uuid).length));

  section("An adventure book's Force repair, step 1: the census, answered No");
  for (const book of BOOKS) {
    const c = await run(gm, P.census, { book });
    const held = T[book].rows.filter((r) => r.uuid);
    const docs = new Set(held.map((r) => r.uuid));
    const other = new Set(held.filter((r) => r.heldBy !== book).map((r) => r.uuid));
    note(`${book} census`, { places: c.places, left: c.left, targets: docs.size, otherBook: other.size });
    check(`${book}: the confirm asked, and its No wrote nothing`, c.asked && c.writes === 0, { asked: c.asked, writes: c.writes });
    check(`${book}: every place a row writes onto is counted among the places, another book's included`, c.places >= docs.size, { places: c.places, targets: docs.size });
  }

  if (!WRITE) {
    section("Steps 1-4 (forced repairs)");
    console.log("note: not walked: the forced repairs write over the world's corpus import of ax1 and ax3, and FORCED_REPAIR_OK=1 (the owner's go-ahead) is not set");
  } else {
    section("Step 1: the first forced repair");
    const before = {};
    for (const book of BOOKS) for (const r of T[book].rows.filter((r) => r.uuid)) before[r.uuid] ??= await run(gm, P.read, { uuid: r.uuid });
    const first = {};
    for (const book of [...BOOKS].reverse()) {
      first[book] = await force(book);
      note(`${book} step 1`, { mode: first[book].mode, errors: first[book].errors, edits: first[book].edits?.length ?? null, unstamped: first[book].edits?.filter((e) => e.unstamped).length ?? null });
      check(`${book} 1: the result is a forced repair with an edits array`, first[book].mode === "force" && Array.isArray(first[book].edits), first[book].error ?? null);
    }
    let kept = true;
    let stampedOrHeld = true;
    for (const book of BOOKS) {
      const heldKeys = new Set((first[book].edits ?? []).map((e) => e.key));
      for (const r of T[book].rows.filter((r) => r.uuid)) {
        const now = await run(gm, P.read, { uuid: r.uuid });
        if (!now || now.uuid !== before[r.uuid].uuid || now.created !== before[r.uuid].created || now.id !== before[r.uuid].id) kept = false;
        if (!now.blocks.some((b) => b.id === r.id) && !heldKeys.has(`${r.uuid}#system.notes#${r.id}`)) stampedOrHeld = false;
      }
    }
    check("1: every place keeps its uuid, creation time and claim", kept);
    check("1: each row's block is stamped on its place, or listed held (forcedPlaceHold, POI/keyed/region block branches)", stampedOrHeld);
    const pairRow = T.ax1.rows.find((r) => r.uuid && r.heldBy === "ax3" && r.stamped !== undefined);
    if (pairRow) {
      const n = await run(gm, P.countBlock, { uuid: pairRow.uuid, id: pairRow.id });
      check("1: an earlier book's row stands once on the place the later book took over (no second takeover)", n <= 1, { row: pairRow.id, count: n });
    }

    section("Step 2: this run's edits are held");
    const after1 = {};
    for (const book of BOOKS) for (const r of T[book].rows.filter((r) => r.uuid)) after1[r.uuid] = await run(gm, P.read, { uuid: r.uuid });
    const stampedRows = (book) => T[book].rows.filter((r) => r.uuid && after1[r.uuid].blocks.some((b) => b.id === r.id));
    const mine = [];
    const edited = stampedRows("ax1").find((r) => r.heldBy === "ax3");
    if (edited) {
      const block = await run(gm, P.blockOf, { uuid: edited.uuid, id: edited.id });
      const touched = block.replace(/<p>/, "<p>QA ");
      await run(gm, P.update, { uuid: edited.uuid, patch: { "system.notes": after1[edited.uuid].notes.replace(block, touched) } });
      mine.push({ book: "ax1", key: `${edited.uuid}#system.notes#${edited.id}`, uuid: edited.uuid, check: (d) => d.notes.includes(touched) });
    }
    const removed = stampedRows("ax3").find((r) => r.heldBy === "ax3" && r.place !== r.id);
    if (removed) {
      const block = await run(gm, P.blockOf, { uuid: removed.uuid, id: removed.id });
      await run(gm, P.update, { uuid: removed.uuid, patch: { "system.notes": after1[removed.uuid].notes.replace(block, "") } });
      mine.push({ book: "ax3", key: `${removed.uuid}#system.notes#${removed.id}`, uuid: removed.uuid, check: (d) => !d.notes.includes(`data-acks-entry="${removed.id}"`) });
    }
    const pregen = T.ax1.pregens[0];
    if (pregen) {
      const p = await run(gm, P.read, { uuid: pregen.uuid });
      await run(gm, P.update, { uuid: pregen.uuid, patch: { "system.details.biography": `${p.bio ?? ""}${NOTE}` } });
      mine.push({ book: "ax1", key: `${pregen.uuid}#system.details.biography`, uuid: pregen.uuid, check: (d) => String(d.bio).includes(NOTE) });
    }
    note("step 2 edits made", mine.map((m) => m.key));
    const second = {};
    for (const book of [...BOOKS].reverse()) second[book] = await force(book);
    const listed = new Set(BOOKS.flatMap((b) => (second[b].edits ?? []).map((e) => e.key)));
    for (const m of mine) {
      const d = await run(gm, P.read, { uuid: m.uuid });
      check(`2: ${m.key.split("#").slice(1).join("#")} stands and is listed (${m.book})`, m.check(d) && listed.has(m.key));
    }
    const shapes = BOOKS.flatMap((b) => second[b].edits ?? []).filter((e) => mine.some((m) => m.key === e.key));
    check("2: each listed edit carries key, uuid, path, current, page and cite (writeRowBlock and the biography push them)", shapes.length === mine.length && shapes.every((e) => e.key && e.uuid && e.path && e.hasCurrent && e.hasPage), shapes);
    check("2: a stamped edit carries no unstamped mark", shapes.every((e) => !e.unstamped));

    section("Steps 3-4: take one, then the rest of this run's");
    if (mine.length) {
      const [one, ...rest] = mine;
      const third = await force(one.book, { take: [one.key] });
      const d = await run(gm, P.read, { uuid: one.uuid });
      check("3: the edit taken is the page's again and no longer listed", !one.check(d) && !(third.edits ?? []).some((e) => e.key === one.key));
      for (const book of BOOKS) {
        const keys = rest.filter((m) => m.book === book).map((m) => m.key);
        if (keys.length) await force(book, { take: keys });
      }
      let restored = true;
      for (const m of rest) if (m.check(await run(gm, P.read, { uuid: m.uuid }))) restored = false;
      check("4: every edit this run made is the page's again", restored);
    }
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const sw = await gm.sweepTracked();
      note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
