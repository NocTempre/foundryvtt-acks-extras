/**
 * Live walk, the character sheet's Followers tab views: docs/character-sheet/TESTING.md "The Followers
 * tab's views". A lord's sheet on its Followers tab is pressed through the view switch (Cards, Org chart,
 * Locations), the chart's folds, Send out through the real button and the place dialog, and Recall from a
 * chart card and from a Locations chip; the Player seat that owns the lord then sends a follower to a
 * place it owns and is refused one it does not. Every observable is the markup a seat reads or the stored
 * roster a press wrote. Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`), and this walk's own: the `henchmen/service-*`
 * fixtures belong to lib-org-chart.mjs, which reshapes and clears them. `character-sheet/followers-lord`
 * (owned by the Player seat), `-hench-a` (serves the lord), `-hench-b` (serves A), `-officer` (the unit's
 * officer, also on the lord's list), `-unit` (a hired group with one stack), `-monster` (the stack's
 * template), `-place-a` (owned by the Player seat) and `-place-b` (observed, not owned). A step that needs
 * a shape sets it at its start, since a kept fixture carries what the last walk left. Nothing is made
 * beyond the fixtures, so the ledger sweep at the end is of nothing the run built apart from them.
 *
 * Not driven: the Followers tab for a seat that only observes the lord, and a keyboard pass over the chart.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const OBSERVER = 2;
const OWNER = 3;
const NARROW = 460;
const SHORT = 420;
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...list].sort();

/* Page side: each function is stringified and run in a seat's page, so none names a node-side value. */
const P = {
  census: async () => ({
    role: game.user.role,
    isGM: game.user.isGM,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    api: !!(globalThis.acksExtras?.lib?.org && globalThis.acksExtras.lib.groups),
    sheet: !!CONFIG.Actor.sheetClasses.character?.["acks-extras.AcksCharacterSheet"]?.cls,
  }),

  /** Console errors and unhandled rejections recorded from here on, and every warning notice, kept in `__fw`; armed again, it first puts the page back. */
  arm: async () => {
    const old = globalThis.__fw;
    if (old?.armed) {
      console.error = old.consoleError;
      ui.notifications.warn = old.warn;
      globalThis.removeEventListener("error", old.onError);
      globalThis.removeEventListener("unhandledrejection", old.onReject);
    }
    const H = (globalThis.__fw = { armed: true, errors: [], notes: [], sheets: {} });
    H.consoleError = console.error;
    console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError.apply(console, args); };
    H.onError = (e) => H.errors.push(String(e.message).slice(0, 300));
    H.onReject = (e) => H.errors.push(String(e.reason?.message ?? e.reason).slice(0, 300));
    globalThis.addEventListener("error", H.onError);
    globalThis.addEventListener("unhandledrejection", H.onReject);
    H.warn = ui.notifications.warn;
    ui.notifications.warn = function (...args) { H.notes.push(String(args[0])); return H.warn.apply(this, args); };
    return true;
  },

  /** Put the page back, close every sheet the walk opened, and answer what was recorded. */
  disarm: async () => {
    const H = globalThis.__fw;
    if (!H?.armed) return { errors: [], notes: [] };
    for (const app of Object.values(H.sheets)) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    globalThis.removeEventListener("error", H.onError);
    globalThis.removeEventListener("unhandledrejection", H.onReject);
    H.armed = false;
    return { errors: H.errors, notes: H.notes };
  },

  errors: async () => ({ errors: globalThis.__fw?.errors ?? [], notes: globalThis.__fw?.notes ?? [] }),

  /** The fixtures at the shape the recipe names, written whole: the links, the unit and its stack, the rosters, the ownership. Returns what stood before, and what stands now. */
  shape: async (a) => {
    const doc = (id) => game.actors.get(id);
    const [lord, hA, hB, officer, unit, monster, placeA, placeB] = [a.lord, a.a, a.b, a.officer, a.unit, a.monster, a.placeA, a.placeB].map(doc);
    const uid = game.users.find((u) => u.name === a.player)?.id;
    if (!uid) throw new Error(`no user named ${a.player}`);
    const read = () => ({
      lordList: [...lord.system.henchmenList],
      aList: [...hA.system.henchmenList],
      bList: [...hB.system.henchmenList],
      officerList: [...officer.system.henchmenList],
      managers: [hA, hB, officer].map((d) => d.system.retainer.managerid),
      unit: [unit.system.unit.employerUuid, unit.system.unit.officerUuid, unit.system.unit.parentGroupUuid],
      stack: unit.system.stacks.map((s) => [s.template.uuid, s.size.initial, s.size.current, s.roster.length]),
      rosters: [placeA, placeB].map((p) => p.system.roster.map((r) => r.uuid)),
      owners: [lord, placeA, placeB].map((d) => d.ownership[uid] ?? 0),
    });
    const before = read();
    await monster.update({ "system.hp": { hd: "1d4", value: 6, max: 6 } });
    const retainer = (managerid, category) => ({ enabled: true, managerid, category, wage: "5", quantity: 1 });
    await lord.update({ "prototypeToken.actorLink": true, "system.henchmenList": [hA.id, officer.id] });
    await hA.update({ "prototypeToken.actorLink": true, "system.retainer": retainer(lord.id, "henchman"), "system.henchmenList": [hB.id] });
    await hB.update({ "prototypeToken.actorLink": true, "system.retainer": retainer(hA.id, "henchman"), "system.henchmenList": [] });
    await officer.update({ "prototypeToken.actorLink": true, "system.retainer": retainer(lord.id, "specialist"), "system.henchmenList": [] });
    const [s, ...more] = unit.system.toObject().stacks;
    const stackOk = s && !more.length && s.template.uuid === monster.uuid && s.size.current === a.count && s.size.initial === a.count && !s.roster.length;
    if (!stackOk) {
      await unit.update({ "system.stacks": [] });
      await acksExtras.lib.groups.addStack(unit, monster, { count: a.count });
    }
    await unit.update({ "system.unit.employerUuid": lord.uuid, "system.unit.officerUuid": officer.uuid, "system.unit.parentGroupUuid": "", "system.unit.category": "mercenary" });
    await placeA.update({ "system.roster": [], "system.gmNotes": "<p>Walk place A</p>", ownership: { default: 0, [uid]: a.owner } });
    await placeB.update({ "system.roster": [], "system.gmNotes": "<p>Walk place B</p>", ownership: { default: 0, [uid]: a.observer } });
    await lord.update({ ownership: { default: 0, [uid]: a.owner } });
    return { before, after: read(), names: { lord: lord.name, a: hA.name, placeA: placeA.name, placeB: placeB.name } };
  },

  /** The stored state a step reads: the places holding each follower and each place's roster. */
  stored: async (a) => {
    const places = game.actors.filter((p) => p.type === "acks-extras.location" && Array.isArray(p.system.roster));
    const holding = (uuid) => places.filter((p) => p.system.roster.some((r) => r.uuid === uuid)).map((p) => p.uuid);
    return {
      holding: Object.fromEntries(a.uuids.map((u) => [u, holding(u)])),
      rosters: a.places.map((u) => (fromUuidSync(u)?.system.roster ?? []).map((r) => r.uuid)),
      unitParent: fromUuidSync(a.unit)?.system.unit.parentGroupUuid ?? null,
      sheetOpen: a.sheets.map((u) => !!fromUuidSync(u)?.sheet?.rendered),
    };
  },

  /** What a seat can do to the fixtures: it is read, never assumed. */
  perm: async (a) => ({ isGM: game.user.isGM, ownsLord: !!game.actors.get(a.lord)?.isOwner, ownsA: !!fromUuidSync(a.placeA)?.isOwner, ownsB: !!fromUuidSync(a.placeB)?.isOwner, sees: [a.placeA, a.placeB].map((u) => !!fromUuidSync(u)) }),

  /** A fresh sheet of the lord on its Followers tab (the old one of this walk closed), at a width and height where given, then the view pressed where one is named. */
  open: async ({ id, width, height, view }) => {
    const H = globalThis.__fw;
    const old = H.sheets[id];
    if (old) { try { await old.close({ animate: false }); } catch (_e) { /* closed */ } }
    const Sheet = CONFIG.Actor.sheetClasses.character?.["acks-extras.AcksCharacterSheet"]?.cls;
    const app = new Sheet({ document: game.actors.get(id) });
    H.sheets[id] = app;
    app.tabGroups.primary = "followers";
    await app.render({ force: true, ...(width ? { position: { width, height } } : {}) });
    const tab = () => app.element?.querySelector('[data-tab="followers"]');
    for (let n = 0; n < 60 && !tab()?.classList.contains("active"); n++) {
      if (n === 10) app.changeTab("followers", "primary");
      await new Promise((r) => setTimeout(r, 200));
    }
    const ready = !!tab()?.classList.contains("active");
    if (ready && view) await globalThis.__fwPress(id, view);
    return { ready, width: app.position.width, height: app.position.height, offsetWidth: app.element?.offsetWidth ?? null };
  },

  /** The sheet's own re-render, as the sheet does it after a form change. */
  rerender: async ({ id }) => {
    await globalThis.__fw.sheets[id].render();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  },

  /** The tab as drawn: the switch and which button is pressed, the cards and the wage line, and which view's markup stands. */
  tab: async ({ id }) => {
    const tab = globalThis.__fw.sheets[id]?.element?.querySelector('[data-tab="followers"]');
    if (!tab) return null;
    const tools = !!tab.querySelector(".acks-extras-org__tools");
    return {
      active: tab.classList.contains("active"),
      switch: [...tab.querySelectorAll('[data-action="followersView"]')].map((b) => ({ view: b.dataset.view, on: b.getAttribute("aria-pressed") === "true", tip: !!b.dataset.tooltipText })),
      cards: tab.querySelectorAll(".acks-extras-frame__card").length,
      cardIds: [...tab.querySelectorAll(".acks-extras-frame__card")].map((c) => c.dataset.actorId),
      wage: tab.querySelector(".acks-extras-frame__rule-note")?.textContent.trim() ?? null,
      chart: tools && !!tab.querySelector(".acks-extras-org__tree"),
      locations: !tools && !!tab.querySelector("section.acks-extras-org"),
    };
  },

  /** Press a view's button and wait for it to read pressed. */
  press: async ({ id, view }) => globalThis.__fwPress(id, view),

  /** The chart as drawn, from the keys it is given: the tree's shape, the root card, the unit's head, and every control a service card must not draw. */
  tree: async ({ id, keys }) => {
    const tab = globalThis.__fw.sheets[id]?.element?.querySelector('[data-tab="followers"]');
    const tree = tab?.querySelector(".acks-extras-org__tree");
    if (!tree) return null;
    const li = (k) => tree.querySelector(`li[data-key="${k}"]`);
    const kidsOf = (k) => [...(li(k)?.querySelectorAll(":scope > ul > li[data-key]") ?? [])].map((x) => x.dataset.key);
    const card = (k) => li(k)?.querySelector(":scope > .acks-extras-org-card");
    const root = card(keys.lord);
    const banned = ["orgRoll", "orgRollAll", "orgDesign", "orgAdd", "orgAddWarband", "orgRecipe", "orgEdit", "orgRollCount"];
    return {
      keys: [...tree.querySelectorAll("li[data-key]")].map((x) => x.dataset.key),
      kids: { lord: kidsOf(keys.lord), a: kidsOf(keys.a), b: kidsOf(keys.b), unit: kidsOf(keys.unit) },
      expanded: Object.fromEntries([...tree.querySelectorAll("li[data-key][aria-expanded]")].map((x) => [x.dataset.key, x.getAttribute("aria-expanded")])),
      rootRank: root?.querySelector(".acks-extras-org-card__rank")?.textContent.trim() ?? null,
      rootSummary: root?.querySelector(".acks-extras-org-card__foot .cite")?.textContent.trim() ?? null,
      rootTip: root?.querySelector(".acks-extras-org-card__foot .cite")?.dataset.tooltipText ?? null,
      rootControls: root?.querySelectorAll(".acks-extras-org-card__foot button").length ?? null,
      totalTip: tab.querySelector(".hint [data-tooltip]")?.dataset.tooltip ?? null,
      unitHead: [...(card(keys.unit)?.querySelectorAll(".acks-extras-org-card__leader[data-uuid]") ?? [])].map((x) => ({ uuid: x.dataset.uuid, followerCard: !!x.querySelector(".acks-lib-follower-card") })),
      officerNodes: tree.querySelectorAll(`li[data-key="${keys.officer}"]`).length,
      officerAnywhere: tree.querySelectorAll(`[data-uuid="${keys.officer}"]`).length,
      banned: banned.map((action) => [action, tab.querySelectorAll(`[data-action="${action}"]`).length]).filter(([, n]) => n),
      tools: [...tab.querySelectorAll(".acks-extras-org__tools [data-action]")].map((b) => b.dataset.action),
      out: Object.fromEntries([keys.a, keys.unit, keys.b].map((k) => [k, card(k)?.querySelector(".acks-extras-org-card__out")?.textContent.trim() ?? null])),
    };
  },

  /** Press a control by its action: inside the card of a chart key, on a Locations chip's row, or anywhere on the tab. */
  click: async ({ id, where, key, action, wait }) => {
    const tab = globalThis.__fw.sheets[id]?.element?.querySelector('[data-tab="followers"]');
    const scope = where === "card" ? tab?.querySelector(`.acks-extras-org__tree li[data-key="${key}"] > .acks-extras-org-card`) : where === "chip" ? tab?.querySelector(`.acks-extras-org-chip__row[data-key="${key}"]`) : tab;
    const btn = scope?.querySelector(`[data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 700));
    return { pressed: true };
  },

  /** Wait for the open Send out dialog, pick a place by uuid and press its button. */
  sendDialog: async ({ place }) => {
    let dlg = null;
    for (let n = 0; n < 40 && !dlg; n++) {
      dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].find((d) => d.querySelector('select[name="place"]')) ?? null;
      if (!dlg) await new Promise((r) => setTimeout(r, 150));
    }
    if (!dlg) return { answered: false };
    const select = dlg.querySelector('select[name="place"]');
    const options = [...select.options].map((o) => o.value);
    if (!options.includes(place)) {
      dlg.querySelector('[data-action="cancel"], .window-header [data-action="close"]')?.click();
      return { answered: false, listed: false, options: options.length };
    }
    select.value = place;
    dlg.querySelector('button[data-action="ok"]')?.click();
    await new Promise((r) => setTimeout(r, 900));
    return { answered: true, listed: true };
  },

  /** The Locations view as drawn: each named place's chips and total tips, and the unplaced block with its label and the keys it lists. */
  places: async ({ id, places, lord }) => {
    const tab = globalThis.__fw.sheets[id]?.element?.querySelector('[data-tab="followers"]');
    const blocks = [...(tab?.querySelectorAll(".acks-extras-org-place") ?? [])];
    const head = (b) => b.querySelector(".acks-extras-org-place__head a");
    const unplaced = blocks.find((b) => !head(b));
    return {
      places: places.map((u) => {
        const b = blocks.find((x) => head(x)?.dataset.uuid === u);
        return b && {
          chips: [...b.querySelectorAll(":scope > ul.acks-extras-org-place__groups > li.acks-extras-org-chip[data-uuid]")].map((li) => li.dataset.uuid),
          total: b.querySelector(".acks-extras-org-place__total")?.textContent.trim() ?? null,
          totalTip: b.querySelector(".acks-extras-org-place__total")?.dataset.tooltip ?? "",
          recalls: [...b.querySelectorAll('.acks-extras-org-chip__row [data-action="orgRecall"]')].map((x) => x.closest(".acks-extras-org-chip__row").dataset.key),
        };
      }),
      unplaced: unplaced && { label: unplaced.querySelector(".acks-extras-org-place__head span")?.textContent.trim() ?? "", keys: [...unplaced.querySelectorAll("li.acks-extras-org-chip[data-key]")].map((li) => li.dataset.key) },
      lordDrawn: (tab?.querySelectorAll(`[data-key="${lord}"], [data-uuid="${lord}"]`).length ?? 0),
      empty: !!tab?.querySelector("p.acks-empty"),
    };
  },

  /** Wait for a condition in the page, polling, and answer whether it held. */
  until: async ({ expr, ms }) => {
    const end = Date.now() + (ms ?? 8000);
    while (Date.now() < end) {
      if (await (0, eval)(expr)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  },

  /** Close a sheet of an actor by id, unanimated. */
  closeSheet: async ({ uuid }) => {
    const sheet = fromUuidSync(uuid)?.sheet;
    if (sheet?.rendered) await sheet.close({ animate: false });
    return !sheet?.rendered;
  },

  /** The narrow window: the tree box's overflow and the body part's, with a scroll tried on each. */
  narrow: async ({ id }) => {
    const app = globalThis.__fw.sheets[id];
    const el = app?.element;
    const box = el?.querySelector('[data-tab="followers"] .acks-extras-org__scroll');
    const body = el?.querySelector('[data-application-part="body"]');
    if (!box || !body) return { box: !!box, body: !!body };
    box.scrollLeft = 40;
    body.scrollTop = 40;
    await new Promise((r) => setTimeout(r, 100));
    return {
      width: app.position.width,
      offsetWidth: el.offsetWidth,
      boxScrolls: box.scrollWidth > box.clientWidth,
      boxOverflowX: getComputedStyle(box).overflowX,
      boxLeft: box.scrollLeft,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyTall: body.scrollHeight > body.clientHeight,
      bodyTop: body.scrollTop,
    };
  },
};

/** Page side: press the switch button of a view on the sheet of `id` and wait for it to read pressed. Installed once beside `arm`. */
const FW_PRESS = `globalThis.__fwPress = async (id, view) => {
  const tab = () => globalThis.__fw.sheets[id]?.element?.querySelector('[data-tab="followers"]');
  const btn = tab()?.querySelector('[data-action="followersView"][data-view="' + view + '"]');
  if (!btn) return { pressed: false };
  btn.click();
  for (let n = 0; n < 40; n++) {
    await new Promise((r) => setTimeout(r, 150));
    if (tab()?.querySelector('[data-action="followersView"][data-view="' + view + '"]')?.getAttribute("aria-pressed") === "true") break;
  }
  await new Promise((r) => setTimeout(r, 300));
  return { pressed: true };
}; true`;

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const waitFor = (api, expr, ms) => run(api, P.until, { expr, ms });
/** Reads until `pred` holds and returns the last read, which is the failing one on a timeout. */
const until = async (api, fn, arg, pred, { tries = 40, every = 250 } = {}) => {
  let v = null;
  for (let n = 0; n < tries; n++) {
    v = await run(api, fn, arg);
    if (pred(v)) return v;
    await sleep(every);
  }
  return v;
};

const open = {};
let args = null;
try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf });
  if (!census.api || !census.sheet) blocked("the organisation api or the character sheet class is not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);
  await run(gm, P.arm);
  await gm.eval(FW_PRESS);

  section("fixtures");
  const named = (what) => `QA Followers ${what}${TAG}`;
  const make = (marker, data) => gm.fixture(`character-sheet/${marker}`, "Actor", { items: [], ...data });
  const monster = await make("followers-monster", { name: named("beast"), type: "monster" });
  const lord = await make("followers-lord", { name: named("lord"), type: "character" });
  const hA = await make("followers-hench-a", { name: named("henchman A"), type: "character" });
  const hB = await make("followers-hench-b", { name: named("henchman B"), type: "character" });
  const officer = await make("followers-officer", { name: named("officer"), type: "character" });
  const unit = await make("followers-unit", { name: named("hired unit"), type: "acks-extras.group" });
  // A Judge's note keeps a place out of the empty-location prune, which the primary GM's window runs; the shape step writes it too.
  const placeA = await make("followers-place-a", { name: named("place A"), type: "acks-extras.location", system: { gmNotes: "<p>Walk place A</p>" } });
  const placeB = await make("followers-place-b", { name: named("place B"), type: "acks-extras.location", system: { gmNotes: "<p>Walk place B</p>" } });
  args = { lord: lord.id, a: hA.id, b: hB.id, officer: officer.id, unit: unit.id, monster: monster.id, placeA: placeA.id, placeB: placeB.id, player: MACHINE.player, count: 7, owner: OWNER, observer: OBSERVER };
  const shaped = await run(gm, P.shape, args);
  note("found at", shaped.before);
  const S = shaped.after;
  const uuids = { lord: lord.uuid, a: hA.uuid, b: hB.uuid, officer: officer.uuid, unit: unit.uuid, placeA: placeA.uuid, placeB: placeB.uuid };
  check("the kept fixtures stand at their shape: the lord holds A and the officer, A holds B, B and the officer hold none", same(sorted(S.lordList), sorted([hA.id, officer.id])) && same(S.aList, [hB.id]) && !S.bList.length && !S.officerList.length && same(S.managers, [lord.id, hA.id, lord.id]), S);
  check("the unit is hired by the lord with the officer, inside no group, one stack of 7; both places hold nothing; the Player owns the lord and place A and only observes place B", S.unit[0] === lord.uuid && S.unit[1] === officer.uuid && S.unit[2] === "" && same(S.stack, [[monster.uuid, 7, 7, 0]]) && S.rosters.every((r) => !r.length) && same(S.owners, [OWNER, OWNER, OBSERVER]), S);
  const stored = (extra = {}) => run(gm, P.stored, { uuids: [uuids.a, uuids.unit, uuids.b], places: [uuids.placeA, uuids.placeB], unit: uuids.unit, sheets: [], ...extra });
  const keys = { lord: uuids.lord, a: uuids.a, b: uuids.b, unit: uuids.unit, officer: uuids.officer };
  const pressView = (api, view) => run(api, P.press, { id: lord.id, view });
  const openFresh = (api, extra = {}) => run(api, P.open, { id: lord.id, ...extra });

  section("1. cards, unchanged");
  const opened = await openFresh(gm);
  check("a fresh sheet of the lord opens on its Followers tab", opened.ready, opened);
  let tab = await run(gm, P.tab, { id: lord.id });
  const hirelings = [hA.id, officer.id];
  check("the switch is drawn with its three buttons in order, each with a tooltip, and Cards pressed", same(tab.switch.map((b) => b.view), ["cards", "chart", "locations"]) && same(tab.switch.map((b) => b.on), [true, false, false]) && tab.switch.every((b) => b.tip), tab.switch);
  check("a Follower Card is drawn for each of the lord's own hirelings, A and the officer, and none for B (A's) or the unit", tab.cards === hirelings.length && same(sorted(tab.cardIds), sorted(hirelings)), { cards: tab.cards, ids: tab.cardIds });
  check("the wage line is drawn", !!tab.wage, tab.wage);
  check("neither the chart nor the Locations view is drawn", !tab.chart && !tab.locations);

  section("2. org chart");
  await pressView(gm, "chart");
  tab = await run(gm, P.tab, { id: lord.id });
  check("Org chart is pressed and the chart stands, with no cards", tab.switch.find((b) => b.on)?.view === "chart" && tab.chart && tab.cards === 0, tab.switch);
  let tree = await run(gm, P.tree, { id: lord.id, keys });
  check("the root is the lord, its card names it and carries a summary with a tooltip that names it", tree.kids.lord.length === 2 && tree.rootRank?.includes(shaped.names.lord) && !!tree.rootSummary && !!tree.rootTip?.includes(shaped.names.lord) && tree.rootControls === 0, { rank: tree.rootRank, summary: tree.rootSummary, tip: !!tree.rootTip, controls: tree.rootControls });
  check("A and the unit stand under the root, B under A, and the unit has none under it", same(sorted(tree.kids.lord), sorted([uuids.a, uuids.unit])) && same(tree.kids.a, [uuids.b]) && !tree.kids.unit.length && !tree.kids.b.length, tree.kids);
  check("every key the tree draws is the lord, A, B or the unit", same(sorted(tree.keys), sorted([uuids.lord, uuids.a, uuids.b, uuids.unit])), tree.keys.length);
  check("the unit's card head is its officer's Follower Card", tree.unitHead.length === 1 && tree.unitHead[0].uuid === uuids.officer && tree.unitHead[0].followerCard, tree.unitHead);
  check("the officer has no node of its own and its uuid is drawn once in the whole tree", tree.officerNodes === 0 && tree.officerAnywhere === 1, { nodes: tree.officerNodes, anywhere: tree.officerAnywhere });
  check("no Roll, Design, Add, Recipe or pen control is drawn, and the tools are Expand all and Collapse all alone", !tree.banned.length && same(sorted(tree.tools), ["orgCollapseAll", "orgExpandAll"]), { banned: tree.banned, tools: tree.tools });
  check("the total carries its tooltip", tree.totalTip === "ACKS-LIB.org.service.totalTip", tree.totalTip);
  await run(gm, P.closeSheet, { uuid: uuids.a });
  const shown = await run(gm, P.click, { id: lord.id, where: "card", key: uuids.a, action: "hirelingShow", wait: 300 });
  const opensA = await waitFor(gm, `!!fromUuidSync("${uuids.a}")?.sheet?.rendered`, 8000);
  check("Show on A's card is drawn and opens A's own sheet", shown.pressed && opensA, { pressed: shown.pressed, opened: opensA });
  await run(gm, P.closeSheet, { uuid: uuids.a });

  section("3. fold");
  await run(gm, P.click, { id: lord.id, where: "tab", action: "orgCollapseAll", wait: 900 });
  tree = await run(gm, P.tree, { id: lord.id, keys });
  check("Collapse all folds every branch, the root's too: B is not drawn, and A and the unit with it", tree.expanded[uuids.lord] === "false" && !tree.keys.includes(uuids.b) && !tree.keys.includes(uuids.a) && !tree.keys.includes(uuids.unit), { expanded: tree.expanded, keys: tree.keys.length });
  await run(gm, P.click, { id: lord.id, where: "tab", action: "orgExpandAll", wait: 900 });
  tree = await run(gm, P.tree, { id: lord.id, keys });
  check("Expand all draws all four again, every branch open", tree.keys.length === 4 && Object.values(tree.expanded).every((v) => v === "true"), { keys: tree.keys.length, expanded: tree.expanded });
  await run(gm, P.click, { id: lord.id, where: "card", key: uuids.a, action: "orgToggle", wait: 900 });
  tree = await run(gm, P.tree, { id: lord.id, keys });
  check("A's own fold button folds its branch alone: B is hidden, A reads closed, the unit still stands", tree.expanded[uuids.a] === "false" && !tree.keys.includes(uuids.b) && tree.keys.includes(uuids.unit) && tree.expanded[uuids.lord] === "true", { expanded: tree.expanded, keys: tree.keys.length });
  await run(gm, P.rerender, { id: lord.id });
  tab = await run(gm, P.tab, { id: lord.id });
  tree = await run(gm, P.tree, { id: lord.id, keys });
  check("the view choice survives a re-render of the sheet, and so does A's fold", tab.switch.find((b) => b.on)?.view === "chart" && tab.chart && tree.expanded[uuids.a] === "false", { on: tab.switch.find((b) => b.on)?.view, a: tree.expanded[uuids.a] });
  await run(gm, P.click, { id: lord.id, where: "tab", action: "orgExpandAll", wait: 900 });
  await openFresh(gm);
  tab = await run(gm, P.tab, { id: lord.id });
  check("a fresh sheet of the same lord opens on Cards", tab.switch.find((b) => b.on)?.view === "cards" && tab.cards === 2 && !tab.chart, { on: tab.switch.find((b) => b.on)?.view });

  section("4. send out");
  await pressView(gm, "chart");
  const press = (where, key, action, wait) => run(gm, P.click, { id: lord.id, where, key, action, wait });
  const pickInto = async (key, place) => {
    const pressed = await press("card", key, "orgSendOut", 300);
    const dialog = pressed.pressed ? await run(gm, P.sendDialog, { place }) : { answered: false };
    return { pressed: pressed.pressed, ...dialog };
  };
  const sentA = await pickInto(uuids.a, uuids.placeA);
  const aOut = await waitFor(gm, `game.actors.get("${placeA.id}").system.roster.some((r) => r.uuid === "${uuids.a}")`, 8000);
  tree = await until(gm, P.tree, { id: lord.id, keys }, (t) => !!t?.out?.[uuids.a]);
  let st = await stored();
  check("Send out on A's card, through the place dialog, writes A to place A's roster and to no other", sentA.answered && aOut && same(st.holding[uuids.a], [uuids.placeA]), { sent: sentA, holding: st.holding[uuids.a] });
  check("A's card foot shows it out, and the other two cards do not", !!tree.out[uuids.a]?.includes(shaped.names.placeA) && !tree.out[uuids.unit] && !tree.out[uuids.b], tree.out);
  const sentUnit = await pickInto(uuids.unit, uuids.placeB);
  const unitOut = await waitFor(gm, `game.actors.get("${placeB.id}").system.roster.some((r) => r.uuid === "${uuids.unit}")`, 8000);
  st = await stored();
  check("Send out on the unit's card writes the unit to place B's roster, and leaves its parentGroupUuid blank", sentUnit.answered && unitOut && same(st.holding[uuids.unit], [uuids.placeB]) && st.unitParent === "", { sent: sentUnit, holding: st.holding[uuids.unit], parent: st.unitParent });
  check("B, which was sent nowhere, stands on no roster", !st.holding[uuids.b].length, st.holding[uuids.b]);

  section("5. locations");
  await pressView(gm, "locations");
  tab = await run(gm, P.tab, { id: lord.id });
  let loc = await until(gm, P.places, { id: lord.id, places: [uuids.placeA, uuids.placeB], lord: uuids.lord }, (l) => !!l.unplaced);
  check("Locations is pressed, its view stands and the chart's does not", tab.switch.find((b) => b.on)?.view === "locations" && tab.locations && !tab.chart && tab.cards === 0, tab.switch);
  check("place A lists A, and place B lists the unit", same(loc.places[0]?.chips, [uuids.a]) && same(loc.places[1]?.chips, [uuids.unit]), loc.places);
  check("what stands under the lord's own name is B alone, and the lord himself is no row", loc.unplaced?.label === `With ${shaped.names.lord}` && same(loc.unplaced.keys, [uuids.b]) && loc.lordDrawn === 0, { unplaced: loc.unplaced, lord: loc.lordDrawn });
  check("each place's total carries a tooltip and reads a figure", loc.places.every((p) => p?.totalTip && /\d/.test(p.total ?? "")), loc.places.map((p) => [p?.total, !!p?.totalTip]));
  check("a follower standing directly on a roster offers Recall: A on place A, the unit on place B", same(loc.places[0]?.recalls, [uuids.a]) && same(loc.places[1]?.recalls, [uuids.unit]), loc.places.map((p) => p?.recalls));

  section("6. recall");
  const recallA = await run(gm, P.click, { id: lord.id, where: "chip", key: uuids.a, action: "orgRecall", wait: 500 });
  const aBack = await waitFor(gm, `!game.actors.get("${placeA.id}").system.roster.some((r) => r.uuid === "${uuids.a}")`, 8000);
  loc = await until(gm, P.places, { id: lord.id, places: [uuids.placeA, uuids.placeB], lord: uuids.lord }, (l) => l.unplaced?.keys.includes(uuids.a));
  st = await stored();
  check("Recall on A's chip takes it off every roster", recallA.pressed && aBack && !st.holding[uuids.a].length, { pressed: recallA.pressed, holding: st.holding[uuids.a] });
  check("A stands under the lord's name again, with B", same(sorted(loc.unplaced?.keys ?? []), sorted([uuids.a, uuids.b])), loc.unplaced);
  const recallUnit = await run(gm, P.click, { id: lord.id, where: "chip", key: uuids.unit, action: "orgRecall", wait: 500 });
  const unitBack = await waitFor(gm, `!game.actors.get("${placeB.id}").system.roster.some((r) => r.uuid === "${uuids.unit}")`, 8000);
  loc = await until(gm, P.places, { id: lord.id, places: [uuids.placeA, uuids.placeB], lord: uuids.lord }, (l) => l.unplaced?.keys.includes(uuids.unit));
  st = await stored();
  check("Recall on the unit's chip takes it off every roster, and writes no group", recallUnit.pressed && unitBack && !st.holding[uuids.unit].length && st.unitParent === "", { holding: st.holding[uuids.unit], parent: st.unitParent });
  check("the unit stands under the lord's name too, and both places read empty of the lord's followers", same(sorted(loc.unplaced?.keys ?? []), sorted([uuids.a, uuids.b, uuids.unit])) && !loc.places[0]?.chips?.length && !loc.places[1]?.chips?.length, { unplaced: loc.unplaced?.keys.length, places: loc.places });
  await pressView(gm, "cards");

  section("7. the Player seat");
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const player = open.player;
  const pcensus = await run(player, P.census);
  if (!pcensus.api || !pcensus.sheet) blocked("the organisation api or the character sheet class is not on the Player seat's page");
  await run(player, P.arm);
  await player.eval(FW_PRESS);
  const perm = await until(player, P.perm, { lord: lord.id, placeA: uuids.placeA, placeB: uuids.placeB }, (p) => p.ownsLord && p.ownsA);
  check("the seat is a Player that owns the lord and place A, does not own place B, and holds all three", !perm.isGM && perm.ownsLord && perm.ownsA && !perm.ownsB && perm.sees.every(Boolean), perm);
  const popen = await openFresh(player);
  check("the lord's sheet opens on the Followers tab on the Player seat", popen.ready, popen);
  let ptab = await run(player, P.tab, { id: lord.id });
  check("Cards render with the switch and a card for each of the lord's own hirelings", ptab.cards === 2 && ptab.switch.length === 3 && ptab.switch[0].on, { cards: ptab.cards, switch: ptab.switch.map((b) => b.on) });
  await run(player, P.press, { id: lord.id, view: "chart" });
  ptab = await run(player, P.tab, { id: lord.id });
  const ptree = await run(player, P.tree, { id: lord.id, keys });
  check("Org chart renders the same four cards, and draws no Roll, Design, Add, Recipe or pen", ptab.chart && same(sorted(ptree?.keys ?? []), sorted([uuids.lord, uuids.a, uuids.b, uuids.unit])) && !ptree.banned.length, { keys: ptree?.keys.length, banned: ptree?.banned });
  await run(player, P.press, { id: lord.id, view: "locations" });
  ptab = await run(player, P.tab, { id: lord.id });
  const ploc = await run(player, P.places, { id: lord.id, places: [uuids.placeA, uuids.placeB], lord: uuids.lord });
  check("Locations renders, with the lord's followers standing under his name", ptab.locations && same(sorted(ploc.unplaced?.keys ?? []), sorted([uuids.a, uuids.b, uuids.unit])), ploc.unplaced);
  check("no console error on the Player seat so far", !(await run(player, P.errors)).errors.length, (await run(player, P.errors)).errors.slice(0, 3));

  await run(player, P.press, { id: lord.id, view: "chart" });
  const pressP = (key, action, wait) => run(player, P.click, { id: lord.id, where: "card", key, action, wait });
  await pressP(uuids.a, "orgSendOut", 300);
  const pOwned = await run(player, P.sendDialog, { place: uuids.placeA });
  const pLanded = await waitFor(gm, `game.actors.get("${placeA.id}").system.roster.some((r) => r.uuid === "${uuids.a}")`, 8000);
  st = await stored();
  check("Send out of A to place A, which the seat owns, lands: place A's roster holds A, and no notice was raised", pOwned.answered && pLanded && same(st.holding[uuids.a], [uuids.placeA]) && !(await run(player, P.errors)).notes.length, { dialog: pOwned, holding: st.holding[uuids.a], notes: (await run(player, P.errors)).notes });
  await sleep(1200);
  await pressP(uuids.a, "orgSendOut", 300);
  const pRefused = await run(player, P.sendDialog, { place: uuids.placeB });
  const expected = await player.eval(`game.i18n.format("ACKS-LIB.org.refused.notOwner", ${JSON.stringify({ name: shaped.names.placeB })})`);
  const notices = await until(player, P.errors, null, (e) => e.notes.length > 0, { tries: 30, every: 200 });
  await sleep(1500);
  st = await stored();
  check("Send out of A to place B, which the seat does not own, is listed in the dialog and refused with a notice naming place B", pRefused.answered && notices.notes.includes(expected), { dialog: pRefused, notes: notices.notes, expected });
  check("the refusal wrote nothing: place B's roster is empty and place A still holds A alone", !st.rosters[1].length && same(st.rosters[0], [uuids.a]) && same(st.holding[uuids.a], [uuids.placeA]), { rosters: st.rosters, holding: st.holding[uuids.a] });
  const pfinal = await run(player, P.tree, { id: lord.id, keys });
  check("no Roll tool appears for the Player on the chart, and the card of A shows it out", !pfinal.banned.length && !!pfinal.out[uuids.a], { banned: pfinal.banned, out: pfinal.out[uuids.a] });
  const perrors = await run(player, P.errors);
  check("no console error on the Player seat over the whole step (a recorder installed after the seat's ready)", !perrors.errors.length, perrors.errors.slice(0, 3));

  section("8. a narrow window");
  await run(gm, P.shape, args);
  const narrowOpen = await openFresh(gm, { width: NARROW, height: SHORT });
  await pressView(gm, "chart");
  const narrow = await run(gm, P.narrow, { id: lord.id });
  note("the window as drawn", { asked: NARROW, width: narrowOpen.width, offsetWidth: narrowOpen.offsetWidth, ...narrow });
  check("a fresh sheet opened narrow on Org chart: the tree box scrolls sideways and takes a sideways scroll", narrow.boxScrolls === true && narrow.boxOverflowX === "auto" && narrow.boxLeft > 0, narrow);
  check("the body part still scrolls vertically in the same window", /^(auto|scroll)$/.test(narrow.bodyOverflowY ?? "") && narrow.bodyTall === true && narrow.bodyTop > 0, narrow);

  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  const gm = open.gm;
  for (const [seat, api] of Object.entries(open)) {
    try { const gone = await run(api, P.disarm); note(`${seat} seat: console errors recorded, and notices`, gone); } catch (err) { console.error(`disarm ${seat}:`, err?.message ?? err); }
  }
  if (gm) {
    try { if (args) note("shape at the end (rosters emptied, links as the recipe's)", (await run(gm, P.shape, args)).after); } catch (err) { console.error("shape:", err?.message ?? err); }
    try { note("swept", await gm.sweepTracked({ only: gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
