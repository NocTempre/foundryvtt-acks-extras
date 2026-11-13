/**
 * Live walk, the window contract: docs/lib/TESTING.md "Every window has a drag
 * corner and reaches its controls". Each window a module class declares shows
 * a corner a real pointer can drag, and every control in it stays reachable
 * when the window is shorter than its content. Pack macros, importer dialogs
 * and the frames that scroll at a part root are held to the same two tests. A
 * window of nobody's, with no module class, is the control: it stays as core
 * built it. Machine values arrive through ./_env.mjs; nothing here names a
 * port, a world, a seat or a book. Every figure typed in is invented.
 *
 * The walk is also the smoke pass. Each seat reloads under a boot recorder
 * that keeps recording, and the walk reads it again once the windows have
 * opened: an error logged under any window fails, a warning is listed and
 * never fails. Every settings menu the module registers is opened through its
 * registered type, the storage manager through the opener the location sheet
 * calls, and one declared compendium is opened and read for what it lists.
 * The player's seat opens the attitude sheet and the ability sheet.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the items
 * `lib/window-variation`, `lib/window-trap`, `lib/window-attitude` (observed
 * by every seat), `lib/window-ability` (raised to observer at the player's step),`lib/window-spell`, the character
 * `lib/window-trader` holding a stack of three, the monster
 * `lib/window-monster`, the domain `lib/window-domain`, the scene
 * `lib/window-scene` holding one door, and one `lib/window-sheet-<type>` of
 * every other type this module draws a sheet for. No window here is submitted, so nothing
 * on a fixture changes by being walked. Read and never driven: the market town
 * `markets/gate-town`, since a location with no market of its own is pruned at
 * a GM's `ready`, and the first formation standing on a map. The restock
 * confirm asks only whether a hex is stocked, so that one read is answered in
 * the page for the moment the call is made, and the world is not written.
 */
