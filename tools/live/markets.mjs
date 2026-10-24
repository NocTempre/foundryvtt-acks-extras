/**
 * Live walk, markets: markets + location + the lib pointer.
 * Walks: the gate walk (G0–G7, and P0–P5 for the goods at the gate; STAGE=gate stops
 * after it); the parties walk (S0–S9, characters of one party entering separately;
 * STAGE=parties walks it alone); the moorage walk (M0–M11, the stay's daily fee
 * charged on leaving and at the month's end; STAGE=moorage walks it alone); the
 * default-trader ad hoc; the
 * known-market walk (1–7); the network walk (1–6); reports step 10 and the step-4 hunk
 * (picks, the card's link); the ledger-length ad hoc; the hit-point tool from the party
 * sheet. Machine values arrive through ./_env.mjs.
 * Every figure typed into a
 * fixture is invented; imported figures stay in this log and are never quoted by name.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - the two seats' own client state: the dice rig, the patched notification methods,
 *     the wrapped ChatMessage.create, a handler on the gate's hook, and each seat's
 *     `marketsActingTrader` client setting (read first, put back);
 *   - a book connected on the GM seat with remember:false; a rules document the run
 *     imported is removed; a trade house the run made is swept and its setting cleared;
 *   - the world's `marketsRandomTariff` setting, read first and put back;
 *   - one roster each of the gate walk's, the parties walk's and the moorage walk's
 *     own in the world's `marketParties`, removed by its id;
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
const STAGE = process.env.STAGE ?? ""; // "gate" stops after the gate walk; "parties" and "moorage" walk only that walk
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
      GT: await import(base + "markets/engine/gate.mjs"),
    };
    /**
     * Declare an open Enter dialog's goods through its own ticks: `forSale` and
     * `smuggled` hold goods' "holderUuid|itemId" keys, `sneak` the party's tick.
     * Every tick not named is cleared.
     */
    H.declare = (dialog, { forSale = [], smuggled = [], sneak = false } = {}) => {
      const fire = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));
      const tick = (el, want) => { if (el && el.checked !== want) { el.checked = want; fire(el); } };
      for (const el of dialog.querySelectorAll('input[name="forSale"]')) tick(el, forSale.includes(el.value));
      for (const el of dialog.querySelectorAll('input[name="smuggle"]')) tick(el, smuggled.includes(el.value));
      tick(dialog.querySelector('input[name="sneak"]'), !!sneak);
    };
    /** What an open Enter dialog's goods block shows: each good's row, whether it is shown, and the ticks it carries with their accessible names. */
    H.goodsBlock = (dialog) => ({
      rows: [...dialog.querySelectorAll(".acks-extras-markets-good")].map((div) => ({
        text: H.text(div.querySelector(":scope > span")),
        hidden: div.hidden,
        vehicle: div.dataset.goodVehicle ?? "",
        smuggle: div.querySelector('input[name="smuggle"]')?.value ?? "",
        forSale: div.querySelector('input[name="forSale"]')?.value ?? "",
        named: [...div.querySelectorAll("input")].every((el) => !!el.getAttribute("aria-label")),
      })),
      sneak: !!dialog.querySelector('input[name="sneak"]'),
    });
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
      picker: (() => { const s = sec?.querySelector("[data-venture-category]"); return { present: !!s, captioned: !!s?.labels?.length && !!H.text(s.labels[0]).length }; })(),
      enterButton: !!sec?.querySelector('[data-action="ventureEnter"]'),
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
  /** Press Enter the market on the open Trade tab and read the dialog; submit with a cargo figure, a mode and the goods declared (`H.declare`) unless told to read only. */
  ventureEnterUI: async ({ locationId, other = 0, mode = null, submit = true, declare = {} }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureEnter"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="other"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, dialog: false, notes: H.takeNotes() };
    const dialog = input.closest(".application");
    dialog.dataset.qaEnter = "1";
    H.declare(dialog, declare);
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
    return game.messages.contents.filter((m) => m.timestamp >= since && re.test(m.content ?? "")).map((m) => { const div = document.createElement("div"); div.innerHTML = m.content; return { id: m.id, text: H.text(div).slice(0, 600), uuids: [...m.content.matchAll(/(?:data-uuid="|@UUID\[)([^"\]]+)/g)].map((x) => x[1]) }; });
  },
  characteristics: async ({ marketClass }) => {
    const H = globalThis.__c2;
    const rows = H.T.getTable("mercantile", "marketCharacteristics")?.rows ?? [];
    const row = H.T.findRow(rows, (r) => Number(r.marketClass) === Number(marketClass)) ?? null;
    return { hasRow: !!row, baseline: row ? H.m.AR.parseStones(row.baselineCargo) : null, tollPerSt: row ? H.m.AR.parseTollCpPerSt(row.toll) : null, impactCap: H.m.PR.impactLimits()?.impactCap ?? null, bands: H.m.PR.assessmentBands() };
  },
  /** The gate's imported inputs for one class, and whether every class's tariff cell reads. Figures stay in the log. */
  gateRates: async ({ marketClass }) => {
    const H = globalThis.__c2;
    const rows = H.T.getTable("mercantile", "marketCharacteristics")?.rows ?? [];
    const rowOf = (cls) => H.T.findRow(rows, (r) => Number(r.marketClass) === cls) ?? null;
    const row = rowOf(marketClass);
    return {
      tollPerSt: row ? H.m.AR.parseTollCpPerSt(row.toll) : null,
      rates: row ? H.m.AR.parseTariffPct(row.tariff) : null,
      everyCellReads: [1, 2, 3, 4, 5, 6].every((cls) => rowOf(cls) && H.m.AR.parseTariffPct(rowOf(cls).tariff) !== null),
      dice: H.m.PR.tariffDice(),
      ranges: H.m.PR.tariffDice() ? { precious: H.m.AR.diceRange(H.m.PR.tariffDice().precious), common: H.m.AR.diceRange(H.m.PR.tariffDice().common) } : null,
    };
  },
  /** GM: the Randomized Tariff read off the connected book through the shipped recipe, returned for every seat's layer; nothing is written to the world. */
  tariffFromBook: async () => {
    const H = globalThis.__c2;
    const base = "/modules/acks-extras/scripts/importer/";
    const { TABLE_RECIPES } = await import(base + "table-recipes.mjs");
    const { locatePageNumber } = await import(base + "tables-binding.mjs");
    const { extractTable } = await import(base + "table-extract.mjs");
    const { pageItems } = await import(base + "extract.mjs");
    const recipe = TABLE_RECIPES.mercantile.tables.tariffProse;
    const doc = H.m.CB.cookbookSessionDoc(recipe.book);
    if (!doc) return { read: false, reason: "book not connected" };
    const p = await locatePageNumber(doc, recipe);
    if (p == null) return { read: false, reason: "page not found" };
    const { items } = await pageItems(doc, p);
    return { read: true, table: extractTable(items, recipe) };
  },
  /** This seat's priority-30 Randomized Tariff layer, on with `table` or off; reports whether the gate then reads its dice. */
  tariffLayer: async ({ on, table = null }) => {
    const H = globalThis.__c2;
    if (on) { H.T.registerTable({ id: "mercantile", tables: { tariffProse: table } }, { priority: 30, source: "qa-gate" }); H.gateLayer = true; }
    else if (H.gateLayer) { H.T.unregisterTable("mercantile", { priority: 30 }); H.gateLayer = false; }
    return { dice: !!H.m.PR.tariffDice() };
  },
  /** GM: the Moorage and Stabling table read off the connected book through the shipped recipe, for a world whose Mercantile import predates it; nothing is written to the world. */
  stayFromBook: async () => {
    const H = globalThis.__c2;
    const base = "/modules/acks-extras/scripts/importer/";
    const { TABLE_RECIPES } = await import(base + "table-recipes.mjs");
    const { locatePageNumber } = await import(base + "tables-binding.mjs");
    const { extractTable } = await import(base + "table-extract.mjs");
    const { pageItems } = await import(base + "extract.mjs");
    const recipe = TABLE_RECIPES.mercantile.tables.moorageRates;
    const doc = H.m.CB.cookbookSessionDoc(recipe.book);
    if (!doc) return { read: false, reason: "book not connected" };
    const p = await locatePageNumber(doc, recipe);
    if (p == null) return { read: false, reason: "page not found" };
    const { items } = await pageItems(doc, p);
    return { read: true, table: extractTable(items, recipe) };
  },
  /** This seat's priority-31 Moorage and Stabling layer, on with `table` or off; reports the kinds the gate then reads. */
  stayLayer: async ({ on, table = null }) => {
    const H = globalThis.__c2;
    if (on) { H.T.registerTable({ id: "mercantile", tables: { moorageRates: table } }, { priority: 31, source: "qa-moorage" }); H.stayLayer = true; }
    else if (H.stayLayer) { H.T.unregisterTable("mercantile", { priority: 31 }); H.stayLayer = false; }
    return { kinds: Object.keys(H.m.PR.stayRates() ?? {}) };
  },
  /**
   * Press Enter on the open Trade tab, read the goods block it opens on, then
   * declare each of `declarations` in turn ({vehicleUuids, other}) through the
   * dialog's own controls, ticking the goods `declare` names (`H.declare`)
   * once the first declaration's vehicles are ticked. The gate block is read
   * at the opening and after each declaration, and the goods block after the
   * last; submit the last unless told to read only, and wait for `cards` chat
   * cards.
   */
  gateDialog: async ({ locationId, declarations, submit = true, declare = {}, cards = 0 }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureEnter"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="other"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, dialog: false, notes: H.takeNotes() };
    const dialog = input.closest(".application");
    dialog.dataset.qaEnter = "1";
    const opening = H.goodsBlock(dialog);
    const read = () => { const box = dialog.querySelector("[data-gate-quote]"); return { text: H.text(box), lines: [...(box?.querySelectorAll("li") ?? [])].map((li) => H.text(li)) }; };
    await H.sleep(250);
    const reads = [read()];
    for (const [n, d] of declarations.entries()) {
      for (const el of dialog.querySelectorAll('input[name="vehicle"]')) {
        const want = (d.vehicleUuids ?? []).includes(el.value);
        if (el.checked !== want) { el.checked = want; el.dispatchEvent(new Event("change", { bubbles: true })); }
      }
      if (n === 0) H.declare(dialog, declare);
      input.value = String(d.other ?? 0);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await H.sleep(250);
      reads.push(read());
    }
    const goods = H.goodsBlock(dialog);
    if (!submit) return { pressed: true, dialog: true, opening, goods, reads, notes: H.takeNotes() };
    const loc = game.actors.get(locationId);
    const known = new Set((loc.system.market.goods.actions ?? []).map((a) => a.id));
    H.takeChat();
    dialog.querySelector('button[data-action="ok"]').click();
    const action = await H.poll(() => (loc.system.market.goods.actions ?? []).find((a) => a.kind === "enter" && a.status === "pending" && !known.has(a.id)) ?? null, { tries: 40, every: 250 });
    await H.poll(() => (H.chat.length >= cards ? true : null), { tries: 20, every: 250 });
    await H.sleep(400);
    return { pressed: true, dialog: true, opening, goods, reads, submitted: true, notes: H.takeNotes(), chat: H.takeChat(), action: action ? { id: action.id, cargoSt: action.cargoSt, tollCp: action.tollCp, tariffCp: action.tariffCp, privilegeUuid: action.privilegeUuid, sneaked: !!action.sneaked, detail: action.detail, vehicleUuids: [...action.vehicleUuids] } : null };
  },
  /** Wait until this seat holds the actor with at least `items` embedded items. */
  seen: async ({ actorId, items = 0 }) => {
    const H = globalThis.__c2;
    const a = await H.poll(() => { const x = game.actors.get(actorId); return x && x.items.size >= items ? x : null; }, { tries: 50, every: 200 });
    return { seen: !!a, items: game.actors.get(actorId)?.items.size ?? null };
  },
  /** GM: an entry posted through the api, under a dice rig when `u` is given (every die then shows the same face). */
  gateEnterApi: async ({ locationId, actorId, vehicleUuids, u = null }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    if (u !== null) { H.rig0 = H.rig0 ?? CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => u; }
    H.takeChat();
    let r = null;
    try { r = await H.M.performVentureAction(loc, { kind: "enter", actorUuid: game.actors.get(actorId).uuid, vehicleUuids, cargoSt: 0, resolutionId: foundry.utils.randomID() }); } finally { H.unrig(); }
    await H.sleep(400);
    const action = (loc.system.market.goods.actions ?? []).filter((a) => a.kind === "enter" && a.status === "pending").at(-1) ?? null;
    return { ok: !!r?.ok, error: r?.error ?? null, table: r?.table ?? null, chat: H.takeChat(), action: action ? { id: action.id, tollCp: action.tollCp, tariffCp: action.tariffCp, detail: action.detail } : null };
  },
  /** GM: resolve one pending entry now, without moving the shared clock. */
  gateResolve: async ({ locationId, actionId }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const actions = (loc.system.market.goods.actions ?? []).map((a) => H.plain(a));
    const action = actions.find((a) => a.id === actionId);
    if (!action) return { found: false };
    action.resolveTime = game.time.worldTime;
    H.takeChat();
    await loc.update({ "system.market.goods.actions": actions });
    await H.M.processImports(loc);
    await H.poll(() => (game.actors.get(locationId).system.market.goods.actions ?? []).find((a) => a.id === actionId)?.status === "done" || null, { tries: 40, every: 250 });
    await H.sleep(600);
    const v = H.M.ventureOf(loc, H.M.partyOf(fromUuidSync(action.actorUuid)).id);
    return { found: true, venture: v ? { entered: !!v.entered, tollCp: v.tollCp, tariffCp: v.tariffCp, privilegeUuid: v.privilegeUuid } : null, chat: H.takeChat() };
  },
  /** The trader's newest ledger rows at a market: type, gp and the note with the trader's name dropped. */
  ledgerTail: async ({ locationId, actorId, n = 3 }) => {
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    return (loc.system.market.marketLog ?? []).filter((r) => r.actorUuid === a.uuid).slice(-n).map((r) => ({ type: r.type, gp: r.gp ?? null, note: String(r.note ?? "").replace(a.name, "T") }));
  },
  /** GM: make the domain fixture hold the market under `rulerId` (none when null), and read whose privilege the gate finds for the party entering with the trader (`enteringMembers`, read on the player's sight when `asUserId` is given). */
  gateDomain: async ({ domainId, locationId, traderId, rulerId = null, asUserId = null }) => {
    const D = game.actors.get(domainId);
    const loc = game.actors.get(locationId);
    const held = D.system.holdsPlace(loc.uuid) ? { ok: true, already: true } : await acksExtras.domains.hold(D, loc);
    await D.update({ "system.rulerUuid": rulerId ? game.actors.get(rulerId).uuid : "" });
    const gate = acksExtras.markets.gate;
    const entering = gate.enteringMembers(loc, game.actors.get(traderId), asUserId ? game.users.get(asUserId) : game.user);
    return { held, domainOf: acksExtras.domains.domainOf(loc)?.id ?? null, privilege: gate.privilegeDomain(loc, entering)?.id ?? null, entering: entering.map((a) => a.id) };
  },
  /** Set an actor's ownership to exactly the map given, dropping any entry the create added. */
  ownershipSet: async ({ actorId, ownership }) => {
    const a = game.actors.get(actorId);
    await a.update({ ownership }, { diff: false, recursive: false });
    return { ownership: { ...game.actors.get(actorId).ownership } };
  },
  /** Where each actor stands for this seat: present at the market, visible, owned, in the implicit party. */
  presence: async ({ locationId, actorIds }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const party = new Set(H.m.PA.partyMembers(H.M.partyOf(game.actors.get(actorIds[0])).id).map((a) => a.uuid));
    return Object.fromEntries(actorIds.map((id) => { const a = game.actors.get(id); return [id, a ? { present: H.m.MO.coinReach(a, loc).can, sees: a.testUserPermission(game.user, "LIMITED"), owns: a.testUserPermission(game.user, "OWNER"), member: party.has(a.uuid) } : null]; }));
  },
  itemsOf: async ({ actorId }) => Object.fromEntries(game.actors.get(actorId).items.map((i) => [i.name, i.id])),
  /** Another player who can own a character (not a Judge, not banned), for a member owned by someone other than the player seat; only its id leaves the page. */
  otherPlayer: async ({ not }) => game.users.find((u) => !u.isGM && u.role >= CONST.USER_ROLES.PLAYER && u.id !== not)?.id ?? null,
  /** GM: add a roster to the world's party registry, or remove one by its id. The registry is read right before the write, and no other entry is touched. */
  roster: async ({ add = null, off = null }) => {
    const drop = add?.id ?? off;
    const list = [...(game.settings.get("acks-extras", "marketParties") ?? [])].filter((p) => p?.id !== drop);
    if (add) list.push(add);
    await game.settings.set("acks-extras", "marketParties", list);
    return { has: !!add && game.settings.get("acks-extras", "marketParties").some((p) => p?.id === add.id) };
  },
  /** This seat's handler on the gate's hook, adding `cp` under `label` at one market unless the party sneaks in, or removed. */
  gateHook: async ({ on, locationId = null, label = "", cp = 0 }) => {
    const H = globalThis.__c2;
    if (H.gateHookId) { Hooks.off("acksExtras.marketGateQuote", H.gateHookId); H.gateHookId = null; }
    if (on) H.gateHookId = Hooks.on("acksExtras.marketGateQuote", (quote, { location }) => { if (location.id === locationId && !quote.sneaked) quote.extra.push({ label, cp }); });
    return { on: !!H.gateHookId };
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
  /** The roster's characters as this seat resolves them, by id. */
  partiesSeen: async ({ rosterId }) => ({ members: globalThis.__c2.m.PA.partyMembers(rosterId).map((a) => a.id), isGM: game.user.isGM }),
  /**
   * Press Enter on the open Trade tab and read the dialog it opens on: the
   * entering mode, the vehicles, the goods rows and the gate block. Then choose
   * `mode` through its radio where it is not fixed, tick exactly `vehicleUuids`
   * and type `other` stone where given, read again, and submit unless told to
   * read only.
   */
  partiesDialog: async ({ locationId, mode = null, vehicleUuids = null, other = null, submit = true }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureEnter"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="other"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, dialog: false, notes: H.takeNotes() };
    const dialog = input.closest(".application");
    dialog.dataset.qaEnter = "1";
    const fire = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));
    const read = () => {
      const box = dialog.querySelector("fieldset.acks-extras-markets-mode");
      return {
        mode: box ? { legend: H.text(box.querySelector("legend")), radios: [...box.querySelectorAll('input[name="mode"]')].map((el) => ({ value: el.value, checked: el.checked, disabled: el.disabled })), hints: [...box.querySelectorAll("p.hint")].map((p) => H.text(p)) } : null,
        vehicles: [...dialog.querySelectorAll('input[name="vehicle"]')].map((el) => ({ uuid: el.value, checked: el.checked, disabled: el.disabled, text: H.text(el.closest("label")) })),
        goods: H.goodsBlock(dialog).rows,
        members: [...dialog.querySelectorAll("[data-good-member]")].map((el) => ({ holder: el.dataset.goodMember, hidden: el.hidden })),
        quote: H.text(dialog.querySelector("[data-gate-quote]")),
      };
    };
    await H.sleep(250);
    const opening = read();
    const radio = mode ? dialog.querySelector(`input[name="mode"][value="${mode}"]`) : null;
    if (radio && !radio.disabled && !radio.checked) { radio.checked = true; fire(radio); }
    if (vehicleUuids) for (const el of dialog.querySelectorAll('input[name="vehicle"]:not(:disabled)')) { const want = vehicleUuids.includes(el.value); if (el.checked !== want) { el.checked = want; fire(el); } }
    if (other !== null) { input.value = String(other); input.dispatchEvent(new Event("input", { bubbles: true })); }
    await H.sleep(250);
    const chosen = read();
    if (!submit) return { pressed: true, dialog: true, opening, chosen, notes: H.takeNotes() };
    const loc = game.actors.get(locationId);
    const known = new Set((loc.system.market.goods.actions ?? []).map((a) => a.id));
    H.takeChat();
    dialog.querySelector('button[data-action="ok"]').click();
    const action = await H.poll(() => (game.actors.get(locationId).system.market.goods.actions ?? []).find((a) => a.kind === "enter" && !known.has(a.id)) ?? null, { tries: 40, every: 250 });
    await H.sleep(400);
    return { pressed: true, dialog: true, opening, chosen, submitted: true, notes: H.takeNotes(), chat: H.takeChat(), action: action ? { id: action.id, actorUuid: action.actorUuid, entrantUuid: action.entrantUuid, entrants: action.entrants, vehicleUuids: [...action.vehicleUuids], cargoSt: action.cargoSt, tollCp: action.tollCp, tariffCp: action.tariffCp, privilegeUuid: action.privilegeUuid, detail: action.detail } : null };
  },
  /** A venture day posted through the api as `actorId`, in `mode` for an entry; the action it queued, if any. */
  partiesApi: async ({ locationId, kind, actorId, mode = "party", vehicleUuids = [], category = "" }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const a = game.actors.get(actorId);
    const known = new Set((loc.system.market.goods.actions ?? []).map((x) => x.id));
    H.takeChat();
    const r = await H.M.performVentureAction(loc, { kind, actorUuid: a.uuid, mode, vehicleUuids, category, cargoSt: 0, resolutionId: foundry.utils.randomID() });
    await H.sleep(500);
    const action = (game.actors.get(locationId).system.market.goods.actions ?? []).find((x) => !known.has(x.id) && x.actorUuid === a.uuid) ?? null;
    return { ok: !!r?.ok, error: r?.error ?? null, vehicle: r?.vehicle ?? null, chat: H.takeChat(), action: action ? { id: action.id, kind: action.kind, entrantUuid: action.entrantUuid, entrants: action.entrants, vehicleUuids: [...action.vehicleUuids], tollCp: action.tollCp, tariffCp: action.tariffCp, privilegeUuid: action.privilegeUuid, detail: action.detail } : null };
  },
  /** GM: resolve the named pending days now, without moving the shared clock; the cards the sweep posted. */
  partiesResolve: async ({ locationId, actionIds }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const actions = (loc.system.market.goods.actions ?? []).map((a) => H.plain(a));
    const found = actions.filter((a) => actionIds.includes(a.id));
    for (const a of found) a.resolveTime = game.time.worldTime;
    H.takeChat();
    await loc.update({ "system.market.goods.actions": actions });
    await H.M.processImports(loc);
    const done = await H.poll(() => actionIds.every((id) => (game.actors.get(locationId).system.market.goods.actions ?? []).find((a) => a.id === id)?.status === "done") || null, { tries: 40, every: 250 });
    await H.sleep(600);
    return { found: found.length, done: !!done, chat: H.takeChat() };
  },
  /** Wait until this seat reads every action in `actionIds` done: another seat's write reaches it over the socket. */
  seesDone: async ({ locationId, actionIds }) => {
    const H = globalThis.__c2;
    const done = await H.poll(() => actionIds.every((id) => (game.actors.get(locationId).system.market.goods.actions ?? []).find((a) => a.id === id)?.status === "done") || null, { tries: 40, every: 250 });
    return { done: !!done };
  },
  /** Wait until this seat reads an actor's spendable coin move off `from`; the last read either way. */
  coinMoved: async ({ actorId, from }) => {
    const H = globalThis.__c2;
    const read = () => H.m.MO.spendableGp(game.actors.get(actorId));
    await H.poll(() => (Math.abs(read() - from) >= 0.005 ? true : null), { tries: 40, every: 250 });
    return { gp: read() };
  },
  /** The market's venture rows, pools and waiting days this month, as this seat reads them. */
  partiesState: async ({ locationId }) => {
    const H = globalThis.__c2;
    const g = game.actors.get(locationId).system.market.goods;
    const ms = H.m.TR.marketMonthStart();
    return {
      ventures: (g.ventures ?? []).filter((v) => Number(v.monthStartTime) === ms).map((v) => ({ partyId: v.partyId, entrantUuid: v.entrantUuid, entrants: v.entrants, entered: !!v.entered, impact: v.impact, rawImpact: v.rawImpact, impactCap: v.impactCap, effectiveClass: v.effectiveClass, cargoSt: v.cargoSt, vehicleUuids: [...(v.vehicleUuids ?? [])], tollCp: v.tollCp, tariffCp: v.tariffCp, privilegeUuid: v.privilegeUuid })),
      pools: (g.solicitations ?? []).filter((s) => Number(s.monthStartTime) === ms).map((s) => ({ partyId: s.partyId, entrantUuid: s.entrantUuid, category: s.category, stones: s.stones })),
      pending: (g.actions ?? []).filter((a) => a.status === "pending").map((a) => ({ id: a.id, kind: a.kind, actorUuid: a.actorUuid, entrantUuid: a.entrantUuid, category: a.category })),
    };
  },
  /** Leave the market as `actorId`, in the venture that character acts in. */
  partiesLeave: async ({ locationId, actorId }) => {
    const r = await globalThis.__c2.M.performVentureLeave(game.actors.get(locationId), { actorUuid: game.actors.get(actorId).uuid });
    return { ok: !!r?.ok, error: r?.error ?? null, cancelled: r?.cancelled ?? null };
  },
  /** What the venture trade dialog would offer `actorId`: its rows and holds, from the dialog's own context. */
  partiesTradeRows: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    const app = new H.M.VentureTradeDialog({ location: game.actors.get(locationId), trader: game.actors.get(actorId) });
    const ctx = await app._prepareContext({});
    return { entrantUuid: ctx.venture?.entrantUuid ?? null, rows: ctx.rows.map((r) => ({ category: r.category, stones: r.stones })), holds: ctx.holds.map((h) => h.uuid) };
  },
  /** A venture trade through the api as `actorId`, into or out of `holdUuid`. */
  partiesTrade: async ({ locationId, actorId, category, stones, direction, holdUuid }) => {
    const H = globalThis.__c2;
    H.takeChat();
    const r = await H.M.performVentureTrade(game.actors.get(locationId), { actorUuid: game.actors.get(actorId).uuid, category, stones, direction, holdUuid, negotiate: false, resolutionId: foundry.utils.randomID() });
    await H.sleep(400);
    return { ok: !!r?.ok, error: r?.error ?? null, stones: r?.stones ?? null, chat: H.takeChat() };
  },
  /** GM: write the party's venture row back without the keys entering separately added, and read how it comes back. */
  partiesPreUpgrade: async ({ locationId, partyId }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const ms = H.m.TR.marketMonthStart();
    const rows = (loc.system.market.goods.ventures ?? []).map((v) => H.plain(v));
    const row = rows.find((v) => v.partyId === partyId && !v.entrantUuid && Number(v.monthStartTime) === ms);
    if (!row) return { found: false };
    delete row.entrantUuid;
    delete row.entrants;
    await loc.update({ "system.market.goods.ventures": rows });
    const back = (game.actors.get(locationId).system.market.goods.ventures ?? []).find((v) => v.partyId === partyId && Number(v.monthStartTime) === ms && v.entered);
    return { found: true, wrote: Object.keys(row).filter((k) => k === "entrantUuid" || k === "entrants"), back: back ? { entrantUuid: back.entrantUuid, entrants: back.entrants } : null };
  },
  /** The imported Moorage and Stabling rates as the gate reads them. */
  stayRates: async () => globalThis.__c2.m.PR.stayRates(),
  /**
   * Press Enter on the open Trade tab and read the dialog's moorage block and
   * gate quote; then tick exactly `vehicleUuids`, choose `stayAt`, set each
   * vehicle's stabling in `stabled` (by uuid) and each head count in
   * `animals`, tick the sneak where asked, read again, and submit unless told
   * to read only. Read only, the dialog is closed.
   */
  moorageDialog: async ({ locationId, vehicleUuids = null, stayAt = null, stabled = {}, animals = {}, sneak = false, submit = true }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureEnter"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="other"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, dialog: false, notes: H.takeNotes() };
    const dialog = input.closest(".application");
    dialog.dataset.qaEnter = "1";
    const fire = (el, type = "change") => el.dispatchEvent(new Event(type, { bubbles: true }));
    const read = () => {
      const box = dialog.querySelector("fieldset.acks-extras-markets-stay");
      const at = box?.querySelector('select[name="stayAt"]');
      const quote = dialog.querySelector("[data-gate-quote]");
      return {
        legend: H.text(box?.querySelector("legend")),
        at: at ? { value: at.value, options: [...at.options].map((o) => o.value), captioned: !!at.labels?.length } : null,
        stabled: [...(box?.querySelectorAll('select[name="stabled"]') ?? [])].map((el) => ({ vehicle: el.dataset.vehicle, value: el.value, hidden: !!el.closest("[data-stay-vehicle]")?.hidden, label: H.text(el.labels?.[0]) })),
        animals: [...(box?.querySelectorAll('input[name="animal"]') ?? [])].map((el) => ({ unit: el.dataset.unit, value: Number(el.value), label: H.text(el.labels?.[0]) })),
        quote: H.text(quote),
        lines: [...(quote?.querySelectorAll("li") ?? [])].map((li) => H.text(li)),
      };
    };
    await H.sleep(250);
    const opening = read();
    if (vehicleUuids) for (const el of dialog.querySelectorAll('input[name="vehicle"]:not(:disabled)')) { const want = vehicleUuids.includes(el.value); if (el.checked !== want) { el.checked = want; fire(el); } }
    const atSel = dialog.querySelector('select[name="stayAt"]');
    if (stayAt && atSel && atSel.value !== stayAt) { atSel.value = stayAt; fire(atSel); }
    for (const el of dialog.querySelectorAll('select[name="stabled"]')) { const want = stabled[el.dataset.vehicle]; if (want && el.value !== want) { el.value = want; fire(el); } }
    for (const el of dialog.querySelectorAll('input[name="animal"]')) { const want = animals[el.dataset.unit]; if (want !== undefined) { el.value = String(want); fire(el, "input"); } }
    if (sneak) H.declare(dialog, { sneak: true });
    await H.sleep(300);
    const chosen = read();
    if (!submit) {
      await H.apps().find((a) => H.root(a) === dialog)?.close({ force: true });
      return { pressed: true, dialog: true, opening, chosen, notes: H.takeNotes() };
    }
    const known = new Set((game.actors.get(locationId).system.market.goods.actions ?? []).map((a) => a.id));
    H.takeChat();
    dialog.querySelector('button[data-action="ok"]').click();
    const action = await H.poll(() => (game.actors.get(locationId).system.market.goods.actions ?? []).find((a) => a.kind === "enter" && !known.has(a.id)) ?? null, { tries: 40, every: 250 });
    await H.sleep(400);
    return { pressed: true, dialog: true, opening, chosen, submitted: true, notes: H.takeNotes(), chat: H.takeChat(), action: action ? { id: action.id, stayAt: action.stayAt, stayCpPerDay: action.stayCpPerDay, sneaked: action.sneaked, tollCp: action.tollCp, privilegeUuid: action.privilegeUuid, vehicleUuids: [...action.vehicleUuids], detail: action.detail } : null };
  },
  /** An entry posted through the api as `actorId`, with what it says about the stay; the action it queued, if any. */
  moorageApi: async ({ locationId, actorId, vehicleUuids = [], stayAt = "berth", stabled = {}, animals = {}, sneak = false }) => {
    const H = globalThis.__c2;
    const loc = game.actors.get(locationId);
    const known = new Set((loc.system.market.goods.actions ?? []).map((x) => x.id));
    H.takeChat();
    const r = await H.M.performVentureAction(loc, { kind: "enter", actorUuid: game.actors.get(actorId).uuid, vehicleUuids, stayAt, stabled, animals, sneak, cargoSt: 0, resolutionId: foundry.utils.randomID() });
    await H.sleep(500);
    const action = (game.actors.get(locationId).system.market.goods.actions ?? []).find((x) => !known.has(x.id) && x.kind === "enter") ?? null;
    return { ok: !!r?.ok, error: r?.error ?? null, vehicle: r?.vehicle ?? null, chat: H.takeChat(), action: action ? { id: action.id, stayAt: action.stayAt, stayCpPerDay: action.stayCpPerDay, sneaked: action.sneaked, tollCp: action.tollCp, privilegeUuid: action.privilegeUuid, detail: action.detail } : null };
  },
  /** The party's venture row at a market, this month's or the previous month's, with its stay. */
  moorageRow: async ({ locationId, partyId, prev = false }) => {
    const H = globalThis.__c2;
    const ms = H.m.TR.marketMonthStart();
    const month = prev ? H.m.TR.marketMonthStart(ms - 1) : ms;
    const v = (game.actors.get(locationId).system.market.goods.ventures ?? []).find((x) => x.partyId === partyId && !x.entrantUuid && Number(x.monthStartTime) === month);
    return v ? { entered: !!v.entered, arrivalDay: H.m.WT.dayOfWorldTime(v.enteredTime), stayAt: v.stayAt, stayCpPerDay: v.stayCpPerDay, payerUuid: v.payerUuid, stayDays: v.stayDays, stayPaidCp: v.stayPaidCp, staySettled: !!v.staySettled } : null;
  },
  /** GM: move this month's row's arrival `days` calendar days earlier, without moving the clock. */
  moorageBackdate: async ({ locationId, partyId, days }) => {
    const H = globalThis.__c2;
    const d = game.time.calendar?.days;
    const n = Number(d?.hoursPerDay) * Number(d?.minutesPerHour) * Number(d?.secondsPerMinute);
    const spd = Number.isFinite(n) && n > 0 ? n : 86400;
    const loc = game.actors.get(locationId);
    const ms = H.m.TR.marketMonthStart();
    const rows = (loc.system.market.goods.ventures ?? []).map((v) => H.plain(v));
    const row = rows.find((v) => v.partyId === partyId && !v.entrantUuid && Number(v.monthStartTime) === ms);
    if (!row) return { found: false };
    row.enteredTime -= days * spd;
    await loc.update({ "system.market.goods.ventures": rows });
    return { found: true, arrivalDay: H.m.WT.dayOfWorldTime(row.enteredTime), today: H.day() };
  },
  /** Press Leave on the open Trade tab, read the confirmation, and confirm it. */
  moorageLeaveUI: async ({ locationId }) => {
    const H = globalThis.__c2;
    H.takeNotes();
    H.takeChat();
    const btn = await H.poll(() => H.root(H.locSheet(locationId))?.querySelector('[data-action="ventureLeave"]') ?? null, { tries: 40, every: 200 });
    if (!btn) return { pressed: false };
    btn.click();
    const yes = await H.poll(() => document.querySelector('.application.dialog button[data-action="yes"]'), { tries: 40, every: 200 });
    if (!yes) return { pressed: true, confirm: false };
    const text = H.text(yes.closest(".application").querySelector(".window-content"));
    yes.click();
    // The leave's own notice, or its refusal, says the handler finished; a fixed wait can end first.
    await H.poll(() => H.notes.some((n) => n.kind !== "info" || n.text.startsWith("Left the market")) || null, { tries: 40, every: 250 });
    await H.sleep(400);
    return { pressed: true, confirm: true, text, notes: H.takeNotes(), chat: H.takeChat() };
  },
  /** Leave the market as `actorId` through the api; what the stay came to, or the refusal. */
  moorageLeave: async ({ locationId, actorId }) => {
    const H = globalThis.__c2;
    H.takeChat();
    const r = await H.M.performVentureLeave(game.actors.get(locationId), { actorUuid: game.actors.get(actorId).uuid });
    await H.sleep(400);
    return { ok: !!r?.ok, error: r?.error ?? null, gp: r?.gp ?? null, days: r?.days ?? null, stay: r?.stay ?? null, chat: H.takeChat() };
  },
  /** How a vehicle remembers it was stabled, or null. */
  moorageFlag: async ({ actorId }) => game.actors.get(actorId)?.getFlag("acks-extras", "markets")?.stabledAs ?? null,
  /** This seat's handler on the gate's hook, setting the stay's day fee at one market, or removed. */
  stayHook: async ({ on, locationId = null, cpPerDay = 0 }) => {
    const H = globalThis.__c2;
    if (H.stayHookId) { Hooks.off("acksExtras.marketGateQuote", H.stayHookId); H.stayHookId = null; }
    if (on) H.stayHookId = Hooks.on("acksExtras.marketGateQuote", (quote, { location }) => { if (location.id === locationId) quote.stay.cpPerDay = cpPerDay; });
    return { on: !!H.stayHookId };
  },
  /** Take every coin an actor has on hand out of the world. */
  drain: async ({ actorId }) => {
    const H = globalThis.__c2;
    const a = game.actors.get(actorId);
    const had = H.m.MO.spendableGp(a);
    if (had > 0) await H.m.MO.sinkCoin(a, had);
    return { drained: had, gp: H.m.MO.spendableGp(game.actors.get(actorId)) };
  },
  /**
   * GM: write venture rows into the previous market month, entered `arrivalOffset`
   * days after it began, each with a daily fee and a payer unless `legacy`,
   * which is written without any of the stay's keys. Says whether this seat
   * is the primary GM's, which alone settles them.
   */
  rollRows: async ({ locationId, rows }) => {
    const H = globalThis.__c2;
    const d = game.time.calendar?.days;
    const n = Number(d?.hoursPerDay) * Number(d?.minutesPerHour) * Number(d?.secondsPerMinute);
    const spd = Number.isFinite(n) && n > 0 ? n : 86400;
    const ms = H.m.TR.marketMonthStart();
    if (!(ms > 0)) return { skip: true };
    const prev = H.m.TR.marketMonthStart(ms - 1);
    const loc = game.actors.get(locationId);
    const out = (loc.system.market.goods.ventures ?? []).map((v) => H.plain(v));
    const made = [];
    for (const r of rows) {
      const enteredTime = prev + r.arrivalOffset * spd;
      const row = { partyId: r.partyId, entrantUuid: "", entrants: 0, monthStartTime: prev, cargoSt: 0, vehicleUuids: [], impact: 1, effectiveClass: 3, tollCp: 0, tariffCp: 0, privilegeUuid: "", entered: true, enteredTime, rawImpact: 1, impactCap: 1, networkMode: "auto" };
      if (!r.legacy) Object.assign(row, { stayAt: "berth", stayCpPerDay: r.cpPerDay, payerUuid: game.actors.get(r.payerId).uuid, stayDays: 0, stayPaidCp: 0, staySettled: false });
      out.push(row);
      made.push({ partyId: r.partyId, arrivalDay: H.m.WT.dayOfWorldTime(enteredTime) });
    }
    await loc.update({ "system.market.goods.ventures": out });
    const UT = await import("/modules/acks-extras/scripts/lib/util.mjs");
    return { skip: false, lastDay: H.m.WT.dayOfWorldTime(ms - 1), made, primary: UT.isPrimaryGM() };
  },
  /** GM: run the market's due-work sweep, and read back the named previous-month rows, the stay's ledger rows and the chat it posted. */
  rollSettle: async ({ locationId, partyIds }) => {
    const H = globalThis.__c2;
    H.takeChat();
    await H.M.processImports(game.actors.get(locationId));
    await H.sleep(800);
    const g = game.actors.get(locationId).system.market.goods;
    const prev = H.m.TR.marketMonthStart(H.m.TR.marketMonthStart() - 1);
    const rows = Object.fromEntries(partyIds.map((p) => { const v = (g.ventures ?? []).find((x) => x.partyId === p && Number(x.monthStartTime) === prev); return [p, v ? { stayCpPerDay: v.stayCpPerDay, stayDays: v.stayDays, stayPaidCp: v.stayPaidCp, staySettled: !!v.staySettled } : null]; }));
    const log = (game.actors.get(locationId).system.market.marketLog ?? []).filter((r) => r.type === "ventureStay").map((r) => ({ actorUuid: r.actorUuid, gp: r.gp, note: r.note }));
    return { rows, log, chat: H.takeChat() };
  },
  closeAll: async () => globalThis.__c2.closeAll(),
  restore: async () => {
    const H = globalThis.__c2 ?? {};
    const out = {};
    if (H.unrig) { H.unrig(); out.dice = "restored"; }
    if (H.chatWrapped) { ChatMessage.create = H.chatCreate; H.chatWrapped = false; out.chat = "restored"; }
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; out.notes = "restored"; }
    if (H.settingBefore !== undefined) { await game.settings.set("acks-extras", "marketsActingTrader", H.settingBefore); out.actingTrader = { restoredTo: H.settingBefore === "" ? "(empty)" : "(a uuid)" }; }
    if (H.gateLayer) { H.T.unregisterTable("mercantile", { priority: 30 }); H.gateLayer = false; out.tariffLayer = "unregistered"; }
    if (H.stayLayer) { H.T.unregisterTable("mercantile", { priority: 31 }); H.stayLayer = false; out.stayLayer = "unregistered"; }
    if (H.gateHookId) { Hooks.off("acksExtras.marketGateQuote", H.gateHookId); H.gateHookId = null; out.gateHook = "removed"; }
    if (H.stayHookId) { Hooks.off("acksExtras.marketGateQuote", H.stayHookId); H.stayHookId = null; out.stayHook = "removed"; }
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

