/**
 * Live walk, importer-everything: the import manager's Import tab, its bar of
 * Import everything and Repair everything. Walks docs/importer/TESTING.md,
 * "The import manager", step 3: Repair everything pressed opens the one merged
 * repair's confirm, read and answered No by its own button, with a
 * create/update/delete observer armed and the world's compendium list read
 * before and after. Import everything is found and not pressed: it runs the
 * chain, which writes. A Yes repairs the whole library and
 * puts every held edit of the corpus to the choice; the merged repair's Yes
 * is walked over one book in importer-force-repair, and is not pressed here.
 * Machine values arrive through ./_env.mjs; the books the shelf opens on join
 * are the books the confirm lists.
 *
 * Fixtures: none. The walk reads the world and writes nothing; every check
 * that something was not written is the observer's. Every figure printed is a
 * count or a boolean; no book word leaves the page.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name).replaceAll("\\", "/");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__ieBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__ie = globalThis.__ie ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
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
    H.dialogs = () => [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered);
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
    if (!H.observer) {
      H.writes = [];
      H.observer = {};
      for (const doc of ["Actor", "Item", "RollTable", "JournalEntry", "Scene", "Adventure", "Macro", "Folder"]) {
        for (const verb of ["create", "update", "delete"]) {
          const hook = `${verb}${doc}`;
          H.observer[hook] = Hooks.on(hook, (d) => { if (H.observing) H.writes.push({ hook, uuid: d?.uuid ?? null }); });
        }
      }
    }
    const api = acksExtras.importer;
    return {
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      books: H.CB.reimportableBooks().length,
      adventures: (await H.CB.adventureBooks?.())?.length ?? null,
      open: Object.keys(api.BOOKS).filter((id) => api.bookOpen(id)).length,
      boot: globalThis.__ieBoot ?? null,
    };
  },
  observe: async ({ on }) => {
    const H = globalThis.__ie;
    if (on) H.writes = [];
    H.observing = !!on;
    return H.writes;
  },
  packs: async () => game.packs.map((p) => p.collection).sort(),
  /** The manager on its Import tab, and what its bar holds. */
  importTab: async () => {
    const H = globalThis.__ie;
    const BAR = "section[data-tab='import'] .acks-extras-importer-manager-bar";
    const app = acksExtras.importer.openImportManager({ tab: "import" });
    await H.poll(() => app.rendered && app.tabGroups?.primary === "import" && H.root(app)?.querySelector(BAR));
    await H.sleep(300);
    const bar = H.root(app)?.querySelector(BAR);
    const buttons = [...(bar?.querySelectorAll("button") ?? [])];
    return {
      bar: !!bar,
      actions: buttons.map((b) => b.dataset.action),
      labelled: buttons.every((b) => b.textContent.trim().length > 0),
      selects: H.root(app).querySelectorAll("section[data-tab='import'] select, section[data-tab='rebuild'] select:not([name='pick'])").length,
      ids: H.root(app).querySelectorAll(".acks-extras-importer-manager-body [id]").length,
    };
  },
  /**
   * Repair everything pressed. Returns at once: the asking pass can outlast one
   * evaluation, so `confirmOf` waits for its confirm in rounds.
   */
  press: async () => {
    const H = globalThis.__ie;
    H.notes.splice(0);
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const root = H.root(app);
    H.pressed = {
      before: H.dialogs().map((a) => a.id),
      at: performance.now(),
      parts: H.CB.reimportableBooks().length + ((await H.CB.adventureBooks?.())?.length ?? 0),
    };
    root.querySelector("section[data-tab='import'] button[data-action='repairAll']").click();
    return true;
  },
  /**
   * The journals, keyed-places and maps steps narrowed to a book no seat holds open, as a book's
   * rebuild narrows them: each has nothing to write, and the notices raised meanwhile are counted.
   */
  quietSteps: async () => {
    const H = globalThis.__ie;
    const api = acksExtras.importer;
    const said = H.notes.length;
    const only = { books: ["qa-no-such-book"] };
    const results = [await api.cookbookImportJournals(only), await api.cookbookImportPoiPlaces(only), await api.cookbookImportScenes(only)];
    return { results, notes: H.notes.slice(said) };
  },
  /** One round of waiting for the press's confirm; `{waiting: true}` until it stands, then what it shows. */
  confirmOf: async () => {
    const H = globalThis.__ie;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const { before, at, parts: offered } = H.pressed;
    const dlg = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 240 });
    if (!dlg) return H.root(app)?.querySelector(".acks-extras-importer-manager-busy") ? { waiting: true, seconds: Math.round((performance.now() - at) / 1000) } : { dialog: null, notes: H.notes.map((n) => n.kind) };
    const seconds = Math.round((performance.now() - at) / 1000);
    await H.poll(() => H.root(app)?.querySelector(".acks-extras-importer-manager-busy"), { tries: 20 });
    await H.sleep(300);
    const text = (H.root(dlg).querySelector(".dialog-content, .window-content")?.textContent ?? "").replace(/\s+/g, " ").trim();
    // The count is read off the opening line, which states it; a part's own lines may carry bold too.
    const [head, tail] = game.i18n.format("ACKS-IMPORTER.ui.repairMergedEverything", { n: "\u0000" }).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().split("\u0000");
    const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = Number(text.match(new RegExp(`^${quote(head)}(\\d+)${quote(tail.slice(0, 12))}`))?.[1] ?? 0);
    const opening = game.i18n.format("ACKS-IMPORTER.ui.repairMergedEverything", { n: parts }).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const closing = game.i18n.localize("ACKS-IMPORTER.ui.everythingClosed").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const title = dlg.options?.window?.title ?? "";
    // The confirm stands inside the manager's frame, below the bar, for the plate.
    const r = H.root(app).getBoundingClientRect();
    const bar = H.root(app).querySelector("section[data-tab='import'] .acks-extras-importer-manager-bar")?.getBoundingClientRect();
    // Held to the frame's floor too: a confirm taller than the space left is pushed up over the bar.
    const top = Math.round((bar?.bottom ?? r.top + 150) + 12);
    dlg.setPosition({ left: Math.round(r.left + 40), top, width: Math.min(560, Math.round(r.width - 80)), height: Math.max(240, Math.round(r.bottom - top - 16)) });
    await H.sleep(400);
    return {
      dialog: dlg.id,
      parts,
      offered,
      seconds,
      opens: text.startsWith(opening.slice(0, 30)),
      closes: text.includes(closing.slice(0, 30)),
      title: title === game.i18n.localize("ACKS-IMPORTER.ui.repairMergedTitle"),
      dialogs: H.dialogs().filter((a) => !before.includes(a.id)).length,
    };
  },
  /** The open confirm answered No by its own button; what landed after. */
  no: async ({ dialog }) => {
    const H = globalThis.__ie;
    const dlg = foundry.applications.instances.get(dialog);
    H.root(dlg).querySelector("button[data-action='no']").click();
    await H.poll(() => !dlg.rendered);
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    await H.poll(() => !H.root(app)?.querySelector(".acks-extras-importer-manager-busy"), { tries: 40 });
    await H.sleep(1500);
    return {
      closed: !dlg.rendered,
      idle: !H.root(app)?.querySelector(".acks-extras-importer-manager-busy"),
      notes: H.notes.filter((n) => n.kind !== "info").map((n) => n.kind),
    };
  },
  closeManager: async () => {
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    if (app) await app.close({ animate: false });
    return !foundry.applications.instances.get("acks-extras-import-manager")?.rendered;
  },
  restore: async () => {
    const H = globalThis.__ie;
    if (!H) return { notes: "never installed" };
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    if (H.observer) { for (const [hook, id] of Object.entries(H.observer)) Hooks.off(hook, id); H.observer = null; }
    for (const app of H.dialogs()) await app.close({ animate: false }).catch(() => null);
    return { notes: "restored" };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.openImportManager`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
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
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, gm));
  // The shelf's books open after ready; the walk waits for the first to be read as open.
  let installed = await run(gm, P.install);
  for (let n = 0; n < 30 && !installed.books; n++) { await sleep(3000); installed = await run(gm, P.install); }
  note("installed", { module: installed.module, books: installed.books, adventures: installed.adventures, open: installed.open });
  check("the seat is the active GM with at least one book open", installed.isGM && installed.activeGMIsSelf && installed.books > 0, { books: installed.books });
  if (!installed.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  check("no error from load through ready", installed.boot?.phases.length === 3 && !installed.boot.errors.length, installed.boot);

  section("The Import tab's bar (step 3)");
  await gm.compose();
  const tab = await run(gm, P.importTab);
  note("import tab", tab);
  check("3: the bar holds Import everything then Repair everything, each with a label, and no other control", tab.bar && same(tab.actions, ["importAll", "repairAll"]) && tab.labelled, tab.actions);
  check("3: no mode select on the Import or Rebuild tab", tab.selects === 0, tab.selects);
  check("3: no id inside the body", tab.ids === 0, tab.ids);

  section("A step with nothing to write (step 3)");
  const quiet = await run(gm, P.quietSteps);
  check("3: narrowed to a book with nothing of theirs, the journals, keyed-places and maps steps resolve null and raise no notice", quiet.results.every((r) => r === null) && quiet.notes.length === 0, quiet);

  const packsBefore = await run(gm, P.packs);
  section("Repair everything, answered No (step 3)");
  await run(gm, P.observe, { on: true });
  await run(gm, P.press);
  let asked = { waiting: true };
  for (let round = 0; asked.waiting && round < 10; round++) asked = await run(gm, P.confirmOf);
  note("confirm", { found: !!asked.dialog, seconds: asked.seconds, parts: asked.parts, offered: asked.offered, title: asked.title, opens: asked.opens, closes: asked.closes, dialogs: asked.dialogs });
  check("3: ONE confirm, the merged repair's, opening on its count of parts and closing on what is not touched", !!asked.dialog && asked.dialogs === 1 && asked.title && asked.opens && asked.closes && asked.parts > 0, asked);
  check("3: no more parts than the open books and adventure books offer", asked.parts > 0 && asked.parts <= asked.offered, { parts: asked.parts, offered: asked.offered });
  if (process.env.SHOTS === "1" && asked.dialog) {
    note("plate", await gm.shot(plate("importer-repair-everything.png"), "#acks-extras-import-manager"));
  }
  if (asked.dialog) {
    const after = await run(gm, P.no, { dialog: asked.dialog });
    const writes = await run(gm, P.observe, { on: false });
    note("No", { closed: after.closed, idle: after.idle, warnings: after.notes.length, writes: writes.length });
    check("3: answered No, the observer holds nothing and nothing warned", after.closed && writes.length === 0 && after.notes.length === 0, { writes: writes.slice(0, 5), notes: after.notes });
    check("3: the window is idle again", after.idle, { idle: after.idle });
  } else {
    await run(gm, P.observe, { on: false });
  }
  const packsAfter = await run(gm, P.packs);
  check("3: no compendium was made or removed", same(packsBefore, packsAfter), { before: packsBefore.length, after: packsAfter.length });
  await run(gm, P.closeManager);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
