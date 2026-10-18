/**
 * Live walk, formation-day: docs/formation/TESTING.md "The delve's
 * figures, imported", "The day change", "The frame", and the changed steps of
 * "The journey", "Swimming" and "The march in miles", with five release shots.
 * Machine values arrive through ./_env.mjs; nothing here names a port's owner,
 * a world or a seat. WALK_PLAN names an optional plan file that picks sections
 * ({ "sections": [...], "shots": true }). Every figure typed here
 * is invented; imported figures are compared in page context and never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir, logDir } from "./_env.mjs";

// WALK_PLAN names an optional plan file ({ "sections": [...], "shots": true }); without one every section runs and plates are taken under SHOTS=1.
const ALL_SECTIONS = ["probe","shot-importer","delve","swim","frame","journey","daychange"];
const PLAN = process.env.WALK_PLAN ? JSON.parse(fs.readFileSync(process.env.WALK_PLAN, "utf8")) : {};
const RUN = new Set(PLAN.sections ?? ALL_SECTIONS);
const SHOTS = PLAN.shots ?? process.env.SHOTS === "1";
const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "a1" + Math.random().toString(36).slice(2, 6);
const MOD = "acks-extras";
const SHOT_DIR = shotDir();

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
/**
 * A check whose failure docs/formation/ROADMAP.md names as unbuilt: it passes
 * as any check does, and where it fails showing that row's signature (`shows`)
 * it prints GAP and the row instead of FAIL. A failure without the signature
 * is a FAIL like any other.
 */
