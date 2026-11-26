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
 *   owner admin: a place's owner administers it. Settings shows to the owner
 *       without the Judge's slander (and Things and GM View stay absent); Add
 *       market, the role select, an occupant's note edit, Remove market's
 *       confirm (no slander line for the owner, a slander line for the Judge,
 *       the market going whole), a special-hire drop (an actor the seat owns is
 *       listed, one it observes is not), nesting a place and Detach, the house
 *       lock and Take, Hold goods and a compendium item dropped on the sheet.
 *       A place the seat only observes draws and does none of it.
 *   storage manager: any seat opens it (the sheet's Open manager, the exported
 *       function, the settings menu, the shipped macro) and it lists, moves,
 *       reassigns and enables only what the seat owns: a place with no level
 *       or an observed one is never listed, offered or named; Create vault and
 *       the new-place target follow the seat's create right, read from the
 *       context; Reassign offers no character the seat cannot see; the
 *       Enable and Disable Storage Here macros warn on an actor the seat does
 *       not own and run on one it does.
 *
 * Fixtures, kept and found by marker, each made OWNER for the Player seat and
 * brought to the shape a step needs at that step's start (the GM seat writes
 * the ownership and the link state):
 *   `location/owner-scene`    a scene with no background
 *   `location/owner-place-a`  a location with no market
 *   `location/owner-place-b`  a second one
 *   `location/owner-hero`     a character the Player owns, the storage group's claimant
 *   `location/owner-hire-mine`   a character the Player owns, offered for hire
 *   `location/owner-hire-theirs` a character the Player only observes
 *   `location/owner-vault`  a location the Player owns, the hero's vault
 *   `location/owner-closed` a location with no level for the Player, a provider
 *   `location/owner-unseen` a character with no level for the Player
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

  /**
   * GM seat: bring place A, place B and the hero to an administration shape.
   * The Player gets `levelA` on A and `levelB` on B. `market` says whether A
   * holds one (made with the sheet's own empty shape), `slander` how many
   * slander rows it carries, `role` its role, `occupant` whether the roster
   * holds the hero, `parentB` whether B is nested under A and `provider`
   * whether storage is on, with a locked house row when it is. The roster, the
   * hires and the rows this walk's tag marks are cleared first.
   */
  shapeAdmin: async ({ aId, bId, heroId, pid, levelA, levelB, market, slander, role, occupant, parentB, provider, tag }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { emptyMarket } = await import("/modules/acks-extras/scripts/location/data/location-data.mjs");
    const S = acksExtras.lib.storage;
    const house = acksExtras.lib.money.HOUSE_OWNER;
    const a = game.actors.get(aId);
    const b = game.actors.get(bId);
    const hero = game.actors.get(heroId);
    for (const doc of [a, hero]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    await a.update({ "system.market": null, "system.roster": [], "system.role": role ?? "", [`ownership.${pid}`]: levelA });
    await b.update({ "system.parentUuid": parentB ? a.uuid : "", [`ownership.${pid}`]: levelB });
    if (market) {
      await a.update({ "system.market": emptyMarket() });
      const rows = Array.from({ length: slander }, (_, i) => ({ subject: { scope: "all", uuid: "" }, npcName: `Walk ${i}`, time: 0, note: "" }));
      await a.update({ "system.market.slander": rows });
    }
    if (occupant) await acksExtras.lib.places.addOccupant(a, hero);
    await S.setProvider(a, provider);
    if (provider) await S.stockProvider(a, [{ name: "Owner Walk House Rope", type: "item", flags: { world: { fixtureItem: tag } } }], { ownerUuid: house, ownerName: "House" });
    await sleep(600);
    return {
      levelA: a.ownership?.[pid] ?? null,
      levelB: b.ownership?.[pid] ?? null,
      hasMarket: !!a.system.hasMarket,
      slander: a.system.hasMarket ? a.system.slander.length : 0,
      role: a.system.placeRole ?? "",
      roster: a.system.roster.length,
      parentB: b.system.parentUuid === a.uuid,
      provider: S.isProvider(a),
      houseId: a.items.find((i) => i.flags?.world?.fixtureItem === tag && i.flags?.["acks-extras"]?.storage?.ownerUuid === house)?.id ?? null,
    };
  },

  /** Player seat: wait up to five seconds for this client to hold the levels and the shape an administration step needs. */
  seenAdmin: async ({ aId, bId, levelA, levelB, market, slander, role, parentB, provider }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const a = game.actors.get(aId);
    const b = game.actors.get(bId);
    const level = (doc) => ["OWNER", "OBSERVER", "LIMITED"].find((name) => doc.testUserPermission(game.user, name)) ?? "NONE";
    const read = () => ({
      levelA: level(a),
      levelB: level(b),
      hasMarket: !!a.system.hasMarket,
      slander: a.system.hasMarket ? a.system.slander.length : 0,
      role: a.system.placeRole ?? "",
      parentB: b.system.parentUuid === a.uuid,
      provider: acksExtras.lib.storage.isProvider(a),
    });
    const want = { levelA, levelB, hasMarket: !!market, slander: market ? slander : 0, role: role ?? "", parentB: !!parentB, provider: !!provider };
    for (let i = 0; i < 50; i++) {
      const now = read();
      if (Object.keys(want).every((key) => now[key] === want[key])) break;
      await sleep(100);
    }
    return { ...read(), isGM: game.user.isGM };
  },

  /** Arm the helpers every drive below shares, on this page. */
  kit: async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.__lpoKit = {
      sleep,
      /** The newest open dialog that holds the control named by `action`. */
      dialog: async (action) => {
        for (let i = 0; i < 50; i++) {
          const found = [...document.querySelectorAll("dialog[open], .application.dialog-v2")].filter((el) => el.querySelector(`[data-action="${action}"]`)).at(-1);
          if (found) return found;
          await sleep(100);
        }
        return null;
      },
      /** Open the place's sheet on a tab and wait for the render. */
      open: async (place, tab) => {
        const sheet = place.sheet;
        await sheet.render({ force: true });
        for (let i = 0; i < 50 && !sheet.rendered; i++) await sleep(100);
        if (tab) sheet.changeTab(tab, "primary", { force: true });
        await sleep(400);
        return sheet;
      },
    };
    return true;
  },

  /**
   * Render place A on this seat and read what its Settings and Contents draw:
   * the context's tabs and seat fields and each control's presence. `bUuid`
   * names the nested row whose Detach is read.
   */
  adminView: async ({ aId, bUuid }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const ctx = await place.sheet._prepareContext({});
    const sheet = await open(place, ctx.tabs?.gmSettings ? "gmSettings" : "contents");
    const root = sheet.element;
    const has = (selector) => !!root.querySelector(selector);
    const out = {
      editable: !!ctx.editable,
      settingsTab: !!ctx.tabs?.gmSettings,
      settingsNav: has('nav [data-tab="gmSettings"]'),
      judgeNav: ["things", "gmView"].filter((id) => has(`nav [data-tab="${id}"]`)),
      canSplit: ctx.canSplit,
      canExportTable: ctx.canExportTable,
      canCreateActor: !!Actor.canUserCreate(game.user),
      canCreateTable: !!RollTable.canUserCreate(game.user),
      slanderSection: has('[data-action="addSlander"]') || has('[name^="system.market.slander"]'),
      removeMarket: has('[data-action="removeMarket"]'),
      export: has('[data-action="exportDemographics"]'),
      addMarket: has('[data-action="addMarket"]'),
      gateNone: ctx.gateEntry?.none === true,
    };
    sheet.changeTab("contents", "primary", { force: true });
    await sleep(300);
    out.roleSelect = has('select[name="system.role"]');
    out.noteEdit = has('[data-occupant-uuid] [data-action="editOccupantNote"]');
    out.hiddenToggle = has('[data-occupant-uuid] [data-action="toggleOccupantHidden"]');
    out.detach = bUuid ? { row: has(`[data-place-uuid="${bUuid}"]`), present: has(`[data-place-uuid="${bUuid}"] [data-action="detachPlace"]`) } : null;
    out.gateHint = has(".acks-extras-place-idline .fa-triangle-exclamation");
    await sheet.close();
    return out;
  },

  /** Press the Add market control and wait for the market to land. */
  addMarket: async ({ aId }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "contents");
    const button = sheet.element.querySelector('[data-action="addMarket"]');
    button?.click();
    for (let i = 0; i < 50 && button && !place.system.hasMarket; i++) await sleep(100);
    await sheet.close();
    return { pressed: !!button, hasMarket: !!place.system.hasMarket };
  },

  /** Change the role select to `value`, as the browser raises it, and read the role that landed. */
  setRole: async ({ aId, value }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "contents");
    const select = sheet.element.querySelector('select[name="system.role"]');
    if (select) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 50 && place.system.placeRole !== value; i++) await sleep(100);
    }
    await sheet.close();
    return { select: !!select, role: place.system.placeRole ?? "" };
  },

  /** Press an occupant row's note edit, type `text` into the prompt and confirm; read the stored note. */
  editNote: async ({ aId, uuid, text }) => {
    const { open, sleep, dialog } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "contents");
    const button = sheet.element.querySelector(`[data-occupant-uuid="${uuid}"] [data-action="editOccupantNote"]`);
    button?.click();
    const prompt = button ? await dialog("ok") : null;
    if (prompt) {
      prompt.querySelector("textarea[name=note]").value = text;
      prompt.querySelector('[data-action="ok"]').click();
      for (let i = 0; i < 50 && place.system.roster.find((r) => r.uuid === uuid)?.notes !== text; i++) await sleep(100);
    }
    await sheet.close();
    return { pressed: !!button, prompted: !!prompt, note: place.system.roster.find((r) => r.uuid === uuid)?.notes ?? null };
  },

  /**
   * Press Remove market on the Settings tab and read the confirm. `answer` is
   * `"no"` (read, then decline) or `"yes"` (read, then confirm and wait for the
   * market to go).
   */
  removeMarket: async ({ aId, answer }) => {
    const { open, sleep, dialog } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "gmSettings");
    const button = sheet.element.querySelector('[data-action="removeMarket"]');
    button?.click();
    const confirm = button ? await dialog(answer) : null;
    const lines = confirm ? [...confirm.querySelectorAll("li")].map((li) => li.textContent.trim()) : [];
    const slanderText = game.i18n.localize("ACKS-LOCATION.place.discard.slander");
    const out = { pressed: !!button, confirmed: !!confirm, lines: lines.length, slanderLine: lines.some((l) => l.includes(slanderText)) };
    if (confirm) {
      confirm.querySelector(`[data-action="${answer}"]`).click();
      await sleep(answer === "yes" ? 1500 : 500);
    }
    out.hasMarket = !!place.system.hasMarket;
    await sheet.close();
    return out;
  },

  /** Drop an actor on the sheet's `tab`, as a drag from the sidebar hands it, and read what it became: a special hire here, or a child of this place. */
  dropActor: async ({ aId, actorId, tab }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const dropped = game.actors.get(actorId);
    const sheet = await open(place, tab);
    await sheet._onDropActor(new DragEvent("drop"), dropped);
    await sleep(800);
    const out = {
      hires: place.system.hasMarket ? place.system.specialHires.filter((s) => s.actorUuid === dropped.uuid).length : 0,
      child: dropped.system?.parentUuid === place.uuid,
    };
    await sheet.close();
    return out;
  },

  /** Press Detach on a nested place's row and read where its parent pointer went. */
  detach: async ({ aId, childId }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const child = game.actors.get(childId);
    const sheet = await open(place, "contents");
    const button = sheet.element.querySelector(`[data-place-uuid="${child.uuid}"] [data-action="detachPlace"]`);
    button?.click();
    for (let i = 0; i < 50 && button && child.system.parentUuid; i++) await sleep(100);
    await sheet.close();
    return { pressed: !!button, parent: child.system.parentUuid || "" };
  },

  /**
   * Press the lock on the house row and read its flag, then press the row's
   * Take: the rope lands on a character the seat owns. Returns the ids it
   * landed under, for the sweep.
   */
  houseActs: async ({ aId, houseId, tag }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "storage");
    const row = () => sheet.element.querySelector(`[data-item-id="${houseId}"]`);
    const out = { lock: !!row()?.querySelector('[data-action="houseRetrievable"]'), take: !!row()?.querySelector('[data-action="retrieveRow"]') };
    const flag = () => !!place.items.get(houseId)?.flags?.["acks-extras"]?.storage?.retrievable;
    out.before = flag();
    row()?.querySelector('[data-action="houseRetrievable"]')?.click();
    for (let i = 0; i < 50 && out.lock && flag() === out.before; i++) await sleep(100);
    out.after = flag();
    const carried = () => game.actors.filter((c) => c.type === "character" && c.isOwner).flatMap((c) => c.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => ({ actorId: c.id, itemId: i.id })));
    sheet.changeTab("storage", "primary", { force: true });
    await sleep(300);
    row()?.querySelector('[data-action="retrieveRow"]')?.click();
    for (let i = 0; i < 50 && out.take && !carried().length; i++) await sleep(100);
    out.carried = carried();
    out.placeHolds = place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length;
    await sheet.close();
    return out;
  },

  /** Delete the given embedded items by id, from the seat that owns their actor. */
  sweepItems: async ({ rows }) => {
    for (const { actorId, itemId } of rows) await game.actors.get(actorId)?.deleteEmbeddedDocuments("Item", [itemId]);
    return rows.length;
  },

  /** Press Hold goods and read the provider flag. */
  holdGoods: async ({ aId }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const sheet = await open(place, "storage");
    const button = sheet.element.querySelector('[data-action="holdGoods"]');
    button?.click();
    for (let i = 0; i < 50 && button && !acksExtras.lib.storage.isProvider(place); i++) await sleep(100);
    await sheet.close();
    return { pressed: !!button, provider: acksExtras.lib.storage.isProvider(place) };
  },

  /**
   * Drop the first item of the first Item compendium on place A's sheet, as a
   * drag from a compendium hands it, and read what the place holds under the
   * house. The ids it made are returned for the sweep.
   */
  dropCompendiumItem: async ({ aId }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const place = game.actors.get(aId);
    const pack = game.packs.find((p) => p.documentName === "Item" && p.index.size);
    const entry = pack?.index.contents[0];
    const item = entry ? await fromUuid(entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`) : null;
    if (!item) return { item: false };
    const sheet = await open(place, "storage");
    const before = new Set(place.items.map((i) => i.id));
    await sheet._onDropItem(new DragEvent("drop"), item);
    await sleep(1000);
    const made = place.items.filter((i) => !before.has(i.id));
    const out = {
      item: true,
      ids: made.map((i) => i.id),
      house: made.filter((i) => i.flags?.["acks-extras"]?.storage?.ownerUuid === acksExtras.lib.money.HOUSE_OWNER).length,
      provider: acksExtras.lib.storage.isProvider(place),
    };
    await sheet.close();
    return out;
  },

  /** Delete place A's items by id (this walk's own drops), from the seat that owns it. */
  sweepPlaceItems: async ({ aId, ids }) => {
    if (ids.length) await game.actors.get(aId).deleteEmbeddedDocuments("Item", ids);
    return ids.length;
  },

  /**
   * GM seat: bring the manager's places to a shape. The Player owns A, B and
   * the vault (the hero's) and gets `closedLevel` on the closed place; every
   * row of this group's tag, and each item id in `drop` (the rope a Move landed
   * on B, read back from that step), is cleared from the places and the hero;
   * storage is switched to the flags named; and, when `stored`, A holds one
   * rope stamped to the hero.
   */
  shapeManager: async ({ aId, bId, vaultId, closedId, heroId, pid, closedLevel, closedProvider, aProvider, bProvider, stored, tag, rope, drop }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const docs = { a: game.actors.get(aId), b: game.actors.get(bId), vault: game.actors.get(vaultId), closed: game.actors.get(closedId) };
    const hero = game.actors.get(heroId);
    for (const doc of [...Object.values(docs), hero]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag || drop.includes(i.id)).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    for (const key of ["a", "b", "vault"]) await docs[key].update({ [`ownership.${pid}`]: 3 });
    await docs.closed.update({ [`ownership.${pid}`]: closedLevel });
    await S.setProvider(docs.a, aProvider);
    await S.setProvider(docs.b, bProvider);
    await S.setProvider(docs.closed, closedProvider);
    await S.setProvider(docs.vault, true, { vaultOf: hero.uuid });
    if (stored) await S.stockProvider(docs.a, [{ name: rope, type: "item", flags: { world: { fixtureItem: tag } } }], { ownerUuid: hero.uuid, ownerName: hero.name });
    await sleep(600);
    return {
      closedLevel: docs.closed.ownership?.[pid] ?? null,
      providers: { a: S.isProvider(docs.a), b: S.isProvider(docs.b), closed: S.isProvider(docs.closed), vault: S.isProvider(docs.vault) },
      vaultOf: S.vaultOwnerUuid(docs.vault) === hero.uuid,
      aHolds: docs.a.items.filter((i) => i.name === rope).length,
      bHolds: docs.b.items.filter((i) => i.name === rope).length,
    };
  },

  /** Player seat: wait up to five seconds for this client to hold the levels, flags and rope a manager step needs. */
  seenManager: async ({ aId, bId, vaultId, closedId, closedLevel, closedProvider, aProvider, bProvider, stored, rope }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const [a, b, vault, closed] = [aId, bId, vaultId, closedId].map((id) => game.actors.get(id));
    const read = () => ({
      owns: [a, b, vault].every((doc) => doc.isOwner),
      closedLevel: ["OWNER", "OBSERVER", "LIMITED"].find((name) => closed.testUserPermission(game.user, name)) ?? "NONE",
      closedProvider: S.isProvider(closed),
      aProvider: S.isProvider(a),
      bProvider: S.isProvider(b),
      vault: S.isProvider(vault) && !!S.vaultOwnerUuid(vault),
      aHolds: a.items.filter((i) => i.name === rope).length,
    });
    const want = { owns: true, closedLevel, closedProvider, aProvider, bProvider, vault: true, aHolds: stored ? 1 : 0 };
    for (let i = 0; i < 50; i++) {
      const now = read();
      if (Object.keys(want).every((key) => now[key] === want[key])) break;
      await sleep(100);
    }
    return { ...read(), isGM: game.user.isGM };
  },

  /**
   * Open the storage manager on this seat by `how` (`api`: the exported
   * function, `menu`: the settings menu's own class, `macro`: the shipped
   * macro), from a closed window, and read it: the places listed in its rail
   * and in its context, the move targets, the controls the create right
   * draws, and whether the closed place's name is anywhere in it. `placeId`
   * focuses the api's call on a place.
   */
  managerView: async ({ how, placeId, closedName }) => {
    const { sleep } = globalThis.__lpoKit;
    const id = "acks-location-storage-manager";
    await foundry.applications.instances.get(id)?.close();
    const out = { how, isGM: game.user.isGM };
    if (how === "menu") {
      const menu = game.settings.menus.get("acks-extras.storageManager");
      out.restricted = menu?.restricted ?? null;
      await new menu.type().render({ force: true });
    } else if (how === "macro") {
      const pack = game.packs.find((p) => p.metadata.packageName === "acks-extras" && p.documentName === "Macro" && p.index.some((e) => e.name === "Open Storage Manager"));
      const macro = await pack?.getDocument(pack.index.find((e) => e.name === "Open Storage Manager")._id);
      out.macro = !!macro;
      await macro?.execute();
    } else {
      acksExtras.location.openStorageManager(placeId ? game.actors.get(placeId) : null);
    }
    let app = null;
    for (let i = 0; i < 50 && !app?.rendered; i++) {
      app = foundry.applications.instances.get(id);
      if (!app?.rendered) await sleep(100);
    }
    out.rendered = !!app?.rendered;
    if (!app?.rendered) return out;
    await sleep(400);
    const root = app.element;
    const ctx = await app._prepareContext({});
    out.listed = [...root.querySelectorAll(".acks-location-manager-place")].map((li) => li.dataset.placeUuid);
    out.contextPlaces = ctx.places.map((p) => p.uuid);
    out.vaults = ctx.places.filter((p) => p.isVault).map((p) => p.uuid);
    out.allOwned = out.listed.every((uuid) => !!fromUuidSync(uuid)?.isOwner);
    out.current = ctx.place?.uuid ?? null;
    out.targets = [...root.querySelectorAll("select[data-pick=target] option")].map((o) => o.value);
    out.contextTargets = ctx.targets.map((t) => t.uuid);
    out.canCreate = ctx.canCreate;
    out.newTarget = out.targets.includes("__new__");
    out.createVault = !!root.querySelector('[data-action="createVault"]');
    out.named = !!closedName && root.textContent.includes(closedName);
    out.owners = ctx.owners.map((o) => o.uuid);
    return out;
  },

  /** Press Open manager on place A's Storage tab and read which place the manager opened on. */
  sheetOpenManager: async ({ aId }) => {
    const { open, sleep } = globalThis.__lpoKit;
    const id = "acks-location-storage-manager";
    await foundry.applications.instances.get(id)?.close();
    const place = game.actors.get(aId);
    const sheet = await open(place, "storage");
    const button = sheet.element.querySelector('[data-action="openManager"]');
    const out = { present: !!button, disabled: button ? !!button.disabled : null };
    button?.click();
    let app = null;
    for (let i = 0; i < 50 && button && !app?.rendered; i++) {
      app = foundry.applications.instances.get(id);
      if (!app?.rendered) await sleep(100);
    }
    out.opened = !!app?.rendered;
    out.on = app?.place?.uuid ?? null;
    await app?.close();
    await sheet.close();
    return out;
  },

  /** Open the manager on place A, pick the hero's rope there and press Move to B; read where the rope is after. */
  moveGoods: async ({ aId, bId, rope }) => {
    const { sleep } = globalThis.__lpoKit;
    const id = "acks-location-storage-manager";
    await foundry.applications.instances.get(id)?.close();
    const [a, b] = [aId, bId].map((x) => game.actors.get(x));
    acksExtras.location.openStorageManager(a);
    let app = null;
    for (let i = 0; i < 50 && !app?.rendered; i++) {
      app = foundry.applications.instances.get(id);
      if (!app?.rendered) await sleep(100);
    }
    await sleep(400);
    const out = { rendered: !!app?.rendered, listsRope: !!app?.element?.textContent.includes(rope) };
    app.element.querySelector('[data-action="toggleAll"]')?.click();
    await sleep(500);
    const select = app.element.querySelector("select[data-pick=target]");
    out.targetOffered = [...(select?.options ?? [])].some((o) => o.value === b.uuid);
    if (select) select.value = b.uuid;
    app.element.querySelector('[data-action="move"]')?.click();
    const holds = (doc) => doc.items.filter((i) => i.name === rope).length;
    for (let i = 0; i < 50 && holds(b) === 0; i++) await sleep(100);
    out.aHolds = holds(a);
    out.bHolds = holds(b);
    out.landed = b.items.filter((i) => i.name === rope).map((i) => i.id);
    await app.close();
    return out;
  },

  /**
   * Open the manager on place A, optionally pick the hero's rope, press the
   * control named by `action` and read the options of the dialog it opens
   * (the actors or characters it offers, each with whether the seat owns it
   * and whether it sees it). The dialog is closed unanswered.
   */
  managerDialog: async ({ aId, action, pick }) => {
    const { dialog, sleep } = globalThis.__lpoKit;
    const id = "acks-location-storage-manager";
    await foundry.applications.instances.get(id)?.close();
    acksExtras.location.openStorageManager(game.actors.get(aId));
    let app = null;
    for (let i = 0; i < 50 && !app?.rendered; i++) {
      app = foundry.applications.instances.get(id);
      if (!app?.rendered) await sleep(100);
    }
    await sleep(400);
    if (pick) {
      app.element.querySelector('[data-action="toggleAll"]')?.click();
      await sleep(500);
    }
    const button = app.element.querySelector(`[data-action="${action}"]`);
    const out = { button: !!button };
    button?.click();
    const dlg = button ? await dialog("ok") : null;
    out.prompted = !!dlg;
    out.options = [...(dlg?.querySelectorAll("select option") ?? [])].map((o) => o.value);
    out.owned = out.options.every((uuid) => !!fromUuidSync(uuid)?.isOwner);
    out.visible = out.options.every((uuid) => !!fromUuidSync(uuid)?.testUserPermission(game.user, "LIMITED"));
    const host = [...foundry.applications.instances.values()].find((x) => x !== app && (x.element === dlg || x.element?.contains?.(dlg)));
    await host?.close();
    await app.close();
    return out;
  },

  /** Run a shipped macro by name from this seat, with no token controlled, and read the warnings it raised. */
  runMacro: async ({ name }) => {
    const { sleep } = globalThis.__lpoKit;
    globalThis.__lpoWarns = [];
    canvas.tokens?.releaseAll();
    const pack = game.packs.find((p) => p.metadata.packageName === "acks-extras" && p.documentName === "Macro" && p.index.some((e) => e.name === name));
    const macro = await pack?.getDocument(pack.index.find((e) => e.name === name)._id);
    if (!macro) return { found: false };
    const controlled = canvas.tokens?.controlled?.length ?? null;
    await foundry.applications.instances.get("acks-location-storage-manager")?.close();
    await macro.execute();
    await sleep(800);
    const warns = globalThis.__lpoWarns;
    globalThis.__lpoWarns = [];
    return { found: true, controlled, warns, manager: !!foundry.applications.instances.get("acks-location-storage-manager")?.rendered };
  },

  /** GM seat: point the Player's assigned character at an actor (or nothing), and read the one it had. */
  setCharacter: async ({ pid, actorId }) => {
    const user = game.users.get(pid);
    const before = user.character?.id ?? null;
    await user.update({ character: actorId });
    return { before, now: user.character?.id ?? null };
  },

  /** Player seat: wait up to five seconds for this client to hold its assigned character. */
  seenCharacter: async ({ actorId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 50 && (game.user.character?.id ?? null) !== actorId; i++) await sleep(100);
    return { id: game.user.character?.id ?? null, isGM: game.user.isGM };
  },

  /** Read a place's storage flag, owned state and rows named `rope` on this seat. */
  providerState: async ({ id, rope }) => {
    const doc = game.actors.get(id);
    return { provider: acksExtras.lib.storage.isProvider(doc), isOwner: !!doc.isOwner, rope: doc.items.filter((i) => i.name === rope).length };
  },

  /** Close the storage manager on this seat. */
  closeManager: async () => {
    await foundry.applications.instances.get("acks-location-storage-manager")?.close();
    return true;
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

/** The tag this group's rows carry on the place and on whoever takes them. */
const ADMIN_TAG = "location/owner-admin";

/**
 * A place's owner administers it. Settings, the market's administration, the
 * occupants' notes, the special-hire list, nesting and Detach, the house lock
 * and Take, Hold goods and an item dropped on the sheet each follow ownership
 * of the place; the Judge's slander, the hidden toggle, Things and GM View stay
 * the Judge's. Every step brings the shape it needs from the GM seat and
 * asserts it on the Player seat before it presses anything.
 */
async function groupOwnerAdmin(ctx) {
  const { gm, player, ids, pid } = ctx;
  const { aId, bId, heroId, mineId, theirsId } = ids;
  const aUuid = await gm.eval(`game.actors.get(${JSON.stringify(aId)}).uuid`);
  const bUuid = await gm.eval(`game.actors.get(${JSON.stringify(bId)}).uuid`);
  const heroUuid = await gm.eval(`game.actors.get(${JSON.stringify(heroId)}).uuid`);
  const levelName = (level) => Object.keys(LEVEL).find((key) => LEVEL[key] === level);
  await run(gm, P.kit);
  await run(player, P.kit);

  /** Shape on the GM seat, then wait for the Player seat to hold it. Returns whether both agree, and the GM's read. */
  const shapeAdmin = async (shape) => {
    const full = { levelA: LEVEL.OWNER, levelB: LEVEL.OWNER, market: false, slander: 0, role: "", occupant: false, parentB: false, provider: false, ...shape };
    const shaped = await run(gm, P.shapeAdmin, { aId, bId, heroId, pid, tag: ADMIN_TAG, ...full });
    const seen = await run(player, P.seenAdmin, { aId, bId, ...full, levelA: levelName(full.levelA), levelB: levelName(full.levelB) });
    const agree =
      !seen.isGM && shaped.levelA === full.levelA && seen.levelA === levelName(full.levelA) && seen.levelB === levelName(full.levelB) &&
      shaped.hasMarket === full.market && seen.hasMarket === full.market && seen.slander === (full.market ? full.slander : 0) &&
      shaped.role === full.role && seen.role === full.role && seen.parentB === full.parentB && seen.provider === full.provider;
    return { shaped, seen, agree };
  };

  section("owner admin 1: a Player who owns a place with a market has Settings, without the Judge's slander");
  let s = await shapeAdmin({ market: true, slander: 2, occupant: true });
  check("the Player seat owns place A, which holds a market with two slander rows and the hero as an occupant", s.agree && s.shaped.roster === 1, s);
  let v = await run(player, P.adminView, { aId, bUuid });
  check("the context says the seat can edit, and Settings is a tab and on screen", v.editable && v.settingsTab && v.settingsNav, v);
  check("Things and GM View are not on screen", v.judgeNav.length === 0, v.judgeNav);
  check("Settings has no slander section, no slander control and no slander field in its form", !v.slanderSection, v);
  check("Remove market is on Settings, and Split and the export follow the seat's create rights", v.removeMarket && v.canSplit === v.canCreateActor && v.canExportTable === v.canCreateTable && v.export === v.canCreateTable, { removeMarket: v.removeMarket, canSplit: v.canSplit, canCreateActor: v.canCreateActor, canExportTable: v.canExportTable, exportDrawn: v.export });
  check("the role select and the occupant's note edit are on Contents; the hidden toggle is not", v.roleSelect && v.noteEdit && !v.hiddenToggle, v);

  section("owner admin 2: Add market on a place with none");
  s = await shapeAdmin({ market: false });
  check("the Player seat owns place A, which holds no market", s.agree, s);
  v = await run(player, P.adminView, { aId, bUuid });
  check("Add market is drawn", v.addMarket, v);
  let r = await run(player, P.addMarket, { aId });
  check("pressing it gives the place a market", r.pressed && r.hasMarket, r);

  section("owner admin 3: the role select writes, and a gate with no market above it says so");
  s = await shapeAdmin({ market: true });
  check("place A holds a market, has no role and has nothing above it", s.agree && !s.seen.role, s);
  r = await run(player, P.setRole, { aId, value: "gate" });
  check("choosing the gate role in the select writes it", r.select && r.role === "gate", r);
  s = await shapeAdmin({ market: false, role: "gate" });
  check("place A is a gate with no market and none above it", s.agree && s.seen.role === "gate", s);
  v = await run(player, P.adminView, { aId, bUuid });
  check("the context carries the no-market hint and the hint is on the Contents tab", v.gateNone && v.gateHint, v);

  section("owner admin 4: an occupant's note is edited by the place's owner");
  s = await shapeAdmin({ market: true, occupant: true });
  check("place A holds a market and the hero as a stored occupant", s.agree && s.shaped.roster === 1, s);
  r = await run(player, P.editNote, { aId, uuid: heroUuid, text: "Billeted by the walk" });
  check("the edit prompt opens, and the note lands on the occupant's row", r.pressed && r.prompted && r.note === "Billeted by the walk", r);

  section("owner admin 5: a special hire is offered by dropping an actor the seat owns on Recruitment");
  s = await shapeAdmin({ market: true });
  check("place A holds a market with no special hires", s.agree, s);
  r = await run(player, P.dropActor, { aId, actorId: mineId, tab: "recruitment" });
  check("the Player's own character is listed", r.hires === 1, r);
  s = await shapeAdmin({ market: true });
  check("place A holds a market with no special hires again, and the Player observes the second character", s.agree && s.seen.levelA === "OWNER", s);
  r = await run(player, P.dropActor, { aId, actorId: theirsId, tab: "recruitment" });
  check("an actor the Player only observes is not listed", r.hires === 0, r);

  section("owner admin 6: Remove market's confirm, on the Player seat and on the Judge's");
  s = await shapeAdmin({ market: true, slander: 2 });
  check("the Player seat owns place A, which holds a market and two slander rows", s.agree && s.seen.slander === 2, s);
  const gmConfirm = await run(gm, P.removeMarket, { aId, answer: "no" });
  check("the Judge's confirm carries a slander line, and declining keeps the market", gmConfirm.confirmed && gmConfirm.slanderLine && gmConfirm.hasMarket, gmConfirm);
  r = await run(player, P.removeMarket, { aId, answer: "no" });
  check("the Player's confirm carries no slander line, and declining keeps the market", r.confirmed && !r.slanderLine && r.hasMarket, r);
  r = await run(player, P.removeMarket, { aId, answer: "yes" });
  check("confirming removes the market whole, the slander with it", r.confirmed && !r.slanderLine && !r.hasMarket, r);

  section("owner admin 7: a place the seat owns is nested under one it owns, and Detach lifts it out");
  s = await shapeAdmin({ market: false });
  check("the Player owns both places and B is not nested", s.agree && !s.shaped.parentB, s);
  r = await run(player, P.dropActor, { aId, actorId: bId, tab: "contents" });
  check("dropping B on A nests it", r.child, r);
  s = await shapeAdmin({ market: false, parentB: true });
  v = await run(player, P.adminView, { aId, bUuid });
  check("B is nested and its row carries Detach", s.agree && v.detach?.row && v.detach.present, v.detach);
  r = await run(player, P.detach, { aId, childId: bId });
  check("pressing Detach clears B's parent", r.pressed && r.parent === "", r);

  section("owner admin 8: a place the seat only observes is not nested and shows no Detach");
  s = await shapeAdmin({ market: false, levelB: LEVEL.OBSERVER });
  check("the Player owns A and observes B", s.agree && s.seen.levelB === "OBSERVER", s);
  r = await run(player, P.dropActor, { aId, actorId: bId, tab: "contents" });
  check("dropping B on A nests nothing", !r.child, r);
  s = await shapeAdmin({ market: false, levelB: LEVEL.OBSERVER, parentB: true });
  v = await run(player, P.adminView, { aId, bUuid });
  check("B is nested under A and its row has no Detach", s.agree && v.detach?.row && !v.detach.present, v.detach);

  section("owner admin 9: the house row's lock and Take, on a place the seat owns");
  s = await shapeAdmin({ provider: true });
  check("place A holds goods: one locked house row", s.agree && s.shaped.provider && !!s.shaped.houseId, s);
  r = await run(player, P.houseActs, { aId, houseId: s.shaped.houseId, tag: ADMIN_TAG });
  check("the lock and Take are on the house row, and the lock flips the row's flag", r.lock && r.take && r.before === false && r.after === true, r);
  check("Take moves the rope to a character the seat owns and off the place", r.carried.length === 1 && r.placeHolds === 0, { carried: r.carried.length, placeHolds: r.placeHolds });
  await run(player, P.sweepItems, { rows: r.carried });

  section("owner admin 10: Hold goods, and a compendium item dropped on the sheet, on a place the seat owns");
  s = await shapeAdmin({ provider: false });
  check("place A holds no goods", s.agree && !s.shaped.provider, s);
  r = await run(player, P.holdGoods, { aId });
  check("Hold goods is on the tab and switches storage on", r.pressed && r.provider, r);
  s = await shapeAdmin({ provider: false });
  check("place A holds no goods again", s.agree && !s.shaped.provider, s);
  const dropped = await run(player, P.dropCompendiumItem, { aId });
  note("a compendium item was found", dropped.item);
  check("the item is filed under the house and storage is on", dropped.item && dropped.house === 1 && dropped.provider, dropped);
  if (dropped.ids?.length) await run(player, P.sweepPlaceItems, { aId, ids: dropped.ids });

  section("owner admin 11: on a place the seat only observes, none of it is drawn or done");
  s = await shapeAdmin({ levelA: LEVEL.OBSERVER, market: true, slander: 2, occupant: true, provider: true });
  check("the Player seat observes place A, which holds a market, slander, an occupant and a locked house row", s.agree && s.seen.levelA === "OBSERVER" && !!s.shaped.houseId, s);
  v = await run(player, P.adminView, { aId, bUuid });
  check("the context says the seat cannot edit, and Settings is neither a tab nor on screen", !v.editable && !v.settingsTab && !v.settingsNav, v);
  check("no role select, note edit, hidden toggle or Add market on Contents", !v.roleSelect && !v.noteEdit && !v.hiddenToggle && !v.addMarket, v);
  r = await run(player, P.houseActs, { aId, houseId: s.shaped.houseId, tag: ADMIN_TAG });
  check("the house row has no lock and no Take", !r.lock && !r.take && r.carried.length === 0, r);
  const hold = await run(player, P.holdGoods, { aId });
  check("Hold goods is not on the tab", !hold.pressed, hold);
  s = await shapeAdmin({ levelA: LEVEL.OBSERVER, market: true, occupant: false });
  check("the Player observes place A, which holds a market with no special hires", s.agree && s.seen.levelA === "OBSERVER", s);
  r = await run(player, P.dropActor, { aId, actorId: mineId, tab: "recruitment" });
  check("a drop of the seat's own character on Recruitment lists nothing", r.hires === 0, r);
  s = await shapeAdmin({ levelA: LEVEL.OBSERVER, provider: false });
  check("the Player observes place A, which holds no goods", s.agree && s.seen.levelA === "OBSERVER" && !s.shaped.provider, s);
  const refused = await run(player, P.dropCompendiumItem, { aId });
  check("a compendium item dropped on the sheet is refused: nothing is filed and storage stays off", refused.item === false || (refused.ids.length === 0 && !refused.provider), refused);
  if (refused.ids?.length) await run(player, P.sweepPlaceItems, { aId, ids: refused.ids });

  section("owner admin 12: the GM seat as control: Settings with the slander, and every Judge tab");
  s = await shapeAdmin({ market: true, slander: 2, occupant: true });
  check("place A holds a market with two slander rows and the hero as an occupant", s.agree && s.shaped.roster === 1, s);
  const gmView = await run(gm, P.adminView, { aId, bUuid });
  check("the Judge's Settings draws the slander section, and the hidden toggle and role select are on Contents", gmView.settingsTab && gmView.slanderSection && gmView.hiddenToggle && gmView.roleSelect, gmView);
  check("the Judge's seat has GM View on screen", gmView.judgeNav.includes("gmView"), gmView.judgeNav);
  // Leave the fixtures at the shape the next group expects: the Player's OWNER, no market, storage off.
  await shapeAdmin({});
}

const MANAGER_TAG = "location/owner-manager";
const MANAGER_ROPE = "Owner Walk Manager Rope";
const MANAGER_CLOSED = "Owner Walk Closed";

/**
 * The storage manager: any seat opens it, and it works on what the seat owns.
 * The Player owns places A and B and the hero's vault, and has no level on the
 * closed place (an importer-stamped place keeps the table default of None), or
 * observes it. Every step brings the shape it needs from the GM seat and
 * asserts it on the Player seat before it presses anything. The create right
 * is read from the context and is the world's, never edited. The rows the group
 * makes carry its tag and name and are cleared at its end.
 */
async function groupStorageManager(ctx) {
  const { gm, player, ids, pid } = ctx;
  const { aId, bId, vaultId, closedId, unseenId, heroId, theirsId } = ids;
  const uuid = (id) => `Actor.${id}`;
  const levelName = (level) => Object.keys(LEVEL).find((key) => LEVEL[key] === level);
  await run(gm, P.kit);
  await run(player, P.kit);
  await run(player, P.arm);

  // The ids a Move landed on B, deleted by the next shape; the walk reads them back from the step.
  let landed = [];
  /** Shape on the GM seat, then wait for the Player seat to hold it. */
  const shapeManager = async (shape) => {
    const full = { closedLevel: LEVEL.NONE, closedProvider: true, aProvider: true, bProvider: true, stored: false, ...shape };
    const base = { aId, bId, vaultId, closedId, rope: MANAGER_ROPE };
    const shaped = await run(gm, P.shapeManager, { ...base, heroId, pid, tag: MANAGER_TAG, drop: landed, ...full });
    landed = [];
    const seen = await run(player, P.seenManager, { ...base, ...full, closedLevel: levelName(full.closedLevel) });
    const agree =
      !seen.isGM && seen.owns && seen.closedLevel === levelName(full.closedLevel) && shaped.closedLevel === full.closedLevel &&
      shaped.providers.a === full.aProvider && seen.aProvider === full.aProvider && shaped.providers.b === full.bProvider && seen.bProvider === full.bProvider &&
      shaped.providers.closed === full.closedProvider && seen.closedProvider === full.closedProvider && shaped.vaultOf && seen.vault &&
      shaped.aHolds === (full.stored ? 1 : 0) && seen.aHolds === (full.stored ? 1 : 0) && shaped.bHolds === 0;
    return { shaped, seen, agree };
  };

  section("manager 1: Open manager is on a place's Storage tab for its owner and opens the manager on that place");
  let s = await shapeManager({ stored: true });
  check("the Player owns A, B and the vault; A holds a rope stamped to the hero; the closed place is None to the Player", s.agree, s);
  let r = await run(player, P.sheetOpenManager, { aId });
  check("Open manager is drawn and live, and pressing it opens the manager on place A", r.present && r.disabled === false && r.opened && r.on === uuid(aId), r);

  section("manager 2: the api, the settings menu and the shipped macro open it on the Player seat, and it lists what the Player owns");
  check("the closed place is None to the Player and holds goods", s.agree && s.shaped.providers.closed, s.shaped.providers);
  for (const how of ["api", "menu", "macro"]) {
    const v = await run(player, P.managerView, { how, closedName: MANAGER_CLOSED });
    if (how === "menu") check("the settings menu is not restricted to a role", v.restricted === false, v);
    check(`opened by ${how}: the window renders on a Player seat`, !v.isGM && v.rendered && (how !== "macro" || v.macro), v);
    check(`opened by ${how}: the rail lists A, B and the hero's vault, in the rail and in the context, and every place listed is one the seat owns`, [uuid(aId), uuid(bId), uuid(vaultId)].every((u) => v.listed?.includes(u) && v.contextPlaces?.includes(u)) && v.allOwned, v);
    check(`opened by ${how}: the vault is marked a vault, and the closed place is neither listed, offered as a target nor named`, v.vaults?.includes(uuid(vaultId)) && !v.listed?.includes(uuid(closedId)) && !v.targets?.includes(uuid(closedId)) && !v.named, v);
  }

  section("manager 3: a place the Player only observes is listed no more than one it has no level on");
  s = await shapeManager({ closedLevel: LEVEL.OBSERVER });
  check("the closed place is OBSERVER to the Player", s.agree && s.seen.closedLevel === "OBSERVER", s);
  let v = await run(player, P.managerView, { how: "api", closedName: MANAGER_CLOSED });
  check("it is not listed, not a move target and not named", v.rendered && !v.listed.includes(uuid(closedId)) && !v.contextTargets.includes(uuid(closedId)) && !v.targets.includes(uuid(closedId)) && !v.named, v);
  v = await run(player, P.managerView, { how: "api", placeId: closedId, closedName: MANAGER_CLOSED });
  check("handing the manager that place focuses the first place the seat owns instead, and draws none of its goods", v.rendered && v.current !== uuid(closedId) && v.current !== null && !v.named, { current: v.current, named: v.named });

  section("manager 4: Move between two places the Player owns");
  s = await shapeManager({ stored: true });
  check("A holds the hero's rope and B holds none", s.agree && s.shaped.bHolds === 0, s);
  r = await run(player, P.moveGoods, { aId, bId, rope: MANAGER_ROPE });
  landed = r.landed ?? [];
  check("the manager lists the rope, offers B as a target, and Move takes the rope to B", r.rendered && r.listsRope && r.targetOffered && r.aHolds === 0 && r.bHolds === 1, r);

  section("manager 5: Create vault and the new-place target follow the seat's create right");
  s = await shapeManager({});
  check("the Player owns A, B and the vault", s.agree, s);
  v = await run(player, P.managerView, { how: "api", closedName: MANAGER_CLOSED });
  note("this world gives the Player seat the create-actor right", v.canCreate);
  check("the context carries the create right, and the Create vault button and the new-place option are drawn exactly with it", typeof v.canCreate === "boolean" && v.createVault === v.canCreate && v.newTarget === v.canCreate, { canCreate: v.canCreate, createVault: v.createVault, newTarget: v.newTarget });
  note("create vault and a new place made", "not exercised: it makes world actors, and the world's permission settings are not edited");

  section("manager 6: Add a place offers only actors the seat owns");
  s = await shapeManager({ closedProvider: false, bProvider: false });
  check("B and the closed place are not holding goods, and the closed place is None to the Player", s.agree && !s.shaped.providers.b && !s.shaped.providers.closed, s);
  r = await run(player, P.managerDialog, { aId, action: "enableStorage" });
  check("the dialog offers B, every option is an actor the seat owns, and the closed place is not among them", r.prompted && r.options.includes(uuid(bId)) && r.owned && !r.options.includes(uuid(closedId)), r);

  section("manager 7: Reassign offers the characters the seat sees and not one it cannot");
  s = await shapeManager({ stored: true });
  check("A holds the hero's rope", s.agree, s);
  const unseen = await run(player, P.providerState, { id: unseenId, rope: MANAGER_ROPE });
  check("the Player holds no level on the unseen character", !unseen.isOwner, unseen);
  r = await run(player, P.managerDialog, { aId, action: "reassign", pick: true });
  check("the dialog offers the hero and the character the Player observes, and the unseen one is not offered", r.prompted && r.options.includes(uuid(heroId)) && r.options.includes(uuid(theirsId)) && !r.options.includes(uuid(unseenId)) && r.visible, r);

  section("manager 8: Enable Storage Here and Disable Storage Here, from the Player seat");
  s = await shapeManager({ bProvider: false });
  check("B is not holding goods; the closed place holds goods and is None to the Player", s.agree && !s.shaped.providers.b && s.shaped.providers.closed, s);
  const assign = async (actorId) => {
    const set = await run(gm, P.setCharacter, { pid, actorId });
    const seen = await run(player, P.seenCharacter, { actorId });
    return { set, seen, ok: set.now === actorId && seen.id === actorId && !seen.isGM };
  };
  const before = await run(gm, P.setCharacter, { pid, actorId: closedId });
  try {
    let a = await assign(closedId);
    check("the Player's assigned character is the closed place, which the Player does not own", a.ok && !(await run(player, P.providerState, { id: closedId, rope: MANAGER_ROPE })).isOwner, a);
    r = await run(player, P.runMacro, { name: "Enable Storage Here" });
    check("Enable Storage Here on an actor the Player does not own warns and changes nothing", r.found && r.controlled === 0 && r.warns.some((t) => t.startsWith("You do not own")), r);
    r = await run(player, P.runMacro, { name: "Disable Storage Here" });
    const stillOn = await run(player, P.providerState, { id: closedId, rope: MANAGER_ROPE });
    check("Disable Storage Here on it warns too, and it still holds goods", r.found && r.warns.some((t) => t.startsWith("You do not own")) && stillOn.provider, { r, stillOn });
    a = await assign(bId);
    check("the Player's assigned character is place B, which the Player owns and which holds no goods", a.ok && (await run(player, P.providerState, { id: bId, rope: MANAGER_ROPE })).isOwner, a);
    r = await run(player, P.runMacro, { name: "Enable Storage Here" });
    let state = await run(player, P.providerState, { id: bId, rope: MANAGER_ROPE });
    check("Enable Storage Here on B raises no refusal and turns storage on", r.found && r.warns.length === 0 && state.provider, { r, state });
    r = await run(player, P.runMacro, { name: "Disable Storage Here" });
    state = await run(player, P.providerState, { id: bId, rope: MANAGER_ROPE });
    check("Disable Storage Here on B, which holds nothing, raises no refusal and turns it off", r.found && r.warns.length === 0 && !state.provider, { r, state });
  } finally {
    await run(gm, P.setCharacter, { pid, actorId: before.before });
  }
  r = await run(player, P.runMacro, { name: "Open Storage Manager" });
  check("Open Storage Manager runs once from the Player seat with no refusal, and the window it leaves open is the manager", r.found && r.warns.length === 0 && r.manager, r);
  await run(player, P.closeManager);

  section("manager 9: the Judge's seat as control, which sees every place and may create");
  s = await shapeManager({ closedProvider: true });
  check("the closed place holds goods and is None to the Player", s.agree && s.shaped.providers.closed, s);
  const judge = await run(gm, P.managerView, { how: "api", closedName: MANAGER_CLOSED });
  check("the Judge's manager lists the closed place and offers a new place and Create vault", judge.rendered && judge.isGM && judge.listed.includes(uuid(closedId)) && judge.canCreate === true && judge.newTarget && judge.createVault, judge);
  await run(gm, P.closeManager);

  // Leave the fixtures at the shape the recipe starts from: no rope, A and B not holding goods.
  await shapeManager({ aProvider: false, bProvider: false, closedProvider: false });
}

