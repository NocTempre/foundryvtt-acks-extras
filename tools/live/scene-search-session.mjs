/**
 * Live walk, scene search: the session, the activities and the drops, slice S2.
 * Walks docs/scene-search/TESTING.md "S2 — session, activities and drops" on
 * both seats. The GM seat opens and ends a session through
 * `acksExtras.sceneSearch`, assigns searchers (a plan lock), presses the Round
 * through `resolveRound` and the Turn through the party sheet's Advance turn
 * button, and drops Items on the map; the Player seat reads the projection,
 * declares its own character's check through the party's request relay and is
 * refused what it may not do. Every observable is a boolean, a count or a
 * code. Every figure typed into a fixture is invented. Machine values arrive
 * through ./_env.mjs by way of the treasure kit.
 *
 * Covers: boot on both seats; the kept fixtures; Judge 1 (open: the session's
 * flag, a lot row per dealt lot, the place's list holding no lot key, the
 * pot's party), 2 (assign: the plan's entries, an assign replacing the
 * member's entry, the thing past the reach refused), 3 (Round press with the
 * die held at a 20: the lot found, the thing's state, the vague row, the
 * Judges' card and no table card, the hasty entries gone; a second searcher at
 * a found floor refused), 4 (the lock: a 1 records the character's level, the
 * same check is refused, a raised level is offered it again), 5 (Turn press:
 * the methodical entry resolves, the hidden container shown), 7 (end unsets
 * the flag, the pot stays); Player 1 (the projection hides the hidden
 * container, every unfound yield, and the session's lots and bodies, and marks
 * the fixture), 2 (own character through the relay, another member refused on
 * the player's client), 3 (open and end refused); Judge 6 (drops: a trap and a
 * hazard Item dropped on the place's Region and on the bare Region, the bare
 * Region made a place with its sheet closed, a trap dropped beside a wall
 * assigned to the wall, and the same two Items dropped in the Region window's
 * Place row carrying no point); teardown by tracked id.
 *
 * Scripted, not gestured: the session calls, the assigns and the Round press
 * are API calls (the scene screen, S4, does not exist yet); the map drop is
 * `Hooks.call("dropCanvasData", canvas, data)` on the walk's scene, which is
 * the one handler a real drag reaches, and not a pointer drag (the Item's
 * drag data is built by hand); the Region window's drop is a dispatched
 * `drop` event on its Place row's zone, with its drag data in a
 * `DataTransfer`. The Turn press is a real click on the party sheet's Advance
 * turn button. The die is held through `CONFIG.Dice.randomUniform` around each
 * press: a 20 for the skilled searcher's throw and the plain searcher's
 * methodical throw, a 1 for the failure that locks; restored after each.
 *
 * Fixtures, kept and found by marker (the recipe's, and the walk's own):
 * `scene-search/session-scene` (a scene with a grid and a scale),
 * `scene-search/session-region` (a Region with no behaviors, the place's) and
 * `scene-search/session-region-bare` (a second Region with none, the drop's),
 * `scene-search/session-place` (a location linked to the first Region; its
 * things are written whole at every start), `scene-search/session-party` (the
 * walk's own party: an actor is in one party at a time, and the formation
 * recipe's parties belong to its walks), `scene-search/searcher-skilled` (a
 * hand-made ability bound to Search with an invented flat throw, level 2: the
 * stand-in for holding the Searching proficiency, as formation-turn-plan.mjs
 * gives its thief one) and `scene-search/searcher-plain` (owned by the Player
 * seat, an invented stored Adventuring figure and no skill),
 * `scene-search/drop-trap` and `scene-search/drop-hazard` (the Items dragged).
 * The run's own, retired by marker at the start and swept by tracked id at the
 * end: the session's pot `scene-search/session-pot`, the place the drop makes
 * on the bare Region `scene-search/drop-place`, the wall the trap is dropped
 * beside `scene-search/drop-wall`, and the chat cards the GM seat posts
 * speaking as the party (claimed by the walk's nonce and the party's name).
 *
 * Not reached: a session opened from a fight's record (`recordMessageId`, the
 * fallen as bodies), a hidden exit revealed (`wall:` reveals and
 * `revealSecretDoor`, unbuilt), doors and old-style traps derived from the
 * map, a methodical check of more than one turn, the scene screen (S4), a real
 * pointer drag of an Item from the sidebar onto the canvas, and the world with
 * no treasure tables or no imported search reach (both block the walk).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, section, check, note, finish, watchdog, openSeats, run, idOf, sleep } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/session-scene",
  regionA: "scene-search/session-region",
  regionB: "scene-search/session-region-bare",
  place: "scene-search/session-place",
  party: "scene-search/session-party",
  skilled: "scene-search/searcher-skilled",
  plain: "scene-search/searcher-plain",
  dropTrap: "scene-search/drop-trap",
  dropHazard: "scene-search/drop-hazard",
  pot: "scene-search/session-pot",
  dropPlace: "scene-search/drop-place",
  dropWall: "scene-search/drop-wall",
};
const NAMES = {
  scene: "QA Scene Session Scene",
  regionA: "QA Scene Session Region",
  regionB: "QA Scene Session Bare Region",
  place: "QA Scene Session Place",
  party: "QA Scene Session Party",
  skilled: "QA Scene Skilled Searcher",
  plain: "QA Scene Plain Searcher",
  trap: "QA Scene Drop Trap",
  hazard: "QA Scene Drop Hazard",
  search: "QA Scene Search Skill",
};
const NONCE = "sss" + Math.random().toString(36).slice(2, 7);
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
  ...K,

  /** The modules every page function below reaches, and, on the GM seat, a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__ss = globalThis.__ss ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.things = await import(`${base}lib/place-things.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.tokenCentre = (await import(`${base}lib/token-centre.mjs`)).tokenCentre;
    X.dist = await import(`${base}lib/distance-units.mjs`);
    X.rules = await import(`${base}formation/trap-rules.mjs`);
    X.row = await import(`${base}formation/region-place-row.mjs`);
    X.walls = await import(`${base}formation/trap-walls.mjs`);
    X.pot = await import(`${base}treasure/pot.mjs`);
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
    return { api: typeof api?.open === "function" && typeof api?.assign === "function", round: typeof api?.resolveRound === "function", scenes: typeof acksExtras?.location?.scenes?.locationOfRegion === "function" };
  },
  unhook: async () => {
    const X = globalThis.__ss;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  /** The ids of every pot in the world, counted by the pot's own test. */
  potIds: async () => {
    const X = globalThis.__ss;
    return game.cards.filter((c) => X.pot.isPot(c)).map((c) => c.id);
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
      plainLevel: Number(plain.system.details.level),
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
  /**
   * The party's start shape: both searchers in it, its token on the scene, no
   * plan, no stance of hurrying, not paused, nobody moved this turn, every
   * member whole. Answers `fight: true` and changes nothing when a combat
   * holds the party.
   */
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
  /** Each Region's one rectangle brought to its place, and what behaviors it holds. */
  shapeRegions: async ({ regions } = {}) => {
    const out = [];
    for (const { uuid, rect } of regions) {
      const region = await fromUuid(uuid);
      const s = region.shapes[0];
      const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
      if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
      out.push({ shapes: region.shapes.length, behaviors: region.behaviors.size });
    }
    return out;
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
  /** The Region's link flag cleared: a place the run made and swept leaves a flag naming nothing. */
  unlinkRegion: async ({ regionUuid } = {}) => {
    const X = globalThis.__ss;
    const region = await fromUuid(regionUuid);
    await X.link.unlinkRegion(region);
    return { place: X.link.locationOfRegion(region)?.uuid ?? null };
  },
  /** The place a Region is, and whether its sheet is open. */
  regionPlace: async ({ regionUuid } = {}) => {
    const X = globalThis.__ss;
    const region = await fromUuid(regionUuid);
    const place = X.link.locationOfRegion(region);
    return { uuid: place?.uuid ?? null, id: place?.id ?? null, rendered: !!place?.sheet?.rendered };
  },
  /** The place's list written whole. */
  shapePlace: async ({ placeId, things } = {}) => {
    const a = game.actors.get(placeId);
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((t) => t.id) };
  },
  /** A place's list, as `thingsOf` reads it. */
  thingsOf: async ({ placeId } = {}) => {
    const X = globalThis.__ss;
    return X.things.thingsOf(game.actors.get(placeId)).map((t) => ({ id: t.id, kind: t.kind, ref: t.ref, hidden: t.hidden, point: t.point, state: t.state, lotKeys: ["hasty", "methodical"].flatMap((n) => t.layers?.[n]?.yields?.lots ?? []) }));
  },
  /** The party's session flag and plan as stored, its place's list, the clock and the log. */
  state: async ({ fid, partyId, placeId } = {}) => {
    const X = globalThis.__ss;
    const party = game.actors.get(partyId);
    const f = X.model.getFormation(fid);
    return {
      flag: party.getFlag("acks-extras", "sceneSearch") ?? null,
      plan: party.getFlag("acks-extras", "turnPlan") ?? null,
      things: X.things.thingsOf(game.actors.get(placeId)).map((t) => ({ id: t.id, hidden: t.hidden, state: t.state, lotKeys: ["hasty", "methodical"].flatMap((n) => t.layers?.[n]?.yields?.lots ?? []) })),
      turns: f.clock.turnsTotal,
      log: acksExtras.sceneSearch.read(fid)?.log ?? null,
    };
  },
  /** The pot at a uuid: its party, its phase and every card's found flag and lot key. */
  pile: async ({ potUuid } = {}) => {
    const X = globalThis.__ss;
    const pile = await fromUuid(potUuid);
    if (!pile) return null;
    const view = X.pot.viewOf(pile);
    return {
      partyId: pile.getFlag("acks-extras", "treasure")?.partyId ?? null,
      phase: view.pot.phase,
      cards: view.cards.map((c) => ({ id: c.id, found: c.truth?.found, lot: c.truth?.lot ?? null })),
    };
  },
  /** Open a session, the die held while the pot is dealt. */
  openSession: async ({ fid, placeUuid, sceneId, sources, die = 0.025 } = {}) => {
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    try {
      const r = await acksExtras.sceneSearch.open({ partyId: fid, placeUuid, sceneId, sources, metInLair: true });
      return { ok: r.ok === true, reason: r.reason ?? null, entry: r.entry ?? null, potUuid: r.potUuid ?? null, lots: r.session?.lots ?? [], placeUuid: r.session?.placeUuid ?? null, sceneId: r.session?.sceneId ?? null };
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
  },
  endSession: async ({ fid } = {}) => {
    const r = await acksExtras.sceneSearch.end(fid);
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  /** What `read` answers on this seat: each entry's visibility, its mark, whether an unfound layer still holds a yield, and the session's keys. */
  readAs: async ({ fid } = {}) => {
    const r = acksExtras.sceneSearch.read(fid);
    if (!r) return null;
    const names = ["hasty", "methodical"];
    return {
      entries: r.entries.map((e) => ({
        key: e.key,
        shown: e.state?.shown === true,
        moreRemains: !!e.moreRemains,
        leaks: names.filter((n) => !e.state?.layers?.[n]?.found && (e.layers[n].yields.lots.length || e.layers[n].yields.clue || e.layers[n].yields.reveal.length)).length,
        lotsHeld: names.reduce((n, nm) => n + e.layers[nm].yields.lots.length, 0),
      })),
      sessionKeys: Object.keys(r.session),
      logRows: r.log.length,
      place: r.place?.uuid ?? null,
    };
  },
  options: async ({ fid, actorId, key } = {}) => {
    const rows = acksExtras.sceneSearch.options({ partyId: fid, actorId });
    const row = rows.find((r) => r.key === key);
    const pick = (l) => (l ? { mode: l.mode, refusal: l.refusal ?? null, hasTarget: l.target !== null && l.target !== undefined } : null);
    return { found: !!row, hasty: pick(row?.layers?.find((l) => l.layer === "hasty")), methodical: pick(row?.layers?.find((l) => l.layer === "methodical")) };
  },
  assign: async ({ fid, actorId, layer, entryKey } = {}) => {
    const r = await acksExtras.sceneSearch.assign({ partyId: fid, actorId, layer, entryKey });
    return { ok: r.ok === true, reason: r.reason ?? null, key: r.entry?.key ?? null, option: r.entry?.option ?? null };
  },
  unassign: async ({ fid, actorId } = {}) => {
    const r = await acksExtras.sceneSearch.unassign({ partyId: fid, actorId });
    return { ok: r.ok === true, reason: r.reason ?? null, unlocked: r.unlocked ?? null };
  },
  assignments: async ({ fid } = {}) => acksExtras.sceneSearch.assignments(fid),
  setLevel: async ({ actorId, level } = {}) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.details.level": level });
    return Number(actor.system.details.level);
  },
  /** The Round press, the die held until every entry has resolved. */
  roundPress: async ({ fid, die } = {}) => {
    const X = globalThis.__ss;
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    try {
      const answer = await acksExtras.sceneSearch.resolveRound(X.model.getFormation(fid));
      return {
        results: (answer.results ?? []).map((r) => ({ actorId: r.actorId, key: r.key, option: r.option ?? null, status: r.status })),
      };
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
  },
  /**
   * The Turn press: a click on the party sheet's Advance turn, the die held
   * until the methodical check has written its state. The clock spends the turn
   * before the entry rolls, so the hold is released on the roll's own write, not
   * on the clock.
   */
  pressTurn: async ({ partyId, fid, placeId, thingId, die, turns } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const sheet = game.actors.get(partyId).sheet;
    if (!sheet.rendered) await sheet.render(true);
    if (!H.opened.includes(sheet)) H.opened.push(sheet);
    await H.sleep(500);
    H.root(sheet)?.querySelector('[data-action="tab"][data-tab="mode"]')?.click();
    await H.sleep(200);
    const pill = H.root(sheet)?.querySelector('[data-action="advanceTurn"]');
    if (!pill) return { pressed: false };
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    let rolled = null;
    try {
      pill.click();
      rolled = await H.poll(() => (X.things.thingsOf(game.actors.get(placeId)).find((t) => t.id === thingId)?.state?.layers?.methodical?.done === true ? true : null), { tries: 120, every: 250 });
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    const advanced = await H.poll(() => (X.model.getFormation(fid).clock.turnsTotal > turns ? true : null), { tries: 60, every: 200 });
    await H.sleep(1500);
    return { pressed: true, rolled: !!rolled, advanced: !!advanced };
  },
  /** The cards this GM client made since `since`, with who each went to and whether it names each of `names`. */
  cards: async ({ since = 0, names = [] } = {}) => {
    const X = globalThis.__ss;
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    return (X.cards ?? [])
      .filter((c) => c.at >= since)
      .map((c) => ({ id: c.id, uuid: c.uuid, alias: c.alias, toJudges: c.whisper.length > 0 && c.whisper.every((u) => gms.includes(u)), isPublic: !c.whisper.length, mentions: names.map((n) => c.html.includes(n)) }));
  },

  /** The walk's scene on this seat's canvas, waited for. */
  view: async ({ sceneId } = {}) => {
    const H = globalThis.__tk;
    H.prevScene = H.prevScene ?? canvas.scene?.id ?? null;
    if (canvas.scene?.id !== sceneId) await game.scenes.get(sceneId).view();
    const ok = await H.poll(() => (canvas.ready && canvas.scene?.id === sceneId ? true : null), { tries: 100, every: 200 });
    return { viewed: !!ok };
  },
  unview: async ({ sceneId } = {}) => {
    const H = globalThis.__tk;
    const back = H?.prevScene;
    if (H) H.prevScene = null;
    if (back && back !== sceneId && game.scenes.get(back)) await game.scenes.get(back).view();
    return true;
  },
  makeWall: async ({ sceneId, c } = {}) => {
    const [wall] = await game.scenes.get(sceneId).createEmbeddedDocuments("Wall", [{ c }]);
    return { uuid: wall.uuid, id: wall.id };
  },
  wallTrapOf: async ({ sceneId, wallId } = {}) => {
    const X = globalThis.__ss;
    const wall = game.scenes.get(sceneId).walls.get(wallId);
    return { trapUuid: X.walls.wallTrap(wall)?.trapUuid ?? null };
  },
  /** A drag of an Item dropped on the map: the hook a real drop reaches, on the viewed scene's canvas. */
  dropMap: async ({ uuid, x, y } = {}) => {
    const answer = Hooks.call("dropCanvasData", canvas, { type: "Item", uuid, x, y });
    return { returned: answer };
  },
  /** A drag of an Item dropped on the Place row of a Region's own window; when no row is drawn, the row's own drop function is called and `gesture` says so. */
  dropWindow: async ({ regionUuid, uuid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const region = await fromUuid(regionUuid);
    const app = region.sheet;
    if (!H.opened.includes(app)) H.opened.push(app);
    await app.render({ force: true });
    const zone = await H.poll(() => H.root(app)?.querySelector(".acks-extras-region-place-drop") ?? null, { tries: 40, every: 150 });
    if (zone) {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { gesture: true };
    }
    await X.row.dropOnRegionPlace({ region, scenes: acksExtras.location.scenes, data: { type: "Item", uuid } });
    return { gesture: false };
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
const thingIn = (st, id) => st.things.find((t) => t.id === id) ?? null;
const layerIn = (st, id, name) => thingIn(st, id)?.state?.layers?.[name] ?? {};
const samePoint = (p, x, y) => !!p && p.x === x && p.y === y;

let gm = null;
let player = null;
watchdog(() => [gm, player], 900_000);
const own = { pot: null, places: [], wall: null, cards: [] };
let ids = null;
let tornDown = false;

/** Claim the party's cards this client made since `since`, by the run's nonce and the party's name; the claimed ones are tracked for the sweep. */
async function claimCards(since, names = []) {
  const made = await run(gm, P.cards, { since, names });
  const mine = made.filter((c) => c.alias === NAMES.party);
  for (const c of mine) own.cards.push(gm.track(c.uuid, "ChatMessage"));
  return mine;
}

/** Close the windows, end any session, put the place's list back to its start, sweep what the run made, and give the seat its scene back. */
async function teardown() {
  tornDown = true;
  await run(gm, P.closeAll).catch(() => null);
  if (ids) {
    await run(gm, P.endSession, { fid: ids.fid }).catch(() => null);
    if (ids.things) await run(gm, P.shapePlace, { placeId: ids.placeId, things: ids.things }).catch(() => null);
    await claimCards(0).catch(() => null);
  }
  const only = unique([own.pot, ...own.places, own.wall, ...own.cards]);
  const swept = await gm.sweepTracked({ only });
  note("swept", swept);
  if (ids?.regionB) await run(gm, P.unlinkRegion, { regionUuid: ids.regionB }).catch(() => null);
  if (ids?.sceneId) await run(gm, P.unview, { sceneId: ids.sceneId }).catch(() => null);
  return { swept, wanted: only.length };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|activities|round|places-around|region-place|haul|treasure|pot-sheet/i });
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch is not on both seats");
  if (!setG.round) blocked("acksExtras.sceneSearch.resolveRound is not on the GM seat");
  if (!setG.scenes) blocked("acksExtras.location.scenes is not on the GM seat");

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
  const dropTrap = await gm.fixture(MARKS.dropTrap, "Item", { name: NAMES.trap, type: "acks-extras.trap" });
  const dropHazard = await gm.fixture(MARKS.dropHazard, "Item", { name: NAMES.hazard, type: "acks-extras.hazard", system: { key: "jump" } });
  const partyId = idOf(party);
  const skilledId = idOf(skilled);
  const plainId = idOf(plain);
  const placeId = idOf(place);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;

  const { fid, error } = await run(gm, P.formationOf, { partyId });
  if (error) blocked(error);
  ids = { fid, placeId, sceneId, things: null, regionB: null };

  // Nothing of an earlier run stands: a session, a pot, the place the drop made and the wall it was dropped beside.
  note("an earlier session ended", (await run(gm, P.endSession, { fid })).ok);
  await gm.retire(MARKS.pot, "Cards");
  await gm.retire(MARKS.dropPlace, "Actor");
  await gm.retire(MARKS.dropWall, "Wall", { parent: scene.uuid });

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
  const rectB = { x: cx + 800, y: cy - 200, width: 400, height: 400 };
  const regionA = await gm.fixture(MARKS.regionA, "Region", { name: NAMES.regionA, color: "#336699", shapes: [{ type: "rectangle", ...rectA, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const regionB = await gm.fixture(MARKS.regionB, "Region", { name: NAMES.regionB, color: "#996633", shapes: [{ type: "rectangle", ...rectB, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  ids.regionB = regionB.uuid;
  const regions = await run(gm, P.shapeRegions, { regions: [{ uuid: regionA.uuid, rect: rectA }, { uuid: regionB.uuid, rect: rectB }] });
  // A leftover link on the bare Region would make it a place's; the place it named is retired above by its marker.
  await run(gm, P.unlinkRegion, { regionUuid: regionB.uuid });
  const linked = await run(gm, P.linkPlace, { regionUuid: regionA.uuid, placeId });
  const BASE = thingsFor({ cx, cy, far });
  ids.things = BASE;
  const placed = await run(gm, P.shapePlace, { placeId, things: BASE });

  check(
    "the kept fixtures stand in shape: the scene's scale, both Regions with no behavior, the place linked to the first, its list written whole, the searchers at their level and figure (one skilled, one plain, the plain one the Player seat's), the party holding both with its token on the scene and no plan or session",
    sceneShape.size === 100 && sceneShape.distance === 5
      && regions.length === 2 && regions.every((r) => r.shapes === 1 && r.behaviors === 0)
      && linked.linked
      && placed.type === "acks-extras.location" && placed.things.join() === "floor-1,floor-2,fixture-1,hidden-1,far-1"
      && chars.skilledLevel === 2 && chars.plainOwned && !chars.skilledOwned
      && items === 1 && bound.skilled === 1 && bound.plain === 0
      && shape.members.length === 2 && shape.sceneId === sceneId && shape.partyToken && !shape.plan && !shape.session && !shape.paused && !shape.moved && !shape.hurried,
    { sceneShape, regions, linked, placed: placed.things, chars, items, bound, shape },
  );

  section("Judge 1: open");
  const potsBefore = await run(gm, P.potIds);
  const unknown = await run(gm, P.openSession, { fid, placeUuid, sceneId, sources: [{ thing: "thing:no-such-entry", letters: [LETTER] }], die: HIT });
  const potsAfterUnknown = await run(gm, P.potIds);
  check("a source naming no entry is refused unknownEntry and deals no pot", unknown.ok === false && unknown.reason === "scene:unknownEntry" && potsAfterUnknown.length === potsBefore.length, { reason: unknown.reason });

  const opened = await run(gm, P.openSession, { fid, placeUuid, sceneId, sources: [{ thing: "thing:floor-1", letters: [LETTER] }, { thing: "thing:floor-2", letters: [LETTER] }], die: HIT });
  if (!opened.ok) blocked(`open refused: ${opened.reason}`);
  own.pot = gm.track(opened.potUuid, "Cards");
  await gm.mark(opened.potUuid, MARKS.pot);
  const pile1 = await run(gm, P.pile, { potUuid: opened.potUuid });
  const lotKeys = opened.lots.map((l) => l.key);
  if (!lotKeys.some((k) => k.startsWith("thing:floor-1/")) || !lotKeys.some((k) => k.startsWith("thing:floor-2/"))) blocked("the deal made no lot for one of the two floors");
  const st1 = await run(gm, P.state, { fid, partyId, placeId });
  check(
    "open answers ok, and the party actor's flag holds the place, the pot's uuid and a lot row per dealt lot",
    opened.ok && st1.flag?.placeUuid === placeUuid && st1.flag?.potUuid === opened.potUuid && st1.flag?.sceneId === sceneId && (st1.flag?.lots ?? []).length === pile1.cards.length && pile1.cards.length > 0
      && (st1.flag?.lots ?? []).every((l) => lotKeys.includes(l.key) && !!l.cardId),
    { lots: (st1.flag?.lots ?? []).length, cards: pile1.cards.length },
  );
  check("the place's own list holds no lot key", st1.things.every((t) => t.lotKeys.length === 0), st1.things.map((t) => t.lotKeys.length));
  check("the pot's flag carries the party's id, and every card is unfound with its lot key", pile1.partyId === fid && pile1.cards.every((c) => c.found === false && !!c.lot), { partyId: pile1.partyId === fid });

  section("Player 1: the projection");
  const asGm = await run(gm, P.readAs, { fid });
  const seenAt = await until(async () => (await run(player, P.readAs, { fid })) ?? null, { tries: 40, every: 250 });
  check("the Judge's read holds every entry, the hidden one included, and the lots the floors hide", !!asGm && asGm.entries.some((e) => e.key === "thing:hidden-1") && asGm.entries.find((e) => e.key === "thing:floor-1")?.lotsHeld > 0 && asGm.sessionKeys.includes("lots") && asGm.sessionKeys.includes("bodies") === false, asGm && { keys: asGm.sessionKeys });
  check(
    "the player's read hides the hidden container, holds no unfound yield and no session lots or bodies, and marks the fixture as holding something more",
    !!seenAt && !seenAt.entries.some((e) => e.key === "thing:hidden-1") && seenAt.entries.every((e) => e.leaks === 0 && e.lotsHeld === 0)
      && !seenAt.sessionKeys.includes("lots") && !seenAt.sessionKeys.includes("bodies") && seenAt.entries.find((e) => e.key === "thing:fixture-1")?.moreRemains === true,
    seenAt && { keys: seenAt.sessionKeys, entries: seenAt.entries.map((e) => [e.key, e.leaks, e.moreRemains]) },
  );

  section("Judge 2: assign");
  const optSkilled = await run(gm, P.options, { fid, actorId: skilledId, key: "thing:floor-1" });
  const optPlain = await run(gm, P.options, { fid, actorId: plainId, key: "thing:floor-2" });
  const optPlainM = await run(gm, P.options, { fid, actorId: plainId, key: "thing:fixture-1" });
  if ([optSkilled.hasty, optPlain.hasty, optPlainM.methodical].some((o) => o?.refusal === "scene:notImported")) blocked("a search throw a layer needs is not imported (scene:notImported)");
  check(
    "the fixtures read as built: the skilled searcher is offered a thrown hasty search with a target, the plain one the vague hasty check, and the plain one the methodical search at the fixture in reach",
    optSkilled.hasty?.mode === "search" && optSkilled.hasty.refusal === null && optSkilled.hasty.hasTarget
      && optPlain.hasty?.mode === "vague" && optPlain.hasty.refusal === null
      && optPlainM.methodical?.mode === "search" && optPlainM.methodical.refusal === null && optPlainM.methodical.hasTarget,
    { skilled: optSkilled.hasty, plain: optPlain.hasty, plainMethodical: optPlainM.methodical },
  );
  const first = await run(gm, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-2" });
  const planA = (await run(gm, P.state, { fid, partyId, placeId })).plan;
  const second = await run(gm, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-1" });
  const aPlain = await run(gm, P.assign, { fid, actorId: plainId, layer: "hasty", entryKey: "thing:floor-2" });
  const stA = await run(gm, P.state, { fid, partyId, placeId });
  const listed = await run(gm, P.assignments, { fid });
  check("an assign replaces the member's one plan entry", first.ok && second.ok && planA?.[skilledId]?.option === "thing:floor-2" && stA.plan?.[skilledId]?.option === "thing:floor-1" && Object.keys(stA.plan ?? {}).filter((k) => k === skilledId).length === 1, { first: first.reason, second: second.reason });
  check(
    "the party's plan holds each entry, key sceneHasty with the entry key as its option, and the api lists both as hasty assignments",
    aPlain.ok && stA.plan?.[skilledId]?.key === "sceneHasty" && stA.plan?.[plainId]?.key === "sceneHasty" && stA.plan[plainId].option === "thing:floor-2"
      && listed.length === 2 && listed.every((a) => a.layer === "hasty" && a.resolved === false),
    { listed: listed.map((a) => [a.layer, a.entryKey, a.resolved]) },
  );
  const farSkilled = await run(gm, P.assign, { fid, actorId: skilledId, layer: "methodical", entryKey: "thing:far-1" });
  const farPlain = await run(gm, P.assign, { fid, actorId: plainId, layer: "methodical", entryKey: "thing:far-1" });
  const stFar = await run(gm, P.state, { fid, partyId, placeId });
  check("assigning either searcher to the thing past the reach is refused outOfReach and changes no entry", farSkilled.reason === "scene:outOfReach" && farPlain.reason === "scene:outOfReach" && stFar.plan?.[skilledId]?.key === "sceneHasty" && stFar.plan?.[plainId]?.key === "sceneHasty", { skilled: farSkilled.reason, plain: farPlain.reason });

  section("Judge 3: the Round press, the die at a 20");
  let since = await run(gm, P.nowMs);
  const round1 = await run(gm, P.roundPress, { fid, die: HIT });
  await sleep(1000);
  const st3 = await run(gm, P.state, { fid, partyId, placeId });
  const pile3 = await run(gm, P.pile, { potUuid: opened.potUuid });
  const cards3 = await claimCards(since, [NAMES.skilled, NAMES.plain]);
  const rows3 = st3.log ?? [];
  const lotsOf = (prefix) => pile3.cards.filter((c) => c.lot?.startsWith(prefix));
  check("the Round press resolves both entries", round1.results.length === 2 && round1.results.every((r) => r.status === "resolved"), { statuses: round1.results.map((r) => r.status) });
  check("the first floor's lot cards read found, and the second floor's stay unfound", lotsOf("thing:floor-1/").length > 0 && lotsOf("thing:floor-1/").every((c) => c.found === true) && lotsOf("thing:floor-2/").every((c) => c.found === false), { floor1: lotsOf("thing:floor-1/").map((c) => c.found), floor2: lotsOf("thing:floor-2/").map((c) => c.found) });
  check("the first floor's thing records the hasty check done and found, by the skilled searcher", layerIn(st3, "floor-1", "hasty").found === true && layerIn(st3, "floor-1", "hasty").done === true && (layerIn(st3, "floor-1", "hasty").by ?? []).includes(skilledId), layerIn(st3, "floor-1", "hasty"));
  check(
    "the log holds a found row for the skilled searcher and a vague row for the plain one, who threw nothing",
    rows3.some((r) => r.actorId === skilledId && r.key === "thing:floor-1" && r.layer === "hasty" && r.code === "scene:found")
      && rows3.some((r) => r.actorId === plainId && r.key === "thing:floor-2" && r.layer === "hasty" && r.code === "scene:vague") && rows3.length === 2,
    rows3.map((r) => [r.key, r.layer, r.code]),
  );
  check(
    "the Judges received one whispered card for the throw, naming the skilled searcher and not the plain one, and the table received none",
    cards3.filter((c) => c.toJudges).length === 1 && cards3.filter((c) => c.toJudges)[0].mentions[0] === true && cards3.filter((c) => c.toJudges)[0].mentions[1] === false && cards3.filter((c) => c.isPublic).length === 0,
    cards3.map((c) => ({ toJudges: c.toJudges, isPublic: c.isPublic, mentions: c.mentions })),
  );
  const listed3 = await run(gm, P.assignments, { fid });
  // The round's resolver stamps each due entry and keeps it; the next turn's count drops it.
  const stampedHasty = (st, id) => st.plan?.[id]?.key === "sceneHasty" && st.plan[id].resolvedTurn != null;
  check("the hasty entries stay in the plan stamped resolved, and the assignments list them resolved", stampedHasty(st3, skilledId) && stampedHasty(st3, plainId) && listed3.length === 2 && listed3.every((a) => a.resolved), { plan: Object.keys(st3.plan ?? {}).length, listed: listed3.length, resolved: listed3.map((a) => a.resolved) });
  const again = await run(gm, P.assign, { fid, actorId: plainId, layer: "hasty", entryKey: "thing:floor-1" });
  const stAgain = await run(gm, P.state, { fid, partyId, placeId });
  check("a second searcher at the floor already found is refused alreadyFound and logs nothing", again.reason === "scene:alreadyFound" && (stAgain.log ?? []).length === rows3.length && stampedHasty(stAgain, plainId), { reason: again.reason, kept: stampedHasty(stAgain, plainId) });
  const methodicalAssign = await run(gm, P.assign, { fid, actorId: plainId, layer: "methodical", entryKey: "thing:fixture-1" });
  const stM = await run(gm, P.state, { fid, partyId, placeId });
  check("the plain searcher is assigned the fixture's methodical check", methodicalAssign.ok && stM.plan?.[plainId]?.key === "sceneMethodical" && stM.plan[plainId].option === "thing:fixture-1", { reason: methodicalAssign.reason });

  section("Judge 4: the lock, the die at a 1");
  const toFail = await run(gm, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-2" });
  since = await run(gm, P.nowMs);
  const round2 = await run(gm, P.roundPress, { fid, die: MISS });
  await sleep(1000);
  const st4 = await run(gm, P.state, { fid, partyId, placeId });
  await claimCards(since);
  const failed = layerIn(st4, "floor-2", "hasty").failed ?? {};
  check("the failed throw is recorded: the floor's hasty state holds the character's id and the level it failed at, and the lot stays unfound", toFail.ok && round2.results.length === 1 && Number(failed[skilledId]) === 2 && layerIn(st4, "floor-2", "hasty").found !== true, { failed: Object.keys(failed).length });
  check("the round press left the plain searcher's methodical entry in the plan, unresolved", st4.plan?.[plainId]?.key === "sceneMethodical" && st4.plan[plainId].resolvedTurn == null && (!st4.plan?.[skilledId] || st4.plan[skilledId].resolvedTurn != null), { plan: Object.keys(st4.plan ?? {}).length, skilledStamped: st4.plan?.[skilledId]?.resolvedTurn ?? null });
  const locked = await run(gm, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-2" });
  const optLocked = await run(gm, P.options, { fid, actorId: skilledId, key: "thing:floor-2" });
  check("assigning the same character to that check again is refused hastyLocked, and the options show it", locked.reason === "scene:hastyLocked" && optLocked.hasty?.refusal === "scene:hastyLocked", { assign: locked.reason, options: optLocked.hasty?.refusal });
  await run(gm, P.setLevel, { actorId: skilledId, level: 3 });
  const optRaised = await run(gm, P.options, { fid, actorId: skilledId, key: "thing:floor-2" });
  const offered = await run(gm, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-2" });
  const taken = await run(gm, P.unassign, { fid, actorId: skilledId });
  const st4b = await run(gm, P.state, { fid, partyId, placeId });
  check("with the level raised the check is offered again, assigned, and taken off the plan", optRaised.hasty?.refusal === null && offered.ok && taken.ok && !st4b.plan?.[skilledId] && st4b.plan?.[plainId]?.key === "sceneMethodical", { options: optRaised.hasty?.refusal, assign: offered.reason });

  section("Judge 5: the Turn press");
  const before5 = st4b.turns;
  since = await run(gm, P.nowMs);
  const turn = await run(gm, P.pressTurn, { partyId, fid, placeId, thingId: "fixture-1", die: HIT, turns: before5 });
  const st5 = await run(gm, P.state, { fid, partyId, placeId });
  await claimCards(since, [NAMES.plain]);
  check("Advance turn is pressed, spends a turn, and the methodical check rolled", turn.pressed && turn.advanced && turn.rolled, turn);
  check("the fixture's methodical check is found, by the plain searcher", layerIn(st5, "fixture-1", "methodical").found === true && (layerIn(st5, "fixture-1", "methodical").by ?? []).includes(plainId), layerIn(st5, "fixture-1", "methodical"));
  check("the hidden container's state is shown", thingIn(st5, "hidden-1")?.state?.shown === true, thingIn(st5, "hidden-1")?.state);
  check("the log gained the methodical row, found", (st5.log ?? []).some((r) => r.actorId === plainId && r.key === "thing:fixture-1" && r.layer === "methodical" && r.code === "scene:found"), (st5.log ?? []).map((r) => [r.key, r.layer, r.code]));
  const entries5 = Object.values(st5.plan ?? {});
  check("no scene entry is left unresolved in the plan (the entry resolved this turn stays, stamped, until the next advance)", entries5.every((e) => e.resolvedTurn != null) && st5.plan?.[plainId]?.resolvedTurn === st5.turns, { entries: entries5.length, stamped: st5.plan?.[plainId]?.resolvedTurn === st5.turns });

  section("Player 2: the relay");
  const gmReadsReveal = await run(gm, P.readAs, { fid });
  const revealed = await until(async () => {
    const r = await run(player, P.readAs, { fid });
    return r?.entries.some((e) => e.key === "thing:hidden-1") ? r : null;
  }, { tries: 40, every: 250 });
  check("once shown, the hidden container is in the player's read, and an unfound layer still yields nothing there", !!gmReadsReveal && !!revealed && revealed.entries.every((e) => e.leaks === 0), revealed && { entries: revealed.entries.length });
  const mine = await run(player, P.assign, { fid, actorId: plainId, layer: "hasty", entryKey: "thing:floor-2" });
  const declared = await until(async () => {
    const s = await run(gm, P.state, { fid, partyId, placeId });
    const e = s.plan?.[plainId];
    return e?.key === "sceneHasty" && e.option === "thing:floor-2" ? e : null;
  }, { tries: 40, every: 250 });
  check("the player's own character is declared through the relay, and the Judge's plan holds it, by the player", mine.ok && !!declared && declared.by === playerId, { ok: mine.ok, reason: mine.reason });
  const other = await run(player, P.assign, { fid, actorId: skilledId, layer: "hasty", entryKey: "thing:floor-2" });
  await sleep(800);
  const stOther = await run(gm, P.state, { fid, partyId, placeId });
  check("a member the player does not own is refused notAllowed on the player's own client and writes nothing", other.ok === false && other.reason === "scene:notAllowed" && !stOther.plan?.[skilledId], { reason: other.reason });

  section("Player 3: open and end");
  const pOpen = await run(player, P.openSession, { fid, placeUuid, sceneId, sources: [] });
  const pEnd = await run(player, P.endSession, { fid });
  const stP3 = await run(gm, P.state, { fid, partyId, placeId });
  check("open and end both answer notAllowed to the player, and the session stands", pOpen.reason === "scene:notAllowed" && pEnd.reason === "scene:notAllowed" && !!stP3.flag, { open: pOpen.reason, end: pEnd.reason });

  section("Judge 7: end");
  const off = await run(gm, P.unassign, { fid, actorId: plainId });
  const ended = await run(gm, P.endSession, { fid });
  const st7 = await run(gm, P.state, { fid, partyId, placeId });
  const pile7 = await run(gm, P.pile, { potUuid: opened.potUuid });
  const readGone = await until(async () => ((await run(player, P.readAs, { fid })) === null ? true : null), { tries: 40, every: 250 });
  check("the Judge takes the declaration off, and the plan is empty", off.ok && Object.keys(st7.plan ?? {}).length === 0, { unassign: off.ok });
  check("end answers ok, unsets the party's flag, leaves the pot standing, and read answers none on both seats", ended.ok && st7.flag === null && !!pile7 && !!readGone && (await run(gm, P.readAs, { fid })) === null, { ended: ended.ok, flag: st7.flag === null, pot: !!pile7 });

  section("Judge 6: drops");
  const viewed = await run(gm, P.view, { sceneId });
  if (!viewed.viewed) blocked("the walk's scene did not come up on the GM seat's canvas");
  const wallC = [cx + 800, cy + 600, cx + 1200, cy + 600];
  const at = { trapA: { x: cx + 150, y: cy - 100 }, hazardA: { x: cx - 150, y: cy + 100 }, trapB: { x: cx + 900, y: cy - 100 }, hazardB: { x: cx + 1100, y: cy + 100 }, wall: { x: cx + 1000, y: cy + 650 } };
  const listA = async () => run(gm, P.thingsOf, { placeId });
  const a0 = await listA();
  const a0ids = a0.map((t) => t.id);
  const newOf = (list, known) => list.filter((t) => !known.includes(t.id));

  await run(gm, P.dropMap, { uuid: dropTrap.uuid, ...at.trapA });
  const a1 = await until(async () => { const l = await listA(); return l.length >= a0.length + 1 ? l : null; });
  const trapThing = newOf(a1 ?? [], a0ids);
  check("a trap dropped on the place's Region adds one thing, a trap by the Item, with the point where it landed", !!a1 && a1.length === a0.length + 1 && trapThing[0]?.kind === "trap" && trapThing[0].ref === dropTrap.uuid && samePoint(trapThing[0].point, at.trapA.x, at.trapA.y), trapThing.map((t) => [t.kind, t.ref === dropTrap.uuid]));

  await run(gm, P.dropMap, { uuid: dropHazard.uuid, ...at.hazardA });
  const a2 = await until(async () => { const l = await listA(); return l.length >= a0.length + 2 ? l : null; });
  const hazardThing = newOf(a2 ?? [], a1?.map((t) => t.id) ?? a0ids);
  check("a hazard dropped on the place's Region adds one thing, an obstacle by the Item, with the point where it landed", !!a2 && a2.length === a0.length + 2 && hazardThing[0]?.kind === "obstacle" && hazardThing[0].ref === dropHazard.uuid && samePoint(hazardThing[0].point, at.hazardA.x, at.hazardA.y), hazardThing.map((t) => [t.kind, t.ref === dropHazard.uuid]));

  await run(gm, P.dropMap, { uuid: dropTrap.uuid, ...at.trapB });
  const bPlace = await until(async () => { const r = await run(gm, P.regionPlace, { regionUuid: regionB.uuid }); return r.uuid ? r : null; }, { tries: 60, every: 200 });
  if (bPlace) {
    await gm.mark(bPlace.uuid, MARKS.dropPlace);
    own.places.push(bPlace.uuid);
  }
  const bList1 = bPlace ? await until(async () => { const l = await run(gm, P.thingsOf, { placeId: bPlace.id }); return l.length >= 1 ? l : null; }) : null;
  const bAfter = bPlace ? await run(gm, P.regionPlace, { regionUuid: regionB.uuid }) : null;
  check("a trap dropped on the bare Region makes it a place, with its sheet closed", !!bPlace && bAfter?.rendered === false, { place: !!bPlace, rendered: bAfter?.rendered });
  check("and the trap thing is on that place with the point where it landed", !!bList1 && bList1.length === 1 && bList1[0].kind === "trap" && bList1[0].ref === dropTrap.uuid && samePoint(bList1[0].point, at.trapB.x, at.trapB.y), bList1 && bList1.map((t) => t.kind));

  if (bPlace) {
    await run(gm, P.dropMap, { uuid: dropHazard.uuid, ...at.hazardB });
    const bList2 = await until(async () => { const l = await run(gm, P.thingsOf, { placeId: bPlace.id }); return l.length >= 2 ? l : null; });
    const bHazard = (bList2 ?? []).find((t) => t.kind === "obstacle");
    check("a hazard dropped there joins that place, not a second one, with its point", !!bList2 && bList2.length === 2 && !!bHazard && bHazard.ref === dropHazard.uuid && samePoint(bHazard.point, at.hazardB.x, at.hazardB.y), bList2 && bList2.map((t) => t.kind));
  } else note("no place was made for the bare Region, so its hazard drop is not reached", null);

  const wall = await run(gm, P.makeWall, { sceneId, c: wallC });
  await gm.mark(wall.uuid, MARKS.dropWall);
  own.wall = wall.uuid;
  const placesBefore = (await listA()).length;
  const bBefore = bPlace ? (await run(gm, P.thingsOf, { placeId: bPlace.id })).length : 0;
  await run(gm, P.dropMap, { uuid: dropTrap.uuid, ...at.wall });
  const assigned = await until(async () => { const w = await run(gm, P.wallTrapOf, { sceneId, wallId: wall.id }); return w.trapUuid ? w : null; }, { tries: 40, every: 250 });
  await sleep(800);
  const placesAfter = (await listA()).length;
  const bAfterWall = bPlace ? (await run(gm, P.thingsOf, { placeId: bPlace.id })).length : 0;
  check("a trap dropped beside a wall is assigned to the wall, and neither place gained a thing", !!assigned && assigned.trapUuid === dropTrap.uuid && placesAfter === placesBefore && bAfterWall === bBefore, { assigned: !!assigned, placeA: [placesBefore, placesAfter], placeB: [bBefore, bAfterWall] });

  const gestures = [];
  for (const [item, want] of [[dropTrap, "trap"], [dropHazard, "obstacle"]]) {
    const had = (await listA()).map((t) => t.id);
    const g = await run(gm, P.dropWindow, { regionUuid: regionA.uuid, uuid: item.uuid });
    gestures.push(g.gesture);
    const grown = await until(async () => { const l = await listA(); return l.length >= had.length + 1 ? l : null; }, { tries: 40, every: 250 });
    const added = newOf(grown ?? [], had);
    check(`the same ${want === "trap" ? "trap" : "hazard"} Item dropped in the Region window's Place row (a drop event on its zone, never the fallback call) adds one ${want} thing with no point`, g.gesture === true && !!grown && added.length === 1 && added[0].kind === want && added[0].ref === item.uuid && added[0].point === null, { gesture: g.gesture, added: added.map((t) => [t.kind, t.point]) });
  }
  note("the Region window's Place row drop was a dispatched drop event on its zone", gestures);
  const finalA = (await listA()).map((t) => t.id);
  check("the drops that landed on the place left its original five things standing", ["floor-1", "floor-2", "fixture-1", "hidden-1", "far-1"].every((id) => finalA.includes(id)), { held: finalA.length });

  section("console");
  for (const [key, api] of Object.entries({ gm, player })) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3).map((e) => e.slice(0, 120)));
  }

  section("teardown");
  const { swept, wanted } = await teardown();
  check("the run's own documents were swept by tracked id (the pot, the place the drop made, the wall, the party's chat cards), and the kept fixtures stand", (swept?.failed ?? []).length === 0 && (swept?.removed ?? []).length === wanted && wanted >= 3, { removed: (swept?.removed ?? []).length, missing: (swept?.missing ?? []).length, failed: (swept?.failed ?? []).length, wanted });
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
