/**
 * Live walk, scene search: keying, slice S6. Walks docs/scene-search/TESTING.md
 * "S6 — keying" on both seats at once. The Judge seat opens the real place sheet
 * (its Things here tab) and the real scene screen (its keying aside) and writes
 * every field through the window's own controls: the value is set on the control
 * and a bubbling `change` is dispatched on it, which is the event the browser
 * fires when a field is committed. Every write is checked by reading
 * `flags["acks-extras"].things` back from the world, with the thing's `state`
 * and `params` held against an invented sentinel seeded at the start. Every
 * figure and name typed into a fixture is invented.
 *
 * Scripted, not gestured: a click is `element.click()` in the page; every drop
 * is a SYNTHETIC drop event carrying the drag payload core builds
 * (`{type: "Item", uuid}` as text/plain) dispatched on the zone, never a real
 * pointer drag. A body on the screen is written by hand into the session's
 * `bodies` (no fight record is reachable here). Step 8's derived doors and old
 * trap zones are skipped while `derivedInputs` answers none, and the log says so.
 *
 * Fixtures, found by marker and kept: the place `scene-search/key-place` (its
 * list written whole at every start), `key-scene`, `key-party`, `key-char` (the
 * Player seat's character), `key-trap`, `key-hazard`, `key-tool`, `key-goods`.
 * The run's own pot is `scene-search/key-pot`, retired by marker at the start and
 * swept by tracked id at the end with any goods the drop stocked on the place.
 *
 * Not reached: a real pointer drag, a tab-key traversal (the controls' names and
 * tabbability are read, not walked), the derived rows (step 8).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, idOf, sleep } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/key-scene",
  party: "scene-search/key-party",
  char: "scene-search/key-char",
  place: "scene-search/key-place",
  trap: "scene-search/key-trap",
  hazard: "scene-search/key-hazard",
  tool: "scene-search/key-tool",
  goods: "scene-search/key-goods",
  pot: "scene-search/key-pot",
};
const NAMES = {
  scene: "QA Key Scene",
  party: "QA Key Party",
  char: "QA Key Character",
  place: "QA Key Place",
  trap: "QA Key Trap",
  hazard: "QA Key Hazard",
  tool: "QA Key Tool",
  goods: "QA Key Goods",
  body: "QA Key Fallen",
};
const K = { fx: "thing:fixture-1", hid: "thing:hidden-1", lot: "thing:lot-1" };
const SENTINEL_STATE = { qaSentinel: "kept" };
const SENTINEL_PARAMS = { qaSentinel: 7 };
const INVENTED_CLUE = "QA clue";

/** One thing of the place's list, written whole. */
const thing = (id, kind, extra = {}) => ({ id, kind, ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {}, ...extra });

/** The place's list at the start of every run: a fixture (a no-throw hasty check with a clue, a search methodical check revealing the container), the hidden container, and a lot pointing at the goods Item. The fixture carries a sentinel in `state` and `params`. */
const baseThings = (goodsUuid) => [
  thing("fixture-1", "fixture", {
    params: { ...SENTINEL_PARAMS },
    state: { ...SENTINEL_STATE },
    layers: {
      hasty: { check: "inspect", yields: { clue: INVENTED_CLUE } },
      methodical: { check: "search", yields: { reveal: ["thing:hidden-1"] } },
    },
  }),
  thing("hidden-1", "container", { hidden: true, params: { ...SENTINEL_PARAMS }, state: { ...SENTINEL_STATE } }),
  thing("lot-1", "lot", { ref: goodsUuid }),
];