const gaps = [];
const gapCheck = (label, row, ok, shows, detail) => {
  if (ok || !shows) return check(label, ok, detail);
  gaps.push([label, row]);
  console.log(`GAP   ${label} (ROADMAP: ${row})${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const UNOWNED_PACE = "A player's pace with an unowned member";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  /** Helpers every other page function reaches through `globalThis.__a1`. */
  install: async () => {
    const H = (globalThis.__a1 = globalThis.__a1 ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 25, every = 100 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    H.t = acksExtras.lib.tables;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      model: await import(base + "formation/formation-model.mjs"),
      travel: await import(base + "formation/travel.mjs"),
      weather: await import(base + "formation/weather.mjs"),
      sky: await import(base + "formation/sky.mjs"),
      worldTime: await import(base + "lib/world-time.mjs"),
      nav: await import(base + "formation/navigation-card.mjs"),
      enc: await import(base + "formation/encounters.mjs"),
      encT: await import(base + "formation/encounter-terrains.mjs"),
      zone: await import(base + "formation/encounter-zone.mjs"),
      library: await import(base + "lib/library.mjs"),
    };
    H.formation = (id) => H.m.model.getFormation(id) ?? H.F.getFormations()[id] ?? null;
    H.loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
    if (!H.patched) {
      H.notes = [];
      H.logs = [];
      H.errors = [];
      H.orig = { notes: {}, console: {} };
      for (const k of ["info", "warn", "error"]) {
        H.orig.notes[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig.notes[k].call(this, msg, ...rest);
        };
      }
      for (const k of ["log", "error"]) {
        H.orig.console[k] = console[k];
        console[k] = function (...args) {
          try {
            const head = typeof args[0] === "string" ? args[0] : "";
            if (k === "error") H.errors.push({ text: args.map((a) => (a?.stack ?? (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))).join(" ").slice(0, 600) });
            else if (head.startsWith("acks-extras |")) H.logs.push({ head, arg: Array.isArray(args[1]) ? args[1].map(String) : (typeof args[1] === "number" ? args[1] : null) });
          } catch (_e) { /* recorder never throws */ }
          return H.orig.console[k].apply(this, args);
        };
      }
      H.onError = (ev) => H.errors.push({ text: `window error: ${ev?.error?.stack ?? ev?.message ?? ev}`.slice(0, 600) });
      H.onRejection = (ev) => H.errors.push({ text: `unhandled rejection: ${ev?.reason?.stack ?? ev?.reason ?? ev}`.slice(0, 600) });
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
      H.installedAt = Date.now();
      H.patched = true;
    }
    H.takeNotes = () => H.notes.splice(0);
    H.takeLogs = () => H.logs.splice(0);
    H.change = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    /** The run's own formations: a card is ours when it speaks as one of them or names one in its flag. */
    H.mineAliases = H.mineAliases ?? new Set();
    H.mineFids = H.mineFids ?? new Set();
    H.claim = ({ alias, fid, nonce }) => { if (alias) H.mineAliases.add(alias); if (fid) H.mineFids.add(fid); if (nonce) H.nonce = nonce; };
    /** Messages this seat authored since `t0`, id and uuid only plus what a check needs. */
    H.messagesSince = (t0) => game.messages.contents
      .filter((m) => (m.author?.id ?? m.user?.id) === game.user.id && m.timestamp >= t0 - 50)
      .map((m) => {
        const doc = new DOMParser().parseFromString(m.content ?? "", "text/html");
        const encounter = m.getFlag?.("acks-extras", "encounter") ?? null;
        const alias = m.speaker?.alias ?? null;
        const text = doc.body.textContent.replace(/\s+/g, " ").trim();
        return {
          id: m.id, uuid: m.uuid, whisper: (m.whisper ?? []).length, alias,
          navCard: !!doc.querySelector(".acks-extras-nav-card"),
          searchCard: !!doc.querySelector(".acks-extras-search-card"),
          text,
          encounter,
          // A fixture's name carries the run's nonce, so a card naming one is this run's.
          mine: H.mineAliases.has(alias) || (!!encounter && H.mineFids.has(encounter.formationId)) || (!!H.nonce && text.includes(H.nonce)),
        };
      });
    H.dialogs = () => [...foundry.applications.instances.values()].filter((a) => a.rendered && /Dialog/.test(a.constructor.name));
    return { ok: true, version: game.modules.get("acks-extras")?.version ?? null };
  },

  census: async (mod) => {
    const H = globalThis.__a1;
    const get = (k) => { try { return game.settings.get(mod, k); } catch (e) { return `unreadable: ${e.message}`; } };
    const cal = game.time.calendar;
    const seasons = cal?.seasons?.values ?? [];
    const panel = game.user.getFlag(mod, "partyPanel") ?? null;
    return {
      foundry: game.version,
      module: game.modules.get(mod)?.version ?? null,
      role: game.user.role,
      userId: game.user.id,
      activeRoles: game.users.filter((u) => u.active).map((u) => u.role).sort(),
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      settings: {
        travelEncounters: get("travelEncounters"),
        advanceWorldTime: get("advanceWorldTime"),
        calendarSeasonsBlank: String(get("calendarSeasons") ?? "") === "",
        dawnHour: get("dawnHour"),
        duskHour: get("duskHour"),
        skyCacheKeys: Object.keys(get("skyCache") ?? {}).length,
        fontScale: get("fontScale"),
      },
      worldTime: game.time.worldTime,
      calendar: cal ? {
        hoursPerDay: cal.days?.hoursPerDay, minutesPerHour: cal.days?.minutesPerHour, secondsPerMinute: cal.days?.secondsPerMinute,
        seasons: seasons.map((s) => game.i18n.localize(s.name ?? "")), seasonIndex: game.time.components?.season ?? null,
        hour: game.time.components?.hour ?? null,
      } : null,
      calendarDay: H?.m?.worldTime?.calendarDay?.() ?? null,
      calendarSeason: H?.m?.worldTime?.calendarSeason?.() ?? null,
      partyPanelKeys: panel ? Object.keys(panel).length : 0,
      formations: Object.keys(acksExtras.formation.getFormations()).length,
      journeying: Object.values(acksExtras.formation.getFormations()).filter((f) => f.travel?.mode === "journey").length,
      messages: game.messages.size,
    };
  },

  setSetting: async ({ mod, key, value }) => {
    const before = game.settings.get(mod, key);
    await game.settings.set(mod, key, value);
    await new Promise((r) => setTimeout(r, 300));
    return { before, after: game.settings.get(mod, key) };
  },

  /** The registry's view of the four documents the walk reads: layers and key NAMES, never values. */
  tablesState: async () => {
    const H = globalThis.__a1;
    const t = H.t;
    const out = {};
    for (const id of ["formation", "travel", "weather", "encounters"]) {
      const layers = {};
      for (const p of [0, 10, 20, 30]) {
        const l = t.getLayer(id, p);
        layers[p] = l ? { keys: Object.keys(l.tables ?? {}).sort(), source: l.source ?? null } : null;
      }
      out[id] = { hasDoc: t.hasDoc(id), layers };
    }
    let info = null;
    try { info = t.docInfo?.(); } catch (e) { info = `docInfo threw: ${e.message}`; }
    const pick = Array.isArray(info) ? info.filter((d) => ["formation", "travel"].includes(d?.id ?? d?.docId)) : info && typeof info === "object" ? Object.fromEntries(Object.entries(info).filter(([k]) => ["formation", "travel"].includes(k))) : info;
    const svc = acksExtras.lib.services?.get?.("ruledata-import") ?? null;
    let store = null;
    try { store = svc ? (await svc.listDocs()).filter((d) => ["formation", "travel", "weather", "encounters"].includes(d.id)).map((d) => ({ id: d.id, priority: d.priority, source: d.source ?? null })) : null; } catch (e) { store = `listDocs threw: ${e.message}`; }
    return {
      docs: out,
      docInfo: pick,
      store,
      service: !!svc,
      cite: { restInterval: t.citeOf?.("formation", "restInterval") ?? null, navigationBonus: t.citeOf?.("travel", "navigationBonus") ?? null },
    };
  },

  books: async ({ waitMs = 20000 } = {}) => {
    const H = globalThis.__a1;
    const I = acksExtras.importer;
    const open = await H.poll(() => !!I.bookOpen?.("rr"), { tries: Math.ceil(waitMs / 500), every: 500 });
    return { rr: !!open, fns: { bookOpen: typeof I.bookOpen, reimportShelf: typeof I.cookbookReimportShelf, reimportEntries: typeof I.cookbookReimportEntries, importTables: typeof I.cookbookImportTables } };
  },

  /** The settings window on the module's category, with the Calendar seasons group read back. */
  settingsWindow: async ({ mod }) => {
    const H = globalThis.__a1;
    const Cls = foundry.applications.settings.SettingsConfig;
    const app = new Cls({ initialCategory: mod });
    await app.render(true);
    await H.sleep(1200);
    try { app.changeTab(mod, "categories"); } catch (_e) { /* already there */ }
    await H.sleep(500);
    try { app.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
    await H.sleep(300);
    const el = H.root(app);
    const input = el?.querySelector(`[name="${mod}.calendarSeasons"]`);
    const group = input?.closest(".form-group") ?? null;
    if (group) group.scrollIntoView({ block: "center" });
    await H.sleep(300);
    const hint = group?.querySelector(".hint, p.hint")?.textContent.trim() ?? null;
    const label = group?.querySelector("label")?.textContent.trim() ?? null;
    group?.setAttribute("data-a1-shot", "calendar-seasons");
    return {
      appId: app.id, rendered: app.rendered, activeTab: app.tabGroups?.categories ?? null,
      found: !!input, inputTag: input?.tagName ?? null, label, hint,
      labelIsName: label === H.loc("ACKS-FORMATION.settings.calendarSeasons.name"),
      hintIsHint: hint === H.loc("ACKS-FORMATION.settings.calendarSeasons.hint"),
      visible: !!group && group.offsetParent !== null,
      rect: group ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(group.getBoundingClientRect()) : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  },

  closeSettings: async () => {
    let n = 0;
    for (const a of [...foundry.applications.instances.values()]) if (a.constructor.name === "SettingsConfig") { try { await a.close({ animate: false }); n++; } catch (_e) { /* closed */ } }
    return n;
  },

  /** Reimport One Shelf, opened and NOT awaited; the Rules tables group read back and `pick` chosen. */
  reimportDialog: async ({ pick = "tables:formation", listbox = true, width = null } = {}) => {
    const H = globalThis.__a1;
    window.__a1Reimport = acksExtras.importer.cookbookReimportShelf().then((v) => ({ resolved: typeof v }), (e) => ({ rejected: String(e?.message ?? e) }));
    const dlg = await H.poll(() => document.querySelector(".application.acks-extras-importer-dialog"), { tries: 50, every: 100 });
    if (!dlg) return { found: false };
    await H.sleep(400);
    const select = dlg.querySelector('select[name="pick"]');
    const groups = [...select.querySelectorAll("optgroup")].map((g) => ({ label: g.label, n: g.querySelectorAll("option").length }));
    const tablesGroup = [...select.querySelectorAll("optgroup")].find((g) => g.label === H.loc("ACKS-IMPORTER.ui.reimportGroupTables"));
    const tableValues = tablesGroup ? [...tablesGroup.querySelectorAll("option")].map((o) => o.value) : [];
    const allText = tablesGroup?.querySelector('option[value="tables:"]')?.textContent.trim() ?? null;
    select.value = pick;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    let shown = null;
    if (listbox && tablesGroup) {
      const rows = [...select.querySelectorAll("optgroup, option")];
      const first = rows.indexOf(tablesGroup);
      const visible = rows.length - first;
      select.size = Math.min(visible, 31);
      select.style.height = "auto";
      await H.sleep(200);
      const rowH = select.scrollHeight / rows.length;
      select.scrollTop = Math.round(first * rowH);
      select.focus();
      await H.sleep(200);
      shown = { rows: rows.length, first, size: select.size, rowH: Math.round(rowH * 10) / 10, scrollTop: select.scrollTop };
    }
    const app = [...foundry.applications.instances.values()].find((a) => H.root(a) === dlg) ?? null;
    try { app?.setPosition({ left: 16, top: 16, height: "auto", ...(width ? { width } : {}) }); } catch (_e) { /* fine */ }
    await H.sleep(300);
    if (listbox && tablesGroup) {
      select.scrollTop = Math.round([...select.querySelectorAll("optgroup, option")].indexOf(tablesGroup) * (select.scrollHeight / select.querySelectorAll("optgroup, option").length));
      await H.sleep(200);
    }
    const opt = select.querySelector(`option[value="${pick}"]`);
    const clipped = opt ? select.scrollWidth > select.clientWidth + 1 : null;
    const r = dlg.getBoundingClientRect();
    return {
      found: true, groups, tablesGroup: !!tablesGroup, tableValues, allSaysInPlace: allText === H.loc("ACKS-IMPORTER.ui.reimportTablesAll"),
      formationOne: tableValues.includes("tables:formation"), travelOne: tableValues.includes("tables:travel"),
      picked: select.value, shown, clipped, selectW: Math.round(select.getBoundingClientRect().width), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight }, appClass: app?.constructor?.name ?? null,
    };
  },

  /** Close the open Reimport One Shelf dialog without submitting it. */
  closeReimport: async () => {
    const H = globalThis.__a1;
    const dlg = document.querySelector(".application.acks-extras-importer-dialog");
    const app = dlg ? [...foundry.applications.instances.values()].find((a) => H.root(a) === dlg) : null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    const settled = await Promise.race([window.__a1Reimport ?? Promise.resolve(null), H.sleep(3000).then(() => "pending")]);
    return { closed: !!app, settled };
  },

  viewScene: async (sceneId) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 2500));
    return { viewed: canvas.scene?.id === sceneId, ready: canvas.ready };
  },

  /** Rig the d20 so a throw lands on `want` (1 or 20), and read one roll back. */
  rig: async ({ want }) => {
    const H = globalThis.__a1;
    if (!H.origUniform) H.origUniform = CONFIG.Dice.randomUniform;
    const read = async () => (await new Roll("1d20").evaluate()).total;
    for (const v of [0.975, 0.025]) {
      CONFIG.Dice.randomUniform = () => v;
      const got = await read();
      if (got === want) return { want, got, value: v };
    }
    return { want, got: await read(), value: null };
  },

  unrig: async () => {
    const H = globalThis.__a1;
    if (H.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; return { restored: true }; }
    return { restored: false };
  },

  /** Reimport One Shelf submitted with `pick`, its importer replaced by a recorder for that one submit. */
  reimportWiring: async ({ pick }) => {
    const H = globalThis.__a1;
    const I = acksExtras.importer;
    const orig = I.cookbookImportTables;
    const calls = [];
    let out = {};
    I.cookbookImportTables = async (...args) => { calls.push(JSON.parse(JSON.stringify(args))); return { recorded: true }; };
    try {
      const before = new Set([...foundry.applications.instances.keys()]);
      const p = I.cookbookReimportShelf().then((v) => ({ resolved: v && typeof v === "object" ? Object.keys(v) : v }), (e) => ({ rejected: String(e?.message ?? e) }));
      const dlg = await H.poll(() => document.querySelector(".application.acks-extras-importer-dialog"), { tries: 50, every: 100 });
      if (!dlg) return { found: false };
      const select = dlg.querySelector('select[name="pick"]');
      select.value = pick;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const ok = dlg.querySelector('button[data-action="ok"]') ?? dlg.querySelector('button[type="submit"]');
      const dlgId = [...before].length;
      ok?.click();
      await H.sleep(1500);
      const settled = await Promise.race([p, H.sleep(4000).then(() => "pending")]);
      const opened = [...foundry.applications.instances.values()].filter((a) => !before.has(a.id) && a.rendered).map((a) => a.constructor.name);
      out = { found: true, button: ok?.dataset?.action ?? ok?.type ?? null, calls, settled, opened, dialogGone: !document.querySelector(".application.acks-extras-importer-dialog"), dlgId };
    } finally {
      I.cookbookImportTables = orig;
    }
    out.restored = acksExtras.importer.cookbookImportTables === orig;
    return out;
  },

  /** Step 2's shapes, cites and travel keys: booleans only, no figure leaves the page. */
  delveShapes: async () => {
    const H = globalThis.__a1;
    const t = H.t;
    const w = t.getDoc("formation")?.tables ?? {};
    const travel = t.getDoc("travel")?.tables ?? {};
    const nav = travel.navigationBonus;
    const pos = (x) => typeof Number(x) === "number" && Number.isFinite(Number(x)) && Number(x) > 0;
    const share = (x) => pos(x) && Number(x) <= 1;
    const KEYS = ["restInterval", "carriedBodyStone", "carriedGearShare", "swimWaterModifiers", "swimmingBonus", "swimSpeedShare", "sinkFeetPerStone", "breathRounds"];
    const shape = {
      restInterval: Number.isInteger(Number(w.restInterval)) && Number(w.restInterval) > 0,
      carriedBodyStone: pos(w.carriedBodyStone), swimmingBonus: pos(w.swimmingBonus), sinkFeetPerStone: pos(w.sinkFeetPerStone), breathRounds: pos(w.breathRounds),
      carriedGearShare: share(w.carriedGearShare), swimSpeedShare: share(w.swimSpeedShare),
      swimWaterModifiers: !!w.swimWaterModifiers && Number(w.swimWaterModifiers.cold) < 0 && Number(w.swimWaterModifiers.rough) < 0,
      navigationBonus: !!nav && pos(nav.either) && pos(nav.both) && Number(nav.both) > Number(nav.either),
    };
    const cites = Object.fromEntries(KEYS.map((k) => [k, t.citeOf("formation", k)]));
    return {
      shape,
      citesAll271: KEYS.every((k) => cites[k] === "RR p.271"), citesSeen: [...new Set(Object.values(cites))],
      navCite: t.citeOf("travel", "navigationBonus"),
      travelKeys: Object.keys(travel).sort(), navigationProse: Object.hasOwn(travel, "navigationProse"),
      raw: { restProse: Object.hasOwn(w, "restProse"), swimmingProse: Object.hasOwn(w, "swimmingProse") },
      docInfo: (t.docInfo?.() ?? []).filter((d) => ["formation", "travel"].includes(d.id)),
      override: { formation: !!t.getLayer("formation", 30), travel: !!t.getLayer("travel", 30) },
    };
  },

  /** The ruledata browser's rows for the formation document. */
  browserRows: async () => {
    const H = globalThis.__a1;
    acksExtras.location.openRuledataBrowser();
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => a.rendered && (a.constructor.name === "RuledataBrowser" || H.root(a)?.classList?.contains("ruledata-browser")) && H.root(a)?.querySelector("tr[data-entry-key]")), { tries: 100, every: 200 });
    if (!app) return { found: false };
    await H.sleep(800);
    const el = H.root(app);
    const KEYS = ["restInterval", "carriedBodyStone", "carriedGearShare", "swimWaterModifiers", "swimmingBonus", "swimSpeedShare", "sinkFeetPerStone", "breathRounds"];
    const row = (k) => el.querySelector(`tr[data-entry-key="formation.${k}"]`);
    const rows = Object.fromEntries(KEYS.map((k) => {
      const r = row(k);
      return [k, r ? { absent: r.classList.contains("absent"), badge: !!r.querySelector(".absent-badge"), override: !!r.querySelector(".override-badge"), cite: r.querySelector(".cite")?.textContent.trim() ?? null } : null];
    }));
    const raw = { restProse: !!row("restProse"), swimmingProse: !!row("swimmingProse") };
    const navRow = el.querySelector('tr[data-entry-key="travel.navigationBonus"]');
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return { found: true, rows, raw, navRow: navRow ? { absent: navRow.classList.contains("absent"), cite: navRow.querySelector(".cite")?.textContent.trim() ?? null } : null };
  },

  /** The ten formation pages in the library's ruledata journal: present, and not placeholders. */
  journalPages: async () => {
    const H = globalThis.__a1;
    const pack = H.m.library.findLibraryPack("JournalEntry");
    if (!pack) return { pack: false };
    const index = await pack.getIndex({ fields: ["flags.acks-extras.ruledataDocs"] });
    const hit = index.find((e) => e.flags?.["acks-extras"]?.ruledataDocs) ?? index.find((e) => e.name === "ACKS Ruledata (Imported)") ?? null;
    const journal = hit ? await pack.getDocument(hit._id) : null;
    if (!journal) return { pack: true, packLabel: pack.metadata.label, journal: false };
    const KEYS = ["restInterval", "carriedBodyStone", "carriedGearShare", "swimWaterModifiers", "swimmingBonus", "swimSpeedShare", "sinkFeetPerStone", "breathRounds", "restProse", "swimmingProse"];
    const pages = Object.fromEntries(KEYS.map((k) => {
      const p = journal.pages.find((x) => x.name === `formation.${k}`);
      const c = String(p?.text?.content ?? "");
      return [k, p ? { filled: /<code[^>]*>[\s\S]*\S[\s\S]*<\/code>/.test(c) && !/<code>\{\}<\/code>/.test(c) } : null];
    }));
    const navPage = journal.pages.find((x) => x.name === "travel.navigationBonus");
    return { pack: true, packLabel: pack.metadata.label, journal: true, sidebar: !!game.journal.find((j) => j.name === "ACKS Ruledata (Imported)"), pages, navPage: !!navPage };
  },

  /** The entry picker reopened: whether the two Tables rows read held. */
  pickerHave: async () => {
    const H = globalThis.__a1;
    window.__a1Picker = acksExtras.importer.cookbookReimportEntries().then(() => "closed", () => "rejected");
    const input = await H.poll(() => document.querySelector('input[name="sel"][value="Tables|formation"]'), { tries: 100, every: 200 });
    const have = (v) => document.querySelector(`input[name="sel"][value="${v}"]`)?.closest("label")?.dataset.have ?? null;
    const out = { found: !!input, formation: have("Tables|formation"), travel: have("Tables|travel") };
    const dlg = input?.closest(".application");
    const app = dlg ? [...foundry.applications.instances.values()].find((a) => H.root(a) === dlg) : null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return out;
  },

  /** The party's formation once the createActor hook has made it; members dropped on its sheet. */
  enrolDrop: async ({ partyId, memberIds }) => {
    const H = globalThis.__a1;
    const f = await H.poll(() => Object.values(H.F.getFormations()).find((x) => x.actorId === partyId), { tries: 60, every: 200 });
    if (!f) return { error: "no formation for the party actor" };
    H.claim({ alias: f.name, fid: f.id });
    H.claim({ alias: game.actors.get(partyId)?.name });
    const party = game.actors.get(partyId);
    const app = await party.sheet.render(true);
    await H.sleep(1500);
    const el = H.root(app);
    const enrolled = [];
    for (const id of memberIds) {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const ok = await H.poll(() => H.F.getFormations()[f.id]?.members?.some((m) => m?.actorId === id), { tries: 40, every: 200 });
      enrolled.push(!!ok);
    }
    await H.sleep(500);
    return { fid: f.id, enrolled, mode: H.T.travelOf(H.formation(f.id)).mode ?? null };
  },

  /** Press the carrier chip on a member's row of the Order tab. */
  carrier: async ({ partyId, fid, actorId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    H.root(app)?.querySelector('.tabs [data-group="primary"][data-tab="order"]')?.click();
    await H.sleep(600);
    const chip = H.root(app)?.querySelector(`li.member[data-actor-id="${actorId}"] [data-action="toggleRole"][data-role="carrier"]`);
    if (!chip) return { found: false };
    chip.click();
    const ok = await H.poll(() => H.formation(fid)?.members?.find((m) => m.actorId === actorId)?.roles?.includes("carrier"), { tries: 40, every: 200 });
    return { found: true, carrier: !!ok };
  },

  /** What step 3 and step 5 read, compared in the page against the imported figures. */
  delveRead: async ({ partyId, fid, porterId, memberIds, render = true }) => {
    const H = globalThis.__a1;
    const w = H.t.getDoc("formation")?.tables ?? {};
    const f = H.formation(fid);
    const app = game.actors.get(partyId).sheet;
    if (render) { await app.render(); await H.sleep(1200); }
    const el = H.root(app);
    const restStat = [...(el?.querySelectorAll(".acks-extras-strip .stat") ?? [])].find((s) => s.querySelector(".stat-label")?.textContent.trim() === H.loc("ACKS-FORMATION.app.rest"));
    const restText = restStat?.querySelector(".value")?.textContent.trim() ?? null;
    const warnings = [...(el?.querySelectorAll("section.warnings p") ?? [])].map((p) => p.textContent.trim());
    const porterRow = el?.querySelector(`li.member[data-actor-id="${porterId}"] .details`)?.textContent ?? "";
    const arrow = /(\d+(?:\.\d+)?)→(\d+(?:\.\d+)?)/.exec(porterRow);
    const carrierWarn = warnings.find((x) => x.includes("→")) ?? "";
    const arrowW = /(\d+(?:\.\d+)?)→(\d+(?:\.\d+)?)/.exec(carrierWarn);
    const round1 = (n) => Math.round(n * 10) / 10;
    const effects = memberIds.map((id) => game.actors.get(id)?.effects?.some((e) => e.getFlag("acks-extras", "winded")) ?? null);
    return {
      winded: !!f?.clock?.winded,
      restIntervalOverItself: restText === `${w.restInterval}/${w.restInterval}`,
      restBareSlash: !!restText && /\/$/.test(restText),
      restBad: !!restStat?.classList.contains("bad"),
      windedBadge: restStat?.querySelector(".sub")?.textContent.trim() === H.loc("ACKS-FORMATION.app.windedBadge"),
      restDueWarn: warnings.includes(H.loc("ACKS-FORMATION.warnings.restDue")),
      windedWarn: warnings.includes(H.loc("ACKS-FORMATION.warnings.winded")),
      effects,
      porter: arrow ? { sameBothSides: arrow[1] === arrow[2], leftIsOwn: Number(arrow[1]) === Number(game.actors.get(porterId)?.system?.encumbrance?.value), leftNonZero: Number(arrow[1]) > 0, rightIsLeftPlusBody: round1(Number(arrow[1]) + Number(w.carriedBodyStone)) === Number(arrow[2]) } : null,
      porterWarn: arrowW ? { rightIsLeftPlusBody: round1(Number(arrowW[1]) + Number(w.carriedBodyStone)) === Number(arrowW[2]), sameRow: !!arrow && arrow[1] === arrowW[1] && arrow[2] === arrowW[2] } : null,
    };
  },

  /** `advanceTurns` on the record; `turns` may be "interval" for the imported rest interval. */
  advance: async ({ fid, turns, resting = false }) => {
    const H = globalThis.__a1;
    const n = turns === "interval" ? Number(H.t.getDoc("formation")?.tables?.restInterval) : Number(turns);
    const t0 = Date.now();
    const wt0 = game.time.worldTime;
    await H.F.advanceTurns(H.formation(fid), n, { resting });
    await H.sleep(1200);
    const msgs = H.messagesSince(t0);
    const mine = msgs.filter((m) => m.mine);
    return {
      messages: msgs.map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })),
      cards: mine.length, whispered: mine.filter((m) => m.whisper > 0).length,
      windedLine: mine.some((m) => m.text.includes(H.loc("ACKS-FORMATION.chat.windedStatus"))),
      becameWinded: mine.some((m) => m.text.includes(H.loc("ACKS-FORMATION.chat.becameWinded"))),
      recovered: mine.some((m) => m.text.includes(H.loc("ACKS-FORMATION.chat.restedRecovered"))),
      worldTimeDelta: game.time.worldTime - wt0,
    };
  },

  /** On the player seat: the party sheet opened, or read again WITHOUT a re-render. */
  playerRest: async ({ partyId, open = false, wantBad = null, close = false }) => {
    const H = globalThis.__a1;
    const party = game.actors.get(partyId);
    if (!party) return { visible: false };
    let app = party.sheet;
    if (open) { app = await party.sheet.render(true); await H.sleep(2500); }
    const read = () => {
      const el = H.root(app);
      const restStat = [...(el?.querySelectorAll(".acks-extras-strip .stat") ?? [])].find((s) => s.querySelector(".stat-label")?.textContent.trim() === H.loc("ACKS-FORMATION.app.rest"));
      return { rendered: !!app?.rendered, bad: !!restStat?.classList.contains("bad"), windedBadge: restStat?.querySelector(".sub")?.textContent.trim() === H.loc("ACKS-FORMATION.app.windedBadge"), found: !!restStat };
    };
    let out = read();
    if (wantBad !== null) {
      const t0 = performance.now();
      while (out.bad !== wantBad && performance.now() - t0 < 8000) { await H.sleep(250); out = read(); }
      out.waitedMs = Math.round(performance.now() - t0);
    }
    out.level = party.getUserLevel?.(game.user) ?? null;
    if (close) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return out;
  },

  /** Step 4: the swimming throw priced by the world's figures, compared in the page. */
  swimPriced: async () => {
    const H = globalThis.__a1;
    const w = H.t.getDoc("formation")?.tables ?? {};
    const s = acksExtras.formation.swimming;
    const close = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
    const cold = s.swimmingThrow({ encumbrance: 5, proficient: true, water: "cold" });
    const rough = s.swimmingThrow({ encumbrance: 5, proficient: true, water: "rough" });
    const d = s.drowning({ conMod: 1, encumbrance: 3 });
    return {
      coldUnknownEmpty: Array.isArray(cold.unknown) && cold.unknown.length === 0,
      coldPart: cold.parts.some((p) => p.key === "water.cold"),
      coldTarget: close(cold.target, 5 - Number(w.swimmingBonus) - Number(w.swimWaterModifiers?.cold)),
      roughPart: rough.parts.some((p) => p.key === "water.rough"),
      roughTarget: close(rough.target, 5 - Number(w.swimmingBonus) - Number(w.swimWaterModifiers?.rough)),
      speed: close(s.swimSpeed(120), 120 * Number(w.swimSpeedShare)),
      rounds: d.rounds === Number(w.breathRounds) + 1,
      feetPerRound: close(d.feetPerRound, 3 * Number(w.sinkFeetPerStone)),
      depth: close(d.depthAtDeath, (Number(w.breathRounds) + 1) * 3 * Number(w.sinkFeetPerStone)),
      rescue: close(s.rescueStone(4), Number(w.carriedBodyStone) + 4 * Number(w.carriedGearShare)),
    };
  },

  /** Step 6: competence on a forest journey, Pathfinding added, then the posted throw. */
  navStep: async ({ fid, scoutId, phase }) => {
    const H = globalThis.__a1;
    const nav = H.t.getDoc("travel")?.tables?.navigationBonus ?? {};
    const comp = () => {
      const c = H.T.navigationCompetence(H.formation(fid));
      return { navigation: c.navigation, pathfinding: c.pathfinding, unpriced: c.unpriced, eitherBonus: c.bonus === Number(nav.either), bothBonus: c.bonus === Number(nav.both), zero: c.bonus === 0 };
    };
    if (phase === "journey") {
      await H.T.setJourneyMode(fid, "journey");
      await H.T.applyTravelForm(fid, { override: { ground: "forest", road: "none" } });
      await H.sleep(600);
      const t = H.T.travelOf(H.formation(fid));
      return { mode: t.mode, ground: t.ground, road: t.road, competence: comp() };
    }
    if (phase === "pathfinding") {
      const [item] = await game.actors.get(scoutId).createEmbeddedDocuments("Item", [{ name: "Pathfinding", type: "ability" }]);
      await H.sleep(600);
      return { item: !!item, competence: comp() };
    }
    const before = (H.formation(fid)?.travel?.navigation?.history ?? []).length;
    const t0 = Date.now();
    const r = await H.m.nav.postNavigationThrow(H.formation(fid), { by: "judge", begin: async () => null });
    await H.sleep(1200);
    const msgs = H.messagesSince(t0);
    const navCards = msgs.filter((m) => m.navCard);
    // The card speaks as the navigator, not as the party: the one card this call made is ours.
    if (navCards.length === 1) navCards[0].mine = true;
    const card = navCards[0];
    return {
      navCards: navCards.length,
      messages: msgs.map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })),
      card: card ? { whispered: card.whisper > 0, both: card.text.includes(H.loc("ACKS-FORMATION.nav.both")), unpriced: card.text.includes(H.loc("ACKS-FORMATION.nav.bonusUnpriced")) } : null,
      historyGrew: (H.formation(fid)?.travel?.navigation?.history ?? []).length === before + 1,
      result: { throws: !!r?.result?.throws, success: r?.result?.success ?? null, natural: r?.result?.natural ?? null, opened: r?.opened ?? null },
    };
  },

  /** Swimming, steps 1 to 7, on this client's registry alone. Every figure here is invented. */
  swim: async ({ actorId }) => {
    const H = globalThis.__a1;
    const t = H.t;
    const s = acksExtras.formation.swimming;
    const actor = game.actors.get(actorId) ?? null;
    const acc = () => ({ swimmingBonus: s.swimmingBonus(), swimSpeedShare: s.swimSpeedShare(), sinkFeetPerStone: s.sinkFeetPerStone(), breathRounds: s.breathRounds() });
    const out = { actorSeen: !!actor, isGM: game.user.isGM };
    let fabricated = false;
    try {
      out.step1 = { worldHeld: t.hasDoc("formation"), worldLayer: !!t.getLayer("formation", 20) };
      t.unregisterTable("formation");
      out.step1.afterUnregister = t.hasDoc("formation");
      out.step2 = acc();
      out.step3 = { calm: s.waterModifier("calm"), rough: s.waterModifier("rough"), cold: s.waterModifier("cold") };
      const r4 = s.swimmingThrow({ actor, water: "rough" });
      const c4 = s.swimmingThrow({ actor, water: "calm" });
      out.step4 = { rough: { target: r4.target, needed: r4.needed, unknown: r4.unknown }, calm: { target: c4.target, needed: c4.needed, unknown: c4.unknown } };
      out.step5 = s.drowning({ actor });
      t.registerTable({ id: "formation", tables: { swimmingBonus: 77, swimSpeedShare: 0.42, sinkFeetPerStone: 88, breathRounds: 99, swimWaterModifiers: { calm: 0, rough: -55, cold: -66 } } }, { priority: t.PRIORITY.OVERRIDE, source: "live-check" });
      fabricated = true;
      const r6 = s.swimmingThrow({ actor, water: "rough" });
      out.step6 = { ...acc(), rough: { target: r6.target, unknown: r6.unknown, waterPart: r6.parts.find((p) => p.key === "water.rough") ?? null } };
      t.unregisterTable("formation", { priority: t.PRIORITY.OVERRIDE });
      fabricated = false;
      out.step7 = { swimmingBonus: s.swimmingBonus(), hasDoc: t.hasDoc("formation") };
    } finally {
      if (fabricated) { t.unregisterTable("formation", { priority: t.PRIORITY.OVERRIDE }); out.fabricatedRemovedInFinally = true; }
    }
    return out;
  },

  /** The world's store mirrored back into this client's registry. */
  reloadTables: async () => {
    const H = globalThis.__a1;
    const t = H.t;
    const svc = acksExtras.lib.services.get("ruledata-import");
    await svc.reload();
    await H.sleep(500);
    const l = t.getLayer("formation", 20);
    const tl = t.getLayer("travel", 20);
    return {
      formation: { hasDoc: t.hasDoc("formation"), layer20Keys: Object.keys(l?.tables ?? {}).length, bonusFromWorld: acksExtras.formation.swimming.swimmingBonus() === l?.tables?.swimmingBonus, override: !!t.getLayer("formation", 30) },
      travel: { hasDoc: t.hasDoc("travel"), layer20Keys: Object.keys(tl?.tables ?? {}).length, override: !!t.getLayer("travel", 30) },
    };
  },

  /** What the page-side recorder caught since it was installed (errors only; text clipped). */
  recorder: async () => {
    const H = globalThis.__a1;
    return { since: H.installedAt, errors: H.errors.slice(0, 20), count: H.errors.length };
  },

  /** Put the seat's own client state back: notifications, console, listeners, dice. */
  restoreSeat: async () => {
    const H = globalThis.__a1;
    const out = {};
    if (H?.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; out.diceRestored = true; }
    if (H?.patched) {
      for (const [k, fn] of Object.entries(H.orig.notes)) ui.notifications[k] = fn;
      for (const [k, fn] of Object.entries(H.orig.console)) console[k] = fn;
      window.removeEventListener("error", H.onError);
      window.removeEventListener("unhandledrejection", H.onRejection);
      H.patched = false;
      out.recorderRemoved = true;
    }
    return out;
  },

  /* ---------------------------- the frame ---------------------------- */

  /** The party token placed and adopted on the hex scene, then each member enrolled through the token HUD. */
  frameFixtures: async ({ sceneId, partyId, memberIds, xy }) => {
    const H = globalThis.__a1;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    const f = await H.poll(() => Object.values(H.F.getFormations()).find((x) => x.actorId === partyId), { tries: 60, every: 200 });
    if (!f) return { error: "no formation for the party actor" };
    H.claim({ alias: f.name, fid: f.id });
    H.claim({ alias: party.name });
    const td = await party.getTokenDocument({ x: xy.x, y: xy.y });
    const [token] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    const adopted = await H.poll(() => { const r = H.F.getFormations()[f.id]; return r?.tokenId === token.id && r?.sceneId === sceneId; }, { tries: 75, every: 200 });
    await H.sleep(2000);
    const out = { fid: f.id, tokenUuid: token.uuid, tokenId: token.id, adopted: !!adopted, mode: H.T.travelOf(H.formation(f.id)).mode, memberTokens: [], enrolled: [] };
    if (!adopted) return out;
    let i = 0;
    for (const id of memberIds) {
      const actor = game.actors.get(id);
      const mtd = await actor.getTokenDocument({ x: xy.x + 300 + 150 * i, y: xy.y + 300 });
      const [mt] = await scene.createEmbeddedDocuments("Token", [mtd.toObject()]);
      out.memberTokens.push(mt.uuid);
      const placeable = await H.poll(() => canvas.tokens.get(mt.id), { tries: 50, every: 100 });
      placeable?.control({ releaseOthers: true });
      await H.sleep(300);
      try { await canvas.hud.token.bind(placeable); } catch (e) { out.hudError = String(e?.message ?? e); }
      const btn = await H.poll(() => document.querySelector("#token-hud .acks-formation-hud"), { tries: 30, every: 100 });
      btn?.click();
      const ok = await H.poll(() => H.F.getFormations()[f.id]?.members?.some((m) => m?.actorId === id), { tries: 50, every: 200 });
      await H.sleep(800);
      out.enrolled.push({ hud: !!btn, ok: !!ok, tokenGone: !scene.tokens.get(mt.id) });
      try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
      i++;
    }
    return out;
  },

  /** Open (or re-open fresh) the party sheet at 16,16 and report where the band sits. */
  frameOpen: async ({ partyId, fresh = false, height = null }) => {
    const H = globalThis.__a1;
    const party = game.actors.get(partyId);
    if (fresh) {
      try { if (party.sheet?.rendered) await party.sheet.close({ animate: false }); } catch (_e) { /* closed */ }
      party._sheet = null;
    }
    const app = await party.sheet.render(true);
    await H.sleep(1800);
    try { app.setPosition({ left: 16, top: 16, ...(height ? { height } : {}) }); } catch (_e) { /* fine */ }
    await H.sleep(400);
    const el = H.root(app);
    const header = el.querySelector(":scope > .window-header");
    const bands = [...el.querySelectorAll('[data-application-part="band"]')];
    const controls = header?.querySelector("button[data-action=toggleControls]") ?? null;
    const band = bands[0] ?? null;
    const bar = el.querySelector(".acks-extras-party-sheet__bar");
    const r = bar?.getBoundingClientRect();
    return {
      appId: app.id, bands: bands.length, inHeader: !!band && band.parentElement === header,
      beforeControls: !!band && !!controls && !!(band.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING),
      controls: !!controls,
      bar: r ? { x: Math.round(r.x + Math.min(30, r.width / 2)), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), action: bar.getAttribute("data-action") } : null,
      left: app.position.left, top: app.position.top, tab: app.tabGroups?.primary ?? null,
    };
  },

  framePosition: async ({ partyId }) => {
    const app = game.actors.get(partyId).sheet;
    return { left: app.position.left, top: app.position.top, rendered: app.rendered };
  },

  /** Put the open sheet back at 16,16 with the mode tab showing and the Key closed. */
  frameHome: async ({ partyId, tab = "mode" }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const key = H.root(app)?.querySelector('.acks-extras-party-sheet__rail--sheet [data-action="toggleKey"][aria-pressed="true"]');
    if (key) { key.click(); await H.sleep(900); }
    try { app.changeTab(tab, "primary"); } catch (_e) { /* fine */ }
    try { app.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
    await H.sleep(500);
    for (const a of [...foundry.applications.instances.values()]) {
      if (a !== app && a.rendered && /Dialog|Picker|Config|Hp|HitPoint|HUD/.test(a.constructor.name)) { try { await a.close({ animate: false }); } catch (_e) { /* closed */ } }
    }
    try { await canvas.hud?.token?.close(); } catch (_e) { /* closed */ }
    return { tab: app.tabGroups?.primary ?? null, left: app.position.left, top: app.position.top };
  },

  /** The crest, then a new name typed into the band. */
  frameCrestName: async ({ partyId, fid, newName }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    try { app.changeTab("kit", "primary"); } catch (_e) { /* fine */ }
    await H.sleep(300);
    const before = app.tabGroups.primary;
    H.root(app).querySelector(".acks-extras-party-sheet__crest")?.click();
    await H.sleep(700);
    const crestTab = app.tabGroups.primary;
    H.claim({ alias: newName });
    const input = H.root(app).querySelector('[data-application-part="band"] input[name="name"]');
    input.value = newName;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ok = await H.poll(() => H.formation(fid)?.name === newName && game.actors.get(partyId)?.name === newName, { tries: 50, every: 200 });
    return { before, crestTab, record: H.formation(fid)?.name === newName, actor: game.actors.get(partyId)?.name === newName, ok: !!ok };
  },

  /** One mode, every pill pressed: the rails listed on each tab, and the readings the mode gives. */
  frameRails: async ({ partyId, fid, mode }) => {
    const H = globalThis.__a1;
    await H.T.setJourneyMode(fid, mode);
    await H.sleep(1200);
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(800);
    const root = () => H.root(app);
    const list = () => [...root().querySelectorAll(".acks-extras-party-sheet__art-row .acks-extras-party-sheet__rail")].map((r) => [...r.children].map((c) => {
      const a = c.dataset.action;
      if (!a) return "reading";
      return a + (c.dataset.tab ? `>${c.dataset.tab}` : "") + (c.dataset.check ? `:${c.dataset.check}` : "") + (c.dataset.save ? `.${c.dataset.save}` : "");
    }));
    const pills = [...root().querySelectorAll(".acks-extras-party-sheet__pill")].map((p) => p.dataset.tab);
    const labels = [...root().querySelectorAll(".acks-extras-party-sheet__pill")].map((p) => p.textContent.trim());
    const byTab = {};
    for (const tab of pills) {
      root().querySelector(`.acks-extras-party-sheet__pill[data-tab="${tab}"]`)?.click();
      await H.sleep(450);
      byTab[tab] = { active: app.tabGroups.primary, rails: list() };
    }
    root().querySelector('.acks-extras-party-sheet__pill[data-tab="mode"]')?.click();
    await H.sleep(400);
    const fig = root().querySelector(".acks-extras-party-sheet__rail--figures");
    const sub = (n) => fig?.children[n]?.querySelector(".acks-extras-party-sheet__cell-sub")?.textContent.trim() ?? null;
    const first = JSON.stringify(byTab[pills[0]]?.rails ?? null);
    const headActions = [...root().querySelectorAll('[data-application-part="mode"] header.acks-extras-party-sheet__head [data-action], [data-application-part="mode"] header.acks-extras-party-sheet__head [name]')].map((n) => n.dataset.action ?? n.getAttribute("name"));
    return {
      mode: H.T.travelOf(H.formation(fid)).mode, pills, labels,
      rails: byTab[pills[0]]?.rails ?? null, counts: (byTab[pills[0]]?.rails ?? []).map((r) => r.length),
      sameOnEveryTab: pills.every((t) => JSON.stringify(byTab[t].rails) === first),
      everyPillActivates: pills.every((t) => byTab[t].active === t),
      paceSub: sub(3), lightSub: sub(4), headActions,
    };
  },

  /** Press one rail cell on the journey and read what it did. */
  framePress: async ({ partyId, fid, which, tableId = null, marker = null }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const root = () => H.root(app);
    const cell = (sel) => root().querySelector(`.acks-extras-party-sheet__art-row ${sel}`);
    const t0 = Date.now();
    const wt0 = game.time.worldTime;
    const before = new Set([...foundry.applications.instances.values()]);
    const fresh = () => [...foundry.applications.instances.values()].filter((a) => !before.has(a) && a.rendered);
    const closeFresh = async () => { const names = []; for (const a of fresh()) { names.push(a.constructor.name); try { await a.close({ animate: false }); } catch (_e) { /* closed */ } } return names; };
    const out = { which };
    const msgs = () => H.messagesSince(t0);
    const mine = () => msgs().filter((m) => m.mine);
    const press = async (sel, wait = 1500) => { const c = cell(sel); out.found = !!c; c?.click(); await H.sleep(wait); return !!c; };
    if (which === "save") {
      await press('[data-action="partySave"]');
      const m = mine();
      out.cards = m.length;
      out.magicalNote = m.some((x) => x.text.includes(H.loc("ACKS-FORMATION.chat.saveMagical")));
      out.mundaneNote = m.some((x) => x.text.includes(H.loc("ACKS-FORMATION.chat.saveMundane")));
    } else if (which === "magical") {
      await press('[data-action="toggleMagical"]', 900);
      out.pressedAfter = cell('[data-action="toggleMagical"]')?.getAttribute("aria-pressed") ?? null;
      const c2 = cell('[data-action="partySave"]');
      c2?.click();
      await H.sleep(1500);
      const m = mine();
      out.cards = m.length;
      out.mundaneNote = m.some((x) => x.text.includes(H.loc("ACKS-FORMATION.chat.saveMundane")));
      out.magicalNote = m.some((x) => x.text.includes(H.loc("ACKS-FORMATION.chat.saveMagical")));
      cell('[data-action="toggleMagical"]')?.click();
      await H.sleep(900);
      out.pressedRestored = cell('[data-action="toggleMagical"]')?.getAttribute("aria-pressed") ?? null;
    } else if (which === "hp" || which === "xp" || which === "image" || which === "ownership") {
      const action = { hp: "adjustHp", xp: "dealXp", image: "editPartyImage", ownership: "ownership" }[which];
      await press(`[data-action="${action}"]`, 2200);
      out.opened = await closeFresh();
    } else if (which === "supplies") {
      await press('[data-action="consumeRations"]');
      const m = mine();
      out.cards = m.length;
      out.rations = m.some((x) => x.text.includes(H.loc("ACKS-FORMATION.chat.rationsTitle")));
    } else if (which === "mouths" || which === "pace" || which === "light") {
      const tab = { mouths: "order", pace: "mode", light: "kit" }[which];
      try { app.changeTab(which === "light" ? "order" : "kit", "primary"); } catch (_e) { /* fine */ }
      await H.sleep(300);
      out.from = app.tabGroups.primary;
      await press(`.acks-extras-party-sheet__rail--figures [data-action="goTab"][data-tab="${tab}"]`, 600);
      out.tab = app.tabGroups.primary;
      out.want = tab;
    } else if (which === "checks") {
      await press('[data-action="partyChecks"]', 1200);
      const dlg = fresh().find((a) => /Dialog/.test(a.constructor.name));
      const el = H.root(dlg);
      const buttons = [...(el?.querySelectorAll("footer button[data-action]") ?? [])].map((b) => b.dataset.action).filter((a) => a !== "close");
      out.dialog = !!dlg;
      out.buttons = buttons;
      el?.querySelector(`button[data-action="${buttons[0]}"]`)?.click();
      await H.sleep(1800);
      out.cards = mine().length;
    } else if (which === "pause") {
      await press('[data-action="togglePause"]', 1000);
      out.pausedBy1 = H.formation(fid)?.clock?.pausedBy ?? null;
      cell('[data-action="togglePause"]')?.click();
      await H.sleep(1000);
      out.pausedBy2 = H.formation(fid)?.clock?.pausedBy ?? null;
    } else if (which === "description") {
      await press('[data-action="editDescription"]', 1200);
      const pm = root().querySelector('.acks-extras-party-sheet__reading prose-mirror[name="system.description"]');
      out.editor = !!pm;
      if (pm) {
        // The element's own value setter fires input and change, as its save does.
        pm.value = `<p>${marker}</p>`;
        const ok = await H.poll(() => String(game.actors.get(partyId)?.system?.description ?? "").includes(marker), { tries: 40, every: 200 });
        out.saved = !!ok;
        await H.sleep(800);
        out.editorClosed = !root().querySelector('prose-mirror[name="system.description"]');
        out.proseShown = (root().querySelector(".acks-extras-party-sheet__prose")?.textContent ?? "").includes(marker);
      }
    } else if (which === "tweaks") {
      await press('[data-action="tweaks"]', 1200);
      const dlg = fresh().find((a) => /Dialog/.test(a.constructor.name));
      const el = H.root(dlg);
      const select = el?.querySelector('select[name="tableId"]');
      out.dialog = !!dlg;
      out.options = select ? select.options.length : 0;
      out.listsWorldTables = !!select && game.tables.contents.every((t) => [...select.options].some((o) => o.value === t.id));
      if (select) {
        select.value = tableId;
        el.querySelector('button[data-action="ok"]')?.click();
        const ok = await H.poll(() => H.formation(fid)?.tableId === tableId, { tries: 40, every: 200 });
        out.tableId = !!ok;
      }
    } else if (which === "key") {
      await press('[data-action="toggleKey"]', 1000);
      const key = root().querySelector("section.acks-extras-party-sheet__key");
      const art = root().querySelector(".acks-extras-party-sheet__art-row");
      out.legend = !!key;
      out.underArtRow = !!key && !!art && !!(art.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING);
      const glyph = (i) => [...i.classList].filter((c) => c !== "acks-extras-party-sheet__cell-glyph").sort().join(" ");
      const railGlyphs = [...root().querySelectorAll(".acks-extras-party-sheet__art-row .acks-extras-party-sheet__rail .acks-extras-party-sheet__cell-glyph")].map(glyph);
      const rows = [...(key?.querySelectorAll("li") ?? [])].map((li) => ({ g: glyph(li.querySelector("i") ?? document.createElement("i")), named: !!li.querySelector("span")?.textContent.trim() }));
      out.railGlyphs = railGlyphs.length;
      out.legendRows = rows.length;
      out.unnamedInLegend = railGlyphs.filter((g) => !rows.some((r) => r.g === g && r.named));
      cell('[data-action="toggleKey"]')?.click();
      await H.sleep(800);
    } else if (which === "encounter") {
      await press('[data-action="travelEncounterThrow"]', 2500);
      const m = msgs();
      out.cards = m.filter((x) => x.mine).length;
      out.encounterCard = m.some((x) => x.encounter?.formationId === fid);
    } else if (which === "search") {
      await press('[data-action="searchHour"]', 2500);
      const search = msgs().filter((x) => x.searchCard);
      // The one search card this press wrote is the run's own, whatever it speaks as.
      if (search.length === 1) out.forceMine = [search[0].id];
      out.searchCards = search.length;
      out.worldTimeDelta = game.time.worldTime - wt0;
    }
    const forced = new Set(out.forceMine ?? []);
    out.messages = msgs().map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine || forced.has(m.id) }));
    out.leftOpen = await closeFresh();
    return out;
  },

  /** Every fold control on the open sheet: how many, and in which part, section and head. */
  frameHomes: async ({ partyId, keys }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const where = (n) => ({ part: n.closest("[data-application-part]")?.dataset.applicationPart ?? null, section: n.closest("[data-section]")?.dataset.section ?? null, head: !!n.closest("header.acks-extras-party-sheet__head") });
    const out = {};
    for (const k of keys) {
      const sel = k.startsWith("@") ? `[data-action="${k.slice(1)}"]` : k.endsWith("*") ? `[name^="${k.slice(0, -1)}"]` : `[name="${k}"]`;
      out[k] = [...el.querySelectorAll(sel)].filter((n) => !n.closest(".acks-extras-party-sheet__art-row") && n.type !== "hidden").map(where);
    }
    const day = el.querySelector('[data-section="day"]');
    const camp = el.querySelector('[data-section="camp"]');
    out.$campAfterDay = !!day && !!camp && !!(day.compareDocumentPosition(camp) & Node.DOCUMENT_POSITION_FOLLOWING);
    out.$campForecastFirst = camp?.querySelector(".acks-extras-formation-camp")?.firstElementChild?.classList.contains("acks-extras-formation-camp-supply") ?? false;
    return out;
  },

  /** Change one field and re-read: `kind` is select (next option), check, or text. */
  frameField: async ({ partyId, fid, name, kind, value = null, path }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const field = H.root(app).querySelector(`[name="${name}"]`);
    if (!field) return { found: false };
    let want = value;
    if (kind === "select") {
      const options = [...field.options].map((o) => o.value);
      want = value ?? options.find((v) => v && v !== field.value) ?? null;
      field.value = want;
    } else if (kind === "check") {
      want = !field.checked;
      field.checked = want;
    } else {
      field.value = want;
    }
    field.dispatchEvent(new Event("change", { bubbles: true }));
    let recordOk = null;
    if (path) recordOk = !!(await H.poll(() => foundry.utils.getProperty(H.formation(fid), path) === want, { tries: 40, every: 200 }));
    await H.sleep(1200);
    const again = H.root(app).querySelector(`[name="${name}"]`);
    const shown = kind === "check" ? again?.checked : again?.value;
    return { found: true, want, recordOk, record: path ? foundry.utils.getProperty(H.formation(fid), path) ?? null : null, shown, shownKept: shown === want };
  },

  /** End day pressed once on the Wilderness head; the log and the Sightings tab read after. */
  frameEndDay: async ({ partyId, fid }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const t0 = Date.now();
    const wt0 = game.time.worldTime;
    const before = (H.formation(fid)?.travel?.log ?? []).length;
    H.root(app).querySelector('[data-application-part="mode"] header [data-action="travelEndDay"]')?.click();
    await H.poll(() => (H.formation(fid)?.travel?.log ?? []).length > before, { tries: 50, every: 200 });
    await H.sleep(1500);
    const after = (H.formation(fid)?.travel?.log ?? []).length;
    const rows = H.root(app).querySelectorAll('[data-application-part="sightings"] [data-section="log"] li, [data-application-part="sightings"] [data-section="log"] tr').length;
    return { before, after, rowsInSightings: rows, worldTimeDelta: game.time.worldTime - wt0, messages: H.messagesSince(t0).map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })) };
  },

  /** The player's view of the sheet. */
  framePlayer: async ({ partyId }) => {
    const H = globalThis.__a1;
    const party = game.actors.get(partyId);
    if (!party) return { visible: false };
    const app = await party.sheet.render(true);
    await H.sleep(2500);
    try { app.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
    const el = H.root(app);
    const rails = [...el.querySelectorAll(".acks-extras-party-sheet__art-row .acks-extras-party-sheet__rail")].map((r) => [...r.classList].find((c) => c.startsWith("acks-extras-party-sheet__rail--"))?.split("--")[1] ?? "?");
    const fig = el.querySelector(".acks-extras-party-sheet__rail--figures");
    const kids = [...(fig?.children ?? [])];
    const sheetTools = [...(el.querySelector(".acks-extras-party-sheet__rail--sheet")?.children ?? [])].map((c) => c.dataset.action ?? "reading");
    const modePart = el.querySelector('[data-application-part="mode"]');
    const lastSection = modePart ? [...modePart.children].filter((c) => c.tagName === "SECTION").pop() : null;
    const out = {
      level: party.getUserLevel(game.user),
      judgePart: !!el.querySelector('[data-application-part="judge"]'),
      judgeTab: !!el.querySelector('[data-tab="judge"]'),
      rails,
      sheetTools,
      hpReading: kids[0]?.tagName === "SPAN" && kids[0].classList.contains("is-reading") && !kids[0].dataset.action,
      suppliesReading: kids[1]?.tagName === "SPAN" && kids[1].classList.contains("is-reading") && !kids[1].dataset.action,
      modeText: el.querySelector('[data-application-part="band"] .acks-extras-party-sheet__mode')?.tagName ?? null,
      nameText: el.querySelector('[data-application-part="band"] .acks-extras-party-sheet__name')?.tagName ?? null,
      noModeSelect: !el.querySelector('[data-application-part="band"] select'),
      noNameInput: !el.querySelector('[data-application-part="band"] input'),
      endsWithRequests: !!lastSection && lastSection.classList.contains("player-actions"),
      requests: !!modePart?.querySelector("section.player-actions"),
      sections: [...(modePart?.querySelectorAll("[data-section]") ?? [])].map((s) => s.dataset.section),
    };
    for (const [which, tab] of [["mouths", "order"], ["light", "kit"]]) {
      try { app.changeTab("sightings", "primary"); } catch (_e) { /* fine */ }
      await H.sleep(300);
      el.querySelector(`.acks-extras-party-sheet__rail--figures [data-action="goTab"][data-tab="${tab}"]`)?.click();
      await H.sleep(500);
      out[`${which}Opens`] = app.tabGroups.primary === tab;
    }
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    out.panelHidden = el.classList.contains("is-panel-hidden");
    return out;
  },

  /** The GM seat's Judge pill and part. */
  frameJudgePill: async ({ partyId }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const pill = el.querySelector('.acks-extras-party-sheet__pill[data-tab="judge"]');
    return { pill: !!pill, dashed: pill ? getComputedStyle(pill).borderTopStyle === "dashed" : false, part: !!el.querySelector('[data-application-part="judge"]') };
  },

  /** The chevron: hide, survive a render and a reopen, then a pill shows the panel again. */
  frameChevron: async ({ partyId, phase }) => {
    const H = globalThis.__a1;
    const party = game.actors.get(partyId);
    const flag = () => (game.user.getFlag("acks-extras", "partyPanel") ?? {})[partyId] ?? null;
    const tabsShown = (el) => ["mode", "order", "kit", "sightings", "judge"].map((p) => el.querySelector(`[data-application-part="${p}"]`)).filter(Boolean).filter((n) => n.offsetParent !== null).length;
    if (phase === "hide") {
      const app = party.sheet;
      const h0 = H.root(app).offsetHeight;
      H.root(app).querySelector('[data-action="togglePanel"]')?.click();
      await H.poll(() => H.root(app)?.classList.contains("is-panel-hidden"), { tries: 30, every: 100 });
      await H.sleep(900);
      const el = H.root(app);
      const hidden = { cls: el.classList.contains("is-panel-hidden"), tabsShown: tabsShown(el), h0, h1: el.offsetHeight, flag: flag() };
      await app.render();
      await H.sleep(1200);
      const afterRender = { cls: H.root(app).classList.contains("is-panel-hidden"), tabsShown: tabsShown(H.root(app)) };
      await app.close({ animate: false });
      await H.sleep(500);
      const reopened = await party.sheet.render(true);
      await H.sleep(1800);
      try { reopened.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
      const afterReopen = { cls: H.root(reopened).classList.contains("is-panel-hidden"), tabsShown: tabsShown(H.root(reopened)) };
      return { hidden, afterRender, afterReopen };
    }
    if (phase === "show") {
      const app = party.sheet;
      H.root(app).querySelector('.acks-extras-party-sheet__pill[data-tab="order"]')?.click();
      await H.poll(() => !H.root(app)?.classList.contains("is-panel-hidden"), { tries: 30, every: 100 });
      await H.sleep(900);
      const el = H.root(app);
      return { cls: el.classList.contains("is-panel-hidden"), tab: app.tabGroups.primary, orderShown: el.querySelector('[data-application-part="order"]')?.offsetParent !== null, flag: flag() };
    }
    // "peek": another seat's view of the same sheet and its own flag
    const app = party.sheet;
    return { rendered: !!app?.rendered, cls: app?.rendered ? H.root(app).classList.contains("is-panel-hidden") : null, flag: flag(), tabsShown: app?.rendered ? tabsShown(H.root(app)) : null };
  },

  /** Remove the fixture actor's key from this seat's partyPanel flag and read the flag back. */
  framePanelFlagClear: async ({ partyId }) => {
    const before = (game.user.getFlag("acks-extras", "partyPanel") ?? {});
    const had = Object.hasOwn(before, partyId);
    if (had) await game.user.unsetFlag("acks-extras", `partyPanel.${partyId}`);
    await new Promise((r) => setTimeout(r, 400));
    const after = (game.user.getFlag("acks-extras", "partyPanel") ?? {});
    return { had, gone: !Object.hasOwn(after, partyId), keysLeft: Object.keys(after).length };
  },

  /** Measure the fresh sheet at the seat's type size: width, a rail cell, the bar, k, overflow census. */
  frameMeasure: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const cell = el.querySelector(".acks-extras-party-sheet__art-row .acks-extras-party-sheet__cell");
    const bar = el.querySelector(".acks-extras-party-sheet__bar");
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:calc(1000px * var(--acks-extras-k));height:1px;";
    el.querySelector(".window-content")?.appendChild(probe);
    const k = probe.getBoundingClientRect().width / 1000;
    probe.remove();
    const header = el.querySelector(":scope > .window-header");
    const band = el.querySelector('[data-application-part="band"]');
    const sig = (n) => `${n.tagName.toLowerCase()}${n.dataset.applicationPart ? `[part=${n.dataset.applicationPart}]` : ""}${n.dataset.section ? `[section=${n.dataset.section}]` : ""}.${[...n.classList].slice(0, 2).join(".")}`;
    const over = [];
    for (const n of el.querySelectorAll("*")) {
      if (n.offsetParent === null) continue;
      const cs = getComputedStyle(n);
      const x = n.scrollWidth > n.clientWidth + 1 && /hidden|auto|scroll|clip/.test(cs.overflowX);
      const y = n.scrollHeight > n.clientHeight + 1 && /hidden|auto|scroll|clip/.test(cs.overflowY);
      if (x || y) over.push(`${sig(n)}${x ? ":x" : ""}${y ? ":y" : ""}`);
    }
    const partScroll = Object.fromEntries(["mode", "order", "kit", "sightings", "judge"].map((p) => [p, getComputedStyle(el.querySelector(`[data-application-part="${p}"]`) ?? document.body).overflowY]));
    return {
      fontScale: game.settings.get("acks-extras", "fontScale"),
      width: Math.round(el.getBoundingClientRect().width * 10) / 10,
      cell: Math.round((cell?.getBoundingClientRect().height ?? 0) * 10) / 10,
      bar: Math.round((bar?.getBoundingClientRect().height ?? 0) * 10) / 10,
      k: Math.round(k * 10000) / 10000,
      bandInHeader: !!band && !!header && band.getBoundingClientRect().bottom <= header.getBoundingClientRect().bottom + 0.5,
      partScroll,
      overflow: [...new Set(over)].sort(),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  },

  /** The short window: Wilderness scrolled, a field changed, the scroll read again. */
  frameShortScroll: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    app.setPosition({ height: 520 });
    await H.sleep(600);
    let el = H.root(app);
    let part = el.querySelector('[data-application-part="mode"]');
    const wc = el.querySelector(".window-content");
    const short = {
      frameH: Math.round(el.getBoundingClientRect().height), wcClient: wc.clientHeight, wcScroll: wc.scrollHeight,
      partClient: part.clientHeight, partScroll: part.scrollHeight,
    };
    part.scrollTop = Math.round((part.scrollHeight - part.clientHeight) / 2);
    await H.sleep(300);
    const scrolled = part.scrollTop;
    const sel = part.querySelector('select[name="travel.weather.wind"]') ?? part.querySelector('select[name="travel.hour"]');
    const name = sel?.getAttribute("name") ?? null;
    if (sel) {
      const opts = [...sel.options].map((o) => o.value);
      sel.value = opts.find((v) => v !== sel.value) ?? sel.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await H.sleep(2200);
    el = H.root(app);
    part = el.querySelector('[data-application-part="mode"]');
    return {
      short, scrolled, field: name,
      after: { scrollTop: part.scrollTop, partClient: part.clientHeight, partScroll: part.scrollHeight, frameH: Math.round(el.getBoundingClientRect().height), stillOverflows: part.scrollHeight > part.clientHeight + 1 },
      kept: Math.abs(part.scrollTop - scrolled) <= 2,
    };
  },

  /** The window narrowed toward its floor: controls cut off with no scroller to reach them. */
  frameNarrow: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    app.setPosition({ width: 640, height: 700 });
    await H.sleep(800);
    const el = H.root(app);
    const width = Math.round(el.getBoundingClientRect().width);
    const minWidth = getComputedStyle(el).minWidth;
    const scroller = (n) => { for (let p = n.parentElement; p && p !== el; p = p.parentElement) { const cs = getComputedStyle(p); if (/auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return p; } return null; };
    const box = el.getBoundingClientRect();
    const cut = [];
    for (const n of el.querySelectorAll("button, input:not([type=hidden]), select, textarea, a[href], [data-action]")) {
      if (n.offsetParent === null) continue;
      const r = n.getBoundingClientRect();
      if (r.width === 0) continue;
      if ((r.right > box.right + 1 || r.left < box.left - 1) && !scroller(n)) cut.push(`${n.tagName.toLowerCase()}[${n.dataset.action ?? n.getAttribute("name") ?? ""}]`);
    }
    const clipped = [];
    for (const n of el.querySelectorAll("*")) {
      if (n.offsetParent === null) continue;
      const cs = getComputedStyle(n);
      if (/hidden|clip/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) clipped.push(`${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 2).join(".")}`);
    }
    return { width, minWidth, cut: [...new Set(cut)], clipped: [...new Set(clipped)].slice(0, 20), clippedCount: clipped.length };
  },

  /** Tag every focusable control of the regions the keyboard must reach, in DOM order. */
  frameFocusables: async ({ partyId }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const regions = [
      ["band", el.querySelector('[data-application-part="band"]')],
      ["rails", el.querySelector(".acks-extras-party-sheet__art-row")],
      ["tabs", el.querySelector("nav.acks-extras-party-sheet__tabs")],
      ["mode", el.querySelector('[data-application-part="mode"]')],
    ];
    const focusable = (n) => n.offsetParent !== null && !n.disabled && n.tabIndex >= 0 && !n.closest("[inert]") && n.type !== "hidden"
      && (n.matches("button, input, select, textarea, a[href], [tabindex]"));
    const nameOf = (n) => {
      const aria = n.getAttribute("aria-label");
      if (aria?.trim()) return "aria";
      const lab = n.labels?.[0] ?? n.closest("label");
      if (lab?.textContent.trim()) return "label";
      if (n.tagName !== "INPUT" && n.tagName !== "SELECT" && n.tagName !== "TEXTAREA" && n.textContent.trim()) return "text";
      if (n.dataset.tooltip?.trim() || n.title?.trim()) return "tooltip";
      if (n.placeholder?.trim()) return "placeholder";
      return null;
    };
    const list = [];
    let k = 0;
    for (const [region, root] of regions) {
      for (const n of root?.querySelectorAll("*") ?? []) {
        if (!focusable(n)) continue;
        n.dataset.a1k = String(k);
        list.push({ k, region, tag: n.tagName.toLowerCase(), id: n.dataset.action ?? n.getAttribute("name") ?? n.className?.split?.(" ")?.[0] ?? null, named: nameOf(n), section: n.closest("[data-section]")?.dataset.section ?? null, requests: !!n.closest("section.player-actions") });
        k++;
      }
    }
    el.querySelector(".acks-extras-party-sheet__crest")?.focus();
    return { list, start: document.activeElement?.dataset?.a1k ?? null };
  },

  /** What holds focus now, for the Tab walk. */
  frameFocused: async ({ partyId }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const a = document.activeElement;
    return { k: a?.dataset?.a1k ?? null, inWindow: !!a && el.contains(a), tag: a?.tagName?.toLowerCase() ?? null, id: a?.dataset?.action ?? a?.getAttribute?.("name") ?? null, reading: !!a?.closest?.(".is-reading") };
  },

  /** The Hunted here pill's box-shadow and outline as they stand, and whether its checkbox holds focus. */
  frameHuntedRing: async ({ partyId }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const input = el.querySelector('input[name="travel.settlement.wanted"]');
    const label = input?.closest("label");
    if (!input || !label) return { found: false };
    const cs = getComputedStyle(label);
    return { found: true, focused: document.activeElement === input, focusVisible: input.matches(":focus-visible"), boxShadow: cs.boxShadow, outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
  },

  /** No tooltip up, no focus held: what a shot or a measurement wants under it. */
  calm: async () => {
    try { game.tooltip?.deactivate?.(); } catch (_e) { /* none */ }
    try { document.activeElement?.blur?.(); } catch (_e) { /* none */ }
    await new Promise((r) => setTimeout(r, 200));
    return { tooltip: !!document.querySelector("#tooltip.active, aside#tooltip.active") };
  },

  /** The run's nonce, so a card naming one of its fixtures counts as the run's own. */
  claimNonce: async ({ nonce }) => {
    globalThis.__a1.claim({ nonce });
    return { nonce: globalThis.__a1.nonce === nonce };
  },

  /** Put the formation in a mode and redraw the open sheet on the mode tab. */
  frameMode: async ({ partyId, fid, mode }) => {
    const H = globalThis.__a1;
    await H.T.setJourneyMode(fid, mode);
    await H.sleep(1000);
    const app = game.actors.get(partyId).sheet;
    if (app.rendered) {
      await app.render();
      await H.sleep(600);
      try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
      try { app.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
    }
    return { mode: H.T.travelOf(H.formation(fid)).mode };
  },

  /* ------------------------- journey and march ------------------------- */

  /** What the clock reads: the hour, whether it is dark, the calendar day. */
  clockNow: async () => {
    const H = globalThis.__a1;
    const r = H.m.worldTime.clockReading();
    return { hour: r?.hour ?? null, minute: r?.minute ?? null, dark: r?.dark ?? null, dawn: r?.dawn ?? null, dusk: r?.dusk ?? null, day: H.m.worldTime.calendarDay() };
  },

  /** The band's mode select changed on this seat, and the window read after the re-render. */
  jMode: async ({ partyId, fid, mode }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const sel = H.root(app)?.querySelector('[data-application-part="band"] select[name="travel.mode"]');
    if (!sel) return { found: false };
    const offered = [...sel.options].map((o) => o.value);
    H.change(sel, mode);
    const ok = !!(await H.poll(() => H.T.travelOf(H.formation(fid)).mode === mode, { tries: 50, every: 200 }));
    await H.sleep(1500);
    const el = H.root(app);
    const f = H.formation(fid);
    const token = game.scenes.get(f?.sceneId)?.tokens.get(f?.tokenId) ?? null;
    const part = el.querySelector('[data-application-part="mode"]');
    const strip = part?.querySelector("section.acks-extras-strip");
    const firstSection = part?.querySelector("[data-section]");
    const want = { delve: "dungeon", journey: "wilderness", settlement: "city" }[mode];
    const lp = f?.clock?.lastPosition ?? null;
    return {
      found: true, offered, ok, mode: H.T.travelOf(f).mode,
      pill: el.querySelector('.acks-extras-party-sheet__pill[data-tab="mode"]')?.textContent.trim() ?? null,
      wantPill: H.loc(`ACKS-FORMATION.tab.${want}`),
      strip: strip ? [...strip.classList].find((c) => c.startsWith("acks-extras-strip-")) ?? null : null,
      stripBeforeSections: !!strip && !!firstSection && !!(strip.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING),
      sections: [...(part?.querySelectorAll("[data-section]") ?? [])].map((s) => s.dataset.section),
      paused: f?.clock?.paused ?? null, pausedBy: f?.clock?.pausedBy ?? null,
      lastPosition: lp, token: token ? { x: token.x, y: token.y } : null,
      anchored: !!lp && !!token && lp.x === token.x && lp.y === token.y,
      day: JSON.parse(JSON.stringify(f?.travel?.day ?? null)),
    };
  },

  /** The day board's slot selects as drawn, and the record's activities. */
  jSlots: async ({ partyId, fid }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const day = H.formation(fid)?.travel?.day ?? {};
    return {
      selects: [...el.querySelectorAll('select[name^="travel.day.slot."]')].map((s) => ({ name: s.getAttribute("name"), value: s.value, disabled: s.disabled })),
      activities: day.activities ?? null, kind: day.kind ?? null,
    };
  },

  /** A slot edit sent straight to applyTravelForm, and the activities read back. */
  jRefuse: async ({ fid }) => {
    const H = globalThis.__a1;
    const before = [...(H.formation(fid)?.travel?.day?.activities ?? [])];
    await H.T.applyTravelForm(fid, { day: { slot: { 0: "hunt", 1: "search" } } });
    await H.sleep(800);
    const after = [...(H.formation(fid)?.travel?.day?.activities ?? [])];
    return { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) };
  },

  /** The journey readout on THIS client's registry: with no travel document, with invented rows, then the world's put back. Every figure typed here is invented. */
  jReadout: async ({ partyId, fid, phase }) => {
    const H = globalThis.__a1;
    const t = H.t;
    const view = await import("/modules/acks-extras/scripts/formation/formation-view.mjs");
    const scales = await import("/modules/acks-extras/scripts/lib/movement-scales.mjs");
    const out = { phase, isGM: game.user.isGM };
    if (phase === "restore") {
      t.unregisterTable("travel", { priority: 20 });
      await acksExtras.lib.services.get("ruledata-import").reload();
      await H.sleep(500);
      const l = t.getLayer("travel", 20);
      return { ...out, hasTravel: t.hasDoc("travel"), layer20Keys: Object.keys(l?.tables ?? {}).length, liveCheck: l?.source === "live-check", invented: Number(l?.tables?.terrainMultipliers?.hills) === 0.37, override: !!t.getLayer("travel", 30) };
    }
    if (phase === "none") {
      out.before = { hasTravel: t.hasDoc("travel"), layer20Keys: Object.keys(t.getLayer("travel", 20)?.tables ?? {}).length, override: !!t.getLayer("travel", 30) };
      t.unregisterTable("travel");
      out.hasTravelAfter = t.hasDoc("travel");
    }
    if (phase === "invented") {
      t.registerTable({ id: "travel", tables: { terrainMultipliers: { hills: 0.37 }, roads: { earth: { multiplier: 1.77, ineffectiveIf: ["raining"] } } } }, { priority: 20, source: "live-check" });
      out.hasTravelAfter = t.hasDoc("travel");
    }
    const f = H.formation(fid);
    const feet = H.m.model.partySpeed(f, { dark: false });
    const r = view.travelReadout(f, feet);
    const forced = scales.expeditionFrom(feet, { multiplier: r.multiplier, pace: "forced" });
    const dedicated = scales.expeditionFrom(feet, { multiplier: r.multiplier, pace: "dedicated" });
    const conds = (r.parts ?? []).filter((p) => p.key.startsWith("condition."));
    const condProduct = conds.reduce((p, x) => p * (Number(x.factor) || 1), 1);
    // Ratios and booleans only: the world's own figures stay out of the log.
    if (phase === "none") H.noneMultiplier = Number(r.multiplier);
    out.conditionParts = conds.length;
    out.byPaceAndConditionsAlone = Math.abs(Number(r.multiplier) - condProduct) < 1e-9;
    out.ratioToNone = H.noneMultiplier ? Math.round((Number(r.multiplier) / H.noneMultiplier) * 1000) / 1000 : null;
    out.readoutForced = r.milesPerDay === forced.milesPerDay;
    let strip = null;
    try { strip = (await game.actors.get(partyId).sheet._prepareContext({}))?.strip?.speed ?? null; } catch (e) { out.contextError = String(e?.message ?? e); }
    const lab = (k) => H.loc(`ACKS-VEHICLES.reason.${k}`);
    const line = strip?.partsLine ?? "";
    const at = (k) => line.indexOf(lab(k));
    out.dayKind = H.T.travelOf(f).day?.kind ?? null;
    // Factors are printed only where this run invented them; a world figure stays out of the log.
    out.parts = (r.parts ?? []).map((p) => ({ key: p.key, note: !!p.note, ...(p.key.startsWith("condition.") || p.key === "tablesMissing" ? {} : { factor: p.factor }) }));
    out.tablesMissingPart = (r.parts ?? []).some((p) => p.key === "tablesMissing");
    out.terrainParts = (r.parts ?? []).filter((p) => p.key.startsWith("terrain.")).length;
    out.roadParts = (r.parts ?? []).filter((p) => p.key.startsWith("road.")).length;
    out.speedZero = !(Number(feet) > 0);
    out.stripFound = !!strip;
    out.stripMilesIsForced = !!strip && strip.milesPerDay === forced.milesPerDay;
    out.forcedDiffersFromDedicated = forced.milesPerDay !== dedicated.milesPerDay;
    out.lineHasMissing = at("tablesMissing") >= 0;
    out.lineTerrainThenWashedOut = at("terrain.hills") >= 0 && at("road.washedOut") > at("terrain.hills");
    out.lineEntries = line ? line.split(" · ").length : 0;
    return out;
  },

  /** Move the party token by (dx, dy) with no animation; the clock, the day and the cards read after the automation answers. */
  jDrag: async ({ fid, dx = 0, dy = 0 }) => {
    const H = globalThis.__a1;
    const f0 = H.formation(fid);
    const token = game.scenes.get(f0?.sceneId)?.tokens.get(f0?.tokenId);
    if (!token) return { error: "no party token" };
    const read = () => {
      const f = H.formation(fid);
      return { turnsTotal: f.clock?.turnsTotal ?? 0, roundsPartial: f.clock?.roundsPartial ?? 0, carryFeet: f.clock?.carryFeet ?? 0, miles: f.travel?.day?.miles ?? 0, hours: f.travel?.day?.hours ?? 0, worldTime: game.time.worldTime, mode: H.T.travelOf(f).mode };
    };
    const before = read();
    const t0 = Date.now();
    const to = { x: token.x + dx, y: token.y + dy };
    await token.update(to, { animate: false });
    const done = await H.poll(() => { const lp = H.formation(fid)?.clock?.lastPosition; return lp && lp.x === to.x && lp.y === to.y; }, { tries: 60, every: 200 });
    await H.sleep(2000);
    // A day-end offer the move raised is answered "later": nothing ends.
    let offer = false;
    for (const d of H.dialogs()) {
      const b = H.root(d)?.querySelector('button[data-action="later"]');
      if (b) { offer = true; b.click(); await H.sleep(600); }
    }
    const after = read();
    const msgs = H.messagesSince(t0);
    return { processed: !!done, before, after, worldTimeDelta: after.worldTime - before.worldTime, offer, cards: msgs.filter((m) => m.mine).length, messages: msgs.map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })) };
  },

  /** The stored day board, whole. */
  jDay: async ({ fid }) => JSON.parse(JSON.stringify(globalThis.__a1.formation(fid)?.travel?.day ?? null)),

  /** Pixels for 0.95 and 0.1 of one exploration move as the turn engine measures it here, and the clock's partial state. */
  jDelvePlan: async ({ fid }) => {
    const H = globalThis.__a1;
    const engine = await import("/modules/acks-extras/scripts/formation/turn-engine.mjs");
    const f = H.formation(fid);
    const scene = game.scenes.get(f.sceneId);
    const feetPerTurn = engine.turnDistance(f, scene);
    const feetPerPx = Number(scene.grid.distance) / Number(scene.grid.size);
    const px = (feet) => Math.round(feet / feetPerPx);
    const round = feetPerTurn / 10;
    const partial = f.clock?.roundsPartial ?? 0;
    const carry = f.clock?.carryFeet ?? 0;
    // Half a round short of the turn from where the clock stands, then a round and a pixel more.
    const toTurn = (10 - partial) * round - carry;
    return { ok: feetPerTurn > 0 && toTurn > round, units: scene.grid.units, d95: px(toTurn - round / 2), d10: px(round) + 1, r0: { roundsPartial: partial, carryFeet: carry, turnsTotal: f.clock?.turnsTotal ?? 0 } };
  },

  /** A scene move: the party token deleted on its scene, the new scene viewed, a fresh token placed there and its adoption polled. */
  jMoveTo: async ({ partyId, fid, sceneId, xy }) => {
    const H = globalThis.__a1;
    const f0 = H.formation(fid);
    const old = game.scenes.get(f0?.sceneId)?.tokens.get(f0?.tokenId) ?? null;
    const oldUuid = old?.uuid ?? null;
    if (old) await old.parent.deleteEmbeddedDocuments("Token", [old.id]);
    await H.sleep(800);
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await H.sleep(200);
    await H.sleep(2000);
    const td = (await game.actors.get(partyId).getTokenDocument({ x: xy.x, y: xy.y })).toObject();
    delete td._id;
    const [token] = await scene.createEmbeddedDocuments("Token", [td]);
    const adopted = await H.poll(() => { const r = H.formation(fid); return r?.tokenId === token.id && r?.sceneId === sceneId; }, { tries: 75, every: 200 });
    await H.sleep(2000);
    return { oldUuid, tokenUuid: token.uuid, adopted: !!adopted, mode: H.T.travelOf(H.formation(fid)).mode, viewed: canvas.scene?.id === sceneId };
  },

  /** The territory set in the Judge's hand through applyTravelForm; the truth, the belief and the Country card's source read before and after. */
  jTerritory: async ({ partyId, fid, territory }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const source = async () => {
      await app.render(true);
      await H.sleep(1200);
      return H.root(app)?.querySelector('[data-section="country"] .acks-extras-country-card[data-key="territory"] .acks-extras-country-source')?.dataset.provenance ?? null;
    };
    const read = () => ({ truth: H.T.trueTravelOf(H.formation(fid)).territory ?? null, believed: H.T.travelOf(H.formation(fid)).territory ?? null, override: H.formation(fid)?.travel?.override?.territory ?? null });
    const before = { ...read(), provenance: await source() };
    await H.T.applyTravelForm(fid, { override: { territory } });
    const ok = !!(await H.poll(() => H.T.trueTravelOf(H.formation(fid)).territory === territory, { tries: 40, every: 200 }));
    const after = { ...read(), provenance: await source() };
    return { ok, before, after };
  },

  /** The hex the record says the party stands in. */
  jHex: async ({ fid }) => {
    const hex = globalThis.__a1.T.travelOf(globalThis.__a1.formation(fid)).hex ?? {};
    return { recorded: hex.i != null && hex.j != null, labelled: !!hex.label };
  },

  /** Where the march recipe's drive mechanics say the journey's controls are. */
  jDrive: async ({ partyId }) => {
    const H = globalThis.__a1;
    const el = H.root(game.actors.get(partyId).sheet);
    const poi = el.querySelector('[data-application-part="mode"] [data-section="poi"]');
    const controls = [...(poi?.querySelectorAll("button, select, input:not([type=hidden]), textarea, [data-action]") ?? [])];
    return {
      poiLastTwo: controls.slice(-2).map((n) => n.getAttribute("name") ?? n.dataset.action ?? n.tagName.toLowerCase()),
      endDayInHead: !!el.querySelector('[data-application-part="mode"] header.acks-extras-party-sheet__head [data-action="travelEndDay"]'),
      toolsSearch: !!el.querySelector('.acks-extras-party-sheet__rail--tools [data-action="searchHour"]'),
      toolsPause: !!el.querySelector('.acks-extras-party-sheet__rail--tools [data-action="togglePause"]'),
      bandModeSelect: !!el.querySelector('[data-application-part="band"] select[name="travel.mode"]'),
    };
  },

  /** The encounter tool pressed until a throw finds something (forced through the card's own rng only if six presses find nothing); the card's sight lines and its flag read. Names and figures stay out of the result. */
  jEncounter: async ({ partyId, fid, presses = 6 }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const lines = {
      party: [H.loc("ACKS-FORMATION.travel.enc.partySees"), H.loc("ACKS-FORMATION.travel.enc.partyBlind")],
      monsters: [H.loc("ACKS-FORMATION.travel.enc.monstersSee"), H.loc("ACKS-FORMATION.travel.enc.monstersBlind")],
    };
    const messages = [];
    const outcomes = [];
    let hit = null;
    let forced = null;
    const fresh = (t0) => H.messagesSince(t0).filter((m) => m.encounter?.formationId === fid);
    const take = (got, v = null) => {
      for (const m of got ?? []) {
        messages.push({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: true });
        outcomes.push(m.encounter.outcome === "none" ? "none" : "found");
        if (m.encounter.outcome !== "none" && !hit) { hit = m; forced = v; }
      }
    };
    for (let n = 0; n < presses && !hit; n++) {
      const t0 = Date.now();
      H.root(app)?.querySelector('.acks-extras-party-sheet__rail--tools [data-action="travelEncounterThrow"]')?.click();
      take(await H.poll(() => (fresh(t0).length ? fresh(t0) : null), { tries: 40, every: 200 }));
      await H.sleep(600);
    }
    if (!hit) {
      const card = await import("/modules/acks-extras/scripts/formation/encounter-card.mjs");
      for (const v of [0.01, 0.99, 0.5]) {
        const t0 = Date.now();
        await card.postEncounterThrow(H.formation(fid), { activity: "travel", rng: () => v });
        take(await H.poll(() => (fresh(t0).length ? fresh(t0) : null), { tries: 30, every: 200 }), v);
        if (hit) break;
      }
    }
    const out = { throws: outcomes.length, outcomes, forced, messages };
    if (hit) {
      const e = hit.encounter;
      const pi = lines.party.findIndex((s) => hit.text.includes(s));
      const mi = lines.monsters.findIndex((s) => hit.text.includes(s));
      out.card = {
        id: hit.id,
        whispered: hit.whisper > 0,
        partyLine: pi === 0 ? "sees" : pi === 1 ? "blind" : null,
        monstersLine: mi === 0 ? "see" : mi === 1 ? "blind" : null,
        flag: { formationId: e.formationId === fid, terrain: e.terrain, found: e.outcome !== "none", distance: typeof e.distance === "number", start: typeof e.start === "number", partySees: e.partySees, monstersSee: e.monstersSee, light: e.light, activity: e.activity },
      };
      out.card.agrees = (pi === 0) === (e.partySees === true) && (mi === 0) === (e.monstersSee === true);
    }
    return out;
  },

  /** The party's pace as THIS seat computes it: each member's speed (zero or not), the party's, and the strip's day; booleans only. */
  jSpeed: async ({ partyId, fid }) => {
    const H = globalThis.__a1;
    const M = H.m.model;
    const f = H.formation(fid);
    const members = M.realMembers(f).map((m) => {
      const a = M.getMemberActor(m);
      return { present: !!a, owner: !!a?.isOwner, speedZero: !(Number(M.explorationSpeedOf(a)) > 0) };
    });
    const party = M.partySpeed(f, { dark: false });
    let s = null;
    try { s = (await game.actors.get(partyId).sheet._prepareContext({}))?.strip?.speed ?? null; } catch (e) { return { isGM: game.user.isGM, error: String(e?.message ?? e) }; }
    return { isGM: game.user.isGM, members, partySpeedZero: !(Number(party) > 0), stripFound: !!s, stripMilesZero: !(Number(s?.milesPerDay) > 0), feetLineZero: /^0'/.test(s?.partsLine ?? "") };
  },

  /** Every marcher of a formation that bars a forced march put back on a plain rung: its survival flag removed. */
  clearMarchBar: async ({ fid }) => {
    const H = globalThis.__a1;
    const bar = await import("/modules/acks-extras/scripts/formation/march-bar.mjs");
    const barred = bar.forcedMarchBar(H.formation(fid));
    for (const b of barred) await game.actors.get(b.actorId)?.unsetFlag("acks-extras", "survival");
    const clear = await H.poll(() => bar.forcedMarchBar(H.formation(fid)).length === 0, { tries: 25, every: 200 });
    return { barred: barred.length, clear: !!clear };
  },

  /** One message as THIS seat holds it: in the collection, its visible getter, and whether any chat log draws it. */
  msgOnSeat: async ({ id }) => {
    const m = game.messages.get(id) ?? null;
    return { inCollection: !!m, visible: m ? !!m.visible : false, inLog: document.querySelectorAll(`[data-message-id="${id}"]`).length };
  },

  /** The Judge tab's lostBegin pressed, the stray asked and answered Chosen; the episode and its hidden marker read. */
  jLost: async ({ partyId, fid }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const btn = H.root(app)?.querySelector('[data-application-part="judge"] [data-section="episode"] [data-action="lostBegin"]');
    if (!btn) return { found: false };
    btn.click();
    const dlg = await H.poll(() => H.dialogs().find((d) => H.root(d)?.querySelector('button[data-action="chosen"]')), { tries: 40, every: 150 });
    if (!dlg) return { found: true, dialog: false, notes: H.takeNotes().map((n) => n.kind) };
    const faces = H.root(dlg).querySelectorAll('select[name="face"] option').length;
    H.root(dlg).querySelector('button[data-action="chosen"]').click();
    const phase = await H.poll(() => H.T.travelOf(H.formation(fid)).lost?.phase ?? null, { tries: 50, every: 200 });
    await H.sleep(1000);
    const shadow = await import("/modules/acks-extras/scripts/formation/shadow.mjs");
    const f = H.formation(fid);
    const sh = shadow.shadowFor(game.scenes.get(f.sceneId), fid);
    return { found: true, dialog: true, faces, phase, shadowUuid: sh?.uuid ?? null, shadowHidden: sh?.hidden ?? null };
  },

  /** What the GM seat shows of the episode and the log. */
  jGmLost: async ({ partyId, fid, note }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(1200);
    const el = H.root(app);
    const rows = [...el.querySelectorAll('[data-application-part="sightings"] [data-section="log"] li')];
    return {
      astray: !!el.querySelector('[data-application-part="judge"] [data-section="episode"] .acks-extras-formation-lost-astray'),
      rows: rows.length,
      compassRows: rows.filter((r) => r.querySelector("i.fa-compass.acks-extras-formation-travel-lost")).length,
      logLost: (H.formation(fid)?.travel?.log ?? []).map((e) => !!e.lost),
      noteInField: el.querySelector('[name="travel.lostNote"]')?.value === note,
    };
  },

  /** The player seat's view of the party sheet on a journey. */
  jPlayer: async ({ partyId, note = null }) => {
    const H = globalThis.__a1;
    const party = game.actors.get(partyId);
    if (!party) return { visible: false };
    const app = await party.sheet.render(true);
    await H.sleep(2500);
    try { app.setPosition({ left: 16, top: 16 }); } catch (_e) { /* fine */ }
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    await H.sleep(400);
    const el = H.root(app);
    const mode = el.querySelector('[data-application-part="mode"]');
    const sky = mode?.querySelector('[data-section="sky"]');
    const camp = mode?.querySelector('[data-section="camp"]');
    const country = mode?.querySelector('[data-section="country"]');
    return {
      visible: true,
      level: party.getUserLevel(game.user),
      sections: [...(mode?.querySelectorAll("[data-section]") ?? [])].map((s) => s.dataset.section),
      strip: !!mode?.querySelector("section.acks-extras-strip-journey"),
      countryCards: country?.querySelectorAll(".acks-extras-country-card").length ?? 0,
      countryValuesOnly: !!country && !country.querySelector(".acks-extras-country-source, .acks-extras-country-chips, [data-action], button, select, input"),
      campForecast: !!camp?.querySelector(".acks-extras-formation-camp-supply"),
      campNoPickers: !!camp && !camp.querySelector("select, input:not([type=hidden]), button"),
      pickers: [...el.querySelectorAll('[name^="travel."], [name^="camp."]')].filter((n) => n.type !== "hidden").map((n) => n.getAttribute("name")),
      dayBoard: !!el.querySelector('[data-section="day"]'),
      lostMark: !!el.querySelector(".acks-extras-formation-travel-lost, .acks-extras-formation-lost-astray"),
      noteShown: !!note && (el.textContent.includes(note) || [...el.querySelectorAll("input, textarea")].some((i) => String(i.value ?? "").includes(note))),
      ctxSky: await (async () => { try { const c = await app._prepareContext({}); return { skyShown: !!c?.travel?.skyShown, chips: c?.travel?.weather?.chips?.length ?? null, night: !!c?.travel?.weather?.night, wheels: c?.travel?.wheels?.length ?? null }; } catch (e) { return { error: String(e?.message ?? e) }; } })(),
      judgeTab: !!el.querySelector('[data-tab="judge"]'),
      judgePart: !!el.querySelector('[data-application-part="judge"]'),
      logRows: el.querySelectorAll('[data-application-part="sightings"] [data-section="log"] li').length,
      sky: sky ? { chips: sky.querySelectorAll(".acks-extras-formation-travel-weather-chip").length, night: !!sky.querySelector(".acks-extras-formation-travel-weather-night"), controls: sky.querySelectorAll("select, input, button, [data-action]").length } : null,
    };
  },

  /* ------------------------ frame step 6, again ------------------------ */

  /** Every select on each tab with its box and type metrics, read with that tab active. */
  f6Selects: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const out = [];
    const read = (tab, s) => {
      const cs = getComputedStyle(s);
      return { tab, name: s.getAttribute("name") ?? s.dataset.action ?? null, section: s.closest("[data-section]")?.dataset.section ?? null, head: !!s.closest("header"), client: s.clientHeight, scroll: s.scrollHeight, h: Math.round(s.getBoundingClientRect().height * 10) / 10, font: cs.fontSize, line: cs.lineHeight, pad: `${cs.paddingTop} ${cs.paddingBottom}`, overY: cs.overflowY, over: s.scrollHeight > s.clientHeight + 1 };
    };
    for (const s of el.querySelectorAll('[data-application-part="band"] select')) if (s.offsetParent !== null) out.push(read("band", s));
    for (const tab of ["mode", "order", "kit", "sightings", "judge"]) {
      try { app.changeTab(tab, "primary"); } catch (_e) { /* fine */ }
      await H.sleep(350);
      for (const s of el.querySelectorAll(`[data-application-part="${tab}"] select`)) if (s.offsetParent !== null) out.push(read(tab, s));
    }
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    return out;
  },

  /** Each tab activated in turn, and its part root's computed overflow then. */
  f6PartScroll: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const out = {};
    for (const tab of ["mode", "order", "kit", "sightings", "judge"]) {
      try { app.changeTab(tab, "primary"); } catch (_e) { /* fine */ }
      await H.sleep(350);
      const part = H.root(app).querySelector(`[data-application-part="${tab}"]`);
      const cs = part ? getComputedStyle(part) : null;
      out[tab] = { active: app.tabGroups.primary === tab, overflowY: cs?.overflowY ?? null, minHeight: cs?.minHeight ?? null, overflows: part ? part.scrollHeight > part.clientHeight + 1 : null };
    }
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    return out;
  },

  /** The 520-high Wilderness tab scrolled to its middle, a field changed: where the content in view stands before and after. */
  f6Scroll: async ({ partyId, field = "travel.weather.wind" }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    app.setPosition({ height: 520 });
    await H.sleep(700);
    let part = H.root(app).querySelector('[data-application-part="mode"]');
    part.scrollTop = Math.round((part.scrollHeight - part.clientHeight) / 2);
    await H.sleep(300);
    const heights = (p) => Object.fromEntries([...p.querySelectorAll("[data-section]")].map((s) => [s.dataset.section, Math.round(s.getBoundingClientRect().height)]));
    const top0 = part.getBoundingClientRect().top;
    const blocks = [...part.querySelectorAll("[data-section] > *")];
    const anchor = blocks.find((b) => b.getBoundingClientRect().top >= top0 - 0.5) ?? null;
    const sec = anchor?.closest("[data-section]");
    const ak = anchor ? { section: sec.dataset.section, idx: [...sec.children].indexOf(anchor) } : null;
    const off0 = anchor ? Math.round(anchor.getBoundingClientRect().top - top0) : null;
    const h0 = heights(part);
    const st0 = part.scrollTop;
    const box0 = { winH: Math.round(app.position.height ?? 0), client: part.clientHeight, scroll: part.scrollHeight };
    const sel = part.querySelector(`select[name="${field}"]`);
    if (sel) {
      const opts = [...sel.options].map((o) => o.value);
      H.change(sel, opts.find((v) => v !== sel.value) ?? sel.value);
    }
    await H.sleep(2200);
    part = H.root(app).querySelector('[data-application-part="mode"]');
    const top1 = part.getBoundingClientRect().top;
    const a1 = ak ? part.querySelector(`[data-section="${ak.section}"]`)?.children[ak.idx] : null;
    const off1 = a1 ? Math.round(a1.getBoundingClientRect().top - top1) : null;
    const h1 = heights(part);
    const changed = Object.keys({ ...h0, ...h1 }).filter((k) => h0[k] !== h1[k]).map((k) => `${k}:${h0[k] ?? "-"}>${h1[k] ?? "-"}`);
    const box1 = { winH: Math.round(app.position.height ?? 0), client: part.clientHeight, scroll: part.scrollHeight };
    const max1 = box1.scroll - box1.client;
    return { field: sel ? field : null, st0, st1: part.scrollTop, box0, box1, max1, clampedToMax: Math.abs(part.scrollTop - max1) <= 1 && st0 > max1, anchor: ak, off0, off1, anchorHeld: off0 != null && off1 != null && Math.abs(off1 - off0) <= 2, sectionsChanged: changed, stillOverflows: part.scrollHeight > part.clientHeight + 1 };
  },

  /* --------------------------- the day change --------------------------- */

  /** The fixtures' formations found and claimed; the generator's climate chosen from the imported modifiers. */
  dcFixtures: async ({ ids, want = "Cfb" }) => {
    const H = globalThis.__a1;
    const out = { fids: {} };
    for (const [label, id] of Object.entries(ids)) {
      const f = await H.poll(() => Object.values(H.F.getFormations()).find((x) => x.actorId === id), { tries: 60, every: 200 });
      if (!f) return { error: `no formation for ${label}` };
      H.claim({ alias: f.name, fid: f.id });
      H.claim({ alias: game.actors.get(id)?.name });
      out.fids[label] = f.id;
    }
    const cm = H.t.getDoc("weather")?.tables?.climateModifiers ?? {};
    const usable = Object.keys(cm).filter((k) => H.m.weather.CLIMATES[k] && cm[k]?.winter && cm[k]?.spring);
    out.climate = usable.includes(want) ? want : usable[0] ?? null;
    out.usable = usable.length;
    out.ready = H.m.weather.generatorReady();
    return out;
  },

  /** The second journeying formation set up through the API: journey, the same climate, the generator on, today's sky read. */
  dcApiSetup: async ({ fid, climate }) => {
    const H = globalThis.__a1;
    await H.T.setJourneyMode(fid, "journey");
    await H.T.applyTravelForm(fid, { override: { climate }, weather: { auto: true } });
    await H.sleep(600);
    const rolled = await H.m.travel.rollWeatherNow(fid);
    await H.sleep(800);
    const t = H.T.travelOf(H.formation(fid));
    return { mode: t.mode, climate: t.weather.climate, auto: !!t.weather.auto, rolled: !!rolled };
  },

  /** Each formation's settled day, footing, bands and rolls, and the sky cache's keys for the run's climate. */
  dcState: async ({ fids, climate }) => {
    const H = globalThis.__a1;
    const cache = game.settings.get("acks-extras", "skyCache") ?? {};
    const keys = Object.keys(cache);
    const per = {};
    for (const [label, fid] of Object.entries(fids)) {
      const f = H.formation(fid);
      const w = f?.travel?.weather ?? {};
      const t = H.T.travelOf(f);
      per[label] = {
        // The footing as a read gives it: a formation that has none yet reads
        // the fresh footing, which its first stamp then writes.
        mode: t.mode, settledDay: w.settledDay ?? null, footing: JSON.parse(JSON.stringify(t.weather?.footing ?? null)),
        bands: { temperature: w.temperature ?? "", temperatureNight: w.temperatureNight ?? "", precipitation: w.precipitation ?? "", wind: w.wind ?? "" },
        rolls: JSON.parse(JSON.stringify(w.rolls ?? null)), auto: !!w.auto, climate: t.weather?.climate ?? "",
        season: H.m.travel.effectiveSeason(t).season, dayCount: f?.travel?.dayCount ?? null, log: (f?.travel?.log ?? []).length,
      };
    }
    const r = H.m.worldTime.clockReading();
    return { worldTime: game.time.worldTime, day: H.m.worldTime.calendarDay(), hour: r?.hour ?? null, minute: r?.minute ?? null, dawn: r?.dawn ?? null, cacheTotal: keys.length, mine: keys.filter((k) => k.split("|")[1] === climate).sort(), per };
  },

  /** The clock run forward from this seat (the active GM's), every sky-cache write in the window recorded, until the settles land. */
  dcAdvance: async ({ seconds, fids, climate, wantDay = null }) => {
    const H = globalThis.__a1;
    const writes = [];
    const onSet = (doc) => {
      if (doc?.key !== "acks-extras.skyCache") return;
      try {
        const keys = Object.keys(game.settings.get("acks-extras", "skyCache") ?? {});
        writes.push({ total: keys.length, mine: keys.filter((k) => k.split("|")[1] === climate).sort() });
      } catch (_e) { writes.push(null); }
    };
    const h1 = Hooks.on("updateSetting", onSet);
    const h2 = Hooks.on("createSetting", onSet);
    const wt0 = game.time.worldTime;
    let settled = null;
    try {
      await game.time.advance(seconds);
      if (wantDay != null) settled = !!(await H.poll(() => Object.values(fids).every((id) => Number(H.formation(id)?.travel?.weather?.settledDay) === wantDay), { tries: 100, every: 200 }));
      await H.sleep(2500);
    } finally {
      Hooks.off("updateSetting", h1);
      Hooks.off("createSetting", h2);
    }
    return { moved: game.time.worldTime - wt0, settled, writes };
  },

  /** The footing and bands the settle should have written: the documented loop, replayed against the cache the settle left. */
  dcExpect: async ({ fid, from, bands0, days, climate, season }) => {
    const H = globalThis.__a1;
    const W = H.m.weather;
    const cache = game.settings.get("acks-extras", "skyCache") ?? {};
    const f = H.formation(fid);
    const mudProne = W.terrainMudProne(H.T.travelOf(f).ground);
    let footing = from;
    let bands = bands0;
    let rolls = null;
    const found = [];
    for (const d of days) {
      const g = W.advanceGround(footing, { temperature: bands.temperature, precipitation: bands.precipitation, mudProne });
      footing = { mud: g.mud, snow: g.snow, runs: g.runs };
      const sky = cache[`${d}|${climate}|${season}`];
      found.push(!!sky?.ok);
      if (sky?.ok) { bands = { temperature: sky.temperature, temperatureNight: sky.temperatureNight, precipitation: sky.precipitation, wind: sky.wind }; rolls = sky.rolls; }
    }
    const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
    const w = f?.travel?.weather ?? {};
    const storedBands = { temperature: w.temperature ?? "", temperatureNight: w.temperatureNight ?? "", precipitation: w.precipitation ?? "", wind: w.wind ?? "" };
    return { found, footingMatch: canon(footing) === canon(w.footing ?? null), bandsMatch: canon(bands) === canon(storedBands), rollsMatch: rolls == null || canon(rolls) === canon(w.rolls ?? null) };
  },

  /** End day pressed on the Wilderness head; the jump, the log, the day count and the cache read after any settle lands. */
  dcEndDay: async ({ partyId, fid, climate }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    const keys0 = Object.keys(game.settings.get("acks-extras", "skyCache") ?? {}).filter((k) => k.split("|")[1] === climate);
    const day0 = H.m.worldTime.calendarDay();
    const wt0 = game.time.worldTime;
    const jump = H.m.worldTime.untilNextDawn();
    const may = game.settings.get("acks-extras", "advanceWorldTime");
    const f0 = H.formation(fid);
    const log0 = (f0?.travel?.log ?? []).length;
    const count0 = f0?.travel?.dayCount ?? null;
    const sky0 = JSON.stringify({ r: f0?.travel?.weather?.rolls ?? null, f: f0?.travel?.weather?.footing ?? null, p: f0?.travel?.weather?.precipitation ?? null });
    const t0 = Date.now();
    H.root(app)?.querySelector('[data-application-part="mode"] header [data-action="travelEndDay"]')?.click();
    await H.poll(() => (H.formation(fid)?.travel?.log ?? []).length > log0, { tries: 60, every: 200 });
    const day1 = H.m.worldTime.calendarDay();
    if (day1 > day0) await H.poll(() => Number(H.formation(fid)?.travel?.weather?.settledDay) === day1, { tries: 75, every: 200 });
    await H.sleep(2500);
    const f1 = H.formation(fid);
    const r = H.m.worldTime.clockReading();
    const keys1 = Object.keys(game.settings.get("acks-extras", "skyCache") ?? {}).filter((k) => k.split("|")[1] === climate);
    return {
      may, jump, moved: game.time.worldTime - wt0, day0, day1, atDawn: !!r && r.hour === r.dawn && r.minute === 0,
      logAdded: (f1?.travel?.log ?? []).length - log0, dayCount0: count0, dayCount1: f1?.travel?.dayCount ?? null,
      added: keys1.filter((k) => !keys0.includes(k)),
      skySame: sky0 === JSON.stringify({ r: f1?.travel?.weather?.rolls ?? null, f: f1?.travel?.weather?.footing ?? null, p: f1?.travel?.weather?.precipitation ?? null }),
      messages: H.messagesSince(t0).map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })),
    };
  },

  /** The Sky section's season select and hint as drawn, beside the calendar's own season. */
  dcSeason: async ({ partyId }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1500);
    try { app.changeTab("mode", "primary"); } catch (_e) { /* fine */ }
    const el = H.root(app);
    const sel = el.querySelector('select[name="travel.weather.season"]');
    const hint = el.querySelector(".acks-extras-formation-travel-weather-season");
    const cal = H.m.worldTime.calendarSeason();
    const map = String(game.settings.get("acks-extras", "calendarSeasons") ?? "");
    const listed = map.split(",").map((s) => s.trim().toLowerCase());
    return {
      found: !!sel, value: sel?.value ?? null, disabled: !!sel?.disabled, hint: !!hint, hintNamesCalendar: !!hint && !!cal && hint.textContent.includes(cal.name),
      calendar: cal ? { index: cal.index, name: cal.name, count: cal.count } : null, map, mapWants: cal && map ? listed[cal.index] ?? null : null,
    };
  },

  /** The Sky section's Roll weather pressed; the cache keys it added. */
  dcRoll: async ({ partyId, fid, climate }) => {
    const H = globalThis.__a1;
    const app = game.actors.get(partyId).sheet;
    const keys0 = new Set(Object.keys(game.settings.get("acks-extras", "skyCache") ?? {}));
    const rolls0 = JSON.stringify(H.formation(fid)?.travel?.weather?.rolls ?? null);
    const btn = H.root(app)?.querySelector('[data-section="sky"] [data-action="travelWeatherRoll"]');
    if (!btn) return { found: false };
    const disabled = btn.disabled;
    btn.click();
    await H.poll(() => Object.keys(game.settings.get("acks-extras", "skyCache") ?? {}).some((k) => !keys0.has(k)) || JSON.stringify(H.formation(fid)?.travel?.weather?.rolls ?? null) !== rolls0, { tries: 40, every: 200 });
    await H.sleep(1200);
    const added = Object.keys(game.settings.get("acks-extras", "skyCache") ?? {}).filter((k) => !keys0.has(k));
    return { found: true, disabled, added: added.filter((k) => k.split("|")[1] === climate), addedOther: added.filter((k) => k.split("|")[1] !== climate).length, rolled: JSON.stringify(H.formation(fid)?.travel?.weather?.rolls ?? null) !== rolls0 };
  },

  /** The season key a calendar reading maps to, pure: names nobody recognises, with and without a count of four. */
  dcSeasonPure: async () => {
    const W = globalThis.__a1.m.weather;
    return {
      unnamedThree: W.seasonKeyFor({ index: 0, name: "QA Season", count: 3 }, { map: "", keys: W.SEASONS }),
      unnamedFour: W.seasonKeyFor({ index: 0, name: "QA Season", count: 4 }, { map: "", keys: W.SEASONS }),
    };
  },

  now: async () => Date.now(),

  /** Messages this seat authored since `t0` (ids, speaker and ownership only). */
  messages: async ({ t0 }) => globalThis.__a1.messagesSince(t0).map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper, alias: m.alias, mine: m.mine })),

  closeAll: async () => {
    let n = 0;
    for (const a of [...foundry.applications.instances.values()]) if (/Party|Formation|Dialog|Sheet|Config|Palette|Assistant|Picker|Browser|HitPoint|Hp/.test(a.constructor.name)) { try { await a.close({ animate: false }); n++; } catch (_e) { /* closed */ } }
    return n;
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                           */
/* ------------------------------------------------------------------ */

const page = async (api, fn, ...args) =>
  JSON.parse(await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`));

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations && !!globalThis.acksExtras?.lib?.tables`);
    } catch {
      ok = false;
    }
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
  const fresh = await api.eval(`typeof globalThis.acksExtras?.formation?.travel?.trueTravelOf === "function" && globalThis.acksExtras?.formation?.apiVersion === 18`);
  if (!fresh) throw new Error(`${key}: stale module code loaded; the page did not pick up the working tree`);
  note(`${key} install`, await page(api, P.install));
  return api;
}

const shot = async (api, slug, selector) => {
  if (!SHOTS) return null;
  try {
    const seen = await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.scrollIntoView({ block: "nearest" }); return !!el; })()`);
    await sleep(500);
    const r = await api.shot(`${SHOT_DIR}/${slug}.png`, selector);
    note(`shot ${slug}`, { seen, bytes: r.bytes, clip: r.clip });
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Sections                                                            */
/* ------------------------------------------------------------------ */