/** The groups this walk runs, in order. A later slice of the recipe appends its own. */
const GROUPS = [groupSceneLink, groupStorage, groupOwnerAdmin, groupStorageManager];

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
  const mine = await gm.fixture("location/owner-hire-mine", "Actor", { name: "Owner Walk Hire Mine", type: "character", ownership: own });
  const theirs = await gm.fixture("location/owner-hire-theirs", "Actor", { name: "Owner Walk Hire Theirs", type: "character", ownership: { default: LEVEL.NONE, [pc.userId]: LEVEL.OBSERVER } });
  const vault = await gm.fixture("location/owner-vault", "Actor", { name: "Owner Walk Vault", type: LOCATION, ownership: own });
  const closed = await gm.fixture("location/owner-closed", "Actor", { name: MANAGER_CLOSED, type: LOCATION, ownership: { default: LEVEL.NONE } });
  const unseen = await gm.fixture("location/owner-unseen", "Actor", { name: "Owner Walk Unseen", type: "character", ownership: { default: LEVEL.NONE } });
  note("fixtures", { scene: scene.built, a: a.built, b: b.built, hero: hero.built, mine: mine.built, theirs: theirs.built, vault: vault.built, closed: closed.built, unseen: unseen.built });
  const ctx = { gm, player, pid: pc.userId, ids: { sceneId: scene.id, aId: a.id, bId: b.id, heroId: hero.id, mineId: mine.id, theirsId: theirs.id, vaultId: vault.id, closedId: closed.id, unseenId: unseen.id } };

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
