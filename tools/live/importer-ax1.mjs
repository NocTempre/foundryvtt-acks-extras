/**
 * Live walk, importer-ax1: AX1 imported as an adventure. Walks
 * docs/importer/TESTING.md, "A map's traced walls", step 1's sight bullet, on
 * every AX1 map, and a token on the first dungeon level: the map is dark, a
 * player's token sees by the light it carries, and what it has seen stays
 * explored. Machine values arrive through ./_env.mjs, the book through
 * ACKS_TEST_BOOKS ("ax1"). A check prints ids, counts and booleans, never a
 * book's words.
 *
 * Section 2 walks "An adventure's keyed areas land as places": every keyed
 * area and key space is one place inside the place its row names, and a room's
 * stat lines are its hidden roster, linked to the library's creature, the
 * book's own person or creature, or a creature made from the line. Section 2b
 * deletes two rooms and imports again: each comes back, the rooms inside one
 * are moved onto it, and the other links the creatures already made from its
 * lines. The cookbook's own rows (cookbook/ax1.json) say what each room should
 * be; nothing of the page is read here.
 *
 * Section 3 walks "A book lands in the library as one Adventure": the
 * journals step makes no page for a keyed area, and the book's Adventure
 * carries the places, their tree and their rosters beside the maps, whose
 * scenes state the dark map's sight.
 *
 * Fixtures and writes, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the maps the scenes step makes for AX1 (`created.scenes`, tracked) and
 *     the folders it opens (`created.folders`, tracked). The walk stops before
 *     the step when a world scene already carries an AX1 map's id, since that
 *     scene is not this run's. HELD_OK=1 is that import's owner's go-ahead:
 *     the held maps are deleted and the step makes them again. A map made in
 *     place of a held one is the owner's, kept and never swept; any other map
 *     the step makes is tracked, and a folder it opens then is the owner's;
 *   - AX1's people and creatures, imported by id where the library lacks them
 *     (each read back under its id and tracked, with the definitions the
 *     import supplied on demand), so a room has its book's rows to link to;
 *   - the places and creatures the places step makes (`created.places`,
 *     `created.creatures`, tracked), under the same rule as the maps: a place
 *     or creature already under one of AX1's place ids stops the walk, and
 *     under HELD_OK is deleted and made again as the owner's. Two rooms are
 *     deleted mid-walk and made again; the new ones are tracked like the rest;
 *   - AX1's journal, stamped by an earlier release's journals step and left
 *     standing, and AX1's Adventure, written or rebuilt by the Adventure step
 *     (one it writes is tracked, and a shelf it opens is deleted when empty).
 *     The Adventure step rewrites what the library already holds of AX1, so it
 *     runs only when the library holds no AX1 Adventure or under HELD_OK; an
 *     Adventure it rebuilt is rebuilt again after the sweep, so it carries
 *     nothing the sweep removed;
 *   - one character owned by the player seat, made with `api.create`, its
 *     lit torch written to its own light flag as a lone character strikes one;
 *   - that character's token on the first level, made by the GM seat and
 *     removed with its scene;
 *   - the player seat's explored fog on that scene, which core keeps per user
 *     and scene. It is read back by id after the sweep and deleted if it
 *     outlived its scene.
 */