const ctx = { worldTime0: null, settingsToRestore: [], afterTeardown: [] };

async function probe(gm, player, census) {
  section("probe");
  note("tables", await page(gm, P.tablesState));
  note("books", await page(gm, P.books, { waitMs: 20000 }));

  section("probe: the Calendar seasons setting");
  const sw = await page(gm, P.settingsWindow, { mod: MOD });
  note("settings window", sw);
  check("the Calendar seasons setting renders in the module's settings with its name and hint", sw.found && sw.labelIsName && sw.hintIsHint && sw.visible, { found: sw.found, labelIsName: sw.labelIsName, hintIsHint: sw.hintIsHint, visible: sw.visible, activeTab: sw.activeTab });
  if (sw.found) await shot(gm, "formation-calendar-seasons", '[data-a1-shot="calendar-seasons"]');
  note("settings closed", await page(gm, P.closeSettings));

  section("probe: Reimport One Shelf, Rules tables");
  const rd = await page(gm, P.reimportDialog, { pick: "tables:formation", listbox: true });
  note("reimport dialog", rd);
  check("Reimport One Shelf offers a Rules tables group: every table (in place), formation only, travel only", rd.found && rd.tablesGroup && rd.allSaysInPlace && rd.formationOne && rd.travelOne && rd.picked === "tables:formation", { groups: rd.groups, picked: rd.picked, n: rd.tableValues?.length });
  if (rd.found) await shot(gm, "importer-rules-tables-formation", ".application.acks-extras-importer-dialog");
  note("reimport closed unsubmitted", await page(gm, P.closeReimport));
}

