/**
 * Live walk, formation-city-maps: docs/formation/TESTING.md, "A city over
 * several maps", on AX1's maps as the importer's maps step makes them. From
 * the GM seat a party crosses the book's ways between maps: off the region's
 * map into the fort, into one of the fort's buildings and out again, back to
 * the region and down into the dungeon's first level. Each arrival engages the
 * navigation its map declares, and the fort's grounds and its building are one
 * city: the board is stamped with the fort's map on both, and the tally walked
 * on the grounds is kept indoors and out again.
 *
 * Needs AX1's maps in the world with their ways between them (the importer-ax1
 * walk, or the Judge's own import, makes them); without them it stops and says
 * so. It reads the maps and never writes them.
 *
 * Fixtures and writes, each reported:
 *   - the party `formation/city-maps-party`, kept and found again by marker,
 *     with the formation core's create makes for it;
 *   - each run's party token, made beside the region map's way into the fort
 *     and tracked, and every token core makes for it on another map, read back
 *     and tracked as it is seen. The sweep at the end deletes them; the party
 *     stays, its formation unlinked from any token and set back to delve;
 *   - the chat cards this client makes during a crossing, tagged with the
 *     run's nonce: one that speaks as the party or names its formation is the
 *     run's and is tracked; any other is counted and left alone.
 * Each step brings the board to the shape it reads at its start through the
 * formation's own ledger writer, and pauses the party's clock as the Judge's
 * Pause does, so a step onto a way bills no turn, no block and no mile. A
 * crossing begins from a cell beside the way, reached by core's displace
 * movement, which no teleport answers.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats, PORTS } from "./_env.mjs";

const MOD = "acks-extras";
const NONCE = "cm" + Math.random().toString(36).slice(2, 7);
const MAPS = { region: "ax1.regionMap", fort: "ax1.fortMap", building: "ax1.fort5-8Map", level: "ax1.level1Map" };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page */
/* ------------------------------------------------------------------ */

