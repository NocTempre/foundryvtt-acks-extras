/**
 * Live walk, domains: docs/domains/TESTING.md, steps 1–18.
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
 *
 * With SHOTS=1 the walk takes the domains guide's plates where the record it
 * built shows each surface: the Ledger after step 4, the Realm with a vassal
 * in step 5, the Overview and the Holdings after step 6, and the held place's
 * Domain line in step 9.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

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
const SHOTS = process.env.SHOTS === "1";
/** One plate of one sheet: the sheet alone in the frame, on the tab named, clipped to its window. */
const plate = async (seat, slug, { id, tab = null }) => {
  if (!SHOTS) return null;
  try {
    const sel = await run(seat, P.framed, { id, tab });
    await seat.compose(sel);
    await sleep(500);
    const r = await seat.shot(`${shotDir()}/${slug}.png`, sel);
    note(`shot ${slug}`, r);
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    return null;
  }
};

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
    H.openSheet = async (id) => {
      const app = game.actors.get(id).sheet;
      await app.render({ force: true });
      await H.poll(() => H.root(app)?.querySelector?.(".window-content"));
      await H.sleep(300);
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
    const rails = Object.fromEntries(H.qa(app, '[data-action="goTab"][data-key]').map((el) => [el.dataset.key, H.num(H.txt(el.querySelector(".acks-extras-domain-sheet__cell-value")))]));
    const totals = H.qa(app, 'div.tab[data-tab="ledger"] tr.acks-extras-domain-total td:nth-child(2)').map((td) => H.num(H.txt(td)));
    const partial = H.txt(H.q(app, ".acks-extras-domain-partial"));
    const ledger = H.D.ledgerFor(game.actors.get(id));
    return { tabs, rails, totals, partial, unset: ledger.unset, unknown: ledger.unknown, api: ledger.totals, families: H.D.familiesOf(game.actors.get(id)) };
  },

  /** The frame: how many bands the window holds and where, the band's fields, the rails' partial cells, the chips and the tags. */
  frame: async ({ id }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    const root = H.root(app);
    const bands = [...root.querySelectorAll('[data-application-part="band"]')];
    const val = (sel) => root.querySelector(sel)?.value ?? null;
    return {
      bands: bands.length,
      inHeader: bands.length === 1 && !!bands[0].closest(".window-header"),
      title: val('.window-header [name="system.title"]'),
      name: val('.window-header [name="name"]'),
      morale: [val('.window-header [name="system.morale.current"]'), val('.window-header [name="system.morale.base"]')],
      partial: H.qa(app, '[data-action="goTab"].is-partial').map((el) => el.dataset.key),
      chips: Object.fromEntries(H.qa(app, "[data-drop-zone]").map((el) => [el.dataset.dropZone, H.txt(el.querySelector(".acks-extras-domain-sheet__chip-name"))])),
      tags: H.qa(app, "[data-tag]").map((el) => H.txt(el)),
    };
  },

  /** Press a rail cell: does the tab its figure is kept on open? */
  cellOpens: async ({ id, key }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    await H.tab(app, "overview");
    const cell = H.q(app, `[data-action="goTab"][data-key="${key}"]`);
    if (!cell) return { found: false };
    const tab = cell.dataset.tab;
    cell.click();
    return { found: true, tab, active: !!(await H.poll(() => H.q(app, `div.tab[data-tab="${tab}"].active`))) };
  },

  /**
   * Press a picker and read which of `probe` its dialog offers; choose
   * `choice` by value, or close the dialog unchosen. A picker with nothing to
   * offer opens no dialog.
   */
  pick: async ({ id, tab, selector, probe = [], choice = null }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id);
    await H.tab(app, tab);
    const el = H.q(app, selector);
    if (!el) return { found: false };
    el.click();
    const dlg = await H.poll(() => H.apps().find((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered && H.root(a)?.querySelector('select[name="choice"]')), { tries: 20 });
    if (!dlg) {
      await H.sleep(300);
      return { found: true, dialog: false, count: 0, offered: Object.fromEntries(probe.map((u) => [u, false])) };
    }
    const select = H.root(dlg).querySelector('select[name="choice"]');
    const values = [...select.options].map((o) => o.value);
    let chosen = false;
    if (choice && values.includes(choice)) {
      select.value = choice;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      H.root(dlg).querySelector('button[data-action="ok"]').click();
      chosen = true;
    } else await dlg.close();
    await H.sleep(1200);
    return { found: true, dialog: true, count: values.length, offered: Object.fromEntries(probe.map((u) => [u, values.includes(u)])), chosen };
  },

  /** Drop a document on any actor's sheet, on its content box. */
  dropOnSheet: async ({ id, uuid, type = "Actor" }) => {
    const H = globalThis.__dm;
    const app = await H.openSheet(id);
    const el = H.root(app)?.querySelector(".window-content");
    if (!el) return { found: false };
    H.drop(el, uuid, type);
    await H.sleep(1500);
    return { found: true };
  },

  /** The text of one element on any actor's sheet. */
  /** Open an actor's sheet fresh at its own size, on the tab named; the selector of its window. */
  framed: async ({ id, tab }) => {
    const H = globalThis.__dm;
    const doc = game.actors.get(id);
    const app = doc.type === "acks-extras.domain" ? await H.sheet(id, { fresh: true }) : await H.openSheet(id);
    if (tab) await H.tab(app, tab);
    app.setPosition({ left: 60, top: 40 });
    app.bringToFront?.();
    await H.sleep(400);
    return `#${H.root(app).id}`;
  },

  sheetText: async ({ id, selector }) => {
    const H = globalThis.__dm;
    const app = await H.openSheet(id);
    const el = H.root(app)?.querySelector(selector);
    return { rendered: !!app?.rendered, found: !!el, text: H.txt(el) };
  },

  name: async ({ id }) => game.actors.get(id)?.name ?? null,

  /** Set each actor's token on the scene; who the scene's occupants are, and what size the battle map would give each. */
  markers: async ({ sceneId, ids }) => {
    const scene = game.scenes.get(sceneId);
    const data = [];
    for (const [i, id] of ids.entries()) data.push((await game.actors.get(id).getTokenDocument({ x: 100 * (i + 1), y: 100 })).toObject());
    const made = await scene.createEmbeddedDocuments("Token", data);
    await globalThis.__dm.sleep(500);
    const sizeOf = acksExtras.battlemap?.sizeForToken;
    return {
      tokens: made.length,
      occupants: acksExtras.lib.places.sceneOccupants(scene).map((r) => r.uuid),
      sizes: Object.fromEntries(made.map((t) => [t.actor?.id ?? t.id, sizeOf ? sizeOf(t, scene) : "no api"])),
    };
  },

  /** The facts of a made actor, for the report: its type, folder, market and record. */
  made: async ({ uuid }) => {
    const a = await fromUuid(uuid);
    if (!a) return null;
    return { name: a.name, type: a.type, folder: a.folder?.id ?? null, hasMarket: a.system?.market != null, system: globalThis.__dm.plain(a.system) };
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
    const realmOpens = await H.tab(app, "realm");
    await H.tab(app, "holdings");
    const writers = ["rowAdd", "rowDelete", "clearRuler", "releaseVassal", "pickRuler", "pickLiege", "clearLiege", "promoteVassal", "foundSettlement", "editHeraldry"];
    const bands = [...root.querySelectorAll('[data-application-part="band"]')];
    const readers = [...root.querySelectorAll('[data-action="tab"], [data-action="goTab"], [data-action="openDoc"]')];
    return {
      rendered: !!root,
      enabled: named.filter((el) => !el.disabled).map((el) => el.getAttribute("name")),
      buttons: [...root.querySelectorAll(writers.map((a) => `[data-action="${a}"]`).join(", "))].length,
      hiddenShown: H.txt(root.querySelector('div.tab[data-tab="holdings"]')).includes(hiddenName),
      landInputs: [...root.querySelectorAll('[name$=".landValue"]')].map((el) => el.getAttribute("name")),
      gmNotes: !!root.querySelector('[name="system.gmNotes"]') || H.txt(root).includes(gmText),
      bandInHeader: bands.length === 1 && !!bands[0].closest(".window-header"),
      bandName: H.txt(root.querySelector(".window-header .acks-extras-domain-sheet__name")),
      realmOpens,
      readers: readers.length,
      readersDisabled: readers.filter((el) => el.disabled).length,
    };
  },

  /** A short window: does the active tab's part scroll to its last control with the tabs in view? */
  shortWindow: async ({ id, height }) => {
    const H = globalThis.__dm;
    const app = await H.sheet(id, { fresh: true });
    await H.tab(app, "ledger");
    app.setPosition({ height });
    await H.sleep(500);
    const root = H.root(app);
    const content = root.querySelector(".window-content");
    const body = root.querySelector('[data-application-part="ledger"]');
    const nav = root.querySelector('[data-application-part="tabs"] [data-action="tab"]');
    const before = { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflowY: getComputedStyle(body).overflowY, contentScrolls: content.scrollHeight > content.clientHeight };
    const navBefore = nav?.getBoundingClientRect();
    const fr = root.getBoundingClientRect();
    // The panel first, then the content box, as a reader's wheel would.
    body.scrollTop = body.scrollHeight;
    content.scrollTop = content.scrollHeight;
    await H.sleep(300);
    const inside = (r, box) => !!r && r.bottom <= box.bottom + 1 && r.top >= box.top - 1;
    const panelInView = inside(body.getBoundingClientRect(), content.getBoundingClientRect());
    const endReached = body.scrollTop >= body.scrollHeight - body.clientHeight - 1;
    // Content with no control in it can follow the last control, so a panel
    // at its end need not show it: wheel the panel back until it does.
    const controls = [...body.querySelectorAll("input, select, button")];
    const last = controls.at(-1);
    if (last) body.scrollTop -= body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
    await H.sleep(100);
    const lr = last?.getBoundingClientRect();
    const box = (r) => r && { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    return {
      ...before,
      contentOverflowY: getComputedStyle(content).overflowY,
      panelInView,
      endReached,
      lastReached: inside(lr, body.getBoundingClientRect()) && inside(lr, content.getBoundingClientRect()),
      navInView: inside(navBefore, fr),
      frameHeight: Math.round(fr.height),
      geometry: {
        header: Math.round(root.querySelector(".window-header")?.getBoundingClientRect().height ?? 0),
        content: { ...box(content.getBoundingClientRect()), clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, scrollTop: Math.round(content.scrollTop) },
        panel: { ...box(body.getBoundingClientRect()), scrollTop: Math.round(body.scrollTop) },
        last: last && { ...box(lr), tag: last.tagName, name: last.name || last.dataset.action || "" },
      },
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
      header: px(root.querySelector(".window-header .acks-extras-domain-sheet__name")),
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
  check("before anything else: the world declares the domain sub-type, the api is published, and this seat is the active GM", census.domainType && census.api === 3 && census.activeGMIsSelf, census);
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
  check("1: the land rail shows the families, hexes and stronghold value summed by hand", same([r1.rails.peasant, r1.rails.urban, r1.rails.hexes, r1.rails.stronghold], [BY_HAND.peasant, BY_HAND.urban, BY_HAND.hexes, BY_HAND.stronghold]), { shown: r1.rails, byHand: BY_HAND });
  check("1: the Ledger's totals and the month rail equal the lines summed by hand, and the api agrees", same(r1.totals, [BY_HAND.revenue, BY_HAND.expenses, BY_HAND.income]) && same([r1.rails.revenue, r1.rails.expenses, r1.rails.income], r1.totals) && same(r1.api, { revenue: BY_HAND.revenue, expenses: BY_HAND.expenses, income: BY_HAND.income }), { shown: r1.totals, rails: r1.rails, api: r1.api });
  check("1: the ledger is partial with one line unset, and says so", r1.unset === 1 && r1.unknown === 0 && r1.partial.length > 0, { unset: r1.unset, unknown: r1.unknown, partial: r1.partial });
  note("enter the tithe", await run(gm, P.edit, { id: D1.id, tab: "ledger", name: "system.expenses.tithe.peasantGp", value: String(TITHE) }));
  const r1b = await run(gm, P.read, { id: D1.id });
  check("1: with the missing line entered, the partial note is gone and the totals move by it", r1b.unset === 0 && !r1b.partial && same(r1b.totals, [BY_HAND_FULL.revenue, BY_HAND_FULL.expenses, BY_HAND_FULL.income]), { totals: r1b.totals, partial: r1b.partial });
  note("errors (1)", await run(gm, P.take));

  section("2. every kind of field");
  const d1Name = `Domain 1 ${NONCE} A`;
  const edits = [
    ["overview", "system.title", "Title 2"],
    ["overview", "name", d1Name],
    ["overview", "system.classification", "outlands"],
    ["overview", "system.morale.current", ""],
    ["overview", "system.morale.base", "2"],
    ["territory", "system.territory.0.families", "130"],
    ["territory", "system.territory.0.hexLabels", "0101, 0102"],
    ["realm", "system.vassalRows.0.domainHexes.classes.civilized", true],
  ];
  const editResults = [];
  for (const [tab, name, value] of edits) editResults.push([name, await run(gm, P.edit, { id: D1.id, tab, name, value })]);
  editResults.push(["system.notes", await run(gm, P.edit, { id: D1.id, tab: "notes", name: "system.notes", value: "<p>Notes 2</p>", prose: true })]);
  note("edits", editResults);
  const s2 = await run(gm, P.system, { id: D1.id });
  const name2 = await run(gm, P.name, { id: D1.id });
  check("2: text, select and number fields land typed — the band's title, name and morale among them — and a cleared number is null", s2.title === "Title 2" && name2 === d1Name && s2.classification === "outlands" && s2.morale.current === null && s2.morale.base === 2, { title: s2.title, name: name2, classification: s2.classification, morale: s2.morale });
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
  // Each drop's write lands on the server's time, not the drop's sleep: read
  // until both are held or ten seconds pass.
  let s4 = null;
  let held = {};
  for (let n = 0; n < 20; n++) {
    s4 = await run(gm, P.system, { id: D1.id });
    held = Object.fromEntries(s4.holdings.filter((h) => h.uuid).map((h) => [h.uuid, h.role]));
    if (held[S.uuid] && held[K.uuid]) break;
    await sleep(500);
  }
  const r4 = await run(gm, P.read, { id: D1.id });
  check("4: the settlement is held as a settlement and the stronghold place as other", held[S.uuid] === "settlement" && held[K.uuid] === "other", held);
  check("4: the urban families include the place's own, on the rail and in the api", r4.families.urban === 50 + 75 && r4.rails.urban === 125, { families: r4.families, rail: r4.rails.urban });
  const n4 = await run(gm, P.take);
  await run(gm, P.dropOn, { id: D2.id, tab: "holdings", uuid: S.uuid });
  const n4b = await run(gm, P.take);
  const s4b = await run(gm, P.system, { id: D2.id });
  check("4: a second domain is refused the place, with a warning naming the first", s4b.holdings.length === 0 && n4b.notes.some((n) => n.kind === "warn" && n.text.includes(`Domain 1 ${NONCE}`)), { holdings: s4b.holdings.length, notes: n4b.notes });
  note("errors (4)", { first: n4.errors, second: n4b.errors });
  await plate(gm, "domains", { id: D1.id, tab: "ledger" });

  section("5. the realm");
  await run(gm, P.dropOn, { id: D1.id, tab: "realm", uuid: D2.uuid });
  const v5 = await run(gm, P.system, { id: D2.id });
  const l5 = await run(gm, P.look, { id: D1.id, tab: "realm", count: [`div.tab[data-tab="realm"] tr[data-uuid="${D2.uuid}"]`] });
  const r5 = await run(gm, P.read, { id: D1.id });
  const tIn = await run(gm, P.ask, { fn: "ledgerFor", args: [`@${D1.id}`] });
  check("5: a domain dropped on the Realm tab becomes the vassal, listed among the vassal domains", v5.parentUuid === D1.uuid && Object.values(l5.count)[0] === 1, { parentUuid: v5.parentUuid, listed: l5.count });
  check("5: the vassal's tribute joins tribute in, and the revenue rises by exactly it", tIn.tributeIn.total === 80 + 40 && tIn.tributeIn.count === 2 && r5.api.revenue === r4.api.revenue + 40, { tributeIn: tIn.tributeIn, before: r4.api.revenue, after: r5.api.revenue });
  await plate(gm, "domains-realm", { id: D1.id, tab: "realm" });
  await run(gm, P.take);
  await run(gm, P.dropOn, { id: D1.id, tab: "overview", uuid: D2.uuid, zone: "liege" });
  const n5 = await run(gm, P.take);
  const s5 = await run(gm, P.system, { id: D1.id });
  const v5b = await run(gm, P.system, { id: D2.id });
  check("5: the vassal dropped on the liege row is refused as a loop, naming both, and neither edge moved", s5.parentUuid === "" && v5b.parentUuid === D1.uuid && n5.notes.some((n) => n.kind === "warn" && n.text.includes(`Domain 1 ${NONCE}`) && n.text.includes(`Domain 2 ${NONCE}`)), { d1: s5.parentUuid, d2: v5b.parentUuid, notes: n5.notes });
  const p5 = await run(gm, P.pick, { id: D1.id, tab: "overview", selector: '[data-drop-zone="liege"] [data-action="pickLiege"]', probe: [D2.uuid, D1.uuid] });
  check("5: the liege picker offers neither the vassal nor the domain itself", p5.found && !p5.offered[D2.uuid] && !p5.offered[D1.uuid], p5);
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
  await plate(gm, "domains-overview", { id: D1.id, tab: "overview" });
  await plate(gm, "domains-holdings", { id: D1.id, tab: "holdings" });

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
  const line9s = await run(gm, P.sheetText, { id: S.id, selector: ".acks-extras-place-domain" });
  const line9i = await run(gm, P.sheetText, { id: inner.id, selector: ".acks-extras-place-domain" });
  check("9: the held place's sheet names its domain, holding it", line9s.found && line9s.text.includes(`Domain 1 ${NONCE}`) && line9s.text.includes("holds this place"), line9s);
  await plate(gm, "location-domain", { id: S.id });
  check("9: the inner place's sheet names the domain and the place around it that is held", line9i.found && line9i.text.includes(`Domain 1 ${NONCE}`) && line9i.text.includes(`Town 2 ${NONCE}`), line9i);
  // The prune took the control, so the place no domain holds is made here.
  const free = await mk("Place 4", LOCATION);
  const line9f = await run(gm, P.sheetText, { id: free.id, selector: ".acks-extras-place-domain" });
  check("9: a place no domain holds renders with no Domain line", line9f.rendered && !line9f.found, line9f);
  await run(gm, P.closeAll);

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
  check("11: on the player's sheet every control is disabled and no writing button renders — row, chip, promote, found or heraldry", pv.rendered && pv.enabled.length === 0 && pv.buttons === 0, { enabled: pv.enabled, buttons: pv.buttons });
  check("11: the player's band sits in the header and names the domain", pv.bandInHeader && pv.bandName === d1Name, { bandInHeader: pv.bandInHeader, bandName: pv.bandName });
  check("11: the reading presses stay live for the player: the tabs open, and no tab, rail cell or name is disabled", pv.realmOpens && pv.readers > 0 && pv.readersDisabled === 0, { realmOpens: pv.realmOpens, readers: pv.readers, disabled: pv.readersDisabled });
  check("11: the hidden holding and the Judge's notes are absent, and only the revealed row shows its land value", !pv.hiddenShown && !pv.gmNotes && same(pv.landInputs, ["system.territory.0.landValue"]), pv);
  const ph = await run(player, P.ask, { fn: "hold", args: [`@${D1.id}`, { uuid: K.uuid }] });
  check("11: the api refuses the player's client", ph?.ok === false && ph?.reason === "judgeOnly", ph);
  note("errors (player)", await run(player, P.take));
  await run(player, P.closeAll);

  section("12. layout");
  const sw = await run(gm, P.shortWindow, { id: D1.id, height: 460 });
  note("short window", sw);
  check("12: in a short window the active tab scrolls to its end and to its last control, and the tabs stay in view", /auto|scroll/.test(sw.overflowY) && sw.scrollHeight > sw.clientHeight && sw.endReached && sw.lastReached && sw.navInView, sw);
  const sw2 = await run(gm, P.shortWindow, { id: D1.id, height: 200 });
  note("shorter than the frame", sw2);
  check("12: in a window shorter than the frame the content box scrolls the whole panel into view, and the panel still reaches its end and its last control", sw2.contentScrolls && /auto|scroll/.test(sw2.contentOverflowY) && sw2.panelInView && sw2.endReached && sw2.lastReached, sw2);
  note("fontScale 14", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  const t14 = await run(gm, P.typeSize, { id: D1.id });
  note("fontScale 18", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 }));
  const t18 = await run(gm, P.typeSize, { id: D1.id });
  const ratio = (a, b) => (a && b ? Math.round((b / a) * 1000) / 1000 : null);
  check("12: on a fresh window the body and the header both take the type size (18/14 = 1.286)", Math.abs(ratio(t14.body, t18.body) - 18 / 14) < 0.03 && Math.abs(ratio(t14.header, t18.header) - 18 / 14) < 0.03, { at14: t14, at18: t18, body: ratio(t14.body, t18.body), header: ratio(t14.header, t18.header) });
  note("fontScale back", await run(gm, P.setSetting, { mod: MOD, key: "fontScale", value: fontPre }));
  note("errors (12)", await run(gm, P.take));

  section("13. the frame");
  const f13 = await run(gm, P.frame, { id: D1.id });
  const r13 = await run(gm, P.read, { id: D1.id });
  note("frame", f13);
  check("13: after every re-render the window holds one band, in its header, with the record's title, name and morale", f13.bands === 1 && f13.inHeader && f13.title === "Title 2" && f13.name === d1Name && same(f13.morale, ["", "2"]), f13);
  check("13: the rails equal the api's sums, the urban count reading as a floor while a settlement gives no figure", r13.rails.peasant === r13.families.peasant && r13.rails.urban === r13.families.urban && r13.rails.revenue === r13.api.revenue && r13.rails.expenses === r13.api.expenses && r13.rails.income === r13.api.income, { rails: r13.rails, families: r13.families, api: r13.api });
  check("13: over a partial ledger the month's three cells are marked partial, and the land's are not", r13.partial.length > 0 && same(f13.partial, ["revenue", "expenses", "income"]), { partialCells: f13.partial, note: r13.partial });
  check("13: the chips name the ruler and the liege's absence, and the tags the classification and the ruler's alignment", f13.chips.ruler === `NPC 1 ${NONCE}` && f13.chips.liege.length > 0 && f13.tags.length === 2, { chips: f13.chips, tags: f13.tags });
  const c13a = await run(gm, P.cellOpens, { id: D1.id, key: "hexes" });
  const c13b = await run(gm, P.cellOpens, { id: D1.id, key: "income" });
  check("13: a rail cell opens the tab its figure is kept on", c13a.active && c13a.tab === "territory" && c13b.active && c13b.tab === "ledger", { hexes: c13a, income: c13b });
  note("errors (13)", await run(gm, P.take));

  section("14. the ruler and liege chips");
  await run(gm, P.press, { id: D1.id, tab: "overview", selector: '[data-drop-zone="ruler"] [data-action="clearRuler"]' });
  const s14a = await run(gm, P.system, { id: D1.id });
  check("14: clearing the ruler drops the actor and keeps the record's word for them", s14a.rulerUuid === "" && s14a.rulerName === `NPC 1 ${NONCE}`, { rulerUuid: s14a.rulerUuid, rulerName: s14a.rulerName });
  const p14a = await run(gm, P.pick, { id: D1.id, tab: "overview", selector: '[data-drop-zone="ruler"] [data-action="pickRuler"]', probe: [R.uuid, D1.uuid, D2.uuid, K.uuid, F.uuid], choice: R.uuid });
  const s14b = await run(gm, P.system, { id: D1.id });
  check("14: the ruler picker offers the character and no place, organisation or domain; choosing sets the ruler", p14a.offered[R.uuid] && !p14a.offered[D1.uuid] && !p14a.offered[D2.uuid] && !p14a.offered[K.uuid] && !p14a.offered[F.uuid] && p14a.chosen && s14b.rulerUuid === R.uuid, { offered: p14a.offered, rulerUuid: s14b.rulerUuid });
  const p14b = await run(gm, P.pick, { id: D2.id, tab: "overview", selector: '[data-drop-zone="liege"] [data-action="pickLiege"]', probe: [D1.uuid, D2.uuid], choice: D1.uuid });
  const s14c = await run(gm, P.system, { id: D2.id });
  check("14: Domain 2's liege picker offers Domain 1 and not itself; choosing makes it the liege", p14b.offered[D1.uuid] && !p14b.offered[D2.uuid] && p14b.chosen && s14c.parentUuid === D1.uuid, { offered: p14b.offered, parentUuid: s14c.parentUuid });
  await run(gm, P.take);
  await run(gm, P.press, { id: D2.id, tab: "overview", selector: '[data-drop-zone="liege"] [data-action="clearLiege"]' });
  const n14 = await run(gm, P.take);
  const s14d = await run(gm, P.system, { id: D2.id });
  check("14: clearing the liege cuts the vassalage and says so", s14d.parentUuid === "" && n14.notes.some((n) => n.kind === "info" && n.text.includes(`Domain 2 ${NONCE}`)), { parentUuid: s14d.parentUuid, notes: n14.notes });
  note("errors (14)", n14.errors);
  await run(gm, P.closeAll);

  section("15. a vassal row becomes a domain");
  const s15a = await run(gm, P.system, { id: D1.id });
  const row15 = s15a.vassalRows[0];
  const tIn15a = (await run(gm, P.ask, { fn: "ledgerFor", args: [`@${D1.id}`] })).tributeIn;
  const before15 = await run(gm, P.ask, { fn: "vassalsOf", args: [`@${D1.id}`] });
  note("promote", await run(gm, P.press, { id: D1.id, tab: "realm", selector: `fieldset[data-row-id="${row15.id}"] [data-action="promoteVassal"]`, answer: "yes" }));
  const after15 = await run(gm, P.ask, { fn: "vassalsOf", args: [`@${D1.id}`] });
  const made15 = after15.filter((u) => !before15.includes(u));
  for (const uuid of made15) gm.track(uuid, "Actor");
  note("promoted (tracked)", made15);
  const s15b = await run(gm, P.system, { id: D1.id });
  const tIn15b = (await run(gm, P.ask, { fn: "ledgerFor", args: [`@${D1.id}`] })).tributeIn;
  const m15 = made15.length === 1 ? await run(gm, P.made, { uuid: made15[0] }) : null;
  note("the new domain", m15 && { name: m15.name, type: m15.type, parentUuid: m15.system.parentUuid, tributeGp: m15.system.tributeGp, classification: m15.system.classification, territory: m15.system.territory, notes: m15.system.notes });
  const d1Folder = JSON.parse(await gm.eval(`JSON.stringify(game.actors.get(${JSON.stringify(D1.id)}).folder?.id ?? null)`));
  check("15: one new domain, answering to Domain 1, in its folder, and the row is gone", made15.length === 1 && m15?.type === DOMAIN && m15.system.parentUuid === D1.uuid && m15.folder === d1Folder && !s15b.vassalRows.some((r) => r.id === row15.id), { made: made15, folder: m15?.folder, d1Folder, rows: s15b.vassalRows.length });
  check("15: the new domain carries the row: ruler, tribute with the additional tax, hexes and peasants as a tract, the classes in its notes", m15?.system.rulerName === row15.rulerName && m15?.system.tributeGp === row15.tributeGp + row15.extraTaxGp && m15?.system.territory[0]?.count === row15.domainHexes.count && m15?.system.territory[0]?.families === row15.families.peasant && m15?.system.classification === "" && /Domain hexes/.test(m15?.system.notes ?? ""), m15?.system && { rulerName: m15.system.rulerName, tributeGp: m15.system.tributeGp, territory: m15.system.territory });
  check("15: Domain 1's tribute in is what it was", same(tIn15a, tIn15b), { before: tIn15a, after: tIn15b });
  note("errors (15)", await run(gm, P.take));

  section("16. a settlement is founded");
  const s16a = await run(gm, P.system, { id: D1.id });
  note("found", await run(gm, P.press, { id: D1.id, tab: "holdings", selector: '[data-action="foundSettlement"]', answer: "ok" }));
  const s16b = await run(gm, P.system, { id: D1.id });
  const new16 = s16b.holdings.filter((h) => h.uuid && !s16a.holdings.some((o) => o.uuid === h.uuid));
  for (const h of new16) gm.track(h.uuid, "Actor");
  note("founded (tracked)", new16.map((h) => h.uuid));
  const m16 = new16.length === 1 ? await run(gm, P.made, { uuid: new16[0].uuid }) : null;
  const of16 = new16.length === 1 ? await run(gm, P.ask, { fn: "domainOf", args: [new16[0].uuid] }) : null;
  const n16 = await run(gm, P.take);
  check("16: one new location with a market, held by Domain 1 as a settlement", new16.length === 1 && m16?.type === LOCATION && m16.hasMarket && new16[0].role === "settlement" && of16 === D1.uuid, { holding: new16[0], made: m16 && { name: m16.name, type: m16.type, hasMarket: m16.hasMarket }, domainOf: of16 });
  check("16: the founding says so, and nothing errs", n16.notes.some((n) => n.kind === "info") && n16.errors.length === 0, n16);
  await run(gm, P.closeAll);

  section("17. a domain is refused by a place and by an organisation");
  const k17a = await run(gm, P.system, { id: K.id });
  const f17a = await run(gm, P.system, { id: F.id });
  await run(gm, P.take);
  await run(gm, P.dropOnSheet, { id: K.id, uuid: D1.uuid });
  await run(gm, P.dropOnSheet, { id: F.id, uuid: D1.uuid });
  const n17 = await run(gm, P.take);
  const k17b = await run(gm, P.system, { id: K.id });
  const f17b = await run(gm, P.system, { id: F.id });
  check("17: dropped on a place's sheet and on an organisation's, a domain is refused with a warning naming it, and neither record moves", same(k17a, k17b) && same(f17a, f17b) && n17.notes.filter((n) => n.kind === "warn" && n.text.includes(`Domain 1 ${NONCE}`)).length === 2, { notes: n17.notes, placeSame: same(k17a, k17b), orgSame: same(f17a, f17b) });
  note("errors (17)", n17.errors);
  await run(gm, P.closeAll);

  section("18. a domain's token is a marker");
  // Inactive by name: core activates a new scene when none is active, which
  // pulls every seated client to it and draws its canvas under the tokens.
  const scene18 = await gm.create("Scene", { name: `Scene 1 ${NONCE}`, active: false, width: 1000, height: 600, grid: { size: 100, distance: 5, units: "ft" } });
  await run(gm, P.take);
  const m18 = await run(gm, P.markers, { sceneId: scene18.id, ids: [D1.id, F.id, K.id, R.id] });
  note("markers", m18);
  check("18: of a domain's, an organisation's, a place's and a character's tokens, only the character is an occupant", m18.tokens === 4 && m18.occupants.length === 1 && m18.occupants[0].includes(R.id), m18.occupants);
  check("18: the battle map sizes the character's token and none of the three markers", m18.sizes[D1.id] === null && m18.sizes[F.id] === null && m18.sizes[K.id] === null && m18.sizes[R.id] !== null && m18.sizes[R.id] !== "no api", m18.sizes);
  const n18 = await run(gm, P.take);
  const active18 = await gm.eval(`!!game.scenes.get(${JSON.stringify(scene18.id)})?.active`);
  check("18: the scene stays inactive and placing the tokens errs nothing", active18 === false && n18.errors.length === 0, { active: active18, errors: n18.errors });
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
