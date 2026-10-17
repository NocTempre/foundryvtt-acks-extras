/**
 * Live walk, domains: docs/domains/TESTING.md, steps 1–12.
 * Machine values arrive through ./_env.mjs. Every figure typed into a fixture
 * is invented and every name is a neutral label, so the log holds nothing a
 * book printed.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - each seat's own client state: the patched notification methods and the
 *     console recorder, and the GM seat's `fontScale` client setting (read
 *     first, put back);
 *   - the world setting `pruneEmptyLocations`, read first and put back. The
 *     prune deletes every empty place in the WORLD, so step 8 runs it only
 *     when every empty place the world holds is one this run made, and is
 *     reported not run otherwise.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "d" + Math.random().toString(36).slice(2, 8);
const MOD = "acks-extras";
const DOMAIN = "acks-extras.domain";
const LOCATION = "acks-extras.location";
const FACTION = "acks-extras.faction";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ */
/*  The record, and what it sums to by hand                             */
/* ------------------------------------------------------------------ */

/** Domain 1's record: every list populated, every figure invented, the tithe left unset. */
const RECORD = {
  title: "Title 1",
  rulerName: "NPC 3",
  classification: "borderlands",
  alignment: "",
  territory: [
    { label: "Tract 1", hexLabels: ["0101", "0102", "0103"], families: 120, landValue: 5, improvement: 1, revealed: true },
    { label: "Tract 2", count: 4, families: 200, landValue: 3, improvement: 0, revealed: false },
  ],
  holdings: [{ name: "Town 1", role: "settlement", families: 50, marketClass: 5, investmentGp: 1000 }],
  structures: [
    { name: "Structure 1", count: 1, ac: 6, unitCapacity: 30, shp: 100, costGp: 30000 },
    { name: "Structure 2", count: 4, costGp: 8000 },
  ],
  revenue: {
    land: { peasantPer: 7 },
    service: { peasantPer: 3, urbanPer: 3 },
    tax: { peasantGp: 641, urbanGp: 101 },
    trade: { urbanGp: 53 },
  },
  expenses: {
    garrison: { peasantPer: 1.5, urbanPer: 1.5 },
    liturgy: { peasantGp: 161, urbanGp: 26 },
    upkeep: { peasantGp: 31 },
  },
  vassalRows: [{ name: "Domain 3", rulerName: "NPC 4", families: { peasant: 90, urban: 0 }, tributeGp: 70, extraTaxGp: 10, domainHexes: { count: 2, classes: ["outlands"] } }],
  morale: { current: 1, base: 0 },
  favors: [{ label: "Favor 1" }],
  duties: [{ label: "Duty 1" }],
  notes: "<p>Notes 1</p>",
  gmNotes: "<p>Judge only 1</p>",
};

/*
 * By hand. Peasant families 120 + 200 = 320; urban 50 (the unplaced town);
 * hexes 3 labels + 4 counted = 7; stronghold 30000 + 8000 = 38000.
 * Revenue: land 7 × 320 = 2240; service 3 × 320 + 3 × 50 = 1110; tax 641 + 101
 * = 742; trade 53 — 4145 — and tribute in 70 + 10 = 80: 4225.
 * Expenses: garrison 1.5 × 320 + 1.5 × 50 = 555; liturgy 161 + 26 = 187;
 * upkeep 31; tithe unset — 773. No liege, so nothing owed. Income 3452.
 * With the tithe at 17: expenses 790, income 3435, and nothing unset.
 */
