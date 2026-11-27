/**
 * Live check, close-treasure: the three treasure topics still open, one PASS or
 * FAIL for each control the topic changed ("only what changed is checked").
 *
 * T-0803, treasure-deal-choices ccf3ed69, Judge seat: the pot rail's Treasure
 * tables button (`dealTables`, Table style group) is drawn for a seat that may
 * modify world settings and opens the Ruledata Browser on the `treasure` and
 * `magicItemTables` groups; the Browser's group headings (readable label, the
 * id as a hint, the row count, the overridden count), its grouping (the tables
 * the engine reads, and the importer's page reads folded into a collapsed Page
 * reads list with View and Export only) and its reuse of an open window. The
 * expected page reads come from `acksExtras.importer.rawTablesOf`, never from
 * the browser's own grouping. Not exercised: a seat without the permission
 * (needs an Assistant Gamemaster seat and a write to `core.permissions`) and the
 * recipe's edited coin cell (a world-setting write other lanes' deals would read).
 *
 * T-0884, treasure-deal-choices d6c248d3, Judge seat: a searched hoard rolls
 * its magic. A real fight is ended by the tracker's End Combat, the card's
 * Search the scene is a real press, and the pot the scene deals holds rolled
 * magic cards (magic pool with a mask) where a placeholder would carry none.
 * A letter is chosen in page by dealing it under the held die and rolling its
 * magic through `magicRollerFor`; with none that rolls (or no magic tables
 * imported) the topic is UNREACHABLE and no FAIL is printed. The card's own
 * deal choices passed in treasure-deal and are not redone.
 *
 * T-0818, fix-role-side b44c4c72, both seats: in Table mode Open to the table
 * with an undealt list offers the pot (the lair warning first, Open anyway);
 * the Player seat, holding LIMITED on the pile, sees the table-rolls caption
 * and a Deal press worded with the hoard count only; the press relays to the
 * Judge's client, which deals the list, opens the pot keeping the offer's
 * doorway and posts one line authored by the pressing user; a dealt list is
 * recorded, so a Judge's Deal then Open never rolls it twice. The pile's LIMITED
 * level is what the offer writes and is the subject: the Player is not made
 * Owner of it. Not exercised: the Judge logging out (step 6).
 *
 * Fixtures: the pots are the run's own (tracked, swept by id); the fight's
 * scene, party, members, place, Region and body are kept fixtures found by
 * marker (under FIXTURE_OWN every marker carries the run's tag). Gestures: the
 * rail's, the doorway's and the card's controls are real pointer presses where
 * the control is the element under its centre (scripted clicks are named in the
 * log); scripted: the die (held at its floor around the presses that deal), the
 * token move and defeat of the fight's bodies, the pot window's creation (the
 * function the scene control's tool calls). Every figure printed is a boolean
 * or a count; no book word or letter is printed.
 */