const P = {
  ...KIT,

  /** The modules every page function reaches, and the window finders. */
  setup: async () => {
    const X = (globalThis.__ss = globalThis.__ss ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.things = await import(`${base}lib/place-things.mjs`);
    X.session = await import(`${base}scene-search/session.mjs`);
    X.pot = await import(`${base}treasure/pot.mjs`);
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    X.appOf = (kind, a) => (kind === "sheet" ? game.actors.get(a.placeId)?.sheet ?? null : X.win(a.fid));
    X.txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const api = globalThis.acksExtras?.sceneSearch;
    return { api: typeof api?.open === "function" && typeof api?.show === "function" && typeof api?.openScreen === "function" };
  },
  boot: async () => (globalThis.__tkBoot?.errors ?? []).map((e) => `${e.kind}: ${e.text}`),
  /** A word of the keying rail ("keying"), the screen ("screen") or scene search ("scene"); the roots are joined here so no whole key sits in the walk. */
  say: async ({ ns, key, data } = {}) => {
    const loc = "ACKS-" + "LOCATION";
    const roots = { keying: `${loc}.sceneSearch.keying.`, screen: `${loc}.sceneSearch.screen.`, scene: `${loc}.sceneSearch.`, tab: "ACKS-" + "HENCHMEN.location.tab." };
    const full = `${roots[ns]}${key}`;
    return data && Object.keys(data).length ? game.i18n.format(full, data) : game.i18n.localize(full);
  },

  /** A treasure letter the imported classic table deals under the held die, or none. */
  pickLetter: async () => {
    const T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    const B = await import("/modules/acks-extras/scripts/importer/treasure-binding.mjs");
    const Hd = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { imported: false, letter: null };
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    try {
      for (const letter of keys) {
        const d = await Hd.dealHoard({ letter, style: "classic", toggles: {} });
        if ((d.truths ?? []).length >= 1) return { imported: true, letter };
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { imported: true, letter: null };
  },

  shapeScene: async ({ sceneId } = {}) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size };
  },
  formationOf: async ({ partyId } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** The party's character at level one, owned by the Player seat alone. */
  shapeChar: async ({ charId, playerId } = {}) => {
    const actor = game.actors.get(charId);
    const user = game.users.get(playerId);
    await actor.update({ "system.details.level": 1, ownership: { default: 0, [playerId]: 3 } });
    return { owned: actor.testUserPermission(user, "OWNER") };
  },
  /** The party's start shape: the character in it with its token on the scene, no plan, no session. Answers `fight: true` and changes nothing when a combat holds the party. */
  startShape: async ({ fid, partyId, sceneId, charId } = {}) => {
    const X = globalThis.__ss;
    const H = globalThis.__tk;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    if (game.combats.some((c) => c.combatants.some((x) => x.actorId === partyId))) return { fight: true };
    await X.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
    });
    const f0 = X.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) await X.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    if (!X.model.getFormation(fid).members.some((m) => m?.actorId === charId)) {
      const doc = await game.actors.get(charId).getTokenDocument({ x: 400, y: 400 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await X.model.addMember(X.model.getFormation(fid), game.actors.get(charId), made, { scene });
    }
    if (party.getFlag("acks-extras", "turnPlan")) await party.unsetFlag("acks-extras", "turnPlan");
    if (party.getFlag("acks-extras", "sceneSearch")) await party.unsetFlag("acks-extras", "sceneSearch");
    await H.sleep(800);
    const f = X.model.getFormation(fid);
    return { fight: false, members: f.members.filter((m) => m?.actorId).map((m) => m.actorId), sceneId: f.sceneId, session: party.getFlag("acks-extras", "sceneSearch") ?? null };
  },

  /** The place's list written whole, its ownership brought to Observer for everyone (a Player seat may open its sheet), and storage as it stands. */
  shapePlace: async ({ placeId, things, observer = true } = {}) => {
    const a = game.actors.get(placeId);
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    if (observer && a.ownership?.default !== 2) await a.update({ ownership: { default: 2 } });
    return { type: a.type, hasMarket: !!a.system?.hasMarket, ids: (a.getFlag("acks-extras", "things") ?? []).map((t) => t.id), default: a.ownership?.default };
  },
  /** The stored list exactly as the flag holds it, plus the embedded goods' names. */
  rawThings: async ({ placeId } = {}) => {
    const a = game.actors.get(placeId);
    return JSON.parse(JSON.stringify(a.getFlag("acks-extras", "things") ?? []));
  },
  placeItems: async ({ placeId } = {}) => game.actors.get(placeId).items.map((i) => ({ id: i.id, uuid: i.uuid, name: i.name, qty: Number(i.system?.quantity ?? 1) })),
  docExists: async ({ uuid } = {}) => {
    const d = await fromUuid(uuid).catch(() => null);
    return d ? { name: d.name } : null;
  },
  /** A thing reset (its `state` cleared), as the place's own Reset does. */
  resetThing: async ({ placeId, id } = {}) => {
    const X = globalThis.__ss;
    const r = await X.things.resetThingIn(game.actors.get(placeId), id);
    return !!r;
  },
  /** What `derivedInputs` answers for the place: how many doors and old trap zones the map gives. */
  derived: async ({ placeId } = {}) => {
    const X = globalThis.__ss;
    const d = X.session.derivedInputs(game.actors.get(placeId), null);
    return { doors: (d.doors ?? []).length, oldTraps: (d.oldTraps ?? []).length };
  },
  /** The proficiency choices the Proficiency check may name, read from the rail's own helper. */
  proficiencies: async () => (await import("/modules/acks-extras/scripts/scene-search/keying.mjs")).proficiencyChoices().length,

  /** Is the keying stylesheet among the page's sheets? With `inject`, add it with a cache-buster when absent. */
  styleSheet: async ({ inject = false } = {}) => {
    const href = (h) => (h ?? "").includes("styles/scene-search.css");
    const loaded = [...document.styleSheets].some((sh) => href(sh.href));
    if (loaded || !inject) return { loaded, injected: false };
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `modules/acks-extras/styles/scene-search.css?walk=${Date.now()}`;
    await new Promise((res) => { link.onload = res; link.onerror = res; document.head.append(link); });
    return { loaded: false, injected: [...document.styleSheets].some((sh) => href(sh.href)) };
  },
  /** The type knob on the document root (where the client pin sets it), remembered once; `base` null puts it back. */
  knob: async ({ base = null } = {}) => {
    const style = document.documentElement.style;
    const X = globalThis.__ss;
    if (X.knobWas === undefined) X.knobWas = style.getPropertyValue("--acks-fs-base");
    if (base === null) {
      if (X.knobWas) style.setProperty("--acks-fs-base", X.knobWas);
      else style.removeProperty("--acks-fs-base");
    } else style.setProperty("--acks-fs-base", base);
    return style.getPropertyValue("--acks-fs-base");
  },

  /** Open the place's sheet on a tab and wait for it. */
  openSheet: async ({ placeId, tab = "things" } = {}) => {
    const H = globalThis.__tk;
    const app = game.actors.get(placeId).sheet;
    app.tabGroups.primary = tab;
    await app.render({ force: true });
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app)?.querySelector("nav.sheet-tabs") ? true : null), { tries: 60, every: 150 });
    await H.sleep(500);
    return { rendered: !!ok };
  },
  closeSheet: async ({ placeId } = {}) => {
    const app = game.actors.get(placeId).sheet;
    if (app.rendered) await app.close({ animate: false });
    return !app.rendered;
  },
  /** The sheet's tabs and the Things here tab's lists, read from its DOM. */
  sheetSnap: async ({ placeId } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = game.actors.get(placeId).sheet;
    const root = app.rendered ? H.root(app) : null;
    if (!root) return null;
    const section = root.querySelector('section.tab[data-tab="things"]');
    return {
      nav: [...root.querySelectorAll("nav.sheet-tabs [data-tab]")].map((a) => ({ tab: a.dataset.tab, text: X.txt(a), active: a.classList.contains("active") })),
      section: !!section,
      sectionActive: !!section?.classList.contains("active"),
      dropzone: X.txt(section?.querySelector(".acks-extras-keying-dropzone")),
      rows: [...(section?.querySelectorAll(".acks-extras-keying-row") ?? [])].map((row) => {
        const open = row.querySelector(".acks-extras-keying-open");
        return {
          key: open?.dataset.key ?? null,
          kind: X.txt(row.querySelector(".acks-extras-keying-kind")),
          sum: X.txt(row.querySelector(".acks-extras-keying-sum")),
          flag: X.txt(row.querySelector(".acks-extras-keying-flag")),
          open: row.classList.contains("is-open"),
          expanded: open?.getAttribute("aria-expanded") ?? null,
          hasRail: !!row.querySelector(".acks-extras-keying"),
        };
      }),
      empty: X.txt(section?.querySelector(":scope > .acks-extras-keying-tab > .acks-extras-keying-note")),
      derivedRows: section?.querySelectorAll(".acks-extras-keying-derived").length ?? 0,
      derivedHead: [...(section?.querySelectorAll("h4.acks-extras-keying-cap") ?? [])].map((h) => X.txt(h)),
      storageText: X.txt(root.querySelector('section.tab[data-tab="storage"]')),
      tabNames: [...root.querySelectorAll("section.tab[data-tab]")].map((s) => s.dataset.tab),
    };
  },
  /** The open rail in a window: its controls in DOM order with their names, values and sizes. */
  railSnap: async (a = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = X.appOf(a.kind, a);
    const root = app ? H.root(app) : null;
    const rail = root?.querySelector(".acks-extras-keying");
    if (!rail) return null;
    const nameOf = (c) => c.getAttribute("aria-label") || X.txt(c.labels?.[0]?.querySelector("span")) || "";
    const controls = [...rail.querySelectorAll("[data-key-field], [data-key-drop]")].map((c) => ({
      field: c.dataset.keyField ?? `drop:${c.dataset.keyDrop}`,
      layer: c.dataset.layer ?? null,
      type: c.type ?? null,
      value: c.type === "checkbox" ? c.checked : c.value,
      disabled: !!c.disabled,
      tabbable: c.tabIndex >= 0 && !c.disabled,
      name: nameOf(c),
      fs: parseFloat(getComputedStyle(c).fontSize),
      options: c.tagName === "SELECT" ? [...c.options].map((o) => ({ value: o.value, label: X.txt(o), selected: o.selected })) : null,
    }));
    const show = rail.querySelector('[data-action="keyShow"]');
    const label = rail.querySelector("label span");
    const legend = rail.querySelector("legend");
    return {
      thingId: rail.dataset.thingId,
      title: X.txt(rail.querySelector("h4.acks-extras-keying-cap")),
      controls,
      chips: [...rail.querySelectorAll(".acks-extras-keying-chips li")].map((li) => ({ name: X.txt(li.querySelector("span")), uuid: li.querySelector("button")?.dataset.uuid ?? null, xName: li.querySelector("button")?.getAttribute("aria-label") ?? "" })),
      notes: [...rail.querySelectorAll(".acks-extras-keying-note")].map((n) => X.txt(n)),
      layerNotes: [...rail.querySelectorAll("fieldset.acks-extras-keying-set")].map((f) => ({ legend: X.txt(f.querySelector("legend")), notes: [...f.querySelectorAll(".acks-extras-keying-note")].map((n) => X.txt(n)) })),
      show: show ? { disabled: !!show.disabled } : null,
      remove: !!rail.querySelector('[data-action="keyRemove"]'),
      fsLabel: label ? parseFloat(getComputedStyle(label).fontSize) : null,
      fsLegend: legend ? parseFloat(getComputedStyle(legend).fontSize) : null,
    };
  },
  /** Commit a value on a rail control: set it and dispatch a bubbling `change`. `force` adds the option a select does not offer. */
  setField: async (a = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const root = H.root(X.appOf(a.kind, a));
    const rail = root?.querySelector(".acks-extras-keying");
    const sel = `[data-key-field="${a.field}"]${a.layer ? `[data-layer="${a.layer}"]` : ""}`;
    const c = rail?.querySelector(sel);
    if (!c) return { found: false };
    if (c.type === "checkbox") c.checked = a.value === true;
    else {
      if (c.tagName === "SELECT" && a.force && ![...c.options].some((o) => o.value === a.value)) c.append(new Option(a.force, a.value));
      c.value = a.value;
    }
    c.dispatchEvent(new Event("change", { bubbles: true }));
    return { found: true, value: c.type === "checkbox" ? c.checked : c.value };
  },
  /** Click the nth element a selector finds inside a window. */
  clickIn: async (a = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const root = H.root(X.appOf(a.kind, a));
    const list = root ? [...root.querySelectorAll(a.sel)] : [];
    const el = list[a.nth ?? 0];
    if (!el) return { found: false, count: list.length };
    el.click();
    return { found: true, count: list.length, disabled: !!el.disabled };
  },
  /** A synthetic drop of an Item on a node inside a window: the drag payload core builds, dispatched where a pointer drag would end. */
  dropOn: async (a = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const root = H.root(X.appOf(a.kind, a));
    const zone = root?.querySelector(a.sel);
    if (!zone) return { found: false };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: a.uuid }));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { found: true };
  },

  /** Open a session, the die held while the pot is dealt. */
  openSession: async ({ fid, placeUuid, sceneId, sources, die = 0.025 } = {}) => {
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    try {
      const r = await acksExtras.sceneSearch.open({ partyId: fid, placeUuid, sceneId, sources, metInLair: true });
      return { ok: r.ok === true, reason: r.reason ?? null, potUuid: r.potUuid ?? null, lots: r.session?.lots ?? [] };
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
  },
  endSession: async ({ fid } = {}) => {
    const r = await acksExtras.sceneSearch.end(fid);
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  showSession: async ({ fid } = {}) => {
    const r = await acksExtras.sceneSearch.show(fid);
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  /** A body written by hand into the session's `bodies`, as a fight's record would make one. */
  addBody: async ({ fid, id, name } = {}) => {
    const X = globalThis.__ss;
    const formation = X.model.getFormation(fid);
    const session = X.session.readSession(formation);
    await X.session.writeSession(formation, { ...session, bodies: [...session.bodies, { id, ref: null, name, hidden: false, hint: null, point: null, state: {}, layers: {} }] });
    return (X.session.readSession(X.model.getFormation(fid))?.bodies ?? []).map((b) => b.id);
  },
  openScreen: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = acksExtras.sceneSearch.openScreen(fid);
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app) ? true : null), { tries: 60, every: 150 });
    await H.sleep(400);
    return { rendered: !!ok, found: !!X.win(fid) };
  },
  closeScreen: async ({ fid } = {}) => {
    const app = globalThis.__ss.win(fid);
    if (app) await app.close({ animate: false });
    return !globalThis.__ss.win(fid);
  },
  /** The scene screen's cards, aside and bar, read from its DOM. */
  screenSnap: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = X.win(fid);
    const root = app ? H.root(app) : null;
    if (!root) return null;
    const aside = root.querySelector(".acks-extras-keying-aside");
    return {
      empty: root.querySelector(".acks-extras-ss-empty") ? X.txt(root.querySelector(".acks-extras-ss-empty")) : null,
      aside: !!aside,
      asideText: X.txt(aside),
      asideHasRail: !!aside?.querySelector(".acks-extras-keying"),
      asideControls: aside?.querySelectorAll("[data-key-field], [data-key-drop]").length ?? 0,
      asideButtons: aside?.querySelectorAll('[data-action="keyShow"], [data-action="keyRemove"]').length ?? 0,
      keyBtns: root.querySelectorAll(".acks-extras-ss-keybtn").length,
      selectActions: root.querySelectorAll('[data-action="select"]').length,
      cards: [...root.querySelectorAll(".acks-extras-ss-card")].map((c) => ({
        key: c.dataset.dropEntry,
        selected: c.classList.contains("is-selected"),
        hidden: c.classList.contains("is-hidden"),
        pressed: c.querySelector(".acks-extras-ss-keybtn")?.getAttribute("aria-pressed") ?? null,
        plate: X.txt(c.querySelector(".acks-extras-ss-plate")),
        plateIsButton: !!c.querySelector(".acks-extras-ss-plate button"),
        tell: X.txt(c.querySelector(".acks-extras-ss-tell")),
      })),
    };
  },
  /** The window shrunk and the knob raised on it, with the aside open: where each part sits against the window, and whether the rail's last control is reachable by scrolling. */
  layoutKey: async ({ fid, width, height, base } = {}) => {
    const H = globalThis.__tk;
    const app = globalThis.__ss.win(fid);
    const el = H.root(app);
    const size = () => parseFloat(getComputedStyle(el.querySelector(".acks-extras-ss-banner")).fontSize);
    const before = size();
    await app.setPosition({ width, height });
    document.documentElement.style.setProperty("--acks-fs-base", base);
    await app.render();
    await H.sleep(600);
    const win = el.getBoundingClientRect();
    const box = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { ok: r.width > 0 && r.height > 0 && r.top >= win.top - 1 && r.bottom <= win.bottom + 1 && r.left >= win.left - 1 && r.right <= win.right + 1, w: Math.round(r.width), h: Math.round(r.height) };
    };
    const inside = (sel) => box(el.querySelector(sel));
    const scroller = (sel) => {
      const n = el.querySelector(sel);
      return n ? { sh: n.scrollHeight, ch: n.clientHeight, overflowY: getComputedStyle(n).overflowY } : null;
    };
    const btn = el.querySelector('[data-action="keyRemove"]');
    // The parts are measured where the window left them; only then is the last control scrolled to, which moves the frame.
    const out = {
      win: { w: Math.round(win.width), h: Math.round(win.height) },
      fontBefore: before,
      fontAfter: size(),
      head: inside(".acks-extras-ss-head"),
      bar: inside(".acks-extras-ss-bar"),
      tray: inside(".acks-extras-ss-tray"),
      aside: scroller(".acks-extras-keying-aside"),
      entries: scroller(".acks-extras-ss-entries"),
      frame: scroller(".window-content"),
    };
    btn?.scrollIntoView({ block: "end" });
    await H.sleep(250);
    out.removeAfterScroll = box(btn);
    el.querySelector(".window-content")?.scrollTo({ top: 0 });
    return out;
  },
};

