/**
 * Live walk, markets: markets + location + the lib pointer.
 * Walks: the default-trader ad hoc; the known-market walk (1–7); the network walk (1–6);
 * reports step 10 and the step-4 hunk (picks, the card's link); the ledger-length ad hoc;
 * the hit-point tool from the party sheet. Machine values arrive through ./_env.mjs.
 * Every figure typed into a
 * fixture is invented; imported figures stay in this log and are never quoted by name.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - the two seats' own client state: the dice rig, the patched notification methods,
 *     the wrapped ChatMessage.create, and each seat's `marketsActingTrader` client setting
 *     (read first, put back);
 *   - a book connected on the GM seat with remember:false; a rules document the run
 *     imported is removed; a trade house the run made is swept and its setting cleared;
 *   - the shared clock: one day per advance, counted and reported.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "m" + Math.random().toString(36).slice(2, 8);
const MOD = "acks-extras";
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = shotDir();
const BOOKS = books(["rr"]); // the GM's staged copies, from ACKS_TEST_BOOKS; empty, the walk takes the bookless path
const DOCS = ["mercantile", "availability"];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const shot = async (seat, slug, selector) => {
  if (!SHOTS) return null;
  try {
    const seen = await seat.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.scrollIntoView({ block: "nearest" }); return !!el; })()`);
    await sleep(500);
    const r = await seat.shot(`${SHOT_DIR}/${slug}.png`, selector);
    note(`shot ${slug}`, { seen, ...r });
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  census: async (mod) => ({
    foundry: game.version,
    system: game.system.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    worldTime: game.time.worldTime,
    working: acksExtras.formation?.apiVersion ?? null,
    markets: Object.keys(acksExtras.markets ?? {}).length,
    reportType: game.documentTypes.Item.includes("acks-extras.marketReport"),
    merchType: game.documentTypes.Item.includes("acks-extras.merchandise"),
    character: game.user.character?.id ?? null,
    actingTrader: game.settings.get("acks-extras", "marketsActingTrader"),
    house: String(game.settings.get("acks-extras", "marketsTradeHouse") ?? ""),
  }),
  docs: async () => Object.fromEntries(["mercantile", "availability", "demand", "magicItems"].map((id) => [id, acksExtras.lib.tables.hasDoc(id)])),

  install: async () => {
    const H = (globalThis.__c2 = globalThis.__c2 ?? {});
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
    H.appBy = (cls) => H.apps().find((a) => H.root(a)?.classList?.contains(cls)) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.M = acksExtras.markets;
    H.A = acksExtras.henchmen;
    H.T = acksExtras.lib.tables;
    H.F = acksExtras.formation;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      CB: await import(base + "importer/cookbook.mjs"),
      VE: await import(base + "markets/engine/ventures.mjs"),
      TR: await import(base + "markets/engine/trade.mjs"),
      KM: await import(base + "markets/engine/known-market.mjs"),
      NW: await import(base + "markets/engine/network.mjs"),
      PR: await import(base + "markets/engine/printed.mjs"),
      MC: await import(base + "markets/engine/merchandise.mjs"),
      TO: await import(base + "markets/engine/trade-objects.mjs"),
      DM: await import(base + "markets/engine/demand.mjs"),
      PA: await import(base + "markets/engine/parties.mjs"),
      TT: await import(base + "markets/apps/trade-tab.mjs"),
      AR: await import(base + "markets/rules/arbitrage.mjs"),
      LD: await import(base + "location/data/location-data.mjs"),
      RC: await import(base + "henchmen/engine/recruitment.mjs"),
      AD: await import(base + "henchmen/acks-adapter.mjs"),
      MO: await import(base + "lib/money.mjs"),
      WT: await import(base + "lib/world-time.mjs"),
    };
    H.day = () => H.m.WT.dayOfWorldTime(game.time.worldTime);
    H.uFor = (face, faces) => (faces - face + 0.5) / faces;
    H.sheetOf = (actorId) => H.apps().find((x) => x.actor?.id === actorId && H.root(x)?.querySelector?.("nav.tabs, nav.acks-tabs")) ?? null;
    H.locSheet = (id) => H.apps().find((x) => x.actor?.id === id && H.root(x)?.classList?.contains("acks-extras-location-sheet")) ?? null;
    H.plain = (v) => JSON.parse(JSON.stringify(v?.toObject?.() ?? v ?? null));
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
    H.takeNotes = () => H.notes.splice(0);
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
    H.takeChat = () => H.chat.splice(0);
    H.unrig = () => { if (H.rig0) { CONFIG.Dice.randomUniform = H.rig0; H.rig0 = null; } };
    H.closeAll = async () => {
      let n = 0;
      for (const a of H.apps()) { try { await a.close({ force: true }); n++; } catch {} }
      for (const w of Object.values(ui.windows ?? {})) { try { await w.close({ force: true }); n++; } catch {} }
      return n;
    };
    H.settingBefore = game.settings.get("acks-extras", "marketsActingTrader");
    return { settingBefore: H.settingBefore };
  },

  /** Connect the staged book on this seat, fired into a global. */
  connectBook: async ({ id, path }) => {
    const H = globalThis.__c2;
    if (H.m.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__c2Book = { done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__c2Book = { done: true, ok: true }; })
      .catch((e) => { globalThis.__c2Book = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__c2Book, session: !!globalThis.__c2.m.CB.cookbookSessionDoc(id) }),
  importDoc: async ({ id }) => {
    globalThis.__c2Import = { done: false };
    acksExtras.importer.cookbookImportTables([id])
      .then((r) => { globalThis.__c2Import = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId), missingBooks: r?.missingBooks ?? [] }; })
      .catch((e) => { globalThis.__c2Import = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async ({ id }) => ({ ...globalThis.__c2Import, hasDoc: globalThis.__c2.T.hasDoc(id) }),
  removeDoc: async ({ id }) => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("ruledata-import");
    if (!svc?.removeDoc) return { removed: false, reason: "no provider" };
    await svc.removeDoc(id);
    return { removed: true, hasDoc: globalThis.__c2.T.hasDoc(id) };
  },
  reloadDocs: async () => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("ruledata-import");
    if (svc?.reload) await svc.reload();
    return Object.fromEntries(["mercantile", "availability"].map((id) => [id, globalThis.__c2.T.hasDoc(id)]));
  },

  addMarket: async ({ locationId, classOverride }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    await loc.update({ "system.market": H.m.LD.emptyMarket() });
    if (classOverride) await loc.update({ "system.market.marketClassOverride": classOverride });
    return { hasMarket: !!loc.system.hasMarket, marketClass: loc.system.marketClass, ownershipDefault: loc.ownership?.default ?? null };
  },
  setOverride: async ({ locationId, classOverride }) => {
    const loc = game.actors.get(locationId);
    await loc.update({ "system.market.marketClassOverride": classOverride });
    return { marketClass: loc.system.marketClass };
  },
  coin: async ({ actorId, mint = 0 }) => {
    const H = globalThis.__c2;
    const a = game.actors.get(actorId);
    if (mint) await H.m.MO.mintCoin(a, mint);
    return { gp: H.m.MO.spendableGp(a) };
  },
  /** An ability item that names the power, with an Active Effect carrying the changes and a condition. */
  networkPower: async ({ actorId, name, changes, condition }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments("Item", [{ name, type: "ability" }]);
    const [fx] = await item.createEmbeddedDocuments("ActiveEffect", [{ name, changes: changes.map((c) => ({ key: c.key, mode: 2, value: String(c.value) })), flags: { "acks-extras": { condition } } }]);
    const H = globalThis.__c2;
    return { itemId: item.id, effectId: fx.id, steps: H.m.NW.networkSteps(actor), hasFlag: H.A.effects?.hasEffectFlag ? H.A.effects.hasEffectFlag(actor, "marketClass") : null };
  },
  setEffectChanges: async ({ actorId, itemId, effectId, changes }) => {
    const actor = game.actors.get(actorId);
    const fx = actor.items.get(itemId).effects.get(effectId);
    await fx.update({ changes: changes.map((c) => ({ key: c.key, mode: 2, value: String(c.value) })) });
    return { steps: globalThis.__c2.m.NW.networkSteps(actor) };
  },
  plainAbility: async ({ actorId, name }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments("Item", [{ name, type: "ability" }]);
    return { itemId: item.id, steps: globalThis.__c2.m.NW.networkSteps(actor) };
  },
  settingSet: async ({ key, value }) => { const before = game.settings.get("acks-extras", key); await game.settings.set("acks-extras", key, value); return { before, now: game.settings.get("acks-extras", key) }; },
  day: async () => ({ day: globalThis.__c2.day(), worldTime: game.time.worldTime }),
  // Full days left before the market month rolls: a venture is keyed to the month it was entered in.
  monthRoom: async () => {
    const { marketMonthStart } = await import("/modules/acks-extras/scripts/markets/engine/trade.mjs");
    const t = game.time.worldTime;
    const monthStart = marketMonthStart(t);
    let daysLeft = 0;
    while (daysLeft < 90 && marketMonthStart(t + (daysLeft + 1) * 86400) === monthStart) daysLeft++;
    return { monthStart, daysLeft };
  },
  skipDays: async ({ n }) => { const before = game.time.worldTime; await game.time.advance(n * 86400); return { before, after: game.time.worldTime, days: n }; },
  /** GM: one day forward, then wait for the venture days that were due. */
  advanceDay: async ({ locationId = null, actionId = null } = {}) => {
    const H = globalThis.__c2;
    const before = H.day();
    H.takeChat();
    await game.time.advance(86400);
    let resolved = null;
    if (locationId && actionId) { resolved = await H.poll(() => (game.actors.get(locationId)?.system?.market?.goods?.actions ?? []).find((a) => a.id === actionId)?.status === "done" || null, { tries: 60, every: 500 }); await H.sleep(1500); }
    else await H.sleep(2500);
    return { before, day: H.day(), resolved: !!resolved, chat: H.takeChat() };
  },

  catalog: async ({ locationId }) => {
    const rows = await globalThis.__c2.m.TR.buildCatalog(game.actors.get(locationId));
    return rows.filter((r) => !r.magic && !r.held).map((r) => ({ name: r.name, costGp: r.costGp, key: r.key })).sort((a, b) => a.costGp - b.costGp).slice(0, 120);
  },
  availability: async ({ locationId, itemName, costGp, traderId = null }) => {
    const r = globalThis.__c2.m.TR.availabilityFor(game.actors.get(locationId), { itemName, costGp, trader: traderId ? game.actors.get(traderId) : null });
    return { status: r.status, band: r.band ?? null, remaining: r.remaining ?? null, capParty: r.capParty ?? null, capMarket: r.capMarket ?? null };
  },
  purchase: async ({ locationId, buyerId, itemName, qty = 1 }) => {
    const H = globalThis.__c2;
    H.takeChat();
    const loc = game.actors.get(locationId);
    const buyer = game.actors.get(buyerId);
    const r = await H.m.TR.performPurchase(loc, { buyerUuid: buyer.uuid, itemName, qty });
    await H.sleep(800);
    const rows = (loc.system.market.marketLog ?? []).filter((x) => x.actorUuid === buyer.uuid).map((x) => ({ type: x.type, day: H.m.WT.dayOfWorldTime(x.time) }));
    return { ok: !!r?.ok, error: r?.error ?? null, stamped: rows.length, rows, chat: H.takeChat() };
  },
  knownRead: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    return { day: H.day(), known: H.M.marketKnownTo(loc, a), source: H.M.knownSource(loc, a), effective: H.A.effectiveMarketClass(loc, a), judgeList: H.m.KM.knownMarketsOf(a).includes(loc.uuid) };
  },
  /** The location sheet's Trade tab on this seat, acting as a trader when one is named. */
  tradeTab: async ({ locationId, traderId = null }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    await loc.sheet.render(true);
    let app = await H.poll(() => { const a = H.locSheet(locationId); return a && H.root(a)?.querySelector("nav.tabs") ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { opened: false };
    H.root(app).querySelector('nav.tabs a[data-tab="trade"]')?.click();
    await H.sleep(600);
    if (traderId) {
      const pick = H.root(H.locSheet(locationId))?.querySelector("select[data-trade-trader]");
      if (pick) {
        pick.value = game.actors.get(traderId).uuid;
        pick.dispatchEvent(new Event("change", { bubbles: true }));
        await H.sleep(1200);
      }
    }
    app = H.locSheet(locationId);
    const el = H.root(app);
    H.root(app).querySelector('nav.tabs a[data-tab="trade"]')?.click();
    await H.sleep(300);
    const sec = el.querySelector('section[data-tab="trade"]');
    const pick = el.querySelector("select[data-trade-trader]");
    return {
      opened: true,
      acting: H.m.TT.actingTrader(app)?.id ?? null,
      pickValue: pick?.value ?? null,
      pickOptions: pick ? [...pick.options].map((o) => ({ uuid: o.value, text: o.textContent.trim() })) : [],
      candidates: H.m.TT.tradeCandidates().map((a) => ({ id: a.id, name: a.name, retainer: !!a.system?.retainer?.enabled })),
      classLine: H.text(sec?.querySelector("p.acks-extras-markets-class")),
      knownButton: H.text(sec?.querySelector('[data-action="toggleKnownMarket"]')),
      categories: [...(sec?.querySelectorAll("[data-venture-category] option") ?? [])].map((o) => o.value),
      partyBlock: H.text(sec?.querySelector("details.acks-extras-markets-parties")),
      ventureStatus: H.text(sec?.querySelector(".acks-extras-markets-ventures p.hint")),
    };
  },
  knownToggle: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = H.root(H.locSheet(locationId))?.querySelector('[data-action="toggleKnownMarket"]');
    if (!btn) return { pressed: false };
    btn.click();
    await H.sleep(1200);
    const sec = H.root(H.locSheet(locationId))?.querySelector('section[data-tab="trade"]');
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    return { pressed: true, knownButton: H.text(sec?.querySelector('[data-action="toggleKnownMarket"]')), classLine: H.text(sec?.querySelector("p.acks-extras-markets-class")), source: H.M.knownSource(loc, a), known: H.M.marketKnownTo(loc, a), notes: H.takeNotes() };
  },
  /** Press Enter the market on the open Trade tab and read the dialog; submit with a cargo figure and a mode unless told to read only. */
  ventureEnterUI: async ({ locationId, other = 0, mode = null, submit = true }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureEnter"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="other"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, dialog: false, notes: H.takeNotes() };
    const dialog = input.closest(".application");
    dialog.dataset.qaEnter = "1";
    const fieldset = [...dialog.querySelectorAll("fieldset")].find((f) => /Mercantile network/i.test(H.text(f.querySelector("legend"))));
    const select = dialog.querySelector('select[name="networkMode"]');
    const out = { pressed: true, dialog: true, networkText: H.text(fieldset), modes: select ? [...select.options].map((o) => o.value) : [], notes: H.takeNotes() };
    if (!submit) return out;
    input.value = String(other);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (mode && select) { select.value = mode; select.dispatchEvent(new Event("change", { bubbles: true })); }
    const t0 = game.time.worldTime;
    dialog.querySelector('button[data-action="ok"]').click();
    await H.sleep(1500);
    const loc = game.actors.get(locationId);
    const action = (loc.system.market.goods.actions ?? []).filter((a) => a.kind === "enter" && a.postedTime >= t0).at(-1) ?? null;
    return { ...out, submitted: true, notes: H.takeNotes(), action: action ? { id: action.id, postedTime: action.postedTime, cargoSt: action.cargoSt, networkMode: action.networkMode, status: action.status } : null };
  },
  closeDialog: async () => { const d = document.querySelector(".application.dialog[data-qa-enter]"); const app = globalThis.__c2.apps().find((a) => globalThis.__c2.root(a) === d); await app?.close({ force: true }); return { closed: !!app }; },
  ventureApi: async ({ locationId, kind, actorId, cargoSt = 0, category = "", networkMode = "auto" }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    const t0 = game.time.worldTime;
    const r = await H.M.performVentureAction(loc, { kind, actorUuid: a.uuid, cargoSt, category, networkMode, resolutionId: foundry.utils.randomID() });
    await H.sleep(600);
    const action = (loc.system.market.goods.actions ?? []).filter((x) => x.kind === kind && x.actorUuid === a.uuid && x.postedTime >= t0).at(-1) ?? null;
    return { ok: !!r?.ok, error: r?.error ?? null, action: action ? { id: action.id, postedTime: action.postedTime, cargoSt: action.cargoSt, networkMode: action.networkMode, status: action.status } : null };
  },
  ventureLeave: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    const a = game.actors.get(actorId);
    const t0 = Date.now();
    const synced = await H.poll(() => H.M.ventureOf(game.actors.get(locationId), H.M.partyOf(a).id)?.entered || null, { tries: 50, every: 200 });
    const r = await H.M.performVentureLeave(game.actors.get(locationId), { actorUuid: a.uuid });
    return { ok: !!r?.ok, error: r?.error ?? null, enteredHere: !!synced, waitedMs: Date.now() - t0 };
  },
  stepsOf: async ({ actorId }) => globalThis.__c2.m.NW.networkSteps(game.actors.get(actorId)),
  ownershipRead: async ({ actorId }) => { const a = game.actors.get(actorId); return { visible: !!a, owns: !!a?.testUserPermission(game.user, "OWNER"), isGM: game.user.isGM, role: game.user.role }; },
  chaMod: async ({ actorId }) => (await import("/modules/acks-extras/scripts/henchmen/acks-adapter.mjs")).getChaMod(game.actors.get(actorId)),
  ventureRead: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    const party = H.M.partyOf(a);
    const v = H.M.ventureOf(loc, party.id);
    const log = (loc.system.market.marketLog ?? []).filter((r) => r.actorUuid === a.uuid).map((r) => ({ type: r.type, note: String(r.note ?? "").replace(a.name, "V"), gp: r.gp ?? null, day: H.m.WT.dayOfWorldTime(r.time) }));
    const sol = log.filter((r) => r.type === "ventureSolicited").map((r) => ({ ...r, gained: Number((r.note.match(/\+(\d+(?:\.\d+)?) st/) ?? [])[1]), used: (r.note.match(/network: (\w+)\)$/) ?? [])[1] ?? "base" }));
    return {
      day: H.day(),
      partyId: party.id,
      venture: v ? { entered: !!v.entered, enteredTime: v.enteredTime, effectiveClass: v.effectiveClass, impact: v.impact, rawImpact: v.rawImpact, impactCap: v.impactCap, networkMode: v.networkMode, cargoSt: v.cargoSt, tollCp: v.tollCp } : null,
      enters: log.filter((r) => r.type === "ventureAction" && /: enter posted/.test(r.note)).map((r) => ({ gp: r.gp, day: r.day })),
      solicits: sol,
      known: H.M.marketKnownTo(loc, a),
      source: H.M.knownSource(loc, a),
      effective: H.A.effectiveMarketClass(loc, a),
      dump: {
        monthStart: H.M.marketMonthStart ? H.M.marketMonthStart() : null,
        ventures: (loc.system.market.goods.ventures ?? []).map((x) => ({ partyId: x.partyId, monthStartTime: x.monthStartTime, entered: !!x.entered })),
        actions: (loc.system.market.goods.actions ?? []).slice(-4).map((x) => ({ kind: x.kind, status: x.status, partyId: x.partyId, networkMode: x.networkMode })),
        lastLog: (loc.system.market.marketLog ?? []).slice(-4).map((r) => ({ type: r.type, note: String(r.note ?? "").replace(a.name, "V").replace(/d+(.d+)?/g, "#") })),
      },
    };
  },
  cards: async ({ ids }) => ids.map((id) => { const m = game.messages.get(id); const div = document.createElement("div"); div.innerHTML = m?.content ?? ""; return { id, text: globalThis.__c2.text(div).slice(0, 300), hasUuid: /data-uuid=|@UUID\[/.test(m?.content ?? "") }; }),
  recentCards: async ({ since, pattern }) => {
    const H = globalThis.__c2;
    const re = new RegExp(pattern, "i");
    return game.messages.contents.filter((m) => m.timestamp >= since && re.test(m.content ?? "")).map((m) => { const div = document.createElement("div"); div.innerHTML = m.content; return { id: m.id, text: H.text(div).slice(0, 300), uuids: [...m.content.matchAll(/(?:data-uuid="|@UUID\[)([^"\]]+)/g)].map((x) => x[1]) }; });
  },
  characteristics: async ({ marketClass }) => {
    const H = globalThis.__c2;
    const rows = H.T.getTable("mercantile", "marketCharacteristics")?.rows ?? [];
    const row = H.T.findRow(rows, (r) => Number(r.marketClass) === Number(marketClass)) ?? null;
    return { hasRow: !!row, baseline: row ? H.m.AR.parseStones(row.baselineCargo) : null, tollPerSt: row ? H.m.AR.parseTollCpPerSt(row.toll) : null, impactCap: H.m.PR.impactLimits()?.impactCap ?? null, bands: H.m.PR.assessmentBands() };
  },
  probeDie: async ({ u, faces = 6 }) => {
    const H = globalThis.__c2;
    H.rig0 = H.rig0 ?? CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => u;
    try { return { total: (await new Roll(`1d${faces}`).evaluate()).total }; } finally { H.unrig(); }
  },
  /** GM: advance a day under a cycling rig, for the throws the sweep makes on this seat. */
  advanceRigged: async ({ seq, locationId, actionId }) => {
    const H = globalThis.__c2;
    H.takeChat();
    let i = 0;
    H.rig0 = H.rig0 ?? CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[i++ % seq.length];
    let resolved = null;
    try {
      await game.time.advance(86400);
      resolved = await H.poll(() => (game.actors.get(locationId)?.system?.market?.goods?.actions ?? []).find((a) => a.id === actionId)?.status === "done" || null, { tries: 60, every: 500 });
      await H.sleep(1500);
    } finally { H.unrig(); }
    return { draws: i, resolved: !!resolved, day: H.day(), chat: H.takeChat() };
  },
  writeDemand: async ({ locationId, category, modifier }) => globalThis.__c2.M.writeDemand(game.actors.get(locationId), { layer: "base", category, modifier }),
  writeReport: async ({ ownerId, marketId, outcome, picks, beliefs = [] }) => {
    const H = globalThis.__c2;
    const owner = game.actors.get(ownerId);
    const market = game.actors.get(marketId);
    const r = await H.M.tradeObjects.writeReport({ ownerUuid: owner.uuid, marketUuid: market.uuid, marketName: market.name, assessorUuid: owner.uuid, partyId: H.M.partyOf(owner).id, time: game.time.worldTime, outcome, beliefs, picks });
    return { ok: !r?.error, error: r?.error ?? null, uuid: r?.item?.uuid ?? null, house: String(game.settings.get("acks-extras", "marketsTradeHouse") ?? "") };
  },
  reportsOf: async ({ actorId }) => globalThis.__c2.M.tradeObjects.objectsOf(game.actors.get(actorId).uuid).map((i) => ({ uuid: i.uuid, outcome: i.system.outcome, picks: i.system.picks, beliefs: (i.system.beliefs ?? []).map((b) => ({ category: b.category, dm: b.dm })) })),
  reportRead: async ({ uuid }) => { const i = fromUuidSync(uuid); return i ? { outcome: i.system.outcome, picks: i.system.picks, beliefs: (i.system.beliefs ?? []).map((b) => ({ category: b.category, dm: b.dm })) } : null; },
  /** Open a report from the character sheet's Trade tab (the row's Open control), else by its sheet. */
  openReport: async ({ actorId, uuid }) => {
    const H = globalThis.__c2;
    const actor = game.actors.get(actorId);
    let via = "tab";
    await actor.sheet.render(true);
    const sheet = await H.poll(() => { const a = H.sheetOf(actorId); return a && H.root(a)?.querySelector('[data-action="tab"][data-tab="trade"], nav a[data-tab="trade"]') ? a : null; }, { tries: 40, every: 200 });
    const tab = sheet ? H.root(sheet).querySelector('[data-action="tab"][data-tab="trade"], nav a[data-tab="trade"]') : null;
    tab?.click();
    await H.sleep(600);
    const open = sheet ? H.root(H.sheetOf(actorId))?.querySelector(`[data-action="traderOpen"][data-uuid="${uuid}"]`) : null;
    if (open) open.click();
    else { via = "direct"; fromUuidSync(uuid)?.sheet?.render(true); }
    const app = await H.poll(() => H.apps().find((a) => a.item?.uuid === uuid && H.root(a)?.classList?.contains("acks-extras-markets-report-sheet")) ?? null, { tries: 40, every: 200 });
    if (!app) return { via, opened: false, tabFound: !!tab, openFound: !!open };
    await H.sleep(500);
    const el = H.root(app);
    return { via, opened: true, tabFound: !!tab, openFound: !!open, legend: H.text(el.querySelector("fieldset.acks-extras-markets-report-choose legend")), options: el.querySelectorAll("[data-report-choose]").length, catalog: H.M.merchandiseCatalog().length, text: H.text(el).slice(0, 400) };
  },
  reportSheetState: async ({ uuid, tick = null, learn = false }) => {
    const H = globalThis.__c2;
    const app = H.apps().find((a) => a.item?.uuid === uuid && H.root(a)?.classList?.contains("acks-extras-markets-report-sheet"));
    if (!app) return { opened: false };
    let el = H.root(app);
    if (tick) for (const box of el.querySelectorAll("[data-report-choose]")) box.checked = tick.includes(box.value);
    H.takeNotes();
    if (learn) {
      // A player's press is answered by the GM seat: wait for the write to land, up to eight seconds, or for the over-limit warning to be the whole answer.
      const before = fromUuidSync(uuid)?.system.picks ?? null;
      el.querySelector('[data-action="chooseGoods"]')?.click();
      await H.poll(() => ((fromUuidSync(uuid)?.system.picks ?? null) !== before ? true : null), { tries: 40, every: 200 });
      await H.sleep(400);
    }
    el = H.root(H.apps().find((a) => a.item?.uuid === uuid && H.root(a)?.classList?.contains("acks-extras-markets-report-sheet"))) ?? el;
    const item = fromUuidSync(uuid);
    return { ticked: [...el.querySelectorAll("[data-report-choose]:checked")].map((b) => b.value), boxPresent: !!el.querySelector("fieldset.acks-extras-markets-report-choose"), legend: H.text(el.querySelector("fieldset.acks-extras-markets-report-choose legend")), notes: H.takeNotes(), picks: item?.system.picks ?? null, beliefs: (item?.system.beliefs ?? []).map((b) => ({ category: b.category, dm: b.dm })), outcomeText: H.text(el.querySelector("dl, .acks-extras-markets-report-head") ?? el).slice(0, 300), text: H.text(el).slice(0, 500) };
  },
  performChoose: async ({ uuid, keys }) => { const r = await globalThis.__c2.M.tradeObjects.performChoose(fromUuidSync(uuid), keys); return { ok: !!r?.ok, error: r?.error ?? null, picks: fromUuidSync(uuid)?.system.picks ?? null }; },
  fillLedger: async ({ locationId, n }) => {
    const loc = game.actors.get(locationId);
    const t = game.time.worldTime;
    await loc.update({ "system.market.marketLog": Array.from({ length: n }, (_, i) => ({ time: t - (n - i), type: "note", note: `QA row ${i}` })), "system.market.monthAnchorTime": 1 });
    return { count: loc.system.market.marketLog.length, first: loc.system.market.marketLog[0]?.note ?? null };
  },
  processNow: async ({ locationId }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const r = await H.m.RC.processLocation(loc);
    const log = loc.system.market.marketLog ?? [];
    return { changed: !!r?.changed, count: log.length, first: log[0]?.note ?? null, monthRolls: log.filter((x) => x.type === "monthRoll").length, last: log.at(-1)?.type ?? null, cap: (await import("/modules/acks-extras/scripts/location/data/market-log.mjs")).MARKET_LOG_CAP };
  },
  hpFromParty: async ({ partyId, memberId }) => {
    const H = globalThis.__c2;
    const party = game.actors.get(partyId);
    const member = game.actors.get(memberId);
    let formation = Object.values(H.F.getFormations()).find((f) => f.actorId === partyId) ?? null;
    if (!formation) return { error: "no formation for the party actor" };
    const { addMember } = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    await addMember(formation, member);
    await H.sleep(500);
    formation = H.F.getFormations()[formation.id];
    await party.sheet.render(true);
    const app = await H.poll(() => H.apps().find((a) => a.actor?.id === partyId && H.root(a)?.querySelector('[data-action="adjustHp"]')) ?? null, { tries: 40, every: 200 });
    if (!app) return { enrolled: formation.members.some((m) => m?.actorId === memberId), opened: false };
    H.root(app).querySelector('[data-action="adjustHp"]').click();
    const hp = await H.poll(() => H.appBy("acks-extras-hp"), { tries: 40, every: 200 });
    await H.sleep(600);
    const rows = hp ? [...H.root(hp).querySelectorAll("tr[data-row]")].map((tr) => ({ key: tr.dataset.row, name: H.text(tr.querySelector(".acks-extras-hp-name")) })) : [];
    const subtitle = hp ? H.text(H.root(hp).querySelector(".window-subtitle, .acks-extras-hp-subtitle")) : "";
    return { enrolled: formation.members.some((m) => m?.actorId === memberId), opened: true, hpOpen: !!hp, rows, subtitle, formationId: formation.id };
  },
  closeAll: async () => globalThis.__c2.closeAll(),
  restore: async () => {
    const H = globalThis.__c2 ?? {};
    const out = {};
    if (H.unrig) { H.unrig(); out.dice = "restored"; }
    if (H.chatWrapped) { ChatMessage.create = H.chatCreate; H.chatWrapped = false; out.chat = "restored"; }
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; out.notes = "restored"; }
    if (H.settingBefore !== undefined) { await game.settings.set("acks-extras", "marketsActingTrader", H.settingBefore); out.actingTrader = { restoredTo: H.settingBefore === "" ? "(empty)" : "(a uuid)" }; }
    return out;
  },
  clearHouse: async ({ value }) => { await game.settings.set("acks-extras", "marketsTradeHouse", value); return { now: String(game.settings.get("acks-extras", "marketsTradeHouse") ?? "") }; },
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.markets?.performVentureAction && !!globalThis.acksExtras?.henchmen?.effectiveMarketClass && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
let advances = 0;
let housePre = null;
const imported = [];
const advance = async (locationId = null, actionId = null) => { advances++; const r = await run(gm, P.advanceDay, { locationId, actionId }); note(`advance ${advances}`, r); return r; };
// What the rule gives a solicitation, by hand: the class option, the impact option, the better of them (class over impact on a tie, the plain entry when neither beats it).
const expectPick = (v, stones, step = 1) => {
  const base = { cls: v.effectiveClass, imp: v.impact, used: "base" };
  const cls = { cls: Math.max(1, v.effectiveClass - step), imp: v.impact, used: "class" };
  const imp = { cls: 3, imp: Math.max(1, Math.min(v.impactCap, v.rawImpact + step)), used: "impact" };
  const at = (o) => stones[o.cls - 1] * o.imp;
  let best = base;
  for (const o of [cls, imp]) if (at(o) > at(best)) best = o;
  return { ...best, stones: at(best) };
};