/** Track the run's own cards; a card another formation's automation wrote on this seat is listed, never tracked. */
const trackedMsgs = new Set();
const trackMsgs = (api, list, label) => {
  let n = 0;
  const foreign = [];
  for (const m of list ?? []) {
    if (trackedMsgs.has(m.uuid)) continue;
    if (!m.mine) { foreign.push({ uuid: m.uuid, alias: m.alias }); continue; }
    api.track(m.uuid, "ChatMessage");
    trackedMsgs.add(m.uuid);
    n++;
  }
  if (foreign.length) note(`${label}: cards this seat wrote for no formation of this run (not tracked)`, foreign);
  return n;
};
const allTrue = (o) => !!o && Object.values(o).every((v) => v === true);

async function shotImporter(gm) {
  section("importer: Reimport One Shelf, Rules tables, wide enough to read");
  const rd = await page(gm, P.reimportDialog, { pick: "tables:formation", listbox: true, width: 760 });
  note("reimport dialog", { found: rd.found, picked: rd.picked, shown: rd.shown, clipped: rd.clipped, selectW: rd.selectW, rect: rd.rect });
  check("the dialog holds the Rules tables group with formation only and travel only, formation chosen", rd.found && rd.tablesGroup && rd.formationOne && rd.travelOne && rd.picked === "tables:formation", { picked: rd.picked });
  if (rd.found) await shot(gm, "importer-rules-tables-formation", ".application.acks-extras-importer-dialog");
  note("reimport closed unsubmitted", await page(gm, P.closeReimport));

  section("importer: the dialog's wiring, one recorded submit per option");
  for (const [pick, want] of [["tables:formation", [["formation"]]], ["tables:travel", [["travel"]]], ["tables:", [null]]]) {
    const w = await page(gm, P.reimportWiring, { pick });
    note(`wiring ${pick}`, w);
    check(`Reimport One Shelf "${pick}" calls cookbookImportTables through the api object once, opens no confirm, and the importer is put back`, w.found && w.calls.length === 1 && same(w.calls[0], want) && w.opened.length === 0 && w.restored, { calls: w.calls, opened: w.opened, restored: w.restored });
  }
}

