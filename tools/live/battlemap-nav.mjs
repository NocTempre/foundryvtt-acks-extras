/**
 * Live walk: docs/battlemap/TESTING.md, "The navigation card's system icon"
 * 1-7. The GM seat is the active GM and drives the icon; the player seat
 * reads its own navigation.
 *
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world or a seat. Every fixture and name is invented; no imported table is
 * printed.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the square
 * scenes `battlemap/scene-nav-map` (the map the party stands on, in the
 * navigation and readable by a player) and `battlemap/scene-nav-other` (the
 * one the GM views while picking on the map's card), the party
 * `battlemap/scene-nav-party`, and its token on the map,
 * `battlemap/scene-nav-party-token`, found on the map by its marker or
 * placed carrying it. Each step brings what it reads to shape at its start:
 * the map's declaration cleared, the party on a journey, the GM on the other
 * scene with the navigation expanded, no picker open. No chat card is posted:
 * an adoption announces itself as a toast, which the walk records.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - the GM seat's client state: the notification patch, the expanded
 *     navigation, the setup panel (closed), the viewed scene (left where the
 *     walk ends; a kept scene).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MOD = "acks-extras";
const CELL = 100;
/** A kept marker, spelled as the driver spells it: suffixed with the session's own tag where it builds its own. */
const markerOf = (marker) => (MACHINE.own ? `${marker}@${MACHINE.own}` : marker);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side (stringified and run in the seat's page)                  */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeRoles: game.users.filter((u) => u.active).map((u) => u.role).sort(),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
  }),

  /** Helpers every other page function reaches through `globalThis.__rn`. */
  install: async () => {
    const H = (globalThis.__rn = globalThis.__rn ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 25, every = 100 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    H.B = acksExtras.battlemap;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      nav: await import(base + "battlemap/scene-nav.mjs"),
      session: await import(base + "battlemap/session.mjs"),
      model: await import(base + "formation/formation-model.mjs"),
    };
    H.formation = (id) => (typeof H.m.model.getFormation === "function" ? H.m.model.getFormation(id) : null) ?? H.F.getFormations()[id] ?? null;
    H.card = (sceneId) => document.querySelector(`#scene-navigation .scene[data-scene-id="${sceneId}"]:not([data-level-id])`);
    H.icon = (sceneId) => H.card(sceneId)?.querySelector(`.${H.m.nav.SCENE_SYSTEM_CLASS}`) ?? null;
    H.readIcon = (sceneId) => {
      const el = H.icon(sceneId);
      if (!el) return null;
      return {
        tag: el.tagName, type: el.getAttribute("type"), action: el.dataset.action, system: el.dataset.system, tooltip: el.dataset.tooltip,
        label: el.getAttribute("aria-label"), haspopup: el.getAttribute("aria-haspopup"), title: el.getAttribute("title"), glyph: el.querySelector("i")?.className ?? null,
        visible: el.checkVisibility(), inCard: el.closest(".scene")?.dataset.sceneId ?? null,
      };
    };
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
    if (!H.recorder) {
      H.errors = [];
      const scrub = (x) => String(x).split(location.origin).join("<origin>").slice(0, 600);
      H.origConsoleError = console.error;
      console.error = function (...args) {
        try { H.errors.push({ at: Date.now(), text: scrub(args.map((a) => a?.stack ?? (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ")) }); } catch (_e) { /* the recorder never throws */ }
        return H.origConsoleError.apply(this, args);
      };
      H.onError = (ev) => H.errors.push({ at: Date.now(), text: scrub(`window error: ${ev?.error?.stack ?? ev?.message ?? ev}`) });
      H.onRejection = (ev) => H.errors.push({ at: Date.now(), text: scrub(`unhandled rejection: ${ev?.reason?.stack ?? ev?.reason ?? ev}`) });
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
      H.recorder = Date.now();
    }
    return { installed: true, navClass: H.m.nav.SCENE_SYSTEM_CLASS, glyphs: H.m.nav.SYSTEM_GLYPHS };
  },

  /** The seat runs the working tree: the icon module and the writer this change added are loadable. */
  fresh: async () => {
    const H = globalThis.__rn;
    const setup = await import("/modules/acks-extras/scripts/battlemap/scene-setup.mjs");
    return { nav: typeof H.m.nav.installSceneNavigation === "function", writer: typeof setup.writeSceneSystem === "function", apiVersion: H.F.apiVersion ?? null };
  },

  /** The party's formation record, once the create hook has made it. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__rn;
    const f = await H.poll(() => Object.values(H.F.getFormations()).find((x) => x.actorId === partyId), { tries: 60, every: 200 });
    return f ? { fid: f.id, name: f.name, tokenId: f.tokenId ?? null, sceneId: f.sceneId ?? null, mode: H.T.travelOf(f).mode } : null;
  },

  /** The party's token on the map, found by its marker or placed carrying it; adopted as the party token. */
  placeParty: async ({ partyId, sceneId, fid, marker, cell }) => {
    const H = globalThis.__rn;
    const party = game.actors.get(partyId);
    const scene = game.scenes.get(sceneId);
    let token = scene.tokens.find((t) => t.flags?.world?.fixture === marker) ?? null;
    let built = false;
    if (!token) {
      const td = await party.getTokenDocument({ x: 5 * cell, y: 5 * cell });
      const data = td.toObject();
      data.flags = { ...data.flags, world: { ...data.flags?.world, fixture: marker } };
      [token] = await scene.createEmbeddedDocuments("Token", [data]);
      built = true;
    }
    const adopted = await H.poll(() => { const r = H.F.getFormations()[fid]; return r?.tokenId === token.id && r?.sceneId === sceneId; }, { tries: 75, every: 200 });
    return { uuid: token.uuid, id: token.id, built, adopted: !!adopted };
  },

  /** The map cleared, the party on a journey, the GM on the other scene with the navigation expanded and no picker open. */
  shape: async ({ mapId, otherId, fid, mode }) => {
    const H = globalThis.__rn;
    const map = game.scenes.get(mapId);
    try { ui.context?.close({ animate: false }); } catch (_e) { /* closed */ }
    const panel = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    if (panel) { try { await panel.close({ animate: false }); } catch (_e) { /* closed */ } }
    if (H.B.sceneTravelSystem(map) !== null) await H.B.country.writeSceneSetup(map, { mapSystem: null });
    await H.T.setJourneyMode(fid, mode, { sceneId: mapId });
    if (canvas.scene?.id !== otherId) {
      await game.scenes.get(otherId).view();
      await H.poll(() => canvas.ready && canvas.scene?.id === otherId, { tries: 100, every: 200 });
      await H.sleep(1500);
    }
    if (!ui.nav.expanded) ui.nav.expand();
    await H.sleep(300);
    H.takeNotes();
    return { declared: H.B.sceneTravelSystem(map), mode: H.T.travelOf(H.formation(fid)).mode, viewing: canvas.scene?.id ?? null, expanded: ui.nav.expanded, pickerOpen: !!ui.context };
  },

  /** What the navigation shows: the map's icon, how many cards carry one, and whether any card carries two. */
  nav: async ({ mapId, delay = 0 }) => {
    const H = globalThis.__rn;
    if (delay) await H.sleep(delay);
    const cards = [...document.querySelectorAll("#scene-navigation .scene[data-scene-id]:not([data-level-id])")];
    const counts = cards.map((c) => c.querySelectorAll(`.${H.m.nav.SCENE_SYSTEM_CLASS}`).length);
    const levels = [...document.querySelectorAll("#scene-navigation .scene-level")];
    const expected = { none: game.i18n.format("ACKS-BATTLEMAP.nav.face", { system: game.i18n.localize("ACKS-BATTLEMAP.nav.none") }) };
    for (const m of ["delve", "journey", "settlement"]) expected[m] = game.i18n.format("ACKS-BATTLEMAP.nav.face", { system: game.i18n.localize(`ACKS-BATTLEMAP.system.${m}`) });
    return {
      cards: cards.length, withOne: counts.filter((n) => n === 1).length, withMore: counts.filter((n) => n > 1).length,
      levelsWithIcon: levels.filter((l) => l.querySelector(`.${H.m.nav.SCENE_SYSTEM_CLASS}`)).length,
      map: H.readIcon(mapId), expected, declared: H.B.sceneTravelSystem(game.scenes.get(mapId)), viewing: canvas.scene?.id ?? null,
    };
  },

  /** Click the map's icon as a pointer would, and read the picker that opens. */
  openPicker: async ({ mapId }) => {
    const H = globalThis.__rn;
    const icon = H.icon(mapId);
    if (!icon) return { error: "no icon on the map's card" };
    const r = icon.getBoundingClientRect();
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 }));
    const menu = await H.poll(() => document.querySelector("#context-menu"), { tries: 30, every: 100 });
    const items = menu ? [...menu.querySelectorAll(".context-item")].map((li) => ({ text: li.querySelector("span")?.textContent ?? "", current: li.classList.contains(`${H.m.nav.SCENE_SYSTEM_CLASS}-current`), glyph: li.querySelector("i")?.className ?? null })) : null;
    return { opened: !!menu, items, viewing: canvas.scene?.id ?? null, contextIsOurs: !!ui.context && ui.context?.eventName === "click" };
  },

  /** Press the picker's entry with this label, as a pointer would, and wait for the flag and the icon to say so. */
  pick: async ({ mapId, label, fid, wantSystem }) => {
    const H = globalThis.__rn;
    const menu = document.querySelector("#context-menu");
    const item = menu ? [...menu.querySelectorAll(".context-item")].find((li) => (li.querySelector("span")?.textContent ?? "") === label) : null;
    if (!item) return { error: `no entry labelled ${label}` };
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    const map = game.scenes.get(mapId);
    const declared = await H.poll(() => H.B.sceneTravelSystem(map) === wantSystem, { tries: 50, every: 100 });
    const iconSays = await H.poll(() => H.icon(mapId)?.dataset.system === (wantSystem ?? "none"), { tries: 50, every: 100 });
    const mode = fid ? await H.poll(() => (H.T.travelOf(H.formation(fid)).mode === wantSystem ? wantSystem : null), { tries: 50, every: 200 }) : null;
    await H.sleep(800);
    const closed = await H.poll(() => !document.querySelector("#context-menu"), { tries: 20, every: 100 });
    return { declared: !!declared, iconSays: !!iconSays, mode: fid ? H.T.travelOf(H.formation(fid)).mode : null, adoptedInTime: !!mode, closed: !!closed, viewing: canvas.scene?.id ?? null, notes: H.takeNotes() };
  },

  /** Right-click the map's icon as a pointer would: the declaration goes, and no menu of either kind opens. */
  clear: async ({ mapId, fid }) => {
    const H = globalThis.__rn;
    const icon = H.icon(mapId);
    if (!icon) return { error: "no icon on the map's card" };
    const r = icon.getBoundingClientRect();
    icon.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2 }));
    const map = game.scenes.get(mapId);
    const cleared = await H.poll(() => H.B.sceneTravelSystem(map) === null, { tries: 50, every: 100 });
    const iconSays = await H.poll(() => H.icon(mapId)?.dataset.system === "none", { tries: 50, every: 100 });
    await H.sleep(1500);
    return { cleared: !!cleared, iconSays: !!iconSays, menuOpen: !!document.querySelector("#context-menu"), context: ui.context ? (ui.context.eventName ?? "?") : null, mode: fid ? H.T.travelOf(H.formation(fid)).mode : null, notes: H.takeNotes() };
  },

  /** View the map and open the setup panel; read its select. */
  openPanel: async ({ mapId }) => {
    const H = globalThis.__rn;
    if (canvas.scene?.id !== mapId) {
      await game.scenes.get(mapId).view();
      await H.poll(() => canvas.ready && canvas.scene?.id === mapId, { tries: 100, every: 200 });
      await H.sleep(1500);
    }
    H.B.openAssistant();
    const app = await H.poll(() => foundry.applications.instances.get("acks-extras-battlemap"), { tries: 30, every: 100 });
    await H.sleep(800);
    const root = app?.element?.nodeType === 1 ? app.element : app?.element?.[0];
    const select = root?.querySelector('select[name="mapSystem"]') ?? null;
    return { viewing: canvas.scene?.id ?? null, open: !!app, select: select ? select.value : null, session: H.m.session.session.mapSystem ?? null, sessionScene: H.m.session.session.sceneId ?? null };
  },

  /** The panel's select and the session, as they stand now (after a wait). */
  panel: async ({ delay = 600 } = {}) => {
    const H = globalThis.__rn;
    await H.sleep(delay);
    const app = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    const root = app?.element?.nodeType === 1 ? app.element : app?.element?.[0];
    const select = root?.querySelector('select[name="mapSystem"]') ?? null;
    return { open: !!app, select: select ? select.value : null, session: H.m.session.session.mapSystem ?? null };
  },

  closePanel: async () => {
    const app = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    try { ui.context?.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: !app || !foundry.applications.instances.get("acks-extras-battlemap") };
  },

  /** A player's navigation: the map's card is there, and no card carries the control. */
  playerNav: async ({ mapId }) => {
    const H = globalThis.__rn;
    if (!ui.nav.expanded) ui.nav.expand();
    await H.sleep(300);
    const card = H.card(mapId);
    return { role: game.user.role, isGM: game.user.isGM, card: !!card, cardVisible: card ? card.checkVisibility() : null, controlsOnMap: card ? card.querySelectorAll(`.${H.m.nav.SCENE_SYSTEM_CLASS}`).length : null, controlsAnywhere: document.querySelectorAll(`.${H.m.nav.SCENE_SYSTEM_CLASS}`).length, cards: document.querySelectorAll("#scene-navigation .scene[data-scene-id]").length };
  },

  /** What the console recorder saw since install. */
  errors: async () => {
    const H = globalThis.__rn;
    return { recorderSince: H?.recorder ? new Date(H.recorder).toISOString() : null, count: H?.errors?.length ?? null, list: (H?.errors ?? []).slice(0, 15).map((e) => ({ at: new Date(e.at).toISOString(), text: e.text.slice(0, 400) })) };
  },

  /** The seat's client state put back: the notification patch, the picker, the panel; the navigation collapsed. */
  restore: async () => {
    const H = globalThis.__rn;
    const out = {};
    try { ui.context?.close({ animate: false }); } catch (_e) { /* closed */ }
    const app = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    if (app) { try { await app.close({ animate: false }); out.panelClosed = true; } catch (_e) { /* closed */ } }
    if (H?.notesPatched) { for (const k of ["info", "warn", "error"]) ui.notifications[k] = H.orig[k]; H.notesPatched = false; out.notesRestored = true; }
    if (ui.nav.expanded) { ui.nav.collapse(); out.navCollapsed = true; }
    return out;
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
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations && !!globalThis.acksExtras?.battlemap?.country && !!ui.nav?.rendered`);
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
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  note(`${key} install`, await page(api, P.install));
  const fresh = await page(api, P.fresh);
  if (!fresh.nav || !fresh.writer) throw new Error(`${key}: stale module code loaded; the page did not pick up the working tree`);
  note(`${key} runs the working tree`, fresh);
  return api;
}

const sceneData = (name, extra = {}) => ({
  name, active: false, navigation: true, width: 2000, height: 1400, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
  // A dungeon-scale grid in feet with no district drawn: a map that declares nothing has no fallback, so silence is silence.
  grid: { type: 1, size: CELL, distance: 5, units: "ft" },
  ownership: { default: 2 }, ...extra,
});

const LABELS = {};

try {
  section("seats");
  const gm = await seat("gm");
  const player = await seat("player");
  const census = { gm: await page(gm, P.census, MOD), player: await page(player, P.census, MOD) };
  note("gm census", { ...census.gm, userId: undefined });
  note("player census", { role: census.player.role, activeRoles: census.player.activeRoles });
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.gm.role >= 3 && census.player.role < 3, { gmRole: census.gm.role, playerRole: census.player.role, activeRoles: census.gm.activeRoles });
  if (!census.gm.activeGMIsSelf) throw new Error("another GM client is the active GM; the adoption would run there");
  Object.assign(LABELS, await gm.eval(`JSON.stringify({ delve: game.i18n.localize("ACKS-BATTLEMAP.system.delve"), journey: game.i18n.localize("ACKS-BATTLEMAP.system.journey"), settlement: game.i18n.localize("ACKS-BATTLEMAP.system.settlement"), none: game.i18n.localize("ACKS-BATTLEMAP.setup.systemNone") })`).then(JSON.parse));

  section("fixtures");
  const map = await gm.fixture("battlemap/scene-nav-map", "Scene", sceneData("QA Scene Nav Map"));
  const other = await gm.fixture("battlemap/scene-nav-other", "Scene", sceneData("QA Scene Nav Other"));
  const party = await gm.fixture("battlemap/scene-nav-party", "Actor", { name: "QA Scene Nav Company", type: "acks-extras.party", ownership: { default: 0, [census.player.userId]: 2 } });
  const formation = await page(gm, P.formationOf, { partyId: party.id });
  if (!formation) throw new Error("no formation for the party actor");
  note("formation", formation);
  const fid = formation.fid;
  const placed = await page(gm, P.placeParty, { partyId: party.id, sceneId: map.id, fid, marker: markerOf("battlemap/scene-nav-party-token"), cell: CELL });
  if (placed.built) gm.track(placed.uuid, "Token", markerOf("battlemap/scene-nav-party-token"));
  note("party token", placed);
  check("fixture: the party's token stands on the map and the formation adopted it", placed.adopted, placed);

  section("nav 1. the card shows the map declares nothing");
  let s = await page(gm, P.shape, { mapId: map.id, otherId: other.id, fid, mode: "journey" });
  note("shape", s);
  check("fixture: the map declares nothing, the party is on a journey, the GM views the other scene with the navigation expanded", s.declared === null && s.mode === "journey" && s.viewing === other.id && s.expanded && !s.pickerOpen, s);
  let n = await page(gm, P.nav, { mapId: map.id, delay: 500 });
  note("nav", n);
  check("N1: every scene card carries one icon, none two, and no level row carries one", n.cards > 0 && n.withOne === n.cards && n.withMore === 0 && n.levelsWithIcon === 0, { cards: n.cards, withOne: n.withOne, withMore: n.withMore, levelsWithIcon: n.levelsWithIcon });
  check("N1: the map's icon is a button with its own action, the undeclared face, the tooltip key and the spoken label, visible on the card", n.map?.tag === "BUTTON" && n.map.type === "button" && n.map.action === "acksExtrasSceneSystem" && n.map.system === "none" && n.map.glyph === "fa-solid fa-circle-question" && n.map.tooltip === "ACKS-BATTLEMAP.nav.tip.none" && n.map.label === n.expected.none && n.map.haspopup === "menu" && n.map.title === null && n.map.visible && n.map.inCard === map.id, n.map);

  section("nav 2. a left click opens the picker; Dungeon declares the map and the standing party switches");
  let o = await page(gm, P.openPicker, { mapId: map.id });
  note("picker", o);
  check("N2: the click opens the picker and views no scene", o.opened && o.contextIsOurs && o.viewing === other.id, { opened: o.opened, ours: o.contextIsOurs, viewing: o.viewing });
  check("N2: the picker offers the three systems and, with nothing declared, no clearing entry and nothing marked", Array.isArray(o.items) && o.items.map((i) => i.text).join("|") === [LABELS.delve, LABELS.journey, LABELS.settlement].join("|") && o.items.every((i) => !i.current), o.items);
  let p = await page(gm, P.pick, { mapId: map.id, label: LABELS.delve, fid, wantSystem: "delve" });
  note("pick Dungeon", p);
  check("N2: the flag reads delve, the card's icon follows on core's re-render, the picker closes, and the GM still views the other scene", p.declared && p.iconSays && p.closed && p.viewing === other.id, p);
  check("N2: the party standing on the map adopts the dungeon turn within the wait, announced as a toast naming it", p.mode === "delve" && p.adoptedInTime && p.notes.some((t) => t.kind === "info" && t.text.includes("QA Scene Nav Company")), { mode: p.mode, notes: p.notes });
  n = await page(gm, P.nav, { mapId: map.id });
  check("N2: the icon shows the dungeon face with its tooltip and label", n.map?.system === "delve" && n.map.glyph === "fa-solid fa-dungeon" && n.map.tooltip === "ACKS-BATTLEMAP.nav.tip.delve" && n.map.label === n.expected.delve, n.map);

  section("nav 3. a right click clears the declaration; the party keeps its mode");
  let c = await page(gm, P.clear, { mapId: map.id, fid });
  note("clear", c);
  check("N3: the flag is cleared and the icon shows the undeclared face", c.cleared && c.iconSays, c);
  check("N3: neither the picker nor core's scene menu opened on the right click", !c.menuOpen && c.context === null, { menuOpen: c.menuOpen, context: c.context });
  // Toasts from elsewhere (the importer opening the shelf's books) arrive on their own schedule; an adoption's names the party.
  const aboutParty = (notes) => notes.filter((t) => t.text.includes("QA Scene Nav Company"));
  check("N3: a map that declares nothing leaves the party where it was: still delve, no toast names the party", c.mode === "delve" && aboutParty(c.notes).length === 0, { mode: c.mode, notes: aboutParty(c.notes), others: c.notes.length });

  section("nav 4. Wilderness through the picker, then the clearing entry");
  o = await page(gm, P.openPicker, { mapId: map.id });
  p = await page(gm, P.pick, { mapId: map.id, label: LABELS.journey, fid, wantSystem: "journey" });
  note("pick Wilderness", p);
  check("N4: Wilderness declares the map and the party switches to the journey", p.declared && p.iconSays && p.mode === "journey" && p.adoptedInTime, { declared: p.declared, mode: p.mode });
  o = await page(gm, P.openPicker, { mapId: map.id });
  note("picker, declared", o);
  check("N4: with a system declared the picker marks it and offers the clearing entry last", Array.isArray(o.items) && o.items.length === 4 && o.items[1].text === LABELS.journey && o.items[1].current && o.items.filter((i) => i.current).length === 1 && o.items[3].text === LABELS.none, o.items);
  p = await page(gm, P.pick, { mapId: map.id, label: LABELS.none, fid, wantSystem: null });
  note("pick clearing entry", p);
  check("N4: the clearing entry clears the flag, the icon shows the undeclared face, and the party stays on its journey with no toast naming it", p.declared && p.iconSays && p.mode === "journey" && aboutParty(p.notes).length === 0, { declared: p.declared, mode: p.mode, notes: aboutParty(p.notes), others: p.notes.length });

  section("nav 5. the open setup panel follows the viewed map's card");
  let w = await page(gm, P.openPanel, { mapId: map.id });
  note("panel", w);
  check("N5: the panel opens over the map with the select on Leave to the party", w.viewing === map.id && w.open && w.select === "" && w.session === null && w.sessionScene === map.id, w);
  o = await page(gm, P.openPicker, { mapId: map.id });
  p = await page(gm, P.pick, { mapId: map.id, label: LABELS.settlement, fid, wantSystem: "settlement" });
  note("pick Settlement on the viewed card", p);
  let v = await page(gm, P.panel);
  note("panel after", v);
  check("N5: the viewed card's pick lands in the panel's select and the session", p.declared && v.select === "settlement" && v.session === "settlement", { declared: p.declared, select: v.select, session: v.session });
  check("N5: the party crosses the map in blocks", p.mode === "settlement", { mode: p.mode });
  c = await page(gm, P.clear, { mapId: map.id, fid });
  v = await page(gm, P.panel);
  check("N5: the right click clears the select and the session with the flag", c.cleared && v.select === "" && v.session === null, { cleared: c.cleared, select: v.select, session: v.session });
  note("panel closed", await page(gm, P.closePanel));

  section("nav 6. a player sees the card and no control");
  const pn = await page(player, P.playerNav, { mapId: map.id });
  note("player nav", pn);
  check("N6: the player's navigation lists the map's card", !pn.isGM && pn.card, { role: pn.role, card: pn.card, cards: pn.cards });
  check("N6: the player's card carries no control, and no card of theirs does", pn.controlsOnMap === 0 && pn.controlsAnywhere === 0, { onMap: pn.controlsOnMap, anywhere: pn.controlsAnywhere });

  section("nav 7. console");
  for (const [k, api] of Object.entries(seats)) {
    const e = await page(api, P.errors);
    note(`console errors, ${k} seat (recorder installed after ready)`, e);
    check(`N7: no console error on the ${k} seat since the recorder was installed`, e.count === 0, e.list);
  }
} finally {
  section("teardown");
  for (const [k, api] of Object.entries(seats)) {
    try { note(`${k} seat restored`, await page(api, P.restore)); } catch (err) { console.error(`restore ${k}:`, err?.message ?? err); }
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  for (const api of Object.values(seats)) { try { api.close(); } catch (_e) { /* closed */ } }
  process.exitCode = failed ? 1 : 0;
}