import { connect } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, t, note, section, check, checks, clicks, idOf, ready, press, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const NONCE = "ctr" + Math.random().toString(36).slice(2, 7);
const HIT = 0.025;
const BASE = "/modules/acks-extras/scripts/";
// The page functions below name the ruledata Browser's window id, "acks-location-ruledata-browser", as a literal: a page function cannot see module scope.
const MARKS = {
  scene: "treasure/close-scene",
  region: "treasure/close-region",
  place: "treasure/close-place",
  party: "treasure/close-party",
  owner: "treasure/close-owner",
  mate: "treasure/close-mate",
  hostile: "treasure/close-hostile",
};
const NAMES = { scene: "QA Close Scene", region: "QA Close Region", place: "QA Close Place", party: "QA Close Party", owner: "QA Close Owner", mate: "QA Close Mate", hostile: "QA Close Hostile" };
const GOODS = [{ name: "QA Close Trinket", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 30 } }];
const ORIGIN = { x: 400, y: 400 };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  ...K,

  /** The census: who is seated and which Judge is the active one. */
  census: async () => ({
    self: game.user.name,
    active: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]),
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    canSettings: !!game.user.can("SETTINGS_MODIFY"),
  }),
  showChat: async () => { try { ui.sidebar.changeTab("chat", "primary"); } catch { /* already showing */ } await globalThis.__tk.sleep(300); return true; },
  rig: async ({ on }) => {
    const H = globalThis.__tk;
    H.origRandom ??= CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = on ? () => 0.025 : H.origRandom;
    return true;
  },
  /** GM seat: tag every chat message this client creates with the run's nonce, so what the run made can be listed and swept by id. */
  hookChat: async ({ nonce }) => {
    const X = (globalThis.__cc = globalThis.__cc ?? {});
    if (X.hook) return true;
    X.hook = Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); });
    return true;
  },
  unhookChat: async () => {
    const X = globalThis.__cc;
    if (X?.hook) { Hooks.off("preCreateChatMessage", X.hook); X.hook = null; }
    return true;
  },
  /** The run's own chat messages: made by this client (nonce) and naming one of the run's pots, its fight's scene, or the fight's card. */
  mineChat: async ({ nonce, potUuids, potNames, sceneId }) => game.messages.contents
    .filter((m) => m.flags?.world?.qaNonce === nonce)
    .filter((m) => {
      const f = m.flags?.["acks-extras"] ?? {};
      return potUuids.includes(f.treasure?.uuid) || (sceneId && f.treasureSearch?.sceneId === sceneId) || potNames.some((n) => (m.content ?? "").includes(n));
    })
    .map((m) => m.id),

  /* ---- T-0803: the Ruledata Browser ----------------------------------- */
  tablesButton: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    const b = root?.querySelector("[data-action='dealTables']");
    return { rendered: !!root, present: !!b, text: H.text(b), tip: b?.getAttribute("data-tooltip-text") ?? null, inStyleFieldset: !!b?.closest("fieldset"), styleButtons: root?.querySelectorAll("[data-action='dealStyle']").length ?? 0, disabled: !!b?.disabled };
  },
  closeBrowser: async () => {
    const H = globalThis.__tk;
    await foundry.applications.instances.get("acks-location-ruledata-browser")?.close({ animate: false });
    H.rbApp = null;
    return { open: !!foundry.applications.instances.get("acks-location-ruledata-browser") };
  },
  /** What the Browser window holds, read against the importer's own page reads. `docs` are the focused document ids. */
  browserView: async ({ docs, focusAll }) => {
    const H = globalThis.__tk;
    const app = await H.poll(() => { const a = foundry.applications.instances.get("acks-location-ruledata-browser"); return a?.rendered && H.root(a)?.querySelector("details[data-group]") ? a : null; }, { tries: 40, every: 250 });
    if (!app) return { rendered: false };
    await H.sleep(600);
    if (!H.opened.includes(app)) H.opened.push(app);
    const same = H.rbApp ? H.rbApp === app : null;
    H.rbApp = app;
    const root = H.root(app);
    const content = root.querySelector(".window-content") ?? root;
    const L = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    const S = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    const humane = (id) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
    const all = [...root.querySelectorAll("details[data-group]")];
    const out = { rendered: true, same, instances: document.querySelectorAll("#" + "acks-location-ruledata-browser").length, groupCount: all.length, openIds: all.filter((d) => d.open).map((d) => d.dataset.group), groups: {} };
    const cbox = content.getBoundingClientRect();
    for (const docId of docs) {
      const d = all.find((x) => x.dataset.group === docId);
      if (!d) { out.groups[docId] = { present: false }; continue; }
      const sum = d.querySelector(":scope > summary");
      const raw = acksExtras.importer?.rawTablesOf?.(docId) ?? {};
      const entries = L.listEntries().filter((e) => e.docId === docId);
      const readEntries = entries.filter((e) => !e.absent && Array.isArray(raw[e.tableId]) && raw[e.tableId].length > 0);
      const overridden = new Set(entries.filter((e) => S.hasOverride(e.docId, e.tableId)).map((e) => e.tableId)).size;
      const mainRows = [...d.querySelectorAll(":scope > table tbody tr[data-entry-key]")];
      const reads = d.querySelector(":scope > details.page-reads");
      const readRows = reads ? [...reads.querySelectorAll("tr[data-entry-key]")] : [];
      const badge = sum.querySelector(".override-badge");
      const countEl = sum.querySelector("span[data-tooltip-text]:not(.override-badge)");
      const r = d.getBoundingClientRect();
      const readByOk = readRows.every((row) => {
        const entry = readEntries.find((e) => e.key === row.dataset.entryKey);
        if (!entry) return false;
        const want = game.i18n.format("ACKS-LOCATION.browser.readBy", { tables: raw[entry.tableId].map(L.tableLabel).join(", ") });
        return H.text(row.querySelector(".read-by")) === want;
      });
      out.groups[docId] = {
        present: true,
        open: d.open,
        label: H.text(sum.querySelector("strong")),
        labelReadable: H.text(sum.querySelector("strong")) === humane(docId) && H.text(sum.querySelector("strong")) !== docId,
        hintIsId: H.text(sum.querySelector("span.hint")) === docId,
        countOk: H.text(countEl) === `(${mainRows.length})`,
        mainRows: mainRows.length,
        expectEngine: entries.length - readEntries.length,
        expectReads: readEntries.length,
        readRows: readRows.length,
        overridden,
        badgeOk: overridden > 0 ? !!badge && H.text(badge) === game.i18n.format("ACKS-LOCATION.browser.overriddenCount", { n: overridden }) : !badge,
        mainEdit: mainRows.length > 0 && mainRows.every((row) => !!row.querySelector("[data-action='editEntry']") && !!row.querySelector("[data-action='viewEntry']") && !!row.querySelector("[data-action='exportEntry']")),
        readsPresent: !!reads,
        readsOpen: !!reads?.open,
        readsSummaryInteractive: !!reads?.querySelector(":scope > summary a, :scope > summary button"),
        readsSummaryText: H.text(reads?.querySelector(":scope > summary")) === game.i18n.format("ACKS-LOCATION.browser.readsSummary", { n: readEntries.length }),
        readsViewExportOnly: readRows.every((row) => !!row.querySelector("[data-action='viewEntry']") && !!row.querySelector("[data-action='exportEntry']") && !row.querySelector("[data-action='editEntry']") && !row.querySelector("[data-action='revertEntry']") && row.hasAttribute("data-read-only")),
        readByOk,
        readRowsEngineTables: readRows.filter((row) => mainRows.some((m) => m.dataset.entryKey === row.dataset.entryKey)).length,
        inView: r.top < cbox.bottom && r.bottom > cbox.top,
        offset: Math.round(r.top - cbox.top),
      };
    }
    return out;
  },
  /** Open the first docId's Page reads list and read whether its rows are shown. */
  openReads: async ({ docId }) => {
    const H = globalThis.__tk;
    const root = H.root(foundry.applications.instances.get("acks-location-ruledata-browser"));
    const reads = [...root.querySelectorAll("details[data-reads]")].find((d) => d.dataset.reads === docId);
    if (!reads) return { found: false };
    reads.open = true;
    await H.sleep(400);
    return { found: true, open: reads.open, rowsVisible: [...reads.querySelectorAll("tr[data-entry-key]")].every((tr) => tr.getBoundingClientRect().height > 0) };
  },
  /**
   * Drop a reference to no document on a page read and on an engine row, and count the error notices each raises. A drop the row's handler
   * takes fails on the missing document and says so; a page read is outside the drop selector, so it raises none. No override can be written
   * (nothing resolves), so the world is left as found.
   */
  dropOnRead: async ({ docId, key }) => {
    const H = globalThis.__tk;
    const root = H.root(foundry.applications.instances.get("acks-location-ruledata-browser"));
    const read = [...root.querySelectorAll("details[data-reads] tr[data-entry-key]")].find((tr) => tr.dataset.entryKey === key);
    const group = [...root.querySelectorAll("details[data-group]")].find((d) => d.dataset.group === docId);
    const engine = group?.querySelector(":scope > table tbody tr[data-entry-key]");
    const L = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    const S = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    const entry = L.listEntries().find((e) => e.key === key && e.docId === docId);
    if (!read || !entry) return { found: false };
    const original = ui.notifications.error;
    const errors = [];
    ui.notifications.error = function (msg, ...rest) { errors.push(String(msg)); return original.call(this, msg, ...rest); };
    const drop = async (row) => {
      const before = errors.length;
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "RollTable", uuid: "RollTable.qaNoSuchTable" }));
      row.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await H.sleep(900);
      return errors.length - before;
    };
    try {
      const before = S.hasOverride(entry.docId, entry.tableId);
      const onRead = await drop(read);
      const onEngine = engine ? await drop(engine) : null;
      return { found: true, before, after: S.hasOverride(entry.docId, entry.tableId), readErrors: onRead, engineErrors: onEngine };
    } finally {
      ui.notifications.error = original;
    }
  },
  readKeys: async ({ docId }) => {
    const L = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    const raw = acksExtras.importer?.rawTablesOf?.(docId) ?? {};
    return L.listEntries().filter((e) => e.docId === docId && !e.absent && Array.isArray(raw[e.tableId]) && raw[e.tableId].length > 0).map((e) => e.key);
  },
  docsOf: async () => (await import("/modules/acks-extras/scripts/treasure/constants.mjs")).TREASURE_TABLE_DOCS.slice(),

  /* ---- pots (T-0818) ---------------------------------------------------- */
  /** A letter the imported classic table deals under the held die, and one whose magic placeholders roll under it, counted without printing either. */
  probe: async () => {
    const T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    const B = await import("/modules/acks-extras/scripts/importer/treasure-binding.mjs");
    const Hd = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    const D = await import("/modules/acks-extras/scripts/treasure/deal.mjs");
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { imported: false, dealt: null, magic: null };
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    let dealt = null;
    let magic = null;
    let placeholders = 0;
    let rolled = 0;
    let tried = 0;
    try {
      for (const letter of keys) {
        tried++;
        const hoard = await Hd.dealHoard({ letter, style: "classic", toggles: {} });
        if (!dealt && hoard.truths.length > 0) dealt = letter;
        const holds = hoard.truths.filter((x) => x.pool === "magic" && "tableRef" in x);
        if (!magic && holds.length) {
          const out = await D.magicRollerFor({ pot: { deal: { armsSetting: "" } }, style: "classic" })({ letter, truths: hoard.truths });
          const n = out.truths.filter((x) => x.pool === "magic" && !("tableRef" in x) && !!x.mask).length;
          if (n > 0) { magic = letter; placeholders = holds.length; rolled = n; }
        }
        if (dealt && magic) break;
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { imported: true, tried, keys: keys.length, dealt, magic, placeholders, rolled, magicTables: !!acksExtras.magicItems?.starts?.() };
  },
  rename: async ({ potId, name }) => { await game.cards.get(potId).update({ name }); return game.cards.get(potId).name; },
  /** The pot as this seat holds it: its flag, its cards, the Player's level, the doorway messages and the rail's offer controls. */
  potState: async ({ potId, playerId }) => {
    const H = globalThis.__tk;
    const pile = game.cards.get(potId);
    if (!pile) return { gone: true };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    const root = H.root(pile.sheet);
    const doors = game.messages.filter((m) => m.flags?.["acks-extras"]?.treasure?.uuid === pile.uuid);
    const door = doors[0] ?? null;
    const li = door ? document.querySelector(`[data-message-id='${door.id}']`) : null;
    return {
      gone: false,
      name: pile.name,
      phase: f.phase ?? null,
      mode: f.mode ?? null,
      offered: f.offered === true,
      offeredLair: f.offeredLair === true,
      dealt: typeof f.dealt === "string" ? f.dealt.length : (Array.isArray(f.dealt) ? f.dealt.length : f.dealt ? 1 : 0),
      order: (f.order ?? []).length,
      hand: (f.deal?.hand ?? []).map((h) => h.hoards),
      lair: f.deal?.metInLair === true,
      messageId: f.messageId ?? null,
      cards: pile.cards.size,
      cardsDown: pile.cards.contents.filter((c) => c.face === null || c.face === undefined).length,
      playerLimited: playerId ? pile.testUserPermission(game.users.get(playerId), "LIMITED") : null,
      playerObserver: playerId ? pile.testUserPermission(game.users.get(playerId), "OBSERVER") : null,
      doors: doors.length,
      doorId: door?.id ?? null,
      doorRendered: !!li?.querySelector(".acks-extras-treasure-door"),
      doorTurned: H.text(li?.querySelector("[data-field='turned']")),
      warning: !!root?.querySelector("[data-offer-warning]"),
      offeredHint: !!root && H.text(root).includes(game.i18n.localize("ACKS-TREASURE.table.offered")),
    };
  },
  playerSees: async ({ potId }) => {
    const H = globalThis.__tk;
    const got = await H.poll(() => { const p = game.cards.get(potId); return p && p.testUserPermission(game.user, "LIMITED") ? p : null; }, { tries: 60, every: 250 });
    const p = game.cards.get(potId);
    return { has: !!p, limited: !!p?.testUserPermission(game.user, "LIMITED"), observer: !!p?.testUserPermission(game.user, "OBSERVER"), isGM: game.user.isGM, polled: !!got };
  },
  /** Player seat: the offered flag as this client holds it. */
  playerFlag: async ({ potId }) => {
    const f = game.cards.get(potId)?.getFlag("acks-extras", "treasure") ?? {};
    return { offered: f.offered === true, phase: f.phase ?? null, mode: f.mode ?? null };
  },
  waitWaiting: async ({ potId }) => {
    const H = globalThis.__tk;
    const app = await H.poll(() => { const s = H.sheet(potId); return s?.rendered && H.root(s)?.querySelector(".acks-extras-treasure__waiting") ? s : null; }, { tries: 60, every: 250 });
    if (app && !H.opened.includes(app)) H.opened.push(app);
    await H.sleep(300);
    return { found: !!app };
  },
  waitingView: async ({ potId, forbid }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false };
    const btn = root.querySelector("[data-action='tableDeal']");
    const attrs = [...root.querySelectorAll("*")].flatMap((el) => [...el.attributes].filter((a) => /tooltip|label|title|alt/.test(a.name)).map((a) => a.value));
    const hay = H.text(root) + " " + attrs.join(" ");
    return {
      rendered: true,
      caption: H.text(root.querySelector(".acks-extras-treasure__waiting h3")),
      button: H.text(btn),
      disabled: !!btn?.disabled,
      cards: root.querySelectorAll("li[data-card-id]").length,
      rail: !!root.querySelector(".acks-extras-treasure__side, [data-action='dealRun'], [data-action='dealPicker'], [data-action='openTable']"),
      buckets: !!root.querySelector(".acks-extras-treasure__buckets, .acks-extras-treasure__bucket"),
      leaks: forbid.filter((w) => w && hay.includes(w)).length,
    };
  },
  /** The cards the pot's window shows once opened, and whether the waiting panel is gone. */
  openedView: async ({ potId }) => {
    const H = globalThis.__tk;
    await H.poll(() => { const r = H.root(H.sheet(potId)); return r && !r.querySelector(".acks-extras-treasure__waiting") && r.querySelector("li[data-card-id]") ? true : null; }, { tries: 40, every: 250 });
    const root = H.root(H.sheet(potId));
    return { waiting: !!root?.querySelector(".acks-extras-treasure__waiting"), cards: root?.querySelectorAll("li[data-card-id]").length ?? 0 };
  },
  /** The table's deal line: messages whose content carries the expected text, with their author and speaker. */
  dealLine: async ({ potName, playerId, hoards }) => {
    const user = game.users.get(playerId);
    const name = user.character?.name || user.name;
    const text = foundry.utils.escapeHTML(game.i18n.format(hoards === 1 ? "ACKS-TREASURE.table.dealtOne" : "ACKS-TREASURE.table.dealt", { name, n: hoards, pot: potName }));
    const hits = game.messages.contents.filter((m) => (m.content ?? "").includes(text));
    return { count: hits.length, authorIsPlayer: hits.every((m) => (m.author?.id ?? m.author) === playerId), aliasOk: hits.every((m) => m.speaker?.alias === name), ids: hits.map((m) => m.id) };
  },
  waitLine: async ({ potName, playerId, hoards }) => {
    const H = globalThis.__tk;
    const user = game.users.get(playerId);
    const name = user.character?.name || user.name;
    const text = foundry.utils.escapeHTML(game.i18n.format(hoards === 1 ? "ACKS-TREASURE.table.dealtOne" : "ACKS-TREASURE.table.dealt", { name, n: hoards, pot: potName }));
    return { met: !!(await H.poll(() => game.messages.contents.some((m) => (m.content ?? "").includes(text)), { tries: 40, every: 250 })) };
  },
  expectedDoorTurned: async () => game.i18n.format("ACKS-TREASURE.door.turned", { turned: 0, count: 0 }),
  /** Wait until the rail shows a Deal-made card count above `min` and no warning. */
  waitCards: async ({ potId, min }) => {
    const H = globalThis.__tk;
    return { met: !!(await H.poll(() => (game.cards.get(potId)?.cards.size ?? 0) > min, { tries: 60, every: 250 })) };
  },
  hasButton: async ({ potId, sel }) => {
    const H = globalThis.__tk;
    return { present: !!H.root(H.sheet(potId))?.querySelector(sel) };
  },
  waitButton: async ({ potId, sel }) => {
    const H = globalThis.__tk;
    return { present: !!(await H.poll(() => H.root(H.sheet(potId))?.querySelector(sel), { tries: 20, every: 200 })) };
  },
  waitGone: async ({ potId, sel }) => {
    const H = globalThis.__tk;
    return { gone: !!(await H.poll(() => !H.root(H.sheet(potId))?.querySelector(sel), { tries: 20, every: 200 })) };
  },

  /* ---- T-0884: the fight and the search --------------------------------- */
  cSetup: async () => {
    const X = (globalThis.__cc = globalThis.__cc ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.around = await import(`${base}location/places-around.mjs`);
    X.util = await import(`${base}lib/util.mjs`);
    await X.util.primaryGMSettled?.();
    return { primary: !!X.util.isPrimaryGM?.(), api: typeof acksExtras.sceneSearch?.searchHere === "function" };
  },
  cShapeScene: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size };
  },
  cFormationOf: async ({ partyId }) => {
    const X = globalThis.__cc;
    const H = globalThis.__tk;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  cShapeHostile: async ({ id, letter, goods }) => {
    const h = game.actors.get(id);
    const t0 = h.system?.details?.treasure ?? {};
    if ((t0.type ?? "") !== letter || (t0.table ?? "") !== "") await h.update({ "system.details.treasure.type": letter, "system.details.treasure.table": "" });
    if (h.prototypeToken.disposition !== -1 || h.prototypeToken.actorLink) await h.update({ "prototypeToken.disposition": -1, "prototypeToken.actorLink": false });
    const have = new Set(h.items.map((i) => i.name));
    const miss = goods.filter((i) => !have.has(i.name));
    if (miss.length) await h.createEmbeddedDocuments("Item", miss);
    return { letterSet: h.system.details.treasure.type === letter, goods: h.items.size };
  },
  cShapePlace: async ({ placeId }) => {
    const a = game.actors.get(placeId);
    const things = [{ id: "floor-1", kind: "floor", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} }];
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((x) => x.id) };
  },
  cStartShape: async ({ fid, partyId, sceneId, members, at }) => {
    const X = globalThis.__cc;
    const H = globalThis.__tk;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    if (game.combats.some((c) => c.combatants.some((x) => x.actorId === partyId || members.includes(x.actorId)))) return { fight: true };
    await X.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
      if (rec.stance?.pace === "hurried") delete rec.stance.pace;
    });
    const f0 = X.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) await X.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    for (const [n, id] of members.entries()) {
      const f = X.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: at.x + n * 100, y: at.y });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await X.model.addMember(X.model.getFormation(fid), game.actors.get(id), made, { scene });
    }
    for (const id of members) {
      const actor = game.actors.get(id);
      await actor.update({ "system.hp.value": actor.system.hp?.max ?? 8 });
    }
    if (party.getFlag("acks-extras", "turnPlan")) await party.unsetFlag("acks-extras", "turnPlan");
    if (party.getFlag("acks-extras", "sceneSearch")) await party.unsetFlag("acks-extras", "sceneSearch");
    await H.sleep(800);
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    return { fight: false, members: f.members.filter((m) => m?.actorId).map((m) => m.actorId), sceneId: f.sceneId, token: !!token, tokenId: token?.id ?? null, tokenActorId: token?.actorId ?? null, plan: party.getFlag("acks-extras", "turnPlan") ?? null, session: party.getFlag("acks-extras", "sceneSearch") ?? null };
  },
  cCentre: async ({ fid }) => {
    const X = globalThis.__cc;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const { tokenCentre } = await import("/modules/acks-extras/scripts/lib/token-centre.mjs");
    const c = tokenCentre(token, scene, token._source ?? token);
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y };
  },
  cShapeRegion: async ({ uuid, rect }) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  cLinkPlace: async ({ regionUuid, placeId }) => {
    const X = globalThis.__cc;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  cPlacesAt: async ({ fid }) => {
    const X = globalThis.__cc;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    if (!token) return { token: false, places: 0 };
    return { token: true, places: X.around.placesAround(token, token.parent).length };
  },
  cStartFight: async ({ combatId, start = null }) => {
    const c = game.combats.get(combatId);
    if (!c) return { found: false };
    if (start === "update") await c.update({ round: 1, turn: 0 });
    return { found: true, started: !!c.started, rows: c.combatants.length };
  },
  cDefeat: async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return { found: false };
    await c.update({ defeated: true });
    await c.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: true });
    return { found: true, isDefeated: !!c.isDefeated };
  },
  cView: async ({ combatId, viewScene = null }) => {
    const H = globalThis.__tk;
    const combat = game.combats.get(combatId);
    try { ui.sidebar.changeTab("combat", "primary"); } catch { /* already showing */ }
    if (viewScene) { try { await game.scenes.get(viewScene)?.view(); } catch { /* no canvas */ } }
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && !ui.combat.element?.querySelector?.("li.combatant"); n++) await H.sleep(150);
    return { viewed: ui.combat.viewed?.id ?? null, rows: ui.combat.element?.querySelectorAll?.("li.combatant").length ?? 0, endButton: !!ui.combat.element?.querySelector?.("[data-action='endCombat']") };
  },
  cCombatGone: async ({ combatId }) => !!(await globalThis.__tk.poll(() => !game.combats.get(combatId), { tries: 60, every: 250 })),
  /** The fight's card on this seat: its id, whether it is rendered, the bodies it lists, its recorded deal and its button. */
  cCard: async ({ combatId }) => {
    const H = globalThis.__tk;
    const m = game.messages.find((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId);
    const li = m ? document.querySelector(`[data-message-id='${m.id}']`) : null;
    const flag = m?.flags?.["acks-extras"]?.treasureSearch ?? null;
    return {
      inCollection: !!m,
      id: m?.id ?? null,
      rendered: !!li,
      sceneId: flag?.sceneId ?? null,
      fallen: (flag?.fallen ?? []).length,
      withLetter: (flag?.fallen ?? []).filter((e) => !!e.letter).length,
      deal: flag?.deal ? { style: flag.deal.style ?? null, special: flag.deal.special === true, metInLair: flag.deal.metInLair === true } : null,
      button: !!li?.querySelector("[data-action='searchScene']"),
      opened: flag?.opened === true,
    };
  },
  cSession: async ({ partyId }) => {
    const f = game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ?? null;
    return f ? { open: true, potUuid: f.potUuid ?? null, bodies: (f.bodies ?? []).length } : { open: false };
  },
  cWaitSession: async ({ partyId, tries = 80 }) => !!(await globalThis.__tk.poll(() => (game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ? true : null), { tries, every: 250 })),
  cWaitPot: async ({ potUuid }) => {
    const H = globalThis.__tk;
    const met = async () => ((await fromUuid(potUuid))?.getFlag("acks-extras", "treasure")?.phase === "open");
    return { met: !!(await H.poll(met, { tries: 60, every: 250 })) };
  },
  /** The searched pot's magic: how many cards are magic, how many carry a mask (rolled) and how many carry none (a placeholder). */
  cPotMagic: async ({ potUuid }) => {
    const pile = await fromUuid(potUuid);
    if (!pile) return { found: false };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    const cards = pile.cards.contents.map((c) => c.getFlag("acks-extras", "card") ?? {});
    const magic = cards.filter((x) => x.pool === "magic");
    return {
      found: true,
      phase: f.phase ?? null,
      origin: f.origin?.kind ?? null,
      style: f.deal?.style ?? null,
      cards: cards.length,
      magic: magic.length,
      rolled: magic.filter((x) => !!x.mask).length,
      placeholders: magic.filter((x) => !x.mask).length,
      withSource: magic.filter((x) => !!(x.source?.data || x.source?.uuid)).length,
      allFaceDown: pile.cards.contents.every((c) => c.face === null || c.face === undefined),
    };
  },
  cEndSession: async ({ fid }) => { try { const r = await acksExtras.sceneSearch.end(fid); return { ok: r?.ok === true }; } catch { return { ok: false }; } },
  cCloseScreen: async ({ fid }) => { const app = foundry.applications.instances.get(`acks-extras-scene-search-${fid}`); if (app) await app.close({ animate: false }); return true; },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
let gm = null;
let player = null;
const made = [];
const own = { pots: [], potNames: [], sceneId: null };
let rigged = false;
watchdog(() => [gm, player], Number(process.env.WALK_WALL_MS ?? 560_000));

const trackPot = (uuid) => { const u = gm.track(uuid, "Cards"); made.push(u); own.pots.push(uuid); return u; };
const claim = async () => {
  const ids = await run(gm, P.mineChat, { nonce: NONCE, potUuids: own.pots, potNames: own.potNames, sceneId: own.sceneId });
  for (const id of ids) {
    const u = gm.track(id, "ChatMessage");
    if (!made.includes(u)) made.push(u);
  }
  return ids.length;
};
const rig = async (on) => { await run(gm, P.rig, { on }); rigged = on; };
/** Run one topic: a throw inside it is one FAIL and the next topic still runs. */
async function topic(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`SECTION ERROR (${name}):`, err?.stack ?? err);
    check(`${name} ran to its end`, false, String(err?.message ?? err).slice(0, 200));
  }
}
const pressGm = (potId, sel, label) => press(gm, PORTS.gm, { scope: "sheet", potId, sel }, label);