async function delve(gm, player, census) {
  section("delve: fixtures (GM seat; the world already holds the import, so the recipe starts at step 2)");
  const playerId = census.player.userId;
  const t0 = await page(gm, P.now);
  const party = await gm.create("Actor", { name: `QA Delve Party ${NONCE}`, type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  const mk = (name, hp, items = [], extra = {}) => gm.create("Actor", { name: `QA ${name} ${NONCE}`, type: "character", system: { hp: { value: hp, max: Math.max(hp, 6) } }, items, ...extra });
  // The party actor's ownership follows its members' owners (syncPartyActorOwnership), so the
  // player seat is "given the party actor" by owning a member.
  const wayfinder = await mk("Wayfinder", 9, [{ name: "Navigation", type: "ability" }], { ownership: { default: 0, [playerId]: 3 } });
  const scout = await mk("Scout", 8);
  const porter = await mk("Porter", 8, [{ name: `QA Sack ${NONCE}`, type: "item", system: { weight6: 12, quantity: { value: 1 } } }]);
  const fallen = await mk("Fallen", 0);
  const memberIds = [wayfinder.id, scout.id, porter.id, fallen.id];
  const en = await page(gm, P.enrolDrop, { partyId: party.id, memberIds });
  note("enrolled", en);
  if (en.error) throw new Error(en.error);
  const fid = en.fid;
  check("delve fixtures: the four characters are enrolled by a drop on the party sheet", en.enrolled.length === 4 && en.enrolled.every(Boolean) && en.mode === "delve", en);
  const car = await page(gm, P.carrier, { partyId: party.id, fid, actorId: porter.id });
  check("Porter holds the Carrier role, pressed on its chip on the Order tab", car.found && car.carrier, car);
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "fixtures");

  section("delve step 2: the import's product, read back from the world");
  const sh = await page(gm, P.delveShapes);
  note("shapes", { shape: sh.shape, citesAll271: sh.citesAll271, citesSeen: sh.citesSeen, navCite: sh.navCite, travelKeys: sh.travelKeys, navigationProse: sh.navigationProse, raw: sh.raw, override: sh.override });
  check("step 2: each formation key and navigationBonus has its reader's shape", allTrue(sh.shape), sh.shape);
  check("step 2: every formation key cites RR p.271 and navigationBonus RR p.275", sh.citesAll271 && sh.navCite === "RR p.275", { citesSeen: sh.citesSeen, navCite: sh.navCite });
  const earlier = ["draftEquivalents", "draftSubstitutionProse", "encounterFrequency", "encounterFrequencyRaw", "gettingLost", "gettingLostRaw", "roads", "terrainGroups", "terrainMultipliers"];
  check("step 2: the travel keys held before the binding are all still there, the raw navigationProse window beside navigationBonus", earlier.every((k) => sh.travelKeys.includes(k)) && sh.travelKeys.includes("navigationBonus") && sh.navigationProse, { missing: earlier.filter((k) => !sh.travelKeys.includes(k)) });
  check("step 2: no Judge's OVERRIDE layer sits above either document", !sh.override.formation && !sh.override.travel, sh.override);
  const br = await page(gm, P.browserRows);
  note("browser rows", br);
  check("step 2: the browser's eight formation rows carry no not-supplied badge, each its page line, and the two raw windows stand as rows of their own", br.found && Object.values(br.rows).every((r) => r && !r.absent && !r.badge && /RR/.test(r.cite ?? "")) && br.raw.restProse && br.raw.swimmingProse, { raw: br.raw });
  const jp = await page(gm, P.journalPages);
  note("journal", { pack: jp.pack, packLabel: jp.packLabel, journal: jp.journal, sidebar: jp.sidebar, pages: jp.pages, navPage: jp.navPage });
  check("step 2: the imported journal in the library compendium holds a filled formation.<key> page for each of the ten, and the sidebar holds no copy", jp.journal && !jp.sidebar && Object.values(jp.pages ?? {}).every((p) => p && p.filled), { pages: jp.pages, sidebar: jp.sidebar });
  const pk = await page(gm, P.pickerHave);
  note("picker", pk);
  check("step 2: the entry picker marks Tables|formation and Tables|travel present", pk.found && pk.formation === "1" && pk.travel === "1", pk);

  section("delve step 3: the clock winds the party one turn past the interval");
  note("advanceWorldTime (each turn moves the shared clock)", census.gm.settings.advanceWorldTime);
  let a = await page(gm, P.advance, { fid, turns: 1, resting: true });
  trackMsgs(gm, a.messages, "rest 1");
  a = await page(gm, P.advance, { fid, turns: "interval" });
  trackMsgs(gm, a.messages, "advance interval");
  note("advance interval", { cards: a.cards, whispered: a.whispered, worldTimeDelta: a.worldTimeDelta });
  let r = await page(gm, P.delveRead, { partyId: party.id, fid, porterId: porter.id, memberIds });
  note("at the interval", r);
  check("step 3: at the interval the party is not winded, no member carries the effect, the Rest stat reads the interval over itself, and a rest is due", !r.winded && r.effects.every((e) => e === false) && r.restIntervalOverItself && !r.restBad && r.restDueWarn, r);
  const pv0 = await page(player, P.playerRest, { partyId: party.id, open: true });
  note("player sheet opened before the winding turn", pv0);
  a = await page(gm, P.advance, { fid, turns: 1 });
  trackMsgs(gm, a.messages, "advance 1");
  r = await page(gm, P.delveRead, { partyId: party.id, fid, porterId: porter.id, memberIds });
  note("one past", { ...r, cards: a.cards, windedLine: a.windedLine, becameWinded: a.becameWinded });
  check("step 3: one turn past it the party is winded, every member carries the effect, the Rest stat is bad under the winded badge, and the turn card carries the winded line", r.winded && r.effects.every((e) => e === true) && r.restBad && r.windedBadge && r.windedWarn && a.windedLine, { effects: r.effects, restBad: r.restBad, windedBadge: r.windedBadge, windedWarn: r.windedWarn, windedLine: a.windedLine, becameWinded: a.becameWinded });
  const pv1 = await page(player, P.playerRest, { partyId: party.id, wantBad: true, close: true });
  check("step 3: the player seat's sheet, opened before the turn, shows the bad Rest stat under the badge without a reload", pv0.rendered && pv0.found && !pv0.bad && pv1.rendered && pv1.bad && pv1.windedBadge, { before: pv0, after: pv1 });
  a = await page(gm, P.advance, { fid, turns: 1, resting: true });
  trackMsgs(gm, a.messages, "rest after");
  r = await page(gm, P.delveRead, { partyId: party.id, fid, porterId: porter.id, memberIds });
  check("step 3: a rest turn takes the flag, the effects and the warning away, and the card says the party has recovered", !r.winded && r.effects.every((e) => e === false) && !r.windedWarn && !r.restBad && a.recovered, { effects: r.effects, windedWarn: r.windedWarn, recovered: a.recovered });

  section("delve step 4: the swimming throw is priced");
  const sp = await page(gm, P.swimPriced);
  note("swim priced", sp);
  check("step 4: cold and rough price the throw from their own entries with nothing unknown; speed, drowning and the rescue load follow the world's figures", allTrue(sp), sp);

  section("delve step 5: a carried casualty weighs on its carrier");
  note("porter", { porter: r.porter, porterWarn: r.porterWarn });
  check("step 5: Porter's line shows its own encumbrance left of the arrow and that plus the body's figure, to a tenth, on the right (Order row and warning agree)", !!r.porter && r.porter.leftIsOwn && r.porter.leftNonZero && r.porter.rightIsLeftPlusBody && !r.porter.sameBothSides && !!r.porterWarn && r.porterWarn.rightIsLeftPlusBody && r.porterWarn.sameRow, { porter: r.porter, porterWarn: r.porterWarn });

  section("delve step 6: the navigation bonus is priced");
  const n1 = await page(gm, P.navStep, { fid, scoutId: scout.id, phase: "journey" });
  note("journey", n1);
  check("step 6: journeying on forest with no road, one competence earns the either figure and nothing is unpriced", n1.mode === "journey" && n1.ground === "forest" && n1.road === "none" && n1.competence.navigation && !n1.competence.pathfinding && n1.competence.eitherBonus && !n1.competence.unpriced, n1);
  const n2 = await page(gm, P.navStep, { fid, scoutId: scout.id, phase: "pathfinding" });
  note("pathfinding", n2);
  check("step 6: with Pathfinding on Scout, both competences earn the both figure", n2.item && n2.competence.pathfinding && n2.competence.bothBonus && !n2.competence.unpriced, n2);
  note("rig", await page(gm, P.rig, { want: 20 }));
  let n3;
  try {
    n3 = await page(gm, P.navStep, { fid, scoutId: scout.id, phase: "throw" });
  } finally {
    note("unrig", await page(gm, P.unrig));
  }
  trackMsgs(gm, n3.messages, "navigation throw");
  note("throw", { navCards: n3.navCards, card: n3.card, historyGrew: n3.historyGrew, result: n3.result });
  check("step 6: the whispered navigation card carries the both line and no unpriced line, and the history gained the row", n3.navCards === 1 && n3.card?.whispered && n3.card.both && !n3.card.unpriced && n3.historyGrew, { card: n3.card, historyGrew: n3.historyGrew });
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "delve, all");
}

async function swim(gm, player, census) {
  section("swimming: steps 1-7 on the player seat's registry (no automation runs there)");
  const playerId = census.player.userId;
  const swimmer = await gm.create("Actor", { name: `QA Swimmer ${NONCE}`, type: "character", ownership: { default: 0, [playerId]: 3 }, system: { hp: { value: 5, max: 5 } } });
  ctx.afterTeardown.push(async () => note("swimming teardown reload (player seat)", await page(player, P.reloadTables)));
  await sleep(800);
  const s = await page(player, P.swim, { actorId: swimmer.id });
  note("swim", s);
  check("swimming step 1: the world's import is on this client, and unregisterTable with no priority takes every layer off it", s.step1.worldHeld && s.step1.worldLayer && s.step1.afterUnregister === false, s.step1);
  check("swimming step 2: every accessor returns null, never 0", Object.values(s.step2).every((v) => v === null), s.step2);
  check("swimming step 3: calm is 0, rough and cold null", s.step3.calm === 0 && s.step3.rough === null && s.step3.cold === null, s.step3);
  check("swimming step 4: rough names swimWaterModifiers and prices nothing; calm is 0, not needed, nothing unknown", s.step4.rough.target === null && s.step4.rough.needed === null && same(s.step4.rough.unknown, ["swimWaterModifiers"]) && s.step4.calm.target === 0 && s.step4.calm.needed === false && same(s.step4.calm.unknown, []), s.step4);
  check("swimming step 5: drowning is all null", s.step5.rounds === null && s.step5.feetPerRound === null && s.step5.depthAtDeath === null, s.step5);
  check("swimming step 6: the fabricated document answers every accessor and the rough throw carries its water row", s.step6.swimmingBonus === 77 && s.step6.swimSpeedShare === 0.42 && s.step6.sinkFeetPerStone === 88 && s.step6.breathRounds === 99 && same(s.step6.rough.unknown, []) && same(s.step6.rough.waterPart, { key: "water.rough", value: -55 }) && s.step6.rough.target === 55, s.step6);
  check("swimming step 7: unregistering by { priority } removes it: null again and hasDoc false", s.step7.swimmingBonus === null && s.step7.hasDoc === false && !s.fabricatedRemovedInFinally, s.step7);
  const back = await page(player, P.reloadTables);
  note("reload", back);
  check("swimming teardown: reload() mirrors the world's store back into the player's registry (formation at WORLD priority, no override)", back.formation.hasDoc && back.formation.layer20Keys === 10 && back.formation.bonusFromWorld && !back.formation.override && back.travel.hasDoc && !back.travel.override, back);
}

/* ------------------------------------------------------------------ */
/*  The frame                                                           */
/* ------------------------------------------------------------------ */

/**
 * A second DevTools client on a seat's browser, attached to its game page, for
 * the presses the driver has no API for: a real pointer drag and real Tab keys.
 * Prints no address.
 */