/** Thrown to end the walk early at the stage STAGE names; teardown still runs. */
class StageDone extends Error {}

let gm = null;
let advances = 0;
let housePre = null;
let randomBefore = null;
let gateRoster = null;
let partiesRoster = null;
let moorageRoster = null;
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
  // Every entry bringing a vehicle reads the moorage table. A world imported before the
  // table's recipe holds none: read it off the connected book and layer it in memory on
  // both seats for the run, as the gate walk does the thrown tariff.
  const STAY_KINDS = ["ship", "wagon", "cartElephant", "horse", "camelDonkeyOx"];
  const stayWhole = (rates) => !!rates && STAY_KINDS.every((k) => rates[k]);
  if (!stayWhole(await run(gm, P.stayRates))) {
    const fb = await run(gm, P.stayFromBook);
    note("the world's import lacks the moorage table; read off the book", { read: fb.read, reason: fb.reason ?? null, rows: fb.table?.rows?.length ?? null });
    if (fb.read) note("moorage layers on", { gm: await run(gm, P.stayLayer, { on: true, table: fb.table }), player: await run(player, P.stayLayer, { on: true, table: fb.table }) });
  }
  const ch3 = await run(gm, P.characteristics, { marketClass: 3 });
  const ch1 = await run(gm, P.characteristics, { marketClass: 1 });
  note("characteristics read (class 3, class 1)", { hasRow3: ch3.hasRow, hasRow1: ch1.hasRow, cap: ch3.impactCap, bandsRead: !!ch3.bands });
  if (!ch3.hasRow || !ch3.impactCap || !ch3.bands) throw new Error("the mercantile document's characteristics, impact limits or assessment bands are not readable: the venture days cannot resolve");

  if (STAGE !== "parties" && STAGE !== "moorage") {
    section("the gate walk: toll, tariff, smuggled goods, sneaking in, the Ruler's Privilege, the thrown tariff");
    const gr = await run(gm, P.gateRates, { marketClass: 3 });
    note("the gate's imported inputs (class 3)", gr);
    check("G0: every class's tariff cell in the imported Market Characteristics reads as a precious and a common rate", gr.everyCellReads && !!gr.rates, { everyCellReads: gr.everyCellReads, class3: !!gr.rates });
    if (!gr.rates || gr.tollPerSt === null) throw new Error("the class-3 toll or tariff cell is unreadable: the gate walk cannot price an entry");
    const gOwn = { default: 0, [pc.userId]: 3 };
    // Every price and stone count here is invented; the rates and dice are the import's.
    const PRICE = { p: 40, c: 3, e: 2 };
    const KEY = { p: `qgp${NONCE}`, c: `qgc${NONCE}`, e: `qge${NONCE}` };
    // The gate labels a load by its good's catalogue name.
    const LABEL = { p: `QA Precious ${NONCE}`, c: `QA Common ${NONCE}`, e: `QA Exempt ${NONCE}` };
    const CAP = 60;
    const G = await gm.create("Actor", { name: `QA Gate Town ${NONCE}`, type: "acks-extras.location" });
    note("market G", await run(gm, P.addMarket, { locationId: G.id, classOverride: 3 }));
    // A place on no map is reached by its owners: with the player seat G's only owner, a member that seat does not own is elsewhere.
    note("G owned by the player seat alone", await run(gm, P.ownershipSet, { actorId: G.id, ownership: gOwn }));
    for (const [k, tier, exempt, label] of [["p", "precious", false, "Precious"], ["c", "common", false, "Common"], ["e", "common", true, "Exempt"]]) {
      await gm.create("Item", { name: `QA ${label} ${NONCE}`, type: "acks-extras.merchandise", system: { key: KEY[k], tier, tariffExempt: exempt, pricePerStoneGp: PRICE[k], priceStepGp: 1, dailyStones: [10, 5, 2, 1, 1, 1] } });
    }
    const load = (k, stones, more = {}) => ({ name: `QA load ${k} ${NONCE}`, type: "item", system: { quantity: { value: stones, max: 0 }, cost: PRICE[k], weight6: 6 }, flags: { "acks-extras": { markets: { merchandise: true, category: KEY[k] }, ...more } } });
    // Goods carried, not loads: the cup is of the precious type by its own flag and may be declared for sale; the charm is magic, which the gate never assesses.
    const kit = (name, cost, quantity, more = {}) => ({ name: `QA ${name} ${NONCE}`, type: "item", system: { quantity: { value: quantity, max: 0 }, cost, weight6: 1 }, flags: { "acks-extras": { markets: { category: KEY.p, ...more } } } });
    const CUP = { cost: 25, n: 2 };
    // The partner's load is of a tier the class taxes, so assessing it moves the trader's coin.
    const tk = gr.rates.precious > 0 ? "p" : "c";
    const T = await gm.create("Actor", { name: `QA Gate Trader ${NONCE}`, type: "character", ownership: gOwn, items: [load("p", 2), kit("Cup", CUP.cost, CUP.n), kit("Charm", 30, 1, { magic: true })], flags: { "acks-extras": { markets: { trader: true } } } });
    const Q = await gm.create("Actor", { name: `QA Gate Partner ${NONCE}`, type: "character", ownership: gOwn, items: [load(tk, 1)] });
    // A is a member who is elsewhere: another player's character the player seat sees, with a load the gate never assesses.
    const other = await run(gm, P.otherPlayer, { not: pc.userId });
    const A = await gm.create("Actor", { name: `QA Gate Absent ${NONCE}`, type: "character", items: [load("c", 4)] });
    note("A owned apart from G", await run(gm, P.ownershipSet, { actorId: A.id, ownership: { default: 0, ...(other ? { [other]: 3 } : {}), [pc.userId]: 2 } }));
    const NP = await gm.create("Actor", { name: `QA Gate Stranger ${NONCE}`, type: "character", ownership: { default: 0 }, items: [] });
    // Thirty common stones and ten exempt aboard, and five kept aboard for the stranger, which the gate never sees.
    const VH = await gm.create("Actor", { name: `QA Gate Wagon ${NONCE}`, type: "acks-extras.vehicle", ownership: gOwn, system: { kind: "land", cargo: { capacityStone: CAP } }, items: [load("c", 30), load("e", 10), load("c", 5, { storage: { ownerUuid: NP.uuid, ownerName: "QA" } })] });
    const D = await gm.create("Actor", { name: `QA Gate Barony ${NONCE}`, type: "acks-extras.domain" });
    // The walk's party is a roster of its own, so no other character in the world brings goods to this gate.
    gateRoster = `qa-gate-${NONCE}`;
    note("the walk's party roster", await run(gm, P.roster, { add: { id: gateRoster, name: `QA Gate Party ${NONCE}`, memberUuids: [T.uuid, Q.uuid, A.uuid] } }));
    await sleep(500);
    const gp = (cp) => Math.round(cp) / 100;
    const due = (sum) => (sum > 0 ? Math.ceil(sum - 1e-9) : 0);
    const tollOn = (st) => Math.ceil(gr.tollPerSt * st);
    // Each good's base cost at a set of rates, in coppers: the trader's packs, the partner's, the hold's thirty common stone, the cup.
    const cpOf = (r) => ({ T: 2 * PRICE.p * r.precious, Q: PRICE[tk] * (tk === "p" ? r.precious : r.common), hold: 30 * PRICE.c * r.common, cup: CUP.n * CUP.cost * r.precious });
    const tariffAt = (r, { hold = true } = {}) => { const c = cpOf(r); return due(c.T + c.Q + (hold ? c.hold : 0)); };
    const coinOf = async (who = T) => (await run(gm, P.coin, { actorId: who.id })).gp;
    const near = (a, b) => Math.abs(a - b) < 0.005;
    // Every quote with the wagon ticked carries its stay, stabled as a wagon within, as one line more; the moorage walk walks the stay.
    const stayLine = `${VH.name}: ${gp(Math.ceil((await run(gm, P.stayRates))?.wagon?.berth?.cp ?? NaN))}gp`;
    note("coin", { T: await run(gm, P.coin, { actorId: T.id, mint: 5000 }), Q: await run(gm, P.coin, { actorId: Q.id, mint: 500 }) });

    // P0: the members stand where the steps need them, as the player seat reads it.
    for (const [a, n] of [[T, 3], [Q, 1], [A, 1]]) note(`${a.name.split(" ").slice(0, 3).join(" ")} as the player seat sees it`, await run(player, P.seen, { actorId: a.id, items: n }));
    const pres = await run(player, P.presence, { locationId: G.id, actorIds: [T, Q, A, NP].map((a) => a.id) });
    note("presence (player seat)", pres);
    check("P0: the trader and the partner are members at the market, the absent member is a member the player seat sees who is not, and the stranger is no member", [T, Q].every((a) => pres[a.id]?.present && pres[a.id].member && pres[a.id].owns) && pres[A.id]?.member && pres[A.id].sees && !pres[A.id].present && !pres[NP.id]?.member, { pres, secondPlayer: !!other });
    const cup = `${T.uuid}|${(await run(player, P.itemsOf, { actorId: T.id }))[`QA Cup ${NONCE}`]}`;

    // G1–G3: the printed tariff, previewed declaration by declaration, paid with the toll, carried to the venture row.
    // The picker lists only the actors this client holds: a tab opened before T reaches the player acts as someone else.
    const tab = await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
    note("trade tab at G as T (player)", { acting: tab.acting, isT: tab.acting === T.id, enterButton: tab.enterButton });
    if (tab.acting !== T.id) throw new Error("the player's Trade tab does not act as T: the gate walk would drive another character");
    const coin0 = { T: await coinOf(), Q: await coinOf(Q) };
    const d1 = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }, { vehicleUuids: [], other: 5 }, { vehicleUuids: [VH.uuid], other: 0 }] });
    for (const id of d1.chat ?? []) player.track(id, "ChatMessage");
    // The block also lists the hold of every other vehicle the player seat owns; the walk reads the packs' rows and its own wagon's.
    const goods = (d1.opening?.rows ?? []).filter((r) => !r.vehicle || r.vehicle === VH.uuid);
    note("the goods block the dialog opened on (player)", { goods, sneak: d1.opening?.sneak, otherHolds: (d1.opening?.rows ?? []).length - goods.length });
    const rowOf = (text, holder) => goods.find((r) => r.text.includes(text) && r.text.includes(holder.name)) ?? null;
    const packsT = rowOf(`${LABEL.p}, 2 st`, T), packsQ = rowOf(`${LABEL[tk]}, 1 st`, Q), hold30 = rowOf(`${LABEL.c}, 30 st`, VH), hold10 = rowOf(`${LABEL.e}, 10 st`, VH), cupRow = rowOf(`QA Cup ${NONCE} ×${CUP.n}`, T);
    check("P1: the goods block opens on a row for the load in each present member's packs, one for each load of the wagon's own (hidden until the wagon is ticked), and one for the cup; every load can be marked smuggled and the cup brought to sell or smuggled, every tick is named, and the party can sneak in; nothing of the absent member's, the stranger's kept load, or the charm", goods.length === 5 && goods.every((r) => r.named && r.smuggle) && !!packsT && !packsT.hidden && !packsT.forSale && !!packsQ && !packsQ.hidden && hold30?.vehicle === VH.uuid && hold30.hidden && hold10?.vehicle === VH.uuid && hold10.hidden && cupRow?.forSale === cup && cupRow.smuggle === cup && !goods.some((r) => r.text.includes("Charm") || r.text.includes(A.name) || /, [45] st/.test(r.text)) && !!d1.opening?.sneak, { goods, cup });
    note("the gate block per declaration (player): the opening, the wagon, five other stone, the wagon", d1.reads);
    const full = { toll: tollOn(CAP), tariff: tariffAt(gr.rates) };
    const [r0, r1, r2] = d1.reads ?? [];
    check("G1: the Enter dialog's gate block follows the declaration — the present members' packs alone with no capacity, the wagon's capacity with its two loads added and the exempt one marked, then five other stone and the packs again — at the imported rates on the invented prices", d1.dialog && r0?.text.includes("Toll: 0gp on 0 st") && r0.text.includes(`Tariff (RR 372): ${gp(tariffAt(gr.rates, { hold: false }))}gp`) && r0.lines.length === 2 && r1?.text.includes(`Toll: ${gp(full.toll)}gp on ${CAP} st`) && r1.text.includes(`Tariff (RR 372): ${gp(full.tariff)}gp`) && r1.lines.length === 5 && r1.lines.includes(stayLine) && r1.lines.filter((l) => l.endsWith(": exempt")).length === 1 && !r1.lines.some((l) => /, [45] st/.test(l)) && r2?.text.includes(`Toll: ${gp(tollOn(5))}gp on 5 st`) && r2.lines.length === 2, { r0, r1, r2, full });
    const coin1 = { T: await coinOf(), Q: await coinOf(Q) };
    const tail1 = await run(gm, P.ledgerTail, { locationId: G.id, actorId: T.id, n: 1 });
    note("posted entry, coin and ledger", { action: d1.action, notes: d1.notes, coin0, coin1, tail1 });
    check("G2: the posted entry carries that toll and tariff and no privilege, the trader paid exactly their sum once and the partner whose load was assessed nothing, and the ledger row itemizes both", d1.action && d1.action.tollCp === full.toll && d1.action.tariffCp === full.tariff && d1.action.privilegeUuid === "" && !d1.action.sneaked && d1.action.cargoSt === CAP && near(coin0.T - coin1.T, gp(full.toll + full.tariff)) && near(coin0.Q, coin1.Q) && tail1[0]?.type === "ventureAction" && near(tail1[0].gp, -gp(full.toll + full.tariff)) && tail1[0].note.includes(`toll ${gp(full.toll)}gp, tariff ${gp(full.tariff)}gp paid`), { action: d1.action, paid: coin0.T - coin1.T, tail1 });
    const res1 = await run(gm, P.gateResolve, { locationId: G.id, actionId: d1.action?.id });
    for (const id of res1.chat ?? []) gm.track(id, "ChatMessage");
    const cards1 = await run(gm, P.cards, { ids: res1.chat ?? [] });
    note("entry resolved", { venture: res1.venture, cards: cards1.map((c) => c.text) });
    check("G3: the resolved venture row holds the toll and tariff paid, and the entered card states both", res1.venture?.entered && res1.venture.tollCp === full.toll && res1.venture.tariffCp === full.tariff && res1.venture.privilegeUuid === "" && cards1.some((c) => c.text.includes(`Paid at the gate: toll ${gp(full.toll)}gp, tariff ${gp(full.tariff)}gp.`)), { venture: res1.venture });
    note("leave G", await run(player, P.ventureLeave, { locationId: G.id, actorId: T.id }));
    note("closed (player)", await run(player, P.closeAll));

    // P2–P3: the wagon goes in with the cup brought to sell, the partner's load and the hold's thirty stone
    // marked smuggled, and a charge of the Judge's own added through the hook.
    const HOOK = { label: "QA watch", cp: 500 };
    note("gate hook on (both seats)", { gm: await run(gm, P.gateHook, { on: true, locationId: G.id, ...HOOK }), player: await run(player, P.gateHook, { on: true, locationId: G.id, ...HOOK }) });
    await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
    const coin4a = { T: await coinOf(), Q: await coinOf(Q) };
    const since4 = Date.now();
    const d4 = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }], declare: { forSale: [cup], smuggled: [packsQ?.smuggle, hold30?.smuggle].filter(Boolean) }, cards: 1 });
    for (const id of d4.chat ?? []) player.track(id, "ChatMessage");
    note("gate hook off (both seats)", { gm: await run(gm, P.gateHook, { on: false }), player: await run(player, P.gateHook, { on: false }) });
    const coin4b = { T: await coinOf(), Q: await coinOf(Q) };
    const tail4 = await run(gm, P.ledgerTail, { locationId: G.id, actorId: T.id, n: 1 });
    const smug4 = await run(gm, P.recentCards, { since: since4, pattern: `smuggles into QA Gate Town ${NONCE}` });
    for (const c of smug4) if (!(d4.chat ?? []).includes(c.id)) gm.track(c.id, "ChatMessage");
    const c4 = cpOf(gr.rates);
    const x4 = { toll: tollOn(CAP), tariff: due(c4.T + c4.cup) };
    x4.paid = x4.toll + x4.tariff + HOOK.cp;
    const read4 = d4.reads?.at(-1) ?? { text: "", lines: [] };
    const lineOf = (who, text) => read4.lines.find((l) => l.startsWith(`${who.name}:`) && l.includes(text)) ?? null;
    const smuggledQ = lineOf(Q, `${LABEL[tk]}, 1 st`), smuggled30 = lineOf(VH, `${LABEL.c}, 30 st`);
    note("the entry with goods smuggled and the Judge's charge", { read: read4, action: d4.action, coin4a, coin4b, tail4, cards: smug4.map((c) => c.text), expect: x4 });
    check("P2: the dialog quotes the toll, the trader's packs and the cup brought to sell at the precious rate, the exempt load, and the hook's charge, and lists the partner's load and the thirty stone apart and untaxed; the absent member's goods and the stranger's kept load appear nowhere", read4.text.includes(`Toll: ${gp(x4.toll)}gp on ${CAP} st`) && read4.text.includes(`Tariff (RR 372): ${gp(x4.tariff)}gp`) && !!lineOf(T, `${LABEL.p}, 2 st at ${gr.rates.precious}%: ${gp(c4.T)}gp`) && !!lineOf(T, `QA Cup ${NONCE} ×${CUP.n} at ${gr.rates.precious}%: ${gp(c4.cup)}gp`) && !!lineOf(VH, `${LABEL.e}, 10 st: exempt`) && read4.lines.some((l) => l.includes(`${HOOK.label}: ${gp(HOOK.cp)}gp`)) && read4.text.includes("Smuggled past the gate:") && !!smuggledQ && !smuggledQ.includes("%") && !!smuggled30 && !smuggled30.includes("%") && read4.lines.length === 7 && read4.lines.includes(stayLine) && !read4.lines.some((l) => l.startsWith(`${A.name}:`) || /, [45] st/.test(l)), { read4, expect: x4 });
    const res4 = await run(gm, P.gateResolve, { locationId: G.id, actionId: d4.action?.id });
    for (const id of res4.chat ?? []) gm.track(id, "ChatMessage");
    note("the entry resolved", res4.venture);
    const named4 = [`${LABEL[tk]} (1 st, ${Q.name})`, `${LABEL.c} (30 st, ${VH.name})`];
    check("P3: the entry charges that toll and tariff with the hook's charge in its detail, the trader paid the whole of it and the partner nothing, the ledger itemizes each charge and names what was smuggled and whose, one card tells the Judge the same, and nothing was thrown", d4.action?.tollCp === x4.toll && d4.action.tariffCp === x4.tariff && !d4.action.sneaked && !/→/.test(d4.action.detail) && d4.action.detail.includes(`${HOOK.label} ${gp(HOOK.cp)}gp`) && !!res4.venture?.entered && near(coin4a.T - coin4b.T, gp(x4.paid)) && near(coin4a.Q, coin4b.Q) && near(tail4[0]?.gp, -gp(x4.paid)) && tail4[0].note.includes(`toll ${gp(x4.toll)}gp, tariff ${gp(x4.tariff)}gp, ${HOOK.label} ${gp(HOOK.cp)}gp paid)`) && named4.every((s) => tail4[0].note.includes(s)) && smug4.length === 1 && smug4[0].text.includes(`${T.name} smuggles into QA Gate Town ${NONCE}: `) && named4.every((s) => smug4[0].text.includes(s)) && smug4[0].text.includes("RR §VIII.5"), { action: d4.action, venture: res4.venture, tail4, cards: smug4.map((c) => c.text) });
    note("leave G", await run(player, P.ventureLeave, { locationId: G.id, actorId: T.id }));
    note("closed (player)", await run(player, P.closeAll));

    // P4: the party sneaks in.
    await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
    const coin7a = await coinOf();
    const since7 = Date.now();
    const d7 = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }], declare: { sneak: true }, cards: 1 });
    for (const id of d7.chat ?? []) player.track(id, "ChatMessage");
    const coin7b = await coinOf();
    const tail7 = await run(gm, P.ledgerTail, { locationId: G.id, actorId: T.id, n: 1 });
    const smug7 = await run(gm, P.recentCards, { since: since7, pattern: `sneaks into QA Gate Town ${NONCE}` });
    for (const c of smug7) if (!(d7.chat ?? []).includes(c.id)) gm.track(c.id, "ChatMessage");
    const res7 = await run(gm, P.gateResolve, { locationId: G.id, actionId: d7.action?.id });
    for (const id of res7.chat ?? []) gm.track(id, "ChatMessage");
    const cards7 = await run(gm, P.cards, { ids: res7.chat ?? [] });
    const read7 = d7.reads?.at(-1) ?? { text: "", lines: [] };
    const brought7 = [`${LABEL.p} (2 st, ${T.name})`, `${LABEL[tk]} (1 st, ${Q.name})`, `${LABEL.c} (30 st, ${VH.name})`, `${LABEL.e} (10 st, ${VH.name})`];
    note("sneaked in", { read: read7, action: d7.action, coin7a, coin7b, tail7, smuggled: smug7.map((c) => c.text), entered: cards7.map((c) => c.text) });
    check("P4: with the sneak ticked the dialog says the party sneaks in and lists all four loads untaxed, the entry charges no toll or tariff, records the sneak and takes nothing, the ledger says so, one card tells the Judge everything the party brings (not the stranger's or the absent member's), and the entered card says nothing was paid", read7.text.includes("No toll or tariff: the party sneaks in") && read7.lines.length === 5 && read7.lines.includes(stayLine) && !read7.lines.some((l) => l.includes("%")) && d7.action?.tollCp === 0 && d7.action.tariffCp === 0 && d7.action.sneaked && near(coin7a, coin7b) && !!tail7[0]?.note.includes("(sneaked in, nothing paid) Smuggled: ") && smug7.length === 1 && smug7[0].text.includes(`${T.name}'s party sneaks into QA Gate Town ${NONCE}, bringing `) && brought7.every((s) => smug7[0].text.includes(s)) && !smug7[0].text.includes("(5 st") && !smug7[0].text.includes(A.name) && cards7.some((c) => c.text.includes("Sneaked in: no toll or tariff paid.")), { read7, action: d7.action, tail7, smuggled: smug7.map((c) => c.text) });
    note("leave G", await run(player, P.ventureLeave, { locationId: G.id, actorId: T.id }));
    note("closed (player)", await run(player, P.closeAll));

    // G4–G5: the Ruler's Privilege.
    const ruledBy = (rulerId) => run(gm, P.gateDomain, { domainId: D.id, locationId: G.id, traderId: T.id, rulerId });
    const byT = await ruledBy(T.id), byQ = await ruledBy(Q.id), byA = await ruledBy(A.id), byNP = await ruledBy(NP.id);
    note("privilege by ruler", { byT, byQ, byA, byNP });
    check("G4: with the barony holding the market, a ruler among the members at the market grants the privilege, the trader or the partner alike, while a member who is elsewhere, or a stranger, does not; the members entering are the trader and the partner", byT.held?.ok && byT.domainOf === D.id && byT.privilege === D.id && byT.entering.length === 2 && [T.id, Q.id].every((id) => byT.entering.includes(id)) && byQ.privilege === D.id && byA.privilege === null && byNP.domainOf === D.id && byNP.privilege === null, { byT, byQ, byA, byNP });
    note("the trader rules", await run(gm, P.gateDomain, { domainId: D.id, locationId: G.id, traderId: T.id, rulerId: T.id }));
    await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
    const coin2 = await coinOf();
    const d2 = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }] });
    for (const id of d2.chat ?? []) player.track(id, "ChatMessage");
    const coin3 = await coinOf();
    const tail2 = await run(gm, P.ledgerTail, { locationId: G.id, actorId: T.id, n: 1 });
    const res2 = await run(gm, P.gateResolve, { locationId: G.id, actionId: d2.action?.id });
    for (const id of res2.chat ?? []) gm.track(id, "ChatMessage");
    const cards2 = await run(gm, P.cards, { ids: res2.chat ?? [] });
    note("privileged entry", { read: d2.reads?.at(-1), action: d2.action, coin2, coin3, tail2, venture: res2.venture, cards: cards2.map((c) => c.text) });
    check("G5: under the trader's own rule the dialog names the privilege and the barony, the entry pays nothing and records the domain, the ledger says nothing was paid, and the entered card says so", (d2.reads?.at(-1)?.text ?? "").includes(`No toll or tariff: Ruler's Privilege in QA Gate Barony ${NONCE}`) && d2.action?.tollCp === 0 && d2.action.tariffCp === 0 && d2.action.privilegeUuid === D.uuid && near(coin2, coin3) && tail2[0]?.note.includes("ruler's privilege, nothing paid") && res2.venture?.privilegeUuid === D.uuid && cards2.some((c) => c.text.includes("Ruler's Privilege: no toll or tariff paid.")), { read: d2.reads?.at(-1)?.text, action: d2.action, tail2, venture: res2.venture });
    note("leave G", await run(player, P.ventureLeave, { locationId: G.id, actorId: T.id }));
    note("closed (player)", await run(player, P.closeAll));

    // P5: the player seat's dialog finds the same ruler among the members at the market.
    const ruledRead = async (rulerId) => {
      note("ruler", await ruledBy(rulerId));
      await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
      const d = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }], submit: false });
      note("dialog closed", await run(player, P.closeDialog));
      return d.reads?.at(-1)?.text ?? "";
    };
    const q8in = await ruledRead(Q.id), q8away = await ruledRead(A.id);
    note("the dialog with the partner ruling, then the absent member", { q8in, q8away });
    check("P5: with the partner ruling the player's dialog names the privilege, and with the absent member ruling it charges the toll", q8in.includes(`No toll or tariff: Ruler's Privilege in QA Gate Barony ${NONCE}`) && q8away.includes(`Toll: ${gp(tollOn(CAP))}gp on ${CAP} st`) && !q8away.includes("Ruler's Privilege"), { q8in, q8away });
    note("closed (player)", await run(player, P.closeAll));
    note("no ruler", await ruledBy(null));

    // G6–G7: the Judge's randomized tariff. A world imported before the dice
    // recipe holds none: its refusal is checked, then the dice are read off the
    // book through the shipped recipe into a priority-30 layer on both seats —
    // nothing written to the world — and the thrown half is walked on them.
    const rnd = await run(gm, P.settingSet, { key: "marketsRandomTariff", value: true });
    if (randomBefore === null) randomBefore = rnd.before;
    note("randomized tariff on", rnd);
    await sleep(500);
    const randomRead = async () => {
      await run(player, P.tradeTab, { locationId: G.id, traderId: T.id });
      const d = await run(player, P.gateDialog, { locationId: G.id, declarations: [{ vehicleUuids: [VH.uuid], other: 0 }], submit: false });
      note("dialog closed", await run(player, P.closeDialog));
      return d.reads?.at(-1) ?? { text: "", lines: [] };
    };
    let thrown = gr;
    if (!gr.dice) {
      const read6 = await randomRead();
      const coinR = await coinOf();
      const e6 = await run(gm, P.gateEnterApi, { locationId: G.id, actorId: T.id, vehicleUuids: [VH.uuid], u: null });
      for (const id of e6.chat ?? []) gm.track(id, "ChatMessage");
      const coinR2 = await coinOf();
      note("randomized with no dice in the world", { read6, e6, coinR, coinR2 });
      check("G6r (the world holds no dice): the dialog and the entry both refuse, naming the Randomized Tariff table, and nothing is paid", read6.text.includes("Randomized Tariff") && e6.error === "printedMissing" && e6.table === "Randomized Tariff" && !e6.action && near(coinR, coinR2), { read6: read6.text, e6 });
      const fb = await run(gm, P.tariffFromBook);
      const layered = fb.read && (await run(gm, P.tariffLayer, { on: true, table: fb.table })).dice && (await run(player, P.tariffLayer, { on: true, table: fb.table })).dice;
      note("the dice read off the book through the shipped recipe, layered at priority 30 on both seats", { read: fb.read, reason: fb.reason ?? null, layered });
      thrown = layered ? await run(gm, P.gateRates, { marketClass: 3 }) : null;
    }
    const whence = gr.dice ? "imported" : "read off the book";
    if (thrown?.dice) {
      const read3 = await randomRead();
      const coin4 = await coinOf();
      const end = (side) => ({ precious: thrown.rates.precious > 0 ? thrown.ranges.precious[side] : 0, common: thrown.rates.common > 0 ? thrown.ranges.common[side] : 0 });
      const lo = tariffAt(end("min")), hi = tariffAt(end("max"));
      check(`G6: with the tariff randomized the dialog shows the span the ${whence} dice can come to and lists the loads without a rate`, read3.text.includes(`thrown at the gate, ${gp(lo)}gp to ${gp(hi)}gp`) && read3.lines.length === 5 && read3.lines.includes(stayLine) && !read3.lines.some((l) => l.includes("%")), { read3, lo, hi });
      const e3 = await run(gm, P.gateEnterApi, { locationId: G.id, actorId: T.id, vehicleUuids: [VH.uuid], u: 0.001 });
      for (const id of e3.chat ?? []) gm.track(id, "ChatMessage");
      const coin5 = await coinOf();
      note("thrown entry (every die at its top face)", { e3, coin4, coin5 });
      check(`G7: thrown on the ${whence} dice with every die at its top face, the entry's tariff is the top of the span, the toll is unchanged, the detail records each throw, and the trader paid their sum`, e3.ok && e3.action?.tariffCp === hi && e3.action.tollCp === full.toll && /→ \d+%/.test(e3.action.detail) && near(coin4 - coin5, gp(full.toll + hi)), { e3, paid: coin4 - coin5 });
      const res3 = await run(gm, P.gateResolve, { locationId: G.id, actionId: e3.action?.id });
      for (const id of res3.chat ?? []) gm.track(id, "ChatMessage");
      note("thrown entry resolved", res3.venture);
      note("leave G", await run(player, P.ventureLeave, { locationId: G.id, actorId: T.id }));
    } else check("G6–G7: the thrown tariff's dice are readable from the world or the connected book", false, { worldDice: !!gr.dice, books: BOOKS.length });
    note("tariff layers off", { gm: await run(gm, P.tariffLayer, { on: false }), player: await run(player, P.tariffLayer, { on: false }) });
    note("randomized tariff restored", await run(gm, P.settingSet, { key: "marketsRandomTariff", value: randomBefore }));
    note("the walk's party roster removed", await run(gm, P.roster, { off: gateRoster }));
    gateRoster = null;
    note("closed (player)", await run(player, P.closeAll));
    note("closed (gm)", await run(gm, P.closeAll));
  }
  if (STAGE === "gate") throw new StageDone("gate");

  if (STAGE !== "moorage") {
    section("the parties walk: characters of one party entering separately (RR ch. 8, Entering the Market, step 2, Parties)");
    // The gate's charges here are the printed ones, so the tariff is the fixed rate for the walk.
    const rnd = await run(gm, P.settingSet, { key: "marketsRandomTariff", value: false });
    if (randomBefore === null) randomBefore = rnd.before;
    const gr = await run(gm, P.gateRates, { marketClass: 3 });
    note("the gate's imported inputs (class 3)", gr);
    if (!gr.rates || gr.tollPerSt === null) throw new Error("the class-3 toll or tariff cell is unreadable: the parties walk cannot price an entry");
    const other = await run(gm, P.otherPlayer, { not: pc.userId });
    const own = { default: 0, [pc.userId]: 3 };
    // Every price, stone count, capacity and daily figure here is invented; the rates and the maximum impact are the import's.
    const PRICE = { p: 40, c: 3 };
    const KEY = { p: `qpp${NONCE}`, c: `qpc${NONCE}` };
    const DAILY = [12, 8, 6, 4, 3, 2];
    const CAP = { A: 40, B: 30 };
    const M = await gm.create("Actor", { name: `QA Parties Town ${NONCE}`, type: "acks-extras.location" });
    note("market M", await run(gm, P.addMarket, { locationId: M.id, classOverride: 3 }));
    // Both players own M, so the second player's character, whom the player seat cannot see, stands there too.
    note("M owned by the two players", await run(gm, P.ownershipSet, { actorId: M.id, ownership: { ...own, ...(other ? { [other]: 3 } : {}) } }));
    for (const [k, tier, label] of [["p", "precious", "Precious"], ["c", "common", "Common"]]) {
      await gm.create("Item", { name: `QA Parties ${label} ${NONCE}`, type: "acks-extras.merchandise", system: { key: KEY[k], tier, tariffExempt: false, pricePerStoneGp: PRICE[k], priceStepGp: 1, dailyStones: DAILY } });
    }
    const load = (k, stones, more = {}) => ({ name: `QA parties load ${k} ${NONCE}`, type: "item", system: { quantity: { value: stones, max: 0 }, cost: PRICE[k], weight6: 6 }, flags: { "acks-extras": { markets: { merchandise: true, category: KEY[k] }, ...more } } });
    const wagon = (name, cap, items = []) => gm.create("Actor", { name: `QA Parties ${name} ${NONCE}`, type: "acks-extras.vehicle", ownership: own, system: { kind: "land", cargo: { capacityStone: cap } }, items });
    // A driver is aboard their wagon without weighing on its hold.
    const drives = (v) => ({ "acks-extras": { attachedTo: { uuid: v.uuid, role: "crew", station: "driver" } } });
    const WA = await wagon("Wagon A", CAP.A);
    const A = await gm.create("Actor", { name: `QA Parties Ann ${NONCE}`, type: "character", ownership: own, items: [load("p", 2)], flags: { "acks-extras": { ...drives(WA)["acks-extras"], markets: { trader: true } } } });
    // B's wagon carries a load of its own and one stored for A, who arrives too.
    const WB = await wagon("Wagon B", CAP.B, [load("c", 6), load("c", 4, { storage: { ownerUuid: A.uuid, ownerName: "QA" } })]);
    const B = await gm.create("Actor", { name: `QA Parties Ben ${NONCE}`, type: "character", ownership: own, items: [load("p", 1)], flags: drives(WB) });
    const C = await gm.create("Actor", { name: `QA Parties Cas ${NONCE}`, type: "character", ownership: { default: 0, ...(other ? { [other]: 3 } : {}) } });
    const E = await gm.create("Actor", { name: `QA Parties Eli ${NONCE}`, type: "character", ownership: own });
    const D = await gm.create("Actor", { name: `QA Parties Barony ${NONCE}`, type: "acks-extras.domain" });
    partiesRoster = `qa-parties-${NONCE}`;
    const roster = (ids) => run(gm, P.roster, { add: { id: partiesRoster, name: `QA Parties Party ${NONCE}`, memberUuids: ids.map((a) => a.uuid) } });
    note("the walk's party roster: A, B and C", await roster([A, B, C]));
    note("coin", { A: await run(gm, P.coin, { actorId: A.id, mint: 100 }), B: await run(gm, P.coin, { actorId: B.id, mint: 1000 }) });
    // A rules the barony that holds M: the Ruler's Privilege is A's alone once the characters enter separately.
    note("the barony holds M under A", await run(gm, P.gateDomain, { domainId: D.id, locationId: M.id, traderId: A.id, rulerId: A.id }));
    await sleep(500);
    const gp = (cp) => Math.round(cp) / 100;
    const due = (sum) => (sum > 0 ? Math.ceil(sum - 1e-9) : 0);
    const tollOn = (st) => Math.ceil(gr.tollPerSt * st);
    const cap = ch3.impactCap;
    const share = Math.floor(cap / 3);
    const coinOf = async (who) => (await run(gm, P.coin, { actorId: who.id })).gp;
    const near = (a, b) => Math.abs(a - b) < 0.005;
    const state = () => run(gm, P.partiesState, { locationId: M.id });
    const rowOf = (s, who) => s.ventures.find((v) => v.partyId === partiesRoster && v.entrantUuid === (who?.uuid ?? "")) ?? null;
    const poolOf = (s, who) => s.pools.find((p) => p.partyId === partiesRoster && p.entrantUuid === (who?.uuid ?? "") && p.category === KEY.c) ?? null;
    const trackChat = (api, r) => { for (const id of r?.chat ?? []) api.track(id, "ChatMessage"); return r; };
    const shareLine = (n) => `Entering separately: maximum market impact ${share} each, for ${n} characters.`;
    const wagons = (read) => Object.fromEntries((read?.vehicles ?? []).filter((v) => [WA.uuid, WB.uuid].includes(v.uuid)).map((v) => [v.uuid === WA.uuid ? "A" : "B", v]));
    const goodRow = (read, text, holder) => (read?.goods ?? []).find((r) => r.text.includes(text) && r.text.includes(holder.name)) ?? null;

    // S0: the roster's three characters, as each seat resolves them — the player seat cannot see C.
    const seenGm = await run(gm, P.partiesSeen, { rosterId: partiesRoster });
    const seenPl = await run(player, P.partiesSeen, { rosterId: partiesRoster });
    note("the roster as each seat resolves it", { gm: seenGm.members.length, player: seenPl.members.length, secondPlayer: !!other });
    check("S0: both seats count the roster's three characters, the player seat's including the one it cannot see", seenGm.members.length === 3 && seenPl.members.length === 3, { gm: seenGm.members.length, player: seenPl.members.length });
    for (const [a, n] of [[A, 1], [B, 1]]) note(`${a.name.split(" ").slice(0, 3).join(" ")} as the player seat sees it`, await run(player, P.seen, { actorId: a.id, items: n }));

    // S1: A enters separately through the dialog.
    const tabA = await run(player, P.tradeTab, { locationId: M.id, traderId: A.id });
    if (tabA.acting !== A.id) throw new Error("the player's Trade tab does not act as A: the parties walk would drive another character");
    const dA = await run(player, P.partiesDialog, { locationId: M.id, mode: "separately" });
    trackChat(player, dA);
    const oA = dA.opening ?? {}, cA = dA.chosen ?? {};
    note("A's Enter dialog: as it opened, then with Separately chosen (player)", { opening: { mode: oA.mode, wagons: wagons(oA), members: oA.members, quote: oA.quote }, chosen: { mode: cA.mode, wagons: wagons(cA), members: cA.members, quote: cA.quote }, notes: dA.notes });
    const radios = (read) => Object.fromEntries((read?.mode?.radios ?? []).map((r) => [r.value, r]));
    const packB = (read) => (read?.members ?? []).find((m) => m.holder === B.uuid) ?? null;
    check("S1a: A's dialog opens on the entering choice, As the party chosen, with the maximum each of three separate entrants would have; both wagons ticked as the party, and B's packs listed", oA.mode?.legend.startsWith("Entering") && radios(oA).party?.checked && !radios(oA).separately?.checked && !radios(oA).party?.disabled && oA.mode.hints.includes(shareLine(3)) && wagons(oA).A?.checked && wagons(oA).B?.checked && packB(oA) && !packB(oA).hidden, { mode: oA.mode, wagons: wagons(oA), members: oA.members });
    check("S1b: choosing Separately leaves only A's own wagon ticked, hides B's packs and the hold of B's wagon, and the gate names A's privilege", radios(cA).separately?.checked && wagons(cA).A?.checked && !wagons(cA).B?.checked && packB(cA)?.hidden && (cA.goods ?? []).filter((r) => r.vehicle === WB.uuid).every((r) => r.hidden) && !!goodRow(cA, "2 st", A) && !goodRow(cA, "2 st", A).hidden && cA.quote.includes(`No toll or tariff: Ruler's Privilege in QA Parties Barony ${NONCE}`), { chosen: cA });
    const aA = dA.action;
    check("S1c: A's entry is A's own, one of three, with A's wagon alone, A's privilege, nothing charged, and its detail says so", aA && aA.entrantUuid === A.uuid && aA.entrants === 3 && aA.vehicleUuids.length === 1 && aA.vehicleUuids[0] === WA.uuid && aA.privilegeUuid === D.uuid && aA.tollCp === 0 && aA.tariffCp === 0 && aA.detail.startsWith("separately, one of 3"), aA);
    note("closed (player)", await run(player, P.closeAll));

    // S2: B is held to entering separately, and A's wagon is through the gate.
    await run(player, P.tradeTab, { locationId: M.id, traderId: B.id });
    const rB = await run(player, P.partiesDialog, { locationId: M.id, submit: false });
    note("dialog closed", await run(player, P.closeDialog));
    const oB = rB.opening ?? {};
    note("B's Enter dialog (player)", { mode: oB.mode, wagons: wagons(oB), members: oB.members, quote: oB.quote });
    check("S2a: B's dialog opens fixed on Separately, saying the party's characters are entering separately, at the stored count; A's wagon is marked through the gate and cannot be ticked, B's own is ticked", radios(oB).separately?.checked && radios(oB).separately.disabled && radios(oB).party?.disabled && oB.mode.hints.includes("Your party's characters are entering separately this month.") && oB.mode.hints.includes(shareLine(3)) && wagons(oB).A?.disabled && !wagons(oB).A.checked && wagons(oB).A.text.includes("(already through the gate this month)") && wagons(oB).B?.checked && !wagons(oB).B.disabled, { mode: oB.mode, wagons: wagons(oB) });
    const asOne = await run(player, P.partiesApi, { locationId: M.id, kind: "enter", actorId: B.id, mode: "party" });
    const twice = await run(player, P.partiesApi, { locationId: M.id, kind: "enter", actorId: B.id, mode: "separately", vehicleUuids: [WA.uuid] });
    note("B entering as the party, then separately with A's wagon", { asOne, twice });
    check("S2b: B entering as the party is refused (enteredSeparately), and separately with A's wagon is refused naming it (vehicleEntered); neither posts", asOne.error === "enteredSeparately" && !asOne.action && twice.error === "vehicleEntered" && twice.vehicle === WA.name && !twice.action, { asOne, twice });

    // S3: B enters separately with B's own wagon and other capacity enough for two
    // more impact than a separate share at M's own class, and pays its own gate.
    const OTHER = ch3.baseline * (share + 2);
    const xB = { st: CAP.B + OTHER, toll: tollOn(CAP.B + OTHER), tariff: due(1 * PRICE.p * gr.rates.precious + 10 * PRICE.c * gr.rates.common) };
    await run(player, P.tradeTab, { locationId: M.id, traderId: B.id });
    const coinB0 = await coinOf(B);
    const dB = trackChat(player, await run(player, P.partiesDialog, { locationId: M.id, other: OTHER }));
    const coinB1 = await coinOf(B);
    const qB = dB.chosen ?? {};
    note("B's entry (player)", { quote: qB.quote, goods: (qB.goods ?? []).filter((r) => !r.vehicle || r.vehicle === WB.uuid), action: dB.action, coinB0, coinB1, expect: xB });
    check("S3a: B's quote charges the toll on B's wagon and other capacity and the tariff on B's packs and both loads in B's hold, the one stored for A included; A's packs are listed hidden, and A's privilege does not reach B", qB.quote.includes(`Toll: ${gp(xB.toll)}gp on ${xB.st} st`) && qB.quote.includes(`Tariff (RR 372): ${gp(xB.tariff)}gp`) && !qB.quote.includes("Ruler's Privilege") && !!goodRow(qB, "4 st", WB) && !goodRow(qB, "4 st", WB).hidden && (qB.members ?? []).find((m) => m.holder === A.uuid)?.hidden, { quote: qB.quote });
    const aB = dB.action;
    check("S3b: B's entry is B's own, one of three, with B's wagon, no privilege, and B paid exactly its toll and tariff", aB && aB.entrantUuid === B.uuid && aB.entrants === 3 && aB.vehicleUuids.join() === WB.uuid && aB.privilegeUuid === "" && aB.tollCp === xB.toll && aB.tariffCp === xB.tariff && near(coinB0 - coinB1, gp(xB.toll + xB.tariff)), { action: aB, paid: coinB0 - coinB1 });
    const res3 = trackChat(gm, await run(gm, P.partiesResolve, { locationId: M.id, actionIds: [aA?.id, aB?.id] }));
    const cards3 = await run(gm, P.cards, { ids: res3.chat ?? [] });
    const s3 = await state();
    const vA = rowOf(s3, A), vB = rowOf(s3, B);
    note("the two entries resolved", { res: { found: res3.found, done: res3.done }, rows: [vA, vB], cards: cards3.map((c) => c.text), cap, share });
    check("S3c: two venture rows stand, A's and B's, each one of three with the divided maximum impact and an impact of its own cargo, B's held to the share at M's own class, and no party row", res3.done && vA?.entered && vB?.entered && vA.entrants === 3 && vB.entrants === 3 && vA.impactCap === share && vB.impactCap === share && vA.impact >= 1 && (share >= 1 ? vB.impact === share && vB.effectiveClass === 3 : vB.impact === 1 && vB.effectiveClass === 6) && vB.cargoSt === xB.st && vA.vehicleUuids.join() === WA.uuid && vB.vehicleUuids.join() === WB.uuid && !rowOf(s3, null), { vA, vB, share });
    check("S3d: each entered card says its character entered separately, one of three", [A, B].every((a) => cards3.some((c) => c.text.includes(`${a.name} entered the market at ${M.name} separately, one of 3`))), cards3.map((c) => c.text));
    const tabGm = await run(gm, P.tradeTab, { locationId: M.id });
    const tabA3 = await run(player, P.tradeTab, { locationId: M.id, traderId: A.id });
    note("the Judge's party block and A's status line", { partyBlock: tabGm.partyBlock, status: tabA3.ventureStatus });
    check("S3e: the Judge's party block has a line for each, naming the character; A's Trade tab says A is in separately, one of three", [A, B].every((a) => tabGm.partyBlock.includes(`${a.name}, separately, one of 3`)) && tabA3.ventureStatus.includes("separately, one of 3"), { partyBlock: tabGm.partyBlock, status: tabA3.ventureStatus });
    note("closed (player)", await run(player, P.closeAll));
    note("closed (gm)", await run(gm, P.closeAll));

    // S4: both solicit the same merchandise, each in a venture of their own.
    const solA = await run(player, P.partiesApi, { locationId: M.id, kind: "solicit", actorId: A.id, category: KEY.c });
    const solB = await run(player, P.partiesApi, { locationId: M.id, kind: "solicit", actorId: B.id, category: KEY.c });
    const solA2 = await run(player, P.partiesApi, { locationId: M.id, kind: "solicit", actorId: A.id, category: KEY.c });
    note("A, B, then A again solicit the common goods", { solA, solB, solA2 });
    check("S4a: A and B each post a solicitation of the same merchandise, each in their own venture, and A's second is refused while the first waits (duplicatePending)", solA.ok && solA.action?.entrantUuid === A.uuid && solB.ok && solB.action?.entrantUuid === B.uuid && solA2.error === "duplicatePending" && !solA2.action, { solA, solB, solA2 });
    const res4 = trackChat(gm, await run(gm, P.partiesResolve, { locationId: M.id, actionIds: [solA.action?.id, solB.action?.id] }));
    const s4 = await state();
    const pA = poolOf(s4, A), pB = poolOf(s4, B);
    const expectStones = (v) => DAILY[v.effectiveClass - 1] * v.impact;
    note("the pools", { pA, pB, expect: { A: expectStones(vA), B: expectStones(vB) } });
    check("S4b: each has a pool of its own, at its own venture's class and impact, and none is the party's", res4.done && pA?.stones === expectStones(vA) && pB?.stones === expectStones(vB) && !poolOf(s4, null), { pA, pB });

    // S5: each trades from their own pool, into their own vehicles.
    const tA = await run(player, P.partiesTradeRows, { locationId: M.id, actorId: A.id });
    const tB = await run(player, P.partiesTradeRows, { locationId: M.id, actorId: B.id });
    const into = await run(player, P.partiesTrade, { locationId: M.id, actorId: B.id, category: KEY.c, stones: 1, direction: "buy", holdUuid: WA.uuid });
    const own5 = trackChat(player, await run(player, P.partiesTrade, { locationId: M.id, actorId: B.id, category: KEY.c, stones: 1, direction: "buy", holdUuid: WB.uuid }));
    const s5 = await state();
    note("the trade dialogs, B buying into A's wagon, then into B's own", { tA, tB, into, own5, pools: { A: poolOf(s5, A), B: poolOf(s5, B) } });
    check("S5a: A's trade dialog offers A's pool alone with A's packs and wagon; B's offers B's", tA.entrantUuid === A.uuid && tA.rows.length === 1 && tA.rows[0].stones === pA?.stones && tA.holds.join() === [A.uuid, WA.uuid].join() && tB.entrantUuid === B.uuid && tB.rows.length === 1 && tB.rows[0].stones === pB?.stones && tB.holds.join() === [B.uuid, WB.uuid].join(), { tA, tB });
    check("S5b: B buying into A's wagon is refused (notInVenture); into B's own it lands, from B's pool, and A's pool is untouched", into.error === "notInVenture" && own5.ok && poolOf(s5, B)?.stones === pB.stones - 1 && poolOf(s5, A)?.stones === pA.stones, { into, own5 });

    // S6: C, entered in no venture, then entering; then a character joining mid-month counts nothing new.
    const cSol = await run(gm, P.partiesApi, { locationId: M.id, kind: "solicit", actorId: C.id, category: KEY.c });
    const cOne = await run(gm, P.partiesApi, { locationId: M.id, kind: "enter", actorId: C.id, mode: "party" });
    const cApart = trackChat(gm, await run(gm, P.partiesApi, { locationId: M.id, kind: "enter", actorId: C.id, mode: "separately" }));
    note("C soliciting, entering as the party, then separately (gm)", { cSol, cOne, cApart });
    check("S6a: C, not entered beside them, cannot solicit (notEntered), nor enter as the party (enteredSeparately), and enters separately as one of three", cSol.error === "notEntered" && cOne.error === "enteredSeparately" && cApart.ok && cApart.action?.entrantUuid === C.uuid && cApart.action.entrants === 3, { cSol, cOne, cApart });
    trackChat(gm, await run(gm, P.partiesResolve, { locationId: M.id, actionIds: [cApart.action?.id] }));
    note("the roster grows: A, B, C and E", await roster([A, B, C, E]));
    await sleep(500);
    await run(player, P.tradeTab, { locationId: M.id, traderId: E.id });
    const rE = await run(player, P.partiesDialog, { locationId: M.id, submit: false });
    note("dialog closed", await run(player, P.closeDialog));
    const eApart = await run(player, P.partiesApi, { locationId: M.id, kind: "enter", actorId: E.id, mode: "separately" });
    note("E's dialog and entry (player)", { mode: rE.opening?.mode, eApart });
    check("S6b: the count stays the month's first: E's dialog says three, and E entering separately with three in is refused (separateFull)", (rE.opening?.mode?.hints ?? []).includes(shareLine(3)) && eApart.error === "separateFull" && !eApart.action, { mode: rE.opening?.mode, eApart });
    note("the roster back to A, B and C", await roster([A, B, C]));
    note("closed (player)", await run(player, P.closeAll));

    // S7: B's visit is B's own, and the market is new to B.
    const kB = await run(player, P.knownRead, { locationId: M.id, actorId: B.id });
    note("is M known to B", kB);
    check("S7: M, first entered this visit, is not a known market for B", kB.known === false, kB);

    // S8: leaving is each one's own; once all have left, the party may enter as one, at the full maximum.
    const leftA = await run(player, P.partiesLeave, { locationId: M.id, actorId: A.id });
    const s8 = await state();
    const aOneEarly = await run(player, P.partiesApi, { locationId: M.id, kind: "enter", actorId: A.id, mode: "party" });
    note("A leaves; A entering as the party while B and C stand", { leftA, rows: { A: rowOf(s8, A), B: rowOf(s8, B) }, pools: { A: poolOf(s8, A), B: poolOf(s8, B) }, aOneEarly });
    check("S8a: A leaving ends A's venture and A's pool, and leaves B's standing with its pool; A cannot yet enter as the party (enteredSeparately)", leftA.ok && rowOf(s8, A)?.entered === false && !poolOf(s8, A) && rowOf(s8, B)?.entered && poolOf(s8, B)?.stones === pB.stones - 1 && aOneEarly.error === "enteredSeparately", { leftA, aOneEarly });
    const leftB = await run(player, P.partiesLeave, { locationId: M.id, actorId: B.id });
    const leftC = await run(gm, P.partiesLeave, { locationId: M.id, actorId: C.id });
    const aOne = trackChat(player, await run(player, P.partiesApi, { locationId: M.id, kind: "enter", actorId: A.id, mode: "party" }));
    const res8 = trackChat(gm, await run(gm, P.partiesResolve, { locationId: M.id, actionIds: [aOne.action?.id] }));
    const s8b = await state();
    const vP = rowOf(s8b, null);
    const tabB8 = await run(player, P.tradeTab, { locationId: M.id, traderId: B.id });
    note("B and C leave; A enters as the party", { leftB, leftC, aOne, row: vP, status: tabB8.ventureStatus });
    check("S8b: with every entrant gone, A enters as the party: the entry is no one's own, A's privilege covers the party, and its row has the full maximum impact; B's Trade tab now reads the party's venture", leftB.ok && leftC.ok && aOne.ok && aOne.action?.entrantUuid === "" && aOne.action.entrants === 0 && aOne.action.privilegeUuid === D.uuid && res8.done && vP?.entered && vP.entrants === 0 && vP.impactCap === cap && tabB8.ventureStatus.startsWith("This month: In the market") && !tabB8.ventureStatus.includes("separately"), { aOne: aOne.action, row: vP, status: tabB8.ventureStatus });

    // S9: a row written before entering separately existed reads as the party's.
    const pre = await run(gm, P.partiesPreUpgrade, { locationId: M.id, partyId: partiesRoster });
    const tB9 = await run(player, P.partiesTradeRows, { locationId: M.id, actorId: B.id });
    note("the party's row without the new keys", { pre, tradeVenture: tB9.entrantUuid });
    check("S9: a venture row written without the keys reads back as the party's, and B trades in it", pre.found && pre.wrote.length === 0 && pre.back?.entrantUuid === "" && pre.back.entrants === 0 && tB9.entrantUuid === "", { pre, tB9 });

    note("randomized tariff restored", await run(gm, P.settingSet, { key: "marketsRandomTariff", value: randomBefore }));
    note("the walk's party roster removed", await run(gm, P.roster, { off: partiesRoster }));
    partiesRoster = null;
    note("closed (player)", await run(player, P.closeAll));
    note("closed (gm)", await run(gm, P.closeAll));
  }
  if (STAGE === "parties") throw new StageDone("parties");

  section("the moorage walk: the stay's daily fee, charged on leaving and at the month's end (RR ch. 8, Engaging in Mercantile Ventures)");
  {
    const rates = await run(gm, P.stayRates);
    note("the moorage rates the gate reads", rates);
    check("M0: the table gives every row a rate within the market and outside it", !!rates && STAY_KINDS.every((k) => rates[k]?.berth?.cp > 0 && rates[k]?.anchor?.cp > 0), { rows: rates ? Object.keys(rates) : null });
    if (!stayWhole(rates)) throw new Error("the Moorage and Stabling table is not imported whole: re-import the Mercantile rules before walking the stay");
    const own = { default: 0, [pc.userId]: 3 };
    // Every size, capacity, count and daily figure typed here is invented; the rates are the import's.
    const SHP = 60;
    const HOOK_CP = 777;
    const ROLL_CP = { paid: 37, away: 41, short: 43 };
    const shipCp = (at, shp) => { const r = rates.ship[at]; return Math.ceil(r.perShp ? (r.cp * shp) / r.perShp : r.cp); };
    const flat = (kind, at, n = 1) => Math.ceil(rates[kind][at].cp * n);
    const gp = (cp) => Math.round(cp) / 100;
    const near = (a, b) => Math.abs(a - b) < 0.005;
    const trackChat = (api, r) => { for (const id of r?.chat ?? []) api.track(id, "ChatMessage"); return r; };
    const coinOf = async (who) => (await run(gm, P.coin, { actorId: who.id })).gp;
    const M = await gm.create("Actor", { name: `QA Moorage Town ${NONCE}`, type: "acks-extras.location" });
    note("market M", await run(gm, P.addMarket, { locationId: M.id, classOverride: 3 }));
    note("M owned by the player", await run(gm, P.ownershipSet, { actorId: M.id, ownership: own }));
    const vehicle = (name, system) => gm.create("Actor", { name: `QA Moorage ${name} ${NONCE}`, type: "acks-extras.vehicle", ownership: own, system });
    const W = await vehicle("Wain", { kind: "land", cargo: { capacityStone: 5 } });
    const HC = await vehicle("Litter", { kind: "land", carriage: "handCarried", cargo: { capacityStone: 2 } });
    const S = await vehicle("Cog", { kind: "sea", shp: { value: 40, max: SHP }, cargo: { capacityStone: 10 } });
    const S0 = await vehicle("Hulk", { kind: "sea", shp: { value: 0, max: 0 }, cargo: { capacityStone: 1 } });
    // T drives the wain, so it starts ticked; R is at the market without coin; Z has coin and stands nowhere near it.
    const T = await gm.create("Actor", { name: `QA Moorage Tam ${NONCE}`, type: "character", ownership: own, flags: { "acks-extras": { attachedTo: { uuid: W.uuid, role: "crew", station: "driver" }, markets: { trader: true } } } });
    const R = await gm.create("Actor", { name: `QA Moorage Rae ${NONCE}`, type: "character", ownership: own });
    const Z = await gm.create("Actor", { name: `QA Moorage Zed ${NONCE}`, type: "character" });
    note("Z owned by the Judge alone", await run(gm, P.ownershipSet, { actorId: Z.id, ownership: { default: 0 } }));
    moorageRoster = `qa-moorage-${NONCE}`;
    note("the walk's party roster: T alone", await run(gm, P.roster, { add: { id: moorageRoster, name: `QA Moorage Party ${NONCE}`, memberUuids: [T.uuid] } }));
    note("coin", { T: await run(gm, P.coin, { actorId: T.id, mint: 1000 }), Z: await run(gm, P.coin, { actorId: Z.id, mint: 100 }), R: await run(gm, P.drain, { actorId: R.id }) });
    await sleep(500);
    const row = () => run(gm, P.moorageRow, { locationId: M.id, partyId: moorageRoster });
    // A resolve is the GM's write; the player's seat leaves next, so it waits to read the entry done.
    const resolve = async (locationId, posted) => {
      const actionIds = posted?.action?.id ? [posted.action.id] : [];
      const r = trackChat(gm, await run(gm, P.partiesResolve, { locationId, actionIds }));
      return { ...r, seen: (await run(player, P.seesDone, { locationId, actionIds })).done };
    };
    const leave = async (locationId) => trackChat(player, await run(player, P.moorageLeave, { locationId, actorId: T.id }));
    const stabledOf = (read, v) => read?.stabled?.find((s) => s.vehicle === v.uuid) ?? null;

    // M1: the dialog's block as it opens, then a declaration through it.
    const tab = await run(player, P.tradeTab, { locationId: M.id, traderId: T.id });
    if (tab.acting !== T.id) throw new Error("the player's Trade tab does not act as T: the moorage walk would drive another character");
    const d1 = trackChat(player, await run(player, P.moorageDialog, { locationId: M.id, vehicleUuids: [W.uuid, HC.uuid, S.uuid], stabled: { [W.uuid]: "cart" }, animals: { horse: 2, camelDonkeyOx: 1 } }));
    note("M1 dialog", { opening: d1.opening, chosen: d1.chosen, action: d1.action, notes: d1.notes });
    const o1 = d1.opening;
    check("M1: the Enter dialog's moorage block asks where the party waits, within or outside; how each land vehicle is stabled — the driven wain as a wagon, the litter hidden and not stabled, no row for a ship — and counts three kinds of animal at none, each captioned; the quote charges the wain its day", o1?.at?.value === "berth" && o1.at.options.join() === "berth,anchor" && o1.at.captioned && stabledOf(o1, W)?.value === "wagon" && !stabledOf(o1, W).hidden && stabledOf(o1, HC)?.value === "none" && stabledOf(o1, HC).hidden && !stabledOf(o1, S) && !stabledOf(o1, S0) && o1.animals.map((a) => a.unit).join() === "elephant,horse,camelDonkeyOx" && o1.animals.every((a) => a.value === 0 && a.label) && o1.quote.includes(`Moorage and stabling (RR 372): ${gp(flat("wagon", "berth"))}gp a day, berthed and stabled in the market`), { at: o1?.at, stabled: o1?.stabled, animals: o1?.animals, quote: o1?.quote });
    const exp1 = shipCp("berth", SHP) + flat("cartElephant", "berth") + flat("horse", "berth", 2) + flat("camelDonkeyOx", "berth", 1);
    const c1 = d1.chosen;
    check("M1: declared — the wain stabled as a cart, the litter not stabled, the cog, two horses and a camel — the quote charges the ship pro rata on its size and each kind per head, line by line, and the entry records that day's fee within", !!c1?.quote.includes(`Moorage and stabling (RR 372): ${gp(exp1)}gp a day, berthed and stabled in the market`) && c1.lines.includes(`${S.name}: ${gp(shipCp("berth", SHP))}gp`) && c1.lines.includes(`${W.name}: ${gp(flat("cartElephant", "berth"))}gp`) && c1.lines.includes(`Horses ×2: ${gp(flat("horse", "berth", 2))}gp`) && c1.lines.includes(`Camels, donkeys and oxen ×1: ${gp(flat("camelDonkeyOx", "berth"))}gp`) && !c1.lines.some((l) => l.startsWith(`${HC.name}:`)) && d1.action?.stayCpPerDay === exp1 && d1.action.stayAt === "berth" && d1.action.detail.includes(`stay ${gp(exp1)}gp a day`), { lines: c1?.lines, action: d1.action, expect: exp1 });
    const flags1 = { W: await run(gm, P.moorageFlag, { actorId: W.id }), HC: await run(gm, P.moorageFlag, { actorId: HC.id }), S: await run(gm, P.moorageFlag, { actorId: S.id }) };
    check("M1: the wain remembers it was stabled as a cart; the litter, left as it read, and the ship remember nothing", flags1.W === "cart" && flags1.HC === null && flags1.S === null, flags1);

    // M2: the entry resolves.
    const r2 = await resolve(M.id, d1);
    const row2 = await row();
    const cards2 = await run(gm, P.cards, { ids: r2.chat ?? [] });
    const tab2 = await run(player, P.tradeTab, { locationId: M.id, traderId: T.id });
    note("M2", { row2, cards: cards2.map((c) => c.text), status: tab2.ventureStatus });
    check("M2: the entry resolves with the day's fee on the venture, the trader its payer, unsettled; the entered card and the status line give the fee", r2.done && row2?.entered && row2.stayCpPerDay === exp1 && row2.stayAt === "berth" && row2.payerUuid === T.uuid && !row2.staySettled && cards2.some((c) => c.text.includes(`Moorage and stabling, berthed and stabled in the market: ${gp(exp1)}gp a day`)) && tab2.ventureStatus.includes(`stay ${gp(exp1)}gp a day, berthed and stabled in the market`), { row2, status: tab2.ventureStatus });

    // M3: leaving on the day of arrival, through the button.
    const coin3a = await coinOf(T);
    const l3 = trackChat(player, await run(player, P.moorageLeaveUI, { locationId: M.id }));
    // The player's seat paid; the GM's read waits for that write to arrive.
    const coin3b = (await run(gm, P.coinMoved, { actorId: T.id, from: coin3a })).gp;
    const row3 = await row();
    const tail3 = await run(gm, P.ledgerTail, { locationId: M.id, actorId: T.id, n: 1 });
    note("M3", { l3, coin: [coin3a, coin3b], row3, tail3 });
    check("M3: leaving the day it arrived, the confirmation names the stay and its payer, one day is charged, the purse pays it, the venture records it settled, and the ledger and the notice say so", !!l3.confirm && l3.text.includes(`The stay is paid now by ${T.name}: ${gp(exp1)}gp so far (days charged: 1).`) && near(coin3a - coin3b, gp(exp1)) && !!row3 && !row3.entered && row3.stayDays === 1 && row3.stayPaidCp === exp1 && row3.staySettled && tail3[0]?.type === "ventureLeft" && tail3[0].note.includes(`stay of 1 day ${gp(exp1)}gp paid`) && near(tail3[0].gp, -gp(exp1)) && (l3.notes ?? []).some((n) => n.text.includes(`paying ${gp(exp1)}gp for the stay (days charged: 1)`)), { text: l3.text, notes: l3.notes, row3, tail3 });

    // M4: the dialog remembers the wain's stabling.
    await run(player, P.tradeTab, { locationId: M.id, traderId: T.id });
    const d4 = await run(player, P.moorageDialog, { locationId: M.id, submit: false });
    check("M4: the Enter dialog opens again with the wain stabled as a cart", stabledOf(d4.opening, W)?.value === "cart", { stabled: d4.opening?.stabled });

    // M5: anchored outside, arriving two days before leaving.
    const exp5 = shipCp("anchor", SHP) + flat("cartElephant", "anchor") + flat("horse", "anchor", 1);
    const e5 = trackChat(player, await run(player, P.moorageApi, { locationId: M.id, actorId: T.id, vehicleUuids: [W.uuid, S.uuid], stayAt: "anchor", animals: { horse: 1 } }));
    const r5 = await resolve(M.id, e5);
    const back5 = await run(gm, P.moorageBackdate, { locationId: M.id, partyId: moorageRoster, days: 2 });
    const coin5a = await coinOf(T);
    const l5 = await leave(M.id);
    const coin5b = await coinOf(T);
    const row5 = await row();
    note("M5", { e5: e5.action, error: e5.error, back5, l5, coin: [coin5a, coin5b], row5, expect: exp5 });
    check("M5: anchored outside, every line takes the outside column and the wain is stabled as it remembers; with the arrival two days back, three days are charged at that fee", e5.ok && e5.action?.stayAt === "anchor" && e5.action.stayCpPerDay === exp5 && r5.done && back5.found && back5.today - back5.arrivalDay === 2 && l5.ok && l5.stay?.days === 3 && near(l5.stay.gp, gp(exp5 * 3)) && near(coin5a - coin5b, gp(exp5 * 3)) && row5?.stayDays === 3 && row5.stayPaidCp === exp5 * 3, { e5: e5.action, back5, l5, row5 });

    // M6: a purse that cannot pay the stay.
    const exp6 = flat("cartElephant", "berth");
    const e6 = trackChat(player, await run(player, P.moorageApi, { locationId: M.id, actorId: T.id, vehicleUuids: [W.uuid] }));
    const r6 = await resolve(M.id, e6);
    const drained = await run(gm, P.drain, { actorId: T.id });
    const l6a = await leave(M.id);
    const row6a = await row();
    note("T's coin again", await run(gm, P.coin, { actorId: T.id, mint: 1000 }));
    const l6b = await leave(M.id);
    const row6b = await row();
    note("M6", { e6: e6.action, drained, l6a, row6a, l6b, row6b });
    check("M6: with an empty purse the leave is refused with the stay's sum and days, and the party stays in the market, unsettled; with coin again it leaves and pays", e6.action?.stayCpPerDay === exp6 && r6.done && drained.gp === 0 && l6a.error === "stayShort" && near(l6a.gp, gp(exp6)) && l6a.days === 1 && !!row6a?.entered && !row6a.staySettled && l6b.ok && near(l6b.stay?.gp, gp(exp6)) && !!row6b?.staySettled && !row6b.entered, { l6a, row6a, l6b, row6b });

    // M7: a ship with no size.
    await run(player, P.tradeTab, { locationId: M.id, traderId: T.id });
    const d7b = await run(player, P.moorageDialog, { locationId: M.id, vehicleUuids: [S0.uuid], submit: false });
    const d7a = await run(player, P.moorageDialog, { locationId: M.id, vehicleUuids: [S0.uuid], stayAt: "anchor", submit: false });
    const bySize = (at) => !!rates.ship[at].perShp;
    const sized = (read, at) => (bySize(at) ? read?.chosen?.quote.includes(`${S0.name} has no structural hit points`) : read?.chosen?.quote.includes(`Moorage and stabling (RR 372): ${gp(flat("ship", at))}gp a day`));
    check("M7: a ship with no structural hit points cannot be figured where its rate is by size, and is where the rate is flat", !!sized(d7b, "berth") && !!sized(d7a, "anchor"), { berth: d7b.chosen?.quote, anchor: d7a.chosen?.quote, bySize: { berth: bySize("berth"), anchor: bySize("anchor") } });

    // M8: sneaking in.
    const d8 = await run(player, P.moorageDialog, { locationId: M.id, vehicleUuids: [W.uuid], sneak: true, submit: false });
    const e8 = trackChat(player, await run(player, P.moorageApi, { locationId: M.id, actorId: T.id, vehicleUuids: [W.uuid], sneak: true }));
    const r8 = await resolve(M.id, e8);
    const l8 = await leave(M.id);
    note("M8", { quote: d8.chosen?.quote, e8: e8.action, l8 });
    check("M8: a party sneaking in pays no toll or tariff and still has its stay figured, recorded and charged", !!d8.chosen?.quote.includes("No toll or tariff: the party sneaks in") && d8.chosen.quote.includes(`Moorage and stabling (RR 372): ${gp(exp6)}gp a day`) && !!e8.action?.sneaked && e8.action.tollCp === 0 && e8.action.stayCpPerDay === exp6 && r8.done && l8.ok && near(l8.stay?.gp, gp(exp6)) && l8.stay.days === 1, { quote: d8.chosen?.quote, e8: e8.action, l8 });

    // M9: a Judge's hook sets the day's fee.
    note("stay hook on (player)", await run(player, P.stayHook, { on: true, locationId: M.id, cpPerDay: HOOK_CP }));
    const d9 = await run(player, P.moorageDialog, { locationId: M.id, vehicleUuids: [W.uuid], submit: false });
    const e9 = trackChat(player, await run(player, P.moorageApi, { locationId: M.id, actorId: T.id, vehicleUuids: [W.uuid] }));
    note("stay hook off (player)", await run(player, P.stayHook, { on: false }));
    const r9 = await resolve(M.id, e9);
    const l9 = await leave(M.id);
    note("M9", { quote: d9.chosen?.quote, lines: d9.chosen?.lines, e9: e9.action, error: e9.error, r9, l9, row9: await row() });
    check("M9: a Judge's hook that sets the day's fee is what the quote charges and the entry records, over the gate's own lines, and leaving charges it", !!d9.chosen?.quote.includes(`Moorage and stabling (RR 372): ${gp(HOOK_CP)}gp a day`) && d9.chosen.lines.includes(`${W.name}: ${gp(exp6)}gp`) && e9.action?.stayCpPerDay === HOOK_CP && r9.done && near(l9.stay?.gp, gp(HOOK_CP)), { quote: d9.chosen?.quote, e9: e9.action, l9 });

    // M10: the Ruler's Privilege.
    const Mp = await gm.create("Actor", { name: `QA Moorage Haven ${NONCE}`, type: "acks-extras.location" });
    note("market Mp", await run(gm, P.addMarket, { locationId: Mp.id, classOverride: 3 }));
    note("Mp owned by the player", await run(gm, P.ownershipSet, { actorId: Mp.id, ownership: own }));
    const D = await gm.create("Actor", { name: `QA Moorage Barony ${NONCE}`, type: "acks-extras.domain" });
    note("the barony holds Mp under T", await run(gm, P.gateDomain, { domainId: D.id, locationId: Mp.id, traderId: T.id, rulerId: T.id }));
    await run(player, P.tradeTab, { locationId: Mp.id, traderId: T.id });
    const d10 = await run(player, P.moorageDialog, { locationId: Mp.id, vehicleUuids: [W.uuid], animals: { horse: 2 }, submit: false });
    const coin10a = await coinOf(T);
    const e10 = trackChat(player, await run(player, P.moorageApi, { locationId: Mp.id, actorId: T.id, vehicleUuids: [W.uuid], animals: { horse: 2 } }));
    const r10 = await resolve(Mp.id, e10);
    const l10 = await leave(Mp.id);
    const coin10b = await coinOf(T);
    const tail10 = await run(gm, P.ledgerTail, { locationId: Mp.id, actorId: T.id, n: 1 });
    note("M10", { quote: d10.chosen?.quote, e10: e10.action, l10, coin: [coin10a, coin10b], tail10 });
    check("M10: where the trader rules the market's domain the quote waives the stay with the toll, the entry records no fee, and leaving takes nothing", !!d10.chosen?.quote.includes(`No moorage or stabling: Ruler's Privilege in ${D.name}`) && !d10.chosen.quote.includes("gp a day") && e10.action?.stayCpPerDay === 0 && !!e10.action.privilegeUuid && r10.done && l10.ok && l10.stay === null && near(coin10a, coin10b) && tail10[0]?.type === "ventureLeft" && !tail10[0].note.includes("stay of"), { quote: d10.chosen?.quote, e10: e10.action, l10, tail10 });

    // M11: the month's end, written into the previous month on M without moving the clock.
    const ROLL = {
      paid: { partyId: `qa-moor-${NONCE}-paid`, payerId: T.id, cpPerDay: ROLL_CP.paid, arrivalOffset: 3 },
      away: { partyId: `qa-moor-${NONCE}-away`, payerId: Z.id, cpPerDay: ROLL_CP.away, arrivalOffset: 5 },
      short: { partyId: `qa-moor-${NONCE}-short`, payerId: R.id, cpPerDay: ROLL_CP.short, arrivalOffset: 7 },
      legacy: { partyId: `qa-moor-${NONCE}-legacy`, legacy: true, arrivalOffset: 2 },
    };
    const partyIds = Object.values(ROLL).map((r) => r.partyId);
    const pres = await run(gm, P.presence, { locationId: M.id, actorIds: [T.id, Z.id, R.id] });
    const coinR = await coinOf(R);
    const made = await run(gm, P.rollRows, { locationId: M.id, rows: Object.values(ROLL) });
    note("M11 rows written", { made, pres, coinR });
    if (made.skip) note("M11", "not walked: the clock is in its first market month, so no earlier month exists");
    else {
      const daysOf = (k) => made.lastDay - made.made.find((m) => m.partyId === ROLL[k].partyId).arrivalDay + 1;
      const coinT0 = await coinOf(T);
      const coinZ0 = await coinOf(Z);
      const s1 = trackChat(gm, await run(gm, P.rollSettle, { locationId: M.id, partyIds }));
      const coinT1 = await coinOf(T);
      const coinZ1 = await coinOf(Z);
      const cards11 = await run(gm, P.cards, { ids: s1.chat ?? [] });
      const rr = (k) => s1.rows[ROLL[k].partyId];
      const owed = (k) => ROLL_CP[k] * daysOf(k);
      note("M11 settle", { rows: s1.rows, log: s1.log, cards: cards11.map((c) => c.text), coin: { T: [coinT0, coinT1], Z: [coinZ0, coinZ1] }, days: { paid: daysOf("paid"), away: daysOf("away"), short: daysOf("short") } });
      check("M11: the sweep runs on the primary GM's seat, with T and R at the market, Z away from it, and R without coin", made.primary && pres[T.id]?.present && pres[R.id]?.present && !pres[Z.id]?.present && coinR === 0, { primary: made.primary, pres, coinR });
      check("M11: a visit still standing at the month's end is charged from its arrival through the month's last day; the payer at the market pays it, one away and one short are not charged and are told what is owed, every row is settled once, and a row written without the stay's keys reads a fee of none and is left alone", !!rr("paid")?.staySettled && rr("paid").stayDays === daysOf("paid") && rr("paid").stayPaidCp === owed("paid") && near(coinT0 - coinT1, gp(owed("paid"))) && !!rr("away")?.staySettled && rr("away").stayPaidCp === 0 && rr("away").stayDays === daysOf("away") && near(coinZ0, coinZ1) && !!rr("short")?.staySettled && rr("short").stayPaidCp === 0 && rr("legacy")?.stayCpPerDay === 0 && !rr("legacy").staySettled && s1.log.length === 3 && cards11.some((c) => c.text.includes(`${T.name}'s stay at ${M.name} ended with the month: ${gp(owed("paid"))}gp paid (days charged: ${daysOf("paid")})`)) && cards11.some((c) => c.text.includes(`${gp(owed("away"))}gp owed (days charged: ${daysOf("away")})`) && c.text.includes(`${Z.name} is away from the market`)) && cards11.some((c) => c.text.includes(`${gp(owed("short"))}gp owed`) && c.text.includes(`${R.name}'s coin falls short`)), { rows: s1.rows, log: s1.log.length, cards: cards11.map((c) => c.text) });
      const s2 = trackChat(gm, await run(gm, P.rollSettle, { locationId: M.id, partyIds }));
      const coinT2 = await coinOf(T);
      check("M11: a second sweep settles nothing again", s2.log.length === 3 && near(coinT1, coinT2) && !(s2.chat ?? []).length, { log: s2.log.length, chat: s2.chat });
    }
    note("the moorage walk's party roster removed", await run(gm, P.roster, { off: moorageRoster }));
    moorageRoster = null;
    note("closed (player)", await run(player, P.closeAll));
    note("closed (gm)", await run(gm, P.closeAll));
  }
  if (STAGE === "moorage") throw new StageDone("moorage");

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
  note("trade tab at M5 as V", { classLine: n1.classLine, picker: n1.picker, enterButton: n1.enterButton });
  check("N0: before entry the player's toolbar offers Enter and no merchandise picker", n1.enterButton && !n1.picker.present, { picker: n1.picker, enterButton: n1.enterButton });
  const ne1 = await run(player, P.ventureEnterUI, { locationId: M5.id, other: ch3.baseline });
  note("enter M5 (step 1)", { networkText: ne1.networkText, modes: ne1.modes, action: ne1.action, notes: ne1.notes });
  const na1 = await advance(M5.id, ne1.action?.id);
  const n1e = await run(player, P.tradeTab, { locationId: M5.id, traderId: V.id });
  check("N0: once entered the player's merchandise picker is captioned and lists the goods", n1e.picker.present && n1e.picker.captioned && !n1e.enterButton && n1e.categories.includes(keys.X) && n1e.categories.includes(keys.Y), { picker: n1e.picker, enterButton: n1e.enterButton });
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
  if (err instanceof StageDone) note("stage", `stopped after the ${err.message} walk`);
  else {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm && randomBefore !== null) note("randomized tariff setting", await run(gm, P.settingSet, { key: "marketsRandomTariff", value: randomBefore })); } catch (err) { console.error("randomTariff:", err?.message ?? err); }
  try { if (gm && gateRoster) note("the gate walk's party roster removed", await run(gm, P.roster, { off: gateRoster })); } catch (err) { console.error("roster:", err?.message ?? err); }
  try { if (gm && partiesRoster) note("the parties walk's party roster removed", await run(gm, P.roster, { off: partiesRoster })); } catch (err) { console.error("roster:", err?.message ?? err); }
  try { if (gm && moorageRoster) note("the moorage walk's party roster removed", await run(gm, P.roster, { off: moorageRoster })); } catch (err) { console.error("roster:", err?.message ?? err); }
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