try {
  section("seats and census");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const seatG = await run(gm, K.install, { lang: "ACKS-TREASURE" });
  const seatP = await run(player, K.install, { lang: "ACKS-TREASURE" });
  const census = await run(gm, P.census);
  note("census (users seated: name, isGM)", census.active);
  note("active GM", census.activeGM);
  note("the GM seat is the active GM", census.activeGMIsSelf);
  if (!census.activeGMIsSelf) note("NOTE: another GM client is the active GM; the die rigged on the GM seat does not reach the relayed deal, and the relayed deal runs on that client", census.activeGM);
  if (seatP.isGM || seatP.role > 2) throw new Error("the player seat is not a player");
  check("the GM seat is a Judge that may modify world settings and the Player seat is a player with a GM to reach", seatG.isGM && census.canSettings && !seatP.isGM && seatP.activeGM && seatP.socketlib, { gm: seatG.role, player: seatP.role });
  await run(gm, P.hookChat, { nonce: NONCE });
  const playerId = await run(gm, K.userId, { name: MACHINE.player });
  const probe = await run(gm, P.probe);
  note("probe (counts only)", { imported: probe.imported, types: probe.keys, tried: probe.tried, dealtFound: !!probe.dealt, magicRollsFound: !!probe.magic, magicTables: probe.magicTables, placeholders: probe.placeholders, rolled: probe.rolled });

  /* =============== T-0803: the Browser, opened from the pot =============== */
  await topic("T-0803", async () => {
    section("T-0803. the Treasure tables button and the Ruledata Browser");
    await run(gm, P.closeBrowser);
    const pot = await run(gm, K.newPot);
    if (!pot) throw new Error("no pot window opened on the GM seat");
    trackPot(pot.uuid);
    own.potNames.push(pot.name);
    const docs = await run(gm, P.docsOf);
    const wantLabel = await t(gm, "deal.tables");
    const wantTip = await t(gm, "deal.tip.tables", { cite: await t(gm, "cite.deal") });
    const b = await run(gm, P.tablesButton, { potId: pot.potId });
    check("the Treasure tables button is drawn under Table style on the staged pot's rail, with its label and its tooltip from the lang file", b.rendered && b.present && b.inStyleFieldset && b.styleButtons > 0 && !b.disabled && b.text === wantLabel && b.tip === wantTip, { present: b.present, fieldset: b.inStyleFieldset, label: b.text === wantLabel, tip: b.tip === wantTip });
    const pressed = await pressGm(pot.potId, "[data-action='dealTables']", "Treasure tables");
    const v = await run(gm, P.browserView, { docs });
    check("pressing it opens the Ruledata Browser window", pressed.found && v.rendered && v.instances === 1, { real: pressed.real, instances: v.instances });
    const present = docs.filter((d) => v.groups?.[d]?.present);
    note("focused groups present in the Browser (a document not imported has no group)", { named: docs.length, present: present.length, groups: v.groupCount });
    check("the treasure group stands in the Browser and every focused group that stands is open", present.includes("treasure") && present.every((d) => v.groups[d].open), { present, open: v.openIds.length });
    check("every group that is not focused is collapsed, and the first focused group is in view", v.openIds.every((id) => docs.includes(id)) && present.length > 0 && v.groups[present[0]].inView, { others: v.groupCount - present.length, openOthers: v.openIds.filter((id) => !docs.includes(id)).length, offset: v.groups[present[0]]?.offset });
    for (const d of present) {
      const g = v.groups[d];
      check(`group ${d}: the heading is the id made readable, the id stands as the hint, and the count is the rows the engine reads`, g.labelReadable && g.hintIsId && g.countOk && g.mainRows === g.expectEngine, { label: g.labelReadable, hint: g.hintIsId, count: g.countOk, rows: g.mainRows, expected: g.expectEngine });
      check(`group ${d}: the override badge reads the number of overridden tables (${g.overridden}) and is absent at none`, g.badgeOk, { overridden: g.overridden });
    }
    // Page reads: the membership comes from the importer's rawTablesOf, not from the Browser's grouping.
    const withReads = present.filter((d) => v.groups[d].expectReads > 0);
    note("documents whose page reads the importer holds (rawTablesOf)", { docs: withReads.length, reads: withReads.map((d) => v.groups[d].expectReads) });
    for (const d of present) {
      const g = v.groups[d];
      if (!g.expectReads) {
        check(`group ${d}: no page read is held for it, so no Page reads list is drawn and every row is an engine row with Edit`, !g.readsPresent && g.readRows === 0 && g.mainEdit, { reads: g.readsPresent, mainEdit: g.mainEdit });
        continue;
      }
      check(`group ${d}: the page reads fold into a collapsed Page reads list whose summary holds no control and whose row count is the importer's`, g.readsPresent && !g.readsOpen && !g.readsSummaryInteractive && g.readsSummaryText && g.readRows === g.expectReads && g.readRowsEngineTables === 0, { open: g.readsOpen, interactive: g.readsSummaryInteractive, rows: g.readRows, expected: g.expectReads, overlap: g.readRowsEngineTables });
      const opened = await run(gm, P.openReads, { docId: d });
      check(`group ${d}: opening the list shows each row with View and Export, no Edit and no revert, marked read-only, naming the tables the deal reads`, opened.found && opened.open && opened.rowsVisible && g.readsViewExportOnly && g.readByOk, { rowsVisible: opened.rowsVisible, viewExport: g.readsViewExportOnly, readBy: g.readByOk });
      check(`group ${d}: the engine rows keep View, Export and Edit`, g.mainEdit, { rows: g.mainRows });
      const keys = await run(gm, P.readKeys, { docId: d });
      const dropped = keys.length ? await run(gm, P.dropOnRead, { docId: d, key: keys[0] }) : { found: false };
      check(`group ${d}: a drop on a page read is not taken (no notice, no override), where the same drop on an engine row is taken by its handler (its refusal notice)`, dropped.found && dropped.before === dropped.after && dropped.readErrors === 0 && dropped.engineErrors > 0, dropped);
    }
    // A second press with the browser open brings it forward and opens no second window.
    const again = await pressGm(pot.potId, "[data-action='dealTables']", "Treasure tables, again");
    const v2 = await run(gm, P.browserView, { docs });
    check("pressing the button again with the Browser open reuses that window: one instance, the same object, and the groups still focused", again.found && v2.rendered && v2.instances === 1 && v2.same === true && v2.groupCount === v.groupCount, { instances: v2.instances, same: v2.same, real: again.real });
    note("not exercised: a seat without the settings permission draws no button (needs an Assistant Gamemaster seat and a write to core.permissions); the recipe's edited coin cell and its deal (a world-setting write that other lanes' deals would read)", "unreached");
    await run(gm, P.closeBrowser);
    await run(gm, K.closeAll);
  });

  /* =============== T-0818: Table mode, the offer and the deal ============== */
  await topic("T-0818", async () => {
    section("T-0818. Table mode: the offer, the seat's Deal, the dealt list");
    if (!probe.imported || !probe.dealt) {
      note("T-0818", "UNREACHABLE: no treasure type in the imported classic table deals a card under the held die");
      return;
    }
    const LETTER = probe.dealt;
    const stepHand = async (potId) => {
      await pressGm(potId, "[data-action='setMode'][data-mode='table']", "Table");
      await sleep(900);
      await pressGm(potId, "[data-action='dealPicker'][aria-expanded]", "+ Add treasure type");
      await sleep(700);
      await pressGm(potId, `[data-action='dealPick'][data-letter=${JSON.stringify(LETTER)}]`, "pick the type");
      await sleep(900);
      await pressGm(potId, ".acks-extras-treasure__picker [data-action='dealPicker']", "Done");
      await sleep(600);
    };
    const makePot = async (label) => {
      await run(gm, K.closeAll);
      const pot = await run(gm, K.newPot);
      if (!pot) throw new Error("no pot window opened on the GM seat");
      const name = `QA Close ${label} ${NONCE}`;
      await run(gm, P.rename, { potId: pot.potId, name });
      trackPot(pot.uuid);
      own.potNames.push(name);
      return { ...pot, name };
    };

    /* ---- pot 1: offered, then dealt by the Player seat ---- */
    const p1 = await makePot("offer");
    await stepHand(p1.potId);
    const s0 = await run(gm, P.potState, { potId: p1.potId, playerId });
    check("the pot is in Table mode, staging, with one by-hand hoard listed, Met in their lair off and nothing dealt", s0.mode === "table" && s0.phase === "staging" && s0.hand.length === 1 && s0.hand[0] === 1 && !s0.lair && s0.cards === 0 && s0.dealt === 0, { mode: s0.mode, hand: s0.hand, lair: s0.lair, cards: s0.cards, dealt: s0.dealt });
    await run(gm, P.showChat);
    await pressGm(p1.potId, "aside [data-action='openTable']", "Open to the table");
    await sleep(900);
    const s1 = await run(gm, P.potState, { potId: p1.potId, playerId });
    check("Open to the table with an undealt list and the lair off shows the lair warning with Open anyway and Cancel: the pot is still staging, not offered, and holds no card", s1.warning && s1.phase === "staging" && !s1.offered && s1.order === 0 && s1.cards === 0 && s1.doors === 0, { warning: s1.warning, phase: s1.phase, offered: s1.offered, doors: s1.doors });
    await pressGm(p1.potId, "[data-offer-warning] [data-action='offerCancel']", "Cancel");
    await sleep(900);
    const s2 = await run(gm, P.potState, { potId: p1.potId, playerId });
    check("Cancel clears the warning and offers nothing", !s2.warning && !s2.offered && s2.doors === 0, { warning: s2.warning, offered: s2.offered });
    await pressGm(p1.potId, "aside [data-action='openTable']", "Open to the table again");
    await sleep(900);
    await pressGm(p1.potId, "[data-offer-warning] [data-action='offerConfirm']", "Open anyway");
    await sleep(1500);
    const s3 = await run(gm, P.potState, { potId: p1.potId, playerId });
    check("Open anyway offers the pot: the flag reads staging, offered and offeredLair, order empty, no card dealt, and the Player's level on the pile is LIMITED (not OBSERVER)", s3.phase === "staging" && s3.offered && s3.offeredLair && s3.order === 0 && s3.cards === 0 && s3.playerLimited === true && s3.playerObserver === false, { phase: s3.phase, offered: s3.offered, lair: s3.offeredLair, order: s3.order, cards: s3.cards, limited: s3.playerLimited, observer: s3.playerObserver });
    check("one doorway card stands in chat, reading no cards turned (the offer's own), and the rail says the pot is offered", s3.doors === 1 && s3.doorRendered && s3.doorTurned === (await run(gm, P.expectedDoorTurned)) && s3.offeredHint, { doors: s3.doors, rendered: s3.doorRendered, turned: s3.doorTurned === (await run(gm, P.expectedDoorTurned)) });
    await pressGm(p1.potId, "aside [data-action='openTable']", "Open to the table (offered)");
    await sleep(1000);
    const s3b = await run(gm, P.potState, { potId: p1.potId, playerId });
    check("pressing Open to the table on the offered pot posts nothing: still one doorway card, still staging", s3b.doors === 1 && s3b.phase === "staging" && s3b.offered, { doors: s3b.doors, phase: s3b.phase });
    const doorId = s3.doorId;

    // The Player seat.
    const seen = await run(player, P.playerSees, { potId: p1.potId });
    check("the Player seat holds the pile at LIMITED, not OBSERVER, and is not a Judge", seen.has && seen.limited && !seen.observer && !seen.isGM, seen);
    const flagP = await run(player, P.playerFlag, { potId: p1.potId });
    check("the Player's client reads the pot as offered, in Table mode, still staging", flagP.offered && flagP.phase === "staging" && flagP.mode === "table", flagP);
    await run(player, P.showChat);
    const door = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${doorId}'] [data-action='openTable']` }, "the doorway's Open the table");
    if (!door.found) await run(player, K.rerender, { potId: p1.potId }).catch(() => null);
    if (!door.found) await run(player, async ({ potId }) => { await game.cards.get(potId).sheet.render(true); return true; }, { potId: p1.potId });
    note("the doorway's button was found on the Player seat (else the sheet is rendered through the API)", door.found);
    const waited = await run(player, P.waitWaiting, { potId: p1.potId });
    const forbid = [await t(gm, "search.letter", { letter: LETTER })];
    const wv = await run(player, P.waitingView, { potId: p1.potId, forbid });
    const wantCaption = await t(gm, "table.waiting");
    const wantBtn = await t(gm, "deal.runOne", { n: 1 });
    check("the Player's window shows the table-rolls caption and one Deal press worded with the hoard count only, enabled", waited.found && wv.rendered && wv.caption === wantCaption && wv.button === wantBtn && !wv.disabled, { caption: wv.caption === wantCaption, button: wv.button === wantBtn, disabled: wv.disabled });
    check("that window holds no card, no bucket, no rail and no treasure type text, in its text or its tooltips", wv.cards === 0 && !wv.rail && !wv.buckets && wv.leaks === 0, { cards: wv.cards, rail: wv.rail, buckets: wv.buckets, leaks: wv.leaks });

    // The Player's press, with the die held on the GM page (the Judge's client deals).
    await rig(true);
    let press1;
    try {
      press1 = await press(player, PORTS.player, { scope: "sheet", potId: p1.potId, sel: "[data-action='tableDeal']" }, "Deal 1 hoard (Player)");
      const done = await run(player, K.waitState, { potId: p1.potId, until: "phase", phase: "open" });
      press1.done = done.met;
    } finally {
      await rig(false);
    }
    await sleep(1200);
    const g1 = await run(gm, P.potState, { potId: p1.potId, playerId });
    const pf = await run(player, K.stage, { potId: p1.potId });
    check("the Player's press relayed to the Judge's client: the pot is open, no longer offered, its order holds the dealt cards face down, and the list is recorded as dealt", press1.found && press1.done && g1.phase === "open" && !g1.offered && g1.order > 0 && g1.cards === g1.order && g1.cardsDown === g1.cards && g1.dealt > 0, { real: press1.real, phase: g1.phase, order: g1.order, cards: g1.cards, dealt: g1.dealt });
    check("the doorway card is the one posted at the offer: the pot's messageId is unchanged and no second doorway was posted", g1.messageId === doorId && g1.doors === 1, { same: g1.messageId === doorId, doors: g1.doors });
    check("the Player's client reads the same: open, its order and its cards", pf.phase === "open" && pf.order.length === g1.order && pf.cards.length === g1.cards, { phase: pf.phase, order: pf.order.length });
    const line = await run(player, P.waitLine, { potName: p1.name, playerId, hoards: 1 });
    const l1 = await run(player, P.dealLine, { potName: p1.name, playerId, hoards: 1 });
    check("exactly one line was posted for the deal, authored by the Player and spoken as the character's name (else the user's)", line.met && l1.count === 1 && l1.authorIsPlayer && l1.aliasOk, { count: l1.count, author: l1.authorIsPlayer, alias: l1.aliasOk });
    const ov = await run(player, P.openedView, { potId: p1.potId });
    check("the Player's window now shows the face-down cards and no waiting panel", !ov.waiting && ov.cards === g1.cards, ov);
    await claim();

    /* ---- pot 2: the Judge deals, then Opens: the list is not rolled twice ---- */
    const p2 = await makePot("dealt");
    await stepHand(p2.potId);
    await pressGm(p2.potId, "[data-action='dealLair']", "Met in their lair");
    await sleep(900);
    await rig(true);
    try {
      await pressGm(p2.potId, "aside [data-action='dealRun']", "Deal");
      await run(gm, P.waitCards, { potId: p2.potId, min: 0 });
    } finally {
      await rig(false);
    }
    await sleep(1000);
    const d0 = await run(gm, P.potState, { potId: p2.potId, playerId });
    check("on a second Table-mode pot the Judge's Deal deals the list (lair on, so no warning): cards staged and the list recorded as dealt, the pot still staging", d0.mode === "table" && d0.lair && d0.cards > 0 && d0.dealt > 0 && d0.phase === "staging" && !d0.warning, { cards: d0.cards, dealt: d0.dealt, phase: d0.phase, warning: d0.warning });
    await pressGm(p2.potId, "aside [data-action='openTable']", "Open to the table (dealt list)");
    await run(gm, K.waitState, { potId: p2.potId, until: "phase", phase: "open" });
    await sleep(1000);
    const d1 = await run(gm, P.potState, { potId: p2.potId, playerId });
    check("Open to the table on the dealt list opens the pot at once: it is not offered, no lair warning stood, and it rolled nothing again (the card count is unchanged)", d1.phase === "open" && !d1.offered && d1.cards === d0.cards && d1.order === d0.cards, { phase: d1.phase, offered: d1.offered, before: d0.cards, after: d1.cards });
    check("it posted one doorway card, as an ordinary Open does", d1.doors === 1 && d1.messageId === d1.doorId, { doors: d1.doors });
    await claim();
    await run(gm, K.closeAll);
    await run(player, K.closeAll);
    note("not exercised: the Judge logged out with an offered pot open (step 6)", "unreached");
  });

  /* =============== T-0884: a searched hoard rolls its magic ============== */
  await topic("T-0884", async () => {
    section("T-0884. a searched hoard rolls its magic");
    if (!probe.imported || !probe.magic) {
      note("T-0884", `UNREACHABLE: no treasure type's magic rolls under the held die (imported ${probe.imported}, magic tables ${probe.magicTables}), so the check would prove nothing either way`);
      return;
    }
    const LETTER = probe.magic;
    const setG = await run(gm, P.cSetup);
    if (!setG.primary || !setG.api) throw new Error(`the GM seat is not the primary GM or has no scene search api (primary ${setG.primary}, api ${setG.api})`);
    const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, details: { level: 1 } } });
    const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
    const sceneId = idOf(scene);
    own.sceneId = sceneId;
    await run(gm, P.cShapeScene, { sceneId });
    const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party", ownership: { default: 0 } });
    const ownerA = await gm.fixture(MARKS.owner, "Actor", { ...character(NAMES.owner), ownership: { default: 0 } });
    const mate = await gm.fixture(MARKS.mate, "Actor", { ...character(NAMES.mate), ownership: { default: 0 } });
    const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location" });
    const hostile = await gm.fixture(MARKS.hostile, "Actor", { name: NAMES.hostile, type: "monster", items: GOODS, prototypeToken: { actorLink: false, disposition: -1 } });
    const partyId = idOf(party);
    const placeId = idOf(place);
    const { fid, error } = await run(gm, P.cFormationOf, { partyId });
    if (error) throw new Error(error);
    await run(gm, P.cEndSession, { fid });
    const shapedH = await run(gm, P.cShapeHostile, { id: idOf(hostile), letter: LETTER, goods: GOODS });
    const placed = await run(gm, P.cShapePlace, { placeId });
    const shape = await run(gm, P.cStartShape, { fid, partyId, sceneId, members: [idOf(ownerA), idOf(mate)], at: ORIGIN });
    if (shape.fight) throw new Error("a combat holds the walk's party or its members; it is another session's and is not swept here");
    const where = await run(gm, P.cCentre, { fid });
    if (!where.token || where.sceneId !== sceneId) throw new Error("the party token is not on the walk's scene");
    const rect = { x: where.cx - 300, y: where.cy - 200, width: 600, height: 400 };
    const region = await gm.fixture(MARKS.region, "Region", { name: NAMES.region, color: "#336699", shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
    const rs = await run(gm, P.cShapeRegion, { uuid: region.uuid, rect });
    const linked = await run(gm, P.cLinkPlace, { regionUuid: region.uuid, placeId });
    const at0 = await run(gm, P.cPlacesAt, { fid });
    check("the fight's fixtures stand: the body carries the chosen letter and a good, the place has its floor and is linked to the Region, the party holds both members with its token inside the Region and no session", shapedH.letterSet && placed.things.join() === "floor-1" && rs.shapes === 1 && linked.linked && shape.members.length === 2 && shape.sceneId === sceneId && shape.token && !shape.session && at0.places === 1, { letterSet: shapedH.letterSet, linked: linked.linked, members: shape.members.length, places: at0.places });
    const partyToken = { tokenId: shape.tokenId, actorId: shape.tokenActorId };

    // A real fight on the scene, ended by the tracker's own End Combat.
    const tok = await gm.create("Token", { name: NAMES.hostile, actorId: idOf(hostile), actorLink: false, x: 1000, y: 400, disposition: -1 }, { parent: `Scene.${sceneId}` });
    made.push(tok.uuid);
    const combat = await gm.create("Combat", { scene: sceneId, active: false });
    made.push(combat.uuid);
    const combatId = idOf(combat);
    const row0 = await gm.create("Combatant", { tokenId: partyToken.tokenId, sceneId, actorId: partyToken.actorId }, { parent: combat.uuid });
    made.push(row0.uuid);
    const rowH = await gm.create("Combatant", { tokenId: idOf(tok), sceneId, actorId: idOf(hostile) }, { parent: combat.uuid });
    made.push(rowH.uuid);
    await run(gm, P.showChat);
    let view = await run(gm, P.cView, { combatId });
    let viewedNeeded = false;
    if (view.viewed !== combatId) { view = await run(gm, P.cView, { combatId, viewScene: sceneId }); viewedNeeded = true; }
    if (view.viewed !== combatId) throw new Error("the tracker does not show this run's combat");
    const begin = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='startCombat'], .combat-tracker [data-action='startCombat']" }, "Begin Combat");
    let started = await run(gm, P.cStartFight, { combatId });
    for (let n = 0; n < 16 && !started.started; n++) { await sleep(250); started = await run(gm, P.cStartFight, { combatId }); }
    if (!started.started) { note("Begin Combat did not start the combat (a press was found: " + begin.found + "); the round is written instead", "scripted"); started = await run(gm, P.cStartFight, { combatId, start: "update" }); }
    await run(gm, P.cDefeat, { combatId, combatantId: idOf(rowH) });
    await run(gm, P.showChat);
    const v2 = await run(gm, P.cView, { combatId, viewScene: viewedNeeded ? sceneId : null });
    if (v2.viewed !== combatId || !v2.endButton) throw new Error("the tracker does not show this run's combat with an End Combat button");
    const endPress = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='endCombat'], .combat-tracker [data-action='endCombat']" }, "End Combat");
    let yes = { found: false };
    if (endPress.found) { await sleep(600); yes = await press(gm, PORTS.gm, { scope: "doc", sel: "dialog [data-action='yes'], .application.dialog [data-action='yes']" }, "End Combat's confirm"); }
    const gone = await run(gm, P.cCombatGone, { combatId });
    let card = null;
    for (let n = 0; n < 40; n++) { card = await run(gm, P.cCard, { combatId }); if (card.inCollection && card.rendered) break; await sleep(250); }
    check("End Combat and its confirm were pressed, the combat is gone, and the real hook posted the fight-over card listing the body with its letter and a Search the scene button", endPress.found && yes.found && gone && card.inCollection && card.rendered && card.fallen === 1 && card.withLetter === 1 && card.button && !card.opened, { end: endPress.found, yes: yes.found, gone, fallen: card.fallen, letter: card.withLetter });
    note("the card's recorded deal choices (style, special, lair)", card.deal);

    // Search the scene: a real press, the die held at its floor as the probe held it.
    await run(gm, K.takeNotes);
    await rig(true);
    let sess;
    try {
      const pressed = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${card.id}'] [data-action='searchScene']` }, "the card's Search the scene");
      const opened = await run(gm, P.cWaitSession, { partyId });
      sess = opened ? await run(gm, P.cSession, { partyId }) : { open: false };
      sess.found = pressed.found;
      if (sess.potUuid) trackPot(sess.potUuid);
      if (sess.potUuid) await run(gm, P.cWaitPot, { potUuid: sess.potUuid });
      await sleep(1500);
    } finally {
      await rig(false);
    }
    check("the press opened a scene search for the party with a pot", sess.found && sess.open && !!sess.potUuid, { found: sess.found, open: sess.open });
    const pm = await run(gm, P.cPotMagic, { potUuid: sess.potUuid });
    note("the searched pot's cards (counts): all, magic, rolled (masked), placeholders (unmasked), linked to a document", { cards: pm.cards, magic: pm.magic, rolled: pm.rolled, placeholders: pm.placeholders, withSource: pm.withSource, style: pm.style });
    note("the same letter under the same die, dealt and rolled by magicRollerFor in the probe (placeholders held, rolled)", { placeholders: probe.placeholders, rolled: probe.rolled });
    check("the searched hoard's magic is rolled: the pot holds at least one magic card with a mask where a placeholder carries none, and as many rolled cards as the probe's roll of the same hoard under the same die", pm.found && pm.phase === "open" && pm.origin === "scene" && pm.magic > 0 && pm.rolled >= 1 && pm.rolled === probe.rolled, { rolled: pm.rolled, expected: probe.rolled, magic: pm.magic, placeholders: pm.placeholders });
    check("every magic card in the searched pot is rolled (none is left a placeholder), and the cards are face down", pm.placeholders === 0 && pm.allFaceDown, { placeholders: pm.placeholders, down: pm.allFaceDown });
    await run(gm, P.cEndSession, { fid });
    await run(gm, P.cCloseScreen, { fid });
    await claim();
  });

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, K.drain);
    // The T-0803 step drops a reference to no document on one engine row per group on purpose; the Browser logs its refusal.
    const mine = drained.errors.filter((e) => e.includes("drop: document not found"));
    const stray = drained.errors.filter((e) => !e.includes("drop: document not found"));
    note(`${key}: console errors the run caused itself (its deliberate bad drops, at most one per group)`, mine.length);
    check(`${key}: no other console error recorded since the install (a recorder attached after ready; load-time errors are not covered)`, stray.length === 0 && mine.length <= 2, stray.slice(0, 3).map((e) => e.slice(0, 120)));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { if (rigged) await run(gm, P.rig, { on: false }); } catch {}
    try { await claim(); } catch (err) { console.error("claim:", err?.message ?? err); }
    try { await run(gm, P.unhookChat); } catch {}
  }
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, K.closeAll); } catch {}
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
