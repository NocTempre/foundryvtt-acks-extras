/**
 * Live walk, importer-ax1: AX1 imported as an adventure. Walks
 * docs/importer/TESTING.md, "A map's traced walls", step 1's sight bullet, on
 * AX1's two dungeon levels: the map is dark, a player's token sees by the
 * light it carries, and what it has seen stays explored. Machine values arrive
 * through ./_env.mjs, the book through ACKS_TEST_BOOKS ("ax1"). A check prints
 * ids, counts and booleans, never a book's words.
 *
 * Section 2 walks "A book lands in the library as one Adventure" for a
 * journal: the journals step stamps AX1's journal with its cookbook id, and
 * the book's Adventure carries it beside the maps, whose scenes state the
 * dark map's sight.
 *
 * Fixtures and writes, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the maps the scenes step makes for AX1 (`created.scenes`, tracked) and
 *     the folders it opens (`created.folders`, tracked). The walk stops before
 *     the step when a world scene already carries either map's id, since that
 *     scene is not this run's. HELD_OK=1 is that import's owner's go-ahead:
 *     the held maps are deleted and the step makes them again, and the
 *     rebuilt maps are the owner's, kept and never swept;
 *   - AX1's journal, stamped or made by the journals step (one it makes is
 *     tracked), and AX1's Adventure, written or rebuilt by the Adventure step
 *     (one it writes is tracked, and a shelf it opens is deleted when empty).
 *     Either step rewrites what the library already holds of AX1, so both run
 *     only when the library holds none of it or under HELD_OK;
 *   - one character owned by the player seat, made with `api.create`, its
 *     lit torch written to its own light flag as a lone character strikes one;
 *   - that character's token on the first level, made by the GM seat and
 *     removed with its scene;
 *   - the player seat's explored fog on that scene, which core keeps per user
 *     and scene. It is read back by id after the sweep and deleted if it
 *     outlived its scene.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "x" + Math.random().toString(36).slice(2, 8);
const BOOK = "ax1";
const BOOKS = books([BOOK]);
const MAPS = ["ax1.level1Map", "ax1.level2Map"];
const HELD_OK = process.env.HELD_OK === "1";

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
  install: async () => {
    const H = (globalThis.__ax = globalThis.__ax ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.LIB.whenReady?.();
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      open: !!H.CB.cookbookSessionDoc("ax1"),
      manageVision: (() => { try { return game.settings.get("acks-extras", "manageVision"); } catch { return null; } })(),
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
  /** World scenes carrying one of the maps' cookbook ids. */
  heldMaps: async ({ ids }) => game.scenes.filter((s) => ids.includes(s.flags?.["acks-extras"]?.cookbook?.id)).map((s) => s.uuid),
  deleteScenes: async ({ uuids }) => {
    const ids = uuids.map((u) => u.split(".").pop());
    const gone = await Scene.deleteDocuments(ids);
    return gone.map((s) => s.uuid);
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
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
let fogLeft = { sceneId: null, userId: null, packs: [] };

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

  section("1. a walled map is dark, and a token sees by its own light");
  const held = await run(gm, P.heldMaps, { ids: MAPS });
  const rebuild = held.length > 0 && HELD_OK;
  check(rebuild ? "the owner's AX1 maps are deleted to be made again (HELD_OK=1)" : "no world scene carries either map's id", !held.length || rebuild, held);
  if (held.length && !rebuild) throw new Error("stopped before the maps step: a scene this run did not make carries a map's id");
  if (rebuild) note("1: deleted (the owner's, by HELD_OK)", await run(gm, P.deleteScenes, { uuids: held }));
  await run(gm, P.fire, { step: "cookbookImportScenes", args: [{ books: [BOOK] }] });
  const st = await poll(gm, P.stepState, undefined, { tries: 450 });
  if (st?.error) throw new Error(`the maps step threw: ${st.error}`);
  if (!rebuild) {
    for (const uuid of st?.created?.scenes ?? []) gm.track(uuid, "Scene");
    for (const uuid of st?.created?.folders ?? []) gm.track(uuid, "Folder");
  } else note("1: rebuilt maps (the owner's, kept)", st?.created?.scenes ?? []);
  note("maps step", { made: st?.made, walls: st?.walls, wallsFailed: st?.wallsFailed, scenes: st?.created?.scenes?.length ?? 0 });
  const sights = [];
  for (const id of MAPS) sights.push({ id, ...(await run(gm, P.sightOf, { id })) });
  note("1: sight fields", sights);
  check("1: both levels are made and walled", sights.every((s) => s.uuid && s.walls > 0), sights.map((s) => ({ id: s.id, walls: s.walls })));
  check("1: each states token vision, each user's own fog, darkness 1 and no global light",
    sights.every((s) => s.tokenVision === true && s.fogMode === 1 && s.darkness === 1 && s.globalLight === false));

  const level = sights[0];
  const playerId = await run(gm, P.playerId, { name: SEATS.player });
  if (!playerId) throw new Error("the player seat's user is not in the world");
  const pc = await gm.create("Actor", { name: `QA lamplighter ${NONCE}`, type: "character", ownership: { default: 0, [playerId]: 3 } });
  note("fixture", { actor: pc.uuid });
  const floors = await run(gm, P.doorFloors, { uuid: level.uuid });
  if (!floors.points.length) throw new Error("the level has no plain door to stand a token beside");

  const player = await seat("player");
  note("player view", await run(player, P.view, { uuid: level.uuid }));
  fogLeft = { sceneId: level.uuid.split(".").pop(), userId: playerId };

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

  section("2. a book's journal rides its Adventure");
  const before = await run(gm, P.library, { book: BOOK });
  const owned = before.journals.length > 0 || before.adventures.length > 0;
  check(owned && HELD_OK ? "the library's AX1 journal and Adventure are rewritten (HELD_OK=1)" : "the library holds no AX1 journal or Adventure",
    !owned || HELD_OK, { journals: before.journals.length, adventures: before.adventures.length });
  if (owned && !HELD_OK) throw new Error("stopped before the journals step: the library's AX1 journal or Adventure is not this run's");
  await run(gm, P.fire, { step: "cookbookImportJournals", args: [{ books: [BOOK] }] });
  const js = await poll(gm, P.stepState, undefined, { tries: 600 });
  if (js?.error) throw new Error(`the journals step threw: ${js.error}`);
  for (const uuid of js?.created?.journals ?? []) gm.track(uuid, "JournalEntry");
  note("2: journals step", { made: js?.made, updated: js?.updated, refused: js?.refused, journals: js?.created?.journals?.length ?? 0 });
  const mid = await run(gm, P.library, { book: BOOK });
  check("2: every AX1 journal carries its cookbook id", mid.journals.length > 0 && mid.journals.every((j) => j.id && j.id === j.expected),
    mid.journals.map((j) => ({ uuid: j.uuid, stamped: j.id === j.expected })));
  await run(gm, P.fire, { step: "cookbookImportAdventures", args: [{ books: [BOOK] }] });
  const as = await poll(gm, P.stepState, undefined, { tries: 450 });
  if (as?.error) throw new Error(`the Adventure step threw: ${as.error}`);
  for (const uuid of as?.created?.adventures ?? []) gm.track(uuid, "Adventure");
  const opened = (as?.created?.packs ?? []).filter((c) => !before.packs.includes(c));
  fogLeft.packs = opened;
  note("2: Adventure step", { outcome: as?.books?.[BOOK] ?? null, written: as?.written, rebuilt: as?.rebuilt, kept: as?.kept, held: as?.held, failed: as?.failed });
  check("2: the step wrote or rebuilt AX1's Adventure", ["written", "rebuilt"].includes(as?.books?.[BOOK]), as?.books);
  const after = await run(gm, P.library, { book: BOOK });
  const adv = after.adventures.find((a) => a.kind === "kind.bookAdventure");
  note("2: Adventure contents", adv?.contents ?? null);
  check("2: the Adventure carries AX1's journals beside its maps", (adv?.contents?.journals ?? 0) === after.journals.length && (adv?.contents?.scenes ?? 0) === MAPS.length,
    { journals: adv?.contents?.journals, held: after.journals.length, scenes: adv?.contents?.scenes });
  const carried = adv ? await run(gm, P.adventureScenes, { uuid: adv.uuid }) : null;
  check("2: each map the Adventure carries is dark, as the world's are",
    !!carried?.length && carried.every((s) => s.tokenVision === true && s.fogMode === 1 && s.darkness === 1 && s.globalLight === false), carried);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
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