const BY_HAND = { peasant: 320, urban: 50, hexes: 7, stronghold: 38000, revenue: 4225, expenses: 773, income: 3452 };
const TITHE = 17;
const BY_HAND_FULL = { revenue: 4225, expenses: 790, income: 3435 };

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  census: async ({ mod, type }) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    domainType: game.documentTypes.Actor.includes(type),
    api: globalThis.acksExtras?.domains?.apiVersion ?? null,
    prune: game.settings.get(mod, "pruneEmptyLocations"),
    fontScale: game.settings.get(mod, "fontScale"),
  }),

  install: async () => {
    const H = (globalThis.__dm = globalThis.__dm ?? {});
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
    H.D = acksExtras.domains;
    H.plain = (v) => JSON.parse(JSON.stringify(v?.toObject?.() ?? v ?? null));
    H.txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.num = (s) => { const m = String(s ?? "").match(/-?[\d.]+/); return m ? Number(m[0]) : null; };
    H.sheetOf = (id) => H.apps().find((a) => a.document?.id === id && H.root(a)?.classList?.contains("acks-extras-domain-sheet")) ?? null;
    H.sheet = async (id, { fresh = false } = {}) => {
      let app = H.sheetOf(id);
      if (app && fresh) { await app.close({ animate: false }); app = null; }
      if (!app) { app = game.actors.get(id).sheet; await app.render({ force: true }); }
      await H.poll(() => H.root(app)?.querySelector?.('div.tab[data-tab="overview"]'));
      return app;
    };
    H.q = (app, sel) => H.root(app)?.querySelector(sel) ?? null;
    H.qa = (app, sel) => [...(H.root(app)?.querySelectorAll(sel) ?? [])];
    H.tab = async (app, id) => {
      H.q(app, `[data-action="tab"][data-tab="${id}"]`)?.click();
      return !!(await H.poll(() => H.q(app, `div.tab[data-tab="${id}"].active`)));
    };
    H.set = (el, value) => {
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    H.drop = (el, uuid, type) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type, uuid }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    };
    if (!H.patched) {
      H.notes = [];
      H.errors = [];
      H.orig = { error: console.error };
      for (const k of ["info", "warn", "error"]) {
        H.orig[k + "Note"] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k + "Note"].call(this, msg, ...rest);
        };
      }
      console.error = function (...args) {
        H.errors.push(args.map((a) => String(a?.message ?? a)).join(" ").slice(0, 300));
        return H.orig.error.apply(this, args);
      };
      H.onError = (e) => H.errors.push(String(e?.message ?? e?.reason?.message ?? e?.reason ?? e).slice(0, 300));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onError);
      H.patched = true;
    }
    H.take = () => ({ notes: H.notes.splice(0), errors: H.errors.splice(0) });
    return { ok: true };
  },

  restore: async () => {
    const H = globalThis.__dm;
    if (!H?.patched) return { restored: false };
    for (const k of ["info", "warn", "error"]) ui.notifications[k] = H.orig[k + "Note"];
    console.error = H.orig.error;
    window.removeEventListener("error", H.onError);
    window.removeEventListener("unhandledrejection", H.onError);
    H.patched = false;
    return { restored: true };
  },

  take: async () => globalThis.__dm.take(),

  closeAll: async () => {
    const H = globalThis.__dm;
    const closed = [];
    for (const app of H.apps()) {
      if (!app.rendered || !(app.document || app instanceof foundry.applications.api.DialogV2)) continue;
      try { await app.close({ animate: false }); closed.push(app.id); } catch { /* already gone */ }
    }
    return { closed: closed.length };
  },

  setSetting: async ({ mod, key, value }) => {
    await game.settings.set(mod, key, value);
    return { [key]: game.settings.get(mod, key) };
  },

  /** A location with a market whose families and class are typed in. */
  addMarket: async ({ id, families, marketClass }) => {
    const LD = await import("/modules/acks-extras/scripts/location/data/location-data.mjs");
    const loc = game.actors.get(id);
    await loc.update({ "system.market": LD.emptyMarket() });
    await loc.update({ "system.market.urbanFamilies": families, "system.market.marketClassOverride": marketClass });
    return { hasMarket: !!loc.system.market, families: loc.system.market?.urbanFamilies ?? null, marketClass: loc.system.marketClass };
  },

  /** Write a record the way the importer's binding writes one: through the normaliser, onto a bare actor. */
  populate: async ({ id, record }) => {
    const H = globalThis.__dm;
    const a = game.actors.get(id);
    await a.update({ system: H.D.normalizeDomain(record) });
    return { territory: a.system.territory.length, holdings: a.system.holdings.length, structures: a.system.structures.length, vassalRows: a.system.vassalRows.length };
  },

  update: async ({ id, data }) => {
    await game.actors.get(id).update(data);
    return { ok: true };
  },

  system: async ({ id }) => globalThis.__dm.plain(game.actors.get(id)?.system ?? null),

  /** Every tab rendered, and the totals the sheet shows beside the api's. */
  read: async ({ id }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    const tabs = {};
    for (const t of ["overview", "territory", "holdings", "ledger", "realm", "notes"]) {
      tabs[t] = (await H.tab(app, t)) && (H.q(app, `div.tab[data-tab="${t}"]`)?.children.length ?? 0) > 0;
    }
    const glance = H.qa(app, ".acks-extras-domain-glance dd").map((dd) => H.num(H.txt(dd)));
    const totals = H.qa(app, 'div.tab[data-tab="ledger"] tr.acks-extras-domain-total td:nth-child(2)').map((td) => H.num(H.txt(td)));
    const partial = H.txt(H.q(app, ".acks-extras-domain-partial"));
    const ledger = H.D.ledgerFor(game.actors.get(id));
    return { tabs, glance, totals, partial, unset: ledger.unset, unknown: ledger.unknown, api: ledger.totals, families: H.D.familiesOf(game.actors.get(id)) };
  },

  /** Set one control on the sheet as a user would, by its name, and let the submit land. */
  edit: async ({ id, tab, name, value, prose = false }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    await H.tab(app, tab);
    const el = H.q(app, `[name="${name}"]`);
    if (!el) return { found: false };
    const before = game.actors.get(id)._stats?.modifiedTime ?? 0;
    if (prose) {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else H.set(el, value);
    const landed = await H.poll(() => (game.actors.get(id)._stats?.modifiedTime ?? 0) > before, { tries: 30, every: 150 });
    await H.sleep(300);
    return { found: true, landed: !!landed };
  },

  /** Press a sheet button by selector; with `answer`, press that button of the dialog it opens. */
  press: async ({ id, tab, selector, answer = null }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    await H.tab(app, tab);
    const el = H.q(app, selector);
    if (!el) return { found: false };
    el.click();
    let answered = null;
    if (answer) {
      const dlg = await H.poll(() => H.apps().find((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered && H.root(a)?.querySelector(`button[data-action="${answer}"]`)));
      if (dlg) { H.root(dlg).querySelector(`button[data-action="${answer}"]`).click(); answered = answer; }
    }
    await H.sleep(1200);
    return { found: true, answered };
  },

  /** Drop a document on the sheet: on `zone` where one is named, else on the tab's body. */
  dropOn: async ({ id, tab, uuid, type = "Actor", zone = null }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    await H.tab(app, tab);
    const el = zone ? H.q(app, `[data-drop-zone="${zone}"]`) : H.q(app, `div.tab[data-tab="${tab}"]`);
    if (!el) return { found: false };
    H.drop(el, uuid, type);
    await H.sleep(1500);
    return { found: true };
  },

  /** What a sheet shows, by selector: counts, texts and option values. */
  look: async ({ id, tab, count = [], text = [], options = [] }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    if (tab) await H.tab(app, tab);
    return {
      count: Object.fromEntries(count.map((s) => [s, H.qa(app, s).length])),
      text: Object.fromEntries(text.map((s) => [s, H.txt(H.q(app, s))])),
      options: Object.fromEntries(options.map((s) => [s, H.qa(app, `${s} option`).map((o) => o.value)])),
    };
  },

  ask: async ({ fn, args }) => {
    const H = globalThis.__dm;
    const resolve = (a) => (typeof a === "string" && a.startsWith("@") ? game.actors.get(a.slice(1)) : a);
    const out = await H.D[fn](...(args ?? []).map(resolve));
    if (Array.isArray(out)) return out.map((d) => d?.uuid ?? d);
    if (out?.documentName) return out.uuid;
    if (out?.other?.documentName) return { ...out, other: out.other.name };
    return out ?? null;
  },

  /**
   * The empty places the prune would take that this run did not make. Looser
   * than the prune itself — it counts a place with no goods, no roster and no
   * market whatever else keeps it — so a run refuses where it might have been
   * safe, never the other way.
   */
  pruneCandidates: async ({ own }) => game.actors
    .filter((a) => a.type === "acks-extras.location" && !own.includes(a.id))
    .filter((a) => a.items.size === 0 && !(a.system?.roster ?? []).length && a.system?.market == null)
    .map((a) => a.id),

  prune: async ({ ids }) => {
    const LM = await import("/modules/acks-extras/scripts/location/module.mjs");
    const result = await LM.pruneEmptyLocations();
    return { result, exists: Object.fromEntries(ids.map((id) => [id, !!game.actors.get(id)])) };
  },

  remove: async ({ id }) => {
    await game.actors.get(id)?.delete();
    await globalThis.__dm.sleep(1000);
    return { gone: !game.actors.get(id) };
  },

  /** The player's view: what is enabled, which buttons render, what the hidden and revealed rows show. */
  playerView: async ({ id, hiddenName, gmText }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id, { fresh: true });
    const root = H.root(app);
    const named = [...root.querySelectorAll("input[name], select[name], textarea[name], prose-mirror[name]")];
    await H.tab(app, "holdings");
    return {
      rendered: !!root,
      enabled: named.filter((el) => !el.disabled).map((el) => el.getAttribute("name")),
      buttons: [...root.querySelectorAll('[data-action="rowAdd"], [data-action="rowDelete"], [data-action="clearRuler"], [data-action="releaseVassal"]')].length,
      hiddenShown: H.txt(root.querySelector('div.tab[data-tab="holdings"]')).includes(hiddenName),
      landInputs: [...root.querySelectorAll('[name$=".landValue"]')].map((el) => el.getAttribute("name")),
      gmNotes: !!root.querySelector('[name="system.gmNotes"]') || H.txt(root).includes(gmText),
    };
  },

  /** A short window: does the body scroll to its last control with the tabs in view? */
  shortWindow: async ({ id }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id, { fresh: true });
    await H.tab(app, "ledger");
    app.setPosition({ height: 320 });
    await H.sleep(500);
    const root = H.root(app);
    const body = root.querySelector('[data-application-part="body"]');
    const nav = root.querySelector('[data-application-part="header"] [data-action="tab"]');
    const before = { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY };
    body.scrollTop = body.scrollHeight;
    await H.sleep(300);
    const controls = [...body.querySelectorAll('div.tab.active input, div.tab.active select, div.tab.active button')];
    const last = controls.at(-1);
    const br = body.getBoundingClientRect();
    const lr = last?.getBoundingClientRect();
    const fr = root.getBoundingClientRect();
    const nr = nav?.getBoundingClientRect();
    return {
      ...before,
      lastReached: !!lr && lr.bottom <= br.bottom + 1 && lr.top >= br.top - 1,
      navInView: !!nr && nr.top >= fr.top && nr.bottom <= fr.bottom,
      frameHeight: Math.round(fr.height),
    };
  },

  /** The computed type of the body and the header on a fresh copy of the sheet. */
  typeSize: async ({ id }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id, { fresh: true });
    await H.tab(app, "overview");
    const root = H.root(app);
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    return {
      body: px(root.querySelector('div.tab[data-tab="overview"] .acks-extras-domain-label')),
      header: px(root.querySelector(".acks-extras-domain-name")),
    };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.domains?.hold`); } catch { ok = false; }
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
let prunePre = null;
let fontPre = null;

try {
  section("seats");
  gm = await seat("gm");
  const census = await run(gm, P.census, { mod: MOD, type: DOMAIN });
  note("gm census", census);
  check("before anything else: the world declares the domain sub-type, the api is published, and this seat is the active GM", census.domainType && census.api === 1 && census.activeGMIsSelf, census);
  if (!census.domainType) throw new Error("the world does not declare acks-extras.domain: shut it down and relaunch it");
  prunePre = census.prune;
  fontPre = census.fontScale;
  note("install (gm)", await run(gm, P.install));
  const player = await seat("player");
  const pc = await run(player, P.census, { mod: MOD, type: DOMAIN });
  note("install (player)", await run(player, P.install));

  section("fixtures");
  const mk = (name, type, extra = {}) => gm.create("Actor", { name: `${name} ${NONCE}`, type, ...extra });
  const D1 = await mk("Domain 1", DOMAIN);
  const D2 = await mk("Domain 2", DOMAIN);
  const R = await mk("NPC 1", "character", { items: [] });
  const F = await mk("Organisation 1", FACTION);
  const S = await mk("Town 2", LOCATION);
  const K = await mk("Place 1", LOCATION);
  const C = await mk("Place 2", LOCATION);
  const W = await gm.create("Item", { name: `Item 1 ${NONCE}`, type: "item" });
  const G = await gm.create("Item", { name: `Item 2 ${NONCE}`, type: "item" }, { parent: R.uuid });
  note("settlement market", await run(gm, P.addMarket, { id: S.id, families: 75, marketClass: 4 }));
  note("fixtures", { D1: D1.uuid, D2: D2.uuid, R: R.uuid, F: F.uuid, S: S.uuid, K: K.uuid, C: C.uuid, W: W.uuid, G: G.uuid });

  section("1. a record, written the way the binding writes it");
  note("populate Domain 1", await run(gm, P.populate, { id: D1.id, record: RECORD }));
  note("populate Domain 2", await run(gm, P.populate, { id: D2.id, record: { tributeGp: 40, territory: [{ label: "Tract 1", count: 2, families: 90 }] } }));
  const r1 = await run(gm, P.read, { id: D1.id });
  note("read", r1);
  check("1: every tab renders the record", Object.values(r1.tabs).every(Boolean), r1.tabs);
  check("1: Overview shows the families, hexes and stronghold value summed by hand", same(r1.glance.slice(0, 4), [BY_HAND.peasant, BY_HAND.urban, BY_HAND.hexes, BY_HAND.stronghold]), { shown: r1.glance, byHand: BY_HAND });
  check("1: the Ledger's totals equal the lines summed by hand, and the api agrees", same(r1.totals, [BY_HAND.revenue, BY_HAND.expenses, BY_HAND.income]) && same(r1.api, { revenue: BY_HAND.revenue, expenses: BY_HAND.expenses, income: BY_HAND.income }), { shown: r1.totals, api: r1.api });
  check("1: the ledger is partial with one line unset, and says so", r1.unset === 1 && r1.unknown === 0 && r1.partial.length > 0, { unset: r1.unset, unknown: r1.unknown, partial: r1.partial });
  note("enter the tithe", await run(gm, P.edit, { id: D1.id, tab: "ledger", name: "system.expenses.tithe.peasantGp", value: String(TITHE) }));
  const r1b = await run(gm, P.read, { id: D1.id });
  check("1: with the missing line entered, the partial note is gone and the totals move by it", r1b.unset === 0 && !r1b.partial && same(r1b.totals, [BY_HAND_FULL.revenue, BY_HAND_FULL.expenses, BY_HAND_FULL.income]), { totals: r1b.totals, partial: r1b.partial });
  note("errors (1)", await run(gm, P.take));

  section("2. every kind of field");
  const edits = [
    ["overview", "system.title", "Title 2"],
    ["overview", "system.classification", "outlands"],
    ["overview", "system.morale.current", ""],
    ["territory", "system.territory.0.families", "130"],
    ["territory", "system.territory.0.hexLabels", "0101, 0102"],
    ["realm", "system.vassalRows.0.domainHexes.classes.civilized", true],
  ];
  const editResults = [];
  for (const [tab, name, value] of edits) editResults.push([name, await run(gm, P.edit, { id: D1.id, tab, name, value })]);
  editResults.push(["system.notes", await run(gm, P.edit, { id: D1.id, tab: "notes", name: "system.notes", value: "<p>Notes 2</p>", prose: true })]);
  note("edits", editResults);
  const s2 = await run(gm, P.system, { id: D1.id });
  check("2: text, select and number fields land typed, a cleared number is null", s2.title === "Title 2" && s2.classification === "outlands" && s2.morale.current === null && s2.morale.base === 0, { title: s2.title, classification: s2.classification, morale: s2.morale });
  check("2: a row field and a hex-label list land, and the other rows keep their values", s2.territory[0].families === 130 && same(s2.territory[0].hexLabels, ["0101", "0102"]) && s2.territory[1].families === 200 && s2.territory[1].count === 4 && s2.holdings.length === 1 && s2.holdings[0].families === 50, { t0: s2.territory[0], t1: s2.territory[1] });
  check("2: a vassal row's class checkbox lands beside the class it had", same(s2.vassalRows[0].domainHexes.classes, ["civilized", "outlands"]) && s2.vassalRows[0].tributeGp === 70, s2.vassalRows[0].domainHexes);
  check("2: the notes land", /Notes 2/.test(s2.notes), { notes: s2.notes, found: editResults.at(-1)[1] });
  note("errors (2)", await run(gm, P.take));

  section("3. rows added and removed");
  await run(gm, P.press, { id: D1.id, tab: "territory", selector: '[data-action="rowAdd"][data-array="territory"]' });
  const s3a = await run(gm, P.system, { id: D1.id });
  check("3: Add tract appends a row with an id of its own, and the rows before it keep their values", s3a.territory.length === 3 && !!s3a.territory[2].id && s3a.territory[2].id !== s3a.territory[0].id && s3a.territory[0].families === 130 && s3a.territory[1].families === 200, s3a.territory.map((t) => [t.id, t.label, t.families]));
  note("remove, confirmed", await run(gm, P.press, { id: D1.id, tab: "territory", selector: '[data-action="rowDelete"][data-array="territory"][data-index="2"]', answer: "yes" }));
  const s3b = await run(gm, P.system, { id: D1.id });
  check("3: a confirmed remove takes the row, the others unchanged", s3b.territory.length === 2 && s3b.territory[0].families === 130 && s3b.territory[1].families === 200, s3b.territory.map((t) => t.label));
  note("remove, cancelled", await run(gm, P.press, { id: D1.id, tab: "territory", selector: '[data-action="rowDelete"][data-array="territory"][data-index="1"]', answer: "no" }));
  const s3c = await run(gm, P.system, { id: D1.id });
  check("3: a cancelled remove takes nothing", s3c.territory.length === 2, s3c.territory.length);
  note("errors (3)", await run(gm, P.take));

  section("4. a place is held, once");
  await run(gm, P.dropOn, { id: D1.id, tab: "holdings", uuid: S.uuid });
  await run(gm, P.dropOn, { id: D1.id, tab: "holdings", uuid: K.uuid });
  const s4 = await run(gm, P.system, { id: D1.id });
  const held = Object.fromEntries(s4.holdings.filter((h) => h.uuid).map((h) => [h.uuid, h.role]));
  const r4 = await run(gm, P.read, { id: D1.id });
  check("4: the settlement is held as a settlement and the stronghold place as other", held[S.uuid] === "settlement" && held[K.uuid] === "other", held);
  check("4: the urban families include the place's own", r4.families.urban === 50 + 75 && r4.glance[1] === 125, r4.families);
  const n4 = await run(gm, P.take);
  await run(gm, P.dropOn, { id: D2.id, tab: "holdings", uuid: S.uuid });
  const n4b = await run(gm, P.take);
  const s4b = await run(gm, P.system, { id: D2.id });
  check("4: a second domain is refused the place, with a warning naming the first", s4b.holdings.length === 0 && n4b.notes.some((n) => n.kind === "warn" && n.text.includes(`Domain 1 ${NONCE}`)), { holdings: s4b.holdings.length, notes: n4b.notes });
  note("errors (4)", { first: n4.errors, second: n4b.errors });

  section("5. the realm");
  await run(gm, P.dropOn, { id: D1.id, tab: "realm", uuid: D2.uuid });
  const v5 = await run(gm, P.system, { id: D2.id });
  const l5 = await run(gm, P.look, { id: D1.id, tab: "realm", count: [`div.tab[data-tab="realm"] tr[data-uuid="${D2.uuid}"]`] });
  const r5 = await run(gm, P.read, { id: D1.id });
  const tIn = await run(gm, P.ask, { fn: "ledgerFor", args: [`@${D1.id}`] });
  check("5: a domain dropped on the Realm tab becomes the vassal, listed among the vassal domains", v5.parentUuid === D1.uuid && Object.values(l5.count)[0] === 1, { parentUuid: v5.parentUuid, listed: l5.count });
  check("5: the vassal's tribute joins tribute in, and the revenue rises by exactly it", tIn.tributeIn.total === 80 + 40 && tIn.tributeIn.count === 2 && r5.api.revenue === r4.api.revenue + 40, { tributeIn: tIn.tributeIn, before: r4.api.revenue, after: r5.api.revenue });
  await run(gm, P.take);
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: D2.uuid, zone: "liege" });
  const n5 = await run(gm, P.take);
  const s5 = await run(gm, P.system, { id: D1.id });
  const v5b = await run(gm, P.system, { id: D2.id });
  check("5: the vassal dropped on the liege row is refused as a loop, naming both, and neither edge moved", s5.parentUuid === "" && v5b.parentUuid === D1.uuid && n5.notes.some((n) => n.kind === "warn" && n.text.includes(`Domain 1 ${NONCE}`) && n.text.includes(`Domain 2 ${NONCE}`)), { d1: s5.parentUuid, d2: v5b.parentUuid, notes: n5.notes });
  const l5b = await run(gm, P.look, { id: D1.id, tab: "overview", options: ['select[name="system.parentUuid"]'] });
  check("5: the liege picker does not offer the vassal", !Object.values(l5b.options)[0].includes(D2.uuid) && Object.values(l5b.options)[0].includes(""), l5b.options);
  await run(gm, P.press, { id: D1.id, tab: "realm", selector: `tr[data-uuid="${D2.uuid}"] [data-action="releaseVassal"]` });
  const v5c = await run(gm, P.system, { id: D2.id });
  check("5: the release button cuts the vassal loose", v5c.parentUuid === "", v5c.parentUuid);
  note("errors (5)", n5.errors);

  section("6. the ruler");
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: R.uuid, zone: "ruler" });
  const s6 = await run(gm, P.system, { id: D1.id });
  const ruled = await run(gm, P.ask, { fn: "domainsRuledBy", args: [R.uuid] });
  check("6: a character dropped on the ruler row rules the domain, by uuid and by name", s6.rulerUuid === R.uuid && s6.rulerName === `NPC 1 ${NONCE}` && same(ruled, [D1.uuid]), { rulerUuid: s6.rulerUuid, rulerName: s6.rulerName, ruled });
  await run(gm, P.take);
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: F.uuid, zone: "ruler" });
  const n6 = await run(gm, P.take);
  const s6b = await run(gm, P.system, { id: D1.id });
  check("6: an organisation is refused as a ruler", s6b.rulerUuid === R.uuid && n6.notes.some((n) => n.kind === "warn"), { rulerUuid: s6b.rulerUuid, notes: n6.notes });

  section("7. goods are refused");
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: W.uuid, type: "Item" });
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: G.uuid, type: "Item" });
  const n7 = await run(gm, P.take);
  const items7 = await gm.eval(`JSON.stringify({ domain: game.actors.get(${JSON.stringify(D1.id)}).items.size, ruler: game.actors.get(${JSON.stringify(R.id)}).items.has(${JSON.stringify(G.id)}) })`);
  const i7 = JSON.parse(items7);
  check("7: one warning per goods drop, and the domain holds nothing while the ruler keeps the gear", n7.notes.filter((n) => n.kind === "warn").length === 2 && i7.domain === 0 && i7.ruler, { notes: n7.notes, ...i7 });

  section("8. a held place survives the prune");
  const others = await run(gm, P.pruneCandidates, { own: [S.id, K.id, C.id] });
  if (others.length) {
    note("8: NOT RUN", `the world holds ${others.length} empty place(s) this run did not make; the prune would delete them`);
    const kept = await run(gm, P.ask, { fn: "holdsPlace", args: [K.uuid] });
    const control = await run(gm, P.ask, { fn: "holdsPlace", args: [C.uuid] });
    check("8 (prune not run): the clause the prune asks answers held for the held place and not for the control", kept === true && control === false, { held: kept, control });
  } else {
    if (!prunePre) note("prune setting on", await run(gm, P.setSetting, { mod: MOD, key: "pruneEmptyLocations", value: true }));
    const p8 = await run(gm, P.prune, { ids: [K.id, C.id] });
    note("prune", p8);
    check("8: the held empty place survives the prune and the control goes", p8.exists[K.id] === true && p8.exists[C.id] === false, p8);
  }

  section("9. the place around it");
  const inner = await mk("Place 3", LOCATION, { system: { parentUuid: S.uuid } });
  const of9 = await run(gm, P.ask, { fn: "domainOf", args: [inner.uuid] });
  const holds9 = await run(gm, P.ask, { fn: "holdsPlace", args: [inner.uuid] });
  check("9: a place inside a held settlement answers to its domain, and is not itself held", of9 === D1.uuid && holds9 === false, { domainOf: of9, holdsPlace: holds9 });

  section("10. the delete path");
  await run(gm, P.take);
  note("delete the settlement", await run(gm, P.remove, { id: S.id }));
  const r10 = await run(gm, P.read, { id: D1.id });
  const l10 = await run(gm, P.look, { id: D1.id, tab: "holdings", count: ['div.tab[data-tab="holdings"] tr.is-missing'] });
  const n10 = await run(gm, P.take);
  check("10: the held row stays, marked missing, and its families are counted unknown rather than zero", Object.values(l10.count)[0] === 1 && r10.families.urban === 50 && r10.families.urbanUnknown === 1, { missing: l10.count, families: r10.families });
  check("10: urban rates over the unknown families leave the ledger partial", r10.unknown > 0 && r10.partial.length > 0, { unknown: r10.unknown, partial: r10.partial });
  check("10: the sheet renders after the delete without a console error", n10.errors.length === 0, n10.errors);

  section("11. a player reads, and writes nothing");
  const s11 = await run(gm, P.system, { id: D1.id });
  const holdings11 = s11.holdings.map((h) => (h.uuid === K.uuid ? { ...h, hidden: true } : h));
  note("observer, hidden holding", await run(gm, P.update, { id: D1.id, data: { ownership: { default: 0, [pc.userId]: 2 }, "system.holdings": holdings11 } }));
  const pv = await run(player, P.playerView, { id: D1.id, hiddenName: `Place 1 ${NONCE}`, gmText: "Judge only 1" });
  note("player view", pv);
  check("11: on the player's sheet every control is disabled and no row button renders", pv.rendered && pv.enabled.length === 0 && pv.buttons === 0, { enabled: pv.enabled, buttons: pv.buttons });
  check("11: the hidden holding and the Judge's notes are absent, and only the revealed row shows its land value", !pv.hiddenShown && !pv.gmNotes && same(pv.landInputs, ["system.territory.0.landValue"]), pv);
  const ph = await run(player, P.ask, { fn: "hold", args: [`@${D1.id}`, { uuid: K.uuid }] });
  check("11: the api refuses the player's client", ph?.ok === false && ph?.reason === "judgeOnly", ph);
  note("errors (player)", await run(player, P.take));
  await run(player, P.closeAll);

  section("12. layout");
  const sw = await run(gm, P.shortWindow, { id: D1.id });
  note("short window", sw);
  check("12: in a short window the body scrolls to its last control and the tabs stay in view", /auto|scroll/.test(sw.overflowY) && sw.scrollHeight > sw.clientHeight && sw.lastReached && sw.navInView, sw);
  note("fontScale 14", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  const t14 = await run(gm, P.typeSize, { id: D1.id });
  note("fontScale 18", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 }));
  const t18 = await run(gm, P.typeSize, { id: D1.id });
  const ratio = (a, b) => (a && b ? Math.round((b / a) * 1000) / 1000 : null);
  check("12: on a fresh window the body and the header both take the type size (18/14 = 1.286)", Math.abs(ratio(t14.body, t18.body) - 18 / 14) < 0.03 && Math.abs(ratio(t14.header, t18.header) - 18 / 14) < 0.03, { at14: t14, at18: t18, body: ratio(t14.body, t18.body), header: ratio(t14.header, t18.header) });
  note("errors (12)", await run(gm, P.take));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm && fontPre !== null) note("fontScale restored", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: fontPre })); } catch (err) { console.error("fontScale:", err?.message ?? err); }
  try { if (gm && prunePre !== null) note("prune setting restored", await run(gm, P.setSetting, { mod: MOD, key: "pruneEmptyLocations", value: prunePre })); } catch (err) { console.error("prune setting:", err?.message ?? err); }
  for (const [key, api] of Object.entries(seats)) {
    try { note(`restored (${key})`, await run(api, P.restore)); } catch (err) { console.error(`restore ${key}:`, err?.message ?? err); }
  }
  for (const [key, api] of Object.entries(seats)) {
    try { note(`sweep (${key})`, await api.sweepTracked()); } catch (err) { console.error(`sweep ${key}:`, err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
