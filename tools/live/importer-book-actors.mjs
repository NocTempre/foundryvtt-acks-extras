/**
 * Live walk, importer-book-actors: a book repair reaches a book's own rows, the
 * bestiary's creatures and templates among them. Walks docs/importer/TESTING.md,
 * "A family's rebuild with a copy in the sidebar", steps 2 and 3:
 *   - 2: Repair everything pressed on the Import tab and answered No lists the
 *     bestiary's own-rows line beside its part and writes nothing (a
 *     create/update/delete observer holds nothing);
 *   - 3: the library's beastman template is written without a Kit axis, kit
 *     cells or a default role, the Rebuild tab's pick for the bestiary is pressed,
 *     its confirm names the book's own rows, Yes is answered and the choice, if
 *     one opens, answered Keep every edit of mine. One library template stands
 *     under the same id with the current Role axis and a Kit axis, no twin, and
 *     the sidebar copy of it is byte-identical before and after.
 * Machine values arrive through ./_env.mjs; the bestiary must be open on the
 * GM seat (the shelf opens it on join).
 *
 * Fixtures: `monsters/beastman-pre-11-14`, a world actor made from the library
 * template with `_stats.compendiumSource` naming it, so it is a copy dragged out
 * of the library, written with no Kit axis, kit cells or default role; kept. The
 * library template is the walk's to overwrite: it is imported where the library
 * lacks it, stripped of those and left in the current shape. Every id printed is a cookbook
 * id, a uuid or a count; no book word leaves the page.
 *
 * Budget: a bestiary repair refills every held creature of the book (about 190
 * actors and 650 embedded items in the test world), around two hours, so the wall
 * clock is this walk's own, `WALK_WALL_MS`, default three hours.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOK = "mm";
const FAMILY = "mm.familyBeastman";
const MARKER = "monsters/beastman-pre-11-14";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__baBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__ba = globalThis.__ba ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.K = await import("/modules/acks-extras/scripts/monsters/kits.mjs");
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
    return {
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      open: !!acksExtras.importer.bookOpen?.("mm"),
      boot: globalThis.__baBoot ?? null,
    };
  },
  observe: async ({ on }) => {
    const H = globalThis.__ba;
    if (on) H.writes = [];
    H.observing = !!on;
    return H.writes;
  },
  /** Whether the world holds the Judge's beastman tables the Kit axis is built from, read again after an import where it does not. */
  kits: async () => {
    const H = globalThis.__ba;
    if (H.K.importedKits()) return { held: true, imported: false };
    await acksExtras.importer.cookbookImportTables?.(null);
    return { held: !!H.K.importedKits(), imported: true };
  },
  /** The library's template of the family, its shape, and how many library documents claim the family. */
  library: async ({ family }) => {
    const H = globalThis.__ba;
    const held = (await H.CB.importedDocs("Actor")).filter((d) => d.getFlag("acks-extras", "cookbook")?.id === family);
    const lib = held.filter((d) => d.pack);
    const doc = await H.CB.importedActorFor(family, { copies: false });
    const axes = doc?.system?.axes ?? [];
    const role = axes.find((a) => a.key === "role");
    return {
      uuid: doc?.uuid ?? null,
      twins: lib.length,
      ids: lib.map((d) => d.id),
      role: !!role,
      roleDefault: role?.default ? true : false,
      kitAxis: axes.some((a) => a.key === "kit"),
      kitCells: (doc?.system?.cells ?? []).filter((c) => (c.by ?? []).includes("kit")).length,
    };
  },
  /** How much the book's repair has to refill: held actors of the book, and the embedded items on them. Counts only. */
  load: async ({ book }) => {
    const H = globalThis.__ba;
    const held = (await H.CB.importedDocs("Actor")).filter((d) => String(d.getFlag("acks-extras", "cookbook")?.id ?? "").startsWith(`${book}.`));
    const items = held.reduce((n, d) => n + (d.items?.size ?? 0), 0);
    return { actors: held.length, library: held.filter((d) => d.pack).length, items };
  },
  /** The ticked entry's import through the entry picker, for a library that lacks it: Yes answered, run to its end. */
  importFamily: async ({ family }) => {
    const H = globalThis.__ba;
    const before = H.dialogs().map((a) => a.id);
    H.flight = acksExtras.importer.cookbookReimportEntries();
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector(".acks-extras-importer-mon-list")), { tries: 240 });
    if (!app) return { opened: false };
    const box = H.root(app).querySelector(`input[name='sel'][value='Monsters|${family}']`);
    if (!box) return { opened: true, ticked: false };
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const dialogsBefore = H.dialogs().map((a) => a.id);
    H.root(app).querySelector("button[data-action='ok']").click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !dialogsBefore.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 240 });
    if (dlg) H.root(dlg).querySelector("button[data-action='yes']").click();
    const choice = await H.poll(() => H.dialogs().find((a) => H.root(a)?.querySelector(".acks-extras-held-list")), { tries: 8 });
    if (choice) H.root(choice).querySelector("button[data-action='keepAll']").click();
    await H.flight;
    return { opened: true, ticked: true, asked: !!dlg };
  },
  /** A template written without a Kit axis: no kit axis, no kit cell, the role axis without its default. */
  age: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const axes = foundry.utils.deepClone(doc.system.axes).filter((a) => a.key !== "kit");
    for (const a of axes) if (a.key === "role") a.default = "";
    const cells = foundry.utils.deepClone(doc.system.cells).filter((c) => !(c.by ?? []).includes("kit"));
    await doc.update({ "system.axes": axes, "system.cells": cells });
    const now = await fromUuid(uuid);
    const role = (now.system.axes ?? []).find((a) => a.key === "role");
    return { kitAxis: (now.system.axes ?? []).some((a) => a.key === "kit"), roleDefault: !!role?.default, kitCells: (now.system.cells ?? []).filter((c) => (c.by ?? []).includes("kit")).length };
  },
  /** The data a sidebar copy of the library template is created from: its `system` as the template holds it, its stamp, its source. */
  copyData: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const data = doc.toObject();
    delete data._id;
    data.name = `${doc.name} (sidebar copy)`;
    data.folder = null;
    data.ownership = { default: 0 };
    data._stats = { compendiumSource: doc.uuid };
    return data;
  },
  /** The kept copy brought to the shape the walk needs: its source naming the library template, then aged. Returns the source it stood on first. */
  shapeCopy: async ({ uuid, source }) => {
    const doc = await fromUuid(uuid);
    const was = doc._stats?.compendiumSource ?? null;
    if (was !== source) await doc.update({ "_stats.compendiumSource": source });
    return { was: was === null ? "none" : was === source ? "named" : "other", now: (await fromUuid(uuid))?._stats?.compendiumSource === source };
  },
  /** A sidebar copy's `system`, as a checksum and a length: the walk compares it before and after, and prints nothing of it. */
  fingerprint: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const text = JSON.stringify(doc.system);
    let h = 5381;
    for (let n = 0; n < text.length; n++) h = ((h << 5) + h + text.charCodeAt(n)) | 0;
    const role = (doc.system.axes ?? []).find((a) => a.key === "role");
    return {
      sum: h, length: text.length, copy: !doc.pack, source: doc._stats?.compendiumSource ?? null,
      kitAxis: (doc.system.axes ?? []).some((a) => a.key === "kit"), roleDefault: !!role?.default,
    };
  },
  /** The manager on `tab`, with the Rebuild pick set as a user sets it. */
  rebuildTab: async ({ pick }) => {
    const H = globalThis.__ba;
    const app = acksExtras.importer.openImportManager({ tab: "rebuild" });
    await H.poll(() => app.rendered && H.root(app)?.querySelector("[data-rebuild-form]"));
    await H.sleep(300);
    const form = H.root(app).querySelector("[data-rebuild-form]");
    const el = form.querySelector("select[name='pick']");
    if (![...el.options].some((o) => o.value === pick)) return { has: false };
    el.value = pick;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(300);
    return { has: true };
  },
  /** Go pressed; the confirm's text read against the one line this walk is about, then left open. */
  rebuildGo: async () => {
    const H = globalThis.__ba;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const before = H.dialogs().map((a) => a.id);
    H.notes.splice(0);
    H.root(app).querySelector("[data-rebuild-form] button[data-action='rebuild']").click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 480 });
    if (!dlg) return { dialog: null };
    const lines = [...H.root(dlg).querySelectorAll("p")].map((p) => p.textContent.replace(/\s+/g, " ").trim());
    const [head, tail] = game.i18n.format("ACKS-IMPORTER.ui.repairMergedBookOwn", { counts: "\u0000" }).replace(/\s+/g, " ").trim().split("\u0000");
    return {
      dialog: dlg.id,
      title: dlg.options?.window?.title === game.i18n.localize("ACKS-IMPORTER.ui.repairMergedTitle"),
      own: lines.filter((l) => l.startsWith(head) && l.endsWith(tail)).length,
      lines: lines.length,
    };
  },
  /** The open confirm answered by its own button. */
  answer: async ({ dialog, yes }) => {
    const H = globalThis.__ba;
    const dlg = foundry.applications.instances.get(dialog);
    H.root(dlg).querySelector(`button[data-action='${yes ? "yes" : "no"}']`).click();
    await H.poll(() => !dlg.rendered);
    return !dlg.rendered;
  },
  /**
   * One look at a run in flight, answered at once with no waiting inside the page: a
   * rebuild keeps the page busy for minutes, and a step that waits for it outlives the
   * driver's eval timeout. The driver polls this under the walk's own budget.
   */
  probe: async () => {
    const H = globalThis.__ba;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const done = game.i18n.format("ACKS-IMPORTER.ui.repairMergedDone", { replaced: "\u0000", taken: "\u0000", held: "\u0000", recreated: "\u0000", refused: "\u0000" }).split("\u0000")[0];
    const choice = H.dialogs().find((a) => H.root(a)?.querySelector(".acks-extras-held-list"));
    return {
      busy: !!H.root(app)?.querySelector(".acks-extras-importer-manager-busy"),
      reported: H.notes.some((n) => n.text.includes(done.slice(0, 14))),
      failed: H.notes.some((n) => n.kind === "error" || n.kind === "warn"),
      busyText: (H.root(app)?.querySelector(".acks-extras-importer-manager-busy")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      open: H.dialogs().map((a) => ({ title: String(a.options?.window?.title ?? "").slice(0, 60), buttons: [...(H.root(a)?.querySelectorAll("button[data-action]") ?? [])].map((b) => b.dataset.action) })),
      writes: H.writes.length,
      lastWrite: H.writes.at(-1)?.hook ?? null,
      chooser: choice?.id ?? null,
      rows: choice ? H.root(choice).querySelectorAll(".acks-extras-held-row").length : 0,
      buttons: choice ? [...H.root(choice).querySelectorAll("button[data-action]")].map((b) => b.dataset.action) : [],
    };
  },
  keepAll: async ({ id }) => {
    const H = globalThis.__ba;
    const app = foundry.applications.instances.get(id);
    H.root(app).querySelector("button[data-action='keepAll']").click();
    await H.poll(() => !app.rendered);
    return !app.rendered;
  },
  /** The notices raised since the press, by kind, and whether one is the repair's own report. */
  notices: async () => {
    const H = globalThis.__ba;
    const done = game.i18n.format("ACKS-IMPORTER.ui.repairMergedDone", { replaced: "\u0000", taken: "\u0000", held: "\u0000", recreated: "\u0000", refused: "\u0000" }).split("\u0000")[0];
    return {
      kinds: H.notes.map((n) => n.kind),
      reported: H.notes.some((n) => n.text.includes(done.slice(0, 14))),
      raised: H.notes.filter((n) => n.kind !== "info").map((n) => n.text.slice(0, 240)),
    };
  },
  /** Repair everything pressed on the Import tab; returns at once. */
  pressAll: async () => {
    const H = globalThis.__ba;
    H.notes.splice(0);
    const app = acksExtras.importer.openImportManager({ tab: "import" });
    await H.poll(() => app.rendered && app.tabGroups?.primary === "import" && H.root(app)?.querySelector("section[data-tab='import'] button[data-action='repairAll']"));
    H.pressed = { before: H.dialogs().map((a) => a.id), at: performance.now() };
    H.root(app).querySelector("section[data-tab='import'] button[data-action='repairAll']").click();
    return true;
  },
  /** One round of waiting for Repair everything's confirm; then the lines listed under the bestiary's part. */
  everythingConfirm: async ({ book }) => {
    const H = globalThis.__ba;
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    const dlg = await H.poll(() => H.dialogs().find((a) => !H.pressed.before.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 240 });
    if (!dlg) return H.root(app)?.querySelector(".acks-extras-importer-manager-busy") ? { waiting: true } : { dialog: null };
    const label = acksExtras.importer.BOOKS[book].label;
    const paragraphs = [...H.root(dlg).querySelectorAll("p")];
    const at = paragraphs.findIndex((p) => p.querySelector("strong")?.textContent.trim() === label);
    const part = [];
    for (let n = at + 1; at >= 0 && n < paragraphs.length && !paragraphs[n].querySelector("strong"); n++) part.push(paragraphs[n].textContent.replace(/\s+/g, " ").trim());
    const [head, tail] = game.i18n.format("ACKS-IMPORTER.ui.repairMergedBookOwn", { counts: "\u0000" }).replace(/\s+/g, " ").trim().split("\u0000");
    return {
      dialog: dlg.id,
      seconds: Math.round((performance.now() - H.pressed.at) / 1000),
      title: dlg.options?.window?.title === game.i18n.localize("ACKS-IMPORTER.ui.repairMergedTitle"),
      partFound: at >= 0,
      ownLine: part.filter((l) => l.startsWith(head) && l.endsWith(tail)).length,
      partLines: part.length,
    };
  },
  closeManager: async () => {
    const app = foundry.applications.instances.get("acks-extras-import-manager");
    if (app) await app.close({ animate: false });
    return !foundry.applications.instances.get("acks-extras-import-manager")?.rendered;
  },
  restore: async () => {
    const H = globalThis.__ba;
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
  // A timeout names the page step it stopped in; the transport's own error does not.
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`).catch((err) => {
    throw new Error(`${fn.name || "page step"}: ${err?.message ?? err}`);
  });
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let gm = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 10_800_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, gm));
  // The shelf's books open after ready; the walk waits for the bestiary to be read as open.
  let installed = await run(gm, P.install);
  for (let n = 0; n < 30 && !installed.open; n++) { await sleep(3000); installed = await run(gm, P.install); }
  note("installed", { module: installed.module, open: installed.open });
  if (!installed.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  check("the seat is the active GM with the bestiary open", installed.isGM && installed.activeGMIsSelf && installed.open);
  check("no error from load through ready", installed.boot?.phases.length === 3 && !installed.boot.errors.length, installed.boot);
  await gm.compose();

  section("Repair everything, answered No (step 2)");
  await run(gm, P.observe, { on: true });
  await run(gm, P.pressAll);
  let asked = { waiting: true };
  for (let round = 0; asked.waiting && round < 40; round++) asked = await run(gm, P.everythingConfirm, { book: BOOK });
  note("confirm", { found: !!asked.dialog, seconds: asked.seconds, title: asked.title, partFound: asked.partFound, ownLine: asked.ownLine, partLines: asked.partLines });
  check("2: ONE confirm, titled Repair in place, lists the bestiary's part", !!asked.dialog && asked.title && asked.partFound, asked);
  check("2: the bestiary's part carries the own-rows line, once", asked.ownLine === 1, { ownLine: asked.ownLine });
  if (asked.dialog) {
    await run(gm, P.answer, { dialog: asked.dialog, yes: false });
    await sleep(2000);
    const writes = await run(gm, P.observe, { on: false });
    check("2: answered No, the observer holds nothing", writes.length === 0, { writes: writes.slice(0, 5) });
  } else {
    await run(gm, P.observe, { on: false });
  }
  await run(gm, P.closeManager);

  section("The library's template, written without a Kit axis (step 3)");
  const kits = await run(gm, P.kits);
  note("kit tables", kits);
  if (!kits.held) blocked("the world holds no imported beastman troop tables, so no Kit axis can be built; import the Judge's tables first");
  let lib = await run(gm, P.library, { family: FAMILY });
  if (!lib.uuid) {
    note("library template", "absent; importing it through the entry picker");
    note("import", await run(gm, P.importFamily, { family: FAMILY }));
    lib = await run(gm, P.library, { family: FAMILY });
  }
  check("setup: the library holds one template of the family", !!lib.uuid && lib.twins === 1, { twins: lib.twins });
  if (!lib.uuid || lib.twins !== 1) blocked("the library does not hold exactly one template of the family; the walk reads it, never builds a twin");
  const libUuid = lib.uuid;
  const libIds = lib.ids;
  const aged = await run(gm, P.age, { uuid: libUuid });
  check("setup: the template stands with no Kit axis, no kit cell and no default role", !aged.kitAxis && aged.kitCells === 0 && !aged.roleDefault, aged);

  const copyData = await run(gm, P.copyData, { uuid: libUuid });
  const copy = await gm.fixture(MARKER, "Actor", copyData);
  const copyUuid = copy.uuid;
  // A kept fixture carries whatever its last run left, and a create may not keep the source it is given: the step's shape is written and asserted here.
  const shaped = await run(gm, P.shapeCopy, { uuid: copyUuid, source: libUuid });
  note("sidebar copy source", shaped);
  const agedCopy = await run(gm, P.age, { uuid: copyUuid });
  const copyBefore = await run(gm, P.fingerprint, { uuid: copyUuid });
  note("sidebar copy", { copy: copyBefore.copy, kitAxis: agedCopy.kitAxis, roleDefault: agedCopy.roleDefault });
  check("setup: the sidebar copy is a world actor naming the library template, with no Kit axis and no default role", copyBefore.copy && copyBefore.source === libUuid && !copyBefore.kitAxis && !copyBefore.roleDefault, { source: copyBefore.source === libUuid });

  section("The Rebuild tab: the bestiary's pick, Go, Yes, Keep every edit (step 3)");
  note("the repair's load", await run(gm, P.load, { book: BOOK }));
  const picked = await run(gm, P.rebuildTab, { pick: `book:${BOOK}` });
  check("the Rebuild tab offers the bestiary under its one select", picked.has, picked);
  const go = await run(gm, P.rebuildGo);
  note("confirm", { found: !!go.dialog, title: go.title, own: go.own, lines: go.lines });
  check("3: Go asks under Repair in place and names the book's own rows once", !!go.dialog && go.title && go.own === 1, go);
  if (!go.dialog) throw new Error("the Rebuild confirm never opened");
  await run(gm, P.observe, { on: true });
  await run(gm, P.answer, { dialog: go.dialog, yes: true });
  const t0 = Date.now();
  // The page answers each probe at once; the walk's own clock bounds the wait. A probe the busy page
  // cannot answer within the driver's eval timeout is asked again.
  let state = { idle: false };
  let chose = false;
  let seen = false;
  let lastNote = 0;
  let timeouts = 0;
  for (;;) {
    let look = null;
    try {
      look = await run(gm, P.probe);
    } catch (err) {
      if (!/timeout/.test(String(err?.message))) throw err;
      timeouts++;
    }
    if (Date.now() - lastNote > 60_000) {
      lastNote = Date.now();
      note("waiting (s)", { elapsed: Math.round((Date.now() - t0) / 1000), timeouts, busy: look?.busy ?? null, reported: look?.reported ?? null, failed: look?.failed ?? null, chooser: !!look?.chooser, seen, writes: look?.writes, lastWrite: look?.lastWrite, open: look?.open });
    }
    if (look?.chooser) {
      seen = true;
      note("choice", { rows: look.rows, buttons: look.buttons });
      chose = await run(gm, P.keepAll, { id: look.chooser });
      continue;
    }
    if (look) {
      seen = seen || look.busy;
      // Done once the manager is idle after the run was seen busy or reported, or never seen busy after a minute.
      if (!look.busy && (seen || look.reported || Date.now() - t0 > 60_000)) { state = { idle: true, reported: look.reported, seen }; break; }
    }
    await sleep(1500);
  }
  note("repair ran (s)", Math.round((Date.now() - t0) / 1000));
  check("3: the repair ran to its end", !!state.idle, state);
  const notices = await run(gm, P.notices);
  note("notices", { kinds: notices.kinds, reported: notices.reported, chose });
  // A warning or error is quoted whole to this log, which is local and may hold the Judge's own names; a report names its shape only.
  for (const text of notices.raised) note("raised", text);
  check("3: the notice reads Repaired in place, and nothing warned or failed", notices.reported && !notices.kinds.includes("error") && !notices.kinds.includes("warn"), notices.kinds);

  section("What stands after (step 3)");
  const after = await run(gm, P.library, { family: FAMILY });
  note("library after", after);
  check("3: one library template stands under the same id, no twin", after.twins === 1 && same(after.ids, libIds) && after.uuid === libUuid, { twins: after.twins, sameIds: same(after.ids, libIds) });
  check("3: it carries the current Role axis, with its default", after.role && after.roleDefault, { role: after.role, roleDefault: after.roleDefault });
  check("3: and a Kit axis with its cells", after.kitAxis && after.kitCells > 0, { kitAxis: after.kitAxis, kitCells: after.kitCells });
  const copyAfter = await run(gm, P.fingerprint, { uuid: copyUuid });
  check("3: the sidebar copy is untouched: its `system` is byte-identical, and still without a Kit axis or default role",!!copyAfter && copyAfter.sum === copyBefore.sum && copyAfter.length === copyBefore.length && !copyAfter.kitAxis && !copyAfter.roleDefault, { same: copyAfter?.sum === copyBefore.sum });
  await run(gm, P.closeManager);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  note("kept", { fixture: MARKER, library: "the template, left in the current shape" });
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
