/**
 * Live walk, henchmen: henchmen + influence.
 * STAGE=1: henchmen steps 14, 15 and 16, influence steps 17–20, on the GM seat.
 * STAGE=2: henchmen steps 10, 12 (player seat), 13, 3b and 3a.
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book. Every
 * figure typed into a fixture is invented; no imported figure is printed by
 * name.
 *
 * Fixtures, kept and found again by marker (`api.fixture`), every one an
 * actor brought back at its stage's start to the shape its data creates (its
 * embedded items and effects deleted, its acks-extras flags gone, its system,
 * name and ownership the data's): stage 1 `henchmen/hall`,
 * `henchmen/employer-a`, `-b` and `-c`, `henchmen/hireling-a`, `-b` and
 * `-beast`, `henchmen/beast`, `henchmen/beast-employer`,
 * `henchmen/beast-hireling`, `henchmen/service-employer`,
 * `henchmen/service-hireling`, `henchmen/doubter`, `henchmen/novice-unread`
 * and `henchmen/novice-read` (the novices brought again to their level at
 * step 16); stage 2 `henchmen/muster-hall`, `henchmen/captain`,
 * `henchmen/paymaster`, `henchmen/exchange-town`, `henchmen/factor` and
 * `henchmen/second`. Each market is added again over its hall. The hires and
 * the chat cards are create paths: each is marked in a numbered series
 * (`henchmen/hire-b-1`, `henchmen/card-…-1`, …), and the stage retires the
 * last run's series before it builds anything.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - an `influence` override layer at priority 30 (unregistered); in
 *     stage 1 it also holds the apparent-level figure, first as an empty
 *     table that shadows the world's, then sourced as the limit's base is;
 *   - a `wages` override layer at priority 30 holding the henchman limit's
 *     base, read off the connected book through the shipped recipe, or
 *     invented where no book opens, and only where the world holds none
 *     (unregistered); in stage 1, the level-gain morale table, shadowed and
 *     then sourced the same way; in stage 2, the employer-level cap's
 *     ladder, sourced the same way;
 *   - the GM seat's own client state: the henchmen→influence integration
 *     swap, the dice rig, the patched notification methods and the wrapped
 *     ChatMessage.create (all restored);
 *   - a book connected on the GM seat with remember:false (forgotten with
 *     the page).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MOD = "acks-extras";
const STAGE = process.env.STAGE ?? "1";
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = shotDir();
const BOOKS = books(["rr","jj"]); // the GM's staged copies, from ACKS_TEST_BOOKS; empty, the walk takes the bookless path
// The chat cards each stage's create paths post, one marker series apiece (`henchmen/card-<name>-<n>`).
const STAGE1_CARDS = ["hire-b", "obedience-a", "monster-recruit", "hiring-18", "loyalty-unread", "loyalty-read", "gain-0", "gain-1", "gain-2", "gain-3"];
const STAGE2_CARDS = ["company", "porters-1", "porters-2", "posting-1", "posting-2", "posting-3", "cap"];
const POWER_IDS = ["def.prof.leadership", "def.power.bloodOfKings", "def.prof.command", "def.prof.diplomacy", "def.prof.beastFriendship", "def.power.commandOfVoice"];
// Invented hiring-offer figures for the influence document where the world holds none.
const INVENTED_OFFER = { bands: [{ max: 2 }, { min: 3, max: 5 }, { min: 6, max: 8 }, { min: 9, max: 11 }, { min: 12 }], refusalPenalty: -1, slanderPenalty: -2 };
// An invented henchman-limit base for the wages document where neither the world nor a book supplies one.
const INVENTED_LIMIT = { base: 9 };
// An invented employer-level ladder, likewise.
const INVENTED_CAP = { rungs: [{ min: 1, max: 2, cap: 1 }, { min: 3, max: 5, cap: 2 }, { min: 6, max: null, cap: 3, perLevel: 1 }] };
// An invented apparent-level figure and level-gain morale table, likewise.
const INVENTED_APPARENT = { perLevel: -3 };
const INVENTED_LEVEL_MORALE = { fromLevel: 1, fromBonus: 2, reachLevel: 4, reachBonus: 3 };

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
    importer: typeof acksExtras.importer?.connectBookUrl,
    working: acksExtras.formation?.apiVersion ?? null,
    influenceApi: acksExtras.influence?.apiVersion ?? null,
    hasInfluenceDoc: acksExtras.lib.tables.hasDoc("influence"),
    hasThrows: acksExtras.lib.tables.hasDoc("throws"),
    character: game.user.character?.id ?? null,
    canCreateActor: game.user.can("ACTOR_CREATE"),
  }),
  docs: async () => Object.fromEntries(["availability", "wages", "people", "rarity", "throws", "influence"].map((id) => [id, acksExtras.lib.tables.hasDoc(id)])),

  install: async () => {
    const H = (globalThis.__c1 = globalThis.__c1 ?? {});
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
    H.influenceApp = () => H.apps().find((a) => a.constructor?.name === "InfluenceApp" || H.root(a)?.classList?.contains("acks-influence-dialog")) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.A = acksExtras.henchmen;
    H.T = acksExtras.lib.tables;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      CB: await import(base + "importer/cookbook.mjs"),
      EX: await import(base + "importer/executor.mjs"),
      HO: await import(base + "henchmen/rules/hiring-offer.mjs"),
      EV: await import(base + "henchmen/engine/events.mjs"),
      EF: await import(base + "henchmen/effects.mjs"),
      LD: await import(base + "location/data/location-data.mjs"),
      KM: await import(base + "markets/engine/known-market.mjs"),
      MO: await import(base + "lib/money.mjs"),
      RC: await import(base + "henchmen/engine/recruitment.mjs"),
      RD: await import(base + "henchmen/apps/recruit-dialog.mjs"),
      AV: await import(base + "henchmen/rules/availability.mjs"),
      HG: await import(base + "henchmen/engine/hire-group.mjs"),
      WG: await import(base + "henchmen/rules/wages.mjs"),
      LY: await import(base + "henchmen/rules/loyalty.mjs"),
    };
    /** Click core's confirm ("yes") whenever it appears, for up to `ms`. */
    H.autoYes = async (ms = 6000) => {
      const t0 = Date.now();
      let n = 0;
      while (Date.now() - t0 < ms) {
        const b = document.querySelector('button[data-action="yes"]');
        if (b) { b.click(); n++; await H.sleep(400); } else await H.sleep(200);
      }
      return n;
    };
    H.card = (mid) => { const m = game.messages.get(mid); const div = document.createElement("div"); div.innerHTML = m?.flavor ?? ""; return { id: mid, flavor: H.text(div).slice(0, 240), rolls: (m?.rolls ?? []).map((r) => r.total), outcome: m?.flags?.["acks-extras"]?.outcome ?? null }; };
    H.sheetOf = (locationId) => H.apps().find((x) => x.actor?.id === locationId && H.root(x)?.classList?.contains("acks-extras-location-sheet")) ?? null;
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
    H.rig = (u) => {
      if (!H.rig0) H.rig0 = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => u;
    };
    H.unrig = () => { if (H.rig0) CONFIG.Dice.randomUniform = H.rig0; };
    H.ctxSummary = async (app) => {
      const c = await app._prepareContext({});
      const row = (m) => ({ key: m.key ?? null, label: m.label ?? null, value: m.value ?? null, control: m.control ?? m.kind ?? m.inputType ?? null, isUnread: !!m.isUnread, isUnvalued: !!m.isUnvalued, isEffect: !!m.isEffect, isAuto: !!m.isAuto, checked: m.checked ?? null, defaultValue: m.defaultValue ?? null, note: m.note ?? null, raw: /QA |Command|Diplomacy|refusals|Slander/i.test(m.label ?? "") ? JSON.parse(JSON.stringify(m)) : undefined });
      return {
        unreadNotice: c.unreadNotice ?? "",
        groups: (c.groups ?? []).map((g) => ({ group: g.group, mods: (g.mods ?? []).map(row) })),
        external: (c.externalModifiers ?? []).map((m) => ({ label: m.label, value: m.value ?? null, note: m.note ?? null })),
        final: c.finalModifier ?? null,
        firstModKeys: Object.keys(c.groups?.[0]?.mods?.[0] ?? {}),
        topKeys: Object.keys(c),
        subject: c.parties?.target?.name ?? null,
        modeTitle: H.text(H.root(app)?.querySelector(".influence-mode-title")),
      };
    };
    H.throwRows = (el) => [...el.querySelectorAll('[name^="mod."]')].map((i) => {
      const g = i.closest(".form-group") ?? i.parentElement;
      return { name: i.getAttribute("name"), type: i.type ?? i.tagName, checked: i.type === "checkbox" ? i.checked : null, value: i.value, disabled: i.disabled, locked: i.hasAttribute("data-locked"), label: H.text(g?.querySelector("label") ?? g).slice(0, 90), hint: (g?.querySelector("label")?.getAttribute("data-tooltip") ?? "") || H.text(g?.querySelector(".hint, .notes, p")).slice(0, 90), step: i.getAttribute("step") };
    });
    H.closeAll = async () => {
      let n = 0;
      for (const a of H.apps()) { try { await a.close({ force: true }); n++; } catch {} }
      for (const w of Object.values(ui.windows ?? {})) { try { await w.close({ force: true }); n++; } catch {} }
      return n;
    };
    return true;
  },

  /** A market on a fixture location, and the Judge's class word. */
  addMarket: async ({ locationId, classOverride }) => {
    const H = globalThis.__c1;
    const loc = game.actors.get(locationId);
    await loc.update({ "system.market": H.m.LD.emptyMarket() });
    if (classOverride) await loc.update({ "system.market.marketClassOverride": classOverride });
    return { hasMarket: !!loc.system.hasMarket, classOverride: loc.system.market?.marketClassOverride ?? null, ownershipDefault: loc.ownership?.default ?? null };
  },

  /** Connect the staged book on this seat, fired into a global. */
  connectBook: async ({ id, path }) => {
    const H = globalThis.__c1;
    if (H.m.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__c1Book = { done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__c1Book = { done: true, ok: true }; })
      .catch((e) => { globalThis.__c1Book = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__c1Book, session: !!globalThis.__c1.m.CB.cookbookSessionDoc(id) }),

  /** Build each power fresh from the cookbook (no world write), kept in a global for embedding. */
  buildPowers: async ({ ids }) => {
    const H = globalThis.__c1;
    const docs = [];
    const out = [];
    for (const id of ids) {
      const found = H.m.CB.cookbookEntry(id);
      if (!found) { out.push({ id, error: "no entry" }); continue; }
      const book = found.cb.book?.id ?? found.entry.book;
      const session = H.m.CB.cookbookSessionDoc(book);
      if (!session) { out.push({ id, error: `no session for ${book}` }); continue; }
      try {
        const node = await H.m.EX.executeEntry(session, found.cb, H.m.CB.cookbookRegisters(), id);
        const ladders = typeof H.m.CB.laddersForEntry === "function" ? await H.m.CB.laddersForEntry(found.entry, {}) : null;
        const doc = H.m.CB.bindAbility(found.entry, node, id, ladders ? { ladders } : {});
        docs.push(doc);
        const effects = doc?.flags?.["acks-extras"]?.extras?.effects ?? [];
        out.push({ id, name: doc?.name ?? null, type: doc?.type ?? null, effects: effects.map((e) => ({ type: e.type, target: e.target, value: e.value, condition: e.condition ?? null, tones: e.tones ?? null })), unaudited: !!doc?.flags?.["acks-extras"]?.extras?.unaudited });
      } catch (e) {
        out.push({ id, error: String(e?.message ?? e) });
      }
    }
    globalThis.__c1Docs = docs;
    return out;
  },
  embedPowers: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const made = await actor.createEmbeddedDocuments("Item", globalThis.__c1Docs ?? []);
    return made.map((i) => ({ id: i.id, name: i.name, type: i.type }));
  },
  /** Hand-made abilities: a name and nothing else, or one typed effect each. */
  handAbilities: async ({ actorId, items }) => {
    const actor = game.actors.get(actorId);
    const made = await actor.createEmbeddedDocuments("Item", items.map((it) => ({ name: it.name, type: "ability", ...(it.effects ? { flags: { "acks-extras": { extras: { effects: it.effects } } } } : {}) })));
    return made.map((i) => ({ id: i.id, name: i.name }));
  },
  /** What the module reads off an employer's powers. */
  powerRead: async ({ actorId }) => {
    const H = globalThis.__c1;
    const a = game.actors.get(actorId);
    const dom = (d) => H.A.effects.collectEffectModifiers(a, d).map((m) => ({ label: m.label, value: m.value, situational: !!m.situational, source: m.source ?? null }));
    const limitBase = H.m.WG.henchmanLimitBase();
    const chaMod = a.system?.scores?.cha?.mod ?? null;
    const retainBase = H.A.adapter.getRetainBase(a);
    return {
      chaMod,
      retainBase,
      baseAgrees: limitBase !== null && typeof chaMod === "number" && retainBase === limitBase + chaMod,
      retainMax: H.A.adapter.getRetainMax(a),
      retainBonus: dom("retainBonus"),
      baseLoyalty: dom("baseLoyalty"),
      hiring: dom("hiring"),
      moraleBase: dom("moraleBase"),
      henchmanMorale: dom("henchmanMorale"),
      marketClass: dom("marketClass"),
      loyaltyMods: H.m.EV.employerLoyaltyMods(a),
      unvalued: { retainBonus: H.m.EF.unvaluedPowers(a, "retainBonus"), baseLoyalty: H.m.EF.unvaluedPowers(a, "baseLoyalty"), hiring: H.m.EF.unvaluedPowers(a, "hiring"), henchmanMorale: H.m.EF.unvaluedPowers(a, "henchmanMorale"), marketClass: H.m.EF.unvaluedPowers(a, "marketClass") },
      items: a.items.map((i) => i.name),
    };
  },

  /** Link a hireling through core's own confirm, then enrol it with a wage. */
  link: async ({ employerId, hirelingId, wage }) => {
    const H = globalThis.__c1;
    const employer = game.actors.get(employerId);
    const hireling = game.actors.get(hirelingId);
    let how = "addHenchman";
    if (typeof employer.addHenchman === "function") {
      const p = employer.addHenchman(hirelingId);
      const yes = await H.poll(() => document.querySelector('button[data-action="yes"]'), { tries: 40, every: 150 });
      if (yes) yes.click();
      await Promise.race([p, H.sleep(8000)]);
      await H.poll(() => (employer.system.henchmenList ?? []).includes(hirelingId), { tries: 60, every: 200 });
    } else {
      how = "update";
      await employer.update({ "system.henchmenList": [...(employer.system.henchmenList ?? []), hirelingId] });
      await hireling.update({ "system.retainer.managerid": employerId });
    }
    await hireling.update({ "system.retainer.enabled": true, "system.retainer.wage": wage });
    try { await H.A.enrollNewcomers(employer); } catch (e) { return { how, error: String(e?.message ?? e) }; }
    return { how, linked: (employer.system.henchmenList ?? []).includes(hirelingId), manager: hireling.system?.retainer?.managerid ?? null, record: !!hireling.getFlag("acks-extras", "record") };
  },

  /** The roster window and what it says. */
  /** Open an actor's sheet as its type opens it, on the Stats tab where the sheet has one; its window's selector and whether Morale shows. */
  sheetOnStats: async ({ actorId }) => {
    const H = globalThis.__c1;
    const app = game.actors.get(actorId).sheet;
    await app.render({ force: true });
    await H.poll(() => H.root(app)?.querySelector(".window-content"));
    if (H.root(app).querySelector('[data-group="primary"][data-tab="stats"]')) app.changeTab("stats", "primary");
    await app.setPosition({ left: 16, top: 16 });
    await H.sleep(400);
    const el = H.root(app);
    // The Throws column, Morale in it, stands below the fold of a full-height sheet.
    el.querySelector('input[name="system.details.morale"]')?.closest(".acks-extras-frame__fact")?.parentElement?.scrollIntoView({ block: "start" });
    await H.sleep(300);
    return { sel: `#${el.id}`, sheet: app.constructor.name, morale: !!el.querySelector('input[name="system.details.morale"]') };
  },

  /**
   * The hireling's Service tab as rendered: every value's tooltip beside the
   * ones `buildServicePanel` builds, the Standing figures against the engine's,
   * and the loyalty figure hovered (a pointerenter dispatched on it, after a
   * hit test at its centre). `ladder` first clears the agreed and the sheet's
   * wage, so the wage is read off the table.
   */
  serviceTips: async ({ actorId, ladder = false }) => {
    const H = globalThis.__c1;
    const actor = game.actors.get(actorId);
    if (ladder) {
      const rec = actor.getFlag("acks-extras", "record") ?? {};
      await actor.update({ "system.retainer.wage": 0 });
      await actor.setFlag("acks-extras", "record", { ...rec, terms: { ...(rec.terms ?? {}), wageGp: null } });
    }
    const app = actor.sheet;
    await app.render({ force: true });
    await H.poll(() => H.root(app)?.querySelector(".window-content"));
    if (H.root(app).querySelector('[data-group="primary"][data-tab="service"]')) app.changeTab("service", "primary");
    await app.setPosition({ left: 16, top: 16 });
    const panel = await H.poll(() => H.root(app)?.querySelector(".acks-extras-service"));
    if (!panel) return { rendered: false };
    const SV = await import("/modules/acks-extras/scripts/henchmen/service-view.mjs");
    const { signed } = await import("/modules/acks-extras/scripts/lib/frame-model.mjs");
    const view = SV.buildServicePanel(actor, { isGM: game.user.isGM });
    const s = view.standing, t = view.terms, e = view.employer ?? {};
    const built = new Set([s.loyalty.tip, ...s.loyalty.parts.map((p) => p.tip), s.morale.tip, s.obedience.tip, t.wageTip, t.shareTip, t.signingTip, t.arrearsTip, e.calamitiesTip, e.levelsGainedTip, view.rolled?.scoresTip, view.rolled?.rolledTip].filter(Boolean));
    const values = [...panel.querySelectorAll(".acks-extras-frame__row-value")];
    const label = (el) => H.text(el.closest(".acks-extras-frame__row")?.querySelector(".acks-extras-frame__row-label, .acks-extras-frame__row-line")).slice(0, 40);
    const figure = (sel) => H.text(panel.querySelector(`${sel} .acks-extras-frame__row-value`)) || null;
    const employer = H.A.adapter.getManager(actor);
    const level = H.A.adapter.getWageLevel(actor);
    const ladderGp = H.m.WG.henchmanWage(level);
    const cite = H.m.WG.henchmanWageCite();
    const L = (k, d) => (d ? game.i18n.format(`ACKS-HENCHMEN.service.${k}`, d) : game.i18n.localize(`ACKS-HENCHMEN.service.${k}`));
    const moraleRow = panel.querySelector('[data-roll="morale"]');
    const target = panel.querySelector('[data-roll="loyalty"] .acks-extras-frame__row-value');
    const hover = { attr: target?.dataset.tooltipText ?? null };
    if (target) {
      target.scrollIntoView({ block: "center" });
      await H.sleep(250);
      const r = target.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      hover.hit = !!at && (at === target || target.contains(at));
      hover.hitClass = at?.className ?? null;
      target.dispatchEvent(new PointerEvent("pointerenter"));
      await H.sleep(foundry.helpers.interaction.TooltipManager.TOOLTIP_ACTIVATION_MS + 400);
      hover.active = game.tooltip.element === target;
      hover.shown = game.tooltip.tooltip?.textContent ?? null;
      target.dispatchEvent(new PointerEvent("pointerleave"));
    }
    return {
      rendered: true,
      count: values.length,
      untipped: values.filter((v) => !v.dataset.tooltipText).map(label),
      mismatched: values.filter((v) => v.dataset.tooltipText && !built.has(v.dataset.tooltipText)).map((v) => [label(v), v.dataset.tooltipText]),
      loyalty: figure('[data-roll="loyalty"]'),
      morale: figure('[data-roll="morale"]'),
      obedience: figure('[data-action="serviceObedience"]'),
      moraleScore: signed(H.m.EV.effectiveMoraleFor(actor)),
      powers: signed(H.m.EV.employerMoraleBase(employer)),
      powersLabel: L("loyaltyPowers"),
      moraleLine: H.text(moraleRow?.querySelector(".acks-extras-frame__row-line")),
      moraleTip: moraleRow?.querySelector(".acks-extras-frame__row-value")?.dataset.tooltipText ?? null,
      wageTip: [...panel.querySelectorAll(".acks-extras-frame__row")]
        .find((r) => H.text(r.querySelector(".acks-extras-frame__row-label")) === L("wage"))
        ?.querySelector(".acks-extras-frame__row-value")?.dataset.tooltipText ?? null,
      expectWageTip: ladder ? (ladderGp > 0 ? L("tip.wageLevel", { n: level, page: cite ?? L("tip.noPage") }) : L("tip.wageUnset")) : null,
      ladderGp,
      cite,
      hover,
    };
  },

  roster: async ({ actorId, keep = false, place = false }) => {
    const H = globalThis.__c1;
    const actor = game.actors.get(actorId);
    H.takeNotes();
    await H.A.openRosterApp(actor);
    // The limit rule's note carries the tooltip; the count and the max are read
    // from the context the note was formatted from, and the note is checked
    // against it, so `limit` keeps the `count / max` shape the checks compare.
    const NOTE = ".acks-extras-frame__rule-note[data-tooltip]";
    const app = await H.poll(() => { const a = H.appBy("roster-app"); return a && H.root(a)?.querySelector(NOTE) ? a : null; });
    if (!app) return { rendered: false, notes: H.takeNotes() };
    if (place) { await app.setPosition({ left: 16, top: 16 }); await H.sleep(300); }
    const el = H.root(app);
    const note = el.querySelector(NOTE);
    const tip = note?.dataset?.tooltip ?? "";
    const hintOf = (key) => tip === game.i18n.localize(key);
    const hint = ["limitHint", "limitUnknown", "limitNotImported"].find((k) => hintOf(`ACKS-HENCHMEN.roster.${k}`)) ?? null;
    const ctx = (await app._prepareContext({})).limit;
    const out = { rendered: true, limit: `${ctx.count} / ${ctx.max ?? "—"}`, noteOk: H.text(note) === ctx.note, hint, unvalued: H.text(el.querySelector("[data-unvalued]")) || null, rows: el.querySelectorAll(".acks-extras-roster__row").length, retainMax: H.A.adapter.getRetainMax(actor), gap: H.A.adapter.retainGap(actor), notes: H.takeNotes() };
    if (!keep) await app.close({ force: true });
    return out;
  },

  /** Hide the influence feature's api on this client (hostsModes() reads it), so the feature's own dialogs open; or put it back. */
  swapIntegration: async ({ hosts }) => {
    const H = globalThis.__c1;
    if (!H.inf) H.inf = acksExtras.influence;
    acksExtras.influence = hosts ? H.inf : null;
    return { hostsModes: H.A.integrations.influence.hostsModes(), hostsMoraleModes: H.A.integrations.influence.hostsMoraleModes(), hidden: !acksExtras.influence };
  },

  /** Import one ruledata document from the connected book, fired into a global. */
  importDoc: async ({ id }) => {
    const imp = acksExtras.importer;
    globalThis.__c1Import = { done: false };
    imp.cookbookImportTables([id])
      .then((r) => { globalThis.__c1Import = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId), missingBooks: r?.missingBooks ?? [] }; })
      .catch((e) => { globalThis.__c1Import = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async ({ id }) => ({ ...globalThis.__c1Import, hasDoc: globalThis.__c1.T.hasDoc(id) }),
  removeDoc: async ({ id }) => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("ruledata-import");
    if (!svc?.removeDoc) return { removed: false, reason: "no provider" };
    await svc.removeDoc(id);
    return { removed: true, hasDoc: globalThis.__c1.T.hasDoc(id) };
  },

  /** A monster hired as a henchman of a (monster) employer, through the feature's own call. */
  hireMonsterFor: async ({ monsterId, employerId }) => {
    const H = globalThis.__c1;
    const r = await H.A.hireMonster(game.actors.get(monsterId), game.actors.get(employerId));
    const emp = game.actors.get(employerId);
    return { result: r?.error ?? r?.status ?? (r ? "ok" : null), monsterList: emp.system?.monsterHenchmenList ?? null, list: emp.system?.henchmenList ?? null };
  },

  /** A candidate row written straight into the market. */
  addCandidate: async ({ locationId, row }) => {
    const loc = game.actors.get(locationId);
    const id = foundry.utils.randomID();
    const rows = [...(loc.system.market?.candidates ?? []).map((c) => (typeof c.toObject === "function" ? c.toObject() : foundry.utils.deepClone(c))), { id, status: "available", refusals: [], ...row }];
    await loc.update({ "system.market.candidates": rows });
    return { id, count: loc.system.market.candidates.length };
  },
  candidates: async ({ locationId }) => game.actors.get(locationId).system.market.candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind, status: c.status, quantity: c.quantity ?? null, refusals: (c.refusals ?? []).length, networkFor: c.networkFor || null, level: c.level ?? null })),

  /** The feature's own throw dialog for a hire (integration swapped), read and closed. */
  recruitOwn: async ({ locationId, candidateId, employerId, keep = false }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    H.A.openRecruitDialog(game.actors.get(locationId), candidateId, game.actors.get(employerId));
    const app = await H.poll(() => { const a = H.appBy("throw-dialog"); return a && H.root(a)?.querySelector('[name^="mod."]') ? a : null; });
    const notes = H.takeNotes();
    if (!app) return { opened: false, notes, influenceOpen: !!H.influenceApp() };
    const el = H.root(app);
    const out = { opened: true, title: app.title, rows: H.throwRows(el), notes };
    if (!keep) await app.close({ force: true });
    return out;
  },
  obedienceOwn: async ({ hirelingId }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    H.A.openObedienceRoll(game.actors.get(hirelingId));
    const app = await H.poll(() => { const a = H.appBy("throw-dialog"); return a && H.root(a)?.querySelector('[name^="mod."]') ? a : null; });
    const notes = H.takeNotes();
    if (!app) return { opened: false, notes, influenceOpen: !!H.influenceApp() };
    const out = { opened: true, title: app.title, rows: H.throwRows(H.root(app)), notes };
    await app.close({ force: true });
    return out;
  },

  /** An influence-hosted page, opened by the named entry, read from its context. */
  hosted: async ({ kind, locationId, candidateId, employerId, hirelingId, actorId, ctx, keep = false, place = false }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    if (kind === "recruit") H.A.openRecruitDialog(game.actors.get(locationId), candidateId, game.actors.get(employerId));
    else if (kind === "obedience") H.A.openObedienceRoll(game.actors.get(hirelingId));
    else if (kind === "loyalty") H.A.openLoyaltyRoll(game.actors.get(hirelingId));
    else if (kind === "open") acksExtras.influence.open(game.actors.get(actorId), { mode: "hiring", ctx });
    const app = await H.poll(() => { const a = H.influenceApp(); return a && H.root(a)?.querySelector('[data-action="roll"]') ? a : null; });
    const notes = H.takeNotes();
    if (!app) return { opened: false, notes, throwOpen: !!H.appBy("throw-dialog") };
    if (place) { await app.setPosition({ left: 16, top: 16 }); await H.sleep(300); }
    const el = H.root(app);
    const summary = await H.ctxSummary(app);
    const dom = {
      notice: H.text(el.querySelector(".influence-unread-notice")) || null,
      unreadBadges: el.querySelectorAll(".influence-unread-badge").length,
      typedNumbers: [...el.querySelectorAll('input[type="number"][name^="mod."]')].map((i) => i.getAttribute("name")),
      modLabels: [...el.querySelectorAll(".influence-mod-label")].map((l) => H.text(l)).slice(0, 40),
      title: app.title,
    };
    const out = { opened: true, ...summary, dom, notes };
    if (!keep) await app.close({ force: true });
    return out;
  },
  /** Press Roll on the open influence page, under a rig, and read what came of it. */
  hostedRoll: async ({ u = 0.5 }) => {
    const H = globalThis.__c1;
    const app = H.influenceApp();
    if (!app) return { found: false };
    H.takeNotes();
    H.takeChat();
    let payload = null;
    const id = Hooks.once("acksExtras.influenceRollComplete", (p) => { payload = { outcome: p?.outcome ?? null, mode: p?.mode ?? null, total: p?.total ?? p?.roll?.total ?? null, keys: Object.keys(p ?? {}) }; });
    H.rig(u);
    try {
      H.root(app).querySelector('[data-action="roll"]').click();
      await H.sleep(2500);
    } finally { H.unrig(); }
    const chat = H.takeChat();
    const cards = chat.map((mid) => { const m = game.messages.get(mid); return { id: mid, flags: m?.flags?.["acks-extras"] ?? null, text: H.text(Object.assign(document.createElement("div"), { innerHTML: m?.content ?? "" })).slice(0, 160) }; });
    return { found: true, payload, chat, cards, notes: H.takeNotes(), stillOpen: !!H.influenceApp() };
  },

  /** Tick (or clear) one checkbox row of the open influence page, by the row's key. */
  hostedTick: async ({ key, on = true }) => {
    const H = globalThis.__c1;
    const app = H.influenceApp();
    if (!app) return { found: false };
    const input = H.root(app).querySelector(`input[name="mod.${key}"]`);
    if (!input) return { found: true, input: false, names: [...H.root(app).querySelectorAll('input[name^="mod."]')].map((i) => i.name).slice(0, 30) };
    input.checked = !!on;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(400);
    const again = H.root(H.influenceApp())?.querySelector(`input[name="mod.${key}"]`);
    return { found: true, input: true, checked: again?.checked ?? null };
  },

  /** An Active Effect on an actor or on one of its items. */
  addEffect: async ({ actorId, itemId, key, value, name }) => {
    const actor = game.actors.get(actorId);
    const parent = itemId ? actor.items.get(itemId) : actor;
    const made = await parent.createEmbeddedDocuments("ActiveEffect", [{ name, changes: [{ key, mode: 2, value: String(value) }] }]);
    return { id: made[0]?.id ?? null, on: itemId ? "item" : "actor" };
  },
  removeEffect: async ({ actorId, itemId, effectId }) => {
    const actor = game.actors.get(actorId);
    const parent = itemId ? actor.items.get(itemId) : actor;
    await parent.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
    return { gone: !parent.effects.get(effectId) };
  },

  /** The influence document as the hiring code reads it, with an override layer on or off. */
  overrideInfluence: async ({ on, table }) => {
    const H = globalThis.__c1;
    if (on) H.T.registerTable({ id: "influence", tables: { hiringOffer: table } }, { priority: 30, source: "qa-c1" });
    else H.T.unregisterTable("influence", { priority: 30 });
    const offer = H.m.HO.hiringOffer();
    return { hasDoc: H.T.hasDoc("influence"), outcomes: !!offer.outcomes, refusalPenalty: offer.refusalPenalty, slanderPenalty: offer.slanderPenalty, complete: H.m.HO.hiringOfferComplete(offer) };
  },
  /** The henchman limit's base as this client reads it: whether one stands, and whether the world's own layer holds it. */
  limitRead: async () => {
    const H = globalThis.__c1;
    const world = H.T.getLayer?.("wages", H.T.PRIORITY?.WORLD ?? 20)?.tables?.henchmanLimit ?? null;
    return { known: H.m.WG.henchmanLimitBase() !== null, worldHolds: Number.isInteger(world?.base) };
  },
  /** The limit's base read off the connected book through the shipped recipe and registered at priority 30; nothing is written to the world. */
  limitFromBook: async () => {
    const H = globalThis.__c1;
    const base = "/modules/acks-extras/scripts/importer/";
    const { TABLE_RECIPES } = await import(base + "table-recipes.mjs");
    const { locatePageNumber } = await import(base + "tables-binding.mjs");
    const { extractTable } = await import(base + "table-extract.mjs");
    const { pageItems } = await import(base + "extract.mjs");
    const recipe = TABLE_RECIPES.wages.tables.henchmanLimit;
    const doc = H.m.CB.cookbookSessionDoc(recipe.book);
    if (!doc) return { read: false, reason: "book not connected" };
    const p = await locatePageNumber(doc, recipe);
    if (p == null) return { read: false, reason: "page not found" };
    const { items } = await pageItems(doc, p);
    const table = extractTable(items, recipe);
    if (!Number.isInteger(table?.base)) return { read: false, reason: "no whole figure after the anchor", keys: Object.keys(table ?? {}) };
    H.limitTable = table;
    H.T.registerTable({ id: "wages", tables: { henchmanLimit: table } }, { priority: 30, source: "qa-c1" });
    return { read: true, known: H.m.WG.henchmanLimitBase() !== null };
  },
  /** The priority-30 limit layer on or off; on, `table` or the one last read off the book. */
  overrideLimit: async ({ on, table }) => {
    const H = globalThis.__c1;
    if (table) H.limitTable = table;
    if (on) H.T.registerTable({ id: "wages", tables: { henchmanLimit: H.limitTable } }, { priority: 30, source: "qa-c1" });
    else H.T.unregisterTable("wages", { priority: 30 });
    return { known: H.m.WG.henchmanLimitBase() !== null };
  },
  /**
   * Whether the open posting dialog's level options, the location's month-roll
   * henchman segments and a general posting's segments each name exactly the
   * levels of the availability rows this client reads. Booleans only.
   */
  levelsRead: async ({ locationId }) => {
    const H = globalThis.__c1;
    const rows = H.T.getDoc("availability")?.tables?.henchmanAvailability?.rows ?? [];
    const want = [...new Set(rows.filter((r) => r?.__missing !== true && Number.isInteger(r?.level)).map((r) => r.level))].sort((a, b) => a - b).join(",");
    const el = H.root(H.appBy("posting-dialog"));
    const kind = el?.querySelector('select[name="kind"]');
    if (kind) { kind.value = "henchman"; kind.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(150); }
    const options = [...(el?.querySelectorAll('select[name="level"] option') ?? [])].filter((o) => o.value !== "").map((o) => Number(o.value)).join(",");
    const rolled = [...new Set((game.actors.get(locationId).system.market?.marketRolls ?? []).map((r) => r.segment).filter((s) => /^henchman:\d+$/.test(s)).map((s) => Number(s.split(":")[1])))].sort((a, b) => a - b).join(",");
    const reached = H.m.AV.postingSegments("henchman:*").map((s) => Number(s.split(":")[1])).join(",");
    return { rows: rows.length > 0, options: !!el && options === want, rolled: rolled === want, reached: reached === want };
  },
  /** The employer-level cap as this client reads it: whether any level has one, and whether the world's own layer holds the ladder. */
  capRead: async () => {
    const H = globalThis.__c1;
    const world = H.T.getLayer?.("wages", H.T.PRIORITY?.WORLD ?? 20)?.tables?.employerLevelCap ?? null;
    let known = false;
    for (let l = 0; l <= 30 && !known; l++) known = H.m.WG.maxHenchmanLevel(l) !== null;
    return { known, worldHolds: Array.isArray(world?.rungs) };
  },
  /** The employer-level ladder read off the connected book through the shipped recipe and kept for `overrideCap`; nothing is registered or written. */
  capFromBook: async () => {
    const H = globalThis.__c1;
    const base = "/modules/acks-extras/scripts/importer/";
    const { TABLE_RECIPES } = await import(base + "table-recipes.mjs");
    const { locatePageNumber } = await import(base + "tables-binding.mjs");
    const { extractTable } = await import(base + "table-extract.mjs");
    const { pageItems } = await import(base + "extract.mjs");
    const recipe = TABLE_RECIPES.wages.tables.employerLevelCap;
    const doc = H.m.CB.cookbookSessionDoc(recipe.book);
    if (!doc) return { read: false, reason: "book not connected" };
    const p = await locatePageNumber(doc, recipe);
    if (p == null) return { read: false, reason: "page not found" };
    const { items } = await pageItems(doc, p);
    const table = extractTable(items, recipe);
    if (!Array.isArray(table?.rungs) || table.rungs.at(-1)?.max !== null) return { read: false, reason: "no ladder ending in an open rung", keys: Object.keys(table ?? {}) };
    H.capTable = table;
    return { read: true };
  },
  /**
   * The ladder on or off in the priority-30 `wages` layer, which also holds
   * the limit's base where this walk registered one; on, `table` or the
   * ladder last read off the book.
   */
  overrideCap: async ({ on, table }) => {
    const H = globalThis.__c1;
    if (table) H.capTable = table;
    const tables = { ...(H.limitTable ? { henchmanLimit: H.limitTable } : {}), ...(on && H.capTable ? { employerLevelCap: H.capTable } : {}) };
    if (Object.keys(tables).length) H.T.registerTable({ id: "wages", tables }, { priority: 30, source: "qa-c1" });
    else H.T.unregisterTable("wages", { priority: 30 });
    let known = false;
    for (let l = 0; l <= 30 && !known; l++) known = H.m.WG.maxHenchmanLevel(l) !== null;
    return { known };
  },
  /**
   * The levels the cap step types, chosen in page against the ladder this
   * client reads and the open posting dialog's level options: a presented
   * level whose cap is at least one, below the highest option and below a
   * domain ruler's bound, and the open rung's floor plus one. They are typed
   * into the dialog and never printed.
   */
  capPlan: async () => {
    const H = globalThis.__c1;
    const cap = (l, ruler = false) => H.m.WG.maxHenchmanLevel(l, ruler);
    const el = H.root(H.appBy("posting-dialog"));
    const options = [...(el?.querySelectorAll('select[name="level"] option') ?? [])].map((o) => o.value).filter((v) => v !== "").map(Number);
    const top = options.length ? Math.max(...options) : null;
    let presented = null;
    for (let l = 1; l <= 30 && presented === null && top !== null; l++) {
      const c = cap(l);
      if (c !== null && c >= 1 && c < top && c + 1 <= cap(l, true)) presented = l;
    }
    const open = (H.T.getDoc("wages")?.tables?.employerLevelCap?.rungs ?? []).find((r) => r?.max === null);
    const above = open ? open.min + 1 : null;
    return {
      presented,
      at: presented === null ? null : cap(presented),
      top,
      above,
      openRises: !!open && Number.isInteger(open.perLevel) && cap(above) === open.cap + open.perLevel,
      openAdmitsTop: above !== null && cap(above) !== null && top <= cap(above),
    };
  },
  /**
   * Submit the open posting dialog as a henchman search at `level`, presenting
   * `presented` and ticking Domain ruler as named. Whether a posting landed,
   * whether the error raised is the level-cap one at `cap`, and the chat made.
   */
  postingLeveled: async ({ locationId, employerId, level, presented, ruler = false, cap = null }) => {
    const H = globalThis.__c1;
    const app = H.appBy("posting-dialog");
    if (!app) return { found: false };
    const el = H.root(app);
    const count = () => (game.actors.get(locationId).system.market?.postings ?? []).length;
    const before = count();
    const set = (sel, v) => {
      const f = el.querySelector(sel);
      if (!f) return false;
      if (f.type === "checkbox") f.checked = !!v;
      else f.value = String(v);
      f.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    set('select[name="kind"]', "henchman");
    await H.sleep(150);
    const fields = { level: set('select[name="level"]', level), presented: set('input[name="presentedLevel"]', presented), ruler: set('input[name="domainRuler"]', ruler) };
    set('input[name="network"]', false);
    H.takeNotes(); H.takeChat();
    (el.querySelector('button[type="submit"]') ?? el.querySelector("form button")).click();
    await H.poll(() => (H.notes.length ? true : null), { tries: 80, every: 250 });
    await H.sleep(1000);
    const notes = H.takeNotes();
    const capText = cap === null ? null : game.i18n.format("ACKS-HENCHMEN.posting.levelCapError", { employer: game.actors.get(employerId)?.name, level, cap });
    return { found: true, fields, landed: count() === before + 1, capError: notes.some((n) => n.kind === "error" && n.text === capText), noteKinds: notes.map((n) => n.kind), chat: H.takeChat() };
  },
  /** Pin an employer's limit at `to` through the manual flag; returns what the limit then reads. */
  pinLimit: async ({ actorId, to }) => {
    const H = globalThis.__c1;
    const a = game.actors.get(actorId);
    const max = H.A.adapter.getRetainMax(a);
    if (max === null) return { pinned: false, retainMax: null };
    const flag = Number(a.getFlag("acks-extras", "retainBonus") ?? 0);
    await a.setFlag("acks-extras", "retainBonus", flag + (to - max));
    return { pinned: true, retainMax: H.A.adapter.getRetainMax(a) };
  },
  offerRead: async () => {
    const H = globalThis.__c1;
    const offer = H.m.HO.hiringOffer();
    return { hasDoc: H.T.hasDoc("influence"), outcomes: !!offer.outcomes, bands: offer.outcomes?.outcomes?.length ?? 0, refusalPenalty: offer.refusalPenalty, slanderPenalty: offer.slanderPenalty, complete: H.m.HO.hiringOfferComplete(offer) };
  },

  /** A peaceful offer to a monster: the feature's own throw dialog, read; rolled when asked. */
  monsterRecruit: async ({ monsterId, employerId, roll = false, keep = false, place = false, u = 0.5 }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    H.takeChat();
    H.A.recruitMonster(game.actors.get(monsterId), game.actors.get(employerId));
    const app = await H.poll(() => { const a = H.appBy("throw-dialog"); return a && H.root(a)?.querySelector('[name^="mod."]') ? a : null; }, { tries: 20 });
    const notes = H.takeNotes();
    if (!app) return { opened: false, notes };
    if (place) { await app.setPosition({ left: 16, top: 16 }); await H.sleep(300); }
    const el = H.root(app);
    const out = { opened: true, title: app.title, rows: H.throwRows(el), notes, stepValues: app.context?.stepValues ?? null, info: H.text(el.querySelector(".throw-info, .info, p")).slice(0, 120) };
    if (roll) {
      H.rig(u);
      try {
        (el.querySelector('button[type="submit"]') ?? el.querySelector("form button")).click();
        await H.sleep(2500);
      } finally { H.unrig(); }
      const chat = H.takeChat();
      out.chat = chat;
      out.cards = chat.map((mid) => { const m = game.messages.get(mid); return { id: mid, outcome: m?.flags?.["acks-extras"]?.outcome ?? null, flagKeys: Object.keys(m?.flags?.["acks-extras"] ?? {}), text: H.text(Object.assign(document.createElement("div"), { innerHTML: m?.content ?? "" })).slice(0, 140) }; });
      out.notesAfter = H.takeNotes();
      out.stillOpen = !!H.appBy("throw-dialog");
    } else if (!keep) await app.close({ force: true });
    return out;
  },

  /** The world's limit policy; `set` flips it for one check (the original is kept for the restore). */
  limitPolicy: async ({ set } = {}) => {
    const H = globalThis.__c1;
    const before = game.settings.get("acks-extras", "enforceHenchmanLimit");
    if (set && set !== before) { if (H.policy0 === undefined) H.policy0 = before; await game.settings.set("acks-extras", "enforceHenchmanLimit", set); }
    return { before, now: game.settings.get("acks-extras", "enforceHenchmanLimit") };
  },
  limitPolicyRestore: async () => {
    const H = globalThis.__c1 ?? {};
    if (H.policy0 === undefined) return { restored: false, reason: "never changed" };
    await game.settings.set("acks-extras", "enforceHenchmanLimit", H.policy0);
    const now = game.settings.get("acks-extras", "enforceHenchmanLimit");
    const out = { restored: now === H.policy0, now };
    delete H.policy0;
    return out;
  },

  /** Submit the open throw dialog under a rig (with a misc adjustment typed); the notes and cards it raised, and the employer's new hirelings. */
  ownRoll: async ({ u = 0.02, misc = null, employerId }) => {
    const H = globalThis.__c1;
    const app = H.appBy("throw-dialog");
    if (!app) return { found: false };
    const employer = game.actors.get(employerId);
    const before = new Set(employer?.system?.henchmenList ?? []);
    const el = H.root(app);
    if (misc != null) { const m = el.querySelector('input[name="mod.misc"]'); if (m) { m.value = String(misc); m.dispatchEvent(new Event("input", { bubbles: true })); m.dispatchEvent(new Event("change", { bubbles: true })); } }
    H.takeNotes(); H.takeChat();
    H.rig(u);
    try {
      (el.querySelector('button[type="submit"]') ?? el.querySelector("form button")).click();
      await H.sleep(600);
    } finally { H.unrig(); }
    const yes = await H.autoYes(6000);
    await H.poll(() => (H.notes.some((n) => /Leadership/.test(n.text)) ? true : null), { tries: 30, every: 250 });
    await H.sleep(800);
    const chat = H.takeChat();
    const newIds = (game.actors.get(employerId)?.system?.henchmenList ?? []).filter((id) => !before.has(id));
    return { found: true, confirms: yes, notes: H.takeNotes(), chat, cards: chat.map(H.card), newIds, stillOpen: !!H.appBy("throw-dialog") };
  },

  /** Give a user ownership of an actor (from the GM seat). */
  own: async ({ actorId, userId, level = 3 }) => { const a = game.actors.get(actorId); await a.update({ ownership: { ...a.ownership, [userId]: level } }); return { ownership: a.ownership }; },

  /**
   * A kept actor put back in the shape `data` creates: its embedded items and
   * effects deleted, its acks-extras flags the data's, its system the data's
   * over the type's defaults (arrays and lists included), its name, and its
   * ownership the data's with this seat's own kept. A place also takes what
   * its create hook (location/module.mjs) gives a new one: the storage flag,
   * and the table as OWNER where the data names no default. Returns what it
   * then holds.
   */
  reshape: async ({ id, data }) => {
    const a = game.actors.get(id);
    const before = { ...a.ownership };
    if (a.items.size) await a.deleteEmbeddedDocuments("Item", a.items.map((i) => i.id));
    if (a.effects.size) await a.deleteEmbeddedDocuments("ActiveEffect", a.effects.map((e) => e.id));
    const fresh = new Actor.implementation({ name: data.name, type: data.type, system: foundry.utils.deepClone(data.system ?? {}) }).toObject();
    const place = data.type === "acks-extras.location";
    const flags = foundry.utils.deepClone(data.flags?.["acks-extras"] ?? {});
    if (place && !flags.storage) flags.storage = { provider: true };
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const ownership = { default: place ? L.OWNER : L.NONE, ...(data.ownership ?? {}), [game.user.id]: L.OWNER };
    await a.update({ name: data.name, system: fresh.system, "flags.acks-extras": new foundry.data.operators.ForcedDeletion() });
    if (Object.keys(flags).length) await a.update({ "flags.acks-extras": flags });
    await a.update({ ownership }, { diff: false, recursive: false });
    return { name: a.name, items: a.items.size, effects: a.effects.size, flags: Object.keys(a.flags["acks-extras"] ?? {}), henchmen: (a.system.henchmenList ?? []).length, monsters: (a.system.monsterHenchmenList ?? []).length, managerid: a.system.retainer?.managerid ?? null, retainer: !!a.system.retainer?.enabled, before, wrote: ownership, holds: { ...a.ownership }, market: !!a.system.market };
  },

  /** Coin on an actor: mint some, and read what it can spend. */
  reloadDocs: async () => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("ruledata-import");
    if (svc?.reload) await svc.reload();
    return { reloaded: !!svc?.reload, hasInfluence: globalThis.__c1.T.hasDoc("influence") };
  },
  settingRead: async ({ key }) => ({ key, value: game.settings.get("acks-extras", key) }),
  processNow: async ({ locationId }) => { const r = await globalThis.__c1.m.RC.processLocation(game.actors.get(locationId)); return { changed: !!r?.changed, arrived: r?.arrived ?? null }; },
  coin: async ({ actorId, mint = 0 }) => {
    const H = globalThis.__c1;
    const a = game.actors.get(actorId);
    if (mint) await H.m.MO.mintCoin(a, mint);
    return { gp: H.m.MO.spendableGp(a) };
  },

  /** The location sheet on this seat, on a tab; the candidate rows that tab draws. */
  sheetRows: async ({ locationId, tab }) => {
    const H = globalThis.__c1;
    const loc = game.actors.get(locationId);
    await loc.sheet.render(true);
    const app = await H.poll(() => { const a = H.sheetOf(locationId); return a && H.root(a)?.querySelector("nav.tabs") ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { opened: false };
    const el = H.root(app);
    const nav = el.querySelector(`nav.tabs a[data-tab="${tab}"]`);
    if (nav) { nav.click(); await H.sleep(500); }
    const sec = H.root(H.sheetOf(locationId))?.querySelector(`section[data-tab="${tab}"]`);
    const rows = [...(sec?.querySelectorAll("tr[data-candidate-id]") ?? [])].map((tr) => ({ id: tr.dataset.candidateId, text: H.text(tr).slice(0, 80), recruit: !!tr.querySelector('a[data-action="recruit"]') }));
    return { opened: true, tabFound: !!nav, tabs: [...el.querySelectorAll("nav.tabs a[data-tab]")].map((a) => a.dataset.tab), rows, hireGroup: !!sec?.querySelector('[data-action="hireGroup"]') };
  },

  /** Press Hire as Group on the open sheet's Mercenaries tab, answer the employer prompt, take `count` of a troop row, press Hire the unit — or, where the seat's own character would be picked, read the dialog, close it, and call the engine for the employer. */
  hireGroup: async ({ locationId, employerId, candidateId, count, direct = false }) => {
    const H = globalThis.__c1;
    const loc = game.actors.get(locationId);
    const employer = game.actors.get(employerId);
    const groupsBefore = new Set(game.actors.filter((a) => a.type === "acks-extras.group").map((a) => a.id));
    const actorsBefore = new Set(game.actors.map((a) => a.id));
    const pick = (o) => (o ? { level: o.system?.details?.level ?? null, cls: o.system?.details?.class ?? null, hd: o.system?.hp?.hd ?? null, str: o.system?.scores?.str?.value ?? null, items: (o.items ?? []).length } : null);
    H.takeNotes(); H.takeChat();
    const btn = H.root(H.sheetOf(locationId))?.querySelector('section[data-tab="mercenaries"] [data-action="hireGroup"]');
    if (!btn) return { pressed: false };
    btn.click();
    const first = await H.poll(() => document.querySelector('.application.dialog select[name="employerId"], .application.dialog input[name^="q_"]'), { tries: 40, every: 200 });
    let employerPrompt = false;
    if (first?.matches('select[name="employerId"]')) {
      employerPrompt = true;
      first.value = employerId; first.dispatchEvent(new Event("change", { bubbles: true }));
      first.closest(".application").querySelector('button[data-action="ok"]').click();
    }
    const q = await H.poll(() => document.querySelector(`.application.dialog input[name="q_${candidateId}"]`), { tries: 40, every: 200 });
    if (!q) return { pressed: true, employerPrompt, groupDialog: false, notes: H.takeNotes() };
    const root = q.closest(".application");
    const forLine = H.text(root.querySelector(".acks-henchmen-hire-group p"));
    const cells = [...root.querySelectorAll('input[name^="q_"]')].map((i) => ({ name: i.name, cap: i.dataset.cap, max: i.max }));
    const officer = !!root.querySelector('select[name="officer"]');
    let how = "dialog";
    if (direct) {
      how = "engine";
      const dlg = H.apps().find((a) => H.root(a) === root);
      if (dlg) await dlg.close({ force: true }); else root.querySelector('[data-action="close"]')?.click();
      await H.sleep(300);
      await H.m.HG.hireAsGroup(loc, employer, { troops: [{ candidateId, quantity: count }] });
    } else {
      q.value = String(count); q.dispatchEvent(new Event("input", { bubbles: true }));
      const okBtn = [...root.querySelectorAll("button")].find((b) => /Hire the unit/.test(H.text(b))) ?? root.querySelector('button[data-action="ok"]');
      okBtn.click();
    }
    const group = await H.poll(() => game.actors.find((a) => a.type === "acks-extras.group" && !groupsBefore.has(a.id) && a.system?.unit?.employerUuid === employer.uuid && (a.system.stacks ?? []).length) ?? null, { tries: 60, every: 300 });
    await H.sleep(1000);
    const stacks = (group?.system?.stacks ?? []).map((st) => ({ key: st.key, count: st.size?.current ?? null, label: st.template?.label ?? null, uuid: st.template?.uuid ?? null, snap: pick(st.template?.snapshot) }));
    const protoDoc = stacks[0]?.uuid ? await fromUuid(stacks[0].uuid).catch(() => null) : null;
    const proto = protoDoc ? { id: protoDoc.id, ...pick(protoDoc.toObject()), items: protoDoc.items.size } : null;
    const rows = (loc.system.candidates ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status, quantity: c.quantity ?? null }));
    const newActors = game.actors.filter((a) => !actorsBefore.has(a.id)).map((a) => ({ id: a.id, type: a.type, name: a.name }));
    return { pressed: true, how, employerPrompt, forLine, cells, officer, group: group ? { id: group.id, name: group.name } : null, stacks, proto, rows, newActors, chat: H.takeChat(), notes: H.takeNotes() };
  },

  /** Press a row's Hire button on the open sheet's Specialists tab (or call the API naming the employer), answer the heads prompt, and read the hosted page. */
  bulkOffer: async ({ locationId, candidateId, employerId, heads, viaApi = false }) => {
    const H = globalThis.__c1;
    const loc = game.actors.get(locationId);
    H.takeNotes();
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    if (viaApi) H.A.openRecruitDialog(loc, candidateId, game.actors.get(employerId));
    else {
      const a = H.root(H.sheetOf(locationId))?.querySelector(`section[data-tab="specialists"] tr[data-candidate-id="${candidateId}"] a[data-action="recruit"]`);
      if (!a) return { pressed: false, notes: H.takeNotes() };
      a.click();
    }
    const first = await H.poll(() => document.querySelector('.application.dialog select[name="employerId"], .application.dialog input[name="heads"]'), { tries: 40, every: 200 });
    let employerPrompt = false;
    if (first?.matches('select[name="employerId"]')) { employerPrompt = true; first.value = employerId; first.dispatchEvent(new Event("change", { bubbles: true })); first.closest(".application").querySelector('button[data-action="ok"]').click(); }
    const input = await H.poll(() => document.querySelector('.application.dialog input[name="heads"]'), { tries: 40, every: 200 });
    if (!input) return { pressed: true, employerPrompt, headsPrompt: null, notes: H.takeNotes(), influenceOpen: !!H.influenceApp() };
    const prompt = { title: H.text(input.closest(".application").querySelector(".window-title")), max: input.max, def: input.value };
    input.value = String(heads); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    input.closest(".application").querySelector('button[data-action="ok"]').click();
    const app = await H.poll(() => { const a = H.influenceApp(); return a && H.root(a)?.querySelector('[data-action="roll"]') ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { pressed: true, employerPrompt, headsPrompt: prompt, opened: false, notes: H.takeNotes() };
    const ctx = await H.ctxSummary(app);
    const bonus = H.root(app).querySelector('select[name="mod.signingBonus"]');
    const options = bonus ? [...bonus.options].map((o) => ({ value: o.value, label: o.textContent.trim() })) : [];
    return { pressed: true, employerPrompt, headsPrompt: prompt, opened: true, subject: ctx.subject, title: app.title, options, notes: H.takeNotes() };
  },

  /** Choose a signing-bonus tier on the open hosted page and Roll under a cycling rig; wait for the heads card and the hire. */
  bulkRoll: async ({ tier = null, seq, waitFor = 5 }) => {
    const H = globalThis.__c1;
    const app = H.influenceApp();
    if (!app) return { found: false };
    const el = H.root(app);
    const bonus = el.querySelector('select[name="mod.signingBonus"]');
    if (bonus && tier != null) { bonus.value = String(tier); bonus.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(300); }
    H.takeNotes(); H.takeChat();
    let payload = null;
    Hooks.once("acksExtras.influenceRollComplete", (p) => { payload = { outcome: p?.outcome ?? null, natural: p?.natural ?? null, total: p?.total ?? null, heads: p?.context?.heads ?? null }; });
    let i = 0;
    if (!H.rig0) H.rig0 = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => seq[i++ % seq.length];
    try {
      (H.root(H.influenceApp()) ?? el).querySelector('[data-action="roll"]').click();
      await H.poll(() => (H.chat.some((mid) => (game.messages.get(mid)?.rolls?.length ?? 0) >= waitFor) ? true : null), { tries: 60, every: 250 });
    } finally { H.unrig(); }
    const yes = await H.autoYes(8000);
    await H.sleep(1500);
    const chat = H.takeChat();
    return { found: true, payload, draws: i, confirms: yes, chat, cards: chat.map(H.card), notes: H.takeNotes(), stillOpen: !!H.influenceApp() };
  },

  /** The rows of one bulk name on a market, the slander count, and the queue. */
  rowsOf: async ({ locationId, name, employerId }) => {
    const loc = game.actors.get(locationId);
    const emp = game.actors.get(employerId);
    const rows = (loc.system.candidates ?? []).filter((c) => c.name === name).map((c) => ({ id: c.id, status: c.status, quantity: c.quantity ?? null, refusals: (c.refusals ?? []).map((r) => ({ employer: r.employerUuid === emp?.uuid, result: r.result })) }));
    return { rows, slander: (loc.system.market?.slander ?? []).length, pending: (loc.system.market?.pendingHires ?? []).length };
  },
  hiredOf: async ({ employerId }) => ({ actors: game.actors.filter((a) => a.type === "character" && a.system?.retainer?.managerid === employerId).map((a) => ({ id: a.id, name: a.name, quantity: a.system.retainer.quantity ?? null, loyalty: a.system.retainer.loyalty ?? null, category: a.system.retainer.category ?? null })) }),
  materialize: async ({ locationId }) => { await globalThis.__c1.m.RD.materializePendingHires(game.actors.get(locationId)); return { pending: (game.actors.get(locationId).system.market?.pendingHires ?? []).length }; },
  /** Bring a chat card into view for a shot. */
  showCard: async ({ id, frame = "content" }) => {
    try { ui.sidebar.changeTab?.("chat", "primary"); } catch {}
    try { ui.sidebar.expand?.(); } catch {}
    await globalThis.__c1.sleep(400);
    // The "card" frame is always a staged copy: a plate of the whole card keeps the flavor line, and the copy is what loses the whisper list and the stamp.
    let el = frame === "card" ? null : document.querySelector(`[data-message-id="${id}"]`);
    let staged = false;
    if (!el) {
      const m = game.messages.get(id);
      if (!m) return { found: false, message: false };
      const html = await (typeof m.renderHTML === "function" ? m.renderHTML() : m.getHTML());
      el = html?.[0] ?? html;
      el.dataset.qaStaged = "1";
      // A world's user names never enter a plate: the whisper list names them, and the stamp dates the shot.
      if (frame === "card") for (const n of el.querySelectorAll(".whisper-to, .message-metadata")) n.remove();
      let log = null;
      {
        const box = document.createElement("section");
        box.id = "qa-card-stage";
        box.className = "chat-sidebar sidebar-tab active";
        box.style.cssText = "position:fixed;left:16px;top:16px;width:340px;z-index:9999;padding:8px;background:var(--color-cool-5,#1b1b1b)";
        log = document.createElement("ol");
        log.className = "chat-log";
        box.append(log);
        document.body.append(box);
      }
      log.append(el);
      el.style.display = "";
      staged = true;
    }
    el?.scrollIntoView({ block: "center" });
    await globalThis.__c1.sleep(400);
    return { found: !staged, staged, content: !!el?.querySelector(".message-content") };
  },
  unstageCard: async () => {
    const n = document.querySelectorAll("[data-qa-staged]").length;
    for (const el of document.querySelectorAll("[data-qa-staged]")) el.remove();
    document.getElementById("qa-card-stage")?.remove();
    return { removed: n };
  },

  /** An ability item carrying one typed modifier row, and what the henchmen feature reads off it. */
  addTypedPower: async ({ actorId, name, target, flat, condition }) => {
    const H = globalThis.__c1;
    const a = game.actors.get(actorId);
    const made = await a.createEmbeddedDocuments("Item", [{ name, type: "ability", flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target, value: { kind: "flat", flat }, condition }] } } } }]);
    return { id: made[0]?.id ?? null, has: H.m.EF.hasEffectFlag(a, target), mods: H.m.EF.collectEffectModifiers(a, target).map((m) => ({ value: m.value, situational: !!m.situational })) };
  },
  known: async ({ actorId, locationId, known }) => {
    const r = await acksExtras.markets.setMarketKnown(game.actors.get(actorId), game.actors.get(locationId), known);
    return { ...r, knownTo: !!acksExtras.markets.marketKnownTo(game.actors.get(locationId), game.actors.get(actorId)) };
  },
  /** Open the posting dialog (or use the open one), pick an employer, and read the network row. */
  postingOpen: async ({ locationId, employerId, place = false }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    let app = H.appBy("posting-dialog");
    if (!app) { H.A.openPostingDialog(game.actors.get(locationId)); app = await H.poll(() => { const a = H.appBy("posting-dialog"); return a && H.root(a)?.querySelector('select[name="employerId"]') ? a : null; }, { tries: 40, every: 200 }); }
    if (!app) return { opened: false, notes: H.takeNotes() };
    if (place) { await app.setPosition({ left: 16, top: 16 }); await H.sleep(200); }
    const el = H.root(app);
    const sel = el.querySelector('select[name="employerId"]');
    sel.value = employerId; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(250);
    const field = el.querySelector("[data-network-field]"), box = el.querySelector('input[name="network"]'), status = el.querySelector("p[data-network-status]");
    const emp = game.actors.get(employerId);
    const found = sel.value === employerId;
    // Where the employer is not offered, what the dialog's employer filter reads of it.
    const why = found ? null : { options: sel.options.length, playerOwned: !!emp?.hasPlayerOwner, retainer: !!emp?.system?.retainer?.enabled, type: emp?.type ?? null };
    return { opened: true, employerFound: found, why, optionNetwork: sel.selectedOptions[0]?.dataset.network ?? null, fieldShown: !!field && field.style.display !== "none", checked: box?.checked ?? null, status: status && status.style.display !== "none" ? H.text(status) : "", notes: H.takeNotes() };
  },
  /** Submit the open posting dialog with a kind and the network box as named; the notes and the fee card. */
  postingSubmit: async ({ kind, network }) => {
    const H = globalThis.__c1;
    const app = H.appBy("posting-dialog");
    if (!app) return { found: false };
    const el = H.root(app);
    const kindSel = el.querySelector('select[name="kind"]'); kindSel.value = kind; kindSel.dispatchEvent(new Event("change", { bubbles: true }));
    const box = el.querySelector('input[name="network"]'); if (box) { box.checked = !!network; box.dispatchEvent(new Event("change", { bubbles: true })); }
    H.takeNotes(); H.takeChat();
    (el.querySelector('button[type="submit"]') ?? el.querySelector("form button")).click();
    await H.poll(() => (H.notes.length ? true : null), { tries: 80, every: 250 });
    await H.sleep(1500);
    const chat = H.takeChat();
    return { found: true, notes: H.takeNotes(), chat, cards: chat.map(H.card), stillOpen: !!H.appBy("posting-dialog") };
  },
  /** The market's postings, network rolls and candidates as they stand; the fee card's formula is compared with a class's and never printed. */
  marketRead: async ({ locationId, employerId, feeCardFlavor = "", feeClass = null }) => {
    const H = globalThis.__c1;
    const loc = game.actors.get(locationId);
    const m = loc.system.market;
    const emp = game.actors.get(employerId);
    const postings = (m.postings ?? []).map((p) => ({ id: p.id, status: p.status, segment: p.segment, network: !!p.network, totalAvailable: p.totalAvailable, employer: p.employerUuid === emp?.uuid, fees: (p.feesPaid ?? []).length }));
    const networkRolls = (m.networkRolls ?? []).map((r) => ({ employer: r.employerUuid === emp?.uuid, segment: r.segment, month: r.monthStartTime === m.monthAnchorTime, marketClass: r.marketClass, total: r.total }));
    const marketRolls = (m.marketRolls ?? []).map((r) => ({ segment: r.segment, total: r.total }));
    const candidates = (loc.system.candidates ?? []).map((c) => ({ id: c.id, segment: c.segment, status: c.status, networkFor: c.networkFor === emp?.uuid ? "employer" : (c.networkFor || null) }));
    const feeMatches = {};
    for (const mc of [1, 2, 3, 4, 5, 6]) { try { feeMatches[mc] = feeCardFlavor.includes(`(${H.m.AV.searchFeeFormula(mc)} gp)`); } catch (e) { feeMatches[mc] = String(e?.message ?? e); } }
    return { marketClass: loc.system.marketClass, effective: H.m.RC.effectiveMarketClass(loc, emp), anchor: m.monthAnchorTime ?? null, postings, networkRolls, marketRolls, candidates, feeMatches, feeClass };
  },
  closePosting: async ({ locationId, postingId }) => {
    const r = await globalThis.__c1.m.RC.closePosting(game.actors.get(locationId), postingId);
    return { result: r ?? null, status: (game.actors.get(locationId).system.market.postings ?? []).find((p) => p.id === postingId)?.status ?? null };
  },
  recruitWarn: async ({ locationId, candidateId, employerId }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    const synced = await H.poll(() => game.actors.get(locationId)?.system?.candidates?.find((c) => c.id === candidateId)?.status === "available" || null, { tries: 50, every: 200 });
    H.takeNotes();
    await H.A.openRecruitDialog(game.actors.get(locationId), candidateId, game.actors.get(employerId));
    await H.sleep(1000);
    return { synced: !!synced, notes: H.takeNotes(), influenceOpen: !!H.influenceApp(), throwOpen: !!H.appBy("throw-dialog") };
  },

  /** Whether this client reads the apparent-level figure and the level-gain morale rungs, and whether the world's own layer holds each. */
  printedRead: async () => {
    const H = globalThis.__c1;
    const W = H.T.PRIORITY?.WORLD ?? 20;
    return {
      apparentKnown: H.m.LY.apparentLevelPenalty() !== null,
      apparentWorld: Number.isInteger(H.T.getLayer?.("influence", W)?.tables?.apparentLevel?.perLevel),
      levelKnown: H.m.WG.levelMoraleRungs().length > 0,
      levelWorld: !!H.T.getLayer?.("wages", W)?.tables?.levelMorale,
    };
  },
  /** One shipped recipe's table read off the connected book and kept in page; nothing is registered or written. */
  recipeFromBook: async ({ doc, id }) => {
    const H = globalThis.__c1;
    const base = "/modules/acks-extras/scripts/importer/";
    const { TABLE_RECIPES } = await import(base + "table-recipes.mjs");
    const { locatePageNumber } = await import(base + "tables-binding.mjs");
    const { extractTable } = await import(base + "table-extract.mjs");
    const { pageItems } = await import(base + "extract.mjs");
    const recipe = TABLE_RECIPES[doc].tables[id];
    const book = H.m.CB.cookbookSessionDoc(recipe.book);
    if (!book) return { read: false, reason: "book not connected" };
    const p = await locatePageNumber(book, recipe);
    if (p == null) return { read: false, reason: "page not found" };
    const { items } = await pageItems(book, p);
    const table = extractTable(items, recipe);
    const keys = recipe.values.map((v) => v.key);
    if (!keys.every((k) => Number.isInteger(table?.[k]))) return { read: false, reason: "a figure is missing", keys: Object.keys(table ?? {}) };
    (H.fromBook ??= {})[`${doc}.${id}`] = table;
    return { read: true };
  },
  /**
   * One table of a document's priority-30 layer, keeping whatever else the
   * walk holds there: `table` null takes it out, `{}` shadows the world's,
   * `{fromBook: true}` is the table last read off the book.
   */
  layerTable: async ({ doc, id, table }) => {
    const H = globalThis.__c1;
    const { [id]: _drop, ...rest } = H.T.getLayer(doc, 30)?.tables ?? {};
    const put = table?.fromBook ? H.fromBook?.[`${doc}.${id}`] : table;
    const tables = put == null ? rest : { ...rest, [id]: put };
    if (Object.keys(tables).length) H.T.registerTable({ id: doc, tables }, { priority: 30, source: "qa-c1" });
    else H.T.unregisterTable(doc, { priority: 30 });
    return { apparentKnown: H.m.LY.apparentLevelPenalty() !== null, levelKnown: H.m.WG.levelMoraleRungs().length > 0 };
  },
  /** The employer level a hireling was told at hire: the employer's own plus `over`. */
  claimLevel: async ({ hirelingId, employerId, over }) => {
    const H = globalThis.__c1;
    const actor = game.actors.get(hirelingId);
    const rec = actor.getFlag("acks-extras", "record") ?? {};
    const claimed = H.A.adapter.getLevel(game.actors.get(employerId)) + over;
    await actor.setFlag("acks-extras", "record", { ...rec, terms: { ...(rec.terms ?? {}), claimedEmployerLevel: claimed } });
    return { written: actor.getFlag("acks-extras", "record")?.terms?.claimedEmployerLevel === claimed };
  },
  /**
   * The hosted loyalty page for a hireling, its apparent-level row read from
   * `_prepareContext`, and with `roll` pressed under a rig: whether the row is
   * typed by hand, whether its label is the bare field name, whether it counts
   * `count` levels and adds count × the figure this client reads, and the
   * notice and badges the page draws; rolled, whether the result is one of the
   * page's bands and the roll-complete payload's line for the row. Booleans
   * and counts only.
   */
  loyaltyRow: async ({ hirelingId, count, roll = false, u = 0.025 }) => {
    const H = globalThis.__c1;
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    H.takeNotes();
    H.takeChat();
    H.A.openLoyaltyRoll(game.actors.get(hirelingId));
    const app = await H.poll(() => { const a = H.influenceApp(); return a && H.root(a)?.querySelector('[data-action="roll"]') ? a : null; });
    if (!app) return { opened: false, notes: H.takeNotes(), throwOpen: !!H.appBy("throw-dialog") };
    const c = await app._prepareContext({});
    const mod = (c.groups ?? []).flatMap((g) => g.mods ?? []).find((m) => m.key === "apparentLevelDiff");
    const perLevel = H.m.LY.apparentLevelPenalty();
    const bare = game.i18n.localize("ACKS-INFLUENCE.mode.loyalty.apparentLevel");
    const el = H.root(app);
    const out = {
      opened: true,
      found: !!mod,
      unread: !!mod?.isUnread,
      labelBare: mod?.label === bare,
      counted: Number(mod?.value) === count,
      contributes: perLevel !== null && mod?.contribution === count * perLevel,
      notice: !!H.text(el.querySelector(".influence-unread-notice")),
      badges: el.querySelectorAll(".influence-unread-badge").length,
    };
    if (roll) {
      let parts = null;
      let outcome = null;
      Hooks.once("acksExtras.influenceRollComplete", (p) => { parts = p?.parts ?? []; outcome = p?.outcome ?? null; });
      H.rig(u);
      try {
        el.querySelector('[data-action="roll"]').click();
        await H.poll(() => parts !== null || null, { tries: 40, every: 150 });
        await H.sleep(800);
      } finally { H.unrig(); }
      const part = (parts ?? []).find((p) => p.label === bare);
      out.rolled = parts !== null;
      out.bandKey = ["hostility", "resignation", "grudging", "loyal", "fanatic"].includes(outcome);
      out.partShown = !!part;
      out.partOk = perLevel !== null && part?.value === count * perLevel;
    }
    out.chat = H.takeChat();
    out.notes = H.takeNotes();
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    return out;
  },
  /** The feature's own loyalty throw (integration swapped): whether it counts `count` levels, takes the figure this client reads per level, and names the count when the figure is unread. */
  loyaltyOwn: async ({ hirelingId, count }) => {
    const H = globalThis.__c1;
    H.takeNotes();
    H.A.openLoyaltyRoll(game.actors.get(hirelingId));
    const app = await H.poll(() => { const a = H.appBy("throw-dialog"); return a && H.root(a)?.querySelector('[name^="mod."]') ? a : null; });
    if (!app) return { opened: false, notes: H.takeNotes(), influenceOpen: !!H.influenceApp() };
    const el = H.root(app);
    const perLevel = H.m.LY.apparentLevelPenalty();
    const step = app.context?.stepValues?.apparentLevelDiff;
    const info = H.text(el.querySelector(".throw-info"));
    const out = {
      opened: true,
      counted: Number(el.querySelector('[name="mod.apparentLevelDiff"]')?.value) === count,
      stepIsFigure: perLevel === null ? step === undefined : step === perLevel,
      info: info.length > 0,
      infoNamesGap: info === game.i18n.format("ACKS-HENCHMEN.throwUi.apparentLevelUnread", { count }),
      notes: H.takeNotes(),
    };
    await app.close({ force: true });
    return out;
  },
  /** The levels of the level-gain morale rungs this client reads, lowest first. */
  rungLevels: async () => globalThis.__c1.m.WG.levelMoraleRungs().map((r) => r.level),
  /**
   * A level gain written as a sheet edit writes it, then what the watcher
   * recorded: whether each morale entry it added is a rung the gain crossed,
   * at that rung's bonus with the level in its note, and which card body
   * posted. `to` is a level, or the index of a rung this client reads.
   */
  gainLevel: async ({ hirelingId, to }) => {
    const H = globalThis.__c1;
    const actor = game.actors.get(hirelingId);
    const rec0 = actor.getFlag("acks-extras", "record") ?? {};
    const gained0 = rec0.counters?.levelsGainedInService ?? 0;
    const known = (rec0.counters?.startLevel ?? 0) + gained0;
    const before = (rec0.morale?.permanents ?? []).length;
    const rungs = H.m.WG.levelMoraleRungs();
    const level = typeof to === "number" ? to : rungs[Number(String(to).replace("rung", ""))]?.level;
    if (!Number.isInteger(level)) return { gained: false, reason: "no rung to reach" };
    H.takeChat();
    await actor.update({ "system.details.level": level });
    const rec = await H.poll(() => { const r = game.actors.get(hirelingId).getFlag("acks-extras", "record"); return (r?.counters?.levelsGainedInService ?? 0) > gained0 ? r : null; }, { tries: 60, every: 150 });
    await H.poll(() => H.chat.length > 0 || null, { tries: 40, every: 150 });
    await H.sleep(300);
    const chat = H.takeChat();
    const added = (rec?.morale?.permanents ?? []).slice(before);
    const want = rungs.filter((r) => known < r.level && level >= r.level);
    const noteOf = (l) => game.i18n.format("ACKS-HENCHMEN.moraleReason.levelNote", { level: l });
    const textOf = (mid) => H.text(Object.assign(document.createElement("div"), { innerHTML: game.messages.get(mid)?.content ?? "" }));
    const body = (key) => game.i18n.format(key, { name: actor.name, level });
    return {
      gained: true,
      recorded: !!rec,
      entries: added.length,
      want: want.length,
      match: added.length === want.length && want.every((r, i) => added[i].delta === r.bonus && added[i].reason === "levelGain" && added[i].note === noteOf(r.level) && added[i].compensated === false),
      unreadCard: chat.some((m) => textOf(m).includes(body("ACKS-HENCHMEN.card.levelGainBodyUnread"))),
      plainCard: chat.some((m) => textOf(m).includes(body("ACKS-HENCHMEN.card.levelGainBody"))),
      chat,
    };
  },
  /** The roster's ledger for one hireling: how many morale rows read as a level gain, and whether each note names a rung this client reads. */
  ledgerShown: async ({ employerId, hirelingId }) => {
    const H = globalThis.__c1;
    await H.A.openRosterApp(game.actors.get(employerId));
    const ROW = `[data-actor-id="${hirelingId}"]`;
    const app = await H.poll(() => { const a = H.appBy("roster-app"); return a && H.root(a)?.querySelector(ROW) ? a : null; });
    if (!app) return { rendered: false };
    // The ledger renders only on an open row: press the name, as a user does.
    if (!H.root(app).querySelector(`${ROW} .acks-extras-roster__detail`)) {
      H.root(app).querySelector(`${ROW} [data-action="toggleRow"]`)?.click();
      await H.poll(() => H.root(app)?.querySelector(`${ROW} .acks-extras-roster__detail`));
    }
    const rows = [...H.root(app).querySelectorAll(`${ROW} .acks-extras-roster__detail > div:last-child .acks-extras-frame__row`)]
      .map((r) => ({ tag: H.text(r.querySelector(".acks-tag")), reason: H.text(r.querySelector(".acks-extras-frame__row-label")), note: H.text(r.querySelector(".acks-extras-frame__row-line")) }));
    const track = game.i18n.localize("ACKS-HENCHMEN.ledger.track.morale");
    const reason = game.i18n.localize("ACKS-HENCHMEN.moraleReason.levelGain");
    const notes = H.m.WG.levelMoraleRungs().map((r) => game.i18n.format("ACKS-HENCHMEN.moraleReason.levelNote", { level: r.level }));
    const shown = rows.filter((c) => c.tag.startsWith(track) && c.reason === reason);
    await app.close({ force: true });
    return { rendered: true, shown: shown.length, notesMatch: shown.every((c) => notes.includes(c.note)) };
  },

  closeAll: async () => globalThis.__c1.closeAll(),
  restore: async () => {
    const H = globalThis.__c1 ?? {};
    const out = {};
    if (H.inf) { acksExtras.influence = H.inf; out.influenceApi = "restored"; }
    try { H.T?.unregisterTable("influence", { priority: 30 }); out.override = "unregistered"; } catch (e) { out.override = String(e?.message ?? e); }
    try { H.T?.unregisterTable("wages", { priority: 30 }); out.limitOverride = "unregistered"; } catch (e) { out.limitOverride = String(e?.message ?? e); }
    if (H.unrig) { H.unrig(); out.dice = "restored"; }
    if (H.chatWrapped) { ChatMessage.create = H.chatCreate; H.chatWrapped = false; out.chat = "restored"; }
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; out.notes = "restored"; }
    return out;
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
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.henchmen?.openRosterApp && !!globalThis.acksExtras?.influence?.open && !!globalThis.acksExtras?.lib?.tables`);
    } catch { ok = false; }
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

/** The kept actor marked `marker`, brought back to the shape `data` creates, or one built from it now. */
async function keep(marker, data) {
  const doc = await gm.fixture(marker, "Actor", data);
  if (!doc.built) note(`shape: ${marker}`, await run(gm, P.reshape, { id: doc.id, data }));
  return doc;
}
/** Retire the last run's products of a create path: `<prefix>-1`, `-2`, … until one is not standing. */
async function retireSeries(prefix, kind) {
  for (let n = 1; ; n++) {
    const r = await gm.retire(`${prefix}-${n}`, kind);
    if (!r.removed.length && !r.missing.length && !r.failed.length) return n - 1;
  }
}
/** Mark what a create path made, `<prefix>-<from>` onwards; returns the next number. */
async function markSeries(prefix, kind, ids, from = 1) {
  let n = from;
  for (const id of ids ?? []) await gm.mark(`${kind}.${id}`, `${prefix}-${n++}`);
  return n;
}

const byLabel = (rows, re) => rows.filter((r) => re.test(r.label ?? ""));
const modsOf = (ctx) => (ctx.groups ?? []).flatMap((g) => g.mods.map((m) => ({ ...m, group: g.group })));

let gm = null;
try {
  section("seats");
  gm = await seat("gm");
  const census = await run(gm, P.census, MOD);
  note("gm census", census);
  check("the GM seat is the active GM, the page runs the working tree (formation apiVersion 19) and the influence page hosts (apiVersion ≥ 6)", census.activeGMIsSelf && census.role === 4 && census.working === 19 && census.influenceApi >= 6, { role: census.role, manifest: census.module, working: census.working, influenceApi: census.influenceApi });
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");
  note("install", await run(gm, P.install));

  section("the books, connected on the GM seat");
  const states = {};
  for (const book of BOOKS) {
    note(`book ${book.id}`, await run(gm, P.connectBook, book));
    let state = null;
    for (let n = 0; n < 150; n++) { state = await run(gm, P.bookState, { id: book.id }); if (state.done || state.session) break; await sleep(2000); }
    note(`book ${book.id} state`, state);
    states[book.id] = state;
  }
  let invented = false;
  let importedDoc = false;
  const ensureOffer = async () => {
    const off0 = await run(gm, P.offerRead);
    note("offer as the world reads it", off0);
    if (off0.complete) return off0;
    if (!off0.hasDoc) {
      note("import influence from the book", await run(gm, P.importDoc, { id: "influence" }));
      let st = null;
      for (let n = 0; n < 120; n++) { st = await run(gm, P.importState, { id: "influence" }); if (st.done) break; await sleep(2000); }
      note("import state", st);
      importedDoc = !!st?.ok && st.hasDoc;
      globalThis.__c1ImportedDoc = importedDoc;
      check("changed: the Reaction to Hiring Offer's table arrives with the influence document imported from the book, complete", importedDoc && (await run(gm, P.offerRead)).complete, { st, offer: await run(gm, P.offerRead) });
    }
    if (!(await run(gm, P.offerRead)).complete) {
      note("no complete hiring table from the world or the book: invented figures registered at priority 30", await run(gm, P.overrideInfluence, { on: true, table: INVENTED_OFFER }));
      invented = true;
    }
    return run(gm, P.offerRead);
  };
  // The limit's base: the world's import where it holds one, else the book's
  // figure read through the shipped recipe, else an invented one; the last two
  // stand only in this client's memory.
  let limitSource = null;
  const ensureLimit = async () => {
    const l0 = await run(gm, P.limitRead);
    note("henchman limit base as the world reads it", l0);
    if (l0.known) return (limitSource = l0.worldHolds ? "world" : "layer");
    const fromBook = await run(gm, P.limitFromBook);
    note("the limit's base read off the book, registered at priority 30", fromBook);
    if (fromBook.read && fromBook.known) return (limitSource = "book");
    note("no limit base from the world or the book: an invented one registered at priority 30", await run(gm, P.overrideLimit, { on: true, table: INVENTED_LIMIT }));
    return (limitSource = "invented");
  };

  if (STAGE === "1") {
    section("fixtures (stage 1): the hall, employers A and B, a hireling each, a monster, a monster employer");
    // The last run's hire and cards go first: a hire still answers to B.
    const retired = { hires: await retireSeries("henchmen/hire-b", "Actor") };
    for (const c of STAGE1_CARDS) retired[c] = await retireSeries(`henchmen/card-${c}`, "ChatMessage");
    note("retired", retired);
    // Every stage 1 actor is brought to shape here, before any step reads a
    // roster: a kept hireling still names the employer it was linked to.
    const hall = await keep("henchmen/hall", { name: "QA Hiring Hall", type: "acks-extras.location" });
    note("market", await run(gm, P.addMarket, { locationId: hall.id, classOverride: 4 }));
    const A = await keep("henchmen/employer-a", { name: "QA Employer A", type: "character", system: { scores: { cha: { value: 16 } }, details: { level: 5 } }, items: [] });
    const B = await keep("henchmen/employer-b", { name: "QA Employer B", type: "character", system: { scores: { cha: { value: 3 } }, details: { level: 3 } }, items: [] });
    const hA = await keep("henchmen/hireling-a", { name: "QA Hireling of A", type: "character", items: [] });
    const hB = await keep("henchmen/hireling-b", { name: "QA Hireling of B", type: "character", items: [] });
    const hM = await keep("henchmen/hireling-beast", { name: "QA Hireling of the beast", type: "character", items: [] });
    const M = await keep("henchmen/beast", { name: "QA Beast", type: "monster", system: { hp: { hd: "2d8" } } });
    const ME = await keep("henchmen/beast-employer", { name: "QA Beast employer", type: "monster", system: { hp: { hd: "4d8" } } });
    const M2 = await keep("henchmen/beast-hireling", { name: "QA Beast hireling", type: "monster", system: { hp: { hd: "1d8" } } });
    const SE = await keep("henchmen/service-employer", { name: "QA Service employer", type: "character", system: { scores: { cha: { value: 13 } }, details: { level: 4 } }, items: [] });
    const hS = await keep("henchmen/service-hireling", { name: "QA Service hireling", type: "character", items: [] });
    const C = await keep("henchmen/employer-c", { name: "QA Employer C", type: "character", system: { scores: { cha: { value: 10 } } }, items: [] });
    const hD = await keep("henchmen/doubter", { name: "QA Doubter", type: "character", system: { retainer: { category: "henchman" } }, items: [] });
    // Step 16 brings the novices to their level once the rungs are read.
    const novice = (name, level) => ({ name, type: "character", system: { ...(level === undefined ? {} : { details: { level } }), retainer: { category: "henchman" } }, items: [] });
    await keep("henchmen/novice-unread", novice("QA Novice unread"));
    await keep("henchmen/novice-read", novice("QA Novice read"));

    section("14. the henchman limit's base");
    await ensureLimit();
    check("changed: the henchman limit's base stands, from the world's import or read off the book through the shipped recipe", limitSource === "world" || limitSource === "book", { limitSource });

    // Employer A: the six powers built fresh from the book, or typed by hand where the book will not open here.
    section("14. the powers, built fresh from the book on this seat");
    let fresh = false;
    let built = [];
    if (Object.values(states).every((st) => st?.session)) {
      built = await run(gm, P.buildPowers, { ids: POWER_IDS });
      note("built", built);
      fresh = built.length === POWER_IDS.length && built.every((b) => !b.error && b.name);
    }
    check("14: the six powers build fresh from the book, each a document with its located effects", fresh, built.map((b) => ({ id: b.id, name: b.name ?? null, error: b.error ?? null, effects: b.effects?.length ?? 0 })));
    if (fresh) note("embedded on A", await run(gm, P.embedPowers, { actorId: A.id }));
    else {
      note("FALLBACK: hand-typed effects on A (the page-built half is NOT checked)", await run(gm, P.handAbilities, { actorId: A.id, items: [
        { name: "Leadership", effects: [{ type: "modifier", target: "retainBonus", value: 2 }] },
        { name: "Blood of Kings", effects: [{ type: "modifier", target: "retainBonus", value: 1 }, { type: "modifier", target: "baseLoyalty", value: 1 }] },
        { name: "Command", effects: [{ type: "modifier", target: "moraleBase", value: 1 }] },
        { name: "Diplomacy", effects: [{ type: "modifier", target: "hiring", value: 1, tones: ["diplomacy"] }] },
        { name: "Beast Friendship", effects: [{ type: "modifier", target: "hiring", value: 1, vsKinds: ["animal"] }] },
        { name: "Command of Voice", effects: [{ type: "modifier", target: "hiring", value: 1 }] },
      ] }));
    }
    note("B's hand-made powers", await run(gm, P.handAbilities, { actorId: B.id, items: [{ name: "Leadership" }, { name: "Command" }, { name: "Diplomacy" }] }));
    const readA = await run(gm, P.powerRead, { actorId: A.id });
    const readB = await run(gm, P.powerRead, { actorId: B.id });
    note("A reads", readA);
    note("B reads", readB);
    const sumRetain = readA.retainBonus.reduce((s, m) => s + m.value, 0);
    check("14: A's retainBonus effects are read (two powers) and its limit is the imported base plus its Charisma modifier plus them; no power of the limit or loyalty domains is unvalued", readA.retainBonus.length === 2 && readA.baseAgrees && readA.retainMax === readA.retainBase + sumRetain && readA.unvalued.retainBonus.length === 0 && readA.unvalued.baseLoyalty.length === 0, { chaMod: readA.chaMod, baseAgrees: readA.baseAgrees, retainMax: readA.retainMax, sumRetain, unvalued: readA.unvalued });
    check("14: employerLoyaltyMods(A).baseLoyaltyBonus is the baseLoyalty power's value", readA.baseLoyalty.length === 1 && readA.loyaltyMods.baseLoyaltyBonus === readA.baseLoyalty[0].value, { baseLoyalty: readA.baseLoyalty, loyaltyMods: readA.loyaltyMods });
    check("14: B's three powers are held by name only: no modifier, each named as unvalued in its domain", readB.retainBonus.length === 0 && readB.unvalued.retainBonus.includes("Leadership") && readB.unvalued.henchmanMorale.includes("Command") && readB.unvalued.hiring.includes("Diplomacy"), readB.unvalued);

    section("links: a hireling for A, for B and for the beast");
    note("link A", await run(gm, P.link, { employerId: A.id, hirelingId: hA.id, wage: 5 }));
    note("link B", await run(gm, P.link, { employerId: B.id, hirelingId: hB.id, wage: 5 }));
    note("link beast employer (core's own call)", await run(gm, P.link, { employerId: ME.id, hirelingId: hM.id, wage: 5 }));
    if (SHOTS) {
      const sheetA = await run(gm, P.sheetOnStats, { actorId: hA.id });
      note("A's hireling opens on", sheetA);
      await gm.compose(sheetA.sel);
      await shot(gm, "character-sheet-morale", sheetA.sel);
      note("closed", await run(gm, P.closeAll));
    }
    note("a monster hired by the beast employer", await run(gm, P.hireMonsterFor, { monsterId: M2.id, employerId: ME.id }));

    section("14. the rosters");
    // B's Charisma is the fixture's, its base the book's: the manual flag pins its limit at one, so its one link fills it.
    note("B's limit pinned at one", await run(gm, P.pinLimit, { actorId: B.id, to: 1 }));
    const rosterA = await run(gm, P.roster, { actorId: A.id });
    note("roster A", rosterA);
    check("14: A's roster shows its count against the limit the powers make, with no unvalued note", rosterA.rendered && rosterA.limit === `1 / ${readA.retainMax}` && rosterA.noteOk && rosterA.hint === "limitHint" && !rosterA.unvalued, { limit: rosterA.limit, noteOk: rosterA.noteOk, hint: rosterA.hint, unvalued: rosterA.unvalued });
    if (limitSource === "book" || limitSource === "invented") {
      note("the limit layer off", await run(gm, P.overrideLimit, { on: false }));
      const rosterX = await run(gm, P.roster, { actorId: A.id });
      note("roster A, no base", rosterX);
      check("changed: with no imported base, A's roster shows no limit (count / —) and its tooltip asks for the Rules tables", rosterX.rendered && /^1 \/ —$/.test(rosterX.limit) && rosterX.noteOk && rosterX.gap === "import" && rosterX.hint === "limitNotImported", { limit: rosterX.limit, noteOk: rosterX.noteOk, gap: rosterX.gap, hint: rosterX.hint });
      note("the limit layer back on", await run(gm, P.overrideLimit, { on: true }));
    }
    const rosterB = await run(gm, P.roster, { actorId: B.id, keep: true, place: true });
    note("roster B", rosterB);
    check("14: B's roster reads 1 / 1 and its note names Leadership", rosterB.rendered && rosterB.limit === "1 / 1" && /Leadership/.test(rosterB.unvalued ?? ""), { limit: rosterB.limit, unvalued: rosterB.unvalued });
    await shot(gm, "henchmen-powers-values", ".application.roster-app");
    note("closed", await run(gm, P.closeAll));
    const rosterM = await run(gm, P.roster, { actorId: ME.id, keep: true, place: true });
    note("roster of the beast employer", rosterM);
    check("changed: a monster employer, with no Charisma score, shows no limit (count / —), getRetainMax is null and its tooltip names its own gap", rosterM.rendered && rosterM.retainMax === null && /^\d+ \/ —$/.test(rosterM.limit) && rosterM.gap === "charisma" && rosterM.hint === "limitUnknown", { limit: rosterM.limit, retainMax: rosterM.retainMax, gap: rosterM.gap, hint: rosterM.hint, rows: rosterM.rows });
    await shot(gm, "henchmen-limit-none", ".application.roster-app");
    note("closed", await run(gm, P.closeAll));

    await ensureOffer();

    section("14. the feature's own hiring dialog (integration swapped) for A and for B");
    const cand1 = await run(gm, P.addCandidate, { locationId: hall.id, row: { name: "QA Candidate one", kind: "henchman", level: 1, segment: "henchman:1", wageGp: 10 } });
    const cand2 = await run(gm, P.addCandidate, { locationId: hall.id, row: { name: "QA Candidate two", kind: "henchman", level: 1, segment: "henchman:1", wageGp: 10 } });
    note("swap", await run(gm, P.swapIntegration, { hosts: false }));
    const ownA = await run(gm, P.recruitOwn, { locationId: hall.id, candidateId: cand1.id, employerId: A.id });
    note("A's own dialog", ownA);
    const dip = byLabel(ownA.rows ?? [], /Diplomacy/), beast = byLabel(ownA.rows ?? [], /Beast Friendship/), voice = byLabel(ownA.rows ?? [], /Command of Voice/);
    check("14: A's hiring dialog offers Diplomacy (a tone), Beast Friendship (a kind) and Command of Voice unticked", ownA.opened && dip.length === 1 && beast.length === 1 && voice.length === 1 && [dip, beast, voice].every((r) => r[0].type === "checkbox" && r[0].checked === false && !r[0].locked), { dip, beast, voice });
    const ownB = await run(gm, P.recruitOwn, { locationId: hall.id, candidateId: cand2.id, employerId: B.id, keep: true });
    note("B's own dialog", ownB);
    const dipB = byLabel(ownB.rows ?? [], /Diplomacy/);
    check("14: B's dialog shows Diplomacy locked at no value with the no-value hint", ownB.opened && dipB.length === 1 && dipB[0].locked && /no value imported/i.test(dipB[0].hint), { dipB });
    const policy = await run(gm, P.limitPolicy, { set: "warn" });
    note("the world's henchman-limit policy (the warning fires under warn or block; set to warn for this check and restored at once)", policy);
    const rollB = await run(gm, P.ownRoll, { u: 0.02, misc: 10, employerId: B.id });
    note("B's offer, carried to a hire", rollB);
    await markSeries("henchmen/card-hire-b", "ChatMessage", rollB.chat);
    await markSeries("henchmen/hire-b", "Actor", rollB.newIds);
    check("14: B's recruit, carried to an accepted offer, warns of the limit naming Leadership", rollB.found && rollB.notes.some((n) => /Leadership/.test(n.text) && /henchmen/.test(n.text)), { notes: rollB.notes, cards: rollB.cards, newIds: rollB.newIds });
    note("policy restored", await run(gm, P.limitPolicyRestore));

    section("14. the obedience fallback, then the hosted page again");
    const obA = await run(gm, P.obedienceOwn, { hirelingId: hA.id });
    note("A's hireling, own dialog", obA);
    const cmdA = byLabel(obA.rows ?? [], /^Command\b|Command \(/);
    check("14: A's hireling's own obedience dialog shows Command unticked at its located value", obA.opened && cmdA.length === 1 && cmdA[0].type === "checkbox" && cmdA[0].checked === false && !cmdA[0].locked, { cmdA, located: readA.henchmanMorale });
    const obB = await run(gm, P.obedienceOwn, { hirelingId: hB.id });
    note("B's hireling, own dialog", obB);
    const cmdB = byLabel(obB.rows ?? [], /^Command\b|Command \(/);
    check("14: B's hireling's own obedience dialog shows Command locked at no value", obB.opened && cmdB.length === 1 && cmdB[0].locked, cmdB);
    note("restore integration", await run(gm, P.swapIntegration, { hosts: true }));
    const hostedObA = await run(gm, P.hosted, { kind: "obedience", hirelingId: hA.id, keep: true, place: true });
    note("A's hireling, hosted", { opened: hostedObA.opened, title: hostedObA.dom?.title, groups: hostedObA.groups?.map((g) => ({ group: g.group, mods: g.mods.map((m) => [m.label, m.value, m.checked, m.isUnvalued]) })), external: hostedObA.external, notice: hostedObA.dom?.notice, firstModKeys: hostedObA.firstModKeys });
    const hostedCmdA = modsOf(hostedObA).filter((m) => /Command/.test(m.label ?? ""));
    await shot(gm, "influence-obedience-powers", ".application.acks-influence-dialog");
    note("tick Command", await run(gm, P.hostedTick, { key: hostedCmdA[0]?.key ?? "", on: true }));
    const rObA = await run(gm, P.hostedRoll, { u: 0.5 });
    note("obedience roll (Command ticked)", rObA);
    await markSeries("henchmen/card-obedience-a", "ChatMessage", rObA.chat);
    const cmdActive = (rObA.cards?.[0]?.flags?.rollResult?.activeModifiers ?? []).find((a) => /^Command\b/.test(a.label ?? ""));
    check("15: with the integration back, the obedience page opens on A's hireling offering Command unticked, and ticked it adds the located value to the roll", hostedObA.opened && hostedCmdA.length === 1 && hostedCmdA[0].isEffect && hostedCmdA[0].checked !== true && cmdActive?.value === readA.henchmanMorale[0]?.value, { hostedCmdA: hostedCmdA.map((m) => [m.label, m.checked, m.isEffect]), cmdActive, located: readA.henchmanMorale });
    note("closed", await run(gm, P.closeAll));
    const hostedObB = await run(gm, P.hosted, { kind: "obedience", hirelingId: hB.id });
    note("B's hireling, hosted", { opened: hostedObB.opened, external: hostedObB.external, mods: modsOf(hostedObB).map((m) => [m.label, m.value]) });
    check("15: B's hireling's obedience page names Command in a note and adds nothing for it", hostedObB.opened && hostedObB.external.some((e) => /Command/.test(e.label ?? "") && e.note === true && !(Number(e.value) > 0)) && !modsOf(hostedObB).some((m) => /^Command\b/.test(m.label ?? "")), { external: hostedObB.external });

    // The service employer and its hireling are this step's alone, so its invented power reaches no other step's figures.
    section("1b. the Service panel's figure tooltips");
    // moraleBase is read off Active Effects alone (it has no typed target), so the power is an effect on the item.
    const powerS = await run(gm, P.handAbilities, { actorId: SE.id, items: [{ name: "QA morale power" }] });
    note("the service employer's morale power, an invented value", await run(gm, P.addEffect, { actorId: SE.id, itemId: powerS[0].id, key: "flags.acks-extras.moraleBase", value: 2, name: "QA morale" }));
    note("link the service hireling", await run(gm, P.link, { employerId: SE.id, hirelingId: hS.id, wage: 5 }));
    const tipsS = await run(gm, P.serviceTips, { actorId: hS.id });
    note("the service hireling, Service", tipsS);
    check("1b: every value on the Service panel carries a data-tooltip-text, each one the view built", tipsS.rendered && tipsS.count >= 8 && tipsS.untipped.length === 0 && tipsS.mismatched.length === 0, { count: tipsS.count, untipped: tipsS.untipped, mismatched: tipsS.mismatched });
    // The power sets morale apart from loyalty, so a row reading loyalty cannot pass.
    check("changed: the Obedience row reads the morale figure the obedience throw rolls on", tipsS.obedience !== null && tipsS.morale !== tipsS.loyalty && tipsS.obedience === tipsS.morale && tipsS.morale === tipsS.moraleScore, { obedience: tipsS.obedience, morale: tipsS.morale, moraleScore: tipsS.moraleScore, loyalty: tipsS.loyalty });
    check("changed: the morale line and its tooltip carry the employer's powers as a part", tipsS.powers === "+2" && tipsS.moraleLine.endsWith(`${tipsS.powersLabel} +2`) && (tipsS.moraleTip ?? "").includes(`${tipsS.powersLabel} +2`), { powers: tipsS.powers, line: tipsS.moraleLine, tip: tipsS.moraleTip });
    check("1b: the loyalty figure, hovered, shows its own text in core's tooltip, and a pointer at its centre lands on it", tipsS.hover.hit && tipsS.hover.active && tipsS.hover.shown === tipsS.hover.attr, tipsS.hover);
    const ladderS = await run(gm, P.serviceTips, { actorId: hS.id, ladder: true });
    note("the service hireling, wage off the table", { wageTip: ladderS.wageTip, expect: ladderS.expectWageTip, ladderGp: ladderS.ladderGp, cite: ladderS.cite });
    check("1b: with no agreed or sheet wage, the wage's tooltip names the table at the hireling's level and the page lib citeOf answers, or says nothing is imported", ladderS.rendered && ladderS.wageTip === ladderS.expectWageTip, { wageTip: ladderS.wageTip, expect: ladderS.expectWageTip, cite: ladderS.cite });
    note("closed", await run(gm, P.closeAll));

    section("15. the hosted hiring page: B's hiring effect, the note, Diplomacy's box");
    const cov = await run(gm, P.handAbilities, { actorId: B.id, items: [{ name: "Command of Voice" }] });
    const ae = await run(gm, P.addEffect, { actorId: B.id, itemId: cov[0].id, key: "flags.acks-extras.hiring", value: 3, name: "QA voice" });
    note("AE on Command of Voice", ae);
    const cand3 = await run(gm, P.addCandidate, { locationId: hall.id, row: { name: "QA Candidate three", kind: "henchman", level: 1, segment: "henchman:1", wageGp: 10 } });
    const hostB1 = await run(gm, P.hosted, { kind: "recruit", locationId: hall.id, candidateId: cand3.id, employerId: B.id });
    note("B's hosted hiring page", { opened: hostB1.opened, notes: hostB1.notes, external: hostB1.external, groups: hostB1.groups?.map((g) => ({ group: g.group, mods: g.mods.map((m) => [m.label, m.value, m.isUnvalued, m.control]) })) });
    const powers1 = (hostB1.groups ?? []).filter((g) => /powers/i.test(g.group ?? "")).flatMap((g) => g.mods);
    const voiceRows = modsOf(hostB1).filter((m) => /QA voice|Command of Voice/.test(m.label ?? ""));
    const dipRow1 = modsOf(hostB1).find((m) => /Diplomacy/.test(m.label ?? ""));
    const figureOf = (m) => { const r = m?.raw ?? {}; if (r.checked === true && typeof r.contribution === "number") return r.contribution; for (const k of ["amount", "modifier", "effectValue", "bonus", "figure", "defaultValue", "value"]) if (typeof r[k] === "number") return r[k]; const t = String(r.valueLabel ?? r.hint ?? r.label ?? ""); const mm = t.match(/[+−-]\s?(\d+)/); return mm ? Number(mm[1]) : null; };
    note("voice row raw", voiceRows[0]?.raw ?? null);
    check("15: the Powers group holds B's hiring effect at its figure, once; no note names Command of Voice; Diplomacy is a typed box with the no-value badge and no note", hostB1.opened && voiceRows.length === 1 && voiceRows[0].isEffect && figureOf(voiceRows[0]) === 3 && powers1.some((m) => /QA voice/.test(m.label ?? "")) && !hostB1.external.some((e) => /Command of Voice/.test(e.label ?? "")) && !!dipRow1 && dipRow1.isUnvalued && !hostB1.external.some((e) => /Diplomacy/.test(e.label ?? "")), { voiceFigure: figureOf(voiceRows[0]), dipRow1: { label: dipRow1?.label, isUnvalued: dipRow1?.isUnvalued }, external: hostB1.external, powers: powers1.map((m) => m.label) });
    note("AE removed", await run(gm, P.removeEffect, { actorId: B.id, itemId: cov[0].id, effectId: ae.id }));
    const hostB2 = await run(gm, P.hosted, { kind: "recruit", locationId: hall.id, candidateId: cand3.id, employerId: B.id });
    check("15: with the effect gone the note names Command of Voice and the row is gone", hostB2.opened && hostB2.external.some((e) => /Command of Voice/.test(e.label ?? "")) && !modsOf(hostB2).some((m) => /QA voice|Command of Voice/.test(m.label ?? "")), { external: hostB2.external });
    const aeA = await run(gm, P.addEffect, { actorId: A.id, key: "flags.acks-extras.loyaltyRoll", value: 2, name: "QA loyal" });
    const loyal = await run(gm, P.hosted, { kind: "loyalty", hirelingId: hA.id });
    note("A's hireling, loyalty page", { opened: loyal.opened, mods: modsOf(loyal).map((m) => [m.label, m.value]) });
    const loyalRow = modsOf(loyal).find((m) => /QA loyal/.test(m.label ?? ""));
    note("loyal row raw", loyalRow?.raw ?? null);
    check("15: the loyalty page offers A's loyalty-roll effect as a row at its figure", loyal.opened && !!loyalRow && loyalRow.isEffect && figureOf(loyalRow) === 2, { mods: modsOf(loyal).map((m) => [m.label, m.value]), figure: figureOf(loyalRow) });
    note("A's loyalty AE kept on the fixture (gone at the next run's shape)", aeA);

    section("15 / influence 17–18. the hiring table: the throw dialog's steppers, the card's band, and the table missing");
    await ensureOffer();
    const offer1 = await run(gm, P.offerRead);
    check("the hiring table is complete (the world's own, or invented figures registered in this client)", offer1.complete && offer1.bands === 5, offer1);
    const mr = await run(gm, P.monsterRecruit, { monsterId: M.id, employerId: A.id, keep: true, place: true });
    note("monster recruit", { opened: mr.opened, title: mr.title, stepValues: mr.stepValues, notes: mr.notes, rows: mr.rows?.map((r) => [r.name, r.type, r.value, r.step, r.label]) });
    const refRow = (mr.rows ?? []).find((r) => r.name === "mod.previousRefusals"), slRow = (mr.rows ?? []).find((r) => r.name === "mod.slander");
    check("15: the throw dialog opens for the peaceful offer with refusal and slander steppers carrying the table's figure per step", mr.opened && !!refRow && !!slRow && mr.stepValues?.previousRefusals === offer1.refusalPenalty && mr.stepValues?.slander === offer1.slanderPenalty, { refRow, slRow, stepValues: mr.stepValues });
    await shot(gm, "henchmen-hiring-table", ".application.throw-dialog");
    const mrRoll = await run(gm, P.monsterRecruit, { monsterId: M.id, employerId: A.id, roll: true, u: 0.5 });
    note("monster recruit rolled", { cards: mrRoll.cards, notes: mrRoll.notesAfter, stillOpen: mrRoll.stillOpen });
    await markSeries("henchmen/card-monster-recruit", "ChatMessage", mrRoll.chat);
    check("15: the card names the imported band in flags.acks-extras.outcome", (mrRoll.cards ?? []).some((c) => typeof c.outcome === "string" && c.outcome), mrRoll.cards);
    note("closed", await run(gm, P.closeAll));
    note("table hidden (override with no bands)", await run(gm, P.overrideInfluence, { on: true, table: { bands: null, refusalPenalty: null, slanderPenalty: null } }));
    const mrGone = await run(gm, P.monsterRecruit, { monsterId: M.id, employerId: A.id });
    note("monster recruit without the table", mrGone);
    check("15: with the table unread the warning names it and no dialog opens", !mrGone.opened && mrGone.notes.some((n) => n.kind === "warn"), mrGone.notes);

    section("influence 17. the hosted hiring page with no table");
    const ctx = { previousRefusals: 2, slanderCount: 1, signingBonusOptions: [{ label: "—", value: 0 }] };
    const p17 = await run(gm, P.hosted, { kind: "open", actorId: A.id, ctx, keep: true });
    note("page 17", { opened: p17.opened, notice: p17.dom?.notice, unreadBadges: p17.dom?.unreadBadges, typed: p17.dom?.typedNumbers, mods: modsOf(p17).map((m) => [m.label, m.value, m.isUnread, m.control]) });
    const countRows17 = modsOf(p17).filter((m) => /refus|slander/i.test(m.label ?? ""));
    check("17: both count rows are badged typed fields and the notice names the page", p17.opened && countRows17.length === 2 && countRows17.every((m) => m.isUnread) && !!p17.dom?.notice, { countRows17, notice: p17.dom?.notice });
    const r17 = await run(gm, P.hostedRoll, { u: 0.5 });
    note("roll 17", r17);
    check("17: the roll warns that the table is not imported and posts no card", r17.found && r17.notes.some((n) => n.kind === "warn") && r17.chat.length === 0, { notes: r17.notes, chat: r17.chat });
    note("closed", await run(gm, P.closeAll));

    section("influence 18. the page with the table read");
    note("override lifted", await run(gm, P.overrideInfluence, { on: false }));
    if (invented) note("invented figures registered again", await run(gm, P.overrideInfluence, { on: true, table: INVENTED_OFFER }));
    const offer2 = await run(gm, P.offerRead);
    const p18 = await run(gm, P.hosted, { kind: "open", actorId: A.id, ctx, keep: true });
    note("page 18", { opened: p18.opened, notice: p18.dom?.notice, unreadBadges: p18.dom?.unreadBadges, mods: modsOf(p18).map((m) => [m.label, m.value, m.isUnread, m.control]), final: p18.final });
    const countRows18 = modsOf(p18).filter((m) => /refus|slander/i.test(m.label ?? ""));
    const eachOf = (m) => { const mm = String(m.label ?? "").match(/\(([+−-]?\s?\d+) each\)/); return mm ? Number(mm[1].replace("−", "-").replace(/\s/g, "")) : null; };
    const refRow18 = countRows18.find((m) => /refus/i.test(m.label)), slRow18 = countRows18.find((m) => /slander/i.test(m.label));
    check("18: no badge and no notice; each count row shows its count and the figure each count adds", p18.opened && !p18.dom?.notice && countRows18.length === 2 && countRows18.every((m) => !m.isUnread) && Number(refRow18?.value) === 2 && Number(slRow18?.value) === 1 && eachOf(refRow18) === offer2.refusalPenalty && eachOf(slRow18) === offer2.slanderPenalty, { rows: countRows18.map((m) => [m.label, m.value]), figures: [offer2.refusalPenalty, offer2.slanderPenalty] });
    const r18 = await run(gm, P.hostedRoll, { u: 0.5 });
    note("roll 18", r18);
    await markSeries("henchmen/card-hiring-18", "ChatMessage", r18.chat);
    const active18 = r18.cards?.[0]?.flags?.rollResult?.activeModifiers ?? [];
    const prod = (re) => active18.find((a) => re.test(a.label ?? ""))?.value ?? null;
    check("18: Roll posts a card whose refusal and slander lines carry count × figure, and the roll-complete payload names a band key", r18.found && r18.chat.length >= 1 && typeof r18.payload?.outcome === "string" && r18.payload.outcome && prod(/refus/i) === 2 * offer2.refusalPenalty && prod(/slander/i) === 1 * offer2.slanderPenalty, { payload: r18.payload, active18 });
    note("closed", await run(gm, P.closeAll));

    section("influence 19. one page per fixture actor");
    const pA = await run(gm, P.hosted, { kind: "open", actorId: A.id, ctx, keep: true, place: true });
    const profA = modsOf(pA).filter((m) => /Diplomacy|Intimidation|Seduction|Mystic Aura/.test(m.label ?? ""));
    note("A's page proficiency rows", profA.map((m) => [m.label, m.value, m.isUnvalued, m.control]));
    const dipBuilt = built.find((b) => /Diplomacy/.test(b.name ?? ""))?.effects?.find((e) => e.target === "reaction")?.value;
    const dipFigure = typeof dipBuilt === "number" ? dipBuilt : (dipBuilt?.flat ?? null);
    note("A's Diplomacy row raw", profA[0]?.raw ?? null);
    check("19: A's page draws one Diplomacy box worth its item's figure, with the figure in its label, and no other proficiency box", pA.opened && profA.length === 1 && /Diplomacy/.test(profA[0].label) && !profA[0].isUnvalued && dipFigure != null && (profA[0].value === dipFigure || figureOf(profA[0]) === dipFigure) && new RegExp(`[+−-]\\s?${Math.abs(dipFigure)}`).test(profA[0].label), { row: { label: profA[0]?.label, value: profA[0]?.value, isUnvalued: profA[0]?.isUnvalued }, dipFigure });
    await shot(gm, "influence-hiring-page", ".application.acks-influence-dialog");
    note("closed", await run(gm, P.closeAll));
    const pB = await run(gm, P.hosted, { kind: "open", actorId: B.id, ctx });
    const profB = modsOf(pB).filter((m) => /Diplomacy|Intimidation|Seduction|Mystic Aura/.test(m.label ?? ""));
    check("19: B's hand-made Diplomacy draws a typed field with the no-value badge", pB.opened && profB.length === 1 && /Diplomacy/.test(profB[0].label) && profB[0].isUnvalued, profB.map((m) => [m.label, m.value, m.isUnvalued, m.control]));
    const pC = await run(gm, P.hosted, { kind: "open", actorId: C.id, ctx });
    const profC = modsOf(pC).filter((m) => /Diplomacy|Intimidation|Seduction|Mystic Aura/.test(m.label ?? ""));
    check("19: the actor holding nothing draws no proficiency box", pC.opened && profC.length === 0, profC);
    note("closed", await run(gm, P.closeAll));

    // Each figure stands from the world's import where it holds one, else read
    // off the book through the shipped recipe, else invented; the last two only
    // in this client's priority-30 layer. Unread is that layer shadowing it.
    const printed0 = await run(gm, P.printedRead);
    note("the apparent-level figure and the level-gain rungs as the world reads them", printed0);
    const standFor = async (doc, id, worldKnown, invented) => {
      if (worldKnown) return { source: "world", layer: await run(gm, P.layerTable, { doc, id, table: null }) };
      const fromBook = await run(gm, P.recipeFromBook, { doc, id });
      note(`${doc}.${id} read off the book`, fromBook);
      const layer = await run(gm, P.layerTable, { doc, id, table: fromBook.read ? { fromBook: true } : invented });
      return { source: fromBook.read ? "book" : "invented", layer };
    };

    section("16 / influence 20. the loyalty roll's apparent-level figure, unread then read");
    note("link the doubter to A", await run(gm, P.link, { employerId: A.id, hirelingId: hD.id, wage: 5 }));
    note("told A's level plus two", await run(gm, P.claimLevel, { hirelingId: hD.id, employerId: A.id, over: 2 }));
    note("unread", await run(gm, P.layerTable, { doc: "influence", id: "apparentLevel", table: printed0.apparentKnown ? {} : null }));
    const l20a = await run(gm, P.loyaltyRow, { hirelingId: hD.id, count: 2, roll: true });
    await markSeries("henchmen/card-loyalty-unread", "ChatMessage", l20a.chat);
    note("loyalty page, unread", l20a);
    check("16: unread, the apparent-level row is a typed field with the unread badge under its bare name, the page shows no notice, and it rolls to one of its own bands with no line for the row", l20a.opened && l20a.found && l20a.unread && l20a.labelBare && l20a.badges >= 1 && !l20a.notice && l20a.rolled && l20a.bandKey && !l20a.partShown, l20a);
    note("integration hidden", await run(gm, P.swapIntegration, { hosts: false }));
    const o20a = await run(gm, P.loyaltyOwn, { hirelingId: hD.id, count: 2 });
    note("the feature's own loyalty throw, unread", o20a);
    check("16: unread, the fallback throw counts the two levels, takes no per-level figure, and its info line names the count", o20a.opened && o20a.counted && o20a.stepIsFigure && o20a.infoNamesGap, o20a);
    note("integration back", await run(gm, P.swapIntegration, { hosts: true }));
    const apparent = await standFor("influence", "apparentLevel", printed0.apparentWorld, INVENTED_APPARENT);
    note("the apparent-level figure stands", apparent);
    check("changed: the apparent-level figure stands, from the world's import or read off the book through the shipped recipe", apparent.layer.apparentKnown && (apparent.source === "world" || apparent.source === "book"), { source: apparent.source });
    const l20b = await run(gm, P.loyaltyRow, { hirelingId: hD.id, count: 2, roll: true });
    await markSeries("henchmen/card-loyalty-read", "ChatMessage", l20b.chat);
    note("loyalty page, read", l20b);
    check("16: read, the row counts the two levels and adds two times the figure, the figure beside its name and no badge, and the roll's payload carries that line", l20b.opened && l20b.found && !l20b.unread && !l20b.labelBare && l20b.counted && l20b.contributes && l20b.badges === 0 && !l20b.notice && l20b.rolled && l20b.bandKey && l20b.partOk, l20b);
    note("integration hidden", await run(gm, P.swapIntegration, { hosts: false }));
    const o20b = await run(gm, P.loyaltyOwn, { hirelingId: hD.id, count: 2 });
    note("the feature's own loyalty throw, read", o20b);
    check("16: read, the fallback throw's stepper takes the figure per level and shows no info line", o20b.opened && o20b.counted && o20b.stepIsFigure && !o20b.info, o20b);
    note("integration back", await run(gm, P.swapIntegration, { hosts: true }));
    note("apparent-level layer lifted", await run(gm, P.layerTable, { doc: "influence", id: "apparentLevel", table: null }));

    section("16. the level-gain morale bonuses, unread then read");
    // The rungs stand first so each novice can start one level below the first
    // rung, and the gain made while unread lands on it; then they are shadowed.
    const rungs = await standFor("wages", "levelMorale", printed0.levelWorld, INVENTED_LEVEL_MORALE);
    note("the level-gain rungs stand", rungs);
    check("changed: the level-gain morale rungs stand, from the world's import or read off the book through the shipped recipe", rungs.layer.levelKnown && (rungs.source === "world" || rungs.source === "book"), { source: rungs.source });
    const [first, second] = await run(gm, P.rungLevels);
    const z0 = await keep("henchmen/novice-unread", novice("QA Novice unread", first - 1));
    note("link the unread novice to A", await run(gm, P.link, { employerId: A.id, hirelingId: z0.id, wage: 5 }));
    note("unread", await run(gm, P.layerTable, { doc: "wages", id: "levelMorale", table: {} }));
    const g0 = await run(gm, P.gainLevel, { hirelingId: z0.id, to: first });
    await markSeries("henchmen/card-gain-0", "ChatMessage", g0.chat);
    note("level gain onto the first rung, unread", g0);
    check("16: unread, a level gain onto the first rung records no morale bonus and its card says the bonuses are not imported", g0.gained && g0.recorded && g0.entries === 0 && g0.unreadCard && !g0.plainCard, g0);
    note("read again", await run(gm, P.layerTable, { doc: "wages", id: "levelMorale", table: rungs.source === "world" ? null : rungs.source === "book" ? { fromBook: true } : INVENTED_LEVEL_MORALE }));
    const z1 = await keep("henchmen/novice-read", novice("QA Novice read", first - 1));
    note("link the read novice to A", await run(gm, P.link, { employerId: A.id, hirelingId: z1.id, wage: 5 }));
    const g1 = await run(gm, P.gainLevel, { hirelingId: z1.id, to: "rung0" });
    await markSeries("henchmen/card-gain-1", "ChatMessage", g1.chat);
    note("level gain onto the first rung", g1);
    check("16: read, reaching the first rung records one morale entry at its bonus, its note naming the level, under the plain card", g1.gained && g1.recorded && g1.want === 1 && g1.entries === 1 && g1.match && g1.plainCard && !g1.unreadCard, g1);
    const g2 = await run(gm, P.gainLevel, { hirelingId: z1.id, to: "rung1" });
    await markSeries("henchmen/card-gain-2", "ChatMessage", g2.chat);
    note("level gain onto the second rung", g2);
    check("16: read, reaching the second rung records the second entry the same way", g2.gained && g2.recorded && g2.want === 1 && g2.entries === 1 && g2.match && g2.plainCard, g2);
    const led = await run(gm, P.ledgerShown, { employerId: A.id, hirelingId: z1.id });
    note("roster ledger", led);
    check("16: the roster's ledger shows both as level gains on the morale track, each note naming a rung's level", led.rendered && led.shown === 2 && led.notesMatch, led);
    const g3 = await run(gm, P.gainLevel, { hirelingId: z0.id, to: first + 1 });
    await markSeries("henchmen/card-gain-3", "ChatMessage", g3.chat);
    note("the unread novice's next gain", g3);
    check("16: a gain recorded while unread is not made up later: the unread novice's next gain records only the rungs it crosses itself", g3.gained && g3.recorded && g3.entries === (second === first + 1 ? 1 : 0) && g3.entries === g3.want && g3.match, g3);
    note("level-gain layer lifted", await run(gm, P.layerTable, { doc: "wages", id: "levelMorale", table: null }));
    note("closed", await run(gm, P.closeAll));
  }

  if (STAGE === "2") {
    section("fixtures (stage 2)");
    const player = await seat("player");
    const pc = await run(player, P.census, MOD);
    note("player census", pc);
    note("install (player)", await run(player, P.install));
    note("rules documents the world holds", await run(gm, P.docs));
    // The last run's hires and cards go first: its porters still answer to the
    // paymaster, and the roster read at step 12 counts every one.
    const retired = { company: await retireSeries("henchmen/company", "Actor"), porters: await retireSeries("henchmen/porter", "Actor") };
    for (const c of STAGE2_CARDS) retired[c] = await retireSeries(`henchmen/card-${c}`, "ChatMessage");
    note("retired", retired);
    const hall = await keep("henchmen/muster-hall", { name: "QA Muster Hall", type: "acks-extras.location" });
    note("market", await run(gm, P.addMarket, { locationId: hall.id, classOverride: 4 }));
    // The GM's posting dialog offers player characters only, and step 13's Player seat owns neither employer: a player who is not that seat owns both.
    const npcOwner = await gm.eval(`game.users.find((u) => !u.isGM && u.role >= CONST.USER_ROLES.PLAYER && u.id !== ${JSON.stringify(pc.userId)})?.id ?? null`);
    check("fixture: a player other than the Player seat can own the captain and the factor", !!npcOwner);
    const npcOwn = { default: 0, ...(npcOwner ? { [npcOwner]: 3 } : {}) };
    const A = await keep("henchmen/captain", { name: "QA Captain", type: "character", ownership: npcOwn, system: { scores: { cha: { value: 13 } }, details: { level: 5 } }, items: [] });
    const Pp = await keep("henchmen/paymaster", { name: "QA Paymaster", type: "character", ownership: { default: 0, [pc.userId]: 3 }, system: { scores: { cha: { value: 13 } }, details: { level: 4 } }, items: [] });
    note("paymaster owned by the player seat", await run(gm, P.own, { actorId: Pp.id, userId: pc.userId }));
    const hall2 = await keep("henchmen/exchange-town", { name: "QA Exchange Town", type: "acks-extras.location" });
    const N = await keep("henchmen/factor", { name: "QA Factor", type: "character", ownership: npcOwn, system: { scores: { cha: { value: 12 } }, details: { level: 4 } }, items: [] });
    const S = await keep("henchmen/second", { name: "QA Second", type: "character", ownership: { default: 0, [pc.userId]: 3 }, system: { details: { level: 2 } }, items: [] });

    section("10. Hire as Group from the Mercenaries tab");
    const troop = await run(gm, P.addCandidate, { locationId: hall.id, row: { name: "QA Spearmen", kind: "mercenary", troopType: "lightInfantry", segment: "mercenary:lightInfantry", level: 1, classKey: "fighter", hitDice: "1d8", attributes: { str: 13, int: 9, wil: 10, dex: 11, con: 12, cha: 8 }, wageGp: 6, quantity: 10 } });
    const sheetM = await run(gm, P.sheetRows, { locationId: hall.id, tab: "mercenaries" });
    note("sheet (mercenaries)", sheetM);
    const direct = !!census.character;
    if (direct) note("the GM seat has an assigned character, which the dialog would pick: the dialog is read and closed, and the engine is called for the captain", census.character);
    const hg = await run(gm, P.hireGroup, { locationId: hall.id, employerId: A.id, candidateId: troop.id, count: 4, direct });
    note("hire as group", hg);
    await markSeries("henchmen/company", "Actor", (hg.newActors ?? []).map((a) => a.id));
    await markSeries("henchmen/card-company", "ChatMessage", hg.chat);
    const rowsAfter = hg.rows ?? [];
    const orig = rowsAfter.find((r) => r.id === troop.id), hiredRow = rowsAfter.find((r) => r.id !== troop.id && r.name === "QA Spearmen" && r.status === "hired");
    check("10: the dialog opens for the employer with the troop row capped at the market's count", hg.pressed && hg.cells?.some((c) => c.name === `q_${troop.id}` && String(c.cap) === "10") && (direct || hg.employerPrompt || !!census.character === false), { employerPrompt: hg.employerPrompt, forLine: hg.forLine, cells: hg.cells, how: hg.how });
    check("10: a group named for the employer holds one stack of the count taken", !!hg.group && hg.group.name === `${A.name}'s Company` && hg.stacks?.length === 1 && hg.stacks[0].count === 4, { group: hg.group, stacks: hg.stacks?.map((st) => [st.label, st.count]) });
    check("10: the troop row keeps its id with the heads not taken, available; a new row of the count taken reads hired", orig?.status === "available" && orig?.quantity === 6 && !!hiredRow && hiredRow.quantity === 4, { orig, hiredRow });
    check("10: the stack's snapshot and the prototype it names carry the candidate's level, class, hit die and scores, and the prototype holds no items", hg.stacks?.[0]?.snap?.level === 1 && hg.stacks[0].snap.cls === "fighter" && hg.stacks[0].snap.hd === "1d8" && hg.stacks[0].snap.str === 13 && hg.proto?.level === 1 && hg.proto?.cls === "fighter" && hg.proto?.hd === "1d8" && hg.proto?.str === 13 && hg.proto?.items === 0, { snap: hg.stacks?.[0]?.snap, proto: hg.proto });
    note("closed", await run(gm, P.closeAll));

    await ensureOffer();
    note("player mirrors the world's documents", await run(player, P.reloadDocs));
    note("offer as the player reads it", await run(player, P.offerRead));

    section("12. an offer to part of a bulk row, head by head (player seat)");
    const porters = "QA Porters";
    const spec = await run(gm, P.addCandidate, { locationId: hall.id, row: { name: porters, kind: "specialist", specialistType: "laborer", segment: "specialist:laborer", level: 0, wageGp: 3, quantity: 20 } });
    note("coin for the paymaster", await run(gm, P.coin, { actorId: Pp.id, mint: 400 }));
    const purse0 = (await run(gm, P.coin, { actorId: Pp.id })).gp;
    const before12 = await run(gm, P.rowsOf, { locationId: hall.id, name: porters, employerId: Pp.id });
    const sheetS = await run(player, P.sheetRows, { locationId: hall.id, tab: "specialists" });
    note("sheet (specialists, player)", sheetS);
    const rowShown = sheetS.rows.some((r) => r.id === spec.id);
    const visibility = await run(gm, P.settingRead, { key: "playerMarketVisibility" });
    const viaApi = !!pc.character || !rowShown;
    if (pc.character) note("the player seat has an assigned character, which the sheet's button would pick: openRecruitDialog is called naming the paymaster", pc.character);
    if (!rowShown) note("the player's sheet lists a shared row only under an active posting the seat owns that covers its segment, and none covers it: openRecruitDialog is called as the row's Recruit button calls it, naming the paymaster", { visibility: visibility.value, rows: sheetS.rows.length });
    const offer = await run(player, P.bulkOffer, { locationId: hall.id, candidateId: spec.id, employerId: Pp.id, heads: 6, viaApi });
    note("offer", offer);
    check("12: the heads prompt opens for the bulk row at its quantity, and the page's subject reads the row's name ×6", !!offer.headsPrompt && String(offer.headsPrompt.max) === "20" && offer.opened && offer.subject === `${porters} ×6`, { prompt: offer.headsPrompt, subject: offer.subject, pressed: offer.pressed });
    const tiers = (offer.options ?? []).filter((o) => o.value !== "0");
    const tier1 = tiers[0] ?? null;
    const tierGp = tier1 ? Number((tier1.label.match(/^(\d+(?:\.\d+)?)/) ?? [])[1]) : null;
    note("signing tiers offered", { count: tiers.length, tier1: tier1 ? { value: tier1.value, gp: tierGp } : null });
    const SEQ = [0.01, 0.01, 0.99, 0.99, 0.5, 0.5, 0.2, 0.4, 0.8, 0.6, 0.1, 0.3];
    const roll = await run(player, P.bulkRoll, { tier: tier1?.value ?? null, seq: SEQ, waitFor: 5 });
    note("roll", roll);
    await markSeries("henchmen/card-porters-1", "ChatMessage", roll.chat);
    const headsCard = (roll.cards ?? []).find((c) => c.rolls.length === 5) ?? null;
    const tallyOf = (flavor) => { const out = {}; const tail = String(flavor ?? "").split(":").slice(1).join(":"); for (const part of tail.split("·")) { const m = part.trim().match(/^(\d+)\s+(.+)$/); if (!m) continue; const n = Number(m[1]), label = m[2]; const key = /slander/i.test(label) ? "refuseSlander" : /élan|elan/i.test(label) ? "acceptElan" : /try/i.test(label) ? "tryAgain" : /accept/i.test(label) ? "accept" : /refuse/i.test(label) ? "refuse" : label; out[key] = (out[key] ?? 0) + n; } return out; };
    const tally = headsCard ? tallyOf(headsCard.flavor) : {};
    const tallySum = Object.values(tally).reduce((a, b) => a + b, 0);
    check("12: one chat card shows five further hiring rolls and a tally whose counts sum to 6", !!headsCard && tallySum === 6, { card: headsCard, tally });
    await sleep(3000);
    let after12 = await run(gm, P.rowsOf, { locationId: hall.id, name: porters, employerId: Pp.id });
    if (after12.pending > 0) { note("hires queued (the seat could not create actors): materialized on the GM seat", await run(gm, P.materialize, { locationId: hall.id })); after12 = await run(gm, P.rowsOf, { locationId: hall.id, name: porters, employerId: Pp.id }); }
    const hired12 = await run(gm, P.hiredOf, { employerId: Pp.id });
    // The roster read names every porter hired so far, so each is marked once.
    const portersMarked = new Set(hired12.actors.map((a) => a.id));
    const nextPorter = await markSeries("henchmen/porter", "Actor", [...portersMarked]);
    note("rows after", after12);
    note("hired", hired12);
    const origRow = after12.rows.find((r) => r.id === spec.id);
    const split = after12.rows.filter((r) => r.id !== spec.id);
    const rowFor = (o) => split.find((r) => r.quantity === tally[o] && (o === "refuseSlander" ? r.status === "slandered" : o === "accept" || o === "acceptElan" ? r.status === "hired" : r.refusals.some((x) => x.employer && x.result === o)));
    const outcomesSeen = Object.keys(tally).filter((o) => tally[o] > 0);
    check("12: the row keeps its id at 14; each outcome that occurred is a row of its own carrying that many heads, a refusal naming the employer on a refusing row, and slandered on a slander row", origRow?.quantity === 14 && origRow?.status === "available" && outcomesSeen.length >= 2 && outcomesSeen.every((o) => !!rowFor(o)), { origRow, split, tally });
    check("12: the location's slander gains one entry per slandering head", after12.slander - before12.slander === (tally.refuseSlander ?? 0), { before: before12.slander, after: after12.slander, slandered: tally.refuseSlander ?? 0 });
    const acc = hired12.actors.find((a) => a.quantity === (tally.accept ?? -1)), elan = hired12.actors.find((a) => a.quantity === (tally.acceptElan ?? -1) && a !== acc);
    check("12: the accepting heads are one actor whose retainer.quantity is the accept count (an élan group a second, one loyalty higher)", (tally.accept ? !!acc : true) && (tally.acceptElan ? !!elan : true) && hired12.actors.length === (tally.accept ? 1 : 0) + (tally.acceptElan ? 1 : 0) && (acc && elan ? elan.loyalty === acc.loyalty + 1 : true), { actors: hired12.actors, tally });
    const purse1 = (await run(gm, P.coin, { actorId: Pp.id })).gp;
    const headsHired = (tally.accept ?? 0) + (tally.acceptElan ?? 0);
    if (tier1) check("12: the employer paid the signing bonus once per head hired", Math.abs((purse0 - purse1) - tierGp * headsHired) < 0.01, { purse0, purse1, tierGp, headsHired });
    else note("no signing tiers offered (the wages table is not in the world): the bonus-per-head observable is not checked", { purse0, purse1 });
    if (headsCard) { note("show card", await run(gm, P.showCard, { id: headsCard.id, frame: "card" })); await shot(gm, "henchmen-bulk-offer", '[data-qa-staged="1"]'); note("unstaged", await run(gm, P.unstageCard)); }
    note("closed (player)", await run(player, P.closeAll));
    const offer2 = await run(player, P.bulkOffer, { locationId: hall.id, candidateId: spec.id, employerId: Pp.id, heads: 14, viaApi });
    note("offer to the remainder", { prompt: offer2.headsPrompt, subject: offer2.subject, opened: offer2.opened });
    const roll2 = await run(player, P.bulkRoll, { tier: null, seq: [0.5, 0.5, 0.3, 0.7], waitFor: 13 });
    note("roll 2", { payload: roll2.payload, cards: roll2.cards?.length, draws: roll2.draws });
    await markSeries("henchmen/card-porters-2", "ChatMessage", roll2.chat);
    await sleep(3000);
    let after14 = await run(gm, P.rowsOf, { locationId: hall.id, name: porters, employerId: Pp.id });
    if (after14.pending > 0) { note("materialized", await run(gm, P.materialize, { locationId: hall.id })); after14 = await run(gm, P.rowsOf, { locationId: hall.id, name: porters, employerId: Pp.id }); }
    const hired14 = await run(gm, P.hiredOf, { employerId: Pp.id });
    await markSeries("henchmen/porter", "Actor", hired14.actors.map((a) => a.id).filter((id) => !portersMarked.has(id)), nextPorter);
    check("12: offered all 14 of the remainder, no row carries the old id", offer2.opened && offer2.subject === `${porters} ×14` && !after14.rows.some((r) => r.id === spec.id) && after14.rows.reduce((n, r) => n + (r.quantity ?? 0), 0) === 20, { rows: after14.rows });
    note("closed (player)", await run(player, P.closeAll));
    note("closed", await run(gm, P.closeAll));

    section("13. a posting with a mercantile network");
    note("market 2", await run(gm, P.addMarket, { locationId: hall2.id, classOverride: 5 }));
    note("second owned by the player seat", await run(gm, P.own, { actorId: S.id, userId: pc.userId }));
    note("network power on the factor", await run(gm, P.addTypedPower, { actorId: N.id, name: "Mercantile Network", target: "marketClass", flat: 2, condition: "in a market entered before" }));
    note("coin for the factor", await run(gm, P.coin, { actorId: N.id, mint: 300 }));
    note("coin for the captain", await run(gm, P.coin, { actorId: A.id, mint: 300 }));
    note("known", await run(gm, P.known, { actorId: N.id, locationId: hall2.id, known: true }));
    const pN = await run(gm, P.postingOpen, { locationId: hall2.id, employerId: N.id, place: true });
    note("posting dialog, factor", pN);
    check("13: the network row shows for the holder, ticked, with the counted note", pN.opened && pN.employerFound && pN.fieldShown && pN.checked === true && /^Counted here for /.test(pN.status), pN);
    await shot(gm, "henchmen-network-posting", ".application.posting-dialog");
    const pA = await run(gm, P.postingOpen, { locationId: hall2.id, employerId: A.id });
    check("13: picking an employer without the power hides the row", pA.opened && pA.employerFound && !pA.fieldShown, pA);
    note("posting dialog, factor again", await run(gm, P.postingOpen, { locationId: hall2.id, employerId: N.id }));
    const post1 = await run(gm, P.postingSubmit, { kind: "henchmanGeneral", network: true });
    note("post 1", { notes: post1.notes, cards: post1.cards?.map((c) => ({ rolls: c.rolls.length, fee: /search fee/i.test(c.flavor) })), stillOpen: post1.stillOpen });
    await markSeries("henchmen/card-posting-1", "ChatMessage", post1.chat);
    const fee1 = (post1.cards ?? []).find((c) => /search fee/i.test(c.flavor))?.flavor ?? "";
    const m1 = await run(gm, P.marketRead, { locationId: hall2.id, employerId: N.id, feeCardFlavor: fee1, feeClass: 3 });
    note("market after post 1", { marketClass: m1.marketClass, effective: m1.effective, postings: m1.postings, networkRolls: m1.networkRolls, marketRolls: m1.marketRolls, candidates: m1.candidates.length, networkCands: m1.candidates.filter((c) => c.networkFor === "employer").length, feeMatches: m1.feeMatches });
    const nr = m1.networkRolls.filter((r) => r.employer && r.month && /^henchman:/.test(r.segment));
    const henchLevels = m1.marketRolls.filter((r) => /^henchman:/.test(r.segment));
    check("13: networkRolls holds one row per henchman level for the employer at the month anchor, each at class 3", m1.effective === 3 && henchLevels.length > 0 && nr.length === henchLevels.length && nr.every((r) => r.marketClass === 3), { nr, levels: henchLevels.length, effective: m1.effective });
    const netCands = m1.candidates.filter((c) => c.networkFor === "employer");
    const excess = nr.reduce((sum, r) => sum + Math.max(0, r.total - (henchLevels.find((h) => h.segment === r.segment)?.total ?? 0)), 0);
    check("13: every candidate the network added carries networkFor the employer, and no candidate names anyone else", m1.candidates.every((c) => !c.networkFor || c.networkFor === "employer") && netCands.length === excess, { netCands: netCands.length, excess, foreign: m1.candidates.filter((c) => c.networkFor && c.networkFor !== "employer").length });
    const posting1 = m1.postings.find((p) => p.employer && p.network);
    const townTotal = henchLevels.reduce((sum, r) => sum + r.total, 0);
    check("13: the posting's totalAvailable is the town's henchman total plus, per level, the network roll's excess", !!posting1 && posting1.totalAvailable === townTotal + excess, { totalAvailable: posting1?.totalAvailable, townTotal, excess });
    check("13: the fee card's formula is the class-3 fee", m1.feeMatches[3] === true && m1.feeMatches[5] !== true, { feeMatches: m1.feeMatches, cardSeen: !!fee1 });
    const sheetP = await run(player, P.sheetRows, { locationId: hall2.id, tab: "henchmen" });
    const netIds = netCands.map((c) => c.id);
    check("13: from a seat owning only a second character none of the network rows show", sheetP.opened && netIds.length > 0 && !sheetP.rows.some((r) => netIds.includes(r.id)), { rows: sheetP.rows.length, netIds: netIds.length, tabFound: sheetP.tabFound });
    let netAvail = netCands.filter((c) => c.status === "available").map((c) => c.id);
    if (!netAvail.length) {
      note("no network find has arrived yet: the location's due-processing is run now on the GM seat", await run(gm, P.processNow, { locationId: hall2.id }));
      const m1b = await run(gm, P.marketRead, { locationId: hall2.id, employerId: N.id, feeCardFlavor: fee1, feeClass: 3 });
      netAvail = m1b.candidates.filter((c) => c.networkFor === "employer" && c.status === "available").map((c) => c.id);
      note("network finds by status", m1b.candidates.filter((c) => c.networkFor === "employer").map((c) => c.status));
    }
    const rw = netAvail.length ? await run(player, P.recruitWarn, { locationId: hall2.id, candidateId: netAvail[0], employerId: S.id }) : { notes: [], skipped: true, influenceOpen: false, throwOpen: false };
    check("13: openRecruitDialog for the second character warns that only the network's holder can hire, before any roll", rw.notes.some((n) => /Only the character whose mercantile network/.test(n.text)) && !rw.influenceOpen && !rw.throwOpen, rw);
    note("closed (player)", await run(player, P.closeAll));
    note("close posting", await run(gm, P.closePosting, { locationId: hall2.id, postingId: posting1?.id }));
    await run(gm, P.postingOpen, { locationId: hall2.id, employerId: N.id });
    const post2 = await run(gm, P.postingSubmit, { kind: "henchmanGeneral", network: true });
    note("post 2", { notes: post2.notes });
    await markSeries("henchmen/card-posting-2", "ChatMessage", post2.chat);
    const m2 = await run(gm, P.marketRead, { locationId: hall2.id, employerId: N.id });
    check("13: closing the posting and posting again adds no network roll and no candidate", m2.networkRolls.length === m1.networkRolls.length && m2.candidates.length === m1.candidates.length && m2.postings.length === m1.postings.length + 1, { networkRolls: [m1.networkRolls.length, m2.networkRolls.length], candidates: [m1.candidates.length, m2.candidates.length], postings: m2.postings.map((p) => [p.segment, p.status, p.network]) });
    await run(gm, P.postingOpen, { locationId: hall2.id, employerId: N.id });
    const post3 = await run(gm, P.postingSubmit, { kind: "mercenary", network: false });
    note("post 3", { notes: post3.notes });
    await markSeries("henchmen/card-posting-3", "ChatMessage", post3.chat);
    const fee3 = (post3.cards ?? []).find((c) => /search fee/i.test(c.flavor))?.flavor ?? "";
    const m3 = await run(gm, P.marketRead, { locationId: hall2.id, employerId: N.id, feeCardFlavor: fee3, feeClass: 5 });
    const merc = m3.postings.find((p) => /^mercenary/.test(p.segment ?? ""));
    check("13: a mercenary search with the box unticked rolls no network and pays the class-5 fee", !!merc && merc.network === false && m3.networkRolls.length === m2.networkRolls.length && m3.feeMatches[5] === true && m3.feeMatches[3] !== true, { merc, feeMatches: m3.feeMatches, networkRolls: [m2.networkRolls.length, m3.networkRolls.length] });
    note("closed", await run(gm, P.closeAll));

    section("3b. the market's henchman levels are the availability table's");
    await run(gm, P.postingOpen, { locationId: hall2.id, employerId: A.id });
    const lv = await run(gm, P.levelsRead, { locationId: hall2.id });
    check("3b: the dialog's level options, the month roll's henchman segments and a general posting's reach each name exactly the imported rows' levels", lv.rows && lv.options && lv.rolled && lv.reached, lv);
    note("closed", await run(gm, P.closeAll));

    // The ladder: the world's import where it holds one, else the book's read
    // through the shipped recipe, else an invented one; the last two stand
    // only in this client's memory. The levels typed are chosen in page and
    // never printed.
    section("3a. the employer-level cap on a leveled search");
    const c0 = await run(gm, P.capRead);
    note("employer-level cap as the world reads it", c0);
    let capSource = c0.known ? (c0.worldHolds ? "world" : "layer") : null;
    if (!capSource) {
      const fromBook = await run(gm, P.capFromBook);
      note("the ladder read off the book", fromBook);
      if (fromBook.read) capSource = "book";
      else note("no ladder from the world or the book: an invented one", (capSource = "invented"));
      note("registered at priority 30", await run(gm, P.overrideCap, { on: true, table: capSource === "invented" ? INVENTED_CAP : undefined }));
    }
    check("changed: the employer-level cap stands, from the world's import or read off the book through the shipped recipe", capSource === "world" || capSource === "book", { capSource });
    note("more coin for the captain", await run(gm, P.coin, { actorId: A.id, mint: 500 }));
    let capCard = 1;
    const leveled = async (label, args) => {
      await run(gm, P.postingOpen, { locationId: hall2.id, employerId: A.id });
      const r = await run(gm, P.postingLeveled, { locationId: hall2.id, employerId: A.id, ...args });
      capCard = await markSeries("henchmen/card-cap", "ChatMessage", r.chat, capCard);
      const seen = { fields: r.fields, landed: r.landed, capError: r.capError, notes: r.noteKinds };
      note(label, seen);
      return { ...r, seen };
    };
    await run(gm, P.postingOpen, { locationId: hall2.id, employerId: A.id });
    const plan = await run(gm, P.capPlan);
    const planned = plan.presented !== null;
    check("3a: the ladder holds a presented level whose cap the dialog's options exceed, and the open rung rises by its perLevel", planned && plan.openRises, { planned, openRises: plan.openRises });
    if (planned) {
      const atCap = await leveled("at the cap", { level: plan.at, presented: plan.presented, cap: plan.at });
      check("3a: a leveled search at the presented level's cap lands", atCap.landed && !atCap.capError, atCap.seen);
      const over = await leveled("one above the cap", { level: plan.at + 1, presented: plan.presented, cap: plan.at });
      check("3a: one level above the cap is refused, and the dialog's error names the cap", !over.landed && over.capError, over.seen);
      const ruler = await leveled("one above the cap, as a domain ruler", { level: plan.at + 1, presented: plan.presented, ruler: true, cap: plan.at });
      check("3a: the same search for a domain ruler lands", ruler.landed && !ruler.capError, ruler.seen);
      const open = await leveled("past the open rung's floor, the highest option", { level: plan.top, presented: plan.above });
      check("3a: past the open rung's floor the highest level option lands", plan.openAdmitsTop && open.landed && !open.capError, { openAdmitsTop: plan.openAdmitsTop, ...open.seen });
      if (capSource === "world") note("the world holds the ladder: the unread case would need its import unregistered, and is not checked live");
      else {
        note("the ladder unregistered", await run(gm, P.overrideCap, { on: false }));
        // The ruler's search holds that segment; a second active one for the
        // same employer is refused as a duplicate, so it is taken down first.
        const held = (await run(gm, P.marketRead, { locationId: hall2.id, employerId: A.id })).postings.find((p) => p.employer && p.status === "active" && p.segment === `henchman:${plan.at + 1}`);
        note("the ruler's search taken down", { found: !!held, status: held ? (await run(gm, P.closePosting, { locationId: hall2.id, postingId: held.id })).status : null });
        const unread = await leveled("one above the cap, no ladder", { level: plan.at + 1, presented: plan.presented, cap: plan.at });
        const none = await run(gm, P.capRead);
        check("3a: with no ladder no level has a cap, and the search above it lands", !none.known && unread.landed && !unread.capError, { known: none.known, ...unread.seen });
      }
    }
    note("closed", await run(gm, P.closeAll));
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try { if (gm) note("limit policy", await run(gm, P.limitPolicyRestore)); } catch (err) { console.error("limitPolicyRestore:", err?.message ?? err); }
  try { if (seats.player) { note("closed windows (player)", await run(seats.player, P.closeAll)); note("restored (player)", await run(seats.player, P.restore)); } } catch (err) { console.error("restore player:", err?.message ?? err); }
  try { if (gm && globalThis.__c1ImportedDoc) note("influence document removed", await run(gm, P.removeDoc, { id: "influence" })); } catch (err) { console.error("removeDoc:", err?.message ?? err); }
  for (const [key, api] of Object.entries(seats)) {
    note(`ledger (${key})`, "");
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
