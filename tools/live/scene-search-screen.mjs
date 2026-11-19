/**
 * Live walk, scene search: the scene screen, slice S4. Walks
 * docs/scene-search/TESTING.md "S4 — the screen" on both seats at once. Each
 * seat opens the real window (`acksExtras.sceneSearch.openScreen`), and every
 * control the recipe presses is pressed in that window: a click on its
 * `data-action` element, a dispatched dragstart/dragover/drop on a member tile
 * and an entry's card or rail. The screen's drag payload is written by the
 * screen itself (the walk hands the same DataTransfer from the dragstart to the
 * drop and checks it against `memberDragData`). Every observable is read from
 * the window's DOM and from the party's stored state, as a boolean, a count or
 * a string the screen's own lang file produced. Every figure typed into a
 * fixture is invented. Machine values arrive through ./_env.mjs by way of the
 * treasure kit.
 *
 * Order (the recipe's order, rearranged so state flows): Judge 1 (open), Player 1
 * (before the scene is shown; its window is closed again), Judge 2 (picker),
 * Judge 3 (drag, a refused drop), Judge 4 (Round at a 20), Judge 5 (a hasty miss
 * locks), Judge 7 (Show the scene; Player 2's window must open by itself) with
 * Player 2 (nothing hidden on the table's screen), Player 3 (picker, drag, chip),
 * Player 4 (a hand-made plan request at the hidden entry, then the Judge's Spend
 * a turn and Round), Player 6 (the player's own Round and Spend a turn), Player 7
 * (Open the pot), Judge 6 (Spend a turn reveals the hidden container; it runs
 * after the player checks because it makes the hidden entry visible), Player 5
 * (the table's log after Round and Turn), Judge 8 (layout, scroll retention),
 * Judge 9 (end with the window open).
 *
 * Scripted, not gestured: a click is `element.click()` in the page, not a pointer
 * press; the drag is a synthetic dragstart, dragover and drop (no real pointer
 * drag); the die is held through `CONFIG.Dice.randomUniform` inside one page
 * function around each press (0.025 a 20, 0.975 a 1) and restored in `finally`.
 * Where a step needs a plan entry the screen does not offer to be made by hand
 * (Judge 6's setup, a skilled searcher's chip for Player 3), it is the api.
 *
 * Fixtures: S2's, found by marker (`scene-search/session-scene`, `-region`,
 * `-place`, `-party`, `searcher-skilled`, `searcher-plain`); the place's list is
 * written whole at every start and restored at the end. The run's own pot is
 * `scene-search/screen-pot`, retired by marker at the start and swept by tracked
 * id at the end together with the chat cards this GM client posted (claimed by
 * the walk's nonce). Not reached: a session opened from a fight's record (the
 * "After the battle" cap), the pot window's own interactions beyond listing, a
 * real pointer drag, the screen's other ways in (S5).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, idOf, sleep } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/session-scene",
  regionA: "scene-search/session-region",
  place: "scene-search/session-place",
  party: "scene-search/session-party",
  skilled: "scene-search/searcher-skilled",
  plain: "scene-search/searcher-plain",
  pot: "scene-search/screen-pot",
};
const NAMES = {
  scene: "QA Scene Session Scene",
  regionA: "QA Scene Session Region",
  place: "QA Scene Session Place",
  party: "QA Scene Session Party",
  skilled: "QA Scene Skilled Searcher",
  plain: "QA Scene Plain Searcher",
  search: "QA Scene Search Skill",
};
const KEY = { f1: "thing:floor-1", f2: "thing:floor-2", fx: "thing:fixture-1", hid: "thing:hidden-1", far: "thing:far-1" };
const NONCE = "ssc" + Math.random().toString(36).slice(2, 7);
const INVENTED_THROW = 14;
const INVENTED_STORED = 18;
const HIT = 0.025;
const MISS = 0.975;

/** One thing of the place's list, written whole. */
const thing = (id, kind, extra = {}) => ({ id, kind, ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {}, ...extra });

/** The place's list at the start of every run: two floors, a fixture holding a clue and a reveal, the container it reveals, and a container past the reach. */
const thingsFor = ({ cx, cy, far }) => [
  thing("floor-1", "floor"),
  thing("floor-2", "floor"),
  thing("fixture-1", "fixture", {
    point: { x: cx, y: cy },
    layers: {
      hasty: { check: "inspect", yields: { clue: "QA clue" } },
      methodical: { check: "search", yields: { reveal: ["thing:hidden-1"] } },
    },
  }),
  thing("hidden-1", "container", { hidden: true }),
  thing("far-1", "container", { point: far }),
];

