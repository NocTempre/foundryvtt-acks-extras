/**
 * Live walk, search the fallen and the scene search's ways in (slice S5). Walks
 * docs/scene-search/TESTING.md "S5 — the ways in", steps 1 to 7, and
 * docs/treasure/TESTING.md "Search the fallen", on both seats. A real fight is
 * ended by the tracker's own End Combat button and its confirm, so the real
 * `deleteCombat` hook fires on the primary GM's client; nothing here calls the
 * hook. The card's Search the scene is a real pointer press, as is the party
 * sheet's Search here on both seats. Every observable is a boolean, a count or
 * a string the module's own lang file produced. Machine values arrive through
 * ./_env.mjs by way of the treasure kit; every figure typed into a fixture is
 * invented.
 *
 * Order: seats and fixtures; a fight on the walk's scene (the party's token
 * stands in the place's Region), its card (rows, letter, table, note, the
 * Player seat sees none); Search the scene (the screen opens "After the
 * battle", the pot holds the bodies' goods, the letter's lot and the table's
 * item as unfound lots, the carried goods leave the bodies when the pot opens,
 * the table is drawn once and posts no chat message, its text result is listed
 * on the card); the card pressed again (same screen, no second pot, the table
 * not drawn again); the session ended and the card refused; the Judge's Search
 * here on the Dungeon tab (a session with no fight and no pot, pressed again
 * brings the same screen forward, an assigned member shows on the Turn plan);
 * the Player seat's Search here (one declaration card, nothing opened or
 * moved); the Judge accepting (the session opens, the Player seat's screen
 * follows Show the scene); the party token moved out of every area and a
 * fresh fight's card refused with the no-place notice, then pressable again
 * with the token back; the console on both seats; teardown.
 *
 * Fixtures, kept and found by marker: `scene-search/ways-scene`,
 * `scene-search/ways-region`, `scene-search/ways-place` (a location actor
 * linked to the Region, one floor), `scene-search/ways-party` (the Player seat
 * owns the party actor), `scene-search/ways-owner` (a character the Player
 * seat owns) and `scene-search/ways-mate`; `scene-search/ways-hostile` (a
 * monster with a goods item, a coin row, a natural-weapon row and a treasure
 * letter), `scene-search/ways-hostile-2` (a monster with a linked table and no
 * goods), `scene-search/ways-table` (an item result and a text result sharing
 * one range, so one draw yields both) and `scene-search/ways-table-item` (the
 * item the first result points at). The tokens, the combats, the cards and the
 * pots are NOT kept: each run makes its own, tracked by id and swept by id.
 *
 * Scripted, not gestured: the knock-down (the tracker's defeat toggle
 * replayed for one body, a hit-point write for the other), the move of the
 * party token, the Judge's assign, and the die (held through
 * `CONFIG.Dice.randomUniform` around each card press and restored in
 * `finally`).
 *
 * Not reached: a Player seat owning no member (the walk has one Player
 * seat), a second Judge seat reading the card once, the card's button label
 * after a world reload, the take-off when a body's token was deleted between
 * the fight and the press.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, t, idOf, sleep, press, clicks, checks } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/ways-scene",
  region: "scene-search/ways-region",
  place: "scene-search/ways-place",
  party: "scene-search/ways-party",
  owner: "scene-search/ways-owner",
  mate: "scene-search/ways-mate",
  hostile: "scene-search/ways-hostile",
  hostile2: "scene-search/ways-hostile-2",
  table: "scene-search/ways-table",
  tableItem: "scene-search/ways-table-item",
};
const NAMES = {
  scene: "QA Ways Scene",
  region: "QA Ways Region",
  place: "QA Ways Place",
  party: "QA Ways Party",
  owner: "QA Ways Owner",
  mate: "QA Ways Mate",
  hostile: "QA Ways Hostile",
  hostile2: "QA Ways Hostile Two",
  table: "QA Ways Table",
  tableItem: "QA Ways Table Prize",
  tableText: "QA Ways Table Note",
};
const GOODS = [
  { name: "QA Ways Trinket", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 30 } },
  { name: "QA Ways Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 12 } },
  { name: "QA Ways Claw", type: "weapon", img: "icons/svg/sword.svg", system: { cost: 0 }, flags: { "acks-extras": { naturalWeapon: true } } },
];
const CARRIED = [GOODS[0].name, GOODS[1].name];
const NATURAL = GOODS[2].name;
const NONCE = "tws" + Math.random().toString(36).slice(2, 7);
const HIT = 0.025;
const ORIGIN = { x: 400, y: 400 };
const OUT = { x: 2600, y: 1200 };

const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  ...KIT,

  /** The modules the page functions below reach, the window finder, and, on the GM seat, a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__tw = globalThis.__tw ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.around = await import(`${base}location/places-around.mjs`);
    X.pot = await import(`${base}treasure/pot.mjs`);
    X.consts = await import(`${base}scene-search/constants.mjs`);
    X.util = await import(`${base}lib/util.mjs`);
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    if (game.user.isGM && !X.cards) {
      X.cards = [];
      X.hooks = [
        ["preCreateChatMessage", Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); })],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => {
          if (m.flags?.world?.qaNonce !== nonce) return;
          X.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), table: !!m.flags?.core?.RollTable, html: `${m.flavor ?? ""} ${m.content ?? ""}` });
        })],
      ];
    }
    await X.util.primaryGMSettled?.();
    const api = globalThis.acksExtras?.sceneSearch;
    return {
      api: typeof api?.open === "function" && typeof api?.searchHere === "function" && typeof api?.openScreen === "function",
      primary: !!X.util.isPrimaryGM?.(),
      reasons: ["noPartyHere", "noPlaceHere", "cardSpent"].every((k) => typeof X.consts.WAYS_REFUSAL?.[{ noPartyHere: "NO_PARTY_HERE", noPlaceHere: "NO_PLACE_HERE", cardSpent: "CARD_SPENT" }[k]] === "string"),
    };
  },
  unhook: async () => {
    const X = globalThis.__tw;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  /** The cards this GM client made since `since`, each with whether it is a table draw's card, and the text it carries. */
  made: async ({ since = 0 } = {}) => (globalThis.__tw.cards ?? []).filter((c) => c.at >= since).map((c) => ({ id: c.id, uuid: c.uuid, table: c.table, html: c.html })),
  /** A word of the module's own lang file, formatted where it carries data. */
  say: async ({ key, data } = {}) => (data && Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key)),
  /** What the module words a scene refusal as. */
  reasonText: async ({ reason } = {}) => acksExtras.sceneSearch.reasonText(reason),
  refusal: async ({ name } = {}) => globalThis.__tw.consts.WAYS_REFUSAL[name],
  boot: async () => (globalThis.__tkBoot?.errors ?? []).map((e) => `${e.kind}: ${e.text}`),

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
  rig: async ({ die }) => {
    const X = globalThis.__tw;
    if (!X.orig) X.orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    return true;
  },
  unrig: async () => {
    const X = globalThis.__tw;
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
    const X = globalThis.__tw;
    const H = globalThis.__tk;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** The kept actors at the shape the steps start from: ownership, the hostiles' letter, table and token disposition, the goods once each. */
  shapeActors: async ({ ids, playerId, letter, tableUuid, goods, ownerLevel }) => {
    const wrote = [];
    const owner = game.actors.get(ids.owner);
    const mate = game.actors.get(ids.mate);
    const party = game.actors.get(ids.party);
    const own = async (actor, level) => { if ((actor.ownership?.[playerId] ?? 0) !== level) { await actor.update({ [`ownership.${playerId}`]: level, "ownership.default": 0 }); wrote.push(`${actor.name}:ownership`); } };
    await own(owner, ownerLevel);
    await own(mate, 0);
    await own(party, 3);
    for (const [key, a] of [["hostile", game.actors.get(ids.hostile)], ["hostile2", game.actors.get(ids.hostile2)]]) {
      const want = key === "hostile" ? { type: letter, table: "" } : { type: "", table: `@UUID[${tableUuid}]` };
      const t0 = a.system?.details?.treasure ?? {};
      if ((t0.type ?? "") !== want.type || (t0.table ?? "") !== want.table) { await a.update({ "system.details.treasure.type": want.type, "system.details.treasure.table": want.table }); wrote.push(`${key}:treasure`); }
      if (a.prototypeToken.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE || a.prototypeToken.actorLink) { await a.update({ "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE, "prototypeToken.actorLink": false }); wrote.push(`${key}:token`); }
    }
    const h = game.actors.get(ids.hostile);
    const have = new Set(h.items.map((i) => i.name));
    const miss = goods.filter((i) => !have.has(i.name));
    if (miss.length) { await h.createEmbeddedDocuments("Item", miss); wrote.push("hostile:goods"); }
    const names = h.items.map((i) => i.name).sort();
    const tr = h.system.details.treasure;
    const tr2 = game.actors.get(ids.hostile2).system.details.treasure;
    return {
      wrote,
      names,
      dup: h.items.size !== new Set(names).size,
      letter: tr.type,
      tableBlank: (tr.table ?? "") === "",
      linked: (tr2.table ?? "").includes(tableUuid) && (tr2.type ?? "") === "",
      hostile2Items: game.actors.get(ids.hostile2).items.size,
      ownerOwns: owner.testUserPermission(game.users.get(playerId), "OWNER"),
      mateOwns: mate.testUserPermission(game.users.get(playerId), "OWNER"),
      partyOwns: party.testUserPermission(game.users.get(playerId), "OWNER"),
    };
  },
  /** The linked table at its start shape: formula 1d1, replacement on, an item result and a text result sharing the one range. Answers what it reads back. */
  shapeTable: async ({ tableId, itemUuid, textName }) => {
    const table = game.tables.get(tableId);
    const results = () => table.results.contents.map((r) => ({ type: r.type, uuid: r.documentUuid ?? null, name: r.name ?? "", text: r.text ?? "", range: [...(r.range ?? [])] }));
    const ok = () => {
      const r = results();
      return table.formula === "1d1" && table.replacement === true && r.length === 2
        && r.some((x) => x.uuid === itemUuid && x.range.join() === "1,1") && r.some((x) => !x.uuid && x.range.join() === "1,1" && (x.name === textName || x.text === textName));
    };
    let rewrote = false;
    if (!ok()) {
      if (table.results.size) await table.deleteEmbeddedDocuments("TableResult", table.results.map((r) => r.id));
      await table.update({ formula: "1d1", replacement: true });
      await table.createEmbeddedDocuments("TableResult", [
        { type: "document", documentUuid: itemUuid, name: "QA Ways Table Prize", range: [1, 1], weight: 1 },
        { type: "text", name: textName, range: [1, 1], weight: 1 },
      ]);
      rewrote = true;
    }
    if (table.results.some((r) => r.drawn)) await table.resetResults();
    return { rewrote, ok: ok(), results: results(), formula: table.formula };
  },
  /** The place's list written whole: one floor. */
  shapePlace: async ({ placeId }) => {
    const a = game.actors.get(placeId);
    const things = [{ id: "floor-1", kind: "floor", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} }];
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((x) => x.id) };
  },
  /** The party at its start shape: both characters in it, its token on the scene at `at`, no plan, no session, no combat. */
  startShape: async ({ fid, partyId, sceneId, members, at }) => {
    const X = globalThis.__tw;
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
  /** Where the party token's centre is. */
  centre: async ({ fid }) => {
    const X = globalThis.__tw;
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const { tokenCentre } = await import("/modules/acks-extras/scripts/lib/token-centre.mjs");
    const c = tokenCentre(token, scene, token._source ?? token);
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y, x: token.x, y: token.y };
  },
  shapeRegion: async ({ uuid, rect }) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  linkPlace: async ({ regionUuid, placeId }) => {
    const X = globalThis.__tw;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  /** Which places hold the party token now, and the token's position. */
  placesAt: async ({ fid }) => {
    const X = globalThis.__tw;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    if (!token) return { token: false, places: [] };
    return { token: true, x: token.x, y: token.y, places: X.around.placesAround(token, token.parent).map((p) => ({ name: p.place.name, area: p.area })) };
  },
  moveToken: async ({ fid, x, y }) => {
    const X = globalThis.__tw;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    if (!token) return { moved: false };
    await token.update({ x, y }, { animate: false });
    await globalThis.__tk.sleep(600);
    const after = X.model.getPartyToken(X.model.getFormation(fid));
    return { moved: true, x: after.x, y: after.y };
  },
  /** Is the screen's stylesheet among the page's sheets? With `inject`, add it with a cache-buster when absent. */
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

  /* ---- The fight -------------------------------------------------------- */
  startFight: async ({ combatId, start = null }) => {
    const c = game.combats.get(combatId);
    if (!c) return { found: false };
    if (start === "update") await c.update({ round: 1, turn: 0 });
    return { found: true, started: !!c.started, sceneId: c.scene?.id ?? null, rows: c.combatants.map((x) => ({ id: x.id, name: x.name, token: !!x.token, actor: !!x.actor, disposition: x.token?.disposition ?? null })) };
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

  /** The search card of a fight, as this seat holds and renders it. */
  card: async ({ combatId, messageId = null }) => {
    const H = globalThis.__tk;
    const m = messageId ? game.messages.get(messageId) : game.messages.find((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId);
    const li = m ? document.querySelector(`[data-message-id='${m.id}']`) : null;
    const flag = m?.flags?.["acks-extras"]?.treasureSearch ?? null;
    const wrap = li?.querySelector("[data-field='textWrap']");
    return {
      inCollection: !!m,
      messages: game.messages.filter((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId).length,
      id: m?.id ?? null,
      visible: m ? !!m.visible : null,
      rendered: !!li,
      sceneId: flag?.sceneId ?? null,
      opened: flag?.opened === true,
      drawnText: flag?.drawnText ?? [],
      drawnBy: Object.fromEntries(Object.entries(flag?.drawnBy ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : null])),
      fallen: (flag?.fallen ?? []).map((e) => ({ id: e.combatantId, name: e.name, goods: e.goods?.length ?? 0, letter: e.letter ?? null, tableUuid: e.tableUuid ?? null, actorUuid: e.actorUuid })),
      rows: [...(li?.querySelectorAll(".acks-extras-treasure-search__list > li") ?? [])].map((r) => ({
        name: H.text(r.querySelector(".acks-extras-treasure-search__name")),
        items: H.text(r.querySelector(".acks-extras-treasure-search__items")),
        letter: H.text(r.querySelector(".acks-extras-treasure-search__letter")),
        table: H.text(r.querySelector(".acks-extras-treasure-search__table")),
      })),
      stageButton: !!li?.querySelector("[data-action='stagePot']"),
      note: H.text(li?.querySelector(".acks-extras-treasure-search__note")),
      button: H.text(li?.querySelector("[data-action='searchScene']")),
      textShown: !!wrap && !wrap.hidden,
      textWrap: wrap ? { attr: wrap.hasAttribute("hidden"), prop: wrap.hidden, display: getComputedStyle(wrap).display, height: wrap.offsetHeight, html: wrap.outerHTML.slice(0, 140) } : null,
      textLines: [...(li?.querySelectorAll("[data-field='text'] li") ?? [])].map((x) => H.text(x)),
    };
  },
  anySearchCardInLog: async () => document.querySelectorAll(".acks-extras-treasure-search").length,
  /** The scene search flag on the party actor: what is open, its pot and its fight's card. */
  session: async ({ partyId }) => {
    const f = game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ?? null;
    return f ? { open: true, potUuid: f.potUuid ?? null, recordMessageId: f.recordMessageId ?? null, shown: f.shown === true, bodies: (f.bodies ?? []).map((b) => b.id), lots: (f.lots ?? []).map((l) => ({ key: l.key, thing: l.thing, cardId: l.cardId })), placeUuid: f.placeUuid ?? null } : { open: false };
  },
  /** Wait for the party's session flag to appear (or vanish). */
  waitSession: async ({ partyId, open = true, tries = 80 }) => {
    const H = globalThis.__tk;
    const got = await H.poll(() => (!!game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") === open ? true : null), { tries, every: 250 });
    return !!got;
  },
  /** How many pots the world holds now, and the ids of those not in `known`. */
  pots: async ({ known = [] } = {}) => {
    const now = game.cards.filter((c) => !!c.flags?.["acks-extras"]?.treasure);
    return { count: now.length, fresh: now.map((c) => c.uuid).filter((u) => !known.includes(u)), all: now.map((c) => c.uuid) };
  },
  /** The pot at a uuid: phase, origin, every card's found flag, lot key and the name of the item it was made from. */
  potView: async ({ potUuid }) => {
    const X = globalThis.__tw;
    const pile = await fromUuid(potUuid);
    if (!pile) return null;
    const flag = pile.getFlag("acks-extras", "treasure") ?? {};
    const view = X.pot.viewOf(pile);
    return {
      phase: flag.phase ?? null,
      messageId: flag.messageId ?? null,
      origin: flag.origin ? { kind: flag.origin.kind ?? null, takeOff: flag.origin.takeOff === true, takenOff: flag.origin.takenOff === true, carried: Object.keys(flag.origin.carried ?? {}).length } : null,
      cards: view.cards.map((c) => ({ id: c.id, found: c.truth?.found, lot: c.truth?.lot ?? null, face: c.face ?? null, source: pile.cards.get(c.id)?.getFlag("acks-extras", "card")?.source?.data?.name ?? null })),
    };
  },
  waitPot: async ({ potUuid, until }) => {
    const H = globalThis.__tk;
    const met = async () => {
      const pile = await fromUuid(potUuid);
      const f = pile?.getFlag("acks-extras", "treasure") ?? {};
      if (until === "open") return f.phase === "open";
      if (until === "takenOff") return f.origin?.takenOff === true;
      return false;
    };
    return { met: !!(await H.poll(met, { tries: 60, every: 250 })) };
  },
  /** For each card of an origin's `carried`: the card's own name and the name of the body's item the map points at. */
  carriedNames: async ({ potUuid }) => {
    const pile = await fromUuid(potUuid);
    const carried = pile?.getFlag("acks-extras", "treasure")?.origin?.carried ?? {};
    return Object.entries(carried).map(([cardId, ref]) => {
      let doc = null;
      try { doc = fromUuidSync(ref.actorUuid); } catch { doc = null; }
      const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
      return { card: pile.cards.get(cardId)?.getFlag("acks-extras", "card")?.source?.data?.name ?? null, bodyName: actor?.name ?? null, item: actor?.items.get(ref.itemId)?.name ?? null, itemStillThere: !!actor?.items.get(ref.itemId) };
    });
  },
  /** The names a body (an actor or an unlinked token's actor, by uuid) carries. */
  body: async ({ actorUuid }) => {
    let doc = null;
    try { doc = fromUuidSync(actorUuid); } catch { doc = null; }
    const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
    return { exists: !!actor, items: actor ? actor.items.map((i) => i.name).sort() : [] };
  },
  waitBody: async ({ actorUuid, gone, kept }) => {
    const H = globalThis.__tk;
    const read = () => {
      let doc = null;
      try { doc = fromUuidSync(actorUuid); } catch { doc = null; }
      const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
      const names = actor ? actor.items.map((i) => i.name) : [];
      H.lastBody = [...names].sort();
      return actor && gone.every((n) => !names.includes(n)) && kept.every((n) => names.includes(n)) ? true : null;
    };
    return { met: !!(await H.poll(read, { tries: 40, every: 250 })), last: H.lastBody ?? null };
  },

  /* ---- The scene screen -------------------------------------------------- */
  winState: async ({ fid }) => {
    const H = globalThis.__tk;
    const X = globalThis.__tw;
    const app = X.win(fid);
    const root = app ? H.root(app) : null;
    if (!root) return { open: false };
    const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (sel) => root.querySelector(sel);
    const qa = (sel) => [...root.querySelectorAll(sel)];
    if (app && !H.opened.includes(app)) H.opened.push(app);
    const spans = qa(".acks-extras-ss-count > span");
    return {
      open: !!app.rendered,
      place: txt(q(".acks-extras-ss-place")),
      seat: txt(q(".acks-extras-ss-seat")),
      cap: txt(q(".acks-extras-ss-cap")),
      found: txt(spans[0]),
      cards: qa(".acks-extras-ss-card").map((c) => ({ key: c.dataset.dropEntry, plate: txt(c.querySelector(".acks-extras-ss-plate")) })),
      tray: qa(".acks-extras-ss-back").map((b) => ({ wait: b.classList.contains("is-wait") })),
      sameAs: X.prevWin === app,
    };
  },
  /** Remember the window instance now open, to tell a second press that comes forward from one that opens another. */
  markWin: async ({ fid }) => { const X = globalThis.__tw; X.prevWin = X.win(fid); return !!X.prevWin; },
  waitWin: async ({ fid }) => {
    const H = globalThis.__tk;
    const X = globalThis.__tw;
    const app = await H.poll(() => { const a = X.win(fid); return a?.rendered && H.root(a) ? a : null; }, { tries: 80, every: 250 });
    if (app && !H.opened.includes(app)) H.opened.push(app);
    await H.sleep(500);
    return !!app;
  },
  closeScreen: async ({ fid }) => { const app = globalThis.__tw.win(fid); if (app) await app.close({ animate: false }); return !globalThis.__tw.win(fid); },
  endSession: async ({ fid }) => { const r = await acksExtras.sceneSearch.end(fid); return { ok: r.ok === true, reason: r.reason ?? null }; },
  show: async ({ fid }) => { const r = await acksExtras.sceneSearch.show(fid); return { ok: r.ok === true }; },
  assign: async ({ fid, actorId, entryKey }) => { const r = await acksExtras.sceneSearch.assign({ partyId: fid, actorId, layer: "hasty", entryKey }); return { ok: r.ok === true, reason: r.reason ?? null }; },
  unassign: async ({ fid, actorId }) => { const r = await acksExtras.sceneSearch.unassign({ partyId: fid, actorId }); return { ok: r.ok === true }; },

  /* ---- The party sheet's Dungeon tab ------------------------------------- */
  openSheet: async ({ partyId }) => {
    const H = globalThis.__tk;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="mode"]')?.click();
    await H.sleep(400);
    if (!H.opened.includes(app)) H.opened.push(app);
    return { rendered: !!H.root(app), editable: !!app.isEditable };
  },
  sheetState: async ({ partyId, actorId, watch }) => {
    const H = globalThis.__tk;
    const root = H.root(game.actors.get(partyId).sheet);
    if (!root) return { rendered: false };
    const btn = root.querySelector('[data-action="searchHere"]');
    const row = actorId ? root.querySelector(`.acks-extras-turn-plan-row[data-plan-actor="${actorId}"]`) : null;
    const entry = row ? H.text(row.querySelector(".acks-extras-turn-plan-entry")) : null;
    return {
      rendered: true,
      tabActive: !!root.querySelector('.tab[data-tab="mode"].active'),
      button: btn ? H.text(btn) : null,
      buttons: root.querySelectorAll('[data-action="searchHere"]').length,
      tip: btn?.getAttribute("data-tooltip") ?? null,
      planRows: root.querySelectorAll(".acks-extras-turn-plan-row").length,
      entry,
      keepsWatch: entry !== null && watch ? entry === watch : null,
    };
  },
  rerenderSheet: async ({ partyId }) => { const app = game.actors.get(partyId).sheet; await app.render(); await globalThis.__tk.sleep(700); return true; },
  closeSheet: async ({ partyId }) => { try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch { /* closed */ } return true; },
  /** The seat's chat messages since `since` that carry every word. */
  messages: async ({ since, words }) => game.messages.contents.filter((m) => m.timestamp >= since && words.every((w) => (m.content ?? "").includes(w))).map((m) => ({ id: m.id, uuid: m.uuid, speaker: m.speaker?.alias ?? null, html: m.content })),
  seatInfo: async () => ({ me: game.user.name, activeGM: game.users.activeGM?.name ?? null, activeGMs: game.users.filter((u) => u.active && u.isGM).map((u) => u.name) }),
  clock: async ({ fid }) => { const f = globalThis.__tw.model.getFormation(fid); return { turns: f.clock.turnsTotal, rounds: f.clock.roundsPartial, plan: game.actors.get(f.actorId).getFlag("acks-extras", "turnPlan") ?? null }; },
  itemExists: async ({ uuid }) => !!(await fromUuid(uuid)),
  tokenExists: async ({ sceneId, tokenId }) => !!game.scenes.get(sceneId)?.tokens.get(tokenId),
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
let gm = null;
let player = null;
const made = [];
const own = { pots: [], cards: [], messages: [] };
let ids = null;
let rigged = false;
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
/** Whether the tracker had to be pointed at the scene before it showed the combat. */
let viewedNeeded = false;

/** Claim every chat card this GM client made since `since` (all carry the run's nonce); they are tracked for the sweep. */
async function claim(since) {
  const list = await run(gm, P.made, { since });
  for (const c of list) trackMessage(c.id);
  return list;
}

/** Make a fight on the walk's scene, its two hostile tokens knocked down, and end it by the tracker's own button. Answers what the card is. */
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
/** Press the card's button with the die held until the session flag appears (or `settle` ms pass), and read the notices and the chat made meanwhile. */
async function pressCard({ cardId, partyId, die = HIT, expectOpen = true, settleMs = 1500 }) {
  await run(gm, P.takeNotes);
  const since = await run(gm, P.nowMs);
  await run(gm, P.showChat);
  await run(gm, P.rig, { die });
  rigged = true;
  let pressed;
  try {
    pressed = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${cardId}'] [data-action='searchScene']` }, "the card's Search the scene");
    const opened = expectOpen ? await run(gm, P.waitSession, { partyId, open: true }) : false;
    if (expectOpen && opened) await run(gm, P.waitWin, { fid: ids.fid });
    await sleep(settleMs);
  } finally {
    await run(gm, P.unrig);
    rigged = false;
  }
  const notes = await run(gm, P.takeNotes);
  const session = await run(gm, P.session, { partyId });
  const chat = await claim(since);
  return { pressed, notes, session, chat, since };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|screen|treasure|search|pot-sheet|ways-in|formation/i });
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch.searchHere is not on both seats: the ways in (S5) are not in the loaded tree");
  if (!setG.primary) blocked("the GM seat's client is not the primary GM (isPrimaryGM is false): its deleteCombat hook would not record the fight, and a synthetic hook call is not the trigger");
  check("the ways in are on both seats, the GM seat is the primary GM, and the refusals' codes exist", setG.api && setP.api && setG.primary && setG.reasons, { gm: setG, player: setP });
  const bootBase = { gm: (await run(gm, P.boot)).length, player: (await run(player, P.boot)).length };
  const say = (api, key, data) => run(api, P.say, { key, data });
  const tt = (key, data) => t(gm, key, data);

  section("stylesheet");
  const sheetG = await run(gm, P.styleSheet, { inject: true });
  const sheetP = await run(player, P.styleSheet, { inject: true });
  note("the screen's stylesheet was loaded by the world launch (gm, player); where not, a copy is injected with a cache-buster", { gm: sheetG, player: sheetP });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const picked = await run(gm, P.pickLetter);
  if (!picked.imported) blocked("the world's treasure registry is not imported; import the Treasure Tome first");
  if (!picked.letter) blocked("no treasure type in the imported classic table deals a card under the rigged die");
  const LETTER = picked.letter;
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
  const hostile2 = await gm.fixture(MARKS.hostile2, "Actor", monster(NAMES.hostile2, []));
  const tableItem = await gm.fixture(MARKS.tableItem, "Item", { name: NAMES.tableItem, type: "item", img: "icons/svg/item-bag.svg", system: { cost: 25 } });
  const table = await gm.fixture(MARKS.table, "RollTable", { name: NAMES.table, formula: "1d1", replacement: true });
  const actorIds = { party: idOf(party), owner: idOf(owner), mate: idOf(mate), hostile: idOf(hostile), hostile2: idOf(hostile2) };
  const placeId = idOf(place);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;
  const tableUuid = table.uuid ?? `RollTable.${idOf(table)}`;
  const itemUuid = tableItem.uuid ?? `Item.${idOf(tableItem)}`;
  const { fid, error } = await run(gm, P.formationOf, { partyId: actorIds.party });
  if (error) blocked(error);
  ids = { fid, partyId: actorIds.party };
  await run(gm, P.endSession, { fid }).catch(() => null);

  const shaped = await run(gm, P.shapeActors, { ids: actorIds, playerId, letter: LETTER, tableUuid, goods: GOODS, ownerLevel: 3 });
  const shapedTable = await run(gm, P.shapeTable, { tableId: idOf(table), itemUuid, textName: NAMES.tableText });
  const placed = await run(gm, P.shapePlace, { placeId });
  const shape = await run(gm, P.startShape, { fid, partyId: actorIds.party, sceneId, members: [actorIds.owner, actorIds.mate], at: ORIGIN });
  if (shape.fight) blocked("a combat holds the walk's party or its members; it is another session's and is not swept here");
  const where = await run(gm, P.centre, { fid });
  if (!where.token || where.sceneId !== sceneId) blocked("the party token is not on the walk's scene");
  const rect = { x: where.cx - 300, y: where.cy - 200, width: 600, height: 400 };
  const region = await gm.fixture(MARKS.region, "Region", { name: NAMES.region, color: "#336699", shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const regionShape = await run(gm, P.shapeRegion, { uuid: region.uuid, rect });
  const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId });
  ids.homeX = where.x;
  ids.homeY = where.y;
  const at0 = await run(gm, P.placesAt, { fid });
  check(
    "the kept fixtures stand in shape: each hostile's letter and table, the goods once, the table's two results on one range, the Region (no behavior) linked to the place with its floor, the party holding both characters (the Player seat owns the party and one character, not the other) with its token inside the Region and no plan or session",
    !shaped.dup && CARRIED.concat([NATURAL]).every((n) => shaped.names.includes(n)) && shaped.letter === LETTER && shaped.tableBlank && shaped.linked && shaped.hostile2Items === 0
      && shaped.ownerOwns && !shaped.mateOwns && shaped.partyOwns && shapedTable.ok && placed.type === "acks-extras.location" && placed.things.join() === "floor-1"
      && regionShape.shapes === 1 && regionShape.behaviors === 0 && linked.linked
      && shape.members.length === 2 && shape.sceneId === sceneId && shape.token && !shape.plan && !shape.session
      && at0.places.length === 1 && at0.places[0].name === NAMES.place,
    { shaped, shapedTable, placed, regionShape, linked, shape: { members: shape.members.length, token: shape.token, plan: shape.plan, session: shape.session }, at0 },
  );
  const partyToken = { tokenId: shape.tokenId, actorId: shape.tokenActorId };
  const potsBase = await run(gm, P.pots);
  const knownPots = potsBase.all;

  /* ================= Steps 1 and 2: the fight, the card ================= */
  section("Step 1. a real fight, ended by the tracker, and its card");
  const bodies = { a: { name: NAMES.hostile, actorId: actorIds.hostile, x: 1000, y: 400 }, b: { name: NAMES.hostile2, actorId: actorIds.hostile2, x: 1200, y: 400 } };
  const f1 = await fight({ label: "fight 1", bodies, partyToken, sceneId });
  check(
    "a combat on the walk's scene began with the party token and the two hostile tokens: each resolves to its token and actor, the two bodies hostile and the party's two members friendly (the formation brings the second member into the combat itself)",
    f1.started.found && f1.started.started && f1.started.sceneId === sceneId && f1.started.rows.length === 4 && f1.started.rows.every((r) => r.token && r.actor) && f1.started.rows.filter((r) => r.disposition === -1).length === 2 && f1.started.rows.filter((r) => r.disposition === 1).length === 2,
    f1.started,
  );
  const e1 = await endFight({ label: "fight 1", f: f1, how: { a: "toggle", b: "hp" }, sceneId });
  const card1 = e1.card;
  const tItems = (n) => tt("search.items", { n });
  const rowOf = (c, name) => c.rows.find((r) => r.name === name);
  check("End Combat and its confirm were pressed and the combat is gone from the world", e1.ended, { end: e1.endPress, yes: e1.yes, gone: e1.gone });
  check("the real deleteCombat hook posted one card on the Judge seat, once, carrying the fight's scene", card1.inCollection && card1.messages === 1 && card1.rendered && card1.visible && card1.sceneId === sceneId, { messages: card1.messages, rendered: card1.rendered, scene: card1.sceneId === sceneId });
  check(
    "it lists both bodies, the first with its two carried items and its letter, the second with none and its linked table, the party token not listed",
    card1.rows.length === 2 && rowOf(card1, NAMES.hostile)?.items === (await tItems(2)) && rowOf(card1, NAMES.hostile)?.letter === (await tt("search.letter", { letter: LETTER })) && rowOf(card1, NAMES.hostile)?.table === ""
      && rowOf(card1, NAMES.hostile2)?.items === (await tItems(0)) && rowOf(card1, NAMES.hostile2)?.letter === "" && rowOf(card1, NAMES.hostile2)?.table === (await tt("search.table")),
    card1.rows,
  );
  check(
    "the card has a Search the scene button and no Stage a pot control, carries its note, and is not yet marked opened",
    card1.button === (await tt("search.scene")) && !card1.stageButton && card1.note === (await tt("search.sceneNote")) && card1.drawnText.length === 0 && !card1.opened,
    { button: card1.button, stage: card1.stageButton },
  );
  check(
    "before any table is drawn the card's table-text block is not shown: the block carries its hidden attribute and takes no room",
    card1.textWrap?.attr === true && card1.textWrap?.display === "none" && card1.textWrap?.height === 0 && card1.textLines.length === 0,
    card1.textWrap,
  );
  const cardP = await run(player, P.card, { combatId: f1.combatId, messageId: card1.id });
  const logP = await run(player, P.anySearchCardInLog);
  check("the Player seat sees no search card: not visible to it, not in its chat log", !cardP.visible && !cardP.rendered && logP === 0, { visible: cardP.visible, log: logP });

  /* ================= Step 2: Search the scene ================= */
  section("Step 2. Search the scene");
  const before2 = await run(gm, P.pots, { known: knownPots });
  const bodyA = card1.fallen.find((x) => x.name === NAMES.hostile);
  const bodyB = card1.fallen.find((x) => x.name === NAMES.hostile2);
  const a2 = await pressCard({ cardId: card1.id, partyId: actorIds.party });
  check("the press opened a scene search for the party: its session names the card, a pot and the card's two bodies", a2.pressed.found && a2.session.open && a2.session.recordMessageId === card1.id && !!a2.session.potUuid && a2.session.bodies.length === 2 && a2.session.bodies.includes(bodyA.id) && a2.session.bodies.includes(bodyB.id), { pressed: a2.pressed, session: { open: a2.session.open, bodies: a2.session.bodies?.length, pot: !!a2.session.potUuid } });
  const potUuid = a2.session.potUuid;
  trackPot(potUuid);
  const potsAfter = await run(gm, P.pots, { known: knownPots });
  const opened2 = await run(gm, P.waitPot, { potUuid, until: "open" });
  const took2 = await run(gm, P.waitPot, { potUuid, until: "takenOff" });
  const win2 = await run(gm, P.winState, { fid });
  check(
    "the scene screen opened at the place, reading 'After the battle', with an entry for each body and one dashed tile per lot",
    win2.open && win2.place === `· ${NAMES.place}` && win2.cap === (await say(gm, "ACKS-LOCATION.sceneSearch.screen.cap.fight")) && win2.cards.some((c) => c.key === `body:${bodyA.id}`) && win2.cards.some((c) => c.key === `body:${bodyB.id}`) && win2.tray.length > 0 && win2.tray.every((x) => x.wait),
    { place: win2.place, cap: win2.cap, cards: win2.cards.map((c) => c.key), tray: win2.tray.length },
  );
  const pot2 = await run(gm, P.potView, { potUuid });
  const pairs = await run(gm, P.carriedNames, { potUuid });
  const lotKeys = a2.session.lots.map((l) => l.key);
  const sources = pot2.cards.map((c) => c.source);
  check(
    "the pot the scene dealt is open, its origin is a scene's with take-off asked for and done, and it holds one pot (the card made exactly one)",
    opened2.met && took2.met && pot2.phase === "open" && pot2.origin?.kind === "scene" && pot2.origin.takeOff === true && pot2.origin.takenOff === true && potsAfter.fresh.length === 1 && potsAfter.fresh[0] === potUuid && before2.count + 1 === potsAfter.count,
    { phase: pot2.phase, origin: pot2.origin, fresh: potsAfter.fresh.length },
  );
  check(
    "origin.carried names the goods' cards (one per carried item, the natural weapon none) and each item it points at has left its body",
    pot2.origin?.carried === CARRIED.length && pairs.length === CARRIED.length && [...pairs.map((p) => p.card)].sort().join() === [...CARRIED].sort().join() && pairs.every((p) => !p.itemStillThere) && CARRIED.every((n) => sources.includes(n)) && !sources.includes(NATURAL),
    { carried: pot2.origin?.carried, pairs },
  );
  const bodyAnow = await run(gm, P.waitBody, { actorUuid: bodyA.actorUuid, gone: CARRIED, kept: [NATURAL] });
  check("the first body no longer carries the goods that are lots and still carries its natural weapon", bodyAnow.met, bodyAnow);
  const letterLots = lotKeys.filter((k) => k.startsWith(`body:${bodyA.id}/`));
  const tableLots = lotKeys.filter((k) => k.startsWith(`body:${bodyB.id}/`));
  check(
    "every card in the pot is unfound; the letter dealt at least one lot beyond the goods on the first body, and the table's item is one lot on the second body, made from the world item (which stays in the world)",
    pot2.cards.length > 0 && pot2.cards.every((c) => c.found === false) && letterLots.length >= CARRIED.length + 1 && tableLots.length === 1 && sources.includes(NAMES.tableItem) && (await run(gm, P.itemExists, { uuid: itemUuid })),
    { cards: pot2.cards.length, letter: letterLots.length, table: tableLots.length, sources: sources.length },
  );
  const cardAfter = await run(gm, P.card, { combatId: f1.combatId, messageId: card1.id });
  check(
    "the table was drawn quietly: no chat message of a table draw was posted by this client, the text result is listed on the card (its flag and its list) and the item result is not",
    !a2.chat.some((c) => c.table) && cardAfter.drawnText.join("|") === NAMES.tableText && cardAfter.textShown && cardAfter.textLines.join("|") === NAMES.tableText && cardAfter.drawnBy[bodyB.id] === 1,
    { chat: a2.chat.length, tableCards: a2.chat.filter((c) => c.table).length, text: cardAfter.drawnText, drawnBy: cardAfter.drawnBy },
  );
  const warnLabel = await say(gm, "ACKS-TREASURE.deal.warn.label");
  check("a lair warning notice appeared for the letter's hoard", a2.notes.warns.some((w) => w.includes(warnLabel)), { warns: a2.notes.warns.length });
  check("the card's button now reads 'Open the scene', and its record is marked opened", cardAfter.button === (await tt("search.open")) && cardAfter.opened, { button: cardAfter.button, opened: cardAfter.opened });

  /* ================= Step 3: press again, end, refused ================= */
  section("Step 3. press again; end the session; the card is refused");
  await run(gm, P.markWin, { fid });
  const a3 = await pressCard({ cardId: card1.id, partyId: actorIds.party, expectOpen: false, settleMs: 1200 });
  const win3 = await run(gm, P.winState, { fid });
  const pots3 = await run(gm, P.pots, { known: knownPots });
  const card3 = await run(gm, P.card, { combatId: f1.combatId, messageId: card1.id });
  check(
    "pressed again, the same screen comes forward: one window, the same instance, the same pot, no second pot made, the table not drawn again (the held draw and the text lines unchanged), nothing posted",
    a3.pressed.found && win3.open && win3.sameAs && a3.session.potUuid === potUuid && pots3.fresh.length === 1 && sameJson(card3.drawnBy, cardAfter.drawnBy) && card3.drawnText.length === cardAfter.drawnText.length && a3.chat.length === 0,
    { same: win3.sameAs, fresh: pots3.fresh.length, drawnText: card3.drawnText.length, chat: a3.chat.length },
  );
  const ended3 = await run(gm, P.endSession, { fid });
  check("the session ended: the party carries no session flag", ended3.ok && (await run(gm, P.session, { partyId: actorIds.party })).open === false, ended3);
  const refusedWords = await run(gm, P.reasonText, { reason: await run(gm, P.refusal, { name: "CARD_SPENT" }) });
  const a3b = await pressCard({ cardId: card1.id, partyId: actorIds.party, expectOpen: false, settleMs: 1200 });
  const pots3b = await run(gm, P.pots, { known: knownPots });
  const card3b = await run(gm, P.card, { combatId: f1.combatId, messageId: card1.id });
  check(
    "pressed after the session ended, the card is refused: a notification says the fight's scene was already opened, and no session, no pot and no table draw followed",
    a3b.notes.warns.includes(refusedWords) && !a3b.session.open && pots3b.fresh.length === 1 && sameJson(card3b.drawnBy, cardAfter.drawnBy) && refusedWords.length > 0,
    { warns: a3b.notes.warns, session: a3b.session.open, fresh: pots3b.fresh.length },
  );
  await run(gm, P.closeScreen, { fid });

  /* ================= Step 5 (Judge): Search here ================= */
  section("Step 5. the Judge's Search here on the Dungeon tab");
  const sheetOpen = await run(gm, P.openSheet, { partyId: actorIds.party });
  const sheet5 = await run(gm, P.sheetState, { partyId: actorIds.party, actorId: actorIds.owner });
  check("the party sheet opened on its Dungeon tab with the Turn plan rows and one Search here button", sheetOpen.rendered && sheet5.tabActive && sheet5.planRows === 2 && sheet5.buttons === 1 && sheet5.button === (await say(gm, "ACKS-FORMATION.plan.searchHere")), { sheetOpen, sheet5 });
  const potsPre = await run(gm, P.pots, { known: knownPots });
  const since5 = await run(gm, P.nowMs);
  await run(gm, P.takeNotes);
  const here = await press(gm, PORTS.gm, { scope: "doc", sel: '[data-action="searchHere"]' }, "Search here (Judge)");
  const opened5 = await run(gm, P.waitSession, { partyId: actorIds.party, open: true });
  if (opened5) await run(gm, P.waitWin, { fid });
  await sleep(1000);
  const s5 = await run(gm, P.session, { partyId: actorIds.party });
  const win5 = await run(gm, P.winState, { fid });
  const potsPost = await run(gm, P.pots, { known: knownPots });
  await claim(since5);
  check(
    "the Judge's press opened a session at the place with no fight and no pot, and the screen reads 'Searching here'",
    here.found && opened5 && s5.open && s5.recordMessageId === null && s5.potUuid === null && s5.placeUuid === placeUuid && potsPost.count === potsPre.count && win5.open && win5.cap === (await say(gm, "ACKS-LOCATION.sceneSearch.screen.cap.here")) && win5.place === `· ${NAMES.place}`,
    { here, session: { open: s5.open, record: s5.recordMessageId, pot: s5.potUuid }, cap: win5.cap, pots: [potsPre.count, potsPost.count] },
  );
  await run(gm, P.markWin, { fid });
  await press(gm, PORTS.gm, { scope: "doc", sel: '[data-action="searchHere"]' }, "Search here again (Judge)");
  await sleep(1200);
  const win5b = await run(gm, P.winState, { fid });
  const potsPost2 = await run(gm, P.pots, { known: knownPots });
  check("pressing Search here again brings the same screen forward: the same window instance, the same session, no pot", win5b.open && win5b.sameAs && (await run(gm, P.session, { partyId: actorIds.party })).placeUuid === placeUuid && potsPost2.count === potsPre.count, { same: win5b.sameAs });
  const assigned = await run(gm, P.assign, { fid, actorId: actorIds.owner, entryKey: "thing:floor-1" });
  await run(gm, P.rerenderSheet, { partyId: actorIds.party });
  const watch = await say(gm, "ACKS-FORMATION.plan.keepsWatch");
  const sheet5b = await run(gm, P.sheetState, { partyId: actorIds.party, actorId: actorIds.owner, watch });
  const sheet5c = await run(gm, P.sheetState, { partyId: actorIds.party, actorId: actorIds.mate, watch });
  check("a member assigned on the screen shows as that member's entry in the Dungeon tab's Turn plan, the other member still keeping watch", assigned.ok && !!sheet5b.entry && sheet5b.keepsWatch === false && sheet5c.keepsWatch === true, { assigned, owner: sheet5b.entry, mate: sheet5c.entry });
  await run(gm, P.unassign, { fid, actorId: actorIds.owner });
  await run(gm, P.endSession, { fid });
  await run(gm, P.closeScreen, { fid });
  await run(gm, P.closeSheet, { partyId: actorIds.party });

  /* ================= Steps 6 and 7: the Player's declaration, the Judge accepts ================= */
  section("Step 6. the Player seat's declaration");
  const seatInfo = await run(player, P.seatInfo);
  note("the seat that answers a relay (the Player seat's view of the active GM)", seatInfo);
  const activeIsLane = seatInfo.activeGM === MACHINE.gm;
  const psheet = await run(player, P.openSheet, { partyId: actorIds.party });
  const sheet6 = await run(player, P.sheetState, { partyId: actorIds.party, actorId: actorIds.owner });
  check("the party sheet opened on the Player seat's Dungeon tab with one Search here button", psheet.rendered && sheet6.tabActive && sheet6.buttons === 1 && sheet6.button === (await say(player, "ACKS-FORMATION.plan.searchHere")), { psheet, sheet6 });
  const clock0 = await run(gm, P.clock, { fid });
  const potsPre6 = await run(gm, P.pots, { known: knownPots });
  const since6 = await run(gm, P.nowMs);
  const decl = await press(player, PORTS.player, { scope: "doc", sel: '[data-action="searchHere"]' }, "Search here (Player)");
  const declText = await say(gm, "ACKS-FORMATION.request.declared", { user: MACHINE.player, action: await say(gm, "ACKS-FORMATION.request.searchHere") });
  const declared = await until(async () => {
    const ms = await run(gm, P.messages, { since: Math.max(0, since6 - 2000), words: [await say(gm, "ACKS-FORMATION.request.searchHere")] });
    return ms.length ? ms : null;
  }, { tries: 40, every: 300 });
  for (const m of declared ?? []) trackMessage(m.id);
  await sleep(1500);
  const clock6 = await run(gm, P.clock, { fid });
  const potsPost6 = await run(gm, P.pots, { known: knownPots });
  const s6 = await run(gm, P.session, { partyId: actorIds.party });
  const winP6 = await run(player, P.winState, { fid });
  note("the declaration's cards (the card's own text is compared in the page, not printed)", (declared ?? []).length);
  if (!activeIsLane) note("a GM client other than this lane's is the active GM; the relay may have been answered there", seatInfo);
  check(
    "the Player's press posted one declaration card, naming the user and the declaration, to the table, and nothing opened: no session, no pot, the clock and the plan unchanged, no screen on the Player seat",
    decl.found && (declared ?? []).length === 1 && (declared[0].html ?? "").replace(/<[^>]*>/g, "").trim() === declText && !s6.open && potsPost6.count === potsPre6.count && sameJson(clock6, clock0) && !winP6.open,
    { found: decl.found, cards: (declared ?? []).length, textOk: !!declared?.[0] && (declared[0].html ?? "").replace(/<[^>]*>/g, "").trim() === declText, session: s6.open, pots: [potsPre6.count, potsPost6.count], clockSame: sameJson(clock6, clock0), activeIsLane },
  );
  section("Step 7. the Judge accepts");
  await run(gm, P.openSheet, { partyId: actorIds.party });
  const acc = await press(gm, PORTS.gm, { scope: "doc", sel: '[data-action="searchHere"]' }, "Search here (Judge accepts)");
  const opened7 = await run(gm, P.waitSession, { partyId: actorIds.party, open: true });
  if (opened7) await run(gm, P.waitWin, { fid });
  const shown7 = await run(gm, P.show, { fid });
  const winP7 = await until(async () => { const w = await run(player, P.winState, { fid }); return w.open ? w : null; }, { tries: 60, every: 300 });
  check("the Judge's press opened the session, and after Show the scene the Player seat's screen follows by itself", acc.found && opened7 && shown7.ok && !!winP7 && (winP7?.place === `· ${NAMES.place}`), { acc, opened7, player: winP7 ? { place: winP7.place } : null });
  await run(gm, P.endSession, { fid });
  await run(gm, P.closeScreen, { fid });
  await run(player, P.closeScreen, { fid });
  await run(gm, P.closeSheet, { partyId: actorIds.party });
  await run(player, P.closeSheet, { partyId: actorIds.party });

  /* ================= Step 4: no place ================= */
  section("Step 4. the party stands in no place");
  const moved = await run(gm, P.moveToken, { fid, x: OUT.x, y: OUT.y });
  const out = await run(gm, P.placesAt, { fid });
  if (out.places.length) blocked(`a place still holds the party token after it was moved out (${out.places.length}); the world holds another place there`);
  const bodies2 = { a: { name: NAMES.hostile, actorId: actorIds.hostile, x: 1000, y: 800 } };
  const f2 = await fight({ label: "fight 2", bodies: bodies2, partyToken, sceneId });
  const e2 = await endFight({ label: "fight 2", f: f2, how: { a: "toggle" }, sceneId });
  const card2 = e2.card;
  const potsPre4 = await run(gm, P.pots, { known: knownPots });
  const noPlaceWords = await run(gm, P.reasonText, { reason: await run(gm, P.refusal, { name: "NO_PLACE_HERE" }) });
  const a4 = await pressCard({ cardId: card2.id, partyId: actorIds.party, expectOpen: false, settleMs: 1200 });
  const potsPost4 = await run(gm, P.pots, { known: knownPots });
  const card4 = await run(gm, P.card, { combatId: f2.combatId, messageId: card2.id });
  check(
    "the party token was moved out of every area; pressed there, the card's notice says the party stands in no place, and no session, no pot and no table draw was made, the card not marked opened",
    moved.moved && e2.ended && card2.inCollection && a4.notes.warns.includes(noPlaceWords) && noPlaceWords.length > 0 && !a4.session.open && potsPost4.count === potsPre4.count && !card4.opened && card4.button === (await tt("search.scene")),
    { moved, warns: a4.notes.warns, session: a4.session.open, pots: [potsPre4.count, potsPost4.count], opened: card4.opened },
  );
  const back = await run(gm, P.moveToken, { fid, x: ids.homeX, y: ids.homeY });
  const at4 = await run(gm, P.placesAt, { fid });
  const a4b = await pressCard({ cardId: card2.id, partyId: actorIds.party });
  trackPot(a4b.session.potUuid);
  check("with the token back in the Region the same card opens the scene (a refused press stamps nothing)", back.moved && at4.places.length === 1 && a4b.session.open && a4b.session.recordMessageId === card2.id, { places: at4.places.length, session: a4b.session.open });
  await run(gm, P.endSession, { fid });
  await run(gm, P.closeScreen, { fid });

  section("console");
  for (const [key, api, base] of [["gm", gm, bootBase.gm], ["player", player, bootBase.player]]) {
    const drained = await run(api, P.drain);
    const boot = (await run(api, P.boot)).length - base;
    check(`${key}: no console error over the walk (recorded from load: ${boot} since the walk began)`, !drained.errors.length && boot === 0, { errors: drained.errors.slice(0, 3), boot });
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (rigged || gm) await run(gm, P.unrig); } catch {}
  for (const [name, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, P.closeAll); } catch {}
    try { if (ids) await run(api, P.closeSheet, { partyId: ids.partyId }); } catch {}
    try { if (ids) await run(api, P.closeScreen, { fid: ids.fid }); } catch {}
    try { note(`restored (${name})`, await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { if (ids) await run(gm, P.endSession, { fid: ids.fid }); } catch {}
    try { if (ids?.homeX !== undefined) await run(gm, P.moveToken, { fid: ids.fid, x: ids.homeX, y: ids.homeY }); } catch {}
    try { await claim(0); } catch {}
    try { await run(gm, P.unhook); } catch {}
    // Only the run's own ids: the tokens, the combats, the combatants, the cards, the pots, the declaration and the search cards. Kept fixtures stay.
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