import { readFile } from "node:fs/promises";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "x" + Math.random().toString(36).slice(2, 8);
const BOOK = "ax1";
const BOOKS = books([BOOK]);
const LEVEL = "ax1.level1Map";
const HELD_OK = process.env.HELD_OK === "1";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  The cookbook's rows: what each place should be                      */
/* ------------------------------------------------------------------ */
const COOKBOOK = JSON.parse(await readFile(new URL("../../cookbook/ax1.json", import.meta.url), "utf8"));
const COOK = COOKBOOK.entries;
// Every map the scenes step makes for the book: its scene rows that carry a recipe.
const MAPS = Object.entries(COOKBOOK.scenes ?? {}).filter(([, r]) => r?.scene?.crop).map(([id]) => id);
const BOOK_PLACE = `${BOOK}.adventure`;
const SPACES = new Set(Object.values(COOK).map((e) => e?.meta?.space).filter(Boolean));
const KEYED = Object.entries(COOK).filter(([id, e]) => e.kind === "kind.location" && (e.meta?.space || SPACES.has(id))).map(([id]) => id);
const parentOf = (id) => COOK[id]?.meta?.parent ?? COOK[id]?.meta?.space ?? BOOK_PLACE;
const labelsOf = (id) => new Set(Object.keys(COOK[id]?.fields ?? {}).map((k) => /^occupants\.(\d+)\.name$/.exec(k)?.[1]).filter((i) => i != null)).size;
const PEOPLE = Object.entries(COOK).filter(([, e]) => ["kind.npc", "kind.monsterLegacy"].includes(e.kind)).map(([id]) => id);
const LINE_ID = /^(.+)-o(\d+)$/;

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ax = globalThis.__ax ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    H.SB = await import("/modules/acks-extras/scripts/importer/scene-binding.mjs");
    H.LC = await import("/modules/acks-extras/scripts/location/constants.mjs");
    await H.LIB.whenReady?.();
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      open: !!H.CB.cookbookSessionDoc("ax1"),
      manageVision: (() => { try { return game.settings.get("acks-extras", "manageVision"); } catch { return null; } })(),
      locationType: H.LC.LOCATION_TYPE,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ax;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__axBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__axBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__axBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__axBook, open: !!globalThis.__ax.CB.cookbookSessionDoc(id) }),
  /** World scenes carrying one of the maps' cookbook ids, as uuid and id. */
  heldMaps: async ({ ids }) => game.scenes.filter((s) => ids.includes(s.flags?.["acks-extras"]?.cookbook?.id)).map((s) => ({ uuid: s.uuid, id: s.flags["acks-extras"].cookbook.id })),
  /** The cookbook id each scene carries. */
  sceneIdsOf: async ({ uuids }) => Promise.all(uuids.map(async (u) => ({ uuid: u, id: (await fromUuid(u))?.flags?.["acks-extras"]?.cookbook?.id ?? null }))),
  deleteScenes: async ({ uuids }) => {
    const ids = uuids.map((u) => u.split(".").pop());
    const gone = await Scene.deleteDocuments(ids);
    return gone.map((s) => s.uuid);
  },
  actorPacks: async () => game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world").map((p) => p.collection),
  /** The library's actors under the given cookbook ids, as id, uuid and type. */
  actorsUnder: async ({ ids }) => {
    const MID = "acks-extras";
    const want = new Set(ids);
    const out = [];
    for (const p of game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world")) {
      const idx = await p.getIndex({ fields: ["type", `flags.${MID}.cookbook`] });
      for (const e of idx) {
        const id = e.flags?.[MID]?.cookbook?.id;
        if (want.has(id)) out.push({ id, uuid: `Compendium.${p.collection}.Actor.${e._id}`, type: e.type });
      }
    }
    return out;
  },
  /**
   * What the world and the library hold that the places step claims for a
   * book: an actor under one of its place ids, or a creature made from one of
   * its rooms' lines (`<place id>-o<i>`).
   */
  heldPlaces: async ({ book, ids }) => {
    const MID = "acks-extras";
    const want = new Set(ids);
    const claimed = (c) => !!c?.id && (want.has(c.id) || (c.id.startsWith(`${book}.`) && /-o\d+$/.test(c.id)));
    const out = game.actors.filter((a) => claimed(a.flags?.[MID]?.cookbook)).map((a) => a.uuid);
    for (const p of game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world")) {
      const idx = await p.getIndex({ fields: [`flags.${MID}.cookbook`] });
      for (const e of idx) if (claimed(e.flags?.[MID]?.cookbook)) out.push(`Compendium.${p.collection}.Actor.${e._id}`);
    }
    return out;
  },
  deleteActors: async ({ uuids }) => {
    const groups = new Map();
    for (const u of uuids) {
      const parts = u.split(".");
      const pack = parts[0] === "Compendium" ? `${parts[1]}.${parts[2]}` : null;
      if (!groups.has(pack)) groups.set(pack, []);
      groups.get(pack).push(parts.at(-1));
    }
    const gone = [];
    for (const [pack, ids] of groups) gone.push(...((await Actor.deleteDocuments(ids, pack ? { pack } : {})) ?? []).map((d) => d.uuid));
    globalThis.__ax.CB.forgetImportedIndex();
    return gone;
  },
  /** The cookbook ids of every ability definition the library holds. */
  libraryAbilityIds: async () => globalThis.__ax.LIB.libraryItems().filter((i) => i.type === "ability").map((i) => i.flags?.["acks-extras"]?.cookbook?.id).filter(Boolean),
  /**
   * The definitions an import supplied on demand: each ability a made actor
   * embeds whose cookbook id the library did not hold before, read back under
   * that id.
   */
  onDemand: async ({ uuids, before }) => {
    const H = globalThis.__ax;
    const had = new Set(before);
    const ids = new Set();
    for (const uuid of uuids) {
      const actor = await fromUuid(uuid);
      for (const i of actor?.items ?? []) {
        const id = i.type === "ability" ? i.flags?.["acks-extras"]?.cookbook?.id : null;
        if (id && !had.has(id)) ids.add(id);
      }
    }
    const held = {};
    for (const id of ids) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    return held;
  },
  /** How many of the library's creatures another book printed. */
  otherBooksCreatures: async ({ book }) => {
    const H = globalThis.__ax;
    let n = 0;
    for (const p of game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world")) {
      const idx = await p.getIndex({ fields: ["type", "flags.acks-extras.cookbook"] });
      for (const e of idx) {
        const c = e.flags?.["acks-extras"]?.cookbook;
        if (e.type === "monster" && c?.id && H.CB.bookOfCookbookId(c.id, c.book) !== book) n++;
      }
    }
    return n;
  },
  /**
   * The book's actors in the library: cookbook id, type, parent, and each
   * roster row's link and figures as booleans — no name and no number read
   * off a page rides out.
   */
  placesOf: async ({ book }) => {
    const MID = "acks-extras";
    const H = globalThis.__ax;
    const rows = [];
    for (const p of game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world")) {
      const idx = await p.getIndex({ fields: [`flags.${MID}.cookbook`] });
      const ids = [...idx].filter((e) => { const c = e.flags?.[MID]?.cookbook; return c?.id && H.CB.bookOfCookbookId(c.id, c.book) === book; }).map((e) => e._id);
      if (!ids.length) continue;
      for (const a of await p.getDocuments({ _id__in: ids })) {
        rows.push({
          uuid: a.uuid,
          id: a.flags[MID].cookbook.id,
          type: a.type,
          parentUuid: a.system?.parentUuid ?? null,
          roster: (a.system?.roster ?? []).map((r) => ({
            uuid: r.uuid,
            quantity: r.quantity,
            hidden: !!r.hidden,
            notes: !!String(r.notes ?? "").trim(),
            hpNote: /\bhp\b/.test(String(r.notes ?? "")),
          })),
        });
      }
    }
    return rows;
  },
  /** Each roster target: its type, cookbook id and book, and whether it is a world copy. */
  targets: async ({ uuids }) => {
    const H = globalThis.__ax;
    const out = {};
    for (const u of uuids) {
      const d = await fromUuid(u).catch(() => null);
      const c = d?.flags?.["acks-extras"]?.cookbook;
      out[u] = d ? { type: d.type, id: c?.id ?? null, book: c?.id ? H.CB.bookOfCookbookId(c.id, c.book) : null, copy: H.SB.isWorldCopy(d) } : null;
    }
    return out;
  },
  /** What the library holds of the book: its journals and its Adventure, by uuid and stamp. */
  library: async ({ book }) => {
    const MID = "acks-extras";
    const AB = await import("/modules/acks-extras/scripts/importer/adventure-binding.mjs");
    const out = { journals: [], adventures: [], packs: game.packs.filter((p) => p.metadata.packageType === "world").map((p) => p.collection) };
    for (const p of game.packs.filter((p) => p.metadata.packageType === "world" && ["JournalEntry", "Adventure"].includes(p.documentName))) {
      const idx = await p.getIndex({ fields: [`flags.${MID}.cookbook`] });
      for (const e of idx) {
        const c = e.flags?.[MID]?.cookbook;
        if (!c || c.book !== book) continue;
        const uuid = `Compendium.${p.collection}.${p.documentName}.${e._id}`;
        if (p.documentName === "JournalEntry") out.journals.push({ uuid, id: c.id ?? null, group: c.group != null, expected: c.group != null ? AB.journalCookbookId(book, c.group) : null });
        else out.adventures.push({ uuid, kind: c.kind, contents: c.contents ?? null });
      }
    }
    return out;
  },
  /** The sight fields of every scene a stored Adventure carries. */
  adventureScenes: async ({ uuid }) => {
    const a = await fromUuid(uuid);
    return a ? [...a.scenes].map((s) => ({ walls: s.walls.length ?? s.walls.size, tokenVision: s.tokenVision, fogMode: s.fog?.mode, darkness: s.environment?.darknessLevel, globalLight: !!s.environment?.globalLight?.enabled })) : null;
  },
  /** The actors a stored Adventure carries: id, cookbook id, type, parent and roster links. */
  adventureActors: async ({ uuid }) => {
    const a = await fromUuid(uuid);
    if (!a) return null;
    return [...a.actors].map((x) => ({
      _id: x._id,
      id: x.flags?.["acks-extras"]?.cookbook?.id ?? null,
      type: x.type,
      parentUuid: x.system?.parentUuid ?? null,
      roster: (x.system?.roster ?? []).map((r) => r.uuid),
    }));
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
  },
  fire: async ({ step, args }) => {
    globalThis.__axStep = { done: false };
    acksExtras.importer[step](...args)
      .then((v) => { globalThis.__axStep = { done: true, value: v ?? null }; })
      .catch((e) => { globalThis.__axStep = { done: true, error: String(e?.message ?? e) }; });
    return { fired: step };
  },
  stepState: async () => {
    const s = globalThis.__axStep;
    if (!s?.done) return { done: false };
    if (s.error) return { done: true, error: s.error };
    const v = s.value && typeof s.value === "object" ? s.value : {};
    // The step's counts and the uuids it made; no name rides out.
    const counts = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number"));
    return { done: true, ...counts, books: v.books ?? null, created: v.created ?? null };
  },
  /** The sight fields a map's scene states, by cookbook id. */
  sightOf: async ({ id }) => {
    const s = game.scenes.find((x) => x.flags?.["acks-extras"]?.cookbook?.id === id);
    if (!s) return null;
    return {
      uuid: s.uuid,
      walls: s.walls.size,
      tokenVision: s.tokenVision,
      fogMode: s.fog?.mode ?? null,
      darkness: s.environment?.darknessLevel ?? null,
      globalLight: !!s.environment?.globalLight?.enabled,
    };
  },
  playerId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /**
   * A floor point beside each plain door of a scene: half a grid cell off the
   * door's middle along its normal, on both sides. A door joins two floor
   * cells, so both points stand on floor.
   */
  doorFloors: async ({ uuid }) => {
    const s = await fromUuid(uuid);
    const half = s.grid.size / 2;
    const out = [];
    for (const w of s.walls) {
      if (w.door !== 1) continue;
      const [x0, y0, x1, y1] = w.c;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < s.grid.size * 0.5) continue;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      out.push({ x: Math.round(mx + nx * half), y: Math.round(my + ny * half) });
      out.push({ x: Math.round(mx - nx * half), y: Math.round(my - ny * half) });
    }
    return { grid: s.grid.size, points: out.slice(0, 40) };
  },
  /** One token of the actor centred on a point, made on the GM seat. */
  placeToken: async ({ sceneUuid, actorUuid, x, y }) => {
    const s = await fromUuid(sceneUuid);
    const a = await fromUuid(actorUuid);
    const data = (await a.getTokenDocument({ x: x - s.grid.size / 2, y: y - s.grid.size / 2 })).toObject();
    const [t] = await s.createEmbeddedDocuments("Token", [data]);
    return t ? { id: t.id, sight: !!t.sight.enabled } : null;
  },
  /** What the token's light and sight read, as the GM sees the document. */
  tokenLight: async ({ sceneUuid, tokenId }) => {
    const t = (await fromUuid(sceneUuid))?.tokens.get(tokenId);
    return t ? { bright: t.light.bright, dim: t.light.dim, sight: !!t.sight.enabled, range: t.sight.range } : null;
  },
  setLit: async ({ actorUuid, lit }) => {
    const a = await fromUuid(actorUuid);
    const lights = a.getFlag("acks-extras", "lights") ?? [];
    if (!lights.length) {
      await a.setFlag("acks-extras", "lights", [{ id: foundry.utils.randomID(), type: "torch", bearerId: a.id, remaining: 6, lit }]);
    } else {
      await a.setFlag("acks-extras", "lights", lights.map((l) => ({ ...l, lit })));
    }
    return { lit, by: game.user.name === undefined ? null : game.user.isGM ? "gm" : "player" };
  },
  view: async ({ uuid }) => {
    const s = await fromUuid(uuid);
    await s.view();
    for (let n = 0; n < 120 && !(canvas.ready && canvas.scene?.id === s.id); n++) await new Promise((r) => setTimeout(r, 250));
    return { ready: canvas.ready, viewed: canvas.scene?.id === s.id, isGM: game.user.isGM };
  },
  /**
   * The player's own reading of the canvas around its token: the token's
   * centre a cell's half-width away, a point in its line of sight past the
   * light's reach, and whether each is visible now and explored.
   */
  seen: async ({ tokenId, far = null }) => {
    for (let n = 0; n < 40; n++) {
      const t = canvas.tokens.get(tokenId);
      if (t?.vision?.los) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    canvas.perception.update({ refreshVision: true, refreshLighting: true });
    await new Promise((r) => setTimeout(r, 1200));
    const t = canvas.tokens.get(tokenId);
    if (!t) return { token: false };
    const c = t.center;
    const cell = canvas.grid.size;
    const near = { x: c.x + cell * 0.6, y: c.y };
    const nearB = { x: c.x - cell * 0.6, y: c.y };
    const pts = t.vision?.los?.points ?? [];
    let pick = far;
    if (!pick) {
      let best = null;
      for (let i = 0; i < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - c.x, pts[i + 1] - c.y);
        if (!best || d > best.d) best = { x: pts[i], y: pts[i + 1], d };
      }
      if (best) pick = { x: Math.round(c.x + (best.x - c.x) * 0.9), y: Math.round(c.y + (best.y - c.y) * 0.9) };
    }
    const reach = t.document.light.dim * canvas.dimensions.distancePixels;
    const farDist = pick ? Math.hypot(pick.x - c.x, pick.y - c.y) : 0;
    const vis = (p) => canvas.visibility.testVisibility(p, { tolerance: 0 });
    const nearVisible = vis(near) || vis(nearB);
    const nearExplored = canvas.fog.isPointExplored(near) || canvas.fog.isPointExplored(nearB);
    return {
      token: true,
      hasVision: !!t.vision?.active || !!t.vision,
      reachPx: Math.round(reach),
      far: pick,
      farPx: Math.round(farDist),
      farBeyondReach: farDist > reach + cell,
      nearVisible,
      nearExplored,
      farVisible: pick ? vis(pick) : null,
    };
  },
  /** Explored-fog documents of a user on a scene id, by id. */
  fogOf: async ({ sceneId, userId }) => game.collections.get("FogExploration")?.filter((f) => f.scene === sceneId && f.user === userId).map((f) => f.id) ?? [],
  deleteFog: async ({ ids }) => {
    const FE = foundry.utils.getDocumentClass("FogExploration");
    const gone = await FE.deleteDocuments(ids).catch((e) => String(e?.message ?? e));
    return Array.isArray(gone) ? gone.map((d) => d.id) : gone;
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportIds`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function poll(api, fn, args, { tries = 300, every = 2000, until = (s) => s?.done } = {}) {
  let state = null;
  for (let n = 0; n < tries; n++) {
    state = await run(api, fn, args);
    if (until(state)) return state;
    await sleep(every);
  }
  return state;
}
async function step(api, name, args, tries = 450) {
  await run(api, P.fire, { step: name, args });
  const st = await poll(api, P.stepState, undefined, { tries });
  if (st?.error) throw new Error(`${name} threw: ${st.error}`);
  if (!st?.done) throw new Error(`${name} did not finish`);
  return st;
}
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}
/** Ids whose rows fail a test, the first few. */
const failing = (ids, ok) => {
  const bad = ids.filter((id) => !ok(id));
  return { failing: bad.length, first: bad.slice(0, 8) };
};

let gm = null;
let fogLeft = { sceneId: null, userId: null, packs: [] };
let ownersAdventure = false;

try {
  section("seats and the book");
  gm = await seat("gm");
  let census = await run(gm, P.install);
  if (!census.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    note("book", await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open }));
    census = await run(gm, P.install);
  }
  note("gm", census);
  check("the GM seat is a GM, the book is open, and the module manages token sight", census.isGM && census.open && census.manageVision === true, census);
  if (!census.isGM || !census.open) throw new Error("preconditions not met");
  const LOCATION = census.locationType;

  section("1. a walled map is dark, and a token sees by its own light");
  const held = await run(gm, P.heldMaps, { ids: MAPS });
  const rebuild = held.length > 0 && HELD_OK;
  check(rebuild ? "the owner's AX1 maps are deleted to be made again (HELD_OK=1)" : "no world scene carries an AX1 map's id", !held.length || rebuild, held);
  if (held.length && !rebuild) throw new Error("stopped before the maps step: a scene this run did not make carries a map's id");
  if (rebuild) note("1: deleted (the owner's, by HELD_OK)", await run(gm, P.deleteScenes, { uuids: held.map((h) => h.uuid) }));
  const st = await step(gm, "cookbookImportScenes", [{ books: [BOOK] }]);
  // A map made again in place of one the owner held is the owner's; any other
  // the step made is this run's, and so is a folder it opened with none held.
  const ownersIds = new Set(held.map((h) => h.id));
  const made = await run(gm, P.sceneIdsOf, { uuids: st?.created?.scenes ?? [] });
  for (const m of made) if (!rebuild || !ownersIds.has(m.id)) gm.track(m.uuid, "Scene");
  if (!rebuild) for (const uuid of st?.created?.folders ?? []) gm.track(uuid, "Folder");
  note("1: maps made", { owners: made.filter((m) => rebuild && ownersIds.has(m.id)).map((m) => m.uuid), tracked: made.filter((m) => !rebuild || !ownersIds.has(m.id)).map((m) => m.uuid), folders: st?.created?.folders ?? [], foldersTracked: !rebuild });
  note("maps step", { made: st?.made, walls: st?.walls, wallsFailed: st?.wallsFailed, scenes: st?.created?.scenes?.length ?? 0 });
  const sights = [];
  for (const id of MAPS) sights.push({ id, ...(await run(gm, P.sightOf, { id })) });
  note("1: sight fields", sights);
  check("1: every AX1 map is made and walled", sights.every((s) => s.uuid && s.walls > 0), sights.map((s) => ({ id: s.id, walls: s.walls })));
  check("1: each states token vision, each user's own fog, darkness 1 and no global light",
    sights.every((s) => s.tokenVision === true && s.fogMode === 1 && s.darkness === 1 && s.globalLight === false));

  const level = sights.find((s) => s.id === LEVEL);
  if (!level?.uuid) throw new Error("the first level's map was not made");
  const playerId = await run(gm, P.playerId, { name: SEATS.player });
  if (!playerId) throw new Error("the player seat's user is not in the world");
  const pc = await gm.create("Actor", { name: `QA lamplighter ${NONCE}`, type: "character", ownership: { default: 0, [playerId]: 3 } });
  note("fixture", { actor: pc.uuid });
  const floors = await run(gm, P.doorFloors, { uuid: level.uuid });
  if (!floors.points.length) throw new Error("the level has no plain door to stand a token beside");

  const player = await seat("player");
  note("player view", await run(player, P.view, { uuid: level.uuid }));
  fogLeft = { sceneId: level.uuid.split(".").pop(), userId: playerId, packs: [] };

  // A token beside the first door whose line of sight runs past the torch's reach.
  let token = null;
  let lit = null;
  for (const p of floors.points) {
    const placed = await run(gm, P.placeToken, { sceneUuid: level.uuid, actorUuid: pc.uuid, ...p });
    if (!placed) continue;
    if (!lit) note("1: torch", await run(player, P.setLit, { actorUuid: pc.uuid, lit: true }));
    await sleep(1500);
    const reading = await run(player, P.seen, { tokenId: placed.id });
    if (reading.token && reading.farBeyondReach) {
      token = placed;
      lit = reading;
      break;
    }
    await gm.eval(`(async () => { await (await fromUuid(${JSON.stringify(level.uuid)})).tokens.get(${JSON.stringify(placed.id)})?.delete(); })()`);
    lit = lit ?? reading;
  }
  if (!token) throw new Error("no door gave a line of sight longer than the torch's reach");
  note("1: token", { sight: token.sight, light: await run(gm, P.tokenLight, { sceneUuid: level.uuid, tokenId: token.id }) });
  note("1: lit reading", lit);
  check("1: the player's token carries its torch's light", (await run(gm, P.tokenLight, { sceneUuid: level.uuid, tokenId: token.id }))?.dim > 0);
  check("1: from the Player seat, the square beside the lit token is visible", lit.nearVisible === true);
  check("1: a square in the token's line of sight past the torch's reach is dark", lit.farVisible === false, { farPx: lit.farPx, reachPx: lit.reachPx });

  note("1: torch", await run(player, P.setLit, { actorUuid: pc.uuid, lit: false }));
  await sleep(1500);
  const dark = await run(player, P.seen, { tokenId: token.id, far: lit.far });
  note("1: doused reading", dark);
  check("1: with the torch doused the token's light is gone", (await run(gm, P.tokenLight, { sceneUuid: level.uuid, tokenId: token.id }))?.dim === 0);
  check("1: with no light and no dark sense, the square beside it is not visible", dark.nearVisible === false);
  check("1: the square it saw while lit stays explored", dark.nearExplored === true);

  section("2. AX1's keyed areas are places, each inside the one it sits in");
  const packsBefore = await run(gm, P.actorPacks);
  // The people a room's line can name, imported first, as Import Everything does.
  const peopleBefore = await run(gm, P.actorsUnder, { ids: PEOPLE });
  const missing = PEOPLE.filter((id) => !peopleBefore.some((r) => r.id === id));
  note("2: AX1's people and creatures the library holds", { rows: PEOPLE.length, held: peopleBefore.length, importing: missing.length });
  if (missing.length) {
    const abilitiesBefore = await run(gm, P.libraryAbilityIds);
    await step(gm, "cookbookImportIds", [missing]);
    const made = (await run(gm, P.actorsUnder, { ids: missing }));
    for (const m of made) gm.track(m.uuid, "Actor");
    const supplied = await run(gm, P.onDemand, { uuids: made.map((m) => m.uuid), before: abilitiesBefore });
    for (const uuid of Object.values(supplied)) if (uuid) gm.track(uuid, "Item");
    note("2: imported (tracked)", { made: made.map((m) => m.uuid), suppliedOnDemand: Object.values(supplied).filter(Boolean).length });
  }
  const people = await run(gm, P.actorsUnder, { ids: PEOPLE });
  check("2: the library holds every AX1 person and creature once, for a room to link to",
    PEOPLE.every((id) => people.filter((r) => r.id === id).length === 1), { rows: PEOPLE.length, held: people.length });
  const otherCreatures = await run(gm, P.otherBooksCreatures, { book: BOOK });
  note("2: creatures another book printed, in the library", otherCreatures);

  const heldPlaces = await run(gm, P.heldPlaces, { book: BOOK, ids: [...KEYED, BOOK_PLACE] });
  const rebuildPlaces = heldPlaces.length > 0 && HELD_OK;
  check(rebuildPlaces ? "the owner's AX1 places are deleted to be made again (HELD_OK=1)" : "nothing stands under any AX1 place id",
    !heldPlaces.length || rebuildPlaces, { held: heldPlaces.length });
  if (heldPlaces.length && !rebuildPlaces) throw new Error("stopped before the places step: an actor this run did not make stands under an AX1 place id");
  if (rebuildPlaces) note("2: deleted (the owner's, by HELD_OK)", (await run(gm, P.deleteActors, { uuids: heldPlaces })).length);
  const ps = await step(gm, "cookbookImportPoiPlaces", [{ books: [BOOK] }], 900);
  const keep = (uuids, kind) => { if (!rebuildPlaces) for (const uuid of uuids ?? []) gm.track(uuid, kind); };
  keep(ps.created?.places, "Actor");
  keep(ps.created?.creatures, "Actor");
  note("2: places step", { made: ps.made, already: ps.already, refused: ps.refused, rostered: ps.rostered, creatures: ps.creatures, places: ps.created?.places?.length ?? 0, madeCreatures: ps.created?.creatures?.length ?? 0, tracked: !rebuildPlaces });
  for (const c of (await run(gm, P.actorPacks)).filter((c) => !packsBefore.includes(c))) fogLeft.packs.push(c);

  const lib = await run(gm, P.placesOf, { book: BOOK });
  const under = (id) => lib.filter((r) => r.id === id);
  const one = (id) => (under(id).length === 1 ? under(id)[0] : null);
  const bookPlace = one(BOOK_PLACE);
  check("2: the step made every keyed area and key space, and the book's own place, and refused none",
    ps.made === KEYED.length && (ps.created?.places?.length ?? 0) === KEYED.length + 1 && !ps.refused,
    { made: ps.made, listed: ps.created?.places?.length ?? 0, rows: KEYED.length, refused: ps.refused });
  check("2: the book's own place stands once, a place", bookPlace?.type === LOCATION);
  check("2: every keyed area and key space is one place in the library", KEYED.every((id) => one(id)?.type === LOCATION), failing(KEYED, (id) => one(id)?.type === LOCATION));
  check("2: every place sits inside the place its row names, a key space inside the book's",
    KEYED.every((id) => one(id) && one(id).parentUuid === one(parentOf(id))?.uuid), failing(KEYED, (id) => one(id) && one(id).parentUuid === one(parentOf(id))?.uuid));

  const printing = KEYED.filter((id) => labelsOf(id) > 0);
  const rows = KEYED.flatMap((id) => (one(id)?.roster ?? []).map((r) => ({ ...r, room: id })));
  note("2: occupants", { roomsPrinting: printing.length, labels: printing.reduce((n, id) => n + labelsOf(id), 0), rows: rows.length });
  check("2: every room whose text prints an occupant has a roster, and no other room has one",
    KEYED.every((id) => (labelsOf(id) > 0) === ((one(id)?.roster?.length ?? 0) > 0)), failing(KEYED, (id) => (labelsOf(id) > 0) === ((one(id)?.roster?.length ?? 0) > 0)));
  check("2: a room's roster holds no more rows than its text prints occupants", KEYED.every((id) => (one(id)?.roster?.length ?? 0) <= labelsOf(id)),
    failing(KEYED, (id) => (one(id)?.roster?.length ?? 0) <= labelsOf(id)));
  check("2: the step's count of rostered occupants is the rows the rooms hold", ps.rostered === rows.length, { rostered: ps.rostered, rows: rows.length });
  check("2: every occupant row is hidden from the players", rows.length > 0 && rows.every((r) => r.hidden));

  const targets = await run(gm, P.targets, { uuids: [...new Set(rows.map((r) => r.uuid))] });
  const kindOf = (r) => {
    const t = targets[r.uuid];
    if (!t) return "dangling";
    if (t.book !== BOOK) return t.type === "monster" ? "core" : "other";
    if (t.type === "character") return "person";
    const m = LINE_ID.exec(t.id ?? "");
    return m && m[1] === r.room ? "line" : "own";
  };
  const by = {};
  for (const r of rows) (by[kindOf(r)] ??= []).push(r);
  note("2: what the rows link to", Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])));
  check("2: every row links to an actor that exists, and none to a world copy", rows.every((r) => targets[r.uuid] && !targets[r.uuid].copy),
    { dangling: by.dangling?.length ?? 0, copies: rows.filter((r) => targets[r.uuid]?.copy).length });
  check("2: an occupant another book prints links to that book's creature", (by.core?.length ?? 0) > 0,
    otherCreatures ? { core: by.core?.length ?? 0 } : "the library holds no creature of another book");
  check("2: an occupant the book's own rows print links to the actor that row was imported as", (by.own?.length ?? 0) > 0, { own: by.own?.length ?? 0 });
  // AX1's rooms print no person's stat line: its people are mentioned in the
  // prose, which makes no row. The path is checked where a room reaches it.
  if (by.person?.length) {
    check("2: a person of the book stands once, linked as its character, with no notes",
      by.person.every((r) => r.quantity === 1 && !r.notes), { person: by.person.length });
  } else note("2: not reached", "no room's stat line names a person of the book, so no row links a character");
  const lineMade = lib.filter((r) => LINE_ID.test(r.id));
  check("2: an occupant nothing else answers is a creature made from its room's own line, linked from that room",
    (by.line?.length ?? 0) > 0 && lineMade.every((c) => c.type === "monster" && (one(LINE_ID.exec(c.id)[1])?.roster ?? []).some((r) => r.uuid === c.uuid)),
    { lineRows: by.line?.length ?? 0, creatures: lineMade.length });
  check("2: the creatures the step counts are the ones it made, one per line", ps.creatures === lineMade.length && (ps.created?.creatures?.length ?? 0) === lineMade.length,
    { counted: ps.creatures, listed: ps.created?.creatures?.length ?? 0, held: lineMade.length });
  const beasts = rows.filter((r) => kindOf(r) !== "person");
  check("2: an occupant row's count is a whole number, and its hit points ride its notes where the line prints them",
    beasts.every((r) => Number.isInteger(r.quantity) && r.quantity > 0) && beasts.some((r) => r.hpNote),
    { rows: beasts.length, withHp: beasts.filter((r) => r.hpNote).length });

  section("2b. rooms deleted and imported again");
  // A room that holds others, and a room that links a creature made from its own line.
  const linesOf = (id) => (one(id)?.roster ?? []).filter((r) => kindOf({ ...r, room: id }) === "line").map((r) => r.uuid).sort();
  const holder = KEYED.find((id) => !SPACES.has(id) && KEYED.some((k) => parentOf(k) === id));
  const liner = KEYED.find((id) => !SPACES.has(id) && id !== holder && linesOf(id).length > 0);
  const picks = [holder, liner].filter(Boolean);
  const was = Object.fromEntries(picks.map((id) => [id, { ...one(id), lines: linesOf(id) }]));
  const inside = KEYED.filter((k) => parentOf(k) === holder);
  note("2b: the rooms", picks.map((id) => ({ id, uuid: was[id].uuid, inside: id === holder ? inside.length : 0, lineRows: was[id].lines.length })));
  note("2b: deleted", await run(gm, P.deleteActors, { uuids: picks.map((id) => was[id].uuid) }));
  const again = await step(gm, "cookbookImportPoiPlaces", [{ books: [BOOK] }], 900);
  keep(again.created?.places, "Actor");
  keep(again.created?.creatures, "Actor");
  note("2b: places step again", { made: again.made, already: again.already, refused: again.refused, creatures: again.creatures, places: again.created?.places ?? [] });
  const lib2 = await run(gm, P.placesOf, { book: BOOK });
  const now = (id) => lib2.filter((r) => r.id === id);
  const placeIn = (id) => lib2.find((r) => r.id === parentOf(id))?.uuid;
  check("2b: a second run makes the deleted rooms alone, and finds every other place", picks.length === 2 && again.made === 2 && again.already === KEYED.length - 2 && !again.creatures,
    { picks: picks.length, made: again.made, already: again.already, creatures: again.creatures });
  check("2b: each room stands again once, under its id, a new document, in the place its row names",
    picks.every((id) => now(id).length === 1 && now(id)[0].uuid !== was[id].uuid && now(id)[0].parentUuid === placeIn(id)));
  check("2b: the rooms inside the one made again are moved onto it", inside.length > 0 && inside.every((k) => lib2.find((r) => r.id === k)?.parentUuid === now(holder)[0]?.uuid),
    { inside: inside.length, moved: inside.filter((k) => lib2.find((r) => r.id === k)?.parentUuid === now(holder)[0]?.uuid).length });
  check("2b: a room made again links the creatures already made from its lines, none made twice",
    !!liner && JSON.stringify((now(liner)[0]?.roster ?? []).map((r) => r.uuid).filter((u) => was[liner].lines.includes(u)).sort()) === JSON.stringify(was[liner].lines)
      && lib2.filter((r) => LINE_ID.test(r.id)).length === lineMade.length,
    { lineRows: liner ? was[liner].lines.length : 0, creatures: lib2.filter((r) => LINE_ID.test(r.id)).length });

  section("3. AX1's Adventure carries its places beside its maps");
  const before = await run(gm, P.library, { book: BOOK });
  const ownedAdventure = before.adventures.length > 0;
  check(ownedAdventure && HELD_OK ? "the library's AX1 Adventure is rewritten (HELD_OK=1)" : "the library holds no AX1 Adventure",
    !ownedAdventure || HELD_OK, { journals: before.journals.length, adventures: before.adventures.length });
  if (ownedAdventure && !HELD_OK) throw new Error("stopped before the Adventure step: the library's AX1 Adventure is not this run's");
  const js = await step(gm, "cookbookImportJournals", [{ books: [BOOK] }], 600);
  for (const uuid of js?.created?.journals ?? []) gm.track(uuid, "JournalEntry");
  const mid = await run(gm, P.library, { book: BOOK });
  note("3: journals step", { made: js?.made ?? 0, updated: js?.updated ?? 0, journals: js?.created?.journals?.length ?? 0 });
  check("3: the journals step writes no page for a keyed area, and the journals the library held stay",
    !(js?.made > 0) && !(js?.updated > 0) && !(js?.created?.journals?.length) && mid.journals.length === before.journals.length,
    { made: js?.made ?? 0, updated: js?.updated ?? 0, held: before.journals.length, now: mid.journals.length });
  const as = await step(gm, "cookbookImportAdventures", [{ books: [BOOK] }]);
  for (const uuid of as?.created?.adventures ?? []) gm.track(uuid, "Adventure");
  fogLeft.packs.push(...(as?.created?.packs ?? []).filter((c) => !before.packs.includes(c)));
  ownersAdventure = as?.books?.[BOOK] === "rebuilt";
  note("3: Adventure step", { outcome: as?.books?.[BOOK] ?? null, written: as?.written, rebuilt: as?.rebuilt, kept: as?.kept, held: as?.held, failed: as?.failed });
  check("3: the step wrote or rebuilt AX1's Adventure", ["written", "rebuilt"].includes(as?.books?.[BOOK]), as?.books);
  const after = await run(gm, P.library, { book: BOOK });
  const adv = after.adventures.find((a) => a.kind === "kind.bookAdventure");
  note("3: Adventure contents", adv?.contents ?? null);
  const places = lib2.filter((r) => r.type === LOCATION);
  check("3: the Adventure carries every AX1 place, and its journals and maps",
    adv?.contents?.places === places.length && adv?.contents?.journals === after.journals.length && adv?.contents?.scenes === MAPS.length,
    { places: adv?.contents?.places, held: places.length, journals: adv?.contents?.journals, heldJournals: after.journals.length, scenes: adv?.contents?.scenes });
  const carriedActors = adv ? await run(gm, P.adventureActors, { uuid: adv.uuid }) : [];
  const carriedById = new Map(carriedActors.filter((a) => a.id).map((a) => [a.id, a]));
  const inWorld = (id) => (carriedById.has(id) ? `Actor.${carriedById.get(id)._id}` : null);
  check("3: each carried place sits in the carried place its row names, in world form",
    KEYED.every((id) => carriedById.get(id)?.parentUuid === inWorld(parentOf(id))) && carriedById.get(BOOK_PLACE)?.parentUuid === "",
    failing(KEYED, (id) => carriedById.get(id)?.parentUuid === inWorld(parentOf(id))));
  const carriedRows = KEYED.flatMap((id) => (carriedById.get(id)?.roster ?? []).map((u) => ({ u, room: id })));
  const carriedIds = new Set(carriedActors.map((a) => `Actor.${a._id}`));
  check("3: a carried row names a carried person or creature in world form, and another book's creature where the library holds it",
    carriedRows.length === rows.length && carriedRows.every(({ u }) => carriedIds.has(u) || String(u).startsWith("Compendium.")),
    { rows: carriedRows.length, carried: carriedRows.filter(({ u }) => carriedIds.has(u)).length, library: carriedRows.filter(({ u }) => String(u).startsWith("Compendium.")).length });
  const carried = adv ? await run(gm, P.adventureScenes, { uuid: adv.uuid }) : null;
  check("3: each map the Adventure carries is dark, as the world's are",
    !!carried?.length && carried.every((s) => s.tokenVision === true && s.fogMode === 1 && s.darkness === 1 && s.globalLight === false), carried);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  let swept = 0;
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) {
      swept = sw.removed.length;
      note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try {
    // The owner's Adventure, rebuilt above over what the sweep has removed, is
    // rebuilt again so it carries only what the library still holds.
    if (gm && ownersAdventure && swept) {
      const re = await step(gm, "cookbookImportAdventures", [{ books: [BOOK] }]);
      note("the owner's Adventure, rebuilt over the swept library", { outcome: re?.books?.[BOOK] ?? null, contents: (await run(gm, P.library, { book: BOOK })).adventures.find((a) => a.kind === "kind.bookAdventure")?.contents ?? null });
    }
  } catch (err) { console.error("adventure rebuild:", err?.message ?? err); }
  try {
    if (gm && fogLeft.sceneId) {
      const left = await run(gm, P.fogOf, { sceneId: fogLeft.sceneId, userId: fogLeft.userId });
      note("the player's explored fog this run made", left.length ? await run(gm, P.deleteFog, { ids: left }) : []);
    }
  } catch (err) { console.error("fog:", err?.message ?? err); }
  for (const collection of fogLeft.packs ?? []) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