async function rawInput(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = await r.json();
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw input: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  if (pages.length !== 1) { try { ws.close(); } catch { /* closed */ } throw new Error(`raw input: ${pages.length} game pages on this seat`); }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send("Page.bringToFront");
  try { await send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch { /* not offered */ }
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  return {
    async drag(from, to, steps = 10) {
      await mouse("mouseMoved", from.x, from.y, { button: "none", buttons: 0 });
      await sleep(80);
      await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { button: "left", buttons: 1 });
        await sleep(40);
      }
      await mouse("mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1 });
      await sleep(200);
    },
    async park(x, y) {
      await mouse("mouseMoved", x, y, { button: "none", buttons: 0 });
      await sleep(150);
    },
    async tab() {
      const k = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      await sleep(50);
    },
    close() { try { ws.close(); } catch { /* closed */ } },
  };
}

/** A scene that is never activated, so no other seat is pulled onto it. */
const sceneData = (name, grid) => ({
  name, active: false, navigation: false, width: 2200, height: 1600, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
  grid: { type: grid.type, size: 100, distance: grid.distance ?? 7, units: grid.units ?? "mi" },
  ownership: { default: 2 },
});

/** Where the pointer rests between real presses: over the canvas, right of the widest sheet. */
const PARK = { x: 1240, y: 200 };

const sameSet = (a, b) => same([...new Set(a)].sort(), [...new Set(b)].sort());

/** Tab from the crest through the window, recording which tagged control holds focus after each press. */
async function keyboardWalk(api, input, partyId, { hunted = false } = {}) {
  const fz = await page(api, P.frameFocusables, { partyId });
  const ks = fz.list.map((e) => e.k);
  const seq = fz.start != null ? [Number(fz.start)] : [];
  const readingFocused = [];
  let ring = null;
  let outside = 0;
  for (let i = 0; i < fz.list.length + 40; i++) {
    await input.tab();
    const f = await page(api, P.frameFocused, { partyId });
    if (f.reading) readingFocused.push(f.id);
    if (f.k != null) seq.push(Number(f.k));
    if (hunted && f.id === "travel.settlement.wanted" && !ring) ring = await page(api, P.frameHuntedRing, { partyId });
    if (!f.inWindow) {
      outside++;
      if (seq.includes(ks[ks.length - 1]) || outside > 4) break;
    }
  }
  const reached = new Set(seq);
  const missed = fz.list.filter((e) => !reached.has(e.k));
  const ordered = seq.every((k, i) => i === 0 || k > seq[i - 1]);
  const unnamed = fz.list.filter((e) => !e.named || e.named === "placeholder");
  return { count: fz.list.length, start: fz.start, seqLength: seq.length, ordered, missed, readingFocused, unnamed, ring, regions: [...new Set(fz.list.map((e) => e.region))] };
}

async function frame(gm, player, census) {
  section("frame: fixtures (a mile-scale hex scene, a party adopted there, two members enrolled through the token HUD, a table)");
  const playerId = census.player.userId;
  note("partyPanel keys before the walk", { gm: census.gm.partyPanelKeys, player: census.player.partyPanelKeys });
  await page(gm, P.claimNonce, { nonce: NONCE });
  await page(player, P.claimNonce, { nonce: NONCE });
  const t0 = await page(gm, P.now);
  const scene = await gm.create("Scene", sceneData(`QA Frame hex ${NONCE}`, { type: 2 }));
  note("hex scene viewed on the GM seat", await page(gm, P.viewScene, scene.id));
  const party = await gm.create("Actor", { name: `QA Frame Party ${NONCE}`, type: "acks-extras.party" });
  const mk = (name, hp, extra = {}) => gm.create("Actor", { name: `QA ${name} ${NONCE}`, type: "character", system: { hp: { value: hp, max: Math.max(hp, 6) } }, items: [], ...extra });
  const ranger = await mk("Frame Ranger", 7, { ownership: { default: 0, [playerId]: 3 } });
  const smith = await mk("Frame Smith", 6);
  const table = await gm.create("RollTable", { name: `QA Frame Table ${NONCE}`, formula: "1d2" });
  const fx = await page(gm, P.frameFixtures, { sceneId: scene.id, partyId: party.id, memberIds: [ranger.id, smith.id], xy: { x: 500, y: 500 } });
  if (fx.tokenUuid) gm.track(fx.tokenUuid, "Token");
  for (const u of fx.memberTokens ?? []) gm.track(u, "Token");
  note("fixtures", fx);
  if (fx.error) throw new Error(fx.error);
  const fid = fx.fid;
  check("frame fixtures: the party token is adopted on the hex scene and both characters enrol through the token HUD (the HUD removes each member's own token)", fx.adopted && fx.enrolled.length === 2 && fx.enrolled.every((e) => e.hud && e.ok), { adopted: fx.adopted, mode: fx.mode, enrolled: fx.enrolled, hudError: fx.hudError ?? null });
  if (!fx.adopted || !fx.enrolled.every((e) => e.ok)) throw new Error("frame fixtures incomplete");
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "fixtures");
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (GM seat)", await page(gm, P.framePanelFlagClear, { partyId: party.id })));
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (player seat)", await page(player, P.framePanelFlagClear, { partyId: party.id })));

  const input = await rawInput(PORTS.gm);
  ctx.afterTeardown.push(async () => input.close());

  section("frame step 1: the band is the header");
  const o = await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  note("open", o);
  check("step 1: [data-application-part=band] is one element, inside :scope > .window-header, before the header's controls", o.bands === 1 && o.inHeader && o.beforeControls, { bands: o.bands, inHeader: o.inHeader, beforeControls: o.beforeControls });
  if (o.bar) {
    await input.drag({ x: o.bar.x, y: o.bar.y }, { x: o.bar.x + 140, y: o.bar.y + 60 });
    await input.park(PARK.x, PARK.y);
  }
  const moved = await page(gm, P.framePosition, { partyId: party.id });
  check("step 1: a real pointer drag that starts on the bar (no data-action) moves the window: position.left changes", !!o.bar && o.bar.action === null && moved.left !== o.left, { bar: o.bar ? { action: o.bar.action, w: o.bar.w, h: o.bar.h } : null, before: { left: o.left, top: o.top }, after: moved });
  note("home", await page(gm, P.frameHome, { partyId: party.id }));
  const newName = `QA Frame Company ${NONCE}`;
  const cn = await page(gm, P.frameCrestName, { partyId: party.id, fid, newName });
  note("crest and name", cn);
  check("step 1: the crest opens the Order tab", cn.before !== "order" && cn.crestTab === "order", { before: cn.before, after: cn.crestTab });
  check("step 1: a new name typed in the band lands in the formation record's name and in the party actor's", cn.record && cn.actor, { record: cn.record, actor: cn.actor });

  section("frame step 2: one set of rails, in each mode and on each tab");
  const R = {};
  for (const mode of ["delve", "settlement", "journey"]) {
    R[mode] = await page(gm, P.frameRails, { partyId: party.id, fid, mode });
    note(`rails ${mode}`, R[mode]);
    check(`step 2 (${mode}): four rails of 6, 5, 5 and 5 cells, the same list on every tab, each pill showing its tab`, R[mode].mode === mode && same(R[mode].counts, [6, 5, 5, 5]) && R[mode].sameOnEveryTab && R[mode].everyPillActivates, { mode: R[mode].mode, counts: R[mode].counts, sameOnEveryTab: R[mode].sameOnEveryTab, pills: R[mode].pills, labels: R[mode].labels });
    if (mode === "delve") {
      check("step 3 (delve): the Dungeon head holds advanceTurn, advanceRound, restTurn, undoTurn and togglePace", sameSet(R.delve.headActions, ["advanceTurn", "advanceRound", "restTurn", "undoTurn", "togglePace"]) && R.delve.headActions.length === 5, R.delve.headActions);
      note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
      note("calm", await page(gm, P.calm));
      await shot(gm, "formation-frame", ".application.acks-extras-party-sheet");
    }
    if (mode === "settlement") {
      check("step 3 (city): the City head holds the Hunted here toggle (travel.settlement.wanted) and the four turn pills; no point of interest is in reach, so no hop", sameSet(R.settlement.headActions, ["travel.settlement.wanted", "advanceTurn", "advanceRound", "restTurn", "undoTurn"]) && R.settlement.headActions.length === 5, R.settlement.headActions);
      const cityKeys = ["travel.settlement.pace", "travel.settlement.where", "travel.settlement.route", "travel.settlement.hour", "travel.settlement.intent", "travel.settlement.conveyance"];
      const ch = await page(gm, P.frameHomes, { partyId: party.id, keys: ["travel.settlement.wanted", ...cityKeys] });
      const cityBad = cityKeys.filter((k) => !(ch[k]?.length === 1 && ch[k][0].part === "mode" && ch[k][0].section === "city"));
      check("step 3 (city): The city holds pace, where, route, hour, intent and conveyance, each once", cityBad.length === 0, cityBad.length ? Object.fromEntries(cityBad.map((k) => [k, ch[k]])) : cityKeys.length);
      check("step 3 (city): the Hunted toggle is found once, in the mode tab's head", ch["travel.settlement.wanted"]?.length === 1 && ch["travel.settlement.wanted"][0].head && ch["travel.settlement.wanted"][0].part === "mode", ch["travel.settlement.wanted"]);
      const w = await page(gm, P.frameField, { partyId: party.id, fid, name: "travel.settlement.wanted", kind: "check", path: "travel.settlement.wanted" });
      note("field travel.settlement.wanted", w);
      check("step 3 (city): travel.settlement.wanted takes the new value", w.found && w.recordOk && w.shownKept, w);
      note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
      note("calm", await page(gm, P.calm));
      await shot(gm, "formation-tabs-by-mode", ".application.acks-extras-party-sheet");
    }
  }
  check("step 2: the tab row is named by the mode (the mode tab and the roster tab change their names; Kit, Sightings and the Judge's do not)", new Set([R.delve.labels[0], R.journey.labels[0], R.settlement.labels[0]]).size === 3 && new Set([R.delve.labels[1], R.journey.labels[1], R.settlement.labels[1]]).size === 3 && same(R.delve.labels.slice(2), R.journey.labels.slice(2)) && same(R.delve.labels.slice(2), R.settlement.labels.slice(2)), { delve: R.delve.labels, journey: R.journey.labels, settlement: R.settlement.labels });
  const flat = (x) => (x.rails ?? []).flat();
  const diffs = (a, b) => flat(a).map((x, i) => (x === flat(b)[i] ? null : `${x}|${flat(b)[i]}`)).filter(Boolean);
  const jd = diffs(R.journey, R.delve);
  const cd = diffs(R.settlement, R.delve);
  check("step 2: across the modes three presses change and nothing else (pace goTab>mode vs togglePace, travelEncounterThrow vs encounterNow, searchHour vs partyCheck:searchMethodical); the city's rails are the delve's", sameSet(jd, ["goTab>mode|togglePace", "travelEncounterThrow|encounterNow", "searchHour|partyCheck:searchMethodical"]) && jd.length === 3 && cd.length === 0, { journeyVsDelve: jd, cityVsDelve: cd });
  const feet = (s) => /^\d+'$/.test(s ?? "");
  const dash = (s) => s === "—";
  const subs = { delve: [R.delve.paceSub, R.delve.lightSub], journey: [R.journey.paceSub, R.journey.lightSub], settlement: [R.settlement.paceSub, R.settlement.lightSub] };
  check("step 2: the readings change with the mode: pace in feet (delve, journey) or blocks (city); light as hours to dusk or dawn (journey), turns left or a dash with no light lit (delve), the hour (city)", feet(R.delve.paceSub) && feet(R.journey.paceSub) && (/^\d+(\.\d+)? bl$/.test(R.settlement.paceSub ?? "") || dash(R.settlement.paceSub)) && (/^\d+(\.\d+)? h$/.test(R.journey.lightSub ?? "") || /\d/.test(R.journey.lightSub ?? "")) && (/^\d+ t$/.test(R.delve.lightSub ?? "") || dash(R.delve.lightSub)) && (/\d/.test(R.settlement.lightSub ?? "") || dash(R.settlement.lightSub)), subs);

  section("frame step 2: each cell pressed once on a journey (GM seat)");
  const press = async (which, extra = {}) => {
    await page(gm, P.frameHome, { partyId: party.id });
    const r = await page(gm, P.framePress, { partyId: party.id, fid, which, ...extra });
    trackMsgs(gm, r.messages, `press ${which}`);
    note(`press ${which}`, (({ messages, ...rest }) => rest)(r));
    return r;
  };
  let p = await press("save");
  check("step 2: a save posts its card, against a magical source while Magical is on", p.found && p.cards === 1 && p.magicalNote && !p.mundaneNote, { cards: p.cards, magical: p.magicalNote, mundane: p.mundaneNote });
  p = await press("magical");
  check("step 2: with Magical turned off the next save card says so (and the toggle is put back on)", p.pressedAfter === "false" && p.cards === 1 && p.mundaneNote && !p.magicalNote && p.pressedRestored === "true", { pressedAfter: p.pressedAfter, cards: p.cards, mundane: p.mundaneNote, restored: p.pressedRestored });
  p = await press("hp");
  check("step 2: hit points opens the hit-point tool", p.found && p.opened.length >= 1, p.opened);
  p = await press("supplies");
  check("step 2: supplies posts the rations card", p.found && p.cards === 1 && p.rations, { cards: p.cards, rations: p.rations });
  for (const w of ["mouths", "pace", "light"]) {
    p = await press(w);
    check(`step 2: ${w} opens the ${p.want} tab`, p.found && p.from !== p.want && p.tab === p.want, { from: p.from, tab: p.tab });
  }
  p = await press("checks");
  check("step 2: party checks lists the party's checks and rolls the one pressed", p.dialog && p.buttons.length >= 2 && p.cards === 1, { buttons: p.buttons, cards: p.cards });
  p = await press("pause");
  check("step 2: pause flips clock.pausedBy (judge, then back)", p.pausedBy1 === "judge" && p.pausedBy2 === null, { first: p.pausedBy1, second: p.pausedBy2 });
  p = await press("xp");
  check("step 2: experience opens the XP dialog (closed unsubmitted)", p.found && p.opened.length >= 1, p.opened);
  p = await press("description", { marker: `QA note ${NONCE}` });
  check("step 2: the description tool opens an editor in the reading column, and what it saves lands in the actor's system.description (editor closed, prose shown)", p.editor && p.saved && p.editorClosed && p.proseShown, { editor: p.editor, saved: p.saved, editorClosed: p.editorClosed, proseShown: p.proseShown });
  p = await press("image");
  check("step 2: the image tool opens the file picker", p.found && p.opened.some((n) => /Picker/.test(n)), p.opened);
  p = await press("ownership");
  check("step 2: ownership opens core's ownership window", p.found && p.opened.some((n) => /Ownership/.test(n)), p.opened);
  p = await press("tweaks", { tableId: table.id });
  check("step 2: Tweaks lists the world's tables and the pick lands in the record's tableId", p.dialog && p.listsWorldTables && p.tableId, { options: p.options, listsWorldTables: p.listsWorldTables, tableId: p.tableId });
  p = await press("key");
  check("step 2: the Key opens the legend under the art row, every rail glyph named", p.legend && p.underArtRow && p.unnamedInLegend.length === 0 && p.legendRows === p.railGlyphs, { legend: p.legend, underArtRow: p.underArtRow, railGlyphs: p.railGlyphs, legendRows: p.legendRows, unnamed: p.unnamedInLegend });
  p = await press("encounter");
  check("step 2: the encounter tool posts this formation's throw card", p.found && p.encounterCard, { cards: p.cards, encounterCard: p.encounterCard });
  p = await press("search");
  check("step 2: the search tool spends an hour of the world clock and posts its card", p.found && p.worldTimeDelta === 3600 && p.searchCards === 1, { worldTimeDelta: p.worldTimeDelta, searchCards: p.searchCards });
  trackMsgs(gm, p.messages, "press search (search card)");

  section("frame step 3: every fold's control has one home (journey, GM seat)");
  note("home", await page(gm, P.frameHome, { partyId: party.id }));
  const HOME = [
    ["band", { part: "band" }, ["travel.mode", "name"]],
    ["Wilderness head", { part: "mode", head: true }, ["travel.hexLabel", "@travelEnterHex", "@forageDay", "@travelEndDay"]],
    ["Points of interest", { part: "mode", section: "poi" }, ["@hexStock", "travel.camp.present", "travel.camp.target"]],
    ["Movement", { part: "mode", section: "movement" }, ["travel.movement.mode"]],
    ["Sky", { part: "mode", section: "sky" }, ["travel.weather.season", "travel.weather.auto", "travel.weather.fronts", "travel.weather.temperature", "travel.weather.precipitation", "travel.weather.wind", "travel.weather.footingMud", "travel.weather.footingSnow", "@travelWeatherRoll"]],
    ["Day", { part: "mode", section: "day" }, ["travel.day.kind", "travel.day.slot.*", "travel.hour", "travel.day.traps", "travel.day.noSleep"]],
    ["Camp", { part: "mode", section: "camp" }, ["travel.exposure.hours", "travel.exposure.atHeatSource", "travel.exposure.wet", "travel.camp.steal", "travel.camp.water", "travel.camp.sleepInArmour"]],
    ["Judge tab, The episode", { part: "judge", section: "episode" }, ["@lostBegin", "travel.lostNote"]],
    ["Judge tab, The Judge's hand", { part: "judge", section: "hand" }, ["travel.override.ground", "travel.override.encounterTerrain", "travel.override.territory", "travel.override.climate", "travel.override.road", "travel.override.following"]],
    ["Order head", { part: "order", head: true }, ["@autoArrange", "frontage", "@saveMarchingOrder", "@loadMarchingOrder", "@addBlank", "@openTrapbreak", "@openSkillAudit", "@disband"]],
  ];
  const homes = await page(gm, P.frameHomes, { partyId: party.id, keys: [...HOME.flatMap(([, , ks]) => ks), "@paintThisHex", "@clearOverride"] });
  for (const [group, want, ks] of HOME) {
    const bad = ks.filter((k) => {
      const hits = homes[k] ?? [];
      const countOk = k.endsWith("*") ? hits.length >= 1 : hits.length === 1;
      return !countOk || !hits.every((h) => h.part === want.part && (want.section === undefined || h.section === want.section) && (want.head === undefined || h.head === want.head));
    });
    check(`step 3: ${group}: each control found once, where the table says`, bad.length === 0, bad.length ? Object.fromEntries(bad.map((k) => [k, homes[k]])) : `${ks.length} controls`);
  }
  note("country (paintThisHex) and clearOverride before any override", { paintThisHex: homes["@paintThisHex"], clearOverride: homes["@clearOverride"] });
  check("step 3: the Camp section renders after Day, its forecast first", homes.$campAfterDay && homes.$campForecastFirst, { campAfterDay: homes.$campAfterDay, forecastFirst: homes.$campForecastFirst });
  const FIELDS = [
    ["travel.override.territory", "select", null, "travel.override.territory"],
    ["travel.camp.present", "select", null, "travel.camp.present"],
    ["travel.movement.mode", "select", null, "travel.movement.mode"],
    ["travel.weather.temperature", "select", null, "travel.weather.temperature"],
    ["travel.hour", "select", null, "travel.hour"],
    ["travel.camp.steal", "check", null, "travel.camp.steal"],
    ["travel.lostNote", "text", `QA note ${NONCE}`, "travel.lost.judgeNote"],
  ];
  for (const [name, kind, value, path] of FIELDS) {
    const f = await page(gm, P.frameField, { partyId: party.id, fid, name, kind, value, path });
    note(`field ${name}`, f);
    check(`step 3: ${name} takes the new value (record ${path}, and the field shows it after the re-render)`, f.found && f.recordOk && f.shownKept, { found: f.found, recordOk: f.recordOk, shownKept: f.shownKept });
  }
  const after = await page(gm, P.frameHomes, { partyId: party.id, keys: ["@clearOverride"] });
  note("clearOverride once travel.override.territory is set", after["@clearOverride"]);
  note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
  note("calm", await page(gm, P.calm));
  await shot(gm, "formation-camp-section", '[data-application-part="mode"] [data-section="camp"]');
  const ed = await page(gm, P.frameEndDay, { partyId: party.id, fid });
  trackMsgs(gm, ed.messages, "End day");
  note("End day", (({ messages, ...rest }) => rest)(ed));
  check("step 3: End day, pressed once on the Wilderness head, adds one row to travel.log, and Sightings lists it", ed.after === ed.before + 1 && ed.rowsInSightings === ed.after, { before: ed.before, after: ed.after, rowsInSightings: ed.rowsInSightings, worldTimeDelta: ed.worldTimeDelta });

  section("frame step 4: the Judge's tab is the Judge's (player seat)");
  const pl = await page(player, P.framePlayer, { partyId: party.id });
  note("player view", pl);
  check("step 4: the player seat holds the party actor through the member it owns", pl.level === 3, { level: pl.level });
  check("step 4: no [data-application-part=judge] and no [data-tab=judge] anywhere in the player's window", !pl.judgePart && !pl.judgeTab, { judgePart: pl.judgePart, judgeTab: pl.judgeTab });
  check("step 4: no saves rail and no quick tools; the sheet tools are the Key alone", same(pl.rails, ["figures", "sheet"]) && same(pl.sheetTools, ["toggleKey"]), { rails: pl.rails, sheetTools: pl.sheetTools });
  check("step 4: hit points and supplies are readings (span.is-reading, no data-action) while mouths and light still open their tabs", pl.hpReading && pl.suppliesReading && pl.mouthsOpens && pl.lightOpens, { hp: pl.hpReading, supplies: pl.suppliesReading, mouths: pl.mouthsOpens, light: pl.lightOpens });
  check("step 4: the band's mode word and name are text", pl.modeText === "SPAN" && pl.nameText === "SPAN" && pl.noModeSelect && pl.noNameInput, { mode: pl.modeText, name: pl.nameText });
  check("step 4: the mode tab ends with the requests section (the seat owns a member)", pl.endsWithRequests, { sections: pl.sections, requests: pl.requests });
  const jp = await page(gm, P.frameJudgePill, { partyId: party.id });
  check("step 4: on the GM seat the Judge pill is dashed and its part is present", jp.pill && jp.dashed && jp.part, jp);

  section("frame step 5: the chevron");
  note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
  const hv = await page(gm, P.frameChevron, { partyId: party.id, phase: "hide" });
  note("chevron hide", hv);
  check("step 5: the chevron hides the panel: is-panel-hidden, no tab panel displayed, the window shorter, the seat's partyPanel flag true", hv.hidden.cls && hv.hidden.tabsShown === 0 && hv.hidden.h1 < hv.hidden.h0 && hv.hidden.flag === true, hv.hidden);
  check("step 5: still hidden after sheet.render(), and after a close and reopen", hv.afterRender.cls && hv.afterRender.tabsShown === 0 && hv.afterReopen.cls && hv.afterReopen.tabsShown === 0, { afterRender: hv.afterRender, afterReopen: hv.afterReopen });
  const pk = await page(player, P.frameChevron, { partyId: party.id, phase: "peek" });
  check("step 5: the player seat's sheet keeps its panel", pk.rendered && !pk.cls && pk.tabsShown === 1 && pk.flag !== true, pk);
  const sv = await page(gm, P.frameChevron, { partyId: party.id, phase: "show" });
  check("step 5: a pill shows the panel on that tab, and the flag reads false", !sv.cls && sv.tab === "order" && sv.orderShown && sv.flag === false, sv);

  section("frame step 6: two type sizes (GM seat)");
  ctx.settingsToRestore.push({ seat: "gm", key: "fontScale", value: 14 });
  note("fontScale 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  await page(gm, P.calm);
  const m14 = await page(gm, P.frameMeasure, { partyId: party.id });
  note("at 14", m14);
  const nar14 = await page(gm, P.frameNarrow, { partyId: party.id });
  note("narrowed at 14", nar14);
  note("fontScale 18", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 }));
  await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  await page(gm, P.calm);
  const m18 = await page(gm, P.frameMeasure, { partyId: party.id });
  note("at 18", m18);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const wantW18 = Math.min(Math.round(920 * 18 / 14), m18.viewport.w);
  check("step 6: at 14 the window is 920 wide, a rail cell 32 high, the bar 26, k 1", near(m14.width, 920, 1) && near(m14.cell, 32, 0.3) && near(m14.bar, 26, 0.3) && near(m14.k, 1, 0.001), { width: m14.width, cell: m14.cell, bar: m14.bar, k: m14.k });
  check("step 6: at 18 the window is 1183 wide, a rail cell 41.1, the bar 33.4, k 1.2857", near(m18.width, wantW18, 1.5) && near(m18.cell, 41.1, 0.3) && near(m18.bar, 33.4, 0.3) && near(m18.k, 1.2857, 0.001), { width: m18.width, cell: m18.cell, bar: m18.bar, k: m18.k });
  check("step 6: at 18 the band sits inside its header", m18.bandInHeader, { bandInHeader: m18.bandInHeader });
  // Only the active panel is a scroller, so each tab is made the active one to be read.
  const ps18 = await page(gm, P.f6PartScroll, { partyId: party.id });
  check("step 6: at 18 every tab, made the active one, scrolls at its own part root", Object.values(ps18).every((v) => v.active && /auto|scroll/.test(v.overflowY ?? "")), ps18);
  const partRoot = (s) => /\[part=(mode|order|kit|sightings|judge)\]/.test(s) && !/\[section=/.test(s);
  const gained = m18.overflow.filter((s) => !m14.overflow.includes(s) && !partRoot(s));
  check("step 6: no other element gains at 18 an overflow it lacked at 14", gained.length === 0, { gained, at14: m14.overflow.length, at18: m18.overflow.length });
  note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
  const ss = await page(gm, P.frameShortScroll, { partyId: party.id });
  note("short window", ss);
  check("step 6: in the 520-high window the content box stays under the frame and only the Wilderness part's scrollHeight exceeds its box", ss.short.wcClient < ss.short.frameH && ss.short.wcScroll <= ss.short.wcClient + 1 && ss.short.partScroll > ss.short.partClient, ss.short);
  check("step 6: the Wilderness tab keeps its scroll across a field change while it still overflows after the re-fit", ss.after.stillOverflows ? ss.kept : true, { scrolled: ss.scrolled, after: ss.after, kept: ss.kept, field: ss.field });
  const nar18 = await page(gm, P.frameNarrow, { partyId: party.id });
  note("narrowed at 18", nar18);
  check("step 6: narrowed toward the 640px floor, no control is cut off without a scroller to reach it (at 14 and at 18)", nar14.cut.length === 0 && nar18.cut.length === 0, { at14: { width: nar14.width, minWidth: nar14.minWidth, cut: nar14.cut, clipped: nar14.clippedCount }, at18: { width: nar18.width, minWidth: nar18.minWidth, cut: nar18.cut, clipped: nar18.clippedCount } });
  note("fontScale back to 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));

  section("frame step 7: keyboard and names (GM seat)");
  await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
  await input.park(PARK.x, PARK.y);
  const kj = await keyboardWalk(gm, input, party.id);
  note("journey walk", { count: kj.count, seqLength: kj.seqLength, ordered: kj.ordered, missed: kj.missed, readingFocused: kj.readingFocused, regions: kj.regions, unnamed: kj.unnamed });
  check("step 7 (journey): from the crest, Tab reaches every control of the band, the rails, the tab row and the Wilderness tab's head and sections, in reading order", kj.count > 0 && kj.missed.length === 0 && kj.ordered, { count: kj.count, missed: kj.missed.map((e) => `${e.region}:${e.id}`), ordered: kj.ordered });
  check("step 7 (journey): the reading cells are passed over", kj.readingFocused.length === 0, kj.readingFocused);
  const unnamedJ = kj.unnamed.filter((e) => !e.requests);
  check("step 7 (journey): every control reached is named by its text, an aria-label or a tooltip (the requests section's pickers excepted)", unnamedJ.length === 0, unnamedJ.map((e) => `${e.region}/${e.section ?? "-"}:${e.tag}:${e.id}:${e.named}`));
  note("mode settlement", await page(gm, P.frameMode, { partyId: party.id, fid, mode: "settlement" }));
  note("home", await page(gm, P.frameHome, { partyId: party.id, tab: "mode" }));
  const ring0 = await page(gm, P.frameHuntedRing, { partyId: party.id });
  const kc = await keyboardWalk(gm, input, party.id, { hunted: true });
  note("city walk", { count: kc.count, seqLength: kc.seqLength, ordered: kc.ordered, missed: kc.missed, readingFocused: kc.readingFocused, unnamed: kc.unnamed, ring0, ring: kc.ring });
  check("step 7 (city): Tab reaches every control of the band, rails, tab row, City head and The city, in reading order", kc.count > 0 && kc.missed.length === 0 && kc.ordered, { count: kc.count, missed: kc.missed.map((e) => `${e.region}:${e.id}`), ordered: kc.ordered });
  check("step 7 (city): the Hunted here pill shows a focus ring while its checkbox has focus", !!kc.ring && kc.ring.focused && (kc.ring.boxShadow !== ring0.boxShadow || kc.ring.outline !== ring0.outline) && (kc.ring.boxShadow !== "none" || !/^none/.test(kc.ring.outline)), { unfocused: ring0, focused: kc.ring });
  const unnamedC = kc.unnamed.filter((e) => !e.requests);
  check("step 7 (city): every control reached is named (the requests section's pickers excepted)", unnamedC.length === 0, unnamedC.map((e) => `${e.region}/${e.section ?? "-"}:${e.tag}:${e.id}:${e.named}`));
  await input.park(PARK.x, PARK.y);
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "frame, all");
}