import { Cdp, connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MOD = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/**
 * In the page before it loads, so `init`, `setup` and `ready` are all recorded.
 * It keeps recording for the life of the page: `step` names the walk's section
 * a line was logged in, set by `P.step`. Errors are kept whole; warnings are
 * counted and the first 200 kept.
 */
const RECORDER = `(() => {
  const R = (globalThis.__wcBoot = { phase: "load", step: "boot", phases: [], errors: [], warnings: [], warned: 0 });
  const push = (kind, text) => R.errors.push({ phase: R.phase, step: R.step, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  const warn = console.warn.bind(console);
  console.warn = (...args) => {
    R.warned++;
    if (R.warnings.length < 200) R.warnings.push({ phase: R.phase, step: R.step, text: args.map((a) => a?.message ?? a).join(" ").slice(0, 300) });
    warn(...args);
  };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__wcBoot ? { phase: globalThis.__wcBoot.phase, phases: globalThis.__wcBoot.phases, errors: globalThis.__wcBoot.errors } : null,
  }),

  /** The recorder as it stands, whole. */
  recorder: async () => globalThis.__wcBoot ?? null,

  /** Names the section the recorder files what it logs under next. */
  step: async ({ title }) => {
    if (globalThis.__wcBoot) globalThis.__wcBoot.step = title;
    return true;
  },

  /** Raises a fixture to observer for everyone, only where it stands lower, so a player's seat can open it. */
  observe: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if ((doc.ownership?.default ?? 0) < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER) await doc.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
    return doc.ownership.default;
  },

  install: async () => {
    const H = (globalThis.__wc = {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.mod = (path) => import(`/modules/acks-extras/scripts/${path}`);
    H.live = () => new Set(foundry.applications.instances.values());
    H.ours = (app) => app.options.classes?.some?.((c) => c === "acks-extras" || c.startsWith("acks-extras-"));
    /** The window a step opened: the first instance not standing before it, of its class, or of this module's. */
    H.newWindow = async (before, name) => {
      for (let n = 0; n < 80; n++) {
        for (const app of foundry.applications.instances.values()) {
          if (before.has(app) || !app.rendered) continue;
          if (name ? app.constructor.name === name : H.ours(app)) return app;
        }
        await H.sleep(100);
      }
      return null;
    };
    H.visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    H.corner = (app) => {
      const handle = app.element.querySelector(":scope > .window-resize-handle");
      const r = handle?.getBoundingClientRect();
      const at = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      const top = at ? document.elementFromPoint(at.x, at.y) : null;
      return {
        option: app.options.window.resizable,
        handle: !!handle,
        hidden: handle?.hidden ?? null,
        shown: !!handle && !handle.hidden && H.visible(handle),
        at,
        hit: !!handle && !!top && (top === handle || handle.contains(top)),
        over: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null,
      };
    };
    H.size = (app) => {
      const r = app.element.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    };
    /**
     * Every visible control, brought into view the way a wheel would, must land
     * inside the frame: whole, or for one taller than the view, enough to use.
     */
    H.reach = (app) => {
      const root = app.element;
      const inside = "button, input, select, textarea, a[data-action], [data-action][role=button]";
      const controls = [...root.querySelectorAll(".window-content")].flatMap((c) => [...c.querySelectorAll(inside)]);
      const live = controls.filter((el) => el.type !== "hidden" && H.visible(el));
      const lost = [];
      for (const el of live) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const f = root.getBoundingClientRect();
        const seen = Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top);
        if (seen < Math.min(20, r.height) || r.right > f.right + 1 || r.left < f.left - 1) {
          lost.push(el.name || el.dataset?.action || el.textContent?.trim().slice(0, 24) || el.tagName);
        }
      }
      return { controls: live.length, lost };
    };
    /** What scrolls, once the window is shorter than its content. */
    H.scroller = (app) => {
      const content = app.element.querySelector(".window-content");
      if (!content) return null;
      const scrolls = (el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
      const el = [content, ...content.querySelectorAll("*")].find(scrolls);
      return el ? { cls: String(el.className).slice(0, 60), overflow: el.scrollHeight - el.clientHeight } : null;
    };
    H.current = null;
    H.track = (app) => {
      H.current = app;
      if (!app) return { opened: false };
      app.bringToFront?.();
      return { opened: true, cls: app.constructor.name, classes: app.options.classes, ...H.corner(app), size: H.size(app) };
    };
    /** A dialog's promise answers null or rejects when it is closed; either way it is finished with here. */
    H.watch = (promise) => { Promise.resolve(promise).catch(() => null); };
    return true;
  },

  /** Every fixture a window opens on, brought to its shape. */
  shape: async ({ traderId, sceneId }) => {
    const trader = game.actors.get(traderId);
    const goods = trader.items.getName("Window walk goods");
    if (!goods) await trader.createEmbeddedDocuments("Item", [{ name: "Window walk goods", type: "item", system: { quantity: { value: 3, max: 0 } } }]);
    else if (goods.system.quantity?.value !== 3) await goods.update({ "system.quantity.value": 3 });
    const scene = game.scenes.get(sceneId);
    const door = scene.walls.find((w) => w.door > 0);
    if (!door) await scene.createEmbeddedDocuments("Wall", [{ c: [100, 100, 300, 100], door: 1 }]);
    const { stackCountOf } = await import("/modules/acks-extras/scripts/lib/item-model.mjs");
    return { stack: stackCountOf(trader.items.getName("Window walk goods")), doors: scene.walls.filter((w) => w.door > 0).length };
  },

  sheet: async ({ uuid, name }) => {
    const H = globalThis.__wc;
    const doc = await fromUuid(uuid);
    await doc.sheet.render({ force: true });
    await H.sleep(200);
    return { ...H.track(doc.sheet), expected: name };
  },

  map: async ({ which, cls }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const m = await H.mod(which === "modes" ? "battlemap/map-modes.mjs" : "battlemap/terrain-paint.mjs");
    if (which === "modes") m.openMapModes();
    else m.openTerrainPalette();
    return H.track(await H.newWindow(before, cls));
  },

  door: async ({ sceneId, cls }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const { openDoorApp } = await H.mod("formation/door-app.mjs");
    const wall = game.scenes.get(sceneId).walls.find((w) => w.door > 0);
    await openDoorApp(wall);
    return H.track(await H.newWindow(before, cls));
  },

  trapbreak: async ({ cls }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const { getFormations } = await H.mod("formation/formation-model.mjs");
    const { openTrapbreakApp } = await H.mod("formation/trapbreak-app.mjs");
    const [id] = Object.keys(getFormations());
    if (!id) return { opened: false, why: "no formation stands in the world" };
    await openTrapbreakApp(id);
    return H.track(await H.newWindow(before, cls));
  },

  /** A tool window, through the opener its own control calls. */
  tool: async ({ key, traderId, townUuid }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const open = {
      palette: async () => (await H.mod("lib/apps/status-palette-app.mjs")).openStatusPalette(),
      hp: async () => (await H.mod("lib/apps/hp-app.mjs")).openHpTool(),
      repair: async () => (await H.mod("lib/apps/repair-app.mjs")).openRepairTool(),
      roster: async () => (await H.mod("henchmen/apps/roster-app.mjs")).openRosterApp(game.actors.get(traderId)),
      posting: async () => (await H.mod("henchmen/apps/posting-dialog.mjs")).openPostingDialog(await fromUuid(townUuid)),
    };
    await open[key]();
    return H.track(await H.newWindow(before));
  },

  /** The keys of every settings menu this module registers. */
  menuKeys: async ({ mod }) => [...game.settings.menus.keys()].filter((key) => key.startsWith(`${mod}.`)),

  /** A settings menu the way the Settings screen opens it: a fresh instance of its registered type, rendered. */
  menu: async ({ key }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const entry = game.settings.menus.get(key);
    if (!entry) return { opened: false, why: "no such menu" };
    const app = new entry.type();
    try { await app.render(true); } catch (err) { return { opened: false, why: String(err?.message ?? err).slice(0, 160) }; }
    return H.track(app.rendered ? app : await H.newWindow(before));
  },

  /** The storage manager through the opener the location sheet calls, focused on the kept market town. */
  storage: async ({ townUuid }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const open = globalThis.acksExtras?.location?.openStorageManager;
    if (typeof open !== "function") return { opened: false, why: "no storage manager opener" };
    open(await fromUuid(townUuid));
    return H.track(await H.newWindow(before, "StorageManager"));
  },

  /**
   * A compendium this module declares that holds a document. Core gives a
   * compendium window no module class and no corner, so it is read for what
   * it lists and not held to the window contract.
   */
  pack: async ({ mod }) => {
    const H = globalThis.__wc;
    const pack = game.packs.find((p) => p.metadata.packageName === mod && p.index.size > 0);
    if (!pack) return { opened: false, why: "no declared pack holds a document" };
    pack.render(true);
    let app = null;
    for (let n = 0; n < 80; n++) {
      app = pack.apps.find((a) => a.rendered) ?? null;
      if (app?.element.querySelector(".directory-item[data-entry-id]")) break;
      await H.sleep(100);
    }
    H.current = app;
    return {
      opened: !!app,
      collection: pack.collection,
      indexed: pack.index.size,
      listed: app?.element.querySelectorAll(".directory-item[data-entry-id]").length ?? 0,
    };
  },

  goodsUuid: async ({ traderId }) => game.actors.get(traderId).items.getName("Window walk goods").uuid,

  /** The kept market town, read and never driven. */
  town: async () => game.actors.find((a) => a.flags?.world?.fixture === "markets/gate-town")?.uuid ?? null,

  market: async ({ kind, cls, townUuid, traderId }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const location = await fromUuid(townUuid);
    const trader = game.actors.get(traderId);
    const offered = { name: "Window walk stock", costGp: 10, img: "icons/svg/item-bag.svg", type: "item", system: {} };
    const open = {
      purchase: async () => new (await H.mod("markets/apps/purchase-dialog.mjs")).PurchaseDialog({ location, item: offered }),
      commission: async () => new (await H.mod("markets/apps/commission-dialog.mjs")).CommissionDialog({ location, item: offered }),
      sell: async () => new (await H.mod("markets/apps/sell-dialog.mjs")).SellDialog({ location, seller: trader, item: trader.items.getName("Window walk goods") }),
      venture: async () => new (await H.mod("markets/apps/venture-dialog.mjs")).VentureTradeDialog({ location, trader }),
    };
    const app = await open[kind]();
    try { await app.render({ force: true }); } catch (err) { return { opened: false, why: String(err?.message ?? err).slice(0, 160) }; }
    return H.track(await H.newWindow(before, cls));
  },

  /** A dialog through its own code path: the stack's Divide prompt. */
  divide: async ({ traderId }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const { promptDivide } = await H.mod("lib/stack-prompt.mjs");
    H.watch(promptDivide(game.actors.get(traderId).items.getName("Window walk goods")));
    return H.track(await H.newWindow(before, "DialogV2"));
  },

  /** A dialog in the importer's contract, which scrolls at `.dialog-content`. */
  importerDialog: async () => {
    const H = globalThis.__wc;
    const before = H.live();
    H.watch(foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      window: { title: "Window walk" },
      content: `<p>Importer contract</p>${"<p>Line</p>".repeat(30)}`,
      rejectClose: false,
    }));
    return H.track(await H.newWindow(before, "DialogV2"));
  },

  /** A pack macro's own dialog, which the module's hook reaches from the macro's page context. */
  macro: async ({ name }) => {
    const H = globalThis.__wc;
    const before = H.live();
    const pack = game.packs.find((p) => p.metadata.packageName === "acks-extras" && p.documentName === "Macro" && p.index.some((e) => e.name === name));
    const macro = await pack?.getDocument(pack.index.find((e) => e.name === name)._id);
    if (!macro) return { opened: false, why: "no such macro" };
    H.watch(macro.execute());
    return H.track(await H.newWindow(before, "DialogV2"));
  },

  /** The hex-stock restock confirm, through its own path; see the header for the one read answered here. */
  restock: async () => {
    const H = globalThis.__wc;
    const { getFormations } = await H.mod("formation/formation-model.mjs");
    const { openStockDialog, trueHexOf } = await H.mod("formation/hex-stock-run.mjs");
    const formation = Object.values(getFormations()).find((f) => trueHexOf(f));
    if (!formation) return { opened: false, why: "no formation stands on a map" };
    const here = trueHexOf(formation);
    const before = H.live();
    here.scene.getFlag = () => ({ [here.key]: { stocked: true } });
    H.watch(openStockDialog(formation));
    delete here.scene.getFlag;
    return H.track(await H.newWindow(before, "DialogV2"));
  },

  /** The control: a dialog no module class claims stays as core built it. */
  foreign: async () => {
    const H = globalThis.__wc;
    const before = H.live();
    H.watch(foundry.applications.api.DialogV2.confirm({ window: { title: "Nobody's" }, content: "<p>Nobody's</p>", rejectClose: false }));
    return H.track(await H.newWindow(before, "DialogV2"));
  },

  sizeNow: async () => globalThis.__wc.size(globalThis.__wc.current),

  /** Short enough that a window of any length has to scroll, or keep its controls some other way. */
  shorten: async ({ height }) => {
    const H = globalThis.__wc;
    const app = H.current;
    app.setPosition({ height });
    await H.sleep(120);
    return { size: H.size(app), scroller: H.scroller(app), ...H.reach(app) };
  },

  rerender: async () => {
    const H = globalThis.__wc;
    await H.current.render();
    await H.sleep(250);
    return H.size(H.current);
  },

  closeCurrent: async () => {
    const H = globalThis.__wc;
    const app = H.current;
    H.current = null;
    try { await app?.close(); } catch { /* a dialog's close may answer by rejecting */ }
    await H.sleep(120);
    return true;
  },

  closeAll: async () => {
    let closed = 0;
    for (const app of [...foundry.applications.instances.values()]) {
      if (!app.rendered || !app.options?.classes?.some?.((c) => c === "acks-extras" || c.startsWith("acks-extras-") || c === "dialog")) continue;
      try { await app.close(); closed++; } catch { /* as above */ }
    }
    return closed;
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
    const ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`).catch(() => false);
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A second DevTools client on a seat, for what the driver has no API for: the recorder, and a real drag. */
async function rawSeat(port) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw seat: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  if (pages.length !== 1) { ws.close(); throw new Error(`raw seat: ${pages.length} game pages`); }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send("Page.bringToFront");
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  return {
    send,
    // Core captures the pointer on its first move, which has to land on a
    // corner 11px across, so the steps are a hand's and not a flick's.
    async drag(from, to, steps = 40) {
      await mouse("mouseMoved", from.x, from.y, { button: "none", buttons: 0 });
      await sleep(80);
      await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { button: "left", buttons: 1 });
        await sleep(10);
      }
      await mouse("mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1 });
      await sleep(200);
    },
    close() { try { ws.close(); } catch { /* closed */ } },
  };
}

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  await ready(api, key);
  const raw = await rawSeat(PORTS[key]);
  await raw.send("Page.enable");
  await raw.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await raw.send("Page.reload");
  await sleep(1500);
  note(`${key} reloaded under the recorder, ready after (s)`, await ready(api, key));
  return { api, raw };
}

