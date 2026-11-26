/**
 * Live walk, location-place-owner: a place's tools follow ownership, on the
 * Player seat. Walks docs/location/TESTING.md step 29. A GM seat is OWNER of
 * every document, so it cannot test an ownership gate; the Player seat is the
 * subject and the GM seat shapes the world and reads what landed.
 *
 * Step groups, each a function over the shared seats and fixtures. Later
 * slices of the same recipe add their groups to `GROUPS` below.
 *   scene link: a scene dropped on a place's sheet, driven through the
 *       exported functions as a macro does, and picked in the Scene config's
 *       Place row. It writes the scene's flag, the place's mirror, the mirror
 *       of the place the scene named before and the scene the place held, and
 *       the seat must own every one of them. A refusal is a warning and
 *       changes nothing.
 *   storage: the Storage tab at OBSERVER and at LIMITED. An observer has the
 *       tab and the controls that move the seat's own goods (Deposit, Take on
 *       the row stamped to the seat's character) and none that write to the
 *       place (Hold goods, the house lock, Open manager); LIMITED has no tab.
 *
 * Fixtures, kept and found by marker, each made OWNER for the Player seat and
 * brought to the shape a step needs at that step's start (the GM seat writes
 * the ownership and the link state):
 *   `location/owner-scene`    a scene with no background
 *   `location/owner-place-a`  a location with no market
 *   `location/owner-place-b`  a second one
 *   `location/owner-hero`     a character the Player owns, the storage group's claimant
 * Every figure printed is a boolean, a count or a lang key's answer; no place
 * in the world is named.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
const LINK_KEY = "linkNotOwner";
/** Foundry's ownership levels. */
const LEVEL = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  /** The seat's census. */
  census: async () => ({
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    api: typeof acksExtras.location?.scenes?.linkScene,
  }),

  /**
   * GM seat: bring the three fixtures to a shape. The scene and both places
   * are unlinked and given the Player's levels; then, when `link` names a
   * place, the scene is linked to it (flag and mirror), and when `part` is
   * set the scene is a part of its place.
   */
  shape: async ({ sceneId, aId, bId, pid, levels, link, part }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scene = game.scenes.get(sceneId);
    const places = { a: game.actors.get(aId), b: game.actors.get(bId) };
    await scene.unsetFlag("acks-extras", "scenePart");
    await scene.unsetFlag("acks-extras", "location");
    for (const place of Object.values(places)) await place.update({ "system.sceneUuid": "" });
    await scene.update({ [`ownership.${pid}`]: levels.scene });
    await places.a.update({ [`ownership.${pid}`]: levels.a });
    await places.b.update({ [`ownership.${pid}`]: levels.b });
    if (part) await scene.setFlag("acks-extras", "scenePart", 1);
    if (link) {
      await scene.setFlag("acks-extras", "location", places[link].uuid);
      if (!part) await places[link].update({ "system.sceneUuid": scene.uuid });
    }
    await sleep(500);
    return { linked: scene.getFlag("acks-extras", "location") === (link ? places[link].uuid : undefined), part: !!scene.getFlag("acks-extras", "scenePart") };
  },

  /** What the link looks like on this client: the scene's flag and each place's mirror, each as which fixture it names. */
  state: async ({ sceneId, aId, bId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(600);
    const scene = game.scenes.get(sceneId);
    const a = game.actors.get(aId);
    const b = game.actors.get(bId);
    const which = (uuid) => (uuid === a.uuid ? "a" : uuid === b.uuid ? "b" : uuid ? "other" : "none");
    return {
      flag: which(scene.getFlag("acks-extras", "location")),
      aMirror: a.system.sceneUuid === scene.uuid ? "scene" : a.system.sceneUuid ? "other" : "none",
      bMirror: b.system.sceneUuid === scene.uuid ? "scene" : b.system.sceneUuid ? "other" : "none",
    };
  },

  /** Player seat: wait up to five seconds for this client to hold the ownership a step needs. */
  seen: async ({ sceneId, aId, bId, owns, link }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const read = () => ({
      scene: !!game.scenes.get(sceneId)?.isOwner,
      a: !!game.actors.get(aId)?.isOwner,
      b: !!game.actors.get(bId)?.isOwner,
      linked: game.scenes.get(sceneId)?.getFlag("acks-extras", "location") ?? null,
    });
    const want = link ? game.actors.get({ a: aId, b: bId }[link])?.uuid : null;
    for (let i = 0; i < 50; i++) {
      const now = read();
      if (now.scene === owns.scene && now.a === owns.a && now.b === owns.b && now.linked === want) break;
      await sleep(100);
    }
    const now = read();
    return { scene: now.scene, a: now.a, b: now.b, linkSeen: now.linked === want, isGM: game.user.isGM };
  },

  /** Record every `ui.notifications.warn` this page raises, from now until `disarm`. */
  arm: async () => {
    globalThis.__lpoWarns = [];
    const original = ui.notifications.warn;
    ui.notifications.warn = function (...args) {
      globalThis.__lpoWarns.push(String(args[0]));
      return original.apply(this, args);
    };
    return true;
  },

  /** Stop recording: the wrapper is an own property, so removing it restores the prototype's. */
  disarm: async () => {
    delete ui.notifications.warn;
    return true;
  },

  /** The warnings recorded since the last read, with the answer the lang key gives on this seat. */
  warns: async ({ key }) => {
    const out = { texts: globalThis.__lpoWarns ?? [], expected: game.i18n.localize(key) };
    globalThis.__lpoWarns = [];
    return out;
  },

  /** Drop the scene on a place's sheet, as a drag from the Scenes tab hands it; the sheet is closed after. */
  dropOnSheet: async ({ sceneId, placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    await place.sheet._onDropScene(new DragEvent("drop"), game.scenes.get(sceneId));
    await sleep(600);
    await place.sheet.close();
    return true;
  },

  /** Drive an exported link function as a macro does: `fn` is `linkScene` or `unlinkScene`. */
  callApi: async ({ fn, sceneId, placeId }) => {
    const scenes = acksExtras.location.scenes;
    const scene = game.scenes.get(sceneId);
    const answer = fn === "linkScene" ? await scenes.linkScene(scene, game.actors.get(placeId)) : await scenes.unlinkScene(scene);
    return { answer };
  },

  /**
   * Open the scene's configuration on this seat and read the Place row. With
   * `pick`, choose that place in the row's select (the change event the
   * browser raises) and wait for the write or the refusal to land.
   */
  sceneConfig: async ({ sceneId, pick }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scene = game.scenes.get(sceneId);
    const app = scene.sheet;
    try {
      await app.render({ force: true });
    } catch (err) {
      return { rendered: false, error: String(err?.message ?? err).slice(0, 160) };
    }
    let row = null;
    for (let i = 0; i < 30 && !row; i++) {
      row = app.element?.querySelector(".acks-extras-scene-place") ?? null;
      if (!row) await sleep(100);
    }
    const select = row?.querySelector("select.acks-extras-scene-place-select");
    const out = {
      rendered: !!app.rendered,
      row: !!row,
      plus: !!row?.querySelector(".acks-extras-scene-place-new"),
      options: [...(select?.options ?? [])].map((o) => o.value).filter(Boolean),
      selected: select?.value ?? null,
    };
    if (pick && select) {
      select.value = pick;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1000);
    }
    await app.close();
    return out;
  },

  /**
   * What a place's sheet computes for the Unlink control, and whether the
   * control is on screen where the Settings tab is reachable for this seat.
   */
  unlinkControl: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const sheet = game.actors.get(placeId).sheet;
    const ctx = await sheet._prepareContext({});
    const out = { canUnlinkScene: ctx.canUnlinkScene, hasScene: !!ctx.scene, editable: !!ctx.editable, settingsTab: !!ctx.tabs?.gmSettings, button: null };
    if (out.settingsTab) {
      await sheet.render({ force: true });
      for (let i = 0; i < 50 && !sheet.rendered; i++) await sleep(100);
      sheet.changeTab("gmSettings", "primary");
      await sleep(300);
      out.button = !!sheet.element.querySelector('[data-action="unlinkScene"]');
      await sheet.close();
    }
    return out;
  },

  /**
   * GM seat: bring place A and the hero to a Storage shape. The Player gets
   * `level` on the place; every row of this group's tag is cleared from the
   * place and the hero; storage is switched to `provider`; and, when it is on,
   * the place holds a locked house row and a row stamped to the hero.
   */
  shapeStorage: async ({ aId, heroId, pid, level, provider, tag }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const house = acksExtras.lib.money.HOUSE_OWNER;
    const place = game.actors.get(aId);
    const hero = game.actors.get(heroId);
    for (const doc of [place, hero]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    await place.update({ [`ownership.${pid}`]: level });
    await S.setProvider(place, provider);
    if (provider) {
      const flags = { world: { fixtureItem: tag } };
      await S.stockProvider(place, [{ name: "Owner Walk House Rope", type: "item", flags }], { ownerUuid: house, ownerName: "House" });
      await S.stockProvider(place, [{ name: "Owner Walk Hero Rope", type: "item", flags }], { ownerUuid: hero.uuid, ownerName: hero.name });
    }
    await sleep(500);
    const rows = place.items.filter((i) => i.flags?.world?.fixtureItem === tag);
    return {
      provider: S.isProvider(place),
      level: place.ownership?.[pid] ?? null,
      houseId: rows.find((i) => i.flags?.["acks-extras"]?.storage?.ownerUuid === house)?.id ?? null,
      heroRowId: rows.find((i) => i.flags?.["acks-extras"]?.storage?.ownerUuid === hero.uuid)?.id ?? null,
      heroCarries: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /** Player seat: wait up to five seconds for this client to hold the level and the rows a step needs. */
  seenStorage: async ({ aId, level, rows }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(aId);
    const read = () => ({
      level: ["OWNER", "OBSERVER", "LIMITED"].find((name) => place.testUserPermission(game.user, name)) ?? "NONE",
      rows: place.items.size,
    });
    for (let i = 0; i < 50; i++) {
      const now = read();
      if (now.level === level && now.rows >= rows) break;
      await sleep(100);
    }
    return { ...read(), isGM: game.user.isGM };
  },

  /**
   * Render place A's sheet on this seat and read its Storage tab: what the
   * context decided, whether the tab and its body are on screen, and each
   * control with whether core left it disabled. `rows` are the ids to read a
   * Take control on. With `press`, press that row's Take and read what landed.
   */
  storageView: async ({ aId, heroId, rows, press }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(aId);
    const sheet = place.sheet;
    const ctx = await sheet._prepareContext({});
    await sheet.render({ force: true });
    for (let i = 0; i < 50 && !sheet.rendered; i++) await sleep(100);
    if (ctx.tabs?.storage) sheet.changeTab("storage", "primary");
    await sleep(400);
    const root = sheet.element;
    const body = root.querySelector('section[data-tab="storage"]');
    const control = (selector, scope = body) => {
      const el = scope?.querySelector(selector);
      return el ? { present: true, disabled: !!el.disabled } : { present: false, disabled: null };
    };
    const out = {
      canSeeStorage: ctx.canSeeStorage,
      editable: !!ctx.editable,
      tab: !!ctx.tabs?.storage,
      nav: !!root.querySelector('nav [data-tab="storage"]'),
      body: !!body,
      holdsGoods: ctx.holdsGoods ?? null,
      judgeTabs: ["things", "gmSettings", "gmView"].filter((id) => !!root.querySelector(`[data-tab="${id}"]`)),
      deposit: control('[data-action="depositHere"]'),
      openManager: control('[data-action="openManager"]'),
      holdGoods: control('[data-action="holdGoods"]'),
      lock: control('[data-action="houseRetrievable"]'),
      take: Object.fromEntries((rows ?? []).map(([key, id]) => [key, control('[data-action="retrieveRow"]', body?.querySelector(`[data-item-id="${id}"]`))])),
      takeCount: body ? body.querySelectorAll('[data-action="retrieveRow"]').length : 0,
    };
    if (press && body) {
      const button = body.querySelector(`[data-item-id="${press}"] [data-action="retrieveRow"]`);
      button?.click();
      const hero = game.actors.get(heroId);
      for (let i = 0; i < 50 && !hero.items.some((i2) => i2.name === "Owner Walk Hero Rope"); i++) await sleep(100);
      out.pressed = !!button;
      out.heroCarries = hero.items.filter((i2) => i2.name === "Owner Walk Hero Rope").length;
      out.placeHolds = place.items.filter((i2) => i2.name === "Owner Walk Hero Rope").length;
    }
    await sheet.close();
    return out;
  },
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location?.scenes`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const seats = {};
async function seat(key) {
  const user = key === "gm" ? MACHINE.gm : MACHINE.player;
  const api = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user, port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  return api;
}

/* ------------------------------------------------------------------ */
/*  Step groups                                                         */
/* ------------------------------------------------------------------ */

/**
 * Bring the fixtures to a shape on the GM seat and wait for the Player seat to
 * hold the ownership it names. `levels` are the Player's ownership levels.
 */
async function shape(ctx, { levels, link = null, part = false }) {
  const { gm, player, ids, pid } = ctx;
  const shaped = await run(gm, P.shape, { ...ids, pid, levels, link, part });
  const owns = { scene: levels.scene === LEVEL.OWNER, a: levels.a === LEVEL.OWNER, b: levels.b === LEVEL.OWNER };
  const seen = await run(player, P.seen, { ...ids, owns, link });
  return { shaped, seen, owns };
}

const read = (ctx) => run(ctx.gm, P.state, ids3(ctx));
const ids3 = (ctx) => ({ sceneId: ctx.ids.sceneId, aId: ctx.ids.aId, bId: ctx.ids.bId });
const OWN = { scene: LEVEL.OWNER, a: LEVEL.OWNER, b: LEVEL.OWNER };

/** The scene link: it needs every end it writes. */
async function groupSceneLink(ctx) {
  const { gm, player, ids } = ctx;
  const { sceneId, aId, bId } = ids;
  const unchanged = (s, want) => s.flag === want.flag && s.aMirror === want.aMirror && s.bMirror === want.bMirror;

  section("scene link 1: a Player who owns the scene and the place links them by dropping the scene on the sheet");
  let s = await shape(ctx, { levels: OWN });
  check("the seat is a Player holding OWNER of the scene and both places", !s.seen.isGM && s.seen.scene && s.seen.a && s.seen.b, s.seen);
  await run(player, P.arm);
  await run(player, P.dropOnSheet, { sceneId, placeId: aId });
  let w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  let st = await read(ctx);
  check("the scene's flag names place A, A mirrors the scene, B is unlinked, and no warning was raised", unchanged(st, { flag: "a", aMirror: "scene", bMirror: "none" }) && w.texts.length === 0, { st, warns: w.texts.length });

  section("scene link 2: dropping it on place B re-links, and A's mirror clears");
  await run(player, P.dropOnSheet, { sceneId, placeId: bId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("the flag names B, B mirrors the scene, A's mirror is cleared, no warning", unchanged(st, { flag: "b", aMirror: "none", bMirror: "scene" }) && w.texts.length === 0, { st, warns: w.texts.length });

  section("scene link 3: a link that would write an end the seat only observes is refused, and nothing changes");
  s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OWNER, b: LEVEL.OBSERVER }, link: "b" });
  check("B is linked to the scene and the Player observes it", s.shaped.linked && !s.seen.b && s.seen.a && s.seen.scene, s.seen);
  await run(player, P.dropOnSheet, { sceneId, placeId: aId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("one warning, and it is the lang key's text", w.texts.length === 1 && w.texts[0] === w.expected && !/ACKS-LOCATION\./.test(w.texts[0]), { warns: w.texts.length, same: w.texts[0] === w.expected });
  check("the flag still names B, B still mirrors the scene, A is unlinked", unchanged(st, { flag: "b", aMirror: "none", bMirror: "scene" }), st);

  section("scene link 4: the exported functions refuse by the same test, on each unowned end");
  s = await shape(ctx, { levels: { scene: LEVEL.OBSERVER, a: LEVEL.OWNER, b: LEVEL.OWNER } });
  let call = await run(player, P.callApi, { fn: "linkScene", sceneId, placeId: aId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("a scene the seat only observes: linkScene answers false, warns once, writes nothing", call.answer === false && w.texts.length === 1 && unchanged(st, { flag: "none", aMirror: "none", bMirror: "none" }), { call, warns: w.texts.length, st });
  s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OBSERVER, b: LEVEL.OWNER } });
  call = await run(player, P.callApi, { fn: "linkScene", sceneId, placeId: aId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("a place the seat only observes: linkScene answers false, warns once, writes nothing", call.answer === false && w.texts.length === 1 && unchanged(st, { flag: "none", aMirror: "none", bMirror: "none" }), { call, warns: w.texts.length, st });
  s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OWNER, b: LEVEL.OBSERVER }, link: "b" });
  call = await run(player, P.callApi, { fn: "unlinkScene", sceneId, placeId: bId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("unlinking a scene whose place the seat only observes is refused and the link stands", call.answer === false && w.texts.length === 1 && unchanged(st, { flag: "b", aMirror: "none", bMirror: "scene" }), { call, warns: w.texts.length, st });
  s = await shape(ctx, { levels: OWN, link: "b" });
  call = await run(player, P.callApi, { fn: "unlinkScene", sceneId, placeId: bId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("unlinking a scene and the place it names, both owned, clears both ends with no warning", call.answer === true && w.texts.length === 0 && unchanged(st, { flag: "none", aMirror: "none", bMirror: "none" }), { call, warns: w.texts.length, st });

  section("scene link 5: a part scene writes its flag alone, so it needs the scene only");
  s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OBSERVER, b: LEVEL.OBSERVER }, part: true });
  call = await run(player, P.callApi, { fn: "linkScene", sceneId, placeId: aId });
  w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("a part scene is linked to a place the seat only observes, with no warning and no mirror written", call.answer === true && w.texts.length === 0 && unchanged(st, { flag: "a", aMirror: "none", bMirror: "none" }), { call, warns: w.texts.length, st });

  section("scene link 6: the Unlink control follows the scene's and the place's ownership");
  s = await shape(ctx, { levels: OWN, link: "b" });
  let ctl = await run(player, P.unlinkControl, { placeId: bId });
  check("owning the place and the scene it names, the sheet computes canUnlinkScene true", ctl.hasScene && ctl.editable && ctl.canUnlinkScene === true, ctl);
  if (ctl.settingsTab) check("and the control is drawn where the Settings tab is reachable", ctl.button === true, ctl);
  s = await shape(ctx, { levels: { scene: LEVEL.OBSERVER, a: LEVEL.OWNER, b: LEVEL.OWNER }, link: "b" });
  ctl = await run(player, P.unlinkControl, { placeId: bId });
  check("a scene the seat only observes: canUnlinkScene is false", ctl.hasScene && ctl.editable && ctl.canUnlinkScene === false, ctl);
  if (ctl.settingsTab) check("and the control is not drawn", ctl.button === false, ctl);
  note("Settings tab reachable on the Player seat at this base", ctl.settingsTab);

  section("scene link 7: the Scene config's Place row, where the seat can open the scene's configuration");
  s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OWNER, b: LEVEL.OBSERVER } });
  const aUuid = await gm.eval(`game.actors.get(${JSON.stringify(aId)}).uuid`);
  const bUuid = await gm.eval(`game.actors.get(${JSON.stringify(bId)}).uuid`);
  let cfg = await run(player, P.sceneConfig, { sceneId });
  note("a Player OWNER opens Scene config", cfg);
  check("RECORD: a Player who owns the scene can render its configuration", cfg.rendered === true, cfg);
  if (cfg.rendered) {
    check("the Place row is drawn for the owner, without the new-place button", cfg.row && !cfg.plus, cfg);
    check("its select lists the places the seat owns and not one it only observes", cfg.options.includes(aUuid) && !cfg.options.includes(bUuid), { listsA: cfg.options.includes(aUuid), listsB: cfg.options.includes(bUuid) });
    await run(player, P.sceneConfig, { sceneId, pick: aUuid });
    st = await read(ctx);
    check("picking an owned place in the row links it", unchanged(st, { flag: "a", aMirror: "scene", bMirror: "none" }), st);
    s = await shape(ctx, { levels: { scene: LEVEL.OWNER, a: LEVEL.OWNER, b: LEVEL.OBSERVER }, link: "b" });
    await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
    cfg = await run(player, P.sceneConfig, { sceneId });
    check("a place the scene is linked to stays listed though the seat only observes it", cfg.options.includes(bUuid) && cfg.selected === bUuid, cfg);
    await run(player, P.sceneConfig, { sceneId, pick: aUuid });
    w = await run(player, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
    st = await read(ctx);
    check("picking an owned place while the linked one is not owned is refused, with the warning, and the link stands", w.texts.length === 1 && unchanged(st, { flag: "b", aMirror: "none", bMirror: "scene" }), { warns: w.texts.length, st });
    s = await shape(ctx, { levels: { scene: LEVEL.OBSERVER, a: LEVEL.OWNER, b: LEVEL.OWNER } });
    cfg = await run(player, P.sceneConfig, { sceneId });
    check("a scene the seat only observes draws no Place row", cfg.rendered ? !cfg.row : true, cfg);
  }

  section("scene link 8: the GM seat as control: a Judge passes, and the row lists every place with the new-place button");
  s = await shape(ctx, { levels: { scene: LEVEL.NONE, a: LEVEL.NONE, b: LEVEL.NONE } });
  await run(gm, P.arm);
  call = await run(gm, P.callApi, { fn: "linkScene", sceneId, placeId: aId });
  w = await run(gm, P.warns, { key: `ACKS-LOCATION.place.${LINK_KEY}` });
  st = await read(ctx);
  check("the Judge links a scene and a place the Player holds at None, with no warning", call.answer === true && w.texts.length === 0 && unchanged(st, { flag: "a", aMirror: "scene", bMirror: "none" }), { call, warns: w.texts.length, st });
  cfg = await run(gm, P.sceneConfig, { sceneId });
  check("the Judge's Place row lists both places and carries the new-place button", cfg.row && cfg.plus && cfg.options.includes(aUuid) && cfg.options.includes(bUuid), cfg);
  await run(gm, P.disarm);
  await run(player, P.disarm);
  // Leave the fixtures at the shape the next group expects: unlinked, the Player's OWNER.
  await shape(ctx, { levels: OWN });
}

/** The tag this group's rows carry on the place and the hero. */
const STORAGE_TAG = "location/owner-storage";

/**
 * The Storage tab shows to a seat that observes the place. Every write on it
 * keeps its own gate: Hold goods, the house lock and Open manager stay off the
 * Player's seat, and Take is live on the row stamped to the Player's character
 * and on no other.
 */
async function groupStorage(ctx) {
  const { gm, player, ids, pid } = ctx;
  const { aId, heroId } = ids;
  const take = (s) => [["house", s.houseId], ["hero", s.heroRowId]];
  const shapeAt = async (level, provider) => {
    const shaped = await run(gm, P.shapeStorage, { aId, heroId, pid, level, provider, tag: STORAGE_TAG });
    const seen = await run(player, P.seenStorage, { aId, level: Object.keys(LEVEL).find((k) => LEVEL[k] === level), rows: provider ? 2 : 0 });
    return { shaped, seen };
  };
  const startsRight = (s, level, provider) =>
    !s.seen.isGM && s.shaped.provider === provider && s.shaped.level === level && s.seen.level === Object.keys(LEVEL).find((k) => LEVEL[k] === level) && (!provider || (!!s.shaped.houseId && !!s.shaped.heroRowId));

  section("storage 1: a Player who observes the place has its Storage tab");
  let s = await shapeAt(LEVEL.OBSERVER, true);
  check("the Player seat observes a place that holds a locked house row and a row stamped to the hero", startsRight(s, LEVEL.OBSERVER, true), s);
  let v = await run(player, P.storageView, { aId, heroId, rows: take(s.shaped) });
  check("the context says the seat can see Storage and cannot edit the place", v.canSeeStorage === true && v.editable === false, v);
  check("the Storage tab is in the nav and its body is drawn, and no Judge tab is", v.tab && v.nav && v.body && v.judgeTabs.length === 0, v);
  check("Hold goods, the house lock and Open manager are not on screen", !v.holdGoods.present && !v.lock.present && !v.openManager.present, v);
  check("Deposit is offered and live: the Player owns a character to stash from", v.deposit.present && v.deposit.disabled === false, v.deposit);
  check("Take is live on the row stamped to the Player's character", v.take.hero.present && v.take.hero.disabled === false, v.take);
  check("and the house's locked row has none, so one Take control is on the tab", !v.take.house.present && v.takeCount === 1, { house: v.take.house, count: v.takeCount });

  section("storage 2: that Take lands through the storage relay on a place the seat does not own");
  v = await run(player, P.storageView, { aId, heroId, rows: take(s.shaped), press: s.shaped.heroRowId });
  check("pressing it moves the rope to the hero and off the place", v.pressed && v.heroCarries === 1 && v.placeHolds === 0, { pressed: v.pressed, hero: v.heroCarries, place: v.placeHolds });

  section("storage 3: with storage off, an observer is offered no switch");
  s = await shapeAt(LEVEL.OBSERVER, false);
  check("the place holds no goods and the seat observes it", startsRight(s, LEVEL.OBSERVER, false), s);
  v = await run(player, P.storageView, { aId, heroId, rows: [] });
  check("the tab shows, and Hold goods is not on it", v.body && v.holdsGoods === false && !v.holdGoods.present, v);

  section("storage 4: a Player at LIMITED has no Storage tab");
  s = await shapeAt(LEVEL.LIMITED, true);
  check("the Player seat is at LIMITED on a place that holds goods", startsRight(s, LEVEL.LIMITED, true), s);
  v = await run(player, P.storageView, { aId, heroId, rows: take(s.shaped) });
  check("the context says no, and neither the nav item nor the body is on screen", v.canSeeStorage === false && !v.tab && !v.nav && !v.body, v);
  check("no Judge tab is on screen either", v.judgeTabs.length === 0, v.judgeTabs);

  section("storage 5: the GM seat as control: every Storage control and every Judge tab");
  s = await shapeAt(LEVEL.NONE, false);
  check("the place holds no goods and the Player is at None, so the Judge's seat is the only reader", startsRight(s, LEVEL.NONE, false), s);
  const gmHold = await run(gm, P.storageView, { aId, heroId, rows: [] });
  check("with storage off, a Judge has Hold goods and Open manager", gmHold.body && gmHold.holdGoods.present && gmHold.openManager.present, gmHold);
  s = await shapeAt(LEVEL.NONE, true);
  check("the place holds a locked house row and the hero's row", startsRight(s, LEVEL.NONE, true), s);
  const gmOn = await run(gm, P.storageView, { aId, heroId, rows: take(s.shaped) });
  check("with it on, a Judge has the house lock and Take on both rows", gmOn.lock.present && gmOn.take.house.present && gmOn.take.hero.present && gmOn.openManager.present, gmOn);
  check("and Settings and GM View are on screen", ["gmSettings", "gmView"].every((id) => gmOn.judgeTabs.includes(id)), gmOn.judgeTabs);
  // Leave the fixtures at the shape the next group expects: the Player's OWNER, storage off, no rows.
  await run(gm, P.shapeStorage, { aId, heroId, pid, level: LEVEL.OWNER, provider: false, tag: STORAGE_TAG });
}

/** The groups this walk runs, in order. A later slice of the recipe appends its own. */
const GROUPS = [groupSceneLink, groupStorage];

/* ------------------------------------------------------------------ */
/*  The walk                                                            */
/* ------------------------------------------------------------------ */

try {
  section("seats");
  const gm = await seat("gm");
  const census = await run(gm, P.census);
  note("census", census);
  check("the GM seat is the active GM and serves the link api", census.activeGMIsSelf && census.role === 4 && census.api === "function", census);
  if (!census.activeGMIsSelf) blocked("another GM client is the active GM");
  const player = await seat("player");
  const pc = await run(player, P.census);
  note("census (player)", { role: pc.role, isGM: pc.role >= 3 });
  if (pc.role >= 3) throw new Error("the player seat is not a player");

  section("fixtures");
  const own = { default: LEVEL.NONE, [pc.userId]: LEVEL.OWNER };
  const scene = await gm.fixture("location/owner-scene", "Scene", { name: "Owner Walk Scene", ownership: own });
  const a = await gm.fixture("location/owner-place-a", "Actor", { name: "Owner Walk Place A", type: LOCATION, ownership: own });
  const b = await gm.fixture("location/owner-place-b", "Actor", { name: "Owner Walk Place B", type: LOCATION, ownership: own });
  const hero = await gm.fixture("location/owner-hero", "Actor", { name: "Owner Walk Hero", type: "character", ownership: own });
  note("fixtures", { scene: scene.built, a: a.built, b: b.built, hero: hero.built });
  const ctx = { gm, player, pid: pc.userId, ids: { sceneId: scene.id, aId: a.id, bId: b.id, heroId: hero.id } };

  for (const group of GROUPS) await group(ctx);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  for (const [key, api] of Object.entries(seats)) {
    try { await run(api, P.disarm); } catch {}
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
