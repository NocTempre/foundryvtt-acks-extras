/**
 * Live walk, importer-repair-pregen: docs/importer/TESTING.md, "A pregenerated
 * character imported before system 14.2.0, repaired" (T-0736). The 14.2.0
 * migration rewrote a character's stored `system` and its items' `system`, so a
 * play stamp recorded under 14.1.0 no longer matches a character nobody played.
 * This walk puts one pregenerated character of the book ax1 in that state and
 * runs the repair import over it, once for each answer the recipe names:
 * leave (step 1), rewrite (step 2), nothing answered (step 3) and restore
 * (step 4, with the fourth repair that reads it as matching), and watches the
 * GM seat's console from the first repair's start (step 5).
 *
 * The old stamp. The test world was never on 14.1.0, so the character's data is
 * the post-migration shape and only the STAMP is written by hand, as the recipe
 * says: the character's stored data is copied in page context, each `item`-type
 * item's quantity put back as the 14.1.0 object, each weapon's and armour's
 * quantity taken off (14.1.0 gave them none), and `held-edits.mjs` `playStamp`
 * is taken over that copy and written to `flags.acks-extras.playStamp`. The
 * character itself is not rewritten. A pregenerated character with no item,
 * weapon or armour row has the same stamp in both shapes and would make every
 * step unfalsifiable, so the walk chooses the first ax1 pregen whose old stamp
 * differs from its current one and is BLOCKED where there is none.
 *
 * Machine values arrive through ./_env.mjs; the book is connected from the
 * staged copy `ACKS_TEST_BOOKS` lists for `ax1` (BLOCKED without it). The
 * driver is `tools/live/importer-forced-places.mjs`'s repair, copied: a repair
 * fired into a global and polled, its confirm answered Yes and its choice
 * answered through `choose` with this run's one character given its answer
 * (everything else keeps its default).
 *
 * Fixture. The library character is a document the corpus import made, found by
 * its cookbook claim and never created or deleted by this walk. The recipe's
 * marker `importer/pregen-pre-14-2` (with `@<tag>` under `FIXTURE_OWN`) is put on
 * it by a page write and put back after a restore, which recreates the document;
 * `api.mark` is not used, because it tracks what it marks and the sweep would
 * delete the library's character. The one document this run creates, the copy a
 * restore keeps, is tracked from the repair's own result and swept alone by uuid.
 * The character ends stamped as the import left it. Every printed id is a cookbook
 * id or a uuid and every other print is a count or a boolean; no book word leaves
 * the page. A repair of ax1 also runs over the book's other documents with this
 * run's `choose` taking nothing, as the forced-places walk's repairs do.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOK = "ax1";
const MARKER = `importer/pregen-pre-14-2${MACHINE.own ? `@${MACHINE.own}` : ""}`;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__rpBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__rp = globalThis.__rp ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.HE = await import("/modules/acks-extras/scripts/importer/held-edits.mjs");
    return {
      user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null, boot: globalThis.__rpBoot ?? null,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__rp;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__rpBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__rpBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__rpBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__rpBook, open: !!globalThis.__rp.CB.cookbookSessionDoc(id) }),

  /** Every pregenerated character of the book in the library that no player owns, with whether its old stamp would differ from its current one. */
  pregens: async ({ book }) => {
    const H = globalThis.__rp;
    const cb = await fetch(`/modules/acks-extras/cookbook/${book}.json`).then((r) => r.json());
    const out = [];
    for (const [id, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind !== "kind.pregen" && e.meta?.actor !== "character") continue;
      const doc = await H.CB.importedActorFor(id, { copies: false });
      const players = Object.entries(doc?.ownership ?? {}).some(([u, l]) => u !== "default" && l >= 3 && !game.users.get(u)?.isGM);
      if (!doc || doc.getFlag("acks-extras", "cookbook")?.id !== id || players) continue;
      const data = doc.toObject();
      const types = {};
      for (const i of data.items ?? []) types[i.type] = (types[i.type] ?? 0) + 1;
      out.push({ id, uuid: doc.uuid, items: (data.items ?? []).length, types, differs: H.HE.playStamp(data) !== H.HE.playStamp(oldShapeOf(data)), stamped: !!doc.getFlag("acks-extras", "playStamp") });
    }
    return out;

    /** A copy of the stored data in the 14.1.0 item shape: an item's quantity an object, a weapon's and an armour's quantity absent, money and bundles as stored. */
    function oldShapeOf(data) {
      const copy = foundry.utils.deepClone(data);
      for (const i of copy.items ?? []) {
        const q = i.system?.quantity;
        // quantity-shape-ok: the 14.1.0 stored shape, built in memory only to compute the stamp the import then recorded
        if (i.type === "item" && typeof q === "number") i.system.quantity = { value: q };
        else if (i.type === "weapon" || i.type === "armor") delete i.system.quantity;
      }
      return copy;
    }
  },

  /** Writes the old stamp (computed over the 14.1.0 shape of the character's current data) onto the character; answers both stamps and the write's time. */
  writeOld: async ({ uuid }) => {
    const H = globalThis.__rp;
    const doc = await fromUuid(uuid);
    const copy = foundry.utils.deepClone(doc.toObject());
    for (const i of copy.items ?? []) {
      const q = i.system?.quantity;
      // quantity-shape-ok: the 14.1.0 stored shape, built in memory only to compute the stamp the import then recorded
      if (i.type === "item" && typeof q === "number") i.system.quantity = { value: q };
      else if (i.type === "weapon" || i.type === "armor") delete i.system.quantity;
    }
    const old = H.HE.playStamp(copy);
    const now = H.HE.playStamp(doc.toObject());
    await doc.setFlag("acks-extras", "playStamp", old);
    return { old, now, differs: old !== now, stampNow: doc.getFlag("acks-extras", "playStamp"), modified: doc._stats?.modifiedTime ?? null };
  },

  /** Puts the stamp back to the one the data has now, as the import writes it, when a step left another standing; answers whether it moved. */
  restamp: async ({ uuid }) => {
    const H = globalThis.__rp;
    const doc = await fromUuid(uuid);
    if (!doc) return { found: false };
    const now = H.HE.playStamp(doc.toObject());
    if (doc.getFlag("acks-extras", "playStamp") === now) return { found: true, moved: false };
    await doc.setFlag("acks-extras", "playStamp", now);
    return { found: true, moved: true };
  },

  /** The marker on the character, unless another document carries it already. */
  mark: async ({ uuid, marker }) => {
    const doc = await fromUuid(uuid);
    const other = game.actors.filter((a) => a.flags?.world?.fixture === marker && a.uuid !== uuid).map((a) => a.uuid);
    if (other.length) return { marked: false, other };
    if (doc.flags?.world?.fixture !== marker) await doc.update({ "flags.world.fixture": marker });
    return { marked: true, other };
  },

  /** What a step compares: the claim, the stored stamp and the stamp the data now has, the items as a sorted multiset of name and type, and the times. */
  read: async ({ uuid }) => {
    const H = globalThis.__rp;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const flag = doc.getFlag("acks-extras", "cookbook") ?? {};
    const keys = [...doc.items].map((i) => `${i.name}\u0001${i.type}`).sort();
    return {
      uuid: doc.uuid, name: doc.name, id: flag.id ?? null, items: keys.length, keys,
      stamp: doc.getFlag("acks-extras", "playStamp") ?? null, nowStamp: H.HE.playStamp(doc.toObject()),
      modified: doc._stats?.modifiedTime ?? null, created: doc._stats?.createdTime ?? null,
      marker: doc.flags?.world?.fixture ?? null,
    };
  },

  /** What the importer's lang gives for the kept copy's name, and the default answer a repair offers for a listed character. */
  keptName: async ({ name }) => game.i18n.format("ACKS-IMPORTER.ui.repairMergedPregenKeptName", { name }),
  defaultOf: async ({ changed, unstamped }) => globalThis.__rp.HE.pregenDefault({ changed, unstamped }),

  /**
   * A repair fired into a global (the hidden page's timers make a long await outlast one call), its confirm
   * answered yes and its choice answered as the Judge's dialog answers: each character in `pregens` given its
   * answer, every edit kept and everything else left.
   */
  repair: async ({ book, pregens = [] }) => {
    const R = (globalThis.__rpRun = { done: false, chosen: null });
    const choose = async (edits, more) => {
      R.chosen = { edits: edits.length, pregens: (more?.pregens ?? []).map((p) => ({ uuid: p.uuid, changed: p.changed, unstamped: !!p.unstamped })) };
      return { take: new Set(), pregens: new Map(pregens) };
    };
    acksExtras.importer.cookbookReimportAdventure(book, { ask: async () => true, choose })
      .then((r) => Object.assign(R, {
        done: true, mode: r?.mode ?? null, errors: (r?.errors ?? []).length,
        restored: r?.restored ?? null, rewritten: r?.rewritten ?? null, pregenRefused: r?.pregenRefused ?? null, kept: r?.kept ?? [],
      }))
      .catch((e) => Object.assign(R, { done: true, error: String(e?.message ?? e) }));
    return true;
  },
  repairState: async () => globalThis.__rpRun ?? { done: false },

  /** The boot recorder's errors from index `from`, and its length. */
  errorsFrom: async ({ from }) => {
    const e = globalThis.__rpBoot?.errors ?? [];
    return { total: e.length, since: e.slice(from) };
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
/** Reloads the seat's page with the recorder armed before its first script, and answers the seconds until it is ready again. */
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

let gm = null;
/** The library character this run drives, once chosen: its stamp is put back as the import left it if a step dies with the old one written. */
let chosenUuid = null;
/** The copies a restore kept, tracked from the repair's result and swept alone at the end. Only a step that answered `restore` makes one: a character the run's `choose` does not name is left (`pregenAnswer`). */
const kept = [];
/** One repair of the book, answered as `pregens` says; every copy a restore kept is tracked at once. */
async function repair(pregens = [], minutes = 8) {
  await run(gm, P.repair, { book: BOOK, pregens });
  const t0 = Date.now();
  for (;;) {
    const s = await run(gm, P.repairState);
    if (s.done) {
      for (const uuid of s.kept ?? []) { gm.track(uuid, "Actor"); kept.push(uuid); }
      return s;
    }
    if (Date.now() - t0 > minutes * 60_000) throw new Error(`the repair of ${BOOK} did not finish in ${minutes} min`);
    await sleep(3000);
  }
}
const listedAs = (r, uuid) => r?.chosen?.pregens.find((p) => p.uuid === uuid) ?? null;
const sameKeys = (a, b) => !!a && !!b && a.length === b.length && a.every((k, i) => k === b[i]);

const WALL_MS = Number(process.env.WALK_WALL_MS ?? 2_400_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat and book");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, gm));
  const installed = await run(gm, P.install);
  note("installed", { user: installed.user, module: installed.module });
  if (!installed.isGM || !installed.activeGMIsSelf) blocked("another client is the active GM; the repair would run there");
  const staged = books([BOOK]);
  if (!staged.length) blocked(`ACKS_TEST_BOOKS names no path for ${BOOK}`);
  note(`connect ${BOOK}`, await run(gm, P.connectBook, staged[0]));
  let s = await run(gm, P.bookState, { id: BOOK });
  for (let n = 0; n < 120 && !s.open && !(s.done && !s.ok); n++) { await sleep(2000); s = await run(gm, P.bookState, { id: BOOK }); }
  check(`${BOOK} is open on the GM seat`, s.open, s);
  if (!s.open) blocked(`${BOOK} did not open on the GM seat`);

  section("fixture: a pregenerated character in the pre-14.2.0 state");
  const all = await run(gm, P.pregens, { book: BOOK });
  note("pregenerated characters no player owns", { n: all.length, differ: all.filter((p) => p.differs).length, withItems: all.filter((p) => p.items > 0).length });
  if (!all.length) blocked(`the library holds no ${BOOK} pregenerated character that no player owns: the book's characters are not imported in this world, or every one is a player's`);
  const pregen = all.find((p) => p.differs) ?? null;
  if (!pregen) blocked("no ax1 pregenerated character that no player owns holds an item, weapon or armour row whose 14.1.0 shape differs from its stored one: the old stamp would equal the current and every step would be unfalsifiable");
  note("chosen", { id: pregen.id, uuid: pregen.uuid, items: pregen.items, types: pregen.types });
  chosenUuid = pregen.uuid;
  const markedFirst = await run(gm, P.mark, { uuid: pregen.uuid, marker: MARKER });
  note(`marker ${MARKER}`, markedFirst);
  const start = await run(gm, P.read, { uuid: pregen.uuid });
  let oldWrite = await run(gm, P.writeOld, { uuid: pregen.uuid });
  check("the old stamp (the 14.1.0 shape's) differs from the stamp the character's data has now, and is written", oldWrite.differs && oldWrite.stampNow === oldWrite.old, { differs: oldWrite.differs, written: oldWrite.stampNow === oldWrite.old });
  const written = await run(gm, P.read, { uuid: pregen.uuid });
  const nameBefore = written.name;
  const bootMark = (await run(gm, P.errorsFrom, { from: 0 })).total;

  section("Step 1: repair, the character answered leave");
  const one = await repair([[pregen.uuid, "leave"]]);
  note("step 1", { mode: one.mode, errors: one.errors, restored: one.restored, rewritten: one.rewritten, listed: listedAs(one, pregen.uuid) });
  check("1: the repair ran as a merged repair", one.mode === "repair" && !one.error, one.error ?? null);
  const listed1 = listedAs(one, pregen.uuid);
  check("1: the choice lists the character changed and stamped (not unstamped)", !!listed1 && listed1.changed === true && listed1.unstamped === false, listed1);
  const def1 = listed1 ? await run(gm, P.defaultOf, listed1) : null;
  check("1: the default the repair offers for it is restore", def1 === "restore", def1);
  const after1 = await run(gm, P.read, { uuid: pregen.uuid });
  check("1: with leave nothing moved on it: its modified time and its stamp are the old stamp's write", !!after1 && after1.modified === written.modified && after1.stamp === oldWrite.old && after1.uuid === start.uuid, { modified: after1?.modified === written.modified, stamp: after1?.stamp === oldWrite.old });
  check("1: leave restored nothing and rewrote nothing, and kept no copy", one.restored === 0 && one.rewritten === 0 && !(one.kept ?? []).length, { restored: one.restored, rewritten: one.rewritten, kept: (one.kept ?? []).length });

  section("Step 2: repair again, the character answered rewrite");
  const two = await repair([[pregen.uuid, "rewrite"]]);
  note("step 2", { mode: two.mode, errors: two.errors, restored: two.restored, rewritten: two.rewritten, refused: two.pregenRefused });
  check("2: rewritten is 1 and pregenRefused 0", two.rewritten === 1 && two.pregenRefused === 0, { rewritten: two.rewritten, refused: two.pregenRefused });
  const after2 = await run(gm, P.read, { uuid: pregen.uuid });
  check("2: the character keeps its uuid and its claim", !!after2 && after2.uuid === pregen.uuid && after2.id === pregen.id, { uuid: after2?.uuid === pregen.uuid, claim: after2?.id === pregen.id });
  check("2: it holds each item once: the same items as before, no twin", !!after2 && sameKeys(after2.keys, written.keys), { before: written.items, after: after2?.items });
  check("2: its stamp is written again: it is no longer the old stamp and it matches the data as stored", !!after2 && after2.stamp !== oldWrite.old && after2.stamp === after2.nowStamp, { moved: after2?.stamp !== oldWrite.old, matches: after2?.stamp === after2?.nowStamp });

  section("Step 3: repair a third time, answering nothing");
  const three = await repair([]);
  const listed3 = listedAs(three, pregen.uuid);
  note("step 3", { mode: three.mode, listed: listed3 });
  const def3 = listed3 ? await run(gm, P.defaultOf, listed3) : null;
  check("3: the character is listed changed:false", !!listed3 && listed3.changed === false, listed3);
  check("3: its default is leave", def3 === "leave", def3);

  section("Step 4: the old stamp written again, the repair answered restore");
  oldWrite = await run(gm, P.writeOld, { uuid: pregen.uuid });
  check("4: the old stamp is written again and still differs from the stored data's", oldWrite.differs && oldWrite.stampNow === oldWrite.old, { differs: oldWrite.differs });
  const before4 = await run(gm, P.read, { uuid: pregen.uuid });
  const four = await repair([[pregen.uuid, "restore"]]);
  note("step 4", { mode: four.mode, errors: four.errors, restored: four.restored, refused: four.pregenRefused, kept: four.kept });
  check("4: restored is 1", four.restored === 1 && four.pregenRefused === 0, { restored: four.restored, refused: four.pregenRefused });
  const copyUuid = four.kept?.[0] ?? null;
  const copy = copyUuid ? await run(gm, P.read, { uuid: copyUuid }) : null;
  const keptName = await run(gm, P.keptName, { name: nameBefore });
  check("4: one (kept) copy stands, named by the importer's kept-name string, with no cookbook claim and no stamp", (four.kept ?? []).length === 1 && !!copy && copy.uuid !== pregen.uuid && copy.id === null && copy.stamp === null && copy.name === keptName, { copies: (four.kept ?? []).length, claim: copy?.id ?? null, stamp: copy?.stamp ?? null, named: copy?.name === keptName });
  const after4 = await run(gm, P.read, { uuid: pregen.uuid });
  check("4: the book's character stands under its own uuid, stamped, under its claim", !!after4 && after4.uuid === pregen.uuid && after4.id === pregen.id && !!after4.stamp && after4.stamp !== oldWrite.old, { uuid: after4?.uuid === pregen.uuid, claim: after4?.id === pregen.id, stamped: !!after4?.stamp, notOld: after4?.stamp !== oldWrite.old });
  note("the character was recreated (created time moved)", { moved: after4?.created !== before4?.created });
  note(`marker again ${MARKER}`, await run(gm, P.mark, { uuid: pregen.uuid, marker: MARKER }));
  const five = await repair([]);
  const listed5 = listedAs(five, pregen.uuid);
  check("4: a fourth repair lists the character changed:false", !!listed5 && listed5.changed === false, listed5);

  section("Step 5: the GM seat's console from the first repair's start");
  const errs = await run(gm, P.errorsFrom, { from: bootMark });
  check("5: no console error, throw or rejection on the GM seat since the first repair started (the recorder was armed before the page's first script)", errs.since.length === 0, errs.since.map((e) => ({ phase: e.phase, kind: e.kind, text: e.text })));
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
  }
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (gm && chosenUuid) note("stamp put back as the import leaves it (gm)", await run(gm, P.restamp, { uuid: chosenUuid }));
  } catch (err) { console.error("restamp gm:", err?.message ?? err); }
  try {
    if (gm && kept.length) {
      const sw = await gm.sweepTracked({ only: kept });
      note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
}