/** The whole contract on the window just opened. */
async function walkWindow(gm, input, label, opened, { drag = true, short = 150 } = {}) {
  note(`${label}: opened`, { cls: opened.cls, option: opened.option, size: opened.size, why: opened.why });
  check(`${label}: the window opens`, opened.opened === true, opened.why);
  if (!opened.opened) return;
  check(`${label}: its corner is built and shown`, opened.shown === true && opened.option === true, { option: opened.option, handle: opened.handle, hidden: opened.hidden });
  check(`${label}: nothing covers the corner`, opened.hit === true, opened.over);
  if (drag && opened.at) {
    await input.drag(opened.at, { x: opened.at.x + 60, y: opened.at.y + 70 });
    const after = await run(gm, P.sizeNow);
    check(`${label}: a real pointer on the corner resizes it`, after.width !== opened.size.width || after.height !== opened.size.height, { from: opened.size, to: after });
  }
  const shortened = await run(gm, P.shorten, { height: short });
  check(`${label}: every control is reachable in a short window`, shortened.lost.length === 0, shortened);
  await run(gm, P.closeCurrent);
}

/** A section heading, and the name the recorder files what the page logs next under. */
async function stage(api, title) {
  section(title);
  await run(api, P.step, { title });
}

/**
 * Reads the recorder again. An error, an uncaught error or an unhandled
 * rejection logged since the page loaded fails the walk, with the section it
 * was logged in. Warnings are listed by distinct text and never fail it: core
 * and other modules log some on every load, so a count would be a constant of
 * the install and not of this module.
 */
