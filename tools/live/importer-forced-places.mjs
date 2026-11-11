/**
 * Live walk, importer-forced-places: an adventure book's repair writes places
 * in place, holds a Judge's edits, and puts each pregenerated character to the
 * Judge. Walks docs/importer/TESTING.md, "An adventure book's repair writes
 * places in place, and holds a Judge's edits", on the books ax1 and ax3 (the
 * pair of books whose places two printings share, ax3's sites bound onto its
 * markets and its overviews, ax1's pregenerated characters), and the confirm's
 * census of "Rebuild or repair an adventure book". Machine values arrive
 * through ./_env.mjs; both books are connected from the staged copies the
 * machine lists.
 *
 * Fixtures: the library documents the corpus import made for the two books,
 * found by their cookbook claims. A marker cannot name them: a fixture is a
 * world document and the library is a compendium. A live walk may write over
 * the test world's corpus (owner ruling, 2026-11-11), so every repair runs.
 * Each repair answers its choice through `choose`, as the Judge's dialog
 * does, naming only this run's own edit keys and its one pregenerated
 * character; every other edit is kept and every other character left. Step 2's
 * edits are made only on blocks step 1 left stamped. The one document this run
 * creates, the character a restore keeps under a new id, is tracked from the
 * repair's own result and swept. Every id printed is a cookbook id or a uuid;
 * no book word leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOKS = ["ax1", "ax3"];
const NOTE = "<p>QA forced-places note.</p>";

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
  /** Every place a book's rows write onto, resolved as a repair resolves it, with the book that holds it, and its characters. */
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
        if (e.kind !== "kind.pregen" && e.meta?.actor !== "character") continue;
        const doc = await H.CB.importedActorFor(id, { copies: false });
        const players = Object.entries(doc?.ownership ?? {}).some(([u, l]) => u !== "default" && l >= 3 && !game.users.get(u)?.isGM);
        if (doc && doc.getFlag(MID, "cookbook")?.id === id && !players) pregens.push({ id, uuid: doc.uuid });
      }
      out[book] = { rows, pregens };
    }
    return out;
  },
  /** The repair's confirm, read and answered No, under an observer that must catch no write. */
  census: async ({ book }) => {
    const H = globalThis.__fp;
    H.writes = [];
    H.observing = true;
    let asked = null;
    await acksExtras.importer.cookbookReimportAdventure(book, { ask: async (q) => { asked = q; return false; } });
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
    const title = asked?.title === "repairMergedTitle";
    return { asked: !!asked, title, places: count("forceCensusPlaces"), left: count("repairMergedAdventureLeft"), writes: H.writes.length };
  },
  /** A document's notes, biography, name, blocks stamp, play stamp, times and uuid. */
  read: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const flag = doc.getFlag("acks-extras", "cookbook") ?? {};
    return {
      uuid: doc.uuid, name: doc.name, notes: doc.system?.notes ?? null, bio: doc.system?.details?.biography ?? null,
      blocks: flag.blocks ?? [], printed: flag.printed ?? null, merged: flag.merged ?? [], id: flag.id ?? null,
      playStamp: doc.getFlag("acks-extras", "playStamp") ?? null, keptFrom: doc.getFlag("acks-extras", "keptFrom") ?? null,
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
  /**
   * A repair fired into a global (the hidden page's timers make a long await outlast one call),
   * its confirm answered yes and its choice answered as the Judge's dialog answers: the edit keys
   * in `take` taken, each character in `pregens` given its answer, everything else kept or left.
   */
  repair: async ({ book, take = [], pregens = [] }) => {
    const R = (globalThis.__fpRun = { done: false, chosen: null });
    const choose = async (edits, more) => {
      R.chosen = { edits: edits.map((e) => e.key), pregens: (more?.pregens ?? []).map((p) => ({ uuid: p.uuid, changed: p.changed, unstamped: !!p.unstamped })) };
      return { take: new Set(take), pregens: new Map(pregens) };
    };
    acksExtras.importer.cookbookReimportAdventure(book, { ask: async () => true, choose })
      .then((r) => Object.assign(R, {
        done: true, mode: r?.mode ?? null, errors: (r?.errors ?? []).length, edits: r?.edits ?? null,
        taken: r?.taken ?? null, held: r?.held ?? null, listed: r?.pregens ?? null,
        restored: r?.restored ?? null, rewritten: r?.rewritten ?? null, pregenRefused: r?.pregenRefused ?? null, kept: r?.kept ?? [],
      }))
      .catch((e) => Object.assign(R, { done: true, error: String(e?.message ?? e) }));
    return true;
  },
  repairState: async () => {
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
/** One repair of `book`, answered as `answer` says; every copy a restore kept is tracked from the result. */
async function repair(book, answer = {}, minutes = 8) {
  await run(gm, P.repair, { book, ...answer });
  const t0 = Date.now();
  for (;;) {
    const s = await run(gm, P.repairState);
    if (s.done) {
      for (const uuid of s.kept ?? []) gm.track(uuid, "Actor");
      return s;
    }
    if (Date.now() - t0 > minutes * 60_000) throw new Error(`repair of ${book} did not finish in ${minutes} min`);
    await sleep(3000);
  }
}
const listedAs = (r, uuid) => r?.chosen?.pregens.find((p) => p.uuid === uuid) ?? null;

let gm = null;
// The notes each place held before this run edited them, put back at teardown where the edit still stands.
const undo = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
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
  const pregen = T.ax1.pregens[0] ?? null;
  check("the library holds a pregenerated character of ax1 that no player owns", !!pregen, T.ax1.pregens.length);

  section("The confirm's census, answered No");
  for (const book of BOOKS) {
    const c = await run(gm, P.census, { book });
    const held = T[book].rows.filter((r) => r.uuid);
    const docs = new Set(held.map((r) => r.uuid));
    const other = new Set(held.filter((r) => r.heldBy !== book).map((r) => r.uuid));
    note(`${book} census`, { places: c.places, left: c.left, targets: docs.size, otherBook: other.size });
    check(`${book}: the confirm asked under the repair's title, and its No wrote nothing`, c.asked && c.title && c.writes === 0, { asked: c.asked, title: c.title, writes: c.writes });
    check(`${book}: every place a row writes onto is counted among the places, another book's included`, c.places >= docs.size, { places: c.places, targets: docs.size });
  }

  section("Step 1: the first repair, the character restored");
  const before = {};
  for (const book of BOOKS) for (const r of T[book].rows.filter((r) => r.uuid)) before[r.uuid] ??= await run(gm, P.read, { uuid: r.uuid });
  const pregenBefore = pregen ? await run(gm, P.read, { uuid: pregen.uuid }) : null;
  const first = {};
  for (const book of [...BOOKS].reverse()) {
    first[book] = await repair(book, { pregens: book === "ax1" && pregen ? [[pregen.uuid, "restore"]] : [] });
    note(`${book} step 1`, { mode: first[book].mode, errors: first[book].errors, edits: first[book].edits?.length ?? null, unstamped: first[book].edits?.filter((e) => e.unstamped).length ?? null, listed: first[book].listed, restored: first[book].restored, kept: first[book].kept });
    check(`${book} 1: the result is a merged repair with an edits array`, first[book].mode === "repair" && Array.isArray(first[book].edits), first[book].error ?? null);
  }
  let kept = true;
  let stampedOrHeld = true;
  for (const book of BOOKS) {
    const heldKeys = new Set((first[book].edits ?? []).map((e) => e.key));
    for (const r of T[book].rows.filter((r) => r.uuid)) {
      const now = await run(gm, P.read, { uuid: r.uuid });
      if (!now || now.uuid !== before[r.uuid].uuid || now.created !== before[r.uuid].created || now.id !== before[r.uuid].id) kept = false;
      if (!now?.blocks.some((b) => b.id === r.id) && !heldKeys.has(`${r.uuid}#system.notes#${r.id}`)) stampedOrHeld = false;
    }
  }
  check("1: every place keeps its uuid, creation time and claim", kept);
  check("1: each row's block is stamped on its place, or listed held", stampedOrHeld);
  const pairRow = T.ax1.rows.find((r) => r.uuid && r.heldBy === "ax3" && r.stamped !== undefined);
  if (pairRow) {
    const n = await run(gm, P.countBlock, { uuid: pairRow.uuid, id: pairRow.id });
    check("1: an earlier book's row stands once on the place the later book took over (no second takeover)", n <= 1, { row: pairRow.id, count: n });
  }
  if (pregen) {
    const listed = listedAs(first.ax1, pregen.uuid);
    note("pregen as step 1 listed it", { listed, stampBefore: !!pregenBefore?.playStamp });
    check("1: the choice lists the character, changed (played or unstamped), so its default is restore", listed && listed.changed === true && (!!listed.unstamped === !pregenBefore?.playStamp), listed);
    const copyUuid = first.ax1.kept?.[0] ?? null;
    const copy = copyUuid ? await run(gm, P.read, { uuid: copyUuid }) : null;
    const original = await run(gm, P.read, { uuid: pregen.uuid });
    check("1: restore counts one, and keeps the character under a new id with no claim, no play stamp, and its origin recorded", first.ax1.restored === 1 && first.ax1.pregenRefused === 0 && !!copy && copy.uuid !== pregen.uuid && copy.id === null && copy.playStamp === null && copy.keptFrom?.uuid === pregen.uuid, { restored: first.ax1.restored, refused: first.ax1.pregenRefused, copy: !!copy, keptFrom: copy?.keptFrom?.uuid === pregen.uuid });
    check("1: the book's character stands again under its own uuid, freshly made and stamped", !!original && original.id === pregen.id && !!original.playStamp && original.created !== pregenBefore?.created, { id: original?.id === pregen.id, stamp: !!original?.playStamp, fresh: original?.created !== pregenBefore?.created });
  }

  section("Step 2: this run's edits are held; the character edited and rewritten");
  const after1 = {};
  for (const book of BOOKS) for (const r of T[book].rows.filter((r) => r.uuid)) after1[r.uuid] = await run(gm, P.read, { uuid: r.uuid });
  const stampedRows = (book) => T[book].rows.filter((r) => r.uuid && after1[r.uuid].blocks.some((b) => b.id === r.id));
  const mine = [];
  const edited = stampedRows("ax1").find((r) => r.heldBy === "ax3");
  if (edited) {
    const block = await run(gm, P.blockOf, { uuid: edited.uuid, id: edited.id });
    // A paragraph added inside the block: an earlier pair row's block may be its citation alone, with no plain <p> to edit.
    const touched = block.replace(/<\/div>$/, `${NOTE}</div>`);
    if (touched === block) throw new Error(`${edited.id}: its block on ${edited.uuid} is not a div, so no edit could be made`);
    undo.push({ uuid: edited.uuid, notes: after1[edited.uuid].notes, mark: NOTE });
    await run(gm, P.update, { uuid: edited.uuid, patch: { "system.notes": after1[edited.uuid].notes.replace(block, touched) } });
    mine.push({ book: "ax1", key: `${edited.uuid}#system.notes#${edited.id}`, uuid: edited.uuid, check: (d) => d.notes.includes(touched) });
  }
  const removed = stampedRows("ax3").find((r) => r.heldBy === "ax3" && r.place !== r.id);
  if (removed) {
    const block = await run(gm, P.blockOf, { uuid: removed.uuid, id: removed.id });
    undo.push({ uuid: removed.uuid, notes: after1[removed.uuid].notes, gone: `data-acks-entry="${removed.id}"` });
    await run(gm, P.update, { uuid: removed.uuid, patch: { "system.notes": after1[removed.uuid].notes.replace(block, "") } });
    mine.push({ book: "ax3", key: `${removed.uuid}#system.notes#${removed.id}`, uuid: removed.uuid, check: (d) => !d.notes.includes(`data-acks-entry="${removed.id}"`) });
  }
  if (pregen) {
    const p = await run(gm, P.read, { uuid: pregen.uuid });
    await run(gm, P.update, { uuid: pregen.uuid, patch: { "system.details.biography": `${p.bio ?? ""}${NOTE}` } });
    mine.push({ book: "ax1", key: `${pregen.uuid}#system.details.biography`, uuid: pregen.uuid, pregen: true, check: (d) => String(d.bio).includes(NOTE) });
  }
  note("step 2 edits made", mine.map((m) => m.key));
  const second = {};
  for (const book of [...BOOKS].reverse()) {
    second[book] = await repair(book, { pregens: book === "ax1" && pregen ? [[pregen.uuid, "rewrite"]] : [] });
    note(`${book} step 2`, { mode: second[book].mode, errors: second[book].errors, edits: second[book].edits?.length ?? null, rewritten: second[book].rewritten });
  }
  const listed = new Set(BOOKS.flatMap((b) => (second[b].edits ?? []).map((e) => e.key)));
  for (const m of mine) {
    const d = await run(gm, P.read, { uuid: m.uuid });
    check(`2: ${m.key.split("#").slice(1).join("#")} stands and is listed (${m.book})`, m.check(d) && listed.has(m.key),
      { stands: m.check(d), listed: listed.has(m.key), onThisDoc: [...listed].filter((k) => k.startsWith(`${m.uuid}#`)) });
  }
  const shapes = BOOKS.flatMap((b) => second[b].edits ?? []).filter((e) => mine.some((m) => m.key === e.key));
  check("2: each listed edit carries key, uuid, path, current, page and cite", shapes.length === mine.length && shapes.every((e) => e.key && e.uuid && e.path && e.hasCurrent && e.hasPage), shapes);
  check("2: a stamped edit carries no unstamped mark", shapes.every((e) => !e.unstamped));
  if (pregen) {
    const asListed = listedAs(second.ax1, pregen.uuid);
    check("2: the restored character, its biography edited since, is listed changed and stamped, so restore is offered", asListed?.changed === true && !asListed.unstamped, asListed);
    check("2: rewrite writes it once", second.ax1.rewritten === 1 && second.ax1.pregenRefused === 0, { rewritten: second.ax1.rewritten, refused: second.ax1.pregenRefused });
  }

  section("Steps 3-4: take one, then the rest of this run's");
  if (mine.length) {
    const [one, ...rest] = mine;
    const third = await repair(one.book, { take: [one.key], pregens: one.pregen ? [[pregen.uuid, "rewrite"]] : [] });
    const d = await run(gm, P.read, { uuid: one.uuid });
    check("3: the edit taken is the page's again and no longer listed", !one.check(d) && !(third.edits ?? []).some((e) => e.key === one.key),
      { stands: one.check(d), listed: (third.edits ?? []).some((e) => e.key === one.key), key: one.key });
    let fourthAx1 = one.book === "ax1" ? third : null;
    for (const book of BOOKS) {
      const mineHere = rest.filter((m) => m.book === book);
      if (!mineHere.length) continue;
      const answer = { take: mineHere.map((m) => m.key), pregens: mineHere.some((m) => m.pregen) ? [[pregen.uuid, "rewrite"]] : [] };
      const r = await repair(book, answer);
      if (book === "ax1") fourthAx1 = r;
    }
    if (pregen && fourthAx1) {
      const asListed = listedAs(fourthAx1, pregen.uuid);
      check("3-4: once rewritten, the character matches what was imported: listed unchanged, so leave is offered", asListed?.changed === false, asListed);
    }
    let restored = true;
    for (const m of rest) if (m.check(await run(gm, P.read, { uuid: m.uuid }))) restored = false;
    check("4: every edit this run made is the page's again", restored);
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  // Only where this run's own edit still stands: a place a repair already gave the page's text back is left as it is.
  for (const u of undo) {
    try {
      const d = gm ? await run(gm, P.read, { uuid: u.uuid }) : null;
      const stands = d && (u.mark ? d.notes.includes(u.mark) : !d.notes.includes(u.gone));
      if (stands) await run(gm, P.update, { uuid: u.uuid, patch: { "system.notes": u.notes } });
      note("edit undone", { uuid: u.uuid, stood: !!stands });
    } catch (err) { console.error("undo:", err?.message ?? err); }
  }
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