const P = {
  install: async ({ nonce, mod }) => {
    const H = (globalThis.__cm = globalThis.__cm ?? {});
    H.nonce = nonce;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    H.model = await import(`/modules/${mod}/scripts/formation/formation-model.mjs`);
    H.read = (id) => {
      const f = H.F.getFormations()[id];
      const t = H.T.travelOf(f);
      return {
        sceneId: f?.sceneId ?? null, tokenId: f?.tokenId ?? null, mode: t.mode, paused: !!f?.clock?.paused,
        board: { sceneId: t.settlement.sceneId, blocks: t.settlement.blocks, turns: t.settlement.turns, wanted: !!t.settlement.wanted },
      };
    };
    if (!H.msgHook) H.msgHook = Hooks.on("preCreateChatMessage", (doc) => { try { doc.updateSource({ flags: { world: { cityMaps: { n: H.nonce } } } }); } catch (_e) { /* untagged */ } });
    const ac = await import(`/modules/${mod}/scripts/lib/automation-client.mjs`);
    await Promise.race([ac.automationSettled(), H.sleep(5000)]);
    const travel = await import(`/modules/${mod}/scripts/formation/travel.mjs`);
    return {
      fresh: typeof travel.cityStampOf === "function",
      role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, isLead: ac.isLeadClient(),
      module: game.modules.get(mod)?.version ?? null,
    };
  },

  /** Each named map: its scene, and the navigation its battlemap flag declares. */
  maps: async ({ ids }) => Object.fromEntries(Object.entries(ids).map(([k, id]) => {
    const s = game.scenes.find((x) => x.flags?.["acks-extras"]?.cookbook?.id === id);
    return [k, s ? { id: s.id, uuid: s.uuid, mapSystem: s.flags["acks-extras"].battlemap?.mapSystem ?? null } : null];
  })),

  /** The way on map `from` that leads to map `to`: its link key, and whether it asks. */
  endTo: async ({ from, to }) => {
    const s = game.scenes.get(from);
    for (const r of s?.regions ?? []) {
      const key = r.getFlag("acks-extras", "cookbook")?.link;
      const b = r.behaviors.find((x) => x.type === "teleportToken");
      if (!key || !b) continue;
      const dest = [...(b._source.system?.destinations ?? [])].map((u) => fromUuidSync(u, { relative: b }));
      if (dest.some((d) => d?.parent?.id === to)) return { key, uuid: r.uuid, asks: !!b.system.choice, leads: dest.length };
    }
    return null;
  },

  /** The formation core's create made for the party actor. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__cm;
    for (let n = 0; n < 50; n++) {
      const f = Object.values(H.F.getFormations()).find((x) => x.actorId === partyId);
      if (f) return f.id;
      await H.sleep(200);
    }
    return null;
  },

  /** Where a way's middle is, and the corner half a cell past its edge (`dx`, `dy`) a token of `cells` would stand at. */
  beside: async ({ uuid, dx = -1, dy = 0, cells = 1 }) => {
    const r = await fromUuid(uuid);
    const s = r.parent;
    const { x, y, width, height } = r.shapes[0];
    const size = s.grid.size;
    const cx = x + width / 2 + dx * (width / 2 + (size * cells) / 2);
    const cy = y + height / 2 + dy * (height / 2 + (size * cells) / 2);
    return { x: Math.round(cx - (size * cells) / 2), y: Math.round(cy - (size * cells) / 2), mid: { x: Math.round(x + width / 2 - (size * cells) / 2), y: Math.round(y + height / 2 - (size * cells) / 2) } };
  },

  /** A token of the party actor made beside a way. */
  placeParty: async ({ sceneId, actorId, x, y }) => {
    const s = game.scenes.get(sceneId);
    const data = (await game.actors.get(actorId).getTokenDocument({ x, y })).toObject();
    const [t] = await s.createEmbeddedDocuments("Token", [data]);
    return t ? { uuid: t.uuid, id: t.id } : null;
  },

  /** The token moved to a point by core's displace action, which no teleport answers. */
  displace: async ({ tokenUuid, x, y }) => {
    const t = await fromUuid(tokenUuid);
    if (!t) return { moved: false };
    await t.move({ x, y, action: "displace" });
    return { moved: true, x: t.x, y: t.y, scene: t.parent.id };
  },

  /** The token walked to a point, walls ignored. Fired, not awaited: core holds a move a question paused. */
  walk: async ({ tokenUuid, x, y }) => {
    const t = await fromUuid(tokenUuid);
    if (!t) return { fired: false };
    globalThis.__cm.walked = { done: false };
    t.move({ x, y }, { constrainOptions: { ignoreWalls: true } })
      .then(() => { globalThis.__cm.walked = { done: true }; })
      .catch((e) => { globalThis.__cm.walked = { done: true, error: String(e?.message ?? e) }; });
    return { fired: true };
  },

  /** Presses yes on the question a teleport puts to this user, waiting up to `wait` ms; its default destination stands. */
  answer: async ({ wait = 8000 }) => {
    const find = () => [...foundry.applications.instances.values()].find((a) => String(a.id).startsWith("dialog-") && a.rendered);
    let d = null;
    for (let n = 0; n < wait / 250 && !(d = find()); n++) await new Promise((r) => setTimeout(r, 250));
    if (!d) return { asked: false };
    const where = d.element.querySelector('select[name="destination"]');
    d.element.querySelector('button[data-action="yes"]')?.click();
    return { asked: true, options: where ? where.options.length : 1 };
  },

  /** Every token of the actor, by map. */
  tokensOf: async ({ actorId }) => {
    const out = [];
    for (const s of game.scenes) for (const t of s.tokens) if (t.actorId === actorId) out.push({ uuid: t.uuid, id: t.id, scene: s.id });
    return out;
  },

  /**
   * The formation brought to a step's shape: the mode (entered on `sceneId`
   * when it changes), then the board's fields, then the clock paused as the
   * Judge's Pause pauses it.
   */
  shape: async ({ fid, mode = null, sceneId = null, board = {} }) => {
    const H = globalThis.__cm;
    if (mode && H.T.travelOf(H.F.getFormations()[fid]).mode !== mode) await H.T.setJourneyMode(fid, mode, { sceneId });
    await H.model.patchFormation(fid, (record) => {
      const t = record.travel ?? {};
      record.travel = { ...t, settlement: { ...(t.settlement ?? {}), ...board } };
      record.clock = { ...(record.clock ?? {}), paused: true, pausedBy: "judge" };
      return record;
    });
    await H.sleep(300);
    return H.read(fid);
  },

  /** What the record says now: its token and map, its mode, and the settlement board. */
  record: async ({ fid }) => globalThis.__cm.read(fid),

  /** This client's cards since `t0` under the run's nonce: the party's, and how many others. */
  cards: async ({ t0, partyId, fid }) => {
    const H = globalThis.__cm;
    const tagged = game.messages.contents.filter((m) => m.flags?.world?.cityMaps?.n === H.nonce && m.timestamp >= t0 - 50);
    const mine = tagged.filter((m) => m.speaker?.actor === partyId || (m.content ?? "").includes(fid) || JSON.stringify(m.flags?.["acks-extras"] ?? {}).includes(fid));
    return { mine: mine.map((m) => m.uuid), others: tagged.length - mine.length };
  },

  /** Out of the city: a kept party left in settlement mode would be counted a stay between runs. */
  toDelve: async ({ fid }) => {
    const H = globalThis.__cm;
    if (H.F.getFormations()[fid]) await H.T.setJourneyMode(fid, "delve");
    return H.T.travelOf(H.F.getFormations()[fid]).mode;
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                           */
/* ------------------------------------------------------------------ */

const run = async (api, fn, args) =>
  JSON.parse(await api.eval(`(${fn.toString()})(${JSON.stringify(args ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`));

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let fid = null;
// What the teardown sweeps: the run's tokens and cards. The party is kept.
const made = new Set();
const keep = (uuid, kind) => { gm.track(uuid, kind); made.add(uuid); };

try {
  section("seat");
  const s = seats();
  gm = await connect({ browser: s.browser, origin: s.origin, user: s.gm, port: PORTS.gm, own: s.own });
  note("GM seat ready after (s)", await ready(gm));
  const inst = await run(gm, P.install, { nonce: NONCE, mod: MOD });
  note("module", inst.module);
  if (!inst.fresh) throw new Error("the loaded module has no cityStampOf: the page did not pick up the working tree");
  check("the GM seat is the active GM and its window leads its seat's election, so the formation's hooks run in it",
    inst.role === 4 && inst.activeGMIsSelf && inst.isLead, inst);
  if (!(inst.activeGMIsSelf && inst.isLead)) throw new Error("another window runs the GM seat's automation");

  section("AX1's maps");
  const maps = await run(gm, P.maps, { ids: MAPS });
  const absent = Object.entries(maps).filter(([, m]) => !m).map(([k]) => MAPS[k]);
  if (absent.length) throw new Error(`AX1's maps are not in the world (${absent.join(", ")}): import them first`);
  check("each map declares its navigation: the region's a journey, the fort's grounds and its building a city, the dungeon's level a delve",
    maps.region.mapSystem === "journey" && maps.fort.mapSystem === "settlement" && maps.building.mapSystem === "settlement" && maps.level.mapSystem === "delve",
    Object.fromEntries(Object.entries(maps).map(([k, m]) => [k, m.mapSystem])));
  const ways = {
    regionToFort: await run(gm, P.endTo, { from: maps.region.id, to: maps.fort.id }),
    fortToBuilding: await run(gm, P.endTo, { from: maps.fort.id, to: maps.building.id }),
    buildingToFort: await run(gm, P.endTo, { from: maps.building.id, to: maps.fort.id }),
    fortToRegion: await run(gm, P.endTo, { from: maps.fort.id, to: maps.region.id }),
    regionToLevel: await run(gm, P.endTo, { from: maps.region.id, to: maps.level.id }),
  };
  const noWay = Object.entries(ways).filter(([, w]) => !w).map(([k]) => k);
  if (noWay.length) throw new Error(`AX1's maps carry no way for ${noWay.join(", ")}: run the maps step's link pass`);
  note("ways", Object.fromEntries(Object.entries(ways).map(([k, w]) => [k, { asks: w.asks, leads: w.leads }])));

  section("the party");
  const party = await gm.fixture("formation/city-maps-party", "Actor", { name: "QA City Maps Company", type: "acks-extras.party" });
  fid = await run(gm, P.formationOf, { partyId: party.id });
  if (!fid) throw new Error("no formation for the party actor");
  const standing = (await run(gm, P.tokensOf, { actorId: party.id })).length;
  if (standing) note("party tokens standing before the run (not this run's, left alone)", standing);
  const start = await run(gm, P.beside, { uuid: ways.regionToFort.uuid, dx: -1 });
  const placed = await run(gm, P.placeParty, { sceneId: maps.region.id, actorId: party.id, x: start.x, y: start.y });
  if (!placed) throw new Error("the party token was not made");
  keep(placed.uuid, "Token");
  let rec = null;
  for (let n = 0; n < 40 && (rec = await run(gm, P.record, { fid })).tokenId !== placed.id; n++) await sleep(250);
  check("the party's formation adopts the token placed on the region's map", rec.tokenId === placed.id && rec.sceneId === maps.region.id, rec);

  /**
   * The party's token, the one its record names, walked onto a way from beside
   * it, the question answered, and the token it arrives as on `to`, tracked.
   * Core's teleport keeps a token's id, so the arrival is told by its map and
   * by not standing before the crossing, never by its id.
   */
  const cross = async (way, to, mode, dx = -1) => {
    const r0 = await run(gm, P.record, { fid });
    const here = `Scene.${r0.sceneId}.Token.${r0.tokenId}`;
    const before = new Set((await run(gm, P.tokensOf, { actorId: party.id })).map((t) => t.uuid));
    const at = await run(gm, P.beside, { uuid: way.uuid, dx });
    await run(gm, P.displace, { tokenUuid: here, x: at.x, y: at.y });
    const t0 = await gm.eval("Date.now()");
    await run(gm, P.walk, { tokenUuid: here, x: at.mid.x, y: at.mid.y });
    const asked = way.asks ? await run(gm, P.answer, {}) : { asked: false };
    let arrived = null;
    for (let n = 0; n < 60 && !arrived; n++) {
      await sleep(250);
      arrived = (await run(gm, P.tokensOf, { actorId: party.id })).find((t) => t.scene === to && !before.has(t.uuid)) ?? null;
    }
    if (arrived) keep(arrived.uuid, "Token");
    // The arrival's linkage and its mode land in two writes on the primary
    // GM, each after core's create; wait for both, then for anything behind them.
    let r = await run(gm, P.record, { fid });
    for (let n = 0; n < 80 && arrived && !(r.sceneId === to && r.tokenId === arrived.id && r.mode === mode); n++) {
      await sleep(250);
      r = await run(gm, P.record, { fid });
    }
    await sleep(1000);
    r = await run(gm, P.record, { fid });
    const cards = await run(gm, P.cards, { t0, partyId: party.id, fid });
    for (const u of cards.mine) keep(u, "ChatMessage");
    return { arrived, asked, r, cards };
  };

  section("A city over several maps");
  // 1. Off the region's map into the fort: a journey arrives in a city.
  await run(gm, P.shape, { fid, mode: "journey", sceneId: maps.region.id });
  let c = await cross(ways.regionToFort, maps.fort.id, "settlement");
  check("1: off the region's map, the party arrives on the fort's grounds and the record follows its token there",
    !!c.arrived && c.r.sceneId === maps.fort.id && c.r.tokenId === c.arrived.id, { asked: c.asked, record: c.r });
  check("1: and is in the city, its board counted on the fort's map", c.r.mode === "settlement" && c.r.board.sceneId === maps.fort.id, c.r);

  // 2. Into a building from a board counted somewhere else: an entry, stamped with the fort's map.
  await run(gm, P.shape, { fid, board: { sceneId: maps.level.id, blocks: 5, turns: 2 } });
  c = await cross(ways.fortToBuilding, maps.building.id, "settlement");
  check("2: stepping into a building with a board counted elsewhere enters the city afresh, stamped with the fort's map and not the building's",
    !!c.arrived && c.r.sceneId === maps.building.id && c.r.mode === "settlement" && c.r.board.sceneId === maps.fort.id && c.r.board.blocks === 0 && c.r.board.turns === 0,
    { building: maps.building.id, record: c.r });

  // 3. Out to the grounds again: the same city, so the tally stays.
  await run(gm, P.shape, { fid, board: { blocks: 7, turns: 3, wanted: true } });
  c = await cross(ways.buildingToFort, maps.fort.id, "settlement", 1);
  check("3: walking back out to the grounds keeps the tally, the hunt and the fort's stamp",
    !!c.arrived && c.r.sceneId === maps.fort.id && c.r.mode === "settlement" && c.r.board.sceneId === maps.fort.id
      && c.r.board.blocks === 7 && c.r.board.turns === 3 && c.r.board.wanted === true, { asked: c.asked, record: c.r });

  // 4. And into the building again, with the board the grounds counted.
  c = await cross(ways.fortToBuilding, maps.building.id, "settlement");
  check("4: stepping into the building from the grounds keeps the tally too",
    !!c.arrived && c.r.sceneId === maps.building.id && c.r.board.sceneId === maps.fort.id && c.r.board.blocks === 7 && c.r.board.turns === 3,
    c.r);
  await run(gm, P.shape, { fid });
  c = await cross(ways.buildingToFort, maps.fort.id, "settlement", 1);
  check("4: and out", !!c.arrived && c.r.sceneId === maps.fort.id && c.r.board.blocks === 7, c.r);

  // 5. Back to the region, and down into the dungeon: each map engages its own navigation.
  await run(gm, P.shape, { fid });
  c = await cross(ways.fortToRegion, maps.region.id, "journey");
  check("5: off the fort's grounds onto the region's map, the party travels as a journey",
    !!c.arrived && c.r.sceneId === maps.region.id && c.r.mode === "journey", c.r);
  await run(gm, P.shape, { fid });
  c = await cross(ways.regionToLevel, maps.level.id, "delve");
  check("5: and down into the dungeon's first level, it explores a turn at a time",
    !!c.arrived && c.r.sceneId === maps.level.id && c.r.mode === "delve", c.r);
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  if (gm) {
    try { if (fid) note("the party out of the city", await run(gm, P.toDelve, { fid })); } catch (err) { console.error("toDelve:", err?.message ?? err); }
    try { note("swept", made.size ? await gm.sweepTracked({ only: [...made] }) : "nothing made"); } catch (err) { console.error("sweep:", err?.message ?? err); }
    try { gm.close(); } catch (_e) { /* closed */ }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
}
