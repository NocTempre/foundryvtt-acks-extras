/**
 * Live walk, scene search: the open-sheet control and the Crossing fieldset.
 * Walks docs/scene-search/TESTING.md "The open-sheet control" and "The crossing
 * fieldset" on both seats at once.
 *
 * Half one, the open-sheet control. A real fight is ended by the tracker's own
 * End Combat and its confirm, so the real `deleteCombat` hook posts the Judges'
 * card; the card's Search the scene is a real pointer press and opens the scene
 * screen. The two bodies are unlinked tokens made by the run, and the walk holds
 * every sheet that opens against the token's OWN synthetic actor (its uuid, its
 * hit points, never the world actor's). The card's icon-only button and the
 * screen's plate button are pressed with the real pointer; the Player seat is
 * shown the scene and must hold no button. The first body's token is then deleted
 * through the run's ledger (the world actor stays), both surfaces are drawn
 * again, and both buttons must read disabled and do nothing.
 *
 * Half two, the Crossing fieldset. A place is filled by dropping the Hazards
 * pack's own items on it (`dropOnPlace`, the function a sheet drop ends in), one
 * per obstacle kind and one condition. Each obstacle's row is opened in the
 * place sheet's Things here tab, every control is written by setting its value
 * and dispatching a bubbling `change`, and every write is read back from
 * `flags["acks-extras"].things` beside invented sentinels in `params` and
 * `state`. The penalty select is held against the imported steps
 * (`waterPenaltySteps`), and what is stored is held against `crossingSeed`, the
 * reader the Begin button reads, called in the page. The scene screen's aside is
 * opened over the same place and must offer the same fieldset with fresh values.
 *
 * Scripted, not gestured: a field is committed by a synthetic `change`; a
 * control that is the element under its centre is pressed with the real pointer,
 * else with `click()` and the walk says so. The seats' console is read from the
 * recorder `openSeats` attaches before the page's first script (a reload through
 * the seat's own CDP target).
 *
 * Fixtures, found by marker and kept: `scene-search/sheet-scene`, `sheet-region`,
 * `sheet-place` (a location actor linked to the Region, one floor),
 * `sheet-party` (the Player seat owns it), `sheet-owner` (the Player seat's
 * character), `sheet-mate`, `sheet-hostile` (an unlinked monster with two goods
 * and a natural weapon), `sheet-hostile-2` (an unlinked monster with one good);
 * and `scene-search/crossing-place` (a location actor at Observer, its list
 * written whole at every start). The tokens, the combat and the cards are the
 * run's own, tracked by id and swept by id; the pot the scene deals is tracked
 * from the session's flag. The Hazards pack's items are read, never written.
 *
 * Not reached: a real pointer drag of a Hazards entry, a tab-key traversal (the
 * controls' names and tabbability are read), a second Judge seat reading the
 * card, the card after a world reload.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, t, idOf, sleep, press, clicks, checks } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/sheet-scene",
  region: "scene-search/sheet-region",
  place: "scene-search/sheet-place",
  party: "scene-search/sheet-party",
  owner: "scene-search/sheet-owner",
  mate: "scene-search/sheet-mate",
  hostile: "scene-search/sheet-hostile",
  hostile2: "scene-search/sheet-hostile-2",
  crossing: "scene-search/crossing-place",
};
const NAMES = {
  scene: "QA Sheet Scene",
  region: "QA Sheet Region",
  place: "QA Sheet Place",
  party: "QA Sheet Party",
  owner: "QA Sheet Owner",
  mate: "QA Sheet Mate",
  hostile: "QA Sheet Hostile",
  hostile2: "QA Sheet Hostile Two",
  crossing: "QA Crossing Place",
};
const GOODS = [
  { name: "QA Sheet Trinket", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 30 } },
  { name: "QA Sheet Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 12 } },
  { name: "QA Sheet Claw", type: "weapon", img: "icons/svg/sword.svg", system: { cost: 0 }, flags: { "acks-extras": { naturalWeapon: true } } },
];
const GOODS2 = [{ name: "QA Sheet Bauble", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 20 } }];
const NONCE = "tsc" + Math.random().toString(36).slice(2, 7);
const HIT = 0.025;
const ORIGIN = { x: 400, y: 400 };
/** Figures typed into the crossing fields: invented, odd on purpose. */
const TYPED = { length: "37", gap: "23", depth: "41", squeezeLength: "19" };
const SENTINEL_STATE = { qaSentinel: "kept" };
const SENTINEL_PARAMS = { qaSentinel: 7 };
/** The fields the board names for each obstacle kind, in the order the rail offers them. */
const FIELDS = { climb: ["length", "depth"], jump: ["gap", "depth"], squeeze: ["shape", "length"], swim: ["penaltyPick", "penaltyLarger"] };