/* ------------------------------------------------------------------ */
/*  The journey and the march (changed steps), and the frame re-check   */
/* ------------------------------------------------------------------ */

const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const strip = ({ messages, ...rest }) => rest;

async function journey(gm, player, census) {
  section("journey: fixtures (a feet-scale square scene, a mile-scale hex scene, a party adopted on the first, two members enrolled through the token HUD)");
  const playerId = census.player.userId;
  await page(gm, P.claimNonce, { nonce: NONCE });
  await page(player, P.claimNonce, { nonce: NONCE });
  const t0 = await page(gm, P.now);
  const feetScene = await gm.create("Scene", { ...sceneData(`QA Journey feet ${NONCE}`, { type: 1, distance: 13, units: "ft" }), width: 3200, height: 2000 });
  const hexScene = await gm.create("Scene", sceneData(`QA Journey hex ${NONCE}`, { type: 2, distance: 7, units: "mi" }));
  note("feet scene viewed on the GM seat", await page(gm, P.viewScene, feetScene.id));
  const party = await gm.create("Actor", { name: `QA Journey Party ${NONCE}`, type: "acks-extras.party" });
  const mk = (name, hp, extra = {}) => gm.create("Actor", { name: `QA ${name} ${NONCE}`, type: "character", system: { hp: { value: hp, max: Math.max(hp, 6) } }, items: [], ...extra });
  const ranger = await mk("Journey Ranger", 7, { ownership: { default: 0, [playerId]: 3 } });
  const smith = await mk("Journey Smith", 6);
  const fx = await page(gm, P.frameFixtures, { sceneId: feetScene.id, partyId: party.id, memberIds: [ranger.id, smith.id], xy: { x: 300, y: 300 } });
  if (fx.tokenUuid) gm.track(fx.tokenUuid, "Token");
  for (const u of fx.memberTokens ?? []) gm.track(u, "Token");
  note("fixtures", fx);
  if (fx.error) throw new Error(fx.error);
  const fid = fx.fid;
  check("journey fixtures: the party token is adopted on the feet-scale scene in delve mode, and both characters enrol through the token HUD", fx.adopted && fx.mode === "delve" && fx.enrolled.length === 2 && fx.enrolled.every((e) => e.hud && e.ok), { adopted: fx.adopted, mode: fx.mode, enrolled: fx.enrolled });
  if (!fx.adopted || !fx.enrolled.every((e) => e.ok)) throw new Error("journey fixtures incomplete");
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "fixtures");
  ctx.afterTeardown.push(async () => note("journey teardown reload (player seat)", await page(player, P.reloadTables)));
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (GM seat)", await page(gm, P.framePanelFlagClear, { partyId: party.id })));
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (player seat)", await page(player, P.framePanelFlagClear, { partyId: party.id })));
  note("clock at the start", await page(gm, P.clockNow));
  note("open", strip(await page(gm, P.frameOpen, { partyId: party.id, fresh: true })));

  section("journey step 1: Journey picked in the band's mode select (GM seat)");
  const j1 = await page(gm, P.jMode, { partyId: party.id, fid, mode: "journey" });
  note("mode journey", (({ day, ...r }) => r)(j1));
  check("step 1: the band's select offers Journey and the pick lands: travel.mode is journey on the record", j1.found && j1.offered.includes("journey") && j1.ok && j1.mode === "journey", { found: j1.found, offered: j1.offered, mode: j1.mode });
  check("step 1: the mode tab becomes Wilderness", !!j1.pill && j1.pill === j1.wantPill, { pill: j1.pill, want: j1.wantPill });
  check("step 1: the strip shows the journey cells and the declaration sections sit under it", j1.strip === "acks-extras-strip-journey" && j1.stripBeforeSections && ["country", "sky", "day", "camp"].every((s) => j1.sections.includes(s)), { strip: j1.strip, stripFirst: j1.stripBeforeSections, sections: j1.sections });
  check("step 1: clock.paused is not set, and no pause is held", !j1.paused && !j1.pausedBy, { paused: j1.paused, pausedBy: j1.pausedBy });

  section("journey step 2: hills and an earth road in the Judge's hand, raining in Sky, a forced march (GM seat)");
  for (const [name, value] of [["travel.override.ground", "hills"], ["travel.override.road", "earth"], ["travel.weather.precipitation", "rainy"], ["travel.day.kind", "forced"]]) {
    const f = await page(gm, P.frameField, { partyId: party.id, fid, name, kind: "select", value, path: name });
    note(`field ${name}`, f);
    check(`step 2: ${name} takes ${value} (the record holds it, the field shows it after the re-render)`, f.found && f.recordOk && f.shownKept, { found: f.found, recordOk: f.recordOk, shown: f.shown });
  }
  const s2 = await page(gm, P.jSlots, { partyId: party.id, fid });
  note("slots under the forced march", s2);
  check("step 2: the four ancillary slots read as consumed: each select shows travel and is disabled, and the record holds travel four times", s2.selects.length === 4 && s2.selects.every((s) => s.disabled && s.value === "travel") && same(s2.activities, ["travel", "travel", "travel", "travel"]), s2);
  const rf = await page(gm, P.jRefuse, { fid });
  check("step 2: a slot edit sent under the forced march is refused (the four travel stand)", rf.unchanged && same(rf.after, ["travel", "travel", "travel", "travel"]), rf);

  section("journey step 2: the readout with no travel tables, then with invented rows at priority 20 (the player seat's registry; no automation runs there)");
  const rNone = await page(player, P.jReadout, { partyId: party.id, fid, phase: "none" });
  note("readout, no travel document", rNone);
  check("step 2 (no tables): the readout carries the tablesMissing line and prices no terrain and no road; its multiplier is the weather conditions' alone and its miles are the forced pace's (the strip shows them)", rNone.stripFound && rNone.dayKind === "forced" && !rNone.hasTravelAfter && rNone.tablesMissingPart && rNone.lineHasMissing && rNone.terrainParts === 0 && rNone.roadParts === 0 && rNone.byPaceAndConditionsAlone && rNone.readoutForced && rNone.stripMilesIsForced, { parts: rNone.parts, conditionParts: rNone.conditionParts, byPaceAndConditionsAlone: rNone.byPaceAndConditionsAlone, lineHasMissing: rNone.lineHasMissing, readoutForced: rNone.readoutForced, stripMilesIsForced: rNone.stripMilesIsForced, contextError: rNone.contextError ?? null });
  // The smith is not the player seat's, so that seat prices the party at 0 and
  // every pace's miles agree; "step 2 again" reads the paces on a party whose
  // every member the seat owns.
  gapCheck("step 2 (no tables): the forced pace's miles differ from the dedicated pace's on the player seat", UNOWNED_PACE, rNone.forcedDiffersFromDedicated, rNone.speedZero, { speedZero: rNone.speedZero, forcedDiffersFromDedicated: rNone.forcedDiffersFromDedicated });
  const rInv = await page(player, P.jReadout, { partyId: party.id, fid, phase: "invented" });
  note("readout, invented rows", rInv);
  const keys = rInv.parts?.map((p) => p.key) ?? [];
  check("step 2 (invented rows): terrain first (hills x0.37), then the earth road worth nothing in the rain (road.washedOut, x1, noted); no tablesMissing; the multiplier is the no-tables one x0.37 and the miles the forced pace's of it (the strip shows them)", keys[0] === "terrain.hills" && rInv.parts[0].factor === 0.37 && keys[1] === "road.washedOut" && rInv.parts[1].factor === 1 && rInv.parts[1].note && !rInv.tablesMissingPart && rInv.ratioToNone === 0.37 && rInv.readoutForced && rInv.stripMilesIsForced && rInv.lineTerrainThenWashedOut, { parts: rInv.parts, ratioToNone: rInv.ratioToNone, lineTerrainThenWashedOut: rInv.lineTerrainThenWashedOut, lineEntries: rInv.lineEntries, readoutForced: rInv.readoutForced, stripMilesIsForced: rInv.stripMilesIsForced });
  const rBack = await page(player, P.jReadout, { partyId: party.id, fid, phase: "restore" });
  note("readout teardown", rBack);
  check("step 2 teardown: unregistering priority 20 and reload() put the world's travel document back on the player seat", rBack.hasTravel === rNone.before?.hasTravel && rBack.layer20Keys === rNone.before?.layer20Keys && !rBack.liveCheck && !rBack.invented && rBack.override === rNone.before?.override, { rBack, before: rNone.before });
  const back = await page(gm, P.frameField, { partyId: party.id, fid, name: "travel.day.kind", kind: "select", value: "march", path: "travel.day.kind" });
  const s3 = await page(gm, P.jSlots, { partyId: party.id, fid });
  note("slots back on the dedicated march", s3);
  check("step 2: back on Dedicated march the slots return EMPTY (not the forced march's travel) and take edits again", back.recordOk && s3.selects.length === 4 && s3.selects.every((s) => !s.disabled && s.value === "") && (s3.activities ?? []).every((a) => !a), s3);

  section("journey step 1: the party token moved while journeying (feet-scale scene; the earth road is followed, so no navigation throw is owed)");
  const d1 = await page(gm, P.jDrag, { fid, dx: 0, dy: 500 });
  trackMsgs(gm, d1.messages, "journey move");
  note("journey move", strip(d1));
  check("step 1: moving the party token while journeying ticks no dungeon turn: clock.turnsTotal and the partial rounds unchanged, the move spent as miles", d1.processed && d1.after.mode === "journey" && d1.after.turnsTotal === d1.before.turnsTotal && d1.after.roundsPartial === d1.before.roundsPartial && d1.after.miles > d1.before.miles, { processed: d1.processed, turns: [d1.before.turnsTotal, d1.after.turnsTotal], rounds: [d1.before.roundsPartial, d1.after.roundsPartial], milesUp: d1.after.miles > d1.before.miles, cards: d1.cards, offer: d1.offer, worldTimeDelta: d1.worldTimeDelta });

  section("journey step 6 / march step 11: Delve picked mid-journey, then dragged (feet-scale scene, GM seat)");
  for (const [i, v] of [[0, "hunt"], [1, "search"]]) note(`slot ${i}`, await page(gm, P.frameField, { partyId: party.id, fid, name: `travel.day.slot.${i}`, kind: "select", value: v, path: `travel.day.activities.${i}` }));
  const board0 = await page(gm, P.jDay, { fid });
  check("step 6 fixture: two ancillary slots hold hunt and search", board0?.activities?.[0] === "hunt" && board0?.activities?.[1] === "search", board0?.activities);
  const dm = await page(gm, P.jMode, { partyId: party.id, fid, mode: "delve" });
  note("mode delve", (({ day, ...r }) => r)(dm));
  check("step 6: picking Delve in the band's select re-anchors the baseline to the token (clock.lastPosition is the token's position) and holds no pause", dm.ok && dm.mode === "delve" && dm.anchored && !dm.paused, { mode: dm.mode, anchored: dm.anchored, lastPosition: dm.lastPosition, token: dm.token, paused: dm.paused });
  const plan = await page(gm, P.jDelvePlan, { fid });
  note("delve plan (pixels for 0.95 and 0.1 of an exploration move)", { ok: plan.ok, units: plan.units, d95: plan.d95, d10: plan.d10, r0: plan.r0 });
  const e1 = await page(gm, P.jDrag, { fid, dx: plan.d95 });
  trackMsgs(gm, e1.messages, "delve move 1");
  note("delve move 1", strip(e1));
  const e2 = await page(gm, P.jDrag, { fid, dx: plan.d10 });
  trackMsgs(gm, e2.messages, "delve move 2");
  note("delve move 2", strip(e2));
  check("step 6 / march 11: 0.95 of an exploration move from where the mode changed marks no turn and posts no card; 0.1 more completes exactly one turn, with its card", plan.ok && plan.r0.roundsPartial === 0 && e1.processed && e1.after.turnsTotal === e1.before.turnsTotal && e1.cards === 0 && e2.processed && e2.after.turnsTotal === e2.before.turnsTotal + 1 && e2.cards >= 1, { r0: plan.r0, move1: { turns: [e1.before.turnsTotal, e1.after.turnsTotal], rounds: [e1.before.roundsPartial, e1.after.roundsPartial], cards: e1.cards }, move2: { turns: [e2.before.turnsTotal, e2.after.turnsTotal], rounds: [e2.before.roundsPartial, e2.after.roundsPartial], cards: e2.cards } });
  const jm = await page(gm, P.jMode, { partyId: party.id, fid, mode: "journey" });
  check("step 6: re-entering journey mode finds the day board where it stood", jm.ok && canon(jm.day) === canon(board0), { same: canon(jm.day) === canon(board0), activities: jm.day?.activities });

  section("march fixture: the party moved to the mile-scale hex scene, its territory set through applyTravelForm(id, {override: {territory}})");
  const mv = await page(gm, P.jMoveTo, { partyId: party.id, fid, sceneId: hexScene.id, xy: { x: 600, y: 500 } });
  if (mv.tokenUuid) gm.track(mv.tokenUuid, "Token");
  note("moved", mv);
  check("march fixture: the token re-created on the hex scene is adopted (the record's tokenId and sceneId) and the party journeys", mv.adopted && mv.mode === "journey", mv);
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "move to the hex scene");
  note("open", strip(await page(gm, P.frameOpen, { partyId: party.id, fresh: true })));
  const tr = await page(gm, P.jTerritory, { partyId: party.id, fid, territory: "outlands" });
  note("territory", tr);
  check("march fixture: the unpainted hex scene answers no territory of its own (the Country card's source is not the map), and applyTravelForm sets the one the party truly stands in, shown as the Judge's word", tr.ok && tr.before.provenance !== "map" && tr.after.truth === "outlands" && tr.after.believed === "outlands" && tr.after.override === "outlands" && tr.after.provenance === "override", tr);
  const nd = await page(gm, P.jDrag, { fid, dx: 5 });
  trackMsgs(gm, nd.messages, "nudge");
  const hx = await page(gm, P.jHex, { fid });
  note("nudge", { ...strip(nd), hex: hx });
  check("march fixture: a 5 px nudge on the hex scene records the hex the party stands in and bills no card", nd.processed && hx.recorded && nd.cards === 0, { processed: nd.processed, hex: hx, cards: nd.cards, worldTimeDelta: nd.worldTimeDelta });
  const dv = await page(gm, P.jDrive, { partyId: party.id });
  note("drive mechanics", dv);
  check("march drive mechanics: travel.camp.present and travel.camp.target close Points of interest; End day is on the Wilderness head; search and pause are on the quick-tools rail; the mode select is in the band", same(dv.poiLastTwo, ["travel.camp.present", "travel.camp.target"]) && dv.endDayInHead && dv.toolsSearch && dv.toolsPause && dv.bandModeSelect, dv);

  section("day change step 8: an encounter throw on the hex scene with a terrain picked, under a clear sky set by hand (GM seat)");
  for (const [name, value] of [["travel.override.encounterTerrain", "grassland"], ["travel.weather.precipitation", "clear"]]) {
    const f = await page(gm, P.frameField, { partyId: party.id, fid, name, kind: "select", value, path: name });
    note(`field ${name}`, f);
    check(`step 8 fixture: ${name} takes ${value}`, f.found && f.recordOk, { found: f.found, recordOk: f.recordOk });
  }
  const en = await page(gm, P.jEncounter, { partyId: party.id, fid });
  trackMsgs(gm, en.messages, "encounter throws");
  note("encounter throws", strip(en));
  check("day change step 8: an encounter card carries its two sight lines (who saw whom), and the created message's flags[acks-extras].encounter carries the card's facts in agreement with them", !!en.card && !!en.card.partyLine && !!en.card.monstersLine && en.card.flag.formationId && en.card.flag.terrain === "grassland" && en.card.flag.found && en.card.flag.distance && en.card.flag.start && typeof en.card.flag.partySees === "boolean" && typeof en.card.flag.monstersSee === "boolean" && !!en.card.flag.light && en.card.agrees && en.card.whispered, { throws: en.throws, outcomes: en.outcomes, forced: en.forced, card: en.card ? { ...en.card, id: undefined } : null });
  if (en.card?.id) {
    const seen = await page(player, P.msgOnSeat, { id: en.card.id });
    note("the card on the player seat", seen);
    check("day change step 8 (player seat): the card is a whisper the player cannot see: its visible getter is false and no chat log on that seat draws it", !seen.visible && seen.inLog === 0, seen);
  }
  note("field travel.weather.precipitation back to rainy (chips for the player's Sky)", await page(gm, P.frameField, { partyId: party.id, fid, name: "travel.weather.precipitation", kind: "select", value: "rainy", path: "travel.weather.precipitation" }));

  section("journey step 5: Lost marked with a judge note (GM seat), a day logged while lost, then the player seat");
  const lo = await page(gm, P.jLost, { partyId: party.id, fid });
  if (lo.shadowUuid) gm.track(lo.shadowUuid, "Token");
  note("lost", lo);
  check("step 5: The episode's lostBegin asks which way the party strayed, and Chosen opens the episode with its true-position marker placed hidden", lo.dialog && !!lo.phase && !!lo.shadowUuid && lo.shadowHidden === true, lo);
  const noteText = `QA lost note ${NONCE}`;
  const ln = await page(gm, P.frameField, { partyId: party.id, fid, name: "travel.lostNote", kind: "text", value: noteText, path: "travel.lost.judgeNote" });
  check("step 5: the judge note typed in The episode lands in travel.lost.judgeNote", ln.found && ln.recordOk, { found: ln.found, recordOk: ln.recordOk });
  const off = await page(gm, P.setSetting, { mod: MOD, key: "advanceWorldTime", value: false });
  ctx.settingsToRestore.push({ seat: "gm", key: "advanceWorldTime", value: off.before });
  note("advanceWorldTime off for one End day (window opens)", off);
  const ed = await page(gm, P.frameEndDay, { partyId: party.id, fid });
  note("advanceWorldTime restored (window closes)", await page(gm, P.setSetting, { mod: MOD, key: "advanceWorldTime", value: off.before }));
  trackMsgs(gm, ed.messages, "End day while lost");
  note("End day while lost", strip(ed));
  check("step 5 fixture: End day while lost, with the module's clock writes off, logs one row and leaves the world clock where it stood", ed.after === ed.before + 1 && ed.worldTimeDelta === 0, { before: ed.before, after: ed.after, worldTimeDelta: ed.worldTimeDelta });
  const gl = await page(gm, P.jGmLost, { partyId: party.id, fid, note: noteText });
  note("GM view of the episode", gl);
  check("step 5: the GM sees the astray line in The episode section of the Judge's tab", gl.astray, gl);
  check("step 5: the GM sees the compass mark in the log rows (the row logged while lost)", gl.compassRows >= 1 && gl.compassRows === gl.logLost.filter(Boolean).length, gl);
  const pv = await page(player, P.jPlayer, { partyId: party.id, note: noteText });
  note("player view", pv);
  check("step 5 / march 10 (player seat): the strip, the Country cards (values only: no source, no chip), the camp's forecast, and the log on Sightings", pv.visible && pv.strip && pv.countryCards > 0 && pv.countryValuesOnly && pv.campForecast && pv.campNoPickers && pv.logRows >= 1, { level: pv.level, sections: pv.sections, countryCards: pv.countryCards, countryValuesOnly: pv.countryValuesOnly, campForecast: pv.campForecast, campNoPickers: pv.campNoPickers, logRows: pv.logRows, ctxSky: pv.ctxSky });
  check("step 5 / march 10 (player seat): no pickers, no day board, no lost mark, no note, no Judge tab", pv.pickers.length === 0 && !pv.dayBoard && !pv.lostMark && !pv.noteShown && !pv.judgeTab && !pv.judgePart, { pickers: pv.pickers, dayBoard: pv.dayBoard, lostMark: pv.lostMark, noteShown: pv.noteShown, judgeTab: pv.judgeTab, judgePart: pv.judgePart });
  check("march 10 (player seat): the Sky section shows (it has chips under the rain) and holds no control", !!pv.sky && (pv.sky.chips > 0 || pv.sky.night) && pv.sky.controls === 0, pv.sky);

  section("frame step 6 re-check: each tab's part root, the select that overflows at 18, the scroll across a field change (GM seat, journey on the hex scene)");
  ctx.settingsToRestore.push({ seat: "gm", key: "fontScale", value: 14 });
  note("fontScale 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  await page(gm, P.calm);
  const sel14 = await page(gm, P.f6Selects, { partyId: party.id });
  note("fontScale 18", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 }));
  await page(gm, P.frameOpen, { partyId: party.id, fresh: true });
  await page(gm, P.calm);
  const sel18 = await page(gm, P.f6Selects, { partyId: party.id });
  const ps = await page(gm, P.f6PartScroll, { partyId: party.id });
  note("part roots at 18, each with its tab active", ps);
  const sk = (s) => `${s.tab}|${s.section ?? "-"}|${s.name}`;
  const over14 = sel14.filter((s) => s.over);
  const gained = sel18.filter((s) => s.over && !sel14.find((t) => sk(t) === sk(s))?.over);
  note("selects overflowing at 14", over14);
  note("selects overflowing at 18 that did not at 14 (with their 14 metrics)", gained.map((s) => ({ at18: s, at14: sel14.find((t) => sk(t) === sk(s)) ?? null })));
  check("frame step 6 re-check: with its tab active, every part root scrolls (overflow-y auto or scroll)", Object.values(ps).every((v) => v.active && /auto|scroll/.test(v.overflowY ?? "")), ps);
  check("frame step 6 re-check: no select gains at 18 a vertical overflow it lacked at 14", gained.length === 0, gained.map(sk));
  const sc = await page(gm, P.f6Scroll, { partyId: party.id });
  note("scroll across a field change at 18", sc);
  check("frame step 6 re-check: across a field change in the 520-high Wilderness tab, the content in view stays put (the anchor block's offset within 2 px)", sc.anchorHeld || !sc.stillOverflows, sc);
  note("fontScale back to 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "journey, all");
}