/** Poll an async condition from this side; the first truthy answer, else null. */
async function until(fn, { tries = 40, every = 250 } = {}) {
  for (let n = 0; n < tries; n++) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byId = (list, id) => (list ?? []).find((t) => t.id === id) ?? null;

let gm = null;
let player = null;
watchdog(() => [gm, player], 1_500_000);
const own = { pot: null, items: [] };
let ids = null;
let tornDown = false;

/** Close the windows, end any session, put the place's list back, and sweep what the run made by tracked id. */
async function teardown() {
  tornDown = true;
  await run(gm, P.knob, { base: null }).catch(() => null);
  await run(player, P.knob, { base: null }).catch(() => null);
  await run(gm, P.closeAll).catch(() => null);
  await run(player, P.closeAll).catch(() => null);
  if (ids) {
    await run(gm, P.endSession, { fid: ids.fid }).catch(() => null);
    if (ids.things) await run(gm, P.shapePlace, { placeId: ids.placeId, things: ids.things, observer: false }).catch(() => null);
  }
  const only = [own.pot, ...own.items].filter((u, i, a) => u && a.indexOf(u) === i);
  const swept = await gm.sweepTracked({ only });
  note("swept", swept);
  return { swept, wanted: only.length };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|keying|session|screen|location-sheet|place-things/i });
  const setG = await run(gm, P.setup);
  const setP = await run(player, P.setup);
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch (open, show, openScreen) is not on both seats");
  const bootBase = { gm: (await run(gm, P.boot)).length, player: (await run(player, P.boot)).length };
  const sayK = (key, data) => run(gm, P.say, { ns: "keying", key, data });
  const sayS = (key, data) => run(gm, P.say, { ns: "screen", key, data });

  section("stylesheet");
  const cssG = await run(gm, P.styleSheet, { inject: true });
  const cssP = await run(player, P.styleSheet, { inject: true });
  note("scene-search.css was loaded by the page already (gm, player)", [cssG.loaded, cssP.loaded]);
  note("scene-search.css added by this walk with a cache-buster where the world had not loaded it (gm, player)", [cssG.injected, cssP.injected]);

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const picked = await run(gm, P.pickLetter);
  const LETTER = picked.imported ? picked.letter : null;
  note("a treasure letter that deals under the held die", LETTER ?? "none (step 9's dealt-lot checks are skipped)");

  const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const sceneId = idOf(scene);
  await run(gm, P.shapeScene, { sceneId });
  const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party" });
  const char = await gm.fixture(MARKS.char, "Actor", {
    name: NAMES.char,
    type: "character",
    prototypeToken: { actorLink: true },
    system: { hp: { value: 8, max: 8 }, details: { level: 1 } },
    ownership: { default: 0, [playerId]: 3 },
  });
  const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location", ownership: { default: 2 } });
  const trap = await gm.fixture(MARKS.trap, "Item", { name: NAMES.trap, type: "acks-extras.trap" });
  const hazard = await gm.fixture(MARKS.hazard, "Item", { name: NAMES.hazard, type: "acks-extras.hazard", system: { key: "jump" } });
  const tool = await gm.fixture(MARKS.tool, "Item", { name: NAMES.tool, type: "item" });
  const goods = await gm.fixture(MARKS.goods, "Item", { name: NAMES.goods, type: "item" });
  const partyId = idOf(party);
  const charId = idOf(char);
  const placeId = idOf(place);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;
  const goodsUuid = goods.uuid;
  const toolUuid = tool.uuid;

  const { fid, error } = await run(gm, P.formationOf, { partyId });
  if (error) blocked(error);
  const BASE = baseThings(goodsUuid);
  ids = { fid, placeId, sceneId, things: BASE };

  note("an earlier session ended", (await run(gm, P.endSession, { fid })).ok);
  await gm.retire(MARKS.pot, "Cards");
  const chars = await run(gm, P.shapeChar, { charId, playerId });
  const shape = await run(gm, P.startShape, { fid, partyId, sceneId, charId });
  if (shape.fight) blocked("a combat holds the walk's party; it is another session's and is not swept here");
  const placed = await run(gm, P.shapePlace, { placeId, things: BASE });
  const derived = await run(gm, P.derived, { placeId });
  const itemsAtStart = await run(gm, P.placeItems, { placeId });
  const profs = await run(gm, P.proficiencies);

  check(
    "the kept fixtures stand in shape: the place (a location with no market) holds its list written whole at the recipe's three things, the Player seat owns the character, the party holds it with no session",
    placed.type === "acks-extras.location" && !placed.hasMarket && placed.ids.join() === "fixture-1,hidden-1,lot-1" && chars.owned && shape.members.includes(charId) && !shape.session,
    { placed, chars, shape },
  );
  note("what derivedInputs answers for the place (doors, old-style trap zones)", derived);
  note("proficiency choices the library offers", profs);

  const raw = () => run(gm, P.rawThings, { placeId });
  const waitRaw = (pred, opts) => until(async () => { const l = await raw(); return pred(l) ? l : null; }, opts);
  const notes = () => run(gm, P.takeNotes);
  const rail = (kind = "sheet") => run(gm, P.railSnap, { kind, placeId, fid });
  const ctl = (r, field, layer = null) => r?.controls.find((c) => c.field === field && (layer === null || c.layer === layer)) ?? null;
  const field = (kind, f, layer, value, extra = {}) => run(gm, P.setField, { kind, placeId, fid, field: f, layer, value, ...extra });
  const click = (kind, sel, nth = 0) => run(gm, P.clickIn, { kind, placeId, fid, sel, nth });
  const snapSheet = () => run(gm, P.sheetSnap, { placeId });
  const untilRail = (kind, thingId, extra = {}) => until(async () => { const r = await rail(kind); return r && r.thingId === thingId && (extra.pred ? extra.pred(r) : true) ? r : null; }, { tries: 40, every: 250 });
  const rowSel = (key) => `.acks-extras-keying-open[data-key="${key}"]`;
  /** Fixture-1's state and params are the seeded sentinels, and every other key of the thing is its own. */
  const sentinelKept = (list) => { const t = byId(list, "fixture-1"); return !!t && same(t.state, SENTINEL_STATE) && same(t.params, SENTINEL_PARAMS) && t.kind === "fixture" && t.point === null; };

  // ----------------------------------------------------------------------------------------------
  section("Judge 1: the tab");
  const open1 = await run(gm, P.openSheet, { placeId, tab: "things" });
  const s1 = await snapSheet();
  if (!open1.rendered || !s1) blocked("the Judge's place sheet did not render");
  const navIdx = (s, id) => s.nav.findIndex((n) => n.tab === id);
  const thingsWord = await run(gm, P.say, { ns: "tab", key: "things" });
  const flagHidden = await sayK("flag.hidden");
  const flagFront = await sayK("flag.front");
  const flagLot = await sayK("flag.lot");
  const mapHead = await sayK("tab.derived");
  const navThings = s1.nav[navIdx(s1, "things")];
  check(
    "the Things here tab is in the sheet's nav straight after Research, labelled with its count of three",
    navIdx(s1, "things") === navIdx(s1, "research") + 1 && navIdx(s1, "research") >= 0 && navThings?.text.includes(`${thingsWord} (3)`),
    { nav: s1.nav.map((n) => n.tab), label: navThings?.text },
  );
  check(
    "opened, the tab lists the three things, each row with its kind, a summary of its two checks and its flag: the fixture's says a clue is in front of a secret, the container's that it is hidden, the lot's that it is dealt at open",
    s1.section && s1.sectionActive && s1.rows.length === 3
      && s1.rows.every((r) => r.kind && r.sum && r.flag !== undefined)
      && s1.rows.find((r) => r.key === K.fx)?.flag.includes(flagFront)
      && s1.rows.find((r) => r.key === K.hid)?.flag.includes(flagHidden)
      && s1.rows.find((r) => r.key === K.lot)?.flag.includes(flagLot),
    { rows: s1.rows.map((r) => [r.key, r.kind, r.sum, r.flag]) },
  );
  check(
    "no 'From the map' section is drawn while nothing derives the map's doors (derivedInputs answers none)",
    derived.doors === 0 && derived.oldTraps === 0 && s1.derivedRows === 0 && !s1.derivedHead.includes(mapHead),
    { derived, head: s1.derivedHead },
  );

  // ----------------------------------------------------------------------------------------------
  section("Judge 2: open a thing");
  const orderWant = ["hidden", "behind", "hint", "check:hasty", "anyone:hasty", "clue:hasty", "check:methodical", "drop:tools:methodical", "turns:methodical", "clue:methodical"].join();
  const orderOf = (r) => r.controls.map((c) => (c.layer ? `${c.field}:${c.layer}` : c.field)).filter((x) => x !== "").join();
  await click("sheet", rowSel(K.fx));
  const r2 = await untilRail("sheet", "fixture-1");
  const row2 = (await snapSheet())?.rows.find((r) => r.key === K.fx);
  check(
    "pressing the fixture's row opens its rail under it, in the board's order: Hidden, Behind, the something-more line, then per check (hasty, methodical) its fields",
    !!r2 && row2?.open && row2.expanded === "true" && row2.hasRail && orderOf(r2) === orderWant,
    { order: r2 && orderOf(r2), expanded: row2?.expanded },
  );
  const unnamed = (r2?.controls ?? []).filter((c) => !c.name);
  const untabbable = (r2?.controls ?? []).filter((c) => !c.tabbable && c.field !== "behind");
  check(
    "every control in the rail carries a name (aria-label or a label's own text) and can take the keyboard (the disabled Behind is the only one off the tab order)",
    (r2?.controls.length ?? 0) > 0 && unnamed.length === 0 && untabbable.length === 0 && !ctl(r2, "behind").tabbable === ctl(r2, "behind").disabled,
    { unnamed: unnamed.map((c) => c.field), untabbable: untabbable.map((c) => c.field), behindDisabled: ctl(r2, "behind")?.disabled },
  );
  await click("sheet", rowSel(K.fx));
  const closed2 = await until(async () => { const s = await snapSheet(); return s && !s.rows.find((r) => r.key === K.fx)?.open && !s.rows.some((r) => r.hasRail) ? s : null; });
  check("pressing the row again closes the rail", !!closed2, { rows: closed2?.rows.map((r) => [r.key, r.open]) });

  // The type knob: the sheet drawn again at three sizes, one rail control and the rail's text measured each time.
  const fonts = {};
  for (const base of ["14px", "18px", "22px"]) {
    await run(gm, P.closeSheet, { placeId });
    await run(gm, P.knob, { base });
    await run(gm, P.openSheet, { placeId, tab: "things" });
    let r = await rail("sheet");
    if (!r) { await click("sheet", rowSel(K.fx)); r = await untilRail("sheet", "fixture-1"); }
    fonts[base] = r ? { input: ctl(r, "hint")?.fs, select: ctl(r, "check", "hasty")?.fs, label: r.fsLabel, legend: r.fsLegend } : null;
  }
  const grows = (k) => !!fonts["14px"] && !!fonts["18px"] && !!fonts["22px"] && fonts["14px"][k] < fonts["18px"][k] && fonts["18px"][k] < fonts["22px"][k];
  check("the type knob reaches the rail on the sheet: a text field, a select, a label and a legend each compute larger at 18px than at 14px and at 22px than at 18px (the sheet drawn fresh each time)", grows("input") && grows("select") && grows("label") && grows("legend"), fonts);
  await run(gm, P.closeSheet, { placeId });
  await run(gm, P.knob, { base: null });
  await run(gm, P.openSheet, { placeId, tab: "things" });
  if (!(await rail("sheet"))) await click("sheet", rowSel(K.fx));
  await untilRail("sheet", "fixture-1");

  // ----------------------------------------------------------------------------------------------
  section("Judge 3: write each field");
  const others = (list, id) => list.filter((t) => t.id !== id);
  const baseOthers = others(await raw(), "fixture-1");
  const stable = (list) => sentinelKept(list) && same(others(list, "fixture-1"), baseOthers);
  const hint = "QA more here";

  await field("sheet", "hidden", null, true);
  let l = await waitRaw((x) => byId(x, "fixture-1")?.hidden === true);
  check("Hidden ticked writes the thing's `hidden`; its state and params are as they were, and no other thing changed", !!l && stable(l), { hidden: byId(l, "fixture-1")?.hidden });
  await untilRail("sheet", "fixture-1");
  await field("sheet", "hidden", null, false);
  l = await waitRaw((x) => byId(x, "fixture-1")?.hidden === false);
  check("Hidden unticked writes it back", !!l && stable(l), { hidden: byId(l, "fixture-1")?.hidden });

  await untilRail("sheet", "fixture-1");
  await field("sheet", "hint", null, hint);
  l = await waitRaw((x) => byId(x, "fixture-1")?.hint === hint);
  check("the Something more line writes `hint`", !!l && stable(l), { hint: byId(l, "fixture-1")?.hint });
  await untilRail("sheet", "fixture-1", { pred: (r) => ctl(r, "hint")?.value === hint });
  await field("sheet", "hint", null, "");
  l = await waitRaw((x) => !byId(x, "fixture-1")?.hint);
  check("a blank line removes `hint`", !!l && stable(l), { hint: byId(l, "fixture-1")?.hint ?? null });

  await untilRail("sheet", "fixture-1");
  await field("sheet", "check", "hasty", "skill");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.check === "skill");
  const withSkill = await untilRail("sheet", "fixture-1", { pred: (r) => !!ctl(r, "capability", "hasty") });
  check("the hasty Check set to Proficiency writes `layers.hasty.check: skill`, and the proficiency select appears", !!l && stable(l) && !!withSkill, { check: byId(l, "fixture-1")?.layers?.hasty?.check, select: !!ctl(withSkill, "capability", "hasty") });
  const choice = (ctl(withSkill, "capability", "hasty")?.options ?? []).find((o) => o.value);
  if (!choice) {
    note("SKIP: no proficiency is imported, so the select offers none and a pick cannot be walked", true);
  } else {
    await field("sheet", "capability", "hasty", choice.value);
    l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.capability === choice.value);
    check("picking a proficiency writes `capability` as its token", !!l && stable(l), { capability: byId(l, "fixture-1")?.layers?.hasty?.capability });
  }
  await untilRail("sheet", "fixture-1");
  await field("sheet", "check", "hasty", "search");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.check === "search");
  const hastyKeys = Object.keys(byId(l, "fixture-1")?.layers?.hasty ?? {});
  check("setting the hasty check back to the party's search removes `capability`, and the clue stays", !!l && stable(l) && !hastyKeys.includes("capability") && byId(l, "fixture-1").layers.hasty.yields?.clue === INVENTED_CLUE, { keys: hastyKeys });

  await untilRail("sheet", "fixture-1");
  await field("sheet", "anyone", "hasty", true);
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.anyone === true);
  check("Others may look hastily ticked writes `layers.hasty.anyone`", !!l && stable(l), { anyone: byId(l, "fixture-1")?.layers?.hasty?.anyone });
  await untilRail("sheet", "fixture-1");
  await field("sheet", "anyone", "hasty", false);
  await waitRaw((x) => !byId(x, "fixture-1")?.layers?.hasty?.anyone);

  await untilRail("sheet", "fixture-1");
  await field("sheet", "clue", "hasty", "QA clue two");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.yields?.clue === "QA clue two");
  check("Yields writes `yields.clue`", !!l && stable(l), { clue: byId(l, "fixture-1")?.layers?.hasty?.yields?.clue });
  await untilRail("sheet", "fixture-1");
  await field("sheet", "clue", "hasty", INVENTED_CLUE);
  await waitRaw((x) => byId(x, "fixture-1")?.layers?.hasty?.yields?.clue === INVENTED_CLUE);

  // Tools: a drop of key-tool on the methodical layer's field.
  await untilRail("sheet", "fixture-1");
  const toolsBefore = (await run(gm, P.placeItems, { placeId })).length;
  const toolSel = '.acks-extras-keying [data-key-drop="tools"][data-layer="methodical"]';
  await run(gm, P.dropOn, { kind: "sheet", placeId, fid, sel: toolSel, uuid: toolUuid });
  l = await waitRaw((x) => (byId(x, "fixture-1")?.layers?.methodical?.tools ?? []).length === 1);
  const toolsOnce = byId(l, "fixture-1")?.layers?.methodical?.tools;
  const chipRail = await untilRail("sheet", "fixture-1", { pred: (r) => r.chips.length === 1 });
  await run(gm, P.dropOn, { kind: "sheet", placeId, fid, sel: toolSel, uuid: toolUuid });
  await sleep(1500);
  const again = await raw();
  check(
    "dropping key-tool on the Tools field puts its uuid in `tools` once, drops it a second time with the list still holding it once, shows one chip named for it, and stocks no goods on the place",
    !!l && same(toolsOnce, [toolUuid]) && same(byId(again, "fixture-1").layers.methodical.tools, [toolUuid]) && stable(again) && chipRail?.chips[0]?.name === NAMES.tool && (await run(gm, P.placeItems, { placeId })).length === toolsBefore,
    { tools: byId(again, "fixture-1")?.layers?.methodical?.tools, chip: chipRail?.chips[0]?.name },
  );
  note("the tool drop was a synthetic drop event on the field", true);
  await click("sheet", `.acks-extras-keying [data-action="keyToolRemove"][data-uuid="${toolUuid}"]`);
  l = await waitRaw((x) => (byId(x, "fixture-1")?.layers?.methodical?.tools ?? []).length === 0);
  check("the chip's × removes the tool", !!l && stable(l), { tools: byId(l, "fixture-1")?.layers?.methodical?.tools });

  // Turns: blank, a whole number, then values the field refuses.
  await untilRail("sheet", "fixture-1");
  const turnsRefusal = await sayK("refusal.turns");
  const noTurns = !("turns" in (byId(await raw(), "fixture-1")?.layers?.methodical ?? {}));
  await field("sheet", "turns", "methodical", "");
  await sleep(1200);
  const stillNone = !("turns" in (byId(await raw(), "fixture-1")?.layers?.methodical ?? {}));
  await field("sheet", "turns", "methodical", "3");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.methodical?.turns === 3);
  check("Turns left blank writes no `turns` key, and a typed whole number writes it", noTurns && stillNone && !!l && stable(l), { blank: stillNone, typed: byId(l, "fixture-1")?.layers?.methodical?.turns });
  await untilRail("sheet", "fixture-1", { pred: (r) => ctl(r, "turns", "methodical")?.value === "3" });
  await notes();
  const refusedVals = {};
  for (const bad of ["0", "1.5"]) {
    await field("sheet", "turns", "methodical", bad);
    await sleep(1200);
    const n = await notes();
    const back = await untilRail("sheet", "fixture-1", { pred: (r) => ctl(r, "turns", "methodical")?.value === "3" });
    refusedVals[bad] = { warned: n.warns.includes(turnsRefusal), back: !!back, stored: byId(await raw(), "fixture-1")?.layers?.methodical?.turns };
  }
  check("a typed 0 and a typed 1.5 are each refused with the refusal notice, and the field returns to its stored 3", ["0", "1.5"].every((b) => refusedVals[b].warned && refusedVals[b].back && refusedVals[b].stored === 3), refusedVals);
  await field("sheet", "turns", "methodical", "");
  l = await waitRaw((x) => !("turns" in (byId(x, "fixture-1")?.layers?.methodical ?? {})));
  check("blanking Turns removes the key again, with state and params as they were", !!l && stable(l), { keys: Object.keys(byId(l, "fixture-1")?.layers?.methodical ?? {}) });

  // ----------------------------------------------------------------------------------------------
  section("Judge 4: Behind");
  const revealOf = (list, id, layer) => byId(list, id)?.layers?.[layer]?.yields?.reveal ?? null;
  await click("sheet", rowSel(K.fx));
  await until(async () => (await snapSheet())?.rows.every((r) => !r.open));
  await click("sheet", rowSel(K.hid));
  const r4 = await untilRail("sheet", "hidden-1");
  const behindWas = ctl(r4, "behind");
  check("the hidden container's Behind select is enabled and reads the fixture's methodical layer, which reveals it", !!r4 && !behindWas.disabled && behindWas.options.find((o) => o.selected)?.value === "fixture-1:methodical", { selected: behindWas?.options.find((o) => o.selected)?.value, disabled: behindWas?.disabled });
  const snap4 = await raw();
  const behind = async (value, pred) => { await field("sheet", "behind", null, value); const out = await waitRaw(pred); await untilRail("sheet", "hidden-1"); return out; };
  l = await behind("", (x) => revealOf(x, "fixture-1", "methodical") === null);
  check("choosing Nothing in Behind removes the key from the fixture's methodical layer, and no other thing changed", !!l && same(others(l, "fixture-1"), others(snap4, "fixture-1")) && sentinelKept(l), { reveal: revealOf(l, "fixture-1", "methodical") });
  l = await behind("fixture-1:methodical", (x) => same(revealOf(x, "fixture-1", "methodical"), ["thing:hidden-1"]));
  check("choosing the fixture's methodical layer makes it name `thing:hidden-1` and no other thing changed", !!l && same(revealOf(l, "fixture-1", "methodical"), ["thing:hidden-1"]) && same(others(l, "fixture-1"), others(snap4, "fixture-1")) && sentinelKept(l), { reveal: revealOf(l, "fixture-1", "methodical") });
  l = await behind("fixture-1:hasty", (x) => same(revealOf(x, "fixture-1", "hasty"), ["thing:hidden-1"]));
  check("choosing the fixture's hasty layer moves the key: the hasty layer names it and the methodical layer no longer does", !!l && revealOf(l, "fixture-1", "methodical") === null && same(others(l, "fixture-1"), others(snap4, "fixture-1")), { hasty: revealOf(l, "fixture-1", "hasty"), methodical: revealOf(l, "fixture-1", "methodical") });
  l = await behind("", (x) => revealOf(x, "fixture-1", "hasty") === null);
  check("choosing Nothing again removes it from the hasty layer", !!l && revealOf(l, "fixture-1", "methodical") === null, { hasty: revealOf(l, "fixture-1", "hasty") });
  l = await behind("fixture-1:methodical", (x) => same(revealOf(x, "fixture-1", "methodical"), ["thing:hidden-1"]));

  // The loop guard: tick Hidden on the fixture, whose Behind then must not offer the container it reveals.
  await click("sheet", rowSel(K.hid));
  await until(async () => (await snapSheet())?.rows.every((r) => !r.open));
  await click("sheet", rowSel(K.fx));
  await untilRail("sheet", "fixture-1");
  await field("sheet", "hidden", null, true);
  await waitRaw((x) => byId(x, "fixture-1")?.hidden === true);
  const r4b = await untilRail("sheet", "fixture-1", { pred: (r) => ctl(r, "behind")?.disabled === false });
  const offered = (ctl(r4b, "behind")?.options ?? []).map((o) => o.value);
  const cycleWord = await sayK("refusal.cycle");
  await notes();
  const beforeForce = await raw();
  await field("sheet", "behind", null, "hidden-1:hasty", { force: "forced option" });
  await sleep(1500);
  const nForce = await notes();
  const afterForce = await raw();
  check(
    "with the container behind the fixture's layer, the hidden fixture's Behind select does not offer the container, and a hand-forced value is refused with the cycle notice and writes nothing",
    !!r4b && !offered.includes("hidden-1:hasty") && !offered.includes("hidden-1:methodical") && nForce.warns.includes(cycleWord) && same(beforeForce, afterForce),
    { offered, warns: nForce.warns },
  );
  await untilRail("sheet", "fixture-1");
  await field("sheet", "hidden", null, false);
  l = await waitRaw((x) => byId(x, "fixture-1")?.hidden === false);
  check("the fixture ticked and unticked again is back to its seeded shape (state, params, both layers)", !!l && sentinelKept(l) && same(revealOf(l, "fixture-1", "methodical"), ["thing:hidden-1"]) && byId(l, "fixture-1").layers.hasty.yields.clue === INVENTED_CLUE, {});

  // ----------------------------------------------------------------------------------------------
  section("Judge 5: Show to the table");
  await click("sheet", rowSel(K.fx));
  await until(async () => (await snapSheet())?.rows.every((r) => !r.open));
  await click("sheet", rowSel(K.hid));
  const r5 = await untilRail("sheet", "hidden-1");
  const before5 = await raw();
  const showed = await click("sheet", '.acks-extras-keying [data-action="keyShow"]');
  l = await waitRaw((x) => byId(x, "hidden-1")?.state?.shown === true);
  const r5b = await untilRail("sheet", "hidden-1", { pred: (r) => r.show?.disabled === true });
  check(
    "Show to the table sets `state.shown` on the container alone, `hidden` stays true, the sentinel in its state stays, and the button is disabled afterwards",
    !!r5 && r5.show?.disabled === false && showed.found && !!l && byId(l, "hidden-1").hidden === true && byId(l, "hidden-1").state.qaSentinel === "kept" && same(others(l, "hidden-1"), others(before5, "hidden-1")) && !!r5b,
    { state: byId(l, "hidden-1")?.state, before: r5?.show, after: r5b?.show },
  );
  const reset = await run(gm, P.resetThing, { placeId, id: "hidden-1" });
  l = await waitRaw((x) => !byId(x, "hidden-1")?.state?.shown);
  const r5c = await untilRail("sheet", "hidden-1", { pred: (r) => r.show?.disabled === false });
  check("a Reset of the place's thing (resetThingIn) clears `shown`, and the button is enabled again", reset && !!l && byId(l, "hidden-1").hidden === true && !!r5c, { state: byId(l, "hidden-1")?.state });
  await run(gm, P.shapePlace, { placeId, things: BASE });

  // ----------------------------------------------------------------------------------------------
  section("Judge 6: Remove");
  await untilRail("sheet", "hidden-1").catch(() => null);
  await run(gm, P.closeSheet, { placeId });
  await run(gm, P.openSheet, { placeId, tab: "things" });
  const sRow = await snapSheet();
  for (const r of sRow.rows) if (r.open) await click("sheet", rowSel(r.key));
  await until(async () => (await snapSheet())?.rows.every((r) => !r.open));
  await click("sheet", rowSel(K.lot));
  const r6 = await untilRail("sheet", "lot-1");
  const lotBehindDisabled = ctl(r6, "behind")?.disabled;
  await field("sheet", "hidden", null, true);
  await waitRaw((x) => byId(x, "lot-1")?.hidden === true);
  await untilRail("sheet", "lot-1", { pred: (r) => ctl(r, "behind")?.disabled === false });
  await field("sheet", "behind", null, "fixture-1:hasty");
  l = await waitRaw((x) => same(revealOf(x, "fixture-1", "hasty"), ["thing:lot-1"]));
  await untilRail("sheet", "lot-1", { pred: (r) => ctl(r, "behind")?.options.find((o) => o.selected)?.value === "fixture-1:hasty" });
  check("setup through the rail: the lot is only put behind a layer once it is Hidden (Behind is disabled until then), and the fixture's hasty layer then names it", lotBehindDisabled === true && !!l, { disabledBefore: lotBehindDisabled, reveal: revealOf(l, "fixture-1", "hasty") });
  const goodsBefore = await run(gm, P.docExists, { uuid: goodsUuid });
  await click("sheet", '.acks-extras-keying [data-action="keyRemove"]');
  l = await waitRaw((x) => !byId(x, "lot-1") && revealOf(x, "fixture-1", "hasty") === null, { tries: 40, every: 250 });
  const goodsAfter = await run(gm, P.docExists, { uuid: goodsUuid });
  const s6 = await snapSheet();
  check(
    "Remove takes the lot off the place's list, clears the reveal that named it, names its key nowhere in the list, leaves the document it pointed at standing, and the other things are as they were",
    !!l && !JSON.stringify(l).includes("thing:lot-1") && !!goodsAfter && goodsAfter.name === goodsBefore?.name && s6.rows.length === 2 && byId(l, "hidden-1") && sentinelKept(l),
    { rows: s6.rows.map((r) => r.key), goods: goodsAfter?.name },
  );

  // ----------------------------------------------------------------------------------------------
  section("Judge 7: drops");
  const itemsBefore = await run(gm, P.placeItems, { placeId });
  const dropSel = 'section.tab[data-tab="things"] .acks-extras-keying-dropzone';
  const kindsBefore = (await raw()).length;
  for (const [item, want, hidden] of [[trap, "trap", true], [hazard, "obstacle", false]]) {
    const had = (await raw()).map((t) => t.id);
    const g = await run(gm, P.dropOn, { kind: "sheet", placeId, fid, sel: dropSel, uuid: item.uuid });
    const grown = await waitRaw((x) => x.length > had.length);
    const added = (grown ?? []).filter((t) => !had.includes(t.id));
    check(
      `the ${want === "trap" ? "trap" : "hazard"} Item dropped on the tab becomes a ${want} thing with no point, ${hidden ? "hidden" : "not hidden"}, pointing at the Item`,
      g.found && !!grown && added.length === 1 && added[0].kind === want && added[0].ref === item.uuid && added[0].point === null && added[0].hidden === hidden,
      { added: added.map((t) => [t.kind, t.ref === item.uuid, t.point, t.hidden]) },
    );
  }
  const thingsAfterHazards = await raw();
  const g3 = await run(gm, P.dropOn, { kind: "sheet", placeId, fid, sel: dropSel, uuid: goodsUuid });
  const stored = await until(async () => { const now = await run(gm, P.placeItems, { placeId }); const was = Object.fromEntries(itemsBefore.map((i) => [i.id, i.qty])); return now.length > itemsBefore.length || now.some((i) => i.id in was && i.qty > was[i.id]) ? now : null; }, { tries: 40, every: 250 });
  const newItems = (stored ?? []).filter((i) => !itemsBefore.some((b) => b.id === i.id));
  for (const i of newItems) own.items.push(gm.track(i.uuid, "Item"));
  await run(gm, P.openSheet, { placeId, tab: "things" });
  const s7 = await snapSheet();
  check(
    "key-goods dropped on the tab is stored as the place's goods (the place holds one more of it, and the Storage tab lists it) and no thing is made",
    g3.found && !!stored && same(await raw(), thingsAfterHazards) && s7.storageText.includes(NAMES.goods),
    { items: [itemsBefore.length, stored?.length], things: [kindsBefore + 2, (await raw()).length], storageHasName: s7.storageText.includes(NAMES.goods) },
  );
  note("every drop on the tab was a synthetic drop event dispatched inside the Things here section", true);

  section("Judge 8: a derived thing");
  note("SKIP: derivedInputs answers no doors and no old-style trap zones, so no 'From the map' row can be walked", derived);

  // ----------------------------------------------------------------------------------------------
  section("Judge 9: the screen's aside");
  await run(gm, P.closeSheet, { placeId });
  await run(gm, P.shapePlace, { placeId, things: BASE });
  await gm.retire(MARKS.pot, "Cards");
  const sources = LETTER ? [{ thing: K.fx, letters: [LETTER] }] : [];
  const opened = await run(gm, P.openSession, { fid, placeUuid, sceneId, sources, die: 0.025 });
  if (!opened.ok) blocked(`open refused: ${opened.reason}`);
  if (opened.potUuid) { own.pot = gm.track(opened.potUuid, "Cards"); await gm.mark(opened.potUuid, MARKS.pot); }
  const bodies = await run(gm, P.addBody, { fid, id: "qa-body", name: NAMES.body });
  const lotLayer = opened.lots.find((x) => x.thing === K.fx)?.layer ?? null;
  note("the session's dealt lots (key, layer)", opened.lots.map((x) => [x.key, x.layer]));
  const winOpen = await run(gm, P.openScreen, { fid });
  const emptyWord = await sayK("screen.empty");
  let sc = await run(gm, P.screenSnap, { fid });
  if (!winOpen.rendered || !sc) blocked("the Judge's scene screen did not render");
  check(
    "with no entry selected the screen's left aside says to open one and holds no field",
    sc.aside && sc.asideText.includes(emptyWord) && !sc.asideHasRail && sc.asideControls === 0 && sc.cards.length >= 3 && bodies.includes("qa-body"),
    { aside: sc.asideText.slice(0, 80), cards: sc.cards.map((c) => c.key) },
  );
  await run(gm, P.clickIn, { kind: "screen", placeId, fid, sel: `.acks-extras-ss-card[data-drop-entry="${K.fx}"] .acks-extras-ss-keybtn` });
  const rA = await untilRail("screen", "fixture-1");
  sc = await run(gm, P.screenSnap, { fid });
  const fxCard = sc.cards.find((c) => c.key === K.fx);
  check(
    "pressing the fixture card's name selects it (outlined, pressed) and fills the aside with the same fields the tab showed, in the same order",
    !!rA && fxCard?.selected && fxCard.pressed === "true" && orderOf(rA) === orderWant && sc.cards.filter((c) => c.selected).length === 1,
    { order: rA && orderOf(rA) },
  );
  const asideHint = "QA aside hint";
  await field("screen", "hint", null, asideHint);
  l = await waitRaw((x) => byId(x, "fixture-1")?.hint === asideHint);
  check("a field written in the aside (the hint) changes the place's list, with the sentinel kept", !!l && sentinelKept(l), { hint: byId(l, "fixture-1")?.hint });
  await untilRail("screen", "fixture-1", { pred: (r) => ctl(r, "hint")?.value === asideHint });
  await field("screen", "hidden", null, true);
  l = await waitRaw((x) => byId(x, "fixture-1")?.hidden === true);
  const cardHidden = await until(async () => { const s = await run(gm, P.screenSnap, { fid }); return s?.cards.find((x) => x.key === K.fx)?.hidden ? s : null; });
  await untilRail("screen", "fixture-1", { pred: (r) => ctl(r, "hidden")?.value === true });
  await field("screen", "hidden", null, false);
  await waitRaw((x) => byId(x, "fixture-1")?.hidden === false);
  const cardShown = await until(async () => { const s = await run(gm, P.screenSnap, { fid }); return s?.cards.find((x) => x.key === K.fx)?.hidden === false ? s : null; });
  check("a field written in the aside changes the card too: ticking Hidden marks the fixture's card hidden, and unticking clears it", !!l && !!cardHidden && !!cardShown, { cardHidden: !!cardHidden, cardShown: !!cardShown });
  if (!LETTER) note("SKIP: no treasure letter deals, so no lot is dealt and the dealt-lot check below is not reached", true);
  const rB = await untilRail("screen", "fixture-1", { pred: (r) => ctl(r, "hint")?.value === asideHint });
  const nOnLayer = opened.lots.filter((x) => x.thing === K.fx && x.layer === lotLayer).length;
  const lotsLine = lotLayer ? await sayK(`yields.lots.${nOnLayer === 1 ? "one" : "many"}`, { n: nOnLayer }) : null;
  const lotLegend = lotLayer ? await sayS(`layer.${lotLayer}`) : null;
  const layerNote = rB?.layerNotes.find((f) => f.notes.includes(lotsLine)) ?? null;
  await field("screen", "clue", "methodical", "QA aside clue");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.methodical?.yields?.clue === "QA aside clue");
  await untilRail("screen", "fixture-1");
  await field("screen", "turns", "methodical", "2");
  l = await waitRaw((x) => byId(x, "fixture-1")?.layers?.methodical?.turns === 2);
  const rawText = JSON.stringify(l ?? []);
  if (LETTER) {
    check(
      "the dealt lot shows read-only in the aside under the layer it is hidden by ('N lot is dealt here'), and after writes through the aside (hint, a clue, turns) the stored list holds no `lots` key and no lot key",
      !!lotLayer && !!layerNote && layerNote.legend === lotLegend && !rawText.includes('"lots"') && opened.lots.every((x) => !rawText.includes(x.key)) && sentinelKept(l),
      { layer: lotLayer, note: layerNote?.legend ?? null, lots: opened.lots.map((x) => x.key) },
    );
  }
  await run(gm, P.clickIn, { kind: "screen", placeId, fid, sel: `.acks-extras-ss-card[data-drop-entry="${K.hid}"]` });
  const rC = await untilRail("screen", "hidden-1");
  const scC = await run(gm, P.screenSnap, { fid });
  check("pressing a card itself (not its name) selects it too: the aside now holds the hidden container's rail and only that card is outlined", !!rC && scC.cards.filter((c) => c.selected).map((c) => c.key).join() === K.hid, { selected: scC.cards.filter((c) => c.selected).map((c) => c.key) });
  await run(gm, P.clickIn, { kind: "screen", placeId, fid, sel: `.acks-extras-ss-card[data-drop-entry="body:qa-body"] .acks-extras-ss-keybtn` });
  const bodyNote = await sayK("derived.body");
  const scD = await until(async () => { const s = await run(gm, P.screenSnap, { fid }); return s?.cards.find((c) => c.key === "body:qa-body")?.selected ? s : null; });
  check("selecting a fallen body, a thing the fight's record made, the aside says it is read from elsewhere and holds no field and no button", !!scD && scD.asideText.includes(bodyNote) && scD.asideControls === 0 && scD.asideButtons === 0, { aside: scD?.asideText.slice(0, 120) });
  note("a door has no entry to select while derivedInputs answers none (step 8's skip); the body is the derived entry reached", true);

  // Layout of the aside at two sizes, the fixture selected again.
  await run(gm, P.clickIn, { kind: "screen", placeId, fid, sel: `.acks-extras-ss-card[data-drop-entry="${K.fx}"] .acks-extras-ss-keybtn` });
  await untilRail("screen", "fixture-1");
  const lay1 = await run(gm, P.layoutKey, { fid, width: 900, height: 640, base: "18px" });
  check(
    "at 900 by 640 with the knob at 18px: the header, bar and tray stay inside the window, the keying aside scrolls on its own, and the banner's size grew",
    lay1.head?.ok && lay1.bar?.ok && lay1.tray?.ok && !!lay1.aside && ["auto", "scroll"].includes(lay1.aside.overflowY) && lay1.fontAfter > lay1.fontBefore,
    { win: lay1.win, head: lay1.head, bar: lay1.bar, tray: lay1.tray, aside: lay1.aside, fonts: [lay1.fontBefore, lay1.fontAfter] },
  );
  await run(gm, P.knob, { base: null });
  const lay2 = await run(gm, P.layoutKey, { fid, width: 520, height: 420, base: "22px" });
  check(
    "at 520 by 420 with the knob at 22px: the rail's Remove button can be scrolled to and is then inside the window, the frame or the aside scrolls, and the header stays inside",
    !!lay2.removeAfterScroll?.ok && !!lay2.head?.ok && (["auto", "scroll"].includes(lay2.frame?.overflowY) || ["auto", "scroll"].includes(lay2.aside?.overflowY)),
    { win: lay2.win, remove: lay2.removeAfterScroll, head: lay2.head, frame: lay2.frame, aside: lay2.aside, entries: lay2.entries },
  );
  await run(gm, P.knob, { base: null });

  // ----------------------------------------------------------------------------------------------
  section("Player 10: no tab, no aside");
  const shown = await run(gm, P.showSession, { fid });
  const pSheet = await run(player, P.openSheet, { placeId, tab: "contents" });
  const sP = await run(player, P.sheetSnap, { placeId });
  check(
    "the Player seat's place sheet renders its other tabs and has no Things here tab and no Things here section",
    pSheet.rendered && !!sP && sP.nav.length >= 3 && sP.nav.some((n) => n.tab === "contents") && !sP.nav.some((n) => n.tab === "things") && !sP.section && !sP.tabNames.includes("things"),
    { nav: sP?.nav.map((n) => n.tab), sections: sP?.tabNames },
  );
  const pScreen = await run(player, P.openScreen, { fid });
  const scP = await until(async () => { const s = await run(player, P.screenSnap, { fid }); return s && s.cards.length > 0 ? s : null; }, { tries: 40, every: 300 });
  check(
    "after the Judge shows the scene, the Player seat's screen draws cards and has no aside, no keying control and no select action, and each card's name is text, not a button",
    shown.ok && pScreen.rendered && !!scP && scP.cards.length > 0 && !scP.aside && scP.keyBtns === 0 && scP.selectActions === 0 && scP.cards.every((c) => !c.plateIsButton && c.plate) && !scP.cards.some((c) => c.key === K.hid),
    { cards: scP?.cards.map((c) => [c.key, c.plateIsButton]), aside: scP?.aside },
  );

  // ----------------------------------------------------------------------------------------------
  section("end");
  const ended = await run(gm, P.endSession, { fid });
  const endWord = await run(gm, P.say, { ns: "scene", key: "reason.noSession" });
  const endG = await until(async () => { const s = await run(gm, P.screenSnap, { fid }); return s?.empty === endWord ? s : null; });
  check("ending the session leaves the Judge's screen reading 'No scene search is open' with no aside", ended.ok && !!endG && !endG.aside, { empty: endG?.empty });

  section("console");
  for (const [key, api] of Object.entries({ gm, player })) {
    const drained = await run(api, P.drain);
    const boot = (await run(api, P.boot)).slice(bootBase[key]);
    const named = [...drained.errors, ...boot].filter((e) => /scene-search|keying|location-sheet|place-things|region-place/i.test(e));
    note(`${key}: console errors and page errors since the walk began (any text)`, drained.errors.length + boot.length);
    check(`${key}: no console error, page error or unhandled rejection names a scene-search, keying or place file (the recorder was attached from load)`, named.length === 0, named.slice(0, 3).map((e) => e.slice(0, 160)));
  }

  section("teardown");
  const { swept, wanted } = await teardown();
  check(
    "the run's own documents were swept by tracked id (the pot and any goods the drop stocked), and the kept fixtures stand",
    (swept?.failed ?? []).length === 0 && (swept?.removed ?? []).length === wanted,
    { removed: (swept?.removed ?? []).length, missing: (swept?.missing ?? []).length, failed: (swept?.failed ?? []).length, wanted },
  );
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.log(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  try { if (gm && !tornDown) { section("teardown after a stop"); await teardown(); } } catch (err) { console.error("teardown:", err?.message ?? err); }
  try { if (gm) await run(gm, P.restore); } catch {}
  try { if (player) await run(player, P.restore); } catch {}
  finish();
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
}