const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byId = (list, id) => (list ?? []).find((x) => x.id === id) ?? null;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  ...KIT,

  /** The modules the page functions reach; on the GM seat a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__sc = globalThis.__sc ?? {});
    const base = "/modules/acks-extras/scripts/";
    const imp = async (path) => { try { return await import(`${base}${path}`); } catch (err) { return { __failed: String(err?.message ?? err) }; } };
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.around = await import(`${base}location/places-around.mjs`);
    X.util = await import(`${base}lib/util.mjs`);
    X.things = await import(`${base}lib/place-things.mjs`);
    X.search = await imp("treasure/search.mjs");
    X.slogic = await imp("treasure/search-logic.mjs");
    X.hl = await imp("formation/hazard-logic.mjs");
    X.hk = await imp("formation/hazard-keys.mjs");
    X.he = await imp("formation/hazard-entry.mjs");
    X.swim = await imp("formation/swimming.mjs");
    X.drop = await imp("formation/region-place-row.mjs");
    X.kcl = await imp("scene-search/keying-crossing-logic.mjs");
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    X.appOf = (kind, a) => (kind === "sheet" ? game.actors.get(a.placeId)?.sheet ?? null : X.win(a.fid));
    X.txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (game.user.isGM && !X.cards) {
      X.cards = [];
      X.hooks = [
        ["preCreateChatMessage", Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); })],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => {
          if (m.flags?.world?.qaNonce !== nonce) return;
          X.cards.push({ id: m.id, uuid: m.uuid, at: Date.now() });
        })],
      ];
    }
    await X.util.primaryGMSettled?.();
    const api = globalThis.acksExtras?.sceneSearch;
    const has = (m, ...names) => !!m && !m.__failed && names.every((n) => typeof m[n] === "function" || Array.isArray(m[n]) || (m[n] && typeof m[n] === "object"));
    return {
      api: typeof api?.open === "function" && typeof api?.searchHere === "function" && typeof api?.openScreen === "function" && typeof api?.show === "function",
      primary: !!X.util.isPrimaryGM?.(),
      openSheet: has(X.search, "openBodySheet", "bodySheetExists"),
      settle: has(X.slogic, "bodyActorOf", "settleSheetButtons"),
      crossing: has(X.kcl, "crossingOf", "crossingEdits", "offeredKeys"),
      readers: has(X.hl, "crossingSeed", "readPick", "readParam", "penaltyPicksOf", "setupKeysOf", "SQUEEZE_SHAPES", "PICK_KEYS"),
      failed: Object.fromEntries(["search", "slogic", "hl", "kcl", "he", "swim", "drop"].filter((k) => X[k]?.__failed).map((k) => [k, X[k].__failed])),
    };
  },
  unhook: async () => {
    const X = globalThis.__sc;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X?.clickHandler) { document.removeEventListener("click", X.clickHandler, true); X.clickHandler = null; }
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  made: async ({ since = 0 } = {}) => (globalThis.__sc.cards ?? []).filter((c) => c.at >= since).map((c) => ({ id: c.id, uuid: c.uuid })),
  boot: async () => (globalThis.__tkBoot?.errors ?? []).map((e) => `${e.phase}/${e.kind}: ${e.text}`),
  /** A word of the module's lang files, the root joined here so no whole key sits in the walk. */
  say: async ({ root, key, data } = {}) => {
    const roots = { loc: "ACKS-" + "LOCATION", form: "ACKS-" + "FORMATION", tre: "ACKS-" + "TREASURE" };
    const full = `${roots[root]}.${key}`;
    return data && Object.keys(data).length ? game.i18n.format(full, data) : game.i18n.localize(full);
  },
  rig: async ({ die }) => {
    const X = globalThis.__sc;
    if (!X.orig) X.orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    return true;
  },
  unrig: async () => {
    const X = globalThis.__sc;
    if (X?.orig) { CONFIG.Dice.randomUniform = X.orig; X.orig = null; }
    return true;
  },

  /* ---- Fixtures --------------------------------------------------------- */
  shapeScene: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size };
  },
  formationOf: async ({ partyId }) => {
    const X = globalThis.__sc;
    const H = globalThis.__tk;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** The kept actors at the shape the steps start from: ownership, the hostiles unlinked and hostile, their goods once each, the world actor's hit points above the knocked-down token's. */
  shapeActors: async ({ ids, playerId, goods, goods2 }) => {
    const wrote = [];
    const own = async (actor, level) => { if ((actor.ownership?.[playerId] ?? 0) !== level) { await actor.update({ [`ownership.${playerId}`]: level, "ownership.default": 0 }); wrote.push(`${actor.name}:ownership`); } };
    await own(game.actors.get(ids.owner), 3);
    await own(game.actors.get(ids.mate), 0);
    await own(game.actors.get(ids.party), 3);
    const hostiles = [[ids.hostile, goods], [ids.hostile2, goods2]];
    for (const [id, list] of hostiles) {
      const a = game.actors.get(id);
      if (a.prototypeToken.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE || a.prototypeToken.actorLink) { await a.update({ "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE, "prototypeToken.actorLink": false }); wrote.push(`${a.name}:token`); }
      if (Number(a.system?.hp?.value) !== 9 || Number(a.system?.hp?.max) !== 9) { await a.update({ "system.hp.value": 9, "system.hp.max": 9 }); wrote.push(`${a.name}:hp`); }
      const have = new Set(a.items.map((i) => i.name));
      const miss = list.filter((i) => !have.has(i.name));
      if (miss.length) { await a.createEmbeddedDocuments("Item", miss); wrote.push(`${a.name}:goods`); }
    }
    const view = (id) => { const a = game.actors.get(id); const names = a.items.map((i) => i.name).sort(); return { names, dup: a.items.size !== new Set(names).size, hp: a.system.hp.value, linked: a.prototypeToken.actorLink }; };
    return { wrote, hostile: view(ids.hostile), hostile2: view(ids.hostile2), ownerOwns: game.actors.get(ids.owner).testUserPermission(game.users.get(playerId), "OWNER"), mateOwns: game.actors.get(ids.mate).testUserPermission(game.users.get(playerId), "OWNER"), partyOwns: game.actors.get(ids.party).testUserPermission(game.users.get(playerId), "OWNER") };
  },
  /** The place's list written whole: one floor. */
  shapeFloor: async ({ placeId }) => {
    const a = game.actors.get(placeId);
    const things = [{ id: "floor-1", kind: "floor", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} }];
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((x) => x.id) };
  },
  /** The party at its start shape: both characters in it, its token on the scene at `at`, no plan, no session, no combat. */
  startShape: async ({ fid, partyId, sceneId, members, at }) => {
    const X = globalThis.__sc;
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
  centre: async ({ fid }) => {
    const X = globalThis.__sc;
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const { tokenCentre } = await import("/modules/acks-extras/scripts/lib/token-centre.mjs");
    const c = tokenCentre(token, scene, token._source ?? token);
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y };
  },
  shapeRegion: async ({ uuid, rect }) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const ok = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!ok) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  linkPlace: async ({ regionUuid, placeId }) => {
    const X = globalThis.__sc;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  placesAt: async ({ fid }) => {
    const X = globalThis.__sc;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    if (!token) return { token: false, places: [] };
    return { token: true, places: X.around.placesAround(token, token.parent).map((p) => p.place.name) };
  },

  /* ---- The fight and its card ------------------------------------------- */
  startFight: async ({ combatId, start = null }) => {
    const c = game.combats.get(combatId);
    if (!c) return { found: false };
    if (start === "update") await c.update({ round: 1, turn: 0 });
    return { found: true, started: !!c.started, sceneId: c.scene?.id ?? null, rows: c.combatants.map((x) => ({ id: x.id, token: !!x.token, actor: !!x.actor, disposition: x.token?.disposition ?? null })) };
  },
  defeat: async ({ combatId, combatantId, how }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return { found: false };
    if (how === "hp") await c.token.actor.update({ "system.hp.value": 0 });
    else {
      await c.update({ defeated: true });
      await c.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: true });
    }
    return { found: true, isDefeated: !!c.isDefeated, hp: c.token?.actor?.system?.hp?.value ?? null };
  },
  view: async ({ combatId, viewScene = null }) => {
    const H = globalThis.__tk;
    const combat = game.combats.get(combatId);
    try { ui.sidebar.changeTab("combat", "primary"); } catch { /* already showing */ }
    if (viewScene) { try { await game.scenes.get(viewScene)?.view(); } catch { /* no canvas */ } }
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && !ui.combat.element?.querySelector?.("li.combatant"); n++) await H.sleep(150);
    return { viewed: ui.combat.viewed?.id ?? null, rows: ui.combat.element?.querySelectorAll?.("li.combatant").length ?? 0, endButton: !!ui.combat.element?.querySelector?.("[data-action='endCombat']") };
  },
  showChat: async () => { try { ui.sidebar.changeTab("chat", "primary"); } catch { /* already showing */ } await globalThis.__tk.sleep(300); return true; },
  combatGone: async ({ combatId }) => !!(await globalThis.__tk.poll(() => !game.combats.get(combatId), { tries: 60, every: 250 })),
  /** The fight's card as this seat holds and renders it: its record, and each open-sheet button the DOM holds. */
  card: async ({ combatId, messageId = null }) => {
    const H = globalThis.__tk;
    const m = messageId ? game.messages.get(messageId) : game.messages.find((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId);
    const li = m ? document.querySelector(`[data-message-id='${m.id}']`) : null;
    const flag = m?.flags?.["acks-extras"]?.treasureSearch ?? null;
    return {
      inCollection: !!m,
      id: m?.id ?? null,
      visible: m ? !!m.visible : null,
      rendered: !!li,
      sceneId: flag?.sceneId ?? null,
      opened: flag?.opened === true,
      fallen: (flag?.fallen ?? []).map((e) => ({ id: e.combatantId, name: e.name, actorUuid: e.actorUuid ?? null })),
      rows: [...(li?.querySelectorAll(".acks-extras-treasure-search__list > li") ?? [])].map((r) => ({ name: H.text(r.querySelector(".acks-extras-treasure-search__name")) })),
      button: H.text(li?.querySelector("[data-action='searchScene']")),
      sheetButtons: [...(li?.querySelectorAll("[data-action='openSheet']") ?? [])].map((b) => ({
        combatant: b.dataset.combatant ?? null,
        disabled: !!b.disabled,
        aria: b.getAttribute("aria-label"),
        tip: b.getAttribute("data-tooltip"),
        tipText: b.getAttribute("data-tooltip-text"),
        text: H.text(b),
        icon: !!b.querySelector("i.fa-book-open"),
        title: b.getAttribute("title"),
        tag: b.tagName.toLowerCase(),
        type: b.getAttribute("type"),
      })),
    };
  },
  /** Draw a chat card again through core's own chat log, or (method `update`) by a write to the run's own card. */
  redrawCard: async ({ messageId, method = "log" }) => {
    const H = globalThis.__tk;
    const m = game.messages.get(messageId);
    if (!m) return { ok: false };
    try {
      if (method === "log") {
        if (typeof ui.chat?.updateMessage !== "function") return { ok: false, why: "ui.chat.updateMessage is not a function" };
        await ui.chat.updateMessage(m);
      } else {
        await m.update({ "flags.world.qaRedraw": Date.now() });
      }
    } catch (err) {
      return { ok: false, why: String(err?.message ?? err) };
    }
    await H.sleep(700);
    return { ok: true, method };
  },
  session: async ({ partyId }) => {
    const f = game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ?? null;
    return f ? { open: true, potUuid: f.potUuid ?? null, recordMessageId: f.recordMessageId ?? null, bodies: (f.bodies ?? []).map((b) => ({ id: b.id, ref: b.ref ?? null, name: b.name })) } : { open: false };
  },
  waitSession: async ({ partyId, open = true, tries = 80 }) => {
    const H = globalThis.__tk;
    return !!(await H.poll(() => (!!game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") === open ? true : null), { tries, every: 250 }));
  },
  /** The entries the Judge reads, each with its `ref`. */
  entriesOf: async ({ fid }) => (acksExtras.sceneSearch.read(fid)?.entries ?? []).map((e) => ({ key: e.key, kind: e.kind, ref: e.ref ?? null })),
  endSession: async ({ fid }) => { const r = await acksExtras.sceneSearch.end(fid); return { ok: r.ok === true, reason: r.reason ?? null }; },
  show: async ({ fid }) => { const r = await acksExtras.sceneSearch.show(fid); return { ok: r.ok === true, reason: r.reason ?? null }; },
  openPlain: async ({ fid, placeUuid, sceneId }) => {
    const r = await acksExtras.sceneSearch.open({ partyId: fid, placeUuid, sceneId, sources: [], metInLair: true });
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  tokenExists: async ({ sceneId, tokenId }) => !!game.scenes.get(sceneId)?.tokens.get(tokenId),
  /** A token's own actor as the world holds it, and the world actor it was made from. */
  tokenActor: async ({ sceneId, tokenId, worldId }) => {
    const tok = game.scenes.get(sceneId)?.tokens.get(tokenId);
    const actor = tok?.actor ?? null;
    return { exists: !!actor, uuid: actor?.uuid ?? null, isToken: actor?.isToken === true, hp: actor?.system?.hp?.value ?? null, worldUuid: game.actors.get(worldId)?.uuid ?? null, worldHp: game.actors.get(worldId)?.system?.hp?.value ?? null, differs: !!actor && actor !== game.actors.get(worldId) };
  },
  worldExists: async ({ worldId }) => !!game.actors.get(worldId),

  /* ---- Windows ----------------------------------------------------------- */
  /** The ids of the application windows rendered now. */
  appIds: async () => [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.id),
  /** Wait for a rendered window whose document is `uuid`; read it against the world actor, which must not have one. */
  waitSheet: async ({ uuid, worldId, tries = 40 }) => {
    const H = globalThis.__tk;
    const find = () => [...foundry.applications.instances.values()].find((a) => a.rendered && a.document?.uuid === uuid) ?? null;
    const t0 = Date.now();
    const app = await H.poll(find, { tries, every: 150 });
    const world = worldId ? game.actors.get(worldId) : null;
    if (app) H.lastWaitMs = Date.now() - t0;
    if (!app) return { found: false, waitedMs: Date.now() - t0, worldRendered: world?.sheet?.rendered === true, rendered: [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => `${a.constructor.name}:${a.document?.uuid ?? "-"}`).slice(-8), legacy: Object.values(ui.windows ?? {}).map((a) => `${a.constructor.name}:${a.object?.uuid ?? "-"}`) };
    if (!H.opened.includes(app)) H.opened.push(app);
    return { found: true, waitedMs: Date.now() - t0, ctor: app.constructor.name, docUuid: app.document.uuid, isToken: app.document.isToken === true, hp: app.document.system?.hp?.value ?? null, worldHp: world?.system?.hp?.value ?? null, worldRendered: world?.sheet?.rendered === true };
  },
  /** Record every click the document sees (capture phase), with where its target sits: tells a press that never arrived from one that arrived and opened nothing. */
  armClicks: async ({ sel }) => {
    const X = globalThis.__sc;
    X.clicks = [];
    if (X.clickHandler) document.removeEventListener("click", X.clickHandler, true);
    X.clickHandler = (ev) => {
      const t = ev.target;
      X.clicks.push({ tag: t?.tagName?.toLowerCase() ?? null, isBtn: !!t?.closest?.(sel), home: t?.closest?.("#chat-notifications") ? "popup" : t?.closest?.("#chat") ? "log" : "other", trusted: ev.isTrusted });
    };
    document.addEventListener("click", X.clickHandler, true);
    return true;
  },
  readClicks: async ({ sel }) => {
    const X = globalThis.__sc;
    const found = [...document.querySelectorAll(sel)].map((el) => ({ home: el.closest("#chat-notifications") ? "popup" : el.closest("#chat") ? "log" : "other", disabled: el.disabled, connected: el.isConnected }));
    return { clicks: X.clicks ?? [], matches: found };
  },
  closeSheetOf: async ({ uuid }) => {
    const app = [...foundry.applications.instances.values()].find((a) => a.rendered && a.document?.uuid === uuid);
    if (app) await app.close({ animate: false });
    return !!app;
  },
  /** What the page can say about a body whose token is gone: the helpers the buttons use, called directly. */
  deadCheck: async ({ uuid, worldId }) => {
    const X = globalThis.__sc;
    const H = globalThis.__tk;
    const before = [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.id);
    H.warns = [];
    H.infos = [];
    const errs0 = H.errors.length;
    let exists = null;
    let opened = null;
    let threw = null;
    try { exists = X.search.bodySheetExists(uuid); opened = X.search.openBodySheet(uuid); } catch (err) { threw = String(err?.message ?? err); }
    await H.sleep(500);
    const after = [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.id);
    let resolved = "none";
    try { resolved = fromUuidSync(uuid)?.documentName ?? "none"; } catch { resolved = "threw"; }
    return { exists, opened, threw, resolved, newWindows: after.filter((id) => !before.includes(id)).length, warns: H.warns.length, infos: H.infos.length, errors: H.errors.length - errs0, worldRendered: game.actors.get(worldId)?.sheet?.rendered === true };
  },
  /** Click a control by selector with `click()` (a disabled button swallows it), reporting the windows and notices it raised. */
  scriptedClick: async ({ sel, nth = 0 }) => {
    const H = globalThis.__tk;
    const before = [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.id);
    H.warns = [];
    H.infos = [];
    const errs0 = H.errors.length;
    const el = [...document.querySelectorAll(sel)][nth];
    if (!el) return { found: false };
    const disabled = !!el.disabled;
    el.click();
    await H.sleep(600);
    const after = [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.id);
    return { found: true, disabled, newWindows: after.filter((id) => !before.includes(id)).length, warns: H.warns.length, infos: H.infos.length, errors: H.errors.length - errs0 };
  },
  openScreen: async ({ fid }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const app = acksExtras.sceneSearch.openScreen(fid);
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app) ? true : null), { tries: 60, every: 150 });
    await H.sleep(500);
    return { rendered: !!ok, found: !!X.win(fid) };
  },
  winOpen: async ({ fid }) => {
    const H = globalThis.__tk;
    const app = globalThis.__sc.win(fid);
    if (app && !H.opened.includes(app)) H.opened.push(app);
    return !!app?.rendered && !!H.root(app);
  },
  closeScreen: async ({ fid }) => { const app = globalThis.__sc.win(fid); if (app) await app.close({ animate: false }); return !globalThis.__sc.win(fid); },
  renderScreen: async ({ fid }) => { const app = globalThis.__sc.win(fid); if (app) await app.render(); await globalThis.__tk.sleep(700); return !!app; },
  /** The screen's cards, with each one's open-sheet button read from its DOM, the selected cards and the aside. */
  screenState: async ({ fid }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const app = X.win(fid);
    const root = app ? H.root(app) : null;
    if (!root) return null;
    const aside = root.querySelector(".acks-extras-keying-aside");
    return {
      open: !!app.rendered,
      sheetButtons: root.querySelectorAll('[data-action="openSheet"]').length,
      sheetClass: root.querySelectorAll(".acks-extras-ss-sheet").length,
      keyBtns: root.querySelectorAll(".acks-extras-ss-keybtn").length,
      aside: !!aside,
      asideText: X.txt(aside),
      asideRail: !!aside?.querySelector(".acks-extras-keying"),
      railThing: aside?.querySelector(".acks-extras-keying")?.dataset?.thingId ?? null,
      cards: [...root.querySelectorAll(".acks-extras-ss-card")].map((c) => {
        const b = c.querySelector('[data-action="openSheet"]');
        const kb = c.querySelector(".acks-extras-ss-keybtn");
        return {
          key: c.dataset.dropEntry,
          selected: c.classList.contains("is-selected") || kb?.getAttribute("aria-pressed") === "true",
          name: X.txt(kb ?? c.querySelector(".acks-extras-ss-plate b")),
          sheet: b ? {
            key: b.dataset.key ?? null,
            disabled: !!b.disabled,
            aria: b.getAttribute("aria-label"),
            tipText: b.getAttribute("data-tooltip-text"),
            tip: b.getAttribute("data-tooltip"),
            text: X.txt(b),
            icon: !!b.querySelector("i.fa-book-open"),
            display: getComputedStyle(b).display,
          } : null,
        };
      }),
    };
  },
  /** Click the nth element a selector finds inside the screen's window. */
  clickScreen: async ({ fid, sel, nth = 0 }) => {
    const H = globalThis.__tk;
    const root = H.root(globalThis.__sc.win(fid));
    const el = root ? [...root.querySelectorAll(sel)][nth] : null;
    if (!el) return { found: false };
    el.click();
    return { found: true, disabled: !!el.disabled };
  },

  /** The coordinator's probe: every stylesheet href, nested @import sheets included, with whether the module's sheets are among them. */
  sheetProbe: async () => {
    const seen = [];
    const walk = (sh) => { try { if (sh.href) seen.push(sh.href); for (const r of sh.cssRules ?? []) if (r.styleSheet) walk(r.styleSheet); } catch { /* cross-origin */ } };
    for (const s of document.styleSheets) walk(s);
    const has = (f) => seen.some((h) => h.includes(f));
    return { sceneSearch: has("styles/scene-search.css"), treasure: has("styles/treasure.css"), sheets: seen.length };
  },
  /** How many rules of a sheet whose href names `hrefPart` have a selector naming `needle`, walking grouping and layer rules and nested imports. */
  ruleCount: async ({ hrefPart, needle }) => {
    let n = 0;
    const rules = (list, href) => {
      for (const r of list ?? []) {
        if (r.styleSheet) { walk(r.styleSheet); continue; }
        if (r.cssRules && !r.selectorText) { rules(r.cssRules, href); continue; }
        if (r.selectorText?.includes(needle) && href.includes(hrefPart)) n++;
      }
    };
    const walk = (sh) => { try { rules(sh.cssRules, sh.href ?? ""); } catch { /* cross-origin */ } };
    for (const sh of document.styleSheets) walk(sh);
    return n;
  },

  /* ---- The crossing ------------------------------------------------------- */
  /** The Hazards pack's documents that stand for the kinds the walk needs: the first climb obstacle, jump, swim, squeeze, and one condition. */
  hazardPick: async ({ condition }) => {
    const X = globalThis.__sc;
    const pack = game.packs.get("acks-extras.hazards");
    if (!pack) return { pack: false };
    const docs = await pack.getDocuments();
    const climbKey = X.hk.OBSTACLE_HAZARDS.find((k) => !["jump", "swim", "squeeze"].includes(k));
    const want = { climb: climbKey, jump: "jump", swim: "swim", squeeze: "squeeze", condition };
    const out = {};
    for (const [kind, key] of Object.entries(want)) out[kind] = { key, uuid: docs.find((d) => d.system?.key === key)?.uuid ?? null };
    return { pack: true, size: docs.length, out };
  },
  /** The crossing place at its start shape: Observer for everyone, an empty list. */
  shapeCrossing: async ({ placeId }) => {
    const a = game.actors.get(placeId);
    if (a.ownership?.default !== 2) await a.update({ ownership: { default: 2 } });
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create([]) });
    return { type: a.type, count: (a.getFlag("acks-extras", "things") ?? []).length, default: a.ownership?.default };
  },
  /** The drop a sheet ends in, for one pack item, made through the same function; answers what the list holds after. */
  dropHazard: async ({ placeId, uuid }) => {
    const X = globalThis.__sc;
    const place = game.actors.get(placeId);
    const took = await X.drop.dropOnPlace({ place, data: { type: "Item", uuid } });
    const list = (place.getFlag("acks-extras", "things") ?? []);
    return { took, count: list.length, last: list.length ? { id: list[list.length - 1].id, kind: list[list.length - 1].kind, ref: list[list.length - 1].ref } : null };
  },
  /** Every thing's `params` and `state` seeded with the sentinels, the rest of the list as stored. */
  sentinels: async ({ placeId, params, state }) => {
    const a = game.actors.get(placeId);
    const list = JSON.parse(JSON.stringify(a.getFlag("acks-extras", "things") ?? []));
    for (const t of list) { t.params = { ...(t.params ?? {}), ...params }; t.state = { ...(t.state ?? {}), ...state }; }
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(list) });
    return list.length;
  },
  /** The stored list exactly as the flag holds it. */
  rawThings: async ({ placeId }) => JSON.parse(JSON.stringify(game.actors.get(placeId).getFlag("acks-extras", "things") ?? [])),
  /** The stored list with one thing's params replaced whole, written as a ForcedReplacement. */
  writeParams: async ({ placeId, id, params }) => {
    const a = game.actors.get(placeId);
    const list = JSON.parse(JSON.stringify(a.getFlag("acks-extras", "things") ?? []));
    const t = list.find((x) => x.id === id);
    if (!t) return false;
    t.params = params;
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(list) });
    return true;
  },
  /** The hazard key each thing's ref resolves to, read from the documents. */
  keysOf: async ({ placeId }) => {
    const X = globalThis.__sc;
    const place = game.actors.get(placeId);
    const things = X.things.thingsOf(place);
    const keyOf = await X.he.hazardKeyResolver([{ uuid: place.uuid, things }]);
    return Object.fromEntries(things.map((t) => [t.id, keyOf(t.ref)]));
  },
  /** The imported water-penalty steps, the picks they make, and the figures the readers take for what the walk types. */
  expects: async ({ typed }) => {
    const X = globalThis.__sc;
    const steps = X.swim.waterPenaltySteps();
    const picks = X.hl.penaltyPicksOf(steps);
    const read = (key, raw) => X.hl.readParam(key, raw) ?? null;
    const top = Array.isArray(steps) && steps.length ? Math.max(...steps) : 0;
    const candidates = [String(top + 3), "11", "5", "2"];
    const larger = candidates.find((c) => X.hl.readPick("penaltyLarger", c, { penaltyPick: "larger" }, picks) !== undefined) ?? null;
    const say = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
    const F = "ACKS-" + "FORMATION.crossing.";
    const L = "ACKS-" + "LOCATION.sceneSearch.keying.crossing.";
    return {
      steps,
      picks,
      length: read("length", typed.length),
      gap: read("gap", typed.gap),
      depth: read("depth", typed.depth),
      squeezeLength: read("length", typed.squeezeLength),
      larger,
      largerExpected: larger === null ? null : X.hl.readPick("penaltyLarger", larger, { penaltyPick: "larger" }, picks) ?? null,
      swimOptions: [
        { value: "", label: say(L + "unset") },
        { value: "none", label: say(F + "swim.penaltyNone") },
        ...(Array.isArray(steps) ? steps : []).map((size, i) => ({ value: String(size), label: say(F + "swim.penaltyStep", { n: i + 1, size }) })),
        { value: "larger", label: say(F + "swim.penaltyLarger") },
      ],
      shapeOptions: [
        { value: "", label: say(L + "unset") },
        ...X.hl.SQUEEZE_SHAPES.map((value) => ({ value, label: say(F + `squeeze.shape.${value}`) })),
      ],
      labels: { length: say(F + "length"), gap: say(F + "gap"), depth: say(F + "depth"), shape: say(F + "squeeze.shape.label"), penaltyPick: say(F + "swim.penalty"), penaltyLarger: say(F + "swim.largerField") },
      legend: say(L + "legend"),
    };
  },
  /** What the readers say each kind offers: `setupKeysOf` kept to the figures and picks a thing may carry. */
  offered: async ({ keys }) => {
    const X = globalThis.__sc;
    return Object.fromEntries(Object.entries(keys).map(([kind, key]) => [kind, X.kcl.offeredKeys(key, { PARAM_KEYS: X.hl.PARAM_KEYS, PICK_KEYS: X.hl.PICK_KEYS, setupKeysOf: X.hl.setupKeysOf })]));
  },
  /** `crossingSeed` over the place's list as the world reads it, with the picks valid now; the answer is every seed. */
  seed: async ({ placeId }) => {
    const X = globalThis.__sc;
    const place = game.actors.get(placeId);
    const things = X.things.thingsOf(place);
    const keyOf = await X.he.hazardKeyResolver([{ uuid: place.uuid, things }]);
    return X.hl.crossingSeed(things, keyOf, { penaltyPicks: X.hl.penaltyPicksOf(X.swim.waterPenaltySteps()) });
  },

  /** Open the place's sheet on a tab and wait for it. */
  openSheet: async ({ placeId, tab = "things" }) => {
    const H = globalThis.__tk;
    const app = game.actors.get(placeId).sheet;
    app.tabGroups.primary = tab;
    await app.render({ force: true });
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app)?.querySelector("nav.sheet-tabs") ? true : null), { tries: 60, every: 150 });
    await H.sleep(500);
    return { rendered: !!ok };
  },
  closeSheet: async ({ placeId }) => {
    const app = game.actors.get(placeId).sheet;
    if (app.rendered) await app.close({ animate: false });
    return !app.rendered;
  },
  /** The sheet's tabs and the Things here rows, from its DOM; the keying rail count anywhere in the window. */
  sheetSnap: async ({ placeId }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const app = game.actors.get(placeId).sheet;
    const root = app.rendered ? H.root(app) : null;
    if (!root) return null;
    const section = root.querySelector('section.tab[data-tab="things"]');
    return {
      nav: [...root.querySelectorAll("nav.sheet-tabs [data-tab]")].map((a) => a.dataset.tab),
      section: !!section,
      rails: root.querySelectorAll(".acks-extras-keying").length,
      rows: [...(section?.querySelectorAll(".acks-extras-keying-row") ?? [])].map((row) => {
        const open = row.querySelector(".acks-extras-keying-open");
        return { key: open?.dataset.key ?? null, kind: X.txt(row.querySelector(".acks-extras-keying-kind")), open: row.classList.contains("is-open"), hasRail: !!row.querySelector(".acks-extras-keying") };
      }),
    };
  },
  /** The open rail's Crossing fieldset in a window (`kind`: sheet or screen), each control with its name, value, options and tooltip. */
  crossingSnap: async ({ kind, placeId, fid, legend }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const root = H.root(X.appOf(kind, { placeId, fid }));
    const rail = root?.querySelector(".acks-extras-keying");
    if (!rail) return null;
    const sets = [...rail.querySelectorAll("fieldset.acks-extras-keying-set")];
    const fs = sets.find((f) => X.txt(f.querySelector("legend")) === legend) ?? null;
    const fields = fs ? [...fs.querySelectorAll("[data-key-field]")].map((c) => {
      const label = c.closest("label");
      return {
        field: c.dataset.keyField,
        tag: c.tagName.toLowerCase(),
        type: c.type ?? null,
        value: c.value,
        disabled: !!c.disabled,
        tabbable: c.tabIndex >= 0 && !c.disabled,
        label: X.txt(label?.querySelector("span")),
        tip: label?.getAttribute("data-tooltip-text") ?? "",
        options: c.tagName === "SELECT" ? [...c.options].map((o) => ({ value: o.value, label: X.txt(o), selected: o.selected })) : null,
      };
    }) : [];
    const after = fs ? [...rail.children].indexOf(fs) : -1;
    const show = rail.querySelector('[data-action="keyShow"]');
    return { thingId: rail.dataset.thingId, hasFieldset: !!fs, fields, legends: sets.map((f) => X.txt(f.querySelector("legend"))), aboveShow: !!show && fs ? !!(fs.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING) : null, childIndex: after };
  },
  /** Commit a value on a rail control: set it and dispatch a bubbling `change`. */
  setField: async ({ kind, placeId, fid, field, value }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const root = H.root(X.appOf(kind, { placeId, fid }));
    const c = root?.querySelector(`.acks-extras-keying [data-key-field="${field}"]`);
    if (!c) return { found: false };
    if (c.disabled) return { found: true, disabled: true };
    c.value = value;
    c.dispatchEvent(new Event("change", { bubbles: true }));
    return { found: true, disabled: false, value: c.value };
  },
  clickIn: async ({ kind, placeId, fid, sel, nth = 0 }) => {
    const H = globalThis.__tk;
    const X = globalThis.__sc;
    const root = H.root(X.appOf(kind, { placeId, fid }));
    const list = root ? [...root.querySelectorAll(sel)] : [];
    const el = list[nth];
    if (!el) return { found: false, count: list.length };
    el.click();
    return { found: true, count: list.length, disabled: !!el.disabled };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
let gm = null;
let player = null;
const made = [];
const own = { pots: [], messages: [] };
let ids = null;
let rigged = false;
let viewedNeeded = false;
watchdog(() => [gm, player], Number(process.env.WALK_WALL_MS ?? 1_200_000));

async function until(fn, { tries = 40, every = 250 } = {}) {
  for (let n = 0; n < tries; n++) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}
const trackPot = (uuid) => { if (!uuid) return; const u = gm.track(uuid, "Cards"); if (!own.pots.includes(u)) own.pots.push(u); };
const trackMessage = (id) => { if (!id) return; const u = gm.track(id, "ChatMessage"); if (!own.messages.includes(u)) own.messages.push(u); };

/** Claim every chat card this GM client made since `since` (all carry the run's nonce); tracked for the sweep. */
async function claim(since) {
  const list = await run(gm, P.made, { since });
  for (const c of list) trackMessage(c.id);
  return list;
}

/** Make a fight on the walk's scene with unlinked hostile tokens and begin it. */
async function fight({ label, bodies, partyToken, sceneId }) {
  const toks = {};
  for (const [key, spec] of Object.entries(bodies)) {
    const tok = await gm.create("Token", { name: spec.name, actorId: spec.actorId, actorLink: false, x: spec.x, y: spec.y, disposition: -1 }, { parent: `Scene.${sceneId}` });
    made.push(tok.uuid);
    toks[key] = tok;
  }
  const combat = await gm.create("Combat", { scene: sceneId, active: false });
  made.push(combat.uuid);
  const combatId = idOf(combat);
  const rows = {};
  const row0 = await gm.create("Combatant", { tokenId: partyToken.tokenId, sceneId, actorId: partyToken.actorId }, { parent: combat.uuid });
  made.push(row0.uuid);
  for (const key of Object.keys(bodies)) {
    const row = await gm.create("Combatant", { tokenId: idOf(toks[key]), sceneId, actorId: bodies[key].actorId }, { parent: combat.uuid });
    made.push(row.uuid);
    rows[key] = idOf(row);
  }
  await run(gm, P.showChat);
  let view = await run(gm, P.view, { combatId });
  if (view.viewed !== combatId) {
    note(`${label}: the tracker did not show the combat of a scene that is not viewed; the GM seat views the scene`, view);
    view = await run(gm, P.view, { combatId, viewScene: sceneId });
    viewedNeeded = true;
  }
  if (view.viewed !== combatId) throw new Error(`${label}: the tracker does not show this run's combat; Begin Combat is not pressed`);
  const begin = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='startCombat'], .combat-tracker [data-action='startCombat']" }, "Begin Combat");
  let started = await run(gm, P.startFight, { combatId });
  for (let n = 0; n < 16 && !started.started; n++) { await sleep(250); started = await run(gm, P.startFight, { combatId }); }
  if (!started.started) {
    note(`${label}: Begin Combat did not start the combat (a press was found: ${begin.found}); the round is written instead`, begin);
    started = await run(gm, P.startFight, { combatId, start: "update" });
  }
  return { toks, combatId, rows, combat, started };
}

