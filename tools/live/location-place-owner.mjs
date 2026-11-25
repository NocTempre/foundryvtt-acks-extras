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
 *
 * Fixtures, kept and found by marker, each made OWNER for the Player seat and
 * brought to the shape a step needs at that step's start (the GM seat writes
 * the ownership and the link state):
 *   `location/owner-scene`    a scene with no background
 *   `location/owner-place-a`  a location with no market
 *   `location/owner-place-b`  a second one
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

/** The groups this walk runs, in order. A later slice of the recipe appends its own. */
const GROUPS = [groupSceneLink];

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
  note("fixtures", { scene: scene.built, a: a.built, b: b.built });
  const ctx = { gm, player, pid: pc.userId, ids: { sceneId: scene.id, aId: a.id, bId: b.id } };

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