async function readRecorder(api, label, when) {
  const boot = await run(api, P.recorder);
  const errors = boot?.errors ?? [];
  check(`${label}: no error logged ${when}`, !!boot && errors.length === 0, errors.slice(0, 5).map((e) => `[${e.step}] ${e.kind}: ${e.text}`));
  const distinct = new Map();
  for (const w of boot?.warnings ?? []) {
    const seen = distinct.get(w.text);
    distinct.set(w.text, { n: (seen?.n ?? 0) + 1, step: seen?.step ?? w.step });
  }
  note(`${label}: console warnings ${when} (listed, not failures)`, {
    logged: boot?.warned ?? 0,
    distinct: distinct.size,
    first: [...distinct].slice(0, 10).map(([text, { n, step }]) => `${n}x [${step}] ${text.slice(0, 120)}`),
  });
}

/**
 * The platform facts `lib.missingImages` stands on, true only of a real core
 * and server (docs/lib/TESTING.md, "An image whose file is gone"): a HEAD for
 * a path that names nothing answers a plain 404 and for a present core icon
 * 200, and `DEFAULT_ICON` is set on the document classes the repair writes to
 * and absent on the four it only lists. The dead path is built under the
 * world's own folder, asked for and never printed.
 */
async function walkImagePlatformFacts(api) {
  const facts = await run(api, async () => {
    const head = async (path) => { const res = await fetch(foundry.utils.getRoute(path), { method: "HEAD" }); return { status: res.status, ok: res.ok, redirected: res.redirected }; };
    const icon = (kind) => CONFIG[kind]?.documentClass?.DEFAULT_ICON ?? null;
    const kinds = ["Actor", "Item", "ActiveEffect", "Macro", "RollTable", "Token", "TableResult", "Scene", "JournalEntryPage", "Level"];
    return {
      dead: await head(`worlds/${game.world.id}/qq-missing-image.png`),
      here: await head("icons/svg/skull.svg"),
      defaults: Object.fromEntries(kinds.map((kind) => [kind, !!icon(kind)])),
    };
  });
  const { dead, here, defaults } = facts;
  check("a HEAD for a path under the world's folder that names nothing answers a plain 404, not a redirect", dead.status === 404 && !dead.ok && !dead.redirected, { status: dead.status, redirected: dead.redirected });
  check("a HEAD for a present core icon answers 200", here.status === 200 && here.ok && !here.redirected, { status: here.status });
  check("the live classes give every repairable kind a default image, ActiveEffect and Token included", ["Actor", "Item", "ActiveEffect", "Macro", "RollTable", "Token"].every((kind) => defaults[kind]), defaults);
  check("a roll-table result, a scene, a level and a journal page have none, so the check lists them only", ["TableResult", "Scene", "JournalEntryPage", "Level"].every((kind) => !defaults[kind]), defaults);
}