/** Knock the bodies down, end the combat with the tracker's End Combat and its confirm, and read the card the real hook posts. */
async function endFight({ label, f, how, sceneId }) {
  for (const [key, h] of Object.entries(how)) await run(gm, P.defeat, { combatId: f.combatId, combatantId: f.rows[key], how: h });
  await run(gm, P.showChat);
  const viewed = await run(gm, P.view, { combatId: f.combatId, viewScene: viewedNeeded ? sceneId : null });
  if (viewed.viewed !== f.combatId || !viewed.endButton) throw new Error(`${label}: the tracker does not show this run's combat with an End Combat button`);
  const endPress = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='endCombat'], .combat-tracker [data-action='endCombat']" }, "End Combat");
  let yes = { found: false };
  if (endPress.found) {
    await sleep(600);
    yes = await press(gm, PORTS.gm, { scope: "doc", sel: "dialog [data-action='yes'], .application.dialog [data-action='yes']" }, "End Combat's confirm");
  }
  const gone = await run(gm, P.combatGone, { combatId: f.combatId });
  let card = null;
  for (let n = 0; n < 40; n++) { card = await run(gm, P.card, { combatId: f.combatId }); if (card.inCollection && card.rendered) break; await sleep(250); }
  if (card?.id) trackMessage(card.id);
  return { card, ended: endPress.found && yes.found && gone, endPress, yes, gone };
}

