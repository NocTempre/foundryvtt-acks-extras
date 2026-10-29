/**
 * Live walk, markets: docs/markets/TESTING.md "Shop sources" (S1–S6) and "The
 * Ventures tab" (V1–V4). The Judge's choice of what stocks the shop, made in
 * its window from the settings; a catalog row bought, searched for or refused
 * by the document it was listed from; the location sheet's Trade and Ventures
 * tabs, the acting-trader picker on both, and a viewer's controls live on the
 * Ventures tab. Machine values arrive through ./_env.mjs; nothing here names a
 * port, a world, a seat or a book. Every figure typed into a fixture is
 * invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`), each brought back
 * at the walk's start to the shape its data creates and the town's market
 * added again over it: the town `markets/sources-town` (the table OBSERVER, so
 * the player seat views it without owning it), the buyer
 * `markets/sources-buyer` and the partner `markets/sources-partner` (the
 * player seat's characters), and the world item `markets/sources-lamp`, a
 * priced item no compendium holds. The buyer's purchases and the stand-in
 * item it carries are its embedded items, cleared where each step starts.
 * The chat cards a run posts are a create path: marked
 * `markets/sources-card-<n>` at teardown, and the next run retires the series
 * before it builds anything.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - the world's `marketsCatalogExcluded` setting, read first and put back;
 *   - each seat's `marketsActingTrader` client setting, read first and put back;
 *   - a rules document the run imported from the GM's staged book, removed.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MOD = "acks-extras";
const BOOKS = books(["rr"]);
const DOCS = ["availability"];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    setting: game.settings.settings.has(`${mod}.marketsCatalogExcluded`),
    menu: game.settings.menus.has(`${mod}.marketCatalogMenu`),
  }),

  install: async () => {
    const H = (globalThis.__ms1 = globalThis.__ms1 ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.apps = () => [...foundry.applications.instances.values()];
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.locSheet = (id) => H.apps().find((x) => x.actor?.id === id && H.root(x)?.classList?.contains("acks-extras-location-sheet")) ?? null;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      TR: await import(base + "markets/engine/trade.mjs"),
      IM: await import(base + "markets/engine/imports.mjs"),
      RS: await import(base + "markets/rules/sources.mjs"),
      LD: await import(base + "location/data/location-data.mjs"),
      MO: await import(base + "lib/money.mjs"),
      CB: await import(base + "importer/cookbook.mjs"),
    };
    H.closeAll = async () => {
      let n = 0;
      for (const a of H.apps()) { try { await a.close({ force: true, animate: false }); n++; } catch {} }
      return n;
    };
    if (!H.chatWrapped) {
      H.chat = [];
      H.chatCreate = ChatMessage.create;
      ChatMessage.create = async function (...args) {
        const made = await H.chatCreate.apply(this, args);
        for (const m of Array.isArray(made) ? made : [made]) if (m?.id) H.chat.push(m.id);
        return made;
      };
      H.chatWrapped = true;
    }
    H.before ??= { excluded: game.settings.get("acks-extras", "marketsCatalogExcluded"), acting: game.settings.get("acks-extras", "marketsActingTrader") };
    return { before: H.before };
  },
  /** Put back what install read: the excluded list on the GM seat, the acting trader on every seat. */
  restore: async ({ world }) => {
    const H = globalThis.__ms1;
    if (!H?.before) return { restored: false };
    if (world) await game.settings.set("acks-extras", "marketsCatalogExcluded", H.before.excluded);
    await game.settings.set("acks-extras", "marketsActingTrader", H.before.acting);
    return { restored: true, excluded: game.settings.get("acks-extras", "marketsCatalogExcluded").length, acting: !!game.settings.get("acks-extras", "marketsActingTrader") };
  },

  docs: async (ids) => Object.fromEntries(ids.map((id) => [id, acksExtras.lib.tables.hasDoc(id)])),
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ms1;
    if (H.m.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__ms1Book = { done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__ms1Book = { done: true, ok: true }; })
      .catch((e) => { globalThis.__ms1Book = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__ms1Book, session: !!globalThis.__ms1.m.CB.cookbookSessionDoc(id) }),
  importDoc: async ({ id }) => {
    globalThis.__ms1Import = { done: false };
    acksExtras.importer.cookbookImportTables([id])
      .then((r) => { globalThis.__ms1Import = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId) }; })
      .catch((e) => { globalThis.__ms1Import = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async ({ id }) => ({ ...globalThis.__ms1Import, hasDoc: acksExtras.lib.tables.hasDoc(id) }),
  removeDoc: async ({ id }) => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("ruledata-import");
    if (!svc?.removeDoc) return { removed: false, reason: "no provider" };
    await svc.removeDoc(id);
    return { removed: true, hasDoc: acksExtras.lib.tables.hasDoc(id) };
  },

  /**
   * A kept actor or world item put back in the shape `data` creates: its
   * embedded items and effects deleted, its acks-extras flags the data's, its
   * system the data's over the type's defaults, its name, and its ownership
   * the data's with this seat's own kept. A place also takes the storage flag
   * its create hook gives a new one.
   */
  reshape: async ({ kind, id, data }) => {
    const doc = kind === "Item" ? game.items.get(id) : game.actors.get(id);
    if (kind === "Actor" && doc.items.size) await doc.deleteEmbeddedDocuments("Item", doc.items.map((i) => i.id));
    if (doc.effects?.size) await doc.deleteEmbeddedDocuments("ActiveEffect", doc.effects.map((e) => e.id));
    const cls = kind === "Item" ? Item.implementation : Actor.implementation;
    const fresh = new cls({ name: data.name, type: data.type, system: foundry.utils.deepClone(data.system ?? {}) }).toObject();
    const place = data.type === "acks-extras.location";
    const flags = foundry.utils.deepClone(data.flags?.["acks-extras"] ?? {});
    if (place && !flags.storage) flags.storage = { provider: true };
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const ownership = { default: L.NONE, ...(data.ownership ?? {}), [game.user.id]: L.OWNER };
    await doc.update({ name: data.name, system: fresh.system, "flags.acks-extras": new foundry.data.operators.ForcedDeletion() });
    if (Object.keys(flags).length) await doc.update({ "flags.acks-extras": flags });
    await doc.update({ ownership }, { diff: false, recursive: false });
    return { name: doc.name, items: doc.items?.size ?? null, holds: { ...doc.ownership } };
  },
  addMarket: async ({ locationId, classOverride }) => {
    const H = globalThis.__ms1;
    const loc = game.actors.get(locationId);
    await loc.update({ "system.market": H.m.LD.emptyMarket() });
    if (classOverride) await loc.update({ "system.market.marketClassOverride": classOverride });
    return { hasMarket: !!loc.system.hasMarket, marketClass: loc.system.marketClass, ownershipDefault: loc.ownership?.default ?? null };
  },
  coin: async ({ actorId, mint = 0 }) => {
    const H = globalThis.__ms1;
    const a = game.actors.get(actorId);
    if (mint) await H.m.MO.mintCoin(a, mint);
    return { gp: H.m.MO.spendableGp(a) };
  },
  /** The town's directed searches emptied, so a step's search is not refused as one already standing. */
  clearSearches: async ({ locationId }) => {
    const loc = game.actors.get(locationId);
    await loc.update({ "system.market.goods.searches": [] });
    return { searches: loc.system.market.goods.searches.length };
  },
  clearGoods: async ({ actorId, names }) => {
    const a = game.actors.get(actorId);
    const ids = a.items.filter((i) => names.includes(i.name)).map((i) => i.id);
    if (ids.length) await a.deleteEmbeddedDocuments("Item", ids);
    return { removed: ids.length };
  },
  /** A stand-in item on an actor, the uuid of something no shop sells from. */
  carried: async ({ actorId, name }) => {
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments("Item", [{ name, type: "item", system: { cost: 3 } }]);
    return { uuid: item.uuid };
  },
  setExcluded: async ({ list }) => {
    await game.settings.set("acks-extras", "marketsCatalogExcluded", list);
    return game.settings.get("acks-extras", "marketsCatalogExcluded");
  },

  /** The town's catalog as this seat builds it: its size, its rows per source, and one named row. */
  catalogRead: async ({ locationId, name }) => {
    const H = globalThis.__ms1;
    const rows = await H.m.TR.buildCatalog(game.actors.get(locationId));
    const perSource = {};
    let unsourced = 0;
    for (const r of rows) {
      if (r.held) continue;
      const s = H.m.RS.sourceOfUuid(r.sourceUuid);
      if (!s) { unsourced++; continue; }
      perSource[s] = (perSource[s] ?? 0) + 1;
    }
    const named = rows.find((r) => r.name === name) ?? null;
    const sample = Object.fromEntries(Object.keys(perSource).map((s) => [s, rows.find((r) => H.m.RS.sourceOfUuid(r.sourceUuid) === s)?.sourceUuid ?? null]));
    return { total: rows.length, perSource, unsourced, named: named ? { name: named.name, sourceUuid: named.sourceUuid } : null, sample };
  },

  /** Open Shop sources the way the settings screen does, and read its rows. */
  sourcesOpen: async ({ mod }) => {
    const H = globalThis.__ms1;
    const menu = game.settings.menus.get(`${mod}.marketCatalogMenu`);
    const app = new menu.type();
    app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector("input[data-source]") ? r : null; }, { tries: 60, every: 200 });
    if (!root) return { opened: false };
    return {
      opened: true,
      scroll: root.classList.contains("acks-extras-scroll"),
      rows: [...root.querySelectorAll("input[data-source]")].map((el) => {
        const label = el.closest("label");
        const count = label?.querySelector("[data-tooltip]");
        return { key: el.dataset.source, checked: el.checked, label: H.text(label), named: !!label && H.text(label).length > 0, tip: !!count?.dataset.tooltip, count: Number((/\d+/.exec(H.text(count)) ?? [])[0] ?? NaN) };
      }),
    };
  },
  /** Untick the named sources in the open window and press Save; wait for the setting and the window to close. */
  sourcesSave: async ({ untick }) => {
    const H = globalThis.__ms1;
    const app = H.apps().find((a) => a.id === "acks-extras-markets-catalog-sources");
    const root = H.root(app);
    if (!root) return { saved: false, reason: "window not open" };
    for (const el of root.querySelectorAll("input[data-source]")) {
      const want = !untick.includes(el.dataset.source);
      if (el.checked !== want) { el.checked = want; el.dispatchEvent(new Event("change", { bubbles: true })); }
    }
    root.querySelector('button[type="submit"]').click();
    const stored = await H.poll(() => { const v = game.settings.get("acks-extras", "marketsCatalogExcluded"); return untick.every((k) => v.includes(k)) ? v : null; }, { tries: 60, every: 200 });
    const closed = await H.poll(() => !H.apps().some((a) => a.id === "acks-extras-markets-catalog-sources"), { tries: 40, every: 150 });
    return { saved: !!stored, stored, closed: !!closed };
  },

  /** Open the town's sheet and read both market tabs. */
  sheetRead: async ({ locationId }) => {
    const H = globalThis.__ms1;
    const loc = game.actors.get(locationId);
    if (!H.locSheet(locationId)) await loc.sheet.render(true);
    const app = await H.poll(() => { const a = H.locSheet(locationId); return a && H.root(a)?.querySelector('section[data-tab="ventures"]') ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { opened: false };
    const el = H.root(app);
    const sec = (id) => el.querySelector(`section[data-tab="${id}"]`);
    const part = (s) => ({
      picker: !!s?.querySelector("select[data-trade-trader]"),
      pickValue: s?.querySelector("select[data-trade-trader]")?.value ?? null,
      classLine: !!s?.querySelector("p.acks-extras-markets-class"),
      catalogRows: s?.querySelectorAll("tr[data-trade-name]").length ?? 0,
      enter: !!s?.querySelector('[data-action="ventureEnter"]'),
      category: !!s?.querySelector("[data-venture-category]"),
      exchange: !!s?.querySelector('[data-action="marketsExchange"]'),
    });
    const nav = [...el.querySelectorAll("nav.tabs a[data-tab]")].map((a) => ({ id: a.dataset.tab, label: H.text(a) }));
    return { opened: true, nav, active: app.tabGroups.primary, trade: part(sec("trade")), ventures: part(sec("ventures")), owner: loc.isOwner };
  },
  /** Click a tab in the nav and read which section shows. */
  sheetTab: async ({ locationId, tab }) => {
    const H = globalThis.__ms1;
    const app = H.locSheet(locationId);
    H.root(app)?.querySelector(`nav.tabs a[data-tab="${tab}"]`)?.click();
    await H.poll(() => app.tabGroups.primary === tab, { tries: 30, every: 100 });
    const height = (id) => H.root(app)?.querySelector(`section[data-tab="${id}"]`)?.getBoundingClientRect().height ?? 0;
    return { active: app.tabGroups.primary, trade: height("trade"), ventures: height("ventures") };
  },
  /** Choose a trader on one tab's picker, wait for the redraw, and read both pickers. */
  sheetPick: async ({ locationId, tab, traderId }) => {
    const H = globalThis.__ms1;
    const uuid = game.actors.get(traderId).uuid;
    const pick = H.root(H.locSheet(locationId))?.querySelector(`section[data-tab="${tab}"] select[data-trade-trader]`);
    if (!pick) return { found: false };
    pick.value = uuid;
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    const stored = await H.poll(() => game.settings.get("acks-extras", "marketsActingTrader") === uuid, { tries: 40, every: 150 });
    const drawn = await H.poll(() => {
      const el = H.root(H.locSheet(locationId));
      const values = [...(el?.querySelectorAll("select[data-trade-trader]") ?? [])].map((s) => s.value);
      return values.length === 2 && values.every((v) => v === uuid) ? values : null;
    }, { tries: 40, every: 150 });
    return { found: true, stored: !!stored, both: !!drawn, values: drawn };
  },
  /** The Trade tab's label in the nav, e.g. "Trade (n)". */
  tradeLabel: async ({ locationId }) => globalThis.__ms1.text(globalThis.__ms1.root(globalThis.__ms1.locSheet(locationId))?.querySelector('nav.tabs a[data-tab="trade"]')),
  waitTradeLabel: async ({ locationId, not }) => {
    const H = globalThis.__ms1;
    return (await H.poll(() => { const t = H.text(H.root(H.locSheet(locationId))?.querySelector('nav.tabs a[data-tab="trade"]')); return t && t !== not ? t : null; }, { tries: 60, every: 200 })) ?? null;
  },

  /** A directed search through the engine, naming a row by its uuid and a name that is not its own; the stored row read back. */
  searchApi: async ({ locationId, buyerId, itemName, sourceUuid }) => {
    const H = globalThis.__ms1;
    const loc = game.actors.get(locationId);
    const resolutionId = foundry.utils.randomID();
    const result = await H.m.IM.performItemSearch(loc, { buyerUuid: game.actors.get(buyerId).uuid, itemName, sourceUuid, qty: 1, resolutionId });
    const row = (loc.system.market.goods.searches ?? []).find((s) => s.id === resolutionId) ?? null;
    return { ok: !!result?.ok, error: result?.error ?? null, row: row ? { itemName: row.itemName, sourceUuid: row.sourceUuid } : null };
  },
  /** A purchase through the engine, naming a row by its uuid and a name that is not its own. */
  buyApi: async ({ locationId, buyerId, itemName, sourceUuid }) => {
    const H = globalThis.__ms1;
    const r = await H.m.TR.performPurchase(game.actors.get(locationId), { buyerUuid: game.actors.get(buyerId).uuid, itemName, sourceUuid, qty: 1, resolutionId: foundry.utils.randomID() });
    return { ok: !!r?.ok, error: r?.error ?? null };
  },
  /**
   * The row's own control on the Trade tab, pressed as a user would: Buy, the
   * dialog answered for the named buyer, where the market can supply it now;
   * else Search, its quantity prompt answered. Returns what landed.
   */
  rowUI: async ({ locationId, name, buyerId }) => {
    const H = globalThis.__ms1;
    const app = H.locSheet(locationId);
    H.root(app)?.querySelector('nav.tabs a[data-tab="trade"]')?.click();
    const row = await H.poll(() => [...(H.root(H.locSheet(locationId))?.querySelectorAll('section[data-tab="trade"] tr[data-trade-name]') ?? [])].find((tr) => tr.dataset.tradeName === name) ?? null, { tries: 40, every: 150 });
    if (!row) return { row: false };
    const loc = game.actors.get(locationId);
    const buyer = game.actors.get(buyerId);
    const buy = row.querySelector('[data-action="openPurchase"]');
    if (buy) {
      buy.click();
      const form = await H.poll(() => document.querySelector('form.application select[name="buyerUuid"]')?.closest("form") ?? null, { tries: 40, every: 150 });
      if (!form) return { row: true, control: "buy", dialog: false };
      form.querySelector('select[name="buyerUuid"]').value = buyer.uuid;
      form.querySelector('button[type="submit"]').click();
      const got = await H.poll(() => buyer.items.find((i) => i.name === name) ?? null, { tries: 60, every: 200 });
      return { row: true, control: "buy", dialog: true, delivered: !!got, deliveredName: got?.name ?? null };
    }
    const search = row.querySelector('[data-action="postSearch"]');
    if (!search) return { row: true, control: null };
    const before = (loc.system.market.goods.searches ?? []).length;
    search.click();
    const ok = await H.poll(() => document.querySelector('.application.dialog input[name="value"]')?.closest(".application")?.querySelector('button[data-action="ok"]') ?? null, { tries: 40, every: 150 });
    if (!ok) return { row: true, control: "search", dialog: false };
    ok.click();
    const added = await H.poll(() => ((loc.system.market.goods.searches ?? []).length > before ? loc.system.market.goods.searches.at(-1) : null), { tries: 60, every: 200 });
    return { row: true, control: "search", dialog: true, stored: added ? { itemName: added.itemName, sourceUuid: added.sourceUuid } : null };
  },

  /** On a seat that views the town without owning it: the Ventures tab's controls are live. */
  viewerRead: async ({ locationId }) => {
    const H = globalThis.__ms1;
    const loc = game.actors.get(locationId);
    await loc.sheet.render(true);
    const app = await H.poll(() => { const a = H.locSheet(locationId); return a && H.root(a)?.querySelector('section[data-tab="ventures"] [data-action="ventureEnter"]') ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { opened: !!H.locSheet(locationId), ventures: false, owner: loc.isOwner };
    H.root(app).querySelector('nav.tabs a[data-tab="ventures"]')?.click();
    await H.poll(() => app.tabGroups.primary === "ventures", { tries: 30, every: 100 });
    const sec = H.root(app).querySelector('section[data-tab="ventures"]');
    return {
      opened: true,
      ventures: true,
      owner: loc.isOwner,
      sees: loc.testUserPermission(game.user, "OBSERVER"),
      enterLive: sec.querySelector('[data-action="ventureEnter"]')?.disabled === false,
      pickerLive: (() => { const s = sec.querySelector("select[data-trade-trader]"); return s ? s.disabled === false : null; })(),
    };
  },

  closeAll: async () => globalThis.__ms1?.closeAll?.() ?? 0,
  /** The ids of the chat cards this seat posted since the last call. */
  takeChat: async () => globalThis.__ms1?.chat?.splice(0) ?? [],
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.markets?.buildCatalog && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
const CARDS = "markets/sources-card";
/** Markers in a row that carry nothing before a series counts as ended: a lost mark leaves a gap. */
const SERIES_GAP = 5;
/** Retire a marked series `<prefix>-1`, `-2`, … past its gaps; the count of markers that carried a card. */
async function retireSeries(prefix, kind) {
  let retired = 0;
  for (let n = 1, empty = 0; empty < SERIES_GAP; n++) {
    const r = await gm.retire(`${prefix}-${n}`, kind);
    if (r.removed.length || r.missing.length || r.failed.length) { retired++; empty = 0; } else empty++;
  }
  return retired;
}
/**
 * Mark the cards every seat posted as one series. Every card takes the next
 * number whether or not its mark answers, so a mark that lands after its call
 * timed out never shares a number with the next card's.
 */
async function markCards() {
  const ids = [];
  for (const api of Object.values(seats)) ids.push(...(await run(api, P.takeChat)));
  let n = 0;
  const lost = [];
  for (const id of new Set(ids)) {
    n++;
    try { await gm.mark(`ChatMessage.${id}`, `${CARDS}-${n}`); } catch { lost.push(id); }
  }
  return { marked: n - lost.length, lost: lost.length };
}
/** The kept document marked `marker`, brought back to the shape `data` creates, or one built from it now. */
async function keep(marker, kind, data) {
  const doc = await gm.fixture(marker, kind, data);
  if (!doc.built) note(`shape: ${marker}`, await run(gm, P.reshape, { kind, id: doc.id, data }));
  return doc;
}

const imported = [];
try {
  section("seats");
  gm = await seat("gm");
  const census = await run(gm, P.census, MOD);
  note("gm census", census);
  check("S1: the GM seat is the active GM, and the world registers the shop-sources setting and its settings window", census.activeGMIsSelf && census.role === 4 && census.setting && census.menu, { role: census.role, module: census.module, setting: census.setting, menu: census.menu });
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");
  note("install (gm)", await run(gm, P.install));
  const player = await seat("player");
  const pc = await run(player, P.census, MOD);
  note("install (player)", await run(player, P.install));

  section("the availability rules and the book");
  for (const book of BOOKS) {
    note(`book ${book.id}`, await run(gm, P.connectBook, book));
    let state = null;
    for (let n = 0; n < 150; n++) { state = await run(gm, P.bookState, { id: book.id }); if (state.done || state.session) break; await sleep(2000); }
    note(`book ${book.id} state`, state);
  }
  for (const id of DOCS) {
    if ((await run(gm, P.docs, DOCS))[id]) continue;
    note(`import ${id} from the book`, await run(gm, P.importDoc, { id }));
    let st = null;
    for (let n = 0; n < 150; n++) { st = await run(gm, P.importState, { id }); if (st.done) break; await sleep(2000); }
    note(`import ${id} state`, st);
    if (st?.ok && st.hasDoc) imported.push(id);
  }
  const docs = await run(gm, P.docs, DOCS);
  note("documents", docs);

  section("fixtures");
  note("retired", { cards: await retireSeries(CARDS, "ChatMessage") });
  const L = { OBSERVER: 2, OWNER: 3 };
  const LAMP = "QA Sources Lamp";
  const town = await keep("markets/sources-town", "Actor", { name: "QA Sources Town", type: "acks-extras.location", ownership: { default: L.OBSERVER } });
  const buyer = await keep("markets/sources-buyer", "Actor", { name: "QA Sources Buyer", type: "character", ownership: { [pc.userId]: L.OWNER } });
  const partner = await keep("markets/sources-partner", "Actor", { name: "QA Sources Partner", type: "character", ownership: { [pc.userId]: L.OWNER } });
  const lamp = await keep("markets/sources-lamp", "Item", { name: LAMP, type: "item", system: { cost: 7 } });
  note("market", await run(gm, P.addMarket, { locationId: town.id, classOverride: 3 }));
  note("coin", await run(gm, P.coin, { actorId: buyer.id, mint: 50 }));

  section("S2. every source stocks the shop until the Judge unticks one");
  note("excluded for the walk", await run(gm, P.setExcluded, { list: [] }));
  const all = await run(gm, P.catalogRead, { locationId: town.id, name: LAMP });
  note("catalog", { total: all.total, perSource: all.perSource, unsourced: all.unsourced });
  const packs = Object.entries(all.perSource).filter(([s]) => s !== "world").sort((a, b) => b[1] - a[1]);
  const [topPack, topCount] = packs[0] ?? [null, 0];
  check("S2: with nothing left out the catalog lists the world's item as its own document and the compendiums' items as theirs, and every row names a source", all.named?.sourceUuid === lamp.uuid && packs.length >= 1 && all.unsourced === 0, { lamp: all.named, packs: packs.length, unsourced: all.unsourced });

  section("S3. the Shop sources window");
  const sheet0 = await run(gm, P.sheetRead, { locationId: town.id });
  const label0 = await run(gm, P.tradeLabel, { locationId: town.id });
  note("trade label before", label0);
  const win = await run(gm, P.sourcesOpen, { mod: MOD });
  note("window", { opened: win.opened, rows: (win.rows ?? []).length });
  const worldRow = (win.rows ?? []).find((r) => r.key === "world");
  const packRow = (win.rows ?? []).find((r) => r.key === topPack);
  check("S3: the window opens inside the scroll contract with the world's items first and every source ticked, the busiest compendium among them", win.opened && win.scroll && win.rows[0]?.key === "world" && win.rows.every((r) => r.checked) && !!packRow, { first: win.rows?.[0]?.key, ticked: win.rows?.every((r) => r.checked), pack: !!packRow });
  check("S3: each row is captioned and its count carries a tooltip; a compendium's count is no less than what the catalog lists from it", (win.rows ?? []).every((r) => r.named && r.tip) && packRow?.count >= topCount && worldRow?.count >= 1, { packCount: packRow?.count, listed: topCount, world: worldRow?.count });

  section("S4. unticking a compendium empties its rows from every shop");
  const saved = await run(gm, P.sourcesSave, { untick: [topPack] });
  note("saved", saved);
  check("S4: Save writes the unticked compendium into the setting and closes the window", saved.saved && saved.closed && saved.stored?.includes(topPack));
  const after = await run(gm, P.catalogRead, { locationId: town.id, name: LAMP });
  note("catalog after", { total: after.total, perSource: after.perSource });
  check("S4: the catalog lists nothing from the compendium left out and keeps the world's item", !after.perSource[topPack] && after.named?.sourceUuid === lamp.uuid && after.total < all.total, { left: after.perSource[topPack] ?? 0, before: all.total, after: after.total });
  const label1 = await run(gm, P.waitTradeLabel, { locationId: town.id, not: label0 });
  note("trade label after", label1);
  check("S4: the open sheet redraws on the change, its Trade tab counting the shorter list", sheet0.opened && !!label1 && label1 !== label0, { before: label0, after: label1 });

  section("S5. a row is placed as the document it was listed from");
  const bogus = "QA no such item";
  const placed = await run(gm, P.searchApi, { locationId: town.id, buyerId: buyer.id, itemName: bogus, sourceUuid: lamp.uuid });
  note("search by the row's uuid", placed);
  check("S5: a search naming the row's uuid and a name nothing carries is placed for the row's own item, its source kept", placed.ok && placed.row?.itemName === LAMP && placed.row?.sourceUuid === lamp.uuid, placed);
  const outRow = all.sample[topPack];
  const refused = await run(gm, P.searchApi, { locationId: town.id, buyerId: buyer.id, itemName: bogus, sourceUuid: outRow });
  note("search by a left-out row's uuid", refused);
  check("S5: a row of a compendium left out is refused", !refused.ok && refused.error === "noSource", refused);
  await run(gm, P.clearGoods, { actorId: buyer.id, names: ["QA Sources Stand-in"] });
  const standIn = await run(gm, P.carried, { actorId: buyer.id, name: "QA Sources Stand-in" });
  const embedded = await run(gm, P.buyApi, { locationId: town.id, buyerId: buyer.id, itemName: "QA Sources Stand-in", sourceUuid: standIn.uuid });
  note("buy by a carried item's uuid", embedded);
  check("S5: an item a character carries is never a shop's source", !embedded.ok && embedded.error === "noSource", embedded);
  await run(gm, P.clearGoods, { actorId: buyer.id, names: ["QA Sources Stand-in", LAMP] });

  section("S6. the row's own control on the Trade tab");
  note("searches cleared", await run(gm, P.clearSearches, { locationId: town.id }));
  await run(gm, P.sheetTab, { locationId: town.id, tab: "trade" });
  const ui = await run(gm, P.rowUI, { locationId: town.id, name: LAMP, buyerId: buyer.id });
  note("row control", ui);
  if (ui.control === "buy") check("S6: Buy on the row, answered in its dialog, delivers the row's item to the buyer", ui.dialog && ui.delivered && ui.deliveredName === LAMP, ui);
  else check("S6: Search on the row (the market cannot supply it now), answered in its prompt, stores a search for the row's own document", ui.control === "search" && ui.dialog && ui.stored?.sourceUuid === lamp.uuid, { ui, availability: docs.availability });
  await run(gm, P.clearGoods, { actorId: buyer.id, names: [LAMP] });

  section("V1–V3. the Trade and Ventures tabs");
  const tabs = await run(gm, P.sheetRead, { locationId: town.id });
  note("tabs", { nav: tabs.nav.map((n) => n.id), trade: tabs.trade, ventures: tabs.ventures });
  const at = (id) => tabs.nav.findIndex((n) => n.id === id);
  check("V1: the nav carries Trade and then Ventures", at("trade") >= 0 && at("ventures") === at("trade") + 1, tabs.nav.map((n) => n.id));
  check("V1: Trade holds the shop — the catalog and the changer — and no venture control", tabs.trade.catalogRows > 0 && tabs.trade.exchange && !tabs.trade.enter && !tabs.trade.category, tabs.trade);
  check("V1: Ventures holds Enter and the merchandise picker and no shop row", tabs.ventures.enter && tabs.ventures.category && tabs.ventures.catalogRows === 0 && !tabs.ventures.exchange, tabs.ventures);
  check("V1: both tabs carry the acting-trader picker and the class line", tabs.trade.picker && tabs.ventures.picker && tabs.trade.classLine && tabs.ventures.classLine);
  const shown = await run(gm, P.sheetTab, { locationId: town.id, tab: "ventures" });
  note("ventures shown", shown);
  check("V2: pressing Ventures shows its section and hides Trade's", shown.active === "ventures" && shown.ventures > 0 && shown.trade === 0, shown);
  const picked = await run(gm, P.sheetPick, { locationId: town.id, tab: "ventures", traderId: partner.id });
  note("picked on Ventures", picked);
  check("V3: a trader picked on the Ventures tab is stored for this client and both tabs' pickers show it after the redraw", picked.found && picked.stored && picked.both, picked);

  section("V4. a seat viewing the town without owning it");
  const viewer = await run(player, P.viewerRead, { locationId: town.id });
  note("viewer", viewer);
  check("V4: the player seat views the town without owning it, and the Ventures tab's Enter and picker stay live", viewer.opened && viewer.ventures && viewer.sees && !viewer.owner && viewer.enterLive && viewer.pickerLive !== false, viewer);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  for (const [key, api] of Object.entries(seats)) {
    try { note(`restored (${key})`, await run(api, P.restore, { world: key === "gm" })); } catch (err) { console.error(`restore ${key}:`, err?.message ?? err); }
  }
  try { if (gm) note("cards marked", await markCards()); } catch (err) { console.error("markCards:", err?.message ?? err); }
  for (const id of imported) { try { note(`${id} document removed`, await run(gm, P.removeDoc, { id })); } catch (err) { console.error("removeDoc:", err?.message ?? err); } }
  for (const [key, api] of Object.entries(seats)) {
    try { note(`closed (${key})`, await run(api, P.closeAll)); } catch (err) { console.error(`closeAll ${key}:`, err?.message ?? err); }
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