let gm = null;
try {
  section("seats");
  const gmSeat = await seat("gm");
  gm = gmSeat.api;
  const input = gmSeat.raw;
  const census = await run(gm, P.census, MOD);
  note("gm census", census);
  check("the GM seat is the active GM", census.activeGMIsSelf);
  check("init, setup and ready all ran under the recorder with no error", census.boot?.phases?.length === 3 && census.boot.errors.length === 0, census.boot);
  if (!census.activeGMIsSelf) blocked("another GM client is the active GM");
  note("install", await run(gm, P.install));

  await stage(gm, "fixtures");
  const item = (marker, type, extra = {}) => gm.fixture(marker, "Item", { name: `Window walk ${type}`, type, ...extra });
  const variation = await item("lib/window-variation", "acks-extras.variation");
  const trap = await item("lib/window-trap", "acks-extras.trap");
  const attitude = await item("lib/window-attitude", "acks-extras.attitude", { ownership: { default: 2 } });
  const ability = await item("lib/window-ability", "ability");
  const spell = await item("lib/window-spell", "spell");
  const trader = await gm.fixture("lib/window-trader", "Actor", { name: "Window walk trader", type: "character" });
  const monster = await gm.fixture("lib/window-monster", "Actor", { name: "Window walk monster", type: "monster" });
  const domain = await gm.fixture("lib/window-domain", "Actor", { name: "Window walk domain", type: "acks-extras.domain" });
  const scene = await gm.fixture("lib/window-scene", "Scene", { name: "Window walk scene", active: false, navigation: false, width: 1000, height: 1000 });
  const shaped = await run(gm, P.shape, { traderId: trader.id, sceneId: scene.id });
  note("shaped", shaped);
  check("the trader holds a stack of three and the scene a door", shaped.stack === 3 && shaped.doors === 1, shaped);
  const townUuid = await run(gm, P.town);
  check("the kept market town stands (tools/live/markets.mjs builds it)", !!townUuid, townUuid);

  await stage(gm, "sheets a Judge opens on a document");
  // A tabbed sheet's body takes what its header leaves, so it is held at a height a display can be.
  for (const [label, doc, cls, short] of [
    ["variation sheet", variation, "VariationSheet", 150],
    ["trap sheet", trap, "TrapSheet", 150],
    ["attitude sheet", attitude, "AttitudeSheet", 150],
    ["ability sheet", ability, "AcksAbilitySheet", 300],
    ["spell sheet", spell, "AcksSpellSheet", 300],
  ]) {
    const opened = await run(gm, P.sheet, { uuid: doc.uuid, name: cls });
    check(`${label}: the document opens on this module's sheet`, opened.cls === cls, opened.cls);
    await walkWindow(gm, input, label, opened, { short });
  }

  await stage(gm, "a corner that holds across a re-render");
  {
    const opened = await run(gm, P.sheet, { uuid: variation.uuid, name: "VariationSheet" });
    await input.drag(opened.at, { x: opened.at.x + 60, y: opened.at.y + 70 });
    const dragged = await run(gm, P.sizeNow);
    const rerendered = await run(gm, P.rerender);
    note("variation sheet, dragged then re-rendered", { from: opened.size, dragged, rerendered });
    check("a re-render keeps the size the user dragged", rerendered.height === dragged.height && rerendered.width === dragged.width, { dragged, rerendered });
    await run(gm, P.closeCurrent);
  }

  await stage(gm, "windows with no document of their own");
  await walkWindow(gm, input, "map modes", await run(gm, P.map, { which: "modes", cls: "MapModesApp" }));
  await walkWindow(gm, input, "terrain palette", await run(gm, P.map, { which: "palette", cls: "TerrainPaletteApp" }));
  await walkWindow(gm, input, "door", await run(gm, P.door, { sceneId: scene.id, cls: "DoorApp" }));
  await walkWindow(gm, input, "trapbreak", await run(gm, P.trapbreak, { cls: "TrapbreakApp" }));

  await stage(gm, "market dialogs");
  for (const [kind, cls] of [["purchase", "PurchaseDialog"], ["commission", "CommissionDialog"], ["sell", "SellDialog"], ["venture", "VentureTradeDialog"]]) {
    await walkWindow(gm, input, `market ${kind}`, await run(gm, P.market, { kind, cls, townUuid, traderId: trader.id }));
  }

  await stage(gm, "dialogs");
  await walkWindow(gm, input, "Divide prompt", await run(gm, P.divide, { traderId: trader.id }));
  await walkWindow(gm, input, "importer contract", await run(gm, P.importerDialog));
  await walkWindow(gm, input, "pack macro", await run(gm, P.macro, { name: "Uninstall — Strip Equipment Data" }));
  await walkWindow(gm, input, "restock confirm", await run(gm, P.restock));

  await stage(gm, "frames that scroll at a part root");
  await walkWindow(gm, input, "character sheet", await run(gm, P.sheet, { uuid: trader.uuid, name: "AcksCharacterSheet" }), { short: 300 });
  await walkWindow(gm, input, "monster sheet", await run(gm, P.sheet, { uuid: monster.uuid, name: "FullMonsterSheet" }), { short: 300 });
  await walkWindow(gm, input, "domain sheet", await run(gm, P.sheet, { uuid: domain.uuid, name: "DomainSheet" }), { short: 300 });
  await walkWindow(gm, input, "location sheet", await run(gm, P.sheet, { uuid: townUuid, name: "LocationSheet" }), { short: 300, drag: false });
  const goodsUuid = await run(gm, P.goodsUuid, { traderId: trader.id });
  await walkWindow(gm, input, "item sheet", await run(gm, P.sheet, { uuid: goodsUuid, name: "AcksItemSheet" }), { short: 300 });

  await stage(gm, "every other sheet this module draws");
  const SHEETS = [
    ["Actor", "acks-extras.faction"],
    ["Actor", "acks-extras.vehicle"],
    ["Actor", "acks-extras.animal"],
    ["Actor", "acks-extras.group"],
    ["Actor", "acks-extras.template"],
    ["Actor", "acks-extras.party"],
    ["Item", "acks-extras.class"],
    ["Item", "acks-extras.race"],
    ["Item", "acks-extras.merchandise"],
    ["Item", "acks-extras.marketReport"],
  ];
  for (const [kind, type] of SHEETS) {
    const short = type.split(".")[1];
    const doc = await gm.fixture(`lib/window-sheet-${short.toLowerCase()}`, kind, { name: `Window walk ${short}`, type });
    await walkWindow(gm, input, `${short} sheet`, await run(gm, P.sheet, { uuid: doc.uuid }), { short: 300 });
  }

  await stage(gm, "tool windows");
  for (const key of ["palette", "hp", "repair", "roster", "posting"]) {
    await walkWindow(gm, input, `${key} tool`, await run(gm, P.tool, { key, traderId: trader.id, townUuid }), { short: 300 });
  }

  // Each menu is opened the way the Settings screen opens it, through its registered type.
  await stage(gm, "settings menus");
  const menuKeys = await run(gm, P.menuKeys, { mod: MOD });
  note("settings menus registered", menuKeys);
  const named = ["ruledataBrowser", "importManager", "marketCatalogMenu", "storageManager"];
  check("the menus the Settings screen lists include the Ruledata Browser, the import manager, Shop sources and the storage manager", named.every((key) => menuKeys.includes(`${MOD}.${key}`)), menuKeys);
  for (const key of menuKeys) {
    await walkWindow(gm, input, `settings menu ${key.slice(MOD.length + 1)}`, await run(gm, P.menu, { key }), { short: 300 });
  }

  await stage(gm, "the storage manager and a compendium");
  await walkWindow(gm, input, "storage manager (opened on a place)", await run(gm, P.storage, { townUuid }), { short: 300 });
  const packOpened = await run(gm, P.pack, { mod: MOD });
  note("compendium", packOpened);
  check("a compendium this module declares opens", packOpened.opened === true, packOpened.why);
  check("the compendium window lists the documents its pack holds", packOpened.listed > 0 && packOpened.listed <= packOpened.indexed, { indexed: packOpened.indexed, listed: packOpened.listed });
  await run(gm, P.closeCurrent);

  await stage(gm, "the control: a window no module class claims");
  {
    const opened = await run(gm, P.foreign);
    check("core's dialog with no module class keeps no corner", opened.opened === true && opened.option === false && opened.shown === false, { option: opened.option, handle: opened.handle });
    await run(gm, P.closeCurrent);
  }

  await readRecorder(gm, "the GM seat", "while its windows opened");

  await stage(gm, "image platform facts");
  await walkImagePlatformFacts(gm);
  await readRecorder(gm, "the GM seat", "by the end of its walk");

  await stage(gm, "a player's seat");
  await run(gm, P.observe, { uuid: ability.uuid });
  const playerSeat = await seat("player");
  const player = playerSeat.api;
  const pCensus = await run(player, P.census, MOD);
  note("player census", pCensus);
  check("init, setup and ready all ran on the player's seat with no error", pCensus.boot?.phases?.length === 3 && pCensus.boot.errors.length === 0, pCensus.boot);
  await run(player, P.install);
  await run(player, P.step, { title: "a player's seat" });
  const seen = await run(player, P.sheet, { uuid: attitude.uuid, name: "AttitudeSheet" });
  check("the observed attitude sheet shows the player a corner", seen.opened === true && seen.shown === true, { option: seen.option, hidden: seen.hidden });
  await run(player, P.closeCurrent);
  const seenAbility = await run(player, P.sheet, { uuid: ability.uuid, name: "AcksAbilitySheet" });
  check("the observed ability sheet opens for the player on this module's sheet, with a corner", seenAbility.cls === "AcksAbilitySheet" && seenAbility.shown === true, { cls: seenAbility.cls, option: seenAbility.option, hidden: seenAbility.hidden });
  await run(player, P.closeCurrent);
  await readRecorder(player, "the player's seat", "while its sheets opened");
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  check("the walk reached its end", false, err?.message);
} finally {
  section("teardown");
  for (const [key, api] of Object.entries(seats)) {
    try { note(`closed (${key})`, await run(api, P.closeAll)); } catch (err) { console.error(`closeAll ${key}:`, err?.message ?? err); }
    try { await api.close(); } catch { /* the seat is gone */ }
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