/** Press the card's Search the scene with the die held until the session flag appears, and read what it made. */
async function pressCard({ cardId, partyId, settleMs = 1500 }) {
  await run(gm, P.takeNotes);
  const since = await run(gm, P.nowMs);
  await run(gm, P.showChat);
  await run(gm, P.rig, { die: HIT });
  rigged = true;
  let pressed;
  let opened = false;
  try {
    pressed = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${cardId}'] [data-action='searchScene']` }, "the card's Search the scene");
    opened = await run(gm, P.waitSession, { partyId, open: true });
    if (opened) await until(async () => ((await run(gm, P.winOpen, { fid: ids.fid })) ? true : null), { tries: 60, every: 250 });
    await sleep(settleMs);
  } finally {
    await run(gm, P.unrig);
    rigged = false;
  }
  const notes = await run(gm, P.takeNotes);
  const session = await run(gm, P.session, { partyId });
  await claim(since);
  return { pressed, opened, notes, session };
}

/** Run one half of the walk: a half that throws is a failed check of its own and the other half still runs. */
async function half(name, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err);
    check(`the ${name} half ran to its end`, false, String(err?.message ?? err).slice(0, 300));
    return false;
  }
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|screen|treasure|search|keying|crossing|hazard|place-things|region-place/i });
  note("the recorder was attached over each seat's own CDP target and the page reloaded, so it saw init, setup and ready (gm, player seats)", true);
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (Object.keys(setG.failed).length || Object.keys(setP.failed).length) note("modules that did not import (the landed commits are not in the loaded tree)", { gm: setG.failed, player: setP.failed });
  if (!setG.openSheet || !setP.openSheet || !setG.settle) blocked("the open-sheet control (bodyActorOf, settleSheetButtons, openBodySheet) is not in the loaded tree");
  if (!setG.crossing || !setG.readers) blocked("the Crossing fieldset (keying-crossing-logic, hazard-logic's exported readers) is not in the loaded tree");
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch is not on both seats");
  if (!setG.primary) blocked("the GM seat's client is not the primary GM: its deleteCombat hook would not record the fight");
  check("both landed surfaces are in the loaded tree on both seats, and the GM seat is the primary GM", setG.openSheet && setP.openSheet && setG.settle && setG.crossing && setG.readers && setG.primary, { gm: { ...setG, failed: undefined }, player: { openSheet: setP.openSheet } });
  const bootBase = { gm: (await run(gm, P.boot)).length, player: (await run(player, P.boot)).length };
  note("errors the recorder holds at the start of the walk (from load through ready and the seats' setup; gm, player)", bootBase);

  section("stylesheets");
  const probeG = await run(gm, P.sheetProbe);
  const probeP = await run(player, P.sheetProbe);
  note("the recursive stylesheet probe, nested @import sheets included (gm, player); nothing is injected", { gm: probeG, player: probeP });
  const ruleSheetG = await run(gm, P.ruleCount, { hrefPart: "styles/scene-search.css", needle: ".acks-extras-ss-sheet" });
  const ruleTreasureG = await run(gm, P.ruleCount, { hrefPart: "styles/treasure.css", needle: ".acks-extras-treasure-search__sheet" });
  check(
    "styles/scene-search.css and styles/treasure.css are loaded on both seats (found by walking nested @import rules), and each holds a rule for its open-sheet button; no copy was injected",
    probeG.sceneSearch && probeP.sceneSearch && probeG.treasure && probeP.treasure && ruleSheetG > 0 && ruleTreasureG > 0,
    { gm: probeG, player: probeP, sceneRules: ruleSheetG, treasureRules: ruleTreasureG },
  );

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, details: { level: 1 } } });
  const monster = (name, items) => ({ name, type: "monster", items, prototypeToken: { actorLink: false, disposition: -1 } });
  const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const sceneId = idOf(scene);
  await run(gm, P.shapeScene, { sceneId });
  const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party", ownership: { default: 0, [playerId]: 3 } });
  const owner = await gm.fixture(MARKS.owner, "Actor", { ...character(NAMES.owner), ownership: { default: 0, [playerId]: 3 } });
  const mate = await gm.fixture(MARKS.mate, "Actor", { ...character(NAMES.mate), ownership: { default: 0 } });
  const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location" });
  const hostile = await gm.fixture(MARKS.hostile, "Actor", monster(NAMES.hostile, GOODS));
  const hostile2 = await gm.fixture(MARKS.hostile2, "Actor", monster(NAMES.hostile2, GOODS2));
  const crossing = await gm.fixture(MARKS.crossing, "Actor", { name: NAMES.crossing, type: "acks-extras.location", ownership: { default: 2 } });
  const actorIds = { party: idOf(party), owner: idOf(owner), mate: idOf(mate), hostile: idOf(hostile), hostile2: idOf(hostile2) };
  const placeId = idOf(place);
  const crossId = idOf(crossing);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;
  const crossUuid = crossing.uuid ?? `Actor.${crossId}`;
  const { fid, error } = await run(gm, P.formationOf, { partyId: actorIds.party });
  if (error) blocked(error);
  ids = { fid, partyId: actorIds.party, crossId };
  await run(gm, P.endSession, { fid }).catch(() => null);
  const shaped = await run(gm, P.shapeActors, { ids: actorIds, playerId, goods: GOODS, goods2: GOODS2 });
  const floor = await run(gm, P.shapeFloor, { placeId });
  const shape = await run(gm, P.startShape, { fid, partyId: actorIds.party, sceneId, members: [actorIds.owner, actorIds.mate], at: ORIGIN });
  if (shape.fight) blocked("a combat holds the walk's party or its members; it is another session's and is not swept here");
  const where = await run(gm, P.centre, { fid });
  if (!where.token || where.sceneId !== sceneId) blocked("the party token is not on the walk's scene");
  const rect = { x: where.cx - 300, y: where.cy - 200, width: 600, height: 400 };
  const region = await gm.fixture(MARKS.region, "Region", { name: NAMES.region, color: "#336699", shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const regionShape = await run(gm, P.shapeRegion, { uuid: region.uuid, rect });
  const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId });
  const at0 = await run(gm, P.placesAt, { fid });
  const partyToken = { tokenId: shape.tokenId, actorId: shape.tokenActorId };
  check(
    "the kept fight fixtures stand in shape: each hostile is an unlinked monster whose goods are on it once (hit points 9 on the world actor), the Region (no behavior) is linked to the place with its floor, the party holds both characters (the Player seat owns the party and one character) with its token inside the Region, no plan, no session",
    !shaped.hostile.dup && !shaped.hostile2.dup && !shaped.hostile.linked && !shaped.hostile2.linked && GOODS.every((g) => shaped.hostile.names.includes(g.name)) && GOODS2.every((g) => shaped.hostile2.names.includes(g.name))
      && shaped.hostile.hp === 9 && shaped.hostile2.hp === 9 && shaped.ownerOwns && !shaped.mateOwns && shaped.partyOwns
      && floor.type === "acks-extras.location" && floor.things.join() === "floor-1" && regionShape.shapes === 1 && regionShape.behaviors === 0 && linked.linked
      && shape.members.length === 2 && shape.sceneId === sceneId && shape.token && !shape.plan && !shape.session && at0.places.length === 1 && at0.places[0] === NAMES.place,
    { shaped, floor: floor.things, regionShape, linked, shape: { members: shape.members.length, token: shape.token }, at0 },
  );

  const sayL = (key, data) => run(gm, P.say, { root: "loc", key, data });

  /* ================= Half one: the open-sheet control ================= */
  const halfSheet = async () => {
    section("open-sheet 1: a real fight, ended by the tracker, and its card");
    const bodies = { a: { name: NAMES.hostile, actorId: actorIds.hostile, x: 1000, y: 400 }, b: { name: NAMES.hostile2, actorId: actorIds.hostile2, x: 1200, y: 400 } };
    const f1 = await fight({ label: "fight", bodies, partyToken, sceneId });
    check("a combat on the walk's scene began with the party token and the two unlinked hostile tokens, each resolving to its token and actor", f1.started.found && f1.started.started && f1.started.sceneId === sceneId && f1.started.rows.length >= 3 && f1.started.rows.every((r) => r.token && r.actor), f1.started);
    const e1 = await endFight({ label: "fight", f: f1, how: { a: "toggle", b: "hp" }, sceneId });
    const card = e1.card;
    check("End Combat and its confirm were pressed, the combat is gone, and the real deleteCombat hook posted the card on the Judge seat", e1.ended && card.inCollection && card.rendered && card.visible && card.sceneId === sceneId, { end: e1.endPress, yes: e1.yes, gone: e1.gone, card: { rendered: card.rendered, visible: card.visible } });
    const fallenA = card.fallen.find((x) => x.name === NAMES.hostile);
    const fallenB = card.fallen.find((x) => x.name === NAMES.hostile2);
    check("the card lists both fallen bodies, each with its combatant id and an actor uuid that runs through its own token", card.fallen.length === 2 && !!fallenA && !!fallenB && [fallenA, fallenB].every((x) => x.id && x.actorUuid?.includes(".Token.")), card.fallen);
    const tokA = idOf(f1.toks.a);
    const tokB = idOf(f1.toks.b);
    const taA = await run(gm, P.tokenActor, { sceneId, tokenId: tokA, worldId: actorIds.hostile });
    const taB = await run(gm, P.tokenActor, { sceneId, tokenId: tokB, worldId: actorIds.hostile2 });
    check(
      "each body's token has a synthetic actor of its own (a token actor, not the world actor): the second's hit points are 0 where the world actor's are 9, and the card's stored uuid names the token's actor",
      taA.exists && taB.exists && taA.isToken && taB.isToken && taA.differs && taB.differs && taB.hp === 0 && taB.worldHp === 9 && fallenA.actorUuid === taA.uuid && fallenB.actorUuid === taB.uuid && taA.uuid !== taA.worldUuid,
      { a: taA, b: taB, stored: [fallenA.actorUuid === taA.uuid, fallenB.actorUuid === taB.uuid] },
    );

    section("open-sheet 2: the card's buttons (Judge seat)");
    const sheetLabel = (name) => t(gm, "search.sheet.label", { name });
    const sheetTip = await t(gm, "search.sheet.tip");
    const cardBtns = card.sheetButtons;
    const btnOf = (c, id) => c.sheetButtons.find((b) => b.combatant === id);
    check(
      "each fallen row carries one icon-only open-sheet button after its name: a real button with the book icon and no visible text, enabled, its accessible name the lang string with the body's name, its tooltip the lang key whose text is the lang string",
      cardBtns.length === 2 && [fallenA, fallenB].every((x) => { const b = btnOf(card, x.id); return !!b && b.tag === "button" && b.type === "button" && b.icon && b.text === "" && !b.disabled && b.tip === "ACKS-TREASURE.search.sheet.tip" && !!sheetTip && !b.title; }),
      { buttons: cardBtns.map((b) => ({ ...b, aria: undefined })), tipWords: !!sheetTip },
    );
    const ariaA = await sheetLabel(fallenA.name);
    const ariaB = await sheetLabel(fallenB.name);
    check("each button's aria-label is the lang string with its own body's name", btnOf(card, fallenA.id)?.aria === ariaA && btnOf(card, fallenB.id)?.aria === ariaB && ariaA !== ariaB && ariaA.includes(fallenA.name), { a: btnOf(card, fallenA.id)?.aria, b: btnOf(card, fallenB.id)?.aria });

    // A new card is drawn twice: once in the chat log and once in the transient notification popup over it, which moves while it settles. The press goes to the log's copy.
    const sel = (id) => `#chat [data-message-id='${card.id}'] [data-action='openSheet'][data-combatant='${id}']`;
    await run(gm, P.closeAll);
    /** One card button pressed; where no window comes the walk presses once more and says so, so a first press that does nothing is a finding of its own. */
    const pressCardSheet = async (fallen, ta, worldId, label) => {
      await run(gm, P.armClicks, { sel: sel(fallen.id) });
      const first = await press(gm, PORTS.gm, { scope: "doc", sel: sel(fallen.id) }, label);
      let open = await run(gm, P.waitSheet, { uuid: ta.uuid, worldId, tries: 60 });
      let retry = null;
      if (!open.found) {
        note(`${label}: no window within ${open.waitedMs} ms of the first press; the walk presses once more. What the document saw (clicks by target, the matching buttons)`, await run(gm, P.readClicks, { sel: sel(fallen.id) }));
        const again = await press(gm, PORTS.gm, { scope: "doc", sel: sel(fallen.id) }, `${label} (repeat)`);
        open = await run(gm, P.waitSheet, { uuid: ta.uuid, worldId, tries: 60 });
        retry = { press: again, opened: open.found };
      }
      return { first, open, retry };
    };
    const c1a = await pressCardSheet(fallenA, taA, actorIds.hostile, "the card's open-sheet button (first body)");
    check(
      "pressing the first body's card button opened that body's own actor's sheet at the first press (a token actor whose uuid is the stored one and is not the world actor's)",
      c1a.first.found && !c1a.first.disabled && c1a.retry === null && c1a.open.found && c1a.open.docUuid === taA.uuid && c1a.open.isToken && c1a.open.docUuid !== taA.worldUuid && c1a.open.worldRendered === false,
      { press: c1a.first, open: c1a.open, retry: c1a.retry },
    );
    await run(gm, P.closeSheetOf, { uuid: taA.uuid });
    const c1b = await pressCardSheet(fallenB, taB, actorIds.hostile2, "the card's open-sheet button (second body)");
    check(
      "pressing the second body's card button opened its own synthetic actor's sheet at the first press: the window's document uuid is the token actor's, it is a token actor with 0 hit points, and the world actor's sheet is not open",
      c1b.first.found && !c1b.first.disabled && c1b.retry === null && c1b.open.found && c1b.open.docUuid === taB.uuid && c1b.open.isToken && c1b.open.hp === 0 && c1b.open.worldHp === 9 && c1b.open.worldRendered === false,
      { press: c1b.first, open: c1b.open, retry: c1b.retry },
    );
    await run(gm, P.closeSheetOf, { uuid: taB.uuid });

    const cardP = await run(player, P.card, { combatId: f1.combatId, messageId: card.id });
    note("the card on the Player seat (the card is whispered to the Judges)", { inCollection: cardP.inCollection, visible: cardP.visible, rendered: cardP.rendered, buttons: cardP.sheetButtons.length });
    check("the Player seat's chat renders no open-sheet button: the card is not visible to it and not in its chat DOM, so it holds no button", cardP.sheetButtons.length === 0 && cardP.visible !== true && !cardP.rendered, { visible: cardP.visible, rendered: cardP.rendered, buttons: cardP.sheetButtons.length });

    section("open-sheet 3: Search the scene opens the screen; the plate buttons (Judge seat)");
    const a2 = await pressCard({ cardId: card.id, partyId: actorIds.party });
    trackPot(a2.session.potUuid);
    check(
      "the card's press opened a scene search whose bodies are the card's two bodies, each body's stored ref the card's actor uuid",
      a2.pressed.found && a2.session.open && a2.session.bodies.length === 2 && [fallenA, fallenB].every((x) => a2.session.bodies.find((b) => b.id === x.id)?.ref === x.actorUuid),
      { pressed: a2.pressed, bodies: a2.session.bodies.map((b) => [b.id === fallenA.id, b.ref === fallenA.actorUuid || b.ref === fallenB.actorUuid]) },
    );
    await sleep(800);
    const keyA = `body:${fallenA.id}`;
    const keyB = `body:${fallenB.id}`;
    const entries = await run(gm, P.entriesOf, { fid });
    note("the scene's entries (key, kind)", entries.map((e) => [e.key === keyA ? "body A" : e.key === keyB ? "body B" : e.kind, e.kind]));
    const s1 = await run(gm, P.screenState, { fid });
    const plateWord = await sayL("sceneSearch.screen.sheet.button");
    const plateTip = await sayL("sceneSearch.screen.sheet.tip");
    const cA = s1?.cards.find((c) => c.key === keyA);
    const cB = s1?.cards.find((c) => c.key === keyB);
    const nonBody = (s1?.cards ?? []).filter((c) => !c.key.startsWith("body:"));
    const plateAriaA = await sayL("sceneSearch.screen.sheet.label", { name: cA?.name ?? "" });
    check(
      "the Judge's screen draws a Sheet button right of each body's name: the book icon and the word, enabled, its accessible name the lang string with the body's name, its tooltip text the lang string; no card of another kind has one",
      !!s1 && !!cA?.sheet && !!cB?.sheet && [cA, cB].every((c) => c.sheet.icon && c.sheet.text === plateWord && !c.sheet.disabled && c.sheet.tipText === plateTip && c.sheet.key === c.key && ["flex", "inline-flex"].includes(c.sheet.display))
        && cA.sheet.aria === plateAriaA && cA.name === NAMES.hostile && nonBody.every((c) => c.sheet === null) && s1.sheetButtons === 2,
      { buttons: s1?.sheetButtons, a: cA?.sheet && { ...cA.sheet, aria: cA.sheet.aria === plateAriaA }, nonBody: nonBody.length, display: cA?.sheet?.display },
    );
    check("no card is selected before the plate button is pressed and the aside holds no rail", !!s1 && s1.cards.every((c) => !c.selected) && !s1.asideRail, { selected: s1?.cards.filter((c) => c.selected).length, rail: s1?.asideRail });

    for (const u of [taA.uuid, taB.uuid]) await run(gm, P.closeSheetOf, { uuid: u });
    const pressS = await press(gm, PORTS.gm, { scope: "doc", sel: `.acks-extras-ss-sheet[data-key="${keyB}"]` }, "the screen's plate Sheet button (second body)");
    const openS = await run(gm, P.waitSheet, { uuid: taB.uuid, worldId: actorIds.hostile2 });
    const s2 = await run(gm, P.screenState, { fid });
    check(
      "pressing a plate's Sheet button opened the same synthetic actor's sheet as the card's (the document uuid equals the token's actor uuid, hit points 0, the world actor's sheet not open) and selected no card: the selection and the aside are unchanged",
      pressS.found && !pressS.disabled && openS.found && openS.docUuid === taB.uuid && openS.isToken && openS.hp === 0 && openS.worldRendered === false && s2.cards.every((c) => !c.selected) && !s2.asideRail && s2.asideText === s1.asideText,
      { press: pressS, open: openS, selected: s2.cards.filter((c) => c.selected).length, rail: s2.asideRail },
    );
    await run(gm, P.closeSheetOf, { uuid: taB.uuid });
    await run(gm, P.clickScreen, { fid, sel: `.acks-extras-ss-keybtn[data-key="${keyA}"]` });
    const s3 = await until(async () => { const s = await run(gm, P.screenState, { fid }); return s?.cards.find((c) => c.key === keyA)?.selected ? s : null; });
    await press(gm, PORTS.gm, { scope: "doc", sel: `.acks-extras-ss-sheet[data-key="${keyB}"]` }, "the screen's plate Sheet button (second body, with the first selected)");
    const openS2 = await run(gm, P.waitSheet, { uuid: taB.uuid, worldId: actorIds.hostile2 });
    const s4 = await run(gm, P.screenState, { fid });
    check(
      "with the first body selected, pressing the second body's Sheet opens its sheet and the selected entry is still the first: the press did not select the card it is on",
      !!s3 && openS2.found && s4.cards.filter((c) => c.selected).map((c) => c.key).join() === keyA && s4.railThing === s3.railThing,
      { selected: s4.cards.filter((c) => c.selected).map((c) => c.key === keyA), open: openS2.found },
    );
    await run(gm, P.closeSheetOf, { uuid: taB.uuid });

    section("open-sheet 4: the Player seat's screen holds no button");
    const shown = await run(gm, P.show, { fid });
    const playerWin = await until(async () => ((await run(player, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 });
    if (!playerWin) await run(player, P.openScreen, { fid });
    await sleep(800);
    const sp = await run(player, P.screenState, { fid });
    note("the scene was shown to the table (the Player seat's window opened by itself)", { shown: shown.ok, byItself: !!playerWin });
    check(
      "the Player seat's screen lists both bodies and has no open-sheet button of either surface (no [data-action=openSheet], no .acks-extras-ss-sheet) and no keying aside",
      !!sp && sp.cards.some((c) => c.key === keyA) && sp.cards.some((c) => c.key === keyB) && sp.sheetButtons === 0 && sp.sheetClass === 0 && !sp.aside && sp.keyBtns === 0,
      { cards: sp?.cards.length, buttons: sp?.sheetButtons, aside: sp?.aside },
    );
    await run(player, P.closeAll);

    section("open-sheet 5: the first body's token is deleted; both buttons read disabled");
    const ledgerBefore = gm.tracked().some((e) => e.uuid === f1.toks.a.uuid);
    const swept = await gm.sweepTracked({ only: [f1.toks.a.uuid] });
    note("swept (the first body's token, the run's own id)", swept);
    const gone = await until(async () => (!(await run(gm, P.tokenExists, { sceneId, tokenId: tokA })) ? true : null), { tries: 40, every: 250 });
    const worldStill = await run(gm, P.worldExists, { worldId: actorIds.hostile });
    check("the first body's token was in the run's ledger and is gone from the scene by the sweep of its own id; the world actor it was made from is still in the world", ledgerBefore && !!gone && worldStill, { tracked: ledgerBefore, gone: !!gone, worldActor: worldStill });
    await run(gm, P.renderScreen, { fid });
    let redraw = await run(gm, P.redrawCard, { messageId: card.id, method: "log" });
    let cardD = await run(gm, P.card, { combatId: f1.combatId, messageId: card.id });
    if (!redraw.ok || !btnOf(cardD, fallenA.id)?.disabled) {
      note("core's chat log did not redraw the card to the new state; the walk writes a flag on its own card instead", redraw);
      redraw = await run(gm, P.redrawCard, { messageId: card.id, method: "update" });
      cardD = await run(gm, P.card, { combatId: f1.combatId, messageId: card.id });
    }
    note("how the card was drawn again", redraw);
    const sD = await run(gm, P.screenState, { fid });
    const goneTip = await sayL("sceneSearch.screen.sheet.goneTip");
    const dA = sD?.cards.find((c) => c.key === keyA)?.sheet;
    const dB = sD?.cards.find((c) => c.key === keyB)?.sheet;
    check(
      "drawn again, the screen's plate button of the deleted body is disabled with the gone tooltip (and keeps its name and icon), the other body's stays enabled",
      !!dA && dA.disabled && dA.tipText === goneTip && !!goneTip && goneTip !== plateTip && dA.icon && dA.text === plateWord && !!dB && !dB.disabled && dB.tipText === plateTip,
      { a: dA && { disabled: dA.disabled, tipIsGone: dA.tipText === goneTip }, b: dB && { disabled: dB.disabled } },
    );
    check(
      "drawn again, the card's button of the deleted body is disabled and the other body's is enabled",
      !!btnOf(cardD, fallenA.id)?.disabled && btnOf(cardD, fallenB.id)?.disabled === false && cardD.sheetButtons.length === 2,
      { a: btnOf(cardD, fallenA.id)?.disabled, b: btnOf(cardD, fallenB.id)?.disabled },
    );
    await run(gm, P.takeNotes);
    const dead1 = await run(gm, P.scriptedClick, { sel: `.acks-extras-ss-sheet[data-key="${keyA}"]` });
    const dead2 = await run(gm, P.scriptedClick, { sel: sel(fallenA.id) });
    const dead3 = await run(gm, P.deadCheck, { uuid: fallenA.actorUuid, worldId: actorIds.hostile });
    check(
      "pressing either disabled button opens no window, warns nothing and throws nothing; the helpers both buttons call answer false for the deleted body (no sheet, no notice, no error) and never fall back to the world actor's sheet",
      dead1.found && dead1.disabled && dead2.found && dead2.disabled && [dead1, dead2].every((d) => d.newWindows === 0 && d.warns === 0 && d.infos === 0 && d.errors === 0)
        && dead3.exists === false && dead3.opened === false && !dead3.threw && dead3.resolved === "none" && dead3.newWindows === 0 && dead3.warns === 0 && dead3.infos === 0 && dead3.errors === 0 && dead3.worldRendered === false,
      { screen: dead1, card: dead2, helpers: dead3 },
    );
    const live = await run(gm, P.deadCheck, { uuid: fallenB.actorUuid, worldId: actorIds.hostile2 });
    check("the live body is untouched by the deletion: its helper still resolves it and opens its sheet", live.exists === true && live.opened === true && live.newWindows >= 1, live);
    await run(gm, P.closeAll);
    await run(gm, P.endSession, { fid });
    await run(gm, P.closeScreen, { fid });
    await run(player, P.closeScreen, { fid });
  };

  /* ================= Half two: the Crossing fieldset ================= */
  const halfCrossing = async () => {
    section("crossing 1: a place filled by dropping the Hazards pack's items");
    await run(gm, P.endSession, { fid }).catch(() => null);
    await run(gm, P.closeScreen, { fid }).catch(() => null);
    const exp =await run(gm, P.expects, { typed: TYPED });
    const pick = await run(gm, P.hazardPick, { condition: "waterCold" });
    if (!pick.pack) blocked("the Hazards pack (acks-extras.hazards) is not in the world");
    const missingKinds = Object.entries(pick.out).filter(([, v]) => !v.uuid).map(([k]) => k);
    if (missingKinds.length) blocked(`the Hazards pack holds no item for: ${missingKinds.join(", ")}`);
    check(
      "the typed figures are ones the crossing's own readers take (so a figure refused and removed would read as a defect only if it is one)",
      exp.length !== null && exp.gap !== null && exp.depth !== null && exp.squeezeLength !== null && exp.larger !== null && exp.largerExpected !== null,
      { length: exp.length, gap: exp.gap, depth: exp.depth, squeezeLength: exp.squeezeLength, larger: exp.larger, largerExpected: exp.largerExpected },
    );
    const start = await run(gm, P.shapeCrossing, { placeId: crossId });
    const order = ["climb", "jump", "squeeze", "swim", "condition"];
    const dropped = {};
    for (const kind of order) dropped[kind] = await run(gm, P.dropHazard, { placeId: crossId, uuid: pick.out[kind].uuid });
    const thingIds = Object.fromEntries(order.map((k) => [k, dropped[k].last?.id ?? null]));
    const keys = await run(gm, P.keysOf, { placeId: crossId });
    check(
      "the place began empty and five drops of the Hazards pack's items (a climb obstacle, a jump, a squeeze, a swim, a condition) made five things, each of its kind with its own hazard as the ref, each resolving to the pack item's key",
      start.count === 0 && order.every((k, i) => dropped[k].took === true && dropped[k].count === i + 1 && dropped[k].last?.kind === (k === "condition" ? "condition" : "obstacle") && dropped[k].last?.ref === pick.out[k].uuid && keys[thingIds[k]] === pick.out[k].key),
      { counts: order.map((k) => dropped[k].count), kinds: order.map((k) => dropped[k].last?.kind), keys: order.map((k) => keys[thingIds[k]] === pick.out[k].key) },
    );
    await run(gm, P.sentinels, { placeId: crossId, params: SENTINEL_PARAMS, state: SENTINEL_STATE });
    const offered = await run(gm, P.offered, { keys: { climb: pick.out.climb.key, jump: "jump", squeeze: "squeeze", swim: "swim" } });
    check("the editor's own reader offers exactly the board's keys for each kind (climb length and depth, jump gap and depth, squeeze shape and length, swim penalty and larger penalty)", Object.entries(FIELDS).every(([kind, list]) => same(offered[kind], list)), offered);

    const raw = () => run(gm, P.rawThings, { placeId: crossId });
    const waitRaw = (pred, opts) => until(async () => { const l = await raw(); return pred(l) ? l : null; }, opts);
    const rail = (kind) => run(gm, P.crossingSnap, { kind, placeId: crossId, fid, legend: exp.legend });
    const untilRail = (kind, id, pred) => until(async () => { const r = await rail(kind); return r && r.thingId === id && (!pred || pred(r)) ? r : null; }, { tries: 40, every: 250 });
    const fieldOf = (r, f) => r?.fields.find((x) => x.field === f) ?? null;
    const write = (kind, f, value) => run(gm, P.setField, { kind, placeId: crossId, fid, field: f, value });
    const rowSel = (id) => `.acks-extras-keying-open[data-key="thing:${id}"]`;
    const sentinelKept = (thing) => !!thing && same(thing.state, SENTINEL_STATE) && thing.params?.qaSentinel === 7;
    const othersOf = (list, id) => list.filter((x) => x.id !== id);
    /** One write read back: the thing's params after it, the sentinel kept, every other thing as it was. */
    const omit = (obj, keys) => Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !keys.includes(k)));
    /**
     * One write read back. The window draws the rail again after a write, and a
     * select or field the walk set itself already reads the value it wrote, so a
     * read of the rail straight after proves nothing: the walk waits a beat for
     * the redraw, and the callers that need the redraw's proof read a field the
     * write moves (a dependent field), never the one it typed into.
     */
    const wrote = async (id, f, value, pred, touched = [f]) => {
      const before = await raw();
      const baseOthers = othersOf(before, id);
      const baseRest = omit(byId(before, id)?.params, touched);
      await untilRail("sheet", id);
      const set = await write("sheet", f, value);
      const list = await waitRaw((l) => pred(byId(l, id)?.params ?? {}));
      await sleep(1000);
      const params = byId(list, id)?.params ?? null;
      return { set, list, ok: !!list && sentinelKept(byId(list, id)) && same(othersOf(list, id), baseOthers) && same(omit(params, touched), baseRest), params, thing: byId(list, id) };
    };
    const hold = (v) => String(v);

    section("crossing 2: the Things here tab and each obstacle's rail");
    const openS = await run(gm, P.openSheet, { placeId: crossId, tab: "things" });
    const snap0 = await run(gm, P.sheetSnap, { placeId: crossId });
    if (!openS.rendered || !snap0) blocked("the crossing place's sheet did not render");
    check("the Judge's place sheet has a Things here tab listing the five things, each row keyed by its thing", snap0.nav.includes("things") && snap0.section && snap0.rows.length === 5 && order.every((k) => snap0.rows.some((r) => r.key === `thing:${thingIds[k]}`)), { nav: snap0.nav, rows: snap0.rows.map((r) => r.kind) });

    const openRow = async (id) => {
      const cur = await rail("sheet");
      if (cur?.thingId === id) return cur;
      await run(gm, P.clickIn, { kind: "sheet", placeId: crossId, fid, sel: rowSel(id) });
      return untilRail("sheet", id);
    };
    const labelsOk = (r, list) => list.every((f) => { const c = fieldOf(r, f); return !!c && c.label === exp.labels[f] && c.tip.length > 0 && c.tip.includes(exp.labels[f]); });
    const types = { length: "number", gap: "number", depth: "number", penaltyLarger: "number", shape: "select-one", penaltyPick: "select-one" };
    const shapeOk = (r, list) => r.fields.map((x) => x.field).join() === list.join() && list.every((f) => fieldOf(r, f).type === types[f] && fieldOf(r, f).tabbable !== undefined) && r.aboveShow === true;

    const rClimb = await openRow(thingIds.climb);
    check("the climb obstacle's rail offers a Crossing fieldset with Length and Depth, in that order, as number fields with their captions and a tooltip each, enabled, empty, above the Show and Remove buttons", !!rClimb?.hasFieldset && shapeOk(rClimb, FIELDS.climb) && labelsOk(rClimb, FIELDS.climb) && FIELDS.climb.every((f) => !fieldOf(rClimb, f).disabled && fieldOf(rClimb, f).value === ""), rClimb && { fields: rClimb.fields.map((c) => [c.field, c.type, c.value]), legends: rClimb.legends });

    // climb: length written, sentinels kept, blank removes the key
    const w1 = await wrote(thingIds.climb, "length", TYPED.length, (p) => p.length === exp.length);
    check("typing a length on the climb writes `params.length` as the number the crossing's reader takes, and nothing else changed: the sentinel params and state are kept and no other thing moved", w1.ok && w1.params.length === exp.length && w1.params.qaSentinel === 7, { params: w1.params });
    const shown1 = await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "length")?.value === hold(exp.length));
    check("the rail is drawn again showing the stored figure", !!shown1 && fieldOf(shown1, "length").value === hold(exp.length), { value: fieldOf(shown1, "length")?.value });
    const w2 = await wrote(thingIds.climb, "length", "", (p) => !("length" in p));
    check("clearing the field removes the `length` key (the crossing's own default stands), the sentinel kept", w2.ok && !("length" in w2.params) && w2.params.qaSentinel === 7, { params: w2.params });
    await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "length")?.value === "");
    const w2d = await wrote(thingIds.climb, "depth", TYPED.depth, (p) => p.depth === exp.depth);
    check("typing a depth on the climb writes `params.depth`", w2d.ok && w2d.params.depth === exp.depth, { params: w2d.params });
    await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "depth")?.value === hold(exp.depth));
    await wrote(thingIds.climb, "depth", "", (p) => !("depth" in p));
    await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "depth")?.value === "");
    // leave a length for the seed read
    const wL = await wrote(thingIds.climb, "length", TYPED.length, (p) => p.length === exp.length);

    const rJump = await openRow(thingIds.jump);
    check("the jump's rail offers Gap and Depth, in that order, number fields with their captions and tooltips", !!rJump?.hasFieldset && shapeOk(rJump, FIELDS.jump) && labelsOk(rJump, FIELDS.jump), rJump && { fields: rJump.fields.map((c) => [c.field, c.type]) });
    const wG = await wrote(thingIds.jump, "gap", TYPED.gap, (p) => p.gap === exp.gap);
    check("typing a gap on the jump writes `params.gap`; the sentinel is kept", wG.ok && wG.params.gap === exp.gap, { params: wG.params });
    await untilRail("sheet", thingIds.jump, (r) => fieldOf(r, "gap")?.value === hold(exp.gap));
    const wD = await wrote(thingIds.jump, "depth", TYPED.depth, (p) => p.depth === exp.depth);
    await untilRail("sheet", thingIds.jump, (r) => fieldOf(r, "depth")?.value === hold(exp.depth));
    const wD2 = await wrote(thingIds.jump, "depth", "", (p) => !("depth" in p));
    check("typing a depth on the jump writes `params.depth`, and clearing it removes the key", wD.ok && wD.params.depth === exp.depth && wD2.ok && !("depth" in wD2.params) && wD2.params.gap === exp.gap, { typed: wD.params, cleared: wD2.params });
    await untilRail("sheet", thingIds.jump, (r) => fieldOf(r, "depth")?.value === "");

    const rSq = await openRow(thingIds.squeeze);
    const shapeSel = fieldOf(rSq, "shape");
    check(
      "the squeeze's rail offers Shape and Length, in that order: Shape a select whose options are Not set, then each shape the crossing reads, none selected; Length a number field",
      !!rSq?.hasFieldset && shapeOk(rSq, FIELDS.squeeze) && labelsOk(rSq, FIELDS.squeeze) && same((shapeSel?.options ?? []).map((o) => [o.value, o.label]), exp.shapeOptions.map((o) => [o.value, o.label])) && shapeSel.value === "",
      rSq && { options: shapeSel?.options, fields: rSq.fields.map((c) => [c.field, c.type]) },
    );
    const wS = await wrote(thingIds.squeeze, "shape", "chokepoint", (p) => p.shape === "chokepoint");
    check("picking Chokepoint writes `params.shape` as \"chokepoint\"; the sentinel is kept", wS.ok && wS.params.shape === "chokepoint", { params: wS.params });
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "shape")?.value === "chokepoint");
    const wS0 = await wrote(thingIds.squeeze, "shape", "", (p) => !("shape" in p));
    check("picking Not set removes the `shape` key", wS0.ok && !("shape" in wS0.params), { params: wS0.params });
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "shape")?.value === "");
    const wS1 = await wrote(thingIds.squeeze, "shape", "squeeze", (p) => p.shape === "squeeze");
    check("picking Squeeze writes `params.shape` as \"squeeze\"", wS1.ok && wS1.params.shape === "squeeze", { params: wS1.params });
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "shape")?.value === "squeeze");
    const wS2 = await wrote(thingIds.squeeze, "shape", "chokepoint", (p) => p.shape === "chokepoint");
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "shape")?.value === "chokepoint");
    const wSL = await wrote(thingIds.squeeze, "length", TYPED.squeezeLength, (p) => p.length === exp.squeezeLength);
    check("typing a length on the squeeze writes `params.length` beside its shape", wS2.ok && wSL.ok && wSL.params.length === exp.squeezeLength && wSL.params.shape === "chokepoint", { params: wSL.params });
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "length")?.value === hold(exp.squeezeLength));

    const rSw = await openRow(thingIds.swim);
    const pickSel = fieldOf(rSw, "penaltyPick");
    const lg0 = fieldOf(rSw, "penaltyLarger");
    const optionsNow = (pickSel?.options ?? []).map((o) => [o.value, o.label]);
    note("the imported water-penalty steps the world holds (their number)", exp.steps === null ? "none imported" : exp.steps.length);
    check(
      "the swim's rail offers Penalty and Larger penalty, in that order; Penalty's options are Not set, None, one Imported step per imported step (in the importer's order, from waterPenaltySteps) and Larger…, none selected; Larger penalty is a number field and disabled",
      !!rSw?.hasFieldset && shapeOk(rSw, FIELDS.swim) && labelsOk(rSw, FIELDS.swim) && same(optionsNow, exp.swimOptions.map((o) => [o.value, o.label])) && pickSel.value === "" && lg0.disabled === true && lg0.value === "",
      rSw && { options: optionsNow.length, expected: exp.swimOptions.length, larger: lg0 && { disabled: lg0.disabled, value: lg0.value }, steps: exp.steps === null ? null : exp.steps.length },
    );
    if (exp.steps === null) note("the world imported no water-penalty steps: the 'one per imported step' half of the swim select's options is NOT checked (the list is Not set, None, Larger… only)", true);
    else check("the select holds one Imported step row per imported step, each valued with the step's size", exp.steps.length > 0 && exp.steps.every((size, i) => optionsNow.some(([v]) => v === String(size))) && optionsNow.length === exp.steps.length + 3, { steps: exp.steps.length });
    const wP1 = await wrote(thingIds.swim, "penaltyPick", "larger", (p) => p.penaltyPick === "larger");
    check("picking Larger… writes `params.penaltyPick` as \"larger\"; the sentinel is kept", wP1.ok && wP1.params.penaltyPick === "larger", { params: wP1.params });
    const rEn = await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === false);
    check("after the redraw the Larger penalty field is enabled", !!rEn && fieldOf(rEn, "penaltyPick").value === "larger" && fieldOf(rEn, "penaltyLarger").disabled === false, { pick: fieldOf(rEn, "penaltyPick")?.value, disabled: fieldOf(rEn, "penaltyLarger")?.disabled });
    const wP2 = await wrote(thingIds.swim, "penaltyLarger", exp.larger, (p) => p.penaltyLarger === exp.largerExpected);
    check("typing a figure in Larger penalty writes `params.penaltyLarger` as the number the crossing's reader takes", wP2.ok && wP2.params.penaltyLarger === exp.largerExpected && wP2.params.penaltyPick === "larger", { params: wP2.params });
    await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.value === hold(exp.largerExpected));
    if (exp.steps !== null) {
      const stepVal = String(exp.steps[0]);
      const wP3 = await wrote(thingIds.swim, "penaltyPick", stepVal, (p) => p.penaltyPick === stepVal, ["penaltyPick", "penaltyLarger"]);
      const rStep = await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === true);
      check("picking an imported step writes `params.penaltyPick` as its size, removes the larger figure and disables the Larger penalty field again", wP3.ok && wP3.params.penaltyPick === stepVal && !("penaltyLarger" in wP3.params) && fieldOf(rStep, "penaltyLarger").disabled === true && fieldOf(rStep, "penaltyLarger").value === "", { params: wP3.params });
      await wrote(thingIds.swim, "penaltyPick", "larger", (p) => p.penaltyPick === "larger");
      await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === false);
      await wrote(thingIds.swim, "penaltyLarger", exp.larger, (p) => p.penaltyLarger === exp.largerExpected);
      await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.value === hold(exp.largerExpected));
    }
    const wN = await wrote(thingIds.swim, "penaltyPick", "none", (p) => p.penaltyPick === "none", ["penaltyPick", "penaltyLarger"]);
    const rNone = await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === true);
    check("picking None writes `params.penaltyPick` as \"none\" and removes `penaltyLarger`; the Larger penalty field is disabled and empty again", wN.ok && wN.params.penaltyPick === "none" && !("penaltyLarger" in wN.params) && fieldOf(rNone, "penaltyLarger").disabled === true && fieldOf(rNone, "penaltyLarger").value === "", { params: wN.params });
    const refused = await write("sheet", "penaltyLarger", exp.larger);
    await sleep(900);
    const afterRefused = await raw();
    check("the disabled Larger penalty field takes no write: nothing is stored", refused.found && refused.disabled === true && !("penaltyLarger" in (byId(afterRefused, thingIds.swim)?.params ?? {})), { refused });
    // leave the swim at Larger… with a figure for the seed read
    await wrote(thingIds.swim, "penaltyPick", "larger", (p) => p.penaltyPick === "larger");
    await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === false);
    const wP4 = await wrote(thingIds.swim, "penaltyLarger", exp.larger, (p) => p.penaltyLarger === exp.largerExpected);
    await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.value === hold(exp.largerExpected));

    const rCond = await openRow(thingIds.condition);
    check("a condition thing's rail has no Crossing fieldset and no crossing control", !!rCond && rCond.hasFieldset === false && !rCond.legends.includes(exp.legend) && rCond.fields.length === 0, { legends: rCond?.legends });

    section("crossing 3: what is stored is what crossingSeed reads");
    const seed1 = await run(gm, P.seed, { placeId: crossId });
    const seedOf = (seeds, k) => seeds.find((s) => s.thingId === thingIds[k]);
    const has = (setup, key) => Object.prototype.hasOwnProperty.call(setup ?? {}, key);
    check(
      "crossingSeed, called in the page over the place's list with the picks valid now, yields an entry for each of the four obstacles (and none for the condition), each of its kind, with exactly the figures and picks set above: climb length, jump gap, squeeze shape and length, swim pick larger with its figure",
      seed1.length === 4 && seed1.every((s) => s.thingId !== thingIds.condition)
        && seedOf(seed1, "climb")?.kind === pick.out.climb.key && seedOf(seed1, "climb").setup.length === exp.length && !has(seedOf(seed1, "climb").setup, "depth")
        && seedOf(seed1, "jump")?.kind === "jump" && seedOf(seed1, "jump").setup.gap === exp.gap && !has(seedOf(seed1, "jump").setup, "depth")
        && seedOf(seed1, "squeeze")?.kind === "squeeze" && seedOf(seed1, "squeeze").setup.shape === "chokepoint" && seedOf(seed1, "squeeze").setup.length === exp.squeezeLength
        && seedOf(seed1, "swim")?.kind === "swim" && seedOf(seed1, "swim").setup.penaltyPick === "larger" && seedOf(seed1, "swim").setup.penaltyLarger === exp.largerExpected,
      seed1.map((s) => [s.kind === pick.out.climb.key ? "climb" : s.kind, s.setup]),
    );
    const finalList = await raw();
    check("the sentinel params and state are on every thing after every write, so no field wrote a key it does not own", finalList.length === 5 && finalList.every((x) => sentinelKept(x)), { things: finalList.length });
    // The stored values read back through the editor's own reader as the seed reads them: the rail's fields show the same figures.
    const rSwNow = await openRow(thingIds.swim);
    check("the swim's rail, drawn again, shows the pick and the figure the seed read (Larger… and the typed figure, the field enabled)", fieldOf(rSwNow, "penaltyPick")?.value === "larger" && fieldOf(rSwNow, "penaltyLarger")?.value === hold(exp.largerExpected) && fieldOf(rSwNow, "penaltyLarger")?.disabled === false, { pick: fieldOf(rSwNow, "penaltyPick")?.value });

    // A stale pick: a step the world does not import, written through the API.
    const stale = "9876";
    const staleParams = { ...(byId(await raw(), thingIds.swim)?.params ?? {}), penaltyPick: stale };
    delete staleParams.penaltyLarger;
    await run(gm, P.writeParams, { placeId: crossId, id: thingIds.swim, params: staleParams });
    await run(gm, P.closeSheet, { placeId: crossId });
    await run(gm, P.openSheet, { placeId: crossId, tab: "things" });
    const rStale = await openRow(thingIds.swim);
    const seedStale = await run(gm, P.seed, { placeId: crossId });
    check("a stored pick the world does not import is shown as Not set, and crossingSeed carries no pick for it", !!rStale && fieldOf(rStale, "penaltyPick").value === "" && fieldOf(rStale, "penaltyLarger").disabled === true && !has(seedOf(seedStale, "swim")?.setup, "penaltyPick"), { selected: fieldOf(rStale, "penaltyPick")?.value, seeded: has(seedOf(seedStale, "swim")?.setup, "penaltyPick") });

    section("crossing 4: blanking every field, and the seed after it");
    await wrote(thingIds.swim, "penaltyPick", "larger", (p) => p.penaltyPick === "larger");
    await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === false);
    await wrote(thingIds.swim, "penaltyLarger", exp.larger, (p) => p.penaltyLarger === exp.largerExpected);
    await untilRail("sheet", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.value === hold(exp.largerExpected));
    const wB = await wrote(thingIds.swim, "penaltyPick", "", (p) => !("penaltyPick" in p), ["penaltyPick", "penaltyLarger"]);
    check("setting the swim's Penalty back to Not set removes `penaltyPick` and `penaltyLarger` together", wB.ok && !("penaltyPick" in wB.params) && !("penaltyLarger" in wB.params) && wB.params.qaSentinel === 7, { params: wB.params });
    await openRow(thingIds.squeeze);
    await wrote(thingIds.squeeze, "shape", "", (p) => !("shape" in p));
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "shape")?.value === "");
    await wrote(thingIds.squeeze, "length", "", (p) => !("length" in p));
    await untilRail("sheet", thingIds.squeeze, (r) => fieldOf(r, "length")?.value === "");
    await openRow(thingIds.jump);
    await wrote(thingIds.jump, "gap", "", (p) => !("gap" in p));
    await untilRail("sheet", thingIds.jump, (r) => fieldOf(r, "gap")?.value === "");
    await openRow(thingIds.climb);
    await wrote(thingIds.climb, "length", "", (p) => !("length" in p));
    await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "length")?.value === "");
    const seed2 = await run(gm, P.seed, { placeId: crossId });
    const owned = ["length", "gap", "depth", "shape", "penaltyPick", "penaltyLarger"];
    check(
      "with every field blank, crossingSeed carries none of the keys the fieldset owns on any obstacle (the condition thing's own key may remain), and every sentinel is still on its thing",
      seed2.length === 4 && seed2.every((s) => owned.every((k) => !has(s.setup, k))) && (await raw()).every((x) => sentinelKept(x) && owned.every((k) => x.params[k] === undefined || x.params[k] === null)),
      seed2.map((s) => Object.keys(s.setup)),
    );
    await wrote(thingIds.climb, "length", TYPED.length, (p) => p.length === exp.length);
    await untilRail("sheet", thingIds.climb, (r) => fieldOf(r, "length")?.value === hold(exp.length));
    await run(gm, P.closeSheet, { placeId: crossId });

    section("crossing 5: the scene screen's aside");
    const opened = await run(gm, P.openPlain, { fid, placeUuid: crossUuid, sceneId });
    let screenOpen = false;
    if (opened.ok) {
      await run(gm, P.openScreen, { fid });
      screenOpen = !!(await until(async () => ((await run(gm, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 }));
    }
    if (!opened.ok || !screenOpen) {
      note("a session could not be opened at the crossing place, so the aside's fieldset is NOT checked", opened);
      check("a scene search session opened at the crossing place and its screen rendered", false, opened);
    } else {
      const screenKey = (k) => `.acks-extras-ss-keybtn[data-key="thing:${thingIds[k]}"]`;
      const asideRail = async (k) => {
        await run(gm, P.clickScreen, { fid, sel: screenKey(k) });
        return untilRail("screen", thingIds[k]);
      };
      const entries = await run(gm, P.entriesOf, { fid });
      check("the screen lists a card for each obstacle thing (selectable by its name)", order.slice(0, 4).every((k) => entries.some((e) => e.key === `thing:${thingIds[k]}`)), { entries: entries.map((e) => e.kind) });
      const aClimb = await asideRail("climb");
      check("selecting the climb's card fills the aside with the same Crossing fieldset (Length and Depth) with the figure stored on the place (the field's value is the one the sheet wrote)", !!aClimb?.hasFieldset && shapeOk(aClimb, FIELDS.climb) && labelsOk(aClimb, FIELDS.climb) && fieldOf(aClimb, "length").value === hold(exp.length), aClimb && { fields: aClimb.fields.map((c) => [c.field, c.value]) });
      // A figure written to the place from outside the window: the aside draws it fresh.
      await run(gm, P.writeParams, { placeId: crossId, id: thingIds.climb, params: { ...(byId(await raw(), thingIds.climb)?.params ?? {}), depth: exp.depth } });
      const aFresh = await untilRail("screen", thingIds.climb, (r) => fieldOf(r, "depth")?.value === hold(exp.depth));
      check("a figure written to the place meanwhile is what the aside shows once it draws again", !!aFresh && fieldOf(aFresh, "depth").value === hold(exp.depth),{ depth: fieldOf(aFresh, "depth")?.value });
      const wA = await (async () => {
        const base = await raw();
        const set = await write("screen", "length", "");
        const list = await waitRaw((l) => !("length" in (byId(l, thingIds.climb)?.params ?? {})));
        return { set, ok: !!list && sentinelKept(byId(list, thingIds.climb)) && same(othersOf(list, thingIds.climb), othersOf(base, thingIds.climb)), params: byId(list, thingIds.climb)?.params ?? null };
      })();
      check("blanking Length in the aside removes the key from the place's list, the sentinel kept and no other thing changed", wA.set.found && wA.ok && !("length" in wA.params) && wA.params.depth === exp.depth, { params: wA.params });
      await untilRail("screen", thingIds.climb, (r) => fieldOf(r, "length")?.value === "");
      const aSwim = await asideRail("swim");
      check("selecting the swim's card shows its Penalty select with the same options (Not set, None, one per imported step, Larger…) and Larger penalty", !!aSwim?.hasFieldset && shapeOk(aSwim, FIELDS.swim) && same((fieldOf(aSwim, "penaltyPick")?.options ?? []).map((o) => [o.value, o.label]), exp.swimOptions.map((o) => [o.value, o.label])), aSwim && { options: fieldOf(aSwim, "penaltyPick")?.options.length });
      const wAp = await (async () => {
        const set = await write("screen", "penaltyPick", "larger");
        const list = await waitRaw((l) => byId(l, thingIds.swim)?.params?.penaltyPick === "larger");
        return { set, params: byId(list, thingIds.swim)?.params ?? null };
      })();
      const aEn = await untilRail("screen", thingIds.swim, (r) => fieldOf(r, "penaltyLarger")?.disabled === false);
      check("picking Larger… in the aside writes the pick and enables Larger penalty after the redraw", wAp.set.found && wAp.params?.penaltyPick === "larger" && !!aEn, { params: wAp.params });
      const aSq = await asideRail("squeeze");
      check("selecting the squeeze's card shows Shape and Length; selecting the jump's shows Gap and Depth", !!aSq?.hasFieldset && shapeOk(aSq, FIELDS.squeeze) && !!(await asideRail("jump"))?.hasFieldset, { squeeze: aSq?.fields.map((c) => c.field) });
      const sS = await run(gm, P.screenState, { fid });
      await run(gm, P.clickScreen, { fid, sel: `.acks-extras-ss-keybtn[data-key="thing:${thingIds.condition}"]` });
      const aCond = await untilRail("screen", thingIds.condition);
      check("the condition's card selected, the aside holds no Crossing fieldset", !!sS && !!aCond && aCond.hasFieldset === false, { legends: aCond?.legends });

      section("crossing 6: the Player seat");
      const shown = await run(gm, P.show, { fid });
      const playerWin = await until(async () => ((await run(player, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 });
      if (!playerWin) await run(player, P.openScreen, { fid });
      await sleep(800);
      const sp = await run(player, P.screenState, { fid });
      note("the scene was shown to the table", { shown: shown.ok, byItself: !!playerWin });
      check("the Player seat's screen has no aside, no rail and no keying control: its cards' names are text", !!sp && !sp.aside && !sp.asideRail && sp.keyBtns === 0 && sp.cards.length >= 1,{ aside: sp?.aside, keyBtns: sp?.keyBtns, cards: sp?.cards.length });
      await run(player, P.closeScreen, { fid });
    }
    await run(gm, P.endSession, { fid });
    await run(gm, P.closeScreen, { fid });
    const openP = await run(player, P.openSheet, { placeId: crossId, tab: "things" });
    const spSheet = await run(player, P.sheetSnap, { placeId: crossId });
    check("the Player seat opens the place's sheet (Observer) and it has no Things here tab, no section for it and no keying rail", openP.rendered && !!spSheet && !spSheet.nav.includes("things") && !spSheet.section && spSheet.rails === 0, { nav: spSheet?.nav, rails: spSheet?.rails });
    await run(player, P.closeSheet, { placeId: crossId });
  };

  const okSheet = await half("open-sheet", halfSheet);
  const okCross = await half("crossing", halfCrossing);

  section("console");
  for (const [key, api, base] of [["gm", gm, bootBase.gm], ["player", player, bootBase.player]]) {
    const drained = await run(api, P.drain);
    const boot = await run(api, P.boot);
    note(`${key}: every error the recorder holds (from load through the walk's end)`, boot);
    check(`${key}: no console error from the page's load through the walk's end (the recorder was attached before the page's first script: ${boot.length} recorded in all, ${boot.length - base} since the walk began)`, !drained.errors.length && boot.length === 0, { driven: drained.errors.slice(0, 3), recorded: boot.slice(0, 3) });
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  if (okSheet && okCross) walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (rigged || gm) await run(gm, P.unrig); } catch {}
  for (const [name, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, P.closeAll); } catch {}
    try { if (ids) await run(api, P.closeScreen, { fid: ids.fid }); } catch {}
    try { if (ids) await run(api, P.closeSheet, { placeId: ids.crossId }); } catch {}
    try { note(`restored (${name})`, await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { if (ids) await run(gm, P.endSession, { fid: ids.fid }); } catch {}
    try { await claim(0); } catch {}
    try { await run(gm, P.unhook); } catch {}
    // Only the run's own ids: the tokens, the combat, the combatants, the cards and the pot. Kept fixtures stay.
    try {
      const only = unique([...made, ...own.pots, ...own.messages]).filter((uuid) => gm.tracked().some((e) => e.uuid === uuid));
      note("swept (the run's own ids)", await gm.sweepTracked({ only }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