/* ------------------------------------------------------------------ */
/*  The day change                                                      */
/* ------------------------------------------------------------------ */

async function daychange(gm, player, census) {
  section("day change: fixtures (three party actors: two journeying with the generator on in one climate, one left in delve; a player-owned member on the first)");
  const playerId = census.player.userId;
  await page(gm, P.claimNonce, { nonce: NONCE });
  await page(player, P.claimNonce, { nonce: NONCE });
  const t0 = await page(gm, P.now);
  const cal = census.gm.calendar;
  const DAY = cal.hoursPerDay * cal.minutesPerHour * cal.secondsPerMinute;
  const pa = await gm.create("Actor", { name: `QA Sky Party A ${NONCE}`, type: "acks-extras.party" });
  const pb = await gm.create("Actor", { name: `QA Sky Party B ${NONCE}`, type: "acks-extras.party" });
  const pc = await gm.create("Actor", { name: `QA Sky Party C ${NONCE}`, type: "acks-extras.party" });
  const walker = await gm.create("Actor", { name: `QA Sky Walker ${NONCE}`, type: "character", system: { hp: { value: 6, max: 6 } }, items: [], ownership: { default: 0, [playerId]: 3 } });
  const enr = await page(gm, P.enrolDrop, { partyId: pa.id, memberIds: [walker.id] });
  note("member enrolled on A", enr);
  const fx = await page(gm, P.dcFixtures, { ids: { A: pa.id, B: pb.id, C: pc.id } });
  note("formations", fx);
  if (fx.error || !fx.climate) throw new Error(fx.error ?? "no climate the imported weather document prices in two seasons");
  const fids = fx.fids;
  const C = fx.climate;
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (GM seat)", await page(gm, P.framePanelFlagClear, { partyId: pa.id })));
  ctx.afterTeardown.push(async () => note("partyPanel key cleared (player seat)", await page(player, P.framePanelFlagClear, { partyId: pa.id })));
  note("open A", strip(await page(gm, P.frameOpen, { partyId: pa.id, fresh: true })));
  const ja = await page(gm, P.jMode, { partyId: pa.id, fid: fids.A, mode: "journey" });
  const fc = await page(gm, P.frameField, { partyId: pa.id, fid: fids.A, name: "travel.override.climate", kind: "select", value: C, path: "travel.override.climate" });
  const fa = await page(gm, P.frameField, { partyId: pa.id, fid: fids.A, name: "travel.weather.auto", kind: "check", path: "travel.weather.auto" });
  const ra = await page(gm, P.dcRoll, { partyId: pa.id, fid: fids.A, climate: C });
  const sb = await page(gm, P.dcApiSetup, { fid: fids.B, climate: C });
  note("A through the sheet", { mode: ja.mode, climate: fc.recordOk, auto: { want: fa.want, recordOk: fa.recordOk }, roll: ra });
  note("B through the API", sb);
  check("day change fixtures: A (through its sheet) and B (through the API) journey in one climate with the generator on, the third stays in delve, member enrolled on A", fx.ready && enr.enrolled.every(Boolean) && ja.ok && fc.recordOk && fa.want === true && fa.recordOk && sb.mode === "journey" && sb.climate === C && sb.auto, { ready: fx.ready, enrolled: enr.enrolled, a: { mode: ja.mode, climate: fc.recordOk, auto: fa.recordOk }, b: sb });
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "fixtures");
  const S0 = await page(gm, P.dcState, { fids, climate: C });
  note("baseline", S0);
  check("day change baseline: A and B read the same sky today (one cache key, identical rolls), and the delve control is in delve", canon(S0.per.A.rolls) === canon(S0.per.B.rolls) && S0.per.A.rolls != null && S0.per.C.mode === "delve", { A: S0.per.A.bands, B: S0.per.B.bands, mine: S0.mine });

  section("day change step 1: a minute from the GM seat stamps each formation");
  const a1 = await page(gm, P.dcAdvance, { seconds: 60, fids, climate: C });
  const S1 = await page(gm, P.dcState, { fids, climate: C });
  note("after a minute", { moved: a1.moved, writes: a1.writes, day: S1.day, settled: Object.fromEntries(Object.entries(S1.per).map(([k, v]) => [k, v.settledDay])) });
  check("step 1: settledDay equals the calendar day on every formation; the footings' runs and the cache have not moved", S1.day === S0.day && ["A", "B", "C"].every((k) => S1.per[k].settledDay === S1.day && canon(S1.per[k].footing) === canon(S0.per[k].footing)) && same(S1.mine, S0.mine), { day: S1.day, settled: Object.fromEntries(Object.entries(S1.per).map(([k, v]) => [k, v.settledDay])), mine: S1.mine });

  section("day change step 2: one calendar day in one call");
  const d0 = S1.day;
  const a2 = await page(gm, P.dcAdvance, { seconds: DAY, fids, climate: C, wantDay: d0 + 1 });
  const S2 = await page(gm, P.dcState, { fids, climate: C });
  note("after a day", { moved: a2.moved, settled: a2.settled, writes: a2.writes, day: S2.day, mine: S2.mine, A: S2.per.A, C: S2.per.C });
  const season = S2.per.A.season;
  const xA2 = await page(gm, P.dcExpect, { fid: fids.A, from: S1.per.A.footing, bands0: S1.per.A.bands, days: [d0 + 1], climate: C, season });
  const xB2 = await page(gm, P.dcExpect, { fid: fids.B, from: S1.per.B.footing, bands0: S1.per.B.bands, days: [d0 + 1], climate: C, season });
  const moved = (a, b) => Object.keys(b?.runs ?? {}).some((k) => (Number(b.runs[k]) || 0) === (Number(a?.runs?.[k]) || 0) + 1);
  const added2 = S2.mine.filter((k) => !S1.mine.includes(k));
  check("step 2: both journeying formations hold an identical travel.weather.rolls", canon(S2.per.A.rolls) === canon(S2.per.B.rolls) && canon(S2.per.A.rolls) !== canon(S1.per.A.rolls), { A: S2.per.A.rolls, B: S2.per.B.rolls });
  check("step 2: each footing moved by one day for the finished day's bands (runs as the settling rule gives them), and the new day's sky is the cached one", xA2.footingMatch && xB2.footingMatch && xA2.bandsMatch && xB2.bandsMatch && xA2.rollsMatch && xB2.rollsMatch && xA2.found.every(Boolean), { A: { before: S1.per.A.footing?.runs, after: S2.per.A.footing?.runs, x: xA2, anyRunUpByOne: moved(S1.per.A.footing, S2.per.A.footing) }, B: { x: xB2 } });
  check("step 2: settledDay is the new calendar day on all three", S2.day === d0 + 1 && ["A", "B", "C"].every((k) => S2.per[k].settledDay === d0 + 1), { day: S2.day, settled: Object.fromEntries(Object.entries(S2.per).map(([k, v]) => [k, v.settledDay])) });
  check("step 2: the cache gained exactly one key for the climate, its day part the calendar day", same(added2, [`${d0 + 1}|${C}|${season}`]), { added: added2, totalBefore: S1.cacheTotal, totalAfter: S2.cacheTotal });
  check("step 2: the delve control is stamped, its footing and sky untouched", canon(S2.per.C.footing) === canon(S1.per.C.footing) && canon(S2.per.C.bands) === canon(S1.per.C.bands) && canon(S2.per.C.rolls) === canon(S1.per.C.rolls), { footing: [S1.per.C.footing, S2.per.C.footing], bands: [S1.per.C.bands, S2.per.C.bands] });

  section("day change step 3: a minute again, then three days in one call");
  const a3 = await page(gm, P.dcAdvance, { seconds: 60, fids, climate: C });
  const S3 = await page(gm, P.dcState, { fids, climate: C });
  note("after a minute", { moved: a3.moved, writes: a3.writes, day: S3.day });
  check("step 3: a minute changes nothing (settled days, footings, rolls, cache)", S3.day === S2.day && ["A", "B", "C"].every((k) => S3.per[k].settledDay === S2.per[k].settledDay && canon(S3.per[k].footing) === canon(S2.per[k].footing) && canon(S3.per[k].rolls) === canon(S2.per[k].rolls)) && same(S3.mine, S2.mine), { day: S3.day, mine: S3.mine });
  const a4 = await page(gm, P.dcAdvance, { seconds: 3 * DAY, fids, climate: C, wantDay: S3.day + 3 });
  const S4 = await page(gm, P.dcState, { fids, climate: C });
  const days3 = [S3.day + 1, S3.day + 2, S3.day + 3];
  const xA4 = await page(gm, P.dcExpect, { fid: fids.A, from: S3.per.A.footing, bands0: S3.per.A.bands, days: days3, climate: C, season });
  const xB4 = await page(gm, P.dcExpect, { fid: fids.B, from: S3.per.B.footing, bands0: S3.per.B.bands, days: days3, climate: C, season });
  const added4 = S4.mine.filter((k) => !S3.mine.includes(k));
  let prev = S3.mine;
  const writesAdding = [];
  for (const w of a4.writes) {
    if (!w) continue;
    const add = w.mine.filter((k) => !prev.includes(k));
    if (add.length) writesAdding.push(add);
    prev = w.mine;
  }
  note("after three days", { moved: a4.moved, settled: a4.settled, day: S4.day, added: added4, writes: a4.writes.length, writesAdding, A: S4.per.A });
  check("step 3: runs moved by three days (the footing is the settling rule applied to each finished day in turn)", xA4.footingMatch && xB4.footingMatch && xA4.bandsMatch && xA4.rollsMatch && S4.per.A.settledDay === S3.day + 3, { A: xA4, B: xB4, settled: S4.per.A.settledDay });
  check("step 3: three new keys for the climate, one per crossed day", same(added4.slice().sort(), days3.map((d) => `${d}|${C}|${season}`).sort()), { added: added4 });
  check("step 3: the cache setting written once for the step (one write added all three keys)", writesAdding.length === 1 && writesAdding[0].length === 3, { writesAdding, writesInWindow: a4.writes.length });
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "advances");

  section("day change step 4: End day with Advance the world clock on");
  note("open A", strip(await page(gm, P.frameOpen, { partyId: pa.id, fresh: true })));
  const e4 = await page(gm, P.dcEndDay, { partyId: pa.id, fid: fids.A, climate: C });
  trackMsgs(gm, e4.messages, "End day (clock on)");
  note("End day, clock on", strip(e4));
  const crossed = e4.day1 > e4.day0;
  check("step 4: a new log row, and the clock at the next dawn", e4.may === true && e4.logAdded === 1 && e4.moved === e4.jump && e4.atDawn, { may: e4.may, logAdded: e4.logAdded, jump: e4.jump, moved: e4.moved, atDawn: e4.atDawn });
  check("step 4: travel.dayCount went up by one; a jump across midnight settles one new sky by the day change, keyed on the calendar day and not on dayCount", e4.dayCount1 === e4.dayCount0 + 1 && (crossed ? same(e4.added, [`${e4.day1}|${C}|${season}`]) && (e4.dayCount1 === e4.day1 || !e4.added[0].startsWith(`${e4.dayCount1}|`)) : e4.added.length === 0), { crossed, day0: e4.day0, day1: e4.day1, added: e4.added, dayCount: [e4.dayCount0, e4.dayCount1] });

  section("day change step 5: End day with Advance the world clock off (then restored)");
  const off = await page(gm, P.setSetting, { mod: MOD, key: "advanceWorldTime", value: false });
  ctx.settingsToRestore.push({ seat: "gm", key: "advanceWorldTime", value: off.before });
  const e5 = await page(gm, P.dcEndDay, { partyId: pa.id, fid: fids.A, climate: C });
  note("advanceWorldTime restored", await page(gm, P.setSetting, { mod: MOD, key: "advanceWorldTime", value: off.before }));
  trackMsgs(gm, e5.messages, "End day (clock off)");
  note("End day, clock off", strip(e5));
  check("step 5: a log row, the clock not moved, and the same sky, footing and cache", e5.may === false && e5.logAdded === 1 && e5.moved === 0 && e5.skySame && e5.added.length === 0, { may: e5.may, logAdded: e5.logAdded, moved: e5.moved, skySame: e5.skySame, added: e5.added });

  section("day change step 6: the season from the calendar (the Calendar seasons setting set to a deliberately rotated map, then blanked)");
  const se0 = await page(gm, P.dcSeason, { partyId: pa.id });
  note("season, setting as found", se0);
  const MAP = "summer,fall,winter,spring";
  const sm = await page(gm, P.setSetting, { mod: MOD, key: "calendarSeasons", value: MAP });
  ctx.settingsToRestore.push({ seat: "gm", key: "calendarSeasons", value: sm.before });
  const se1 = await page(gm, P.dcSeason, { partyId: pa.id });
  note("season under the map", se1);
  check("step 6: under the map the Sky's season select reads the mapped season, is disabled, and the hint names the calendar's season", se1.found && !!se1.mapWants && se1.value === se1.mapWants && se1.disabled && se1.hint && se1.hintNamesCalendar, se1);
  const rs = await page(gm, P.dcRoll, { partyId: pa.id, fid: fids.A, climate: C });
  note("Roll weather under the map", rs);
  check("step 6: the next cache key carries that season", rs.found && rs.added.length === 1 && rs.added[0].endsWith(`|${C}|${se1.mapWants}`), rs);
  note("calendarSeasons restored", await page(gm, P.setSetting, { mod: MOD, key: "calendarSeasons", value: sm.before }));
  const se2 = await page(gm, P.dcSeason, { partyId: pa.id });
  note("season, setting restored", se2);
  check("step 6: blanked, a calendar whose seasons carry recognised names still names the season (select disabled, reading the calendar's season by name)", se2.found && se2.disabled && !!se2.calendar && se2.value === se2.calendar.name.toLowerCase(), se2);
  const pure = await page(gm, P.dcSeasonPure);
  note("season keys for names nobody recognises (pure function)", pure);
  check("step 6 (offline, pure function): names nobody recognises map to no season unless the calendar counts four", pure.unnamedThree === null && typeof pure.unnamedFour === "string", pure);

  section("day change step 7: the player seat's party sheet");
  let pv = await page(player, P.jPlayer, { partyId: pa.id });
  note("player view", pv);
  if (!pv.sky && pv.ctxSky && !pv.ctxSky.skyShown && !pv.ctxSky.chips && !pv.ctxSky.night) {
    check("step 7 (as found): the player's Sky section is withheld because today's sky has no chip and no night band to tell", true, pv.ctxSky);
    note("rain set by hand on the GM seat, for a chip the player is told", await page(gm, P.frameField, { partyId: pa.id, fid: fids.A, name: "travel.weather.precipitation", kind: "select", value: "rainy", path: "travel.weather.precipitation" }));
    pv = await page(player, P.jPlayer, { partyId: pa.id });
    note("player view, rain set", pv);
  }
  check("step 7: the sky shows on the player seat, with no controls", pv.visible && !!pv.sky && (pv.sky.chips > 0 || pv.sky.night) && pv.sky.controls === 0, { level: pv.level, sky: pv.sky, ctxSky: pv.ctxSky, sections: pv.sections });
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "day change, all");
  ctx.afterTeardown.push(async () => note("day change teardown reload (player seat)", await page(player, P.reloadTables)));

  section("journey step 2 again: the readout on the player seat for a party whose every member that seat owns (A, after the day change steps)");
  const sp0 = { gm: await page(gm, P.jSpeed, { partyId: pa.id, fid: fids.A }), player: await page(player, P.jSpeed, { partyId: pa.id, fid: fids.A }) };
  note("pace, every member owned by the player seat", sp0);
  // The day change steps' days leave a member on a rung that bars a forced
  // march, so the forced pick below would wait on the Judge's confirm. The bar
  // is formation-steps' Steps 14; this pass reads the forced pace.
  const mb = await page(gm, P.clearMarchBar, { fid: fids.A });
  check("step 2 again: no marcher of A bars a forced march once each barred member's survival flag is removed", mb.clear, mb);
  for (const [name, value] of [["travel.override.ground", "hills"], ["travel.override.road", "earth"], ["travel.weather.precipitation", "rainy"], ["travel.day.kind", "forced"]]) {
    const f = await page(gm, P.frameField, { partyId: pa.id, fid: fids.A, name, kind: "select", value, path: name });
    check(`step 2 again: ${name} takes ${value}`, f.found && f.recordOk, { found: f.found, recordOk: f.recordOk, shown: f.shown });
  }
  const qNone = await page(player, P.jReadout, { partyId: pa.id, fid: fids.A, phase: "none" });
  note("readout, no travel document", qNone);
  check("step 2 again (no tables): tablesMissing, no terrain or road priced, the multiplier the conditions' alone, and the miles the FORCED pace's of a non-zero party speed (they differ from the dedicated pace's)", qNone.stripFound && qNone.tablesMissingPart && qNone.lineHasMissing && qNone.terrainParts === 0 && qNone.roadParts === 0 && qNone.byPaceAndConditionsAlone && qNone.readoutForced && qNone.stripMilesIsForced && qNone.forcedDiffersFromDedicated, { parts: qNone.parts, byPaceAndConditionsAlone: qNone.byPaceAndConditionsAlone, readoutForced: qNone.readoutForced, stripMilesIsForced: qNone.stripMilesIsForced, forcedDiffersFromDedicated: qNone.forcedDiffersFromDedicated });
  const qInv = await page(player, P.jReadout, { partyId: pa.id, fid: fids.A, phase: "invented" });
  note("readout, invented rows", qInv);
  const qk = qInv.parts?.map((p) => p.key) ?? [];
  check("step 2 again (invented rows): terrain then the washed-out road on the tooltip line; the multiplier x0.37 of the no-tables one; the miles the forced pace's (differing from the dedicated pace's)", qk[0] === "terrain.hills" && qk[1] === "road.washedOut" && !qInv.tablesMissingPart && qInv.ratioToNone === 0.37 && qInv.readoutForced && qInv.stripMilesIsForced && qInv.forcedDiffersFromDedicated && qInv.lineTerrainThenWashedOut, { parts: qInv.parts, ratioToNone: qInv.ratioToNone, forcedDiffersFromDedicated: qInv.forcedDiffersFromDedicated, lineEntries: qInv.lineEntries });
  const qBack = await page(player, P.jReadout, { partyId: pa.id, fid: fids.A, phase: "restore" });
  note("readout teardown", qBack);
  check("step 2 again teardown: the world's travel document back on the player seat", qBack.hasTravel === qNone.before?.hasTravel && qBack.layer20Keys === qNone.before?.layer20Keys && !qBack.liveCheck && !qBack.invented && qBack.override === qNone.before?.override, { qBack, before: qNone.before });

  section("finding probe: the party's pace on each seat once a member the player seat does not own joins A");
  const porter = await gm.create("Actor", { name: `QA Sky Porter ${NONCE}`, type: "character", system: { hp: { value: 6, max: 6 } }, items: [] });
  note("porter enrolled on A", await page(gm, P.enrolDrop, { partyId: pa.id, memberIds: [porter.id] }));
  const sp1 = { gm: await page(gm, P.jSpeed, { partyId: pa.id, fid: fids.A }), player: await page(player, P.jSpeed, { partyId: pa.id, fid: fids.A }) };
  note("pace, one member not owned by the player seat", sp1);
  check("finding probe (before): with every member owned by the player seat, both seats price a non-zero pace", !sp0.gm.partySpeedZero && !sp0.player.partySpeedZero && !sp0.player.stripMilesZero, sp0);
  check("finding probe (after): with a member the player seat does not own, the GM seat's strip prices a non-zero pace", !sp1.gm.partySpeedZero && !sp1.gm.stripMilesZero, sp1.gm);
  gapCheck("finding probe (after): with a member the player seat does not own, the player seat's strip prices a non-zero pace, as the GM seat's does", UNOWNED_PACE, !sp1.player.partySpeedZero && !sp1.player.stripMilesZero, (sp1.player.members ?? []).some((m) => !m.owner && m.speedZero), sp1.player);

  section("frame step 6, third read: the Wilderness scroll across a field change, with the window and part boxes (GM seat, A)");
  ctx.settingsToRestore.push({ seat: "gm", key: "fontScale", value: 14 });
  note("fontScale 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  await page(gm, P.frameOpen, { partyId: pa.id, fresh: true });
  await page(gm, P.calm);
  const diag = async (label) => {
    const sel = '[data-application-part="mode"] [data-section="sky"] select[name="travel.weather.temperature"]';
    try {
      await gm.eval(`(() => { document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "center" }); return true; })()`);
      await sleep(400);
      const r = await gm.shot(path.join(logDir(), `diag-select-${label}.png`), sel);
      note(`diagnostic shot select at ${label}`, { bytes: r.bytes, clip: r.clip });
    } catch (err) { note(`diagnostic shot ${label} FAILED`, err?.message ?? String(err)); }
  };
  const s14 = await page(gm, P.f6Selects, { partyId: pa.id });
  await diag("14");
  note("fontScale 18", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 }));
  await page(gm, P.frameOpen, { partyId: pa.id, fresh: true });
  await page(gm, P.calm);
  const s18 = await page(gm, P.f6Selects, { partyId: pa.id });
  await diag("18");
  const one = (list) => list.find((s) => s.name === "travel.weather.temperature") ?? null;
  note("the temperature select at 14 and at 18", { at14: one(s14), at18: one(s18) });
  const sc = await page(gm, P.f6Scroll, { partyId: pa.id, field: "travel.weather.wind" });
  note("scroll across a field change at 18", sc);
  check("frame step 6, third read: across a field change the Wilderness tab's content in view stays put, or the scroll is clamped only because the re-fitted window left less to scroll", sc.anchorHeld || sc.clampedToMax || !sc.stillOverflows, sc);
  note("fontScale back to 14", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 14 }));
  trackMsgs(gm, await page(gm, P.messages, { t0 }), "day change, extras");
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

try {
  section("seats");
  note("plan", { sections: [...RUN], shots: SHOTS, retrack: (PLAN.retrack ?? []).length, nonce: NONCE });
  const gm = await seat("gm");
  const player = await seat("player");
  const census = { gm: await page(gm, P.census, MOD), player: await page(player, P.census, MOD) };
  note("gm census", (({ userId, ...shown }) => shown)(census.gm));
  note("player census", { role: census.player.role, activeRoles: census.player.activeRoles, fontScale: census.player.settings.fontScale, partyPanelKeys: census.player.partyPanelKeys, module: census.player.module });
  ctx.worldTime0 = census.gm.worldTime;
  ctx.census = census;
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.gm.role === 4 && census.player.role === 1, { gmRole: census.gm.role, playerRole: census.player.role, activeRoles: census.gm.activeRoles });
  if (!census.gm.activeGMIsSelf) throw new Error("another GM client is the active GM; the automation would run there");
  for (const e of PLAN.retrack ?? []) gm.track(e.uuid, e.kind);

  if (RUN.has("probe")) await probe(gm, player, census);
  if (RUN.has("shot-importer")) await shotImporter(gm);
  if (RUN.has("delve")) await delve(gm, player, census);
  if (RUN.has("swim")) await swim(gm, player, census);
  if (RUN.has("frame")) await frame(gm, player, census);
  const guarded = async (name, fn) => { try { await fn(); } catch (err) { console.error(`SECTION ${name} FAILED:`, err?.stack ?? err); check(`${name}: the section ran to its end`, false, String(err?.message ?? err)); } };
  if (RUN.has("journey")) await guarded("journey", () => journey(gm, player, census));
  if (RUN.has("daychange")) await guarded("daychange", () => daychange(gm, player, census));
} catch (err) {
  console.error("WALK FAILED:", err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = seats.gm;
  for (const fn of ctx.afterTeardown) { try { await fn(); } catch (err) { console.error("afterTeardown:", err?.message ?? err); } }
  try { if (gm) note("closed windows", { gm: await page(gm, P.closeAll), player: seats.player ? await page(seats.player, P.closeAll) : 0 }); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  for (const s of ctx.settingsToRestore.reverse()) {
    try { note(`restored ${s.key}`, await page(seats[s.seat], P.setSetting, { mod: MOD, key: s.key, value: s.value })); } catch (err) { console.error(`restore ${s.key}:`, err?.message ?? err); }
  }
  for (const [key, api] of Object.entries(seats)) {
    try { note(`${key} recorder`, await page(api, P.recorder)); } catch (err) { console.error("recorder:", err?.message ?? err); }
    try { note(`${key} seat restored`, await page(api, P.restoreSeat)); } catch (err) { console.error("restoreSeat:", err?.message ?? err); }
  }
  try { if (gm) note("sweep", await gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm && ctx.worldTime0 != null) note("worldTime delta (s)", (await page(gm, P.census, MOD)).worldTime - ctx.worldTime0); } catch (err) { console.error("worldTime:", err?.message ?? err); }
  console.log("\n== summary ==");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const [label, row] of gaps) console.log(`GAP   ${label} (ROADMAP: ${row})`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed${gaps.length ? `, ${gaps.length} gap(s) a ROADMAP row names` : ""}`);
  if (failed) process.exitCode = 1;
  for (const api of Object.values(seats)) { try { api.close(); } catch (_e) { /* closed */ } }
}