try {
  section("seats");
  gm = await seat("gm");
  const census = await run(gm, P.census, MOD);
  note("gm census", census);
  check("the GM seat is the active GM, the page runs the working tree (formation apiVersion 18), and the world declares the report and merchandise item types", census.activeGMIsSelf && census.role === 4 && census.working === 18 && census.reportType && census.merchType, { role: census.role, manifest: census.module, working: census.working, reportType: census.reportType, merchType: census.merchType });
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");
  note("install (gm)", await run(gm, P.install));
  const player = await seat("player");
  const pc = await run(player, P.census, MOD);
  note("player census", pc);
  note("install (player)", await run(player, P.install));
  housePre = census.house;

  section("the rules documents and the book");
  note("documents the world holds", await run(gm, P.docs));
  for (const book of BOOKS) {
    note(`book ${book.id}`, await run(gm, P.connectBook, book));
    let state = null;
    for (let n = 0; n < 150; n++) { state = await run(gm, P.bookState, { id: book.id }); if (state.done || state.session) break; await sleep(2000); }
    note(`book ${book.id} state`, state);
  }
  for (const id of DOCS) {
    const docs = await run(gm, P.docs);
    if (docs[id]) continue;
    note(`import ${id} from the book`, await run(gm, P.importDoc, { id }));
    let st = null;
    for (let n = 0; n < 150; n++) { st = await run(gm, P.importState, { id }); if (st.done) break; await sleep(2000); }
    note(`import ${id} state`, st);
    if (st?.ok && st.hasDoc) imported.push(id);
  }
  note("documents after import", await run(gm, P.docs));
  note("player mirrors the world's documents", await run(player, P.reloadDocs));
  const ch3 = await run(gm, P.characteristics, { marketClass: 3 });
  const ch1 = await run(gm, P.characteristics, { marketClass: 1 });
  note("characteristics read (class 3, class 1)", { hasRow3: ch3.hasRow, hasRow1: ch1.hasRow, cap: ch3.impactCap, bandsRead: !!ch3.bands });
  if (!ch3.hasRow || !ch3.impactCap || !ch3.bands) throw new Error("the mercantile document's characteristics, impact limits or assessment bands are not readable: the venture days cannot resolve");

  section("fixtures");
  {
    // The walk spans a dozen market days; started near the month's end, its ventures vanish at the roll.
    const room = await run(gm, P.monthRoom);
    note("days left in the market month", room);
    if (room.daysLeft < 18) {
      const skipped = await run(gm, P.skipDays, { n: room.daysLeft + 1 });
      advances += skipped.days;
      note("clock moved into the next market month", skipped);
    }
  }
  const playerId = pc.userId;
  const own = { default: 0, [playerId]: 3 };
  const mk = async (name, type, extra = {}) => gm.create("Actor", { name: `${name} ${NONCE}`, type, ...extra });
  const M1 = await mk("QA Report Town", "acks-extras.location");
  const M2 = await mk("QA Known Town", "acks-extras.location");
  const M3 = await mk("QA Second Town", "acks-extras.location");
  const M5 = await mk("QA Venture Town", "acks-extras.location");
  const M4 = await mk("QA Great City", "acks-extras.location");
  const M6 = await mk("QA Ledger Town", "acks-extras.location");
  for (const [loc, cls] of [[M1, 3], [M2, 3], [M3, 3], [M5, 3], [M4, 1], [M6, 3]]) note(`market ${loc.name}`, await run(gm, P.addMarket, { locationId: loc.id, classOverride: cls }));
  const Hh = await mk("0 QA Hireling", "character", { ownership: own, items: [] });
  await gm.eval(`game.actors.get(${JSON.stringify(Hh.id)}).update({ "system.retainer.enabled": true }).then(() => true)`);
  const Cp = await mk("0 QA Plain", "character", { ownership: own, items: [] });
  const V = await mk("QA Factor Vale", "character", { ownership: own, items: [], flags: { "acks-extras": { markets: { trader: true } } } });
  const W = await mk("QA Trader West", "character", { items: [], flags: { "acks-extras": { markets: { trader: true } } } });
  const F = await mk("QA Fresh Trader", "character", { ownership: own, items: [] });
  const PT = await mk("QA Company", "acks-extras.party");
  const Mm = await mk("QA Member", "character", { items: [] });
  const CHANGES = [{ key: "flags.acks-extras.marketClass", value: 1 }, { key: "flags.acks-extras.marketImpact", value: 1 }];
  const powerV = await run(gm, P.networkPower, { actorId: V.id, name: "Mercantile Network", changes: CHANGES, condition: "in a market entered before" });
  note("V's network power", powerV);
  const powerF = await run(gm, P.networkPower, { actorId: F.id, name: "Mercantile Network", changes: CHANGES, condition: "in a market entered before" });
  note("F's network power", powerF);
  check("fixture: V's power reads a class step of 1 and an impact step of 1, nothing missing", powerV.steps?.classStep === 1 && powerV.steps?.impactStep === 1 && powerV.steps?.missing?.length === 0, powerV.steps);
  const X = await gm.create("Item", { name: `QA Good X ${NONCE}`, type: "acks-extras.merchandise", system: { key: `qax${NONCE}`, pricePerStoneGp: 10, priceStepGp: 1, dailyStones: [100, 50, 20, 10, 5, 2] } });
  const Y = await gm.create("Item", { name: `QA Good Y ${NONCE}`, type: "acks-extras.merchandise", system: { key: `qay${NONCE}`, pricePerStoneGp: 8, priceStepGp: 1, dailyStones: [60, 30, 20, 10, 5, 2] } });
  const Z = await gm.create("Item", { name: `QA Good Z ${NONCE}`, type: "acks-extras.merchandise", system: { key: `qaz${NONCE}`, pricePerStoneGp: 5, priceStepGp: 1, dailyStones: [40, 20, 10, 5, 2, 1] } });
  const XS = [100, 50, 20, 10, 5, 2], YS = [60, 30, 20, 10, 5, 2];
  const keys = { X: `qax${NONCE}`, Y: `qay${NONCE}`, Z: `qaz${NONCE}` };
  for (const [k, dm] of [["X", 2], ["Y", -1], ["Z", 0]]) note(`demand on M1 for ${k}`, await run(gm, P.writeDemand, { locationId: M1.id, category: keys[k], modifier: dm }));
  note("coin", { V: await run(gm, P.coin, { actorId: V.id, mint: 40000 }), F: await run(gm, P.coin, { actorId: F.id, mint: 500 }) });
  note("player acting-trader setting cleared for the walk", await run(player, P.settingSet, { key: "marketsActingTrader", value: "" }));
  const d0 = await run(gm, P.day);
  note("day at the start", d0);

  section("ad hoc: the default acting trader is not a hireling that sorts first");
  const tt0 = await run(player, P.tradeTab, { locationId: M2.id });
  note("trade tab (player, no trader remembered)", { acting: tt0.acting, pickValue: tt0.pickValue, candidates: tt0.candidates, assigned: pc.character });
  const firstPlain = tt0.candidates.find((c) => !c.retainer)?.id ?? null;
  check("ad hoc: with no trader remembered and no assigned character, the acting trader is the plain character, not the hireling that sorts first, and the hireling is still offered", tt0.opened && !pc.character && tt0.candidates[0]?.id === Hh.id && tt0.acting === Cp.id && firstPlain === Cp.id && tt0.pickOptions.some((o) => o.text.startsWith("0 QA Hireling")), { acting: tt0.acting, expected: Cp.id, first: tt0.candidates[0]?.id, hireling: Hh.id, assigned: pc.character });
  note("closed (player)", await run(player, P.closeAll));

  section("the known-market walk");
  const cat = await run(gm, P.catalog, { locationId: M2.id });
  note("catalogue rows (cheapest first)", { rows: cat.length, first: cat[0] });
  let common = null;
  for (const row of cat) { const a = await run(gm, P.availability, { locationId: M2.id, itemName: row.name, costGp: row.costGp }); if (a.status === "available") { common = { ...row, a }; break; } }
  note("a common row", common);
  const tt1 = await run(player, P.tradeTab, { locationId: M2.id, traderId: V.id });
  note("trade tab as V (step 1)", { acting: tt1.acting, classLine: tt1.classLine, knownButton: tt1.knownButton });
  const buy1 = await run(player, P.purchase, { locationId: M2.id, buyerId: V.id, itemName: common.name, qty: 1 });
  note("purchase 1", buy1);
  for (const id of buy1.chat ?? []) player.track(id, "ChatMessage");
  const k1 = await run(gm, P.knownRead, { locationId: M2.id, actorId: V.id });
  const tt1b = await run(player, P.tradeTab, { locationId: M2.id, traderId: V.id });
  note("known after purchase 1", { ...k1, classLine: tt1b.classLine });
  check(`1: day ${k1.day}: the ledger row is stamped V, the market is not known to V, the class is 3, and the line reads Class 3 with the network not counted on this visit`, buy1.ok && buy1.stamped >= 1 && k1.known === false && k1.effective === 3 && /Class 3/.test(tt1b.classLine) && /mercantile network: not counted on this visit/.test(tt1b.classLine) && !/for QA Factor/.test(tt1b.classLine), { stamped: buy1.stamped, known: k1.known, effective: k1.effective, classLine: tt1b.classLine });
  const buy2 = await run(player, P.purchase, { locationId: M2.id, buyerId: V.id, itemName: common.name, qty: 1 });
  for (const id of buy2.chat ?? []) player.track(id, "ChatMessage");
  const k2 = await run(gm, P.knownRead, { locationId: M2.id, actorId: V.id });
  check(`2: day ${k2.day}: a second purchase the same day leaves the class at 3 and the market unknown`, buy2.ok && buy2.stamped >= 2 && k2.known === false && k2.effective === 3, { stamped: buy2.stamped, known: k2.known, effective: k2.effective });
  note("closed (player)", await run(player, P.closeAll));
  await advance();
  const k3 = await run(gm, P.knownRead, { locationId: M2.id, actorId: V.id });
  const k3w = await run(gm, P.knownRead, { locationId: M2.id, actorId: W.id });
  let rare = null;
  for (const row of cat.slice().reverse()) {
    const av = await run(gm, P.availability, { locationId: M2.id, itemName: row.name, costGp: row.costGp, traderId: V.id });
    const aw = await run(gm, P.availability, { locationId: M2.id, itemName: row.name, costGp: row.costGp, traderId: W.id });
    if (JSON.stringify(av) !== JSON.stringify(aw)) { rare = { row: row.name, differs: true, sameBand: av.band === aw.band }; break; }
  }
  note("a rare row's cell for V against W", rare);
  const tt3 = await run(player, P.tradeTab, { locationId: M2.id, traderId: V.id });
  check(`3: day ${k3.day}: after the day boundary the market is known by record, the class reads 2 for V and 3 for W, and a rare row's cell differs between them`, k3.known === true && k3.source === "record" && k3.effective === 2 && k3w.effective === 3 && !!rare && /for QA Factor Vale \w+: Class 2/.test(tt3.classLine), { known: k3.known, source: k3.source, effV: k3.effective, effW: k3w.effective, rare, classLine: tt3.classLine });
  note("closed (player)", await run(player, P.closeAll));

  const tt4 = await run(player, P.tradeTab, { locationId: M3.id, traderId: V.id });
  note("trade tab at M3 as V", { classLine: tt4.classLine, categories: tt4.categories.length });
  const e1 = await run(player, P.ventureEnterUI, { locationId: M3.id, other: ch3.baseline });
  note("enter M3 (first)", { ...e1, networkText: e1.networkText });
  const a4 = await advance(M3.id, e1.action?.id);
  const v4 = await run(gm, P.ventureRead, { locationId: M3.id, actorId: V.id });
  note("venture at M3 after a day", v4);
  check(`4: day ${v4.day}: the venture row is entered with enteredTime equal to the entry's postedTime, and the class at M3 while entered is 3 (the entry is the visit)`, e1.submitted && a4.resolved && v4.venture?.entered && v4.venture.enteredTime === e1.action?.postedTime && v4.effective === 3 && v4.known === false, { enteredTime: v4.venture?.enteredTime, postedTime: e1.action?.postedTime, effective: v4.effective, known: v4.known });
  note("leave M3", await run(player, P.ventureLeave, { locationId: M3.id, actorId: V.id }));
  const e2 = await run(player, P.ventureEnterUI, { locationId: M3.id, other: ch3.baseline });
  note("enter M3 (again)", { submitted: e2.submitted, networkText: e2.networkText, action: e2.action });
  const a5 = await advance(M3.id, e2.action?.id);
  const v5 = await run(gm, P.ventureRead, { locationId: M3.id, actorId: V.id });
  note("venture at M3 after the second entry", v5);
  check(`5: day ${v5.day}: the second toll equals the first, the market is known to V with the party entered again, and M3 purchases read class 2`, a5.resolved && v5.enters.length === 2 && v5.enters[0].gp === v5.enters[1].gp && v5.enters[0].gp < 0 && v5.venture?.entered && v5.known === true && v5.effective === 2, { enters: v5.enters.length, sameToll: v5.enters[0]?.gp === v5.enters[1]?.gp, known: v5.known, source: v5.source, effective: v5.effective });
  note("closed (player)", await run(player, P.closeAll));

  const g6 = await run(gm, P.tradeTab, { locationId: M2.id, traderId: F.id });
  note("GM trade tab as F", { acting: g6.acting, classLine: g6.classLine, knownButton: g6.knownButton });
  const on = await run(gm, P.knownToggle, { locationId: M2.id, actorId: F.id });
  const off = await run(gm, P.knownToggle, { locationId: M2.id, actorId: F.id });
  note("toggle for F", { on: { button: on.knownButton, source: on.source }, off: { button: off.knownButton, source: off.source } });
  const g6v = await run(gm, P.tradeTab, { locationId: M2.id, traderId: V.id });
  const onV = await run(gm, P.knownToggle, { locationId: M2.id, actorId: V.id });
  const offV = await run(gm, P.knownToggle, { locationId: M2.id, actorId: V.id });
  note("toggle for V", { before: { button: g6v.knownButton, classLine: g6v.classLine }, on: { button: onV.knownButton, source: onV.source }, off: { button: offV.knownButton, source: offV.source, known: offV.known } });
  check("6: for a fresh trader the switch On knows the market at once by the Judge and Off returns the record's answer; for V (known by record) the switch reads Off while the verdict stays known, and On then Off leaves it known", g6.acting === F.id && /Off$/.test(g6.knownButton) && /On$/.test(on.knownButton) && on.source === "judge" && /Off$/.test(off.knownButton) && off.source === null && g6v.acting === V.id && /Off$/.test(g6v.knownButton) && /Class 2/.test(g6v.classLine) && onV.source === "judge" && /On$/.test(onV.knownButton) && offV.source === "record" && offV.known === true, { f: [g6.knownButton, on.knownButton, on.source, off.knownButton, off.source], v: [g6v.knownButton, onV.source, offV.source, offV.known] });
  note("closed (gm)", await run(gm, P.closeAll));
  note("M2 override 1", await run(gm, P.setOverride, { locationId: M2.id, classOverride: 1 }));
  const k7 = await run(gm, P.knownRead, { locationId: M2.id, actorId: V.id });
  check("7: Class I stays Class I for V", k7.effective === 1, k7);

  section("the network walk");
  const n1 = await run(player, P.tradeTab, { locationId: M5.id, traderId: V.id });
  note("trade tab at M5 as V", { classLine: n1.classLine, hasX: n1.categories.includes(keys.X), hasY: n1.categories.includes(keys.Y) });
  const ne1 = await run(player, P.ventureEnterUI, { locationId: M5.id, other: ch3.baseline });
  note("enter M5 (step 1)", { networkText: ne1.networkText, modes: ne1.modes, action: ne1.action, notes: ne1.notes });
  const na1 = await advance(M5.id, ne1.action?.id);
  let nv1 = await run(gm, P.ventureRead, { locationId: M5.id, actorId: V.id });
  note("venture at M5", nv1);
  const s1 = await run(player, P.ventureApi, { locationId: M5.id, kind: "solicit", actorId: V.id, category: keys.X });
  note("solicit X", s1);
  await advance(M5.id, s1.action?.id);
  nv1 = await run(gm, P.ventureRead, { locationId: M5.id, actorId: V.id });
  const sol1 = nv1.solicits.at(-1);
  check(`N1: day ${nv1.day}: the first entry's dialog reads not counted, the row holds rawImpact, impactCap and networkMode auto, and X's solicitation names no network at the class-III column × impact`, /Not counted on this visit for QA Factor Vale/.test(ne1.networkText) && ne1.modes.length === 3 && na1.resolved && Number.isFinite(nv1.venture?.rawImpact) && nv1.venture?.impactCap > 0 && nv1.venture?.networkMode === "auto" && sol1?.used === "base" && sol1?.gained === XS[nv1.venture.effectiveClass - 1] * nv1.venture.impact, { networkText: ne1.networkText, modes: ne1.modes, venture: nv1.venture, sol: sol1 });

  note("leave M5", await run(player, P.ventureLeave, { locationId: M5.id, actorId: V.id }));
  await advance();
  const ne2 = await run(player, P.ventureEnterUI, { locationId: M5.id, other: ch3.baseline, submit: false });
  note("enter M5 dialog (step 2)", { networkText: ne2.networkText, modes: ne2.modes });
  await shot(player, "markets-network-enter", ".application.dialog[data-qa-enter]");
  note("dialog closed", await run(player, P.closeDialog));
  const ne2s = await run(player, P.ventureEnterUI, { locationId: M5.id, other: ch3.baseline });
  const na2 = await advance(M5.id, ne2s.action?.id);
  let nv2 = await run(gm, P.ventureRead, { locationId: M5.id, actorId: V.id });
  const s2x = await run(player, P.ventureApi, { locationId: M5.id, kind: "solicit", actorId: V.id, category: keys.X });
  const adv2x = await advance(M5.id, s2x.action?.id);
  const s2y = await run(player, P.ventureApi, { locationId: M5.id, kind: "solicit", actorId: V.id, category: keys.Y });
  const adv2y = await advance(M5.id, s2y.action?.id);
  nv2 = await run(gm, P.ventureRead, { locationId: M5.id, actorId: V.id });
  const solX = nv2.solicits.at(-2), solY = nv2.solicits.at(-1);
  const expX = expectPick(nv2.venture, XS), expY = expectPick(nv2.venture, YS);
  const cardsX = await run(gm, P.cards, { ids: adv2x.chat ?? [] });
  const cardsY = await run(gm, P.cards, { ids: adv2y.chat ?? [] });
  for (const id of [...(na1.chat ?? []), ...(na2.chat ?? []), ...(adv2x.chat ?? []), ...(adv2y.chat ?? [])]) gm.track(id, "ChatMessage");
  note("step 2 solicitations", { venture: nv2.venture, solX, solY, expX, expY, cardsX: cardsX.map((c) => c.text), cardsY: cardsY.map((c) => c.text) });
  check(`N2: day ${nv2.day}: re-entered on a later day the dialog reads counted, the toll equals step 1's, X's note ends network: class and Y's network: impact, each at the figures the rule gives, and each card names the class and impact used`, /Counted on this visit for QA Factor Vale/.test(ne2.networkText) && na2.resolved && nv2.enters.length === 2 && nv2.enters[0].gp === nv2.enters[1].gp && solX?.used === "class" && expX.used === "class" && solX.gained === expX.stones && solY?.used === "impact" && expY.used === "impact" && solY.gained === expY.stones && cardsX.some((c) => c.text.includes(`read as Class ${expX.cls}, at impact ${expX.imp}`)) && cardsY.some((c) => c.text.includes(`impact ${expY.imp}, at Class ${expY.cls}`)), { networkText: ne2.networkText, sameToll: nv2.enters[0]?.gp === nv2.enters[1]?.gp, solX, solY, expX, expY });

  note("leave M5", await run(player, P.ventureLeave, { locationId: M5.id, actorId: V.id }));
  await advance();
  const ne3 = await run(player, P.ventureEnterUI, { locationId: M5.id, other: ch3.baseline, mode: "impact" });
  const na3 = await advance(M5.id, ne3.action?.id);
  const s3 = await run(player, P.ventureApi, { locationId: M5.id, kind: "solicit", actorId: V.id, category: keys.X });
  const adv3 = await advance(M5.id, s3.action?.id);
  for (const id of [...(na3.chat ?? []), ...(adv3.chat ?? [])]) gm.track(id, "ChatMessage");
  const nv3 = await run(gm, P.ventureRead, { locationId: M5.id, actorId: V.id });
  const sol3 = nv3.solicits.at(-1);
  const imp3 = Math.max(1, Math.min(nv3.venture?.impactCap ?? 0, (nv3.venture?.rawImpact ?? 0) + 1));
  const g3 = await run(gm, P.tradeTab, { locationId: M5.id, traderId: V.id });
  note("step 3", { venture: nv3.venture, sol3, imp3, partyBlock: g3.partyBlock, ventureStatus: g3.ventureStatus });
  check(`N3: day ${nv3.day}: entered with More market impact, X's note ends network: impact at the class-III column × (impact + step) never past the cap, and the GM's party line names the mode`, ne3.action?.networkMode === "impact" && na3.resolved && nv3.venture?.networkMode === "impact" && sol3?.used === "impact" && sol3.gained === XS[2] * imp3 && imp3 <= nv3.venture.impactCap && /More market impact/.test(g3.partyBlock), { mode: nv3.venture?.networkMode, sol3, imp3, cap: nv3.venture?.impactCap, partyBlock: g3.partyBlock.slice(0, 200) });
  note("closed (gm)", await run(gm, P.closeAll));

  note("M4 known by the Judge's switch", await gm.eval(`acksExtras.markets.setMarketKnown(game.actors.get(${JSON.stringify(V.id)}), game.actors.get(${JSON.stringify(M4.id)}), true).then((r) => JSON.stringify(r))`));
  await run(player, P.closeAll);
  { const have = (await run(gm, P.coin, { actorId: V.id })).gp; const need = Math.ceil((ch1.tollPerSt ?? 0) * (ch1.baseline ?? 0) / 100) + 100; if (have < need) note("coin minted for the Class I toll", await run(gm, P.coin, { actorId: V.id, mint: need - have })); }
  const n4 = await run(player, P.tradeTab, { locationId: M4.id, traderId: V.id });
  note("trade tab at M4", { classLine: n4.classLine });
  const ne4 = await run(player, P.ventureEnterUI, { locationId: M4.id, other: ch1.baseline });
  const na4 = await advance(M4.id, ne4.action?.id);
  const s4 = await run(player, P.ventureApi, { locationId: M4.id, kind: "solicit", actorId: V.id, category: keys.X });
  const adv4 = await advance(M4.id, s4.action?.id);
  for (const id of [...(na4.chat ?? []), ...(adv4.chat ?? [])]) gm.track(id, "ChatMessage");
  const nv4 = await run(gm, P.ventureRead, { locationId: M4.id, actorId: V.id });
  const sol4 = nv4.solicits.at(-1);
  note("step 4", { networkText: ne4.networkText, action: ne4.action, venture: nv4.venture, sol4, dump: nv4.dump });
  check(`N4: day ${nv4.day}: in a Class I market known by the Judge, X with Auto trades by impact, since the class option opens nothing in Class I`, /Counted on this visit/.test(ne4.networkText) && na4.resolved && nv4.venture?.effectiveClass === 1 && sol4?.used === "impact", { venture: nv4.venture, sol4 });
  note("closed (player)", await run(player, P.closeAll));

  note("leave M3", await run(player, P.ventureLeave, { locationId: M3.id, actorId: V.id }));
  await advance();
  const n5 = await run(player, P.tradeTab, { locationId: M3.id, traderId: V.id });
  const ne5 = await run(player, P.ventureEnterUI, { locationId: M3.id, other: 1, mode: "impact" });
  const na5 = await advance(M3.id, ne5.action?.id);
  const s5 = await run(player, P.ventureApi, { locationId: M3.id, kind: "solicit", actorId: V.id, category: keys.X });
  const adv5 = await advance(M3.id, s5.action?.id);
  for (const id of [...(na5.chat ?? []), ...(adv5.chat ?? [])]) gm.track(id, "ChatMessage");
  const nv5 = await run(gm, P.ventureRead, { locationId: M3.id, actorId: V.id });
  const sol5 = nv5.solicits.at(-1);
  const cards5 = await run(gm, P.cards, { ids: adv5.chat ?? [] });
  note("step 5", { classLine: n5.classLine, networkText: ne5.networkText, venture: nv5.venture, sol5, cards: cards5.map((c) => c.text) });
  check(`N5: day ${nv5.day}: a first entry with too little stone for impact 1 in a known market drops the class on the venture row, and the impact-mode solicitation trades at the market's own class with impact equal to the step`, na5.resolved && nv5.venture?.entered && nv5.venture.effectiveClass > 3 && nv5.venture.rawImpact === 0 && sol5?.used === "impact" && sol5.gained === XS[2] * 1 && cards5.some((c) => c.text.includes("impact 1, at Class 3")), { venture: nv5.venture, sol5 });
  note("closed (player)", await run(player, P.closeAll));

  note("V's power keeps only the class change", await run(gm, P.setEffectChanges, { actorId: V.id, itemId: powerV.itemId, effectId: powerV.effectId, changes: [CHANGES[0]] }));
  // The select is the party's, and F trades in V's party: F's impact value goes too, or the mode stays offered.
  note("F's power keeps only the class change", await run(gm, P.setEffectChanges, { actorId: F.id, itemId: powerF.itemId, effectId: powerF.effectId, changes: [CHANGES[0]] }));
  const bare = await run(gm, P.plainAbility, { actorId: V.id, name: "Mercantile Network" });
  note("a bare power named on V", bare);
  { let ps = null, fs = null; for (let n = 0; n < 25; n++) { ps = await run(player, P.stepsOf, { actorId: V.id }); fs = await run(player, P.stepsOf, { actorId: F.id }); if (ps.impactStep === 0 && ps.missing.length > 0 && fs.impactStep === 0) break; await sleep(400); } note("V's and F's steps as the player seat reads them", { V: ps, F: fs }); }
  note("left before step 6", await run(player, P.ventureLeave, { locationId: M5.id, actorId: V.id }));
  await run(player, P.tradeTab, { locationId: M5.id, traderId: V.id });
  const ne6 = await run(player, P.ventureEnterUI, { locationId: M5.id, submit: false });
  note("enter dialog (step 6)", { pressed: ne6.pressed, dialog: ne6.dialog, networkText: ne6.networkText, modes: ne6.modes });
  check("N6: with the impact value removed from both networks in the party the select offers no impact mode, and the item with no value at all is named as having none imported",ne6.dialog && !ne6.modes.includes("impact") && ne6.modes.includes("class") && /Mercantile Network has no value imported/.test(ne6.networkText), { modes: ne6.modes, networkText: ne6.networkText });
  note("dialog closed", await run(player, P.closeDialog));
  note("closed (player)", await run(player, P.closeAll));

  section("market reports: step 10 and the step-4 hunk");
  const rP = await run(gm, P.writeReport, { ownerId: V.id, marketId: M1.id, outcome: "partial", picks: 2 });
  const rF = await run(gm, P.writeReport, { ownerId: V.id, marketId: M1.id, outcome: "false", picks: 1 });
  const rW = await run(gm, P.writeReport, { ownerId: W.id, marketId: M1.id, outcome: "partial", picks: 1 });
  const Nn = await mk("QA Trader North", "character", { ownership: { default: 0 }, items: [], flags: { "acks-extras": { markets: { trader: true } } } });
  const rN = await run(gm, P.writeReport, { ownerId: Nn.id, marketId: M1.id, outcome: "partial", picks: 1 });
  note("reports written", { rP, rF, rW, rN, housePre: housePre === "" ? "(empty)" : "(an actor)" });
  for (const r of [rP, rF, rW, rN]) if (r.uuid) gm.track(r.uuid, "Item");
  if (housePre === "" && rP.house) { gm.track(rP.house, "Actor"); note("the run made the trade house: tracked", { tracked: true }); }
  const o10 = await run(player, P.openReport, { actorId: V.id, uuid: rP.uuid });
  note("partial report opened (player)", o10);
  const over = await run(player, P.reportSheetState, { uuid: rP.uuid, tick: [keys.X, keys.Y, keys.Z], learn: true });
  note("three ticked, Learn", { notes: over.notes, picks: over.picks, beliefs: over.beliefs });
  const two = await run(player, P.reportSheetState, { uuid: rP.uuid, tick: [keys.X, keys.Y] });
  await shot(player, "markets-partial-assessment", ".application.acks-extras-markets-report-sheet");
  const learned = await run(player, P.reportSheetState, { uuid: rP.uuid, tick: [keys.X, keys.Y], learn: true });
  note("two ticked, Learn", { picks: learned.picks, beliefs: learned.beliefs, boxPresent: learned.boxPresent, notes: learned.notes });
  const dmOf = (list, k) => list.find((b) => b.category === k)?.dm;
  check("10: the partial report's box asks for 2 goods over every catalogue good; three ticked warns and writes nothing; two ticked are learned at the market's true modifiers, picks is 0 and the box is gone", o10.opened && /Choose 2 good\(s\)/.test(o10.legend) && o10.options === o10.catalog && o10.options >= 3 && over.notes.some((n) => /no more than 2/.test(n.text)) && over.picks === 2 && over.beliefs.length === 0 && two.ticked.length === 2 && learned.picks === 0 && dmOf(learned.beliefs, keys.X) === 2 && dmOf(learned.beliefs, keys.Y) === -1 && !learned.boxPresent, { via: o10.via, legend: o10.legend, options: o10.options, catalog: o10.catalog, over: over.notes, learned: learned.beliefs, picks: learned.picks, box: learned.boxPresent });
  await run(player, P.closeAll);
  const oF = await run(player, P.openReport, { actorId: V.id, uuid: rF.uuid });
  const fLearn = await run(player, P.reportSheetState, { uuid: rF.uuid, tick: [keys.Z], learn: true });
  const zdm = dmOf(fLearn.beliefs, keys.Z);
  note("false report, Z chosen", { legend: oF.legend, picks: fLearn.picks, beliefs: fLearn.beliefs, outcomeText: fLearn.outcomeText.slice(0, 160) });
  check("10: on the false report the chosen good's modifier differs from the market's by 1 to 3, and the player seat reads the outcome as Partial", oF.opened && Number.isInteger(zdm) && Math.abs(zdm - 0) >= 1 && Math.abs(zdm - 0) <= 3 && fLearn.picks === 0 && /Partial picture/.test(fLearn.text) && !/\bFalse\b/.test(fLearn.text), { zdm, picks: fLearn.picks, text: fLearn.text.slice(0, 200) });
  await run(player, P.closeAll);
  const ownN = await run(player, P.ownershipRead, { actorId: Nn.id });
  const ownW = await run(player, P.ownershipRead, { actorId: W.id });
  note("ownership as the player seat reads it", { N: ownN, W: ownW });
  const ny = await run(player, P.performChoose, { uuid: rN.uuid, keys: [keys.X] });
  note("performChoose on N's report from the player seat", ny);
  check("10: a seat that does not own the stamp calling performChoose gets notYours and nothing is written", !ownN.owns && !ownN.isGM && ny.error === "notYours" && ny.picks === 1, { ownN, ny });
  if (ownW.visible) { const nw = await run(player, P.performChoose, { uuid: rW.uuid, keys: [keys.X] }); note("performChoose on W's report from the player seat (W " + (ownW.owns ? "owned" : "not owned") + ")", nw); }

  const fe = await run(player, P.ventureApi, { locationId: M1.id, kind: "enter", actorId: V.id, cargoSt: 0 });
  note("enter M1 (cargo 0)", fe);
  const fa = await advance(M1.id, fe.action?.id);
  for (const id of fa.chat ?? []) gm.track(id, "ChatMessage");
  const fs = await run(player, P.ventureApi, { locationId: M1.id, kind: "assess", actorId: V.id });
  note("assess posted", fs);
  const partialBand = ch3.bands?.[3] ?? null;
  const chaMod = await run(gm, P.chaMod, { actorId: V.id });
  const target = Math.max(2, Math.min(12, (partialBand?.min ?? partialBand?.max ?? 7) - Number(chaMod || 0)));
  const f1 = Math.min(6, Math.max(1, Math.ceil(target / 2))), f2 = target - f1;
  const probe = await run(gm, P.probeDie, { u: (6 - 4 + 0.5) / 6, faces: 6 });
  note("die probe (expect 4)", probe);
  const u = (f) => (6 - f + 0.5) / 6;
  const reportsBefore = (await run(gm, P.reportsOf, { actorId: V.id })).map((r) => r.uuid);
  const rigged = await run(gm, P.advanceRigged, { seq: [u(f1), u(f2), u(2)], locationId: M1.id, actionId: fs.action?.id });
  advances++;
  note(`advance ${advances} (rigged for a partial band total)`, { draws: rigged.draws, resolved: rigged.resolved, day: rigged.day, chat: rigged.chat?.length, probe: probe.total, faces: [f1, f2] });
  for (const id of rigged.chat ?? []) gm.track(id, "ChatMessage");
  const reportsAfter = await run(gm, P.reportsOf, { actorId: V.id });
  const fresh = reportsAfter.filter((r) => !reportsBefore.includes(r.uuid));
  for (const r of fresh) gm.track(r.uuid, "Item");
  const cardsA = await run(gm, P.cards, { ids: rigged.chat ?? [] });
  note("assessment outcome", { fresh, cards: cardsA });
  check(`4 (hunk): day ${rigged.day}: a partial or false roll writes one report with no beliefs and picks between 1 and 6, and its card links the report`, probe.total === 4 && rigged.resolved && fresh.length === 1 && ["partial", "false"].includes(fresh[0].outcome) && fresh[0].beliefs.length === 0 && fresh[0].picks >= 1 && fresh[0].picks <= 6 && cardsA.some((c) => c.hasUuid && /assessed supply and demand/i.test(c.text)), { fresh, cards: cardsA.map((c) => [c.hasUuid, c.text.slice(0, 120)]) });

  section("ad hoc: the ledger keeps one length through the monthly row");
  const filled = await run(gm, P.fillLedger, { locationId: M6.id, n: 150 });
  const proc = await run(gm, P.processNow, { locationId: M6.id });
  note("ledger before and after the monthly row", { filled, proc });
  check("ledger: a market holding 150 rows keeps them after henchmen's monthly row, capped at the markets length of 300 and not a third of it", filled.count === 150 && proc.monthRolls === 1 && proc.count === 151 && proc.first === "QA row 0" && proc.cap === 300, { before: filled.count, after: proc.count, monthRolls: proc.monthRolls, first: proc.first, cap: proc.cap });

  section("lib pointer: the hit-point tool from the party sheet");
  const hp = await run(gm, P.hpFromParty, { partyId: PT.id, memberId: Mm.id });
  note("hp tool from the party sheet", hp);
  check("lib: the party sheet's entry point opens the hit-point tool on the enrolled member", hp.enrolled && hp.opened && hp.hpOpen && hp.rows.some((r) => r.name.startsWith("QA Member")), { rows: hp.rows, subtitle: hp.subtitle });
  note("closed (gm)", await run(gm, P.closeAll));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try { if (seats.player) { note("closed windows (player)", await run(seats.player, P.closeAll)); note("restored (player)", await run(seats.player, P.restore)); } } catch (err) { console.error("restore player:", err?.message ?? err); }
  for (const id of imported) { try { note(`${id} document removed`, await run(gm, P.removeDoc, { id })); } catch (err) { console.error("removeDoc:", err?.message ?? err); } }
  for (const [key, api] of Object.entries(seats)) {
    try { note(`sweep (${key})`, await api.sweepTracked()); } catch (err) { console.error(`sweep ${key}:`, err?.message ?? err); }
  }
  try { if (gm && housePre === "") note("trade house setting cleared", await run(gm, P.clearHouse, { value: "" })); } catch (err) { console.error("clearHouse:", err?.message ?? err); }
  try { if (gm) note("day at the end", await run(gm, P.day)); } catch {}
  note("clock advances", advances);
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