const P = {
  ...KIT,

  /** The modules every page function below reaches, the window finder, and, on the GM seat, a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__ss = globalThis.__ss ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.things = await import(`${base}lib/place-things.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.tokenCentre = (await import(`${base}lib/token-centre.mjs`)).tokenCentre;
    X.dist = await import(`${base}lib/distance-units.mjs`);
    X.rules = await import(`${base}formation/trap-rules.mjs`);
    X.pot = await import(`${base}treasure/pot.mjs`);
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    if (game.user.isGM && !X.cards) {
      X.cards = [];
      X.hooks = [
        ["preCreateChatMessage", Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); })],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => {
          if (m.flags?.world?.qaNonce !== nonce) return;
          X.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), alias: m.speaker?.alias ?? null, html: `${m.flavor ?? ""} ${m.content ?? ""}`, whisper: [...(m.whisper ?? [])] });
        })],
      ];
    }
    const api = globalThis.acksExtras?.sceneSearch;
    return {
      api: typeof api?.open === "function" && typeof api?.assign === "function",
      screen: typeof api?.openScreen === "function" && typeof api?.show === "function" && typeof api?.ask === "function",
      round: typeof api?.resolveRound === "function",
      scenes: typeof acksExtras?.location?.scenes?.locationOfRegion === "function",
    };
  },
  unhook: async () => {
    const X = globalThis.__ss;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  /** A word of the screen ("screen"), of scene search ("scene") or of the formation's own file ("formation"), formatted where it carries data. The roots are joined here so no whole key sits in the walk. */
  say: async ({ ns, key, data } = {}) => {
    const loc = "ACKS-" + "LOCATION";
    const roots = { screen: `${loc}.sceneSearch.screen.`, scene: `${loc}.sceneSearch.`, formation: "ACKS-" + "FORMATION." };
    const full = `${roots[ns]}${key}`;
    return data && Object.keys(data).length ? game.i18n.format(full, data) : game.i18n.localize(full);
  },
  /** What the module words a refusal as, for a member's name. */
  reasonText: async ({ reason, name } = {}) => acksExtras.sceneSearch.reasonText(reason, name),
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

  /** The scene's grid brought to the walk's scale. */
  shapeScene: async ({ sceneId } = {}) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size, distance: scene.grid.distance, units: scene.grid.units };
  },
  /** The party's formation id, waited for: creating the party actor makes it. */
  formationOf: async ({ partyId } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** Both searchers at their start level and stored figure, and who owns whom. */
  shapeCharacters: async ({ skilledId, plainId, playerId, stored } = {}) => {
    const skilled = game.actors.get(skilledId);
    const plain = game.actors.get(plainId);
    const user = game.users.get(playerId);
    await skilled.update({ "system.details.level": 2, "system.adventuring.searching": stored, ownership: { default: 0, [playerId]: 0 } });
    await plain.update({ "system.details.level": 1, "system.adventuring.searching": stored, ownership: { default: 0, [playerId]: 3 } });
    return {
      skilledLevel: Number(skilled.system.details.level),
      plainOwned: plain.testUserPermission(user, "OWNER"),
      skilledOwned: skilled.testUserPermission(user, "OWNER"),
    };
  },
  /** The skilled searcher's hand-made ability bound to Search, with an invented flat throw, brought to its start shape. */
  searchItem: async ({ actorId, name, target } = {}) => {
    const actor = game.actors.get(actorId);
    const data = {
      name,
      type: "ability",
      system: { roll: "1d20", rollType: "above", rollTarget: 0 },
      flags: { "acks-extras": { checkKey: "search", extras: { rolls: [{ key: "primary", label: "Search", rollType: "above", scale: "level", target: { kind: "flat", flat: target } }] } } },
    };
    const held = actor.items.find((i) => i.name === name);
    if (held) await held.update({ system: data.system, flags: data.flags });
    else await actor.createEmbeddedDocuments("Item", [data]);
    return actor.items.filter((i) => i.name === name).length;
  },
  /** The plain searcher holds no ability bound to Search, and the skilled one holds exactly one. */
  searchItems: async ({ skilledId, plainId } = {}) => {
    const bound = (id) => game.actors.get(id).items.filter((i) => i.type === "ability" && i.getFlag("acks-extras", "checkKey") === "search").length;
    return { skilled: bound(skilledId), plain: bound(plainId) };
  },
  /** The party's start shape: both searchers in it, its token on the scene, no plan, no session, nobody moved, every member whole. Answers `fight: true` and changes nothing when a combat holds the party. */
  startShape: async ({ fid, partyId, sceneId, members } = {}) => {
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
      if (rec.stance?.pace === "hurried") delete rec.stance.pace;
    });
    const f0 = X.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) {
      await X.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    }
    for (const [n, id] of members.entries()) {
      const f = X.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 400 + n * 100, y: 400 });
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
    return {
      fight: false,
      members: f.members.filter((m) => m?.actorId).map((m) => m.actorId),
      sceneId: f.sceneId,
      partyToken: !!X.model.getPartyToken(f),
      plan: party.getFlag("acks-extras", "turnPlan") ?? null,
      session: party.getFlag("acks-extras", "sceneSearch") ?? null,
      paused: !!f.clock.paused,
      moved: !!f.clock.movedThisTurn,
      hurried: X.model.isHurried(f),
    };
  },
  /** Where the party token's centre is, and whether the imported reach can be measured on its scene; `far` is a point three reaches east of it. */
  centre: async ({ fid } = {}) => {
    const X = globalThis.__ss;
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const c = X.tokenCentre(token, scene, token._source ?? token);
    const feet = X.dist.sceneFeetPerCell(scene);
    const size = Number(scene.grid.size);
    const perPixel = feet > 0 && size > 0 ? feet / size : null;
    const reach = X.rules.trapFigures().searchFeet;
    const reachKnown = typeof reach === "number" && reach > 0 && perPixel !== null;
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y, perPixelKnown: perPixel !== null, reachKnown, far: reachKnown ? { x: Math.round(c.x + (reach * 3) / perPixel), y: Math.round(c.y) } : null };
  },
  /** The Region's one rectangle brought to its place, and what behaviors it holds. */
  shapeRegion: async ({ uuid, rect } = {}) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  /** The place linked to the Region, both ends, written only when they do not already agree. */
  linkPlace: async ({ regionUuid, placeId } = {}) => {
    const X = globalThis.__ss;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  /** The place's list written whole. */
  shapePlace: async ({ placeId, things } = {}) => {
    const a = game.actors.get(placeId);
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((t) => t.id) };
  },
  /** The party's session flag and plan as stored, its place's things, the clock and the Judge's log. */
  state: async ({ fid, partyId, placeId } = {}) => {
    const X = globalThis.__ss;
    const party = game.actors.get(partyId);
    const f = X.model.getFormation(fid);
    return {
      flag: party.getFlag("acks-extras", "sceneSearch") ?? null,
      plan: party.getFlag("acks-extras", "turnPlan") ?? null,
      things: X.things.thingsOf(game.actors.get(placeId)).map((t) => ({ id: t.id, hidden: t.hidden, state: t.state })),
      turns: f.clock.turnsTotal,
      rounds: f.clock.roundsPartial,
      log: acksExtras.sceneSearch.read(fid)?.log ?? null,
    };
  },
  /** The pot at a uuid: its party, its phase and every card's found flag and lot key. */
  pile: async ({ potUuid } = {}) => {
    const X = globalThis.__ss;
    const pile = await fromUuid(potUuid);
    if (!pile) return null;
    const view = X.pot.viewOf(pile);
    return { phase: view.pot.phase, cards: view.cards.map((c) => ({ id: c.id, found: c.truth?.found, lot: c.truth?.lot ?? null })) };
  },
  /** What `read` answers on this seat: each entry's key, hidden mark and the lots it holds under unfound layers. */
  readAs: async ({ fid } = {}) => {
    const r = acksExtras.sceneSearch.read(fid);
    if (!r) return null;
    return {
      entries: r.entries.map((e) => ({ key: e.key, lotsHeld: ["hasty", "methodical"].reduce((n, nm) => n + e.layers[nm].yields.lots.length, 0) })),
      shown: r.session.shown === true,
      logRows: r.log.length,
    };
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
  assign: async ({ fid, actorId, layer, entryKey } = {}) => {
    const r = await acksExtras.sceneSearch.assign({ partyId: fid, actorId, layer, entryKey });
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  unassign: async ({ fid, actorId } = {}) => {
    const r = await acksExtras.sceneSearch.unassign({ partyId: fid, actorId });
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  /** What one member may attempt at every entry this seat sees: each layer's refusal or null. */
  optionRows: async ({ fid, actorId } = {}) => acksExtras.sceneSearch.options({ partyId: fid, actorId }).map((r) => ({ key: r.key, layers: (r.layers ?? []).map((l) => ({ layer: l.layer, refusal: l.refusal ?? null })) })),
  /** The throw figures on the newest log row's Judges' card, or null. */
  lastThrow: async ({ fid } = {}) => {
    const log = acksExtras.sceneSearch.read(fid)?.log ?? [];
    const row = log[log.length - 1];
    const f = row?.card ? game.messages.get(row.card)?.getFlag("acks-extras", "sceneRoll") : null;
    return f && Number.isFinite(f.total) ? { total: f.total, target: f.target ?? null } : null;
  },
  /** The cards this GM client made since `since`, with whether each names each of `names`. */
  cards: async ({ since = 0, names = [] } = {}) => {
    const X = globalThis.__ss;
    return (X.cards ?? []).filter((c) => c.at >= since).map((c) => ({ id: c.id, uuid: c.uuid, alias: c.alias, mentions: names.map((n) => c.html.includes(n)) }));
  },

  /** A player's hand-made `plan` request through the party's relay, as a console would send it. */
  requestPlan: async ({ fid, actorId, key, option } = {}) => {
    const M = await import("/modules/acks-extras/scripts/formation/player-requests.mjs");
    await M.requestPartyAction(fid, "plan", { actorId, key, option });
    return true;
  },

  /** Open the party's screen on this seat, waited for. */
  openScreen: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = acksExtras.sceneSearch.openScreen(fid);
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app) ? true : null), { tries: 60, every: 150 });
    await H.sleep(400);
    return { rendered: !!ok, found: !!X.win(fid) };
  },
  /** Is the party's screen open on this seat; one found is registered for the walk's close. */
  winOpen: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const app = globalThis.__ss.win(fid);
    if (app && !H.opened.includes(app)) H.opened.push(app);
    return !!app?.rendered && !!H.root(app);
  },
  closeScreen: async ({ fid } = {}) => {
    const app = globalThis.__ss.win(fid);
    if (app) await app.close({ animate: false });
    return !globalThis.__ss.win(fid);
  },

  /** The window's DOM read into data. `needles` are searched for in its HTML and its text. */
  snap: async ({ fid, needles = [] } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = X.win(fid);
    const root = app ? H.root(app) : null;
    if (!root) return null;
    const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (sel, from = root) => from.querySelector(sel);
    const qa = (sel, from = root) => [...from.querySelectorAll(sel)];
    const html = root.innerHTML;
    const text = txt(root);
    const bar = q(".acks-extras-ss-bar");
    const spans = qa(".acks-extras-ss-count > span");
    return {
      text,
      has: Object.fromEntries(needles.map((n) => [n, { html: html.includes(n), text: text.includes(n) }])),
      place: txt(q(".acks-extras-ss-place")),
      seat: txt(q(".acks-extras-ss-seat")),
      showBtn: q('[data-action="show"]') ? txt(q('[data-action="show"]')) : null,
      empty: q(".acks-extras-ss-empty") ? txt(q(".acks-extras-ss-empty")) : null,
      bar: bar ? { cap: txt(q(".acks-extras-ss-cap", bar)), found: txt(spans[0]), untouched: txt(spans[1]), press: txt(q(".acks-extras-ss-press")), turn: q(".acks-extras-ss-turn") ? txt(q(".acks-extras-ss-turn")) : null } : null,
      buttons: { round: !!q('[data-action="round"]'), spend: !!q('[data-action="spend"]') },
      noteCount: qa(".acks-extras-ss-note").length,
      throwCount: qa(".acks-extras-ss-throw").length,
      tagCount: qa(".acks-extras-ss-tag").length,
      trayPresent: !!q(".acks-extras-ss-tray"),
      tray: qa(".acks-extras-ss-back").map((b) => ({ wait: b.classList.contains("is-wait"), tip: b.getAttribute("data-tooltip-text"), text: txt(b) })),
      openPot: q('[data-action="openPot"]') ? { disabled: !!q('[data-action="openPot"]').disabled } : null,
      cards: qa(".acks-extras-ss-card").map((c) => {
        const tell = q(".acks-extras-ss-tell", c);
        return {
          key: c.dataset.dropEntry,
          hidden: c.classList.contains("is-hidden"),
          tag: q(".acks-extras-ss-tag", c) ? txt(q(".acks-extras-ss-tag", c)) : null,
          state: txt(q(".acks-extras-ss-state", c)),
          plate: txt(q(".acks-extras-ss-plate", c)),
          tell: tell ? [...tell.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() : null,
          finds: qa(".acks-extras-ss-finds li", c).map(txt),
          notes: qa(".acks-extras-ss-note", c).map(txt),
          rows: qa(".acks-extras-ss-row", c).map((r) => ({
            layer: r.dataset.dropLayer,
            pipOn: !!q(".acks-extras-ss-pip.is-on", r),
            chips: qa(".acks-extras-ss-chip", r).map((ch) => ({ name: txt(ch), struck: ch.classList.contains("is-struck"), removable: ch.tagName === "BUTTON", tip: ch.getAttribute("data-tooltip-text") })),
            hasAssign: !!q('[data-action="pick"]', r),
            assignText: q('[data-action="pick"]', r) ? txt(q('[data-action="pick"]', r)) : null,
            picker: q(".acks-extras-ss-picker", r)
              ? qa(".acks-extras-ss-pick", r).map((p) => ({ name: txt(q("button", p)), actorId: q("button", p).dataset.actorId, blocked: q("button", p).dataset.blocked === "true", refusal: txt(q(".acks-extras-ss-refuse", p)) }))
              : null,
          })),
        };
      }),
      members: qa(".acks-extras-ss-member").map((m) => ({ name: txt(q(".acks-extras-ss-member-name", m)), at: txt(q(".acks-extras-ss-member-at", m)), draggable: m.hasAttribute("data-member-drag"), actorId: m.dataset.actorId ?? null })),
      log: qa(".acks-extras-ss-log li").map((li) => {
        const head = li.firstElementChild;
        const thr = li.querySelector(".acks-extras-ss-throw");
        const clone = li.cloneNode(true);
        clone.firstElementChild?.remove();
        clone.querySelector(".acks-extras-ss-throw")?.remove();
        return { head: txt(head), text: txt(clone), throw: thr ? txt(thr) : null, throwTip: thr?.getAttribute("data-tooltip") ?? null };
      }),
    };
  },
  /** Click the nth element a selector finds inside the party's screen. */
  click: async ({ fid, sel, nth = 0 } = {}) => {
    const H = globalThis.__tk;
    const root = H.root(globalThis.__ss.win(fid));
    if (!root) return { found: false, why: "no window" };
    const list = [...root.querySelectorAll(sel)];
    const el = list[nth];
    if (!el) return { found: false, count: list.length };
    el.click();
    return { found: true, count: list.length, disabled: !!el.disabled };
  },
  /**
   * A member tile dragged onto an entry's card (no layer) or one of its rails,
   * as dispatched events: dragstart on the tile fills an empty DataTransfer,
   * the same object goes to dragover and drop on the target. Answers whether
   * the payload the screen wrote is the drag data for that member.
   */
  drag: async ({ fid, actorId, entry, layer = null } = {}) => {
    const H = globalThis.__tk;
    const root = H.root(globalThis.__ss.win(fid));
    const tile = root?.querySelector(`[data-member-drag][data-actor-id="${actorId}"]`);
    const zone = root?.querySelector(layer ? `.acks-extras-ss-row[data-drop-entry="${entry}"][data-drop-layer="${layer}"]` : `.acks-extras-ss-card[data-drop-entry="${entry}"]`);
    if (!tile || !zone) return { tile: !!tile, zone: !!zone };
    const logic = await import("/modules/acks-extras/scripts/scene-search/screen-logic.mjs");
    const dt = new DataTransfer();
    tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const payload = dt.getData("text/plain");
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
    zone.dispatchEvent(over);
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { tile: true, zone: true, payloadOk: payload === logic.memberDragData(actorId) && payload.length > 0, overPrevented: over.defaultPrevented };
  },
  /**
   * A press in the screen with the die held until its effect has landed. `until`:
   * `hasty` (no hasty assignment left unresolved), `turn` (the clock passed
   * `turnsBefore`, and `thingId`'s methodical check is done when named) or
   * `none` (a bounded wait, for a press that is expected to resolve nothing).
   */
  pressScreen: async ({ fid, action, die, until = "none", turnsBefore = null, thingId = null, placeId = null, settle = 2500 } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const btn = H.root(X.win(fid))?.querySelector(`[data-action="${action}"]`);
    if (!btn) return { pressed: false };
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    let done = null;
    try {
      btn.click();
      if (until === "hasty") {
        done = await H.poll(async () => ((await acksExtras.sceneSearch.assignments(fid)).filter((a) => a.layer === "hasty" && !a.resolved).length === 0 ? true : null), { tries: 100, every: 250 });
      } else if (until === "turn") {
        done = await H.poll(() => {
          if (!(X.model.getFormation(fid).clock.turnsTotal > turnsBefore)) return null;
          if (!thingId) return true;
          return X.things.thingsOf(game.actors.get(placeId)).find((t) => t.id === thingId)?.state?.layers?.methodical?.done === true ? true : null;
        }, { tries: 120, every: 250 });
      } else {
        await H.sleep(1500);
      }
      await H.sleep(settle);
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { pressed: true, done: until === "none" ? null : !!done };
  },
  /** The pot's own window: whether it is open and the card ids it lists. */
  potWindow: async ({ potUuid } = {}) => {
    const H = globalThis.__tk;
    const pile = await fromUuid(potUuid);
    const app = pile?.sheet;
    if (!app) return { rendered: false, ids: [] };
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app) ? true : null), { tries: 40, every: 150 });
    await H.sleep(400);
    const root = H.root(app);
    return { rendered: !!ok, ids: root ? [...new Set([...root.querySelectorAll("[data-card-id]")].map((e) => e.dataset.cardId))] : [] };
  },
  /** The window shrunk and the type knob raised on it; where each part sits against the window and where each column scrolls. */
  layout: async ({ fid, width, height, base } = {}) => {
    const H = globalThis.__tk;
    const app = globalThis.__ss.win(fid);
    const el = H.root(app);
    const size = () => parseFloat(getComputedStyle(el.querySelector(".acks-extras-ss-banner")).fontSize);
    const before = size();
    await app.setPosition({ width, height });
    // The client pin sets the knob on the document root, where the ramp steps are computed.
    const rootStyle = document.documentElement.style;
    globalThis.__ss.knobWas = rootStyle.getPropertyValue("--acks-fs-base");
    rootStyle.setProperty("--acks-fs-base", base);
    await app.render();
    await H.sleep(600);
    const win = el.getBoundingClientRect();
    const inside = (sel) => {
      const n = el.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { ok: r.width > 0 && r.height > 0 && r.top >= win.top - 1 && r.bottom <= win.bottom + 1 && r.left >= win.left - 1 && r.right <= win.right + 1, top: Math.round(r.top - win.top), bottom: Math.round(win.bottom - r.bottom) };
    };
    const scroller = (sel) => {
      const n = el.querySelector(sel);
      return n ? { sh: n.scrollHeight, ch: n.clientHeight, overflowY: getComputedStyle(n).overflowY } : null;
    };
    const content = el.querySelector(".window-content");
    return {
      win: { w: Math.round(win.width), h: Math.round(win.height) },
      fontBefore: before,
      fontAfter: size(),
      head: inside(".acks-extras-ss-head"),
      bar: inside(".acks-extras-ss-bar"),
      tray: inside(".acks-extras-ss-tray"),
      entries: scroller(".acks-extras-ss-entries"),
      aside: scroller(".acks-extras-ss-aside"),
      frame: content ? { sh: content.scrollHeight, ch: content.clientHeight, overflowY: getComputedStyle(content).overflowY } : null,
      trayReach: (() => { const t = el.querySelector(".acks-extras-ss-tray"); if (!t || !content) return null; const c = content.getBoundingClientRect(); const r = t.getBoundingClientRect(); return { bottomInScroll: Math.round(r.bottom - c.top + content.scrollTop), sh: content.scrollHeight }; })(),
    };
  },
  /** What a seat's read of the session rests on, step by step, for a read that answers null. */
  /** Who a user id names, and whether that user is a GM and active: tells which seat's client answered a relayed request. */
  whoIs: async ({ id } = {}) => { const u = id ? game.users.get(id) : null; return u ? { name: u.name, isGM: u.isGM, active: u.active, activeGM: game.users.activeGM?.name ?? null } : null; },
  /** Record every draw of the screen on this seat: what its context said, and whether the session flag was on the party then. */
  renderLog: async ({ start = false } = {}) => {
    const X = globalThis.__ss;
    if (start) {
      X.draws = [];
      if (X.drawHook) Hooks.off("renderSceneSearchScreen", X.drawHook);
      X.drawHook = Hooks.on("renderSceneSearchScreen", (app, _el, ctx) => {
        const f = app.formation;
        X.draws.push({ t: Date.now(), open: ctx?.open ?? null, waiting: ctx?.waiting ?? null, flag: !!(f && game.actors.get(f.actorId)?.getFlag?.("acks-extras", "sceneSearch")) });
      });
      return true;
    }
    if (X.drawHook) Hooks.off("renderSceneSearchScreen", X.drawHook);
    X.drawHook = null;
    return X.draws ?? [];
  },
  readTrace: async ({ fid } = {}) => {
    try {
      const f = globalThis.__ss.model.getFormation(fid);
      const actor = f ? game.actors.get(f.actorId) : null;
      const flag = actor?.getFlag?.("acks-extras", "sceneSearch") ?? null;
      let place = null;
      try { place = flag?.placeUuid ? fromUuidSync(flag.placeUuid, { strict: false }) : null; } catch (e) { place = { error: String(e) }; }
      let read = null;
      try { read = acksExtras.sceneSearch.read(fid); } catch (e) { read = { error: String(e) }; }
      const app = globalThis.__ss.win(fid);
      let ctx = null;
      try { const c = app ? await app._prepareContext({}) : null; ctx = c && { open: c.open, waiting: c.waiting ?? null, header: !!c.header }; } catch (e) { ctx = { error: String(e), stack: String(e?.stack ?? "").slice(0, 600) }; }
      const shownText = app?.element?.querySelector?.(".acks-extras-ss-empty")?.textContent ?? null;
      let rerender = null;
      try { await app?.render?.({ force: true }); await new Promise((r) => setTimeout(r, 500)); rerender = app?.element?.querySelector?.(".acks-extras-ss-empty")?.textContent ?? null; } catch (e) { rerender = { error: String(e) }; }
      return { app: !!app, state: app?.state ?? null, ctx, shownText, rerender, formation: !!f, actor: !!actor, flag: flag && Object.keys(flag), shown: flag?.shown ?? null, place: place?.documentName ?? place, placeName: place?.name ?? null, read: read === null ? null : read.error ?? Object.keys(read) };
    } catch (e) {
      return { error: String(e) };
    }
  },
  /** Is the screen's stylesheet among the page's sheets? With `inject`, add it when absent and re-render the window. */
  styleSheet: async ({ fid, inject = false } = {}) => {
    const href = (h) => (h ?? "").includes("styles/scene-search.css");
    const loaded = [...document.styleSheets].some((sh) => href(sh.href));
    if (loaded || !inject) return { loaded, injected: false };
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `modules/acks-extras/styles/scene-search.css?walk=${Date.now()}`;
    await new Promise((res) => { link.onload = res; link.onerror = res; document.head.append(link); });
    await globalThis.__ss.win(fid)?.render?.();
    await new Promise((r) => setTimeout(r, 400));
    return { loaded: false, injected: [...document.styleSheets].some((sh) => href(sh.href)) };
  },
  unlayout: async ({ fid } = {}) => {
    const rootStyle = document.documentElement.style;
    const was = globalThis.__ss.knobWas;
    if (was) rootStyle.setProperty("--acks-fs-base", was);
    else rootStyle.removeProperty("--acks-fs-base");
    await globalThis.__ss.win(fid)?.render?.();
    return true;
  },
  /** The entries column's scroll position: set to `top` (clamped by the column) and read back, or only read when `top` is null. */
  scrollOf: async ({ fid, top = null } = {}) => {
    const n = globalThis.__tk.root(globalThis.__ss.win(fid))?.querySelector(".acks-extras-ss-entries");
    if (!n) return null;
    if (top !== null) n.scrollTop = top;
    return Math.round(n.scrollTop);
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
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cardOf = (s, key) => s?.cards.find((c) => c.key === key) ?? null;
const rowOf = (s, key, layer) => cardOf(s, key)?.rows.find((r) => r.layer === layer) ?? null;
const hasChip = (s, key, layer, name) => (rowOf(s, key, layer)?.chips ?? []).some((c) => c.name === name);
const pickSel = (key, layer) => `[data-action="pick"][data-entry="${key}"][data-layer="${layer}"]`;
const assignSel = (actorId, key, layer) => `[data-action="assign"][data-actor-id="${actorId}"][data-entry="${key}"][data-layer="${layer}"]`;
const countOf = (text) => Number(/(\d+)/.exec(text ?? "")?.[1] ?? NaN);

let gm = null;
let player = null;
watchdog(() => [gm, player], 1_200_000);
const own = { pot: null, cards: [] };
let ids = null;
let tornDown = false;

/** Claim every card this GM client made since `since` (all carry the run's nonce); the claimed ones are tracked for the sweep. */
async function claimCards(since, names = []) {
  const made = await run(gm, P.cards, { since, names });
  for (const c of made) own.cards.push(gm.track(c.uuid, "ChatMessage"));
  return made;
}

/** Close the windows, take the members off the plan, end any session, put the place's list back, and sweep what the run made by tracked id. */
async function teardown() {
  tornDown = true;
  await run(gm, P.closeAll).catch(() => null);
  await run(player, P.closeAll).catch(() => null);
  if (ids) {
    for (const actorId of [ids.skilledId, ids.plainId]) await run(gm, P.unassign, { fid: ids.fid, actorId }).catch(() => null);
    await run(gm, P.endSession, { fid: ids.fid }).catch(() => null);
    if (ids.things) await run(gm, P.shapePlace, { placeId: ids.placeId, things: ids.things }).catch(() => null);
    await claimCards(0).catch(() => null);
  }
  const only = unique([own.pot, ...own.cards]);
  const swept = await gm.sweepTracked({ only });
  note("swept", swept);
  return { swept, wanted: only.length };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|screen|round|treasure|pot-sheet/i });
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch is not on both seats");
  if (!setG.screen || !setP.screen) blocked("acksExtras.sceneSearch.openScreen, show and ask are not on both seats: the scene screen (S4) is not in the loaded tree");
  if (!setG.scenes) blocked("acksExtras.location.scenes is not on the GM seat");
  const bootBase = { gm: (await run(gm, P.boot)).length, player: (await run(player, P.boot)).length };
  const say = (api, key, data) => run(api, P.say, { ns: "screen", key, data });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const picked = await run(gm, P.pickLetter);
  if (!picked.imported) blocked("the world's treasure registry is not imported; import the Treasure Tome first");
  if (!picked.letter) blocked("no treasure type in the imported classic table deals a card under the rigged die");
  const LETTER = picked.letter;

  const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const sceneId = idOf(scene);
  const sceneShape = await run(gm, P.shapeScene, { sceneId });
  const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party" });
  const character = (name, extra = {}) => ({
    name,
    type: "character",
    prototypeToken: { actorLink: true },
    system: { hp: { value: 8, max: 8 }, details: { level: 1 }, adventuring: { listening: INVENTED_STORED, searching: INVENTED_STORED, dungeonbashing: INVENTED_STORED } },
    ...extra,
  });
  const skilled = await gm.fixture(MARKS.skilled, "Actor", character(NAMES.skilled, { ownership: { default: 0 } }));
  const plain = await gm.fixture(MARKS.plain, "Actor", character(NAMES.plain, { ownership: { default: 0, [playerId]: 3 } }));
  const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location" });
  const partyId = idOf(party);
  const skilledId = idOf(skilled);
  const plainId = idOf(plain);
  const placeId = idOf(place);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;

  const { fid, error } = await run(gm, P.formationOf, { partyId });
  if (error) blocked(error);
  ids = { fid, placeId, sceneId, things: null, skilledId, plainId };

  // Nothing of an earlier run stands: a session and the pot it dealt.
  note("an earlier session ended", (await run(gm, P.endSession, { fid })).ok);
  await gm.retire(MARKS.pot, "Cards");

  const chars = await run(gm, P.shapeCharacters, { skilledId, plainId, playerId, stored: INVENTED_STORED });
  const items = await run(gm, P.searchItem, { actorId: skilledId, name: NAMES.search, target: INVENTED_THROW });
  const bound = await run(gm, P.searchItems, { skilledId, plainId });
  const shape = await run(gm, P.startShape, { fid, partyId, sceneId, members: [skilledId, plainId] });
  if (shape.fight) blocked("a combat holds the walk's party; it is another session's and is not swept here");
  const where = await run(gm, P.centre, { fid });
  if (!where.token || where.sceneId !== sceneId) blocked("the party token is not on the walk's scene, so the reach cannot be measured");
  if (!where.reachKnown) blocked("the imported search reach, or the scene's scale, is absent; the out-of-reach step cannot be walked");
  const { cx, cy, far } = where;

  const rectA = { x: cx - 300, y: cy - 200, width: 600, height: 400 };
  const regionA = await gm.fixture(MARKS.regionA, "Region", { name: NAMES.regionA, color: "#336699", shapes: [{ type: "rectangle", ...rectA, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const regionShape = await run(gm, P.shapeRegion, { uuid: regionA.uuid, rect: rectA });
  const linked = await run(gm, P.linkPlace, { regionUuid: regionA.uuid, placeId });
  const BASE = thingsFor({ cx, cy, far });
  ids.things = BASE;
  const placed = await run(gm, P.shapePlace, { placeId, things: BASE });

  check(
    "the kept fixtures stand in shape: the scene's scale, the Region with no behavior linked to the place, its list written whole, the searchers at their level and figure (the plain one the Player seat's), the party holding both with its token on the scene and no plan or session",
    sceneShape.size === 100 && sceneShape.distance === 5 && regionShape.shapes === 1 && regionShape.behaviors === 0 && linked.linked
      && placed.type === "acks-extras.location" && placed.things.join() === "floor-1,floor-2,fixture-1,hidden-1,far-1"
      && chars.skilledLevel === 2 && chars.plainOwned && !chars.skilledOwned && items === 1 && bound.skilled === 1 && bound.plain === 0
      && shape.members.length === 2 && shape.sceneId === sceneId && shape.partyToken && !shape.plan && !shape.session && !shape.paused && !shape.moved && !shape.hurried,
    { sceneShape, regionShape, linked, placed: placed.things, chars, items, bound, shape },
  );

  const st = () => run(gm, P.state, { fid, partyId, placeId });
  const snapG = (needles = []) => run(gm, P.snap, { fid, needles });
  const snapP = (needles = []) => run(player, P.snap, { fid, needles });
  const untilSnap = (api, pred, opts) => until(async () => {
    const s = await run(api, P.snap, { fid, needles: [] });
    return s && pred(s) ? s : null;
  }, opts);
  const clickG = (sel, nth = 0) => run(gm, P.click, { fid, sel, nth });
  const clickP = (sel, nth = 0) => run(player, P.click, { fid, sel, nth });

  section("Judge 1: open the screen");
  const opened = await run(gm, P.openSession, { fid, placeUuid, sceneId, sources: [{ thing: KEY.f1, letters: [LETTER] }, { thing: KEY.f2, letters: [LETTER] }, { thing: KEY.hid, letters: [LETTER] }], die: HIT });
  if (!opened.ok) blocked(`open refused: ${opened.reason}`);
  own.pot = gm.track(opened.potUuid, "Cards");
  await gm.mark(opened.potUuid, MARKS.pot);
  const lotKeys = opened.lots.map((l) => l.key);
  if (!lotKeys.some((k) => k.startsWith(`${KEY.f1}/`))) blocked("the deal made no lot for the first floor");
  if (!lotKeys.some((k) => k.startsWith(`${KEY.f2}/`))) note("the deal made no lot for the second floor; Judge 5's miss runs on an entry holding none", true);
  const pile0 = await run(gm, P.pile, { potUuid: opened.potUuid });
  const asGm = await run(gm, P.readAs, { fid });
  const opn = await run(gm, P.openScreen, { fid });
  const s1 = await snapG([KEY.hid]);
  if (!opn.rendered || !s1) blocked("the Judge's scene screen did not render");
  note("the Judge's window text", s1.text.slice(0, 160));
  const lotsF1 = asGm.entries.find((e) => e.key === KEY.f1)?.lotsHeld ?? 0;
  check(
    "the header reads the place's name, the Judge seat and 'not yet shown', with a Show the scene button",
    s1.place === `· ${NAMES.place}` && s1.seat === `${await say(gm, "seat.judge")} · ${await say(gm, "shown.no")}` && s1.showBtn === (await say(gm, "show")),
    { place: s1.place, seat: s1.seat, show: s1.showBtn },
  );
  check("the bar reads 'Searching here' (a session not opened from a fight)", s1.bar?.cap === (await say(gm, "cap.here")), { cap: s1.bar?.cap });
  const hidCard = cardOf(s1, KEY.hid);
  const fxPlate = cardOf(s1, KEY.fx)?.plate;
  check(
    "a card is drawn for every entry, the hidden container included, dashed and tagged Hidden, with the Judge's note naming the fixture that reveals it and how",
    s1.cards.map((c) => c.key).sort().join() === asGm.entries.map((e) => e.key).sort().join() && s1.cards.length === 5
      && hidCard?.hidden === true && hidCard.tag === (await say(gm, "state.hidden"))
      && hidCard.notes.includes(await say(gm, "judge.behind", { name: fxPlate, how: await say(gm, "how.methodical") })),
    { cards: s1.cards.length, hidden: hidCard?.hidden, tag: hidCard?.tag, note: hidCard?.notes },
  );
  const assignWord = await say(gm, "assign.button");
  check(
    "every card has two rails, hastily and methodically, each with + Assign",
    s1.cards.every((c) => c.rows.map((r) => r.layer).join() === "hasty,methodical" && c.rows.every((r) => r.hasAssign && r.assignText === assignWord)),
    { rails: s1.cards.map((c) => c.rows.length) },
  );
  check(
    "the first floor's card shows a Judge note of the lots waiting under its hasty check",
    lotsF1 > 0 && (cardOf(s1, KEY.f1)?.notes ?? []).includes(await say(gm, "judge.lots", { n: lotsF1, how: await say(gm, "how.hasty") })),
    { lots: lotsF1, notes: cardOf(s1, KEY.f1)?.notes },
  );
  const waitSuffix = await say(gm, "tray.tileWaiting", { pool: "" });
  check(
    "the tray holds one dashed tile per dealt lot, none solid, each tooltip saying 'not found yet (Judge only)', and the bar counts none found",
    s1.tray.length === pile0.cards.length && s1.tray.length > 0 && s1.tray.every((t) => t.wait && (t.tip ?? "").endsWith(waitSuffix))
      && s1.bar?.found === (await say(gm, "count.found.many", { n: 0 })),
    { tiles: s1.tray.length, dealt: pile0.cards.length, found: s1.bar?.found },
  );

  section("Player 1: before the scene is shown");
  await run(player, P.renderLog, { start: true });
  const opnP = await run(player, P.openScreen, { fid });
  const waitWords = await say(player, "waiting");
  const p1 = (await untilSnap(player, (s) => s.empty === waitWords)) ?? (await snapP());
  check(
    "the seat reads 'Player seat' with the character, the body says the Judge has not shown the scene, and no bar, card, tray or Round and Spend a turn button is drawn",
    !!p1 && opnP.rendered && p1.seat === (await say(player, "seat.player", { names: NAMES.plain })) && p1.empty === (await say(player, "waiting"))
      && !p1.bar && p1.cards.length === 0 && !p1.trayPresent && !p1.buttons.round && !p1.buttons.spend,
    p1 && { seat: p1.seat, empty: p1.empty, bar: !!p1.bar, cards: p1.cards.length, tray: p1.trayPresent },
  );
  note("the player's screen's draws (context open/waiting, session flag present at the draw)", await run(player, P.renderLog, {}));
  if (p1?.empty !== waitWords) note("the player's read before the show, step by step", await run(player, P.readTrace, { fid }));
  const closedP = await run(player, P.closeScreen, { fid });
  note("the player's window closed, so Judge 7's socket open is its own", closedP);

  section("Judge 2: assign by picker");
  const nameS = NAMES.skilled;
  const nameP = NAMES.plain;
  await clickG(pickSel(KEY.f1, "hasty"));
  const pk = await untilSnap(gm, (s) => rowOf(s, KEY.f1, "hasty")?.picker);
  const pkRows = rowOf(pk, KEY.f1, "hasty")?.picker ?? [];
  check(
    "the picker lists every member; a member who may not attempt the check carries a refusal under their button, one who may carries none",
    pkRows.map((r) => r.name).sort().join() === [nameS, nameP].sort().join() && pkRows.every((r) => (r.blocked ? r.refusal.length > 0 : r.refusal === "")),
    pkRows.map((r) => [r.name, r.blocked, r.refusal]),
  );
  note("members refused at the floor's hasty rail (none expected)", pkRows.filter((r) => r.blocked).length);
  const sPick = pkRows.find((r) => r.name === nameS);
  await clickG(assignSel(skilledId, KEY.f1, "hasty"));
  const j2 = await untilSnap(gm, (s) => hasChip(s, KEY.f1, "hasty", nameS));
  const st2 = await st();
  const atWord = await say(gm, "member.at", { entry: cardOf(j2, KEY.f1)?.plate, how: await say(gm, "how.hasty") });
  check(
    "pressing the skilled searcher puts a chip on the rail, the member tile reads '<floor> · hastily', the bar's press line reads one hasty check resolves at once, and the turn plan holds the entry",
    !!sPick && !sPick.blocked && !!j2 && j2.members.find((m) => m.name === nameS)?.at === atWord && j2.bar.press.includes(await say(gm, "press.round.one"))
      && st2.plan?.[skilledId]?.key === "sceneHasty" && st2.plan[skilledId].option === KEY.f1 && !rowOf(j2, KEY.f1, "hasty").picker,
    { at: j2?.members.find((m) => m.name === nameS)?.at, press: j2?.bar.press, plan: st2.plan?.[skilledId] },
  );
  // The picker at the container past the reach: both members blocked, the refusal under each, a press does nothing.
  await clickG(pickSel(KEY.far, "methodical"));
  const pkFar = await untilSnap(gm, (s) => rowOf(s, KEY.far, "methodical")?.picker);
  const farRows = rowOf(pkFar, KEY.far, "methodical")?.picker ?? [];
  const reach = await run(gm, P.reasonText, { reason: "scene:outOfReach", name: nameP });
  await clickG(assignSel(plainId, KEY.far, "methodical"));
  await sleep(1200);
  const afterFar = await snapG();
  const st2b = await st();
  check(
    "at the container past the reach the picker lists both members blocked with the reason under each, and pressing a blocked button adds no chip and changes no plan entry",
    farRows.length === 2 && farRows.every((r) => r.blocked && r.refusal.length > 0) && farRows.find((r) => r.name === nameP)?.refusal === reach
      && afterFar.cards.flatMap((c) => c.rows).every((r) => r.chips.length === 0 || r.chips.every((c) => c.name === nameS)) && !hasChip(afterFar, KEY.far, "methodical", nameP) && sameJson(st2b.plan, st2.plan),
    { rows: farRows.map((r) => [r.name, r.blocked]), reasonOk: farRows.find((r) => r.name === nameP)?.refusal === reach },
  );
  await clickG('[data-action="cancelPick"]');
  const closedPicker = await untilSnap(gm, (s) => !rowOf(s, KEY.far, "methodical")?.picker);
  check("Cancel closes the picker", !!closedPicker, null);

  section("Judge 3: assign by drag");
  const optP = await run(gm, P.optionRows, { fid, actorId: plainId });
  const firstOpenF2 = optP.find((r) => r.key === KEY.f2)?.layers.find((l) => !l.refusal)?.layer ?? null;
  const d1 = await run(gm, P.drag, { fid, actorId: plainId, entry: KEY.fx, layer: "methodical" });
  const j3a = await untilSnap(gm, (s) => hasChip(s, KEY.fx, "methodical", nameP));
  const st3a = await st();
  check(
    "dragging the plain searcher's tile onto the fixture's methodical rail puts a chip there (the screen wrote the drag payload; the drop is a synthetic event)",
    d1.tile && d1.zone && d1.payloadOk && d1.overPrevented && !!j3a && st3a.plan?.[plainId]?.key === "sceneMethodical" && st3a.plan[plainId].option === KEY.fx,
    { drag: d1, plan: st3a.plan?.[plainId] },
  );
  const d2 = await run(gm, P.drag, { fid, actorId: plainId, entry: KEY.f2 });
  const j3b = await untilSnap(gm, (s) => (rowOf(s, KEY.f2, "hasty")?.chips.length ?? 0) + (rowOf(s, KEY.f2, "methodical")?.chips.length ?? 0) > 0);
  const landed = ["hasty", "methodical"].find((l) => hasChip(j3b, KEY.f2, l, nameP)) ?? null;
  check(
    "dropping the tile on the second floor's card (not a rail) lands on the first check the member may attempt, and the member's earlier chip is gone",
    d2.payloadOk && !!firstOpenF2 && landed === firstOpenF2 && !hasChip(j3b, KEY.fx, "methodical", nameP),
    { landed, expected: firstOpenF2 },
  );
  note("the recipe drops on 'the container's card'; this walk drops on a floor's card, because no visible container in the place's list is both unhidden and in reach", null);
  await run(gm, P.takeNotes);
  const stBefore = await st();
  const d3 = await run(gm, P.drag, { fid, actorId: plainId, entry: KEY.far, layer: "methodical" });
  await sleep(1500);
  const noted = await run(gm, P.takeNotes);
  const j3c = await snapG();
  const stAfter = await st();
  check(
    "a drag onto the rail whose check is refused (the container past the reach) posts the refusal as a notification, adds no chip, and leaves the plan as it was",
    d3.payloadOk && noted.warns.includes(reach) && j3c.cards.find((c) => c.key === KEY.far).rows.every((r) => r.chips.length === 0) && sameJson(stBefore.plan, stAfter.plan),
    { warns: noted.warns.length, matched: noted.warns.includes(reach) },
  );
  note("every drag and drop above is a dispatched DragEvent with a DataTransfer, not a real pointer drag", null);
  // Plain goes to the fixture's methodical check, so the Round below resolves one hasty entry (the skilled searcher's) and no more.
  await run(gm, P.drag, { fid, actorId: plainId, entry: KEY.fx, layer: "methodical" });
  const j3d = await untilSnap(gm, (s) => hasChip(s, KEY.fx, "methodical", nameP) && !hasChip(s, KEY.f2, "hasty", nameP));
  check("the plain searcher is back on the fixture's methodical rail alone, the skilled one on the first floor's hasty rail", !!j3d && hasChip(j3d, KEY.f1, "hasty", nameS), null);

  section("Judge 4: Round at a 20");
  const stR0 = await st();
  const tray0 = (await snapG()).tray.length;
  let since = await run(gm, P.nowMs);
  const r1 = await run(gm, P.pressScreen, { fid, action: "round", die: HIT, until: "hasty" });
  const throwExpect = await run(gm, P.lastThrow, { fid });
  const emptyLog = await say(gm, "log.empty");
  const j4 = await untilSnap(gm, (s) => s.log.length > 0 && s.log[0].head !== emptyLog, { tries: 20 });
  const j4t = throwExpect ? await untilSnap(gm, (s) => s.throwCount > 0, { tries: 20, every: 300 }) : j4;
  await claimCards(since);
  const stR1 = await st();
  const pile4 = await run(gm, P.pile, { potUuid: opened.potUuid });
  const f1Found = pile4.cards.filter((c) => c.lot?.startsWith(`${KEY.f1}/`) && c.found === true).length;
  const totalFound = pile4.cards.filter((c) => c.found === true).length;
  const sF1 = cardOf(j4t, KEY.f1);
  const hastyNow = rowOf(j4t, KEY.f1, "hasty");
  check("the Round press resolved the hasty entry (the plan stamps it resolved and keeps it)", r1.pressed && r1.done && stR1.plan?.[skilledId]?.resolvedTurn != null, { ...r1, entry: stR1.plan?.[skilledId] ?? null });
  check(
    "the first floor's hasty chip clears and its pip fills, and its card reads 'Checked hastily' with its lots counted",
    !!hastyNow && hastyNow.chips.length === 0 && hastyNow.pipOn && f1Found > 0 && sF1.state === (await say(gm, "state.hastily"))
      && sF1.finds.includes(await say(gm, `finds.items.${f1Found === 1 ? "one" : "many"}`, { n: f1Found })),
    { chips: hastyNow?.chips.length, pip: hastyNow?.pipOn, state: sF1?.state, finds: sF1?.finds, found: f1Found },
  );
  const solid = j4t.tray.filter((t) => !t.wait).length;
  check(
    "the tray's solid tiles are the found lots, the bar's 'You found N items.' is the count of solid tiles, and no tile was added or dropped",
    solid === totalFound && solid > 0 && countOf(j4t.bar.found) === solid && j4t.bar.found === (await say(gm, `count.found.${solid === 1 ? "one" : "many"}`, { n: solid })) && j4t.tray.length === tray0,
    { solid, bar: j4t.bar.found, tiles: j4t.tray.length },
  );
  const row0 = j4t.log.filter((r) => r.head !== emptyLog).length;
  check(
    "the log gained one row, newest first, naming the skilled searcher and the floor",
    (stR1.log ?? []).length === (stR0.log ?? []).length + 1 && row0 === stR1.log.length && j4t.log[0].head.includes(nameS) && j4t.log[0].head.includes(cardOf(j4t, KEY.f1).plate),
    { rows: stR1.log?.length, head: j4t.log[0]?.head },
  );
  check(
    "on this seat only, the newest row carries a throw figure read from the Judges' card, with its tooltip",
    !!throwExpect && j4t.log[0].throw === (await say(gm, "log.throw", { total: throwExpect.total, target: throwExpect.target ?? "?" })) && !!j4t.log[0].throwTip,
    { throw: j4t.log[0]?.throw },
  );
  check("the bar's clock spent exactly one round (clock.roundsPartial up by one)", stR1.rounds === stR0.rounds + 1, { before: stR0.rounds, after: stR1.rounds });

  section("Judge 5: a hasty miss locks");
  await clickG(pickSel(KEY.f2, "hasty"));
  await untilSnap(gm, (s) => rowOf(s, KEY.f2, "hasty")?.picker);
  await clickG(assignSel(skilledId, KEY.f2, "hasty"));
  const j5a = await untilSnap(gm, (s) => hasChip(s, KEY.f2, "hasty", nameS));
  const stM0 = await st();
  since = await run(gm, P.nowMs);
  const r2 = await run(gm, P.pressScreen, { fid, action: "round", die: MISS, until: "hasty" });
  await claimCards(since);
  const j5 = await untilSnap(gm, (s) => (rowOf(s, KEY.f2, "hasty")?.chips ?? []).some((c) => c.struck));
  const struck = rowOf(j5, KEY.f2, "hasty")?.chips.find((c) => c.struck);
  check(
    "after a hasty miss at a 1 a struck chip stands for the skilled searcher on that rail, its tooltip naming the lock",
    !!j5a && r2.pressed && r2.done && !!struck && struck.name === nameS && !struck.removable && struck.tip === (await say(gm, "chip.struck", { name: nameS })),
    { struck: struck && [struck.name, struck.tip] },
  );
  await clickG(pickSel(KEY.f2, "hasty"));
  const pk5 = await untilSnap(gm, (s) => rowOf(s, KEY.f2, "hasty")?.picker);
  const locked = rowOf(pk5, KEY.f2, "hasty")?.picker?.find((r) => r.name === nameS);
  const lockText = await run(gm, P.reasonText, { reason: "scene:hastyLocked", name: nameS });
  const stM1 = await st();
  await clickG(assignSel(skilledId, KEY.f2, "hasty"));
  await sleep(1200);
  const stM2 = await st();
  check(
    "the picker lists the skilled searcher with the hastyLocked refusal under their button, and pressing it assigns nothing",
    !!locked && locked.blocked && locked.refusal === lockText && lockText.length > 0 && JSON.stringify(stM2.plan?.[skilledId] ?? null) === JSON.stringify(stM1.plan?.[skilledId] ?? null) && stM2.rounds === stM1.rounds,
    { refusal: locked?.refusal, expected: lockText, before: stM1.plan?.[skilledId] ?? null, after: stM2.plan?.[skilledId] ?? null },
  );
  await clickG('[data-action="cancelPick"]');
  note("the plain searcher's methodical entry stood through the miss", stM0.plan?.[plainId]?.key);

  section("Judge 7: Show the scene");
  const playerBefore = await run(player, P.winOpen, { fid });
  since = await run(gm, P.nowMs);
  const shown = await clickG('[data-action="show"]');
  const hdrShown = await until(async () => {
    const s = await snapG();
    return s?.seat === `${await say(gm, "seat.judge")} · ${await say(gm, "shown.yes")}` ? s : null;
  }, { tries: 20 });
  const playerOpens = await until(async () => ((await run(player, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 });
  const stShown = await st();
  check(
    "pressing Show the scene sets the session shown and the header reads 'shown to the table'",
    shown.found && !!hdrShown && stShown.flag?.shown === true,
    { seat: hdrShown?.seat },
  );
  check("the Player seat's screen opens by itself through the socket (it was closed before the press)", playerBefore === false && !!playerOpens, { before: playerBefore, after: !!playerOpens });
  await sleep(1500);
  await claimCards(since);

  section("Player 2: nothing hidden on the table's screen");
  const gmNow = await snapG();
  const p2 = await snapP([KEY.hid, "hidden-1"]);
  const readP = await run(player, P.readAs, { fid });
  const gmKeys = gmNow.cards.map((c) => c.key);
  const foundCount = countOf(p2?.bar?.found);
  check(
    "the player's screen draws no card for the hidden container: its key is nowhere in the window's HTML, the card count is the player's read's entries, and no Hidden tag stands",
    !!p2 && !p2.empty && !p2.has[KEY.hid].html && !p2.has["hidden-1"].html && p2.cards.length === readP.entries.length && p2.cards.length === gmKeys.length - 1
      && !p2.cards.some((c) => c.key === KEY.hid) && p2.tagCount === 0,
    { player: p2?.cards.length, gm: gmKeys.length, read: readP.entries.length },
  );
  check(
    "the tray has a solid tile per found lot and none for an unfound one, and the tile count is the count the bar reads",
    !!p2 && p2.tray.length > 0 && p2.tray.every((t) => !t.wait) && p2.tray.length === foundCount && foundCount === pile4.cards.filter((c) => c.found === true).length && p2.tray.length < pile4.cards.length,
    { tiles: p2?.tray.length, bar: p2?.bar.found, dealt: pile4.cards.length },
  );
  check(
    "no Judge note and no throw figure is anywhere on the player's screen, and the seat reads the character",
    !!p2 && p2.noteCount === 0 && p2.throwCount === 0 && !/Judge: throw/.test(p2.text) && p2.seat === (await say(player, "seat.player", { names: nameP })) && p2.log.every((l) => l.throw === null),
    { notes: p2?.noteCount, throws: p2?.throwCount },
  );
  const hidPlate = cardOf(gmNow, KEY.hid)?.plate ?? "";
  note("the hidden container's plate on the Judge seat (a kind word, numbered; a text search on it proves little, so the checks above read keys and counts)", hidPlate);

  section("Player 3: picker, drag, chip");
  const p3a = await snapP();
  check(
    "the member tile of the character the player does not own is not draggable, the player's own is",
    p3a.members.length === 2 && p3a.members.find((m) => m.name === nameS)?.draggable === false && p3a.members.find((m) => m.name === nameP)?.draggable === true,
    p3a.members.map((m) => [m.name, m.draggable]),
  );
  await clickP(pickSel(KEY.f2, "hasty"));
  const p3pk = await untilSnap(player, (s) => rowOf(s, KEY.f2, "hasty")?.picker);
  const p3rows = rowOf(p3pk, KEY.f2, "hasty")?.picker ?? [];
  check("the picker lists the player's own character only", p3rows.length === 1 && p3rows[0].name === nameP && !p3rows[0].blocked, p3rows.map((r) => r.name));
  await clickP(assignSel(plainId, KEY.f2, "hasty"));
  const gmChip = await untilSnap(gm, (s) => hasChip(s, KEY.f2, "hasty", nameP));
  const stP3 = await st();
  const ownChip = await untilSnap(player, (s) => hasChip(s, KEY.f2, "hasty", nameP));
  const ownChipRow = rowOf(ownChip, KEY.f2, "hasty")?.chips.find((c) => c.name === nameP);
  check(
    "choosing the own character in the picker declares the assignment: the Judge's seat shows the chip once the Judge's client accepted it, the plan holds it under the player's id, and the player's chip is a removable button",
    !!gmChip && stP3.plan?.[plainId]?.key === "sceneHasty" && stP3.plan[plainId].option === KEY.f2 && stP3.plan[plainId].by === playerId && !!ownChipRow?.removable,
    { by: stP3.plan?.[plainId]?.by === playerId, byWho: await run(gm, P.whoIs, { id: stP3.plan?.[plainId]?.by ?? null }), removable: ownChipRow?.removable },
  );
  const pd = await run(player, P.drag, { fid, actorId: plainId, entry: KEY.fx, layer: "methodical" });
  const gmDrop = await untilSnap(gm, (s) => hasChip(s, KEY.fx, "methodical", nameP) && !hasChip(s, KEY.f2, "hasty", nameP));
  const stP3b = await st();
  check(
    "a drop of the own character onto a rail declares the assignment: the Judge's seat shows the chip on that rail (the drop is a synthetic event)",
    pd.payloadOk && !!gmDrop && stP3b.plan?.[plainId]?.option === KEY.fx && stP3b.plan[plainId].by === playerId,
    { drag: pd, plan: stP3b.plan?.[plainId]?.option },
  );
  // Another member's chip, as the player reads it: the Judge assigns the skilled searcher at a rail they may attempt.
  const optS = await run(gm, P.optionRows, { fid, actorId: skilledId });
  const stNow = await st();
  const foundAt = (key, layer) => stNow.things.find((t) => `thing:${t.id}` === key)?.state?.layers?.[layer]?.found === true;
  let cand = null;
  for (const row of optS) {
    if (row.key === KEY.far || row.key === KEY.hid) continue;
    const l = row.layers.find((x) => !x.refusal && !foundAt(row.key, x.layer));
    if (l) { cand = { key: row.key, layer: l.layer }; break; }
  }
  if (cand) {
    await run(gm, P.assign, { fid, actorId: skilledId, layer: cand.layer, entryKey: cand.key });
    const other = await untilSnap(player, (s) => hasChip(s, cand.key, cand.layer, nameS));
    const oc = rowOf(other, cand.key, cand.layer)?.chips.find((c) => c.name === nameS);
    check("another character's chip on a rail is plain text on the player's screen, not a button", !!oc && oc.removable === false, { rail: cand });
    await run(gm, P.unassign, { fid, actorId: skilledId });
  } else {
    const struckSeen = rowOf(await snapP(), KEY.f2, "hasty")?.chips.find((c) => c.struck && c.name === nameS);
    check("another character's chip on a rail is plain text on the player's screen (no open rail for the skilled searcher; the struck chip stands for it)", !!struckSeen && struckSeen.removable === false, null);
  }
  await clickP('[data-action="unassign"]');
  const gone = await until(async () => { const s = await st(); return s.plan?.[plainId] ? null : s; });
  check("pressing the player's own chip takes the character off the plan", !!gone, { plan: gone?.plan });

  section("Player 4: a hand-made plan request at the hidden entry");
  const hidState = async () => {
    const s = await st();
    const t = s.things.find((x) => `thing:${x.id}` === KEY.hid);
    return { done: ["hasty", "methodical"].some((n) => t?.state?.layers?.[n]?.done === true), shown: t?.state?.shown === true, rows: (s.log ?? []).filter((r) => r.key === KEY.hid).length, s };
  };
  for (const [kind, key, action, die] of [["methodical", "sceneMethodical", "spend", HIT], ["hasty", "sceneHasty", "round", HIT]]) {
    await run(player, P.requestPlan, { fid, actorId: plainId, key, option: KEY.hid });
    await sleep(2000);
    const locked4 = await st();
    const entry = locked4.plan?.[plainId] ?? null;
    note(`the hand-made ${kind} request at the hidden key was accepted into the plan`, !!entry && entry.option === KEY.hid);
    const h0 = await hidState();
    since = await run(gm, P.nowMs);
    const pr = await run(gm, P.pressScreen, { fid, action, die, until: action === "spend" ? "turn" : "none", turnsBefore: locked4.turns });
    const made = await claimCards(since, [nameP]);
    const h1 = await hidState();
    const gmS = await snapG();
    check(
      `the Judge's ${action === "spend" ? "Spend a turn" : "Round"} never resolves the ${kind} check at the hidden entry: no log row, no state change, the container stays hidden`,
      pr.pressed && !!entry && !h1.done && !h1.shown && h1.rows === 0 && h0.rows === 0 && cardOf(gmS, KEY.hid)?.hidden === true,
      { entry: !!entry, done: h1.done, shown: h1.shown, rows: h1.rows, hidden: cardOf(gmS, KEY.hid)?.hidden, plan: h1.s.plan?.[plainId] ?? null },
    );
    note(`cards naming the member after the ${kind} press (the refusal is the resolve's answer, not an unresolved entry, so none is expected)`, made.filter((c) => c.mentions[0]).length);
  }
  await run(gm, P.unassign, { fid, actorId: plainId });

  section("Player 6: the player's own Round and Spend a turn");
  const stP6a = await st();
  since = await run(gm, P.nowMs);
  const askR = await run(player, P.say, { ns: "formation", key: "request.askRound" });
  const askT = await run(player, P.say, { ns: "formation", key: "request.askTurn" });
  const pr1 = await clickP('[data-action="round"]');
  await sleep(2500);
  const afterRound = await run(gm, P.cards, { since, names: [askR, askT] });
  const pr2 = await clickP('[data-action="spend"]');
  await sleep(2500);
  const afterBoth = await run(gm, P.cards, { since, names: [askR, askT] });
  await claimCards(since);
  const stP6b = await st();
  check(
    "each press on the player's seat posts exactly one declaration card, and the Judge's clock (turns and rounds) and turn plan are unchanged after both",
    pr1.found && pr2.found && afterRound.length === 1 && afterRound[0].mentions[0] && afterBoth.length === 2 && afterBoth.filter((c) => c.mentions[0]).length === 1 && afterBoth.filter((c) => c.mentions[1]).length === 1
      && stP6b.turns === stP6a.turns && stP6b.rounds === stP6a.rounds && sameJson(stP6a.plan, stP6b.plan),
    { cards: [afterRound.length, afterBoth.length], turns: [stP6a.turns, stP6b.turns], rounds: [stP6a.rounds, stP6b.rounds] },
  );

  section("Player 7: Open the pot");
  const pileNow = await run(gm, P.pile, { potUuid: opened.potUuid });
  const foundIds = pileNow.cards.filter((c) => c.found === true).map((c) => c.id).sort();
  const unfoundIds = pileNow.cards.filter((c) => c.found !== true).map((c) => c.id);
  if (!unfoundIds.length) note("every lot is found, so 'found lots only' cannot be told from 'all lots'", pileNow.cards.length);
  const potBtn = await clickP('[data-action="openPot"]');
  const potWin = await until(async () => {
    const w = await run(player, P.potWindow, { potUuid: opened.potUuid });
    return w.rendered ? w : null;
  }, { tries: 10, every: 500 });
  check(
    "Open the pot opens the pot's window on the player's seat, listing the found lots only",
    potBtn.found && !potBtn.disabled && !!potWin && unfoundIds.length > 0 && potWin.ids.length > 0 && potWin.ids.slice().sort().join() === foundIds.join() && !potWin.ids.some((id) => unfoundIds.includes(id)),
    { listed: potWin?.ids.length, found: foundIds.length, unfound: unfoundIds.length },
  );

  section("Judge 6: Spend a turn reveals the hidden container");
  await run(gm, P.assign, { fid, actorId: plainId, layer: "methodical", entryKey: KEY.fx });
  const j6a = await untilSnap(gm, (s) => hasChip(s, KEY.fx, "methodical", nameP));
  const stT0 = await st();
  const turnWord0 = await say(gm, "turn.label", { n: stT0.turns });
  const hiddenBefore = cardOf(j6a, KEY.hid)?.hidden === true;
  since = await run(gm, P.nowMs);
  const tp = await run(gm, P.pressScreen, { fid, action: "spend", die: HIT, until: "turn", turnsBefore: stT0.turns, thingId: "fixture-1", placeId });
  await claimCards(since);
  const stT1 = await st();
  const j6 = await untilSnap(gm, (s) => cardOf(s, KEY.hid)?.hidden === false && s.bar.turn !== turnWord0);
  const hidAfter = cardOf(j6, KEY.hid);
  check("the Spend a turn press resolves the plain searcher's methodical check and spends a turn", tp.pressed && tp.done && stT1.turns === stT0.turns + 1 && stT0.turns >= 0 && j6a.bar.turn === turnWord0, { turns: [stT0.turns, stT1.turns] });
  check(
    "the bar's Turn count rises by one, and the hidden container's Hidden tag goes and its state reads Seen",
    !!j6 && j6.bar.turn === (await say(gm, "turn.label", { n: stT0.turns + 1 })) && hiddenBefore && hidAfter.tag === null && hidAfter.state === (await say(gm, "state.seen")),
    { turn: j6?.bar.turn, state: hidAfter?.state, tag: hidAfter?.tag },
  );
  const fxAfter = cardOf(j6, KEY.fx);
  const f1After = cardOf(j6, KEY.f1);
  check(
    "the fixture's 'something more' line shows the generic words while its clue stays unfound, and a card with nothing left unfound shows none",
    fxAfter?.tell === (await say(gm, "tell.generic")) && f1After?.tell === null,
    { fixture: fxAfter?.tell, floor: f1After?.tell },
  );

  section("Player 5: the table's log after Round and Turn");
  const gmLog = (await st()).log ?? [];
  const emptyLogP = await say(player, "log.empty");
  const p5 = await untilSnap(player, (s) => s.log.filter((l) => l.head !== emptyLogP).length >= 1 && !!s.cards.length);
  const pRows = (p5?.log ?? []).filter((l) => l.head !== emptyLogP);
  const newestFirst = gmLog.slice().reverse();
  const nameOfActor = (id) => (id === skilledId ? nameS : id === plainId ? nameP : "");
  const sayFoundSomething = await say(player, "log.foundSomething");
  const sayMore = await say(player, "log.more");
  const sayVague = await say(player, "tell.vague");
  let rowsOk = pRows.length === newestFirst.length && newestFirst.length > 0;
  const detail = [];
  for (const [i, row] of newestFirst.entries()) {
    const shownRow = pRows[i];
    const code = String(row.code ?? "");
    let want = "";
    if (code.endsWith("vague")) want = sayVague;
    else if (code.endsWith("found")) {
      want = [row.clue ? await say(player, "finds.clue", { clue: row.clue }) : sayFoundSomething, (row.more ?? []).length ? sayMore : ""].filter(Boolean).join(" ");
    }
    const okRow = !!shownRow && shownRow.head.includes(nameOfActor(row.actorId)) && shownRow.text === want && shownRow.throw === null;
    detail.push([code.replace(/^scene:/, ""), okRow]);
    rowsOk = rowsOk && okRow;
  }
  check(
    "the player's log shows who searched what: a found row carries its clue or 'Found something.' and 'Something more is here.' only where something remains, a vague row the vague words, a missed check only who and what; no row has a throw figure",
    !!p5 && rowsOk && p5.throwCount === 0 && p5.noteCount === 0,
    { rows: pRows.length, expected: newestFirst.length, perRow: detail },
  );
  check(
    "the player's screen now draws the container the Judge's turn revealed",
    cardOf(p5, KEY.hid)?.hidden === false && cardOf(p5, KEY.hid)?.state === (await say(player, "state.seen")),
    { state: cardOf(p5, KEY.hid)?.state },
  );
  const gmFinal = await snapG();
  check("the Judge's seat carries a throw figure on a log row and the player's carries none", gmFinal.throwCount > 0 && p5.throwCount === 0, { gm: gmFinal.throwCount, player: p5?.throwCount });

  section("Judge 8: layout and scroll retention");
  const sheet = await run(gm, P.styleSheet, { fid });
  note("the screen's stylesheet is loaded by the running world", sheet.loaded);
  if (!sheet.loaded) {
    const inj = await run(gm, P.styleSheet, { fid, inject: true });
    note("not loaded: module.json's styles are read at world launch and this world predates S4, so the layout checks below run on an injected copy of styles/scene-search.css (they prove the stylesheet, not its loading)", inj);
  }
  const lay = await run(gm, P.layout, { fid, width: 900, height: 640, base: "16px" });
  note("window after the shrink", lay.win);
  check(
    "on a smaller window with a raised type size the header, bar and tray stay inside the window",
    !!lay.head?.ok && !!lay.bar?.ok && !!lay.tray?.ok,
    { win: lay.win, head: lay.head, bar: lay.bar, tray: lay.tray },
  );
  check(
    "there the entries column scrolls on its own (content taller than the column, overflow-y auto) and the window frame itself does not scroll",
    !!lay.entries && lay.entries.sh > lay.entries.ch && ["auto", "scroll"].includes(lay.entries.overflowY) && !!lay.frame && lay.frame.sh <= lay.frame.ch + 2,
    { entries: lay.entries, aside: lay.aside, frame: lay.frame },
  );
  check("the type knob reaches the window: the banner's computed size grew when --acks-fs-base was raised on the document root", lay.fontAfter > lay.fontBefore, { before: lay.fontBefore, after: lay.fontAfter });
  await run(gm, P.unlayout, { fid });
  const tiny = await run(gm, P.layout, { fid, width: 520, height: 420, base: "22px" });
  check(
    "on a window too short for the board's floor the content box scrolls and the tray is within its scroll, never cut off",
    !!tiny.frame && ["auto", "scroll"].includes(tiny.frame.overflowY) && !!tiny.trayReach && tiny.trayReach.bottomInScroll <= tiny.trayReach.sh + 2 && !!tiny.head?.ok,
    { win: tiny.win, frame: tiny.frame, tray: tiny.trayReach, head: tiny.head },
  );
  await run(gm, P.unlayout, { fid });
  await run(gm, P.layout, { fid, width: 900, height: 640, base: "16px" });
  const stuck = await run(gm, P.scrollOf, { fid, top: 120 });
  check("the entries column holds a scroll position (it moved off zero)", stuck > 0, { scrollTop: stuck });
  await clickG(pickSel(KEY.f2, "hasty"));
  await untilSnap(gm, (s) => rowOf(s, KEY.f2, "hasty")?.picker);
  await clickG(assignSel(plainId, KEY.f2, "hasty"));
  const j8 = await untilSnap(gm, (s) => hasChip(s, KEY.f2, "hasty", nameP));
  await sleep(500);
  const kept = await run(gm, P.scrollOf, { fid });
  check("assigning a member while scrolled down re-renders the window and the entries' scroll position is kept", !!j8 && stuck > 0 && Math.abs(kept - stuck) <= 2, { before: stuck, after: kept });
  await run(gm, P.unlayout, { fid });

  section("Judge 9: end with the window open");
  const errBefore = (await run(gm, P.drain)).errors.length + (await run(player, P.drain)).errors.length;
  await run(gm, P.unassign, { fid, actorId: plainId });
  const ended = await run(gm, P.endSession, { fid });
  const emptyWord = await run(gm, P.say, { ns: "scene", key: "reason.noSession" });
  const endG = await untilSnap(gm, (s) => s.empty === emptyWord);
  const endP = await untilSnap(player, (s) => s.empty === emptyWord);
  const errAfter = (await run(gm, P.drain)).errors.length + (await run(player, P.drain)).errors.length;
  check(
    "ending the session with the windows open leaves them reading 'No scene search is open' on both seats, with nothing drawn and nothing thrown",
    ended.ok && !!endG && !!endP && !endG.bar && endG.cards.length === 0 && errAfter === errBefore,
    { gm: endG?.empty, player: endP?.empty, errors: [errBefore, errAfter] },
  );

  section("console");
  for (const [key, api] of Object.entries({ gm, player })) {
    const drained = await run(api, P.drain);
    const boot = (await run(api, P.boot)).slice(bootBase[key]);
    const named = [...drained.errors, ...boot].filter((e) => /scene-search|SceneSearch|screen-logic/i.test(e));
    note(`${key}: console errors and page errors since the walk began (any text)`, drained.errors.length + boot.length);
    check(`${key}: no console error, page error or unhandled rejection names a scene-search file (the recorder was attached from load)`, named.length === 0, named.slice(0, 3).map((e) => e.slice(0, 140)));
  }

  section("teardown");
  const { swept, wanted } = await teardown();
  check(
    "the run's own documents were swept by tracked id (the pot and the party's chat cards), and the kept fixtures stand",
    (swept?.failed ?? []).length === 0 && (swept?.removed ?? []).length === wanted && wanted >= 1,
    { removed: (swept?.removed ?? []).length, missing: (swept?.missing ?? []).length, failed: (swept?.failed ?? []).length, wanted },
  );
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.log(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  try { if (gm && !tornDown) { section("teardown after a stop"); await teardown(); } } catch (err) { console.error("teardown:", err?.message ?? err); }
  try { if (gm) { await run(gm, P.unhook); await run(gm, P.restore); } } catch {}
  try { if (player) await run(player, P.restore); } catch {}
  finish();
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
}
