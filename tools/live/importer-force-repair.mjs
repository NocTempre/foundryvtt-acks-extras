/**
 * Live walk, importer-force-repair: the import manager's Books tab, Force
 * repair, the Adventures tab's Force repair, overhead token art and Make
 * Encounter on a wildcard token. Walks docs/importer/TESTING.md:
 *   - "The import manager", steps 1 and 2 (the Books tab as the first tab, and
 *     the Player seat seeing it alone), with "The Books tab"'s panel;
 *   - "Repair in place", step 9 (a forced repair over a Judge's description,
 *     its confirm answered No then Yes) on the run's own items of the book
 *     `cat`, and step 10's confirms (no shelf rebuild only, every kind's count)
 *     answered No;
 *   - "An adventure book's Force repair", steps 1 and 3, answered No;
 *   - "Overhead token art from an installed compendium", steps 1, 4 (Make
 *     Encounter from a wildcard monster) and 8.
 * Machine values arrive through ./_env.mjs; `cat` must be open on the GM seat
 * (the shelf opens it on join).
 *
 * Fixtures: `importer/token-art-wildcard`, a monster with a portrait and a
 * wildcard token, kept. The book's items are imported by this run where the
 * world lacks them and tracked (the typography and item-repair walks sweep
 * theirs, so the library holds none between runs); where the world already
 * holds them under another hand the walk stops, since those are read, never
 * driven. Every confirm is the real dialog, read and answered by its own
 * buttons; a No path is proved by a create/update/delete observer that holds
 * nothing. A Yes is pressed only over the run's own items. The group Make
 * Encounter builds is tracked. Teardown sweeps the ledger and empties a shelf
 * this run opened. Every id printed is a cookbook id or a uuid; no book word
 * leaves the page.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, ROOT, logDir, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = "cat";
const NOTE = "<p>Judge note.</p>";
const PORTRAIT = "icons/svg/mystery-man.svg";
const WILDCARD = "icons/svg/*.svg";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name).replaceAll("\\", "/");

/** The book's item ids, read off the shipped cookbook. */
function itemIds() {
  const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", `${BOOK}.json`), "utf8"));
  return Object.entries(cb.entries ?? {}).filter(([, e]) => e.kind === "kind.adventureItem").map(([id]) => id);
}

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__frBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__fr = globalThis.__fr ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.RF = await import("/modules/acks-extras/scripts/importer/refresh.mjs");
    H.TA = await import("/modules/acks-extras/scripts/importer/token-art.mjs");
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
      for (const doc of ["Actor", "Item", "RollTable", "JournalEntry", "Scene", "Adventure"]) {
        for (const verb of ["create", "update", "delete"]) {
          const hook = `${verb}${doc}`;
          H.observer[hook] = Hooks.on(hook, (d) => { if (H.observing) H.writes.push({ hook, uuid: d?.uuid ?? null }); });
        }
      }
    }
    return {
      user: game.user.name, isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      open: !!acksExtras.importer.bookOpen?.("cat"),
      boot: globalThis.__frBoot ?? null,
    };
  },
  observe: async ({ on }) => {
    const H = globalThis.__fr;
    if (on) H.writes = [];
    H.observing = !!on;
    return H.writes;
  },
  packs: async () => game.packs.filter((p) => p.metadata.packageType === "world").map((p) => p.collection),
  held: async ({ ids }) => {
    const out = {};
    for (const id of ids) out[id] = (await globalThis.__fr.CB.importedItemFor(id))?.uuid ?? null;
    return out;
  },
  importItems: async () => {
    globalThis.__fr.notes.splice(0);
    const r = await acksExtras.importer.cookbookImportAdventureItems({ books: ["cat"] });
    return { result: r };
  },
  /** The fields this walk compares, and whether a Judge wrote in the description. */
  shape: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const html = String(doc.system?.description ?? "");
    return {
      id: doc.id, folder: doc.folder?.id ?? null, ownership: doc.ownership ?? null,
      modified: doc._stats?.modifiedTime ?? null, quantity: doc.system?.quantity?.value ?? null,
      cost: doc.system?.cost ?? null, textLength: html.length, judged: globalThis.__fr.RF.handWrittenProse(html),
    };
  },
  /** A Judge's hand: a note on the description, a quantity, an owner, and a binder field scrambled. */
  edit: async ({ uuid, note, playerName }) => {
    const doc = await fromUuid(uuid);
    const player = game.users.getName(playerName);
    await doc.update({
      "system.description": `${doc.system.description ?? ""}${note}`,
      "system.quantity.value": 3,
      "system.cost": 0,
      [`ownership.${player.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
    });
    return true;
  },
  /** Answer the newest dialog opened since `before`, reading what it says first. */
  answer: async ({ before, yes, expect }) => {
    const H = globalThis.__fr;
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")));
    if (!app) return { found: false, open: H.dialogs().map((a) => a.options?.window?.title ?? a.id) };
    const root = H.root(app);
    const text = (root.querySelector(".dialog-content, .window-content")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const title = app.options?.window?.title ?? "";
    const out = {
      found: true,
      forceTitle: title === game.i18n.localize("ACKS-IMPORTER.ui.forceTitle"),
      keeps: text.includes(game.i18n.localize("ACKS-IMPORTER.ui.forceKeeps").replace(/\s+/g, " ").slice(0, 40)),
      expected: expect ? text.includes(expect.replace(/\s+/g, " ")) : null,
      count: Number(text.match(/\d+/)?.[0] ?? NaN),
    };
    root.querySelector(`button[data-action='${yes ? "yes" : "no"}']`).click();
    await H.poll(() => !app.rendered);
    return out;
  },
  dialogIds: async () => globalThis.__fr.dialogs().map((a) => a.id),
  /** The entry picker, its rows for `ids` ticked, the mode chosen, Reimport pressed; the run is left in flight. */
  pickEntries: async ({ ids, mode }) => {
    const H = globalThis.__fr;
    H.notes.splice(0);
    const before = H.dialogs().map((a) => a.id);
    H.flight = acksExtras.importer.cookbookReimportEntries();
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector(".acks-extras-importer-mon-list")), { tries: 240 });
    if (!app) return { opened: false };
    const root = H.root(app);
    const modes = [...root.querySelectorAll("select[name='mode'] option")].map((o) => o.value);
    let ticked = 0;
    for (const id of ids) {
      const box = root.querySelector(`input[name='sel'][value='BookItems|${id}']`);
      if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); ticked++; }
    }
    root.querySelector("select[name='mode']").value = mode;
    const dialogsBefore = H.dialogs().map((a) => a.id);
    root.querySelector("button[data-action='ok']").click();
    return { opened: true, modes, ticked, before: dialogsBefore };
  },
  flight: async () => {
    const H = globalThis.__fr;
    const r = await H.flight;
    // A prompt whose callback answers null resolves with the button's action string: no run's result.
    return { result: r && typeof r === "object" ? r : null, notes: H.notes.map((n) => n.text) };
  },
  expected: async ({ key, data }) => game.i18n.format(key, data),
  /** The Reimport One Shelf dialog: its mode options and which shelves still say rebuild only. */
  shelfDialog: async () => {
    const H = globalThis.__fr;
    const before = H.dialogs().map((a) => a.id);
    acksExtras.importer.cookbookReimportShelf();
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("select[name='pick']")));
    if (!app) return null;
    const root = H.root(app);
    const tag = `(${game.i18n.localize("ACKS-IMPORTER.ui.reimportRebuildOnly")})`;
    const out = {
      modes: [...root.querySelectorAll("select[name='mode'] option")].map((o) => o.value),
      selected: root.querySelector("select[name='mode']").value,
      rebuildOnly: [...root.querySelectorAll("select[name='pick'] option")].filter((o) => o.textContent.endsWith(tag)).map((o) => o.value),
      shelves: [...root.querySelectorAll("select[name='pick'] option")].map((o) => o.value).filter((v) => v.startsWith("shelf:")),
    };
    await app.close({ animate: false });
    return out;
  },
  /** A shelf force-repaired, left in flight for `answer`. */
  forceShelf: async ({ shelf }) => {
    const H = globalThis.__fr;
    H.notes.splice(0);
    const before = H.dialogs().map((a) => a.id);
    H.flight = acksExtras.importer.cookbookReimportShelf(shelf, { mode: "force" });
    return before;
  },
  /** The import manager, opened as the macro opens it, with what its strip and panel hold. */
  manager: async ({ tab }) => {
    const H = globalThis.__fr;
    const app = acksExtras.importer.openImportManager(tab ? { tab } : {});
    await H.poll(() => app.rendered && H.root(app)?.querySelector(".acks-extras-importer-books") && (!tab || app.tabGroups?.primary === (game.user.isGM ? tab : "books")));
    await H.sleep(300);
    const root = H.root(app);
    const panel = root?.querySelector(".acks-extras-importer-books");
    const rows = [...(panel?.querySelectorAll("[data-row]") ?? [])];
    const openRows = rows.filter((r) => r.classList.contains("acks-extras-importer-reconnect-done")).map((r) => r.dataset.row);
    const body = root?.querySelector(".acks-extras-importer-manager-body");
    return {
      id: app.id,
      rendered: app.rendered,
      strip: [...(root?.querySelectorAll(".acks-extras-importer-manager-tabs [data-tab]") ?? [])].map((a) => a.dataset.tab),
      sections: [...(root?.querySelectorAll(".acks-extras-importer-manager-body section.tab[data-tab]") ?? [])].map((s) => s.dataset.tab),
      active: app.tabGroups?.primary ?? null,
      panel: !!panel,
      bands: panel?.querySelectorAll(":scope section.acks-extras-importer-band, :scope > details.acks-extras-importer-gs").length ?? 0,
      select: !!panel?.querySelector("select"),
      rows: rows.length,
      books: Object.keys(acksExtras.importer.BOOKS).length,
      openRowsAgree: openRows.every((id) => acksExtras.importer.bookOpen(id)) && Object.keys(acksExtras.importer.BOOKS).filter((id) => acksExtras.importer.bookOpen(id)).length === openRows.length,
      addToServer: panel?.querySelectorAll("[data-shelve], [data-shelve-pick], [data-shelve-file]").length ?? 0,
      census: panel?.querySelectorAll("[data-adventure]").length ?? 0,
      scroller: body ? getComputedStyle(body).overflowY : null,
      ids: root ? root.querySelectorAll(".acks-extras-importer-manager-body [id]").length : null,
      tokenApply: root?.querySelectorAll("[data-action='tokenArtApply']").length ?? 0,
      tokenRestore: root?.querySelectorAll("[data-action='tokenArtRestore']").length ?? 0,
      modes: [...(root?.querySelectorAll("section[data-tab='rebuild'] select[name='mode'] option") ?? [])].map((o) => o.value),
      adventureRows: [...(root?.querySelectorAll("[data-action='adventureForce']") ?? [])].map((b) => b.dataset.book),
      instances: [...foundry.applications.instances.values()].filter((a) => a.id === "acks-extras-import-manager").length,
    };
  },
  closeManager: async () => {
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    if (app) await app.close({ animate: false });
    return !foundry.applications.instances.get("acks-extras-import-manager")?.rendered;
  },
  bookStatus: async () => {
    const H = globalThis.__fr;
    await acksExtras.importer.bookStatus();
    const app = await H.poll(() => { const a = foundry.applications.instances.get("acks-extras-import-manager"); return a?.rendered && a.tabGroups?.primary ? a : null; });
    return { opened: !!app, tab: app?.tabGroups?.primary ?? null };
  },
  /** The Rebuild tab driven as a Judge does: pick, mode, Go; the confirm is left open for the plate. */
  rebuildTab: async ({ pick, mode }) => {
    const H = globalThis.__fr;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    app.changeTab("rebuild", "primary");
    await H.sleep(300);
    const root = H.root(app);
    const form = root.querySelector("[data-rebuild-form]");
    const pickEl = form.querySelector("select[name='pick']");
    const has = [...pickEl.options].some((o) => o.value === pick);
    if (!has) return { has };
    // A user's choice reaches the form as a change event on each select.
    pickEl.value = pick;
    pickEl.dispatchEvent(new Event("change", { bubbles: true }));
    const modeEl = form.querySelector("select[name='mode']");
    modeEl.value = mode;
    modeEl.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(300);
    return { has, mode: form.querySelector("select[name='mode']").selectedOptions[0]?.value ?? null };
  },
  /** The Rebuild tab's Go pressed, as chosen; the confirm is left open, and what the redrawn form then reads. */
  rebuildGo: async () => {
    const H = globalThis.__fr;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const before = H.dialogs().map((a) => a.id);
    H.root(app).querySelector("[data-rebuild-form] button[data-action='rebuild']").click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")));
    if (!dlg) return { dialog: null };
    // The window redraws as the run starts; read the form once the busy line is up.
    await H.poll(() => H.root(app)?.querySelector(".acks-extras-importer-manager-busy"), { tries: 20 });
    await H.sleep(300);
    const form = H.root(app).querySelector("[data-rebuild-form]");
    // The confirm stands inside the manager's frame, below the form, for the plate.
    const r = H.root(app).getBoundingClientRect();
    dlg.setPosition({ left: Math.round(r.left + 40), top: Math.round(r.top + 230), width: Math.min(560, Math.round(r.width - 80)) });
    await H.sleep(400);
    return {
      dialog: dlg.id, before, title: dlg.options?.window?.title === game.i18n.localize("ACKS-IMPORTER.ui.forceTitle"),
      redrawn: { pick: form?.querySelector("select[name='pick']")?.value ?? null, mode: form?.querySelector("select[name='mode']")?.value ?? null },
    };
  },
  /** The Adventures tab's Force repair pressed on `book`; the confirm is left open. */
  adventureForce: async ({ book }) => {
    const H = globalThis.__fr;
    H.notes.splice(0);
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    app.changeTab("adventures", "primary");
    await H.sleep(300);
    const button = H.root(app).querySelector(`[data-action='adventureForce'][data-book='${book}']`);
    if (!button) return { button: false };
    const before = H.dialogs().map((a) => a.id);
    button.click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 240 });
    return { button: true, before, dialog: dlg?.id ?? null, tip: button.dataset.tooltip ?? null };
  },
  /** Token art: what the world offers, and whether any monster carries the mark. */
  tokenArt: async () => {
    const H = globalThis.__fr;
    const sources = await H.TA.tokenArtSources().catch((err) => ({ error: String(err?.message ?? err) }));
    const actorPacks = [...game.packs].filter((p) => p.documentName === "Actor" && p.metadata?.packageType === "module" && p.metadata.packageName !== "acks-extras");
    return {
      sources: Array.isArray(sources) ? sources.map((s) => s.id) : sources,
      foreignActorPacks: actorPacks.map((p) => ({ pkg: p.metadata.packageName, active: !!game.modules.get(p.metadata.packageName)?.active })),
      flagged: H.TA.hasTokenArtFlag(),
    };
  },
  /** A wildcard monster's sheet, Make Encounter pressed: the group it opened. */
  makeEncounter: async ({ actorId }) => {
    const H = globalThis.__fr;
    const actor = game.actors.get(actorId);
    const Cls = Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const app = new Cls({ document: actor });
    await app.render(true);
    await H.poll(() => H.root(app)?.querySelector(".acks-extras-frame"));
    const tool = H.root(app)?.querySelector("[data-action='makeEncounter']");
    const out = { tool: !!tool };
    if (tool) {
      const before = new Set(foundry.applications.instances.keys());
      tool.click();
      const fresh = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && a.document?.type === "acks-extras.group" && a.rendered));
      const group = fresh?.document ?? null;
      out.groupUuid = group?.uuid ?? null;
      out.img = group?.img ?? null;
      out.tokenSrc = group?.prototypeToken?.texture?.src ?? null;
      if (fresh) await fresh.close({ animate: false });
    }
    await app.close({ animate: false });
    return out;
  },
  restore: async () => {
    const H = globalThis.__fr;
    if (!H) return { notes: "never installed" };
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    if (H.observer) { for (const [hook, id] of Object.entries(H.observer)) Hooks.off(hook, id); H.observer = null; }
    for (const app of H.dialogs()) await app.close({ animate: false }).catch(() => null);
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.openImportManager`); } catch { ok = false; }
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let gm = null;
let player = null;
const openedPacks = [];
// What this run made and does not keep: its items and the group Make Encounter built. Kept fixtures stay.
const swept = [];
// A walk that hangs still closes its browsers, so the seats are free for the next one.
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seats");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  // The shelf's books open after ready; the install reads the book as open only once it has.
  let installed = await run(gm, P.install);
  for (let n = 0; n < 30 && !installed.open; n++) { await sleep(3000); installed = await run(gm, P.install); }
  const seated = await run(player, P.install);
  note("installed", { gm: { user: installed.user, module: installed.module, open: installed.open }, player: { user: seated.user, role: seated.role } });
  check("the GM seat is the active GM with the book open, and the player seat is a player", installed.isGM && installed.activeGMIsSelf && installed.open && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  if (!installed.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("The import manager: the Books tab first (steps 1, 2)");
  await gm.compose();
  const m = await run(gm, P.manager, { tab: null });
  note("manager (gm)", { strip: m.strip, active: m.active, rows: m.rows, books: m.books, bands: m.bands });
  check("1: one window, a strip of five with Books first, open on Books", same(m.strip, ["books", "import", "rebuild", "adventures", "tools"]) && m.active === "books" && m.instances === 1, { strip: m.strip, active: m.active });
  check("1: the body is the scroller and carries no id", m.scroller === "auto" && m.ids === 0, { scroller: m.scroller, ids: m.ids });
  check("Books tab: the panel stands in the tab, with no <select> in it", m.panel && !m.select, { panel: m.panel, select: m.select });
  check("2: one row per book the build reads, and the open rows are the books bookOpen answers", m.rows === m.books && m.openRowsAgree, { rows: m.rows, books: m.books });
  const again = await run(gm, P.manager, { tab: null });
  check("1: the macro run again raises the same window, not a second", again.instances === 1 && again.id === m.id);
  if (process.env.SHOTS === "1") {
    await gm.compose("#acks-extras-import-manager");
    note("plate", await gm.shot(plate("importer-books-tab.png"), "#acks-extras-import-manager"));
  }
  await run(gm, P.closeManager);
  const status = await run(gm, P.bookStatus);
  check("2: bookStatus() opens the manager on its Books tab", status.opened && status.tab === "books", status);
  await run(gm, P.closeManager);

  section("The import manager: the Player seat (step 2)");
  const pm = await run(player, P.manager, { tab: "tools" });
  note("manager (player)", { strip: pm.strip, sections: pm.sections, active: pm.active });
  check("2: a strip of ONE tab, Books, and no GM tab's section in the body", same(pm.strip, ["books"]) && same(pm.sections, ["books"]) && pm.active === "books", { strip: pm.strip, sections: pm.sections });
  check("2: openImportManager({tab: \"tools\"}) still lands on Books, with the panel", pm.panel && pm.active === "books");
  check("2: the panel carries no Add to server control and no census line", pm.addToServer === 0 && pm.census === 0, { add: pm.addToServer, census: pm.census });
  check("token art 8: no token-art control on the Player seat", pm.tokenApply === 0 && pm.tokenRestore === 0);
  await run(player, P.closeManager);
  const pstatus = await run(player, P.bookStatus);
  check("the Player seat's bookStatus() opens the same window on Books", pstatus.opened && pstatus.tab === "books", pstatus);
  await run(player, P.closeManager);

  section("Repair in place 9: the mode, the confirm, and a forced repair over the run's own items");
  const IDS = itemIds();
  const packsBefore = await run(gm, P.packs);
  const heldBefore = await run(gm, P.held, { ids: IDS });
  const theirs = Object.values(heldBefore).filter(Boolean);
  note("held before this run", { held: theirs.length, of: IDS.length });
  if (theirs.length) throw new Error("the world already holds the book's items under another hand; they are read, never driven (live-testing.md step 4)");
  const imported = await run(gm, P.importItems);
  note("items step", imported.result);
  const heldAfter = await run(gm, P.held, { ids: IDS });
  const mineIds = IDS.filter((id) => heldAfter[id]);
  const mine = mineIds.map((id) => heldAfter[id]);
  for (const u of mine) swept.push(gm.track(u, "Item"));
  for (const c of (await run(gm, P.packs)).filter((c) => !packsBefore.includes(c))) openedPacks.push(c);
  note("shelves opened by this run", openedPacks);
  check("setup: the items step imported every item of the book, all this run's own", mine.length === IDS.length && IDS.length > 0, { made: mine.length, of: IDS.length });
  const subject = mine[0];
  const fresh = await run(gm, P.shape, { uuid: subject });
  await run(gm, P.edit, { uuid: subject, note: NOTE, playerName: SEATS.player });
  const edited = await run(gm, P.shape, { uuid: subject });
  check("setup: the first item now carries a Judge's note, a quantity of 3 and an owner beside the default", edited.judged && edited.quantity === 3 && Object.keys(edited.ownership ?? {}).length >= 2 && edited.textLength > fresh.textLength, { judged: edited.judged, quantity: edited.quantity, owners: Object.keys(edited.ownership ?? {}).length });

  const shelfDlg = await run(gm, P.shelfDialog);
  note("Reimport One Shelf", shelfDlg);
  check("9: Reimport One Shelf's Mode reads three options, Rebuild chosen, Force repair third", same(shelfDlg?.modes, ["drop", "repair", "force"]) && shelfDlg.selected === "drop", shelfDlg?.modes);
  check("10: no shelf is marked rebuild only", shelfDlg && shelfDlg.rebuildOnly.length === 0, shelfDlg?.rebuildOnly);
  const tabModes = (await run(gm, P.manager, { tab: "rebuild" })).modes;
  check("9: the manager's Rebuild tab carries the same three", same(tabModes, ["drop", "repair", "force"]), tabModes);
  await run(gm, P.closeManager);

  // Force repair, answered No: the confirm counts, and nothing is written.
  await run(gm, P.observe, { on: true });
  let pick = await run(gm, P.pickEntries, { ids: mineIds, mode: "force" });
  check("9: the entry picker offers the three modes and ticks the run's items", same(pick.modes, ["drop", "repair", "force"]) && pick.ticked === mineIds.length, { modes: pick.modes, ticked: pick.ticked });
  let expectText = await run(gm, P.expected, { key: "ACKS-IMPORTER.ui.forceConfirmEntries", data: { n: mine.length, picked: mineIds.length } });
  let said = await run(gm, P.answer, { before: pick.before, yes: false, expect: expectText });
  let flight = await run(gm, P.flight);
  let writes = await run(gm, P.observe, { on: false });
  note("force, No", { said, writes: writes.length });
  check("9: a confirm titled Force repair in place counts the documents to rewrite and closes on what is still kept", said.found && said.forceTitle && said.expected && said.keeps && said.count === mine.length, said);
  const afterNo = await run(gm, P.shape, { uuid: subject });
  check("9: answered No, nothing is written: the note stands, modifiedTime has not moved, the observer holds nothing", afterNo.judged && afterNo.modified === edited.modified && writes.length === 0 && flight.result === null, { modified: afterNo.modified === edited.modified, writes: writes.length });

  // Repair in place, Yes: the note is kept.
  pick = await run(gm, P.pickEntries, { ids: mineIds, mode: "repair" });
  said = await run(gm, P.answer, { before: pick.before, yes: true });
  flight = await run(gm, P.flight);
  note("repair, Yes", { result: flight.result && { mode: flight.result.mode, replaced: flight.result.replaced, keptProse: flight.result.keptProse, refused: flight.result.refused } });
  const afterRepair = await run(gm, P.shape, { uuid: subject });
  check("Repair in place keeps the note and counts it kept, and puts the price back", flight.result?.mode === "repair" && flight.result.keptProse >= 1 && afterRepair.judged && afterRepair.cost === fresh.cost, { keptProse: flight.result?.keptProse, judged: afterRepair.judged, cost: afterRepair.cost === fresh.cost });

  // Force repair, Yes: the note goes; id, folder, owners and quantity stay.
  pick = await run(gm, P.pickEntries, { ids: mineIds, mode: "force" });
  said = await run(gm, P.answer, { before: pick.before, yes: true });
  flight = await run(gm, P.flight);
  note("force, Yes", { result: flight.result && { mode: flight.result.mode, replaced: flight.result.replaced, refused: flight.result.refused, handMade: flight.result.handMade } });
  const afterForce = await run(gm, P.shape, { uuid: subject });
  const doneText = flight.result ? await run(gm, P.expected, { key: "ACKS-IMPORTER.ui.forceDone", data: { replaced: flight.result.replaced, refused: flight.result.refused, handMade: flight.result.handMade } }) : null;
  check("9: the notice reads Force-repaired in place, with no kept count", flight.result?.mode === "force" && flight.result.replaced >= 1 && flight.notes.includes(doneText), { replaced: flight.result?.replaced, noticed: flight.notes.includes(doneText) });
  check("9: the Judge's description is replaced: the build's text again, the note gone", !afterForce.judged && afterForce.textLength === fresh.textLength, { judged: afterForce.judged, textLength: afterForce.textLength === fresh.textLength });
  check("9: the document keeps its id, folder and owners (read back)", afterForce.id === edited.id && afterForce.folder === edited.folder && same(afterForce.ownership, edited.ownership), { id: afterForce.id === edited.id, folder: afterForce.folder === edited.folder, owners: same(afterForce.ownership, edited.ownership) });
  check("9: what play set is kept: the quantity is still 3", afterForce.quantity === 3, afterForce.quantity);

  section("Repair in place 10: every kind's confirm counts, answered No");
  for (const shelf of ["Weapons", "Armor", "Languages", "Races"]) {
    if (!shelfDlg?.shelves.includes(`shelf:${shelf}`)) { check(`10: ${shelf} is offered as a shelf`, false, shelfDlg?.shelves); continue; }
    await run(gm, P.observe, { on: true });
    const before = await run(gm, P.forceShelf, { shelf });
    const asked = await run(gm, P.answer, { before, yes: false });
    const done = await run(gm, P.flight);
    writes = await run(gm, P.observe, { on: false });
    note(`${shelf}, force, No`, { found: asked.found, title: asked.forceTitle, count: asked.count, writes: writes.length });
    check(`10: ${shelf} opens the forced confirm with a count, not a rebuild-only warning, and No writes nothing`, asked.found && asked.forceTitle && Number.isInteger(asked.count) && done.result === null && writes.length === 0 && done.notes.length === 0, { count: asked.count, writes: writes.length, notes: done.notes.length });
  }

  section("An adventure book's Force repair: the confirm, answered No (steps 1, 3)");
  const am = await run(gm, P.manager, { tab: "adventures" });
  note("adventure rows", am.adventureRows);
  check("the Adventures tab offers Force repair beside each book's row", am.adventureRows.length > 0, am.adventureRows.length);
  if (am.adventureRows.length) {
    const book = am.adventureRows.includes(BOOK) ? BOOK : am.adventureRows[0];
    await run(gm, P.observe, { on: true });
    const pressed = await run(gm, P.adventureForce, { book });
    if (process.env.SHOTS === "1" && pressed.dialog) {
      note("plate", await gm.shot(plate("importer-adventure-force.png"), `#${pressed.dialog}`));
    }
    const asked = await run(gm, P.answer, { before: pressed.before, yes: false });
    await sleep(1000);
    writes = await run(gm, P.observe, { on: false });
    note("adventure force, No", { book, tip: pressed.tip, found: asked.found, title: asked.forceTitle, writes: writes.length });
    check("1: the button carries its tooltip and opens a confirm titled Force repair in place", pressed.button && pressed.tip === "ACKS-IMPORTER.manager.adventureForceTip" && asked.found && asked.forceTitle, { tip: pressed.tip, title: asked.forceTitle });
    check("1: answered No, nothing is written", writes.length === 0, writes.slice(0, 5));
  }
  await run(gm, P.closeManager);
  check("3: the Player seat's manager has no Adventures tab and none of its buttons", !pm.sections.includes("adventures") && pm.adventureRows.length === 0);

  section("The Rebuild tab's Force repair (plate)");
  await gm.compose();
  await run(gm, P.manager, { tab: "rebuild" });
  const chosen = await run(gm, P.rebuildTab, { pick: `book:${BOOK}`, mode: "force" });
  check("the Rebuild tab offers the open book, and Force repair can be chosen", chosen.has && chosen.mode === "force", chosen);
  const rb = await run(gm, P.rebuildGo);
  note("rebuild tab", { dialog: !!rb.dialog, title: rb.title, redrawn: rb.redrawn });
  check("Go, book and Force repair chosen, asks under Force repair in place", !!rb.dialog && rb.title, { title: rb.title });
  check("while the forced confirm is up, the redrawn Rebuild form still reads the user's pick and Force repair", rb.redrawn?.pick === `book:${BOOK}` && rb.redrawn?.mode === "force", { pick: rb.redrawn?.pick === `book:${BOOK}`, mode: rb.redrawn?.mode });
  if (process.env.SHOTS === "1" && rb.dialog) note("plate", await gm.shot(plate("importer-force-repair.png"), "#acks-extras-import-manager"));
  if (rb.dialog) {
    await run(gm, P.observe, { on: true });
    await run(gm, P.answer, { before: rb.before, yes: false });
    await sleep(1000);
    writes = await run(gm, P.observe, { on: false });
    check("and its No writes nothing", writes.length === 0, writes.length);
  }
  await run(gm, P.closeManager);

  section("Overhead token art (steps 1, 4, 8)");
  const art = await run(gm, P.tokenArt);
  note("token art", art);
  const tools = await run(gm, P.manager, { tab: "tools" });
  if (Array.isArray(art.sources) && art.sources.length === 0) {
    check("1: no active compendium offers art, so the Tools tab has no Apply button", tools.tokenApply === 0, tools.tokenApply);
    check("1: and no Restore button while no monster carries the mark", art.flagged || tools.tokenRestore === 0, { flagged: art.flagged, restore: tools.tokenRestore });
    console.log("note: no active module ships a monster compendium with token art; steps 2, 3, 5, 6 and 7 need one and are not walked");
  } else {
    check("2: one Apply per source offering art", tools.tokenApply === (art.sources?.length ?? -1), { apply: tools.tokenApply, sources: art.sources });
  }
  await run(gm, P.closeManager);
  const wild = await gm.fixture("importer/token-art-wildcard", "Actor", { name: "QA Wildcard", type: "monster", img: PORTRAIT, items: [], prototypeToken: { randomImg: true, texture: { src: WILDCARD } } });
  const made = await run(gm, P.makeEncounter, { actorId: wild.id });
  if (made.groupUuid) swept.push(gm.track(made.groupUuid, "Actor"));
  note("make encounter", made);
  check("4: Make Encounter from a wildcard monster: the group's portrait is the monster's portrait, not the wildcard path", made.tool && made.img === PORTRAIT && !String(made.tokenSrc ?? "").includes("*"), made);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  try {
    const sw = gm && swept.length ? await gm.sweepTracked({ only: swept }) : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of openedPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
